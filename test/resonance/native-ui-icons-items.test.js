import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import fs from 'node:fs';
import path from 'node:path';
import {getSeasonCampaignCatalog} from '../../tools/resonance/balance-campaign.mjs';
import {resonanceDisplayCatalog} from '../../server/modes/resonance/display.js';
import {resolveOperatorSkillIcon} from '../../public/js/resonance/operatorSkillIcon.js';
import {equippedUnitItems,mountUnitItemOverlay} from '../../public/js/resonance/unitItems.js';
import {pactTierSummary} from '../../public/js/resonance/pactTierSummary.js';
import {pactCurrentTier,pactTierStatus,pactTierStatusLabel,nativeStripTier} from '../../public/js/resonance/pactTierState.js';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {resonanceCatalogPacket} from '../../server/modes/resonance/native-match.js';
import {skillIconUrl} from '../../public/js/ui/assetUrls.js';
import {NATIVE_ICON_BY_EQUIPMENT_ID,RESONANCE_ITEM_ICON_IDS,SOURCE_GEAR_ICON_IDS,resonanceItemPactId,resonanceNativeItem,resolveResonanceItemIconUrl} from '../../public/js/resonance/itemIconMap.js';
import {resonanceContent} from '../../shared/resonance/catalog.js';
import {specialBoardTile} from '../../public/js/resonance/specialEntityPlacement.js';

test('every projected fixed skill uses its native identity and an existing icon',()=>{
 const catalog=getSeasonCampaignCatalog(1),display=resonanceDisplayCatalog(catalog);let skills=0,active=0;
 for(const [id,operator] of Object.entries(display.operators)){
  const native=catalog.operators[id].stars[1].record.skill,icon=resolveOperatorSkillIcon(operator);
  if(!native){assert.equal(icon.url,null);continue;}
  assert.equal(icon.skillId,native.skillId,id);assert.equal(icon.iconId,native.iconId,id);
  assert(fs.existsSync(path.join('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public',icon.url)),id);skills++;
  if(catalog.config.activeOperatorIds.includes(id))active++;
 }
 assert.equal(Object.keys(display.operators).length,154);assert.equal(skills,153);assert.equal(active,65);
});

test('native resonance shop packet resolves the selected fixed skill icon from its actual chess record',()=>{
 const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
 assert.equal(Object.keys(data.assets.items).length,59,'all frozen manifest item icons are available for lookup');
 const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:13});
 const packet=resonanceCatalogPacket({data,catalog,displayCatalog:catalog,nativeChessId:(id,star)=>star===1?id:`resonance_${id}_star${star}`});
 const expected=[['灰毫','skchr_ashlok_2'],['白金','skchr_platnm_2'],['令','skchr_ling_3']];
 for(const [name,skillId] of expected){
  const operator=Object.values(catalog.operators).find(row=>row.name===name);
  const record=packet.data.chess[operator.id];
  assert.equal(record.assets.skillIcon,skillId,name);
  assert.equal(skillIconUrl(data.assets,record),data.assets.skills[skillId],name);
 }
});

test('faction-season Judgement icon is a scoped passive-support presentation, not a fabricated skill',()=>{
 const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
 const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:'resonance-factions-1',seed:19});
 const operator=Object.values(catalog.operators).find(row=>row.charId==='char_4000_jnight');
 assert.equal(operator.fixedSkillId,'resonance_judgement_support');
 assert.equal(operator.stars[1].record.skill,null,'the native robot has no active skill');
 const httpDisplay=resonanceDisplayCatalog(catalog,data).operators[operator.id];
 assert.equal(httpDisplay.stars[1].skill,null);
 assert.equal(httpDisplay.passivePresentation.kind,'passive-support','HTTP/library display uses the same mode projection');
 const packet=resonanceCatalogPacket({data,catalog,displayCatalog:catalog,nativeChessId:(id,star)=>star===1?id:`resonance_${id}_star${star}`});
 const presentation=packet.catalog.operators[operator.id].passivePresentation;
 assert.deepEqual(presentation,httpDisplay.passivePresentation,'packet and HTTP display share one presentation definition');
 assert.deepEqual({kind:presentation.kind,icon:presentation.icon,label:presentation.label},
  {kind:'passive-support',icon:'support',label:'被动支援'});
 assert.equal(presentation.description,'无需施放主动技能。');
 assert.equal(packet.catalog.operators[operator.id].stars[1].skill,null,'presentation does not populate the skill slot');
 const chess=packet.data.chess[operator.id];
 assert.equal(chess.skill,null,'native packet keeps the actual skill absent');
 assert.deepEqual(chess.passivePresentation,presentation,'native chess records carry the same mode presentation');
 assert.equal(chess.assets.resonancePresentationIcon,'support');
 assert.equal(chess.assets.skillIcon,null,'support art is not disguised as a skill asset id');
 const resolved=resolveOperatorSkillIcon(packet.catalog.operators[operator.id]);
 assert.equal(resolved.url,'/assets/ui/garrisonTypeIcon/icon_support.png');
 assert.equal(resolved.skillId,null);assert.equal(resolved.iconId,null);
 assert.equal(skillIconUrl(data.assets,chess),data.assets.ui['garrisonTypeIcon/icon_support']);
 assert.equal(fs.existsSync(path.join('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public',resolved.url)),true);
 const other=Object.values(packet.catalog.operators).find(row=>row.charId!=='char_4000_jnight');
 assert.equal(other.passivePresentation,undefined,'presentation does not leak to other operators');
});

