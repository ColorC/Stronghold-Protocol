import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDamageDealer, isDamageDealer, upgradeReserve } from '../../tools/independent-recording-strategy.mjs';

test('buy strategy does not reserve upgrade money before the warband is fieldable', () => {
  assert.equal(upgradeReserve({ roster: 4, deployed: 4, funds: 8, upgradePrice: 5, level: 3 }), 0);
  assert.equal(upgradeReserve({ roster: 7, deployed: 7, funds: 12, upgradePrice: 5, level: 3 }), 0);
  assert.equal(upgradeReserve({ roster: 8, deployed: 6, funds: 12, upgradePrice: 5, level: 3 }), 8);
  assert.equal(upgradeReserve({ roster: 8, deployed: 6, funds: 7, upgradePrice: 5, level: 3 }), 0);
});

test('incantation medic counts as an attacker while a pure medic does not', () => {
  assert.equal(isDamageDealer({ profession: 'MEDIC', subProfessionId: 'incantationmedic' }), true);
  assert.equal(isDamageDealer({ profession: 'MEDIC', subProfessionId: 'healing', skill: { bb: {} } }), false);
  assert.equal(isDamageDealer({ profession: 'MEDIC', skill: { bb: { atk_scale: 0.2 } } }), true);
  assert.equal(isDamageDealer({}), false);
  assert.equal(hasDamageDealer([{ chessId: 'attacker' }], { attacker: { profession: 'WARRIOR' } }), true);
});
