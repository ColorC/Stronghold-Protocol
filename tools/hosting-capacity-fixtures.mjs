import { createSession, applyAction, viewSession } from '../server/modes/independent/session.js';
import { getCatalog } from '../server/modes/independent/catalog.js';

function options(data) { return { data, catalog: getCatalog(data) }; }

function nextAction(state, defs) {
  if (state.phase === 'prize') return { type: 'choose', offerId: state.offers[0].id, index: 0 };
  if (state.phase !== 'prep') return null;
  const view = viewSession(state, defs);
  const occupied = new Set(state.pieces.filter((p) => p.row != null).map((p) => `${p.row},${p.col}`));
  for (const piece of view.pieces) {
    if (piece.row != null) continue;
    const tile = piece.legalTiles.find((entry) => !occupied.has(entry));
    if (tile) {
      const [row, col] = tile.split(',').map(Number);
      return { type: 'move', uid: piece.uid, row, col };
    }
  }
  const slot = state.shop.slots.findIndex((entry) => entry.kind === 'chess' && entry.id && !entry.sold);
  if (slot >= 0 && state.funds >= 3 && state.pieces.length < 8) return { type: 'buy', slot };
  return { type: 'ready' };
}

export function createCapacityFixtures(data, seed = 20261007) {
  const defs = options(data);
  let state = createSession({ seed, difficulty: 'NORMAL', roundLimit: 9, ...defs });
  state = { ...state, funds: Math.max(state.funds, 30), lp: 100_000 };
  const early = structuredClone(state);
  let actions = 0;
  while (!(state.round === 9 && state.phase === 'prep') && actions++ < 300) {
    const action = nextAction(state, defs);
    if (!action) throw new Error(`No fixture action at round=${state.round}, phase=${state.phase}`);
    const result = applyAction(state, action, defs);
    if (!result.ok) throw new Error(`Fixture action failed (${action.type}): ${result.error?.code || 'unknown'}`);
    state = result.state;
  }
  if (state.round !== 9 || state.phase !== 'prep') throw new Error('Unable to produce a round-9 checkpoint fixture');
  const late = structuredClone(state);
  for (const fixture of [early, late]) fixture.revision = 0;
  return { early, late, seed, actionsToRoundNine: actions - 1 };
}
