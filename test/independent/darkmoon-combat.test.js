import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { makeBattle,chessRec,enemyRec } from '../helpers/battleHarness.js';
import { installDarkmoonCombat,DARKMOON_COMBAT_RULES,darkmoonCombatMetadata } from '../../server/sim/content/independent/darkmoonCombat.js';

const tribes={MECHANICAL:'哥伦比亚',PIRATE:'维多利亚',ELEMENTAL:'炎',DRAGON:'卡西米尔',BEAST:'叙拉古'};
function fixture(sourceId,elite=false,extraSources=[],state=null) {
  const r=DARKMOON_COMBAT_RULES[sourceId],faction=tribes[r.faction||r.retire?.faction||r.retire?.fallen||r.retire?.random||r.startStrike||r.aura?.faction]||'叙拉古';
  const definitions={};const pieces=[];const operators={};
  for(const [index,id]of [sourceId,...extraSources,'fixture'].entries()){
    const uid=`p${index}`,chessId=`fixture_${index}_a`,rec={...chessRec({id:chessId,name:uid,skill:null,stats:{cost:0,atk:100,maxHp:10000,def:0,bat:10},rangeGrid:[[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]]}),rarity:6};
    definitions[chessId]=rec;
    if(state?.growthMode==='levels'){
      rec.status={phase:0,level:1};
      rec.nativeGrowth={phases:[{maxLevel:10,attributesKeyFrames:[{level:1,data:{atk:100,maxHp:10000,def:0,magicResistance:0}},{level:10,data:{atk:190,maxHp:10090,def:90,magicResistance:9}}]}]};
    }
    pieces.push({uid,chessId,elite:index===0&&elite,row:10+Math.floor(index/3),col:5+index%3,equipment:[{id:'cover',quantity:1}],attachments:[],nativeState:{}});
    operators[chessId]={chessId,name:uid,tier:index===0?6:2,elite:false,nativeFactionTags:[faction],source:{normalChess:rec},sourceRefs:{darkmoon19_2:{id}}};
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
    const extra=r.summonMultiplier?['EX1_556']:r.retireMultiplier?['OG_256']:r.echo?['OG_256']:[];
    const f=fixture(id,elite,extra),{h,b,unit,ally,enemy,installed}=f;
    assert.ok(darkmoonCombatMetadata(id,elite)?.text);
    const before=installed.trace.length;
    if(r.retire?.fallen){b.kill(ally,enemy);h.run(.1);}
    if(r.retire){b.retreat(unit);h.run(.1);}
    else if(r.summonMultiplier){b.retreat(h.unit('p1'));h.run(.1);assert.ok(b.allyUnits.filter(u=>u.kind==='token').length>=(elite?3:2));}
    else if(r.retireMultiplier){const target=h.unit('p1'),base=unit.base.atk;b.retreat(target);h.run(.1);assert.ok(unit.s.atk>base);assert.equal(installed.trace.filter(t=>t.sourceId==='OG_256'&&t.kind==='retire').length,elite?3:2);}
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
    else if(r.event==='death'){b.kill(ally,enemy);}
    else if(r.event==='damaged'){b.dealDamage(enemy,unit,{amount:50,type:'true',isAttack:true});}
    else if(r.event==='shieldLayersBroken'){b.addBuff(ally,{key:'test-shield',shieldHits:5});for(let i=0;i<5;i++)b.dealDamage(enemy,ally,{amount:1,type:'true',isAttack:true});}
    h.run(.1);
    if(!r.aura&&!r.retireMultiplier&&!r.summonMultiplier)assert.ok(installed.trace.length>before||r.startStrike,'actual causal effect must execute');
    if(r.retire?.token||r.retire?.random||r.retire?.fallen||r.summon||r.overkill==='summon')assert.ok(b.allyUnits.some(u=>u.kind==='token'),'actual support unit exists');
    if(r.permanent)assert.ok(installed.results.growth.every(x=>x.targetUid===unit.uid)&&installed.results.growth.length>0);
    if(r.buff&&r.event!=='summon'){
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
test('retirement can trigger after withdrawal, cannot double-fire for one deployment, and is bounded across repeated redeployment',()=>{
  const {h,b,unit,installed}=fixture('OG_256');
  b.retreat(unit);h.run(.1);
  b.emit('death',{unit,reason:'killed'});h.run(.1);
  assert.equal(installed.trace.filter(x=>x.kind==='retire').length,1);
  for(let i=0;i<4;i++){b.redeploy(unit,{free:true});b.retreat(unit);h.run(.1);}
  assert.equal(installed.trace.filter(x=>x.kind==='retire').length,3);
});
test('temporary training from multiple sources follows one native curve and never exceeds its real cap',()=>{
  const {h,b,unit,ally,enemy,installed}=fixture('BGS_047',false,['BGS_047'],{growthMode:'levels'});
  b.forceAttack(ally,[enemy]);
  assert.equal(unit.s.atk,160);assert.equal(unit.s.def,60);assert.equal(unit.s.res,6);
  h.run(3.1);b.forceAttack(ally,[enemy]);
  assert.equal(unit.s.atk,190);assert.equal(unit.s.def,90);assert.equal(unit.s.res,9);
  assert.deepEqual(installed.results.growth,[]);
});
test('random original copies keep the actual native kit, talent and skill activation instead of becoming empty stat bodies',()=>{
  const raw=structuredClone(getData().chess.chess_native_char_235_jesica_a);
  raw.nativeImport.playable=true;
  const source=chessRec({id:'source_shredder_a',skill:null,stats:{cost:0,atk:100,maxHp:10000}});
  const pieces=[{uid:'source',chessId:source.chessId,row:10,col:5,elite:false}];
  const catalog={config:{maxShopLevel:6},equipment:{},operators:{
    [source.chessId]:{chessId:source.chessId,tier:6,source:{normalChess:source},nativeFactionTags:['哥伦比亚'],sourceRefs:{darkmoon19_2:{id:'BGS_023'}}},
    [raw.chessId]:{chessId:raw.chessId,tier:2,source:{normalChess:raw},nativeFactionTags:['哥伦比亚'],sourceRefs:{darkmoon19_2:{id:'BOT_606'}}},
  }};
  const h=makeBattle({defs:{chess:{[source.chessId]:source,[raw.chessId]:raw},enemies:{probe:enemyRec({key:'probe',hp:1e8,atk:0,def:0,speed:0})}},units:pieces,content:'none',autoFinish:false,extraContent:[b=>installDarkmoonCombat(b,{catalog,pieces})]});
  h.run(.2);const enemy=h.spawn('probe',{pos:[10,7]});h.b.retreat(h.unit('source'));h.run(.1);
  const copy=h.b.allyUnits.find(u=>u.kind==='token');assert.ok(copy);
  assert.equal(copy.def.raw.darkmoonNativeChessId,raw.chessId);assert.equal(copy.skill.id,raw.skill.skillId);
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
    assert.equal(macaw.installed.trace.filter(t=>t.kind==='retireEcho').length,elite?2:1);
  }
});
test('advanced shield gift chooses two different allies and advanced bomber really hits twice',()=>{
  const selfless=fixture('OG_221',true,['fixture']);selfless.b.retreat(selfless.unit);selfless.h.run(.1);
  const gifted=selfless.b.allyUnits.filter(u=>u.buffs.some(x=>x.key.startsWith('darkmoon:shield:')));
  assert.equal(gifted.length,2);for(const u of gifted)assert.equal(u.buffs.find(x=>x.key.startsWith('darkmoon:shield:')).shieldHits,5);
  const bomber=fixture('BOT_606',true);bomber.b.kill(bomber.h.enemies()[1],bomber.unit);
  for(const u of bomber.b.allyUnits)u.profile.noAttack=true;
  const hp=bomber.enemy.hp;bomber.b.addBuff(bomber.enemy,{key:'two-layer-probe',shieldHits:2});
  bomber.b.retreat(bomber.unit);bomber.h.run(.1);
  assert.equal(bomber.enemy.hp,hp);assert.equal(bomber.enemy.findBuff('two-layer-probe')?.shieldHits||0,0);
});
