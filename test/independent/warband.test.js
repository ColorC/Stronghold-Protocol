import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { nativeEffectFor, runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';
import { shopCarryApplies } from '../../server/modes/independent/warbandPrep.js';
import { validateWarbandRule } from '../../shared/warbandSchema.js';
import { traitSummary, TRAIT_WHEN } from '../../server/modes/independent/summary.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const rule=(trigger,behavior,params)=>({trigger,behavior,params});
const retirement=(p={})=>rule('death','retiringEffect',{buff:{faction:'叙拉古',stats:{attackPercent:.1},duration:'battle'},...p});
const event=(event,more={})=>rule(event==='summon'?'deploy':event,'warbandEvent',{event,faction:'叙拉古',targets:'self',stats:{attackPercent:.1},...more});
const reaction=(mode,more={})=>rule(mode==='refund'?'bought':mode==='funds'?'sold':mode==='discount'?'gain':'allyGain','factionReaction',{faction:'叙拉古',mode,targets:'all',count:2,outputs:[{id:'precision',quantity:1}],...more});
const piece=(uid,combat=[],prep=[],faction='叙拉古')=>({uid,chessId:`test_${uid}`,row:10,col:3,dir:'RIGHT',equipment:[],attachments:[],nativeState:{},combat,prep,faction});
function catalogFor(pieces) {
  const operators={},chess={};
  for(const p of pieces) {
    chess[p.chessId]=chessRec({id:p.chessId,skill:null,dmgType:'phys',attackKind:'melee',position:'MELEE',stats:{atk:100,maxHp:1000,def:100,aspd:100,respawnTime:100,spRecovery:0},rangeGrid:Array.from({length:19},(_,r)=>Array.from({length:19},(_,c)=>[r,c])).flat()});
    operators[p.chessId]={chessId:p.chessId,tier:2,nativeFactionTags:[p.faction],source:{normalChess:chess[p.chessId]},nativeTrait:{effect:{combat:p.combat,prep:p.prep}}};
  }
  return {catalog:{operators,badges:{precision:{id:'precision',kind:'badge',mechanism:'badge'}},equipment:{},attachments:{},config:{badgeLanding:'self'}},chess};
}
function battle(pieces) {
  pieces.forEach((p,i)=>{p.row=10+Math.floor(i/5);p.col=3+i%5;});
  const {catalog,chess}=catalogFor(pieces);
  const h=makeBattle({units:pieces.map(p=>({uid:p.uid,chessId:p.chessId,row:p.row,col:p.col})),defs:{chess,enemies:{dummy:enemyRec({key:'dummy',hp:1e6,speed:0})}},content:'none',autoFinish:false,
    flags:{independent:{catalog,pieces}},extraContent:[b=>installIndependentBattle(b,{catalog,state:{pieces}})]});
  h.step(1);for(const u of h.b.allyUnits)u.atkCd=1e9;
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));return {...h,catalog,pieces};
}
const attacks=(h,u,e,n)=>{for(let i=0;i<n;i++)h.b.forceAttack(u,[e]);};

