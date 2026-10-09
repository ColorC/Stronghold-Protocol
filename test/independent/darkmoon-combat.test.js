import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getData } from '../../server/data.js';
import { makeBattle,chessRec,enemyRec } from '../helpers/battleHarness.js';
import { installDarkmoonCombat,DARKMOON_COMBAT_RULES,darkmoonCombatMetadata,hasDarkmoonDeploymentPayload } from '../../server/sim/content/independent/darkmoonCombat.js';
import { darkmoonPrepRulesFor } from '../../server/modes/independent/darkmoonPrep.js';
import { darkmoonCombatEligibilityRules } from '../../server/sim/content/independent/darkmoonCombat.js';
import { levelBodyStats } from '../../shared/independentGrowth.js';
import { KEYWORD_GEAR } from '../../server/modes/independent/keywordGear.js';
import { unitInfo } from '../../server/sim/snapshot.js';

const tribes={MECHANICAL:'哥伦比亚',PIRATE:'维多利亚',ELEMENTAL:'炎',DRAGON:'卡西米尔',BEAST:'叙拉古'};
function fixture(sourceId,elite=false,extraSources=[],state=null,attachments=[],eliteSourceIds=[]) {
  const r=DARKMOON_COMBAT_RULES[sourceId],faction=tribes[r.faction||r.retire?.faction||r.retire?.fallen||r.retire?.random||r.startStrike||r.aura?.faction]||'叙拉古';
  const definitions={};const pieces=[];const operators={};
  for(const [index,id]of [sourceId,...extraSources,'fixture'].entries()){
    const uid=`p${index}`,chessId=`fixture_${index}_a`,rec={...chessRec({id:chessId,name:uid,skill:null,stats:{cost:0,atk:100,maxHp:10000,def:0,bat:10},rangeGrid:[[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]]}),rarity:6};
    const eliteRec={...rec,chessId:`fixture_${index}_b`,name:`${uid}精锐`,stats:{...rec.stats,atk:150}};
    definitions[chessId]=rec;
    definitions[eliteRec.chessId]=eliteRec;
    if(state?.growthMode==='levels'){
      rec.status={phase:0,level:1};
      rec.nativeGrowth={phases:[{maxLevel:10,attributesKeyFrames:[{level:1,data:{atk:100,maxHp:10000,def:0,magicResistance:0}},{level:10,data:{atk:190,maxHp:10090,def:90,magicResistance:9}}]}]};
    }
    const isElite=(index===0&&elite)||eliteSourceIds.includes(id);
    pieces.push({uid,chessId,elite:isElite,row:10+Math.floor(index/3),col:5+index%3,equipment:[{id:'cover',quantity:1}],attachments:index===0?attachments:[],nativeState:{}});
    operators[chessId]={chessId,name:uid,tier:index===0?6:index===1?2:1,elite:isElite,eliteChessId:eliteRec.chessId,nativeFactionTags:[faction],source:{normalChess:rec,eliteChess:eliteRec},sourceRefs:{darkmoon19_2:{id}}};
  }
  const catalog={operators,config:{maxShopLevel:6},equipment:{cover:{params:{gearId:'oath-cover'}}}};
  let installed;
  const h=makeBattle({defs:{chess:definitions,enemies:{probe:enemyRec({key:'probe',hp:1e8,atk:0,def:0,speed:0})}},units:pieces,content:'none',autoFinish:false,extraContent:[b=>{installed=installDarkmoonCombat(b,{catalog,pieces,state});}]});
  h.run(.2);
  h.spawn('probe',{pos:[10,7]});h.spawn('probe',{pos:[11,7]});
  return {h,b:h.b,unit:h.unit('p0'),ally:h.unit(`p${pieces.length-1}`),enemy:h.enemies()[0],installed,catalog,pieces};
}

