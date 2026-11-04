import { Fragment, h } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { assaultAssets, canDeployMore, createPieceUidMap, displayName, errorMessage, legalTilesFor, modelDirection, pieceRecord, rendererDirection, stablePrepView } from './model.js';
import { toast } from '../ui/toasts.js';
import { FacingWheel, holdPiece, setPieceDir, useTileScreen, showRange } from '../ui/facingWheel.js';
import { inspectRange } from '../screens/game/range.js';
import { SEL_RANGE } from '../screens/game/marks.js';
import { unitStatsEntry } from '../../../shared/protocol.js';
import { Button, HexBadge, ProgressBar, Spinner } from '../ui/components.js';
import { GIcon, UnitThumb } from '../ui/gameComponents.js';
import { pendingDeployments } from './client-sim.js';
import { TempRowNotice, Underframe } from '../ui/underframe.js';
import { hudPadding, hudBands as prepHudBands } from '../ui/fieldHost.js';
import { copyText } from '../ui/clipboard.js';
import { settingsStore } from '../ui/settings.js';
import { deviceInfo, deviceTipAt, fieldTile, noteDeviceUnits, shortcutFor, terrainInfo } from '../ui/gameLogic.js';
import { t } from '../../../shared/i18n.js';
import { createFxCompat, loadFxSkillMap } from './fxCompat.js';
import { calculateSellPrice } from '../../../shared/assault/shops.js';

const html = htm.bind(h);
const FIELD_MOUNT_TIMEOUT_MS = 12000;
const editablePhase = state => ['nodeChoice', 'shop', 'event', 'battlePrep'].includes(state?.phase);

/**
 * Why `actual` may not go to the board tile (row, col), or null.  The server refuses a deployment past the cap
 * (POPULATION_FULL) with the same sum, so the page refuses it before the piece leaves the bench.
 */
function deployRefusal(state, catalog, actual, row, col, field) {
  if (!legalTilesFor(actual, state, field).some(([r, c]) => r === row && c === col)) return 'tile';
  return canDeployMore(state, catalog, actual) ? null : 'full';
}

export function fieldMountFailureMessage(error) {
  if (error) console.error('[Assault] field renderer mount failed', error);
  return t('操作没有完成，请检查当前局面后重试。');
}

export function withFieldMountTimeout(promise, controller, label, disposeLate = null) {
  const { signal } = controller;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (done, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      done(value);
    };
    const onAbort = () => finish(reject, signal.reason || new DOMException('Field mount cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      error.name = 'TimeoutError';
      controller.abort(error);
      finish(reject, error);
    }, FIELD_MOUNT_TIMEOUT_MS);
    Promise.resolve(promise).then(value => {
      if (signal.aborted) { try { disposeLate?.(value); } catch { /* a late, cancelled view is already obsolete */ } return; }
      finish(resolve, value);
    }, error => finish(reject, error));
    if (signal.aborted) onAbort();
  });
}
// PIXI owns skeletons by URL across field views. Keep one Assault store for a runtime catalog so an
// old scene's quiet LRU cannot unload textures still referenced by its replacement scene.
const catalogResources = new WeakMap();
function refreshFieldData(resources, catalog) {
  if (resources.catalog === catalog) return;
  Object.assign(resources.data, catalog.nativeData);
  resources.data.chess = { ...resources.chess, ...(catalog.nativeData?.chess || {}) };
  resources.catalog = catalog;
}
function syncBattleData(data, session) {
  const compiled = session?.built?.data;
  if (!data || !compiled) return;
  const chess = { ...(data.chess || {}), ...(compiled.chess || {}) };
  Object.assign(data, compiled);
  data.chess = chess;
}
function fieldResources(catalog, createAssets) {
  // main.js adds each battle's nativeData through a catalog clone; runtime stays the same catalog.
  const identity = catalog.runtime;
  let resources = catalogResources.get(identity);
  if (resources) { refreshFieldData(resources, catalog); return resources; }
  const assets = createAssets({ manifest: assaultAssets(catalog.assets, catalog.nativeData?.assets), spineMax: 60 });
  const chess = Object.fromEntries(Object.entries(catalog.runtime.bodies || {}).map(([id, body]) => [id, {
    chessId: id, charId: id, tier: body.tier || 1, assets: { spine: id, avatar: id },
  }]));
  resources = { assets, data: {}, chess, catalog: null };
  refreshFieldData(resources, catalog);
  catalogResources.set(identity, resources);
  return resources;
}

