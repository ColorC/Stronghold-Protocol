import { getData } from '../../data.js';
import { GameData } from '../../match/gamedata.js';
import { modeIdFor } from '../../../shared/constants.js';
import { Battle } from '../../sim/Battle.js';
import { TICK, MAX_BATTLE_TIME } from '../../sim/constants.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { setupMatchWaves, buildNormalWave, buildBossWave } from '../../match/waves.js';
import { bossPoolHp, SharedBossPool } from '../../match/finalAssault.js';
import { buildDeployMap } from '../../match/board.js';
import { installIndependentBattle } from '../../sim/content/independent/battle.js';
import { getCatalog } from './catalog.js';
import { unitStatsEntry } from '../../../shared/protocol.js';

const PLAYER_ID = 'independent';
const SAMPLE_LIMIT = 24;
const SAMPLE_INTERVAL_TICKS = 30;
/** Replay frames: one b.snap + the b.ev tuples drained since the previous one, every 3 ticks (tools/record-battle.mjs). */
export const REPLAY_SNAP_EVERY = 3;
const MAX_TICKS = Math.ceil(MAX_BATTLE_TIME / TICK) + 1;
/** Replay stats: every second, the detail-card stats (shared/protocol.js unitStatsEntry) of each unit whose ones changed. */
export const REPLAY_STATS_EVERY = Math.round(1 / TICK);

function rawData(data) {
  if (data && typeof data === 'object') return data;
  return getData();
}

function roundOf(state) {
  const n = Number(state?.round);
  if (!Number.isInteger(n) || n < 1) throw new TypeError('independent battle requires state.round >= 1');
  return n;
}

function modeOf(state) {
  const difficulty = String(state?.difficulty ?? 'NORMAL').toUpperCase();
  return modeIdFor('solo', difficulty);
}

function prepare(state, data) {
  const round = roundOf(state);
  const modeId = modeOf(state);
  const roundLimit = Number(state.roundLimit ?? 14);
  if (![9, 14, 15].includes(roundLimit)) throw new RangeError(`unsupported independent roundLimit: ${roundLimit}`);
  const gd = new GameData(data, modeId);
  const setup = setupMatchWaves(gd, createRng(deriveSeed(Number(state.seed) >>> 0, 'world')));
  const isHiddenRound = roundLimit === 15 && round === 15;
  const isBossRound = (roundLimit === 9 && round === 9) || ((roundLimit === 14 || roundLimit === 15) && round === 14) || isHiddenRound;
  const field = isBossRound ? 'bossL' : 'normal';
  const rng = createRng(deriveSeed(Number(state.seed) >>> 0, `independent:wave:${round}:${modeId}`));
  const bossId = isHiddenRound ? setup.hiddenBossId : setup.bossId;
  const wave = isBossRound
    ? buildBossWave(gd, rng, setup, round, { bossId, solo: true })
    : buildNormalWave(gd, rng, setup, round);
  const stageId = setup.stageId ?? wave.templateId ?? null;
  const stage = gd.stage(stageId);
  if (!stage) throw new Error(`independent wave ${round} has no resolvable stage (stageId=${stageId ?? 'null'})`);
  if (!wave.templateId) throw new Error(`independent wave ${round} has no upstream wave template`);
  if (isBossRound && (!bossId || !gd.boss(bossId))) throw new Error(`independent boss wave ${round} has no upstream boss`);
  const kind = isHiddenRound ? 'hidden' : isBossRound ? 'boss' : 'normal';
  return { gd, round, modeId, setup, field, wave, stageId, stage, bossId, roundLimit, kind };
}

/** Resolve the deterministic upstream field and legal placement map used by both prep and battle. */
export function getIndependentField(state, { data = null } = {}) {
  const source = rawData(data);
  const prepared = prepare(state, source);
  return {
    stageId: prepared.stageId,
    stage: prepared.stage,
    wave: prepared.wave,
    field: prepared.field,
    deployMap: buildDeployMap(prepared.stage, { field: prepared.field }),
    // the run's enemy leader and enemy factions (match/waves.js setupMatchWaves), for the 敌方情报 drawer
    bossId: prepared.setup.bossId ?? null, hiddenBossId: prepared.setup.hiddenBossId ?? null, factions: [...(prepared.setup.factions || [])],
  };
}

