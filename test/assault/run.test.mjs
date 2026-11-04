import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRun, applyAction, previewNodes, viewRun } from '../../shared/assault/run.js';
import { buildShopState, calculateSellPrice, meetsShopFilter, operatorInShopPool } from '../../shared/assault/shops.js';
import { pieceFromBody, mergeInventory } from '../../shared/assault/inventory.js';

const json = (name) => JSON.parse(readFileSync(new URL(`../../data/assault-design/${name}.json`, import.meta.url), 'utf8'));
const system = json('system');
const events = json('events');
const collectibles = json('collectibles');
const encounters = json('encounters');
const forms = json('forms');
const roster = ['support', 'assault', 'ranged'].flatMap((group) => json(`roster-${group}`).operators);
const identities = new Map(roster.map((operator) => [operator.charId, structuredClone(operator)]));
identities.get('char_002_amiya').extraForms = forms.forms.map((form) => form.charId);
const bodies = Object.fromEntries(roster.map((operator) => [operator.charId, {
  charId: operator.charId,
  purchaseCharId: operator.charId,
  name: operator.name,
  profession: operator.profession,
  price: operator.price,
  defaultModuleId: operator.defaultModuleId ?? null,
  modulePlans: operator.modulePlans,
  baseStats: { maxHp: 1000 },
  starStats: Array.from({ length: 4 }, (_, index) => ({ star: index + 1, stats: { maxHp: 1000 * (index + 1) } })),
}]));
for (const form of forms.forms) bodies[form.charId] = {
  charId: form.charId,
  purchaseCharId: forms.family.charId,
  name: form.name,
  profession: form.profession,
  price: form.price,
  defaultModuleId: form.defaultModuleId ?? null,
  modulePlans: form.modulePlans,
  baseStats: { maxHp: 1000 },
  starStats: Array.from({ length: 4 }, (_, index) => ({ star: index + 1, stats: { maxHp: 1000 * (index + 1) } })),
};
const ctx = {
  catalog: { operators: Object.fromEntries(identities), bodies },
  design: { system, events, collectibles, encounters },
  canPlace: (_state, _piece, row, col) => row >= 9 && row <= 12 && col >= 2 && col <= 10,
  prepareBattle: (_state, encounter) => ({ battleId: `fixture-${encounter.id}` }),
  settleBattle: (_state, battle) => ({ battleId: battle.battleId, victory: true, leakedLife: 0, summary: { fixture: true } }),
};
const compiledCatalog = JSON.parse(readFileSync(process.env.ASSAULT_RUNTIME_PATH || new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));

test('current leader cores are eligible in every shop and retain identity, prices, quality and source caps',()=>{
 const live={...ctx,catalog:{operators:compiledCatalog.operators,bodies:compiledCatalog.bodies}};
 const old={...live,design:{...live.design,system:{...system,directors:system.directors.map(d=>({...d,coreCharIds:[]}))}}};
 for(const director of system.directors){
  assert.equal(director.coreCharIds.length,3);assert.equal(new Set(director.coreCharIds).size,3);
  for(const shop of system.shopDefinitions){
   for(const id of director.coreCharIds){
    assert.ok(operatorInShopPool(id,live.catalog.operators[id],shop,live,director.id));
    const state={directorId:director.id,pieces:[],relicIds:[],skillRanks:{},day:10,rngState:91,nextShopDiscount:0};
    const excluded=Object.keys(live.catalog.operators).filter(x=>x!==id);
    let found=false;
    for(let seed=1;seed<=100;seed++){
     const generated=buildShopState({...state,rngState:seed*7919},live,shop.id,{excludePurchaseCharIds:excluded});
     const ids=generated.slots.filter(s=>s.purchaseCharId).map(s=>s.purchaseCharId);
     assert.equal(new Set(ids).size,ids.length,'one core entry per stock');
     const core=generated.slots.find(s=>s.purchaseCharId===id);if(!core)continue;
     found=true;assert.equal(core.price,Math.max(1,4*core.requiredCopies-(shop.priceRule.type==='discount'?shop.priceRule.amount:0)));
     assert.equal(core.requiredCopies,2 ** (core.star-1));break;
    }
    assert.ok(found,shop.id+': '+id);
    state.pieces=[{uid:'cap',purchaseCharId:id,charId:id,star:4,sourceCopies:8}];
    assert.equal(buildShopState(state,live,shop.id,{excludePurchaseCharIds:excluded}).slots.some(s=>s.purchaseCharId===id),false);
   }
   const before={directorId:director.id,pieces:[],relicIds:[],skillRanks:{},day:10,rngState:1234,nextShopDiscount:0},after=structuredClone(before);
   const options={excludePurchaseCharIds:director.coreCharIds};
   assert.deepEqual(buildShopState(after,live,shop.id,options),buildShopState(before,old,shop.id,options),shop.id+' non-core stock unchanged');
   assert.equal(after.rngState,before.rngState);
  }
 }
});

test('skill, enchantment and supply shops can sell a core through the operator action at its original price',()=>{
 const live={...ctx,catalog:{operators:compiledCatalog.operators,bodies:compiledCatalog.bodies}};
 for(const shopId of ['shop_strategy','shop_enchant','shop_supply']){
  let state=createRun({runId:'mixed-'+shopId,seed:41,directorId:'director_ironmn'},live);state.gold=100;state.day=5;state.phase='shop';
  let core=null;
  for(let seed=1;seed<100;seed++){
   state.shop=buildShopState({...state,rngState:seed*7919},live,shopId);core=state.shop.slots.find(s=>s.kind==='operator');if(core)break;
  }
  assert.ok(core,shopId);const copies=state.pieces.filter(p=>p.purchaseCharId===core.purchaseCharId).reduce((n,p)=>n+p.sourceCopies,0);
  const result=applyAction(state,{type:'buy',slotId:core.slotId,expectedRevision:state.revision,opId:'mixed-core'},live).state;
  assert.equal(result.gold,100-core.price);
  assert.equal(result.pieces.filter(p=>p.purchaseCharId===core.purchaseCharId).reduce((n,p)=>n+p.sourceCopies,0),copies+core.requiredCopies);
  assert.equal(result.shop.slots.some(s=>s.slotId===core.slotId),false);
 }
});

