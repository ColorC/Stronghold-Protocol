const p = n => `${Number((Number(n ?? 0) * 100).toFixed(2))}%`;
/** Common rule once, then comparable per-tier values. Runtime values are already adapted. */
export function nativePactCopy(trait, season) {
  const n = trait.name, h = api => season.heroes.find(x => x.apiName === api)?.operatorName;
  const table = {
    Automata:[`${n}干员造成伤害积累晶体；满20枚后引爆，并追加积累期间伤害的25%。`,v=>`爆发 ${v.MagicDamage} 术法伤害；双抗评分 +${v.Resists}。`],
    Academy:[`本局固定三件赞助装备；持有者获得生命和伤害增幅，${n}干员持有时效果更强。`,v=>`累计领取 ${v.NumOfItems} 件；全队每件 +${p(v.PercentIncreaseSponsored)}，本阵营 +${p(v.PercentIncreaseSponsored*2+v.BaseValues)}。`],
    'Black Rose':[`召唤山海卫灵。${n}干员累计施放技能或卫灵濒危时，卫灵解除束缚并冲锋。`,(v,t)=>`施法 ${v.NumCastsToUnlock} 次或生命低于 ${p(v.PercentHealthUnlock)} 解锁；双抗评分 ${v['{2e45fc86}']}。${t.minUnits>=4?'冲锋标记使本阵营对目标伤害 +15%。':''}${t.minUnits>=5?'解锁时回满生命，并造成敌人最大生命25%的范围伤害。':''}${t.minUnits>=7?'首次倒下后以50%生命复生，攻速 +300%、全能吸血 +40%。':''}`],
    Firelight:[`${n}干员定期冲刺，期间获得无限射程并恢复此前所受伤害的一部分。`,v=>`每 ${v.Duration} 秒冲刺；恢复所受伤害的 ${p(v.PercentDamageTakenHeal)}。`],
    Rebel:[`${n}干员获得额外生命；全队损失30%生命后发出信号，获得攻击与术法增幅，以及短时攻速。`,v=>`生命 +${p(v.MaxHealthIncrease)}；信号：攻击与术法 +${p(v.ADAP)}，攻速 +${p(v.BurstAS)} 持续 ${v.BurstDuration} 秒。${v.PercentMaxHealthBonus?`另获 ${p(v.PercentMaxHealthBonus)} 生命。`:''}${v.StunDuration?`敌人眩晕 ${v.StunDuration} 秒。`:''}${v.ForceDuration?`开战即触发，此后每 ${v.ForceDuration} 秒再次触发。`:''}`],
    'Chem-Baron':[`战后积累微光，连败时积累更快；每100点开启装备交易，略过交易可永久增加${n}干员生命。`,v=>`每战 ${v.ShimmerPerCombat} 点；连败 ${v.MinStreakLength} 场后每战 ${v.ShimmerPerCombatStreaking} 点。略过：生命 +${v.HealthPerSkip}。`],
    Conqueror:[`${n}干员击倒敌人积累征服进度，解锁战利品；每领取一箱，再提升攻击与术法伤害。`,v=>`攻击与术法 +${p(v.ADAPBase)}；每次击倒 +${v.StacksPerKill} 进度，每箱再 +${p(v.PercentIncreasePerChest)}。`],
    Scrap:[`按全队持有的组件数，为${n}干员提供开场护盾。部分组件临时合成装备，战后还原；成装也按内含组件计数。`,(v,t)=>`每组件 ${v.HPShieldAmount} 护盾，持续 ${v.ShieldDuration} 秒；临时合成 ${t.minUnits>=6?'全部':v.NumComponents+' 件'}组件。${v['{659aef8d}']?'优先适合持有者的装备。':''}${v['{7e2474c8}']?'临时装备升为辉光品质。':''}`],
    Enforcer:[`${n}干员获得伤害增幅与护盾，并通缉高生命敌人；击倒通缉目标后，本阵营全体获得攻速。`,v=>`伤害 +${p(v.BaseDA)}；护盾为最大生命的 ${p(v.PercentMaxHealthShield)}。通缉 ${v.NumOfWantedEnemies>=99?'全部':v.NumOfWantedEnemies+' 名'}敌人，每名击倒：攻速 +${p(v.AttackSpeedPerWantedKill)}。`],
    Experiment:[`战场开启实验格。站在实验格上的${n}干员获得额外生命，并共享这些干员各自的实验特效。`,v=>`${v.NumLaboratory} 个实验格；格内成员生命 +${v.MaxHealth}。${v.ExperimentBonusIncrease?'共享特效翻倍。':''}`],
    Sorcerer:[`全队术法伤害提高，${n}干员获得更高增幅。`,v=>`全队 +${v.TeamAP}%；本职业总计 +${v.BaseAP}%。${v.DamageDecrease!=null?`技能命中使敌人伤害降低 ${p(v.DamageDecrease)}，持续 ${v.DamageDecreaseDuration} 秒。`:''}`],
    Visionary:[`${n}干员获得额外技力回复。`,v=>`获得的技力 +${p(v.EnlightenedBonusMana)}。${v.AllyHealing!=null?`技能伤害的 ${p(v.AllyHealing)} 治疗生命最低的友军。`:''}`],
    Sentinel:[`全队获得防御与法抗加成，${n}干员获得三倍效果。`,v=>`全队双抗评分 +${v.BonusArmor}；本职业 +${v.BonusArmor*3}。`],
    Bruiser:[`全队获得固定生命，${n}干员额外获得百分比生命。`,v=>`全队生命 +${v.TeamFlatHealth}；本职业额外 +${p(v.BonusPercentHealth)}。`],
    Watcher:[`${n}干员获得减伤，高于一半生命时效果更强。`,v=>`减伤 ${p(v.BaseDR)}；生命高于 ${p(v.HealthBreakpoint)} 时为 ${p(v.IncreasedDR)}。`],
    Sniper:[`${n}干员与目标的距离越远，伤害越高。`,v=>`每相隔一格，伤害 +${v.PercentDamageIncrease}%。${v.BonusHexRangeIncrease>0?`射程 +${v.BonusHexRangeIncrease} 格。`:''}`],
    Ambusher:[`${n}干员普攻与技能均可暴击，并提高暴击率和暴击伤害。`,v=>`暴击率 +${p(v.CritChance)}；暴击伤害 +${p(v.CritDamage)}。${v.DamageReductionPct!=null?`减伤 ${p(v.DamageReductionPct)}。`:''}`],
    Dominator:[`${n}干员获得开场护盾；消耗技力时，持续累积术法伤害增幅。`,v=>`护盾 ${v.ShieldAmount}，持续 ${v.ShieldDuration} 秒；每消耗1技力，术法伤害 +${p(v.APPercent/100)}。`],
    'Pit Fighter':[`${n}干员获得全能吸血和附加真实伤害，首次濒危时恢复生命。`,v=>`全能吸血 ${p(v.OmnivampPercent)}；额外真实伤害 ${p(v.TrueDamagePercent)}。首次降至 ${p(v.HealthThreshold)} 生命时，恢复 ${p(v.HealPercent)} 最大生命。`],
    Quickstriker:[`${n}干员根据目标已损失生命值提高攻速。`,v=>`攻速 +${p(v.MinBonusAS)}～${p(v.MaxBonusAS)}。${v.ShieldAmount!=null?`击倒后冲向新目标，获得 ${v.ShieldAmount} 护盾，持续 ${v.ShieldDuration} 秒。`:''}`],
    Artillerist:[`${n}干员提高攻击，每5次普攻发射范围火箭。`,v=>`攻击 +${p(v.AD)}；火箭造成 ${p(v.PercentDamage)} 攻击力的范围伤害。`],
    'Form Swapper':[`${n}干员根据部署排数切换增益：前两排擅长承伤，后两排擅长输出。`,v=>`前排减伤 ${p(v.DR)}；后排伤害 +${p(v.DA)}。`],
    Emissary:[`仅恰好上场1名或4名时激活。雷蛇按友军星级增加攻速；瑕光使友军普攻回复额外技力；号角按已获胜场次增强全队防护；塞雷娅增加自己与左右相邻友军生命。`,(v,t)=>t.minUnits===1?`雷蛇：每星 ${p(v.StarAS)} 攻速；瑕光：每次攻击 +${v.NamiMana} 技力；号角：每胜 +${v.AmbessaArmor_PVE??v.AmbessaArmor} 双抗评分，至多7场；塞雷娅：额外生命等于自身最大生命的 ${p(v.GarenHealthPercent)}。`:`同时获得四种效果；4名领军干员各额外获得 ${v.BonusHealth} 生命、${p(v.SelfishDamageAmp)} 伤害增幅。`],
    Family:[`${n}干员获得攻速、减伤，并降低技能消耗。`,v=>`攻速 +${p(v.AttackSpeed)}；减伤 ${p(v.DamageReduction)}；技能消耗 -${p(v.ManaReduction)}。${v['{01fcc30b}']!=null?'战后存活成员还会推进战利品奖励。':''}`],
    'High Roller':[`${n}干员施放技能时随机强化：火箭、护盾或金币；也可能获得三倍效果。`,v=>`${v.Bonus1NumRockets} 枚火箭，每枚 ${v.Bonus1RocketDamage} 物理伤害；或 ${v.Bonus2ShieldAmount} 护盾持续 ${v.Bonus2ShieldDuration} 秒；或战后获得 ${v.Bonus4Gold} 金币。施法后减伤 ${p(v.Durability)}，持续 ${v.Duration} 秒。`],
    'Junker King':[`场上最强的${h('TFT13_Rumble')}可在升级铺购买永久强化。`,v=>`每 ${v.NumRounds1Star} 场战斗开放一次，按标价购买，也可略过。`],
  };
  const row=table[trait.sourceName];
  if(!row)throw new Error(`NATIVE_PACT_COPY_MISSING:${trait.sourceName}`);
  const bonus=api=>season.heroes.find(x=>x.apiName===api)?.experimentBonus?.sourceVariables??{};
  const notes=trait.sourceName==='Experiment'?[
    {name:h('TFT13_Zyra'),text:`技能造成伤害后，在2秒内追加该次伤害的 ${p(bonus('TFT13_Zyra').ExperimentTrueDamage)} 真实伤害。`},
    {name:h('TFT13_Urgot'),text:`开战及技能结束时突进，获得 ${p(bonus('TFT13_Urgot').ExperimentPercentHealthShield)} 最大生命护盾与 ${p(bonus('TFT13_Urgot').ExperimentAttackSpeed)} 攻速，持续 ${bonus('TFT13_Urgot').ExperimentDuration} 秒。`},
    {name:h('TFT13_NunuWillump'),text:`造成伤害时追加自身最大生命 ${p(bonus('TFT13_NunuWillump').ExperimentMaxHealthDamage)} 的术法伤害，冷却 ${bonus('TFT13_NunuWillump').ExperimentICD} 秒。`},
    {name:h('TFT13_DrMundo'),text:`开战增加 ${bonus('TFT13_DrMundo').BaseExperimentHealthGain} 生命；每次击倒再增加 ${bonus('TFT13_DrMundo').ExperimentHealthGain} 生命，持续本场。`},
    {name:h('TFT13_Twitch'),text:`每 ${bonus('TFT13_Twitch').ExperimentDamageTicks} 次普攻，追加目标最大生命 ${p(bonus('TFT13_Twitch').ExperimentMaxHealthDamage)} 的物理伤害。`},
  ]:[];
  return {overview:row[0],tier:tier=>row[1](tier.variables,tier),notes};
}
