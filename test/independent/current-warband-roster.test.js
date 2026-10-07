import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {getData} from '../../server/data.js';
import {getCatalog} from '../../server/modes/independent/catalog.js';
import {runNativeHook} from '../../server/modes/independent/native.js';
import {grantEquipment,recordProduction} from '../../server/modes/independent/equipment.js';
import {pathToFileURL} from 'node:url';
const battleModule=process.env.SP_DATA_DIR?pathToFileURL(resolve(process.env.SP_DATA_DIR,'../server/sim/content/independent/battle.js')).href:'../../server/sim/content/independent/battle.js';
const {installIndependentBattle}=await import(battleModule);
import {tavernFactions} from '../../shared/independentRules.js';
import {DataSource} from '../../server/sim/simdata.js';
import {makeBattle,enemyRec} from '../helpers/battleHarness.js';

const data=getData(),catalog=getCatalog(data);
const groups=[
 ['忍冬','伺夜','德克萨斯','拉普兰德','缄默德克萨斯','巫恋','荒芜拉普兰德'],
 ['耶拉','崖心','银灰','初雪','锏','凛御银灰','圣聆初雪'],
 ['松果','赫默','雷蛇','白面鸮','蛇屠箱','迷迭香','缪尔赛思'],
 ['流星','焰尾','瑕光','锏','玛恩纳','灰毫','耀骑士临光'],
 ['凯瑟琳','刺玫','薄绿','洛洛','号角','安洁莉娜','维娜·维多利亚'],
];
const normal=name=>Object.values(catalog.operators).find(o=>o.name===name&&!o.elite);
test('current source reference, 101-member distribution and thirteen compatible permits agree',()=>{
 const design=JSON.parse(readFileSync(process.env.SP_INDEPENDENT_DESIGN_PATH||new URL('../../data/independent-design.json',import.meta.url),'utf8'));
 const path=process.env.SP_INDEPENDENT_DESIGN_PATH?resolve(dirname(process.env.SP_INDEPENDENT_DESIGN_PATH),'independent-source-reference.json'):new URL('../../data/independent-source-reference.json',import.meta.url);
 const reference=JSON.parse(readFileSync(path,'utf8'));
  const activeIds=new Set(design.rules.activeRosterIds);
  const active=design.operators.filter(o=>activeIds.has(o.chessId));
  assert.equal(active.length,101);assert.equal(reference.lobbyReference.selectedCandidateCount,101);
  const counts=Object.fromEntries([1,2,3,4,5,6].map(t=>[t,active.filter(o=>o.tier===t).length]));
  assert.deepEqual(counts,{1:10,2:19,3:22,4:17,5:18,6:15});
  assert.deepEqual(design.rules.rosterReference.tierCounts,counts,'rosterReference describes the live active pool');
  assert.deepEqual(reference.lobbyReference.tierCounts,{1:11,2:19,3:21,4:18,5:18,6:14},'source-reference keeps its historical 19.2 tier distribution');
 assert.deepEqual(reference.lobbyReference.fixedLobbyTribes,['BEAST','DRAGON','ELEMENTAL','MECHANICAL','PIRATE']);
 assert.deepEqual(active.filter(o=>catalog.operators[o.chessId].permitGearId).map(o=>[o.name,o.tier]).sort(),[['蛇屠箱',4],['赫默',3]]);
 const permits=Object.values(catalog.equipment).filter(e=>e.kind==='permit');assert.equal(permits.length,13);assert.ok(permits.every(e=>e.available));assert.equal(permits.filter(e=>e.legacyOnly).length,11);
});
function roster(names,elite){return names.map((name,i)=>({uid:String(i).padStart(2,'0'),name,chessId:elite?normal(name).eliteChessId:normal(name).chessId,elite,row:10+Math.floor(i/4),col:3+i%4,dir:'RIGHT',moduleId:'none',skillIndex:0,equipment:[],attachments:[],nativeState:{}}));}
function prep(pieces){const state={round:1,nextUid:100,funds:0,pieces,inventory:[],production:[],playerEffects:[],counters:{gained:0},shop:{level:6,slots:[],freeRefreshes:0}};const services={catalog,data,rng:()=>.2,grantEquipment:(s,id,q,x)=>grantEquipment(s,catalog,id,q,x),recordProduction,record(){},addOffer(){},grantChess(){}};return {state,hook:(trigger,piece)=>runNativeHook(state,trigger,{piece},services)};}
const qty=(p,id)=>(p.equipment||[]).filter(e=>e.id===id).reduce((s,e)=>s+e.quantity,0);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function battle(pieces){const source=new DataSource({enemies:{probe:enemyRec({key:'probe',hp:1e9,atk:0,speed:0,def:0,res:0})}},new DataSource(data));const h=makeBattle({data:source,content:'none',units:pieces.map(p=>({...p,kind:'chess'})),autoFinish:false,timeLimit:120,flags:{independent:{catalog,pieces}},extraContent:[b=>installIndependentBattle(b,{catalog,state:{pieces}})]});h.step(1);for(const u of h.b.allyUnits)u.atkCd=1e9;assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));return {...h,by:name=>h.unit(pieces.find(p=>p.name===name).uid)};}
for(const elite of [false,true]){
 const form=elite?'elite':'normal';
 test(`current Siracusa seven ${form}: retirement summons, live multiplier and native attack echo`,()=>{
  const pieces=roster(groups[0],elite),h=battle(pieces),maker=h.by('伺夜'),mama=h.by('缄默德克萨斯'),echo=h.by('德克萨斯');
  let echoes=0;h.b.on('warbandRetiringEffect',e=>{if(e.echo)echoes++;});
  const enemy=h.spawn('probe',{pos:[10,9]});for(let i=0;i<12;i++)h.b.forceAttack(echo,[enemy]);
  assert.equal(echoes,elite?3:2,'one echo enjoys the strongest live Baron');
  h.b.kill(maker);h.step(1);const tokens=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive);assert.ok(tokens.length>=2);
  assert.ok(tokens.some(t=>t.buffs.some(b=>b.key.startsWith(`independent:warband:${mama.uid}:`))),'actual Mama buffs a summoned actor');
  for(let i=0;i<84;i++)h.b.forceAttack(echo,[enemy]);assert.equal(echoes,elite?18:6,'six echo calls at most, each enjoys the strongest multiplier');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
 test(`current Kjerag seven ${form}: cross-faction gain trait, same-tier bodies and five shield breaks`,()=>{
  const pieces=roster(groups[1],elite),{state,hook}=prep(pieces),find=n=>pieces.find(p=>p.name===n),gained=roster(['角峰'],false)[0];gained.uid='gain';state.pieces.push(gained);
  hook('gain',gained);assert.ok(qty(find('银灰'),'precision')>0);assert.ok(qty(find('锏'),'vitality')>0);
  const before=qty(find('锏'),'precision');hook('prepEnd',find('锏'));assert.ok(qty(find('锏'),'precision')>=before+6,'counts friendly operators, not distinct tiers');
  state.pieces.pop();const h=battle(pieces),reactor=h.by('初雪'),beforeAtk=reactor.s.atk;h.b.kill(h.by('圣聆初雪'));h.step(1);
  assert.ok(h.by('银灰').buffs.reduce((s,b)=>s+(b.shieldHits||0),0)>=5);
  h.b.emit('shieldLayersBroken',{unit:h.by('银灰'),layers:4});near(reactor.s.atk,beforeAtk);h.b.emit('shieldLayersBroken',{unit:h.by('银灰'),layers:1});assert.ok(reactor.s.atk>beforeAtk);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
 test(`current Colombia seven ${form}: permanent badges, summon shield and original fallen tokens`,()=>{
  const pieces=roster(groups[2],elite),{hook}=prep(pieces);hook('prepEnd',pieces[3]);assert.ok(pieces.some(p=>qty(p,'precision')>=2));
  const h=battle(pieces),deflect=h.by('雷蛇'),growth=h.by('迷迭香'),before=growth.s.atk;h.b.kill(h.by('松果'));h.step(1);
  const first=h.b.allyUnits.find(u=>u.kind==='token'&&u.alive);assert.ok(first);assert.ok(deflect.buffs.reduce((s,b)=>s+(b.shieldHits||0),0)>=2);assert.ok(growth.s.atk>before);
  const original={atk:first.base.atk,maxHp:first.base.maxHp};h.b.addBuff(first,{key:'probe-temporary',mods:{atkPct:5},persist:true});h.b.kill(first);h.step(1);h.b.kill(h.by('缪尔赛思'));h.step(1);
  const copies=h.b.allyUnits.filter(u=>u.kind==='token'&&u.mem.warbandOriginalCopy);assert.ok(copies.length>0);near(copies[0].base.atk,original.atk);near(copies[0].base.maxHp,original.maxHp);assert.deepEqual(copies[0].items,[]);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
 test(`current Kazimierz seven ${form}: funds refund cap and attack white-stat team growth`,()=>{
  const pieces=roster(groups[3],elite),{state,hook}=prep(pieces),buyer=pieces[0],refund=normal('玛恩纳');const rule=catalog.operators[elite?refund.eliteChessId:refund.chessId].nativeTrait.effect.prep[0];
  for(let i=0;i<20;i++)hook('bought',buyer);assert.equal(state.funds,rule.params.count*rule.params.maxEventsPerPrep);hook('bought',roster(['地灵'],false)[0]);assert.equal(state.funds,rule.params.count*rule.params.maxEventsPerPrep);
  hook('gain',buyer);assert.ok(qty(pieces[1],'precision')>0);
  const h=battle(pieces),actor=h.by('焰尾'),ally=h.by('玛恩纳'),before=ally.s.atk,enemy=h.spawn('probe',{pos:[10,9]});h.b.forceAttack(actor,[enemy]);assert.ok(ally.s.atk>before);assert.ok(actor.buffs.some(b=>b.key.startsWith('independent:warband:')));
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
 test(`current Victoria seven ${form}: all friends, permanent shop carry and tier-scaled front growth`,()=>{
  const pieces=roster(groups[4],elite),{state,hook}=prep(pieces);state.shop.slots=[{kind:'chess',id:normal('薄绿').chessId,equipment:[]},{kind:'chess',id:normal('银灰').chessId,equipment:[]}];
  const gain=pieces[3],gainRule=catalog.operators[gain.chessId].nativeTrait.effect.prep[0],thinRule=catalog.operators[pieces[2].chessId].nativeTrait.effect.prep[0],tierRule=catalog.operators[pieces[6].chessId].nativeTrait.effect.prep[0];
  hook('gain',gain);const total=pieces.reduce((n,p)=>n+qty(p,'precision'),0),friends=pieces.filter(p=>p!==gain&&tavernFactions(p,catalog).includes('维多利亚')).length;
  assert.equal(total,friends*gainRule.params.outputs[0].quantity+thinRule.params.outputs[0].quantity+tierRule.params.outputs[0].quantity*catalog.operators[gain.chessId].tier,'tier-scaled output lands on real bodies');
  assert.ok(pieces.filter(p=>p!==pieces[3]&&tavernFactions(p,catalog).includes('维多利亚')).every(p=>qty(p,'precision')>0),'LoLo benefits every present faction member');
  assert.ok(state.shop.slots[0].equipment.length);assert.equal(state.shop.slots[1].equipment.length,0);assert.ok(state.playerEffects.some(f=>f.type==='shopCarry'&&f.faction==='维多利亚'));
  for(let i=0;i<20;i++)hook('gain',gain);const shopRule=catalog.operators[pieces[5].chessId].nativeTrait.effect.prep[0];assert.equal(state.playerEffects.find(f=>f.type==='shopCarry'&&f.id==='precision').quantity,shopRule.params.outputs[0].quantity*shopRule.params.maxEventsPerPrep,'permanent shop growth obeys the stage cap');
  const horn=pieces[4],front=pieces[5];front.row=horn.row;front.col=horn.col+1;state.counters.gained=3;const before=qty(front,'precision');hook('prepEnd',horn);assert.equal(qty(front,'precision')-before,elite?6:3);
  const h=battle(pieces);assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
}