test('all eight Resonance components and 28 completed recipes use distinct frozen Native item art',()=>{
 const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
 const entries=Object.entries(resonanceContent.equipment);
 const components=entries.filter(([,record])=>record.kind==='component').map(([id])=>id);
 const finished=entries.filter(([,record])=>record.kind==='completed').map(([id])=>id);
 assert.equal(components.length,8);assert.equal(finished.length,28);
 assert.deepEqual(new Set(components),new Set(['blade','staff','bow','plate','cloak','belt','tear','crest']));
 assert.equal(Object.keys(RESONANCE_ITEM_ICON_IDS).length,36);
 const componentIcons=new Set(components.map(id=>RESONANCE_ITEM_ICON_IDS[id]));
 const finishedIcons=finished.map(id=>RESONANCE_ITEM_ICON_IDS[id]);
 assert.equal(new Set(finishedIcons).size,28,'every completed recipe has its own artwork');
 for(const id of [...components,...finished]){
  const iconId=RESONANCE_ITEM_ICON_IDS[id];assert.ok(iconId,`explicit Native artwork mapping for ${id}`);
  assert.equal(NATIVE_ICON_BY_EQUIPMENT_ID[id],iconId,`${id} is present in the exported mode map`);
  const url=data.assets.items[iconId];assert.ok(url,`manifest icon ${iconId}`);
  const catalog={equipment:{[id]:resonanceContent.equipment[id]}};
  const resolved=resonanceNativeItem(catalog,id,[]);
  assert.equal(resolved.iconId,iconId,`${id} uses its exact Native artwork identity`);
  assert.equal(resolveResonanceItemIconUrl(catalog,id,[],data.assets),url,`${id} resolves the manifest URL`);
  assert.ok(fs.existsSync(path.join('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public',url)),`${id} asset exists`);
 }
 for(const id of finished)assert.ok(!componentIcons.has(RESONANCE_ITEM_ICON_IDS[id]),`${id} does not borrow component artwork`);
});

test('source gear uses explicit existing completed-item art and transfers resolve to pact art',()=>{
 const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
 assert.equal(Object.keys(SOURCE_GEAR_ICON_IDS).length,7);
 for(const [id,iconId] of Object.entries(SOURCE_GEAR_ICON_IDS)){
  assert.ok(data.assets.items[iconId],`${id} icon is present in the frozen manifest`);
  assert.ok(resolveResonanceItemIconUrl({equipment:{[id]:{name:id}}},id,[],data.assets),`${id} has a nonempty artwork URL`);
 }
 const catalog={equipment:{transfer_arts:{kind:'emblem',effects:[{kind:'transfer_pact',params:{pactId:'arts'}}]}}};
 assert.equal(resonanceItemPactId(catalog,'transfer_arts'),'arts');
 assert.equal(resonanceNativeItem(catalog,'transfer_arts',[]),null,'emblems use their pact icon, not generic equipment art');
});

test('V3 native pact projection preserves per-tier activation intervals and exact counts',()=>{
 const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
 const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:15});
 const display=resonanceDisplayCatalog(catalog,data),emissary=display.pacts.emissary;
 assert.deepEqual(emissary.exactCounts,[1,4]);
 assert.deepEqual(emissary.levels.map(({minUnits,maxUnits,exactCounts})=>({minUnits,maxUnits,exactCounts})),[
  {minUnits:1,maxUnits:1,exactCounts:[1]},
  {minUnits:4,maxUnits:4,exactCounts:[4]},
 ]);
 assert.deepEqual(display.environments,{});
 assert.ok(Object.values(display.pacts).some(pact=>pact.levels.some(level=>level.sourceVariables?.PercentDamageTakenHeal!==undefined)));
});

