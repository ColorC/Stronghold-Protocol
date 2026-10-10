import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { modeIdFor } from '../../shared/constants.js';
import { nativeLevelAttributes } from '../../shared/independentGrowth.js';
import { battleUnits, runIndependentBattle, getIndependentField } from '../../server/modes/independent/battle.js';
import { benchCount, tempCount } from '../../server/modes/independent/session.js';
import { prepView } from '../../public/js/independent/model.js';

function routeTilesForWave(wave) {
  const tiles = new Set();
  for (const spawn of wave.spawns || []) {
    if (!(Number(spawn.count) > 0) || spawn.preview?.fly === true) continue;
    const route = wave.routes?.[spawn.routeIndex];
    if (!route || route.motion === 'FLY') continue;
    const points = [route.start, ...(route.checkpoints || []), route.end].filter((p) => Array.isArray(p) && p.length === 2);
    for (let i = 1; i < points.length; i++) {
      const [r0, c0] = points[i - 1], [r1, c1] = points[i];
      const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0), 1);
      // Wave route points are battle-field [x, y]; prep legal tiles are [row, col].
      for (let n = 0; n <= steps; n++) tiles.add(`${Math.round(c0 + (c1 - c0) * n / steps)},${Math.round(r0 + (r1 - r0) * n / steps)}`);
    }
  }
  return tiles;
}

function farthestLegalTile(legalTiles, routeTiles) {
  const score = (tile) => Math.min(...[...routeTiles].map((key) => {
    const [r, c] = key.split(',').map(Number);
    return Math.abs(tile[0] - r) + Math.abs(tile[1] - c);
  }));
  return legalTiles.map((key) => key.split(',').map(Number)).sort((a, b) => score(b) - score(a))[0];
}

function buyOperator(chessId, growthMode='badges') {
  const state = createSession({ seed: 90210, growthMode });
  state.shop.slots[0] = { ...state.shop.slots[0], kind: 'chess', id: chessId, sold: false, price: 3 };
  state.pool[chessId] ||= { left: 10, cap: 10 };
  state.pool[chessId].left = Math.max(1, Math.min(state.pool[chessId].cap, state.pool[chessId].left));
  state.funds = Math.max(state.funds, 3);
  const bought = applyAction(state, { type: 'buy', slot: 0 });
  assert.equal(bought.ok, true, bought.error?.message);
  return bought.state;
}

