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

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finiteCost = (body) => {
  const value = body.fixedSkill?.spCosts ?? body.fixedSkill?.spCost;
  return Array.isArray(value) ? Number(value[3]) : Number(value);
};

function sourceBody(predicate, count = 1) {
  const found = Object.entries(runtimeData.bodies)
    .filter(([charId, body]) => own(assaultKits, charId) && body?.fixedSkill && predicate(body))
    .slice(0, count);
  assert.equal(found.length, count, `could not find ${count} source-backed Assault operators`);
  return found;
}

function card(uid, charId, { row = 10, col = 5, star = 4 } = {}) {
  const body = runtimeData.bodies[charId];
  assert.ok(body, `missing Assault body ${charId}`);
  const piece = {
    uid, charId, star, fixedSkill: body.fixedSkill, moduleId: null,
    moduleChoices: {}, sourceCopies: 1, permanentFlat: {}, permanentPercent: {},
    claimed: [], tagEdits: { add: [], remove: [] },
  };
  const chess = chessRec({
    id: `chess:${uid}`, charId, profession: body.profession, position: body.position,
    subProf: body.subProfessionId, stats: body.starStats[star - 1].stats, rangeGrid: body.range,
  });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { uid, chess, piece, row, col };
}

function fixtureKit({ id = 'fixture-assault-skill', spCost = 20, spType = 'none', assaultCast = () => {}, canCast } = {}) {
  return { skill: { id, kind: 'instant', spCost, spType, assaultCast, canCast } };
}

function makeBattle({ relicIds, cards, enemies = [], kits = {}, dpInit = 99 }) {
  const chess = Object.fromEntries(cards.map((entry) => [entry.chess.chessId, entry.chess]));
  const enemyRecords = Object.fromEntries(enemies.map((entry) => [entry.key, entry.record]));
  const data = new DataSource({ chess, enemies: enemyRecords, tokens: {} }, getDefaultSource());
  const prepared = {
    input: { relicIds, pieces: cards.map((entry) => entry.piece), gold: 20, derivedBuffInputs: [] },
  };
  const battle = new Battle({
    kind: 'normal',
    modeId: 'assault-relic-cycle-pierce',
    stage: flatStage(),
    routes: flatRoutes(),
    spawns: [],
    data,
    players: [{ playerId: 'p1', units: cards.map((entry) => ({
      uid: entry.uid, chessId: entry.chess.chessId, row: entry.row, col: entry.col,
    })) }],
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
  battle.start();
  battle.assaultRuntime.flush();
  const liveEnemies = enemies.map((entry) => battle.spawnEnemy(entry.key, {
    routeIndex: 0, pos: entry.pos,
  }));
  return {
    battle,
    units: cards.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.uid)),
    enemies: liveEnemies,
  };
}

const enemy = (key, pos, opts = {}) => ({
  key,
  pos,
  record: enemyRec({
    key, hp: opts.hp ?? 100000, atk: opts.atk ?? 0, def: opts.def ?? 0,
    res: opts.res ?? 0, speed: 0, ...opts,
  }),
});

const flush = (battle) => battle.assaultRuntime.flush();
const runSeconds = (battle, seconds) => {
  for (let i = 0; i < Math.ceil(seconds * 30); i += 1) battle.step();
  flush(battle);
};

