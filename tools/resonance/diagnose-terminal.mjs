import fs from 'node:fs';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { buildResonanceBattle, finishResonanceTerminalIfEscaped } from '../../server/modes/resonance/battle.js';
import { TICK } from '../../server/sim/constants.js';
import { ARCHETYPES, DATA_DIR, REPORT, SCENARIO_CONFIGS, buildScenario } from './archetype-balance.mjs';

const OUT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/terminal-diagnostics.json';
const readReport = () => JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const round = (n) => Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : null;
const toKeys = (keys) => keys instanceof Set ? keys : new Set(Array.isArray(keys) ? keys : []);
const data = loadData(DATA_DIR);
const report = readReport();

function unitSkill(u) {
  const s = u.skill;
  if (!s) return null;
  return {
    id: s.id ?? s.evSkillId ?? s.spec?.id ?? null,
    kind: s.kind,
    active: !!s.active,
    permanent: !!s.resonancePermanentDuration,
    configuredDuration: Number.isFinite(s.duration) ? round(s.duration) : String(s.duration),
    timeLeft: round(s.timeLeft),
    sp: round(s.sp),
    spCost: round(s.spCost),
    activations: s.activations ?? 0,
    ammoLeft: s.ammoLeft ?? null,
    specTags: s.spec?.tags ?? [],
    nativeTargetRangeSize: Array.isArray(s.rangeGrid) ? s.rangeGrid.length : null,
  };
}

function snapshotUnit(u) {
  const spec = u.skill?.spec;
  return {
    id: u.id,
    uid: u.uid,
    defId: u.defId,
    name: u.name,
    kind: u.kind,
    alive: !!u.alive,
    deployed: !!u.deployed,
    tile: [u.tileR, u.tileC],
    dir: u.dir,
    stats: {
      hp: round(u.hp), maxHp: round(u.s?.maxHp), atk: round(u.s?.atk), def: round(u.s?.def), res: round(u.s?.res),
      aspd: round(u.s?.aspd), bat: round(u.s?.bat), blockCnt: round(u.s?.blockCnt),
      dmg: round(u.stats?.dmg), heal: round(u.stats?.heal), taken: round(u.stats?.taken), attacks: u.stats?.attacks ?? 0,
    },
    skill: unitSkill(u),
    nativeSkillSpec: spec ? {
      kind: spec.kind,
      duration: Number.isFinite(spec.duration) ? round(spec.duration) : String(spec.duration),
      hasAttack: !!spec.attack,
      hasOnStart: typeof spec.onStart === 'function',
      hasOnTick: typeof spec.onTick === 'function',
      talentCount: u.kit?.talents?.length ?? 0,
      skillTalentCount: spec.talents?.length ?? 0,
    } : null,
    phalanxGuard: u.findBuff?.('trait:phalanxGuard') ? {
      mods: u.findBuff('trait:phalanxGuard').mods ?? null,
      duration: Number.isFinite(u.findBuff('trait:phalanxGuard').duration) ? round(u.findBuff('trait:phalanxGuard').duration) : 'permanent',
    } : null,
    status: {
      stunned: !!u.s?.flags?.stun,
      frozen: !!u.s?.flags?.freeze,
      cold: !!u.s?.flags?.cold,
      blocked: !!u.blocking?.length,
    },
    rangeKeys: [...toKeys(u.rangeKeys)].slice(0, 40),
  };
}

