import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { Battle } from '../../server/sim/Battle.js';
import { createResonanceKits } from '../../server/sim/content/resonance/kits.js';
import { installPrototypePacts } from '../../server/sim/content/resonance/prototype-pacts.js';
import { activePrototypeTraits } from '../../server/sim/content/resonance/prototype-meta.js';
import { installPrototypeBattleAugments } from '../../server/sim/content/resonance/prototype-strategies.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { enemyRec, flatStage } from '../helpers/battleHarness.js';

const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:718});
const apiFor={automata_second_blast:'TFT13_Augment_Automata',bruiser_health_strike:'TFT13_Augment_Bruiser',conqueror_execute:'TFT13_Augment_Conqueror',dominator_shield_rush:'TFT13_Augment_Dominator',quickstriker_burst:'TFT13_Augment_Quickstriker',sentinel_shield_bash:'TFT13_Augment_Sentinel',sorcerer_death_burst:'TFT13_Augment_Sorcerer',watcher_battle_scars:'TFT13_Augment_Watcher'};
const source=(apiName)=>Object.values(catalog.strategies).find((row)=>row.source?.recordId===apiName);
const operatorsFor=(traitId,count)=>{
  const rows=[...new Map(Object.values(catalog.operators).filter((row)=>row.pacts.includes(traitId)).map((row)=>[row.charId,row])).values()];
  assert.ok(rows.length>=count,`need ${count} distinct ${traitId} members`);return rows.slice(0,count);
};
function makeBattle(apiName,traitId,count=1,{installPacts=false,selected=true}={}){
  const operators=operatorsFor(traitId,count),strategy=source(apiName);assert.ok(strategy,`missing strategy ${apiName}`);
  const pieces=operators.map((operator,index)=>({uid:`augment-${index+1}`,operatorId:operator.id,star:1,row:9,col:2+index,dir:'RIGHT',equipment:[],extraPacts:[]}));
  const state={rulesVersion:3,pieces,strategies:selected?[strategy.id]:[],strategyState:{}};
  const player={playerId:'resonance',units:operators.map((operator,index)=>({uid:pieces[index].uid,chessId:operator.id,skillIndex:operator.fixedSkillIndex??0,moduleId:'none',row:9,col:2+index,dir:'RIGHT',star:1,items:[],extraPacts:[]}))};
  const battle=new Battle({seed:718,kind:'normal',round:1,timeLimit:120,autoFinish:false,stage:flatStage({id:'prototype-battle-augment'}),data,players:[player],kits:createResonanceKits(catalog,state,data),content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:30,dpPerSec:1,dpMax:99}});
  if(installPacts)installPrototypePacts(battle,catalog,activePrototypeTraits(state,catalog));
  const allies=battle.allyUnits.filter((unit)=>unit.kind==='op');
  installPrototypeBattleAugments(battle,state,catalog);battle.start();for(const unit of allies)unit.deployed=true;battle.step();
  const enemy=(id,pos=[9,5],hp=10000)=>battle.spawnEnemy(id,{pos,def:enemyRec({key:id,hp,atk:0,speed:0,rank:'NORMAL'})});
  const advance=(seconds)=>{const until=battle.time+seconds;while(battle.time+1e-9<until&&!battle.finished)battle.step();};
  return {battle,state,operators,allies,enemy,advance};
}

