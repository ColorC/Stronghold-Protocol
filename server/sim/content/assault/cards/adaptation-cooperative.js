import { adaptedKit } from '../adapted-kit.js';
import { active, buff, damage, heal, applyStatus } from '../primitives.js';
import { valuesOf, ops, targets, anchor, sourceKey, tagged } from './adaptation-core.js';
import { grantAttackUses, grantHitUses } from './adaptation-support.js';
import { sourceKit, installSourceParts, installResourceParts, instantAttack, observeNativeLinkBuffs, observeNativeLinkHeal } from './adaptation-native.js';
import { allyAura } from '../synergy.js';
import cetsyrKits from '../../kits/ops/chess_char_5_09-cetsyr.js';
import celloKits from '../../kits/ops/chess_char_6_09-cello.js';
import reedKits from '../../kits/ops/chess_char_6_08-reed2.js';
import titiKits from '../../kits/ops/chess_char_5_02-titi.js';
import shuKits from '../../kits/ops/op-shu.js';
import yuKits from '../../kits/ops/chess_char_6_03-yu.js';

const originals=new WeakMap();
const inRange=(u,t)=>anchor(u).rangeKeySet.has(t.tileR*21+t.tileC);
const friends=(b,u)=>b.allyUnits.filter(t=>active(t)&&t.side==='ally'&&t.ownerId===u.ownerId&&t.kind!=='device'&&inRange(u,t));
const wounded=list=>list.filter(t=>t.hp<t.s.maxHp-1e-7&&!t.s.flags.noHeal&&!t.s.flags.healFree).sort((a,b)=>a.hpRatio-b.hpRatio||a.id-b.id);
function inSkillRange(b,u,action){const grid=u.rangeGrid;u.rangeGrid=u.def.raw.assaultBody.adaptation.rangeGrid;b.refreshRange(u);
  try{return action();}finally{u.rangeGrid=grid;b.refreshRange(u);}}
const cetsyr=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle:b,unit:u})=>{const v=valuesOf(u),list=friends(b,u);
    for(const a of list){if(a!==u)grantHitUses(b,u,a,'cetsyr-inspire',v.uses,{mods:{hpFlat:u.s.maxHp*v.hp},inspire:true});
      b.addBuff(a,{key:'cetsyr:mote',duration:6,data:{src:u,mul:1.5},source:u,visible:true});}
    for(let i=0;i<v.pulses;i++){
      const alive=list.filter(active),max=alive.reduce((n,a)=>n+a.s.maxHp,0),hp=alive.reduce((n,a)=>n+a.hp,0);
      if(max>0)for(const a of alive)a.hp=Math.min(a.s.maxHp,a.s.maxHp*hp/max);
      for(const a of alive)heal(b,u,a,{scale:v.heal*1.5,regen:true});
      b.fx('hpShare',{x:u.x,y:u.y,id:u.id,ratio:max?Math.round(hp/max*1000)/1000:0});
    }return true;},
  innate:(b,u)=>{const kit=sourceKit(u,cetsyrKits.chess_char_5_09_a);kit.talents[0].install(b,u);kit.install?.(b,u);
    const team=b.adaptCetsyrProtection??=new Map(),copies=team.get(u.ownerId)??new Set();copies.add(u);team.set(u.ownerId,copies);
    if(copies.size!==1)return;
    b.on('hit',({source,target,dmg})=>{if(target?.side!=='ally'||target.ownerId!==u.ownerId||!source?.def?.tags?.includes('sarkaz'))return;
      const best=Math.max(0,...[...copies].filter(active).map(c=>valuesOf(c).protect));if(best)dmg.mul*=1-best;
    });
  },
});

