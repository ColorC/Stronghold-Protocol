import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { applyAction, createSession, validateSession } from '../../server/modes/resonance/session.js';
import { buildResonanceBattle, getResonanceField } from '../../server/modes/resonance/battle.js';
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
  const robertaRange=ownerRangeKeys(robertaOp.stars[roberta.star].record.rangeGrid,roberta.row,roberta.col,roberta.dir);
  const outsideOwnerRange=legal.find(key=>!robertaRange.has(key));
  assert.ok(outsideOwnerRange,'non-ownerRange Roberta token may use any legal field tile, including outside the owner attack range');
  const [row,col]=outsideOwnerRange.split(',').map(Number);
  let action=applyAction(state,{type:'setSummonOrder',pieceUid:roberta.uid,tokenId:robertaToken,row,col},{catalog,fieldResolver:fieldFor});
  assert.equal(action.ok,true,action.error);state=action.state;
  assert.deepEqual(state.pieces.find(piece=>piece.uid===roberta.uid).summonOrders,[{tokenId:robertaToken,row,col}]);
  const {battle:robertaBattle}=buildResonanceBattle(state,{data,catalog,recording:false});
  const robertaMachine=robertaBattle.allyUnits.find(unit=>unit.kind==='token'&&unit.defId===robertaToken);
  assert.ok(robertaMachine,'talent-authored Roberta token variant is materialized into the real Battle');
  assert.equal(robertaMachine.ownerUnit?.uid,roberta.uid);
  assert.equal(robertaMachine.name,'全自动造型仪');
  assert.deepEqual([robertaMachine.tileR,robertaMachine.tileC],[row,col],'the explicit outside-range position reaches the real Battle unchanged');
  assert.ok(robertaBattle.resonanceSummonAnchors.some(anchor=>anchor.ownerUid===roberta.uid&&anchor.tokenId===robertaToken&&anchor.row===row&&anchor.col===col));
  assert.equal(robertaBattle.resonanceSummonAnchorGaps.length,0);
  assert.equal(robertaBattle.errorCount,0);

  const automaticState=structuredClone(state),automaticOwner=automaticState.pieces.find(piece=>piece.uid===roberta.uid);
  automaticOwner.summonOrders=[];
  const automaticField=fieldFor(automaticState);
  const otherPieces=automaticState.pieces.filter(piece=>piece.uid!==automaticOwner.uid);
  const preferred= [...automaticField.deployMap].find(([ownerKey])=>{
    const [ownerRow,ownerCol]=ownerKey.split(',').map(Number);
    if(otherPieces.some(other=>other.row===ownerRow&&other.col===ownerCol)||!canPlace(automaticField.deployMap,positionClass(robertaOp),ownerRow,ownerCol))return false;
    const grid=ownerRangeKeys(robertaOp.stars[1].record.rangeGrid,ownerRow,ownerCol,automaticOwner.dir);
    return [...grid].some(key=>{const [r,c]=key.split(',').map(Number);return !otherPieces.some(other=>other.row===r&&other.col===c)&&!(r===ownerRow&&c===ownerCol)&&canPlace(automaticField.deployMap,positionClass(data.tokens[robertaToken]),r,c);});
  });
  assert.ok(preferred,'test field allows an operator placement with a free summon tile inside owner range');
  [automaticOwner.row,automaticOwner.col]=preferred[0].split(',').map(Number);
  const automaticRange=ownerRangeKeys(robertaOp.stars[1].record.rangeGrid,automaticOwner.row,automaticOwner.col,automaticOwner.dir);
  const freeOwnerRange=[...automaticRange].find(key=>{const [r,c]=key.split(',').map(Number);return !otherPieces.some(other=>other.row===r&&other.col===c)&&canPlace(automaticField.deployMap,positionClass(data.tokens[robertaToken]),r,c);});
  assert.ok(freeOwnerRange,'test field has a legal owner-range tile for default placement preference');
  const automaticBattle=buildResonanceBattle(automaticState,{data,catalog}).battle;
  const automaticAnchor=automaticBattle.resonanceSummonAnchors.find(anchor=>anchor.ownerUid===roberta.uid&&anchor.tokenId===robertaToken);
  assert.ok(automaticRange.has(`${automaticAnchor.row},${automaticAnchor.col}`),'automatic anchor prefers an available owner-range tile before local-order fallback');

  const reservedState=structuredClone(automaticState),firstOwner=reservedState.pieces.find(piece=>piece.uid===roberta.uid);
  const secondOwner={...structuredClone(firstOwner),uid:'roberta-reserved-owner',summonOrders:[]};
  const occupiedKeys=new Set(reservedState.pieces.map(piece=>`${piece.row},${piece.col}`));
  const secondDeploy=[...automaticField.deployMap].find(([key])=>!occupiedKeys.has(key)&&canPlace(automaticField.deployMap,positionClass(robertaOp),...key.split(',').map(Number)));
  assert.ok(secondDeploy,'test field has a legal deployment tile for the second summon owner');
  [secondOwner.row,secondOwner.col]=secondDeploy[0].split(',').map(Number);
  reservedState.pieces.push(secondOwner);
  const reservedField=fieldFor(reservedState),reservedCells=legalSummonCells(reservedField,reservedState,secondOwner,robertaOp,robertaToken);
  const reservedCell=reservedCells.find(key=>!occupiedKeys.has(key));
  assert.ok(reservedCell,'second owner has a legal explicit summon cell');
  secondOwner.summonOrders=[{tokenId:robertaToken,row:Number(reservedCell.split(',')[0]),col:Number(reservedCell.split(',')[1])}];
  const reservedBattle=buildResonanceBattle(reservedState,{data,catalog}).battle;
  const firstAnchor=reservedBattle.resonanceSummonAnchors.find(anchor=>anchor.ownerUid===firstOwner.uid&&anchor.tokenId===robertaToken);
  const secondAnchor=reservedBattle.resonanceSummonAnchors.find(anchor=>anchor.ownerUid===secondOwner.uid&&anchor.tokenId===robertaToken);
  assert.ok(secondAnchor,'explicit order is not rejected by its own reservation');
  assert.deepEqual([secondAnchor.row,secondAnchor.col],[secondOwner.summonOrders[0].row,secondOwner.summonOrders[0].col]);
  assert.notDeepEqual([firstAnchor.row,firstAnchor.col],[secondAnchor.row,secondAnchor.col],'automatic earlier owner does not consume a later explicit order cell');

  for(const sources of [['display'],[]]){
    const excludedTokenData={...data,tokens:{...data.tokens,[robertaToken]:{...data.tokens[robertaToken],variants:{...data.tokens[robertaToken].variants,[ROberta]:{...data.tokens[robertaToken].variants[ROberta],sources}}}}};
    const excludedBattle=buildResonanceBattle(state,{data:excludedTokenData,catalog}).battle;
    assert.equal(excludedBattle.allyUnits.some(unit=>unit.kind==='token'&&unit.ownerUnit?.uid===roberta.uid&&unit.defId===robertaToken),false,`${sources.length?sources[0]:'unknown'} token sources are not promoted to placeable owner variants`);
  }

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
