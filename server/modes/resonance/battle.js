import { getData } from '../../data.js';
import { GameData } from '../../match/gamedata.js';
import { modeIdFor } from '../../../shared/constants.js';
import { unitStatsEntry } from '../../../shared/protocol.js';
import { Battle } from '../../sim/Battle.js';
import { toDataSource } from '../../sim/simdata.js';
import { TICK, MAX_BATTLE_TIME } from '../../sim/constants.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { setupMatchWaves, buildNormalWave, buildBossWave } from '../../match/waves.js';
import { bossPoolHp, SharedBossPool } from '../../match/finalAssault.js';
import { buildDeployMap, canPlace, positionClass, ownerRangeKeys } from '../../match/board.js';
import { KITS, MODULES } from '../../sim/content/index.js';
import { localOrder } from '../../sim/dir.js';
import { SKILL_SUMMON_START_DEPLOY } from '../../../shared/constants.js';
import { getResonanceCatalog } from './catalog.js';
import { installResonanceBattle } from '../../sim/content/resonance/battle.js';
import { createResonanceKits } from '../../sim/content/resonance/kits.js';

const PLAYER_ID = 'resonance';
const REPLAY_SNAP_EVERY = 3;
const REPLAY_STATS_EVERY = Math.round(1 / TICK);
const MAX_TICKS = Math.ceil(MAX_BATTLE_TIME / TICK) + 1;
const noopLogger = Object.freeze({ warn() {}, error() {}, info() {}, log() {} });
const starChessId = (operatorId, star) => `resonance_${operatorId}_star${star}`;
const ENEMY_BALANCE_FIELDS=Object.freeze({hpMultiplier:'hpMul',atkMultiplier:'atkMul',defMultiplier:'defMul',resMultiplier:'resMul',speedMultiplier:'speedMul',bossPoolMultiplier:null});
const ENEMY_BALANCE_ONE=Object.freeze({hpMultiplier:1,atkMultiplier:1,defMultiplier:1,resMultiplier:1,speedMultiplier:1,bossPoolMultiplier:1});
const DIFFICULTIES=new Set(['FUNNY','NORMAL','HARD','ABYSS']);

function mergeBalanceProfile(base,override,label){
  const out={...base};
  if(override==null)return out;
  if(typeof override!=='object'||Array.isArray(override))throw new TypeError(`invalid resonance enemy balance profile: ${label}`);
  for(const [key,value] of Object.entries(override)){
    if(!Object.hasOwn(ENEMY_BALANCE_FIELDS,key))throw new TypeError(`unknown resonance enemy balance field: ${label}.${key}`);
    if(!Number.isFinite(value)||value<=0)throw new TypeError(`resonance enemy balance must be finite and > 0: ${label}.${key}`);
    out[key]=value;
  }
  return out;
}

