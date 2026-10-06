// design.md's operator table is a copy of data/independent-design.json (tools/independent-design-table.mjs): a rule
// changed in one and not the other fails here, so the two never speak differently about an operator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tableDiff } from '../../tools/independent-design-table.mjs';
import { gearSourcesDiff } from '../../tools/independent-gear-sources.mjs';

test('every operator row of design.md matches the design data', () => {
  assert.deepEqual(tableDiff().map((x) => x.name), []);
});

test('the 谁带来哪件装备 lists of design.md match the rules (tools/independent-gear-sources.mjs)', () => {
  const d = gearSourcesDiff();
  assert.equal(d.ok, true, d.reason);
});