for(const elite of [false,true])for(const [id,r]of Object.entries(DARKMOON_COMBAT_RULES)){
  test(`${id} executes its combat adaptation (${elite?'advanced':'ordinary'})`,()=>{
    const extra=r.summonMultiplier?['EX1_556']:r.retireMultiplier?['OG_256']:r.echo?['OG_256']:r.retire?.random==='deathrattle'?['BGS_061']:[];
    const f=fixture(id,elite,extra),{h,b,unit,ally,enemy,installed}=f;
    assert.ok(darkmoonCombatMetadata(id,elite)?.text);
    const before=installed.trace.length;
    if(r.retire&&id!=='BGS_008')assert.ok(installed.trace.some(t=>t.sourceId===id&&['deploy','deployQueued'].includes(t.kind)),'opening deployment is resolved or queued');
    if(r.retire&&id==='BGS_008'){b.retreat(unit);h.run(.1);assert.equal(installed.trace.filter(t=>t.sourceId===id&&t.kind==='retire').length,0,'retreat does not count as knockout');b.kill(unit,enemy);h.run(.1);}
    else if(r.retire?.fallen){b.kill(ally,enemy);b.redeploy(unit,{free:true});h.run(.1);}
    else if(r.summonMultiplier){b.retreat(h.unit('p1'));h.run(.1);assert.ok(b.allyUnits.filter(u=>u.kind==='token').length>=(elite?3:2));}
    else if(r.retireMultiplier){const target=h.unit('p1'),base=unit.base.atk;b.retreat(target);b.redeploy(target,{free:true});h.run(.1);assert.ok(unit.s.atk>base);assert.equal(installed.trace.filter(t=>t.sourceId==='OG_256'&&t.kind==='deploy').length,2*(elite?3:2));}
    else if(r.aura){h.run(.3);assert.ok(ally.s.atk>ally.base.atk);b.retreat(unit);h.run(.6);assert.equal(ally.s.atk,ally.base.atk);}
    else if(r.intercept){const ctx={attacker:enemy,targets:[ally],profile:{}};enemy.x=unit.x+.1;enemy.y=unit.y;b.emit('beforeAttack',ctx);assert.equal(ctx.targets[0],unit);}
    else if(r.counterattack){b.emit('attack',{attacker:enemy,targets:[unit],isSkill:false});h.run(.1);assert.ok(unit.stats.attacks>0);}
    else if(r.overkill||r.recruitOnKill){enemy.hp=1;b.dealDamage(unit,enemy,{amount:1000,type:'phys',isAttack:true});}
    else if(r.startStrike){assert.ok(installed.trace.some(t=>t.kind==='startStrike'));}
    else if(r.echo||r.windfury){b.forceAttack(unit,[enemy]);}
    else if(r.event==='summon'){b.spawnToken(ally,'token_10028_vigil_wolf',11,6,{anySource:true});}
    else if(r.event==='attacked'){b.emit('beforeAttack',{attacker:enemy,targets:[r.selfOnly?unit:ally],profile:{}});}
    else if(r.event==='attack'){b.forceAttack(r.selfOnly?unit:ally,[enemy]);}
    else if(r.event==='kill'){b.dealDamage(ally,enemy,{amount:1e9,type:'true',isAttack:true});}
    else if(r.event==='death'){assert.ok(installed.trace.some(t=>t.sourceId===id&&t.kind==='event'),'real initial deployment is the ally event');}
    else if(r.event==='damaged'){b.dealDamage(enemy,unit,{amount:50,type:'true',isAttack:true});}
    else if(r.event==='shieldLayersBroken'){b.addBuff(ally,{key:'test-shield',shieldHits:5});for(let i=0;i<5;i++)b.dealDamage(enemy,ally,{amount:1,type:'true',isAttack:true});}
    h.run(.1);
    if(!r.aura&&!r.retire&&!r.retireMultiplier&&!r.summonMultiplier&&r.event!=='death')assert.ok(installed.trace.length>before||r.startStrike,'actual causal effect must execute');
    if(r.retire?.token||r.retire?.random||r.retire?.fallen||r.summon||r.overkill==='summon')assert.ok(b.allyUnits.some(u=>u.kind==='token'),'actual support unit exists');
    if(r.permanent)assert.ok(installed.results.growth.every(x=>x.targetUid===unit.uid)&&installed.results.growth.length>0);
    if(r.buff&&r.event!=='summon'&&r.event!=='death'){
      const receivers=r.target==='self'?[unit]:r.target==='actor'?[r.selfOnly?unit:ally]:r.target==='all'?[unit,ally]:[r.target==='adjacentActor'?unit:ally];
      for(const target of receivers)assert.ok(Math.abs(target.s.atk-target.base.atk*(1+r.buff[0]*(elite?2:1)*.02))<1e-6,'ordinary/advanced attack equipment quantity follows source magnitude');
    }
    if(r.recruitOnKill||r.retire?.handCopy)assert.ok(installed.results.recruits.length>0,'real hand recruit, not equipment');
    if(r.retire?.coin)assert.equal(installed.results.coins[0]?.quantity,elite?2:1);
    assert.equal(b.errorCount,0,JSON.stringify(b.errors));
    h.invariants();
  });
}

