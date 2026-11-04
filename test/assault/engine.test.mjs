import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { buildAssaultKit } from '../../server/sim/content/assault/index.js';

const CHESS_ID = 'chess_assault_fixture_a';
const CHAR_ID = 'char_assault_fixture';
const TOKEN_ID = 'token_assault_fixture';

function tokenRec() {
  return {
    tokenId: TOKEN_ID, name: 'fixture token', profession: 'TOKEN', position: 'MELEE',
    stats: { maxHp: 400, atk: 20, def: 0, res: 0, cost: 0, blockCnt: 1, bat: 1, aspd: 100, respawnTime: 0, spRecovery: 0 },
    rangeGrid: [[0, 0]],
  };
}

function makeAssault({ skill = {}, cost = 10, builder = null, kitsOverride = null, token = false, stage = flatStage(), flags = {}, install = null } = {}) {
  const chess = chessRec({
    id: CHESS_ID, charId: CHAR_ID, profession: 'WARRIOR', stats: { cost },
    skill: { skillId: 'sk_assault_fixture', spCost: 0.5, initSp: 0, spType: 'INCREASE_WITH_TIME', ...skill },
  });
  const enemies = enemyRec({ key: 'enemy_assault_fixture', hp: 1000000, speed: 0, def: 0, res: 0 });
  const data = new DataSource({
    chess: { [CHESS_ID]: chess },
    enemies: { [enemies.key]: enemies },
    tokens: { [TOKEN_ID]: tokenRec() },
  }, getDefaultSource());
  const state = { casts: 0, installs: 0, assaultInstalls: 0 };
  const defaultBuilder = () => ({
    skill: {
      id: 'assault-fixed', kind: 'instant', spCost: 0.5, trigger: 'SP_FULL', ...skill,
      assaultCast: (ctx) => { state.casts++; state.lastCast = ctx; },
    },
    install: () => { state.installs++; },
  });
  const kits = kitsOverride ?? (token ? { [TOKEN_ID]: builder ?? defaultBuilder } : { [CHAR_ID]: builder ?? defaultBuilder, [TOKEN_ID]: () => ({}) });
  const unit = token
    ? { uid: 'token-1', kind: 'token', tokenId: TOKEN_ID, row: 10, col: 5 }
    : { uid: 'op-1', chessId: CHESS_ID, row: 10, col: 5 };
  const battle = new Battle({
    kind: 'normal', modeId: 'assault-test', stage, routes: flatRoutes(), data,
    players: [{ playerId: 'p1', units: [unit], bonds: { legacy_fixture: { layers: 7 } } }],
    content: 'assault', assault: {
      kits, strict: true,
      install: (b) => { state.assaultInstalls++; state.preUnitSetupKit = b.allyUnits[0]?.kit ?? null; install?.(b); },
    },
    flags: { dpInit: 50, dpPerSec: 1, dpMax: 99, startOpCooldown: 3, ...flags },
    autoFinish: false, timeLimit: 120, quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} },
  });
  return { battle, state, data };
}

test('assault setup is exact and strict for missing registry, key, spec, builder, and token builder', () => {
  assert.throws(() => new Battle({ content: 'assault', assault: { strict: true }, players: [], quiet: true }), /kit registry/);
  assert.throws(() => makeAssault({ kitsOverride: {} }), /missing exact key/);
  assert.throws(() => makeAssault({ builder: () => { throw new Error('kit boom'); } }), /kit boom/);
  assert.throws(() => makeAssault({ builder: () => ({}) }), /missing its fixed skill spec/);
  assert.throws(() => makeAssault({ builder: () => ({ skill: { id: 'missing-handler' } }) }), /missing assaultCast handler/);
  assert.throws(() => makeAssault({ token: true, builder: () => { throw new Error('token kit boom'); } }), /token kit boom/);
});

