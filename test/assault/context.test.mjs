import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getData } from '../../server/data.js';
import { createAssaultContext, withAssaultPreparedInputs } from '../../server/modes/assault/context.js';
import { createRun, applyAction } from '../../shared/assault/run.js';
import { getAssaultEncounter } from '../../server/modes/assault/data.js';
import { startServer } from '../../server/index.js';
import { createAssaultBattle, runAssaultBattle } from '../../server/modes/assault/battle.js';
import { createAssaultApi } from '../../public/js/assault/api.js';
import { addBodyToInventory, piecePopulationCost } from '../../shared/assault/inventory.js';
import { activePopulation, canDeployMore, deployCapacity, summonTemplateOptions } from '../../public/js/assault/model.js';
import { buildAssaultBattleInput } from '../../shared/assault/battle-input.js';
import { ownerRangeKeys } from '../../server/match/board.js';

const canonical = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const context = createAssaultContext({ data: getData() });

test('final assault projects every selectable manual instruction through the native board mapping without changing the save',()=>{
  const encounter=context.design.encounters.encounters.find(e=>e.kind==='final');let checked=0;
  for(const body of Object.values(context.runtime.bodies)){
    const options=summonTemplateOptions({runtime:context.runtime},{charId:body.charId});if(!options.length)continue;
    for(const option of options){
      const state=createRun({runId:`final-presets:${body.charId}:${option.tokenId}`,directorId:'director_angel2',seed:17},context);
      state.pieces=[];state.phase='battlePrep';state.currentNode={kind:'battle',encounterId:encounter.id};
      const owner=addBodyToInventory(state,context,body.charId,4,{star:3,row:null,col:null});let placement;
      const tiles=[...context.fieldFor(state).normalizedDeployMap.keys()].map(k=>k.split(',').map(Number));
      search:for(const[row,col]of tiles)for(const dir of ['E','N','W','S']){
        if(!context.canPlace(state,owner,row,col))continue;Object.assign(owner,{row,col,dir});
        const tile=tiles.find(([r,c])=>!(r===row&&c===col)&&context.canPlaceSummon(state,owner,r,c,{tokenId:option.tokenId,index:0}));
        if(tile){placement={tokenId:option.tokenId,row:tile[0],col:tile[1],dir};break search;}
      }
      if(!placement){
        const view=context.view(state).pieces.find(p=>p.uid===owner.uid);
        assert.deepEqual(view.summonLegalTiles[option.tokenId],[],`${body.charId}: unavailable native geometry is shown as no legal tiles`);
        continue;
      }
      owner.summonPresets=[placement];
      const original=JSON.stringify(state),prepared=context.prepareBattle(state,encounter),snapshot=JSON.stringify(prepared.input);
      const battle=createAssaultBattle(prepared,context);battle.flags.dpMax=999;battle.getPlayer('assault').dp=999;battle.start();
      const unit=battle.allyUnits.find(u=>u.uid===owner.uid),[row,col]=battle.mapTile(unit.player,placement.row,placement.col);
      assert.deepEqual(unit.def.raw.assaultPiece.summonPresets,[{...placement,row,col,dir:battle.mapDir(unit.player,placement.dir)}]);
      assert.equal(JSON.stringify(state),original);assert.equal(JSON.stringify(prepared.input),snapshot);
      assert.ok(battle.grid.inRect(row,col));assert.equal(battle.onOwnBoard(unit.player,row,col),true);
      if(body.adaptation.marker?.id===option.tokenId){assert.deepEqual(unit.mem.adaptInesShadow,{r:row,c:col,dir:battle.mapDir(unit.player,placement.dir)});}
      if(['char_2015_dusk','char_4072_ironmn','char_108_silent'].includes(body.charId)){
        unit.skill.charges=1;unit.skill.sp=unit.skill.spCost;assert.equal(battle.assaultRuntime.cast(unit,{force:true}),true);battle.assaultRuntime.flush();
        assert.ok(battle.allyUnits.some(t=>t.ownerUnit===unit&&t.defId===option.tokenId&&t.alive&&t.tileR===row&&t.tileC===col),`${body.charId}: the real summon uses that exact projected tile`);
      }
      assert.deepEqual(battle.errors,[],body.charId);checked++;
    }
  }
  assert.ok(checked>=20,`covered ${checked} actual manual options`);
});

