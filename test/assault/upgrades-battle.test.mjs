import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { installRelics } from '../../server/sim/content/assault/relics.js';
import { makeChessRecords } from '../../shared/assault/battle-input.js';
import { enemies as assaultEnemies } from '../../server/sim/content/assault/primitives.js';

const design = loadAssaultDesign();
const catalog = getAssaultData({ runtime: loadAssaultRuntime() }).runtime;
const enchantments = new Map(design.system.enchantments.map((entry) => [entry.battle.kind, entry]));
const skillRanks = Object.fromEntries(design.system.strategySkills.map((entry) => [entry.id, entry]));

function piece(uid, charId, star = 4, enchantKind = null) {
  const body = catalog.bodies[charId];
  assert.ok(body, `missing body ${charId}`);
  return { uid, charId, star, fixedSkill: body.fixedSkill, enchantmentId: enchantKind ? enchantments.get(enchantKind).id : null,
    moduleChoices: {}, sourceCopies: 1, permanentFlat: {}, permanentPercent: {}, claimed: [], tagEdits: { add: [], remove: [] } };
}

const enemy = (key = 'upgrade-target') => enemyRec({ key, hp: 100000, atk: 0, def: 0, res: 0, speed: 0 });

function battleFor({ units = [], strategy = {}, seed = 7, enemyPos = [10, 7], unitStartCol = 3, unitDir = null } = {}) {
  const cards = units.map((value, index) => ({ ...value, uid: value.uid ?? `unit-${index}` }));
  const chess = {};
  const prepared = { input: { pieces: cards, relicIds: [], skillRanks: strategy, teamGrowth: {}, derivedBuffInputs: [] } };
  const nativeEnemy = enemy();
  for (const card of cards) {
    const body = catalog.bodies[card.charId];
    const record = chessRec({ id: `chess:${card.uid}`, charId: card.charId, profession: body.profession,
      position: body.position, subProf: body.subProfessionId, stats: body.starStats[card.star - 1].stats, rangeGrid: body.range });
    record.assaultPiece = card; record.assaultBody = body; chess[record.chessId] = record;
  }
  const data = new DataSource({ chess, enemies: { [nativeEnemy.key]: nativeEnemy }, tokens: {} }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: 'assault-upgrades-test', seed, stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: cards.map((card, index) => ({ uid: card.uid, chessId: `chess:${card.uid}`, row: 10, col: unitStartCol + index, ...(unitDir ? { dir: unitDir } : {}) })) }],
    content: 'assault', assault: { kits: assaultKits, strict: true, install: (current) => installRelics(current, prepared, { design }) },
    flags: { dpInit: 999, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 30,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  const live = cards.map((card) => battle.allyUnits.find((unit) => unit.uid === card.uid));
  const target = battle.spawnEnemy(nativeEnemy.key, { routeIndex: 0, pos: enemyPos });
  return { battle, prepared, cards, live, target };
}

// The hosts' 凛御银灰 skill strikes the enemy in front and casts only with one there (cast-needs-enemy.test.mjs): the
// fixture enemy steps onto the tile in front of the caster for the cast and back to its own tile afterwards.
function standInFront(battle, unit, target) {
  if (!target?.alive || unit.def?.charId !== 'char_1045_svash2') return () => {};
  const { x, y } = target;
  const place = (cx, cy) => { target.x = cx; target.y = cy; battle._buildEnemyIndex?.(); };
  place(unit.tileC + 1, unit.tileR);
  return () => { if (target.alive) place(x, y); };
}

function activate(battle, unit, target) {
  if (unit.skill?.kind === 'passive') return battle.forceAttack(unit, [target]);
  if (!unit.skill?.ready) unit.skill?.addCharge?.();
  const back = standInFront(battle, unit, target);
  const cast = battle.assaultRuntime.cast(unit, { force: true });
  battle.assaultRuntime.flush();
  back();
  return cast;
}

