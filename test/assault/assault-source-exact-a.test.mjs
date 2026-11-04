import test from 'node:test';import assert from 'node:assert/strict';
import {getAssaultData,loadAssaultDesign}from '../../server/modes/assault/data.js';
import {prepareAssaultBattle,createAssaultBattle}from '../../server/modes/assault/battle.js';
import {assaultKits}from '../../server/sim/content/assault/cards/assault.js';
import {buildAssaultBattleInput,makeChessRecords}from '../../shared/assault/battle-input.js';
import {Battle}from '../../server/sim/Battle.js';
import {DataSource}from '../../server/sim/simdata.js';
import {absoluteRangeKeys}from '../../server/sim/targeting.js';
import {ROWS,COLS}from '../../server/sim/constants.js';
const data=getAssaultData(),design=loadAssaultDesign();
function fixture(charId,rank,extra=[],moduleId=null){const body=data.runtime.bodies[charId],pieces=[{id:charId,col:3},...extra].map((x,i)=>{const b=data.runtime.bodies[x.id],selected=i===0?moduleId:null;return{uid:'exact:'+i+':'+x.id,charId:x.id,purchaseCharId:b.purchaseCharId,star:rank,row:x.row??9,col:x.col,dir:'RIGHT',sourceCopies:1,moduleId:selected,moduleChoices:{[x.id]:selected},permanentFlat:{},permanentPercent:{},tagEdits:{add:[],remove:[]},claimed:[],summonPresets:[]};});const source=design.encounters.encounters.find(e=>e.kind==='normal'),encounter={...source,wave:{...source.wave,dp:{...source.wave.dp,init:99}}};const prepared=prepareAssaultBattle({seed:88000+rank,life:20,day:1,hour:1,pieces,nextBattleEffects:[]},encounter,{...data,design}),battle=createAssaultBattle(prepared,{...data,design,kits:assaultKits});battle.start();battle.assaultRuntime.flush();return{battle,unit:battle.allyUnits.find(u=>u.uid===pieces[0].uid),allies:pieces.slice(1).map(p=>battle.allyUnits.find(u=>u.uid===p.uid)),body};}
function enemy(f,col=4){const e=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[9,col],mods:{hpMul:1000,speed:0}});f.battle.applyStatus(e,'stun',{duration:40});f.battle._buildEnemyIndex();return e;}
function cast(f){f.unit.skill.charges=1;f.unit.skill.sp=f.unit.skill.spCost;assert.equal(f.battle.assaultRuntime.cast(f.unit,{force:true}),true);f.battle.assaultRuntime.flush();}
function clock(f,seconds){const until=f.battle.time+seconds;for(let n=0;n<1200&&f.battle.time<until;n++)f.battle.step();assert(f.battle.time>=until,'finite native clock reached requested time');}
function moveOutside(f,unit){assert(unit.alive&&unit.deployed,'actual ally is deployed before its legal move');let moved=false;for(let r=0;r<ROWS&&!moved;r++)for(let c=0;c<COLS&&!moved;c++)if(f.battle.grid.inRect(r,c)&&f.battle.grid.isLow(r,c)&&f.battle.grid.blockable(r,c)&&f.battle.onOwnBoard(unit.player,r,c)&&Math.max(Math.abs(r-f.unit.tileR),Math.abs(c-f.unit.tileC))>=2)moved=f.battle.relocate(unit,r,c);assert(moved,'native own-board relocation reaches a real tile outside the neighborhood');}
function close(actual,expected,label){assert(Math.abs(actual-expected)<1e-5,`${label}: ${actual} != ${expected}`);}
function ownerScope(charId,rank,sameId='char_127_estell',foreignId='char_127_estell'){
  const piece=(uid,id,row,col)=>({uid,charId:id,purchaseCharId:data.runtime.bodies[id].purchaseCharId,star:rank,row,col,dir:'RIGHT',sourceCopies:1,moduleId:null,moduleChoices:{[id]:null},permanentFlat:{},permanentPercent:{},tagEdits:{add:[],remove:[]},claimed:[],summonPresets:[]});
  const own=[piece('scope-caster',charId,9,3),piece('scope-own',sameId,9,4)],foreign=[piece('scope-foreign',foreignId,10,3)],source=design.encounters.encounters.find(e=>e.kind==='normal'),encounter={...source,wave:{...source.wave,dp:{...source.wave.dp,init:99}}};
  const prepared=prepareAssaultBattle({seed:88200+rank,life:20,day:1,hour:1,pieces:[...own,...foreign],nextBattleEffects:[]},encounter,{...data,design}),built=buildAssaultBattleInput(prepared,{...data,kits:assaultKits});
  const left=makeChessRecords(data.runtime,own,[],{},prepared.input,'left'),right=makeChessRecords(data.runtime,foreign,[],{},prepared.input,'right');
  const nativeData=new DataSource({...built.data,chess:{...left.chess,...right.chess}}),battle=new Battle({...built.battle,data:nativeData,players:[{playerId:'left',seat:0,side:'L',coords:'board',units:left.units,bonds:{}},{playerId:'right',seat:0,side:'L',coords:'board',units:right.units,bonds:{}}],logger:{warn(){},error(){},info(){},log(){}}});
  battle.start();battle.assaultRuntime.flush();const unit=battle.allyUnits.find(u=>u.uid==='scope-caster'),same=battle.allyUnits.find(u=>u.uid==='scope-own'),other=battle.allyUnits.find(u=>u.uid==='scope-foreign');
  assert(unit?.alive&&unit.deployed&&same?.alive&&same.deployed&&other?.alive&&other.deployed,'all three native owner records deploy legally');assert.equal(same.ownerId,unit.ownerId);assert.notEqual(other.ownerId,unit.ownerId);return{battle,unit,same,other};
}
for(const rank of [3,4]){
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}
for(const rank of [3,4]){
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}
for(const rank of [3,4]){
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
  for(const id of ['char_308_swire','char_265_sophia'])test(`exact-a ${id} R${rank} skill excludes a real foreign owner and its team gain naturally expires`,{timeout:30000},()=>{
    const f=ownerScope(id,rank),sameAtk=f.same.s.atk,sameDef=f.same.s.def,sameAspd=f.same.s.aspd,ownAtk=f.unit.s.atk,foreignStats={atk:f.other.s.atk,def:f.other.s.def,aspd:f.other.s.aspd};cast(f);
    if(id==='char_308_swire')close(f.same.s.atk-sameAtk,f.same.base.atk*[.3,.35][rank-3],'own nearby melee target gets exact skill ATK');
    else{close(f.same.s.def-sameDef,f.same.base.def*[.16,.2][rank-3],'own three-block target gets exact skill DEF');close(f.same.s.aspd-sameAspd,[8,10][rank-3],'own target gets exact ASPD');}
    assert.deepEqual({atk:f.other.s.atk,def:f.other.s.def,aspd:f.other.s.aspd},foreignStats,'an actual separate player recipient gains none of this skill');
    for(const unit of [f.unit,f.same,f.other]){f.battle.applyStatus(unit,'stun',{duration:25});f.battle.addBuff(unit,{key:'exact:scope-survival',flags:{invulnerable:true},duration:25});}
    enemy(f,15);clock(f,id==='char_308_swire'?15.05:20.05);close(f.same.s.atk,sameAtk,'own ATK returns to the preserved pre-skill state');close(f.same.s.def,sameDef,'own DEF returns after native expiry');close(f.same.s.aspd,sameAspd,'own ASPD returns after native expiry');close(f.unit.s.atk,ownAtk,'caster own ATK also expires');assert.equal(f.battle.errors.length,0);
  });
}
for(const rank of [3,4]){
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

const naturalEntryIds = ['char_127_estell','char_337_utage','char_491_humus','char_237_gravel','char_308_swire','char_265_sophia','char_154_morgan','char_155_tiger','char_140_whitew','char_294_ayer'];
for (const rank of [3, 4]) for (const charId of naturalEntryIds) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

function nextControlled(f, duration = 70) { for (const u of [f.unit, ...f.allies]) f.battle.addBuff(u, { key: 'exact-next:controlled', flags: { disarm: true, noSp: true, invulnerable: true }, duration }); }
for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

for(const rank of [3,4]) test('exact-next Mlynar R'+rank+' naturally casts on the single native extension cell and restores its ordinary attack range',{timeout:30000},()=>{
  const f=fixture('char_4064_mlynar',rank),base=[...f.unit.rangeKeys],baseSet=new Set(base),extended=absoluteRangeKeys(f.unit.rangeGrid,f.unit.tileR,f.unit.tileC,f.unit.dir,f.unit.s.rangeExtend+1);
  const key=extended.find(k=>!baseSet.has(k)&&f.battle.grid.inRect(Math.floor(k/COLS),k%COLS)&&f.battle.grid.isLow(Math.floor(k/COLS),k%COLS));assert.notEqual(key,undefined,'native extension has a real legal enemy cell');
  const e=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[Math.floor(key/COLS),key%COLS],mods:{hpMul:1000,speed:0}});assert(e);assert(!baseSet.has(e.tileR*COLS+e.tileC));f.battle.applyStatus(e,'stun',{duration:40});f.battle._buildEnemyIndex();
  f.battle.addBuff(f.unit,{key:'exact-next:no-normal',flags:{disarm:true},duration:10});const hp=e.hp,atk=f.unit.s.atk;assert(f.unit.skill.gainSp(f.unit.skill.spCost-f.unit.skill.sp,'fixture-ready')>0);clock(f,.05);
  assert.equal(f.unit.skill.activations,1,'the real full-SP readiness uses the same expanded source range');close(hp-e.hp,Math.max(atk*[1.7,1.8][rank-3]-e.s.def,atk*[1.7,1.8][rank-3]*.05),'the edge target actually takes the fixed strike');assert.deepEqual([...f.unit.rangeKeys],base,'the instantaneous extension does not change ordinary attack geometry');assert.equal(f.battle.errors.length,0);
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

for(const rank of [3,4]) for(const selected of [false,true]) test(`exact-next-etlchi R${rank} ${selected?'module003':'nomodule'} keeps talent DOT at five seconds while only the candle lifetime is extended`,{timeout:30000},()=>{
  const f=fixture('char_4010_etlchi',rank,[],selected?'uniequip_003_etlchi':null),e=enemy(f),ticks=[];nextControlled(f);let hitAt=null;
  f.battle.on('damaged',x=>{if(x.source!==f.unit||x.target!==e)return;if(x.dmg.isAttack&&hitAt===null)hitAt=f.battle.time;if((x.dmg.tags||[]).includes('assaultEtlchiTalentDot'))ticks.push({time:f.battle.time,amount:x.amount});});
  assert.equal(f.battle.forceAttack(f.unit,[e]),true);clock(f,.7);assert.notEqual(hitAt,null,'a real ordinary attack actually applies this caster talent');const key='char_4010_etlchi:dot:'+f.unit.uid;
  clock(f,hitAt+4.9-f.battle.time);assert(e.findBuff(key),'the real five-second talent is still present just before expiry');clock(f,.2);assert(!e.findBuff(key),'selected 003 cannot extend the talent DOT past five seconds');
  assert.equal(ticks.length,5,'both choices settle the same five native one-second ticks');for(const tick of ticks){close(tick.amount,[100,200][rank-3]*(1-e.s.res/100),'the selected module does not change actual per-tick arts damage');assert(tick.time<=hitAt+5+.051,'no tick is scheduled after the five-second talent window');}
  const ended=ticks.length;clock(f,1.1);assert.equal(ticks.length,ended,'actual damage stops after talent expiry');cast(f);const candle=f.unit.mem.assaultEtlchiCandles.find(c=>c.mem.candleHost===e);assert(candle?.alive,'the same native host creates an actual independent candle');
  clock(f,20.1);assert.equal(candle.alive,selected,'only the selected module keeps the candle alive past twenty seconds');clock(f,5);assert.equal(candle.alive,false,'even the selected candle actually expires after twenty-five seconds');assert.equal(ticks.length,ended,'the candle lifetime never grants more talent DOT ticks');assert.equal(f.battle.errors.length,0);
});

for(const rank of [3,4]) test(`exact-next-etlchi R${rank} a different actual owner cannot refresh or clear this caster five-second DOT`,{timeout:30000},()=>{
  const f=ownerScope('char_4010_etlchi',rank,'char_127_estell','char_4010_etlchi');for(const u of [f.unit,f.same,f.other])f.battle.addBuff(u,{key:'exact-next:owner-isolation-control',flags:{disarm:true,noSp:true,invulnerable:true},duration:25});
  const key=f.unit.rangeKeys.find(k=>f.other.rangeKeySet.has(k)&&f.battle.grid.isLow(Math.floor(k/COLS),k%COLS));assert.notEqual(key,undefined,'two legally deployed owners share an actual attack-range tile');
  const e=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[Math.floor(key/COLS),key%COLS],mods:{hpMul:1000,speed:0}});assert(e);f.battle.applyStatus(e,'stun',{duration:25});f.battle._buildEnemyIndex();const ownKey='char_4010_etlchi:dot:'+f.unit.uid,foreignKey='char_4010_etlchi:dot:'+f.other.uid;
  assert.notEqual(f.unit.ownerId,f.other.ownerId);assert.equal(f.battle.forceAttack(f.unit,[e]),true);clock(f,.7);const own=e.findBuff(ownKey);assert(own);const ownExpiry=f.battle.time+own.timeLeft;clock(f,ownExpiry-1-f.battle.time);
  assert.equal(f.battle.forceAttack(f.other,[e]),true);clock(f,.7);assert.equal(e.findBuff(ownKey),own,'foreign hit does not replace the first owner buff');assert(e.findBuff(foreignKey),'the foreign owner creates its own distinct native DOT');clock(f,ownExpiry+.1-f.battle.time);
  assert(!e.findBuff(ownKey),'the first owner still expires at its original five-second boundary');const foreign=e.findBuff(foreignKey);assert(foreign,'first expiry cannot clear the later foreign source');const foreignExpiry=f.battle.time+foreign.timeLeft;clock(f,foreignExpiry+.1-f.battle.time);assert(!e.findBuff(foreignKey),'the second owner independently expires after its own five seconds');assert.equal(f.battle.errors.length,0);
});


