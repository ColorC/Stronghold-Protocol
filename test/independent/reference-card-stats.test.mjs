import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getCatalog } from '../../server/modes/independent/catalog.js';

const root = new URL('../../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('the 101 active source cards carry official normal and premium minion stats', async () => {
  const design = await readJson('data/independent-design.json');
  const catalog = getCatalog();
  const active = Object.values(catalog.operators).filter((op) => op.recruitable && !op.elite && !op.darkmoonSupport);

  assert.equal(active.length, 101);
  assert.deepEqual(new Set(active.map((op) => op.chessId)), new Set(design.rules.activeRosterIds));
  assert.equal(active.reduce((n, op) => n + (op.sourceRefs?.cards?.length || 0), 0), 101);

  for (const op of active) {
    assert.ok(op.sourceRefs?.cards?.length, `${op.name}: missing source card reference`);
    for (const card of op.sourceRefs.cards) {
      assert.equal(card.version, '19.2.0.68600', `${op.name}: wrong source version`);
      assert.equal(card.cardType, 'MINION', `${op.name}: source card kind`);
      assert.ok(Number.isInteger(card.dbfId) && Number.isInteger(card.goldenDbfId), `${op.name}: missing normal/golden DBF link`);
      assert.ok(Number.isInteger(card.attack) && Number.isInteger(card.health), `${op.name}: missing normal stats`);
      assert.ok(Number.isInteger(card.goldenAttack) && Number.isInteger(card.goldenHealth), `${op.name}: missing premium stats`);
    }
  }
  const byId = new Map(active.flatMap((op) => op.sourceRefs.cards.map((card) => [card.id, card])));
  assert.deepEqual([byId.get('BGS_027')?.attack, byId.get('BGS_027')?.health, byId.get('BGS_027')?.goldenAttack, byId.get('BGS_027')?.goldenHealth], [1, 2, 2, 4]);
  assert.deepEqual([byId.get('BGS_106')?.attack, byId.get('BGS_106')?.health, byId.get('BGS_106')?.goldenAttack, byId.get('BGS_106')?.goldenHealth], [2, 2, 4, 4]);
  assert.deepEqual([byId.get('BOT_312')?.attack, byId.get('BOT_312')?.health, byId.get('BOT_312')?.goldenAttack, byId.get('BOT_312')?.goldenHealth], [3, 1, 6, 2]);
  assert.deepEqual([byId.get('BGS_106')?.dbfId, byId.get('BGS_106')?.goldenDbfId], [63614, 65658]);
});

test('reference tab displays both forms and keeps the in-app deep link without an external card link', async () => {
  const detail = await readFile(new URL('../../public/js/independent/detail.js', import.meta.url), 'utf8');
  assert.match(detail, /originalCardStats\(ref\)/);
  assert.match(detail, /originalCardStats\(ref, true\)/);
  assert.match(detail, /copyComponentLink\(e, `\$\{anchor\}:tab=reference`\)/);
  assert.doesNotMatch(detail, /<a href=\$\{ref\.sourceUrl\}/);
  assert.match(detail, /非随从（\$\{ref\.cardType\}），无攻击力\/生命值/);
  assert.match(detail, /卡牌类型未收录，未显示攻血/);
});
