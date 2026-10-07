// design.md's operator table is a copy of data/independent-design.json (tools/independent-design-table.mjs): a rule
// changed in one and not the other fails here, so the two never speak differently about an operator.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const designPath=process.env.SP_INDEPENDENT_DESIGN_PATH||new URL('../../data/independent-design.json',import.meta.url);
const docPath=process.env.SP_INDEPENDENT_DESIGN_PATH?resolve(dirname(designPath),'../docs/independent-mode/design.md'):new URL('../../docs/independent-mode/design.md',import.meta.url);
const doc=readFileSync(docPath,'utf8');
const design=JSON.parse(readFileSync(designPath,'utf8'));
import { tableDiff } from '../../tools/independent-design-table.mjs';
import { gearSourcesDiff } from '../../tools/independent-gear-sources.mjs';

test('every operator row of design.md matches the design data', () => {
  assert.deepEqual(tableDiff(design,doc).map((x) => x.name), []);
});

test('the 谁带来哪件装备 lists of design.md match the rules (tools/independent-gear-sources.mjs)', () => {
  const d = gearSourcesDiff(doc);
  assert.equal(d.ok, true, d.reason);
});
