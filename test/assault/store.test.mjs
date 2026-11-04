import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { getAssaultData } from '../../server/modes/assault/data.js';
import { createAssaultStore } from '../../server/modes/assault/store.js';
import { applyAction, createRun } from '../../shared/assault/run.js';
import { repairLegacyShopSupply } from '../../shared/assault/shops.js';
import { addBodyToInventory } from '../../shared/assault/inventory.js';

const { runtime, nativeData } = getAssaultData();
const context = createAssaultContext({ runtime, data: nativeData });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'assault-store-'));
  return { root, store: createAssaultStore({ root: path.resolve(root), context }) };
}

function selectElementShop(state) {
  return selectShop(state, 'shop_archetype_element');
}

function selectShop(state, shopId) {
  const node = { id: `legacy-${shopId}`, kind: 'shop', shopId, name: '测试商店' };
  state.nodeChoices = [node];
  return applyAction(state, { type: 'selectNode', nodeId: node.id, opId: `${state.runId}:select-element`, expectedRevision: state.revision }, context).state;
}

function makeLegacyEmptyShop(state) {
  state.shop.slots = [];
  delete state.shop.supplyVersion;
  return state;
}

test('assault store writes a real run atomically and reloads it without memory state', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000001', seed: 7, directorId: context.design.system.directors[0].id }, context);
  await store.create(state);
  const reloaded = await store.load(state.runId);
  assert.deepEqual(reloaded, JSON.parse(JSON.stringify(state)));
  assert.equal(JSON.parse(await readFile(store.pathFor(state.runId), 'utf8')).schema, 'assault-run/v1');
});

test('a legal owner-specific sentry command survives save and restart while unknown or foreign markers stay invalid',async t=>{
  const {root,store}=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));
  const state=createRun({runId:'00000000-0000-4000-8000-000000000081',seed:81,directorId:'director_svash2'},context);state.pieces=[];
  const owner=addBodyToInventory(state,context,'char_4087_ines',1,{row:null,col:null});
  const tiles=[...context.fieldFor(state).normalizedDeployMap.keys()].map(k=>k.split(',').map(Number));
  const spot=tiles.find(([r,c])=>context.canPlace(state,owner,r,c));assert.ok(spot);[owner.row,owner.col]=spot;
  const tile=tiles.find(([r,c])=>context.canPlaceSummon(state,owner,r,c,{tokenId:'ines-sentry',index:0}));assert.ok(tile);
  const next=applyAction(state,{type:'setSummonPreset',uid:owner.uid,index:0,tokenId:'ines-sentry',row:tile[0],col:tile[1],dir:'E',opId:'sentry',expectedRevision:state.revision},context).state;
  await store.create(next);const reloaded=await createAssaultStore({root,context}).load(next.runId);
  assert.deepEqual(reloaded.pieces[0].summonPresets,next.pieces[0].summonPresets);
  const unknown=structuredClone(next);unknown.pieces[0].summonPresets[0].tokenId='unknown-marker';assert.throws(()=>store.validate(unknown),{code:'INVALID_RUN'});
  const foreign=createRun({runId:'00000000-0000-4000-8000-000000000082',seed:82,directorId:'director_ironmn'},context);
  foreign.pieces[0].summonPresets=structuredClone(next.pieces[0].summonPresets);assert.throws(()=>store.validate(foreign),{code:'INVALID_RUN'});
});

