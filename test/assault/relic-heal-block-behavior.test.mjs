import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { installRelics } from '../../server/sim/content/assault/relics.js';

const design = loadAssaultDesign();
const runtimeData = loadAssaultRuntime();
getAssaultData({ runtime: runtimeData });

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
    hp: opts.hp ?? 100000,
    atk: opts.atk ?? 0,
    def: opts.def ?? 0,
    res: opts.res ?? 0,
    speed: 0,
    ...opts,
  }),
});

function observeNativeAssaultEvents(battle, events) {
  const owner = {};
  for (const type of ['heal', 'shieldGained', 'shieldBroken']) {
    battle.assaultRuntime.observe(
      type,
      `test:heal-block:${type}`,
      (event) => events[type].push(event.payload),
      { owner },
    );
  }
}

function makeBattle({
  relicIds,
  cards = [card('owner', 'char_1045_svash2')],
  enemies = [],
  dpInit = 99,
  kits = {},
  beforeStart = null,
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
    modeId: 'assault-relic-heal-block-behavior',
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
      kits: { ...assaultKits, ...kits },
      strict: true,
      install: (b) => installRelics(b, prepared, { design }),
    },
    flags: { dpInit, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 },
    autoFinish: false,
    timeLimit: 60,
    quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} },
  });
  beforeStart?.(battle);
  battle.start();
  battle.assaultRuntime.flush();
  const liveEnemies = enemies.map((entry) => battle.spawnEnemy(entry.key, {
    routeIndex: 0,
    pos: entry.pos,
  }));
  return {
    battle,
    units: cards.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.uid)),
    enemies: liveEnemies,
  };
}

const flush = (battle) => battle.assaultRuntime.flush();
const runSeconds = (battle, seconds) => {
  for (let i = 0; i < Math.ceil(seconds / battle.dt); i += 1) battle.step();
  flush(battle);
};
const relicBuffs = (unit, id) => unit.buffs.filter((entry) => entry.key.startsWith(`relic:${id}:`));
const shieldBuffs = (unit, id) => relicBuffs(unit, id).filter((entry) => Number(entry.shield) > 0);
const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 1e-9,
  `${message}: expected ${expected}, got ${actual}`,
);

test('mercenary policy does not install an opening shelter aura', () => {
  const setup = makeBattle({ relicIds: ['heal-mercenarypolicy'] });
  assert.equal(setup.units.some((unit) => unit.buffs.some((entry) => entry.key === 'relic:heal-mercenarypolicy:0')), false);
  assert.ok(setup.units.every((unit) => unit.s.dmgTakenMul === 1));
});

test('scaleshell and pharmacon use exact native layer counts, break once per layer, and refresh on redeploy', () => {
  for (const [id, layers, ratio, charId] of [
    ['heal-scaleshell', 2, 0.06, 'char_1041_angel2'],
    ['heal-pharmacon', 2, 0.08, 'char_1045_svash2'],
  ]) {
    const events = { heal: [], shieldGained: [], shieldBroken: [] };
    const setup = makeBattle({
      relicIds: [id],
      cards: [card('owner', charId, { row: 10, col: charId === 'char_1041_angel2' ? 2 : 5 })],
      enemies: [enemy('shield-breaker', [10, 6], { hp: 100000 })],
      beforeStart: (battle) => observeNativeAssaultEvents(battle, events),
    });
    const [unit] = setup.units;
    const [attacker] = setup.enemies;
    const amount = unit.s.maxHp * ratio;

    assert.equal(shieldBuffs(unit, id).length, layers);
    for (const buff of shieldBuffs(unit, id)) close(buff.shield, amount, `${id} layer amount`);

    const gained = events.shieldGained.filter((event) => event.target === unit);
    assert.equal(gained.length, layers, `${id} emits one native gain per layer`);
    assert.ok(gained.every((event) => event.shieldKind === 'hp' && Math.abs(event.amount - amount) < 1e-9));

    const hpBefore = unit.hp;
    for (let index = 0; index < layers; index += 1) {
      assert.equal(setup.battle.dealDamage(attacker, unit, {
        amount,
        type: 'true',
        canDodge: false,
      }), 0);
      flush(setup.battle);
    }
    assert.equal(unit.hp, hpBefore);
    const broken = events.shieldBroken.filter((event) => event.target === unit);
    assert.equal(broken.length, layers);
    assert.ok(broken.every((event) => event.shieldKind === 'hp' && Math.abs(event.amount - amount) < 1e-9));
    assert.equal(shieldBuffs(unit, id).length, 0);

    setup.battle.retreat(unit);
    assert.equal(setup.battle.redeploy(unit, { free: true, keepSp: true }), true);
    flush(setup.battle);
    assert.equal(shieldBuffs(unit, id).length, layers);
    assert.equal(relicBuffs(unit, id).filter((entry) => Number(entry.shield) > 0).length, layers);
  }
});

