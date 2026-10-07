import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle,chessRec,enemyRec } from '../helpers/battleHarness.js';
import { installDarkmoonCombat,DARKMOON_COMBAT_RULES,darkmoonCombatMetadata } from '../../server/sim/content/independent/darkmoonCombat.js';

const tribes={MECHANICAL:'哥伦比亚',PIRATE:'维多利亚',ELEMENTAL:'炎',DRAGON:'卡西米尔',BEAST:'叙拉古'};
function fixture(sourceId,elite=false,extraSources=[]) {
  const r=DARKMOON_COMBAT_RULES[sourceId],faction=tribes[r.faction||r.retire?.faction||r.retire?.fallen||r.retire?.random||r.startStrike||r.aura?.faction]||'叙拉古';
  const definitions={};const pieces=[];const operators={};
  for(const [index,id]of [sourceId,...extraSources,'fixture'].entries()){
    const uid=`p${index}`,chessId=`fixture_${index}_a`,rec=chessRec({id:chessId,name:uid,skill:null,stats:{cost:0,atk:100,maxHp:10000,def:0,bat:10},rangeGrid:[[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]]});
    definitions[chessId]=rec;
    pieces.push({uid,chessId,elite:index===0&&elite,row:10+Math.floor(index/3),col:5+index%3,equipment:[{id:'cover',quantity:1}],attachments:[],nativeState:{}});
    operators[chessId]={chessId,name:uid,tier:index===0?6:2,elite:false,nativeFactionTags:[faction],source:{normalChess:rec},sourceRefs:{darkmoon19_2:{id}}};
  }
  const catalog={operators,config:{maxShopLevel:6},equipment:{cover:{params:{gearId:'oath-cover'}}}};
  let installed;
  const h=makeBattle({defs:{chess:definitions,enemies:{probe:enemyRec({key:'probe',hp:1e8,atk:0,def:0,speed:0})}},units:pieces,content:'none',autoFinish:false,extraContent:[b=>{installed=installDarkmoonCombat(b,{catalog,pieces});}]});
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
