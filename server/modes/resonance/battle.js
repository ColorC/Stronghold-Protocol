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
import { orderCopy, summonLimit } from './summons.js';
import { finishResonanceTerminalIfEscaped as finishNativeTerminalIfEscaped, installResonanceBattle } from '../../sim/content/resonance/battle.js';
import { createResonanceKits } from '../../sim/content/resonance/kits.js';
import { installPrototypeBattleContent } from '../../sim/content/resonance/prototype-installer.js';

const PLAYER_ID = 'resonance';
const REPLAY_SNAP_EVERY = 3;
const REPLAY_STATS_EVERY = Math.round(1 / TICK);
const MAX_TICKS = Math.ceil(MAX_BATTLE_TIME / TICK) + 1;
const noopLogger = Object.freeze({ warn() {}, error() {}, info() {}, log() {} });
const starChessId = (operatorId, star) => `resonance_${operatorId}_star${star}`;
const ENEMY_BALANCE_FIELDS=Object.freeze({hpMultiplier:'hpMul',atkMultiplier:'atkMul',defMultiplier:'defMul',resMultiplier:'resMul',speedMultiplier:'speedMul',bossPoolMultiplier:null});
const ENEMY_BALANCE_ONE=Object.freeze({hpMultiplier:1,atkMultiplier:1,defMultiplier:1,resMultiplier:1,speedMultiplier:1,bossPoolMultiplier:1});
const DIFFICULTIES=new Set(['FUNNY','NORMAL','HARD','ABYSS']);
// the multipliers every enemy of a node takes, wave or summoned: balance field, base stat, spawn mod, and the mod that records the factor already applied
const NODE_ENEMY_SCALES=Object.freeze([
  {field:'hpMultiplier',stat:'maxHp',modKey:'hpMul',appliedKey:'resonanceHpMul'},
  {field:'atkMultiplier',stat:'atk',modKey:'atkMul',appliedKey:'resonanceAtkMul'},
  {field:'defMultiplier',stat:'def',modKey:'defMul',appliedKey:'resonanceDefMul'},
]);

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

const NODE_CURVE_FIELDS=Object.freeze(['hpMultiplier','atkMultiplier']);
const round4=value=>Math.round(value*1e4)/1e4;

function validateNodeCurve(nodeCurve){
  if(typeof nodeCurve!=='object'||nodeCurve===null||Array.isArray(nodeCurve))throw new TypeError('invalid resonance campaign.enemyBalance.nodeCurve');
  for(const [difficulty,points] of Object.entries(nodeCurve)){
    if(!DIFFICULTIES.has(difficulty))throw new TypeError(`invalid resonance enemy node curve difficulty: ${difficulty}`);
    if(!Array.isArray(points)||!points.length)throw new TypeError(`resonance enemy node curve needs points: ${difficulty}`);
    let previous=0;
    for(const point of points){
      if(typeof point!=='object'||point===null)throw new TypeError(`invalid resonance enemy node curve point: ${difficulty}`);
      for(const key of Object.keys(point))if(key!=='node'&&!NODE_CURVE_FIELDS.includes(key))throw new TypeError(`unknown resonance enemy node curve field: ${difficulty}.${key}`);
      if(!Number.isInteger(point.node)||point.node<=previous)throw new TypeError(`resonance enemy node curve nodes must be increasing integers >= 1: ${difficulty}`);
      for(const key of NODE_CURVE_FIELDS)if(!Number.isFinite(point[key])||point[key]<=0)throw new TypeError(`resonance enemy node curve must be finite and > 0: ${difficulty}.${point.node}.${key}`);
      previous=point.node;
    }
  }
}

/** HP and ATK factors one difficulty's curve gives at a campaign node: linear between points, flat beyond the ends. */
export function enemyNodeCurveFactor(points,node){
  const out={hpMultiplier:1,atkMultiplier:1};
  if(!Array.isArray(points)||!points.length||!Number.isFinite(node))return out;
  const upper=points.findIndex(point=>point.node>=node);
  for(const key of NODE_CURVE_FIELDS){
    if(upper===0)out[key]=points[0][key];
    else if(upper<0)out[key]=points.at(-1)[key];
    else{const a=points[upper-1],b=points[upper];out[key]=round4(a[key]+(b[key]-a[key])*(node-a.node)/(b.node-a.node));}
  }
  return out;
}