test('sanctuary is high-ground-only, absorbs damage without healing, and refreshes one shield', () => {
  const high = makeBattle({
    relicIds: ['heal-sanctuary'],
    cards: [card('high', 'char_1041_angel2', { row: 10, col: 2 })],
    enemies: [enemy('attacker', [10, 6], { hp: 100000 })],
  });
  const [highUnit] = high.units;
  const [attacker] = high.enemies;
  assert.equal(high.battle.grid.tile(highUnit.tileR, highUnit.tileC).height, 'HIGH');
  assert.equal(shieldBuffs(highUnit, 'heal-sanctuary').length, 1);
  close(shieldBuffs(highUnit, 'heal-sanctuary')[0].shield, highUnit.s.maxHp * 0.25, 'sanctuary shield');

  const shield = highUnit.s.maxHp * 0.25;
  assert.equal(high.battle.dealDamage(attacker, highUnit, {
    amount: shield / 2,
    type: 'true',
    canDodge: false,
  }), 0);
  flush(high.battle);
  assert.equal(highUnit.hp, highUnit.s.maxHp);
  high.battle.retreat(highUnit);
  assert.equal(high.battle.redeploy(highUnit, { free: true, keepSp: true }), true);
  flush(high.battle);
  assert.equal(shieldBuffs(highUnit, 'heal-sanctuary').length, 1);
  close(shieldBuffs(highUnit, 'heal-sanctuary')[0].shield, highUnit.s.maxHp * 0.25, 'sanctuary refreshed shield');

  const low = makeBattle({
    relicIds: ['heal-sanctuary'],
    cards: [card('low', 'char_1045_svash2', { row: 10, col: 5 })],
  });
  assert.equal(low.units[0].buffs.some((entry) => Number(entry.shield) > 0), false);
});

test('lakeshield requires an opening native shield and does not activate from a late shield', () => {
  for (const relicIds of [
    ['heal-lakeshield', 'heal-kingform'],
    ['heal-kingform', 'heal-lakeshield'],
  ]) {
    const setup = makeBattle({ relicIds });
    const [unit] = setup.units;
    const originalMax = unit.base.maxHp;
    close(unit.s.maxHp, originalMax * 0.6 * 1.2, 'lakeshield opening max HP');
    close(unit.hp, unit.s.maxHp, 'lakeshield opening current HP');
    close(
      unit.buffs.find((entry) => entry.key === 'relic:heal-kingform:1:shield').shield,
      originalMax * 0.6,
      'kingform original-max shield',
    );
    close(
      unit.buffs.find((entry) => entry.key === 'relic:heal-lakeshield:1:shield').shield,
      unit.s.maxHp * 0.08,
      'lakeshield current-max shield',
    );
  }

  const setup = makeBattle({ relicIds: ['heal-lakeshield'] });
  const [unit] = setup.units;
  assert.equal(unit.s.maxHp, unit.base.maxHp);
  setup.battle.addBuff(unit, {
    key: 'native-late-shield',
    shield: 1000,
    persist: true,
    source: unit,
  });
  setup.battle.retreat(unit);
  assert.equal(setup.battle.redeploy(unit, { free: true, keepSp: true }), true);
  flush(setup.battle);
  assert.equal(unit.s.maxHp, unit.base.maxHp);
  assert.equal(relicBuffs(unit, 'heal-lakeshield').some((entry) => Number(entry.shield) > 0), false);
});

test('kingform applies the max-HP cost, original-max shield, exact net healing, and post-shield damage', () => {
  const events = { heal: [], shieldGained: [], shieldBroken: [] };
  const setup = makeBattle({
    relicIds: ['heal-kingform'],
    enemies: [enemy('attacker', [10, 6], { hp: 100000 })],
    beforeStart: (battle) => observeNativeAssaultEvents(battle, events),
  });
  const [unit] = setup.units;
  const [attacker] = setup.enemies;
  const originalMax = unit.base.maxHp;
  const shield = originalMax * 0.6;

  close(unit.s.maxHp, originalMax * 0.6, 'kingform max HP');
  close(unit.hp, originalMax * 0.6, 'kingform current HP');
  close(unit.buffs.find((entry) => entry.key === 'relic:heal-kingform:1:shield').shield, shield, 'kingform shield');

  assert.equal(setup.battle.dealDamage(attacker, unit, {
    amount: shield + 100,
    type: 'true',
    canDodge: false,
  }), 100);
  flush(setup.battle);
  assert.equal(unit.hp, unit.s.maxHp - 100);
  assert.equal(events.shieldBroken.filter((event) => event.target === unit).length, 1);
  close(events.shieldBroken.find((event) => event.target === unit).amount, shield, 'kingform broken shield');

  const before = unit.hp;
  assert.equal(setup.battle.heal(unit, unit, 75, { self: true }), 75);
  flush(setup.battle);
  assert.equal(unit.hp - before, 75);
  assert.deepEqual(events.heal.filter((event) => event.target === unit).map((event) => event.amount), [75]);
});