test('all eight source battle augment adapters consume actual Battle events and have inactive negatives',()=>{
  {
    const m=makeBattle(apiFor.quickstriker_burst,'combo'),member=m.allies[0];
    m.advance(.01);assert.ok(member.buffs.some((buff)=>buff.key.includes(':burst:')),'combat start installs the source quick-strike timed buff');
    assert.equal(m.battle.resonanceMetrics.prototypeBattleAugments['TFT13_Augment_Quickstriker']?.bursts>0,true);
  }
  {
    const m=makeBattle(apiFor.bruiser_health_strike,'bruiser');const target=m.enemy('augment-bruiser');
    const before=target.hp;m.battle.dealDamage(m.allies[0],target,{amount:1,type:'phys',isAttack:true,canDodge:false});
    assert.ok(before-target.hp>=m.allies[0].s.maxHp*.07,'the actual attack scales from the holder health, not the enemy health');
  }
  {
    const m=makeBattle(apiFor.sentinel_shield_bash,'sentinel');const target=m.enemy('augment-sentinel');
    const before=target.hp;m.battle.dealDamage(m.allies[0],target,{amount:1,type:'phys',isAttack:true,canDodge:false});
    assert.ok(before-target.hp>1,'ready sentinel attack emits resistance-scaled arts damage');
  }
  {
    const m=makeBattle(apiFor.conqueror_execute,'conqueror');const target=m.enemy('augment-conqueror',undefined,100);
    target.hp=10;m.battle.dealDamage(m.allies[0],target,{amount:1,type:'phys',isAttack:true,canDodge:false});
    assert.equal(target.alive,false,'actual hit below the source threshold executes');
  }
  {
    const m=makeBattle(apiFor.dominator_shield_rush,'dominator',2),[member,ally]=m.allies;
    const before=member.s.aspd;m.battle.addBuff(member,{key:'fixture-shield',shield:100,duration:4});m.advance(.25);
    assert.ok(member.s.aspd>before,'while-shielded speed bonus uses the runtime timed buff');
    const target=m.enemy('augment-dominator',[9,5],1);m.battle.dealDamage(member,target,{amount:2,type:'true',canDodge:false});
    assert.ok(ally.s.shield>=100,'kill grants its source shield to all Dominators');
  }
  {
    const m=makeBattle(apiFor.automata_second_blast,'creation',4,{installPacts:true});
    const [target,second]=[m.enemy('augment-automata-a',[9,5]),m.enemy('augment-automata-b',[9,6])];
    const before=second.hp;
    for(let i=0;i<20;i++)m.battle.dealDamage(m.allies[0],target,{amount:10,type:'phys',canDodge:false});
    assert.ok(second.hp<before,'actual Automata crystal event chains into a nearby second enemy');
  }
  {
    const m=makeBattle(apiFor.sorcerer_death_burst,'arts');const [member]=m.allies;
    const enemy=m.enemy('augment-sorcerer-source',[9,3]),near=m.enemy('augment-sorcerer-near',[8,3]);
    const before=near.hp;m.battle.dealDamage(enemy,member,{amount:member.s.maxHp+1,type:'true',canDodge:false});
    assert.equal(member.alive,false);assert.ok(near.hp<before,'actual allied death blasts adjacent units');
  }
  {
    const m=makeBattle(apiFor.watcher_battle_scars,'watcher');const member=m.allies[0],enemy=m.enemy('augment-watcher',[9,3]);
    const atk=member.s.atk,arts=member.s.artsDealtMul;
    m.battle.dealDamage(enemy,member,{amount:1,type:'phys',isAttack:true,canDodge:false});assert.ok(member.s.atk>atk,'actual enemy attack grows Watcher attack');
    m.battle.dealDamage(enemy,member,{amount:1,type:'arts',isSkill:true,canDodge:false});assert.ok(member.s.artsDealtMul>arts,'actual enemy skill hit grows Watcher arts output');
  }
  {
    const m=makeBattle(apiFor.bruiser_health_strike,'bruiser',1,{selected:false});const target=m.enemy('augment-negative');
    const before=target.hp;m.battle.dealDamage(m.allies[0],target,{amount:1,type:'phys',isAttack:true,canDodge:false});
    assert.equal(before-target.hp,1,'without selecting the strategy, a natural bruiser gets no augment damage');
    assert.equal(m.battle.resonanceMetrics?.prototypeBattleAugments,undefined);
  }
});

