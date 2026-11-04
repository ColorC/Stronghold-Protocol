import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrototypeEconomy } from '../../shared/resonance/prototype-economy.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { applyPrototypeGearAction, installPrototypeGearActions } from '../../server/modes/resonance/prototype-consumables.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

function catalog() {
  return applyPrototypeEconomy({prototypeSeason,campaign:{economy:{inventoryCapacity:10}},equipment:{
    blade:{id:'blade',name:'长刃',kind:'completed',unique:true,grantAllowed:true,baseEffects:[{kind:'component_stat',params:{atk:20}}],effects:[]},
    plate:{id:'plate',name:'铁甲',kind:'completed',unique:true,grantAllowed:true,baseEffects:[{kind:'component_stat',params:{def:40,hp:100}}],effects:[]},
    component:{id:'component',name:'组件',kind:'component',grantAllowed:true,effects:[]},
  }});
}
const state=(overrides={})=>({phase:'prep',seed:13,pieces:[],inventory:[],consumables:[],pendingChoices:[],...overrides});

test('remover returns the same equipped item to inventory and rejects full inventory atomically',()=>{
  const c=catalog(),original=state({pieces:[{uid:'p1',equipment:[{uid:'i1',itemId:'blade',quality:'artifact'}]}],consumables:[{uid:'c1',kind:'prototype_item_remover'}]});
  const result=applyPrototypeGearAction(original,c,{type:'useConsumable',consumableUid:'c1',itemUid:'i1'});
  assert.equal(result.state.pieces[0].equipment.length,0);assert.deepEqual(result.state.inventory,[{uid:'i1',itemId:'blade',quality:'artifact'}]);
  assert.equal(result.state.consumables.length,0);assert.equal(original.pieces[0].equipment.length,1,'input state remains unchanged');
  const full=state({inventory:Array.from({length:10},(_,i)=>({uid:`i${i}`,itemId:'blade'})),pieces:[{uid:'p1',equipment:[{uid:'held',itemId:'blade'}]}],consumables:[{uid:'c1',kind:'prototype_item_remover'}]});
  assert.throws(()=>applyPrototypeGearAction(full,c,{type:'useConsumable',consumableUid:'c1',itemUid:'held'}),/INVENTORY_CAPACITY/);
  assert.equal(full.pieces[0].equipment.length,1);assert.equal(full.consumables.length,1);
});

test('Reforger changes one item within its real current gear kind and consumes once',()=>{
  const c=catalog(),original=state({inventory:[{uid:'i1',itemId:'blade'}],consumables:[{uid:'c1',kind:'prototype_reforger'}]});
  const result=applyPrototypeGearAction(original,c,{type:'useConsumable',consumableUid:'c1',itemUid:'i1'});
  assert.notEqual(result.state.inventory[0].itemId,'blade');
  assert.equal(c.equipment[result.state.inventory[0].itemId].kind,'completed');
  assert.equal(result.state.consumables.length,0);assert.equal(original.inventory[0].itemId,'blade');
});

test('Anvils offer legal items, then return an exact quality grant and consume the source item',()=>{
  const c=catalog(),original=state({consumables:[{uid:'c1',kind:'prototype_artifact_anvil'}]});
  const opened=applyPrototypeGearAction(original,c,{type:'useConsumable',consumableUid:'c1'});
  const choice=opened.choiceDrafts[0];assert.equal(choice.economyKind,'gear_anvil');assert.equal(choice.metadata.quality,'artifact');
  assert.ok(choice.options.length>0);assert.ok(choice.options.every(option=>option.grant[0].quality==='artifact'&&c.equipment[option.grant[0].id].grantAllowed));
  const selectedState={...opened.state,pendingChoices:[{...choice,uid:'choice1'}]};
  const selected=applyPrototypeGearAction(selectedState,c,{type:'useConsumable',consumableUid:'c1',choiceUid:'choice1',optionIds:[choice.options[0].id]});
  assert.deepEqual(selected.events[0],{type:'prototype_gear_grant',grant:choice.options[0].grant[0],sourceConsumableUid:'c1'});
  assert.equal(selected.state.consumables.length,0);assert.equal(selectedState.consumables.length,1);
  assert.throws(()=>applyPrototypeGearAction(selectedState,c,{type:'useConsumable',consumableUid:'c1',choiceUid:'choice1',optionIds:['unoffered']}),/PROTOTYPE_GEAR_CHOICE_INVALID/);
});

