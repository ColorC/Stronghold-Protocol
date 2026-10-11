import { Match } from '../../match/Match.js';
import { PHASE, ERR } from '../../../shared/constants.js';
import { MetaRegistry } from '../../match/effectsMeta.js';
import { buildResonanceBattle, getResonanceField, nativeResultForSession, placeSpecialEntities, previewUnitStats } from './battle.js';
import { applyAction, effectiveDeployCapacity, viewSession } from './session.js';
import { resonanceSessionDisplay, resonanceDisplayCatalog, resonanceOperatorPresentation } from './display.js';
import { BOSS_CLOCK_MS, DELAYS } from '../../match/match/common.js';
import { BOSS_HIT_STEPS, SharedBossPool } from '../../match/finalAssault.js';
import { previewOf } from '../../match/waves.js';
import { compactResonanceResult, resonanceResultExtras } from '../../sim/spec.js';
import { summarizeResonanceResult } from '../../../shared/resonance/result-summary.js';

const PLAYER = 'resonance';
const OK = Object.freeze({ ok: true });
const FAIL = (error, detail) => ({ error, ...(detail ? { detail } : {}) });
const isNativeUid = (value) => Number.isSafeInteger(value) && value > 0;
const finiteNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const RESONANCE_ACTIONS = new Set(['advanceSupply', 'claimReward', 'chooseStrategy', 'clearSummonOrder', 'combine',
  'disassemble', 'recycleEquipment', 'setSummonOrder', 'unequip', 'useCopy', 'useConsumable']);
function displayCatalogFor(catalog) {
  if (catalog?.config?.rulesVersion !== 3) return catalog;
  const pacts = Object.fromEntries(Object.entries(catalog.pacts ?? {}).map(([id, pact]) => [id, {
    ...pact, thresholds: Array.isArray(pact.thresholds) ? pact.thresholds : (pact.levels ?? []).map((tier) => Number(tier.minUnits ?? tier.threshold)).filter(Number.isFinite),
  }])) ;
  const playerPacts = Object.fromEntries(Object.entries(pacts).map(([id, pact]) => [id, {
    ...catalog.playerText?.pacts?.[id], name: pact.name,
    levels: (pact.levels ?? []).map((level) => ({ description: level.description })),
  }]));
  return { ...catalog, pacts, playerText: { ...catalog.playerText, pacts: { ...catalog.playerText?.pacts, ...playerPacts } } };
}

/** Stable numeric native combat IDs over the session's string identifiers. */
export class ResonanceUidMap {
  constructor(snapshot = null) {
    this.next = 1; this.toNative = new Map(); this.toSession = new Map();
    for (const [native, session] of Array.isArray(snapshot) ? snapshot : []) {
      if (!Number.isSafeInteger(native) || native < 1 || typeof session !== 'string') continue;
      this.toNative.set(session, native); this.toSession.set(native, session); this.next = Math.max(this.next, native + 1);
    }
  }
  native(id) {
    const key = String(id);
    if (!this.toNative.has(key)) {
      const n = this.next++;
      this.toNative.set(key, n); this.toSession.set(n, key);
    }
    return this.toNative.get(key);
  }
  session(id) { return this.toSession.get(Number(id)) ?? null; }
  snapshot() { return [...this.toSession].map(([native, session]) => [native, session]).sort((a, b) => a[0] - b[0]); }
}

export class ResonanceMatch extends Match {
  constructor(opts) {
    if (!opts?.sessionId || !opts.state || !opts.catalog || !opts.store) throw new TypeError('ResonanceMatch requires sessionId/state/catalog/store');
    super({
      ...opts, mode: 'solo', difficulty: opts.state.difficulty, seed: opts.state.seed,
      seats: [{ seat: 0, playerId: PLAYER, name: '共鸣', isBot: false, connected: true }],
      clientCombat: true, verify: 'off', battleContent: 'independent',
      registry: new MetaRegistry(),
      onEnd: (summary) => {
        opts.send?.(PLAYER, { t: 'room.state', code: 'RSN', hostId: PLAYER, mode: 'solo', difficulty: opts.state.difficulty,
          inMatch: false, seats: [{ seat: 0, playerId: PLAYER, name: '共鸣', isBot: false, ready: true, connected: true }], spectators: [] });
        if (opts.catalog?.config?.rulesVersion === 3 && summary && typeof summary === 'object') {
          const projected = this._resonanceResultProjection({ t: 'm.result', ...summary });
          const { t: _type, playerId: _viewer, ...callbackSummary } = projected;
          opts.onEnd?.(callbackSummary);
        } else opts.onEnd?.(summary);
      }, send: opts.send, broadcast: opts.broadcast,
    });
    this.sessionId = opts.sessionId;
    this.state = structuredClone(opts.state);
    const runtime = this.state.nativeRuntime;
    const legacyRuntimeSpeed = runtime?.finishing === true ? null : Number(runtime?.speed);
    this.nativeCombatSpeed = [1, 2, 4].includes(Number(this.state.nativeCombatSpeed)) ? Number(this.state.nativeCombatSpeed)
      : [1, 2, 4].includes(Number(runtime?.selectedSpeed)) ? Number(runtime.selectedSpeed)
        : [1, 2, 4].includes(legacyRuntimeSpeed) ? legacyRuntimeSpeed : 2;
    this.state.nativeCombatSpeed = this.nativeCombatSpeed;
    this.gameSpeed = this.nativeCombatSpeed;
    // Match's shared phase machine needs the campaign's terminal nodes, not the native
    // single-player defaults (R14 boss / R15 hidden). Keep GameData instance-local.
    this.gd.mode = { ...this.gd.mode, lastRound: this.state.roundLimit,
      bossRound: Math.min(28, this.state.roundLimit),
      hiddenRound: this.state.difficulty === 'ABYSS' && this.state.roundLimit >= 30 ? 30 : null };
    this.catalog = opts.catalog;
    this.displayCatalog = displayCatalogFor(opts.catalog);
    this.store = opts.store;
    this._resonanceValidationData = { chess: Object.create(null), tokens: Object.create(null) };
    const baseChess = this.gd.chess.bind(this.gd), baseToken = this.gd.token.bind(this.gd);
    this.gd.chess = (id) => typeof id === 'string' && Object.hasOwn(this._resonanceValidationData.chess, id)
      && this._resonanceValidationData.chess[id] && typeof this._resonanceValidationData.chess[id] === 'object'
      ? this._resonanceValidationData.chess[id] : baseChess(id);
    this.gd.token = (id) => typeof id === 'string' && Object.hasOwn(this._resonanceValidationData.tokens, id)
      && this._resonanceValidationData.tokens[id] && typeof this._resonanceValidationData.tokens[id] === 'object'
      ? this._resonanceValidationData.tokens[id] : baseToken(id);
    this.uidMap = new ResonanceUidMap(opts.state.nativeRuntime?.uidMap);
    this.settledBattleIds = new Set();
    this.settlingBattleIds = new Set();
    this._sessionWrite = Promise.resolve();
    this._supplyAdvancePromise = null;
    this._lastRuntimePersistAt = 0;
    this.activeResonanceMatch = true;
    this.bannedBonds = [];
    this.bannedItems = [];
    this.syncPlayer();
    const ps = this.players.get(PLAYER);
    ps.privateView = () => this.resonancePrivateView(ps);
  }

