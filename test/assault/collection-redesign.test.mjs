import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { loadData } from '../../server/data.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { installRelics } from '../../server/sim/content/assault/relics.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';
import { grantSummon, ledgerFor } from '../../server/sim/content/assault/summons.js';
import { clearCardSummons } from '../helpers/summonFixture.js';

const canonicalRoot = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const worktreeRoot = `${canonicalRoot}/.worktrees/assault/stronghold-protocol`;
process.env.SP_ASSAULT_RULES_ROOT = `${worktreeRoot}/data`;
const design = { ...loadAssaultDesign(),
  collectibles: JSON.parse(fs.readFileSync(`${worktreeRoot}/data/assault-design/collectibles.json`, 'utf8')) };
const nativeData = loadData(`${canonicalRoot}/data`, { log: { warn() {}, error() {} } });
const runtimeCatalog = loadAssaultRuntime();
const runtime = getAssaultData({ nativeData, runtime: runtimeCatalog }).runtime;
function flatStage() {
  const rows = Array.from({ length: 19 }, () => '#'.repeat(21));
  rows[0] = 'aaaaaaaaaa#aaaaaaaaaa'; rows[1] = '###IAAAAA###AAAAAI###';
  rows[2] = '##ErrrrrrrOrrrrrrrE##'; rows[3] = '##hrrrrrrrfrrrrrrrh##';
  rows[4] = '##hrrrrrrrfrrrrrrrh##'; rows[5] = '##hrrrrrrrOrrrrrrrh##';
  rows[6] = 'X'.repeat(21); rows[7] = 'aaaaaaaaaa###########'; rows[8] = '####AAAAA##I#########';
  rows[9] = '##ErrrrrrrSrrrrrrrS##'; rows[10] = '##hrrrrrrrfrrrrrrrf##';
  rows[11] = '##hrrrrrrrfrrrrrrrf##'; rows[12] = '##hrrrrrrrSrrrrrrrS##'; rows[13] = 'X'.repeat(21);
  return { id: 'flat', name: 'flat', rows, devices: [] };
}
const flatRoutes = () => [
  { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] },
  { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] },
  { motion: 'FLY', start: [9, 10], end: [9, 2], checkpoints: [] },
  { motion: 'FLY', start: [12, 10], end: [9, 2], checkpoints: [] },
];
function chessRec(o) {
  const id = o.id;
  return { chessId: id, baseId: id, isGolden: false, tier: 1, name: id, charId: o.charId,
    profession: o.profession, subProfessionId: o.subProf, position: o.position,
    bonds: [], stats: o.stats, rangeGrid: o.rangeGrid, trait: { desc: '', bb: {} }, talents: [], tokens: [], immunities: {}, skill: o.skill };
}
function enemyRec(o) {
  return { key: o.key, name: o.key, rank: 'NORMAL', applyWay: 'MELEE', stats: {
    maxHp: o.hp ?? 5000, atk: o.atk ?? 0, def: o.def ?? 0, res: o.res ?? 0, moveSpeed: 0, bat: 2,
    aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 1, lpr: 1, hpRecoveryPerSec: 0,
    elementRes: 0, elementDmgRes: 0, dmgType: 'phys', motion: 'WALK', immunities: {}, otherImmunities: [], tauntLevel: 0,
  }, notCountInTotal: false, tags: [], abilities: [], talents: { bb: {} }, skills: [] };
}
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `${message}: expected ${expected}, got ${actual}`);

function card(uid, charId, { star = 4, row = 10, col = 5 } = {}) {
  const body = runtime.bodies[charId];
  assert.ok(body, `missing Assault body ${charId}`);
  const piece = { uid, charId, star, fixedSkill: body.fixedSkill, moduleId: null, moduleChoices: {},
    sourceCopies: 1, permanentFlat: {}, permanentPercent: {}, claimed: [], tagEdits: { add: [], remove: [] } };
  const chess = chessRec({ id: `chess:${uid}`, charId, profession: body.profession,
    position: body.position, subProf: body.subProfessionId, stats: body.starStats[star - 1].stats,
    rangeGrid: body.range, skill: body.simChess.skill });
  chess.trait = structuredClone(body.simChess.trait);
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { uid, chess, piece, row, col };
}

function findProfession(profession) {
  const found = Object.entries(runtime.bodies).find(([id, body]) => assaultKits[id] && body.fixedSkill && body.profession === profession);
  assert.ok(found, `no native Assault ${profession} with a skill`);
  return found[0];
}