test('combat ramps and shields do not become persistent badge rewards or transferable inventory',()=>{
  const {b,unit,ally,enemy,installed}=fixture('BGS_047');
  const before=ally.s.atk;b.forceAttack(ally,[enemy]);
  assert.ok(ally.s.atk>before);
  assert.deepEqual(installed.results.growth,[]);
  assert.equal(b.independentRewards,undefined);
  assert.ok(Object.values(unit.mem.darkmoonTemporaryEquipment||{}).every(x=>x.expires==='battleEnd'));
});
test('temporary A/H combat growth records and applies the fixed damage badge ID',()=>{
  const {b,unit,ally,enemy}=fixture('BGS_047');
  b.forceAttack(ally,[enemy]);
  const record=Object.values(unit.mem.darkmoonTemporaryEquipment||{})[0];
  assert.deepEqual(record.badgeIds,['precision','damage']);
  assert.equal(unit.findBuff(Object.keys(unit.mem.darkmoonTemporaryEquipment)[0]).mods.dmgDealtMul,1.02);
});
test('combat faction requirements reject an unrelated owner and unrelated native faction',()=>{
  const {b,unit,ally,enemy,installed}=fixture('BGS_047');
  ally.ownerId='different';b.forceAttack(ally,[enemy]);assert.equal(installed.trace.length,0);
  ally.ownerId=unit.ownerId;ally.mem.darkmoonFactionTags=['哥伦比亚'];b.forceAttack(ally,[enemy]);assert.equal(installed.trace.length,0);
});
test('shield growth needs five broken layers, shares the native shield concept, and cannot recurse',()=>{
  const {b,unit,ally,enemy,installed}=fixture('BGS_067');
  b.addBuff(ally,{key:'mudrock-shield',shieldHits:5});
  for(let i=0;i<4;i++)b.dealDamage(enemy,ally,{amount:1,type:'true',isAttack:true});
  assert.equal(installed.trace.length,0);
  b.dealDamage(enemy,ally,{amount:1,type:'true',isAttack:true});
  assert.equal(installed.trace.length,1);assert.ok(unit.s.atk>unit.base.atk);
});
test('Khadgar doubles actual native summons without doubling their equipment, and uses the strongest multiplier only',()=>{
  const {b,unit}=fixture('DAL_575',false,['DAL_575']);
  const before=b.allyUnits.filter(u=>u.kind==='token').length;
  b.spawnToken(unit,'token_10028_vigil_wolf',11,6,{anySource:true});
  assert.equal(b.allyUnits.filter(u=>u.kind==='token').length-before,2);
  assert.equal(b.independentRewards,undefined);
});
test('deployment payload never triggers on withdrawal and is bounded across actual redeployments',()=>{
  const {h,b,unit,installed}=fixture('OG_256');
  b.retreat(unit);h.run(.1);
  assert.equal(installed.trace.filter(x=>x.kind==='deploy').length,1,'opening deployment pays once');
  assert.equal(installed.trace.filter(x=>x.kind==='retire').length,0,'withdrawal is not a trigger');
  for(let i=0;i<4;i++){b.redeploy(unit,{free:true});b.retreat(unit);h.run(.1);}
  assert.equal(installed.trace.filter(x=>x.kind==='deploy').length,3,'actual deployment payload is capped at three');
});
test('temporary training from multiple sources follows one native curve and never exceeds its real cap',()=>{
  const {h,b,unit,ally,enemy,installed}=fixture('BGS_047',false,['BGS_047'],{growthMode:'levels'});
  b.forceAttack(ally,[enemy]);
  assert.equal(unit.s.atk,160);assert.equal(unit.s.def,60);assert.equal(unit.s.res,6);
  h.run(3.1);b.forceAttack(ally,[enemy]);
  assert.equal(unit.s.atk,190);assert.equal(unit.s.def,90);assert.equal(unit.s.res,9);
  assert.deepEqual(installed.results.growth,[]);
  const temp=Object.values(unit.mem.darkmoonTemporaryEquipment||{}).find(x=>x.sourceId==='BGS_047');
  assert.ok(temp?.temporaryTrainingLevels>0);assert.equal('badgeIds'in temp,false);assert.equal('attackUnits'in temp,false);assert.equal('secondaryUnits'in temp,false);
});
test('BGS021 trains a deployed wolf on its native token curve and frozen summoner level context',()=>{
  const state={growthMode:'levels'};
  const {b,ally}=fixture('BGS_021',false,[],state);
  const curve={phases:[{maxLevel:10,attributesKeyFrames:[
    {level:1,data:{atk:80,maxHp:800,def:50,magicResistance:0}},
    {level:10,data:{atk:170,maxHp:1700,def:140,magicResistance:18}},
  ]}]};
  const wolf=b.spawnToken(ally,'token_growth_wolf',11,6,{
    anySource:true,ownerGrowth:{phase:0,level:3},
    def:{name:'原生狼群',stats:{atk:100,maxHp:1000,def:70,res:4,aspd:100,bat:1,blockCnt:1},nativeGrowth:curve},
  });
  assert.ok(wolf);
  assert.equal(wolf.base.atk,100);
  assert.equal(wolf.nativeOwnerGrowth.level,3);
  assert.ok(wolf.s.atk>wolf.base.atk,'deployment growth is applied to the summoned unit');
  const buff=wolf.findBuff('darkmoon:native-level-growth');
  assert.equal(buff.mods.atkFlat,70,'4+4 levels are clamped from owner level 3 to the token maximum 10');
  assert.equal(buff.mods.hpFlat,700);
  assert.equal(buff.mods.defFlat,70);
  assert.equal(buff.mods.resFlat,14);
  assert.equal(wolf.nativeOwnerGrowth.level,3,'temporary training does not mutate the frozen summoner context');
  assert.deepEqual(wolf.mem.darkmoonTemporaryEquipment[Object.keys(wolf.mem.darkmoonTemporaryEquipment)[0]],{
    sourceId:'BGS_021',temporaryTrainingLevels:8,expires:'battleEnd',
  });
  assert.equal(b.errorCount,0,JSON.stringify(b.errors));
});
for(const growthMode of ['badges','levels'])test(`random original copies keep the native kit and pristine ${growthMode} body`,()=>{
  const raw=structuredClone(getData().chess.chess_native_char_235_jesica_a);
  raw.nativeImport.playable=true;
  const source=chessRec({id:'source_shredder_a',skill:null,stats:{cost:0,atk:100,maxHp:10000}});
  const pieces=[{uid:'source',chessId:source.chessId,row:10,col:5,elite:false}];
  const catalog={config:{maxShopLevel:6},equipment:{},operators:{
    [source.chessId]:{chessId:source.chessId,tier:6,source:{normalChess:source},nativeFactionTags:['哥伦比亚'],sourceRefs:{darkmoon19_2:{id:'BGS_023'}}},
    [raw.chessId]:{chessId:raw.chessId,tier:2,source:{normalChess:raw},nativeFactionTags:['哥伦比亚'],sourceRefs:{darkmoon19_2:{id:'BOT_606'}}},
  }};
  const h=makeBattle({defs:{chess:{[source.chessId]:source,[raw.chessId]:raw},enemies:{probe:enemyRec({key:'probe',hp:1e8,atk:0,def:0,speed:0})}},units:pieces,content:'none',autoFinish:false,extraContent:[b=>installDarkmoonCombat(b,{catalog,pieces,state:{growthMode}})]});
  h.run(.2);const enemy=h.spawn('probe',{pos:[10,7]});h.b.retreat(h.unit('source'));h.run(.1);
  const copy=h.b.allyUnits.find(u=>u.kind==='token');assert.ok(copy);
  assert.equal(copy.def.raw.darkmoonNativeChessId,raw.chessId);assert.equal(copy.skill.id,raw.skill.skillId);
  assert.equal(copy.base.atk,levelBodyStats({chessId:raw.chessId,growthMode,growthLevel:1,skillIndex:raw.skill?.index??0,moduleId:'none'},catalog,raw).atk,'pristine copies do not inherit preset max-level stats in training mode');
  assert.ok(copy.s.aspd>copy.base.aspd,'the original native talent remains installed');
  for(let i=0;i<12;i++){h.b.forceAttack(copy,[enemy]);h.run(.3);}
  assert.ok(copy.skill.activations>0,JSON.stringify({reason:'the native attack-recovery skill must activate',position:[copy.x,copy.y],sp:copy.skill.sp,cost:copy.skill.spCost,kind:copy.skill.kind,attacks:copy.stats.attacks,skill:copy.def.skill}));
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
  h.invariants();
});
test('advanced source effects preserve recipients, repeats and token counts rather than uniformly doubling everything',()=>{
  for(const elite of [false,true]){
    const rover=fixture('BOT_218',elite);
    rover.b.dealDamage(rover.enemy,rover.unit,{amount:50,type:'true',isAttack:true});
    const summons=rover.b.allyUnits.filter(u=>u.kind==='token');
    assert.equal(summons.length,1);assert.equal(summons[0].base.atk,elite?480:240);
    const nadina=fixture('BGS_040',elite);nadina.b.retreat(nadina.unit);nadina.h.run(.1);
    assert.equal(nadina.ally.buffs.filter(x=>x.key.startsWith('darkmoon:shield:')).reduce((n,x)=>n+(x.shieldHits||0),0),5);
    const ripper=fixture('BGS_060',elite),before=ripper.unit.stats.attacks;
    ripper.b.emit('attack',{attacker:ripper.enemy,targets:[ripper.unit]});ripper.h.run(.1);
    assert.equal(ripper.unit.stats.attacks-before,1);
    const macaw=fixture('BGS_078',elite,['OG_256']);macaw.b.forceAttack(macaw.unit,[macaw.enemy]);
    assert.equal(macaw.installed.trace.filter(t=>t.kind==='deployEcho'&&t.sourceId==='BGS_078').length,elite?2:1);
  }
});
test('advanced shield gift chooses two different allies and advanced bomber really hits twice',()=>{
  const selfless=fixture('OG_221',true,['fixture']);selfless.b.retreat(selfless.unit);selfless.h.run(.1);
  const gifted=selfless.b.allyUnits.filter(u=>u.buffs.some(x=>x.key.startsWith('darkmoon:shield:')));
  assert.equal(gifted.length,2);for(const u of gifted)assert.equal(u.buffs.find(x=>x.key.startsWith('darkmoon:shield:')).shieldHits,5);
  const bomber=fixture('BOT_606',true);bomber.b.kill(bomber.h.enemies()[1],bomber.unit);
  for(const u of bomber.b.allyUnits)u.profile.noAttack=true;
  const hp=bomber.enemy.hp;bomber.b.addBuff(bomber.enemy,{key:'two-layer-probe',shieldHits:2});
  bomber.b.emit('attack',{attacker:bomber.unit,targets:[bomber.enemy]});bomber.h.run(.1);
  assert.equal(bomber.enemy.hp,hp);assert.equal(bomber.enemy.findBuff('two-layer-probe')?.shieldHits||0,0);
});
test('magnetic modules retain their own source quality and stack distinct retirement effects on the recipient',()=>{
  const attachments=[{id:'darkmoon-magnetic',state:{sourceId:'BOT_312',elite:false}},{id:'darkmoon-magnetic',state:{sourceId:'BOT_312',elite:true}}];
  const {h,b,unit,ally,installed}=fixture('BGS_045',false,[],null,attachments);
  assert.equal(b.relocate(ally,12,2),true);
  b.retreat(unit);h.run(.1);
  const tokens=b.allyUnits.filter(u=>u.kind==='token');
  assert.ok(tokens.length<=6&&tokens.length>=5);assert.equal(tokens.filter(u=>u.base.atk===120).length,3);assert.ok(tokens.filter(u=>u.base.atk===240).length>=2);
  assert.equal(installed.trace.filter(t=>t.kind==='deploy'&&t.sourceId==='BOT_312').length,2);
  assert.deepEqual(unit.mem.darkmoonDeploymentSources,['BOT_312']);
  assert.deepEqual(unitInfo(unit).darkmoonDeploymentSources,['BOT_312'],'snapshot exposes the installed attachment payload source');
  assert.equal(b.errorCount,0,JSON.stringify(b.errors));
});