test('store accepts legacy runs without skill rewards and validates a pending reward against configured skills', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = createRun({ runId: '00000000-0000-4000-8000-000000000071', seed: 71, directorId: context.design.system.directors[0].id }, context);
  delete legacy.pendingSkillRewards;
  assert.equal(store.validate(legacy), true, 'legacy run remains valid and is not backfilled');

  const reward = context.design.system.skillLevelRewards[0];
  const candidate = context.design.system.strategySkills.find((skill) => skill.startingStar <= reward.star);
  assert.ok(reward && candidate, 'formal data supplies a valid reward fixture');
  const active = createRun({ runId: '00000000-0000-4000-8000-000000000072', seed: 72, directorId: context.design.system.directors[0].id }, context);
  active.tech = reward.tech;
  active.xp = context.design.system.run.xpThresholds[reward.tech - 1];
  active.phase = 'skillChoice';
  active.claimed.push(`skill-level-reward:${reward.id}`);
  active.pendingSkillRewards = [{ id: reward.id, star: reward.star, count: reward.count, choices: [candidate.id] }];
  assert.equal(store.validate(active), true);
  active.pendingSkillRewards[0].choices = ['unknown-skill'];
  assert.throws(() => store.validate(active), { code: 'INVALID_RUN' });
});

test('store validates upgrade reward candidates, cross-kind tech order, and legacy skill entries without tech', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000073', seed: 73, directorId: context.design.system.directors[0].id }, context);
  const skill = context.design.system.skillLevelRewards.find((entry) => entry.tech < context.design.system.operatorUpgradeRewards[0].tech);
  const skillCandidate = context.design.system.strategySkills.find((entry) => entry.startingStar <= skill.star);
  const upgrade = context.design.system.operatorUpgradeRewards[0];
  state.tech = upgrade.tech;
  state.xp = context.design.system.run.xpThresholds[upgrade.tech - 1];
  state.phase = 'skillChoice';
  state.claimed.push(`skill-level-reward:${skill.id}`, `operator-upgrade-reward:${upgrade.id}`);
  state.pendingSkillRewards = [{ id: skill.id, star: skill.star, count: skill.count, choices: [skillCandidate.id] }];
  state.pendingUpgradeRewards = [{ id: upgrade.id, maxStar: upgrade.maxStar, count: upgrade.count }];
  assert.equal(store.validate(state), true, 'legacy skill entries without tech remain valid and order uses configured tech');

  const wrongOrder = structuredClone(state);
  wrongOrder.phase = 'upgradeChoice';
  wrongOrder.pendingUpgradeRewards[0].choices = [wrongOrder.pieces.find((piece) => piece.star <= upgrade.maxStar).uid];
  wrongOrder.pendingSkillRewards[0].choices = undefined;
  assert.throws(() => store.validate(wrongOrder), { code: 'INVALID_RUN' }, 'later tech cannot activate ahead of an earlier skill reward');

  const badTech = structuredClone(state);
  badTech.pendingSkillRewards[0].tech = skill.tech + 1;
  assert.throws(() => store.validate(badTech), { code: 'INVALID_RUN' });
  const duplicate = structuredClone(state);
  duplicate.pendingSkillRewards.push({ ...duplicate.pendingSkillRewards[0], choices: undefined });
  assert.throws(() => store.validate(duplicate), { code: 'INVALID_RUN' });
});

test('store accepts directly upgraded operators while preserving sourceCopies', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000074', seed: 74, directorId: context.design.system.directors[0].id }, context);
  const piece = state.pieces[0];
  piece.star = 2;
  piece.sourceCopies = 1;
  assert.equal(store.validate(state), true, 'direct reward upgrades keep actual copy count');
});

test('legacy empty element shop repairs once through the locked load path and preserves run economy/state', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const beforeSelect = createRun({ runId: '00000000-0000-4000-8000-000000000031', seed: 31, directorId: 'director_svash2' }, context);
  const originalRng = beforeSelect.rngState;
  const legacy = makeLegacyEmptyShop(selectElementShop(beforeSelect));
  legacy.rngState = originalRng;
  const preserved = { gold: legacy.gold, day: legacy.day, hour: legacy.hour, tech: legacy.tech,
    pieces: structuredClone(legacy.pieces), refreshCount: legacy.shop.refreshCount, refreshCost: legacy.shop.refreshCost };
  await store.create(legacy);

  const migrated = await store.load(legacy.runId);
  assert.equal(migrated.shop.slots.length, context.design.system.shopDefinitions.find((entry) => entry.id === 'shop_archetype_element').slots);
  assert.ok(migrated.shop.slots.every((slot) => slot.profession && slot.price === 4 * slot.requiredCopies));
  assert.equal(migrated.shop.supplyVersion, 2);
  assert.deepEqual({ gold: migrated.gold, day: migrated.day, hour: migrated.hour, tech: migrated.tech,
    pieces: migrated.pieces, refreshCount: migrated.shop.refreshCount, refreshCost: migrated.shop.refreshCost }, preserved);
  assert.notEqual(migrated.rngState, originalRng, 'repair advances only the stock RNG');
  assert.equal(migrated.revision, legacy.revision + 1);
  assert.equal(migrated.opJournal.at(-1).action.type, 'shopSupplyMigration');
  assert.equal(migrated.history.at(-1).kind, 'shopSupplyMigrated');
  assert.deepEqual(await store.load(legacy.runId), migrated, 'later reads do not repair or increment again');
});