test('prepared battle freezes copies of the new run inputs and applies flat team growth to every operator stat row', () => {
  const encounters = Array.isArray(design.encounters) ? design.encounters : design.encounters.encounters;
  const encounter = encounters.find((entry) => entry.wave);
  const runInput = { input: { pieces: [], skillRanks: { strategy_waters: 2 }, teamGrowth: { atk: 13, maxHp: 21 }, life: 10, day: 1, hour: 1 } };
  const prepared = prepareAssaultBattle(runInput, encounter);
  assert.deepEqual(prepared.input.skillRanks, runInput.input.skillRanks);
  assert.deepEqual(prepared.input.teamGrowth, runInput.input.teamGrowth);
  assert.ok(Object.isFrozen(prepared.input.skillRanks));
  assert.ok(Object.isFrozen(prepared.input.teamGrowth));
  runInput.input.teamGrowth.atk = 99;
  assert.equal(prepared.input.teamGrowth.atk, 13);
  const record = piece('growth', Object.keys(catalog.bodies)[0]);
  const generated = makeChessRecords(catalog, [record], [], prepared.input.teamGrowth).chess[`assault:${record.uid}`];
  const base = catalog.bodies[record.charId].starStats[record.star - 1].stats;
  assert.equal(generated.stats.atk, base.atk + 13);
  assert.equal(generated.stats.maxHp, base.maxHp + 21);
});

test('native Battle activation drives heavy, icy, shielding, healing, DoT, obsidian, shiny and radiant enchantments', () => {
  for (const [kind, star] of [['heavy', 1], ['icy', 2], ['shielded', 3], ['restorative', 4], ['toxic', 1], ['fiery', 2], ['obsidian', 3], ['shiny', 4], ['radiant', 1], ['mossy', 2]]) {
    const host = piece(`host-${kind}`, 'char_1045_svash2', star, kind);
    const { battle, live: [unit], target } = battleFor({ units: [host], seed: star + kind.length });
    const events = [];
    battle.on('assaultUpgradeEffect', (event) => events.push(event));
    if (kind === 'radiant') {
      assert.equal(battle.applyStatus(unit, 'slow', { duration: 3, source: target }), false);
      assert.equal(battle.applyStatus(unit, 'freeze', { duration: 3, source: target }), false);
      assert.equal(battle.applyStatus(unit, 'disarm', { duration: 3, source: target }), false);
      assert.equal(unit.alive, true);
      continue;
    }
    if (kind === 'restorative' || kind === 'mossy') unit.hp = Math.max(1, unit.s.maxHp - 500);
    const hpBefore = unit.hp;
    const skillStarts = [];
    battle.on('skillStart', (event) => { if (event.unit === unit) skillStarts.push(!!event.extra); });
    activate(battle, unit, target);
    battle.assaultRuntime.flush();
    if (kind === 'heavy') assert.ok(target.findBuff('slow'));
    if (kind === 'icy') assert.ok(target.findBuff('freeze'));
    if (kind === 'shielded') {
      const shield = unit.buffs.find((buff) => buff.shield === 200);
      assert.ok(shield);
      const hp = unit.hp;
      battle.dealDamage(target, unit, { amount: 25, type: 'true', canDodge: false });
      assert.equal(unit.hp, hp, 'real enemy damage is absorbed by the enchantment barrier');
      assert.equal(shield.shield, 175);
    }
    if (kind === 'restorative') assert.ok(unit.hp > hpBefore);
    if (kind === 'toxic' || kind === 'fiery') {
      assert.ok(target.buffs.some((buff) => buff.data?.assaultUpgradeHost === unit.uid));
      const before = target.hp;
      for (let i = 0; i < 31; i += 1) battle.step();
      assert.ok(target.hp < before, `${kind} native buff tick deals damage`);
    }
    if (kind === 'mossy') assert.ok(unit.buffs.some((buff) => buff.mods?.hpRegen === 20));
    if (kind === 'shiny') assert.ok(skillStarts.includes(false) && skillStarts.includes(true), 'one actual extra cast follows the base cast');
    if (kind === 'obsidian') {
      const before = target.hp;
      battle.forceAttack(unit, [target]);
      assert.ok(target.hp < before);
      const normalBefore = target.hp;
      battle.dealDamage(unit, target, { amount: 25, type: 'true', isSkill: true, canDodge: false, tags: ['dot', 'nativeDotFixture'] });
      assert.equal(normalBefore - target.hp, 50, 'Obsidian multiplies host sourced DoT through the native damage pipeline');
    }
    assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
  }
});