test('assault uses only its caller kit, installs once, filters old reward devices, and pays real initial DP', () => {
  const stage = { ...flatStage(), devices: [
    { key: 'coldWind', pos: [9, 4], active: true },
    { key: 'reward_turret', pos: [9, 5], active: true },
    { key: 'trap_1105_accrate', pos: [9, 6], role: 'crate', active: true },
  ] };
  const { battle, state } = makeAssault({ stage, install: (b) => assert.equal(b.allyUnits[0].kit, null) });
  assert.equal(state.assaultInstalls, 1);
  assert.equal(state.installs, 1);
  assert.equal(state.preUnitSetupKit, null);
  assert.deepEqual(battle.stage.devices.map((d) => d.key), ['trap_1105_accrate']);
  assert.equal(battle._hooks.layerGain, undefined);
  assert.equal(battle.allyUnits[0].kit.skill.id, 'assault-fixed');
  battle.start();
  assert.equal(battle.players[0].dp, 50, 'the opening entry is free: the real initial DP is untouched');
  assert.equal(battle.allyUnits[0].alive, true);
  assert.equal(state.installs, 1);
});

test('a ready half-SP skill resolves at its action check without attack, nextCastAt, or op cooldown', () => {
  const { battle, state } = makeAssault({ skill: { spCost: 0.5, initSp: 0.5 } });
  const unit = battle.allyUnits[0];
  battle.start();
  unit.skill.nextCastAt = Infinity;
  unit.skill.opReadyAt = Infinity;
  battle.step();
  assert.equal(state.casts, 1);
  assert.equal(unit.skill.nextCastAt, Infinity);
  assert.equal(unit.skill.charges, 0);
  assert.equal(unit.skill.sp, 0);
  assert.equal(unit.stats.attacks, 0);
});

test('SP gains return net capacity, publish no full-bar gain, and never cast inside gainSp', () => {
  const { battle, state } = makeAssault({ skill: { spCost: 0.5, charges: 2, canCast: () => false } });
  battle.start();
  const unit = battle.allyUnits[0];
  const received = [];
  battle.assaultRuntime.observe('spReceived', 'capture-sp', (event) => received.push(event.payload.amount));
  assert.equal(unit.skill.gainSp(0.75, 'grant'), 0.75);
  assert.equal(state.casts, 0);
  assert.equal(unit.skill.gainSp(2, 'grant'), 0.25);
  assert.equal(unit.skill.gainSp(1, 'grant'), 0);
  assert.deepEqual(received, [0.75, 0.25]);
  assert.equal(unit.skill.spTotal, 1);
  assert.equal(unit.skill.charges, 2);
});

test('causal FIFO siblings retain independent target visits and same-path observers stop recurring', () => {
  const { battle } = makeAssault();
  const runtime = battle.assaultRuntime;
  const seen = [];
  runtime.observe('branches', 'fan-out', (event, rt) => {
    for (const targetUid of event.payload.targetUids) {
      rt.enqueue((queue) => queue.publish('effect', { targetUid }), { key: 'passive', targetUid });
    }
  });
  runtime.observe('effect', 'loop-guard', (event, rt) => {
    rt.enqueue((queue) => queue.publish('effect', { targetUid: event.payload.targetUid }), { key: 'loop-guard', targetUid: event.payload.targetUid });
  });
  runtime.observe('effect', 'capture-effect', (event) => seen.push(event));
  const root = runtime.publish('branches', { targetUids: ['left', 'right'] });
  assert.equal(runtime.flush(), 4);
  assert.equal(seen.length, 4);
  for (const targetUid of ['left', 'right']) {
    const pair = seen.filter((event) => event.payload.targetUid === targetUid);
    assert.equal(pair.length, 2);
    assert.ok(pair.every((event) => event.cause.rootId === root.cause.rootId));
    assert.ok(pair.every((event) => event.cause.visited.some((v) => v.key === 'passive' && v.targetUid === targetUid)));
    assert.ok(pair.every((event) => !event.cause.visited.some((v) => v.key === 'passive' && v.targetUid !== targetUid)));
  }
  assert.throws(() => runtime.enqueue(null), /must be a function/);
});

test('successful repeated statuses publish each time while immune applications do not', () => {
  const { battle } = makeAssault();
  const attacker = battle.allyUnits[0];
  const target = battle.spawnEnemy('enemy_assault_fixture', { pos: [9, 8] });
  const statuses = [];
  battle.assaultRuntime.observe('statusApplied', 'capture-status', (event) => statuses.push(event.payload.status));
  assert.equal(battle.applyStatus(target, 'freeze', { duration: 2, source: attacker }), true);
  assert.equal(battle.applyStatus(target, 'freeze', { duration: 2, source: attacker }), true);
  target.def.immune.add('stun');
  assert.equal(battle.applyStatus(target, 'stun', { duration: 2, source: attacker }), false);
  assert.deepEqual(statuses, ['frozen', 'frozen']);
  assert.equal(target.s.flags.freeze, true);
  assert.equal(target.s.flags.stun, true);
});