test('gain propagation fires only allyGain; faction shop/refund/badge isolation and repeated discount/funds are concrete',()=>{
  const holder=piece('h',[],[reaction('badge',{targets:'self',perTier:true}),reaction('shop'),reaction('refund')]);
  const gained=piece('g',[],[rule('gain','grantEquipment',{outputs:[{id:'precision',normal:1,elite:1}]})]);
  const outsider=piece('o',[],[],'炎');
  const {catalog}=catalogFor([holder,gained,outsider]);
  const state={round:1,nextUid:1,pieces:[holder,gained,outsider],inventory:[],funds:0,playerEffects:[],shop:{upgradePrice:3,slots:[{kind:'chess',id:gained.chessId,equipment:[]},{kind:'chess',id:outsider.chessId,equipment:[]}]}};
  const services={catalog,grantEquipment:(s,id,q,x)=>grantEquipment(s,catalog,id,q,x)};
  runNativeHook(state,'gain',{piece:gained},services);
  assert.equal(gained.equipment[0].quantity,1,'the gained body gain handler runs once');
  assert.equal(holder.equipment[0].quantity,2,'reactor scales by real gained tier');
  assert.equal(state.shop.slots[0].equipment.length,1);assert.equal(state.shop.slots[1].equipment.length,0);
  runNativeHook(state,'gain',{piece:outsider},services);assert.equal(holder.equipment[0].quantity,2);
  for(let i=0;i<4;i++)runNativeHook(state,'bought',{piece:gained},services);
  assert.equal(state.funds,8);assert.equal(state.pendingFunds,undefined);
  state.round++;runNativeHook(state,'bought',{piece:gained},services);assert.equal(state.funds,10);
  const fx=state.playerEffects[0];assert.equal(shopCarryApplies(fx,{id:gained.chessId},catalog),true);assert.equal(shopCarryApplies(fx,{id:outsider.chessId},catalog),false);
  assert.equal(shopCarryApplies({type:'shopCarry'},{id:outsider.chessId},catalog),true,'legacy unfiltered shop buff is compatible');
  holder.prep=[reaction('discount',{targets:'self',count:2}),reaction('funds',{targets:'self',count:3})];catalog.operators[holder.chessId].nativeTrait.effect.prep=holder.prep;
  runNativeHook(state,'gain',{piece:holder},services);runNativeHook(state,'gain',{piece:holder},services);assert.equal(state.shop.upgradePrice,0);
  runNativeHook(state,'sold',{piece:holder},services);assert.equal(state.funds,13);
});

