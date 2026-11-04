import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { REDEPLOY_CHAIN as ASSAULT_REDEPLOY_CHAIN, REDEPLOY_CYCLE_DEFAULT } from '../../server/sim/content/assault/redeploy-cycle.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { applyStatus, damage, heal, buff } from '../../server/sim/content/assault/primitives.js';
import {
  statusName, hasStatus, relates, auraTargets, limiter, onTrigger, TRIGGER_KINDS, TRIGGER_FRAME_LIMIT, charge, accelerate, spAura,
  sustain, grantAirBlock, airBlockAura, airBlockSource, battleStack, runGrowth, redeployNow, redeployRemaining, cutRedeploy, deployEffect,
} from '../../server/sim/content/assault/synergy.js';
import { growthView, growthAmountText } from '../../public/js/assault/model.js';
import { setLang, setMessages, registerLangs } from '../../shared/i18n.js';
import { readFileSync } from 'node:fs';

const ENEMY = 'enemy_synergy';
const FLYER = 'enemy_synergy_fly';

/** Assault battle with fixture operators: `ops` = [{ id, profession, row, col, respawn, castOnDeploy }]. */
function makeBattle({ ops = [{ id: 'a' }], enemies = [], timeLimit = 300, redeployCycle } = {}) {
  const chess = {}, kits = {}, units = [];
  const casts = {};
  for (const [i, op] of ops.entries()) {
    const chessId = `chess_syn_${op.id}`, charId = `char_syn_${op.id}`;
    chess[chessId] = chessRec({ id: chessId, charId, profession: op.profession ?? 'WARRIOR', subProfessionId: op.sub ?? null,
      stats: { cost: 0, respawnTime: op.respawn ?? 20, blockCnt: 2, spRecovery: 1, maxHp: 2000 },
      skill: { skillId: `sk_${op.id}`, spCost: 1000, initSp: 0, spType: 'INCREASE_WITH_TIME' } });
    casts[op.id] = 0;
    kits[charId] = () => ({ skill: { id: `syn-${op.id}`, kind: 'instant', spCost: 1000, trigger: 'SP_FULL',
      ...(op.castOnDeploy ? { castOnDeploy: true } : null), assaultCast: () => { casts[op.id]++; } } });
    units.push({ uid: `u-${op.id}`, chessId, row: op.row ?? 10, col: op.col ?? 3 + i });
  }
  const data = new DataSource({ chess, enemies: {
    [ENEMY]: enemyRec({ key: ENEMY, hp: 1e6, speed: 0, rangeRadius: 0 }),
    [FLYER]: enemyRec({ key: FLYER, hp: 1e6, speed: 0, rangeRadius: 0, motion: 'FLY' }),
  } }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: 'assault-synergy', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units }], content: 'assault', assault: { kits, strict: true, ...(redeployCycle == null ? null : { redeployCycle }) },
    flags: { dpInit: 99, dpPerSec: 1, dpMax: 99, startOpCooldown: 0 }, autoFinish: false, timeLimit,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  // the fixture enemies stand where the test puts them from the first tick on (a scheduled spawn waits for a step)
  for (const e of enemies) battle.spawnEnemy(e.fly ? FLYER : ENEMY, { routeIndex: e.fly ? 2 : 0, pos: e.pos });
  const op = (id) => battle.allyUnits.find((x) => x.uid === `u-${id}`);
  const flush = () => battle.assaultRuntime.flush();
  const run = (seconds) => { const n = Math.round(seconds / battle.dt); for (let i = 0; i < n; i++) battle.step(); };
  return { battle, op, flush, run, casts };
}

