import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const screen = read('public/js/resonance/native-match-screen.js');
const session = read('server/modes/resonance/session.js');

test('复制凭证 in the live match pick an operator and send useCopy, the session rule they follow', () => {
  // the two kinds the session grants and accepts
  assert.match(session, /\['smallCopy','universalCopy'\]/);
  assert.match(session, /consumable\.kind==='smallCopy'&&costOf\(catalog,target\.operatorId\)>3/);
  // the consumables list names both and caps 低费复制凭证 at 3 cost, as the session does
  const table = screen.match(/export const COPY_CONSUMABLES = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] ?? '';
  assert.match(table, /smallCopy: Object\.freeze\(\{ name: '低费复制凭证',[^}]*maxCost: 3 \}\)/);
  assert.match(table, /universalCopy: Object\.freeze\(\{ name: '复制凭证',[^}]*maxCost: Infinity \}\)/);
  const list = screen.slice(screen.indexOf('function NativeResonanceInventoryActions'), screen.indexOf('/** Tiles a dragged summon card'));
  assert.match(list, /onAction\(\{ type: 'useCopy', consumableUid: row\.uid, pieceUid \}\)/, 'a copy is spent with useCopy, not useConsumable');
  const copyBranch = list.indexOf('const copy = COPY_CONSUMABLES[row.kind];'), gearRecord = list.indexOf('const record = catalog?.prototypeEconomy?.gearConsumables?.[row.kind]');
  assert.ok(copyBranch > 0 && gearRecord > copyBranch, 'copies return their own row before the gear consumables (whose button sends useConsumable)');
});

test('no resonance source still calls a copy 复制券 or 复制器', () => {
  for (const rel of ['shared/resonance/prototype-economy.js', 'shared/resonance/current-strategies.js', 'shared/resonance/openings.js',
    'public/js/resonance/model.js', 'public/js/resonance/panels.js', 'public/js/resonance/detail.js', 'public/js/resonance/native-match-screen.js']) {
    assert.doesNotMatch(read(rel), /复制券|复制器/, rel);
  }
});
