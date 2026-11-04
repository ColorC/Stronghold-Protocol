// Synergy card lines (design of 2026-10-21): the trigger vocabulary of the design table (event × subject × limit) wired
// to the runtime stream, and the primitives phase 2a added (castSkill, loseHp, elementDamage, ammo, overheal barrier,
// summon stock, redeploy delay, auras).
import test from 'node:test';
import { spawnTestSummon } from '../helpers/adaptationActions.js';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/synergyFixture.js';
import { synergyBattle, runtime as compiledRuntime } from '../helpers/synergyCard.js';
const synergyBattleRuntime = () => ({ runtime: compiledRuntime });
import { EVENTS, INSTALL_EVENTS, bindTrigger, limitOf, subjectOf, installLines } from '../../server/sim/content/assault/card-lines.js';
import {
  castSkill, loseHp, elementDamage, ammoSkill, reloadAmmo, maxAmmo, overhealToBarrier, summonStock, redeployDelay, redeployNow,
  redeployRemaining, allyAura, enemyAura, grantAirBlock, hasStatus, markWanted, isWanted, airBlockAura, airBlockSource, hasOwnBarrier,
  flareZone, seedTile, placeSentry, removeZone, inZone, teleportToSelf, replicate,
  slowEnemyProjectiles, endEnemyProjectileSlow, clearEnemyProjectiles, enemyProjectilesIn,
} from '../../server/sim/content/assault/synergy.js';
import { applyStatus, damage, heal, gainDP } from '../../server/sim/content/assault/primitives.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { readFileSync } from 'node:fs';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// the design-spec trigger.event vocabulary (design-spec.md「trigger.event」), existing and new
const SPEC_EVENTS = ['skillReady', 'static', 'aura', 'skillStart', 'skillResolved', 'kill', 'death', 'statusApplied', 'elementBurst',
  'elementHit', 'blocked', 'heal', 'shieldGained', 'shieldBroken', 'deployed', 'redeploy', 'summonSpawned', 'summonDied',
  'summonExited', 'summonReturned', 'damageTaken', 'hit', 'dodge', 'dpSpent', 'dpReceived', 'spReceived', 'ammoUsed', 'reloaded',
  'teleported', 'pullCollision', 'pushCollision', 'attack', 'eliteKill', 'blockedAir', 'healed', 'redeployTimerFull', 'loseHp'];

test('every trigger event and subject of the design spec has its runtime binding; limits read as the card says', () => {
  for (const name of SPEC_EVENTS) assert.ok(EVENTS[name] || INSTALL_EVENTS.includes(name), name);
  for (const subject of ['self', 'otherAllies', 'adjacentAllies', 'allAllies', 'enemyByOthers', 'enemy']) assert.ok(subjectOf(subject).by, subject);
  assert.deepEqual(subjectOf('allies:深海猎人'), { by: 'other', filter: { label: ['深海猎人'] } });
  assert.deepEqual(subjectOf('allies:术师(other)'), { by: 'other', filter: { label: ['术师'] } });
  assert.throws(() => subjectOf('friends'), /unknown assault card subject/);
  assert.deepEqual(limitOf('每 2 秒最多一次'), { cooldown: 2 });
  assert.deepEqual(limitOf('每 10/9/8/8 秒最多一次', 3), { cooldown: 8 });
  assert.deepEqual(limitOf('每名干员每 3 秒最多一次'), { cooldown: 3, perActor: true });
  assert.deepEqual(limitOf('每场战斗前 5 次'), { perBattle: 5 });
  assert.deepEqual(limitOf('每场战斗一次'), { perBattle: 1 });
  assert.deepEqual(limitOf('每次部署一次'), { perDeployment: 1 });
  assert.deepEqual(limitOf('每次施放 1 次'), { perCast: 1 });
  assert.equal(limitOf(null), null);
  assert.throws(() => limitOf('偶尔'), /unreadable assault card limit/);
});

test('the whole design table binds: every line event, subject and limit is readable (custom events are listed)', () => {
  const path = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/assault/ak-synergy/design-172.json';
  let design;
  try { design = JSON.parse(readFileSync(path, 'utf8')); } catch { return; } // the design table lives outside the repository
  const custom = new Set();
  for (const form of design.forms) for (const line of form.lines) {
    const [name] = String(line.trigger?.event ?? '').split(':');
    for (const n of name.split('|')) if (n && !EVENTS[n] && !INSTALL_EVENTS.includes(n)) custom.add(n);
    if (line.trigger?.subject) subjectOf(line.trigger.subject);
    limitOf(line.limit);
  }
  assert.deepEqual([...custom].sort(), [], 'every event of the table has a binding (coinSpent: published by the coin card’s own kit)');
});

