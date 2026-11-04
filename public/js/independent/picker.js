// 圈选元素 (user 2026-10-07: 「在左下角加一个圈选元素工具吧，方便诊断」): the corner button turns pick mode on; the
// element under the pointer is outlined and named, and a click copies a description of it to the clipboard — what it
// is, its text, where it sits on screen, its path in the page, the page and the session, and on the 3D field the
// piece under the pointer — then leaves pick mode. While picking, no press reaches the game. Esc or the button again
// cancels. The omnicompany picker cannot reach into the desktop WebView, so the page carries its own.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from '../ui/components.js';
import { toast } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Short name of an element: tag, id, the first classes and its test id. */
function nameOf(el) {
  if (!el || !el.tagName) return '';
  const cls = [...(el.classList || [])].slice(0, 3).map((c) => `.${c}`).join('');
  const testid = el.getAttribute?.('data-testid');
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}${testid ? `[data-testid="${testid}"]` : ''}`;
}

/** The text a developer needs to find the element again. */
function describe(el, view, x, y) {
  const r = el.getBoundingClientRect();
  const path = [];
  for (let p = el.parentElement; p && p !== document.body && path.length < 5; p = p.parentElement) path.unshift(nameOf(p));
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const style = getComputedStyle(el);
  const lines = [
    t('【圈选元素】{0}', { 0: nameOf(el) }),
    text ? t('文字：{text}', { text }) : null,
    t('位置：x {0} y {1} 宽 {2} 高 {3}（窗口 {innerWidth}×{innerHeight}）', { 0: Math.round(r.left), 1: Math.round(r.top), 2: Math.round(r.width), 3: Math.round(r.height), innerWidth, innerHeight }),
    t('字号：{fontSize}', { fontSize: style.fontSize }),
    path.length ? t('路径：{0}', { 0: path.join(' > ') }) : null,
    t('页面：{pathname}{search}', { pathname: location.pathname, search: location.search }),
  ];
  if (el.tagName === 'CANVAS' && view?.pieceAtClient) {
    const hit = view.pieceAtClient(x, y);
    lines.push(hit ? t('棋盘上：棋子 {uid}（{1}）', { uid: hit.uid, 1: hit.area || '' }) : t('棋盘上：指针下没有棋子'));
  }
  return lines.filter(Boolean).join('\n');
}

export function ElementPicker({ view }) {
  const [on, setOn] = useState(false);
  const [box, setBox] = useState(null);
  const viewRef = useRef(view); viewRef.current = view;
  useEffect(() => {
    if (!on) { setBox(null); return undefined; }
    const under = (e) => document.elementsFromPoint(e.clientX, e.clientY).find((x) => !x.closest('.ix-picker, .ix-picker__btn')) || null;
    const isButton = (e) => !!e.target?.closest?.('.ix-picker__btn');
    const move = (e) => {
      const el = under(e);
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      setBox({ x: r.left, y: r.top, w: r.width, h: r.height, label: nameOf(el) });
    };
    // the game never sees a press while picking (no drag, no selection, no buy)
    const block = (e) => { if (isButton(e)) return; e.preventDefault(); e.stopPropagation(); };
    const pick = async (e) => {
      if (isButton(e)) return;
      e.preventDefault(); e.stopPropagation();
      const el = under(e);
      setOn(false);
      if (!el) return;
      const text = describe(el, viewRef.current, e.clientX, e.clientY);
      const ok = await copyText(text);
      toast(ok ? t('已复制元素信息，直接粘贴给开发即可') : text, ok ? 'info' : 'warn', { ttl: 4000 });
    };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOn(false); } };
    const opts = { capture: true, passive: false };
    window.addEventListener('pointermove', move, true);
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu', 'dblclick']) window.addEventListener(t, block, opts);
    window.addEventListener('click', pick, opts);
    window.addEventListener('keydown', key, true);
    document.documentElement.classList.add('is-picking');
    return () => {
      window.removeEventListener('pointermove', move, true);
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu', 'dblclick']) window.removeEventListener(t, block, opts);
      window.removeEventListener('click', pick, opts);
      window.removeEventListener('keydown', key, true);
      document.documentElement.classList.remove('is-picking');
    };
  }, [on]);
  return html`
    <button type="button" class=${cx('gm__gear', 'ix-picker__btn', on && 'is-on')} aria-pressed=${on ? 'true' : 'false'}
      aria-label=${t('圈选元素')} title=${on ? t('点选要诊断的元素（Esc 取消）') : t('圈选元素：点选页面上的东西，复制它的信息')} data-testid="ix-picker"
      onClick=${() => setOn((v) => !v)}><${Icon} name="search" /></button>
    ${on && box ? html`<div class="ix-picker" aria-hidden="true" style=${`left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`}>
      <span class="ix-picker__label">${box.label}</span></div>` : null}`;
}
