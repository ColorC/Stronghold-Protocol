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

function card(uid, charId, { row = 10, col = 5, star = 4 } = {}) {
  const body = runtimeData.bodies[charId];
  assert.ok(body, `missing Assault body ${charId}`);
  const piece = {
    uid, charId, star, fixedSkill: body.fixedSkill, moduleId: null,
    moduleChoices: {}, sourceCopies: 1, permanentFlat: {}, permanentPercent: {},
    claimed: [], tagEdits: { add: [], remove: [] },
  };
  const chess = chessRec({
    id: `chess:${uid}`, charId, profession: body.profession,
    position: body.position, subProf: body.subProfessionId,
    stats: body.starStats[star - 1].stats, rangeGrid: body.range,
  });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { uid, chess, piece, row, col };
}

const enemy = (key, pos, opts = {}) => ({
  key,
  pos,
  record: enemyRec({
    key, hp: opts.hp ?? 100000, atk: opts.atk ?? 0, def: opts.def ?? 0,
    res: opts.res ?? 0, speed: 0, ...opts,
  }),
});

function makeBattle({
  relicIds,
  cards = [card('owner', 'char_127_estell')],
  enemies = [],
  dpInit = 99,
} = {}) {
  const chess = Object.fromEntries(cards.map((entry) => [entry.chess.chessId, entry.chess]));
  const enemyRecords = Object.fromEntries(enemies.map((entry) => [entry.key, entry.record]));
  const data = new DataSource({ chess, enemies: enemyRecords, tokens: {} }, getDefaultSource());
  const prepared = {
    input: { relicIds, pieces: cards.map((entry) => entry.piece), gold: 20, derivedBuffInputs: [] },
  };
  const battle = new Battle({
    kind: 'normal',
    modeId: 'assault-cold-relic-behavior',
    stage: flatStage(),
    routes: flatRoutes(),
    spawns: [],
    data,
    players: [{
      playerId: 'p1',
      units: cards.map((entry) => ({
        uid: entry.uid, chessId: entry.chess.chessId,
        row: entry.row, col: entry.col,
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
    routeIndex: 0, pos: entry.pos,
  }));
  return {
    battle,
    units: cards.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.uid)),
    enemies: liveEnemies,
  };
}

function receipts(battle) {
  const result = { statusApplied: [], damageTaken: [], attacks: [] };
  const owner = {};
  battle.on('statusApplied', (event) => result.statusApplied.push(event), { owner });
  battle.on('attack', (event) => result.attacks.push(event), { owner });
  battle.assaultRuntime.observe(
    'damageTaken',
    'test:cold:damageTaken',
    (event) => result.damageTaken.push(event.payload),
    { owner },
  );
  return result;
}

const flush = (battle) => battle.assaultRuntime.flush();

function statusesFor(result, target) {
  return result.statusApplied
    .filter((event) => event.target === target && ['cold', 'freeze'].includes(event.status))
    .map((event) => ({
      status: event.status,
      duration: event.duration,
      value: event.value ?? 1,
    }));
}

test('cold-frostsignal emits one three-second native status per adjacent kill and native cold converts to frozen', () => {
  const setup = makeBattle({
    relicIds: ['cold-frostsignal'],
    enemies: [
      enemy('victim-a', [10, 6], { hp: 20 }),
      enemy('overlap', [11, 6]),
      enemy('victim-b', [12, 6], { hp: 20 }),
      enemy('far', [9, 9]),
    ],
  });
  const result = receipts(setup.battle);
  const [owner] = setup.units;
  const [victimA, overlap, victimB, far] = setup.enemies;

  assert.equal(setup.battle.dealDamage(owner, victimA, {
    amount: 20, type: 'true', isAttack: true, canDodge: false,
  }), 20);
  flush(setup.battle);
  assert.equal(victimA.alive, false);

  assert.equal(setup.battle.dealDamage(owner, victimB, {
    amount: 20, type: 'true', isAttack: true, canDodge: false,
  }), 20);
  flush(setup.battle);
  assert.equal(victimB.alive, false);

  assert.deepEqual(statusesFor(result, overlap), [
    { status: 'cold', duration: 3, value: 1 },
    { status: 'freeze', duration: 3, value: 1 },
  ]);
  assert.equal(overlap.buffs.filter((entry) => entry.status === 'cold').length, 0);
  assert.equal(overlap.buffs.filter((entry) => entry.status === 'freeze').length, 1);
  assert.equal(overlap.buffs.find((entry) => entry.status === 'freeze').timeLeft, 3);
  assert.equal(statusesFor(result, far).length, 0);
});

test('cold-frozenhusk refreshes one native shell, consumes it once, and clears it on redeploy', () => {
  const setup = makeBattle({
    relicIds: ['cold-frozenhusk'],
    enemies: [enemy('attacker', [10, 6], { hp: 100000 })],
  });
  const result = receipts(setup.battle);
  const [owner] = setup.units;
  const [attacker] = setup.enemies;

  setup.battle.dealDamage(attacker, owner, {
    amount: 10, type: 'true', canDodge: false,
  });
  flush(setup.battle);
  assert.deepEqual(result.damageTaken.map((event) => ({
    target: event.target, amount: event.amount, type: event.damageType,
  })), [{ target: owner, amount: 10, type: 'true' }]);
  assert.equal(owner.buffs.find((entry) => entry.key === 'relic:cold-frozenhusk:0').timeLeft, 4);

  owner.atkCd = 10;
  setup.battle.step();
  setup.battle.dealDamage(attacker, owner, {
    amount: 10, type: 'true', canDodge: false,
  });
  flush(setup.battle);
  assert.equal(owner.buffs.find((entry) => entry.key === 'relic:cold-frozenhusk:0').timeLeft, 4);

  setup.battle.forceAttack(owner, [attacker]);
  flush(setup.battle);
  assert.deepEqual(statusesFor(result, attacker), [
    { status: 'cold', duration: 1, value: 1 },
  ]);
  assert.equal(owner._assaultFrostShell, undefined);

  const before = statusesFor(result, attacker).length;
  setup.battle.forceAttack(owner, [attacker]);
  flush(setup.battle);
  assert.equal(statusesFor(result, attacker).length, before);

  setup.battle.dealDamage(attacker, owner, {
    amount: 10, type: 'true', canDodge: false,
  });
  flush(setup.battle);
  setup.battle.retreat(owner);
  assert.equal(setup.battle.redeploy(owner, { free: true, keepSp: true }), true);
  flush(setup.battle);
  assert.equal(owner.buffs.some((entry) => entry.key === 'relic:cold-frozenhusk:0'), false);
  assert.equal(owner._assaultFrostShell, undefined);
  const afterRedeploy = statusesFor(result, attacker).length;
  setup.battle.forceAttack(owner, [attacker]);
  flush(setup.battle);
  assert.equal(statusesFor(result, attacker).length, afterRedeploy);
});

test('cold-triumphhorn extends successful cold and frozen instances by 25% but not immune targets', () => {
  const setup = makeBattle({
    relicIds: ['cold-niflheimr', 'cold-triumphhorn'],
    enemies: [enemy('target', [10, 6])],
  });
  const result = receipts(setup.battle);
  const [owner] = setup.units;
  const [target] = setup.enemies;

  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.deepEqual(statusesFor(result, target), [
    { status: 'cold', duration: 1.25, value: 1 },
    { status: 'freeze', duration: 1.25, value: 1 },
  ]);

  assert.equal(target.findBuff('freeze').timeLeft, 1.25, 'cold conversion must not apply the same duration bonus twice');
  for (let count = 0; count < 4; count++) {
    assert.equal(setup.battle.applyStatus(target, 'freeze', { duration: 1, source: owner }), true);
    flush(setup.battle);
    assert.equal(target.findBuff('freeze').timeLeft, 1.25, 'same-duration refresh does not multiply the existing remaining time');
  }
  assert.equal(setup.battle.applyStatus(target, 'freeze', { duration: 4, source: owner }), true);
  flush(setup.battle);
  assert.equal(target.findBuff('freeze').timeLeft, 5, 'a longer new application receives exactly one 25% bonus');
  assert.equal(setup.battle.applyStatus(target, 'freeze', { duration: 1, source: owner }), true);
  flush(setup.battle);
  assert.equal(target.findBuff('freeze').timeLeft, 5, 'a shorter refresh preserves the native maximum without multiplying it');
  assert.equal(setup.battle.applyStatus(owner, 'freeze', { duration: 1, source: target }), true);
  flush(setup.battle);
  assert.equal(owner.findBuff('freeze').timeLeft, 1, 'the collectible does not extend an enemy freeze on our operator');
  const immune = makeBattle({
    relicIds: ['cold-niflheimr', 'cold-triumphhorn'],
    enemies: [enemy('immune', [10, 6])],
  });
  const immuneResult = receipts(immune.battle);
  const [immuneOwner] = immune.units;
  const [immuneTarget] = immune.enemies;
  immune.battle.addBuff(immuneTarget, {
    key: 'native-test-immune',
    flags: { invulnerable: true, untargetable: true },
    source: immuneOwner,
  });
  immune.battle.forceAttack(immuneOwner, [immuneTarget]);
  flush(immune.battle);
  assert.equal(statusesFor(immuneResult, immuneTarget).length, 0);
  assert.equal(immuneTarget.buffs.some((entry) => ['cold', 'freeze'].includes(entry.status)), false);
});

test('cold-cabaretsinger deals one 35%-ATK arts hit and a 0.3-second pause per successful cold', () => {
  const setup = makeBattle({
    relicIds: ['cold-niflheimr', 'cold-cabaretsinger'],
    enemies: [enemy('target', [10, 6], { hp: 100000, res: 0 })],
  });
  const result = receipts(setup.battle);
  const [owner] = setup.units;
  const [target] = setup.enemies;

  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);

  const arts = result.damageTaken.filter((event) => event.target === target && event.damageType === 'arts');
  assert.equal(arts.length, 1);
  assert.ok(Math.abs(arts[0].amount - owner.s.atk * 0.35) < 1e-9, 'exact authored ATK ratio within floating-point HP subtraction');
  assert.deepEqual(result.statusApplied
    .filter((event) => event.target === target && event.status === 'stun')
    .map((event) => ({ duration: event.duration, value: event.value ?? 1 })), [
      { duration: 0.3, value: 1 },
    ]);

  const immune = makeBattle({
    relicIds: ['cold-niflheimr', 'cold-cabaretsinger'],
    enemies: [enemy('immune', [10, 6], { hp: 100000, res: 0 })],
  });
  const immuneResult = receipts(immune.battle);
  const [immuneOwner] = immune.units;
  const [immuneTarget] = immune.enemies;
  immune.battle.addBuff(immuneTarget, {
    key: 'native-test-immune',
    flags: { invulnerable: true, untargetable: true },
    source: immuneOwner,
  });
  immune.battle.forceAttack(immuneOwner, [immuneTarget]);
  flush(immune.battle);
  assert.equal(immuneResult.damageTaken.filter((event) => event.target === immuneTarget && event.damageType === 'arts').length, 0);
});

test('cold-niflheimr applies one exact cold to each real attack and survives redeploy', () => {
  const setup = makeBattle({
    relicIds: ['cold-niflheimr'],
    cards: [
      card('melee', 'char_127_estell', { col: 5 }),
      card('ranged', 'char_332_archet', { col: 3 }), // 空弦: her synergy card changes no attack interval (能天使's 快速弹匣 would)
    ],
    enemies: [
      enemy('target-a', [10, 6]),
      enemy('target-b', [10, 8]),
    ],
  });
  const result = receipts(setup.battle);
  const [melee, ranged] = setup.units;
  const [targetA, targetB] = setup.enemies;

  for (const unit of setup.units) {
    assert.equal(unit.s.interval, unit.base.bat * 1.2);
    assert.equal(unit.buffs.filter((entry) => entry.key === 'relic:cold-niflheimr:0').length, 1);
  }

  setup.battle.forceAttack(melee, [targetA]);
  for (const unit of setup.units) unit.atkCd = 60;
  setup.battle.forceAttack(ranged, [targetB]);
  for (let tick = 0; tick < 30; tick++) setup.battle.step();
  flush(setup.battle);
  assert.equal(result.attacks.length, 2);
  assert.deepEqual(statusesFor(result, targetA), [
    { status: 'cold', duration: 1, value: 1 },
  ]);
  assert.deepEqual(statusesFor(result, targetB), [
    { status: 'cold', duration: 1, value: 1 },
  ]);

  setup.battle.retreat(melee);
  assert.equal(setup.battle.redeploy(melee, { free: true, keepSp: true }), true);
  flush(setup.battle);
  assert.equal(melee.buffs.filter((entry) => entry.key === 'relic:cold-niflheimr:0').length, 1);
  const before = statusesFor(result, targetA).length;
  setup.battle.forceAttack(melee, [targetA]);
  flush(setup.battle);
  assert.equal(statusesFor(result, targetA).length, before + 1);
  assert.equal(statusesFor(result, targetA).at(-1).duration, 1);
});

test('cold-mirrorarchive counts five successful cold applications, resets, and does not recurse from frozen', () => {
  const setup = makeBattle({
    relicIds: ['cold-niflheimr', 'cold-mirrorarchive'],
    enemies: [
      enemy('target', [10, 6]),
      enemy('sibling', [10, 7]),
    ],
  });
  const result = receipts(setup.battle);
  const [owner] = setup.units;
  const [target, sibling] = setup.enemies;
  const counterKey = `cold-mirrorarchive:coldSurge:${target.uid ?? target.id}`;
  const counter = () => setup.battle._assaultRelicState.counters.get(counterKey) ?? 0;

  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.equal(counter(), 1);
  assert.equal(target.buffs.filter((entry) => entry.status === 'cold').length, 1);

  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.equal(counter(), 2);
  assert.equal(target.buffs.filter((entry) => entry.status === 'cold').length, 0);
  assert.equal(target.buffs.filter((entry) => entry.status === 'freeze').length, 1);

  const siblingFrozenBefore = result.statusApplied
    .filter((event) => event.target === sibling && event.status === 'freeze').length;
  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.equal(counter(), 3);
  assert.equal(result.statusApplied
    .filter((event) => event.target === sibling && event.status === 'freeze').length, siblingFrozenBefore);

  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.equal(counter(), 4);
  assert.equal(result.statusApplied
    .filter((event) => event.target === sibling && event.status === 'freeze').length, siblingFrozenBefore);

  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.equal(counter(), 0);
  assert.equal(result.statusApplied
    .filter((event) => event.target === sibling && event.status === 'freeze').length, siblingFrozenBefore + 1);
  assert.equal(sibling.buffs.find((entry) => entry.status === 'freeze').duration, 1.5);

  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.equal(counter(), 1);
  assert.equal(result.statusApplied
    .filter((event) => event.target === sibling && event.status === 'freeze').length, siblingFrozenBefore + 1);
});

test('ordinary native healing never applies the hostile frost edge to allies', () => {
  const setup = makeBattle({ relicIds: ['cold-niflheimr'],
    cards: [card('patient', 'char_127_estell'), card('healer', 'char_181_flower', { col: 4 })] });
  const result = receipts(setup.battle);
  const [patient, healer] = setup.units;
  setup.battle.loseHp(patient, 500);
  const before = patient.hp;
  setup.battle.forceAttack(healer, [patient]);
  flush(setup.battle);
  assert.ok(patient.hp > before, 'the native normal attack actually healed its ally');
  assert.equal(result.attacks.length, 1);
  assert.equal(statusesFor(result, patient).length, 0);
  assert.equal(patient.s.flags.cold, undefined);
  assert.equal(patient.s.flags.freeze, undefined);
});

test('frost edge waits for a real hit and rejected native dodge gives no cold receipt', () => {
  const setup = makeBattle({ relicIds: ['cold-niflheimr'], enemies: [enemy('dodge', [10, 6])] });
  const result = receipts(setup.battle), [owner] = setup.units, [target] = setup.enemies;
  setup.battle.addBuff(target, { key: 'native-dodge', mods: { dodgePhys: 1 } });
  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.equal(result.attacks.length, 1);
  assert.equal(statusesFor(result, target).length, 0);
  setup.battle.removeBuff(target, 'native-dodge');
  setup.battle.forceAttack(owner, [target]);
  flush(setup.battle);
  assert.deepEqual(statusesFor(result, target), [{ status: 'cold', duration: 1, value: 1 }]);
});