function act(state, type, params = {}) {
  return applyAction(state, { type, ...params, opId: `${state.runId}:${state.revision}:${type}`, expectedRevision: state.revision }, ctx);
}
const battleContext=overrides=>({...ctx,...overrides,design:{...ctx.design,system:{...system,run:{...system.run,mandatoryHours:[1,3,6]}}}});

test('seed resume, structural idempotency, revision conflicts, and preview immutability', () => {
  const original = createRun({ runId: 'resume-a', seed: 'fixed-seed', directorId: system.directors[0].id }, ctx);
  const resumed = createRun({ runId: 'resume-a', seed: 'fixed-seed', directorId: system.directors[0].id }, ctx);
  assert.deepEqual(resumed, original);
  assert.equal(original.rngState >>> 0, original.rngState);
  assert.deepEqual(previewNodes(original), original.nodes);
  const before = structuredClone(original);
  const first = applyAction(original, { type: 'selectNode', nodeId: original.nodes[0].id, expectedRevision: 0, opId: 'same' }, ctx);
  const repeated = applyAction(first.state, { opId: 'same', expectedRevision: 0, nodeId: original.nodes[0].id, type: 'selectNode' }, ctx);
  assert.strictEqual(repeated.state, first.state);
  assert.deepEqual(repeated.result, first.result);
  assert.throws(() => applyAction(first.state, { type: 'selectNode', nodeId: 'different', expectedRevision: 0, opId: 'same' }, ctx), { code: 'OP_ID_CONFLICT' });
  assert.throws(() => applyAction(first.state, { type: 'finishShop', expectedRevision: 0, opId: 'new' }, ctx), { code: 'REVISION_CONFLICT' });
  assert.equal(before.revision, 0);
  assert.equal(viewRun(first.state, ctx).opJournal, undefined);
  assert.equal(Object.hasOwn(viewRun(first.state, ctx), 'opJournal'), false);
});

test('compiled source catalog resolves every starter director without claiming SIM coverage', () => {
  assert.equal(Object.keys(compiledCatalog.operators).length, 170);
  assert.equal(Object.keys(compiledCatalog.bodies).length, 172);
  const sourceCtx = { catalog: compiledCatalog, design: { system, events, collectibles, encounters } };
  for (const director of system.directors) {
    const state = createRun({ runId: `source-${director.id}`, seed: 20261009, directorId: director.id }, sourceCtx);
    assert.equal(state.pieces.length, 3);
    assert.deepEqual(state.pieces.map((piece) => piece.charId), director.startTeam);
    assert.ok(state.pieces.every((piece) => compiledCatalog.bodies[piece.charId]));
  }
});

test('three director fixtures complete all 60 hours through nodes and trusted battle callbacks', () => {
  const totals = { hours: 0, normal: 0, risk: 0, final: 0, rewards: 0, shop: 0 };
  for (const director of system.directors) {
    let state = createRun({ runId: director.id, seed: 0xabcdef01, directorId: director.id }, ctx);
    assert.equal(state.day, 1);
    assert.equal(state.hour, 1);
    assert.equal(state.gold, 12);
    assert.equal(state.life, 20);
    assert.equal(state.pieces.length, 3);
    assert.equal(state.relicIds[0], director.starterRelicId);
    while (state.phase !== 'ended') {
      if (state.phase === 'nodeChoice') {
        const candidates = previewNodes(state);
        assert.ok(candidates.length >= 1);
        if (state.hour === 3 || state.hour === 6 || state.day === 10 && state.hour === 6) {
          assert.equal(candidates.length, 3);
          assert.equal(new Set(candidates.map((node) => node.encounterId)).size, 3);
          if (!(state.day === 10 && state.hour === 6)) {
            assert.ok(candidates.some((node) => node.battleKind === 'normal'), 'mandatory combat preserves a normal option');
            assert.ok(candidates.some((node) => node.battleKind === 'risk'), 'mandatory combat preserves an optional risk reward');
          }
        }
        const selected = candidates[0];
        state = act(state, 'selectNode', { nodeId: selected.id }).state;
        totals.hours += 0;
      } else if (state.phase === 'shop') {
        const before = [state.day, state.hour];
        state = act(state, 'finishShop').state;
        totals.shop += 1;
        totals.hours += before[0] * 0 + (state.day !== before[0] || state.hour !== before[1] ? 1 : 0);
      } else if (state.phase === 'skillChoice') {
        state = act(state, 'chooseSkill', { skillId: state.pendingSkillRewards[0].choices[0] }).state;
      } else if (state.phase === 'upgradeChoice') {
        state = act(state, 'chooseUpgrade', { uid: state.pendingUpgradeRewards[0].choices[0] }).state;
      } else if (state.phase === 'event') {
        const leave = state.currentEvent.choices.find((choice) => choice.id.endsWith('_leave'));
        state = act(state, 'leaveEvent', { free_leave_choice_id: leave?.id }).state;
      } else if (state.phase === 'battlePrep') {
        const kind = state.currentNode.battleKind;
        if (kind === 'final') totals.final += 1;
        else if (kind === 'risk') totals.risk += 1;
        else totals.normal += 1;
        state = act(state, 'readyBattle').state;
      } else if (state.phase === 'battle') {
        const battleId = state.currentBattle.battleId;
        state = act(state, 'settleBattle', { battleId }).state;
      } else if (state.phase === 'rewards') {
        state = act(state, 'chooseRelic', { relicId: state.rewardQueue.choices[0] }).state;
        totals.rewards += 1;
      } else assert.fail(`unexpected phase ${state.phase}`);
      assert.ok(state.revision < 500, 'run remains bounded in action count');
    }
    assert.equal(state.completed, true);
    assert.equal(state.day, 10);
    assert.equal(state.hour, 6);
    assert.ok(state.life > 0);
    assert.equal(state.history.filter((entry) => entry.kind === 'hourStarted').length, 59);
    assert.ok(state.gold >= 12 + 9 * 8);
    const expectedBattleBonusXp = state.history.filter((entry) => entry.kind === 'battleSettled').reduce((sum, entry) => {
      const encounter = encounters.encounters.find((candidate) => candidate.id === entry.encounterId);
      return sum + (encounter.kind === 'risk' ? 6 : encounter.kind === 'normal' ? 3 : 0);
    }, 0);
    assert.equal(state.xp, 60 + expectedBattleBonusXp);
  }
  assert.equal(totals.final, 3);
  assert.equal(totals.normal + totals.risk, 57);
  assert.ok(totals.rewards > 0);
  assert.ok(totals.shop > 0);
});

