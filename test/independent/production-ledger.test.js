import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction, viewSession, forecastPrepEnd } from '../../server/modes/independent/session.js';
import { recordProduction, PRODUCTION_ROUNDS_KEPT } from '../../server/modes/independent/equipment.js';
import { playSeed } from '../../tools/independent-balance.mjs';

const data = getData({ log: { info() {}, warn() {}, error() {} } });
const catalog = getCatalog(data);
const prepEndKey = (rows) => rows.filter((r) => r.phase === 'prepEnd').map((r) => `${r.sourceUid}:${r.id}x${r.quantity}`).sort().join(',');

test('every real ready forges exactly what the prep-end forecast said, and the forecast leaves the session untouched', () => {
  const game = playSeed({ seed: 1, route: 'defense', difficulty: 'FUNNY', roundLimit: 9 });
  let state = createSession({ seed: 1, difficulty: 'FUNNY', roundLimit: 9 });
  let forecastsWithOutput = 0;
  for (const action of game.actionLog) {
    if (action.type === 'ready') {
      const before = JSON.stringify(state);
      const forecast = forecastPrepEnd(state, data, catalog);
      assert.equal(JSON.stringify(state), before, 'the dry run must not touch the session, its RNG or revision');
      const result = applyAction(state, action, { data, catalog });
      assert.equal(result.ok, true);
      // a session gets its ledger with its first grant, which can come after the first ready
      const written = (result.state.production || []).filter((x) => x.revision === result.state.revision);
      assert.equal(prepEndKey(forecast.production), prepEndKey(written), `round ${state.round}`);
      if (forecast.production.length) forecastsWithOutput++;
      state = result.state;
    } else {
      const result = applyAction(state, action, { data, catalog });
      assert.equal(result.ok, true);
      state = result.state;
    }
  }
  assert.ok(forecastsWithOutput >= 3, 'the pilot game must exercise prep-end forging');
  assert.equal(viewSession(state, { data, catalog }).forecast, null, 'a finished session has no prep to forecast');
});

test('ledger rows name their source, phase and the revision that wrote them; only two rounds are kept', () => {
  const game = playSeed({ seed: 2, route: 'assault', difficulty: 'NORMAL', roundLimit: 14 });
  const rows = game.state.production;
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(row.round >= game.state.round - PRODUCTION_ROUNDS_KEPT + 1);
    assert.ok(Number.isInteger(row.revision) && row.revision <= game.state.revision);
    assert.ok(typeof row.phase === 'string' && row.phase.length);
    if (row.origin === 'native') assert.match(row.sourceUid, /^p\d+$/);
  }
  assert.ok(rows.some((r) => r.phase === 'battle'), 'battle rewards are in the ledger');
  const state = { round: 5, revision: 7, production: [{ round: 3, revision: 1, id: 'precision', quantity: 1 }, { round: 4, revision: 2, id: 'precision', quantity: 1 }] };
  recordProduction(state, { id: 'agility', quantity: 2, origin: 'shop', phase: 'shop', copied: false });
  assert.deepEqual(state.production.map((x) => x.round), [4, 5]);
  assert.deepEqual(state.production[1], { round: 5, revision: 8, id: 'agility', quantity: 2, origin: 'shop', phase: 'shop' });
});
