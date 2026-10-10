import test from 'node:test';
import assert from 'node:assert/strict';
import { getData, resetData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';

test('default session catalog is shared and deeply immutable through a public view', () => {
  const state = createSession({ seed: 821 });
  const first = viewSession(state).catalog;
  const gear = first.equipment['growth-training-record'];
  assert.ok(Object.isFrozen(first.equipment));
  assert.ok(Object.isFrozen(gear));
  assert.ok(Object.isFrozen(gear.params));
  assert.throws(() => { gear.params.levels = 900; }, TypeError);
  assert.throws(() => { first.equipment['growth-training-record'] = {}; }, TypeError);
  const next = viewSession(state).catalog;
  assert.equal(next.equipment, first.equipment);
  assert.equal(next.equipment['growth-training-record'].params.levels, 1);
  const bought = applyAction(state, { type: 'buy', slot: state.shop.slots.findIndex(x => x.kind === 'chess' && x.id) });
  assert.equal(bought.ok, true, bought.error?.message);
  assert.equal(viewSession(bought.state).catalog.equipment, first.equipment);
});

test('explicit custom catalog keeps caller identity and mutations isolated from the default', () => {
  const state = createSession({ seed: 92 });
  const baseline = viewSession(state).catalog;
  const catalog = getCatalog();
  catalog.equipment['growth-training-record'].params.levels = 2;
  assert.equal(viewSession(state, { catalog }).catalog.equipment, catalog.equipment);
  catalog.equipment['growth-training-record'].params.levels = 3;
  assert.equal(viewSession(state, { catalog }).catalog.equipment['growth-training-record'].params.levels, 3);
  assert.equal(Object.isFrozen(catalog.equipment), false);
  assert.equal(viewSession(state).catalog.equipment, baseline.equipment);
  assert.equal(baseline.equipment['growth-training-record'].params.levels, 1);
});

test('explicit custom data rebuilds catalog after edits and does not reuse or freeze caller input', () => {
  const data = structuredClone(getData());
  const offered = createSession({ seed: 3, data });
  const bought = applyAction(offered, { type: 'buy', slot: offered.shop.slots.findIndex(x => x.kind === 'chess' && x.id) }, { data });
  assert.equal(bought.ok, true, bought.error?.message);
  const state = bought.state;
  const first = viewSession(state, { data });
  const id = state.pieces[0].chessId;
  assert.ok(data.chess[id], 'fixture uses the recruited native operator source');
  data.chess[id].skills = { ...data.chess[id].skills, cacheRegression: { value: 'custom skill' } };
  const next = viewSession(state, { data });
  assert.notEqual(next.catalog.equipment, first.catalog.equipment);
  assert.equal(next.pieces[0].skills.cacheRegression.value, 'custom skill');
  assert.equal(first.pieces[0].skills.cacheRegression, undefined);
  assert.equal(Object.isFrozen(data.chess[id]), false);
  assert.equal(Object.isFrozen(next.catalog.equipment), false);
  assert.equal(viewSession(state).pieces[0].skills.cacheRegression, undefined);
});

test('default catalog follows the new native data object after resetData', () => {
  const original = getData();
  const first = viewSession(createSession({ seed: 17 })).catalog;
  resetData();
  try {
    assert.notEqual(getData(), original);
    const next = viewSession(createSession({ seed: 17 })).catalog;
    assert.notEqual(next.equipment, first.equipment);
    assert.ok(Object.isFrozen(next.equipment['growth-training-record'].params));
    assert.deepEqual(next.equipment, first.equipment);
  } finally { resetData(); }
});