test('strategy skill shops deal distinct identities and purchase or upgrade independent ranks', () => {
  const customSystem = structuredClone(system);
  customSystem.strategySkills = ['a', 'b', 'c'].map((id) => ({ id, name: `Skill ${id}`, startingStar: 1, prices: [5, 10, 20, 40], icon: { kind: 'GIcon', name: id } }));
  customSystem.enchantments = [{ id: 'enchant_golden', name: 'Golden', price: 8, eligibility: 'any', icon: { kind: 'GIcon', name: 'gold' }, battle: { kind: 'none', valuesByStar: [0, 0, 0, 0] } }];
  customSystem.shopDefinitions = [...system.shopDefinitions,
    { id: 'shop_strategy', name: 'Strategy', kind: 'skill', unlockDay: 1, slots: 3, refreshCost: 1, maxRefreshes: 1, filter: { type: 'none' }, priceRule: { type: 'definitionPrices' }, supplyPolicy: 'distinctPurchaseIdentities' },
    { id: 'shop_enchant', name: 'Enchant', kind: 'enchantment', unlockDay: 2, slots: 3, refreshCost: 1, maxRefreshes: 1, filter: { type: 'none' }, priceRule: { type: 'definitionPrices' }, supplyPolicy: 'distinctPurchaseIdentities' }];
  customSystem.shopQualityWeights = { days: { 1: { 1: 1, 2: 0, 3: 0, 4: 0 }, 2: { 1: 0.9, 2: 0.1, 3: 0, 4: 0 } } };
  const customCtx = { ...ctx, catalog: structuredClone(ctx.catalog), design: { ...ctx.design, system: customSystem } };
  for (const body of Object.values(customCtx.catalog.bodies)) body.fixedSkill = { kind: 'instant' };
  const state = createRun({ runId: 'skill-shops', seed: 99, directorId: system.directors[0].id }, customCtx);
  state.gold = 100;
  state.shop = buildShopState(state, customCtx, 'shop_strategy', {excludePurchaseCharIds:system.directors[0].coreCharIds});
  state.phase = 'shop';
  assert.equal(state.shop.kind, 'skill');
  assert.equal(state.shop.slots.length, 3);
  assert.equal(new Set(state.shop.slots.map((slot) => slot.skillId)).size, 3);
  const first = state.shop.slots[0];
  const bought = applyAction(state, { type: 'buySkill', slotId: first.slotId, opId: 'skill-one', expectedRevision: state.revision }, customCtx);
  assert.equal(bought.state.skillRanks[first.skillId], 1);
  assert.equal(bought.state.gold, state.gold - first.price);
  bought.state.shop = { ...bought.state.shop, slots: [{ ...first, slotId: 'rank-one', price: 5 }] };
  const upgraded = applyAction(bought.state, { type: 'buySkill', slotId: 'rank-one', opId: 'skill-two', expectedRevision: bought.state.revision }, customCtx);
  assert.equal(upgraded.state.skillRanks[first.skillId], 2);
  upgraded.state.skillRanks[first.skillId] = 3;
  upgraded.state.shop.slots = [{ ...first, star: 3, slotId: 'rank-three', price: 20 }];
  const fourth = applyAction(upgraded.state, { type: 'buySkill', slotId: 'rank-three', opId: 'skill-four', expectedRevision: upgraded.state.revision }, customCtx);
  assert.equal(fourth.state.skillRanks[first.skillId], 4);
  const replay = applyAction(fourth.state, { type: 'buySkill', slotId: 'rank-three', opId: 'skill-four', expectedRevision: upgraded.state.revision }, customCtx);
  assert.strictEqual(replay.state, fourth.state);
  const enchantOffer = buildShopState({ ...structuredClone(state), day: 10, rngState: 173, nextShopDiscount: 0 }, customCtx, 'shop_enchant', {excludePurchaseCharIds:system.directors[0].coreCharIds});
  assert.equal(enchantOffer.slots.length, 1);
  assert.equal(enchantOffer.slots[0].star, 1, 'enchantment offers do not have independent quality tiers');
});

test('formal day quality never offers a starting rank with zero probability, then can offer it when unlocked', () => {
  const sample = createRun({ runId: 'skill-day-quality', seed: 707, directorId: system.directors[0].id }, ctx);
  const early = buildShopState({ ...structuredClone(sample), day: 1, skillRanks: {}, nextShopDiscount: 0, rngState: 707 }, ctx, 'shop_strategy');
  assert.ok(early.slots.filter(slot=>slot.skillId).every((slot) => slot.star >= system.strategySkills.find((skill) => skill.id === slot.skillId).startingStar));
  assert.ok(!early.slots.filter(slot=>slot.skillId).some((slot) => system.strategySkills.find((skill) => skill.id === slot.skillId).startingStar === 3));
  let lateHasThreeStar = false;
  for (let seed = 1; seed <= 50 && !lateHasThreeStar; seed += 1) {
    const late = buildShopState({ ...structuredClone(sample), day: 6, skillRanks: {}, nextShopDiscount: 0, rngState: seed * 65537 }, ctx, 'shop_strategy');
    lateHasThreeStar = late.slots.some((slot) => slot.skillId&&slot.star === 3 && system.strategySkills.find((skill) => skill.id === slot.skillId).startingStar === 3);
  }
  assert.equal(lateHasThreeStar, true);
});

