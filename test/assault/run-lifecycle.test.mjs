import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRun, applyAction } from '../../shared/assault/run.js';
import { pieceFromBody, addBodyToInventory, mergeInventory } from '../../shared/assault/inventory.js';
import { applyRunLifecycleEvent } from '../../shared/assault/run-lifecycle.js';
import { RUN_CARD_GROWTH, runGrowthSteps } from '../../shared/assault/growth-policy.js';

const json = (name) => JSON.parse(readFileSync(new URL(`../../data/assault-design/${name}.json`, import.meta.url), 'utf8'));
const system = json('system');
const events = json('events');
const collectibles = json('collectibles');
const encounters = json('encounters');
const forms = json('forms');
const roster = ['support', 'assault', 'ranged'].flatMap((group) => json(`roster-${group}`).operators);
const operators = Object.fromEntries(roster.map((entry) => [entry.charId, structuredClone(entry)]));
operators.char_002_amiya.extraForms = forms.forms.map((entry) => entry.charId);
const bodies = Object.fromEntries(roster.map((entry) => [entry.charId, {
  charId: entry.charId, purchaseCharId: entry.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1), atk: 100 } })),
}]));
for (const entry of forms.forms) bodies[entry.charId] = {
  charId: entry.charId, purchaseCharId: forms.family.charId, name: entry.name, profession: entry.profession,
  price: entry.price, defaultModuleId: entry.defaultModuleId ?? null, modulePlans: entry.modulePlans,
  baseStats: { maxHp: 1000 }, starStats: Array.from({ length: 4 }, (_, i) => ({ star: i + 1, stats: { maxHp: 1000 * (i + 1), atk: 100 } })),
};
const baseCtx = { catalog: { operators, bodies }, design: { system, events, collectibles, encounters } };
const withRules = (rules = []) => ({ ...baseCtx, design: { ...baseCtx.design, system: { ...system, runLifecycleRules: rules } } });
const rule = (id, owner, event, effect, extra = {}) => ({ id, owner, event, effects: [effect], ...extra });
const flat = (target, stat = 'atk', values = [1, 2, 3, 4]) => ({ kind: 'enhance', target, stat, mode: 'flat', amountByStar: values });
const makeRun = (ctx = withRules()) => createRun({ runId: 'lifecycle', seed: 711, directorId: system.directors[0].id }, ctx);
const putInShop = (state, offer) => {
  state.phase = 'shop';
  state.shop = { id: 'shop_base', refreshCost: 2, refreshCount: 0, slots: [offer] };
};
const apply = (state, ctx, type, params = {}, opId = type) => applyAction(state, {
  type, ...params, opId, expectedRevision: state.revision,
}, ctx);

for(const [id,definition]of Object.entries(RUN_CARD_GROWTH))test(`${id}: outside growth grants one step, caps, ignores old events and merges by maximum`,()=>{
  const base=withRules(),ctx={...base,catalog:{...base.catalog,bodies:{...base.catalog.bodies,
    char_2015_dusk:{...base.catalog.bodies.char_2015_dusk,adaptation:{line:'workshop',produces:['summon']}}}}};
  const state=makeRun(ctx),event=definition.event;
  const send=(key,heldUids=state.pieces.map(p=>p.uid))=>applyRunLifecycleEvent(state,ctx,event,{eventKey:key,heldUids,
    transaction:{kind:'operator',charId:'char_2015_dusk',uid:'purchased'}});
  send('before-owned');const owner=pieceFromBody(state,ctx,id);state.pieces.push(owner);
  send('before-owned');assert.equal(runGrowthSteps(owner),0,'past events never replay after acquisition');
  send('first');send('first');assert.equal(runGrowthSteps(owner),1,'one new event grants one tier exactly once');
  if(definition.stat==='atk')assert.equal(owner.permanentPercent.atk,.02);
  for(let n=0;n<20;n++)send('cap:'+n);
  assert.equal(runGrowthSteps(owner),definition.steps);
  const count=state.history.filter(h=>h.kind==='cardGrowth').length;send('after-cap');
  assert.equal(state.history.filter(h=>h.kind==='cardGrowth').length,count,'no fake growth entry at cap');
  const weak=pieceFromBody(state,ctx,id,1,{row:9,col:7});state.pieces=[weak];send('weak-first');
  state.pieces=[weak,owner];const merged=mergeInventory(state.pieces,ctx);
  assert.equal(merged.length,1);assert.equal(merged[0].uid,weak.uid);assert.equal(merged[0].star,2);
  assert.equal(runGrowthSteps(merged[0]),definition.steps,'higher secondary value is inherited, not added');
  if(definition.stat==='atk')assert.equal(merged[0].permanentPercent.atk,.2);
});