  displayState() {
    const view = resonanceSessionDisplay(this.state, { data: this.data, catalog: this.displayCatalog, viewSession,
      fieldResolver: (s) => getResonanceField(s, { data: this.data, catalog: this.catalog }) });
    if (view?.ok) {
      if (this.catalog.config?.rulesVersion === 3) {
        for (const [id, pactView] of Object.entries(view.pacts ?? {})) {
          const pact = this.catalog.pacts?.[id];
          if (!pact || !Array.isArray(pact.levels)) continue;
          const tier = pact.levels.filter((row) => pactView.count >= Number(row.minUnits ?? row.threshold ?? 0)
            && pactView.count <= Number(row.maxUnits ?? Number.MAX_SAFE_INTEGER)).sort((a, b) => Number(a.threshold) - Number(b.threshold)).at(-1);
          pactView.activeThreshold = tier?.threshold ?? 0;
          pactView.nextThreshold = pact.levels.find((row) => Number(row.minUnits ?? row.threshold) > pactView.count)?.minUnits ?? null;
        }
      }
    for (const piece of view.pieces ?? []) {
        piece.nativeUid = this.uidMap.native(piece.uid);
        for (const item of piece.equipment ?? []) item.nativeUid = this.uidMap.native(item.uid);
      }
      for (const item of view.inventory ?? []) item.nativeUid = this.uidMap.native(item.uid);
      for (const offer of view.shop?.offers ?? []) if (offer.uid) offer.nativeUid = this.uidMap.native(offer.uid);
    }
      for (const entity of view.specialEntities ?? []) entity.nativeUid = this.uidMap.native(entity.uid);
    return view;
  }

