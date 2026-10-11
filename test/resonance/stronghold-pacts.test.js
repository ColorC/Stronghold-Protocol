import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { buildResonanceBattle, getResonanceField } from '../../server/modes/resonance/battle.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { applyAction, createSession } from '../../server/modes/resonance/session.js';
import { onPrototypeEconomyPrep, onPrototypeEconomyResult } from '../../server/sim/content/resonance/prototype-economy.js';
import { canTargetAlly } from '../../server/sim/targeting.js';
import { factionSeason } from '../../shared/resonance/faction-season.js';
import { factionSeasonV2 } from '../../shared/resonance/faction-season-v2.js';
import { STRONGHOLD_PACT_IDS, STRONGHOLD_RETIRED_AUGMENTS } from '../../shared/resonance/stronghold-pacts.js';
import { enemyRec } from '../helpers/battleHarness.js';
import { COLS } from '../../server/sim/constants.js';

const data = loadData(process.env.SP_DATA_DIR ?? 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native', { log: { warn() {}, error() {} } });
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: factionSeasonV2.id, seed: 21 });
const firstCatalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: factionSeason.id, seed: 21 });
const active = new Set(catalog.config.activeOperatorIds);
const op = (name) => { const row = Object.values(catalog.operators).find((entry) => active.has(entry.id) && entry.name === name); assert.ok(row, name); return row; };
const ops = (...names) => names.map(op);
const close = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
const SOURCE_TERMS = ['微光', '黑市', '征服', '战利品', '实验格', '实验室', '晶体', '信号', '冲刺', 'Sion', '赞助', '卫灵', '全能吸血', '法术强度', '护甲', '魔抗', '法力', '暴击', '护盾', '火箭', '每叠加', '层数'];

