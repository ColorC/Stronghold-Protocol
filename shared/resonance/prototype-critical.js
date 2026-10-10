/** Resolve one native-mode critical roll for a real damage event. Chances and bonuses are fractions. */
export function resolvePrototypeCritical(event,{battle,bonusChance=0,abilityCrit=false,critDamageBonus=0,baseAttackChance=.25}={}){
  const source=event?.source,target=event?.target,dmg=event?.dmg;
  if(source?.side!=='ally'||target?.side!=='enemy'||!dmg||dmg.prototypeCritResolved)return {eligible:false,critical:false,duplicate:!!dmg?.prototypeCritResolved};
  const attack=!!dmg.isAttack,skill=!!dmg.isSkill;
  if(!attack&&!(skill&&abilityCrit))return {eligible:false,critical:false};
  dmg.prototypeCritResolved=true;
  const chance=Math.max(0,Math.min(1,((attack||skill&&abilityCrit)?Number(baseAttackChance)||0:0)+Number(bonusChance||0)));
  const roll=typeof battle?.rng==='function'?battle.rng():1;
  if(!(roll<chance))return {eligible:true,critical:false,chance};
  const multiplier=1.4+Math.max(0,Number(critDamageBonus)||0);
  dmg.mul=Number(dmg.mul??1)*multiplier;
  dmg.prototypeCritical=true;
  dmg.prototypeCriticalMultiplier=multiplier;
  return {eligible:true,critical:true,chance,multiplier};
}
