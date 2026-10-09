import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment, recordProduction } from '../../server/modes/independent/equipment.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { DataSource } from '../../server/sim/simdata.js';
import { nativeBodyStats, nativeRecord, tavernFactions } from '../../shared/independentRules.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

// Historical pure mechanism assertions retain their authored native Git version.
import {preWarbandCatalog} from './helpers/preWarband.js';
const data=getData(), catalog=preWarbandCatalog(data);
const active=catalog.config.activeRosterIds.map(id=>catalog.operators[id]);
const op=(name,elite=false)=>{const n=active.find(o=>o.name===name);assert.ok(n,`active ${name}`);return elite?catalog.operators[n.eliteChessId]:n;};
const piece=(name,uid='w',elite=false,row=10,col=3,extra={})=>({uid,chessId:op(name,elite).chessId,elite,row,col,dir:'RIGHT',moduleId:'none',skillIndex:0,equipment:[],attachments:[],nativeState:{},...extra});
const fromOp=(o,uid,row=10,col=4,extra={})=>({uid,chessId:o.chessId,elite:!!o.elite,row,col,dir:'RIGHT',moduleId:'none',skillIndex:0,equipment:[],attachments:[],nativeState:{},...extra});
const approx=(actual,wanted,label)=>assert.ok(Math.abs(actual-wanted)<1e-6,`${label}: ${actual} ≈ ${wanted}`);
const sum=(p,id)=>(p.equipment||[]).filter(e=>e.id===id).reduce((s,e)=>s+e.quantity,0);
function stateFor(pieces){return {round:1,revision:0,nextUid:100,shop:{level:6,slots:[],freeRefreshes:0},pieces,inventory:[],production:[],playerEffects:[],pendingFunds:0};}
const services={catalog,data,rng:()=>0.25,grantEquipment:(s,id,n,e)=>grantEquipment(s,catalog,id,n,e),recordProduction,grantChess(){},addOffer(){},record(){}};
function battle(pieces,{content='none',state=stateFor(pieces)}={}){
  const source=new DataSource({enemies:{revision_probe:enemyRec({key:'revision_probe',hp:1e9,atk:0,speed:0,def:0,res:0})}},new DataSource(data));
  const h=makeBattle({data:source,content,units:pieces.map(p=>({...p,kind:'chess'})),autoFinish:false,timeLimit:300,
    flags:{independent:{catalog,pieces}},extraContent:[b=>installIndependentBattle(b,{catalog,state})]});
  h.step(1);assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
  return h;
}
const conditions={
  红豆:{match:{baseStat:'atk',minBaseStatRatioToSelf:1.2},countBy:'operators',stats:{attackPercent:0.15}},
  艾丝黛尔:{match:{faction:'萨尔贡'},countBy:'operators',stats:{maxHpPercent:0.08}},
  深靛:{match:{professions:['CASTER','SUPPORT']},countBy:'professions',stats:{attackSpeedFlat:8}},
  拉普兰德:{match:{faction:'叙拉古'},countBy:'operators',stats:{attackSpeedFlat:8}},
  休谟斯:{match:{keywordGear:'坚守盟约'},countBy:'operators',stats:{attackPercent:0.1}},
  能天使:{match:{profession:'TANK',baseStat:'def',minBaseStatRatioToSelf:2},countBy:'operators',stats:{attackPercent:0.12}},
  斯卡蒂:{match:{faction:'深海猎人'},countBy:'operators',stats:{attackPercent:0.1,maxHpPercent:0.1}},
  百炼嘉维尔:{match:{faction:'罗德岛'},countBy:'professions',stats:{defensePercent:0.08,attackSpeedFlat:5}},
  空弦:{match:{keywordGear:'护盾发生器'},countBy:'operators',stats:{attackSpeedFlat:10}},
  银灰:{match:{faction:'谢拉格'},countBy:'professions',stats:{attackPercent:0.12}},
};
const forgeCases={号角:['profession:TANK',2,false],乌尔比安:['faction:深海猎人',3,false],荒芜拉普兰德:['faction:叙拉古',3,false],玛恩纳:['all',2,true],迷迭香:['row',3,true],佩佩:['adjacent',2,true]};
test('canonical active roster has 101 ordinary/elite pairs and no blank authored traits',()=>{
  assert.equal(active.length,101);
  assert.equal(new Set(active.map(o=>o.chessId)).size,101);assert.equal(new Set(active.map(o=>o.name)).size,101);
  for(const normal of active)for(const o of [normal,catalog.operators[normal.eliteChessId]]){
    assert.ok(o,normal.name);const e=o.nativeTrait.effect;
    assert.ok(e.prep.length+e.combat.length>0,`${o.name} ${o.elite?'elite':'normal'} blank`);
  }
  for(const [name,[target,count,exclude]] of Object.entries(forgeCases))for(const elite of [false,true]){
    const r=op(name,elite).nativeTrait.effect.prep.find(r=>r.behavior==='teamForge');
    assert.ok(r,`${name} teamForge`);assert.equal(r.params.targets,target);assert.equal(r.params.count,count);assert.equal(r.params.excludeSelf,exclude);
  }
});
for(const [name,expected] of Object.entries(conditions))for(const elite of [false,true])test(`${name} ${elite?'elite':'normal'} canonical condition gives temporary stats then removes them`,()=>{
  const source=piece(name,'w',elite),r=op(name,elite).nativeTrait.effect.combat.find(r=>r.behavior==='allyConditionStats');
  assert.ok(r,`${name} has condition`);
  assert.deepEqual(r.params,{...expected,stats:Object.fromEntries(Object.entries(expected.stats).map(([k,v])=>[k,v*(elite?2:1)]))});
  const m=r.params.match,sourceStats=nativeBodyStats(source,catalog);
  const candidate=Object.values(catalog.operators).find(o=>o.chessId!==source.chessId && (!m.profession||nativeRecord({chessId:o.chessId},catalog)?.profession===m.profession)
    && (!m.professions||m.professions.includes(nativeRecord({chessId:o.chessId},catalog)?.profession))
    && (!m.faction||tavernFactions({chessId:o.chessId},catalog).includes(m.faction))
    && (!m.baseStat||nativeBodyStats({chessId:o.chessId,moduleId:'none'},catalog)[m.baseStat]>=sourceStats[m.baseStat]*(m.minBaseStatRatioToSelf||0)));
  assert.ok(candidate,`${name}: real satisfying ally exists`);
  const ally=fromOp(candidate,'ally');
  if(m.keywordGear){const gear=Object.values(catalog.equipment).find(d=>d.mechanism==='keywordGear'&&d.name===m.keywordGear);assert.ok(gear);ally.equipment=[{id:gear.id,quantity:1,state:{}}];}
  const pieces=[source,ally],state=stateFor(pieces),before=JSON.stringify(state),h=battle(pieces,{state}),u=h.unit('w');
  const key=`independent:trait:w:${op(name,elite).nativeTrait.effect.combat.indexOf(r)}`;
  assert.ok(u.findBuff(key),`${name} condition active`);
  const withStats={atk:u.s.atk,def:u.s.def,maxHp:u.s.maxHp,aspd:u.s.aspd};
  h.b.retreat(h.unit('ally'));assert.equal(u.findBuff(key),null);
  for(const [stat,value]of Object.entries(r.params.stats)){
    const field={attackPercent:'atk',defensePercent:'def',maxHpPercent:'maxHp',attackSpeedFlat:'aspd'}[stat];
    approx(withStats[field],stat==='attackSpeedFlat'?u.s[field]+value:u.s[field]*(1+value),`${name} ${field}`);
  }
  h.b.redeploy(h.unit('ally'));assert.ok(u.findBuff(key));
  h.unit('ally').kind='token';h.run(0.25);assert.equal(u.findBuff(key),null,'summon/doll body excluded');
  h.unit('ally').kind='op';h.unit('ally').ownerId='other';h.run(0.25);assert.equal(u.findBuff(key),null,'other player excluded');
  h.unit('ally').ownerId=u.ownerId;ally.row=null;ally.col=null;h.run(0.25);assert.equal(u.findBuff(key),null,'bench excluded');
  ally.row=10;ally.col=4;
  h.b.forceEnd();assert.equal((h.b.independentRewards||[]).filter(x=>x.origin==='native'&&x.sourceUid==='w').length,0);
  assert.equal(JSON.stringify(state),before,'battle condition never mutates saved prep state');assert.equal(h.b.errorCount,0);
});
test('canonical identity equipment enables a faction condition while skill attack buffs never satisfy native-body thresholds',()=>{
  for(const elite of [false,true]){
    const source=piece('艾丝黛尔','w',elite),ally=piece('深靛','ally',false,10,4);
    const identity=Object.values(catalog.equipment).find(d=>d.mechanism==='identityTag');assert.ok(identity);
    const h=battle([source,ally]),u=h.unit('w');assert.equal(u.findBuff('independent:trait:w:0'),null);
    ally.equipment=[{id:identity.id,quantity:1,state:{faction:'萨尔贡'}}];h.run(0.25);assert.ok(u.findBuff('independent:trait:w:0'));
    ally.equipment[0].state.faction='维多利亚';h.run(0.25);assert.equal(u.findBuff('independent:trait:w:0'),null);
    const red=piece('红豆','w',elite),threshold=nativeBodyStats(red,catalog).atk*1.2;
    const weak=active.find(o=>nativeBodyStats({chessId:o.chessId,moduleId:'none'},catalog).atk<threshold);
    const t=battle([red,fromOp(weak,'ally')]);
    t.b.addBuff(t.unit('ally'),{key:'skillProbe',mods:{atkPct:100},persist:true});t.run(0.25);
    assert.equal(t.unit('w').findBuff('independent:trait:w:0'),null,'temporary skill stats cannot satisfy original attack threshold');
  }
});
test('six canonical team forges target real allies and retain explicit normal/elite quantities each prep phase',()=>{
  for(const [name,[target,count,exclude]]of Object.entries(forgeCases))for(const elite of [false,true]){
    const maker=piece(name,'w',elite),r=op(name,elite).nativeTrait.effect.prep.find(r=>r.behavior==='teamForge');
    const eligible=active.filter(o=>o.name!==name && (!target.startsWith('faction:')||tavernFactions({chessId:o.chessId},catalog).includes(target.slice(8)))
      && (!target.startsWith('profession:')||nativeRecord({chessId:o.chessId},catalog)?.profession===target.slice(11)));
    assert.ok(eligible.length>=count,`${name} actual target coverage`);
    const mates=eligible.slice(0,count+1).map((o,i)=>fromOp(o,`a${i}`,target==='adjacent'?(i===1?11:10):10,target==='adjacent'?(i===1?3:4+i):4+i));
    const bench=fromOp(eligible[0],'bench',null,null),state=stateFor([maker,...mates,bench]);
    const candidates=[...(exclude?[]:[maker]),...mates].filter(p=>target!=='adjacent'||Math.abs(p.row-maker.row)+Math.abs(p.col-maker.col)===1);
    const score=p=>r.params.sort==='highestBaseAttack'?-nativeBodyStats(p,catalog).atk:sum(p,'precision');
    const wanted=candidates.sort((a,b)=>score(a)-score(b)||a.uid.localeCompare(b.uid)).slice(0,count).map(p=>p.uid);
    runNativeHook(state,'prepEnd',{},services);
    for(const output of r.params.outputs){
      assert.equal(output.elite,output.normal*2,`${name} explicit elite count`);
      for(const p of state.pieces)assert.equal(sum(p,output.id),wanted.includes(p.uid)?output[elite?'elite':'normal']:0,`${name} -> ${p.uid} ${output.id}`);
    }
    assert.ok(state.production.every(row=>row.sourceUid==='w'&&wanted.includes(row.targetUid)));
    state.round++;runNativeHook(state,'prepEnd',{},services);
    assert.equal(state.production.reduce((n,row)=>n+row.quantity,0),r.params.outputs.reduce((n,o)=>n+o[elite?'elite':'normal'],0)*wanted.length*2);
  }
});
test('隐德来希 gain multiplier doubles/triples real 惊蛰 production, uses strongest only and ignores bench',()=>{
  for(const elite of [false,true])for(const field of [true,false]){
    const a=piece('隐德来希','a',elite,field?10:null,field?3:null),b=piece('隐德来希','b',false,field?11:null,field?3:null),maker=piece('惊蛰','maker');
    const state=stateFor([a,b,maker]);runNativeHook(state,'gain',{piece:maker},services);
    assert.equal(sum(maker,'precision'),3*(field?(elite?3:2):1));
    assert.equal(state.inventory.reduce((n,x)=>n+x.quantity,0),field?(elite?3:2):1);
  }
});
test('史尔特尔 amplifies real attack badges and adds the authored skill attack modifier',()=>{
  for(const elite of [false,true]){
    const p=piece('史尔特尔','w',elite,10,3,{skillIndex:2,equipment:[{id:'precision',quantity:5,state:{}},{id:'assault',quantity:5,state:{}}]});
    const h=battle([p],{content:'full'}),u=h.unit('w'),scale=elite?3:2;
    const basic=u.base.atk*(1+0.02*5*scale);approx(u.s.atk,basic*(1+0.02*5*scale),'both badge types amplified');
    u.skill.gainSp(u.skill.spCost,'test');assert.equal(u.skill.activate('test'),true);
    const native=nativeRecord(p,catalog),skill=native.skills.find(s=>s.index===2);
    approx(u.s.atk,basic*(1+0.02*5*scale+skill.bb.atk),'skill and assault bonuses add');
    assert.equal(h.b.errorCount,0);
  }
});
test('凛御银灰 permanently boosts team badges across prep phases up to normal/elite cap',()=>{
  for(const elite of [false,true]){
    const maker=piece('凛御银灰','w',elite),target=piece('红豆','target',false,11,3,{equipment:[{id:'agility',quantity:5,state:{}},{id:'recovery',quantity:5,state:{}}]});
    const state=stateFor([maker,target]),initial=battle(state.pieces,{state}).unit('target');
    const baseAspd=initial.s.aspd,baseSp=initial.s.spRecovery;
    for(let round=1;round<=12;round++){state.round=round;runNativeHook(state,'prepEnd',{},services);}
    const boost=state.playerEffects.find(f=>f.type==='badgeBoost');assert.equal(boost.percent,elite?3:1.5);
    const later=battle(state.pieces,{state}).unit('target');
    approx(later.s.aspd-baseAspd,later.base.aspd*0.02*5*boost.percent,'permanent agility boost');
    approx(later.s.spRecovery-baseSp,later.base.spRecovery*0.02*5*boost.percent,'permanent recovery boost');
    maker.row=null;maker.col=null;const absent=battle(state.pieces,{state}).unit('target');approx(absent.s.aspd,later.s.aspd,'boost persists when maker benched');
  }
});
test('锏 excludes her own purchase and grows real bought-operator badges to ordinary/elite cap',()=>{
  for(const elite of [false,true]){
    const maker=piece('锏','w',elite),state=stateFor([maker]);
    runNativeHook(state,'bought',{piece:maker},services);assert.equal(sum(maker,'precision'),0);assert.equal(maker.nativeState.boughtGear,undefined);
    for(let i=0;i<10;i++){const target=piece('红豆',`b${i}`,false,null,null);state.pieces.push(target);runNativeHook(state,'bought',{piece:target},services);assert.equal(sum(target,'precision'),Math.min(i+1,8)*(elite?2:1));}
    assert.equal(maker.nativeState.boughtGear,10);
  }
});
test('妮芙/仇白/圣约 actual engine events produce uncapped native rewards and preserve them in prep equipment',()=>{
  for(const name of ['妮芙','仇白','圣约送葬人'])for(const elite of [false,true]){
    const p=piece(name,'w',elite),h=battle([p],{content:'full'}),u=h.unit('w');
    const r=op(name,elite).nativeTrait.effect.combat.find(r=>r.behavior==='eventProduction'),before=JSON.stringify(p.equipment);
    assert.ok(r,`${name} authored producer`);
    if(name==='妮芙'){
      assert.equal(r.params.counterEvery,1);
      for(let i=0;i<12;i++){const target=h.spawn('revision_probe',{pos:[10,8]});h.b.dealDamage(u,target,{type:'element',element:'necrosis',amount:target.gaugeMax*2});
        if(i===0)for(const output of r.params.outputs)assert.equal(h.b.independentRewards.find(x=>x.id===output.id&&x.sourceUid==='w')?.quantity,elite?2:1,'first actual necrosis burst produces authored quantity');}
    }else if(name==='仇白'){
      assert.equal(r.params.counterEvery,6);
      const target=h.spawn('revision_probe',{pos:[10,8]});
      u.mem.independentOrigin='equipment';h.b.applyStatus(target,'bind',{source:u,duration:1});delete u.mem.independentOrigin;
      assert.equal(h.b.independentRewards.length,0,'gear status does not count');
      for(let i=0;i<80;i++){h.b.removeBuff(target,'bind');h.b.applyStatus(target,'bind',{source:u,duration:1});
        if(i===4)assert.equal(h.b.independentRewards.length,0,'first five native statuses do not produce');
        if(i===5)for(const output of r.params.outputs)assert.equal(h.b.independentRewards.find(x=>x.id===output.id&&x.sourceUid==='w')?.quantity,elite?2:1,'sixth native status batch');}
    }else{
      assert.equal(r.params.counterEvery,24);
      assert.equal(u.skill.kind,'ammo','real selected ammo skill');const target=h.spawn('revision_probe',{pos:[10,4]});
      for(let i=0;i<140;i++){if(!u.skill.active){u.skill.gainSp(u.skill.spCost,'test');assert.equal(u.skill.activate('test'),true);}h.b.forceAttack(u,[target]);
        if(i===22)assert.equal(h.b.independentRewards.length,0,'first 23 native bullets do not produce');
        if(i===23)for(const output of r.params.outputs)assert.equal(h.b.independentRewards.find(x=>x.id===output.id&&x.sourceUid==='w')?.quantity,output.quantity,'24th bullet batch preserves different attack/HP quantities');}
      assert.ok(h.hooksOf('ammoUsed').length>=96,`real attacks spend enough native ammunition: ${h.hooksOf('ammoUsed').length}, attacks=${u.stats.attacks}, noSkill=${u.skill.noSkill}, ammoLeft=${u.skill.ammoLeft}, alive=${u.alive}`);
    }
    assert.equal(JSON.stringify(p.equipment),before,'battle rewards await settlement');
    const rewards=(h.b.independentRewards||[]).filter(x=>x.sourceUid==='w'&&x.origin==='native');
    const eventCount=name==='妮芙'?12:name==='仇白'?80:h.hooksOf('ammoUsed').length;
    const expectedBatches=Math.floor(eventCount/Number(r.params.counterEvery));
    assert.equal(Object.hasOwn(r.params,'maxPerBattle'),false,`${name} has no retired Workshop reward cap`);
    for(const output of r.params.outputs)assert.equal(rewards.filter(x=>x.id===output.id).reduce((n,x)=>n+x.quantity,0),expectedBatches*Number(output.quantity),`${name} ${output.id} equals its real event batches`);
    h.b.forceEnd();const state=stateFor([p]);for(const reward of rewards)grantEquipment(state,catalog,reward.id,reward.quantity,{origin:reward.origin,sourceUid:reward.sourceUid,phase:'battle'});
    for(const output of r.params.outputs)assert.equal(sum(p,output.id),expectedBatches*Number(output.quantity),`${name} persistent settled ${output.id}`);
    assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
  }
});
test('BGS_041 Nearl rewards qualifying gain effects on present Kazimierz allies in both growth modes',()=>{
  const liveCatalog=getCatalog(data),liveServices={...services,catalog:liveCatalog,grantEquipment:(s,id,n,e)=>grantEquipment(s,liveCatalog,id,n,e)};
  const currentPiece=(name,uid,elite=false,row=10,col=3)=>{
    const normal=Object.values(liveCatalog.operators).find(o=>o.name===name&&!o.elite);assert.ok(normal,name);
    const op=elite?liveCatalog.operators[normal.eliteChessId]:normal;
    return {uid,chessId:op.chessId,elite,row,col,dir:'RIGHT',moduleId:'none',skillIndex:0,growthLevel:1,equipment:[],attachments:[],nativeState:{}};
  };
  const gaining=currentPiece('莫斯提马','incoming',false,null,null),gainerRef=liveCatalog.operators[gaining.chessId].sourceRefs.darkmoon19_2;
  assert.equal(gainerRef.battlecry,true,'the incoming operator has the authored on-gain effect');
  for(const growthMode of ['badges','levels'])for(const elite of [false,true]){
    const near=currentPiece('耀骑士临光','near',elite),mannan=currentPiece('玛恩纳','m1'),meteor=currentPiece('流星','m2'),outsider=currentPiece('红豆','other');
    const pieces=[near,mannan,meteor,outsider],state=stateFor(pieces);state.growthMode=growthMode;
    const nativeSkill=structuredClone(liveCatalog.operators[near.chessId].source.normalChess.skill);
    runNativeHook(state,'gain',{piece:gaining,source:'buy'},liveServices);
    const amount=elite?2:1;
    const sourced=(targetUid,id)=>state.production.filter(x=>x.sourceUid===near.uid&&x.targetUid===targetUid&&x.id===id).reduce((n,x)=>n+Number(x.quantity||0),0);
    for(const target of [near,mannan,meteor]){
      if(growthMode==='badges'){
        assert.equal(sourced(target.uid,'precision'),amount,`${growthMode} ${elite?'elite':'normal'} Nearl precision -> ${target.uid}`);
        assert.equal(sourced(target.uid,'damage'),amount,`${growthMode} ${elite?'elite':'normal'} Nearl damage -> ${target.uid}`);
      }else{
        const rows=state.production.filter(x=>x.id==='growth-training-record'&&x.sourceUid===near.uid&&x.targetUid===target.uid);
        assert.equal(rows.length,2,`${growthMode} records both badge-derived training outputs for ${target.uid}`);
        assert.equal(rows.reduce((n,x)=>n+Number(x.growthLevels||0),0),amount*2,`${growthMode} ${elite?'elite':'normal'} amount -> ${target.uid}`);
      }
    }
    assert.equal(sourced(outsider.uid,'precision'),0,'non-Kazimierz allies do not receive the faction growth');
    assert.equal(sourced(outsider.uid,'damage'),0);
    assert.equal(state.production.some(x=>x.id==='growth-training-record'&&x.sourceUid===near.uid&&x.targetUid===outsider.uid),false);
    assert.deepEqual(liveCatalog.operators[near.chessId].source.normalChess.skill,nativeSkill,'gain resolution leaves the source operator skill definition intact');
  }
});
