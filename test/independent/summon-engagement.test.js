import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { findSummonTile, summonWhenEngageable, tileFree, tokenCanEngageAt } from '../../server/sim/content/tokens.js';

const tokenDef={id:'engaging-probe',name:'接敌探针',profession:'WARRIOR',attackKind:'RANGED',position:'RANGED',dmgType:'phys',groundOnly:true,canHitFly:false,rangeGrid:Array.from({length:19},(_,r)=>Array.from({length:19},(_,c)=>[r,c])).flat(),stats:{maxHp:100,atk:10,def:0,res:0,aspd:100,bat:1,blockCnt:0}};
function fixture(){
  const h=makeBattle({defs:{chess:{owner:chessRec({id:'owner',name:'owner',skill:null,stats:{cost:0,atk:20,maxHp:500,def:0,bat:1},rangeGrid:[[0,0],[0,1],[0,2]]})},enemies:{probe:enemyRec({key:'probe',hp:5000,atk:0,speed:0})}},units:[{uid:'owner',chessId:'owner',row:10,col:5}],content:'none',autoFinish:false});
  h.run(.2);return h;
}

test('a summon request waits without enemies and releases after a target enters its real range',()=>{
  const h=fixture(),owner=h.unit('owner');
  assert.equal(summonWhenEngageable(h.b,owner,tokenDef.id,tokenDef),null);
  assert.equal(h.b.allyUnits.filter(u=>u.kind==='token').length,0);
  h.spawn('probe',{pos:[10,8]});h.run(.2);
  const token=h.b.allyUnits.find(u=>u.kind==='token');
  assert.ok(token,'pending request deploys when its real range includes an active enemy');
  assert.ok(h.b.enemiesInKeys(token.rangeKeys,token,token.profile).length>0);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('the engagement probe rejects targets the token cannot hit',()=>{
  const h=fixture(),owner=h.unit('owner');
  h.spawn('probe',{pos:[10,8]});
  h.enemies()[0].motion='FLY';
  summonWhenEngageable(h.b,owner,tokenDef.id,tokenDef);
  h.run(.3);
  assert.equal(h.b.allyUnits.filter(u=>u.kind==='token').length,0,'ground-only profile keeps waiting for a legal target');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('melee blockers may deploy on the enemy tile they must block, while ally/body occupancy remains unavailable',()=>{
  const h=fixture(),owner=h.unit('owner');h.spawn('probe',{pos:[10,8]});
  const blocker={id:'same-cell-blocker',name:'同格阻挡探针',profession:'WARRIOR',attackKind:'MELEE',position:'MELEE',dmgType:'phys',rangeGrid:[[0,0]],stats:{maxHp:100,atk:10,blockCnt:1}};
  assert.equal(tileFree(h.b,10,8),true,'enemy occupancy does not make an ally deployment tile unavailable');
  assert.equal(tokenCanEngageAt(h.b,owner,blocker,10,8),true,'a blocker can acquire a ground enemy on its own tile');
  assert.deepEqual(findSummonTile(h.b,owner,'near',{allBoard:true,melee:true,canUseTile:(r,c)=>tokenCanEngageAt(h.b,owner,blocker,r,c)}),[10,8]);
  assert.equal(tileFree(h.b,10,5),false,'a living ally still occupies its tile');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('engagement checks do not install kits, add units, hooks or mutate enemy blockers',()=>{
  const h=fixture(),owner=h.unit('owner');h.spawn('probe',{pos:[10,8]});
  const enemy=h.enemies()[0],units=h.b.units.length,blocked=enemy.blockedBy,blocking=owner.blocking.slice();
  const hooks=Object.entries(h.b._hooks).map(([key,value])=>[key,Array.isArray(value)?value.length:Object.keys(value||{}).length]);
  for(let c=4;c<12;c++)tokenCanEngageAt(h.b,owner,tokenDef,10,c);
  assert.equal(h.b.units.length,units);assert.equal(enemy.blockedBy,blocked);assert.deepEqual(owner.blocking,blocking);
  assert.deepEqual(Object.entries(h.b._hooks).map(([key,value])=>[key,Array.isArray(value)?value.length:Object.keys(value||{}).length]),hooks);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('a failed placement retries and event-source requests may outlive their inactive owner',()=>{
  const h=fixture(),owner=h.unit('owner');h.spawn('probe',{pos:[10,8]});
  let calls=0;const spawn=tile=>{calls++;if(calls===1)return null;return h.b.spawnToken(owner,tokenDef.id,tile[0],tile[1],{def:tokenDef,anySource:true});};
  summonWhenEngageable(h.b,owner,tokenDef.id,tokenDef,{onDeploy:spawn});h.run(.5);
  assert.equal(calls,2,'failed deployment leaves the request queued');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('an explicitly retained event-source request can deploy after its source owner dies',()=>{
  const h=fixture(),owner=h.unit('owner');
  const reserved=h.b.isReservedTile.bind(h.b);h.b.isReservedTile=()=>true;
  summonWhenEngageable(h.b,owner,tokenDef.id,tokenDef,{allowInactiveOwner:true});
  h.b.retreat(owner,{permanent:true});owner.deploySeq++;h.spawn('probe',{pos:[10,8]});h.b.isReservedTile=reserved;h.runUntil(()=>h.b.allyUnits.some(u=>u.kind==='token'&&u.alive),1);
  assert.equal(h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive).length,1);
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('pending requests survive a full board and exceed the former token and lifetime caps',()=>{
  const h=fixture(),owner=h.unit('owner');
  const isReserved=h.b.isReservedTile.bind(h.b);
  h.b.isReservedTile=()=>true;
  for(let i=0;i<10;i++)assert.equal(summonWhenEngageable(h.b,owner,tokenDef.id,tokenDef),null);
  h.spawn('probe',{pos:[10,8]});h.run(.3);
  assert.equal(h.b.allyUnits.filter(u=>u.kind==='token').length,0,'requests wait while no legal tile exists');
  h.b.isReservedTile=isReserved;h.run(.7);
  const tokens=h.b.allyUnits.filter(u=>u.kind==='token'&&u.alive);
  assert.equal(tokens.length,10,'all separate requests release; no live-count cap is imposed');
  h.run(45.1);
  assert.ok(tokens.every(u=>u.alive),'Workshop-generated tokens do not expire at an artificial lifetime');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});
