import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { installRelics } from '../../server/sim/content/assault/relics.js';
import {
  assaultAmmoState,
  consumeAssaultAmmo,
  reloadAssaultAmmo,
} from '../../server/sim/content/assault/ammo.js';

const design = loadAssaultDesign();
const runtimeData = loadAssaultRuntime();
getAssaultData({ runtime: runtimeData });

const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 1e-9,
  `${message}: expected ${expected}, got ${actual}`,
);

function card(uid, charId, { star = 4, row = 10, col = 5 } = {}) {
  const body = runtimeData.bodies[charId];
  assert.ok(body, `missing Assault body ${charId}`);
  const piece = {
    uid,
    charId,
    star,
    fixedSkill: body.fixedSkill,
    moduleId: null,
    moduleChoices: {},
    sourceCopies: 1,
    permanentFlat: {},
    permanentPercent: {},
    claimed: [],
    tagEdits: { add: [], remove: [] },
  };
  const chess = chessRec({
    id: `chess:${uid}`,
    charId,
    profession: body.profession,
    position: body.position,
    subProf: body.subProfessionId,
    stats: body.starStats[star - 1].stats,
    rangeGrid: body.range,
  });
  chess.trait = structuredClone(body.simChess.trait);
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { uid, chess, piece, row, col };
}

const enemy = (key, pos, opts = {}) => ({
  key,
  pos,
  record: enemyRec({
    key,
    hp: opts.hp ?? 100000000,
    atk: opts.atk ?? 0,
    def: opts.def ?? 0,
    res: opts.res ?? 0,
    speed: 0,
    ...opts,
  }),
});

function makeBattle({
  relicIds,
  cards = [card('owner', 'char_1045_svash2')],
  enemies = [],
  dpInit = 99,
  prime = false,
} = {}) {
  const chess = Object.fromEntries(cards.map((entry) => [entry.chess.chessId, entry.chess]));
  const enemyRecords = Object.fromEntries(enemies.map((entry) => [entry.key, entry.record]));
  const data = new DataSource({ chess, enemies: enemyRecords, tokens: {} }, getDefaultSource());
  const prepared = {
    input: {
      relicIds,
      pieces: cards.map((entry) => entry.piece),
      gold: 20,
      derivedBuffInputs: [],
    },
  };
  const battle = new Battle({
    kind: 'normal',
    modeId: 'assault-relic-ammo-element-behavior',
    stage: flatStage(),
    routes: flatRoutes(),
    spawns: [],
    data,
    players: [{
      playerId: 'p1',
      units: cards.map((entry) => ({
        uid: entry.uid,
        chessId: entry.chess.chessId,
        row: entry.row,
        col: entry.col,
      })),
    }],
    content: 'assault',
    assault: {
      kits: assaultKits,
      strict: true,
      install: (b) => installRelics(b, prepared, { design }),
    },
    flags: { dpInit, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 },
    autoFinish: false,
    timeLimit: 60,
    quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} },
  });
  battle.start();
  battle.assaultRuntime.flush();
  const liveEnemies = enemies.map((entry) => battle.spawnEnemy(entry.key, {
    routeIndex: 0,
    pos: entry.pos,
  }));
  if (prime) {
    battle.step();
    battle.assaultRuntime.flush();
  }
  return {
    battle,
    units: cards.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.uid)),
    enemies: liveEnemies,
  };
}

const flush = (battle) => battle.assaultRuntime.flush();

function runSeconds(battle, seconds) {
  const steps = Math.ceil(seconds / battle.dt);
  for (let index = 0; index < steps; index += 1) battle.step();
  flush(battle);
}

function castAmmo(battle, unit) {
  assert.ok(unit.skill?.spCost > 0);
  const activations = unit.skill.activations;
  unit.skill.setSpTotal(unit.skill.spCost);
  battle.assaultRuntime.flush();
  if (unit.skill.activations === activations) assert.equal(unit.skill.activate('fixture'), true, JSON.stringify({ uid: unit.uid,
    deployed: unit.deployed, alive: unit.alive, cost: unit.s.cost, sp: unit.skill.spTotal,
    active: unit.skill.active, ammo: assaultAmmoState(unit) }));
  assert.ok(unit.skill.activations > activations, 'native Battle records the skill activation');
  flush(battle);
}

