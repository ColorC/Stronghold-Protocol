import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installAssaultModule } from '../../server/sim/content/assault/cards/assault-modules.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { canTargetEnemy } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';
import { enemies as nativeEnemies } from '../../server/sim/content/assault/primitives.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const ghost2Design = roster.operators.find((entry) => entry.charId === 'char_1023_ghost2');
const ghost2Loss = ghost2Design.fixedSkill.effects.find((effect) => effect.trigger === '命中敌人生命比例不低于自身').values.selfMaxHpLossRatio;
assert.deepEqual(ghost2Loss, [0.03, 0.03, 0.03, 0.03],
  'formal source defines exact 3% max-HP loss at all ranks');
assert.deepEqual(runtime.bodies.char_1023_ghost2.fixedSkill.effects.find((effect) =>
  effect.trigger === '命中敌人生命比例不低于自身').values.selfMaxHpLossRatio, ghost2Loss,
  'the compiled runtime carries the formal HP-loss field without fixture substitution');
const pieceFor = (body, star, moduleId) => ({ uid: `source-c:${body.charId}:${moduleId ?? 'base'}:${star}`,
  charId: body.charId, star, moduleId, moduleChoices: { [body.charId]: moduleId }, fixedSkill: body.fixedSkill,
  sourceCopies: 1, permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [] });

function realBattle(charId, moduleId, ranks, positions = [[10, 6]], star = 4, allyCount = 1, enemyDef = 0, stationaryTargets = false, pauseInitialAttacks = false) {
  const body = runtime.bodies[charId], piece = pieceFor(body, star, moduleId);
  const alliedPositions = [[10, 5], [12, 3], [12, 8], [9, 8], [10, 10]];
  const units = Array.from({ length: allyCount }, (_, index) => {
    const alliedPiece = index === 0 ? piece : { ...pieceFor(body, star, null), uid: `${piece.uid}:ally:${index}` };
    const [row, col] = alliedPositions[index];
    const chess = chessRec({ id: `source-c-chess:${alliedPiece.uid}`, charId, profession: body.profession,
      stats: body.starStats[star - 1].stats, rangeGrid: body.range });
    chess.assaultPiece = alliedPiece; chess.assaultBody = body;
    return { piece: alliedPiece, chess, row, col };
  });
  const enemies = positions.map((_, i) => enemyRec({ key: `source-c-enemy:${piece.uid}:${i}`,
    hp: 1e9, def: enemyDef, res: 0, atk: 0, speed: 0 }));
  const routeFor = (pos) => stationaryTargets
    ? { motion: 'WALK', start: pos, end: pos, steps: [{ t: 'wait', s: 99999 }] }
    : null;
  const data = new DataSource({ chess: Object.fromEntries(units.map(({ chess }) => [chess.chessId, chess])), enemies: Object.fromEntries(enemies.map((e) => [e.key, e])) }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: `source-c:${piece.uid}`, stage: flatStage(), routes: flatRoutes(),
    spawns: [{ enemyKey: enemies[0].key, time: 0, routeIndex: 0, pos: positions[0], route: routeFor(positions[0]) }], data,
    players: [{ playerId: 'p1', units: units.map(({ piece: unitPiece, chess, row, col }) => ({ uid: unitPiece.uid, chessId: chess.chessId, row, col })) }],
    content: 'assault', assault: { kits: { ...assaultKits }, strict: true },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 99 }, autoFinish: false, timeLimit: 120, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  positions.slice(1).forEach((pos, i) => battle.spawnEnemy(enemies[i + 1].key, { routeIndex: 0, pos, route: routeFor(pos) }));
  battle._buildEnemyIndex();
  if (pauseInitialAttacks) for (const ally of battle.allyUnits) ally.atkCd = 999;
  battle.step();
  return { battle, body, piece, unit: battle.allyUnits.find((u) => u.uid === piece.uid),
    targets: battle.enemies.filter((e) => e.alive) };
}

function forceInstant(fixture) {
  fixture.unit.skill.charges = 1;
  fixture.unit.skill.sp = fixture.unit.skill.spCost;
  assert.equal(fixture.battle.assaultRuntime.cast(fixture.unit, { force: true }), true,
    JSON.stringify({ charId: fixture.body.charId, alive: fixture.unit?.alive, deployed: fixture.unit?.deployed,
      skill: fixture.unit?.skill && { sp: fixture.unit.skill.sp, cost: fixture.unit.skill.spCost, charges: fixture.unit.skill.charges },
      errors: fixture.battle.errors?.slice?.(-2) }));
  fixture.battle.assaultRuntime.flush();
}

