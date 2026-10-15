# 进击逐卡设计 — 支援组

来源修订：`17759cc8cdf37388414145d16262a3a06f3ab25e`。共 57 名。数值为进击转译，非原作事实；生命基础整体×5，四星倍率统一 1/1.55/2.2/3（攻）与 1/1.65/2.6/4（生命）。

## 香草（`char_240_wyvern`）
- 职业：PIONEER；档位：1（2 金币）；路线：`economyGrowth`
- 定位：开局低费先锋，负责首轮部署费用回复与双阻挡站场。
- 档位理由：原生只有单技能且白值低，作为开局铺场的回费点，落在二金币最低档。
- 设计理由：把冲锋号令的回费定位做成技力满即结算的即时经济，作为前期铺场的稳定费用源。

### 固定技能：冲锋号令·援军（进击）
- 来源技能：`skchr_wyvern_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[20,17,20,24]；初始技力：[6,6,8,10]
- 自然技力满时立即结算：获得部署费用并短时提升自身攻击力，不等待下一次普通攻击。
- 效果1：立即获得3/4/5/6点部署费用，按星级取对应值。
  - trigger=自然技力满；target=自身；action=economy；lifecycle=instant
  - values={"costGain":[3,4,5,6]}；stacking=单次结算只计一次；limits=每场战斗不限次数，仅在技力满时结算
- 效果2：攻击力+20%/28%/36%/45%，持续8/8/9/10秒，同名刷新取较长剩余时间。
  - trigger=同一结算；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[0.2,0.28,0.36,0.45],"duration":[8,8,9,10]}；stacking=同名刷新不叠加；limits=无额外次数限制

### 原生天赋计划
- 攻击提升（`/char_240_wyvern/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 由无条件白值改为触发式：获得部署费用后短时提升攻击力。
  - scope=自身；parameters={"atkByStar":[0.08,0.14,0.2,0.28],"duration":8}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：每获得1点部署费用叠一层攻击力+2%/3%/4%/5%，同源每8秒最多一层，最多5层，持续到战斗结束。
  - trigger=自身每获得1点部署费用；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[0.02,0.03,0.04,0.05],"maxStacks":[5,5,5,5],"rechargeSec":[8,8,6,6]}；stacking=不同来源独立计数，同源刷新不叠层；limits=每8秒一次

### 星级
- ★1（攻×1、生命×1）：基准：费用+3、攻击+20%、持续8秒，技力20，初始6。
  - 被动：基准：每点费用叠攻击+2%，上限5层。
- ★2（攻×1.55、生命×1.65）：费用+4、攻击+28%、持续8秒，技力17，初始6。
  - 被动：每点费用叠攻击+3%，每8秒一层。
- ★3（攻×2.2、生命×2.6）：费用+5、攻击+36%、持续9秒，技力20，初始8。
  - 被动：每点费用叠攻击+4%，触发间隔缩至6秒。
- ★4（攻×3、生命×4）：费用+6、攻击+45%、持续10秒，技力24，初始10。
  - 被动：每点费用叠攻击+5%，触发间隔6秒，上限5层。

### 模组
- 默认模组：null

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_240_wyvern`
实现：复用先锋回费KIT与economy账目：新增技力满即时结算hook，接入costGain与短时atk buff，不需要召唤或弹药资源。
因果检查：
- 技力满触发结算：costGain只入账一笔，重复施放不会在同一结算产生第二笔费用。
- 自身无目标限制，addBuff必然落在自身；同名buff刷新只延长剩余时间，层数不增加。

## 红豆（`char_290_vigna`）
- 职业：PIONEER；档位：2（3 金币）；路线：`pierceCrit`
- 定位：击杀回费的突刺先锋，承担前期直线爆发与穿刺暴击。
- 档位理由：击杀回费加技能穿刺，兼具经济与前期击杀能力，定三金币档。
- 设计理由：把槌音改写为技力满即结算的穿刺重击，蛮力穿刺转为可核对的概率暴击。

### 固定技能：槌音（进击）
- 来源技能：`skchr_vigna_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[28,24,28,32]；初始技力：[5,5,8,10]
- 技力满立即对前方至多两名敌人各打出一记高倍率物理穿刺，并进行一次蛮力穿刺暴击判定。
- 效果1：对至多1/1/2/2名敌人造成攻击力160%/200%/240%/300%的物理伤害。
  - trigger=自然技力满；target=前方攻击范围内敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.6,2,2.4,3],"targets":[1,1,2,2]}；stacking=每次结算各目标独立结算一次；limits=每场战斗不限次数
- 效果2：对本次施法自身穿刺的直接伤害做一次30%暴击判定：命中则本次直接伤害倍率变为150%/175%/200%/250%，未命中按基准结算；一次施法只消耗一次RNG，不额外产生第二段damage。
  - trigger=同一结算；target=本次穿刺命中目标；action=nativeMechanism；lifecycle=instant
  - values={"modifiesEffectIndex":0,"critProb":[0.3,0.3,0.3,0.3],"critScale":[1.5,1.75,2,2.5],"rngPerCast":1,"noExtraDamageInstance":1}；stacking=每次施法只判定一次；limits=无额外次数限制

### 原生天赋计划
- 蛮力穿刺（`/char_290_vigna/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 改写为固定技能结算时的穿刺暴击判定，由 assaultTalent 单份登记但不在天赋处自行执行：执行者为 fixedSkill.effects[1]，一次施法仅一次RNG，作用于本次穿刺的直接伤害倍率，不额外产生第二段damage。
  - scope=自身固定技能；parameters={"delegatesToFixedSkillEffect":1,"executionOwner":"fixedSkill","critProb":0.3,"critScaleByStar":[1.5,1.75,2,2.5],"rngPerCast":1,"appliesTo":"firstDirectDamageMultiplier","noExtraDamageInstance":true}；trigger=技能/技力事件时；unlockStar=1

### 进击被动
- 被动0：击杀敌人后立即获得1点部署费用；撤退时返还初始部署费用，这是冲锋手原生特性在进击中的保留。
  - trigger=击倒敌人；target=自身；action=economy；lifecycle=instant
  - values={"costGain":[1,1,1,1]}；stacking=每次击倒各计一次；limits=击倒事件每次结算一次

### 星级
- ★1（攻×1、生命×1）：基准：160%穿刺，单目标，30%概率×1.5，技力28，初始5。
  - 被动：基准：击杀回1费，撤退返还初始费用。
- ★2（攻×1.55、生命×1.65）：200%穿刺，单目标，30%概率×1.75，技力24，初始5。
  - 被动：击杀回1费，撤退返还初始费用。
- ★3（攻×2.2、生命×2.6）：240%穿刺，双目标，30%概率×2.0，技力28，初始8。
  - 被动：击杀回1费，撤退返还初始费用。
- ★4（攻×3、生命×4）：300%穿刺，双目标，30%概率×2.5，技力32，初始10。
  - 被动：击杀回1费，撤退返还初始费用。

### 模组
- 默认模组：uniequip_002_vigna
- `uniequip_001_vigna`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_vigna`（ADVANCED/rewrite）：三星解锁：进击转译：暴击判定失败时返还本次结算的1点技力，每场最多触发3次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_290_vigna`
实现：复用冲锋手击杀回费KIT；新增固定技能瞬时多目标damage与一次crit判定，暴击走独立乘区，不改基础攻击间隔。
因果检查：
- 同一敌人被同一结算命中只结算一次，多目标时各目标独立暴击。
- 击倒触发的回费只随击倒事件增加；免疫击杀不触发，撤退返还与击杀回费互不重复。

## 桃金娘（`char_151_myrtle`）
- 职业：PIONEER；档位：3（4 金币）；路线：`economyGrowth`
- 定位：核心回费旗手，技能期放弃阻挡换取集中费用与先锋续航。
- 档位理由：全队费用引擎且附带回费触发的先锋治疗，作用面广，定四金币档。
- 设计理由：把支援号令做成即时大额回费，技能期阻挡归零作为明确代价，浮光跃金改为回费触发的治疗。

### 固定技能：支援号令·β型（进击）
- 来源技能：`skcom_assist_cost[2]`（index 0）；类型：instant；自然回复：1/秒
- 技力：[22,19,22,26]；初始技力：[10,10,13,13]
- 技力满立即结算：获得一大笔部署费用，并在结算瞬间起数秒内自身阻挡数变为0。
- 效果1：立即获得10/12/14/16点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[10,12,14,16]}；stacking=单次结算只计一次；limits=每场战斗不限次数
- 效果2：结算后3/3/4/4秒内自身阻挡数变为0，是回费旗手原生特性的代价。
  - trigger=同一结算；target=自身；action=modifyTag；lifecycle=battle
  - values={"blockCnt":[0,0,0,0],"duration":[3,3,4,4]}；stacking=刷新取较长剩余时间；limits=同一结算只施加一次

### 原生天赋计划
- 浮光跃金（`/char_151_myrtle/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由常驻全体先锋回血改为回费触发的定向治疗。
  - scope=攻击范围内先锋干员；parameters={"healScaleByStar":[0.25,0.3,0.35,0.4]}

### 进击被动
- 被动0：每次自身获得部署费用时，治疗攻击范围内全体先锋相当于桃金娘攻击力25%/30%/35%/40%的生命。
  - trigger=自身获得部署费用；target=攻击范围内友方先锋；action=heal；lifecycle=instant
  - values={"healScale":[0.25,0.3,0.35,0.4]}；stacking=同一次费用入账只触发一次；多数值入账按事件次数分别触发；limits=按回费事件次数结算；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：回费10，阻挡归零3秒，技力22，初始10。
  - 被动：基准：回费触发治疗25%。
- ★2（攻×1.55、生命×1.65）：回费12，阻挡归零3秒，技力19，初始10。
  - 被动：回费触发治疗30%。
- ★3（攻×2.2、生命×2.6）：回费14，阻挡归零4秒，技力22，初始13。
  - 被动：回费触发治疗35%，回费事件按1分钟内的第3次起治疗量提升一档。
- ★4（攻×3、生命×4）：回费16，阻挡归零4秒，技力26，初始13。
  - 被动：回费触发治疗40%，治疗目标额外获得1秒抵抗。

### 模组
- 默认模组：uniequip_002_myrtle
- `uniequip_001_myrtle`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_myrtle`（ADVANCED/rewrite）：三星解锁：每次回费结算额外使下一次部署费用-1，每场最多触发5次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_151_myrtle`
实现：复用旗手回费KIT；新增economy即时结算与短时blockCnt覆盖，回费事件广播给治疗被动，治疗走现有heal原子。
因果检查：
- 一次回费结算只触发一次治疗，即使数值超过1点也不按点数重复治疗。
- 阻挡归零期间仍可回费；同名覆盖刷新取较长剩余时间，不叠加时间。

## 调香师（`char_181_flower`）
- 职业：MEDIC；档位：2（3 金币）；路线：`healShield`
- 定位：群疗兼全场缓回的医疗，负责持续血线维持与范围治疗。
- 档位理由：原生全场缓回加群疗，站场价值稳定但输出为零，定三金币档。
- 设计理由：把治疗强化做成即时群体结算，熏衣草改为技能触发的限时全场持续回复。

### 固定技能：治疗强化·β型（进击）
- 来源技能：`skcom_heal_up[2]`（index 0）；类型：instant；自然回复：1/秒
- 技力：[32,26,26,30]；初始技力：[10,10,13,13]
- 技力满立即治疗攻击范围内生命比例最低的至多3名友方，治疗量为攻击力的倍数。
- 效果1：立即治疗至多2/3/3/3名生命比例最低的友方，治疗量为攻击力100%/125%/150%/180%。
  - trigger=自然技力满；target=攻击范围内友方；action=heal；lifecycle=instant
  - values={"healScale":[1,1.25,1.5,1.8],"targets":[2,3,3,3]}；stacking=每次结算每目标只结算一次；limits=每场战斗不限次数

### 原生天赋计划
- 熏衣草（`/char_181_flower/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由常驻全场回血改为固定技能结算后短时限的全场持续回复，避免永久光环。
  - scope=全体友方；parameters={"healPerSec":[0.03,0.04,0.05,0.06],"duration":[6,7,8,8]}

### 进击被动
- 被动0：结算后6/7/8/8秒内全体友方每秒回复调香师攻击力3%/4%/5%/6%的生命，同名刷新取较长剩余时间。
  - trigger=自身固定技能结算；target=全体友方；action=heal；lifecycle=battle
  - values={"healPerSec":[0.03,0.04,0.05,0.06],"duration":[6,7,8,8]}；stacking=同名时限刷新不叠加；limits=每次技能结算施加一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：治疗100%打2目标，技力32，初始10。
  - 被动：基准：结算后6秒每秒回复3%攻击。
- ★2（攻×1.55、生命×1.65）：治疗125%打3目标，技力26，初始10。
  - 被动：结算后7秒每秒回复4%攻击。
- ★3（攻×2.2、生命×2.6）：治疗150%打3目标，技力26，初始13。
  - 被动：结算后8秒每秒回复5%攻击。
- ★4（攻×3、生命×4）：治疗180%打3目标，技力30，初始13。
  - 被动：结算后8秒每秒回复6%攻击，缓回期间目标受到的减益持续时间-20%。

### 模组
- 默认模组：uniequip_002_flower
- `uniequip_001_flower`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_flower`（ADVANCED/rewrite）：三星解锁：缓回持续时间+2秒，且缓回期间被治疗目标每次受击额外回复调香师攻击力5%的生命，每秒最多触发一次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_181_flower`
实现：复用群疗医疗KIT；新增技能瞬时多目标heal与限时全场heal-per-sec，后者挂battle生命周期并按秒tick。
因果检查：
- 一次技能只施加一层缓回；重复施放刷新剩余时间而不叠加每秒治疗。
- 目标满血时缓回仍记录但不转化为过量护盾，治疗统计计入实际入账。

## 清流（`char_385_finlpp`）
- 职业：MEDIC；档位：3（4 金币）；路线：`healShield`
- 定位：远距离范围群疗，靠治疗附加抵抗应对异常状态。
- 档位理由：大范围即时群疗加抵抗，是异常应对支点，定四金币档。
- 设计理由：把治愈水波做成即时全范围治疗，快速愈合转为治疗附带的限时抵抗状态。

### 固定技能：治愈水波（进击）
- 来源技能：`skchr_finlpp_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[24,20,20,24]；初始技力：[10,10,15,15]
- 技力满立即治疗攻击范围内所有友方，治疗量为攻击力倍数。
- 效果1：立即治疗范围内所有友方，治疗量为攻击力200%/260%/320%/400%。
  - trigger=自然技力满；target=攻击范围内所有友方；action=heal；lifecycle=instant
  - values={"healScale":[2,2.6,3.2,4]}；stacking=每次结算每目标只结算一次；limits=每场战斗不限次数

### 原生天赋计划
- 快速愈合（`/char_385_finlpp/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 治疗附加抵抗：由 modePassive[0] 单份承接，按星级2/3/4/4秒，异常持续时间×0.5；三星起自身也获得同效果，四星治疗异常目标时额外移除1个异常。
  - scope=被治疗目标；parameters={"resistSec":[2,3,4,4],"oneMinusResist":0.5}

### 进击被动
- 被动0：每次治疗命中后使目标获得2/3/4/4秒抵抗（异常持续时间×0.5），同名刷新取较长剩余时间；三星起自身也获得同效果。四星起，若治疗的是处于异常状态的目标，按固定优先 stun>frozen>cold>sleep>root>sluggish>silence 移除其中1个已有异常（仅这七种，不清技能、不清元素爆发）；自身授予的抵抗持续期内，目标元素槽累计倍率×0.85。模组追加的合法独立治疗同样正常触发抵抗，visited 路径仅阻止同一次派生回到自身形成回路，不删除合法收益。
  - trigger=自身完成一次治疗（含模组追加的合法独立治疗）；target=被治疗目标；action=applyStatus；lifecycle=battle
  - values={"status":"resist","statusDurationMultiplier":0.5,"resistSec":[2,3,4,4],"selfAlso":[0,0,1,1],"cleanseOnHealAbnormal":{"enabled":[0,0,0,1],"priority":["stun","frozen","cold","sleep","root","sluggish","silence"],"maxRemove":1,"excludes":["activeSkill","elementBurst"]},"elementSlotMultiplier":[1,1,1,0.85],"elementSlotMultiplierScope":"duringSelfGrantedResist"}；stacking=同名刷新不叠加；cleanse每治疗目标每次最多移除1个。；limits=每次治疗各触发一次；元素槽倍率只作用于自身授予的抵抗期间。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：范围治疗200%，技力24，初始10。
  - 被动：基准：治疗附2秒抵抗。
- ★2（攻×1.55、生命×1.65）：范围治疗260%，技力20，初始10。
  - 被动：治疗附3秒抵抗。
- ★3（攻×2.2、生命×2.6）：范围治疗320%，技力20，初始15。
  - 被动：治疗附4秒抵抗（×0.5），自身也获得同效果。
- ★4（攻×3、生命×4）：范围治疗400%，技力24，初始15。
  - 被动：治疗附4秒抵抗；四星治疗异常目标额外移除1个异常（七种固定优先）；自身授予的抵抗内元素槽累计×0.85（-15%）。

### 模组
- 默认模组：uniequip_002_finlpp
- `uniequip_001_finlpp`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_finlpp`（ADVANCED/rewrite）：三星解锁：范围治疗额外向最远目标追加一次50%治疗；该追加治疗是合法独立治疗，正常触发抵抗，visited 路径防止同一次派生自回路。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_385_finlpp`
实现：复用大范围医疗KIT；技能为瞬时全范围heal，抵抗走applyStatus；追加治疗走独立heal实例，避免与抵抗被动同链重复。
因果检查：
- 每次成功治疗都触发一次抵抗；模组追加的独立治疗同样是合法根事件，正常触发抵抗，visited 只阻止同一次派生回到自身。
- 四星移除异常只从 stun/frozen/cold/sleep/root/sluggish/silence 中按优先移除1个，不清技能、不清元素爆发；元素槽倍率只在自身授予抵抗期间生效。

## 角峰（`char_199_yak`）
- 职业：TANK；档位：2（3 金币）；路线：`blockCounter`
- 定位：三阻挡法抗重装，靠短时防御与法抗强化吸收爆发。
- 档位理由：原生高法抗与自愈，作为对抗法术的支点，定三金币档。
- 设计理由：抗寒体质做成即时爆发性防御结算，雪原卫士改为受击触发的限时法抗提升。

### 固定技能：抗寒体质（进击）
- 来源技能：`skchr_yak_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[32,28,28,36]；初始技力：[5,5,10,10]
- 技力满立即结算：短时提升生命上限、防御力与法术抗性。
- 效果1：生命上限+40%/50%/60%/70%，防御+30%/40%/50%/60%，法抗+50%/70%/90%/100%，持续20/24/28/30秒。
  - trigger=自然技力满；target=自身；action=addBuff；lifecycle=battle
  - values={"maxHp":[0.4,0.5,0.6,0.7],"def":[0.3,0.4,0.5,0.6],"res":[0.5,0.7,0.9,1],"duration":[20,24,28,30]}；stacking=同名刷新取较长剩余时间；limits=每场战斗不限次数

### 原生天赋计划
- 雪原卫士（`/char_199_yak/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由常驻法抗改为受法术伤害后短时法抗提升。
  - scope=自身；parameters={"resByStar":[5,8,12,15],"duration":6}

### 进击被动
- 被动0：每次受到法术伤害后6秒内法术抗性+5/8/12/15，同名刷新取较长剩余时间，不叠层。
  - trigger=受到法术伤害；target=自身；action=addBuff；lifecycle=battle
  - values={"res":[5,8,12,15],"duration":[6,6,6,6]}；stacking=同名不叠加；limits=同一次受击只触发一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：生命+40%、防御+30%、法抗+50%持续20秒，技力32，初始5。
  - 被动：基准：受法伤后法抗+5持续6秒。
- ★2（攻×1.55、生命×1.65）：生命+50%、防御+40%、法抗+70%持续24秒，技力28，初始5。
  - 被动：受法伤后法抗+8持续6秒。
- ★3（攻×2.2、生命×2.6）：生命+60%、防御+50%、法抗+90%持续28秒，技力28，初始10。
  - 被动：受法伤后法抗+12持续6秒，并回复1点技力。
- ★4（攻×3、生命×4）：生命+70%、防御+60%、法抗+100%持续30秒，技力36，初始10。
  - 被动：受法伤后法抗+15持续6秒并回复1点技力，法抗提升期间受到的物理伤害-10%。

### 模组
- 默认模组：uniequip_002_yak
- `uniequip_001_yak`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_yak`（ADVANCED/rewrite）：三星解锁：法抗超过50后，每超出10点使受到的法术伤害额外-2%，上限-10%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_199_yak`
实现：复用重装防御KIT；技能为自身addBuff（maxHp/def/res），雪原卫士改受击触发的res buff，不新增召唤。
因果检查：
- 一次法术受击只触发一次法抗增益；同名刷新只延长剩余时间，数值不叠加。
- 法抗提升对法术减伤按现有公式结算；对物理伤害默认无影响（仅四星模组改写项涉及）。

## 蛇屠箱（`char_150_snakek`）
- 职业：TANK；档位：2（3 金币）；路线：`blockCounter`
- 定位：放弃输出的极限肉盾，靠高阶防御与自愈守住三阻挡位。
- 档位理由：纯防御定位、无伤害但极耐打，作为廉价肉盾定三金币档。
- 设计理由：壳状防御做成即时防御爆发与自愈，防御专精改为受击触发的短时防御提升。

### 固定技能：壳状防御（进击）
- 来源技能：`skchr_snakek_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[40,34,34,42]；初始技力：[0,0,5,5]
- 技力满立即结算：数秒内停止攻击、阻挡数+1、防御大幅提升并每秒回复最大生命。
- 效果1：24/26/28/30秒内防御+95%/110%/130%/150%、阻挡数+1，期间停止攻击。
  - trigger=自然技力满；target=自身；action=addBuff；lifecycle=battle
  - values={"def":[0.95,1.1,1.3,1.5],"blockCnt":[1,1,1,1],"duration":[24,26,28,30]}；stacking=同名刷新取较长剩余时间；limits=每场战斗不限次数
- 效果2：持续期间每秒回复最大生命2%/2.5%/3%/3.5%。
  - trigger=同一结算持续期间；target=自身；action=heal；lifecycle=battle
  - values={"maxHpPerSec":[0.02,0.025,0.03,0.035]}；stacking=同名刷新不叠加回复速率；limits=每秒结算一次

### 原生天赋计划
- 防御专精（`/char_150_snakek/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由常驻防御百分比改为受击后短时防御提升。
  - scope=自身；parameters={"defByStar":[0.06,0.09,0.12,0.16],"duration":5}

### 进击被动
- 被动0：每次受到攻击后5秒内防御+6%/9%/12%/16%，同名刷新不叠加。
  - trigger=受到攻击；target=自身；action=addBuff；lifecycle=battle
  - values={"def":[0.06,0.09,0.12,0.16],"duration":[5,5,5,5]}；stacking=同名不叠加；limits=同一次受击只触发一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：防御+95%、阻挡+1持续24秒，自愈2%/秒，技力40。
  - 被动：基准：受击后防御+6%持续5秒。
- ★2（攻×1.55、生命×1.65）：防御+110%、阻挡+1持续26秒，自愈2.5%/秒，技力34。
  - 被动：受击后防御+9%持续5秒。
- ★3（攻×2.2、生命×2.6）：防御+130%、阻挡+1持续28秒，自愈3%/秒，技力34，初始5。
  - 被动：受击后防御+12%持续5秒。
- ★4（攻×3、生命×4）：防御+150%、阻挡+1持续30秒，自愈3.5%/秒，技力42，初始5。
  - 被动：受击后防御+16%持续5秒，技能期间额外免疫击退与位移。

### 模组
- 默认模组：uniequip_002_snakek
- `uniequip_001_snakek`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_snakek`（ADVANCED/rewrite）：三星解锁：固定技能持续期间，每次受到近战攻击对攻击者造成蛇屠箱防御力30%的物理伤害，每秒最多触发一次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_150_snakek`
实现：复用重装防御KIT；技能为自身addBuff与持续heal，受击触发防御被动；反伤在模组改写项内单独实现，挂受击事件。
因果检查：
- 持续期间每秒只回复一次，重复施放刷新时间但不叠加回复速率。
- 受击触发防御增益同帧多次受击只结算一层；反伤每帧/秒最多一次，避免连锁反伤。

## 泡泡（`char_381_bubble`）
- 职业：TANK；档位：2（3 金币）；路线：`blockCounter`
- 定位：嘲讽挨打型重装，靠吸引火力与受击减攻保护队友。
- 档位理由：嘲讽与稳定减攻，功能明确但输出低，定三金币档。
- 设计理由：挨打做成即时嘲讽与受击反伤，尖刺盾转为受击给攻击者上减攻状态。

### 固定技能：“挨打”（进击）
- 来源技能：`skchr_bubble_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[45,40,40,45]；初始技力：[0,0,5,5]
- 技力满立即结算：数秒内嘲讽、防御提升，且每次被攻击对攻击者造成防御力比例的物理伤害。
- 效果1：20/22/24/25秒内更易受攻击（嘲讽+1），防御+85%/100%/120%/135%。
  - trigger=自然技力满；target=自身；action=applyStatus；lifecycle=battle
  - values={"status":1,"tauntLevel":[1,1,1,1],"def":[0.85,1,1.2,1.35],"duration":[20,22,24,25]}；stacking=同名刷新取较长剩余时间；limits=每场战斗不限次数
- 效果2：每次受到攻击对攻击者造成泡泡防御力40%/45%/50%/60%的物理伤害。
  - trigger=持续期间受到攻击；target=攻击者；action=damage；lifecycle=instant
  - values={"defScale":[0.4,0.45,0.5,0.6]}；stacking=同一次受击只反伤一次；limits=每次受击结算一次

