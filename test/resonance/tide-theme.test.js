// 共鸣「潮汐」主题：色值层与样式表的范围、动效时长、程序化水声与局内变化的识别。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTideRemap, remapValue, isTideGreen, TIDE_REMAP_PATH } from '../../tools/resonance/build-tide-theme.mjs';
import { AudioManager } from '../../public/js/audio.js';
import { TIDE_VOICES, tideVoicing, tideChanges, tidePhaseCue } from '../../public/js/resonance/tide.js';
import { PHASE } from '../../shared/constants.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('the colour layer is generated from the stylesheets resonance.html loads and is up to date', () => {
  assert.equal(read(TIDE_REMAP_PATH), buildTideRemap(), 'run node tools/resonance/build-tide-theme.mjs after changing a resonance stylesheet');
});

test('every tide rule is scoped to the resonance root; the original game and the workshop never load the tide files', () => {
  const remap = read(TIDE_REMAP_PATH).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...remap.matchAll(/(?:^|\})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter((s) => !/^(from|to|\d)/.test(s));
  assert.ok(selectors.length > 300);
  for (const list of selectors) for (const sel of list.split(/,(?![^(]*\))/)) {
    assert.match(sel.trim(), /^(:where\(html\.rs-tide\)|html:where\(\.rs-tide\)|:root:where\(\.rs-tide\))/, sel);
  }
  const tide = read('public/css/resonance-tide.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of tide.matchAll(/(?:^|\}|\{)\s*([^{}@]+)\{/g)) {
    for (const sel of m[1].split(/,(?![^(]*\))/)) assert.match(sel.trim(), /^(html\.rs-tide|\.tide-)/, sel.trim());
  }
  const html = read('public/resonance.html');
  assert.match(html, /<html[^>]*class="[^"]*\brs-tide\b/);
  const links = [...html.matchAll(/href="\.\/css\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links.slice(-3), ['resonance.css', 'resonance-tide-remap.css', 'resonance-tide.css'], 'the tide layers load last');
  for (const page of ['public/index.html', 'public/independent.html']) assert.doesNotMatch(read(page), /resonance-tide|rs-tide/, page);
});

test('mint and green-black become sea blue; semantic greens (2-cost, heal, HP) stay', () => {
  assert.equal(remapValue('rgba(78, 216, 175, .35)'), 'color-mix(in srgb, var(--mint-500) 35%, transparent)');
  assert.equal(remapValue('#17f9b7'), 'var(--mint-glow)');
  assert.equal(remapValue('#d7e5dc'), 'var(--tide-ink)');
  assert.equal(remapValue('#101814'), 'var(--tide-deep)');
  assert.match(remapValue('rgba(8, 11, 10, .9)'), /^rgba\(\d+, \d+, \d+, 0\.9\)$/);
  for (const keep of ['#7fd37a', '#28b66a', '#3fdc6a', '#6dfa9c', '#56e08a', '#2bb65a', '#0b1a0a', '#ffc600', '#e73118', '#9fd4ff', '#86cfee'])
    assert.equal(remapValue(`linear-gradient(${keep}, ${keep})`), null, keep);
  const [r, g, b] = remapValue('#4f5a55').match(/[0-9a-f]{2}/g).map((x) => parseInt(x, 16));
  assert.ok(b > g && g >= r, 'a grey-green line turns slate blue');
  assert.equal(isTideGreen([127, 211, 122]), false);
});

test('ripples, surges and the HUD crests stay within 150–600 ms and stop for reduced motion', () => {
  const css = read('public/css/resonance-tide.css');
  const durations = [...css.matchAll(/\.tide-[^{]*\{[^}]*?(?:animation(?:-duration)?:[^;]*?)(\d+)ms/g)].map((m) => Number(m[1]));
  assert.ok(durations.length >= 5);
  for (const ms of durations) assert.ok(ms >= 150 && ms <= 600, `${ms} ms`);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.tide-surge \{ display: none; \}/);
  assert.match(reduced, /animation: none/);
  assert.match(css, /html\.rs-tide\.sp-reduced-motion \.tide-surge \{ display: none; \}/);
  assert.match(css, /\.tide-fx \{[^}]*pointer-events: none/, 'the effect layer never takes a pointer (drops and hit tests pass through)');
});

// ---- sound -----------------------------------------------------------------------------------------------------

function fakeContext() {
  const made = { osc: 0, noise: 0, started: 0, starts: [], connections: [] };
  class Param { constructor(v = 1) { this.value = v; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } exponentialRampToValueAtTime(v) { assert.ok(v > 0, 'exponential ramps never reach 0'); this.value = v; } setTargetAtTime(v) { this.value = v; } }
  class Node { connect(to) { made.connections.push([this, to]); return to; } disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.frequency = new Param(440); this.playbackRate = new Param(); this.type = 'sine'; } start(at) { made.started++; made.starts.push(at); } stop() {} }
  class Filter extends Node { constructor() { super(); this.frequency = new Param(350); this.Q = new Param(1); } }
  const ctx = {
    currentTime: 3, sampleRate: 8000, state: 'running', destination: new Node(),
    createGain: () => new Gain(), createBiquadFilter: () => new Filter(),
    createOscillator: () => { made.osc++; return new Src(); },
    createBufferSource: () => { made.noise++; return new Src(); },
    createBuffer: (channels, length, sampleRate) => { const data = new Float32Array(length); return { sampleRate, length, getChannelData: () => data }; },
  };
  return { ctx, made };
}