function advanceTo(battle, time, maxSteps = 1200) {
  let steps = 0;
  while (battle.time < time && !battle.finished && steps < maxSteps) {
    battle.step();
    steps++;
  }
  assert.ok(battle.time >= time, `native clock reached ${time}: actual=${battle.time}, steps=${steps}, finished=${battle.finished}`);
  return steps;
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Ulpianus module leaves the real fixed-skill max-HP/ATK buff at its exact rank value and duration', () => {
  for (const rank of [3, 4]) {
    const fixture = realBattle('char_4145_ulpia', 'uniequip_002_ulpia', rank, [[10, 6]], rank);
    const beforeMaxHp = fixture.unit.s.maxHp;
    forceInstant(fixture);
    const buff = fixture.unit.buffs.find((entry) => entry.key.startsWith('char_4145_ulpia:addBuff'));
    assert.ok(buff, `rank ${rank}: actual fixed skill installs its timed buff`);
    assert.equal(fixture.unit.s.maxHp, beforeMaxHp * 1.8, `rank ${rank}: compiled +80% max HP is applied`);
    assert.equal(buff.duration, 25, `rank ${rank}: buff keeps its compiled 25-second duration`);
    assert.equal(fixture.unit.s.atk, fixture.body.starStats[rank - 1].stats.atk * (1 + (rank === 3 ? 2.6 : 2.6)),
      `rank ${rank}: compiled +260% attack bonus is applied`);
  }
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('SilverAsh module and S3 keep exact passive/skill stats and skill buff duration in real Battle', () => {
  for (const rank of [3, 4]) {
    const fixture = realBattle('char_172_svrash', 'uniequip_002_svrash', rank, [[10, 6]], rank);
    const leaderAtk = fixture.unit.buffs.find((entry) => entry.key === 'char_172_svrash:leader-atk');
    const leaderRedeploy = fixture.unit.buffs.find((entry) => entry.key === 'char_172_svrash:leader-redeploy');
    assert.equal(leaderAtk?.mods?.atkPct, 0.1, `rank ${rank}: owner receives the exact 10% attack passive`);
    assert.equal(leaderRedeploy?.mods?.redeployMul, rank === 3 ? 0.9 : 0.88,
      `rank ${rank}: real team redeployment modifier is exactly 10%/12%`);
    assert.equal(fixture.unit.mem.assaultSilverAshModule, true, `rank ${rank}: module enables the real team skill modifier`);
    const beforeBaseAtk = fixture.body.starStats[rank - 1].stats.atk;
    const beforeBaseDef = fixture.body.starStats[rank - 1].stats.def;
    forceInstant(fixture);
    const skillBuff = fixture.unit.buffs.find((entry) => entry.key.includes('char_172_svrash:addBuff') && entry.mods?.atkPct === (rank === 3 ? 1.8 : 2));
    assert.ok(skillBuff, `rank ${rank}: real S3 installs its post-hit buff`);
    assert.ok(Math.abs(fixture.unit.s.atk - beforeBaseAtk * (rank === 3 ? 2.9 : 3.1)) < 1e-6,
      `rank ${rank}: S3 applies its exact +180%/+200% attack value`);
    assert.ok(Math.abs(fixture.unit.s.def - beforeBaseDef * 0.3) < 1e-6,
      `rank ${rank}: S3 applies its exact -70% defense value`);
    assert.equal(skillBuff.timeLeft, 30, `rank ${rank}: S3 buff duration is the compiled 30 seconds`);
  }
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Chyue S3 does not apply its marked-target bonus before a native mark', () => {
  for (const rank of [3, 4]) {
    const fixture = realBattle('char_2024_chyue', null, `chyue-source-${rank}`, [[10, 6], [9, 6], [7, 6]], rank, 1, 0, false, true);
    const primary = nativeEnemies(fixture.battle, fixture.unit, { scope: 'range', count: 1 })[0];
    const markKey = `assault:char_2024_chyue:zhige:${fixture.unit.uid}`;
    assert.equal(primary?.buffs.some((buff) => buff.key === markKey && buff.source === fixture.unit), false,
      'fixture delays native basic attacks so no prior mark contaminates the skill result');
    const received = new Map(fixture.targets.map((target) => [target, 0]));
    fixture.battle.on('damaged', ({ source, target, amount, dmg }) => {
      if (source === fixture.unit && target) {
        if (dmg?.isSkill) received.set(target, (received.get(target) ?? 0) + amount);
      }
    }, { owner: fixture.unit });
    const atk = fixture.unit.s.atk;
    forceInstant(fixture);
    const mainScale = rank === 3 ? 3.5 : 3.8;
    assert.ok(Math.abs(received.get(primary) - atk * mainScale) < 1e-6,
      `rank ${rank}: without an ordinary-attack mark, S3 must deal only ${mainScale}× base damage`);
  }
});

test('Chyue S3 hits its one-tile splash neighbors and not a distant enemy at both source ranks', () => {
  for (const rank of [3, 4]) {
    const fixture = realBattle('char_2024_chyue', null, `chyue-splash-${rank}`, [[10, 7], [9, 6], [10, 6], [10, 8]], rank, 1, 0, true);
    const at = (x, y) => fixture.targets.find((target) => target.x === x && target.y === y);
    const primary = at(6, 10), adjacent = at(6, 9), boundary = at(7, 10), outside = at(8, 10);
    assert.ok(primary && adjacent && boundary && outside, 'native routes retain the four intended test targets');
    const received = new Map(fixture.targets.map((target) => [target, 0]));
    fixture.battle.on('damaged', ({ source, target, amount, dmg }) => {
      if (source === fixture.unit && target && dmg?.isSkill)
        received.set(target, (received.get(target) ?? 0) + amount);
    }, { owner: fixture.unit });
    const nativePrimary = nativeEnemies(fixture.battle, fixture.unit, { scope: 'range', count: 1 })[0];
    forceInstant(fixture);
    const mainScale = rank === 3 ? 3.5 : 3.8;
    assert.equal(nativePrimary?.id, primary.id,
      `rank ${rank}: intended center must be native range selector's primary; got ${nativePrimary?.x},${nativePrimary?.y}, intended ${primary.x},${primary.y}`);
    assert.deepEqual(new Set(fixture.targets.map(({ x, y }) => `${x},${y}`)), new Set(['6,9', '6,10', '7,10', '8,10']),
      'stationary WALK routes keep all targets at the intended native coordinates');
    assert.ok(Math.abs(Math.hypot(adjacent.x - primary.x, adjacent.y - primary.y) - 1) < 1e-9);
    assert.ok(Math.hypot(outside.x - primary.x, outside.y - primary.y) > 1);
    assert.deepEqual(fixture.targets.map((target) => canTargetEnemy(fixture.unit, target, fixture.unit.profile)), [true, true, true, true],
      'all four actual enemies are natively targetable; splash scope must decide by continuous distance');
    assert.ok(received.get(primary) > 0, `rank ${rank}: selected primary target is hit`);
    assert.ok(Math.abs(received.get(adjacent) - fixture.unit.s.atk * mainScale) < 1e-6,
      `rank ${rank}: adjacent splash target receives exactly ${mainScale}× attack`);
    assert.ok(Math.abs(received.get(boundary) - fixture.unit.s.atk * mainScale) < 1e-6,
      `rank ${rank}: a target exactly one native coordinate unit away is included; nativePrimary=${JSON.stringify([nativePrimary?.x, nativePrimary?.y])}; coords=${JSON.stringify(fixture.targets.map(({ x, y }) => [x, y]))}; hit=${JSON.stringify(fixture.targets.map((target) => [[target.x, target.y], received.get(target)]))}; radius=${JSON.stringify(runtime.bodies.char_2024_chyue.fixedSkill.effects[0].values.splashRadius)}`);
    assert.equal(received.get(outside), 0, `rank ${rank}: a target beyond radius one is not hit`);
  }
});

test('Chyue S3 applies the source multiplier only to a live mark created by its own real attacks', () => {
  for (const config of [
    { rank: 3, moduleId: null, expectedMarkScale: 1.6 },
    { rank: 4, moduleId: null, expectedMarkScale: 1.65 },
    { rank: 3, moduleId: 'uniequip_002_chyue', expectedMarkScale: 1.6 },
    { rank: 4, moduleId: 'uniequip_002_chyue', expectedMarkScale: 1.8 },
    { rank: 3, moduleId: 'uniequip_003_chyue', expectedMarkScale: 1.6 },
    { rank: 4, moduleId: 'uniequip_003_chyue', expectedMarkScale: 1.65 },
  ]) {
    const { rank, moduleId } = config;
    const fixture = realBattle('char_2024_chyue', moduleId, `chyue-mark-${rank}-${moduleId ?? 'base'}`, [[10, 6]], rank);
    const target = fixture.targets[0], markKey = `assault:char_2024_chyue:zhige:${fixture.unit.uid}`;
    for (let attempt = 0; attempt < 80 && !target.buffs.some((entry) => entry.key === markKey && entry.source === fixture.unit); attempt++)
      assert.equal(fixture.battle.forceAttack(fixture.unit, [target]), true, 'each mark attempt uses a real native attack');
    assert.ok(target.buffs.some((entry) => entry.key === markKey && entry.source === fixture.unit),
      'native hit rolls the source probability and creates this owner’s mark');
    const skillAmounts = [];
    fixture.battle.on('damaged', ({ source, target: damaged, amount, dmg }) => {
      if (source === fixture.unit && damaged === target && dmg?.isSkill) skillAmounts.push(amount);
    }, { owner: fixture.unit });
    const rankScale = rank === 3 ? 3.5 : 3.8;
    forceInstant(fixture);
    assert.ok(Math.abs(skillAmounts.reduce((sum, amount) => sum + amount, 0) -
      fixture.unit.s.atk * rankScale * config.expectedMarkScale) < 1e-6,
    `${rank}/${moduleId ?? 'base'}: marked S3 uses exact source multiplier ${config.expectedMarkScale}`);
    advanceTo(fixture.battle, fixture.battle.time + 2.6);
    assert.equal(target.buffs.some((entry) => entry.key === markKey), false, 'the source mark expires at 2.5 seconds');
  }
});

test('Chyue marks require a landed live hit, refresh for 2.5 seconds, and remain owner-scoped', () => {
  const marker = (unit) => `assault:char_2024_chyue:zhige:${unit.uid}`;
  const cancelled = realBattle('char_2024_chyue', null, 'chyue-cancel', [[10, 6]], 4, 1, 0, true);
  const cancelledTarget = cancelled.targets[0], cancelledHp = cancelledTarget.hp;
  cancelled.battle.on('hit', ({ source, target, dmg }) => {
    if (source === cancelled.unit && target === cancelledTarget && dmg?.isAttack) dmg.cancel = true;
  }, { priority: -100 });
  assert.equal(cancelled.battle.forceAttack(cancelled.unit, [cancelledTarget]), true);
  assert.equal(cancelledTarget.hp, cancelledHp, 'cancelled native hit leaves HP unchanged');
  assert.equal(cancelledTarget.buffs.some((buff) => buff.key === marker(cancelled.unit)), false,
    'cancelled damage has no landed mark');

  const shielded = realBattle('char_2024_chyue', null, 'chyue-full-shield', [[10, 6]], 4, 1, 0, true);
  const shieldedTarget = shielded.targets[0], shieldedHp = shieldedTarget.hp;
  shielded.battle.addBuff(shieldedTarget, { key: 'fixture:full-shield', shield: 1e9, duration: 10, source: shieldedTarget });
  assert.equal(shielded.battle.forceAttack(shielded.unit, [shieldedTarget]), true);
  assert.equal(shieldedTarget.hp, shieldedHp, 'full native shield absorbs the attack');
  assert.ok(shieldedTarget.buffs.some((buff) => buff.key === marker(shielded.unit) && buff.source === shielded.unit),
    'a real landed hit still marks when its HP damage is fully absorbed');

  const refresh = realBattle('char_2024_chyue', null, 'chyue-refresh', [[10, 6]], 4, 1, 0, true);
  const refreshTarget = refresh.targets[0]; refresh.battle.rng = () => 0;
  assert.equal(refresh.battle.forceAttack(refresh.unit, [refreshTarget]), true);
  const initial = refreshTarget.buffs.find((buff) => buff.key === marker(refresh.unit));
  assert.ok(initial && Math.abs(initial.timeLeft - 2.5) < 1e-6, 'first real hit applies the 2.5 second mark');
  advanceTo(refresh.battle, refresh.battle.time + 2.0);
  assert.equal(refresh.battle.forceAttack(refresh.unit, [refreshTarget]), true);
  const renewed = refreshTarget.buffs.find((buff) => buff.key === marker(refresh.unit));
  assert.ok(renewed && renewed.timeLeft > 2.4, 'a later successful normal attack refreshes the same owner mark');
  refresh.unit.atkCd = 999;
  advanceTo(refresh.battle, refresh.battle.time + 2.6);
  assert.equal(refreshTarget.buffs.some((buff) => buff.key === marker(refresh.unit)), false,
    'the refreshed mark expires after its own 2.5 second window');

  const owners = realBattle('char_2024_chyue', null, 'chyue-owner-isolation', [[10, 6], [12, 4]], 4, 2, 0, true);
  const [first, second] = owners.battle.allyUnits;
  const [firstTarget, secondTarget] = [owners.targets.find((target) => target.x === 6 && target.y === 10),
    owners.targets.find((target) => target.x === 4 && target.y === 12)];
  assert.ok(firstTarget && secondTarget, 'each real owner has a target in its own native range');
  owners.battle.rng = () => 0;
  assert.equal(owners.battle.forceAttack(first, [firstTarget]), true);
  assert.equal(owners.battle.forceAttack(second, [secondTarget]), true);
  assert.ok(firstTarget.buffs.some((buff) => buff.key === marker(first) && buff.source === first));
  assert.ok(secondTarget.buffs.some((buff) => buff.key === marker(second) && buff.source === second));
  assert.equal(firstTarget.buffs.some((buff) => buff.key === marker(second)), false,
    'the second owner has no implicit mark on the first owner target');
  assert.equal(secondTarget.buffs.some((buff) => buff.key === marker(first)), false,
    'the first owner has no implicit mark on the second owner target');

  const lethal = realBattle('char_2024_chyue', null, 'chyue-lethal', [[10, 6]], 4, 1, 0, true);
  const lethalTarget = lethal.targets[0]; lethalTarget.hp = 1;
  assert.equal(lethal.battle.forceAttack(lethal.unit, [lethalTarget]), true);
  assert.equal(lethalTarget.alive, false, 'the native attack kills the low-HP target');
  assert.equal(lethalTarget.buffs.some((buff) => buff.key === marker(lethal.unit)), false,
    'the lethal damaged callback does not leave a mark on a dead target');
});

test('Chyue mark multiplier scales post-mitigation damage against high DEF', () => {
  const makeHit = (marked) => {
    const fixture = realBattle('char_2024_chyue', null, `chyue-high-def-${marked}`, [[10, 6]], 4, 1, 900);
    const target = fixture.targets[0];
    const amounts = [];
    fixture.battle.on('damaged', ({ source, target: damaged, amount, dmg }) => {
      if (source === fixture.unit && damaged === target && dmg?.isSkill) amounts.push(amount);
    }, { owner: fixture.unit });
    if (marked) {
      for (let attempt = 0; attempt < 80 && !target.buffs.some((entry) => entry.key === `assault:char_2024_chyue:zhige:${fixture.unit.uid}`); attempt++)
        assert.equal(fixture.battle.forceAttack(fixture.unit, [target]), true);
      assert.ok(target.buffs.some((entry) => entry.key === `assault:char_2024_chyue:zhige:${fixture.unit.uid}`));
    }
    forceInstant(fixture);
    assert.ok(amounts[0] > 0, 'native physical mitigation leaves measurable skill damage');
    return amounts.reduce((sum, amount) => sum + amount, 0);
  };
  const unmarked = makeHit(false), marked = makeHit(true);
  assert.ok(Math.abs(marked - unmarked * 1.65) < 1e-6,
    `the talent multiplier scales the mitigated result after DEF (unmarked=${unmarked}, marked=${marked})`);
});

test('Chyue 003 adds three percentage points to the native mark roll at both ranks', () => {
  for (const rank of [3, 4]) {
    const observed = [];
    for (const moduleId of [null, 'uniequip_003_chyue']) {
      const fixture = realBattle('char_2024_chyue', moduleId, `chyue-prob-${rank}-${moduleId ?? 'base'}`, [[10, 6]], rank);
      const target = fixture.targets[0], key = `assault:char_2024_chyue:zhige:${fixture.unit.uid}`;
      fixture.battle.rng = () => 0.245;
      assert.equal(fixture.battle.forceAttack(fixture.unit, [target]), true, 'the probability check follows a real attack');
      observed.push(target.buffs.some((entry) => entry.key === key && entry.source === fixture.unit));
    }
    assert.deepEqual(observed, [false, true], `rank ${rank}: 0.245 is above native 0.23 and below module 0.26`);
  }
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
