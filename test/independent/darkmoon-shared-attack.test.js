import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installDarkmoonCombat } from '../../server/sim/content/independent/darkmoonCombat.js';
import { installKeywordGear } from '../../server/sim/content/independent/keywordGear.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { unitStatsEntry } from '../../shared/protocol.js';

const catalog=getCatalog();
const GEAR='independent:坚守盟约';
const SHIELD_GEAR='independent:护盾发生器';
const ENEMY='enemy_1305_mhslim';
const ACTORS={mizuki:'chess_char_4_09_a',honeywax:'chess_char_4_05_a',front:'chess_char_4_18_a'};
const formId=(id,elite)=>elite&&catalog.operators[id.replace(/_a$/,'_b')]?id.replace(/_a$/,'_b'):id;
const firstTemp=(unit,id)=>unitStatsEntry(unit,unit.s).temporaryGrowth?.find(x=>x.sourceId===id)||null;

function sharedScenario({elite=false,growthMode='badges',withShield=false,sourceId='BGS_111',enemyKey=ENEMY,count=8}={}){
  const sourceChessId=Object.values(catalog.operators).find(o=>!o.elite&&o.sourceRefs?.darkmoon19_2?.id===sourceId)?.chessId;
  assert.ok(sourceChessId,`catalog has source ${sourceId}`);
  const actualSourceId=formId(sourceChessId,elite);
  const pieces=[
    {uid:'mizuki',chessId:actualSourceId,row:withShield?12:10,col:withShield?3:9,equipment:[{id:GEAR,quantity:1},...(withShield?[{id:SHIELD_GEAR,quantity:5}]:[])],nativeState:{}},
    {uid:'honeywax',chessId:ACTORS.honeywax,row:withShield?11:11,col:withShield?3:9,equipment:[{id:GEAR,quantity:1}],nativeState:{}},
    {uid:'front',chessId:ACTORS.front,row:9,col:9,equipment:[],nativeState:{}},
  ];
  const installations={};
  const h=makeBattle({stageId:'flat',units:pieces,enemies:[{key:enemyKey,time:0,route:0,count,interval:.25}],autoFinish:false,recordEvents:true,extraContent:[b=>{
    installKeywordGear(b,{catalog,pieces});
    for(const u of b.allyUnits)u.profile.noAttack=true;
    installations.darkmoon=installDarkmoonCombat(b,{catalog,pieces,state:{growthMode}});
  }]});
  const b=h.b,unit=h.unit('mizuki'),honey=h.unit('honeywax'),front=h.unit('front');
  const shares=[],attacks=[],damages=[];
  b.on('independentSharedAttack',event=>shares.push({attackId:event.attackId,attacker:event.attacker?.defId,targets:(event.targets||[]).map(x=>x.uid)}));
  b.on('attack',event=>{if(event.attacker?.side==='enemy'&&event.targets?.length)attacks.push({attackId:event.attackId??null,targets:event.targets.map(x=>x.uid),frontHp:front.hp,unitHp:unit.hp,honeyHp:honey.hp});});
  b.on('damaged',event=>{if(['mizuki','honeywax','front'].includes(event.target?.uid))damages.push({target:event.target.uid,attackId:event.dmg?.attackId??null,isAttack:!!event.dmg?.isAttack,tags:event.dmg?.tags||[],amount:event.amount});});
  return {h,b,unit,honey,front,shares,attacks,damages,pieces,installations,sourceId,elite,growthMode};
}
function hunit(b,uid){return b.allyUnits.find(u=>u.uid===uid);}
function uniqueSharedIds(s){return new Set(s.shares.map(x=>x.attackId));}
function recordFor(s,id='BGS_111'){return s.installations.darkmoon.entries.find(x=>x.id===id);}
async function advanceShared(s,wanted,max=180){assert.equal(s.h.runUntil(()=>uniqueSharedIds(s).size>=wanted,max),true,`waited ${max}s for ${wanted} distinct shared attacks; got ${uniqueSharedIds(s).size}`);}
function expectedRecord(unit,id='BGS_111'){return firstTemp(unit,id);}