### 原生天赋计划
- 尖刺盾（`/char_381_bubble/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由受击使攻击者攻击力下降改为受击触发的减攻状态，持续与数值按星级。
  - scope=攻击者；parameters={"atkDown":[-0.05,-0.06,-0.08,-0.1],"duration":5}

### 进击被动
- 被动0：每次受到攻击使攻击者攻击力-5%/6%/8%/10%，持续5秒，同名刷新取较强数值。
  - trigger=受到攻击；target=攻击者；action=applyStatus；lifecycle=battle
  - values={"atkDown":[-0.05,-0.06,-0.08,-0.1],"duration":[5,5,5,5]}；stacking=同名取较强不叠加；limits=同一次受击只施加一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：嘲讽+1、防御+85%持续20秒，反伤40%，技力45。
  - 被动：基准：受击者攻击-5%持续5秒。
- ★2（攻×1.55、生命×1.65）：嘲讽+1、防御+100%持续22秒，反伤45%，技力40。
  - 被动：受击者攻击-6%持续5秒。
- ★3（攻×2.2、生命×2.6）：嘲讽+1、防御+120%持续24秒，反伤50%，技力40，初始5。
  - 被动：受击者攻击-8%持续5秒。
- ★4（攻×3、生命×4）：嘲讽+1、防御+135%持续25秒，反伤60%，技力45，初始5。
  - 被动：受击者攻击-10%持续5秒，且减攻目标对泡泡造成的伤害-10%。

### 模组
- 默认模组：uniequip_002_bubble
- `uniequip_001_bubble`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_bubble`（ADVANCED/rewrite）：三星解锁：反伤额外附加0.5秒停顿，对同一目标每3秒最多一次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_381_bubble`
实现：复用重装嘲讽KIT；技能施加taunt与def buff，受击事件驱动反伤与减攻状态，减攻走applyStatus统一结算。
因果检查：
- 一次受击只给攻击者施加一层减攻并只反伤一次，同帧多段攻击各自独立计数。
- 嘲讽存在时敌人优先选择泡泡；减攻同名取较强值，较弱刷新不覆盖。

## 古米（`char_196_sunbr`）
- 职业：TANK；档位：2（3 金币）；路线：`healShield`
- 定位：可治疗友方的阻挡重装，靠攻击附带治疗与概率晕眩站场。
- 档位理由：原生守护者治疗与概率控制，功能复合但白值低，定三金币档。
- 设计理由：备用军粮做成技力满即治疗的即时治疗，平底锅专精改为攻击触发的概率强化与晕眩。

### 固定技能：备用军粮（进击）
- 来源技能：`skchr_sunbr_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[5,4,5,6]；初始技力：[0,0,2,3]
- 技力满立即治疗附近生命比例最低的至多1名友方，治疗量为攻击力倍数，不等待下一普攻。
- 效果1：立即治疗至多1/1/2/2名生命比例最低友方，治疗量为攻击力130%/155%/180%/210%。
  - trigger=自然技力满；target=附近友方；action=heal；lifecycle=instant
  - values={"healScale":[1.3,1.55,1.8,2.1],"targets":[1,1,2,2]}；stacking=每次结算每目标一次；limits=每场战斗不限次数

### 原生天赋计划
- 平底锅专精（`/char_196_sunbr/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由普通攻击概率强化改为攻击命中时的概率强化与晕眩，随星级提升。
  - scope=被命中敌人；parameters={"prob":[0.1,0.1,0.15,0.15],"atkScale":[1.5,1.6,1.8,2],"stun":[0.5,0.7,1,1.2]}

### 进击被动
- 被动0：每次命中10%/10%/15%/15%概率把该次攻击提升至150%/160%/180%/200%并晕眩0.5/0.7/1.0/1.2秒。
  - trigger=普通攻击命中；target=被命中敌人；action=damage；lifecycle=instant
  - values={"prob":[0.1,0.1,0.15,0.15],"scale":[1.5,1.6,1.8,2],"stun":[0.5,0.7,1,1.2]}；stacking=每次命中只判定一次；limits=无额外次数限制；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：治疗130%单目标，技力5。
  - 被动：基准：10%概率×1.5并晕眩0.5秒。
- ★2（攻×1.55、生命×1.65）：治疗155%单目标，技力4。
  - 被动：10%概率×1.6并晕眩0.7秒。
- ★3（攻×2.2、生命×2.6）：治疗180%双目标，技力5，初始2。
  - 被动：15%概率×1.8并晕眩1.0秒。
- ★4（攻×3、生命×4）：治疗210%双目标，技力6，初始3。
  - 被动：15%概率×2.0并晕眩1.2秒，晕眩期间目标受到的治疗-30%。

### 模组
- 默认模组：uniequip_002_sunbr
- `uniequip_001_sunbr`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_sunbr`（ADVANCED/rewrite）：三星解锁：固定技能治疗目标额外获得3秒每秒回复古米攻击力15%的缓回，不叠加。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_196_sunbr`
实现：复用守护者治疗KIT；固定技能瞬时heal，平底锅走攻击命中事件触发damage+stun，不新增召唤。
因果检查：
- 每次普攻命中最多触发一次强化判定，多目标攻击各目标独立判定。
- 晕眩重复施加按成功施加计数；免疫晕眩的目标不计入触发统计。

## 白面鸮（`char_128_plosis`）
- 职业：MEDIC；档位：5（8 金币）；路线：`skillCycle`
- 定位：技力引擎兼群疗，靠短时全队攻速爆发拉高节奏。
- 档位理由：原生技力光环是全场节奏核心，进击保留为触发式后仍价值极高，定八金币档。
- 设计理由：脑啡肽做成即时全队攻速爆发；技力光环改写为技能触发的限时全队回技力，杜绝永久加速。

### 固定技能：脑啡肽（进击）
- 来源技能：`skchr_plosis_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[100,80,90,100]；初始技力：[20,20,30,30]
- 技力满立即结算：先为全体友方回复一次生命，再短时提升全队攻击速度；保留医疗职责，不装成原生纯辅助技能。
- 效果1：立即为全体友方回复相当于自身攻击力120%/150%/180%/220%的生命；这是脑啡肽治疗职责的进击转译，不等待下一次普通攻击。
  - trigger=自然技力满；target=全体友方；action=heal；lifecycle=instant
  - values={"healRatio":[1.2,1.5,1.8,2.2]}；stacking=每次结算对每个友方只结算一次。；limits=每场战斗不限次数。
- 效果2：全队攻击速度+60/90/120/150，持续10/12/14/16秒，同名刷新取较高数值与较长剩余时间。
  - trigger=自然技力满；target=全体友方；action=addBuff；lifecycle=battle
  - values={"attackSpeed":[60,90,120,150],"duration":[10,12,14,16]}；stacking=同名取较强不叠加；limits=每场战斗不限次数

### 原生天赋计划
- 技力光环（`/char_128_plosis/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 技力光环不再是常驻全场加速；改写为固定技能结算后限时全队自然回技力提升，由 modePassive[0] 单份承接，原生天赋不另运行。
  - scope=全体友方；parameters={"spPerSec":[0.3,0.4,0.5,0.6],"duration":[8,8,10,10]}

### 进击被动
- 被动0：结算后8/8/10/10秒内全体友方每秒额外获得0.3/0.4/0.5/0.6点技力；同名取较强值不叠加，异源加速各自合法结算，不设全队公共上限。
  - trigger=自身固定技能结算；target=全体友方；action=spGain；lifecycle=battle
  - values={"spPerSec":[0.3,0.4,0.5,0.6],"duration":[8,8,10,10]}；stacking=同名取较强值不叠加；与其它异源加速分别结算，不合并截断。；limits=每次技能结算施加一次，持续时间有限；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：治疗全体友方120%攻击；全队攻速+60持续10秒，技力100，初始20。
  - 被动：基准：结算后8秒全队每秒+0.3技力。
- ★2（攻×1.55、生命×1.65）：治疗150%攻击；全队攻速+90持续12秒，技力80，初始20。
  - 被动：结算后8秒全队每秒+0.4技力。
- ★3（攻×2.2、生命×2.6）：治疗180%攻击；全队攻速+120持续14秒，技力90，初始30。
  - 被动：结算后10秒全队每秒+0.5技力。
- ★4（攻×3、生命×4）：治疗220%攻击；全队攻速+150持续16秒，技力100，初始30。
  - 被动：结算后10秒全队每秒+0.6技力。

### 模组
- 默认模组：uniequip_002_plosis
- `uniequip_001_plosis`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_plosis`（ADVANCED/rewrite）：三星解锁：限时全队回技力期间自身额外获得0.5/秒技力，且该光环持续时间+2秒；四星加强：自身额外提升至0.6/秒、光环持续再+2秒；随光环时限结束，不一次赠送总量；原常驻光环不另装。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_128_plosis`
实现：复用医疗与SP系统；固定技能全队attackSpeed buff，技力光环改为技能触发的限时sp-per-sec，接入统一加速叠加规则。
因果检查：
- 限时回技力只在技能结算后生效，超时自动到期；没有永久加速残留。
- 多个异源加速各自结算，不设全队公共上限、不互相截断；溢出技力不计入净入账。
- 治疗与攻速在每次结算各自生效一次，治疗按攻击力比例计算并使用新的生命上限。

## 瑰盐（`char_4163_rosesa`）
- 职业：MEDIC；档位：3（4 金币）；路线：`healShield`
- 定位：群疗医师，靠治疗强化与受治疗加成稳住血线。
- 档位理由：原生治疗加成与增疗定位，功能性中档，定四金币档。
- 设计理由：应急药做成即时增疗，草药医生改为治疗触发的受治疗加成。

### 固定技能：上佳的应急药呀（进击）
- 来源技能：`skchr_rosesa_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[10,8,8,10]；初始技力：[0,0,2,4]
- 技力满立即治疗攻击范围内生命比例最低的1名友方，治疗量为攻击力倍数。
- 效果1：立即治疗1名生命比例最低友方，治疗量为攻击力165%/190%/215%/240%。
  - trigger=自然技力满；target=攻击范围内友方；action=heal；lifecycle=instant
  - values={"healScale":[1.65,1.9,2.15,2.4]}；stacking=每次结算一次；limits=每场战斗不限次数

### 原生天赋计划
- 最好的草药医生（`/char_4163_rosesa/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 自身攻击-5%保留，范围内友方受到治疗效果由常驻改为治疗触发的限时加成。
  - scope=被治疗友方；parameters={"selfAtk":-0.05,"healAmp":[0.1,0.12,0.15,0.18],"duration":8}

### 进击被动
- 被动0：每次治疗后使目标8秒内受到的治疗量+10%/12%/15%/18%，同名刷新取较强值。
  - trigger=自身完成治疗；target=被治疗目标；action=applyStatus；lifecycle=battle
  - values={"healAmp":[0.1,0.12,0.15,0.18],"duration":[8,8,8,8]}；stacking=同名取较强不叠加；limits=每次治疗施加一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：单目标治疗165%，技力10。
  - 被动：基准：治疗后受疗+10%持续8秒。
- ★2（攻×1.55、生命×1.65）：单目标治疗190%，技力8。
  - 被动：治疗后受疗+12%持续8秒。
- ★3（攻×2.2、生命×2.6）：单目标治疗215%，技力8，初始2。
  - 被动：治疗后受疗+15%持续8秒。
- ★4（攻×3、生命×4）：单目标治疗240%，技力10，初始4，可充能2次。
  - 被动：治疗后受疗+18%持续8秒，受疗加成目标同时获得每秒回攻击力10%的缓回。

### 模组
- 默认模组：uniequip_002_rosesa
- `uniequip_001_rosesa`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_rosesa`（ADVANCED/rewrite）：三星解锁：受疗加成持续时间+4秒，且自身攻击-5%的惩罚改为-3%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4163_rosesa`
实现：复用医疗KIT；技能瞬时heal，治疗事件广播给受疗加成applyStatus，自身攻击惩罚作为常驻属性修正写入门票。
因果检查：
- 一次治疗只施加一层受疗加成；重复治疗刷新时长，加成数值不累加。
- 攻击-5%只影响自身输出，不影响治疗量基数与治疗事件计数。

## 德克萨斯（`char_102_texas`）
- 职业：PIONEER；档位：4（6 金币）；路线：`economyGrowth`
- 定位：回费与控场兼修先锋，靠剑雨开局抢费与群体晕眩。
- 档位理由：回费加群体控制，开局价值高，定六金币档。
- 设计理由：剑雨做成即时回费加范围法术双段与晕眩，战术快递转为开局费用被动。

### 固定技能：剑雨（进击）
- 来源技能：`skchr_texas_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[40,34,38,42]；初始技力：[26,26,30,30]
- 技力满立即结算：获得部署费用，并对周围所有敌人造成两次法术伤害与晕眩。
- 效果1：立即获得8/10/11/12点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[8,10,11,12]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：造成两次攻击力135%/155%/180%/200%的法术伤害，并使命中目标晕眩2/2/3/3秒。
  - trigger=同一结算；target=周围所有敌人；action=damage；lifecycle=instant
  - values={"hits":[2,2,2,2],"atkScale":[1.35,1.55,1.8,2],"stun":[2,2,3,3]}；stacking=每次结算每目标两段判定，重复晕眩按成功施加计数；limits=无额外次数限制

### 原生天赋计划
- 战术快递（`/char_102_texas/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留编入队伍后额外获得初始部署费用，作用于开局经济。
  - scope=全队开局；parameters={"initCost":[1,1,2,2]}

### 进击被动
- 被动0：本场战斗开始时额外获得1/1/2/2点初始部署费用；编入即生效，重生不重复发放。
  - trigger=战斗开始；target=全队；action=economy；lifecycle=run
  - values={"initCost":[1,1,2,2]}；stacking=每场战斗一次；limits=每场战斗一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：回费8、双段135%法伤、晕眩2秒，技力40，初始26。
  - 被动：基准：开局初始费用+1。
- ★2（攻×1.55、生命×1.65）：回费10、双段155%、晕眩2秒，技力34，初始26。
  - 被动：开局初始费用+1。
- ★3（攻×2.2、生命×2.6）：回费11、双段180%、晕眩3秒，技力38，初始30。
  - 被动：开局初始费用+2。
- ★4（攻×3、生命×4）：回费12、双段200%、晕眩3秒，技力42，初始30。
  - 被动：开局初始费用+2，且首次剑雨结算返还一半技力。

### 模组
- 默认模组：uniequip_002_texas
- `uniequip_001_texas`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_texas`（ADVANCED/rewrite）：三星解锁：固定技能回费额外+2，且晕眩目标被击倒时额外获得1点费用，每场最多3次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_102_texas`
实现：复用先锋回费与控场KIT；技能瞬时economy+多段damage+stun，开局费用被动走run生命周期。
因果检查：
- 剑雨对同一目标只结算两段伤害与一次晕眩状态；免疫晕眩时不计施加次数。
- 开局初始费用每场只发一次；重生/再部署不重复触发run被动。

## 贾维（`char_349_chiave`）
- 职业：PIONEER；档位：3（4 金币）；路线：`summon`
- 定位：召唤装置的先锋，靠具名机械爪强化自身并辅助全场。
- 档位理由：原生支援机械协同与燃烧法术，功能中档，定四金币档。
- 设计理由：火焰剥离做成即时回费与法伤减抗，技工专长改为召唤具名装置并按其数量增益。

### 固定技能：火焰剥离（进击）
- 来源技能：`skchr_chiave_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[45,40,40,45]；初始技力：[31,31,35,35]
- 技力满立即结算：获得部署费用，对周围敌人造成法术伤害并降低其法抗。
- 效果1：立即获得7/8/9/10点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[7,8,9,10]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：造成攻击力280%/300%/320%/350%法术伤害，并使目标7/7/8/8秒内法抗-10%/12%/15%/20%。
  - trigger=同一结算；target=周围所有敌人；action=damage；lifecycle=instant
  - values={"atkScale":[2.8,3,3.2,3.5],"resDown":[-0.1,-0.12,-0.15,-0.2],"duration":[7,7,8,8]}；stacking=法抗减益同名取较强；limits=无额外次数限制

### 原生天赋计划
- 技工专长（`/char_349_chiave/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 由支援机械协同改为召唤具名装置，并按装置数量提升自身攻防。
  - scope=自身；parameters={"atkPerDevice":[0.07,0.09,0.11,0.13],"defPerDevice":[0.07,0.09,0.11,0.13],"maxDevices":2}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：部署时在身前一格召唤具名装置「贾维机械爪」，持续30/35/40/45秒；装置为近战阻挡1，攻击造成物理伤害。
  - trigger=部署时；target=自身；action=summon；lifecycle=battle
  - values={"deviceId":"chiave_mech_claw","count":[1,1,1,1],"duration":[30,35,40,45]}；stacking=同名装置最多同时存在2个；limits=每场战斗限1次召唤，可被更强装置替换

### 星级
- ★1（攻×1、生命×1）：基准：回费7、280%法术、法抗-10%持续7秒，技力45，初始31。
  - 被动：基准：装置1个，每装置攻防+7%。
- ★2（攻×1.55、生命×1.65）：回费8、300%、法抗-12%持续7秒，技力40，初始31。
  - 被动：每装置攻防+9%。
- ★3（攻×2.2、生命×2.6）：回费9、320%、法抗-15%持续8秒，技力40，初始35。
  - 被动：每装置攻防+11%，装置持续时间+5秒。
- ★4（攻×3、生命×4）：回费10、350%、法抗-20%持续8秒，技力45，初始35。
  - 被动：每装置攻防+13%，装置上限2个，机械爪攻击附带0.5秒停顿。

### 模组
- 默认模组：uniequip_002_chiave
- `uniequip_001_chiave`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_chiave`（ADVANCED/rewrite）：三星解锁：贾维机械爪生命与攻击提升20%，退场时对周围敌人造成贾维攻击力100%的法术伤害。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_349_chiave`
实现：新增具名装置chiave_mech_claw资源与AI；固定技能瞬时economy+damage+resDown，装置按原生device primitive实现阻挡与攻击。
因果检查：
- 装置按每场召唤一次计数；装置到期或被击破后自身攻防增益随之减少，不残留。
- 法抗减益重复施加取较强；对同一目标同一次结算只施加一次。

## 野鬃（`char_496_wildmn`）
- 职业：PIONEER；档位：3（4 金币）；路线：`economyGrowth`
- 定位：冲锋型击杀回费先锋，靠推动与减费支援近卫铺场。
- 档位理由：击杀回费加推击与减费，节奏型支点，定四金币档。
- 设计理由：夹枪冲锋做成即时推击与伤害，一致向前转为击倒触发的部署费用减免。

### 固定技能：夹枪冲锋（进击）
- 来源技能：`skchr_wildmn_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[40,32,36,40]；初始技力：[25,25,30,30]
- 技力满立即对前方直线敌人造成物理伤害，并中等力度将其向攻击方向推开。
- 效果1：对前方至多3/3/4/4名敌人造成攻击力200%/240%/280%/320%的物理伤害。
  - trigger=自然技力满；target=前方直线敌人；action=damage；lifecycle=instant
  - values={"atkScale":[2,2.4,2.8,3.2],"maxTargets":[3,3,4,4]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：将命中目标沿攻击方向中等力度推开1格（四星为较大力度推2格）。
  - trigger=同一结算；target=被命中敌人；action=move；lifecycle=instant
  - values={"forceLevel":[1,1,1,2],"distance":[1,1,1,2]}；stacking=每目标一次；limits=无法推动的重量级目标不位移但仍结算伤害

### 原生天赋计划
- 一致向前（`/char_496_wildmn/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由部署后全体未部署近卫减费改为击倒触发的部署费用减免，明确每场次数上限。
  - scope=自身后续部署费用；parameters={"costReduce":[1,1,1,2],"maxPerBattle":5}

### 进击被动
- 被动0：每击倒一名敌人，当前战斗部署费用-1（四星-2）；每场最多触发5次，击杀回费与减费分开记账。
  - trigger=击倒敌人；target=自身经济；action=economy；lifecycle=run
  - values={"costReduce":[1,1,1,2],"maxPerBattle":[5,5,5,5]}；stacking=每次击倒各计一次，最多5次；limits=每场战斗上限5次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：直线200%上限3，推开1格，技力40，初始25。
  - 被动：基准：击倒减费1，上限5次。
- ★2（攻×1.55、生命×1.65）：直线240%上限3，推开1格，技力32，初始25。
  - 被动：击倒减费1，上限5次。
- ★3（攻×2.2、生命×2.6）：直线280%上限4，推开1格，技力36，初始30。
  - 被动：击倒减费1，上限5次，减费同时回复1点技力。
- ★4（攻×3、生命×4）：直线320%上限4，较大力度推2格，技力40，初始30。
  - 被动：击倒减费2，上限5次，减费同时回复1点技力。

### 模组
- 默认模组：uniequip_002_wildmn
- `uniequip_001_wildmn`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_wildmn`（ADVANCED/rewrite）：三星解锁：推击距离+1格，被推入障碍的目标额外受到野鬃攻击力100%的伤害，每目标一次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_496_wildmn`
实现：复用冲锋手击杀回费KIT；固定技能瞬时damage+move（force primitive），减费走run生命周期账目。
因果检查：
- 推击对不可位移目标只结算伤害；重量级判定失败不消耗推动次数。
- 击倒减费每场最多5次；击杀回费与减费是两笔独立账，不互相抵扣。

## 极境（`char_401_elysm`）
- 职业：PIONEER；档位：4（6 金币）；路线：`economyGrowth`
- 定位：大额回费旗手兼狙击支援，靠聆听削弱敌人。
- 档位理由：回费与狙击体系支援耦合强，定六金币档。
- 设计理由：聆听做成即时回费加群体锁敌减益，狙击支援改为技能触发的限时狙击增益。

### 固定技能：聆听（进击）
- 来源技能：`skchr_elysm_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[34,30,30,34]；初始技力：[10,10,16,16]
- 技力满立即结算：获得部署费用，锁定周围至多4名敌人使其减速、减防并失去隐匿。
- 效果1：立即获得12/14/16/18点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[12,14,16,18]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：锁定至多4/4/4/5名敌人，10/12/15/15秒内移速-60%/60%/60%/70%、防御-25%/30%/35%/40%，并使隐匿失效。
  - trigger=同一结算；target=周围至多4名敌人；action=applyStatus；lifecycle=battle
  - values={"maxTargets":[4,4,4,5],"slow":[0.6,0.6,0.6,0.7],"defDown":[0.25,0.3,0.35,0.4],"reveal":[1,1,1,1],"duration":[10,12,15,15]}；stacking=同名减益取较强；重复锁定的新目标追加，旧目标刷新；limits=每目标一次

### 原生天赋计划
- 狙击支援（`/char_401_elysm/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由常驻狙击减费改为技能触发的限时狙击攻速增益，减费部分并入固定技能经济。
  - scope=全体狙击干员；parameters={"attackSpeed":[10,15,20,25],"duration":8}

### 进击被动
- 被动0：结算后8秒内全体狙击干员攻速+10/15/20/25；同名刷新取较强值。
  - trigger=自身固定技能结算；target=全体狙击干员；action=addBuff；lifecycle=battle
  - values={"attackSpeed":[10,15,20,25],"duration":[8,8,8,8]}；stacking=同名取较强不叠加；limits=每次技能结算施加一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：回费12、锁4敌减速60%减防25%持续10秒，技力34，初始10。
  - 被动：基准：结算后8秒狙击攻速+10。
- ★2（攻×1.55、生命×1.65）：回费14、锁4敌减速60%减防30%持续12秒，技力30，初始10。
  - 被动：结算后8秒狙击攻速+15。
- ★3（攻×2.2、生命×2.6）：回费16、锁4敌减速60%减防35%持续15秒，技力30，初始16。
  - 被动：结算后8秒狙击攻速+20。
- ★4（攻×3、生命×4）：回费18、锁5敌减速70%减防40%持续15秒，技力34，初始16。
  - 被动：结算后8秒狙击攻速+25，被锁敌被击倒时额外回1费。

### 模组
- 默认模组：uniequip_002_elysm
- `uniequip_001_elysm`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_elysm`（ADVANCED/rewrite）：三星解锁：被锁定敌人的隐匿失败期间受到伤害+10%，且极境对其攻击额外回0.2费（每目标每次战斗一次）。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_401_elysm`
实现：复用旗手回费与锁敌KIT；技能瞬时economy+多目标applyStatus（减速/减防/隐匿失效），狙击增益为限时buff。
因果检查：
- 锁定目标数按上限截断，超出不结算；同一目标重复锁定只刷新时间不叠强。
- 隐匿失效对已显形目标无额外效果但仍计一次成功施加。

## 万顷（`char_4119_wanqin`）
- 职业：PIONEER；档位：4（6 金币）；路线：`economyGrowth`
- 定位：回费旗手，靠方向协同为周围友方提供攻速与生命增益。
- 档位理由：回费加方向协同增益，站位价值高，定六金币档。
- 设计理由：应东风做成即时回费加周围治疗与同向攻速，看天时改为技能触发的方向限时增益。

### 固定技能：应东风（进击）
- 来源技能：`skchr_wanqin_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[34,30,30,34]；初始技力：[10,10,16,16]
- 技力满立即结算：获得部署费用，治疗周围友方并使部署方向相同的友方短时攻速提升。
- 效果1：立即获得12/14/16/18点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[12,14,16,18]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：治疗周围友方相当于万顷攻击力20%/22%/25%/30%的生命。
  - trigger=同一结算；target=周围友方；action=heal；lifecycle=instant
  - values={"healScale":[0.2,0.22,0.25,0.3]}；stacking=每目标一次；limits=无额外次数限制
- 效果3：同向友方攻速+20/22/25/30，持续8/9/10/10秒；同名刷新取较强值。
  - trigger=同一结算；target=部署方向相同的周围友方；action=addBuff；lifecycle=battle
  - values={"attackSpeed":[20,22,25,30],"duration":[8,9,10,10]}；stacking=同名取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 看天时（`/char_4119_wanqin/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 周围8格最大生命加成由常驻改为技能触发的限时增益，同向更高。
  - scope=周围8格干员；parameters={"maxHp":[0.03,0.04,0.05,0.06],"maxHpSameDir":[0.05,0.07,0.09,0.11],"duration":10}

### 进击被动
- 被动0：结算后10秒内周围8格干员最大生命+3%/4%/5%/6%，同向为+5%/7%/9%/11%；同名取较强值。
  - trigger=自身固定技能结算；target=周围8格干员；action=addBuff；lifecycle=battle
  - values={"maxHp":[0.03,0.04,0.05,0.06],"maxHpSameDir":[0.05,0.07,0.09,0.11],"duration":[10,10,10,10]}；stacking=同名取较强不叠加；limits=每次技能结算施加一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：回费12、周围治疗20%、同向攻速+20持续8秒，技力34，初始10。
  - 被动：基准：周围最大生命+3%，同向+5%，持续10秒。
- ★2（攻×1.55、生命×1.65）：回费14、治疗22%、同向攻速+22持续9秒，技力30，初始10。
  - 被动：周围最大生命+4%，同向+7%。
- ★3（攻×2.2、生命×2.6）：回费16、治疗25%、同向攻速+25持续10秒，技力30，初始16。
  - 被动：周围最大生命+5%，同向+9%。
- ★4（攻×3、生命×4）：回费18、治疗30%、同向攻速+30持续10秒，技力34，初始16。
  - 被动：周围最大生命+6%，同向+11%；同向友方额外获得5%减伤。

### 模组
- 默认模组：uniequip_002_wanqin
- `uniequip_001_wanqin`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_wanqin`（ADVANCED/rewrite）：三星解锁：同向判定范围扩大到周围12格，且同向友方阵亡时立即返还1点部署费用，每场最多3次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4119_wanqin`
实现：复用旗手回费KIT；技能瞬时economy+heal+方向条件attackSpeed buff，方向判定用部署朝向标签。
因果检查：
- 方向相同判定基于部署朝向而非相对位置；同向buff同名取较强。
- 回费与治疗是同一结算的独立效果，治疗不因回费数值变化而重复触发。

## 晓歌（`char_497_ctable`）
- 职业：PIONEER；档位：4（6 金币）；路线：`ammo`
- 定位：低成本快速再部署先锋，靠弹药装填补费与远程输出。
- 档位理由：再部署费用低、弹药回费与迷彩保命，功能复合，定六金币档。
- 设计理由：浮光做成即时装填具名弹药与迷彩，万全保留为阻挡/未阻挡的条件增益。

### 固定技能：浮光（进击）
- 来源技能：`skchr_ctable_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[28,25,25,28]；初始技力：[20,20,24,24]
- 技力满立即结算：装填具名弹药并进入迷彩，期间攻击力提升，每次攻击额外获得部署费用。
- 效果1：装填12/15/18/22发弹药，期间攻击力+28%/32%/36%/40%、攻速+34/40/45/50并获得迷彩；弹药打空后状态结束。
  - trigger=自然技力满；target=自身；action=ammo；lifecycle=battle
  - values={"rounds":[12,15,18,22],"atk":[0.28,0.32,0.36,0.4],"attackSpeed":[34,40,45,50],"stealth":[1,1,1,1]}；stacking=同一次只装填一匣，重复施放按剩余弹药取较多；limits=弹药数即次数上限
- 效果2：每次消耗弹药攻击命中获得1点部署费用。
  - trigger=弹药期间每次攻击命中；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[1,1,1,1]}；stacking=每发弹药一次；limits=受弹药数上限约束