function battleUnits(state) {
  const pieces = Array.isArray(state?.pieces) ? state.pieces : [];
  const units = [];
  for (const piece of pieces) {
    if (!piece || piece.row == null || piece.col == null) continue;
    if (!Number.isInteger(Number(piece.row)) || !Number.isInteger(Number(piece.col))) continue;
    units.push({
      uid: piece.uid,
      kind: 'chess',
      chessId: piece.chessId,
      row: Number(piece.row),
      col: Number(piece.col),
      dir: piece.dir ?? 'RIGHT',
      skillIndex: piece.skillIndex ?? 0,
      moduleId: piece.moduleId ?? 'none',
    });
  }
  return units;
}

function sampleBattle(battle) {
  const units = battle.allyUnits.filter((u) => u.kind === 'op').map((u) => ({
    uid: u.uid,
    chessId: u.defId,
    alive: !!u.alive,
    deployed: !!u.deployed,
    hp: Math.round(u.hp),
    maxHp: Math.round(u.s?.maxHp ?? u.base.maxHp),
    atk: Math.round(u.s?.atk ?? u.base.atk),
    equipmentShield: Number(u.mem?.independentEquipmentShield ?? 0),
  }));
  const enemies = battle.enemies.slice(0, 48).map((u) => ({
    id: u.id,
    enemyId: u.defId,
    alive: !!u.alive,
    hp: Math.round(u.hp),
    maxHp: Math.round(u.s?.maxHp ?? u.base.maxHp),
  }));
  return { t: Math.round(battle.time * 1000) / 1000, units, enemies, killed: battle.killed, leaked: battle.leakedCount };
}

/**
 * The Battle of a round's own board. `preview`: the start-of-battle preview the detail card reads (the original's
 * Match._unitStatsOf): no enemies, a normal field, its own seed, no event record — built, started and dropped.
 */
function buildBattle(input, source, catalog, { preview = false } = {}) {
  const prepared = prepare(input, source);
  const units = battleUnits(input);
  const sharedBoss = preview || prepared.kind === 'normal' ? null : new SharedBossPool(bossPoolHp(prepared.gd, prepared.bossId, 1));
  const battle = new Battle({
    seed: deriveSeed(Number(input.seed) >>> 0, `independent:${preview ? 'preview' : 'battle'}:${prepared.round}:${prepared.modeId}`),
    kind: preview ? 'normal' : prepared.kind,
    modeId: prepared.modeId,
    round: prepared.round,
    stage: prepared.stage,
    timeLimit: prepared.wave.timeLimit,
    players: [{ playerId: PLAYER_ID, seat: 0, side: 'L', colOffset: 0, units, bonds: {} }],
    spawns: preview ? [] : prepared.wave.spawns,
    routes: [...(prepared.wave.routes || []), ...(prepared.wave.extraRoutes || [])],
    enemyOverrides: prepared.wave.overrides,
    sharedBoss,
    flags: {
      layerGainsEnabled: false,
      independent: { catalog, pieces: input.pieces, counters: input.counters ?? {}, round: prepared.round, roundLimit: prepared.roundLimit },
    },
    fieldId: `independent-r${prepared.round}`,
    data: source,
    content: 'independent',
    recordEvents: !preview,
    logger: { warn() {}, error() {}, info() {}, log() {} },
    extraContent: [b => installIndependentBattle(b, { catalog, state: input })],
  });
  return { battle, prepared };
}

/**
 * What each deployed operator starts its next battle with (equipment, attachments and traits applied, before any skill
 * or timed effect): piece uid → shared/protocol.js unitStatsEntry, as the original's m.unitStats. {} when it cannot
 * be built. Does not mutate state.
 */
export function previewUnitStats(state, { data = null, catalog = null } = {}) {
  const source = rawData(data);
  catalog ??= getCatalog(source);
  const out = {};
  try {
    const { battle } = buildBattle(structuredClone(state), source, catalog, { preview: true });
    battle.start();
    for (const u of battle.allyUnits) if (u && typeof u.uid === 'string' && u.kind === 'op') out[u.uid] = unitStatsEntry(u, u.s);
  } catch { return {}; }
  return out;
}

