import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { buildAssaultBattleInput, makeChessRecords } from '../../shared/assault/battle-input.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { latestOperatorKits } from '../../server/sim/content/assault/cards/latest-operators.js';
import { supportKits } from '../../server/sim/content/assault/cards/support.js';
import { supportTokenKits } from '../../server/sim/content/assault/cards/support-tokens.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
const loaded = getAssaultData({ runtime });
const design = loadAssaultDesign();
const kits = { ...assaultKits, ...latestOperatorKits, ...supportKits, ...supportTokenKits };
const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
const piece = (uid, charId, row = null, col = null) => ({
  uid, charId, purchaseCharId: runtime.bodies[charId].purchaseCharId, star: 4, sourceCopies: 1,
  row, col, dir: 'RIGHT', permanentFlat: {}, permanentPercent: {}, temporaryEnhancements: [], claimed: [],
  tagEdits: { add: [], remove: [] }, moduleChoices: {}, summonPresets: [],
});

function quietLogger() {
  return { warn() {}, error() {}, info() {}, log() {} };
}

function makeMlyssBattle() {
  const ownerPiece = piece('mlyss-owner', 'char_249_mlyss', 9, 2);
  const donorPiece = piece('mlyss-owned-offboard-template', 'char_1020_reed2');
  const state = { runId: 'mlyss-flow-same-cast', seed: 73201, rngState: 73201, life: 999, gold: 20,
    day: 1, hour: 1, pieces: [ownerPiece, donorPiece], relicIds: [], nextBattleEffects: [], teamGrowth: {} };
  const prepared = prepareAssaultBattle(state, encounter, { ...loaded, design, kits });
  const built = buildAssaultBattleInput(prepared, { ...loaded, kits });
  const offboard = makeChessRecords(runtime, [donorPiece], [], {}, prepared.input, 'assault');
  assert.equal(offboard.chess['assault:mlyss-owned-offboard-template'].assaultOwnerId, 'assault');
  assert.equal(offboard.chess['assault:mlyss-owned-offboard-template'].assaultPiece.row, null);
  assert.equal(offboard.chess['assault:mlyss-owned-offboard-template'].assaultPiece.col, null);
  const data = new DataSource({ ...built.data, chess: { ...built.data.chess, ...offboard.chess } }, getDefaultSource());
  const battle = new Battle({ ...built.battle, data,
    players: [{ playerId: 'assault', seat: 0, side: 'L', coords: 'board', units: built.units, bonds: {} }],
    logger: quietLogger() });
  battle.start();
  const owner = battle.allyUnits.find((unit) => unit.uid === ownerPiece.uid);
  const flow = battle.allyUnits.find((unit) => unit.kind === 'token' && unit.ownerUnit === owner && unit.defId === 'token_10030_mlyss_wtrman');
  assert.ok(owner?.alive && owner.deployed, `Mlyss is a real deployed owner in Battle: ${JSON.stringify({ players: built.battle.players, units: built.units, allies: battle.allyUnits.map((unit) => unit.uid), errors: battle.errors })}`);
  assert.ok(flow?.alive && flow.deployed, 'the native owned flowshape is deployed');
  const template = battle.data.getChess('assault:mlyss-owned-offboard-template');
  assert.equal(flow._mlyssTemplateUid, 'mlyss-owned-offboard-template');
  return { battle, owner, flow, template };
}

// 缪尔赛思: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-6.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
