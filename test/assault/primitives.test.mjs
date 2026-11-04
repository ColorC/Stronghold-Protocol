import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { COLS } from '../../server/sim/constants.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { pieceOf, bodyOf, rank, v, active, uid, makeKit, watch, queue, enemies, allies,
  damage, heal, buff, applyStatus, haste, sp, cooldowncost, recast, redeploy, payDP, gainDP, persistGrowth, unitTag, matchesTags, onTimer } from '../../server/sim/content/assault/primitives.js';
import { ledgerFor, grantSummon, returnSummon, fuseSummons, deriveWorkshopPlatform } from '../../server/sim/content/assault/summons.js';
import { adjacentUnits } from '../../server/sim/content/assault/relics/helpers.js';

test('relic adjacency without cached tiles follows the native half-even coordinate rule', () => {
  const point = (id, x, y) => ({ id, x, y, alive: true, deployed: true });
  const anchor = point('anchor', 2.5, 10.5), evenNeighbour = point('even', 1, 10), ordinaryFar = point('far', 3, 11);
  assert.deepEqual(adjacentUnits({ allyUnits: [anchor, evenNeighbour, ordinaryFar] }, anchor, 'ally', false), [evenNeighbour]);
  const oddAnchor = point('odd-anchor', 3.5, 11.5), oddNeighbour = point('odd', 5, 12);
  assert.deepEqual(adjacentUnits({ allyUnits: [oddAnchor, oddNeighbour] }, oddAnchor, 'ally', false), [oddNeighbour]);
});

const CHESS = 'chess_assault_primitives';
const CHAR = 'char_assault_primitives';
const TOKEN = 'token_assault_primitives';
const ENEMY = 'enemy_assault_primitives';
const tokenRec = () => ({ tokenId: TOKEN, name: 'fixture token', profession: 'TOKEN', position: 'MELEE', stats: { maxHp: 400, atk: 20, def: 0, res: 0, cost: 0, blockCnt: 1, bat: 1, aspd: 100, respawnTime: 0, spRecovery: 0 }, rangeGrid: [[0, 0]] });