/** Resolve authored campaign.enemyBalance for one node; missing fields preserve native multiplier 1. */
export function resolveEnemyBalance(enemyBalance,difficulty,nodeKind){
  if(enemyBalance==null)return {...ENEMY_BALANCE_ONE};
  if(typeof enemyBalance!=='object'||Array.isArray(enemyBalance))throw new TypeError('invalid resonance campaign.enemyBalance');
  for(const key of Object.keys(enemyBalance))if(!['regular','terminal','byDifficulty','source','difficultyMultiplier','nodeScaling'].includes(key))throw new TypeError(`unknown resonance enemy balance section: ${key}`);
  if(enemyBalance.source!=null&&enemyBalance.source!=='native-wave')throw new TypeError('unsupported legacy resonance enemy balance source');
  if(enemyBalance.difficultyMultiplier!=null&&enemyBalance.difficultyMultiplier!==1)throw new TypeError('unsupported legacy resonance enemy difficulty multiplier');
  if(enemyBalance.nodeScaling!=null&&enemyBalance.nodeScaling!=='native-stage')throw new TypeError('unsupported legacy resonance enemy node scaling');
  const regular=mergeBalanceProfile(ENEMY_BALANCE_ONE,enemyBalance.regular,'regular');
  const terminal=mergeBalanceProfile(ENEMY_BALANCE_ONE,enemyBalance.terminal,'terminal');
  const scope=nodeKind==='boss'||nodeKind==='hidden'?'terminal':'regular',base=scope==='terminal'?terminal:regular;
  if(enemyBalance.byDifficulty==null)return base;
  if(typeof enemyBalance.byDifficulty!=='object'||Array.isArray(enemyBalance.byDifficulty))throw new TypeError('invalid resonance campaign.enemyBalance.byDifficulty');
  for(const [key,override] of Object.entries(enemyBalance.byDifficulty)){
    if(!DIFFICULTIES.has(key))throw new TypeError(`invalid resonance enemy balance difficulty: ${key}`);
    if(typeof override!=='object'||override===null||Array.isArray(override))throw new TypeError(`invalid resonance enemy balance byDifficulty.${key}`);
    for(const name of Object.keys(override))if(!['regular','terminal'].includes(name))throw new TypeError(`unknown resonance enemy balance scope: byDifficulty.${key}.${name}`);
    mergeBalanceProfile(regular,override.regular,`byDifficulty.${key}.regular`);
    mergeBalanceProfile(terminal,override.terminal,`byDifficulty.${key}.terminal`);
  }
  return mergeBalanceProfile(base,enemyBalance.byDifficulty[difficulty]?.[scope],`byDifficulty.${difficulty}.${scope}`);
}

function scaleWaveSpawnMods(wave,multipliers){
  if(Object.values(multipliers).every(value=>value===1))return wave;
  const spawns=(wave.spawns??[]).map(spawn=>{
    const mods={...(spawn.mods??{})};
    for(const [field,modKey] of Object.entries(ENEMY_BALANCE_FIELDS)){
      if(!modKey||multipliers[field]===1)continue;
      const native=mods[modKey]??1,scaled=native*multipliers[field];
      if(!Number.isFinite(scaled)||scaled<=0)throw new TypeError(`invalid scaled native wave modifier: ${modKey}`);
      mods[modKey]=scaled;
    }
    return {...spawn,mods:Object.keys(mods).length?mods:undefined};
  });
  return {...wave,spawns};
}

export function resonanceBattleWon(result,nodeKind,{capped=false}={}) {
  if (capped) return false;
  if (nodeKind==='boss'||nodeKind==='hidden') return Number.isFinite(Number(result?.bossHpLeft))&&Number(result.bossHpLeft)<=0;
  return result?.reason==='cleared'&&Object.values(result.perPlayer??{}).every(player=>!(player.leaked??[]).some(entry=>entry&&entry.counted!==false));
}

function sourceData(data) {
  if (data && typeof data === 'object') return data;
  return getData();
}

function catalogFor(state, source, catalog) {
  return catalog ?? getResonanceCatalog(source, {
    environmentId: state?.environmentId ?? 'origin_laterano',
    seed: state?.seed ?? 1,
  });
}

function effectiveTimeLimit(prepared, catalog) {
  if (!['boss', 'hidden'].includes(prepared.nodeKind)) return prepared.wave.timeLimit;
  const cap = Number(catalog?.campaign?.terminalTimeLimitSeconds);
  if (!(Number.isFinite(cap) && cap > 0)) return prepared.wave.timeLimit;
  const source = Number(prepared.wave.timeLimit);
  return Math.min(Number.isFinite(source) && source > 0 ? source : MAX_BATTLE_TIME, cap);
}

export function finishResonanceTerminalIfEscaped(battle, nodeKind) {
  if (!['boss', 'hidden'].includes(nodeKind) || battle.finished || !battle.started || battle._spawnSeq <= 0) return false;
  if (!(battle.sharedBoss?.hp > 0) || (battle._pending?.length ?? 0) > 0 || battle.enemies.some(enemy => enemy.alive && enemy.deployed)) return false;
  if (battle._hasPendingEnemySchedules()) return false;
  battle.forceEnd('leader-escaped');
  return battle.finished;
}

