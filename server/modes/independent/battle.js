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

const PLAYER_ID = 'independent';
const SAMPLE_LIMIT = 24;
const SAMPLE_INTERVAL_TICKS = 30;
const MAX_TICKS = Math.ceil(MAX_BATTLE_TIME / TICK) + 1;

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

/** Run one real upstream Battle for the current independent-mode round. Does not mutate state. */
export function runIndependentBattle(state, { data = null, catalog = null } = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('independent battle requires a state object');
  const source = rawData(data);
  catalog ??= getCatalog(source);
  const input = structuredClone(state);
  const prepared = prepare(input, source);
  const units = battleUnits(input);
  const sharedBoss = prepared.kind === 'normal' ? null : new SharedBossPool(bossPoolHp(prepared.gd, prepared.bossId, 1));
  const battle = new Battle({
    seed: deriveSeed(Number(input.seed) >>> 0, `independent:battle:${prepared.round}:${prepared.modeId}`),
    kind: prepared.kind,
    modeId: prepared.modeId,
    round: prepared.round,
    stage: prepared.stage,
    timeLimit: prepared.wave.timeLimit,
    players: [{ playerId: PLAYER_ID, seat: 0, side: 'L', colOffset: 0, units, bonds: {} }],
    spawns: prepared.wave.spawns,
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
    recordEvents: true,
    logger: { warn() {}, error() {}, info() {}, log() {} },
    extraContent: [b => installIndependentBattle(b, { catalog, state: input })],
  });
  const samples = [];
  while (!battle.finished && battle.tickCount < MAX_TICKS) {
    battle.step();
    if ((battle.tickCount % SAMPLE_INTERVAL_TICKS === 0 || battle.finished) && samples.length < SAMPLE_LIMIT) samples.push(sampleBattle(battle));
  }
  const capped = !battle.finished;
  if (capped) battle.forceEnd('timeout');
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
  return { result, rewards, pieceStates, samples, diagnostics };
}