test('ranked enchantment activation uses each authored star value and golden stays outside battle', () => {
  for (const kind of ['shielded', 'restorative', 'toxic', 'fiery', 'mossy']) for (let star = 1; star <= 4; star += 1) {
    const host = piece(`rank-${kind}-${star}`, 'char_1045_svash2', star, kind);
    const { battle, live: [unit], target } = battleFor({ units: [host], seed: 100 + star });
    if (kind === 'restorative' || kind === 'mossy') unit.hp = Math.max(1, unit.s.maxHp - 450);
    const effects = [];
    battle.on('assaultUpgradeEffect', (event) => { if (event.source === unit) effects.push(event); });
    activate(battle, unit, target);
    if (kind === 'shielded') assert.ok(unit.buffs.some((buff) => buff.shield === [50, 100, 200, 400][star - 1]));
    if (kind === 'restorative') assert.equal(effects.find((event) => event.kind === kind)?.amount, [50, 100, 200, 400][star - 1]);
    if (kind === 'mossy') assert.ok(unit.buffs.some((buff) => buff.mods?.hpRegen === [10, 20, 40, 80][star - 1]));
    if (kind === 'toxic' || kind === 'fiery') {
      const dealt = [];
      battle.on('damaged', (event) => { if (event.target === target && (event.dmg?.tags ?? []).includes('dot')) dealt.push(event.amount); });
      for (let i = 0; i < 31; i += 1) battle.step();
      assert.ok(dealt.length > 0 && dealt.every((amount) => amount === [10, 20, 40, 80][star - 1]), `${kind} star ${star} DoT tick amount`);
    }
    assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
  }
  const golden = piece('golden-no-battle', 'char_1045_svash2', 4, 'golden');
  const { battle, live: [unit] } = battleFor({ units: [golden] });
  activate(battle, unit, battle.enemies[0]);
  assert.equal(unit.buffs.some((buff) => String(buff.key).startsWith('assault:upgrade:')), false);
});

test('team strategy skills use real battle events, limit support charge, and grow fiery DoT only from deadly criticals', () => {
  assert.ok(Object.keys(skillRanks).length >= 4);
  const host = piece('host-fiery', 'char_1045_svash2', 4, 'fiery');
  const deadly = piece('host-deadly', 'char_1045_svash2', 4, 'deadly');
  const ranged = piece('host-ranged', 'char_4000_jnight', 4);
  const { battle, live } = battleFor({ units: [host, deadly, ranged], strategy: {
    strategy_waters: 4, strategy_burn: 4,
  }, seed: 17 });
  const rangedUnit = live.find((unit) => unit.uid === 'host-ranged');
  assert.equal(rangedUnit.s.atk, rangedUnit.base.atk + 40);
  const target = battle.enemies[0];
  const fieryUnit = live.find((unit) => unit.uid === 'host-fiery');
  activate(battle, fieryUnit, target);
  const bonusEvents = [];
  battle.on('upgradeCritical', (event) => bonusEvents.push(event));
  const deadlyUnit = live.find((unit) => unit.uid === 'host-deadly');
  for (let i = 0; i < 20 && !bonusEvents.length; i += 1) battle.forceAttack(deadlyUnit, [target]);
  assert.ok(bonusEvents.length > 0, 'actual hit RNG eventually creates a critical');
  const before = target.hp;
  for (let i = 0; i < 31; i += 1) battle.step();
  assert.ok(before - target.hp >= 12, 'fiery DoT ticks include battle skill critical growth');
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
});

test('native strategy activations grant Shielded barriers, temporary Turbo and bounded Frozen charge', () => {
  const shielded = piece('shielded', 'char_1045_svash2', 4, 'shielded');
  const icy = piece('icy', 'char_1045_svash2', 4, 'icy');
  const turbo = piece('turbo', 'char_1045_svash2', 4, 'turbo');
  const supporter = piece('supporter', 'char_181_flower', 4);
  const { battle, live } = battleFor({ units: [supporter, shielded, icy, turbo], strategy: {
    strategy_defender: 4, strategy_frozen: 3,
  }, seed: 29 });
  const shieldHost = live.find((unit) => unit.uid === 'shielded');
  activate(battle, shieldHost, battle.enemies[0]);
  assert.ok(shieldHost.buffs.some((buff) => buff.shield === 60), JSON.stringify({ rank: battle._assaultUpgradeState?.hostCount,
    buffs: shieldHost.buffs.map((buff) => ({ key: buff.key, shield: buff.shield })), starts: shieldHost.skill.activations }));
  const icyHost = live.find((unit) => unit.uid === 'icy');
  icyHost.hp -= 1; // The Medic's actual base skill requires an injured ally target.
  icyHost.skill.setSpTotal(0);
  const before = icyHost.skill.spTotal;
  const supportHost = live.find((unit) => unit.uid === 'supporter');
  const supportStarts = [];
  battle.on('skillStart', (event) => { if (event.unit === supportHost) supportStarts.push({ extra: !!event.extra, reason: event.reason }); });
  let supportCast = false;
  for (let i = 0; i < 5; i += 1) {
    shieldHost.hp = shieldHost.s.maxHp - 5;
    supportHost.skill.addCharge();
    supportCast = battle.assaultRuntime.cast(supportHost, { force: true });
    assert.equal(supportCast, true, `native Medic base cast ${i + 1} succeeds against an injured ally`);
  }
  assert.equal(supportCast, true, 'the native Medic cast must succeed for Frozen to trigger');
  assert.equal(supportStarts.filter((event) => !event.extra).length, 5, 'all five successful base skill events were observed');
  assert.equal(icyHost.skill.spTotal, before + 4, 'rank 3 Frozen stops after four real activations');
  assert.ok(battle._assaultUpgradeState);
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
  const turboHost = live.find((unit) => unit.uid === 'turbo');
  activate(battle, turboHost, battle.enemies[0]);
  assert.ok(live.some((unit) => unit.buffs.some((buff) => buff.key === 'assault:haste:shared' && buff.mods?.spRecoveryMul === 2)));
});