function battleNode(state) {
  const round = Number(state?.round);
  const difficulty = String(state?.difficulty ?? 'NORMAL').toUpperCase();
  if (!Number.isInteger(round) || round < 1) throw new TypeError('resonance battle requires state.round >= 1');
  const expectedLimit = difficulty === 'ABYSS' ? 30 : 28;
  if (!['FUNNY', 'NORMAL', 'HARD', 'ABYSS'].includes(difficulty) || state.roundLimit !== expectedLimit || round > expectedLimit) {
    throw new RangeError(`unsupported resonance campaign node: ${difficulty}:${round}/${state.roundLimit}`);
  }
  if (difficulty === 'FUNNY') {
    if (round % 2 !== 0) throw new Error('FUNNY_LOGISTICS_NODE_HAS_NO_BATTLE');
    return { difficulty, battleRound: round / 2, waveRound: round / 2, waveDifficulty: 'NORMAL', nodeKind: round === 28 ? 'boss' : 'normal' };
  }
  if (difficulty === 'ABYSS' && round === 30) return { difficulty, battleRound: 15, waveRound: 15, waveDifficulty: difficulty, nodeKind: 'hidden' };
  if (difficulty === 'ABYSS' && round === 29) return { difficulty, battleRound: 13, waveRound: 13, waveDifficulty: difficulty, nodeKind: 'elite' };
  const waveRound = round >= 28 ? 14 : Math.min(13, Math.ceil(round / 2));
  return { difficulty, battleRound: waveRound, waveRound, waveDifficulty: difficulty, nodeKind: waveRound === 14 ? 'boss' : 'normal' };
}

function prepare(state, data, catalog) {
  const node = battleNode(state);
  const modeId = modeIdFor('solo', node.difficulty);
  const waveModeId = modeIdFor('solo', node.waveDifficulty);
  const gd = new GameData(data, waveModeId);
  const worldRng = createRng(deriveSeed(Number(state.seed) >>> 0, `resonance:world:${modeId}`));
  const setup = setupMatchWaves(gd, worldRng);
  const rng = createRng(deriveSeed(Number(state.seed) >>> 0, `resonance:wave:${node.waveRound}:${modeId}`));
  const isHiddenRound = node.nodeKind === 'hidden';
  const isBossRound = node.nodeKind === 'boss' || isHiddenRound;
  const field = isBossRound ? 'bossL' : 'normal';
  const bossId = isHiddenRound ? setup.hiddenBossId : isBossRound ? setup.bossId : null;
  const nativeWave = isBossRound
    ? buildBossWave(gd, rng, setup, node.waveRound, { bossId, solo: true })
    : buildNormalWave(gd, rng, setup, node.waveRound);
  const enemyBalance=resolveEnemyBalance(catalog?.campaign?.enemyBalance,node.difficulty,node.nodeKind);
  const wave=scaleWaveSpawnMods(nativeWave,enemyBalance);
  const tuning=Object.values(enemyBalance).every(value=>value===1)?'native-wave':'resonance';
  const stageId = setup.stageId ?? wave.templateId ?? null;
  const stage = gd.stage(stageId);
  if (!stage) throw new Error(`resonance wave ${node.waveRound} has no resolvable stage (stageId=${stageId ?? 'null'})`);
  if (!wave.templateId) throw new Error(`resonance wave ${node.waveRound} has no upstream wave template`);
  if (isBossRound && (!bossId || !gd.boss(bossId))) throw new Error(`resonance ${node.nodeKind} wave has no upstream leader`);
  return { ...node, modeId, waveModeId, gd, setup, wave, stageId, stage, bossId, field, enemyBalance, tuning };
}

