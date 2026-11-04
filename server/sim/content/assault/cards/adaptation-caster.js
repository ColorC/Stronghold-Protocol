import { adaptedKit } from '../adapted-kit.js';
import { naturalSpAura } from '../adaptation-auras.js';
import { active, damage, heal, buff, applyStatus, sp, enemies, uid } from '../primitives.js';
import { allyAura, enemyAura, withinAdjacent4, hasStatus, matchesClass } from '../synergy.js';
import { valuesOf, yours, ops, targets, canAttack, sourceKey, onDeploy, anchor } from './adaptation-core.js';
import { observeCount, conditionalSelf, square } from './adaptation-pool.js';
import { bodyDist, hitRect, bodyInKeys } from '../../../body.js';
import { rotateOffset, dirVec } from '../../../dir.js';
import { powi } from '../../../detmath.js';
import { actualDamageLink, linkDamagePotential, recordLinkEffect } from '../adaptation-primitives.js';

const inRange=(unit,target)=>anchor(unit).rangeKeySet.has(Math.round(target.y)*21+Math.round(target.x));
const ordinary=target=>!target.isBoss&&!['ELITE','BOSS'].includes(target.def?.rank);
const wounded=list=>list.filter(t=>t.hp<t.s.maxHp-1e-7).sort((a,b)=>a.hp/a.s.maxHp-b.hp/b.s.maxHp||a.id-b.id);
function nativeBasicSP(battle,unit,amount,key){battle.on('attack',({attacker,isSkill})=>{if(attacker===unit&&!isSkill)sp(battle,unit,unit,amount,key,sourceKey(unit,key));},{owner:unit});}
function selfStat(battle,unit,key,mods){onDeploy(battle,unit,key,()=>{
 const buffKey=sourceKey(unit,key),before=unit.findBuff(buffKey),changed=!before||Object.entries(mods).some(([k,v])=>before.mods?.[k]!==v);
 const applied=buff(battle,unit,unit,{key:buffKey,mods,duration:Infinity,persist:true});recordLinkEffect(battle,unit,key,unit,changed&&!!applied);
});}
function sluggishAttack(battle,unit,target){if(target.alive)applyStatus(battle,unit,target,{status:'sluggish',duration:unit.profile.onHitStatus?.duration??.8});}