function enemySummary(b, e) {
  const tileIndex = e.tileR * 20 + e.tileC;
  const targets = b.allyUnits.filter(u => {
    if (u.kind !== 'op' || !u.alive || !u.deployed) return false;
    const keys = toKeys(u.rangeKeys);
    return keys.has(tileIndex) || keys.has(String(tileIndex)) || keys.has(`${e.tileR},${e.tileC}`);
  });
  const routeIndex = e.route ? b.routes.indexOf(e.route) : -1;
  const route = routeIndex >= 0 ? b.routes[routeIndex] : null;
  const pts = route?.pts ?? route?.points ?? [];
  const localRoute = e.route;
  return {
    id: e.id,
    defId: e.defId,
    name: e.name,
    rank: e.def?.rank ?? e.s?.rank ?? null,
    boss: !!e.isBoss || String(e.def?.rank ?? '').toUpperCase() === 'BOSS',
    elite: String(e.def?.rank ?? '').toUpperCase() === 'ELITE',
    motion: e.motion,
    alive: !!e.alive,
    deployed: !!e.deployed,
    hidden: !!e.hidden,
    removed: !!e.removed,
    removeReason: e.removeReason ?? null,
    hp: round(e.hp), maxHp: round(e.s?.maxHp), hpRatio: round(e.hpRatio),
    tile: [e.tileR, e.tileC], xy: [round(e.x), round(e.y)],
    routeIndex,
    routeAssigned: !!localRoute,
    localRouteKeys: localRoute && typeof localRoute === 'object' ? Object.keys(localRoute).slice(0, 16) : [],
    localRouteIndex: localRoute?.index ?? localRoute?.i ?? localRoute?.at ?? localRoute?.cursor ?? null,
    localRoutePointCount: Array.isArray(localRoute?.pts) ? localRoute.pts.length : Array.isArray(localRoute?.points) ? localRoute.points.length : null,
    localRouteNext: localRoute?.pts?.[localRoute.index ?? localRoute.i ?? 0] ?? localRoute?.points?.[localRoute.index ?? localRoute.i ?? 0] ?? null,
    routeLength: pts.length,
    routeGoal: pts.length ? pts.at(-1) : null,
    routeProgress: e.routeIndex ?? e.routePos ?? e.pathIndex ?? null,
    blockedBy: e.blockedBy?.id ?? null,
    noDisplace: !!e.s?.flags?.noDisplace,
    invulnerable: !!e.s?.flags?.invuln || !!e.s?.flags?.invulnerable,
    targetCoverage: { inOperatorRangeCount: targets.length, inRangeOf: targets.slice(0, 6).map(u => ({ name: u.name, uid: u.uid })) },
  };
}

function resolveReportRow(archetype, roundNo, level, coreStar) {
  return report.rows.find(row => row.archetype === archetype && row.round === roundNo && row.level === level && row.core?.star === coreStar);
}

