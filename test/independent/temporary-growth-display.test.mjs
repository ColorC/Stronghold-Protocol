import test from 'node:test';
import assert from 'node:assert/strict';
import { temporaryGrowthDisplay } from '../../public/js/independent/model.js';
import { unitStatsEntry } from '../../shared/protocol.js';

const catalog = {
  gear: {
    precision: { name: '攻击徽章', kind: 'badge' },
    damage: { name: '伤害徽章', kind: 'badge' },
  },
  operators: {
    opA: { name: '水月', sourceRefs: { darkmoon19_2: { id: 'BGS_061' } } },
    opB: { name: '贾维', sourceRefs: { darkmoon19_2: { id: 'BGS_078' } } },
  },
};

function nativeProbe(growth = []) {
  const unit = { id: 7, uid: 'mizuki', defId: 'chess_char_4_09_a', hp: 100, base: { maxHp: 100, atk: 30 },
    mem: { darkmoonTemporaryEquipment: Object.fromEntries(growth.map((row, index) => [`native-growth-${index}`, row])) } };
  return unitStatsEntry(unit, unit.base);
}

const badges = (sourceId, attackUnits, secondaryUnits) => ({ sourceId, attackUnits, secondaryUnits, badgeIds: ['precision', 'damage'], expires: 'battleEnd' });

test('temporary growth UI projection follows native unitStatsEntry payloads, merges sources, and keeps modes separate', () => {
  const belowEight = nativeProbe([]);
  assert.deepEqual(belowEight.temporaryGrowth, [], 'pre-threshold frame has no temporary-growth entry to display');
  assert.deepEqual(temporaryGrowthDisplay(belowEight.temporaryGrowth, catalog), { mode: 'badges', levels: 0, items: [], total: 0, sources: [] });

  const eight = nativeProbe([badges('BGS_061', 1, 1)]);
  const atEight = temporaryGrowthDisplay(eight.temporaryGrowth, catalog);
  assert.deepEqual(atEight.items.map(({ id, quantity }) => [id, quantity]), [['precision', 1], ['damage', 1]]);
  assert.equal(atEight.total, 2);
  assert.deepEqual(atEight.sources, ['水月']);

  const sixteen = nativeProbe([badges('BGS_061', 1, 1), badges('BGS_078', 1, 1)]);
  const atSixteen = temporaryGrowthDisplay(sixteen.temporaryGrowth, catalog);
  assert.deepEqual(atSixteen.items.map(({ id, quantity }) => [id, quantity]), [['precision', 2], ['damage', 2]], 'same badge IDs aggregate across effects');
  assert.equal(atSixteen.total, 4);
  assert.deepEqual(atSixteen.sources, ['水月', '贾维']);

  const elite = nativeProbe([badges('BGS_061', 2, 2)]);
  assert.deepEqual(temporaryGrowthDisplay(elite.temporaryGrowth, catalog).items.map(({ id, quantity }) => [id, quantity]), [['precision', 2], ['damage', 2]], 'serialized elite quantities are used as-is');

  const levels = nativeProbe([{ sourceId: 'BGS_061', temporaryTrainingLevels: 8, expires: 'battleEnd' }]);
  assert.deepEqual(temporaryGrowthDisplay(levels.temporaryGrowth, catalog, 'levels'), { mode: 'levels', levels: 8, items: [], sources: ['水月'] });
  assert.deepEqual(temporaryGrowthDisplay([badges('BGS_061', 1, 1)], catalog, 'levels').items, [], 'levels mode never displays badge rows');
});
