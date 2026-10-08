import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceSourceCandidates, verifiedPieceHit } from '../../tools/independent-recording-pick.mjs';

test('source candidates prefer the drawn body and retain a legal tile fallback', () => {
  const points = pieceSourceCandidates({ left: 200, top: 490, width: 120, height: 138 }, { x: 270, y: 652 });
  assert.deepEqual(points.slice(0, 3).map((point) => point.source), ['body-0.62', 'body-0.82', 'body-0.96']);
  assert.deepEqual(points.slice(0, 3).map((point) => [point.x, Math.round(point.y)]), [[260, 576], [260, 603], [260, 622]]);
  assert.equal(points.at(-1).source, 'tile-fallback');
});

test('source validation requires the exact piece and unobstructed game canvas', () => {
  assert.equal(verifiedPieceHit('p3', 3, { uid: 'p3', area: 'hand' }, 'CANVAS', true), true);
  assert.equal(verifiedPieceHit('p3', 3, { uid: 3, area: 'hand' }, 'CANVAS', true), true);
  assert.equal(verifiedPieceHit('p3', 3, { uid: 'p4' }, 'CANVAS', true), false);
  assert.equal(verifiedPieceHit('p3', 3, { uid: 'p3' }, 'BUTTON', false), false);
  assert.equal(verifiedPieceHit('p3', 3, { n: 3 }, 'CANVAS', true), true);
});
