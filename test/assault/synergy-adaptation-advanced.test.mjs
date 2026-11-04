import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime, FLYER } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { ADVANCED_ADAPTATIONS } from '../../shared/assault/advanced-adaptations.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';

function setup(entries,extra=()=>{}){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{
  b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);extra(b);
}});for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
const spawn=(h,pos,more={})=>h.spawn(pos,{mods:{hpMul:10000,speedMul:0},...more});
function seen(h,unit){const hits=[];h.battle.on('hit',p=>{if(p.source===unit)hits.push(p);},{priority:-100});return hits;}

test('six advanced signatures keep original slots, ranges and card constraints',()=>{
  for(const [id,plan]of Object.entries(ADVANCED_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.ok(body.adaptation.lines.every(l=>[...l].length<=32));assert.equal(body.modulePlans.length,2);
  }
});
test('Thorns alter creates four independently damaging following alchemy units and preserves native mind/vision',()=>{
  const h=setup([{charId:'char_1039_thorn2',row:10,col:2},{charId:'char_103_angel',row:10,col:3},
    {charId:'char_373_lionhd',row:11,col:2},{charId:'char_240_wyvern',row:10,col:4}]),[u,ally]=h.units,e=spawn(h,[10,4]);
  const hits=seen(h,u);assert.ok(u.s.atk>=u.base.atk*1.1-1e-7);h.castNow(u);assert.equal(u.mem.zones.length,4);
  h.run(1.2);assert.ok(hits.length>1);assert.ok(e.s.def<e.base.def||e.s.res<e.base.res||e.s.atk<e.base.atk);assert.ok(ally.s.aspd>=ally.base.aspd+5);
  h.castNow(u);assert.equal(u.mem.zones.length,8);h.run(27);assert.equal(u.mem.zones.length,0);assert.deepEqual(h.battle.errors,[]);
});
test('Clementia ordinary three-target round uses one cast-ammo and creates real erosion gauge',()=>{
  const h=setup([{charId:'char_4231_clemnt',row:10,col:3}]),[u]=h.units,foes=Array.from({length:4},()=>spawn(h,[10,5]));h.battle.rng=()=>.99;
  u.base.atk=10;u.markDirty();
  const hits=seen(h,u);h.castNow(u);assert.equal(hits.filter(p=>p.dmg.type==='phys').length,3);assert.equal(assaultAmmoState(u).current,9);
  assert.equal(foes.filter(t=>t.elem.erosion>0).length,3);assert.deepEqual(h.battle.errors,[]);
});
test('Clementia responds to a real distant erosion burst with one shared-ammo native cross triple cannon',()=>{
  const h=setup([{charId:'char_4231_clemnt',row:10,col:3},{charId:'char_373_lionhd',row:10,col:2}]),[u,ally]=h.units;
  const centre=spawn(h,[11,8]),cross=spawn(h,[11,9]),diagonal=spawn(h,[12,9]),air=spawn(h,[11,8],{key:FLYER}),hits=seen(h,u);h.battle.rng=()=>.99;
  h.battle.dealDamage(ally,centre,{amount:centre.gaugeMax,type:'element',element:'erosion'});h.flush();
  assert.equal(assaultAmmoState(u).current,9);assert.equal(hits.filter(p=>p.target===cross&&p.dmg.type==='phys').length,3);
  assert.equal(hits.filter(p=>p.target===cross&&p.dmg.type==='elemental').length,3);assert.equal(hits.some(p=>p.target===diagonal||p.target===air),false);assert.deepEqual(h.battle.errors,[]);
});
test('Demetri native movement carries the original body, attacks/DEF stacks and returns to the original marker without leaving a clone',()=>{
  const moves=[];const h=setup([{charId:'char_4037_demetr',row:10,col:3}],b=>b.on('deploy',p=>{if(p.unit.def.charId==='char_4037_demetr')moves.push([p.unit.tileR,p.unit.tileC]);})),[u]=h.units,e=spawn(h,[10,5]);
  e.base.def=500;e.markDirty();h.battle.rng=Object.assign(()=>.99,{chance:()=>false});const hits=seen(h,u);h.castNow(u);
  assert.equal(hits.filter(p=>p.dmg.isAttack).length,6);assert.ok(e.s.def<500);assert.deepEqual([u.tileR,u.tileC],[10,3]);
  assert.ok(h.battle.assaultLedger.snapshot().operators.find(row=>row.uid===u.uid).triggers>0,'actual native DEF stacks are credited');
  assert.ok(moves.some(([r,c])=>r===10&&c===5));assert.equal(h.battle.allyUnits.some(t=>t.ownerUnit===u&&t.alive),false);
  assert.equal(u.skill.sp,0);assert.deepEqual(h.battle.errors,[]);
});
test('Ulpian anchor follows the original forward route, stuns, moves/returns and keeps meaningful accumulated HP uses',()=>{
  const moves=[];const h=setup([{charId:'char_4145_ulpia',row:10,col:3}],b=>b.on('deploy',p=>{if(p.unit.def.charId==='char_4145_ulpia')moves.push([p.unit.tileR,p.unit.tileC]);})),[u]=h.units,e=spawn(h,[10,6]),hits=seen(h,u);
  h.castNow(u);assert.ok(hasStatus(e,'stun'));assert.ok(hits.length>=7);assert.ok(moves.some(([r,c])=>r===10&&c===6));
  assert.deepEqual([u.tileR,u.tileC],[10,3]);assert.ok(u.s.maxHp>=u.base.maxHp*1.8-1e-7);assert.equal(h.battle.allyUnits.some(t=>t.ownerUnit===u&&t.alive),false);assert.deepEqual(h.battle.errors,[]);
});
test('Ulpian native kill growth caps at nine and genuinely gives half to another Abyssal Hunter',()=>{
  const h=setup([{charId:'char_4145_ulpia',row:10,col:3},{charId:'char_263_skadi',row:10,col:4}]),[u,ally]=h.units;
  const own=u.s.maxHp,other=ally.s.maxHp;for(let i=0;i<12;i++){const e=spawn(h,[10,5]);h.battle.kill(e,u);}h.flush();
  assert.equal(u.s.maxHp-own,120*9);assert.equal(ally.s.maxHp-other,60*9);assert.deepEqual(h.battle.errors,[]);
});
test('Siege alter only uses manually placed golden vows and retains four-target true attacks plus allied first-hit tremble',()=>{
  const id='token_10040_siege2_vlion',h=setup([{charId:'char_1019_siege2',row:10,col:4,piece:{summonPresets:[{tokenId:id,row:9,col:4,dir:'RIGHT'},{tokenId:id,row:11,col:4,dir:'RIGHT'}]}}]),[u]=h.units;
  const foes=Array.from({length:5},()=>spawn(h,[10,5])),hits=seen(h,u);h.castNow(u);
  const tokens=h.battle.allyUnits.filter(t=>t.ownerUnit===u&&t.alive);assert.equal(tokens.length,2);assert.ok(tokens.every(t=>t.defId===id));
  assert.equal(hits.filter(p=>p.dmg.isSkill&&p.dmg.type==='true').length,24);assert.equal(foes.filter(t=>hasStatus(t,'tremble')).length,4);
  const empty=setup([{charId:'char_1019_siege2',row:10,col:4}]);empty.castNow(empty.units[0]);assert.equal(empty.battle.allyUnits.some(t=>t.ownerUnit===empty.units[0]),false);assert.deepEqual(h.battle.errors,[]);
});
test('golden vows retire after the original twenty-five seconds and never become battle-long summons',()=>{
  const tokenId='token_10040_siege2_vlion',h=setup([{charId:'char_1019_siege2',row:10,col:4,piece:{summonPresets:[{tokenId,row:9,col:4,dir:'RIGHT'}]}}]),[u]=h.units;
  h.castNow(u);const lion=h.battle.allyUnits.find(t=>t.ownerUnit===u&&t.alive);h.run(24.8);assert.equal(lion.alive,true);h.run(.4);assert.equal(lion.alive,false);assert.deepEqual(h.battle.errors,[]);
});
test('Entellechia uses real highest-HP mapped candles, native minimum/transfer, HP theft cap and proper cleanup',()=>{
  const h=setup([{charId:'char_4010_etlchi',row:10,col:3}]),[u]=h.units,foes=Array.from({length:4},()=>spawn(h,[10,5]));u.hp=u.s.maxHp*.5;
  const before=foes.map(e=>e.hp);h.castNow(u);assert.equal(u.mem.stolen,1350);assert.deepEqual(u.mem.candles,[]);
  assert.equal(h.battle.enemies.some(e=>e.mem.candleOwner===u&&e.alive),false);assert.ok(before[0]-foes[0].hp>before[3]-foes[3].hp);
  assert.ok(u.hp>u.s.maxHp*.5);assert.deepEqual(h.battle.errors,[]);
});
