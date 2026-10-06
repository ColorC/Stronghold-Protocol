import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX_KINDS } from '../../public/js/render/fxRecipes.js';

test('upstream 0.2.0 custom-kit FX kinds keep their explicit visual archetypes', () => {
  const expected = {
    bulletClear: 'wave', logosLexicon: 'mark', logosExecute: 'strike', mantraArc: 'bolt', mantraGrant: 'mark', mantraGate: 'reticle',
    veenBounce: 'counter', veenVolley: 'volley', harpoon: 'beam', arrowRain: 'volley', mark: 'reticle', bounce: 'counter', dying: 'mark',
  };
  for (const [kind, archetype] of Object.entries(expected)) assert.equal(FX_KINDS[kind]?.a, archetype, kind);
});
