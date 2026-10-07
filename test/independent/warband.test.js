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
const retirement=(p={})=>rule('death','retiringEffect',{perBattle:2,buff:{faction:'叙拉古',stats:{attackPercent:.1},duration:'battle'},...p});
const event=(event,more={})=>rule(event==='summon'?'deploy':event,'warbandEvent',{event,faction:'叙拉古',targets:'self',stats:{attackPercent:.1},cooldownSeconds:1,maxStacks:5,...more});
const reaction=(mode,more={})=>rule(mode==='refund'?'bought':mode==='funds'?'sold':mode==='discount'?'gain':'allyGain','factionReaction',{faction:'叙拉古',mode,targets:'all',count:2,outputs:[{id:'precision',quantity:1}],maxEventsPerPrep:2,...more});
const piece=(uid,combat=[],prep=[],faction='叙拉古')=>({uid,chessId:`test_${uid}`,row:10,col:3,dir:'RIGHT',equipment:[],attachments:[],nativeState:{},combat,prep,faction});
function catalogFor(pieces) {
  const operators={},chess={};
  for(const p of pieces) {
    chess[p.chessId]=chessRec({id:p.chessId,skill:null,stats:{atk:100,maxHp:1000,def:100,aspd:100,respawnTime:100,spRecovery:0},rangeGrid:[[0,0],[0,1],[0,2]]});
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

test('gain propagation fires only allyGain; faction shop/refund/badge isolation, tier, per-prep caps and own discount/funds are concrete',()=>{
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
  assert.equal(state.funds,4);assert.equal(state.pendingFunds,undefined);
  state.round++;runNativeHook(state,'bought',{piece:gained},services);assert.equal(state.funds,6);
  const fx=state.playerEffects[0];assert.equal(shopCarryApplies(fx,{id:gained.chessId},catalog),true);assert.equal(shopCarryApplies(fx,{id:outsider.chessId},catalog),false);
  assert.equal(shopCarryApplies({type:'shopCarry'},{id:outsider.chessId},catalog),true,'legacy unfiltered shop buff is compatible');
  holder.prep=[reaction('discount',{targets:'self',count:2}),reaction('funds',{targets:'self',count:3})];catalog.operators[holder.chessId].nativeTrait.effect.prep=holder.prep;
  runNativeHook(state,'gain',{piece:holder},services);runNativeHook(state,'gain',{piece:holder},services);assert.equal(state.shop.upgradePrice,0);
  runNativeHook(state,'sold',{piece:holder},services);assert.equal(state.funds,9);
});

test('native death and retirement count once per deployment, strongest multiplier doubles only retiring actions, echo runs once without loops',()=>{
  const h=battle([piece('fallen',[retirement()]),piece('buffed'),piece('double',[rule('passive','retirementMultiplier',{extra:1})]),piece('weak',[rule('passive','retirementMultiplier',{extra:1})]),piece('echo',[rule('attack','deathrattleEcho',{faction:'叙拉古',every:12,perBattle:3})])]);
  const target=h.unit('buffed'),fallen=h.unit('fallen'),echo=h.unit('echo');const e=h.spawn('dummy',{pos:[10,8]});
  attacks(h,echo,e,12);assert.equal(Math.round(target.s.atk),110,'echo executes one action, not multiplier');
  h.b.retreat(fallen);h.step(1);assert.equal(Math.round(target.s.atk),130,'retreating + death is one retirement multiplied twice');
  h.b.redeploy(fallen,{free:true});fallen.atkCd=1e9;h.b.kill(fallen);h.step(1);assert.equal(Math.round(target.s.atk),150);
  h.b.redeploy(fallen,{free:true});h.b.kill(fallen);h.step(1);assert.equal(Math.round(target.s.atk),150,'real retirement cap is independent of echo');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('retiring summons use free legal tiles; actor Mama stats apply independently and Deflect shields refresh under its own cooldown',()=>{
  const h=battle([piece('maker',[retirement({buff:undefined,summon:{count:2,statRatio:.5,durationSeconds:15}})]),piece('mama',[event('summon',{targets:'actor',stats:{attackPercent:.4,maxHpPercent:.4},maxStacks:1})]),piece('deflect',[event('summon',{targets:'self',stats:{attackPercent:.04},shieldLayers:2,maxStacks:5})])]);
  h.b.kill(h.unit('maker'));h.step(1);
  const tokens=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive);
  assert.equal(tokens.length,2);assert.equal(new Set(tokens.map(t=>`${t.tileR},${t.tileC}`)).size,2);
  for(const token of tokens){assert.equal(Math.round(token.s.atk),70);assert.equal(Math.round(token.s.maxHp),700);assert.deepEqual(token.items,[]);assert.equal(token.kind,'token');assert.ok(!h.b.downOn(token.tileR,token.tileC));}
  const deflect=h.unit('deflect');assert.equal(Math.round(deflect.s.atk),104);assert.equal(deflect.buffs.reduce((n,b)=>n+(b.shieldHits||0),0),2,'two simultaneous summons share self cooldown');
  h.run(1.1);h.b.spawnToken(h.unit('mama'),'fresh',12,9,{def:{stats:{atk:20,maxHp:200},skill:null},kit:{},anySource:true});
  assert.equal(Math.round(deflect.s.atk),108);assert.equal(deflect.buffs.reduce((n,b)=>n+(b.shieldHits||0),0),4);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('warband shield trigger counts each cumulative five broken native-faction layers and independently caps target stacks',()=>{
  const h=battle([piece('reactor',[event('shieldLayersBroken',{targets:'all',stats:{attackSpeedFlat:10},maxStacks:2})]),piece('friend'),piece('outsider',[],[],'炎')]);
  const friend=h.unit('friend'),other=h.unit('outsider');
  h.b.emit('shieldLayersBroken',{unit:friend,layers:4});assert.equal(friend.s.aspd,100);
  const player=friend.ownerId;friend.ownerId='foreign-owner';h.b.emit('shieldLayersBroken',{unit:friend,layers:5});friend.ownerId=player;assert.equal(friend.s.aspd,100);
  other.nativeFactionTags=['叙拉古'];other.mem.faction='叙拉古';
  h.b.emit('shieldLayersBroken',{unit:other,layers:5});assert.equal(friend.s.aspd,100,'other faction does not consume threshold');
  h.b.emit('shieldLayersBroken',{unit:friend,layers:1});assert.equal(friend.s.aspd,110);
  h.run(1.1);h.b.emit('shieldLayersBroken',{unit:friend,layers:5});assert.equal(friend.s.aspd,120);
  h.run(1.1);h.b.emit('shieldLayersBroken',{unit:friend,layers:5});assert.equal(friend.s.aspd,120);
});

test('first fallen return copies only first two original tokens with original base, excluding owner gear/skills/buffs and copied callbacks',()=>{
  const h=battle([piece('raiser',[retirement({buff:undefined,returnFallen:{faction:'叙拉古',count:2,duration:15,statRatio:.5}})]),piece('owner')]);
  const owner=h.unit('owner'), originals=[];
  const expired=h.b.spawnToken(owner,'expired-before-original',12,9,{def:{stats:{atk:999,maxHp:9999}},kit:{},anySource:true});h.b.retreat(expired,{reason:'expired',permanent:true});
  for(let i=0;i<3;i++)originals.push(h.b.spawnToken(owner,`original-${i}`,12,3+i,{def:{stats:{atk:20+i,maxHp:200+i,def:9},skill:null},kit:{},anySource:true}));
  h.b.addBuff(originals[0],{key:'temporary',mods:{atkPct:9,hpPct:9}});
  for(const token of originals)h.b.kill(token);
  h.b.kill(h.unit('raiser'));h.step(1);
  const returned=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive&&u.mem.warbandOriginalCopy);
  assert.deepEqual(returned.map(u=>u.defId),['original-0','original-1']);
  assert.deepEqual(returned.map(u=>u.base.atk),[10,10]);assert.equal(returned[0].base.maxHp,100);
  assert.ok(returned.every(u=>u.ownerUnit===owner&&u.items.length===0&&!u.def.skill&&Object.keys(u.kit).length===0));
  h.b.redeploy(h.unit('raiser'),{free:true});h.b.kill(h.unit('raiser'));h.step(1);
  assert.deepEqual(h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive&&u.mem.warbandOriginalCopy).map(u=>u.defId),['original-0','original-1','original-0','original-1'],'another action still copies the first two, never the third');
  h.run(15.1);assert.ok(returned.every(u=>!u.alive));assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('echo native-action accounting excludes skills and extra attacks, caps each retiring rule at six and rejects forged faction and foreign owner',()=>{
  const echoRule=rule('attack','deathrattleEcho',{faction:'叙拉古',every:2,perBattle:9});
  const h=battle([piece('retire',[retirement()]),piece('echo1',[echoRule]),piece('echo2',[echoRule]),piece('target'),piece('foreign',[retirement()],[],'炎')]);
  const enemy=h.spawn('dummy',{pos:[10,8]}),first=h.unit('echo1');
  first.profile.hits=5;attacks(h,first,enemy,1);assert.equal(h.unit('target').s.atk,100);
  first.profile.isSkill=true;attacks(h,first,enemy,10);first.profile.isSkill=false;
  first.mem.independentExtraAttack=true;attacks(h,first,enemy,10);first.mem.independentExtraAttack=false;
  attacks(h,first,enemy,1);assert.equal(Math.round(h.unit('target').s.atk),110);
  attacks(h,first,enemy,30);attacks(h,h.unit('echo2'),enemy,30);assert.equal(Math.round(h.unit('target').s.atk),160,'six echoes per retiring rule globally across echo holders');
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
  const good=[retirement(),reaction('badge'),rule('attack','deathrattleEcho',{faction:'叙拉古',every:12,perBattle:3}),rule('passive','retirementMultiplier',{extra:2}),event('summon')];
  for(const r of good){assert.equal(validateWarbandRule(r),true);const source={modeEffects:{normal:{prep:r.behavior==='factionReaction'?[r]:[],combat:r.behavior==='factionReaction'?[]:[r]},elite:{prep:[],combat:[]}}};assert.ok(nativeEffectFor('synthetic',source));}
  for(const r of [reaction('badge',{count:0}),event('attack',{cooldownSeconds:.5}),event('attack',{stats:{damageDealtPercent:.1}}),retirement({perBattle:0}),rule('passive','retirementMultiplier',{extra:3}),{...retirement(),trigger:'hit'}])assert.throws(()=>validateWarbandRule(r));
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