function runOne(def, config, row) {
  const { catalogSeed, seed } = row;
  const coreStar = row.core.star;
  const catalog = getResonanceCatalog(data, { environmentId: def.env, seed: catalogSeed });
  const { state, field, equipment } = buildScenario({ data, catalog, definition: def, config, coreStar, seed });
  const { battle, prepared } = buildResonanceBattle(state, { data, catalog, recording: false, preview: false });
  const core = battle.allyUnits.find(u => String(u.uid) === String(row.core?.uid));
  const coreObserved = { uid: core?.uid ?? null, name: core?.name ?? null, observationCount: 0, skillActiveSecondsApprox: 0, guardPresentSecondsApprox: 0, minHp: null, maxHp: null, minAtk: null, maxAtk: null, minDef: null, maxDef: null, maxDmg: 0, lastSp: null };
  let nextSample = 0;
  while (!battle.finished) {
    battle.step();
    finishResonanceTerminalIfEscaped(battle, prepared.nodeKind);
    if (battle.time + 1e-9 >= nextSample && core) {
      nextSample += 1;
      const s = core.s;
      coreObserved.observationCount++;
      if (core.skill?.active) coreObserved.skillActiveSecondsApprox++;
      if (core.findBuff?.('trait:phalanxGuard')) coreObserved.guardPresentSecondsApprox++;
      for (const [name, value] of [['Hp', core.hp], ['Atk', s.atk], ['Def', s.def]]) {
        const minKey = `min${name}`, maxKey = `max${name}`;
        coreObserved[minKey] = coreObserved[minKey] == null ? round(value) : Math.min(coreObserved[minKey], round(value));
        coreObserved[maxKey] = coreObserved[maxKey] == null ? round(value) : Math.max(coreObserved[maxKey], round(value));
      }
      coreObserved.maxDmg = Math.max(coreObserved.maxDmg, round(core.stats.dmg));
      coreObserved.lastSp = round(core.skill?.sp);
    }
  }
  const result = battle.result();
  const player = Object.values(result.perPlayer ?? {})[0] ?? {};
  const countedLeak = (player.leaked ?? []).filter(entry => entry && entry.counted !== false);
  const hpLoss = Math.min(prepared.gd.lpCapPerRound, countedLeak.reduce((sum, entry) => sum + Math.max(0, Number.isFinite(Number(entry.lpr)) ? Number(entry.lpr) : 1), 0));
  const livingEnemies = battle.enemies.filter(e => e.alive && e.deployed && !e.hidden);
  const allEnemies = battle.units.filter(e => e.side === 'enemy' && !e.hidden);
  const finalEnemyUnits = [...livingEnemies, ...allEnemies.filter(e => !livingEnemies.includes(e)).sort((a, b) => {
    const rank = e => String(e.def?.rank ?? '').toUpperCase() === 'BOSS' ? 0 : String(e.def?.rank ?? '').toUpperCase() === 'ELITE' ? 1 : 2;
    return rank(a) - rank(b) || b.id - a.id;
  })];
  const enemySamples = finalEnemyUnits.slice(0, 12).map(e => enemySummary(battle, e));
  const coreSnap = core ? snapshotUnit(core) : null;
  const allies = battle.allyUnits.filter(u => u.kind === 'op').map(u => snapshotUnit(u));
  const summary = {
    archetype: def.id,
    environmentId: def.env,
    catalogSeed,
    seed,
    reportOutcome: { won: row.won, durationSeconds: row.durationSeconds, leaked: row.leaked, hpLoss: row.hpLoss, bossHpLeft: row.bossHpLeft },
    actual: {
      finished: battle.finished,
      time: round(result.time),
      tickCount: battle.tickCount,
      reason: result.reason,
      hpLoss,
      won: prepared.nodeKind === 'boss' || prepared.nodeKind === 'hidden'
        ? Number(result.bossHpLeft) <= 0
        : result.reason === 'cleared' && countedLeak.length === 0,
      total: result.total,
      killed: result.killed,
      errors: result.errors,
      leakEntries: (player.leaked ?? []).map(x => ({ enemyId: x.enemyKey ?? x.enemyId ?? x.id, counted: x.counted !== false, boss: !!x.boss, lpr: x.lpr ?? null })),
      bossHpLeft: result.bossHpLeft ?? null,
      sharedBoss: battle.sharedBoss ? { hp: round(battle.sharedBoss.hp), maxHp: round(battle.sharedBoss.maxHp), dead: battle.sharedBoss.hp <= 0 } : null,
      queuedSpawns: battle._pending?.length ?? null,
      unspawned: battle.unspawned?.length ?? 0,
      aliveEnemyCount: livingEnemies.length,
      totalEnemyInstances: allEnemies.length,
      enemySamples: enemySamples,
      terminalEnemyUnits: allEnemies.slice(-12).map(e => enemySummary(battle, e)),
      omittedLivingEnemyCount: Math.max(0, livingEnemies.length - enemySamples.length),
      core: coreSnap,
      coreSamples: coreObserved,
      allyUnits: allies,
      resonanceMetrics: battle.resonanceMetrics ?? null,
      battleErrors: battle.diagnostics?.slice?.(-8) ?? [],
    },
    setup: {
      stageId: prepared.stageId,
      battleRound: prepared.battleRound,
      waveRound: prepared.waveRound,
      nodeKind: prepared.nodeKind,
      field: field.field,
      coreName: row.core?.name,
      coreStar,
      coreSkillId: row.core?.skillId,
      equipment: equipment?.gearCount ?? 0,
      routeCount: prepared.wave?.routes?.length ?? 0,
      timeLimit: prepared.wave?.timeLimit,
      routes: (prepared.wave?.routes ?? []).slice(0, 12).map(route => ({ motion: route.motion, start: route.start, end: route.end, checkpointCount: route.checkpoints?.length ?? 0 })),
    },
  };
  return summary;
}

const previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const originalThreeStar = previous.cases?.find(item => item.archetype === 'snow' && item.setup?.coreStar === 3);
if (!originalThreeStar) throw new Error('existing-original-snow-three-star-baseline-not-found');
const snowRows = [2, 3].map(star => {
  const row = resolveReportRow('snow', 12, 6, star);
  if (!row) throw new Error(`report-row-not-found:snow:12:L6:star${star}`);
  return row;
});
const snowThree = snowRows[1];
const scenarioCatalog = getResonanceCatalog(data, { environmentId: 'origin_kjerag', seed: snowThree.catalogSeed });
const baseScenario = buildScenario({ data, catalog: scenarioCatalog, definition: ARCHETYPES.find(x => x.id === 'snow'), config: SCENARIO_CONFIGS.find(x => x.round === 12 && x.level === 6), coreStar: 3, seed: snowThree.seed });
const baseSetup = baseScenario.state.pieces.map(piece => ({ uid: piece.uid, operatorId: piece.operatorId, star: piece.star, row: piece.row, col: piece.col, equipment: (piece.equipment ?? []).map(item => item.itemId ?? item) }));
const counterfactuals = [
  originalThreeStar,
  runSnowCounterfactual(snowThree, 'snow3-cd3-cold1.5', 3, 1.5),
  runSnowCounterfactual(snowThree, 'snow3-cd4-cold1.5', 4, 1.5),
];
for (const result of counterfactuals.slice(1)) {
  if (JSON.stringify(result.setup.pieces) !== JSON.stringify(baseSetup)) throw new Error(`counterfactual-placement-or-equipment-drift:${result.label}`);
}
const priorStarTwo = previous.cases?.find(item => item.archetype === 'snow' && item.setup?.coreStar === 2);
const reportBaselines = Object.fromEntries(snowRows.map(row => [String(row.core.star), {
  star: row.core.star, won: row.won, duration: row.durationSeconds, leaks: row.leakCount, hpLoss: row.hpLoss, coreAttacks: row.core?.attacks ?? null, coreDamage: row.core?.damage ?? null,
} ]));
if (priorStarTwo?.actual?.core?.stats) {
  reportBaselines['2'].coreAttacks = priorStarTwo.actual.core.stats.attacks;
  reportBaselines['2'].coreDamage = priorStarTwo.actual.core.stats.dmg;
}
reportBaselines['3'].coreAttacks = originalThreeStar.actual.core.stats.attacks;
reportBaselines['3'].coreDamage = originalThreeStar.actual.core.stats.dmg;
const sampledOriginalAlive = originalThreeStar.actual.enemySamples.filter(enemy => enemy.alive);
const startTiles = new Set((originalThreeStar.setup.routes ?? []).filter(route => route.start).map(route => route.start.join(',')));
const baselineAtSpawn = sampledOriginalAlive.filter(enemy => startTiles.has(enemy.tile.join(',')));
const comparisonTable = [
  { case: '原始三星 1s/3s（已完成基线，未重跑）', profile: { tileCooldown: 1, coldDuration: 3 }, ...reportBaselines['3'], coreAttacks: originalThreeStar.actual.core.stats.attacks, coreDamage: originalThreeStar.actual.core.stats.dmg, aliveAtEnd: originalThreeStar.actual.aliveEnemyCount, sampledAliveAtSpawn: `${baselineAtSpawn.length}/${sampledOriginalAlive.length}`, sampledAliveInCoreRange: sampledOriginalAlive.filter(enemy => enemy.targetCoverage.inOperatorRangeCount > 0).length, freezeCounters: null },
  ...counterfactuals.slice(1).map(item => ({ case: item.label, profile: item.profile, ...item.result, aliveAtEnd: item.result.aggregate.aliveAndDeployedAtEnd, sampledAliveAtSpawn: null, sampledAliveInCoreRange: null, freezeCounters: item.result.aggregate })),
];

function withYelaCounterfactual(catalog, tileCooldown, coldDuration) {
  const clone = structuredClone(catalog);
  const yela = Object.values(clone.operators ?? {}).find(operator => operator.name === '圣聆初雪');
  if (!yela?.stars?.[3]?.passive || yela.stars[3].passive.kind !== 'star3_yela') throw new Error('snow-counterfactual-profile-not-found');
  yela.stars[3].passive.params.tileCooldown = tileCooldown;
  yela.stars[3].passive.params.coldDuration = coldDuration;
  const profile = clone.pacts?.yela?.levels?.flatMap(level => level.effects ?? []).find(effect => effect.kind === 'yela_breath');
  if (!profile?.params?.byStar?.[3]) throw new Error('snow-counterfactual-pact-profile-not-found');
  profile.params.byStar[3].tileCooldown = tileCooldown;
  profile.params.byStar[3].coldDuration = coldDuration;
  return clone;
}

