import { useCallback, useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Panel, Spinner, MicroLabel, Icon, Modal } from '../ui/components.js';
import { installDeviceSupport } from '../ui/device.js';
import { data, useData } from '../data.js';
import { installAudio, audio } from '../audio.js';
import { assets } from '../assets.js';
import { TitleScreen } from '../screens/title.js';
import { DifficultyCard } from '../screens/lobby.js';
import { StepHeader } from '../ui/matchChrome.js';
import { chessPortraitUrl, uiUrl } from '../ui/assetUrls.js';
import { GameScreen } from './game.js';
import { resonanceApi } from './api.js';
import { PactIcon } from './pactIcon.js';
import { parseDetailHash, actionErrorText } from './model.js';
import { DetailPanel } from './detail.js';
import { CodexScreen } from './codex.js';

const LAST = 'rs:lastSession';
const DIFFICULTIES = [
  ['FUNNY', '轻松', '间歇战斗，后勤节点补充金币与经验'],
  ['NORMAL', '标准', '标准经营节奏与最终领袖战'],
  ['HARD', '困难', '更强敌人与更紧的经营压力'],
  ['ABYSS', '深渊', '标准终战后继续挑战'],
];
const readLast = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
const difficultyName = (id) => DIFFICULTIES.find(([key]) => key === id)?.[1] || '标准';
const difficultyArtKey = Object.freeze({ FUNNY: 'funny', NORMAL: 'normal', HARD: 'hard', ABYSS: 'abyss' });
function difficultyCampaignSummary(campaign, id) {
  const schedule = campaign?.nodeSchedule?.[id] || {};
  const nodes = Number(schedule.nodes) || 0;
  const rhythm = id === 'FUNNY'
    ? `共${nodes}个节点，${schedule.battleCount || Math.floor(nodes / 2)}场战斗；间隔节点补充${schedule.oddNodeGold ?? 0}金币与${schedule.oddNodeXp ?? 0}经验`
    : id === 'ABYSS'
      ? `共${nodes}个节点；第${schedule.baseBossNode || 28}节点领袖战后，继续挑战精英与隐藏领袖`
      : `共${nodes}个节点，第${schedule.bossNode || nodes}节点迎战最终领袖`;
  const profile = campaign?.enemyBalance?.byDifficulty?.[id]?.regular || campaign?.enemyBalance?.regular;
  const terminal = campaign?.enemyBalance?.byDifficulty?.[id]?.terminal || campaign?.enemyBalance?.terminal;
  const percent = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : null;
  const regularText = profile ? `常规敌人：生命${percent(profile.hpMultiplier)} · 攻击${percent(profile.atkMultiplier)} · 防御${percent(profile.defMultiplier)}` : '';
  const terminalText = terminal && (terminal.hpMultiplier !== profile?.hpMultiplier || terminal.atkMultiplier !== profile?.atkMultiplier || terminal.defMultiplier !== profile?.defMultiplier)
    ? `领袖：生命${percent(terminal.hpMultiplier)} · 攻击${percent(terminal.atkMultiplier)} · 防御${percent(terminal.defMultiplier)}` : '';
  return { rhythm, regularText, terminalText };
}
function sessionUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('session', id);
  else url.searchParams.delete('session');
  url.searchParams.delete('view');
  url.searchParams.delete('step');
  history.replaceState(null, '', url);
}
function representativeFor(environment, catalog, activeIds) {
  const pactId = environment?.identityPactId;
  if (!pactId) return null;
  return activeIds.map((id) => catalog.operators?.[id]).find((operator) => operator?.pacts?.includes(pactId)) || null;
}
function EnvironmentPortrait({ environment, catalog, activeIds }) {
  const operator = representativeFor(environment, catalog, activeIds);
  const src = operator ? chessPortraitUrl(data.get('assets'), { charId: operator.charId }) : null;
  const pact = catalog.pacts?.[environment?.identityPactId];
  return html`<div class="rs-env-portrait" aria-label=${operator ? `${operator.name}代表本环境` : '本环境盟约'}>
    ${src ? html`<img class="rs-env-portrait__operator" src=${src} alt=${operator.name} draggable="false"/>` : null}
    <div class="rs-env-portrait__identity">
      ${pact ? html`<${PactIcon} catalog=${catalog} id=${environment.identityPactId} size="sm"/>` : null}
      <span>${pact?.name || '环境盟约'}</span>
    </div>
  </div>`;
}
function FlowHeader({ step, title, difficulty, onBack, onGuide }) {
  return html`<div class="rs-flow__header">
    <${StepHeader} step=${step} of=${3} title=${title} micro="卫戍协议 · 共鸣" pub=${{ difficulty }} onExit=${onBack} onGuide=${onGuide}/>
    <a class="rs-fullscreen" href=${location.href} target="_blank" rel="noopener">全屏打开</a>
  </div>`;
}
function PactSummary({ pact, catalog, id, description, onOpen }) {
  if (!pact) return html`<p class="t-dim">本环境暂无额外盟约说明。</p>`;
  return html`<article class="rs-brief-pact">
    <div class="rs-brief-pact__head">
      <${PactIcon} catalog=${catalog} id=${id} size="lg"/>
      <div><${MicroLabel} tone="mint">本局主盟约</${MicroLabel}><h3>${pact.name}</h3></div>
      <button type="button" class="rs-brief-pact__open" onClick=${onOpen}>查看盟约</button>
    </div>
    <p>${description || pact.description || '查看盟约详情了解效果。'}</p>
  </article>`;
}
export function App() {
  const openedSession = useRef('');
  useData('bonds', 'assets');
  const query = new URL(location.href).searchParams;
  const stepName = query.get('step');
  const stepFromUrl = stepName === 'difficulty' ? 1 : stepName === 'environment' ? 2 : stepName === 'briefing' ? 3 : 0;
  const [catalog, setCatalog] = useState(null);
  const [activeIds, setActiveIds] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [seed, setSeed] = useState(String(Math.floor(Math.random() * 2 ** 31)));
  const [env, setEnv] = useState(query.get('environment') || '');
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.some(([id]) => id === query.get('difficulty')) ? query.get('difficulty') : 'NORMAL');
  const [step, setStep] = useState(() => query.has('session') ? 0 : stepFromUrl);
  const [session, setSession] = useState(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [codex, setCodex] = useState(false);
  const [codexTab, setCodexTab] = useState('operators');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [catalogKey, setCatalogKey] = useState('');
  const numericSeed = Number(seed);
  const seedValid = /^\d+$/.test(seed) && Number.isSafeInteger(numericSeed) && numericSeed >= 0 && numericSeed <= 0xffffffff;

  useEffect(() => {
    installDeviceSupport();
    installAudio({ getManifest: () => data.get('assets') });
    audio.playBgm('lobby');
    const styles = ['./css/resonance-entry.css', './css/resonance-detail.css', './css/screens/title.css', './css/screens/lobby.css', './css/screens/briefing.css', './css/screens/draft.css', './css/screens/loadout.css'];
    const links = styles.map((href) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.append(link);
      return link;
    });
    return () => links.forEach((link) => link.remove());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!seedValid) { setCatalogKey(''); return; }
      const requestedSeed = numericSeed;
      const response = await resonanceApi.catalog(requestedSeed, env || undefined);
      if (!alive) return;
      if (!response.ok || !response.catalog?.operators || !Array.isArray(response.activeOperatorIds)) {
        setFailure(actionErrorText(response.error || { code: 'BAD_RESPONSE' }));
        return;
      }
      const next = { ...response.catalog, activeOperatorIds: response.activeOperatorIds };
      const choices = (response.environmentChoices || []).filter((id) => next.environments?.[id]);
      setCatalog(next);
      setActiveIds(response.activeOperatorIds);
      setEnvironments(choices);
      if (!env && choices[0]) { setEnv(choices[0]); return; }
      if (env && !choices.includes(env)) { setEnv(choices[0] || ''); return; }
      setCatalogKey(`${requestedSeed}:${env || choices[0] || ''}`);
      const url = new URL(location.href);
      const sessionId = url.searchParams.get('session');
      if (sessionId && openedSession.current !== sessionId) {
        const loaded = await resonanceApi.load(sessionId);
        if (!alive) return;
        if (loaded.ok && loaded.state) {
          openedSession.current = sessionId;
          setSession({ id: sessionId, state: loaded.state, catalog: loaded.catalog || next });
          try { localStorage.setItem(LAST, sessionId); } catch { /* storage is optional */ }
        } else setFailure(actionErrorText(loaded.error || { code: 'BAD_SESSION' }));
      } else if (url.searchParams.get('view') === 'codex') setCodex(true);
    })().catch(() => { if (alive) setFailure('数据载入失败，请检查网络后重试'); });
    return () => { alive = false; };
  }, [seed, env]);

  useEffect(() => {
    if (session || codex) return;
    const url = new URL(location.href);
    if (url.searchParams.get('view') === 'codex') return;
    url.searchParams.delete('view');
    const names = { 1: 'difficulty', 2: 'environment', 3: 'briefing' };
    if (names[step]) url.searchParams.set('step', names[step]);
    else url.searchParams.delete('step');
    url.searchParams.set('difficulty', difficulty);
    if (env) url.searchParams.set('environment', env);
    else url.searchParams.delete('environment');
    history.replaceState(null, '', url);
  }, [step, difficulty, env, session, codex]);

  useEffect(() => {
    const open = () => {
      const target = parseDetailHash(location.hash);
      if (!target) return;
      if (['operator', 'pact', 'item', 'recipe', 'strategy', 'environment'].includes(target.kind)) setDetail(target);
      else if (target.kind === 'section') {
        setCodex(true);
        requestAnimationFrame(() => document.getElementById(`rs-section-${target.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }));
      }
    };
    open();
    addEventListener('hashchange', open);
    return () => removeEventListener('hashchange', open);
  }, [catalog, session]);

  const start = useCallback(async () => {
    if (!seedValid || !env || step !== 3 || !catalog?.environments?.[env] || catalogKey !== `${numericSeed}:${env}`) return;
    setBusy(true);
    try {
      await assets.ready();
      const response = await resonanceApi.create({ seed: numericSeed, difficulty, environmentId: env });
      if (!response.ok || !response.id || !response.state) {
        setFailure(actionErrorText(response.error || { code: 'BAD_RESPONSE' }));
        return;
      }
      const next = response.catalog || catalog;
      if (!next?.operators) { setFailure('共鸣数据暂时无法读取，请重新载入'); return; }
      setSession({ id: response.id, state: response.state, catalog: next });
      sessionUrl(response.id);
      try { localStorage.setItem(LAST, response.id); } catch { /* storage is optional */ }
    } catch { setFailure('连接中断，请检查网络后重试'); }
    finally { setBusy(false); }
  }, [env, seed, numericSeed, seedValid, difficulty, catalog, step, catalogKey]);

  const resume = async (id) => {
    if (!id) return;
    setBusy(true);
    try {
      const response = await resonanceApi.load(id);
      if (!response.ok || !response.state) throw new Error(actionErrorText(response.error || { code: 'BAD_SESSION' }));
      openedSession.current = id;
      setSession({ id, state: response.state, catalog: response.catalog || catalog });
      sessionUrl(id);
    } catch (error) { setFailure(error.message || '存档内容无法读取，请重新载入'); }
    finally { setBusy(false); }
  };

  if (failure) return html`<main class="rs-start"><${Panel} title="暂时无法进入共鸣"><p>${failure}</p><${Button} onClick=${() => { setFailure(''); location.reload(); }}>重新载入<//></${Panel}></main>`;
  if (session?.catalog) return html`<${GameScreen} key=${session.id} id=${session.id} initial=${session.state} catalog=${session.catalog} onLeave=${() => {
    sessionUrl(null);
    const url = new URL(location.href); url.hash = ''; history.replaceState(null, '', url);
    setDetail(null); setSession(null); setStep(0);
  }}/> `;
  if (!catalog || (query.has('session') && !session && !failure && openedSession.current !== query.get('session'))) return html`<main class="rs-start"><${Spinner} label="载入共鸣"/></main>`;
  if (codex) return html`<${CodexScreen} catalog=${catalog} activeIds=${activeIds}
    initialTab=${codexTab}
    overlayDetail=${html`<${DetailPanel} detail=${detail} catalog=${catalog} onDetail=${setDetail} onClose=${() => setDetail(null)}/>`}
    onBack=${() => { setCodex(false); setCodexTab('operators'); setDetail(null); const url = new URL(location.href); url.searchParams.delete('view'); url.hash = ''; history.replaceState(null, '', url); }} onDetail=${setDetail}/>`;

  const selected = catalog.environments?.[env];
  const selectedPact = catalog.pacts?.[selected?.identityPactId];
  const catalogReady = seedValid && catalogKey === `${numericSeed}:${env}` && !!selected;
  const difficultyArt = uiUrl(data.get('assets'), `modeChoice/${difficultyArtKey[difficulty] || 'normal'}_rhodes_island`);
  const difficultySummary = difficultyCampaignSummary(catalog.campaign, difficulty);
  const showCodex = (tab) => { setCodexTab(tab); setCodex(true); const url = new URL(location.href); url.searchParams.set('view', 'codex'); history.replaceState(null, '', url); };
  const openCodex = () => showCodex('operators');
  const openEconomyGuide = () => showCodex('economy');
  const titleActions = [
    { label: '开始整备', primary: true, onClick: () => setStep(1) },
    { label: '战术图鉴', onClick: openCodex },
    ...(readLast() ? [{ label: busy ? '正在载入…' : '继续上一局', onClick: () => resume(readLast()) }] : []),
  ];
  const detailButton = (id) => () => setDetail({ kind: 'pact', id });

  return html`<main class="rs-entry">
    ${step === 0 ? html`<${TitleScreen} presentation=${{
      name: '卫戍协议：共鸣', englishName: 'STRONGHOLD PROTOCOL · RESONANCE',
      description: '组建干员阵容，经营战场资源，在变化的环境中守住防线。', actions: titleActions,
    }}/><a class="rs-title-fullscreen" href=${location.href} target="_blank" rel="noopener">全屏打开</a>`
      : step === 1 ? html`<div class="screen lobby-screen rs-flow rs-flow--difficulty"><div class="brief__bg" aria-hidden="true"></div>
        <${FlowHeader} step=${1} title="选择难度" difficulty=${difficulty} onBack=${() => setStep(0)} onGuide=${openEconomyGuide}/>
        <div class="lobby-body screen__scroll">
          <section class="lobby-left"><div class="section-label"><span class="section-label__idx num">01</span>当前挑战<${MicroLabel}>DIFFICULTY<//></div>
            <article class="rs-difficulty-feature brackets">
              ${difficultyArt ? html`<div class="rs-difficulty-feature__art"><img src=${difficultyArt} alt="" draggable="false"/></div>` : null}
              <div class="rs-difficulty-feature__content"><${MicroLabel} tone="mint">已选难度</${MicroLabel}><h2>${difficultyName(difficulty)}</h2>
                <p>${DIFFICULTIES.find(([id]) => id === difficulty)?.[2]}</p>
                <div class="rs-difficulty-feature__schedule"><b>本局节奏</b><span>${difficultySummary.rhythm}</span></div>
                ${difficultySummary.regularText ? html`<p class="rs-difficulty-feature__pressure">${difficultySummary.regularText}</p>` : null}
                ${difficultySummary.terminalText ? html`<p class="rs-difficulty-feature__pressure">${difficultySummary.terminalText}</p>` : null}
                <${Button} class="rs-difficulty-feature__next" variant="primary" size="lg" block=${true} iconRight="chevrons" onClick=${() => setStep(2)}>选择战场</${Button}>
              </div>
            </article>
          </section>
          <section class="lobby-right"><div class="section-label"><span class="section-label__idx num">02</span>选择难度<${MicroLabel}>CHOOSE<//></div>
            <div class="diff-list">${DIFFICULTIES.map(([id, name, description]) => html`<${DifficultyCard} key=${id} roomMode="solo" difficulty=${id}
              selected=${difficulty === id} onSelect=${setDifficulty} presentation=${{ name, description }}/>` )}</div>
          </section>
        </div></div>`
      : step === 2 ? html`<div class="screen draft rs-flow rs-flow--environment"><div class="brief__bg" aria-hidden="true"></div>
        <${FlowHeader} step=${2} title="选择战场" difficulty=${difficulty} onBack=${() => setStep(1)} onGuide=${openEconomyGuide}/>
        <main class="draft__main">
          <aside class="draft-order"><h3 class="brief-h"><span>本局安排</span><${MicroLabel}>DEPLOYMENT<//></h3>
            <article class="dorder is-done"><span class="dorder__idx num">01</span><div class="dorder__text"><b class="dorder__name">难度</b><span class="dorder__state">${difficultyName(difficulty)}</span></div></article>
            <article class="dorder is-cur is-self"><span class="dorder__idx num">02</span><div class="dorder__text"><b class="dorder__name">战场</b><span class="dorder__state">${selected?.name || '等待选择'}</span></div></article>
            <button class="draft-order__info btn btn--secondary" onClick=${openCodex}><${Icon} name="book"/>浏览全部环境</button>
          </aside>
          <section class="draft-grid" role="listbox" aria-label="本局推荐战场">${environments.slice(0, 3).map((id) => {
            const item = catalog.environments[id];
            const pact = catalog.pacts?.[item?.identityPactId];
            const operator = representativeFor(item, catalog, activeIds);
            const portrait = operator ? chessPortraitUrl(data.get('assets'), { charId: operator.charId }) : null;
            return item ? html`<button type="button" role="option" aria-selected=${env === id ? 'true' : 'false'}
              class=${`dband rs-env-card${env === id ? ' is-sel' : ''}`} onClick=${() => setEnv(id)}>
              <span class="rs-env-card__identity">${pact ? html`<${PactIcon} catalog=${catalog} id=${item.identityPactId} size="sm"/>` : null}<span>${pact?.name || '战场盟约'}</span></span>
              ${portrait ? html`<img class="rs-env-card__portrait" src=${portrait} alt=${operator.name} draggable="false"/>` : null}
              <span class="dband__name">${item.name}</span><p class="rs-env-card__summary">${item.description || '选择此环境查看本局盟约。'}</p>
            </button>` : null;
          })}</section>
          <aside class="draft-detail brackets">${selected ? html`<${EnvironmentPortrait} environment=${selected} catalog=${catalog} activeIds=${activeIds}/>
            <div class="draft-detail__hp"><span>推荐战场</span><${MicroLabel}>ENVIRONMENT<//></div>
            <h2 class="draft-detail__name">${selected.name}</h2>
            <div class="draft-detail__eff"><${MicroLabel} tone="mint">环境规则</${MicroLabel}><p class="draft-detail__desc">${selected.description || '本环境暂无额外说明。'}</p>
              ${selectedPact ? html`<button class="rs-flow__pact" onClick=${detailButton(selected.identityPactId)}>主盟约 · ${selectedPact.name}</button>` : null}</div>`
            : html`<p class="t-dim">选择战场查看规则</p>`}
            <div class="draft-detail__actions"><div class="draft-detail__btns"><${Button} variant="secondary" onClick=${() => setStep(1)}>返回难度<//>
              <${Button} variant="primary" icon="check" disabled=${!selected} onClick=${() => setStep(3)}>查看本局简报<//></div></div>
          </aside>
        </main></div>`
      : html`<div class="screen brief rs-flow rs-flow--briefing"><div class="brief__bg" aria-hidden="true"></div>
        <${FlowHeader} step=${3} title="确认本局信息" difficulty=${difficulty} onBack=${() => setStep(2)} onGuide=${openEconomyGuide}/>
        <main class="brief__main">
          <section class="brief__left">
            <div class="brief-stage"><span class="brief-stage__k"><${MicroLabel}>战场环境<//></span>
              <span class="brief-stage__name"><${Icon} name="rook"/>${selected?.name || '请选择战场'}</span></div>
            <div class="rs-brief-identity">${selected ? html`<${EnvironmentPortrait} environment=${selected} catalog=${catalog} activeIds=${activeIds}/>` : null}
              <div><${MicroLabel} tone="mint">本局难度</${MicroLabel}><h2>${difficultyName(difficulty)}</h2>
                <p>${DIFFICULTIES.find(([id]) => id === difficulty)?.[2]}</p></div></div>
            <${PactSummary} pact=${selectedPact} catalog=${catalog} id=${selected?.identityPactId} description=${selectedPact?.description} onOpen=${detailButton(selected?.identityPactId)}/>
            <button class="rs-advanced" onClick=${() => setAdvancedOpen(true)}><${Icon} name="gear"/>高级设置</button>
          </section>
          <section class="brief__right"><div class="rs-brief-prep brackets">
            <div class="rs-brief-prep__head"><h2>开局整备</h2><${MicroLabel}>本局可用阵容</${MicroLabel}></div>
            <p class="rs-brief-prep__roster">招募池中有 <b class="num">${activeIds.length}</b> 名干员</p>
            <div class="rs-brief-prep__resources"><span>开局资源</span><b>${catalog.campaign?.opening?.gold ?? '—'}<small>金币</small></b>
              <b>${catalog.campaign?.opening?.level ?? '—'}<small>科技</small></b><b>${catalog.campaign?.opening?.population ?? '—'}<small>人口</small></b></div>
            <p class="rs-brief-prep__hint">确认后进入本局，完整干员与战术资料可随时从图鉴查看。</p>
            <${Button} variant="secondary" icon="book" onClick=${openCodex}>打开战术图鉴<//>
          </div></section>
        </main>
        <footer class="brief__foot"><${Button} variant="secondary" onClick=${() => setStep(2)}>返回战场<//>
          <${Button} variant="primary" size="xl" icon="play" disabled=${busy || !catalogReady} loading=${busy} onClick=${start}>确认并开始本局<//></footer>
        <${Modal} open=${advancedOpen} title="高级设置" micro="本局选项" onClose=${() => setAdvancedOpen(false)}
          actions=${html`<${Button} variant="primary" onClick=${() => setAdvancedOpen(false)}>完成<//>`}>
          <label class="rs-seed-field">对局种子<input inputMode="numeric" value=${seed} onInput=${(event) => setSeed(event.currentTarget.value.replace(/\D/g, '').slice(0, 10))}/></label>
          ${!seedValid ? html`<p>请输入 0 至 4294967295 之间的整数种子。</p>` : !catalogReady ? html`<p>正在更新当前战场数据；更新完成后即可确认。</p>` : null}
        </${Modal}>
      </div>`}
    <${DetailPanel} detail=${detail} catalog=${catalog} state=${null} onDetail=${setDetail} onClose=${() => setDetail(null)}/>
  </main>`;
}