### 原生天赋计划
- 万全（`/char_497_ctable/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留未阻挡加攻速、阻挡加攻击力的条件增益。
  - scope=自身；parameters={"attackSpeed":[6,9,12,15],"atk":[0.06,0.09,0.12,0.15]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：每发弹药命中回1点部署费用；同一发弹药命中多名目标仍只回1点。
  - trigger=每次消耗弹药攻击命中；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[1,1,1,1]}；stacking=每发一次；limits=按弹药数结算

### 星级
- ★1（攻×1、生命×1）：基准：装填12发、攻击+28%、攻速+34、迷彩，技力28，初始20。
  - 被动：基准：未阻挡攻速+6，阻挡攻击+6%。
- ★2（攻×1.55、生命×1.65）：装填15发、攻击+32%、攻速+40、迷彩，技力25，初始20。
  - 被动：未阻挡攻速+9，阻挡攻击+9%。
- ★3（攻×2.2、生命×2.6）：装填18发、攻击+36%、攻速+45、迷彩，技力25，初始24。
  - 被动：未阻挡攻速+12，阻挡攻击+12%。
- ★4（攻×3、生命×4）：装填22发、攻击+40%、攻速+50、迷彩，技力28，初始24。
  - 被动：未阻挡攻速+15，阻挡攻击+15%，弹药打空时立即返还8点技力。

### 模组
- 默认模组：uniequip_002_ctable
- `uniequip_001_ctable`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_ctable`（ADVANCED/rewrite）：三星解锁：迷彩期间首次受到的伤害免疫并解除迷彩，装填期间再部署时间-30%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_497_ctable`
实现：复用情报官再部署KIT与弹药primitive；固定技能装填具名弹匣、施加迷彩与攻速攻击buff，命中回费挂弹药消耗事件。
因果检查：
- 每次弹药消耗只回一次费用，多目标溅射不重复计数。
- 重复施放不叠加弹匣，按剩余弹药取较多；弹药打空后所有相关buff同时结束。

## 谜图（`char_4017_puzzle`）
- 职业：PIONEER；档位：3（4 金币）；路线：`skillCycle`
- 定位：情报官型持续伤害先锋，靠叠层标记与满血加成回费。
- 档位理由：叠层持续伤害与满血回技力，功能独特，定四金币档。
- 设计理由：疑点追踪做成即时的可叠层标记，序列改为攻击满血敌人的触发增益。

### 固定技能：疑点追踪（进击）
- 来源技能：`skchr_puzzle_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[28,26,26,29]；初始技力：[12,14,16,16]
- 技力满立即对至多2名敌人施加可叠层的持续法术伤害标记，并获得部署费用。
- 效果1：对至多1/2/2/2名敌人施加16秒标记，每秒受到谜图攻击力12%/13%/15%/16%的法术伤害，最多叠10层，重复施加成功即叠层。
  - trigger=自然技力满；target=至多2名敌人；action=applyStatus；lifecycle=battle
  - values={"dotScale":[0.12,0.13,0.15,0.16],"maxStacks":[10,10,10,10],"duration":[16,16,16,16],"maxTargets":[1,2,2,2]}；stacking=同目标最多10层，超过不再增加但仍计施加次数；limits=每场战斗不限次数
- 效果2：立即获得2/2/3/3点部署费用。
  - trigger=同一结算；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[2,2,3,3]}；stacking=单次结算一次；limits=每场战斗不限次数

### 原生天赋计划
- 序列（`/char_4017_puzzle/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由普攻满血加成改为命中满血敌人时的强化与额外回技力，触发式保留。
  - scope=满血被命中敌人；parameters={"atkScale":[1.1,1.15,1.2,1.25],"spGain":[1,1,2,2]}

### 进击被动
- 被动0：命中满血敌人时该次攻击提升至110%/115%/120%/125%并额外回复1/1/2/2点技力。
  - trigger=命中生命值满的敌人；target=自身；action=spGain；lifecycle=instant
  - values={"spGain":[1,1,2,2],"atkScale":[1.1,1.15,1.2,1.25]}；stacking=每次命中只触发一次；limits=无额外次数限制；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：单目标标记12%/秒叠10层持续16秒，回费2，技力28，初始12。
  - 被动：基准：满血命中×1.1并回1技力。
- ★2（攻×1.55、生命×1.65）：双目标标记13%/秒，回费2，技力26，初始14。
  - 被动：满血命中×1.15并回1技力。
- ★3（攻×2.2、生命×2.6）：双目标标记15%/秒，回费3，技力26，初始16。
  - 被动：满血命中×1.2并回2技力。
- ★4（攻×3、生命×4）：双目标标记16%/秒，回费3，技力29，初始16。
  - 被动：满血命中×1.25并回2技力；标记层数上限提升至12。

### 模组
- 默认模组：uniequip_002_puzzle
- `uniequip_001_puzzle`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_puzzle`（ADVANCED/rewrite）：三星解锁：标记每层额外使目标防御-1%，最多-10%；标记击杀目标时回2费，每场最多5次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4017_puzzle`
实现：复用情报官远程KIT；标记为具名dot status，叠层计数走状态施加成功事件；满血判定在伤害前读取目标生命比例。
因果检查：
- 标记重复施加成功即叠层，达到上限后仍计施加次数但不增加层数。
- 满血判定在伤害结算前采样；同一攻击命中多个满血目标各自独立触发回技力。

## 赫默（`char_108_silent`）
- 职业：MEDIC；档位：4（6 金币）；路线：`summon`
- 定位：召唤医疗无人机的医师，靠装置提供额外治疗覆盖。
- 档位理由：原生召唤无人机是独特治疗支点，定六金币档。
- 设计理由：医疗无人机做成即时召唤具名装置，强化注射改为技能触发的限时医疗攻速增益。

### 固定技能：医疗无人机（进击）
- 来源技能：`skchr_silent_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[22,18,18,22]；初始技力：[0,0,5,5]
- 技力满立即在身前一格召唤具名「医疗无人机」，持续治疗周围友方后自动销毁。
- 效果1：召唤「医疗无人机」，持续10/12/14/16秒，每秒治疗周围友方相当于赫默攻击力60%/75%/90%/100%的生命。
  - trigger=自然技力满；target=身前一格；action=summon；lifecycle=battle
  - values={"deviceId":"silent_medic_drone","duration":[10,12,14,16],"healScale":[0.6,0.75,0.9,1]}；stacking=同名无人机最多同时存在1个，重复召唤刷新并替换；limits=每场战斗不限次数，但同名装置唯一

### 原生天赋计划
- 强化注射（`/char_108_silent/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由常驻医疗攻速改为技能触发后的限时医疗干员攻速增益。
  - scope=全体医疗干员；parameters={"attackSpeed":[6,9,12,15],"duration":8}

### 进击被动
- 被动0：召唤无人机后8秒内全体医疗干员攻速+6/9/12/15；同名刷新取较强值。
  - trigger=自身固定技能召唤无人机；target=全体医疗干员；action=addBuff；lifecycle=battle
  - values={"attackSpeed":[6,9,12,15],"duration":[8,8,8,8]}；stacking=同名取较强不叠加；limits=每次召唤施加一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：无人机持续10秒、治疗60%，技力22。
  - 被动：基准：召唤后8秒医疗攻速+6。
- ★2（攻×1.55、生命×1.65）：无人机持续12秒、治疗75%，技力18。
  - 被动：召唤后8秒医疗攻速+9。
- ★3（攻×2.2、生命×2.6）：无人机持续14秒、治疗90%，技力18，初始5。
  - 被动：召唤后8秒医疗攻速+12。
- ★4（攻×3、生命×4）：无人机持续16秒、治疗100%，技力22，初始5。
  - 被动：召唤后8秒医疗攻速+15，无人机所在格友方额外获得10%治疗加成。

### 模组
- 默认模组：uniequip_002_silent
- `uniequip_001_silent`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_silent`（ADVANCED/rewrite）：三星解锁：无人机治疗范围+1格，销毁时对周围敌人造成赫默攻击力120%的法术伤害，每架一次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_108_silent`
实现：新增具名装置silent_medic_drone资源与持续治疗AI；固定技能瞬时summon，医疗攻速为限时buff。
因果检查：
- 无人机唯一：重复召唤替换旧机并重置持续时间，不并存两架。
- 无人机到期或替换后治疗立即停止；医疗攻速buff独立计时，不受无人机销毁影响。

## 华法琳（`char_171_bldsk`）
- 职业：MEDIC；档位：4（6 金币）；路线：`skillCycle`
- 定位：以命换攻的增伤医师，靠血流回收与血浆爆发支援输出。
- 档位理由：高幅攻击加成但伴随生命流失，风险收益型，定六金币档。
- 设计理由：不稳定血浆做成即时攻速攻击加成与生命流失，血液样本回收改为击倒触发的回技力。

### 固定技能：不稳定血浆（进击）
- 来源技能：`skchr_bldsk_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[60,50,55,60]；初始技力：[45,45,50,50]
- 技力满立即结算：自身与范围内随机1名友方攻击力大幅提升，但每秒流失最大生命，持续15秒。
- 效果1：目标攻击力+60%/70%/90%/100%，持续15秒；同名刷新取较强值。
  - trigger=自然技力满；target=自身与范围内随机1名友方；action=addBuff；lifecycle=battle
  - values={"atk":[0.6,0.7,0.9,1],"duration":[15,15,15,15]}；stacking=同名取较强不叠加；limits=每场战斗不限次数
- 效果2：被增益单位每秒流失最大生命3%/3%/3%/4%，持续15秒；该流失不被减伤或护盾抵消。
  - trigger=同一结算；target=被增益单位；action=applyStatus；lifecycle=battle
  - values={"hpDrainPerSec":[0.03,0.03,0.03,0.04],"duration":[15,15,15,15]}；stacking=同名刷新不叠加损失速率；limits=每秒结算一次

### 原生天赋计划
- 血液样本回收（`/char_171_bldsk/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 攻击范围内敌人倒下时，为自身和范围内随机1名友方回技力，触发式保留。
  - scope=自身与攻击范围内随机友方；parameters={"spGain":[1,1,2,2]}

### 进击被动
- 被动0：范围内每有一个敌人被击倒，为自身和范围内随机1名友方各回复1/1/2/2点技力；同一敌人只计一次。
  - trigger=攻击范围内敌人被击倒；target=自身与攻击范围内随机1名友方；action=spGain；lifecycle=instant
  - values={"spGain":[1,1,2,2]}；stacking=每击倒事件一次；limits=无额外次数限制；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：双方攻击+60%持续15秒，流失3%/秒，技力60，初始45。
  - 被动：基准：范围内击倒回1技力。
- ★2（攻×1.55、生命×1.65）：攻击+70%持续15秒，流失3%/秒，技力50，初始45。
  - 被动：范围内击倒回1技力。
- ★3（攻×2.2、生命×2.6）：攻击+90%持续15秒，流失3%/秒，技力55，初始50。
  - 被动：范围内击倒回2技力。
- ★4（攻×3、生命×4）：攻击+100%持续15秒，流失4%/秒，技力60，初始50。
  - 被动：范围内击倒回2技力，且被增益目标的流失会按50%转化为对随机敌人的法术伤害。

### 模组
- 默认模组：uniequip_002_bldsk
- `uniequip_001_bldsk`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_bldsk`（ADVANCED/rewrite）：三星解锁：被增益目标攻击加成额外+10%，且若其在技能期间被击倒，立即为华法琳回复20点技力，每场最多2次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_171_bldsk`
实现：复用医疗KIT；固定技能为随机友方addBuff与自身hpDrain状态，击倒事件驱动spGain，生命流失绕过护盾。
因果检查：
- 攻击加成与生命流失同链绑定，超时同时结束；重复施放刷新时长与数值取较强。
- 击倒回技力按事件计数，同一敌人多次被击倒只按最终击倒一次。

## 录武官（`char_4196_reckpr`）
- 职业：MEDIC；档位：3（4 金币）；路线：`skillCycle`
- 定位：群疗医师，靠友方开技能回技力形成技能循环。
- 档位理由：友方技能联动回技力，循环型支点，定四金币档。
- 设计理由：触类旁通做成即时双目标治疗，学成于聚改为友方开技能的触发回技力与攻速。

### 固定技能：触类旁通（进击）
- 来源技能：`skchr_reckpr_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[8,7,7,8]；初始技力：0
- 技力满立即治疗1名友方，并额外治疗1名目标，治疗量为攻击力倍数。
- 效果1：立即治疗至多2/2/2/3名友方，治疗量为攻击力130%/145%/155%/170%。
  - trigger=自然技力满；target=攻击范围内友方；action=heal；lifecycle=instant
  - values={"healScale":[1.3,1.45,1.55,1.7],"targets":[2,2,2,3]}；stacking=每目标一次；limits=每场战斗不限次数

### 原生天赋计划
- 学成于聚（`/char_4196_reckpr/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 攻击范围内干员开启技能时自身回技力并短时攻速提升，触发式保留并延长时限。
  - scope=自身；parameters={"spGain":[1,1,1,2],"attackSpeed":[8,12,16,20],"duration":8}

### 进击被动
- 被动0：范围内每有一名友方开启技能，自身回复1/1/1/2点技力，并8秒内攻速+8/12/16/20；同名攻速刷新取较强。
  - trigger=攻击范围内友方开启技能；target=自身；action=spGain；lifecycle=battle
  - values={"spGain":[1,1,1,2],"attackSpeed":[8,12,16,20],"duration":[8,8,8,8]}；stacking=每次开技能事件各计一次，攻速同名不叠加；limits=无额外次数限制；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：治疗130%双目标，技力8，充能3次。
  - 被动：基准：友方开技能回1技力，攻速+8持续8秒。
- ★2（攻×1.55、生命×1.65）：治疗145%双目标，技力7，充能3次。
  - 被动：友方开技能回1技力，攻速+12。
- ★3（攻×2.2、生命×2.6）：治疗155%双目标，技力7，充能3次。
  - 被动：友方开技能回1技力，攻速+16。
- ★4（攻×3、生命×4）：治疗170%三目标，技力8，充能4次。
  - 被动：友方开技能回2技力，攻速+20；攻速加成期间自身治疗量+10%。

### 模组
- 默认模组：uniequip_002_reckpr
- `uniequip_001_reckpr`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_reckpr`（ADVANCED/rewrite）：三星解锁：友方开技能回技力额外+1，且攻速加成可叠加至2层，每层独立计时。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4196_reckpr`
实现：复用医疗KIT；技能瞬时多目标heal，友方技能开启事件走全局技能事件总线触发回技力与攻速。
因果检查：
- 同一次技能开启只触发一次回技力；多名友方同时开技能按事件数分别结算。
- 攻速加成同名默认不叠加；模组改写后每层独立计时，上限2层。

## 哈洛德（`char_4114_harold`）
- 职业：MEDIC；档位：4（6 金币）；路线：`element`
- 定位：元素损伤医师，靠优先治疗高损伤目标稳住元素条。
- 档位理由：原生元素损伤回复是独有支点，定六金币档。
- 设计理由：重症优先做成即时元素治疗与短时攻速，我即军营改为高损伤目标的元素减伤。

### 固定技能：重症优先（进击）
- 来源技能：`skchr_harold_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[35,30,30,35]；初始技力：[15,15,18,18]
- 技力满立即治疗攻击范围内元素损伤最严重的友方，并短时提升其元素损伤回复与攻速。
- 效果1：治疗目标攻击力160%/180%/200%/230%的生命，并回复攻击力75%/90%/105%/125%的元素损伤。
  - trigger=自然技力满；target=元素损伤最严重友方；action=heal；lifecycle=instant
  - values={"healScale":[1.6,1.8,2,2.3],"epHealScale":[0.75,0.9,1.05,1.25]}；stacking=每次结算一次；limits=每场战斗不限次数
- 效果2：自身攻速+80/90/100/110，持续8/9/10/10秒。
  - trigger=同一结算；target=自身；action=addBuff；lifecycle=battle
  - values={"attackSpeed":[80,90,100,110],"duration":[8,9,10,10]}；stacking=同名取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 我即军营（`/char_4114_harold/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 统一 epResistance 为元素槽积累减免（不是HP元素伤害）：攻击范围内任意友方某个元素槽累计超过该槽阈值50%时，给予该友方12%/13%/15%/18%元素槽积累减免；离开攻击范围或该槽降到阈值50%以下即取消。
  - scope=攻击范围内元素损伤过半友方；parameters={"epResistance":[0.12,0.13,0.15,0.18],"reductionTarget":"elementSlotAccumulation","thresholdRatio":0.5,"perSlot":true,"anySlot":true,"cancelOnLeaveRange":true,"cancelOnBelowThreshold":true}

### 进击被动
- 被动0：攻击范围内任意友方某个元素槽累计超过该槽阈值50%时，为该友方提供12%/13%/15%/18%元素槽积累减免；离开攻击范围或该槽降到阈值50%以下即取消。减免的是元素槽积累，不是HP元素伤害。
  - trigger=攻击范围内任意友方某元素槽累计>该槽阈值50%；target=该友方；action=addBuff；lifecycle=battle
  - values={"epResistance":[0.12,0.13,0.15,0.18],"reductionTarget":"elementSlotAccumulation","thresholdRatio":0.5,"perSlot":true,"anySlot":true,"cancelOnLeaveRange":true,"cancelOnBelowThreshold":true}；stacking=同名不叠加，按槽独立判定。；limits=状态随进入/离开范围与阈值进入/退出切换。；replacesTalentIndices=[0]
- 被动1：四星起，元素爆发只把首次即时HP伤害改为治疗其等量实际应受HP伤害（减伤结算后、以目标缺失生命为上限）；仍正常结算爆发debuff与持续伤害及其他元素独立槽；不取消整次爆发、不×5、不把满血治疗计为净治疗。
  - trigger=四星：被本被动覆盖的友方元素槽爆发时；target=该友方；action=heal；lifecycle=instant
  - values={"unlockStar":4,"onlyFirstInstantHpDamage":true,"healEqualsActualHpDamage":true,"appliesAfterMitigation":true,"capByMissingHp":true,"keepBurstDebuffAndDot":true,"cancelWholeBurst":false,"multiplyBy5":false,"countFullHpHealAsNetHeal":false,"independentSlots":true}；stacking=每次爆发首次即时HP伤害只结算一次。；limits=仅四星解锁；独立元素槽分别结算。；unlockStar=4

### 星级
- ★1（攻×1、生命×1）：基准：治疗160%、元素回复75%，自身攻速+80持续8秒，技力35，初始15。
  - 被动：基准：高损伤目标元素减伤12%。
- ★2（攻×1.55、生命×1.65）：治疗180%、元素回复90%，攻速+90持续9秒，技力30，初始15。
  - 被动：高损伤目标元素减伤13%。
- ★3（攻×2.2、生命×2.6）：治疗200%、元素回复105%，攻速+100持续10秒，技力30，初始18。
  - 被动：高损伤目标元素减伤15%。
- ★4（攻×3、生命×4）：治疗230%、元素回复125%，攻速+110持续10秒，技力35，初始18。
  - 被动：高损伤目标元素槽积累减免18%；四星元素爆发首次即时HP伤害改为等量治疗（减伤后、缺口上限），仍结算其余爆发效果。

### 模组
- 默认模组：uniequip_002_harold
- `uniequip_001_harold`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_harold`（ADVANCED/rewrite）：三星解锁：元素损伤回复提升至攻击力150%，且目标元素损伤清零时回复其最大生命5%，每目标每场一次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4114_harold`
实现：复用元素医疗KIT；技能瞬时heal+epHeal+自身攻速buff，元素减伤被动按元素条阈值进出。
因果检查：
- 元素槽减免作用于积累而非HP；离开攻击范围或槽降到阈值50%以下立即取消，同名不叠加。
- 四星爆发转换只作用于首次即时HP伤害，按减伤后实际应受伤害且以缺口为上限治疗；爆发debuff、持续伤害与其他独立元素槽照常结算，不取消整次爆发。

## 刺玫（`char_494_vendla`）
- 职业：MEDIC；档位：4（6 金币）；路线：`healShield`
- 定位：咒愈师，靠指定高血上限友方吸引火力并反击治疗。
- 档位理由：特性治疗加嘲讽反击，功能独特，定六金币档。
- 设计理由：荆藤庇荫做成即时庇护指定友方，土壤基肥改良保留为受疗加成但与触发绑定。

### 固定技能：荆藤庇荫（进击）
- 来源技能：`skchr_vendla_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[32,30,30,32]；初始技力：[12,12,15,15]
- 技力满立即指定攻击范围内生命上限最高友方：使其嘲讽并提升其攻击；该友方受击时刺玫对攻击者造成法术伤害。
- 效果1：目标更易受攻击（嘲讽+1）且攻击+75%/80%/85%/90%，持续15/16/17/18秒。
  - trigger=自然技力满；target=攻击范围内生命上限最高友方；action=applyStatus；lifecycle=battle
  - values={"tauntLevel":[1,1,1,1],"atk":[0.75,0.8,0.85,0.9],"duration":[15,16,17,18]}；stacking=同名刷新取较长剩余时间；limits=每场战斗不限次数
- 效果2：刺玫对攻击者造成自身攻击力30%/40%/50%/60%的法术伤害，并仅对该友方触发刺玫特性治疗。
  - trigger=被庇护友方受到攻击；target=攻击者；action=damage；lifecycle=instant
  - values={"atkScale":[0.3,0.4,0.5,0.6]}；stacking=每次受击一次；limits=每次受击结算一次