test('historical equipped icons cannot borrow current member equipment',()=>{
 const state={pieces:[{uid:'p4',equipment:[{itemId:'blade'},{itemId:'bow'},{itemId:'belt'},{itemId:'tear'}]}]};
 assert.deepEqual(equippedUnitItems(state,null)[0].items,[{itemId:'blade'},{itemId:'bow'},{itemId:'belt'}]);
 const replay={field:{units:[{id:12,uid:'p4',kind:'op',side:'ally',items:['staff']},{id:13,kind:'enemy',side:'enemy',items:['cloak']}]}};
 assert.deepEqual(equippedUnitItems(state,replay)[0].items,[{itemId:'staff'}]);
 assert.equal(equippedUnitItems(state,{field:{units:[]}}).length,0);
 assert.equal(equippedUnitItems({pieces:[]},null).length,0);
});

test('native Resonance equipped icons resolve through the server-provided native UID',()=>{
 const rows=equippedUnitItems({pieces:[{uid:'session-piece-u42',nativeUid:39,equipment:[{itemId:'blade'}]}]},null);
 assert.equal(rows[0].key,'prep:session-piece-u42');
 assert.equal(rows[0].screenUid,39);
 assert.deepEqual(rows[0].items,[{itemId:'blade'}]);
 const live=equippedUnitItems({pieces:[{uid:'session-piece-u42',nativeUid:39,equipment:[{itemId:'blade'}]}]},null,[{uid:39,unitId:81,items:['staff']}]);
 assert.deepEqual(live,[{key:'battle:39',screenUid:39,alternateUid:81,items:[{itemId:'staff'}],historical:false}], 'battle overlay follows live runner equipment and current unit ids');
 assert.deepEqual(equippedUnitItems({pieces:[{uid:'session-piece-u42',nativeUid:39,equipment:[{itemId:'blade'}]}]},null,[]),[], 'an empty live battle does not borrow prep equipment');
 const temporary=equippedUnitItems({pieces:[{uid:'p1',nativeUid:39,equipment:[{itemId:'component'}]}]},null,[{uid:39,unitId:81,items:[{itemId:'finished',quality:'radiant',isTemporary:true,sourceTraitId:'rhodes'}]}]);
 assert.deepEqual(temporary[0].items,[{itemId:'finished',quality:'radiant',isTemporary:true,sourceTraitId:'rhodes'}], 'live Scrap projection shows battle-local completed gear instead of the persisted source component');
});

test('prototype pact tier labels use that tier numeric values instead of repeating the full trait template',()=>{
 const low=pactTierSummary('creation',{TriggerNumCrystals:20,MagicDamage:150,ConversionDamagePct:.25,Resists:20,'{source}':1});
 const high=pactTierSummary('creation',{TriggerNumCrystals:20,MagicDamage:800,ConversionDamagePct:.25,Resists:100});
 assert.equal(low,'每20枚晶体 · 爆发150点术法伤害 · 转化25%累计伤害 · 双抗评分+20');
 assert.equal(high,'每20枚晶体 · 爆发800点术法伤害 · 转化25%累计伤害 · 双抗评分+100');
 assert.notEqual(low,high);
 assert.equal(low.includes('{source}'),false);
});

test('all reached pact tiers stay reached while only the highest is current; exact tiers remain inactive between counts',()=>{
 const levels=[{minUnits:2,maxUnits:3},{minUnits:4,maxUnits:5},{minUnits:6,maxUnits:25000}];
 assert.deepEqual(levels.map(level=>pactTierStatus(level,6)),['reached','reached','reached']);
 assert.equal(pactCurrentTier(levels,6),levels[2]);
 const exact=[{minUnits:1,maxUnits:1,exactCounts:[1]},{minUnits:4,maxUnits:4,exactCounts:[4]}];
 assert.deepEqual(exact.map(level=>pactTierStatus(level,2)),['inactive','inactive']);
 assert.equal(pactTierStatusLabel(exact[0],2),'未激活：需恰好1人');
 assert.equal(pactCurrentTier(exact,2),null);
});

test('native BondStrip exact tiers stay inactive at counts 2, 3 and 5',()=>{
 const emissary=[{minUnits:1,maxUnits:1,exactCounts:[1]},{minUnits:4,maxUnits:4,exactCounts:[4]}];
 for(const count of [2,3,5])assert.deepEqual(nativeStripTier({count,activeThreshold:0},emissary),{active:false,tier:0});
 assert.deepEqual(nativeStripTier({count:1,activeThreshold:1},emissary),{active:true,tier:1});
 assert.deepEqual(nativeStripTier({count:4,activeThreshold:4},emissary),{active:true,tier:2});
 const ordinary=[{minUnits:2,maxUnits:3},{minUnits:4,maxUnits:6}];
 assert.deepEqual(nativeStripTier({count:6,activeThreshold:4},ordinary),{active:true,tier:2});
});