test('Dusk preparation accepts an explicit summon tile in her original expanded skill range',()=>{
  const state=createRun({runId:'dusk-expanded-prep',directorId:'director_svash2',seed:17},context);
  const body=context.catalog.bodies.char_2015_dusk,piece={uid:'dusk',charId:body.charId,row:10,col:2,dir:'E',summonPresets:[]};
  state.pieces=[piece];
  const base=ownerRangeKeys(body.range,10,2,'RIGHT');
  const tile=[...context.fieldFor(state).normalizedDeployMap.keys()].map(k=>k.split(',').map(Number))
    .find(([r,c])=>!base.has(`${r},${c}`)&&context.canPlaceSummon(state,piece,r,c,{tokenId:'token_10015_dusk_drgn'}));
  assert.ok(tile,'preparation uses the native S3 range instead of rejecting its outer cells');
});

test('generated event nodes open and leave through the real run action API', () => {
  const state = createRun({ runId: 'generated-event', directorId: context.design.system.directors[0].id, seed: 20261009 }, context);
  const node = state.nodeChoices.find((entry) => entry.kind === 'event');
  assert.ok(node?.eventId);
  assert.ok(context.design.events.events.some((event) => event.id === node.eventId));
  const selected = applyAction(state, { type: 'selectNode', nodeId: node.id, opId: 'event:select', expectedRevision: state.revision }, context).state;
  assert.equal(selected.currentEvent.id, node.eventId);
  const left = applyAction(selected, { type: 'leaveEvent', opId: 'event:leave', expectedRevision: selected.revision }, context).state;
  assert.equal(left.hour, state.hour + 1);
  assert.ok(left.visitedEvents.includes(node.eventId));
});

test('createRun and selection reconcile all leaders against all 36 native encounter fields without deploying bench bodies', () => {
  const assertNativeLegal = (state, runContext = context) => {
    const seen = new Set();
    for (const piece of state.pieces.filter((entry) => entry.row != null)) {
      assert.equal(runContext.canPlace(state, piece, piece.row, piece.col), true, `${piece.charId} at ${piece.row},${piece.col}`);
      const key = `${piece.row},${piece.col}`;
      assert.equal(seen.has(key), false, `duplicate deployment ${key}`);
      seen.add(key);
    }
  };
  const encounters = context.design.encounters.encounters;
  assert.equal(encounters.length, 36);
  let forcedRelocations = 0;
  for (const director of context.design.system.directors) for (const encounter of encounters) {
    const state = createRun({ runId: `native-deploy-${director.id}-${encounter.id}`, directorId: director.id, seed: 20261010 }, context);
    assertNativeLegal(state);
    const preserved = structuredClone(state.pieces[0]);
    state.pieces[1].row = null; state.pieces[1].col = null;
    state.currentNode = { kind: 'battle', encounterId: encounter.id };
    const movedBefore = state.pieces[2];
    const invalid = [];
    for (let row = 9; row <= 12 && !invalid.length; row += 1) for (let col = 2; col <= 10 && !invalid.length; col += 1)
      if (!context.canPlace(state, movedBefore, row, col)) invalid.push([row, col]);
    if (invalid.length) { [movedBefore.row, movedBefore.col] = invalid[0]; forcedRelocations += 1; }
    state.currentNode = null;
    const node = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
      name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
    state.nodeChoices = [node];
    const selected = applyAction(state, { type: 'selectNode', nodeId: node.id, opId: `select-${encounter.id}`, expectedRevision: state.revision }, context).state;
    assert.deepEqual([selected.pieces[0].row, selected.pieces[0].col], [preserved.row, preserved.col], `${director.id}/${encounter.id}: legal tile preserved`);
    assert.equal(selected.pieces[1].row, null, `${director.id}/${encounter.id}: bench body remains benched`);
    if (invalid.length) assert.ok(selected.pieces[2].row !== invalid[0][0] || selected.pieces[2].col !== invalid[0][1], `${director.id}/${encounter.id}: invalid body was moved or benched`);
    assertNativeLegal(selected);
  }
  assert.ok(forcedRelocations > 0, 'the native encounter matrix exercises invalid stage placements');
});