### 原生天赋计划
- 土壤基肥改良（`/char_494_vendla/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 攻击范围内生命上限最高友方受到治疗效果提升，保留范围与对象。
  - scope=攻击范围内生命上限最高友方；parameters={"healAmp":[0.08,0.1,0.15,0.18]}

### 进击被动
- 被动0：该友方受到的所有治疗效果+8%/10%/15%/18%；目标改变时效果随最高生命上限者转移。
  - trigger=攻击范围内生命上限最高友方受到治疗；target=该友方；action=addBuff；lifecycle=battle
  - values={"healReceived":[0.08,0.1,0.15,0.18]}；stacking=同名不叠加；limits=随目标转移，同一时间只作用一个目标；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：嘲讽+攻击+75%持续15秒，反击30%，技力32，初始12。
  - 被动：基准：最高血上限友方受疗+8%。
- ★2（攻×1.55、生命×1.65）：攻击+80%持续16秒，反击40%，技力30，初始12。
  - 被动：最高血上限友方受疗+10%。
- ★3（攻×2.2、生命×2.6）：攻击+85%持续17秒，反击50%，技力30，初始15。
  - 被动：最高血上限友方受疗+15%。
- ★4（攻×3、生命×4）：攻击+90%持续18秒，反击60%，技力32，初始15。
  - 被动：最高血上限友方受疗+18%，其受击反击附带0.5秒停顿。

### 模组
- 默认模组：uniequip_002_vendla
- `uniequip_001_vendla`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_vendla`（ADVANCED/rewrite）：三星解锁：反击伤害提升至攻击力80%，且反击命中后刺玫回复相当于伤害20%的生命。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_494_vendla`
实现：复用咒愈师KIT；技能为指定友方施加taunt+atk状态，受击事件驱动刺玫反击damage与特性治疗。
因果检查：
- 被庇护友方一次受击只触发一次反击；多段攻击各自独立计数。
- 受疗加成跟随最高生命上限目标转移；旧目标失去加成，不叠加。

## 莎草（`char_4139_papyrs`）
- 职业：MEDIC；档位：4（6 金币）；路线：`healShield`
- 定位：链愈师，靠治疗跳跃与屏障保护多人。
- 档位理由：链式治疗加屏障，群体保护强，定六金币档。
- 设计理由：临考发挥做成即时链式治疗与屏障，博览古卷保留为治疗附带屏障。

### 固定技能：临考发挥（进击）
- 来源技能：`skchr_papyrs_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[34,30,30,34]；初始技力：[15,15,18,18]
- 技力满立即锁定攻击范围内除自身外生命上限最高友方为主目标，治疗并附加屏障，跳跃次数+1。
- 效果1：以最高生命上限友方为主目标治疗攻击力175%/190%/200%/220%，并在至多3/3/4/4个友方间跳跃，每次跳跃治疗量-25%。
  - trigger=自然技力满；target=生命上限最高友方及跳跃目标；action=heal；lifecycle=instant
  - values={"healScale":[1.75,1.9,2,2.2],"chainJumps":[3,3,4,4]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：每个被治疗目标获得相当于莎草攻击力20%/25%/30%/35%的屏障，持续8/8/8/10秒；同名刷新取较强值。
  - trigger=同一结算每次治疗；target=被治疗目标；action=addBuff；lifecycle=battle
  - values={"barrierScale":[0.2,0.25,0.3,0.35],"duration":[8,8,8,10]}；stacking=同名取较强不叠加；limits=每次治疗施加一次

### 原生天赋计划
- 博览古卷（`/char_4139_papyrs/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 治疗为目标附加攻击力比例屏障，保留并随技能档位提升。
  - scope=被治疗目标；parameters={"barrierScale":[0.05,0.1,0.2,0.28],"duration":8}

### 进击被动
- 被动0：每次治疗为目标附加相当于莎草攻击力5%/10%/20%/28%的屏障，持续8秒；同名取较强不叠加。
  - trigger=自身完成一次治疗；target=被治疗目标；action=addBuff；lifecycle=battle
  - values={"barrierScale":[0.05,0.1,0.2,0.28],"duration":[8,8,8,8]}；stacking=同名取较强不叠加；limits=每次治疗施加一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：主目标治疗175%跳3次，屏障20%持续8秒，技力34，初始15。
  - 被动：基准：治疗附屏障5%。
- ★2（攻×1.55、生命×1.65）：治疗190%跳3次，屏障25%持续8秒，技力30，初始15。
  - 被动：治疗附屏障10%。
- ★3（攻×2.2、生命×2.6）：治疗200%跳4次，屏障30%持续8秒，技力30，初始18。
  - 被动：治疗附屏障20%。
- ★4（攻×3、生命×4）：治疗220%跳4次，屏障35%持续10秒，技力34，初始18。
  - 被动：治疗附屏障28%；主目标额外获得1层同级屏障。

### 模组
- 默认模组：uniequip_002_papyrs
- `uniequip_001_papyrs`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_papyrs`（ADVANCED/rewrite）：三星解锁：固定技能跳跃次数+1且跳跃衰减降为20%，主目标屏障翻倍。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4139_papyrs`
实现：复用链愈师KIT；技能瞬时链式heal与屏障buff，屏障走shield primitive，跳跃治疗按链式衰减结算。
因果检查：
- 链式治疗每目标只结算一次，跳跃不重复治疗同一目标。
- 屏障同名取较强；护盾未破时再次治疗只刷新，不叠加数值。

## 风絮（`char_4222_taraxa`）
- 职业：MEDIC；档位：4（6 金币）；路线：`healShield`
- 定位：高频范围治疗的巡医，靠扶风状态临时提升治疗频率。
- 档位理由：原生起飞高频治疗，进击转为状态后仍是强力高台医疗，定六金币档。
- 设计理由：何处着做成即时高频治疗并进入具名「扶风」状态，替代独立起飞；定风絮改为技能触发的庇护与阻挡增益。

### 固定技能：何处着（进击）
- 来源技能：`skchr_taraxa_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[60,55,50,55]；初始技力：[30,30,30,35]
- 技力满立即结算：对攻击范围内已受伤友方进行多次高频治疗，并进入数秒的具名「扶风」状态。
- 效果1：依次治疗4/5/5/6次，每次随机选择范围内已受伤友方，单次治疗量为攻击力50%/52%/55%/60%。
  - trigger=自然技力满；target=攻击范围内已受伤友方；action=heal；lifecycle=instant
  - values={"healScale":[0.5,0.52,0.55,0.6],"hits":[4,5,5,6]}；stacking=每跳一次随机目标一次；limits=每场战斗不限次数
- 效果2：进入具名「扶风」状态12/14/16/18秒：攻速+60/80/100/120，可治疗飞行单位；该状态替代原生独立起飞，不改变阻挡与站位。
  - trigger=同一结算；target=自身；action=nativeMechanism；lifecycle=battle
  - values={"mechanism":"扶风","attackSpeed":[60,80,100,120],"duration":[12,14,16,18],"canHealFlying":[1,1,1,1]}；stacking=同名刷新取较长剩余时间；limits=每次结算施加一次

### 原生天赋计划
- 定风絮（`/char_4222_taraxa/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 原为飞行友方庇护与阻挡+1，进击取消独立起飞后改为技能触发的范围庇护与阻挡增益。
  - scope=扶风期间攻击范围内友方；parameters={"damageResistance":[0.07,0.08,0.1,0.12],"blockCnt":1}；trigger=技能/技力事件时；unlockStar=1

### 进击被动
- 被动0：扶风期间攻击范围内友方获得7%/8%/10%/12%庇护与阻挡+1，状态随扶风结束而移除。
  - trigger=自身进入扶风状态；target=攻击范围内友方；action=addBuff；lifecycle=battle
  - values={"damageResistance":[0.07,0.08,0.1,0.12],"blockCnt":[1,1,1,1],"duration":[12,14,16,18]}；stacking=同名不叠加；limits=随扶风状态生灭

### 星级
- ★1（攻×1、生命×1）：基准：4次50%治疗，扶风攻速+60持续12秒，技力60，初始30。
  - 被动：基准：扶风期间友方7%庇护+阻挡1。
- ★2（攻×1.55、生命×1.65）：5次52%治疗，扶风攻速+80持续14秒，技力55，初始30。
  - 被动：扶风期间友方8%庇护+阻挡1。
- ★3（攻×2.2、生命×2.6）：5次55%治疗，扶风攻速+100持续16秒，技力50，初始30。
  - 被动：扶风期间友方10%庇护+阻挡1。
- ★4（攻×3、生命×4）：6次60%治疗，扶风攻速+120持续18秒，技力55，初始35。
  - 被动：扶风期间友方12%庇护+阻挡1，扶风结束时治疗范围内的受伤友方一次。

### 模组
- 默认模组：null

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4222_taraxa`
实现：复用巡医KIT；新增具名状态「扶风」替代起飞，绑定攻速与治疗飞行能力；高频治疗为多次随机heal，庇护走限时buff。
因果检查：
- 扶风状态到期后攻速与庇护同时移除；再次施放只刷新时间不叠加攻速。
- 治疗跳过满血目标；每跳只治疗一个已受伤目标，目标全满时跳数空过但不回血。

## 雷蛇（`char_107_liskam`）
- 职业：TANK；档位：4（6 金币）；路线：`blockCounter`
- 定位：受击回技的远程重装，靠反击电弧群体控制并自损。
- 档位理由：受击充能加快技能循环，控场稳定，定六金币档。
- 设计理由：反击电弧做成即时群体法术伤害与概率晕眩，代价为自身短暂晕眩；战术防御与雷抗保留触发或白值。

### 固定技能：反击电弧（进击）
- 来源技能：`skchr_liskam_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[38,34,34,42]；初始技力：0
- 技力满立即对周围至多4名敌人造成法术伤害并有概率晕眩，结算后自身晕眩数秒。
- 效果1：对至多3/3/4/4名敌人造成法术伤害125%/150%/175%/200%，并有20%/22%/25%/30%概率晕眩1秒。
  - trigger=自然技力满；target=周围至多4名敌人；action=damage；lifecycle=instant
  - values={"dmgType":"arts","atkScale":[1.25,1.5,1.75,2],"maxTargets":[3,3,4,4],"stunProb":[0.2,0.22,0.25,0.3],"stun":[1,1,1,1]}；stacking=每目标每段判定一次；limits=每场战斗不限次数
- 效果2：结算后自身晕眩3/4/5/5秒，是本技能的风险代价。
  - trigger=同一结算；target=自身；action=applyStatus；lifecycle=instant
  - values={"stun":[3,4,5,5]}；stacking=每次结算施加一次；limits=每场战斗不限次数

### 原生天赋计划
- 战术防御（`/char_107_liskam/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 受到攻击时回复自己和周围一格内随机一名友方1点技力，保留触发式。
  - scope=自身与周围一格随机友方；parameters={"spGain":1}；trigger=自身受到相关事件时；unlockStar=1
- 雷抗（`/char_107_liskam/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留法术抗性+10常驻白值。
  - scope=自身；parameters={"res":10}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：每次受到攻击回复自身与周围一格内随机1名友方各1点技力；自身晕眩期间不触发。
  - trigger=自身受到攻击；target=自身与周围一格随机1名友方；action=spGain；lifecycle=instant
  - values={"spGain":[1,1,1,1]}；stacking=每次受击一次；limits=每次受击事件一次

### 星级
- ★1（攻×1、生命×1）：基准：3目标125%、20%晕眩1秒，自身晕眩3秒，技力38。
  - 被动：基准：受击回1技力，法抗+10。
- ★2（攻×1.55、生命×1.65）：3目标150%、22%晕眩1秒，自身晕眩4秒，技力34。
  - 被动：受击回1技力，法抗+10。
- ★3（攻×2.2、生命×2.6）：4目标175%、25%晕眩1秒，自身晕眩5秒，技力34。
  - 被动：受击回1技力，法抗+10。
- ★4（攻×3、生命×4）：4目标200%、30%晕眩1秒，自身晕眩5秒，技力42。
  - 被动：受击回1技力，法抗+15；自身晕眩时长-1秒。

### 模组
- 默认模组：uniequip_002_liskam
- `uniequip_001_liskam`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_liskam`（ADVANCED/rewrite）：三星解锁：电弧晕眩概率+10%，且自身晕眩期间仍可受击回技力。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_107_liskam`
实现：复用远程重装KIT；技能瞬时多目标damage+概率stun与自身stun，受击spGain走事件总线。
因果检查：
- 电弧对每个目标只判定一次晕眩；免疫目标不消耗概率。
- 自身晕眩期间不触发受击回技力，避免自循环。

## 深巡（`char_4137_udflow`）
- 职业：TANK；档位：4（6 金币）；路线：`element`
- 定位：穿透减速的远程重装，靠毒性鳍刺持续消耗。
- 档位理由：穿透多目标加持续法术伤害，功能独特，定六金币档。
- 设计理由：行动能力剥夺做成即时穿透鳍刺与停顿，细胞活性抑制剂保留为攻击触发的持续伤害。

### 固定技能：行动能力剥夺（进击）
- 来源技能：`skchr_udflow_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[36,32,32,36]；初始技力：[22,22,25,25]
- 技力满立即向前方直线发射毒性鳍刺，穿透至多4个目标并造成法术伤害与停顿。
- 效果1：对正前方至多3/3/4/4个目标造成攻击力50%/55%/60%/70%的法术伤害并使其停顿1/1/1/1.5秒。
  - trigger=自然技力满；target=前方直线敌人；action=damage；lifecycle=instant
  - values={"dmgType":"arts","atkScale":[0.5,0.55,0.6,0.7],"maxTargets":[3,3,4,4],"sluggish":[1,1,1,1.5]}；stacking=每目标一次；limits=每场战斗不限次数

### 原生天赋计划
- 细胞活性抑制剂（`/char_4137_udflow/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 攻击使目标持续受到法术伤害，保留但改为进击可核对的每秒伤害并明确海怪加倍。
  - scope=被命中敌人；parameters={"dotPerSec":[40,55,80,100],"duration":3,"seamonsterMultiplier":2}

### 进击被动
- 被动0：使命中目标3秒内每秒受到40/55/80/100点法术伤害，对海怪敌人翻倍；同名标记取较高数值。
  - trigger=自身攻击命中敌人；target=被命中敌人；action=damage；lifecycle=battle
  - values={"dotPerSec":[40,55,80,100],"duration":[3,3,3,3],"seamonsterMultiplier":[2,2,2,2]}；stacking=同名取较高不叠加；limits=每次命中刷新持续时间；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：穿透3目标50%并停顿1秒，技力36，初始22。
  - 被动：基准：命中后每秒40法术，海怪翻倍。
- ★2（攻×1.55、生命×1.65）：穿透3目标55%并停顿1秒，技力32，初始22。
  - 被动：命中后每秒55法术。
- ★3（攻×2.2、生命×2.6）：穿透4目标60%并停顿1秒，技力32，初始25。
  - 被动：命中后每秒80法术。
- ★4（攻×3、生命×4）：穿透4目标70%并停顿1.5秒，技力36，初始25。
  - 被动：命中后每秒100法术，海怪翻倍；停顿目标被持续伤害时额外+20%伤害。

### 模组
- 默认模组：uniequip_002_udflow
- `uniequip_001_udflow`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_udflow`（ADVANCED/rewrite）：三星解锁：持续法术伤害可叠加至2层，每层独立计时，上限2层。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4137_udflow`
实现：复用远程重装KIT；技能瞬时直线穿透damage与停顿status，命中挂持续法术dot，海怪判定读敌人tag。
因果检查：
- 穿透伤害对每个目标只结算一次；同一目标被同条鳍刺多次经过不重复。
- 持续伤害同名取较高；海怪翻倍在命中判定时读取，目标死亡后按伤害来源归属。

## 折桠（`char_4207_branch`）
- 职业：TANK；档位：4（6 金币）；路线：`blockCounter`
- 定位：不可被治疗的绝食重装，靠战栗与结算自愈抗线。
- 档位理由：不可治疗但自愈与群控，定位鲜明，定六金币档。
- 设计理由：生存决心做成即时战栗与攻防提升，简易包扎改为技能结算后的按比例自愈。

### 固定技能：生存决心（进击）
- 来源技能：`skchr_branch_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[22,18,18,22]；初始技力：[3,5,8,8]
- 技力满立即使周围地面敌人战栗，并短时提升攻击与防御且攻击阻挡的所有敌人。
- 效果1：使周围地面敌人战栗5秒。
  - trigger=自然技力满；target=周围地面敌人；action=applyStatus；lifecycle=battle
  - values={"status":1,"fear":[5,5,5,5]}；stacking=每次结算施加一次；limits=每场战斗不限次数
- 效果2：攻击+120%/135%/150%/170%、防御+40%/45%/50%/55%，持续15秒，并同时攻击阻挡的所有敌人。
  - trigger=同一结算；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[1.2,1.35,1.5,1.7],"def":[0.4,0.45,0.5,0.55],"duration":[15,15,15,15]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 简易包扎（`/char_4207_branch/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 技能结束时恢复自身最大生命，在进击瞬发技能下改为固定技能结算完成后按比例自愈。
  - scope=自身；parameters={"hpRatio":[0.4,0.45,0.5,0.55]}

### 进击被动
- 被动0：固定技能结算后立即恢复自身最大生命40%/45%/50%/55%；自身不可被友方治疗，只认这一自愈来源。
  - trigger=自身固定技能结算完成；target=自身；action=heal；lifecycle=instant
  - values={"maxHpRatio":[0.4,0.45,0.5,0.55]}；stacking=每次技能结算一次；limits=每场战斗不限次数；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：战栗5秒、攻击+120%、防御+40%持续15秒，技力22，初始3。
  - 被动：基准：技能结算后自愈40%最大生命。
- ★2（攻×1.55、生命×1.65）：战栗5秒、攻击+135%、防御+45%，技力18，初始5。
  - 被动：技能结算后自愈45%。
- ★3（攻×2.2、生命×2.6）：战栗5秒、攻击+150%、防御+50%，技力18，初始8。
  - 被动：技能结算后自愈50%。
- ★4（攻×3、生命×4）：战栗5秒、攻击+170%、防御+55%，技力22，初始8。
  - 被动：技能结算后自愈55%，战栗期间受到的伤害-15%。

### 模组
- 默认模组：uniequip_002_branch
- `uniequip_001_branch`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_branch`（ADVANCED/rewrite）：三星解锁：技能结算自愈额外+10%最大生命，且自愈溢出部分转化为3秒护盾。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4207_branch`
实现：复用绝食重装KIT；技能瞬时fear+atk/def buff，自愈走技能完成事件的最大生命比例heal。
因果检查：
- 战栗重复施加按成功施加计数；免疫战栗目标不计入。
- 自愈只认技能完成事件，友方治疗对其无效；溢出转护盾只在本被动结算时发生。

## 灰毫（`char_431_ashlok`）
- 职业：TANK；档位：4（6 金币）；路线：`pierceCrit`
- 定位：要塞重装，靠远程群体物理输出与阵型增益。
- 档位理由：远程群体物理加四格增益，输出型重装，定六金币档。
- 设计理由：专注轰击做成即时远程群体打击并短时阻挡归零，炮术研习改为地形触发的攻击增益。

### 固定技能：专注轰击（进击）
- 来源技能：`skchr_ashlok_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[20,18,18,20]；初始技力：[10,10,12,12]
- 技力满立即对前方区域发动远程群体物理攻击，并短时阻挡归零、攻击间隔缩短。
- 效果1：对前方区域敌人造成攻击力140%/160%/185%/210%的群体物理伤害。
  - trigger=自然技力满；target=前方区域敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.4,1.6,1.85,2.1],"splash":[1,1,1,1]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：10秒内阻挡数-1（至0）且攻击间隔-0.5/0.55/0.6/0.65秒。
  - trigger=同一结算；target=自身；action=addBuff；lifecycle=battle
  - values={"blockCnt":[-1,-1,-1,-1],"attackInterval":[-0.5,-0.55,-0.6,-0.65],"duration":[10,10,10,10]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 炮术研习（`/char_431_ashlok/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由常驻攻击加成改为地形触发的攻击增益：周身四格为地面时数值更高。
  - scope=自身；parameters={"atk":[0.08,0.1,0.12,0.14],"atkOnGround":[0.16,0.2,0.24,0.28]}

### 进击被动
- 被动0：攻击后4秒内攻击+8%/10%/12%/14%；若周身四格为地面则改为+16%/20%/24%/28%，同名刷新取较强值。
  - trigger=自身发动攻击；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[0.08,0.1,0.12,0.14],"atkOnGround":[0.16,0.2,0.24,0.28],"duration":[4,4,4,4]}；stacking=同名取较强不叠加；limits=每次攻击刷新一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：群体140%物理、阻挡-1与攻间-0.5持续10秒，技力20，初始10。
  - 被动：基准：攻击后攻击+8%，地面四格+16%。
- ★2（攻×1.55、生命×1.65）：群体160%、攻间-0.55，技力18，初始10。
  - 被动：攻击后攻击+10%，地面四格+20%。
- ★3（攻×2.2、生命×2.6）：群体185%、攻间-0.6，技力18，初始12。
  - 被动：攻击后攻击+12%，地面四格+24%。
- ★4（攻×3、生命×4）：群体210%、攻间-0.65，技力20，初始12。
  - 被动：攻击后攻击+14%，地面四格+28%；地面四格时长额外获得10%暴击率。

### 模组
- 默认模组：uniequip_002_ashlok
- `uniequip_001_ashlok`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_ashlok`（ADVANCED/rewrite）：三星解锁：地面四格判定范围扩大到周围八格，且远程群体伤害提升10%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_431_ashlok`
实现：复用要塞KIT；技能瞬时群体damage与自身block/attackInterval buff，地形增益读周围地块类型。
因果检查：
- 阻挡归零期间不阻挡敌人但可继续远程攻击；同名buff刷新取较强。
- 地形判定按当前周身地块采样，地块变化时下一次攻击立即按新地形结算。

## 菲莱（`char_4148_philae`）
- 职业：TANK；档位：4（6 金币）；路线：`element`
- 定位：元素重装，靠损伤屏障与凋亡反制吸收元素伤害。
- 档位理由：原生元素屏障与凋亡回技，抗元素支点，定六金币档。
- 设计理由：灵河护佑做成即时清损伤与元素屏障，神河谕使保留为受凋亡回技的触发被动。

### 固定技能：灵河护佑（进击）
- 来源技能：`skchr_philae_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[22,18,18,22]；初始技力：[5,5,10,10]
- 技力满立即清除自身元素损伤、提升生命上限并获得元素损伤屏障。
- 效果1：生命上限+60%/70%/80%/90%，获得1200/1400/1600/1800点元素损伤屏障，立即清除自身现有元素损伤，持续15秒。
  - trigger=自然技力满；target=自身；action=addBuff；lifecycle=battle
  - values={"maxHp":[0.6,0.7,0.8,0.9],"epBarrier":[1200,1400,1600,1800],"duration":[15,15,15,15]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 神河谕使（`/char_4148_philae/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 受到元素损伤-10%，受到凋亡损伤时回复技力，触发式保留。
  - scope=自身；parameters={"epResistance":[0.05,0.07,0.1,0.12],"spGain":[1,1,2,2]}

### 进击被动
- 被动0：受到凋亡损伤时回复1/1/2/2点技力；自身受到的元素损伤持续-5%/7%/10%/12%。
  - trigger=自身受到凋亡损伤；target=自身；action=spGain；lifecycle=instant
  - values={"spGain":[1,1,2,2],"epResistance":[0.05,0.07,0.1,0.12]}；stacking=每次凋亡受击一次；limits=每次事件一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：生命+60%、元素屏障1200持续15秒，技力22，初始5。
  - 被动：基准：受凋亡回1技力，元素减伤5%。
- ★2（攻×1.55、生命×1.65）：生命+70%、屏障1400，技力18，初始5。
  - 被动：受凋亡回1技力，元素减伤7%。
- ★3（攻×2.2、生命×2.6）：生命+80%、屏障1600，技力18，初始10。
  - 被动：受凋亡回2技力，元素减伤10%。
- ★4（攻×3、生命×4）：生命+90%、屏障1800，技力22，初始10。
  - 被动：受凋亡回2技力，元素减伤12%；元素屏障破碎时对周围敌人造成菲莱攻击力150%的法术伤害。

### 模组
- 默认模组：uniequip_002_philae
- `uniequip_001_philae`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_philae`（ADVANCED/rewrite）：三星解锁：元素屏障值提升30%，且屏障存在期间受到的物理伤害-10%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4148_philae`
实现：复用元素重装KIT；技能瞬时maxHp+epBarrier buff与元素损伤清除，受凋亡事件驱动spGain。
因果检查：
- 元素屏障只吸收元素损伤，不吸收普通伤害；同名刷新取较强值。
- 凋亡受击按事件计数回技力；免疫凋亡时不触发。

## 推进之王（`char_112_siege`）
- 职业：PIONEER；档位：5（8 金币）；路线：`skillCycle`
- 定位：六星核心先锋，靠跃空锤群体输出与回费，并增益全体先锋。
- 档位理由：先锋体系核心兼群体爆发与回费，定八金币档。
- 设计理由：跃空锤做成即时的范围物理与回费，万兽之王与粉碎保留为阵营/击杀触发被动。

### 固定技能：跃空锤（进击）
- 来源技能：`skchr_siege_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[11,10,10,11]；初始技力：[6,10,10,14]
- 技力满立即对周围所有敌人造成物理伤害并获得部署费用。
- 效果1：对周围所有敌人造成攻击力280%/300%/320%/340%的物理伤害。
  - trigger=自然技力满；target=周围所有敌人；action=damage；lifecycle=instant
  - values={"atkScale":[2.8,3,3.2,3.4]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：立即获得2/3/3/3点部署费用。
  - trigger=同一结算；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[2,3,3,3]}；stacking=单次结算一次；limits=每场战斗不限次数

### 原生天赋计划
- 万兽之王（`/char_112_siege/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 所有先锋攻击与防御+8%，保留阵营被动。
  - scope=全体先锋干员；parameters={"atk":[0.06,0.07,0.08,0.09],"def":[0.06,0.07,0.08,0.09]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 粉碎（`/char_112_siege/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 周围四格内有敌人倒下时获得1点技力，触发式保留。
  - scope=自身；parameters={"spGain":1}；trigger=技能/技力事件时；unlockStar=1

### 进击被动
- 被动0：周围四格每有敌人倒下，自身回复1点技力；同一敌人只计一次。
  - trigger=周围四格内有敌人被击倒；target=自身；action=spGain；lifecycle=instant
  - values={"spGain":[1,1,1,1]}；stacking=每击倒事件一次；limits=无额外次数限制

### 星级
- ★1（攻×1、生命×1）：基准：群体280%物理并回费2，技力11，初始6。
  - 被动：基准：先锋攻防+6%，周围击倒回1技力。
- ★2（攻×1.55、生命×1.65）：群体300%、回费3，技力10，初始10。
  - 被动：先锋攻防+7%。
- ★3（攻×2.2、生命×2.6）：群体320%、回费3，技力10，初始10。
  - 被动：先锋攻防+8%，周围击倒回1技力。
- ★4（攻×3、生命×4）：群体340%、回费3，技力11，初始14。
  - 被动：先锋攻防+9%；跃空锤击倒敌人时额外回1费，每场最多5次。

### 模组
- 默认模组：uniequip_002_siege
- `uniequip_001_siege`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_siege`（ADVANCED/rewrite）：三星解锁：跃空锤伤害范围扩大1格，击倒敌人时回复1点技力。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_siege`（ADVANCED/rewrite）：三星解锁：先锋攻防增益额外+3%，且跃空锤结算时全体先锋回复1点技力，每场最多5次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_112_siege`
实现：复用先锋回费KIT；技能瞬时群体damage+economy，先锋攻防为常驻职业被动，击倒回技力走事件。
因果检查：
- 跃空锤对同一敌人只结算一次；重复施放各自独立结算。
- 周围击倒回技力按事件计数；击杀回费与技能回费分开记账。

## 风笛（`char_222_bpipe`）
- 职业：PIONEER；档位：5（8 金币）；路线：`pierceCrit`
- 定位：高机动输出先锋，靠高效冲击与多段打击快速清场。
- 档位理由：开技能即多段打击且为先锋提供初始技力，定八金币档。
- 设计理由：高效冲击做成即时强化攻击与额外段，精密填弹保留为概率强化，军事传统保留为开局技力。

### 固定技能：高效冲击（进击）
- 来源技能：`skchr_bpipe_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[5,4,4,5]；初始技力：0
- 技力满立即打出一次强化攻击，并额外追加一次攻击。
- 效果1：对当前目标造成攻击力160%/180%/200%/220%的物理伤害并额外追加1次攻击。
  - trigger=自然技力满；target=当前攻击目标；action=damage；lifecycle=instant
  - values={"atkScale":[1.6,1.8,2,2.2],"extraHits":[1,1,1,1]}；stacking=每次结算一次；limits=每场战斗不限次数

### 原生天赋计划
- 精密填弹（`/char_222_bpipe/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 每次攻击25%概率强化并额外攻击一个目标，保留概率机制。
  - scope=攻击目标；parameters={"prob":[0.25,0.25,0.25,0.25],"atkScale":[1.1,1.15,1.3,1.4]}；trigger=普通攻击时；unlockStar=1
- 军事传统（`/char_222_bpipe/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 编入队伍时所有先锋初始技力+6，保留开局技力被动。
  - scope=全体先锋干员；parameters={"initSp":[4,5,6,7]}

### 进击被动
- 被动0：编入队伍时全体先锋初始技力+4/5/6/7，开局一次性入账。
  - trigger=战斗开始；target=全体先锋干员；action=spGain；lifecycle=run
  - values={"initSp":[4,5,6,7]}；stacking=每场战斗一次；limits=每场战斗一次；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：基准：160%并追打1次，技力5。
  - 被动：基准：25%概率×1.1且多打1个；先锋初始技力+4。
- ★2（攻×1.55、生命×1.65）：180%并追打1次，技力4。
  - 被动：25%概率×1.15；先锋初始技力+5。
- ★3（攻×2.2、生命×2.6）：200%并追打1次，技力4。
  - 被动：25%概率×1.3；先锋初始技力+6。
- ★4（攻×3、生命×4）：220%并追打1次，技力5。
  - 被动：25%概率×1.4；先锋初始技力+7；高效冲击的追加攻击也享受精密填弹。

### 模组
- 默认模组：uniequip_002_bpipe
- `uniequip_001_bpipe`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_bpipe`（ADVANCED/rewrite）：三星解锁：高效冲击额外追加1次攻击（共2次），且追打命中满血目标时必中精密填弹。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_bpipe`（ADVANCED/rewrite）：三星解锁：击杀回费额外+1，每场最多5次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_222_bpipe`
实现：复用冲锋手KIT；技能瞬时多段damage，精密填弹挂攻击事件概率判定，军事传统走run开局。
因果检查：
- 精密填弹每次攻击只判定一次；追打与技能追段各自独立判定。
- 开局先锋初始技力每场只发一次；先锋自身初始技力不会因再部署重复获得。

## 忍冬（`char_4026_vulpis`）
- 职业：PIONEER；档位：5（8 金币）；路线：`pierceCrit`
- 定位：高机动刺客先锋，靠追凶额外法伤与惩戒追击进行点杀。
- 档位理由：首伤必附法伤且带停顿晕眩，点杀与节奏兼具，定八金币档。
- 设计理由：小施惩戒做成即时高倍额法伤与回费，追凶保留为首伤触发，蓄势作为经济与自愈。

### 固定技能：小施惩戒（进击）
- 来源技能：`skchr_vulpis_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[5,4,4,5]；初始技力：[4,8,12,12]
- 技力满立即对当前目标追加一次高倍额法术伤害并获得部署费用。
- 效果1：对目标额外造成攻击力245%/260%/275%/290%的法术伤害。
  - trigger=自然技力满；target=当前攻击目标；action=damage；lifecycle=instant
  - values={"atkScale":[2.45,2.6,2.75,2.9]}；stacking=每次结算一次；limits=每场战斗不限次数
- 效果2：立即获得1点部署费用。
  - trigger=同一结算；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[1,1,1,1]}；stacking=单次结算一次；limits=每场战斗不限次数

### 原生天赋计划
- 追凶（`/char_4026_vulpis/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 对每个敌人首次造成伤害后10秒内对其额外造成攻击力比例法伤，触发式保留。
  - scope=该敌人；parameters={"extraScale":[0.2,0.24,0.3,0.34],"duration":10}
- 蓄势（`/char_4026_vulpis/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 部署费用自然回复速度+10%；4秒未受伤则每秒回复最大生命，保留经济与自愈。
  - scope=自身；parameters={"costRate":[1.08,1.09,1.1,1.12],"hpPerSec":[0.03,0.035,0.04,0.045],"interval":4}；trigger=自身受到相关事件时；unlockStar=1

### 进击被动
- 被动0：对该敌人的后续伤害10秒内额外附加攻击力20%/24%/30%/34%的法术伤害；同一敌人只挂一次标记，标记到期后再次首伤可重新挂。
  - trigger=对某个敌人首次造成伤害；target=该敌人；action=damage；lifecycle=battle
  - values={"extraScale":[0.2,0.24,0.3,0.34],"duration":[10,10,10,10]}；stacking=同一敌人同时只有一个标记；limits=每敌人每次标记一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：245%法伤并回费1，技力5，初始4。
  - 被动：基准：首伤后10秒额外20%法伤；蓄势回费+8%、未受伤回3%/秒。
- ★2（攻×1.55、生命×1.65）：260%法伤并回费1，技力4，初始8。
  - 被动：首伤额外24%；蓄势回费+9%、未受伤回3.5%/秒。
- ★3（攻×2.2、生命×2.6）：275%法伤并回费1，技力4，初始12。
  - 被动：首伤额外30%；蓄势回费+10%、未受伤回4%/秒。
- ★4（攻×3、生命×4）：290%法伤并回费1，技力5，初始12。
  - 被动：首伤额外34%；蓄势回费+12%、未受伤回4.5%/秒，追凶标记目标被击倒时回2费。

### 模组
- 默认模组：uniequip_002_vulpis
- `uniequip_001_vulpis`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_vulpis`（ADVANCED/rewrite）：三星解锁：追凶额外法伤提升至攻击力45%，且对停顿/晕眩目标翻倍。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_vulpis`（ADVANCED/rewrite）：三星解锁：小施惩戒可在技力满时连续结算2次，第二次伤害减半，每场最多触发5次双段。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4026_vulpis`
实现：复用先锋KIT；技能瞬时单目标高倍法伤+economy，追凶为首伤事件挂标记，蓄势为属性与自愈被动。
因果检查：
- 追凶标记每个敌人只挂一次，标记到期后再次首伤重新挂；治疗/护盾不重置标记。
- 小施惩戒回费与追凶附加伤害是两条链，同一结算不重复互相触发。

## 琴柳（`char_479_sleach`）
- 职业：PIONEER；档位：5（8 金币）；路线：`economyGrowth`
- 定位：核心旗手，靠军旗装置与光辉旗帜提供回费、控制与增益。
- 档位理由：回费加军旗装置与范围控制，体系型支点，定八金币档。
- 设计理由：光辉旗帜做成即时回费与范围物理晕眩，军旗转为具名装置，精神感召保留减费。

### 固定技能：光辉旗帜（进击）
- 来源技能：`skchr_sleach_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,20,20,24]；初始技力：[6,7,10,10]
- 技力满立即获得部署费用，将军旗掷向地面敌人位置，造成范围物理伤害与晕眩，并使周围敌人停顿与脆弱。
- 效果1：立即获得8/9/10/10点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[8,9,10,10]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：对落点周围敌人造成攻击力240%/270%/300%/320%物理伤害并晕眩3/3/3.5/3.5秒；之后10秒内受到停顿与25%/28%/30%/35%脆弱。
  - trigger=同一结算；target=军旗落点周围敌人；action=damage；lifecycle=battle
  - values={"atkScale":[2.4,2.7,3,3.2],"stun":[3,3,3.5,3.5],"slow":[1,1,1,1],"fragile":[0.25,0.28,0.3,0.35],"duration":[10,10,10,10]}；stacking=脆弱同名取较强；limits=每次结算一次