test('the assault event bridge reports actual attacks, damage, healing, shields, skills, ammo, and summon lifecycle', () => {
  const { battle } = makeAssault();
  const events = new Map();
  const names = [
    'attack', 'hit', 'damageTaken', 'heal', 'hpRegen', 'shieldGained', 'shieldBroken', 'spReceived',
    'skillStart', 'skillResolved', 'ammoUsed', 'reloaded', 'deployed', 'redeploy', 'kill', 'death', 'summonSpawned', 'summonDied',
  ];
  for (const name of names) {
    events.set(name, []);
    battle.assaultRuntime.observe(name, `capture-${name}`, (event) => events.get(name).push(event));
  }
  battle.start();
  const unit = battle.allyUnits[0];
  const enemy = battle.spawnEnemy('enemy_assault_fixture', { pos: [9, 8] });
  assert.equal(battle.forceAttack(unit, [enemy]), true);
  assert.equal(events.get('attack').length, 1);
  assert.equal(events.get('hit').length, 1);
  assert.ok(events.get('damageTaken')[0].payload.amount > 0);
  assert.equal(events.get('attack')[0].payload.attackId, battle._attackSeq);

  unit.hp -= 25;
  assert.equal(battle.heal(unit, unit, 10), 10);
  assert.equal(battle.heal(unit, unit, 10, { regen: true }), 10);
  assert.equal(events.get('heal').length, 1);
  assert.equal(events.get('hpRegen').length, 1);
  battle.addBuff(unit, { key: 'event-shield', shield: 20, source: unit });
  assert.equal(events.get('shieldGained').length, 1);
  battle.dealDamage(enemy, unit, { amount: 20, type: 'true' });
  assert.equal(events.get('shieldBroken').length, 1);
  assert.equal(events.get('damageTaken').length, 1);

  unit.skill.gainSp(0.5, 'grant');
  assert.equal(events.get('spReceived').at(-1).payload.amount, 0.5);
  assert.equal(battle.assaultRuntime.cast(unit), true);
  assert.equal(events.get('skillStart').length, 1);
  assert.equal(events.get('skillResolved').length, 1);
  unit.skill.kind = 'ammo'; unit.skill.active = true; unit.skill.ammoLeft = 2; unit.skill.ammoMax = 2;
  assert.equal(battle.forceAttack(unit, [enemy]), true);
  assert.equal(events.get('ammoUsed').length, 1);
  battle.emit('reloaded', { unit, amount: 2, skill: unit.skill });
  assert.equal(events.get('reloaded').length, 1);

  const token = battle.spawnToken(unit, TOKEN_ID, 10, 6);
  assert.ok(token);
  assert.equal(events.get('summonSpawned').length, 1);
  battle.kill(token, unit);
  assert.equal(events.get('summonDied').length, 1);
  assert.equal(events.get('death').length, 1);
  assert.equal(events.get('kill').length, 1);
});

test('enemy elemental overflow repeats bursts, retains remainder, and stacks independent burst instances', () => {
  const { battle } = makeAssault();
  const source = battle.allyUnits[0];
  const target = battle.spawnEnemy('enemy_assault_fixture', { pos: [9, 8] });
  const bursts = [];
  battle.assaultRuntime.observe('elementBurst', 'capture-burst', (event) => bursts.push(event.payload));
  assert.equal(battle.dealDamage(source, target, { type: 'element', element: 'burn', amount: 2500, isSkill: true, attackId: 17 }), 2500);
  assert.equal(target.elem.burn, 500);
  assert.equal(bursts.length, 2);
  assert.notEqual(bursts[0].instanceId, bursts[1].instanceId);
  assert.equal(target.s.flags.burstLock, undefined);
  assert.equal(battle.dealDamage(source, target, { type: 'element', element: 'neural', amount: 1000, attackId: 18 }), 1000);
  assert.equal(target.elem.neural, 0);
  assert.equal(bursts.length, 3);
  assert.equal(target.buffs.filter((buff) => buff.key.endsWith(':palsy')).length, 1);
  assert.equal(battle.dealDamage(source, target, { type: 'element', element: 'neural', amount: 1000, attackId: 19 }), 1000);
  assert.equal(bursts.length, 4);
  assert.equal(target.buffs.filter((buff) => buff.key.endsWith(':palsy')).length, 2);
});