test('eliteKill · blockedAir · healed · dodge · redeploy · redeployTimerFull · class subjects · per-actor cooldown', () => {
  const { battle, op, flush, run } = makeBattle({ ops: [{ id: 'w', col: 3, labels: ['近卫'] }, { id: 'g', col: 4, labels: ['重装'], respawn: 2 },
    { id: 'c', col: 6, labels: ['术师'] }], enemies: [{ pos: [10, 9] }, { pos: [10, 4], fly: true }] });
  const w = op('w'), g = op('g'), c = op('c');
  const [ground, flyer] = battle.enemies;
  const seen = [];
  const watch = (event, subject, extra = {}) => bindTrigger(battle, w, { event, subject }, { key: `${event}:${subject}`, ...extra }, ({ actor }) => seen.push([event, actor?.uid ?? null]));
  watch('eliteKill', 'otherAllies');
  watch('blockedAir', 'allies:重装');
  watch('healed', 'otherAllies');
  watch('dodge', 'allies:术师');
  watch('redeploy', 'otherAllies');
  watch('redeployTimerFull', 'otherAllies');
  watch('hit', 'otherAllies', { limit: '每名干员每 3 秒最多一次' });
  // elite kill by c; a normal kill does not count
  ground.def = { ...ground.def, rank: 'ELITE' };
  damage(battle, c, ground, { amount: 1e7, type: 'true' });
  flush();
  // g blocks the flyer once it may block flyers
  grantAirBlock(battle, c, g, { key: 'test' });
  run(0.2);
  flush();
  assert.equal(flyer.blockedBy, g);
  g.hp -= 100; heal(battle, c, g, { amount: 50 }); flush();
  battle.emit('dodge', { source: flyer, target: c, dmg: { type: 'phys' } }); flush();
  // hits per unit within 3 s count once: c already hit (the elite kill), g's two hits count once, c's next hit not
  damage(battle, g, flyer, { amount: 1, type: 'true' }); damage(battle, g, flyer, { amount: 1, type: 'true' }); damage(battle, c, flyer, { amount: 1, type: 'true' });
  flush();
  redeployNow(battle, w, c); flush();
  battle.assaultRedeployChain = null;
  const names = seen.map(([e, who]) => `${e}:${who}`);
  for (const want of ['eliteKill:u-c', 'blockedAir:u-g', 'healed:u-g', 'dodge:u-c', 'redeploy:u-c']) assert.ok(names.includes(want), `${want} in ${names}`);
  assert.deepEqual(names.filter((n) => n.startsWith('hit:')), ['hit:u-c', 'hit:u-g']);
  assert.ok(!names.some((n) => n.startsWith('redeployTimerFull:')), 'an effect redeploy is not a full timer');
  run(2.2); flush();
  assert.ok(seen.some(([e, who]) => e === 'redeployTimerFull' && who === 'u-g'), 'g’s 2 s loop ran out');
});

test('「部署或再部署时」 (redeploy|deployed) fires once per deployment; a statuses option widens statusApplied', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4 }], enemies: [{ pos: [10, 9] }] });
  const a = op('a'), b = op('b');
  let deploys = 0, controls = 0;
  bindTrigger(battle, a, { event: 'redeploy|deployed', subject: 'otherAllies' }, { key: 'dep' }, () => { deploys++; });
  bindTrigger(battle, a, { event: 'statusApplied:stun', subject: 'otherAllies' }, { key: 'ctl', statuses: ['stun', 'sluggish', 'cold'] }, () => { controls++; });
  redeployNow(battle, a, b); flush();
  assert.equal(deploys, 1);
  for (const status of ['stun', 'sluggish', 'cold', 'sleep']) applyStatus(battle, b, battle.enemies[0], { status, duration: 1 });
  flush();
  assert.equal(controls, 3);
});