function bubble(b,u,a,strong){const v=valuesOf(u),atk=u.s.atk*(strong?v.scale:1),key='haruka-bubbles';
  grantHitUses(b,u,a,key,1,{mods:{physTakenMul:1-(strong?v.protect:v.base),artsTakenMul:1-(strong?v.protect:v.base)},anyDamage:true,
    onUse:({enemy})=>{
      if(strong&&active(enemy)&&!enemy.s.flags.invulnerable&&!enemy.s.flags.untargetable&&applyStatus(b,u,enemy,{status:'levitate',duration:v.levitate})){
        for(let i=0;i<v.levitate;i++)b.after(.5+i,()=>{if(active(enemy)&&enemy.s.flags.levitate)damage(b,u,enemy,{amount:atk*v.dot,type:'arts',canDodge:false,isSkill:true});});
      }
      b.after(.5,()=>{if(active(a))heal(b,u,a,{amount:atk*v.popHeal});});
    }});
  b.fx('shield',{id:a.id,x:a.x,y:a.y,kind:'bubble'});
}
const haruka=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle:b,unit:u})=>{const v=valuesOf(u);for(let i=0;i<v.heals;i++){const a=wounded(friends(b,u))[0];if(a)heal(b,u,a,{scale:v.scale});}
    const a=friends(b,u).sort((a,c)=>a.hpRatio-c.hpRatio||a.id-c.id)[0];if(a)for(let i=0;i<v.uses;i++)bubble(b,u,a,true);return true;},
  innate:(b,u)=>{
    const grant=()=>{const a=friends(b,u).filter(t=>!t.mem.adaptHitUses?.['haruka-bubbles']?.length).sort((a,c)=>a.hpRatio-c.hpRatio||a.id-c.id)[0];
      if(!a)return false;bubble(b,u,a,false);return true;};
    b.on('attack',p=>{if(p.attacker===u&&active(u)&&!p.isSkill)grant();},{owner:u});
    b.on('tick',()=>{if(active(u)&&u.canAct&&!u.s.flags.disarm&&u.atkCd<=0&&u.trait.hadTarget===false&&grant())u.atkCd=u.s.interval;},{owner:u});
  },
});

const cello=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle:b,unit:u})=>inSkillRange(b,u,()=>{const v=valuesOf(u),list=friends(b,u).filter(t=>t!==u&&t.kind==='op');
    const top=key=>[...list].sort((a,c)=>c.base[key]-a.base[key]||a.id-c.id)[0];
    const hp=top('maxHp'),atk=top('atk'),guard=top('def');
    if(hp)grantHitUses(b,u,hp,'tango-hp',v.uses,{mods:{hpPct:v.bonus}});
    if(atk)grantAttackUses(b,u,atk,'tango-atk',v.uses,{atk:v.bonus});
    if(guard)grantHitUses(b,u,guard,'tango-def',v.uses,{mods:{defPct:v.bonus}});
    u.mem.celloBoost=v.mult;
    try{for(let i=0;i<v.pulses;i++)for(const e of targets(b,u)){
      damage(b,u,e,{scale:v.element,type:'element',element:'apoptosis',isSkill:true});if(active(e))applyStatus(b,u,e,{status:'sluggish',duration:.2});
    }}finally{u.mem.celloBoost=1;}return true;}),
  innate:(b,u)=>{const kit=sourceKit(u,celloKits.chess_char_6_09_a,{}, {1:{ep_damage_scale:1+valuesOf(u).amp}});installSourceParts(b,u,kit);},
});

function scorch(b,u,e,atk){if(!active(e))return;const v=valuesOf(u),key=sourceKey(u,'scorch');
  b.addBuff(e,{key,duration:u.mem.adaptReedPulses?.length?Infinity:v.seconds,mods:{atkPct:-v.weaken},source:u,visible:true,data:{atk}});
  applyStatus(b,u,e,{status:'artsFragile',value:v.fragile,duration:u.mem.adaptReedPulses?.length?Infinity:v.seconds});
}
const reed2=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>targets(battle,unit).length>0,
  cast:({battle:b,unit:u})=>{const v=valuesOf(u),pool=u.mem.adaptReedPulses??=[];
    for(let i=0;i<v.pulses;i++)pool.push({atk:u.s.atk*v.scale,...v});
    for(let i=0;i<v.hits;i++)instantAttack(b,u,targets(b,u),{scale:v.scale,type:'arts',onHit:e=>scorch(b,u,e,u.s.atk*v.scale)});return true;},
  innate:(b,u)=>{const kit=sourceKit(u,reedKits.chess_char_6_08_a,{}, {1:{scale:valuesOf(u).share}});
    observeNativeLinkHeal(b,u,'reflect-heal',(source,target,options)=>source===u&&target===u&&options.reflect===true);kit.talents[1].install(b,u);
    b.on('damaged',p=>{if(p.source===u&&p.dmg?.isAttack&&p.target.side==='enemy'&&active(p.target)&&(u.mem.adaptReedPulses?.length||b.rng.chance(.3)))scorch(b,u,p.target,u.s.atk);},{owner:u});
    b.every(1,()=>{if(!active(u))return;const v=u.mem.adaptReedPulses?.shift();if(!v)return;
      for(const e of b.enemies.filter(e=>active(e)&&e.findBuff(sourceKey(u,'scorch'))))damage(b,u,e,{amount:v.atk*v.dot,type:'arts',isSkill:true,canDodge:false});
      if(!u.mem.adaptReedPulses.length)for(const e of b.enemies){const mark=e.findBuff(sourceKey(u,'scorch'));if(mark)mark.timeLeft=v.seconds;
        for(const f of e.buffs)if(f.status==='artsFragile'&&f.source===u&&f.timeLeft===Infinity)f.timeLeft=v.seconds;}
    },{owner:u});
    b.on('kill',({victim:e})=>{const mark=e.findBuff(sourceKey(u,'scorch'));if(!mark||!u.mem.adaptReedPulses?.length||!active(u))return;
      const v=valuesOf(u),atk=mark.data.atk;
      b.assaultRuntime.enqueue(()=>{for(const other of b.foesInRadius(e.x,e.y,v.radius))if(active(other)){
        scorch(b,u,other,atk);damage(b,u,other,{amount:atk*v.explosion,type:'arts',isSkill:true,canDodge:false});}
        b.fx('splash',{id:e.id,x:e.x,y:e.y,r:v.radius,src:u.id});
      },{key:sourceKey(u,`scorch-explosion:${e.id}`),targetUid:e.uid,cause:b.assaultRuntime.currentCause});
    },{owner:u});
  },
});