const amiya=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);buff(battle,unit,unit,{key:sourceKey(unit,'chimera-life'),mods:{hpPct:v.hp},duration:Infinity});
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'true',isSkill:true});
    battle.after(battle.dt,()=>{if(active(unit))battle.retreat(unit,{reason:'chimera-end'});});return true;},
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','emotion-absorb',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='CASTER',
    ()=>sp(battle,unit,unit,valuesOf(unit).charge,'emotion-absorb',sourceKey(unit,'emotion-absorb')),{every:valuesOf(unit).every}),
  innate:(battle,unit)=>{nativeBasicSP(battle,unit,valuesOf(unit).attackSP,'emotion-attack');observeCount(battle,unit,'kill','emotion-kill',p=>p.source===unit,
    ()=>sp(battle,unit,unit,valuesOf(unit).killSP,'emotion-kill',sourceKey(unit,'emotion-kill')));},
});
const mint=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.hits;i++)for(const target of targets(battle,unit)){
    damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});if(target.alive)battle.pull(target,v.force,{center:unit,to:{x:unit.x,y:unit.y}});}
    for(const target of targets(battle,unit))damage(battle,unit,target,{scale:v.finish,type:'arts',isSkill:true});return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'geologist',mods:{defPct:valuesOf(unit).aura},select:t=>t!==unit&&withinAdjacent4(unit,t)&&!unit.skill.active}),
});
const haini=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);let kills=0;
    for(const target of targets(battle,unit,unit,999).filter(ordinary))buff(battle,unit,target,{key:sourceKey(unit,'pigment-slow'),mods:{moveMul:1-v.slow},duration:v.duration});
    for(let i=0;i<v.hits;i++){
      for(const target of targets(battle,unit,unit,999).filter(ordinary))applyStatus(battle,unit,target,{status:'fragile',value:v.fragile*Math.min(v.max,1+kills*v.step),duration:battle.dt});
      for(const target of targets(battle,unit)){damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});sluggishAttack(battle,unit,target);if(!target.alive&&ordinary(target))kills++;}
    }return true;},
  link:(battle,unit)=>battle.every(.25,()=>{if(active(unit))for(const target of enemies(battle,unit,{count:999}).filter(ordinary))
    applyStatus(battle,unit,target,{status:'fragile',value:valuesOf(unit).fragile,duration:.51});},{owner:unit}),
});
const provs=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of targets(battle,unit)){
    damage(battle,unit,target,{scale:v.open,type:'arts',isSkill:true});if(target.alive){applyStatus(battle,unit,target,{status:'sluggish',duration:v.duration});applyStatus(battle,unit,target,{status:'silence',duration:v.duration});}}
    for(let i=0;i<v.hits;i++){const [target]=targets(battle,unit,unit,1);if(target)damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});}return true;},
  link:(battle,unit)=>onDeploy(battle,unit,'kazimierz-law',()=>battle.after(0,()=>{
    if(!active(unit))return;
    const list=ops(battle,unit).filter(t=>t!==unit&&matchesClass(t,{label:'卡西米尔'})),target=list[Math.floor(battle.rng()*list.length)];
    if(target)buff(battle,unit,target,{key:'adaptation:provs:kazimierz-law',mods:{aspd:valuesOf(unit).aspd},duration:Infinity,persist:true});
  },{owner:unit})),
  innate:(battle,unit)=>selfStat(battle,unit,'lawyer-aspd',{aspd:valuesOf(unit).aspd}),
});
const grabds=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{const v=valuesOf(unit),selected=targets(battle,unit);for(const target of selected)applyStatus(battle,unit,target,{status:'sleep',duration:v.sleep});
    battle.after(v.sleep+battle.dt,()=>{if(active(unit))battle.assaultRuntime.withCause(cause,()=>{
      for(let i=0;i<v.hits;i++)for(const target of selected.filter(active)){damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});sluggishAttack(battle,unit,target);}
    });},{owner:unit});return true;},
  link:(battle,unit)=>battle.on('beforeStatus',ctx=>{
    const target=ctx.target,isAnimal=target?.def?.tags?.includes('infection');
    if(ctx.source===unit&&ctx.status==='sluggish'&&isAnimal)ctx.duration+=valuesOf(unit).extra;
  },{owner:unit}),
  innate:(battle,unit)=>selfStat(battle,unit,'good-listener',{aspd:valuesOf(unit).aspd}),
});
const mostma=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(let i=0;i<v.hits;i++)for(const target of targets(battle,unit)){
    damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});if(target.alive){battle.push(target,v.force,{from:unit});
      // Replace the normal subjective-time amount, rather than multiplying it.
      const normal=unit.rangeKeySet.has(Math.round(target.y)*21+Math.round(target.x))?1-v.nativeSlow:1;
      buff(battle,unit,target,{key:sourceKey(unit,'key-of-chronology'),mods:{moveMul:(1-v.slow)/normal},duration:v.duration});}}
    return true;},
  link:(battle,unit)=>naturalSpAura(battle,unit,'caster',valuesOf(unit).recovery,t=>t.def.profession==='CASTER'),
  innate:(battle,unit)=>enemyAura(battle,unit,{key:'subjective-time',mods:{moveMul:1-valuesOf(unit).nativeSlow},select:t=>unit.rangeKeySet.has(Math.round(t.y)*21+Math.round(t.x))}),
});
const billro=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:ctx=>{ctx.unit.mem.adaptBillroCharged=ctx.unit.skill.maxCharges>1&&ctx.unit.skill.charges>=ctx.unit.skill.maxCharges;return canAttack(ctx);},
  cast:({battle,unit})=>{const v=valuesOf(unit),charged=unit.mem.adaptBillroCharged;heal(battle,unit,unit,{maxHpRatio:charged?v.chargedHeal:v.heal});
    const layers=new Map();for(let i=0;i<v.hits;i++)for(const target of targets(battle,unit)){
      const mark=layers.get(target)??0,scale=(1+v.atk*i/Math.max(1,v.hits-1))*(1+mark*v.mark);
      damage(battle,unit,target,{scale,type:'arts',isSkill:true});if(charged)layers.set(target,Math.min(v.maxMark,mark+1));}return true;},
  link:(battle,unit)=>observeCount(battle,unit,'skillResolved','feast-of-life',p=>yours(unit,p.source)&&p.source!==unit&&p.source.def.profession==='CASTER'&&withinAdjacent4(unit,p.source),
    ({payload})=>heal(battle,unit,payload.source,{maxHpRatio:valuesOf(unit).allyHeal})),
  innate:(battle,unit)=>conditionalSelf(battle,unit,'ready-to-strike',()=>unit.skill.charges>=1?{spRecoveryFlat:valuesOf(unit).recovery}:null),
});
const aglina=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of enemies(battle,unit,{scope:'field',count:999}))applyStatus(battle,unit,target,{status:'weightless',duration:v.duration});
    for(const target of targets(battle,unit)){damage(battle,unit,target,{scale:v.scale,hits:v.hits,type:'arts',isSkill:true});sluggishAttack(battle,unit,target);}return true;},
  link:(battle,unit)=>allyAura(battle,unit,{key:'acceleration-field',mods:{aspd:valuesOf(unit).aspd},select:()=>true}),
  innate:(battle,unit)=>{unit.profile.noAttackUnlessSkill=true;battle.every(1,()=>{if(active(unit)&&!unit.skill.active)
    for(const target of battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId))heal(battle,unit,target,{amount:valuesOf(unit).regen,regen:true});},{owner:unit});},
});
const lisa=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>canAttack({battle,unit})||wounded(ops(battle,unit).filter(t=>inRange(unit,t))).length>0,
  cast:({battle,unit})=>{const v=valuesOf(unit);for(const target of targets(battle,unit)){
    applyStatus(battle,unit,target,{status:'sluggish',duration:v.duration});applyStatus(battle,unit,target,{status:'fragile',value:v.skillFragile,duration:v.duration});}
    for(const target of battle.allyUnits.filter(t=>active(t)&&t.ownerId===unit.ownerId&&inRange(unit,t)))for(let i=0;i<v.heals;i++)heal(battle,unit,target,{scale:v.heal,regen:true});return true;},
  link:(battle,unit)=>battle.every(.25,()=>{if(active(unit))for(const target of enemies(battle,unit,{count:999}).filter(t=>hasStatus(t,'sluggish')))
    applyStatus(battle,unit,target,{status:'fragile',value:valuesOf(unit).fragile,duration:.51});},{owner:unit}),
  innate:(battle,unit)=>naturalSpAura(battle,unit,'support',valuesOf(unit).recovery,t=>t.def.profession==='SUPPORT'),
});

