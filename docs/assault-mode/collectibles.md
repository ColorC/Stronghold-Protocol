# 进击首发收藏品完整池（72 件）

本文件由 `tools/assault/check-collectibles-design.mjs --render` 从 `data/assault-rules/assault-design/collectibles.json` 确定性生成，请勿手改。

进击首发收藏品池。原生条目为转译（sourceStatus=nativeAdaptation），effects 为进击重新设计，不直接采用原生黑板数值；领袖起步件为原创（sourceStatus=original）。

| 路线 | 普通 | 稀有 | 珍贵 | 合计 |
| --- | ---: | ---: | ---: | ---: |
| cold | 2 | 2 | 2 | 6 |
| redeploy | 2 | 2 | 2 | 6 |
| ammo | 2 | 2 | 2 | 6 |
| element | 2 | 2 | 2 | 6 |
| summon | 2 | 2 | 2 | 6 |
| healShield | 2 | 2 | 2 | 6 |
| blockCounter | 2 | 2 | 2 | 6 |
| pierceCrit | 2 | 2 | 2 | 6 |
| skillCycle | 2 | 2 | 2 | 6 |
| economyGrowth | 2 | 2 | 2 | 6 |
| cross | 2 | 5 | 2 | 9 |
| leader | | | | 3（starter）|
| **合计** | | | | **72** |

货币账目约定：gold=整局金币（无利息），dp=本战斗部署点数（最低 0），xp=科技经验，hp=行动生命。技力费用最低 0.5；加速指自然技力回复额外 +100%；充能按实际净入账。

## 路线 cold

### 留春（`cold-frostsignal`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_5_relic_fight_16`
- 获取：shop(mechanism:cold)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_fight_16`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_fight_16`
- 原生用途（内部）：敌人被击倒时，使其周围所有敌人获得6秒的寒冷
- 转译理由：原生未定义邻域几何与重复施加口径；进击明确为切比雪夫距离一的八邻，并让每次击杀走独立因果路径。
- 描述：敌人被击倒时，其八邻内所有敌人各获得一次 6 秒寒冷。每次击杀独立产生一次状态施加，重叠敌人可收到多笔独立寒冷，不合并成单次结算。
- 效果：
  - trigger=`kill` action=`applyStatus` lifecycle=`instant`
    - target：team=enemy，selection=killedEnemyAdjacent，geometry=adjacent8，count=all
    - params：`{"status":"cold","durationSec":6,"layers":1}`
    - condition：`{"killedTeam":"enemy"}`
    - stacking：同源=同一敌人由不同击杀产生的寒冷分别独立计时，可按进击寒冷规则累积为冻结；异源=与其它收藏品施加的寒冷各自结算，互不覆盖
    - limits：null（不限）
    - 击倒一名敌人后，其八邻内所有敌人各获得一次 6 秒寒冷。
- 因果检查：
  - 场景：一次技能同时击倒两名八邻重叠的敌人 → 预期：两次击杀各自触发一次邻域寒冷，重叠敌人收到两笔独立状态施加
  - 场景：被击倒敌人的八邻没有其它敌人 → 预期：产生空目标，不消耗计数，也不报错
- 实现计划：events=[kill, statusApplied]；primitives=[killCauseRecord, adjacent8Query, statusApply(cold,6s)]
  - 击杀派生寒冷时携带击杀根因果，附加目标各为独立兄弟路径。

### 冰结的躯壳（`cold-frozenhusk`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_3_relic_fight_4`
- 获取：shop(mechanism:cold)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_4`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_4`
- 原生用途（内部）：近战干员在受到伤害后5秒内，攻击速度+40
- 转译理由：原生只给攻速，进击把“受击后强化”转译为寒冷施加扳机，使 cold 路线拥有独立的状态来源。
- 描述：我方近战干员每次受到伤害后获得 5 秒“冰壳”，其下一次普通攻击额外对目标施加一次 2 秒寒冷；连续受击只刷新冰壳持续时间，不叠加剩余次数。
- 效果：
  - trigger=`damageTaken` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"frostShell","durationSec":5,"onNextAttack":{"status":"cold","durationSec":2,"count":1}}`
    - condition：`{"ownerDeployType":"melee"}`
    - stacking：同源=同源重复受击只刷新冰壳剩余时长，不增加待施加次数；异源=与其它受击被动互不刷新，各自记录
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":null,"reason":"受击频率本身受敌人节奏约束，无需额外次数闸门"}
    - 受击后 5 秒内下一次普通攻击附加一次 2 秒寒冷。
- 因果检查：
  - 场景：近战干员在 5 秒内连续受到三次伤害 → 预期：冰壳时长被刷新为 5 秒，仍只有一次待施加寒冷
  - 场景：冰壳生效前干员被击倒 → 预期：待施加效果随身体退场清除，不在再次部署后残留
- 实现计划：events=[damageTaken, attack, statusApplied]；primitives=[damageTakenHook, buffApply(frostShell), onNextHitStatus(cold,2s)]
  - 冰壳随所属干员生命周期，退场清理走原生状态清理路径。

### “当红歌手”（`cold-cabaretsinger`）— rare

- 来源状态：nativeAdaptation；解锁日：第 4 天
- 图标：`rogue_1_relic_q23`
- 获取：shop(mechanism:cold)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_q23`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_q23`
- 原生用途（内部）：敌人被晕眩、冰冻、束缚时，每秒受到600点法术伤害
- 转译理由：原生为持续每秒伤害，进击改为绑定“成功施加寒冷”的一次性追加伤害，使触发口径可机器核对。
- 描述：敌人成功获得寒冷时，立即受到一次施加来源攻击力 60% 的法术伤害，并停顿 1 秒；同一次原生施法对同一目标的每次独立寒冷施加各结算一次。
- 效果：
  - trigger=`statusApplied` action=`damage` lifecycle=`instant`
    - target：team=enemy，selection=statusTarget，geometry=attackRange，count=1
    - params：`{"damageType":"arts","atkRatio":0.6,"base":0,"pauseSec":1}`
    - condition：`{"statusIn":["cold"],"applied":true}`
    - stacking：同源=同一施加路径的同目标只结算一次追加伤害；异源=不同来源施加的寒冷各自触发，不共享冷却
    - limits：null（不限）
    - 每次成功施加寒冷附带一次 60% 攻击力法术伤害与 1 秒停顿。
- 因果检查：
  - 场景：同一施法对目标连续两次成功施加寒冷 → 预期：两笔独立兄弟路径各结算一次追加伤害
  - 场景：目标已有寒冷，本次施加被免疫 → 预期：不结算追加伤害
- 实现计划：events=[statusApplied, hit]；primitives=[statusAppliedHook, damage(arts,0.6*atk), pause(1s)]
  - 追加伤害来源归因到施加寒冷的施法者，可正常参与击杀与后续联动。

### 凯旋号角（`cold-triumphhorn`）— rare

- 来源状态：nativeAdaptation；解锁日：第 3 天
- 图标：`rogue_1_relic_n06`
- 获取：shop(mechanism:cold)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_n06`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_n06`
- 原生用途（内部）：敌人受到的一次性晕眩、寒冷、冰冻等异常效果影响时间提高100%
- 转译理由：进击只保留寒冷/冻结语义并改为对每次成功施加独立结算时长，避免整次施法全局去重吞掉兄弟施加。
- 描述：敌人成功获得寒冷或冻结时，该次状态持续时间翻倍；免疫、取消或未施加不触发。两次独立施加各自翻倍，不因目标已处于寒冷而互相吞并。
- 效果：
  - trigger=`statusApplied` action=`addBuff` lifecycle=`instant`
    - target：team=enemy，selection=statusTarget，geometry=attackRange，count=1
    - params：`{"tag":"statusDuration","op":"mul","value":2,"appliesTo":["cold","frozen"]}`
    - condition：`{"statusIn":["cold","frozen"],"applied":true}`
    - stacking：同源=同源对同一次施加只翻倍一次，重复触发沿同路径不叠加；异源=与其它时长修改按进击同类叠加规则结算
    - limits：null（不限）
    - 每次成功施加寒冷或冻结时，该次持续时间翻倍。
- 因果检查：
  - 场景：一次技能对同一敌人施加两次寒冷 → 预期：两笔独立施加各自翻倍，不合并为一次
  - 场景：敌人免疫寒冷 → 预期：施加失败，不触发翻倍也不消耗任何收益
- 实现计划：events=[statusApplied]；primitives=[statusAppliedHook, statusDurationMul(2)]
  - 只在实际施加成功后结算，免疫与转换失败不计。

### 精神治疗录像带（`cold-mirrorarchive`）— epic

- 来源状态：nativeAdaptation；解锁日：第 7 天
- 图标：`rogue_1_relic_n08`
- 获取：shop(mechanism:cold)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_n08`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_n08`
- 原生用途（内部）：敌人受到的一次性晕眩、寒冷、冰冻等异常效果影响时间提高150%
- 转译理由：原生只加时长，进击改为将重复施加转化为可核对的层数并触发全场冻结，给 cold 路线可控的爆发窗口。
- 描述：每次成功施加寒冷累积 1 层“寒潮”（最多 3 层）。寒潮达到 3 层时，立即对所有敌人施加一次 3 秒冻结并清空寒潮。层数来自独立施加，重复寒冷不因目标已有状态而被吞。
- 效果：
  - trigger=`statusApplied` action=`addBuff` lifecycle=`battle`
    - target：team=enemy，selection=statusTarget，geometry=attackRange，count=1
    - params：`{"buff":"coldSurge","perApply":1,"maxStacks":3}`
    - condition：`{"statusIn":["cold"],"applied":true}`
    - stacking：同源=同源每次成功施加累积一层，达到上限后不再增加也不溢出；异源=与其它层数系统独立
    - limits：null（不限）
    - 每次成功施加寒冷累积 1 层寒潮，最多 3 层。
  - trigger=`statusApplied` action=`applyStatus` lifecycle=`instant`
    - target：team=enemy，selection=allEnemies，geometry=field，count=all
    - params：`{"status":"frozen","durationSec":3,"resetCounter":"coldSurge"}`
    - condition：`{"statusIn":["cold"],"applied":true,"counter":"coldSurge","counterAtLeast":3}`
    - stacking：同源=同一施加路径不重复触发清空，清空后重新计数；异源=冻结施加为独立批次，可被其它寒冷/冻结触发继续联动
    - limits：null（不限）
    - 寒潮满 3 层时对全体敌人施加 3 秒冻结并清空寒潮。
- 因果检查：
  - 场景：连续四次独立施加寒冷 → 预期：前三次各累积一层并在第三次触发全场冻结清空，第四次重新从 1 层开始
  - 场景：寒冷施加被免疫 → 预期：不累积层数，不推进爆发阈值
- 实现计划：events=[statusApplied, battleStart]；primitives=[statusAppliedHook, battleCounter(coldSurge,3), statusApply(frozen,3s,allEnemies)]
  - 计数按每条施加路径各记一次，兄弟施加不共享 visited。

### 凝冰砥石（`cold-niflheimr`）— epic

- 来源状态：nativeAdaptation；解锁日：第 6 天
- 图标：`rogue_3_relic_fight_8`
- 获取：shop(mechanism:cold)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_8`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_8`
- 原生用途（内部）：战斗开始时，使随机一名干员生命值、攻击力、防御力、法术抗性、阻挡数、初始技力、部署费用翻倍
- 转译理由：原生随机全属性翻倍在进击不可读；改为全队寒冷化，用攻速代价换取稳定寒冷来源，作为 cold 路线核心规则。
- 描述：战斗开始时，我方全体干员获得“凝冰锋”直到战斗结束：普通攻击额外施加一次 1 秒寒冷，但攻击间隔提高 15%。这是改变全队输出规则的核心效果，代价明确且可预期。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"buff":"frostEdge","durationSec":null,"attackIntervalMultiplier":1.15,"onAttackStatus":{"status":"cold","durationSec":1}}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=每场战斗只施加一次，重复开局不叠加；异源=与其它开局 buff 并存，攻击间隔乘区按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局规则型 buff，每战仅一份"}
    - 全队普通攻击附加 1 秒寒冷，攻击间隔提高 15%，持续整场战斗。
- 因果检查：
  - 场景：装备该件后进入战斗 → 预期：全体获得凝冰锋，普攻命中时各施加一次寒冷，攻击间隔按 1.15 倍结算
  - 场景：同一干员在战斗中再次部署 → 预期：凝冰锋为开局全队 battle 生命周期效果，新入场干员同样受用
- 实现计划：events=[battleStart, attack, statusApplied]；primitives=[battleStartHook, battleBuff(frostEdge), attackIntervalMul(1.15), onAttackStatus(cold,1s)]
  - 技能造成的伤害命中若走攻击事件也可施加寒冷，不按内部来源名屏蔽。

## 路线 redeploy

### 锈刃-新典训（`redeploy-newedict`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_6_relic_assign_7`
- 获取：shop(mechanism:redeploy)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_assign_7`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_assign_7`
- 原生用途（内部）：立即进阶一个【特种】干员（不消耗希望），并使其：再部署时间-50%
- 转译理由：原生“进阶”属于肉鸽养成，进击无对应；改成特种部署的一次性再部署缩减，保留职业限定。
- 描述：特种干员部署完成时，其下一次再部署等待时间 -50%（仅该干员，触发一次后清除）。技能造成的再部署不触发此件。
- 效果：
  - trigger=`redeploy` action=`redeploy` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"stat":"redeployCooldown","op":"mul","value":0.5,"scope":"nextRedeploy","consumedOnUse":true}`
    - condition：`{"entryKind":"deploy","ownerProfession":"SPECIAL"}`
    - stacking：同源=同源每次部署刷新下一次再部署标记，不叠加倍率；异源=与其它一次性缩减分别结算并依次乘算
    - limits：null（不限）
    - 特种部署后其下一次再部署等待时间减半。
- 因果检查：
  - 场景：特种干员正常部署后倒地自然再入场 → 预期：自然再入场使用当前原生费用，且等待时间按减半结算一次
  - 场景：非特种干员部署 → 预期：不触发，不产生标记
- 实现计划：events=[redeploy]；primitives=[redeployEntryHook, professionGuard(SPECIAL), redeployCooldownMul(0.5,nextOnce)]
  - 技能发起的立即再部署不消费该标记，因为它停用该次再部署动作。

### 医者-涌泉（`redeploy-spring`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_3_relic_book_9`
- 获取：shop(mechanism:redeploy)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_book_9`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_book_9`
- 原生用途（内部）：场上每有一名医疗干员，所有我方单位的再部署时间-5%（最多叠加8次）
- 转译理由：进击没有原生希望/医疗计数语义，改为“部署时若场上有医疗”逐次叠层，保持医疗支援定位且可机器核对。
- 描述：每次我方干员部署完成时，若场上存在医疗干员，本次战斗全体干员的再部署等待时间 -5%，最多 4 层。层数在战斗内累积，医疗干员退场后已有的层保留。
- 效果：
  - trigger=`redeploy` action=`redeploy` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"stat":"redeployCooldown","op":"mul","value":0.95,"maxStacks":4}`
    - condition：`{"entryKind":"deploy","fieldHasProfession":"MEDIC"}`
    - stacking：同源=同源每场战斗最多 4 层，之后不再增加；异源=与其它再部署缩减乘区按进击同类叠加规则合并
    - limits：{"perBattle":4,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每战 4 层上限，对应原生 8 次叠加上限的进击收窄"}
    - 满足条件时每次部署叠 1 层，每层使再部署等待时间 -5%，最多 4 层。
- 因果检查：
  - 场景：场上有医疗干员时连续部署五名干员 → 预期：前四次各叠一层达到 4 层，第五次不再增加
  - 场景：医疗干员全部退场后才部署 → 预期：不满足条件，不叠层，已有层保留
- 实现计划：events=[redeploy, battleStart]；primitives=[redeployEntryHook, fieldProfessionQuery(MEDIC), battleStack(redeployCooldown,0.95,4)]
  - redeploy 事件同时承载正常入场与再部署；此处按 entryKind=deploy 区分。

### 锈刃-可视静谧（`redeploy-specialstill`）— rare

- 来源状态：nativeAdaptation；解锁日：第 4 天
- 图标：`rogue_2_relic_fight_79`
- 获取：shop(mechanism:redeploy)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_79`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_79`
- 原生用途（内部）：所有【特种】干员的再部署时间-35%
- 转译理由：进击改为按干员逐个生效并明确同源刷新口径，避免全队乘算或多次部署连乘。
- 描述：特种干员部署完成时，其再部署等待时间 -35% 并持续到本场战斗结束；同名多次部署取最新值刷新，不叠加连乘。
- 效果：
  - trigger=`redeploy` action=`redeploy` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"stat":"redeployCooldown","op":"mul","value":0.65,"scope":"battle","refresh":true}`
    - condition：`{"entryKind":"deploy","ownerProfession":"SPECIAL"}`
    - stacking：同源=同源对同一干员取最新赋值，不连乘；异源=与其它干员的减时互不影响，各自记账
    - limits：null（不限）
    - 特种部署后其再部署等待时间 -35%，持续整场战斗。