test('status names cover the native controls, blocked, elements and their bursts', () => {
  assert.equal(statusName('战栗'), 'tremble');
  assert.equal(statusName('freeze'), 'frozen');
  assert.equal(statusName('停顿'), 'sluggish');
  assert.equal(statusName('凋亡'), 'apoptosis');
  assert.equal(statusName('burnBurst'), 'burnBurst');
  assert.throws(() => statusName('poison'), /unknown assault status/);
  const { battle, flush } = makeBattle({ ops: [{ id: 'a' }], enemies: [{ pos: [5, 10] }] });
  const e = battle.enemies[0], a = battle.allyUnits[0];
  for (const s of ['tremble', 'stun', 'bind', 'sleep', 'cold', 'frozen', 'levitate', 'fear', 'sluggish']) {
    assert.equal(hasStatus(e, s), false, s);
    applyStatus(battle, a, e, { status: s, duration: 5 });
    flush();
    assert.equal(hasStatus(e, s), true, s);
  }
  e.elem.burn = 10;
  assert.equal(hasStatus(e, '灼燃'), true);
  assert.equal(hasStatus(e, 'neural'), false);
});

test('trigger sources default to the rest of the team; self, adjacent, class and any are explicit', () => {
  const { battle, op } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4, profession: 'TANK' }, { id: 'c', col: 8, profession: 'SNIPER' }] });
  const [a, b, c] = ['a', 'b', 'c'].map(op);
  assert.equal(relates(a, a, 'other'), false);
  assert.equal(relates(a, b, 'other'), true);
  assert.equal(relates(a, b, 'adjacent'), true);
  assert.equal(relates(a, c, 'adjacent'), false);
  assert.equal(relates(a, a, 'self'), true);
  assert.throws(() => relates(a, b, 'friends'), /relation/);
  assert.deepEqual(auraTargets(battle, a, { includeSelf: false }).map((x) => x.uid), ['u-b', 'u-c']);
  assert.deepEqual(auraTargets(battle, a, { includeSelf: true, filter: { profession: ['WARRIOR', 'TANK'] } }).map((x) => x.uid), ['u-a', 'u-b']);
  assert.ok(TRIGGER_KINDS.length >= 14);
});

test('inflict / attacked / skill / heal / barrier / kill / element triggers fire from native events with limits', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4 }], enemies: [{ pos: [10, 4] }, { pos: [10, 9] }] });
  const a = op('a'), b = op('b');
  const [e1, e2] = battle.enemies;
  const seen = [];
  const log = (name) => ({ source, target }) => seen.push([name, source?.uid ?? source?.id ?? null, target?.uid ?? target?.id ?? null]);
  onTrigger(battle, a, { on: 'inflict', key: 'tremble', status: '战栗' }, log('inflict'));
  onTrigger(battle, a, { on: 'inflict', key: 'tremble-self', status: 'tremble', by: 'self' }, log('inflictSelf'));
  onTrigger(battle, a, { on: 'inflict', key: 'burn', element: '灼燃' }, log('burnDamage'));
  onTrigger(battle, a, { on: 'statusDamaged', key: 'cold-hit', status: 'cold', by: 'any', limit: { perBattle: 2 } }, log('coldHit'));
  onTrigger(battle, a, { on: 'attacked', key: 'guard' }, log('attacked'));
  onTrigger(battle, a, { on: 'heal', key: 'heal', limit: { cooldown: 5 } }, log('heal'));
  onTrigger(battle, a, { on: 'barrierGained', key: 'shield' }, log('barrier'));
  onTrigger(battle, a, { on: 'barrierBroken', key: 'shieldBreak' }, log('barrierBroken'));
  onTrigger(battle, a, { on: 'kill', key: 'kill' }, log('kill'));
  onTrigger(battle, a, { on: 'nearbyDeath', key: 'near', by: 'any' }, log('nearbyDeath'));
  applyStatus(battle, b, e2, { status: 'tremble', duration: 3 });
  applyStatus(battle, a, e2, { status: 'tremble', duration: 3 });
  flush();
  damage(battle, b, e2, { amount: 100, type: 'element', element: 'burn' });
  applyStatus(battle, b, e2, { status: 'cold', duration: 10 });
  for (let i = 0; i < 4; i++) damage(battle, b, e2, { amount: 10, type: 'phys' });
  damage(battle, e1, b, { amount: 10, type: 'phys' });
  b.hp -= 500;
  heal(battle, b, b, { amount: 100 });
  heal(battle, b, b, { amount: 100 });
  buff(battle, b, b, { key: 'test-shield', mods: {}, duration: 10 }).shield = 0;
  battle.addBuff(b, { key: 'test-barrier', shield: 50, duration: 10 });
  flush();
  damage(battle, e1, b, { amount: 400, type: 'true' });
  e1.hp = 1;
  damage(battle, b, e1, { amount: 10, type: 'true' });
  flush();
  const names = seen.map(([n]) => n);
  assert.deepEqual(names.filter((n) => n === 'inflict'), ['inflict'], 'the other operator sets it off, the watcher does not');
  assert.deepEqual(names.filter((n) => n === 'inflictSelf'), ['inflictSelf']);
  assert.equal(names.filter((n) => n === 'burnDamage').length, 1);
  assert.equal(names.filter((n) => n === 'coldHit').length, 2, 'perBattle 2');
  assert.equal(names.filter((n) => n === 'heal').length, 1, 'cooldown 5 s');
  assert.ok(names.includes('attacked'));
  assert.ok(names.includes('barrier'));
  assert.ok(names.includes('barrierBroken'));
  assert.ok(names.includes('kill'));
  assert.ok(names.includes('nearbyDeath'), 'enemy fell on the tile next to the watcher');
});

