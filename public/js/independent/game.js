// 卫戍协议：工坊 game screen on the original renderer (render/app.js through ui/fieldHost.js): the own board in 3D with
// Spine operators, drag & drop deploy with the direction wheel, and every ready's battle replayed from the server's
// recording (server/modes/independent/battle.js) — the battle the result was settled on, never a re-simulation.
import { useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Spinner } from '../ui/components.js';
import { useFieldView } from '../ui/fieldHost.js';
import { useGameData } from '../ui/gameComponents.js';
import { FacingWheel, holdPiece, setPieceDir } from '../ui/facingWheel.js';
import { FullscreenButton } from '../ui/device.js';
import { toast } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { audio } from '../audio.js';
import { data } from '../data.js';
import { api } from './api.js';
import { prepView, canDrop, legalTilesOf, pieceByNum, isDeployed, benchLayout, inventoryStacks, inventoryCount,
  replayClock, frameAt, pendingOffer, renderChessId } from './model.js';
import { TopBar, InventoryStrip, ProductionPanel, ShopBar, UnitBadges, BenchOverflow, deployedCount } from './hud.js';
import { DetailCard, InventoryPanel, OfferOverlay, InheritPanel, ResultPanel } from './panels.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Player-facing reasons for the session's error codes (server/modes/independent/*.js). */
const ERRORS = {
  NO_FUNDS: '采购资金不足', SOLD_OUT: '卡池里已经没有这名干员', DEPLOY_CAP: '场上干员已达上限', ILLEGAL_TILE: '有干员站在不能部署的位置',
  OCCUPIED: '这个位置已有干员', NO_DEPLOYED_PIECES: '至少部署一名干员才能开始战斗', CAPACITY: '单个干员最多穿戴 99 件装备',
  UNIQUE: '同名唯一的装备只能穿戴一件', UNIQUE_OR_INELIGIBLE: '该干员不能穿戴这件装备', NOT_EQUIPPABLE: '这件物品不能穿戴',
  NOT_MERGEABLE: '这件装备不能合成', NOT_USABLE: '这件物品不能直接使用', CONDITION_NOT_MET: '使用条件未满足', MAX_LEVEL: '调度中心已达最高等级',
  NEED_UNIQUE_SELECTION: '请先选择要保留的同名唯一装备', NEEDS_SELECTION: '请先选择要保留的同名唯一项', NO_ELIGIBLE_TARGET: '没有可以选择的干员',
  NO_PERMISSION: '双方都不满足交接条件', BAD_TILE: '旧本体必须在场，且新本体能站在那个位置', WRONG_PHASE: '当前阶段不能进行该操作',
  LIMIT_REACHED: '已达到本轮上限', NO_CANDIDATE: '没有可招募的干员', REVISION: '对局已在别处更新，已同步到最新状态',
  NETWORK: '连接中断，请检查网络后重试',
};
const errorText = (error) => ERRORS[error?.code] || (error?.message && !/^[A-Z_]+$/.test(error.message) ? error.message : '操作没有完成');

/** Revision of the last ready (its battle rows), so the production panel lists what came in since. */
function lastReadyRevision(state) {
  const rows = (state?.production || []).filter((r) => r.phase === 'battle' || r.phase === 'roundStart');
  return rows.length ? Math.max(...rows.map((r) => r.revision)) - 1 : 0;
}

const SPEEDS = [2, 4, 8];

export function GameScreen({ id, initial, catalog, onLeave }) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(state); stateRef.current = state;
  const hostRef = useRef(null);
  const { view, kind: viewKind } = useFieldView(hostRef);
  const gd = useGameData();
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [armed, setArmed] = useState(null);
  const [detail, setDetailState] = useState(null);
  // closing what a component link (#piece-…, #shop-…) opened drops the link, so a reload does not open it again
  const setDetail = useCallback((next) => setDetailState((cur) => {
    const value = typeof next === 'function' ? next(cur) : next;
    if (!value && /^#(piece|shop)-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    return value;
  }), []);
  const [facing, setFacing] = useState(null);
  const [panel, setPanel] = useState(null);
  const [panelUid, setPanelUid] = useState(null);
  const [preview, setPreview] = useState(null);
  const [battle, setBattle] = useState(null);
  const battleRef = useRef(null); battleRef.current = battle;
  const [speed, setSpeed] = useState(SPEEDS[0]);
  const [pen, setPen] = useState(false);
  const speedRef = useRef(speed); speedRef.current = speed;
  const [since, setSince] = useState(() => lastReadyRevision(initial));

  // ---- actions --------------------------------------------------------------------------------------------------
  const act = useCallback(async (action, opts = {}) => {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(true);
    try {
      const res = await api.act(id, stateRef.current.revision, action);
      if (!res.ok) {
        if (res.state) setState(res.state);
        toast(errorText(res.error), 'warn'); audio.sfx('error', { volume: 0.5 });
        return null;
      }
      if (!opts.keep) setState(res.state);
      return res;
    } finally { busyRef.current = false; setBusy(false); }
  }, [id]);

  const simple = useCallback(async (action) => {
    const res = await act(action);
    if (!res) return null;
    if (action.type === 'sell' || action.type === 'inherit') setDetail(null);
    if (action.type === 'equip') audio.sfx('equip', { volume: 0.6 });
    return res;
  }, [act]);

  const buy = useCallback(async (slot) => {
    setArmed(null);
    const res = await act({ type: 'buy', slot });
    if (res) { audio.sfx('buy', { volume: 0.6 }); setDetail(null); }
  }, [act]);

  const ready = useCallback(async () => {
    const before = stateRef.current;
    if (before.phase !== 'prep' || battleRef.current) return;
    setArmed(null); setDetail(null); setFacing(null);
    const res = await act({ type: 'ready' }, { keep: true });
    if (!res) return;
    const fought = (res.events || []).find((e) => e.type === 'battle');
    const replay = fought ? await api.replay(id, fought.round) : null;
    const next = res.state;
    if (!replay) {
      toast('这一轮的战斗记录没有取到，直接显示结果', 'warn');
      setState(next); setSince(next.revision - 1);
      return;
    }
    const lastFrame = replay.frames[replay.frames.length - 1]?.snap;
    setBattle({ round: fought.round, replay, next, lpBefore: before.lp, lpLost: fought.lpLost || 0, result: next.lastBattle?.result || null,
      killed: 0, total: lastFrame?.total ?? null, done: false, finished: next.phase === 'finished' ? next.outcome : null });
  }, [act, id]);

  const closeBattle = useCallback(() => {
    const b = battleRef.current;
    if (!b) return;
    setState(b.next); setSince(b.next.revision - 1); setBattle(null);
  }, []);

  // ---- prep scene ------------------------------------------------------------------------------------------------
  const stageKey = useRef(null);
  useEffect(() => {
    if (!view || battle || !gd.ready) return;
    const stageId = state.board?.stageId;
    const stage = stageId ? data.lookup('stages', stageId) : null;
    if (stage && stageKey.current !== stageId) { view.setStage(stage); stageKey.current = stageId; }
    if (pen) view.setCamera('pen');
    else view.setCamera(state.board?.field === 'bossL' ? 'bossPrep' : 'prep', state.board?.field === 'bossL' ? { side: 'L' } : {});
  }, [view, battle, gd.ready, state.board?.stageId, state.board?.field, pen]);
  useEffect(() => { if (battle) setPen(false); }, [battle]);

  const editable = state.phase === 'prep' && !battle && !busy && !facing;
  useEffect(() => {
    if (!view || battle || !gd.ready) return;
    view.setPrep(prepView(state, catalog), { editable, canPlace: (n, target) => canDrop(stateRef.current, n, target) });
  }, [view, battle, gd.ready, state, editable]);

  // drag, drop, click, hover on the field
  useEffect(() => {
    if (!view) return undefined;
    const offs = [
      view.on('pieceDragStart', (e) => {
        view.highlightTiles(null);
        const tiles = legalTilesOf(stateRef.current, e?.uid);
        if (tiles.length) view.highlightTiles(tiles, 'legal');
        audio.sfx('pick', { volume: 0.5 });
      }),
      view.on('pieceDragEnd', () => view.highlightTiles(null)),
      view.on('pieceDrop', async (e) => {
        view.highlightTiles(null);
        const st = stateRef.current;
        const piece = pieceByNum(st, e?.uid);
        const t = e?.target || {};
        if (!piece || t.area === 'outside' || !canDrop(st, e.uid, t)) return;
        if (t.area === 'hand') { await act({ type: 'bench', uid: piece.uid }); return; }
        // a board drop: choose the direction first, like the original (the piece waits on the tile meanwhile)
        holdPiece(view, e.uid, { row: t.row, col: t.col });
        const rec = data.lookup('chess', renderChessId(catalog, piece));
        setFacing({ uid: piece.uid, n: e.uid, row: t.row, col: t.col, dir: piece.dir || 'RIGHT', grid: Array.isArray(rec?.rangeGrid) ? rec.rangeGrid : null, name: rec?.name || '' });
      }),
      view.on('pieceClick', (e) => {
        if (!e || battleRef.current) return;
        const piece = pieceByNum(stateRef.current, e.uid);
        if (!piece) return;
        audio.sfx('click', { volume: 0.4 });
        setArmed(null);
        setDetail((d) => (d?.kind === 'piece' && d.uid === piece.uid && !e.detail ? null : { kind: 'piece', uid: piece.uid }));
      }),
      view.on('pieceHover', (e) => {
        if (battleRef.current) return;
        view.highlightTiles(null, 'range');
        const piece = e?.uid != null ? pieceByNum(stateRef.current, e.uid) : null;
        if (!piece || !isDeployed(piece)) return;
        const rec = data.lookup('chess', renderChessId(catalog, piece));
        if (!Array.isArray(rec?.rangeGrid)) return;
        const tiles = rec.rangeGrid.map(([dr, dc]) => [piece.row + dr, piece.col + dc]).filter(([r, c]) => !(r === piece.row && c === piece.col));
        view.highlightTiles(tiles, 'range');
      }),
    ];
    return () => { for (const off of offs) { try { off?.(); } catch { /* ignore */ } } };
  }, [view, act]);

  const cancelFacing = useCallback(() => {
    const f = facing;
    setFacing(null);
    if (!f) return;
    setPieceDir(view, f.n, f.dir);
    holdPiece(view, f.n, null);
  }, [facing, view]);
  const commitFacing = useCallback(async (dir) => {
    const f = facing;
    setFacing(null);
    if (!f) return;
    const res = await act({ type: 'move', uid: f.uid, row: f.row, col: f.col, dir: dir || f.dir });
    holdPiece(view, f.n, null);
    if (!res) setPieceDir(view, f.n, f.dir);
    else audio.sfx('drop', { volume: 0.6 });
  }, [facing, view, act]);

  // ---- battle replay ---------------------------------------------------------------------------------------------
  const seekRef = useRef(null);
  useEffect(() => {
    if (!view || !battle?.replay || !gd.ready) return undefined;
    const rec = battle.replay; const frames = rec.frames; const fieldId = rec.field.fieldId;
    const stage = data.lookup('stages', rec.stageId);
    if (stage) { view.setStage(stage); stageKey.current = null; }
    const kind = rec.kind === 'hidden' ? 'boss' : rec.kind;
    view.enterBattle(rec.field);
    view.setCamera(kind, { rect: rec.field.rect, side: 'L' });
    const { t0 } = replayClock(rec);
    let idx = 0; let gameT = t0 - 0.001; let last = performance.now(); let raf = 0; let shown = -1; let ended = false;
    const feed = () => {
      while (idx < frames.length && frames[idx].snap.t <= gameT) {
        const f = frames[idx++];
        // like the match server: the b.ev of a drain first, then its b.snap, both on the game clock
        if (f.ev.length) view.pushEvents({ t: 'b.ev', fieldId, gt: f.snap.t, ev: f.ev });
        view.pushSnapshot(f.snap);
      }
    };
    const report = () => {
      const k = Math.max(0, idx - 1);
      if (k !== shown) { shown = k; const s = frames[k]?.snap; if (s) setBattle((b) => (b ? { ...b, killed: s.killed, total: s.total } : b)); }
    };
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      gameT += dt * speedRef.current;
      feed(); report();
      if (idx >= frames.length) {
        if (!ended) { ended = true; setTimeout(() => setBattle((b) => (b ? { ...b, done: true } : b)), 900); }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    // jump to the end state (render-demo seek): spawn what is still there, then the last snapshots
    seekRef.current = () => {
      cancelAnimationFrame(raf);
      const k = frames.length - 1;
      view.enterBattle(rec.field);
      view.setCamera(kind, { rect: rec.field.rect, side: 'L', instant: true });
      const infos = new Map();
      for (let i = 0; i <= k; i++) for (const e of frames[i].ev) if (e[0] === 'spawn') infos.set(e[1].id, e[1]);
      const present = new Set(frames[k].snap.units.map((u) => u[0]));
      const spawns = [...infos.values()].filter((u) => present.has(u.id)).map((u) => ['spawn', u]);
      if (spawns.length) view.pushEvents({ fieldId, ev: spawns });
      for (let i = Math.max(0, k - 3); i <= k; i++) view.pushSnapshot(frames[i].snap);
      view.raw?.debug?.interp?.snapToNewest?.();
      idx = frames.length; report();
      if (!ended) { ended = true; setBattle((b) => (b ? { ...b, done: true } : b)); }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); seekRef.current = null; };
  }, [view, battle?.replay, gd.ready]);

  // ---- component links (#piece-p12, #shop-2, #item-i7, #offer-o5): open what the link points at -------------------
  useEffect(() => {
    const follow = () => {
      const hash = decodeURIComponent(location.hash.slice(1));
      const st = stateRef.current;
      if (hash.startsWith('piece-') && st.pieces.some((p) => p.uid === hash.slice(6))) setDetail({ kind: 'piece', uid: hash.slice(6) });
      else if (hash.startsWith('shop-') && st.shop.slots[Number(hash.slice(5))]) {
        const i = Number(hash.slice(5)); const s = st.shop.slots[i];
        setDetail(s.kind === 'chess' ? { kind: 'shop', slot: i } : { kind: 'gear', id: s.id, elite: s.elite });
      } else if (hash.startsWith('item-')) { setPanelUid(null); setPanel('inventory'); }
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  const copyLink = useCallback(async (anchor) => {
    const url = new URL(location.href); url.hash = anchor;
    const ok = await copyText(url.href);
    toast(ok ? '已复制定位链接' : url.href, ok ? 'info' : 'warn');
  }, []);

  // ---- keyboard ----------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (battleRef.current) { if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); seekRef.current?.(); } return; }
      if (panel) return; // an open panel (Modal) takes its own Escape
      if (e.key === 'Escape') { setDetail(null); setArmed(null); return; }
      if (stateRef.current.phase !== 'prep') return;
      if (e.key === 'r' || e.key === 'R') act({ type: 'refresh' });
      else if (e.key === 'f' || e.key === 'F') act({ type: 'freeze' });
      else if (e.key === 'd' || e.key === 'D') act({ type: 'upgrade' });
      else if (e.key === ' ') { e.preventDefault(); ready(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, ready, panel]);

  // ---- derived -----------------------------------------------------------------------------------------------------
  const stacks = useMemo(() => inventoryStacks(state.inventory, catalog), [state.inventory, catalog]);
  const offer = pendingOffer(state);
  const { overflow } = benchLayout(state);
  const deployed = deployedCount(state);
  const readyReason = state.phase !== 'prep' ? null : deployed < 1 ? '至少部署一名干员' : deployed > state.deployCap ? `场上最多 ${state.deployCap} 名干员` : offer ? '请先完成当前选择' : null;
  const loading = viewKind === 'loading' || !gd.ready;

  const openInventory = (uid = null) => { setPanelUid(uid || (detail?.kind === 'piece' ? detail.uid : null)); setPanel('inventory'); };
  const openInherit = (uid) => { setPreview(null); setPanelUid(uid); setPanel('inherit'); };
  const runPreview = useCallback(async (donorUid, receiverUid) => {
    setPreview(null);
    const res = await api.act(id, stateRef.current.revision, { type: 'inherit-preview', donorUid, receiverUid });
    const pv = res.ok ? res.events?.find((x) => x.type === 'inherit-preview')?.preview : null;
    setPreview(pv ? { ...pv, donorUid, receiverUid } : { ok: false, error: res.error?.code || 'BAD_TARGET', donorUid, receiverUid });
  }, [id]);

  return html`<div class=${cx('screen', 'gm', battle ? 'gm--combat' : 'gm--prep', 'ix-game')} data-testid="ix-game">
    <div class="gm__field" ref=${hostRef} onContextMenu=${(e) => e.preventDefault()}></div>
    ${loading ? html`<div class="gm__loading"><${Spinner} label="LOADING FIELD" /></div>` : null}
    <div class="gm__vignette" aria-hidden="true"></div>
    <div class="gm__hud">
      <${TopBar} state=${state} battle=${battle} busy=${busy} readyReason=${readyReason} onReady=${ready} onExit=${onLeave}
        pen=${pen} onPen=${() => setPen((x) => !x)} />
      ${!battle ? html`
        <${InventoryStrip} stacks=${stacks} total=${inventoryCount(state.inventory)} catalog=${catalog} onOpen=${() => openInventory()}
          onArm=${(s) => setDetail({ kind: 'gear', id: s.id, elite: s.elite })} />
        <${ProductionPanel} state=${state} catalog=${catalog} sinceRevision=${since} />
        <${UnitBadges} view=${view} pieces=${state.pieces} catalog=${catalog} hidden=${loading || pen} />
        <${BenchOverflow} pieces=${overflow} catalog=${catalog} onPick=${(uid) => setDetail({ kind: 'piece', uid })} />
        ${state.phase === 'prep' && !pen ? html`<${ShopBar} state=${state} catalog=${catalog} busy=${busy} armed=${armed} deployed=${deployed} deployCap=${state.deployCap}
          onArm=${(key, slot) => { setArmed(key); if (slot) setDetail({ kind: slot.kind === 'chess' ? 'shop' : 'gear', slot: Number(key.slice(1)), id: slot.id, elite: slot.elite }); }}
          onBuy=${buy} onUpgrade=${() => { setArmed(null); act({ type: 'upgrade' }); }} onRefresh=${() => { setArmed(null); act({ type: 'refresh' }); }}
          onFreeze=${() => act({ type: 'freeze' })} />` : null}
        <${DetailCard} target=${detail} state=${state} catalog=${catalog} busy=${busy} onClose=${() => { setDetail(null); setArmed(null); }}
          onAct=${simple} onBuy=${buy} onInherit=${openInherit} onEquipHere=${(uid) => openInventory(uid)} onCopyLink=${copyLink} />
      ` : html`<div class="ix-battlebar" data-testid="ix-battlebar">
        ${SPEEDS.map((s) => html`<button type="button" key=${s} class=${cx('ix-chip', speed === s && 'is-on')} onClick=${() => setSpeed(s)}>${s / 2}×</button>`)}
        <${Button} size="sm" variant="secondary" disabled=${battle.done} onClick=${() => seekRef.current?.()} data-testid="ix-skip">跳到结尾<//>
      </div>`}
      <div class="gm__corner">
        <${FullscreenButton} class="gm__gear gm__fs" />
      </div>
    </div>
    ${facing && view ? html`<${FacingWheel} key=${`${facing.uid}:${facing.row},${facing.col}`} view=${view} row=${facing.row} col=${facing.col}
      grid=${facing.grid} name=${facing.name} onPreview=${(dir) => setPieceDir(view, facing.n, dir || facing.dir)} onCommit=${commitFacing} onCancel=${cancelFacing} />` : null}
    ${!battle && offer ? html`<${OfferOverlay} offer=${offer} state=${state} catalog=${catalog} busy=${busy} onChoose=${simple} />` : null}
    ${battle?.done ? html`<${ResultPanel} battle=${battle} catalog=${catalog} pieces=${state.pieces} finished=${battle.finished} onClose=${closeBattle} />` : null}
    <${InventoryPanel} open=${panel === 'inventory'} state=${state} catalog=${catalog} busy=${busy} targetUid=${panelUid} onTarget=${setPanelUid}
      onClose=${() => setPanel(null)} onAct=${simple} />
    <${InheritPanel} open=${panel === 'inherit'} state=${state} catalog=${catalog} busy=${busy} fromUid=${panelUid} preview=${preview}
      onPreview=${runPreview} onClose=${() => setPanel(null)} onConfirm=${async (action) => { const res = await simple(action); if (res) setPanel(null); }} />
  </div>`;
}