function sleepOthers(b,u,from){const list=b.foesInRadius(from.x,from.y,1.5).filter(e=>e!==from&&!e.s.flags.sleep&&!e.mem?.candleOwner)
  .sort((a,c)=>(c.s.taunt??0)-(a.s.taunt??0)||(a.x-from.x)*(a.x-from.x)+(a.y-from.y)*(a.y-from.y)-(c.x-from.x)*(c.x-from.x)-(c.y-from.y)*(c.y-from.y)||a.spawnSeq-c.spawnSeq);
  if(list[0])applyStatus(b,u,list[0],{status:'sleep',duration:5});
}
const titi=(_bb,_raw,def)=>adaptedKit(def,{
  canCast:({battle,unit})=>targets(battle,unit).length>0,
  cast:({battle:b,unit:u})=>{const v=valuesOf(u);u.mem.adaptTitiWakes=(u.mem.adaptTitiWakes??0)+v.wakes;u.mem.adaptTitiGuards=(u.mem.adaptTitiGuards??0)+v.guards;
    for(let i=0;i<v.hits;i++)instantAttack(b,u,targets(b,u),{scale:v.scale,type:'arts',onHit:e=>{if(!e.s.flags.sleep)applyStatus(b,u,e,{status:'sleep',duration:5});}});return true;},
  innate:(b,u)=>{const kit=sourceKit(u,titiKits.chess_char_5_02_a);kit.talents[0].install(b,u);u.profile.hitSleep=true;
    allyAura(b,u,{key:'courage',mods:{aspd:valuesOf(u).aspd},select:a=>(tagged(a,'萨尔贡')||tagged(a,'米诺斯'))&&a.hpRatio>.5});
    const asleep=new Map();b.on('statusApplied',p=>{if(p.status==='sleep'&&p.target.side==='enemy'&&!asleep.has(p.target))asleep.set(p.target,b.time);},{owner:u});
    b.on('tick',()=>{for(const[e,start]of asleep){if(!e.alive){asleep.delete(e);continue;}if(e.s.flags.sleep)continue;asleep.delete(e);
      if(!active(u)||!(u.mem.adaptTitiWakes>0))continue;u.mem.adaptTitiWakes--;
      const scale=1+3.6*Math.min(1,(b.time-start)/5);damage(b,u,e,{scale,type:'arts',isSkill:true});sleepOthers(b,u,e);b.fx('wake',{x:e.x,y:e.y,id:e.id,scale});
    }},{owner:u});
    b.on('kill',({victim:e})=>{if(!asleep.has(e))return;asleep.delete(e);if(active(u)&&u.mem.adaptTitiWakes>0){u.mem.adaptTitiWakes--;sleepOthers(b,u,e);}},{owner:u});
    b.on('fatal',ctx=>{const a=ctx.unit;if(ctx.prevented||a===u||a.side!=='ally')return;const guard=a.findBuff('titi:allySleep');
      if(guard){if(guard.data.src===u)ctx.prevented=true;return;}
      if(!active(u)||!(u.mem.adaptTitiGuards>0)||a.kind!=='op'||!inRange(u,a))return;
      u.mem.adaptTitiGuards--;ctx.prevented=true;b.addBuff(a,{key:'titi:allySleep',flags:{sleep:true},status:'sleep',visible:true,data:{src:u},source:u,interval:.2,
        onTick:({unit:x,buff:f})=>{if(x.hp>=x.s.maxHp-1e-6)b.removeBuff(x,f);}});
      b.releaseBlocked(a);b.emit('statusApplied',{source:u,target:a,status:'sleep',duration:Infinity,entered:true});b.fx('sleepGuard',{x:a.x,y:a.y,id:a.id});
    },{owner:u,priority:5});
    b.on('death',p=>{if(p.unit===u)for(const a of b.allyUnits){const f=a.findBuff('titi:allySleep');if(f?.data.src===u)b.removeBuff(a,f);}},{owner:u});
  },
});