test('empty shop migration requires current-shop journal proof and refuses a shop already bought empty', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const unknown = createRun({ runId: '00000000-0000-4000-8000-000000000032', seed: 32, directorId: 'director_svash2' }, context);
  unknown.phase = 'shop';
  unknown.currentNode = { id: 'unproved-shop', kind: 'shop', shopId: 'shop_archetype_element' };
  unknown.shop = { id: 'shop_archetype_element', slots: [], refreshCost: 2, refreshCount: 0, consumedNextShopDiscount: 0 };
  await store.create(unknown);
  assert.deepEqual(await store.load(unknown.runId), JSON.parse(JSON.stringify(unknown)), 'unknown provenance stays untouched');

  let selected = selectElementShop(createRun({ runId: '00000000-0000-4000-8000-000000000033', seed: 33,
    directorId: 'director_svash2' }, context));
  selected.gold = 100;
  for (const [index, slot] of [...selected.shop.slots].entries()) {
    selected = applyAction(selected, { type: 'buy', slotId: slot.slotId, opId: `${selected.runId}:buy-${index}`,
      expectedRevision: selected.revision }, context).state;
  }
  assert.equal(selected.shop.slots.length, 0);
  makeLegacyEmptyShop(selected);
  await store.create(selected);
  const read = await store.load(selected.runId);
  assert.deepEqual(read, JSON.parse(JSON.stringify(selected)), 'a buy after the latest shop supply event proves the empty shop is intentional');

  const exhausted = makeLegacyEmptyShop(selectElementShop(createRun({ runId: '00000000-0000-4000-8000-000000000035', seed: 35,
    directorId: 'director_svash2' }, context)));
  for (const operator of Object.values(context.catalog.operators).filter((entry) => entry.archetype === 'element'))
    exhausted.pieces.push({ purchaseCharId: operator.charId, sourceCopies: context.design.system.run.sourceCapPerBody });
  for(const id of context.design.system.directors.find(d=>d.id===exhausted.directorId).coreCharIds){
    const own=exhausted.pieces.find(p=>p.purchaseCharId===id);
    if(own)own.sourceCopies=context.design.system.run.sourceCapPerBody;
    else exhausted.pieces.push({purchaseCharId:id,sourceCopies:context.design.system.run.sourceCapPerBody});
  }
  assert.equal(repairLegacyShopSupply(exhausted, context), null, 'a proven empty shop with no remaining candidate is not repaired');
});

test('refreshing the element shop fills the same configured slots', () => {
  const state = selectElementShop(createRun({ runId: '00000000-0000-4000-8000-000000000034', seed: 34,
    directorId: 'director_svash2' }, context));
  const refreshed = applyAction(state, { type: 'refreshShop', opId: 'element-refresh', expectedRevision: state.revision }, context).state;
  assert.equal(refreshed.shop.refreshCount, 1);
  assert.equal(refreshed.shop.slots.length, context.design.system.shopDefinitions.find((entry) => entry.id === 'shop_archetype_element').slots);
  assert.ok(refreshed.shop.slots.every((slot) => slot.price === 4 * slot.requiredCopies));
});