/**
 * Resolve authored campaign.enemyBalance for one node; missing fields preserve native multiplier 1. With a campaign
 * node, a regular or elite node also takes its difficulty's nodeCurve factor on HP and ATK; leader nodes do not.
 */
export function resolveEnemyBalance(enemyBalance,difficulty,nodeKind,node=null){
  if(enemyBalance==null)return {...ENEMY_BALANCE_ONE};
  if(typeof enemyBalance!=='object'||Array.isArray(enemyBalance))throw new TypeError('invalid resonance campaign.enemyBalance');
  for(const key of Object.keys(enemyBalance))if(!['regular','terminal','byDifficulty','nodeCurve','source','difficultyMultiplier','nodeScaling'].includes(key))throw new TypeError(`unknown resonance enemy balance section: ${key}`);
  if(enemyBalance.nodeCurve!=null)validateNodeCurve(enemyBalance.nodeCurve);
  if(enemyBalance.source!=null&&enemyBalance.source!=='native-wave')throw new TypeError('unsupported legacy resonance enemy balance source');
  if(enemyBalance.difficultyMultiplier!=null&&enemyBalance.difficultyMultiplier!==1)throw new TypeError('unsupported legacy resonance enemy difficulty multiplier');
  if(enemyBalance.nodeScaling!=null&&enemyBalance.nodeScaling!=='native-stage')throw new TypeError('unsupported legacy resonance enemy node scaling');
  const regular=mergeBalanceProfile(ENEMY_BALANCE_ONE,enemyBalance.regular,'regular');
  const terminal=mergeBalanceProfile(ENEMY_BALANCE_ONE,enemyBalance.terminal,'terminal');
  const scope=nodeKind==='boss'||nodeKind==='hidden'?'terminal':'regular',base=scope==='terminal'?terminal:regular;
  let profile=base;
  if(enemyBalance.byDifficulty!=null){
    if(typeof enemyBalance.byDifficulty!=='object'||Array.isArray(enemyBalance.byDifficulty))throw new TypeError('invalid resonance campaign.enemyBalance.byDifficulty');
    for(const [key,override] of Object.entries(enemyBalance.byDifficulty)){
      if(!DIFFICULTIES.has(key))throw new TypeError(`invalid resonance enemy balance difficulty: ${key}`);
      if(typeof override!=='object'||override===null||Array.isArray(override))throw new TypeError(`invalid resonance enemy balance byDifficulty.${key}`);
      for(const name of Object.keys(override))if(!['regular','terminal'].includes(name))throw new TypeError(`unknown resonance enemy balance scope: byDifficulty.${key}.${name}`);
      mergeBalanceProfile(regular,override.regular,`byDifficulty.${key}.regular`);
      mergeBalanceProfile(terminal,override.terminal,`byDifficulty.${key}.terminal`);
    }
    profile=mergeBalanceProfile(base,enemyBalance.byDifficulty[difficulty]?.[scope],`byDifficulty.${difficulty}.${scope}`);
  }
  const points=enemyBalance.nodeCurve?.[difficulty];
  if(scope!=='regular'||!points||node==null)return profile;
  const factor=enemyNodeCurveFactor(points,Number(node));
  for(const key of NODE_CURVE_FIELDS)profile[key]=round4(profile[key]*factor[key]);
  return profile;
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
    // the factors already in these mods; enemies spawned with mods that lack them take them on spawn
    for(const {field,appliedKey} of NODE_ENEMY_SCALES)if(multipliers[field]!==1)mods[appliedKey]=multipliers[field];
    return {...spawn,mods:Object.keys(mods).length?mods:undefined};
  });
  return {...wave,spawns};
}