- 因果检查：
  - 场景：同一特种在战斗中部署两次 → 预期：第二次将标记刷新为同一 0.65 值，而非 0.65 的平方
  - 场景：部署非特种干员 → 预期：不触发，不产生该干员标记
- 实现计划：events=[redeploy]；primitives=[redeployEntryHook, professionGuard(SPECIAL), unitTagSet(redeployCooldown,0.65,refresh)]
  - 标记挂在干员实体上，随本场战斗生命周期清理。

### 钝爪-振奋（`redeploy-vanguardrally`）— rare

- 来源状态：nativeAdaptation；解锁日：第 3 天
- 图标：`rogue_1_relic_p04`
- 获取：shop(mechanism:redeploy)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_p04`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_p04`
- 原生用途（内部）：所有【先锋】干员的再部署时间-50%
- 转译理由：原生只对自己职业永久减时；进击改成先锋部署时支援“一名”正在等待的友军，让位置与节奏选择有意义。
- 描述：先锋干员部署完成时，使当前再部署等待时间最长的一名其他待命干员等待时间减半；每名先锋每次部署各触发一次，两名先锋同一点部署产生两笔独立结算。
- 效果：
  - trigger=`redeploy` action=`redeploy` lifecycle=`instant`
    - target：team=ally，selection=longestRedeployingAlly，geometry=field，count=1
    - params：`{"stat":"redeployCooldown","op":"mul","value":0.5,"targetScope":"oneOtherDeployingAlly"}`
    - condition：`{"entryKind":"deploy","ownerProfession":"PIONEER"}`
    - stacking：同源=同源只作用于当前等待最久者，多次触发各自结算；异源=与其它缩减乘区按进击规则合并
    - limits：null（不限）
    - 先锋部署时，等待最久的一名友军再部署等待时间减半。
- 因果检查：
  - 场景：两名先锋在同一战斗先后部署 → 预期：各触发一次，两次各选当时等待最久的友军减半
  - 场景：场上没有处于再部署等待的其他干员 → 预期：无合格目标，仅显示无目标，不凭空生成
- 实现计划：events=[redeploy]；primitives=[redeployEntryHook, professionGuard(PIONEER), longestRedeployingAllyQuery, redeployCooldownMul(0.5)]
  - 目标选择固定按剩余等待时间排序，时间长者优先，不消耗随机数。

### 垂降劫掠装置（`redeploy-airdrop`）— epic

- 来源状态：nativeAdaptation；解锁日：第 7 天
- 图标：`rogue_6_relic_artifact_6`
- 获取：shop(mechanism:redeploy)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_artifact_6`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_artifact_6`
- 原生用途（内部）：我方干员的再部署时间-50%，部署时对随机1名敌人及周围8格的敌人造成攻击力1000%的物理伤害
- 转译理由：原生 1000% 在进击过高；下调为 300% 并按进击几何规范把“周围8格”写为八邻，随机目标记录在固定种子下可复现。
- 描述：我方干员部署完成时，对随机 1 名敌人及其八邻造成该部署干员攻击力 300% 的物理伤害；全体干员再部署等待时间 -50%。八邻是切比雪夫距离一，不是半径八格。
- 效果：
  - trigger=`battleStart` action=`redeploy` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"stat":"redeployCooldown","op":"mul","value":0.5}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=每战只结算一次；异源=与其它再部署缩减合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局规则型修改，每战一次"}
    - 开局全体干员再部署等待时间 -50%。
  - trigger=`redeploy` action=`damage` lifecycle=`instant`
    - target：team=enemy，selection=randomEnemyAndAdjacent，geometry=adjacent8，count=all
    - params：`{"damageType":"physical","atkRatio":3,"sourceOwner":"deployingAlly"}`
    - condition：`{"entryKind":"deploy"}`
    - stacking：同源=同一次部署只结算一次；异源=不同干员部署各自触发
    - limits：null（不限）
    - 每次部署对随机 1 名敌人及其八邻造成 300% 攻击力物理伤害。
- 因果检查：
  - 场景：场上存在多个敌人时部署干员 → 预期：随机选中 1 名敌人，伤害覆盖其八邻，固定种子下目标可复现
  - 场景：场上没有敌人时部署干员 → 预期：无伤害目标，不产生空批次错误
- 实现计划：events=[battleStart, redeploy, hit]；primitives=[battleStartHook, redeployEntryHook, seededRandomEnemy, adjacent8Query, damage(physical,3.0*atk)]
  - 伤害来源归因到部署干员，可正常触发击杀与后续联动。

### “断剑”（`redeploy-brokenblade`）— epic

- 来源状态：nativeAdaptation；解锁日：第 6 天
- 图标：`rogue_1_relic_m05`
- 获取：shop(mechanism:redeploy)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_m05`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_m05`
- 原生用途（内部）：所有干员的生命-30%，但再部署时间-50%
- 转译理由：原生生命 -30% 只改上限会破坏治疗后比例；进击按比例同步当前生命，并把再部署收益绑定到每次再部署的无敌窗口。
- 描述：战斗开始时，我方全体干员最大生命 -20%（当前生命按比例同步），但再部署等待时间 -50%；每次再部署完成后该干员获得 2 秒无敌。代价与收益同时生效，不能只取其一。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"tag":"bodyStats","op":"mul","maxHp":0.8,"currentHpFollow":"scale","redeployCooldownMul":0.5}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=每场战斗只结算一次；异源=生命与再部署两个乘区独立记录
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局规则型修改，每战一次"}
    - 开局全队最大生命 -20% 且当前生命按比例，再部署等待时间 -50%。
  - trigger=`redeploy` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"invulnerable","durationSec":2,"invulnerable":true}`
    - condition：`{"entryKind":"redeploy"}`
    - stacking：同源=同源重复再部署各自刷新 2 秒，不叠层；异源=与其它无敌来源按进击同类叠加规则
    - limits：null（不限）
    - 每次再部署后该干员获得 2 秒无敌。
- 因果检查：
  - 场景：一名满血干员在开局后立即受到治疗 → 预期：最大生命与当前生命同步为 0.8 倍，治疗按新上限比例生效，不出现治疗失效
  - 场景：干员倒地再部署完成 → 预期：入场后获得 2 秒无敌，且清空原生退场状态
- 实现计划：events=[battleStart, redeploy]；primitives=[battleStartHook, maxHpMulWithCurrentScale(0.8), invulnBuff(2s)]
  - 再部署无敌只对真实再部署生效，正常入场不发放。

## 路线 ammo

### 《炎国字汇》（`ammo-charsetglossary`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_5_relic_bullet_3`
- 获取：shop(mechanism:ammo)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_bullet_3`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_bullet_3`
- 原生用途（内部）：弹药类技能每次开启后，首次剩余30%的弹药时，补充最大弹药数量30%的弹药
- 转译理由：沿用原生装填语义，但明确“首次”与每战次数上限，避免同一技能内反复补弹。
- 描述：弹药类技能开启后，首次剩余 30% 弹药时补充最大弹药量的 30%，补充按实际净入账；同一技能内即使多次低于阈值也只触发一次，每名干员每场战斗最多触发两次。
- 效果：
  - trigger=`ammoUsed` action=`ammo` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"op":"add","amountRatioOfMax":0.3}`
    - condition：`{"skillTag":"ammo","remainingRatioAtMost":0.3,"oncePerSkill":true}`
    - stacking：同源=同一技能内同源只触发一次；异源=与其它补弹来源分别结算，溢出不计入
    - limits：{"perBattle":2,"perDeployment":1,"perHour":null,"perRun":null,"reason":"防止短技能内反复补满，每名干员每战最多两次"}
    - 弹药首次降到 30% 时补充最大弹药的 30%，每战最多两次。
- 因果检查：
  - 场景：一次弹药技能内弹药两次跌到 30% 以下 → 预期：仅第一次触发补充，第二次不触发
  - 场景：补充量超过弹药上限 → 预期：按实际净入账补齐到上限，溢出部分不计为充能收益
- 实现计划：events=[ammoUsed, reloaded]；primitives=[ammoUsedHook, ammoRemainingRatioQuery, ammoAdd(0.3*max), perSkillOnceGuard]
  - 补弹只改弹药账目，不递归开启技能。

### 显圣吊坠（`ammo-holycollar`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_1_relic_a17`
- 获取：shop(mechanism:ammo)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_a17`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_a17`
- 原生用途（内部）：所有我方远程单位的攻击力+15%
- 转译理由：原生为常驻白值；进击改为绑定装填事件的短时强化，使其服务于弹药节奏而非纯白值。
- 描述：我方远程干员每次装填完成后，攻击力 +15% 持续 5 秒；重复装填只刷新持续时间，不叠层，也不影响非远程干员。
- 效果：
  - trigger=`reloaded` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"holyCollar","atkRatio":0.15,"durationSec":5,"refresh":true}`
    - condition：`{"ownerDeployType":"ranged"}`
    - stacking：同源=同源重复装填只刷新时长，不叠层；异源=与其它攻击力增益按进击乘区规则合并
    - limits：null（不限）
    - 远程干员装填后攻击力 +15%，持续 5 秒，可刷新。
- 因果检查：
  - 场景：远程干员在 3 秒内连续装填两次 → 预期：攻击力增益仍为 15%，时长刷新为 5 秒
  - 场景：近战干员装填 → 预期：不满足远程条件，不触发
- 实现计划：events=[reloaded, attack]；primitives=[reloadedHook, deployTypeGuard(ranged), buffApply(holyCollar,atk+15%,5s)]
  - 增益挂在干员实体上，随战斗生命周期清理。

### 传芳雕版（`ammo-carvedplate`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_5_relic_bullet_1`
- 获取：shop(mechanism:ammo)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_bullet_1`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_bullet_1`
- 原生用途（内部）：干员开启弹药类技能后，每次造成伤害时，攻击力+2%（最多叠加30层）
- 转译理由：保留原生叠层机制，但明确技能结束清空与再开启重置，使层数生命周期可核对。
- 描述：干员开启弹药类技能后，每次造成伤害使自身攻击力 +2%，最多 30 层（合计 +60%）；技能结束时清空全部层数，下一次技能重新从零开始。
- 效果：
  - trigger=`hit` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"carveStack","atkRatioPerStack":0.02,"maxStacks":30,"clearOnSkillEnd":true}`
    - condition：`{"duringSkillTag":"ammo"}`
    - stacking：同源=同源每次命中叠一层，封顶后不再增加；异源=与其它攻击力叠层独立计算
    - limits：null（不限）
    - 弹药技能期间每次命中叠 1 层攻击力 +2%，最多 30 层，技能结束清空。
- 因果检查：
  - 场景：弹药技能期间命中 35 次 → 预期：层数停在 30，总增益 60%，之后命中不再增加
  - 场景：技能结束再次开启 → 预期：层数清零重新累积
- 实现计划：events=[hit, skillStart, battleStart]；primitives=[hitHook, skillTagGuard(ammo), battleStack(carveStack,0.02,30), clearOnSkillEnd]
  - 技能结束清理走技能生命周期，不触发购买或获得奖励。

### 三尺万象（`ammo-thousandforms`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_5_relic_bullet_2`
- 获取：shop(mechanism:ammo)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_bullet_2`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_bullet_2`
- 原生用途（内部）：干员开启弹药类技能时，攻击速度+100，持续15秒
- 转译理由：沿用原生触发与数值，补充同源刷新与多干员独立结算口径。
- 描述：干员开启弹药类技能时，攻击速度 +100，持续 15 秒；不同干员各自独立结算，同一干员的重复开启取最新一次时长。
- 效果：
  - trigger=`skillStart` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=skillOwner，geometry=self，count=1
    - params：`{"buff":"threeThousand","attackSpeed":100,"durationSec":15,"refresh":true}`
    - condition：`{"skillTag":"ammo"}`
    - stacking：同源=同一干员重复开启只刷新时长，不叠攻速；异源=不同干员各自独立
    - limits：null（不限）
    - 开启弹药技能时攻击速度 +100，持续 15 秒。
- 因果检查：
  - 场景：同一干员在 15 秒内再次开启弹药技能 → 预期：攻速仍为 +100，时长刷新为 15 秒
  - 场景：两名干员各自开启弹药技能 → 预期：两人同时获得攻速加成，互不覆盖
- 实现计划：events=[skillStart]；primitives=[skillStartHook, skillTagGuard(ammo), buffApply(threeThousand,atkSpeed+100,15s)]
  - 自动技能在行动检查中开始，本效果不递归开启下一个技能。

