import { useCallback, useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Panel, Spinner, MicroLabel, Icon, Modal } from '../ui/components.js';
import { installDeviceSupport } from '../ui/device.js';
import { data, useData } from '../data.js';
import { installAudio, audio } from '../audio.js';
import { assets } from '../assets.js';
import { TitleScreen } from '../screens/title.js';
import { DifficultyCard } from '../screens/lobby.js';
import { StepHeader } from '../ui/matchChrome.js';
import { uiUrl } from '../ui/assetUrls.js';
import { GameScreen } from './game.js';
import { resonanceApi } from './api.js';
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
function briefingRoute(campaign, difficulty) {
  const schedule = campaign?.nodeSchedule?.[difficulty] || {};
  const supplyNodes = campaign?.supply?.components?.nodes || [];
  const leaderNodes = [schedule.bossNode, schedule.baseBossNode, schedule.eliteNode, schedule.hiddenBossNode].filter(Number.isFinite);
  const nodes = [...new Set([1, 2, 3, ...(campaign?.strategyNodes?.slice(0, 3) || []), ...supplyNodes.slice(0, 2), ...leaderNodes])].filter((node) => node > 0 && node <= (schedule.nodes || Infinity)).sort((a, b) => a - b);
  return nodes.map((node) => {
    const leader = node === schedule.bossNode ? '最终领袖'
      : node === schedule.baseBossNode ? '领袖战'
        : node === schedule.eliteNode ? '精英战'
          : node === schedule.hiddenBossNode ? '隐藏领袖' : '';
    const component = supplyNodes.includes(node);
    const funnySupply = difficulty === 'FUNNY' && schedule.battleOnEvenNodes && node % 2 === 1;
    const strategy = campaign?.strategyNodes?.includes(node);
    const kind = [leader, component && '组件补给', strategy && '策略选择', funnySupply && '后勤'].filter(Boolean).join(' · ') || '节点推进';
    const detail = [component && `从${campaign.supply?.components?.optionCount ?? 3}项中选择${campaign.supply?.components?.countPerNode ?? 1}件组件`,
      funnySupply && `获得${schedule.oddNodeGold ?? 0}金币与${schedule.oddNodeXp ?? 0}经验`].filter(Boolean).join('；');
    return { node, kind, detail };
  });
}
function FlowHeader({ step, title, difficulty, onBack, onGuide }) {
  return html`<div class="rs-flow__header">
    <${StepHeader} step=${step} of=${2} title=${title} micro="卫戍协议 · 共鸣" pub=${{ difficulty }} onExit=${onBack} onGuide=${onGuide}/>
    <a class="rs-fullscreen" href=${location.href} target="_blank" rel="noopener">全屏打开</a>
  </div>`;
}
export function App() {
  const openedSession = useRef('');
  useData('bonds', 'assets');
  const query = new URL(location.href).searchParams;
  const stepName = query.get('step');
  const stepFromUrl = stepName === 'difficulty' ? 1 : ['environment', 'briefing'].includes(stepName) ? 2 : 0;
  const [catalog, setCatalog] = useState(null);
  const [activeIds, setActiveIds] = useState([]);
  const [seed, setSeed] = useState(String(Math.floor(Math.random() * 2 ** 31)));
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
      const response = await resonanceApi.catalog(requestedSeed);
      if (!alive) return;
      if (!response.ok || !response.catalog?.operators || !Array.isArray(response.activeOperatorIds)) {
        setFailure(actionErrorText(response.error || { code: 'BAD_RESPONSE' }));
        return;
      }
      const next = { ...response.catalog, activeOperatorIds: response.activeOperatorIds };
      setCatalog(next);
      setActiveIds(response.activeOperatorIds);
      setCatalogKey(String(requestedSeed));
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
  }, [seed]);

  useEffect(() => {
    if (session || codex) return;
    const url = new URL(location.href);
    if (url.searchParams.get('view') === 'codex') return;
    url.searchParams.delete('view');
    const names = { 1: 'difficulty', 2: 'briefing' };
    if (names[step]) url.searchParams.set('step', names[step]);
    else url.searchParams.delete('step');
    url.searchParams.set('difficulty', difficulty);
    url.searchParams.delete('environment');
    history.replaceState(null, '', url);
  }, [step, difficulty, session, codex]);

  useEffect(() => {
    const open = () => {
      const target = parseDetailHash(location.hash);
      if (!target) return;
      if (['operator', 'pact', 'item', 'recipe', 'strategy', 'environment', 'opening'].includes(target.kind)) setDetail(target);
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
    if (!seedValid || step !== 2 || catalogKey !== String(numericSeed)) return;
    setBusy(true);
    try {
      await assets.ready();
      const response = await resonanceApi.create({ seed: numericSeed, difficulty });
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
  }, [seed, numericSeed, seedValid, difficulty, catalog, step, catalogKey]);

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

  const openingEvent = catalog.openingEvent;
  const catalogReady = seedValid && catalogKey === String(numericSeed) && !!openingEvent;
  const difficultyArt = uiUrl(data.get('assets'), `modeChoice/${difficultyArtKey[difficulty] || 'normal'}_rhodes_island`);
  const difficultySummary = difficultyCampaignSummary(catalog.campaign, difficulty);
  const route = briefingRoute(catalog.campaign, difficulty);
  const showCodex = (tab) => { setCodexTab(tab); setCodex(true); const url = new URL(location.href); url.searchParams.set('view', 'codex'); history.replaceState(null, '', url); };
  const openCodex = () => showCodex('operators');
  const openEconomyGuide = () => showCodex('economy');
  const titleActions = [
    { label: '开始整备', primary: true, onClick: () => setStep(1) },
    { label: '战术图鉴', onClick: openCodex },
    ...(readLast() ? [{ label: busy ? '正在载入…' : '继续上一局', onClick: () => resume(readLast()) }] : []),
  ];

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
                <${Button} class="rs-difficulty-feature__next" variant="primary" size="lg" block=${true} iconRight="chevrons" onClick=${() => setStep(2)}>查看本局简报</${Button}>
              </div>
            </article>
          </section>
          <section class="lobby-right"><div class="section-label"><span class="section-label__idx num">02</span>选择难度<${MicroLabel}>CHOOSE<//></div>
            <div class="diff-list">${DIFFICULTIES.map(([id, name, description]) => html`<${DifficultyCard} key=${id} roomMode="solo" difficulty=${id}
              selected=${difficulty === id} onSelect=${setDifficulty} presentation=${{ name, description }}/>` )}</div>
          </section>
        </div></div>`
      : html`<div class="screen brief rs-flow rs-flow--briefing"><div class="brief__bg" aria-hidden="true"></div>
        <${FlowHeader} step=${2} title="本局简报" difficulty=${difficulty} onBack=${() => setStep(1)} onGuide=${openEconomyGuide}/>
        <main class="brief__main">
          <section class="brief__left">
            <article class="rs-difficulty-feature brackets">
              ${difficultyArt ? html`<div class="rs-difficulty-feature__art"><img src=${difficultyArt} alt="" draggable="false"/></div>` : null}
              <div class="rs-difficulty-feature__content"><${MicroLabel} tone="mint">本局难度</${MicroLabel}><h2>${difficultyName(difficulty)}</h2>
                <p>${DIFFICULTIES.find(([id]) => id === difficulty)?.[2]}</p>
                <div class="rs-difficulty-feature__schedule"><b>本局节奏</b><span>${difficultySummary.rhythm}</span></div>
                ${difficultySummary.regularText ? html`<p class="rs-difficulty-feature__pressure">${difficultySummary.regularText}</p>` : null}
                ${difficultySummary.terminalText ? html`<p class="rs-difficulty-feature__pressure">${difficultySummary.terminalText}</p>` : null}
              </div>
            </article>
            <button type="button" class="rs-opening-event brackets" onClick=${() => {
              const id = Object.entries(catalog.openingEvents || {}).find(([, event]) => event.name === openingEvent?.name)?.[0];
              if (id) setDetail({ kind: 'opening', id });
            }} aria-label=${`开局事件：${openingEvent?.name || '标准开局'}，查看效果`}>
              <${MicroLabel} tone="mint">开局事件 · 查看效果</${MicroLabel}>
              <b>${openingEvent?.name || '标准开局'}</b>
              <span>${openingEvent?.description || '本局没有额外开局效果。'}</span>
            </button>
            <button class="rs-advanced" onClick=${() => setAdvancedOpen(true)}><${Icon} name="gear"/>高级设置</button>
          </section>
          <section class="brief__right"><div class="rs-brief-prep brackets">
            <div class="rs-brief-prep__head"><h2>开局整备</h2><${MicroLabel}>本赛季名单</${MicroLabel}></div>
            <p class="rs-brief-prep__roster">本赛季可招募干员 <b class="num">${activeIds.length}</b> 名</p>
            <div class="rs-brief-prep__resources"><span>开局资源</span><b>${catalog.campaign?.opening?.gold ?? '—'}<small>金币</small></b>
              <b>${catalog.campaign?.opening?.level ?? '—'}<small>科技</small></b><b>${catalog.campaign?.opening?.population ?? '—'}<small>人口</small></b>
              <b class="rs-brief-prep__components">${catalog.campaign?.opening?.basicComponents ?? '—'}<small>基础组件</small></b></div>
            <section class="rs-brief-route" aria-label="本局节点路线"><div class="rs-brief-route__head"><b>本局路线</b><span>${difficultyName(difficulty)} · ${catalog.campaign?.nodeSchedule?.[difficulty]?.nodes ?? '—'}节点</span></div>
              <ol>${route.map(({ node, kind, detail }) => html`<li key=${node} class=${kind.includes('领袖') ? 'is-leader' : kind.includes('精英') ? 'is-elite' : ''}>
                <b class="rs-brief-route__node">${node}</b><span class="rs-brief-route__kind">${kind}</span>${detail ? html`<small>${detail}</small>` : null}
              </li>`)}</ol></section>
            <p class="rs-brief-prep__hint">确认后进入本局，完整干员与战术资料可随时从图鉴查看。</p>
            <${Button} variant="secondary" icon="book" onClick=${openCodex}>打开战术图鉴<//>
          </div></section>
        </main>
        <footer class="brief__foot"><${Button} variant="secondary" onClick=${() => setStep(1)}>返回难度<//>
          <${Button} variant="primary" size="xl" icon="play" disabled=${busy || !catalogReady} loading=${busy} onClick=${start}>确认并开始本局<//></footer>
        <${Modal} open=${advancedOpen} title="高级设置" micro="本局选项" onClose=${() => setAdvancedOpen(false)}
          actions=${html`<${Button} variant="primary" onClick=${() => setAdvancedOpen(false)}>完成<//>`}>
          <label class="rs-seed-field">对局种子<input inputMode="numeric" value=${seed} onInput=${(event) => setSeed(event.currentTarget.value.replace(/\D/g, '').slice(0, 10))}/></label>
          ${!seedValid ? html`<p>请输入 0 至 4294967295 之间的整数种子。</p>` : !catalogReady ? html`<p>正在更新当前种子数据；更新完成后即可确认。</p>` : null}
        </${Modal}>
      </div>`}    <${DetailPanel} detail=${detail} catalog=${catalog} state=${null} onDetail=${setDetail} onClose=${() => setDetail(null)}/>
  </main>`;
}