  publicView() {
    const view = super.publicView();
    const runtime = this.state.nativeRuntime;
    const field = this.fields.find((entry) => entry.players.includes(PLAYER));
    const available = !!(field?.cc && field.live && !field.done && !field.verifyJob && !field.heldResult
      && !field.result && field.mode === 'client' && field.authority === PLAYER
      && [PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(this.phase));
    view.resonanceCombat = {
      speed: runtime?.finishing ? 32 : ([1, 2, 4].includes(Number(runtime?.speed)) ? Number(runtime.speed) : this.nativeCombatSpeed),
      finishing: runtime?.finishing === true,
      available,
    };
    return view;
  }

  setResonanceCombatControl(message) {
    const field = this.fields.find((entry) => entry.players.includes(PLAYER));
    const runtime = this.state.nativeRuntime;
    if (!field?.cc || !field.live || field.done || field.verifyJob || field.heldResult || field.result
      || field.mode !== 'client' || field.authority !== PLAYER
      || ![PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(this.phase)) {
      return FAIL(ERR.WRONG_PHASE, 'no live authoritative Resonance client field');
    }
    if (message.finish !== undefined) {
      if (runtime?.finishing) return OK;
      const changed = this.reanchorResonanceCombat(field, 32, true);
      if (!changed) return FAIL(ERR.WRONG_PHASE, 'fast finish requires the live authoritative client field');
      this.persistNativeRuntime({ elapsed: this._fieldElapsed(field), force: true });
      this.markPublic(); this.flush(true);
      this.sendTo(PLAYER, this._startMsg(field, PLAYER));
      return OK;
    }
    if (runtime?.finishing) return FAIL(ERR.WRONG_PHASE, 'fast finish is already running');
    const speed = message.speed;
    if (![1, 2, 4].includes(speed)) return FAIL(ERR.BAD_MSG, 'speed must be 1, 2, or 4');
    if (speed === this.gameSpeed) return OK;
    this.nativeCombatSpeed = speed;
    this.state.nativeCombatSpeed = speed;
    this.reanchorResonanceCombat(field, speed, false);
    this.persistNativeRuntime({ elapsed: this._fieldElapsed(field), force: true });
    this.markPublic(); this.flush(true);
    this.sendTo(PLAYER, this._startMsg(field, PLAYER));
    return OK;
  }

  /** Change the rate of the existing simulation while preserving each native clock in game-seconds. */
  reanchorResonanceCombat(field, nextSpeed, finishing) {
    if (!field?.cc || field.mode !== 'client' || field.authority !== PLAYER || field.done || field.verifyJob || field.heldResult) return false;
    const oldSpeed = Number(this.gameSpeed) || 2;
    const now = this._clockNow();
    const elapsedByField = new Map(this.fields.filter((current) => current.cc && !current.done)
      .map((current) => [current, this._fieldElapsed(current)]));
    const deadlineRemainingGame = this.deadline ? Math.max(0, (this.deadline - now) / 1000 * oldSpeed) : null;
    const overtimeRemainingGame = this.overtimeAt ? Math.max(0, (this.overtimeAt - now) / 1000 * oldSpeed) : null;
    const bossElapsedGame = this._bossStartAt == null ? null : Math.max(0, (now - this._bossStartAt) / 1000 * oldSpeed);

    this.gameSpeed = nextSpeed;
    for (const [current, elapsed] of elapsedByField) {
      current.startAt = now - Math.round(elapsed / nextSpeed * 1000);
      current.lastProgressAt = now;
    }
    if (deadlineRemainingGame != null) this.deadline = now + Math.round(deadlineRemainingGame / nextSpeed * 1000);
    if (overtimeRemainingGame != null) this.overtimeAt = now + Math.round(overtimeRemainingGame / nextSpeed * 1000);
    if (bossElapsedGame != null) this._bossStartAt = now - Math.round(bossElapsedGame / nextSpeed * 1000);

    const runtime = this.state.nativeRuntime ?? (this.state.nativeRuntime = {});
    runtime.speed = nextSpeed === 32 ? 2 : nextSpeed;
    runtime.selectedSpeed = this.nativeCombatSpeed;
    runtime.finishing = finishing === true;
    if (nextSpeed === 32) runtime.speed = 32;

    for (const current of this.fields) {
      if (!current.cc || current.done) continue;
      if (current.deadlineTimer) { this.cancel(current.deadlineTimer); current.deadlineTimer = null; }
      if (current.doneTimer) { this.cancel(current.doneTimer); current.doneTimer = null; }
      if (current.mode === 'client') {
        if (this.paused) current.rearmDeadline = true;
        else if (current.kind !== 'boss' && current.kind !== 'hidden') this._armDeadline(current);
      } else if (current.result != null) {
        if (this.paused) current.rearmRelease = true;
        else this._armRelease(current);
      }
    }
    if (this._bossClock) { this.cancel(this._bossClock); this._bossClock = null; }
    if (!this.paused && this._bossClockOn && [PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(this.phase)) {
      this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    }
    return true;
  }

  nativeChessId(operatorId, star = 1) { return star === 1 ? operatorId : `resonance_${operatorId}_star${star}`; }

  resonancePrivateView(ps) {
    const state = this.displayState();
    const pieces = this.state.pieces.map((piece) => ({ uid: this.uidMap.native(piece.uid), piece }));
    const items = [...this.state.inventory, ...this.state.pieces.flatMap((piece) => piece.equipment)];
    for (const item of items) this.uidMap.native(item.uid);
    const offers = this.state.shop.offers.map((offer) => offer.operatorId ? {
      kind: 'chess', id: offer.operatorId, price: offer.cost, basePrice: offer.cost, sold: false,
      frozen: !!this.state.shop.locked, uid: this.uidMap.native(offer.uid),
    } : null);
    const bonds = Object.entries(state.pacts ?? {}).map(([id, pact]) => ({
      id, name: this.catalog.pacts?.[id]?.name ?? id, count: pact.count, active: pact.activeThreshold > 0,
      threshold: pact.activeThreshold, next: pact.nextThreshold, members: pact.members,
    }));
    const effects = (this.state.strategies ?? []).map((selected) => {
      const id = typeof selected === 'string' ? selected : selected.id;
      return { id, name: this.catalog.strategies?.[id]?.name ?? id,
        desc: this.catalog.strategies?.[id]?.description ?? '', iconKind: 'choice', iconId: id };
    });
    const shopCosts = state.actionCosts ?? {};
    const hand = Array.from({ length: 10 }, () => null);
    let legacySlot=0;
    for(const {uid,piece} of pieces.filter(({piece})=>piece.row==null)){
      let slot=Number.isInteger(piece.benchSlot)&&piece.benchSlot>=0&&piece.benchSlot<9?piece.benchSlot:legacySlot++;
      while(slot<9&&hand[slot])slot++;
      if(slot<9)hand[slot]={uid,kind:'chess',id:this.nativeChessId(piece.operatorId,piece.star),resonanceStar:piece.star,star:piece.star,items:piece.equipment.map((item)=>({uid:this.uidMap.native(item.uid),id:item.itemId}))};
    }
    const board = pieces.filter(({ piece }) => piece.row != null).map(({ uid, piece }) => ({
      uid, kind: 'chess', id: this.nativeChessId(piece.operatorId, piece.star), resonanceStar: piece.star, star: piece.star, row: piece.row, col: piece.col, dir: piece.dir,
      items: piece.equipment.map((item) => ({ uid: this.uidMap.native(item.uid), id: item.itemId })),
    }));
    const specialEntities=(state.specialEntities??[]).map((entity)=>({uid:this.uidMap.native(entity.uid),entityId:entity.entityId,
      kind:'token',id:this.catalog.specialEntities?.[entity.entityId]?.nativeTokenId??null,row:entity.row??null,col:entity.col??null,
      definition:entity.definition??null}));
    const specialField=getResonanceField(this.state,{data:this.data,catalog:this.catalog});
    const occupied=new Set(board.map((entry)=>`${entry.row},${entry.col}`));
    for(const {entity,row,col} of placeSpecialEntities(this.state,specialField.deployMap,occupied,this.catalog)){
      board.push({uid:this.uidMap.native(entity.uid),kind:'token',id:this.catalog.specialEntities[entity.entityId].nativeTokenId,entityId:entity.entityId,specialEntity:true,row,col,dir:'RIGHT'});
    }
    return { t: 'm.private', playerId: ps.playerId, seat: ps.seat, alive: true,
      funds: this.state.gold, lp: this.state.hp, phase: this.phase, round: this.state.round, ready: ps.ready,
      canReady: this.phase === PHASE.PREP && !(state.pendingChoices?.length) && this.state.phase === 'prep',
      hand, handCapacity: 9, temp: [], board, deployCap: effectiveDeployCapacity(this.state), deployCount: pieces.filter(({piece})=>piece.row!=null).length, bonds, effects,
      loadout: {}, ops: {}, standIns: [], diy: {}, diyBanned: [],
      shop: { level: this.state.level, maxLevel: 10, upgradePrice: shopCosts.xpGold ?? 4,
        refreshPrice: shopCosts.refreshGold ?? 2, freeRefreshes: shopCosts.freeRefreshes ?? 0,
        frozen: !!this.state.shop.locked, slots: offers, rewardOffer: null },
      items: Object.fromEntries(items.map((item) => [this.uidMap.native(item.uid), item.itemId])), specialEntities,
      // the coming node's enemies for the preview pen (🔍▶▶) and its roll call (the native m.private.nextEnemies,
      // waves.js previewOf); a logistics node has no fight, and a finished run has nothing left to meet
      nextEnemies: ['logistics', 'complete'].includes(state.node?.kind) ? [] : previewOf(specialField.wave?.spawns || []),
      resonance: { state },
    };
  }

  syncPlayer() {
    const ps = this.players.get(PLAYER);
    if (!ps) return;
    ps.lp = this.state.hp;
    ps.funds = this.state.gold;
    ps.shop.level = this.state.level;
    ps.ready = false;
    ps.alive = true;
    ps.deployCapBonus = 0; ps.deployCapMin = effectiveDeployCapacity(this.state);
    ps.board = new Map(this.state.pieces.filter((piece) => piece.row != null).map((piece) => [`${piece.row},${piece.col}`, {
      uid: this.uidMap.native(piece.uid), kind: 'chess', id: this.nativeChessId(piece.operatorId,piece.star), dir: piece.dir,
      items: piece.equipment.map((item) => ({ uid: this.uidMap.native(item.uid), id: item.itemId })),
    }]));
    const specialField=getResonanceField(this.state,{data:this.data,catalog:this.catalog});
    const specialOccupied=new Set(ps.board.keys());
    for(const {entity,row,col} of placeSpecialEntities(this.state,specialField.deployMap,specialOccupied,this.catalog)){
      ps.board.set(`${row},${col}`,{uid:this.uidMap.native(entity.uid),kind:'token',id:this.catalog.specialEntities[entity.entityId].nativeTokenId,entityId:entity.entityId,specialEntity:true,dir:'RIGHT',items:[]});
    }
    for (const item of [...this.state.inventory, ...this.state.pieces.flatMap((piece) => piece.equipment)]) this.uidMap.native(item.uid);
    ps.hand = Array.from({ length: 10 }, () => null);
    let legacySlot=0;
    for(const piece of this.state.pieces.filter((entry)=>entry.row==null)){
      let slot=Number.isInteger(piece.benchSlot)&&piece.benchSlot>=0&&piece.benchSlot<9?piece.benchSlot:legacySlot++;
      while(slot<9&&ps.hand[slot])slot++;
      if(slot<9)ps.hand[slot]={uid:this.uidMap.native(piece.uid),kind:'chess',id:this.nativeChessId(piece.operatorId,piece.star),resonanceStar:piece.star,star:piece.star,
        dir:piece.dir,items:piece.equipment.map((item)=>({uid:this.uidMap.native(item.uid),id:item.itemId}))};
    }
    ps.temp = [];
    ps.specialEntities=(this.state.specialEntities??[]).map((entity)=>({uid:this.uidMap.native(entity.uid),entityId:entity.entityId,
      kind:'token',id:this.catalog.specialEntities?.[entity.entityId]?.nativeTokenId??null,row:entity.row??null,col:entity.col??null,
      definition:this.displayCatalog.specialEntities?.[entity.entityId]??null}));
    ps.shop.slots = this.state.shop.offers.map((offer) => offer.operatorId ? ({ uid: this.uidMap.native(offer.uid), kind: 'chess', id: offer.operatorId,
      basePrice: offer.cost, price: offer.cost, sold: false, frozen: !!this.state.shop.locked }) : null);
    ps.shop.frozen = !!this.state.shop.locked;
    ps.bonds = Object.fromEntries(Object.entries(this.displayState().pacts ?? {}).map(([id, pact]) => [id, { active: pact.activeThreshold > 0, count: pact.count, threshold: pact.activeThreshold }]));
    ps.effects = (this.state.strategies ?? []).map((selected) => {
      const id = typeof selected === 'string' ? selected : selected.id;
      return { id, name: this.catalog.strategies?.[id]?.name ?? id, desc: this.catalog.strategies?.[id]?.description ?? '', iconKind: 'choice', iconId: id };
    });
    ps.dirty();
  }

  enqueueSessionAction(action, completedResult = null) {
    const run = async () => this.store.exclusive(this.sessionId, async () => {
      const result = applyAction(this.state, action, { catalog: this.catalog,
        fieldResolver: (s) => getResonanceField(s, { data: this.data, catalog: this.catalog }),
        recording: false, completedResult });
      if (!result.ok) return FAIL(ERR.BAD_TARGET, result.error);
      this.state = result.state;
      if (action.type === 'fight') {
        delete this.state.nativeRuntime;
        this.nativeCombatSpeed = [1, 2, 4].includes(Number(this.state.nativeCombatSpeed)) ? Number(this.state.nativeCombatSpeed) : 2;
        this.gameSpeed = this.nativeCombatSpeed;
      }
      this.syncPlayer();
      await this.store.saveSession(this.sessionId, this.state);
      this.markPrivate(this.players.get(PLAYER));
      this.flush(true);
      return OK;
    });
    const pending = this._sessionWrite.then(run, run);
    this._sessionWrite = pending.then(() => {}, () => {});
    return pending;
  }

  handle(playerId, msg) {
    if (playerId !== PLAYER) return FAIL(ERR.NOT_IN_ROOM);
    if (msg?.t === 'g.infoReady') return super.handle(playerId, msg);
    if (msg?.t === 'g.resonanceCombat') return this.setResonanceCombatControl(msg);
    const prepOnly = new Set(['g.buy', 'g.refresh', 'g.freeze', 'g.levelUp', 'g.sell', 'g.move', 'g.equip']);
    if (prepOnly.has(msg?.t) && (this.phase !== PHASE.PREP || !['prep', 'choice'].includes(this.state.phase))) return FAIL(ERR.WRONG_PHASE);
    if (msg?.t === 'g.resonance') {
      if (this.phase !== PHASE.PREP || !['prep', 'choice'].includes(this.state.phase)) return FAIL(ERR.WRONG_PHASE);
      if (!RESONANCE_ACTIONS.has(msg.action?.type)) return FAIL(ERR.BAD_MSG, 'unsupported resonance action');
      const action = this.normalizeResonanceAction(msg.action);
      const queued = this.enqueueSessionAction(action);
      if (!['claimReward', 'chooseStrategy'].includes(action.type)) return queued;
      return queued.then(async (result) => {
        if (!result?.error && !this.state.pendingChoices?.length
          && (!this.state.nodeStarted || this._isFunnyLogisticsNode())) {
          await this._advanceSupplyAndStartRound();
        }
        return result;
      });
    }
    if (msg?.t === 'g.buy') {
      const offer = this.state.shop.offers[msg.slot];
      return offer?.operatorId ? this.enqueueSessionAction({ type: 'buy', offerUid: offer.uid }) : FAIL(ERR.BAD_TARGET);
    }
    if (msg?.t === 'g.refresh') return this.enqueueSessionAction({ type: 'refresh' });
    if (msg?.t === 'g.freeze') return this.enqueueSessionAction({ type: 'lockShop', locked: !this.state.shop.locked });
    if (msg?.t === 'g.levelUp') return this.enqueueSessionAction({ type: 'buyXp' });
    if (msg?.t === 'g.sell') {
      const pieceUid = this.uidMap.session(msg.uid);
      return pieceUid ? this.enqueueSessionAction({ type: 'sell', pieceUid }) : FAIL(ERR.BAD_TARGET);
    }
    if (msg?.t === 'g.move') {
      const pieceUid = this.uidMap.session(msg.uid);
      if (!pieceUid || !['board', 'hand'].includes(msg.to?.area)) return FAIL(ERR.BAD_TARGET);
      const piece = this.state.pieces.find((entry) => entry.uid === pieceUid);
      if(!piece&&(this.state.specialEntities??[]).some((entry)=>entry.uid===pieceUid)){
        if(msg.to.area==='hand')return this.enqueueSessionAction({type:'storeSpecialEntity',entityUid:pieceUid});
        return this.enqueueSessionAction({type:'placeSpecialEntity',entityUid:pieceUid,row:msg.to.row,col:msg.to.col});
      }
      if (!piece) return FAIL(ERR.BAD_TARGET);
      if (msg.to.area === 'hand') return this.enqueueSessionAction({ type: 'bench', pieceUid, slot: msg.to.idx });
      return this.enqueueSessionAction({ type: piece.row == null ? 'deploy' : 'move', pieceUid,
        row: msg.to.row, col: msg.to.col, dir: msg.dir ?? piece.dir ?? 'RIGHT' });
    }
    if (msg?.t === 'g.equip') {
      const pieceUid = this.uidMap.session(msg.targetUid), itemUid = this.uidMap.session(msg.itemUid);
      if (!pieceUid || !itemUid) return FAIL(ERR.BAD_TARGET);
      return this.enqueueSessionAction({ type: 'equip', pieceUid, itemUid });
    }
    if (msg?.t === 'g.ready' && msg.ready) {
      if (this.phase !== PHASE.PREP || this.state.phase !== 'prep' || !this.state.nodeStarted
        || this.state.pendingChoices?.length || this._isFunnyLogisticsNode()) return FAIL(ERR.WRONG_PHASE);
      if (!this.state.pieces.some((piece) => piece.row != null)) return FAIL(ERR.BAD_TARGET);
      const result = super.handle(playerId, msg);
      return result;
    }
    if (msg?.t === 'g.ready' && msg.ready === false) {
      if (this.phase !== PHASE.PREP) return FAIL(ERR.WRONG_PHASE);
      return super.handle(playerId, msg);
    }
    if (msg?.t === 'g.unitStats') return this.sendResonanceUnitStats();
    if (msg?.t === 'b.progress') {
      const result = super.handle(playerId, msg);
      this.persistNativeRuntime({ elapsed: Number(msg.gt) || 0 });
      return result;
    }
    if (msg?.t === 'b.result') {
      const field = this.fields.find((entry) => entry.cc && entry.battleId === msg.battleId && !entry.done
        && !entry.heldResult && !entry.verifyJob && entry.mode === 'client' && entry.authority === playerId);
      if (field) field._resonanceClientResult = compactResonanceResult(msg.result?.resonance);
      const result = super.handle(playerId, msg);
      if (field && field.resultSource !== 'client' && !field.heldResult) delete field._resonanceClientResult;
      this.persistNativeRuntime({ elapsed: Number(msg.result?.time) || 0, completed: true });
      return result;
    }
    if (msg?.t === 'g.pause') {
      const result = super.handle(playerId, msg);
      this.persistNativeRuntime({ paused: !!msg.on });
      return result;
    }
    if (typeof msg?.t === 'string' && msg.t.startsWith('g.')) return FAIL(ERR.BAD_MSG, 'unsupported resonance native action');
    return super.handle(playerId, msg);
  }

  normalizeResonanceAction(action) {
    const out = { ...action };
    for (const key of ['pieceUid', 'itemUid', 'offerUid', 'mergeTargetUid', 'consumableUid', 'entityUid']) {
      if (isNativeUid(out[key])) out[key] = this.uidMap.session(out[key]);
    }
    if (Array.isArray(out.itemUids)) out.itemUids = out.itemUids.map((value) => isNativeUid(value) ? this.uidMap.session(value) : value);
    return out;
  }

  sendResonanceUnitStats() {
    if (this.phase !== PHASE.PREP && this.phase !== PHASE.ROUND_START) return FAIL(ERR.WRONG_PHASE);
    const preview = previewUnitStats(this.state, { data: this.data, catalog: this.catalog });
    const units = Object.values(preview).map((entry) => ({ ...entry, uid: this.uidMap.native(entry.uid) }));
    this.sendTo(PLAYER, { t: 'm.unitStats', seq: null, round: this.round, units });
    return OK;
  }

  _resonancePactViews() {
    const pacts = this.displayState()?.pacts ?? {};
    return Object.fromEntries(Object.entries(pacts).map(([id, pact]) => [id, {
      ...pact, name: this.catalog.pacts?.[id]?.name ?? pact?.name ?? '',
    }]));
  }

  _resonanceResultProjection(message) {
    if (this.catalog.config?.rulesVersion !== 3 || message?.t !== 'm.result') return message;
    const summary = this._resonanceFinalSummary ?? summarizeResonanceResult(this.state, this._resonancePactViews());
    const players = (Array.isArray(message.players) ? message.players : []).map((player) => player.playerId === PLAYER ? {
      ...player, roundsPassed: summary.roundsPassed,
      stats: { ...player.stats, ...summary.stats, ...(() => {
        const values = [player.stats?.bossDamage, summary.stats.bossDamage].filter((value) => Number.isFinite(value) && value >= 0);
        return values.length ? { bossDamage: Math.max(...values) } : {};
      })() },
      resonance: { ...(player.resonance && typeof player.resonance === 'object' ? player.resonance : {}), pacts: summary.pacts },
    } : player);
    return { ...message, roundsPassed: summary.roundsPassed, lastRound: summary.lastRound, players };
  }

  sendTo(playerId, message) {
    if (this.catalog.config?.rulesVersion !== 3 || message?.t !== 'm.result') return super.sendTo(playerId, message);
    const projected = this._resonanceResultProjection(message);
    const { playerId: _viewer, ...canonical } = projected;
    this.lastResultMsg = canonical;
    return super.sendTo(playerId, { ...projected, playerId });
  }

  finish(outcome) {
    if (this.catalog.config?.rulesVersion === 3) {
      this._resonanceFinalSummary = summarizeResonanceResult(this.state, this._resonancePactViews());
      const ps = this.players.get(PLAYER);
      if (ps) {
        const values = [ps.stats.bossDamage, this._resonanceFinalSummary.stats.bossDamage]
          .filter((value) => Number.isFinite(value) && value >= 0);
        if (values.length) this._resonanceFinalSummary.stats.bossDamage = Math.max(...values);
        Object.assign(ps.stats, this._resonanceFinalSummary.stats);
      }
    }
    super.finish(outcome);
    if (this.catalog.config?.rulesVersion === 3 && this.lastResultMsg?.t === 'm.result') {
      const projected = this._resonanceResultProjection(this.lastResultMsg);
      const { playerId: _viewer, ...canonical } = projected;
      this.lastResultMsg = canonical;
    }
  }

  start() {
    if (this.state.phase === 'complete') {
      this.finish({ victory: this.state.terminalReason === 'victory', reason: this.state.terminalReason });
      return;
    }
    const saved = this.state.nativeRuntime;
    if ([PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(saved?.phase) && saved.spec && saved.battleId) {
      this.gameSpeed = saved.finishing === true ? 32
        : ([1, 2, 4].includes(Number(saved.speed)) ? Number(saved.speed) : this.nativeCombatSpeed);
      const dataPatch = saved.spec.flags?.resonance?.dataPatch;
      this._resonanceValidationData = { chess: dataPatch?.chess ?? Object.create(null), tokens: dataPatch?.tokens ?? Object.create(null) };
      const now = this.sched.now();
      const elapsed = Math.max(0, Number(saved.elapsed) || 0);
      const field = {
        cc: true, fieldId: saved.fieldId || `n:${PLAYER}`, kind: saved.kind || saved.spec.kind || 'normal', players: [PLAYER], battleId: saved.battleId,
        spec: saved.spec, battle: null, live: true, done: false, mode: 'client', authority: PLAYER,
        startAt: now - Math.round(elapsed / this.gameSpeed * 1000), result: null,
        progress: saved.progress || { gt: elapsed, killed: 0, total: saved.total || 0, leaks: 0, resolved: null, done: false },
        lastProgressAt: now, bossAcked: 0, bossBy: {}, lpAcked: 0, lpCum: 0, lpReported: 0, leaksBy: null,
        deadlineTimer: null, doneTimer: null, waitTimer: null, sliceTimer: null, verifyTimer: null,
        bossReported: null, demoted: new Set(), heldResult: null,
      };
      this.phase = saved.phase; this.round = this.state.round; this.fields = [field];
      const wave = getResonanceField(this.state, { data: this.data, catalog: this.catalog });
      this.wave = wave.wave; this.stageId = wave.stageId; this.factions = wave.factions;
      const isBossRuntime = saved.phase === PHASE.FINAL_ASSAULT || saved.phase === PHASE.HIDDEN_CORE;
      const bossRuntime = isBossRuntime ? saved.bossRuntime : null;
      if (isBossRuntime) this._restoreNativeBossRuntime(bossRuntime, field, now, elapsed);
      const legacyRemaining = this._legacyBossDeadlineRemaining(elapsed);
      this.deadline = isBossRuntime
        ? now + Math.max(0, Number(bossRuntime?.clock?.deadlineRemainingMs ?? legacyRemaining) || 0)
        : now + Math.max(0, (Number(field.spec.timeLimit) || 60) - elapsed) / this.gameSpeed * 1000;
      this.paused = saved.paused === true; this._pausedAt = this.paused ? now : 0;
      if (!this.paused) this._armDeadline(field);
      if (isBossRuntime && this._bossClockOn && !this.paused) this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
      this.markPublic(); this.markPrivate(this.players.get(PLAYER)); this.flush(true);
      this.sendTo(PLAYER, this._startMsg(field, PLAYER));
      if (isBossRuntime && this.bossPool) this._broadcastPool(true);
      if (field.done && field.result) this._afterCombat();
      return;
    }
    this.gameSpeed = this.nativeCombatSpeed;
    super.start();
  }

  _legacyBossDeadlineRemaining(elapsedGameSeconds) {
    const levelTime = Number(this.gd.bossLevelTime(this.round));
    const timeScale = Number(this.gd.combatTimeScale) || 1;
    return Number.isFinite(levelTime) && levelTime > 0
      ? Math.max(0, (levelTime * timeScale - Math.max(0, Number(elapsedGameSeconds) || 0)) / (Number(this.gameSpeed) || 1) * 1000) : 0;
  }

  _restoreNativeBossRuntime(snapshot, field, now, elapsed) {
    const poolSnapshot = snapshot?.pool ?? {};
    const fallbackMax = Number(field.spec.boss?.poolMax ?? field.spec.boss?.poolHp);
    const maxHp = finiteNumber(poolSnapshot.maxHp) && Number(poolSnapshot.maxHp) > 0
      ? Number(poolSnapshot.maxHp) : fallbackMax;
    if (!Number.isFinite(maxHp) || maxHp <= 0) return;

    const byPlayer = poolSnapshot.byPlayer && typeof poolSnapshot.byPlayer === 'object' ? poolSnapshot.byPlayer : {};
    const hitSteps = snapshot?.bossHitSteps && typeof snapshot.bossHitSteps === 'object' ? snapshot.bossHitSteps : {};
    const restoredHitSteps = new Map(Object.entries(hitSteps).map(([id, value]) => [id, Math.max(0, Math.min(BOSS_HIT_STEPS.length, Number(value) || 0))]));
    const pool = new SharedBossPool(maxHp, { onHit: (playerId, damage) => {
      const ps = this.players.get(playerId);
      if (!ps) return;
      ps.stats.bossDamage = (Number(ps.stats.bossDamage) || 0) + damage;
      const share = (pool.byPlayer.get(playerId) || 0) / pool.maxHp;
      const done = restoredHitSteps.get(playerId) || 0;
      let reached = done;
      BOSS_HIT_STEPS.forEach((step, index) => { if (share >= step) reached = Math.max(reached, index + 1); });
      if (reached > done) {
        restoredHitSteps.set(playerId, reached);
        this.tickerFor('BOSS_HIT', [ps.name], { playerId, param: String(BOSS_HIT_STEPS[reached - 1]) });
      }
    } });
    pool.hp = Math.max(0, Math.min(maxHp, finiteNumber(poolSnapshot.hp) ? Number(poolSnapshot.hp) : fallbackMax));
    pool.byPlayer = new Map(Object.entries(byPlayer).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(([id, value]) => [id, Number(value)]));
    this.bossPool = pool;
    this.teamLp = finiteNumber(snapshot?.teamLp) ? Math.max(0, Number(snapshot.teamLp)) : Math.max(0, Number(this.state.hp) || 0);
    const lpShares = snapshot?.lpAtFinal && typeof snapshot.lpAtFinal === 'object' ? snapshot.lpAtFinal : {};
    for (const [id, ps] of this.players) ps.lpAtFinal = finiteNumber(lpShares[id])
      ? Math.max(0, Number(lpShares[id])) : Math.max(0, Number(ps.lp) || 0);
    const bossDamage = snapshot?.bossDamageByPlayer && typeof snapshot.bossDamageByPlayer === 'object' ? snapshot.bossDamageByPlayer : {};
    for (const [id, ps] of this.players) if (finiteNumber(bossDamage[id])) ps.stats.bossDamage = Math.max(0, Number(bossDamage[id]));
    this._resonanceBossHitSteps = restoredHitSteps;
    const clock = snapshot?.clock ?? {};
    const elapsedGame = finiteNumber(clock.elapsedGameSeconds) ? Math.max(0, Number(clock.elapsedGameSeconds)) : elapsed;
    this._bossStartAt = now - elapsedGame / (Number(this.gameSpeed) || 1) * 1000;
    this.overtimeAt = now + Math.max(0, Number(clock.overtimeRemainingMs ?? this._legacyOvertimeRemaining(elapsedGame)) || 0);
    this.overtimeApplied = Math.max(0, Number(snapshot?.overtimeApplied) || 0);
    this._finalEnding = ['cleared', 'forced'].includes(snapshot?.finalEnding) ? snapshot.finalEnding : null;
    this.hiddenLayerSum = Math.max(0, Number(snapshot?.hiddenLayerSum) || 0);
    this.hiddenReached = snapshot?.hiddenReached === true;
    this._bossClockOn = snapshot?.clockOn !== false;
    const fieldState = snapshot?.field ?? {};
    field.bossAcked = Math.max(0, Number(fieldState.bossAcked) || 0);
    field.bossBy = fieldState.bossBy && typeof fieldState.bossBy === 'object' ? structuredClone(fieldState.bossBy) : {};
    field.lpAcked = Math.max(0, Number(fieldState.lpAcked) || 0);
    field.lpCum = Math.max(0, Number(fieldState.lpCum) || 0);
    field.lpReported = Math.max(0, Number(fieldState.lpReported) || 0);
    field.leaksBy = fieldState.leaksBy && typeof fieldState.leaksBy === 'object' ? structuredClone(fieldState.leaksBy) : null;
    field.bossReported = fieldState.bossReported && typeof fieldState.bossReported === 'object' ? structuredClone(fieldState.bossReported) : null;
    field.heldResult = fieldState.heldResult ? structuredClone(fieldState.heldResult) : null;
    field._resonanceClientResult = fieldState.clientResonanceResult ? structuredClone(fieldState.clientResonanceResult) : null;
    field.result = fieldState.result ? structuredClone(fieldState.result) : null;
    field.resultSource = fieldState.resultSource ?? null;
    field.done = fieldState.done === true;
    this.nativeFinalOutcome = snapshot?.nativeFinalOutcome ? structuredClone(snapshot.nativeFinalOutcome) : null;
  }

  _legacyOvertimeRemaining(elapsedGameSeconds) {
    const afterReal = Number(this.gd.bossOvertimeAfterReal);
    const timeScale = Number(this.gd.combatTimeScale) || 1;
    return Number.isFinite(afterReal) && afterReal > 0
      ? Math.max(0, (afterReal * timeScale - Math.max(0, Number(elapsedGameSeconds) || 0)) / (Number(this.gameSpeed) || 1) * 1000) : 0;
  }

  persistNativeRuntime({ elapsed = undefined, paused = undefined, completed = false, force = false } = {}) {
    const field = this.fields.find((entry) => entry.players.includes(PLAYER));
    if (!field || !field.cc || !this.state.nativeRuntime) return;
    const runtime = this.state.nativeRuntime;
    runtime.speed = [1, 2, 4, 32].includes(Number(this.gameSpeed)) ? Number(this.gameSpeed) : 2;
    runtime.selectedSpeed = this.nativeCombatSpeed;
    runtime.finishing = runtime.speed === 32 || runtime.finishing === true;
    if (Number.isFinite(elapsed)) runtime.elapsed = Math.max(runtime.elapsed || 0, elapsed);
    if (paused !== undefined) runtime.paused = paused;
    runtime.uidMap = this.uidMap.snapshot();
    runtime.progress = structuredClone(field.progress);
    runtime.total = field.progress.total;
    if ([PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(this.phase) && this.bossPool) {
      const clockNow = typeof this._clockNow === 'function' ? this._clockNow() : this.sched.now();
      const fieldSnapshot = {
        bossAcked: field.bossAcked, bossBy: structuredClone(field.bossBy ?? {}), lpAcked: field.lpAcked,
        lpCum: field.lpCum, lpReported: field.lpReported, leaksBy: field.leaksBy ? structuredClone(field.leaksBy) : null,
        bossReported: field.bossReported ? structuredClone(field.bossReported) : null,
        heldResult: field.heldResult ? structuredClone(field.heldResult) : null,
        clientResonanceResult: field._resonanceClientResult ? structuredClone(field._resonanceClientResult) : null,
        result: field.result ? structuredClone(field.result) : null, resultSource: field.resultSource ?? null, done: field.done === true,
      };
      const elapsedGameSeconds = this._bossStartAt == null ? Math.max(0, Number(elapsed) || 0)
        : Math.max(0, (clockNow - this._bossStartAt) / 1000 * (Number(this.gameSpeed) || 1));
      const bossHitSteps = {};
      for (const [id, damage] of this.bossPool.byPlayer) {
        const share = damage / this.bossPool.maxHp;
        bossHitSteps[id] = BOSS_HIT_STEPS.reduce((n, step) => share >= step ? n + 1 : n, 0);
      }
      runtime.bossRuntime = {
        pool: { hp: this.bossPool.hp, maxHp: this.bossPool.maxHp, byPlayer: Object.fromEntries(this.bossPool.byPlayer) },
        teamLp: this.teamLp,
        lpAtFinal: Object.fromEntries([...this.players].filter(([, ps]) => Number.isFinite(ps.lpAtFinal)).map(([id, ps]) => [id, ps.lpAtFinal])),
        bossDamageByPlayer: Object.fromEntries([...this.players].map(([id, ps]) => [id, Number(ps.stats.bossDamage) || 0])),
        bossHitSteps, overtimeApplied: this.overtimeApplied, finalEnding: this._finalEnding ?? null,
        hiddenLayerSum: this.hiddenLayerSum, hiddenReached: this.hiddenReached,
        nativeFinalOutcome: this.nativeFinalOutcome ? structuredClone(this.nativeFinalOutcome) : null,
        clock: {
          elapsedGameSeconds, deadlineRemainingMs: this.deadline ? Math.max(0, this.deadline - clockNow) : 0,
          overtimeRemainingMs: this.overtimeAt ? Math.max(0, this.overtimeAt - clockNow) : 0,
        }, clockOn: this._bossClockOn, field: fieldSnapshot,
      };
    }
    if (completed) runtime.completed = true;
    const now = this.sched.now();
    if (!force && !completed && paused === undefined && now - this._lastRuntimePersistAt < 1000) return;
    this._lastRuntimePersistAt = now;
    this._sessionWrite = this._sessionWrite.then(() => this.store.exclusive(this.sessionId, () => this.store.saveSession(this.sessionId, this.state)))
      .catch((error) => this.reportError('resonance runtime persistence', error));
  }

  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    this.markPublic();
    this.enterBattleCheck();
  }

  startRound() {
    if (this.state.pendingChoices?.length) return this._startResonanceRound(this.state.round);
    if (!this.state.nodeStarted || this._isFunnyLogisticsNode()) return this._advanceSupplyAndStartRound();
    return this._startResonanceRound(this.state.round);
  }

  _isFunnyLogisticsNode() {
    return this.state.difficulty === 'FUNNY' && this.state.round % 2 === 1;
  }

  _advanceSupplyAndStartRound() {
    if (this._supplyAdvancePromise) return this._supplyAdvancePromise;
    const advance = this.enqueueSessionAction({ type: 'advanceSupply' }).then((result) => {
      if (result?.error) {
        this.reportError('resonance round supply', new Error(result.detail ?? result.error));
        return result;
      }
      if (this.state.phase === 'complete' || this.state.terminalReason) {
        this.phase = PHASE.RESULT;
        this.finish({ victory: this.state.terminalReason === 'victory', reason: this.state.terminalReason });
        return result;
      }
      if (!this.state.nodeStarted) {
        this.reportError('resonance round supply', new Error('advanceSupply did not start the next node'));
        return FAIL(ERR.BAD_TARGET, 'SUPPLY_NOT_ADVANCED');
      }
      this._startResonanceRound(this.state.round);
      return result;
    }).finally(() => {
      if (this._supplyAdvancePromise === advance) this._supplyAdvancePromise = null;
    });
    this._supplyAdvancePromise = advance;
    return advance;
  }

  _startResonanceRound(round) {
    if (this._isFunnyLogisticsNode()) {
      // Odd FUNNY nodes are real supply/choice windows, but have no Resonance Battle spec.
      // Keep Native's ROUND_START → PREP presentation while ready remains guarded above.
      this.currentPrepared = null;
      this.bossId = null;
      this.hiddenBossId = null;
      super.startRound(round);
      this.syncPlayer();
      return;
    }
    const field = getResonanceField(this.state, { data: this.data, catalog: this.catalog });
    this.currentPrepared = { round, prepared: buildResonanceBattle(this.state, { data: this.data, catalog: this.catalog }).prepared };
    this.bossId = field.bossId;
    this.hiddenBossId = field.hiddenBossId;
    super.startRound(round);
    this.wave = field.wave;
    this.stageId = field.stageId;
    this.waveId = field.wave?.templateId ?? null;
    this.factions = field.factions;
    this.syncPlayer();
  }

  afterRoundStart() { this.enterPrep(); }

  endPrep() {
    // Reuse Native prep dispatch, PlayerState endPrep, and its NORMAL / FINAL_ASSAULT /
    // HIDDEN_CORE branch. GameData's instance-local terminal rounds are resonance nodes.
    return super.endPrep();
  }

  startFinalAssault(hidden) {
    if (hidden) {
      // A PREP restore has no live Native Match LP object; the session HP is the settled
      // campaign source for the Hidden Core. Refreshing here also covers the prior round's
      // session settlement after an in-process final-assault finish.
      this.teamLp = Math.max(0, Number(this.state.hp) || 0);
      for (const ps of this.alivePlayers()) ps.lpAtFinal = Math.max(0, Number(ps.lp) || 0);
    }
    const multiplier = Number(this.currentPrepared?.prepared?.enemyBalance?.bossPoolMultiplier);
    if (this.catalog.config?.rulesVersion !== 3 || !(Number.isFinite(multiplier) && multiplier > 0)) {
      return super.startFinalAssault(hidden);
    }
    // Native owns the shared pool and boss clock. Apply the campaign's already-resolved
    // terminal pool multiplier at the Native pool source so its b.pool and Runner spec agree.
    const gd = this.gd;
    const hadOwn = Object.hasOwn(gd, 'bossHpMul');
    const previous = Object.getOwnPropertyDescriptor(gd, 'bossHpMul');
    const original = gd.bossHpMul.bind(gd);
    Object.defineProperty(gd, 'bossHpMul', { configurable: true, writable: true,
      value: (bossId) => original(bossId) * multiplier });
    let started;
    try { started = super.startFinalAssault(hidden); }
    finally {
      if (hadOwn && previous) Object.defineProperty(gd, 'bossHpMul', previous);
      else delete gd.bossHpMul;
    }
    this.persistNativeRuntime({ paused: this.paused });
    return started;
  }

  _planBossWaves() {
    if (this.currentPrepared?.round === this.state.round
      && ['boss', 'hidden'].includes(this.currentPrepared.prepared.nodeKind)) {
      const { prepared } = this.currentPrepared;
      this.bossId = prepared.bossId;
      this.hiddenBossId = prepared.hiddenBossId;
      this.bossWaves = [{ players: [PLAYER], wave: prepared.wave }];
      return;
    }
    return super._planBossWaves();
  }

  _ccField(input) {
    // A fast-finish rate belongs to the field that requested it. The selected normal rate
    // survives settlement and is restored before any subsequent Native field is constructed.
    this.gameSpeed = this.nativeCombatSpeed;
    if (this.currentPrepared?.round === this.state.round) {
      const ps = this.players.get(PLAYER);
      const preparedOpts = this._normalOpts(ps);
      input = { ...input, kind: preparedOpts.kind, opts: preparedOpts };
    }
    const field = super._ccField(input);
    if (this.currentPrepared?.round === this.state.round) field.kind = this.currentPrepared.prepared.nodeKind === 'hidden' ? 'hidden'
      : this.currentPrepared.prepared.nodeKind === 'boss' ? 'boss' : 'normal';
      this.state.nativeRuntime = { phase: this.phase, kind: field.kind, fieldId: field.fieldId, battleId: field.battleId,
      spec: field.spec, elapsed: 0, paused: false, speed: [1, 2, 4].includes(this.gameSpeed) ? this.gameSpeed : 2,
      selectedSpeed: this.nativeCombatSpeed, finishing: false, progress: field.progress, uidMap: this.uidMap.snapshot() };
    this.persistNativeRuntime();
    return field;
  }

  _normalOpts(ps) {
    const built = buildResonanceBattle(this.state, { data: this.data, catalog: this.catalog });
    const prepared = built.prepared;
    const options = built.battle.opts;
    const input = structuredClone(options.players?.[0] ?? { playerId: PLAYER, seat: 0, side: 'L', units: [] });
    for (const unit of input.units ?? []) {
      const oldUid = unit.uid;
      unit.uid = this.uidMap.native(oldUid);
      if (unit.ownerUid != null) unit.ownerUid = this.uidMap.native(unit.ownerUid);
    }
    const raw = options.data ?? {};
    const chess = Object.fromEntries(Object.entries(raw.chess ?? {}).filter(([id]) => id.startsWith('resonance_')));
    const tokens = Object.fromEntries(Object.entries(raw.tokens ?? {}).filter(([, token]) => Object.keys(token?.variants ?? {}).some((id) => id.startsWith('resonance_'))));
    for(const unit of input.units??[])if(unit.kind==='token'&&String(unit.tokenId??'').startsWith('resonance_special_')&&unit.def)tokens[unit.tokenId]=structuredClone(unit.def);
    // Result validation uses this match's GameData. Keep the V3 spec's exact star/token records available there
    // without mutating shared canonical data or widening any other Match's lookup.
    this._resonanceValidationData = { chess, tokens };
    const state = structuredClone(this.state);
    state.pieces = state.pieces.map((piece) => ({ ...piece, nativeUid: this.uidMap.native(piece.uid) }));
    for (const piece of state.pieces) piece.uid = piece.nativeUid;
    state.specialEntities=(state.specialEntities??[]).map((entity)=>({...entity,nativeUid:this.uidMap.native(entity.uid),uid:this.uidMap.native(entity.uid)}));
    const minimalCatalog = this.catalogForBattle(state);
    const flags = { ...options.flags, resonance: { ...options.flags.resonance, state, catalog: minimalCatalog, dataPatch: { chess, tokens } } };
    const nodeKind = prepared.nodeKind === 'elite' ? 'normal' : prepared.nodeKind;
    const bossLike = nodeKind === 'boss' || nodeKind === 'hidden';
    const poolHp = options.sharedBoss?.hp ?? 1, poolMax = options.sharedBoss?.maxHp ?? poolHp;
    const out = { ...options, kind: nodeKind, stageId: prepared.stageId, waveId: prepared.wave.templateId,
      bossId: prepared.bossId, boss: bossLike ? { poolHp, poolMax } : null,
      players: [{ ...input, playerId: PLAYER }], flags, data: undefined, sharedBoss: undefined,
      battleId: undefined, fieldId: `n:${PLAYER}`, content: 'independent' };
    this.currentPrepared = { round: this.state.round, prepared };
    this.deadline = 0;
    return out;
  }

  _afterCombat() {
    if (![PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(this.phase)) return;
    const field = this.fields.find((entry) => entry.players.includes(PLAYER));
    if (!field?.done || !field.result || this.settledBattleIds.has(field.battleId) || this.settlingBattleIds.has(field.battleId)) return;
    if (field.resultSource === 'client' && field._resonanceClientResult && !field.result.resonance) {
      field.result.resonance = field._resonanceClientResult;
    } else if (field.resultSource === 'server' && field.battle && !field.result.resonance) {
      const modeResult = resonanceResultExtras(field.battle);
      if (modeResult) field.result.resonance = modeResult;
    }
    delete field._resonanceClientResult;
    this.settlingBattleIds.add(field.battleId);
    let sourceResult = field.result;
    if (!['client', 'server'].includes(field.resultSource)) {
      sourceResult = Object.fromEntries(Object.entries(field.result).filter(([key]) => key !== 'resonance'));
    }
    const completedResult = nativeResultForSession(this.state, sourceResult, { data: this.data, catalog: this.catalog,
      prepared: this.currentPrepared?.prepared, uidMap: this.uidMap });
    completedResult.battleId = field.battleId;
    if (this.nativeFinalOutcome?.battleId === field.battleId) {
      const final = this.nativeFinalOutcome;
      completedResult.won = final.victory;
      completedResult.hpLoss = Math.max(completedResult.hpLoss, Math.max(0, this.state.hp - final.teamLp));
      completedResult.nativeFinal = { phase: final.phase, teamLp: final.teamLp, victory: final.victory };
    }
    const settled = this.enqueueSessionAction({ type: 'fight' }, completedResult);
    void settled.then((result) => {
      if (result?.error) { this.settlingBattleIds.delete(field.battleId); this.reportError('resonance settle', new Error(result.detail)); return; }
      this.settlingBattleIds.delete(field.battleId);
      this.settledBattleIds.add(field.battleId);
      if (this.nativeFinalOutcome?.battleId === field.battleId) this.nativeFinalOutcome = null;
      if ([PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(this.phase)) {
        this.phase = PHASE.SETTLE;
        this.fields = [];
        this.markPublic(); this.markPrivate(this.players.get(PLAYER)); this.flush(true);
        this.setDeadline(DELAYS.SETTLE / 1000, () => this.afterSettle(), { silent: this.soloUntimed });
      }
    }).catch((error) => this.reportError('resonance settle', error));
  }

  _finishFinal(hidden, resultOf) {
    const expected = hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT;
    if (this.phase !== expected) return;
    const field = this.fields.find((entry) => entry.players.includes(PLAYER));
    if (!field?.done) return;
    const result = resultOf?.(field);
    if (result && typeof result === 'object') field.result = result;
    if (!field.result) return;
    this._stopClientCombat();
    const victory = this._finalEnding ? this._finalEnding === 'cleared' : this.bossPool?.hp <= 0;
    this.nativeFinalOutcome = { battleId: field.battleId, phase: expected, victory,
      teamLp: Math.max(0, Number(this.teamLp) || 0), bossHp: Math.max(0, Number(this.bossPool?.hp) || 0) };
    // Native controls the pool, overtime clock, b.end, result validation, and field completion.
    // Only the accepted terminal outcome is projected into the Resonance economy/history.
    this._afterCombat();
  }

  _bossClockTick() {
    super._bossClockTick();
    this.persistNativeRuntime();
  }

  catalogForBattle(state) {
    const operatorIds = new Set(state.pieces.map((piece) => piece.operatorId));
    const pactIds = new Set();
    const itemIds = new Set();
    for (const piece of state.pieces) {
      const operator = this.catalog.operators[piece.operatorId];
      for (const pactId of operator?.pacts ?? []) pactIds.add(pactId);
      for (const item of piece.equipment ?? []) {
        itemIds.add(item.itemId);
        const record=this.catalog.equipment[item.itemId];
        for (const effect of record?.effects ?? []) if (effect.params?.pactId) pactIds.add(effect.params.pactId);
        // Battle adapters may inspect the source components of a completed item (e.g. Scrap's
        // component-count shield). Keep those definitions in the snapshot even when the player
        // no longer owns the components as separate inventory entries.
        for (const partId of record?.parts ?? []) itemIds.add(partId);
      }
    }
    for (const item of state.inventory ?? []) itemIds.add(item.itemId);
    const ownedComponents=new Set([...itemIds].filter((id)=>this.catalog.equipment[id]?.kind==='component'));
    for(const recipe of this.catalog.recipes??[])if((recipe.parts??[]).some((id)=>ownedComponents.has(id))){
      itemIds.add(recipe.resultId);
      for(const partId of recipe.parts)itemIds.add(partId);
    }
    const strategyIds = new Set(state.strategies.map((entry) => typeof entry === 'string' ? entry : entry.id));
    return { schemaVersion: this.catalog.schemaVersion,
      operators: Object.fromEntries([...operatorIds].filter((id) => this.catalog.operators[id]).map((id) => [id, this.catalog.operators[id]])),
      pacts: Object.fromEntries([...pactIds].filter((id) => this.catalog.pacts[id]).map((id) => [id, this.catalog.pacts[id]])),
      equipment: Object.fromEntries([...itemIds].filter((id) => this.catalog.equipment[id]).map((id) => [id, this.catalog.equipment[id]])),
      strategies: Object.fromEntries([...strategyIds].filter((id) => this.catalog.strategies[id]).map((id) => [id, this.catalog.strategies[id]])),
      recipes: this.catalog.recipes.filter((recipe) => recipe.parts.every((id) => itemIds.has(id)) || itemIds.has(recipe.resultId)),
      config: { ...this.catalog.config, activeOperatorIds: [...operatorIds] },
      prototypeMeta: this.catalog.prototypeMeta ? { seasonId: this.catalog.prototypeMeta.seasonId, rulesVersion: 3,
        exactCounts: this.catalog.prototypeMeta.exactCounts, traits: this.catalog.prototypeMeta.traits } : undefined,
      prototypeSeason: this.catalog.prototypeMeta ? { traits: this.catalog.prototypeMeta.traits } : undefined,
      specialEntities:Object.fromEntries((this.state.specialEntities??[]).map((entity)=>[entity.entityId,this.catalog.specialEntities?.[entity.entityId]]).filter(([,definition])=>definition)),
    };
  }

  afterSettle() {
    if (this.state.phase === 'complete') {
      this.phase = PHASE.RESULT;
      this.finish({ victory: this.state.terminalReason === 'victory', reason: this.state.terminalReason });
      return;
    }
    this.gameSpeed = this.nativeCombatSpeed;
    this.syncPlayer();
    super.afterSettle();
  }

  dispose() {
    this.activeResonanceMatch = false;
    this.store.deactivate?.(this.sessionId);
    super.dispose();
  }
}

export function resonanceCatalogPacket(match) {
  const data = match.data || {};
  const active = new Set(match.catalog.config?.activeOperatorIds ?? Object.keys(match.catalog.operators ?? {}));
  const chess = {};
  for (const [id, operator] of Object.entries(match.catalog.operators ?? {})) {
    if (!active.has(id)) continue;
    const sourceId = operator.source?.sourceChessId ?? id;
    const base = data.chess?.[sourceId] ?? data.chess?.[operator.charId];
    for (const star of [1, 2, 3]) {
      const variantId = match.nativeChessId(id, star);
      const variant = operator.stars?.[star]?.record;
      if (!base || !variant) continue;
      const presentation=resonanceOperatorPresentation(match.catalog,operator);
      const projected = { ...base, ...variant, chessId: variantId, baseId: star === 1 ? variantId : id,
        sourceChessId: sourceId, charId: operator.charId, tier: operator.cost, name: operator.name,
        isHidden: star > 1, visible: star === 1, resonanceStar: star, bonds: [...(operator.pacts ?? [])],
        ...(presentation?{passivePresentation:presentation}:{}),
        assets: { ...(base.assets??{}), ...(variant.assets??{}), ...(variant.skill?{skillIcon:variant.skill.iconId??operator.fixedSkillId}: {}),
          ...(presentation?{resonancePresentationIcon:presentation.icon}:{}) },
        skills: variant.skills ?? [], skill: variant.skill ?? null, stats: { ...(variant.stats ?? {}) } };
      if (match.catalog.config?.rulesVersion === 3 && Array.isArray(projected.garrisonIds)) {
        projected.garrisonIds = projected.garrisonIds.filter((garrisonId) => data.garrisons?.[garrisonId]?.effectType !== 'SERVER_GAIN_EQUIP');
      }
      chess[variantId] = projected;
    }
  }
  const bonds = Object.fromEntries(Object.entries(match.catalog.pacts ?? {}).map(([id, pact]) => [id, {
    id, name: pact.name, desc: pact.description,
    noStack: match.catalog.config?.rulesVersion === 3 || pact.singleUnique === true,
    members: pact.members ?? Object.values(match.catalog.operators ?? {}).filter((operator) => active.has(operator.sourceChessId ?? operator.id)
      && (operator.pacts ?? []).includes(id)).map((operator) => operator.charId),
    thresholds: pact.thresholds ?? pact.levels?.map((level) => level.minUnits ?? level.threshold) ?? [], levels: pact.levels ?? [],
  }]));
  const equipment = Object.fromEntries(Object.entries(match.catalog.equipment ?? {}).map(([id, item]) => [id, {
    ...(data.items?.[id] ?? {}), id, name: item.name, desc: item.description, kind: item.kind,
    // the native item art (build-content.mjs iconId): the native detail card's item rows resolve icons by iconId
    ...(item.iconId ? { iconId: item.iconId } : {}),
  }]));
  const display=resonanceDisplayCatalog(match.displayCatalog ?? match.catalog, match.data);
  return { t: 'r.catalog', catalog: display, data: {
    chess, bonds, items: equipment, config: data.config || {},
  } };
}

export function resonanceBattlePacket(match, field) {
  return field ? match._startMsg(field, PLAYER) : null;
}