const STORM_X1=[[2,0],[1,-1],[1,0],[1,1],[0,-2],[0,-1],[0,0],[0,1],[0,2],[-1,-1],[-1,0],[-1,1],[-2,0]];
const pasngr=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{const v=valuesOf(unit),center=targets(battle,unit,unit,999).sort((a,b)=>b.hp-a.hp||a.id-b.id)[0],row=Math.round(center.y),col=Math.round(center.x);
    const keys=new Set(STORM_X1.map(([dr,dc])=>(row+dr)*21+col+dc)),sequence=unit.deploySeq;
    battle.fx('storm',{x:col,y:row,id:unit.id,duration:v.duration,r:2});
    for(let tick=1;tick<=Math.round(v.duration/v.interval);tick++)battle.after(tick*v.interval,()=>{
      if(!active(unit)||unit.deploySeq!==sequence)return;
      battle.assaultRuntime.withCause(cause,()=>{
        const pool=enemies(battle,unit,{scope:'field',count:999}).filter(t=>bodyInKeys(t,keys));if(!pool.length)return;
        const seen=new Set();let target=pool[Math.floor(battle.rng()*pool.length)];
        for(let jump=0;jump<v.chain&&target;jump++){
          seen.add(target);damage(battle,unit,target,{scale:v.scale*powi(1-(unit.profile.chain?.falloff??.15),jump),type:'arts',isSkill:true});
          if(target.alive)applyStatus(battle,unit,target,{status:'sluggish',duration:v.sluggish});
          const previous=target;target=enemies(battle,unit,{scope:'field',count:999}).filter(t=>!seen.has(t)&&bodyDist(t,previous.x,previous.y)<=(unit.profile.chain?.radius??1.7))
            .sort((a,b)=>bodyDist(a,previous.x,previous.y)-bodyDist(b,previous.x,previous.y)||a.id-b.id)[0];
        }
      });
    },{owner:unit});return true;},
  link:(battle,unit)=>{
    const marks=new WeakMap();
    battle.on('hit',({source,target,dmg})=>{if(active(unit)&&yours(unit,source)&&source.def.profession==='CASTER'&&(marks.get(target)?.get(source)??0)>battle.time)dmg.mul*=1+valuesOf(unit).bonus;},{owner:unit,priority:40});
    battle.on('damaged',({source,target,amount,dmg})=>{
      if(!active(unit)||!yours(unit,source)||source.def.profession!=='CASTER'||!(dmg.isAttack||dmg.isSkill)||!(amount>0)||target?.side!=='enemy'||(target.hp+amount)/target.s.maxHp<=valuesOf(unit).threshold)return;
      if(!marks.has(target))marks.set(target,new Map());marks.get(target).set(source,battle.time+valuesOf(unit).markTime);
    },{owner:unit});
  },
  innate:(battle,unit)=>conditionalSelf(battle,unit,'sole-soldier',()=>!enemies(battle,unit,{scope:'adjacent4',count:1}).length?{atkPct:valuesOf(unit).aloneATK}:null),
});

