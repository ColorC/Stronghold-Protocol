import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComponentLinkHash } from '../../public/js/independent/componentLinkHash.js';

test('component fragments retain only supported detail tabs', () => {
  assert.deepEqual(parseComponentLinkHash('#piece-p12:tab=reference'), { kind: 'piece', id: 'p12', tab: 'reference' });
  assert.deepEqual(parseComponentLinkHash('#shop-2:tab=gear'), { kind: 'shop', id: '2', tab: 'gear' });
  assert.deepEqual(parseComponentLinkHash('#gear-precision'), { kind: 'gear', id: 'precision', tab: null });
  assert.deepEqual(parseComponentLinkHash('#piece-p12:tab=unknown'), { kind: 'piece', id: 'p12', tab: null });
  assert.equal(parseComponentLinkHash('#piece-'), null);
  assert.equal(parseComponentLinkHash('#item-i7'), null);
});
