import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { Battle } from '../../server/sim/Battle.js';
import { createResonanceKits } from '../../server/sim/content/resonance/kits.js';
import { installResonanceEquipment } from '../../server/sim/content/resonance/equipment.js';
import { installPrototypeSourceGear } from '../../server/sim/content/resonance/prototype-source-gear.js';
import { prototypeSourceGearDefinitions } from '../../shared/resonance/prototype-source-gear.js';
import { setPrototypeRatingBonus } from '../../server/sim/content/resonance/prototype-rating.js';
import { resolvePrototypeRatingReference } from '../../server/sim/content/resonance/prototype-rating.js';
import { tftMrToNativeResistance } from '../../shared/resonance/prototype-resistance.js';
import { resolvePrototypeCritical } from '../../shared/resonance/prototype-critical.js';
import { enemyRec, flatStage } from '../helpers/battleHarness.js';
import { performAttack } from '../../server/sim/ai.js';

const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
const reference=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft-set13-14.23.json','utf8'));
const catalog=getResonanceCatalog(data,{rulesVersion:3,seed:981});
const SET13_NAMES=/正义之手|莫雷洛秘典|最后的轻语|守护誓约|鬼索的狂暴之刃|珠光护手|皇冠卫士/;

function makeBattle(gearId,{seed=981}={}){
  const operator=Object.values(catalog.operators).find((row)=>row.cost===3);
  const uid='source-gear-holder';
  const gearRows=gearId?(Array.isArray(gearId)?gearId:[gearId]):[];
  const equipment=gearRows.map((entry,index)=>typeof entry==='string'?{uid:`source-gear-item-${index}`,itemId:entry}:{uid:`source-gear-item-${index}`,...entry,itemId:entry.itemId??entry.id});
  const state={rulesVersion:3,pieces:[{uid,operatorId:operator.id,star:1,row:9,col:2,dir:'RIGHT',equipment,extraPacts:[]}],specialEntities:[]};
  const player={playerId:'resonance',units:[{uid,chessId:operator.id,skillIndex:operator.fixedSkillIndex??0,moduleId:'none',row:9,col:2,dir:'RIGHT',star:1,items:equipment,extraPacts:[]}]};
  const battle=new Battle({seed,kind:'normal',round:1,timeLimit:120,autoFinish:false,stage:flatStage({id:'prototype-source-gear'}),data,players:[player],kits:createResonanceKits(catalog,state,data),content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:30,dpPerSec:1,dpMax:99}});
  const holder=battle.allyUnits.find((unit)=>unit.kind==='op');
  installResonanceEquipment(battle,{catalog,state});installPrototypeSourceGear(battle,state,catalog,[]);battle.start();
  const enemy=(def=100)=>battle.spawnEnemy('source-gear-target',{pos:[9,8],def:enemyRec({key:'source-gear-target',hp:5000,atk:0,speed:0,def,rank:'NORMAL'})});
  const advance=(seconds)=>{const end=battle.time+seconds;while(battle.time+1e-8<end&&!battle.finished)battle.step();};
  return {battle,state,holder,enemy,advance};
}

test('seven Crown source items are granted as the closest native completed item, never as independent items',()=>{
  const rows=reference.equipmentCandidates;
  assert.equal(prototypeSourceGearDefinitions.length,7);
  for(const item of prototypeSourceGearDefinitions){
    const source=rows.find((row)=>row.apiName===item.sourceApiName);
    assert.ok(source,item.sourceApiName);
    assert.equal(item.sourceName,source.name,item.sourceApiName);
    assert.deepEqual(item.composition,source.composition,item.sourceApiName);
    const native=catalog.equipment[item.nativeItemId];
    assert.equal(native?.kind,'completed',`${item.sourceApiName} maps to a native completed item`);
    assert.equal(catalog.prototypeSourceGear.bySourceApiName[item.sourceApiName],item.nativeItemId);
    const alias=catalog.equipment[item.id];
    assert.equal(alias.grantAllowed,false,'an old id is never granted again');
    assert.equal(alias.legacyAliasOf,item.nativeItemId);
    assert.equal(alias.name,native.name);assert.doesNotMatch(`${alias.name}${alias.description}`,SET13_NAMES);
  }
  assert.equal(new Set(prototypeSourceGearDefinitions.map((row)=>row.nativeItemId)).size,7,'each source item has its own native counterpart');
  const sourceCrowns=catalog.prototypeSeason.augmentCandidates.filter((row)=>row.apiName.endsWith('Crown'));
  const playable=Object.values(catalog.strategies).filter((row)=>row.source?.recordId?.endsWith('Crown'));
  assert.ok(playable.length>0);
  for(const strategy of playable){
    const source=sourceCrowns.find((row)=>row.apiName===strategy.source.recordId);
    const expected=(source.grantedItems??[]).map((row)=>catalog.prototypeSourceGear.bySourceApiName[row.apiName]).filter(Boolean);
    const rewards=strategy.effects[0].params.bonusRewards.filter((row)=>row.kind==='item').map((row)=>row.itemId);
    for(const id of expected)assert.ok(rewards.includes(id),`${source.apiName} grants ${id}`);
    assert.ok(rewards.every((id)=>!id.startsWith('prototype_source_gear_')),`${source.apiName} grants no Set 13 source item`);
    assert.doesNotMatch(strategy.description,SET13_NAMES,`${strategy.name} names the native item`);
  }
});