test('opening entry is free even when DP is short; only the later redeploy charges the current modified fee', () => {
  const { battle } = makeAssault({ cost: 60, flags: { dpInit: 50 } });
  const unit = battle.allyUnits[0];
  const paid = [];
  battle.assaultRuntime.observe('deployed', 'capture-deploy', (event) => paid.push(event.payload.actualPaid));
  battle.start();
  assert.equal(unit.alive, true, 'every unit of the field deploys at second 0');
  assert.equal(unit.mem.assaultPendingEntry, false);
  assert.equal(battle.players[0].dp, 50);
  battle.kill(unit);
  unit.respawnAt = 0;
  unit.mem.assaultCostDelta = -5;
  battle._checkRedeploys();
  assert.equal(unit.alive, false, 'the redeploy waits for DP: 50 < 55');
  battle.addDp('p1', 20);
  battle._checkRedeploys();
  assert.equal(unit.alive, true);
  assert.equal(battle.players[0].dp, 15);
  assert.deepEqual(paid, [0, 55]);
  assert.equal(battle.assaultDeploymentCost(unit), 55);
});

test('live skill redeploy preserves runtime state; dead skill redeploy performs one free real deployment', () => {
  const { battle, state } = makeAssault({ skill: { kind: 'ammo', ammo: 6, duration: 20 } });
  const unit = battle.allyUnits[0];
  battle.start();
  const skill = unit.skill;
  skill.active = true;
  skill.timeLeft = 12;
  skill.ammoLeft = 4;
  skill.ammoMax = 6;
  skill.sp = 0.25;
  skill.charges = 1;
  unit.atkCd = 0.75;
  unit.hp = 50;
  const status = battle.addBuff(unit, { key: 'assault-fixture-status', duration: 12, visible: true, status: 'fixture' });
  const seq = unit.deploySeq;
  const dp = battle.players[0].dp;
  const redeploys = [];
  const deployments = [];
  battle.assaultRuntime.observe('redeploy', 'capture-redeploy', (event) => redeploys.push(event.payload));
  battle.assaultRuntime.observe('deployed', 'capture-real-deploy', (event) => deployments.push(event.payload));
  assert.equal(battle.skillRedeploy(unit), true);
  assert.equal(unit.hp, unit.s.maxHp);
  assert.equal(unit.skill, skill);
  assert.deepEqual([skill.active, skill.timeLeft, skill.ammoLeft, skill.ammoMax, skill.sp, skill.charges, unit.atkCd], [true, 12, 4, 6, 0.25, 1, 0.75]);
  assert.equal(unit.findBuff('assault-fixture-status'), status);
  assert.equal(unit.deploySeq, seq);
  assert.equal(battle.players[0].dp, dp);

  battle.kill(unit, null);
  const deadSeq = unit.deploySeq;
  assert.equal(battle.skillRedeploy(unit), true);
  assert.equal(unit.alive, true);
  assert.equal(unit.deploySeq, deadSeq + 1);
  assert.equal(battle.players[0].dp, dp);
  assert.equal(redeploys.length, 2);
  assert.equal(redeploys[0].alive, true);
  assert.equal(redeploys[1].alive, false);
  assert.equal(redeploys[1].actualPaid, 0);
  // 再部署 (user definition 10-21): the live one is in place and fires the 部署时 effects again; the dead one deploys
  assert.equal(deployments.length, 2);
  assert.equal(deployments[0].inPlace, true);
  assert.equal(deployments[1].inPlace ?? false, false);
  assert.equal(state.installs, 1);
});

