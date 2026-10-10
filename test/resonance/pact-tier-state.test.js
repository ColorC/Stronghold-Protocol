import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { levelExactCounts, nativeStripTier, pactCurrentTier, pactTierStatus, pactTierStatusLabel, tierIsExact } from '../../public/js/resonance/pactTierState.js';
import { pactTierSummary } from '../../public/js/resonance/pactTierSummary.js';

const sourceTrait = id => prototypeSeason.traits.find(trait => trait.id === id);

test('Set 13 Emissary closed source bounds derive exact counts and never fall back to the one-member tier', () => {
  const levels = sourceTrait('emissary').effects;
  assert.deepEqual(levels.map(levelExactCounts), [[1], [4]]);
  assert.deepEqual([1, 2, 3, 4, 5].map(count => pactTierStatus(levels[0], count)),
    ['reached', 'inactive', 'inactive', 'inactive', 'inactive']);
  assert.deepEqual([1, 2, 3, 4, 5].map(count => pactTierStatus(levels[1], count)),
    ['inactive', 'inactive', 'inactive', 'reached', 'inactive']);
  assert.equal(pactTierStatusLabel(levels[0], 3), '未激活：需恰好1人');
  assert.equal(pactTierStatusLabel(levels[1], 5), '未激活：需恰好4人');
  assert.equal(pactCurrentTier(levels, 1, 1), levels[0]);
  assert.equal(pactCurrentTier(levels, 4, 4), levels[1]);
  assert.equal(pactCurrentTier(levels, 3, 0), null);
  assert.equal(pactCurrentTier(levels, 5, 0), null);
  assert.deepEqual(nativeStripTier({ count: 1, activeThreshold: 1 }, levels), { active: true, tier: 1 });
  assert.deepEqual(nativeStripTier({ count: 4, activeThreshold: 4 }, levels), { active: true, tier: 2 });
  assert.deepEqual(nativeStripTier({ count: 3, activeThreshold: 0 }, levels), { active: false, tier: 0 });
  assert.deepEqual(nativeStripTier({ count: 5, activeThreshold: 0 }, levels), { active: false, tier: 0 });
});

test('ordinary source ranges remain threshold tiers, not exact tiers', () => {
  const levels = sourceTrait('creation').effects;
  assert.deepEqual(levels.slice(0, 2).map(levelExactCounts), [null, null]);
  assert.equal(levels.slice(0, 2).some(tierIsExact), false);
  assert.equal(pactTierStatus(levels[0], 4), 'reached', '2–3 tier stays achieved at count 4');
  assert.equal(pactTierStatus(levels[1], 4), 'reached');
  assert.equal(pactCurrentTier(levels, 4, 4), levels[1]);
  assert.equal(pactCurrentTier(levels, 4, 0), levels[1]);
  assert.equal(pactCurrentTier(levels, 1, 0), null);
  assert.equal(levelExactCounts({ minUnits: 2, maxUnits: 3, exactCounts: [] }), null);
  assert.deepEqual(levelExactCounts({ minUnits: 4, maxUnits: 4, exactCounts: [] }), [4]);
});

test('tier summaries use the consumed stat unit and source item terminology', () => {
  for (const value of [0.25, 0.45, 0.65]) {
    const summary = pactTierSummary('dominator', { APPercent: value, ShieldAmount: 350, ShieldDuration: 15 });
    assert.ok(summary.includes(`每消耗1点技力，术法伤害+${Number(value.toFixed(2))}%`), summary);
    assert.ok(!summary.includes('法强'), summary);
  }
  const arts = pactTierSummary('arts', { BaseAP: 20, TeamAP: 10 });
  assert.ok(arts.includes('术式成员术法伤害+20%'), arts);
  assert.ok(arts.includes('其他友军术法伤害+10%'), arts);
  assert.ok(!arts.includes('2000%'), arts);
  const risk = pactTierSummary('risk', { ShimmerPerCombat: 15, ShimmerPerCombatStreaking: 30 });
  assert.ok(risk.includes('每场获得15微光'), risk);
  assert.ok(risk.includes('连败获得30微光'), risk);
  assert.ok(!risk.includes('辉光'), risk);
  const emissaryVars = sourceTrait('emissary').effects[0].variables;
  assert.ok(!pactTierSummary('emissary', emissaryVars, sourceTrait('emissary').effects[0]).includes('领军成员生命+'),
    'one-member copy must not claim the four-member-only bonus');
  assert.ok(pactTierSummary('emissary', emissaryVars, sourceTrait('emissary').effects[1]).includes('领军成员生命+200'));
});
