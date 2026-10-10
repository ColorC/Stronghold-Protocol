import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {getSeasonCampaignCatalog} from '../../tools/resonance/balance-campaign.mjs';
import {resonanceDisplayCatalog} from '../../server/modes/resonance/display.js';
import {resolveOperatorSkillIcon} from '../../public/js/resonance/operatorSkillIcon.js';
import {equippedUnitItems,mountUnitItemOverlay} from '../../public/js/resonance/unitItems.js';

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

test('historical equipped icons cannot borrow current member equipment',()=>{
 const state={pieces:[{uid:'p4',equipment:[{itemId:'blade'},{itemId:'bow'},{itemId:'belt'},{itemId:'tear'}]}]};
 assert.deepEqual(equippedUnitItems(state,null)[0].items,['blade','bow','belt']);
 const replay={field:{units:[{id:12,uid:'p4',kind:'op',side:'ally',items:['staff']},{id:13,kind:'enemy',side:'enemy',items:['cloak']}]}};
 assert.deepEqual(equippedUnitItems(state,replay)[0].items,['staff']);
 assert.equal(equippedUnitItems(state,{field:{units:[]}}).length,0);
 assert.equal(equippedUnitItems({pieces:[]},null).length,0);
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
 button.dispatch('click',event);button.dispatch('contextmenu',event);assert.equal(opened.length,2);assert.equal(event.defaultPrevented,true);assert.deepEqual(opened[0],{kind:'item',id:'blade',source:'member'});
 documentEvents.get('dragstart')();assert.equal(roots[0].classList['is-dragging'],true);button.dispatch('click',event);assert.equal(opened.length,2);
 documentEvents.get('dragend')();pieceDragging=true;button.dispatch('click',event);assert.equal(opened.length,2);pieceDragging=false;button.dispatch('click',event);assert.equal(opened.length,3);stop();
});