test('Ling ignores her first acquisition and non-summoner/enchantment buys, then grows on an actual summon purchase',()=>{
 const base=withRules(),ctx={...base,catalog:{...base.catalog,bodies:{...base.catalog.bodies,
  char_2023_ling:{...base.catalog.bodies.char_2023_ling,adaptation:{line:'workshop',produces:['summon']}}}}};
 const state=makeRun(ctx);for(const p of state.pieces){p.row=null;p.col=null;}state.gold=100;
 const offer=key=>({slotId:key,purchaseCharId:'char_2023_ling',charId:'char_2023_ling',star:1,requiredCopies:1,price:4});
 putInShop(state,offer('first'));const first=apply(state,ctx,'buy',{slotId:'first'},'first-ling').state;
 assert.equal(runGrowthSteps(first.pieces.find(p=>p.charId==='char_2023_ling')),0);
 putInShop(first,offer('second'));const second=apply(first,ctx,'buy',{slotId:'second'},'second-ling').state;
 const ling=second.pieces.find(p=>p.charId==='char_2023_ling');assert.equal(ling.star,2);assert.equal(runGrowthSteps(ling),1);
 applyRunLifecycleEvent(second,ctx,'buy',{eventKey:'enchantment',transaction:ling,heldUids:[ling.uid]});
 applyRunLifecycleEvent(second,ctx,'buy',{eventKey:'wrong-line',transaction:{kind:'operator',charId:'char_127_estell'},heldUids:[ling.uid]});
 assert.equal(runGrowthSteps(ling),1);
});

test('a winning settlement records one growth line and applies Dusk attack to the next battle only',()=>{
 const originalLedger={duration:1,operators:[]},ctx={...withRules(),settleBattle:()=>({victory:true,leakedLife:0,ledger:originalLedger})};
 const state=makeRun(ctx),dusk=pieceFromBody(state,ctx,'char_2015_dusk');state.pieces.push(dusk);
 state.phase='battle';state.currentNode={kind:'battle',battleKind:'normal',encounterId:encounters.encounters[0].id};
 state.currentBattle={battleId:'growth-settlement',encounterId:encounters.encounters[0].id};
 const result=apply(state,ctx,'settleBattle',{battleId:'growth-settlement'},'growth-victory').state;
 const entry=result.history.findLast(h=>h.kind==='battleSettled');
 assert.deepEqual(entry.ledger.growth.map(g=>[g.charId,g.before,g.after]),[['char_2015_dusk',0,2]]);
 assert.equal(result.pieces.find(p=>p.uid===dusk.uid).permanentPercent.atk,.02);
 assert.equal(originalLedger.growth,undefined,'settlement never rewrites the completed combat ledger');
 assert.deepEqual(result.pendingCardGrowth,[]);
});

test('new adaptation growth consumes only outside-battle win and matching node events, idempotently', () => {
  const id = 'char_127_estell';
  const ctx = withRules([
    rule('win-growth', { kind: 'operator', id }, 'battleEnd', flat('self')),
    rule('node-growth', { kind: 'operator', id }, 'nodeEntered', flat('self', 'def'), { nodeKinds: ['event'] }),
  ]);
  const state = makeRun(ctx), owner = pieceFromBody(state, ctx, id, 1, { row: null, col: null });
  state.pieces.push(owner);
  applyRunLifecycleEvent(state, ctx, 'nodeEntered', { eventKey: 'shop', nodeKind: 'shop' });
  assert.equal(owner.permanentFlat.def, undefined);
  for (let i = 0; i < 2; i++) {
    applyRunLifecycleEvent(state, ctx, 'nodeEntered', { eventKey: 'event:one', nodeKind: 'event' });
    applyRunLifecycleEvent(state, ctx, 'battleEnd', { eventKey: 'battle:one:won' });
  }
  assert.equal(owner.permanentFlat.atk, 1); assert.equal(owner.permanentFlat.def, 1);
  assert.throws(() => applyRunLifecycleEvent(state, ctx, 'kill', { eventKey: 'combat' }), /Unknown run lifecycle event/);
});