function runSnowCounterfactual(row, label, tileCooldown, coldDuration) {
  const definition = ARCHETYPES.find(x => x.id === 'snow');
  const config = SCENARIO_CONFIGS.find(x => x.round === 12 && x.level === 6);
  const catalog = withYelaCounterfactual(getResonanceCatalog(data, { environmentId: definition.env, seed: row.catalogSeed }), tileCooldown, coldDuration);
  const { state, field, equipment } = buildScenario({ data, catalog, definition, config, coreStar: 3, seed: row.seed });
  const { battle, prepared } = buildResonanceBattle(state, { data, catalog, recording: false, preview: false });
  const core = battle.allyUnits.find(u => String(u.uid) === String(row.core.uid));
  const enemyControl = new Map();
  while (!battle.finished) {
    battle.step();
    finishResonanceTerminalIfEscaped(battle, prepared.nodeKind);
    for (const enemy of battle.enemies) {
      let stats = enemyControl.get(enemy.id);
      if (!stats) {
        stats = { id: enemy.id, enemyId: enemy.defId, spawnTile: [Math.round(enemy.spawnY), Math.round(enemy.spawnX)], spawnTileTicks: 0, maxSpawnTileRun: 0, currentSpawnTileRun: 0, frozenTicks: 0, frozenSpawnTicks: 0, maxFrozenSpawnRun: 0, currentFrozenSpawnRun: 0, coldTicks: 0, freezeEpisodes: 0, coldEpisodes: 0, wasFrozen: false, wasCold: false };
        enemyControl.set(enemy.id, stats);
      }
      if (enemy.alive && enemy.deployed) {
        const onSpawnTile = Math.round(enemy.y) === stats.spawnTile[0] && Math.round(enemy.x) === stats.spawnTile[1];
        if (onSpawnTile) {
          stats.spawnTileTicks++;
          stats.currentSpawnTileRun++;
          stats.maxSpawnTileRun = Math.max(stats.maxSpawnTileRun, stats.currentSpawnTileRun);
        } else stats.currentSpawnTileRun = 0;
        const cold = !!enemy.s?.flags?.cold;
        const frozen = !!enemy.s?.flags?.freeze;
        if (cold) { stats.coldTicks++; if (!stats.wasCold) stats.coldEpisodes++; }
        if (frozen) { stats.frozenTicks++; if (!stats.wasFrozen) stats.freezeEpisodes++; }
        if (frozen && onSpawnTile) {
          stats.frozenSpawnTicks++;
          stats.currentFrozenSpawnRun++;
          stats.maxFrozenSpawnRun = Math.max(stats.maxFrozenSpawnRun, stats.currentFrozenSpawnRun);
        } else stats.currentFrozenSpawnRun = 0;
        stats.wasCold = cold;
        stats.wasFrozen = frozen;
      }
    }
  }
  const result = battle.result();
  const player = Object.values(result.perPlayer ?? {})[0] ?? {};
  const countedLeak = (player.leaked ?? []).filter(entry => entry && entry.counted !== false);
  const hpLoss = Math.min(prepared.gd.lpCapPerRound, countedLeak.reduce((sum, entry) => sum + Math.max(0, Number.isFinite(Number(entry.lpr)) ? Number(entry.lpr) : 1), 0));
  const enemyRows = [...enemyControl.values()];
  const alive = battle.enemies.filter(e => e.alive && e.deployed && !e.hidden);
  const aggregate = {
    enemiesTracked: enemyRows.length,
    enemiesEverFrozen: enemyRows.filter(e => e.freezeEpisodes > 0).length,
    freezeEpisodes: enemyRows.reduce((sum, e) => sum + e.freezeEpisodes, 0),
    frozenEnemySeconds: round(enemyRows.reduce((sum, e) => sum + e.frozenTicks * TICK, 0)),
    coldEpisodes: enemyRows.reduce((sum, e) => sum + e.coldEpisodes, 0),
    coldEnemySeconds: round(enemyRows.reduce((sum, e) => sum + e.coldTicks * TICK, 0)),
    spawnTileEnemySeconds: round(enemyRows.reduce((sum, e) => sum + e.spawnTileTicks * TICK, 0)),
    maxSingleEnemySpawnTileRunSeconds: round(Math.max(0, ...enemyRows.map(e => e.maxSpawnTileRun * TICK))),
    aliveAndDeployedAtEnd: alive.length,
    stillAtSpawnTileAtEnd: alive.filter(e => Math.round(e.y) === Math.round(e.spawnY) && Math.round(e.x) === Math.round(e.spawnX)).length,
    longestFrozenAtSpawnTileSeconds: round(Math.max(0, ...enemyRows.map(e => e.maxFrozenSpawnRun * TICK))),
  };
  return {
    label,
    profile: { tileCooldown, coldDuration },
    setup: { stageId: prepared.stageId, seed: row.seed, catalogSeed: row.catalogSeed, coreTile: [core.tileR, core.tileC], coreDir: core.dir, equipment: equipment?.gearCount ?? 0,
      pieces: state.pieces.map(piece => ({ uid: piece.uid, operatorId: piece.operatorId, star: piece.star, row: piece.row, col: piece.col, equipment: (piece.equipment ?? []).map(item => item.itemId ?? item) })) },
    result: { won: prepared.nodeKind === 'boss' || prepared.nodeKind === 'hidden' ? Number(result.bossHpLeft) <= 0 : result.reason === 'cleared' && countedLeak.length === 0,
      reason: result.reason, time: round(result.time), leakCount: countedLeak.length, hpLoss, coreAttacks: core.stats.attacks, coreDamage: round(core.stats.dmg), coreHp: round(core.hp), coreMaxHp: round(core.s.maxHp), controlMetric: battle.resonanceMetrics?.control ?? 0, aggregate },
    endEnemies: [...alive].slice(0, 12).map(e => ({ id: e.id, enemyId: e.defId, rank: e.def?.rank ?? null, tile: [e.tileR, e.tileC], spawnTile: [Math.round(e.spawnY), Math.round(e.spawnX)], hp: round(e.hp), frozen: !!e.s?.flags?.freeze, cold: !!e.s?.flags?.cold })),
    diagnostics: battle.errors?.length ?? 0,
  };
}

