import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { nativeBodyStats } from '../../shared/independentRules.js';
import { nativeLevelAttributes, operatorGrowthInfo } from '../../shared/independentGrowth.js';
import { grantEquipment, equipItem } from '../../server/modes/independent/equipment.js';
import { choosePrize } from '../../server/modes/independent/prizes.js';
import { previewUnitStats } from '../../server/modes/independent/battle.js';

const data = getData();
const catalog = getCatalog(data);
const id = 'chess_char_1_02_a';
function piece(uid = 'a', extra = {}) {
  return { uid, chessId: id, elite: false, row: 10, col: 5, dir: 'RIGHT', equipment: [], attachments: [], nativeState: {}, skillIndex: 0, moduleId: 'none', ...extra };
}
function state(extra = {}) { return { round: 1, revision: 0, nextUid: 1, pieces: [piece()], inventory: [], production: [], ...extra }; }

test('explicit source keyword equipment really lands on its wearer', () => {
  const s = state();
  grantEquipment(s, catalog, 'independent:坚守盟约', 1, { origin: 'native', sourceUid: 'a', landOn: 'self' });
  assert.equal(s.inventory.length, 0);
  assert.deepEqual(s.pieces[0].equipment.map((x) => [x.id, x.quantity]), [['independent:坚守盟约', 1]]);
  assert.equal(s.production[0].targetUid, 'a');
});
test('fixed-target capacity overflow is lost and never becomes a flexible hand resource', () => {
  const s = state(); s.pieces[0].equipment = [{ id: 'precision', quantity: 999 }];
  const r = grantEquipment(s, catalog, 'precision', 2, { origin: 'native', sourceUid: 'a' });
  assert.equal(r.lost, 2); assert.equal(s.inventory.length, 0);
});
test('a missing front target falls back to its living maker and never creates free stock', () => {
  const s = state();
  const r = grantEquipment(s, catalog, 'precision', 1, { origin: 'native', sourceUid: 'a', landOn: 'front' });
  assert.equal(r.quantity, 1); assert.equal(r.worn, 'a');
  assert.equal(s.inventory.length, 0); assert.deepEqual(s.pieces[0].equipment.map(x=>[x.id,x.quantity]),[['precision',1]]);
  assert.equal(s.production[0].targetUid,'a');
});
test('a hand resource stays freely allocatable until the player equips it', () => {
  const s = state();
  grantEquipment(s, catalog, 'precision', 2, { origin: 'prize' });
  assert.equal(s.inventory[0].quantity, 2); assert.equal(s.pieces[0].equipment.length, 0);
  equipItem(s, catalog, s.inventory[0].uid, 'a', 1);
  assert.equal(s.pieces[0].equipment[0].quantity, 1); assert.equal(s.inventory[0].quantity, 1);
});
test('Might of Stormwind permanently buffs every deployed operator, no inventory', () => {
  const s = state({ phase: 'prize', pieces: [piece('a'), piece('b', { col: 6 }), piece('bench', { row: null, col: null })],
    offers: [{ id: 'offer', type: 'prize', choices: ['team-readiness-support'] }] });
  choosePrize(s, catalog, 'offer', 0);
  assert.equal(s.inventory.length, 0);
  for (const p of s.pieces.slice(0, 2)) assert.deepEqual(p.equipment.map((x) => [x.id, x.quantity]), [['precision', 1], ['vitality', 1]]);
  assert.equal(s.pieces[2].equipment.length, 0);
});
test('level mode consumes fixed-target growth as native levels, never badge equipment', () => {
  const p = piece('a', { growthMode: 'levels', growthLevel: 1 });
  const s = state({ growthMode: 'levels', pieces: [p] });
  grantEquipment(s, catalog, 'precision', 5, { origin: 'native', sourceUid: 'a' });
  assert.equal(p.growthLevel, 6); assert.equal(p.equipment.length, 0); assert.equal(s.inventory.length, 0);
  assert.equal(s.production[0].growthLevels, 5);
  assert.deepEqual(operatorGrowthInfo(p, catalog).stats,
    nativeLevelAttributes(catalog.operators[id].source.normalChess.nativeGrowth, catalog.operators[id].source.normalChess.status.phase, 6));
});
test('level hand resources preserve player choice and are consumed as real training', () => {
  const s = state({ growthMode: 'levels', pieces: [piece('a', { growthMode: 'levels', growthLevel: 1 }), piece('b', { growthMode: 'levels', growthLevel: 1 })] });
  grantEquipment(s, catalog, 'agility', 3, { origin: 'prize' });
  equipItem(s, catalog, s.inventory[0].uid, 'b', 3);
  assert.equal(s.pieces[0].growthLevel, 1); assert.equal(s.pieces[1].growthLevel, 4);
  assert.equal(s.pieces[1].equipment.length, 0); assert.equal(s.inventory.length, 0);
});
test('native level interpolation obeys real curve endpoints and individual caps', () => {
  for (const op of Object.values(catalog.operators).filter((x) => !x.elite && x.recruitable !== false)) {
    const raw = op.source.normalChess;
    const p = piece('a', { chessId: op.chessId, growthMode: 'levels', growthLevel: 1 });
    const info = operatorGrowthInfo(p, catalog);
    const ends = raw.nativeGrowth.phases[info.phase].attributesKeyFrames;
    assert.equal(info.stats.atk, ends[0].data.atk);
    p.growthLevel = 9999;
    assert.equal(operatorGrowthInfo(p, catalog).level, info.maximum);
    assert.equal(operatorGrowthInfo(p, catalog).stats.atk, ends.at(-1).data.atk);
  }
});
test('real battle and detail preview use the same level-scaled body', () => {
  const p = piece('a', { growthMode: 'levels', growthLevel: 20 });
  const s = { seed: 100, round: 1, difficulty: 'FUNNY', roundLimit: 9, growthMode: 'levels', pieces: [p] };
  const body = nativeBodyStats(p, catalog);
  const preview = previewUnitStats(s, { data, catalog });
  assert.equal(preview.a?.atk, body.atk);
  assert.equal(preview.a?.maxHp, body.maxHp);
});
test('new session preserves its selected growth mode and rejects unknown modes', () => {
  assert.equal(createSession({ seed: 2, growthMode: 'levels', data, catalog }).growthMode, 'levels');
  assert.equal(createSession({ seed: 2, data, catalog }).growthMode, 'badges');
  assert.throws(() => createSession({ growthMode: 'invalid', data, catalog }), /BAD_GROWTH_MODE/);
});
