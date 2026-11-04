import { validateAdaptation } from '../../../../shared/assault/adaptation.js';
import { bodyOf, pieceOf, makeKit, active, sp, haste } from './primitives.js';
import { battleState, countedTrigger, installCastAmmo, hasCastAmmo, spendCastAmmo } from './adaptation-primitives.js';

const CONTROL = new Set(['cold','frozen','freeze','stun','sluggish','bind','sleep','tremble','levitate','push','pull','weightless']);
function moduleValues(def, plan) {
  const body=bodyOf(def),piece=pieceOf(def);
  if(piece.star<3)return plan.values;
  const selected=piece.moduleChoices?.[body.charId]??piece.moduleId,id=plan.moduleAliases?.[selected]??selected;
  const patch=body.modulePlans.find(m=>m.id===id)?.adaptationUpgrade;
  return patch?{...plan.values,[patch.key]:patch.value}:plan.values;
}
function adjacentRecipient(battle,unit,anchor) {
  return battle.allyUnits.filter(t=>t!==unit&&t.kind==='op'&&t.ownerId===unit.ownerId&&active(t)&&t.skill?.kind!=='passive'
    &&Math.abs(t.tileR-anchor.tileR)+Math.abs(t.tileC-anchor.tileC)===1)
    .sort((a,b)=>a.skill.spTotal-b.skill.spTotal||a.id-b.id)[0];
}
function installModuleLinks(battle,unit,v) {
  const listen=(type,key,accept,effect,limits={})=>{
    const take=countedTrigger(battle,{key:`adaptation:module:${unit.uid}:${key}`,owner:unit,...limits},effect);
    battle.assaultRuntime.observe(type,`adaptation:module-watch:${unit.uid}:${key}`,event=>{
      if(accept(event.payload))take({payload:event.payload,cause:event.cause,target:event.payload.target});
    },{owner:unit});
  };
  if(v.moduleSummonCharge)listen('summonEntered','summon-charge',p=>p.source===unit,({payload,cause})=>{
    // The summoner is also eligible when next to its chosen summon tile.
    const target=battle.allyUnits.filter(t=>t.kind==='op'&&t.ownerId===unit.ownerId&&active(t)&&t.skill?.kind!=='passive'
      &&Math.abs(t.tileR-payload.target.tileR)+Math.abs(t.tileC-payload.target.tileC)===1)
      .sort((a,b)=>a.skill.spTotal-b.skill.spTotal||a.id-b.id)[0];
    return target?sp(battle,unit,target,v.moduleSummonCharge,'summon-module','summon-module',cause):0;
  });
  if(v.moduleControlHaste)listen('statusApplied','control-haste',p=>p.source===unit&&p.target?.side==='enemy'&&CONTROL.has(p.status),({cause})=>{
    const target=adjacentRecipient(battle,unit,unit);
    return target?haste(battle,unit,target,v.moduleControlHaste,'control-module',{cause}):false;
  },{first:3});
  if(v.moduleElementHaste)listen('elementBurst','element-haste',p=>p.target?.side==='enemy',({cause})=>
    haste(battle,unit,unit,v.moduleElementHaste,'element-module',{cause}),{every:3});
}

/** New cards have one signature cast and one talent-derived link. Native
 * innates/modules may install independently; there is no default deploy line,
 * second timed stance or extra payoff appended after the native action. */
export function adaptedKit(def, { cast, canCast, link, innate, state } = {}) {
  const plan = validateAdaptation(bodyOf(def).adaptation);
  const v=moduleValues(def,plan);
  if (typeof cast !== 'function' && (plan.type !== 'C' || plan.passive)) throw new TypeError('adapted skill requires its original action');
  if (plan.type === 'C' && !plan.passive && (!state || !['object', 'function'].includes(typeof state))) throw new TypeError('C-type skill requires its explicit battle state');
  const stateOf = ctx => typeof state === 'function' ? state(ctx) : state;
  const kit=makeKit(def, {
    passive: plan.passive === true,
    castOnDeploy: plan.skillOnDeploy === true && plan.passive !== true,
    canCast: ctx => (plan.type !== 'D' || hasCastAmmo(ctx.unit))
      && (plan.type !== 'C' || plan.passive || !ctx.unit.mem.assaultBattleStates?.[plan.sourceSkillId] || typeof stateOf(ctx).repeat === 'function')
      && (!canCast || canCast(ctx)),
    cast: ctx => {
      if (plan.type === 'D' && !spendCastAmmo(ctx.battle, ctx.unit, plan.sourceSkillId)) return false;
      const act=()=>{
        if(plan.type==='C'&&!plan.passive)return battleState(ctx.battle,ctx.unit,plan.sourceSkillId,stateOf(ctx));
        return cast(ctx);
      };
      const actWithModule=()=>{
        const result=act();
        if(result!==false&&v.moduleShield)ctx.battle.addBuff(ctx.unit,{
          key:`adaptation:module-shield:${ctx.unit.uid}:${ctx.unit.mem.adaptModuleShieldSeq=(ctx.unit.mem.adaptModuleShieldSeq??0)+1}`,
          shieldHits:v.moduleShield,duration:Infinity,source:ctx.unit,visible:true,
        });
        return result;
      };
      if (!plan.passive) return actWithModule();
      const runtime = ctx.battle.assaultRuntime;
      const payload = { source: ctx.unit, sourceUid: ctx.unit.uid, skillId: plan.sourceSkillId, passive: true, extra: false };
      runtime.publish('skillStart', payload);
      const result = actWithModule();
      runtime.publish('skillResolved', payload);
      return result;
    },
    install: (battle, unit) => {
      // Instant assault resolution still closes the native skill lifecycle.
      // Profession hooks restore phalanx defence and reset liberator ramp here.
      battle.assaultRuntime.observe('skillResolved', `adaptation:native-end:${unit.uid}`, ({ payload }) => {
        if(payload.source===unit&&battle._hooks.skillEnd)battle.emit('skillEnd',{unit,skill:unit.skill,reason:'assault-settled',extra:payload.extra===true});
      }, { owner: unit });
      if (plan.type === 'D') installCastAmmo(battle, unit, plan.ammo+(v.moduleAmmo??0));
      installModuleLinks(battle,unit,v);
      innate?.(battle, unit, plan);
      const previous=battle.assaultLinkInstaller;battle.assaultLinkInstaller=unit;
      try{link?.(battle, unit, plan);}finally{battle.assaultLinkInstaller=previous;}
      if (plan.passive && plan.nativeDeploy) battle.assaultRuntime.observe('deployed', `adaptation:passive:${unit.uid}`, ({ payload, cause }) => {
        if (payload.target !== unit || !payload.inPlace) return;
        battle.assaultRuntime.enqueue(() => {
          unit.skill.spec.assaultCast({ battle, unit, cause });
          battle._ev(['skill', unit.id, 1, unit.skill.evSkillId]);
          unit.skillAnimUntil = battle.time + .5;
          battle.after(.5, () => { if (unit.alive) battle._ev(['skill', unit.id, 0, unit.skill.evSkillId]); }, { owner: unit });
        }, { key: `adaptation:passive:${unit.uid}`, targetUid: unit.uid, cause });
      }, { owner: unit });
    },
  });
  if(!plan.passive)kit.skill.charges+=v.moduleStorage??0;
  return kit;
}
