// Shared engine pieces of the bazaar-style rewrite: card-relative positions
// (front / sides), the unified device trigger on the runtime stream, and the
// card numbers compiled into the runtime DTO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec } from '../helpers/battleHarness.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { getAssaultData } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { allies, enemies, watch } from '../../server/sim/content/assault/primitives.js';

const runtimeData = loadAssaultRuntime();
getAssaultData({ runtime: runtimeData });
const passiveKit = () => ({ skill: { id: 'fixture-bazaar-engine', kind: 'instant', spCost: 99, spType: 'none', assaultCast: () => false, canCast: () => false } });

function card(uid, charId, { row, col, dir = 'RIGHT', star = 4 }) {
  const body = runtimeData.bodies[charId];
  const piece = { uid, charId, star, fixedSkill: body.fixedSkill, moduleId: null, moduleChoices: {}, sourceCopies: 1,
    permanentFlat: {}, permanentPercent: {}, claimed: [], tagEdits: { add: [], remove: [] } };
  const chess = chessRec({ id: `chess:${uid}`, charId, profession: body.profession, position: body.position,
    subProf: body.subProfessionId, stats: body.starStats[star - 1].stats, rangeGrid: body.range });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  return { uid, chess, row, col, dir };
}

function makeBattle(cards) {
  const ids = [...new Set(cards.map((entry) => entry.chess.charId ?? entry.chess.assaultPiece.charId))];
  const kits = Object.fromEntries(ids.map((id) => [id, passiveKit]));
  const data = new DataSource({ chess: Object.fromEntries(cards.map((entry) => [entry.chess.chessId, entry.chess])), enemies: {}, tokens: {} }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: 'assault-bazaar-engine', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: cards.map((entry) => ({ uid: entry.uid, chessId: entry.chess.chessId, row: entry.row, col: entry.col, dir: entry.dir, abs: true })) }],
    content: 'assault', assault: { kits: { ...assaultKits, ...kits }, strict: true },
    flags: { dpInit: 999, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  battle.assaultRuntime.flush();
  return { battle, units: Object.fromEntries(cards.map((entry) => [entry.uid, battle.allyUnits.find((unit) => unit.uid === entry.uid)])) };
}

const ids = Object.keys(runtimeData.bodies).filter((id) => runtimeData.bodies[id].fixedSkill?.kind !== 'passive' && runtimeData.bodies[id].position === 'MELEE').slice(0, 1);

test('front and sides follow the deployed facing: one tile ahead, and the left/right hand tiles', () => {
  const [id] = ids;
  const setup = makeBattle([
    card('center', id, { row: 10, col: 5, dir: 'RIGHT' }), card('ahead', id, { row: 10, col: 6 }),
    card('up', id, { row: 11, col: 5 }), card('down', id, { row: 9, col: 5 }), card('behind', id, { row: 10, col: 4 }),
  ]);
  const { battle, units } = setup;
  for (const [name, unit] of Object.entries(units)) assert.ok(unit?.deployed, `fixture unit ${name} is deployed (${unit?.tileR},${unit?.tileC})`);
  const names = (list) => list.map((unit) => unit.uid).sort();
  assert.equal(units.center.dir, 'RIGHT');
  assert.deepEqual(names(allies(battle, units.center, { scope: 'front', count: 9, selection: 'uid' })), ['ahead']);
  assert.deepEqual(names(allies(battle, units.center, { scope: 'sides', count: 9, selection: 'uid' })), ['down', 'up']);
  units.center.dir = 'UP';
  assert.deepEqual(names(allies(battle, units.center, { scope: 'front', count: 9, selection: 'uid' })), ['up'], 'facing UP: the tile above is in front');
  assert.deepEqual(names(allies(battle, units.center, { scope: 'sides', count: 9, selection: 'uid' })), ['ahead', 'behind']);
  units.center.dir = 'LEFT';
  assert.deepEqual(names(allies(battle, units.center, { scope: 'front', count: 9, selection: 'uid' })), ['behind']);
  assert.deepEqual(enemies(battle, units.center, { scope: 'front', count: 9 }), [], 'enemy selector accepts the same scope');
});

test('every device trigger reaches the runtime stream once with its owner, for any card to watch', () => {
  const [id] = ids;
  const setup = makeBattle([card('owner', id, { row: 10, col: 5 }), card('watcher', id, { row: 10, col: 7 })]);
  const { battle, units } = setup;
  const seen = [];
  watch(battle, units.watcher, 'deviceTrigger', 'fixture:device', () => true, ({ payload }) => seen.push(payload));
  battle.emit('deviceTrigger', { source: units.owner, sourceUid: units.owner.uid, target: null, targetUid: null, device: { uid: 'trap' } });
  battle.assaultRuntime.flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].source, units.owner);
  assert.equal(seen[0].ownerId, units.owner.ownerId);
  assert.equal(seen[0].sourceClass, 'device');
});

test('card lines compile one four-star param source into the runtime DTO and the skill cost', () => {
  for (const [id, body] of Object.entries(runtimeData.bodies)) {
    assert.ok(body.bazaar && Array.isArray(body.bazaar.lines) && body.bazaar.lines.length >= 1, `${id} bazaar lines`);
    for (const line of body.bazaar.lines) for (const values of Object.values(line.params)) assert.equal(values.length, 4, `${id} params`);
    if (body.fixedSkill.kind !== 'passive') {
      assert.deepEqual(body.bazaar.sp, body.fixedSkill.spCosts, `${id} card cost is the real cost`);
      const sp = body.bazaar.sp;
      assert.ok(sp.every((x, i) => i === 0 || x <= sp[i - 1]) || sp.every((x, i) => i === 0 || x >= sp[i - 1]), `${id} cost tiers are ordered`);
    }
  }
  assert.deepEqual(runtimeData.bodies.char_240_wyvern.bazaar.sp, [16,16,16,16], 'Vanilla uses the fixed medium SP tier at every star');
  assert.deepEqual(runtimeData.bodies.char_128_plosis.bazaar.sp, [35, 35, 35, 35]);
});