test('limiter counts cooldown and per-battle limits together', () => {
  const battle = { time: 0 };
  const take = limiter(battle, { cooldown: 2, perBattle: 3 });
  const fired = [];
  for (let t = 0; t <= 10; t += 0.5) { battle.time = t; if (take()) fired.push(t); }
  assert.deepEqual(fired, [0, 2, 4]);
  assert.throws(() => limiter(battle, { cooldown: 0 }), /cooldown/);
});

test('a trigger loop inside one causal chain is cut by the runtime; independent firings in one tick stop at the frame limit', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }], enemies: [{ pos: [10, 9] }] });
  const a = op('a'), b = op('b');
  const e = battle.enemies[0];
  let fired = 0;
  // every hit by b re-hits from b: the runtime's causal guard (same observer, same target, same chain) stops it at once
  onTrigger(battle, a, { on: 'statusDamaged', key: 'loop', status: 'stun' }, () => { fired++; battle.assaultRuntime.enqueue(() => damage(battle, b, e, { amount: 1 }), {}); });
  applyStatus(battle, b, e, { status: 'stun', duration: 10 });
  flush();
  damage(battle, b, e, { amount: 1 });
  flush();
  assert.equal(fired, 1);
  assert.ok(battle.assaultRuntime.diagnostics.suppressed.some((x) => x.key.endsWith(':trigger:statusDamaged:loop')));
  // 100 separate hits in the same tick (each its own chain): the trigger fires TRIGGER_FRAME_LIMIT times, the rest are refused
  let counted = 0;
  onTrigger(battle, a, { on: 'statusDamaged', key: 'count', status: 'stun' }, () => { counted++; });
  for (let i = 0; i < 100; i++) { damage(battle, b, e, { amount: 1 }); flush(); }
  assert.equal(counted, TRIGGER_FRAME_LIMIT);
  assert.ok(battle.assaultRuntime.diagnostics.triggerFrameRefused >= 100 - TRIGGER_FRAME_LIMIT);
  // the next tick counts afresh
  battle.step();
  flush();
  const afterStep = counted;
  damage(battle, b, e, { amount: 1 });
  flush();
  assert.ok(counted > afterStep, 'the next tick fires again');
});