test('every skill purchase and rank upgrade triggers their separate rule once, and failure/replay are atomic', () => {
  const customSystem = structuredClone(system);
  customSystem.strategySkills = [{ id: 'skill-fixture', name: 'Fixture', description: 'Fixture', startingStar: 1, prices: [5, 10, 20, 40], icon: { kind: 'GIcon', name: 'fixture' } }];
  customSystem.runLifecycleRules = [
    { id: 'bought', owner: { kind: 'skill', id: 'skill-fixture' }, event: 'skillBought', effects: [{ kind: 'enhance', target: 'team', stat: 'atk', mode: 'flat', amountByStar: [2, 2, 2, 2] }] },
    { id: 'upgraded', owner: { kind: 'skill', id: 'skill-fixture' }, event: 'skillUpgraded', effects: [{ kind: 'enhance', target: 'team', stat: 'atk', mode: 'flat', amountByStar: [2, 2, 2, 2] }] },
  ];
  const customCtx = { ...ctx, design: { ...ctx.design, system: customSystem } };
  const state = createRun({ runId: 'skill-events', seed: 808, directorId: system.directors[0].id }, customCtx);
  state.gold = 30;
  state.phase = 'shop';
  state.shop = { id: 'shop_strategy', kind: 'skill', slots: [{ slotId: 'skill', kind: 'skill', skillId: 'skill-fixture', name: 'Fixture', star: 1, price: 5 }], refreshCost: 1, refreshCount: 0 };
  const before = structuredClone(state);
  const poor = { ...structuredClone(state), gold: 4 };
  assert.throws(() => applyAction(poor, { type: 'buySkill', slotId: 'skill', opId: 'poor-skill', expectedRevision: poor.revision }, customCtx), { code: 'INSUFFICIENT_GOLD' });
  assert.deepEqual(poor, { ...before, gold: 4 });
  const bought = applyAction(state, { type: 'buySkill', slotId: 'skill', opId: 'buy-skill', expectedRevision: state.revision }, customCtx);
  assert.equal(bought.state.pieces[0].permanentFlat.atk, 2);
  bought.state.shop.slots = [{ slotId: 'skill-next', kind: 'skill', skillId: 'skill-fixture', name: 'Fixture', star: 1, price: 5 }];
  const upgraded = applyAction(bought.state, { type: 'buySkill', slotId: 'skill-next', opId: 'upgrade-skill', expectedRevision: bought.state.revision }, customCtx);
  assert.equal(upgraded.state.skillRanks['skill-fixture'], 2);
  assert.equal(upgraded.state.pieces[0].permanentFlat.atk, 6);
  const triggered = upgraded.state.history.filter((entry) => entry.kind === 'runLifecycleTriggered');
  assert.equal(triggered.filter((entry) => entry.ruleId === 'bought').length, 6);
  assert.equal(triggered.filter((entry) => entry.ruleId === 'upgraded').length, 3);
  const replay = applyAction(upgraded.state, { type: 'buySkill', slotId: 'skill-next', opId: 'upgrade-skill', expectedRevision: bought.state.revision }, customCtx);
  assert.strictEqual(replay.state, upgraded.state);
  assert.equal(replay.state.pieces[0].permanentFlat.atk, 6);
});

test('enchantments are atomic, merge into the surviving piece, survive compatible forms, and golden doubles sell proceeds', () => {
  const customSystem = structuredClone(system);
  customSystem.strategySkills = [];
  customSystem.enchantments = [
    { id: 'enchant_golden', name: 'Golden', price: 8, eligibility: 'instant', icon: { kind: 'GIcon', name: 'gold' }, battle: { kind: 'none', valuesByStar: [0, 0, 0, 0] } },
  ];
  customSystem.shopDefinitions = [...system.shopDefinitions,
    { id: 'shop_enchant', name: 'Enchant', kind: 'enchantment', unlockDay: 2, slots: 3, refreshCost: 1, maxRefreshes: 1, filter: { type: 'none' }, priceRule: { type: 'definitionPrices' }, supplyPolicy: 'distinctPurchaseIdentities' }];
  const customCtx = { ...ctx, catalog: structuredClone(ctx.catalog), design: { ...ctx.design, system: customSystem } };
  const id = 'char_002_amiya';
  for (const body of Object.values(customCtx.catalog.bodies)) body.fixedSkill = { kind: 'instant' };
  const state = createRun({ runId: 'enchant', seed: 101, directorId: system.directors[0].id }, customCtx);
  state.day = 2;
  const main = pieceFromBody(state, customCtx, id, 1, { star: 1, row: null, col: null });
  const secondary = pieceFromBody(state, customCtx, id, 1, { star: 1, row: null, col: null });
  secondary.enchantmentId = 'enchant_golden';
  const receiver = mergeInventory([main, secondary], customCtx)[0];
  assert.equal(receiver.uid, main.uid);
  assert.equal(receiver.enchantmentId, 'enchant_golden');
  state.pieces = [main];
  state.shop = buildShopState(state, customCtx, 'shop_enchant', {excludePurchaseCharIds:system.directors[0].coreCharIds});
  state.phase = 'shop';
  const offer = state.shop.slots[0];
  const before = structuredClone(state);
  const tooPoor = { ...state, gold: offer.price - 1 };
  assert.throws(() => applyAction(tooPoor, { type: 'enchantPiece', slotId: offer.slotId, uid: main.uid, opId: 'poor', expectedRevision: tooPoor.revision }, customCtx), { code: 'INSUFFICIENT_GOLD' });
  assert.deepEqual(tooPoor, { ...state, gold: offer.price - 1 });
  const applied = applyAction(state, { type: 'enchantPiece', slotId: offer.slotId, uid: main.uid, opId: 'apply-enchant', expectedRevision: state.revision }, customCtx);
  assert.equal(applied.state.pieces[0].enchantmentId, 'enchant_golden');
  assert.equal(calculateSellPrice(applied.state.pieces[0], customCtx, { phase: 'nodeChoice' }), 4);
  const invalid = structuredClone(before);
  invalid.pieces[0].enchantmentId = 'unknown';
  invalid.phase = 'nodeChoice';
  assert.throws(() => applyAction(invalid, { type: 'changeForm', uid: invalid.pieces[0].uid, charId: id, opId: 'invalid-form', expectedRevision: invalid.revision }, customCtx), { code: 'FORM_INVALIDATES_ENCHANTMENT' });
  customCtx.catalog.bodies['char_127_estell'].fixedSkill = { kind: 'passive' };
  const passive = pieceFromBody(state, customCtx, 'char_127_estell', 1, { row: null, col: null });
  const ineligible = { ...structuredClone(state), pieces: [...state.pieces, passive] };
  assert.throws(() => applyAction(ineligible, { type: 'enchantPiece', slotId: offer.slotId, uid: passive.uid, opId: 'passive-enchant', expectedRevision: ineligible.revision }, customCtx), { code: 'ENCHANTMENT_INELIGIBLE' });
});