for(const elite of [false,true])for(const growthMode of ['badges','levels']){
  test(`BGS111 counts shared attack actions once through 7/8/16 (${elite?'elite':'normal'}, ${growthMode})`,async()=>{
    const s=sharedScenario({elite,growthMode,count:8});
    assert.equal(s.b.errorCount,0,JSON.stringify(s.b.errors));
    assert.equal(s.pieces.find(x=>x.uid==='front').equipment.length,0);
    assert.ok(s.b.independentKeywordInstallations.some(x=>x.unit.uid==='mizuki'&&x.gearId==='oath-cover'));
    await advanceShared(s,7);
    let e=recordFor(s),tmp=expectedRecord(s.unit);
    assert.equal(e.cadence.attacked,7);
    assert.equal(e.uses,0);
    assert.equal(tmp,null,'seven true shared attack actions do not grant combat training');
    await advanceShared(s,8);
    e=recordFor(s);tmp=expectedRecord(s.unit);
    assert.equal(e.cadence.attacked,8);assert.equal(e.uses,1);
    if(growthMode==='badges')assert.deepEqual({attackUnits:tmp?.attackUnits,secondaryUnits:tmp?.secondaryUnits},{attackUnits:elite?2:1,secondaryUnits:elite?2:1});
    else assert.equal(tmp?.temporaryTrainingLevels,(elite?4:2)*Number(catalog.config?.levelsPerBadge||1));
    const firstId=[...uniqueSharedIds(s)].at(-1);
    assert.ok(s.shares.some(x=>x.attackId===firstId&&x.targets.includes('mizuki')));
    assert.ok(s.shares.some(x=>x.attackId===firstId&&x.targets.includes('honeywax')),'one enemy action shares to both equipped recipients');
    await advanceShared(s,16);
    e=recordFor(s);tmp=expectedRecord(s.unit);
    assert.equal(e.cadence.attacked,16);assert.equal(e.uses,2);
    if(growthMode==='badges')assert.deepEqual({attackUnits:tmp?.attackUnits,secondaryUnits:tmp?.secondaryUnits},{attackUnits:elite?4:2,secondaryUnits:elite?4:2});
    else assert.equal(tmp?.temporaryTrainingLevels,(elite?8:4)*Number(catalog.config?.levelsPerBadge||1));
    assert.equal(s.shares.length,uniqueSharedIds(s).size,'the source emits one shared event per actual enemy attack action');
    assert.ok(s.shares.every(x=>x.targets.includes('mizuki')&&x.targets.includes('honeywax')),'each attack shares to both covered recipients in one event');
    assert.ok(s.damages.some(x=>x.target==='mizuki'&&x.isAttack));
    assert.ok(s.damages.some(x=>x.target==='mizuki'&&!x.isAttack),'the enemy also emits non-attack ability damage, which must not count as an attack action');
    assert.equal(e.attackedAttackIds.size,16,'direct/shared notifications dedupe to 16 attack identities');
    assert.equal(s.b.errorCount,0,JSON.stringify(s.b.errors));
  });
}

test('shared attack whose wearer shield fully absorbs the share still counts once',async()=>{
  const s=sharedScenario({withShield:true,count:8});
  assert.ok(s.b.independentKeywordInstallations.some(x=>x.unit===s.unit&&x.gearId==='shield-generator'));
  s.h.run(0.1);
  const shieldKey=s.unit.buffs.find(x=>x.key.startsWith('independent:keywordGear:shield-generator:'))?.key;
  const shield=s.unit.findBuff(shieldKey);
  assert.ok(shield?.shieldHits>0,'the actual shield-generator keyword gear is installed on the Oath Cover wearer');
  const layersBefore=shield.shieldHits;
  await advanceShared(s,8);
  assert.ok((s.unit.findBuff(shieldKey)?.shieldHits??0)<layersBefore,'the shared attack consumed a real shield layer');
  const attackDamage=s.damages.filter(x=>x.target==='mizuki'&&x.isAttack);
  assert.ok(attackDamage.length>0,'the wearer received attack damage events');
  assert.ok(attackDamage.every(x=>x.amount===0),JSON.stringify({message:'the actual shield fully absorbed each shared attack before HP loss',attackDamage,attacks:s.attacks,shares:s.shares,shieldLeft:s.unit.findBuff(shieldKey)?.shieldHits}));
  assert.ok(s.shares.some(x=>x.targets.includes('mizuki')));
  assert.equal(recordFor(s).uses,1);
  assert.equal(expectedRecord(s.unit)?.attackUnits,1);
  assert.equal(s.b.errorCount,0,JSON.stringify(s.b.errors));
});