function PendingDeployment({ view, entry, piece, catalog, onOpen }) {
  const g = useTileScreen(view, entry.row, entry.col);
  if (!g || !piece) return null;
  const size = Math.max(32, Math.min(64, g.s * .65));
  const label = t('等待部署');
  return html`<div class="uframe" style=${`left:${g.x}px;top:${g.y}px;width:${size}px;height:${size}px`}>
    <button type="button" class="btn btn--ghost btn--sm" style="pointer-events:auto;display:flex;flex-direction:column;height:auto;gap:2px;padding:3px"
      aria-label=${`${displayName(catalog,piece.charId)} · ${label}`} title=${`${label} · ${Math.ceil(entry.eta || 0)}s`}
      onClick=${()=>onOpen(piece)} onContextMenu=${event=>{event.preventDefault();void copyText(pieceHref(piece.uid));onOpen(piece);}}>
      <${UnitThumb} id=${entry.charId} tier=${entry.tier} size="xs" />
      <${HexBadge} value=${html`<${GIcon} name="dp" class="hex__icon" />${entry.cost}`} title=${t('部署费用')} tone="amber" size="sm" />
      <${ProgressBar} value=${entry.dp} max=${entry.cost} tone="amber" size="sm" />
    </button>
  </div>`;
}

function SummonPreset({view,preset,name,onOpen,valid}) {
  const g=useTileScreen(view,preset.row,preset.col);
  if(!g)return null;
  return html`<div class="uframe" style=${`position:fixed;z-index:21;transform:translate(-50%,-50%);pointer-events:none;left:${g.x}px;top:${g.y}px;opacity:.85`}>
    <button type="button" class="btn btn--ghost btn--sm" aria-invalid=${!valid}
      style=${`pointer-events:auto;background:${valid?'#152d26':'#3b2020'};border:1px dashed ${valid?'#72e0b3':'#ff938a'};font-size:12px`}
      onClick=${onOpen} title=${valid?name:`${name} · ${t('等待部署')}`}><${GIcon} name="target" />${name}${valid?'':' !'}</button></div>`;
}

export function nativePrepView(prep) {
  const source = Array.isArray(prep?.hand) ? prep.hand : [];
  const hand = source.slice(0, 10);
  const temp = source.slice(10, 12).filter((piece) => piece && typeof piece === 'object')
    .map((piece, index) => ({ ...piece, area: 'temp', index }));
  return { ...prep, hand, temp };
}

function fieldMode(field, battle) {
  const boss = field?.kind === 'boss' || field?.kind === 'hidden' || field?.boardRegion?.deployField === 'bossL' || field?.field === 'bossL';
  return battle ? (boss ? 'boss' : 'normal') : (boss ? 'bossPrep' : 'prep');
}

function fieldIdentity(field) {
  return [field?.field, field?.kind, field?.boardRegion?.deployField, field?.side].join(':');
}

function encounterPen(catalog, state) {
  const id = state?.currentNode?.encounterId;
  const encounter = catalog?.design?.encounters?.encounters?.find((item) => item.id === id);
  const spawns = encounter?.wave?.spawns;
  return Array.isArray(spawns) ? spawns.map((spawn) => ({
    ...spawn,
    enemyKey: spawn?.key || spawn?.enemyKey || spawn?.bossId,
    count: Number.isFinite(Number(spawn?.count)) && Number(spawn.count) > 0 ? Number(spawn.count) : 1,
  })).filter((spawn) => typeof spawn.enemyKey === 'string' && spawn.enemyKey) : null;
}

function pieceHref(uid) {
  const url = new URL(location.href);
  url.hash = `piece=${encodeURIComponent(uid)}`;
  return url.toString();
}

function sellPrice(catalog, piece, state) {
  return calculateSellPrice(piece,{catalog:catalog.runtime,design:catalog.design},state);
}