test('extra forced casts preserve skill state and suppress only that invocation\'s redeploy', () => {
  let battleRef;
  const builder = () => ({
    skill: {
      id: 'extra-fixed', kind: 'ammo', spCost: 0.5, ammo: 5,
      assaultCast: (ctx) => { if (!ctx.suppressRedeploy) battleRef.skillRedeploy(ctx.unit); },
    },
  });
  const built = makeAssault({ builder });
  battleRef = built.battle;
  const { battle } = built;
  const unit = battle.allyUnits[0];
  battle.start();
  const skill = unit.skill;
  skill.active = true; skill.timeLeft = 9; skill.ammoLeft = 3; skill.ammoMax = 5; skill.charges = 1; skill.sp = 0.25;
  unit.hp = 40;
  battle.addBuff(unit, { key: 'forced-stun', flags: { stun: true }, duration: 5 });
  const seen = [];
  battle.assaultRuntime.observe('redeploy', 'count-extra-redeploy', (event) => seen.push(event.payload));
  assert.equal(battle.assaultRuntime.cast(unit, { extra: true, force: true, suppressRedeploy: true }), true);
  assert.deepEqual([skill.active, skill.timeLeft, skill.ammoLeft, skill.ammoMax, skill.charges, skill.sp], [true, 9, 3, 5, 1, 0.25]);
  assert.equal(unit.hp, 40);
  assert.equal(seen.length, 0);
  assert.equal(battle.assaultRuntime.cast(unit, { extra: true, force: true, suppressRedeploy: false }), true);
  assert.equal(unit.hp, unit.s.maxHp);
  assert.equal(seen.length, 1);
  assert.equal(unit.s.flags.stun, true);
});


test('assault hit events represent successful contact after dodge and shield mitigation', () => {
  const { battle } = makeAssault(); battle.start();
  const source = battle.allyUnits[0], target = battle.spawnEnemy('enemy_assault_fixture', { pos: [9, 8] });
  const hits = [], absorbed = [], broken = [];
  battle.assaultRuntime.observe('hit', 'capture-contact-hit', e => hits.push(e.payload));
  battle.assaultRuntime.observe('shieldAbsorbed', 'capture-absorb', e => absorbed.push(e.payload));
  battle.assaultRuntime.observe('shieldBroken', 'capture-break', e => broken.push(e.payload));
  battle.addBuff(target, { key: 'contact-shield', shield: 100 });
  assert.equal(battle.dealDamage(source, target, { amount: 10, type: 'true' }), 0);
  assert.equal(hits.at(-1).amount, 0);
  assert.equal(absorbed.at(-1).amount, 10);
  assert.equal(broken.length, 0);
  battle.dealDamage(source, target, { amount: 90, type: 'true' });
  assert.equal(hits.at(-1).amount, 0);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].amount, 90);
  const dodgeTarget = battle.spawnEnemy('enemy_assault_fixture', { pos: [9, 9] });
  battle.addBuff(dodgeTarget, { key: 'certain-dodge', mods: { dodgePhys: 1 } });
  const before = hits.length;
  assert.equal(battle.dealDamage(source, dodgeTarget, { amount: 100, type: 'phys' }), 0);
  assert.equal(hits.length, before);
});

test('ordinary redeploy charges DP while skill redeploy stays free', () => {
  const { battle } = makeAssault({ cost: 10 }); const unit = battle.allyUnits[0]; battle.start();
  battle.kill(unit); battle.players[0].dp = 25;
  assert.equal(battle.redeploy(unit, { free: false }), true);
  assert.equal(battle.players[0].dp, 15);
  battle.kill(unit); battle.players[0].dp = 5;
  assert.equal(battle.redeploy(unit, { free: false }), false);
  assert.equal(battle.players[0].dp, 5);
  assert.equal(battle.skillRedeploy(unit), true);
  assert.equal(battle.players[0].dp, 5);
});

