import test from 'node:test';
import assert from 'node:assert/strict';
import { installKeywordGear } from '../../server/sim/content/independent/keywordGear.js';
import { KEYWORD_GEAR } from '../../server/modes/independent/keywordGear.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const gearDefs = Object.fromEntries(KEYWORD_GEAR.map((g) => [`test:${g.id}`, { id: `test:${g.id}`, sourceId: `test:${g.id}`, available: true, mechanism: g.mechanism, params: g.params }]));
function setup(pieces, { atk = 100, def = 0, enemyHp = 100000, enemyDef = 0, enemyAtk = 0, seed = 11, catalog: customCatalog = null } = {}) {
  const catalog = customCatalog ?? { equipment: gearDefs };
  const full = pieces.map((p) => ({ attachments: [], equipment: [], ...p }));
  const h = makeBattle({
    seed,
    units: full.map(({ uid, chessId, row, col }) => ({ uid, chessId, row, col })),
    defs: {
      chess: Object.fromEntries(full.map((p) => [p.chessId, chessRec({ id: p.chessId, skill: null, stats: { atk, maxHp: 1000, def: p.def ?? def, res: 0, aspd: 100, spRecovery: 0, respawnTime: 20 }, rangeGrid: [[0, 0], [0, 1]] })])),
      enemies: { dummy: enemyRec({ key: 'dummy', hp: enemyHp, def: enemyDef, res: 0, speed: 0, atk: enemyAtk }) },
    },
    autoFinish: false, content: 'none',
    setup(b) {
      b.on('shieldLayersGained', (ctx) => { b.testShieldGained = (b.testShieldGained || 0) + ctx.layers; });
      b.on('shieldLayersBroken', (ctx) => { b.testShieldBroken = (b.testShieldBroken || 0) + ctx.layers; });
      b.on('shieldLayersThreshold', (ctx) => { b.testShieldThreshold = (b.testShieldThreshold || 0) + 1; });
    },
    extraContent: [(b) => installKeywordGear(b, { catalog, pieces: full })],
  });
  h.step(1);
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  for (const u of h.b.allyUnits) if (u.kind === 'op') u.atkCd = 1e9;
  return h;
}
const worn = (id, quantity = 1) => ({ id: `test:${id}`, quantity });
const enemy = (h, pos = [10, 10]) => h.spawn('dummy', { pos });
const lost = (u) => u.s.maxHp - u.hp;

test('catalog exposes stable ids, one mechanism and explicit parameter records', () => {
  assert.equal(KEYWORD_GEAR.length, 9);
  assert.equal(new Set(KEYWORD_GEAR.map((g) => g.id)).size, KEYWORD_GEAR.length);
  for (const g of KEYWORD_GEAR) assert.ok(g.id && g.name && g.mechanism === 'keywordGear' && g.params && Object.hasOwn(g, 'level'));
});

test('坚守盟约 stacks linearly, caps and splits post-mitigation damage evenly among live wearers', () => {
  const h = setup([
    { uid: 'a', chessId: 'a', row: 10, col: 3, def: 1000, equipment: [worn('oath-cover', 2)] },
    { uid: 'b', chessId: 'b', row: 11, col: 3, def: 1000, equipment: [worn('oath-cover', 2)] },
    { uid: 'victim', chessId: 'victim', row: 12, col: 3 },
  ], { def: 0 });
  const shot = enemy(h, [10, 19]); const a = h.unit('a'), b = h.unit('b'), victim = h.unit('victim');
  h.b.dealDamage(shot, victim, { amount: 100, type: 'phys', canDodge: false });
  assert.ok(Math.abs(lost(victim) - 75) < 1e-6, 'N=2 holders share 25% once, not 25% each');
  assert.ok(Math.abs(lost(a) - 10.625) < 1e-6);
  assert.ok(Math.abs(lost(b) - 10.625) < 1e-6);
  const before = lost(a);
  h.b.dealDamage(shot, a, { amount: 100, type: 'true', canDodge: false });
  assert.ok(Math.abs(lost(a) - before - 85) < 1e-6, `wearer direct guard is 15% and is not shared again (${lost(a) - before})`);
});