test('formal skill rules affect actual operator purchase, skill rank, sale growth, and golden proceeds', () => {
  const state = createRun({ runId: 'formal-upgrades', seed: 103, directorId: system.directors[0].id }, ctx);
  state.gold = 200;
  state.skillRanks = { strategy_arms: 1, strategy_augmented: 3 };
  const purchaseCharId = 'char_127_estell';
  state.phase = 'shop';
  state.shop = { id: 'shop_base', kind: 'operator', slots: [{ slotId: 'buy-unit', purchaseCharId, charId: purchaseCharId, star: 1, requiredCopies: 1, price: identities.get(purchaseCharId).price }], refreshCost: 1, refreshCount: 0 };
  const bought = applyAction(state, { type: 'buy', slotId: 'buy-unit', opId: 'formal-unit', expectedRevision: state.revision }, ctx);
  const newPiece = bought.state.pieces.find((piece) => piece.purchaseCharId === purchaseCharId);
  assert.equal(newPiece.permanentFlat.maxHp, 10);
  bought.state.shop = { id: 'shop_strategy', kind: 'skill', slots: [{ slotId: 'catalytic', kind: 'skill', skillId: 'strategy_catalytic', star: 1, price: 5 }], refreshCost: 1, refreshCount: 0 };
  const learned = applyAction(bought.state, { type: 'buySkill', slotId: 'catalytic', opId: 'formal-skill', expectedRevision: bought.state.revision }, ctx);
  assert.equal(learned.state.skillRanks.strategy_catalytic, 1);
  assert.ok(learned.state.pieces.some((piece) => piece.permanentFlat.atk === 2));
  learned.state.shop = { id: 'shop_enchant', kind: 'enchantment', slots: [{ slotId: 'golden', kind: 'enchantment', enchantmentId: 'enchant_golden', name: '黄金', star: 1, price: 8 }], refreshCost: 1, refreshCount: 0 };
  const enchanted = applyAction(learned.state, { type: 'enchantPiece', slotId: 'golden', uid: newPiece.uid, opId: 'formal-golden', expectedRevision: learned.state.revision }, ctx);
  assert.equal(enchanted.state.pieces.find((piece) => piece.uid === newPiece.uid).enchantmentId, 'enchant_golden');
  const sold = applyAction(enchanted.state, { type: 'sell', uid: newPiece.uid, opId: 'formal-sale', expectedRevision: enchanted.state.revision }, ctx);
  const base = 2;
  assert.equal(sold.result.price, base * 2);
  assert.equal(sold.state.teamGrowth.atk, 1);
});

test('missing trusted callbacks fail without mutating battle or RNG state', () => {
  const noBattle = battleContext({ prepareBattle: undefined, settleBattle: undefined });
  let state = createRun({ runId: 'callbacks', seed: 19, directorId: system.directors[0].id }, noBattle);
  const node = state.nodes[0];
  state = applyAction(state, { type: 'selectNode', nodeId: node.id, opId: 'node', expectedRevision: 0 }, noBattle).state;
  if (state.phase !== 'battlePrep') {
    const battle = state.nodes.find((entry) => entry.kind === 'battle');
    state.phase = 'nodeChoice';
    state = applyAction(state, { type: 'selectNode', nodeId: battle.id, opId: 'node-battle', expectedRevision: state.revision }, noBattle).state;
  }
  const snapshot = structuredClone(state);
  assert.throws(() => applyAction(state, { type: 'readyBattle', opId: 'ready', expectedRevision: state.revision }, noBattle), { code: 'NOT_AVAILABLE' });
  assert.deepEqual(state, snapshot);
});

test('trusted defeat advances one hour without battle pay; lethal leaks end immediately', () => {
  const defeatCtx = battleContext({
    prepareBattle: (_state, encounter) => ({ battleId: `defeat-${encounter.id}` }),
    settleBattle: (_state, battle) => ({ battleId: battle.battleId, victory: false, leakedLife: 1 }),
  });
  const exercise = (runId, leakedLife) => {
    const context = { ...defeatCtx, settleBattle: (_state, battle) => ({ battleId: battle.battleId, victory: false, leakedLife }) };
    let state = createRun({ runId, seed: 51, directorId: system.directors[0].id }, context);
    const risk = state.nodes.find((node) => node.kind === 'battle');
    state = applyAction(state, { type: 'selectNode', nodeId: risk.id, opId: 'risk', expectedRevision: state.revision }, context).state;
    state = applyAction(state, { type: 'readyBattle', opId: 'ready', expectedRevision: state.revision }, context).state;
    return applyAction(state, { type: 'settleBattle', battleId: state.currentBattle.battleId, opId: 'settle', expectedRevision: state.revision }, context).state;
  };
  const advanced = exercise('defeated', 1);
  assert.equal(advanced.phase, 'nodeChoice');
  assert.equal(advanced.hour, 2);
  assert.equal(advanced.gold, 12);
  assert.equal(advanced.xp, 1);
  assert.equal(advanced.life, 19);
  const ended = exercise('lethal', 20);
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.hour, 1);
  assert.equal(ended.gold, 12);
  assert.equal(ended.xp, 1);
  assert.equal(ended.life, 0);
});

