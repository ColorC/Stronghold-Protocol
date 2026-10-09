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
 ['贾维','伺夜','普罗旺斯','拉普兰德','缄默德克萨斯','巫恋','荒芜拉普兰德'],
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
function battle(pieces,{captureNoisy=false,beforeStart=null,enemyPos=null}={}){const source=new DataSource({enemies:{probe:enemyRec({key:'probe',hp:1e9,atk:0,speed:0,def:0,res:0})}},new DataSource(data));const h=makeBattle({data:source,content:'none',units:pieces.map(p=>({...p,kind:'chess'})),enemies:enemyPos?[{key:'probe',pos:enemyPos}]:[],autoFinish:false,timeLimit:120,flags:{independent:{catalog,pieces}},extraContent:[b=>installIndependentBattle(b,{catalog,state:{pieces}})],captureNoisy});beforeStart?.(h);h.step(1);for(const u of h.b.allyUnits)u.atkCd=1e9;assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));return {...h,by:name=>h.unit(pieces.find(p=>p.name===name).uid)};}
for(const elite of [false,true]){
 const form=elite?'elite':'normal';
 test(`current Siracusa seven ${form}: opening deployments, amplified payloads and Javi attack echo`,()=>{
   const pieces=roster(groups[0],elite),echoPiece=pieces.find(p=>p.name==='贾维');
   const blocker=pieces.find(p=>p.row===echoPiece.row&&p.col===echoPiece.col+1);if(blocker){blocker.row=9;blocker.col=echoPiece.col+1;}
   const h=battle(pieces,{captureNoisy:true}),maker=h.by('伺夜'),wuxian=h.by('巫恋'),echo=h.by('贾维');
   const echoEvents=()=>h.b.independentDarkmoonTrace.filter(e=>e.sourceId==='BGS_078'&&e.kind==='deployEcho').length;
   const copiedPayloads=()=>h.b.independentDarkmoonTrace.filter(e=>e.sourceId!=='BGS_078'&&e.kind==='deployEcho').length;
   const attackEvents=()=>h.hooksOf('attack').filter(e=>e.attacker===echo&&!e.isSkill&&!e.attacker.mem.independentExtraAttack&&!(e.profile?.tags||[]).includes('independentEquipment')).length;
   const opening=h.b.independentDarkmoonTrace;
   assert.ok(opening.some(e=>e.sourceId==='CFM_316'&&e.kind==='deploy'),'CFM_316 resolves from Battle.start without waiting for a death');
   assert.ok(opening.some(e=>e.sourceId==='BGS_018'&&e.kind==='deploy'),'the late-positioned BGS_018 resolves its opening deployment payload');
   const amplified=Object.values(maker.mem.darkmoonTemporaryEquipment||{}).find(x=>x.sourceId==='BGS_018');
   assert.equal(amplified?.attackUnits,5*(elite?2:1)*(elite?3:2),'FP1_031 amplifies the opening deployment payload regardless of roster order');
   assert.ok(h.b.allyUnits.filter(u=>u.kind==='token'&&u.mem.darkmoonSummon).length<=7,'opening summon effects respect the seven-token safety cap');
   const enemy=h.spawn('probe',{pos:[echoPiece.row,echoPiece.col+1]});
   const tile=h.b.grid.tile(echoPiece.row,echoPiece.col+1);assert.ok(tile&&tile.pass!=='NONE','Javi attacks a real enemy on a legal adjacent tile');
   const beforeEcho=echoEvents(),beforeCopied= copiedPayloads();
   h.b.emit('attack',{attacker:echo,targets:[enemy],isSkill:true,profile:{tags:['skill']}});
   assert.equal(echoEvents(),beforeEcho,'a skill attack does not trigger Javi');
   echo.atkCd=0;
   assert.ok(h.runUntil(()=>attackEvents()>=1,10),'actual battle steps produce an ordinary Javi attack');
   const echoes=echoEvents()-beforeEcho;assert.equal(echoes,elite?2:1,'Javi copies a live deployment payload on each eligible proc');
   assert.equal(copiedPayloads()-beforeCopied,elite?6:2,'each copied deployment payload receives the opening FP1_031 multiplier');
   assert.ok(maker.alive,'echoing a deployment payload never kills its source');
   assert.ok(wuxian.alive,'the opening deployment amplifier stays alive during the echo');
  assert.ok(h.runUntil(()=>h.b.allyUnits.some(t=>t.kind==='token'&&t.alive&&t.mem.darkmoonSummon),2),'queued echo summons deploy once their real target and legal tile are available');
   assert.ok(h.runUntil(()=>attackEvents()>=96,110),'the seven-body battle sustains 96 real Javi ordinary attacks');
   assert.equal(attackEvents(),96);assert.equal(echoEvents(),elite?6:3,'ordinary attacks share one per-battle counter and retain the source echo cap');
   assert.equal(copiedPayloads(),(elite?6:3)*(elite?3:2),'every Javi proc copies the deployment payload the amplified number of times');
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
 test(`current Colombia seven ${form}: permanent badges, summon shield and highest-attack original phantoms`,()=>{
  const pieces=roster(groups[2],elite),{hook}=prep(pieces);hook('prepEnd',pieces[3]);assert.ok(pieces.some(p=>qty(p,'precision')>=2));
  const mlyssPiece=pieces.find(p=>catalog.operators[p.chessId]?.sourceRefs?.darkmoon19_2?.id==='BGS_012');assert.ok(mlyssPiece,'the roster contains the current BGS012 source');
  let rankingAtTrigger=null;
  const h=battle(pieces,{beforeStart(harness){
    const emit=harness.b.emit.bind(harness.b);
    harness.b.emit=(name,ctx)=>{
      if(name==='deploy'&&ctx?.unit?.uid===mlyssPiece.uid){
        rankingAtTrigger=harness.b.allyUnits.filter(u=>u.alive&&u.deployed&&u.kind==='op'&&nativeFactions(pieces.find(p=>p.uid===u.uid),catalog).includes('哥伦比亚'))
          .map(u=>({unit:u,atk:u.s.atk,id:u.id,chessId:u.def.raw?.darkmoonNativeChessId||u.defId}))
          .sort((a,b)=>b.atk-a.atk||a.id-b.id);
      }
      return emit(name,ctx);
    };
  }}),deflect=h.by('雷蛇'),growth=h.by('迷迭香'),before=growth.s.atk;
  h.spawn('probe',{pos:[10,18]});
  const shields=u=>u.buffs.reduce((s,b)=>s+(b.shieldHits||0),0);
  h.runUntil(()=>shields(deflect)>=2,2);
  assert.ok(shields(deflect)>=2,'BGS_071 support waits for an active battle target before resolving');
  assert.equal(h.hooksOf('death').length,0,'opening phantom selection does not depend on a death event');
  const mlyssSummons=h.b.independentDarkmoonTrace.filter(e=>e.sourceId==='BGS_012'&&e.kind==='summon');
  const copiedIds=mlyssSummons.flatMap(e=>e.targets),copies=copiedIds.map(uid=>h.unit(uid)).filter(Boolean);
  assert.ok(rankingAtTrigger,'capture current deployed Columbia attack values immediately before BGS012 runs at its actual opening deploy');
  const finalRanking=h.b.allyUnits.filter(u=>u.alive&&u.deployed&&u.kind==='op'&&nativeFactions(pieces.find(p=>p.uid===u.uid),catalog).includes('哥伦比亚')).sort((a,b)=>b.s.atk-a.s.atk||a.id-b.id);
  assert.notDeepEqual(rankingAtTrigger.map(u=>u.chessId),finalRanking.map(u=>u.def.darkmoonNativeChessId||u.def.raw?.darkmoonNativeChessId||u.defId),'later opening deployment payloads can change the attack ranking after BGS012 has already copied its current leaders');
  const expected=rankingAtTrigger.slice(0,elite?4:2).map(u=>u.chessId);
  const actual=copies.map(u=>u.def.darkmoonNativeChessId||u.def.raw?.darkmoonNativeChessId||u.defId);
  assert.deepEqual(actual,expected.slice(0,actual.length),'BGS_012 copies the highest-attack Columbia units in order, including itself when ranked');
  const otherSummons=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive&&u.mem.darkmoonSummon&&!copies.includes(u));
  assert.ok(copies.length<=Math.min(expected.length,Math.max(0,7-otherSummons.length)),'the copied target count respects the remaining seven-token capacity and available legal tiles');
  for(const copy of copies){
    const sourceId=copy.def.darkmoonNativeChessId||copy.def.raw?.darkmoonNativeChessId||copy.defId;
    const source=catalog.operators[sourceId],raw=source?.source?.[elite?'eliteChess':'normalChess']||source?.source?.normalChess;
    assert.ok(raw,'phantom source preserves the correct native body form');
    assert.equal(copy.base.atk,raw.stats.atk,'phantom uses pristine source attack, without inherited badge growth');
    assert.equal(copy.base.maxHp,raw.stats.maxHp,'phantom uses pristine source health, without inherited badge growth');
    assert.deepEqual(copy.items,[],'phantom does not inherit worn equipment');
  }
  assert.ok(h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive&&u.mem.darkmoonSummon).length<=7,'actual initial summons respect the seven-token safety cap');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
 });
  test(`current Kazimierz seven ${form}: Battlecry and end-of-prep growth`,()=>{
   const pieces=roster(groups[3],elite),{state,hook}=prep(pieces),man=pieces.find(p=>p.name==='玛恩纳'),manRule=catalog.operators[man.chessId].nativeTrait.effect.prep.find(r=>r.behavior==='darkmoonEndTurnGrowth');
   const sameFaction=pieces.filter(p=>nativeFactions(p,catalog).includes(manRule.params.faction)).length,per=elite?manRule.params.attackPer.elite:manRule.params.attackPer.normal;
   hook('prepEnd',man);const [attackBadge,secondaryBadge]=darkmoonGrowthBadges(man,catalog);assert.equal(qty(man,attackBadge),sameFaction*per,'Maanen scales by current same-faction bodies on the field');assert.equal(qty(man,secondaryBadge),sameFaction*per,'the source grants the fixed damage badge');
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
