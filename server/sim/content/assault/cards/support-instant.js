// Explicit single-cast translations. Character numbers live in the design DTO.
// A granted shield/status may outlive its cast; no caster attack stance is armed.
import { active, allies, enemies, uid, v, heal, buff, applyStatus, sp, gainDP, unitTag } from '../primitives.js';
import { registerAssaultAmmo, consumeAssaultAmmo, unregisterAssaultAmmo, assaultAmmoState, reloadAssaultAmmo } from '../ammo.js';
import { wanqinFacingInRange } from './support-modules.js';
import { supportModuleValue as moduleValue } from './support-modules.js';
import { tileKeyOf, absoluteRangeKeys } from '../../../targeting.js';

export const isSupportSingleCast = body => body.fixedSkill.resolution === 'single-cast-v2';
const params = u => u.def.raw.assaultBody.fixedSkill.effects[0].values;
const value = (u, p, key, fallback = 0) => p[key] == null ? fallback : Number(v(u, p[key]));
const selectedModule = (u, suffix) => u.assaultSupportModules?.has('uniequip_'+suffix) === true;
const hostiles = (b, u, count = 99, scope = 'range') => {
  const selected=enemies(b,u,{scope,count});
  if(scope!=='adjacent8')return selected;
  // Surrounding attacks include enemies blocked on the caster's own cell.
  return [...new Set([...b.enemiesInKeys([tileKeyOf(u)],u,u.profile),...selected])].slice(0,count);
};
const friends = (b, u, scope = 'range') => allies(b,u,{scope,count:99}).filter(t => t.ownerId === u.ownerId);
function skillFriends(b,u,p) {
  if(u.def.charId!=='char_2025_shu')return friends(b,u,p.scope??'range');
  const grid=u.def.raw.assaultBody.fixedSkill.runtime.sourceRangeGrid;
  if(!Array.isArray(grid))throw new Error('Shu S1 requires its native healing range');
  const anchor={...u,rangeKeys:absoluteRangeKeys(grid,u.tileR,u.tileC,u.dir)};
  return allies(b,u,{anchor,scope:'range',count:99}).filter(t=>t.ownerId===u.ownerId);
}
const near = (a,b,r=1) => Math.abs(a.x-b.x)<=r && Math.abs(a.y-b.y)<=r;
const wounded = list => list.filter(t => t.hp < t.s.maxHp-1e-7);
const key = u => `assault:${u.def.charId}:instant`;
function hit(b,u,t,scale,type,cause,extra={}) {
  return b.assaultRuntime.withCause(cause,()=>b.dealDamage(u,t,{amount:u.s.atk*scale,type,isSkill:true,isAttack:true,attackId:key(u),...extra}));
}
function shield(b,u,t,amount,{type=null,hits=0,suffix='',duration=Infinity}={}) {
  const id=key(u)+':shield'+suffix,old=t.findBuff(id);
  return b.addBuff(t,{key:id,shield:Math.max(amount,old?.shield??0),shieldHits:Math.max(hits,old?.shieldHits??0),
    ...(type?{shieldType:type}:{}),duration,refresh:'replace',source:u,visible:true,tags:['skill']});
}
function status(b,u,t,name,duration,cause,amount) {
  return applyStatus(b,u,t,{status:name,duration,...(amount==null?{}:{value:amount}),key:key(u)+':'+name,cause});
}
const hitGrants=new WeakMap();
function nextAttackGrant(b,u,t,{kind,shield:barrier=null,counterAmount=0,counterType='arts',healAmount=0,leech=0,damageType=null,damageMultiplier=1,cause}) {
  let grants=hitGrants.get(b);
  if(!grants){
    grants=new Map();hitGrants.set(b,grants);
    b.on('hit',event=>{
      const e=event.payload??event;
      if(e.source?.side!=='enemy'||!e.dmg?.isAttack||e.dmg.cancel)return;
      for(const [id,state]of grants){
        if(state.target!==e.target)continue;
        if(state.damageType&&e.dmg.type!==state.damageType)continue;
        if(state.barrier&&!state.target.buffs.includes(state.barrier)){grants.delete(id);continue;}
        grants.delete(id);
        e.dmg.mul=(e.dmg.mul??1)*state.damageMultiplier;
        b.assaultRuntime.enqueue(()=>{
          if(state.barrier)b.removeBuff(state.target,state.barrier);
          if(state.healAmount>0&&active(state.target))heal(b,state.source,state.target,{amount:state.healAmount,cause:state.cause});
          if(state.counterAmount>0&&active(e.source)){
            const dealt=b.dealDamage(state.source,e.source,{amount:state.counterAmount,type:state.counterType,isSkill:true,attackId:key(state.source)+':'+state.kind});
            if(dealt>0&&state.leech>0&&active(state.source))heal(b,state.source,state.source,{amount:dealt*state.leech,cause:state.cause});
          }
        },{key:key(state.source)+':'+state.kind,sourceUid:uid(state.source),targetUid:uid(state.target),cause:state.cause});
      }
    });
    const clear=event=>{const target=event.unit??event.target;for(const [id,state]of grants)if(state.target===target)grants.delete(id);};
    b.on('death',clear);b.on('retreating',clear);
  }
  grants.set(`${uid(u)}:${uid(t)}:${kind}`,{source:u,target:t,kind,barrier,counterAmount,counterType,healAmount,leech,damageType,damageMultiplier,cause});
}
function ammoBurst(b,u,rounds,fn) {
  // This is the firing counter, shared with collectibles only while firing.
  const pool={left:rounds};
  const controller=registerAssaultAmmo(b,u,{get:()=>pool.left,set:n=>{pool.left=n;},max:()=>rounds});
  try { for(let i=0;i<rounds;i++){if(!consumeAssaultAmmo(b,u,1,key(u),{isSkill:true}))break;fn(i);} }
  finally { pool.left=0; unregisterAssaultAmmo(u,controller); }
}