test('native death and retirement count once per deployment, strongest multiplier doubles retiring and echo actions without loops',()=>{
  const h=battle([piece('fallen',[retirement()]),piece('buffed'),piece('double',[rule('passive','retirementMultiplier',{extra:1})]),piece('weak',[rule('passive','retirementMultiplier',{extra:1})]),piece('echo',[rule('attack','deathrattleEcho',{faction:'叙拉古',every:12})])]);
  const target=h.unit('buffed'),fallen=h.unit('fallen'),echo=h.unit('echo');const e=h.spawn('dummy',{pos:[10,8]});
  attacks(h,echo,e,12);assert.equal(Math.round(target.s.atk),120,'one echo invocation enjoys the strongest live multiplier');
  assert.equal(Math.round(fallen.s.atk),120,'the live echoed holder also receives the friendly buff');
  h.b.retreat(fallen);h.step(1);assert.equal(Math.round(target.s.atk),140,'retreating + death is one retirement multiplied twice');
  h.b.redeploy(fallen,{free:true});fallen.atkCd=1e9;h.b.kill(fallen);h.step(1);assert.equal(Math.round(target.s.atk),160);
  h.b.redeploy(fallen,{free:true});h.b.kill(fallen);h.step(1);assert.equal(Math.round(target.s.atk),180,'retirement continues beyond its former cap');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('retiring summons wait for an enemy and Deflect refreshes shield on each event',()=>{
  const h=battle([piece('maker',[retirement({buff:undefined,summon:{count:2,statRatio:.5}})]),piece('mama',[event('summon',{targets:'actor',stats:{attackPercent:.4,maxHpPercent:.4}})]),piece('deflect',[event('summon',{targets:'self',stats:{attackPercent:.04},shieldLayers:2})])]);
  h.spawn('dummy',{pos:[10,8]});h.b.kill(h.unit('maker'));h.run(.3);
  const tokens=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive);
  assert.equal(tokens.length,2);assert.equal(new Set(tokens.map(t=>`${t.tileR},${t.tileC}`)).size,2);
  for(const token of tokens){assert.equal(Math.round(token.s.atk),70);assert.equal(Math.round(token.s.maxHp),700);assert.deepEqual(token.items,[]);assert.equal(token.kind,'token');assert.ok(!h.b.downOn(token.tileR,token.tileC));}
  const deflect=h.unit('deflect');assert.equal(Math.round(deflect.s.atk),108);assert.equal(deflect.buffs.reduce((n,b)=>n+(b.shieldHits||0),0),4,'each deployed summon emits its own event');
  h.run(1.1);h.b.spawnToken(h.unit('mama'),'fresh',12,9,{def:{stats:{atk:20,maxHp:200},skill:null},kit:{},anySource:true});
  assert.equal(Math.round(deflect.s.atk),112);assert.equal(deflect.buffs.reduce((n,b)=>n+(b.shieldHits||0),0),6);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('a retirement summon request survives its owner leaving before the first engageable enemy arrives',()=>{
  const h=battle([piece('maker',[retirement({buff:undefined,summon:{count:1,statRatio:.5}})])]);
  const owner=h.unit('maker');h.b.kill(owner);h.step(.2);
  assert.equal(h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive).length,0,'the triggered request waits while the battle has no enemy');
  h.spawn('dummy',{pos:[10,8]});
  assert.ok(h.runUntil(()=>h.b.allyUnits.some(u=>u.kind==='token'&&u.alive),2),'the same queued event deploys once a legal target and tile exist');
  const token=h.b.allyUnits.find(u=>u.kind==='token'&&u.alive);
  assert.equal(token.ownerUnit,owner,'the queued token retains its retired source identity');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('warband shield trigger counts five-layer groups without a stack cap',()=>{
  const h=battle([piece('reactor',[event('shieldLayersBroken',{stats:{attackSpeedFlat:10}})]),piece('friend'),piece('outsider',[],[],'炎')]);
  const reactor=h.unit('reactor'),friend=h.unit('friend'),other=h.unit('outsider');
  h.b.emit('shieldLayersBroken',{unit:friend,layers:4});assert.equal(reactor.s.aspd,100);
  const player=friend.ownerId;friend.ownerId='foreign-owner';h.b.emit('shieldLayersBroken',{unit:friend,layers:5});friend.ownerId=player;assert.equal(reactor.s.aspd,100);
  h.catalog.operators[other.defId].nativeFactionTags=['叙拉古'];
  h.b.emit('shieldLayersBroken',{unit:other,layers:5});assert.equal(reactor.s.aspd,110,'matching ally consumes threshold');
  h.b.emit('shieldLayersBroken',{unit:friend,layers:1});assert.equal(reactor.s.aspd,120,'the four earlier matching layers carry across events');
  h.b.emit('shieldLayersBroken',{unit:friend,layers:5});assert.equal(reactor.s.aspd,130);
  h.b.emit('shieldLayersBroken',{unit:friend,layers:5});assert.equal(reactor.s.aspd,140);
});

test('first fallen return copies the configured originals, excluding owner gear/skills/buffs and copied callbacks',()=>{
  const h=battle([piece('raiser',[retirement({buff:undefined,returnFallen:{faction:'叙拉古',count:2,statRatio:.5}})]),piece('owner')]);
  const owner=h.unit('owner'), originals=[];
  const expired=h.b.spawnToken(owner,'expired-before-original',12,9,{def:{stats:{atk:999,maxHp:9999}},kit:{},anySource:true});h.b.retreat(expired,{reason:'expired',permanent:true});
  const broadRange=Array.from({length:19},(_,r)=>Array.from({length:19},(_,c)=>[r,c])).flat();
  for(let i=0;i<3;i++)originals.push(h.b.spawnToken(owner,`original-${i}`,12,3+i,{def:{position:'RANGED',dmgType:'phys',attackKind:'ranged',rangeGrid:broadRange,stats:{atk:20+i,maxHp:200+i,def:9,blockCnt:1},skill:null},kit:{},anySource:true}));
  h.b.addBuff(originals[0],{key:'temporary',mods:{atkPct:9,hpPct:9}});
  for(const token of originals)h.b.kill(token);
  h.spawn('dummy',{pos:[10,8]});h.b.kill(h.unit('raiser'));h.run(.3);
  const returned=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive&&u.mem.warbandOriginalCopy);
  assert.deepEqual(returned.map(u=>u.defId),['original-0','original-1']);
  assert.deepEqual(returned.map(u=>u.base.atk),[10,10]);assert.equal(returned[0].base.maxHp,100);
  assert.ok(returned.every(u=>u.ownerUnit===owner&&u.items.length===0&&!u.def.skill&&Object.keys(u.kit).length===0));
  h.b.redeploy(h.unit('raiser'),{free:true});h.b.kill(h.unit('raiser'));h.run(1);
  assert.deepEqual(h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive&&u.mem.warbandOriginalCopy).map(u=>u.defId),['original-0','original-1','original-0','original-1'],'another action still copies the first two, never the third');
  h.run(45.1);assert.ok(returned.every(u=>u.alive),'generated originals have no artificial lifetime');assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('echo native-action accounting excludes skills and extra attacks and continues beyond the former cap',()=>{
  const echoRule=rule('attack','deathrattleEcho',{faction:'叙拉古',every:2});
  const h=battle([piece('retire',[retirement()]),piece('echo1',[echoRule]),piece('echo2',[echoRule]),piece('target'),piece('foreign',[retirement()],[],'炎')]);
  const enemy=h.spawn('dummy',{pos:[10,8]}),first=h.unit('echo1');
  first.profile.hits=5;attacks(h,first,enemy,1);assert.equal(h.unit('target').s.atk,100);
  first.profile.isSkill=true;attacks(h,first,enemy,10);first.profile.isSkill=false;
  first.mem.independentExtraAttack=true;attacks(h,first,enemy,10);first.mem.independentExtraAttack=false;
  attacks(h,first,enemy,1);assert.equal(Math.round(h.unit('target').s.atk),110);
  attacks(h,first,enemy,30);attacks(h,h.unit('echo2'),enemy,30);assert.ok(h.unit('target').s.atk>160,'echo actions continue beyond the former cap');
  assert.ok(!h.unit('foreign').buffs.some(b=>b.key.includes(':buff:')));
  const actor=h.unit('foreign');actor.ownerId='another-player';
  h.b.emit('shieldLayersBroken',{unit:actor,layers:50});assert.equal(h.b.errorCount,0);
});

test('client engine import closure includes the pure new modules without Node-only dependencies',()=>{
  const queue=[new URL('../../server/modes/independent/session.js',import.meta.url),new URL('../../server/modes/independent/display.js',import.meta.url)],seen=new Set();
  while(queue.length){const url=queue.pop();if(seen.has(url.href))continue;seen.add(url.href);
    if(url.pathname.endsWith('/server/data.js')||url.pathname.endsWith('/server/modes/independent/catalog.js'))continue;
    assert.ok(existsSync(url),`missing ${url.href}`);const source=readFileSync(url,'utf8');
    for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g)){assert.ok(match[1].startsWith('.'),`Node dependency ${url.href} -> ${match[1]}`);queue.push(new URL(match[1],url));}
  }
  for(const suffix of ['/shared/warbandSchema.js','/server/modes/independent/warbandPrep.js','/server/sim/content/independent/warband.js'])assert.ok([...seen].some(url=>url.endsWith(suffix)),suffix);
});

test('new schema rejects malformed keys/triggers/counts/cooldowns and trait summaries expose the authored moments',()=>{
  const good=[retirement(),reaction('badge'),rule('attack','deathrattleEcho',{faction:'叙拉古',every:12}),rule('passive','retirementMultiplier',{extra:2}),event('summon')];
  for(const r of good){assert.equal(validateWarbandRule(r),true);const source={modeEffects:{normal:{prep:r.behavior==='factionReaction'?[r]:[],combat:r.behavior==='factionReaction'?[]:[r]},elite:{prep:[],combat:[]}}};assert.ok(nativeEffectFor('synthetic',source));}
  for(const r of [reaction('badge',{count:0}),event('attack',{cooldownSeconds:.5}),event('attack',{stats:{madeUpMultiplier:.1}}),retirement({perBattle:0}),rule('passive','retirementMultiplier',{extra:3}),{...retirement(),trigger:'hit'}])assert.throws(()=>validateWarbandRule(r));
  assert.equal(TRAIT_WHEN.allyGain,'友方获得时');assert.equal(TRAIT_WHEN.retiring,'退场时');assert.equal(traitSummary({combat:[retirement()]})[0].when,'retiring');
});

test('damaged actor is the allied target and kill actor is the allied killer; foreign-owner/gear victims do not trigger',()=>{
  const h=battle([piece('observer',[event('damaged',{stats:{attackPercent:.1}}),event('kill',{stats:{maxHpPercent:.1}})]),piece('actor'),piece('foreign')]);
  const observer=h.unit('observer'),actor=h.unit('actor'),foreign=h.unit('foreign'),enemy=h.spawn('dummy',{pos:[10,7]});
  h.b.dealDamage(enemy,actor,{amount:10,type:'true'});assert.equal(Math.round(observer.s.atk),110);
  foreign.ownerId='other';h.run(1.1);h.b.dealDamage(enemy,foreign,{amount:10,type:'true'});assert.equal(Math.round(observer.s.atk),110);
  h.b.kill(enemy,actor);assert.equal(Math.round(observer.s.maxHp),1100);
  h.b.emit('kill',{killer:actor,victim:foreign});assert.equal(Math.round(observer.s.maxHp),1100);
});

test('firstWaveStrike accepts its real descriptor and uses the existing strike once after the declared opening delay',()=>{
  const strike=rule('battleStart','firstWaveStrike',{atSecond:1,atkPct:1,type:'arts'});
  const source={modeEffects:{normal:{prep:[],combat:[strike]},elite:{prep:[],combat:[strike]}}};
  assert.equal(nativeEffectFor('strike',source).combat[0].behavior,'firstWaveStrike');
  assert.throws(()=>nativeEffectFor('strike',{modeEffects:{...source.modeEffects,normal:{prep:[],combat:[{...strike,params:{...strike.params,atkPct:-1}}]}}}));
  const h=battle([piece('striker',[strike])]),enemy=h.spawn('dummy',{pos:[10,7]});
  const before=enemy.hp;h.run(1.1);assert.equal(Math.round(before-enemy.hp),100);h.run(2);assert.equal(Math.round(before-enemy.hp),100);
  assert.ok(traitSummary({combat:[strike,retirement()] }).every(x=>x.description&&!x.description.includes('未知')));
});

test('temporary white attack enters atkFlat before existing skill +100%, while damage enters the existing dealt bucket',()=>{
  const h=battle([piece('reactor',[event('damaged',{stats:{baseAttackPercent:.2,damageDealtPercent:.1}})])]);
  const target=h.unit('reactor'),enemy=h.spawn('dummy',{pos:[10,7]});
  h.b.addBuff(target,{key:'original-skill',mods:{atkPct:1},persist:true});assert.equal(target.s.atk,200);
  h.b.dealDamage(enemy,target,{amount:1,type:'true'});assert.equal(target.s.atk,240);
  assert.equal(target.s.dmgDealtMul,1.1);assert.equal(target.base.atk,100);assert.equal(h.pieces[0].equipment.length,0);
  h.run(1.1);h.b.dealDamage(enemy,target,{amount:1,type:'true'});assert.equal(target.s.atk,280);assert.equal(target.s.dmgDealtMul,1.2);
  const r=battle([piece('fallen',[retirement({buff:{faction:'叙拉古',stats:{baseAttackPercent:.2,damageDealtPercent:.1},duration:'battle'}})]),piece('recipient')]);
  r.b.addBuff(r.unit('recipient'),{key:'skill',mods:{atkPct:1},persist:true});r.b.kill(r.unit('fallen'));r.step(1);assert.equal(r.unit('recipient').s.atk,240);assert.equal(r.unit('recipient').s.dmgDealtMul,1.1);
});

test('all reactions benefit every Workshop faction member; self/any-target and any-gain preserve separate scopes',()=>{
  const holder=piece('holder',[],[reaction('badge',{faction:'维多利亚',count:1})],'炎');
  const one=piece('one',[],[],'维多利亚'),two=piece('two',[],[],'维多利亚'),other=piece('other',[],[],'炎'),tin=piece('tin',[],[],'炎'),identity=piece('identity',[],[],'炎');
  identity.equipment=[{id:'identity',quantity:1,state:{faction:'维多利亚'}}];
  const pieces=[holder,one,two,other,tin,identity],{catalog}=catalogFor(pieces);
  catalog.config.tavernFactions=['维多利亚','谢拉格','炎'];catalog.operators[tin.chessId].tavernFactionProxy='ALL';
  catalog.equipment.identity={id:'identity',mechanism:'identityTag',kind:'equipment'};
  const state={round:1,nextUid:1,pieces,inventory:[],funds:0,shop:{slots:[]}};
  const services={catalog,grantEquipment:(s,id,q,x)=>grantEquipment(s,catalog,id,q,x)};
  const badge=p=>(p.equipment||[]).filter(x=>x.id==='precision').reduce((n,x)=>n+x.quantity,0);
  runNativeHook(state,'gain',{piece:one},services);
  assert.deepEqual([one,two,tin,identity].map(badge),[1,1,1,1],'all is not count=1 and Workshop identities participate');
  assert.equal(badge(other),0);assert.equal(badge(holder),0);
  runNativeHook(state,'gain',{piece:identity},services);assert.equal(badge(two),2,'gain source Workshop identity also participates');
  catalog.operators[holder.chessId].nativeTrait.effect.prep=[reaction('badge',{faction:'维多利亚',targets:'self'})];
  runNativeHook(state,'gain',{piece:one},services);assert.equal(badge(holder),1,'neutral holder self growth is allowed');
  catalog.operators[holder.chessId].nativeTrait.effect.prep=[reaction('badge',{faction:'谢拉格',targetFaction:'谢拉格',anyGainFaction:true,targets:'all'})];
  catalog.operators[two.chessId].nativeFactionTags=['谢拉格'];
  runNativeHook(state,'gain',{piece:other},services);assert.equal(badge(two),2,'anyGainFaction still requires a real gain trait');
  catalog.operators[other.chessId].nativeTrait.effect.prep=[rule('gain','grantEquipment',{outputs:[{id:'precision',normal:1,elite:1}]})];
  runNativeHook(state,'gain',{piece:other},services);assert.equal(badge(two),3);assert.equal(badge(one),2,'beneficiary faction stays narrow');
  catalog.operators[holder.chessId].nativeTrait.effect.prep=[reaction('badge',{faction:'维多利亚',targets:'leastEquipment',targetAnyFaction:true,count:1})];
  other.equipment=[];runNativeHook(state,'gain',{piece:one},services);assert.equal(badge(other),1,'explicit any target may choose another faction');
});

test('each broken five-layer group applies immediately without cooldown',()=>{
  const h=battle([piece('reactor',[event('shieldLayersBroken',{stats:{attackSpeedFlat:10}})]),piece('actor')]);
  const reactor=h.unit('reactor'),actor=h.unit('actor');
  h.b.emit('shieldLayersBroken',{unit:actor,layers:10});assert.equal(reactor.s.aspd,120);
  h.b.emit('shieldLayersBroken',{unit:actor,layers:10});assert.equal(reactor.s.aspd,140);
});

test('self-only kill excludes allied actors and Deflect stats continue refreshing broken shields',()=>{
  const h=battle([piece('deflect',[event('summon',{targets:'self',stats:{attackPercent:.04},shieldLayers:2}),event('kill',{selfOnly:true,stats:{maxHpPercent:.1}})]),piece('owner')]);
  const deflect=h.unit('deflect'),owner=h.unit('owner');
  h.b.spawnToken(owner,'one',12,3,{def:{stats:{atk:1,maxHp:1}},kit:{},anySource:true});assert.equal(deflect.s.atk,104);
  const layerBuff=deflect.buffs.find(b=>b.key.includes(':layers:'));assert.equal(layerBuff.shieldHits,2);
  const hitter=h.spawn('dummy',{pos:[10,7]});h.b.dealDamage(hitter,deflect,{amount:100,type:'phys'});h.b.dealDamage(hitter,deflect,{amount:100,type:'phys'});
  assert.equal(deflect.buffs.reduce((n,b)=>n+(b.shieldHits||0),0),0,'real damage consumed both shield layers');
  h.run(1.1);assert.ok(h.b.spawnToken(owner,'two',12,4,{def:{stats:{atk:1,maxHp:1}},kit:{},anySource:true}));
  assert.equal(deflect.s.atk,108);assert.equal(deflect.findBuff(layerBuff.key).shieldHits,2,'later events grant two fresh shields after the first group was consumed');
  const enemy=h.spawn('dummy',{pos:[10,7]});h.b.kill(enemy,owner);assert.equal(deflect.s.maxHp,1000);
  const enemy2=h.spawn('dummy',{pos:[10,7]});h.b.kill(enemy2,deflect);assert.equal(deflect.s.maxHp,1100);
});

test('summoning waits for an enemy and legal tile with no artificial lifetime',()=>{
  const h=battle([piece('maker',[retirement({buff:undefined,summon:{count:2,statRatio:.5}})]),piece('blocker')]);
  const maker=h.unit('maker'),blocked=h.unit('blocker');
  assert.equal(blocked.tileR,maker.tileR);assert.equal(blocked.tileC,maker.tileC+1);
  h.spawn('dummy',{pos:[10,8]});h.b.kill(maker);h.run(.3);const tokens=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive);
  assert.equal(tokens.length,2);assert.ok(tokens.every(t=>!(t.tileR===blocked.tileR&&t.tileC===blocked.tileC)));
  assert.ok(tokens.every(t=>h.b.grid.canStand(t.tileR,t.tileC,{ranged:false})&&h.b.grid.groundPassable(t.tileR,t.tileC,true)));
  assert.ok(tokens.every(t=>h.b.enemiesInKeys(t.rangeKeys,t,t.profile).length>0),'summoned tokens can engage the active enemy');
});

test('summoned tokens inherit their owner Workshop identity and all-faction proxy for event filtering',()=>{
  const owner=piece('owner',[],[],'炎');owner.equipment=[{id:'identity',quantity:1,state:{faction:'叙拉古'}}];
  const observer=piece('observer',[event('summon',{targets:'actor',stats:{baseAttackPercent:.4}})]);
  const pieces=[observer,owner],{catalog,chess}=catalogFor(pieces);catalog.equipment.identity={id:'identity',kind:'equipment',mechanism:'identityTag'};
  catalog.config.tavernFactions=['叙拉古','炎'];
  const h=makeBattle({units:pieces.map((p,i)=>({uid:p.uid,chessId:p.chessId,row:10,col:3+i})),defs:{chess},content:'none',autoFinish:false,extraContent:[b=>installIndependentBattle(b,{catalog,state:{pieces}})]});h.step(1);
  const token=h.b.spawnToken(h.unit('owner'),'proxy-token',12,3,{def:{stats:{atk:10,maxHp:100}},kit:{},anySource:true});assert.equal(token.s.atk,14);
  owner.equipment=[];catalog.operators[owner.chessId].tavernFactionProxy='ALL';
  const second=h.b.spawnToken(h.unit('owner'),'all-token',12,4,{def:{stats:{atk:10,maxHp:100}},kit:{},anySource:true});assert.equal(second.s.atk,14);
});

test('real shield absorption emits all ten broken layers and queued threshold growth reaches two stacks',()=>{
  const h=battle([piece('reactor',[event('shieldLayersBroken',{stats:{attackSpeedFlat:10}})]),piece('shielded')]);
  const target=h.unit('shielded'),reactor=h.unit('reactor'),enemy=h.spawn('dummy',{pos:[10,7]});let broken=0;
  h.b.on('shieldLayersBroken',e=>{if(e.unit===target)broken+=e.layers;});
  h.b.addBuff(target,{key:'ten-shield-layers',shieldHits:10,persist:true,source:reactor});
  for(let i=0;i<10;i++)h.b.dealDamage(enemy,target,{amount:100,type:'phys'});
  assert.equal(broken,10);assert.equal(reactor.s.aspd,120);
});
