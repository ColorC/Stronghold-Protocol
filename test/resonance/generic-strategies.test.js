import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { createSession, applyAction, drawStrategies } from '../../server/modes/resonance/session.js';
import { buildResonanceBattle, getResonanceField } from '../../server/modes/resonance/battle.js';
import { factionSeason } from '../../shared/resonance/faction-season.js';
import { factionSeasonV2 } from '../../shared/resonance/faction-season-v2.js';
import { GENERIC_STRATEGIES } from '../../shared/resonance/generic-strategies.js';

const data = loadData(process.env.SP_DATA_DIR, { log: { warn() {}, error() {} } });
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 7, seasonId: factionSeasonV2.id });
const firstCatalog = getResonanceCatalog(data, { rulesVersion: 3, seed: 7, seasonId: factionSeason.id });
const fieldResolver = (state) => getResonanceField(state, { data, catalog });
const genericIds = Object.keys(catalog.strategies).filter((id) => id.startsWith('prototype_generic_'));
const grantsEmblem = (cat, id) => (cat.strategies[id]?.effects ?? []).some((effect) => effect.kind === 'choose_transfer');
const SOURCE_TERMS = ['护盾', '火箭', '法术强度', '护甲', '魔抗', '法力', '暴击', '评分', '双抗', '海克斯', '强化符文', '羁绊'];

/** A fresh season-2 session with one strategy offered and chosen; pending rewards are claimed with their first options. */
function choose(id, seed = 7) {
  let state = createSession({ seed, difficulty: 'NORMAL', catalog, fieldResolver }).state;
  state.pendingChoices.push({ uid: 'ctest', type: 'strategy', source: 'test', options: [id], remaining: 1 });
  state.phase = 'choice';
  const before = structuredClone(state);
  const chosen = applyAction(state, { type: 'chooseStrategy', choiceUid: 'ctest', strategyId: id }, { catalog, fieldResolver });
  assert.ok(chosen.ok, `${id}: ${chosen.error}`);
  return { before, state: chosen.state };
}
const byName = (name) => Object.values(catalog.operators).find((op) => op.name === name && catalog.config.activeOperatorIds.includes(op.id));

test('season 2 adds 26 generic strategies from the season source table, handwritten in in-game words', () => {
  assert.equal(GENERIC_STRATEGIES.length, 26);
  assert.equal(genericIds.length, 26);
  const itemNames = new Set([...Object.values(catalog.equipment).map((item) => item.name), ...Object.values(catalog.prototypeEconomy.gearConsumables).map((item) => item.name)]);
  for (const id of genericIds) {
    const strategy = catalog.strategies[id];
    assert.ok(factionSeasonV2.strategyCandidates.some((row) => row.apiName === strategy.source.recordId), `${strategy.name} comes from the season table`);
    for (const term of SOURCE_TERMS) assert.ok(!strategy.name.includes(term) && !strategy.description.includes(term), `${strategy.name}: ${term}`);
    for (const [, quoted] of strategy.description.matchAll(/“([^”]+)”/g)) assert.ok(itemNames.has(quoted), `${strategy.name} names a real item: ${quoted}`);
  }
  assert.ok(!Object.keys(firstCatalog.strategies).some((id) => id.startsWith('prototype_generic_')), 'season 1 keeps its pool');
  const pool = catalog.prototypeStrategyPool;
  assert.equal(pool.playableOtherCount, 44);
  assert.ok(Math.abs(pool.sourceEmblemRatio - 41 / 306) < 1e-9);
});

test('a season-2 offer holds at most one 徽记 or 王冠; season 1 is unchanged', () => {
  const offers = (cat) => {
    let most = 0;
    for (let index = 0; index < 600; index++) {
      const state = { strategies: [], pendingChoices: [], seed: 1000 + index * 7919, rngCounter: 0, round: 5, gold: 10, pieces: [], inventory: [], poolRemaining: {}, rulesVersion: 3 };
      for (let node = 0; node < 3; node++) {
        const options = drawStrategies(state, cat);
        most = Math.max(most, options.filter((id) => grantsEmblem(cat, id)).length);
        state.strategies.push({ id: options[0] });
      }
    }
    return most;
  };
  assert.equal(offers(catalog), 1);
  assert.ok(offers(firstCatalog) >= 2, 'season 1 can still show two');
});