function windTouches(enemy,wind){const r=hitRect(enemy);return r?r.x0<=wind.x+.5&&r.x1>=wind.x-.5&&r.y0<=wind.y+.5&&r.y1>=wind.y-.5:Math.abs(enemy.x-wind.x)<=.5&&Math.abs(enemy.y-wind.y)<=.5;}
const heyak=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit,cause})=>{
    const v=valuesOf(unit),[fr,fc]=dirVec(unit.dir),origin={x:unit.x,y:unit.y},sequence=unit.deploySeq;
    for(let wave=0;wave<v.waves;wave++)for(const lane of[0,1,-1]){
      const [dr,dc]=rotateOffset(lane,0,unit.dir);
      battle.after(battle.rng()*.3,()=>{
        if(!active(unit)||unit.deploySeq!==sequence)return;
        const wind={x:origin.x+dc,y:origin.y+dr,age:0,left:v.flight,fxAt:0};
        const timer=battle.every(battle.dt,()=>{
          wind.age+=battle.dt;wind.left-=battle.dt;wind.x+=fc*battle.dt;wind.y+=fr*battle.dt;
          const candidates=enemies(battle,unit,{scope:'field',count:999}).filter(t=>windTouches(t,wind)).sort((a,b)=>bodyDist(a,wind.x,wind.y)-bodyDist(b,wind.x,wind.y)||a.id-b.id);
          const target=candidates[0];
          if(target){battle.assaultRuntime.withCause(cause,()=>{
            applyStatus(battle,unit,target,{status:'levitate',duration:v.lift});
            const scale=v.min+(v.max-v.min)*Math.min(1,wind.age/v.ramp);
            damage(battle,unit,target,{scale,type:'arts',isSkill:true});
          });timer.cancel();return;}
          if(wind.age+1e-9>=wind.fxAt){battle.fx('tornado',{x:wind.x,y:wind.y,id:unit.id,r:.5,dur:.6});wind.fxAt+=.5;}
          if(wind.left<=0)timer.cancel();
        });
      },{owner:unit});
    }return true;
  },
  link:(battle,unit)=>{const credited=actualDamageLink(battle,unit,sourceKey(unit,'air-benefit'));battle.on('hit',({source,target,dmg})=>{
    if(!active(unit)||!yours(unit,source)||target?.side!=='enemy'||!target.isFlying&& !target.s.flags.levitate||!(dmg.isAttack||dmg.isSkill))return;
    const prior=dmg.adaptHeyakBonus??0,value=valuesOf(unit).air,before=linkDamagePotential(source,target,dmg);
    if(value>prior){dmg.mul*=(1+value)/(1+prior);dmg.adaptHeyakBonus=value;
      if(linkDamagePotential(source,target,dmg)>before+1e-9)credited(dmg,()=>dmg.adaptHeyakBonus===value);}
    applyStatus(battle,unit,target,{status:'silence',duration:valuesOf(unit).silence});
  },{owner:unit,priority:40});},
  innate:(battle,unit)=>battle.every(.25,()=>{if(active(unit))for(const target of enemies(battle,unit,{count:999}).filter(t=>t.hp/t.s.maxHp>valuesOf(unit).threshold))
    applyStatus(battle,unit,target,{status:'weightless',duration:.51});},{owner:unit}),
});