function findFireworkChar() {
  const wanted = new Set([
    '速射手', '回环射手', '哨戒铁卫',
    'fastshot', 'loopshooter', 'sentinel', 'watchman',
  ]);
  const entry = Object.entries(runtimeData.bodies).find(([charId, body]) => {
    if (!assaultKits[charId] || !body.fixedSkill) return false;
    const values = [
      body.archetype,
      body.subProfession,
      body.subProfessionId,
      ...(body.tags ?? []),
    ].filter(Boolean).map(String);
    return values.some((value) => wanted.has(value));
  });
  assert.ok(entry, 'no source-backed firework archetype with a native Assault kit');
  return entry[0];
}

// 隐现 is a synergy card (design of 2026-10-21): her skill loads a full pool and every attack spends one round
test('ammo ledger drives charset, anthology, collar, and exact native net reloads', () => {
  const setup = makeBattle({
    relicIds: ['ammo-charsetglossary', 'ammo-anthology', 'ammo-holycollar'],
    cards: [card('ammo-owner', 'char_498_inside')],
    enemies: [enemy('ammo-target', [10, 6]), enemy('speed-target', [10, 9])],
    prime: true,
  });
  const [unit] = setup.units;
  const [target] = setup.enemies;
  const reloads = [];
  const ammoUsed = [];

  setup.battle.on('ammoUsed', (event) => {
    if (event.source === unit && event.assaultAmmo) ammoUsed.push(event);
  });
  setup.battle.on('reloaded', (event) => {
    if (event.target === unit && event.assaultAmmo) reloads.push(event);
  });

  castAmmo(setup.battle, unit);
  const loaded = assaultAmmoState(unit);
  assert.ok(loaded && loaded.current === loaded.capacity-1, 'one cast spends one battle use');
  assert.equal(Object.prototype.propertyIsEnumerable.call(unit, '_assaultAmmoController'), false);
  assert.equal(ammoUsed.length, 1, 'casting spends one use');

  for (let index = 0; index < 6 * loaded.capacity && new Set(reloads.map(e=>e.sourceKey)).size < 2; index += 1) {
    castAmmo(setup.battle, unit);
    flush(setup.battle);
  }

  assert.ok(ammoUsed.length > 0 && ammoUsed.every((event) => event.quantity === 1), 'each attack spends one round');
  assert.ok(reloads.length >= 2);
  assert.deepEqual(
    new Set(reloads.map((event) => event.sourceKey)),
    new Set(['relic:ammo-charsetglossary:0', 'relic:ammo-anthology:0']),
  );

  const ratios = new Map([
    ['relic:ammo-charsetglossary:0', 0.2],
    ['relic:ammo-anthology:0', 0.35],
  ]);
  for (const event of reloads) {
    const before = event.left - event.amount;
    const expected = event.ammoMax - before;
    assert.equal(event.amount, expected);
    assert.equal(event.left, before + expected);
  }

  const collar = unit.buffs.find((entry) => entry.key === 'relic:ammo-holycollar:0');
  assert.ok(collar);
  close(collar.timeLeft, 5, 'holy collar duration');

  runSeconds(setup.battle, 3);
  assert.equal(consumeAssaultAmmo(setup.battle, unit, 1, 'test:native-consume'), 1);
  assert.equal(reloadAssaultAmmo(setup.battle, unit, unit, 1, 'test:native-reload'), 1);
  flush(setup.battle);

  assert.equal(unit.buffs.filter((entry) => entry.key === 'relic:ammo-holycollar:0').length, 1, 'holy collar does not stack');
  close(unit.findBuff('relic:ammo-holycollar:0').timeLeft, 5, 'holy collar refresh');
  assert.equal(setup.battle.applyStatus(unit, 'silence', { duration: 10, source: target }), true);
  unit.skill.spType = 'none';
  runSeconds(setup.battle, 6);
  assert.equal(Boolean(unit.findBuff('relic:ammo-holycollar:0')), false, 'collar expires when no later real reload occurs');
});