test('充能, 加速 (natural SP doubled) and 技力光环 change the native SP state', () => {
  const { battle, op } = makeBattle({ ops: [{ id: 'a' }] });
  const a = op('a');
  const sp0 = a.skill.sp;
  charge(battle, a, a, 7, 'test');
  assert.equal(a.skill.sp - sp0, 7);
  const rate = a.s.spRecovery;
  accelerate(battle, a, a, 5, 'test');
  assert.equal(a.s.spRecovery, rate * 2);
  spAura(battle, a, a, 0.5, 'test');
  assert.equal(a.s.spRecovery, (rate + 0.5) * 2);
  const before = a.skill.sp;
  battle.step();
  assert.ok(Math.abs(a.skill.sp - before - (rate + 0.5) * 2 * battle.dt) < 1e-9);
});

test('快发 timed effects refresh on recast instead of stacking unless the card says so', () => {
  const { battle, op, run } = makeBattle({ ops: [{ id: 'a' }] });
  const a = op('a');
  sustain(battle, a, a, { key: 'atk', mods: { atkPct: 0.3 }, duration: 10 });
  run(4);
  sustain(battle, a, a, { key: 'atk', mods: { atkPct: 0.3 }, duration: 10 });
  const list = a.buffs.filter((x) => x.key === 'assault:sustain:atk');
  assert.equal(list.length, 1);
  assert.equal(list[0].stacks, 1);
  assert.ok(Math.abs(list[0].timeLeft - 10) < 1e-9, 'refreshed to the full time');
  sustain(battle, a, a, { key: 'stack', mods: { atkFlat: 10 }, duration: 10, stack: true, maxStacks: 5 });
  sustain(battle, a, a, { key: 'stack', mods: { atkFlat: 10 }, duration: 10, stack: true, maxStacks: 5 });
  assert.equal(a.buffs.find((x) => x.key === 'assault:sustain:stack').stacks, 2);
});

test('granted air blocking: a class aura lets ground operators block flyers, which then count as blocked', () => {
  const { battle, op, run } = makeBattle({ ops: [{ id: 'g', col: 3, profession: 'TANK' }, { id: 'w', col: 6, profession: 'WARRIOR' }, { id: 'src', col: 8, profession: 'SUPPORT' }],
    enemies: [{ pos: [10, 3], fly: true }, { pos: [10, 6], fly: true }] });
  const g = op('g'), w = op('w'), src = op('src');
  const [f1, f2] = battle.enemies;
  run(0.5);
  assert.equal(f1.blockedBy, null, 'nobody blocks flyers by default');
  assert.equal(airBlockSource(g), null);
  airBlockAura(battle, src, { key: 'tank', filter: { profession: 'TANK' } });
  run(0.5);
  assert.equal(airBlockSource(g), 'granted');
  assert.equal(f1.blockedBy, g);
  assert.equal(hasStatus(f1, 'blocked'), true);
  assert.equal(f2.blockedBy ?? null, null, 'a warrior is not covered by a TANK aura');
  grantAirBlock(battle, src, w, { key: 'trigger', duration: 3 });
  run(0.5);
  assert.equal(f2.blockedBy, w);
  // tremble on a blocked flyer takes effect like on a ground enemy
  applyStatus(battle, g, f1, { status: 'tremble', duration: 5 });
  assert.equal(hasStatus(f1, 'tremble'), true);
  // the aura ends when its source leaves the field
  battle.retreat(src);
  assert.equal(airBlockSource(g), null);
});

test('本场叠加 stacks without a cap and survives an in-place redeploy; the battle ledger keeps the total', () => {
  const { battle, op } = makeBattle({ ops: [{ id: 'a' }] });
  const a = op('a');
  const atk = a.s.atk;
  for (let i = 0; i < 25; i++) battleStack(battle, a, a, { key: 'kills', stat: 'atk', amount: 10 });
  assert.equal(a.s.atk, atk + 250);
  assert.deepEqual(battle.assaultBattleStacks['u-a']['kills:atk:flat'], { key: 'kills', stat: 'atk', mode: 'flat', amount: 250, stacks: 25 });
  redeployNow(battle, a, a);
  assert.equal(a.s.atk, atk + 250);
});