test('legacy shop repair reapplies its consumed discount without mutating the run input', () => {
  const legacy = makeLegacyEmptyShop(selectElementShop(createRun({ runId: '00000000-0000-4000-8000-000000000036', seed: 36,
    directorId: 'director_svash2' }, context)));
  legacy.shop.consumedNextShopDiscount = 2;
  legacy.nextShopDiscount = 0;
  const before = structuredClone(legacy);
  const repair = repairLegacyShopSupply(legacy, context);
  assert.ok(repair);
  assert.ok(repair.shop.slots.every((slot) => slot.price === Math.max(1, 4 * slot.requiredCopies - 2)));
  assert.deepEqual(legacy, before, 'the pure repair helper leaves its input untouched');
  assert.equal(repair.shop.consumedNextShopDiscount, 2);
});

test('version-one duplicate supply migration excludes bought identities, preserves survivors, and is locked/idempotent', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  let legacy = selectShop(createRun({ runId: '00000000-0000-4000-8000-000000000041', seed: 41,
    directorId: 'director_svash2' }, context), 'shop_base');
  const gravelId = 'char_237_gravel';
  const retainedId = Object.keys(context.catalog.operators).find((id) => id !== gravelId && context.catalog.operators[id].price === 2);
  const slot = (purchaseCharId, index) => {
    const operator = context.catalog.operators[purchaseCharId];
    return { slotId: `shop_base:${index}`, purchaseCharId, charId: purchaseCharId, name: operator.name,
      profession: operator.profession, basePrice: operator.price, price: operator.price, star: 1, requiredCopies: 1, offered: true };
  };
  legacy.shop.slots = [slot(gravelId, 0), slot(retainedId, 1), slot(gravelId, 2), slot(gravelId, 3), slot(gravelId, 4)];
  legacy.shop.supplyVersion = 1;
  const firstSurvivor = structuredClone(legacy.shop.slots[1]);
  const bought = applyAction(legacy, { type: 'buy', slotId: 'shop_base:0', opId: 'legacy-buy-gravel',
    expectedRevision: legacy.revision }, context).state;
  const oldGold = bought.gold;
  const oldPieces = structuredClone(bought.pieces);
  const oldDiscount = bought.nextShopDiscount;
  delete bought.shop.supplyVersion;
  await store.create(bought);
  const [migrated, concurrent] = await Promise.all([store.load(bought.runId), store.load(bought.runId)]);
  assert.deepEqual(concurrent, migrated);
  assert.equal(migrated.shop.supplyVersion, 2);
  assert.equal(migrated.shop.slots.length, 3);
  assert.equal(new Set(migrated.shop.slots.map((offer) => offer.purchaseCharId)).size, 3);
  assert.ok(!migrated.shop.slots.some((offer) => offer.purchaseCharId === gravelId), 'a purchased duplicate identity is not reissued');
  assert.deepEqual(migrated.shop.slots.find((offer) => offer.slotId === firstSurvivor.slotId), firstSurvivor,
    'the earliest unsold offer retains its original slot, price, and star');
  assert.equal(migrated.gold, oldGold);
  assert.deepEqual(migrated.pieces, oldPieces);
  assert.equal(migrated.nextShopDiscount, oldDiscount);
  assert.equal(migrated.shop.refreshCount, bought.shop.refreshCount);
  assert.equal(migrated.shop.refreshCost, bought.shop.refreshCost);
  assert.equal(migrated.revision, bought.revision + 1);
  assert.equal(migrated.opJournal.at(-1).action.type, 'shopSupplyMigration');
  assert.equal(migrated.history.at(-1).kind, 'shopSupplyMigrated');
  assert.equal(migrated.history.filter((entry) => entry.kind === 'shopSupplyMigrated').length, 1);
});