### 《雅集》（`ammo-anthology`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_5_relic_bullet_4`
- 获取：shop(mechanism:ammo)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_bullet_4`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_bullet_4`
- 原生用途（内部）：弹药类技能每次开启后，首次剩余30%的弹药时，补充最大弹药数量50%的弹药
- 转译理由：提高补弹比例并让补充派发真实的 reloaded 事件，使装填联动成立；同根 visited 防止它沿自身路径递归。
- 描述：弹药类技能开启后，首次剩余 30% 弹药时补充最大弹药量的 50%，且该补充会派发一次装填事件；补充为实际净入账，每场战斗每名干员最多触发三次。
- 效果：
  - trigger=`ammoUsed` action=`ammo` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"op":"add","amountRatioOfMax":0.5,"emitReloadedEvent":true}`
    - condition：`{"skillTag":"ammo","remainingRatioAtMost":0.3,"oncePerSkill":true}`
    - stacking：同源=同一技能内同源只触发一次；异源=派生的 reloaded 事件继承本被动 visited，不再回到本被动
    - limits：{"perBattle":3,"perDeployment":1,"perHour":null,"perRun":null,"reason":"高比例补弹，限制每战三次以保留弹药压力"}
    - 弹药首次降到 30% 时补充最大弹药的 50% 并派发装填事件，每战最多三次。
- 因果检查：
  - 场景：补弹派发 reloaded 后又被另一件装填收藏品捕获 → 预期：装填联动可正常触发，但本被动不因派生事件再次执行
  - 场景：同一技能内弹药反复跌破 30% → 预期：首次触发后 oncePerSkill 阻止同一技能重复触发
- 实现计划：events=[ammoUsed, reloaded]；primitives=[ammoUsedHook, ammoAdd(0.5*max), emitReloaded(rootCause), visited(passive,target)]
  - 派生事件先收集再结算，不依赖递归深度闸门。

### 烟花之手（`ammo-fireworkhand`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_4_relic_hand_7`
- 获取：shop(mechanism:ammo)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_4/items/rogue_4_relic_hand_7`
- 原生黑板：`/details/rogue_4/relics/rogue_4_relic_hand_7`
- 原生用途（内部）：【速射手】【回环射手】【哨戒铁卫】每次攻击命中时，有25%概率发射一枚额外子弹，造成相当于攻击力200%的群体物理伤害
- 转译理由：进击把原生概率额外伤害明确标注为进击暴击机制，并限定四邻群体伤害，不冒称原版暴击收藏品。
- 描述：速射手、回环射手、哨戒铁卫每次攻击命中时，有 25% 概率发射一枚额外子弹，对目标及其四邻造成该干员攻击力 200% 的群体物理伤害。此 25% 概率命中是进击暴击机制的显式转译，源表并无原生暴击收藏品。
- 效果：
  - trigger=`hit` action=`damage` lifecycle=`instant`
    - target：team=enemy，selection=hitTargetAndAdjacent，geometry=adjacent4，count=all
    - params：`{"damageType":"physical","atkRatio":2,"chance":0.25,"critMechanic":"assaultCrit"}`
    - condition：`{"archetypeIn":["速射手","回环射手","哨戒铁卫"],"critRoll":0.25}`
    - stacking：同源=每次命中独立掷一次，不共享同一次命中的结果；异源=与其它暴击效果按进击暴击规则分别结算
    - limits：null（不限）
    - 指定职业每次命中 25% 概率追加 200% 攻击力四邻物理伤害。
- 因果检查：
  - 场景：同一干员连续命中三次 → 预期：三次独立掷骰，可能出现多次追加，互不吞并
  - 场景：固定种子重复同一串命中 → 预期：暴击结果可复现，不暗中消耗额外随机数
- 实现计划：events=[hit, battleStart]；primitives=[hitHook, archetypeGuard, seededCritRoll(0.25), adjacent4Query, damage(physical,2.0*atk)]
  - 追加伤害走独立事件，可触发符合条件的联动，不按来源名屏蔽。

## 路线 element

### 讴歌者面纱（`element-voile`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_4_relic_fight_19`
- 获取：shop(mechanism:element)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_4/items/rogue_4_relic_fight_19`
- 原生黑板：`/details/rogue_4/relics/rogue_4_relic_fight_19`
- 原生用途（内部）：所有敌方单位受到的法术伤害+10%，受到的元素损伤+50%
- 转译理由：沿用原生双分账，补充“新出现敌人也受用”的运行时口径，避免只处理开局单位。
- 描述：所有敌人受到的法术伤害 +10%、受到的元素损伤 +50%；两类加成独立计算，元素损伤不折算为法术伤害。战斗中新出现的敌人同样受用。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=enemy，selection=allEnemies，geometry=field，count=all
    - params：`{"tag":"damageTakenMul","arts":1.1,"elementDamage":1.5}`
    - condition：`{"phase":"battleStart","affectsNewEnemies":true}`
    - stacking：同源=每战只结算一次；异源=与其它易伤按进击同类叠加规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"全场光环型效果，每战一次"}
    - 全场敌人法术受伤 +10%、元素受伤 +50%，新入场敌人同样生效。
- 因果检查：
  - 场景：战斗中途新刷出一名敌人 → 预期：该敌人同样按 +10% 法术受伤与 +50% 元素受伤结算
  - 场景：同一敌人同时受到法术与元素伤害 → 预期：两笔加成分别作用于各自账目，不互相折算
- 实现计划：events=[battleStart, hit]；primitives=[battleAura(damageTakenMul), enemySpawnInherit, splitDamageChannels]
  - 伤害结算时查询光环，不要求敌人开局已存在。

### 沃特大叔养护套装（`element-wotuncle`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_2_relic_fight_151`
- 获取：shop(mechanism:element)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_151`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_151`
- 原生用途（内部）：所有我方远程单位受到元素损伤减少40%
- 转译理由：数值与范围保留，明确只减元素损伤、不减普通伤害，避免与法抗/防御混淆。
- 描述：我方远程单位受到的元素损伤降低 40%；减免只作用于元素损伤，不减免普通法术或物理伤害。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=rangedAllies，geometry=field，count=all
    - params：`{"tag":"elementDamageTaken","op":"mul","value":0.6}`
    - condition：`{"phase":"battleStart","ownerDeployType":"ranged"}`
    - stacking：同源=每战一次；异源=与其它元素减伤按进击规则乘算
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开场一次性授予，持续整场"}
    - 远程单位元素损伤承受 -40%。
- 因果检查：
  - 场景：远程单位受到一次法术伤害与一次元素损伤 → 预期：仅元素损伤打折，法术伤害全额结算
  - 场景：战斗中途部署的远程单位 → 预期：同样获得减伤，不因开局未在场而漏发
- 实现计划：events=[battleStart, damageTaken]；primitives=[roleBuff(elementDamageTaken,0.6), deployTypeGuard(ranged), lateDeployInherit]
  - 减免在元素损伤账目上结算，与防御/法抗分开。

### “阿猛”（`element-ameng`）— rare

- 来源状态：nativeAdaptation；解锁日：第 6 天
- 图标：`rogue_5_relic_fight_4`
- 获取：shop(mechanism:element)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_fight_4`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_fight_4`
- 原生用途（内部）：所有敌方单位受到的元素伤害+100%
- 转译理由：明确区分“元素损伤积累”与“元素爆发伤害”，避免把两者混为一谈。
- 描述：所有敌人受到的元素伤害 +100%；该加成只作用于元素爆发结算出的伤害部分，独立于元素损伤积累速度。
- 效果：
  - trigger=`elementBurst` action=`addBuff` lifecycle=`instant`
    - target：team=enemy，selection=burstTarget，geometry=field，count=all
    - params：`{"tag":"elementDamage","op":"mul","value":2}`
    - condition：`{"targetTeam":"enemy"}`
    - stacking：同源=同一敌人同一爆发只结算一次加成；异源=与其它元素伤害加成合并
    - limits：null（不限）
    - 敌人元素爆发伤害 +100%。
- 因果检查：
  - 场景：敌人独立元素反复爆发 → 预期：每次爆发都按 +100% 结算伤害，不受旧冷却锁阻断
  - 场景：多个元素同时达到阈值 → 预期：按固定顺序各自结算并各自吃满加成
- 实现计划：events=[elementBurst, hit]；primitives=[elementBurstHook, elementDamageMul(2.0)]
  - 超额损伤继续结算，本加成不改变损伤积累。

### 灾难之源（`element-catastrophe`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_4_relic_fight_11`
- 获取：shop(mechanism:element)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_4/items/rogue_4_relic_fight_11`
- 原生黑板：`/details/rogue_4/relics/rogue_4_relic_fight_11`
- 原生用途（内部）：所有敌方单位受到的法术伤害+20%，受到的元素损伤+100%
- 转译理由：核对原生数值并明确与基础版的合并方式，避免多件 element 件隐性连乘失控。
- 描述：所有敌人受到的法术伤害 +20%、受到的元素损伤 +100%；与基础版同时存在时按进击同类叠加规则合并，不无限连乘。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=enemy，selection=allEnemies，geometry=field，count=all
    - params：`{"tag":"damageTakenMul","arts":1.2,"elementDamage":2}`
    - condition：`{"phase":"battleStart","affectsNewEnemies":true}`
    - stacking：同源=每战一次；异源=与其它元素易伤取同类最高或按规则线性相加，不连乘
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"全场光环，每战一次"}
    - 全场敌人法术受伤 +20%、元素受伤 +100%。
- 因果检查：
  - 场景：同时持有基础版与稀有版 → 预期：按进击同类叠加规则合并，结果可预测不爆炸
  - 场景：战斗中途新出现的敌人 → 预期：同样获得双分账易伤
- 实现计划：events=[battleStart, hit]；primitives=[battleAura(damageTakenMul), enemySpawnInherit, sameClassStackRule]
  - 元素易伤与元素爆发伤害是两个账目，本件只加受伤。

### 猎犬病特效药（`element-houndremedy`）— epic

- 来源状态：nativeAdaptation；解锁日：第 9 天
- 图标：`rogue_6_relic_fight_23`
- 获取：shop(mechanism:element)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_fight_23`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_fight_23`
- 原生用途（内部）：我方狂躁元素爆发后不再受到持续伤害，且期间攻击速度额外+50
- 转译理由：保留“爆发后免疫持续伤害并获得攻速”的语义，泛化为任一我方元素爆发，并明确刷新不叠层。
- 描述：我方触发元素爆发后不再受到该爆发的持续伤害，且 8 秒内攻击速度 +50；重复爆发刷新时长，不叠加攻速。
- 效果：
  - trigger=`elementBurst` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=burstSourceOwner，geometry=field，count=all
    - params：`{"buff":"burstAfterglow","suppressDotFromBurst":true,"attackSpeed":50,"durationSec":8,"refresh":true}`
    - condition：`{"sourceTeam":"ally","burstOwnerOnField":true}`
    - stacking：同源=同源重复爆发刷新时长，不叠攻速；异源=与其它攻速增益合并
    - limits：null（不限）
    - 我方爆发后免持续伤害并获 +50 攻速 8 秒，可刷新。
- 因果检查：
  - 场景：同一干员在 8 秒内触发两次元素爆发 → 预期：攻速保持 +50，时长刷新，且两次的持续伤害都被抑制
  - 场景：敌方元素爆发 → 预期：不满足 sourceTeam=ally，不触发
- 实现计划：events=[elementBurst, damageTaken]；primitives=[elementBurstHook, suppressDotTag, buffApply(burstAfterglow,atkSpeed+50,8s)]
  - 只抑制该爆发产生的持续伤害，不影响其它元素伤害来源。

### 河谷祭祈（`element-riverblessing`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_6_relic_fight_22`
- 获取：shop(mechanism:element)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_fight_22`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_fight_22`
- 原生用途（内部）：我方凋亡、灼燃、神经和侵蚀损伤的爆发效果增强
- 转译理由：原生未给数值；进击补 50% 爆发伤害与 25% 后续易伤，并强调每次独立爆发各自结算。
- 描述：我方造成的凋亡、灼燃、神经、侵蚀爆发伤害提高 50%；爆发后 3 秒内该敌人受到的同类元素损伤 +25%。每次独立爆发分别结算，重复施加不因目标已有状态被吞。
- 效果：
  - trigger=`elementBurst` action=`addBuff` lifecycle=`instant`
    - target：team=enemy，selection=burstTarget，geometry=field，count=all
    - params：`{"tag":"burstDamage","op":"mul","value":1.5}`
    - condition：`{"elementIn":["凋亡","灼燃","神经","侵蚀"],"sourceTeam":"ally"}`
    - stacking：同源=同一爆发只结算一次；异源=与其它爆发增伤合并
    - limits：null（不限）
    - 指定元素爆发伤害 +50%。
  - trigger=`elementBurst` action=`addBuff` lifecycle=`instant`
    - target：team=enemy，selection=burstTarget，geometry=field，count=all
    - params：`{"buff":"elementVuln","elementDamageTakenMul":1.25,"durationSec":3,"refresh":true}`
    - condition：`{"elementIn":["凋亡","灼燃","神经","侵蚀"],"sourceTeam":"ally"}`
    - stacking：同源=同源重复爆发刷新时长，不叠倍率；异源=与其它元素易伤合并
    - limits：null（不限）
    - 爆发后敌人元素损伤承受 +25%，持续 3 秒。
- 因果检查：
  - 场景：同一敌人先后触发两次灼燃爆发 → 预期：两次各获 50% 增伤，易伤刷新，不合并为一次
  - 场景：爆发被免疫或未触发 → 预期：不结算增伤与易伤
- 实现计划：events=[elementBurst, battleStart]；primitives=[elementBurstHook, burstDamageMul(1.5), elementVulnBuff(1.25,3s)]
  - 同根 visited(passive,target) 防止同一次爆发沿自身路径重复加成。

## 路线 summon

### 伥物房账簿（`summon-ledger`）— common

- 来源状态：nativeAdaptation；解锁日：第 3 天
- 图标：`rogue_5_relic_fight_10`
- 获取：shop(mechanism:summon)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_fight_10`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_fight_10`
- 原生用途（内部）：战术道具，召唤物，装置的部署费用减10
- 转译理由：明确只作用于部署点数并保留 0 下限，避免与金币、购买价混淆。
- 描述：召唤物、装置与战术道具的部署费用 -10（最低 0）；只改本战斗的部署点数账目，不改购买价或跨战斗金币。
- 效果：
  - trigger=`deploymentCost` action=`spCost` lifecycle=`instant`
    - target：team=ally，selection=deployingEntity，geometry=self，count=1
    - params：`{"currency":"dp","op":"add","value":-10,"min":0,"costModifierOnly":true}`
    - condition：`{"spawnKindIn":["summon","device","tacticalItem"]}`
    - stacking：同源=同源每次部署只减一次；异源=与其它费用减少按进击规则相加后取下限
    - limits：null（不限）
    - 召唤物/装置/战术道具部署费用 -10，最低 0。
- 因果检查：
  - 场景：召唤物原生费用低于 10 → 预期：实际费用停在 0，不会变成负数或返还点数
  - 场景：购买商店物品 → 预期：购买价不受影响，金币账目不变
- 实现计划：events=[deploymentCost]；primitives=[spawnKindGuard, spCostAdd(-10,min=0,dp)]
  - 只改本战斗部署点数，不写回跨战斗金币。 部署计价前计算一次加减修饰，不在已支付后的再部署通知中累积扣费；本次为免费技能再部署时仍支付零。

### 支柱-次要战场（`summon-minorbattle`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_1_relic_p27`
- 获取：shop(mechanism:summon)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_p27`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_p27`
- 原生用途（内部）：所有【辅助】干员的【召唤物】攻击力+50%
- 转译理由：沿用原生职业限定与数值，明确只作用于召唤物本体，不与干员白值混算。
- 描述：所有辅助干员的召唤物攻击力 +50%；只作用于召唤物，不改干员自身白值。召唤物退场后再召唤为独立结算。
- 效果：
  - trigger=`summonSpawned` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=spawnedEntity，geometry=self，count=1
    - params：`{"buff":"minorBattle","atkRatio":0.5}`
    - condition：`{"ownerProfession":"SUPPORT","spawnKind":"summon"}`
    - stacking：同源=同一召唤物只授予一次；异源=与其它召唤物增益合并
    - limits：null（不限）
    - 辅助干员的召唤物攻击力 +50%。
- 因果检查：
  - 场景：辅助干员召唤物被击倒后重新召唤 → 预期：新召唤物独立获得 +50%，旧单位的增益随退场清除
  - 场景：辅助干员自身攻击 → 预期：干员白值不受影响，加成只在召唤物身上
- 实现计划：events=[summonSpawned, summonDied]；primitives=[summonSpawnedHook, ownerProfessionGuard, summonBuff(atk+50%)]
  - 增益挂在召唤物实体上，随召唤物生命周期清理。

### 极地改型包（`summon-arcticpack`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_3_relic_fight_15`
- 获取：shop(mechanism:summon)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_15`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_15`
- 原生用途（内部）：支援道具使用时会在周围4格同时使用
- 转译理由：进击没有原作可手动使用的支援道具，改写为实际可获得的白铁支援装置入场补给；保留四邻主题，明确技力与治疗而不声称复刻缺失道具效果。
- 描述：白铁的支援装置或工坊修复台每次真正入场时，四邻存活友军各获得2技力，并回复相当于装置主人当前攻击力20%的生命。装置存活期间的满血再部署不重发；再次真正入场可重新触发。
- 效果：
  - trigger=`summonSpawned` action=`spGain` lifecycle=`instant`
    - target：team=ally，selection=spawnedEntityAdjacent，geometry=adjacent4，count=all
    - params：`{"amount":2,"netOnly":true}`
    - condition：`{"templateIds":["token_10027_ironmn_pile2","assault_workshop_platform"],"requireRealOwner":true,"realEntryOnly":true}`
    - stacking：同源=每个装置每次真实入场各自结算一次；异源=其它入场效果独立沿因果路径结算
    - limits：null（不限）
    - 四邻存活友军各实际入账最多2技力，溢出不计收益。
  - trigger=`summonSpawned` action=`heal` lifecycle=`instant`
    - target：team=ally，selection=spawnedEntityAdjacent，geometry=adjacent4，count=all
    - params：`{"atkScale":0.2,"scaleBasis":"summonOwnerCurrentAtk","flatHpScale":false}`
    - condition：`{"templateIds":["token_10027_ironmn_pile2","assault_workshop_platform"],"requireRealOwner":true,"realEntryOnly":true}`
    - stacking：同源=每个装置每次真实入场各自结算一次；异源=其它入场效果独立沿因果路径结算
    - limits：null（不限）
    - 四邻存活友军各回复装置主人当前攻击力20%的生命；不是原生固定生命数值，不额外乘五。