function harvestAndReturn(b,u){if(!active(u))return;const v=valuesOf(u),tiles=u.mem.shuSown??new Set(),marks=u.mem.adaptShuMarks??=new Map();
  const ground=b.enemies.filter(e=>active(e)&&!e.isFlying);
  if(u.mem.adaptShuHarvest>0&&ground.some(e=>tiles.has(Math.round(e.y)*21+Math.round(e.x)))){
    for(const a of friends(b,u).filter(a=>a.kind==='op'))grantAttackUses(b,u,a,'shu-harvest',u.mem.adaptShuHarvest*v.harvestUses,{atk:v.atk,aspd:v.aspd});u.mem.adaptShuHarvest=0;
  }
  if(!(u.mem.adaptShuReturns>0))return;
  for(const e of ground){if(!(u.mem.adaptShuReturns>0))break;const r=Math.round(e.y),c=Math.round(e.x),key=r*21+c,m=marks.get(e.id);
    if(!m){if(tiles.has(key))marks.set(e.id,{r,c,last:key});continue;}if(key===m.last)continue;m.last=key;
    if(Math.abs(r-m.r)+Math.abs(c-m.c)<v.distance)continue;
    e.x=m.c;e.y=m.r;b._unblock(e);if(e.route)e.route.pts=null;m.last=m.r*21+m.c;u.mem.adaptShuReturns--;b.fx('teleport',{x:m.c,y:m.r,id:e.id,src:u.id});
  }
}
const shu=(_bb,_raw,def)=>adaptedKit(def,{
  cast:({battle:b,unit:u})=>inSkillRange(b,u,()=>{const v=valuesOf(u);u.mem.adaptShuReturns=(u.mem.adaptShuReturns??0)+v.returns;u.mem.adaptShuHarvest=(u.mem.adaptShuHarvest??0)+1;
    for(let i=0;i<v.hits;i++){const list=targets(b,u);if(list.length)instantAttack(b,u,list,{scale:v.scale,type:'phys'});
      const a=wounded(friends(b,u).filter(a=>!list.length||a!==u))[0];if(a)heal(b,u,a,{scale:v.scale});}
    harvestAndReturn(b,u);return true;}),
  innate:(b,u)=>{observeNativeLinkBuffs(b,u,'seasons',(_target,spec)=>spec.source===u&&spec.key?.startsWith('talent:shu:seasons:'));
    installSourceParts(b,u,sourceKit(u,shuKits.char_2025_shu));b.on('tick',()=>harvestAndReturn(b,u),{owner:u});
    b.on('death',p=>{if(p.unit===u)u.mem.adaptShuMarks?.clear();},{owner:u});
  },
});

function addWall(b,u){u.mem.adaptYuWall=(u.mem.adaptYuWall??0)+valuesOf(u).uses;originals.get(u).skill.onStart({battle:b,unit:u});}
function spendWall(u){if(u.mem.adaptYuWall>0)u.mem.adaptYuWall--;if(!u.mem.adaptYuWall)u.mem.yuWall=null;}
const yu=(_bb,_raw,def)=>adaptedKit(def,{
  state:({battle:b,unit:u})=>({mods:{hpPct:valuesOf(u).stats,atkPct:valuesOf(u).stats,defPct:valuesOf(u).stats},enter:()=>addWall(b,u),repeat:()=>{addWall(b,u);return true;}}),
  innate:(b,u)=>{const v=valuesOf(u),kit=sourceKit(u,yuKits.chess_char_6_03_a,{prob:v.prob,ep_damage_ratio:v.burn});originals.set(u,kit);
    installResourceParts(b,u,kit,()=>active(u)&&u.mem.adaptYuWall>0);
    b.on('elementHit',p=>{if(p.source===u&&p.dmg.tags?.includes('firewall'))spendWall(u);},{owner:u,priority:-1000});
    const fx=b.fx;b.fx=function(type,data){const result=fx.call(this,type,data);if(type==='firewallBlock'&&data.id===u.id)spendWall(u);return result;};
    b.on('deploy',p=>{if(p.unit===u&&u.mem.adaptYuWall>0)kit.skill.onStart({battle:b,unit:u});},{owner:u});
  },
});
export const adaptationCooperativeKits=Object.freeze({char_4134_cetsyr:cetsyr,char_4202_haruka:haruka,char_245_cello:cello,char_1020_reed2:reed2,char_4056_titi:titi,char_2025_shu:shu,char_2026_yu:yu});
