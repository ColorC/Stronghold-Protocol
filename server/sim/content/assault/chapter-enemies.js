// Native chapter enemies added for the 10-23 Assault encounter sets. Values
// come from each enemy's own talent/skill blackboard, retained by the compiler.
import { hypot } from '../../detmath.js';
import { hurt, T, targetsNear, areaAlliesInTiles, abOf, attach } from '../enemies/helpers.js';
import { FLY_KITS } from '../enemies/fly.js';

// Display only. The chapter effects below are plain hooks and buffs (no `status` field: card lines purge by status), so
// the client is told through the same events the native enemies use: ['status',id,key,on], b.fx(kind), and the enemy's
// skill-animation window (skillAnimUntil, read by the snapshot only). None of these touch a number.
const hasStatus=(unit,key)=>unit.buffs.some(x=>(x.status??x.key)===key);
const showStatus=(b,unit,key)=>{if(!hasStatus(unit,key))b._ev(['status',unit.id,key,1]);};
const hideStatus=(b,unit,key)=>{if(!hasStatus(unit,key))b._ev(['status',unit.id,key,0]);};
const castAnim=(b,e)=>{e.skillAnimUntil=b.time+.5;};
const PLUS=[[0,0],[-1,0],[1,0],[0,-1],[0,1]];
const splash=shape=>({dealt(c,b,e){
  const r=Math.round(c.target.y),col=Math.round(c.target.x);
  for(const u of areaAlliesInTiles(b,e,r,col,shape))if(u!==c.target)hurt(b,e,u,e.s.atk,e.profile.dmgType??e.def.dmgType);
  b.fx('explode',{x:c.target.x,y:c.target.y,r:1,kind:'aoeAttack',tiles:shape==='plus'?PLUS.map(([dr,dc])=>[r+dr,col+dc]):'box'});
}});
const frozenStrike=ab=>[{hitOut(c,b){if(c.target?.s?.flags?.freeze){c.dmg.amount*=T(ab,'atkup.atk_scale')??1;
  b.fx('strike',{x:c.target.x,y:c.target.y,id:c.target.id,kind:'frostStrike'});}}}];
const coldMage=ab=>[{attack(c,b,e,a){a.attacks=(a.attacks??0)+1;a.cold=a.attacks%((ab.sk.coldattack?.sp??2)+1)===0;},
  dealt(c,b,e,a){if(a.cold)b.applyStatus(c.target,'cold',{duration:ab.sk.coldattack?.bb.freeze??10,source:e});}}];
const drain=ab=>[{iv:1,tick(b,e){const amount=(T(ab,'periodic_damage.damage')??0)*e.s.maxHp/e.def.maxHp;
  if(amount>0)b.loseHp(e,amount,{source:e,tags:['chapterHostDrain']});}}];
const herald=ab=>[{iv:.25,tick(b,e){
  for(const target of b.enemies)if(target!==e&&target.alive&&!target.removed){
    const t=target.def.talent??{};
    if(!target.buffs.some(x=>x.key==='ab:chapter:herald')){castAnim(b,e);b.fx('buff',{x:target.x,y:target.y,id:target.id,kind:'herald'});}
    b.addBuff(target,{key:'ab:chapter:herald',source:e,duration:.51,refresh:'replace',mods:{
      atkPct:(T(ab,'strength.atk')??0)+(t['strength.atk']??0),defFlat:T(ab,'strength.def')??0,
      moveMul:1+(t['strength.move_speed']??0),aspd:t['strength.attack_speed']??0,
      maxTargets:/sotisp/.test(target.defId)?1:0}});
  }
}}];
const shackle=ab=>[{iv:.25,tick(b,e,a){
  if(a.used||e.s.flags.stun||e.s.flags.silence)return;
  const sk=ab.sk.lasso,bb=sk?.bb??{},target=targetsNear(b,e,bb.range_radius??3)[0];if(!target)return;
  a.used=true;a.target=target;a.until=b.time+(bb.hit_duration??20);
  castAnim(b,e);b.fx('link',{x:e.x,y:e.y,from:e.id,to:target.id,kind:'lasso',dur:bb.hit_duration??20});
  b.addBuff(e,{key:'ab:chapter:lasso-source',flags:{noMove:true,disarm:true},duration:bb.hit_duration??20});
  showStatus(b,target,'stun');
  b.addBuff(target,{key:`ab:chapter:lasso:${e.id}`,flags:{stun:true},source:e,duration:bb.hit_duration??20,
    onRemove({battle,unit}){hideStatus(battle,unit,'stun');}});
  let ticks=0;const timer=b.every(1,()=>{
    if(!e.alive||!target.alive||b.time>a.until){b.removeBuff(target,`ab:chapter:lasso:${e.id}`);timer.cancel();return;}
    hurt(b,e,target,e.s.atk*(bb.atk_scale??.35),'arts');if(++ticks>=(bb.hit_duration??20))timer.cancel();
  },{owner:e});
 },death(c,b,e,a){if(a.target)b.removeBuff(a.target,`ab:chapter:lasso:${e.id}`);}}];
