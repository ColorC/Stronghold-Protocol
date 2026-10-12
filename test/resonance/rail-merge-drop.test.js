import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dock = readFileSync(new URL('../../public/js/resonance/native/equipmentDock.js', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../../public/js/resonance/native-match-screen.js', import.meta.url), 'utf8');

test('a merge dropped on a rail slot stays in the rail: no "drag it onto an operator" hint from the field handler', () => {
  const slotDrop = dock.match(/onDrop=\$\{event => \{([^}]*)\}\}/)?.[1] ?? '';
  assert.match(slotDrop, /combine\(item\)/, 'the slot drop merges');
  assert.match(slotDrop, /stopPropagation\(\)/, 'the slot drop does not bubble to the match screen');
  const fieldDrop = screen.slice(screen.indexOf('const equipmentDrop = async'), screen.indexOf('const equipmentDrop = async') + 1600);
  const guard = fieldDrop.indexOf("closest?.('.rs-equipment-dock')"), hint = fieldDrop.indexOf('请把装备拖到一名可操作的干员身上');
  assert.ok(guard > 0 && hint > guard, 'a drop anywhere on the rail returns before the operator hint');
});