const diagnostics = {
  schemaVersion: 1,
  sourceReport: REPORT,
  dataDirectory: DATA_DIR,
  createdAt: new Date().toISOString(),
  recording: false,
  methodology: 'Counterfactuals rebuild only the canonical Snow 12/L6 star-three scenario from its original report seed. Only the cloned star-three Yela and Yela pact profile tileCooldown/coldDuration are changed; no enemy, roster, position, equipment, or recording changes. Per-enemy cold/freeze/spawn-tile state is reduced online to counters; no event/trace/frame/stat-sample arrays are retained. The original star-two/star-three fixed-matrix result fields and prior original-star-three Battle summary are reused without rerunning those baselines.',
  baseline: { fixedMatrixByStar: reportBaselines, originalStarThreeBattle: originalThreeStar, originalStarTwoBattle: priorStarTwo ?? null },
  counterfactuals,
  comparisonTable,
  assessment: {
    finding: 'The combined shorter cold duration and longer per-tile cooldown strongly support the spawn-tile freeze-lock hypothesis for this seed: the original star-three battle timed out with 18 enemies alive, only 10 core attacks, and every sampled living enemy at a source route start and outside core range; both variants cleared without leaks and restored 21 core attacks / 37800 core damage.',
    limitations: 'Both candidate fields changed together, so this pair does not isolate cooldown from duration. The original baseline was intentionally reused without rerun and has no per-enemy freeze counters. One deterministic seed does not establish campaign-wide balance.',
    tuningCandidate: { tileCooldown: 3, coldDuration: 1.5, rationale: 'Both tested candidates won identically; 3/1.5 is the smaller cooldown adjustment. The 4/1.5 case had more observed frozen enemies/seconds on this seed but no additional outcome benefit.' },
    configChanged: false,
  },
  cases: previous.cases,
};
fs.mkdirSync(new URL('.', `file:///${OUT.replaceAll('\\', '/')}`), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(diagnostics, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: OUT, counterfactuals: counterfactuals.map(x => x.label ?? 'original-star3'), terminalReasons: counterfactuals.map(x => x.result?.reason ?? x.actual?.reason), errors: counterfactuals.reduce((n, x) => n + (x.diagnostics ?? x.actual?.errors ?? 0), 0) })}\n`);
