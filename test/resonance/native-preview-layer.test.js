import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../public/css/resonance.css', import.meta.url), 'utf8');
const dockSource = readFileSync(new URL('../../public/js/resonance/native/equipmentDock.js', import.meta.url), 'utf8');

/** Declarations of every rule whose selector list contains exactly `selector`. */
function declarations(selector) {
  const rules = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').some((part) => part.trim() === selector)) rules.push(match[2]);
  }
  return rules.join(';');
}
const zIndexOf = (selector) => {
  const found = [...declarations(selector).matchAll(/(?:^|;|\s)z-index:\s*(-?\d+)/g)].map((match) => Number(match[1]));
  return found.length ? found.at(-1) : null;
};

test('the equipment rail is not a stacking context, so its merge previews leave its z 12 and sit above the HUD', () => {
  assert.equal(zIndexOf('.rs-native-match .rs-native-equipment-rail'), null, 'a z-index on the rail would trap the fixed previews under the HUD');
  assert.equal(zIndexOf('.rs-native-match .rs-native-equipment-rail .rs-equipment-dock__items'), 12, 'the item list keeps its own layer');
  assert.equal(zIndexOf('.rs-native-match .rs-native-equipment-rail .rs-equipment-dock__open'), 12);
  const hudWithPanel = zIndexOf('.rs-native-match .gm__hud.has-resonance-overlay');
  const preview = zIndexOf('.rs-equipment-dock__preview');
  const anchored = zIndexOf('.rs-equipment-dock__field-preview.is-anchored');
  const codex = zIndexOf('.rs-native-codex-overlay');
  assert.equal(hudWithPanel, 70);
  assert.equal(codex, 90);
  for (const [name, value] of [['drag preview', preview], ['field preview', anchored]]) {
    assert.ok(value > hudWithPanel, `${name} (${value}) is above the HUD while a detail card or panel is open (${hudWithPanel})`);
    assert.ok(value < codex, `${name} (${value}) stays under the full-screen codex (${codex})`);
  }
});

test('each inventory dock finds its own hovered slot, not the first one in the document', () => {
  assert.match(dockSource, /rootRef\.current\?\.querySelector\(`\.rs-equipment-dock__slot\[data-item-uid=/);
  assert.doesNotMatch(dockSource, /document\.querySelector\(`\.rs-equipment-dock__slot/);
});
