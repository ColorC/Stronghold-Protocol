import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTrainingChoices, trainingChoiceOptions, trainingChoiceTargets } from '../../shared/independentTrainingChoice.js';

const catalog = {
  config: { trainingGearIds: ['gear_t1', 'gear_t3', 'gear_t6', 'unique_gear'] },
  operators: {
    medic: { source: { normalChess: { profession: 'MEDIC', bonds: [], stats: { atk: 100, maxHp: 1000 } } } },
    guard: { source: { normalChess: { profession: 'WARRIOR', bonds: [], stats: { atk: 100, maxHp: 1000 } } } },
  },
  attachments: {
    common: { id: 'common', unique: true, shopTier: 1, condition: 'any' },
    medic: { id: 'medic', unique: true, shopTier: 2, condition: 'native medic profession' },
    advanced: { id: 'advanced', unique: true, shopTier: 4, condition: 'any' },
    repeatable: { id: 'repeatable', unique: false, shopTier: 1, condition: 'any' },
  },
  equipment: {
    gear_t1: { id: 'gear_t1', kind: 'equipment', available: true, shopTier: 1 },
    gear_t3: { id: 'gear_t3', kind: 'equipment', available: true, shopTier: 3 },
    gear_t6: { id: 'gear_t6', kind: 'equipment', available: true, shopTier: 6 },
    unique_gear: { id: 'unique_gear', kind: 'equipment', available: true, shopTier: 1, unique: true, uniqueKey: 'unique-fixture' },
  },
};
const state = (level = 3) => ({ shop: { level }, rngState: 34, pieces: [
  { uid: 'medic', chessId: 'medic', row: 10, col: 2, equipment: [], attachments: [] },
  { uid: 'guard', chessId: 'guard', row: 10, col: 3, equipment: [], attachments: [] },
  { uid: 'bench', chessId: 'medic', row: null, col: null, equipment: [], attachments: [] },
] });

test('training pool joins eligible attachments and unlocked special gear for the selected operator', () => {
  const s = state(3);
  const medic = trainingChoiceOptions(s, catalog, s.pieces[0]);
  assert.deepEqual(new Set(medic), new Set(['common', 'medic', 'gear_t1', 'gear_t3', 'unique_gear']));
  assert.ok(!medic.includes('advanced'), 'future attachment is locked above the current shop level');
  const guard = trainingChoiceOptions(s, catalog, s.pieces[1]);
  assert.deepEqual(new Set(guard), new Set(['common', 'gear_t1', 'gear_t3', 'unique_gear']));
  assert.deepEqual(trainingChoiceTargets(s, catalog).map((p) => p.uid), ['medic', 'guard']);
  const clientCatalog = { ...catalog, gear: catalog.equipment };
  delete clientCatalog.equipment;
  assert.deepEqual(new Set(trainingChoiceOptions(s, clientCatalog, s.pieces[0])), new Set(medic), 'the browser catalog gear map follows the same eligibility rule');
});

test('training filters already worn unique choices and full equipment capacity without modifying state', () => {
  const s = state(6);
  s.pieces[0].attachments.push({ id: 'common' });
  s.pieces[0].equipment.push({ id: 'unique_gear', quantity: 1 });
  const before = structuredClone(s);
  assert.ok(!trainingChoiceOptions(s, catalog, s.pieces[0]).includes('common'));
  assert.ok(!trainingChoiceOptions(s, catalog, s.pieces[0]).includes('unique_gear'));
  s.pieces[0].equipment = [{ id: 'gear_t1', quantity: 999 }];
  assert.ok(!trainingChoiceOptions(s, catalog, s.pieces[0]).some((id) => id.startsWith('gear_')));
  assert.deepEqual(before.pieces[0].attachments, [{ id: 'common' }], 'pool inspection never changes state');
});

test('training sampling is deterministic for a saved seed and samples beyond the first three candidates', () => {
  const s = state(6);
  const choices = trainingChoiceOptions(s, catalog, s.pieces[0]);
  const a = drawTrainingChoices(choices, 34);
  assert.deepEqual(a, drawTrainingChoices(choices, 34));
  assert.equal(a.choices.length, 3);
  const samples = new Set(Array.from({ length: 12 }, (_, i) => drawTrainingChoices(choices, i + 1).choices.join(',')));
  assert.ok(samples.size > 1, 'different stored RNG states can reveal different choices');
  assert.equal(drawTrainingChoices(choices, 34, 99).choices.length, choices.length);
});
