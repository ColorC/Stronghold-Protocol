import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { Battle } from '../../server/sim/Battle.js';
import { createResonanceKits } from '../../server/sim/content/resonance/kits.js';
import { installPrototypeSourceGear } from '../../server/sim/content/resonance/prototype-source-gear.js';
import { installPrototypeEconomy } from '../../server/sim/content/resonance/prototype-economy.js';
import { applyPrototypeSourceGear, prototypeSourceGearDefinitions } from '../../shared/resonance/prototype-source-gear.js';
import { applyPrototypeEconomy, prototypeEconomyCopy } from '../../shared/resonance/prototype-economy.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { enemyRec, flatStage } from '../helpers/battleHarness.js';

const DATA_DIR=process.env.SP_DATA_DIR??'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const data=loadData(DATA_DIR,{log:{warn(){},error(){}}});

test('Chem equipment uses native flat amounts while source items route to native completed items',()=>{
  const projected=applyPrototypeSourceGear({equipment:{},prototypeSeason:{powerModel:'native-pve'}});
  assert.deepEqual(Object.keys(projected.equipment),[],'no source item is added as an independent item');
  for(const row of prototypeSourceGearDefinitions)assert.equal(projected.prototypeSourceGear.bySourceApiName[row.sourceApiName],row.nativeItemId,row.id);

  const nativeSeason={...prototypeSeason,powerModel:'native-pve'};
  const nativeEconomy=applyPrototypeEconomy({equipment:{},prototypeSeason:nativeSeason});
  const chem=Object.values(nativeEconomy.equipment).find(row=>row.source?.apiName==='TFT13_Crime_Prismatic_ShimmerBloom');
  const chemSource=nativeSeason.chemBaronItems.find(row=>row.apiName==='TFT13_Crime_Prismatic_ShimmerBloom');
  assert.ok(chem);
  assert.equal(chem.prototypeSourceEffects.ShieldAmount,chemSource.effects.ShieldAmount);
  assert.equal(chem.prototypeEffectiveEffects.ShieldAmount,chemSource.effects.ShieldAmount*4);
  assert.equal(chem.prototypeEffectiveEffects.Cadence,chem.prototypeSourceEffects.Cadence,'time remains unchanged');
  assert.ok(chem.description.includes(`${chemSource.effects.ShieldAmount*4}点护盾`));
  const bronze=nativeEconomy.equipment.prototype_chem_salvaged_contraption;
  assert.equal(bronze.prototypeEffectiveEffects.Health,bronze.prototypeSourceEffects.Health*4);
  assert.equal(bronze.prototypeEffectiveEffects.Armor,bronze.prototypeSourceEffects.Armor,'armor rating remains unchanged');
  assert.equal(bronze.prototypeEffectiveEffects.ReducedDamage,bronze.prototypeSourceEffects.ReducedDamage,'percent reduction remains unchanged');
  const toxin=Object.values(nativeEconomy.equipment).find(row=>row.source?.apiName==='TFT13_Crime_Prismatic_UnleashedToxins');
  assert.equal(toxin.prototypeEffectiveEffects.Mana,toxin.prototypeSourceEffects.Mana,'mana remains unchanged');
  assert.equal(toxin.prototypeEffectiveEffects.NumMissiles,toxin.prototypeSourceEffects.NumMissiles,'counts remain unchanged');
  assert.equal(toxin.prototypeEffectiveEffects.PrismaticWaveStunDuration,toxin.prototypeSourceEffects.PrismaticWaveStunDuration,'durations remain unchanged');
  const executioner=Object.values(nativeEconomy.equipment).find(row=>row.source?.apiName==='TFT13_Crime_Prismatic_ExecutionersVorpalblade');
  assert.equal(executioner.prototypeEffectiveEffects.PrismaticHeal,executioner.prototypeSourceEffects.PrismaticHeal*4,'fixed healing is scaled');
  const damage=Object.values(nativeEconomy.equipment).find(row=>row.source?.apiName==='TFT13_Crime_Bronze_MiningGauntlet');
  assert.equal(damage.prototypeSourceEffects.BonusDamageOnAttack,15);
  assert.equal(damage.prototypeEffectiveEffects.BonusDamageOnAttack,60);
  assert.equal(damage.prototypeEconomyEffect.amount,60);
  assert.match(damage.description,/60点真实伤害/);
  const oldEconomy=applyPrototypeEconomy({equipment:{},prototypeSeason});
  const oldChem=Object.values(oldEconomy.equipment).find(row=>row.source?.apiName==='TFT13_Crime_Prismatic_ShimmerBloom');
  assert.equal(oldChem.prototypeEffectiveEffects.ShieldAmount,oldChem.prototypeSourceEffects.ShieldAmount,'legacy seasons keep source Chem values');
});