- 因果检查：
  - 场景：四邻有两个技力未满友军和一个满技力友军 → 预期：三名存活友军都得到实际治疗，只有未满者产生净技力入账。
  - 场景：装置存活时被免费满血再部署 → 预期：没有真实入场事件，不重发补给；死亡后真实再入场可再次补给。
  - 场景：治疗充能经其它被动回到同源 → 预期：各派生路径继承访问记录，同一效果对同一对象不形成同步自回循环，独立装置入场仍可触发。
- 实现计划：events=[summonSpawned]；primitives=[realEntryForWhitelistedSupportDevice, adjacent4Query, gainSpNet(2), heal(ownerCurrentAtk*.2), perDerivedPathVisited]
  - 直接使用首发池真实装置，不新增不可获得的支援道具系统。

### 衍生者终端-超级改（`summon-derivative`）— rare

- 来源状态：nativeAdaptation；解锁日：第 4 天
- 图标：`rogue_2_relic_fight_149`
- 获取：shop(mechanism:summon)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_149`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_149`
- 原生用途（内部）：【召唤物】生命值+30%，攻击力+30%，攻击速度+30
- 转译理由：沿用原生三维加成，补充“仅召唤物、随退场清除”的运行时口径。
- 描述：所有召唤物生命值 +30%、攻击力 +30%、攻击速度 +30；数值只对召唤物生效，随召唤物退场清除，不作用于干员。
- 效果：
  - trigger=`summonSpawned` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=spawnedEntity，geometry=self，count=1
    - params：`{"buff":"derivativeSuper","hpMul":1.3,"atkRatio":0.3,"attackSpeed":30}`
    - condition：`{"spawnKind":"summon"}`
    - stacking：同源=同一召唤物只授予一次；异源=与其它召唤物增益合并
    - limits：null（不限）
    - 召唤物生命 +30%、攻击 +30%、攻速 +30。
- 因果检查：
  - 场景：召唤物本体加成的生命按原生生命点数计算 → 预期：固定治疗与护盾按新上限的对应比例结算，不出现治疗失效
  - 场景：该召唤物被击倒或主动撤退退场 → 预期：三项加成随召唤物实体一起清除
- 实现计划：events=[summonSpawned, summonDied]；primitives=[summonSpawnedHook, summonBuff(hp/atk/as)]
  - 生命为乘区，固定值效果在结算时按新上限换算。

### 散轶诗简（`summon-poeticrelic`）— epic

- 来源状态：nativeAdaptation；解锁日：第 7 天
- 图标：`rogue_2_relic_fight_148`
- 获取：shop(mechanism:summon)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_148`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_148`
- 原生用途（内部）：【召唤物】不再消耗部署位
- 转译理由：保留原生核心规则，并写明与干员备用格、原生召唤上限的边界，避免无上限铺场。
- 描述：召唤物不再消耗部署位（人口），但仍不能占用干员备用格，且原生技能召唤物上限照旧。此件改变核心部署规则，收益受原生召唤上限约束。
- 效果：
  - trigger=`summonSpawned` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=spawnedEntity，geometry=self，count=1
    - params：`{"tag":"deploymentSlotCost","value":0,"scope":"summon","keepNativeCap":true}`
    - condition：`{"spawnKind":"summon"}`
    - stacking：同源=每战一次生效，不叠加；异源=与其它改变人口规则的效果独立
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"规则型开关，每战一份"}
    - 召唤物不占人口，受原生召唤上限约束。
- 因果检查：
  - 场景：干员本体占满人口后召唤召唤物 → 预期：召唤物仍可不占人口入场，但受原生召唤上限
  - 场景：检查干员备用区容量 → 预期：召唤物仍不进入干员备用格，容量不变
- 实现计划：events=[summonSpawned, battleStart]；primitives=[deploymentSlotCostOverride(summon,0), nativeSummonCapQuery]
  - 人口只计干员，召唤物原本单独计数，本件把其占用归零。

### 空羽兽（`summon-windfeather`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_3_relic_fight_18`
- 获取：shop(mechanism:summon)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_18`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_18`
- 原生用途（内部）：【召唤物】生命值+30%，攻击力+30%，且在场时使它所属的干员攻击力+60%
- 转译理由：保留召唤物本体加成与“在场时赋能主人”，并明确主人加成只保留一层、随最后一个召唤物退场消失。
- 描述：召唤物生命值 +30%、攻击力 +30%；召唤物在场时其所属干员攻击力 +60%。同一干员由多个召唤物提供的加成只保留一层，召唤物全部退场后加成立即消失。
- 效果：
  - trigger=`summonSpawned` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=spawnedEntity，geometry=self，count=1
    - params：`{"buff":"windFeatherSummon","hpMul":1.3,"atkRatio":0.3}`
    - condition：`{"spawnKind":"summon"}`
    - stacking：同源=同一召唤物只授予一次；异源=与其它召唤物增益合并
    - limits：null（不限）
    - 召唤物生命 +30%、攻击 +30%。
  - trigger=`summonSpawned` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=summonOwner，geometry=field，count=1
    - params：`{"buff":"windFeatherOwner","atkRatio":0.6,"maxLayers":1,"sourceRef":"summonSpawned"}`
    - condition：`{"spawnKind":"summon","ownerOnField":true}`
    - stacking：同源=同一干员只保留一层，多个召唤物不叠加；异源=与其它攻击力增益合并
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":null,"reason":"由召唤物存在状态驱动，不需要次数闸门"}
    - 召唤物在场时其所属干员攻击力 +60%，只保留一层。
  - trigger=`summonDied` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=ownerOfSummon，geometry=field，count=1
    - params：`{"tag":"buffRemove","buff":"windFeatherOwner"}`
    - condition：`{"noRemainingSummonOfOwner":true}`
    - stacking：同源=只在同一主人已无召唤物在场时移除；异源=其它来源的同类增益不受影响
    - limits：null（不限）
    - 该干员的召唤物全部退场后移除主人攻击力加成。
- 因果检查：
  - 场景：同一干员有两个召唤物同时在場 → 预期：主人攻击力仍只 +60%，不叠到 120%
  - 场景：两个召唤物中的第一个退场 → 预期：主人加成保留；第二个也退场后才移除
- 实现计划：events=[summonSpawned, summonDied]；primitives=[summonSpawnedHook, summonDiedHook, ownerBuff(singleLayer), ownerSummonCountQuery]
  - 主人加成随召唤物存在条件驱动，不依赖每秒轮询。

## 路线 healShield

### 佣兵保单（`heal-mercenarypolicy`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_2_relic_fight_150`
- 获取：shop(mechanism:healShield)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_150`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_150`
- 原生用途（内部）：所有我方单位获得10%的庇护，灯火低于50时改为获得35%的庇护
- 转译理由：进击无“灯火”资源，取原生基础线下 10% 庇护常驻，并注明光环刷新不产生收益。
- 描述：我方全体干员获得 10% 庇护（减伤）；光环的持续刷新只维持减伤，不触发新的治疗或护盾收益。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"tag":"shelter","op":"add","value":0.1,"refreshOnlyNoGain":true}`
    - condition：`{"phase":"battleStart","auraRefresh":true}`
    - stacking：同源=每战一次，刷新不叠层；异源=与其它庇护按进击同类叠加规则
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"常驻减伤，每战一次"}
    - 全队获得 10% 庇护减伤。
- 因果检查：
  - 场景：战斗中途部署新干员 → 预期：新干员同样获得 10% 庇护
  - 场景：光环多次刷新 → 预期：只维持减伤，不产生治疗或护盾事件
- 实现计划：events=[battleStart, damageTaken]；primitives=[battleAura(shelter,0.1), refreshWithoutPayout, lateDeployInherit]
  - 庇护在受伤结算中生效，与治疗保持独立。

### 鳞皮壳盾（`heal-scaleshell`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_3_relic_fight_13`
- 获取：shop(mechanism:healShield)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_13`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_13`
- 原生用途（内部）：所有我方远程单位部署时获得3层护盾
- 转译理由：原生只给层数未给数值；进击以最大生命比例定义每层护盾量，并逐层派发 shieldBroken。
- 描述：我方远程单位部署时获得 3 层护盾，每层护盾量为最大生命的 15%（至少 1 点）；每层被打破时各结算一次 shieldBroken。
- 效果：
  - trigger=`redeploy` action=`shield` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"layers":3,"layerAmountRatioMaxHp":0.15,"minAmount":1,"emitShieldBrokenPerLayer":true}`
    - condition：`{"entryKind":"deploy","ownerDeployType":"ranged"}`
    - stacking：同源=同源重复部署刷新为 3 层，不叠加上限；异源=与其它护盾来源并存，分别扣减
    - limits：null（不限）
    - 远程单位部署获 3 层护盾，每层 15% 最大生命（至少 1）。
- 因果检查：
  - 场景：三层护盾先后被打破 → 预期：每层各派发一次 shieldBroken，共三次
  - 场景：远程单位再部署 → 预期：护盾刷新为 3 层，覆盖旧值而不是加上去
- 实现计划：events=[redeploy, shieldBroken]；primitives=[redeployEntryHook, shieldGrant(layers=3,15%maxHp), shieldBrokenPerLayer]
  - 护盾量基于归一化后的生命上限（已乘五）。

### 药枚（`heal-pharmacon`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_2_relic_fight_129`
- 获取：shop(mechanism:healShield)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_129`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_129`
- 原生用途（内部）：所有我方单位在部署时获得2层护盾
- 转译理由：原生只给层数；进击以最大生命比例定义每层护盾量，并让每层独立派发 shieldBroken，使护盾成为可联动的真实账目。
- 描述：我方全体干员部署时获得 2 层护盾，每层为最大生命的 12%（至少 1 点）；每层被打破时各派发一次 shieldBroken，可被后续护盾联动捕获。
- 效果：
  - trigger=`redeploy` action=`shield` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"layers":2,"layerAmountRatioMaxHp":0.12,"minAmount":1,"emitShieldBrokenPerLayer":true}`
    - condition：`{"entryKind":"deploy"}`
    - stacking：同源=同源重复部署刷新为 2 层，不叠加；异源=与其它护盾来源并存，分别扣减
    - limits：null（不限）
    - 全体部署获 2 层护盾，每层 12% 最大生命（至少 1）。
- 因果检查：
  - 场景：两层护盾先后被打破 → 预期：每层各派发一次 shieldBroken，共两次
  - 场景：同一干员再次部署 → 预期：护盾刷新为 2 层，覆盖旧值而非累加
- 实现计划：events=[redeploy, shieldBroken]；primitives=[redeployEntryHook, shieldGrant(layers=2,12%maxHp), shieldBrokenPerLayer]
  - 所有职业通用，护盾量基于归一化后的生命上限。

### “庇护”（`heal-sanctuary`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_6_relic_fight_7`
- 获取：shop(mechanism:healShield)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_fight_7`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_fight_7`
- 原生用途（内部）：高台干员部署时立刻获得最大生命100%的屏障
- 转译理由：沿用原生高台限定与 100% 屏障，明确屏障只吸收伤害、重复部署刷新。
- 描述：高台（远程位）干员部署时立即获得一层等于其最大生命 100% 的屏障；屏障只吸收伤害、不参与治疗加成，重复部署刷新屏障上限。
- 效果：
  - trigger=`redeploy` action=`shield` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"layers":1,"layerAmountRatioMaxHp":1,"refresh":true}`
    - condition：`{"entryKind":"deploy","ownerPosition":"highGround"}`
    - stacking：同源=同源重复部署只刷新屏障上限，不叠层；异源=与其它护盾并存，分别扣减
    - limits：null（不限）
    - 高台部署获一层 100% 最大生命屏障，可刷新。
- 因果检查：
  - 场景：高台干员在屏障未破时再次部署 → 预期：屏障上限刷新为当前最大生命的 100%，不叠加成两层
  - 场景：近战位（低地）干员部署 → 预期：不满足 highGround 条件，不获得屏障
- 实现计划：events=[redeploy, shieldBroken]；primitives=[redeployEntryHook, positionGuard(highGround), shieldGrant(1,100%maxHp,refresh)]
  - 高台判定使用原生部署位类型，不使用坐标猜测。

### 王命凡形（`heal-kingform`）— epic

- 来源状态：nativeAdaptation；解锁日：第 9 天
- 图标：`rogue_4_relic_fight_27`
- 获取：shop(mechanism:healShield)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_4/items/rogue_4_relic_fight_27`
- 原生黑板：`/details/rogue_4/relics/rogue_4_relic_fight_27`
- 原生用途（内部）：护盾值+3，将剩余的生命值上限全部转化为等量护盾值，之后将最大生命值变为1
- 转译理由：原生把最大生命压到 1 过于极端；进击保留“生命转护盾”结构，改为最大生命 -40%、护盾为失去量的 200%，保留可理解的代价。
- 描述：战斗开始时，全体干员最大生命降低 40%（当前生命按比例同步，最低 1），同时获得等于所失去最大生命 200% 的护盾（即原最大生命的 80%）。代价与收益同时生效，不能只取其一。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"tag":"bodyStats","op":"mul","maxHp":0.6,"currentHpFollow":"scale","minHp":1}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=每战一次；异源=与其它最大生命修改按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局规则型修改，每战一次"}
    - 开局全队最大生命 -40%，当前生命按比例，最低 1。
  - trigger=`battleStart` action=`shield` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"layers":1,"amountRatioOfOriginalMaxHp":0.8,"minAmount":1}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=每战一次；异源=与其它护盾来源并存
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局规则型收益，每战一次"}
    - 开局全队获得等于原最大生命 80% 的护盾。
- 因果检查：
  - 场景：一名干员在开局后接受治疗 → 预期：最大生命与当前生命同步为 0.6 倍，治疗按新上限比例正常生效
  - 场景：护盾先于生命被打空 → 预期：生命继续按 0.6 倍上限承伤，最低生命为 1 的规则只用于开场换算
- 实现计划：events=[battleStart, shieldBroken]；primitives=[battleStartHook, maxHpMulWithCurrentScale(0.6), shieldGrant(1,80%originalMaxHp)]
  - 护盾量按原最大生命计算，随后生命上限下降，两者共同构成代价。

### 湖中神盾（`heal-lakeshield`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_3_relic_fight_21`
- 获取：shop(mechanism:healShield)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_21`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_21`
- 原生用途（内部）：护盾值+1；战斗开始时如果拥有护盾值，所有我方单位的最大生命+60%
- 转译理由：进击无局外“护盾值”资源，改为条件检查战斗开场是否已有护盾；满足时给全队生命与护盾作为 healShield 核心规则。
- 描述：战斗开始时，若我方至少有一名干员已拥有护盾层，则全体干员最大生命 +60%（当前生命按比例同步），并额外获得 1 层等于 15% 最大生命的护盾；无护盾时不触发，这是明确的条件核心规则。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"tag":"bodyStats","op":"mul","maxHp":1.6,"currentHpFollow":"scale"}`
    - condition：`{"phase":"battleStart","requiresAnyAllyShield":true}`
    - stacking：同源=每战一次；异源=与其它最大生命修改按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"条件开局规则，每战一次"}
    - 开场已有护盾时，全队最大生命 +60%。
  - trigger=`battleStart` action=`shield` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"layers":1,"layerAmountRatioMaxHp":0.15,"minAmount":1}`
    - condition：`{"phase":"battleStart","requiresAnyAllyShield":true}`
    - stacking：同源=每战一次；异源=与其它护盾来源并存
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"条件开局规则，每战一次"}
    - 开场已有护盾时，全队额外获得 1 层 15% 最大生命护盾。
- 因果检查：
  - 场景：编队中已有其它收藏品在开场授予护盾 → 预期：全队最大生命 +60% 并获得一层护盾，治疗按新上限比例结算
  - 场景：开场无任何护盾层 → 预期：两段效果均不触发，不产生生命或护盾收益
- 实现计划：events=[battleStart, shieldBroken]；primitives=[battleStartHook, allyShieldCountQuery, maxHpMulWithCurrentScale(1.6), shieldGrant(1,15%maxHp)]
  - 生命增益同步当前生命，避免只改上限导致治疗失效。

## 路线 blockCounter

### “摘花”（`block-pickflower`）— common