test('a fresh Battle starts a fresh shared-attack cadence',async()=>{
  const first=sharedScenario({count:8});await advanceShared(first,8);assert.equal(recordFor(first).uses,1);
  const fresh=sharedScenario({count:8});
  assert.equal(recordFor(fresh).cadence.attacked,undefined);assert.equal(recordFor(fresh).uses,0);assert.equal(expectedRecord(fresh.unit),null);
  await advanceShared(fresh,7);assert.equal(recordFor(fresh).uses,0);assert.equal(expectedRecord(fresh.unit),null);
});

test('native multi-hit force attack damage instances share one attack identity',()=>{
  const s=sharedScenario({count:1});
  s.h.run(0.1);
  const enemy=s.h.enemies()[0];assert.ok(enemy,'actual enemy entity exists');
  enemy.profile.hits=4;
  assert.equal(s.b.forceAttack(enemy,[s.front]),true,'invoke the battle attack lifecycle on the actual enemy unit');
  const entry=recordFor(s),ids=uniqueSharedIds(s);
  assert.equal(ids.size,1);
  assert.ok(s.shares.length>1,`${s.shares.length} damage instances notified shared recipients with one attack identity`);
  assert.equal(entry.cadence.attacked,1,'one attack action advances cadence once despite its four damage instances');
  assert.equal(entry.attackedAttackIds.size,1);
});

test('native enemy attack against a covered operator plus another covered share counts once',()=>{
  const sourceChessId=Object.values(catalog.operators).find(o=>!o.elite&&o.sourceRefs?.darkmoon19_2?.id==='BGS_111')?.chessId;
  const pieces=[
    {uid:'mizuki',chessId:sourceChessId,row:10,col:9,equipment:[{id:GEAR,quantity:1}],nativeState:{}},
    {uid:'front',chessId:ACTORS.front,row:9,col:9,equipment:[],nativeState:{}},
  ];
  let installed;
  const h=makeBattle({stageId:'flat',units:pieces,enemies:[{key:ENEMY,time:0,route:0,count:2,interval:.25}],autoFinish:false,recordEvents:true,extraContent:[b=>{
    installKeywordGear(b,{catalog,pieces});for(const u of b.allyUnits)u.profile.noAttack=true;
    installed=installDarkmoonCombat(b,{catalog,pieces,state:{growthMode:'badges'}});
  }]});
  const enemy=()=>h.enemies()[0];
  h.run(0.1);assert.ok(enemy());
  enemy().profile.melee=false;enemy().profile.maxTargets=2;enemy().base.rangeRadius=1.8;
  const seen=[];h.b.on('attack',ev=>{if(ev.attacker?.side==='enemy')seen.push({id:ev.attackId,targets:ev.targets.map(t=>t.uid)});});
  assert.equal(h.runUntil(()=>seen.some(x=>x.targets.includes('front')&&x.targets.includes('mizuki')),20),true,JSON.stringify(seen));
  const entry=installed.entries.find(x=>x.id==='BGS_111');
  assert.equal(entry.cadence.attacked,1,'direct and shared reports from the same actual enemy attack share one attackId');
  assert.equal(entry.attackedAttackIds.size,1);
});

test('BGS110, BGS201 and BGS060 retain their recipients/counter when shared damage qualifies',async()=>{
  const actorBuff=sharedScenario({sourceId:'BGS_110',count:8});
  await advanceShared(actorBuff,8);
  assert.equal(recordFor(actorBuff,'BGS_110').uses,1);
  assert.ok(firstTemp(actorBuff.unit,'BGS_110'),'BGS110 keeps the attacked covered unit as its buff target');

  const adjacentBuff=sharedScenario({sourceId:'BGS_201',count:8});
  await advanceShared(adjacentBuff,8);
  assert.equal(recordFor(adjacentBuff,'BGS_201').uses,1);
  assert.ok(firstTemp(adjacentBuff.honey,'BGS_201'),'BGS201 keeps its adjacent-self recipient');

  const counter=sharedScenario({sourceId:'BGS_060',count:8});
  counter.unit.profile.noAttack=false;
  await advanceShared(counter,8);
  counter.h.runUntil(()=>counter.installations.darkmoon.trace.some(x=>x.kind==='counterattack'),1);
  assert.ok(counter.installations.darkmoon.trace.some(x=>x.kind==='counterattack'),'BGS060 still counterattacks at its native cadence after shared attacks');
  assert.equal(counter.b.errorCount,0,JSON.stringify(counter.b.errors));
});
