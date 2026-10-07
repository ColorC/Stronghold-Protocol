// The hand-written player texts (data/independent-game-text.json) against the design texts the rules come from:
// every entity has one, every number of the design text is still there, and none of the spec wording is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { independentDisplayCatalog } from '../../server/modes/independent/http.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const textPath = process.env.SP_GAME_TEXT_PATH || process.env.SP_INDEPENDENT_GAME_TEXT_PATH || new URL('../../data/independent-game-text.json', import.meta.url);
const text = JSON.parse(readFileSync(textPath, 'utf8'));
const display = independentDisplayCatalog(data, catalog);

const numbers = (s) => new Set((String(s || '').match(/\d+(?:\.\d+)?/g) || []).map(Number));
/** Design numbers a text says otherwise on purpose: in words, or in the auto-attached note of the item it names. */
const SAID_IN_WORDS = { 'chess_char_1_03_a:normal': [2], 'extra-procurement-quota': [1] };
const SPEC_WORDING = ['该干员', '锻造', '放入装备库存', '一级', '己方主战斗', '本稿', '第一期', '沿用', '不设精锐版'];

function sameNumbers(key, design, written) {
  const have = numbers(written);
  const missing = [...numbers(design)].filter((n) => !have.has(n) && !(SAID_IN_WORDS[key] || []).includes(n));
  assert.deepEqual(missing, [], `${key}: design「${design}」→ text「${written}」`);
}

test('every operator form has hand-written text with the design numbers and none of the spec wording', () => {
  for (const op of Object.values(catalog.operators).filter((x) => !x.elite && x.recruitable !== false)) {
    const entry = text.operators[op.chessId];
    assert.ok(entry, `${op.name} has text`);
    assert.equal(entry.name, op.name);
    sameNumbers(`${op.chessId}:normal`, op.nativeTrait.normalText, entry.normal);
    sameNumbers(`${op.chessId}:elite`, op.nativeTrait.eliteText, entry.elite);
    for (const t of [entry.normal, entry.elite]) for (const w of SPEC_WORDING) assert.ok(!t.includes(w), `${op.name}: 「${w}」 in 「${t}」`);
  }
});

test('every gear a player can see has text; numbers match its effect', () => {
  const all = { ...catalog.badges, ...catalog.equipment };
  for (const [id, d] of Object.entries(all)) {
    if (d.available === false || d.mechanism === 'disabled') continue;
    const entry = text.gear[id];
    assert.ok(entry, `${d.newName || d.name} (${id}) has text`);
    if (d.kind !== 'badge') {
      sameNumbers(`${id}:normal`, d.normal || d.effect, entry.normal);
      if (d.eliteLevel != null && d.elite) sameNumbers(`${id}:elite`, d.elite, entry.elite);
    } else {
      assert.ok(numbers(entry.normal).has(d.kind === 'badge' && /Percent|Dodge|Reduction|DamagePercent/.test(d.stat) ? Number((d.value * 100).toFixed(4)) : d.value), `${id} value`);
    }
    for (const t of [entry.normal, entry.elite].filter(Boolean)) for (const w of SPEC_WORDING) assert.ok(!t.includes(w), `${id}: 「${w}」`);
  }
  for (const id of Object.keys(text.gear)) assert.ok(all[id], `${id} exists in the catalog`);
});

test('prizes and attachments: texts with the design numbers; the page shows them under the 工程部特供 stages', () => {
  for (const [id, p] of Object.entries(catalog.prizes)) {
    assert.ok(text.prizes[id], `${p.name} has text`);
    sameNumbers(id, p.effect, text.prizes[id].text);
    assert.ok(['起步', '成型', '决胜'].includes(display.prizes[id].stage), `${p.name} stage`);
  }
  for (const [id, a] of Object.entries(catalog.attachments)) {
    assert.ok(text.attachments[id], `${a.name} has text`);
    sameNumbers(id, a.effect, text.attachments[id].text);
  }
  for (const t of [...Object.values(text.prizes).map((x) => x.text), ...Object.values(text.attachments).map((x) => x.text)]) {
    for (const w of SPEC_WORDING) assert.ok(!t.includes(w), `「${w}」 in 「${t}」`);
  }
});

test('the display catalog carries the hand-written texts, the new name and no internal ids in names', () => {
  assert.equal(display.name, '卫戍协议：工坊');
  const yan = Object.values(display.operators).find((x) => x.name === '角峰' && !x.elite);
  assert.equal(yan.traitTexts.normal, text.operators[yan.baseChessId].normal);
  const yanElite = display.operators[yan.eliteChessId];
  assert.equal(yanElite.traitTexts.elite, text.operators[yan.baseChessId].elite);
  assert.equal(display.gear.precision.normal, text.gear.precision.normal);
  assert.match(display.gear.precision.normal, /2%/);
  assert.ok(display.terms['basic-badge'].name === '基础徽章');
  for (const g of Object.values(display.gear)) assert.ok(!/^[a-z0-9_:-]+$/.test(g.name), `gear name ${g.name}`);
});
