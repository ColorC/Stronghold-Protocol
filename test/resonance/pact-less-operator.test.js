import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { getResonanceField } from '../../server/modes/resonance/battle.js';
import { ResonanceMatch } from '../../server/modes/resonance/native-match.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { ERR, ERR_TEXT } from '../../shared/constants.js';
import { carriesPact, equipRefusal, pactRefusal } from '../../public/js/resonance/equipmentSlots.js';

const NATIVE_DATA = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const data = loadData(NATIVE_DATA);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const JNIGHT = 'chess_native_char_4000_jnight_a', GRAVEL = 'chess_char_2_12_a';   // 正义骑士号, 砾
const catalog = getResonanceCatalog(data, { rulesVersion: 3, seasonId: 'resonance-factions-2', seed: 5 });
// an emblem that two components make (随身身份牌 + a component), so it can also be completed in place
const emblemRecipe = catalog.recipes.find((recipe) => recipe.parts?.length === 2 && catalog.equipment[recipe.resultId]?.kind === 'emblem');
const emblem = catalog.equipment[emblemRecipe.resultId];
const ordinaryItem = Object.values(catalog.equipment).find((item) => item.kind === 'completed');

/** Level-5 prep session: the knight and `others` ordinary operators on the field, with a few loose items. */
function scenario(others = 2) {
  const created = createSession({ seed: 5, difficulty: 'NORMAL', catalog });
  assert.equal(created.ok, true, created.error);
  let state = created.state;
  for (const piece of state.pieces) state.poolRemaining[piece.operatorId] += ({ 1: 1, 2: 3, 3: 9 })[piece.star];
  state.pieces = []; state.level = 5; state.phase = 'prep'; state.nodeStarted = true;
  const field = getResonanceField(state, { data, catalog });
  const options = { catalog, fieldResolver: () => field, recording: false };
  const cells = [...field.deployMap.entries()].filter(([, kind]) => kind === 'melee').map(([key]) => key.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ids = [JNIGHT, ...catalog.config.activeOperatorIds.filter((id) => id !== JNIGHT && state.poolRemaining[id] > 1).slice(0, others)];
  state.pieces = ids.map((operatorId, index) => { state.poolRemaining[operatorId]--; return { uid: `p${state.nextUid++}`, operatorId, star: 1, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT', benchSlot: index }; });
  const run = (action) => { const result = applyAction(state, action, options); assert.equal(result.ok, true, `${action.type}: ${result.error}`); state = result.state; return result; };
  for (const piece of [...state.pieces]) { const [row, col] = cells[state.pieces.filter((p) => p.row !== null).length * 2]; run({ type: 'deploy', pieceUid: piece.uid, row, col, dir: 'RIGHT' }); }
  const give = (itemId, uid) => { state.inventory.push({ uid, itemId }); return uid; };
  return { get state() { return state; }, set state(next) { state = next; }, run, give, options, field,
    attempt: (action, opts = options) => applyAction(state, action, opts),
    knight: () => state.pieces.find((piece) => piece.operatorId === JNIGHT), other: () => state.pieces.find((piece) => piece.operatorId !== JNIGHT) };
}

test('卡西米尔断头台 recruits 砾 on pick, the text says so, and no strategy hands out the knight', () => {
  const strategy = catalog.strategies.prototype_set13_conqueror;
  assert.match(strategy.description, /^招募砾；/, 'the text names who is recruited');
  assert.match(strategy.description, /直接将其击倒/, 'and keeps the battle effect');
  const params = strategy.effects[0].params;
  assert.deepEqual(params.grantedHeroIds, [GRAVEL]); assert.deepEqual(params.bonusOperatorIds, [GRAVEL]);
  assert.equal(catalog.operators[GRAVEL].cost, 1); assert.ok(catalog.pacts.conqueror.members.includes(GRAVEL), '砾 is a 卡西米尔 member');
  for (const [id, row] of Object.entries(catalog.strategies)) {
    const named = [...(row.effects ?? []).flatMap((effect) => [...(effect.params?.grantedHeroIds ?? []), ...(effect.params?.bonusOperatorIds ?? [])]), ...(row.source?.grantedHeroes ?? []).map((hero) => hero.operatorId)];
    assert.ok(!named.includes(JNIGHT), `${id} does not recruit the knight`);
  }
  // picking it: one operator choice with 砾, claiming puts 砾 on the bench and takes a copy from the pool
  const s = scenario(2);
  const before = { pieces: s.state.pieces.length, pool: s.state.poolRemaining[GRAVEL] };
  s.state.pendingChoices = [{ uid: 'pick', type: 'strategy', source: 'node-5', remaining: 1, options: ['prototype_set13_conqueror'] }]; s.state.phase = 'choice';
  s.run({ type: 'chooseStrategy', choiceUid: 'pick', strategyId: 'prototype_set13_conqueror' });
  const choice = s.state.pendingChoices.find((entry) => entry.type === 'operators');
  assert.deepEqual(choice?.options, [GRAVEL]);
  s.run({ type: 'claimReward', choiceUid: choice.uid, optionIds: [GRAVEL] });
  const gravel = s.state.pieces.find((piece) => piece.operatorId === GRAVEL);
  assert.ok(gravel && gravel.row === null, '砾 waits on the bench');
  assert.equal(s.state.pieces.length, before.pieces + 1); assert.equal(s.state.poolRemaining[GRAVEL], before.pool - 1);
  assert.equal(validateSession(s.state, { catalog }).ok, true);
});

test('a 徽记 cannot be put on the knight, in any form, and nothing is lost', () => {
  const s = scenario(2), knight = s.knight(), other = s.other();
  s.give(emblem.id, 'e1');
  const before = structuredClone(s.state);
  const refused = s.attempt({ type: 'equip', pieceUid: knight.uid, itemUid: 'e1' });
  assert.equal(refused.ok, false); assert.equal(refused.error, 'PACT_NOT_COUNTED'); assert.deepEqual(s.state, before, 'the emblem stays in the inventory');
  // another operator takes it, and an ordinary item goes on the knight
  assert.equal(s.attempt({ type: 'equip', pieceUid: other.uid, itemUid: 'e1' }).ok, true);
  s.give(ordinaryItem.id, 'g1');
  s.run({ type: 'equip', pieceUid: knight.uid, itemUid: 'g1' });
  assert.equal(s.knight().equipment.length, 1);
  // a component that would complete an emblem in a slot of the knight
  const [first, second] = emblemRecipe.parts;
  s.state = structuredClone(before);
  s.give(first, 'c1'); s.give(second, 'c2');
  s.run({ type: 'equip', pieceUid: s.knight().uid, itemUid: 'c1' });
  const mid = structuredClone(s.state);
  const completing = s.attempt({ type: 'equip', pieceUid: s.knight().uid, itemUid: 'c2' });
  assert.equal(completing.ok, false); assert.equal(completing.error, 'PACT_NOT_COUNTED', 'the matching component would combine into the emblem in place');
  const combining = s.attempt({ type: 'combine', itemUids: ['c1', 'c2'] });
  assert.equal(combining.ok, false); assert.equal(combining.error, 'PACT_NOT_COUNTED', 'combining with the one the knight already carries');
  assert.deepEqual(s.state, mid, 'both refusals change nothing');
  // the same pair on any other operator completes the emblem as usual
  s.state = structuredClone(before);
  s.give(first, 'c1'); s.give(second, 'c2');
  s.run({ type: 'equip', pieceUid: s.other().uid, itemUid: 'c1' }); s.run({ type: 'equip', pieceUid: s.other().uid, itemUid: 'c2' });
  assert.equal(s.other().equipment[0].itemId, emblem.id);
});

test('pact choices never target the knight: not offered, and refused when named', () => {
  const s = scenario(2), knight = s.knight();
  const fixtureId = 'fixtureDualPact';
  const withDual = { ...catalog, strategies: { ...catalog.strategies, [fixtureId]: { id: fixtureId, name: '双重盟约', group: 'rule', description: '选择一名干员获得额外盟约。', timing: 'on-pick', condition: { kind: 'always' }, mutuallyExclusive: [], unique: true, effects: [{ kind: 'dual_pact', params: {} }], weight: 1, order: 999 } } };
  const options = { ...s.options, catalog: withDual };
  s.state.pendingChoices = [{ uid: 'pick', type: 'strategy', source: 'node-5', remaining: 1, options: [fixtureId] }]; s.state.phase = 'choice';
  let result = applyAction(s.state, { type: 'chooseStrategy', choiceUid: 'pick', strategyId: fixtureId }, options);
  assert.equal(result.ok, true, result.error);
  const dual = result.state.pendingChoices.find((choice) => choice.type === 'dual_pact');
  assert.ok(dual, 'the choice is offered');
  assert.ok(!dual.options.includes(knight.uid), 'the knight is not among the targets');
  assert.deepEqual([...dual.options].sort(), result.state.pieces.filter((piece) => piece.uid !== knight.uid).map((piece) => piece.uid).sort());
  // naming the knight anyway is refused (it is no option); a choice saved before the rule that still lists it is refused for its reason
  const forged = applyAction(result.state, { type: 'claimReward', choiceUid: dual.uid, optionIds: [knight.uid] }, options);
  assert.equal(forged.ok, false); assert.equal(forged.error, 'INVALID_REWARD_OPTION');
  const legacy = structuredClone(result.state), legacyChoice = legacy.pendingChoices.find((choice) => choice.type === 'dual_pact');
  legacyChoice.options.push(knight.uid);
  const legacyClaim = applyAction(legacy, { type: 'claimReward', choiceUid: legacyChoice.uid, optionIds: [knight.uid] }, options);
  assert.equal(legacyClaim.ok, false); assert.equal(legacyClaim.error, 'PACT_NOT_COUNTED');
  // and a pact tag aimed at it
  const tagState = structuredClone(result.state);
  tagState.pendingChoices = [{ uid: 'tag', type: 'pact_tag', source: fixtureId, options: ['ammo'], remaining: 1, pieceUid: knight.uid }];
  const tagged = applyAction(tagState, { type: 'claimReward', choiceUid: 'tag', optionIds: ['ammo'] }, options);
  assert.equal(tagged.ok, false); assert.equal(tagged.error, 'PACT_NOT_COUNTED'); assert.deepEqual(tagged.state.pieces.find((piece) => piece.uid === knight.uid).extraPacts ?? [], []);
  // the ordinary path still works
  const picked = applyAction(result.state, { type: 'claimReward', choiceUid: dual.uid, optionIds: [s.other().uid] }, options);
  assert.equal(picked.ok, true, picked.error);
  assert.equal(picked.state.pendingChoices.find((choice) => choice.type === 'pact_tag')?.pieceUid, s.other().uid);
});

test('the player is told in game words: shared text, client refusal, drag preview data', { timeout: 60_000 }, async () => {
  assert.equal(ERR.NO_PACT, 'NO_PACT'); assert.equal(ERR_TEXT.NO_PACT, '该干员不计入盟约');
  const display = resonanceDisplayCatalog(catalog, data);
  assert.equal(display.operators[JNIGHT].ignoresDeployLimit, true);
  assert.ok(Object.entries(display.operators).every(([id, operator]) => id === JNIGHT || !operator.ignoresDeployLimit), 'no other operator carries the flag');
  assert.equal(carriesPact(catalog, emblem.id), true); assert.equal(carriesPact(catalog, ordinaryItem.id), false);
  const target = { operatorId: JNIGHT, equipment: [] };
  assert.equal(pactRefusal({ operators: display.operators, equipment: catalog.equipment }, target, emblem.id), true);
  assert.match(equipRefusal({ operators: display.operators, equipment: catalog.equipment, recipes: catalog.recipes }, target, emblem.id, '正义骑士号'), /正义骑士号.*不计入盟约/);
  assert.equal(equipRefusal({ operators: display.operators, equipment: catalog.equipment, recipes: catalog.recipes }, target, ordinaryItem.id, '正义骑士号'), null, 'ordinary gear is fine');
  // over the protocol: g.equip answers NO_PACT with the session reason as detail
  const s = scenario(2);
  s.give(emblem.id, 'e1');
  const state = structuredClone(s.state);
  const store = { async exclusive(_id, task) { return task(); }, async saveSession() {}, deactivate() {} };
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const match = new ResonanceMatch({ sessionId: 'test-pact-less', state, catalog, data, store, scheduler, send() {}, broadcast() {}, timerScale: 0, log: quiet });
  try {
    match.start();
    assert.equal((await match.handle('resonance', { t: 'g.infoReady', setupRevision: 0 })).ok, true);
    match.enterBandDraft();
    assert.equal(scheduler.runUntil(() => match.phase === 'PREP', { maxTime: 30_000 }), true);
    const knight = match.state.pieces.find((piece) => piece.operatorId === JNIGHT);
    const result = await match.handle('resonance', { t: 'g.equip', itemUid: match.uidMap.native('e1'), targetUid: match.uidMap.native(knight.uid) });
    assert.equal(result.error, ERR.NO_PACT); assert.equal(result.detail, 'PACT_NOT_COUNTED');
    assert.equal(match.state.inventory.some((item) => item.uid === 'e1'), true, 'still in the inventory');
  } finally {
    await match._sessionWrite; match.dispose(); scheduler.dispose();
  }
});
