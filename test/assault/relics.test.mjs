import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { computeRelicDeploymentCost, installRelics, relicEffectHandlers } from '../../server/sim/content/assault/relics.js';
import { elementBurst } from '../../server/sim/damage.js';
import { assaultAmmoState, reloadAssaultAmmo, consumeAssaultAmmo } from '../../server/sim/content/assault/ammo.js';
import { grantSummon, ledgerFor, returnSummon } from '../../server/sim/content/assault/summons.js';
import { selectedTargets } from '../../server/sim/content/assault/relics/helpers.js';

const design = loadAssaultDesign();
const runtimeData = getAssaultData({ runtime: loadAssaultRuntime() }).runtime;
const ids = design.collectibles.items.map((item) => item.id);

function card(uid, charId, { star = 4, row = 10, col = 5, moduleId = null } = {}) {
  const body = runtimeData.bodies[charId];
  assert.ok(body, `missing Assault body ${charId}`);
  const piece = { uid, charId, star, fixedSkill: body.fixedSkill, moduleId,
    moduleChoices: moduleId ? { [charId]: moduleId } : {}, sourceCopies: 1,
    permanentFlat: {}, permanentPercent: {}, claimed: [], tagEdits: { add: [], remove: [] } };
  const chess = chessRec({ id: `chess:${uid}`, charId, profession: body.profession, position: body.position,
    subProf: body.subProfessionId, stats: body.starStats[star - 1].stats, rangeGrid: body.range });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { uid, chess, piece, row, col };
}

