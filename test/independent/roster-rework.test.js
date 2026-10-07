import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { getIndependentField, runIndependentBattle } from '../../server/modes/independent/battle.js';
import { canPlace, positionClass } from '../../server/match/board.js';
import { matchesInheritancePermission, nativeFactions, tavernFactions } from '../../shared/independentRules.js';

const DATA = getData();
const REPO_DATA_DESIGN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/independent-design.json');
const DESIGN_PATH = path.resolve(process.env.SP_INDEPENDENT_DESIGN_PATH || REPO_DATA_DESIGN);
const DESIGN = JSON.parse(readFileSync(DESIGN_PATH, 'utf8'));
const CATALOG = getCatalog(DATA);
const ACTIVE_IDS = [...DESIGN.rules.activeRosterIds];
const ACTIVE_SET = new Set(ACTIVE_IDS);
const BATTLE_RECEIPTS = [];
const EXPECTED_TIERS = { 1: 13, 2: 19, 3: 20, 4: 18, 5: 18, 6: 13 };
const EXPECTED_ROLES = { '临时战斗': 10, '成长': 54, '联动': 10, '经济': 5, '生成': 18, '一次性工具': 4 };
const PRODUCED_GEAR = ['坚守盟约','护盾发生器','突袭盟约','巨锤盟约','精准盟约','不屈盟约','爆破部署台','反冲空降仓','便携式融毁教学仪'];

function tally(list, key) {
  return Object.fromEntries([...list.reduce((m, x) => m.set(String(key(x)), (m.get(String(key(x))) || 0) + 1), new Map())].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')));
}

function fillReport() {
  const target = process.env.SP_VALIDATION_RESULT_PATH;
  if (!target) return;
  mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  writeFileSync(path.resolve(target), JSON.stringify({
    baseCommit: '9d4c79c6b8087dad21a1f91d0690c9ffde3bfc1c',
    candidatePath: path.resolve(DESIGN_PATH),
    rosterCount: ACTIVE_IDS.length,
    tierCounts: tally(ACTIVE_IDS.map((id) => CATALOG.operators[id]), (x) => x.tier),
    roleCounts: tally(ACTIVE_IDS.map((id) => DESIGN.operators.find((op) => op.chessId === id)), (x) => x.roster),
    battleExpected: ACTIVE_IDS.length * 2,
    battleCompleted: BATTLE_RECEIPTS.length,
    battleComplete: BATTLE_RECEIPTS.length === ACTIVE_IDS.length * 2,
    battles: BATTLE_RECEIPTS,
  }, null, 2), 'utf8');
}
after(fillReport);

test('the compiled roster has 101 unique bodies and the approved tier/role structure', () => {
  assert.equal(ACTIVE_IDS.length, 101);
  assert.equal(ACTIVE_SET.size, 101);
  const sources = ACTIVE_IDS.map((id) => DESIGN.operators.find((op) => op.chessId === id));
  assert.ok(sources.every(Boolean));
  assert.equal(new Set(sources.map((op) => op.charId)).size, 101, 'each selected chess maps to a distinct character');
  assert.deepEqual(tally(sources, (op) => op.tier), EXPECTED_TIERS);
  assert.deepEqual(tally(sources, (op) => op.roster), EXPECTED_ROLES);
  for (const op of sources) {
    assert.deepEqual(Object.keys(op.modeEffects || {}).sort(), ['elite', 'normal'], `${op.name} authors ordinary and elite rules`);
    assert.ok(op.nativeTrait?.normal?.trim() && op.nativeTrait?.elite?.trim(), `${op.name} has ordinary and elite trait text`);
    assert.ok(!/白板|无(?:额外)?特质|没有(?:额外)?特质|凭自身技能作战|纯战斗/.test(`${op.nativeTrait.normal} ${op.nativeTrait.elite}`), `${op.name} is not a blank-trait placeholder`);
    assert.ok(op.sourceRefs?.traitRevision || op.sourceRefs?.basis, `${op.name} has a design basis/source reference`);
    for (const form of ['normal', 'elite']) {
      assert.ok(Array.isArray(op.modeEffects[form].prep));
      assert.ok(Array.isArray(op.modeEffects[form].combat));
      assert.ok(op.modeEffects[form].prep.length + op.modeEffects[form].combat.length > 0, `${op.name} ${form} has a configured mode effect`);
      const registered = CATALOG.operators[form === 'elite' ? CATALOG.operators[op.chessId].eliteChessId : op.chessId].nativeTrait.effect;
      assert.deepEqual(registered.unsupported, [], `${op.name} ${form} has no unsupported rules`);
    }
  }
  const highTier = sources.filter((op) => op.tier >= 5);
  assert.equal(highTier.length, 31);
  for (const op of highTier) assert.ok(op.role?.trim() && !/定位待定|待补|暂无/.test(op.role), `${op.name} T${op.tier} has a concrete role rationale`);
});

test('each of the nine core supply gears has at least one active normal or elite producer', () => {
  for (const name of PRODUCED_GEAR) {
    const gearId = `independent:${name}`;
    assert.ok(CATALOG.equipment[gearId], `${gearId} is registered`);
    const producers = ACTIVE_IDS.filter((id) => {
      const op = DESIGN.operators.find((candidate) => candidate.chessId === id);
      return ['normal', 'elite'].some((form) => JSON.stringify(op.modeEffects[form]).includes(gearId));
    });
    assert.ok(producers.length > 0, `${gearId} has an active-roster producer`);
  }
});

test('锡人 proxy covers the configured 32 tavern factions without changing native Colombia or inheritance identity', () => {
  const tinmanId = ACTIVE_IDS.find((id) => DESIGN.operators.find((op) => op.chessId === id)?.name === '锡人');
  assert.ok(tinmanId);
  assert.equal(CATALOG.operators[tinmanId].tavernFactionProxy, 'ALL');
  assert.deepEqual(CATALOG.operators[tinmanId].nativeFactionTags, ['哥伦比亚']);
  const piece = { chessId: tinmanId, equipment: [] };
  assert.equal(CATALOG.config.tavernFactions.length, 32);
  assert.equal(tavernFactions(piece, CATALOG).length, 32);
  assert.deepEqual(nativeFactions(piece, CATALOG), ['哥伦比亚']);
  assert.equal(matchesInheritancePermission({ donorFaction: '哥伦比亚' }, 'donor', piece, CATALOG), true);
  assert.equal(matchesInheritancePermission({ donorFaction: '拉特兰' }, 'donor', piece, CATALOG), false);
});

test('20 seeds use one exact 101-ID pool, have no random faction ban, and never show inactive shop/reward candidates', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const state = createSession({ data: DATA, catalog: CATALOG, seed });
    assert.equal(state.openFactions, undefined);
    assert.deepEqual(Object.keys(state.pool).sort(), [...ACTIVE_IDS].sort());
    assert.ok(state.shop.slots.every((slot) => !slot.id || ACTIVE_SET.has(slot.id)));
  }

  const tripleSource = DESIGN.operators.find((op) => ACTIVE_SET.has(op.chessId) && op.name === '红豆');
  assert.ok(tripleSource, 'the merge fixture uses a named active operator');
  let state = createSession({ data: DATA, catalog: CATALOG, seed: 909 });
  state.funds = 100;
  const slot = state.shop.slots.findIndex((x) => x.kind === 'chess');
  for (let copy = 0; copy < 3; copy++) {
    state.shop.slots[slot] = { kind: 'chess', id: tripleSource.chessId, elite: false, price: 3, sold: false, equipment: [] };
    const result = applyAction(state, { type: 'buy', slot }, { data: DATA, catalog: CATALOG });
    assert.equal(result.ok, true, result.error?.message);
    state = result.state;
  }
  const promotion = state.offers.find((offer) => offer.type === 'recruit' && offer.source === 'merge');
  assert.ok(promotion, 'three-copy merge produced its normal recruitment reward');
  assert.ok(promotion.choices.every((id) => ACTIVE_SET.has(id)), 'promotion reward contains active-roster IDs only');
});

