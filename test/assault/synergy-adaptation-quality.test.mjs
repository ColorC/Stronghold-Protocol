import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, FLYER, runtime } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { sourceKey } from '../../server/sim/content/assault/cards/adaptation-core.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';

function setup(entries){const stage=flatStage(),h=synergyBattle(entries,{beforeStart:b=>{
  b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);
}});for(const u of h.units){h.hold(u);u.profile.noAttack=true;u.skill.rule='NEVER';}return h;}
const spawn=(h,pos,key)=>h.spawn(pos,{...(key?{key}:{}),mods:{hpMul:10000,speedMul:0}});
const ok=h=>assert.deepEqual(h.battle.errors,[]);
function seen(h,u){const list=[];h.battle.on('hit',p=>{if(p.source===u)list.push(p);},{priority:-100});return list;}
test('fifteen rewritten links keep original self talents without spreading raw stats to their neighbours',()=>{
  for(const[id,other,ground]of [['char_240_wyvern','char_290_vigna',true],['char_199_yak','char_150_snakek',true],['char_150_snakek','char_199_yak',true],
    ['char_497_ctable','char_290_vigna',true],['char_1026_gvial2','char_264_f12yin',true],['char_430_fartth','char_126_shotst',false]]){
    const h=setup([{charId:id,row:10,col:ground?3:2},{charId:other,row:10,col:ground?4:3}]),[u,a]=h.units;h.run(.3);
    assert.equal(a.buffs.some(b=>b.source===u&&(b.mods?.atkPct||b.mods?.defPct||b.mods?.resFlat||b.mods?.aspd)),false,id);ok(h);
  }
});
test('Vanilla retains native own ATK and actually stores extra skill swings from accumulated real DP without losing repeated rewards',()=>{
  const h=setup([{charId:'char_240_wyvern',row:10,col:3},{charId:'char_151_myrtle',row:11,col:3}]),[u,a]=h.units;spawn(h,[10,4]);
  h.battle.getPlayer(u.ownerId).dp=0; // the free opening entry leaves the DP bar full; gains are measured from an empty bar
  h.castNow(a);h.run(.3);assert.equal(u.mem.adaptVanillaHits,2);const hits=seen(h,u);h.castNow(u);assert.equal(hits.length,8);assert.ok(u.findBuff(sourceKey(u,'attack-up')));ok(h);
});
test('Vigna retains her own original critical chance and stores one extra stab per eight DP from another Vanguard',()=>{
  const h=setup([{charId:'char_290_vigna',row:10,col:3},{charId:'char_151_myrtle',row:11,col:3}]),[u,a]=h.units;spawn(h,[10,4]);h.battle.getPlayer(u.ownerId).dp=0;h.castNow(a);
  h.run(.3);assert.equal(u.mem.adaptBruteSpikes,2);const hits=seen(h,u);h.castNow(u);assert.equal(hits.length,8);assert.equal(u.mem.adaptBruteSpikes,0);ok(h);
});
test('Cuora stores shell uses from three actual ally blocks, while Matterhorn stores cold uses from three actual other-Defender arts hits',()=>{
  const h=setup([{charId:'char_150_snakek',row:10,col:3},{charId:'char_199_yak',row:11,col:3}]),[u,a]=h.units;
  const es=Array.from({length:3},()=>spawn(h,[11,3]));for(const e of es)h.battle._checkBlock(e);h.flush();assert.equal(u.mem.adaptHitUses['shell-defence'].length,1);
  for(let i=0;i<3;i++)h.battle.dealDamage(es[0],u,{amount:10,type:'arts'});h.flush();assert.equal(a.mem.adaptHitUses['cold-physique'].length,1);
  assert.ok(u.findBuff(sourceKey(u,'defence-specialist')));assert.ok(a.findBuff(sourceKey(a,'snowfield-guard')));ok(h);
});
test('Gavial alter stores an extra round from three real Guard blocks while preserving her own block-based ATK and DEF',()=>{
  const h=setup([{charId:'char_1026_gvial2',row:10,col:3},{charId:'char_143_ghost',row:11,col:3}]),[u,a]=h.units;
  for(let i=0;i<3;i++){const e=spawn(h,[11,3]);h.battle._checkBlock(e);}h.flush();assert.equal(u.mem.adaptAxeSwings,1);
  const target=spawn(h,[10,3]);h.battle._checkBlock(target);h.run(.3);assert.ok(u.findBuff(sourceKey(u,'battle-axe')).mods.atkPct>.1);
  const hits=seen(h,u);h.castNow(u);assert.equal(hits.length,11);assert.equal(a.findBuff(sourceKey(u,'battle-axe')),null);ok(h);
});
test('Ctable alone retains native unblocked ASPD, and three real other-Vanguard blocks cause a real extra DP stab',()=>{
  const h=setup([{charId:'char_497_ctable',row:10,col:3},{charId:'char_112_siege',row:11,col:3}]),[u,a]=h.units;spawn(h,[10,4]);h.battle.getPlayer(u.ownerId).dp=0;h.run(.3);
  assert.equal(u.findBuff(sourceKey(u,'complete-self')).mods.aspd,12);const hits=seen(h,u),dp=[];
  h.battle.assaultRuntime.observe('dpGranted','test:ctable-dp',({payload:p})=>{if(p.source===u)dp.push(p.amount);});
  // Siege blocks two; releasing one really permits a third independent block.
  for(let i=0;i<3;i++){const e=spawn(h,[11,3]);h.battle._checkBlock(e);h.battle._unblock(e);e.x=9;e.y=12;h.battle._buildEnemyIndex();}
  h.flush();assert.equal(hits.length,1);assert.deepEqual(dp,[1]);assert.equal(a.findBuff(sourceKey(u,'complete-speed')),null);ok(h);
});
test('Ashlock keeps her own actual terrain ATK bonus and other-Defender blocks store real extra bombardment rounds',()=>{
  const h=setup([{charId:'char_431_ashlok',row:10,col:3},{charId:'char_136_hsguma',row:11,col:3}]),[u]=h.units;
  for(let i=0;i<3;i++){const e=spawn(h,[11,3]);h.battle._checkBlock(e);}h.flush();assert.equal(u.mem.adaptAshlockRounds,1);
  spawn(h,h.rangeTile(u));h.run(.3);assert.ok(u.findBuff(sourceKey(u,'artillery-self')));const hits=seen(h,u);h.castNow(u);assert.equal(hits.length,7);ok(h);
});
test('Utage keeps her own missing-HP ASPD and retaliates only after six real enemy hits on another operator',()=>{
  const h=setup([{charId:'char_337_utage',row:10,col:3},{charId:'char_199_yak',row:10,col:4}]),[u,a]=h.units,e=spawn(h,[10,4]),hits=seen(h,u);
  h.run(.3);assert.ok(u.findBuff('adaptation:utage:serious-mode').mods.aspd>0);assert.equal(a.findBuff('adaptation:utage:serious-mode'),null);
  for(let i=0;i<6;i++)h.battle.dealDamage(e,a,{amount:1,type:'true'});h.flush();assert.equal(hits.length,1);ok(h);
});
test('Aciddrop retains her own physical damage floor and another actual ammo cast creates a counted sliding reply',()=>{
  const h=setup([{charId:'char_366_acdrop',row:10,col:2},{charId:'char_498_inside',row:11,col:2}]),[u,a]=h.units,e=spawn(h,[10,4]);
  e.base.def=100000;e.markDirty();const hits=seen(h,u);for(let i=0;i<3;i++)h.castNow(a);h.run(.3);
  assert.ok(hits.some(p=>p.dmg.type==='true'));assert.equal(h.spOf(u),0);ok(h);
});
test('Executor retains own DEF penetration and observes three real other ammo skill resolutions for a single extra spread round',()=>{
  const h=setup([{charId:'char_279_excu',row:10,col:2},{charId:'char_498_inside',row:11,col:2}]),[u,a]=h.units;spawn(h,[10,4]);const hits=seen(h,u);
  for(let i=0;i<3;i++)h.castNow(a);h.run(.3);assert.equal(hits.length,1);assert.equal(hits[0].dmg.defIgnoreFlat,160);ok(h);
});
test('Meteor and Fartooth receive actual other-Sniper skill events, with own anti-air and concentration retained',()=>{
  const h=setup([{charId:'char_126_shotst',row:10,col:2},{charId:'char_430_fartth',row:11,col:2},{charId:'char_498_inside',row:10,col:3}]),[u,far,a]=h.units;spawn(h,[10,4],FLYER);const hits=seen(h,u);
  for(let i=0;i<3;i++)h.castNow(a);h.run(.3);assert.equal(hits.length,1);assert.ok(hits[0].dmg.mul>=1.35);assert.equal(h.spOf(far),4);ok(h);
});
test('Earthspirit only extends her own sluggishness and four real other-source slows cause one independent range pulse',()=>{
  const h=setup([{charId:'char_183_skgoat',row:10,col:2},{charId:'char_373_lionhd',row:11,col:2}]),[u,a]=h.units,e=spawn(h,[10,4]);let own=0;
  h.battle.on('statusApplied',p=>{if(p.source===u&&p.status==='sluggish')own++;});
  for(let i=0;i<4;i++)h.battle.applyStatus(e,'sluggish',{duration:.8,source:a});h.flush();assert.equal(own,1);
  assert.ok(Math.abs(e.findBuff('sluggish').timeLeft-.9)<1e-6);ok(h);
});
test('Leizi and Amiya consume actual caster skills, preserving native unblocked damage and own attack/kill SP',()=>{
  const h=setup([{charId:'char_306_leizi',row:10,col:2},{charId:'char_002_amiya',row:11,col:2},{charId:'char_373_lionhd',row:10,col:3}]),[u,amiya,a]=h.units;const e=spawn(h,[10,4]);const hits=seen(h,u);
  h.castNow(a);h.castNow(a);h.run(.3);assert.equal(hits.length,1);assert.ok(hits[0].dmg.mul>=1.2);assert.equal(h.spOf(amiya),4);
  h.battle.dealDamage(amiya,e,{amount:e.hp*2,type:'true'});h.flush();assert.ok(h.spOf(amiya)>=12);ok(h);
});
test('Qiubai retains her own native slit damage and three other-source binds cause one real extra slit',()=>{
  const h=setup([{charId:'char_4082_qiubai',row:10,col:3},{charId:'char_373_lionhd',row:11,col:2}]),[u,a]=h.units,e=spawn(h,[10,4]),hits=seen(h,u);
  for(let i=0;i<3;i++)h.battle.applyStatus(e,'bind',{duration:1.5,source:a});h.flush();assert.equal(hits.length,1);assert.equal(hits[0].dmg.type,'arts');ok(h);
});
test('Skadi follows the explicit native thirty-second example and a real redeployment restores it without multiplying attack',()=>{
  const h=setup([{charId:'char_263_skadi',row:10,col:3}]),[u]=h.units;h.run(.3);const atk=u.s.atk;h.run(31);assert.ok(u.s.atk<atk);
  cycleRedeploy(h.battle,u);h.flush();h.run(.3);assert.equal(u.s.atk,atk);assert.ok(u.findBuff(sourceKey(u,'wave')));ok(h);
});
test('role declarations count real skill consumers and preserve genuine native auras while excluding finite marks',()=>{
  const bodies=Object.values(runtime.bodies),count=role=>bodies.filter(b=>b.adaptation.roles.includes(role)).length;
  assert.equal(count('aura'),60);assert.equal(count('control'),34);assert.equal(bodies.filter(b=>b.adaptation.consumes.includes('skill')).length,15);
  assert.ok(runtime.bodies.char_263_skadi.adaptation.roles.includes('aura'));assert.equal(runtime.bodies.char_4193_lemuen.adaptation.roles.includes('aura'),false);
});