test('battle settlement to shop retains its last native preparation field', () => {
  const testContext = { ...context, settleBattle: (_state, battle) => ({ battleId: battle.battleId, victory: true, leakedLife: 0 }) };
  let state = createRun({ runId: 'prep-field-persists', directorId: context.design.system.directors[0].id, seed: 21 }, testContext);
  const encounter = context.design.encounters.encounters.find((entry) => entry.kind === 'normal' && entry.dayRange[0] === 1);
  const node = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
    name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
  state.nodeChoices = [node];
  const act = (current, type, params = {}) => applyAction(current, { type, ...params, opId: `${current.revision}-${type}`, expectedRevision: current.revision }, testContext).state;
  state = act(state, 'selectNode', { nodeId: node.id });
  state = act(state, 'readyBattle');
  state = act(state, 'settleBattle', { battleId: state.currentBattle.battleId });
  assert.equal(state.currentNode, null);
  assert.equal(state.prepEncounterId, encounter.id);
  assert.equal(context.fieldFor(state).stageId, encounter.stageId);
  const shop = state.nodeChoices.find((entry) => entry.kind === 'shop');
  assert.ok(shop);
  state = act(state, 'selectNode', { nodeId: shop.id });
  assert.equal(context.fieldFor(state).stageId, encounter.stageId);
  const piece = state.pieces.find((entry) => entry.row != null);
  assert.equal(context.canPlace(state, piece, piece.row, piece.col), true);
  const invalidTile = [...context.fieldFor(state).normalizedDeployMap.keys()].map((key) => key.split(',').map(Number))
    .find(([row, col]) => !context.canPlace(state, piece, row, col));
  if (invalidTile) assert.throws(() => act(state, 'place', { uid: piece.uid, row: invalidTile[0], col: invalidTile[1], dir: 'E' }), { code: 'INVALID_TILE' });
  const nextEncounter=context.design.encounters.encounters.find(e=>e.kind==='normal'&&e.stageId!==encounter.stageId);
  assert.ok(nextEncounter);
  const afterShop=act(state,'finishShop');
  afterShop.nodeChoices=[{id:'next-map',kind:'battle',encounterId:nextEncounter.id,battleKind:'normal'}];
  const selected=act(afterShop,'selectNode',{nodeId:'next-map'});
  assert.equal(selected.mapEncounterId,afterShop.mapEncounterId,'selecting a later battle never replaces the run map');
  assert.equal(selected.prepEncounterId,nextEncounter.id,'the next battle still uses its own encounter waves');
  assert.equal(context.fieldFor(selected).stageId,encounter.stageId,'the whole run keeps the map fixed at run start');
});

test('three consecutive normal battles in one run share one stage while waves follow their own encounters', () => {
  const normals=context.design.encounters.encounters.filter(e=>e.kind==='normal');
  assert.ok(new Set(normals.map(e=>e.stageId)).size>1,'fixture needs encounters from different stages');
  const testContext = { ...context, settleBattle: (_state, battle) => ({ battleId: battle.battleId, victory: true, leakedLife: 0 }) };
  let state=createRun({ runId: 'one-map-per-run', directorId: context.design.system.directors[0].id, seed: 31 }, testContext);
  const fixedMap=state.mapEncounterId;
  const fixedStage=getAssaultEncounter(context.design,fixedMap).stageId;
  const act=(current,type,params={})=>applyAction(current,{type,...params,opId:`${current.revision}-${type}`,expectedRevision:current.revision},testContext).state;
  const stages=[];
  const waves=[];
  for(const encounter of normals.filter(e=>e.stageId!==fixedStage).slice(0,3)){
    state.nodeChoices=[{id:`n-${encounter.id}`,kind:'battle',battleKind:'normal',encounterId:encounter.id,title:encounter.name,
      name:encounter.name,rewards:encounter.rewards,boardRegion:encounter.boardRegion,stageId:encounter.stageId}];
    state=act(state,'selectNode',{nodeId:`n-${encounter.id}`});
    stages.push(context.fieldFor(state).stageId);
    waves.push(context.fieldFor(state).encounterId);
    state=act(state,'readyBattle');
    state=act(state,'settleBattle',{battleId:state.currentBattle.battleId});
    for(let guard=0;guard<8&&state.phase!=='nodeChoice';guard+=1){
      if(state.phase==='skillChoice')state=act(state,'skipSkillReward');
      else if(state.phase==='upgradeChoice')state=act(state,'skipUpgradeReward');
      else if(state.phase==='shop')state=act(state,'finishShop');
      else break;
    }
    assert.equal(state.mapEncounterId,fixedMap,'settlement does not move the map');
  }
  assert.deepEqual(stages,[fixedStage,fixedStage,fixedStage]);
  assert.equal(new Set(waves).size,3,'each battle keeps its own encounter');
});