test('buy effects attach to the actual merged receiver and upgrade fires only after a real star increase', () => {
  const id = 'char_127_estell';
  const ctx = withRules([
    rule('buy-growth', { kind: 'operator', id }, 'buy', flat('transaction', 'atk', [1, 1, 1, 1])),
    rule('upgrade-growth', { kind: 'operator', id }, 'upgrade', flat('transaction', 'atk', [2, 2, 2, 2])),
  ]);
  const state = makeRun(ctx);
  for (const piece of state.pieces) { piece.row = null; piece.col = null; }
  const existing = pieceFromBody(state, ctx, id, 1, { star: 1, row: 9, col: 7 });
  existing.moduleChoices[id] = 'kept-module-choice';
  state.pieces.push(existing);
  putInShop(state, { slotId: 'offer', purchaseCharId: id, charId: id, star: 1, requiredCopies: 1, price: operators[id].price });
  const result = apply(state, ctx, 'buy', { slotId: 'offer' }, 'buy-upgrade');
  const receiver = result.state.pieces.find((piece) => piece.uid === existing.uid);
  assert.equal(receiver.star, 2);
  assert.equal(receiver.sourceCopies, 2);
  assert.equal(receiver.permanentFlat.atk, 3);
  assert.deepEqual([receiver.row, receiver.col], [9, 7]);
  assert.equal(receiver.moduleChoices[id], 'kept-module-choice');
  assert.equal(result.state.shop.slots.length, 0);
  assert.deepEqual(result.state.history.filter((entry) => entry.kind === 'runLifecycleTriggered').map((entry) => entry.event), ['buy', 'upgrade']);
});

test('sell uses the removed piece snapshot for self and routes other observers to their own surviving piece', () => {
  const sellerId = 'char_127_estell';
  const observerId = 'char_002_amiya';
  const sellerRule = rule('seller-self', { kind: 'operator', id: sellerId }, 'sell', flat('self'), { selfOnly: true });
  sellerRule.effects.push({ kind: 'currency', currency: 'gold', amountByStar: [3, 3, 3, 3] });
  const ctx = withRules([
    sellerRule,
    rule('observer-self', { kind: 'operator', id: observerId }, 'sell', flat('self', 'def', [4, 4, 4, 4]), { otherOnly: true }),
  ]);
  const state = makeRun(ctx);
  const sold = pieceFromBody(state, ctx, sellerId, 1, { row: null, col: null });
  const observer = pieceFromBody(state, ctx, observerId, 1, { row: null, col: null });
  state.pieces.push(sold, observer);
  state.phase = 'nodeChoice';
  const result = apply(state, ctx, 'sell', { uid: sold.uid }, 'sell-self');
  assert.ok(!result.state.pieces.some((piece) => piece.uid === sold.uid));
  assert.equal(result.state.gold, state.gold + 2 + 3);
  assert.equal(result.state.pieces.find((piece) => piece.uid === observer.uid).permanentFlat.def, 4);
  const history = result.state.history.filter((entry) => entry.kind === 'runLifecycleTriggered');
  assert.ok(history.some((entry) => entry.ruleId === 'seller-self' && entry.target === 'gold'));
  assert.ok(!history.some((entry) => entry.ruleId === 'seller-self' && entry.targetUid === sold.uid));
  assert.ok(history.some((entry) => entry.ruleId === 'observer-self' && entry.targetUid === observer.uid));
  assert.ok(!history.some((entry) => entry.ruleId === 'observer-self' && entry.targetUid === sold.uid));
  assert.ok(!result.state.claimed.some((key) => key.endsWith(`:${sold.uid}`)));
  assert.equal(result.state.pieces.find((piece) => piece.uid === observer.uid).permanentFlat.atk, undefined);
});