test('native placeable summon is granted for its selected skill and remains a token piece through battle input', () => {
  const data = getData(); const catalog = getCatalog(data);
  const hemer = Object.values(catalog.operators).find((op) => op.name === '赫默' && !op.elite);
  assert.ok(hemer, '赫默 exists in the operator catalog');
  const droneId = Object.keys(data.tokens).find((id) => data.tokens[id]?.name === '医疗探机');
  assert.ok(droneId, 'the original Hemer drone token is in token data');
  const gd = new GameData(data, modeIdFor('solo', 'NORMAL'));
  const validSkill = [0, 1, 2].find((skillIndex) => gd.placeableTokens(hemer.chessId, { skillIndex, moduleId: 'none' }).some((x) => x.tokenId === droneId));
  assert.notEqual(validSkill, undefined, 'a selected skill makes the original token placeable');

  const state = buyOperator(hemer.chessId); const owner = state.pieces[0];
  owner.skillIndex = validSkill;
  const ownerTiles = viewSession(state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles;
  assert.ok(ownerTiles.length);
  const moved = applyAction(state, { type: 'move', uid: owner.uid, row: Number(ownerTiles[0].split(',')[0]), col: Number(ownerTiles[0].split(',')[1]) });
  assert.equal(moved.ok, true, moved.error?.message);
  const stack = moved.state.summons.find((p) => p.ownerUid === owner.uid && p.tokenId === droneId);
  assert.ok(stack, 'the owner receives a native token stack');
  assert.equal(stack.count, 1);
  const tokenView = viewSession(moved.state, { data, catalog }).pieces.find((p) => p.uid === stack.uid);
  assert.equal(tokenView.kind, 'token');
  assert.equal(tokenView.ownerName, '赫默');
  assert.match(tokenView.summonSourceText, /技能/);
  assert.equal(benchCount(moved.state), 1, 'a token stack occupies one hand slot, regardless of its count');
  assert.equal(tempCount(moved.state), 0, 'a token stack never consumes temporary operator capacity');
  const prepToken = prepView(viewSession(moved.state, { data, catalog }), catalog).hand.find((p) => p?.uid === Number(stack.uid.slice(1)));
  assert.equal(prepToken.kind, 'token');
  assert.equal(prepToken.ownerName, '赫默');

  const cells = tokenView.legalTiles;
  assert.ok(cells.length, 'native token gets legal terrain placement cells');
  const [row, col] = cells[0].split(',').map(Number);
  const placed = applyAction(moved.state, { type: 'move', uid: stack.uid, row, col });
  assert.equal(placed.ok, true, placed.error?.message);
  const units = battleUnits(placed.state, catalog, data);
  const battleToken = units.find((u) => u.uid === stack.uid);
  assert.equal(battleToken.kind, 'token');
  assert.equal(battleToken.tokenId, droneId);
  assert.equal(battleToken.ownerUid, owner.uid);
  assert.equal(battleToken.ownerChessId, hemer.chessId);
  assert.equal(battleToken.row, row);
  assert.equal(battleToken.col, col);
});

test('native summon is returned to its stack when owner moves and removed when owner is benched', () => {
  const data = getData(); const catalog = getCatalog(data);
  const hemer = Object.values(catalog.operators).find((op) => op.name === '赫默' && !op.elite);
  const droneId = Object.keys(data.tokens).find((id) => data.tokens[id]?.name === '医疗探机');
  const state = buyOperator(hemer.chessId); const owner = state.pieces[0];
  const skill = [0, 1, 2].find((i) => new GameData(data, modeIdFor('solo', 'NORMAL')).placeableTokens(hemer.chessId, { skillIndex: i, moduleId: 'none' }).some((x) => x.tokenId === droneId));
  owner.skillIndex = skill;
  const ownerTile = viewSession(state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles[0].split(',').map(Number);
  const onField = applyAction(state, { type: 'move', uid: owner.uid, row: ownerTile[0], col: ownerTile[1] }).state;
  const stack = onField.summons.find((p) => p.tokenId === droneId);
  const legal = viewSession(onField, { data, catalog }).pieces.find((p) => p.uid === stack.uid).legalTiles[0].split(',').map(Number);
  const placed = applyAction(onField, { type: 'move', uid: stack.uid, row: legal[0], col: legal[1] });
  assert.equal(placed.ok, true, placed.error?.message);
  const owner2 = placed.state.pieces.find((p) => p.uid === owner.uid);
  const nextOwnerTile = viewSession(placed.state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles.find((x) => x !== `${ownerTile[0]},${ownerTile[1]}`);
  assert.ok(nextOwnerTile);
  const [r, c] = nextOwnerTile.split(',').map(Number);
  const movedOwner = applyAction(placed.state, { type: 'move', uid: owner.uid, row: r, col: c });
  assert.equal(movedOwner.ok, true, movedOwner.error?.message);
  assert.equal(movedOwner.state.summons.some((p) => p.ownerUid === owner.uid && p.tokenId === droneId && p.row == null && p.count === 1), true);
  const benched = applyAction(movedOwner.state, { type: 'bench', uid: owner.uid });
  assert.equal(benched.ok, true, benched.error?.message);
  assert.equal(benched.state.summons.some((p) => p.ownerUid === owner.uid), false);
});

test('ready runs a real battle with the placed native token linked to its owner', () => {
  const data = getData(); const catalog = getCatalog(data);
  const hemer = Object.values(catalog.operators).find((op) => op.name === '赫默' && !op.elite);
  const droneId = Object.keys(data.tokens).find((id) => data.tokens[id]?.name === '医疗探机');
  const state = buyOperator(hemer.chessId); const owner = state.pieces[0];
  const gd = new GameData(data, modeIdFor('solo', 'NORMAL'));
  const skill = [0, 1, 2].find((i) => gd.placeableTokens(hemer.chessId, { skillIndex: i, moduleId: 'none' }).some((x) => x.tokenId === droneId));
  owner.skillIndex = skill;
  const ownerTile = viewSession(state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles[0].split(',').map(Number);
  const onField = applyAction(state, { type: 'move', uid: owner.uid, row: ownerTile[0], col: ownerTile[1] }).state;
  const stack = onField.summons.find((p) => p.tokenId === droneId);
  const tokenTile = viewSession(onField, { data, catalog }).pieces.find((p) => p.uid === stack.uid).legalTiles[0].split(',').map(Number);
  const placed = applyAction(onField, { type: 'move', uid: stack.uid, row: tokenTile[0], col: tokenTile[1] });
  assert.equal(placed.ok, true, placed.error?.message);
  const ready = applyAction(placed.state, { type: 'ready' });
  assert.equal(ready.ok, true, ready.error?.message);
  const replayText = JSON.stringify(ready.replay);
  assert.match(replayText, /医疗探机/);
  assert.match(replayText, new RegExp(owner.uid));
  assert.match(replayText, /ownerName|ownerUnitId|召唤/);
});

test('a placed Vigil wolf replaces the generic tactician reinforcement and keeps its native identity in battle', () => {
  const data = getData(); const catalog = getCatalog(data); const gd = new GameData(data, modeIdFor('solo', 'NORMAL'));
  const vigil = Object.values(catalog.operators).find((op) => op.name === '伺夜' && !op.elite);
  const wolfId = 'token_10028_vigil_wolf';
  assert.ok(vigil);
  const skillIndex = [0, 1, 2].find((i) => gd.placeableTokens(vigil.chessId, { skillIndex: i, moduleId: 'none' }).some((x) => x.tokenId === wolfId));
  assert.notEqual(skillIndex, undefined, 'the native selected loadout grants a placed wolf stack');
  const state = buyOperator(vigil.chessId); const owner = state.pieces[0]; owner.skillIndex = skillIndex;
  const ownerCell = viewSession(state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles[0].split(',').map(Number);
  const deployed = applyAction(state, { type: 'move', uid: owner.uid, row: ownerCell[0], col: ownerCell[1] });
  assert.equal(deployed.ok, true, deployed.error?.message);
  const stack = deployed.state.summons.find((p) => p.ownerUid === owner.uid && p.tokenId === wolfId);
  assert.ok(stack);
  const wolfCell = viewSession(deployed.state, { data, catalog }).pieces.find((p) => p.uid === stack.uid).legalTiles[0].split(',').map(Number);
  const placed = applyAction(deployed.state, { type: 'move', uid: stack.uid, row: wolfCell[0], col: wolfCell[1] });
  assert.equal(placed.ok, true, placed.error?.message);
  const units = battleUnits(placed.state, catalog, data);
  assert.equal(units.filter((u) => u.kind === 'token' && u.ownerUid === owner.uid).length, 1);
  assert.equal(units.find((u) => u.kind === 'token')?.tokenId, wolfId);
  const ready = applyAction(placed.state, { type: 'ready' });
  assert.equal(ready.ok, true, ready.error?.message);
  const replay = JSON.stringify(ready.replay);
  assert.match(replay, /狼群/);
  assert.doesNotMatch(replay, /token_tactician_reinforce/);
});

function runPlacedVigilWolf(growthMode) {
  const data=getData(),catalog=getCatalog(data),gd=new GameData(data,modeIdFor('solo','NORMAL'));
  const vigil=Object.values(catalog.operators).find(op=>op.name==='伺夜'&&!op.elite);
  const holder=Object.values(catalog.operators).find(op=>op.sourceRefs?.darkmoon19_2?.id==='BGS_021'&&!op.elite);
  const wolfId='token_10028_vigil_wolf';
  assert.ok(vigil&&holder);
  const skillIndex=[0,1,2].find(i=>gd.placeableTokens(vigil.chessId,{skillIndex:i,moduleId:'none'}).some(x=>x.tokenId===wolfId));
  assert.notEqual(skillIndex,undefined);
  let state=buyOperator(vigil.chessId,growthMode);
  const owner=state.pieces[0];owner.skillIndex=skillIndex;
  state.shop.slots[0]={kind:'chess',id:holder.chessId,price:3,sold:false,equipment:[]};
  state.pool[holder.chessId]||={left:10,cap:10};state.pool[holder.chessId].left=Math.max(1,state.pool[holder.chessId].left);state.funds=Math.max(state.funds,10);
  const recruited=applyAction(state,{type:'buy',slot:0});assert.equal(recruited.ok,true,recruited.error?.message);state=recruited.state;
  const field=getIndependentField(state,{data,catalog}),routeTiles=routeTilesForWave(field.wave);
  assert.ok(routeTiles.size,'the selected real wave has ground route tiles');
  const source=state.pieces.find(piece=>piece.chessId===holder.chessId);assert.ok(source);
  const ownerCell=viewSession(state,{data,catalog}).pieces.find(p=>p.uid===owner.uid).legalTiles.find(tile=>tile==='9,8')?.split(',').map(Number);
  assert.ok(ownerCell,'the test places the owner where its unchanged marker range can cover the active ground route');
  const deployedOwner=applyAction(state,{type:'move',uid:owner.uid,row:ownerCell[0],col:ownerCell[1]});assert.equal(deployedOwner.ok,true,deployedOwner.error?.message);state=deployedOwner.state;
  const sourceCell=farthestLegalTile(viewSession(state,{data,catalog}).pieces.find(p=>p.uid===source.uid).legalTiles,routeTiles);
  const deployedSource=applyAction(state,{type:'move',uid:source.uid,row:sourceCell[0],col:sourceCell[1]});assert.equal(deployedSource.ok,true,deployedSource.error?.message);state=deployedSource.state;
  const stack=state.summons.find(p=>p.ownerUid===owner.uid&&p.tokenId===wolfId);assert.ok(stack);
  const wolfView=viewSession(state,{data,catalog}).pieces.find(p=>p.uid===stack.uid);
  const wolfCellText=wolfView.legalTiles.filter(tile=>routeTiles.has(tile)).sort((a,b)=>{
    const start=field.wave.routes[field.wave.spawns.find(spawn=>Number(spawn.count)>0&&spawn.preview?.fly!==true)?.routeIndex]?.start||[0,0];
    const distance=tile=>{const [r,c]=tile.split(',').map(Number);return Math.abs(r-start[1])+Math.abs(c-start[0]);};
    return distance(a)-distance(b);
  })[0];
  assert.ok(wolfCellText,`the original token's legal marker tiles intersect an active ground route: ${JSON.stringify({legal:wolfView.legalTiles,routes:field.wave.routes})}`);
  const wolfCell=wolfCellText.split(',').map(Number);
  assert.ok((data.tokens[wolfId].rangeGrid||[[0,0]]).some(([r,c])=>r===0&&c===0),'the native token can engage an enemy occupying its unchanged marker cell');
  const placed=applyAction(state,{type:'move',uid:stack.uid,row:wolfCell[0],col:wolfCell[1]});assert.equal(placed.ok,true,placed.error?.message);
  const tokenInput=battleUnits(placed.state,catalog,data).find(unit=>unit.uid===stack.uid);assert.equal(tokenInput.kind,'token');assert.equal(tokenInput.independentSummon,true);
  const battle=runIndependentBattle(placed.state,{data,catalog});
  const sourceEvents=battle.darkmoonTrace.filter(entry=>entry.sourceId==='BGS_021'&&entry.kind==='event');
  const markerDeploy=sourceEvents.find(entry=>entry.targets.includes(stack.uid));
  assert.ok(markerDeploy,`the actual placed wolf receives one BGS021 opening-deploy event: ${JSON.stringify({sourceEvents,wolfCell,errors:battle.diagnostics.errors})}`);
  assert.ok(markerDeploy.time>0,'the opening marker stays queued until an enemy can engage it');
  assert.equal(sourceEvents.filter(entry=>entry.targets.includes(stack.uid)).length,1,'the manually placed marker is trained exactly once');
  const enemyIds=new Set(battle.samples.flatMap(sample=>sample.enemies.map(enemy=>enemy.id)));
  assert.ok(battle.replay.frames.some(frame=>Math.abs(frame.snap.t-markerDeploy.time)<=0.2&&(frame.snap.units||[]).some(unit=>enemyIds.has(unit[0])&&Math.floor(unit[1])===wolfCell[1]&&Math.floor(unit[2])===wolfCell[0])),`an actual wave enemy reaches the unchanged marker tile before its deploy event at ${markerDeploy.time}s`);
  const markerActorIds=new Set(battle.replay.frames.flatMap(frame=>(frame.snap.units||[]).filter(unit=>Math.round(unit[1])===wolfCell[1]&&Math.round(unit[2])===wolfCell[0]).map(unit=>unit[0])));
  assert.ok(markerActorIds.size,`the manually placed marker reaches deployment at its unchanged cell ${wolfCell.join(',')}`);
  const markerId=[...markerActorIds].find(id=>sourceEvents.some(entry=>entry.targets.includes(stack.uid)));
  const replayStats=battle.replay.frames.flatMap(frame=>Object.entries(frame.stats||{}).map(([id,entry])=>({id:Number(id),...entry}))).filter(entry=>entry.defId===wolfId&&entry.id===markerId);
  assert.ok(replayStats.length,'replay stats include the manually placed token actor');
  const live=replayStats.find(entry=>entry.temporaryGrowth?.some(growth=>growth.sourceId==='BGS_021'));
  assert.ok(live,'token replay stats carry the BGS021 temporary-growth source');
  if(growthMode==='levels'){
    const curve=data.tokens[wolfId].nativeGrowth,phase=tokenInput.ownerGrowth.phase,level=tokenInput.ownerGrowth.level,levelsPerBadge=Number(catalog.config?.levelsPerBadge||1);
    const base=nativeLevelAttributes(curve,phase,level),trained=nativeLevelAttributes(curve,phase,Math.min(curve.phases[phase].maxLevel,level+8*levelsPerBadge));
    assert.deepEqual({atk:live.base.atk,maxHp:live.base.maxHp,def:live.base.def,res:live.base.res},{atk:base.atk,maxHp:base.maxHp,def:base.def,res:base.res},'replay token baseline matches its pinned native curve');
    assert.deepEqual({atk:live.atk,maxHp:live.maxHp,def:live.def,res:live.res},{atk:trained.atk,maxHp:trained.maxHp,def:trained.def,res:trained.res},'replay live token values include the exact BGS021 curve growth');
    assert.equal(live.temporaryGrowth.find(growth=>growth.sourceId==='BGS_021').temporaryTrainingLevels,8*levelsPerBadge);
    assert.equal('attackUnits' in live.temporaryGrowth.find(growth=>growth.sourceId==='BGS_021'),false,'level mode never leaks badge-unit growth fields');
  }else{
    const growth=live.temporaryGrowth.find(entry=>entry.sourceId==='BGS_021');
    assert.ok(Number.isFinite(growth.attackUnits)&&Number.isFinite(growth.secondaryUnits),'badge mode records its native attack/secondary badge units');
    assert.deepEqual(growth.badgeIds,['precision','damage']);
    assert.equal('temporaryTrainingLevels' in growth,false,'badge mode never leaks native-level growth fields');
  }
  assert.equal(battle.diagnostics.errorCount,0,JSON.stringify(battle.diagnostics.errors));
}

test('a prep-placed Vigil wolf gets exactly one BGS021 growth through the real opening battle deploy flow in both growth modes', () => {
  runPlacedVigilWolf('levels');
  runPlacedVigilWolf('badges');
});
test('an unplaced Vigil wolf stack still uses the original automatic summon without a generic tactician placeholder', () => {
  const data = getData(); const catalog = getCatalog(data); const gd = new GameData(data, modeIdFor('solo', 'NORMAL'));
  const vigil = Object.values(catalog.operators).find((op) => op.name === '伺夜' && !op.elite); const wolfId = 'token_10028_vigil_wolf';
  const skillIndex = [0, 1, 2].find((i) => gd.placeableTokens(vigil.chessId, { skillIndex: i, moduleId: 'none' }).some((x) => x.tokenId === wolfId));
  const state = buyOperator(vigil.chessId); const owner = state.pieces[0]; owner.skillIndex = skillIndex;
  const ownerCell = viewSession(state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles[0].split(',').map(Number);
  const moved = applyAction(state, { type: 'move', uid: owner.uid, row: ownerCell[0], col: ownerCell[1] });
  assert.equal(moved.ok, true, moved.error?.message);
  assert.ok(moved.state.summons.some((p) => p.ownerUid === owner.uid && p.tokenId === wolfId && p.row == null), 'the selected native stack remains available in hand');
  const ready = applyAction(moved.state, { type: 'ready' });
  assert.equal(ready.ok, true, ready.error?.message);
  const replay = JSON.stringify(ready.replay);
  assert.match(replay, /狼群/);
  assert.doesNotMatch(replay, /token_tactician_reinforce/);
});

test('a native stack is visible at the hand limit and does not consume operator deploy capacity', () => {
  const data = getData(); const catalog = getCatalog(data);
  const hemer = Object.values(catalog.operators).find((op) => op.name === '赫默' && !op.elite);
  const droneId = Object.keys(data.tokens).find((id) => data.tokens[id]?.name === '医疗探机');
  const state = buyOperator(hemer.chessId); const owner = state.pieces[0];
  const skill = [0, 1, 2].find((i) => new GameData(data, modeIdFor('solo', 'NORMAL')).placeableTokens(hemer.chessId, { skillIndex: i, moduleId: 'none' }).some((x) => x.tokenId === droneId));
  owner.skillIndex = skill;
  const ownerCell = viewSession(state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles[0].split(',').map(Number);
  const deployed = applyAction(state, { type: 'move', uid: owner.uid, row: ownerCell[0], col: ownerCell[1] });
  assert.equal(deployed.ok, true, deployed.error?.message);
  const fillerIds = Object.values(catalog.operators).filter((op) => op.recruitable && !op.elite && op.chessId !== hemer.chessId && !op.darkmoonSupport)
    .map((op) => op.chessId).filter((id, index, list) => list.indexOf(id) === index).slice(0, 9);
  assert.equal(fillerIds.length, 9);
  let full = deployed.state; full.funds = 1000;
  for (const id of fillerIds) {
    full.shop.slots[0] = { ...full.shop.slots[0], kind: 'chess', id, sold: false, price: 3 };
    full.pool[id] ||= { left: 10, cap: 10 }; full.pool[id].left = Math.max(1, Math.min(full.pool[id].cap, full.pool[id].left));
    const bought = applyAction(full, { type: 'buy', slot: 0 });
    assert.equal(bought.ok, true, bought.error?.message);
    full = bought.state;
  }
  const hand = prepView(viewSession(full, { data, catalog }), catalog).hand;
  assert.equal(benchCount(full), 10, 'nine operator cards and one token stack fill, but do not exceed, the hand');
  assert.equal(hand.length, 10);
  assert.equal(hand.some((p) => p?.kind === 'token' && p.tokenId === droneId), true, 'the native token stays visible and draggable in the full hand');
  const tenthOperator = fillerIds[0];
  full.shop.slots[0] = { ...full.shop.slots[0], kind: 'chess', id: tenthOperator, sold: false, price: 3 };
  const rejected = applyAction(full, { type: 'buy', slot: 0 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'BENCH_FULL');
  assert.equal(full.pieces.filter((p) => p.row != null && p.col != null).length, 1, 'native tokens do not count against the operator deployment cap');
});

test('native placeable stacks preserve multiple token types and deploy-limit counts', () => {
  const data = getData(); const catalog = getCatalog(data); const gd = new GameData(data, modeIdFor('solo', 'NORMAL'));
  let selected = null;
  for (const op of Object.values(catalog.operators).filter((x) => x.recruitable && !x.elite)) {
    for (let skillIndex = 0; skillIndex < 3; skillIndex++) {
      const tokens = gd.placeableTokens(op.chessId, { skillIndex, moduleId: 'none' });
      if (tokens.length > 1 || tokens.some((x) => x.count > 1)) { selected = { op, skillIndex, tokens }; break; }
    }
    if (selected) break;
  }
  assert.ok(selected, 'current source data includes a multi-token owner or deploy limit');
  const state = buyOperator(selected.op.chessId); const owner = state.pieces[0]; owner.skillIndex = selected.skillIndex;
  const cell = viewSession(state, { data, catalog }).pieces.find((p) => p.uid === owner.uid).legalTiles[0].split(',').map(Number);
  const moved = applyAction(state, { type: 'move', uid: owner.uid, row: cell[0], col: cell[1] });
  assert.equal(moved.ok, true, moved.error?.message);
  for (const token of selected.tokens) {
    const stack = moved.state.summons.find((p) => p.ownerUid === owner.uid && p.tokenId === token.tokenId);
    assert.ok(stack, `${token.tokenId} has a visible stack`);
    assert.equal(stack.count, token.count, `${token.tokenId} has its native deployLimit`);
  }
  const visible = prepView(viewSession(moved.state, { data, catalog }), catalog).hand;
  assert.equal(visible.filter((p) => p?.kind === 'token' && p.ownerUid === Number(owner.uid.slice(1))).length, selected.tokens.length);
});

test('named Darkmoon support cards use their declared native token prototype body', () => {
  const data = getData(); const catalog = getCatalog(data);
  const specs = [
    ['darkmoon:support-cat-1-1', '狼群投影', 'token_10028_vigil_wolf', 1, 1],
    ['darkmoon:support-cat-2-2', '狼群投影', 'token_10028_vigil_wolf', 2, 2],
    ['darkmoon:support-elemental-2-2', '小自在投影', 'token_10015_dusk_drgn', 2, 2],
  ];
  for (const [id, name, prototypeTokenId, attackPoints, healthPoints] of specs) {
    const op = catalog.operators[id]; assert.ok(op, id);
    const raw = op.source.normalChess;
    const token = Object.values(data.tokens).find((x) => x.tokenId === prototypeTokenId);
    const ownerId = token.owners.find((x) => x.endsWith('_a'));
    const proto = token.variants[ownerId];
    assert.equal(op.name, name);
    assert.equal(op.darkmoonPrototypeTokenId, prototypeTokenId);
    assert.equal(op.darkmoonPrototypeOwnerChessId, ownerId);
    assert.equal(raw.nativeGrowth?.source?.table, 'character_table.json');
    assert.equal(raw.nativeGrowth?.source?.revision, data.chess[ownerId]?.nativeGrowth?.source?.revision);
    assert.deepEqual(raw.nativeGrowth, token.nativeGrowth, 'support growth follows the real token, without pre-scaling');
    assert.deepEqual(op.darkmoonPrototypeScale, { attack: 0.4 * attackPoints, health: 0.4 * healthPoints, defense: 0.4 });
    assert.deepEqual(raw.darkmoonPrototypeScale, op.darkmoonPrototypeScale,
      'the level-curve consumer receives the same effective points used for the base body');
    assert.equal(raw.assets.avatar, prototypeTokenId);
    assert.deepEqual(raw.rangeGrid, proto.rangeGrid || token.rangeGrid);
    assert.equal(raw.dmgType, proto.dmgType || token.dmgType);
    assert.equal(raw.stats.atk, Math.round(proto.stats.atk * attackPoints * 0.4));
    assert.equal(raw.stats.maxHp, Math.round(proto.stats.maxHp * healthPoints * 0.4));
    assert.equal(raw.stats.def, Math.round(proto.stats.def * 0.4));
    assert.equal(raw.stats.res, proto.stats.res);
    assert.equal(raw.stats.blockCnt, 1, 'the existing support block count remains its authored Workshop difference');
  }
  const wolf = data.tokens.token_10028_vigil_wolf;
  const vigil = data.chess.chess_char_3_19_a;
  assert.notDeepEqual(wolf.nativeGrowth.phases, vigil.nativeGrowth.phases, 'the wolf uses its own token curve, not Vigil operator stats');
  assert.notEqual(wolf.nativeGrowth.phases[2].attributesKeyFrames.at(-1).data.atk,
    vigil.nativeGrowth.phases[2].attributesKeyFrames.at(-1).data.atk,
    'wolf and Vigil attack endpoints are independently sourced');
});

for (const elite of [false, true]) for (const growthMode of ['badges', 'levels']) {
  test(`Catherine ${elite ? 'elite' : 'normal'} ${growthMode} preserves and deploys two mixed-terrain markers in a real opening wave`, () => {
    const data = getData(), catalog = getCatalog(data);
    let state = buyOperator('chess_char_4_11_a', growthMode);
    const owner = state.pieces[0];
    if (elite) { owner.chessId = 'chess_char_4_11_b'; owner.elite = true; }
    const ownerView = viewSession(state, { data, catalog }).pieces.find(p => p.uid === owner.uid);
    const ownerTile = ownerView.legalTiles[0].split(',').map(Number);
    const moved = applyAction(state, { type: 'move', uid: owner.uid, row: ownerTile[0], col: ownerTile[1] });
    assert.equal(moved.ok, true, moved.error?.message);
    state = moved.state;
    const stack = state.summons.find(p => p.ownerUid === owner.uid && p.tokenId === 'token_10041_cathy_catsld');
    assert.equal(stack?.count, 2, 'the native deploy limit supplies two markers');
    const field = getIndependentField(state, { data, catalog });
    const cells = viewSession(state, { data, catalog }).pieces.find(p => p.uid === stack.uid).legalTiles.map(k => k.split(',').map(Number));
    const high = cells.find(([r,c]) => field.deployMap.get(`${r},${c}`) === 'ranged');
    const low = cells.find(([r,c]) => field.deployMap.get(`${r},${c}`) === 'melee');
    assert.ok(high && low, 'the real stage offers valid high and ground placement');
    for (const [row,col] of [high,low]) {
      const placed = applyAction(state, { type: 'move', uid: stack.uid, row, col, dir: 'RIGHT' });
      assert.equal(placed.ok, true, placed.error?.message);
      state = placed.state;
    }
    const markers = state.summons.filter(p => p.ownerUid === owner.uid && p.row != null);
    assert.equal(markers.length, 2);
    assert.equal(battleUnits(state, catalog, data).filter(u => u.kind === 'token').length, 2);
    const battle = runIndependentBattle(state, { data, catalog });
    const spawns = battle.replay.frames.flatMap(f => (f.ev || []).filter(e => e[0] === 'spawn' && e[1]?.defId === stack.tokenId));
    assert.equal(spawns.length, 2, 'both markers reach the native battle replay');
    assert.deepEqual(new Set(spawns.map(e => e[1].uid)), new Set(markers.map(p => p.uid)));
    assert.ok(spawns.every(e => e[1].ownerUid === owner.uid));
    assert.equal(battle.diagnostics.errorCount, 0);
  });
}