/** Run one real upstream Battle for the current independent-mode round. Does not mutate state. */
export function runIndependentBattle(state, { data = null, catalog = null } = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('independent battle requires a state object');
  const source = rawData(data);
  catalog ??= getCatalog(source);
  const input = structuredClone(state);
  const { battle, prepared } = buildBattle(input, source, catalog);
  const samples = [];
  // The replay the browser plays with the original renderer is recorded from this authoritative run, in the
  // format of tools/record-battle.mjs (public/dev/render-demo.js plays those): snapshot() and drainEvents() only read
  // the field and empty the event queue, so the run and its result are the same with or without it.
  const frames = [];
  let field = null;
  // the stats each unit was last recorded with (by unit id): a frame carries only the ones that changed
  const lastStats = new Map();
  const statsChanges = () => {
    const out = {};
    for (const u of battle.units) {
      if (!u || (u.kind !== 'op' && u.side !== 'enemy') || !u.alive) continue;
      const entry = unitStatsEntry(u, u.s); const key = JSON.stringify(entry);
      if (lastStats.get(u.id) !== key) { lastStats.set(u.id, key); out[u.id] = entry; }
    }
    return Object.keys(out).length ? out : null;
  };
  while (!battle.finished && battle.tickCount < MAX_TICKS) {
    battle.step();
    if (!field) field = battle.fieldMeta();
    if (battle.tickCount % REPLAY_SNAP_EVERY === 0) {
      const frame = { snap: battle.snapshot(), ev: battle.drainEvents() };
      if (battle.tickCount % REPLAY_STATS_EVERY === REPLAY_SNAP_EVERY) { const stats = statsChanges(); if (stats) frame.stats = stats; }
      frames.push(frame);
    }
    if ((battle.tickCount % SAMPLE_INTERVAL_TICKS === 0 || battle.finished) && samples.length < SAMPLE_LIMIT) samples.push(sampleBattle(battle));
  }
  const capped = !battle.finished;
  if (capped) battle.forceEnd('timeout');
  // the end state; a battle that ended on a frame tick only appends its trailing events
  const tail = { snap: battle.snapshot(), ev: battle.drainEvents() };
  const lastFrame = frames[frames.length - 1];
  if (!lastFrame || tail.snap.t > lastFrame.snap.t) frames.push(tail);
  else lastFrame.ev.push(...tail.ev);
  const result = battle.result();
  const rewards = battle.independentRewards ?? [];
  const pieceStates = Object.fromEntries(input.pieces.map((p) => [p.uid, {
    nativeState: structuredClone(p.nativeState ?? {}),
    equipment: structuredClone(p.equipment ?? []),
    attachments: structuredClone(p.attachments ?? []),
    battle: battle.allyUnits.find((u) => u.uid === p.uid)?.mem?.independentState ?? {},
  }]));
  const diagnostics = {
    modeId: prepared.modeId,
    round: prepared.round,
    kind: prepared.kind,
    stageId: prepared.stageId,
    templateId: prepared.wave.templateId,
    bossId: prepared.bossId,
    ticks: battle.tickCount,
    tickLimit: MAX_TICKS,
    capped,
    errorCount: battle.errorCount,
    errors: battle.errors.slice(0, 20),
  };
  if (battle.errorCount) throw Object.assign(new Error(`independent Battle recorded ${battle.errorCount} simulation/content error(s)`), { diagnostics, result });
  const replay = {
    // field = the m.field payload, as in tools/record-battle.mjs; fieldKind = the board ('normal' | 'bossL')
    version: 1, kind: prepared.kind, fieldKind: prepared.field, stageId: prepared.stageId, modeId: prepared.modeId, round: prepared.round,
    bossId: prepared.bossId ?? null, tick: TICK, snapEvery: REPLAY_SNAP_EVERY, duration: Math.round(battle.time * 100) / 100,
    field, frames,
  };
  return { result, rewards, pieceStates, samples, diagnostics, replay };
}