test('training dummy drag targets resolve only native own-board deployment cells',()=>{
 const view={tileScreen(row,col){const x=col*20,y=row*20;return{x,y,poly:[[x-8,y-8],[x+8,y-8],[x+8,y+8],[x-8,y+8]]}}};
 assert.deepEqual(specialBoardTile(view,100,200),{row:10,col:5});
 assert.equal(specialBoardTile(view,100,160),null,'other rows cannot be used as own deploy cells');
 assert.equal(specialBoardTile(view,20,200),null,'outside deployment columns are rejected');
});

test('overlay keeps stable DOM rows, bounds updates to30Hz and cancels its lifecycle',()=>{
 const nodes=[];let callback,cancelled=null,updates=0;
 const node=()=>({children:[],style:{setProperty(){},set transform(v){updates++}},dataset:{},classList:{toggle(){}},setAttribute(){},addEventListener(){},append(x){this.children.push(x)},replaceChildren(){this.children=[]},remove(){this.removed=true}});
 const doc={body:{append(x){nodes.push(x)}},head:{append(){}},documentElement:{clientWidth:1440,clientHeight:900},getElementById(){return {}},createElement:node,addEventListener(){},removeEventListener(){}};
 const view={pieceScreenRect(){return {left:400,top:300,right:460,bottom:390,width:60,height:90}}};
 const state={pieces:[{uid:'p4',equipment:[{itemId:'blade'}]}]},catalog={equipment:{blade:{name:'维式重锤'}}};
 const stop=mountUnitItemOverlay({view,getState:()=>state,getReplay:()=>null,getCatalog:()=>catalog,document:doc,requestFrame(fn){callback=fn;return 7},cancelFrame(id){cancelled=id}});
 callback(0);const row=nodes[0].children[0];callback(16);assert.equal(updates,1);callback(34);assert.equal(updates,2);assert.equal(nodes[0].children[0],row);
 state.pieces=[];callback(70);assert.equal(row.removed,true);stop();assert.equal(cancelled,7);assert.equal(nodes[0].removed,true);
});

test('equipped icon hover stays a native tooltip while click and right-click open details',()=>{
 const roots=[],documentEvents=new Map(),opened=[];let tick,pieceDragging=false;
 const node=()=>({children:[],listeners:new Map(),style:{setProperty(){}},dataset:{},classList:{toggle(name,value){this[name]=value}},setAttribute(){},addEventListener(name,fn){this.listeners.set(name,fn)},append(child){this.children.push(child)},replaceChildren(){this.children=[]},remove(){},dispatch(name,event={}){this.listeners.get(name)?.(event)}});
 const doc={body:{append(root){roots.push(root)}},head:{append(){}},documentElement:{clientWidth:1440,clientHeight:900},getElementById(){return {}},createElement:node,addEventListener(name,fn){documentEvents.set(name,fn)},removeEventListener(name){documentEvents.delete(name)}};
 const stop=mountUnitItemOverlay({view:{pieceScreenRect(){return {left:300,top:200,right:350,bottom:280,width:50,height:80}}},getState:()=>({pieces:[{uid:'p4',equipment:[{itemId:'blade'}]}]}),getReplay:()=>null,getCatalog:()=>({equipment:{blade:{name:'维式重锤',description:'攻击力+15%'}}}),getDragging:()=>pieceDragging,onDetail:detail=>opened.push(detail),document:doc,requestFrame(fn){tick=fn;return 1},cancelFrame(){}});
 tick(0);const button=roots[0].children[0].children[0];assert.equal(button.title,'维式重锤：攻击力+15%');
 button.dispatch('mouseenter');button.dispatch('mouseover');assert.equal(opened.length,0,'hover cannot open a panel');
 const event={stopPropagation(){},preventDefault(){this.defaultPrevented=true}};
 button.dispatch('click',event);button.dispatch('contextmenu',event);assert.equal(opened.length,2);assert.equal(event.defaultPrevented,true);assert.deepEqual(opened[0],{kind:'item',id:'blade',quality:null,temporary:false,source:'member'});
 documentEvents.get('dragstart')();assert.equal(roots[0].classList['is-dragging'],true);button.dispatch('click',event);assert.equal(opened.length,2);
 documentEvents.get('dragend')();pieceDragging=true;button.dispatch('click',event);assert.equal(opened.length,2);pieceDragging=false;button.dispatch('click',event);assert.equal(opened.length,3);stop();
});
