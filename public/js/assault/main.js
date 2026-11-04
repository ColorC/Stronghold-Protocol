import '../ui/compat.js';
import { render } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Spinner, Modal } from '../ui/components.js';
import { data } from '../data.js';
import { GAME_FILES } from '../ui/gameComponents.js';
import { installAudio } from '../audio.js';
import { settingsStore } from '../ui/settings.js';
import { installDeviceSupport } from '../ui/device.js';
import { initLang } from '../ui/lang.js';
import { setStatsNamespace } from '../ui/stats.js';
import { createAssaultApi, downloadBlob } from './api.js';
import { createAssaultBattle } from './client-sim.js';
import { AssaultUI, seedNativeUi } from './ui.js';
import { errorMessage, hrefForRun, makeOpId, normalizeCatalog, publicStateFromResponse, reconcileDetail, runFromUrl } from './model.js';
import { t } from '../../../shared/i18n.js';
import { installAssaultRecording } from './recorder.js';
const api = createAssaultApi();
setStatsNamespace('assault');
installDeviceSupport();
installAudio({ getManifest: () => data.get('assets'), settings: settingsStore.get() });
settingsStore.subscribe(s => { import('../audio.js').then(({audio}) => { audio.setVolumes(s); audio.setVoiceLang(s.voiceLang,s.voiceOverrides); }); });
initLang().catch(() => {});
function App() {
  const [connection, setConnection] = useState(api.connection());
  useEffect(() => api.subscribeConnection(setConnection), []);
  const [catalog, setCatalog] = useState(null); const [state, setState] = useState(null); const [page, setPage] = useState('loading'); const [error, setError] = useState(null); const [detail, setDetail] = useState(null); const [session, setSession] = useState(null); const [busy, setBusy] = useState(false); const [pending, setPending] = useState(null); const fileRef = useRef(null); const stateRef = useRef(null); const busyRef = useRef(false); const battleLoadRef = useRef(null); const settleRef = useRef(false); stateRef.current = state;
  const visit = useRef(0);
  // like the single-player mode's speed chips: the choice stays for the visit's later battles, nothing is stored
  const speedRef = useRef(1);
  const [resumeRunId, setResumeRunId] = useState(() => {
    if (!new URL(location.href).searchParams.has('new') && runFromUrl()) return runFromUrl();
    try { return localStorage.getItem('assault:lastRun'); } catch { return null; }
  });
  const focusHash = (next = {}) => { let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch { return; } const legacy = hash.match(/^([^=]+)=(.+)$/); if (legacy) { if (legacy[1] === 'piece') { const piece = next.pieces?.find((item) => item.uid === legacy[2]); if (piece) setDetail(piece); return; } hash = `${legacy[1]}-${legacy[2]}`; } setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0); };
  const put = (packet) => { const next = publicStateFromResponse(packet); if (!next) return false; stateRef.current = next; setState(next); setResumeRunId(next.runId); setDetail((current) => reconcileDetail(current, next.pieces)); setPage(next.phase === 'ended' ? 'ended' : 'run'); try { localStorage.setItem('assault:lastRun', next.runId); } catch { /* optional */ } history.replaceState(null, '', hrefForRun(next.runId)); focusHash(next); return true; };
  useEffect(() => { let live = true; (async () => { const result = await api.catalog(); if (!live) return; if (!result.ok) { setError(errorMessage(result.error)); setPage('error'); return; } const normal = normalizeCatalog(result); await data.loadAll(...GAME_FILES); if (!live) return; seedNativeUi(normal); setCatalog(normal); setPage('start'); })(); return () => { live = false; }; }, []);
  const send = async (request, current) => {
    const epoch = visit.current;
    const result = request.type === 'settleBattle'
      ? await api.settle(current.runId, request.params.battleId, { opId: request.opId, expectedRevision: request.expectedRevision })
      : await api.action(current.runId, request.type, request.params, { opId: request.opId, expectedRevision: request.expectedRevision });
    if (epoch !== visit.current) return result;
    if (result.ok && put(result)) { setError(null); setPending(null); if (request.type === 'settleBattle') { settleRef.current = false; setSession(null); } }
    else { if (result.run) { put(result.run); setPending({ ...request, expectedRevision: result.run.state?.revision ?? request.expectedRevision }); } setError(errorMessage(result.error)); }
    return result;
  };
  const action = async (type, params = {}) => { if (type === 'clearError') { setError(null); return; } if (type === 'error') { setError(params.message); return; } if (type === 'battleFinished') { if (session && stateRef.current?.currentBattle && !settleRef.current) { settleRef.current = true; action('settleBattle', { battleId: stateRef.current.currentBattle.battleId }); } return; } const current = stateRef.current; if (!current?.runId || busyRef.current) return; const epoch = visit.current; const request = { type, params, opId: makeOpId(), expectedRevision: current.revision }; setPending(request); busyRef.current = true; setBusy(true); try { return await send(request, current); } finally { if (epoch === visit.current) { busyRef.current = false; setBusy(false); } } };
  const createBattle = async () => { const epoch = visit.current; const current = stateRef.current; if (!current?.runId || !catalog || current.phase !== 'battle') return; const key = `${current.runId}:${current.revision}:${current.currentBattle?.battleId || ''}`; if (battleLoadRef.current?.key === key) return battleLoadRef.current.promise; const promise = (async () => { const prepared = await api.battle(current.runId); if (epoch !== visit.current) return; if (!prepared.ok) { setError(errorMessage(prepared.error)); return; } try { const next = await createAssaultBattle(prepared.battle, { runtime: catalog.runtime, nativeData: catalog.nativeData, design: catalog.design }); if (epoch === visit.current && stateRef.current?.runId === current.runId && stateRef.current?.revision === current.revision) setSession({ ...next, speed: speedRef.current, paused: false }); } catch (err) { if (epoch === visit.current) setError(errorMessage(err)); } })(); battleLoadRef.current = { key, promise }; try { await promise; } finally { if (battleLoadRef.current?.key === key) battleLoadRef.current = null; } };
  useEffect(() => { if (state?.phase === 'battle' && !session) createBattle(); if (state?.phase !== 'battle' && session) { session.battle?.forceEnd?.('stateChanged'); setSession(null); settleRef.current = false; } }, [state?.phase, state?.runId, state?.revision]);
  useEffect(() => { const simData = session?.built?.data; if (!simData) return; setCatalog((current) => current ? { ...current, nativeData: { ...current.nativeData, ...simData, chess: { ...(current.nativeData?.chess || {}), ...(simData.chess || {}) } } } : current); }, [session?.built?.data]);
  const enter = async (load) => {
    if (busyRef.current) return;
    const epoch = ++visit.current;
    busyRef.current = true; setBusy(true); setError(null); setPending(null);
    try {
      const result = await load();
      if (epoch !== visit.current) return;
      if (result.ok) put(result); else setError(errorMessage(result.error));
    } finally { if (epoch === visit.current) { busyRef.current = false; setBusy(false); } }
  };
  const start = directorId => enter(() => { history.replaceState(null, '', hrefForRun(null)); return api.create({ directorId }); });
  const resume = () => resumeRunId && enter(() => api.load(resumeRunId));
  const retry = async () => { const epoch = visit.current; if (!pending || busyRef.current || !stateRef.current?.runId) return; busyRef.current = true; setBusy(true); try { await send(pending, stateRef.current); } finally { if (epoch === visit.current) { busyRef.current = false; setBusy(false); } } };
  const restart = () => { ++visit.current; stateRef.current = null; busyRef.current = false; battleLoadRef.current = null; settleRef.current = false; setBusy(false); setPending(null); setDetail(null); setState(null); setSession(null); setError(null); setPage('start'); history.replaceState(null, '', hrefForRun(null)); };
  const importFile = () => fileRef.current?.click();
  const onFile = async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || busyRef.current) return; await enter(async () => { try { return await api.importRun(JSON.parse(await file.text())); } catch { return {ok:false,error:{message:t('存档文件无法读取，请选择进击模式导出的 JSON。')}}; } }); };
  const exportFile = async () => { if (!state?.runId) return; const result = await api.exportRun(state.runId); if (result.ok) downloadBlob(result.blob, t('进击模式-存档.json')); else setError(errorMessage(result.error)); };
  if (page === 'loading') return html`<div class="screen gload"><${Spinner} size="lg" label=${t('正在载入进击')} /></div>`;
  if (page === 'error') return html`<${Modal} open=${true} title=${t('暂时无法进入进击')} actions=${html`<${Button} onClick=${()=>location.reload()}>${t('重新连接')}<//>`}><p>${error}</p><//>`;
  return html`<div class="assault-presentation"><input ref=${fileRef} type="file" accept="application/json,.json" hidden onChange=${onFile} />
    <${AssaultUI} key=${state?.runId || 'title'} catalog=${catalog} state=${state} page=${page} session=${session} detail=${detail} busy=${busy} error=${error} pending=${pending} connection=${connection} resumeRunId=${resumeRunId} onResume=${resume}
      onAction=${action} onOpen=${setDetail} onClose=${() => setDetail(null)} onStart=${start} onImport=${importFile} onExport=${exportFile}
      onRestart=${restart} onRetry=${retry} onPause=${() => setSession(s => s ? { ...s, paused: !s.paused } : s)}
      onSpeed=${speed => { speedRef.current = speed; setSession(s => s ? { ...s, speed } : s); }} />
  </div>`;
}
render(html`<${App} />`, document.getElementById('app'));
installAssaultRecording();
