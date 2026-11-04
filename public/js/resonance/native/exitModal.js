import { useState } from '../../../vendor/hooks.module.js';
import { html, Button, Modal } from '../../ui/components.js';
import { net } from '../../net.js';
import { store, useStore } from '../../store.js';
import { toast } from '../../ui/toasts.js';
import { isPaused, pauseAvailable } from '../../ui/matchStatus.js';

/** Pause a running native battle before leaving the screen; never mutate or delete its saved session. */
export async function saveAndReturn({ needsPause, request, confirmPaused, onLeave }) {
  if (needsPause) {
    await request('g.pause', { on: true });
    if (!(await confirmPaused())) throw new Error('战斗尚未确认暂停，请稍后重试');
  }
  await onLeave?.();
}

function waitForPaused(timeoutMs = 1500) {
  if (store.get().match?.public?.paused) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let off = () => {};
    const finish = (paused) => {
      if (done) return;
      done = true;
      off();
      if (timer != null) clearTimeout(timer);
      resolve(paused);
    };
    off = store.subscribe((state) => {
      if (state.match?.public?.paused) finish(true);
    });
    timer = setTimeout(() => finish(!!store.get().match?.public?.paused), timeoutMs);
  });
}

/** Native Resonance exit: preserve the session and return to the title route. */
export function ResonanceExitModal({ open, onClose, onLeave }) {
  const [busy, setBusy] = useState(false);
  const pub = useStore((state) => state.match.public);
  const needsPause = pauseAvailable(pub, { solo: true, alive: true }) && !isPaused(pub);
  const close = () => { if (!busy) onClose?.(); };
  const leave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveAndReturn({
        needsPause,
        request: (type, payload) => net.request(type, payload),
        confirmPaused: waitForPaused,
        onLeave,
      });
    } catch (error) {
      toast(error?.message || '无法暂停战斗，当前页面仍保持打开', 'error');
    } finally {
      setBusy(false);
    }
  };

  return html`<${Modal} open=${open} onClose=${close} closeOnBackdrop=${!busy} tone="red" title="返回首页" micro="保存并离开本局" width="6.8rem"
    actions=${html`
      <${Button} variant="secondary" disabled=${busy} onClick=${close}>取消<//>
      <${Button} variant="primary" icon="exit" loading=${busy} onClick=${leave}>保存并返回<//>`}>
    <div class="exitm">
      <p>本局进度会保留，可从首页继续。</p>
      ${needsPause ? html`<p class="t-lo">返回前会先暂停当前战斗；未确认暂停时会留在本局。</p>` : null}
    </div>
  <//>`;
}