// Mlynar's converted window: only native combat actions prepare or settle these fixtures.
const MLY_WINDOW_CONTROL = 'exact-mlynar-window:control';
function mlynarWindowFixture(rank, moduleId = null, extra = []) {
  const f = fixture('char_4064_mlynar', rank, extra, moduleId);
  for (const op of [f.unit, ...f.allies]) f.battle.addBuff(op, { key: MLY_WINDOW_CONTROL, flags: { noSp: true, disarm: true, invulnerable: true }, duration: 120 });
  const anchor = enemy(f, 15); f.battle.applyStatus(anchor, 'stun', { duration: 120 });
  clock(f, 2.05);
  f.mlynarRamp = f.unit.trait.ramp;
  f.mlynarIdleAtk = f.unit.s.atk;
  assert(f.mlynarRamp > 0, 'actual profession ticks accumulated a positive native ramp');
  return f;
}
function mlynarWindowStart(f, op = f.unit) {
  const before = op.skill.activations;
  f.battle.removeBuff(op, MLY_WINDOW_CONTROL);
  f.battle.addBuff(op, { key: 'exact-mlynar-window:start-safe', flags: { disarm: true, invulnerable: true }, duration: 120 });
  const need = Math.max(0, op.skill.spCost - op.skill.sp);
  if (need > 0) assert(op.skill.gainSp(need, 'exact-mlynar-native-SP') > 0, 'native SP gain reaches the real full charge');
  clock(f, .15);
  assert.equal(op.skill.activations, before + 1, 'native SP_FULL consumes one real skill charge');
  f.battle.addBuff(op, { key: MLY_WINDOW_CONTROL, flags: { noSp: true, disarm: true, invulnerable: true }, duration: 120 });
  f.battle.removeBuff(op, 'exact-mlynar-window:start-safe');
  return f.battle.time;
}
function mlynarWindowVictim(f, fraction = .2) {
  const e = enemy(f); const desired = Math.max(1, f.unit.s.atk * fraction);
  assert(e.hp > desired);
  f.battle.loseHp(e, e.hp - desired, { source: e, tags: ['fixture-native-HP-preparation'] });
  close(e.hp, desired, 'native HP loss prepares a live victim without assigning its runtime HP');
  return e;
}
function mlynarWindowAttack(f, e, attacker = f.unit) {
  assert.equal(f.battle.forceAttack(attacker, [e]), true, 'a native ordinary attack really starts');
  clock(f, .75); f.battle.assaultRuntime.flush();
}
for (const rank of [1, 2, 3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}
for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}
// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}
// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

