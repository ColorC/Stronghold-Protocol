#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { getResonanceField, resolveEnemyBalance, runResonanceBattle } from '../../server/modes/resonance/battle.js';
import { createSession, validateSession } from '../../server/modes/resonance/session.js';
import { ownerRangeKeys } from '../../server/match/board.js';
import { resolveProfile } from '../../server/sim/professions.js';
import { buildScenario, pactProfile, SCENARIO_CONFIGS } from './archetype-balance.mjs';
import { canBlockGround, canOperatorUseTile } from './balance-campaign.mjs';

const DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';
const REPORT_PATH = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/archetype-balance.json';
const WORKTREE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/resonance/stronghold-protocol';
const ENVIRONMENTS = ['origin_aegir', 'origin_laterano', 'origin_kjerag', 'origin_yan'];
const COPIES_BY_STAR = { 1: 1, 2: 3, 3: 9 };
const TERMINAL_CFG = Object.freeze({ ...SCENARIO_CONFIGS.at(-1), round: 28, level: 10, phase: 'terminal', transferLimit: 0 });
export function resolveMidTierTerminalProfile(enemyBalance) {
  return resolveEnemyBalance(enemyBalance, 'NORMAL', 'boss');
}

function identityPact(catalog, environmentId) {
  return catalog.environments[environmentId]?.identityPactId || null;
}
function stablePower(op, star) {
  return Number(op.stars?.[star]?.stats?.atk ?? 0) * 100 + Number(op.stars?.[star]?.stats?.hp ?? 0);
}
function hasBlockCell(op, field) {
  return [...field.deployMap].some(([key]) => {
    const [row, col] = key.split(',').map(Number);
    return canOperatorUseTile(op, field.deployMap, row, col) && canBlockGround(field, row, col);
  });
}
function isNativeAirAttacker(op) {
  if (op.position !== 'RANGED') return false;
  const profile = resolveProfile(op.source.normalChess);
  return profile.attack === 'ranged' && profile.canHitFly === true && !profile.groundOnly;
}
export function makeRoster(catalog, field, mainPact, targetTier, core, coreStar, coreHasTransfer = false) {
  const active = new Set(catalog.config.activeOperatorIds);
  const operators = Object.values(catalog.operators).filter(op => active.has(op.id));
  const chosen = [];
  const chosenIds = new Set();
  const usedChars = new Set();
  const isMain = op => (op.pacts?.includes(mainPact) ?? false) || (coreHasTransfer && op.id === core.id);
  const countMain = () => new Set(chosen.filter(isMain).map(op => op.charId)).size;
  const add = op => {
    if (!op || chosenIds.has(op.id) || usedChars.has(op.charId)) return false;
    if (isMain(op) && countMain() >= targetTier) return false;
    chosen.push(op); chosenIds.add(op.id); usedChars.add(op.charId); return true;
  };
  add(core);

  const frontlines = operators.filter(op => op.role === 'frontline' && hasBlockCell(op, field))
    .sort((a, b) => Number(isMain(b)) - Number(isMain(a)) || stablePower(b, 2) - stablePower(a, 2) || a.id.localeCompare(b.id));
  for (const op of frontlines) if (chosen.filter(x => x.role === 'frontline').length < 2) add(op);
  if (chosen.filter(op => op.role === 'frontline').length !== 2) throw new Error(`two-blocker-coverage-unavailable:${mainPact}`);

  const healers = operators.filter(op => op.role === 'healer')
    .sort((a, b) => Number(isMain(b)) - Number(isMain(a)) || stablePower(b, 2) - stablePower(a, 2) || a.id.localeCompare(b.id));
  const healer = healers.find(add);
  if (!healer) throw new Error(`healer-unavailable:${mainPact}`);

  const airCandidates = operators.filter(op => isNativeAirAttacker(op) && op.role !== 'healer')
    .sort((a, b) => Number(isMain(b)) - Number(isMain(a)) || Number(b.role === 'damage') - Number(a.role === 'damage') || stablePower(b, 2) - stablePower(a, 2) || a.id.localeCompare(b.id));
  while (chosen.filter(isNativeAirAttacker).length < 2) {
    const op = airCandidates.find(candidate => !chosenIds.has(candidate.id) && !usedChars.has(candidate.charId) && (!isMain(candidate) || countMain() < targetTier));
    if (!op || !add(op)) throw new Error(`two-native-antiair-unavailable:${mainPact}`);
  }

  const mainCandidates = operators.filter(isMain).sort((a, b) => Number(a.role === 'frontline') - Number(b.role === 'frontline') || Number(a.role === 'healer') - Number(b.role === 'healer') || stablePower(b, 2) - stablePower(a, 2) || a.id.localeCompare(b.id));
  for (const op of mainCandidates) {
    if (countMain() >= targetTier) break;
    add(op);
  }
  if (countMain() !== targetTier) throw new Error(`mid-tier-pact-unavailable:${mainPact}:${countMain()}/${targetTier}`);

  const fillers = operators.filter(op => !chosenIds.has(op.id) && !usedChars.has(op.charId))
    .sort((a, b) => Number(isMain(b)) - Number(isMain(a)) || Number(b.role === 'damage') - Number(a.role === 'damage') || stablePower(b, 2) - stablePower(a, 2) || a.id.localeCompare(b.id));
  for (const op of fillers) {
    if (chosen.length >= 9) break;
    if (op.role === 'frontline' && chosen.filter(x => x.role === 'frontline').length >= 2) continue;
    if (op.role === 'healer' && chosen.filter(x => x.role === 'healer').length >= 2) continue;
    add(op);
  }
  if (chosen.length !== 9) throw new Error(`nine-person-roster-unavailable:${chosen.length}`);
  if (countMain() >= (catalog.pacts[mainPact]?.thresholds?.at(-1) ?? Infinity)) throw new Error(`not-mid-tier:${mainPact}`);
  return chosen.map(op => ({ operatorId: op.id, name: op.name, role: op.role, star: op.id === core.id ? coreStar : 2,
    equipment: [], extraPacts: [], growth: {} }));
}
function findCatalogAndCore(data, environmentId, kind) {
  for (let seed = 1; seed <= 256; seed++) {
    const catalog = getResonanceCatalog(data, { environmentId, seed });
    const mainPact = identityPact(catalog, environmentId);
    const active = new Set(catalog.config.activeOperatorIds);
    const allCandidates = Object.values(catalog.operators).filter(op => active.has(op.id)
      && (kind === 'four-cost' ? op.cost === 4 && ['damage', 'control'].includes(op.role) : op.cost <= 3 && op.role === 'damage'));
    const nativeCandidates = allCandidates.filter(op => op.pacts?.includes(mainPact));
    const transferId = `transfer_${mainPact}`;
    const transfer = catalog.equipment[transferId];
    const transferable = transfer?.effects?.some(effect => ['transfer_pact', 'pact_transfer'].includes(effect.kind) && effect.params?.pactId === mainPact);
    const candidates = kind === 'four-cost' && !nativeCandidates.length && transferable ? allCandidates : nativeCandidates;
    if (candidates.length) {
      candidates.sort((a, b) => kind === 'four-cost'
        ? Number(b.role === 'damage') - Number(a.role === 'damage') || stablePower(b, 2) - stablePower(a, 2) || a.id.localeCompare(b.id)
        : b.cost - a.cost || stablePower(b, 3) - stablePower(a, 3) || a.id.localeCompare(b.id));
      return { catalog, catalogSeed: seed, mainPact, core: candidates[0], coreHasTransfer: kind === 'four-cost' && !nativeCandidates.length,
        coreIdentityPath: kind === 'four-cost' && !nativeCandidates.length ? 'cross-pact-with-native-transfer' : 'native-main-identity' };
    }
  }
  const catalog = getResonanceCatalog(data, { environmentId, seed: 1 });
  return { catalog, catalogSeed: 1, mainPact: identityPact(catalog, environmentId), core: null, coreHasTransfer: false, coreIdentityPath: null };
}
function coreGear(catalog, core, mainPact, coreHasTransfer) {
  const profile = resolveProfile(core.source.normalChess);
  const completed = profile.dmgType === 'arts'
    ? ['giantSlayer', 'resonanceStaff', 'spellblade']
    : ['giantSlayer', 'resonanceStaff', 'rapidBlade'];
  const ids = coreHasTransfer ? [`transfer_${mainPact}`, ...completed.slice(0, 2)] : completed;
  for (const id of completed.slice(0, coreHasTransfer ? 2 : 3)) if (!catalog.equipment[id] || catalog.equipment[id].kind !== 'completed') throw new Error(`core-gear-unavailable:${id}`);
  if (coreHasTransfer && catalog.equipment[`transfer_${mainPact}`]?.kind !== 'emblem') throw new Error(`identity-transfer-unavailable:${mainPact}`);
  return ids;
}
function reconcilePool(state, initialState) {
  const copies = state.poolRemaining;
  for (const piece of initialState.pieces) copies[piece.operatorId] += COPIES_BY_STAR[piece.star];
  for (const piece of state.pieces) {
    copies[piece.operatorId] -= COPIES_BY_STAR[piece.star];
    if (copies[piece.operatorId] < 0) throw new Error(`fixed-roster-pool-empty:${piece.operatorId}`);
  }
}
function mainProfile(state, catalog, mainPact) {
  const profile = pactProfile(state.pieces, catalog)[mainPact] || { uniqueOperators: 0, thresholds: catalog.pacts[mainPact].thresholds, activeTier: 0 };
  return { ...profile, maxTier: catalog.pacts[mainPact].thresholds.at(-1) };
}
function partyRouteCoverage(state, catalog, routes, bossRouteIndices) {
  const byRoute = routes.map((route, index) => ({ index, originalIndices: route.originalIndices, motion: route.motion, source: route.source,
    coveredBy: state.pieces.filter(piece => {
      const op = catalog.operators[piece.operatorId];
      const grid = op.stars[piece.star].record.rangeGrid?.length ? op.stars[piece.star].record.rangeGrid : op.source?.normalChess?.rangeGrid ?? [[0, 0]];
      const keys = ownerRangeKeys(grid, piece.row, piece.col, piece.dir);
      return route.points.some(([row, col]) => keys.has(`${row},${col}`));
    }).map(piece => catalog.operators[piece.operatorId].name) }));
  return { routes: byRoute, bossRouteIndices, uncoveredRouteIndices: byRoute.filter(route => route.coveredBy.length === 0).map(route => route.index),
    bossRoutesCovered: bossRouteIndices.every(index => byRoute[index]?.coveredBy.length > 0) };
}
function runCase({ data, environmentId, kind, sourceCodeRevision }) {
  const { catalog, catalogSeed, mainPact, core, coreHasTransfer, coreIdentityPath } = findCatalogAndCore(data, environmentId, kind);
  const thresholds = catalog.pacts[mainPact]?.thresholds ?? [];
  const targetTier = thresholds.at(-2);
  const resolvedTerminalProfile = resolveMidTierTerminalProfile(catalog.campaign.enemyBalance);
  const fixed = { environmentId, kind, catalogSeed, mainPact, coreIdentityPath, coreHasTransfer,
    core: core ? { id: core.id, name: core.name, cost: core.cost, role: core.role, star: kind === 'four-cost' ? 2 : 3 } : null,
    targetMidTier: targetTier ?? null, maxTier: thresholds.at(-1) ?? null, enemyProfile: resolvedTerminalProfile,
    sourceCodeRevision, dataSourceCommit: catalog.source?.commit ?? null, status: 'no-eligible' };
  if (!core) { fixed.reason = kind === 'four-cost'
    ? 'no eligible active 4-cost damage/control core or matching native transfer item in seeds 1–256'
    : 'no eligible active low-cost main-identity damage core in seeds 1–256'; return fixed; }
  if (!Number.isInteger(targetTier) || targetTier >= thresholds.at(-1)) { fixed.reason = 'main identity has no configurable tier below its maximum'; return fixed; }
  const seed = 0x4d494454 + ENVIRONMENTS.indexOf(environmentId) * 29 + (kind === 'four-cost' ? 1 : 2);
  try {
    const created = createSession({ seed, difficulty: 'NORMAL', catalog, environmentId });
    if (!created.ok) throw new Error(`create-session:${created.error}`);
    const initialState = structuredClone(created.state);
    const stateSeed = created.state;
    stateSeed.seed = seed; stateSeed.round = 28; stateSeed.level = 10; stateSeed.phase = 'prep'; stateSeed.gold = 0; stateSeed.xp = 0;
    const field = getResonanceField(stateSeed, { data, catalog });
    const roster = makeRoster(catalog, field, mainPact, targetTier, core, fixed.core.star, coreHasTransfer);
    const definition = { id: `mid-tier-terminal-${environmentId}-${kind}`, env: environmentId, core: core.name, include: [], pact: mainPact };
    const cfg = { ...TERMINAL_CFG, gearIds: coreGear(catalog, core, mainPact, coreHasTransfer) };
    const built = buildScenario({ data, catalog, definition, config: cfg, coreStar: fixed.core.star, seed, rosterOverride: roster });
    reconcilePool(built.state, initialState);
    built.state.pieces[0].equipment.forEach((item, index) => { item.uid = `fixed-gear-${index}-${item.itemId}`; });
    const validation = validateSession(built.state, { catalog });
    if (!validation.ok) throw new Error(`validate-session:${validation.errors.map(error => `${error.code}${error.detail ? `:${JSON.stringify(error.detail)}` : ''}`).join(',')}`);
    const active = new Set(catalog.config.activeOperatorIds);
    if (built.state.pieces.some(piece => !active.has(piece.operatorId))) throw new Error('pool-membership-check-failed');
    const pact = mainProfile(built.state, catalog, mainPact);
    if (pact.activeTier !== targetTier || pact.activeTier >= pact.maxTier) throw new Error(`pact-tier-check:${pact.activeTier}/${targetTier}/${pact.maxTier}`);
    const frontliners = built.state.pieces.filter(piece => catalog.operators[piece.operatorId].role === 'frontline');
    const actualBlockers = frontliners.filter(piece => canBlockGround(field, piece.row, piece.col));
    if (frontliners.length < 2 || actualBlockers.length < 2) throw new Error(`actual-ground-blockers:${actualBlockers.length}/2`);
    const air = built.state.pieces.filter(piece => isNativeAirAttacker(catalog.operators[piece.operatorId]));
    if (air.length < 2) throw new Error(`native-antiair-count:${air.length}/2`);
    const routeCoverage = partyRouteCoverage(built.state, catalog, built.equipment.routeCoverage.routes, built.equipment.routeCoverage.bossRouteIndices);
    if (!built.equipment.routeCoverage.core.coversBossRoute || routeCoverage.uncoveredRouteIndices.length || !routeCoverage.bossRoutesCovered)
      throw new Error('route-or-boss-coverage-incomplete');
    const run = runResonanceBattle(built.state, { data, catalog, recording: false });
    const player = Object.values(run.result?.perPlayer ?? {})[0] ?? {};
    const units = player.unitStats ?? [];
    const coreStats = units.find(unit => unit.uid === built.state.pieces[0].uid);
    const party = built.state.pieces.map(piece => ({ operatorId: piece.operatorId, name: catalog.operators[piece.operatorId].name,
      role: catalog.operators[piece.operatorId].role, star: piece.star,
      pacts: [...new Set([...(catalog.operators[piece.operatorId].pacts ?? []), ...piece.equipment.flatMap(item => (catalog.equipment[item.itemId]?.effects ?? [])
        .filter(effect => ['transfer_pact', 'pact_transfer'].includes(effect.kind)).map(effect => effect.params?.pactId).filter(Boolean))])],
      position: [piece.row, piece.col], direction: piece.dir, equipment: piece.equipment.map(item => item.itemId) }));
    const profile = run.diagnostics?.enemyBalance ?? resolvedTerminalProfile;
    return { ...fixed, status: 'completed', seed, round: built.state.round, level: built.state.level, phase: cfg.phase,
      fixture: 'fixed terminal battle lineup; no shop-economy claim', partySize: party.length, party, pactProfile: pact,
      roleCoverage: { groundBlockers: actualBlockers.length, healer: party.filter(piece => piece.role === 'healer').map(piece => piece.name),
        nativeAntiAir: air.map(piece => catalog.operators[piece.operatorId].name) },
      routeCoverage: { core: built.equipment.routeCoverage.core, blockers: built.equipment.routeCoverage.groundFrontlines, party: routeCoverage },
      equipmentCount: built.equipment.gearCount, resolvedTerminalProfile: profile, enemyBalanceUsed: profile,
      stageId: field.stageId, waveSpawnCount: field.wave?.spawns?.length ?? 0, durationSeconds: run.result?.time ?? null,
      won: run.won, hpLoss: run.hpLoss, leakCount: (player.leaked ?? []).filter(leak => leak.counted !== false).length,
      leaked: (player.leaked ?? []).filter(leak => leak.counted !== false).reduce((sum, leak) => sum + (Number(leak.lpr) || 0), 0),
      bossHpLeft: run.result?.bossHpLeft ?? null, teamDamage: run.metrics?.damage ?? null, bossDamage: player.bossDamage ?? null,
      coreDamage: coreStats?.dmg ?? 0, coreAttacks: coreStats?.attacks ?? 0, diagnostics: run.diagnostics?.errorCount ?? 0,
      validationErrors: [], illegalDeployments: [], summonAnchorGaps: run.summonAnchorGaps ?? [], recording: false };
  } catch (error) {
    return { ...fixed, status: 'fixture-error', error: error.message };
  }
}
function atomicUpdate(reportPath, patch) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const next = { ...report, ...patch };
  const temporary = `${reportPath}.pending-${process.pid}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, reportPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  return next;
}
export function classifyPreviousMidTierAttempt(attempt) {
  const committed = attempt?.helperWorkingTreeState === 'committed-or-clean-at-current-codeRevision';
  const completeEightCaseRun = attempt?.cases === 8 && attempt?.summary?.battles === 8;
  const formalEightBattleRun = committed && completeEightCaseRun;
  return { attemptStatus: formalEightBattleRun ? 'committed-eight-case-superseded-by-this-validation' : 'preliminary-uncommitted-run-superseded-by-this-validation', formalEightBattleRun };
}
export function runMidTierTerminalDesignValidation({ dataDir = DATA_DIR, reportPath = REPORT_PATH } = {}) {
  const data = loadData(dataDir, { log: { warn() {}, error() {}, info() {} } });
  const sourceCodeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: WORKTREE, encoding: 'utf8' }).trim();
  const helperStatus = execFileSync('git', ['status', '--short', '--', 'tools/resonance/mid-tier-terminal.mjs'], { cwd: WORKTREE, encoding: 'utf8' }).trim();
  const rows = ENVIRONMENTS.flatMap(environmentId => ['four-cost', 'low-cost-three-star']
    .map(kind => runCase({ data, environmentId, kind, sourceCodeRevision })));
  const validation = { scope: '4 environments × 4-cost 2★ core and low-cost 3★ damage core; fixed terminal NORMAL fixture only',
    accessibility: '固定成熟阵容，不表示商店经济可达；四费核心优先同身份，缺失时使用本池四费输出并装备真实身份转职。', sourceCodeRevision,
    helperWorkingTreeState: helperStatus ? `uncommitted:${helperStatus}` : 'committed-or-clean-at-current-codeRevision', dataSourceCommit: rows[0]?.dataSourceCommit ?? null,
    difficulty: 'NORMAL', resolvedTerminalProfile: rows[0]?.enemyProfile ?? null, requestedRounds: 28, requestedLevel: 10,
    requestedBattleLimitSeconds: 180, pactTargetRule: 'main identity uses its second-highest configured threshold; always below maximum',
    cases: rows.length, summary: { battles: rows.filter(row => row.status === 'completed').length,
      noEligible: rows.filter(row => row.status === 'no-eligible').length, fixtureErrors: rows.filter(row => row.status === 'fixture-error').length,
      wins: rows.filter(row => row.status === 'completed' && row.won).length,
      diagnostics: rows.reduce((sum, row) => sum + (row.diagnostics ?? 0), 0), summonAnchorGaps: rows.reduce((sum, row) => sum + (row.summonAnchorGaps?.length ?? 0), 0) }, rows };
  const prior = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const key of ['rows', 'terminalPactMatrix', 'terminalBalanceCounterfactual', 'formalBalanceMatrix']) if (!(key in prior)) throw new Error(`archetype-report-history-missing:${key}`);
  const previousAttempt = prior.midTierTerminalDesignValidation;
  if (previousAttempt) {
    const preserved = structuredClone(previousAttempt);
    delete preserved.priorAttempts;
    validation.priorAttempts = [...(previousAttempt.priorAttempts ?? []), {
      ...preserved, ...classifyPreviousMidTierAttempt(preserved),
    }];
  } else validation.priorAttempts = [];
  atomicUpdate(reportPath, { midTierTerminalDesignValidation: validation });
  console.log(JSON.stringify({ reportPath, ...validation.summary, sourceCodeRevision, dataSourceCommit: validation.dataSourceCommit,
    profile: validation.resolvedTerminalProfile,
    rows: rows.map(row => `${row.environmentId} ${row.kind} ${row.status}${row.core ? ` ${row.core.name} ${row.core.star}★` : ''}${row.status === 'completed' ? ` ${row.won ? 'W' : 'L'} ${row.durationSeconds}s tier${row.pactProfile.activeTier}/${row.pactProfile.maxTier}` : ` ${row.reason || row.error}`}`) }, null, 2));
  return validation;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runMidTierTerminalDesignValidation();
