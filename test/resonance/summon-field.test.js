import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { getResonanceField } from '../../server/modes/resonance/battle.js';
import { legalSummonCells, selectedSummonIds } from '../../server/modes/resonance/summons.js';
import { canPlace, ownerRangeKeys, positionClass } from '../../server/match/board.js';

const DATA_DIR='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';
const ROberta='chess_native_char_484_robrta_a';
const VIGIL='chess_char_3_19_a';
const SWIRE='chess_char_3_04_a';

test('getResonanceField exposes native summon metadata and official actions enforce it',()=>{
  const data=loadData(DATA_DIR,{log:{warn(){},error(){},info(){}}});
  const environmentId='origin_laterano',seed=1,catalog=getResonanceCatalog(data,{environmentId,seed});
  assert.ok([ROberta,VIGIL,SWIRE].every(id=>catalog.config.activeOperatorIds.includes(id)),'seeded 65-operator pool includes the real summon fixtures');
  const created=createSession({seed,difficulty:'NORMAL',environmentId,catalog});assert.equal(created.ok,true,created.error);
  let state=created.state;
  for(const piece of state.pieces)state.poolRemaining[piece.operatorId]+=({1:1,2:3,3:9})[piece.star];
  state.pieces=[];state.level=10;state.phase='prep';state.nodeStarted=true;
  const makePiece=(operatorId)=>{
    assert.ok(state.poolRemaining[operatorId]>0,`pool contains ${operatorId}`);state.poolRemaining[operatorId]--;
    return {uid:`p${state.nextUid++}`,operatorId,star:1,equipment:[],growth:{},row:null,col:null,dir:'RIGHT',summonOrders:[]};
  };
  state.pieces=[makePiece(ROberta),makePiece(VIGIL),makePiece(SWIRE)];
  const operator=(id)=>catalog.operators[id];
  for(const piece of state.pieces)assert.ok(operator(piece.operatorId).stars[piece.star].record,'selected star record is present');
  const fieldFor=(current)=>getResonanceField(current,{data,catalog});
  const metadataField=fieldFor(state);
  const metadataCases=[
    [ROberta,'token_10018_robrta_mach'],
    [VIGIL,'token_10028_vigil_wolf'],
    ['chess_native_char_2023_ling_a','token_10020_ling_soul3'],
    ['chess_native_char_242_otter_a','token_10004_otter_motter'],
  ];
  for(const [ownerId,tokenId] of metadataCases){
    const resolved=metadataField.resolveToken(tokenId,ownerId,operator(ownerId).fixedSkillIndex),native=data.tokens[tokenId];
    assert.ok(resolved,`native token resolved: ${tokenId}`);
    assert.equal(resolved.placeable,native.placeable===true,`${tokenId} placeable comes from native token metadata`);
    assert.equal(resolved.ownerRange,native.ownerRange===true,`${tokenId} ownerRange comes from native token metadata`);
    assert.equal(resolved.position,native.position,`${tokenId} placement class comes from native token metadata`);
  }
  assert.equal(metadataField.resolveToken('token_10028_vigil_wolf',VIGIL,operator(VIGIL).fixedSkillIndex).ownerRange,true);
  assert.equal(metadataField.resolveToken('token_10031_swire2_gdtrap',SWIRE,operator(SWIRE).fixedSkillIndex).placeable,false);

  for(const piece of state.pieces){
    const op=operator(piece.operatorId),field=fieldFor(state);
    const tile=[...field.deployMap].find(([key,tileClass])=>{
      const [row,col]=key.split(',').map(Number);return !state.pieces.some(other=>other.row===row&&other.col===col)&&canPlace(field.deployMap,positionClass(op),row,col);
    });
    assert.ok(tile,`real field has a legal deployment tile for ${op.name}`);
    const [row,col]=tile[0].split(',').map(Number),deployed=applyAction(state,{type:'deploy',pieceUid:piece.uid,row,col,dir:'RIGHT'},{catalog,fieldResolver:fieldFor});
    assert.equal(deployed.ok,true,deployed.error);state=deployed.state;
  }
  const roberta=state.pieces.find(piece=>piece.operatorId===ROberta),robertaOp=operator(ROberta),robertaToken=selectedSummonIds(robertaOp,1)[0];
  assert.equal(robertaToken,'token_10018_robrta_mach');
  const field=fieldFor(state),legal=legalSummonCells(field,state,roberta,robertaOp,robertaToken);
  assert.ok(legal.length,'native Roberta summon has at least one legal cell');
  const [row,col]=legal[0].split(',').map(Number);
  let action=applyAction(state,{type:'setSummonOrder',pieceUid:roberta.uid,tokenId:robertaToken,row,col},{catalog,fieldResolver:fieldFor});
  assert.equal(action.ok,true,action.error);state=action.state;
  assert.deepEqual(state.pieces.find(piece=>piece.uid===roberta.uid).summonOrders,[{tokenId:robertaToken,row,col}]);

  const occupied=state.pieces.find(piece=>piece.uid!==roberta.uid);
  action=applyAction(state,{type:'setSummonOrder',pieceUid:roberta.uid,tokenId:robertaToken,row:occupied.row,col:occupied.col},{catalog,fieldResolver:fieldFor});
  assert.equal(action.error,'CELL_OCCUPIED','official action rejects an occupied tile before accepting the order');

  const vigil=state.pieces.find(piece=>piece.operatorId===VIGIL),vigilOp=operator(VIGIL),vigilToken=selectedSummonIds(vigilOp,1)[0];
  const vigilField=fieldFor(state),vigilDef=vigilField.resolveToken(vigilToken,VIGIL,vigilOp.fixedSkillIndex);
  assert.equal(vigilDef.ownerRange,true);
  const range=ownerRangeKeys(vigilOp.stars[1].record.rangeGrid,vigil.row,vigil.col,vigil.dir),currentlyOccupied=new Set(state.pieces.map(piece=>`${piece.row},${piece.col}`));
  const outside=[...vigilField.deployMap].find(([key,tileClass])=>{
    const [r,c]=key.split(',').map(Number);return !range.has(key)&&!currentlyOccupied.has(key)&&canPlace(vigilField.deployMap,positionClass(vigilDef),r,c);
  });
  assert.ok(outside,'native field exposes a legal summon-class tile outside the owner attack range');
  const [outsideRow,outsideCol]=outside[0].split(',').map(Number);
  action=applyAction(state,{type:'setSummonOrder',pieceUid:vigil.uid,tokenId:vigilToken,row:outsideRow,col:outsideCol},{catalog,fieldResolver:fieldFor});
  assert.equal(action.error,'ILLEGAL_SUMMON_POSITION','official action enforces the native owner-range restriction');

  const swire=state.pieces.find(piece=>piece.operatorId===SWIRE),swireOp=operator(SWIRE),swireToken=selectedSummonIds(swireOp,1)[0];
  assert.equal(swireToken,'token_10031_swire2_gdtrap');
  const swireField=fieldFor(state),swireDef=swireField.resolveToken(swireToken,SWIRE,swireOp.fixedSkillIndex);
  assert.equal(swireDef.placeable,false);
  const free=[...swireField.deployMap].find(([key,tileClass])=>{
    const [r,c]=key.split(',').map(Number);return !currentlyOccupied.has(key)&&canPlace(swireField.deployMap,positionClass(swireDef),r,c);
  });
  assert.ok(free,'native field exposes a candidate tile to distinguish token placeability from board legality');
  const [freeRow,freeCol]=free[0].split(',').map(Number);
  action=applyAction(state,{type:'setSummonOrder',pieceUid:swire.uid,tokenId:swireToken,row:freeRow,col:freeCol},{catalog,fieldResolver:fieldFor});
  assert.equal(action.error,'ILLEGAL_SUMMON_POSITION','official action rejects the native non-placeable token');
  assert.equal(validateSession(state,{catalog}).ok,true,'rejected summon orders leave the authoritative session valid');
});