- 来源状态：nativeAdaptation；解锁日：第 3 天
- 图标：`rogue_5_relic_custog_2`
- 获取：shop(mechanism:blockCounter)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_custog_2`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_custog_2`
- 原生用途（内部）：所有【近战】干员，部署费用+3，阻挡数+1，防御力+50%
- 转译理由：沿用原生代价与收益组合，明确费用下限 0 且只改本战斗部署点数。
- 描述：所有近战干员部署费用 +3（最低 0）、阻挡数 +1、防御力 +50%；费用增加与强化同时生效，不能只取强化。
- 效果：
  - trigger=`deploymentCost` action=`spCost` lifecycle=`instant`
    - target：team=ally，selection=deployingEntity，geometry=self，count=1
    - params：`{"currency":"dp","op":"add","value":3,"min":0,"costModifierOnly":true}`
    - condition：`{"spawnKind":"operator","ownerDeployType":"melee"}`
    - stacking：同源=同源每次部署只加一次；异源=与其它费用修改相加后取下限
    - limits：null（不限）
    - 近战干员部署费用 +3，最低 0。
  - trigger=`redeploy` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"tag":"bodyStats","blockCountAdd":1,"defMul":1.5}`
    - condition：`{"spawnKind":"operator","ownerDeployType":"melee"}`
    - stacking：同源=同源每名干员只授予一次；异源=与其它防御修改按进击规则合并
    - limits：null（不限）
    - 近战干员阻挡 +1、防御 +50%。
- 因果检查：
  - 场景：近战干员当前部署费用为0 → 预期：正常入场本次费用加3为3；技能免费再部署仍为0，属性只授予一次
  - 场景：远程干员部署 → 预期：不满足近战条件，不获得费用或防御修改
- 实现计划：events=[deploymentCost, redeploy]；primitives=[deployTypeGuard(melee), spCostAdd(3,min=0,dp), blockCountAdd(1), defMul(1.5)]
  - 费用只改本战斗部署点数，不写回购买价或金币。 部署计价前计算一次加减修饰，不在已支付后的再部署通知中累积扣费；本次为免费技能再部署时仍支付零。

### 城墙之子（`block-wallchild`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_4_relic_fight_6`
- 获取：shop(mechanism:blockCounter)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_4/items/rogue_4_relic_fight_6`
- 原生黑板：`/details/rogue_4/relics/rogue_4_relic_fight_6`
- 原生用途（内部）：部署在蓝色目标点周围8格的干员阻挡数+2，最大生命值+50%
- 转译理由：把原生“周围8格”明确为八邻（切比雪夫距离一）并按部署格判定，避免被误读为半径八。
- 描述：部署在蓝色目标点八邻内的我方干员阻挡数 +2、最大生命 +50%；八邻是切比雪夫距离一，不是半径八格。区域外的干员不受影响。
- 效果：
  - trigger=`redeploy` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=selfWithinGoalAdjacent8，geometry=adjacent8，count=1
    - params：`{"tag":"bodyStats","blockCountAdd":2,"maxHpMul":1.5,"currentHpFollow":"scale"}`
    - condition：`{"entryKind":"deploy","withinGoalAdjacent8":true}`
    - stacking：同源=同源每名干员只授予一次；异源=与其它阻挡/生命修改按进击规则合并
    - limits：null（不限）
    - 蓝目标点八邻内干员阻挡 +2、最大生命 +50%。
- 因果检查：
  - 场景：干员部署在蓝目标点对角线相邻格 → 预期：切比雪夫距离为 1，属于八邻，获得加成
  - 场景：干员部署在距蓝目标点两格处 → 预期：不属于八邻，不获得加成
- 实现计划：events=[redeploy, battleStart]；primitives=[redeployEntryHook, chebyshevWithin(tile,goal,1), blockCountAdd(2), maxHpMulScaled(1.5)]
  - 八邻判定使用切比雪夫距离一，与四邻曼哈顿距离一区分。

### 铁卫-临时要塞（`block-tempfortress`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_2_relic_fight_133`
- 获取：shop(mechanism:blockCounter)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_133`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_133`
- 原生用途（内部）：【重装】干员部署后15秒内攻击力和防御力+100%，且阻挡数+1
- 转译理由：沿用原生时长与数值，明确加成到期即结束、同源重复部署刷新为 15 秒而非累加。
- 描述：重装干员部署后 15 秒内攻击力、防御力 +100% 且阻挡数 +1；15 秒后加成结束，不刷新为永久。
- 效果：
  - trigger=`redeploy` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"tempFortress","atkRatio":1,"defMul":2,"blockCountAdd":1,"durationSec":15,"refresh":true}`
    - condition：`{"ownerProfession":"TANK","entryKind":"deploy"}`
    - stacking：同源=同源重复部署刷新为 15 秒时长，数值不叠乘；异源=与其它攻防增益按进击规则合并
    - limits：null（不限）
    - 重装部署后 15 秒内攻击 +100%、防御 +100%、阻挡 +1。
- 因果检查：
  - 场景：重装干员在 15 秒内再次部署 → 预期：时长刷新为 15 秒，攻防仍为 +100%，不叠加为 +200%
  - 场景：加成到期后继续战斗 → 预期：攻防与阻挡恢复基础值，不残留
- 实现计划：events=[redeploy, battleStart]；primitives=[professionGuard(TANK), timedBuff(tempFortress,15s), atkRatio(1.0), defMul(2.0), blockCountAdd(1)]
  - buff 到期由战斗时钟清理，不写回身体基础值。

### 折戟-一夫当关（`block-unyielding`）— rare

- 来源状态：nativeAdaptation；解锁日：第 4 天
- 图标：`rogue_1_relic_p09`
- 获取：shop(mechanism:blockCounter)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_p09`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_p09`
- 原生用途（内部）：所有【近卫】干员的阻挡数+1
- 转译理由：原生只加阻挡；进击补充“多阻挡时减伤”的条件强化，使 blockCounter 路线有攻守抉择。
- 描述：近卫干员阻挡数 +1；其阻挡 2 名及以上敌人时受到的伤害 -20%。未满足阻挡条件时只保留阻挡加成，条件不满足不产生减伤。
- 效果：
  - trigger=`redeploy` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"tag":"blockCount","op":"add","value":1}`
    - condition：`{"ownerProfession":"WARRIOR","entryKind":"deploy"}`
    - stacking：同源=同源每名干员只授予一次；异源=与其它阻挡修改相加
    - limits：null（不限）
    - 近卫干员阻挡数 +1。
  - trigger=`damageTaken` action=`addBuff` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"tag":"damageTaken","op":"mul","value":0.8}`
    - condition：`{"ownerProfession":"WARRIOR","blockingCountAtLeast":2}`
    - stacking：同源=同源每次受击只打折一次；异源=与其它减伤按进击规则乘算
    - limits：null（不限）
    - 阻挡 2 名及以上敌人时受伤 -20%。
- 因果检查：
  - 场景：近卫只阻挡 1 名敌人时受到攻击 → 预期：只有阻挡加成，不减伤
  - 场景：近卫阻挡 3 名敌人时连续受击 → 预期：每次受击各按 -20% 结算，不减成乘区叠加
- 实现计划：events=[redeploy, damageTaken]；primitives=[professionGuard(WARRIOR), blockCountAdd(1), blockingCountQuery, damageTakenMul(0.8)]
  - 阻挡数为运行时读取，不依赖开战快照。

### “忠义”（`block-loyalty`）— epic

- 来源状态：nativeAdaptation；解锁日：第 9 天
- 图标：`rogue_1_relic_q34`
- 获取：shop(mechanism:blockCounter)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_q34`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_q34`
- 原生用途（内部）：所有我方单位阻挡3名及以上敌人时，每秒回复150点生命
- 转译理由：沿用原生阈值与治疗量，明确满血不计入实际治疗、光环刷新不产生收益。
- 描述：我方单位阻挡 3 名及以上敌人时，每秒回复 150 点生命；光环保活不触发，回复按实际净入账统计，满血时不产生虚假治疗收益。
- 效果：
  - trigger=`battleStart` action=`heal` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"amount":150,"periodSec":1,"countNetOnly":true,"noGainOnAuraRefresh":true}`
    - condition：`{"blockingCountAtLeast":3,"periodSec":1}`
    - stacking：同源=同源每秒只回复一次，刷新不叠治疗；异源=与其它治疗来源分别结算
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":null,"reason":"周期由战斗时钟与阻挡阈值共同约束"}
    - 阻挡 3 名及以上敌人时每秒回复 150 生命。
- 因果检查：
  - 场景：干员阻挡 3 名敌人但生命已满 → 预期：不产生净治疗入账，不触发虚假治疗联动
  - 场景：干员从阻挡 3 名减为 2 名 → 预期：下一个周期起停止回复
- 实现计划：events=[battleStart, heal, damageTaken]；primitives=[battleAura(periodSec=1), blockingCountQuery, heal(150,netOnly)]
  - 光环保活时不重复给治疗收益，实际入账为回复量与缺口的最小值。

### 尖刺之手（`block-spikehand`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_1_relic_p41`
- 获取：shop(mechanism:blockCounter)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_p41`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_p41`
- 原生用途（内部）：【铁卫】、【驭法铁卫】和【决战者】对自身阻挡的敌人每秒造成自身防御力100%的法术伤害
- 转译理由：保留原生每秒防御力转伤机制，明确每个阻挡目标独立结算并允许触发联动；周期挂在战斗时钟上而非伪造攻击事件。
- 描述：铁卫、驭法铁卫、决战者每秒对自身阻挡的每个敌人造成其防御力 100% 的法术伤害；每次结算为独立伤害，可正常触发击杀与后续联动，不被旧元素冷却锁阻断。
- 效果：
  - trigger=`battleStart` action=`damage` lifecycle=`battle`
    - target：team=enemy，selection=blockedEnemies，geometry=self，count=all
    - params：`{"damageType":"arts","defRatio":1,"periodSec":1}`
    - condition：`{"ownerProfessionIn":["铁卫","驭法铁卫","决战者"],"periodSec":1}`
    - stacking：同源=同源对同一目标每周期只结算一次；异源=不同干员各自对自身阻挡目标结算
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":null,"reason":"周期由战斗时钟驱动，受拦截目标数量自然约束"}
    - 指定重装职业每秒对每个阻挡目标造成 100% 防御力法术伤害。
- 因果检查：
  - 场景：一名铁卫同时阻挡两名敌人 → 预期：每周期对两名敌人各结算一次独立法术伤害
  - 场景：阻挡目标被该伤害击杀 → 预期：击杀正常结算，其后的击杀联动可被触发
- 实现计划：events=[battleStart, hit, kill]；primitives=[battleAura(periodSec=1), blockedEnemyQuery, damage(arts,1.0*def)]
  - 周期伤害走独立事件，可参与击杀与联动，不按内部来源名屏蔽。

## 路线 pierceCrit

### 圆石祭坛（`pierce-altar`）— common

- 来源状态：nativeAdaptation；解锁日：第 3 天
- 图标：`rogue_3_relic_fight_22`
- 获取：shop(mechanism:pierceCrit)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_22`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_22`
- 原生用途（内部）：战斗后有概率使所有我方单位的攻击力和防御力永久+5%（最多叠加10层）
- 转译理由：明确把原生“有概率”改为确定性成长并保留 10 层上限，避免用概率白值冒充确定性收益。
- 描述：每场战斗胜利后，全体干员攻击力与防御力永久 +5%，最多 10 层；层数整局保留、跨战斗累积。进击将其定为确定性成长，不再使用原生概率。
- 效果：
  - trigger=`battleEnd` action=`growth` lifecycle=`run`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"atkRatioPerStack":0.05,"defRatioPerStack":0.05,"maxStacks":10,"duration":"run"}`
    - condition：`{"victory":true}`
    - stacking：同源=同源每场胜利叠 1 层，封顶 10 层后不再增加；异源=与其它局内成长按进击规则线性相加
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":10,"reason":"整局最多 10 层，对应原生叠加上限"}
    - 每场胜利后全队攻击与防御永久 +5%，最多 10 层。
- 因果检查：
  - 场景：连续赢得 12 场战斗 → 预期：层数停在 10，攻防停在 +50%，之后不再增长
  - 场景：战斗失败但生命为正 → 预期：不结算成长层数
- 实现计划：events=[battleEnd]；primitives=[battleEndHook, runGrowthStack(atk/def,0.05,10), victoryGuard]
  - 成长存于整局存档，出售或再获得不重复触发一次性收入。

### 残弩-新典训（`pierce-newedict`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_6_relic_assign_5`
- 获取：shop(mechanism:pierceCrit)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_assign_5`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_assign_5`
- 原生用途（内部）：立即进阶一个【狙击】干员（不消耗希望），并使其：攻击时无视目标50%的防御
- 转译理由：原生“进阶”在进击无对应；改成部署时授予一次可消耗的破甲标记，保留狙击与 50% 无视防御语义。
- 描述：狙击干员部署时获得“破甲”标记：其下一次造成伤害无视目标 50% 防御，触发后清除；普通攻击与技能制造的伤害同样适用，不按内部来源名屏蔽。
- 效果：
  - trigger=`redeploy` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"pierceNext","defIgnoreRatio":0.5,"consumedOnDamage":true}`
    - condition：`{"entryKind":"deploy","ownerProfession":"SNIPER"}`
    - stacking：同源=同源每次部署只授予一层，重复部署刷新为一层；异源=与其它穿透来源按进击规则合并
    - limits：null（不限）
    - 狙击部署后下一次伤害无视 50% 防御。
- 因果检查：
  - 场景：狙击干员的技能伤害先于普攻命中 → 预期：技能伤害消耗标记并享受 50% 无视防御，标记清除
  - 场景：标记未消耗前狙击再次部署 → 预期：仍只保留一层标记，不叠加无视比例
- 实现计划：events=[redeploy, hit]；primitives=[professionGuard(SNIPER), buffApply(pierceNext), defIgnore(0.5,consumeOnDamage)]
  - 不按攻击内部来源名过滤，技能伤害一样可用。

### 撕扯之手（`pierce-rendhand`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_1_relic_p45`
- 获取：shop(mechanism:pierceCrit)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_p45`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_p45`
- 原生用途（内部）：【无畏者】、【剑豪】和【教官】攻击时无视目标70%的防御力
- 转译理由：沿用原生职业与 70% 数值，明确技能制造的伤害也可享受穿透，避免用来源名过滤合法联动。
- 描述：无畏者、剑豪、教官造成伤害时无视目标 70% 防御力；普通攻击与技能伤害同样适用，不按内部来源名一刀屏蔽。
- 效果：
  - trigger=`hit` action=`addBuff` lifecycle=`instant`
    - target：team=enemy，selection=hitTarget，geometry=attackRange，count=1
    - params：`{"tag":"defIgnoreRatio","op":"set","value":0.7,"appliesTo":"allDamageFromOwner"}`
    - condition：`{"archetypeIn":["无畏者","剑豪","教官"]}`
    - stacking：同源=同源对同一伤害只取 70%，不重复累加；异源=与其它穿透取进击同类最高值，不连乘
    - limits：null（不限）
    - 指定职业造成伤害时无视目标 70% 防御。
- 因果检查：
  - 场景：该职业的技能伤害命中 → 预期：同样无视 70% 防御，不因是技能而被排除
  - 场景：目标无防御值 → 预期：无视比例不产生负收益，按零防御结算
- 实现计划：events=[hit, damageTaken]；primitives=[archetypeGuard, defIgnore(0.7,allDamageFromOwner)]
  - 穿透在伤害计算阶段生效，不改变收藏品来源账目。

### 裂岩之手（`pierce-rockhand`）— rare

