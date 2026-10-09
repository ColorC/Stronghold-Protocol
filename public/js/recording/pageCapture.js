const INPUT_SELECTOR = 'input,textarea,select,[contenteditable="true"],[role="textbox"]';
const TEXT_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ' ']);

function targetInfo(target) {
  if (!target || target.nodeType !== 1) return null;
  const element = target.closest?.('[data-record-id],button,[role="button"],a,input,textarea,select,[tabindex]') || target;
  return {
    tag: String(element.tagName || '').toLowerCase(),
    id: element.id || '',
    role: element.getAttribute?.('role') || '',
    label: element.getAttribute?.('aria-label') || element.getAttribute?.('title') || '',
  };
}

function isPasswordEntry(target) {
  const node = target?.closest?.(INPUT_SELECTOR);
  return String(node?.type || '').toLowerCase() === 'password';
}

export function selectionSnapshot(doc = globalThis.document, win = globalThis.window) {
  const selection = doc?.getSelection?.();
  const text = String(selection?.toString?.() || '').replace(/\u0000/g, '').slice(0, 4000);
  if (!text || selection?.isCollapsed) return null;
  const rects = [];
  for (const range of Array.from({ length: selection.rangeCount || 0 }, (_, i) => selection.getRangeAt(i))) {
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      rects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      if (rects.length >= 32) break;
    }
    if (rects.length >= 32) break;
  }
  if (!rects.length) return null;
  return { text, rects, viewport: { width: win?.innerWidth || 0, height: win?.innerHeight || 0 } };
}

/** Attach lossless rrweb DOM events plus compact, replayable interaction and text-selection records. */
export function startPageCapture({ rrweb = globalThis.rrweb, emit, doc = globalThis.document, win = globalThis.window,
  sampling = { mousemove: 80, mouseInteraction: true, scroll: 150, input: 'last' }, selectionDelayMs = 60 } = {}) {
  if (typeof emit !== 'function') throw new TypeError('page capture requires emit(event)');
  const stops = [];
  const listen = (target, type, handler, options) => {
    target?.addEventListener?.(type, handler, options);
    stops.push(() => target?.removeEventListener?.(type, handler, options));
  };
  let lastMoveAt = 0;
  const interaction = (type, event, extra = {}) => emit('interaction', {
    action: type, at: Date.now(), target: targetInfo(event?.target),
    x: Number.isFinite(event?.clientX) ? event.clientX : null,
    y: Number.isFinite(event?.clientY) ? event.clientY : null,
    button: Number.isFinite(event?.button) ? event.button : null,
    buttons: Number.isFinite(event?.buttons) ? event.buttons : null,
    pointerType: event?.pointerType || null, key: extra.key || null,
    code: extra.code || null, modifiers: extra.modifiers || null,
    deltaX: extra.deltaX ?? null, deltaY: extra.deltaY ?? null,
    viewport: { width: win?.innerWidth || 0, height: win?.innerHeight || 0 },
  });
  const keyData = (event) => ({
    key: isPasswordEntry(event.target) && !TEXT_KEYS.has(event.key) ? '[password]' : String(event.key || '').slice(0, 40),
    code: String(event.code || '').slice(0, 40),
    modifiers: { alt: !!event.altKey, ctrl: !!event.ctrlKey, meta: !!event.metaKey, shift: !!event.shiftKey },
  });
  listen(doc, 'click', (event) => interaction('click', event), true);
  listen(doc, 'pointerdown', (event) => interaction('pointerdown', event), true);
  listen(doc, 'pointermove', (event) => {
    const now = performance.now();
    if (event.buttons || now - lastMoveAt >= 80) { lastMoveAt = now; interaction('pointermove', event); }
  }, true);
  listen(doc, 'pointerup', (event) => interaction('pointerup', event), true);
  listen(doc, 'wheel', (event) => interaction('wheel', event, { deltaX: event.deltaX, deltaY: event.deltaY }), { capture: true, passive: true });
  listen(doc, 'scroll', (event) => interaction('scroll', event), { capture: true, passive: true });
  listen(doc, 'keydown', (event) => interaction('keydown', event, keyData(event)), true);
  listen(doc, 'keyup', (event) => interaction('keyup', event, keyData(event)), true);
  listen(doc, 'focusin', (event) => interaction('focusin', event), true);
  listen(doc, 'focusout', (event) => interaction('focusout', event), true);

  let selectionTimer = 0;
  let previousSelection = '';
  let stopped = false;
  const publishSelection = () => {
    if (stopped) return;
    const snapshot = selectionSnapshot(doc, win);
    const signature = snapshot ? JSON.stringify(snapshot) : '';
    if (signature === previousSelection) return;
    previousSelection = signature;
    emit('selection', snapshot ? { operation: 'set', ...snapshot } : { operation: 'clear', text: '', rects: [], viewport: { width: win?.innerWidth || 0, height: win?.innerHeight || 0 } });
  };
  const scheduleSelection = () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(publishSelection, Math.max(0, selectionDelayMs));
  };
  listen(doc, 'selectionchange', scheduleSelection);

  const rrwebStop = rrweb?.record?.({
    emit: (event) => emit('rrweb', event), checkoutEveryNms: 30000, recordCanvas: false, sampling,
    maskAllInputs: false,
    maskInputOptions: { password: true },
    slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaDesc: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaAuthorship: true, headMetaVerification: true },
  });
  return () => {
    if (stopped) return;
    if (previousSelection) { emit('selection', { operation: 'clear', text: '', rects: [], viewport: { width: win?.innerWidth || 0, height: win?.innerHeight || 0 } }); previousSelection = ''; }
    stopped = true; clearTimeout(selectionTimer); rrwebStop?.();
    for (const stop of stops.splice(0)) stop();
  };
}
