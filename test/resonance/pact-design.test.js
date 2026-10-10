import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { Battle } from '../../server/sim/Battle.js';
import { installResonancePacts } from '../../server/sim/content/resonance/pacts.js';
import { currentPactThresholds } from '../../shared/resonance/current-pacts.js';
import { createSession, validateSession, unbiasedTransferChoices } from '../../server/modes/resonance/session.js';
import { enemyRec,flatStage } from '../helpers/battleHarness.js';

const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
const catalog=getResonanceCatalog(data,{rulesVersion:2,seed:3}),legacy=getResonanceCatalog(data,{environmentId:'origin_laterano',seed:3});
const rows=[...new Map(catalog.config.activeOperatorIds.map(id=>catalog.operators[id]).map(op=>[op.charId,op])).values()].sort((a,b)=>Number(b.position==='MELEE')-Number(a.position==='MELEE'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function setup(pact,count) {
  const operators=Object.fromEntries(Object.entries(catalog.operators).map(([id,op])=>[id,{...op,pacts:[]}])),chosen=rows.slice(0,count);
  const player={playerId:'pact-design',units:chosen.map((op,index)=>({uid:`p-${index}`,chessId:op.id,skillIndex:op.fixedSkillIndex??0,moduleId:'none',row:9,col:1+index,dir:'RIGHT',items:[],extraPacts:[pact]}))};
  const kits=Object.fromEntries(chosen.map(op=>[op.id,()=>({trait:{noAttack:true},skill:{id:'pact-design',kind:'instant',trigger:'SP_FULL',spCost:999,initSp:0,spType:'time'}})]));
  const battle=new Battle({seed:3,kind:'normal',round:1,timeLimit:120,autoFinish:false,stage:flatStage({id:'pact-design'}),data,players:[player],kits,content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:20,dpPerSec:1,dpMax:99}});
  const metrics={};battle.resonanceMetric=(key,value=1)=>{metrics[key]=(metrics[key]??0)+value;};
  const active=installResonancePacts(battle,{catalog:{...catalog,operators},state:{pieces:[]}});
  battle.start();return {battle,units:battle.allyUnits,metrics,active};
}
function advance(b,to) { while(b.time<to-1e-9&&!b.finished)b.step();assert.equal(b.errorCount,0); }
function enemy(b,pos=[9,10],name='pact-design-enemy') { return b.spawnEnemy(name,{pos,def:enemyRec({key:name,hp:1e9,atk:0,def:0,res:0,speed:0,rank:'NORMAL'})}); }
function cast(b,u){assert.equal(u.skill.activate('pact-design',{free:true}),true);advance(b,b.time+.1);}

test('all 35 current pacts have synchronized reachable tiers and complete tier-specific text; legacy tiers stay intact',()=>{
  assert.equal(Object.keys(catalog.pacts).length,35);
  for(const [id,expected] of Object.entries(currentPactThresholds)) {
    const pact=catalog.pacts[id],natural=catalog.config.activeOperatorIds.filter(op=>catalog.operators[op].pacts.includes(id)).length;
    assert.deepEqual(pact.thresholds,expected);assert.deepEqual(pact.levels.map(l=>l.threshold),expected);assert.ok(Math.max(...expected)<=natural+2,`${id} unreachable`);
    assert.deepEqual(catalog.playerText.pacts[id].levels,pact.levels.map(l=>({threshold:l.threshold,description:l.description})));
    assert.ok(pact.levels.every(l=>l.description&&/\d/.test(l.description)));if(pact.levels.length>1)assert.equal(new Set(pact.levels.map(l=>l.description)).size,pact.levels.length);
    for(const level of pact.levels)assert.doesNotThrow(()=>setup(id,level.threshold));
  }
  assert.deepEqual(legacy.pacts.kjerag.thresholds,[2,4,7]);assert.deepEqual(legacy.pacts.rhodes.thresholds,[2,4,6]);assert.deepEqual(legacy.pacts.burn.thresholds,[2,3,4]);
  for(const id of ['babel','burn','flight','sami','holyGun','yela','crown','sui'])assert.equal(catalog.pacts[id].emblemAllowed,false);
});

test('Rhodes consumes exact 10/20/30 percent mitigation at all current tiers and expires after ten seconds',()=>{
  for(const [count,mitigation] of [[2,10],[3,20],[4,30]]) {
    const {battle,units}=setup('rhodes',count),attacker=enemy(battle);cast(battle,units[0]);
    near(battle.dealDamage(attacker,units[0],{amount:100,type:'true',canDodge:false}),100-mitigation);
    near(battle.dealDamage(attacker,units[1],{amount:100,type:'true',canDodge:false}),100);
    advance(battle,10.2);near(battle.dealDamage(attacker,units[0],{amount:100,type:'true',canDodge:false}),100);
  }
});

test('Iberia first-block shield explodes once on any enemy damage or at ten seconds, at every tier',()=>{
  for(const count of [2,3,4])for(const breakEarly of [false,true]) {
  const {battle,units,metrics}=setup('iberia',count),blocker=units[0],attacker=enemy(battle,[blocker.y,blocker.x+.5]);
    battle.emit('blocked',{blocker,enemy:attacker});const buff=blocker.buffs.find(b=>b.key===`resonance:pact:iberia-barrier:${blocker.id}`),p=catalog.pacts.iberia.levels.find(l=>l.threshold===count).effects[0].params;
    near(buff.shield,blocker.s.maxHp*p.barrier/100);assert.equal(buff.duration,10);let explosionDamage=0;
    battle.on('damaged',event=>{if(event.source===blocker&&(event.dmg?.tags??[]).includes('resonance'))explosionDamage+=event.dealt;});
    if(breakEarly)battle.dealDamage(attacker,blocker,{amount:buff.shield+1,type:'true',isAttack:false,canDodge:false});else advance(battle,10.2);
    near(explosionDamage,blocker.s.atk*p.breakDamage/100);assert.equal(blocker.mem.pactIberiaExploded,true);assert.ok(metrics['triggers.iberiaExplosion']>=1);
    advance(battle,11);battle.dealDamage(attacker,blocker,{amount:1,type:'true',canDodge:false});near(explosionDamage,blocker.s.atk*p.breakDamage/100);
    assert.equal(blocker.buffs.some(b=>b.key===buff.key),false);
  }
});

test('Arts SP recovery and percentage resistance penetration work at every tier and persist through death',()=>{
  for(const count of [2,4,6]) {
    const {battle,units}=setup('arts',count),p=catalog.pacts.arts.levels.find(l=>l.threshold===count).effects[0].params;
    near(units[0].s.spRecovery,1+p.sp);near(units[0].s.resIgnorePct,p.resPen/100);advance(battle,1.1);assert.ok(units[0].skill.sp>=1+p.sp);
    const attacker=enemy(battle);battle.dealDamage(attacker,units[0],{amount:1e8,type:'true',canDodge:false});near(units[0].s.resIgnorePct,p.resPen/100);near(units[0].s.spRecovery,1+p.sp);
    advance(battle,units[0].respawnAt+.2);assert.equal(units[0].alive,true);near(units[0].s.resIgnorePct,p.resPen/100);
  }
});

test('Necrosis increases native elemental gauge gain and starts its configured DOT on a genuine burst',()=>{
  for(const count of [2,3,4]) {
    const {battle,units}=setup('necrosis',count),target=enemy(battle),p=catalog.pacts.necrosis.levels.find(l=>l.threshold===count).effects[0].params;
    const amount=battle.dealDamage(units[0],target,{amount:100,type:'element',element:'apoptosis',canDodge:false});near(amount,100*(1+p.bonus/100));
    battle.dealDamage(units[0],target,{amount:target.gaugeMax,type:'element',element:'apoptosis',canDodge:false});
    const dot=target.buffs.find(b=>b.key==='resonance:necrosis:pact');assert.ok(dot);near(dot.data.dps,units[0].s.atk*p.dps/100);assert.equal(dot.duration,p.duration);
    advance(battle,1.1);assert.equal(battle.errorCount,0);
  }
});

test('Columbia applies both HP and ATK to a real native token at every retained tier',()=>{
  const tokenId=Object.values(data.chess).find(row=>row.tokens?.length).tokens[0];
  for(const count of [2,4,6]) {
    const {battle,units}=setup('columbia',count),p=catalog.pacts.columbia.levels.find(l=>l.threshold===count).effects[0].params;
    const token=battle.spawnToken(units[0],tokenId,9,9,{def:data.tokens[tokenId],kit:{trait:{noAttack:true}}});assert.ok(token);
    near(token.s.maxHp,token.base.maxHp*(1+p.hp/100));near(token.s.atk,token.base.atk*(1+p.atk/100));near(token.hp,token.s.maxHp);
    assert.notEqual(p.atk,p.constructAtk,'owned native tokens and pact constructs use their independent configured values');
    assert.equal(p.rebuildEnabled,count===6);
  }
});

test('Columbia six-member rebuild keeps construct scale, happens once, and requires a live deployed owner and free tile',()=>{
  const makeConstruct=()=>{const fixture=setup('columbia',6);advance(fixture.battle,12.2);const owner=fixture.units[0],construct=fixture.battle.allyUnits.find(unit=>unit.kind==='token'&&unit.ownerUnit===owner&&unit.mem.resonanceSyntheticKind==='columbia-construct'&&unit.alive);assert.ok(construct);return {...fixture,owner,construct,p:catalog.pacts.columbia.levels.find(level=>level.threshold===6).effects[0].params};};
  const fixture=makeConstruct(),{battle,owner,construct,p}=fixture;
  near(construct.s.maxHp,owner.s.maxHp*p.hp/100);near(construct.s.atk,owner.s.atk*p.constructAtk/100);
  battle.dealDamage(enemy(battle),construct,{amount:1e9,type:'true',canDodge:false});advance(battle,battle.time+.1);
  let alive=battle.allyUnits.filter(unit=>unit.kind==='token'&&unit.ownerUnit===owner&&unit.mem.resonanceSyntheticKind==='columbia-construct'&&unit.alive);
  assert.equal(alive.length,1);near(alive[0].s.maxHp,owner.s.maxHp*p.hp/100);near(alive[0].s.atk,owner.s.atk*p.constructAtk/100);
  battle.dealDamage(enemy(battle),alive[0],{amount:1e9,type:'true',canDodge:false});advance(battle,battle.time+.1);
  assert.equal(battle.allyUnits.filter(unit=>unit.kind==='token'&&unit.ownerUnit===owner&&unit.mem.resonanceSyntheticKind==='columbia-construct'&&unit.alive).length,0,'the same owner rebuilds only once');

  const full=makeConstruct();full.battle.grid.canStand=()=>false;full.battle.dealDamage(enemy(full.battle),full.construct,{amount:1e9,type:'true',canDodge:false});advance(full.battle,full.battle.time+.1);
  assert.equal(full.battle.allyUnits.filter(unit=>unit.ownerUnit===full.owner&&unit.mem.resonanceSyntheticKind==='columbia-construct'&&unit.alive).length,0,'full field offers no rebuild tile');
  const departed=makeConstruct();departed.owner.deployed=false;departed.battle.dealDamage(enemy(departed.battle),departed.construct,{amount:1e9,type:'true',canDodge:false});advance(departed.battle,departed.battle.time+.1);
  assert.equal(departed.battle.allyUnits.filter(unit=>unit.ownerUnit===departed.owner&&unit.mem.resonanceSyntheticKind==='columbia-construct'&&unit.alive).length,0,'a departed owner cannot rebuild');
});

test('Higashi deployment applies configured timed stealth and both dodge types, then expires',()=>{
  for(const count of [2,3]) {
    const {battle,units}=setup('higashi',count),unit=units[0],p=catalog.pacts.higashi.levels.find(l=>l.threshold===count).effects[0].params;
    const buff=unit.buffs.find(row=>row.key===`resonance:pact:higashi-deploy:${unit.id}`);
    assert.ok(buff);assert.equal(buff.flags.stealth,true);assert.equal(buff.duration,p.stealthSeconds);
    near(unit.s.dodgePhys,p.dodge/100);near(unit.s.dodgeArts,p.dodge/100);
    advance(battle,p.stealthSeconds+.2);assert.equal(unit.buffs.includes(buff),false);near(unit.s.dodgePhys,0);near(unit.s.dodgeArts,0);
  }
});

test('Ursus eight-neighbour defense is not stacked and disappears on neighbour death, then returns on native redeploy',()=>{
  const {battle,units}=setup('ursus',2),base=units[0].s.def;advance(battle,.3);near(units[0].s.def,base+80);
  battle.dealDamage(enemy(battle),units[1],{amount:1e8,type:'true',canDodge:false});advance(battle,.7);near(units[0].s.def,base);
  advance(battle,units[1].respawnAt+.5);assert.equal(units[1].alive,true);near(units[0].s.def,base+80);
  units[1].removed=true;advance(battle,battle.time+.3);near(units[0].s.def,base);
});

test('Burn native burst splashes other enemies once and never propagates another elemental burst',()=>{
  const {battle,units}=setup('burn',1),source=units[0],target=enemy(battle,[9,8]),other=enemy(battle,[9,9],'pact-design-neighbour'),outside=enemy(battle,[9,11],'pact-design-outside');
  const before=other.hp,far=outside.hp,events=[];battle.on('damaged',e=>{if(e.dmg.tags.includes('burnSplash'))events.push(e);});
  battle.dealDamage(source,target,{amount:target.gaugeMax,type:'element',element:'burn',canDodge:false});near(before-other.hp,source.s.atk*.3);assert.equal(outside.hp,far);
  assert.equal(events.length,1);assert.equal(events[0].dmg.isAttack,false);assert.equal(other.elem.burn,0);assert.equal(battle.errorCount,0);
});

test('current v2 source labels are honest and removed Siracusa wolf parameters and text do not survive',()=>{
  assert.match(catalog.pacts.siracusa.levels.map(level=>level.description).join(' '),/击倒敌人时本人恢复/);
  assert.doesNotMatch(catalog.pacts.siracusa.levels.map(level=>level.description).join(' '),/狼影/);
  for(const level of catalog.pacts.siracusa.levels)for(const effect of level.effects)for(const key of ['wolfAt','wolfInterval','wolfDamage'])assert.equal(Object.hasOwn(effect.params??{},key),false);
  assert.match(catalog.pacts.siracusa.levels[0].effects[0].reference.removal,/removed from current v2/);
  assert.match(catalog.pacts.siracusa.levels[0].effects[1].reference.killToSp.sourceKind,/community game-data derivative/);
  assert.doesNotMatch(catalog.pacts.siracusa.levels[0].effects[1].reference.killToSp.sourceKind,/first-party publication/);
  assert.ok(catalog.pacts.burn.levels[0].effects[0].reference.native.nativeGit);
  assert.match(catalog.pacts.burn.levels[0].effects[0].reference.competitor.sourceUrl,/ubisoft\.com/);
});

test('newly disabled unique-pact transfer items remain readable in old saves and never enter new choices',()=>{
  const disabled=['transfer_babel','transfer_burn','transfer_flight','transfer_sami','transfer_sui'];
  for(const itemId of disabled){assert.ok(catalog.equipment[itemId],`${itemId} remains defined`);assert.equal(catalog.equipment[itemId].grantAllowed,false);}
  const created=createSession({seed:3,catalog});assert.equal(created.ok,true,created.error);
  created.state.inventory.push(...disabled.map((itemId,index)=>({uid:`legacy-held-${index}`,itemId})));
  assert.equal(validateSession(created.state,{catalog}).ok,true,'historical owned emblems continue to validate');
  const choices=unbiasedTransferChoices(createSession({seed:3,catalog}).state,catalog,100);
  assert.ok(choices.length>0);assert.equal(choices.some(id=>disabled.includes(id)),false);
  for(const itemId of ['transfer_laterano','transfer_kjerag','aegirTransfer','artsTransfer','ammoTransfer','controlTransfer','symbiosisTransfer','breakerTransfer','yanTransfer'])
    assert.ok(catalog.equipment[itemId],`${itemId} remains a canonical valid transfer or recipe output`);
  const legacyCatalog=getResonanceCatalog(data,{rulesVersion:1,environmentId:'origin_laterano',seed:4});
  for(const itemId of disabled)assert.ok(legacyCatalog.equipment[itemId],`${itemId} remains in the v1 catalogue`);
});

if(process.env.SP_PACT_DESIGN_AUDIT==='1') {
  const root='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/resonance/stronghold-protocol';
  const files=['server/sim/content/resonance/pacts.js','server/sim/content/resonance/battle.js','server/sim/content/resonance/kits.js','server/modes/resonance/battle.js','server/modes/resonance/session.js'];
  const sources=files.map(file=>({file:`${root}/${file}`,lines:fs.readFileSync(`${root}/${file}`,'utf8').split(/\r?\n/)}));
  const invariants={antiAir:'native radius/nearest enemy queries include flying enemies',bossNoExecute:'only damage amplification, no instant kill',nextHitOnce:'queued damage reset on first ordinary hit',nextHitBasicAttackOnly:'isAttack and not isSkill guard',noStack:'queue assigned only if empty',nonRecursive:'damage amount changed without nested damage',oncePerOperator:'pactRhodesUsed memory',goldOncePerNode:'one battleEnd settlement',firstBlockOnly:'pactIberiaBlocked memory',controlled:'native sluggish/cold/freeze/bind flags',choiceCount:'one component choice in existing reward ledger',healPercentMaxHp:'maxHp times configured healing percent',noCrossRefund:'zero refund SP/chance',respectBossResistance:'native applyStatus resistance',baseDp:'canonical battle dpInit=20',dpPerSecond:'canonical battle dpPerSec=1',dpCap:'canonical battle dpMax=99',eliteOnce:'pactBreakerElite memory',noPropagation:'resonance damage tag excludes element rider',noSameSourceStack:'pactNecrosis target memory',tileCoverage:'yelaTick field tile enumeration',starThreeDoubleHit:'star3_yela hitDamage personal passive',paralysis:'star3_yela paralysisStacks personal passive',permanentSkillAt:'star3_yela permanentSkill personal passive',barrierOnFirstCast:'resonanceSuiBarrier memory',maxSummons:'resonanceSuiAlive memory',visible:'spawnVisible native token',battleOnly:'per-battle unit memory',skillId:'fixed native chosen skill identity'};
  const flatten=(object,prefix='')=>Object.entries(object).flatMap(([key,value])=>value&&typeof value==='object'?flatten(value,`${prefix}${key}/`):[{path:`${prefix}${key}`,key,value}]);
  const pacts=Object.entries(catalog.pacts).map(([id,pact])=>({id,name:pact.name,naturalMembers:catalog.config.activeOperatorIds.filter(op=>catalog.operators[op].pacts.includes(id)).length,thresholds:pact.thresholds,emblemAllowed:pact.emblemAllowed!==false,levels:pact.levels.map(level=>({threshold:level.threshold,description:level.description,effects:level.effects.map(effect=>({kind:effect.kind,reference:effect.reference??null,params:flatten(effect.params??{}).map(field=>({...field,status:invariants[field.key]?'implemented-invariant-or-personal-passive':'source-property-read',invariant:invariants[field.key]??null,sourceEvidence:sources.flatMap(source=>source.lines.flatMap((line,index)=>new RegExp(`\\b${field.key}\\b`).test(line)?[{path:source.file,line:index+1,expression:line.trim()}]:[])).slice(0,8)}))}))}))}));
  fs.writeFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/pact-design-check.json',JSON.stringify({sourceNative:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),proofNote:'Property occurrences are source inspection evidence, not an assertion of all-tier runtime coverage. Constant contracts and personal-passive aliases are labelled separately; real Battle cases are in pact-design.test.js and the existing pact suites.',pacts},null,2));
}
