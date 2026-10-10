// 卫戍协议：工坊 game screen on the original renderer (render/app.js through ui/fieldHost.js): the own board in 3D with
// Spine operators, drag & drop deploy with the direction wheel, and every ready's battle replayed from the server's
// recording (server/modes/independent/battle.js) — the battle the result was settled on, never a re-simulation.
import { useCallback, useEffect, useMemo, useRef, useState, useErrorBoundary } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Spinner, PhaseBanner, confirmDialog } from '../ui/components.js';
import { GIcon } from '../ui/gameComponents.js';
import { SettingsModal } from '../ui/settings.js';
import { useFieldView } from '../ui/fieldHost.js';
import { useGameData } from '../ui/gameComponents.js';
import { FacingWheel, holdPiece, setPieceDir, showRange } from '../ui/facingWheel.js';
import { rangeTiles as rotatedRangeTiles } from '../ui/facing.js';
import { Underframe } from '../ui/underframe.js';
import { MODULE_NONE } from '../ui/loadoutModel.js';
import { attackRangeGrid } from '../../../shared/loadoutRecord.js';
import { FullscreenButton } from '../ui/device.js';
import { toast } from '../ui/toasts.js';
import { audio, bgmKeyFor, combatTrackFor, resultSpeaker, resultVoiceSlot } from '../audio.js';
import { PHASE, GEO } from '../../../shared/constants.js';
import { independentGrowthCatalog } from '../../../shared/independentPrizeText.js';
import { previewEnemyKey, terrainInfo, phaseBanner, snapHud, shortcutFor, shortcutBlocked, closesOnFieldPress, chessLoadout, prepCameraFor, foldCamera } from '../ui/gameLogic.js';
import { data } from '../data.js';
import { api } from './api.js';
import { prepView, canDrop, dropRefusal, legalTilesOf, pieceByNum, isDeployed, benchLayout, inventoryStacks,
  replayClock, stepReplayClock, frameAt, pendingOffer, renderChessId, withCatalogTiers } from './model.js';
import { TopBar, InventoryStrip, ProductionPanel, ShopBar, UnitBadges, BenchOverflow, deployedCount, MatchInfo, mergeHintOf, EffectsColumn } from './hud.js';
import { EnemyDrawer } from '../ui/enemyDrawer.js';
import { DpCounter, PauseButton } from '../ui/hud.js';
import { InventoryPanel, OfferOverlay, InheritPanel, ResultPanel, FinalScreen, USE_NEEDS } from './panels.js';
import { DetailCard } from './detail.js';
import { parseComponentLinkHash } from './componentLinkHash.js';
import { ElementPicker } from './picker.js';
import { buyTargetSpec } from './targetSelection.js';
import { battleEndControl } from './battleEndControl.js';

/** Keep battle completion reachable even if result details fail to render. */
function GuardedResultPanel(props) {
  const [error] = useErrorBoundary((err) => {
    console.error('[independent] battle result panel render failed', err);
    try {
      globalThis.dispatchEvent(new CustomEvent('sp:ui-render-error', {
        detail: { scope: 'battle-result', message: String(err?.message || err), stack: String(err?.stack || '') },
      }));
    } catch { /* diagnostics must not replace the recovery action */ }
  });
  if (error) return html`<div class="ix-result" role="dialog" aria-label="战斗结算" data-testid="ix-result-error">
    <div class="ix-result__box">
      <header><h2>战斗已结束</h2><span class="ix-muted">结算内容暂时无法显示</span></header>
      <footer><${Button} variant="primary" onClick=${props.onClose} data-testid="ix-result-error-ok">${props.finished ? '查看结算' : '继续备战'}<//></footer>
    </div>
  </div>`;
  return html`<${ResultPanel} battle=${props.battle} catalog=${props.catalog} pieces=${props.pieces}
    finished=${props.finished} onClose=${props.onClose} />`;
}

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Player-facing reasons for the session's error codes (server/modes/independent/*.js). */
const ERRORS = {
  NO_FUNDS: '采购资金不足', SOLD_OUT: '卡池里已经没有这名干员', DEPLOY_CAP: '场上干员已达上限', ILLEGAL_TILE: '有干员站在不能部署的位置',
  OCCUPIED: '这个位置已有干员', NO_DEPLOYED_PIECES: '至少部署一名干员才能开始战斗',
  BENCH_FULL: '整备区已满（10名）', TEMP_NOT_EMPTY: '临时整备区还有干员：让他们上场、放回整备区或出售后才能开始战斗', CAPACITY: '这名干员的装备已经穿满',
  UNIQUE: '同名唯一的装备只能穿戴一件', SINGLE_EQUIP_ONLY: '该装备请逐件装配', UNIQUE_QUANTITY: '同名唯一的装备只能穿戴一件', INVENTORY_FULL: '库存已满，先穿戴或使用一些', UNIQUE_OR_INELIGIBLE: '该干员不能穿戴这件装备', NOT_EQUIPPABLE: '这件物品不能穿戴',
  NOT_MERGEABLE: '这件装备不能合成', NOT_USABLE: '这件物品不能直接使用', CONDITION_NOT_MET: '使用条件未满足', MAX_LEVEL: '调度中心已达最高等级',
  NEED_UNIQUE_SELECTION: '请先选择要保留的同名唯一装备', NEEDS_SELECTION: '请先选择要保留的同名唯一项', NO_ELIGIBLE_TARGET: '没有可以选择的干员',
  NO_PERMISSION: '双方的交接凭证都不允许这次交接', BAD_TILE: '交出装备的一方需要在场，且接收方能部署在那个位置', WRONG_PHASE: '当前阶段不能进行该操作',
  LIMIT_REACHED: '已达到本轮上限', NO_CANDIDATE: '没有可招募的干员', REVISION: '对局已在别处更新，已同步到最新状态',
  NETWORK: '连接中断，请检查网络后重试',
};
const errorText = (error) => ERRORS[error?.code] || (error?.message && !/^[A-Z_]+$/.test(error.message) ? error.message : '操作没有完成');

const SPEEDS = [2, 4, 8];
// the units' tier chips on the board as pips, like every tier on this page (main.js setTierLook)
const FIELD_OPTS = Object.freeze({ tierChips: 'pips' });
// the selected piece's range, in the original's colour (screens/game.js SEL_RANGE); hovering shows the plain group
const SEL_RANGE = Object.freeze({ group: 'selRange', color: 0xff9c33, fill: 0.3, line: 0.95 });
// the tile an armed merge card's elite takes (screens/game.js MERGE_HL)
const MERGE_HL = Object.freeze({ group: 'mergeTile', color: 0xffd45a, fill: 0.34, line: 1 });
const FIELD_CONDITION_HL = Object.freeze({ group: 'detailFieldCondition', color: 0x61d8c8, fill: 0.18, line: 0.72 });