function makeBattle(relicIds, cards, enemies = []) {
  const chess = Object.fromEntries(cards.map((entry) => [entry.chess.chessId, entry.chess]));
  const enemyRecords = Object.fromEntries(enemies.map((entry) => [entry.key, enemyRec({ key: entry.key,
    hp: 100000000, atk: 0, def: 0, res: 0, speed: 0, ...entry.opts })]));
  const data = new DataSource({ chess, enemies: enemyRecords, tokens: {} }, getDefaultSource());
  const prepared = { input: { relicIds, pieces: cards.map((entry) => entry.piece), gold: 20, derivedBuffInputs: [] } };
  const battle = new Battle({ kind: 'normal', modeId: 'assault-collection-redesign', stage: flatStage(),
    routes: flatRoutes(), spawns: [], data, players: [{ playerId: 'p1', units: cards.map(({ uid, chess, row, col, dir = 'RIGHT' }) =>
      ({ uid, chessId: chess.chessId, row, col, dir })) }], content: 'assault',
    assault: { kits: assaultKits, strict: true, install: (b) => installRelics(b, prepared, { design }) },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 90,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  battle.assaultRuntime.flush();
  // the fixture grants its own summons: a synergy summoner's deployment summon is set aside
  clearCardSummons(battle);
  const liveEnemies = enemies.map(({ key, pos }) => battle.spawnEnemy(key, { routeIndex: 0, pos }));
  return { battle, units: cards.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.uid)), enemies: liveEnemies };
}

