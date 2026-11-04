import test from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S } from '../../shared/protocol.js';

test('recycleEquipment passes the shared g.resonance protocol with its item UID', () => {
  assert.equal(validateC2S({ t: 'g.resonance', action: { type: 'recycleEquipment', itemUid: 'i11' } }), null);
  assert.notEqual(validateC2S({ t: 'g.resonance', action: { type: 'recycleEquipment', itemUid: 'i11', extra: true } }), null);
});

test('Resonance combat control accepts only an absolute speed or one natural finish request', () => {
  for (const speed of [1, 2, 4]) assert.equal(validateC2S({ t: 'g.resonanceCombat', speed }), null);
  assert.equal(validateC2S({ t: 'g.resonanceCombat', finish: true }), null);
  for (const invalid of [
    { t: 'g.resonanceCombat' }, { t: 'g.resonanceCombat', speed: 3 },
    { t: 'g.resonanceCombat', finish: false }, { t: 'g.resonanceCombat', speed: 4, finish: true },
  ]) assert.notEqual(validateC2S(invalid), null, JSON.stringify(invalid));
});

test('useConsumable passes the shared g.resonance protocol: a gear anvil with its consumable UID, a remover or reforger with the item too', () => {
  assert.equal(validateC2S({ t: 'g.resonance', action: { type: 'useConsumable', consumableUid: 'u12' } }), null);
  assert.equal(validateC2S({ t: 'g.resonance', action: { type: 'useConsumable', consumableUid: 'u13', itemUid: 'i4' } }), null);
  for (const invalid of [{ type: 'useConsumable', consumableUid: 'u12', extra: true }, { type: 'useConsumable', consumableUid: 'bad uid' }])
    assert.notEqual(validateC2S({ t: 'g.resonance', action: invalid }), null, JSON.stringify(invalid));
});
