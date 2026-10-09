export function createAdmissionEndpoint(locationLike = location) {
  const resonanceEntry = /(?:^|\/)resonance\.html$/.test(locationLike.pathname);
  return new URL(resonanceEntry ? 'resonance/api/admission' : 'independent/api/admission', locationLike.href);
}

const resonanceEntry = /(?:^|\/)resonance\.html$/.test(location.pathname);
const productName = resonanceEntry ? '共鸣' : '工坊';
const endpoint = createAdmissionEndpoint(location);
let started = false;
let cancelled = false;
let currentPoll = null;
let lastWake = 0;

export function duplicatePollDelayMs(queued) {
  const requested = Number(queued?.retryAfterMs);
  return Number.isFinite(requested) && requested > 0 ? Math.max(5000, Math.min(25000, Math.floor(requested))) : 0;
}

function render(initial = {}) {
  let main = document.querySelector('#hosting-wait') || document.querySelector('#queue-position')?.closest('main');
  if (!main) {
    main = document.createElement('main');
    main.setAttribute('role', 'status');
    main.style.cssText = 'max-width:32rem;padding:2rem;text-align:center';
    main.innerHTML = `<h1>稍等片刻</h1><p>${productName}正在为你留位，空位一到会自动进入。</p><p id="queue-position" aria-live="polite"></p><button id="copy-link" type="button">复制等待页链接</button> <button id="cancel-wait" type="button">取消等待</button><p id="queue-status" aria-live="polite"></p>`;
    const app = document.querySelector('#app') || document.body;
    app.replaceChildren(main);
    if (app === document.body) document.body.style.cssText = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#101216;color:#eee;font:16px system-ui';
  }
  main.id = 'hosting-wait';
  if (!main.dataset.waitBound) {
    main.dataset.waitBound = 'true';
    main.querySelector('#copy-link')?.addEventListener('click', async () => {
      const status = main.querySelector('#queue-status');
      try { await navigator.clipboard.writeText(location.href); status.textContent = '等待页链接已复制。'; }
      catch { status.textContent = '无法复制链接，请检查浏览器权限。'; }
    });
    main.querySelector('#cancel-wait')?.addEventListener('click', async () => {
      cancelled = true;
      currentPoll?.abort();
      try { await fetch(endpoint, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' }); }
      catch { /* leaving the page still lets the waiting lease expire naturally */ }
      main.querySelector('#queue-status').textContent = '已取消等待。';
      main.querySelector('#cancel-wait').disabled = true;
    });
  }
  updatePosition(initial.position);
  return main;
}

function updatePosition(position) {
  const label = document.querySelector('#queue-position');
  if (!label || !Number.isInteger(position) || position < 1) return;
  label.textContent = position === 1 ? '现在排在最前面' : `前面还有 ${position - 1} 位`;
}

function setStatus(message) {
  const status = document.querySelector('#queue-status');
  if (status) status.textContent = message;
}

function wakePoll() {
  const now = Date.now();
  if (now - lastWake < 5000) return;
  lastWake = now;
  currentPoll?.abort();
}

async function runQueue() {
  while (!cancelled) {
    if (!navigator.onLine) {
      setStatus('网络暂时不可用，恢复连接后会继续等待。');
      await new Promise((resolve) => window.addEventListener('online', resolve, { once: true }));
      continue;
    }
    const controller = new AbortController();
    currentPoll = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${endpoint.href}?wait=1`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const result = await response.json();
      if (response.status === 202 && result.ok && result.queued) {
        updatePosition(result.queued.position);
        setStatus(`${productName}空位一到会自动进入。`);
        const retryDelay = duplicatePollDelayMs(result.queued);
        if (retryDelay) await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }
      if (response.ok && result.ok && result.lease) {
        setStatus(`轮到你了，正在进入${productName}…`);
        const next = new URL(location.href);
        if (result.lease.execution === 'client') next.searchParams.set('execution', 'client');
        location.replace(next.href);
        return;
      }
      if (response.status === 410) {
        setStatus(result.error?.message || '等待已结束。请重新尝试。');
        const retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = '重新排队'; retry.onclick = () => location.reload();
        document.querySelector('#hosting-wait')?.append(retry);
        return;
      }
      setStatus(result.error?.message || '暂时无法更新排位，将自动重试。');
      await new Promise((resolve) => setTimeout(resolve, 30000));
    } catch {
      if (cancelled) return;
      setStatus(navigator.onLine ? '连接暂时中断，将继续尝试。' : '网络暂时不可用，恢复连接后会继续等待。');
      if (controller.signal.aborted) continue;
      if (navigator.onLine) await new Promise((resolve) => setTimeout(resolve, 30000));
    } finally {
      clearTimeout(timeout);
      if (currentPoll === controller) currentPoll = null;
    }
  }
}

export function startHostingWait(initial = {}) {
  render(initial);
  if (started) return;
  started = true;
  window.addEventListener('online', wakePoll);
  window.addEventListener('focus', wakePoll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wakePoll(); });
  void runQueue();
}

if (document.querySelector('#queue-position')) startHostingWait();