/** A real Native Battle (preview: no scheduled waves) with the given operators on legal tiles. */
function arena(operators, { star = 1, equipment = {}, extraPacts = {}, seed = 21, cat = catalog, history = [], strategies = [], idle = false } = {}) {
  const catalog = cat;
  const base = { seed, difficulty: 'NORMAL', round: 2, roundLimit: 28, rulesVersion: 3, pieces: [], history, strategies };
  const field = getResonanceField(base, { data, catalog });
  const tiles = [...field.deployMap].map(([key]) => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.ok(tiles.length >= operators.length, 'enough legal tiles');
  const pieces = operators.map((row, index) => ({ uid: `p${index}`, operatorId: row.id, star, row: tiles[index][0], col: tiles[index][1], dir: 'RIGHT',
    equipment: (equipment[row.name] ?? []).map((itemId, item) => ({ uid: `i${index}-${item}`, itemId })), extraPacts: [...(extraPacts[row.name] ?? [])] }));
  const state = { ...base, pieces };
  const { battle } = buildResonanceBattle(state, { data, catalog, recording: false, preview: true });
  // `idle`: an empty field does not end the battle, so a test can wait for the first enemy
  if (idle) battle.autoFinish = false;
  battle.start();
  const unit = (name) => battle.allyUnits.find((entry) => entry.uid === pieces[operators.findIndex((row) => row.name === name)]?.uid);
  let serial = 0;
  const enemy = (pos, options = {}) => {
    const key = `stronghold_test_${++serial}`;
    return battle.spawnEnemy(key, { pos, def: enemyRec({ key, hp: options.hp ?? 100000, atk: 0, speed: 0, rank: options.rank ?? 'NORMAL', def: 0, res: 0, range: options.range ?? 0 }) });
  };
  const advance = (seconds) => { const until = battle.time + seconds; while (battle.time + 1e-9 < until && !battle.finished) battle.step(); };
  const far = () => [battle.rect.r0, battle.rect.c1];
  return { battle, state, unit, enemy, advance, far, tier: (id) => battle.resonanceMetrics?.prototypeTraits?.[id] };
}
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const lost = (unit, fn) => { const before = unit.hp; fn(); return before - unit.hp; };
const trueHit = (battle, source, target, amount = 1000, extra = {}) => battle.dealDamage(source, target, { amount, type: 'true', canDodge: false, ...extra });

test('faction season 2 keeps every season-1 member, tier and fee and replaces only tier effects', () => {
  assert.equal(factionSeasonV2.traits.length, 26);
  for (const trait of factionSeasonV2.traits) {
    const prior = factionSeason.traits.find((row) => row.id === trait.id);
    assert.deepEqual(trait.members, prior.members, trait.id);
    assert.deepEqual(trait.effects.map((tier) => [tier.minUnits, tier.maxUnits]), prior.effects.map((tier) => [tier.minUnits, tier.maxUnits]), trait.id);
    assert.deepEqual(trait.costDistribution, prior.costDistribution, trait.id);
    assert.equal(trait.emblemRequired, prior.emblemRequired, trait.id);
    assert.equal(!!trait.strongholdPact, STRONGHOLD_PACT_IDS.includes(trait.id), trait.id);
    assert.equal(catalog.pacts[trait.id].levels[0].effects[0].params.mechanic, trait.mechanic ?? catalog.pacts[trait.id].levels[0].effects[0].params.mechanic);
  }
  assert.equal(STRONGHOLD_PACT_IDS.length, 17);
  assert.equal(firstCatalog.pacts.academy.levels[0].effects[0].params.mechanic, 'shared_item_training', 'season 1 keeps its own pacts');
  assert.equal(catalog.pacts.academy.levels[0].effects[0].params.mechanic, 'wanted_ammo');
  assert.equal(catalog.pacts.artillery.levels.at(-1).effects[0].params.variables.AD, 0.25, 'kept pacts take the season-2 value corrections');
  assert.equal(firstCatalog.pacts.artillery.levels.at(-1).effects[0].params.variables.AD, factionSeason.traits.find((row) => row.id === 'artillery').effects.at(-1).variables.AD);
  assert.equal(firstCatalog.pacts.bruiser.levels.at(-1).effects[0].params.mechanic, factionSeason.traits.find((row) => row.id === 'bruiser').mechanic ?? firstCatalog.pacts.bruiser.levels.at(-1).effects[0].params.mechanic, 'season 1 keeps its 重装');
});

test('every season-2 tier has handwritten copy with its own values and no source-game concepts', () => {
  const view = resonanceDisplayCatalog(catalog, data);
  for (const pact of Object.values(catalog.pacts)) {
    assert.ok(pact.summaryDescription && pact.summaryDescription.length < 120, pact.name);
    assert.notEqual(pact.summaryDescription, firstCatalog.pacts[pact.id].summaryDescription, `${pact.name} has season-2 copy`);
    const tiers = pact.levels.map((level) => level.description);
    for (const text of [pact.summaryDescription, ...tiers]) {
      assert.ok(text && !/undefined|NaN|null|\$\{|TFT|原型/.test(text), `${pact.name}: ${text}`);
      assert.ok(text.length < 250, pact.name);
      for (const term of SOURCE_TERMS) assert.ok(!text.includes(term), `${pact.name} uses ${term}: ${text}`);
    }
    if (tiers.length > 1) assert.equal(new Set(tiers).size, tiers.length, `${pact.name} tiers are distinct`);
    assert.deepEqual(view.pacts[pact.id].levels.map((level) => level.description), tiers, `${pact.name} reaches the player catalog`);
    assert.equal(view.pacts[pact.id].rewardThresholds, undefined, `${pact.name} shows no chest schedule`);
  }
  assert.match(catalog.pacts.resistance.levels[1].description, new RegExp(catalog.equipment.blade.name), 'the hammer copy uses the equipment name');
  assert.match(catalog.pacts.academy.summaryDescription, /通缉/);
  assert.match(catalog.pacts.creation.levels[1].description, /寒风/);
  assert.match(catalog.pacts.sui.summaryDescription, /炎佑/);
});

test('season 2 retires the replaced economies and augments and keeps family, armory and holy gun', () => {
  const ids = (cat) => new Set(Object.values(cat.strategies).map((row) => row.source?.recordId));
  for (const apiName of STRONGHOLD_RETIRED_AUGMENTS) {
    assert.ok(ids(firstCatalog).has(apiName), `${apiName} stays in season 1`);
    assert.ok(!ids(catalog).has(apiName), `${apiName} leaves the season-2 pool`);
  }
  const tier = (id, count, variables = {}) => ({ id, count, tier: count, minUnits: count, maxUnits: count, variables, members: [] });
  const state = { seed: 4, round: 3, pendingChoices: [], prototypeMeta: { economy: { chemBaron: { shimmer: 250 }, conqueror: { conquest: 40, openedChests: [], pendingChests: [10] } } } };
  const prep = onPrototypeEconomyPrep(state, catalog, [tier('academy', 6), tier('risk', 3, { ShimmerPerCombat: 15 }), tier('conqueror', 4)]);
  assert.deepEqual(prep.choiceDrafts, [], 'no sponsor, market or chest choice opens in season 2');
  const result = onPrototypeEconomyResult(state, catalog, [tier('risk', 3, { ShimmerPerCombat: 15 }), tier('conqueror', 4)], { battleId: 'b-1', outcome: { won: true }, metrics: { prototypeTraits: { conqueror: { conquestStacks: 5 } } } });
  assert.ok(!result.events.some((event) => /shimmer|conqueror/.test(event.type)));
  const firstPrep = onPrototypeEconomyPrep(state, firstCatalog, [tier('conqueror', 4)]);
  assert.equal(firstPrep.choiceDrafts[0]?.economyKind, 'war_chest', 'a saved season-1 run still opens its chests');
  const king = onPrototypeEconomyResult(state, catalog, [tier('armory', 1, { NumRounds1Star: 1 })], { battleId: 'b-2', outcome: { won: true } });
  assert.ok(king.events.some((event) => event.type === 'junker_armory_unlocked'), 'the armory economy stays');
});

test('season 2 never creates or grants 破障重刃 and the 谢拉格 crown grants 卡西米尔竞技旗 instead', () => {
  const guardbreaker = 'prototype_academy_guardbreaker';
  assert.ok(firstCatalog.equipment[guardbreaker], 'season-1 saves still know the sponsor item');
  assert.equal(catalog.equipment[guardbreaker], undefined, 'season 2 does not create it');
  const grants = (cat) => Object.values(cat.strategies).flatMap((row) => (row.effects ?? []).flatMap((effect) => [...(effect.params?.bonusRewards ?? []).map((reward) => reward.itemId), ...(effect.params?.itemIds ?? [])]));
  assert.ok(!grants(catalog).includes(guardbreaker));
  const economy = catalog.prototypeEconomy;
  const pools = [...(economy.academy.eligibleItemIds ?? []), ...(economy.academy.sponsorSets ?? []).flatMap((set) => set.itemIds), ...Object.values(economy.gearPools ?? {}).flat(),
    ...Object.values(economy.family.heistOptionsByThreshold).flat().flatMap((row) => row.grant ?? []).map((grant) => grant.id)];
  assert.ok(!pools.includes(guardbreaker), 'no reward pool reaches it');
  const crown = Object.values(catalog.strategies).find((row) => row.source?.recordId === 'TFT13_Augment_AutomataCrown');
  assert.deepEqual(crown.effects[0].params.bonusRewards.filter((reward) => reward.kind === 'item').map((reward) => reward.itemId), ['hurricane']);
  assert.match(crown.description, new RegExp(catalog.equipment.hurricane.name));
  const firstCrown = Object.values(firstCatalog.strategies).find((row) => row.source?.recordId === 'TFT13_Augment_AutomataCrown');
  assert.ok(firstCrown.effects[0].params.bonusRewards.some((reward) => reward.itemId === guardbreaker), 'season 1 keeps its own crown reward');
});

test('item quality bonuses scale the native percentage stats and are reachable through the 同袍 heist in season 2', () => {
  const quality = catalog.prototypeEconomy.qualityEffects;
  const anvil = Object.values(catalog.prototypeEconomy.family.heistOptionsByThreshold).flat().find((row) => (row.grant ?? []).some((grant) => grant.id === 'prototype_artifact_anvil'));
  assert.ok(anvil, 'the kept 同袍 heist still offers an artifact anvil');
  const statsOf = (item) => {
    const stats = {};
    for (const effect of item.baseEffects ?? item.effects ?? []) if (effect.kind === 'component_stat') for (const [key, value] of Object.entries(effect.params ?? {})) stats[key] = (stats[key] ?? 0) + value;
    return stats;
  };
  let checked = 0;
  for (const id of catalog.prototypeEconomy.gearPools.artifact) {
    const stats = statsOf(catalog.equipment[id]), mods = quality.artifact[id].mods;
    for (const [source, target, scale] of [['atkPct', 'atkPct', 0.01], ['defPct', 'defPct', 0.01], ['hpPct', 'hpPct', 0.01], ['aspd', 'aspd', 1], ['res', 'resFlat', 1], ['sp', 'spRecoveryFlat', 1]]) {
      if (!stats[source]) continue;
      close(mods[target], stats[source] * scale * 0.5, `${id} artifact ${target}`);
      close(quality.radiant[id].mods[target], stats[source] * scale, `${id} radiant ${target}`);
      checked++;
    }
  }
  assert.ok(checked >= 10, 'the native item stats all carry a quality bonus');
  const armorAxe = quality.artifact.armorAxe.mods;
  assert.ok(armorAxe.atkPct > 0 && armorAxe.defPct > 0, 'a percentage-only item is no longer left without a bonus');
});

test('维多利亚 earns one hammer every three battles and the session hands it out once', () => {
  const tier = { id: 'resistance', count: 5, tier: 5, minUnits: 5, maxUnits: 6, variables: { perComponent: 0.1, perCompleted: 0.15, hammerEvery: 3 }, members: [] };
  let state = { seed: 4, round: 3, pendingChoices: [], prototypeMeta: { economy: {} } };
  for (let index = 1; index <= 3; index++) {
    const result = onPrototypeEconomyResult(state, catalog, [tier], { battleId: `v-${index}`, outcome: { won: index !== 2 } });
    state = result.state;
    assert.equal(result.events.some((event) => event.type === 'victoria_hammer_earned'), index === 3, `battle ${index}`);
  }
  const prep = onPrototypeEconomyPrep(state, catalog, [tier]);
  assert.equal(prep.choiceDrafts.length, 1);
  assert.equal(prep.choiceDrafts[0].economyKind, 'victoria_hammer');
  assert.deepEqual(prep.choiceDrafts[0].options[0].grant, [{ kind: 'item', id: 'blade' }]);
  assert.equal(onPrototypeEconomyPrep(prep.state, catalog, [tier]).choiceDrafts.length, 0, 'the same hammer is not offered twice');

  const created = createSession({ seed: 41, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  const session = structuredClone(created.state);
  const draft = prep.choiceDrafts[0];
  session.pendingChoices = [{ uid: 'c-hammer', type: 'prototype_economy', source: draft.source, economyKind: draft.economyKind, options: draft.options.map((row) => row.id),
    remaining: 1, metadata: { ...draft.metadata, optionDetails: draft.options } }];
  session.prototypeMeta = { ...(session.prototypeMeta ?? {}), economy: prep.state.prototypeMeta.economy };
  session.phase = 'choice';
  const inventory = session.inventory.length;
  const claimed = applyAction(session, { type: 'claimReward', choiceUid: 'c-hammer', optionIds: ['victoria_hammer'], expectedRevision: session.revision }, { catalog });
  assert.equal(claimed.ok, true, claimed.error);
  assert.equal(claimed.state.inventory.length, inventory + 1);
  assert.equal(claimed.state.inventory.at(-1).itemId, 'blade');
  assert.equal(claimed.state.prototypeMeta.economy.victoria.pendingHammers, 0);
  assert.equal(claimed.state.prototypeMeta.economy.victoria.claimed, 1);
});

test('拉特兰 marks the toughest enemy on the field with the 蕾缪安 通缉 state, moves the mark, adds damage, bullets, duration and SP', () => {
  const three = arena([...ops('送葬人', '见行者', '空弦'), op('角峰')], { idle: true });
  const { battle } = three;
  const marked = (enemy) => enemy.buffs.some((buff) => buff.key === 'lemuen:wanted');
  three.advance(20);
  assert.ok(!three.tier('academy').wanted, 'nothing is marked while the field is empty');
  const first = three.enemy([10, 9], { hp: 50000 });
  assert.ok(first.mem.strongholdWanted && marked(first), 'the first arrival is wanted at once');
  const elite = three.enemy([11, 9], { hp: 20000, rank: 'ELITE' });
  assert.ok(marked(elite) && !marked(first), 'an elite arriving takes the mark from a normal enemy');
  const heavy = three.enemy([12, 9], { hp: 90000 });
  assert.ok(marked(elite) && !marked(heavy), 'only one wanted at three members, elites first');
  const member = three.unit('空弦'), other = three.unit('角峰');
  const bonus = lost(elite, () => trueHit(battle, member, elite)) / lost(heavy, () => trueHit(battle, member, heavy));
  close(bonus, 1.2, 'wanted damage +20%');
  close(lost(elite, () => trueHit(battle, other, elite)), lost(heavy, () => trueHit(battle, other, heavy)), 'non-members gain nothing');
  trueHit(battle, three.unit('送葬人'), elite, elite.hp + 10);
  assert.ok(marked(heavy) && !marked(first), 'when the wanted enemy falls the mark goes to the highest max HP left');
  // a mark 蕾缪安's talent placed stays when the pact's moves on, and it counts as wanted for the pact
  battle.addBuff(first, { key: 'lemuen:wanted', visible: true });
  close(lost(first, () => trueHit(battle, member, first)) / lost(heavy, () => trueHit(battle, member, heavy)), 1, 'both wanted');
  trueHit(battle, three.unit('送葬人'), heavy, heavy.hp + 10);
  assert.equal(first.mem.strongholdWanted, true, 'the pact takes over the already wanted enemy');
  const boss = three.enemy([13, 9], { hp: 30000, rank: 'ELITE' });
  assert.ok(marked(boss) && marked(first), 'the pact mark moves on, 蕾缪安\'s own mark stays');
  assert.ok(three.tier('academy').wantedMoved >= 2);
  assert.equal(battle.errorCount, 0);

  const five = arena(ops('送葬人', '见行者', '隐现', '空弦', '蕾缪安'));
  const sniper = five.unit('隐现'), funeral = five.unit('送葬人'), bowman = five.unit('空弦');
  assert.equal(sniper.skill.kind, 'ammo');
  const ammo = sniper.skill.ammo;
  sniper.skill.activate('test', { free: true });
  assert.equal(sniper.skill.ammoLeft, ammo + Math.round(ammo * 0.3), 'ammo skill +30% bullets');
  funeral.skill.activate('test', { free: true });
  close(funeral.skill.timeLeft, funeral.skill.duration * 1.2, 'duration skill +20%');
  bowman.skill.sp = 0; bowman.skill.charges = 0;
  const wanted = five.enemy([10, 9]), spBefore = bowman.skill.sp;
  assert.equal(wanted.mem.strongholdWanted, true);
  trueHit(five.battle, funeral, wanted, wanted.hp + 10);
  close(bowman.skill.sp - spBefore, 4, 'a wanted knock-out gives every 拉特兰 member 4 SP');
  assert.equal(five.tier('academy').wantedKills, 1);
  assert.equal(five.battle.errorCount, 0);
});

test('谢拉格 attacks chill with a per-target cooldown, the cold wind chills everyone and a second chill freezes', () => {
  const two = arena([...ops('角峰', '银灰'), op('格拉尼')]);
  const member = two.unit('角峰'), cold = two.enemy([10, 9]), warm = two.enemy([11, 9]);
  two.battle.dealDamage(member, cold, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(cold.s.flags.cold, true, 'an attack chills');
  two.battle.dealDamage(member, cold, { amount: 1, type: 'phys', isAttack: true });
  assert.ok(!cold.s.flags.freeze, 'the per-target cooldown prevents an attack-only freeze');
  close(lost(cold, () => trueHit(two.battle, member, cold)) / lost(warm, () => trueHit(two.battle, member, warm)), 1.15, 'damage +15% to a cold enemy');
  assert.equal(two.battle.errorCount, 0);

  const four = arena(ops('角峰', '耶拉', '银灰', '灵知'), { idle: true });
  four.advance(30);
  assert.ok(!four.tier('creation').winds, 'the wind waits while the field is empty');
  const a = four.enemy(four.far()), b = four.enemy([four.battle.rect.r0 + 1, four.battle.rect.c1]);
  four.advance(19.5);
  assert.ok(!four.tier('creation').winds, 'the clock only runs with enemies on the field');
  four.advance(0.8);
  assert.ok(a.s.flags.cold && b.s.flags.cold, 'the cold wind chills the whole field after 20 seconds with enemies');
  four.battle.dealDamage(four.unit('银灰'), a, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(a.s.flags.freeze, true, 'an attack on a wind-chilled enemy freezes it');
  assert.ok(four.tier('creation').winds >= 1 && four.tier('creation').freezes >= 1);
  assert.equal(four.battle.errorCount, 0);
});

test('炎 summons a visible native 炎佑 that attacks, flames, and doubles at seven', () => {
  const three = arena(ops('九色鹿', '惊蛰', '仇白'));
  const members = ['九色鹿', '惊蛰', '仇白'].map(three.unit);
  const guardians = three.battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.mem.strongholdGuardian);
  assert.equal(guardians.length, 1);
  const [guardian] = guardians;
  assert.equal(guardian.defId, 'enemy_9012_acloon');
  assert.match(guardian.name, /炎佑/);
  close(guardian.base.atk, 0.2 * members.reduce((sum, unit) => sum + unit.s.atk, 0), 'ATK is 20% of the 炎 total', 1e-3);
  close(guardian.base.maxHp, 0.2 * members.reduce((sum, unit) => sum + unit.s.maxHp, 0), 'max HP is 20% of the 炎 total', 1e-3);
  assert.equal(Math.floor((guardian.profile.maxTargets || 1) + guardian.s.maxTargets), 2, 'two targets at three members');
  assert.ok(guardian.skill.noSkill, 'the pact flame replaces its own channel');
  const target = three.enemy([10, 8]);
  three.advance(12);
  assert.ok(target.hp < target.s.maxHp && guardian.stats.dmg > 0, 'the 炎佑 attacks on its own');
  assert.ok(target.elem.burn > 0 || target.hp < target.s.maxHp, 'its hits carry 灼燃损伤');
  assert.equal(three.battle.errorCount, 0);

  const five = arena(ops('九色鹿', '惊蛰', '仇白', '夕', '令'), { idle: true });
  five.advance(20);
  assert.ok(!five.tier('sui').flames, 'no 祛恶之焰 while no enemy is near');
  const flier = five.battle.allyUnits.find((unit) => unit.mem?.strongholdGuardian);
  const near = five.enemy([Math.round(flier.y), Math.round(flier.x) + 1], { hp: 10000000 });
  five.advance(0.5);
  assert.equal(five.tier('sui').flames, 1, '祛恶之焰 as soon as an enemy is near');
  five.advance(14);
  assert.equal(five.tier('sui').flames, 1, 'at most once per 15 seconds');
  five.advance(1);
  assert.equal(five.tier('sui').flames, 2);
  assert.ok(near.buffs.some((buff) => buff.status === 'elemFragile') || !near.alive, 'flamed enemies take 元素脆弱');
  assert.equal(five.battle.errorCount, 0);

  const seven = arena([...ops('九色鹿', '惊蛰', '仇白', '夕', '令'), ...ops('格拉尼', '角峰')], { extraPacts: { 格拉尼: ['sui'], 角峰: ['sui'] } });
  const pair = seven.battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.mem.strongholdGuardian);
  assert.equal(pair.length, 2, 'seven 炎 members summon two');
  for (const unit of pair) close(unit.s.dmgTakenMul, 0.5, 'damage taken -50%');
  assert.equal(seven.battle.errorCount, 0);
});

const inRangeTile = (run, unit) => {
  const own = unit.tileR * COLS + unit.tileC;
  const keys = [...unit.rangeKeys].filter((row) => run.battle.grid.inRect(Math.floor(row / COLS), row % COLS));
  const key = keys.find((row) => row !== own) ?? keys.find((row) => row === own);
  assert.ok(key != null, `${unit.name} has a tile in range`);
  return [Math.floor(key / COLS), key % COLS];
};
const buffOf = (unit, part) => unit.buffs.find((buff) => buff.key.includes(part));

test('深海猎人 hunts wounded enemies, speeds up after a knock-out, revives once at three and executes at four', () => {
  const two = arena(ops('斯卡蒂', '幽灵鲨'), { idle: true });
  const skadi = two.unit('斯卡蒂');
  assert.ok(!skadi.buffs.some((buff) => buff.key.includes('abyssal')), 'no health bonus');
  const weak = two.enemy([10, 9]), sound = two.enemy([11, 9]);
  weak.hp = weak.s.maxHp * 0.4; sound.hp = sound.s.maxHp * 0.6;
  close(lost(weak, () => trueHit(two.battle, skadi, weak)) / lost(sound, () => trueHit(two.battle, skadi, sound)), 1.25, '+25% below half health');
  const prey = two.enemy([12, 9], { hp: 1000 });
  trueHit(two.battle, skadi, prey, 5000);
  assert.equal(prey.alive, false);
  close(buffOf(skadi, 'abyssal-hunt').mods.aspd, 20, 'attack speed +20 after a knock-out');
  trueHit(two.battle, sound, skadi, skadi.hp + skadi.s.maxHp);
  assert.equal(skadi.alive, false, 'no revive below three members');
  assert.equal(two.battle.errorCount, 0);

  const three = arena(ops('斯卡蒂', '幽灵鲨', '歌蕾蒂娅'));
  const shark = three.unit('幽灵鲨');
  trueHit(three.battle, three.enemy([10, 9]), shark, shark.hp + shark.s.maxHp);
  assert.equal(shark.alive, true, 'the first knock-out is prevented');
  close(shark.hp, shark.s.maxHp * 0.5, 'at 50% health', 1e-3);

  const four = arena([...ops('斯卡蒂', '幽灵鲨', '歌蕾蒂娅'), op('格拉尼')], { extraPacts: { 格拉尼: ['flight'] } });
  const hunter = four.unit('歌蕾蒂娅'), low = four.enemy([10, 9], { hp: 10000 }), healthy = four.enemy([11, 9], { hp: 10000 });
  low.hp = low.s.maxHp * 0.08; healthy.hp = healthy.s.maxHp * 0.2;
  four.battle.dealDamage(hunter, low, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(low.alive, false, 'below 10% one hit knocks it out');
  four.battle.dealDamage(hunter, healthy, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(healthy.alive, true, 'above it the hit is a hit');
  assert.equal(four.tier('flight').executions, 1);
  assert.equal(four.battle.errorCount, 0);
});

test('维多利亚 scales ATK by carried items and lends the temporary hammer to members with a free slot', () => {
  const completed = Object.values(catalog.equipment).find((item) => item.kind === 'completed' && item.grantAllowed !== false).id;
  const three = arena(ops('格拉尼', '凯瑟琳', '谜图'), { equipment: { 格拉尼: ['blade', completed] } });
  const geared = three.unit('格拉尼').buffs.find((buff) => buff.key.startsWith('stronghold:victoria-equipment'));
  close(geared.mods.atkPct, 0.06 + 0.1, 'one component and one completed item');
  assert.ok(!three.unit('凯瑟琳').buffs.some((buff) => buff.key.startsWith('stronghold:victoria-equipment')));
  assert.equal(three.battle.errorCount, 0);

  const names = ['格拉尼', '凯瑟琳', '谜图', '刺玫', '哈洛德', '号角', '焰影苇草'];
  const seven = arena(ops(...names), { equipment: { 格拉尼: ['blade', 'blade', completed] } });
  assert.equal(seven.unit('格拉尼').mem.strongholdTemporaryItems, undefined, 'a full member borrows nothing');
  assert.deepEqual(seven.unit('凯瑟琳').mem.strongholdTemporaryItems, ['blade']);
  close(seven.unit('凯瑟琳').buffs.find((buff) => buff.key.startsWith('stronghold:victoria-equipment')).mods.atkPct, 0.14, 'the hammer counts as a component');
  close(seven.unit('格拉尼').buffs.find((buff) => buff.key.startsWith('stronghold:victoria-equipment')).mods.atkPct, 0.14 * 2 + 0.2);
  assert.equal(seven.tier('resistance').temporaryHammers, names.length - 1);
  assert.equal(seven.battle.errorCount, 0);

  const ten = arena([...ops(...names, '维娜·维多利亚'), ...ops('角峰', '斯卡蒂', '银灰')], { equipment: { 银灰: [completed] }, extraPacts: { 角峰: ['resistance'], 斯卡蒂: ['resistance'] } });
  close(ten.unit('银灰').buffs.find((buff) => buff.key.startsWith('stronghold:victoria-equipment')).mods.atkPct, 0.3 * 0.5, 'others get half at ten');
  assert.equal(ten.battle.errorCount, 0);
});

test('叙拉古 hides in 隐匿 until its first attack, ambushes with it, then speeds up and fears', () => {
  const four = arena(ops('红云', '贾维', '布洛卡', '巫恋'), { idle: true });
  const opening = (unit) => unit.buffs.find((buff) => buff.key.startsWith('stronghold:siracusa-opening'));
  const brocca = four.unit('布洛卡');
  assert.equal(brocca.s.flags.stealth, true, 'members start in 隐匿');
  assert.ok(!opening(brocca), 'the opening speed waits for the first attack');
  four.advance(30);
  assert.equal(brocca.s.flags.stealth, true, '隐匿 lasts while there is nothing to attack');
  const shooter = four.enemy([10, 9], { range: 3 }), control = four.enemy([11, 9]);
  assert.equal(canTargetAlly(shooter, brocca, true), false, 'a ranged enemy cannot target a hidden member');
  four.battle.rng = () => 0.99;
  const ambush = lost(shooter, () => trueHit(four.battle, brocca, shooter, 1000, { isAttack: true }));
  const plain = lost(control, () => trueHit(four.battle, brocca, control, 1000, { isAttack: true }));
  close(ambush / plain, 1.5, 'the first attack leaves 隐匿 with +50%');
  assert.ok(!brocca.s.flags.stealth && canTargetAlly(shooter, brocca, true), '隐匿 ends with the first attack');
  close(opening(brocca).timeLeft, 20, 'attack speed for 20 seconds from the first attack', 1e-3);
  close(opening(brocca).mods.aspd, 25, 'attack speed +25');
  assert.equal(four.tier('risk').ambushes, 1);
  assert.equal(four.battle.errorCount, 0);

  const six = arena(ops('红云', '贾维', '布洛卡', '巫恋', '拉普兰德', '荒芜拉普兰德'), { idle: true });
  six.advance(15);
  const member = six.unit('拉普兰德'), feared = six.enemy([10, 9]), calm = six.enemy([11, 9]);
  six.battle.rng = () => 0;
  six.battle.dealDamage(member, feared, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(feared.s.flags.fear, true, 'the first attack opens the fear window');
  six.battle.rng = () => 0.99;
  close(lost(feared, () => trueHit(six.battle, member, feared)) / lost(calm, () => trueHit(six.battle, member, calm)), 1.3, '+30% against a feared enemy');
  six.advance(10.5);
  const late = six.enemy([12, 9]);
  six.battle.rng = () => 0;
  six.battle.dealDamage(member, late, { amount: 1, type: 'phys', isAttack: true });
  assert.ok(!late.s.flags.fear, 'no fear 10 seconds after the first attack');
  assert.equal(six.battle.errorCount, 0);
});

test('掌控 gains SP when an enemy first enters a member range in season 2 and keeps the start-of-battle shield in season 1', () => {
  const two = arena(ops('耶拉', '夕'), { idle: true });
  const kjera = two.unit('耶拉'), dusk = two.unit('夕');
  for (const unit of [kjera, dusk]) { unit.skill.sp = 0; unit.skill.charges = 0; }
  two.advance(10);
  const kjeraIdle = kjera.skill.spTotal, duskIdle = dusk.skill.spTotal;
  const far = two.enemy(two.far());
  two.battle.dealDamage(kjera, far, { amount: 1, type: 'arts', isAttack: true });
  assert.ok(kjera.skill.spTotal - kjeraIdle >= 5 - 1e-6, 'striking an enemy counts as contact: +5 SP');
  assert.ok(dusk.skill.spTotal - duskIdle < 1, 'per member');
  assert.ok(!kjera.buffs.some((buff) => buff.key.startsWith('resonance:v3:dominator-shield')), 'no 屏障 in season 2');
  dusk.skill.sp = 0; dusk.skill.charges = 0;   // a full bar would cap the gain
  const before = dusk.skill.spTotal;
  two.enemy(inRangeTile(two, dusk));
  two.advance(0.3);
  assert.ok(dusk.skill.spTotal - before >= 5 - 1e-6, 'an enemy entering the range is contact too');
  const kjeraAfter = kjera.skill.spTotal;
  two.battle.dealDamage(kjera, far, { amount: 1, type: 'arts', isAttack: true });
  assert.ok(kjera.skill.spTotal - kjeraAfter < 1, 'once per battle');
  assert.equal(two.battle.errorCount, 0);
  const first = arena(ops('耶拉', '夕'), { cat: firstCatalog });
  assert.ok(first.unit('耶拉').buffs.some((buff) => buff.key.startsWith('resonance:v3:dominator-shield')), 'season 1 keeps the start-of-battle shield');
});

test('迅击爆发 counts each member\'s bursts from its first attack in season 2', () => {
  const id = 'prototype_set13_quickstriker';
  assert.match(catalog.strategies[id].description, /首次攻击时及之后每6秒，攻击速度\+85，持续2\.5秒/);
  assert.match(firstCatalog.strategies[id].description, /战斗开始/, 'season 1 keeps its own rule');
  const burst = (unit) => unit.buffs.find((buff) => buff.key.includes(':burst:'));
  const two = arena(ops('谜图', '焰尾'), { strategies: [id], idle: true });
  const a = two.unit('谜图'), b = two.unit('焰尾');
  two.advance(10);
  assert.ok(!burst(a) && !burst(b), 'no burst while the field is empty');
  const foe = two.enemy([10, 9]);
  two.battle.dealDamage(a, foe, { amount: 1, type: 'phys', isAttack: true });
  close(burst(a)?.mods.aspd, 85, 'the first attack bursts at once');
  assert.ok(!burst(b), 'per member');
  two.advance(3);
  assert.ok(!burst(a), 'the burst lasts 2.5 seconds');
  two.advance(3.2);
  assert.ok(burst(a), 'and comes back 6 seconds after the first');
  assert.equal(two.battle.errorCount, 0);
  const first = arena(ops('谜图', '焰尾'), { strategies: [id], cat: firstCatalog });
  first.advance(0.1);
  assert.ok(burst(first.unit('谜图')), 'season 1 bursts at the start');
});

test('season-2 strategy, pact and equipment copy uses only in-game words', () => {
  const view = resonanceDisplayCatalog(catalog, data);
  const banned = ['护盾', '攻速', '评分', '术法', '双抗', '普攻', '转职', '备战席', '周围1格', '法抗', '击杀', '「', 'TFT', 'undefined', 'NaN'];
  const texts = [
    ...Object.values(view.strategies).flatMap((row) => [row.name, row.description]),
    ...Object.values(view.pacts).flatMap((row) => [row.summaryDescription, ...row.levels.map((level) => level.description)]),
    ...Object.entries(view.equipment).filter(([id, row]) => !id.startsWith('prototype_chem') && !row.codexHidden).flatMap(([, row]) => [row.name, row.description]),
  ].filter(Boolean);
  // native item names (护盾无人机 …) are the game's own words
  const itemNames = Object.values(view.equipment).map((row) => row.name).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const text of texts) {
    const words = itemNames.reduce((rest, name) => rest.replaceAll(name, ''), text);
    for (const term of banned) assert.ok(!words.includes(term), `${term} in: ${text}`);
  }
  for (const row of Object.values(view.strategies)) assert.ok(!/\s徽记/.test(row.name), row.name);
  assert.equal(catalog.strategies.prototype_set13_academycrest.description.startsWith('获得“拉特兰徽记”'), true, 'crests name the item the player receives');
});

const traitOps = (trait) => [...new Map(Object.values(catalog.operators).filter((row) => active.has(row.id) && row.pacts.includes(trait)).map((row) => [row.charId, row])).values()];

test('术式还击 bursts on enemies only, never on the allies next to the fallen member', () => {
  const id = 'prototype_set13_sorcerer';
  const [mage] = traitOps('arts');
  const run = arena([mage, op('银灰')], { strategies: [id], idle: true });
  const fallen = run.unit(mage.name), ally = run.unit('银灰');
  assert.ok(Math.hypot(fallen.x - ally.x, fallen.y - ally.y) <= 1.5, 'the ally stands next to the member');
  const foe = run.enemy([fallen.tileR, fallen.tileC]);
  const allyHp = ally.hp, foeHp = foe.hp;
  trueHit(run.battle, foe, fallen, fallen.hp + fallen.s.maxHp * 2);
  assert.equal(fallen.alive, false);
  assert.equal(ally.hp, allyHp, 'no damage to the ally');
  assert.ok(foe.hp < foeHp, 'the enemy next to it takes the burst');
  assert.equal(run.battle.errorCount, 0);
});

test('守望战痕 stacks at most ten times in season 2', () => {
  const id = 'prototype_set13_watcher';
  const [guard] = traitOps('watcher');
  const run = arena([guard], { strategies: [id], idle: true });
  const unit = run.unit(guard.name), foe = run.enemy([unit.tileR, unit.tileC + 1]);
  for (let i = 0; i < 15; i++) run.battle.dealDamage(foe, unit, { amount: 10, type: 'phys', isAttack: true });
  const scars = unit.buffs.find((buff) => buff.key.includes(':attack-scars:'));
  close(scars.mods.atkPct, 0.2, 'ten stacks of +2%');
  assert.equal(run.battle.errorCount, 0);
});

test('坚阵盾击 and 卡西米尔断头台 give native DEF / RES in season 2', () => {
  const [sentinel] = traitOps('sentinel');
  const plain = arena([sentinel]).unit(sentinel.name), shielded = arena([sentinel], { strategies: ['prototype_set13_sentinel'] }).unit(sentinel.name);
  close(shielded.s.def / plain.s.def, 1.05, 'DEF +5%', 1e-3);
  const [knight] = traitOps('conqueror');
  const run = arena([knight], { strategies: ['prototype_set13_conqueror'], idle: true });
  const unit = run.unit(knight.name), def = unit.s.def, res = unit.s.res;
  for (let i = 0; i < 6; i++) {
    const foe = run.enemy([unit.tileR, unit.tileC + 1], { hp: 1000 });
    foe.hp = foe.s.maxHp * 0.1;
    run.battle.dealDamage(unit, foe, { amount: 1, type: 'phys', isAttack: true });
    assert.equal(foe.alive, false, 'below 12% it is knocked out');
  }
  const stacks = unit.buffs.find((buff) => buff.key.includes(':conqueror-executions:'));
  close(stacks.mods.defPct, 0.4, 'DEF +8% per knock-out, five at most');
  close(stacks.mods.resFlat, 20, 'RES +4 per knock-out, five at most');
  assert.ok(unit.s.def > def && unit.s.res >= res + 20 - 1e-6);
  assert.equal(run.battle.errorCount, 0);
});

test('卡西米尔 attacks carry true damage and blocking members pulse true damage and stun', () => {
  const two = arena([...ops('砾', '焰尾'), op('格拉尼')]);
  const member = two.unit('砾'), other = two.unit('格拉尼'), target = two.enemy([10, 9]);
  two.battle.rng = () => 0.99;
  close(lost(target, () => two.battle.dealDamage(member, target, { amount: 0, type: 'phys', isAttack: true })), member.s.atk * 0.08, 'an attack adds 8% ATK true damage');
  assert.equal(lost(target, () => two.battle.dealDamage(other, target, { amount: 0, type: 'phys', isAttack: true })), 0, 'non-members add nothing');
  assert.equal(two.battle.errorCount, 0);

  const six = arena(ops('砾', '焰尾', '瑕光', '流星', '玛恩纳', '正义骑士号'));
  const blocker = six.unit('砾');
  const pinned = six.enemy([blocker.tileR, blocker.tileC]), stuns = [];
  six.battle.on('statusApplied', (event) => { if (event.status === 'stun' && event.target === pinned && event.source === blocker) stuns.push(event); });
  six.advance(0.3);
  assert.equal(pinned.blockedBy, blocker, 'the fixture enemy is blocked');
  six.advance(2.2);
  assert.ok(six.tier('conqueror').blockPulses >= 1, 'a blocking member pulses');
  assert.ok(stuns.length >= 1 && stuns.every((event) => Math.abs(event.duration - 0.5) < 1e-9), 'the pulse stuns for 0.5 s at six');
  assert.equal(six.battle.errorCount, 0);

  const nine = arena([...ops('砾', '焰尾', '瑕光', '流星', '玛恩纳', '正义骑士号'), ...ops('格拉尼', '角峰', '斯卡蒂'), op('银灰')], { extraPacts: { 格拉尼: ['conqueror'], 角峰: ['conqueror'], 斯卡蒂: ['conqueror'] } });
  const outsider = nine.unit('银灰'), dummy = nine.enemy([10, 9]);
  nine.battle.rng = () => 0.99;
  close(lost(dummy, () => nine.battle.dealDamage(outsider, dummy, { amount: 0, type: 'phys', isAttack: true })), outsider.s.atk * 0.1, 'others add 10% ATK true damage at nine');
  assert.equal(nine.battle.errorCount, 0);
});

test('萨尔贡 skill starts relay speed, leave 流沙 and pass SP', () => {
  const three = arena(ops('蜜蜡', '泡泡', '菲莱'));
  three.unit('蜜蜡').skill.activate('test', { free: true });
  for (const name of ['蜜蜡', '泡泡', '菲莱']) {
    const relay = three.unit(name).buffs.find((buff) => buff.key.startsWith('stronghold:sargon-relay'));
    assert.ok(relay && relay.mods.aspd === 20 && relay.timeLeft <= 8, `${name} gets +20 ASPD for 8 s`);
  }
  assert.equal(three.battle.errorCount, 0);

  const seven = arena([...ops('蜜蜡', '艾丝黛尔', '泡泡', '菲莱', '异客'), ...ops('格拉尼', '角峰')], { extraPacts: { 格拉尼: ['experiment'], 角峰: ['experiment'] } });
  const caster = seven.unit('艾丝黛尔'), mate = seven.unit('泡泡');
  const sand = seven.enemy([caster.tileR, caster.tileC + 1]);
  const spBefore = mate.skill.spTotal;
  caster.skill.activate('test', { free: true });
  close(mate.buffs.find((buff) => buff.key.startsWith('stronghold:sargon-relay')).mods.atkPct, 0.2, 'ATK +20% at seven');
  close(mate.skill.spTotal - spBefore, 3, 'other members recover 3 SP');
  seven.advance(0.3);
  assert.ok(sand.buffs.some((buff) => buff.status === 'slow'), '流沙 slows the enemy next to the caster');
  assert.equal(seven.battle.errorCount, 0);
});

test('哥伦比亚 skill starts strike and stun every enemy in the member range and expose them at six', () => {
  const two = arena(ops('香草', '雷蛇'), { idle: true });
  const vanilla = two.unit('香草');
  assert.ok(!vanilla.buffs.some((buff) => num(buff.shield) > 0), 'no 屏障');
  const foe = two.enemy(inRangeTile(two, vanilla), { hp: 1000000 }), far = two.enemy(two.far());
  two.advance(0.05);   // a new enemy is on the field index from the next step
  const struck = foe.hp;
  vanilla.skill.activate('test', { free: true });
  assert.ok(foe.hp < struck && foe.s.flags.stun, 'an enemy in range is struck and stunned');
  assert.equal(far.hp, far.s.maxHp, 'out of range nothing happens');
  assert.ok(!foe.buffs.some((buff) => buff.status === 'fragile'), 'no 脆弱 below six');
  assert.equal(two.tier('rhodes').shocks, 1);

  const six = arena(ops('香草', '罗比菈塔', '雷蛇', '梅尔', '塞雷娅', '多萝西'), { idle: true });
  const caster = six.unit('香草'), target = six.enemy(inRangeTile(six, caster), { hp: 1000000 });
  six.advance(0.05);
  caster.skill.activate('test', { free: true });
  const exposed = target.buffs.find((buff) => buff.status === 'fragile');
  assert.ok(target.s.flags.stun && exposed, 'stunned and exposed at six');
  close(target.s.dmgTakenMul, 1.2, 'damage taken +20% while stunned', 1e-3);
  assert.equal(six.battle.errorCount, 0);
});

test('罗德岛 heals make allies hit harder, skill starts rally the neighbours, and an enemy falling in range refunds SP', () => {
  const two = arena(ops('调香师', '华法琳'), { idle: true });
  const perfumer = two.unit('调香师'), ally = two.unit('华法琳');
  assert.equal(perfumer.s.healingTakenMul, 1, 'no healing-taken bonus');
  two.battle.heal(perfumer, ally, 100);
  close(buffOf(ally, 'rhodes-island-care').mods.atkPct, 0.1, 'an ally healed by a member: ATK +10%');
  assert.ok(buffOf(ally, 'rhodes-island-care').timeLeft <= 5);
  assert.ok(!buffOf(perfumer, 'rhodes-island-rally'), 'no rally below four');

  const eight = arena([...ops('调香师', '休谟斯', '华法琳', '寒芒克洛丝', '百炼嘉维尔', '泥岩', '魔王'), op('格拉尼')], { extraPacts: { 格拉尼: ['enforcer'] }, idle: true });
  const caster = eight.unit('调香师'), other = eight.unit('华法琳');
  other.skill.sp = 0; other.skill.charges = 0;
  const spBefore = other.skill.spTotal;
  caster.skill.activate('test', { free: true });
  const near = eight.battle.allyUnits.filter((unit) => unit.alive && unit.kind === 'op' && Math.max(Math.abs(unit.tileR - caster.tileR), Math.abs(unit.tileC - caster.tileC)) <= 1);
  for (const unit of near) close(buffOf(unit, 'rhodes-island-rally').mods.aspd, 30, `${unit.name} rallied: attack speed +30`);
  assert.ok(other.skill.spTotal - spBefore >= 3 - 1e-6, 'other members gain 3 SP');
  const medic = eight.unit('华法琳');
  medic.skill.sp = 0; medic.skill.charges = 0;
  const victim = eight.enemy(inRangeTile(eight, medic), { hp: 10 });
  trueHit(eight.battle, eight.unit('百炼嘉维尔'), victim, 100);
  assert.equal(victim.alive, false);
  assert.ok(medic.skill.spTotal >= 2 && eight.tier('enforcer').fallSp >= 1, 'an enemy falling in range refunds 2 SP');
  assert.equal(eight.battle.errorCount, 0);
});

test('狙击 and 术式 give precision and arcane marks with their tiered scopes', () => {
  const four = arena(ops('送葬人', '流星', '隐现', '空弦'));
  const buff = four.unit('隐现').buffs.find((row) => row.key.startsWith('stronghold:precision'));
  close(buff.mods.atkPct, 0.18, 'ATK +18%');
  close(buff.mods.defIgnorePct, 0.15, 'ignores 15% DEF');
  assert.equal(four.battle.errorCount, 0);

  const arts = arena([...ops('九色鹿', '惊蛰'), op('耶拉')]);
  const caster = arts.unit('惊蛰'), other = arts.unit('耶拉'), marked = arts.enemy([10, 9]), clean = arts.enemy([11, 9]);
  arts.battle.dealDamage(caster, marked, { amount: 1, type: 'arts', isSkill: true, canDodge: false });
  const artsHit = (source, target) => lost(target, () => arts.battle.dealDamage(source, target, { amount: 1000, type: 'arts', canDodge: false }));
  close(artsHit(caster, marked) / artsHit(caster, clean), 1.1, '术式 arts damage +10% on a marked enemy');
  close(artsHit(other, marked) / artsHit(other, clean), 1, 'other arts damage gains nothing below eight');
  assert.equal(arts.battle.errorCount, 0);

  const eight = arena([...ops('蜜蜡', '九色鹿', '惊蛰', '灵知', '巫恋', '异客', '圣聆初雪'), op('格拉尼'), op('耶拉')], { extraPacts: { 格拉尼: ['arts'] } });
  const member = eight.unit('灵知'), outsider = eight.unit('耶拉'), low = eight.enemy([10, 9]), control = eight.enemy([11, 9]);
  eight.battle.dealDamage(member, low, { amount: 1, type: 'arts', isSkill: true, canDodge: false });
  low.hp = low.s.maxHp * 0.4; control.hp = control.s.maxHp * 0.4;
  const ratio = lost(low, () => eight.battle.dealDamage(outsider, low, { amount: 1000, type: 'arts', canDodge: false })) / lost(control, () => eight.battle.dealDamage(outsider, control, { amount: 1000, type: 'arts', canDodge: false }));
  close(ratio, 1.7, 'at eight every ally gains +35%, doubled below half health');
  assert.equal(eight.battle.errorCount, 0);
});

test('坚阵 blocks one more enemy, exposes what it blocks and answers its attacks at six', () => {
  const two = arena(ops('角峰', '香草'), { idle: true });
  const guard = two.unit('角峰'), held = two.enemy([guard.tileR, guard.tileC]), loose = two.enemy(two.far());
  held.blockedBy = guard;
  two.advance(0.3);
  close(held.s.dmgTakenMul, 1.15, 'a blocked enemy takes +15%', 1e-3);
  assert.equal(loose.s.dmgTakenMul, 1, 'an enemy it does not block is untouched');

  const six = arena(ops('角峰', '香草', '雷蛇', '贾维', '瑕光', '塞雷娅'), { idle: true });
  const wall = six.unit('角峰');
  assert.equal(wall.s.blockCnt, guard.s.blockCnt + 1, 'block count +1 from four');
  const attacker = six.enemy([wall.tileR, wall.tileC]);
  attacker.blockedBy = wall;
  six.battle.dealDamage(attacker, wall, { amount: 10, type: 'phys', isAttack: true });
  assert.ok(attacker.hp < attacker.s.maxHp, 'the blocked attacker is struck back');
  six.battle.dealDamage(attacker, wall, { amount: 10, type: 'phys', isAttack: true });
  assert.equal(six.tier('sentinel').counters, 1, 'at most once per second');
  assert.equal(six.battle.errorCount, 0);
});

test('重装 attacks add a share of max HP, slow what they block from four and stun every four seconds at six', () => {
  const two = arena(ops('艾丝黛尔', '格拉尼'), { idle: true });
  const estelle = two.unit('艾丝黛尔'), dummy = two.enemy([10, 9], { hp: 1000000 });
  const before = dummy.hp;
  two.battle.dealDamage(estelle, dummy, { amount: 1, type: 'phys', isAttack: true });
  assert.ok(before - dummy.hp >= estelle.s.maxHp * 0.03 - 1e-6, 'an attack adds 3% of max HP as physical damage');
  assert.equal(two.tier('bruiser').strikes, 1);

  const six = arena(ops('艾丝黛尔', '幽灵鲨', '休谟斯', '泥岩', '百炼嘉维尔', '格拉尼'), { idle: true });
  const heavy = six.unit('泥岩'), held = six.enemy([heavy.tileR, heavy.tileC], { hp: 1000000 });
  held.blockedBy = heavy;
  six.advance(0.3);
  close(buffOf(held, 'heavy-held').mods.aspd, -30, 'a blocked enemy attacks slower');
  six.battle.removeStatus(held, 'stun');
  heavy.mem.strongholdHeavyStunAt = -Infinity;
  const stuns = six.tier('bruiser').stuns ?? 0;
  six.battle.dealDamage(heavy, held, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(held.s.flags.stun, true, 'the next attack stuns');
  six.battle.removeStatus(held, 'stun');
  six.battle.dealDamage(heavy, held, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(six.tier('bruiser').stuns - stuns, 1, 'once every four seconds per member');
  assert.ok(!held.s.flags.stun);
  assert.equal(six.battle.errorCount, 0);
});

test('守望 slows and exposes the enemies in its members attack range', () => {
  const four = arena(ops('泡泡', '砾', '斯卡蒂', '歌蕾蒂娅'), { idle: true });
  const bubble = four.unit('泡泡'), near = four.enemy(inRangeTile(four, bubble)), far = four.enemy(four.far());
  four.advance(0.3);
  const slowed = (enemy) => enemy.buffs.find((buff) => buff.status === 'slow');
  close(slowed(near)?.mods?.moveMul, 0.75, 'move speed -25%', 1e-3);
  close(near.s.dmgTakenMul, 1.1, 'damage taken +10%', 1e-3);
  assert.ok(!slowed(far) && far.s.dmgTakenMul === 1, 'out of range nothing happens');
  assert.equal(four.battle.errorCount, 0);
});

test('双形 front form slows what it hits instead of taking less damage, the back form hits harder', () => {
  const four = arena([...ops('角峰', '香草', '雷蛇', '贾维'), ...ops('银灰', '夕', '缪尔赛思', '梅尔')], { idle: true });
  const members = ['银灰', '夕', '缪尔赛思', '梅尔'].map(four.unit);
  const front = members.filter((unit) => unit.mem.prototypeFormSwap === 'frontline'), back = members.filter((unit) => unit.mem.prototypeFormSwap === 'backline');
  assert.ok(front.length && back.length, 'both forms on the field');
  for (const unit of front) assert.ok(!unit.buffs.some((buff) => buff.key.includes('form-swap-frontline')), `${unit.name}: no damage reduction`);
  const foe = four.enemy([10, 9], { hp: 1000000 });
  four.battle.dealDamage(front[0], foe, { amount: 1, type: 'phys', isAttack: true });
  close(foe.buffs.find((buff) => buff.status === 'slow')?.mods?.moveMul, 0.55, 'front form attack: move speed -45%', 1e-3);
  for (const unit of back) close(unit.s.dmgDealtMul, 1.25, `${unit.name}: damage +25%`, 1e-3);
  assert.equal(four.battle.errorCount, 0);
});

test('决斗 adds true damage and attacks faster below half health, without lifesteal or an emergency heal', () => {
  const two = arena(ops('斯卡蒂', '布洛卡'), { idle: true });
  const brawler = two.unit('布洛卡'), foe = two.enemy([10, 9], { hp: 1000000 });
  brawler.hp = brawler.s.maxHp * 0.6;
  const hp = brawler.hp;
  two.battle.dealDamage(brawler, foe, { amount: 1000, type: 'phys', isAttack: true });
  assert.equal(brawler.hp, hp, 'no lifesteal');
  two.advance(0.3);
  assert.ok(!buffOf(brawler, 'pit-fury'), 'no speed above half health');
  trueHit(two.battle, foe, brawler, brawler.hp - brawler.s.maxHp * 0.4);
  const low = brawler.hp;
  two.advance(2.5);
  assert.ok(brawler.hp <= low + brawler.s.maxHp * 0.02, 'no emergency heal');
  close(buffOf(brawler, 'pit-fury').mods.aspd, 20, 'attack speed +20 below half health');
  assert.equal(two.battle.errorCount, 0);
});

test('突袭 keeps SP and moves next to the nearest ground enemy after idling', () => {
  const two = arena(ops('仇白', '拉普兰德'));
  const raider = two.unit('仇白');
  const deploy = [...getResonanceField({ seed: 21, difficulty: 'NORMAL', round: 2, roundLimit: 28, rulesVersion: 3, pieces: [] }, { data, catalog }).deployMap.keys()]
    .map((key) => key.split(',').map(Number)).sort((a, b) => b[1] - a[1])[0];
  const target = two.enemy(deploy);
  assert.ok(!raider.rangeKeySet.has(deploy[0] * 21 + deploy[1]), 'the target starts out of range');
  const from = [raider.tileR, raider.tileC];
  two.advance(7.5);
  assert.deepEqual([raider.tileR, raider.tileC], from, 'no move before 8 idle seconds');
  const sp = raider.skill.sp;
  two.advance(1);
  assert.notDeepEqual([raider.tileR, raider.tileC], from, 'moved after 8 idle seconds');
  assert.ok(two.battle.enemiesInKeys(raider.rangeKeys, raider, raider.profile).includes(target), 'the target is now in range');
  assert.ok(raider.skill.sp >= sp, 'SP is kept');
  assert.ok(raider.buffs.some((buff) => buff.key.startsWith('stronghold:raid-jump') && Math.abs(buff.mods.atkPct - 0.15) < 1e-9));
  assert.ok(two.tier('redeploy').relocations >= 1);
  assert.equal(two.battle.errorCount, 0);
});

test('领军 号角 gives every ally a fixed DEF +8% and RES +8 in season 2 while season 1 keeps the win-count rating', () => {
  assert.match(catalog.pacts.emissary.levels[0].description, /号角：全体友军防御力\+8%，法术抗性\+8；/);
  const names = ['号角', '格拉尼', '凯瑟琳'];
  const one = arena(ops(...names));
  assert.equal(one.tier('emissary')?.ambessaAllies, 3, 'exactly one 领军 member activates the effect');
  for (const name of names) {
    const unit = one.unit(name), buff = unit.buffs.find((row) => row.key.startsWith('resonance:v3:emissary-ambessa'));
    assert.ok(buff, `${name} gets the 号角 share`);
    close(buff.mods.defPct, 0.08, `${name} DEF +8%`);
    close(buff.mods.resFlat, 8, `${name} RES +8`);
    assert.ok(unit.s.res >= unit.base.res + 8 - 1e-9, `${name} RES reaches the battle stats`);
    assert.equal(unit.mem.prototypeRatingBonuses?.['emissary-ambessa'], undefined, 'no win-count rating in season 2');
  }
  assert.equal(one.battle.errorCount, 0);
  const wins = [1, 2, 3].map(() => ({ type: 'fight-settled', won: true }));
  const first = arena(ops(...names), { cat: firstCatalog, history: wins });
  for (const name of names) {
    const unit = first.unit(name);
    assert.ok(unit.mem.prototypeRatingBonuses?.['emissary-ambessa'], `${name} keeps the season-1 win-count rating`);
    assert.ok(!unit.buffs.some((row) => row.key.startsWith('resonance:v3:emissary-ambessa')));
  }
  assert.equal(first.battle.errorCount, 0);
});

test('维多利亚 copy names the carried component and completed item counts on every tier', () => {
  for (const level of catalog.pacts.resistance.levels) assert.match(level.description, /^每携带1件组件，攻击力\+\d+%；每携带1件合成装备，攻击力\+\d+%。/);
});

test('技力协同 refunds SP when a member skill ends', () => {
  const two = arena(ops('刺玫', '哈洛德'));
  const member = two.unit('刺玫');
  member.skill.activate('test', { free: true });
  two.battle.rng = () => 0;
  const before = member.skill.sp;
  member.skill.end('test');
  close(member.skill.sp - before, 8, '+8 SP on a refund');
  two.battle.rng = () => 0.99;
  member.skill.activate('test', { free: true });
  const second = member.skill.sp;
  member.skill.end('test');
  assert.equal(member.skill.sp, second, 'no refund when the roll fails');
  assert.equal(two.battle.errorCount, 0);
});