test('the tide voices are synthesized into the sfx channel: drop, rising ripple, wave, ebb', () => {
  const { ctx, made } = fakeContext();
  const destination = { connect() {} };
  for (const name of ['click', 'merge', 'roundStart', 'battleStart', 'sell', 'retreat', 'starUp', 'claim', 'combine']) {
    assert.equal(tideVoicing(name, { volume: .5 }, { ctx, destination }), true, name);
  }
  assert.ok(made.osc > 0 && made.noise > 0 && made.started > 0);
  assert.ok(made.starts.every((at) => at > ctx.currentTime), 'every source starts at its envelope, never before it (a gain holds 1 until its first event)');
  assert.ok(made.connections.some(([, to]) => to === destination), 'every voice ends on the given sfx destination');
  assert.ok(!made.connections.some(([, to]) => to === ctx.destination), 'never straight to the speakers (volume and mute apply)');
  for (const name of ['error', 'timer', 'settlementFail']) assert.equal(tideVoicing(name, {}, { ctx, destination }), false, `${name} keeps its sample`);
  assert.equal(TIDE_VOICES.sell, 'ebb');
  assert.equal(TIDE_VOICES.rest, 'wave', '休整 opens a round when ROUND_START is not shown');
  assert.equal(TIDE_VOICES.battleStart, 'surf');
});

test('AudioManager asks the UI voicing only after the unlock and while the sfx channel is audible', () => {
  const urls = [];
  const a = new AudioManager({ win: null, getManifest: () => ({ audio: { sfx: { ui: { click: '/a/click.mp3', error: '/a/error.mp3' } } } }) });
  a._play = (url) => urls.push(url);
  const asked = [];
  a.setUiVoicing((name) => { asked.push(name); return name === 'click'; });
  a.sfx('click');
  assert.deepEqual(asked, [], 'locked: no context yet');
  const { ctx } = fakeContext();
  a.ctx = ctx; a.sfxGain = { connect() {} };
  a.sfx('click'); a.sfx('error');
  assert.deepEqual(asked, ['click', 'error']);
  assert.deepEqual(urls.slice(-1), ['/a/error.mp3'], 'a voiced name skips its sample; an unvoiced one plays it');
  a.setVolumes({ muted: true }); a.sfx('click');
  a.setVolumes({ muted: false, sfx: 0 }); a.sfx('click');
  ctx.state = 'suspended'; a.setVolumes({ sfx: .8 }); a.sfx('click');
  assert.equal(asked.length, 2, 'muted, silent or suspended: the voicing is not asked');
  a.setUiVoicing(null); ctx.state = 'running'; a.sfx('click');
  assert.equal(urls.at(-1), '/a/click.mp3');
});