test('wallchild uses exact Chebyshev-eight adjacency and leaves the two-away unit unchanged', () => {
  const setup = makeBattle({
    relicIds: ['block-wallchild'],
    cards: [
      card('near', 'char_1045_svash2', { row: 9, col: 3 }),
      card('far', 'char_1045_svash2', { row: 9, col: 5 }),
    ],
  });
  const near = setup.units[0];
  const far = setup.units[1];
  const goals = setup.battle.grid.specialTiles('end');
  const distance = (unit) => Math.min(...goals.map(([row, col]) => Math.max(
    Math.abs(row - unit.tileR),
    Math.abs(col - unit.tileC),
  )));

  assert.equal(distance(near), 1);
  assert.ok(distance(far) > 1);
  assert.equal(near.s.blockCnt, near.base.blockCnt + 1);
  close(near.s.maxHp, near.base.maxHp * 1.2, 'wallchild near max HP');
  assert.equal(far.s.blockCnt, far.base.blockCnt);
  close(far.s.maxHp, far.base.maxHp, 'wallchild far max HP');
});

test('pickflower adds melee deployment cost and stats, excludes ranged units, and does not stack on skill redeploy', () => {
  const setup = makeBattle({
    relicIds: ['block-pickflower'],
    cards: [
      card('melee', 'char_127_estell', { col: 4 }),
      card('ranged', 'char_1041_angel2', { col: 2 }),
    ],
  });
  const [melee, ranged] = setup.units;

  assert.equal(setup.battle.assaultDeploymentCost(melee), melee.base.cost + 3);
  assert.equal(setup.battle.assaultDeploymentCost(ranged), ranged.base.cost);
  assert.equal(melee.s.blockCnt, melee.base.blockCnt + 1);
  close(melee.s.def, melee.base.def * 1.25, 'pickflower melee DEF');
  assert.equal(ranged.s.blockCnt, ranged.base.blockCnt);
  close(ranged.s.def, ranged.base.def, 'pickflower ranged DEF');

  assert.equal(setup.battle.skillRedeploy(melee), true);
  flush(setup.battle);
  assert.equal(relicBuffs(melee, 'block-pickflower').length, 1);
  assert.equal(melee.s.blockCnt, melee.base.blockCnt + 1);
  close(melee.s.def, melee.base.def * 1.25, 'pickflower redeployed melee DEF');
});

test('unyielding changes native damage only at two blocked enemies and applies the reduction per hit', () => {
  const one = makeBattle({
    relicIds: ['block-unyielding'],
    cards: [card('warrior', 'char_337_utage', { col: 4 })],
    enemies: [enemy('one', [10, 4.5], { atk: 0 })],
  });
  const oneUnit = one.units[0];
  const oneEnemy = one.enemies[0];
  one.battle.step();
  assert.equal(oneUnit.blocking.length, 1);
  const oneBefore = oneUnit.hp;
  assert.equal(one.battle.dealDamage(oneEnemy, oneUnit, {
    amount: 100,
    type: 'true',
    canDodge: false,
  }), 100);
  assert.equal(oneBefore - oneUnit.hp, 100);

  const two = makeBattle({
    relicIds: ['block-unyielding'],
    cards: [card('warrior', 'char_337_utage', { col: 4 })],
    enemies: [
      enemy('two-a', [10, 4.5], { atk: 0 }),
      enemy('two-b', [10, 4.5], { atk: 0 }),
    ],
  });
  const twoUnit = two.units[0];
  two.battle.step();
  assert.equal(twoUnit.blocking.length, 2);
  for (const blocked of two.enemies) {
    const before = twoUnit.hp;
    assert.equal(two.battle.dealDamage(blocked, twoUnit, {
      amount: 100,
      type: 'true',
      canDodge: false,
    }), 80);
    assert.equal(before - twoUnit.hp, 80);
  }
});

