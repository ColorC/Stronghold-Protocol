// Field-host ownership under cancellation and timeout. Browser tests cover the actual renderer; this fixture runs
// the production orchestration with controlled imports and timers, without a DOM or GPU dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import vm from 'node:vm';

const sourcePath = new URL('../../public/js/ui/fieldHost.js', import.meta.url);
const source = readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '')
  .replace("import('../assets.js')", 'importAssets()')
  .replace("import('../render/app.js')", 'importApp()');
const METHODS = ['setStage', 'setCamera', 'setPrep', 'enterBattle', 'pushSnapshot', 'pushEvents', 'highlightTiles', 'on', 'resize'];
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function createHookHarness() {
  const slots = [];
  let cursor = 0;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: { current: initial } };
      return slots[i].value;
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !depsEqual(slots[i].deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !depsEqual(slots[i].deps, deps)) {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      }
    },
    render(fn) { cursor = 0; return fn(); },
    unmount() { for (const slot of [...slots].reverse()) { slot?.cleanup?.(); slot.cleanup = null; } },
  };
}

function fixture() {
  const timers = new Map(), timerDelays = new Map(), requests = [], fallbacks = [], warnings = [];
  const hooks = createHookHarness(), resizeListeners = new Set(), settingsListeners = new Set();
  let timerId = 0;
  const unrelated = { name: 'unrelated' };
  const host = {
    children: [unrelated],
    get firstChild() { return this.children[0] || null; },
    appendChild(node) { this.children.push(node); },
    removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); },
  };
  function view(name, valid = true) {
    const node = { name };
    host.appendChild(node);
    return {
      ...(valid ? Object.fromEntries(METHODS.map((k) => [k, () => {}])) : {}),
      node, destroyCalls: 0,
      destroy() { this.destroyCalls++; host.removeChild(node); },
    };
  }
  const context = vm.createContext({
    AbortController, DOMException, URLSearchParams, Promise,
    location: { search: '' },
    useState: hooks.useState.bind(hooks), useRef: hooks.useRef.bind(hooks),
    useCallback: hooks.useCallback.bind(hooks), useEffect: hooks.useEffect.bind(hooks),
    window: {
      addEventListener(name, fn) { if (name === 'resize') resizeListeners.add(fn); },
      removeEventListener(name, fn) { if (name === 'resize') resizeListeners.delete(fn); },
    },
    console: { warn: (...args) => warnings.push(args) },
    audio: {}, data: { get() { return null; } }, settingsStore: {
      get() { return {}; },
      subscribe(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn); },
    },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, fn); timerDelays.set(id, ms); return id; },
    clearTimeout(id) { timers.delete(id); timerDelays.delete(id); },
    importAssets: async () => null,
    importApp: async () => ({
      createFieldView(_host, opts) {
        // Deliberately ignore cancellation: the host must still dispose a factory's late return value.
        return new Promise((resolve, reject) => requests.push({ resolve, reject, signal: opts.signal }));
      },
    }),
    createFallbackView() {
      const fallback = view('fallback');
      fallbacks.push({ view: fallback, rendererAborted: requests.at(-1)?.signal?.aborted });
      return fallback;
    },
  });
  vm.runInContext(source + '\nglobalThis.mount = mountFieldView; globalThis.useView = useFieldView;', context, { filename: sourcePath.pathname });
  return {
    host, unrelated, timers, timerDelays, requests, fallbacks, warnings, view, resizeListeners, settingsListeners,
    context,
    renderHook: (extra = {}) => hooks.render(() => context.useView({ current: host }, extra)),
    unmountHook: () => hooks.unmount(),
    mount: (signal, extra = {}) => context.mount(host, { ...extra, ...(signal ? { signal } : {}) }),
    fireTimer(id) { const fn = timers.get(id); assert.ok(fn, `timer ${id} exists`); timers.delete(id); timerDelays.delete(id); fn(); },
    timeout() { const fn = [...timers.values()].at(-1); assert.ok(fn, 'initialization has a deadline'); fn(); },
  };
}

function settled(promise) {
  const result = { state: 'pending', value: null };
  promise.then((value) => { result.state = 'fulfilled'; result.value = value; }, (error) => { result.state = 'rejected'; result.value = error; });
  return result;
}

test('successful initialization releases deadlines and cancellation listeners', async () => {
  const f = fixture(), controller = new AbortController();
  const pending = f.mount(controller.signal);
  await flush();
  const raw = f.view('engine');
  f.requests[0].resolve(raw);
  const mounted = await pending;
  assert.equal(mounted.kind, 'engine');
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(f.requests[0].signal, 'abort').length, 0);
  mounted.destroy();
  assert.equal(raw.destroyCalls, 1);
});