### 原生天赋计划
- 不退之旗（`/char_479_sleach/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 部署时持有军旗，旗周围友方攻速+、敌人攻速-；改为具名装置并随部署位置移动。
  - scope=军旗周围8格；parameters={"allyAttackSpeed":[5,8,10,12],"enemyAttackSpeed":[-5,-8,-10,-12]}
- 精神感召（`/char_479_sleach/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 部署后下一名部署的干员费用-2，保留开局减费。
  - scope=下一名部署干员；parameters={"nextCost":[-2,-2,-2,-2]}；trigger=部署/再部署后；unlockStar=1

### 进击被动
- 被动0：部署时在身前一格放置具名装置「军旗」；军旗周围8格友方攻速+5/8/10/12、敌人攻速-5/8/10/12，旗随琴柳技能移动或收回。
  - trigger=部署时；target=自身；action=summon；lifecycle=battle
  - values={"deviceId":"sleach_banner","count":[1,1,1,1],"duration":[0,0,0,0],"allyAttackSpeed":[5,8,10,12],"enemyAttackSpeed":[-5,-8,-10,-12]}；stacking=军旗唯一，重新放置替换旧旗；limits=每场战斗常驻，技能可移动军旗；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：回费8、落点240%物理与晕眩3秒、脆弱25%持续10秒，技力24，初始6。
  - 被动：基准：军旗周围友攻速+5敌攻速-5；下一部署-2费。
- ★2（攻×1.55、生命×1.65）：回费9、270%与晕眩3秒、脆弱28%，技力20，初始7。
  - 被动：军旗友+8敌-8；下一部署-2费。
- ★3（攻×2.2、生命×2.6）：回费10、300%与晕眩3.5秒、脆弱30%，技力20，初始10。
  - 被动：军旗友+10敌-10；下一部署-2费。
- ★4（攻×3、生命×4）：回费10、320%与晕眩3.5秒、脆弱35%，技力24，初始10。
  - 被动：军旗友+12敌-12；下一部署-2费；军旗范围内敌人受到的物理伤害+8%。

### 模组
- 默认模组：uniequip_002_sleach
- `uniequip_001_sleach`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_sleach`（ADVANCED/rewrite）：三星解锁：军旗友方增益额外+3，且军旗存在时琴柳每秒回复1点技力，不叠加。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_sleach`（ADVANCED/rewrite）：三星解锁：军旗范围内友方每次造成伤害有5%概率使琴柳回复0.2费，每秒最多1次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_479_sleach`
实现：新增具名装置sleach_banner与周围光环；技能瞬时economy+落点damage/stun/fragile，军旗移动用device primitive。
因果检查：
- 军旗唯一：重新放置替换旧旗，旧旗光环立即失效。
- 脆弱与晕眩对同一目标同次结算分别施加一次；免疫晕眩仍施加脆弱。

## 焰尾（`char_420_flamtl`）
- 职业：PIONEER；档位：5（8 金币）；路线：`skillCycle`
- 定位：生存型先锋，靠闪避与焰心连续回费站场。
- 档位理由：闪避加逐秒回费与卡西米尔闪避光环，生存体系支点，定八金币档。
- 设计理由：焰心做成即时回费与短时攻闪，前锋剑术保留为闪避触发，红松骑士团团长保留阵营闪避。

### 固定技能：焰心（进击）
- 来源技能：`skchr_flamtl_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[19,16,16,19]；初始技力：[3,6,6,6]
- 技力满立即获得部署费用，并短时提升攻击力、阻挡数与物理法术闪避。
- 效果1：立即获得6/7/7/8点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[6,7,7,8]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：8秒内攻击+60%/70%/80%/90%、阻挡+1、物理与法术闪避80%。
  - trigger=同一结算；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[0.6,0.7,0.8,0.9],"blockCnt":[1,1,1,1],"dodge":[0.8,0.8,0.8,0.8],"duration":[8,8,8,8]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 前锋剑术（`/char_420_flamtl/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 触发闪避时下次攻击变二连击并攻击所有阻挡敌人，保留触发条件。
  - scope=自身下次攻击；parameters={"extraHits":1,"targetAllBlocked":1}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 红松骑士团团长（`/char_420_flamtl/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 在场时所有卡西米尔势力干员获得22%物理闪避，保留阵营被动。
  - scope=全体卡西米尔干员；parameters={"physDodge":[0.14,0.18,0.22,0.26]}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：成功闪避后下一次普通攻击变为二连击并攻击所有阻挡的敌人；该强化只作用于下一次攻击，之后消耗。
  - trigger=自身成功闪避一次攻击；target=自身；action=addBuff；lifecycle=instant
  - values={"nextAttackMulti":[2,2,2,2],"targetAllBlocked":[1,1,1,1]}；stacking=每次闪避叠加一层，最多1层待消耗；limits=每次成功闪避触发一次

### 星级
- ★1（攻×1、生命×1）：基准：回费6、攻击+60%、阻挡+1、80%双闪持续8秒，技力19，初始3。
  - 被动：基准：闪避后下次攻击二连击；卡西米尔干员物理闪避+14%。
- ★2（攻×1.55、生命×1.65）：回费7、攻击+70%，技力16，初始6。
  - 被动：闪避后二连击；卡西米尔闪避+18%。
- ★3（攻×2.2、生命×2.6）：回费7、攻击+80%，技力16，初始6。
  - 被动：闪避后二连击；卡西米尔闪避+22%。
- ★4（攻×3、生命×4）：回费8、攻击+90%，技力19，初始6。
  - 被动：闪避后二连击并攻击所有阻挡敌人；卡西米尔闪避+26%，焰心期间闪避成功额外回1费。

### 模组
- 默认模组：uniequip_002_flamtl
- `uniequip_001_flamtl`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_flamtl`（ADVANCED/rewrite）：三星解锁：物理闪避额外+10%，且每次成功闪避回复1点技力，每3秒最多一次。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_flamtl`（ADVANCED/rewrite）：三星解锁：卡西米尔闪避光环范围扩大至全场，且获得闪避的卡西米尔干员攻击+5%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_420_flamtl`
实现：复用先锋KIT；技能瞬时economy+atk/block/dodge buff，闪避成功事件驱动下次攻击强化，阵营光环常驻。
因果检查：
- 闪避强化只作用于下一次攻击，攻击后立即消耗，不叠加多层。
- 物理与法术闪避分别判定；免疫伤害不触发闪避事件。

## 伺夜（`char_427_vigil`）
- 职业：PIONEER；档位：5（8 金币）；路线：`summon`
- 定位：战术点召唤先锋，靠狼群阻挡与包夹输出。
- 档位理由：召唤狼群兼具阻挡、输出与回费，定八金币档。
- 设计理由：领袖的呼唤做成即时回费与增加狼影，狼群领袖保留为战术点召唤，狼群天性保留为无甲穿防。

### 固定技能：领袖的呼唤（进击）
- 来源技能：`skchr_vigil_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[24,21,21,24]；初始技力：[2,5,7,7]
- 技力满立即获得部署费用，并增加一只狼影（狼群至多3只）。
- 效果1：立即获得5/6/6/7点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[5,6,6,7]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：狼群增加1只狼影，每只狼影使狼群阻挡数+1且攻击额外造成一次伤害，最多3只。
  - trigger=同一结算；target=狼群；action=summon；lifecycle=battle
  - values={"wolfShadows":[1,1,1,1],"maxShadows":3}；stacking=最多3只，超出不再增加；limits=受3只上限约束