test('castSkill · loseHp · elementDamage · redeployDelay', () => {
  const { battle, op, flush, casts } = makeBattle({ ops: [{ id: 'a', respawn: 10 }, { id: 'b' }], enemies: [{ pos: [10, 9] }] });
  const a = op('a'), b = op('b');
  const sp = a.skill.sp;
  assert.equal(castSkill(battle, b, a), true);
  flush();
  assert.equal(casts.a, 1);
  assert.equal(a.skill.sp, sp, 'free: no SP spent');
  const taken = [], lost = [];
  battle.assaultRuntime.observe('damageTaken', 't', () => taken.push(1));
  battle.assaultRuntime.observe('hpLost', 'l', ({ payload }) => lost.push(payload.amount));
  a.hp = 1000;
  assert.ok(near(loseHp(battle, a, a, { currentPct: 0.5 }), 500));
  assert.ok(near(loseHp(battle, a, a, { maxPct: 5 }), 499));
  assert.equal(a.hp, 1, 'never below 1');
  assert.equal(taken.length, 0, 'not damage');
  assert.equal(lost.length, 2);
  const e = battle.enemies[0];
  elementDamage(battle, b, e, { element: '灼燃', amount: 200 });
  assert.ok(e.elem.burn > 0 || hasStatus(e, 'burnBurst'), 'the burn gauge fills');
  const left = redeployRemaining(battle, a);
  assert.ok(near(redeployDelay(battle, b, a, { percent: 0.5 }), 5));
  assert.ok(near(redeployRemaining(battle, a), left + 5));
});

test('ammoSkill: rounds per attack, the loaded bonus ends with the last round, recast reloads; reload and 弹药上限', () => {
  const { battle, op, flush, run } = makeBattle({ ops: [{ id: 'a', col: 3 }], enemies: [{ pos: [10, 4] }] });
  const a = op('a');
  let emptied = 0;
  const atk = a.s.atk;
  assert.equal(ammoSkill(battle, a, { key: 'shells', count: 3, mods: { atkPct: 0.5 }, onEmpty: () => { emptied++; } }), 3);
  assert.ok(a.s.atk > atk * 1.4);
  maxAmmo(a, 'test', 2);
  assert.equal(assaultAmmoState(a).capacity, 5);
  assert.equal(reloadAmmo(battle, a, a, 'full'), 2);
  run(8); flush();
  assert.equal(assaultAmmoState(a).current, 0, 'the attacks used every round');
  assert.equal(emptied, 1);
  assert.ok(near(a.s.atk, atk), 'the bonus ended');
  assert.equal(ammoSkill(battle, a, { key: 'shells', count: 3, mods: { atkPct: 0.5 }, onEmpty: () => { emptied++; } }), 5, 'recast reloads to the capacity');
});

test('overhealToBarrier caps the barrier; allyAura and enemyAura follow joins, leaves and their source', () => {
  const { battle, op, flush, run } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4, labels: ['术师'] }, { id: 'c', col: 6 }], enemies: [{ pos: [10, 4] }, { pos: [10, 9] }] });
  const a = op('a'), b = op('b'), c = op('c');
  overhealToBarrier(battle, a, a, { key: 'recycle', capRatio: 0.1 });
  a.hp = a.s.maxHp - 50;
  heal(battle, b, a, { amount: 150 });
  assert.ok(near(a.findBuff('assault:overheal:recycle').shield, 100));
  heal(battle, b, a, { amount: 1e6 });
  assert.ok(near(a.findBuff('assault:overheal:recycle').shield, a.s.maxHp * 0.1), 'capped');
  allyAura(battle, a, { key: 'sp', mods: { spRecoveryFlat: 0.5 }, select: (x) => x !== a && x.def.raw.assaultBody?.bazaar?.labels?.includes('术师') });
  const [near1, far] = battle.enemies;
  enemyAura(battle, a, { key: 'slow', mods: { moveMul: 0.8 }, select: (e) => e === near1 });
  run(0.3);
  assert.ok(b.findBuff(`assault:allyAura:${a.uid}:sp`));
  assert.equal(c.findBuff(`assault:allyAura:${a.uid}:sp`), null);
  assert.ok(near1.findBuff(`assault:enemyAura:${a.uid}:slow`) && !far.findBuff(`assault:enemyAura:${a.uid}:slow`));
  battle.retreat(a);
  run(0.8);
  assert.equal(b.findBuff(`assault:allyAura:${a.uid}:sp`), null, 'the source left');
  assert.equal(near1.findBuff(`assault:enemyAura:${a.uid}:slow`), null);
});