/** The authoritative source stage and deploy legality for the current resonance node. */
export function getResonanceField(state, { data = null, catalog = null } = {}) {
  const source = sourceData(data);
  catalog = catalogFor(state, source, catalog);
  const fieldState = state?.difficulty === 'FUNNY' && Number(state.round) % 2 === 1
    ? { ...state, round: Number(state.round) + 1 }
    : state;
  const prepared = prepare(fieldState, source, catalog);
  return {
    stageId: prepared.stageId,
    stage: prepared.stage,
    wave: prepared.wave,
    field: prepared.field,
    deployMap: buildDeployMap(prepared.stage, { field: prepared.field }),
    bossId: prepared.setup.bossId ?? null,
    hiddenBossId: prepared.setup.hiddenBossId ?? null,
    factions: [...(prepared.setup.factions || [])],
    battleRound: prepared.battleRound,
    waveRound: prepared.waveRound,
    nodeKind: prepared.nodeKind,
    enemyBalance: prepared.enemyBalance,
    tuning: prepared.tuning,
    timeLimit: effectiveTimeLimit(prepared, catalog),
    resolveToken:(tokenId,operatorId,skillIndex)=>toDataSource(source).getToken(tokenId,operatorId,{skillIndex,moduleId:'none'}),
  };
}

function selectedRecord(state, piece, data, catalog) {
  const operator = catalog.operators?.[piece.operatorId];
  if (!operator || operator.sourceChessId !== piece.operatorId) throw new Error(`UNKNOWN_RESONANCE_OPERATOR:${piece.operatorId}`);
  const star = Number(piece.star);
  if (![1, 2, 3].includes(star)) throw new Error(`BAD_RESONANCE_STAR:${piece.uid}`);
  const starRecord = operator.stars?.[star]?.record;
  if (!starRecord || typeof starRecord !== 'object') throw new Error(`MISSING_RESONANCE_STAR_RECORD:${piece.operatorId}:${star}`);
  const normal = operator.source?.normalChess ?? data.chess?.[piece.operatorId];
  if (!normal || typeof normal !== 'object') throw new Error(`MISSING_RESONANCE_NATIVE_CHESS:${piece.operatorId}`);
  return { operator, raw: { ...normal, ...starRecord, chessId: piece.operatorId, id: piece.operatorId } };
}