test('pierce-newedict grants one sniper mark, including skill damage, with native failure boundaries', () => {
  const [[sniperId, sniperBody]] = sourceBody(
    (body) => body.profession === 'SNIPER' && finiteCost(body) >= 10,
  );
  const cards = [card('sniper', sniperId)];
  const kits = {
    [sniperId]: () => fixtureKit({
      id: 'fixture-physical-skill',
      spCost: 20,
      assaultCast: ({ battle }) => {
        battle.dealDamage(
          battle.allyUnits.find((unit) => unit.uid === 'sniper'),
          battle.enemies[0],
          { amount: 1000, type: 'phys', isSkill: true, canDodge: false },
        );
      },
    }),
  };

  const first = makeBattle({
    relicIds: ['pierce-newedict'],
    cards,
    kits,
    enemies: [enemy('target', [10, 6], { def: 400 })],
  });
  const [owner] = first.units;
  const [target] = first.enemies;
  assert.equal(sniperBody.profession, 'SNIPER');

  let before = target.hp;
  first.battle.dealDamage(owner, target, {
    amount: 1000, type: 'phys', isAttack: true, canDodge: false,
  });
  flush(first.battle);
  assert.equal(before - target.hp, 720);

  before = target.hp;
  first.battle.dealDamage(owner, target, {
    amount: 1000, type: 'phys', isAttack: true, canDodge: false,
  });
  flush(first.battle);
  assert.equal(before - target.hp, 600);

  const guarded = makeBattle({
    relicIds: ['pierce-newedict'],
    cards,
    kits,
    enemies: [enemy('target', [10, 6], { def: 400 })],
  });
  const [guardedOwner] = guarded.units;
  const [guardedTarget] = guarded.enemies;

  guarded.battle.addBuff(guardedTarget, {
    key: 'native-test-shield', shield: 2000, source: guardedOwner,
  });
  before = guardedTarget.hp;
  guarded.battle.dealDamage(guardedOwner, guardedTarget, {
    amount: 1000, type: 'phys', isAttack: true, canDodge: false,
  });
  flush(guarded.battle);
  assert.equal(guardedTarget.hp, before);
  guarded.battle.removeBuff(guardedTarget, 'native-test-shield');

  guarded.battle.addBuff(guardedTarget, {
    key: 'native-test-immune',
    flags: { invulnerable: true, untargetable: true },
    source: guardedOwner,
  });
  guarded.battle.dealDamage(guardedOwner, guardedTarget, {
    amount: 1000, type: 'phys', isAttack: true, canDodge: false,
  });
  flush(guarded.battle);
  guarded.battle.removeBuff(guardedTarget, 'native-test-immune');

  guardedOwner.skill.setSpTotal(guardedOwner.skill.spCost);
  before = guardedTarget.hp;
  assert.equal(guarded.battle.assaultRuntime.cast(guardedOwner, { force: true }), true);
  flush(guarded.battle);
  assert.equal(before - guardedTarget.hp, 720);
  before = guardedTarget.hp;
  assert.ok(before > 0);
  assert.ok(guardedTarget.hp < 100000);
  guarded.battle.dealDamage(guardedOwner, guardedTarget, {
    amount: 1000, type: 'phys', isAttack: true, canDodge: false,
  });
  flush(guarded.battle);
  assert.equal(before - guardedTarget.hp, 600);
});

test('pierce-newedict distinguishes ordinary free redeploy from typed skill redeploy', () => {
  const [[sniperId]] = sourceBody(
    (body) => body.profession === 'SNIPER' && finiteCost(body) >= 10,
  );
  const cards = [card('sniper', sniperId)];
  const kits = {
    [sniperId]: () => fixtureKit({
      id: 'fixture-redeploy-physical-skill',
      assaultCast: ({ battle }) => battle.dealDamage(
        battle.allyUnits.find((unit) => unit.uid === 'sniper'),
        battle.enemies[0],
        { amount: 1000, type: 'phys', isSkill: true, canDodge: false },
      ),
    }),
  };
  const setup = makeBattle({
    relicIds: ['pierce-newedict'],
    cards,
    kits,
    enemies: [enemy('target', [10, 6], { def: 400 })],
  });
  const [unit] = setup.units;
  const [target] = setup.enemies;

  const hit = () => {
    const before = target.hp;
    setup.battle.dealDamage(unit, target, {
      amount: 1000, type: 'phys', isAttack: true, canDodge: false,
    });
    flush(setup.battle);
    return before - target.hp;
  };

  assert.equal(hit(), 720);
  setup.battle.retreat(unit);
  assert.equal(setup.battle.redeploy(unit, { free: true, keepSp: true }), true);
  flush(setup.battle);
  assert.equal(hit(), 720);

  setup.battle.retreat(unit);
  assert.equal(setup.battle.skillRedeploy(unit), true);
  flush(setup.battle);
  assert.equal(hit(), 600);
});

