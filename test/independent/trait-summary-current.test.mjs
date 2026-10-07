import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { traitSummary, TRAIT_WHEN } from '../../server/modes/independent/summary.js';
import { cardTable } from '../../tools/independent-card-table.mjs';

const quiet = { warn() {}, error() {}, info() {} };

test('all 311 current operator forms have one classified summary per authored rule and actual event labels', () => {
  const catalog = getCatalog(getData({ log: quiet }));
  assert.equal(Object.keys(catalog.operators).length, 311);
  const gearIds = new Set([...Object.keys(catalog.badges), ...Object.keys(catalog.equipment)]);
  for (const op of Object.values(catalog.operators)) {
    const rules = [...op.nativeTrait.effect.prep, ...op.nativeTrait.effect.combat];
    const entries = traitSummary(op.nativeTrait.effect);
    assert.equal(entries.length, rules.length, op.name);
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      assert.ok(TRAIT_WHEN[entry.when], `${op.name}: missing trigger label ${entry.when}`);
      assert.ok(entry.kind && entry.kind !== 'other', `${op.name}: unclassified ${JSON.stringify(entry)}`);
      for (const item of entry.items || []) {
        if (item.id !== null && item.id !== undefined) assert.ok(gearIds.has(item.id), `${op.name}: unknown item ${item.id}`);
        for (const n of [item.normal, item.elite]) if (n !== undefined && n !== null) assert.ok(Number.isFinite(n) && n >= 0, `${op.name}: bad item quantity`);
      }
      const rule = rules[i];
      assert.equal(entry.when, rule.behavior==='warbandEvent'?({death:'allyDeath',damaged:'allyDamaged',kill:'allyKill'}[rule.params.event]||rule.params.event):rule.behavior==='retiringEffect'?'retiring':rule.trigger);
      if (rule.behavior === 'grantEquipment' || (rule.behavior === 'eventProduction' && !rule.params.copyOutputFromEvent)
        || ['forgePerGainedChess', 'forgeBenchCount'].includes(rule.behavior)) {
        assert.ok(entry.items?.length, `${op.name}: ${rule.behavior} should expose its known item(s)`);
      }
    }
  }
  for (const trigger of ['shieldLayersGained', 'shieldLayersBroken', 'heal', 'attack', 'damaged', 'dodge', 'dollSwap', 'skillStart', 'freeze', 'stun', 'elementBurst', 'battleEnd']) {
    assert.equal(typeof TRAIT_WHEN[trigger], 'string', `event ${trigger}`);
    assert.ok(TRAIT_WHEN[trigger].length > 0);
  }
  assert.equal(TRAIT_WHEN.damaged, '受到伤害时');
  assert.equal(TRAIT_WHEN.shieldLayersGained, '获得护盾层时');
});

test('gear card sources exclude inactive ordinary operators and elite forms', () => {
  const catalog = {
    operators: {
      active_a: { name: '在役甲', recruitable: true, elite: false, nativeTrait: { effect: { prep: [{ trigger: 'gain', behavior: 'grantEquipment', params: { outputs: [{ id: 'live-gear' }] } }], combat: [] } } },
      inactive_a: { name: '停用乙', recruitable: false, elite: false, nativeTrait: { effect: { prep: [{ trigger: 'gain', behavior: 'grantEquipment', params: { outputs: [{ id: 'inactive-gear' }] } }], combat: [] } } },
      elite_b: { name: '在役甲', recruitable: true, elite: true, nativeTrait: { effect: { prep: [{ trigger: 'gain', behavior: 'grantEquipment', params: { outputs: [{ id: 'elite-gear' }] } }], combat: [] } } },
    },
    badges: {},
    equipment: Object.fromEntries(['live-gear', 'inactive-gear', 'elite-gear'].map((id) => [id, {
      id, canonicalId: id, available: true, mechanism: 'equipment', kind: 'equipment', name: id, level: 1,
    }])),
  };
  const rows = cardTable('gear', catalog).rows;
  const from = Object.fromEntries(rows.map((row) => [row.id, row.from]));
  assert.equal(from['live-gear'], '在役甲');
  assert.equal(from['inactive-gear'], '');
  assert.equal(from['elite-gear'], '');
});