test('every selected body in normal and elite form runs through the real Battle on a legal field tile', { timeout: 900_000 }, () => {
  let serial = 0;
  for (const baseId of ACTIVE_IDS) {
    const source = CATALOG.operators[baseId];
    for (const elite of [false, true]) {
      const chessId = elite ? source.eliteChessId : baseId;
      assert.ok(DATA.chess[chessId], `${chessId} resolves to an upstream body`);
      let state = createSession({ data: DATA, catalog: CATALOG, seed: 30_000 + serial });
      state.funds = 100;
      state.round = 1;
      state.roundLimit = 9;
      state.difficulty = 'FUNNY';
      const slot = state.shop.slots.findIndex((x) => x.kind === 'chess');
      const copies = elite ? 3 : 1;
      for (let copy = 0; copy < copies; copy++) {
        state.shop.slots[slot] = { kind: 'chess', id: baseId, elite: false, price: 3, sold: false, equipment: [] };
        const bought = applyAction(state, { type: 'buy', slot }, { data: DATA, catalog: CATALOG });
        assert.equal(bought.ok, true, `${source.name} ${elite ? 'elite' : 'normal'} purchase: ${bought.error?.message}`);
        state = bought.state;
      }
      const piece = state.pieces.find((x) => x.chessId === chessId);
      assert.ok(piece, `${chessId} exists as a purchased native piece`);
      const field = getIndependentField(state, { data: DATA, catalog: CATALOG });
      const placement = positionClass(DATA.chess[chessId]);
      const tile = [...field.deployMap.keys()].map((key) => key.split(',').map(Number)).find(([row, col]) => canPlace(field.deployMap, placement, row, col));
      assert.ok(tile, `${chessId} has at least one legal tile on its actual wave field`);
      [piece.row, piece.col] = tile;
      const input = structuredClone(state);
      const beforeBattle = structuredClone(input);
      const out = runIndependentBattle(input, { data: DATA, catalog: CATALOG });
      assert.deepEqual(input, beforeBattle, `${chessId} battle input was not mutated`);
      assert.equal(out.diagnostics.errorCount, 0, `${chessId} simulation/content errors`);
      assert.equal(out.diagnostics.kind, 'normal');
      assert.ok(out.result.perPlayer.independent.unitStats.some((unit) => unit.defId === chessId), `${chessId} used its real native body/kit`);
      for (const reward of out.rewards) {
        assert.ok(Number.isInteger(reward.quantity) && reward.quantity > 0, `${chessId} reward has a positive integral quantity`);
        assert.ok(CATALOG.equipment[reward.id] || CATALOG.badges[reward.id], `${chessId} reward ${reward.id} is registered`);
        assert.ok(['native', 'equipment'].includes(reward.origin), `${chessId} reward has a registered source category`);
        assert.equal(reward.sourceUid, piece.uid, `${chessId} reward is attributed to its producer`);
      }
      BATTLE_RECEIPTS.push({ chessId, form: elite ? 'elite' : 'normal', ticks: out.diagnostics.ticks, capped: out.diagnostics.capped, reason: out.result.reason, attacks: out.result.perPlayer.independent.unitStats.find((unit) => unit.defId === chessId)?.attacks || 0, rewardCount: out.rewards.length });
      serial++;
      if (serial % 10 === 0) fillReport();
    }
  }
  assert.equal(BATTLE_RECEIPTS.length, 202);
});
