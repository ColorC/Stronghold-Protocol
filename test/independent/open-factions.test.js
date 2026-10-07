// Legacy open-faction helpers remain available; new sessions now open every configured faction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, validateSession, operatorOpen, pickOpenFactions, OPEN_FACTION_COUNT } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { TAVERN_FACTIONS, tavernFactions } from '../../shared/independentRules.js';

const catalog = getCatalog();
const ALL = Object.values(TAVERN_FACTIONS);
const ordinary = Object.values(catalog.operators).filter((op) => !op.elite && op.recruitable);
const factionsOf = (op) => tavernFactions({ chessId: op.chessId }, catalog);

test('new sessions open every faction and do not roll random bans', () => {
  assert.equal(OPEN_FACTION_COUNT, 5);
  assert.equal(createSession({ seed: 42, openFactions: ['炎'] }).openFactions, undefined, 'new-session faction bans are ignored');
  for (const seed of [1, 2, 3, 77, 821]) {
    const state = createSession({ seed });
    assert.equal(state.openFactions, undefined);
    assert.equal(Object.keys(state.pool).length, ordinary.length);
    assert.deepEqual(validateSession(state), []);
  }
});

test('the same seed opens the same factions; different seeds do not all open the same ones', () => {
  assert.equal(createSession({ seed: 42 }).openFactions, undefined);
  assert.equal(createSession({ seed: 43 }).openFactions, undefined);
  assert.equal(pickOpenFactions(42).length, OPEN_FACTION_COUNT, 'legacy helper still supports old callers');
  const picks = new Set(Array.from({ length: 8 }, (_, i) => pickOpenFactions(i + 1).join(',')));
  assert.ok(picks.size >= 2, `${[...picks]}`);
});

test('default pool holds every recruitable operator; legacy helper still models explicit faction sets', () => {
  for (const seed of [1, 5, 9, 1234]) {
    const state = createSession({ seed });
    for (const op of ordinary) {
      assert.ok(state.pool[op.chessId], `${op.name} is not randomly banned`);
    }
  }
  const multi = ordinary.find((op) => factionsOf(op).length > 1);
  assert.ok(multi, 'the roster has a multi-faction operator');
  const [a, b] = factionsOf(multi);
  assert.equal(operatorOpen(multi.chessId, catalog, [b]), true, 'one open faction is enough');
  assert.equal(operatorOpen(multi.chessId, catalog, [a]), true);
  assert.equal(operatorOpen(multi.chessId, catalog, ALL.filter((x) => x !== a && x !== b)), false);
  assert.equal(ordinary.some((op) => op.name === '锡人'), false, 'retired all-faction proxy is not in the active pool');
});

test('a save without openFactions keeps every faction; a bad openFactions is rejected', () => {
  for (const op of ordinary) assert.equal(operatorOpen(op.chessId, catalog, undefined), true, op.name);
  const old = createSession({ seed: 3 });
  delete old.openFactions;
  assert.deepEqual(validateSession(old), []);
  assert.ok(validateSession({ ...createSession({ seed: 3 }), openFactions: ['炎', '炎'] }).includes('BAD_OPEN_FACTIONS'));
  assert.ok(validateSession({ ...createSession({ seed: 3 }), openFactions: ['不存在'] }).includes('BAD_OPEN_FACTIONS'));
});

test('a fresh shop can show any faction operator', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const state = createSession({ seed });
    for (const slot of state.shop.slots.filter((x) => x.kind === 'chess' && x.id)) {
      assert.ok(catalog.operators[slot.id], `seed ${seed}: ${slot.id}`);
    }
  }
});
