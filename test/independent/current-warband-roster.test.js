import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {getData} from '../../server/data.js';
import {getCatalog} from '../../server/modes/independent/catalog.js';
import {runNativeHook} from '../../server/modes/independent/native.js';
import {grantEquipment,recordProduction} from '../../server/modes/independent/equipment.js';
import {darkmoonGrowthBadges} from '../../server/modes/independent/darkmoonShop.js';
import {pathToFileURL} from 'node:url';
const battleModule=process.env.SP_DATA_DIR?pathToFileURL(resolve(process.env.SP_DATA_DIR,'../server/sim/content/independent/battle.js')).href:'../../server/sim/content/independent/battle.js';
const {installIndependentBattle}=await import(battleModule);
import {nativeFactions,tavernFactions} from '../../shared/independentRules.js';
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
function battle(pieces,{captureNoisy=false}={}){const source=new DataSource({enemies:{probe:enemyRec({key:'probe',hp:1e9,atk:0,speed:0,def:0,res:0})}},new DataSource(data));const h=makeBattle({data:source,content:'none',units:pieces.map(p=>({...p,kind:'chess'})),autoFinish:false,timeLimit:120,flags:{independent:{catalog,pieces}},extraContent:[b=>installIndependentBattle(b,{catalog,state:{pieces}})],captureNoisy});h.step(1);for(const u of h.b.allyUnits)u.atkCd=1e9;assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));return {...h,by:name=>h.unit(pieces.find(p=>p.name===name).uid)};}
for(const elite of [false,true]){
 const form=elite?'elite':'normal';
 test(`current Siracusa seven ${form}: retirement summons, live multiplier and native attack echo`,()=>{
   const pieces=roster(groups[0],elite),echoPiece=pieces.find(p=>p.name==='德克萨斯');
   const blocker=pieces.find(p=>p.row===echoPiece.row&&p.col===echoPiece.col+1);if(blocker){blocker.row=9;blocker.col=echoPiece.col+1;}
   const h=battle(pieces,{captureNoisy:true}),maker=h.by('伺夜'),baron=h.by('荒芜拉普兰德'),echo=h.by('德克萨斯');
   const echoed=()=>h.b.independentDarkmoonTrace.filter(e=>e.sourceId==='CFM_316'&&e.kind==='retireEcho').length;
   const attackEvents=()=>h.hooksOf('attack').filter(e=>e.attacker===echo&&!e.isSkill&&!e.attacker.mem.independentExtraAttack&&!(e.profile?.tags||[]).includes('independentEquipment')).length;
   const enemy=h.spawn('probe',{pos:[echoPiece.row,echoPiece.col+1]});
   const tile=h.b.grid.tile(echoPiece.row,echoPiece.col+1);assert.ok(tile&&tile.pass!=='NONE','Texas attacks a real enemy on a legal adjacent tile');
   h.b.emit('attack',{attacker:echo,targets:[enemy],isSkill:true,profile:{tags:['skill']}});
   echo.atkCd=0;
   const every=elite?8:12;
   assert.ok(h.runUntil(()=>attackEvents()>=every-1,20),'actual battle steps produce ordinary native attacks');
   assert.equal(attackEvents(),every-1);assert.equal(echoed(),0,'a skill-tagged event does not advance Texas native-attack counter');
   assert.ok(h.runUntil(()=>attackEvents()>=every,5),'the next actual ordinary attack crosses Texas threshold');
   const echoes=echoed();assert.equal(echoes,elite?3:2,'Texas triggers every 12 normal or 8 elite native attacks, then uses the live Baron multiplier');
   assert.ok(maker.alive,'echoing a retirement never kills its source');
   assert.ok(baron.alive,'the retirement multiplier must stay alive during the echo');
   assert.ok(h.b.allyUnits.some(t=>t.kind==='token'&&t.alive&&t.mem.darkmoonSummon),'echo summons through the normal temporary-token path');
   assert.ok(h.runUntil(()=>attackEvents()>=96,110),'the seven-body battle sustains 96 real Texas ordinary attacks');
   assert.equal(attackEvents(),96);assert.equal(echoed(),elite?18:6,'ordinary attacks share one per-battle counter across the battle and retain the source echo cap');
   h.b.kill(maker);h.step(1);assert.ok(h.b.independentDarkmoonTrace.some(e=>e.sourceId==='CFM_316'&&e.sourceUid===maker.uid&&e.kind==='retire'),'the same source still resolves its real death through the natural retirement path');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
 test(`current Kjerag seven ${form}: cross-faction gain trait, same-tier bodies and five shield breaks`,()=>{
  const pieces=roster(groups[1],elite),{state,hook}=prep(pieces),find=n=>pieces.find(p=>p.name===n),gained=roster(['角峰'],false)[0];gained.uid='gain';state.pieces.push(gained);
  hook('gain',gained);assert.ok(qty(find('银灰'),'precision')>0);assert.ok(qty(find('锏'),'vitality')>0);
  const before=qty(find('锏'),'precision');hook('prepEnd',find('锏'));assert.ok(qty(find('锏'),'precision')>=before+6,'counts friendly operators, not distinct tiers');
   state.pieces.pop();const h=battle(pieces),reactor=h.by('初雪'),beforeAtk=reactor.s.atk;h.b.kill(h.by('圣聆初雪'));h.step(1);
   const shields=u=>u.buffs.reduce((s,b)=>s+(b.shieldHits||0),0);
   assert.ok(shields(h.by('锏'))>=5,'BGS_040 retirement targets current Kazimierz allies');assert.equal(shields(h.by('银灰')),0,'BGS_040 does not misdirect its shield to the old Kjerag recipient');
   const silverash=h.by('银灰'),enemy=h.spawn('probe',{pos:[10,9]});h.b.addBuff(silverash,{key:'fixture-kjerag-shield',shieldHits:5,persist:true,allowDead:true});
   for(let i=0;i<5;i++)h.b.dealDamage(enemy,silverash,{amount:100,type:'phys'});h.step(.1);
   assert.equal(shields(silverash),0,'five actual hits consume the five setup shield layers');assert.ok(reactor.s.atk>beforeAtk,'current BGS_067 reacts after real shield consumption');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
 test(`current Colombia seven ${form}: permanent badges, summon shield and original fallen tokens`,()=>{
  const pieces=roster(groups[2],elite),{hook}=prep(pieces);hook('prepEnd',pieces[3]);assert.ok(pieces.some(p=>qty(p,'precision')>=2));
  const h=battle(pieces),deflect=h.by('雷蛇'),growth=h.by('迷迭香'),before=growth.s.atk;h.b.kill(h.by('松果'));h.step(1);
  const first=h.b.allyUnits.find(u=>u.kind==='token'&&u.alive);assert.ok(first);assert.ok(deflect.buffs.reduce((s,b)=>s+(b.shieldHits||0),0)>=2);assert.ok(growth.s.atk>before);
  const original={atk:first.base.atk,maxHp:first.base.maxHp};h.b.addBuff(first,{key:'probe-temporary',mods:{atkPct:5},persist:true});h.b.kill(first);h.step(1);h.b.kill(h.by('缪尔赛思'));h.step(1);
  const sourceCopies=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive&&u.uid?.startsWith('darkmoon-copy:')&&u.mem.darkmoonSummon);
  const copiedOriginal=sourceCopies.find(u=>u.defId==='token_tactician_reinforce'&&u.base.atk===original.atk&&u.base.maxHp===original.maxHp);
  const mlyssSummons=h.b.independentDarkmoonTrace.filter(e=>e.sourceId==='BGS_012'&&e.kind==='summon');
  assert.ok(copiedOriginal,JSON.stringify({original,sourceCopies:sourceCopies.map(u=>({uid:u.uid,defId:u.defId,rawSource:u.def.raw?.darkmoonNativeChessId,atk:u.base.atk,hp:u.base.maxHp,items:u.items})),mlyssSummons,trace:h.b.independentDarkmoonTrace,errors:h.b.errors}));
  assert.ok(mlyssSummons.some(e=>e.targets.includes(copiedOriginal.uid)),'BGS_012 summoned the source-native projection');assert.deepEqual(copiedOriginal.items,[]);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
  test(`current Kazimierz seven ${form}: Battlecry and end-of-prep growth`,()=>{
   const pieces=roster(groups[3],elite),{state,hook}=prep(pieces),man=pieces.find(p=>p.name==='玛恩纳'),manRule=catalog.operators[man.chessId].nativeTrait.effect.prep.find(r=>r.behavior==='darkmoonEndTurnGrowth');
   const sameFaction=pieces.filter(p=>nativeFactions(p,catalog).includes(manRule.params.faction)).length,per=elite?manRule.params.attackPer.elite:manRule.params.attackPer.normal;
   hook('prepEnd',man);const [attackBadge,secondaryBadge]=darkmoonGrowthBadges(man,catalog);assert.equal(qty(man,attackBadge),sameFaction*per,'Maanen scales by current same-faction bodies on the field');assert.equal(qty(man,secondaryBadge),sameFaction*per,'the source grants the profession-appropriate secondary badge');
   const h=battle(pieces);assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
  test(`current Victoria seven ${form}: Battlecry, buying and native attack effects`,()=>{
   const pieces=roster(groups[4],elite),{state,hook}=prep(pieces),thin=pieces[2],lolo=pieces[3],angelina=pieces[5];
   const thinRule=catalog.operators[thin.chessId].nativeTrait.effect.prep.find(r=>r.behavior==='darkmoonBattlecryFactionGrowth'),battlecry=normal('录武官');
   assert.ok(catalog.operators[battlecry.chessId].sourceRefs?.darkmoon19_2?.battlecry,'fixture source has a 19.2 Battlecry identity');const gained={uid:'gained-battlecry',chessId:battlecry.chessId,elite:false,row:9,col:3,equipment:[],attachments:[],nativeState:{}};state.pieces.push(gained);
   const targets=pieces.filter(p=>p.uid!==thin.uid&&nativeFactions(p,catalog).includes(thinRule.params.faction)),before=new Map(targets.map(p=>[p.uid,qty(p,'precision')])),thinCount=elite?thinRule.params.count.elite??thinRule.params.count:thinRule.params.count.normal??thinRule.params.count;
   hook('gain',gained);for(const p of targets)assert.equal(qty(p,'precision')-before.get(p.uid),thinCount,`BGS_053 grows each current ${thinRule.params.faction} recipient`);
   const loloRule=catalog.operators[lolo.chessId].nativeTrait.effect.prep.find(r=>r.behavior==='darkmoonBoughtSelfGrowth'),loloBefore=qty(lolo,'precision'),victoriaBuyer=pieces[6];hook('bought',victoriaBuyer);
   assert.equal(qty(lolo,'precision')-loloBefore,elite?loloRule.params.attackUnits.elite:loloRule.params.attackUnits.normal,'buying an eligible Victoria body grows LoLo directly');
   state.shop.slots=[{kind:'chess',id:normal('惊蛰').chessId,equipment:[]},{kind:'chess',id:normal('银灰').chessId,equipment:[]}];const flameBuyer=roster(['惊蛰'],false)[0];flameBuyer.uid='buyer-flame';hook('bought',flameBuyer);
   const angelinaRule=catalog.operators[angelina.chessId].nativeTrait.effect.prep.find(r=>r.behavior==='darkmoonShopGrowth');
   assert.ok(state.playerEffects.some(f=>f.type==='darkmoonShopGrowth'&&f.sourceId==='BGS_104'&&f.faction==='炎'),'Angelina adds persistent shop growth only after buying an eligible elemental');
   assert.deepEqual(state.shop.slots[0].darkmoonGrowth,{attack:angelinaRule.params.attack,health:angelinaRule.params.health});assert.equal(state.shop.slots[1].darkmoonGrowth,undefined,'unmatched shop bodies do not receive the growth');
   const h=battle(pieces),actor=h.by('维娜·维多利亚'),enemy=h.spawn('probe',{pos:[10,9]}),beforeAttack=actor.s.atk;h.b.forceAttack(actor,[enemy]);
   assert.ok(actor.s.atk>beforeAttack,'the real Victoria native attack resolves its temporary growth');
   assert.ok(h.b.independentDarkmoonTrace.some(e=>e.sourceId==='BGS_056'&&e.kind==='event'&&e.targets.includes(actor.uid)),'BGS_056 reacts to a qualifying actor attack');
   assert.ok(h.b.independentDarkmoonTrace.some(e=>e.sourceId==='BGS_047'&&e.kind==='event'&&e.targets.includes(h.by('号角').uid)),'BGS_047 grows the team on a real Victoria attack');
   assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
}