test('native economy descriptions use the active pact names while legacy wording stays pinned',()=>{
  const pacts={academy:{name:'拉特兰'},risk:{name:'叙拉古'},conqueror:{name:'卡西米尔'},family:{name:'同袍'},armory:{name:'铸军'}};
  const native=applyPrototypeEconomy({equipment:{},prototypeSeason:{...prototypeSeason,id:'resonance-factions-1',powerModel:'native-pve'},pacts});
  assert.match(native.prototypeEconomy.copy.academy,/拉特兰/);
  assert.match(native.prototypeEconomy.copy.chemBaron,/叙拉古/);
  assert.match(native.prototypeEconomy.copy.conqueror,/卡西米尔/);
  assert.match(native.prototypeEconomy.copy.family,/同袍/);
  assert.match(native.prototypeEconomy.copy.junkerKing,/铸军/);
  assert.match(native.prototypeEconomy.chemBaron.skipOption.description,/叙拉古干员/);
  const chemAnvil=native.prototypeEconomy.gearConsumables.prototype_chem_gold_anvil;
  assert.match(chemAnvil.description,/黄金叙拉古装备/);

  const legacy=applyPrototypeEconomy({equipment:{},prototypeSeason,pacts});
  assert.equal(legacy.prototypeEconomy.copy.academy,prototypeEconomyCopy.academy);
  assert.equal(legacy.prototypeEconomy.chemBaron.skipOption.description,'略过本次市场，险境干员获得本档生命加成。');
  assert.match(legacy.prototypeEconomy.gearConsumables.prototype_chem_gold_anvil.description,/黄金险境装备/);
  const otherSeasonNativePower=applyPrototypeEconomy({equipment:{},prototypeSeason:{...prototypeSeason,powerModel:'native-pve'},pacts});
  assert.equal(otherSeasonNativePower.prototypeEconomy.copy.academy,prototypeEconomyCopy.academy,'native power alone does not change legacy-season wording');
});

test('an equipped Chem item adds a real native-scaled fixed-damage hit',()=>{
  const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:'resonance-factions-1',seed:913});
  for(const [copyId,pactId] of [['academy','academy'],['chemBaron','risk'],['conqueror','conqueror'],['family','family'],['junkerKing','armory']])
    assert.ok(catalog.prototypeEconomy.copy[copyId].includes(catalog.pacts[pactId].name),`${copyId} copy follows pact ${pactId}`);
  assert.ok(catalog.prototypeEconomy.chemBaron.skipOption.description.includes(catalog.pacts.risk.name));
  assert.ok(catalog.prototypeEconomy.gearConsumables.prototype_chem_gold_anvil.description.includes(catalog.pacts.risk.name));
  const operator=Object.values(catalog.operators).find(row=>row.cost===3);
  const uid='native-scaled-item-holder';
  const equipment=[
    {uid:'native-chem-gauntlet',itemId:'prototype_chem_salvaged_gauntlet'},
  ];
  const state={rulesVersion:3,pieces:[{uid,operatorId:operator.id,charId:operator.charId,star:1,row:9,col:2,dir:'RIGHT',equipment,extraPacts:[]}],specialEntities:[],prototypeMeta:{rulesVersion:3,economy:{}}};
  const player={playerId:'resonance',units:[{uid,chessId:operator.id,skillIndex:operator.fixedSkillIndex??0,moduleId:'none',row:9,col:2,dir:'RIGHT',star:1,items:equipment,extraPacts:[]}]};
  const battle=new Battle({seed:913,kind:'normal',round:1,timeLimit:120,autoFinish:false,stage:flatStage({id:'native-scaled-equipment'}),data,players:[player],kits:createResonanceKits(catalog,state,data),content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:30,dpPerSec:1,dpMax:99}});
  const holder=battle.allyUnits.find(unit=>unit.kind==='op');
  installPrototypeSourceGear(battle,state,catalog,[]);
  installPrototypeEconomy(battle,state,catalog,[]);
  battle.start();
  const target=battle.spawnEnemy('native-scaled-target',{pos:[9,8],def:enemyRec({key:'native-scaled-target',hp:100000,atk:0,speed:0,def:0,res:0,rank:'NORMAL'})});
  const before=target.hp;
  battle.dealDamage(holder,target,{amount:1,type:'phys',isAttack:true,canDodge:false});
  assert.equal(before-target.hp,61,'the 1-point hit also applies the Chem gauntlet native-scaled 60 true damage');
  assert.equal(battle.errorCount,0);
});