/**
 * The grid a piece fights with: its form (elite or not) under its own skill / module choice (an elite module can
 * widen it), like the original's previews (DESIGN §16).
 */
function rangeGridOf(catalog, piece) {
  const base = data.lookup('chess', piece.chessId);
  const opBase = catalog.operators?.[piece.chessId];
  const golden = opBase?.eliteChessId ? data.lookup('chess', opBase.eliteChessId) : null;
  const rec = piece.elite && golden ? golden : base;
  if (!rec) return null;
  const lo = { [base.chessId]: { skill: piece.skillIndex, module: piece.elite ? piece.moduleId || MODULE_NONE : undefined } };
  let grid = null;
  try { grid = attackRangeGrid(chessLoadout(rec, lo, (id) => data.lookup('chess', id))?.record || rec); } catch { /* the data grid */ }
  return grid?.length ? grid : (Array.isArray(rec.rangeGrid) ? rec.rangeGrid : null);
}

/**
 * Why a release of piece `n` on `tile` places nothing (the original's toast, ui/gameLogic.js dropFailureReason), or
 * null when it is put back on its own slot or is a legal place.
 */
/** Field tile of a piece: its board tile, or its bench slot (the hand row of the renderer). */
function pieceTileOf(state, piece) {
  if (isDeployed(piece)) return { row: piece.row, col: piece.col };
  const { hand, temp } = benchLayout(state);
  const idx = hand.findIndex((p) => p.uid === piece.uid);
  if (idx >= 0) return { row: GEO.HAND_ROW, col: idx };
  const t = temp.findIndex((p) => p.uid === piece.uid);
  return t >= 0 ? { row: GEO.TEMP_ROW, col: GEO.TEMP_C0 + t } : null;
}