// 刻纹铜板 on a loading ammo skill (隐现, a synergy card since 2026-10-21): 弹药技能期间 is while her pool holds rounds
// (and the late hits of the attacks that spent one); the stacks clear as the first attack after the last round starts
// one ranged (隐现) and one assault (圣约送葬人) loading ammo card
for (const [name, charId, at] of [['隐现', 'char_498_inside', [10, 6]], ['圣约送葬人', 'char_1032_excu2', [10, 5]]]) test(`传芳雕版 on ${name}: battle uses are spent by casts, loaded hits accumulate, and an empty pool clears the bonus`, () => {
 const setup=makeBattle({relicIds:['ammo-carvedplate'],cards:[card('carve-owner',charId,{col:4})],enemies:[enemy('ammo-target',at,{hp:1e9})],prime:false});
 const [unit]=setup.units,[target]=setup.enemies;unit.skill.spType='none';unit.skill.setSpTotal(0);
 const stacks=()=>unit.findBuff('relic:ammo-carvedplate:0')?.stacks??0,capacity=assaultAmmoState(unit).capacity;
 assert.equal(stacks(),0);
 setup.battle._buildEnemyIndex();setup.battle.forceAttack(unit,[target]);runSeconds(setup.battle,.5);
 assert.equal(assaultAmmoState(unit).current,capacity,'a basic attack never spends a cast');assert.ok(stacks()>0);
 const amounts=[];setup.battle.on('hit',({source,dmg})=>{if(source===unit&&dmg.isSkill)amounts.push(dmg.amount);},{priority:-100});
 castAmmo(setup.battle,unit);assert.equal(assaultAmmoState(unit).current,capacity-1);assert.ok(stacks()>0&&stacks()<=20);
 for(let i=1;i<capacity;i++)castAmmo(setup.battle,unit);
 assert.equal(assaultAmmoState(unit).current,0);assert.equal(stacks(),0,'the final complete action finishes before the pool bonus clears');
 assert.ok(amounts.length>=capacity);assert.ok(target.hp<target.s.maxHp);
 setup.battle.forceAttack(unit,[target]);flush(setup.battle);assert.equal(stacks(),0,'unloaded basic attacks cannot restart the bonus');
});

// 旧弹匣 keeps its own six rounds (not the card's skill state): 新约能天使's synergy card spends them one per hit
test('旧弹匣 on 新约能天使: six hits carry the 40% bonus, the seventh none', () => {
  const setup = makeBattle({
    relicIds: ['leader-angel2-oldmagazine'],
    cards: [card('magazine-owner', 'char_1041_angel2', { col: 4 })],
    enemies: [enemy('magazine-target', [10, 6], { hp: 1e9 })],
  });
  const [owner] = setup.units;
  const [target] = setup.enemies;
  owner.skill.spType='none';owner.skill.charges=0;owner.skill.sp=0;
  const dealt = [];
  for (let i = 0; i < 8; i += 1) {
    const before = target.hp;
    assert.equal(setup.battle.forceAttack(owner, [target], { noAmmo: true }), true);
    owner.atkCd = 60; // only the forced attacks hit
    runSeconds(setup.battle, 0.5);
    dealt.push(before - target.hp);
  }
  const hits = dealt.map((x) => Math.round(x));
  assert.ok(hits.every((x) => x > 0), JSON.stringify(hits));
  assert.ok(Math.min(...hits.slice(0, 6)) > Math.max(...hits.slice(6)), `the first six attacks spend the old magazine ${JSON.stringify(hits)}`);
});

test('firework uses the native archetype, bound RNG, four-neighbor splash, and no recursive hit chain', () => {
  const charId = findFireworkChar();
  const setup = makeBattle({
    relicIds: ['ammo-fireworkhand'],
    cards: [card('firework-owner', charId, { col: 5 })],
    enemies: [
      enemy('center', [10, 6]),
      enemy('north', [9, 6]),
      enemy('south', [11, 6]),
      enemy('west', [10, 5]),
      enemy('east', [10, 7]),
    ],
    prime: true,
  });
  const [unit] = setup.units;
  const [center] = setup.enemies;
  const extraHits = [];
  const nativeHits = [];
  const rolls = [];
  const nativeChance = setup.battle.rng.chance.bind(setup.battle.rng);
  setup.battle.rng.chance = (probability) => {
    const result = nativeChance(probability);
    if (probability === 0.2) rolls.push(result);
    return result;
  };
  setup.battle.assaultRuntime.observe(
    'hit',
    'test:firework-hit',
    (event) => {
      if (event.payload?.attackId === 'relic:ammo-fireworkhand:0') extraHits.push(event.payload);
      else if (event.payload?.source === unit && Number.isFinite(event.payload?.attackId)) nativeHits.push(event.payload);
    },
    { owner: {} },
  );

  const attacksBefore = unit.stats.attacks;
  unit.atkCd = 1000;
  for (let index = 0; index < 80; index += 1) {
    assert.equal(setup.battle.forceAttack(unit, [center]), true);
    flush(setup.battle);
  }
  runSeconds(setup.battle, 2);
  const nativeAttacks = unit.stats.attacks - attacksBefore;
  assert.ok(nativeAttacks > 0);
  assert.ok(extraHits.length > 0, 'fixed native RNG sequence produced a firework proc');
  assert.equal(extraHits.length % 5, 0, 'one proc damages target plus four cardinal neighbors');
  assert.ok(extraHits.length <= nativeAttacks * 5, 'firework damage does not recursively retrigger itself');
  assert.equal(rolls.length, nativeHits.length, 'one native probability decision per eligible numeric hit');
  assert.equal(extraHits.length, rolls.filter(Boolean).length * 5, 'all cardinal recipients share that one decision');
  for (const hit of extraHits) close(hit.amount, unit.s.atk * 1.2, 'compiled 120% physical coefficient');
});