export function canCastSupportSingle({battle:b,unit:u}) {
  const id=u.def.charId,p=params(u),foes=hostiles(b,u),own=skillFriends(b,u,p);
  if(['char_240_wyvern','char_151_myrtle','char_249_mlyss','char_4119_wanqin','char_420_flamtl'].includes(id))return true;
  if(['char_107_liskam','char_150_snakek','char_199_yak'].includes(id))return true;
  if(id==='char_2025_shu')return own.some(t=>t.hp/t.s.maxHp < value(u,p,'hpThreshold',.5));
  if(['char_181_flower','char_4139_papyrs','char_4222_taraxa','char_128_plosis','char_494_vendla'].includes(id))return wounded(own).length>0;
  if(id==='char_4114_harold')return own.some(t=>t.hp<t.s.maxHp || Object.values(t.elem??{}).some(n=>n>0));
  if(id==='char_1020_reed2')return own.some(a=>b.enemies.some(t=>active(t)&&near(t,a)));
  if(id==='char_220_grani')return (u.blocking??[]).some(active);
  if(id==='char_4056_titi')return b.enemies.some(t=>active(t)&&(u.rangeKeySet??new Set(u.rangeKeys)).has(tileKeyOf(t)));
  if(id==='char_4207_branch')return hostiles(b,u,99,'adjacent8').some(t=>!t.isFlying);
  return foes.length>0;
}