test('health strike is independent of enemy max health and scales with holder max health',()=>{
  const measure=(targetHp,holderBonus=0)=>{
    const m=makeBattle(apiFor.bruiser_health_strike,'bruiser'),member=m.allies[0];
    if(holderBonus)m.battle.addBuff(member,{key:'fixture-holder-health',mods:{hpFlat:holderBonus},persist:true});
    const target=m.enemy(`health-strike-${targetHp}-${holderBonus}`,[9,5],targetHp);
    let observed=null;
    m.battle.on('hit',event=>{if(event.source===member&&event.target===target&&event.dmg.isAttack)observed=event.dmg.amount;},{owner:m.battle});
    m.battle.dealDamage(member,target,{amount:1,type:'phys',isAttack:true,canDodge:false});
    assert.equal(m.battle.errorCount,0);
    return {observed,maxHp:member.s.maxHp};
  };
  const normal=measure(10000),largeEnemy=measure(100000),largeHolder=measure(10000,1000);
  assert.equal(largeEnemy.observed,normal.observed,'increasing only enemy health cannot increase this proc');
  assert.ok(Math.abs((largeHolder.observed-normal.observed)-70)<1e-4,'1000 additional holder health adds 70 raw proc damage');
});

test('Shield Bash converts both resistance ratings and its damage uses their source total',()=>{
  const m=makeBattle(apiFor.sentinel_shield_bash,'sentinel'),member=m.allies[0];
  const power=prototypeSeason.heroes.find(hero=>hero.charId===m.operators[0].charId).powerReference;
  const rating=Object.values(member.mem.prototypeRatingBonuses).find(row=>Math.abs(row.armor-Number(power.armor)*.05)<1e-5);
  assert.ok(rating,'armor rating gains five percent');
  assert.ok(Math.abs(rating.magicResist-Number(power.magicResist)*.05)<1e-5,'magic resistance receives the same rating gain');
  const target=m.enemy('source-rating-shield-bash');let proc=null;
  m.battle.on('hit',event=>{if(event.dmg.tags?.includes('prototype-sentinel-shield-bash'))proc=event.dmg.amount;},{owner:m.battle});
  m.battle.dealDamage(member,target,{amount:1,type:'phys',isAttack:true,canDodge:false});
  const expected=(Number(power.armor)+Number(power.magicResist))*1.05*.75;
  assert.ok(Math.abs(proc-expected)<1e-4,`actual proc ${proc} uses rating total ${expected}`);
  assert.equal(m.battle.errorCount,0);
});

test('successful executions grant cumulative ratings only to the executor; ordinary kills do not grant them',()=>{
  const m=makeBattle(apiFor.conqueror_execute,'conqueror',2),[executor,teammate]=m.allies;
  const ratingSum=unit=>Object.values(unit.mem.prototypeRatingBonuses??{}).reduce((total,row)=>total+row.armor,0);
  for(let index=0;index<2;index++){
    const target=m.enemy(`execute-${index}`,[9,5],100);target.hp=10;
    m.battle.dealDamage(executor,target,{amount:1,type:'phys',isAttack:true,canDodge:false});
    assert.equal(target.alive,false);assert.equal(ratingSum(executor),(index+1)*5);assert.equal(ratingSum(teammate),0);
  }
  const ordinary=m.enemy('ordinary-kill',[9,5],100);
  m.battle.dealDamage(executor,ordinary,{amount:200,type:'true',isAttack:true,canDodge:false});
  assert.equal(ordinary.alive,false);assert.equal(ratingSum(executor),10,'a normal lethal hit above the execution threshold gives no bonus');
  assert.equal(m.battle.errorCount,0);
});

test('source battle augment resolves transferred pact membership stored as a Set',()=>{
  const m=makeBattle(apiFor.watcher_battle_scars,'watcher');
  const operator=m.operators[0],nativePacts=operator.pacts;
  operator.pacts=[];
  const member=m.allies[0];member.mem.resonancePacts=new Set(['watcher']);
  try{
    const enemy=m.enemy('augment-watcher-transferred',[9,3]),atk=member.s.atk;
    m.battle.dealDamage(enemy,member,{amount:1,type:'phys',isAttack:true,canDodge:false});
    assert.ok(member.s.atk>atk,'Set-backed emblem transfer activates the selected source augment');
    assert.equal(m.battle.errorCount,0,'trait membership must not throw during real Battle events');
  }finally{operator.pacts=nativePacts;}
});
