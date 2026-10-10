import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { Battle } from '../../server/sim/Battle.js';
import { createResonanceKits } from '../../server/sim/content/resonance/kits.js';
import { installPrototypeSourceGear } from '../../server/sim/content/resonance/prototype-source-gear.js';
import { prototypeSourceGearDefinitions } from '../../shared/resonance/prototype-source-gear.js';
import { setPrototypeRatingBonus } from '../../server/sim/content/resonance/prototype-rating.js';
import { resolvePrototypeRatingReference } from '../../server/sim/content/resonance/prototype-rating.js';
import { tftMrToNativeResistance } from '../../shared/resonance/prototype-resistance.js';
import { resolvePrototypeCritical } from '../../shared/resonance/prototype-critical.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { enemyRec, flatStage } from '../helpers/battleHarness.js';
import { performAttack } from '../../server/sim/ai.js';

const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
const reference=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft-set13-14.23.json','utf8'));
const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:981});

function makeBattle(gearId,{seed=981,temporaryGear=[]}={}){
  const operator=Object.values(catalog.operators).find((row)=>row.cost===3);
  const uid='source-gear-holder';
  const gearRows=gearId?(Array.isArray(gearId)?gearId:[gearId]):[];
  const equipment=gearRows.map((entry,index)=>typeof entry==='string'?{uid:`source-gear-item-${index}`,itemId:entry}:{uid:`source-gear-item-${index}`,...entry,itemId:entry.itemId??entry.id});
  const state={rulesVersion:3,pieces:[{uid,operatorId:operator.id,star:1,row:9,col:2,dir:'RIGHT',equipment,extraPacts:[]}],specialEntities:[]};
  const player={playerId:'resonance',units:[{uid,chessId:operator.id,skillIndex:operator.fixedSkillIndex??0,moduleId:'none',row:9,col:2,dir:'RIGHT',star:1,items:equipment,extraPacts:[]}]};
  const battle=new Battle({seed,kind:'normal',round:1,timeLimit:120,autoFinish:false,stage:flatStage({id:'prototype-source-gear'}),data,players:[player],kits:createResonanceKits(catalog,state,data),content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:30,dpPerSec:1,dpMax:99}});
  const holder=battle.allyUnits.find((unit)=>unit.kind==='op');
  if(temporaryGear.length){holder.mem.prototypeConsumedComponents=equipment.map(row=>({uid:row.uid,itemId:row.itemId}));holder.mem.prototypeTemporaryItems=temporaryGear.map(row=>({...row,isTemporary:true}));}
  installPrototypeSourceGear(battle,state,catalog,[]);battle.start();
  const enemy=(def=100)=>battle.spawnEnemy('source-gear-target',{pos:[9,8],def:enemyRec({key:'source-gear-target',hp:5000,atk:0,speed:0,def,rank:'NORMAL'})});
  const advance=(seconds)=>{const end=battle.time+seconds;while(battle.time+1e-8<end&&!battle.finished)battle.step();};
  return {battle,state,holder,enemy,advance};
}