test('same-day hour start and rollover effects run once, after income and survive op replay exactly once', () => {
  const id = 'char_127_estell';
  const ctx = withRules([
    rule('hour-currency', { kind: 'enchantment', id: 'enchant-fixture' }, 'hourStarted', { kind: 'currency', currency: 'gold', amountByStar: [1, 1, 1, 1] }),
    rule('day-currency', { kind: 'enchantment', id: 'enchant-fixture' }, 'dayStarted', { kind: 'currency', currency: 'xp', amountByStar: [2, 2, 2, 2] }),
  ]);
  const state = makeRun(ctx);
  const owner = pieceFromBody(state, ctx, id, 1, { star: 1, row: null, col: null });
  owner.enchantmentId = 'enchant-fixture';
  state.pieces.push(owner);
  const secondOwner = pieceFromBody(state, ctx, 'char_174_slbell', 1, { star: 1, row: null, col: null });
  secondOwner.enchantmentId = 'enchant-fixture';
  state.pieces.push(secondOwner);
  const initialGold = state.gold;
  putInShop(state, { slotId: 'unused', purchaseCharId: id, charId: id, star: 1, requiredCopies: 1, price: 1 });
  const sameDay = apply(state, ctx, 'finishShop', {}, 'hour-2');
  assert.equal(sameDay.state.day, 1);
  assert.equal(sameDay.state.gold, initialGold + 2);
  assert.equal(sameDay.state.xp, system.run.xpPerHour);
  assert.strictEqual(applyAction(sameDay.state, { type: 'finishShop', opId: 'hour-2', expectedRevision: state.revision }, ctx).state, sameDay.state);

  const rolloverInput = structuredClone(sameDay.state);
  rolloverInput.hour = system.run.hoursPerDay;
  putInShop(rolloverInput, { slotId: 'unused', purchaseCharId: id, charId: id, star: 1, requiredCopies: 1, price: 1 });
  const rollover = apply(rolloverInput, ctx, 'finishShop', {}, 'day-2-hour-1');
  assert.equal(rollover.state.day, 2);
  assert.equal(rollover.state.hour, 1);
  assert.equal(rollover.state.gold, sameDay.state.gold + system.run.dailyIncome + 2);
  assert.equal(rollover.state.xp, sameDay.state.xp + system.run.xpPerHour + 4);
  const eventCounts = rollover.state.history.filter((entry) => entry.kind === 'runLifecycleTriggered')
    .reduce((counts, entry) => ({ ...counts, [entry.event]: (counts[entry.event] ?? 0) + 1 }), {});
  assert.deepEqual(eventCounts, { hourStarted: 4, dayStarted: 2 });
});

test('shop entry applies configured discount to existing offers; missing lifecycle rules remain inert', () => {
  const id = 'char_127_estell';
  const ctx = withRules([
    rule('shop-entry-discount', { kind: 'operator', id }, 'shopEntered', { kind: 'shopDiscount', amountByStar: [2, 2, 2, 2] }),
  ]);
  const baselineCtx = withRules();
  const state = makeRun(ctx);
  state.pieces.push(pieceFromBody(state, ctx, id, 1, { row: null, col: null }));
  const shopNode = state.nodeChoices.find((node) => node.kind === 'shop');
  assert.ok(shopNode);
  const entered = apply(state, ctx, 'selectNode', { nodeId: shopNode.id }, 'enter-shop');
  const baseline = makeRun(baselineCtx);
  baseline.pieces.push(pieceFromBody(baseline, baselineCtx, id, 1, { row: null, col: null }));
  const baselineNode = baseline.nodeChoices.find((node) => node.id === shopNode.id);
  assert.ok(baselineNode);
  const baselineShop = apply(baseline, baselineCtx, 'selectNode', { nodeId: baselineNode.id }, 'baseline-shop').state.shop;
  for (const slot of entered.state.shop.slots) {
    const undiscounted = baselineShop.slots.find((entry) => entry.slotId === slot.slotId);
    assert.ok(undiscounted);
    assert.equal(slot.price, Math.max(1, undiscounted.price - 2));
  }
  assert.ok(entered.state.history.some((entry) => entry.kind === 'runLifecycleTriggered' && entry.event === 'shopEntered'));

  const inert = makeRun(withRules());
  const inertBefore = structuredClone(inert);
  const inertShop = inert.nodeChoices.find((node) => node.kind === 'shop');
  const unchanged = apply(inert, withRules(), 'selectNode', { nodeId: inertShop.id }, 'inert-shop');
  assert.equal(unchanged.state.history.some((entry) => entry.kind === 'runLifecycleTriggered'), false);
  assert.equal(inertBefore.history.some((entry) => entry.kind === 'runLifecycleTriggered'), false);
});