export function GameScreen({ id, initial, catalog:sourceCatalog, onLeave }) {
  const [state, setState] = useState(initial);
  const catalog=useMemo(()=>independentGrowthCatalog(sourceCatalog,state.growthMode),[sourceCatalog,state.growthMode]);
  const stateRef = useRef(state); stateRef.current = state;
  const hostRef = useRef(null);
  const { view, kind: viewKind } = useFieldView(hostRef, FIELD_OPTS);
  const onFieldHighlight = useCallback((pieces = []) => {
    if (!view) return;
    const tiles = (pieces || []).filter((p) => Number.isInteger(p?.row) && Number.isInteger(p?.col)).map((p) => [p.row, p.col]);
    try { view.highlightTiles(tiles, FIELD_CONDITION_HL); } catch { /* field highlighting is cosmetic */ }
  }, [view]);
  const rangeTilesFor = useCallback((piece) => {
    if (!piece || !isDeployed(piece)) return null;
    const grid = rangeGridOf(catalog, piece);
    return grid ? rotatedRangeTiles(grid, piece.row, piece.col, piece.dir || 'RIGHT') : null;
  }, [catalog]);
  const gd = useGameData();
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [armed, setArmed] = useState(null);
  const [fieldTarget, setFieldTarget] = useState(null);
  const fieldTargetRef = useRef(null);
  const [detail, setDetailState] = useState(null);
  // closing what a component link (#piece-…, #shop-…) opened drops the link, so a reload does not open it again
  const setDetail = useCallback((next) => setDetailState((cur) => {
    const value = typeof next === 'function' ? next(cur) : next;
    if (!value && /^#(piece|shop|gear)-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    return value;
  }), []);
  const [facing, setFacing] = useState(null);
  const [dragging, setDragging] = useState(false);
  const cameraRef = useRef(null);
  const [panel, setPanel] = useState(null);
  const [panelUid, setPanelUid] = useState(null);
  const [panelKey, setPanelKey] = useState(null);
  const [preview, setPreview] = useState(null);
  const [battle, setBattle] = useState(null);
  const battleRef = useRef(null); battleRef.current = battle;
  const [speed, setSpeed] = useState(SPEEDS[0]);
  const [pen, setPen] = useState(false);
  const speedRef = useRef(speed); speedRef.current = speed;
  const [replayPaused, setReplayPaused] = useState(false);
  const replayPausedRef = useRef(false);
  const [replayRemaining, setReplayRemaining] = useState(0);
  const replayTimeRef = useRef(0);
  const replayEndTimeRef = useRef(0);
  const toggleReplayPause = useCallback(() => {
    const next = !replayPausedRef.current;
    replayPausedRef.current = next;
    view?.setReplayPaused(next);
    if (next) setReplayRemaining(Math.max(0, replayEndTimeRef.current - replayTimeRef.current));
    setReplayPaused(next);
  }, [view]);
  // the replay frame on show (index into battle.replay.frames): the detail card reads a battle unit's HP and stats there
  const replayPosRef = useRef(-1);
  const [banner, setBanner] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawer, setDrawer] = useState(null); // the original's 本局信息 / 敌方情报 drawer: 'info' | 'enemies' | null
  // the tapped own piece (the original's underframe: 撤退 / 出售 and its range); `pressSel` is the selection a field
  // press began with, so a tap on the selected piece deselects it
  const [shopCollapsed, setShopCollapsed] = useState(false);
  const [finalHidden, setFinalHidden] = useState(false); // 查看阵容 on the end screen
  const [reportOpen, setReportOpen] = useState(false);   // 战报: the last battle's result again (state.lastBattle)
  const [sel, setSel] = useState(null);
  const selRef = useRef(null); selRef.current = sel;
  const pressSel = useRef(null);
  // leaving asks first (the original's ExitModal); the drill is saved and 继续上一局 picks it up
  const leave = useCallback(async () => {
    const ok = await confirmDialog({ title: '离开本局', text: '进度已保存，可以在开局页「继续上一局」回来。', okText: '离开' });
    if (ok) onLeave();
  }, [onLeave]);

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
      try { globalThis.__SP_RECORD_ACTION__?.(action, res); } catch { /* recording never blocks gameplay */ }
      // the bench and the 临时整备区 were both full: the operator went back to the pool (session.js roomFor)
      if ((res.events || []).some((e) => e.type === 'no-room')) toast('整备区已满，获得的干员已返还', 'warn');
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

  // 撤退 / 出售 of the selected piece (the underframe's buttons, Q / X). A sold operator loses its gear and attachments,
  // so selling one that wears any asks first, like the detail card's 出售.
  const retreatPiece = useCallback(async (uid) => {
    if (!(await act({ type: 'bench', uid }))) return;
    setSel(null);
    setDetail((d) => (d?.kind === 'piece' && d.uid === uid ? null : d)); // its card would cover the bench
    audio.sfx('drop', { volume: 0.5 });
  }, [act]);
  const sellPiece = useCallback(async (uid) => {
    const piece = (stateRef.current.pieces || []).find((p) => p.uid === uid);
    if (!piece) return;
    if ((piece.equipment || []).length || (piece.attachments || []).length) {
      const ok = await confirmDialog({ title: '出售干员', text: '装备与附加效果会随干员一起失去。确定出售吗？', okText: '出售', danger: true });
      if (!ok) return;
    }
    if (await simple({ type: 'sell', uid })) { setSel(null); audio.sfx('sell', { volume: 0.6 }); }
  }, [simple]);

  const buy = useCallback(async (slot, targets = undefined, { preserveDetail = false } = {}) => {
    const current=stateRef.current,shopSlot=current?.shop?.slots?.[slot];
    if(targets===undefined&&buyTargetSpec(shopSlot,catalog,current)) { setDetail({kind:'shop',slot}); return false; }
    setArmed(null);
    const res = await act({ type: 'buy', slot, ...(targets||{}) });
    if (res) { audio.sfx('buy', { volume: 0.6 }); if (!preserveDetail) setDetail(null); }
    return res;
  }, [act,catalog]);

  const clearFieldTarget = useCallback(() => {
    fieldTargetRef.current = null;
    setFieldTarget(null);
    onFieldHighlight([]);
  }, [onFieldHighlight]);
  const cancelFieldTarget = useCallback(() => {
    const previous = fieldTargetRef.current;
    clearFieldTarget();
    previous?.onCancel?.();
  }, [clearFieldTarget]);
  const beginFieldTarget = useCallback((mode) => {
    if (!mode?.choices?.length) { toast(mode?.emptyText || '当前没有符合条件的目标', 'info'); return false; }
    const active = { ...mode, allowedUids: new Set(mode.choices.filter((x) => x.kind === 'friendly').map((x) => x.uid)), allowedSlots: new Set(mode.choices.filter((x) => x.kind === 'shopSlot').map((x) => x.slot)) };
    fieldTargetRef.current = active;
    setFieldTarget(active);
    const pieces = active.choices.filter((x) => x.kind === 'friendly').map((x) => stateRef.current.pieces.find((p) => p.uid === x.uid)).filter(Boolean);
    onFieldHighlight(pieces);
    if (mode.closePanel) setPanel(null);
    return true;
  }, [onFieldHighlight]);
  const chooseFieldTarget = useCallback((choice) => {
    const mode = fieldTargetRef.current;
    if (!mode) return false;
    if (!mode.choices.some((x) => x.kind === choice.kind && (x.uid ?? x.slot) === (choice.uid ?? choice.slot))) return false;
    clearFieldTarget();
    if (mode.submit) mode.submit(choice);
    else {
      const payload = mode.spec.kind === 'shopSlot' ? { shopSlots: [choice.slot] }
        : mode.spec.kind === 'magnetic' ? { magneticTargetUid: choice.uid } : { targetUid: choice.uid };
      buy(mode.slot, payload, { preserveDetail: true });
    }
    return true;
  }, [buy, clearFieldTarget]);

  const ready = useCallback(async () => {
    const before = stateRef.current;
    if (before.phase !== 'prep' || battleRef.current) return;
    setArmed(null); setDetail(null); setFacing(null);
    const res = await act({ type: 'ready' }, { keep: true });
    if (!res) return;
    const fought = (res.events || []).find((e) => e.type === 'battle');
    // the operators fight with the mode's tier on their plates (the simulation's unit info has the upstream record's)
    const replay = fought ? withCatalogTiers(await api.replay(id, fought.round), catalog) : null;
    const next = res.state;
    if (!replay) {
      toast('这一轮的战斗记录没有取到，直接显示结果', 'warn');
      setState(next);
      return;
    }
    const lastFrame = replay.frames[replay.frames.length - 1]?.snap;
    setBattle({ round: fought.round, replay, next, lpBefore: before.lp, lpLost: fought.lpLost || 0, result: next.lastBattle?.result || null,
      killed: 0, total: lastFrame?.total ?? null, done: false, finished: next.phase === 'finished' ? next.outcome : null });
  }, [act, id, catalog]);

  const closeBattle = useCallback(() => {
    const b = battleRef.current;
    if (!b) return;
    setState(b.next); setBattle(null); replayPosRef.current = -1;
    setDetail((d) => (d?.kind === 'unit' ? null : d));
  }, []);

  // ---- prep scene ------------------------------------------------------------------------------------------------
  const stageKey = useRef(null);
  useEffect(() => {
    if (!view || battle || !gd.ready) return;
    const stageId = state.board?.stageId;
    const stage = stageId ? data.lookup('stages', stageId) : null;
    if (stage && stageKey.current !== stageId) { view.setStage(stage); stageKey.current = stageId; }
    if (pen) { view.setCamera('pen'); return; }
    // The server-projected field is authoritative for boss prep; the prep camera helper supplies the matching
    // official framing and lets resize keep the shop band's camera option.
    const boss = state.board?.field === 'bossL';
    const round = boss ? (state.board?.bossRound ?? state.round) : state.round;
    const pub = { round, bossRound: boss ? round : null, hiddenRound: null, players: [{ playerId: id, seat: 0 }] };
    const cam = prepCameraFor(pub, id, shopCollapsed);
    cameraRef.current = cam;
    view.setCamera(cam.kind, cam.opts);
  }, [view, battle, gd.ready, state.board?.stageId, state.board?.field, state.board?.bossRound, state.round, pen]);
  useEffect(() => {
    if (!view || !gd.ready) return;
    const boss = state.board?.field === 'bossL';
    const round = boss ? (state.board?.bossRound ?? state.round) : state.round;
    const next = foldCamera({ pub: { round, bossRound: boss ? round : null, hiddenRound: null, players: [{ playerId: id, seat: 0 }] },
      myId: id, ownPrep: !battle && state.phase === 'prep', folded: shopCollapsed, pen,
      busy: !!dragging || !!facing || !!busy, current: cameraRef.current });
    if (!next) return;
    cameraRef.current = next;
    view.setCamera(next.kind, next.opts);
  }, [view, gd.ready, id, state.board?.field, state.board?.bossRound, state.round, state.phase, battle, shopCollapsed, pen, dragging, facing, busy]);
  useEffect(() => { if (battle) setPen(false); }, [battle]);

  const editable = state.phase === 'prep' && !battle && !busy && !facing;
  useEffect(() => {
    if (!view || battle || !gd.ready) return;
    view.setPrep(prepView(state, catalog), { editable, canPlace: (n, target) => canDrop(stateRef.current, n, target) });
  }, [view, battle, gd.ready, state, editable]);

  // drag, drop, click, hover on the field
  useEffect(() => {
    if (!view) return undefined;
    // a release on a tile that takes nothing says why (the drag controller emits no drop there): the pointer-up is
    // marked in the capture phase, before the controller ends the drag
    const ptr = { released: false, tile: null, off: null };
    const offs = [
      view.on('pieceDragStart', (e) => {
        setDragging(true);
        setSel(null);
        setDetail((d) => (d?.kind === 'piece' ? null : d));
        ptr.released = false; ptr.tile = null; ptr.off?.();
        const onUp = () => { ptr.released = true; };
        window.addEventListener('pointerup', onUp, { passive: true, capture: true });
        ptr.off = () => { window.removeEventListener('pointerup', onUp, { capture: true }); ptr.off = null; };
        view.highlightTiles(null);
        const tiles = legalTilesOf(stateRef.current, e?.uid);
        if (tiles.length) view.highlightTiles(tiles, 'legal');
        audio.sfx('pick', { volume: 0.5 });
      }),
      view.on('tileHover', (t) => { ptr.tile = t && typeof t === 'object' ? t : null; }),
      view.on('pieceDragEnd', (e) => {
        setDragging(false);
        view.highlightTiles(null);
        const released = ptr.released; const tile = ptr.tile;
        ptr.off?.();
        if (!e || e.dropped || !released || stateRef.current.phase !== 'prep') return;
        const reason = dropRefusal(stateRef.current, e.uid, tile);
        if (reason) { audio.sfx('error', { volume: 0.5 }); toast(reason, 'warn'); }
      }),
      view.on('pieceDrop', async (e) => {
        setDragging(false);
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
        if (!e) return;
        const mode = fieldTargetRef.current;
        if (mode && (!mode.spec || mode.spec.kind === 'friendly' || mode.spec.kind === 'magnetic')) {
          const uid = pieceByNum(stateRef.current, e.uid)?.uid;
          if (uid && chooseFieldTarget({ kind: 'friendly', uid })) return;
          toast('请点击高亮的友方目标；按 Esc 取消', 'info');
          return;
        }
        // an enemy of the preview pen, then any unit of a battle (the original game screen's order)
        const penKey = previewEnemyKey(e);
        if (penKey) { audio.sfx('click', { volume: 0.4 }); setDetail({ kind: 'enemy', id: penKey }); return; }
        if (e.unitId != null || e.unit) { audio.sfx('click', { volume: 0.4 }); setDetail({ kind: 'unit', unit: e.unit || { id: e.unitId } }); return; }
        if (battleRef.current) return;
        const piece = pieceByNum(stateRef.current, e.uid);
        if (!piece) return;
        audio.sfx('click', { volume: 0.4 });
        setArmed(null);
        setDetail({ kind: 'piece', uid: piece.uid });
        // a tap selects (underframe + range); right-click / long press only opens the card; a tap on the selected piece
        // deselects it and closes its card
        const wasSel = pressSel.current === piece.uid;
        pressSel.current = null;
        if (e.detail || e.button === 2 || stateRef.current.phase !== 'prep') return;
        setSel(wasSel ? null : piece.uid);
        if (wasSel) setDetail((d) => (d?.kind === 'piece' && d.uid === piece.uid ? null : d));
      }),
      // a tap on a special terrain tile explains it (upstream 0.1.4: 活性源石, 沼泽, 排气格栅, 深水区, 红蓝门, 传送)
      view.on('tileClick', (t) => {
        if (!t || !Number.isInteger(t.row) || !Number.isInteger(t.col)) return;
        const stageId = battleRef.current?.replay?.stageId || stateRef.current.board?.stageId;
        const info = terrainInfo(stageId ? data.lookup('stages', stageId) : null, t.row, t.col);
        if (!info) return;
        audio.sfx('click', { volume: 0.4 });
        setDetail({ kind: 'terrain', terrain: info });
      }),
      view.on('pieceHover', (e) => {
        if (battleRef.current) return;
        view.highlightTiles(null, 'range');
        const piece = e?.uid != null ? pieceByNum(stateRef.current, e.uid) : null;
        if (!piece || !isDeployed(piece)) return;
        showRange(view, rangeGridOf(catalog, piece), piece.row, piece.col, piece.dir || 'RIGHT', 'range');
      }),
    ];
    return () => { ptr.off?.(); for (const off of offs) { try { off?.(); } catch { /* ignore */ } } };
  }, [view, act, chooseFieldTarget]);

  // The renderer's usual ray picker can miss a visibly rendered unit when camera transforms or sprite bounds drift.
  // During explicit targeting, resolve clicks against the same rendered bounds used by the unit badges.
  useEffect(() => {
    const host = hostRef.current;
    if (!fieldTarget || !host || !view?.pieceScreenRect) return undefined;
    const onTargetPointer = (event) => {
      if (event.button !== 0) return;
      const x = event.clientX, y = event.clientY;
      for (const choice of fieldTarget.choices || []) {
        if (choice.kind !== 'friendly') continue;
        const id = Number(String(choice.uid).replace(/^\D+/, ''));
        if (!Number.isFinite(id)) continue;
        const rect = view.pieceScreenRect(id);
        if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        event.preventDefault();
        event.stopImmediatePropagation();
        chooseFieldTarget(choice);
        return;
      }
    };
    host.addEventListener('pointerdown', onTargetPointer, true);
    return () => host.removeEventListener('pointerdown', onTargetPointer, true);
  }, [fieldTarget, view, chooseFieldTarget]);

  // a press on the field deselects and closes a card the field opened (a tap on a piece re-opens it at release)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onDown = () => {
      pressSel.current = selRef.current;
      setSel(null);
      setDetail((d) => (closesOnFieldPress(d) ? null : d));
    };
    host.addEventListener('pointerdown', onDown, true);
    return () => host.removeEventListener('pointerdown', onDown, true);
  }, []);
  // the selected piece: gone, deployed elsewhere or no longer editable → deselect; on the board its range shows
  const selPiece = sel ? (state.pieces || []).find((p) => p.uid === sel) || null : null;
  const selTile = selPiece ? pieceTileOf(state, selPiece) : null;
  useEffect(() => { if (sel && (!selPiece || !selTile || state.phase !== 'prep' || battle)) setSel(null); }, [sel, selPiece, selTile, state.phase, battle]);
  const selRangeKey = selPiece && isDeployed(selPiece) ? `${selPiece.uid}:${selPiece.row},${selPiece.col}:${selPiece.dir || 'RIGHT'}:${selPiece.elite ? 1 : 0}:${selPiece.moduleId || ''}` : '';
  useEffect(() => {
    if (!view || !selRangeKey) return undefined;
    showRange(view, rangeGridOf(catalog, selPiece), selPiece.row, selPiece.col, selPiece.dir || 'RIGHT', SEL_RANGE);
    return () => showRange(view, null, 0, 0, null, SEL_RANGE);
  }, [view, selRangeKey]);

  // an armed operator card that completes a merge lights the tile its elite will take
  const armedSlot = armed && armed.startsWith('s') && !battle && state.phase === 'prep' ? state.shop.slots[Number(armed.slice(1))] : null;
  const mergeAt = armedSlot?.kind === 'chess' && !armedSlot.sold ? mergeHintOf(state, catalog, armedSlot.id)?.tile || null : null;
  const mergeAtKey = mergeAt ? `${mergeAt.row},${mergeAt.col}` : '';
  useEffect(() => {
    if (!view) return undefined;
    try { view.highlightTiles(mergeAt ? [[mergeAt.row, mergeAt.col]] : [], MERGE_HL); } catch { /* cosmetic */ }
    return () => { try { view.highlightTiles([], MERGE_HL); } catch { /* cosmetic */ } };
  }, [view, mergeAtKey]);

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
    cameraRef.current = { kind, opts: { rect: rec.field.rect, side: 'L' } };
    view.setCamera(kind, cameraRef.current.opts);
    audio.setFieldUnits([]);
    const { t0, duration } = replayClock(rec);
    replayPausedRef.current = false; view.setReplayPaused(false); replayTimeRef.current = t0; replayEndTimeRef.current = t0 + duration;
    setReplayPaused(false); setReplayRemaining(duration);
    let idx = 0; let gameT = t0 - 0.001; let last = performance.now(); let raf = 0; let shown = -1; let ended = false; let leaked = 0;
    let lastClockUpdate = last;
    const feed = () => {
      while (idx < frames.length && frames[idx].snap.t <= gameT) {
        const f = frames[idx++];
        // like the match server: the b.ev of a drain first, then its b.snap, both on the game clock
        if (f.ev.length) { view.pushEvents({ t: 'b.ev', fieldId, gt: f.snap.t, ev: f.ev }); audio.handleBattleEvents(f.ev); for (const e of f.ev) if (e[0] === 'leak') leaked++; }
        view.pushSnapshot(f.snap);
      }
      replayPosRef.current = idx - 1;
    };
    // 结算 voice (audio.js resultSpeaker / resultVoiceSlot, as the original game screen): an operator of this battle
    const speak = () => {
      try {
        const r = battleRef.current?.result; const mine = r?.perPlayer?.independent || Object.values(r?.perPlayer || {})[0] || null;
        const charId = resultSpeaker(mine, Math.random, (cid) => data.lookup('chess', cid)?.charId ?? null);
        if (charId) audio.voice(charId, resultVoiceSlot({ perfect: !!mine?.perfect, leaked: Array.isArray(mine?.leaked) ? mine.leaked.length : 0,
          killed: mine?.killed ?? r?.killed, total: mine?.total ?? r?.total, hard: ['HARD', 'ABYSS'].includes(stateRef.current.difficulty) }));
      } catch { /* a missing voice bank is silence */ }
    };
    const report = () => {
      const k = Math.max(0, idx - 1);
      if (k !== shown) { shown = k; const s = frames[k]?.snap; if (s) setBattle((b) => (b ? { ...b, killed: s.killed, total: s.total, hud: snapHud(s), leaked } : b)); }
    };
    const loop = (now) => {
      const step = stepReplayClock(gameT, last, now, speedRef.current, replayPausedRef.current);
      gameT = step.gameTime; last = step.previousNow;
      replayTimeRef.current = gameT;
      if (!replayPausedRef.current) {
        feed(); report();
        if (now - lastClockUpdate >= 200) {
          lastClockUpdate = now;
          setReplayRemaining(Math.max(0, t0 + duration - gameT));
        }
      }
      if (idx >= frames.length) {
        replayTimeRef.current = t0 + duration; setReplayRemaining(0);
        if (!ended) { ended = true; speak(); setTimeout(() => setBattle((b) => (b ? { ...b, done: true } : b)), 900); }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    // jump to the end state (render-demo seek): spawn what is still there, then the last snapshots
    seekRef.current = () => {
      cancelAnimationFrame(raf);
      const k = frames.length - 1;
      view.enterBattle(rec.field);
      cameraRef.current = { kind, opts: { rect: rec.field.rect, side: 'L', instant: true } };
      view.setCamera(kind, cameraRef.current.opts);
      const infos = new Map();
      for (let i = 0; i <= k; i++) for (const e of frames[i].ev) if (e[0] === 'spawn') infos.set(e[1].id, e[1]);
      const present = new Set(frames[k].snap.units.map((u) => u[0]));
      const spawns = [...infos.values()].filter((u) => present.has(u.id)).map((u) => ['spawn', u]);
      if (spawns.length) view.pushEvents({ fieldId, ev: spawns });
      for (let i = Math.max(0, k - 3); i <= k; i++) view.pushSnapshot(frames[i].snap);
      view.raw?.debug?.interp?.snapToNewest?.();
      for (let i = 0; i <= k; i++) for (const e of frames[i].ev) if (e[0] === 'leak') leaked++;
      idx = frames.length; replayPosRef.current = k; report();
      replayPausedRef.current = false; view.setReplayPaused(false); replayTimeRef.current = t0 + duration; setReplayPaused(false); setReplayRemaining(0);
      if (!ended) { ended = true; setBattle((b) => (b ? { ...b, done: true } : b)); }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); seekRef.current = null; replayPausedRef.current = false; view.setReplayPaused(false); replayTimeRef.current = 0; replayEndTimeRef.current = 0; setReplayPaused(false); };
  }, [view, battle?.replay, gd.ready]);

  // ---- the phase as the original game screen sees it: banner, cue and BGM (gameLogic phaseBanner, audio.js bgmKeyFor) --
  const rec = battle?.replay || null;
  const phasePub = rec ? (rec.kind === 'normal' ? { phase: PHASE.COMBAT, round: rec.round } : { phase: PHASE.FINAL_ASSAULT, round: rec.round, bossId: rec.bossId })
    : { phase: PHASE.PREP, round: state.round };
  const phaseKey = `${phasePub.phase}:${phasePub.round}`;
  useEffect(() => {
    audio.playBgm(bgmKeyFor('game', phasePub, combatTrackFor(phasePub.round)));
    if (state.phase === 'finished' && !rec) return;
    const b = phaseBanner(phasePub.phase, phasePub);
    if (b) setBanner({ ...b, key: phaseKey });
    if (phasePub.phase === PHASE.PREP) audio.sfx('rest', { volume: 0.7 });
    else if (phasePub.phase === PHASE.COMBAT) audio.sfx('battleStart');
    else audio.sfx('bossRoundSingle');
  }, [phaseKey]);

  // ---- component links (#piece-p12:tab=reference, #shop-2:tab=gear, #item-i7): open the linked component tab ------
  useEffect(() => {
    const follow = () => {
      const rawHash = location.hash.slice(1);
      const hash = decodeURIComponent(rawHash);
      const component = parseComponentLinkHash(location.hash);
      const st = stateRef.current;
      if (component?.kind === 'piece' && st.pieces.some((p) => p.uid === component.id)) setDetail({ kind: 'piece', uid: component.id, tab: component.tab });
      else if (component?.kind === 'shop' && st.shop.slots[Number(component.id)]) {
        const i = Number(component.id); const s = st.shop.slots[i];
        setDetail(s.kind === 'chess' ? { kind: 'shop', slot: i, tab: component.tab } : { kind: 'gear', id: s.id });
      } else if (component?.kind === 'gear' && catalog.gear[component.id]) setDetail({ kind: 'gear', id: component.id });
      else if (hash.startsWith('piece-') && st.pieces.some((p) => p.uid === hash.slice(6))) setDetail({ kind: 'piece', uid: hash.slice(6) });
      else if (hash.startsWith('shop-') && st.shop.slots[Number(hash.slice(5))]) {
        const i = Number(hash.slice(5)); const s = st.shop.slots[i];
        setDetail(s.kind === 'chess' ? { kind: 'shop', slot: i } : { kind: 'gear', id: s.id });
      } else if (hash.startsWith('gear-') && catalog.gear[hash.slice(5)]) setDetail({ kind: 'gear', id: hash.slice(5) });
      else if (hash.startsWith('item-') || hash === 'stock' || hash.startsWith('stock-')) {
        setPanelUid(null); setPanelKey(hash.startsWith('stock-') ? rawHash.slice(6) : null); setPanel('inventory');
      }
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  // without WebGL / the render engine the DOM view takes over: say so once (the original's toast), unless asked for
  useEffect(() => {
    if (viewKind !== 'fallback') return;
    let asked = null;
    try { asked = new URLSearchParams(location.search).get('render'); } catch { asked = null; }
    if (asked === 'fallback' || globalThis.__SP_RENDER__ === 'fallback') return;
    toast('当前设备无法启用 3D / WebGL 渲染，已切换为简化视图（功能不受影响）', 'info', { ttl: 5000 });
  }, [viewKind]);

  // ---- keyboard ----------------------------------------------------------------------------------------------------
  const keysRef = useRef({});
  keysRef.current = { panel, drawer, pen, detail, sel, armed, facing, reportOpen, fieldTarget };
  useEffect(() => {
    // the original's keys (ui/gameLogic.js shortcutFor): R refresh, F freeze, D level-up, Q retreat, X sell, Space
    // ready, Esc closes the topmost thing; dialogs own the keyboard, behind the drawer only Esc acts
    const onKey = (e) => {
      const a = shortcutFor(e);
      const L = keysRef.current;
      if (shortcutBlocked(a, { modal: !!L.panel || !!document.querySelector('.modal, .guide'), drawer: !!L.drawer })) return;
      if (a === 'escape') {
        if (L.facing) return; // the wheel takes its own Escape
        if (L.fieldTarget) { cancelFieldTarget(); e.preventDefault(); return; }
        if (L.reportOpen) setReportOpen(false);
        else if (L.drawer) setDrawer(null);
        else if (L.pen && !L.detail) setPen(false);
        else if (L.detail) { setDetail(null); setSel(null); setArmed(null); }
        else if (L.sel) setSel(null);
        else if (L.armed) setArmed(null);
        else if (battleRef.current) seekRef.current?.();
        else return;
        e.preventDefault();
        return;
      }
      if (battleRef.current) { if (a === 'ready') { e.preventDefault(); if (e.target instanceof HTMLElement && e.target.closest('button, [role="button"]')) e.target.blur(); toggleReplayPause(); } return; }
      if (stateRef.current.phase !== 'prep' || L.facing) return;
      e.preventDefault(); // a focused HUD button must not also activate (Space)
      if (a === 'ready' && e.target instanceof HTMLElement && e.target.closest('button, [role="button"]')) e.target.blur();
      if (a === 'retreat' || a === 'sell') {
        const piece = L.sel ? (stateRef.current.pieces || []).find((p) => p.uid === L.sel) : null;
        if (!piece) return;
        if (a === 'retreat' && isDeployed(piece)) retreatPiece(piece.uid);
        else if (a === 'sell') sellPiece(piece.uid);
        return;
      }
      if (a === 'refresh') act({ type: 'refresh' });
      else if (a === 'freeze') act({ type: 'freeze' });
      else if (a === 'levelUp') act({ type: 'upgrade' });
      else if (a === 'ready') ready();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, ready, retreatPiece, sellPiece, toggleReplayPause]);

  // ---- derived -----------------------------------------------------------------------------------------------------
  const stacks = useMemo(() => inventoryStacks(state.inventory, catalog), [state.inventory, catalog]);
  const offer = pendingOffer(state);
  const { overflow } = benchLayout(state);
  const deployed = deployedCount(state);
  const readyReason = state.phase !== 'prep' ? null : (state.pieces || []).some((p) => p.temp && !isDeployed(p)) ? '临时整备区还有干员' : deployed < 1 ? '至少部署一名干员' : deployed > state.deployCap ? `场上最多 ${state.deployCap} 名干员` : offer ? '请先完成当前选择' : null;
  const loading = viewKind === 'loading' || !gd.ready;

  // the stock panel, with an operator chosen to wear / receive and a tile picked (`key`: an inventoryStacks key)
  const openInventory = (uid = null, key = null) => { setPanelUid(uid || (detail?.kind === 'piece' ? detail.uid : null)); setPanelKey(key); setPanel('inventory'); };
  /**
   * A stock tile dropped on an operator: gear is worn (a badge stack whole, up to the operator's room), a supply that
   * asks for one own operator is used on it; the identity card (a faction to choose) and supplies asking for anything
   * else open the stock panel with that operator chosen.
   */
  const dropFromStock = (stack, uid) => {
    const piece = state.pieces.find((p) => p.uid === uid); if (!piece || state.phase !== 'prep') return;
    const item = stack.items[0]; const g = catalog.gear[stack.id] || {};
    if (stack.used) {
      const need = USE_NEEDS[stack.mechanism]; const count = Number(g.useCount) || 1;
      if (!need) act({ type: 'use-item', itemUid: item.uid });
      else if (need === 'target') act({ type: 'use-item', itemUid: item.uid, targetUid: uid });
      else if (need === 'source') act({ type: 'use-item', itemUid: item.uid, sourceUid: uid });
      else if (need === 'targets' && count === 1) act({ type: 'use-item', itemUid: item.uid, targets: [uid] });
      else openInventory(uid, stack.key);
      return;
    }
    if (g.identityFactions) { openInventory(uid, stack.key); return; }
    const room = (catalog.rules?.equipmentCapacity ?? 999) - piece.equipment.reduce((n, x) => n + (x.quantity || 1), 0);
    act({ type: 'equip', itemUid: item.uid, targetUid: uid, quantity: stack.badge || g.quantityEquippable === true ? Math.max(1, Math.min(item.quantity || 1, room)) : 1 });
  };
  const openInherit = (uid) => { setPreview(null); setPanelUid(uid); setPanel('inherit'); };
  const runPreview = useCallback(async (donorUid, receiverUid) => {
    setPreview(null);
    const res = await api.act(id, stateRef.current.revision, { type: 'inherit-preview', donorUid, receiverUid });
    const pv = res.ok ? res.events?.find((x) => x.type === 'inherit-preview')?.preview : null;
    setPreview(pv ? { ...pv, donorUid, receiverUid } : { ok: false, error: res.error?.code || 'BAD_TARGET', donorUid, receiverUid });
  }, [id]);

  // a battle unit's card reads the replay where it is (the original card's live getter): HP from the frame's snapshot,
  // stats from the newest per-second stats record (server/modes/independent/battle.js REPLAY_STATS_EVERY)
  const battleCard = battle?.replay ? {
    snapHp: (unitId) => {
      const f = battle.replay.frames[Math.max(0, replayPosRef.current)];
      const u = f?.snap?.units?.find((x) => x[0] === unitId);
      return u ? { hp: u[3], max: u[4] } : null;
    },
    stats: (unitId) => {
      const fr = battle.replay.frames;
      for (let i = Math.min(fr.length - 1, Math.max(0, replayPosRef.current)); i >= 0; i--) { const e = fr[i].stats?.[unitId]; if (e) return e; }
      return null;
    },
    fieldPieceUids: () => {
      const frames = battle.replay.frames;
      const frame = frames[Math.max(0, replayPosRef.current)];
      const liveIds = new Set((frame?.snap?.units || []).filter((unit) => Number(unit[3]) > 0).map((unit) => unit[0]));
      return (battle.replay.field?.units || []).filter((unit) => unit?.side === 'ally' && unit.kind === 'op'
        && liveIds.has(unit.id) && typeof unit.uid === 'string').map((unit) => unit.uid);
    },
    fieldPieceStats: () => {
      const frames = battle.replay.frames;
      const frame = frames[Math.max(0, replayPosRef.current)];
      const live = new Map((frame?.snap?.units || []).filter((unit) => Number(unit[3]) > 0).map((unit) => [unit[0], { hp: unit[3], maxHp: unit[4] }]));
      return Object.fromEntries((battle.replay.field?.units || []).filter((unit) => unit?.side === 'ally' && unit.kind === 'op'
        && live.has(unit.id) && typeof unit.uid === 'string').map((unit) => [unit.uid, live.get(unit.id)]));
    },
    fieldConditionPieces: () => {
      const frames = battle.replay.frames;
      const frame = frames[Math.max(0, replayPosRef.current)];
      const live = new Map((frame?.snap?.units || []).filter((unit) => Number(unit[3]) > 0)
        .map((unit) => [unit[0], { col: Math.round(Number(unit[1])), row: Math.round(Number(unit[2])), hp: unit[3], maxHp: unit[4] }]));
      return (battle.replay.field?.units || []).filter((unit) => unit?.side === 'ally' && ['op', 'token'].includes(unit.kind) && live.has(unit.id))
        .map((unit) => {
          const piece = unit.kind === 'op' && unit.uid ? stateRef.current.pieces.find((p) => p.uid === unit.uid) : null;
          const uid = unit.uid || `battle-unit:${unit.id}`;
          return {
            ...(piece || {}), uid, kind: unit.kind, chessId: piece?.chessId || unit.defId,
            playerId: piece?.playerId ?? unit.ownerId, ownerId: unit.ownerId,
            row: live.get(unit.id).row ?? unit.row, col: live.get(unit.id).col ?? unit.col, dir: unit.dir || piece?.dir || 'RIGHT',
            elite: piece?.elite ?? !!unit.golden, moduleId: piece?.moduleId || unit.moduleId || 'none',
            factions: unit.darkmoonFactionTags || piece?.factions || [],
            darkmoonFactionTags: unit.darkmoonFactionTags || [], darkmoonCover: !!unit.darkmoonCover,
            equipment: piece?.equipment || (unit.items || []).map((id) => ({ id, quantity: 1 })),
            hp: live.get(unit.id).hp, currentHp: live.get(unit.id).hp, maxHp: live.get(unit.id).maxHp,
          };
        });
    },
  } : null;

  return html`<div class=${cx('screen', 'gm', battle ? 'gm--combat' : 'gm--prep', 'ix-game', shopCollapsed && 'is-collapsed', pen && 'is-pen', fieldTarget && 'is-targeting')} data-testid="ix-game">
    <div class="gm__field" ref=${hostRef} onContextMenu=${(e) => e.preventDefault()}></div>
    ${loading ? html`<div class="gm__loading"><${Spinner} label="LOADING FIELD" /></div>` : null}
    <div class="gm__vignette" aria-hidden="true"></div>
    <div class="gm__hud">
      ${fieldTarget ? html`<div class="ix-target-prompt" role="status"><span>${fieldTarget.label || (fieldTarget.spec?.kind === 'shopSlot' ? '点击高亮的商店卡牌进行分配' : '点击高亮友方干员作为目标')}</span><button type="button" onClick=${() => { cancelFieldTarget(); }}>取消 <kbd>Esc</kbd></button></div>` : null}
      <${TopBar} state=${state} battle=${battle} busy=${busy} readyReason=${readyReason} onReady=${ready} onExit=${leave} drawer=${drawer} onDrawer=${setDrawer}
        pen=${pen} onPen=${() => setPen((x) => !x)} production=${!battle ? html`<${ProductionPanel} state=${state} catalog=${catalog} onReport=${() => setReportOpen(true)} />` : null}
        replayControls=${battle ? { paused: replayPaused, remaining: Math.ceil(replayRemaining), duration: Math.ceil(replayClock(battle.replay).duration),
          speed, speeds: SPEEDS, onSpeed: setSpeed, onToggle: toggleReplayPause,
          endLabel: battleEndControl(battle.done, !!battle.finished).label,
          onEnd: battleEndControl(battle.done, !!battle.finished).action === 'close' ? closeBattle : () => seekRef.current?.() } : null} />
      ${battle && replayPaused ? html`<div class="ix-replay-pause" role="status" data-testid="ix-replay-paused">
        <span>作战已暂停</span><${PauseButton} paused=${true} onToggle=${toggleReplayPause} />
      </div>` : null}
      ${!battle ? html`
        <${InventoryStrip} stacks=${stacks} state=${state} view=${view} catalog=${catalog} onOpen=${() => openInventory()}
          onTap=${(s) => openInventory(null, s.key)} onDrop=${dropFromStock} />
        ${!pen ? html`<${EffectsColumn} effects=${state.playerEffects} catalog=${catalog} />` : null}
        <${BenchOverflow} pieces=${overflow} catalog=${catalog} onPick=${(uid) => {
          if (fieldTarget?.allowedUids?.has(uid)) chooseFieldTarget({ kind: 'friendly', uid });
          else setDetail({ kind: 'piece', uid });
        }} />
        ${state.phase === 'prep' && !pen ? html`<${ShopBar} state=${state} catalog=${catalog} busy=${busy} armed=${armed} deployed=${deployed} deployCap=${state.deployCap}
          onArm=${(key, slot) => { setArmed(key); if (slot) setDetail({ kind: slot.kind === 'chess' ? 'shop' : 'gear', slot: Number(key.slice(1)), id: slot.id }); }}
          targetSlots=${fieldTarget?.spec?.kind === 'shopSlot' ? fieldTarget.choices.map((x) => x.slot) : []} onTargetShopSlot=${(slot) => chooseFieldTarget({ kind: 'shopSlot', slot })}
          onBuy=${buy} onUpgrade=${() => { setArmed(null); act({ type: 'upgrade' }); }} onRefresh=${() => { setArmed(null); act({ type: 'refresh' }); }}
          onFreeze=${() => act({ type: 'freeze' })} collapsed=${shopCollapsed} onCollapse=${(v) => { setShopCollapsed(v); if (v) setArmed(null); }}
          onDetail=${(i) => { const s = state.shop.slots[i]; setArmed(null); if (s) setDetail({ kind: s.kind === 'chess' ? 'shop' : 'gear', slot: i, id: s.id }); }} />` : null}
      ` : html`<${DpCounter} dp=${battle.hud?.dp} />
      `}
      <${UnitBadges} view=${view} pieces=${state.pieces} catalog=${catalog} hidden=${loading || pen} growthMode=${state.growthMode || 'badges'} battleStats=${battle ? battleCard.stats : null} battleUnits=${battle ? battle.replay?.field?.units || [] : null}
        targetUids=${fieldTarget?.choices?.filter((x) => x.kind === 'friendly').map((x) => x.uid) || []} />
      <${DetailCard} target=${detail} state=${state} catalog=${catalog} busy=${busy} battle=${battleCard} shopOpen=${!battle && state.phase === 'prep' && !pen && !shopCollapsed}
        onClose=${() => { cancelFieldTarget(); setDetail(null); setArmed(null); }} onAct=${simple} onBuy=${buy} onBeginTarget=${beginFieldTarget} onCancelTarget=${cancelFieldTarget} onInherit=${openInherit} onEquipHere=${(uid) => openInventory(uid)}
        onFieldHighlight=${onFieldHighlight} rangeTilesFor=${rangeTilesFor} />
      ${selPiece && selTile && view && !facing && !battle && state.phase === 'prep' ? html`<${Underframe} key=${selPiece.uid} view=${view}
        row=${selTile.row} col=${selTile.col} busy=${busy} name=${catalog.operators?.[selPiece.chessId]?.name || ''}
        actions=${{ retreat: isDeployed(selPiece), sell: catalog.rules?.sellPrice ?? 1, destroy: false }}
        onRetreat=${() => retreatPiece(selPiece.uid)} onSell=${() => sellPiece(selPiece.uid)} />` : null}
      <div class="gm__corner">
        <button type="button" class="gm__gear" aria-label="设置" title="设置" onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /></button>
        <${FullscreenButton} class="gm__gear gm__fs" />
        <${ElementPicker} view=${view} />
        ${state.phase === 'finished' && !battle && finalHidden ? html`<button type="button" class="gm__gear" aria-label="本局结算" title="本局结算" onClick=${() => setFinalHidden(false)}><${GIcon} name="flag" /></button>` : null}
      </div>
    </div>
    ${banner ? html`<${PhaseBanner} key=${banner.key} mode="overlay" title=${banner.title} sub=${banner.sub} micro=${banner.micro}
      tone=${banner.tone} duration=${banner.duration || 1500} onDone=${() => setBanner(null)} />` : null}
    ${facing && view ? html`<${FacingWheel} key=${`${facing.uid}:${facing.row},${facing.col}`} view=${view} row=${facing.row} col=${facing.col}
      grid=${facing.grid} name=${facing.name} onPreview=${(dir) => setPieceDir(view, facing.n, dir || facing.dir)} onCommit=${commitFacing} onCancel=${cancelFacing} />` : null}
      ${!battle && offer && !fieldTarget ? html`<${OfferOverlay} offer=${offer} state=${state} catalog=${catalog} busy=${busy} onChoose=${simple} onBeginTarget=${beginFieldTarget} />` : null}
    ${state.phase === 'finished' && !battle && !finalHidden ? html`<${FinalScreen} state=${state} catalog=${catalog} onLook=${() => setFinalHidden(true)} onLeave=${onLeave} />` : null}
    ${reportOpen && !battle && state.lastBattle ? html`<${ResultPanel} review=${true} catalog=${catalog} pieces=${state.pieces} onClose=${() => setReportOpen(false)}
      battle=${{ round: state.lastBattle.round, result: state.lastBattle.result, lpLost: state.lastBattle.lpLost || 0 }} />` : null}
    ${battle?.done ? html`<${GuardedResultPanel} battle=${battle} catalog=${catalog} pieces=${state.pieces} finished=${battle.finished} onClose=${closeBattle} />` : null}
    <${SettingsModal} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} />
    ${drawer ? html`<${EnemyDrawer} tab=${drawer} onTab=${setDrawer} onClose=${() => setDrawer(null)} info=${html`<${MatchInfo} state=${state} catalog=${catalog} />`}
      pub=${{ round: state.round, factions: state.board?.factions || [], bossId: state.board?.bossId || null, lastRound: state.board?.bossRound ?? state.roundLimit }}
      priv=${{ nextEnemies: state.nextEnemies || [] }} onEnemy=${(key, count) => setDetail({ kind: 'enemy', id: key, count })} onChess=${() => {}} />` : null}
    <${InventoryPanel} open=${panel === 'inventory'} focus=${panelKey} state=${state} catalog=${catalog} busy=${busy} targetUid=${panelUid} onTarget=${setPanelUid}
      onBeginTarget=${beginFieldTarget} onCancelTarget=${() => setPanel('inventory')}
      onClose=${() => { setPanel(null); if (/^#(stock|item)/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); }} onAct=${simple} />
    <${InheritPanel} open=${panel === 'inherit'} state=${state} catalog=${catalog} busy=${busy} fromUid=${panelUid} preview=${preview}
      onPreview=${runPreview} onClose=${() => setPanel(null)} onConfirm=${async (action) => { const res = await simple(action); if (res) setPanel(null); }} />
  </div>`;
}