test('legacy migration detects a bought identity that appears once among otherwise unique remaining offers', () => {
  let legacy = selectShop(createRun({ runId: '00000000-0000-4000-8000-000000000043', seed: 43,
    directorId: 'director_svash2' }, context), 'shop_base');
  const gravelId = 'char_237_gravel';
  const others = Object.keys(context.catalog.operators).filter((id) => id !== gravelId
    && [2, 3, 4, 6, 8, 12].includes(context.catalog.operators[id].price)).slice(0, 3);
  const makeSlot = (purchaseCharId, index) => {
    const operator = context.catalog.operators[purchaseCharId];
    return { slotId: `shop_base:${index}`, purchaseCharId, charId: purchaseCharId, name: operator.name,
      profession: operator.profession, basePrice: operator.price, price: operator.price, star: 1, requiredCopies: 1, offered: true };
  };
  legacy.shop.slots = [makeSlot(gravelId, 0), makeSlot(others[0], 1), makeSlot(gravelId, 2),
    makeSlot(others[1], 3), makeSlot(others[2], 4)];
  const bought = applyAction(legacy, { type: 'buy', slotId: 'shop_base:0', opId: 'legacy-single-gravel',
    expectedRevision: legacy.revision }, context).state;
  bought.shop.supplyVersion = 1;
  assert.equal(new Set(bought.shop.slots.map((offer) => offer.purchaseCharId)).size, bought.shop.slots.length,
    'only one gravel remains, so the remaining offers appear unique');
  const repair = repairLegacyShopSupply(bought, context);
  assert.ok(repair, 'the journal proves gravel was bought while another gravel remains offered');
  assert.ok(!repair.shop.slots.some((offer) => offer.purchaseCharId === gravelId));
  assert.equal(repair.shop.slots.length, context.design.system.shopDefinitions.find((entry) => entry.id === 'shop_base').slots);
  assert.deepEqual(repair.shop.slots.find((offer) => offer.slotId === 'shop_base:1'), bought.shop.slots.find((offer) => offer.slotId === 'shop_base:1'));
});

test('unique legacy supply stays unchanged and version one remains readable', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = selectShop(createRun({ runId: '00000000-0000-4000-8000-000000000042', seed: 42,
    directorId: 'director_svash2' }, context), 'shop_base');
  state.shop.supplyVersion = 1;
  await store.create(state);
  assert.deepEqual(await store.load(state.runId), JSON.parse(JSON.stringify(state)));
});

