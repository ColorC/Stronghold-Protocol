import test from 'node:test';
import assert from 'node:assert/strict';
import addon from '../../data/independent-darkmoon-game-text-addon.json' with { type: 'json' };
import blueprints from '../../data/independent-darkmoon-blueprints.json' with { type: 'json' };
import { darkmoonPrepRulesFor } from '../../server/modes/independent/darkmoonPrep.js';
import { darkmoonCombatMetadata } from '../../server/sim/content/independent/darkmoonCombat.js';
import { textsFor, toLevels } from '../../tools/independent-darkmoon-text-formatter.mjs';

const byId = new Map(blueprints.entries.map(entry => [entry.sourceId, entry]));
const byAddonId = new Map(Object.values(addon.operators).map(row => [row.sourceId, row]));
const visibleText = /undefined|NaN|\[object Object\]|\b(?:BGS|BOT|CFM|DAL|DS1|EX1|FP1|GVG|ICC|KAR|LOE|LOOT|NEW1|OG|TRL|ULD)_\d+|newSiracusaRecruit|selectedFriendly|allFriendlyDragonOperators|otherFriendly|randomOtherFriendly|originalBattlecryOutputs|battlecryMultiplier|原型|副属性装备/;

test('all 101 source entries regenerate both visible variants from executable preparation/combat rules', () => {
  assert.equal(blueprints.entries.length, 101);
  assert.equal(byAddonId.size, 101);
  for (const entry of blueprints.entries) {
    const row = byAddonId.get(entry.sourceId);
    assert.ok(row, `${entry.sourceId} must have addon text`);
    for (const variant of ['normal', 'elite']) {
      const rendered = textsFor(entry, variant).join('\n');
      if (rendered) assert.equal(row[variant], rendered, `${entry.sourceId} ${variant} should be generated`);
      assert.ok(row[variant].trim().length > 0, `${entry.sourceId} ${variant} cannot be blank`);
      assert.doesNotMatch(row[variant], visibleText, `${entry.sourceId} ${variant} must not expose internals or placeholders`);
      assert.equal(row[`${variant}Levels`], toLevels(row[variant]), `${entry.sourceId} ${variant} levels must describe training levels`);
      for (const delivery of entry.metadata?.op?.effectDelivery?.[variant] || []) {
        if (typeof delivery.text === 'string') {
          assert.doesNotMatch(delivery.text, visibleText, `${entry.sourceId} delivery text`);
          assert.doesNotMatch(delivery.text, /[A-Za-z]/, `${entry.sourceId} delivery text must be Chinese-facing`);
        }
        assert.ok(delivery.recipientLabel && delivery.durationLabel && delivery.triggerLabel, `${entry.sourceId} needs display labels alongside canonical descriptor keys`);
        assert.doesNotMatch(String(delivery.recipientLabel), /[A-Za-z]/, `${entry.sourceId} recipient label must be Chinese-facing`);
        assert.doesNotMatch(String(delivery.triggerLabel), /[A-Za-z]/, `${entry.sourceId} trigger label must be Chinese-facing`);
        assert.doesNotMatch(String(delivery.durationLabel), /[A-Za-z]/, `${entry.sourceId} duration label must be Chinese-facing`);
      }
    }
  }
});

test('ordinary and elite text carries the real source-rule quantities and trigger differences', () => {
  for (const entry of blueprints.entries) {
    const ordinary = darkmoonPrepRulesFor({ darkmoonSourceId: entry.sourceId }, false);
    const elite = darkmoonPrepRulesFor({ darkmoonSourceId: entry.sourceId }, true);
    const normalCombat = darkmoonCombatMetadata(entry.sourceId, false)?.text || '';
    const eliteCombat = darkmoonCombatMetadata(entry.sourceId, true)?.text || '';
    const row = byAddonId.get(entry.sourceId);
    const normalText = textsFor(entry, 'normal').join('\n');
    const eliteText = textsFor(entry, 'elite').join('\n');
    if (normalText) assert.equal(row.normal, normalText);
    if (eliteText) assert.equal(row.elite, eliteText);
    if (JSON.stringify(ordinary) !== JSON.stringify(elite) || normalCombat !== eliteCombat) {
      assert.notEqual(row.normal, row.elite, `${entry.sourceId} has source-param variant changes`);
    }
  }
});

test('source-specific text states tested quantities, recipient and elite multiplier instead of descriptor labels', () => {
  const card = id => byAddonId.get(id);
  assert.match(card('BGS_017').normal, /叙拉古.*攻击成长徽章×2/);
  assert.match(card('BGS_017').elite, /叙拉古.*攻击成长徽章×4/);
  assert.match(card('BGS_021').normalLevels, /训练等级×8/);
  assert.match(card('BGS_021').eliteLevels, /训练等级×16/);
  assert.match(card('BGS_027').normalLevels, /训练等级×1/);
  assert.match(card('BGS_027').eliteLevels, /训练等级×2/);
  assert.doesNotMatch(card('BGS_027').normalLevels, /精准徽章/);
  assert.match(card('BGS_043').normal, /随机招募一名干员.*普通形态/);
  assert.match(card('BGS_043').elite, /随机招募一名干员.*进阶形态/);
  assert.match(card('BGS_048').normal, /每购买一名维多利亚阵营干员.*攻击成长徽章×1与职业副属性成长徽章×1/);
  assert.match(card('BGS_048').elite, /每购买一名维多利亚阵营干员.*攻击成长徽章×2与职业副属性成长徽章×2/);
  assert.match(card('BGS_055').normal, /升级费用减少1金币/);
  assert.match(card('BGS_055').elite, /升级费用减少2金币/);
  assert.match(card('BGS_100').normal, /效果触发1次.*所购干员星级/);
  assert.match(card('BGS_100').elite, /效果触发2次.*所购干员星级/);
  assert.match(card('GVG_113').normal, /巨锤盟约/);
  assert.match(card('FP1_010').normal, /精准盟约/);
  assert.match(card('LOE_077').normal, /战吼效果共触发2次/);
  assert.match(card('LOE_077').elite, /战吼效果共触发3次/);
  assert.match(card('BOT_312').normal, /亡语.*攻击成长徽章×3及职业副属性成长徽章×1/);
  assert.match(card('BOT_312').elite, /亡语.*攻击成长徽章×6及职业副属性成长徽章×2/);
  assert.match(card('BOT_911').normal, /坚守盟约和护盾发生器.*攻击成长徽章×2及职业副属性成长徽章×4/);
  assert.match(card('BOT_911').elite, /坚守盟约和护盾发生器.*攻击成长徽章×4及职业副属性成长徽章×8/);
  for (const [id,normal,elite] of [['BOT_312',[3,1],[6,2]],['BOT_911',[2,4],[4,8]]]) {
    const rows=byId.get(id).metadata.op.effectDelivery;
    for (const [variant,expected] of [['normal',normal],['elite',elite]]) {
      const merge=rows[variant].find(x=>x.kind==='magneticAttachment');
      assert.deepEqual([merge.params.attackUnits[variant],merge.params.secondaryUnits[variant]],expected,`${id} ${variant} metadata retains source body stats`);
      const rule=darkmoonPrepRulesFor({darkmoonSourceId:id},variant==='elite').find(x=>x.behavior==='darkmoonMagneticMerge');
      assert.deepEqual([rule?.params?.attackUnits?.[variant],rule?.params?.secondaryUnits?.[variant]],expected,`${id} ${variant} runtime parameters match printed body stats`);
    }
  }
});