test('summon presets retain the exact manual instruction on stage change or when occupied', () => {
  const director = context.design.system.directors.find((entry) => entry.id === 'director_svash2');
  const state = createRun({ runId: 'summon-reconcile', directorId: director.id, seed: 22 }, context);
  const initialEncounter = context.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  state.currentNode = { kind: 'battle', encounterId: initialEncounter.id };
  const owner = state.pieces.find((piece) => (context.catalog.bodies[piece.charId].summonTemplateIds ?? []).length);
  const initialSummonTiles = context.view(state).pieces.find((piece) => piece.uid === owner.uid).summonLegalTiles;
  const tokenId = context.catalog.bodies[owner.charId].summonTemplateIds.find((id) => initialSummonTiles[id]?.length > 0);
  let validSpot;
  for (const key of context.fieldFor(state).normalizedDeployMap.keys()) {
    const [ownerRow, ownerCol] = key.split(',').map(Number);
    if (!context.canPlace(state, owner, ownerRow, ownerCol)
      || state.pieces.some((piece) => piece.uid !== owner.uid && piece.row === ownerRow && piece.col === ownerCol)) continue;
    [owner.row, owner.col] = [ownerRow, ownerCol];
    for (let row = 9; row <= 12 && !validSpot; row += 1) for (let col = 2; col <= 10 && !validSpot; col += 1)
      if (context.canPlaceSummon(state, owner, row, col, { tokenId })) validSpot = [row, col];
    if (validSpot) break;
  }
  assert.ok(validSpot);
  let configured = applyAction(state, { type: 'setSummonPreset', uid: owner.uid, index: 0, tokenId, row: validSpot[0], col: validSpot[1], opId: 'set-summon', expectedRevision: state.revision }, context).state;
  const encounter = context.design.encounters.encounters.find((entry) => entry.id !== initialEncounter.id);
  assert.ok(encounter, 'another native stage is available');
  configured.pieces.find((piece) => piece.uid !== owner.uid).row = validSpot[0];
  configured.pieces.find((piece) => piece.uid !== owner.uid).col = validSpot[1];
  configured.currentNode = null;
  const node = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
    name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
  configured.nodeChoices = [node];
  const selected = applyAction(configured, { type: 'selectNode', nodeId: node.id, opId: 'move-summon', expectedRevision: configured.revision }, context).state;
  const migratedOwner = selected.pieces.find((piece) => piece.uid === owner.uid);
  const migrated = migratedOwner.summonPresets[0];
  assert.deepEqual([migrated.row, migrated.col], validSpot, 'occupied manual coordinate is retained for the player to adjust');
  assert.equal(context.canPlaceSummon(selected, migratedOwner, migrated.row, migrated.col, migrated), false);
  const migratedEncounter = getAssaultEncounter(context.design, selected.currentNode.encounterId);
  assert.doesNotThrow(() => buildAssaultBattleInput(context.prepareBattle(selected, migratedEncounter),
    { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits }));

  const noSpaceContext = { ...context, canPlaceSummon: () => false };
  const noSpace = createRun({ runId: 'summon-no-space', directorId: director.id, seed: 23 }, context);
  const noSpaceOwner = noSpace.pieces.find((piece) => piece.uid === owner.uid) ?? noSpace.pieces.find((piece) => context.catalog.bodies[piece.charId].summonTemplateIds?.length);
  const noSpaceToken = context.catalog.bodies[noSpaceOwner.charId].summonTemplateIds[0];
  noSpaceOwner.summonPresets[0] = { tokenId: noSpaceToken, row: 9, col: 10 };
  const noSpaceNode = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
    name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
  noSpace.nodeChoices = [noSpaceNode];
  const cleared = applyAction(noSpace, { type: 'selectNode', nodeId: noSpaceNode.id, opId: 'clear-summon', expectedRevision: noSpace.revision }, noSpaceContext).state;
  const clearedOwner = cleared.pieces.find((piece) => piece.uid === noSpaceOwner.uid);
  assert.deepEqual(clearedOwner.summonPresets[0], { tokenId: noSpaceToken, row: 9, col: 10 });
  assert.doesNotThrow(() => buildAssaultBattleInput(context.prepareBattle(cleared, encounter),
    { runtime: context.runtime, nativeData: context.nativeData, kits: context.kits }));
});