test('legacy deployment migration repairs once through the locked atomic load path', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000011', seed: 17, directorId: 'director_svash2' }, context);
  const inferredEncounter = context.design.encounters.encounters.find((entry) => entry.kind === 'normal' && entry.id !== state.prepEncounterId);
  const sourceHistory = [...state.history, { kind: 'battleSettled', encounterId: inferredEncounter.id }];
  const sourceJournal = structuredClone(state.opJournal);
  await store.create(state);
  const legacy = structuredClone(state);
  delete legacy.prepEncounterId; delete legacy.prepDeploymentVersion; delete legacy.deploymentMigrationPending;
  legacy.currentNode = null; legacy.currentBattle = null; legacy.phase = 'nodeChoice'; legacy.history = sourceHistory;
  legacy.pieces[0].row = 20; legacy.pieces[0].col = 20;
  legacy.pieces[1].row = 11; legacy.pieces[1].col = null;
  legacy.pieces[2].row = 20; legacy.pieces[2].col = 20;
  legacy.pieces[0].summonPresets = [{ tokenId: context.catalog.bodies[legacy.pieces[0].charId].summonTemplateIds[0], row: 20, col: 20 }];
  const benchUid = legacy.pieces[2].uid;
  legacy.pieces[2].row = null; legacy.pieces[2].col = null;
  await writeFile(store.pathFor(state.runId), JSON.stringify(legacy), 'utf8');

  const migrated = await store.load(state.runId);
  assert.equal(migrated.prepEncounterId, sourceHistory.at(-1).encounterId, 'last settled native encounter is authoritative');
  assert.equal(migrated.revision, state.revision + 1);
  assert.deepEqual(migrated.opJournal.slice(0, sourceJournal.length), sourceJournal);
  assert.deepEqual(migrated.history.slice(0, sourceHistory.length), sourceHistory);
  assert.equal(migrated.history.at(-1).kind, 'deploymentMigrated');
  assert.ok(migrated.history.at(-1).changes.length >= 2, 'migration records old and repaired piece/preset coordinates');
  const bench = migrated.pieces.find((piece) => piece.uid === benchUid);
  assert.equal(bench.row, null); assert.equal(bench.col, null, 'legacy bench piece stays benched');
  for (const piece of migrated.pieces.filter((entry) => entry.row != null)) assert.equal(context.canPlace(migrated, piece, piece.row, piece.col), true);
  const summonOwner = migrated.pieces[0];
  const preset = summonOwner.summonPresets[0];
  assert.ok(!preset || context.canPlaceSummon(migrated, summonOwner, preset.row, preset.col, preset));
  assert.equal(preset,null,'an impossible legacy coordinate stays unplaced instead of moving automatically');
  assert.deepEqual(migrated.history.at(-1).changes.find(c=>c.kind==='summonPreset').from,legacy.pieces[0].summonPresets[0],
    'the migration keeps the entire original instruction');
  const repeated = await Promise.all([store.load(state.runId), store.load(state.runId)]);
  assert.deepEqual(repeated[0], migrated, 'concurrent load does not migrate or increment revision again');
  assert.deepEqual(repeated[1], migrated);
  const actionNode = migrated.nodeChoices[0];
  const acted = await store.withRun(state.runId, async (current) => {
    const next = applyAction(current, { type: 'selectNode', nodeId: actionNode.id, opId: 'post-migration-action', expectedRevision: current.revision }, context).state;
    await store.save(next);
    return next;
  });
  assert.equal(acted.revision, migrated.revision + 1, 'normal versioned run actions continue after migration');
  assert.equal((await store.load(state.runId)).history.filter((entry) => entry.kind === 'deploymentMigrated').length, 1);
});

test('legacy active battle defers coordinate repair until settlement and leaves prepared input untouched', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000012', seed: 19, directorId: 'director_svash2' }, context);
  const encounter=context.design.encounters.encounters.find(entry=>entry.kind==='normal');
  state.nodeChoices=[{id:encounter.id,kind:'battle',encounterId:encounter.id}];
  const node=state.nodeChoices[0];
  let selected = applyAction(state, { type: 'selectNode', nodeId: node.id, opId: 'old-select', expectedRevision: state.revision }, context).state;
  selected = applyAction(selected, { type: 'readyBattle', opId: 'old-ready', expectedRevision: selected.revision }, context).state;
  delete selected.prepEncounterId; delete selected.prepDeploymentVersion; delete selected.deploymentMigrationPending;
  let invalidTile;
  for (let row = 9; row <= 12 && !invalidTile; row += 1) for (let col = 2; col <= 10 && !invalidTile; col += 1)
    if (!context.canPlace(selected, selected.pieces[0], row, col)) invalidTile = [row, col];
  assert.ok(invalidTile);
  [selected.pieces[0].row, selected.pieces[0].col] = invalidTile;
  const expectedRevision = selected.revision;
  const expectedJournal = structuredClone(selected.opJournal);
  const expectedHistory = structuredClone(selected.history);
  const prepared = structuredClone(selected.currentBattle);
  await store.create(selected);
  const inBattle = await store.load(selected.runId);
  assert.deepEqual(inBattle, JSON.parse(JSON.stringify(selected)), 'legacy battle load does not rewrite any stored field');
  assert.equal(inBattle.phase, 'battle');
  assert.equal(inBattle.revision, expectedRevision);
  assert.deepEqual(inBattle.opJournal, expectedJournal);
  assert.deepEqual(inBattle.history, expectedHistory);
  assert.deepEqual(inBattle.currentBattle, prepared, 'prepared battle input remains byte-structure unchanged');
  assert.deepEqual([inBattle.pieces[0].row, inBattle.pieces[0].col], invalidTile, 'live battle board placements are not rewritten mid-battle');
  assert.deepEqual(await store.load(selected.runId), inBattle, 'repeated battle load leaves the complete state unchanged');

  const settleContext = { ...context, settleBattle: (_run, battle) => ({ battleId: battle.battleId, victory: true, leakedLife: 0 }) };
  const settled = await store.withRun(selected.runId, async (current) => {
    const outcome = applyAction(current, { type: 'settleBattle', battleId: current.currentBattle.battleId,
      opId: 'old-settle', expectedRevision: expectedRevision }, settleContext).state;
    await store.save(outcome);
    return outcome;
  });
  assert.equal(settled.revision, expectedRevision + 2, 'settlement and one migration each advance the native revision');
  assert.equal(settled.deploymentMigrationPending, false);
  const repaired = await store.load(selected.runId);
  assert.equal(repaired.prepDeploymentVersion, 1);
  assert.equal(context.canPlace(repaired, repaired.pieces[0], repaired.pieces[0].row, repaired.pieces[0].col), true);
  assert.equal(repaired.history.filter((entry) => entry.kind === 'deploymentMigrated').length, 1);
  assert.equal(repaired.revision, settled.revision, 'response state is already migrated; later load is read-only');
});

