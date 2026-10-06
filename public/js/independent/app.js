// 罗德岛战备演习 app shell: the display catalog (fetched once), the start page and the game screen. The session id
// lives in the address (?session=…), so a reload or a shared link resumes the same drill.
import { useCallback, useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Panel, MicroLabel, Spinner, TextField } from '../ui/components.js';
import { toast } from '../ui/toasts.js';
import { api } from './api.js';
import { GameScreen } from './game.js';

const LAST_KEY = 'ix:lastSession';
const remember = (id) => { try { localStorage.setItem(LAST_KEY, id); } catch { /* private mode */ } };
const lastSession = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };

function setSessionInUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('session', id); else url.searchParams.delete('session');
  history.replaceState(null, '', url);
}

export function App() {
  const [catalog, setCatalog] = useState(null);
  const [session, setSession] = useState(null); // { id, state }
  const [failure, setFailure] = useState('');
  useEffect(() => {
    (async () => {
      const got = await api.catalog();
      if (!got.ok) { setFailure(got.error?.message || '无法载入演习目录'); return; }
      setCatalog(got.catalog);
      const id = new URL(location.href).searchParams.get('session');
      if (!id) return;
      const loaded = await api.load(id);
      if (loaded.ok) { setSession({ id, state: loaded.state }); remember(id); }
      else { setSessionInUrl(null); toast(loaded.error?.message || '演习未找到', 'warn'); }
    })();
  }, []);
  const start = useCallback(async (opts) => {
    const created = await api.create(opts);
    if (!created.ok) { toast(created.error?.message || '无法创建演习', 'warn'); return; }
    setSessionInUrl(created.id); remember(created.id);
    setSession({ id: created.id, state: created.state });
  }, []);
  const resume = useCallback(async (id) => {
    const loaded = await api.load(id);
    if (!loaded.ok) { toast(loaded.error?.message || '演习未找到', 'warn'); return; }
    setSessionInUrl(id); setSession({ id, state: loaded.state });
  }, []);
  const leave = useCallback(() => { setSessionInUrl(null); setSession(null); }, []);

  if (failure) return html`<main class="ix-start"><${Panel} title="无法进入演习" tone="danger"><p>${failure}</p></${Panel}></main>`;
  if (!catalog) return html`<main class="ix-start"><${Spinner} label="LOADING" /></main>`;
  if (session) return html`<${GameScreen} key=${session.id} id=${session.id} initial=${session.state} catalog=${catalog} onLeave=${leave} />`;
  return html`<${StartScreen} catalog=${catalog} onStart=${start} onResume=${resume} last=${lastSession()} />`;
}

const MODE_TEXT = {
  9: '九轮，难度较低。第 4、8 轮发放暗月奖品，第 9 轮迎战敌方领袖。',
  14: '十四轮标准难度。第 4、8、12 轮发放暗月奖品，第 14 轮迎战敌方领袖。',
  15: '在完整演习之后追加第 15 轮隐藏挑战。',
};

function StartScreen({ catalog, onStart, onResume, last }) {
  const [busy, setBusy] = useState(null);
  const [seed, setSeed] = useState('');
  const go = async (mode) => {
    if (busy) return;
    setBusy(mode.roundLimit);
    const typed = seed.trim();
    // no seed typed: a random one; a typed seed replays the same shops and waves
    const value = typed && Number.isFinite(Number(typed)) ? Math.trunc(Number(typed)) : Math.floor(Math.random() * 2 ** 31);
    try { await onStart({ seed: value, difficulty: mode.difficulty, roundLimit: mode.roundLimit }); } finally { setBusy(null); }
  };
  return html`<main class="ix-start">
    <header class="ix-start__head">
      <${MicroLabel}>RHODES ISLAND · INDEPENDENT DRILL<//>
      <h1>${catalog.name || '罗德岛战备演习'}</h1>
      <p>招募干员、锻造徽章、穿戴装备，逐轮守住防线。</p>
    </header>
    <div class="ix-start__modes">
      ${(catalog.modes || []).map((mode) => html`<button type="button" key=${mode.roundLimit} class="ix-mode" disabled=${!!busy} onClick=${() => go(mode)}>
        <b>${mode.name}</b>
        <span>${MODE_TEXT[mode.roundLimit] || ''}</span>
        ${busy === mode.roundLimit ? html`<${Spinner} />` : null}
      </button>`)}
    </div>
    <div class="ix-start__foot">
      <${TextField} class="ix-seed" label="演习编号（留空则随机）" value=${seed} onInput=${setSeed} placeholder="例如 20261006"
        maxLength=${10} transform=${(v) => v.replace(/[^0-9]/g, '')} />
      ${last ? html`<${Button} variant="secondary" onClick=${() => onResume(last)}>继续上次演习<//>` : null}
      <a class="ix-start__back" href="./">返回卫戍协议</a>
    </div>
  </main>`;
}