test('snapshot deployment eligibility is derived from installed payloads and excludes KO-only and original phantom units',()=>{
  const f=fixture('BGS_078',false,['OG_256','BGS_008']);
  const payload=f.h.unit('p1'),ko=f.h.unit('p2');
  assert.deepEqual(unitInfo(payload).darkmoonDeploymentSources,['OG_256']);
  assert.equal(unitInfo(ko).darkmoonDeploymentSources,undefined,'裁度 has knockout-only payload');
  const m=fixture('BGS_012',false,['OG_256']);
  const phantom=m.b.allyUnits.find(u=>u.kind==='token'&&u.def.id==='token_10030_mlyss_wtrman');
  assert.ok(phantom);assert.equal(unitInfo(phantom).darkmoonDeploymentSources,undefined,'original Muelsyse phantom does not install workshop deployment payloads');
});

test('Muelsyse copies top-attack Columbian operators, including itself, without recursive workshop payloads',()=>{
  const f=fixture('BGS_012',false,['BGS_061']);
  const copies=f.b.allyUnits.filter(u=>u.kind==='token'&&u.def.id==='token_10030_mlyss_wtrman');
  assert.equal(copies.length,2);
  assert.ok(copies.every(u=>!f.installed.entries.some(e=>e.unit===u)),'phantoms do not recursively receive workshop payloads');
  assert.deepEqual(copies.map(u=>u.base.atk).sort((a,b)=>a-b),[100,100]);
  assert.ok(copies.some(u=>(u.def.darkmoonNativeChessId||u.def.raw?.darkmoonNativeChessId)==='fixture_0_a'),'the source operator can copy its own original phantom');
  assert.equal(f.b.errorCount,0,JSON.stringify(f.b.errors));
  const advanced=fixture('BGS_012',true,['BGS_061','OG_256'],null,[],['BGS_061']);
  const advancedCopies=advanced.b.allyUnits.filter(u=>u.kind==='token'&&u.def.id==='token_10030_mlyss_wtrman');
  assert.equal(advancedCopies.length,3,'four requested copies respect actual eligible target count');
  assert.deepEqual(advancedCopies.map(u=>u.base.atk).sort((a,b)=>a-b),[100,150,150]);
  assert.equal(advancedCopies.filter(u=>u.base.atk===150).length,2,'elite targets use their elite original stats while ordinary targets keep ordinary stats');
  const ranked=fixture('BGS_012',false,['BGS_061']);
  const [source,best,other]=ranked.b.allyUnits.filter(u=>u.kind==='op');
  best.base.atk=500;best.markDirty();
  const before=ranked.b.allyUnits.filter(u=>u.kind==='token'&&u.def.id==='token_10030_mlyss_wtrman').length;
  ranked.b.retreat(source);ranked.b.redeploy(source,{free:true});ranked.h.run(.1);
  const selected=ranked.b.allyUnits.filter(u=>u.kind==='token'&&u.def.id==='token_10030_mlyss_wtrman').slice(before);
  assert.equal(selected.length,1,'the battlefield summon cap limits this placement to one available slot');
  const ids=selected.map(u=>u.def.darkmoonNativeChessId||u.def.raw?.darkmoonNativeChessId).sort();
  assert.deepEqual(ids,['fixture_1_a'],'highest current attack wins; lower targets are excluded while battlefield slot cap is respected');
  assert.ok(other.alive);
});

