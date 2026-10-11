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

const data = loadData(process.env.SP_DATA_DIR ?? 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native', { log: { warn() {}, error() {} } });
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: factionSeasonV2.id, seed: 21 });
const firstCatalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: factionSeason.id, seed: 21 });
const active = new Set(catalog.config.activeOperatorIds);
const op = (name) => { const row = Object.values(catalog.operators).find((entry) => active.has(entry.id) && entry.name === name); assert.ok(row, name); return row; };
const ops = (...names) => names.map(op);
const close = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
const SOURCE_TERMS = ['微光', '黑市', '征服', '战利品', '实验格', '实验室', '晶体', '信号', '冲刺', 'Sion', '赞助', '卫灵', '全能吸血', '法术强度', '护甲', '魔抗', '法力', '暴击', '护盾', '火箭', '每叠加', '层数'];

/** A real Native Battle (preview: no scheduled waves) with the given operators on legal tiles. */
function arena(operators, { star = 1, equipment = {}, extraPacts = {}, seed = 21 } = {}) {
  const base = { seed, difficulty: 'NORMAL', round: 2, roundLimit: 28, rulesVersion: 3, pieces: [] };
  const field = getResonanceField(base, { data, catalog });
  const tiles = [...field.deployMap].map(([key]) => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.ok(tiles.length >= operators.length, 'enough legal tiles');
  const pieces = operators.map((row, index) => ({ uid: `p${index}`, operatorId: row.id, star, row: tiles[index][0], col: tiles[index][1], dir: 'RIGHT',
    equipment: (equipment[row.name] ?? []).map((itemId, item) => ({ uid: `i${index}-${item}`, itemId })), extraPacts: [...(extraPacts[row.name] ?? [])] }));
  const state = { ...base, pieces };
  const { battle } = buildResonanceBattle(state, { data, catalog, recording: false, preview: true });
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
  assert.equal(STRONGHOLD_PACT_IDS.length, 15);
  assert.equal(firstCatalog.pacts.academy.levels[0].effects[0].params.mechanic, 'shared_item_training', 'season 1 keeps its own pacts');
  assert.equal(catalog.pacts.academy.levels[0].effects[0].params.mechanic, 'wanted_ammo');
  assert.equal(catalog.pacts.bruiser.levels.at(-1).effects[0].params.variables.BonusPercentHealth, 0.4, 'kept pacts take the season-2 value corrections');
  assert.equal(firstCatalog.pacts.bruiser.levels.at(-1).effects[0].params.variables.BonusPercentHealth, factionSeason.traits.find((row) => row.id === 'bruiser').effects.at(-1).variables.BonusPercentHealth);
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

test('拉特兰 marks the 蕾缪安 通缉 state, prefers elites, adds damage, bullets, duration and SP on a wanted knock-out', () => {
  const three = arena([...ops('送葬人', '见行者', '空弦'), op('角峰')]);
  const { battle } = three;
  const first = three.enemy([10, 9]);
  assert.ok(first.mem.strongholdWanted && first.buffs.some((buff) => buff.key === 'lemuen:wanted'), 'the first arrival is wanted at once');
  const elite = three.enemy([11, 9], { hp: 20000, rank: 'ELITE' }), heavy = three.enemy([12, 9], { hp: 90000 });
  assert.ok(!elite.mem.strongholdWanted && !heavy.mem.strongholdWanted, 'only one wanted at three members');
  trueHit(battle, three.unit('送葬人'), first, first.hp + 10);
  three.advance(15.1);
  assert.equal(elite.mem.strongholdWanted, true, 'the next mark prefers the elite over a healthier normal enemy');
  assert.ok(!heavy.mem.strongholdWanted);
  const member = three.unit('空弦'), other = three.unit('角峰');
  const bonus = lost(elite, () => trueHit(battle, member, elite)) / lost(heavy, () => trueHit(battle, member, heavy));
  close(bonus, 1.2, 'wanted damage +20%');
  close(lost(elite, () => trueHit(battle, other, elite)), lost(heavy, () => trueHit(battle, other, heavy)), 'non-members gain nothing');
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

  const four = arena(ops('角峰', '耶拉', '银灰', '灵知'));
  const a = four.enemy(four.far()), b = four.enemy([four.battle.rect.r0 + 1, four.battle.rect.c1]);
  four.advance(20.1);
  assert.ok(a.s.flags.cold && b.s.flags.cold, 'the cold wind chills the whole field');
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

  const five = arena(ops('九色鹿', '惊蛰', '仇白', '夕', '令'));
  const near = five.enemy([10, 8]);
  five.advance(15.2);
  assert.ok(five.tier('sui').flames >= 1, '祛恶之焰 fires every 15 seconds');
  assert.ok(near.buffs.some((buff) => buff.status === 'elemFragile') || !near.alive, 'flamed enemies take 元素脆弱');
  assert.equal(five.battle.errorCount, 0);

  const seven = arena([...ops('九色鹿', '惊蛰', '仇白', '夕', '令'), ...ops('格拉尼', '角峰')], { extraPacts: { 格拉尼: ['sui'], 角峰: ['sui'] } });
  const pair = seven.battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.mem.strongholdGuardian);
  assert.equal(pair.length, 2, 'seven 炎 members summon two');
  for (const unit of pair) close(unit.s.dmgTakenMul, 0.5, 'damage taken -50%');
  assert.equal(seven.battle.errorCount, 0);
});

test('深海猎人 revives each member once at half health and hunts wounded enemies', () => {
  const three = arena(ops('斯卡蒂', '幽灵鲨', '歌蕾蒂娅'));
  const skadi = three.unit('斯卡蒂'), foe = three.enemy([10, 9]);
  close(skadi.s.hpRegen >= skadi.s.maxHp * 0.01 ? 1 : 0, 1, '1% max HP per second regeneration');
  trueHit(three.battle, foe, skadi, skadi.hp + skadi.s.maxHp);
  assert.equal(skadi.alive, true, 'the first knock-out is prevented');
  close(skadi.hp, skadi.s.maxHp * 0.5, 'and the member stands at 50% health', 1e-3);
  trueHit(three.battle, foe, skadi, skadi.hp + skadi.s.maxHp);
  assert.equal(skadi.alive, false, 'only once per battle');
  assert.equal(three.tier('flight').revives, 1);
  assert.equal(three.battle.errorCount, 0);

  const two = arena(ops('斯卡蒂', '幽灵鲨'));
  const shark = two.unit('幽灵鲨');
  trueHit(two.battle, two.enemy([10, 9]), shark, shark.hp + shark.s.maxHp);
  assert.equal(shark.alive, false, 'no revive below three members');

  const four = arena([...ops('斯卡蒂', '幽灵鲨', '歌蕾蒂娅'), op('格拉尼')], { extraPacts: { 格拉尼: ['flight'] } });
  const hunter = four.unit('歌蕾蒂娅'), weak = four.enemy([10, 9]), sound = four.enemy([11, 9]);
  weak.hp = weak.s.maxHp * 0.4; sound.hp = sound.s.maxHp * 0.6;
  close(lost(weak, () => trueHit(four.battle, hunter, weak)) / lost(sound, () => trueHit(four.battle, hunter, sound)), 1.3, '+30% below half health');
  hunter.hp = hunter.s.maxHp * 0.5;
  const healed = -lost(hunter, () => trueHit(four.battle, hunter, weak, weak.hp + 10));
  assert.ok(healed >= hunter.s.maxHp * 0.08 - 1e-6, 'a knock-out heals 8% max HP');
  assert.equal(four.battle.errorCount, 0);
});

test('维多利亚 scales ATK by carried items and lends the temporary hammer to members with a free slot', () => {
  const completed = Object.values(catalog.equipment).find((item) => item.kind === 'completed' && item.grantAllowed !== false && !item.unique).id;
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

test('叙拉古 opens fast, hides in 隐匿, ambushes once and fears from the shadows', () => {
  const four = arena(ops('红云', '贾维', '布洛卡', '巫恋'));
  const brocca = four.unit('布洛卡'), shooter = four.enemy([10, 9], { range: 3 });
  assert.equal(brocca.s.flags.stealth, true, 'members start in 隐匿');
  assert.equal(canTargetAlly(shooter, brocca, true), false, 'a ranged enemy cannot target a hidden member');
  assert.ok(brocca.buffs.some((buff) => buff.key.startsWith('stronghold:siracusa-opening') && buff.timeLeft <= 20));
  four.advance(6.1);
  assert.ok(!brocca.s.flags.stealth, '隐匿 ends after 6 seconds');
  assert.equal(canTargetAlly(shooter, brocca, true), true);
  four.battle.rng = () => 0.99;
  const control = four.enemy([11, 9]);
  const ambush = lost(shooter, () => trueHit(four.battle, brocca, shooter, 1000, { isAttack: true }));
  const plain = lost(control, () => trueHit(four.battle, brocca, control, 1000, { isAttack: true }));
  close(ambush / plain, 1.5, 'the first attack after 隐匿 deals +50%');
  assert.equal(four.tier('risk').ambushes, 1);
  assert.equal(four.battle.errorCount, 0);

  const six = arena(ops('红云', '贾维', '布洛卡', '巫恋', '拉普兰德', '荒芜拉普兰德'));
  const member = six.unit('拉普兰德'), feared = six.enemy([10, 9]), calm = six.enemy([11, 9]);
  six.battle.rng = () => 0;
  six.battle.dealDamage(member, feared, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(feared.s.flags.fear, true, 'an attack in the 隐匿 window fears');
  six.battle.rng = () => 0.99;
  close(lost(feared, () => trueHit(six.battle, member, feared)) / lost(calm, () => trueHit(six.battle, member, calm)), 1.3, '+30% against a feared enemy');
  assert.equal(six.battle.errorCount, 0);
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

test('哥伦比亚 barriers burst and stun when broken and come back at six', () => {
  const two = arena(ops('香草', '雷蛇'));
  const vanilla = two.unit('香草');
  const barrier = vanilla.buffs.find((buff) => buff.key.startsWith('stronghold:columbia-barrier'));
  close(barrier.shield, vanilla.s.maxHp * 0.12, 'barrier 12% max HP');

  const six = arena(ops('香草', '罗比菈塔', '雷蛇', '梅尔', '塞雷娅', '多萝西'));
  const holder = six.unit('香草');
  const neighbour = six.enemy([holder.tileR, holder.tileC + 1]);
  const shield = holder.buffs.find((buff) => buff.key.startsWith('stronghold:columbia-barrier')).shield;
  trueHit(six.battle, neighbour, holder, shield + 10);
  six.advance(0.1);
  assert.equal(six.tier('rhodes').barriersBroken, 1);
  assert.ok(neighbour.hp < neighbour.s.maxHp, 'the break bursts');
  assert.ok(neighbour.buffs.some((buff) => buff.status === 'stun'), 'and stuns');
  assert.ok(!holder.buffs.some((buff) => buff.key.startsWith('stronghold:columbia-barrier')));
  six.advance(12.1);
  assert.ok(holder.buffs.some((buff) => buff.key.startsWith('stronghold:columbia-barrier') && buff.shield > 0), 'the barrier returns 12 s later');
  assert.equal(six.battle.errorCount, 0);
});

test('罗德岛 boosts healing taken, heals on skill start, turns overflow into barrier and refunds SP on a fall in range', () => {
  const two = arena(ops('调香师', '休谟斯'));
  close(two.unit('调香师').s.healingTakenMul, 1.15, 'healing taken +15%');

  const eight = arena([...ops('调香师', '休谟斯', '华法琳', '寒芒克洛丝', '百炼嘉维尔', '泥岩', '魔王'), op('格拉尼')], { extraPacts: { 格拉尼: ['enforcer'] } });
  const perfumer = eight.unit('调香师');
  perfumer.hp = perfumer.s.maxHp * 0.3;
  for (const unit of eight.battle.allyUnits) if (unit !== perfumer && unit.alive && Math.max(Math.abs(unit.tileR - perfumer.tileR), Math.abs(unit.tileC - perfumer.tileC)) <= 1) unit.hp = unit.s.maxHp;
  const before = perfumer.hp;
  perfumer.skill.activate('test', { free: true });
  assert.ok(perfumer.hp - before >= perfumer.s.maxHp * 0.12 - 1e-6, 'skill start heals the lowest nearby ally 12%');
  const full = eight.unit('百炼嘉维尔');
  full.hp = full.s.maxHp;
  eight.battle.heal(perfumer, full, 1000);
  const overflow = full.buffs.find((buff) => buff.key.startsWith('stronghold:rhodes-island-barrier'));
  close(overflow.shield, Math.min(full.s.maxHp * 0.15, 1000 * full.s.healingTakenMul), 'overflow becomes barrier');
  const medic = eight.unit('华法琳'), key = medic.rangeKeys.find((row) => row !== medic.tileR * 21 + medic.tileC && eight.battle.grid.inRect(Math.floor(row / 21), row % 21));
  medic.skill.sp = 0; medic.skill.charges = 0;
  const victim = eight.enemy([Math.floor(key / 21), key % 21], { hp: 10 });
  trueHit(eight.battle, full, victim, 100);
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

test('坚阵 bears a share of a neighbour\'s damage and strikes back at six', () => {
  const six = arena([...ops('角峰', '香草', '雷蛇', '贾维', '瑕光', '塞雷娅'), op('斯卡蒂')]);
  const guard = six.unit('角峰'), ward = six.unit('斯卡蒂');
  const tile = [[guard.tileR, guard.tileC + 1], [guard.tileR + 1, guard.tileC], [guard.tileR - 1, guard.tileC], [guard.tileR, guard.tileC - 1]].find(([r, c]) => six.battle.grid.inRect(r, c) && !six.battle.isReservedTile(r, c));
  assert.ok(tile && six.battle.relocate(ward, tile[0], tile[1]), 'the ward stands next to the guard');
  for (const unit of six.battle.allyUnits) if (unit.alive) unit.hp = unit.s.maxHp;
  const attacker = six.enemy([10, 9]);
  const guardHp = guard.hp, wardHp = ward.hp;
  six.battle.dealDamage(attacker, ward, { amount: 1000, type: 'true', canDodge: false });
  const wardLoss = wardHp - ward.hp, guardLoss = guardHp - guard.hp;
  close(guardLoss / (wardLoss + guardLoss), 0.35, 'the guard bears 35%', 2e-2);
  assert.ok(attacker.hp < attacker.s.maxHp && attacker.buffs.some((buff) => buff.status === 'fragile'), 'and strikes the attacker with 脆弱');
  assert.equal(six.battle.errorCount, 0);
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
