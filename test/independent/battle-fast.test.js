import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runIndependentBattle } from '../../server/modes/independent/battle.js';

const DATA = getData();
const CHESS_ID = 'chess_char_1_02_a';

test('recording=false runs the authoritative wave without snapshots, samples, event drains, or Darkmoon trace storage', () => {
  const baseCatalog = getCatalog(DATA);
  const sourceOperator = baseCatalog.operators[CHESS_ID];
  const catalog = {
    ...baseCatalog,
    operators: {
      ...baseCatalog.operators,
      [CHESS_ID]: {
        ...sourceOperator,
        nativeTrait: { effect: { combat: [{
          trigger: 'deploy',
          behavior: 'eventProduction',
          params: { counterEvent: 'deploy', counterEvery: 1, outputs: [{ id: 'precision', quantity: 2 }], maxPerBattle: 4, filter: { actor: 'self' } },
        }] } },
        sourceRefs: { ...sourceOperator.sourceRefs, darkmoon19_2: { ...sourceOperator.sourceRefs?.darkmoon19_2, id: 'BGS_019' } },
      },
    },
  };
  const input = {
    seed: 73,
    difficulty: 'FUNNY',
    roundLimit: 9,
    round: 1,
    pieces: [{ uid: 'u1', chessId: CHESS_ID, row: 9, col: 2, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', equipment: [], attachments: [], nativeState: {} }],
  };
  const before = structuredClone(input);
  const proto = Battle.prototype;
  const original = { snapshot: proto.snapshot, fieldMeta: proto.fieldMeta, drainEvents: proto.drainEvents, emit: proto.emit };
  let darkmoonEmits = 0;
  for (const method of ['snapshot', 'fieldMeta', 'drainEvents']) {
    proto[method] = function forbiddenRecordingPath() { throw new Error(`recording=false called Battle.${method}`); };
  }
  proto.emit = function observeDarkmoonEmit(name, context) {
    if (name === 'darkmoonEffect') darkmoonEmits++;
    return original.emit.call(this, name, context);
  };
  let out;
  try {
    out = runIndependentBattle(input, { data: DATA, catalog, recording: false });
  } finally {
    proto.snapshot = original.snapshot;
    proto.fieldMeta = original.fieldMeta;
    proto.drainEvents = original.drainEvents;
    proto.emit = original.emit;
  }

  assert.deepEqual(input, before, 'battle projection does not mutate caller state');
  assert.equal(out.diagnostics.errorCount, 0, JSON.stringify(out.diagnostics.errors));
  assert.ok(out.result.total > 0, 'the native wave still spawns enemies');
  assert.ok(out.result.perPlayer.independent.unitStats[0].attacks > 0, 'the actual operator kit continues attacking');
  assert.deepEqual(out.rewards, [{ id: 'precision', quantity: 2, origin: 'native', sourceUid: 'u1' }], 'combat hooks still produce authoritative rewards');
  assert.ok(darkmoonEmits > 0, 'Darkmoon note suppresses only trace storage; its Battle.emit hook still runs');
  assert.equal(out.replay, null);
  assert.deepEqual(out.samples, []);
  assert.deepEqual(out.darkmoonTrace, []);
  assert.ok(out.result.perPlayer.independent.unitStats[0].attacks > 0, 'authoritative result counters remain available');
});