// ---- what changed --------------------------------------------------------------------------------------------------

test('star-ups, combines and claims are told apart from ordinary updates', () => {
  const base = { pieces: [{ uid: 'p1', nativeUid: 11, operatorId: 'a', star: 1, equipment: [] }, { uid: 'p2', nativeUid: 12, operatorId: 'a', star: 1, equipment: [] }],
    inventory: [{ uid: 'i1', itemId: 'blade' }, { uid: 'i2', itemId: 'staff' }], pendingChoices: [{ uid: 'c1' }] };
  assert.deepEqual(tideChanges(base, base), []);
  assert.deepEqual(tideChanges(null, base), []);
  // a purchase merges the copies into a new 2-star piece
  const merged = { ...base, pieces: [{ uid: 'p3', nativeUid: 13, operatorId: 'a', star: 2, equipment: [] }] };
  assert.deepEqual(tideChanges(base, merged), [{ kind: 'starUp', nativeUid: 13 }]);
  // the same piece rising in place
  const risen = { ...base, pieces: [{ ...base.pieces[0], star: 2 }] };
  assert.deepEqual(tideChanges(base, risen), [{ kind: 'starUp', nativeUid: 11 }]);
  // a third copy bought without a merge, a deploy, an equip: nothing
  assert.deepEqual(tideChanges(base, { ...base, pieces: [...base.pieces, { uid: 'p4', nativeUid: 14, operatorId: 'a', star: 1, equipment: [] }] }), []);
  const equipped = { ...base, inventory: [base.inventory[1]], pieces: [{ ...base.pieces[0], equipment: [base.inventory[0]] }, base.pieces[1]] };
  assert.deepEqual(tideChanges(base, equipped), []);
  // two components become one completed item on the piece wearing it
  const combined = { ...base, inventory: [], pieces: [{ ...base.pieces[0], equipment: [{ uid: 'i9', nativeUid: 90, itemId: 'spellblade' }] }, base.pieces[1]] };
  assert.deepEqual(tideChanges(base, combined), [{ kind: 'combine', itemUid: 90, nativeUid: 11 }]);
  // a strategy / supply choice resolved
  assert.deepEqual(tideChanges(base, { ...base, pendingChoices: [] }), [{ kind: 'claim' }]);
  assert.deepEqual(tideChanges(base, { ...base, pendingChoices: [{ uid: 'c2' }] }), [{ kind: 'claim' }], 'a claim that opens the next choice');
  // a sale: the piece is gone and the gold rose; a merge paid for with gold is not a sale
  const rich = { ...base, gold: 10 };
  assert.deepEqual(tideChanges(rich, { ...rich, gold: 11, pieces: [base.pieces[0]] }), [{ kind: 'sell', nativeUid: 12 }]);
  assert.deepEqual(tideChanges(rich, { ...merged, gold: 9 }), [{ kind: 'starUp', nativeUid: 13 }]);
});

test('a surge marks a round start and a fight start, once per change', () => {
  assert.equal(tidePhaseCue(PHASE.SETTLE, PHASE.ROUND_START), 'round');
  for (const fight of [PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]) assert.equal(tidePhaseCue(PHASE.PREP, fight), 'battle');
  assert.equal(tidePhaseCue(null, PHASE.COMBAT), null, 'opening a match mid-fight is not a fight start');
  assert.equal(tidePhaseCue(PHASE.COMBAT, PHASE.COMBAT), null);
  assert.equal(tidePhaseCue(PHASE.ROUND_START, PHASE.PREP), null);
  for (const from of [PHASE.SETTLE, PHASE.INFO_CHECK]) assert.equal(tidePhaseCue(from, PHASE.PREP), 'round', 'a solo run opens its round straight into the prep');
});