test('rating ledger converts the aggregate once and replaces/removes keyed ratings without touching base stats',()=>{
  const buffs=new Map();const unit={uid:'rating-unit',mem:{},s:{def:7,res:8}};
  const battle={addBuff(_unit,buff){buffs.set(buff.key,buff);},removeBuff(_unit,key){buffs.delete(key);}};
  const power={armor:40,magicResist:50,attackDamage:200};
  const first=setPrototypeRatingBonus(battle,unit,'trait',{armor:20,magicResist:20},power);
  const second=setPrototypeRatingBonus(battle,unit,'gear',{armor:20,magicResist:20},power);
  assert.equal(buffs.size,1,'one aggregate modifier is installed per unit');
  assert.equal(second.total.armor,40);assert.equal(second.total.magicResist,40);
  assert.notEqual(second.mods.defFlat,first.mods.defFlat*2,'rating conversion is nonlinear and performed after aggregation');
  const replaced=setPrototypeRatingBonus(battle,unit,'trait',{armor:10,magicResist:0},power);
  assert.equal(replaced.total.armor,30);assert.equal(replaced.total.magicResist,20);
  setPrototypeRatingBonus(battle,unit,'gear',{armor:0,magicResist:0},power);
  assert.equal(unit.mem.prototypeRatingBonuses.gear,undefined);
  assert.equal(buffs.size,1);
  setPrototypeRatingBonus(battle,unit,'trait',{armor:0,magicResist:0},power);
  assert.equal(buffs.size,0);
  assert.deepEqual(unit.s,{def:7,res:8});
});

test('null source MR stays unknown while rating bonuses use a finite Native baseline fallback',()=>{
  const {battle,holder}=makeBattle(null);
  const power={armor:40,magicResist:null,attackDamage:200};
  const nativeMr=holder.base.res;
  const zero=resolvePrototypeRatingReference(holder,power);
  assert.equal(power.magicResist,null,'the source record is not rewritten');
  assert.equal(zero.fallback.magicResist,'native-base-resistance-percent-inverted-to-rating');
  assert.ok(Number.isFinite(zero.powerReference.magicResist));
  const baseline=setPrototypeRatingBonus(battle,holder,'null-mr-test',{armor:0,magicResist:0},power);
  assert.equal(holder.s.res,nativeMr,'without rating bonus Native resistance stays at its base');
  const boosted=setPrototypeRatingBonus(battle,holder,'null-mr-test',{armor:0,magicResist:20},power);
  const rating=100*nativeMr/(100-nativeMr);
  assert.ok(Math.abs(holder.s.res-tftMrToNativeResistance(rating+20))<1e-9);
  assert.equal(boosted.fallback.magicResist,baseline.fallback.magicResist);
  const immune={base:{res:100},s:{res:100}};
  const immuneResolved=resolvePrototypeRatingReference(immune,{magicResist:null});
  assert.equal(immuneResolved.powerReference.magicResist,null,'100% immunity is not inverted to Infinity');
  assert.ok(Number.isFinite(holder.s.res));
});

test('an old source-item id in a save acts as its native item and adds no Set 13 effect',()=>{
  const rage=makeBattle('prototype_source_gear_guinsoos_rageblade');
  const target=rage.enemy(0),initial=rage.holder.s.aspd;
  assert.ok(Math.abs(initial-(rage.holder.base.aspd+15))<1e-9,'有限加速器 carries the stats of its 叙拉古正装 component');
  performAttack(rage.battle,rage.holder,rage.battle.effectiveProfile(rage.holder),[target]);
  assert.ok(Math.abs(rage.holder.s.aspd-(initial+2))<1e-9,'an attack adds the native +2 attack speed');
  assert.equal(rage.holder.mem.prototypeSourceRageStacks,undefined,'no Set 13 stacking is installed');
  assert.equal(rage.battle.resonanceMetrics?.prototypeSourceGear?.prototype_source_gear_guinsoos_rageblade,undefined);
  assert.equal(rage.battle.errorCount,0);
});

test('critical helper rolls once and does not reapply an already resolved event',()=>{
  const source={side:'ally'},target={side:'enemy'},dmg={isSkill:true,mul:2};
  let rolls=0;const battle={rng(){rolls++;return .01;}};
  const event={source,target,dmg};
  const first=resolvePrototypeCritical(event,{battle,bonusChance:.5,abilityCrit:true,critDamageBonus:.1});
  const duplicate=resolvePrototypeCritical(event,{battle,bonusChance:.5,abilityCrit:true,critDamageBonus:.1});
  assert.equal(first.critical,true);assert.equal(dmg.mul,3);
  assert.equal(duplicate.duplicate,true);assert.equal(rolls,1);

  const native=makeBattle(null),nativeTarget=native.enemy(0);native.battle.rng=()=>0;
  native.battle.dealDamage(native.holder,nativeTarget,{amount:100,type:'phys',isAttack:true,canDodge:false});
  assert.equal(native.battle.resonanceMetrics.prototypeSourceGear.prototype_source_gear_critical.hits,1,'V3 attack baseline applies without an equipped source item');
  assert.equal(native.battle.errorCount,0);
});