test('legacy ended run remains an unchanged archival record', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000013', seed: 20, directorId: 'director_svash2' }, context);
  state.phase = 'ended'; state.completed = true; state.currentNode = null;
  delete state.prepEncounterId; delete state.prepDeploymentVersion; delete state.deploymentMigrationPending;
  await store.create(state);
  const loaded = await store.load(state.runId);
  assert.deepEqual(loaded, JSON.parse(JSON.stringify(state)));
});

test('assault store retries a transient Windows rename denial against the same pending file', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000007', seed: 11, directorId: context.design.system.directors[0].id }, context);
  await store.create(state);
  const next = applyAction(state, { type: 'selectNode', nodeId: state.nodeChoices[0].id, opId: 'shop-select', expectedRevision: 0 }, context).state;
  const calls = [];
  const retryStore = createAssaultStore({
    root: path.resolve(root),
    context,
    renameFile: async (pending, target) => {
      calls.push({ pending, target });
      if (calls.length === 1) throw Object.assign(new Error('transient Windows rename denial'), { code: 'EPERM' });
      return rename(pending, target);
    },
  });

  await retryStore.save(next);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].pending, calls[1].pending);
  assert.equal(calls[0].target, calls[1].target);
  assert.equal((await retryStore.load(state.runId)).revision, 1);
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), []);
});

test('assault store preserves prior run and pending revision when rename remains denied', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000008', seed: 12, directorId: context.design.system.directors[0].id }, context);
  await store.create(state);
  const targetBefore = await readFile(store.pathFor(state.runId), 'utf8');
  const next = applyAction(state, { type: 'selectNode', nodeId: state.nodeChoices[0].id, opId: 'shop-select', expectedRevision: 0 }, context).state;
  let attempts = 0;
  const deniedStore = createAssaultStore({
    root: path.resolve(root),
    context,
    renameFile: async () => {
      attempts += 1;
      throw Object.assign(new Error('persistent Windows rename denial'), { code: 'EPERM' });
    },
  });

  await assert.rejects(() => deniedStore.save(next), { code: 'EPERM' });

  assert.equal(attempts, 6);
  assert.equal(await readFile(deniedStore.pathFor(state.runId), 'utf8'), targetBefore);
  assert.equal((await deniedStore.load(state.runId)).revision, 0);
  const pendingFiles = (await readdir(root)).filter((name) => name.endsWith('.tmp'));
  assert.equal(pendingFiles.length, 1);
  const pending = JSON.parse(await readFile(path.join(root, pendingFiles[0]), 'utf8'));
  assert.equal(pending.runId, state.runId);
  assert.equal(pending.revision, 1);
});