test('upgrade activation and Shiny base-skill observer survive native retreat and redeploy', () => {
  const samples = [null, 'shiny'].map(enchantment => {
    const host = piece(`redeployed-${enchantment || 'plain'}`, 'char_1045_svash2', 4, enchantment);
    const { battle, live: [unit], target } = battleFor({ units: [host], seed: 61 });
    const counts = { starts: 0, extras: 0 };
    battle.on('skillStart', event => {
      if (event.unit !== unit) return;
      if (event.extra) counts.extras += 1; else counts.starts += 1;
    });
    return { battle, unit, target, counts };
  });
  const [plain, shiny] = samples;
  for (let deployment = 1; deployment <= 2; deployment += 1) {
    for (const sample of samples) {
      if (deployment === 2) {
        sample.battle.retreat(sample.unit);
        assert.equal(sample.battle.redeploy(sample.unit, { free: true }), true);
      }
      activate(sample.battle, sample.unit, sample.target);
      sample.battle.assaultRuntime.flush();
      assert.equal(sample.counts.starts, deployment, 'only the requested base casts consume activations');
      assert.equal(sample.unit.skill.activations, deployment);
      assert.equal(sample.battle.errors.length, 0, JSON.stringify(sample.battle.errors));
    }
    // 凛御银灰's synergy card (design of 2026-10-21) has no self recast of its own: every extra cast is Shiny's
    assert.equal(plain.counts.extras, 0, 'no self recast without the enchantment');
    assert.equal(shiny.counts.extras - plain.counts.extras, deployment, 'Shiny adds exactly one extra per base cast, including after redeploy');
    assert.equal(shiny.unit.mem.assaultCostDelta, plain.unit.mem.assaultCostDelta, 'extra casts never repeat the deployment discount');
  }
});

test('Turbo adds time to one doubled rate; both granted durations survive source retreat', () => {
  const first = piece('turbo-first', 'char_4000_jnight', 4, 'turbo');
  const second = piece('turbo-second', 'char_4000_jnight', 4, 'turbo');
  const recipient = piece('turbo-recipient', 'char_1045_svash2', 4);
  const { battle, live } = battleFor({ units: [first, second, recipient], seed: 77 });
  const [hostA, hostB, target] = live;
  const enemyTarget = battle.enemies[0];
  battle.forceAttack(hostA, [enemyTarget]);
  const key = 'assault:haste:shared';
  assert.ok(target.buffs.some((buff) => buff.key === key && buff.mods?.spRecoveryMul === 2));
  battle.forceAttack(hostB, [enemyTarget]);
  const haste = target.buffs.filter((buff) => buff.key === key);
  assert.equal(haste.length, 1);
  assert.equal(haste[0].mods.spRecoveryMul, 2);
  assert.equal(haste[0].timeLeft, 4);
  assert.deepEqual(haste[0].data.hasteSources, [`assault:upgrade:turbo:${hostA.uid}`, `assault:upgrade:turbo:${hostB.uid}`]);
  for (const host of [hostA, hostB]) battle.addBuff(host, { key: 'test:no-more-turbo-attacks', flags: { disarm: true }, duration: Infinity });
  target.skill.setSpTotal(0);
  const before = target.skill.spTotal;
  for (let i = 0; i < 4; i += 1) battle.step();
  const expected = battle.dt * 4 * target.base.spRecovery * 2;
  assert.ok(Math.abs((target.skill.spTotal - before) - expected) < 1e-8,
    `observed natural SP delta ${target.skill.spTotal - before}, expected ${expected}`);
  battle.retreat(hostA);
  assert.ok(target.buffs.some((buff) => buff.key === key), 'granted time remains after first source retreats');
  battle.retreat(hostB);
  assert.ok(target.buffs.some((buff) => buff.key === key), 'granted time remains after second source retreats');
  for (let i = 0; i < Math.ceil(4 / battle.dt); i++) battle.step();
  assert.equal(target.buffs.some((buff) => buff.key === key), false, 'the accumulated duration expires normally');
});

