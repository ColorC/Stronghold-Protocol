// Owner 2026-10-07: 「装备不再有精锐形态」 — gear has one form only. The inventory's 合成精锐 (merge-item) is gone; an old
// save holding elite gear keeps it as the normal item with the same quantity (in the stock and on the operators), and
// stacks of the same item that this leaves side by side merge. An elite operator stays an elite operator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { independentDisplayCatalog } from '../../server/modes/independent/http.js';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const opts = { data, catalog };
const BADGE = 'precision';
/** A wearable non-unique piece of gear and a unique one from the catalog. */
const wearable = (unique) => Object.values(catalog.equipment).find((d) => d.available !== false && d.mechanism !== 'disabled' && d.mechanism !== 'badge'
  && !!d.unique === unique && ['战斗装备', '功能装备', '生产装备', 'equipment'].includes(d.kind));

function oldSave() {
  const state = createSession({ seed: 11, ...opts });
  const op = Object.values(catalog.operators).find((x) => !x.elite && !x.permitGearId);
  const common = wearable(false) || { id: BADGE }; const single = wearable(true);
  state.pieces.push({ uid: 'p1', chessId: op.chessId, elite: false, row: null, col: null, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', attachments: [], nativeState: {},
    equipment: [{ uid: 'w1', id: single.id, elite: true, quantity: 1, state: {} }, { uid: 'w2', id: BADGE, quantity: 3, state: {} }] });
  state.inventory.push(
    { uid: 'i101', id: common.id, quantity: 2, state: {} },
    { uid: 'i102', id: common.id, elite: true, quantity: 1, state: {} },
    { uid: 'i103', id: single.id, elite: true, quantity: 1, state: {} },
  );
  return { state, common, single };
}

test('an old save: elite gear becomes the normal item with the same quantity, stacks merge, a unique item stays separate', () => {
  const { state, common, single } = oldSave();
  const r = applyAction(state, { type: 'inspect', uid: 'p1' });
  assert.equal(r.ok, true, r.error?.message);
  const view = viewSession(state, opts);
  for (const s of [view, r.events[0].piece ? { inventory: view.inventory, pieces: view.pieces } : view]) {
    assert.ok(!s.inventory.some((x) => x.elite), 'no elite item in the stock');
    assert.ok(!s.pieces.flatMap((p) => p.equipment).some((x) => x.elite), 'no elite item on an operator');
  }
  // a state-changing action saves the normalised form
  const saved = applyAction(state, { type: 'freeze' });
  assert.equal(saved.ok, true, saved.error?.message);
  const stock = saved.state.inventory;
  assert.deepEqual(stock.filter((x) => x.id === common.id).map((x) => [x.uid, x.quantity, !!x.elite]), [['i101', 3, false]]);
  assert.deepEqual(stock.filter((x) => x.id === single.id).map((x) => [x.uid, x.quantity, !!x.elite]), [['i103', 1, false]]);
  const worn = saved.state.pieces.find((p) => p.uid === 'p1').equipment;
  assert.deepEqual(worn.filter((x) => x.id === single.id).map((x) => [x.uid, x.quantity, !!x.elite]), [['w1', 1, false]]);
  assert.equal(worn.find((x) => x.id === BADGE).quantity, 3);
  // the input state is untouched (the session owns the save)
  assert.equal(state.inventory.find((x) => x.uid === 'i102').elite, true);
});

test('merge-item is gone: not a legal action, refused when sent', () => {
  const { state, common } = oldSave();
  const view = viewSession(state, opts);
  assert.ok(!view.legalActions.includes('merge-item'));
  const r = applyAction(state, { type: 'merge-item', firstUid: 'i101', secondUid: 'i101' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UNKNOWN_ACTION');
  assert.equal(r.state.inventory.find((x) => x.uid === 'i101').quantity, 2, `${common.id} unchanged`);
});

test('the page catalog shows one form of every piece of gear (no elite text or level)', () => {
  const display = independentDisplayCatalog(data, catalog);
  for (const [id, g] of Object.entries(display.gear)) {
    assert.ok(!Object.hasOwn(g, 'elite'), `${id} has no elite text`);
    assert.ok(!Object.hasOwn(g, 'eliteLevel'), `${id} has no elite level`);
  }
  // an elite operator is operator data, not gear: it keeps both trait texts
  const op = Object.values(display.operators).find((x) => x.eliteChessId);
  assert.ok(op.traitTexts.elite != null);
});
