import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { installRelics } from '../../server/sim/content/assault/relics.js';
import { grantSummon, ledgerFor, returnSummon } from '../../server/sim/content/assault/summons.js';
import { loadAssaultDesign } from '../../server/modes/assault/data.js';

const design = loadAssaultDesign();
const TOKEN = 'token_poetic_income_fixture';
const ENEMY = 'enemy_poetic_income_fixture';

function makeBattle({ playerId = 'p1', dpMax = 99, relic = true } = {}) {
  const ownerRows = [{ uid: `poetic-owner-${playerId}`, playerId, chessId: `chess_poetic_income_${playerId}`,
    charId: `char_poetic_income_${playerId}`, row: 10, col: 5 }];
  const chess = Object.fromEntries(ownerRows.map((owner) => [owner.chessId, chessRec({
    id: owner.chessId,
    charId: owner.charId,
    profession: 'SUPPORT',
    stats: { cost: 1 },
    skill: { skillId: `skill_${owner.charId}`, spCost: 30, initSp: 0, spType: 'INCREASE_WITH_TIME' },
  })]));
  const enemy = enemyRec({ key: ENEMY, hp: 100000, speed: 0, def: 0, res: 0, rangeRadius: 0 });
  const token = { tokenId: TOKEN, name: 'income fixture', profession: 'TOKEN', position: 'MELEE',
    stats: { maxHp: 300, atk: 20, def: 0, res: 0, cost: 0, blockCnt: 1, bat: 1, aspd: 100, respawnTime: 0, spRecovery: 0 },
    rangeGrid: [[0, 0]] };
  const data = new DataSource({ chess, enemies: { [ENEMY]: enemy }, tokens: { [TOKEN]: token } }, getDefaultSource());
  const kits = Object.fromEntries(ownerRows.map((owner) => [owner.charId, () => ({ skill: {
    id: `skill_${owner.charId}`, kind: 'instant', spCost: 30, trigger: 'SP_FULL', assaultCast() {},
  } })]));
  kits[TOKEN] = () => ({});
  const players = ownerRows.map((owner) => ({ playerId: owner.playerId,
    units: [{ uid: owner.uid, chessId: owner.chessId, row: owner.row, col: owner.col }] }));
  const prepared = { input: { relicIds: relic ? ['summon-poeticrelic'] : [], pieces: ownerRows.map(({ uid }) => ({ uid })), gold: 0 } };
  const battle = new Battle({ kind: 'normal', modeId: 'poetic-relic-income', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players, content: 'assault', assault: { kits, strict: true, install: (b) => installRelics(b, prepared, { design }) },
    flags: { dpInit: dpMax, dpPerSec: 0, dpMax, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60,
    quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  const liveOwners = ownerRows.map((owner) => battle.allyUnits.find((unit) => unit.uid === owner.uid));
  for (const player of battle.players) player.dp = 0;
  return { battle, owners: liveOwners };
}

function grant(battle, owner, { count, stockCap = 8, fieldCap = 8, cost = 0, ruleKey = 'fixture' }) {
  const result = grantSummon(battle, owner, { tokenId: TOKEN, count, stockCap, fieldCap, cost, anySource: true, ruleKey });
  battle.assaultRuntime.flush();
  return result;
}

test('first real summon entries return net DP to their actual owners, with one global six-point cap', () => {
  const { battle, owners: [owner] } = makeBattle({ dpMax: 99 });
  const result = grant(battle, owner, { count: 6, stockCap: 7, fieldCap: 7, ruleKey: 'six-entry-source' });
  assert.deepEqual(result, { granted: 6, spawned: 6, pending: 0, rejected: 0 });
  assert.equal(battle.getPlayer('p1').dp, 12);
  assert.equal(grant(battle, owner, { count: 1, stockCap: 7, fieldCap: 7, ruleKey: 'seventh-entry' }).spawned, 1);
  assert.equal(battle.getPlayer('p1').dp, 12, 'a seventh real entry receives no refund');
  assert.equal(ledgerFor(battle, owner).activeByKey.size, 7, 'the income cap does not change summon field capacity');
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
});

test('refund is credited to the real owning player, including non-p1 ownership', () => {
  const { battle, owners: [owner] } = makeBattle({ playerId: 'p2', dpMax: 99 });
  assert.equal(grant(battle, owner, { count: 1, stockCap: 1, fieldCap: 1, ruleKey: 'p2-owner' }).spawned, 1);
  assert.equal(owner.ownerId, 'p2');
  assert.equal(battle.getPlayer('p2').dp, 2);
  assert.equal(battle.getPlayer('p1'), null);
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
});

test('field/stock caps survive the relic and returned stock only refunds on a new real entry', () => {
  for (const relic of [false, true]) {
    const { battle, owners: [owner] } = makeBattle({ dpMax: 99, relic });
    const result = grant(battle, owner, { count: 2, stockCap: 2, fieldCap: 1, ruleKey: 'capped-source' });
    assert.deepEqual(result, { granted: 2, spawned: 1, pending: 1, rejected: 0 });
    const ledger = ledgerFor(battle, owner);
    assert.equal(ledger.activeByKey.size, 1);
    assert.equal(ledger.pending.length, 1);
    const live = [...ledger.activeByKey.values()][0].unit;
    assert.equal(returnSummon(battle, owner, live), true);
    battle.assaultRuntime.flush();
    assert.equal(ledger.activeByKey.size, 1, 'return retries the one stock-pending summon');
    assert.equal(ledger.pending.length, 0);
    assert.equal(ledger.stock.get(TOKEN), 1, 'the returned summon stays in stock while another summon occupies the field');
    assert.equal(battle.getPlayer('p1').dp, relic ? 4 : 0, 'only real spawned entries earn net DP');
    assert.equal(battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.ownerUnit === owner && unit.alive).length, 1);
    assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
  }
});

test('stock cap still rejects excess requests after the owned field cap is occupied', () => {
  const { battle, owners: [owner] } = makeBattle({ dpMax: 99 });
  assert.deepEqual(grant(battle, owner, { count: 2, stockCap: 2, fieldCap: 1, ruleKey: 'stock-cap-source' }),
    { granted: 2, spawned: 1, pending: 1, rejected: 0 });
  assert.deepEqual(grant(battle, owner, { count: 2, stockCap: 2, fieldCap: 1, ruleKey: 'stock-cap-source' }),
    { granted: 1, spawned: 0, pending: 1, rejected: 1 });
  assert.deepEqual(grant(battle, owner, { count: 1, stockCap: 2, fieldCap: 1, ruleKey: 'stock-cap-source' }),
    { granted: 0, spawned: 0, pending: 0, rejected: 1 });
  assert.equal(ledgerFor(battle, owner).activeByKey.size, 1);
  assert.equal(ledgerFor(battle, owner).pending.length, 2);
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
});

test('a full DP bar gives zero net income but still claims the real summon UID once', () => {
  const { battle, owners: [owner] } = makeBattle({ dpMax: 20 });
  const player = battle.getPlayer('p1');
  player.dp = 20;
  const result = grant(battle, owner, { count: 1, stockCap: 1, fieldCap: 1, ruleKey: 'full-bar' });
  assert.equal(result.spawned, 1);
  assert.equal(player.dp, 20, 'income is the net amount accepted by the DP cap');
  const state = battle._assaultRelicState;
  const effect = state.effectsByTrigger.get('summonSpawned').find(({ effect: entry }) => entry._relicId === 'summon-poeticrelic').effect;
  const token = [...ledgerFor(battle, owner).activeByKey.values()][0].unit;
  assert.equal(state.unitClaims.has(`${effect._key}:summon-entry:${token.uid ?? token.id}`), true,
    JSON.stringify({ uid: token.uid, id: token.id, claims: [...state.unitClaims], counts: [...state.counts] }));
  assert.equal(state.counts.get(`${effect._key}:battle`) ?? 0, 0, 'zero net does not consume one of six payable refunds');
  const repeat = grant(battle, owner, { count: 1, stockCap: 1, fieldCap: 1, ruleKey: 'full-bar' });
  assert.deepEqual(repeat, { granted: 1, spawned: 0, pending: 1, rejected: 0 }, 'field cap holds the pending entry without replaying the real entry');
  assert.equal(state.unitClaims.size, 1, 'the same already-entered UID is not claimed twice');
  assert.equal(battle.errors.length, 0, JSON.stringify(battle.errors));
});