test('DoT refreshes same source/target, clears on retreat, and the retained host hook works after redeploy', () => {
  const host = piece('retreat-dot', 'char_1045_svash2', 4, 'toxic');
  const { battle, live: [unit], target } = battleFor({ units: [host], seed: 89 });
  const key = `toxic:${unit.uid}:${target.uid}`;
  activate(battle, unit, target);
  activate(battle, unit, target);
  assert.equal(target.buffs.filter((buff) => buff.key === key).length, 1, 'repeat trigger refreshes rather than stacks');
  battle.retreat(unit);
  assert.equal(target.buffs.some((buff) => buff.key === key), false, 'host retreat clears its target DoT');
  assert.equal(battle.redeploy(unit, { free: true }), true);
  activate(battle, unit, target);
  assert.equal(target.buffs.filter((buff) => buff.key === key).length, 1, 'the battle-owned activation listener remains for redeploy');
  battle.forceEnd('upgrade-cleanup-test');
  assert.equal(target.buffs.some((buff) => buff.key === key), false, 'battle end clears host DoT');
  assert.equal(unit.buffs.some((buff) => String(buff.key).startsWith('assault:upgrade:')), false, 'battle end clears host temporary buffs');
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
});

test('strategy rank values drive real ranged ATK, Shielded barriers and Frozen 4/8-use limits', () => {
  for (let rank = 1; rank <= 4; rank += 1) {
    const shield = piece(`rank-shield-${rank}`, 'char_1045_svash2', 4, 'shielded');
    const ranged = piece(`rank-ranged-${rank}`, 'char_4000_jnight', 4);
    const { battle, live } = battleFor({ units: [shield, ranged], strategy: {
      strategy_waters: rank, strategy_defender: rank,
    }, seed: 200 + rank });
    const rangedHost = live.find((unit) => unit.uid === ranged.uid);
    const shieldHost = live.find((unit) => unit.uid === shield.uid);
    assert.equal(rangedHost.s.atk - rangedHost.base.atk, [10, 20, 30, 40][rank - 1]);
    activate(battle, shieldHost, battle.enemies[0]);
    assert.ok(shieldHost.buffs.some((buff) => buff.shield === [6, 18, 36, 60][rank - 1]));
  }
  for (const rank of [3, 4]) {
    const medic = piece(`rank-frozen-medic-${rank}`, 'char_181_flower', 4);
    const icy = piece(`rank-frozen-icy-${rank}`, 'char_1045_svash2', 4, 'icy');
    const { battle, live } = battleFor({ units: [medic, icy], strategy: { strategy_frozen: rank }, seed: 300 + rank });
    const medicHost = live.find((unit) => unit.uid === medic.uid);
    const icyHost = live.find((unit) => unit.uid === icy.uid);
    icyHost.skill.setSpTotal(0);
    for (let count = 0; count < (rank === 3 ? 5 : 9); count += 1) {
      icyHost.hp = icyHost.s.maxHp - 5;
      medicHost.skill.addCharge();
      assert.equal(battle.assaultRuntime.cast(medicHost, { force: true }), true, 'real Medic base skill succeeds');
    }
    assert.equal(icyHost.skill.spTotal, rank === 3 ? 4 : 8, `rank ${rank} Frozen cap`);
  }
});