function battleInputUnits(state, data, catalog, prepared, starData) {
  const deployed = (Array.isArray(state.pieces) ? state.pieces : []).filter((piece) => piece && piece.row != null && piece.col != null);
  const units = deployed.map((piece) => {
    const { operator } = selectedRecord(state, piece, data, catalog);
    const skillIndex = Number.isInteger(operator.fixedSkillIndex) ? operator.fixedSkillIndex : 0;
    const star = Number(piece.star);
    return { uid: piece.uid, chessId: starChessId(piece.operatorId, star), operatorId: piece.operatorId, star,
      items: (piece.equipment ?? []).map((item) => item?.itemId).filter(Boolean),
      growth: structuredClone(piece.growth ?? {}), summonOrders: structuredClone(piece.summonOrders ?? []), extraPacts: structuredClone(piece.extraPacts ?? []),
      row: Number(piece.row), col: Number(piece.col), dir: piece.dir ?? 'RIGHT', skillIndex, moduleId: 'none' };
  });
  const deployMap = buildDeployMap(prepared.stage, { field: prepared.field });
  const occupied = new Set(deployed.map((piece) => `${Number(piece.row)},${Number(piece.col)}`));
  const summonAnchors = [];
  const summonAnchorGaps = [];
  for (const piece of deployed) {
    const { operator, raw } = selectedRecord(state, piece, data, catalog);
    const skillIndex = Number.isInteger(operator.fixedSkillIndex) ? operator.fixedSkillIndex : 0;
    const tokens = starData.summonTokensByUid.get(piece.uid) ?? [];
    for (const { tokenId } of tokens) {
      // A token source can list the forms of multiple skills. The fixed skill's explicit token is the initial form.
      if (raw.skill?.overrideTokenKey && tokenId!==raw.skill.overrideTokenKey) continue;
      const token = data.tokens?.[tokenId];
      if (!token) {
        summonAnchorGaps.push({ ownerUid: piece.uid, tokenId, reason: 'native-token-record-missing' });
        continue;
      }
      if (token?.placeable !== true) continue;
      const own = Array.isArray(token.owners) && token.owners.includes(piece.operatorId);
      if (Array.isArray(token.owners) && token.owners.length && !own) continue;
      const rangeGrid = Array.isArray(raw.rangeGrid) ? raw.rangeGrid : [];
      const range = ownerRangeKeys(rangeGrid, Number(piece.row), Number(piece.col), piece.dir ?? 'RIGHT');
      const pos = positionClass(token);
      const candidates = [...range].map((key) => key.split(',').map(Number))
        .filter(([row, col]) => !occupied.has(`${row},${col}`) && canPlace(deployMap, pos, row, col))
        .sort(([ar, ac], [br, bc]) => {
          const a = localOrder(ar - Number(piece.row), ac - Number(piece.col), piece.dir ?? 'RIGHT');
          const b = localOrder(br - Number(piece.row), bc - Number(piece.col), piece.dir ?? 'RIGHT');
          return b[1] - a[1] || a[0] - b[0];
        });
      const explicit = (piece.summonOrders ?? []).find((order) => order?.tokenId === tokenId);
      const requested = explicit ? candidates.find(([row,col]) => row === explicit.row && col === explicit.col) : null;
      if (explicit && !requested) {
        summonAnchorGaps.push({ ownerUid: piece.uid, tokenId, reason: 'explicit-summon-order-not-legal-in-native-owner-range' });
        continue;
      }
      const tile = requested ?? candidates[0];
      if (!tile) {
        summonAnchorGaps.push({ ownerUid: piece.uid, tokenId, reason: 'no-free-legal-tile-in-native-owner-range' });
        continue;
      }
      const uid = `resonance-summon-${String(piece.uid)}-${tokenId}`;
      units.push({ uid, kind: 'token', tokenId, ownerUid: piece.uid, row: tile[0], col: tile[1], dir: piece.dir ?? 'RIGHT' });
      occupied.add(`${tile[0]},${tile[1]}`);
      summonAnchors.push({ ownerUid: piece.uid, tokenId, row: tile[0], col: tile[1], startDeploy: SKILL_SUMMON_START_DEPLOY });
    }
  }
  return { units, summonAnchors, summonAnchorGaps };
}