test('summonStock: an explicit summon request uses a sourced pool and respects its field cap', () => {
  const h = synergyBattle([{ charId: 'char_2023_ling', row: 9, col: 3 }]);
  const [ling] = h.units;
  const tokens = () => h.battle.allyUnits.filter((x) => x.kind === 'token' && x.ownerUnit === ling && x.alive);
  const tokenId = 'token_10020_ling_soul2';
  const result = summonStock(h.battle, ling, { tokenId, fieldCap: 3, stockCap: 5, ruleKey: `test-explicit:${ling.uid}` }, 3);
  h.flush();
  assert.equal(result.granted, 3);
  assert.equal(tokens().length, 3);
});

test('installLines: every card line needs its handler; only skill lines are implemented by the cast', () => {
  const h=makeBattle(),unit=h.op('a');
  unit.def={...unit.def,raw:{...unit.def.raw,assaultBody:{charId:'fixture',bazaar:{format:'synergy',
    lines:[{kind:'deploy',template:'fixture'},{kind:'skill',template:'fixture'}]}}}};
  assert.throws(() => installLines(h.battle, unit, { 1: 'cast' }), /has no handler/);
  assert.throws(() => installLines(h.battle, unit, { 0: 'cast' }), /only a skill line/);
});

test('通缉 marks an enemy until it falls and is a status the card lines bind (statusApplied:wanted); unknown statuses never break a filter', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4 }], enemies: [{ pos: [10, 9] }] });
  const a = op('a'), b = op('b');
  const e = battle.enemies[0];
  const seen = [];
  bindTrigger(battle, a, { event: 'statusApplied:wanted', subject: 'otherAllies' }, { key: 'wanted' }, ({ target }) => seen.push(target));
  battle.assaultRuntime.publish('statusApplied', { source: b, target: e, status: 'fragile' }); // a status outside the table
  assert.equal(markWanted(battle, b, e), true);
  assert.equal(markWanted(battle, b, e), false, 'already wanted');
  flush();
  assert.equal(isWanted(e), true);
  assert.equal(hasStatus(e, '通缉'), true);
  assert.deepEqual(seen, [e]);
});

test('拦空光环的四种条件：在场 t 秒后 · 部署后 t 秒内 · 自身有屏障时 · 照明区域内', () => {
  const { battle, op, flush, run } = makeBattle({ ops: [{ id: 'src', col: 3 }, { id: 'g', col: 4, labels: ['谢拉格', '叙拉古', '维多利亚', '卡西米尔'] },
    { id: 'o', col: 6, labels: ['乌萨斯'] }] });
  const src = op('src'), g = op('g'), o = op('o');
  // 凛御银灰：在场 15 秒后
  airBlockAura(battle, src, { key: 'after', filter: { label: '谢拉格' }, after: 15 });
  run(1);
  assert.equal(airBlockSource(g), null, 'not yet');
  run(14.5);
  assert.equal(airBlockSource(g), 'granted', 'after 15 s on the field');
  assert.equal(airBlockSource(o), null, 'another class');
  battle.retreat(src);
  run(0.3);
  assert.equal(airBlockSource(g), null, 'the source left');
  const t = makeBattle({ ops: [{ id: 'src', col: 3 }, { id: 'g', col: 4, labels: ['卡西米尔', '叙拉古', '维多利亚'] }] });
  const [s2, g2] = [t.op('src'), t.op('g')];
  // 耀骑士临光：部署或再部署后 10 秒内 (each deployment calls again with a new end)
  airBlockAura(t.battle, s2, { key: 'window', filter: { label: '卡西米尔' }, until: t.battle.time + 10 });
  t.run(9.5);
  assert.equal(airBlockSource(g2), 'granted');
  t.run(1);
  assert.equal(airBlockSource(g2), null, 'the window closed');
  airBlockAura(t.battle, s2, { key: 'window', filter: { label: '卡西米尔' }, until: t.battle.time + 10 });
  assert.equal(airBlockSource(g2), 'granted', 'a new deployment opens it again');
  // 斥罪：此干员拥有来自自身的屏障时
  airBlockAura(t.battle, s2, { key: 'barrier', filter: { label: '叙拉古' }, when: hasOwnBarrier });
  t.battle.removeBuff(g2, g2.buffs.find((b) => String(b.key).includes('window')));
  t.run(10.5);
  assert.equal(airBlockSource(g2), null, 'no barrier of its own');
  t.battle.addBuff(s2, { key: 'own-barrier', shield: 100, duration: 5, source: s2 });
  t.run(0.3);
  assert.equal(hasOwnBarrier(s2), true);
  assert.equal(airBlockSource(g2), 'granted', 'with its own barrier');
  t.battle.addBuff(s2, { key: 'own-barrier', shield: 0, duration: 5, source: s2 });
  t.run(0.3);
  assert.equal(airBlockSource(g2), null, 'the barrier broke');
  // 号角：照明区域内
  airBlockAura(t.battle, s2, { key: 'flare', filter: { label: '维多利亚' }, where: (x) => inZone(t.battle, x, 'flare') });
  t.run(0.3);
  assert.equal(airBlockSource(g2), null, 'outside any flare zone');
  flareZone(t.battle, s2, { at: [g2.tileR, g2.tileC], duration: 8 });
  t.run(0.3);
  assert.equal(airBlockSource(g2), 'granted', 'inside the flare zone');
  t.run(8);
  assert.equal(airBlockSource(g2), null, 'the zone ended');
});