test('本局永久成长 records per-piece growth for the run settlement with no cap', () => {
  const { battle, op } = makeBattle({ ops: [{ id: 'a' }] });
  const a = op('a');
  for (let i = 0; i < 3; i++) runGrowth(battle, a, a, { key: 'block', stat: 'atk', flat: 15 });
  runGrowth(battle, a, a, { key: 'block-pct', stat: 'def', percent: 0.05 });
  const effects = battle.assaultPermanentEffects;
  const flat = effects.find((x) => x.stat === 'atk');
  assert.equal(flat.amount, 45);
  assert.equal(flat.mode, 'flat');
  assert.match(flat.effectKey, /growth:u-a:block/);
  assert.equal(effects.find((x) => x.stat === 'def').mode, 'percent');
});

test('再部署 loop: at its timer the operator redeploys in place — full HP, SP and buffs kept, deploy effects again', () => {
  const { battle, op, run, casts } = makeBattle({ ops: [{ id: 'a', respawn: 10, castOnDeploy: true }, { id: 'b', respawn: 30 }] });
  const a = op('a'), b = op('b');
  let deploys = 0;
  onTrigger(battle, b, { on: 'deploy', key: 'count' }, () => { deploys++; });
  battle.assaultRuntime.flush();
  assert.equal(casts.a, 1, 'the deploy-time skill is cast at the first deployment');
  assert.ok(Math.abs(redeployRemaining(battle, a) - 10) < 1e-9);
  run(4);
  a.hp = 100;
  buff(battle, a, a, { key: 'keep-me', mods: { atkFlat: 5 }, duration: 100 });
  const tile = [a.tileR, a.tileC];
  run(5);
  const sp = a.skill.sp;
  run(1.05);
  assert.equal(a.hp, a.s.maxHp);
  assert.ok(a.skill.sp >= sp, 'SP is not reset');
  assert.ok(a.buffs.some((x) => x.key === 'keep-me'), 'buffs stay');
  assert.deepEqual([a.tileR, a.tileC], tile);
  assert.equal(a.alive && a.deployed, true);
  assert.equal(deploys, 1, 'deploy-time effects fire again');
  assert.equal(casts.a, 2, 'the deploy-time skill is cast again');
  assert.equal(a.assaultCycle.count, 1);
  // 当前再部署时间 -x 秒 / -x%: advances the running timers (b: 30 s loop)
  const left = redeployRemaining(battle, b);
  cutRedeploy(battle, a, { seconds: 5, percent: 0.5 });
  assert.ok(Math.abs(redeployRemaining(battle, b) - (left * 0.5 - 5)) < 1e-9);
  // future: later loops are shorter too
  cutRedeploy(battle, a, { seconds: 2, includeSelf: false, future: true });
  assert.equal(b.mem.assaultRedeployCut.seconds, 2);
  assert.equal(a.mem.assaultRedeployCut, undefined);
});

test('立即再部署 chains in one tick always stop at the frame limit', () => {
  const { battle, op } = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }] });
  const a = op('a'), b = op('b');
  let fired = 0;
  // a redeploys b whenever b deploys, b redeploys a whenever a deploys, each also redeploys itself
  onTrigger(battle, a, { on: 'deploy', key: 'ping', by: 'yours' }, ({ target }) => { fired++; redeployNow(battle, a, target === a ? b : a); redeployNow(battle, a, target); });
  onTrigger(battle, b, { on: 'deploy', key: 'pong', by: 'yours' }, ({ target }) => { fired++; redeployNow(battle, b, target === b ? a : b); });
  battle.assaultRuntime.flush();
  redeployNow(battle, a, a);
  battle.assaultRuntime.flush();
  assert.ok(a.assaultCycle.count <= ASSAULT_REDEPLOY_CHAIN.perUnit + 1);
  assert.ok(b.assaultCycle.count <= ASSAULT_REDEPLOY_CHAIN.perUnit + 1);
  assert.ok(fired > 0 && fired < 100);
  // the next tick runs normally
  battle.step();
  assert.equal(a.alive && b.alive, true);
});