function withStarRecords(state, data, catalog) {
  const chess = { ...(data.chess || {}) };
  const tokens = { ...(data.tokens || {}) };
  const tokenVariants = new Map();
  const summonTokensByUid = new Map();
  const summonVariantGaps = [];
  const source = toDataSource(data);
  for (const piece of (Array.isArray(state.pieces) ? state.pieces : [])) {
    if (!piece || piece.row == null || piece.col == null) continue;
    const { operator, raw } = selectedRecord(state, piece, data, catalog);
    const star = Number(piece.star);
    const variantId = starChessId(piece.operatorId, star);
    chess[variantId] = {
      ...raw,
      id: piece.operatorId,
      chessId: variantId,
      baseId: piece.operatorId,
      baseChessId: piece.operatorId,
      isGolden: false,
      resonanceOperatorId: piece.operatorId,
      resonanceStar: star,
    };
    const skillIndex = Number.isInteger(operator.fixedSkillIndex) ? operator.fixedSkillIndex : 0;
    const ids = [...new Set((raw.tokens ?? []).map((token) => typeof token === 'string' ? token : token?.tokenId).filter(Boolean))];
    const candidates = [];
    for (const tokenId of ids) {
      const nativeToken = data.tokens?.[tokenId];
      if (nativeToken?.placeable !== true) continue;
      const tokenDef = source.getToken(tokenId, piece.operatorId, { skillIndex, moduleId: 'none' });
      if (!tokenDef || !tokenDef.sources?.includes('skill')) continue;
      const ownerVariant = tokenDef.raw?.variants
        ? tokenDef.raw.variants[piece.operatorId]
        : tokenDef.raw;
      if (!ownerVariant) {
        summonVariantGaps.push({ ownerUid: piece.uid, tokenId, operatorId: piece.operatorId, reason: 'native-owner-token-variant-missing' });
        continue;
      }
      const sourceToken = tokenVariants.has(tokenId) ? tokenVariants.get(tokenId) : structuredClone(nativeToken);
      const variants = { ...(sourceToken.variants || {}) };
      const normalStats = operator.source?.normalChess?.stats ?? data.chess?.[piece.operatorId]?.stats ?? {};
      const ownerStar1Stats = operator.stars?.[1]?.record?.stats ?? normalStats;
      const ownerStarStats = operator.stars?.[star]?.record?.stats ?? ownerStar1Stats;
      const nativeStats = ownerVariant.stats ?? nativeToken.stats ?? {};
      const hpRatio = Number(normalStats.maxHp) > 0 ? Number(ownerStarStats.maxHp) / Number(normalStats.maxHp) : 1;
      const atkRatio = Number(normalStats.atk) > 0 ? Number(ownerStarStats.atk) / Number(normalStats.atk) : 1;
      variants[variantId] = {
        ...ownerVariant,
        stats: {
          ...nativeStats,
          maxHp: Math.round((Number(nativeStats.maxHp) || 0) * hpRatio),
          atk: Math.round((Number(nativeStats.atk) || 0) * atkRatio),
        },
      };
      sourceToken.variants = variants;
      tokenVariants.set(tokenId, sourceToken);
      candidates.push({ tokenId, variantId });
    }
    summonTokensByUid.set(piece.uid, candidates);
  }
  for (const [tokenId, token] of tokenVariants) tokens[tokenId] = token;
  return { data: { ...data, chess, tokens }, summonTokensByUid, summonVariantGaps };
}

/** Build the original simulator battle with star-resolved source records and resonance-only extra content. */
export function buildResonanceBattle(state, { data = null, catalog = null, recording = false, preview = false } = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('resonance battle requires a state object');
  const source = sourceData(data);
  catalog = catalogFor(state, source, catalog);
  const input = structuredClone(state);
  const prepared = prepare(input, source, catalog);
  const starData = withStarRecords(input, source, catalog);
  const inputUnitData = battleInputUnits(input, source, catalog, prepared, starData);
  const units = inputUnitData.units;
  const battleData = starData.data;
  const sharedBoss = preview || !['boss', 'hidden'].includes(prepared.nodeKind)
    ? null
    : new SharedBossPool(Math.max(1,Math.round(bossPoolHp(prepared.gd, prepared.bossId, 1)*prepared.enemyBalance.bossPoolMultiplier)));
  const resonanceKits = createResonanceKits(catalog, input, battleData);
  const battle = new Battle({
    seed: deriveSeed(Number(input.seed) >>> 0, `resonance:${preview ? 'preview' : 'battle'}:${prepared.battleRound}:${prepared.modeId}`),
    kind: preview ? 'normal' : prepared.nodeKind === 'hidden' ? 'hidden' : prepared.nodeKind === 'boss' ? 'boss' : 'normal',
    modeId: prepared.modeId,
    round: prepared.battleRound,
    stage: prepared.stage,
    timeLimit: preview ? 60 : effectiveTimeLimit(prepared, catalog),
    players: [{ playerId: PLAYER_ID, seat: 0, side: 'L', colOffset: 0, units, bonds: {} }],
    spawns: preview ? [] : prepared.wave.spawns,
    routes: [...(prepared.wave.routes || []), ...(prepared.wave.extraRoutes || [])],
    enemyOverrides: prepared.wave.overrides,
    sharedBoss,
    flags: {
      layerGainsEnabled: false,
      dpInit: 20,
      dpPerSec: 1,
      dpMax: 99,
      resonance: { catalog, state: input, round: input.round, battleRound: prepared.battleRound, environmentId: input.environmentId ?? null },
    },
    fieldId: `resonance-r${input.round}`,
    data: battleData,
    content: 'independent',
    recordEvents: recording && !preview,
    logger: noopLogger,
    kits: { ...KITS, ...resonanceKits },
    extraContent: [b => {
      for (const [name, module] of MODULES) {
        if (!['tokens', 'devices', 'enemies', 'bosses'].includes(name)) continue;
        if (typeof module?.install !== 'function') throw new Error(`MISSING_NATIVE_CONTENT_INSTALLER:${name}`);
        module.install(b);
      }
    }, b => {
      b.resonanceOutcome={won:false};
      b.on('battleEnd',({result})=>{b.resonanceOutcome.won=resonanceBattleWon(result,prepared.nodeKind);},{owner:b,priority:1000});
      installResonanceBattle(b, { catalog, state: input });
    }],
  });
  battle.resonanceSummonAnchors = inputUnitData.summonAnchors;
  battle.resonanceEnemyBalance = prepared.enemyBalance;
  battle.resonanceSummonAnchorGaps = [...inputUnitData.summonAnchorGaps, ...starData.summonVariantGaps];
  return { battle, prepared };
}