/**
 * The node's HP, ATK and DEF multipliers reach every enemy, not only the scheduled wave: an enemy spawned in the fight
 * (summons, 不祥幻影, parts) takes the factors its mods lack, and passes them on through its mods to what it spawns, so a
 * chain of summons is scaled once, not once per link. A leader on the shared pool keeps the pool's HP. The flat DEF an
 * enemy gains from its own auras and states (方阵 +200 per neighbour, 禁锢 +300) is scaled like its base DEF
 * (Unit.defFlatScale). DEF reductions from operators keep their full value.
 */
function installEnemyBalance(battle,enemyBalance){
  const scales=NODE_ENEMY_SCALES.filter(({field})=>{const factor=Number(enemyBalance?.[field]);return factor>0&&factor!==1;});
  if(!scales.length)return;
  battle.on('enemySpawn',({enemy})=>{
    if(enemy?.side!=='enemy')return;
    const mods={...(enemy.mods??{})},fullHp=enemy.hp>=enemy.s.maxHp-1e-9;
    for(const {field,stat,modKey,appliedKey} of scales){
      const factor=Number(enemyBalance[field]);
      const applied=Number(mods[appliedKey])>0?Number(mods[appliedKey]):1;
      if(applied===factor)continue;
      const missing=factor/applied;
      if(!(stat==='maxHp'&&enemy.bossPool))enemy.base[stat]*=missing;
      mods[modKey]=(mods[modKey]??1)*missing;
      mods[appliedKey]=factor;
    }
    enemy.mods=mods;
    if(enemyBalance.defMultiplier>0)enemy.defFlatScale=Number(enemyBalance.defMultiplier);
    enemy.markDirty();
    if(fullHp&&!enemy.bossPool)enemy.hp=enemy.s.maxHp;
  },{owner:battle,priority:1000});
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
    rulesVersion: state?.rulesVersion ?? 1,
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
  return finishNativeTerminalIfEscaped(battle, nodeKind);
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
  const enemyBalance=resolveEnemyBalance(catalog?.campaign?.enemyBalance,node.difficulty,node.nodeKind,Number(state.round));
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
    resolveToken:(tokenId,operatorId,skillIndex)=>{
      const token=toDataSource(source).getToken(tokenId,operatorId,{skillIndex,moduleId:'none'});
      if(!token)return null;
      const raw=token.raw??{};
      return {...token,
        placeable:token.placeable??raw.placeable??false,
        ownerRange:token.ownerRange??raw.ownerRange??false,
        position:token.position??raw.position??'MELEE',
      };
    },
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
  for (const placement of placeSpecialEntities(state, deployMap, occupied, catalog)) {
    const descriptor = catalog.specialEntities?.[placement.entity.entityId];
    const tokenId = specialEntityBattleTokenId(placement.entity);
    const sourceToken = data.tokens?.[descriptor?.nativeTokenId] ?? {};
    const def = {
      ...sourceToken, id: tokenId, name: descriptor?.name ?? '训练假人',
      spine: descriptor?.nativeTokenId ?? sourceToken.spine ?? tokenId,
      avatar: descriptor?.nativeTokenId ?? sourceToken.avatar ?? tokenId,
      position: 'MELEE', rangeGrid: [[0, 0]],
      skill: null, skills: [], talents: [], tokens: [],
      stats: { maxHp: Number(descriptor?.maxHp ?? 550), atk: 0, def: Number(descriptor?.def ?? 30),
        res: Number(descriptor?.res ?? 30), aspd: 0, bat: 0, blockCnt: Number(descriptor?.blockCount ?? 1),
        cost: 0, spRecovery: 0 },
      description: '固定目标；不能移动或攻击。',
    };
    units.push({ uid: placement.entity.uid, kind: 'token', tokenId, def, row: placement.row, col: placement.col, dir: 'RIGHT', abs: false });
  }
  const reservedExplicit = new Map();
  for (const piece of deployed) for (const order of (piece.summonOrders ?? [])) {
    if (!order || !Number.isInteger(order.row) || !Number.isInteger(order.col) || typeof order.tokenId !== 'string') continue;
    const key = `${order.row},${order.col}`;
    const entries = reservedExplicit.get(key) ?? [];
    entries.push({ ownerUid: piece.uid, tokenId: order.tokenId });
    reservedExplicit.set(key, entries);
  }
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
      // the free legal tiles for a copy of this summon, nearest to where the owner's range wants it first (re-read per copy: placed ones take tiles)
      const freeTiles = () => [...deployMap.keys()].map((key) => key.split(',').map(Number))
        .filter(([row, col]) => {
          const key = `${row},${col}`;
          if (occupied.has(key) || !canPlace(deployMap, pos, row, col) || (token.ownerRange === true && !range.has(key))) return false;
          const reservations = reservedExplicit.get(key) ?? [];
          return reservations.every((entry) => entry.ownerUid === piece.uid && entry.tokenId === tokenId);
        })
        .sort(([ar, ac], [br, bc]) => {
          if (token.ownerRange !== true) {
            const aInRange = range.has(`${ar},${ac}`);
            const bInRange = range.has(`${br},${bc}`);
            if (aInRange !== bInRange) return aInRange ? -1 : 1;
          }
          const a = localOrder(ar - Number(piece.row), ac - Number(piece.col), piece.dir ?? 'RIGHT');
          const b = localOrder(br - Number(piece.row), bc - Number(piece.col), piece.dir ?? 'RIGHT');
          return b[1] - a[1] || a[0] - b[0];
        });
      const place = (tile, copy, dir) => {
        // the first copy keeps its historical id; further copies (凯瑟琳's second device, …) take the copy number
        const uid = `resonance-summon-${String(piece.uid)}-${tokenId}${copy ? `-${copy}` : ''}`;
        units.push({ uid, kind: 'token', tokenId, ownerUid: piece.uid, row: tile[0], col: tile[1], dir: dir ?? piece.dir ?? 'RIGHT' });
        occupied.add(`${tile[0]},${tile[1]}`);
        summonAnchors.push({ ownerUid: piece.uid, tokenId, row: tile[0], col: tile[1], startDeploy: SKILL_SUMMON_START_DEPLOY });
      };
      // the player's placements, one summon per placed copy (up to the token's deploy limit)
      const explicit = (piece.summonOrders ?? []).filter((order) => order?.tokenId === tokenId && Number.isInteger(order.row) && Number.isInteger(order.col))
        .sort((a, b) => orderCopy(a) - orderCopy(b)).slice(0, summonLimit(token));
      if (explicit.length) {
        for (const order of explicit) {
          const requested = freeTiles().find(([row, col]) => row === order.row && col === order.col);
          if (!requested) {
            summonAnchorGaps.push({ ownerUid: piece.uid, tokenId, reason: token.ownerRange === true
              ? 'explicit-summon-order-not-legal-in-native-owner-range' : 'explicit-summon-order-not-legal-on-field' });
            continue;
          }
          place(requested, orderCopy(order), order.dir);
        }
        continue;
      }
      // nothing placed: one summon on the first free legal tile
      const tile = freeTiles()[0];
      if (!tile) {
        summonAnchorGaps.push({ ownerUid: piece.uid, tokenId, reason: token.ownerRange === true
          ? 'no-free-legal-tile-in-native-owner-range' : 'no-free-legal-tile-on-field' });
        continue;
      }
      place(tile, 0, null);
    }
  }
  return { units, summonAnchors, summonAnchorGaps };
}