test('cancelling a pending mount rejects without fallback and disposes a late result', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.warnings.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('cancellation between factory resolution and mount continuation disposes the resolved view', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  const raw = f.view('settling');
  f.requests[0].resolve(raw);
  await Promise.resolve();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(raw.destroyCalls, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('an invalid renderer API is disposed and aborted before fallback mounts', async () => {
  const f = fixture();
  const pending = f.mount();
  await flush();
  const invalid = f.view('invalid', false);
  f.requests[0].resolve(invalid);
  const fallback = await pending;
  assert.equal(fallback.kind, 'fallback');
  assert.equal(invalid.destroyCalls, 1);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, f.fallbacks[0].view.node]);
  fallback.destroy();
});

test('a timed-out factory returning late cannot remove a replacement view or unrelated children', async () => {
  const f = fixture();
  const first = f.mount();
  await flush();
  f.timeout();
  const fallback = await first;
  assert.equal(fallback.kind, 'fallback');
  fallback.destroy();
  const replacementPending = f.mount();
  await flush();
  const replacement = f.view('replacement');
  f.requests[1].resolve(replacement);
  const mounted = await replacementPending;
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.equal(replacement.destroyCalls, 0);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, replacement.node]);
  mounted.destroy();
});

test('strict engine mode rethrows its original failure and never mounts the fallback', async () => {
  const f = fixture(), original = new Error('strict engine failure');
  const pending = f.mount(undefined, { requireEngine: true });
  await flush();
  assert.equal(f.requests.length, 1);
  f.requests[0].reject(original);
  await assert.rejects(pending, (error) => error === original);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.fallbacks.length, 0);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('strict engine mode overrides URL and global fallback preferences', async () => {
  const f = fixture();
  f.context.location.search = '?render=fallback';
  f.context.__SP_RENDER__ = 'fallback';
  const pending = f.mount(undefined, { requireEngine: true });
  await flush();
  assert.equal(f.requests.length, 1);
  const raw = f.view('strict-engine');
  f.requests[0].resolve(raw);
  const mounted = await pending;
  assert.equal(mounted.kind, 'engine');
  assert.equal(f.fallbacks.length, 0);
  mounted.destroy();
});

test('strict timeout rejects and disposes a factory result that arrives late', async () => {
  const f = fixture();
  const pending = f.mount(undefined, { requireEngine: true });
  await flush();
  f.timeout();
  await assert.rejects(pending, /createFieldView timed out/);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.fallbacks.length, 0);
  const late = f.view('late-strict');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('strict hook retries at configured delays, then exposes a guarded engine and tears it down', async () => {
  const f = fixture(), opts = { requireEngine: true, retryDelays: [1500, 3000] };
  let state = f.renderHook(opts);
  await flush();
  assert.equal(f.requests.length, 1);
  f.requests[0].reject(new Error('attempt one'));
  await flush();
  state = f.renderHook(opts);
  assert.equal(state.kind, 'loading');
  assert.equal(state.error, null);
  const firstRetry = [...f.timerDelays].find(([, ms]) => ms === 1500)?.[0];
  assert.ok(firstRetry, 'first automatic retry uses the configured 1500ms delay');
  f.fireTimer(firstRetry);
  state = f.renderHook(opts);
  await flush();
  assert.equal(f.requests.length, 2);
  f.requests[1].reject(new Error('attempt two'));
  await flush();
  state = f.renderHook(opts);
  assert.equal(state.kind, 'loading');
  const secondRetry = [...f.timerDelays].find(([, ms]) => ms === 3000)?.[0];
  assert.ok(secondRetry, 'second automatic retry uses the configured 3000ms delay');
  f.fireTimer(secondRetry);
  state = f.renderHook(opts);
  await flush();
  assert.equal(f.requests.length, 3);
  const raw = f.view('hook-engine');
  f.requests[2].resolve(raw);
  await flush();
  state = f.renderHook(opts);
  assert.equal(state.kind, 'engine');
  assert.equal(state.error, null);
  assert.equal(typeof state.retry, 'function');
  assert.equal(f.resizeListeners.size, 1);
  assert.equal(f.settingsListeners.size, 1);
  f.unmountHook();
  assert.equal(raw.destroyCalls, 1);
  assert.equal(f.resizeListeners.size, 0);
  assert.equal(f.settingsListeners.size, 0);
  assert.equal(f.context.__SP_VIEW__, null);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('exhausted strict hook reports its error and manual retry resets automatic attempts', async () => {
  const f = fixture(), opts = { requireEngine: true, retryDelays: [1500] };
  f.renderHook(opts);
  await flush();
  f.requests[0].reject(new Error('initial failure'));
  await flush();
  const firstTimer = [...f.timerDelays].find(([, ms]) => ms === 1500)?.[0];
  assert.ok(firstTimer);
  f.fireTimer(firstTimer);
  let state = f.renderHook(opts);
  await flush();
  f.requests[1].reject(new Error('retry failure'));
  await flush();
  state = f.renderHook(opts);
  assert.equal(state.kind, 'error');
  assert.match(state.error.message, /retry failure/);
  assert.equal(typeof state.retry, 'function');
  state.retry();
  state = f.renderHook(opts);
  assert.equal(state.kind, 'loading');
  assert.equal(state.error, null);
  await flush();
  assert.equal(f.requests.length, 3);
  f.requests[2].reject(new Error('manual attempt failure'));
  await flush();
  state = f.renderHook(opts);
  assert.equal(state.kind, 'loading');
  assert.ok([...f.timerDelays.values()].includes(1500), 'manual retry resets the automatic retry allowance');
  f.unmountHook();
  assert.equal(f.timers.size, 0);
  assert.equal(f.requests[2].signal.aborted, true);
});