function replayStats(battle, lastStats) {
  const stats = {};
  for (const unit of battle.units) {
    if (!unit || (unit.kind !== 'op' && unit.side !== 'enemy') || !unit.alive) continue;
    const entry = unitStatsEntry(unit, unit.s);
    const key = JSON.stringify(entry);
    if (lastStats.get(unit.id) !== key) { lastStats.set(unit.id, key); stats[unit.id] = entry; }
  }
  return Object.keys(stats).length ? stats : null;
}

function leakLoss(playerResult, cap) {
  const leaked = Array.isArray(playerResult?.leaked) ? playerResult.leaked : [];
  const points = leaked.filter((entry) => entry && entry.counted !== false)
    .reduce((sum, entry) => sum + Math.max(0, Number.isFinite(Number(entry.lpr)) ? Number(entry.lpr) : 1), 0);
  return Math.min(cap, Math.max(0, points));
}

function aggregateMetrics(battle, result, playerResult) {
  const unitStats = Array.isArray(playerResult?.unitStats) ? playerResult.unitStats : [];
  const base = {
    damage: unitStats.reduce((sum, unit) => sum + (Number(unit.dmg) || 0), 0),
    healing: unitStats.reduce((sum, unit) => sum + (Number(unit.heal) || 0), 0),
    attacks: unitStats.reduce((sum, unit) => sum + (Number(unit.attacks) || 0), 0),
    kills: unitStats.reduce((sum, unit) => sum + (Number(unit.kills) || 0), 0),
    deaths: Number(playerResult?.deaths) || 0,
    leaked: Array.isArray(playerResult?.leaked) ? playerResult.leaked.filter((x) => x && x.counted !== false).length : 0,
    totalEnemies: Number(result?.total) || 0,
    defeatedEnemies: Number(result?.killed) || 0,
  };
  const resonance = battle.resonanceMetrics && typeof battle.resonanceMetrics === 'object' ? structuredClone(battle.resonanceMetrics) : {};
  return { ...base, ...resonance };
}