- 来源状态：nativeAdaptation；解锁日：第 6 天
- 图标：`rogue_4_relic_hand_2`
- 获取：shop(mechanism:pierceCrit)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_4/items/rogue_4_relic_hand_2`
- 原生黑板：`/details/rogue_4/relics/rogue_4_relic_hand_2`
- 原生用途（内部）：【收割者】【武者】【斗士】攻击无视目标70%防御，拥有折戟-裂岩时，每秒恢复自身2.5%的生命值
- 转译理由：去掉进击不存在的“拥有折戟-裂岩”前置，把回血改为击杀后触发，保留职业穿透与续航定位。
- 描述：收割者、武者、斗士造成伤害时无视目标 70% 防御力；其击杀敌人后回复自身 2.5% 最大生命。第二个效果不要求拥有折戟-裂岩。
- 效果：
  - trigger=`hit` action=`addBuff` lifecycle=`instant`
    - target：team=enemy，selection=hitTarget，geometry=attackRange，count=1
    - params：`{"tag":"defIgnoreRatio","op":"set","value":0.7,"appliesTo":"allDamageFromOwner"}`
    - condition：`{"archetypeIn":["收割者","武者","斗士"]}`
    - stacking：同源=同源对同一伤害只取 70%；异源=与其它穿透取同类最高值
    - limits：null（不限）
    - 指定职业造成伤害时无视目标 70% 防御。
  - trigger=`kill` action=`heal` lifecycle=`instant`
    - target：team=ally，selection=killerSelf，geometry=self，count=1
    - params：`{"ratioMaxHp":0.025,"countNetOnly":true}`
    - condition：`{"killerArchetypeIn":["收割者","武者","斗士"]}`
    - stacking：同源=同源每次击杀各回复一次，不共享冷却；异源=与其它治疗分别结算
    - limits：null（不限）
    - 指定职业击杀敌人后回复 2.5% 最大生命。
- 因果检查：
  - 场景：该职业一次技能击杀两名敌人 → 预期：两次击杀各回复 2.5% 最大生命，独立结算
  - 场景：击杀时生命已满 → 预期：不产生净治疗入账
- 实现计划：events=[hit, kill, heal]；primitives=[archetypeGuard, defIgnore(0.7), killCauseRecord, heal(2.5%maxHp,netOnly)]
  - 回血归因到击杀者，可参与治疗联动。

### 养育者基因种（`pierce-breederseed`）— epic

- 来源状态：nativeAdaptation；解锁日：第 9 天
- 图标：`rogue_2_relic_fight_159`
- 获取：shop(mechanism:pierceCrit)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_159`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_159`
- 原生用途（内部）：排异反应干员会同化周围2名正常干员，同化完成将临时获得【进化】：排异反应无效，获得35%的庇护，攻击无视目标35%的法术抗性和防御力
- 转译理由：进击没有排异反应与同化玩法；把其终态【进化】抽为全队常驻双穿透加庇护，并明确不编造同化来源。
- 描述：战斗开始时，我方全体干员造成伤害时无视目标 35% 防御力与法术抗性，并获得 35% 庇护；进击把原生“同化队友”转译为全队自身强化，无队友同化机制。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"tag":"bodyStats","defIgnore":0.35,"resIgnore":0.35,"shelter":0.35}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=每战一次；异源=与其它穿透/庇护按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局全队规则，每战一次"}
    - 开局全队获得双 35% 穿透与 35% 庇护。
- 因果检查：
  - 场景：战斗中途部署的新干员 → 预期：同样获得 35% 双穿透与庇护
  - 场景：检查是否存在被同化的队友 → 预期：不存在该机制，只有全队自身强化
- 实现计划：events=[battleStart, hit, damageTaken]；primitives=[battleAura(defIgnore=0.35,resIgnore=0.35), shelter(0.35), lateDeployInherit]
  - 庇护在受伤结算中生效，穿透在伤害结算中生效，两账目独立。

### 猎人的洞察（`pierce-hunterinsight`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_3_relic_fight_1`
- 获取：shop(mechanism:pierceCrit)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_fight_1`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_fight_1`
- 原生用途（内部）：所有干员攻击【坍缩体】时无视50%的防御力和法术抗性，并使其停顿0.5秒
- 转译理由：进击没有坍缩体阵营限定，改为全敌人通用核心穿透，并保留停顿；数值与双穿透结构不变。
- 描述：所有干员造成伤害时无视目标 50% 防御力与 50% 法术抗性，并使命中目标停顿 0.5 秒；作为核心穿透规则，物理与法术伤害同等生效。
- 效果：
  - trigger=`hit` action=`addBuff` lifecycle=`instant`
    - target：team=enemy，selection=hitTarget，geometry=attackRange，count=1
    - params：`{"tag":"resIgnore","op":"set","defIgnore":0.5,"resIgnore":0.5,"pauseSec":0.5}`
    - condition：`{"sourceTeam":"ally"}`
    - stacking：同源=同源对同一伤害只取一次双穿透与停顿；异源=与其它穿透取同类最高值，不连乘
    - limits：null（不限）
    - 我方造成伤害时无视 50% 防御与 50% 法抗，并停顿目标 0.5 秒。
- 因果检查：
  - 场景：法术伤害命中 → 预期：无视 50% 法术抗性，与物理伤害同样享受规则
  - 场景：同一敌人被连续命中 → 预期：每次命中各结算一次停顿，不共享全队冷却
- 实现计划：events=[hit, damageTaken]；primitives=[defIgnore(0.5), resIgnore(0.5), pause(0.5s), allEnemyScope]
  - 双穿透在伤害结算期合并，不改变元素损伤账目。

## 路线 skillCycle

### 爱丽舍钱袋（`cycle-elysee`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_1_relic_q11`
- 获取：shop(mechanism:skillCycle)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_q11`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_q11`
- 原生用途（内部）：所有干员的初始技力+8
- 转译理由：保留原生 8 点初始技力，明确净入账与同类叠加，避免与其它初始技力件隐性连乘。
- 描述：战斗开始时，我方全体干员获得 8 点初始技力，按实际净入账；与其它初始技力来源按进击同类叠加规则相加，不无限连乘。
- 效果：
  - trigger=`battleStart` action=`spGain` lifecycle=`instant`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"amount":8,"timing":"battleStart","countNetOnly":true,"noRecursiveCast":true}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=同源每战每人只给一次；异源=与其它初始技力来源线性相加后封顶
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局一次性充能，每战一次"}
    - 开局全队获得 8 点初始技力，按净入账。
- 因果检查：
  - 场景：同时持有基础与更高初始技力来源 → 预期：按进击同类叠加规则相加封顶，不爆炸
  - 场景：干员在开局后重新部署 → 预期：初始技力在部署时以当前值为准，不重复发放本件充能
- 实现计划：events=[battleStart]；primitives=[battleStartHook, spGain(8,netOnly), sameClassStackRule]
  - 只改技力账目，不影响部署点数或金币。

### 古高卢银币（`cycle-oldcoin`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_1_relic_q10`
- 获取：shop(mechanism:skillCycle)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_q10`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_q10`
- 原生用途（内部）：所有干员的初始技力+6
- 转译理由：沿用原生全体初始技力数值，补充“实际净入账、不递归开技能”的运行时口径。
- 描述：战斗开始时，我方全体干员获得 6 点初始技力，按实际净入账（不超过各自技力上限）；该充能只记入技力账目，不在 gainSp 调用栈内递归施放自动技能。
- 效果：
  - trigger=`battleStart` action=`spGain` lifecycle=`instant`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"amount":6,"timing":"battleStart","countNetOnly":true,"noRecursiveCast":true}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=同源每战每人只给一次；异源=与其它初始技力来源按进击规则相加后封顶
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局一次性充能，每战一次"}
    - 开局全队获得 6 点初始技力，按净入账且不递归开技能。
- 因果检查：
  - 场景：干员技力已接近上限 → 预期：只按实际缺口入账，溢出部分不计为充能收益
  - 场景：充能后技力已满 → 预期：自动技能在下一次行动检查才开始，不在 gainSp 调用栈内递归施放
- 实现计划：events=[battleStart, skillStart]；primitives=[battleStartHook, spGain(6,netOnly), deferAutoSkillCheck]
  - 技力支持小数；本件不给整数以外的额外倍率。

### 衣卡兹（`cycle-ecaz`）— rare

- 来源状态：nativeAdaptation；解锁日：第 4 天
- 图标：`rogue_4_relic_fight_24`
- 获取：shop(mechanism:skillCycle)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_4/items/rogue_4_relic_fight_24`
- 原生黑板：`/details/rogue_4/relics/rogue_4_relic_fight_24`
- 原生用途（内部）：干员首次技能结束后立刻获得30点技力
- 转译理由：保留原生“首次技能结束”与 30 点；进击以技能结算派生事件承载，每名干员仅一次。
- 描述：每名干员首次技能结算结束后立即获得 30 点技力，按实际净入账；每名干员每场战斗只触发一次，技能频繁结束不重复获得。
- 效果：
  - trigger=`skillResolved` action=`spGain` lifecycle=`instant`
    - target：team=ally，selection=skillOwner，geometry=self，count=1
    - params：`{"amount":30,"countNetOnly":true,"oncePerUnit":true}`
    - condition：`{"firstSkillPerUnit":true}`
    - stacking：同源=同源每名干员每战只触发一次；异源=与其它技力充能分别入账
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"明确“首次”语义，防止频繁结束重复回能"}
    - 每名干员首次技能结算后获得 30 点技力。
- 因果检查：
  - 场景：同一干员技能连续开启两次 → 预期：只在第一次结算后获得 30 点，第二次不再触发
  - 场景：获得时技力已满 → 预期：不产生净入账收益，也不递归开下一个技能
- 实现计划：events=[skillResolved, battleStart]；primitives=[skillResolvedHook, spGain(30,netOnly), perUnitOnceGuard]
  - 技能结束派生事件先收集再结算，spGain 不在调用栈内递归施法。

### 幸运饼干（`cycle-fortunecookie`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_6_relic_assign_15`
- 获取：shop(mechanism:skillCycle)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_assign_15`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_assign_15`
- 原生用途（内部）：获得此收藏品时，使随机2名干员的技力回复速度+0.8/秒
- 转译理由：进击无“获得时随机”的持久目标，改为开局随机 2 名在场干员获得整场额外回复，并保证固定种子可复现。
- 描述：战斗开始时，随机 2 名我方干员获得每秒 0.8 点额外技力回复，持续整场战斗；随机结果记录在固定种子下可复现，不与自然回复率连乘。
- 效果：
  - trigger=`battleStart` action=`spGain` lifecycle=`battle`
    - target：team=ally，selection=randomAllies，geometry=field，count=2
    - params：`{"perSecond":0.8,"durationSec":null,"countNetOnly":true,"seededRandom":true}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=同源每战只选一次目标；异源=与自然回复和其它额外回复线性叠加
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局一次性选择目标，每战一次"}
    - 开局随机 2 名干员每秒额外获得 0.8 技力，持续整场。
- 因果检查：
  - 场景：固定种子重开同一场战斗 → 预期：被选中的 2 名干员可复现，不暗中消耗额外随机数
  - 场景：被选干员在战斗中倒地 → 预期：其额外回复随退场停止，再部署后仍为同一目标
- 实现计划：events=[battleStart]；primitives=[seededPickAllies(2), spRegen(0.8/s,netOnly)]
  - 额外回复与自然回复分开记账，均支持小数。

### 永流之手（`cycle-everflow`）— epic

- 来源状态：nativeAdaptation；解锁日：第 7 天
- 图标：`rogue_2_relic_fight_135`
- 获取：shop(mechanism:skillCycle)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_fight_135`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_fight_135`
- 原生用途（内部）：【中坚术师】【秘术师】【召唤师】每使用过一次技能，自身的技力自然回复速度+0.5/秒，最多叠加4层
- 转译理由：保留原生职业限定、每层 0.5/秒与 4 层上限；明确层数归属干员、跨再部署保留、不递归开技能。
- 描述：中坚术师、秘术师、召唤师每完成一次技能使用，其自然技力回复速度 +0.5/秒，最多 4 层（合计 +2.0/秒）；层数随该干员本场战斗保留，倒地再部署不重置已得层数。
- 效果：
  - trigger=`skillResolved` action=`spGain` lifecycle=`battle`
    - target：team=ally，selection=skillOwner，geometry=self，count=1
    - params：`{"perStackPerSecond":0.5,"maxStacks":4,"scope":"self","countNetOnly":true,"noRecursiveCast":true}`
    - condition：`{"professionIn":["中坚术师","秘术师","召唤师"]}`
    - stacking：同源=同源每名干员最多 4 层，层数独立于其它干员；异源=与自然回复及其它额外回复线性叠加
    - limits：{"perBattle":4,"perDeployment":null,"perHour":null,"perRun":null,"reason":"对应原生 4 层上限，每名干员独立"}
    - 指定职业每完成一次技能使用叠 1 层，每层 +0.5/秒，最多 4 层。
- 因果检查：
  - 场景：同一干员在一场战斗中完成 6 次技能使用 → 预期：层数停在 4，回复速度停在 +2.0/秒
  - 场景：该干员倒地后再部署 → 预期：已得层数按本场战斗保留，不重置也不重复发放
- 实现计划：events=[skillResolved]；primitives=[skillResolvedHook, professionGuard, spRegenStack(0.5/s,4), spGainNetOnly]
  - 层数存在干员战斗状态上；spGain 不在调用栈内递归施放。

### 皇家利口酒（`cycle-royalliqueur`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_1_relic_q21`
- 获取：shop(mechanism:skillCycle)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_q21`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_q21`
- 原生用途（内部）：所有攻击和受击回复的技能每1.5秒回复1点技力
- 转译理由：以原技能的攻击/受击回复类型决定额外回能资格；本模式全部技能仍保留自然回复，按实际净入账结算。
- 描述：原技能为攻击回复与受击回复的干员每 1.5 秒额外回复 1 点技力，按实际净入账；周期性结算，不与自然回复互相顶替，满技力时不产生虚假收益。
- 效果：
  - trigger=`battleStart` action=`spGain` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"amount":1,"periodSec":1.5,"countNetOnly":true,"chargeTypes":["attack","hurt"]}`
    - condition：`{"sourceChargeTypeIn":["attack","hurt"],"periodSec":1.5}`
    - stacking：同源=同源每人每周期只回一次；异源=与自然回复和其它回能来源分别结算
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":null,"reason":"周期由战斗时钟驱动，受技能类型与技力上限自然约束"}
    - 原技能为攻击/受击回复的干员每 1.5 秒额外回 1 点技力。
- 因果检查：
  - 场景：技能已满技力时周期到点 → 预期：不产生净入账，不递归开启下一个技能
  - 场景：原技能为自然回复的干员携带本件 → 预期：不满足 sourceChargeType 条件，不获得周期回能
- 实现计划：events=[battleStart, skillStart]；primitives=[battleAura(periodSec=1.5), chargeTypeGuard, spGain(1,netOnly)]
  - 回能与自然回复分账，支持小数，不设全队公共冷却。

## 路线 economyGrowth

### 古旧钱币（`econ-oldcoins`）— common

- 来源状态：nativeAdaptation；解锁日：第 1 天
- 图标：`rogue_1_relic_r11`
- 获取：shop(mechanism:economyGrowth)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_r11`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_r11`
- 原生用途（内部）：立即获得源石锭+10
- 转译理由：把原生源石锭转译为进击金币（唯一局内货币、无利息），并明确只在首次获得结算一次。
- 描述：获得本件时立即获得 10 金币，整局保留、不计利息；只在首次获得时结算一次，重获或再打开存档不重复发放一次性收入。
- 效果：
  - trigger=`purchase` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"gold","amount":10,"timing":"onAcquire"}`
    - condition：`{"acquisition":true,"oncePerRun":true}`
    - stacking：同源=同源整局只结算一次；异源=与其它金币收入相加，不计利息
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":1,"reason":"一次性收入，防止重获刷金"}
    - 获得时立即获得 10 金币，整局仅一次。
- 因果检查：
  - 场景：通过商店购买获得本件 → 预期：金币 +10 且只发放一次
  - 场景：存档重新打开后再读到同一获得记录 → 预期：不重复发放 10 金币
- 实现计划：events=[purchase]；primitives=[acquisitionClaimOnce, economyAdd(gold,10)]
  - purchase 事件代表本件的获得结算，涵盖商店/奖励/事件三种来源的一次性领取。

### 维多利亚“废铁”勋章（`econ-scrapmedal`）— common