const casterPulse=ab=>[{iv:.25,tick(b,e,a){
  if(e.s.flags.stun||e.s.flags.silence||b.time<(a.next??0))return;
  const skill=ab.sk.Immo;a.next=b.time+(skill?.cd??5);
  const radius=e.def.rangeRadius||2;let hit=0;
  for(const unit of [...b.allyUnits,...b.enemies])if(unit!==e&&unit.alive&&unit.deployed&&hypot(unit.x-e.x,unit.y-e.y)<=radius){
    if(!hit++){castAnim(b,e);b.fx('explode',{x:e.x,y:e.y,r:radius,kind:'artsPulse',dmgType:'arts'});}
    hurt(b,e,unit,e.s.atk*(skill?.bb.atk_scale??1),'arts');
  }
}}];
export const CHAPTER_KITS=Object.freeze({
 enemy_1018_aoemag:()=>[splash('plus')],
 enemy_1024_mortar:()=>[splash('box')],
 enemy_1082_soticn:()=>[splash('box')],
 enemy_1038_lunmag_2:()=>[{spawn(b,e){e.profile.maxTargets=2;}}],
 enemy_1020_obsv:ab=>[{iv:.25,tick(b,e){for(const u of b.allyUnits)if(u.alive&&u.deployed&&hypot(u.x-e.x,u.y-e.y)<=(T(ab,'antiinvi.range_radius')??3.3)){
   if(!u.buffs.some(x=>x.key===`ab:chapter:reveal:${e.id}`))b.fx('reveal',{x:u.x,y:u.y,id:u.id,kind:'obsv'});
   b.addBuff(u,{key:`ab:chapter:reveal:${e.id}`,source:e,flags:{reveal:true},duration:.51,refresh:'replace'});}}}],
 enemy_1022_dmage:shackle,
 enemy_1040_bombd_2:FLY_KITS.enemy_1040_bombd,
 enemy_1062_rager:drain,enemy_1063_rageth:drain,enemy_1063_rageth_2:drain,
 enemy_1065_snwolf:frozenStrike,enemy_1065_snwolf_2:frozenStrike,enemy_1064_snsbr:frozenStrike,
 enemy_1066_snbow:frozenStrike,enemy_1069_icebrk:frozenStrike,
 enemy_1068_snmage:coldMage,enemy_1068_snmage_2:coldMage,
 enemy_1080_sotidp:herald,
 enemy_1085_sotiwz:casterPulse,enemy_1085_sotiwz_2:casterPulse,enemy_1085_sotiwz_3:casterPulse,
});

// Attach through the native enemy dispatcher, only in Assault. Priority 90 runs
// after native onSpawn (100); an existing native ability always takes precedence.
export function installChapterEnemies(battle) {
  battle.on('enemySpawn',({enemy})=>{
    const kit=CHAPTER_KITS[enemy.defId];if(!kit)return;
    const ab=abOf(battle,enemy);if(ab.chapterInstalled)return;ab.chapterInstalled=true;
    if(!ab.list.length)attach(battle,enemy,kit(ab,enemy,battle));
  },{priority:90});
}