test('护盾发生器 grants 5 + 3(N−1) hit layers per deploy; native shields coexist and gain/break events count deltas', () => {
  const h = setup([{ uid: 'w', chessId: 'w', row: 10, col: 3, equipment: [worn('shield-generator', 2)] }]);
  const w = h.unit('w');
  assert.equal(w.findBuff('independent:keywordGear:shield-generator:w:layers')?.shieldHits, 8);
  assert.equal(h.b.testShieldGained, 8, 'initial deployment reported exactly eight gained layers');
  h.b.addBuff(w, { key: 'native-test-shield', shieldHits: 2, duration: 10 });
  h.b.addBuff(w, { key: 'independent:keywordGear:shield-generator:w:layers', shieldHits: 8, duration: Infinity, persist: true, refresh: 'replace' });
  assert.equal(h.b.testShieldGained, 10, 'same-count refresh adds no phantom layers');
  const shot = enemy(h, [10, 19]);
  for (let i = 0; i < 5; i++) h.b.dealDamage(shot, w, { amount: 100, type: 'true' });
  assert.equal(h.b.testShieldBroken, 5, 'all hit shields report one broken layer per absorbed hit');
  assert.equal(h.b.testShieldThreshold, 1, 'the configured five-layer threshold fires once, not once per broken layer');
  assert.equal(w.hp, w.s.maxHp, 'hit-negating layers prevent HP loss');
});

test('突袭盟约 waits for idle, reuses legal raid landing and the deploy event grants its timed ASPD', () => {
  const h = setup([{ uid: 'w', chessId: 'w', row: 10, col: 3, equipment: [worn('assault-oath', 2)] }]);
  const w = h.unit('w'); const target = enemy(h, [10, 10]); const before = w.deploySeq;
  h.run(9.9);
  assert.equal(w.deploySeq, before, 'ready or install does not shorten the idle timer');
  h.run(1.2);
  assert.ok(w.deploySeq > before && w.alive && w.deployed, 'one real retreat/redeploy landed at a legal attack tile');
  assert.ok(w.findBuff('independent:keywordGear:assault-oath:w:aspd'));
  assert.ok(w.rangeKeys.includes(target.tileR * 21 + target.tileC) || Math.hypot(w.x - target.x, w.y - target.y) <= 2, 'the raid target is attackable from landing');
  assert.equal(h.b.errorCount, 0);
});

test('巨锤盟约 uses one normal attack action and excludes skill attacks from adjacent splash', () => {
  const catalog = { equipment: { ...gearDefs, 'hammer:test': { ...gearDefs['test:hammer-oath'], id: 'hammer:test', params: { ...gearDefs['test:hammer-oath'].params, baseAtkRatio: 0.5, perPieceAtkRatio: 0.25 } } } };
  const pieces = [{ uid: 'w', chessId: 'w', row: 10, col: 3, equipment: [{ id: 'hammer:test', quantity: 2 }] }];
  const h = setup(pieces, { catalog });
  const w = h.unit('w'); const primary = enemy(h, [10, 10]); const near = enemy(h, [10, 10.8]);
  h.b.emit('attack', { attacker: w, targets: [primary], isSkill: false });
  assert.ok(Math.abs(lost(near) - 75) < 1e-6);
  const before = lost(near);
  h.b.emit('attack', { attacker: w, targets: [primary], isSkill: true });
  assert.equal(lost(near), before);
});

test('精准盟约 uses the native DEF/RES ignore fields with capped per-piece growth', () => {
  const h = setup([{ uid: 'w', chessId: 'w', row: 10, col: 3, equipment: [worn('precision-oath', 100)] }]);
  assert.equal(h.unit('w').s.defIgnorePct, 0.8);
  assert.equal(h.unit('w').s.resIgnorePct, 0.8);
});

