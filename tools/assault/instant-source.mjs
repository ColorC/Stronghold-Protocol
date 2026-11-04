// User migration contract: source semantics, never the generated `kind` flag.
export function nativeInstantCandidate(level) {
  if(!level || level.skillType==='PASSIVE' || level.durationType==='AMMO' || !(level.duration<=0))return false;
  const description=String(level.description??'').replace(/<[^>]*>/g,'');
  return !/持续时间无限|在下列状态和初始状态间切换/.test(description);
}

export function inspectSkillSource(body,skillTable) {
  const fixed=body.fixedSkill;
  const options=body.source.skills.map(source=>({id:source.skillId,index:source.index,
    level:skillTable[source.skillId]?.levels?.at(-1)}));
  if(options.some(s=>!s.level))throw new Error('Missing native skill source: '+body.charId);
  if(fixed.kind==='passive'){
    if(body.adaptation?.passive&&body.adaptation.nativeDeploy&&fixed.sourceSkillId!=null) {
      const selected=options.find(s=>s.id===fixed.sourceSkillId&&s.index===fixed.sourceIndex);
      if(!selected||selected.level.spData.spCost!==0)throw new Error('Native deployment passive source mismatch: '+body.charId);
      return {selected,candidates:[],singleSlotException:false,designChoice:true};
    }
    // a synergy card's deploy-cast passive (ruled 10-21) adapts a native skill without claiming its slot
    const deployCast=body.bazaar?.format==='synergy'&&body.bazaar.castOnDeploy===true;
    if((options.length&&!deployCast) || fixed.sourceSkillId!=null || fixed.sourceIndex!=null)throw new Error('Passive source claims an active slot: '+body.charId);
    return {selected:null,candidates:[],singleSlotException:false};
  }
  const selected=options.find(s=>s.id===fixed.sourceSkillId&&s.index===fixed.sourceIndex);
  if(!selected)throw new Error('Fixed skill source does not resolve: '+body.charId);
  const candidates=options.filter(s=>nativeInstantCandidate(s.level));
  // A synergy card (design of 2026-10-21) picks the native skill it adapts on purpose (「挑选一个技能改编」, made 快发 by
  // its kit): the slot must resolve, the older automatic-selection rules do not apply.
  if(['synergy','adaptation'].includes(body.bazaar?.format))return {selected,candidates,singleSlotException:false,designChoice:true};
  if(candidates.length&&!candidates.some(s=>s===selected))throw new Error('Available native instant skill bypassed: '+body.charId);
  const singleSlotException=!candidates.length&&options.length===1;
  if(!candidates.length&&selected.index===0&&!singleSlotException)throw new Error('Fallback must select a distinctive S2/S3: '+body.charId);
  return {selected,candidates,singleSlotException};
}

// Shared by the normal compiler and release audit: generated labels cannot
// conceal a wrong native source or a lingering caster attack window.
export function assertFixedSkillContract(body, skillTable) {
  const source=inspectSkillSource(body,skillTable), fixed=body.fixedSkill;
  if(fixed.kind==='passive')return source;
  if(fixed.kind!=='instant'||fixed.spType!=='time'||fixed.recoveryPerSec!==1)
    throw new Error('Fixed skill must use instant natural recovery: '+body.charId);
  for(const [index,cost]of fixed.spCosts.entries()){
    const initial=Number(Array.isArray(fixed.initSp)?fixed.initSp[index]:fixed.initSp);
    const charges=Number(Array.isArray(fixed.maxCharges)?fixed.maxCharges[index]:fixed.maxCharges??1);
    if(!(cost>0)||!Number.isInteger(charges)||charges<1||!Number.isFinite(initial)||initial<0||initial>cost*charges)
      throw new Error('Invalid natural SP cost/initial SP/charge capacity: '+body.charId);
  }
  const expectedCharges=fixed.spCosts.map((_,index)=>Number(Array.isArray(fixed.maxCharges)?fixed.maxCharges[index]:fixed.maxCharges??1));
  // a synergy card that carries its design capacity (fixedSkill.charges) is checked against its 「可储存 n 次」 (every star);
  // its legacy effects keep the native wording
  if(body.bazaar?.format==='synergy'&&fixed.charges!=null){
    for(const match of String(fixed.description??'').matchAll(/可储存\s*(\d+)\s*次/g))
      if(expectedCharges.some(value=>value!==Number(match[1])))throw new Error('Charge description differs from the card capacity: '+body.charId);
  }else for(const match of JSON.stringify([fixed.description,fixed.effects]).matchAll(/积存(\d+\/\d+\/\d+\/\d+)层/g)){
    if(match[1].split('/').some((value,index)=>Number(value)!==expectedCharges[index]))
      throw new Error('Charge description differs from native capacity: '+body.charId);
  }
  if(!source.candidates.length&&!source.designChoice)for(const effect of fixed.effects){
    if(['ammoAttackHit','attackHitWhileSkillActive','attackedWhileSkillActive'].includes(effect.trigger)||/普通攻击|技能期间|持续期间每|每次攻击命中/.test(effect.trigger))
      throw new Error('Fallback still depends on a later caster attack/skill window: '+body.charId);
    if(effect.action==='addBuff'&&/自身|self/.test(effect.target)&&Object.keys(effect.values??{}).some(key=>/^(?:atk|atkBonus|attackSpeed|attackSpeedBonus|def|defBonus|blockCnt|blockBonus|rangeExtend|traitMultiplier|funnelCapScale)$/.test(key)))
      throw new Error('Fallback retains a timed caster attribute stance: '+body.charId);
  }
  return source;
}
