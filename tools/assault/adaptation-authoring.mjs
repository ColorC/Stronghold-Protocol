import { CORE_ADAPTATIONS, CORE_CARD_ROLES, CORE_MODULES, CORE_INNATES } from '../../shared/assault/core-adaptations.js';
import { POOL_ADAPTATIONS, POOL_CARD_ROLES, POOL_MODULES, POOL_INNATES } from '../../shared/assault/pool-adaptations.js';
import { RANGED_ADAPTATIONS, RANGED_CARD_ROLES, RANGED_MODULES, RANGED_INNATES } from '../../shared/assault/ranged-adaptations.js';
import { SUPPORT_ADAPTATIONS, SUPPORT_CARD_ROLES, SUPPORT_MODULES, SUPPORT_INNATES } from '../../shared/assault/support-adaptations.js';
import { MELEE_ADAPTATIONS, MELEE_CARD_ROLES, MELEE_MODULES, MELEE_INNATES } from '../../shared/assault/melee-adaptations.js';
import { CASTER_ADAPTATIONS, CASTER_CARD_ROLES, CASTER_MODULES, CASTER_INNATES } from '../../shared/assault/caster-adaptations.js';
import { FRONTLINE_ADAPTATIONS, FRONTLINE_CARD_ROLES, FRONTLINE_MODULES, FRONTLINE_INNATES } from '../../shared/assault/frontline-adaptations.js';
import { SUMMON_ADAPTATIONS, SUMMON_CARD_ROLES, SUMMON_MODULES, SUMMON_INNATES } from '../../shared/assault/summon-adaptations.js';
import { SPECIAL_ADAPTATIONS, SPECIAL_CARD_ROLES, SPECIAL_MODULES, SPECIAL_INNATES } from '../../shared/assault/special-adaptations.js';
import { ADVANCED_ADAPTATIONS, ADVANCED_CARD_ROLES, ADVANCED_MODULES, ADVANCED_INNATES } from '../../shared/assault/advanced-adaptations.js';
import { PRECISION_ADAPTATIONS, PRECISION_CARD_ROLES, PRECISION_MODULES, PRECISION_INNATES } from '../../shared/assault/precision-adaptations.js';
import { LATE_ADAPTATIONS, LATE_CARD_ROLES, LATE_MODULES, LATE_INNATES } from '../../shared/assault/late-adaptations.js';
import { COOPERATIVE_ADAPTATIONS, COOPERATIVE_CARD_ROLES, COOPERATIVE_MODULES, COOPERATIVE_INNATES } from '../../shared/assault/cooperative-adaptations.js';
import { COMPANION_ADAPTATIONS, COMPANION_CARD_ROLES, COMPANION_MODULES, COMPANION_INNATES } from '../../shared/assault/companion-adaptations.js';
import { ADAPTATION_VERSION, skillTempo, validateAdaptation } from '../../shared/assault/adaptation.js';
import { RUN_CARD_GROWTH } from '../../shared/assault/growth-policy.js';

export const AUTHORED_ADAPTATIONS={...CORE_ADAPTATIONS,...POOL_ADAPTATIONS,...RANGED_ADAPTATIONS,...SUPPORT_ADAPTATIONS,...MELEE_ADAPTATIONS,...CASTER_ADAPTATIONS,...FRONTLINE_ADAPTATIONS,...SUMMON_ADAPTATIONS,...SPECIAL_ADAPTATIONS,...ADVANCED_ADAPTATIONS,...PRECISION_ADAPTATIONS,...LATE_ADAPTATIONS,...COOPERATIVE_ADAPTATIONS,...COMPANION_ADAPTATIONS};
export const AUTHORED_CARD_ROLES={...CORE_CARD_ROLES,...POOL_CARD_ROLES,...RANGED_CARD_ROLES,...SUPPORT_CARD_ROLES,...MELEE_CARD_ROLES,...CASTER_CARD_ROLES,...FRONTLINE_CARD_ROLES,...SUMMON_CARD_ROLES,...SPECIAL_CARD_ROLES,...ADVANCED_CARD_ROLES,...PRECISION_CARD_ROLES,...LATE_CARD_ROLES,...COOPERATIVE_CARD_ROLES,...COMPANION_CARD_ROLES};
const MODULES={...CORE_MODULES,...POOL_MODULES,...RANGED_MODULES,...SUPPORT_MODULES,...MELEE_MODULES,...CASTER_MODULES,...FRONTLINE_MODULES,...SUMMON_MODULES,...SPECIAL_MODULES,...ADVANCED_MODULES,...PRECISION_MODULES,...LATE_MODULES,...COOPERATIVE_MODULES,...COMPANION_MODULES},INNATES={...CORE_INNATES,...POOL_INNATES,...RANGED_INNATES,...SUPPORT_INNATES,...MELEE_INNATES,...CASTER_INNATES,...FRONTLINE_INNATES,...SUMMON_INNATES,...SPECIAL_INNATES,...ADVANCED_INNATES,...PRECISION_INNATES,...LATE_INNATES,...COOPERATIVE_INNATES,...COMPANION_INNATES};