test('per-run queue continues after a failed task and serializes revisions', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000002', seed: 8, directorId: context.design.system.directors[0].id }, context);
  await store.create(state);
  await assert.rejects(() => store.withRun(state.runId, async () => { throw Object.assign(new Error('expected'), { code: 'EXPECTED' }); }), { code: 'EXPECTED' });
  const seen = await store.withRun(state.runId, async (current) => current.revision);
  assert.equal(seen, 0);
  const [first, second] = await Promise.all([
    store.withRun(state.runId, async (current) => { const next = structuredClone(current); next.revision += 1; next.opJournal.push({ opId: 'one', action: { opId: 'one', expectedRevision: 0 }, result: {} }); await store.save(next); return next.revision; }),
    store.withRun(state.runId, async (current) => current.revision),
  ]);
  assert.deepEqual([first, second], [1, 1]);
  assert.equal((await store.load(state.runId)).revision, 1);
});

test('malformed imported state is rejected before a file is created', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000003', seed: 9, directorId: context.design.system.directors[0].id }, context);
  state.pieces[1].sourceCopies = 3;
  await assert.rejects(() => store.importRun(state, '00000000-0000-4000-8000-000000000004'), { code: 'INVALID_RUN' });
  await assert.rejects(() => store.load('00000000-0000-4000-8000-000000000004'), { code: 'NOT_FOUND' });
});

test('persistent relic counters and percentage sources survive save/import and reject malformed projections', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createRun({ runId: '00000000-0000-4000-8000-000000000005', seed: 10, directorId: context.design.system.directors[0].id }, context);
  state.relicCounters = { 'pierce-altar': 10 };
  state.pieces[0].permanentPercentSources = { 'source:one': { atk: 0.1 }, 'source:two': { atk: 0.2, def: 0.05 } };
  state.pieces[0].permanentPercent = { atk: 0.1 + 0.2, def: 0.05 };
  await store.create(state);
  const imported = await store.importRun(await store.load(state.runId), '00000000-0000-4000-8000-000000000006');
  assert.deepEqual(imported.relicCounters, state.relicCounters);
  assert.deepEqual(imported.pieces[0].permanentPercentSources, state.pieces[0].permanentPercentSources);
  for (const change of [
    (run) => { run.relicCounters['pierce-altar'] = 11; },
    (run) => { run.relicCounters['pierce-altar'] = 1.5; },
    (run) => { run.relicCounters['unknown-relic'] = 1; },
    (run) => { run.pieces[0].permanentPercentSources['source:one'].atk = '0.1'; },
    (run) => { run.pieces[0].permanentPercentSources['source:one'].atk = 0.9; },
  ]) {
    const invalid = structuredClone(state); change(invalid);
    assert.throws(() => store.validate(invalid), { code: 'INVALID_RUN' });
  }
  const legacy = structuredClone(state);
  delete legacy.pieces[0].permanentPercentSources;
  assert.doesNotThrow(() => store.validate(legacy));
});

test('every shop a run can open stays valid for the store, also when it offers the leader core as an operator slot', () => {
  const definitions = context.design.system.shopDefinitions.filter((entry) => ['skill', 'enchantment', 'supply'].includes(entry.kind));
  assert.ok(definitions.length >= 3);
  let operatorSlots = 0;
  for (const director of context.design.system.directors) {
    for (const definition of definitions) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const state = createRun({ runId: `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`, seed, directorId: director.id }, context);
        state.day = 3; // a few stars and kinds only appear later
        let opened;
        try { opened = selectShop(state, definition.id); } catch (error) { if (/NOT_AVAILABLE|UNKNOWN_SHOP|SHOP/.test(String(error.code))) continue; throw error; }
        operatorSlots += (opened.shop?.slots ?? []).filter((slot) => slot.kind === 'operator').length;
        assert.equal(createAssaultStore({ root: os.tmpdir(), context }).validate(opened), true, `${director.id}/${definition.id}/${seed}`);
      }
    }
  }
  assert.ok(operatorSlots > 0, 'the fixture really reaches the core operator slot in a skill / enchantment / supply shop');
});