/** Run one authoritative upstream Battle. Unrecorded runs never construct frames, samples, or snapshots. */
export function runResonanceBattle(state, { data = null, catalog = null, recording = false } = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('resonance battle requires a state object');
  recording = recording === true;
  const source = sourceData(data);
  catalog = catalogFor(state, source, catalog);
  const input = structuredClone(state);
  const { battle, prepared } = buildResonanceBattle(input, { data: source, catalog, recording });
  const frames = recording ? [] : null;
  const lastStats = recording ? new Map() : null;
  let field = null;
  while (!battle.finished && battle.tickCount < MAX_TICKS) {
    battle.step();
    finishResonanceTerminalIfEscaped(battle, prepared.nodeKind);
    if (recording) {
      if (!field) field = battle.fieldMeta();
      if (battle.tickCount % REPLAY_SNAP_EVERY === 0) {
        const frame = { snap: battle.snapshot(), ev: battle.drainEvents() };
        if (battle.tickCount % REPLAY_STATS_EVERY === REPLAY_SNAP_EVERY) {
          const stats = replayStats(battle, lastStats);
          if (stats) frame.stats = stats;
        }
        frames.push(frame);
      }
    }
  }
  const capped = !battle.finished;
  if (capped) battle.forceEnd('timeout');
  if (recording) {
    const tail = { snap: battle.snapshot(), ev: battle.drainEvents() };
    const lastFrame = frames.at(-1);
    if (!lastFrame || tail.snap.t > lastFrame.snap.t) frames.push(tail);
    else lastFrame.ev.push(...tail.ev);
  }
  const result = battle.result();
  const playerResult = result.perPlayer?.[PLAYER_ID] ?? Object.values(result.perPlayer || {})[0] ?? {};
  const hpLoss = leakLoss(playerResult, prepared.gd.lpCapPerRound);
  const won = resonanceBattleWon(result,prepared.nodeKind,{capped});
  const diagnostics = {
    modeId: prepared.modeId,
    waveModeId: prepared.waveModeId,
    round: input.round,
    battleRound: prepared.battleRound,
    waveRound: prepared.waveRound,
    nodeKind: prepared.nodeKind,
    stageId: prepared.stageId,
    templateId: prepared.wave.templateId,
    bossId: prepared.bossId,
    ticks: battle.tickCount,
    tickLimit: MAX_TICKS,
    capped,
    tuning: prepared.tuning,
    enemyBalance: structuredClone(prepared.enemyBalance),
    summonAnchors: structuredClone(battle.resonanceSummonAnchors ?? []),
    summonAnchorGaps: structuredClone(battle.resonanceSummonAnchorGaps ?? []),
    errorCount: battle.errorCount,
    errors: battle.errors.slice(0, 20),
  };
  if (battle.errorCount) throw Object.assign(new Error(`resonance Battle recorded ${battle.errorCount} simulation/content error(s)`), { diagnostics, result });
  const replay = recording ? {
    version: 1,
    kind: prepared.nodeKind === 'elite' ? 'normal' : prepared.nodeKind,
    nodeKind: prepared.nodeKind,
    fieldKind: prepared.field,
    stageId: prepared.stageId,
    modeId: prepared.modeId,
    round: input.round,
    battleRound: prepared.battleRound,
    bossId: prepared.bossId ?? null,
    tick: TICK,
    snapEvery: REPLAY_SNAP_EVERY,
    duration: Math.round(battle.time * 100) / 100,
    field,
    frames,
  } : null;
  return {
    won,
    hpLoss,
    result,
    growth: structuredClone(battle.resonanceResults?.growth ?? []),
    coins: structuredClone(battle.resonanceResults?.coins ?? []),
    forge: structuredClone(battle.resonanceResults?.forge ?? []),
    replay,
    diagnostics,
    metrics: aggregateMetrics(battle, result, playerResult),
    summonAnchors: structuredClone(battle.resonanceSummonAnchors ?? []),
    summonAnchorGaps: structuredClone(battle.resonanceSummonAnchorGaps ?? []),
  };
}

/** Starting stats after the star record, native Kit and resonance installs are applied; no enemy wave is simulated. */
export function previewUnitStats(state, { data = null, catalog = null } = {}) {
  const source = sourceData(data);
  catalog ??= getResonanceCatalog(source);
  const input = structuredClone(state);
  if(input.difficulty==='FUNNY'&&Number(input.round)%2===1)input.round=Number(input.round)+1;
  const { battle } = buildResonanceBattle(input, { data: source, catalog, preview: true, recording: false });
  battle.start();
  const out = {};
  for (const unit of battle.allyUnits) if (unit && typeof unit.uid === 'string' && unit.kind === 'op') out[unit.uid] = unitStatsEntry(unit, unit.s);
  if (battle.errorCount) throw new Error(`resonance preview recorded ${battle.errorCount} simulator/content errors`);
  return out;
}
