import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const ranged={id:'independent-native-ranged',name:'native ranged',profession:'SNIPER',attackKind:'RANGED',position:'RANGED',dmgType:'phys',groundOnly:true,canHitFly:false,rangeGrid:[[0,0],[0,1]],stats:{maxHp:100,atk:10,def:0,res:0,aspd:100,bat:1,blockCnt:0}};
const ownerDef=chessRec({id:'engagement-owner',name:'owner',skill:null,stats:{cost:0,atk:20,maxHp:500,def:0,bat:1},rangeGrid:[[0,0],[0,1]]});
const enemy=enemyRec({key:'engagement-enemy',hp:5000,atk:0,speed:0});
function fixture({marker=false}={}) {
  const units=[{uid:'owner',chessId:'engagement-owner',row:10,col:3}];
  if(marker)units.push({uid:'marker',kind:'token',tokenId:ranged.id,def:ranged,ownerUid:'owner',row:10,col:5,independentSummon:true});
  const h=makeBattle({defs:{chess:{'engagement-owner':ownerDef},enemies:{probe:enemy},tokens:{[ranged.id]:ranged}},units,flags:{independent:true},content:'none',autoFinish:false});
  return h;
}

test('fixed native marker waits off-field then deploys once at its original tile when its real range can hit',()=>{
  const h=fixture({marker:true});let deployed=[];h.b.on('deploy',ctx=>{if(ctx.unit.uid==='marker')deployed.push(ctx.unit);});h.run(.2);
  const marker=h.b.units.find(u=>u.uid==='marker');assert.ok(marker);assert.equal(marker.alive,false);assert.equal(marker.deployed,false);assert.equal(deployed.length,0);assert.equal(h.b._deploy(marker,{initial:true}),true,'pending marker reports accepted so owner logic cannot create a duplicate');
  h.spawn('probe',{pos:[10,6]});h.run(.2);assert.equal(marker.alive,true);assert.equal(marker.deployed,true);assert.deepEqual([marker.tileR,marker.tileC],[10,5]);assert.equal(deployed.length,1);assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('native auto spawn returns its pending unit, retries into its own attack range, and starts hp/duration on arrival',()=>{
  const h=fixture();h.run(.1);const owner=h.unit('owner');let installs=0;
  const token=h.b.spawnToken(owner,ranged.id,10,4,{hp:25,duration:.5,kit:{install(){installs++;}}});
  assert.ok(token);assert.equal(token.alive,false);assert.equal(token.deployed,false);assert.equal(token.mem.nativeEngagementPending,true);assert.equal(installs,1);h.run(.2);assert.equal(token.alive,false);
  const target=h.spawn('probe',{pos:[10,8]});target.motion='FLY';h.run(.2);assert.equal(token.alive,false,'own range rejects an enemy the token cannot hit');
  target.motion='GROUND';h.run(.2);assert.equal(token.alive,true);assert.equal(token.deployed,true);assert.equal(token.hp,25);assert.ok(h.b.enemiesInKeys(token.rangeKeys,token,token.profile).includes(target),"retry chooses a tile inside the token actual range");assert.equal(installs,1);
  h.run(.25);assert.equal(token.alive,true,'duration has only partly elapsed after actual deployment');h.run(.35);assert.equal(token.alive,false,'duration expires after actual deployment');assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('auto native request remains queued while all tiles are reserved and releases without installing twice',()=>{
  const h=fixture();h.run(.1);const owner=h.unit('owner');const reserved=h.b.isReservedTile.bind(h.b);h.b.isReservedTile=()=>true;let installs=0;
  const token=h.b.spawnToken(owner,ranged.id,10,4,{kit:{install(){installs++;}}});assert.ok(token);assert.equal(token.alive,false);h.spawn('probe',{pos:[10,8]});h.run(.3);assert.equal(token.alive,false);
  h.b.isReservedTile=reserved;h.run(.3);assert.equal(token.alive,true);assert.equal(installs,1);assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('non-independent auto spawn keeps immediate legacy behavior',()=>{
  const h=fixture();h.b.flags.independent=false;h.run(.1);const owner=h.unit('owner');const token=h.b.spawnToken(owner,ranged.id,10,4);assert.ok(token);assert.equal(token.alive,true);assert.equal(token.deployed,true);
});

test('support native summon needs an active enemy but not an attackable target',()=>{
  const h=fixture();h.run(.1);const owner=h.unit('owner');const token=h.b.spawnToken(owner,ranged.id,10,4);assert.ok(token);token.profile={...token.profile,noAttack:true};
  const enemy=h.spawn('probe',{pos:[10,10]});enemy.motion='FLY';enemy.hidden=true;h.run(.2);assert.equal(token.deployed,true,'support tokens release when any active enemy exists');assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});

test('fixed marker waits while owner is away and deploys once after owner returns',()=>{
  const h=fixture({marker:true});let count=0;h.b.on('deploy',ctx=>{if(ctx.unit.uid==='marker')count++;});h.run(.2);const owner=h.unit('owner'),marker=h.b.units.find(u=>u.uid==='marker');h.b.retreat(owner);h.spawn('probe',{pos:[10,6]});h.run(.3);assert.equal(marker.deployed,false);assert.equal(count,0);assert.equal(h.b._deploy(owner),true);h.run(.2);assert.equal(marker.deployed,true);assert.deepEqual([marker.tileR,marker.tileC],[10,5]);assert.equal(count,1);
});

test('pending auto request is released when its owner leaves before engagement',()=>{
  const h=fixture();h.run(.1);const owner=h.unit('owner'),token=h.b.spawnToken(owner,ranged.id,10,4);assert.ok(token);assert.equal(token.deployed,false);h.b.retreat(owner);h.run(.2);assert.equal(token.removed,true);assert.equal(token.deployed,false);
});

test('real Vigil wolf waits for a blockable same-tile target and previews its authored shadow block without installing a probe kit',()=>{
  const h=makeBattle({units:[{uid:'vigil',chessId:'chess_char_3_19_a',row:10,col:3}],flags:{independent:true},content:'full',autoFinish:false});
  h.run(.2);
  const owner=h.unit('vigil');
  const wolf=h.b.units.find(u=>u.defId==='token_10028_vigil_wolf');
  assert.ok(wolf,'the real operator kit creates its native wolf');
  assert.equal(wolf.alive,false,'no-target native wolf remains off field');
  assert.equal(wolf.def.stats.blockCnt,0,'the token source has no base block');
  assert.equal(wolf.s.blockCnt,0,'previewing must not setup or install a probe kit');
  const [r,c]=[wolf.tileR,wolf.tileC];
  const target=h.spawn('probe',{pos:[r,c]});target.speed=0;h.run(.2);
  assert.equal(wolf.alive,true,'the wolf deploys at its fixed marker once its real block trait can engage');
  assert.equal(wolf.s.blockCnt,2,'deployment applies the authored initial two wolf shadows');
  assert.deepEqual([wolf.tileR,wolf.tileC],[r,c]);
  assert.ok(owner.trait.reinforcement===wolf,'owner keeps the single returned wolf reference');
  assert.equal(h.b.errorCount,0,JSON.stringify(h.b.errors));
});
