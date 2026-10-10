import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypePveWinCount } from '../../server/sim/content/resonance/prototype-installer.js';

test('Ambessa campaign win count uses only previously settled wins and caps at seven', () => {
  const history = [
    { type: 'fight-settled', round: 1, won: true },
    { type: 'fight-settled', round: 2, won: false },
    { type: 'logistics-settled', round: 3, won: true },
    { type: 'fight-settled', round: 4, won: true },
    ...Array.from({ length: 8 }, (_, index) => ({ type: 'fight-settled', round: index + 5, won: true })),
  ];
  assert.equal(prototypePveWinCount({ history }), 7);
  assert.equal(prototypePveWinCount({ history: [{ type: 'fight-settled', won: false }] }), 0);
  assert.equal(prototypePveWinCount({ history: [] }), 0);
  assert.equal(prototypePveWinCount({}), 0);
});