const MODULE_DEFAULTS=Object.freeze({moduleStorage:0,moduleAmmo:0,moduleShield:0,moduleSummonCharge:0,moduleControlHaste:0,moduleElementHaste:0,modulePopulation:1});
const ATTRIBUTE_ONLY=new Set(['scale','atk','def','hp','aspd','aura','selfDef','selfBonus','allyATK','linkAtk','extraHP','focus','groundATK','perBlock','abyssal','res','healing','amp']);
const NATIVE_MODULE_KEYWORDS=Object.freeze({hits:'multiStrike',rounds:'multiStrike',pulses:'multiStrike',heals:'healing',uses:'uses',waves:'multiStrike',
  heal:'healing',allyHeal:'healing',popHeal:'healing',share:'healing',regen:'regeneration',barrier:'shield',shield:'shield',refill:'shield',
  every:'countedTrigger',first:'firstTriggers',quiet:'dodge',charge:'charge',firstSP:'charge',recovery:'spRecovery',haste:'haste',
  cut:'redeploy',redeploy:'redeploy',discount:'cost',dp:'cost',allyAmmo:'ammo',recycle:'summonReturn',factor:'copy',steal:'steal',
  cold:'cold',stun:'stun',linkStun:'stun',tremble:'tremble',resist:'resist',lift:'levitate',extend:'sluggish',extra:'sluggish',
  fragile:'fragile',down:'weaken',awe:'weaken',weaken:'weaken',protect:'protection',heavyMiss:'dodge',dodge:'dodge',
  ignore:'penetration',floor:'minimumDamage',crit:'critical',chance:'critical',growth:'battleStack',hpGrowth:'battleStack',stage:'battleStage',
  ember:'undying',origami:'entryBurst',deploy:'entryBurst',dotBonus:'dot',dot:'dot',bleed:'bleed',
  maxScale:'rampingDamage',heavy:'heavyTarget',bomb:'elementBurst',bonus:'followUp',maze:'boundTarget',airBonus:'airTarget',
  chargeScale:'chargedAttack',landing:'landingBurst',funnelMax:'funnel',open:'entryBurst',center:'splashCentre',area:'scoutArea',air:'airTarget',
  flat:'markedTarget',melt:'elementBurst',echo:'followUp',burn:'elementDamage',trait:'elementHealing',seconds:'multiStrike',
  wakes:'wakeBurst',returns:'teleport',harvestUses:'uses',berserk:'lowHpDamage',reflect:'counterAttack'});
function keywordModuleOptions(id){const plan=AUTHORED_ADAPTATIONS[id],roles=AUTHORED_CARD_ROLES[id],v=plan.values;
  const native=(key,value,text,keyword,sourceKind='skill')=>({key,value,text,keyword,sourceKind});
  return MODULES[id].map((seed,index)=>{
    if(id==='char_4037_demetr'&&index===1)return native('modulePopulation',0,'此干员不占人口。','population','module');
    // These native once-per-battle states have no recast. Extra SP capacity
    // would be an empty upgrade, so use their actual link or protection.
    if(id==='char_204_platnm'&&index===0)return native('every',2,'友军每累计控制2次，积存1次满蓄力攻击。','countedTrigger','talent');
    if(id==='char_1001_amiya2'&&index===1)return native('moduleShield',2,'施放时额外获得2层护盾。','shield');
    if(id==='char_1037_amiya3'&&index===1)return native('regen',.035,'施放后友军每秒再生3.5%最大生命。','regeneration','talent');
    if(!ATTRIBUTE_ONLY.has(seed.key)){
      const keyword=NATIVE_MODULE_KEYWORDS[seed.key];if(!keyword)throw Error(`${id}: module keyword is unspecified for ${seed.key}`);
      return {...seed,keyword};
    }
    if(index===0){
      for(const[key,label]of [['hits','连击'],['rounds','连击轮数'],['pulses','脉冲轮数'],['heals','治疗次数'],['uses','积存次数'],['waves','波次']])
        if(Number.isInteger(v[key])&&v[key]>0)return native(key,v[key]+1,`${label}+1（共${v[key]+1}次）。`,key==='uses'?'uses':key==='heals'?'healing':'multiStrike');
      for(const[key,label]of [['cold','寒冷'],['stun','晕眩'],['bind','束缚'],['tremble','战栗'],['lift','浮空']])
        if(v[key]>0)return native(key,v[key]+1,`${label}延长1秒（共${v[key]+1}秒）。`,key==='lift'?'levitate':key);
    }else if(Number.isInteger(v.every)&&v.every>1){
      const next=v.every-1,re=new RegExp(`${v.every}(?=次|名|费用|个)`);
      const line=plan.lines.slice(1).find(text=>re.test(text));
      if(line)return native('every',next,line.replace(re,String(next)),'countedTrigger','talent');
    }
    if(index===1&&plan.type==='D')return native('moduleAmmo',1,'本场弹药上限+1，初始与装填均生效。','ammo');
    if(index===1&&plan.type==='E')return native('moduleSummonCharge',4,'召唤物入场时，为其相邻一名干员充能4。','summonCharge','talent');
    if(index===1&&(roles.produces??[]).some(f=>['control','cold','displacement'].includes(f)))
      return native('moduleControlHaste',4,'本场前3次施加控制，加速相邻一名干员4秒。','controlHaste','talent');
    if(index===1&&(roles.produces??[]).includes('element'))
      return native('moduleElementHaste',4,'敌人每累计3次元素爆发，加速自身4秒。','elementHaste','talent');
    if(plan.passive)return native('moduleShield',1,'部署时额外获得1层护盾。','shield','talent');
    return native('moduleStorage',1,'技能可储存次数+1。','storage');
  });
}
export const AUTHORED_KEYWORD_MODULES=Object.freeze(Object.fromEntries(Object.keys(AUTHORED_ADAPTATIONS).map(id=>[id,keywordModuleOptions(id)])));