test('medical deployment payloads resolve with zero allied deaths',()=>{
  const rose=fixture('BGS_061');
  assert.ok(rose.installed.trace.some(t=>t.sourceId==='BGS_061'&&t.kind==='deploy'));
  assert.equal(rose.h.hooksOf('death').length,0);
  const warfarin=fixture('OG_256');
  assert.ok(warfarin.installed.trace.some(t=>t.sourceId==='OG_256'&&t.kind==='deploy'));
  assert.equal(warfarin.h.hooksOf('death').length,0);
  const attachments=[{id:'darkmoon-magnetic',state:{sourceId:'BOT_312',elite:false}}];
  const hemo=fixture('BGS_045',false,[],null,attachments);
  assert.ok(hemo.installed.trace.some(t=>t.sourceId==='BOT_312'&&t.kind==='deploy'));
  assert.equal(hemo.h.hooksOf('death').length,0);
});

test('opening deployment amplifiers apply independently of operator placement order',()=>{
  for(const f of [fixture('FP1_031',false,['OG_256']),fixture('OG_256',false,['FP1_031'])]){
    assert.equal(f.installed.trace.filter(t=>t.sourceId==='OG_256'&&t.kind==='deploy').length,2);
    assert.equal(f.h.hooksOf('death').length,0);
  }
});