### 原生天赋计划
- 狼群领袖（`/char_427_vigil/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 战术点召唤狼群，狼影每25秒自动增加一只至多3只；被击败后重新集结。
  - scope=战术点狼群；parameters={"interval":[30,27,25,23],"maxShadows":3}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 狼群天性（`/char_427_vigil/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 敌人被狼群阻挡时，伺夜和狼群对其攻击无视175防御力，保留穿防。
  - scope=被狼群阻挡的敌人；parameters={"defPenetrate":[125,150,175,200]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：在战术点召唤具名狼群「狼影」2只，之后每30/27/25/23秒自动+1只至多3只；每只提供阻挡+1与额外一次伤害。
  - trigger=部署时；target=战术点；action=summon；lifecycle=battle
  - values={"deviceId":"vigil_wolfpack","shadows":[2,2,2,2],"maxShadows":3,"blockPerShadow":[1,1,1,1]}；stacking=最多3只狼影；limits=狼群死亡后重新集结，重新计时

### 星级
- ★1（攻×1、生命×1）：基准：回费5并+1狼影，技力24，初始2。
  - 被动：基准：狼群2只起每30秒+1；阻挡时无视125防。
- ★2（攻×1.55、生命×1.65）：回费6并+1狼影，技力21，初始5。
  - 被动：每27秒+1；无视150防。
- ★3（攻×2.2、生命×2.6）：回费6并+1狼影，技力21，初始7。
  - 被动：每25秒+1；无视175防。
- ★4（攻×3、生命×4）：回费7并+1狼影，技力24，初始7。
  - 被动：每23秒+1；无视200防；狼影击倒敌人时回1费，每场最多5次。

### 模组
- 默认模组：uniequip_002_vigil
- `uniequip_001_vigil`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_vigil`（ADVANCED/rewrite）：三星解锁：狼群攻击力+15%，狼影自动增长间隔-3秒。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_vigil`（ADVANCED/rewrite）：三星解锁：狼群被击败后立即以2只狼影重新集结，每场最多1次。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_427_vigil`
实现：新增具名召唤vigil_wolfpack与狼影计数AI；技能瞬时economy+增加狼影，狼群阻挡触发穿防。
因果检查：
- 狼影数量封顶3只；超出后自动增长计时重置但不生成第4只。
- 穿防只对被狼群阻挡的敌人生效；狼群死亡后穿防随阻挡关系解除。

## 缪尔赛思（`char_249_mlyss`）
- 职业：PIONEER；档位：6（12 金币）；路线：`summon`
- 定位：战术点复制体先锋，靠流形复制待部署干员属性协同作战。
- 档位理由：复制流形机制独一无二且改变站位规则，定十二金币档。
- 设计理由：浅层非熵适应做成即时回费与流形强化，净水即生命保留复制机制，开源节流保留莱茵减费。

### 固定技能：浅层非熵适应（进击）
- 来源技能：`skchr_mlyss_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[39,35,35,39]；初始技力：[15,18,18,22]
- 技力满立即获得部署费用并使自身与流形强化；近战流形拖拽晕眩，远程流形刷新并束缚。
- 效果1：立即获得10/12/14/15点部署费用。
  - trigger=自然技力满；target=自身经济；action=economy；lifecycle=instant
  - values={"costGain":[10,12,14,15]}；stacking=单次结算一次；limits=每场战斗不限次数
- 效果2：15秒内自身与流形攻击+35%/40%/45%/50%；近战流形每2秒把周围八格敌人向自身小/中力度拖拽并使阻挡单位持续晕眩，远程流形刷新所有流形且攻击附带1.5秒束缚。
  - trigger=同一结算；target=自身与流形；action=nativeMechanism；lifecycle=battle
  - values={"mechanism":"浅层非熵适应","atk":[0.35,0.4,0.45,0.5],"duration":[15,15,15,15],"meleeDragInterval":[2,2,2,2],"meleeDragForce":[1,1,1,2],"rangeRoot":[1.5,1.5,1.5,1.5]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 净水即生命（`/char_249_mlyss/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 战术点召唤流形复制待部署干员的大部分属性（生命、攻击、防御、法抗、阻挡、攻击间隔、范围、伤害类型、近远程特性），被击败后约25秒自动刷新。
  - scope=战术点流形；parameters={"refreshSec":[30,28,25,22]}
- 开源节流（`/char_249_mlyss/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 携带时莱茵生命干员部署费用-2，首名莱茵干员额外-1，保留阵营减费。
  - scope=全体莱茵生命干员；parameters={"cost":[-2,-2,-2,-2],"firstExtra":[-1,-1,-1,-1]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：在战术点召唤具名复制体「流形」，复制当前一名待部署干员的属性与近/远程特性；被击败后30/28/25/22秒自动刷新。
  - trigger=部署时；target=战术点；action=summon；lifecycle=battle
  - values={"deviceId":"mlyss_flowshape","refreshSec":[30,28,25,22],"copyFields":["maxHp","atk","def","res","blockCnt","attackInterval","rangeId","dmgType"]}；stacking=流形唯一；limits=被击败后按间隔刷新；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：回费10、自身与流形攻击+35%持续15秒，近战拖拽2秒/远程束缚1.5秒，技力39，初始15。
  - 被动：基准：流形复制大部分属性，30秒刷新；莱茵-2费。
- ★2（攻×1.55、生命×1.65）：回费12、攻击+40%，技力35，初始18。
  - 被动：流形28秒刷新；莱茵-2费。
- ★3（攻×2.2、生命×2.6）：回费14、攻击+45%，技力35，初始18。
  - 被动：流形25秒刷新；莱茵-2费首名额外-1。
- ★4（攻×3、生命×4）：回费15、攻击+50%，技力39，初始22。
  - 被动：流形22秒刷新且复制属性提升15%；莱茵-2费首名额外-1。

### 模组
- 默认模组：uniequip_002_mlyss
- `uniequip_001_mlyss`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_mlyss`（ADVANCED/rewrite）：三星解锁：流形复制属性提升15%，且远程流形额外继承目标攻击范围。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_mlyss`（ADVANCED/rewrite）：三星解锁：流形刷新时间-5秒，且刷新时对周围敌人造成缪尔赛思攻击力150%的法术伤害。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_249_mlyss`
实现：新增具名复制体mlyss_flowshape与属性复制AI；技能瞬时economy+nativeMechanism（近战拖拽晕眩/远程刷新束缚），复用token primitive。
因果检查：
- 流形复制属性在召唤时点采样待部署干员；重部署后按新候选重新复制，不残留旧属性。
- 近战与远程复制体分支互斥；同一技能只执行当前流形对应分支。

## 凛御银灰（`char_1045_svash2`）
- 职业：PIONEER；档位：6（12 金币）；路线：`redeploy`
- 定位：谢拉格领袖先锋，以再部署、寒冷与待部署区费用操控组织前后排技能循环。
- 档位理由：领袖机制改变再部署与待部署区费用规则，定十二金币档。
- 设计理由：御敌的锋锐做成即时范围物理与寒冷，并按主设计领袖规则发起再部署；雪境先驱改写为触发式谢拉格守护。

### 固定技能：御敌的锋锐（进击）
- 来源技能：`skchr_svash2_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[17,17,17,20]；初始技力：[8,9,12,12]
- 技力满立即对前方至多6名敌人造成物理伤害并使其寒冷、隐匿失效；随后按领袖规则对当前战斗部署费用最高的合格干员发起再部署，降低其费用。
- 效果1：对前方至多6名敌人造成攻击力320%/350%/380%/400%物理伤害，并使其5/5/6/6秒内寒冷且隐匿失效。
  - trigger=自然技力满；target=前方至多6名敌人；action=damage；lifecycle=instant
  - values={"atkScale":[3.2,3.5,3.8,4],"maxTargets":[6,6,6,6],"cold":[5,5,6,6],"reveal":[1,1,1,1]}；stacking=重复寒冷按成功施加计数，寒冷叠满转冻结沿用主设计；limits=每场战斗不限次数
- 效果2：每次成功自然技能结算时，从本方所有未永久移除的干员（含自身、存活、倒地与等待者）中，按当前战斗部署费用最高、同值原始编队顺序最早选取原位可入场的目标。先降低其本战部署费用5（累计最低为0），再原位再部署：倒地或等待者立即入场，存活者恢复全部生命；原生入场失败则恢复原费用且不额外施法。成功后目标在同位置额外施放一次固定技能，不消耗或重置自然技能状态，仅该次额外施法的再部署与减费禁用，其余伤害、治疗、状态和合法天赋照常结算。减费只在本战保留，不进入本局永久成长。
  - trigger=同一结算；target=当前战斗部署费用最高的合格干员（可选择自身）；action=redeploy；lifecycle=instant
  - values={"costReduce":[5,5,5,5],"immediateSkill":[1,1,1,1],"maxTargets":[1,1,1,1],"includeSelf":[1,1,1,1],"immediateSkillOnce":[1,1,1,1],"extraCastRedeployDisabled":[1,1,1,1]}；stacking=每次成功自然技能结算累计减费5，本战最低部署费用为0；最高费用同值按原始编队顺序固定，不耗随机数；limits=每次自然技能结算最多成功再部署一个目标并额外施法一次；额外施法不再发动再部署或减费；入场失败不减费或额外施法。

### 原生天赋计划
- 开放性开局（`/char_1045_svash2/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 在场时向待部署区加入具名位置锚点「风雪之眼」，并令待部署区按当前战斗部署费用升序排列、同值按编队顺序。风雪之眼不是可战斗干员，不占人口、不可被攻击或治疗。位于其左侧的干员与自身初始技力+2/3/4/5，且其下一次再部署时间倍率为0.9/0.85/0.8/0.75。初始技力只在自然入场初始化时结算一次，存活原位免费满血再部署不重复发放。
  - scope=风雪之眼左侧干员与自身；parameters={"initSp":[2,3,4,5],"respawnTimeMultiplier":[0.9,0.85,0.8,0.75],"anchorName":"风雪之眼","anchorKind":"deployAnchor","anchorCombatant":false,"anchorPopulation":0,"anchorAttackable":false,"anchorHealable":false,"deploySort":{"key":"currentBattleDeployCost","order":"asc","tieBreak":"formationOrder"},"affectSide":"anchorLeft","initSpTiming":"naturalDeployInitOnly","initSpNotOnSurvivingRedeploy":true,"respawnAppliesTo":"nextRedeployMultiplier"}；trigger=被动常驻/部署初始化；unlockStar=1
- 雪境先驱（`/char_1045_svash2/talents/1`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 银灰存活且已部署时，提供自身来源的在场谢拉格光环：免疫冻结（freezeImmune），防御+60/70/80/90，并每秒回复最大生命1.5%/1.8%/2.0%/2.2%；在场满15秒后防御与每秒回血系数翻倍（×2）。回血比例直接使用新maxHP一次，不再额外×5。撤退或倒地立即取消自身源光环；重新入场后15秒计时重新开始；存活原位免费满血再部署不重置15秒计时。光环保活本身不产生新的status/debuff计数，免疫冻结不算一次成功施加。
  - scope=在场谢拉格干员（银灰为来源）；parameters={"freezeImmune":true,"freezeImmuneDoesNotCountAsApplied":true,"def":[60,70,80,90],"hpPerSec":[0.015,0.018,0.02,0.022],"hpPerSecIsMaxHpRatio":true,"hpHealAppliedMultiplier":1,"rampSec":15,"rampMultiplier":2,"auraScope":"inFieldShelag","auraProvidedWhile":"selfAliveAndDeployed","auraRevokedOnExit":true,"rampRestartOnReentry":true,"noRampResetOnSurvivingRedeploy":true,"auraKeepaliveEmitsStatus":false}；trigger=来源部署/在场时钟与退场；unlockStar=1
- （空槽位2）（`/char_1045_svash2/talents/2`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}
- （空槽位3）（`/char_1045_svash2/talents/3`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}
- （空槽位4）（`/char_1045_svash2/talents/4`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}
- （空槽位5）（`/char_1045_svash2/talents/5`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}
- （空槽位6）（`/char_1045_svash2/talents/6`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}
- （空槽位7）（`/char_1045_svash2/talents/7`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}

### 进击被动
- 被动0：本队任一真实干员每次成功再部署后，自身获得2/2/2.5/3秒加速：自然技力回复率额外+100%（即每秒额外1点），重复触发把剩余时长累加，不提高同名速率。召唤物、装置、复制体的再部署不计入。
  - trigger=本队真实干员每次成功再部署完成；target=自身；action=haste；lifecycle=battle
  - values={"spRegenBonus":[1,1,1,1],"duration":[2,2,2.5,3]}；stacking=同名加速只累加剩余时长，不叠加速率上限；与其它异源加速各自结算。；limits=每次真正再部署触发一次；本模式新增被动，不挂在任何原生天赋空槽。

### 星级
- ★1（攻×1、生命×1）：基准：320%物理、寒冷5秒、减费5并再部署，技力17，初始8。
  - 被动：基准：风雪之眼（锚点，不占人口）左侧及自身初始技力+2、下次再部署×0.9；雪境先驱（自身源、存活已部署）在场谢拉格免疫冻结、防御+60、每秒回最大生命1.5%；本队真实再部署后自身加速+100%持续2秒（剩余时长累加）。
- ★2（攻×1.55、生命×1.65）：350%物理、寒冷5秒、减费5，技力17，初始9。
  - 被动：风雪之眼（锚点，不占人口）左侧及自身初始技力+3、下次再部署×0.85；雪境先驱（自身源、存活已部署）在场谢拉格免疫冻结、防御+70、每秒回最大生命1.8%；本队真实再部署后自身加速+100%持续2秒（剩余时长累加）。
- ★3（攻×2.2、生命×2.6）：380%物理、寒冷6秒、减费5，技力17，初始12。
  - 被动：风雪之眼（锚点，不占人口）左侧及自身初始技力+4、下次再部署×0.8；雪境先驱（自身源、存活已部署）在场谢拉格免疫冻结、防御+80、每秒回最大生命2%；本队真实再部署后自身加速+100%持续2.5秒（剩余时长累加）。
- ★4（攻×3、生命×4）：400%物理、寒冷6秒、减费5，技力20，初始12。
  - 被动：风雪之眼（锚点，不占人口）左侧及自身初始技力+5、下次再部署×0.75；雪境先驱（自身源、存活已部署）在场谢拉格免疫冻结、防御+90、每秒回最大生命2.2%，在场15秒后系数×2；本队真实再部署后自身加速+100%持续3秒（剩余时长累加）。

### 模组
- 默认模组：null

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1045_svash2`
实现：复用再部署与寒冷KIT；新增领袖再部署选择器（按当前战斗部署费用最高、同值编队序）、费用减免账目与再部署后即时技能施放，并标记该次技能不再触发再部署。
因果检查：
- 最高费用同值时固定按编队顺序选择，自身可被选中；被选目标存活时恢复全部生命且不清空状态。
- 再部署后立即施放的固定技能只执行一次，其再部署部分不再次发动，避免自递归与双发；其它技能效果正常结算。
- 本队每次真实再部署为自身叠加2/2/2.5/3秒加速，重复触发累加剩余时长而不提高同名速率；召唤物/装置/复制体再部署不触发。

## 伊内丝（`char_4087_ines`）
- 职业：PIONEER；档位：6（12 金币）；路线：`redeploy`
- 定位：快速再部署情报官，靠影织束缚偷攻与影哨反隐控场。
- 档位理由：首伤束缚偷取攻击并提供反隐减速场，压制力强，定十二金币档。
- 设计理由：暗夜无明做成即时隐匿与攻速偷取，影织与影哨保留为首伤触发与撤退留场。

### 固定技能：暗夜无明（进击）
- 来源技能：`skchr_ines_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[24,20,20,24]；初始技力：[15,15,18,18]
- 技力满立即进入隐匿并提升攻击力，短时内每次攻击偷取目标攻速并获得部署费用。
- 效果1：12秒内攻击+80%/90%/110%/130%并获得隐匿。
  - trigger=自然技力满；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[0.8,0.9,1.1,1.3],"stealth":[1,1,1,1],"duration":[12,12,12,12]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次
- 效果2：每次攻击偷取目标7/8/9/10点攻速加于自身（最多60/65/70/80点，持续至技能结束或伊内丝离场），并获得1点部署费用。
  - trigger=技能持续期间攻击命中；target=被命中敌人；action=nativeMechanism；lifecycle=battle
  - values={"mechanism":"偷取攻速","stealAttackSpeed":[7,8,9,10],"maxSteal":[60,65,70,80],"costGain":[1,1,1,1]}；stacking=偷取攻速累加至上限，超过不再增加；limits=按命中次数结算

### 原生天赋计划
- 影织（`/char_4087_ines/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 对每个敌人首次造成伤害后使其束缚并偷取其攻击力，持续至目标被击倒或伊内丝离场。
  - scope=该敌人；parameters={"stealAtk":[50,70,90,110],"root":[3,4,5,5],"maxSteal":[10000,14000,18000,22000]}
- 影哨（`/char_4087_ines/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 攻击范围内敌人隐匿失效且移速-30%；撤退后留下影哨使效果持续生效（最多1个）。
  - scope=攻击范围内敌人与影哨范围；parameters={"slow":[-0.3,-0.32,-0.3,-0.35],"maxScouts":1}；trigger=范围内的对应事件；unlockStar=1

### 进击被动
- 被动0：首次伤害使目标束缚3/4/5/5秒并偷取其50/70/90/110攻击力（上限10000/14000/18000/22000），偷取持续至目标被击倒或伊内丝离场。
  - trigger=对某个敌人首次造成伤害；target=该敌人；action=applyStatus；lifecycle=battle
  - values={"root":[3,4,5,5],"stealAtk":[50,70,90,110],"maxSteal":[10000,14000,18000,22000]}；stacking=每个敌人只偷一次攻击力；limits=每敌人首次伤害一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：基准：攻击+80%、隐匿12秒、每次偷7攻速并回1费，技力24，初始15。
  - 被动：基准：首伤束缚3秒偷50攻；影哨减速30%最多1个。
- ★2（攻×1.55、生命×1.65）：攻击+90%、隐匿12秒、偷8攻速，技力20，初始15。
  - 被动：首伤束缚4秒偷70攻。
- ★3（攻×2.2、生命×2.6）：攻击+110%、隐匿12秒、偷9攻速，技力20，初始18。
  - 被动：首伤束缚5秒偷90攻。
- ★4（攻×3、生命×4）：攻击+130%、隐匿12秒、偷10攻速，技力24，初始18。
  - 被动：首伤束缚5秒偷110攻；影哨范围减速提升至35%且可同时存在1个。

### 模组
- 默认模组：uniequip_002_ines
- `uniequip_001_ines`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_ines`（ADVANCED/rewrite）：三星解锁：影织偷取攻击力翻倍，且被束缚目标受到的伤害+8%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4087_ines`
实现：复用情报官再部署KIT；技能瞬时隐匿+atk buff，命中偷攻速走nativeMechanism，首伤束缚与撤退影哨走事件。
因果检查：
- 影织对每个敌人只偷一次攻击力；重复命中同一敌人只刷新束缚时间不重复偷取。
- 影哨最多1个；撤退后旧影哨被回收，新撤退留下新影哨。

## 流明（`char_4042_lumen`）
- 职业：MEDIC；档位：5（8 金币）；路线：`healShield`
- 定位：解控医师，靠治疗附加抵抗与异常应激治疗保护队友。
- 档位理由：大范围解控加抵抗与应激治疗，异常应对核心，定八金币档。
- 设计理由：沛霖做成即时多目标治疗与解控，凡人之愿保留抵抗，应急处理改为受异常触发的限时治疗。

### 固定技能：沛霖（进击）
- 来源技能：`skchr_lumen_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[16,13,13,16]；初始技力：[5,5,8,8]
- 技力满立即治疗攻击范围内至多3名友方，并解除其异常状态。
- 效果1：治疗至多2/2/3/3名友方，治疗量攻击力200%/230%/260%/300%，并解除其受到的异常状态。
  - trigger=自然技力满；target=攻击范围内至多3名友方；action=heal；lifecycle=instant
  - values={"healScale":[2,2.3,2.6,3],"maxTargets":[2,2,3,3],"cleanse":[1,1,1,1]}；stacking=每目标一次；limits=每场战斗不限次数

### 原生天赋计划
- 凡人之愿（`/char_4042_lumen/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 治疗目标获得4秒抵抗，目标生命高于75%则改为6秒，保留触发式抵抗。
  - scope=被治疗目标；parameters={"resistSec":[2,3,4,5],"highHpResistSec":[4,5,6,7],"hpRatio":0.75}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 应急处理（`/char_4042_lumen/talents/1`）：mode=rewrite；runtimeBinding=modePassive:0
  - 攻击范围内友方受到异常状态时立即治疗目标，改为带12秒冷却的触发式急救援护。
  - scope=受异常的友方；parameters={"healScale":[0.8,0.9,1,1.1],"cooldown":12}

### 进击被动
- 被动0：该友方受到异常状态时立即治疗其攻击力80%/90%/100%/110%的生命；同一12秒冷却内只触发一次。
  - trigger=攻击范围内友方受到异常状态；target=该友方；action=heal；lifecycle=instant
  - values={"healScale":[0.8,0.9,1,1.1],"cooldown":[12,12,12,12]}；stacking=冷却内不重复触发；limits=每12秒最多一次；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：基准：治疗200%打2目标并解控，技力16，初始5。
  - 被动：基准：治疗附2/4秒抵抗；受异常触发80%治疗，冷却12秒。
- ★2（攻×1.55、生命×1.65）：治疗230%打2目标并解控，技力13，初始5。
  - 被动：治疗附3/5秒抵抗；应激治疗90%。
- ★3（攻×2.2、生命×2.6）：治疗260%打3目标并解控，技力13，初始8。
  - 被动：治疗附4/6秒抵抗；应激治疗100%。
- ★4（攻×3、生命×4）：治疗300%打3目标并解控，技力16，初始8。
  - 被动：治疗附5/7秒抵抗；应激治疗110%，应激治疗同时解除1个异常。

### 模组
- 默认模组：uniequip_002_lumen
- `uniequip_001_lumen`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_lumen`（ADVANCED/rewrite）：三星解锁：固定技能解控额外解除目标所有异常，且每次解控为流明回复2点技力，每场最多5次。；四星加强：本效果随角色四星身体放大，无额外模块机制。
- `uniequip_003_lumen`（ADVANCED/rewrite）：三星解锁：抵抗时间+2秒，且抵抗期间目标受到的伤害-8%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4042_lumen`
实现：复用大范围医疗KIT；技能瞬时多目标heal+cleanse，抵抗走applyStatus，应激治疗受异常事件触发带冷却。
因果检查：
- 一次治疗只施加一次抵抗；重复治疗刷新时长，抵抗不叠加。
- 应激治疗在冷却内不重复触发；免疫异常的目标不触发应激链。

## 纯烬艾雅法拉（`char_1016_agoat2`）
- 职业：MEDIC；档位：6（12 金币）；路线：`element`
- 定位：六星元素医疗，兼群体治疗、元素损伤回复与元素屏障。
- 档位理由：原生元素回复加群体屏障，是元素体系核心支点，定十二金币档。
- 设计理由：云霭荫佑做成即时群体治疗与元素屏障，氤氲改为普通治疗触发的可叠增益治疗。

### 固定技能：云霭荫佑（进击）
- 来源技能：`skchr_agoat2_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[18,20,22,24]；初始技力：0
- 技力满立即治疗攻击范围内所有友方，并生成持续一段时间的元素损伤屏障。
- 效果1：立即治疗范围内所有友方，治疗量为攻击力150%/180%/210%/250%。
  - trigger=自然技力满；target=攻击范围内所有友方；action=heal；lifecycle=instant
  - values={"healScale":[1.5,1.8,2.1,2.5]}；stacking=每次结算每目标一次；limits=每场战斗不限次数
- 效果2：为范围内友方生成持续14/16/18/20秒的元素损伤屏障，可吸收相当于攻击力650%/750%/900%/1100%的元素损伤。
  - trigger=同一结算；target=攻击范围内所有友方；action=addBuff；lifecycle=battle
  - values={"epBarrierScale":[6.5,7.5,9,11],"duration":[14,16,18,20]}；stacking=同名屏障取较强值不叠加；limits=每次结算施加一次

### 原生天赋计划
- 氤氲（`/char_1016_agoat2/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 普通治疗使目标持续获得小幅增益治疗与元素回复，改为技能治疗触发的可叠层增益，最多3层。
  - scope=被治疗目标；parameters={"regenScale":[0.08,0.09,0.1,0.12],"duration":[4,5,6,6],"maxStacks":3}
- 火山灰疗愈（`/char_1016_agoat2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 攻击范围内友方最大生命+6%且受到的元素损伤-12%，保留范围被动。
  - scope=攻击范围内友方；parameters={"maxHp":[0.04,0.05,0.06,0.07],"epDamageResistance":[0.08,0.1,0.12,0.14]}；trigger=自身受到相关事件时；unlockStar=1

### 进击被动
- 被动0：每次治疗使目标获得一层增益：每秒额外回复8%/9%/10%/12%治疗量与元素损伤，持续4/5/6/6秒，最多叠3层，重复施加成功即叠层。
  - trigger=自身普通治疗命中友方；target=被治疗目标；action=applyStatus；lifecycle=battle
  - values={"regenScale":[0.08,0.09,0.1,0.12],"duration":[4,5,6,6],"maxStacks":[3,3,3,3]}；stacking=同目标最多3层，独立计时；limits=每次治疗叠1层；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力18/初始0；范围治疗150%、元素屏障6.5倍攻击持续14秒。
  - 被动：基准：治疗叠增益8%，最多3层；范围内友方最大生命+4%、元素-8%。
- ★2（攻×1.55、生命×1.65）：技力20/初始0；范围治疗180%、屏障7.5倍持续16秒。
  - 被动：治疗叠增益9%；范围内生命+5%、元素-10%。
- ★3（攻×2.2、生命×2.6）：技力22/初始0；范围治疗210%、屏障9倍持续18秒。
  - 被动：治疗叠增益10%；范围内生命+6%、元素-12%。
- ★4（攻×3、生命×4）：技力24/初始0；范围治疗250%、屏障11倍持续20秒。
  - 被动：治疗叠增益12%；范围内生命+7%、元素-14%；增益叠满3层时目标额外获得5%减伤。

### 模组
- 默认模组：uniequip_002_agoat2
- `uniequip_001_agoat2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_agoat2`（ADVANCED/rewrite）：三星解锁：氤氲层数上限+1；四星加强：每层额外+2%治疗量，增益叠满时元素屏障同步刷新。
- `uniequip_003_agoat2`（ADVANCED/rewrite）：三星解锁：元素屏障值+20%；四星加强：屏障破碎时回复该友方最大生命8%，每目标每场一次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1016_agoat2`
实现：复用元素医疗KIT；固定技能瞬时全范围heal+epBarrier，氤氲为治疗事件驱动的可叠层增益，火山灰为范围常驻。
因果检查：
- 一次治疗只为目标叠1层氤氲；同一次技能治疗多名目标各自独立叠层。
- 元素屏障只吸收元素损伤；同名刷新取较强值，不累加屏障数值。

## 焰影苇草（`char_1020_reed2`）
- 职业：MEDIC；档位：5（8 金币）；路线：`element`
- 定位：咒愈师，靠灼痕削弱敌人并借火球友方持续输出与治疗。
- 档位理由：灼痕法术脆弱加火球持续输出，攻守兼备，定八金币档。
- 设计理由：枯荣共息做成即时附加具名火球状态，灼痕保留为造成伤害触发的概率减益。

### 固定技能：枯荣共息（进击）
- 来源技能：`skchr_reed2_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[20,22,25,27]；初始技力：[12,15,18,18]
- 技力满立即为攻击范围内至多2名地面友方附加具名状态「火种」，每1.5秒对一名敌人造成法术伤害并仅对该友方触发焰影苇草特性治疗。
- 效果1：为目标附加具名状态「火种」20秒：每1.5秒对一名敌人造成焰影苇草攻击力190%/200%/220%/240%的法术伤害，并仅对该友方触发咒愈师特性治疗。
  - trigger=自然技力满；target=攻击范围内至多2名地面友方；action=nativeMechanism；lifecycle=battle
  - values={"mechanism":"火种","maxTargets":[2,2,2,2],"interval":[1.5,1.5,1.5,1.5],"atkScale":[1.9,2,2.2,2.4],"duration":[20,20,20,20]}；stacking=同一友方同时只保留一层火种；limits=每场战斗不限次数，最多2名目标

### 原生天赋计划
- 灼痕（`/char_1020_reed2/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 造成伤害时30%概率对敌人施加灼痕：攻击-20%、法术脆弱30%，不可叠加持续6秒，保留触发式。
  - scope=被伤害敌人；parameters={"prob":[0.3,0.3,0.3,0.3],"atkDown":[-0.1,-0.15,-0.2,-0.24],"magicFragile":[0.15,0.2,0.3,0.34],"duration":6}
- 映耀（`/char_1020_reed2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 治疗其他友方单位时，焰影苇草同时享受50%的治疗量，保留触发式。
  - scope=自身；parameters={"selfHealScale":[0.4,0.45,0.5,0.55]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：每次造成伤害30%概率施加灼痕：攻击-10%/15%/20%/24%、法术脆弱15%/20%/30%/34%，持续6秒；重复施加刷新时间但不可叠加。
  - trigger=自身造成伤害；target=被伤害敌人；action=applyStatus；lifecycle=battle
  - values={"prob":[0.3,0.3,0.3,0.3],"atkDown":[-0.1,-0.15,-0.2,-0.24],"magicFragile":[0.15,0.2,0.3,0.34],"duration":[6,6,6,6]}；stacking=同名不可叠加，取较强值；limits=每次伤害事件判定一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力20/初始12；火种190%法伤、间隔1.5秒、持续20秒、最多2目标。
  - 被动：基准：30%概率灼痕攻击-10%法脆15%；自身享受40%治疗。
- ★2（攻×1.55、生命×1.65）：技力22/初始15；火种200%法伤。
  - 被动：灼痕攻击-15%法脆20%；自身享受45%治疗。
- ★3（攻×2.2、生命×2.6）：技力25/初始18；火种220%法伤。
  - 被动：灼痕攻击-20%法脆30%；自身享受50%治疗。
- ★4（攻×3、生命×4）：技力27/初始18；火种240%法伤。
  - 被动：灼痕攻击-24%法脆34%；自身享受55%治疗；火种目标攻击+10%。

### 模组
- 默认模组：uniequip_002_reed2
- `uniequip_001_reed2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_reed2`（ADVANCED/rewrite）：三星解锁：灼痕概率提升至50%；四星加强：灼痕额外使目标受到的法术伤害+5%。
- `uniequip_003_reed2`（ADVANCED/rewrite）：三星解锁：火种可附加3名友方；四星加强：火种造成伤害时50%概率也施加灼痕。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1020_reed2`
实现：复用咒愈师KIT；固定技能瞬时施加具名火种状态并驱动周期damage与特性治疗，灼痕走伤害事件概率减益。
因果检查：
- 火种每1.5秒只对一名敌人结算一次伤害；同一友方重复获得火种只刷新时间。
- 灼痕不可叠加，重复施加取较强值；灼痕敌人被击倒后其火种继续独立结算。

## 缇缇（`char_4056_titi`）
- 职业：MEDIC；档位：5（8 金币）；路线：`skillCycle`
- 定位：睡眠控制型咒愈师，靠沉睡与沉睡增伤压制敌人。
- 档位理由：睡眠控制兼对沉睡目标高额法伤，控场独特，定八金币档。
- 设计理由：缓蚀做成即时法术伤害与概率沉睡，凝固的时光保留为对沉睡目标的持续法伤。

### 固定技能：缓蚀（进击）
- 来源技能：`skchr_titi_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[30,35,40,46]；初始技力：[12,15,18,18]
- 技力满立即对攻击范围内敌人造成法术伤害，并有概率使其沉睡。
- 效果1：对攻击范围内敌人造成攻击力80%/90%/100%/110%的法术伤害。
  - trigger=自然技力满；target=攻击范围内敌人；action=damage；lifecycle=instant
  - values={"atkScale":[0.8,0.9,1,1.1]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：每次命中40%/45%/50%/50%概率使目标沉睡2.4/2.6/3/3秒；重复施加成功即计数。
  - trigger=同一结算；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"prob":[0.4,0.45,0.5,0.5],"sleep":[2.4,2.6,3,3]}；stacking=睡眠同名刷新取较长剩余时间；limits=每次命中判定一次

### 原生天赋计划
- 凝固的时光（`/char_4056_titi/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 自身可攻击沉睡敌人，攻击非移动敌人额外造成攻击力比例法伤；在场时沉睡中的敌人每秒受到缇缇攻击力比例法伤。
  - scope=被攻击/沉睡中的敌人；parameters={"extraAtkScale":[0.1,0.12,0.15,0.18],"sleepDotScale":[0.18,0.22,0.3,0.35]}
- 勇气的报偿（`/char_4056_titi/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 场上的米诺斯或萨尔贡干员生命值高于50%时获得+20攻速的精力充沛。
  - scope=场上米诺斯/萨尔贡干员；parameters={"attackSpeed":[12,16,20,24],"hpRatio":0.5}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：每个沉睡中的敌人每秒受到缇缇攻击力18%/22%/30%/35%的法术伤害；同一敌人每秒只结算一次，重复施加睡眠不叠伤害。
  - trigger=场上敌人处于沉睡状态；target=沉睡中的敌人；action=damage；lifecycle=battle
  - values={"dotScale":[0.18,0.22,0.3,0.35],"interval":[1,1,1,1]}；stacking=同目标每秒一次；limits=每秒结算一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力30/初始12；80%法伤、40%概率沉睡2.4秒。
  - 被动：基准：非移动额外+10%法伤、沉睡每秒18%；精力充沛+12攻速。
- ★2（攻×1.55、生命×1.65）：技力35/初始15；90%法伤、45%概率沉睡2.6秒。
  - 被动：非移动+12%、沉睡每秒22%；精力充沛+16攻速。
- ★3（攻×2.2、生命×2.6）：技力40/初始18；100%法伤、50%概率沉睡3秒。
  - 被动：非移动+15%、沉睡每秒30%；精力充沛+20攻速。
- ★4（攻×3、生命×4）：技力46/初始18；110%法伤、50%概率沉睡3秒。
  - 被动：非移动+18%、沉睡每秒35%；精力充沛+24攻速；沉睡敌人醒来时额外受到一次法伤。

### 模组
- 默认模组：uniequip_002_titi
- `uniequip_001_titi`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_titi`（ADVANCED/rewrite）：三星解锁：睡眠概率+15%；四星加强：沉睡敌人受到缇缇的伤害+15%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4056_titi`
实现：复用咒愈师KIT；技能瞬时damage+概率sleep，沉睡持续伤害走每秒事件，精力充沛为阵营条件buff。
因果检查：
- 睡眠重复施加按成功施加计数并刷新时间；免疫睡眠目标不计入。
- 沉睡每秒伤害同一敌人只结算一次；敌人醒来后停止，再次沉睡重新开始。

## Mon3tr（`char_4179_monstr`）
- 职业：MEDIC；档位：6（12 金币）；路线：`summon`
- 定位：链愈师，靠具名重构体与治疗协同构成持续输出与支援。
- 档位理由：召唤重构体并借治疗协同提升攻速，机制独特，定十二金币档。
- 设计理由：超压链接做成即时链式治疗并增加跳跃，重构体与战术协同保留为天赋召唤与触发增益。

### 固定技能：策略：超压链接（进击）
- 来源技能：`skchr_monstr_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[3,3,4,4]；初始技力：0
- 技力满立即进行一次链式治疗，治疗量提升并增加一次跳跃。
- 效果1：立即治疗并在至多4/4/5/5个友方间跳跃，主目标治疗量为攻击力170%/185%/200%/220%，每次跳跃衰减25%。
  - trigger=自然技力满；target=攻击范围内友方；action=heal；lifecycle=instant
  - values={"healScale":[1.7,1.85,2,2.2],"chainJumps":[4,4,5,5]}；stacking=每目标一次；limits=每场战斗不限次数

### 原生天赋计划
- 自我修复（`/char_4179_monstr/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 可在攻击范围内地面使用一个仅可被自身治疗的重构体，重构体周围友方攻击力+15%；重构体受自身与Mon3tr治疗时可额外进行一次不衰减跳跃。
  - scope=重构体与周围友方；parameters={"alliesAtk":[0.03,0.05,0.1,0.15],"maxTokens":1}；trigger=范围内的对应事件；unlockStar=1
- 战术协同（`/char_4179_monstr/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 自身或重构体造成治疗时使目标及自身攻速+20，持续10秒，无法叠加。
  - scope=被治疗目标与自身；parameters={"attackSpeed":[10,14,20,24],"duration":10}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：在攻击范围内地面放置具名「重构体」，仅可被自身与Mon3tr治疗；重构体周围友方攻击力+3%/5%/10%/15%。
  - trigger=部署时；target=攻击范围内地面；action=summon；lifecycle=battle
  - values={"deviceId":"monstr_reconstruction","count":[1,1,1,1],"onlySelfHeal":[1,1,1,1],"alliesAtk":[0.03,0.05,0.1,0.15]}；stacking=重构体唯一；limits=每场战斗常驻1个

### 星级
- ★1（攻×1、生命×1）：技力3/初始0；链疗170%跳4次，衰减25%。
  - 被动：基准：重构体周围攻击+3%；治疗协攻速+10持续10秒。
- ★2（攻×1.55、生命×1.65）：技力3/初始0；链疗185%跳4次。
  - 被动：重构体周围攻击+5%；协攻速+14。
- ★3（攻×2.2、生命×2.6）：技力4/初始0；链疗200%跳5次。
  - 被动：重构体周围攻击+10%；协攻速+20。
- ★4（攻×3、生命×4）：技力4/初始0；链疗220%跳5次。
  - 被动：重构体周围攻击+15%；协攻速+24；重构体受治疗时额外跳跃不衰减。

### 模组
- 默认模组：uniequip_002_monstr
- `uniequip_001_monstr`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_monstr`（ADVANCED/rewrite）：三星解锁：重构体周围友方攻击+5%；四星加强：重构体退场时，治疗其周围八邻（切比雪夫距离1，半径1）内至多3名友方，治疗量为Mon3tr攻击力120%，每目标一次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4179_monstr`
实现：新增具名重构体monstr_reconstruction与仅自愈限制；技能瞬时链式heal，战术协同走治疗事件。
因果检查：
- 重构体只接受自身与Mon3tr治疗，友方治疗对其无效；重构体唯一。
- 战术协同每次治疗施加一次攻速，10秒内重复治疗刷新时间不叠加。

## 星熊（`char_136_hsguma`）
- 职业：TANK；档位：5（8 金币）；路线：`blockCounter`
- 定位：六星重装，靠伤害抵挡与受击反击站场并以力之锯清前排。
- 档位理由：原生25%伤害抵挡加反击，坦度与输出兼具，定八金币档。
- 设计理由：力之锯做成即时前排切割与攻防提升，荆棘反击与战术装甲保留为受击触发被动。

### 固定技能：力之锯（进击）
- 来源技能：`skchr_hsguma_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[30,34,38,42]；初始技力：[18,20,25,30]
- 技力满立即对前方一格所有敌人造成物理伤害，并短时提升自身攻击与防御。
- 效果1：对前方一格所有敌人造成攻击力140%/160%/180%/200%的物理伤害。
  - trigger=自然技力满；target=前方一格所有敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.4,1.6,1.8,2]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：攻击+40%/50%/60%/70%、防御+70%/80%/90%/100%，持续20/22/25/25秒。
  - trigger=同一结算；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[0.4,0.5,0.6,0.7],"def":[0.7,0.8,0.9,1],"duration":[20,22,25,25]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 战术装甲（`/char_136_hsguma/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 获得伤害抵挡，保留并按星级提升。
  - scope=自身；parameters={"damageBlock":[0.12,0.16,0.25,0.3]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 特种作战策略（`/char_136_hsguma/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 在场时所有友方重装干员防御力+6%，保留职业被动。
  - scope=全体重装干员；parameters={"def":[0.04,0.05,0.06,0.07]}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：每次受到攻击对攻击者造成星熊攻击力80%/90%/100%/110%的物理伤害（荆棘）。
  - trigger=自身受到攻击；target=攻击者；action=damage；lifecycle=instant
  - values={"atkScale":[0.8,0.9,1,1.1]}；stacking=每次受击一次；limits=每次受击结算一次

### 星级
- ★1（攻×1、生命×1）：技力30/初始18；前方140%物理、攻+40%防+70%持续20秒。
  - 被动：基准：抵挡12%；重装防御+4%；受击反击80%。
- ★2（攻×1.55、生命×1.65）：技力34/初始20；前方160%、攻+50%防+80%持续22秒。
  - 被动：抵挡16%；重装防御+5%；反击90%。
- ★3（攻×2.2、生命×2.6）：技力38/初始25；前方180%、攻+60%防+90%持续25秒。
  - 被动：抵挡25%；重装防御+6%；反击100%。
- ★4（攻×3、生命×4）：技力42/初始30；前方200%、攻+70%防+100%持续25秒。
  - 被动：抵挡30%；重装防御+7%；反击110%；力之锯期间反击必定触发。

### 模组
- 默认模组：uniequip_002_hsguma
- `uniequip_001_hsguma`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_hsguma`（ADVANCED/rewrite）：三星解锁：抵挡+5%；四星加强：成功抵挡时回复1点技力，每3秒最多一次。
- `uniequip_003_hsguma`（ADVANCED/rewrite）：三星解锁：荆棘反击范围+1格；四星加强：反击对护甲目标伤害提升20%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_136_hsguma`
实现：复用重装KIT；技能瞬时前方damage+自身atk/def buff，荆棘受击反击，战术装甲为抵挡乘区。
因果检查：
- 受击反击每次事件只结算一次；同帧多段攻击各自独立反伤。
- 伤害抵挡先于反击结算，被完全抵挡仍触发反击。

## 塞雷娅（`char_202_demkni`）
- 职业：TANK；档位：6（12 金币）；路线：`healShield`
- 定位：六星守护者，靠范围群体治疗与回技力支援全队。
- 档位理由：原生治疗回技力与法术增伤，团队核心，定十二金币档。
- 设计理由：药物配置做成即时范围群疗，莱茵充能护服改为限时叠层，精神回复保留为治疗回技力。

### 固定技能：药物配置（进击）
- 来源技能：`skchr_demkni_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[6,7,7,8]；初始技力：0
- 技力满立即治疗附近一定范围内的所有友方。
- 效果1：治疗附近范围内所有友方，治疗量为攻击力110%/125%/140%/160%。
  - trigger=自然技力满；target=附近一定范围内所有友方；action=heal；lifecycle=instant
  - values={"healScale":[1.1,1.25,1.4,1.6]}；stacking=每次结算每目标一次；limits=每场战斗不限次数

### 原生天赋计划
- 莱茵充能护服（`/char_202_demkni/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 由常驻每20秒叠加攻击防御，改为在场时间触发的可叠层增益，最多5层。
  - scope=自身；parameters={"atk":[0.02,0.035,0.05,0.06],"def":[0.02,0.03,0.04,0.05],"interval":20,"maxStacks":5}；trigger=被动常驻；unlockStar=1
- 精神回复（`/char_202_demkni/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 每次回复友方单位生命值时额外回复该单位1点技力，保留触发式。
  - scope=被治疗友方；parameters={"spGain":[1,1,1,1]}

### 进击被动
- 被动0：每次回复友方生命值时，为该友方额外回复1点技力；同一次治疗每目标只回1点。
  - trigger=自身完成一次治疗；target=被治疗友方；action=spGain；lifecycle=instant
  - values={"spGain":[1,1,1,1]}；stacking=每治疗事件每目标一次；limits=每次治疗结算一次；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：技力6/初始0；范围治疗110%。
  - 被动：基准：每20秒攻击+2%防御+2%至多5层；治疗回1技力。
- ★2（攻×1.55、生命×1.65）：技力7/初始0；范围治疗125%。
  - 被动：每20秒攻击+3.5%防御+3%；治疗回1技力。
- ★3（攻×2.2、生命×2.6）：技力7/初始0；范围治疗140%。
  - 被动：每20秒攻击+5%防御+4%；治疗回1技力。
- ★4（攻×3、生命×4）：技力8/初始0；范围治疗160%。
  - 被动：每15秒攻击+6%防御+5%至多5层；治疗回1技力，叠满时治疗量额外+10%。

### 模组
- 默认模组：uniequip_002_demkni
- `uniequip_001_demkni`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_demkni`（ADVANCED/rewrite）：三星解锁：范围治疗范围+1格；四星加强：治疗同时使目标获得3秒抵抗。
- `uniequip_003_demkni`（ADVANCED/rewrite）：三星解锁：莱茵护服每层防御+1%；四星加强：叠满时全体友方防御+10%持续10秒。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_202_demkni`
实现：复用守护者治疗KIT；技能瞬时范围heal，精神回复走治疗事件回技力，莱茵护服为限时叠层。
因果检查：
- 一次治疗每目标只回1点技力；范围治疗命中多名友方各自独立回技力。
- 莱茵护服层数按在场时间叠加，最多5层；再部署后重新计时但不清空已叠层。

## 瑕光（`char_423_blemsh`）
- 职业：TANK；档位：5（8 金币）；路线：`healShield`
- 定位：守护者，靠攻击附带治疗与对沉睡目标的高额打击。
- 档位理由：原生可强攻沉睡目标并辅以治疗，攻守兼备，定八金币档。
- 设计理由：光芒涌动做成即时伤害加周围治疗，仁慈保留为攻击沉睡目标的触发增伤。

### 固定技能：光芒涌动（进击）
- 来源技能：`skchr_blemsh_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[4,4,5,5]；初始技力：0
- 技力满立即对当前目标造成物理伤害，并治疗周围一名友方。
- 效果1：对当前目标造成攻击力220%/240%/260%/280%的物理伤害。
  - trigger=自然技力满；target=当前攻击目标；action=damage；lifecycle=instant
  - values={"atkScale":[2.2,2.4,2.6,2.8]}；stacking=每次结算一次；limits=每场战斗不限次数
- 效果2：治疗周围一名友方，治疗量为攻击力120%/130%/150%/170%。
  - trigger=同一结算；target=周围一名友方；action=heal；lifecycle=instant
  - values={"healScale":[1.2,1.3,1.5,1.7]}；stacking=每次结算一次；limits=每次结算治疗一名友方

### 原生天赋计划
- 剑盾骑士（`/char_423_blemsh/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 在场时所有受击回复的技能在干员攻击时也回复1点技力，保留职业联动。
  - scope=全体友方；parameters={"spGain":[1,1,1,1]}；trigger=普通攻击时；unlockStar=1
- 仁慈（`/char_423_blemsh/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 自身可攻击并优先攻击沉睡目标且攻击力提升，保留触发式。
  - scope=沉睡中的敌人；parameters={"atkScale":[1.2,1.3,1.4,1.5]}

### 进击被动
- 被动0：对沉睡目标攻击力提升至120%/130%/140%/150%，并优先选择沉睡目标。
  - trigger=自身攻击命中处于沉睡的目标；target=被命中敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.2,1.3,1.4,1.5]}；stacking=每次命中一次；limits=无额外次数限制；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：技力4/初始0；220%物理并治疗周围一名友方120%。
  - 被动：基准：攻击可回受击回复技能1技力；对沉睡目标攻击×1.2。
- ★2（攻×1.55、生命×1.65）：技力4/初始0；240%物理、治疗130%。
  - 被动：对沉睡目标×1.3。
- ★3（攻×2.2、生命×2.6）：技力5/初始0；260%物理、治疗150%。
  - 被动：对沉睡目标×1.4。
- ★4（攻×3、生命×4）：技力5/初始0；280%物理、治疗170%。
  - 被动：对沉睡目标×1.5；光芒涌动命中沉睡目标时治疗量翻倍。

### 模组
- 默认模组：uniequip_002_blemsh
- `uniequip_001_blemsh`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_blemsh`（ADVANCED/rewrite）：三星解锁：光芒涌动治疗目标+1；四星加强：对沉睡目标治疗量+30%。
- `uniequip_003_blemsh`（ADVANCED/rewrite）：三星解锁：攻击沉睡目标回复1点技力；四星加强：光芒涌动伤害+15%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_423_blemsh`
实现：复用守护者KIT；技能瞬时damage+heal，仁慈为沉睡目标判定增伤，剑盾骑士为受击回复技能联动。
因果检查：
- 对沉睡目标只结算一次增伤；目标醒来后下一次攻击按基准结算。
- 一次技能只治疗一名友方；治疗目标与伤害目标可不同。

## 黍（`char_2025_shu`）
- 职业：TANK；档位：6（12 金币）；路线：`summon`
- 定位：六星守护者，靠播种地块持续回复与庇护构建阵地。
- 档位理由：原生播种地块改变地面规则并兼顾治疗，定十二金币档。
- 设计理由：嘉禾盈仓做成即时治疗并播种具名地块，百谷长青保留为治疗播种，天有四时保留为编队被动。

### 固定技能：嘉禾盈仓（进击）
- 来源技能：`skchr_shu_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[18,20,22,25]；初始技力：[15,18,20,20]
- 技力满立即治疗攻击范围内至多2名友方，并在其周围四格播种地块，为地块上友方提供持续回复与庇护。
- 效果1：治疗至多2名友方，治疗量为攻击力150%/170%/190%/220%。
  - trigger=自然技力满；target=攻击范围内至多2名友方；action=heal；lifecycle=instant
  - values={"healScale":[1.5,1.7,1.9,2.2],"maxTargets":[2,2,2,2]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：在目标及其周围四格播种具名地块「百谷」，持续12/14/16/18秒，地块上友方每秒回复70/90/110/130生命并获得10%/12%/15%/18%庇护。
  - trigger=同一结算；target=被治疗友方及其周围四格；action=device；lifecycle=battle
  - values={"deviceId":"shu_seed_plot","hpPerSec":[70,90,110,130],"protect":[0.1,0.12,0.15,0.18],"duration":[12,14,16,18]}；stacking=同名地块覆盖刷新，不叠加；limits=每次结算播种一次

### 原生天赋计划
- 百谷长青（`/char_2025_shu/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 治疗干员时对其与周围四格播种：每秒恢复生命并获得庇护，改为治疗触发的具名地块。
  - scope=被治疗友方及其周围四格；parameters={"hpPerSec":[40,55,70,85],"protect":[0.05,0.08,0.1,0.12]}
- 天有四时（`/char_2025_shu/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 场上三名不同职业干员时全队生命+12%，三名相同职业时全队攻速+12，编队四名岁干员时全队攻击+12%且4秒获得1技力；保留原生编队条件。
  - scope=全队，按原生编队条件；parameters={"maxHp":[0.06,0.08,0.12,0.14],"attackSpeed":[6,8,12,15],"atk":[0.06,0.08,0.12,0.15],"spInterval":4}；trigger=技能/技力事件时；unlockStar=1

### 进击被动
- 被动0：每次治疗在目标及其周围四格播种「百谷」地块10/12/14/16秒：地块上友方每秒回复40/55/70/85生命并获得5%/8%/10%/12%庇护；同名地块覆盖刷新。
  - trigger=自身治疗友方干员；target=被治疗友方及其周围四格；action=device；lifecycle=battle
  - values={"deviceId":"shu_seed_plot","hpPerSec":[40,55,70,85],"protect":[0.05,0.08,0.1,0.12],"duration":[10,12,14,16]}；stacking=同名地块覆盖不叠加；limits=每次治疗播种一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力18/初始15；治疗150%两名、播种地块每秒70生命与10%庇护持续12秒。
  - 被动：基准：治疗播种每秒40生命5%庇护；天有四时生命+6%攻速+6攻击+6%。
- ★2（攻×1.55、生命×1.65）：技力20/初始18；治疗170%、地块90生命12%庇护持续14秒。
  - 被动：治疗播种55生命8%庇护；天有四时+8%/+8/+8%。
- ★3（攻×2.2、生命×2.6）：技力22/初始20；治疗190%、地块110生命15%庇护持续16秒。
  - 被动：治疗播种70生命10%庇护；天有四时+12%/+12/+12%。
- ★4（攻×3、生命×4）：技力25/初始20；治疗220%、地块130生命18%庇护持续18秒。
  - 被动：治疗播种85生命12%庇护；天有四时+14%/+15/+15%，地块上敌人每秒受到黍攻击力30%的法术伤害。

### 模组
- 默认模组：uniequip_002_shu
- `uniequip_001_shu`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_shu`（ADVANCED/rewrite）：三星解锁：地块持续时间+4秒；四星加强：地块庇护+5%，且地块上友方攻击+8%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_2025_shu`
实现：新增具名地块装置shu_seed_plot与地面范围效果；技能瞬时heal+播种，百谷长青走治疗事件，天有四时为编队条件被动。
因果检查：
- 同名地块覆盖刷新，不叠加每秒回复；治疗每目标只种一块。
- 天有四时按场上职业数与编队岁数分别判定，条件不满足时对应增益失效，不残留。

## 泥岩（`char_311_mudrok`）
- 职业：TANK；档位：5（8 金币）；路线：`blockCounter`
- 定位：绝食重装，靠护盾层与岩崩锤自愈和群体控制抗线。
- 档位理由：原生护盾层加自愈与群控，绝食体系支点，定八金币档。
- 设计理由：岩崩锤做成即时自愈与范围物理控制，沃土予身保留为护盾层，手足相惜保留为萨卡兹减伤。

### 固定技能：岩崩锤（进击）
- 来源技能：`skchr_mudrok_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[4,4,5,5]；初始技力：0
- 技力满立即回复自身最大生命，对周围所有地面敌人造成物理伤害并有概率晕眩。
- 效果1：回复自身最大生命5%/5.5%/6%/7%。
  - trigger=自然技力满；target=自身；action=heal；lifecycle=instant
  - values={"maxHpRatio":[0.05,0.055,0.06,0.07]}；stacking=每次结算一次；limits=每场战斗不限次数
- 效果2：对周围地面敌人造成攻击力210%/240%/270%/300%的物理伤害，30%概率晕眩0.6/0.9/1.2/1.4秒。
  - trigger=同一结算；target=周围所有地面敌人；action=damage；lifecycle=instant
  - values={"atkScale":[2.1,2.4,2.7,3],"stunProb":[0.3,0.3,0.3,0.3],"stun":[0.6,0.9,1.2,1.4]}；stacking=每目标每段判定一次；limits=无额外次数限制

### 原生天赋计划
- 沃土予身（`/char_311_mudrok/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 每9秒获得1层护盾，最多3层，部署后立即获得1层；每层护盾破裂时回复自身20%最大生命。
  - scope=自身；parameters={"interval":9,"maxShields":[2,2,3,3],"breakHeal":[0.15,0.2,0.2,0.25]}；trigger=部署/再部署后；unlockStar=1
- 手足相惜（`/char_311_mudrok/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 受到来自萨卡兹敌人的伤害降低30%，保留来源减伤。
  - scope=自身；parameters={"sarkazDamageResistance":[0.2,0.25,0.3,0.35]}

### 进击被动
- 被动0：每层护盾破裂时回复自身最大生命15%/20%/20%/25%；同一次受击最多破裂一层并按一次回复。
  - trigger=自身一层护盾破裂；target=自身；action=heal；lifecycle=instant
  - values={"maxHpRatio":[0.15,0.2,0.2,0.25]}；stacking=每层破裂一次；limits=每层护盾一次；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：技力4/初始0；自愈5%最大生命、周围210%物理、30%概率晕眩0.6秒。
  - 被动：基准：每9秒1盾至多2层，破盾回15%生命；萨卡兹伤害-20%。
- ★2（攻×1.55、生命×1.65）：技力4/初始0；自愈5.5%、240%物理、晕眩0.9秒。
  - 被动：每9秒1盾至多2层，破盾回20%；萨卡兹-25%。
- ★3（攻×2.2、生命×2.6）：技力5/初始0；自愈6%、270%物理、晕眩1.2秒。
  - 被动：每9秒1盾至多3层，破盾回20%；萨卡兹-30%。
- ★4（攻×3、生命×4）：技力5/初始0；自愈7%、300%物理、晕眩1.4秒。
  - 被动：每9秒1盾至多3层，破盾回25%；萨卡兹-35%；护盾存在时防御+20%。

### 模组
- 默认模组：uniequip_002_mudrok
- `uniequip_001_mudrok`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_mudrok`（ADVANCED/rewrite）：三星解锁：护盾层上限+1；四星加强：破盾回复提升至30%最大生命。
- `uniequip_003_mudrok`（ADVANCED/rewrite）：三星解锁：岩崩锤晕眩概率+10%；四星加强：岩崩锤命中3名以上敌人时返还2点技力。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_311_mudrok`
实现：复用绝食重装KIT；技能瞬时heal+范围damage/prob stun，沃土予身护盾层与破盾回复，萨卡兹减伤读敌人tag。
因果检查：
- 一次受击最多破裂一层护盾并只回复一次；护盾未破时不回复。
- 晕眩按成功施加计数；免疫晕眩目标不计入但仍结算伤害。

## 斥罪（`char_4065_judge`）
- 职业：TANK；档位：5（8 金币）；路线：`blockCounter`
- 定位：绝食重装，靠屏障积累与荆棘反击持续消耗。
- 档位理由：原生屏障堆叠加反击，续航突出，定八金币档。
- 设计理由：一锤定音做成即时额外法术伤害与强化晕眩，律法卫士与荆棘环身保留屏障与反击。

### 固定技能：一锤定音（进击）
- 来源技能：`skchr_judge_1`（index 0）；类型：instant；自然回复：1/秒
- 技力：[3,3,3,4]；初始技力：0
- 技力满立即对当前目标额外造成法术伤害，且使目标晕眩。
- 效果1：额外造成攻击力180%/190%/200%/220%的法术伤害。
  - trigger=自然技力满；target=当前攻击目标；action=damage；lifecycle=instant
  - values={"atkScale":[1.8,1.9,2,2.2]}；stacking=每次结算一次；limits=每场战斗不限次数
- 效果2：使目标晕眩3/3/4/5秒。
  - trigger=同一结算；target=被命中目标；action=applyStatus；lifecycle=battle
  - values={"stun":[3,3,4,5]}；stacking=重复晕眩成功即计数；limits=每次结算施加一次

### 原生天赋计划
- 律法卫士（`/char_4065_judge/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 部署后立即获得相当于生命上限50%的屏障，每击倒一名敌人获得10%生命上限屏障，最多不超过生命上限300%。
  - scope=自身；parameters={"bornBarrier":[0.3,0.4,0.5,0.55],"killBarrier":[0.06,0.08,0.1,0.12],"maxBarrier":3}；trigger=部署/再部署后；unlockStar=1
- 荆棘环身（`/char_4065_judge/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 拥有来源于自身的屏障时，每次受到攻击对目标造成相当于斥罪攻击力50%的法术伤害。
  - scope=攻击者；parameters={"counterScale":[0.4,0.45,0.5,0.55]}

### 进击被动
- 被动0：拥有自身屏障时，每次受到攻击对攻击者造成攻击力40%/45%/50%/55%的法术伤害；无屏障时不触发。
  - trigger=自身拥有自身来源的屏障时受到攻击；target=攻击者；action=damage；lifecycle=instant
  - values={"counterScale":[0.4,0.45,0.5,0.55]}；stacking=每次受击一次；limits=每次受击结算一次；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：技力3/初始0；180%法术并晕眩3秒。
  - 被动：基准：部署屏障30%生命、击杀屏障6%上限300%；有屏障反击40%。
- ★2（攻×1.55、生命×1.65）：技力3/初始0；190%法术并晕眩3秒。
  - 被动：部署屏障40%、击杀屏障8%；反击45%。
- ★3（攻×2.2、生命×2.6）：技力3/初始0；200%法术并晕眩4秒。
  - 被动：部署屏障50%、击杀屏障10%；反击50%。
- ★4（攻×3、生命×4）：技力4/初始0；220%法术并晕眩5秒。
  - 被动：部署屏障55%、击杀屏障12%；反击55%；屏障存在时防御+15%。

### 模组
- 默认模组：uniequip_002_judge
- `uniequip_001_judge`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_judge`（ADVANCED/rewrite）：三星解锁：反击伤害+20%；四星加强：反击命中回复斥罪最大生命2%。
- `uniequip_003_judge`（ADVANCED/rewrite）：三星解锁：部署屏障+10%生命上限；四星加强：屏障上限提升至400%生命上限。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4065_judge`
实现：复用绝食重装KIT；技能瞬时damage+stun，律法卫士屏障堆叠，荆棘环身受击反击，屏障来源需可追溯。
因果检查：
- 只有来源于自身的屏障才触发反击；外部护盾不给斥罪反击。
- 屏障上限300%/400%封顶，击杀获得量超出部分丢弃。

## 森蚺（`char_416_zumama`）
- 职业：TANK；档位：5（8 金币）；路线：`blockCounter`
- 定位：决斗重装，靠阻挡充能与高额攻防正面压制。
- 档位理由：原生阻挡充能与高额攻防爆发，正面对抗强，定八金币档。
- 设计理由：震慑劈砍做成即时高倍物理与持续晕眩，勇冠三军与愈战愈勇保留为血线触发和阻挡充能。

### 固定技能：震慑劈砍（进击）
- 来源技能：`skchr_zumama_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[24,26,28,30]；初始技力：[10,12,15,18]
- 技力满立即对阻挡的敌人造成高倍物理伤害并晕眩；自身自然回技力固定1/秒，阻挡只额外提供回复。
- 效果1：对阻挡的敌人造成攻击力130%/150%/180%/200%的物理伤害。
  - trigger=自然技力满；target=阻挡的敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.3,1.5,1.8,2]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：使阻挡的敌人晕眩2/2.5/3/3.5秒。
  - trigger=同一结算；target=阻挡的敌人；action=applyStatus；lifecycle=battle
  - values={"stun":[2,2.5,3,3.5]}；stacking=重复晕眩成功即计数；limits=每次结算施加一次

### 原生天赋计划
- 勇冠三军（`/char_416_zumama/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 生命值高于一半时攻击造成115%伤害；不高于一半时获得20%庇护。
  - scope=自身；parameters={"highHpAtkScale":[1.08,1.1,1.15,1.2],"lowHpProtect":[0.1,0.15,0.2,0.25],"hpRatio":0.5}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 愈战愈勇（`/char_416_zumama/talents/1`）：mode=rewrite；runtimeBinding=modePassive:0
  - 愈战愈勇由 modePassive[0] 单份承接：阻挡时额外回复0.15/0.18/0.2/0.25技力/秒；原生天赋不另行运行，避免同加成双份结算。未阻挡时不获得此额外回复，而非停止自然回复。
  - scope=自身；parameters={"spPerSec":[0.15,0.18,0.2,0.25]}

### 进击被动
- 被动0：阻挡敌人时每秒额外获得0.15/0.18/0.2/0.25点技力；未阻挡时只是不获得这份额外回复，自然回技力仍固定为1/秒。
  - trigger=自身阻挡敌人时每秒；target=自身；action=spGain；lifecycle=battle
  - values={"spPerSec":[0.15,0.18,0.2,0.25]}；stacking=每秒一次；与自然回技力分别入账，不叠成第二份自然回复。；limits=每秒结算一次；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：技力24/初始10；130%物理、晕眩2秒。
  - 被动：基准：高血攻击108%低血庇护10%；阻挡充能+0.15/秒（自然回1/秒+阻挡额外）。
- ★2（攻×1.55、生命×1.65）：技力26/初始12；150%物理、晕眩2.5秒。
  - 被动：高血110%低血15%；阻挡充能+0.18/秒（自然回1/秒+阻挡额外）。
- ★3（攻×2.2、生命×2.6）：技力28/初始15；180%物理、晕眩3秒。
  - 被动：高血115%低血20%；阻挡充能+0.2/秒（自然回1/秒+阻挡额外）。
- ★4（攻×3、生命×4）：技力30/初始18；200%物理、晕眩3.5秒。
  - 被动：高血120%低血25%；阻挡充能+0.25/秒；震慑劈砍命中被阻挡目标额外+15%伤害（自然回1/秒+阻挡额外）。

### 模组
- 默认模组：uniequip_002_zumama
- `uniequip_001_zumama`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_zumama`（ADVANCED/rewrite）：三星解锁：震慑劈砍伤害+10%；四星加强：晕眩结束后目标受到森蚺伤害+10%持续4秒。
- `uniequip_003_zumama`（ADVANCED/rewrite）：三星解锁：阻挡充能+0.05/秒；四星加强：阻挡敌人时受到伤害-8%。
- `uniequip_004_zumama`（ADVANCED/rewrite）：三星解锁：勇冠三军高血攻击额外+3%；四星加强：生命低于一半时庇护额外+10%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_416_zumama`
实现：复用决斗重装KIT；自然回技力固定1/秒，阻挡充能作为额外入账由 modePassive[0] 单份承接；技能瞬时damage+stun，血线增益保留。
因果检查：
- 自然回技力始终为1/秒；阻挡时叠加额外0.15/0.18/0.2/0.25/秒，未阻挡时只失去这份额外回复。
- 血线判定在伤害前采样；跨越一半时对应增益切换而非叠加。
- 愈战愈勇只由 modePassive[0] 运行，原生天赋不再另外结算同一加成。

## 号角（`char_4039_horn`）
- 职业：TANK；档位：6（12 金币）；路线：`ammo`
- 定位：六星要塞，靠弹药远程溅射与过载爆发压制战场。
- 档位理由：原生弹药溅射与过载法术伤害，远程重装核心，定十二金币档。
- 设计理由：暴风号令做成即时装填弹药并溅射，过载保留为附加法术溅射，血战保留为再起机制。

### 固定技能：暴风号令（进击）
- 来源技能：`skchr_horn_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[20,22,25,28]；初始技力：[15,18,18,20]
- 技力满立即装填10发弹药；重复装填保留较多剩余。有弹的普通射击每次消耗1发并造成物理溅射，后半段弹药附带法术溅射；无弹恢复普通攻击，附加的无耗弹攻击不继承装填效果。
- 效果1：装填10发弹药：普通射击每次消耗1发，造成攻击力190%/210%/240%/260%的物理溅射。开火前按弹匣次序判定，后半段弹药（基础10发的第6至10发）对每个实际命中目标额外造成攻击力40%/45%/60%/70%的法术溅射一次；附加无耗弹攻击不享受装填效果，无弹恢复普通攻击。
  - trigger=自然技力满；target=自身；action=ammo；lifecycle=battle
  - values={"rounds":[10,10,10,10],"atkScale":[1.9,2.1,2.4,2.6],"magicAtkScale":[0.4,0.45,0.6,0.7],"overload":[1,1,1,1],"overloadAt":0.5}；stacking=同一实际弹药计数；重复装填取max(剩余,基础弹匣)，收藏品增加容量不免费填满额外容量；limits=每次普通射击只消耗1发；后半段按该发开火前的基础弹匣与剩余判定；不产生额外生命流失

### 原生天赋计划
- 军事要塞（`/char_4039_horn/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 在场时所有重装干员攻击力+20%，保留职业被动。
  - scope=全体重装干员；parameters={"atk":[0.1,0.14,0.2,0.24]}；trigger=被动常驻；unlockStar=1
- 血战（`/char_4039_horn/talents/1`）：mode=rewrite；runtimeBinding=modePassive:0
  - 被击倒时不撤退，恢复所有生命且生命上限-50%、攻速+18、防御+18%，单次部署只触发一次，改为明确的再起触发。
  - scope=自身；parameters={"maxHp":-0.5,"attackSpeed":[12,15,18,22],"def":[0.12,0.15,0.18,0.22]}

### 进击被动
- 被动0：被击倒时不撤退，原地恢复全部生命且生命上限-50%，攻速+12/15/18/22、防御+12%/15%/18%/22%；每次部署只触发一次。四星弹药打空时立即装填10发，每场最多1次；该返弹不随弹匣增加变为15发。
  - trigger=自身被击倒且本部署尚未触发过血战；四星弹药打空且本战尚未触发过返弹；target=自身；action=nativeMechanism；lifecycle=battle
  - values={"mechanism":"血战再起","heal":[1,1,1,1],"maxHp":[-0.5,-0.5,-0.5,-0.5],"attackSpeed":[12,15,18,22],"def":[0.12,0.15,0.18,0.22],"emptyAmmoRefill":[0,0,0,10],"emptyAmmoRefillMaxPerBattle":1}；stacking=血战每次部署一次；打空返弹每场战斗一次；limits=血战每部署一次；四星打空返弹每战一次；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：技力20/初始15；装填10发、190%物理溅射、过载+40%法术。
  - 被动：基准：重装攻击+10%；血战再起攻速+12防御+12%。
- ★2（攻×1.55、生命×1.65）：技力22/初始18；210%物理、过载+45%法术。
  - 被动：重装攻击+14%；血战攻速+15防御+15%。
- ★3（攻×2.2、生命×2.6）：技力25/初始18；240%物理、过载+60%法术。
  - 被动：重装攻击+20%；血战攻速+18防御+18%。
- ★4（攻×3、生命×4）：技力28/初始20；260%物理、过载+70%法术。
  - 被动：重装攻击+24%；血战攻速+22防御+22%；弹药打空时立即回满10发一次，每场最多1次。

### 模组
- 默认模组：uniequip_002_horn
- `uniequip_001_horn`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_horn`（ADVANCED/rewrite）：三星解锁：物理溅射半径+1格；四星加强：仅过载弹额外法术溅射提升至攻击力80%。
- `uniequip_003_horn`（ADVANCED/rewrite）：三星解锁：基础弹匣与技能实际装填量+5发，十五发弹匣从第8发进入过载；四星加强：每次成功净装填后向最远合法敌人立即射击1发，消耗弹药且不改变自然攻击节奏。四星打空返弹仍为10发，每场最多1次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4039_horn`
实现：复用要塞KIT与弹药primitive；技能瞬时装填弹药并绑定物理/法术溅射，血战为再起nativeMechanism。
因果检查：
- 每发弹药只结算一次物理溅射，过载时额外一次法术溅射，二者分离。
- 血战每次部署只触发一次；再部署后重置触发资格。

## 涤火杰西卡（`char_1034_jesca2`）
- 职业：TANK；档位：6（12 金币）；路线：`summon`
- 定位：六星远程重装，靠具名机动盾牌与弹药爆发兼顾防护与输出。
- 档位理由：原生机动盾牌装置加弹药爆发，机制独特，定十二金币档。
- 设计理由：饱和迸射做成即时装填弹药与盾牌炮击，灵活应变与蓄能释放保留为盾牌召唤和受击充能。

### 固定技能：饱和迸射（进击）
- 来源技能：`skchr_jesca2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[25,28,32,35]；初始技力：[25,25,28,30]
- 技力满立即装填20发弹药并提升攻击与防御；机动盾牌存在时立刻向前发射一枚炮弹，造成范围物理伤害与晕眩。
- 效果1：装填20发弹药，期间攻击+270%/290%/310%/320%、防御+65%/70%/80%/85%；打空后结束。
  - trigger=自然技力满；target=自身；action=ammo；lifecycle=battle
  - values={"rounds":[20,20,20,20],"atk":[2.7,2.9,3.1,3.2],"def":[0.65,0.7,0.8,0.85]}；stacking=重复装填取较多剩余弹药；limits=20发即次数上限
- 效果2：向前发射炮弹，对范围内所有敌人造成攻击力250%的物理伤害并晕眩5/5/6/6秒；无盾牌时不发射。
  - trigger=机动盾牌存在时同一结算；target=前方范围敌人；action=damage；lifecycle=instant
  - values={"atkScale":[2.5,2.5,2.5,2.5],"stun":[5,5,6,6]}；stacking=每次结算一枚炮弹；limits=每次技能结算一次

### 原生天赋计划
- 灵活应变（`/char_1034_jesca2/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 可使用持续50秒的机动盾牌，只能放置于四周；盾牌部署后涤火杰西卡转向盾牌且自身与身后单位防御+15%。
  - scope=自身与身后单位；parameters={"duration":[20,35,50,55],"def":[0.05,0.1,0.15,0.18],"maxShields":1}
- 蓄能释放（`/char_1034_jesca2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 机动盾牌受到伤害时，50%概率使涤火杰西卡获得1点技力。
  - scope=自身；parameters={"prob":[0.4,0.45,0.5,0.55],"spGain":1}；trigger=自身受到相关事件时；unlockStar=1

### 进击被动
- 被动0：在自身四周一格放置具名装置「机动盾牌」，持续20/35/50/55秒；部署后自身转向盾牌并为自身与身后单位提供5%/10%/15%/18%防御。
  - trigger=部署时；target=自身四周一格；action=summon；lifecycle=battle
  - values={"deviceId":"jesca2_mobile_shield","count":[1,1,1,1],"duration":[20,35,50,55],"def":[0.05,0.1,0.15,0.18]}；stacking=盾牌唯一，重放替换；limits=每场战斗常驻1个；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力25/初始25；装填20发、攻击+270%防御+65%、炮弹250%与晕眩5秒。
  - 被动：基准：盾牌20秒防御+5%，受击40%概率回1技力。
- ★2（攻×1.55、生命×1.65）：技力28/初始25；攻击+290%防御+70%、晕眩5秒。
  - 被动：盾牌35秒防御+10%，受击45%回1技力。
- ★3（攻×2.2、生命×2.6）：技力32/初始28；攻击+310%防御+80%、晕眩6秒。
  - 被动：盾牌50秒防御+15%，受击50%回1技力。
- ★4（攻×3、生命×4）：技力35/初始30；攻击+320%防御+85%、晕眩6秒。
  - 被动：盾牌55秒防御+18%，受击55%回1技力；盾牌存在时涤火杰西卡射程+1。

### 模组
- 默认模组：uniequip_002_jesca2
- `uniequip_001_jesca2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_jesca2`（ADVANCED/rewrite）：三星解锁：盾牌持续时间+10秒；四星加强：盾牌被击破时对周围敌人造成攻击力150%的物理伤害。
- `uniequip_003_jesca2`（ADVANCED/rewrite）：三星解锁：弹药+5发；四星加强：炮弹晕眩时间+2秒。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1034_jesca2`
实现：新增具名装置jesca2_mobile_shield与放置/朝向逻辑；技能瞬时装填弹药与盾牌炮击，蓄能释放走盾牌受击事件。
因果检查：
- 无机动盾牌时不发射炮弹；有盾牌时每次技能只发射一枚。
- 盾牌受击回技力每事件最多一次；盾牌替换后旧盾牌停止响应受击。

## 信仰搅拌机（`char_4194_rmixer`）
- 职业：TANK；档位：6（12 金币）；路线：`ammo`
- 定位：六星远程重装，靠弹药抵挡致命伤与拉特兰补弹支援。
- 档位理由：原生弹药抵挡致命伤并跨角色补弹，团队价值高，定十二金币档。
- 设计理由：八臂电锯侠做成即时装填弹药与致命伤抵挡，两仪礼保留为受击叠层与静止屏障。

### 固定技能：八臂电锯侠（进击）
- 来源技能：`skchr_rmixer_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[30,35,40,45]；初始技力：[22,25,28,30]
- 技力满立即装填50发弹药并提升攻击与防御；期间受到致命伤害时立即消耗20发弹药抵挡该次伤害。
- 效果1：装填45/50/50/55发弹药，期间攻击+105%/120%/150%/160%、防御+90%/100%/130%/140%。
  - trigger=自然技力满；target=自身；action=ammo；lifecycle=battle
  - values={"rounds":[45,50,50,55],"atk":[1.05,1.2,1.5,1.6],"def":[0.9,1,1.3,1.4]}；stacking=重复装填取较多剩余弹药；limits=弹药数即次数上限
- 效果2：受到致命伤害时立即消耗20发弹药抵挡该次伤害；弹药不足20发时无法抵挡。
  - trigger=弹药期间受到致命伤害；target=自身；action=nativeMechanism；lifecycle=instant
  - values={"mechanism":"弹药抵挡","consume":[20,20,20,20],"ammoRequired":[20,20,20,20]}；stacking=每次致命伤害消耗一档弹药；limits=每场战斗不限次数，受弹药量约束

### 原生天赋计划
- 扫射迎宾仪礼（`/char_4194_rmixer/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 每次造成伤害使自身10秒内防御+30、攻速+3，最多叠3层。
  - scope=自身；parameters={"def":[20,25,30,35],"attackSpeed":[2,2.5,3,3.5],"maxStacks":3,"duration":10}
- 架盾送客仪礼（`/char_4194_rmixer/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 若8秒内未主动攻击，获得相当于生命上限15%的屏障，失去屏障后重新计时。
  - scope=自身；parameters={"interval":[9,8,8,7],"barrier":[0.1,0.12,0.15,0.18]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：每次造成伤害叠防御+20/25/30/35、攻速+2/2.5/3/3.5，最多3层，持续10秒；重复伤害刷新时间不叠层。
  - trigger=自身每次造成伤害；target=自身；action=addBuff；lifecycle=battle
  - values={"def":[20,25,30,35],"attackSpeed":[2,2.5,3,3.5],"maxStacks":[3,3,3,3],"duration":[10,10,10,10]}；stacking=最多3层，独立计时；limits=每次伤害事件一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力30/初始22；装填45发、攻击+105%防御+90%、致命伤消耗20发抵挡。
  - 被动：基准：造成伤害叠防御+20攻速+2至多3层；8秒未攻击得10%屏障。
- ★2（攻×1.55、生命×1.65）：技力35/初始25；装填50发、攻击+120%防御+100%。
  - 被动：叠防御+25攻速+2.5；屏障12%。
- ★3（攻×2.2、生命×2.6）：技力40/初始28；装填50发、攻击+150%防御+130%。
  - 被动：叠防御+30攻速+3；屏障15%。
- ★4（攻×3、生命×4）：技力45/初始30；装填55发、攻击+160%防御+140%。
  - 被动：叠防御+35攻速+3.5；屏障18%；弹药抵挡后反击一次范围法术伤害。

### 模组
- 默认模组：uniequip_002_rmixer
- `uniequip_001_rmixer`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_rmixer`（ADVANCED/rewrite）：三星解锁：叠层上限+1；四星加强：叠满3层时获得10%庇护。
- `uniequip_003_rmixer`（ADVANCED/rewrite）：三星解锁：静止屏障+5%生命上限；四星加强：补弹时自身回复2点技力。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4194_rmixer`
实现：复用远程重装KIT与弹药primitive；技能瞬时装填+致命伤抵挡nativeMechanism，扫射叠层走伤害事件，静止屏障计时器。
因果检查：
- 致命伤害抵挡需至少20发弹药；弹药不足时不抵消伤害且不误扣弹药。
- 扫射叠层每次伤害事件最多一层；同名刷新时间不增加层数。

## 余（`char_2026_yu`）
- 职业：TANK；档位：6（12 金币）；路线：`element`
- 定位：六星元素重装，靠阻挡灼燃与火墙将敌人聚拢并持续灼烧。
- 档位理由：原生阻挡灼燃与传送控场，元素阵地核心，定十二金币档。
- 设计理由：厚礼上宾做成即时范围法术伤害与传送聚怪，礼尚往来与闲云隐市保留为阻挡灼燃与元素自愈。

### 固定技能：厚礼上宾（进击）
- 来源技能：`skchr_yu_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[18,22,26,29]；初始技力：[14,18,20,20]
- 技力满立即对周围所有敌人造成法术伤害并将其中的地面可达目标传送至自身位置，同时提升阻挡、生命与攻击。
- 效果1：对周围所有敌人造成攻击力100%/150%/220%/290%的法术伤害。
  - trigger=自然技力满；target=周围所有敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1,1.5,2.2,2.9]}；stacking=每目标一次；limits=每场战斗不限次数