test('season 2 has one pact-transfer supply node and a rarer 随身身份牌 in component offers', () => {
  assert.deepEqual(catalog.campaign.supply.transfers.map((entry) => entry.node), [18]);
  assert.deepEqual(firstCatalog.campaign.supply.transfers.map((entry) => entry.node), [12, 22, 26]);
  const box = genericIds.find((id) => catalog.strategies[id].name === '补给箱');
  let crest = 0, runs = 300;
  for (let seed = 1; seed <= runs; seed++) {
    const { state } = choose(box, seed);
    if (state.pendingChoices.find((choice) => choice.type === 'components').options.includes('crest')) crest++;
  }
  // four of eight components: uniform odds would show 随身身份牌 in half of the offers, a quarter weight in about one in six
  assert.ok(crest / runs < 0.3, `随身身份牌 in ${crest}/${runs} offers`);
  assert.ok(crest > 0, 'still possible');
});

test('generic economy and equipment strategies hand out exactly what they say', () => {
  const named = (name) => genericIds.find((id) => catalog.strategies[id].name === name);
  let run = choose(named('加急许可'));
  assert.equal((run.state.freeRefreshes ?? 0) - (run.before.freeRefreshes ?? 0), 10);
  run = choose(named('物资包'));
  assert.equal(run.state.gold - run.before.gold, 2);
  assert.deepEqual(run.state.consumables.map((row) => row.kind), ['prototype_reforger']);
  const parts = run.state.pendingChoices.find((choice) => choice.type === 'components');
  assert.equal(parts.options.length, 3); assert.equal(parts.remaining, 3);
  run = choose(named('协同招募'));
  const recruits = run.state.pendingChoices.filter((choice) => choice.type === 'operators');
  assert.equal(recruits.length, 2);
  assert.ok(recruits.every((choice) => catalog.operators[choice.options[0]].cost === 3));
  run = choose(named('战术指挥'));
  assert.ok(run.state.inventory.some((item) => item.itemId === 'blade'), '维式重锤');
});

test('generic team strategies reach the real Battle: 战术指挥 stats, 持续压制 waits for enemies, 遗志 on a fall', () => {
  const named = (name) => genericIds.find((id) => catalog.strategies[id].name === name);
  const tactics = named('战术指挥'), ramp = named('持续压制'), epitaph = named('遗志');
  const base = { seed: 7, difficulty: 'NORMAL', round: 2, roundLimit: 28, rulesVersion: 3, seasonId: factionSeasonV2.id, hp: 100, level: 4,
    strategies: [{ id: tactics }, { id: ramp }, { id: epitaph }], strategyState: { [tactics]: {}, [ramp]: {}, [epitaph]: {} } };
  const field = getResonanceField(base, { data, catalog });
  const tiles = [...field.deployMap.keys()].map((key) => key.split(',').map(Number));
  const pieces = ['送葬人', '空弦', '惊蛰'].map((name, index) => ({ uid: `g${index}`, operatorId: byName(name).id, star: 1, row: tiles[index][0], col: tiles[index][1], dir: 'RIGHT', equipment: [], extraPacts: [] }));
  const { battle } = buildResonanceBattle({ ...base, pieces }, { data, catalog, preview: true });
  battle.autoFinish = false;
  battle.start();
  const units = battle.allyUnits.filter((unit) => unit.kind === 'op');
  for (const unit of units) {
    const stats = unit.buffs.find((buff) => buff.key.includes(`${tactics}:stats`));
    assert.ok(stats && Math.abs(stats.mods.atkPct - 0.08) < 1e-9, `${unit.name} 攻击力+8%`);
  }
  const until = battle.time + 7;
  while (battle.time < until) battle.step();
  assert.ok(!units[0].buffs.some((buff) => buff.key.includes(`${ramp}:ramp`)), 'no ramp on an empty field');
  battle.spawnEnemy('enemy_1166_dusbr', { pos: [10, 9] });
  const later = battle.time + 6.5;
  while (battle.time < later) battle.step();
  const rampBuff = units[0].buffs.find((buff) => buff.key.includes(`${ramp}:ramp`));
  assert.ok(rampBuff && rampBuff.mods.aspd >= 3, 'ramp grows once an enemy is on the field');
  const [fallen, ...rest] = units;
  battle.dealDamage(null, fallen, { amount: fallen.hp * 10, type: 'true' });
  battle.step();
  assert.ok(rest.some((unit) => unit.buffs.some((buff) => buff.key.includes(`${epitaph}:shield`) && buff.shield > 0)), 'the nearest ally gains the 屏障');
  assert.equal(battle.errorCount, 0);
});