test('invalid matching and unmatched rule/rank data fail atomically; valid skill rank selects its amount tier', () => {
  const id = 'char_127_estell';
  const state = makeRun();
  const owner = pieceFromBody(state, baseCtx, id, 1, { row: null, col: null });
  state.pieces.push(owner);
  putInShop(state, { slotId: 'offer', purchaseCharId: id, charId: id, star: 1, requiredCopies: 1, price: 1 });
  const invalidRule = rule('bad-unmatched', { kind: 'operator', id: 'not-owned' }, 'buy', { kind: 'enhance', target: 'transaction', stat: 'atk', mode: 'percent', amountByStar: [0, 1, 2] });
  const invalidCtx = withRules([invalidRule]);
  const before = structuredClone(state);
  assert.throws(() => apply(state, invalidCtx, 'buy', { slotId: 'offer' }, 'invalid-buy'), { code: 'INVALID_RUN_LIFECYCLE_RULE' });
  assert.deepEqual(state, before);
  const invalidOwnerCtx = withRules([rule('bad-owner', { kind: 'unknown-owner', id: 'not-owned' }, 'buy', flat('transaction'))]);
  assert.throws(() => apply(state, invalidOwnerCtx, 'buy', { slotId: 'offer' }, 'invalid-owner'), { code: 'INVALID_RUN_LIFECYCLE_RULE' });
  assert.deepEqual(state, before);

  const skillCtx = withRules([rule('ranked-skill', { kind: 'skill', id: 'skill-fixture' }, 'buy', flat('team', 'def', [1, 3, 5, 7]))]);
  const skillState = makeRun(skillCtx);
  skillState.pieces.push(pieceFromBody(skillState, skillCtx, id, 1, { row: null, col: null }));
  skillState.skillRanks = { 'skill-fixture': 2 };
  putInShop(skillState, { slotId: 'offer', purchaseCharId: id, charId: id, star: 1, requiredCopies: 1, price: 1 });
  const ranked = apply(skillState, skillCtx, 'buy', { slotId: 'offer' }, 'ranked-buy');
  assert.ok(ranked.state.pieces.every((piece) => piece.permanentFlat.def === 3));

  const badRank = structuredClone(skillState);
  badRank.skillRanks['skill-fixture'] = 0;
  const badRankBefore = structuredClone(badRank);
  assert.throws(() => apply(badRank, skillCtx, 'buy', { slotId: 'offer' }, 'bad-rank'), { code: 'INVALID_RUN_LIFECYCLE_RULE' });
  assert.deepEqual(badRank, badRankBefore);
});