test('oldcoin and Elysee are additive capped opening grants and never repeat on natural redeploy', () => {
  const [[charId]] = sourceBody((body) => finiteCost(body) >= 10);
  const cards = [card('cycle-owner', charId)];
  const kits = { [charId]: () => fixtureKit({ id: 'fixture-opening-skill', spCost: 20 }) };
  const initial = (relicIds) => makeBattle({ relicIds, cards, kits }).units[0].skill.spTotal;
  const base = initial([]);
  assert.equal(initial(['cycle-oldcoin']) - base, 3);
  assert.equal(initial(['cycle-elysee']) - base, 5);
  assert.equal(initial(['cycle-oldcoin', 'cycle-elysee']) - base, 8);

  const capped = makeBattle({
    relicIds: ['cycle-oldcoin', 'cycle-elysee'],
    cards,
    kits: { [charId]: () => fixtureKit({ id: 'fixture-capped-opening-skill', spCost: 6 }) },
  });
  assert.equal(capped.units[0].skill.spTotal, 6);

  const before = capped.units[0].skill.spTotal;
  capped.battle.retreat(capped.units[0]);
  assert.equal(capped.battle.redeploy(capped.units[0], { free: true, keepSp: true }), true);
  flush(capped.battle);
  assert.equal(capped.units[0].skill.spTotal, before);
});

test('Ecaz consumes its per-unit guard on the first resolved skill even when that reward caps SP', () => {
  const [[charId]] = sourceBody((body) => finiteCost(body) >= 10);
  let casts = 0;
  const setup = makeBattle({
    relicIds: ['cycle-ecaz'],
    cards: [card('ecaz-owner', charId)],
    kits: { [charId]: () => fixtureKit({ id: 'fixture-ecaz-skill', spCost: 20, assaultCast: ({ unit }) => { if (++casts === 1) unit.skill.setSpTotal(20); } }) },
  });
  const [unit] = setup.units;
  unit.skill.setSpTotal(unit.skill.spCost);
  assert.equal(setup.battle.assaultRuntime.cast(unit, { force: true }), true);
  flush(setup.battle);
  assert.equal(unit.skill.activations, 1);
  assert.equal(unit.skill.spTotal, unit.skill.spCost);

  unit.skill.setSpTotal(unit.skill.spCost);
  assert.equal(setup.battle.assaultRuntime.cast(unit, { force: true }), true);
  flush(setup.battle);
  assert.equal(unit.skill.activations, 2);
  assert.equal(unit.skill.spTotal, 0);
});

const hasteOf = (unit, relicId) => unit.buffs.filter((entry) => entry.data?.hasteSources?.some(key => key.startsWith(`relic:${relicId}:`)));

test('Fortune Cookie hastes two random operators for 15 seconds at battle start, once per battle', () => {
  const entries = sourceBody((body) => finiteCost(body) >= 10, 3);
  const cards = entries.map(([charId], index) => card(`fortune-${index}`, charId, { col: 3 + index * 2 }));
  const kits = Object.fromEntries(entries.map(([charId], index) => [charId, () => fixtureKit({
    id: `fixture-fortune-${index}`, spCost: 99, spType: 'time', canCast: () => false,
  })]));
  const setup = makeBattle({ relicIds: ['cycle-fortunecookie'], cards, kits });
  for (const unit of setup.units) unit.skill.setSpTotal(0);
  const hasted = setup.units.filter((unit) => hasteOf(unit, 'cycle-fortunecookie').length === 1);
  const plain = setup.units.filter((unit) => hasteOf(unit, 'cycle-fortunecookie').length === 0);
  assert.equal(hasted.length, 2);
  assert.equal(plain.length, 1);
  runSeconds(setup.battle, 1);
  for (const unit of hasted) assert.ok(Math.abs(unit.skill.spTotal - 2 * plain[0].skill.spTotal) < 0.15, 'haste doubles natural growth');
  const late = plain[0];
  setup.battle.retreat(late);
  assert.equal(setup.battle.redeploy(late, { free: true, keepSp: true }), true);
  flush(setup.battle);
  assert.equal(hasteOf(late, 'cycle-fortunecookie').length, 0, 'a later entry does not roll again');
  runSeconds(setup.battle, 15);
  for (const unit of setup.units) assert.equal(hasteOf(unit, 'cycle-fortunecookie').length, 0, 'haste ends after 15 seconds');
});