test('queued deployment damage hits live enemies once the next normal attack is made',()=>{
  const traces=[];
  for(const [elite,extras,expectedHits] of [[false,[],1],[true,[],2],[false,['FP1_031'],2]]){
    const f=fixture('BOT_606',elite,extras),enemies=f.b.enemies.filter(u=>u.alive),before=enemies.reduce((n,u)=>n+u.hp,0);
    for(let i=0;i<expectedHits;i++)f.b.forceAttack(f.unit,[f.enemy]);
    f.h.run(.1);
    const after=enemies.reduce((n,u)=>n+u.hp,0);
    assert.ok(after<before,`${elite?'elite':'ordinary'} deployment damage reaches an enemy`);
    assert.equal(f.installed.trace.filter(t=>t.sourceId==='BOT_606'&&t.kind==='deployQueued').length,1);
    traces.push({elite,amplified:extras.includes('FP1_031'),beforeEnemyHp:before,afterEnemyHp:after,deploySeq:f.unit.deploySeq,payloadTraces:f.installed.trace.filter(t=>t.sourceId==='BOT_606').map(({sourceId,sourceUid,kind,time,targets})=>({sourceId,sourceUid,kind,time,targets}))});
    assert.equal(f.b.errorCount,0,JSON.stringify(f.b.errors));
  }
  if(process.env.SP_DARKMOON_BATTLE_TRACE_PATH)fs.writeFileSync(process.env.SP_DARKMOON_BATTLE_TRACE_PATH,JSON.stringify({scenario:'combat deployment damage queued until actual normal attack',traces},null,2)+'\n');
});