test('real battle constructor installs relics with the prepared snapshot and battle identity', () => {
  const state = createRun({ runId: 'prepared-install', directorId: context.design.system.directors[0].id, seed: 17 }, context);
  const encounter = context.design.encounters.encounters.find((item) => item.kind === 'normal' && item.dayRange[0] === 1);
  state.currentNode = { kind: 'battle', encounterId: encounter.id };
  for (const piece of state.pieces) { piece.row = null; piece.col = null; }
  const prepared = context.prepareBattle(state, encounter);
  let calls = 0;
  const battle = createAssaultBattle(prepared, { ...context, install(instance, snapshot) {
    calls += 1;
    assert.equal(instance.battleId, prepared.battleId);
    assert.deepEqual(snapshot.input.pieces, prepared.input.pieces);
    assert.deepEqual(snapshot.input.relicIds, prepared.input.relicIds);
    context.install(instance, snapshot);
  } });
  assert.equal(calls, 1);
  assert.equal(battle._assaultRelicState.selected[0].id, state.relicIds[0]);
  battle.start();
  battle.step();
  assert.equal(battle.errorCount, 0);
});

test('the source S2 deployment anchor is a separate noncombatant in the current-cost deployment area', () => {
  const state = createRun({ runId: 'source-anchor', directorId: 'director_svash2', seed: 17 }, context);
  const encounter = context.design.encounters.encounters.find((item) => item.kind === 'normal' && item.dayRange[0] === 1);
  state.currentNode = { kind: 'battle', encounterId: encounter.id };
  const used = new Set();
  for (const piece of state.pieces) {
    const key = [...context.fieldFor(state).normalizedDeployMap.keys()].find((key) => !used.has(key) && context.canPlace(state, piece, ...key.split(',').map(Number)));
    used.add(key); [piece.row, piece.col] = key.split(',').map(Number);
  }
  const beforeView = JSON.stringify(state);
  const prepView = context.view({ ...state, phase: 'battlePrep' });
  assert.equal(JSON.stringify(state), beforeView, 'quoting the deployment area does not mutate the run');
  assert.equal(prepView.deploymentArea.find((entry) => entry.kind === 'deployAnchor').name, '风雪之眼');
  assert.equal(prepView.deploymentArea.find((entry) => entry.kind === 'deployAnchor').deployCost, 14);
  assert.ok(prepView.deploymentArea.every((entry, index, all) => index === 0 || entry.deployCost >= all[index - 1].deployCost));
  const battle = createAssaultBattle(context.prepareBattle(state, encounter), context);
  assert.equal(battle.allyUnits.length, 3);
  const anchor = [...battle.assaultDeployAnchors.values()][0];
  assert.equal(anchor.name, '风雪之眼');
  assert.equal(anchor.sourceTemplateId, 'token_10057_svash2_eagle2');
  assert.equal(anchor.deployCost, 14);
  assert.equal(anchor.population, 0);
  assert.equal(anchor.combatant, false);
  assert.equal(anchor.attackable, false);
  assert.equal(anchor.healable, false);
  assert.ok(!battle.allyUnits.some((unit) => unit.kind === 'deployAnchor'));
  const snow = battle.allyUnits.find((unit) => unit.def.charId === 'char_174_slbell');
  let quoteCost = 14;
  battle.on('assaultDeploymentCost', (quote) => { if (quote.unit === snow) quote.amount = quoteCost; });
  assert.equal(battle.assaultDeployAnchorRelations(snow)[0].leftOfAnchor, false, 'equal cost follows the source owner formation tie');
  quoteCost = 11;
  assert.equal(battle.assaultDeployAnchorRelations(snow)[0].leftOfAnchor, true, 'current quote changes the actual relation');
  const entered = [];
  battle.on('deploy', (event) => { if (event.unit.kind === 'op') entered.push(event.unit.uid); });
  battle.start();
  assert.equal(entered[0], snow.uid, 'the same cost order drives native initial deployment');
  assert.equal(battle.assaultDeployAnchorRelations(snow)[0].active, true);
  entered.length = 0;
  for (const unit of battle.allyUnits.filter((unit) => unit.kind === 'op')) {
    if (unit.alive) battle.retreat(unit);
    unit.respawnAt = battle.time;
  }
  battle.getPlayer('assault').dp = 99;
  battle._checkRedeploys();
  assert.equal(entered[0], snow.uid, 'actual pending/redeploy entries use the current-cost order too');
  assert.equal(battle.errorCount, 0);
});