test('Everflow hastes only the casting caster or summoner for 4 seconds per cast', () => {
  const eligible = new Set(['corecaster', 'mysticcaster', 'summoner', '中坚术师', '秘术师', '召唤师']);
  const entries = sourceBody((body) => {
    const text = [body.subProfession, body.subProfessionId, body.archetype, body.profession]
      .filter(Boolean).map(String);
    return text.some((value) => eligible.has(value.toLowerCase()) || eligible.has(value))
      && finiteCost(body) >= 10;
  }, 2);
  const cards = entries.map(([charId], index) => card(`everflow-${index}`, charId, { col: 4 + index * 3 }));
  const kits = Object.fromEntries(entries.map(([charId], index) => [charId, () => fixtureKit({
    id: `fixture-everflow-${index}`, spCost: 20, spType: 'time',
  })]));
  const setup = makeBattle({ relicIds: ['cycle-everflow'], cards, kits });
  const [owner, other] = setup.units;
  owner.skill.setSpTotal(owner.skill.spCost);
  assert.equal(setup.battle.assaultRuntime.cast(owner, { force: true }), true);
  flush(setup.battle);
  assert.equal(hasteOf(owner, 'cycle-everflow').length, 1);
  assert.equal(hasteOf(other, 'cycle-everflow').length, 0);
  owner.skill.setSpTotal(0);
  other.skill.setSpTotal(0);
  runSeconds(setup.battle, 1);
  assert.ok(Math.abs(owner.skill.spTotal - 2 * other.skill.spTotal) < 0.15, 'haste doubles natural growth');
  runSeconds(setup.battle, 3.5);
  assert.equal(hasteOf(owner, 'cycle-everflow').length, 0, 'the haste window is limited, never permanent');
});

test('Royal Liqueur charges 0.2 when your operator attacks or is attacked, 25 times per operator per battle', () => {
  const entries = sourceBody((body) => finiteCost(body) >= 10, 2);
  const cards = entries.map(([charId], index) => card(`royal-${index}`, charId, { col: 3 + index * 2 }));
  const kits = Object.fromEntries(entries.map(([charId], index) => [charId, () => fixtureKit({
    id: `fixture-royal-${index}`, spCost: 99, spType: 'none', canCast: () => false,
  })]));
  const setup = makeBattle({ relicIds: ['cycle-royalliqueur'], cards, kits,
    enemies: [enemy('royal-target', [10, 6], { hp: 1e9, atk: 10 })] });
  const [attacker, victim] = setup.units;
  const [target] = setup.enemies;
  for (const unit of setup.units) unit.skill.setSpTotal(0);
  setup.battle.forceAttack(attacker, [target]);
  flush(setup.battle);
  assert.ok(Math.abs(attacker.skill.spTotal - 0.2) < 1e-9, 'attacking charges the attacker');
  assert.equal(victim.skill.spTotal, 0);
  setup.battle.dealDamage(target, victim, { amount: 1, type: 'true', isAttack: true, canDodge: false });
  flush(setup.battle);
  assert.ok(Math.abs(victim.skill.spTotal - 0.2) < 1e-9, 'being attacked charges the victim');
  setup.battle.dealDamage(target, victim, { amount: 1, type: 'true', isAttack: false, canDodge: false });
  flush(setup.battle);
  assert.ok(Math.abs(victim.skill.spTotal - 0.2) < 1e-9, 'non-attack damage does not charge');
  for (let i = 0; i < 20; i += 1) { setup.battle.forceAttack(attacker, [target]); flush(setup.battle); }
  for (let i = 0; i < 10; i += 1) { setup.battle.dealDamage(target, attacker, { amount: 1, type: 'true', isAttack: true, canDodge: false }); flush(setup.battle); }
  assert.ok(Math.abs(attacker.skill.spTotal - 5) < 1e-9, 'attack and hurt share 25 charges per operator');
});