export function adaptationPlan(original, native, skillTable) {
  const authored = AUTHORED_ADAPTATIONS[original.charId];
  if (!authored) return original;
  const slot = native.skills[authored.index], level = slot ? skillTable[slot.skillId].levels.at(-1) : null;
  if (!level && !(authored.passive && authored.sourceTraitId && native.skills.length === 0)) throw Error(`Missing native skill for ${original.charId}`);
  return { ...original, fixedSkill: {
    sourceSkillId: slot?.skillId ?? null, sourceIndex: authored.index, name: level?.name ?? native.talents[authored.sourceTalent].candidates.at(-1).name,
    kind: authored.passive ? 'passive' : 'instant', spType: authored.passive ? 'none' : 'time',
    spCosts: authored.passive ? [] : skillTempo(authored.tier, authored.cost).spCosts,
    initSp: 0, recoveryPerSec: authored.passive ? 0 : 1,
    charges: Math.max(1, level?.spData.maxChargeTime ?? 1),
    description: authored.lines.join(''), effects: [],
    adaptation: { ...authored,values:{...MODULE_DEFAULTS,...authored.values}, ...AUTHORED_CARD_ROLES[original.charId], innates: INNATES[original.charId], version: ADAPTATION_VERSION,
      ...(RUN_CARD_GROWTH[original.charId]?{runGrowth:RUN_CARD_GROWTH[original.charId],growthEvents:[RUN_CARD_GROWTH[original.charId].event],
        roles:[...AUTHORED_CARD_ROLES[original.charId].roles,'runGrowth'],lines:[...authored.lines,RUN_CARD_GROWTH[original.charId].line]}:{}) },
  } };
}

export function compiledAdaptation(fixed, normalRange) {
  if (!fixed.adaptation) return null;
  return validateAdaptation({ ...fixed.adaptation, sourceSkillId: fixed.sourceSkillId,
    sourceIndex: fixed.sourceIndex, sourceTalentId: fixed.adaptation.sourceTalent,
    tempo: fixed.adaptation.passive ? null : skillTempo(fixed.adaptation.tier, fixed.adaptation.cost),
    rangeGrid: fixed.runtime.sourceRangeGrid ?? normalRange });
}

export function adaptationModules(bodyId, fixed, original) {
  if (!fixed.adaptation) return original;
  const native=original.filter(m=>m.type==='ADVANCED');
  return AUTHORED_KEYWORD_MODULES[bodyId].map((option, index) => ({
    id: `assault_mod_${bodyId}_${index}`,
    name:native.length?(native[index%native.length].name+(native.length===1?(index?'·连线':'·原技'):'')):(option.name??fixed.name),
    type: 'ADVANCED', unlockStar: 3,
    typeName: native[index%Math.max(1,native.length)]?.typeName ?? (index ? 'Y' : 'X'),
    ...(native.length?{sourceModuleId:native[index%native.length].id}:{}),
    description: option.text,keyword:option.keyword, enabled: true, nativeWhiteStatsApplied: false, nativeCallbacksApplied: false,
    adaptationUpgrade: { key: option.key, value: option.value },
    ...(option.key==='modulePopulation'?{parameters:{populationCost:option.value}}:{}),
    source: option.sourceKind==='module'?{table:'uniequip_table.json',pointer:`/equipDict/${native[index%native.length].id}`}:
      { table: option.sourceKind === 'skill' ? 'skill_table.json' : 'character_table.json',
        pointer: option.sourceKind === 'skill' ? `/${fixed.sourceSkillId}` : `/${bodyId}/talents/${fixed.adaptation.sourceTalent}` },
  }));
}

export function adaptationCard(body, original) {
  if (!body.adaptation) return original;
  return { ...original, format: 'adaptation', sp: body.fixedSkill.spCosts,
    lines: body.adaptation.lines.map((template, index) => ({ kind: template===body.adaptation.runGrowth?.line?'growth':index === 0 ? 'skill' : 'talent', template, params: {} })),
    tags: body.adaptation.tags ?? [],
    modules: body.modulePlans.map(m => ({ id: m.id, name: m.name,
      line: { kind: 'module', template: m.description, params: {} } })) };
}
