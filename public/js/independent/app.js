// 卫戍协议：工坊 app shell: the display catalog (fetched once), the start page and the game screen. The session id
// lives in the address (?session=…), so a reload or a shared link resumes the same drill.
import { useCallback, useEffect, useState } from '../../vendor/hooks.module.js';
import { Fragment } from '../../vendor/preact.module.js';
import { html, Button, Panel, MicroLabel, Spinner, TextField } from '../ui/components.js';
import { GIcon } from '../ui/gameComponents.js';
import { SettingsModal } from '../ui/settings.js';
import { audio } from '../audio.js';
import { toast } from '../ui/toasts.js';
import { api } from './api.js';
import { GameScreen } from './game.js';
import { RecordingControls } from './recorder.js';

const cx = (...parts) => parts.flat().filter(Boolean).join(' ');

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
      if (!got.ok) { setFailure(got.error?.message || '无法载入工坊数据'); return; }
      setCatalog(got.catalog);
      const id = new URL(location.href).searchParams.get('session');
      if (!id) return;
      const loaded = await api.load(id);
      if (loaded.ok) { setSession({ id, state: loaded.state }); remember(id); }
      else { setSessionInUrl(null); toast(loaded.error?.message || '这一局不存在或已过期', 'warn'); }
    })();
  }, []);
  const start = useCallback(async (opts) => {
    const created = await api.create(opts);
    if (!created.ok) { toast(created.error?.message || '无法开始新的一局', 'warn'); return; }
    setSessionInUrl(created.id); remember(created.id);
    setSession({ id: created.id, state: created.state });
  }, []);
  const resume = useCallback(async (id) => {
    const loaded = await api.load(id);
    if (!loaded.ok) { toast(loaded.error?.message || '这一局不存在或已过期', 'warn'); return; }
    setSessionInUrl(id); setSession({ id, state: loaded.state });
  }, []);
  const leave = useCallback(() => { setSessionInUrl(null); setSession(null); }, []);

  if (failure) return html`<main class="ix-start"><${Panel} title="无法进入工坊" tone="danger"><p>${failure}</p></${Panel}></main>`;
  if (!catalog) return html`<main class="ix-start"><${Spinner} label="LOADING" /></main>`;
  return html`<${Fragment}>
    ${session ? html`<${GameScreen} key=${session.id} id=${session.id} initial=${session.state} catalog=${catalog} onLeave=${leave} />`
      : html`<${StartScreen} catalog=${catalog} onStart=${start} onResume=${resume} last=${lastSession()} />`}
    <${RecordingControls} sessionId=${session?.id || null} />
  <//>`;
}

const MODE_TEXT = {
  9: '九轮，较轻松。第4、8轮有工程部特供，第9轮迎战敌方领袖。',
  14: '十四轮。第4、8、12轮有工程部特供，第14轮迎战敌方领袖。',
  15: '打完标准局后，追加第15轮隐藏挑战。',
};

function StartScreen({ catalog, onStart, onResume, last }) {
  const [busy, setBusy] = useState(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => { audio.playBgm('lobby'); }, []);
  const [seed, setSeed] = useState('');
  const [growthMode, setGrowthMode] = useState('levels');
  const go = async (mode) => {
    if (busy) return;
    setBusy(mode.roundLimit);
    const typed = seed.trim();
    // no seed typed: a random one; a typed seed replays the same shops and waves
    const value = typed && Number.isFinite(Number(typed)) ? Math.trunc(Number(typed)) : Math.floor(Math.random() * 2 ** 31);
    try { await onStart({ seed: value, difficulty: mode.difficulty, roundLimit: mode.roundLimit, growthMode }); } finally { setBusy(null); }
  };
  return html`<main class="ix-start">
    <header class="ix-start__head">
      <${MicroLabel}>STRONGHOLD PROTOCOL · WORKSHOP<//>
      <h1>${catalog.name || '卫戍协议：工坊'}</h1>
      <p>每名干员都是一座小工坊：招募他们、打造徽章与装备、给主力穿满，守住每一轮防线。</p>
    </header>
    <div class="ix-start__modes">
      ${(catalog.modes || []).map((mode) => html`<button type="button" key=${mode.roundLimit} class="ix-mode" disabled=${!!busy} onClick=${() => go(mode)}>
        <b>${mode.name}</b>
        <span>${MODE_TEXT[mode.roundLimit] || ''}</span>
        ${busy === mode.roundLimit ? html`<${Spinner} />` : null}
      </button>`)}
    </div>
    <fieldset class="ix-growth-mode" aria-label="成长方案">
      <legend>成长方案</legend>
      <button type="button" role="radio" aria-checked=${growthMode === 'levels' ? 'true' : 'false'} class=${cx('ix-growth-mode__option', growthMode === 'levels' && 'is-on')} onClick=${() => setGrowthMode('levels')}>
        <b>等级成长</b><span>干员随等级提升属性</span>
      </button>
      <button type="button" role="radio" aria-checked=${growthMode === 'badges' ? 'true' : 'false'} class=${cx('ix-growth-mode__option', growthMode === 'badges' && 'is-on')} onClick=${() => setGrowthMode('badges')}>
        <b>徽章成长</b><span>以徽章强化干员</span>
      </button>
    </fieldset>
    <div class="ix-start__foot">
      <${TextField} class="ix-seed" label="对局编号（留空则随机）" value=${seed} onInput=${setSeed} placeholder="例如 20261006"
        maxLength=${10} transform=${(v) => v.replace(/[^0-9]/g, '')} />
      ${last ? html`<${Button} variant="secondary" onClick=${() => onResume(last)}>继续上一局<//>` : null}
      <a class="ix-start__back" href="./">返回卫戍协议</a>
    </div>
    <button type="button" class="gm__gear ix-start__gear" aria-label="设置" title="设置" onClick=${() => setSettings(true)}><${GIcon} name="gear" /></button>
    <${SettingsModal} open=${settings} onClose=${() => setSettings(false)} />
  </main>`;
}