test('settlement accepts driver win/leak aliases and applies each permanent growth key once', () => {
  const driverCtx = battleContext({
    settleBattle: (_state, battle) => ({
      battleId: battle.battleId,
      won: true,
      leakLife: 2,
      permanentEffects: [{ uid: 'p1', effectKey: 'growth:attack:round-1', stat: 'attack', amount: 12 }],
    }),
  });
  let state = createRun({ runId: 'driver-settlement', seed: 51, directorId: system.directors[0].id }, driverCtx);
  const node = state.nodes.find((entry) => entry.kind === 'battle');
  state = applyAction(state, { type: 'selectNode', nodeId: node.id, opId: 'driver-node', expectedRevision: state.revision }, driverCtx).state;
  state = applyAction(state, { type: 'readyBattle', opId: 'driver-ready', expectedRevision: state.revision }, driverCtx).state;
  const pieceUid = state.pieces[0].uid;
  const outcome = applyAction(state, { type: 'settleBattle', battleId: state.currentBattle.battleId, opId: 'driver-settle', expectedRevision: state.revision }, driverCtx);
  assert.equal(outcome.result.victory, true);
  assert.equal(outcome.result.leakedLife, 2);
  assert.equal(outcome.state.life, 18);
  assert.equal(outcome.state.pieces.find((piece) => piece.uid === pieceUid).permanentFlat.attack, 12);
  assert.ok(outcome.state.claimed.includes(`permanent:battle:${state.currentBattle.battleId}:${pieceUid}:growth:attack:round-1`));
  const repeated = applyAction(outcome.state, { type: 'settleBattle', battleId: state.currentBattle.battleId, opId: 'driver-settle', expectedRevision: state.revision }, driverCtx);
  assert.deepEqual(repeated.result, outcome.result);
  assert.equal(repeated.state.pieces.find((piece) => piece.uid === pieceUid).permanentFlat.attack, 12);
});

test('tech crossing queues one free distinct-skill choice, supports pick/skip and does not backfill old tech', () => {
  const rewardSystem = structuredClone(system);
  rewardSystem.skillLevelRewards = [{ id: 'tech-two-fixture', tech: 2, star: 1, count: 4 }];
  const rewardCtx = { ...ctx, design: { ...ctx.design, system: rewardSystem } };
  const makeCrossing = (runId) => {
    const state = createRun({ runId, seed: 401, directorId: system.directors[0].id }, rewardCtx);
    assert.equal(state.pendingSkillRewards.length, 0);
    state.xp = rewardSystem.run.xpThresholds[1] - rewardSystem.run.xpPerHour;
    state.phase = 'shop';
    state.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
    return applyAction(state, { type: 'finishShop', opId: `${runId}:finish`, expectedRevision: state.revision }, rewardCtx).state;
  };
  const active = makeCrossing('skill-reward-pick');
  assert.equal(active.tech, 2);
  assert.equal(active.phase, 'skillChoice');
  assert.equal(active.pendingSkillRewards.length, 1);
  assert.equal(new Set(active.pendingSkillRewards[0].choices).size, 4);
  assert.deepEqual(viewRun(active, rewardCtx).skillRewards, { ...active.pendingSkillRewards[0], skippable: true });
  const beforeFailure = structuredClone(active);
  assert.throws(() => applyAction(active, { type: 'chooseSkill', skillId: 'not-offered', opId: 'bad-choice', expectedRevision: active.revision }, rewardCtx),
    { code: 'UNKNOWN_SKILL_REWARD_CHOICE' });
  assert.deepEqual(active, beforeFailure, 'failed choice is atomic');
  const chosenId = active.pendingSkillRewards[0].choices[0];
  const chosen = applyAction(active, { type: 'chooseSkill', skillId: chosenId, opId: 'skill-reward-choice', expectedRevision: active.revision }, rewardCtx);
  assert.equal(chosen.result.free, true);
  assert.equal(chosen.state.skillRanks[chosenId], 1);
  assert.equal(chosen.state.gold, active.gold);
  assert.equal(chosen.state.phase, 'nodeChoice');
  assert.equal(chosen.state.pendingSkillRewards.length, 0);
  assert.equal(chosen.state.history.at(-1).kind, 'skillRewardChosen');
  assert.strictEqual(applyAction(chosen.state, { type: 'chooseSkill', skillId: chosenId, opId: 'skill-reward-choice', expectedRevision: active.revision }, rewardCtx).state, chosen.state);

  const upgrade = createRun({ runId: 'skill-reward-upgrade', seed: 404, directorId: system.directors[0].id }, rewardCtx);
  for (const skill of rewardSystem.strategySkills) upgrade.skillRanks[skill.id] = 1;
  upgrade.xp = rewardSystem.run.xpThresholds[1] - rewardSystem.run.xpPerHour;
  upgrade.phase = 'shop';
  upgrade.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
  const upgradeChoice = applyAction(upgrade, { type: 'finishShop', opId: 'finish-upgrade-reward', expectedRevision: upgrade.revision }, rewardCtx).state;
  const upgradedId = upgradeChoice.pendingSkillRewards[0].choices[0];
  const freeUpgrade = applyAction(upgradeChoice, { type: 'chooseSkill', skillId: upgradedId, opId: 'free-rank-up', expectedRevision: upgradeChoice.revision }, rewardCtx);
  assert.equal(freeUpgrade.result.previousRank, 1);
  assert.equal(freeUpgrade.result.rank, 2);
  assert.equal(freeUpgrade.state.gold, upgradeChoice.gold);

  const catalytic = system.strategySkills.find((skill) => skill.id === 'strategy_catalytic');
  const catalyticCtx = { ...ctx, design: { ...ctx.design, system: { ...structuredClone(system),
    strategySkills: [catalytic], skillLevelRewards: [{ id: 'catalytic-reward-fixture', tech: 2, star: 1, count: 4 }],
    runLifecycleRules: system.runLifecycleRules.filter((rule) => rule.id === 'catalytic_upgrade_growth') } } };
  const catalyticState = createRun({ runId: 'skill-reward-lifecycle', seed: 407, directorId: system.directors[0].id }, catalyticCtx);
  catalyticState.skillRanks[catalytic.id] = 1;
  catalyticState.xp = catalyticCtx.design.system.run.xpThresholds[1] - catalyticCtx.design.system.run.xpPerHour;
  catalyticState.phase = 'shop';
  catalyticState.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
  const catalyticChoice = applyAction(catalyticState, { type: 'finishShop', opId: 'finish-catalytic', expectedRevision: catalyticState.revision }, catalyticCtx).state;
  const targetUid = catalyticChoice.pieces[0].uid;
  const beforeAtk = catalyticChoice.pieces[0].permanentFlat.atk || 0;
  const catalyticUpgrade = applyAction(catalyticChoice, { type: 'chooseSkill', skillId: catalytic.id, opId: 'free-catalytic-upgrade', expectedRevision: catalyticChoice.revision }, catalyticCtx).state;
  assert.equal(catalyticUpgrade.pieces.find((piece) => piece.uid === targetUid).permanentFlat.atk, beforeAtk + 4);
  assert.ok(catalyticUpgrade.history.some((entry) => entry.kind === 'runLifecycleTriggered' && entry.ruleId === 'catalytic_upgrade_growth'));

  const multiSystem = structuredClone(system);
  multiSystem.operatorUpgradeRewards = [];
  multiSystem.skillLevelRewards = [{ id: 'multi-tech-two', tech: 2, star: 1, count: 4 }, { id: 'multi-tech-four', tech: 4, star: 2, count: 3 }];
  const multiCtx = { ...ctx, design: { ...ctx.design, system: multiSystem } };
  const multi = createRun({ runId: 'skill-reward-multi', seed: 408, directorId: system.directors[0].id }, multiCtx);
  multi.xp = multiSystem.run.xpThresholds[3] - multiSystem.run.xpPerHour;
  multi.phase = 'shop';
  multi.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
  const multiActive = applyAction(multi, { type: 'finishShop', opId: 'finish-multi', expectedRevision: multi.revision }, multiCtx).state;
  assert.equal(multiActive.pendingSkillRewards.length, 2);
  const firstRewardSkill = multiActive.pendingSkillRewards[0].choices[0];
  const nextReward = applyAction(multiActive, { type: 'chooseSkill', skillId: firstRewardSkill, opId: 'choose-multi-first', expectedRevision: multiActive.revision }, multiCtx).state;
  assert.equal(nextReward.phase, 'skillChoice');
  assert.equal(nextReward.pendingSkillRewards.length, 1);
  assert.ok(nextReward.pendingSkillRewards[0].choices.length > 0, 'the next queued reward activates immediately');

  const skipped = makeCrossing('skill-reward-skip');
  const skipResult = applyAction(skipped, { type: 'skipSkillReward', opId: 'skip-reward', expectedRevision: skipped.revision }, rewardCtx);
  assert.equal(skipResult.state.phase, 'nodeChoice');
  assert.equal(skipResult.state.pendingSkillRewards.length, 0);
  assert.equal(skipResult.state.gold, skipped.gold);
  assert.equal(skipResult.state.history.at(-1).kind, 'skillRewardSkipped');

  const legacyTech = createRun({ runId: 'skill-reward-no-catchup', seed: 405, directorId: system.directors[0].id }, rewardCtx);
  legacyTech.tech = 2;
  legacyTech.xp = rewardSystem.run.xpThresholds[1];
  legacyTech.phase = 'shop';
  legacyTech.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
  const noCatchup = applyAction(legacyTech, { type: 'finishShop', opId: 'old-tech-hour', expectedRevision: legacyTech.revision }, rewardCtx).state;
  assert.equal(noCatchup.phase, 'nodeChoice');
  assert.equal(noCatchup.pendingSkillRewards.length, 0, 'an old save already at the tech threshold is not retroactively granted');
});

