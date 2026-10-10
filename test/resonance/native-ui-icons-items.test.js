import test from 'node:test';
import assert from 'node:assert/strict';
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
import {resonanceNativeItem,resolveResonanceItemIconUrl} from '../../public/js/resonance/itemIconMap.js';
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
 const catalog=getResonanceCatalog(data,{rulesVersion:3,seed:13});
 const packet=resonanceCatalogPacket({data,catalog,displayCatalog:catalog,nativeChessId:(id,star)=>star===1?id:`resonance_${id}_star${star}`});
 const expected=[['灰毫','skchr_ashlok_2'],['白金','skchr_platnm_2'],['令','skchr_ling_3']];
 for(const [name,skillId] of expected){
  const operator=Object.values(catalog.operators).find(row=>row.name===name);
  const record=packet.data.chess[operator.id];
  assert.equal(record.assets.skillIcon,skillId,name);
  assert.equal(skillIconUrl(data.assets,record),data.assets.skills[skillId],name);
 }
});

test('resonance component icons resolve the eight frozen native item icons when the mode packet omits native rows',()=>{
 const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
 const parts={blade:'chess_item_1_01_e_a',staff:'chess_item_3_08_e_a',bow:'chess_item_3_02_e_a',plate:'chess_item_1_02_e_a',cloak:'chess_item_4_04_e_a',belt:'chess_item_3_06_e_a',tear:'chess_item_3_05_e_a',crest:'chess_item_1_04_e_a'};
 const catalog={equipment:Object.fromEntries(Object.keys(parts).map(part=>[part,{name:part}]))};
 for(const [part,id] of Object.entries(parts)){
  const source=data.items[id];assert.ok(source,`frozen native item row ${id}`);
  const url=data.assets.items[source.iconId];assert.ok(url,`manifest icon ${source.iconId}`);
  const resolved=resonanceNativeItem(catalog,part,[]);
  assert.equal(resolved.iconId,source.iconId,`${part} uses its exact source icon identity`);
  assert.equal(resolveResonanceItemIconUrl(catalog,part,[],data.assets),url,`${part} resolves the manifest URL`);
  assert.ok(fs.existsSync(path.join('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public',url)),`${part} asset exists`);
 }
});

test('V3 native pact projection preserves per-tier activation intervals and exact counts',()=>{
 const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
 const catalog=getResonanceCatalog(data,{rulesVersion:3,seed:15});
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
 const state={pieces:[{uid:'p4',equipment:[{itemId:'blade'}]}]},catalog={equipment:{blade:{name:'长刃'}}};
 const stop=mountUnitItemOverlay({view,getState:()=>state,getReplay:()=>null,getCatalog:()=>catalog,document:doc,requestFrame(fn){callback=fn;return 7},cancelFrame(id){cancelled=id}});
 callback(0);const row=nodes[0].children[0];callback(16);assert.equal(updates,1);callback(34);assert.equal(updates,2);assert.equal(nodes[0].children[0],row);
 state.pieces=[];callback(70);assert.equal(row.removed,true);stop();assert.equal(cancelled,7);assert.equal(nodes[0].removed,true);
});

test('equipped icon hover stays a native tooltip while click and right-click open details',()=>{
 const roots=[],documentEvents=new Map(),opened=[];let tick,pieceDragging=false;
 const node=()=>({children:[],listeners:new Map(),style:{setProperty(){}},dataset:{},classList:{toggle(name,value){this[name]=value}},setAttribute(){},addEventListener(name,fn){this.listeners.set(name,fn)},append(child){this.children.push(child)},replaceChildren(){this.children=[]},remove(){},dispatch(name,event={}){this.listeners.get(name)?.(event)}});
 const doc={body:{append(root){roots.push(root)}},head:{append(){}},documentElement:{clientWidth:1440,clientHeight:900},getElementById(){return {}},createElement:node,addEventListener(name,fn){documentEvents.set(name,fn)},removeEventListener(name){documentEvents.delete(name)}};
 const stop=mountUnitItemOverlay({view:{pieceScreenRect(){return {left:300,top:200,right:350,bottom:280,width:50,height:80}}},getState:()=>({pieces:[{uid:'p4',equipment:[{itemId:'blade'}]}]}),getReplay:()=>null,getCatalog:()=>({equipment:{blade:{name:'长刃',description:'攻击力提升'}}}),getDragging:()=>pieceDragging,onDetail:detail=>opened.push(detail),document:doc,requestFrame(fn){tick=fn;return 1},cancelFrame(){}});
 tick(0);const button=roots[0].children[0].children[0];assert.equal(button.title,'长刃：攻击力提升');
 button.dispatch('mouseenter');button.dispatch('mouseover');assert.equal(opened.length,0,'hover cannot open a panel');
 const event={stopPropagation(){},preventDefault(){this.defaultPrevented=true}};
 button.dispatch('click',event);button.dispatch('contextmenu',event);assert.equal(opened.length,2);assert.equal(event.defaultPrevented,true);assert.deepEqual(opened[0],{kind:'item',id:'blade',quality:null,temporary:false,source:'member'});
 documentEvents.get('dragstart')();assert.equal(roots[0].classList['is-dragging'],true);button.dispatch('click',event);assert.equal(opened.length,2);
 documentEvents.get('dragend')();pieceDragging=true;button.dispatch('click',event);assert.equal(opened.length,2);pieceDragging=false;button.dispatch('click',event);assert.equal(opened.length,3);stop();
});