test('Burn rank 3/4 grows each Fiery DoT tick cumulatively after real Deadly criticals', () => {
  for (const rank of [3, 4]) {
    const fiery = piece(`burn-fiery-${rank}`, 'char_1045_svash2', 4, 'fiery');
    const deadly = piece(`burn-deadly-${rank}`, 'char_1045_svash2', 4, 'deadly');
    const { battle, live } = battleFor({ units: [fiery, deadly], strategy: { strategy_burn: rank }, seed: 400 + rank });
    const fireHost = live.find((unit) => unit.uid === fiery.uid);
    const deadlyHost = live.find((unit) => unit.uid === deadly.uid);
    const target = battle.enemies[0];
    activate(battle, fireHost, target);
    let criticals = 0;
    battle.on('upgradeCritical', (event) => { if (event.source === deadlyHost) criticals += 1; });
    for (let i = 0; i < 40 && criticals < 2; i += 1) battle.forceAttack(deadlyHost, [target]);
    assert.ok(criticals >= 2, `rank ${rank} produces two actual Deadly criticals`);
    const dotTicks = [];
    battle.on('damaged', (event) => { if (event.target === target && (event.dmg?.tags ?? []).includes('dot')) dotTicks.push(event.amount); });
    for (let i = 0; i < 31; i += 1) battle.step();
    assert.ok(dotTicks.length > 0 && dotTicks.every((amount) => amount === 80 + 2 * (rank === 3 ? 2 : 4)),
      `rank ${rank} Fiery ticks include two cumulative critical increases`);
    battle.forceEnd('upgrade-cleanup-test');
    assert.equal(battle._assaultUpgradeBurnBonus, 0, 'battle end clears the accumulated critical growth');
    const next = battleFor({ units: [fiery, deadly], strategy: { strategy_burn: rank }, seed: 500 + rank }).battle;
    assert.equal(next._assaultUpgradeBurnBonus, 0, 'a new Battle starts without previous growth');
  }
});

test('Obsidian doubles native Podego skill-field DoT ticks versus an identical plain-host control', () => {
  const nativeFieldDamage = (kind) => {
    const host = piece(`native-field-${kind}`, 'char_258_podego', 4, kind === 'obsidian' ? 'obsidian' : null);
    const { battle, live: [unit], target } = battleFor({ units: [host], seed: 515, enemyPos: [9, 6], unitStartCol: 5, unitDir: 'RIGHT' });
    const hp = target.hp;
    unit.skill.setSpTotal(0);
    unit.skill.spType = 'none';
    battle.step();
    battle.assaultRuntime.flush();
    unit.skill.spType = 'time';
    const activations = unit.skill.activations;
    unit.skill.setSpTotal(unit.skill.spCost);
    battle.assaultRuntime.flush();
    if (unit.skill.activations === activations) {
      assert.equal(unit.skill.activate('fixture'), true, JSON.stringify({ message: 'native Podego skill activates through Battle after SP is prepared',
        ready: unit.skill.ready, canAct: unit.canAct, kitCanCast: unit.kit?.skill?.canCast?.({ battle, unit }),
        unitPos: [unit.tileR, unit.tileC, unit.fwd], targetPos: [target.tileR, target.tileC],
        targetState: { alive: target.alive, deployed: target.deployed, removed: target.removed, hidden: target.hidden, side: target.side, flying: target.isFlying, hp: target.hp, x: target.x, y: target.y, attack: target.profile?.attack, dmgType: target.profile?.dmgType, canHitFly: target.profile?.canHitFly, flags: target.s?.flags },
        enemiesCount: battle.enemies.length,
        rangeKeys: unit.rangeKeys, selected: assaultEnemies(battle, unit, { scope: 'range', count: 1 }).map((enemy) => enemy.uid),
        keyed: battle.enemiesInKeys?.(unit.rangeKeys, unit, unit.profile)?.map((enemy) => enemy.uid),
        enemyRange: battle.enemiesInRange?.(unit)?.map((enemy) => enemy.uid), errors: battle.errors }));
    }
    battle.assaultRuntime.flush();
    assert.ok(unit.skill.activations > activations, JSON.stringify({ ready: unit.skill.ready, sp: unit.skill.spTotal,
      cost: unit.skill.spCost, canAct: unit.canAct, errors: battle.errors }));
    for (let i = 0; i < 40; i += 1) battle.step();
    assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
    return hp - target.hp;
  };
  const baseline = nativeFieldDamage(null);
  const doubled = nativeFieldDamage('obsidian');
  assert.ok(baseline > 0);
  assert.ok(Math.abs(doubled - baseline * 2) < 1e-8, 'native periodic host damage uses the same Obsidian multiplier');
});