test('current source set contains twenty deployment payloads, with strict KO-only裁度 and one gain grant',()=>{
  assert.equal(Object.keys(DARKMOON_COMBAT_RULES).filter(hasDarkmoonDeploymentPayload).length,20);
  assert.equal(hasDarkmoonDeploymentPayload('BGS_008'),false);
  assert.deepEqual(darkmoonPrepRulesFor({darkmoonSourceId:'BGS_008'}),[{trigger:'gain',behavior:'grantEquipment',params:{landOn:'self',outputs:[{id:'independent:突袭盟约',normal:1,elite:1}]}}]);
});

test('Javi echo repeats a living deployment payload without killing or recursively echoing its source',()=>{
  const f=fixture('BGS_078',false,['OG_256']);
  const candidate=f.h.unit('p1');f.b.forceAttack(f.unit,[f.enemy]);
  assert.equal(candidate.alive,true);
  assert.equal(f.installed.trace.filter(t=>t.kind==='deployEcho'&&t.sourceId==='BGS_078').length,1);
  assert.equal(f.installed.trace.filter(t=>t.kind==='death').length,0);
  assert.equal(f.b.errorCount,0,JSON.stringify(f.b.errors));
});

test('summoned original deployment entries initialize deploySeq caps after the deploy event',()=>{
  const f=fixture('BGS_023',false,['BGS_061']);
  const tokenEntries=f.installed.entries.filter(e=>e.unit.kind==='token'&&e.id==='BGS_061'&&e.rule.retire);
  assert.ok(tokenEntries.length>0,JSON.stringify({entries:f.installed.entries.map(e=>({id:e.id,unit:e.unit.uid,kind:e.unit.kind})),trace:f.installed.trace,tokens:f.b.allyUnits.filter(u=>u.kind==='token').map(u=>({id:u.id,def:u.def,raw:u.def.raw}))}));
  assert.ok(tokenEntries.every(e=>e.deploySeqs instanceof Set&&e.deployUses===1),'the first summon deployment is applied once and recorded');
  assert.ok(f.b.allyUnits.filter(u=>u.kind==='token'&&u.alive).some(u=>u.mem.darkmoonDeploymentSources?.includes('BGS_061')),'summoned actors expose only deployment payloads actually installed after spawn');
  assert.ok(f.b.allyUnits.filter(u=>u.kind==='token'&&u.alive).length<=7,'recursive copies keep the original allied token cap');
  assert.ok(tokenEntries.every(e=>e.deployUses<=3));
});