test('区域：照明区域内敌人隐匿失效 · 播种地块回复与庇护 · 影哨保留范围内隐匿失效与减速、收回即止', () => {
  const { battle, op, run } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4 }], enemies: [{ pos: [10, 6] }, { pos: [10, 9] }] });
  const a = op('a'), b = op('b');
  const [inside, outside] = battle.enemies;
  flareZone(battle, a, { at: [10, 6], duration: 8 });
  run(0.3);
  assert.equal(inside.s.flags.reveal, true);
  assert.ok(!outside.s.flags.reveal);
  seedTile(battle, a, { at: [b.tileR, b.tileC], regen: 60, sanctuary: 0.12 });
  run(0.3);
  assert.ok(Math.abs(b.s.dmgTakenMul - 0.88) < 1e-9, '庇护 12%');
  assert.ok(b.s.hpRegen >= 60, '每秒回复 60');
  assert.ok(Math.abs(a.s.dmgTakenMul - 1) < 1e-9, 'not on the seeded tile');
  const [sr, sc] = [...b.rangeKeys].map((k) => [Math.floor(k / 21), k % 21]).find(([r, c]) => battle.grid.inRect(r, c) && !(r === b.tileR && c === b.tileC));
  battle.spawnEnemy('enemy_synergy', { routeIndex: 0, pos: [sr, sc] });
  placeSentry(battle, b, { slow: 0.3 });
  run(0.3);
  const covered = battle.enemies.filter((e) => inZone(battle, e, 'sentry'));
  assert.ok(covered.length > 0, 'an enemy stands in the sentry range');
  for (const e of covered) assert.ok(Math.abs(e.s.moveSpeed - e.base.moveSpeed * 0.7) < 1e-9 && e.s.flags.reveal);
  removeZone(battle, b, 'sentry');
  run(0.6);
  for (const e of covered) assert.ok(Math.abs(e.s.moveSpeed - e.base.moveSpeed) < 1e-9, 'recalled');
});

test('传送：地面敌人传送到此干员位置；流形复制指定干员的属性与攻击方式', () => {
  const { battle, op } = makeBattle({ ops: [{ id: 'a', col: 3 }], enemies: [{ pos: [10, 9] }] });
  const a = op('a'), e = battle.enemies[0];
  assert.equal(teleportToSelf(battle, a, e), true);
  assert.deepEqual([Math.round(e.y), Math.round(e.x)], [a.tileR, a.tileC]);
  const h = synergyBattle([{ charId: 'char_2023_ling', row: 9, col: 3 }, { charId: 'char_4145_ulpia', row: 10, col: 3 }]);
  const [ling, ulpia] = h.units;
  const token = spawnTestSummon(h,ling);
  assert.equal(replicate(h.battle, ling, token, ulpia, { factor: 0.9 }), true);
  assert.ok(Math.abs(token.base.atk - ulpia.base.atk * 0.9) < 1e-6 && Math.abs(token.base.maxHp - ulpia.base.maxHp * 0.9) < 1e-6);
  assert.equal(token.profile.attack, ulpia.profile.attack);
  assert.equal(token.mem.assaultReplicaOf, ulpia.uid);
});