test('seven Crown source items match canonical Set 13 source records and have exact runtime identities',()=>{
  const rows=reference.equipmentCandidates;
  assert.equal(prototypeSourceGearDefinitions.length,7);
  for(const item of prototypeSourceGearDefinitions){
    const source=rows.find((row)=>row.apiName===item.sourceApiName);
    assert.ok(source,item.sourceApiName);
    assert.deepEqual(item.sourceEffects,source.effects,item.sourceApiName);
    assert.equal(item.sourceDescription,source.desc,item.sourceApiName);
    assert.deepEqual(item.composition,source.composition,item.sourceApiName);
    assert.equal(catalog.prototypeSourceGear.bySourceApiName[item.sourceApiName],item.id);
    assert.equal(catalog.equipment[item.id].grantAllowed,true);
  }
  const sourceCrowns=prototypeSeason.augmentCandidates.filter((row)=>row.apiName.endsWith('Crown'));
  const playable=Object.values(catalog.strategies).filter((row)=>row.source?.recordId?.endsWith('Crown'));
  assert.equal(sourceCrowns.length,21);
  assert.equal(playable.length,21);
  for(const strategy of playable){
    const source=sourceCrowns.find((row)=>row.apiName===strategy.source.recordId);
    const exactSourceIds=(source.grantedItems??[]).map((row)=>catalog.prototypeSourceGear.bySourceApiName[row.apiName]).filter(Boolean);
    const runtimeRewards=strategy.effects[0].params.bonusRewards.filter((row)=>row.kind==='item').map((row)=>row.itemId);
    for(const id of exactSourceIds)assert.ok(runtimeRewards.includes(id),`${source.apiName} maps ${id}`);
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

test('Last Whisper uses a non-stacking real PvE DEF adaptation and expires after three seconds',()=>{
  const withItem=makeBattle('prototype_source_gear_last_whisper');
  const baseline=makeBattle(null);
  const target=withItem.enemy(100),baseTarget=baseline.enemy(100);
  withItem.battle.dealDamage(withItem.holder,target,{amount:50,type:'phys',isAttack:true,canDodge:false});
  baseline.battle.dealDamage(baseline.holder,baseTarget,{amount:50,type:'phys',isAttack:true,canDodge:false});
  assert.equal(target.findBuff('resonance:sourcegear:last-whisper')?.mods?.defMul,.7);
  const hp=target.hp,baseHp=baseTarget.hp;
  withItem.battle.dealDamage(withItem.holder,target,{amount:100,type:'phys',isAttack:true,canDodge:false});
  baseline.battle.dealDamage(baseline.holder,baseTarget,{amount:100,type:'phys',isAttack:true,canDodge:false});
  assert.ok(hp-target.hp>baseHp-baseTarget.hp,'the physical hit benefits from the source armor cut');
  withItem.advance(3.2);
  assert.equal(target.findBuff('resonance:sourcegear:last-whisper'),null,'the Native PvE adaptation restores defense at expiry');
  assert.equal(withItem.battle.errorCount,0);
});

test('Hand of Justice maps source attack and omnivamp values to Native fractions at both health thresholds',()=>{
  const hoj=makeBattle('prototype_source_gear_hand_of_justice');
  const target=hoj.enemy(0);hoj.battle.rng=()=>.9;hoj.holder.hp=hoj.holder.s.maxHp*.4;
  hoj.battle.dealDamage(target,hoj.holder,{amount:1,type:'true',canDodge:false});
  assert.ok(Math.abs(hoj.holder.s.atk/hoj.holder.base.atk-1.15)<1e-7,'below half health, source AD 15% is a Native 0.15 atkPct modifier');
  const before=hoj.holder.hp;
  hoj.battle.dealDamage(hoj.holder,target,{amount:100,type:'phys',isAttack:true,canDodge:false});
  assert.ok(Math.abs(hoj.holder.hp-before-30)<2e-6,'below half health, 100 actual damage heals exactly 30%');
  assert.equal(hoj.battle.errorCount,0);

  const healthy=makeBattle('prototype_source_gear_hand_of_justice');healthy.battle.rng=()=>.9;
  const healthyTarget=healthy.enemy(0);healthy.holder.hp=healthy.holder.s.maxHp*.8;
  const healthyBefore=healthy.holder.hp;
  healthy.battle.dealDamage(healthy.holder,healthyTarget,{amount:100,type:'phys',isAttack:true,canDodge:false});
  assert.ok(Math.abs(healthy.holder.hp-healthyBefore-15)<2e-6,'above half health, 100 actual damage heals exactly 15%');
  assert.ok(Math.abs(healthy.holder.s.atk/healthy.holder.base.atk-1.3)<1e-7,'Hand of Justice doubles only its source 15% AD above half health');

  const artsDamage=(context)=>{
    const artsTarget=context.enemy(0),before=artsTarget.hp;
    context.battle.dealDamage(context.holder,artsTarget,{amount:100,type:'arts',isSkill:true,mul:1,canDodge:false});
    return before-artsTarget.hp;
  };
  const baseline=makeBattle(null),baselineArts=artsDamage(baseline);
  const highArts=makeBattle('prototype_source_gear_hand_of_justice');
  highArts.holder.hp=highArts.holder.s.maxHp*.5001;
  assert.ok(Math.abs(artsDamage(highArts)/baselineArts-1.30)<1e-7,'above half health, actual arts damage receives the source 15% AP doubled to 30%');
  const halfArts=makeBattle('prototype_source_gear_hand_of_justice');
  halfArts.holder.hp=halfArts.holder.s.maxHp*.5;
  halfArts.battle.dealDamage(halfArts.enemy(0),halfArts.holder,{amount:1,type:'true',canDodge:false});
  assert.ok(Math.abs(artsDamage(halfArts)/baselineArts-1.15)<1e-7,'at or below half health, actual arts damage retains the source 15% AP');
  assert.equal(halfArts.battle.errorCount,0);
});

test('Morello burn/wound consume actual damage events',()=>{
  const morello=makeBattle('prototype_source_gear_morellonomicon');
  const burning=morello.enemy(0);morello.battle.dealDamage(morello.holder,burning,{amount:20,type:'arts',isSkill:true,canDodge:false});
  assert.ok(Math.abs(burning.s.healingTakenMul-.67)<1e-9);
  const hp=burning.hp;morello.advance(1.1);
  assert.ok(burning.hp<hp,'the real periodic hook applies max-health true damage');
  assert.equal(morello.battle.errorCount,0);
});

test('source gear quality scales only source base stats and duplicate non-unique copies each contribute',()=>{
  const id='prototype_source_gear_hand_of_justice';
  assert.equal(catalog.equipment[id].unique,false,'the source does not mark Hand of Justice unique');
  const normal=makeBattle(id),artifact=makeBattle([{itemId:id,quality:'artifact'}]),radiant=makeBattle([{itemId:id,quality:'radiant'}]);
  assert.ok(Math.abs(normal.holder.s.atk/normal.holder.base.atk-1.3)<1e-7);
  assert.ok(Math.abs(normal.holder.s.artsDealtMul-1.3)<1e-7,'normal quality consumes source AP at its above-half double value');
  assert.ok(Math.abs(artifact.holder.s.atk/artifact.holder.base.atk-1.45)<1e-7,'artifact adds 50% of source AD base stats');
  assert.ok(Math.abs(artifact.holder.s.artsDealtMul-1.45)<1e-7,'artifact scales source AP base stats by the same 50% quality factor');
  assert.ok(Math.abs(radiant.holder.s.atk/radiant.holder.base.atk-1.6)<1e-7,'radiant adds 100% of source AD base stats');
  assert.ok(Math.abs(radiant.holder.s.artsDealtMul-1.6)<1e-7,'radiant scales source AP base stats by the same 100% quality factor');
  const double=makeBattle([id,id]);
  assert.ok(Math.abs(double.holder.s.atk/double.holder.base.atk-1.6)<1e-7,'two allowed copies each contribute source AD and threshold bonus');
  assert.ok(Math.abs(double.holder.s.artsDealtMul-1.6)<1e-7,'two allowed copies each contribute their source AP and threshold bonus');
  const vow='prototype_source_gear_protectors_vow',normalVow=makeBattle(vow),artifactVow=makeBattle([{itemId:vow,quality:'artifact'}]);
  assert.equal(normalVow.holder.mem.prototypeRatingBonuses['source-gear'].armor,20);
  assert.equal(artifactVow.holder.mem.prototypeRatingBonuses['source-gear'].armor,30,'source rating stats are scaled before the shared nonlinear conversion');
  for(const quality of ['artifact','support','radiant','radiant_conversion']){
    const effect=catalog.prototypeEconomy.qualityEffects[quality][id];
    assert.equal(effect.sourceStatsFactor,quality==='support'?.25:quality==='radiant'?1:.5);
    assert.match(effect.adaptation,/不复制或强化其被动效果/);
  }
  const temporary=makeBattle(null,{temporaryGear:[{itemId:id,quality:'radiant',sourceTraitId:'rhodes'}]});
  assert.ok(Math.abs(temporary.holder.s.atk/temporary.holder.base.atk-1.6)<1e-7,'battle-local Scrap conversion receives the same source-quality consumer');
  assert.deepEqual(temporary.state.pieces[0].equipment,[],'temporary gear does not mutate persistent session inventory');
  const crowns=makeBattle(['prototype_source_gear_crownguard','prototype_source_gear_crownguard']);
  assert.equal(catalog.equipment.prototype_source_gear_crownguard.unique,false);
  assert.equal(crowns.holder.buffs.filter(buff=>buff.key.startsWith(`resonance:sourcegear:crownguard:${crowns.holder.uid}:`)).length,2);
  const artsBefore=crowns.holder.s.artsDealtMul;crowns.advance(8.2);
  assert.ok(crowns.holder.s.artsDealtMul-artsBefore>.49,'each non-unique Crownguard contributes its own delayed AP passive');
});

test('Rageblade uses real attacks and Crownguard grants AP at eight seconds even if its shield breaks early',()=>{
  const rage=makeBattle('prototype_source_gear_guinsoos_rageblade');
  const target=rageTarget(rage);
  const initial=rage.holder.s.aspd;
  performAttack(rage.battle,rage.holder,rage.battle.effectiveProfile(rage.holder),[target]);
  assert.equal(rage.holder.mem.prototypeSourceRageStacks,1);
  assert.ok(rage.holder.s.aspd>initial,'a real native attack event grants stacking speed');

  const crown=makeBattle('prototype_source_gear_crownguard');
  const shield=crown.holder.findBuff(`resonance:sourcegear:crownguard:${crown.holder.uid}:0`);
  assert.ok(shield&&shield.shield>0);
  const initialArts=crown.holder.s.artsDealtMul;
  crown.advance(8.2);
  assert.ok(crown.holder.s.artsDealtMul>initialArts,'the timed shield expires naturally and grants the source AP');
  assert.equal(crown.battle.resonanceMetrics.prototypeSourceGear.prototype_source_gear_crownguard.shield_expired,1);
  assert.equal(crown.battle.errorCount,0);

  const broken=makeBattle('prototype_source_gear_crownguard');
  const brokenShield=broken.holder.findBuff(`resonance:sourcegear:crownguard:${broken.holder.uid}:0`);
  const artsBefore=broken.holder.s.artsDealtMul;
  broken.advance(1.1);
  const shieldTotal=broken.holder.buffs.reduce((sum,buff)=>sum+Math.max(0,Number(buff.shield)||0),0);
  broken.battle.dealDamage(broken.enemy(0),broken.holder,{amount:shieldTotal,type:'true',canDodge:false});
  assert.equal(broken.holder.findBuff(`resonance:sourcegear:crownguard:${broken.holder.uid}:0`),null,'the shield can be broken before its timer');
  broken.advance(6.8);
  assert.equal(broken.holder.s.artsDealtMul,artsBefore,'breaking early does not grant the delayed AP early');
  broken.advance(.4);
  assert.ok(broken.holder.s.artsDealtMul>artsBefore,'the independent eight-second grant survives early shield removal');
  assert.equal(broken.battle.resonanceMetrics.prototypeSourceGear.prototype_source_gear_crownguard.shield_expired,1);
  broken.advance(1);
  assert.equal(broken.battle.resonanceMetrics.prototypeSourceGear.prototype_source_gear_crownguard.shield_expired,1,'the timer grants AP exactly once');
  assert.equal(broken.battle.errorCount,0);
});

function rageTarget(context){return context.enemy(0);}

test('Vow enters the shared rating ledger once and Jeweled Gauntlet allows skills to crit at holder crit chance',()=>{
  const vow=makeBattle('prototype_source_gear_protectors_vow');
  const enemy=vow.enemy(0);
  vow.holder.hp=vow.holder.s.maxHp*.3;
  vow.battle.dealDamage(enemy,vow.holder,{amount:1,type:'phys',isAttack:true,canDodge:false});
  assert.ok(vow.holder.findBuff(`resonance:sourcegear:vow:${vow.holder.uid}`)?.shield>0);
  assert.deepEqual(vow.holder.mem.prototypeRatingBonuses['source-gear'],{armor:40,magicResist:20});
  assert.equal(vow.battle.errorCount,0);

  for(const [roll,critical] of [[.5,true],[.59,true],[.61,false]]){
    const jeweled=makeBattle('prototype_source_gear_jeweled_gauntlet');
    const target=jeweled.enemy(0);let rolls=0;jeweled.battle.rng=()=>{rolls++;return roll;};
    const before=target.hp;
    jeweled.battle.dealDamage(jeweled.holder,target,{amount:100,type:'arts',isSkill:true,mul:1,canDodge:false});
    assert.ok(target.hp<before);
    assert.equal(rolls,1,'one crit roll is shared for the actual hit');
    assert.equal(target.hp,critical?before-189:before-135,`skill roll ${roll} respects 25% base + 35% item chance, after source AP`);
    assert.equal(jeweled.battle.errorCount,0);
  }
  const noSkillCrit=makeBattle(null);let rolls=0;noSkillCrit.battle.rng=()=>{rolls++;return 0;};
  noSkillCrit.battle.dealDamage(noSkillCrit.holder,noSkillCrit.enemy(0),{amount:100,type:'arts',isSkill:true,mul:1,canDodge:false});
  assert.equal(rolls,0,'skills without a source/trait permission do not roll for criticals');
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