test('equipped advanced population exemption admits one extra body and locked stars remain limited', () => {
  for (const star of [2, 3, 4]) {
    const state = createRun({ runId: `module-population:${star}`, directorId: 'director_svash2', seed: 17 }, context);
    const piece = addBodyToInventory(state, context, 'char_4037_demetr', 2 ** (star - 1), { star, row: null, col: null });
    assert.equal(piecePopulationCost(piece, context), 1, 'the optional module is not equipped automatically');
    piece.moduleChoices[piece.charId] = 'assault_mod_char_4037_demetr_1';
    assert.equal(piecePopulationCost(piece, context), star >= 3 ? 0 : 1);
    piece.moduleChoices[piece.charId] = 'uniequip_002_demetr';
    assert.equal(piecePopulationCost(piece, context), star >= 3 ? 0 : 1, 'saved native module ID preserves the same unlock and population effect');
    const tile = [...context.fieldFor(state).normalizedDeployMap.keys()].map((key) => key.split(',').map(Number))
      .find(([row, col]) => context.canPlace(state, piece, row, col)
        && !state.pieces.some((other) => other.row === row && other.col === col));
    assert.ok(tile);
    const command = { type: 'place', uid: piece.uid, row: tile[0], col: tile[1], dir: 'E',
      expectedRevision: state.revision, opId: `population:${star}` };
    if (star === 2) {
      const before = JSON.stringify(state);
      assert.throws(() => applyAction(state, command, context), { code: 'POPULATION_FULL' });
      assert.equal(JSON.stringify(state), before, 'rejected deployment remains atomic');
    } else {
      const placed = applyAction(state, command, context).state;
      const view = context.view(placed);
      assert.equal(view.pieces.filter((entry) => entry.row != null).length, 4);
      assert.equal(activePopulation(view), 3);
      assert.equal(view.pieces.find((entry) => entry.uid === piece.uid).populationCost, 0);
    }
  }
});

test('the page-side deployment cap check agrees with the server for every placement, module change and battle start', () => {
  const state = createRun({ runId: 'cap-agree', directorId: 'director_svash2', seed: 17 }, context);
  const bench = addBodyToInventory(state, context, 'char_4037_demetr', 1, { star: 1, row: null, col: null });
  const catalog = { design: context.design };
  const tile = [...context.fieldFor(state).normalizedDeployMap.keys()].map((key) => key.split(',').map(Number))
    .find(([row, col]) => context.canPlace(state, bench, row, col) && !state.pieces.some((other) => other.row === row && other.col === col));
  assert.ok(tile);
  const place = (revision, opId) => ({ type: 'place', uid: bench.uid, row: tile[0], col: tile[1], dir: 'E', expectedRevision: revision, opId });
  // the starting team already fills the cap: the page refuses, the server refuses, and the readout shows used == cap
  const full = context.view(state);
  const { used, cap } = deployCapacity(full, catalog);
  assert.equal(used, cap);
  assert.equal(canDeployMore(full, catalog, full.pieces.find((entry) => entry.uid === bench.uid)), false);
  const before = JSON.stringify(state);
  assert.throws(() => applyAction(state, place(state.revision, 'cap-agree:full'), context), { code: 'POPULATION_FULL' });
  assert.equal(JSON.stringify(state), before, 'the refused placement leaves the run untouched');
  // an already-deployed piece only moves and never needs room
  const deployed = full.pieces.find((entry) => entry.row != null);
  assert.equal(canDeployMore(full, catalog, deployed), true);
  // one more tech level raises the cap by one: both sides admit the placement
  const thresholds = context.design.system.run.xpThresholds;
  const raised = JSON.parse(JSON.stringify(state));
  raised.xp = thresholds[(thresholds.findIndex((value, index) => raised.xp < value && index >= 1)) ] ?? raised.xp;
  const view = context.view(raised);
  const next = deployCapacity(view, catalog);
  assert.ok(next.cap > cap, 'raising xp raises the cap');
  assert.equal(canDeployMore(view, catalog, view.pieces.find((entry) => entry.uid === bench.uid)), true);
  assert.doesNotThrow(() => applyAction(raised, place(raised.revision, 'cap-agree:open'), context));
});

test('a battle never starts with more deployed population than the cap', () => {
  let state = createRun({ runId: 'cap-ready', directorId: 'director_svash2', seed: 21 }, context);
  const encounter = context.design.encounters.encounters.find((entry) => entry.kind === 'normal' && entry.dayRange[0] === 1);
  state.nodeChoices = [{ id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
    name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId }];
  const act = (current, type, params = {}) => applyAction(current, { type, ...params, opId: `${current.revision}-${type}`, expectedRevision: current.revision }, context).state;
  state = act(state, 'selectNode', { nodeId: encounter.id });
  const extra = addBodyToInventory(state, context, 'char_4037_demetr', 1, { star: 1, row: null, col: null });
  const tile = [...context.fieldFor(state).normalizedDeployMap.keys()].map((key) => key.split(',').map(Number))
    .find(([row, col]) => context.canPlace(state, extra, row, col) && !state.pieces.some((other) => other.row === row && other.col === col));
  assert.ok(tile);
  extra.row = tile[0]; extra.col = tile[1]; extra.dir = 'E';
  assert.throws(() => act(state, 'readyBattle'), { code: 'POPULATION_FULL' });
  extra.row = null; extra.col = null;
  assert.doesNotThrow(() => act(state, 'readyBattle'));
});