export function castSupportSingle(ctx) {
  const {battle:b,unit:u,cause}=ctx,id=u.def.charId,p=params(u),n=(k,f=0)=>value(u,p,k,f);
  const foes=hostiles(b,u),own=skillFriends(b,u,p),target=foes[0],injured=wounded(own);
  const healTargets=(list,scale=n('healScale'))=>{for(const t of list)heal(b,u,t,{scale,cause});};
  const damageTargets=(list,scale=n('atkScale'),type=p.damageType??'phys')=>{for(const t of list)if(active(t))hit(b,u,t,scale,type,cause);};
  const selfShield=()=>shield(b,u,u,u.s.maxHp*n('shieldRatio'));
  if(n('costGain'))gainDP(b,u,n('costGain'),key(u),cause);
  switch(id) {
    case 'char_240_wyvern': return true;
    case 'char_107_liskam':
      shield(b,u,u,0,{hits:n('shieldHits'),suffix:':charge'});
      buff(b,u,u,{key:key(u)+':native-defense',mods:{defMul:1+n('def')+(selectedModule(u,'002_liskam')?.1:0)},duration:n('duration'),cause});
      return true;
    case 'char_2025_shu': {
      const t=own.find(t=>t.hp/t.s.maxHp<n('hpThreshold',.5));if(!t)return false;
      heal(b,u,t,{scale:n('healScale'),cause});
      // 好时节: charge the healed operator {s} (the 4-star shield was removed).
      if(selectedModule(u,'003_shu')&&t.skill?.spType==='time')sp(b,u,t,moduleValue(u,'uniequip_003_shu','s'),'single-cast',key(u),cause);
      return true;
    }
    case 'char_4017_puzzle':
      // 首要任务 no longer marks targets; its kill refund lives in support-modules.
      damageTargets([target]);return true;
    case 'char_4039_horn': {
      const center={x:target.x,y:target.y},radius=n('radius')+(selectedModule(u,'002_horn')?1:0);
      const victims=()=>b.enemies.filter(t=>active(t)&&near(t,center,radius));
      // 旧日新装: two shells at {p}% of the original damage (no SP refund).
      // 典范之人: only the +1 radius (the 4-star arts splash was removed).
      if(selectedModule(u,'003_horn'))ammoBurst(b,u,2,()=>damageTargets(victims(),n('atkScale')*moduleValue(u,'uniequip_003_horn','p',{percent:true})));
      else damageTargets(victims());
      // A fixed light at impact, independent of its caster's later position/life.
      const duration=n('duration'),apply=()=>{for(const t of b.enemies)if(active(t)&&near(t,center,n('radius')))status(b,u,t,'reveal',.3,cause);};
      const until=b.time+duration;apply();let timer;timer=b.every(.2,()=>{if(b.time>=until){timer.cancel();return;}apply();});
      b.fx('splash',{x:center.x,y:center.y,radius:n('radius'),id:u.id});return true;
    }
    case 'char_4087_ines': {
      const snapshot=u.s.atk*n('dotScale'),duration=n('duration');
      b.addBuff(target,{key:key(u)+':bleed',duration,interval:1,refresh:'replace',source:u,visible:true,tags:['skill','dot'],
        onTick:({battle,unit})=>battle.assaultRuntime.withCause(cause,()=>battle.dealDamage(u,unit,{amount:snapshot,type:'arts',isSkill:true,attackId:key(u),tags:['dot']}))});return true;
    }
    case 'char_4139_papyrs': {
      const t=injured[0];if(!t)return false;u.mem.supportPapyrsSkillHealTargets=[t];healTargets([t]);
      const talent=u.def.raw.assaultBody.talentBindings[0]?.translation?.parameters??{};
      const scale=talent.barrierScale==null?0:Number(v(u,talent.barrierScale));
      const k=`assault:${id}:talent:0`,old=t.findBuff(k);
      b.addBuff(t,{key:k,shield:Math.max(old?.shield??0,u.s.atk*scale*n('shieldMultiplier',2)),duration:Number(talent.duration??8),refresh:'replace',source:u,visible:true});
      // 小小的种子: also heal 1 operator orthogonally adjacent to the main target
      // for {a}% ATK (the doubled main-target shield was removed).
      if(selectedModule(u,'002_papyrs')){const secondary=own.filter(a=>a!==t&&a.hp<a.s.maxHp-1e-7&&Math.abs(a.x-t.x)+Math.abs(a.y-t.y)<=1+1e-9).sort((a,z)=>a.hp/a.s.maxHp-z.hp/z.s.maxHp||uid(a).localeCompare(uid(z)))[0];if(secondary)heal(b,u,secondary,{scale:moduleValue(u,'uniequip_002_papyrs','a',{percent:true}),cause});}return true;
    }
    case 'char_4194_rmixer': {
      for(let i=0;i<n('hits',3)&&active(target);i++)damageTargets([target]);
      const reloadTarget=friends(b,u,'adjacent8').find(t=>t!==u&&(unitTag(t,'laterano')||t.def.nationId==='laterano')&&assaultAmmoState(t)?.current<assaultAmmoState(t)?.capacity);
      if(reloadTarget)reloadAssaultAmmo(b,u,reloadTarget,n('reload'),key(u));return true;
    }
    case 'char_420_flamtl':
      for(let i=0;i<n('hits',2);i++)damageTargets(hostiles(b,u,n('maxTargets',6),'adjacent8'));
      for(const t of hostiles(b,u,n('maxTargets',6),'adjacent8'))status(b,u,t,'stun',n('stun'),cause);
      for(const t of own)buff(b,u,t,{key:key(u)+':native-dodge',mods:{dodgePhys:n('physDodge')},duration:n('duration'),cause});return true;
    case 'char_151_myrtle': healTargets(injured.slice(0,1));return true;
    case 'char_181_flower':
      // 爱琴之吻：主动治疗 +a%（数值读 bazaar 模组行）；再生 +2 秒在 support-bazaar.js；受击护理已删
      healTargets(injured,n('healScale')*(selectedModule(u,'002_flower')&&u.assaultStar>=3?1+Number(v(u,u.def.raw.assaultBody.bazaar.modules.uniequip_002_flower.params.a))/100:1));
      return true;
    case 'char_4056_titi': {
      const targets=b.enemiesInKeys(u.rangeKeys,u,{...u.profile,hitSleep:true}).slice(0,n('maxTargets',2));
      for(const t of targets){hit(b,u,t,n('atkScale'),'arts',cause,{ignoreSleep:true});if(active(t))status(b,u,t,'sleep',n('sleep'),cause);}return targets.length>0;
    }
    case 'char_4148_philae':
      for(const t of hostiles(b,u,99,'adjacent8').filter(t=>!t.isFlying)){const dealt=hit(b,u,t,n('atkScale'),'arts',cause);if(dealt>0&&active(t))b.assaultRuntime.withCause(cause,()=>b.dealDamage(u,t,{amount:dealt*n('elementRatio'),type:'element',element:'apoptosis',isSkill:true,attackId:key(u)+':apoptosis'}));}
      shield(b,u,u,u.s.maxHp*n('shieldRatio')*(selectedModule(u,'002_philae')?1.3:1));
      if(selectedModule(u,'002_philae'))nextAttackGrant(b,u,u,{kind:'philae-guard',damageType:'phys',damageMultiplier:.9,cause});return true;
    case 'char_4222_taraxa': {
      const t=injured[0];if(!t)return false;healTargets([t]);healTargets(own.filter(a=>a!==t&&near(a,t)).slice(0,n('splashTargets',2)),n('splashScale'));return true;
    }
    case 'char_1020_reed2': {
      const recipients=own.filter(a=>b.enemies.some(t=>active(t)&&near(t,a))).sort((a,z)=>(z.blocking?.length??0)-(a.blocking?.length??0)||uid(a).localeCompare(uid(z))).slice(0,selectedModule(u,'003_reed2')?moduleValue(u,'uniequip_003_reed2','a'):n('maxTargets',2));
      for(const a of recipients){let total=0;for(const t of b.enemies.filter(t=>active(t)&&near(t,a)))total+=hit(b,u,t,n('atkScale'),'arts',cause);if(total>0)heal(b,u,a,{amount:total,cause});b.fx('splash',{x:a.x,y:a.y,radius:1,id:u.id});}return recipients.length>0;
    }
    case 'char_1034_jesca2': {
      const rounds=n('rounds')+(selectedModule(u,'003_jesca2')?1:0);
      ammoBurst(b,u,rounds,()=>{if(active(target))damageTargets(b.enemies.filter(t=>active(t)&&near(t,target,1)));});
      const mobile=b.allyUnits.find(t=>t.ownerUnit===u&&t.defId==='token_10032_jesca2_jckshd'&&active(t));
      if(mobile){damageTargets(foes.filter(active),n('shieldAtkScale'));for(const t of foes.filter(active))status(b,u,t,'stun',n('stun'),cause);}return true;
    }
    case 'char_128_plosis': healTargets(wounded(own));for(const a of own)if(a.skill?.spType==='time')sp(b,u,a,n('spGain'),'single-cast',key(u),cause);return true;
    case 'char_136_hsguma': damageTargets(foes.filter(t=>near(t,u,1)));selfShield();return true;
    case 'char_150_snakek':
      heal(b,u,u,{maxHpRatio:n('healHpRatio'),cause});selfShield();
      if(selectedModule(u,'002_snakek'))nextAttackGrant(b,u,u,{kind:'shell-return',counterAmount:u.s.def*.3,counterType:'phys',cause});return true;
    case 'char_199_yak': shield(b,u,u,u.s.maxHp*n('artsShieldRatio'),{type:'arts'});return true;
    case 'char_2026_yu': damageTargets(hostiles(b,u,99,'adjacent8'));for(const t of hostiles(b,u,n('maxTargets'),'adjacent8').filter(t=>!t.isFlying))b.assaultTeleportEnemy(t,u);selfShield();return true;
    // 骑警套装: the skill deals {a}% more damage.
    case 'char_220_grani': damageTargets((u.blocking??[]).filter(active),n('atkScale')*(selectedModule(u,'002_grani')?1+moduleValue(u,'uniequip_002_grani','a',{percent:true}):1));selfShield();return true;
    case 'char_249_mlyss': {
      // The token's normal skillResolved observer resamples first. This lower
      // priority observer then consumes one pending action in the same cast flush.
      if(!u.mem.singleMlyssListener){
        u.mem.singleMlyssListener=true;u.mem.singleMlyssActions=[];
        b.assaultRuntime.observe('skillResolved','single-flow:'+uid(u),event=>{
          if(event.payload?.source!==u)return;
          u.mem.singleMlyssActions.shift()?.();
        },{owner:u,priority:-10});
      }
      u.mem.singleMlyssActions.push(()=>{for(const flow of b.allyUnits.filter(t=>t.kind==='token'&&t.ownerUnit===u&&active(t))){
        // 近战/远程流形统一：攻击 1 名敌人并晕眩 1.5 秒（删去远程束缚、回满与近战拉拽）
        const targets=hostiles(b,flow,1,flow.profile.attack==='ranged'?'range':'adjacent8');
        for(const t of targets){hit(b,flow,t,n('atkScale'),flow.profile.dmgType??'phys',cause);if(active(t))status(b,u,t,'stun',1.5,cause);}
      }});return true;
    }
    case 'char_381_bubble': for(const t of hostiles(b,u,99,'adjacent8'))hit(b,u,t,u.s.def*n('defScale')/u.s.atk,'phys',cause,{attackId:`assault:${id}:skill:1`});selfShield();return true;
    case 'char_4114_harold': {
      const load=t=>Math.max(0,...Object.values(t.elem??{}).filter(Number.isFinite));
      const t=own.slice().sort((a,z)=>load(z)-load(a)||a.hp/a.s.maxHp-z.hp/z.s.maxHp||uid(a).localeCompare(uid(z)))[0];if(!t)return false;
      // 腿部护理套装: removes {a}% more element damage (the clear-heal was removed).
      healTargets([t]);b.reduceElement(t,u.s.atk*n('epHealScale')*(selectedModule(u,'002_harold')?1+moduleValue(u,'uniequip_002_harold','a',{percent:true}):1));return true;
    }
    case 'char_4119_wanqin': healTargets(wounded(own));for(const a of friends(b,u,'adjacent8').filter(a=>a!==u))if(a.skill?.spType==='time')sp(b,u,a,n('spGain'),'single-cast',key(u),cause);return true;
    case 'char_4207_branch':
      for(const t of hostiles(b,u,99,'adjacent8').filter(t=>!t.isFlying))status(b,u,t,'fear',n('fear'),cause);
      damageTargets((u.blocking??[]).filter(active));return true;
    case 'char_431_ashlok': {
      // 出门必备套装: the skill splash deals {a}% more damage.
      const center={x:target.x,y:target.y},scale=n('atkScale')*(selectedModule(u,'002_ashlok')?1+moduleValue(u,'uniequip_002_ashlok','a',{percent:true}):1);for(let i=0;i<n('hits');i++)damageTargets(b.enemies.filter(t=>active(t)&&near(t,center,n('radius'))),scale);return true;
    }
    case 'char_494_vendla': {
      const t=injured[0];if(!t)return false;healTargets([t]);const granted=shield(b,u,t,t.s.maxHp*n('shieldRatio'));
      // 碎片: the shield-break counter deals {a}% ATK instead (no lifesteal).
      const amount=u.s.atk*(selectedModule(u,'002_vendla')?moduleValue(u,'uniequip_002_vendla','a',{percent:true}):n('counterScale'));
      nextAttackGrant(b,u,t,{kind:'thorns',shield:granted,counterAmount:amount,cause});return true;
    }
    case 'char_497_ctable':
      ammoBurst(b,u,n('rounds'),()=>{if(active(target)){hit(b,u,target,n('atkScale')*(selectedModule(u,'002_ctable')?1.3:1),'phys',cause);gainDP(b,u,n('costPerHit'),key(u),cause);}});
      if(selectedModule(u,'002_ctable'))shield(b,u,u,0,{hits:1,suffix:':evasion'});return true;
    default: throw new Error('Unimplemented single-cast support skill '+id);
  }
}