test('Chem-Baron market anvils offer real source-tier equipment with actual effect consumers',()=>{
  const c=catalog(),original=state({consumables:[{uid:'c-chem',kind:'prototype_chem_market_anvil'}]});
  const opened=applyPrototypeGearAction(original,c,{type:'useConsumable',consumableUid:'c-chem'});
  const options=opened.choiceDrafts[0].options;
  assert.deepEqual(options.map(row=>row.grant[0].id).sort(),['prototype_chem_salvaged_contraption','prototype_chem_salvaged_gauntlet','prototype_chem_salvaged_revolver']);
  assert.ok(options.every(row=>c.equipment[row.grant[0].id]?.prototypeEconomyEffect),'each selection has an implemented hit, timer, or mitigation consumer');
  assert.equal(original.consumables.length,1,'opening the choice does not consume the anvil before a selection is claimed');
  const tiers=[['prototype_chem_silver_anvil','chemBaronSilver',8],['prototype_chem_gold_anvil','chemBaronGold',8],['prototype_chem_prismatic_anvil','chemBaronPrismatic',8],['prototype_chem_omega_anvil','chemBaronOmegaPrismatic',1]];
  for(const [kind,pool,size] of tiers){
    const openedTier=applyPrototypeGearAction(state({consumables:[{uid:`${kind}-uid`,kind}]}),c,{type:'useConsumable',consumableUid:`${kind}-uid`});
    assert.equal(openedTier.choiceDrafts[0].metadata.pool,pool);
    assert.equal(openedTier.choiceDrafts[0].options.length,size);
    assert.ok(openedTier.choiceDrafts[0].options.every(option=>c.equipment[option.grant[0].id]?.prototypeEconomyEffect));
  }
  assert.ok(c.prototypeEconomy.chemBaron.marketOptionsByThreshold[800][0].grant.some(grant=>grant.id==='prototype_chem_omega_anvil'));
});

test('quality equipment changes live Battle stats and support quality buffs the deployed team',()=>{
  const c=catalog(),h=makeBattle({defs:{chess:{guard:chessRec({id:'guard',stats:{atk:100,def:0,maxHp:1000}})}},units:[
    {uid:'p1',chessId:'guard',row:9,col:5},{uid:'p2',chessId:'guard',row:9,col:6},
  ],content:'none'});
  const input={pieces:[
    {uid:'p1',row:9,col:5,equipment:[{uid:'i1',itemId:'blade',quality:'artifact'}]},
    {uid:'p2',row:9,col:6,equipment:[{uid:'i2',itemId:'plate',quality:'support'}]},
  ]};
  installPrototypeGearActions(h.b,input,c);h.step();
  const holder=h.unit('p1'),supportHolder=h.unit('p2');
  assert.ok(holder.s.atk>100,'artifact quality adds the mapped native base stat through Battle.addBuff');
  assert.ok(supportHolder.s.maxHp>1000,'support quality adds its mapped base stats');
  assert.ok(h.allies().every(unit=>unit.buffs.some(buff=>buff.key.startsWith('resonance:v3:gear-support:i2:'))),'support gear reaches each live ally through a persistent battle buff');
});

test('Scrap battle-local completed item replaces its component effect and Radiant applies mapped bonus only in that Battle',()=>{
  const c=catalog();
  c.equipment.full={id:'full',name:'临时成装',kind:'completed',grantAllowed:true,
    effects:[{kind:'component_stat',params:{atk:30}},{kind:'attack_sp',params:{spPerAttack:2,perSecondCap:2}}],baseEffects:[]};
  c.prototypeEconomy.qualityEffects.radiant.full={mods:{atkFlat:30}};
  const h=makeBattle({defs:{chess:{guard:chessRec({id:'guard',stats:{atk:100,def:0,maxHp:1000}})}},units:[{uid:'p1',chessId:'guard',row:9,col:5}],content:'none'});
  const unit=h.unit('p1');
  unit.mem.prototypeTemporaryItems=[{itemId:'full',quality:'radiant',sourceComponents:['component'],sourceTraitId:'rhodes',isTemporary:true}];
  unit.mem.resonanceEquipmentEffects=[{kind:'component_stat',itemId:'component',itemKind:'component',params:{atk:5}}];
  installPrototypeGearActions(h.b,state({pieces:[{uid:'p1',row:9,col:5}]}),c);
  h.step();
  assert.ok(unit.s.atk>=160,'full item attack and its mapped Radiant bonus are consumed by the live Battle');
  assert.ok(unit.mem.resonanceEquipmentEffects.some(row=>row.itemId==='scrap:full'&&row.kind==='attack_sp'));
  assert.ok(!unit.mem.resonanceEquipmentEffects.some(row=>row.itemId==='component'),'converted component no longer contributes its old effect');
  assert.equal(state({pieces:[{uid:'p1',row:9,col:5}]}).pieces[0].equipment,undefined,'the temporary item never becomes persistent prep inventory');
});