test('real context placement follows native terrain and physical forms in all encounter fields', () => {
  const state = createRun({ runId: 'field-test', directorId: context.design.system.directors[0].id, seed: 17 }, context);
  for (const encounter of context.design.encounters.encounters) {
    state.currentNode = { kind: 'battle', encounterId: encounter.id };
    if(encounter.kind!=='final')state.mapEncounterId=encounter.id;
    const field = context.fieldFor(state);
    for (const [key, terrain] of field.normalizedDeployMap) {
      const [row, col] = key.split(',').map(Number);
      assert.equal(context.canPlace(state, { charId: 'char_127_estell' }, row, col), terrain === 'melee');
      assert.equal(context.canPlace(state, { charId: 'char_103_angel' }, row, col), true);
      assert.equal(context.canPlace(state, { charId: 'char_474_glady' }, row, col), true);
    }
    assert.equal(context.canPlace(state, { charId: 'char_103_angel' }, 8, 2), false);
    assert.equal(context.canPlace(state, { charId: 'char_127_estell' }, 9, 11), false);
    const view = context.view(state);
    assert.equal(view.board.stageId, getAssaultEncounter(context.design, encounter.kind==='final'?encounter.id:state.mapEncounterId).stageId);
    for (const piece of view.pieces) assert.ok(piece.legalTiles.every(([row, col]) => context.canPlace(state, piece, row, col)));
  }
});

test('browser preparation preserves fixed gold-derived inputs and excludes evidence paths from assets', () => {
  const prepared = { input: { gold: 3, derivedBuffInputs: [] }, derivedBuffInputs: [{ relicId: 'cross-chivalry', attackSpeedStacks: 8, goldAtPreparation: 40 }] };
  assert.deepEqual(withAssaultPreparedInputs(prepared).input.derivedBuffInputs, prepared.derivedBuffInputs);
  assert.deepEqual(prepared.input.derivedBuffInputs, []);
  assert.ok(context.assetManifest.assets.units.char_002_amiya.model.front.skel.url);
  assert.ok(!JSON.stringify(context.assetManifest).includes('WindowsWorkspace'));
  assert.deepEqual(Object.keys(context.browserNativeData).sort(), ['assets', 'bosses', 'chess', 'enemies', 'stages', 'tokens', 'waves'].sort());
});