- 来源状态：nativeAdaptation；解锁日：第 2 天
- 图标：`rogue_1_relic_r33`
- 获取：shop(mechanism:economyGrowth)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_r33`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_r33`
- 原生用途（内部）：战斗获得的指挥经验+20%
- 转译理由：把原生“指挥经验”对应到进击科技经验，明确按基础经验加成并限制连乘。
- 描述：每场战斗胜利使获得的科技经验 +20%，额外经验按基础经验计算，不与其它百分比来源无限连乘。
- 效果：
  - trigger=`battleEnd` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"xp","op":"mul","value":1.2,"appliesTo":"battleXp"}`
    - condition：`{"victory":true}`
    - stacking：同源=同源每场胜利只加一次；异源=与其它经验百分比按进击规则相加后统一应用
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每场胜利结算一次"}
    - 战斗胜利科技经验 +20%（按基础经验）。
- 因果检查：
  - 场景：普通战斗与高风险战斗各获胜一次 → 预期：两次均按各自基础经验额外 +20%
  - 场景：同时持有多个经验百分比来源 → 预期：按进击同类规则相加后统一应用，不逐层连乘
- 实现计划：events=[battleEnd]；primitives=[battleEndHook, victoryGuard, economyMul(xp,1.2)]
  - 经验账目独立于金币与部署点数。

### 友谊之证（`econ-friendship`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_1_relic_m07`
- 获取：shop(mechanism:economyGrowth)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_m07`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_m07`
- 原生用途（内部）：战斗掉落的源石锭+30%
- 转译理由：源石锭转译为进击金币，明确按基础掉落加成且不计利息。
- 描述：每场战斗胜利掉落的金币 +30%，按基础掉落计算；金币整局保留、不计利息。
- 效果：
  - trigger=`battleEnd` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"gold","op":"mul","value":1.3,"appliesTo":"battleGoldDrop"}`
    - condition：`{"victory":true}`
    - stacking：同源=同源每场胜利只加一次；异源=与其它金币掉落加成按进击规则相加后应用
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每场胜利结算一次"}
    - 战斗胜利金币掉落 +30%。
- 因果检查：
  - 场景：普通战斗胜利一次 → 预期：金币掉落按基础值乘以 1.3，整局保留不计利息
  - 场景：同时持有多个金币百分比来源 → 预期：按同类规则相加，不连乘
- 实现计划：events=[battleEnd]；primitives=[battleEndHook, victoryGuard, economyMul(gold,1.3)]
  - 金币只增不减利，不写回购买价。

### 莱塔尼亚荣誉勋章（`econ-leithmedal`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_1_relic_r34`
- 获取：shop(mechanism:economyGrowth)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_r34`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_r34`
- 原生用途（内部）：战斗获得的指挥经验+30%
- 转译理由：指挥经验对应进击科技经验，保留 30% 并限制连乘。
- 描述：每场战斗胜利获得的科技经验 +30%，按基础经验计算，不与其它经验百分比来源无限连乘。
- 效果：
  - trigger=`battleEnd` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"xp","op":"mul","value":1.3,"appliesTo":"battleXp"}`
    - condition：`{"victory":true}`
    - stacking：同源=同源每场胜利只加一次；异源=与其它经验百分比相加后统一应用
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每场胜利结算一次"}
    - 战斗胜利科技经验 +30%。
- 因果检查：
  - 场景：普通战斗与高风险战斗各获胜 → 预期：各按基础经验额外 +30%
  - 场景：同时持有基础与稀有经验来源 → 预期：按同类规则合并，不逐层连乘
- 实现计划：events=[battleEnd]；primitives=[battleEndHook, victoryGuard, economyMul(xp,1.3)]
  - 科技只影响人口与明确解锁，本件不改商店概率。

### 无瑕宝玉（`econ-flawlessjade`）— epic

- 来源状态：nativeAdaptation；解锁日：第 7 天
- 图标：`rogue_1_relic_r13`
- 获取：shop(mechanism:economyGrowth)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_r13`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_r13`
- 原生用途（内部）：立即获得源石锭+25
- 转译理由：源石锭转金币并保留 25 的一次性大额收入，明确整局唯一与防重复领取。
- 描述：获得本件时立即获得 25 金币，整局仅一次且不计利息；重获或重新打开存档不会重复发放。
- 效果：
  - trigger=`purchase` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"gold","amount":25,"timing":"onAcquire"}`
    - condition：`{"acquisition":true,"oncePerRun":true}`
    - stacking：同源=同源整局只结算一次；异源=与其它金币收入相加，不计利息
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":1,"reason":"一次性收入，防止重获刷金"}
    - 获得时立即获得 25 金币，整局仅一次。
- 因果检查：
  - 场景：通过事件奖励获得本件 → 预期：金币 +25 且只发放一次
  - 场景：同一局内再次获得同名结算 → 预期：不重复发放 25 金币
- 实现计划：events=[purchase]；primitives=[acquisitionClaimOnce, economyAdd(gold,25)]
  - 一次性收入不参与利息或复利。

### 至宝指环（`econ-rings`）— epic

- 来源状态：nativeAdaptation；解锁日：第 8 天
- 图标：`rogue_1_relic_r32`
- 获取：shop(mechanism:economyGrowth)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_r32`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_r32`
- 原生用途（内部）：战斗掉落的源石锭+50%
- 转译理由：源石锭转金币，提升到 50% 作为稀缺经济核心，但保持按基础掉落的可核对口径。
- 描述：每场战斗胜利掉落的金币 +50%，按基础掉落计算；金币整局保留、不计利息。
- 效果：
  - trigger=`battleEnd` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"gold","op":"mul","value":1.5,"appliesTo":"battleGoldDrop"}`
    - condition：`{"victory":true}`
    - stacking：同源=同源每场胜利只加一次；异源=与其它金币掉落加成相加后应用
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每场胜利结算一次"}
    - 战斗胜利金币掉落 +50%。
- 因果检查：
  - 场景：高风险战斗胜利 → 预期：基础 6 金币按 +50% 结算为 9 金币
  - 场景：战败但生命为正 → 预期：不发胜利金币，本件不结算
- 实现计划：events=[battleEnd]；primitives=[battleEndHook, victoryGuard, economyMul(gold,1.5)]
  - 无利息，金币不随时间增长。

## 路线 cross

### 骑士戒律·新编（`cross-chivalry`）— common

- 来源状态：nativeAdaptation；解锁日：第 4 天
- 图标：`rogue_1_relic_q27`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_q27`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_q27`
- 原生用途（内部）：每有5源石锭，所有我方单位的攻击速度+5
- 转译理由：源石锭转金币，并加 40 金币硬上限防止后期无界攻速；每个时段重算以匹配经济随时间变化。
- 描述：每持有 5 金币，我方全体干员攻击速度 +5，最多按 40 金币计 8 层（+40）；在每个时段开始时重算，跨 economyGrowth 与 skillCycle 两条路线。金币无利息。
- 效果：
  - trigger=`hourStarted` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"buff":"chivalry","attackSpeedPer5Gold":5,"maxGoldCounted":40,"maxStacks":8,"recomputeOn":"hourStarted"}`
    - condition：`{"phase":"hourStart"}`
    - stacking：同源=同源按时段重算为最新层数，不跨时段累加；异源=与其它攻速增益按进击规则合并
    - limits：{"perBattle":null,"perDeployment":null,"perHour":1,"perRun":null,"reason":"每个时段重算一次，上限 8 层"}
    - 每 5 金币全队攻速 +5，最多 8 层，每时段重算。
- 因果检查：
  - 场景：持有 60 金币进入某时段 → 预期：只按 40 金币计 8 层 +40，不无限增长
  - 场景：金币在时段内减少 → 预期：本时段保持进入时的层数，下一时段重算
- 实现计划：events=[hourStarted, battleStart]；primitives=[hourTickHook, goldCountQuery, attackSpeedBuffPer5Gold(5,cap=8)]
  - 金币无利息，只在时段边界读取数值。

### 骑士长枪专业版（`cross-lancepro`）— common

- 来源状态：nativeAdaptation；解锁日：第 3 天
- 图标：`rogue_3_relic_res_1`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_3/items/rogue_3_relic_res_1`
- 原生黑板：`/details/rogue_3/relics/rogue_3_relic_res_1`
- 原生用途（内部）：战场的宝箱会掉落更多的源石锭
- 转译理由：原生宝箱掉落转译为稳定的战后金币 +3 与刷新费减 1，明确货币账目与最低刷新价。
- 描述：每场战斗胜利额外获得 3 金币；商店刷新费用 -1（最低 1 金币）。跨 economyGrowth 与商店路线，金币无利息。
- 效果：
  - trigger=`battleEnd` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"gold","amount":3,"appliesTo":"battleGoldDrop"}`
    - condition：`{"victory":true}`
    - stacking：同源=同源每场胜利只加一次；异源=与其它战后金币分账相加
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每场胜利结算一次"}
    - 战斗胜利额外 +3 金币。
  - trigger=`purchase` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"gold","amount":-1,"minResult":1,"appliesTo":"shopRefreshCost"}`
    - condition：`{"shopAction":"refresh"}`
    - stacking：同源=同源每次刷新只减一次；异源=与其它刷新费修改相加后取下限
    - limits：null（不限）
    - 商店刷新费 -1，最低 1 金币。
- 因果检查：
  - 场景：某商店刷新费为 1 金币 → 预期：减后仍为 1，不变成 0 或负值
  - 场景：购买商品而非刷新 → 预期：购买价不受影响，只影响刷新费
- 实现计划：events=[battleEnd, purchase]；primitives=[battleEndHook, economyAdd(gold,3), shopRefreshCostAdd(-1,min=1)]
  - 金币账目独立于部署点数与科技经验，无利息。

### 立体艺术装置（`cross-artinstall`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_2_relic_grace_54`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_2/items/rogue_2_relic_grace_54`
- 原生黑板：`/details/rogue_2/relics/rogue_2_relic_grace_54`
- 原生用途（内部）：回复7目标生命，每次战斗结束后额外回复1目标生命
- 转译理由：目标生命对应进击行动生命；保留获得时 +7 与战后 +1，明确封顶与账目独立。
- 描述：获得时立即回复 7 点行动生命；此后每场战斗结束额外回复 1 点行动生命（不超过行动生命上限），跨 healShield 与 economyGrowth 两条路线。行动生命与金币、科技经验分账。
- 效果：
  - trigger=`purchase` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"hp","amount":7,"timing":"onAcquire","capAtMax":true}`
    - condition：`{"acquisition":true,"oncePerRun":true}`
    - stacking：同源=同源整局只结算一次；异源=与其它行动生命回复分别结算
    - limits：{"perBattle":null,"perDeployment":null,"perHour":null,"perRun":1,"reason":"一次性获得奖励，防止重获刷血"}
    - 获得时回复 7 点行动生命。
  - trigger=`battleEnd` action=`economy` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"currency":"hp","amount":1,"appliesTo":"afterBattle","capAtMax":true}`
    - condition：`{"battleResolved":true}`
    - stacking：同源=同源每场战斗只回复一次；异源=与其它战后回复分账
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每场战斗结算一次"}
    - 每场战斗结束额外回复 1 点行动生命。
- 因果检查：
  - 场景：行动生命已满时触发战后回复 → 预期：回复按上限截断，不溢出为金币或经验
  - 场景：整局多次获得同名结算 → 预期：获得时的 +7 不重复，战后 +1 每场仍生效
- 实现计划：events=[purchase, battleEnd]；primitives=[acquisitionClaimOnce, economyAdd(hp,7), economyAdd(hp,1,perBattle,cap)]
  - 行动生命与金币、科技经验、部署点数各账目独立。

### 长明灯引（`cross-everlight`）— rare

- 来源状态：nativeAdaptation；解锁日：第 5 天
- 图标：`rogue_5_relic_fight_7`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_fight_7`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_fight_7`
- 原生用途（内部）：第一名部署的地面干员攻击力+50%、并获得抵抗、50%元素损伤减免，持续至被击倒或撤离
- 转译理由：沿用原生“第一名地面干员”限定与三件套增益，明确随该干员退场结束、不转移给其它干员。
- 描述：第一名部署的地面干员攻击力 +50%、获得抵抗、元素损伤承受 -50%，持续至其被击倒或撤离；跨 element 与 blockCounter 两条路线。
- 效果：
  - trigger=`redeploy` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"everlight","atkRatio":0.5,"statusResist":true,"elementDamageTakenMul":0.5,"until":"killedOrRetreated"}`
    - condition：`{"entryKind":"deploy","ownerDeployType":"melee","firstGroundDeploy":true}`
    - stacking：同源=同源每战只授予首名地面干员一次；异源=与其它攻击/减伤按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"只认第一名地面干员，每战一次"}
    - 首名地面干员攻击 +50%、抵抗、元素损伤承受 -50%，退场即结束。
- 因果检查：
  - 场景：首名地面干员被击倒 → 预期：三件套加成立即结束，不转移给后续干员
  - 场景：先部署远程干员再部署近战 → 预期：近战仍是第一名地面干员，正常获得加成
- 实现计划：events=[redeploy, summonDied]；primitives=[firstGroundDeployGuard, buffApply(everlight), untilKilledOrRetreated]
  - 抵抗按进击状态语义处理；元素损伤减免在损伤账目结算。

### 猎犬咖啡（`cross-houndcoffee`）— rare

- 来源状态：nativeAdaptation；解锁日：第 6 天
- 图标：`rogue_6_relic_fight_25`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_fight_25`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_fight_25`
- 原生用途（内部）：我方单位的生命和攻击力+30%，敌人出现时有3%概率生命+100%
- 转译理由：把原生 3% 概率改为开局必定随机 1 名敌人强化，保证代价确定且固定种子可复现，避免概率白值。
- 描述：战斗开始时，我方全体干员生命与攻击力 +30%；同时随机 1 名敌人获得 +100% 生命（若场上有敌人）。跨 healShield 与 pierceCrit 两条路线，代价是敌人同时变强。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=allAllies，geometry=field，count=all
    - params：`{"buff":"houndCoffee","maxHpMul":1.3,"currentHpFollow":"scale","atkRatio":0.3}`
    - condition：`{"phase":"battleStart"}`
    - stacking：同源=每战一次；异源=与其它生命/攻击修改按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局全队 buff，每战一次"}
    - 全队生命 +30%、攻击 +30%，当前生命按比例。
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=enemy，selection=randomEnemy，geometry=field，count=1
    - params：`{"buff":"houndCoffeeMark","maxHpMul":2,"currentHpFollow":"scale","seededRandom":true}`
    - condition：`{"phase":"battleStart","hasEnemies":true}`
    - stacking：同源=每战只选一名敌人；异源=与其它敌方生命修改合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局随机一名敌人，每战一次"}
    - 开局随机 1 名敌人生命 +100%。
- 因果检查：
  - 场景：固定种子重开同一场战斗 → 预期：被强化敌人可复现，不暗中消耗额外随机数
  - 场景：场上一名敌人都没有 → 预期：第二段不触发，仅有我方增益
- 实现计划：events=[battleStart]；primitives=[seededRandomEnemy, allyBuff(maxHp+30%,atk+30%), enemyBuff(maxHp+100%)]
  - 我方生命按比例同步，避免只改上限导致治疗失效。

### 冰中火（`cross-icefire`）— rare