test('tempfortress grants the adapted six-second natural deployment bonus and expires completely', () => {
  const setup = makeBattle({
    relicIds: ['block-tempfortress'],
    cards: [card('tank', 'char_199_yak', { col: 7 })],
  });
  const [tank] = setup.units;
  const buff = () => tank.buffs.find((entry) => entry.key === 'relic:block-tempfortress:0');

  assert.ok(buff());
  close(tank.s.atk, tank.base.atk * 1.4, 'tempfortress ATK');
  close(tank.s.def, tank.base.def * 1.4, 'tempfortress DEF');
  assert.equal(tank.s.blockCnt, tank.base.blockCnt + 1);
  close(buff().timeLeft, 6, 'tempfortress initial duration');

  runSeconds(setup.battle, 3);
  setup.battle.retreat(tank);
  assert.equal(setup.battle.redeploy(tank, { free: true, keepSp: true }), true);
  flush(setup.battle);
  assert.ok(buff());
  close(tank.s.atk, tank.base.atk * 1.4, 'tempfortress refreshed ATK');
  close(tank.s.def, tank.base.def * 1.4, 'tempfortress refreshed DEF');
  assert.equal(tank.s.blockCnt, tank.base.blockCnt + 1);
  close(buff().timeLeft, 6, 'tempfortress refreshed duration');

  runSeconds(setup.battle, 7);
  assert.equal(buff(), undefined);
  close(tank.s.atk, tank.base.atk, 'tempfortress expired ATK');
  close(tank.s.def, tank.base.def, 'tempfortress expired DEF');
  assert.equal(tank.s.blockCnt, tank.base.blockCnt);
});

test('spikehand damages each actual blocked enemy once per native second using current DEF', () => {
  const setup = makeBattle({
    relicIds: ['block-spikehand'],
    cards: [card('tank', 'char_199_yak', { col: 7 })],
    enemies: [
      enemy('spike-a', [10, 7.5], { hp: 100000, res: 0 }),
      enemy('spike-b', [10, 7.5], { hp: 100000, res: 0 }),
    ],
  });
  const [tank] = setup.units;
  setup.battle.step();
  assert.equal(tank.blocking.length, 2);
  tank.atkCd = 1000;
  const before = setup.enemies.map((unit) => unit.hp);

  runSeconds(setup.battle, 1.1);
  for (let index = 0; index < setup.enemies.length; index += 1) {
    close(before[index] - setup.enemies[index].hp, tank.s.def * 0.5, 'spikehand one exact current-DEF hit');
  }
});

test('loyalty heals only for actual net HP at three blocks and stops after the native blocker count falls below three', () => {
  const events = { heal: [], shieldGained: [], shieldBroken: [] };
  const setup = makeBattle({
    relicIds: ['block-tempfortress', 'block-loyalty'],
    cards: [card('tank', 'char_199_yak', { col: 7 })],
    enemies: [
      enemy('loyalty-a', [10, 7.5], { hp: 100000, atk: 0 }),
      enemy('loyalty-b', [10, 7.5], { hp: 100000, atk: 0 }),
      enemy('loyalty-c', [10, 7.5], { hp: 100000, atk: 0 }),
    ],
    beforeStart: (battle) => observeNativeAssaultEvents(battle, events),
  });
  const [tank] = setup.units;
  setup.battle.step();
  assert.equal(tank.blocking.length, 3);
  tank.atkCd = 1000;
  tank.hp = tank.s.maxHp - 300;

  runSeconds(setup.battle, 1.1);
  const heals = events.heal.filter((event) => event.target === tank);
  assert.deepEqual(heals.map((event) => event.amount), [150]);
  assert.equal(tank.hp, tank.s.maxHp - 150);

  const removed = tank.blocking[0], removedHp = removed.hp;
  assert.equal(setup.battle.dealDamage(tank, removed, {
    amount: removed.hp,
    type: 'true',
    canDodge: false,
  }), removedHp);
  flush(setup.battle);
  assert.equal(tank.blocking.length, 2);
  runSeconds(setup.battle, 1.1);
  assert.equal(events.heal.filter((event) => event.target === tank).length, 1);

  const full = makeBattle({
    relicIds: ['block-tempfortress', 'block-loyalty'],
    cards: [card('full-tank', 'char_199_yak', { col: 7 })],
    enemies: [
      enemy('full-a', [10, 7.5], { atk: 0 }),
      enemy('full-b', [10, 7.5], { atk: 0 }),
      enemy('full-c', [10, 7.5], { atk: 0 }),
    ],
    beforeStart: (battle) => observeNativeAssaultEvents(battle, {
      heal: events.heal,
      shieldGained: events.shieldGained,
      shieldBroken: events.shieldBroken,
    }),
  });
  full.battle.step();
  runSeconds(full.battle, 1.1);
  assert.equal(events.heal.filter((event) => event.target === full.units[0]).length, 0);
});