test('resolved events wait for direct and derived cast effects, with child casts resolving first', () => {
  let battleRef;
  const builder = () => ({ skill: { id: 'causal-order', kind: 'instant', spCost: 0.5,
    assaultCast: (ctx) => {
      const rt = battleRef.assaultRuntime;
      if (ctx.extra) { rt.publish('effectMark', { label: 'extraDamage' }); return; }
      rt.publish('effectMark', { label: 'normalDamage' });
      rt.enqueue((queue) => { queue.publish('effectMark', { label: 'derivedDamage' }); queue.cast(ctx.unit, { extra: true, force: true }); });
    } } });
  const built = makeAssault({ builder, skill: { initSp: 0.5 } }); battleRef = built.battle;
  const { battle } = built; battle.start();
  const order = [];
  battle.assaultRuntime.observe('effectMark', 'capture-causal-order', e => order.push(e.payload.label));
  battle.assaultRuntime.observe('skillResolved', 'capture-causal-resolve', e => order.push(e.payload.extra ? 'extraResolved' : 'normalResolved'));
  assert.equal(battle.assaultRuntime.cast(battle.allyUnits[0]), true);
  assert.deepEqual(order, ['normalDamage', 'derivedDamage', 'extraDamage', 'extraResolved', 'normalResolved']);
});

test('each independent assault action check can use one full charge in the same frame', () => {
  const { battle, state } = makeAssault({ skill: { charges: 2, spCost: 0.5 } });
  const unit = battle.allyUnits[0]; battle.start();
  unit.skill.gainSp(1, 'grant');
  unit.skill.tick(0); unit.skill.tick(0);
  assert.equal(state.casts, 2);
  assert.equal(unit.skill.charges, 0);
});

test('assault kit accepts a genuine passive when source skill record is absent', () => {
  const { battle } = makeAssault(); const unit = battle.allyUnits[0];
  battle.opts.assault.kits[CHAR_ID] = () => ({ skill: { id: 'passive-no-source', kind: 'passive', onStart() {} } });
  const sourceLessUnit = { ...unit, def: { ...unit.def, skill: null } };
  assert.equal(buildAssaultKit(battle, sourceLessUnit).skill.kind, 'passive');
});

test('an eight-operator field is fully deployed at second 0 for free, whatever the starting DP', () => {
  const chess = chessRec({ id: CHESS_ID, charId: CHAR_ID, profession: 'WARRIOR', stats: { cost: 40 },
    skill: { skillId: 'sk_assault_fixture', spCost: 0.5, initSp: 0, spType: 'INCREASE_WITH_TIME' } });
  const data = new DataSource({ chess: { [CHESS_ID]: chess }, tokens: { [TOKEN_ID]: tokenRec() } }, getDefaultSource());
  const units = Array.from({ length: 8 }, (_, i) => ({ uid: `op-${i}`, chessId: CHESS_ID, row: 9 + (i % 4), col: 4 + Math.floor(i / 4) }));
  const battle = new Battle({ kind: 'normal', modeId: 'assault-test', stage: flatStage(), routes: flatRoutes(), data,
    players: [{ playerId: 'p1', units }], content: 'assault',
    assault: { kits: { [CHAR_ID]: () => ({ skill: { id: 'assault-fixed', kind: 'instant', spCost: 0.5, trigger: 'SP_FULL', assaultCast: () => {} } }), [TOKEN_ID]: () => ({}) }, strict: true },
    flags: { dpInit: 0, dpPerSec: 1, dpMax: 99, startOpCooldown: 3 }, autoFinish: false, timeLimit: 120,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  const ops = battle.allyUnits.filter((unit) => unit.kind === 'op');
  assert.equal(ops.length, 8);
  assert.ok(ops.every((unit) => unit.alive && unit.deployed && unit.mem.assaultPendingEntry === false), 'all 8 are on the field at t=0');
  assert.equal(battle.time, 0);
  assert.equal(battle.getPlayer('p1').dp, 0, 'no fee was charged, no debt was created');
  const order = ops.map((unit) => unit.deploySeq);
  assert.equal(new Set(order).size, 8, 'each unit has its own entry order');
});

test('a skill redeploy stays free and the opening entry leaves no pending debt', () => {
  const { battle } = makeAssault({ cost: 60, flags: { dpInit: 50 } }); const unit = battle.allyUnits[0];
  battle.start(); assert.equal(unit.mem.assaultPendingEntry, false);
  battle.kill(unit); unit.respawnAt = 20; battle.time = 0; battle._checkRedeploys();
  assert.equal(unit.alive, false, 'natural redeploy still waits for its timer');
  assert.equal(battle.skillRedeploy(unit), true);
  assert.equal(unit.mem.assaultPendingEntry, false);
  assert.equal(battle.players[0].dp, 50, 'skill redeploy costs nothing');
});
