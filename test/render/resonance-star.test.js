import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInfo } from '../../public/js/render/app.js';

test('native UnitInfo passes authored Resonance stars and leaves legacy metadata absent', () => {
  for (const star of [1, 2, 3]) assert.equal(renderInfo({ id: 4, resonanceStar: star }).resonanceStar, star);
  for (const star of [undefined, 0, 4, '2']) {
    const info = renderInfo({ id: 4, ...(star === undefined ? {} : { resonanceStar: star }) });
    assert.equal(Object.hasOwn(info, 'resonanceStar'), false);
  }
});