test('不屈盟约 revives once per real ground retreat; random tile airdrop chooses among legal enemy tiles and deals only there', () => {
  const h = setup([{ uid: 'w', chessId: 'w', row: 10, col: 3, equipment: [worn('unyielding-oath'), worn('recoil-airdrop', 2)] }], { enemyHp: 50000 });
  const w = h.unit('w'); const target = enemy(h, [9, 3]);
  h.b.rng = () => 0;
  h.b.retreat(w, { reason: 'retreat' });
  assert.ok(w.alive && w.deployed, 'one successful roll freely redeploys at the rest tile');
  const tileEvents = h.eventsOf('keywordGearRandomTile');
  assert.ok(tileEvents.length >= 2, 'initial deploy and re-deploy each report the selected tile');
  const tileEvent = tileEvents.at(-1);
  assert.deepEqual(tileEvent.slice(2), [9, 3, true]);
  assert.ok(Math.abs(lost(target) - 15500) < 1e-6, 'the enemy on the selected tile alone takes 15000 + 500');
  const before = target.hp;
  h.b.kill(w);
  assert.equal(w.alive, true, 'a second distinct exit can make its own probability roll, but one exit cannot revive twice');
  assert.ok(target.hp < before, 'the deploy effect runs again only because this was a real redeployment');
});

test('爆破部署台 and 融毁教学仪 scale damage by quantity; trainer triggers on retreat, not death, once per battle', () => {
  const h = setup([{ uid: 'w', chessId: 'w', row: 10, col: 3, equipment: [worn('blast-deploy-platform', 2), worn('portable-meltdown-trainer', 2)] }], { enemyHp: 200000 });
  const w = h.unit('w'); const local = enemy(h, [10, 6]); const far = enemy(h, [10, 19]);
  h.b.emit('deploy', { unit: w, initial: false });
  assert.ok(Math.abs(lost(local) - 1300) < 1e-6, 'each deploy burst is in 4 tiles and scales to 1300');
  assert.equal(lost(far), 0, 'deploy blast does not hit beyond radius four');
  // A tracked attack counts even though no damage event is emitted.
  h.b.emit('attack', { attacker: far, targets: [w], isSkill: false });
  const before = local.hp;
  h.b.retreat(w, { reason: 'retreat' });
  assert.ok(Math.abs(before - local.hp - 13000) < 1e-6, 'untracked enemies take 10000+3000 true damage');
  assert.ok(Math.abs(far.s.maxHp - far.hp - 26000) < 1e-6, 'attacker-tagged enemy takes 2× (10000+3000) true damage');
  const after = local.hp;
  h.b.redeploy(w, { free: true });
  const afterNextDeploy = local.hp;
  h.b.retreat(w, { reason: 'retreat' });
  assert.equal(local.hp, afterNextDeploy, 'duplicate pieces add damage, not per-departure uses');
  assert.ok(afterNextDeploy < after, 'the independent deploy platform still fires on later deployments');
});

test('融毁教学仪 ignores a kill; when combined with 不屈, the retreat blast runs before the same exit immediately redeploys', () => {
  const killed = setup([{ uid: 'k', chessId: 'k', row: 10, col: 3, equipment: [worn('portable-meltdown-trainer', 1)] }]);
  const deadWearer = killed.unit('k'); const untouched = enemy(killed, [9, 3]); const oldHp = untouched.hp;
  killed.b.kill(deadWearer);
  assert.equal(untouched.hp, oldHp, 'death is not the trainer trigger');

  const h = setup([{ uid: 'w', chessId: 'w', row: 10, col: 3, equipment: [worn('unyielding-oath'), worn('portable-meltdown-trainer', 2)] }]);
  const w = h.unit('w'); const enemyHit = enemy(h, [9, 3]); const beforeDeploys = w.deploySeq;
  h.b.rng = () => 0;
  h.b.emit('attack', { attacker: enemyHit, targets: [w], isSkill: false });
  h.b.retreat(w, { reason: 'retreat' });
  assert.ok(w.alive && w.deployed && w.deploySeq > beforeDeploys, `不屈 returns (alive=${w.alive}, removed=${w.removed}, seq=${w.deploySeq}/${beforeDeploys}, errors=${JSON.stringify(h.b.errors)})`);
  assert.equal(h.hooksOf('deploy').filter((ctx) => ctx.unit === w && !ctx.initial).length, 1, 'the exit causes exactly one immediate return deployment');
  assert.equal(Math.round(enemyHit.s.maxHp - enemyHit.hp), 26000, 'trainer blast precedes the unyielding return roll');
  assert.equal(Math.round(w.stats.dmg), 26000, 'the departed wearer keeps damage credit through sourceless stat bypass');
});