test('empty skill reward pool grants four gold, and a terminal run keeps queued reward without revival', () => {
  const emptySystem = structuredClone(system);
  emptySystem.strategySkills = [];
  emptySystem.skillLevelRewards = [{ id: 'empty-pool-fixture', tech: 2, star: 1, count: 4 }];
  const emptyCtx = { ...ctx, design: { ...ctx.design, system: emptySystem } };
  const state = createRun({ runId: 'skill-reward-empty', seed: 402, directorId: system.directors[0].id }, emptyCtx);
  state.xp = emptySystem.run.xpThresholds[1] - emptySystem.run.xpPerHour;
  state.phase = 'shop';
  state.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
  const compensated = applyAction(state, { type: 'finishShop', opId: 'empty-reward', expectedRevision: state.revision }, emptyCtx).state;
  assert.equal(compensated.gold, state.gold + 4);
  assert.equal(compensated.phase, 'nodeChoice');
  assert.equal(compensated.pendingSkillRewards.length, 0);
  assert.equal(compensated.history.at(-1).kind, 'skillRewardCompensated');

  const terminalSystem = structuredClone(system);
  terminalSystem.skillLevelRewards = [{ id: 'terminal-fixture', tech: 2, star: 1, count: 4 }];
  const terminalCtx = { ...ctx, design: { ...ctx.design, system: terminalSystem } };
  const terminal = createRun({ runId: 'skill-reward-terminal', seed: 403, directorId: system.directors[0].id }, terminalCtx);
  terminal.day = 10;
  terminal.hour = 6;
  terminal.currentNode = { kind: 'battle', battleKind: 'final', encounterId: encounters.encounters.find((entry) => entry.kind === 'final').id };
  terminal.currentBattle = { battleId: 'terminal-battle', encounterId: terminal.currentNode.encounterId };
  terminal.phase = 'battle';
  terminal.xp = terminalSystem.run.xpThresholds[1] - terminalSystem.run.xpPerHour;
  terminalCtx.settleBattle = (_state, battle) => ({ battleId: battle.battleId, victory: false, leakedLife: 20 });
  const ended = applyAction(terminal, { type: 'settleBattle', battleId: 'terminal-battle', opId: 'terminal-settle', expectedRevision: terminal.revision }, terminalCtx).state;
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.life, 0);
  assert.equal(ended.pendingSkillRewards.length, 1);
  assert.equal(ended.completed, false);
});

