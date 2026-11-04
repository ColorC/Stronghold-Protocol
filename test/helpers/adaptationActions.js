import assert from 'node:assert/strict';
import { ROWS, COLS } from '../../server/sim/constants.js';
import { summonPlacementLegal } from '../../server/sim/content/assault/summons.js';

// Consumer tests explicitly choose and deploy a real native summon. This does
// not ask a newly adapted skill to retain its retired automatic deployment.
export function spawnTestSummon(h, owner, tokenId = 'token_10020_ling_soul2') {
  const cells = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++)
    if (summonPlacementLegal(h.battle, owner, tokenId, row, col)) cells.push([row, col]);
  cells.sort((a, b) => Math.abs(a[0] - owner.tileR) + Math.abs(a[1] - owner.tileC)
    - Math.abs(b[0] - owner.tileR) - Math.abs(b[1] - owner.tileC) || a[0] - b[0] || a[1] - b[1]);
  assert.ok(cells.length, 'an actual legal summon tile is available');
  const [row, col] = cells[0], token = h.battle.spawnToken(owner, tokenId, row, col, { anySource: true });
  assert.ok(token?.alive && token.deployed); h.flush(); return token;
}

export function giveCastTargets(h, ...units) {
  for (const unit of units) h.spawn([unit.tileR, unit.tileC + 1]);
}