test('停顿 (pause) · 防御力降低 (defDown) · 推开 (push) · 拖拽 (pull) bind as statuses of the design table', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4 }], enemies: [{ pos: [10, 6] }, { pos: [10, 8] }] });
  const a = op('a'), b = op('b');
  const [e, f] = battle.enemies;
  const seen = [];
  for (const event of ['statusApplied:pause', 'statusApplied:defDown', 'statusApplied:push|pull']) {
    bindTrigger(battle, a, { event, subject: 'otherAllies' }, { key: event }, ({ payload }) => seen.push(`${event}>${payload.status}`));
  }
  applyStatus(battle, b, e, { status: 'sluggish', duration: 1 });
  applyStatus(battle, b, e, { status: 'defDown', duration: 5, value: 0.2 });
  flush();
  assert.equal(hasStatus(e, 'defDown'), true);
  assert.equal(hasStatus(f, '防御力降低'), false);
  battle.addBuff(f, { key: 'shred', mods: { defFlat: -50 }, duration: 5, source: b });
  assert.equal(hasStatus(f, '防御力降低'), true, 'a buff that lowers DEF counts');
  battle.push(f, 3, { from: b });
  battle.pullToFront(e, b, 3);
  battle.push(f, 3, { from: a }); // the watcher's own push: no
  flush();
  assert.deepEqual(seen, ['statusApplied:pause>sluggish', 'statusApplied:defDown>defDown', 'statusApplied:push|pull>push', 'statusApplied:push|pull>pull']);
  assert.equal(hasStatus(e, 'push'), false, 'a move leaves no state');
});

test("{ around: 'range' }: 「攻击范围内的其他干员」 counts the other operators on its range tiles only", () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4 }, { id: 'c', col: 9 }], enemies: [{ pos: [12, 9] }] });
  const a = op('a'), b = op('b'), c = op('c');
  const tileKey = (x) => x.tileR * 21 + x.tileC;
  const keys = [...a.rangeKeys];
  assert.ok(keys.includes(tileKey(b)) && !keys.includes(tileKey(c)), 'fixture: b in a’s range, c not');
  const seen = [];
  bindTrigger(battle, a, { event: 'redeploy|deployed', subject: 'adjacentAllies' }, { key: 'in-range', around: 'range' }, ({ actor }) => seen.push(actor.uid));
  redeployNow(battle, a, b); redeployNow(battle, a, c); flush();
  assert.deepEqual(seen, ['u-b']);
});

test('the importer binds 「部署或再部署时」 (event redeploy, 含部署) to every deployment: redeploy|deployed', async () => {
  const design = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/assault/ak-synergy/design-172.json';
  try { readFileSync(design); } catch { return; } // the design table lives outside the repository
  const { importForms } = await import('../../tools/assault/import-synergy-design.mjs');
  const [pinecone] = await importForms({ design, ids: ['char_440_pinecn'], dryRun: true });
  const lines = pinecone.lines.filter((l) => /部署或再部署时/.test(l.template));
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.match(l.binding, /^trigger redeploy\|deployed by /);
});

test('「由你的其他干员获得费用时」 names the unit that gave the DP (dpGranted); 「干员受到异常状态时」 is statusApplied:anyOnAlly', () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'a', col: 3 }, { id: 'b', col: 4 }], enemies: [{ pos: [10, 9] }] });
  const a = op('a'), b = op('b'), e = battle.enemies[0];
  const seen = [];
  bindTrigger(battle, a, { event: 'dpReceived', subject: 'otherAllies' }, { key: 'dp-other' }, ({ actor, payload }) => seen.push(`other:${actor.uid}:${payload.amount}`));
  bindTrigger(battle, a, { event: 'dpReceived', subject: 'allAllies' }, { key: 'dp-any' }, () => seen.push('any'));
  bindTrigger(battle, a, { event: 'statusApplied:anyOnAlly', subject: 'enemy' }, { key: 'on-ally' }, ({ target }) => seen.push(`hit:${target.uid}`));
  battle.getPlayer('p1').dp = 10;
  gainDP(battle, b, 2, 'test');
  gainDP(battle, a, 1, 'test'); // the watcher's own DP: not 「其他干员」
  flush();
  applyStatus(battle, e, b, { status: 'stun', duration: 1 });
  applyStatus(battle, b, e, { status: 'stun', duration: 1 }); // on an enemy: no
  flush();
  assert.deepEqual(seen.filter((s) => s.startsWith('other:')), ['other:u-b:2']);
  assert.equal(seen.filter((s) => s === 'any').length, 2, 'the native dpReceived (any source) still counts every gain');
  assert.deepEqual(seen.filter((s) => s.startsWith('hit:')), ['hit:u-b']);
});

