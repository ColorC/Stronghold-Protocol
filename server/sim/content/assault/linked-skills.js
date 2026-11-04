import { active, uid } from './primitives.js';
import { charge, battleStack, reloadAmmo } from './synergy.js';
import { assaultAmmoState } from './ammo.js';

export function installLinkedSkills(battle,prepared,definitions) {
  const ranks=prepared.input?.skillRanks??{};
  for(const def of definitions.filter(x=>x.battle?.kind==='linkedTrigger')) {
    const rank=ranks[def.id]??0;if(!rank)continue;
    if(!Number.isInteger(rank)||rank<1||rank>4)throw new Error(`Invalid linked Skill rank ${def.id}`);
    const rule=def.battle,amount=rule.amountByStar[rank-1];let last=-Infinity,seq=0;
    battle.assaultRuntime.observe(rule.event,`global:${def.id}`,event=>{
      const payload=event.payload;
      const source=payload.source??payload.unit??payload.killer;
      if(!source||source.kind!=='op'||!active(source)||source.side!=='ally')return;
      if(rule.status&&payload.status!==rule.status)return;
      if(rule.event==='kill'&&payload.target?.side!=='enemy')return;
      if(payload.applied===false||payload.keepalive||battle.time+1e-9<last+rule.cooldown)return;
      let pool=battle.assaultDeploymentOrder().filter(x=>x.kind==='op'&&active(x)&&x.ownerId===source.ownerId&&x!==source);
      if(rule.effect==='charge')pool=pool.filter(x=>x.skill?.kind!=='passive'&&x.skill.sp<x.skill.spCost)
        .sort((a,b)=>a.skill.sp/a.skill.spCost-b.skill.sp/b.skill.spCost||uid(a).localeCompare(uid(b)));
      if(rule.effect==='growth')pool.sort((a,b)=>a.s.atk-b.s.atk||uid(a).localeCompare(uid(b)));
      if(rule.effect==='heal'||rule.effect==='shield')pool.sort((a,b)=>a.hp/a.s.maxHp-b.hp/b.s.maxHp||uid(a).localeCompare(uid(b)));
      if(rule.effect==='heal')pool=pool.filter(x=>x.hp<x.s.maxHp&&!x.s.flags?.noHeal&&!x.profile?.noHeal);
      if(rule.effect==='redeploy')pool=pool.filter(x=>x.assaultCycle?.at>battle.time).sort((a,b)=>b.assaultCycle.at-a.assaultCycle.at||uid(a).localeCompare(uid(b)));
      if(rule.effect==='ammo')pool=pool.filter(x=>{const ammo=assaultAmmoState(x);return ammo&&ammo.current<ammo.capacity;})
        .sort((a,b)=>{const aa=assaultAmmoState(a),bb=assaultAmmoState(b);return aa.current/aa.capacity-bb.current/bb.capacity||uid(a).localeCompare(uid(b));});
      const target=pool[0];if(!target)return;
      last=battle.time;seq++;
      battle.assaultRuntime.enqueue(()=>{
        if(!active(source)||!active(target))return;
        if(rule.effect==='charge')charge(battle,source,target,amount,def.id,event.cause);
        else if(rule.effect==='growth')battleStack(battle,source,target,{key:def.id,stat:'atk',amount,mode:'percent',cause:event.cause});
        else if(rule.effect==='heal')battle.heal(source,target,source.s.atk*amount,{self:false});
        else if(rule.effect==='shield')battle.addBuff(target,{key:`assault:global:${def.id}:${seq}`,shield:amount,duration:Infinity,source});
        else if(rule.effect==='redeploy')target.assaultCycle.at=Math.max(battle.time,target.assaultCycle.at-amount);
        else if(rule.effect==='ammo')reloadAmmo(battle,source,target,amount,def.id);
      },{key:`global:${def.id}`,sourceUid:uid(source),targetUid:uid(target),cause:event.cause});
    },{owner:{type:'linked-skill',id:def.id}});
  }
}