for (const rank of [3, 4]) for (const selected of [false, true]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

for (const rank of [3, 4]) {
  // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

// Formal Surtr: 60/90 are seconds to the same 20% max-HP/s ceiling;
// Ember is the converted per-battle 4/8-second window, without potential +1.
function surtrContractFixture(rank,moduleId=null){
  const f=fixture('char_350_surtr',rank,[{id:'char_350_surtr',col:4}],moduleId);
  for(const u of [f.unit,...f.allies])f.battle.addBuff(u,{key:'surtr-contract:quiet',flags:{noSp:true,disarm:true},duration:150});
  const e=enemy(f,5);f.battle.applyStatus(e,'stun',{duration:150});return {...f,e};
}
function surtrContractClock(f,seconds){const end=f.battle.time+seconds;for(let n=0;n<4000&&f.battle.time<end;n++)f.battle.step();assert(f.battle.time>=end,'bounded real Surtr clock reaches requested seconds');}
function surtrContractStart(f){f.battle.removeBuff(f.unit,'surtr-contract:quiet');const before=f.unit.skill.activations,need=Math.max(0,f.unit.skill.spCost-f.unit.skill.sp);if(need)assert(f.unit.skill.gainSp(need,'surtr-contract:native-SP')>0);surtrContractClock(f,.15);assert.equal(f.unit.skill.activations,before+1,'one actual SP_FULL activation');f.battle.addBuff(f.unit,{key:'surtr-contract:quiet',flags:{noSp:true,disarm:true},duration:150});}
for(const rank of [1,2,3,4])for(const moduleId of [null,'uniequip_003_skadi'])test('skadi-swift R'+rank+' '+(moduleId??'no-module')+' consumes retained redeployment reduction in native cooldown without stacking',()=>{
 const f=fixture('char_263_skadi',rank,[{id:'char_263_skadi',col:4},{id:'char_350_surtr',col:5}],moduleId);
 const expected=f.body.physicalProfile.stats.respawnTime-10; // bazaar 往日残梦 only raises the Abyssal ATK aura; no extra redeploy reduction
 const other=f.allies[0],unrelated=f.allies[1],unrelatedBase=unrelated.base.respawnTime;
 close(f.unit.base.respawnTime,expected,'one retained ten-second reduction plus the explicitly selected unlocked module');
 close(other.base.respawnTime,f.body.physicalProfile.stats.respawnTime-10,'the other Skadi has her own talent and no selected module');
 for(let deployment=0;deployment<2;deployment++){
  f.battle.retreat(f.unit,{reason:'skadi-swift:real-retreat'});
  close(f.unit.respawnAt-f.battle.time,expected*f.unit.persist.redeployMul*f.unit.s.redeployMul,'the native down-unit cooldown consumes the authored reduction');
  assert.equal(f.battle.redeploy(f.unit,{free:false}),true);
  close(f.unit.base.respawnTime,expected,'real paid redeployment never reapplies the talent or module');
 }
 close(other.base.respawnTime,f.body.physicalProfile.stats.respawnTime-10);
 close(unrelated.base.respawnTime,unrelatedBase,'the personal reduction never alters unrelated operators');
 assert.equal(f.battle.errors.length,0);
});
for(const rank of [1,2,3,4])test('surtr-magma R'+rank+' retained talent penetrates real arts damage per UID without redeploy stacking',()=>{
 const f=surtrContractFixture(rank),penetration=rank===4?20:12;
 f.battle.addBuff(f.e,{key:'surtr-magma:fixed-res',mods:{resFlat:50-f.e.s.res}});close(f.e.s.res,50);
 for(const u of [f.unit,...f.allies]){
  close(u.s.resIgnoreFlat,penetration,'the retained talent installs for each real owner');
  const before=f.e.hp;f.battle.dealDamage(u,f.e,{amount:100,type:'arts',isAttack:true,canDodge:false});
  close(before-f.e.hp,50+penetration,'native arts mitigation consumes the fixed penetration');
 }
 f.battle.retreat(f.unit,{reason:'surtr-magma:real-retreat'});
 assert.equal(f.battle.redeploy(f.unit,{free:false}),true);
 close(f.unit.s.resIgnoreFlat,penetration,'paid deployment keeps exactly one talent contribution');
 close(f.allies[0].s.resIgnoreFlat,penetration,'redeployment does not alter the other owner');
 assert.equal(f.battle.errors.length,0);
});
for(const rank of [3,4]){
 for(const cause of ['own-loss','enemy-hit'])test('surtr-contract R'+rank+' '+cause+' fatal keeps one HP and rejects healing throughout formal Ember then forcibly retreats',{timeout:30000},()=>{
  const f=surtrContractFixture(rank),u=f.unit,other=f.allies[0],otherHp=other.hp,duration=rank===3?4:8;
  const lethal=()=>cause==='own-loss'?f.battle.loseHp(u,u.s.maxHp*2,{source:u,tags:['surtr-contract:real-self-loss']}):f.battle.dealDamage(f.e,u,{amount:u.s.maxHp*2,type:'true',canDodge:false});
  lethal();assert(u.alive&&u.deployed,'real fatal event starts protection for this UID');assert.equal(u.hp,1);const started=f.battle.time;
  surtrContractClock(f,.25);lethal();assert(u.alive&&u.deployed,'a second actual fatal event cannot terminate Ember early');assert.equal(u.hp,1);
  assert.equal(f.battle.heal(other,u,u.s.maxHp,{tags:['surtr-contract:real-heal']}),0,'the actual native heal is forbidden during Ember');assert.equal(u.hp,1);
  surtrContractClock(f,Math.max(0,started+duration-.15-f.battle.time));assert(u.alive&&u.deployed,'formal 4/8-second lifetime remains protected just before its end');lethal();assert.equal(u.hp,1);
  surtrContractClock(f,.25);assert(!u.deployed,'the exact formal duration ends with a real forced retreat');assert.equal(other.hp,otherHp,'different Surtr UID is not drained or withdrawn');assert(other.alive&&other.deployed);assert.equal(f.battle.errors.length,0);
 });
 // replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
}

for(const rank of [3,4])test('surtr-contract-recast-heal R'+rank+' native S3 immediately fills HP during Ember without lifting heal lock or extending its original deadline',{timeout:30000},()=>{
 const f=surtrContractFixture(rank,'uniequip_003_surtr'),u=f.unit,other=f.allies[0],heals=[];surtrContractStart(f);f.battle.loseHp(other,other.s.maxHp*.3,{source:other});const otherHp=other.hp;
 f.battle.dealDamage(f.e,u,{amount:u.s.maxHp*2,type:'true',canDodge:false});assert(u.alive&&u.deployed);assert.equal(u.hp,1);const started=f.battle.time,duration=rank===3?4:8;
 assert.equal(f.battle.heal(other,u,u.s.maxHp),0,'ordinary native healing is truly locked before recast');surtrContractClock(f,.5);
 const actualHeal=f.battle.heal;f.battle.heal=function(source,target,amount,options){const result=Reflect.apply(actualHeal,this,[source,target,amount,options]);if(source===u&&target===u)heals.push({hp:u.hp,maxHp:u.s.maxHp,amount:result});return result;};try{surtrContractStart(f);}finally{f.battle.heal=actualHeal;}
 assert.equal(heals.length,1,'the real S3 resolves its exceptional full self-heal once');close(heals[0].hp,heals[0].maxHp,'native ignoreHealFree self-heal immediately fills HP despite Ember');assert(heals[0].amount>0);close(other.hp,otherHp,'same-character different UID does not share the full-heal exception');
 f.battle.loseHp(u,u.hp*.25,{source:u});const injured=u.hp;assert.equal(f.battle.heal(other,u,u.s.maxHp),0,'the exceptional S3 heal has not removed ordinary heal lock');close(u.hp,injured,'forbidden native heal still restores no HP');
 surtrContractClock(f,Math.max(0,started+duration-.1-f.battle.time));assert(u.alive&&u.deployed,'the original Ember remains until its formal boundary');surtrContractClock(f,.2);assert(!u.deployed,'recast never extends the original forced-retreat deadline');assert(other.alive&&other.deployed);assert.equal(f.battle.errors.length,0);
});

for(const rank of [3,4])test('surtr-contract-per-battle R'+rank+' a genuine paid redeploy after formal Ember cannot grant a second fatal protection',{timeout:30000},()=>{
 const f=surtrContractFixture(rank),u=f.unit,other=f.allies[0],duration=rank===3?4:8;f.battle.dealDamage(f.e,u,{amount:u.s.maxHp*2,type:'true',canDodge:false});assert(u.alive&&u.deployed,'the first real fatal event is protected');assert.equal(u.hp,1);surtrContractClock(f,duration+.1);assert(!u.alive&&!u.deployed,'first formal 4/8-second Ember actually forces retreat');
 assert.equal(f.battle.redeploy(u,{free:false}),true,'native paid redeploy succeeds on the same legal rest tile');assert(u.alive&&u.deployed);assert.equal(u.hp,u.s.maxHp,'native deployment establishes actual full health');const otherHp=other.hp;
 f.battle.dealDamage(f.e,u,{amount:u.s.maxHp*2,type:'true',canDodge:false});assert(!u.alive&&!u.deployed,'formal perBattle one is already spent and the second real fatal event kills');assert.equal(u.hp,0);assert(other.alive&&other.deployed);close(other.hp,otherHp,'different UID cannot spend or inherit this per-battle state');assert.equal(f.battle.errors.length,0);
});

for(const rank of [3,4])test('source-small Surtr R'+rank+' selected003 natural S3 has exact full-heal ATK HP range and target stats isolated to its UID',{timeout:30000},()=>{
 const f=surtrContractFixture(rank,'uniequip_003_surtr'),u=f.unit,other=f.allies[0],healed=[];const before={atk:u.s.atk,hp:u.s.maxHp,extend:u.s.rangeExtend,targets:u.s.maxTargets,otherAtk:other.s.atk,otherMaxHp:other.s.maxHp,otherExtend:other.s.rangeExtend,otherTargets:other.s.maxTargets};
 f.battle.loseHp(u,u.s.maxHp*.3,{source:u});f.battle.loseHp(other,other.s.maxHp*.25,{source:other});const otherHp=other.hp,actualHeal=f.battle.heal;
 f.battle.heal=function(source,target,amount,options){const result=Reflect.apply(actualHeal,this,[source,target,amount,options]);if(source===u&&target===u)healed.push({hp:u.hp,maxHp:u.s.maxHp,amount:result});return result;};try{surtrContractStart(f);}finally{f.battle.heal=actualHeal;}
 assert.equal(healed.length,1,'one real natural SP_FULL cast completes one native self-heal');assert(healed[0].amount>0);close(healed[0].hp,healed[0].maxHp,'actual original heal has filled HP before its method returns');close(u.s.maxHp,before.hp+5000,'selected003 keeps formal plus-five-thousand maximum HP');close(u.s.atk,before.atk+u.base.atk*(rank===3?3.1:3.3),'selected003 uses exact formal skill ATK without an untriggered Ember bonus');assert.equal(u.s.rangeExtend,before.extend+2);assert.equal(u.s.maxTargets,before.targets+3);
 assert.deepEqual([...u.rangeKeys].sort((a,b)=>a-b),absoluteRangeKeys(u.rangeGrid,u.tileR,u.tileC,u.dir,before.extend+2).sort((a,b)=>a-b),'ordinary native geometry has exactly the source two-cell extension');close(other.hp,otherHp,'another UID remains genuinely injured');close(other.s.atk,before.otherAtk,'no other-UID ATK');close(other.s.maxHp,before.otherMaxHp,'no other-UID HP increase');assert.equal(other.s.rangeExtend,before.otherExtend);assert.equal(other.s.maxTargets,before.otherTargets);assert.equal(f.battle.errors.length,0);
});
for(const rank of [2,3,4])test('surtr-module002-penetration R'+rank+' has exactly five flat RES penetration only after unlock and paid redeploy never stacks it',{timeout:30000},()=>{
 const baseline=surtrContractFixture(rank),selected=surtrContractFixture(rank,'uniequip_002_surtr'),basePen=baseline.unit.s.resIgnoreFlat,extra=0; // bazaar 萨米的不灭心脏碎片 is skill damage +x%, not RES penetration
close(selected.unit.s.resIgnoreFlat-basePen,extra,'native RES-ignore stat obeys the real rank-two lock and rank-three/four unlock');close(selected.allies[0].s.resIgnoreFlat,baseline.allies[0].s.resIgnoreFlat,'same-character other UID has no selected module penetration');
 for(const f of [baseline,selected]){const before=f.unit.s.resIgnoreFlat;f.battle.retreat(f.unit,{reason:'surtr-module002:real-retreat'});assert(!f.unit.alive&&!f.unit.deployed);assert.equal(f.battle.redeploy(f.unit,{free:false}),true,'native legal paid redeploy really succeeds');assert(f.unit.alive&&f.unit.deployed);close(f.unit.s.resIgnoreFlat,before,'native deployment keeps one module amount rather than adding it a second time');assert.equal(f.battle.errors.length,0);}
 close(selected.unit.s.resIgnoreFlat-baseline.unit.s.resIgnoreFlat,extra,'actual post-redeploy module difference remains exactly zero or five');
});