const flush = (battle) => battle.assaultRuntime.flush();

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs
function seconds(battle, amount) { for (let i = 0; i < Math.ceil(amount / battle.dt); i += 1) battle.step(); flush(battle); }
function cast(battle, unit) {
  const before = unit.skill.activations;
  unit.skill.setSpTotal(unit.skill.spCost);
  flush(battle);
  if (unit.skill.activations === before) {
    assert.equal(unit.skill.activate('fixture'), true, `native skill activation for ${unit.uid}: ${JSON.stringify({ ready: unit.skill.ready, canAct: unit.canAct, skillCanCast: unit.kit?.skill?.canCast?.({ battle, unit }), time: battle.time, opReadyAt: unit.skill.opReadyAt, castAt: unit.skill.nextCastAt, errors: battle.errors })}`);
    flush(battle);
  }
  assert.ok(unit.skill.activations > before, `native skill resolved for ${unit.uid}`);
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('voile charges only the on-field source of each allied elemental burst', () => {
  const setup = makeBattle(['element-voile'], [card('source', 'char_1041_angel2')], [
    { key: 'target', pos: [10, 6], opts: { hp: 1000000 } },
  ]);
  const [source] = setup.units;
  const [target] = setup.enemies;
  assert.equal(target.s.artsTakenMul, 1, 'the former global arts vulnerability is absent');
  source.skill.setSpTotal(0);
  for (let i = 0; i < 2; i += 1) {
    setup.battle.dealDamage(source, target, { amount: target.gaugeMax, type: 'element', element: 'burn', canDodge: false });
    flush(setup.battle);
  }
  assert.ok(source.skill.spTotal >= 2, 'independent allied bursts each grant SP');
  const beforeEnemyBurst = source.skill.spTotal;
  setup.battle.dealDamage(target, source, { amount: source.gaugeMax, type: 'element', element: 'burn', canDodge: false });
  flush(setup.battle);
  assert.equal(source.skill.spTotal, beforeEnemyBurst, 'enemy burst does not grant allied SP');
});

test('minor battle requires a live SUPPORT owner and gives a real summon a timed bonus', () => {
  const setup = makeBattle(['summon-minorbattle'], [card('summoner', 'char_2023_ling')]);
  const [owner] = setup.units;
  const beforeSp = owner.skill.spTotal;
  const result = grantSummon(setup.battle, owner, { tokenId: 'token_10020_ling_soul3', count: 1,
    stockCap: 1, fieldCap: 1, cost: 0 });
  assert.equal(result.spawned, 1);
  flush(setup.battle);
  const summon = [...ledgerFor(setup.battle, owner).activeByKey.values()][0].unit;
  close(summon.s.atk / summon.base.atk, 1.2, 'real summon gets +20% ATK');
  assert.ok(owner.skill.spTotal > beforeSp, 'actual summon entry grants owner SP');
  const buff = summon.buffs.find((entry) => entry.key.startsWith('relic:summon-minorbattle:'));
  assert.ok(buff);
  close(buff.timeLeft, 5, 'summon bonus duration');
  const spAfterEntry = owner.skill.spTotal;
  const entryGain = spAfterEntry - beforeSp;
  const entries = () => [...ledgerFor(setup.battle, owner).activeByKey.values()].filter((entry) => entry.unit.alive).length;
  setup.battle.retreat(owner, { reason: 'fixture' });
  const before = entries();
  assert.equal(setup.battle.redeploy(owner, { free: true, keepSp: true }), true);
  flush(setup.battle);
  // the redeployment itself is no summon entry; 令's synergy card deploys a summon of her own at every deployment,
  // and that real entry counts once
  close(owner.skill.spTotal, spAfterEntry + Math.max(0, entries() - before) * entryGain, 'owner redeployment is not a new summon entry');
  seconds(setup.battle, 6);
  close(summon.s.atk / summon.base.atk, 1, 'summon bonus expires');

  const unsupported = makeBattle(['summon-minorbattle'], [card('non-support', 'char_1045_svash2')]);
  const [nonSupportOwner] = unsupported.units;
  const beforeUnsupportedSp = nonSupportOwner.skill.spTotal;
  assert.equal(grantSummon(unsupported.battle, nonSupportOwner, { tokenId: 'token_10020_ling_soul3',
    count: 1, stockCap: 1, fieldCap: 1, cost: 0 }).spawned, 1);
  flush(unsupported.battle);
  const foreignSummon = [...ledgerFor(unsupported.battle, nonSupportOwner).activeByKey.values()][0].unit;
  assert.equal(foreignSummon.buffs.some((entry) => entry.key.startsWith('relic:summon-minorbattle:')), false);
  close(nonSupportOwner.skill.spTotal, beforeUnsupportedSp, 'non-SUPPORT owner gets no SP');
});

test('temp fortress is natural-deploy only and SP requires real damage while blocking two', () => {
  const setup = makeBattle(['block-tempfortress'], [card('tank', 'char_199_yak', { col: 7 })], [
    { key: 'a', pos: [10, 7.5] }, { key: 'b', pos: [10, 7.5] },
  ]);
  const [tank] = setup.units;
  const key = 'relic:block-tempfortress:0';
  assert.ok(tank.findBuff(key));
  close(tank.s.atk / tank.base.atk, 1.4, 'natural deploy ATK');
  close(tank.s.def / tank.base.def, 1.4, 'natural deploy DEF');
  assert.equal(tank.s.blockCnt, tank.base.blockCnt + 1);
  close(tank.findBuff(key).timeLeft, 6, 'natural deploy duration');
  assert.equal(setup.battle.skillRedeploy(tank), true);
  flush(setup.battle);
  close(tank.findBuff(key).timeLeft, 6, 'skill redeploy does not refresh natural-deploy effect');
  setup.battle.step();
  assert.equal(tank.blocking.length, 2);
  tank.skill.setSpTotal(0);
  const attacker = setup.enemies[0];
  setup.battle.dealDamage(attacker, tank, { amount: 0, type: 'true', canDodge: false });
  flush(setup.battle);
  assert.equal(tank.skill.spTotal, 0, 'zero damage grants no SP');
  setup.battle.dealDamage(attacker, tank, { amount: 10, type: 'true', canDodge: false });
  flush(setup.battle);
  close(tank.skill.spTotal, 0.25, 'positive damage while blocking two grants 0.25 SP');
  seconds(setup.battle, 7);
  assert.equal(tank.findBuff(key), null);
  assert.equal(tank.s.blockCnt, tank.base.blockCnt);
});

test('mercenary policy is absent until MEDIC skill resolution, then refreshes timed shelter', () => {
  const medicId = 'char_128_plosis';
  const attackerCard = card('medic', medicId, { row: 10, col: 4 });
  const secondMedicCard = card('medic2', medicId, { row: 9, col: 5 });
  const allyCard = card('ally', 'char_1045_svash2', { col: 6 });
  const setup = makeBattle(['heal-mercenarypolicy'], [attackerCard, secondMedicCard, allyCard]);
  const [medic, secondMedic, ally] = setup.units;
  const shelter = (unit) => unit.buffs.find((entry) => entry.key === 'relic:heal-mercenarypolicy:0');
  assert.equal(shelter(medic) ?? null, null, 'no constant opening shelter');
  assert.equal(shelter(ally) ?? null, null);
  medic.hp = medic.s.maxHp / 2;
  cast(setup.battle, medic);
  assert.ok(shelter(medic));
  assert.ok(shelter(ally));
  close(medic.s.dmgTakenMul, 0.9, 'MEDIC receives 10% shelter');
  close(ally.s.dmgTakenMul, 0.9, 'allies receive 10% shelter');
  const first = shelter(ally);
  secondMedic.hp = secondMedic.s.maxHp / 2;
  cast(setup.battle, secondMedic);
  assert.equal(ally.buffs.filter((entry) => entry.key === first.key).length, 1);
  close(ally.s.dmgTakenMul, 0.9, 'refresh does not multiply shelter');
  close(shelter(ally).timeLeft, 3, 'second resolved skill refreshes timer');
  setup.battle.assaultRuntime.publish('skillResolved', { source: ally, sourceUid: ally.uid, target: ally, targetUid: ally.uid });
  flush(setup.battle);
  assert.equal(ally.buffs.filter((entry) => entry.key === first.key).length, 1,
    'a skillResolved event from a non-MEDIC does not add a second effect');
  close(shelter(ally).timeLeft, 3, 'non-MEDIC event does not refresh the shelter timer');
});