test('main server mounts the real catalog and canonical art while keeping Assault code on its own revision', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true,
    independentDirectory: path.resolve(canonical, '.omni/tmp/assault/tests/independent'),
    assaultDirectory: path.resolve(canonical, '.omni/tmp/assault/tests/http'),
    assaultAssetsDir: path.resolve(canonical, 'data/assault-sources/assets'),
    staticBase: `https://example.invalid/${context.runtime.engineRevision}/` });
  t.after(() => server.close());
  const catalogResponse = await fetch(`${server.url}/api/assault/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(Object.keys(catalog.runtime.bodies).length, Object.keys(context.runtime.bodies).length);
  assert.ok(catalog.nativeData.stages);
  assert.ok(!JSON.stringify(catalog.assetManifest).includes('WindowsWorkspace'));
  for (const file of ['/assault.html', '/js/assault/client-sim.js', '/sim/Battle.js', '/shared/assault/battle-input.js', '/assault-assets/operators/char_002_amiya/avatar.png']) {
    const result = await fetch(`${server.url}${file}`, { redirect: 'manual' });
    assert.equal(result.status, 200, file);
    assert.ok((await result.arrayBuffer()).byteLength > 0, file);
  }
  const privateSource = await fetch(`${server.url}/assault-assets/assetbundles/native.idx`, { redirect: 'manual' });
  assert.equal(privateSource.status, 404);
  const rootListing = await fetch(`${server.url}/assault-assets/`, { redirect: 'manual' });
  assert.equal(rootListing.status, 404);
});

test('real HTTP battle settlement persists, retries once, exports and resumes after server restart', async (t) => {
  const directory = path.resolve(canonical, '.omni/tmp/assault/tests/http');
  const options = { port: 0, host: '127.0.0.1', quiet: true,
    independentDirectory: path.resolve(canonical, '.omni/tmp/assault/tests/independent'),
    assaultDirectory: directory,
    assaultAssetsDir: path.resolve(canonical, 'data/assault-sources/assets') };
  let server = await startServer(options);
  t.after(async () => { if (server) await server.close(); });
  let api = createAssaultApi({ href: `${server.url}/assault.html` });
  let packet = await api.create({ directorId: 'director_svash2', seed: 17 });
  assert.equal(packet.status, 201);
  const runId = packet.runId;
  let op = 0;
  const act = async (type, params = {}) => {
    const result = await api.action(runId, type, params, { opId: `http-native-${++op}`, expectedRevision: packet.state.revision });
    assert.equal(result.ok, true, JSON.stringify({ type, status: result.status, error: result.error }));
    packet = result;
  };
  for (let step = 0; packet.state.phase !== 'battlePrep' && step < 12; step += 1) {
    const state = packet.state;
    if (state.phase === 'nodeChoice') {
      const node = state.choices.find(choice => choice.kind === 'battle')
        ?? state.choices.find(choice => choice.kind === 'shop') ?? state.choices[0];
      assert.ok(node);
      await act('selectNode', { nodeId: node.id });
    } else if (state.phase === 'shop') await act('finishShop');
    else if (state.phase === 'event') await act('leaveEvent');
    else assert.fail(`Unexpected pre-battle phase ${state.phase}`);
  }
  assert.equal(packet.state.phase, 'battlePrep');
  for (const entry of packet.state.pieces.filter(entry => entry.row !== null)) await act('bench', { uid: entry.uid });
  const piece = packet.state.pieces[0];
  const [row, col] = piece.legalTiles.find(([r, c]) => r >= 9 && r <= 12 && c >= 2 && c <= 10);
  await act('place', { uid: piece.uid, row, col, dir: 'E' });
  await act('readyBattle');
  const nativeInput = await api.battle(runId);
  assert.equal(nativeInput.ok, true);
  assert.equal(nativeInput.battle.input.pieces.some(entry => entry.uid === piece.uid), true);
  const expected = runAssaultBattle(nativeInput.battle, context);
  assert.equal(expected.diagnostics.errorCount, 0);
  const settleOptions = { opId: 'http-native-settle', expectedRevision: packet.state.revision };
  const settled = await api.settle(runId, nativeInput.battle.battleId, settleOptions);
  assert.equal(settled.ok, true, JSON.stringify({ status: settled.status, error: settled.error }));
  assert.equal(settled.result.victory, expected.victory);
  assert.equal(settled.result.leakedLife, expected.leakedLife);
  assert.equal(settled.state.life, Math.max(0, packet.state.life - expected.leakedLife));
  const retry = await api.settle(runId, nativeInput.battle.battleId, settleOptions);
  assert.equal(retry.ok, true);
  assert.equal(retry.state.revision, settled.state.revision);
  assert.equal(retry.state.life, settled.state.life);
  const exported = await api.exportRun(runId);
  assert.equal(exported.ok, true);
  const persisted = JSON.parse(await exported.blob.text());
  assert.equal(persisted.history.filter(entry => entry.kind === 'battleSettled').length, 1);
  assert.equal(persisted.runId, runId);
  await server.close();
  server = null;
  server = await startServer(options);
  api = createAssaultApi({ href: `${server.url}/assault.html` });
  const resumed = await api.load(runId);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.state.revision, settled.state.revision);
  assert.equal(resumed.state.life, settled.state.life);
  const reexported = await api.exportRun(runId);
  assert.equal(reexported.ok, true);
  assert.deepEqual(JSON.parse(await reexported.blob.text()), persisted);
  const imported = await api.importRun(persisted);
  assert.equal(imported.status, 201);
  assert.notEqual(imported.runId, runId);
  assert.equal(imported.state.life, persisted.life);
  assert.equal(imported.state.rngState, persisted.rngState);
  console.log(JSON.stringify({ artifact: path.join(directory, `${runId}.json`), purpose: 'Native HTTP battle persisted fixture',
    importedArtifact: path.join(directory, `${imported.runId}.json`), importedPurpose: 'Lossless API import fixture', victory: expected.victory, leakedLife: expected.leakedLife }));
});