test('summoned cover metadata is visible before its deploy actor event for BGS112',()=>{
  const f=fixture('BGS_112',false,['BOT_218']),source=f.h.unit('p1');
  const deployedTokens=[];f.b.on('darkmoonDeployActor',event=>{if(event.actor.kind==='token')deployedTokens.push({cover:event.actor.def.raw?.darkmoonCover,tags:event.factions});});
  f.h.run(3.1);
  const before=f.installed.trace.filter(t=>t.sourceId==='BGS_112'&&t.kind==='event').length;
  f.b.dealDamage(f.enemy,source,{amount:50,type:'true',isAttack:true});
  const token=f.b.allyUnits.find(u=>u.kind==='token'&&u.def.raw?.darkmoonCover);
  assert.ok(token,JSON.stringify({tokens:f.b.allyUnits.filter(u=>u.kind==='token').map(u=>({kind:u.kind,cover:u.def.darkmoonCover,memCover:u.mem.darkmoonCover,rawCover:u.def.raw?.darkmoonCover})),trace:f.installed.trace}));
  assert.ok(deployedTokens.some(x=>x.cover&&x.tags.includes('哥伦比亚')),'the actor event exposes its cover and faction metadata before observers run');
  assert.ok(f.installed.trace.filter(t=>t.sourceId==='BGS_112'&&t.kind==='event').length>before,'BGS112 observes the covered summon during deployment');
  const condition=darkmoonCombatEligibilityRules('BGS_112')[0].params;
  assert.deepEqual(condition.actorKinds,['op','token']);
  assert.deepEqual(condition.match,{keywordGear:'坚守盟约'});
});