test('a knocked-out operator keeps the respawn timer and the paid automatic redeploy', () => {
  const { battle, op, run } = makeBattle({ ops: [{ id: 'a', respawn: 5 }] });
  const a = op('a');
  battle.kill(a);
  assert.equal(a.alive, false);
  assert.ok(Math.abs(redeployRemaining(battle, a) - 5) < 1e-9);
  cutRedeploy(battle, a, { seconds: 2, includeSelf: true });
  assert.ok(Math.abs(redeployRemaining(battle, a) - 3) < 1e-9);
  let steps = 0;
  while (!a.alive && steps++ < 4 / battle.dt) battle.step();
  assert.equal(a.alive, true);
  assert.ok(Math.abs(battle.time - 3) <= battle.dt + 1e-9, 'back when the cut timer ends');
  assert.ok(Math.abs(redeployRemaining(battle, a) - 5) <= battle.dt + 1e-9, 'a new loop starts at the redeployment');
});

test('the 再部署 loop is an assault rule switch: on by default, off keeps the native skill redeploy and no timers', () => {
  assert.equal(REDEPLOY_CYCLE_DEFAULT, true);
  const { battle, op, run } = makeBattle({ ops: [{ id: 'a', respawn: 5 }], redeployCycle: false });
  const a = op('a');
  let deployed = 0;
  battle.assaultRuntime.observe('deployed', 'count', () => { deployed++; });
  assert.equal(battle.assaultRedeployCycleOn, false);
  assert.equal(redeployRemaining(battle, a), null);
  a.hp = 10;
  run(6);
  assert.equal(a.hp < a.s.maxHp, true, 'no loop: nothing healed it');
  assert.equal(battle.skillRedeploy(a), true);
  assert.equal(a.hp, a.s.maxHp);
  assert.equal(deployed, 0, 'the native skill redeploy of a unit on the field fires no deploy effects');
  // an explicit 立即再部署 effect still redeploys in place
  assert.equal(redeployNow(battle, a, a), true);
  battle.assaultRuntime.flush();
  assert.equal(deployed, 1);
});

test('deployEffect: arm at real deployments, effect at every deployment and in-place 再部署, once per deployment', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', respawn: 30 }, { id: 'b', respawn: 30, profession: 'TANK' }, { id: 'c', respawn: 30, profession: 'SNIPER' }] });
  const a = op('a'), b = op('b'), c = op('c');
  flush();
  const log = [];
  // registered after the opening deployment: runs once now for the unit already on the field
  deployEffect(battle, a, { key: 'self', arm: ({ deployment }) => log.push(['arm', deployment]),
    effect: ({ deployment, inPlace }) => log.push(['effect', deployment, inPlace]) });
  flush();
  assert.deepEqual(log.map(([k]) => k), ['arm', 'effect']);
  redeployNow(battle, a, a);
  flush();
  assert.deepEqual(log.slice(2), [['effect', `${a.deploySeq}:c1`, true]], 'in place: the effect again, no arm');
  battle.kill(a);
  battle.step();
  let guard = 0;
  while (!a.alive && guard++ < 40 / battle.dt) battle.step();
  flush();
  assert.equal(a.alive, true);
  assert.deepEqual(log.slice(3).map(([k, id]) => [k, id]), [['arm', `${a.deploySeq}:d`], ['effect', `${a.deploySeq}:d`]], 'a knocked-out comeback: arm and effect');
  // 「你的其他重装干员部署时」: another unit's in-place 再部署 counts, the watcher's own does not
  const seen = [];
  deployEffect(battle, c, { key: 'tanks', by: 'other', filter: { profession: 'TANK' }, effect: ({ target }) => seen.push(target.uid) });
  flush();
  seen.length = 0;
  redeployNow(battle, b, b);
  redeployNow(battle, c, c);
  redeployNow(battle, a, a);
  flush();
  assert.deepEqual(seen, ['u-b']);
});

