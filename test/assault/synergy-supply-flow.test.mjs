import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,applyAction,reconcileSupplyPreview} from '../../shared/assault/run.js';
import {loadAssaultDesign} from '../../server/modes/assault/data.js';
import {loadAssaultRuntime} from '../helpers/assaultRuntime.js';
const ctx={catalog:loadAssaultRuntime(),design:loadAssaultDesign()};
const run=seed=>createRun({runId:`supply-${seed}`,seed,directorId:ctx.design.system.directors[0].id},ctx);
const act=(state,type,params={})=>applyAction(state,{type,...params,opId:`${state.revision}:${type}`,expectedRevision:state.revision},ctx).state;

test('supply previews offer exactly one merchant, a free event, and a direct free reward',()=>{
  let general=0;
  for(let seed=1;seed<=100;seed++) {
    const state=run(seed);
    assert.deepEqual(state.nodes.map(n=>n.kind),['shop','event','reward']);
    const event=ctx.design.events.events.find(e=>e.id===state.nodes[1].eventId);
    assert.ok(event.choices.some(c=>!c.costs?.length&&c.outcomes.some(o=>o.effects.length>0)));
    if(state.nodes.some(n=>ctx.design.system.shopDefinitions.some(s=>s.id===n.shopId&&!s.kind&&s.filter.type==='none')))general++;
  }
  assert.ok(general>50,'general merchants retain the higher random weight');
});

test('even after exhausting unique events the last-day supply preview retains two free alternatives',()=>{
  const state=run(77);state.day=10;state.hour=5;state.visitedEvents=ctx.design.events.events.map(e=>e.id);
  const next=act(state,'rerollNodes');
  assert.deepEqual(next.nodes.map(n=>n.kind),['shop','event','reward']);
  assert.equal(next.nodes[1].eventId,'evt_rogue1_rest');
  assert.equal(act(next,'selectNode',{nodeId:next.nodes[1].id}).phase,'event');
});

test('direct rewards are free, grant the advertised resource once, and advance one hour',()=>{
 const seen=new Set();
 for(let seed=1;seed<=100&&seen.size<3;seed++) {
  let state=run(seed);state.life=10;state=act(state,'rerollNodes');
  const node=state.nodes.find(n=>n.kind==='reward');seen.add(node.reward.kind);
  const action={type:'selectNode',nodeId:node.id,opId:`claim:${seed}`,expectedRevision:state.revision};
  const {state:next}=applyAction(state,action,ctx);
  assert.equal(next.hour,state.hour+1);
  assert.equal(next.gold,state.gold+(node.reward.kind==='gold'?node.reward.amount:0));
  assert.equal(next.xp,state.xp+ctx.design.system.run.xpPerHour+(node.reward.kind==='xp'?node.reward.amount:0));
  assert.equal(next.life,state.life+(node.reward.kind==='hp'?node.reward.amount:0));
  assert.deepEqual(applyAction(next,action,ctx).state,next);
 }
 assert.equal(seen.size,3);
});
test('node reroll costs once, changes the merchants, survives resume, and refuses a second reroll',()=>{
  const state=run(9),before=structuredClone(state);
  const action={type:'rerollNodes',opId:'reroll-once',expectedRevision:state.revision};
  const packet=applyAction(state,action,ctx),next=packet.state;
  assert.equal(next.gold,state.gold-2);assert.equal(next.nodeRerollCount,1);
  assert.notDeepEqual(next.nodes.map(n=>n.shopId),state.nodes.map(n=>n.shopId));
  assert.deepEqual(applyAction(next,action,ctx).state,next);
  assert.deepEqual(state,before);
  const resumed=JSON.parse(JSON.stringify(next));
  assert.throws(()=>act(resumed,'rerollNodes'),{code:'NODE_REROLL_LIMIT'});
  assert.deepEqual(resumed,next);
});
test('legacy supply preview migration preserves RNG, gold, XP, inventory and already selected battles',()=>{
  const state=run(17);state.nodes[1]={id:'legacy-risk',kind:'battle',encounterId:'enc_band1_risk_m04'};
  state.nodeChoices=structuredClone(state.nodes);
  const before=structuredClone(state);
  assert.equal(reconcileSupplyPreview(state,ctx),true);
  for(const key of ['rngState','gold','xp','pieces'])assert.deepEqual(state[key],before[key]);
  assert.equal(state.nodes.some(n=>n.kind==='battle'),false);
  assert.deepEqual(state.nodes.map(n=>n.kind),['shop','event','reward']);
  assert.equal(reconcileSupplyPreview(state,ctx),false);
  const selected={...before,phase:'battle'};assert.equal(reconcileSupplyPreview(selected,ctx),false);
  assert.deepEqual(selected.nodes,before.nodes);
});

test('an old three-shop preview migrates without spending gold or random draws',()=>{
 const state=run(18);state.nodes=Array.from({length:3},(_,i)=>({...state.nodes[0],id:`oldshop:${i}`}));
 const before=structuredClone(state);assert.equal(reconcileSupplyPreview(state,ctx),true);
 assert.deepEqual(state.nodes.map(n=>n.kind),['shop','event','reward']);
 for(const key of ['rngState','gold','xp','pieces'])assert.deepEqual(state[key],before[key]);
});