/** The Assault renderer and its native HUD overlays. */
export function NativeAssaultField({ catalog, state, field, onAction, onOpen, battleSession = null, battleFrame = null, shopOpen = true, pen = false, onEnemyDetail, onTerrainDetail, onReady, summonPlacement = null, onSummonPlacementEnd, inspection=null,onInspectionClose,onUnitDetail }) {
  const host = useRef(null);
  const view = useRef(null);
  const dataRef = useRef(null);
  const catalogIdentity = catalog?.runtime;
  const resources = catalogResources.get(catalogIdentity);
  if (resources) { refreshFieldData(resources, catalog); dataRef.current = resources.data; }
  const stateRef = useRef(state);
  const fieldRef = useRef(field);
  const catalogRef = useRef(catalog);
  const actionRef = useRef(onAction);
  const openRef = useRef(onOpen);
  const sessionRef = useRef(battleSession);
  const shopRef = useRef(shopOpen);
  const enemyDetailRef = useRef(onEnemyDetail);
  const terrainDetailRef = useRef(onTerrainDetail);
  const penRef = useRef(pen);
  const readyRef = useRef(onReady);
  const inspectionRef=useRef(null),pressSelection=useRef(null);
  inspectionRef.current={value:inspection,close:onInspectionClose,unit:onUnitDetail};
  const summonRef = useRef(null);
  summonRef.current={selection:summonPlacement,end:onSummonPlacementEnd};
  const syncPrepRef = useRef(null);
  const deviceUnitsRef = useRef(new Map());
  const snapUnitsRef = useRef(new Map());
  const uidMapRef = useRef(createPieceUidMap(state?.pieces || []));
  const [selectedUid, setSelectedUid] = useState(null);
  const [facing, setFacing] = useState(null);
  const [mountAttempt, setMountAttempt] = useState(0);
  const [mountState, setMountState] = useState({ kind: 'loading', message: '' });
  const automaticRetries = useRef(0);

  stateRef.current = state;
  fieldRef.current = field;
  catalogRef.current = catalog;
  actionRef.current = onAction;
  openRef.current = onOpen;
  sessionRef.current = battleSession;
  shopRef.current = shopOpen;
  enemyDetailRef.current = onEnemyDetail;
  terrainDetailRef.current = onTerrainDetail;
  penRef.current = pen;
  readyRef.current = onReady;
  uidMapRef.current = createPieceUidMap(state?.pieces || []);

  const context = { ...(state?.board || {}), ...(field || {}) };
  const stageId = context.stageId || '';
  const kind = fieldMode(context, !!battleSession?.battle);
  const identity = fieldIdentity(context);

  useEffect(() => {
    let live = true;
    let cleanup = () => {};
    let retryListener = null;
    let autoRetryPending = false;
    const controller = new AbortController();
    setMountState({ kind: 'loading', message: '' });
    (async () => {
      try {
        const [{ createFieldView }, { createAssets }, audioModule] = await withFieldMountTimeout(Promise.all([
          import('../render/app.js'), import('../assets.js'), import('../audio.js'),
        ]), controller, 'Assault renderer imports');
        if (!live || controller.signal.aborted) return;
        const currentCatalog = catalogRef.current;
        const { assets, data } = fieldResources(currentCatalog, createAssets);
        dataRef.current = data;
        syncBattleData(data, sessionRef.current);
        const fxCompat = createFxCompat(await loadFxSkillMap());
        const pendingView = Promise.resolve().then(() => createFieldView(host.current, {
          data, assets, audio: audioModule.audio, cyclePick: true, tierChips: 'stars',
          fx: fxCompat,
          signal: controller.signal,
          noPictureIds: ['token_10039_ulpia_block', 'token_10065_demetr_dmtpos'],
          padding: (cameraKind, size) => hudPadding(cameraKind, size),
          hud: (cameraKind, size) => prepHudBands(cameraKind, size, { shop: shopRef.current }),
        }));
        const made = await withFieldMountTimeout(pendingView, controller, 'Assault field view', view => view?.destroy?.());
        if (!live || controller.signal.aborted) { made.destroy(); return; }
        view.current = made;
        globalThis.__SP_VIEW__ = made; // recorder / E2E introspection, as in the shared field host
        let offDrop = null, offClick = null, offTile = null, offHover = null, offDragStart = null, offDragEnd = null;
        cleanup = () => {
          syncPrepRef.current = null; offDrop?.(); offClick?.(); offTile?.(); offHover?.(); offDragStart?.(); offDragEnd?.(); made.destroy();
          if (globalThis.__SP_VIEW__ === made) globalThis.__SP_VIEW__ = null;
          if (view.current === made) { view.current = null; readyRef.current?.(null); }
        };
        made.setSettings?.(settingsStore.get());
        const initialContext = { ...(stateRef.current?.board || {}), ...(fieldRef.current || {}) };
        const stage = data.stages?.[initialContext.stageId];
        if (stage) made.setStage({ ...stage, terrainOverlay: true });
        made.setCamera?.(penRef.current && stateRef.current?.phase !== 'battle' ? 'pen' : fieldMode(initialContext, !!sessionRef.current?.battle), { side: initialContext.side || 'L', shop: shopRef.current });

        const canPlace = (piece, row, col, target) => {
          const currentState = stateRef.current;
          const map = uidMapRef.current;
          const uid = map.uidOf(piece?.uid);
          const actual = currentState?.pieces?.find((item) => item.uid === uid);
          if (!actual || !editablePhase(currentState)) return false;
          if (target?.area === 'hand') {
            const onBench = !Number.isInteger(actual.row) || !Number.isInteger(actual.col);
            const benchCount = (currentState.pieces || []).filter((item) => !Number.isInteger(item.row) || !Number.isInteger(item.col)).length;
            return onBench || benchCount < 12;
          }
          return deployRefusal(currentState, catalogRef.current, actual, row, col, { ...(currentState.board || {}), ...(fieldRef.current || {}) }) === null;
        };
        const syncPrep = () => made.setPrep(nativePrepView({ ...stablePrepView(stateRef.current, uidMapRef.current),
          nextEnemies: encounterPen(catalogRef.current,stateRef.current) }), {
          editable: editablePhase(stateRef.current), canPlace,
        });
        if (sessionRef.current?.battle) {
          const battleField = sessionRef.current.field || fieldRef.current || context;
          made.enterBattle(battleField);
          deviceUnitsRef.current = noteDeviceUnits(new Map(), { units: battleField.units });
          made.setLocalFeed?.({ on: true, speed: sessionRef.current.speed });
        } else syncPrep();
        syncPrepRef.current = syncPrep;

        // A release on a tile the piece would fit except for the deployment cap says so (as the native field does for a
        // refused drop): the piece goes back to the bench and the existing 「已达到部署上限」 notice shows.
        let hoverTile = null, released = false, offUp = null;
        offHover = made.on('tileHover', (tile) => { hoverTile = tile && typeof tile === 'object' ? tile : null; });
        offDragStart = made.on('pieceDragStart', () => {
          released = false; hoverTile = null; offUp?.();
          const onUp = () => { released = true; };
          window.addEventListener('pointerup', onUp, { passive: true, capture: true });
          offUp = () => { window.removeEventListener('pointerup', onUp, { capture: true }); offUp = null; };
        });
        offDragEnd = made.on('pieceDragEnd', (event) => {
          const tile = hoverTile, wasReleased = released;
          offUp?.();
          if (!event || event.dropped || !wasReleased || tile?.area !== 'board' || !editablePhase(stateRef.current)) return;
          const actual = stateRef.current?.pieces?.find((item) => item.uid === uidMapRef.current.uidOf(event.uid));
          if (!actual || deployRefusal(stateRef.current, catalogRef.current, actual, tile.row, tile.col,
            { ...(stateRef.current?.board || {}), ...(fieldRef.current || {}) }) !== 'full') return;
          toast(t('已达到部署上限'), 'warn');
          audioModule.audio?.sfx?.('error', { volume: 0.5 });
        });
        offDrop = made.on('pieceDrop', ({ uid, target }) => {
          const uidString = uidMapRef.current.uidOf(uid);
          if (!uidString || !target || !editablePhase(stateRef.current)) return;
          if (target.area === 'hand') {
            setFacing(null);
            setSelectedUid(null);
            actionRef.current('bench', { uid: uidString });
            return;
          }
          if (!Number.isInteger(target.row) || !Number.isInteger(target.col)) return;
          const piece = stateRef.current.pieces?.find((item) => item.uid === uidString);
          if (!piece) return;
          const dir = rendererDirection(piece.dir || 'E');
          const body = pieceRecord(catalogRef.current, piece);
          holdPiece(made, uid, { row: target.row, col: target.col });
          setPieceDir(made, uid, dir);
          setFacing({ uid: uidString, numberUid: uid, row: target.row, col: target.col, dir,
            grid: body?.simChess?.rangeGrid || body?.rangeGrid || [], name: piece.name || displayName(catalogRef.current, piece.charId) });
        });
        const openPiece = (event = {}) => {
          const { uid, unitId, button } = event;
          const enemyKey = event.enemyKey || event.unit?.enemyKey || event.unit?.defId;
          if ((event.preview || event.unit?.preview) && enemyKey) {
            enemyDetailRef.current?.(enemyKey);
            return;
          }
          const activeSession = sessionRef.current;
          const battleEnemy = Number.isInteger(unitId)
            ? activeSession?.battle?.enemyUnits?.find((unit) => unit.id === unitId) || activeSession?.battle?.unitById?.(unitId) : null;
          const combatEnemyKey = battleEnemy?.defId || battleEnemy?.enemyKey || enemyKey;
          if ((battleEnemy?.side === 'enemy' || event.unit?.side === 'enemy') && combatEnemyKey) {
            enemyDetailRef.current?.(combatEnemyKey, unitId ?? battleEnemy?.id);
            return;
          }
          const battleUnit = Number.isInteger(unitId)
            ? activeSession?.battle?.allyUnits?.find((unit) => unit.id === unitId) : null;
          if(battleUnit?.kind==='token') {inspectionRef.current?.unit?.(battleUnit);return;}
          const sourceUid = battleUnit?.kind === 'op' ? battleUnit.uid : battleUnit?.ownerUnit?.uid ?? uid;
          const map = uidMapRef.current;
          const known = typeof sourceUid === 'string' && stateRef.current?.pieces?.some((item) => item.uid === sourceUid);
          const uidString = known ? sourceUid : map.uidOf(sourceUid);
          const piece = stateRef.current?.pieces?.find((item) => item.uid === uidString);
          if (!piece) return;
          if (button === 2 || event.detail) void copyText(pieceHref(piece.uid));
          if(button!==2&&!event.detail&&pressSelection.current===piece.uid) {setSelectedUid(null);inspectionRef.current?.close?.();pressSelection.current=null;return;}
          pressSelection.current=null;
          setSelectedUid(piece.uid);
          openRef.current(piece);
        };
        offClick = made.on('pieceClick', openPiece);
        offTile = made.on('tileClick', (tile = {}) => {
          setSelectedUid(null);
          if (!Number.isInteger(tile.row) || !Number.isInteger(tile.col)) return;
          const currentContext = { ...(stateRef.current?.board || {}), ...(fieldRef.current || {}) };
          const currentStage = dataRef.current?.stages?.[currentContext.stageId] || null;
          const deployField = currentContext.boardRegion?.deployField || currentContext.field;
          const [row, col] = fieldTile(deployField, tile.row, tile.col);
          const summon=summonRef.current?.selection;
          if(summon&&editablePhase(stateRef.current)) {
            const owner=stateRef.current.pieces.find(piece=>piece.uid===summon.uid);
            if(!owner?.summonLegalTiles?.[summon.tokenId]?.some(([r,c])=>r===tile.row&&c===tile.col))return;
            setFacing({...summon,row:tile.row,col:tile.col,dir:rendererDirection(owner.dir||'E'),grid:[],summon:true});
            return;
          }
          const battleField = sessionRef.current?.field;
          const inBattle = !!sessionRef.current?.battle && !!battleField && !battleField.prep;
          const device = inBattle
            ? deviceTipAt(currentStage, row, col,
              { units: [...deviceUnitsRef.current.values()], snap: snapUnitsRef.current })
            : deviceInfo(currentStage, row, col);
          if (device) {
            terrainDetailRef.current?.({ type: 'device', device,
              ...(device.unitId != null ? { unitId: device.unitId } : {}) });
            return;
          }
          const terrain = terrainInfo(currentStage, row, col);
          if (terrain) terrainDetailRef.current?.({ type: 'terrain', terrain });
        });
        readyRef.current?.(sessionRef.current?.battle || null);
        automaticRetries.current = 0;
        setMountState({ kind: 'ready', message: '' });
      } catch (error) {
        cleanup();
        if (!live) return;
        if (controller.signal.aborted && controller.signal.reason?.name !== 'TimeoutError') return;
        setMountState({ kind: 'failed', message: fieldMountFailureMessage(error) });
        retryListener = () => {
          if (!live || autoRetryPending || automaticRetries.current >= 2 || document.visibilityState !== 'visible'
            || globalThis.navigator?.onLine === false) return;
          autoRetryPending = true;
          automaticRetries.current += 1;
          setMountAttempt(value => value + 1);
        };
        window.addEventListener('online', retryListener);
        document.addEventListener('visibilitychange', retryListener);
      }
    })();
    return () => {
      live = false;
      controller.abort(new DOMException('Assault renderer attempt superseded', 'AbortError'));
      if (retryListener) {
        window.removeEventListener('online', retryListener);
        document.removeEventListener('visibilitychange', retryListener);
      }
      cleanup();
    };
  // Native setStage/setPrep/enterBattle own scene changes; the renderer and its URL cache survive them.
  }, [catalogIdentity, mountAttempt]);

  useEffect(()=>settingsStore.subscribe(settings=>view.current?.setSettings?.(settings)),[]);

  useEffect(() => {
    const stage = dataRef.current?.stages?.[stageId];
    if (view.current && stage) view.current.setStage({ ...stage, terrainOverlay: true });
  }, [catalogIdentity, stageId]);

  useEffect(() => {
    const current = view.current;
    if (!current || state?.phase==='battle' || sessionRef.current?.battle) return;
    current.setPrep(nativePrepView({...stablePrepView(state, uidMapRef.current), nextEnemies:encounterPen(catalog,state)}), {
      editable: editablePhase(state),
      canPlace: (piece, row, col, target) => {
        const uid = uidMapRef.current.uidOf(piece?.uid);
        const actual = stateRef.current?.pieces?.find((item) => item.uid === uid);
        if (!actual || !editablePhase(stateRef.current)) return false;
        if (target?.area === 'hand') {
          const onBench = !Number.isInteger(actual.row) || !Number.isInteger(actual.col);
          const benchCount = (stateRef.current.pieces || []).filter((item) => !Number.isInteger(item.row) || !Number.isInteger(item.col)).length;
          return onBench || benchCount < 12;
        }
        return deployRefusal(stateRef.current, catalogRef.current, actual, row, col, { ...(stateRef.current?.board || {}), ...(fieldRef.current || {}) }) === null;
      },
    });
  }, [state]);

  useEffect(() => {
    if (!view.current || !battleSession?.battle) return;
    syncBattleData(dataRef.current, battleSession);
    const battleField = battleSession.field || fieldRef.current || stateRef.current?.board || {};
    const entered = view.current.enterBattle(battleField);
    deviceUnitsRef.current = noteDeviceUnits(new Map(), { units: battleField.units });
    snapUnitsRef.current = new Map();
    if (entered !== false) readyRef.current?.(battleSession.battle);
  }, [battleSession?.battle]);

  useEffect(() => {
    if (!view.current || !battleSession?.battle) return;
    view.current.setLocalFeed?.({ on: true, speed: battleSession.speed });
  }, [battleSession?.speed]);

  useEffect(() => {
    const current = view.current;
    if (!current || !battleFrame || !battleSession?.battle) return;
    if (battleFrame.snapshot) current.pushSnapshot(battleFrame.snapshot);
    if (Array.isArray(battleFrame.snapshot?.units)) {
      snapUnitsRef.current = new Map(battleFrame.snapshot.units.filter(Array.isArray).map((tuple) => [tuple[0], tuple]));
    }
    if (battleFrame.events?.length) {
      noteDeviceUnits(deviceUnitsRef.current, { events: battleFrame.events });
      current.pushEvents({ fieldId: battleSession.battle.fieldId,
        gt: battleFrame.time ?? battleSession.battle.time, ev: battleFrame.events });
    }
  }, [battleFrame]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const inBattle = state?.phase === 'battle' || !!battleSession?.battle;
    current.setPen?.(inBattle ? null : encounterPen(catalog, state));
    current.setCamera?.(pen && !inBattle ? 'pen' : kind, { side: context.side || 'L', shop: shopOpen });
  }, [catalog, stageId, identity, state?.currentNode?.encounterId, state?.phase, battleSession?.battle, pen, kind, shopOpen]);

  useEffect(() => {
    const onKey = (event) => {
      const action = shortcutFor(event, settingsStore.get().keys);
      if (action !== 'retreat' && action !== 'sell') return;
      if (document.querySelector('.modal, .guide, .spov, .st')) return;
      const currentState = stateRef.current;
      if (!editablePhase(currentState) || facing || !selectedUid) return;
      const piece = currentState?.pieces?.find((item) => item.uid === selectedUid
        && Number.isInteger(item.row) && Number.isInteger(item.col));
      if (!piece) return;
      event.preventDefault();
      setSelectedUid(null);
      actionRef.current(action === 'retreat' ? 'bench' : 'sell', { uid: piece.uid });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [facing, selectedUid]);

  const selected = editablePhase(state)
    ? state.pieces?.find((piece) => piece.uid === selectedUid && Number.isInteger(piece.row) && Number.isInteger(piece.col)) || null
    : null;
  // Reuse the upstream field-detail range resolver, including live skill range,
  // snapshots, facing and prepared-board coordinates. Shop/bench cards have no tile.
  const inspectedPiece=state?.pieces?.find(piece=>piece.uid===inspection?.uid);
  const inspectedUnit=battleSession?.battle&&(inspection?.unitId!=null?battleSession.battle.unitById(inspection.unitId)
    :battleSession.battle.allyUnits.find(unit=>unit.uid===inspection?.uid&&unit.kind==='op'));
  const body=inspectedPiece&&pieceRecord(catalog,inspectedPiece);
  const rec=body?.simChess;
  const nativeLive=inspectedUnit?unitStatsEntry(inspectedUnit,inspectedUnit._s):null;
  const liveRange=inspection?.mode==='skill'&&body?.fixedSkill?.runtime?.sourceRangeGrid?.length
    ?{...nativeLive,range:body.fixedSkill.runtime.sourceRangeGrid}:nativeLive;
  const inspected=inspectedUnit?{type:inspectedUnit.kind==='token'?'token':'chess',token:inspectedUnit.def?.raw,chess:rec}
    :inspectedPiece?{type:'chess',chess:rec}:null;
  const range=inspection&&!facing&&!summonPlacement&&!pen?inspectRange({
    target:inspectedUnit?{kind:'unit',unit:inspectedUnit}:{kind:'piece',uid:inspection.uid},detail:inspected,
    pieces:inspectedPiece?new Map([[inspectedPiece.uid,{area:inspectedPiece.row==null?'hand':'board',row:inspectedPiece.row,col:inspectedPiece.col,piece:{...inspectedPiece,dir:rendererDirection(inspectedPiece.dir)}}]]):null,
    showPrep:!battleSession?.battle,field:battleSession?.field||field,snapshot:inspectedUnit?snapUnitsRef.current.get(inspectedUnit.id):null,
    live:liveRange||(inspection.mode==='skill'?{range:body?.fixedSkill?.runtime?.sourceRangeGrid}:null),
    getChess:id=>id===rec?.chessId?rec:dataRef.current?.chess?.[id],
  }):null;
  const inspectedRangeKey=JSON.stringify(range);
  useEffect(()=>{
    if(!view.current)return;
    showRange(view.current,range?.grid,range?.row,range?.col,range?.dir,SEL_RANGE);
    return ()=>showRange(view.current,null,0,0,null,SEL_RANGE);
  },[inspectedRangeKey,mountState.kind]);
  useEffect(()=>{if(!inspection)setSelectedUid(null);},[inspection?.uid,inspection?.unitId]);
  useEffect(()=>{
    const current=view.current;
    if(!current)return;
    const owner=state?.pieces?.find(piece=>piece.uid===summonPlacement?.uid);
    const style={color:0x5bd6a3,fill:.24,line:.85,group:'assault-summon'};
    current.highlightTiles(summonPlacement?owner?.summonLegalTiles?.[summonPlacement.tokenId]??[]:[],style);
    return ()=>{if(view.current===current)current.highlightTiles([],style);};
  },[summonPlacement,state?.revision,mountState.kind]);
  const facingProps = facing && view.current ? html`<${FacingWheel} key=${`${facing.uid}:${facing.row},${facing.col}`}
    view=${view.current} row=${facing.row} col=${facing.col} grid=${facing.grid} name=${facing.name}
    onPreview=${(dir) => {if(!facing.summon)setPieceDir(view.current, facing.numberUid, dir);}}
    onCommit=${(dir) => { const item = facing; setFacing(null);
      if(item.summon){actionRef.current('setSummonPreset',{uid:item.uid,index:item.index,tokenId:item.tokenId,row:item.row,col:item.col,dir:modelDirection(dir)});summonRef.current?.end?.();return;}
      holdPiece(view.current, item.numberUid, null);
      setSelectedUid(item.uid);
      // a refused placement leaves the run unchanged, so no state change would redraw the board: draw it again from the run, or the piece would stay on the tile it was dropped on
      Promise.resolve(actionRef.current('place', { uid: item.uid, row: item.row, col: item.col, dir: modelDirection(dir) }))
        .then((result) => { if (!result?.ok) syncPrepRef.current?.(); }); }}
    onCancel=${() => { if(!facing.summon)holdPiece(view.current, facing.numberUid, null); setFacing(null); }} />` : null;
  const underframe = selected && !facing && view.current ? html`<${Underframe} key=${selected.uid} view=${view.current}
    uid=${uidMapRef.current.numberOf(selected.uid)} row=${selected.row} col=${selected.col}
    actions=${{ retreat: true, sell: sellPrice(catalog, selected, state), destroy: false }}
    name=${selected.name || displayName(catalog, selected.charId)}
    onRetreat=${() => { setSelectedUid(null); actionRef.current('bench', { uid: selected.uid }); }}
    onSell=${() => { setSelectedUid(null); actionRef.current('sell', { uid: selected.uid }); }} />` : null;
  const nativePrep = nativePrepView(stablePrepView(state, uidMapRef.current));
  const overflowCount = nativePrep.temp.length;
  const tempNotice = editablePhase(state) && overflowCount > 0 && view.current ? html`<${TempRowNotice} view=${view.current} count=${overflowCount}
      presentation=${{ title: t('备用整备区'), rule: t('可拖入战场') }} />` : null;
  const pending = view.current && battleSession?.battle ? pendingDeployments(battleSession).map(entry=>html`<${PendingDeployment}
    key=${entry.id} view=${view.current} entry=${entry} catalog=${catalog} piece=${state?.pieces?.find(p=>p.uid===entry.uid)} onOpen=${onOpen} />`) : null;
  const summons=view.current&&editablePhase(state)?state.pieces.flatMap(piece=>(piece.summonPresets??[]).map((preset,index)=>preset?html`<${SummonPreset}
    key=${`${piece.uid}:${index}`} view=${view.current} preset=${preset}
    valid=${piece.summonLegalTiles?.[preset.tokenId]?.some(([row,col])=>row===preset.row&&col===preset.col)??false}
    name=${catalog.runtime.summons[preset.tokenId]?.name||catalog.runtime.bodies[piece.charId]?.adaptation?.marker?.name||t('召唤物')} onOpen=${()=>onOpen(piece)} />`:null)):null;

  return html`<${Fragment}>
    <div class="gm__field" ref=${host} onContextMenu=${(event) => event.preventDefault()}
      onPointerDownCapture=${(event) => { if (event.button === 0 && !event.target?.closest?.('.uframe')) {pressSelection.current=inspectionRef.current?.value?.uid??selectedUid;setSelectedUid(null);} }}></div>
    ${summons}
    ${summonPlacement ? html`<div class="assault-actions" style="position:absolute;top:90px;left:50%;transform:translateX(-50%);z-index:30;background:#15221f;padding:8px">
      <span>${summonPlacement.name} · ${t('选择部署格')}</span><${Button} onClick=${()=>{setFacing(null);onSummonPlacementEnd?.();}}>${t('取消')}<//></div>`:null}
    ${mountState.kind === 'ready' ? null : html`<div class="gm__loading" style=${`pointer-events:auto;background:rgba(5,8,8,.78);${mountState.kind === 'failed' ? 'z-index:25;' : ''}`} aria-live="polite">
      ${mountState.kind === 'loading' ? html`<${Spinner} size="lg" label=${t('正在载入进击')} />`
        : html`<div role="alert"><p>${mountState.message || t('操作没有完成，请检查当前局面后重试。')}</p>
          <${Button} variant="primary" icon="refresh" onClick=${() => setMountAttempt(value => value + 1)}>${t('重试')}<//></div>`}
    </div>`}
    <div class="gm__hud">${underframe}${facingProps}${tempNotice}${pending}</div>
  </${Fragment}>`;
}