test('deployEffect re-entry: an effect that redeploys its own unit stops; perBattle limits the effect', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', respawn: 30 }, { id: 'b', respawn: 30 }] });
  const a = op('a'), b = op('b');
  flush();
  let loops = 0;
  deployEffect(battle, a, { key: 'again', effect: () => { loops++; redeployNow(battle, a, a); } });
  flush();
  redeployNow(battle, b, a);
  flush();
  assert.ok(loops >= 2 && loops <= ASSAULT_REDEPLOY_CHAIN.perUnit + 2, `bounded (${loops})`);
  battle.step();
  assert.equal(a.alive, true);
  let limited = 0;
  deployEffect(battle, b, { key: 'limited', effect: () => { limited++; }, limit: { perBattle: 2 } });
  flush();
  for (let i = 0; i < 4; i++) { battle.step(); redeployNow(battle, a, b); flush(); }
  assert.equal(limited, 2);
});

test('the detail card reads 本局已成长, 本场 and 可阻挡空中敌人 from the piece and the live battle', () => {
  const { battle, op } = makeBattle({ ops: [{ id: 'a' }, { id: 'b' }] });
  const a = op('a'), b = op('b');
  const piece = { uid: 'u-a', permanentFlat: { atk: 45 }, permanentPercent: { def: 0.05 } };
  assert.deepEqual(growthView(piece, battle), { run: [{ stat: 'atk', mode: 'flat', amount: 45 }, { stat: 'def', mode: 'percent', amount: 5 }], battle: [], airBlock: null });
  for (let i = 0; i < 3; i++) battleStack(battle, b, a, { key: 'kills', stat: 'atk', amount: 10 });
  battleStack(battle, b, a, { key: 'blocks', stat: 'atk', amount: 5 });
  battleStack(battle, b, a, { key: 'hp', stat: 'maxHp', amount: 0.2, mode: 'percent' });
  assert.throws(() => battleStack(battle, b, a, { key: 'x', stat: 'aspd', amount: 0.2, mode: 'percent' }), /no percent aspd/);
  grantAirBlock(battle, b, a, { key: 'card' });
  const view = growthView(piece, battle);
  assert.deepEqual(view.battle, [{ stat: 'maxHp', mode: 'percent', amount: 20 }, { stat: 'atk', mode: 'flat', amount: 35 }]);
  assert.equal(view.airBlock, 'granted');
  assert.equal(growthView({ uid: 'u-b', permanentFlat: {}, permanentPercent: {} }, battle).airBlock, null);
  assert.deepEqual(growthView({ uid: 'x' }), { run: [], battle: [], airBlock: null }, 'a piece without growth counts 0');
});

test('the detail card writes a counter amount with its unit: 秒 by language (s / 초), % as it is, none without one', () => {
  const pack = (code) => JSON.parse(readFileSync(new URL(`../../public/i18n/${code}.json`, import.meta.url), 'utf8'));
  registerLangs([{ code: 'en' }, { code: 'ko' }]);
  try {
    assert.equal(growthAmountText({ mode: 'counter', amount: 0.3, suffix: '秒' }), '+0.3秒', 'Chinese');
    setMessages('en', pack('en')); setLang('en');
    assert.equal(growthAmountText({ mode: 'counter', amount: 0.3, suffix: '秒' }), '+0.3s');
    assert.equal(growthAmountText({ mode: 'counter', amount: 3, suffix: '%' }), '+3%');
    assert.equal(growthAmountText({ mode: 'counter', amount: 2, suffix: '' }), '+2');
    assert.equal(growthAmountText({ mode: 'percent', amount: 5 }), '+5%');
    assert.equal(growthAmountText({ mode: 'flat', amount: 45 }), '+45');
    setMessages('ko', pack('ko')); setLang('ko');
    assert.equal(growthAmountText({ mode: 'counter', amount: 0.3, suffix: '秒' }), '+0.3초');
  } finally { setLang('zh'); setMessages('en', {}); setMessages('ko', {}); }
});
