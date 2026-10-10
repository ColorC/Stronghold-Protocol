import test from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S } from '../../shared/protocol.js';

test('recycleEquipment passes the shared g.resonance protocol with its item UID', () => {
  assert.equal(validateC2S({ t: 'g.resonance', action: { type: 'recycleEquipment', itemUid: 'i11' } }), null);
  assert.notEqual(validateC2S({ t: 'g.resonance', action: { type: 'recycleEquipment', itemUid: 'i11', extra: true } }), null);
});