function logosWord(battle,unit,target){if(target.alive)buff(battle,unit,target,{key:'adaptation:logos:word',mods:{resFlat:-valuesOf(unit).res},duration:valuesOf(unit).markTime});}
function lexicon(battle,unit,attackScale=1){const v=valuesOf(unit);if(battle.rng()>=v.chance)return;
  const list=targets(battle,unit,unit,999),target=list[Math.floor(battle.rng()*list.length)];if(!target)return;
  damage(battle,unit,target,{scale:v.echo*attackScale,type:'arts'});if(target.alive)applyStatus(battle,unit,target,{status:'sluggish',duration:v.slow});}
const logos=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:canAttack,
  cast:({battle,unit})=>{const v=valuesOf(unit);unit.mem.adaptLogosInterceptions=(unit.mem.adaptLogosInterceptions??0)+v.intercepts;
    for(let i=0;i<v.hits;i++)for(const target of targets(battle,unit)){
      logosWord(battle,unit,target);damage(battle,unit,target,{scale:v.scale,type:'arts',isSkill:true});lexicon(battle,unit,v.scale);}return true;},
  link:(battle,unit)=>battle.on('hit',({source,target,dmg})=>{
    if(source===unit&&dmg.isAttack)logosWord(battle,unit,target);
    if(active(unit)&&target.findBuff('adaptation:logos:word')&&dmg.type==='arts'){
      const prior=dmg.adaptLogosFlat??0,value=valuesOf(unit).flat;if(value>prior){dmg.amount+=value-prior;dmg.adaptLogosFlat=value;}}
  },{owner:unit,priority:100}),
  innate:(battle,unit)=>{
    battle.on('attack',({attacker,targets:hit})=>{if(attacker===unit)for(const _target of hit)lexicon(battle,unit);},{owner:unit});
    const captured=new WeakSet();battle.every(.05,()=>{
      if(!active(unit)||!(unit.mem.adaptLogosInterceptions>0))return;
      for(const projectile of battle.projectiles?.list??[]){
        if(!(unit.mem.adaptLogosInterceptions>0))break;
        if(projectile.source?.side!=='enemy'||captured.has(projectile)||!inRange(unit,projectile))continue;
        captured.add(projectile);unit.mem.adaptLogosInterceptions--;const v=valuesOf(unit);
        projectile.speed*=v.projectileScale;projectile.maxAge=Math.max(projectile.maxAge,projectile.age+v.hold+1);
        battle.after(v.hold,()=>{const list=battle.projectiles?.list,index=list?.indexOf(projectile)??-1;
          if(index>=0){list.splice(index,1);battle.fx('bulletClear',{x:projectile.x,y:projectile.y,id:unit.id,n:1});}});
      }
    },{owner:unit});
  },
});

export const adaptationCasterKits=Object.freeze({char_002_amiya:amiya,char_388_mint:mint,char_4079_haini:haini,char_4032_provs:provs,
  char_4122_grabds:grabds,char_213_mostma:mostma,char_426_billro:billro,char_291_aglina:aglina,char_358_lisa:lisa,
  char_472_pasngr:pasngr,char_4027_heyak:heyak,char_4133_logos:logos});