test('stable percentage source survives merges without being duplicated by op replay', () => {
  const id = 'char_127_estell';
  const ctx = withRules([rule('percent-growth', { kind: 'operator', id }, 'buy', {
    kind: 'enhance', target: 'transaction', stat: 'maxHp', mode: 'percent', amountByStar: [0.1, 0.1, 0.1, 0.1],
  })]);
  const state = makeRun(ctx);
  const first = pieceFromBody(state, ctx, id, 1, { star: 1, row: null, col: null });
  state.pieces.push(first);
  putInShop(state, { slotId: 'offer', purchaseCharId: id, charId: id, star: 1, requiredCopies: 1, price: 1 });
  const action = { type: 'buy', slotId: 'offer', opId: 'percent-buy', expectedRevision: state.revision };
  const bought = applyAction(state, action, ctx);
  assert.equal(bought.state.pieces.find((piece) => piece.uid === first.uid).permanentPercent.maxHp, 0.1);
  assert.strictEqual(applyAction(bought.state, action, ctx).state, bought.state);
  const receiver = bought.state.pieces[0];
  addBodyToInventory(bought.state, ctx, id, 1, { star: receiver.star, row: null, col: null });
  assert.equal(bought.state.pieces.find((piece) => piece.purchaseCharId === id).permanentPercent.maxHp, 0.1);
  const sourceKey = `run-lifecycle:percent-growth:operator:char_127_estell:${first.uid}:0`;
  const one = pieceFromBody(bought.state, ctx, id, 1, { star: 1, row: null, col: null });
  const two = pieceFromBody(bought.state, ctx, id, 1, { star: 1, row: null, col: null });
  for (const piece of [one, two]) {
    piece.permanentPercentSources[sourceKey] = { maxHp: 0.1 };
    piece.permanentPercent.maxHp = 0.1;
  }
  assert.equal(mergeInventory([one, two], ctx)[0].permanentPercent.maxHp, 0.1);
});

test('addBodyToInventory returns the incoming copy receiver when other legacy pairs merge first', () => {
  const id = 'char_127_estell';
  const ctx = withRules();
  const state = makeRun(ctx);
  const twoA = pieceFromBody(state, ctx, id, 2, { star: 2, row: null, col: null });
  const twoB = pieceFromBody(state, ctx, id, 2, { star: 2, row: null, col: null });
  const one = pieceFromBody(state, ctx, id, 1, { star: 1, row: null, col: null });
  state.pieces = [twoA, twoB, one];
  const receiver = addBodyToInventory(state, ctx, id, 1, { star: 1, row: null, col: null });
  assert.equal(receiver.uid, one.uid);
  assert.equal(receiver.star, 2);
  assert.equal(receiver.sourceCopies, 2);
  assert.equal(state.pieces.find((piece) => piece.uid === twoA.uid).star, 3);
});

test('skill virtual owners, transaction filters, team growth, and random card discounts trigger once', () => {
  const id = 'char_127_estell';
  const ctx = withRules([
    rule('skill-growth', { kind: 'skill', id: 'skill-fixture' }, 'skillBought', { kind: 'teamGrowth', stat: 'atk', amountByStar: [1, 2, 3, 4] }, { selfOnly: true }),
    rule('profession-buy', { kind: 'operator', id }, 'buy', flat('transaction'), { transactionFilter: { professions: ['WARRIOR'], maxSourceCopies: 1 } }),
    rule('random-card', { kind: 'skill', id: 'skill-fixture' }, 'shopCardsDealt', { kind: 'shopDiscount', target: 'randomOne', amountByStar: [1, 1, 1, 1] }),
  ]);
  const state = makeRun(ctx);
  state.skillRanks = { 'skill-fixture': 2 };
  state.shop = { id: 'shop_base', slots: [{ slotId: 'a', price: 5 }, { slotId: 'b', price: 6 }, { slotId: 'c', price: 1 }], refreshCost: 1, refreshCount: 0 };
  applyRunLifecycleEvent(state, ctx, 'skillBought', { eventKey: 'skill:a', transaction: { skillId: 'skill-fixture' } });
  assert.equal(state.teamGrowth.atk, 2);
  const prices = state.shop.slots.map((slot) => slot.price);
  applyRunLifecycleEvent(state, ctx, 'shopCardsDealt', { eventKey: 'cards:one' });
  const after = state.shop.slots.map((slot) => slot.price);
  assert.equal(after.filter((price, index) => price !== prices[index]).length, 1);
  assert.ok(after[0] === prices[0] - 1 || after[1] === prices[1] - 1);
  assert.ok(state.history.some((entry) => entry.kind === 'runLifecycleTriggered' && entry.target === 'teamGrowth'));
});