test('element auras use native target stats, direct damage types, and late enemy/allied entry', () => {
  const setup = makeBattle({
    relicIds: ['element-catastrophe', 'element-wotuncle'],
    cards: [card('ranged-owner', 'char_1041_angel2', { col: 2 })],
    enemies: [enemy('initial', [10, 6], { res: 0 })],
  });
  const [owner] = setup.units;
  const [initial] = setup.enemies;

  close(initial.s.artsTakenMul, 1.08, 'catastrophe arts vulnerability');
  close(initial.s.elemTakenMul, 1.25, 'catastrophe element vulnerability');

  const lateEnemy = setup.battle.spawnEnemy('initial', { routeIndex: 0, pos: [10, 7] });
  close(lateEnemy.s.artsTakenMul, 1.08, 'late enemy catastrophe arts vulnerability');
  close(lateEnemy.s.elemTakenMul, 1.25, 'late enemy catastrophe element vulnerability');

  owner.hp = owner.s.maxHp - 400;
  const beforeArts = owner.hp;
  assert.equal(setup.battle.dealDamage(initial, owner, {
    amount: 100,
    type: 'arts',
    canDodge: false,
  }), 90);
  assert.equal(beforeArts - owner.hp, 90, 'native source RES10 is unchanged by the gauge reduction');

  const beforeElement = owner.hp;
  assert.equal(setup.battle.dealDamage(initial, owner, {
    amount: 100,
    type: 'element',
    element: 'burn',
    canDodge: false,
  }), 80);
  assert.equal(beforeElement - owner.hp, 0);
  assert.equal(owner.elem.burn, 80);
  close(owner.s.elemTakenMul, 0.8, 'ranged element damage reduction');

  const lateAlly = makeBattle({
    relicIds: ['element-wotuncle'],
    cards: [card('late-ranged', 'char_1041_angel2', { col: 2 })],
    dpInit: 0,
  });
  const [lateUnit] = lateAlly.units;
  assert.equal(lateUnit.deployed, true, 'the opening entry is free');
  lateAlly.battle.retreat(lateUnit, { reason: 'test' });
  assert.equal(lateUnit.deployed, false);
  lateAlly.battle.addDp('p1', 99);
  assert.equal(lateAlly.battle.redeploy(lateUnit, { free: false }), true);
  flush(lateAlly.battle);
  assert.equal(lateUnit.deployed, true);
  close(lateUnit.s.elemTakenMul, 0.8, 'late ranged ally reduction');
});

