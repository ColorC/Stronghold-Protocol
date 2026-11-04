import { t } from '../../shared/i18n.js';
// Admission happens before importing the game's module graph. Heartbeats count active visitors, not saved games.
const resonanceEntry = /(?:^|\/)resonance\.html$/.test(location.pathname);
// 共鸣 reads its own data copy (server/modes/resonance/data.js): set before the game's module graph loads public/js/data.js.
if (resonanceEntry) {
  globalThis.__SP_DATA_OVERRIDE__ = Object.freeze({ dir: '/data/resonance-native/', files: Object.freeze(['assets.json', 'bands.json',
    'bonds.json', 'bosses.json', 'chess.json', 'choices.json', 'config.json', 'effects.json', 'emotes.json', 'enemies.json',
    'factions.json', 'garrisons.json', 'items.json', 'stages.json', 'tokens.json', 'tuning.json', 'waves.json']) });
}
const endpoint = new URL(resonanceEntry ? 'resonance/api/admission' : 'independent/api/admission', location.href);
let timer;
let blocked;
function showBlocked(message) {
  if (!blocked) {
    blocked = document.createElement('div');
    blocked.setAttribute('role', 'alert');
    blocked.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;gap:1rem;padding:2rem;background:#101216ed;color:#eee;font-family:system-ui';
    const text = document.createElement('p');
    const button = document.createElement('button');
    button.textContent = t('重新尝试');
    button.onclick = () => location.reload();
    blocked.append(text, button); document.body.append(blocked);
  }
  blocked.firstChild.textContent = message;
}
async function renew() {
  clearTimeout(timer);
  try {
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (response.status === 202 && result.ok && result.queued) {
      blocked?.remove(); blocked = null;
      const { startHostingWait } = await import('./hostingWait.js');
      startHostingWait(result.queued);
      return false;
    }
    if (!response.ok || !result.ok) {
      showBlocked(result.error?.message || t('无法进入工坊，请稍后再试')); return false;
    }
    blocked?.remove(); blocked = null;
    if (result.lease.execution === 'client') {
      const url = new URL(location.href); url.searchParams.set('execution', 'client'); history.replaceState(null, '', url);
    }
    if (result.lease.enabled) timer = setTimeout(renew, result.lease.heartbeatMs);
    return true;
  } catch {
    showBlocked(t('连接中断，请检查网络后重试')); return false;
  }
}
if (await renew()) {
  await import(resonanceEntry ? './resonance/main.js' : './independent/main.js');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renew(); });
  window.addEventListener('online', renew);
}
