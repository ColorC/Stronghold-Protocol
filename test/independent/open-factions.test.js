// 每局只开部分阵营 (干员特质 v4, 2026-10-07): a session opens 5 of the 8 阵营 from its seed, like Battlegrounds opens 5
// tribes a game. Operators without a faction are always in the pool, a multi-faction operator is in when any of its
// factions is open, 锡人 is always in, and a save from before (no openFactions) keeps every faction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, validateSession, operatorOpen, pickOpenFactions, OPEN_FACTION_COUNT } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { TAVERN_FACTIONS, tavernFactions } from '../../shared/independentRules.js';

const catalog = getCatalog();
const ALL = Object.values(TAVERN_FACTIONS);
const ordinary = Object.values(catalog.operators).filter((op) => !op.elite);
const factionsOf = (op) => tavernFactions({ chessId: op.chessId }, catalog);

test('a session opens 5 distinct known factions, in the fixed faction order', () => {
  assert.equal(OPEN_FACTION_COUNT, 5);
  for (const seed of [1, 2, 3, 77, 821]) {
    const state = createSession({ seed });
    assert.equal(state.openFactions.length, 5);
    assert.equal(new Set(state.openFactions).size, 5);
    assert.ok(state.openFactions.every((f) => ALL.includes(f)));
    assert.deepEqual(state.openFactions, ALL.filter((f) => state.openFactions.includes(f)), 'listed in TAVERN_FACTIONS order');
    assert.deepEqual(validateSession(state), []);
  }
});

test('the same seed opens the same factions; different seeds do not all open the same ones', () => {
  assert.deepEqual(createSession({ seed: 42 }).openFactions, createSession({ seed: 42 }).openFactions);
  assert.deepEqual(pickOpenFactions(42), createSession({ seed: 42 }).openFactions);
  const picks = new Set(Array.from({ length: 8 }, (_, i) => pickOpenFactions(i + 1).join(',')));
  assert.ok(picks.size >= 2, `${[...picks]}`);
});

test('the pool holds the open operators only: no closed-faction operator, every no-faction one, 锡人, open multi-faction ones', () => {
  for (const seed of [1, 5, 9, 1234]) {
    const state = createSession({ seed });
    const open = new Set(state.openFactions);
    for (const op of ordinary) {
      const f = factionsOf(op);
      const inPool = Boolean(state.pool[op.chessId]);
      if (op.name === '锡人' || !f.length) assert.ok(inPool, `${op.name} (no faction / all factions) is always in`);
      else assert.equal(inPool, f.some((x) => open.has(x)), `${op.name} ${f.join('/')} with ${[...open].join('、')}`);
    }
  }
  const multi = ordinary.find((op) => factionsOf(op).length > 1);
  assert.ok(multi, 'the roster has a multi-faction operator');
  const [a, b] = factionsOf(multi);
  assert.equal(operatorOpen(multi.chessId, catalog, [b]), true, 'one open faction is enough');
  assert.equal(operatorOpen(multi.chessId, catalog, [a]), true);
  assert.equal(operatorOpen(multi.chessId, catalog, ALL.filter((x) => x !== a && x !== b)), false);
  const tin = ordinary.find((op) => op.name === '锡人');
  assert.equal(operatorOpen(tin.chessId, catalog, []), true, '锡人 counts as every faction');
});

test('a save without openFactions keeps every faction; a bad openFactions is rejected', () => {
  for (const op of ordinary) assert.equal(operatorOpen(op.chessId, catalog, undefined), true, op.name);
  const old = createSession({ seed: 3 });
  delete old.openFactions;
  assert.deepEqual(validateSession(old), []);
  assert.ok(validateSession({ ...createSession({ seed: 3 }), openFactions: ['炎', '炎'] }).includes('BAD_OPEN_FACTIONS'));
  assert.ok(validateSession({ ...createSession({ seed: 3 }), openFactions: ['不存在'] }).includes('BAD_OPEN_FACTIONS'));
});

test('a fresh shop shows open operators only', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const state = createSession({ seed });
    for (const slot of state.shop.slots.filter((x) => x.kind === 'chess' && x.id)) {
      assert.ok(operatorOpen(slot.id, catalog, state.openFactions), `seed ${seed}: ${catalog.operators[slot.id]?.name}`);
    }
  }
});
