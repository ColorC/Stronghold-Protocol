import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction, viewSession, matchStats } from '../../server/modes/independent/session.js';

const data = getData(); const catalog = getCatalog(data);
const lastBattle = (state) => state.history.filter((h) => h.type === 'battle').at(-1);
const leaking = (n) => () => ({ result: { reason: 'leaked', bossHpLeft: 1, perPlayer: { independent: { leaked: Array.from({ length: n }, () => ({ lpr: 1 })) } } },
  diagnostics: { capped: false }, pieceStates: {}, rewards: [] });

function readyPiece(state) {
  state.funds = 99;
  let out = applyAction(state, { type: 'buy', slot: state.shop.slots.findIndex((s) => s.id) }, { data, catalog });
  assert.equal(out.ok, true, out.error?.message); state = out.state;
  const p = state.pieces[0], cell = viewSession(state, { data, catalog }).pieces.find((x) => x.uid === p.uid).legalTiles[0];
  const [row, col] = cell.split(',').map(Number);
  out = applyAction(state, { type: 'move', uid: p.uid, row, col }, { data, catalog }); assert.equal(out.ok, true, out.error?.message);
  return out.state;
}

test('a round that leaks more than the remaining line records only the life actually lost', () => {
  const s = readyPiece(createSession({ seed: 913, roundLimit: 18 }));
  s.lp = 7;
  const r = applyAction(s, { type: 'ready' }, { data, catalog, battleRunner: leaking(10) });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(r.state.lp, 0);
  assert.equal(r.state.outcome, 'loss');
  assert.equal(lastBattle(r.state).lpLost, 7);
  assert.equal(r.state.totals.lpLostTotal, 7);
  assert.equal(matchStats(r.state).lpLost, 7);
});

test('an ordinary leaking round still costs min(per-round cap, leaks)', () => {
  const s = readyPiece(createSession({ seed: 913, roundLimit: 18 }));
  const start = s.lp;
  const r = applyAction(s, { type: 'ready' }, { data, catalog, battleRunner: leaking(3) });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(lastBattle(r.state).lpLost, 3);
  assert.equal(r.state.lp, start - 3);
  const capped = applyAction({ ...readyPiece(createSession({ seed: 913, roundLimit: 18 })) }, { type: 'ready' }, { data, catalog, battleRunner: leaking(25) });
  assert.equal(lastBattle(capped.state).lpLost, 10);
});