test('each adapted card retains its source summon templates and its manually configured module bridge', () => {
  const { runtime } = synergyBattleRuntime();
  let checked = 0, modules = 0;
  for (const body of Object.values(runtime.bodies)) {
    assert.ok(body.adaptation);
    for (const slot of body.source?.skills ?? []) if (slot?.overrideTokenKey) { assert.ok(runtime.summons[slot.overrideTokenKey], `${body.charId}: ${slot.overrideTokenKey}`); checked++; }
    // a talent's family key without a template of its own (凛御银灰's eagle) is stood for by the skills' overrides
    const overrides = (body.source?.skills ?? []).some((slot) => slot?.overrideTokenKey);
    for (const talent of body.talentBindings ?? []) if (talent.nativeTalent?.tokenKey && (runtime.summons[talent.nativeTalent.tokenKey] || !overrides)) { assert.ok(runtime.summons[talent.nativeTalent.tokenKey], `${body.charId}: ${talent.nativeTalent.tokenKey}`); checked++; }
    for (const module of body.modulePlans ?? []) for (const tokenId of Object.keys(module.theme?.tokenBlackboards ?? {})) {
      assert.ok(runtime.summons[tokenId], `${body.charId} module ${module.id}: ${tokenId}`);
      checked++; modules++;
    }
    for(const manual of body.adaptation.manualSummons??[]){assert.ok(runtime.summons[manual.tokenId],body.charId);checked++;}
    modules+=body.modulePlans.filter(m=>m.keyword==='summonCharge'&&body.adaptation.manualSummons?.length>0).length;
  }
  assert.ok(checked > 0);
  assert.ok(modules > 0, 'at least one module bridges an original manually placed summon into charging');
});

test('设计表的凋亡写作 necrosis：elementBurst:necrosis / elementHit:necrosis 听引擎的凋亡 (apoptosis)', () => {
  const enemy = { side: 'enemy' };
  assert.ok(EVENTS.elementBurst.accept({ target: enemy, element: 'apoptosis' }, 'necrosis'));
  assert.ok(EVENTS.elementHit.accept({ target: enemy, element: 'apoptosis' }, 'necrosis'));
  assert.ok(EVENTS.elementBurst.accept({ target: enemy, element: 'apoptosis' }, 'apoptosis'));
  assert.equal(EVENTS.elementBurst.accept({ target: enemy, element: 'burn' }, 'necrosis'), false);
});

test('召唤物模板：天赋只写家族键、由各技能覆盖成具体模板时（凛御银灰的鹰），编译各技能的模板，不要家族键', async () => {
  const { sourceTokenIds } = await import('../../tools/assault/build-runtime-data.mjs');
  const body = (charId, skills, talentKey) => ({
    charId, bazaar: { format: 'synergy' }, fixedSkill: { source: { native: skills[0] } },
    source: { skills }, modulePlans: [], defaultModuleId: null,
    talentBindings: [{ mode: 'retain', nativeTalentIndex: 0, nativeTalent: { tokenKey: talentKey } }],
  });
  const table = { tok_eagle1: {}, tok_eagle2: {}, tok_solo: {} };
  const refs = sourceTokenIds({
    a: body('char_a', [{ skillId: 's1', index: 0, overrideTokenKey: 'tok_eagle1' }, { skillId: 's2', index: 1, overrideTokenKey: 'tok_eagle2' }], 'tok_eagle'),
    b: body('char_b', [{ skillId: 's1', index: 0 }], 'tok_solo'),
    c: body('char_c', [{ skillId: 's1', index: 0 }], 'tok_missing'),
  }, table);
  assert.ok(refs.has('tok_eagle1') && refs.has('tok_eagle2'));
  assert.ok(refs.has('tok_solo'));
  // a missing key with no skill override still reaches compile, which fails loudly
  assert.ok(refs.has('tok_missing'));
  assert.equal(refs.has('tok_eagle'), false);
});

