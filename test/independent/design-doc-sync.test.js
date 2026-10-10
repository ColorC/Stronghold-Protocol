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
import { gearSourcesBlock } from '../../tools/independent-gear-sources.mjs';
import { getCatalog } from '../../server/modes/independent/catalog.js';

test('every operator row of design.md matches the design data', () => {
  assert.deepEqual(tableDiff(design,doc).map((x) => x.name), []);
});

test('the 谁带来哪件装备 lists of design.md match the rules (tools/independent-gear-sources.mjs)', () => {
  const d = gearSourcesDiff(doc);
  assert.equal(d.ok, true, d.reason);
});

test('prize-only gear cites its actual prize and retained 19.2 source card', () => {
  const catalog = getCatalog();
  const block = gearSourcesBlock(catalog);
  const prizeGear = Object.values(catalog.equipment).filter((item) => item.prizeOnly || item.sourcePrizeId || item.kind === 'prizeGear');
  assert.ok(prizeGear.length > 0, 'catalog includes prize-derived wearable gear');
  for (const item of prizeGear) {
    const prize = catalog.prizes[item.sourcePrizeId];
    const sourceCard = item.sourceRefs?.cards?.[0];
    assert.ok(item.kind === 'prizeGear' || item.prizeOnly || item.sourcePrizeId, `${item.id} is explicitly prize-only`);
    if (item.shopEligible != null) assert.equal(item.shopEligible, false, `${item.id} stays outside the shop`);
    assert.ok(sourceCard, `${item.id} retains its original source card`);
    assert.equal(sourceCard.version, '19.2.0.68600', `${item.id} keeps the source version`);
    if (item.sourcePrizeId) {
      assert.ok(prize, `${item.id} resolves to a current prize`);
      assert.ok(block.includes(`**${item.newName || item.name}**：工程部特供「${prize.name}」`), `${item.id} is listed under its actual prize`);
    } else {
      assert.ok(block.includes(`**${item.newName || item.name}**：工程部特供装备（19.2参考卡：${sourceCard.name}）`), `${item.id} is listed with its reference card, not a fabricated prize`);
    }
  }
});