function makeBattle({ players = null, enemyCount = 0, skill = {}, install = null, setup = null, stage = flatStage(), tokenCost = 0, tokenOverrides = {} } = {}) {
  const chess = chessRec({ id: CHESS, charId: CHAR, profession: 'WARRIOR', stats: { cost: 10 }, skill: { skillId: 'sk_assault_primitives', spCost: 30, initSp: 0, spType: 'INCREASE_WITH_TIME', ...skill } });
  const enemy = enemyRec({ key: ENEMY, hp: 100000, speed: 0, def: 0, res: 0, rangeRadius: 0 });
  const token = tokenRec(); token.stats.cost = tokenCost;
  Object.assign(token, tokenOverrides);
  const data = new DataSource({ chess: { [CHESS]: chess }, enemies: { [ENEMY]: enemy }, tokens: { [TOKEN]: token } }, getDefaultSource());
  const kitState = { casts: 0 };
  const kits = {
    [CHAR]: () => ({ skill: { id: 'assault-primitives', kind: 'instant', spCost: 30, trigger: 'SP_FULL', assaultCast: (ctx) => { kitState.casts++; ctx.unit.lastCause = ctx.cause; } }, install }),
    [TOKEN]: () => ({}),
  };
  const unit = { uid: 'owner-1', chessId: CHESS, row: 10, col: 5 };
  const p = players ?? [{ playerId: 'p1', units: [unit] }];
  const spawns = Array.from({ length: enemyCount }, (_, i) => ({ enemyKey: ENEMY, time: 0, routeIndex: 0, pos: [10, 10 + i] }));
  const battle = new Battle({ kind: 'normal', modeId: 'assault-primitives', stage, routes: flatRoutes(), spawns, data,
    players: p, content: 'assault', assault: { kits, strict: true, install: (b) => install?.(b) },
    flags: { dpInit: 50, dpPerSec: 1, dpMax: 99, startOpCooldown: 0 }, autoFinish: false, timeLimit: 120,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  setup?.(battle);
  return { battle, kitState, owner: battle.allyUnits.find((x) => x.kind === 'op'), data };
}

function assaultDef(star = 1) {
  const piece = { uid: `p${star}`, charId: CHAR, star, moduleId: null };
  const body = { charId: CHAR, tags: ['WARRIOR'], fixedSkill: { sourceSkillId: 'fixed-assault', kind: 'instant', spCosts: [10, 8, 6, 4], initSp: 2, recoveryPerSec: 1 } };
  return { raw: { assaultPiece: piece, assaultBody: body }, input_piece: piece };
}

test('piece/body readers select the input piece rank and reject missing rank data', () => {
  const def = assaultDef(3);
  assert.equal(pieceOf(def).uid, 'p3');
  assert.equal(bodyOf(def).charId, CHAR);
  assert.equal(rank(def), 3);
  assert.equal(v(def, [10, 8, 6, 4]), 6);
  assert.equal(v(def, 7), 7);
  assert.throws(() => rank({ raw: { assaultPiece: { star: 5 }, assaultBody: {} } }), /rank/);
  assert.throws(() => v(def, [1, 2]), /four-rank/);
  assert.throws(() => pieceOf({}), /assaultPiece/);
});

test('makeKit uses exact fixed source skill and rank cost; passive kits need no native energy record', () => {
  const def = assaultDef(4);
  const kit = makeKit(def, { cast: ({ unit }) => { unit.called = true; } });
  assert.equal(kit.skill.id, 'fixed-assault');
  assert.equal(kit.skill.spCost, 4);
  assert.equal(kit.skill.initSp, 2);
  assert.equal(kit.skill.trigger, 'SP_FULL');
  assert.equal(kit.skill.kind, 'instant');
  assert.throws(() => makeKit({ raw: { assaultPiece: { star: 2 }, assaultBody: {} }, input_piece: { star: 2 } }, { cast() {} }), /fixedSkill/);
  const passive = makeKit({ raw: { assaultPiece: { star: 1 }, assaultBody: {} }, input_piece: { star: 1 } }, { passive: true, trait() {} });
  assert.equal(passive.skill.kind, 'passive');
  assert.equal(passive.skill.spCost, 0);
});

test('watch queues per target, preserves sibling branches and stops same-path recursion', () => {
  const { battle, owner } = makeBattle();
  const hits = [];
  watch(battle, owner, 'fixtureHit', 'count', () => true, ({ payload }) => hits.push(payload.targetUid));
  const cause = battle.assaultRuntime.publish('root', { source: owner, sourceUid: owner.uid }).cause;
  for (const targetUid of ['e1', 'e2']) battle.assaultRuntime.publish('fixtureHit', { sourceUid: owner.uid, targetUid }, { cause });
  battle.assaultRuntime.flush();
  assert.deepEqual(hits, ['e1', 'e2']);
  const recursive = [];
  watch(battle, owner, 'recursive', 'same', () => true, ({ event }) => {
    recursive.push(event.payload.targetUid);
    battle.assaultRuntime.publish('recursive', { targetUid: event.payload.targetUid });
  });
  battle.assaultRuntime.publish('recursive', { targetUid: 'e1' });
  battle.assaultRuntime.flush();
  assert.equal(recursive.length, 1);
});

test('selectors use native range keys and stable UID ties; tags come only from explicit fields', () => {
  const { battle, owner } = makeBattle();
  battle.spawnEnemy(ENEMY, { route: flatRoutes()[0], pos: [10, 10] });
  battle.spawnEnemy(ENEMY, { route: flatRoutes()[0], pos: [10, 11] });
  battle._buildEnemyIndex();
  owner.rangeKeys = battle.enemies.map((x) => Math.round(x.y) * COLS + Math.round(x.x));
  owner.rangeKeySet = new Set(owner.rangeKeys);
  const inRange = enemies(battle, owner, { count: 5 });
  assert.equal(inRange.length, 2);
  assert.deepEqual(inRange.map(uid), [...inRange.map(uid)].sort());
  assert.equal(enemies(battle, owner, { scope: 'field', count: 5 }).length, 2);
  battle.enemies[0].x = owner.x + 1; battle.enemies[0].y = owner.y;
  battle.enemies[1].x = owner.x + 1; battle.enemies[1].y = owner.y + 1;
  assert.equal(enemies(battle, owner, { scope: 'adjacent4', count: 5 }).length, 1);
  assert.equal(enemies(battle, owner, { scope: 'adjacent8', count: 5 }).length, 2);
  battle.enemies[0].s.flags.untargetable = true;
  assert.equal(enemies(battle, owner, { scope: 'field', count: 5 }).length, 1);
  assert.equal(enemies(battle, owner, { scope: 'field', count: 5, allowUntargetable: true }).length, 2);
  const self = allies(battle, owner, { scope: 'self', anchor: owner, count: 2 });
  assert.deepEqual(self.map(uid), [owner.uid]);
  owner.input_piece = { tags: ['natural', 'WARRIOR'], tagEdits: { add: ['sargon'], remove: ['WARRIOR'] } };
  assert.equal(unitTag(owner, 'sargon'), true);
  assert.equal(matchesTags(owner, ['sargon', 'natural']), true);
  assert.equal(matchesTags(owner, 'WARRIOR'), false);
});

test('damage hits are separate native instances; healing and status return actual results', () => {
  const { battle, owner } = makeBattle({ enemyCount: 1 });
  battle.step(); battle._buildEnemyIndex();
  const target = battle.enemies[0];
  const hp = target.hp;
  const dealt = damage(battle, owner, target, { amount: 100, type: 'true', hits: 3, sourceKey: 'three-hit', isSkill: true });
  assert.equal(dealt, hp - target.hp);
  assert.ok(dealt >= 300);
  owner.hp = owner.s.maxHp - 100;
  assert.equal(heal(battle, owner, owner, { amount: 40 }), 40);
  assert.equal(applyStatus(battle, owner, target, { status: 'stun', duration: 1 }), true);
  assert.equal(target.s.flags.stun, true);
  assert.throws(() => buff(battle, owner, owner, { key: 'bad', mods: { notAStat: 1 } }), /unknown buff stat/);
});

test('natural SP haste adds duration, overfill reports net amount, and final SP cost has an absolute half-point floor', () => {
  const { battle, owner, kitState } = makeBattle({ skill: { spCost: 10, initSp: 0 } });
  const baseRate = owner.s.spRecovery;
  haste(battle, owner, owner, 2, 'source-a');
  haste(battle, owner, owner, 2, 'source-b');
  assert.equal(owner.s.spRecovery, baseRate * 2);
  assert.equal(owner.buffs.find(entry => entry.key === 'assault:haste:shared').timeLeft, 4);
  const before = owner.skill.sp;
  battle.step(); battle.step();
  assert.ok(owner.skill.sp - before > baseRate * battle.dt);
  const capacity = owner.skill.spCost - owner.skill.sp;
  assert.equal(sp(battle, owner, owner, 50, 'gift', 'test'), capacity);
  assert.equal(kitState.casts, 0);
  cooldowncost(battle, owner, 0.1, 'source-a');
  assert.equal(owner.skill.spCostMul, 0.1);
  assert.equal(owner.skill.spCost, owner.skill.baseSpCost * 0.1);
  cooldowncost(battle, owner, 0.01, 'source-b');
  assert.equal(owner.skill.spCost, 0.5);
  cooldowncost(battle, owner, 0.2, 'source-a');
  assert.equal(owner.skill.spCostMul, 0.002);
  assert.equal(owner.skill.spCost, 0.5);
});

test('instant assault teleport respects flying and self-bound targets and preserves the next route checkpoint', () => {
  const { battle, owner } = makeBattle({ enemyCount: 3 });
  battle.step();
  const [ground, flyer, bound] = battle.enemies;
  ground.x = 8; ground.y = 10;
  flyer.motion = 'FLY';
  buff(battle, owner, bound, { key: 'fixture:self-bound', mods: {}, flags: { selfBound: true } });
  const checkpoint = ground.route.legIdx;
  assert.equal(Number.isInteger(checkpoint), true);
  const checkpoints = ground.route.legs;
  const route = ground.route;
  assert.deepEqual(enemies(battle, owner, { scope: 'field', groundOnly: true, count: 3 }).map(e => e.id).sort(), [ground.id, bound.id].sort());
  assert.equal(battle.assaultTeleportEnemy(flyer, owner), false);
  assert.equal(battle.assaultTeleportEnemy(bound, owner), false);
  assert.equal(battle.assaultTeleportEnemy(ground, owner), true);
  assert.deepEqual([ground.y, ground.x], [owner.tileR, owner.tileC]);
  assert.equal(ground.route, route);
  assert.equal(ground.route.legIdx, checkpoint);
  assert.equal(ground.route.legs, checkpoints);
  assert.equal(ground.route.pts, null);
  assert.equal(ground.blockedBy, null);
  assert.ok(battle.enemiesInKeys([owner.tileR * COLS + owner.tileC], owner, owner.profile).includes(ground));
});

test('deployment modifiers are resolved before DP payment and cannot return an invalid fee', () => {
  let paid;
  const { battle, owner } = makeBattle({ install: (b) => {
    b.assaultCostResolver = (_battle, _unit, cost) => cost - 9;
    if (b._fixtureFeeObserved) return;
    b._fixtureFeeObserved = true;
    b.on('deploy', (event) => { paid = event.actualPaid; });
  } });
  assert.equal(owner.deployed, true);
  assert.equal(paid, 0, 'the opening entry is free');
  assert.equal(battle.getPlayer(owner.ownerId).dp, 50);
  battle.retreat(owner, { reason: 'test' });
  assert.equal(battle.redeploy(owner, { free: false }), true);
  assert.equal(paid, 1, 'the redeploy fee is resolved through the modifier before payment');
  assert.equal(battle.getPlayer(owner.ownerId).dp, 49);
  assert.throws(() => makeBattle({ install: (b) => { b.assaultCostResolver = () => Infinity; } }), /Invalid assault deployment cost/);
});

test('Assault pushes report actual swept enemy contact and highland contact without guessing from shortened distance', () => {
  const { battle, owner } = makeBattle({ enemyCount: 3 });
  battle.step();
  const [pushed, blocker, offPath] = battle.enemies;
  Object.assign(pushed, { x: 6, y: 10, tileC: 6, tileR: 10 });
  Object.assign(blocker, { x: 7.25, y: 10, tileC: 7, tileR: 10 });
  Object.assign(offPath, { x: 7, y: 10.1, tileC: 7, tileR: 10 });
  const events = [];
  battle.assaultRuntime.observe('pushCollision', 'fixture-contact', (event) => events.push(event.payload));
  const collision = battle.assaultPushEnemy(pushed, owner, 3, { from: owner, dir: { x: 1, y: 0 }, fixed: true });
  assert.ok(Math.abs(collision.moved - 1.25) < 1e-8);
  assert.equal(collision.collision.kind, 'enemy');
  assert.equal(collision.collision.other, blocker);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, owner);
  assert.equal(events[0].target, pushed);
  assert.deepEqual([pushed.x, pushed.y], [blocker.x, blocker.y]);
  assert.equal(offPath.x, 7);
  pushed.s.flags.noDisplace = true;
  assert.deepEqual(battle.assaultPushEnemy(pushed, owner, 3), { moved: 0, collision: null });
  assert.equal(events.length, 1);

  const stage = flatStage();
  stage.rows[10] = `${stage.rows[10].slice(0, 8)}h${stage.rows[10].slice(9)}`;
  const wall = makeBattle({ enemyCount: 1, stage });
  wall.battle.step();
  const victim = wall.battle.enemies[0];
  Object.assign(victim, { x: 6, y: 10, tileC: 6, tileR: 10 });
  const result = wall.battle.assaultPushEnemy(victim, wall.owner, 3,
    { from: wall.owner, dir: { x: 1, y: 0 }, fixed: true });
  assert.equal(result.collision.kind, 'highland');
  assert.equal(result.collision.other, null);
  assert.ok(victim.x < 7.5);
});

test('owner timers cancel at their next deterministic tick when the owner leaves the field', () => {
  const { battle, owner } = makeBattle();
  let ticks = 0;
  const cancel = onTimer(battle, owner, battle.dt, () => { ticks++; }, { every: true });
  owner.alive = false;
  battle.step(); battle.step();
  assert.equal(ticks, 0);
  assert.equal(owner._assaultTimers.size, 0);
  cancel();
});

test('inactive owners cannot register post-effect timers and invalid timer arguments still fail', () => {
  const live = makeBattle();
  let liveTicks = 0;
  const cancelLive = onTimer(live.battle, live.owner, live.battle.dt, () => { liveTicks++; });
  for (let i = 0; i < 6 && liveTicks === 0; i++) live.battle.step();
  assert.ok(liveTicks > 0, 'active owner timer retains its normal tick cadence');
  cancelLive();

  const { battle, owner } = makeBattle();
  let ticks = 0;
  owner.alive = false;
  const cancel = onTimer(battle, owner, battle.dt, () => { ticks++; }, { every: true });
  assert.equal(typeof cancel, 'function');
  assert.equal(owner._assaultTimers?.size ?? 0, 0, 'no native timer is registered for an inactive owner');
  assert.deepEqual(battle.assaultRuntime.diagnostics.inactiveTimerSkips, [{
    uid: owner.uid, charId: CHAR, time: battle.time, seconds: battle.dt, every: true,
    alive: false, deployed: true, hidden: false, removed: false,
  }]);
  assert.throws(() => onTimer(battle, owner, 0, () => {}), /timer/);
  assert.throws(() => onTimer(battle, owner, battle.dt, null), /timer/);
  assert.throws(() => onTimer(battle, null, battle.dt, () => {}), /timer owner/);
  for (let i = 0; i < 3; i++) battle.step();
  assert.equal(ticks, 0, 'dead-owner callback is never executed');
  cancel();
});

test('extra recast preserves stored SP and the redeploy component honors explicit suppression', () => {
  const { battle, owner, kitState } = makeBattle();
  owner.skill.gainSp(5, 'gift');
  const before = owner.skill.spTotal;
  assert.equal(recast(battle, owner), true);
  assert.equal(owner.skill.spTotal, before);
  assert.equal(kitState.casts, 1);
  owner.hp = 1;
  assert.equal(redeploy(battle, owner, owner, { suppressRedeploy: true }), false);
  assert.equal(owner.hp, 1);
  assert.equal(redeploy(battle, owner), true);
  assert.equal(owner.hp, owner.s.maxHp);
});

test('DP wrappers return net values and permanent growth records already-scaled flat values once', () => {
  const { battle, owner } = makeBattle();
  const player = battle.players[0];
  const before = player.dp;
  assert.equal(payDP(battle, owner, 5, 'pay'), 5);
  assert.equal(gainDP(battle, owner, 20, 'gain'), Math.min(20, 99 - before + 5));
  assert.equal(persistGrowth(battle, owner, owner, { stat: 'maxHp', flat: 25, counterKey: 'hp' }), true);
  assert.equal(battle.assaultPermanentEffects[0].amount, 25);
  assert.equal(persistGrowth(battle, owner, owner, { stat: 'maxHp', flat: 1, oncePerRun: true, claimKey: 'one-time' }), true);
  assert.equal(persistGrowth(battle, owner, owner, { stat: 'maxHp', flat: 1, oncePerRun: true, claimKey: 'one-time' }), false);
});

test('summon inventory is shared per owner, field capacity queues stock, and frees retry it', () => {
  const { battle, owner } = makeBattle();
  const ledger = ledgerFor(battle, owner);
  const result = grantSummon(battle, owner, { tokenId: TOKEN, count: 2, stockCap: 2, fieldCap: 1, derivedKey: 'fixture', ruleKey: 'skill' });
  assert.deepEqual(result, { granted: 2, spawned: 1, pending: 1, rejected: 0 });
  assert.equal(ledger.stock.get(TOKEN), 1);
  assert.equal(ledger.activeByKey.size, 1);
  const token = [...ledger.activeByKey.values()][0].unit;
  assert.equal(returnSummon(battle, owner, token), true);
  assert.equal(ledger.activeByKey.size, 1);
  assert.equal(ledger.pending.length, 0);
  const secondOwner = { ...owner, uid: 'owner-2' };
  assert.notEqual(ledgerFor(battle, secondOwner), ledger);
});

test('summon grants retry from natural Battle DP and reject stock at its cap', () => {
  const { battle, owner } = makeBattle();
  const player = battle.players[0];
  player.dp = 0;
  const result = grantSummon(battle, owner, { tokenId: TOKEN, count: 1, stockCap: 1, fieldCap: 1, cost: 2, ruleKey: 'dp' });
  assert.equal(result.pending, 1);
  assert.equal(battle.allyUnits.filter((x) => x.kind === 'token' && x.alive).length, 0);
  assert.equal(player.playerId, owner.ownerId);
  for (let i = 0; i < 100 && !battle.allyUnits.some((x) => x.kind === 'token' && x.alive); i++) battle.step();
  assert.equal(battle.allyUnits.filter((x) => x.kind === 'token' && x.alive).length, 1);
  const queued = grantSummon(battle, owner, { tokenId: TOKEN, count: 1, stockCap: 1, fieldCap: 1, cost: 2, ruleKey: 'dp' });
  assert.deepEqual(queued, { granted: 1, spawned: 0, pending: 1, rejected: 0 });
  assert.equal(grantSummon(battle, owner, { tokenId: TOKEN, count: 1, stockCap: 1, fieldCap: 1, cost: 2, ruleKey: 'dp' }).granted, 0);
});

test('native deployment cost hooks compose after the resolver, quote without consuming, and charge once', () => {
  const { battle, owner } = makeBattle();
  let stock = 1;
  const paid = [];
  battle.assaultCostResolver = (_battle, _unit, cost) => cost - 1;
  battle.on('assaultDeploymentCost', (quote) => { if (quote.unit.kind === 'op' && stock) quote.amount = Math.max(0, quote.amount - 2); });
  battle.on('deploy', (event) => {
    if (event.unit === owner && !event.skillEntry) { stock--; paid.push(event.actualPaid); }
  });
  assert.equal(battle.assaultDeploymentCost(owner), 7);
  assert.equal(battle.assaultDeploymentCost(owner), 7);
  assert.equal(stock, 1);
  battle.kill(owner);
  battle.players[0].dp = 6;
  assert.equal(battle.redeploy(owner, { free: false }), false);
  assert.equal(stock, 1);
  battle.players[0].dp = 20;
  assert.equal(battle.redeploy(owner, { free: false }), true);
  assert.equal(stock, 0);
  assert.equal(battle.players[0].dp, 13);
  assert.deepEqual(paid, [7]);
  assert.equal(battle.assaultDeploymentCost(owner), 9);
});

test('native summon price is paid once and uses the real pre-fee discount', () => {
  for (const discount of [0, 2]) {
    const { battle, owner } = makeBattle({ tokenCost: 5 });
    const player = battle.players[0];
    player.dp = (5 - discount) * 2;
    battle.assaultCostResolver = (_battle, unit, cost) => unit.kind === 'token' ? cost - discount : cost;
    const result = grantSummon(battle, owner, { tokenId: TOKEN, count: 5, stockCap: 5, fieldCap: 5, cost: 5 });
    assert.equal(result.spawned, 2);
    assert.equal(result.pending, 3);
    assert.equal(player.dp, 0);
    assert.equal(ledgerFor(battle, owner).stock.get(TOKEN), 3);
    assert.equal(battle.allyUnits.filter((unit) => unit.kind === 'token').length, 2, 'unpaid requests create no phantom unit');
  }
});

test('owned summon requests consume saved positions and native facing in order', () => {
  const { battle, owner } = makeBattle();
  owner.def.raw.assaultPiece = { summonPresets: [
    { tokenId: TOKEN, row: 10, col: 8, dir: 'UP' }, { tokenId: TOKEN, row: 10, col: 7, dir: 'LEFT' },
  ] };
  grantSummon(battle, owner, { tokenId: TOKEN, count: 2, stockCap: 2, fieldCap: 2 });
  const tokens = [...ledgerFor(battle, owner).activeByKey.values()].map((entry) => entry.unit);
  assert.deepEqual(tokens.map((unit) => [unit.tileR, unit.tileC, unit.dir]), [[10, 8, 'UP'], [10, 7, 'LEFT']]);
});

test('summon source placement respects owner range, outside range, and ranged-only terrain', () => {
  for (const constraints of [{ ownerRange: true }, { ownerRangeOutside: true }]) {
    const { battle, owner } = makeBattle({ tokenOverrides: constraints });
    owner.def.raw.assaultPiece = { summonPresets: [
      { tokenId: TOKEN, row: 10, col: 6, dir: 'RIGHT' }, { tokenId: TOKEN, row: 10, col: 8, dir: 'UP' },
    ] };
    assert.equal(owner.rangeKeySet.has(10 * COLS + 6), true);
    assert.equal(owner.rangeKeySet.has(10 * COLS + 8), false);
    grantSummon(battle, owner, { tokenId: TOKEN, count: 1, stockCap: 1, fieldCap: 1 });
    const token = [...ledgerFor(battle, owner).activeByKey.values()][0].unit;
    assert.equal(token.tileC, constraints.ownerRange ? 6 : 8);
  }
  const { battle, owner } = makeBattle({ tokenOverrides: { position: 'RANGED', rangedTilesOnly: true } });
  owner.def.raw.assaultPiece = { summonPresets: [
    { tokenId: TOKEN, row: 10, col: 8, dir: 'RIGHT' }, { tokenId: TOKEN, row: 10, col: 2, dir: 'UP' },
  ] };
  grantSummon(battle, owner, { tokenId: TOKEN, count: 1, stockCap: 1, fieldCap: 1 });
  const token = [...ledgerFor(battle, owner).activeByKey.values()][0].unit;
  assert.deepEqual([token.tileR, token.tileC, token.dir], [10, 2, 'UP']);
});

test('a summon waits at its manually selected occupied tile instead of falling back elsewhere',()=>{
  const {battle,owner}=makeBattle({players:[{playerId:'p1',units:[
    {uid:'owner-1',chessId:CHESS,row:10,col:5},{uid:'blocker',chessId:CHESS,row:10,col:6}]}]});
  owner.def.raw.assaultPiece={summonPresets:[{tokenId:TOKEN,row:10,col:6,dir:'UP'}]};
  const result=grantSummon(battle,owner,{tokenId:TOKEN,count:1,stockCap:1,fieldCap:1});
  assert.equal(result.spawned,0);assert.equal(result.pending,1);
  assert.equal(battle.allyUnits.filter(unit=>unit.kind==='token').length,0);
  battle.retreat(battle.allyUnits.find(unit=>unit.uid==='blocker'),{permanent:true});
  battle.step();battle.assaultRuntime.flush();
  const token=[...ledgerFor(battle,owner).activeByKey.values()][0]?.unit;
  assert.ok(token);assert.deepEqual([token.tileR,token.tileC,token.dir],[10,6,'UP']);
});

test('owner death and retreat clear active summons but preserve unpaid stock for actual redeployment', () => {
  for (const reason of ['death', 'retreat']) {
    const { battle, owner } = makeBattle();
    grantSummon(battle, owner, { tokenId: TOKEN, count: 2, stockCap: 2, fieldCap: 1 });
    const ledger = ledgerFor(battle, owner);
    const first = [...ledger.activeByKey.values()][0].unit;
    if (reason === 'death') battle.kill(owner);
    else battle.retreat(owner);
    assert.equal(first.alive, false);
    assert.equal(ledger.activeByKey.size, 0);
    assert.equal(ledger.closed, true);
    assert.equal(ledger.stock.get(TOKEN), 1);
    assert.equal(ledger.pending.length, 1);
    battle.step();
    assert.equal(ledger.pending.length, 1);
    const dp = battle.players[0].dp;
    assert.equal(battle.redeploy(owner, { free: false }), true);
    battle.assaultRuntime.flush();
    assert.equal(battle.players[0].dp, dp - owner.base.cost);
    assert.equal(ledger.closed, false);
    assert.equal(ledger.activeByKey.size, 1);
    assert.equal(ledger.stock.get(TOKEN), 0);
    assert.equal(ledger.pending.length, 0);
    assert.notEqual([...ledger.activeByKey.values()][0].unit, first);
    assert.doesNotThrow(() => ledger.dispose());
  }
});

test('fusion absorbs two owned summons without a death event and applies exact scaled source stats', () => {
  const { battle, owner } = makeBattle();
  const granted = grantSummon(battle, owner, { tokenId: TOKEN, count: 2, stockCap: 2, fieldCap: 3, ruleKey: 'small' });
  assert.equal(granted.spawned, 2);
  const ledger = ledgerFor(battle, owner);
  const [a,b] = [...ledger.activeByKey.values()].map((x) => x.unit);
  a.base.atk = 20; b.base.atk = 30; a.markDirty(); b.markDirty();
  battle.addBuff(a, { key: 'fusion-source-a', mods: { atkPct: .3, hpMul: 1.3, defFlat: 10, resFlat: 5, aspd: 15 }, flags: { resist: true } });
  battle.addBuff(b, { key: 'fusion-source-b', mods: { atkPct: .6, hpMul: 1.5, defFlat: 20, resFlat: 10 } });
  a.hp = a.s.maxHp * .4; b.hp = b.s.maxHp * .6;
  const expectedAtk = (a.s.atk + b.s.atk) * 1.8;
  const expectedHp = (a.hp + b.hp) * 1.8;
  const expectedMaxHp = (a.s.maxHp + b.s.maxHp) * 1.8;
  const expectedDef = (a.s.def + b.s.def) * 1.8;
  const expectedRes = (a.s.res + b.s.res) * 1.8;
  const keepUid = uid(a), absorbedUid = uid(b), keepTile = [a.tileR, a.tileC];
  const deaths = [];
  const absorbed = [];
  battle.assaultRuntime.observe('summonDied', 'fusion-death-proof', (event) => deaths.push(event.payload.targetUid));
  battle.assaultRuntime.observe('summonAbsorbed', 'fusion-absorb-proof', (event) => absorbed.push(event.payload.targetUid));
  const fused = fuseSummons(battle, owner, a, b, { tokenId: TOKEN, derivedKey: 'ling-fused-fixture', kit: {}, sourceTemplateId: TOKEN, capacity: 3 });
  assert.ok(fused, JSON.stringify({ active: ledger.activeByKey.size, stock: ledger.stock.get(TOKEN), pending: ledger.pending.length, units: battle.allyUnits.map((x) => [x.kind,x.alive,x.deployed,x.tileR,x.tileC]) }));
  assert.equal(deaths.length, 0);
  assert.deepEqual(absorbed, [absorbedUid]);
  assert.equal(uid(fused), keepUid);
  assert.deepEqual([fused.tileR, fused.tileC], keepTile);
  assert.equal(fused.base.atk, expectedAtk);
  assert.equal(fused.s.atk, expectedAtk);
  assert.equal(fused.s.maxHp, expectedMaxHp);
  assert.equal(fused.hp, expectedHp);
  assert.equal(fused.s.def, expectedDef);
  assert.equal(fused.s.res, expectedRes);
  assert.equal(fused.s.aspd, fused.base.aspd + 15);
  assert.equal(fused.s.flags.resist, true);
  assert.equal(ledger.activeByKey.size, 1);
});

test('workshop derived platform uses already-scaled owner stats and module cap', () => {
  const { battle, owner } = makeBattle();
  const platform = deriveWorkshopPlatform(battle, owner, { tokenId: TOKEN, derivedKey: 'platform', kit: {}, sourceTemplateId: TOKEN, relicId: 'relic-fixture' });
  assert.equal(platform.spawned, 1);
  assert.equal(platform.stats.maxHp, owner.s.maxHp * 0.75);
  assert.equal(platform.stats.atk, owner.s.atk * 1.5);
  assert.equal(platform.stats.blockCnt, 0);
  const entry = [...ledgerFor(battle, owner).activeByKey.values()][0];
  assert.equal(entry.unit.base.bat, 2.5);
  assert.equal(entry.unit.duration, undefined);
  assert.equal(deriveWorkshopPlatform(battle, owner, { tokenId: TOKEN, derivedKey: 'platform', kit: {}, sourceTemplateId: TOKEN, relicId: 'relic-fixture' }).spawned, 1);
  assert.deepEqual(deriveWorkshopPlatform(battle, owner, { tokenId: TOKEN, derivedKey: 'platform', kit: {}, sourceTemplateId: TOKEN, relicId: 'relic-fixture' }), { granted: 0, reason: 'moduleCap' });
});

test('ordinary passive damage observers do not bypass the event runtime', () => {
  const { battle, owner } = makeBattle();
  let count = 0;
  watch(battle, owner, 'fixture', 'observer', () => true, () => { count++; });
  battle.assaultRuntime.publish('fixture', { sourceUid: owner.uid, targetUid: owner.uid });
  battle.assaultRuntime.flush();
  assert.equal(count, 1);
  assert.equal(active(owner), true);
});

test('owned derived devices keep their real owner and leave on expiry or owner retreat', () => {
  const { battle, owner } = makeBattle();
  const first = battle.spawnDevice('fixture-owner-device', 10, 7, { ownerUnit: owner, sourceKey: 'fixture:device', duration: .1, hp: 500, blockCnt: 0 });
  assert.equal(first.ownerUnit, owner);
  assert.equal(first.ownerId, owner.ownerId);
  assert.equal(first.mem.assaultDeviceSourceKey, 'fixture:device');
  assert.equal(first.s.blockCnt, 0);
  for (let i = 0; i < 5; i++) battle.step();
  assert.equal(first.alive, false);
  assert.equal(first.removeReason, 'expiry');
  const second = battle.spawnDevice('fixture-owner-device', 10, 7, { ownerUnit: owner, duration: 60, hp: 500, blockCnt: 0 });
  battle.retreat(owner);
  assert.equal(second.alive, false);
  assert.equal(second.removeReason, 'ownerRemoved');
  assert.equal(battle.errorCount, 0);
});