test("subject 'enemy' 是事件里敌方一侧：攻击此干员的敌人 · 爆发的敌人 · 倒下的敌人", () => {
  const { battle, op, flush } = makeBattle({ ops: [{ id: 'w', col: 3 }, { id: 'c', col: 6 }], enemies: [{ pos: [10, 9] }, { pos: [10, 4] }] });
  const w = op('w'), c = op('c');
  const [a, b] = battle.enemies;
  const seen = [];
  for (const event of ['damageTaken', 'hit', 'elementBurst:burn', 'death']) {
    bindTrigger(battle, w, { event, subject: 'enemy' }, { key: `foe:${event}` }, ({ actor }) => seen.push(`${event}:${actor?.uid ?? actor?.id}`));
  }
  damage(battle, a, w, { amount: 1, type: 'phys', isAttack: true });
  damage(battle, a, c, { amount: 1, type: 'phys', isAttack: true }); // another operator is hit: not this one's line
  battle.assaultRuntime.publish('elementBurst', { source: c, target: b, element: 'burn' });
  battle.assaultRuntime.publish('elementBurst', { source: c, target: b, element: 'neural' });
  damage(battle, c, b, { amount: 1e7, type: 'true' });
  flush();
  const id = (x) => x.uid ?? x.id;
  assert.deepEqual(seen.sort(), [`damageTaken:${id(a)}`, `death:${id(b)}`, `elementBurst:burn:${id(b)}`, `hit:${id(a)}`].sort());
});

test('敌方子弹：攻击范围内减速（飞得久但仍命中、离开即恢复、结束即恢复）· 清除范围内的、不碰范围外和友方的', () => {
  const { battle, op, run } = makeBattle({ ops: [{ id: 'w', col: 3 }], enemies: [{ pos: [10, 9] }] });
  const w = op('w');
  const [shooter] = battle.enemies;
  const inRange = [...w.rangeKeys].map((k) => ({ y: Math.floor(k / 21), x: k % 21 })).find((t) => t.x !== w.tileC || t.y !== w.tileR);
  const far = { x: 18, y: 2 };
  const flight = (from, slow) => {
    let landed = null;
    const p = battle.addProjectile({ from, to: { x: from.x, y: from.y + 1e-9 }, speed: 1e-3, source: shooter, onHit: () => { landed = battle.time; } });
    p.tx = from.x + 0.45; p.ty = from.y; // flies 0.45 tile, staying on the range tile
    const start = battle.time;
    if (slow) slowEnemyProjectiles(battle, w, { key: 'test', pct: 0.8 });
    p.speed = 1;
    run(3);
    if (slow) endEnemyProjectileSlow(battle, w, 'test');
    run(0.1);
    return landed == null ? null : landed - start;
  };
  // the same flight: free, then slowed by 80 % while on the range tile
  const free = flight(inRange, false);
  const slowed = flight(inRange, true);
  assert.ok(free != null && slowed != null, `both land (${free}, ${slowed})`);
  assert.ok(slowed > free * 3, `slowed flight ${slowed}s vs ${free}s`);
  // a slowed projectile recovers when the effect ends, and when it leaves the range tiles
  const long = battle.addProjectile({ from: inRange, to: { x: inRange.x + 0.4, y: inRange.y }, speed: 0.01, source: shooter });
  slowEnemyProjectiles(battle, w, { key: 'test', pct: 0.8 });
  run(0.1);
  assert.ok(Math.abs(long.speed - 0.002) < 1e-9, `slowed to ${long.speed}`);
  endEnemyProjectileSlow(battle, w, 'test');
  run(0.1);
  assert.equal(long.speed, 0.01);
  slowEnemyProjectiles(battle, w, { key: 'test', pct: 0.8 });
  run(0.1);
  long.x = far.x; long.y = far.y; long.tx = far.x + 0.4; long.ty = far.y;
  run(0.1);
  assert.equal(long.speed, 0.01, 'off the range tiles it flies at full speed');
  endEnemyProjectileSlow(battle, w, 'test');
  battle.projectiles.list = battle.projectiles.list.filter((x) => x !== long);
  // clearing: in range gone without a hit, out of range and the operators' own projectiles stay
  let hits = 0;
  const mk = (from, source) => battle.addProjectile({ from, to: { x: from.x + 5, y: from.y }, speed: 0.01, source, onHit: () => { hits++; } });
  const inside = mk(inRange, shooter), outside = mk(far, shooter), ours = mk(inRange, w);
  assert.deepEqual(enemyProjectilesIn(battle, w), [inside]);
  assert.equal(clearEnemyProjectiles(battle, w), 1);
  assert.ok(!battle.projectiles.list.includes(inside) && battle.projectiles.list.includes(outside) && battle.projectiles.list.includes(ours));
  assert.equal(hits, 0);
});