test('operator upgrade reward is a free direct star projection that preserves identity and activates unlocked modules', () => {
  const rewardSystem = structuredClone(system);
  rewardSystem.skillLevelRewards = [];
  rewardSystem.operatorUpgradeRewards = [{ id: 'held-upgrade-fixture', tech: 2, maxStar: 2, count: 4 }];
  const rewardCtx = { ...ctx, design: { ...ctx.design, system: rewardSystem } };
  const state = createRun({ runId: 'operator-upgrade-reward', seed: 611, directorId: system.directors[0].id }, rewardCtx);
  let target = state.pieces.find((piece) => piece.purchaseCharId === 'char_290_vigna');
  if (!target) {
    target = pieceFromBody(state, rewardCtx, 'char_290_vigna');
    state.pieces.push(target);
  }
  rewardSystem.runLifecycleRules = [{ id: 'fixture_operator_upgrade_currency', owner: { kind: 'operator', id: target.purchaseCharId },
    event: 'upgrade', effects: [{ kind: 'currency', currency: 'gold', amountByStar: [1, 2, 3, 4] }] }];
  target.star = 2;
  target.sourceCopies = 1;
  const preservedPiece = structuredClone(target);
  const identity = { uid: target.uid, sourceCopies: target.sourceCopies, purchaseCharId: target.purchaseCharId,
    row: target.row, col: target.col, permanentFlat: structuredClone(target.permanentFlat), enchantmentId: target.enchantmentId };
  state.xp = rewardSystem.run.xpThresholds[1] - rewardSystem.run.xpPerHour;
  state.phase = 'shop';
  state.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
  const offered = applyAction(state, { type: 'finishShop', opId: 'upgrade-reward-finish', expectedRevision: state.revision }, rewardCtx).state;
  assert.equal(offered.phase, 'upgradeChoice');
  assert.ok(offered.pendingUpgradeRewards[0].choices.includes(target.uid));
  assert.deepEqual(viewRun(offered, rewardCtx).upgradeRewards, { ...offered.pendingUpgradeRewards[0], skippable: true });
  const rng = offered.rngState;
  const chosen = applyAction(offered, { type: 'chooseUpgrade', uid: target.uid, opId: 'upgrade-reward-choose', expectedRevision: offered.revision }, rewardCtx);
  const after = chosen.state.pieces.find((piece) => piece.uid === target.uid);
  assert.equal(chosen.result.star, 3);
  assert.equal(chosen.state.gold, offered.gold + 3, 'the configured upgrade lifecycle rule resolves at the resulting star');
  assert.equal(after.star, 3);
  assert.equal(after.sourceCopies, identity.sourceCopies);
  assert.equal(after.purchaseCharId, identity.purchaseCharId);
  assert.equal(after.row, identity.row);
  assert.equal(after.col, identity.col);
  assert.deepEqual(after.permanentFlat, identity.permanentFlat);
  assert.equal(after.enchantmentId, identity.enchantmentId);
  assert.equal(after.moduleChoices[target.charId], 'uniequip_002_vigna', 'the result projection selects the module unlocked at three stars');
  const actualPreserved = structuredClone(after);
  delete preservedPiece.star;
  delete preservedPiece.moduleChoices;
  delete actualPreserved.star;
  delete actualPreserved.moduleChoices;
  assert.deepEqual(actualPreserved, preservedPiece, 'deployment, forms, presets, growth, claims and other piece state survive the direct upgrade');
  assert.equal(chosen.state.pieces.length, offered.pieces.length);
  assert.equal(chosen.state.nextPieceId, offered.nextPieceId);
  assert.equal(chosen.state.rngState, rng, 'applying the selected upgrade itself does not advance run RNG');
  assert.ok(after.forms.every((formId) => Object.hasOwn(after.moduleChoices, formId)));
  assert.equal(chosen.state.phase, 'nodeChoice');
  assert.ok(chosen.state.history.some((entry) => entry.kind === 'runLifecycleTriggered' && entry.event === 'upgrade'));
  assert.strictEqual(applyAction(chosen.state, { type: 'chooseUpgrade', uid: target.uid, opId: 'upgrade-reward-choose', expectedRevision: offered.revision }, rewardCtx).state, chosen.state);

  const skip = createRun({ runId: 'operator-upgrade-skip', seed: 612, directorId: system.directors[0].id }, rewardCtx);
  skip.xp = rewardSystem.run.xpThresholds[1] - rewardSystem.run.xpPerHour;
  skip.phase = 'shop';
  skip.shop = { id: 'shop_base', slots: [], refreshCost: 0, refreshCount: 0 };
  const skipOffer = applyAction(skip, { type: 'finishShop', opId: 'upgrade-skip-finish', expectedRevision: skip.revision }, rewardCtx).state;
  const skipResult = applyAction(skipOffer, { type: 'skipUpgradeReward', opId: 'upgrade-skip', expectedRevision: skipOffer.revision }, rewardCtx);
  assert.equal(skipResult.state.phase, 'nodeChoice');
  assert.equal(skipResult.state.gold, skipOffer.gold);
  assert.equal(skipResult.state.pieces[0].star, 1);
});

test('relic choice keeps priority over a simultaneous tech reward until its safe hour advance', () => {
  const rewardSystem = structuredClone(system);
  rewardSystem.skillLevelRewards = [{ id: 'priority-fixture', tech: 2, star: 1, count: 4 }];
  const rewardCollectibles = structuredClone(collectibles);
  rewardCollectibles.items.push({ id: 'fixture-battle-relic', name: '测试收藏品', rarity: 'common', track: 'leader', unlockDay: 1,
    acquisition: [{ type: 'reward', source: 'battle' }], effects: [] });
  const rewardCtx = { ...ctx, design: { ...ctx.design, system: rewardSystem, collectibles: rewardCollectibles },
    settleBattle: (_state, battle) => ({ battleId: battle.battleId, victory: true, leakedLife: 0 }) };
  const state = createRun({ runId: 'skill-reward-relic-priority', seed: 406, directorId: system.directors[0].id }, rewardCtx);
  state.hour = 6;
  state.xp = rewardSystem.run.xpThresholds[1] - rewardSystem.run.xpPerHour;
  const encounter = encounters.encounters.find((entry) => entry.kind === 'risk');
  state.currentNode = { kind: 'battle', battleKind: 'risk', encounterId: encounter.id };
  state.currentBattle = { battleId: 'priority-battle', encounterId: encounter.id };
  state.phase = 'battle';
  const settled = applyAction(state, { type: 'settleBattle', battleId: 'priority-battle', opId: 'priority-settle', expectedRevision: state.revision }, rewardCtx).state;
  assert.equal(settled.phase, 'rewards');
  assert.equal(settled.rewardQueue.kind, 'relic');
  assert.equal(viewRun(settled, rewardCtx).skillRewards, null);
  assert.equal(settled.pendingSkillRewards.length, 1);
  const advanced = applyAction(settled, { type: 'chooseRelic', relicId: settled.rewardQueue.choices[0], opId: 'choose-relic-first', expectedRevision: settled.revision }, rewardCtx).state;
  assert.equal(advanced.phase, 'skillChoice');
  assert.equal(advanced.day, 2);
});