export function specialEntityBattleTokenId(entity) { return `resonance_special_${String(entity?.uid ?? 'entity')}`; }

/** Project only explicitly saved, legal special-entity tiles; never auto-place or change persisted positions. */
export function placeSpecialEntities(state, deployMap, occupied = new Set(), catalog = null) {
  const placed = [];
  for (const entity of state?.specialEntities ?? []) {
    const descriptor = catalog?.specialEntities?.[entity.entityId];
    if (!descriptor || descriptor.kind !== 'training_dummy') continue;
    if (!Number.isInteger(entity.row) || !Number.isInteger(entity.col)) continue;
    const key=`${entity.row},${entity.col}`;
    if (!(deployMap instanceof Map) || !deployMap.has(key) || occupied.has(key)) continue;
    occupied.add(key);
    placed.push({ entity, row: entity.row, col: entity.col });
  }
  return placed;
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
      if (!tokenDef || !['skill', 'talent'].some((sourceName) => tokenDef.sources?.includes(sourceName))) continue;
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
    waveId: prepared.wave.templateId,
    bossId: prepared.bossId,
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
      resonance: { catalog, state: input, round: input.round, battleRound: prepared.battleRound,
        nodeKind: prepared.nodeKind, environmentId: input.rulesVersion===2?null:input.environmentId ?? null },
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
      installEnemyBalance(b,prepared.enemyBalance);
      b.resonanceOutcome={won:false};
      b.on('battleEnd',({result})=>{b.resonanceOutcome.won=resonanceBattleWon(result,prepared.nodeKind);},{owner:b,priority:1000});
      installResonanceBattle(b, { catalog, state: input });
      installPrototypeBattleContent(b,input,catalog);
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

/** Convert an already completed native BattleResult into the session settlement contract without running a Battle. */
export function nativeResultForSession(state, result, { data = null, catalog = null, prepared: preparedInput = null, uidMap = null } = {}) {
  if (!result || typeof result !== 'object') throw new TypeError('native BattleResult required');
  const source = sourceData(data);
  catalog = catalogFor(state, source, catalog);
  const prepared = preparedInput ?? buildResonanceBattle(state, { data: source, catalog }).prepared;
  const playerResult = result.perPlayer?.[PLAYER_ID] ?? Object.values(result.perPlayer || {})[0] ?? {};
  const units = Array.isArray(playerResult.unitStats) ? playerResult.unitStats : [];
  const survivors = Array.isArray(playerResult.unitsEnd) ? playerResult.unitsEnd.map((unit) => {
    const pieceUid = uidMap?.session(unit.uid) ?? unit.uid;
    const piece = state.pieces?.find((entry) => String(entry.uid) === String(pieceUid));
    const sourceId=String(unit.defId??'').replace(/^resonance_/,'').replace(/_star[23]$/,'');
    const operator=catalog.operators?.[piece?.operatorId]??Object.values(catalog.operators??{}).find((entry)=>entry.sourceChessId===sourceId||entry.id===sourceId);
    return { uid: pieceUid, pieceUid, operatorId:piece?.operatorId??operator?.id??null, charId: operator?.charId ?? null,
      defId: unit.defId, star:piece?.star??unit.resonanceStar, alive: unit.alive === true,
      ...(Number.isFinite(unit.hpPct) ? { hpPct: unit.hpPct } : {}) };
  }).filter((unit) => unit.charId) : [];
  const mode = result.resonance && typeof result.resonance === 'object' ? result.resonance : {};
  const growth = Array.isArray(mode.growth) ? mode.growth.map((entry) => ({ ...entry,
    pieceUid: uidMap?.session(entry.pieceUid) ?? entry.pieceUid })) : [];
  const combatStats = combatStatsOf(playerResult);
  if(combatStats&&uidMap){
    for(const unit of combatStats.units){
      const pieceUid=uidMap.session(unit.uid);
      unit.uid=pieceUid;
      const piece=state.pieces?.find((entry)=>entry.uid===pieceUid);
      const operator=piece&&catalog.operators?.[piece.operatorId];
      if(operator){unit.charId=operator.charId;unit.star=piece.star;unit.defId=operator.sourceChessId??unit.defId;}
    }
  }
  return {
    won: resonanceBattleWon(result, prepared.nodeKind),
    hpLoss: leakLoss(playerResult, prepared.gd.lpCapPerRound),
    result,
    growth, coins: Array.isArray(mode.coins) ? structuredClone(mode.coins) : [],
    contributions: Array.isArray(mode.contributions) ? structuredClone(mode.contributions) : [],
    survivors,
    battleRound: state.round,
    uidMap: uidMap?.snapshot() ?? null,
    forge: Array.isArray(mode.forge) ? structuredClone(mode.forge) : [], replay: null,
    combatStats,
    diagnostics: { errorCount: Number(result.errors) || 0, nodeKind: prepared.nodeKind },
    metrics: {
      damage: units.reduce((sum, unit) => sum + (Number(unit.dmg) || 0), 0),
      healing: units.reduce((sum, unit) => sum + (Number(unit.heal) || 0), 0),
      attacks: units.reduce((sum, unit) => sum + (Number(unit.attacks) || 0), 0),
      kills: units.reduce((sum, unit) => sum + (Number(unit.kills) || 0), 0),
      deaths: Number(playerResult.deaths) || 0,
      leaked: (playerResult.leaked || []).filter((entry) => entry && entry.counted !== false).length,
      totalEnemies: Number(result.total) || 0,
      defeatedEnemies: Number(result.killed) || 0,
      ...(mode.metrics && typeof mode.metrics === 'object' ? structuredClone(mode.metrics) : {}),
    },
    summonAnchors: [], summonAnchorGaps: [],
  };
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

export function combatStatsOf(playerResult) {
  if (!Array.isArray(playerResult?.unitStats)) return null;
  const metric = (value) => Number.isFinite(value) ? value : null;
  const bossDamage = metric(playerResult.bossDamage);
  return { ...(bossDamage === null ? {} : { bossDamage }), units: playerResult.unitStats.map((unit) => ({
    uid: unit?.uid ?? null,
    defId: unit?.defId ?? null,
    kind: unit?.kind ?? null,
    dmg: metric(unit?.dmg),
    heal: metric(unit?.heal),
    taken: metric(unit?.taken),
    kills: metric(unit?.kills),
    attacks: metric(unit?.attacks),
  })) };
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
  const combatStats = combatStatsOf(playerResult);
  const hpLoss = leakLoss(playerResult, prepared.gd.lpCapPerRound);
  const won = resonanceBattleWon(result,prepared.nodeKind,{capped});
  const survivors = battle.allyUnits.filter((unit) => unit?.kind === 'op' && unit.alive && !unit.removed).map((unit) => {
    const piece = input.pieces.find((entry) => String(entry.uid) === String(unit.uid));
    const operator=catalog.operators?.[piece?.operatorId];
    return { uid: unit.uid, pieceUid:unit.uid, operatorId:piece?.operatorId??null, charId: operator?.charId ?? null,
      defId: unit.defId, star:piece?.star, alive: true, hpPct: Number.isFinite(unit.hpRatio) ? unit.hpRatio : undefined };
  }).filter((unit) => unit.charId);
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
    robertaMachines: structuredClone(battle.resonanceResults?.robertaMachines ?? []),
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
    combatStats,
  } : null;
  return {
    won,
    hpLoss,
    result,
    growth: structuredClone(battle.resonanceResults?.growth ?? []),
    coins: structuredClone(battle.resonanceResults?.coins ?? []),
    forge: structuredClone(battle.resonanceResults?.forge ?? []),
    replay,
    combatStats,
    contributions: structuredClone(battle.resonanceContributions ?? []),
    survivors,
    battleRound: input.round,
    diagnostics,
    metrics: aggregateMetrics(battle, result, playerResult),
    summonAnchors: structuredClone(battle.resonanceSummonAnchors ?? []),
    summonAnchorGaps: structuredClone(battle.resonanceSummonAnchorGaps ?? []),
  };
}

/** Starting stats after the star record, native Kit and resonance installs are applied; no enemy wave is simulated. */
export function previewUnitStats(state, { data = null, catalog = null } = {}) {
  const source = sourceData(data);
  catalog = catalogFor(state, source, catalog);
  const input = structuredClone(state);
  if(input.difficulty==='FUNNY'&&Number(input.round)%2===1)input.round=Number(input.round)+1;
  const { battle } = buildResonanceBattle(input, { data: source, catalog, preview: true, recording: false });
  battle.start();
  const out = {};
  for (const unit of battle.allyUnits) if (unit && typeof unit.uid === 'string' && unit.kind === 'op') out[unit.uid] = unitStatsEntry(unit, unit.s);
  if (battle.errorCount) throw new Error(`resonance preview recorded ${battle.errorCount} simulator/content errors`);
  return out;
}