function makeBattle({ relicIds, cards = [card('owner', 'char_1045_svash2')], enemies = [], dpInit = 99, stage = flatStage(), kits = {}, prime = false }) {
  const chess = Object.fromEntries(cards.map((entry) => [entry.chess.chessId, entry.chess]));
  const enemyRecords = Object.fromEntries(enemies.map((entry) => [entry.key, entry.record]));
  const data = new DataSource({ chess, enemies: enemyRecords, tokens: {} }, getDefaultSource());
  const prepared = { input: { relicIds, pieces: cards.map((entry) => entry.piece), gold: 20, derivedBuffInputs: [] } };
  const battle = new Battle({ kind: 'normal', modeId: 'assault-relic-behavior', stage, routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: cards.map((entry) => ({ uid: entry.uid, chessId: entry.chess.chessId, row: entry.row, col: entry.col })) }],
    content: 'assault', assault: { kits: { ...assaultKits, ...kits }, strict: true, install: (b) => installRelics(b, prepared, { design }) },
    flags: { dpInit, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  battle.assaultRuntime.flush();
  const liveEnemies = enemies.map((entry) => battle.spawnEnemy(entry.key, { routeIndex: 0, pos: entry.pos }));
  if (prime) {
    battle.step();
    battle.assaultRuntime.flush();
  }
  return { battle, cards, units: cards.map((entry) => battle.allyUnits.find((unit) => unit.uid === entry.uid)), enemies: liveEnemies };
}

const enemy = (key, pos, opts = {}) => ({ key, pos, record: enemyRec({ key, hp: opts.hp ?? 1000, atk: opts.atk ?? 0, def: opts.def ?? 0, res: opts.res ?? 0, speed: 0, ...opts }) });
const flush = (battle) => battle.assaultRuntime.flush();

test('the 72-item design has concrete handlers, and starter exclusivity is enforced', () => {
  assert.equal(ids.length, 72);
  assert.deepEqual(new Set(Object.keys(relicEffectHandlers)), new Set(ids));
  const starters = design.collectibles.items.filter((item) => item.rarity === 'starter').map((item) => item.id);
  assert.equal(starters.length, 3);
  assert.throws(() => makeBattle({ relicIds: starters }), /mutually exclusive/);
  const { battle } = makeBattle({ relicIds: ['summon-ledger', 'block-pickflower', 'cross-bundle'] });
  const token = { kind: 'token', mem: { assaultSpawnKind: 'summon' } };
  assert.equal(computeRelicDeploymentCost(battle, token, 20), 15);
  assert.deepEqual(token, { kind: 'token', mem: { assaultSpawnKind: 'summon' } });
  assert.throws(() => computeRelicDeploymentCost(battle, token, -1), /finite and non-negative/);
});

test('cold status effects use successful native status instances and exact source attribution', () => {
  const setup = makeBattle({ relicIds: ['cold-triumphhorn'], enemies: [enemy('e', [10, 6])] });
  const { battle, units: [owner], enemies: [target] } = setup;
  assert.equal(battle.applyStatus(target, 'cold', { duration: 6, source: owner }), true);
  flush(battle);
  const cold = target.buffs.find((entry) => entry.status === 'cold');
  assert.ok(cold);
  assert.equal(cold.timeLeft, 7.5);
  assert.equal(cold.duration, 7.5);
  const immune = makeBattle({ relicIds: ['cold-triumphhorn'], enemies: [enemy('immune', [10, 6])] });
  immune.battle.addBuff(immune.enemies[0], { key: 'native-immune', flags: { invulnerable: true, untargetable: true }, source: immune.units[0] });
  assert.equal(immune.battle.applyStatus(immune.enemies[0], 'cold', { duration: 6, source: immune.units[0] }), false);
  flush(immune.battle);
  assert.equal(immune.enemies[0].buffs.some((entry) => entry.status === 'cold'), false);
});

test('cold cabaret, Niflheimr, and mirror archive close through native status and attack paths', () => {
  const cabaret = makeBattle({ relicIds: ['cold-cabaretsinger'], enemies: [enemy('cabaret-target', [10, 6], { hp: 10000, def: 0 })] });
  const cabaretOwner = cabaret.units[0];
  const cabaretTarget = cabaret.enemies[0];
  const cabaretHp = cabaretTarget.hp;
  assert.equal(cabaret.battle.applyStatus(cabaretTarget, 'cold', { duration: 2, source: cabaretOwner }), true);
  flush(cabaret.battle);
  assert.ok(cabaretTarget.hp < cabaretHp, 'cold application deals the configured arts hit');
  assert.ok(cabaretTarget.buffs.some((entry) => entry.flags?.stun === true), `cold cabaret pauses the target: ${cabaretTarget.buffs.map((entry) => `${entry.key}:${entry.status ?? ''}:${entry.flags?.stun ?? false}`).join(',')} errors=${cabaret.battle.errors.map((e) => e.message).join('|')} counts=${[...cabaret.battle._assaultRelicState.counts]}`);

  const niflheimr = makeBattle({ relicIds: ['cold-niflheimr'], enemies: [enemy('niflheimr-target', [10, 6], { hp: 10000 })] });
  const [niflheimrOwner] = niflheimr.units;
  assert.ok(Math.abs(niflheimrOwner.s.bat - niflheimrOwner.base.bat * 1.2) < 1e-6);
  niflheimr.battle.forceAttack(niflheimrOwner, niflheimr.enemies);
  flush(niflheimr.battle);
  assert.ok(niflheimr.enemies[0].buffs.some((entry) => entry.status === 'cold'));

  const mirror = makeBattle({ relicIds: ['cold-mirrorarchive'], enemies: [enemy('mirror-target', [10, 6]), enemy('mirror-sibling', [10, 7])] });
  const [mirrorOwner] = mirror.units;
  const [mirrorTarget, mirrorSibling] = mirror.enemies;
  for (let index = 0; index < 5; index += 1) {
    assert.equal(mirror.battle.applyStatus(mirrorTarget, 'cold', { duration: 2, source: mirrorOwner, instanceKey: `mirror-${index}` }), true);
    flush(mirror.battle);
  }
  assert.ok(mirrorSibling.buffs.some((entry) => entry.status === 'freeze'));
  assert.equal(mirrorSibling.s.flags.freeze, true);
  assert.equal(mirrorSibling.s.flags.stun, true);
  assert.equal([...mirror.battle._assaultRelicState.counters.entries()].find(([key]) => key.startsWith('cold-mirrorarchive:coldSurge:'))?.[1], 0);
});

test('moving enemies use their live positions for relic adjacency, including the killed or hit anchor', () => {
  const setup = makeBattle({ relicIds: ['cold-frostsignal'], enemies: [
    enemy('moving-anchor', [10, 10]), enemy('now-adjacent', [4, 4]),
    enemy('formerly-adjacent', [10, 11]), enemy('diagonal', [4, 6]),
  ] });
  const [anchor, near, far, diagonal] = setup.enemies;
  for (const [unit, r, c] of [[anchor, 10, 6], [near, 10, 7], [far, 4, 5], [diagonal, 11, 7]]) {
    // Native movement changes x/y; tileR/tileC retain the spawn tile.
    unit.tileR = unit.y; unit.tileC = unit.x;
    unit.x = c; unit.y = r;
  }
  setup.battle._buildEnemyIndex();
  assert.deepEqual(selectedTargets(setup.battle, { target: { selection: 'hitTargetAndAdjacent' } },
    { source: setup.units[0], target: anchor }), [anchor, near]);
  setup.battle.dealDamage(setup.units[0], anchor, { amount: anchor.hp + 1, type: 'true', canDodge: false });
  flush(setup.battle);
  assert.ok(near.buffs.some(buff => buff.status === 'cold'));
  assert.ok(diagonal.buffs.some(buff => buff.status === 'cold'));
  assert.equal(far.buffs.some(buff => buff.status === 'cold'), false);
  assert.equal(anchor.tileC, 10, 'the fixture retains the native stale-spawn-tile invariant');
});

// 隐现 is a synergy card (design of 2026-10-21): her skill loads a full pool and every attack spends one round
test('Inside spends casts and a full reload drives thousandforms only after a real ammo gain', () => {
  const setup = makeBattle({ relicIds: ['ammo-charsetglossary', 'ammo-thousandforms'],
    cards: [card('inside-ammo', 'char_498_inside')], enemies: [enemy('ammo-target', [10, 7], { hp: 100000000 })], prime: true });
  const [unit] = setup.units;
  const [target] = setup.enemies;
  const ammoEvents = [];
  setup.battle.on('ammoUsed', (event) => { if (event.source === unit) ammoEvents.push(event); });
  const reloads = [];
  setup.battle.on('reloaded', (event) => { if (event.target === unit && event.assaultAmmo) reloads.push(event); });
  const activations = unit.skill.activations;
  unit.skill.setSpTotal(unit.skill.spCost);
  setup.battle.assaultRuntime.flush();
  if (unit.skill.activations === activations) assert.equal(unit.skill.activate('fixture'), true, 'native ammo skill activates legally');
  flush(setup.battle);
  assert.ok(unit.skill.activations > activations, 'native Battle records the skill activation');
  const loaded = assaultAmmoState(unit);
  assert.ok(loaded && loaded.current === loaded.capacity-1, 'one cast spends one battle use');
  assert.equal(ammoEvents.length, 1, 'the skill spends one use');
  assert.equal(reloads.length, 0, 'loading alone is no reload');
  assert.equal(unit.findBuff('relic:ammo-thousandforms:0'), null, 'loading is not a reload reward');

  for (let index = 0; index < loaded.capacity && reloads.length < 1; index += 1) {
    unit.skill.setSpTotal(unit.skill.spCost); assert.equal(unit.skill.activate('fixture'), true);
    flush(setup.battle);
  }
  assert.ok(ammoEvents.length > 0 && ammoEvents.every((event) => event.quantity === 1 && event.assaultAmmo === true), 'every attack spends one real round');
  assert.equal(reloads.length, 1, `charset refill runs in the real ammoUsed callback: ${JSON.stringify({ ammoEvents: ammoEvents.map(({ quantity, left }) => ({ quantity, left })), reloads: reloads.map(({ amount, sourceKey }) => ({ amount, sourceKey })), state: assaultAmmoState(unit) })}`);
  assert.equal(reloads[0].sourceKey, 'relic:ammo-charsetglossary:0');
  const buff = unit.findBuff('relic:ammo-thousandforms:0');
  assert.ok(buff, 'a real reloaded event grants thousandforms');
  assert.equal(buff.timeLeft, 5);
  assert.equal(unit.s.aspd - unit.base.aspd, 30);

  for (let i = 0; i < 30; i++) setup.battle.step();
  flush(setup.battle);
  assert.ok(target.hp < target.s.maxHp, 'the attacks damage their legal enemy');
  consumeAssaultAmmo(setup.battle,unit,1,'test:empty-one');
  assert.equal(reloadAssaultAmmo(setup.battle, unit, unit, 1, 'test:native-reload'), 1, 'a second legitimate reload');
  flush(setup.battle);
  assert.equal(reloads.length, 2);
  assert.equal(unit.buffs.filter((entry) => entry.key === 'relic:ammo-thousandforms:0').length, 1, 'the buff refreshes rather than stacking');
  assert.equal(unit.s.aspd - unit.base.aspd, 30);
  assert.equal(unit.findBuff('relic:ammo-thousandforms:0').timeLeft, 5);
});

test('redeploy relics use actual deployment, pending entry, and damage paths', () => {
  const airdrop = makeBattle({ relicIds: ['redeploy-airdrop'], dpInit: 0,
    enemies: [enemy('airdrop-target', [10, 6], { hp: 100000 })] });
  const [airdropOwner] = airdrop.units;
  const airdropTarget = airdrop.enemies[0];
  const beforeAirdrop = airdropTarget.hp;
  airdrop.battle.addDp('p1', 99);
  airdrop.battle.step();
  flush(airdrop.battle);
  assert.equal(airdropOwner.s.redeployMul, 0.75);
  assert.ok(airdropTarget.hp < beforeAirdrop, 'a real deployment triggers the airdrop hit');

  const spring = makeBattle({ relicIds: ['redeploy-spring'], cards: [card('medic', 'char_181_flower'), card('spring-ally', 'char_1045_svash2')] });
  assert.equal(spring.units[0].s.redeployMul, 0.95);

  const special = makeBattle({ relicIds: ['redeploy-newedict', 'redeploy-specialstill'], cards: [card('special', 'char_237_gravel')] });
  const [specialUnit] = special.units;
  assert.equal(specialUnit.mem.assaultNextRedeployMul, 0.75);
  assert.equal(specialUnit.s.redeployMul, 0.8);
  assert.equal(special.battle.skillRedeploy(specialUnit), true);
  flush(special.battle);
  assert.equal(specialUnit.mem.assaultNextRedeployMul, 0.75, 'the next-redeploy marker is not consumed by a free skill heal');
});

test('element relics affect real burst, target, and owner state', () => {
  const setup = makeBattle({ relicIds: ['element-catastrophe', 'element-wotuncle', 'element-ameng', 'element-riverblessing', 'element-houndremedy'],
    cards: [card('element-owner', 'char_1041_angel2')], enemies: [enemy('element-target', [10, 6], { hp: 100000 })] });
  const [owner] = setup.units;
  const [target] = setup.enemies;
  assert.equal(target.s.artsTakenMul, 1.08, 'catastrophe applies its authored arts vulnerability');
  assert.equal(target.s.elemTakenMul, 1.25, 'catastrophe applies its authored element vulnerability');
  assert.equal(owner.s.elemTakenMul, 0.8);
  const beforeBurst = target.hp;
  elementBurst(setup.battle, owner, target, 'burn');
  flush(setup.battle);
  assert.equal(beforeBurst - target.hp, 7000 * 1.3 * 1.3, 'native burst receives ameng and riverblessing multipliers');
  assert.ok(target.buffs.some((entry) => entry.key === 'relic:element-riverblessing:1:burn'));
  assert.ok(owner.buffs.some((entry) => entry.key === 'relic:element-houndremedy:0'));
});

test('summon relics follow the real owner ledger and spawned-platform events', () => {
  const setup = makeBattle({ relicIds: ['leader-ironmn-workshopkey', 'summon-minorbattle', 'summon-derivative', 'summon-arcticpack', 'summon-poeticrelic', 'summon-windfeather'],
    cards: [card('ironmn-summons', 'char_4072_ironmn'), card('platform-neighbor', 'char_1045_svash2', { row: 10, col: 7 })],
    kits: { char_4072_ironmn: () => ({ skill: { id: 'fixture-ironmn', kind: 'instant', spCost: 1, assaultCast() {} } }) } });
  const owner = setup.units[0];
  const platform = setup.battle.allyUnits.find((unit) => unit.kind === 'token' && unit.defId === 'assault_workshop_platform');
  assert.ok(platform);
  assert.equal(platform.buffs.some((entry) => entry.key === 'relic:summon-minorbattle:0'), true,
    'Ironmn is a real SUPPORT owner, so the workshop summon receives minor battle');
  assert.ok(platform.buffs.some((entry) => entry.key === 'relic:summon-derivative:0'));
  assert.ok(platform.buffs.some((entry) => entry.key === 'relic:summon-windfeather:0'));
  assert.ok(owner.buffs.some((entry) => entry.key === 'windFeatherOwner'));
  const neighbor = setup.units[1];
  neighbor.hp = neighbor.s.maxHp - 100;
  const before = neighbor.hp;
  for (let tick = 0; tick < 300; tick += 1) setup.battle.step();
  assert.ok(neighbor.hp > before, 'arctic pack heals a real adjacent ally after its five-second period');
  setup.battle.kill(platform, owner);
  flush(setup.battle);
  assert.equal(owner.buffs.some((entry) => entry.key === 'windFeatherOwner'), false);
});

test('summon discounts floor at zero and a free workshop platform still enters through native deployment', () => {
  const { battle } = makeBattle({ relicIds: ['leader-ironmn-workshopkey', 'summon-ledger', 'cross-bundle'],
    cards: [card('free-platform-owner', 'char_4072_ironmn')],
    kits: { char_4072_ironmn: () => ({ skill: { id: 'fixture-free-platform', kind: 'instant', spCost: 1, assaultCast() {} } }) } });
  const platform = battle.allyUnits.find((unit) => unit.defId === 'assault_workshop_platform');
  assert.ok(platform?.alive && platform.deployed);
  assert.equal(battle.assaultDeploymentCost(platform), 0);
  assert.equal(battle.errorCount, 0);
});

test('wind feather follows the last actual summon exit and preserves a foreign owner aura', () => {
  const { battle, units: [owner, foreign] } = makeBattle({ relicIds: ['summon-windfeather'],
    cards: [card('wind-owner', 'char_4072_ironmn'), card('wind-foreign', 'char_4072_ironmn', { row: 11, col: 7 })],
    kits: { char_4072_ironmn: () => ({ skill: { id: 'fixture-wind-owner', kind: 'instant', spCost: 10, assaultCast() {} } }) } });
  const spec = { tokenId: 'token_10027_ironmn_pile2', count: 2, stockCap: 2, fieldCap: 2, cost: 0, ruleKey: 'wind:owner' };
  assert.equal(grantSummon(battle, owner, spec).spawned, 2);
  assert.equal(grantSummon(battle, foreign, { ...spec, count: 1, stockCap: 1, ruleKey: 'wind:foreign' }).spawned, 1);
  flush(battle);
  assert.ok(Math.abs(owner.s.atk / owner.base.atk - 1.2) < 1e-9, 'two real summons still give one owner layer');
  const [first, second] = [...ledgerFor(battle, owner).activeByKey.values()].map((entry) => entry.unit);
  assert.equal(returnSummon(battle, owner, first), true);
  flush(battle);
  assert.ok(owner.findBuff('windFeatherOwner'));
  battle.retreat(second, { reason: 'expiry', permanent: true });
  flush(battle);
  assert.equal(owner.findBuff('windFeatherOwner'), null);
  assert.ok(foreign.findBuff('windFeatherOwner'));
  assert.equal(battle.errorCount, 0);
});

test('heal and block relics modify native shields, stats, mitigation, and timers', () => {
  const healSetup = makeBattle({ relicIds: ['heal-sanctuary', 'heal-mercenarypolicy', 'heal-scaleshell', 'heal-pharmacon', 'heal-lakeshield', 'heal-kingform'],
    cards: [card('heal-ranged', 'char_1041_angel2', { row: 10, col: 2 })] });
  const healUnit = healSetup.units[0];
  assert.equal(healUnit.s.maxHp, healUnit.base.maxHp * 0.6 * 1.2);
  assert.ok(healUnit.buffs.filter((entry) => entry.shield > 0).length >= 5);
  assert.equal(healUnit.s.dmgTakenMul, 1, 'mercenary policy does not install a constant shelter aura');

  const blockSetup = makeBattle({ relicIds: ['block-pickflower', 'block-unyielding', 'block-tempfortress', 'block-spikehand', 'block-loyalty'],
    cards: [card('block-warrior', 'char_337_utage', { col: 4 }), card('block-tank', 'char_199_yak', { col: 7 })],
    enemies: [enemy('block-a', [10, 4.5], { hp: 100000, atk: 100 }), enemy('block-b', [10, 4.5], { hp: 100000, atk: 100 }),
      enemy('block-c', [10, 7.5], { hp: 100000, atk: 100 }), enemy('block-d', [10, 7.5], { hp: 100000, atk: 100 }), enemy('block-e', [10, 7.5], { hp: 100000, atk: 100 })] });
  const warrior = blockSetup.units[0];
  const tank = blockSetup.units[1];
  assert.equal(computeRelicDeploymentCost(blockSetup.battle, warrior, warrior.base.cost), warrior.base.cost + 3);
  assert.ok(warrior.s.blockCnt >= warrior.base.blockCnt + 1);
  assert.ok(tank.buffs.some((entry) => entry.key === 'relic:block-tempfortress:0'));
  blockSetup.battle.step();
  assert.equal(warrior.blocking.length, 2);
  const hpBefore = warrior.hp;
  blockSetup.battle.dealDamage(blockSetup.enemies[0], warrior, { amount: 100, type: 'true', canDodge: false });
  assert.equal(warrior.hp - hpBefore, -80);
  for (const blocked of [...warrior.blocking]) blockSetup.battle.kill(blocked, warrior);
  assert.equal(warrior.blocking.length, 0);
  const unblockedHp = warrior.hp;
  blockSetup.battle.dealDamage(blockSetup.enemies[2], warrior, { amount: 100, type: 'true', canDodge: false });
  assert.equal(warrior.hp - unblockedHp, -100);
  assert.equal(tank.blocking.length, 3);
  tank.hp = tank.s.maxHp - 500;
  const beforeHeal = tank.hp;
  for (let tick = 0; tick < 60; tick += 1) blockSetup.battle.step();
  assert.ok(tank.hp > beforeHeal, 'three-block loyalty heals through the native heal pipeline');
  assert.ok(blockSetup.enemies[2].hp < blockSetup.enemies[2].s.maxHp, 'spikehand periodic damage uses the blocked target list');
});

test('lakeshield opening decision is order independent and cannot be activated by a later shield', () => {
  for (const relicIds of [['heal-lakeshield', 'heal-kingform'], ['heal-kingform', 'heal-lakeshield']]) {
    const { units: [unit] } = makeBattle({ relicIds });
    assert.ok(Math.abs(unit.s.maxHp - unit.base.maxHp * 0.6 * 1.2) < 1e-9);
    assert.equal(unit.hp / unit.s.maxHp, 1);
    assert.equal(unit.buffs.filter((entry) => entry.shield > 0).length, 2);
  }
  const { battle, units: [unit] } = makeBattle({ relicIds: ['heal-lakeshield'] });
  assert.equal(unit.s.maxHp, unit.base.maxHp);
  battle.addBuff(unit, { key: 'mid-battle-shield', shield: 1000, persist: true, source: unit });
  battle.retreat(unit);
  assert.equal(battle.redeploy(unit), true);
  flush(battle);
  assert.equal(unit.s.maxHp, unit.base.maxHp);
  assert.equal(unit.buffs.some((entry) => entry.key.startsWith('relic:heal-lakeshield:')), false);
});

test('everlight follows the first actual ground entry after a ranged first entrant and survives neither retreat nor redeploy', () => {
  const { battle, units: [ranged, ground] } = makeBattle({ relicIds: ['cross-everlight'], cards: [
    card('first-ranged', 'char_103_angel', { col: 2 }), card('first-ground', 'char_1045_svash2', { col: 5 }),
  ] });
  assert.equal(ranged.buffs.some((entry) => entry.key === 'relic:cross-everlight:0'), false);
  assert.equal(ground.buffs.some((entry) => entry.key === 'relic:cross-everlight:0'), true);
  battle.retreat(ground);
  assert.equal(battle.redeploy(ground, { free: false }), true);
  flush(battle);
  assert.equal(ground.buffs.some((entry) => entry.key === 'relic:cross-everlight:0'), false);
});

test('kill and damage effects follow real killer/target paths, including adjacent siblings', () => {
  const frost = makeBattle({ relicIds: ['cold-frostsignal'], enemies: [enemy('victim', [10, 6], { hp: 50 }), enemy('sibling', [10, 7], { hp: 1000 })] });
  const [victim, sibling] = frost.enemies;
  assert.ok(frost.battle.dealDamage(frost.units[0], victim, { amount: 9999, type: 'true', canDodge: false }) > 0);
  flush(frost.battle);
  assert.equal(victim.alive, false);
  assert.ok(sibling.buffs.some((entry) => entry.status === 'cold'));

  const husk = makeBattle({ relicIds: ['cold-frozenhusk'], enemies: [enemy('attacker', [10, 6], { atk: 20 })] });
  const owner = husk.units[0];
  husk.battle.dealDamage(husk.enemies[0], owner, { amount: 10, type: 'true', canDodge: false });
  flush(husk.battle);
  assert.ok(owner.buffs.some((entry) => entry.key === 'relic:cold-frozenhusk:0'));
});

test('first natural entry, pending DP entry, skill redeploy, goal adjacency, and high ground use native state', () => {
  const pending = makeBattle({ relicIds: ['leader-svash2-frostsigil'], dpInit: 0 });
  const unit = pending.units[0];
  assert.equal(unit.deployed, true, 'the opening entry is free even at zero DP');
  flush(pending.battle);
  assert.ok(unit.buffs.some((entry) => entry.key === 'relic:leader-svash2-frostsigil:0'));
  pending.battle.skillRedeploy(unit);
  flush(pending.battle);
  assert.equal(unit.buffs.filter((entry) => entry.key === 'relic:leader-svash2-frostsigil:0').length, 1);

  const goal = makeBattle({ relicIds: ['block-wallchild'], cards: [card('goal-owner', 'char_1045_svash2', { row: 9, col: 3 })] });
  const goalUnit = goal.units[0];
  assert.equal(goal.battle.grid.specialTiles('end').some(([r, c]) => Math.max(Math.abs(r - goalUnit.tileR), Math.abs(c - goalUnit.tileC)) <= 1), true);
  assert.ok(goalUnit.buffs.some((entry) => entry.key === 'relic:block-wallchild:0'));

  const high = makeBattle({ relicIds: ['heal-sanctuary'], cards: [card('high-owner', 'char_1041_angel2', { row: 10, col: 2 })] });
  const highUnit = high.units[0];
  assert.equal(high.battle.grid.tile(highUnit.tileR, highUnit.tileC).height, 'HIGH');
  assert.ok(highUnit.buffs.some((entry) => Math.abs(Number(entry.shield) - highUnit.s.maxHp * 0.25) < 1e-9), JSON.stringify({ buffs: highUnit.buffs.map((entry) => ({ key: entry.key, shield: entry.shield, mods: entry.mods })), errors: high.battle.errors }));
  const low = makeBattle({ relicIds: ['heal-sanctuary'], cards: [card('low-owner', 'char_1045_svash2', { row: 10, col: 5 })] });
  assert.equal(low.units[0].buffs.some((entry) => Number(entry.shield) > 0), false);

  const broken = makeBattle({ relicIds: ['redeploy-brokenblade'] });
  const brokenUnit = broken.units[0];
  assert.equal(brokenUnit.s.redeployMul, 0.7);
  assert.equal(brokenUnit.s.maxHp, brokenUnit.base.maxHp * 0.8);
  assert.equal(brokenUnit.hp, brokenUnit.s.maxHp);
  assert.equal(broken.battle.skillRedeploy(brokenUnit), true);
  flush(broken.battle);
  assert.ok(brokenUnit.buffs.some((entry) => entry.flags?.invulnerable === true));
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('native shield fields are visible to relic conditions without unit.s.shield', () => {
  const setup = makeBattle({ relicIds: ['heal-lakeshield'], cards: [card('shield-owner', 'char_1045_svash2')] });
  const { battle, units: [owner] } = setup;
  battle.addBuff(owner, { key: 'native-shield', shield: 100, source: owner });
  assert.ok(owner.buffs.some((entry) => entry.key === 'native-shield' && entry.shield === 100));
  assert.equal(battle.errors.length, 0);
});

test('real summon death removes owner-scoped wind-feather aura and workshop uses the real owner ledger', () => {
  const setup = makeBattle({ relicIds: ['leader-ironmn-workshopkey'], cards: [card('ironmn', 'char_4072_ironmn')],
    kits: { char_4072_ironmn: () => ({ skill: { id: 'fixture-ironmn', kind: 'instant', spCost: 1, assaultCast() {} } }) },
    enemies: [enemy('target', [10, 8], { hp: 100000 })] });
  const { battle, units: [owner] } = setup;
  const platform = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.defId === 'assault_workshop_platform');
  assert.ok(platform);
  assert.equal(platform.ownerUnit, owner);
  assert.equal(platform.s.blockCnt, 0);
  assert.equal(platform.s.maxHp, owner.s.maxHp * 0.75);
  const before = battle.enemies[0].hp;
  for (let tick = 0; tick < 150; tick++) battle.step();
  assert.ok(battle.enemies[0].hp < before);
  battle.kill(platform, owner);
  flush(battle);
  assert.equal(platform.alive, false);
  assert.equal(battle._assaultRelicState.workshopOwnerUid, owner.uid);

  const repairSetup = makeBattle({ relicIds: ['leader-ironmn-workshopkey'], cards: [
    card('ironmn-repair', 'char_4072_ironmn'), card('repair-target', 'char_1045_svash2', { row: 10, col: 7 }),
  ], kits: { char_4072_ironmn: () => ({ skill: { id: 'fixture-ironmn', kind: 'instant', spCost: 1, assaultCast() {} } }) } });
  const repairPlatform = repairSetup.battle.allyUnits.find((unit) => unit.kind === 'token' && unit.defId === 'assault_workshop_platform');
  const repairTarget = repairSetup.units[1];
  assert.deepEqual([repairPlatform.tileR, repairPlatform.tileC], [10, 6]);
  repairTarget.hp = repairTarget.s.maxHp - 500;
  const hpBeforeRepair = repairTarget.hp;
  for (let tick = 0; tick < 300; tick++) repairSetup.battle.step();
  assert.equal(repairTarget.hp - hpBeforeRepair, 500);
});

test('all non-starter effects are installed from the design without internal state notes', () => {
  const nonStarters = design.collectibles.items.filter((item) => item.rarity !== 'starter').map((item) => item.id);
  const { battle } = makeBattle({ relicIds: nonStarters });
  const effects = [...battle._assaultRelicState.effectsByTrigger.values()].flat().map(({ effect }) => effect);
  assert.equal(effects.length, design.collectibles.items.filter((item) => item.rarity !== 'starter').reduce((n, item) => n + item.effects.length, 0));
  assert.ok(effects.every((effect) => effect._key.startsWith('relic:')));
  assert.equal(battle._assaultRelicState.integrationNotes, undefined);
  assert.equal(battle.errors.length, 0);
});

