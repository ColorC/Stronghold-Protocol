import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const INPUT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft-set13-14.23.json';
const data = JSON.parse(readFileSync(INPUT, 'utf8'));

test('Set 13 reference is pinned to 14.23 and has the complete natural roster only', () => {
  assert.equal(data.provenance.setNumber, 13);
  assert.equal(data.provenance.releasePatch, '14.23');
  assert.match(data.provenance.sourceUrl, /raw\.communitydragon\.org\/14\.23\/cdragon\/tft\/en_us\.json$/);
  assert.equal(data.summary.naturalChampionCount, 60);
  assert.deepEqual(data.summary.naturalChampionFeeDistribution, { 1: 14, 2: 13, 3: 13, 4: 12, 5: 8 });
  assert.equal(new Set(data.naturalChampions.map(unit => unit.apiName)).size, 60);
  assert.ok(data.naturalChampions.every(unit => /^TFT13_/.test(unit.apiName) && unit.cost >= 1 && unit.cost <= 5 && unit.traits.length > 0));
  assert.ok(data.naturalChampions.every(unit => unit.stats && unit.ability?.name && typeof unit.ability.desc === 'string'));
});

test('natural trait memberships and exact tier effects join to the 60 heroes', () => {
  assert.equal(data.summary.naturalTraitCount, 26);
  assert.equal(data.summary.teamUpTraitCount, 7);
  assert.equal(data.naturalTraits.length, 26);
  const byApiName = new Map(data.naturalChampions.map(unit => [unit.apiName, unit]));
  for (const trait of data.naturalTraits) {
    const members = data.naturalChampions.filter(unit => unit.traits.includes(trait.name));
    assert.deepEqual(trait.naturalMemberApiNames, members.map(unit => unit.apiName));
    assert.equal(trait.memberCount, members.length);
    assert.deepEqual(trait.feeDistribution, Object.fromEntries([1, 2, 3, 4, 5].map(cost => [cost, members.filter(unit => unit.cost === cost).length])));
    assert.ok(trait.effects.length > 0 && trait.effects.every(effect => Number.isInteger(effect.minUnits) && effect.variables && typeof effect.variables === 'object'));
    for (const id of trait.naturalMemberApiNames) assert.ok(byApiName.get(id).traits.includes(trait.name));
  }
  const tier = name => data.naturalTraits.find(trait => trait.name === name).effects.map(effect => effect.minUnits);
  assert.deepEqual(tier('Chem-Baron'), [3, 4, 5, 6, 7]);
  assert.deepEqual(tier('Enforcer'), [2, 4, 6, 8, 10]);
  assert.deepEqual(tier('Emissary'), [1, 4]);
  assert.equal(data.naturalTraits.find(trait => trait.name === 'Emissary').desc.includes('exactly 1 or 4 unique'), true);
});

test('equipment and augments are filtered by Set 13 membership references', () => {
  assert.equal(data.summary.equipmentCandidateCount, 284);
  assert.equal(data.summary.augmentCandidateCount, 308);
  assert.equal(data.equipmentCandidates.length, 284);
  assert.equal(data.augmentCandidates.length, 308);
  for (const rows of [data.equipmentCandidates, data.augmentCandidates]) {
    assert.equal(new Set(rows.map(row => row.apiName)).size, rows.length);
    assert.ok(rows.every(row => row.apiName && (row.desc === null || typeof row.desc === 'string') && row.effects && typeof row.effects === 'object'));
  }
  assert.deepEqual(data.equipmentCandidates.filter(row => !row.name || !row.desc).map(row => [row.apiName, ['name', 'desc'].filter(key => !row[key])]), [
    ['TFT13_Item_Crime_ArmoryCashout', ['desc']],
    ['TFT13_Item_Crime_ArmoryContinue', ['desc']],
    ['TFT6_Augment_Underdogs', ['name', 'desc']],
    ['TFT7_Item_TreasureDragonBlankSlot', ['name', 'desc']],
    ['TFT_Item_Blank', ['name', 'desc']],
    ['TFT_Item_BlankSlot', ['name']],
    ['TFT_Item_EmptyBag', ['name']],
    ['TFT_Item_ThiefsGloves_Empty', ['name']],
  ]);
  assert.deepEqual(data.augmentCandidates.filter(row => !row.name || !row.desc), []);
  assert.ok(data.augmentCandidates.some(row => row.apiName.startsWith('TFT13_Augment_')));
  assert.ok(data.equipmentCandidates.some(row => row.apiName.startsWith('TFT13_')));
  assert.match(data.schema.equipmentCandidates, /setData\[number=13\]\.items/);
  assert.match(data.schema.augmentCandidates, /setData\[number=13\]\.augments/);
});
