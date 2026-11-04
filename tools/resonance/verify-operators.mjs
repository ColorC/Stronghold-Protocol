import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { getResonanceField, buildResonanceBattle } from '../../server/modes/resonance/battle.js';
import { ownerRangeKeys, canPlace, positionClass } from '../../server/match/board.js';
import { localOrder } from '../../server/sim/dir.js';
import { toDataSource } from '../../server/sim/simdata.js';

export const CANONICAL_DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';
const DEFAULT_ENVIRONMENT = 'origin_laterano';
const SIMULATION_SECONDS = 60;
const DEFAULT_DATA_DIR = process.env.SP_DATA_DIR || CANONICAL_DATA_DIR;

function emptyState(operator, star, seed, round = 2) {
  return {
    schemaVersion: 1, seed, revision: 0, round, roundLimit: 28, difficulty: 'NORMAL',
    environmentId: DEFAULT_ENVIRONMENT, phase: 'prep', level: 3, xp: 0, gold: 5, hp: 100,
    winStreak: 0, lossStreak: 0, shop: { offers: [], locked: false }, inventory: [],
    strategies: [], strategyState: {}, poolRemaining: {}, nextUid: 2, history: [], pacts: [],
    pieces: [{ uid: 'coverage-operator', operatorId: operator.id, star, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' }],
  };
}

function selectedSkillInfo(unit, operator, starRecord) {
  const expectedSkillId = operator.fixedSkillId;
  const actualSkillId = unit.def?.skill?.id ?? unit.def?.skill?.skillId ?? null;
  const actualIndex = unit.def?.loadout?.skillIndex ?? null;
  return {
    expectedSkillId, actualSkillId, expectedSkillIndex: operator.fixedSkillIndex,
    actualSkillIndex: actualIndex ?? 0, blackboardMatches: JSON.stringify(unit.def?.skill?.bb ?? {}) === JSON.stringify(starRecord.skill?.bb ?? {}),
  };
}

function checkTokenOwnership(data, source, operator, starRecord, skillIndex) {
  const declared = starRecord.skill?.tokens ?? [];
  const ids = [...new Set(declared.map((entry) => typeof entry === 'string' ? entry : entry?.tokenId).filter(Boolean))];
  const issues = [];
  const verified = [];
  for (const tokenId of ids) {
    const native = data.tokens?.[tokenId];
    const token = source.getToken(tokenId, operator.id, { skillIndex, moduleId: 'none' });
    const ownerListed = !Array.isArray(native?.owners) || native.owners.length === 0 || native.owners.includes(operator.id);
    if (!native) issues.push({ tokenId, reason: 'native-token-record-missing' });
    else if (!ownerListed) issues.push({ tokenId, reason: 'native-owner-list-excludes-operator' });
    else if (!token) issues.push({ tokenId, reason: 'native-loadout-resolver-returned-null' });
    else if (!token.sources?.includes('skill')) issues.push({ tokenId, reason: `resolver-sources:${(token.sources ?? []).join(',') || 'none'}` });
    else verified.push(tokenId);
  }
  return { declared: ids, verified, issues };
}

function deployTileFor(field, operator, data, source) {
  const rangeGrid = operator.source?.normalChess?.rangeGrid ?? [];
  const record = operator.stars?.[1]?.record;
  const skillTokens = record?.tokens ?? record?.skill?.tokens ?? [];
  const tokenIds = [...new Set(skillTokens.map((entry) => typeof entry === 'string' ? entry : entry?.tokenId).filter(Boolean))];
  const candidates = [...field.deployMap].filter(([, tileClass]) => operator.position !== 'MELEE' || tileClass === 'melee');
  const score = ([key]) => {
    const [row, col] = key.split(',').map(Number);
    const range = ownerRangeKeys(rangeGrid, row, col, 'RIGHT');
    const occupied = new Set([key]);
    let count = 0;
    for (const tokenId of tokenIds) {
      const token = data.tokens?.[tokenId];
      const tokenSource = source.getToken(tokenId, operator.id, { skillIndex: operator.fixedSkillIndex, moduleId: 'none' });
      if (!token || token.placeable !== true || !tokenSource?.sources?.includes('skill')) continue;
      const cls = positionClass(token);
      const legal = [...range].map((tileKey) => ({ key: tileKey, rc: tileKey.split(',').map(Number) }))
        .filter(({ key: tileKey, rc: [r,c] }) => !occupied.has(tileKey) && canPlace(field.deployMap, cls, r, c))
        .sort(({ rc: [ar,ac] }, { rc: [br,bc] }) => {
          const a = localOrder(ar - row, ac - col, 'RIGHT');
          const b = localOrder(br - row, bc - col, 'RIGHT');
          return b[1] - a[1] || a[0] - b[0];
        });
      if (legal[0]) { occupied.add(legal[0].key); count++; }
    }
    return count;
  };
  return candidates.sort((a, b) => score(b) - score(a) || a[0].localeCompare(b[0]))[0] ?? null;
}

function variantChecks({ data, source, catalog, field, operator, star, seed }) {
  const errors = [];
  const gaps = [];
  const starSpec = operator.stars[star];
  const record = starSpec?.record;
  const variant = { operatorId: operator.id, charId: operator.charId, name: operator.name, star };
  if ((!record?.skill && !starSpec?.passive?.kind) || !operator.fixedSkillId) return { variant, errors: [{ ...variant, reason: 'fixed-skill-record-missing' }], gaps, details: null };
  const deploy = deployTileFor(field, operator, data, source);
  if (!deploy) return { variant, errors: [{ ...variant, reason: `no-source-deploy-tile:${operator.position}` }], gaps, details: null };
  const state = emptyState(operator, star, seed);
  [state.pieces[0].row, state.pieces[0].col] = deploy[0].split(',').map(Number);
  let battle;
  try { battle = buildResonanceBattle(state, { data, catalog, recording: false }).battle; }
  catch (error) { return { variant, errors: [{ ...variant, reason: 'construct-threw', detail: error.message }], gaps, details: null }; }
  let skillStartCount = 0;
  battle.on('skillStart', ({ unit: owner }) => { if (owner?.uid === state.pieces[0].uid) skillStartCount++; });
  try { battle.start(); }
  catch (error) { errors.push({ ...variant, reason: 'start-threw', detail: error.message }); }
  const unit = battle.allyUnits.find((entry) => entry.uid === state.pieces[0].uid);
  if (!unit) return { variant, errors: [...errors, { ...variant, reason: 'unit-not-created' }], gaps, details: null };
  const skill = unit.skill;
  const skillInfo = selectedSkillInfo(unit, operator, record);
  if (unit.defId !== `resonance_${operator.id}_star${star}`) errors.push({ ...variant, reason: 'wrong-star-variant-id', actual: unit.defId });
  const runtimeSkillId = skill?.id ?? null;
  const signatureSkill = operator.fixedSkillId.startsWith('resonance_');
  if ((signatureSkill ? runtimeSkillId !== operator.fixedSkillId : skillInfo.actualSkillId !== operator.fixedSkillId)
    || (!signatureSkill && skillInfo.actualSkillIndex !== operator.fixedSkillIndex)
    || (record.skill && !skillInfo.blackboardMatches)) {
    errors.push({ ...variant, reason: 'selected-skill-loadout-mismatch', ...skillInfo });
  }
  for (const stat of ['maxHp', 'atk', 'def', 'res', 'aspd', 'bat', 'blockCnt']) {
    const expected = Number(record.stats?.[stat]);
    const actual = Number(unit.base?.[stat]);
    if (Number.isFinite(expected) && expected !== actual) errors.push({ ...variant, reason: 'star-stat-mismatch', stat, expected, actual });
  }
  const nativeCost = Number(record.stats?.cost), resolvedCost = Number(unit.def?.stats?.cost);
  if (Number.isFinite(nativeCost) && nativeCost !== resolvedCost) errors.push({ ...variant, reason: 'source-deploy-cost-mismatch', expected: nativeCost, actual: resolvedCost, runtimeCost: unit.base?.cost });
  const originalTalents = operator.source?.normalChess?.talents ?? [];
  if (JSON.stringify(unit.def?.raw?.talents ?? []) !== JSON.stringify(record.talents ?? [])) {
    errors.push({ ...variant, reason: 'native-talent-record-not-preserved' });
  }
  if (JSON.stringify(record.talents ?? []) !== JSON.stringify(originalTalents)) {
    errors.push({ ...variant, reason: 'configured-record-overwrites-native-talents' });
  }
  const sourceKind = operator.source?.skillSpecSource ?? 'unknown';
  const explicitResonance = signatureSkill && runtimeSkillId === operator.fixedSkillId;
  const skillSource = explicitResonance ? 'resonance-explicit' : (unit.kit?.skillSource ?? (sourceKind === 'kit' ? 'kit' : sourceKind === 'skills' ? 'skills' : sourceKind));
  const pickedTags = new Set([...(unit.kit?.tags ?? []), ...(skill?.tags ?? [])].map((tag) => typeof tag === 'string' ? tag : tag?.id));
  const pickedExplicit = pickedTags.has('resonance') || pickedTags.has('signature');
  const skillResolved = signatureSkill ? runtimeSkillId === operator.fixedSkillId : skillInfo.actualSkillId === operator.fixedSkillId;
  if (!skillResolved || !explicitResonance && !pickedExplicit && !['kit','skills'].includes(skillSource) && skill?.kind !== 'passive') {
    gaps.push({ ...variant, reason: `runtime-skill-spec-gap:${skillSource}`, fixedSkillId: operator.fixedSkillId,
      sourceSkillSource: sourceKind, runtimeSkillSource: unit.kit?.skillSource ?? null, pickedTags: [...pickedTags] });
  }
  const spType = skill?.spType ?? 'none';
  const initialActivations = Number(skill?.activations ?? 0);
  const initialSkillStarts = skillStartCount;
  const initialSp = Number(skill?.spTotal ?? 0);
  const activeAtStart = !!skill?.active;
  if (operator.name === '正义骑士号') unit.hp = Math.max(1, unit.s.maxHp * 0.5);
  while (!battle.finished && battle.time < SIMULATION_SECONDS) battle.step();
  const naturalActivations = Number(skill?.activations ?? 0) - initialActivations;
  const natural = { type: spType, initialSp, finalSp: Number(skill?.spTotal ?? 0), activations: naturalActivations,
    skillStarts: skillStartCount - initialSkillStarts, seconds: Math.min(SIMULATION_SECONDS, battle.time),
    result: naturalActivations > 0 ? 'natural-cast' : 'no-natural-cast-in-source-wave' };
  const startsAtBattle = Number(skill?.activations ?? 0) > 0;
  let forcedReachable = naturalActivations > 0 || (activeAtStart && initialSkillStarts > 0) || (skill?.kind === 'passive' && activeAtStart);
  let forcedReason = forcedReachable ? (naturalActivations ? 'natural-cast-in-real-battle' : activeAtStart ? 'native-deploy-activation' : 'active-native-passive') : 'not-tested';
  if (!forcedReachable && skill && !skill.noSkill && skill.kind !== 'passive') {
    let forceBattle = battle, forceUnit = unit, forceSkill = skill, forcedStarts = 0;
    if (!unit.alive || !unit.deployed) {
      forceBattle = buildResonanceBattle(state, { data, catalog, recording: false }).battle;
      forceBattle.on('skillStart', ({ unit: owner }) => { if (owner?.uid === state.pieces[0].uid) forcedStarts++; });
      forceBattle.start();
      forceUnit = forceBattle.allyUnits.find((entry) => entry.uid === state.pieces[0].uid);
      forceSkill = forceUnit?.skill;
    } else {
      forceBattle.on('skillStart', ({ unit: owner }) => { if (owner?.uid === state.pieces[0].uid) forcedStarts++; });
    }
    if (forceSkill?.spCost > 0) forceSkill.setSpTotal(forceSkill.spCost * forceSkill.maxCharges);
    const beforeForced = Number(forceSkill?.activations ?? 0);
    const activated = forceSkill?.activate('coverage-forced', { free: true }) === true;
    forcedReachable = activated && Number(forceSkill?.activations ?? 0) > beforeForced && forcedStarts > 0;
    forcedReason = forcedReachable ? 'forced-real-skill-runtime-cast-and-skillStart' : 'native-skill-activation-produced-no-skillStart';
  }
  if (!forcedReachable) errors.push({ ...variant, reason: 'fixed-skill-not-reachable', forcedReason, skillKind: skill?.kind ?? 'missing' });
  if (operator.name === '正义骑士号' && !(unit.stats?.heal > 0)) errors.push({ ...variant, reason: 'signature-passive-produced-no-healing', heal: unit.stats?.heal ?? 0 });
  if (battle.errorCount) errors.push({ ...variant, reason: 'battle-diagnostics', errorCount: battle.errorCount, errors: battle.errors.slice(0, 5).map((entry) => ({ label: entry.label, who: entry.who, message: entry.message, stack: String(entry.stack ?? '').split('\n').slice(0, 5).join('\n') })) });
  const tokenOwnership = checkTokenOwnership(data, source, operator, record, operator.fixedSkillIndex);
  for (const issue of tokenOwnership.issues) errors.push({ ...variant, reason: 'token-source-or-ownership-gap', ...issue });
  for (const gap of battle.resonanceSummonAnchorGaps ?? []) gaps.push({ ...variant, reason: 'summon-anchor-gap', tokenId: gap.tokenId, detail: gap.reason });
  return { variant, errors, gaps, details: { skillSource, spType, naturalSp: natural, naturalSkillStarts: natural.skillStarts,
    forcedReachable, forcedReason, signatureSkill,
    activationsAfterProbe: skill?.activations ?? 0, starStats: { maxHp: unit.base.maxHp, atk: unit.base.atk, def: unit.base.def, res: unit.base.res },
    talentCount: unit.def?.raw?.talents?.length ?? 0, tokenOwnership } };
}

export function verifyOperators({ dataDirectory = DEFAULT_DATA_DIR, environmentId = DEFAULT_ENVIRONMENT, seed = 0x5245534f } = {}) {
  const data = loadData(path.resolve(dataDirectory), { log: { warn() {}, error() {} } });
  const catalog = getResonanceCatalog(data, { environmentId, seed });
  const fieldState = emptyState({ id: catalog.config.starterIds[0] }, 1, seed);
  const field = getResonanceField(fieldState, { data, catalog });
  const source = toDataSource(data);
  const variants = [];
  const errors = [];
  const gaps = [];
  let index = 0;
  for (const operator of Object.values(catalog.operators)) {
    for (const star of [1, 2, 3]) {
      const result = variantChecks({ data, source, catalog, field, operator, star, seed: (seed + index++) >>> 0 });
      variants.push(result);
      errors.push(...result.errors);
      gaps.push(...result.gaps);
      if (index % 24 === 0 && globalThis.gc) globalThis.gc();
    }
  }
  const summary = { operators: Object.keys(catalog.operators).length, variants: variants.length,
    passed: variants.filter((variant) => variant.errors.length === 0 && variant.gaps.length === 0).length,
    engineDiagnostics: errors.filter((error) => error.reason === 'battle-diagnostics').length,
    nativeSkillSource: Object.fromEntries(['kit','skills','generic','none'].map((name) => [name, Object.values(catalog.operators).filter((op) => op.source.skillSpecSource === name).length])),
    errors: errors.length, documentedGaps: gaps.length, naturalCasts: variants.filter((item) => item.details?.naturalSp?.activations > 0).length,
    naturalSp: Object.fromEntries(['time','attack','hurt','none'].map((type) => [type, variants.filter((item) => item.details?.spType === type).length])),
    forcedReachable: variants.filter((item) => item.details?.forcedReachable).length };
  return { summary, errors, gaps, variants };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = verifyOperators();
  console.log(JSON.stringify({ ...result.summary, errors: result.errors, documentedGaps: result.gaps }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
