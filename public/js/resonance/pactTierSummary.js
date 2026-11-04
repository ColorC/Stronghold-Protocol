import { levelExactCounts } from './pactTierState.js';

const n = (values, key) => Number.isFinite(values?.[key]) ? values[key] : null;
const pct = value => value == null ? null : `${Math.round(value * 100)}%`;
const amount = value => value == null ? null : `${Math.round(value)}`;
const precise = value => value == null || !Number.isFinite(Number(value)) ? null : String(Number(Number(value).toFixed(2)));
const join = values => values.filter(Boolean).join(' · ');

/** Compact tier-specific player copy derived from the corresponding source tier values. */
export function pactTierSummary(id, values = {}, level = null) {
  const p = key => pct(n(values, key));
  const a = key => amount(n(values, key));
  const s = key => n(values, key);
  const emissaryExact = level ? levelExactCounts(level) : null;
  const summaries = {
    creation: () => join([a('TriggerNumCrystals') && `每${a('TriggerNumCrystals')}枚晶体`, a('MagicDamage') && `爆发${a('MagicDamage')}点术法伤害`, p('ConversionDamagePct') && `转化${p('ConversionDamagePct')}累计伤害`, a('Resists') && `双抗评分+${a('Resists')}`]),
    arts: () => join([a('BaseAP') && `术式成员术法伤害+${a('BaseAP')}%`, a('TeamAP') && `其他友军术法伤害+${a('TeamAP')}%`, p('DamageDecrease') && `技能使目标伤害-${p('DamageDecrease')}`]),
    rhodes: () => join([a('NumComponents') && `每个持有组件提供${a('HPShieldAmount')}点护盾`, a('ShieldDuration') && `持续${a('ShieldDuration')}秒`]),
    artillery: () => join([p('AD') && `攻击力+${p('AD')}`, a('NumOfAttacks') && `每${a('NumOfAttacks')}次攻击`, p('PercentDamage') && `周围造成${p('PercentDamage')}攻击力伤害`]),
    formSwap: () => join([p('DR') && `前排承伤-${p('DR')}`, p('DA') && `后排增伤+${p('DA')}`]),
    emissary: () => {
      if (emissaryExact?.includes(1)) return '恰好1名领军时，仅触发该成员对应的专属全队效果';
      if (emissaryExact?.includes(4)) return join([
        p('StarAS') && `全队每星攻速+${p('StarAS')}`,
        a('NamiMana') && `每次友军攻击额外技力+${a('NamiMana')}`,
        p('GarenHealthPercent') && `该成员与左右友军各获得该成员最大生命值的${p('GarenHealthPercent')}`,
        a('AmbessaArmor_PVE') && `每场胜利全队双抗评分+${a('AmbessaArmor_PVE')}（最多7场）`,
        a('BonusHealth') && `领军成员生命+${a('BonusHealth')}`,
        p('SelfishDamageAmp') && `领军成员伤害+${p('SelfishDamageAmp')}`,
      ]);
      return '';
    },
    sentinel: () => join([a('BonusArmor') && `全队双抗评分+${a('BonusArmor')}`, s('BonusArmor') && `盟约成员额外双抗评分+${amount(s('BonusArmor') * 2)}`]),
    family: () => join([p('ManaReduction') && `耗能-${p('ManaReduction')}`, p('DamageReduction') && `承伤-${p('DamageReduction')}`, p('AttackSpeed') && `攻速+${p('AttackSpeed')}`]),
    redeploy: () => join([p('CritChance') && `暴击率+${p('CritChance')}`, p('CritDamage') && `暴击伤害+${p('CritDamage')}`, p('DamageReductionPct') && `承伤-${p('DamageReductionPct')}`]),
    logistics: () => join([p('EnlightenedBonusMana') && `额外技力+${p('EnlightenedBonusMana')}`, p('AllyHealing') && `技能治疗${p('AllyHealing')}伤害值`]),
    ammo: () => join([a('PercentDamageIncrease') && `每格普攻增伤${a('PercentDamageIncrease')}%`, a('BonusHexRangeIncrease') && `攻击距离+${a('BonusHexRangeIncrease')}`]),
    conqueror: () => join([p('ADAPBase') && `攻击与术法伤害+${p('ADAPBase')}`, a('StacksPerKill') && `击倒获得${a('StacksPerKill')}层征服`]),
    holyGun: () => join([p('Durability') && `施法后承伤-${p('Durability')}`, a('Duration') && `持续${a('Duration')}秒`, a('Bonus1NumRockets') && `${a('Bonus1NumRockets')}枚火箭，每枚造成${a('Bonus1RocketDamage')}点物理伤害`, a('Bonus2ShieldAmount') && `强化护盾${a('Bonus2ShieldAmount')}点，持续${a('Bonus2ShieldDuration')}秒`, a('Bonus4Gold') && `战斗结算获得${a('Bonus4Gold')}金`]),
    academy: () => join([p('PercentIncreaseSponsored') && `赞助装备加成+${p('PercentIncreaseSponsored')}`, a('NumOfItems') && `获得${a('NumOfItems')}件赞助装备`]),
    risk: () => join([a('ShimmerPerCombat') && `每场获得${a('ShimmerPerCombat')}微光`, a('ShimmerPerCombatStreaking') && `连败获得${a('ShimmerPerCombatStreaking')}微光`, a('HealthPerSkip') && `放弃黑市生命+${a('HealthPerSkip')}`]),
    resistance: () => join([p('ADAP') && `攻击与术法伤害+${p('ADAP')}`, p('PercentMaxHealthBonus') && `最大生命+${p('PercentMaxHealthBonus')}`, a('StunDuration') && `全体眩晕${a('StunDuration')}秒`, a('ForceDuration') && `信号每${a('ForceDuration')}秒触发`]),
    dominator: () => join([precise(s('APPercent')) && `每消耗1点技力，术法伤害+${precise(s('APPercent'))}%`, a('ShieldAmount') && `开战获得${a('ShieldAmount')}点护盾`, a('ShieldDuration') && `持续${a('ShieldDuration')}秒`]),
    breaker: () => join([p('TrueDamagePercent') && `真实伤害+${p('TrueDamagePercent')}`, p('HealPercent') && `治疗最大生命${p('HealPercent')}`, p('OmnivampPercent') && `全能吸血+${p('OmnivampPercent')}`]),
    enforcer: () => join([a('NumOfWantedEnemies') && `标记${a('NumOfWantedEnemies')}名敌人`, p('PercentMaxHealthShield') && `开战护盾${p('PercentMaxHealthShield')}最大生命`, p('BaseDA') && `增伤+${p('BaseDA')}`]),
    flight: () => join([a('Duration') && `每${a('Duration')}秒突进`, p('PercentDamageTakenHeal') && `恢复所受伤害的${p('PercentDamageTakenHeal')}`]),
    experiment: () => join([a('NumLaboratory') && `实验格${a('NumLaboratory')}处`, a('MaxHealth') && `生命+${a('MaxHealth')}`, p('ExperimentBonusIncrease') && `实验加成+${p('ExperimentBonusIncrease')}`]),
    bruiser: () => join([a('TeamFlatHealth') && `全队生命+${a('TeamFlatHealth')}`, p('BonusPercentHealth') && `生命+${p('BonusPercentHealth')}`]),
    armory: () => a('NumRounds1Star') && `每${a('NumRounds1Star')}场结算开放军械库`,
    sui: () => join([a('NumCastsToUnlock') && `施法${a('NumCastsToUnlock')}次解锁`, p('PercentHealthUnlock') && `生命低于${p('PercentHealthUnlock')}时解锁`, p('PercentHealthPerStarLevel') && `每星生命+${p('PercentHealthPerStarLevel')}`]),
    combo: () => join([p('MinBonusAS') && p('MaxBonusAS') && `攻速+${p('MinBonusAS')}至${p('MaxBonusAS')}`, a('ShieldAmount') && `击杀护盾${a('ShieldAmount')}`, a('ShieldDuration') && `持续${a('ShieldDuration')}秒`]),
    watcher: () => join([p('BaseDR') && `基础承伤-${p('BaseDR')}`, p('IncreasedDR') && `高生命时承伤-${p('IncreasedDR')}`, p('HealthBreakpoint') && `生命高于${p('HealthBreakpoint')}时强化`]),
  };
  return summaries[id]?.() || '';
}