- 效果2：将其中至多3/4/5/6名地面可达目标传送至自身位置，聚拢后承受阻挡灼燃。
  - trigger=同一结算；target=周围地面可达敌人；action=move；lifecycle=instant
  - values={"teleport":[1,1,1,1],"maxTargets":[3,4,5,6]}；stacking=每目标一次；limits=不可传送目标不位移仍受伤
- 效果3：阻挡+2、生命上限+130%/140%/160%/170%、攻击+200%/230%/290%/330%，持续20秒。
  - trigger=同一结算；target=自身；action=addBuff；lifecycle=battle
  - values={"blockCnt":[2,2,2,2],"maxHp":[1.3,1.4,1.6,1.7],"atk":[2,2.3,2.9,3.3],"duration":[20,20,20,20]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次

### 原生天赋计划
- 礼尚往来（`/char_2026_yu/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 阻挡敌人时自身获得25%庇护，并使被阻挡目标每秒受到相当于攻击力40%的法术伤害和12%攻击力的灼燃损伤。
  - scope=自身与被阻挡敌人；parameters={"protect":[0.15,0.2,0.25,0.28],"magicPerSec":[0.25,0.3,0.4,0.45],"burnRatio":[0.08,0.1,0.12,0.14]}
- 闲云隐市（`/char_2026_yu/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 场上干员数量不低于4时，自身每秒回复相当于生命上限1.5%的生命与元素损伤。
  - scope=自身；parameters={"minOps":4,"hpPerSec":[0.01,0.012,0.015,0.018],"epPerSec":[0.01,0.012,0.015,0.018]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：阻挡敌人时自身获得15%/20%/25%/28%庇护；被阻挡目标每秒受到余攻击力25%/30%/40%/45%的法术伤害与8%/10%/12%/14%攻击力的灼燃损伤。
  - trigger=自身阻挡敌人时每秒；target=被阻挡敌人与自身；action=nativeMechanism；lifecycle=battle
  - values={"mechanism":"礼尚往来","protect":[0.15,0.2,0.25,0.28],"magicPerSec":[0.25,0.3,0.4,0.45],"burnRatio":[0.08,0.1,0.12,0.14],"interval":1}；stacking=同一敌人每秒只结算一次；limits=每秒结算一次；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力18/初始14；周围100%法术、传送至多3名、阻挡+2生命+130%攻击+200%持续20秒。
  - 被动：基准：阻挡庇护15%、灼燃25%法伤8%损伤；4人以上回1%生命与元素。
- ★2（攻×1.55、生命×1.65）：技力22/初始18；周围150%、传送4名、生命+140%攻击+230%。
  - 被动：庇护20%、灼燃30%法伤10%损伤；回1.2%。
- ★3（攻×2.2、生命×2.6）：技力26/初始20；周围220%、传送5名、生命+160%攻击+290%。
  - 被动：庇护25%、灼燃40%法伤12%损伤；回1.5%。
- ★4（攻×3、生命×4）：技力29/初始20；周围290%、传送6名、生命+170%攻击+330%。
  - 被动：庇护28%、灼燃45%法伤14%损伤；回1.8%生命与元素；被阻挡敌人每秒额外+1层灼燃损伤。

### 模组
- 默认模组：uniequip_002_yu
- `uniequip_001_yu`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_yu`（ADVANCED/rewrite）：三星解锁：礼尚往来灼燃损伤+3%攻击；四星加强：阻挡庇护+5%且被阻挡目标防御-10%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_2026_yu`
实现：复用元素重装KIT；技能瞬时damage+传送move+自身maxHp/atk/block buff，礼尚往来为阻挡每秒事件，闲云隐市为编队条件自愈。
因果检查：
- 传送只作用于地面可达目标；不可传送目标仍结算伤害但不位移。
- 被阻挡敌人每秒只结算一次法术与灼燃损伤；重复阻挡不叠层。

## 格拉尼（`char_220_grani`）
- 职业：PIONEER；档位：4（6 金币）；路线：`blockCounter`
- 定位：防守型冲锋先锋，靠永不后退提升攻防阻挡并同时阻挡所有敌人。
- 档位理由：原生击杀回费加攻防爆发与阻挡群攻，防守先锋支点，定六金币档。
- 设计理由：永不后退做成即时攻防阻挡提升与群攻，骑警保留为全体先锋物理闪避被动。

### 固定技能：永不后退！（进击）
- 来源技能：`skchr_grani_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[40,45,50,55]；初始技力：[25,30,35,38]
- 技力满立即提升攻击力、防御力与阻挡数，并在一段时间内同时攻击阻挡的所有敌人。
- 效果1：攻击+60%/65%/80%/90%、防御+60%/65%/80%/90%、阻挡+1，持续30秒。
  - trigger=自然技力满；target=自身；action=addBuff；lifecycle=battle
  - values={"atk":[0.6,0.65,0.8,0.9],"def":[0.6,0.65,0.8,0.9],"blockCnt":[1,1,1,1],"duration":[30,30,30,30]}；stacking=同名刷新取较强不叠加；limits=每次结算施加一次
- 效果2：持续期间同时攻击阻挡的所有敌人，攻击距离缩短，这是原生特性在进击的保留。
  - trigger=同一结算；target=自身；action=modifyTag；lifecycle=battle
  - values={"attackAllBlocked":[1,1,1,1],"duration":[30,30,30,30]}；stacking=同名刷新不叠加；limits=每次结算施加一次

### 原生天赋计划
- 骑警（`/char_220_grani/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 在场时所有先锋干员获得20%的物理闪避，保留职业被动。
  - scope=全体先锋干员；parameters={"physDodge":[0.1,0.14,0.2,0.24]}

### 进击被动
- 被动0：在场时全体先锋干员获得10%/14%/20%/24%物理闪避；光环保活不计入触发统计，只按存续提供闪避。
  - trigger=自身部署后常驻光环；target=全体先锋干员；action=addBuff；lifecycle=battle
  - values={"physDodge":[0.1,0.14,0.2,0.24]}；stacking=同名取较强不叠加；limits=在场持续；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：技力40/初始25；攻防+60%阻挡+1群攻持续30秒。
  - 被动：基准：全体先锋物理闪避+10%。
- ★2（攻×1.55、生命×1.65）：技力45/初始30；攻防+65%。
  - 被动：全体先锋物理闪避+14%。
- ★3（攻×2.2、生命×2.6）：技力50/初始35；攻防+80%。
  - 被动：全体先锋物理闪避+20%。
- ★4（攻×3、生命×4）：技力55/初始38；攻防+90%。
  - 被动：全体先锋物理闪避+24%；永不后退期间自身闪避成功回复1点技力，每3秒一次。

### 模组
- 默认模组：uniequip_002_grani
- `uniequip_001_grani`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_grani`（ADVANCED/rewrite）：三星解锁：永不后退攻击+10%；四星加强：群攻期间每命中一名敌人回0.2费，每秒最多1次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_220_grani`
实现：复用冲锋手KIT；技能瞬时atk/def/block buff与attackAllBlocked标签，骑警为先锋职业光环。
因果检查：
- 群攻标签只作用于阻挡目标；未阻挡目标不受额外伤害。
- 闪避由光环提供，不因重复刷新产生额外收益；光环消失后闪避立即移除。



## 当前源增量：德·托莱多（`char_393_toledo`）

SUPPORT／削弱者，价格6金币，定位为法术攻击与阻挡目标脆弱支援。战技“危言耸听”技力回满自动施放，在攻击范围内合法近战位召唤原生 `token_10067_toledo_tldptm` 守卫20秒；出现时令附近敌人战栗4/5/6/7秒。范围内被阻挡敌人受到8/12/16/16%脆弱，技能窗口倍率1.7/1.8/1.9/2；不再阻挡或离开范围即解除。来源：`data/assault-rules/assault-runtime.json#/operators/char_393_toledo`、`data/assault-rules/assault-public-text.json#/operators/char_393_toledo`。