test('native element gauge burst applies exact burst modifiers, refreshes vulnerability, and grants afterglow', () => {
  const setup = makeBattle({
    relicIds: ['element-ameng', 'element-riverblessing', 'element-houndremedy'],
    cards: [card('burst-owner', 'char_1041_angel2')],
    enemies: [enemy('burst-target', [10, 6], { hp: 1000000 })],
  });
  const [owner] = setup.units;
  const [target] = setup.enemies;
  const bursts = [];

  setup.battle.on('elementBurst', (event) => {
    if (event.target === target) bursts.push(event);
  });

  const before = target.hp;
  const gauge = setup.battle.dealDamage(owner, target, {
    amount: target.gaugeMax,
    type: 'element',
    element: 'burn',
    canDodge: false,
  });
  flush(setup.battle);

  assert.equal(gauge, target.gaugeMax);
  assert.equal(bursts.length, 1);
  assert.equal(before - target.hp, 7000 * 1.3 * 1.3);
  assert.ok(target.findBuff('relic:element-riverblessing:1:burn'));

  const vulnerability = target.findBuff('relic:element-riverblessing:1:burn');
  close(vulnerability.timeLeft, 3, 'river blessing vulnerability duration');
  const beforeFollowup = target.hp;
  assert.equal(setup.battle.dealDamage(owner, target, {
    amount: 100,
    type: 'elemental',
    element: 'burn',
    canDodge: false,
  }), 100);
  assert.equal(beforeFollowup - target.hp, 100);
  const hpBeforeGauge = target.hp;
  assert.equal(setup.battle.dealDamage(owner, target, { amount: 40, type: 'element', element: 'burn', canDodge: false }), 46);
  assert.equal(setup.battle.dealDamage(owner, target, { amount: 40, type: 'element', element: 'neural', canDodge: false }), 40);
  assert.equal(target.hp, hpBeforeGauge);

  const afterglow = owner.findBuff('relic:element-houndremedy:0');
  assert.ok(afterglow);
  close(owner.s.aspd - owner.base.aspd, 25, 'hound remedy attack speed');
  close(afterglow.timeLeft, 5, 'hound remedy duration');
  assert.equal(owner.buffs.filter((entry) => entry.key === 'relic:element-houndremedy:0').length, 1);
  const hpBeforeSecond = target.hp;
  setup.battle.dealDamage(owner, target, { amount: target.gaugeMax, type: 'element', element: 'burn', canDodge: false });
  flush(setup.battle);
  assert.equal(bursts.length, 2, 'enemy gauge permits another real burst without a legacy cooldown');
  close(hpBeforeSecond - target.hp, 7000 * 1.3 * 1.3, 'each repeated burst receives its exact modifiers');
  assert.equal(target.buffs.filter(buff => buff.key === 'relic:element-riverblessing:1:burn').length, 1);
  close(target.findBuff('relic:element-riverblessing:1:burn').timeLeft, 3, 'same-element refresh');
  owner.atkCd = 1000;
  assert.equal(setup.battle.applyStatus(owner, 'silence', { duration: 10, source: target }), true);
  runSeconds(setup.battle, 3.1);
  assert.equal(Boolean(target.findBuff('relic:element-riverblessing:1:burn')), false);
  assert.equal(setup.battle.dealDamage(owner, target, { amount: 40, type: 'element', element: 'burn', canDodge: false }), 40);
});

test('hound remedy suppresses the triggering native apoptosis DOT after its attack-speed buff expires', () => {
  const results = [];
  for (const relicIds of [[], ['element-houndremedy']]) {
    const setup = makeBattle({ relicIds, cards: [card('self-burst-owner', 'char_1041_angel2')] });
    const [owner] = setup.units;
    const hits = [];
    setup.battle.on('damaged', event => {
      if (event.target === owner && event.dmg?.tags?.includes('burst') && event.dmg.element === 'apoptosis') {
        hits.push({ t: setup.battle.time, amount: event.amount });
      }
    });
    setup.battle.dealDamage(owner, owner, { amount: owner.gaugeMax, type: 'element', element: 'apoptosis', canDodge: false });
    flush(setup.battle);
    assert.ok(owner.findBuff('apoptosisBurst'));
    if (relicIds.length) close(owner.findBuff('relic:element-houndremedy:0').timeLeft, 5, 'triggered afterglow duration');
    runSeconds(setup.battle, 5.1);
    assert.equal(Boolean(owner.findBuff('relic:element-houndremedy:0')), false, 'five-second speed buff expires');
    assert.ok(owner.findBuff('apoptosisBurst'), 'the triggering native DOT is still active');
    runSeconds(setup.battle, 9);
    results.push(hits);
    assert.equal(setup.battle.errors.length, 0);
  }
  assert.ok(results[0].length >= 13, 'same native DOT damages the baseline ally each second');
  assert.ok(results[0].some(hit => hit.t > 5), 'baseline DOT continues after five seconds');
  assert.equal(results[1].length, 0, 'same-instance immunity persists for the entire original DOT');
});

test('ice-fire aura separately scales real enemy gauge and burst HP damage, including late spawns', () => {
  const setup = makeBattle({ relicIds: ['cross-icefire'], enemies: [enemy('icefire-target', [10, 6])] });
  const [owner] = setup.units;
  for (const target of [setup.enemies[0], setup.battle.spawnEnemy('icefire-target', { routeIndex: 0, pos: [10, 7] })]) {
    close(target.s.elemTakenMul, 1.25, 'gauge multiplier on each actual spawn');
    const before = target.hp;
    const gauge = setup.battle.dealDamage(owner, target, { amount: target.gaugeMax / 1.25, type: 'element', element: 'burn', canDodge: false });
    flush(setup.battle);
    close(gauge, target.gaugeMax, 'gauge reaches its real threshold');
    close(before - target.hp, 7000 * 1.25, 'independent 125% native burst HP damage');
    close(setup.battle.dealDamage(owner, target, { amount: 100, type: 'elemental', element: 'burn', canDodge: false }), 100, 'ordinary elemental HP damage is unchanged');
  }
  assert.equal(setup.battle.errors.length, 0);
});