- 来源状态：nativeAdaptation；解锁日：第 6 天
- 图标：`rogue_6_relic_fight_21`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_6/items/rogue_6_relic_fight_21`
- 原生黑板：`/details/rogue_6/relics/rogue_6_relic_fight_21`
- 原生用途（内部）：敌人受到的元素损伤和元素伤害+75%
- 转译理由：保留原生 75% 双加成，拆分元素损伤承受与爆发伤害两个账目，并明确新敌人继承。
- 描述：所有敌人受到的元素损伤与元素爆发伤害各 +75%，两项独立结算；跨 element 与 cold 两条路线。战斗中新出现的敌人同样受用。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=enemy，selection=allEnemies，geometry=field，count=all
    - params：`{"buff":"iceFire","elementDamageTakenMul":1.75,"elementBurstDamageMul":1.75}`
    - condition：`{"phase":"battleStart","affectsNewEnemies":true}`
    - stacking：同源=每战一次；异源=与其它元素易伤/增伤按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局全场光环，每战一次"}
    - 敌人元素损伤承受 +75%、元素爆发伤害 +75%，新敌人继承。
- 因果检查：
  - 场景：战斗中途新出现的敌人 → 预期：同样获得双 75% 加成
  - 场景：敌人独立元素反复爆发 → 预期：每次爆发都按增伤结算，不受旧公共冷却锁阻断
- 实现计划：events=[battleStart, elementBurst]；primitives=[battleAura(elementDamageTakenMul=1.75), elementBurstDamageMul(1.75), enemySpawnInherit]
  - 元素损伤积累与爆发伤害分账，本件两项都加。

### 商影（`cross-shadow`）— rare

- 来源状态：nativeAdaptation；解锁日：第 4 天
- 图标：`rogue_5_relic_cardg_6`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_cardg_6`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_cardg_6`
- 原生用途（内部）：进入战斗时，待部署区最右侧的干员阻挡数+2，防御力+50%，最大生命值+50%，部署后返回50%的部署费用
- 转译理由：沿用原生“最右侧待部署干员”与三件套，明确返还的是本战斗部署点数而非金币，且只对该干员一次。
- 描述：进入战斗时，待部署区最右侧的干员阻挡数 +2、防御 +50%、最大生命 +50%；该干员部署时返还其本次部署费用的 50% 为战斗部署点数。跨 redeploy 与 blockCounter 两条路线。
- 效果：
  - trigger=`battleStart` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=rightmostStandbyAlly，geometry=field，count=1
    - params：`{"buff":"shadow","blockCountAdd":2,"defMul":1.5,"maxHpMul":1.5,"currentHpFollow":"scale","refundMark":"shadowRefund"}`
    - condition：`{"phase":"battleStart","hasStandby":true}`
    - stacking：同源=每战只授予最右侧一名待部署干员；异源=与其它防御/生命修改按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"开局选一名待部署干员，每战一次"}
    - 最右侧待部署干员阻挡 +2、防御 +50%、最大生命 +50%。
  - trigger=`redeploy` action=`economy` lifecycle=`instant`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"currency":"dp","op":"add","valueRatioOfPaid":0.5,"appliesTo":"deployRefund","consumeMark":"shadowRefund","rounding":"none"}`
    - condition：`{"entryKind":"deploy","buffActive":"shadowRefund","requiresPaidDeployment":true}`
    - stacking：同源=同源该干员首次部署只返还一次；异源=返还实际已付DP的50%，保留小数，上限99；只消费一次性退款标记，不移除整场属性
    - limits：{"perBattle":1,"perDeployment":1,"perHour":null,"perRun":null,"reason":"该干员首个实际付费部署消费shadowRefund一次，免费技能再部署不消费标记"}
    - 持有 shadow 的干员部署时返还本次费用的 50% 部署点数。
- 因果检查：
  - 场景：待部署区为空 → 预期：第一段不选目标，第二段也无返还对象，不报错
  - 场景：最右侧干员部署两次 → 预期：只在首次部署返还 50% 点数，第二次不再返还
  - 场景：第一次为免费技能再部署，后一次为正常付费入场 → 预期：第一次不消费退款标记；后一次返还实付的一半且保留阻挡、防御、生命加成
- 实现计划：events=[battleStart, redeploy]；primitives=[rightmostStandbyQuery, blockCountAdd(2), defMul(1.5), economyRefund(dp,ratio=0.5,consumeMark=shadowRefund,rounding=none)]
  - 返还是部署点数账目，不是金币；不改购买价。

### 束伥索（`cross-bundle`）— epic

- 来源状态：nativeAdaptation；解锁日：第 6 天
- 图标：`rogue_5_relic_fight_3`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_5/items/rogue_5_relic_fight_3`
- 原生黑板：`/details/rogue_5/relics/rogue_5_relic_fight_3`
- 原生用途（内部）：【召唤物】的部署费用-5，再部署时间-25%，攻击力+30%
- 转译理由：原生包含召唤物部署费用、再部署时间和攻击力。当前模式的召唤库存会移除后创建新实体，没有可消费的原生召唤物再部署等待，因此把该项转译为召唤物攻击间隔缩短 25%，不宣称保留原生冷却效果。
- 描述：召唤物部署费用 -5（最低 0）、攻击间隔缩短 25%、攻击力 +30%；三类数值分别结算，只作用于召唤物。
- 效果：
  - trigger=`deploymentCost` action=`spCost` lifecycle=`instant`
    - target：team=ally，selection=deployingEntity，geometry=self，count=1
    - params：`{"currency":"dp","op":"add","value":-5,"min":0,"costModifierOnly":true}`
    - condition：`{"spawnKind":"summon"}`
    - stacking：同源=同源每次召唤物部署只减一次；异源=与其它费用减少相加后取下限
    - limits：null（不限）
    - 召唤物部署费用 -5，最低 0。
  - trigger=`summonSpawned` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=spawnedEntity，geometry=self，count=1
    - params：`{"buff":"bundle","attackIntervalMultiplier":0.75,"atkRatio":0.3}`
    - condition：`{"spawnKind":"summon"}`
    - stacking：同源=同一召唤物只授予一次；异源=与其它召唤物增益合并
    - limits：null（不限）
    - 召唤物攻击间隔缩短 25%、攻击 +30%。
- 因果检查：
  - 场景：召唤物原生费用低于 5 → 预期：实际费用停在 0，不返还点数
  - 场景：同一召唤物被重复授予 → 预期：攻击间隔与攻击加成各只应用一次
- 实现计划：events=[deploymentCost, summonSpawned]；primitives=[spCostAdd(-5,min=0,dp), summonBuff(redeployCooldownMul=0.75,atk+30%)]
  - s pCost 只改本战斗部署点数；召唤物 buff 随召唤物生命周期清理。 部署计价前计算一次加减修饰，不在已支付后的再部署通知中累积扣费；本次为免费技能再部署时仍支付零。

### 四叶草化石（`cross-cloverfossil`）— epic

- 来源状态：nativeAdaptation；解锁日：第 7 天
- 图标：`rogue_1_relic_r36`
- 获取：shop(mechanism:cross)、reward(battle)、event(nonBattleEvent)
- 原生条目：`/details/rogue_1/items/rogue_1_relic_r36`
- 原生黑板：`/details/rogue_1/relics/rogue_1_relic_r36`
- 原生用途（内部）：战斗后掉落收藏品时，增加一个可选项
- 转译理由：沿用原生“多一个可选项”，明确只加候选数、不改权重与携带上限，也说明候选为空时按四金币规则处理。
- 描述：战斗胜利发放收藏品三选一时，候选数 +1（变为四选一）；不增加携带容量限制，也不改变普通/稀有/珍贵权重，跨 economyGrowth 与奖励路线。
- 效果：
  - trigger=`battleEnd` action=`growth` lifecycle=`run`
    - target：team=ally，selection=runAccount，geometry=field，count=1
    - params：`{"rewardOptionBonus":1,"appliesTo":"collectibleChoice","keepWeights":true,"keepCarryLimit":true}`
    - condition：`{"victory":true,"rewardKind":"collectible"}`
    - stacking：同源=同源每场胜利只加一个候选；异源=与其它奖励加项按进击规则相加
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"每场胜利结算一次"}
    - 战斗胜利收藏品候选 +1，权重与携带上限不变。
- 因果检查：
  - 场景：某次奖励过滤后仅剩 1 件可得 → 预期：显示较少候选，不偷偷塞入无关卡；候选仍为空时给四金币
  - 场景：同一次奖励同时受其它加项影响 → 预期：候选数相加，普通/稀有/珍贵权重不被改写
- 实现计划：events=[battleEnd]；primitives=[battleEndHook, rewardOptionCountAdd(1), preserveWeightTable, emptyPoolFallbackGold]
  - 不增加携带容量限制，所有收藏品唯一。

## 路线 leader

### 新约能天使的旧弹匣（`leader-angel2-oldmagazine`）— starter

- 来源状态：original；解锁日：第 1 天
- 图标：`assault/original/leader_angel2_old_magazine`
- 领袖：char_1041_angel2
- 获取：leader(char_1041_angel2)
- 转译理由：领袖起步件为原创，对齐 design.md 的弹药/装填与额外射击；不凭标签给其它角色虚构弹药消耗。
- 描述：新约能天使起步专属、唯一且不进随机池。战斗开始时该干员获得 6 发弹匣；其每次造成伤害消耗 1 发并追加 40% 攻击力伤害，弹药耗尽后不再追加。只有该干员真实消耗弹药，不为其它干员虚构弹药。
- 效果：
  - trigger=`battleStart` action=`ammo` lifecycle=`battle`
    - target：team=ally，selection=owner，geometry=self，count=1
    - params：`{"op":"add","amount":6,"scope":"self","countNetOnly":true}`
    - condition：`{"phase":"battleStart","ownerCharId":"char_1041_angel2"}`
    - stacking：同源=同源每战只装填一次；异源=与原生弹药技能弹药分离记账
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"领袖专属弹匣，每战一次"}
    - 开局该干员获得 6 发旧弹匣弹药。
  - trigger=`hit` action=`ammo` lifecycle=`instant`
    - target：team=enemy，selection=hitTarget，geometry=attackRange，count=1
    - params：`{"op":"consume","amount":1,"bonusDamageRatio":0.4,"consumeKind":"oldMagazine"}`
    - condition：`{"ownerCharId":"char_1041_angel2","ammoAtLeast":1}`
    - stacking：同源=同源每次命中消耗 1 发，命中即结算；异源=与原生弹药技能弹药独立扣减
    - limits：{"perBattle":6,"perDeployment":null,"perHour":null,"perRun":null,"reason":"弹匣共 6 发，耗尽后停止追加"}
    - 每次命中消耗 1 发旧弹匣并追加 40% 攻击力伤害。
- 因果检查：
  - 场景：6 发弹药全部消耗后继续命中 → 预期：不再追加 40% 伤害，也不产生负弹药
  - 场景：其它无弹药干员命中 → 预期：不消耗旧弹匣，不获得追加伤害
- 实现计划：events=[battleStart, hit, ammoUsed]；primitives=[ammoAdd(6,oldMagazine), ammoConsume(1,onHit), bonusDamage(0.4*atk)]
  - 旧弹匣与原生弹药技能账目分开，耗尽后不递归。

### 白铁的工坊钥匙（`leader-ironmn-workshopkey`）— starter

- 来源状态：original；解锁日：第 1 天
- 图标：`assault/original/leader_ironmn_workshop_key`
- 领袖：char_4072_ironmn
- 获取：leader(char_4072_ironmn)
- 转译理由：领袖起步件为原创；装置行为对齐 design.md 的装置/召唤/邻接支援，复用原生装置资源而非编造收藏品来源。
- 描述：白铁起步专属。白铁出战时免费生成一个工坊修复台，与其支援装置共享场上容量。每2.5秒对范围内最近出口的一个敌人造成白铁当前攻击力150%的物理伤害；每5秒为四邻友军各回复500生命。修复台生命为白铁最大生命的75%，不阻挡。
- 效果：
  - trigger=`battleStart` action=`summon` lifecycle=`battle`
    - target：team=ally，selection=chosenDeployTile，geometry=self，count=1
    - params：`{"template":"工坊修复台","templateId":"assault_workshop_platform","sourceTemplateId":"token_10027_ironmn_pile3","sourceUse":"visualAndRangeOnly","ownerCharId":"char_4072_ironmn","count":1,"ownerUid":"actualOwnerUnitUid","maxHpBasis":"ownerNormalizedMaxHp","maxHpRatio":0.75,"atkBasis":"ownerCurrentAtk","defBasis":"ownerCurrentDef","resBasis":"ownerCurrentRes","blockCnt":0,"damageType":"phys","rangeId":"3-13","attackTarget":"enemyClosestToExitThenUid","attackIntervalSec":2.5,"attackRatio":1.5,"repairAmount":100,"repairScale":"nativeFlatHpTimes5Once","repairFinalAmount":500,"repairPeriodSec":5,"repairGeometry":"adjacent4","repairTargets":"allFriendlyLivingUnits","nativeCap":true,"ownerFieldCap":2,"capacityLedger":"sharedWithOwnerSupportDevicesIncludingModuleChanges","deploymentCost":0,"placement":"preparedSlotElseOwnerFrontAdjacent8ThenNearestLegal","unavailable":"retainPendingSpawnUntilOwnerAliveAndLegalSlotAndCapacity","ownerDeath":"removePlatformAndTimers","naturalAttackEnabled":true}`
    - condition：`{"phase":"battleStart","ownerCharId":"char_4072_ironmn","requireOwnerInFormation":true}`
    - stacking：同源=同源每战只生成 1 个；异源=与白铁充能装置共享主人场上容量，基础2个；容量模组只修改同一份账。
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"领袖起步专属装置，每战一个且不占干员备用格"}
    - 白铁起步专属。白铁出战时免费生成一个工坊修复台，与其支援装置共享场上容量。每2.5秒对范围内最近出口的一个敌人造成白铁当前攻击力150%的物理伤害；每5秒为四邻友军各回复500生命。修复台生命为白铁最大生命的75%，不阻挡。
- 因果检查：
  - 场景：装置被敌人击毁 → 预期：修复与攻击行为随装置退场停止，不残留
  - 场景：装置周围四邻没有友军 → 预期：修复无目标时不产生治疗入账，不报错
  - 场景：白铁未编入出战队或没有合法格/容量 → 预期：没有主人时不生成虚拟干员；有主人但暂缺格位或容量时保留待生成项，恢复条件后只生成一次。
  - 场景：生命与修复归一化 → 预期：75%直接取主人新生命，不再次乘五；固定修复100只乘五一次得到500。
- 实现计划：events=[battleStart, deployed, summonSpawned, summonDied, death]；primitives=[explicitDerivedToken(assault_workshop_platform), sharedOwnerCapacity, damage(ownerCurrentAtk*1.5,phys,interval=2.5s), heal(500,adjacent4,interval=5s), cancelOwnedTimers]
  - 模板仅复用原生pile3外观和3-13范围，其攻击与修复是进击原创；不安装原生pile3命中计数、免伤或工匠修复回调。

### 凛御银灰的霜迹徽记（`leader-svash2-frostsigil`）— starter

- 来源状态：original；解锁日：第 1 天
- 图标：`assault/original/leader_svash2_frost_sigil`
- 领袖：char_1045_svash2
- 获取：leader(char_1045_svash2)
- 转译理由：领袖起步件为原创（进击 new），不编造原生 ID；effect 为进击重新设计并与 design.md 的再部署/寒冷机制一致。
- 描述：凛御银灰起步专属、唯一且不进随机池。战斗开始时，我方首名部署的干员获得“霜迹”：再部署等待时间 -30%，普通攻击附加 1 秒寒冷；该干员退场后效果结束，不转移给其它干员。
- 效果：
  - trigger=`redeploy` action=`addBuff` lifecycle=`battle`
    - target：team=ally，selection=self，geometry=self，count=1
    - params：`{"buff":"frostSigil","redeployCooldownMul":0.7,"onAttackStatus":{"status":"cold","durationSec":1}}`
    - condition：`{"entryKind":"deploy","firstDeploy":true}`
    - stacking：同源=同源每战只授予首名部署干员一次；异源=与其它再部署/寒冷效果按进击规则合并
    - limits：{"perBattle":1,"perDeployment":null,"perHour":null,"perRun":null,"reason":"领袖起步专属，每战只发首名干员"}
    - 首名部署干员再部署等待 -30%，普攻附加 1 秒寒冷，退场即结束。
- 因果检查：
  - 场景：首名部署干员被击倒 → 预期：霜迹结束，不把加成转移给后续干员
  - 场景：首名干员存活时接受原位免费再部署；或者死亡后自然再次入场 → 预期：存活满血指令保留霜迹与寒冷附加；死亡/撤退已终止霜迹，后续入场不重授
- 实现计划：events=[redeploy, statusApplied]；primitives=[firstDeployGuard, buffApply(frostSigil), onAttackStatus(cold,1s), untilKilledOrRetreated]
  - 领袖起步编队免费获得，不产生购买触发。
