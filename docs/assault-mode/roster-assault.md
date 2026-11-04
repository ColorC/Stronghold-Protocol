# 进击逐卡设计 — 近战组

来源修订：`17759cc8cdf37388414145d16262a3a06f3ab25e`。共 45 名。数值为进击转译，非原作事实；生命基础整体×5，四星倍率统一 1/1.55/2.2/3（攻）与 1/1.65/2.6/4（生命）。

## 艾丝黛尔（`char_127_estell`）
- 职业：WARRIOR；档位：1（2 金币）；路线：`healShield`
- 定位：群攻近卫·击杀回血前排
- 档位理由：二费基础前排，用范围斩击和击杀回血稳住单路，成本低但强度受触发窗口限制，落一档。
- 设计理由：围绕原生自愈能力与舍身突击转译：技力回满立即结算范围斩击并自损换伤，击杀后再回血，保留群攻与舍身换血特色，不做通用单击增伤。

### 固定技能：舍身突击（进击）
- 来源技能：`skchr_estell_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[14,12,10,8]；初始技力：5
- 自然技力回满时立即自动结算：对攻击范围内至多3名敌人造成物理伤害，自身消耗当前生命的固定比例，随后8秒内攻击力提升且不再成为其他角色治疗目标；命中已被自身阻挡的敌人时按造成的伤害回复自身生命。
- 效果1：立即对范围内至多3名敌人造成攻击力115%/130%/145%/160%的物理伤害，并消耗自身当前生命的30%。
  - trigger=技力自然回满时自动施放，不等待下一次普通攻击；target=自身攻击范围内至多3名敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.15,1.3,1.45,1.6],"maxTarget":[3,3,3,3],"selfHpCostRatio":[0.3,0.3,0.3,0.3]}；stacking=每次施放独立结算，不叠加。；limits=无施放次数上限；每次技力回满结算一次。
- 效果2：结算后8秒内自身攻击力+15%/20%/25%/30%，期间不成为其他角色的治疗目标。
  - trigger=舍身突击结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.15,0.2,0.25,0.3],"duration":[8,8,8,8]}；stacking=同名增益只刷新持续时间，不叠加层数。；limits=每次施放刷新计时，无全局次数限制。
- 效果3：对每个被自身阻挡的命中目标，回复自身相当于该次伤害35%/40%/45%/50%的生命。
  - trigger=舍身突击命中已被自身阻挡的敌人；target=自身；action=heal；lifecycle=instant
  - values={"healScale":[0.35,0.4,0.45,0.5]}；stacking=多名目标分别结算并累加。；limits=每次施放内每个目标最多结算一次。

### 原生天赋计划
- 自愈能力（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_127_estell/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 原生为周围8格敌人倒下时回复自身最大生命7%/12%。进击改写为触发式：周围8格内有敌人被击倒时回复自身最大生命4%/5%/6%/7%（按星级），同一敌人只计一次，每场战斗无次数上限。
  - scope=周围8格；parameters={"healRatio":[0.04,0.05,0.06,0.07],"radius":1,"perBattleCap":null}

### 进击被动
- 被动0：进击范围被动：每当周围8格内有敌人被击倒，回复自身最大生命4%/5%/6%/7%，重复击倒重复计数。
  - trigger=周围8格内有敌人被击倒；target=自身；action=heal；lifecycle=battle
  - values={"healRatio":[0.04,0.05,0.06,0.07],"radius":[1,1,1,1]}；stacking=每次成功击倒独立结算。；limits=仅对真实被击倒的敌人计数，召唤物与临时复制体消散不计。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：舍身突击伤害115%、自损30%、增益+15%持续8秒，回复按35%伤害。
  - 被动：击杀回血4%最大生命。
- ★2（攻×1.55、生命×1.65）：舍身突击伤害130%，增益+20%，回复按40%伤害。
  - 被动：击杀回血5%最大生命。
- ★3（攻×2.2、生命×2.6）：舍身突击伤害145%，增益+25%，回复按45%伤害。
  - 被动：击杀回血6%最大生命。
- ★4（攻×3、生命×4）：舍身突击伤害160%，增益+30%，回复按50%伤害。
  - 被动：击杀回血7%最大生命。

### 模组
- 默认模组：uniequip_002_estell
- `uniequip_001_estell`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_estell`（ADVANCED/rewrite）：三星解锁：舍身突击命中至少2名敌人时额外回复自身5%最大生命，并把攻击力增益延长2秒。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_127_estell`
实现：复用原生 centurion 群攻近卫 KIT 与敌人倒下事件；把 MANUAL 舍身突击改写为技力回满自动瞬发，接入范围伤害结算与 self hp cost。需新增 primitive：self_hp_cost_ratio(0.3)、blocked_hit_lifesteal(0.35-0.5)、on_enemy_death_radius_heal(4-7%, r8)；技能特效复用原生 prefab。
因果检查：
- 舍身突击在技力刚好回满的同一帧自动结算，且不消耗一次普攻事件；下一次普攻仍按原攻击间隔发生，验证瞬发不打断普攻节奏。
- 同一敌人被击倒只触发一次自愈回复；若敌人由队友击倒但位于周围8格内仍应触发，验证按位置而非击杀归属计数。

## 宴（`char_337_utage`）
- 职业：WARRIOR；档位：1（2 金币）；路线：`skillCycle`
- 定位：换血近卫·低血法术爆发
- 档位理由：二费低血爆发近卫，用主动损失生命换取法术斩与短时增益，成型依赖低血窗口，落一档。
- 设计理由：把原生部署被动落地斩·破门转为技力回满即瞬发：献祭当前生命换一次法术斩与短时攻击增益，保留损失生命、伤害转法术的换血特色，并让认真模式改为低血触发加速。

### 固定技能：落地斩·破门（进击）
- 来源技能：`skchr_utage_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[16,14,12,10]；初始技力：6
- 自然技力回满时自动瞬发：立即流失自身当前生命的一定比例，对前方一名敌人造成法术伤害，并在随后数秒内提升攻击力；若结算时自身生命低于50%，额外获得一段攻击速度增益。
- 效果1：立即对前方目标造成攻击力120%/135%/150%/175%的法术伤害，并流失自身当前生命的25%。
  - trigger=技力自然回满时自动施放，不等待下一次普通攻击；target=前方1名敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.2,1.35,1.5,1.75],"selfHpCostRatio":[0.25,0.25,0.25,0.25],"damageType":["法术","法术","法术","法术"]}；stacking=每次施放独立结算。；limits=无施放次数上限。
- 效果2：随后6/7/8/9秒内自身攻击力+20%/25%/30%/40%。
  - trigger=落地斩结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.2,0.25,0.3,0.4],"duration":[6,7,8,9]}；stacking=只刷新持续时间，不叠加。；limits=每次施放刷新计时。
- 效果3：额外获得攻击速度+10/15/20/25，持续4秒（四星为5秒）。
  - trigger=结算时自身生命低于50%；target=自身；action=haste；lifecycle=battle
  - values={"attackSpeedBonus":[10,15,20,25],"duration":[4,4,4,5]}；stacking=与认真模式攻速线性相加，不乘算。；limits=每次低血结算最多触发一次。

### 原生天赋计划
- 认真模式（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_337_utage/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 原生为损失50%生命时获得+50攻速的坚忍。进击改写为触发式时限：生命损失达到50%/60%/70%时，获得攻击速度+30/45/60/80，持续5秒，冷却8秒；不在损失期间常驻。
  - scope=自身；parameters={"lostHpThreshold":[0.5,0.6,0.7,0.7],"attackSpeedBonus":[30,45,60,80],"duration":5,"cooldown":8}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：进击低血扳机：低血状态下每击倒一名敌人获得2/3/4/5点技力，重复击倒重复计数。
  - trigger=自身生命值低于50%时成功击倒敌人；target=自身；action=spGain；lifecycle=battle
  - values={"sp":[2,3,4,5]}；stacking=每次击杀独立结算。；limits=只计真实被击倒的敌人，每场战斗无总次数上限。

### 星级
- ★1（攻×1、生命×1）：落地斩120%法术、自损25%、增益+20%/6秒；低血额外攻速+10。
  - 被动：低血击杀回2技力；认真模式攻速+30/5秒。
- ★2（攻×1.55、生命×1.65）：落地斩135%，增益+25%/7秒；低血攻速+15。
  - 被动：低血击杀回3技力；认真模式攻速+45。
- ★3（攻×2.2、生命×2.6）：落地斩150%，增益+30%/8秒；低血攻速+20。
  - 被动：低血击杀回4技力；认真模式攻速+60。
- ★4（攻×3、生命×4）：落地斩175%，增益+40%/9秒；低血攻速+25/5秒。
  - 被动：低血击杀回5技力；认真模式攻速+80。

### 模组
- 默认模组：uniequip_002_utage
- `uniequip_001_utage`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_utage`（ADVANCED/rewrite）：三星解锁：落地斩结算时若自身生命低于50%，返还1点技力并使本次法术伤害+10%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_337_utage`
实现：复用 musha 近卫 KIT 与损失生命事件；把 PASSIVE 落地斩改写为技力回满自动瞬发的主动斩。需新增 primitive：self_hp_cost_ratio(0.25)、skill_damage_type_override(法术)、low_hp_trigger(0.5) 与 haste 时限；资源复用原生落地斩特效。
因果检查：
- 技力回满触发落地斩时若自身生命恰好等于50%，按高于阈值处理不触发低血攻速段，验证边界取严。
- 连续两次击杀在同一帧发生则分别获得技力，验证重复计数不合并；敌人被队友击倒时不获得技力。

## 休谟斯（`char_491_humus`）
- 职业：WARRIOR；档位：2（3 金币）；路线：`healShield`
- 定位：收割近卫·屏障续航前排
- 档位理由：三费的前排收割者，靠群攻吸血与过量治疗转屏障站场，职责稳定但需要多目标，落二档。
- 设计理由：以原生收割者范围吸血与再回收屏障为核心：技力回满立即对阻挡敌人结算一次范围切割并回血叠屏障，保留 reaper 多目标承伤换续航的特色。

### 固定技能：高效处理（进击）
- 来源技能：`skchr_humus_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[18,16,14,12]；初始技力：8
- 自然技力回满时立即自动结算：对自身阻挡的所有敌人造成物理伤害，每命中一名敌人回复自身生命并获得一层屏障，持续期间阻挡数+1。
- 效果1：对自身阻挡的每名敌人造成攻击力90%/105%/120%/140%的物理伤害。
  - trigger=技力自然回满时自动施放；target=自身阻挡的所有敌人；action=damage；lifecycle=instant
  - values={"atkScale":[0.9,1.05,1.2,1.4],"maxTarget":[99,99,99,99]}；stacking=按阻挡敌人数量逐名结算。；limits=仅命中当前被自身阻挡的敌人。
- 效果2：每命中一名敌人回复自身相当于该次伤害30%/35%/40%/45%的生命。
  - trigger=高效处理每命中一名敌人；target=自身；action=heal；lifecycle=instant
  - values={"healScale":[0.3,0.35,0.4,0.45]}；stacking=多名命中分别结算累加。；limits=每次施放每名敌人最多一次。
- 效果3：获得相当于最大生命15%/20%/25%/30%的屏障，并在10秒（四星12秒）内阻挡数+1。
  - trigger=高效处理结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"barrierRatio":[0.15,0.2,0.25,0.3],"blockBonus":[1,1,1,1],"duration":[10,10,10,12]}；stacking=同名屏障取较高值不叠加；阻挡增益刷新时长。；limits=每次施放刷新计时。

### 原生天赋计划
- 再回收（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_491_humus/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：超出生命上限的治疗量转化为屏障，最高不超过最大生命的60%/100%（按培养阶段）。进击沿用该机制，屏障由高效处理的过量治疗与直接屏障共同填充。
  - scope=自身；parameters={"barrierCap":[0.6,0.6,1,1]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击职业联动：收割者每次普通攻击命中至少2名敌人时回复自身最大生命2%/3%/4%/5%，重复命中重复计数。
  - trigger=普通攻击同时命中至少2名敌人；target=自身；action=heal；lifecycle=battle
  - values={"healRatio":[0.02,0.03,0.04,0.05]}；stacking=每次符合条件的攻击只结算一次。；limits=单次攻击命中多名敌人也只触发一次。

### 星级
- ★1（攻×1、生命×1）：高效处理90%伤害、回血30%、屏障15%/阻挡+1持续10秒。
  - 被动：多目标普攻回2%最大生命。
- ★2（攻×1.55、生命×1.65）：105%伤害、回血35%、屏障20%。
  - 被动：多目标普攻回3%。
- ★3（攻×2.2、生命×2.6）：120%伤害、回血40%、屏障25%。
  - 被动：多目标普攻回4%。
- ★4（攻×3、生命×4）：140%伤害、回血45%、屏障30%/阻挡+1持续12秒。
  - 被动：多目标普攻回5%。

### 模组
- 默认模组：uniequip_002_humus
- `uniequip_001_humus`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_humus`（ADVANCED/rewrite）：三星解锁：高效处理命中至少2名敌人时屏障比例+5%，且屏障存在期间防御力+10%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_491_humus`
实现：复用 reaper 近卫 KIT 的群攻吸血与过量治疗转屏障；把 MANUAL 高效处理改写为技力回满瞬发，接入阻挡目标收集与逐目标吸血。需新增 primitive：overheal_to_barrier(cap60%/100%) 已存在则复用、blocked_targets_damage、per_target_lifesteal；特效复用原生。
因果检查：
- 高效处理只命中当前被自己阻挡的敌人；施放后新进入阻挡范围的敌人不补结算，验证目标快照在施放瞬间。
- 再回收屏障达到上限后继续过量治疗不再叠加；上限从60%升到100%时已有屏障不被清空。

## 砾（`char_237_gravel`）
- 职业：SPECIAL；档位：2（3 金币）；路线：`redeploy`
- 定位：快速再部署·诱饵护屏
- 档位理由：三费的快速再部署诱饵，费用低、再部署快，可反复吸收关键伤害与仇恨，落二档。
- 设计理由：保留原生快速部署与部署屏障：进击把鼠群改写为技力回满瞬发的屏障与嘲讽，服务再部署循环，绝不做成普通单击输出。

### 固定技能：鼠群（进击）
- 来源技能：`skchr_gravel_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[10,8,7,6]；初始技力：4
- 自然技力回满时立即自动结算：获得一层按最大生命比例计算、在10秒内持续衰减的屏障，并短暂强制周围敌人优先攻击自身。
- 效果1：获得相当于最大生命180%/200%/220%/250%的屏障，在10秒（四星12秒）内线性衰减到0。
  - trigger=技力自然回满时自动施放；target=自身；action=addBuff；lifecycle=battle
  - values={"barrierRatio":[1.8,2,2.2,2.5],"duration":[10,10,10,12]}；stacking=新屏障覆盖旧屏障并按新上限重新衰减，不累加。；limits=每次施放一次，无次数上限。
- 效果2：3/4/5/6秒内强制周围2格（四星3格）内敌人优先将自身作为攻击目标。
  - trigger=鼠群结算后；target=周围敌人；action=targeting；lifecycle=battle
  - values={"tauntDuration":[3,4,5,6],"radius":[2,2,2,3]}；stacking=嘲讽按最新一次刷新时长，不叠加。；limits=只影响可被嘲讽的敌人，免疫者不受影响。

### 原生天赋计划
- 快速部署（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_237_gravel/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生快速再部署：自身部署费用-1，再部署时间沿用快速再部署区间。另一候选小个子支援的防御光环也保留为范围被动，不改为常驻加速。
  - scope=自身/周围；parameters={"deployCostDelta":-1,"allyDefRatio":[0,0,0,0.06]}；trigger=部署/再部署后；unlockStar=1

### 进击被动
- 被动0：进击再部署扳机：每次真正再部署后10秒内自身防御力+50%/60%/70%/80%，服务诱饵循环。
  - trigger=自身完成一次再部署；target=自身；action=addBuff；lifecycle=battle
  - values={"defRatio":[0.5,0.6,0.7,0.8],"duration":[10,10,10,10]}；stacking=刷新持续时间，不叠加。；limits=只对真实再部署计数，移位不算。

### 星级
- ★1（攻×1、生命×1）：鼠群屏障180%最大生命/10秒衰减，嘲讽3秒/2格。
  - 被动：再部署后防御+50%/10秒。
- ★2（攻×1.55、生命×1.65）：屏障200%，嘲讽4秒。
  - 被动：再部署后防御+60%。
- ★3（攻×2.2、生命×2.6）：屏障220%，嘲讽5秒。
  - 被动：再部署后防御+70%。
- ★4（攻×3、生命×4）：屏障250%/12秒，嘲讽6秒/3格。
  - 被动：再部署后防御+80%。

### 模组
- 默认模组：uniequip_002_gravel
- `uniequip_001_gravel`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_gravel`（ADVANCED/rewrite）：三星解锁：再部署后的防御增益延长至15秒，且鼠群屏障衰减结束后回复10%最大生命。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_237_gravel`
实现：复用 executor 近卫（快速再部署）KIT；把 PASSIVE 鼠群改写为技力回满自动施放的屏障+嘲讽。需新增 primitive：self_shield_decay(ratio,duration)、redirect_taunt(radius,duration)、redeploy_event；复用原生再部署与屏障表现。
因果检查：
- 再部署后防御增益按新部署实例计时；同一部署内多次施放技能不会叠加防御层数，只刷新时长。
- 嘲讽期间敌人对自身造成伤害应先消耗屏障；屏障衰减到0时嘲讽若仍在持续则照常保留。

## 诗怀雅（`char_308_swire`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`skillCycle`
- 定位：教官·近战攻击光环支点
- 档位理由：六费教官支点，为周围近战提供稳定攻击增益并具备自身输出，是成型编队的增益核心，落三档。
- 设计理由：以原生近距离作战指导光环为核心：技力回满立即强化周围近战并提升自身攻击，保留教官光环与范围联动的特色，不做全队匿名羁绊。

### 固定技能：协同作战（进击）
- 来源技能：`skchr_swire_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[22,20,18,15]；初始技力：10
- 自然技力回满时立即自动结算：在15秒内使周围8格内近战友方单位攻击力提升，同时自身攻击力大幅提升。
- 效果1：周围8格内近战友方单位攻击力+20%/25%/30%/35%，持续15秒。
  - trigger=技力自然回满时自动施放；target=周围8格内近战友方单位；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.2,0.25,0.3,0.35],"duration":[15,15,15,15],"radius":[1,1,1,1]}；stacking=同名增益只刷新持续时间，不叠加。；limits=只影响施放瞬间在范围内的近战单位。
- 效果2：自身攻击力+50%/60%/70%/80%，持续15秒。
  - trigger=协同作战结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.5,0.6,0.7,0.8],"duration":[15,15,15,15]}；stacking=与天赋光环线性相加。；limits=每次施放刷新计时。

### 原生天赋计划
- 近距离作战指导（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_308_swire/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：在场时周围8格内近战友方单位攻击力+3%/6%/10%（按星级取对应档）。进击沿用该范围被动，不做常驻全队加速。
  - scope=周围8格近战单位；parameters={"atkRatio":[0.03,0.03,0.06,0.1],"radius":1}

### 进击被动
- 被动0：进击范围被动：近战友方单位进入光环范围时立即获得攻击力+3%/4%/5%/6%，离开后移除；同一单位反复进出不叠加层数。
  - trigger=近战友方单位进入自身周围8格；target=该友方单位；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.03,0.04,0.05,0.06]}；stacking=同一单位只保留一层，刷新数值。；limits=只对近战单位生效，远程进入不触发。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：协同作战友军攻击+20%、自身+50%，15秒。
  - 被动：光环+3%，入场触发+3%。
- ★2（攻×1.55、生命×1.65）：友军+25%、自身+60%。
  - 被动：光环+3%，入场触发+4%。
- ★3（攻×2.2、生命×2.6）：友军+30%、自身+70%。
  - 被动：光环+6%，入场触发+5%。
- ★4（攻×3、生命×4）：友军+35%、自身+80%。
  - 被动：光环+10%，入场触发+6%。

### 模组
- 默认模组：uniequip_002_swire
- `uniequip_001_swire`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_swire`（ADVANCED/rewrite）：三星解锁：协同作战影响范围扩大至周围8格且友军增益额外+5%，自身施放时回复1点技力。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_308_swire`
实现：复用 instructor 教官光环 KIT；把 MANUAL 协同作战改写为技力回满瞬发的范围增益。需新增 primitive：radius_ally_buff(r8,meleeOnly)、ally_enter_aura_apply/remove；光环与技能增益分属不同来源，便于重复状态计数。
因果检查：
- 同一近战单位在光环内反复进出，攻击力增益始终只有一层且取最新数值，验证不叠层。
- 远程单位进入周围8格不触发光环；重新部署的近战单位应重新获得一层而非叠加。

## 鞭刃（`char_265_sophia`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`blockCounter`
- 定位：教官·阻挡反制支点
- 档位理由：六费教官支点，为高阻挡友军提供攻速防御并自带阻挡反制，是重装体系的联动核心，落三档。
- 设计理由：以原生责骂与阻挡反制为核心：技力回满立即强化阻挡数≥3的友军，并把阻挡反制做成具名扳机被动，保留教官按阻挡数生效的特色。

### 固定技能：鞭刃（进击）
- 来源技能：`skchr_sophia_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[24,22,20,17]；初始技力：10
- 自然技力回满时立即自动结算：20秒内使阻挡数≥3的友方近战单位攻击速度与防御力提升，攻击范围扩大并阻挡数+1，可同时攻击阻挡的所有敌人。
- 效果1：目标攻击速度+4/6/8/10、防御力+8%/12%/16%/20%，持续20秒。
  - trigger=技力自然回满时自动施放；target=阻挡数≥3的友方近战单位；action=addBuff；lifecycle=battle
  - values={"attackSpeedBonus":[4,6,8,10],"defRatio":[0.08,0.12,0.16,0.2],"duration":[20,20,20,20]}；stacking=同名增益刷新时长，不叠加。；limits=仅对施放瞬间阻挡数≥3的单位生效。
- 效果2：自身攻击力+35%/42%/50%/60%，阻挡数+1，攻击范围向前+1格，持续20秒。
  - trigger=鞭刃结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.35,0.42,0.5,0.6],"blockBonus":[1,1,1,1],"rangeExtend":[1,1,1,1],"duration":[20,20,20,20]}；stacking=刷新时长，不叠层。；limits=每次施放刷新计时。

### 原生天赋计划
- 责骂（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_265_sophia/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：在场时阻挡数≥3的友方近战单位攻速+2/4/6、防御+4%/8%/12%（按星级）。进击延续按阻挡阈值判定，不做无门槛全队增益。
  - scope=阻挡数≥3的友方近战单位；parameters={"blockThreshold":3,"attackSpeedBonus":[2,2,4,6],"defRatio":[0.04,0.04,0.08,0.12]}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：进击阻挡扳机：阻挡数≥3的友方单位每次受到近战攻击，攻击者受到等同于鞭刃攻击力30%/40%/50%/60%的物理反弹，同一敌人每秒最多结算一次。
  - trigger=阻挡数≥3的友方单位受到近战攻击；target=该攻击者；action=damage；lifecycle=instant
  - values={"atkScale":[0.3,0.4,0.5,0.6],"perSecondCap":[1,1,1,1]}；stacking=按受击事件计数，重复受击重复计数。；limits=每个敌人每秒最多反弹一次。

### 星级
- ★1（攻×1、生命×1）：鞭刃近战友军攻速+4/防御+8%，自身+35%/阻挡+1/范围+1，20秒。
  - 被动：责骂+2攻速/+4%防御；反弹30%。
- ★2（攻×1.55、生命×1.65）：友军攻速+6/防御+12%，自身+42%。
  - 被动：反弹40%。
- ★3（攻×2.2、生命×2.6）：友军攻速+8/防御+16%，自身+50%。
  - 被动：责骂+4攻速/+8%防御；反弹50%。
- ★4（攻×3、生命×4）：友军攻速+10/防御+20%，自身+60%。
  - 被动：责骂+6攻速/+12%防御；反弹60%。

### 模组
- 默认模组：uniequip_002_sophia
- `uniequip_001_sophia`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_sophia`（ADVANCED/rewrite）：三星解锁：反弹对阻挡数≥3目标额外+10%伤害；鞭刃期间自身阻挡数再+1。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_265_sophia`
实现：复用 instructor 教官与承伤事件；把 MANUAL 鞭刃改写为技力回满瞬发的范围增益。需新增 primitive：block_count_threshold_filter(3)、on_ally_meleed_attack_reflect(scale, perEnemyCap)、buff_attack_range_extend；复用原生鞭刃特效。
因果检查：
- 同一敌人对阻挡数≥3友军连续两次近战攻击在同一秒内，只触发一次反弹，验证每秒上限。
- 单位在施放瞬间阻挡数恰好为3即被视为目标，之后降到2不撤销已挂增益，验证按施放快照。

## 摩根（`char_154_morgan`）
- 职业：WARRIOR；档位：2（3 金币）；路线：`pierceCrit`
- 定位：狂战士·低血屏障前排
- 档位理由：三费低血前排，以自损换屏障和坚忍攻击，输出与承伤兼具但需控血，落二档。
- 设计理由：以原生无畏招架的部署屏障与沸血坚忍为核心：技力回满立即自损最大生命换屏障，并把坚忍改为低血触发，保留低血高攻的前排特色。

### 固定技能：无畏招架（进击）
- 来源技能：`skchr_morgan_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[12,11,10,9]；初始技力：5
- 自然技力回满时立即自动结算：流失自身最大生命的一定比例，获得按最大生命计算的衰减屏障，并在6秒内每次普通攻击额外造成物理伤害。
- 效果1：立即流失自身最大生命的70%（不会因该流失致死，最低保留1点）。
  - trigger=技力自然回满时自动施放；target=自身；action=applyStatus；lifecycle=instant
  - values={"selfMaxHpCostRatio":[0.7,0.7,0.7,0.7]}；stacking=每次施放独立结算。；limits=自损不致死。
- 效果2：获得相当于最大生命130%/140%/150%/160%的屏障，在6秒内持续衰减。
  - trigger=无畏招架结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"barrierRatio":[1.3,1.4,1.5,1.6],"shieldDuration":[6,6,6,6]}；stacking=覆盖旧屏障并按新上限衰减。；limits=每次施放刷新。
- 效果3：6秒内每次普通攻击额外附带攻击力60%/70%/80%/90%的物理伤害。
  - trigger=屏障存在期间普通攻击；target=被命中的敌人；action=damage；lifecycle=battle
  - values={"extraAtkScale":[0.6,0.7,0.8,0.9],"duration":[6,6,6,6]}；stacking=每次普攻触发一次，按攻击次数计数。；limits=仅屏障存在期间生效。

### 原生天赋计划
- 沸血先锋（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_154_morgan/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 原生为损失70%生命时获得+40%/50%攻击的坚忍。进击改写为触发式时限：生命损失达到70%时获得攻击力+35%/45%/55%/65%，持续6秒，冷却10秒，不在损失期间常驻。
  - scope=自身；parameters={"lostHpThreshold":0.7,"atkBonus":[0.35,0.45,0.55,0.65],"duration":6,"cooldown":10}；trigger=被动常驻；unlockStar=1
- 主场作战（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_154_morgan/talents/1`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 原生仅在惊霆无声关卡部署不消耗部署位。进击改写为与地图无关的每场战斗一次：首次部署自身时本次部署费用-2，不改变全队经济规则。
  - scope=自身首次部署；parameters={"deployCostDelta":-2,"perBattle":1}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击低血被动：生命低于40%时攻击力+20%/25%/30%/35%，并无视目标15%/20%/25%/30%防御；回到阈值以上即移除。
  - trigger=自身生命值低于40%；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.2,0.25,0.3,0.35],"ignoreDefRatio":[0.15,0.2,0.25,0.3]}；stacking=只保留一层，数值按星级固定。；limits=低于阈值期间持续。

### 星级
- ★1（攻×1、生命×1）：无畏招架自损70%最大生命、屏障130%/6秒、普攻附加60%。
  - 被动：低血攻击+20%/无视15%；坚忍+35%/6秒。
- ★2（攻×1.55、生命×1.65）：屏障140%、附加70%。
  - 被动：低血+25%/无视20%；坚忍+45%。
- ★3（攻×2.2、生命×2.6）：屏障150%、附加80%。
  - 被动：低血+30%/无视25%；坚忍+55%。
- ★4（攻×3、生命×4）：屏障160%、附加90%。
  - 被动：低血+35%/无视30%；坚忍+65%。

### 模组
- 默认模组：uniequip_002_morgan
- `uniequip_001_morgan`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_morgan`（ADVANCED/rewrite）：三星解锁：无畏招架自损比例降至60%，屏障额外+10%最大生命。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_154_morgan`
实现：复用 fearless 近卫 KIT 与 self damage/护盾事件；把 PASSIVE 无畏招架改写为技力回满自动施放。需新增 primitive：self_maxhp_cost_nonlethal(0.7)、on_normal_attack_extra_damage(duration)、low_hp_berserk(threshold, bonus, cooldown)；复用原生屏障表现。
因果检查：
- 自损70%最大生命在生命仅剩1点时不再致死，且仍获得完整屏障，验证非致死下限。
- 低血被动在生命于40%附近反复上下时按阈值进入/退出，不叠加层数；同一每次普攻的额外伤害按攻击次数逐次结算。

## 因陀罗（`char_155_tiger`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`pierceCrit`
- 定位：闪避近卫·法术吸血流
- 档位理由：六费的高闪避近战，靠闪避刷新强化攻击并把伤害转法术吸血，单挑与续航兼具，落三档。
- 设计理由：以原生虎拳迅击的闪避反击与裂魂的伤害转法术为核心：技力回满立即结算一次法术斩并按伤害吸血，保留闪避、破防与吸血的连招特色。

### 固定技能：裂魂（进击）
- 来源技能：`skchr_tiger_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[20,18,16,14]；初始技力：9
- 自然技力回满时立即自动结算：对前方一名敌人造成法术伤害并无视其部分防御，随后按造成的伤害回复自身生命。
- 效果1：对目标造成攻击力75%/90%/105%/120%的法术伤害，并无视其45%/50%/55%/60%防御力。
  - trigger=技力自然回满时自动施放；target=前方1名敌人；action=damage；lifecycle=instant
  - values={"atkScale":[0.75,0.9,1.05,1.2],"ignoreDefRatio":[0.45,0.5,0.55,0.6],"damageType":["法术","法术","法术","法术"]}；stacking=每次施放独立结算。；limits=无施放次数上限。
- 效果2：回复自身相当于本次伤害20%/22%/25%/28%的生命。
  - trigger=裂魂造成伤害后；target=自身；action=heal；lifecycle=instant
  - values={"healScale":[0.2,0.22,0.25,0.28]}；stacking=每次施放结算一次。；limits=以实际造成伤害为准，过量不额外回血。

### 原生天赋计划
- 虎拳迅击（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_155_tiger/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：有15%/30%概率闪避敌人近战物理攻击，闪避成功后下一次攻击攻击力+80%/100%。进击沿用该闪避-反击链，闪避成功就计数。
  - scope=自身；parameters={"dodgeChance":[0.15,0.15,0.3,0.3],"nextAtkBonus":[0.8,0.8,1,1]}

### 进击被动
- 被动0：进击闪避扳机：成功闪避后下一次攻击攻击力+80%/90%/100%/110%，仅一层，被下一次攻击消耗。
  - trigger=自身成功闪避一次近战物理攻击；target=自身；action=addBuff；lifecycle=battle
  - values={"nextAtkBonus":[0.8,0.9,1,1.1],"stacks":[1,1,1,1]}；stacking=最多一层，重复闪避只刷新数值不叠加。；limits=免疫或未命中的攻击不计闪避。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：裂魂75%法术/无视45%防御/吸血20%。
  - 被动：闪避15%、反击+80%。
- ★2（攻×1.55、生命×1.65）：90%/无视50%/吸血22%。
  - 被动：闪避15%、反击+90%。
- ★3（攻×2.2、生命×2.6）：105%/无视55%/吸血25%。
  - 被动：闪避30%、反击+100%。
- ★4（攻×3、生命×4）：120%/无视60%/吸血28%。
  - 被动：闪避30%、反击+110%。

### 模组
- 默认模组：uniequip_002_tiger
- `uniequip_001_tiger`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_tiger`（ADVANCED/rewrite）：三星解锁：闪避成功后下一次裂魂伤害+15%；裂魂法术伤害的吸血提高至35%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_155_tiger`
实现：复用 fighter 近卫 KIT 与闪避/命中事件；把 MANUAL 裂魂改写为技力回满瞬发的法术斩。需新增 primitive：dodge_event(melee_phys)、consume_on_next_attack_buff、damage_ignore_def_ratio、spell_lifesteal；复用原生裂魂特效。
因果检查：
- 闪避成功获得的反击增益在下一次攻击结算后立即消耗，未攻击时一直保留且不叠层，验证消耗时机。
- 法术斩的无视防御按目标当前防御计算；对免疫法术的目标不造成伤害也不吸血，验证伤害前置。

## 拉普兰德（`char_140_whitew`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`skillCycle`
- 定位：领主近卫·沉默法术双击
- 档位理由：六费的中距离领主，以沉默压制机制敌人并用法术双击输出，是反制型支点，落四档。
- 设计理由：以原生精神摧毁与狼魂为核心：技力回满立即结算对至多2个目标的范围法术伤害并施加沉默，保留领主远程不衰减与沉默压制特色。

### 固定技能：狼魂（进击）
- 来源技能：`skchr_whitew_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[18,16,14,12]；初始技力：7
- 自然技力回满时立即自动结算：对攻击范围内至多2名敌人造成法术伤害并使其特殊能力失效，同时自身获得短时攻击力提升且远程攻击不再降低伤害。
- 效果1：对至多2名（四星3名）敌人造成攻击力90%/105%/120%/140%的法术伤害。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多2名敌人；action=damage；lifecycle=instant
  - values={"atkScale":[0.9,1.05,1.2,1.4],"maxTarget":[2,2,2,3],"damageType":["法术","法术","法术","法术"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：使命中目标特殊能力失效1/3/5/5秒。
  - trigger=狼魂命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"silenceDuration":[1,3,5,5]}；stacking=重复施加刷新时长不叠层，每次成功施加计一次沉默事件。；limits=免疫沉默的敌人不被计数。
- 效果3：10秒（四星12秒）内自身攻击力+30%/40%/50%/60%，远程攻击不降低攻击力。
  - trigger=狼魂结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.3,0.4,0.5,0.6],"duration":[10,10,10,12]}；stacking=刷新时长，不叠加。；limits=每次施放刷新计时。

### 原生天赋计划
- 精神摧毁（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_140_whitew/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：攻击使目标的特殊能力失效1/5秒（按阶段）。进击把普攻沉默保留为扳机，技能再额外触发更长沉默，重复命中重复计数。
  - scope=被攻击目标；parameters={"silence":[1,1,5,5]}

### 进击被动
- 被动0：进击普攻扳机：每次普攻成功使命中目标沉默1/1/5/5秒，重复命中重复计数。
  - trigger=普通攻击命中敌人；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"silenceDuration":[1,1,5,5]}；stacking=刷新时长，按成功施加次数计数。；limits=免疫或被闪避的攻击不计。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：狼魂对2目标90%法术、沉默1秒、自身+30%/10秒。
  - 被动：普攻沉默1秒。
- ★2（攻×1.55、生命×1.65）：105%法术、沉默3秒、自身+40%。
  - 被动：普攻沉默1秒。
- ★3（攻×2.2、生命×2.6）：120%法术、沉默5秒、自身+50%。
  - 被动：普攻沉默5秒。
- ★4（攻×3、生命×4）：对3目标140%法术、沉默5秒、自身+60%/12秒。
  - 被动：普攻沉默5秒。

### 模组
- 默认模组：uniequip_002_whitew
- `uniequip_001_whitew`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_whitew`（ADVANCED/rewrite）：三星解锁：对已沉默目标造成伤害+15%；狼魂施放时若命中至少2名目标回复1点技力。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_140_whitew`
实现：复用 lord 领主 KIT 与沉默状态系统；把 AUTO 狼魂改写为技力回满瞬发多目标法术斩。需新增 primitive：multi_target_snapshot、silence_on_hit(success_counted)、remote_no_penalty_buff；复用原生狼魂特效。
因果检查：
- 对已沉默目标再次施加沉默仍计一次成功施加，但在同一因果链同一被动对同一对象只结算一次；独立的下一次普攻开启新链可再计。
- 免疫沉默的敌人被命中造成伤害但不产生沉默计数；远程攻击在增益期间不触发领主的攻速/伤害衰减。

## 断崖（`char_294_ayer`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`blockCounter`
- 定位：领主近卫·友军阻挡法术炮台
- 档位理由：六费领主支点，把周围友军阻挡的敌人一起纳入法术打击，配合阻挡体系放大收益，落四档。
- 设计理由：以原生浮游刃启动与索敌援助为核心：技力回满立即对周围8格友军阻挡的敌人结算范围法术伤害并停顿，保留领主范围与团队联动特色。

### 固定技能：浮游刃启动（进击）
- 来源技能：`skchr_ayer_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[22,20,17,14]；初始技力：9
- 自然技力回满时立即自动结算：对周围8格内被友方单位阻挡的所有敌人造成法术伤害并使其停顿，自身获得短时攻击力提升。
- 效果1：对周围8格内被友方单位阻挡的敌人各造成攻击力100%/120%/140%/170%的法术伤害。
  - trigger=技力自然回满时自动施放；target=周围8格内被友方单位阻挡的敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1,1.2,1.4,1.7],"radius":[1,1,1,1],"damageType":["法术","法术","法术","法术"]}；stacking=逐目标结算，同一敌人只结算一次。；limits=仅包含当前被友方阻挡的敌人。
- 效果2：使命中目标停顿1秒（四星1.5秒）。
  - trigger=浮游刃命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"sluggishDuration":[1,1,1,1.5]}；stacking=重复施加刷新时长，每次成功施加计数一次。；limits=免疫停顿者不计。
- 效果3：10秒内自身攻击力+30%/40%/50%/60%。
  - trigger=浮游刃结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.3,0.4,0.5,0.6],"duration":[10,10,10,10]}；stacking=刷新时长。；limits=每次施放刷新。

### 原生天赋计划
- 索敌援助（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_294_ayer/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：自身与周围8格友方干员攻击速度+4/+8（按阶段）。进击沿用以自身为源的范围光环，不扩散到全场。
  - scope=周围8格；parameters={"attackSpeedBonus":[4,4,4,8],"radius":1}；trigger=范围内的对应事件；unlockStar=1

### 进击被动
- 被动0：进击阻挡联动：周围8格内被友方阻挡的敌人每次被攻击，额外承受断崖攻击力25%/30%/35%/40%的法术伤害，同一敌人每秒最多一次。
  - trigger=周围8格内友方单位阻挡的敌人受到攻击；target=该敌人；action=damage；lifecycle=instant
  - values={"atkScale":[0.25,0.3,0.35,0.4],"perSecondCap":[1,1,1,1]}；stacking=按受击事件计数。；limits=每个敌人每秒最多结算一次。

### 星级
- ★1（攻×1、生命×1）：浮游刃100%法术、停顿1秒、自身+30%/10秒。
  - 被动：索敌攻速+4；阻挡追击25%。
- ★2（攻×1.55、生命×1.65）：120%法术、自身+40%。
  - 被动：索敌攻速+4；追击30%。
- ★3（攻×2.2、生命×2.6）：140%法术、自身+50%。
  - 被动：索敌攻速+8；追击35%。
- ★4（攻×3、生命×4）：170%法术、停顿1.5秒、自身+60%。
  - 被动：索敌攻速+8；追击40%。

### 模组
- 默认模组：uniequip_002_ayer
- `uniequip_001_ayer`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_ayer`（ADVANCED/rewrite）：三星解锁：对友方阻挡目标的法术伤害+15%；光环范围内每有一名友军，浮游刃伤害额外+3%（最多+15%）。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_294_ayer`
实现：复用 lord 领主 KIT 与 block 归属查询；把 MANUAL 浮游刃启动改写为技力回满瞬发的阻挡目标收集。需新增 primitive：allies_blocked_enemies_query(r8)、per_enemy_second_cap、aura_attack_speed(self,radius)；复用原生浮游刃特效。
因果检查：
- 只有被友方单位阻挡的敌人被纳入；未被阻挡但处于范围内的敌人不结算，验证阻挡过滤。
- 同一敌人在同一秒内被多次攻击只触发一次额外法术伤害，验证每秒上限；下秒可再触发。

## 幽灵鲨（`char_143_ghost`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`healShield`
- 定位：群攻近卫·不死换血前排
- 档位理由：六费群攻前排，用短暂不死与攻击强化强行站场并群体输出，是高压波的保险，落四档。
- 设计理由：以原生肉斩骨断的不死效果与攻击强化为核心：技力回满立即获得短时不死与攻击增益，结束后承担晕眩代价，保留群攻与深海再生特色。

### 固定技能：肉斩骨断（进击）
- 来源技能：`skchr_ghost_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[24,22,20,17]；初始技力：12
- 自然技力回满时立即自动结算：获得攻击力提升并获得屏障，期间生命值不会低于1；持续结束后自身晕眩数秒。
- 效果1：8/8/9/10秒内攻击力+100%/120%/140%/160%，获得相当于最大生命40%/50%/60%/70%的屏障，且生命值不会低于1。
  - trigger=技力自然回满时自动施放；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[1,1.2,1.4,1.6],"barrierRatio":[0.4,0.5,0.6,0.7],"undeathDuration":[8,8,9,10]}；stacking=刷新时长，不叠加；同名不死取最长时长。；limits=每次施放刷新计时。
- 效果2：状态结束后自身晕眩8/7/6/5秒，作为换血的明确代价。
  - trigger=不死状态结束；target=自身；action=applyStatus；lifecycle=battle
  - values={"stunDuration":[8,7,6,5]}；stacking=不叠加，取最新一次。；limits=每次施放结算一次。

### 原生天赋计划
- 体力上限提升/深海再生力（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_143_ghost/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生阶段天赋：生命上限+10%，进阶后每秒回复最大生命2%。进击沿用回复作为常驻续航，不改为全队加速。
  - scope=自身；parameters={"hpRatio":[0,0,0.1,0.1],"regenPerSec":[0,0,0.02,0.02]}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：进击保命扳机：每场战斗一次，生命首次低于15%时立即回复最大生命30%/35%/40%/50%。
  - trigger=自身生命值首次低于15%；target=自身；action=heal；lifecycle=battle
  - values={"healRatio":[0.3,0.35,0.4,0.5],"perBattle":[1,1,1,1]}；stacking=每场战斗一次，不叠加。；limits=明确为每战斗一次。

### 星级
- ★1（攻×1、生命×1）：肉斩骨断+100%攻击/40%屏障/不死8秒，结束晕眩8秒。
  - 被动：生命上限+10%；低血一次回30%。
- ★2（攻×1.55、生命×1.65）：+120%/50%屏障/8秒，晕眩7秒。
  - 被动：低血回35%；进阶每秒回2%。
- ★3（攻×2.2、生命×2.6）：+140%/60%屏障/9秒，晕眩6秒。
  - 被动：低血回40%。
- ★4（攻×3、生命×4）：+160%/70%屏障/10秒，晕眩5秒。
  - 被动：低血回50%。

### 模组
- 默认模组：uniequip_002_ghost
- `uniequip_001_ghost`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_ghost`（ADVANCED/rewrite）：三星解锁：不死期间额外获得10%每秒最大生命回复；结束晕眩时间-1秒。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_143_ghost`
实现：复用 centurion 群攻近卫 KIT 与不死/晕眩状态；把 MANUAL 肉斩骨断改写为技力回满瞬发的自增益+不死。需新增 primitive：undeath_buff(minHp=1,duration)、after_buff_stun(duration)、once_per_battle_heal；复用原生不死特效。
因果检查：
- 不死期间连续受致命伤害生命保持为1，不触发低血保命回复；回复只在非不死状态且生命首次低于15%时结算。
- 不死状态结束时晕眩按施放时的星级时长生效；若在不死期间再次施放技能，晕眩取最新一次的时长而非叠加。

## 布洛卡（`char_356_broca`）
- 职业：WARRIOR；档位：2（3 金币）；路线：`blockCounter`
- 定位：群攻近卫·阻挡增伤线
- 档位理由：三费的群攻近卫，靠阻挡数换取攻防并把普攻转法术，稳定承伤兼具线伤，落二档。
- 设计理由：以原生钻头强化与高压电流为核心：技力回满立即结算一条线的法术伤害并停顿，同时按阻挡数提升自身，保留挡多越强的特色。

### 固定技能：高压电流（进击）
- 来源技能：`skchr_broca_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[16,14,12,10]；初始技力：7
- 自然技力回满时立即自动结算：攻击距离加长，对前方一条线上的敌人造成法术伤害并使其停顿，自身短暂获得攻击力与防御力提升。
- 效果1：对前方一线至多4/5/5/6名敌人造成攻击力140%/160%/175%/190%的法术伤害。
  - trigger=技力自然回满时自动施放；target=前方一线上的敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.4,1.6,1.75,1.9],"maxTarget":[4,5,5,6],"damageType":["法术","法术","法术","法术"]}；stacking=逐目标结算。；limits=仅命中当前一线上的敌人。
- 效果2：使命中目标停顿0.9/0.9/1/1秒。
  - trigger=高压电流命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"sluggishDuration":[0.9,0.9,1,1]}；stacking=刷新时长，每次成功施加计数。；limits=免疫停顿者不计。
- 效果3：10秒内自身攻击力与防御力各+30%/40%/50%/60%。
  - trigger=高压电流结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.3,0.4,0.5,0.6],"defBonus":[0.3,0.4,0.5,0.6],"duration":[10,10,10,10]}；stacking=刷新时长。；limits=每次施放刷新。

### 原生天赋计划
- 钻头强化（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_356_broca/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：阻挡两个及以上敌人时攻击力与防御力+6%/+12%（按阶段）。进击延续按阻挡阈值判定，不做无门槛常驻。
  - scope=自身；parameters={"blockThreshold":2,"atkDefRatio":[0.06,0.06,0.06,0.12]}

### 进击被动
- 被动0：进击阻挡扳机：阻挡数≥2时攻击力与防御力+6%/8%/10%/12%，降到1以下立即移除。
  - trigger=自身阻挡数达到2及以上；target=自身；action=addBuff；lifecycle=battle
  - values={"atkDefRatio":[0.06,0.08,0.1,0.12]}；stacking=只保留一层。；limits=按当前阻挡数实时判定。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：高压电流对4目标140%法术、停顿0.9秒、自身攻防+30%/10秒。
  - 被动：挡2攻防+6%。
- ★2（攻×1.55、生命×1.65）：160%法术、自身+40%。
  - 被动：挡2攻防+8%。
- ★3（攻×2.2、生命×2.6）：对5目标175%法术、停顿1秒、自身+50%。
  - 被动：挡2攻防+10%。
- ★4（攻×3、生命×4）：对6目标190%法术、自身+60%。
  - 被动：挡2攻防+12%。

### 模组
- 默认模组：uniequip_002_broca
- `uniequip_001_broca`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_broca`（ADVANCED/rewrite）：三星解锁：高压电流每命中一名敌人自身攻防增益额外+3%；法术伤害对停顿目标+10%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_356_broca`
实现：复用 centurion 群攻近卫 KIT 与阻挡计数；把 MANUAL 高压电流改写为技力回满瞬发的一线法术斩。需新增 primitive：line_targets_query(width)、tab_attack_time_buff(no)、damage_type_override(法术)、block_count_threshold_filter(2)；复用原生电流特效。
因果检查：
- 阻挡数从2降到1时增益立即移除且不保留层数，回到2时重新获得一层而非叠加。
- 当前方一线只有1名敌人时技能仍结算但只命中1个目标，验证不是强制满目标。

## 裁度（`char_4155_talr`）
- 职业：SPECIAL；档位：2（3 金币）；路线：`economyGrowth`
- 定位：商人特种·费用束缚控制
- 档位理由：三费的控制型商人，用部署费用换取范围束缚与持续伤害，是需要费用管理的支点，落二档。
- 设计理由：以原生谨慎择客与缝线缠身为核心：技力回满且费用足够时立即束缚周围敌人并持续切割，把消耗部署费用做成明确的进击代价。

### 固定技能：缝线缠身（进击）
- 来源技能：`skchr_talr_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[12,11,10,9]；初始技力：5
- 自然技力回满且当前部署费用足够时立即自动结算：束缚周围至多4名敌人并对其造成持续物理伤害，施放消耗固定部署费用。
- 效果1：束缚周围至多4名敌人2.5/3/3.5/4秒。
  - trigger=技力自然回满且当前部署费用≥2时自动施放；target=周围至多4名敌人；action=applyStatus；lifecycle=battle
  - values={"rootDuration":[2.5,3,3.5,4],"maxTarget":[4,4,4,4]}；stacking=刷新时长，重复成功施加重复计数。；limits=费用不足时本次不施放且技力保留。
- 效果2：对每名被束缚敌人在持续期间每秒造成攻击力130%/145%/160%/180%的物理伤害。
  - trigger=缝线缠身束缚期间每秒；target=被束缚的敌人；action=damage；lifecycle=battle
  - values={"atkScalePerSec":[1.3,1.45,1.6,1.8],"interval":[1,1,1,1]}；stacking=逐敌人逐秒结算。；limits=只对被本次技能束缚的目标生效。
- 效果3：施放消耗2/2/3/3点部署费用（不是购买金币），费用不足则不施放。
  - trigger=缝线缠身施放时；target=部署费用；action=spCost；lifecycle=run
  - values={"deployPointCost":[2,2,3,3]}；stacking=每次施放消耗一次。；limits=每场战斗无总次数上限，但每次都要真实费用。

### 原生天赋计划
- 谨慎择客（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4155_talr/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击未被自身阻挡的敌人时伤害+10%/+20%（按阶段）。进击沿用对未阻挡目标的增伤，配合束缚后仍未被阻挡的语义。
  - scope=自身；parameters={"unblockedDamageBonus":[0.1,0.1,0.1,0.2]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击经济成长：每消耗1点部署费用自身攻击力永久+2%/2.5%/3%/3.5%，单场上限+20%/25%/30%/35%。
  - trigger=本场战斗每消耗1点部署费用；target=自身；action=growth；lifecycle=battle
  - values={"atkPerDeployPoint":[0.02,0.025,0.03,0.035],"cap":[0.2,0.25,0.3,0.35]}；stacking=按累计消耗线性叠加，达上限停止。；limits=只统计部署费用，不含金币与科技。

### 星级
- ★1（攻×1、生命×1）：缝线束缚4目标2.5秒、每秒130%物理、耗2费用。
  - 被动：未阻挡增伤10%；每费用+2%攻上限20%。
- ★2（攻×1.55、生命×1.65）：3秒、145%、耗2费用。
  - 被动：未阻挡增伤10%；每费用+2.5%上限25%。
- ★3（攻×2.2、生命×2.6）：3.5秒、160%、耗3费用。
  - 被动：未阻挡增伤10%；每费用+3%上限30%。
- ★4（攻×3、生命×4）：4秒、180%、耗3费用。
  - 被动：未阻挡增伤20%；每费用+3.5%上限35%。

### 模组
- 默认模组：uniequip_002_talr
- `uniequip_001_talr`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_talr`（ADVANCED/rewrite）：三星解锁：缝线缠身施放费用-1（最低1）；被束缚目标移速额外-30%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4155_talr`
实现：复用 merchant 商人 KIT 与部署费用账目；把 MANUAL 缝线缠身改写为技力回满+费用门槛的瞬发控制。需新增 primitive：deploy_point_gate、persistent_root_dot、spend_deploy_points；费用与金币账目分开记录。
因果检查：
- 费用不足时技能不施放且技力不外溢浪费，费用恢复到门槛后下一帧自动施放，验证门槛语义。
- 对同一敌人重复施加束缚刷新时长并各计一次成功施加；束缚期间的每秒伤害只在其被本次技能束缚时结算。

## 崖心（`char_173_slchan`）
- 职业：SPECIAL；档位：2（3 金币）；路线：`pierceCrit`
- 定位：钩索特种·拖拽真伤控制
- 档位理由：三费的钩索特种，用拖拽把敌人拉离阵线并造成真实伤害与晕眩，是廉价硬控，落二档。
- 设计理由：以原生雪境猎手与束缚链为核心：技力回满立即把前方敌人拖到面前并造成真实伤害与晕眩，保留未阻挡增伤与位移控制特色。

### 固定技能：束缚链（进击）
- 来源技能：`skchr_slchan_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[14,12,11,9]；初始技力：6
- 自然技力回满时立即自动结算：把前方大范围内至多3名敌人拖拽到自身面前，造成真实伤害并晕眩。
- 效果1：将前方至多2/2/3/3名敌人拖拽至自身面前，力度中等至较大。
  - trigger=技力自然回满时自动施放；target=前方大范围至多3名敌人；action=move；lifecycle=instant
  - values={"maxTarget":[2,2,3,3],"force":[1,1.5,2,2],"pullToSelf":[1,1,1,1]}；stacking=逐目标结算。；limits=免疫位移的敌人不被拖拽但仍可受伤。
- 效果2：对每名目标造成攻击力170%/185%/200%/220%的真实伤害。
  - trigger=束缚链命中目标；target=被拖拽敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.7,1.85,2,2.2],"damageType":["真实","真实","真实","真实"]}；stacking=逐目标结算。；limits=以实际命中为准。
- 效果3：使命中目标晕眩1.5/2/2.5/3秒。
  - trigger=束缚链命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"stunDuration":[1.5,2,2.5,3]}；stacking=刷新时长，每次成功施加计数。；limits=免疫晕眩者不计。

### 原生天赋计划
- 雪境猎手（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_173_slchan/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：未阻挡敌人时攻击力与防御力各+6%/+12%（按阶段）。进击延续未阻挡判定，配合钩索常处于未阻挡状态。
  - scope=自身；parameters={"unblockedRatio":[0.06,0.06,0.06,0.12]}

### 进击被动
- 被动0：进击未阻挡扳机：未阻挡敌人时攻击力与防御力+6%/8%/10%/12%，一旦阻挡立即移除。
  - trigger=自身当前未阻挡任何敌人；target=自身；action=addBuff；lifecycle=battle
  - values={"atkDefRatio":[0.06,0.08,0.1,0.12]}；stacking=只保留一层。；limits=按当前阻挡数实时判定。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：束缚链拖2目标、170%真伤、晕眩1.5秒。
  - 被动：未阻挡攻防+6%。
- ★2（攻×1.55、生命×1.65）：185%真伤、晕眩2秒。
  - 被动：未阻挡攻防+8%。
- ★3（攻×2.2、生命×2.6）：拖3目标、200%真伤、晕眩2.5秒。
  - 被动：未阻挡攻防+10%。
- ★4（攻×3、生命×4）：220%真伤、晕眩3秒。
  - 被动：未阻挡攻防+12%。

### 模组
- 默认模组：uniequip_002_slchan
- `uniequip_001_slchan`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_slchan`（ADVANCED/rewrite）：三星解锁：束缚链拖拽数+1；被拖拽且撞到其他敌人的目标额外晕眩1秒。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_173_slchan`
实现：复用 hookmaster 特种 KIT 的拖拽与真实伤害；把 MANUAL 束缚链改写为技力回满瞬发。需新增 primitive：pull_targets_to_self(maxTarget,force)、true_damage、collision_bonus；复用原生钩锁表现。
因果检查：
- 免疫位移的敌人不被移动但仍承受真实伤害与晕眩；被拖拽撞到其他敌人的目标按碰撞额外结算一次晕眩。
- 拖拽到自身面前后若目标仍未被阻挡，未阻挡增伤继续生效，验证判定按实际阻挡状态。

## 见行者（`char_4036_forcer`）
- 职业：SPECIAL；档位：2（3 金币）；路线：`skillCycle`
- 定位：推击特种·撞墙晕眩
- 档位理由：三费的推击特种，把敌人推向高台或彼此造成连锁晕眩，控制成本低，落二档。
- 设计理由：以原生技巧射击与惊爆射击为核心：技力回满立即把范围内敌人向外推开并晕眩，撞墙或碰撞敌人延长晕眩，保留推击与重量增伤特色。

### 固定技能：惊爆射击（进击）
- 来源技能：`skchr_forcer_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[14,12,10,9]；初始技力：6
- 自然技力回满时立即自动结算：将范围内所有敌人向身前方向推开并晕眩，撞到高台或彼此碰撞时晕眩时间延长。
- 效果1：将范围内所有敌人沿身前方向以较大力度推开。
  - trigger=技力自然回满时自动施放；target=范围内所有敌人；action=move；lifecycle=instant
  - values={"pushForce":[2,2.5,3,3],"pushDir":[1,1,1,1],"maxTarget":[99,99,99,99]}；stacking=逐目标结算。；limits=免疫位移者不被推。
- 效果2：初始晕眩2.2/2.4/2.5/2.5秒，撞墙延长至3.4/3.4/3.7/4秒，碰撞其他敌人晕眩2.2/2.2/2.4/2.5秒。
  - trigger=惊爆射击命中目标；target=被推开的敌人；action=applyStatus；lifecycle=battle
  - values={"stunDirect":[2.2,2.4,2.5,2.5],"stunWall":[3.4,3.4,3.7,4],"stunCollision":[2.2,2.2,2.4,2.5]}；stacking=同一目标只取一次最高晕眩时长，不叠加。；limits=免疫晕眩者不结算晕眩但仍被推。

### 原生天赋计划
- 技巧射击（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4036_forcer/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击重量大于等于3的敌人时无视目标90/180防御（按阶段）。进击延续按敌人重量判定的无视防御。
  - scope=被攻击的重装敌人；parameters={"weightThreshold":3,"ignoreDefFixed":[90,90,90,180]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击碰撞扳机：目标撞墙或被其他敌人阻挡时额外晕眩1/1/1.5/1.5秒，重复碰撞重复计数。
  - trigger=敌人被本技能推撞到高台或其他敌人；target=该敌人；action=applyStatus；lifecycle=battle
  - values={"extraStun":[1,1,1.5,1.5]}；stacking=每次成功碰撞独立结算。；limits=同一目标每秒最多触发一次。

### 星级
- ★1（攻×1、生命×1）：惊爆射击推所有敌人、晕眩2.2秒、撞墙3.4秒。
  - 被动：重量≥3无视防御90；碰撞额外晕1秒。
- ★2（攻×1.55、生命×1.65）：晕眩2.4秒。
  - 被动：无视防御90；碰撞晕1秒。
- ★3（攻×2.2、生命×2.6）：晕眩2.5秒、墙3.7秒。
  - 被动：碰撞晕1.5秒。
- ★4（攻×3、生命×4）：晕眩2.5秒、墙4秒。
  - 被动：无视防御180；碰撞晕1.5秒。

### 模组
- 默认模组：uniequip_002_forcer
- `uniequip_001_forcer`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_forcer`（ADVANCED/rewrite）：三星解锁：推击力度+1；被推到高台的目标额外受到见行者攻击力50%的物理伤害。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4036_forcer`
实现：复用 pusher 特种 KIT 的推开与碰撞检测；把 MANUAL 惊爆射击改写为技力回满瞬发。需新增 primitive：push_all_in_range(force,dir)、wall_collision_stun、enemy_collision_stun、weight_filter(>=3)；复用原生推击特效。
因果检查：
- 同一目标同时撞墙又与另一敌人碰撞时只取最高晕眩时长，不叠加；若免疫晕眩则两种情况都不产生晕眩。
- 推开方向按见行者朝向固定，不随机；被免疫位移的敌人保留原位置但仍可被碰撞其他敌人间接触发晕眩计数。

## 罗宾（`char_451_robin`）
- 职业：SPECIAL；档位：2（3 金币）；路线：`summon`
- 定位：陷阱特种·预先布置控制
- 档位理由：三费的陷阱特种，可在战斗前布置夹子伏击路径，廉价换取一次性控制与爆发，落二档。
- 设计理由：以原生夹子专家与弹射夹子为核心：技力回满即补充一枚可触发的夹子装置，踩中造成物理伤害与推动，保留陷阱数量与伏击特色。

### 固定技能：弹射“夹子”（进击）
- 来源技能：`skchr_robin_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[12,11,10,9]；初始技力：5
- 自然技力回满时立即自动结算：立即在攻击范围内一个可部署地面放置一枚弹射夹子，首个踩中的敌人受到物理伤害并被推动。
- 效果1：放置1枚弹射夹子（具名装置“弹射夹子”）：首个踩中敌人受到攻击力310%/330%/350%/380%的物理伤害并被推动。
  - trigger=技力自然回满时自动施放；target=攻击范围内一个可部署地面；action=device；lifecycle=battle
  - values={"deviceCount":[1,1,1,1],"triggerDamageScale":[3.1,3.3,3.5,3.8],"pushForce":[1,1.5,2,2]}；stacking=场上夹子数受天赋上限约束，达到上限时最新一枚替换最旧一枚。；limits=每枚夹子触发一次后消失。
- 效果2：对触发者造成攻击力310%/330%/350%/380%的物理伤害并沿触发方向推动。
  - trigger=夹子被触发；target=触发夹子的敌人；action=damage；lifecycle=instant
  - values={"atkScale":[3.1,3.3,3.5,3.8],"force":[1,1.5,2,2]}；stacking=每枚夹子独立结算。；limits=只对首个踩中的敌人生效。

### 原生天赋计划
- “夹子”专家（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_451_robin/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：可以使用4/6/8个夹子（最多拥有6/8/10个），踩上的第一个敌人触发。进击沿用夹子数量上下限（按阶段），技能放置的夹子计入上限。
  - scope=全场夹子；parameters={"usable":[4,4,6,8],"maxOwned":[6,6,8,10]}；trigger=技能/技力事件时；unlockStar=1

### 进击被动
- 被动0：进击陷阱扳机：夹子触发时额外束缚触发者1.5/1.8/2/2.5秒，重复触发重复计数。
  - trigger=夹子成功触发并命中敌人；target=触发者；action=applyStatus；lifecycle=battle
  - values={"rootDuration":[1.5,1.8,2,2.5]}；stacking=每次成功触发独立结算。；limits=被免疫束缚的敌人不计束缚但仍受伤。

### 星级
- ★1（攻×1、生命×1）：夹子310%物理、推动中等、束缚1.5秒。
  - 被动：夹子上限4/6。
- ★2（攻×1.55、生命×1.65）：330%物理、束缚1.8秒。
  - 被动：夹子上限4/6。
- ★3（攻×2.2、生命×2.6）：350%物理、较大推动、束缚2秒。
  - 被动：夹子上限6/8。
- ★4（攻×3、生命×4）：380%物理、束缚2.5秒。
  - 被动：夹子上限8/10。

### 模组
- 默认模组：uniequip_002_robin
- `uniequip_001_robin`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_robin`（ADVANCED/rewrite）：三星解锁：夹子触发伤害+10%；每次夹子触发返还0.5点技力（小数技力）。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_451_robin`
实现：复用 traper 特种 KIT 与陷阱触发逻辑；把 AUTO 弹射夹子改写为技力回满瞬发放置具名装置。需新增 primitive：place_named_trap(kind,damage,force)、trap_owned_cap、root_on_trap_trigger、fractional_sp_refund；夹子实体复用原生夹子。
因果检查：
- 夹子达到拥有上限时再放置会替换最旧一枚，不增加总数；被移除的夹子不触发任何事件。
- 夹子只对首个踩中的敌人生效，同帧第二个敌人不触发；免疫位移的敌人被夹但只受伤不被推动，仍计一次触发。

## 风丸（`char_4016_kazema`）
- 职业：SPECIAL；档位：4（6 金币）；路线：`summon`
- 定位：人偶特种·替身法术爆发
- 档位理由：六费的人偶特种，用替身制造二次法术爆发并分担站位，机制独特，落四档。
- 设计理由：以原生折纸生花与纸艺·双影为核心：技力回满立即流失生命并在近战位召唤具名替身，替身出现时对周围8格造成法术伤害，保留替身爆发特色。

### 固定技能：纸艺·双影（进击）
- 来源技能：`skchr_kazema_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[18,16,14,12]；初始技力：8
- 自然技力回满时立即自动结算：流失自身当前生命的一定比例，提升攻击力，并在周围近战部署位召唤一个具名替身协助作战。
- 效果1：流失自身当前生命的50%（不致死，最低保留1点）。
  - trigger=技力自然回满时自动施放；target=自身；action=applyStatus；lifecycle=instant
  - values={"selfHpCostRatio":[0.5,0.5,0.5,0.5]}；stacking=每次施放独立结算。；limits=自损不致死。
- 效果2：20秒内自身攻击力+90%/100%/110%/120%。
  - trigger=纸艺·双影结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.9,1,1.1,1.2],"duration":[20,20,20,20]}；stacking=刷新时长。；limits=每次施放刷新。
- 效果3：召唤具名“替身”占据近战位，继承自身50%生命与80%/90%/100%/110%攻击，持续20秒；场上同时最多1个替身，新召唤替换旧替身。
  - trigger=纸艺·双影结算后；target=周围一个近战部署位；action=summon；lifecycle=battle
  - values={"summonName":["替身","替身","替身","替身"],"summonCount":[1,1,1,1],"summonAtkScale":[0.8,0.9,1,1.1],"summonHpRatio":[0.5,0.5,0.5,0.5],"duration":[20,20,20,20]}；stacking=同名替身不叠加，替换而非并存。；limits=每场战斗可反复召唤，但同一时刻只有一个。

### 原生天赋计划
- 折纸生花（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4016_kazema/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：替身出现时对其周围8格所有敌方单位造成相当于自身攻击力150%/225%/270%的法术伤害。进击沿用替身出现即爆发的语义。
  - scope=替身周围8格；parameters={"atkScale":[1.5,1.8,2.25,2.7],"radius":1}

### 进击被动
- 被动0：进击召唤扳机：替身出现瞬间对周围8格敌人造成攻击力150%/180%/225%/270%的法术伤害，同一替身只结算一次。
  - trigger=替身出现在场上；target=替身周围8格敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.5,1.8,2.25,2.7],"damageType":["法术","法术","法术","法术"],"radius":[1,1,1,1]}；stacking=每个替身出现只触发一次。；limits=替换旧替身时新替身正常触发，旧替身消散不触发伤害。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：双影自损50%、自身+90%/20秒、替身80%攻击×20秒。
  - 被动：替身出现法术150%。
- ★2（攻×1.55、生命×1.65）：+100%、替身90%。
  - 被动：替身爆发180%。
- ★3（攻×2.2、生命×2.6）：+110%、替身100%。
  - 被动：替身爆发225%。
- ★4（攻×3、生命×4）：+120%、替身110%。
  - 被动：替身爆发270%。

### 模组
- 默认模组：uniequip_002_kazema
- `uniequip_001_kazema`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_kazema`（ADVANCED/rewrite）：三星解锁：替身出现爆发伤害+15%；替身存在期间自身攻速+10。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4016_kazema`
实现：复用 dollkeeper 特种 KIT 与替身实体；把 MANUAL 纸艺·双影改写为技力回满瞬发的自损+召唤。需新增 primitive：summon_named_token(替身,atkScale,hpRatio,duration)、replace_same_token、on_token_spawn_aoe；替身资源复用原生折纸替身。
因果检查：
- 同一时刻只存在一个替身：再次召唤时旧替身消散且不触发爆发，新替身出现触发一次爆发，验证替换语义。
- 替身出现爆发只结算一次；替身在持续期间造成普通伤害不再触发折纸生花。

## 锡人（`char_4151_tinman`）
- 职业：SPECIAL；档位：4（6 金币）；路线：`element`
- 定位：炼金特种·范围灼烧与奶
- 档位理由：六费的炼金特种，用可充能的炼金单元同时压制地面敌人并治疗友军，攻守兼备，落四档。
- 设计理由：以原生凋敝魂灵与“大拉里”为核心：技力回满立即投掷具名炼金单元，对落点敌人持续法术伤害并治疗友军，强化的持续伤害保留炼金特色。

### 固定技能：“大拉里”（进击）
- 来源技能：`skchr_tinman_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[20,18,16,14]；初始技力：10
- 自然技力回满时立即自动结算：消耗一次充能投掷具名炼金单元，持续期间对落点周围地面敌人每秒造成法术伤害，并为范围内友军每秒回复生命。
- 效果1：投掷具名“大拉里”炼金单元，持续12/13/14/15秒影响落点周围2格，最多同时充能2次。
  - trigger=技力自然回满时自动施放；target=指定落点周围；action=device；lifecycle=battle
  - values={"deviceName":["大拉里","大拉里","大拉里","大拉里"],"duration":[12,13,14,15],"radius":[2,2,2,2],"charges":[2,2,2,2]}；stacking=多个炼金单元可并存，各自独立计时。；limits=充能上限2，充满后不再积累。
- 效果2：范围内地面敌人每秒受到攻击力80%/90%/100%/110%的法术伤害。
  - trigger=炼金单元持续期间每秒；target=范围内的地面敌人；action=damage；lifecycle=battle
  - values={"atkScalePerSec":[0.8,0.9,1,1.1],"interval":[1,1,1,1],"damageType":["法术","法术","法术","法术"]}；stacking=同一敌人每秒结算一次，多个单元可分别结算。；limits=仅对地面敌人生效。
- 效果3：范围内友军每秒回复锡人攻击力20%/22%/25%/28%的生命。
  - trigger=炼金单元持续期间每秒；target=范围内的友军；action=heal；lifecycle=battle
  - values={"healScalePerSec":[0.2,0.22,0.25,0.28],"interval":[1,1,1,1]}；stacking=多个单元可叠加治疗。；limits=只对友军生效。

### 原生天赋计划
- “在路上”（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4151_tinman/talents/0`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 原生为萨卡兹肉鸽招募希望消耗减少。进击改写为与肉鸽无关的本模式效果：自身部署费用-1，每场战斗首次部署额外返还1点部署费用，不改变全队经济规则。
  - scope=自身；parameters={"deployCostDelta":-1,"firstDeployRefund":[1,1,1,1]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 凋敝魂灵（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4151_tinman/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：使自身炼金单元影响范围内地面敌人受到的持续伤害提高20%。进击沿用对己方炼金单元持续伤害的增幅。
  - scope=自身炼金单元范围；parameters={"dotAmp":[0.2,0.2,0.2,0.2]}

### 进击被动
- 被动0：进击炼金扳机：自身炼金单元范围内的地面敌人所受持续伤害提高20%，多个单元不连乘，取最高一次。
  - trigger=自身炼金单元影响范围内的地面敌人受到持续伤害；target=该敌人；action=addBuff；lifecycle=battle
  - values={"dotAmp":[0.2,0.2,0.2,0.2]}；stacking=多个来源取最高而非乘算。；limits=只对地面敌人和持续伤害生效。；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：大拉里持续12秒、每秒80%法术、奶20%、充能2。
  - 被动：持续伤害+20%；部署费-1首次返还1。
- ★2（攻×1.55、生命×1.65）：13秒、90%、奶22%。
  - 被动：持续伤害+20%；部署费-1首次返还1。
- ★3（攻×2.2、生命×2.6）：14秒、100%、奶25%。
  - 被动：持续伤害+20%；部署费-1首次返还1。
- ★4（攻×3、生命×4）：15秒、110%、奶28%。
  - 被动：持续伤害+20%；部署费-1首次返还1。

### 模组
- 默认模组：uniequip_002_tinman
- `uniequip_001_tinman`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_tinman`（ADVANCED/rewrite）：三星解锁：炼金单元持续时间+3秒，且对范围内的敌人额外降低10%攻击力。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4151_tinman`
实现：复用 alchemist 炼金单元装置 KIT；把 MANUAL 大拉里改写为技力回满瞬发的充能投掷。需新增 primitive：place_alchemy_unit(name,duration,radius,charges)、unit_dot_and_heal、dot_amp_self_only；装置资源复用原生炼金单元。
因果检查：
- 充能满2后继续回技力不再增加充能；两次投掷可在同一位置并存并分别治疗与伤害，验证并存与独立计时。
- 凋敝魂灵对同一敌人只取最高增幅一次，不因两个单元重叠而连乘。

## 蒂比（`char_4191_tippi`）
- 职业：SPECIAL；档位：2（3 金币）；路线：`pierceCrit`
- 定位：精准特种·受击闪避连射
- 档位理由：三费的精准特种，受击后闪避并连射，站桩输出稳定但依赖受击窗口，落二档。
- 设计理由：原生紧急赶场通知依赖起飞，进击按主设计取消起飞独立效果：改为受击触发闪避与三连射的即时手段，保留片场工作指南的未受击闪避特色。

### 固定技能：紧急赶场通知（进击）
- 来源技能：`skchr_tippi_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[12,11,10,9]；初始技力：5
- 自然技力回满时立即自动结算：对攻击范围内至多3名敌人进行三连射造成物理伤害，并获得一层可闪避一次物理或法术攻击的闪避。不使用起飞。
- 效果1：对至多3名敌人各进行3次攻击，每次造成攻击力30%/35%/40%/50%的物理伤害。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多3名敌人；action=damage；lifecycle=instant
  - values={"hits":[3,3,3,3],"atkScalePerHit":[0.3,0.35,0.4,0.5],"maxTarget":[3,3,3,3]}；stacking=逐目标逐次结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：获得1层闪避，可完全闪避下一次物理或法术攻击后消耗。
  - trigger=紧急赶场通知结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"dodgeCharges":[1,1,1,1],"dodgeType":["物理或法术","物理或法术","物理或法术","物理或法术"]}；stacking=最多保留1层，重复施放刷新不叠加。；limits=被消耗后需重新施放获得。

### 原生天赋计划
- 片场工作指南（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4191_tippi/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：若最近13/9秒内未受攻击，闪避下一次物理或法术攻击（按阶段）。进击沿用未受击判定与单次闪避。
  - scope=自身；parameters={"noHitWindowSec":[13,11,9,9]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击受击扳机：受到攻击后获得1层闪避并立即对攻击者反击一次攻击力50%/60%/70%/80%的物理伤害；闪避层最多1层。
  - trigger=自身受到一次攻击；target=自身；action=addBuff；lifecycle=battle
  - values={"dodgeCharges":[1,1,1,1],"counterAtkScale":[0.5,0.6,0.7,0.8]}；stacking=最多1层，重复受击只刷新反击。；limits=只对真实命中自身的攻击触发，闪避掉的攻击不计。

### 星级
- ★1（攻×1、生命×1）：三连射每段30%、获1层闪避；不使用起飞。
  - 被动：未受击13秒闪避；受击反击50%。
- ★2（攻×1.55、生命×1.65）：每段35%。
  - 被动：未受击11秒；反击60%。
- ★3（攻×2.2、生命×2.6）：每段40%。
  - 被动：未受击9秒；反击70%。
- ★4（攻×3、生命×4）：每段50%。
  - 被动：未受击9秒；反击80%。

### 模组
- 默认模组：null

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4191_tippi`
实现：复用 skywalker 特种 KIT 与多段攻击；取消原生起飞/liftoff，把 MANUAL 紧急赶场通知改写为技力回满瞬发的三连射。需新增 primitive：multi_hit_volley(maxTarget,hits,scale)、grant_dodge_charge(count)、on_hit_dodge_counter；不新增 liftoff primitive。
因果检查：
- 被闪避掉的攻击不触发受击反击，也不重置片场工作指南的未受击计时；真实命中才触发。
- 闪避层最多1层，连续两次受击只保留1层且反击分别结算，不叠加层数。

## 缄默德克萨斯（`char_1028_texas2`）
- 职业：SPECIAL；档位：5（8 金币）；路线：`redeploy`
- 定位：快速再部署·落地剑雨群控
- 档位理由：八费的核心快速再部署，落地即群伤群晕并持续剑雨，兼具清场与再部署节奏，落五档。
- 设计理由：以原生德克萨斯剑术与剑雨滂沱为核心：把部署被动转为技力回满瞬发的落地剑雨，先两段范围法术与晕眩再持续打击不同目标，保留快速再部署特色。

### 固定技能：剑雨滂沱（进击）
- 来源技能：`skchr_texas2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[20,18,16,14]；初始技力：9
- 自然技力回满时立即自动结算：对周围所有敌人造成两次法术伤害并晕眩，随后持续数秒每秒对范围内至多4个不同目标释放剑雨造成法术伤害与短暂晕眩。
- 效果1：对周围所有敌人造成两次攻击力130%/145%/155%/165%的法术伤害。
  - trigger=技力自然回满时自动施放；target=周围所有敌人；action=damage；lifecycle=instant
  - values={"hits":[2,2,2,2],"atkScalePerHit":[1.3,1.45,1.55,1.65],"damageType":["法术","法术","法术","法术"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：使命中目标晕眩1.5/1.7/1.8/2秒。
  - trigger=落地两段命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"stunDuration":[1.5,1.7,1.8,2]}；stacking=刷新时长，每次成功施加计数。；limits=免疫晕眩者不计。
- 效果3：持续8秒，每秒对至多3/3/4/4个不同目标造成攻击力100%/110%/120%/130%的法术伤害并晕眩0.2秒。
  - trigger=剑雨持续期间每秒；target=范围内至多4个不同目标；action=damage；lifecycle=battle
  - values={"duration":[8,8,8,8],"maxTarget":[3,3,4,4],"atkScalePerSec":[1,1.1,1.2,1.3],"stunPerHit":[0.2,0.2,0.2,0.2]}；stacking=每秒重新选目标，同一秒内不重复选同一目标。；limits=同一目标每秒最多被剑雨命中一次。

### 原生天赋计划
- 德克萨斯传统（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1028_texas2/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由 modePassive[0] 单份承接：技能施放后10秒内攻击力+10%/15%/20%/20%；每次真实部署后首次由自身击倒敌人时回复全部生命并按相同规则补剑雨。原生天赋不另行触发。
  - scope=自身；parameters={"atkBonus":[0.1,0.15,0.2,0.2],"duration":10,"firstKillPerDeploy":true,"replenishRainHalf":true}
- 德克萨斯剑术（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1028_texas2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：每次部署后击倒一名敌人之前，攻击速度+8，受到的所有伤害降低25%。进击沿用部署后的首次击杀前增益。
  - scope=自身；parameters={"attackSpeedBonus":8,"damageReduction":0.25}；trigger=部署/再部署后；unlockStar=1

### 进击被动
- 被动0：每次真实部署后，自身首次击倒敌人时回复全部生命并按相同规则补剑雨：若有现存剑雨则按当前规格延长其剩余时间4秒（原8秒的一半）；若不存在则新建4秒剑雨序列，tick间隔1秒、目标与倍率取本星固定技能，不重做落地两段。存活原位免费满血再部署不重置首次击杀标记；死亡后真正入场才重置。本效果为每部署一次，不是每战一次。
  - trigger=固定技能施放后 / 每次真实部署后首次由自身击倒敌人；target=自身；action=heal；lifecycle=battle
  - values={"firstKillHealFull":[1,1,1,1],"firstKillPerDeploy":[1,1,1,1],"noResetOnSurvivingRedeploy":[1,1,1,1],"resetOnRealEntry":[1,1,1,1]}；stacking=每个真实部署周期内首次击杀只结算一次。；limits=每部署一次；补剑雨在同一时刻只发生一次。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：剑雨两段130%法术+晕1.5秒，持续8秒每秒100%/至多3目标。
  - 被动：技能后攻击+10%/10秒；每部署首次击杀回满并按当前规格补剑雨（基础4秒；四星合计6秒）。
- ★2（攻×1.55、生命×1.65）：145%、晕1.7秒、每秒110%。
  - 被动：技能后攻击+15%/10秒；每部署首次击杀回满并按当前规格补剑雨（基础4秒；四星合计6秒）。
- ★3（攻×2.2、生命×2.6）：155%、晕1.8秒、每秒120%/至多4。
  - 被动：技能后攻击+20%/10秒；每部署首次击杀回满并按当前规格补剑雨（基础4秒；四星合计6秒）。
- ★4（攻×3、生命×4）：165%、晕2秒、每秒130%/至多4。
  - 被动：技能后攻击+20%/10秒；每部署首次击杀回满并按当前规格补剑雨（基础4秒；四星合计6秒）。

### 模组
- 默认模组：uniequip_002_texas2
- `uniequip_001_texas2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_texas2`（ADVANCED/rewrite）：三星解锁：剑雨持续期间每秒目标数+1；四星加强：落地两段对已晕眩目标额外+20%伤害。
- `uniequip_003_texas2`（ADVANCED/rewrite）：三星解锁：技能施放后攻击力增益+5%；四星加强：每次部署首次击杀额外按相同规则补剑雨2秒（25%×8秒），与基础4秒合计6秒，仅一次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1028_texas2`
实现：复用 executor 特种的快速再部署与群控；把 PASSIVE 剑雨滂沱改写为技力回满瞬发的两段+持续场。需新增 primitive：aoe_multi_hit、persistent_sword_rain(duration,perSecondMaxTarget)、recast_ratio、per_deploy_first_kill；复用原生剑雨特效。
因果检查：
- 剑雨每秒对同一目标最多命中一次；补剑雨按当前规格延长剩余时间/新建4秒序列，不重做落地两段。
- 每部署首次击杀才回满并补剑雨，存活原位免费满血再部署不重置标记，死亡真正入场才重置；不把每部署与每战混写。

## 琳琅诗怀雅（`char_1033_swire2`）
- 职业：SPECIAL；档位：5（8 金币）；路线：`economyGrowth`
- 定位：商人特种·金币装置爆发
- 档位理由：八费的核心商人，用自产金币放置具名炸弹并叠加成长，兼顾经济与爆发，落五档。
- 设计理由：以原生大买家与“见面礼”为核心：技力回满即消耗一枚金币放置具名香槟炸弹，触碰敌人造成物理伤害与停顿，保留金币资源与成长叠加特色。

### 固定技能：“见面礼”（进击）
- 来源技能：`skchr_swire2_2`（index 1）；类型：instant；自然回复：1/秒
- 技力：[16,14,12,10]；初始技力：8
- 自然技力回满且持有金币时立即自动结算：消耗一枚金币在范围内可通行地面放置具名香槟炸弹，触碰到的首个敌人受到物理伤害并停顿，炸弹在场3秒后可再造成一次伤害。
- 效果1：消耗1枚金币放置香槟炸弹（携带此技能时金币上限4/4/5/5）；首个触碰敌人受到攻击力170%/185%/200%/220%的物理伤害并停顿2秒。
  - trigger=技力自然回满且金币≥1时自动施放；target=范围内一个可通行地面；action=device；lifecycle=battle
  - values={"deviceName":["香槟炸弹","香槟炸弹","香槟炸弹","香槟炸弹"],"goldCost":[1,1,1,1],"goldCap":[4,4,5,5],"triggerDamageScale":[1.7,1.85,2,2.2],"sluggish":[2,2,2,2]}；stacking=场上炸弹各自独立；金币不足时不施放且技力保留。；limits=每次施放消耗1枚金币。
- 效果2：炸弹在场满3秒后额外造成一次攻击力120%/130%/140%/150%的物理伤害。
  - trigger=香槟炸弹在场3秒后；target=范围内敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.2,1.3,1.4,1.5],"damageType":["物理","物理","物理","物理"]}；stacking=每枚炸弹一次。；limits=只对仍存在的炸弹生效。

### 原生天赋计划
- 大买家（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1033_swire2/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：技能期间每次特性消耗费用时获得1枚金币，进阶后每消耗1枚金币提升3%攻击（最多5/8层），开启技能时额外获得1枚。进击沿用金币产消与攻击叠加。
  - scope=自身；parameters={"goldPerCost":1,"atkPerGold":[0,0,0.03,0.04],"maxStacks":[0,0,5,8]}；trigger=技能/技力事件时；unlockStar=1
- 破财消灾（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1033_swire2/talents/1`）：mode=rewrite；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 原生为受到致命伤害时若费用足够则消耗5点部署费用使生命恢复到70%，每次触发消耗翻倍。进击保留该语义并明确为每场战斗最多触发2次，消耗按5/10点递增。
  - scope=自身；parameters={"healRatio":0.7,"costSequence":[5,10],"perBattle":2}；trigger=自身受到相关事件时；unlockStar=1

### 进击被动
- 被动0：进击金币扳机：每消耗1枚金币自身攻击力永久+3%/3%/3%/4%，最多叠加5/5/5/8层；技能结束时不清空，仅技能期间产出的金币计数。
  - trigger=自身每消耗1枚金币；target=自身；action=growth；lifecycle=battle
  - values={"atkPerGold":[0.03,0.03,0.03,0.04],"maxStacks":[5,5,5,8]}；stacking=按消耗金币数线性叠加，达上限停止。；limits=只统计本技能产消的金币，不含局外经济。

### 星级
- ★1（攻×1、生命×1）：见面礼炸弹170%物理、停顿2秒、3秒后再120%；金币上限4。
  - 被动：金币攻击+3%×5；破财回复70%耗5/10。
- ★2（攻×1.55、生命×1.65）：185%、再130%；上限4。
  - 被动：金币攻击+3%×5；破财回复70%耗5/10。
- ★3（攻×2.2、生命×2.6）：200%、再140%；上限5。
  - 被动：金币攻击+3%×5（进阶天赋）。
- ★4（攻×3、生命×4）：220%、再150%；上限5。
  - 被动：金币攻击+4%×8。

### 模组
- 默认模组：uniequip_002_swire2
- `uniequip_001_swire2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_swire2`（ADVANCED/rewrite）：三星解锁：开启技能时额外获得1枚金币；四星加强：香槟炸弹触发伤害+10%。
- `uniequip_003_swire2`（ADVANCED/rewrite）：三星解锁：炸弹在场3秒后的第二段伤害+15%；四星加强：破财消灾消耗序列降为4/8点。
- `uniequip_004_swire2`（ADVANCED/rewrite）：三星解锁：金币叠加上限+1；四星加强：每消耗1枚金币额外+0.5%攻击。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1033_swire2`
实现：复用 merchant 特种的金币资源与装置；把 PASSIVE 见面礼改写为技力回满+金币门槛的瞬发装置。需新增 primitive：personal_gold_resource(cap)、place_champagne_bomb、bomb_delayed_second_hit、fatal_consume_deploy_points；金币账目与部署费用、购买金币分开。
因果检查：
- 金币不足时技能不施放且技力保留；金币达到上限后再产金币不增加，消耗后才继续产出。
- 破财消灾每场战斗只触发两次，第二次消耗翻倍；费用不足时不触发也不消耗。

## 新约能天使（`char_1041_angel2`）
- 职业：SPECIAL；档位：6（12 金币）；路线：`ammo`
- 定位：弹药特种·空投再部署炮台
- 档位理由：十二费的领袖级弹药核心，靠弹药连击、空投再部署与全队弹药联动改写战场节奏，落六档。
- 设计理由：以原生使命必达与火力电台为核心：技力回满即装填弹药并持续连击，自动选中再部署最久的本队真实地面干员为落点造成溅射并把其投送回原位给技力，保留弹药与再部署联动。

### 固定技能：使命必达！（进击）
- 来源技能：`skchr_angel2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[30,26,22,18]；初始技力：14
- 自然技力回满时立即自动结算：进入弹药状态并立即发射一轮，每次攻击为5连击；随后自动选中再部署剩余时间最长的本队真实地面干员，以其当前/保留原位为落点结算250%物理半径1溅射并免费再部署并给6技力；无合格目标则只装填。
- 效果1：获得50发弹药，每次攻击消耗5发并造成5段攻击力135%/145%/150%/160%的物理伤害，打空后结束。
  - trigger=技力自然回满时自动施放；target=攻击范围内敌人；action=ammo；lifecycle=battle
  - values={"ammoCount":[50,50,50,50],"hitsPerAttack":[5,5,5,5],"atkScalePerHit":[1.35,1.45,1.5,1.6],"ammoPerAttack":[5,5,5,5]}；stacking=新施放重置弹药为满值，不累加。；limits=弹药每场按实际装填量，不虚构额外消耗。
- 效果2：自动选中本队再部署剩余时间最长的真实地面干员（含倒地等待；排除召唤物、装置、复制体；同值按编队顺序），以其当前/保留原位为落点；无合格目标则不制造假坐标，只完成装填。
  - trigger=同一结算且存在合格投送目标；target=自动选中的本队真实地面干员当前/保留原位；action=targeting；lifecycle=instant
  - values={"selectLongestRespawn":[1,1,1,1],"includeDownedWaiting":[1,1,1,1],"excludeSummonDeviceClone":[1,1,1,1],"tieFormationOrder":[1,1,1,1],"requireEligibleTarget":[1,1,1,1]}；stacking=每次施放至多选1名。；limits=仅本队真实地面干员；无合格目标时跳过溅射与投送。
- 效果3：在该落点结算攻击力250%的物理半径1溅射伤害。
  - trigger=选中合格投送目标时；target=该落点；action=damage；lifecycle=instant
  - values={"atkScale":[2.5,2.5,2.5,2.5],"splashRadius":[1,1,1,1],"damageType":["物理","物理","物理","物理"]}；stacking=每次施放一次。；limits=仅在存在合格投送目标时结算。
- 效果4：将该目标免费再部署到其当前/保留原位，并使其获得6点技力；存活目标原位满血，不搬到其它敌人格、不清状态、不打断当前弹药/攻击，该次再部署不再发动其技能中的再部署部分。
  - trigger=选中合格投送目标时；target=该名再部署剩余时间最长的真实地面干员；action=redeploy；lifecycle=instant
  - values={"targetCount":[1,1,1,1],"spGain":[6,6,6,6],"freeRedeploy":[1,1,1,1],"keepPosition":[1,1,1,1]}；stacking=每次施放最多1名，同值按编队顺序取最前。；limits=仅存在合格目标时结算。

### 原生天赋计划
- 火力电台（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1041_angel2/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 原生弹药联动改由 modePassive[0] 单份承接：友方每枚真实弹药被消耗时回复自身6%生命，并按星概率对消耗者攻击范围造成轰炸；源天赋不再另行运行，避免双份叠装。
  - scope=全场友方弹药；parameters={"healRatio":[0.06,0.06,0.06,0.06],"bombChance":[0.2,0.2,0.25,0.25],"bombAtkScale":[1.05,1.05,1.5,1.5]}
- 铳弹协约（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1041_angel2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：在场时携带弹药类技能的干员攻击力+9%，对拉特兰干员效果翻倍。进击沿用该阵营联动，不发明全队人数羁绊。
  - scope=全场弹药干员；parameters={"atkBonus":[0.09,0.09,0.09,0.09],"lateranoDouble":1}；trigger=技能/技力事件时；unlockStar=1
- 隐蔽天赋槽2（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1041_angel2/talents/2`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空；快速装填/空投校准另列为 modePassives，不伪装成原生天赋。
  - scope=无；parameters={}
- 隐蔽天赋槽3（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1041_angel2/talents/3`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空；快速装填/空投校准另列为 modePassives，不伪装成原生天赋。
  - scope=无；parameters={}

### 进击被动
- 被动0：弹药扳机：友方每消耗1枚真实弹药结算一次，自身回复6%生命，并按20%/20%/25%/25%概率对消耗者攻击范围造成自身攻击力105%/105%/150%/150%的物理半径1溅射轰炸。同一次攻击消耗多枚则按 ammoUsed 记录 quantity 逐枚分别计数。
  - trigger=任意友方干员消耗真实弹药（按 ammoUsed 记录 quantity 逐枚）；target=自身与消耗者攻击范围；action=heal；lifecycle=battle
  - values={"healRatio":[0.06,0.06,0.06,0.06],"bombChance":[0.2,0.2,0.25,0.25],"bombAtkScale":[1.05,1.05,1.5,1.5],"splashRadius":[1,1,1,1]}；stacking=按真实弹药枚数逐枚计数，同一枚只结算一次。；limits=只统计真实被消耗的弹药，不给未携带弹药的干员虚构消耗。；replacesTalentIndices=[0]
- 被动1：进击新增被动「快速装填」：弹药打空后立即回复5/5/5/6点技力，每场战斗最多触发3/3/3/4次。
  - trigger=自身弹药打空；target=自身；action=spGain；lifecycle=instant
  - values={"spGain":[5,5,5,6],"perBattle":[3,3,3,4]}；stacking=每场战斗限次，打空事件逐次计数。；limits=每场3/3/3/4次；与原生空槽无关，不伪装原生天赋。；unlockStar=3
- 被动2：进击新增被动「空投校准」：每次成功投送队友后，自身下一次施放的溅射伤害+20%/20%/30%/30%，仅生效一次。
  - trigger=成功投送队友后；target=自身；action=addBuff；lifecycle=battle
  - values={"splashBonus":[0.2,0.2,0.3,0.3],"once":[1,1,1,1]}；stacking=多次投送只保留一次未消耗加成，取最高值。；limits=四星解锁；成功投送事件每次刷新一次。；unlockStar=4

### 星级
- ★1（攻×1、生命×1）：使命必达50发、每攻5连击每段135%、溅射250%、投送给6技力。
  - 被动：弹药联动回6%/20%轰炸；协约+9%。
- ★2（攻×1.55、生命×1.65）：每段145%。
  - 被动：弹药联动回6%/20%轰炸（105%物理半径1）；协约+9%。
- ★3（攻×2.2、生命×2.6）：每段150%。
  - 被动：弹药联动回6%/25%轰炸（150%物理半径1）；协约+9%；三星解锁快速装填回5技力（每场3次）。
- ★4（攻×3、生命×4）：每段160%；无合格投送目标时只装填，不制造假坐标。
  - 被动：弹药联动回6%/25%轰炸（150%物理半径1）；四星解锁空投校准溅射+30%，快速装填上限4次。

### 模组
- 默认模组：uniequip_002_angel2
- `uniequip_001_angel2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_angel2`（ADVANCED/rewrite）：三星解锁：弹药上限+10；投送队友后该队友获得1层护盾（最大生命10%）。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1041_angel2`
实现：复用 geek 弹药系统与再部署指令；把 MANUAL 使命必达改写为技力回满自动装填+发射，接入投递坐标。需新增 primitive：ammo_state(count,hitsPerAttack,ammoPerAttack)、delivery_coordinate、force_redeploy_longest_ground(spGain)、ally_ammo_consumed_event；空投特效与轰炸复用原生。
因果检查：
- 同值再部署时间时投送按编队顺序取最前，不消耗随机数；被投送干员技能中的再部署部分不再发动，其它天赋照常结算。
- 每消耗1枚真实弹药（按 ammoUsed 记录 quantity 逐枚）结算一次回复与至多一次概率轰炸；不给未携带弹药的干员虚构消耗。
- 存在合格目标时落点为其当前/保留原位，存活目标满血不移动、不清状态、不打断攻击；无合格目标只装填，不制造假坐标。
- 火力电台只由 modePassive[0] 单份运行，原生天赋不另跑；快速装填/空投校准为独立 modePassives 且按星解锁。

## 歌蕾蒂娅（`char_474_glady`）
- 职业：SPECIAL；档位：4（6 金币）；路线：`skillCycle`
- 定位：钩索特种·龙卷拖拽场
- 档位理由：六费的控制型钩索特种，制造龙卷持续减速拖拽并群伤，是范围控制支点，落四档。
- 设计理由：以原生阿戈尔的波涛与缺水的碎漩狂舞为核心：技力回满立即在目标处制造具名龙卷场地，束缚目标、减速拖拽并持续法术伤害，结尾再把范围敌人拉回，保留钩索控场特色。

### 固定技能：缺水的碎漩狂舞（进击）
- 来源技能：`skchr_glady_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[22,20,17,14]；初始技力：12
- 自然技力回满时立即自动结算：束缚一个远处目标并在其位置制造具名龙卷场地，持续减速并拖拽周围敌人、每1.5秒造成法术伤害，结束时把周围敌人拖拽至自身面前。
- 效果1：束缚目标8/9秒并以其位置生成龙卷。
  - trigger=技力自然回满时自动施放；target=一个远处目标；action=applyStatus；lifecycle=battle
  - values={"rootDuration":[8,9,9,9],"maxTarget":[1,1,1,1]}；stacking=每次施放一次。；limits=每次只束缚一个目标。
- 效果2：范围内敌人移速-50%，每1.5秒受到攻击力100%/110%/120%/130%的法术伤害并被向中心拖拽。
  - trigger=龙卷持续期间每1.5秒；target=龙卷周围敌人；action=damage；lifecycle=battle
  - values={"duration":[8,8,9,9],"interval":[1.5,1.5,1.5,1.5],"atkScale":[1,1.1,1.2,1.3],"slowRatio":[0.5,0.5,0.5,0.5],"damageType":["法术","法术","法术","法术"]}；stacking=同一敌人每1.5秒结算一次。；limits=仅对龙卷范围内敌人生效。
- 效果3：把目标地点周围敌人以中等至较大力度拖拽至自身面前。
  - trigger=龙卷结束时；target=目标位置周围敌人；action=move；lifecycle=instant
  - values={"pullToSelf":[1,1,1,1],"force":[1,1.5,2,2],"maxTarget":[99,99,99,99]}；stacking=逐目标结算。；limits=免疫位移者不动但仍受此前伤害。

### 原生天赋计划
- 阿戈尔的波涛（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_474_glady/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：在场时所有深海猎人干员每秒回复1.5%/2.5%最大生命，且受到海怪敌人的物理与法术伤害降低15%/25%。进击沿用该阵营范围被动。
  - scope=全场深海猎人；parameters={"regenPerSec":[0,0,0.015,0.025],"seaMonsterReduction":[0,0,0.15,0.25]}；trigger=自身受到相关事件时；unlockStar=1
- 弱肉强食（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_474_glady/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：攻击重量小于等于3的敌人时攻击力提升至130%。进击沿用按重量判定的增伤。
  - scope=自身；parameters={"weightThreshold":3,"atkScale":[1.3,1.3,1.3,1.3]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击钩索扳机：成功拖拽敌人（位移真实发生）时获得1/1.5/2/2.5点技力，同一秒最多结算一次；免疫位移者不计。
  - trigger=自身成功拖拽一名敌人；target=自身；action=spGain；lifecycle=battle
  - values={"sp":[1,1.5,2,2.5],"perSecondCap":[1,1,1,1]}；stacking=按成功位移事件计数，重复拖拽重复计数。；limits=每秒最多一次获得。

### 星级
- ★1（攻×1、生命×1）：龙卷束缚8秒、每1.5秒100%法术、减速50%、结束拖拽中等。
  - 被动：深海回血1.5%；拖拽回1技力。
- ★2（攻×1.55、生命×1.65）：110%法术。
  - 被动：拖拽回1.5技力。
- ★3（攻×2.2、生命×2.6）：束缚9秒、120%法术、结束较大力度。
  - 被动：深海回血2.5%/受伤-25%；拖拽回2技力。
- ★4（攻×3、生命×4）：130%法术。
  - 被动：拖拽回2.5技力。

### 模组
- 默认模组：uniequip_002_glady
- `uniequip_001_glady`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_glady`（ADVANCED/rewrite）：三星解锁：龙卷持续时间+2秒；四星加强：被拖拽到中心的敌人额外受到攻击力50%的法术伤害。
- `uniequip_003_glady`（ADVANCED/rewrite）：三星解锁：龙卷半径+0.3格；四星加强：拖拽回技力每秒上限提高至2次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_474_glady`
实现：复用 hookmaster 特种的拖拽与场地装置；把 MANUAL 碎漩狂舞改写为技力回满瞬发的具名龙卷场地。需新增 primitive：place_named_field(龙卷,duration,slow,pullCenter,dotInterval)、pull_all_to_self、on_successful_pull_spgain(frac)；龙卷特效复用原生。
因果检查：
- 免疫位移的敌人不被拖拽也不触发拖拽回技力，但仍承受龙卷持续伤害，验证位移成功才计数。
- 龙卷每1.5秒对同一敌人只结算一次伤害与一次拖拽；结束时再结算一次拖拽，两个事件分别计数但同一来源同一对象不重复。

## 水月（`char_437_mizuki`）
- 职业：SPECIAL；档位：5（8 金币）；路线：`element`
- 定位：潜行特种·范围法术连晕
- 档位理由：八费的范围法术核心，对多目标附加法术与晕眩并对残血目标额外结算，是清场支点，落五档。
- 设计理由：以原生创伤性癔症与镜花水月为核心：技力回满立即扩大范围对多目标法术打击并附加晕眩，生命不足时以流失生命为代价，保留对残血目标额外法术的特色。

### 固定技能：镜花水月（进击）
- 来源技能：`skchr_mizuki_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,21,18,15]；初始技力：12
- 自然技力回满时立即自动结算：扩大攻击范围并提升攻击力，对至多4个目标造成法术伤害并附加晕眩；若命中目标少于3个，自身按最大生命比例流失生命。
- 效果1：对至多2/2/3/4个目标造成攻击力105%/120%/135%/150%的法术伤害，攻击范围向前+1格。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多4个目标；action=damage；lifecycle=instant
  - values={"atkScale":[1.05,1.2,1.35,1.5],"maxTarget":[2,2,3,4],"rangeExtend":[1,1,1,1],"damageType":["法术","法术","法术","法术"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：使命中目标晕眩1秒。
  - trigger=镜花水月命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"stunDuration":[1,1,1,1]}；stacking=刷新时长，每次成功施加计数。；limits=免疫晕眩者不计。
- 效果3：命中不足3个目标时流失自身最大生命15%/13%/12%/12%（不致死，最低保留1点）。
  - trigger=本技能命中目标少于3个；target=自身；action=applyStatus；lifecycle=instant
  - values={"selfMaxHpCostRatio":[0.15,0.13,0.12,0.12]}；stacking=每次施放结算一次。；limits=仅当命中数<3时触发。

### 原生天赋计划
- 创伤性癔症（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_437_mizuki/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：攻击时对攻击目标中生命值最少的敌人额外造成攻击力20%/30%/50%的法术伤害。进击沿用对残血目标的额外法术结算。
  - scope=攻击目标中的最低生命敌人；parameters={"extraAtkScale":[0.2,0.2,0.3,0.5]}
- 反移情（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_437_mizuki/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：攻击范围内存在生命值低于一半的敌人时攻击力+10%。进击沿用该条件增伤。
  - scope=自身；parameters={"atkBonus":[0.1,0.1,0.1,0.1],"hpThreshold":0.5}；trigger=范围内的对应事件；unlockStar=1

### 进击被动
- 被动0：进击残血扳机：每次攻击/技能命中多个目标时，对其中生命最少的敌人额外造成攻击力20%/25%/30%/50%的法术伤害，同一次命中只结算一个目标。
  - trigger=普通攻击或技能命中多个目标；target=其中生命值最少的敌人；action=damage；lifecycle=instant
  - values={"extraAtkScale":[0.2,0.25,0.3,0.5],"maxTarget":[1,1,1,1],"damageType":["法术","法术","法术","法术"]}；stacking=每次命中事件独立结算。；limits=同一次命中只对一名最低生命敌人生效。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：镜花水月2目标105%法术、晕1秒、范围+1，命中<3自损15%。
  - 被动：创伤法术20%；反移情+10%。
- ★2（攻×1.55、生命×1.65）：120%法术、自损13%。
  - 被动：创伤25%。
- ★3（攻×2.2、生命×2.6）：3目标135%法术、自损12%。
  - 被动：创伤30%。
- ★4（攻×3、生命×4）：4目标150%法术、自损12%。
  - 被动：创伤50%。

### 模组
- 默认模组：uniequip_002_mizuki
- `uniequip_001_mizuki`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_mizuki`（ADVANCED/rewrite）：三星解锁：镜花水月目标数+1；四星加强：命中少于3个时改为回复等量生命（不触发自损）。
- `uniequip_003_mizuki`（ADVANCED/rewrite）：三星解锁：创伤性癔症额外法术+5%；四星加强：反移情触发阈值提升至60%。
- `uniequip_004_mizuki`（ADVANCED/rewrite）：三星解锁：镜花水月范围+0.5格；四星加强：附加晕眩时长+0.3秒。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_437_mizuki`
实现：复用 stalker 特种 KIT 与最低生命查询；把 MANUAL 镜花水月改写为技力回满瞬发多目标法术斩。需新增 primitive：lowest_hp_target_of_hit、multi_target_damage(maxTarget)、self_maxhp_cost_if_hits_below(threshold)；复用原生镜花水月特效。
因果检查：
- 命中数恰好为3时不触发自损；命中数为2时触发一次自损且不致死，验证边界。
- 创伤性癔症与mode被动在同一次命中都对最低生命目标结算时，两者属于不同被动来源，各自结算但不叠加成一次；同一被动对同一目标只结算一次。

## 归溟幽灵鲨（`char_1023_ghost2`）
- 职业：SPECIAL；档位：5（8 金币）；路线：`summon`
- 定位：人偶特种·替身减速群攻
- 档位理由：八费的人偶群攻核心，替身持续减速灼烧且本体可群体重压，兼具承伤与清场，落五档。
- 设计理由：以原生拥抱自我与生存的重压为核心：技力回满立即对阻挡敌人群体重压并提升攻击与生命上限，自身倒下后由具名替身持续减速灼烧，保留人偶与深海特色。

### 固定技能：生存的重压（进击）
- 来源技能：`skchr_ghost2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,21,18,15]；初始技力：12
- 自然技力回满时立即自动结算：攻击所有被自身阻挡的敌人，短时提升攻击力与生命上限，并对生命比例不低于自身的敌人追加一次物理伤害。
- 效果1：对被自身阻挡的每名敌人造成攻击力200%/220%/240%/260%的物理伤害。
  - trigger=技力自然回满时自动施放；target=自身阻挡的所有敌人；action=damage；lifecycle=instant
  - values={"atkScale":[2,2.2,2.4,2.6],"maxTarget":[99,99,99,99],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算。；limits=仅命中当前被自身阻挡的敌人。
- 效果2：25秒内攻击力+200%/220%/240%/260%，生命上限+160%/180%/190%/200%。
  - trigger=生存的重压结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[2,2.2,2.4,2.6],"maxHpBonus":[1.6,1.8,1.9,2],"duration":[25,25,25,25]}；stacking=刷新时长，技能期间生命增益同步提升最大生命。；limits=每次施放刷新。
- 效果3：对生命比例不低于自身的命中敌人额外造成攻击力60%/65%/70%/70%的物理伤害；否则自身流失少量生命。
  - trigger=命中敌人生命比例不低于自身；target=该敌人；action=damage；lifecycle=instant
  - values={"extraAtkScale":[0.6,0.65,0.7,0.7]}；stacking=逐目标结算。；limits=同一目标每次施放最多一次。

### 原生天赋计划
- 拥抱自我（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1023_ghost2/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：替身使周围敌人移动速度-20%/-30%/-40%且每秒造成相当于20%/30%/40%攻击力的法术伤害（按阶段）。进击沿用替身减速灼烧。
  - scope=替身周围；parameters={"slow":[0.2,0.2,0.3,0.4],"dotScale":[0.2,0.2,0.3,0.4]}
- 阿戈尔的深邃（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1023_ghost2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：编入队伍时所有深海猎人干员生命值+20%。进击沿用该编入队伍阵营被动。
  - scope=编入队伍的深海猎人；parameters={"hpBonus":[0.2,0.2,0.2,0.2]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击人偶扳机：自身被击倒时在原位留下具名替身，替身使周围敌人减速并每秒造成法术伤害，持续15秒后消散。
  - trigger=自身被击倒；target=自身原位；action=summon；lifecycle=battle
  - values={"summonName":["替身","替身","替身","替身"],"slow":[0.2,0.2,0.3,0.4],"dotScale":[0.2,0.2,0.3,0.4],"duration":[15,15,15,15]}；stacking=每次被击倒生成一个替身，场上同时最多1个。；limits=明确为每次被击倒一次。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：重压阻挡群伤200%、攻击+200%/生命上限+160%/25秒。
  - 被动：替身减速20%/灼烧20%；深海生命+20%。
- ★2（攻×1.55、生命×1.65）：220%、+220%/+180%。
  - 被动：替身减速20%/灼烧20%；深海生命+20%。
- ★3（攻×2.2、生命×2.6）：240%、+240%/+190%。
  - 被动：替身减速30%/灼烧30%。
- ★4（攻×3、生命×4）：260%、+260%/+200%。
  - 被动：替身减速40%/灼烧40%。

### 模组
- 默认模组：uniequip_002_ghost2
- `uniequip_001_ghost2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_ghost2`（ADVANCED/rewrite）：三星解锁：替身持续时间+5秒；四星加强：重压期间每命中一名敌人回复自身2%最大生命。
- `uniequip_003_ghost2`（ADVANCED/rewrite）：三星解锁：重压群伤+10%；四星加强：替身减速+10%。
- `uniequip_004_ghost2`（ADVANCED/rewrite）：三星解锁：深海猎人生命加成+5%；四星加强：替身每2秒额外结算一次灼烧。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1023_ghost2`
实现：复用 dollkeeper 特种与阻挡目标；把 MANUAL 生存的重压改写为技力回满瞬发的群攻+自增益。需新增 primitive：blocked_targets_damage、self_maxhp_buff_sync_heal、on_death_spawn_named_token(替身,slow,dot)；替身资源复用原生。
因果检查：
- 生命上限增益同时提升当前生命与治疗基准，避免最大生命提升后治疗失效；增益结束时按比例回落不致死。
- 同一时刻只有一个替身，再次被击倒会替换旧替身；旧替身消散不触发拥抱自我之外的事件。

## 多萝西（`char_4048_doroth`）
- 职业：SPECIAL；档位：4（6 金币）；路线：`summon`
- 定位：陷阱特种·共振成长爆发
- 档位理由：六费的陷阱核心，靠共振装置伏击并随触发层数成长，兼具控制与后期输出，落四档。
- 设计理由：以原生梦想家与高速共振排障为核心：技力回满即补充具名共振装置，触发时范围法术减速并延迟其他装置，每次触发永久成长攻击，保留陷阱特色。

### 固定技能：高速共振排障（进击）
- 来源技能：`skchr_doroth_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[16,14,12,10]；初始技力：7
- 自然技力回满时立即自动结算：立即获得一枚具名共振装置；装置被踩中时对范围内所有目标造成法术伤害、使其停顿，并延迟范围内的其他装置触发。
- 效果1：获得1枚具名“共振装置”，场上拥有数受天赋上限约束。
  - trigger=技力自然回满时自动施放；target=自身；action=device；lifecycle=battle
  - values={"deviceName":["共振装置","共振装置","共振装置","共振装置"],"deviceCount":[1,1,1,1]}；stacking=达到上限后新装置替换最旧一枚。；limits=每枚装置触发一次后消失。
- 效果2：对范围内所有目标造成攻击力280%/300%/330%/350%的法术伤害。
  - trigger=共振装置被踩中；target=装置范围内所有目标；action=damage；lifecycle=instant
  - values={"atkScale":[2.8,3,3.3,3.5],"damageType":["法术","法术","法术","法术"]}；stacking=每枚装置独立结算。；limits=只对首个踩中触发。
- 效果3：使命中目标停顿3.5/4/4.5/5秒，并使范围内其他共振装置的触发延迟2秒。
  - trigger=共振装置被踩中；target=范围内其他共振装置与敌人；action=applyStatus；lifecycle=battle
  - values={"sluggishDuration":[3.5,4,4.5,5],"delaySec":[2,2,2,2]}；stacking=每次触发独立结算。；limits=只延迟范围内其他装置，不重置已触发的装置。

### 原生天赋计划
- 共振装置（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4048_doroth/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：可使用4/6/8个共振装置（最多拥有6/8/10个），踩上的第一个敌人触发；进阶后部署时立刻在攻击范围内召唤装置。进击沿用装置数量与上限。
  - scope=全场装置；parameters={"usable":[4,4,6,8],"maxOwned":[6,6,8,10]}；trigger=范围内的对应事件；unlockStar=1
- 梦想家（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4048_doroth/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：陷阱触发后多萝西获得2%攻击力，最多叠加10层。进击沿用触发成长，成长在局内保存。
  - scope=自身；parameters={"atkPerTrigger":[0.02,0.02,0.02,0.02],"maxStacks":[10,10,10,10]}

### 进击被动
- 被动0：进击陷阱扳机：每次装置触发自身攻击力永久+2%，最多叠加10层，局内保存，不因升星重置。
  - trigger=任意共振装置成功触发；target=自身；action=growth；lifecycle=battle
  - values={"atkPerTrigger":[0.02,0.02,0.02,0.02],"maxStacks":[10,10,10,10]}；stacking=按成功触发次数线性叠加，达上限停止。；limits=只统计成功触发的装置。；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：共振排障280%法术、停顿3.5秒、延迟2秒；装置4/6。
  - 被动：触发+2%攻×10。
- ★2（攻×1.55、生命×1.65）：300%、停顿4秒。
  - 被动：触发+2%攻×10。
- ★3（攻×2.2、生命×2.6）：330%、停顿4.5秒；装置6/8。
  - 被动：触发+2%攻×10。
- ★4（攻×3、生命×4）：350%、停顿5秒；装置8/10。
  - 被动：触发+2%攻×10。

### 模组
- 默认模组：uniequip_002_doroth
- `uniequip_001_doroth`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_doroth`（ADVANCED/rewrite）：三星解锁：装置触发伤害+10%；四星加强：成长层数上限提高至15层。
- `uniequip_003_doroth`（ADVANCED/rewrite）：三星解锁：装置触发停顿+1秒；四星加强：延迟其他装置的时间+1秒。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4048_doroth`
实现：复用 traper 特种陷阱系统；把 AUTO 高速共振排障改写为技力回满瞬发补充具名装置。需新增 primitive：grant_named_trap(共振装置,cap)、trap_trigger_aoe_dot、delay_other_traps(sec)、on_trap_trigger_growth；装置资源复用原生共振装置。
因果检查：
- 装置达到拥有上限时新装置替换最旧一枚，已布置未触发的旧装置被移除且不触发。
- 范围延迟只影响尚未触发的其他装置；同一次触发中多个装置不因延迟而各自重复结算同一次伤害。

## 引星棘刺（`char_1039_thorn2`）
- 职业：SPECIAL；档位：5（8 金币）；路线：`element`
- 定位：炼金特种·移动侵蚀场
- 档位理由：八费的炼金核心，向队友投放移动炼金单元同时削抗削防并灼烧，是持续压制支点，落五档。
- 设计理由：以原生心相与视界为核心：技力回满即向阻挡数最低的干员投掷具名炼金单元，对周围敌人造成攻防法抗递减与持续法术伤害，效果随时间提升，保留炼金削抗特色。

### 固定技能：“我的海疆”（进击）
- 来源技能：`skchr_thorn2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[26,23,20,17]；初始技力：13
- 自然技力回满时立即自动结算：向阻挡数最低的至多4名干员投掷具名炼金单元，对围绕区域敌人持续降低攻击力、防御力与法术抗性并每秒造成法术伤害，效果随时间提升。
- 效果1：向3/3/4/4名阻挡数最低的干员各投掷具名炼金单元，影响其周围1.1格，持续20/21/22/23秒。
  - trigger=技力自然回满时自动施放；target=阻挡数最低的至多4名干员；action=device；lifecycle=battle
  - values={"deviceName":["我的海疆","我的海疆","我的海疆","我的海疆"],"maxTarget":[3,3,4,4],"duration":[20,21,22,23],"radius":[1.1,1.1,1.1,1.1]}；stacking=每个单元独立计时，同值按编队顺序取最前。；limits=每次施放固定目标数。
- 效果2：敌人攻击力-15%/18%/22%/25%、防御与法抗-35%/38%/42%/45%，15秒内逐渐提升至攻-30%/33%/37%/40%、防御法抗-50%；不叠加。
  - trigger=炼金单元持续期间每秒；target=范围内敌人；action=applyStatus；lifecycle=battle
  - values={"atkDebuff":[-0.15,-0.18,-0.22,-0.25],"defDebuff":[-0.35,-0.38,-0.42,-0.45],"resDebuff":[-0.35,-0.38,-0.42,-0.45],"maxAtkDebuff":[-0.3,-0.33,-0.37,-0.4],"maxDefResDebuff":[-0.5,-0.5,-0.5,-0.5],"rampSec":[15,15,15,15]}；stacking=同名减益不叠加，多个单元取最高一次。；limits=只对范围内地面敌人生效。
- 效果3：每秒造成攻击力150%/165%/180%/210%的法术伤害，15秒内提升至330%/340%/360%/390%。
  - trigger=炼金单元持续期间每秒；target=范围内敌人；action=damage；lifecycle=battle
  - values={"dotScale":[1.5,1.65,1.8,2.1],"maxDotScale":[3.3,3.4,3.6,3.9],"interval":[1,1,1,1],"damageType":["法术","法术","法术","法术"]}；stacking=同一敌人每秒结算一次。；limits=效果随时间线性提升，达上限后恒定。

### 原生天赋计划
- 心相（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1039_thorn2/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击力+3%/6%/10%，攻击范围内存在其他干员时自身炼金单元持续时间延长1/2/3秒。进击沿用持续时长延长。
  - scope=自身；parameters={"atkBonus":[0.03,0.03,0.06,0.1],"durationExtend":[1,1,2,3]}；trigger=范围内的对应事件；unlockStar=1
- 视界（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1039_thorn2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：在场时所有友方单位攻击速度+5，敌方单位攻击速度-5；位于连续6格或以上直线道路的单位效果翻倍。进击沿用该全场攻速增减与直线翻倍。
  - scope=全场；parameters={"allyAspd":[5,5,5,5],"enemyAspd":[-5,-5,-5,-5],"straightRoadDouble":1}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：进击炼金扳机：处于自身炼金单元范围内的敌人所受持续伤害+20%，多个单元重叠不连乘，取最高。
  - trigger=敌方单位处于自身炼金单元影响范围；target=该敌人；action=addBuff；lifecycle=battle
  - values={"dotAmp":[0.2,0.2,0.2,0.2]}；stacking=多个来源取最高。；limits=只对持续伤害生效。

### 星级
- ★1（攻×1、生命×1）：我的海疆3目标、单元20秒、减攻15%/防法抗35%、每秒150%法术。
  - 被动：心相+3%/持续+1秒；视界攻速±5。
- ★2（攻×1.55、生命×1.65）：单元21秒、减18%/38%、每秒165%。
  - 被动：心相+3%/持续+1秒；视界攻速±5。
- ★3（攻×2.2、生命×2.6）：4目标、单元22秒、减22%/42%、每秒180%。
  - 被动：心相+6%/持续+2秒。
- ★4（攻×3、生命×4）：单元23秒、减25%/45%、每秒210%。
  - 被动：心相+10%/持续+3秒。

### 模组
- 默认模组：uniequip_002_thorn2
- `uniequip_001_thorn2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_thorn2`（ADVANCED/rewrite）：三星解锁：炼金单元影响范围+0.5格；达到最大减益后敌人额外-10%防御。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1039_thorn2`
实现：复用 alchemist 炼金单元与减益系统；把 MANUAL 我的海疆改写为技力回满瞬发的多目标装置投掷。需新增 primitive：throw_units_to_lowest_block(maxTarget)、zone_ramp_debuff(atk,def,res,rampSec)、zone_dot_ramp、no_stack_take_max；装置资源复用原生。
因果检查：
- 多个炼金单元重叠时减益与增伤取最高一次而非连乘；单元消失后减益按剩余来源重算，不残留已消失单元的效果。
- 直线道路上的单位攻速效果翻倍，离开直线后立即恢复单倍，验证按位置实时判定。

## 山（`char_264_f12yin`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`blockCounter`
- 定位：拳卫·范围推击重拳
- 档位理由：八费的核心拳卫，把单体重拳扩展为范围推击并自带闪避与减攻，承伤控制兼备，落五档。
- 设计理由：以原生巨力重拳与震地碎岩击为核心：技力回满立即对周围至多4名敌人造成多段重击并推动，期间提升重拳触发概率，保留拳卫高闪避与推击特色。

### 固定技能：震地碎岩击（进击）
- 来源技能：`skchr_f12yin_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,21,18,15]；初始技力：12
- 自然技力回满时立即自动结算：攻击间隔增大，对周围至多4名敌人造成两段物理伤害并将其推动，期间巨力重拳触发概率提升。
- 效果1：对至多3/3/4/4名敌人各造成2段、每段攻击力70%/80%/90%/100%的物理伤害。
  - trigger=技力自然回满时自动施放；target=周围至多4名敌人；action=damage；lifecycle=instant
  - values={"hits":[2,2,2,2],"atkScalePerHit":[0.7,0.8,0.9,1],"maxTarget":[3,3,4,4],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标逐段结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：将命中敌人以中等力度向外推动。
  - trigger=震地碎岩击命中目标；target=被命中敌人；action=move；lifecycle=instant
  - values={"force":[1,1,1,1]}；stacking=逐目标结算。；limits=免疫位移者不被推但仍受伤。
- 效果3：30秒内巨力重拳触发概率提升至55%/60%/65%/75%，并附带攻击间隔增大的重击节奏。
  - trigger=震地碎岩击结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"talentProbBonus":[0.55,0.6,0.65,0.75],"duration":[30,30,30,30]}；stacking=以最高概率为准，不叠加多份。；limits=每次施放刷新。

### 原生天赋计划
- 巨力重拳（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_264_f12yin/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击时20%几率攻击力提升至140%/160%，并使目标3秒内攻击力降低10%/15%（不可叠加）。进击沿用重拳触发与减攻。
  - scope=自身与目标；parameters={"prob":[0.2,0.2,0.2,0.2],"atkScale":[1.4,1.4,1.4,1.6],"targetAtkDown":[0.1,0.1,0.1,0.15]}；trigger=普通攻击时；unlockStar=1
- 强壮肉体（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_264_f12yin/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：防御力+10%，获得15%物理闪避。进击沿用防御与闪避。
  - scope=自身；parameters={"defRatio":[0.1,0.1,0.1,0.1],"physDodge":[0.15,0.15,0.15,0.15]}

### 进击被动
- 被动0：进击重拳扳机：巨力重拳触发时使目标3秒内攻击力-10%/10%/10%/15%（不可叠加，刷新时长），重复触发重复计数。
  - trigger=普通攻击触发巨力重拳；target=被命中的目标；action=addBuff；lifecycle=battle
  - values={"targetAtkDown":[0.1,0.1,0.1,0.15],"duration":[3,3,3,3]}；stacking=不可叠加，取最高值并刷新时长。；limits=只对触发重拳的那次攻击生效。；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：震地3目标×2段每段70%、中等推动、重拳概率55%/30秒。
  - 被动：重拳20%/140%/减攻10%；防+10%/闪避15%。
- ★2（攻×1.55、生命×1.65）：80%、重拳60%。
  - 被动：重拳20%/140%/减攻10%；防+10%/闪避15%。
- ★3（攻×2.2、生命×2.6）：4目标×2段90%、重拳65%。
  - 被动：重拳20%/140%/减攻10%；防+10%/闪避15%。
- ★4（攻×3、生命×4）：每段100%、重拳75%。
  - 被动：重拳160%/减攻15%。

### 模组
- 默认模组：uniequip_002_f12yin
- `uniequip_001_f12yin`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_f12yin`（ADVANCED/rewrite）：三星解锁：震地碎岩击命中至少3名敌人时退返1点技力；四星加强：重拳减攻时长+2秒。
- `uniequip_003_f12yin`（ADVANCED/rewrite）：三星解锁：强壮肉体物理闪避+5%；四星加强：巨力重拳触发概率+5%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_264_f12yin`
实现：复用 fighter 拳卫 KIT 与概率重拳；把 MANUAL 震地碎岩击改写为技力回满瞬发的范围多段推击。需新增 primitive：aoe_multi_hit_with_push(maxTarget,hits,force)、talent_prob_override、target_atk_down_no_stack；复用原生震地特效。
因果检查：
- 重拳减攻不可叠加：同一目标连续被多次重拳命中只保留一层并刷新时长，第二次命中仍计一次重拳事件。
- 被推动的敌人撞到其他单位时按位移结算但不重复计算本次伤害；免疫位移者只受伤不被推。

## 重岳（`char_2024_chyue`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`skillCycle`
- 定位：拳卫·充能累积爆发
- 档位理由：八费的充能拳卫，靠多次技能累积进入增强形态并对范围内成组打击，成长明确，落五档。
- 设计理由：以原生止戈与我无为核心：技力回满立即对目标及其周围造成物理伤害，累计施放达到阈值后范围扩大、攻击变二连击并追加伤害，保留浮空与止戈增伤特色。

### 固定技能：我无（进击）
- 来源技能：`skchr_chyue_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[14,13,12,10]；初始技力：6
- 自然技力回满时立即自动结算：对目标及其周围造成物理伤害；累计施放五次后攻击范围扩大、攻击变为二连击且技能追加一次伤害。
- 效果1：对目标及其周围敌人造成攻击力300%/320%/350%/380%的物理伤害。
  - trigger=技力自然回满时自动施放；target=目标及其周围敌人；action=damage；lifecycle=instant
  - values={"atkScale":[3,3.2,3.5,3.8],"splashRadius":[1,1,1,1],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内敌人。
- 效果2：进入增强形态：攻击范围+1格、普通攻击变为二连击，且本技能每次施放追加一次同倍率伤害；形态局内保存。
  - trigger=累计施放达到5次后；target=自身；action=growth；lifecycle=battle
  - values={"rangeExtend":[1,1,1,1],"extraHit":[1,1,1,1],"threshold":[5,5,5,5]}；stacking=形态只进入一次，之后每次施放都生效。；limits=累计计数局内保存，不因升星重置。
- 效果3：对处于止戈标记的敌人造成提升后的伤害（标记内伤害提升55%/65%），重复命中刷新增伤标记。
  - trigger=止戈命中被其标记的目标；target=该目标；action=damage；lifecycle=battle
  - values={"talentAtkScale":[1.55,1.55,1.6,1.65],"duration":[2.5,2.5,2.5,2.5]}；stacking=止戈标记刷新时长，不叠加。；limits=只对止戈命中的目标生效。

### 原生天赋计划
- 止戈（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_2024_chyue/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：对目标普攻时有18%/23%概率使重岳2.5秒内对其造成的伤害提升55%/65%。进击沿用概率标记与增伤。
  - scope=被标记目标；parameters={"prob":[0.18,0.18,0.23,0.23],"damageBonus":[0.55,0.55,0.65,0.65],"duration":2.5}；trigger=普通攻击时；unlockStar=1
- 万象为宾（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_2024_chyue/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：若重岳释放一次技能击倒不少于一个敌人，则回复3点技力。进击沿用技能击杀回技力。
  - scope=自身；parameters={"spOnKill":3,"perCast":1}；trigger=击倒敌人时；unlockStar=1

### 进击被动
- 被动0：进击击杀扳机：每次技能施放若击倒至少1名敌人回复3点技力，同一次施放最多结算一次。
  - trigger=自身技能施放中至少击倒1名敌人；target=自身；action=spGain；lifecycle=battle
  - values={"sp":[3,3,3,3],"perCast":[1,1,1,1]}；stacking=每次施放最多一次。；limits=同一次施放内击杀多名敌人也只回复一次。

### 星级
- ★1（攻×1、生命×1）：我无300%物理、累积5次后范围+1/二连击/追加一次。
  - 被动：止戈18%/+55%；技能击杀回3技力。
- ★2（攻×1.55、生命×1.65）：320%。
  - 被动：止戈18%/+55%；技能击杀回3技力。
- ★3（攻×2.2、生命×2.6）：350%。
  - 被动：止戈23%/+65%。
- ★4（攻×3、生命×4）：380%。
  - 被动：止戈23%/+65%。

### 模组
- 默认模组：uniequip_002_chyue
- `uniequip_001_chyue`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_chyue`（ADVANCED/rewrite）：三星解锁：进入增强形态所需次数降至4次；四星加强：追加伤害对止戈标记目标+15%。
- `uniequip_003_chyue`（ADVANCED/rewrite）：三星解锁：止戈触发概率+3%；四星加强：技能击杀回技力+1。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_2024_chyue`
实现：复用 fighter 拳卫与充能计数；把 MANUAL 我无改写为技力回满瞬发的范围重击。需新增 primitive：aoe_damage_with_splash、cumulative_cast_form(threshold,rangeExtend,extraHit)、mark_damage_bonus；复用原生我无特效。
因果检查：
- 累计施放第5次的那一次即享受增强形态（范围与追加），不是下一次才生效，验证阈值边界。
- 一次施放击倒多名敌人只回一次3点技力；不同施放分别结算，验证每施放一次上限。

## 贝洛内（`char_4037_demetr`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`pierceCrit`
- 定位：拳卫·削防追猎突进
- 档位理由：六费的追猎拳卫，靠削防叠加与突进换位持续压制高价值目标，机动性强，落四档。
- 设计理由：以原生家族手段与清算为核心：技力回满立即提升攻击与攻速、几率重击并突进到附近地面目标处，精英或领袖被击倒时重新选取目标，保留削防与处决特色。

### 固定技能：清算（进击）
- 来源技能：`skchr_demetr_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[22,20,17,14]；初始技力：11
- 自然技力回满时立即自动结算：获得攻击力与攻击速度提升，攻击时有几率造成额外物理伤害并突进到附近一名地面目标所在位置，目标被击倒或1秒未攻击时重新选取。
- 效果1：30秒内攻击力+140%/155%/165%/170%，攻击速度+40/45/48/50。
  - trigger=技力自然回满时自动施放；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[1.4,1.55,1.65,1.7],"attackSpeedBonus":[40,45,48,50],"duration":[30,30,30,30]}；stacking=刷新时长，不叠加。；limits=每次施放刷新。
- 效果2：40%/45%/50%/50%几率造成攻击力150%/165%/180%/185%的额外物理伤害；每次攻击使目标防御-5%/6%/7%/7%，最多5/6/7/8层，持续10秒。
  - trigger=清算期间攻击；target=被命中敌人；action=damage；lifecycle=battle
  - values={"prob":[0.4,0.45,0.5,0.5],"extraAtkScale":[1.5,1.65,1.8,1.85],"defShredPerHit":[0.05,0.06,0.07,0.07],"defShredMaxStacks":[5,6,7,8],"defShredDuration":[10,10,10,10]}；stacking=削防可叠层，达上限不再增加；额外伤害按攻击次数结算。；limits=削防10秒后逐层消失。
- 效果3：若附近4格内有可部署位置，突进至该地面目标处攻击；目标被击倒或自身1秒未攻击时立即重新选取目标；受到致命伤害时不撤退但结束状态并返回原位。
  - trigger=清算期间；target=自身与附近一名地面目标；action=move；lifecycle=battle
  - values={"maxDistance":[4,4,4,4],"reTargetOnEliteKill":[1,1,1,1],"reTargetNoAttackSec":[1,1,1,1]}；stacking=同一时刻只锁定一个目标。；limits=突进不视为再部署，不触发再部署相关效果。

### 原生天赋计划
- 家族手段（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4037_demetr/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击使目标10秒内防御-5%/7%（最多5层），且目标剩余生命比例越低自身对其伤害越高，20%以下时提升至最高120%/128%。进击沿用削防与处决增伤。
  - scope=被攻击目标；parameters={"defShred":[0.05,0.05,0.07,0.07],"executionMax":[1.2,1.2,1.2,1.28],"executionHp":0.2}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 街头直觉（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4037_demetr/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：获得40%物理和法术闪避，部署后提高到80%并在20秒内逐渐衰减。进击沿用部署后短时高闪避。
  - scope=自身；parameters={"dodge":[0.4,0.4,0.4,0.4],"deployDodge":[0.8,0.8,0.8,0.8],"decaySec":20}；trigger=部署/再部署后；unlockStar=1
- 隐蔽天赋槽2（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4037_demetr/talents/2`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}

### 进击被动
- 被动0：进击处决扳机：目标生命低于20%时自身攻击无视其20%防御，重复命中重复计数但不叠层。
  - trigger=攻击生命比例低于20%的目标；target=自身；action=addBuff；lifecycle=battle
  - values={"ignoreDefRatio":[0.2,0.2,0.2,0.2],"hpThreshold":[0.2,0.2,0.2,0.2]}；stacking=只保留一层。；limits=按目标当前生命实时判定。

### 星级
- ★1（攻×1、生命×1）：清算+140%攻/+40攻速/30秒、几率150%额外、削防5%×5、突进4格。
  - 被动：家族削防5%/处决120%；街头闪避40/80。
- ★2（攻×1.55、生命×1.65）：+155%/+45、165%、削6%×6。
  - 被动：家族削防5%/处决120%；街头闪避40/80。
- ★3（攻×2.2、生命×2.6）：+165%/+48、180%、削7%×7。
  - 被动：家族削防7%/处决128%。
- ★4（攻×3、生命×4）：+170%/+50、185%、削7%×8。
  - 被动：残局嗅觉无视20%防御。

### 模组
- 默认模组：uniequip_002_demetr
- `uniequip_001_demetr`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_demetr`（ADVANCED/rewrite）：三星解锁：清算突进不占用部署位；削防叠满后对目标追加一次攻击力60%的物理伤害。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4037_demetr`
实现：复用 fighter 拳卫与位移/追击逻辑；把 MANUAL 清算改写为技力回满瞬发的自增益+锁定突进。需新增 primitive：dash_to_ground_target(maxDistance)、re_target_on_kill_or_idle、stacking_def_shred(maxStacks)、execution_damage_scale；复用原生清算特效。
因果检查：
- 突进不是再部署：不触发再部署被动、不计再部署次数；突进期间受致命伤害不撤退但结束状态并返回原位。
- 削防叠满后再攻击不再增加层数；10秒后逐层消失，消失过程中处决增伤按目标剩余生命实时重算。

## 银灰（`char_172_svrash`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`skillCycle`
- 定位：领主近卫·真银斩群攻核心
- 档位理由：八费的范围输出核心，真银斩一键清场并附带编入队伍再部署支援，领袖级泛用，落五档。
- 设计理由：以原生领袖与真银斩为核心：技力回满立即降低防御、大幅提升攻击并扩大范围同时打击至多6个目标，保留银灰的再部署支援与鹰眼反隐特色。

### 固定技能：真银斩（进击）
- 来源技能：`skchr_svrash_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[30,26,22,18]；初始技力：15
- 自然技力回满时立即自动结算：降低自身防御并大幅提升攻击力，攻击范围扩大，对至多6个目标造成视为近距离的高额物理伤害。
- 效果1：对至多5/5/6/6个目标造成攻击力140%/160%/180%/200%的物理伤害，视为近距离攻击。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多6个目标；action=damage；lifecycle=instant
  - values={"atkScale":[1.4,1.6,1.8,2],"maxTarget":[5,5,6,6],"rangeExtend":[1,1,1,1],"asMelee":[1,1,1,1],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：30秒内自身防御-70%、攻击力+140%/160%/180%/200%、范围+1格并保持多目标攻击。
  - trigger=真银斩结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"defPenalty":[-0.7,-0.7,-0.7,-0.7],"atkBonus":[1.4,1.6,1.8,2],"rangeExtend":[1,1,1,1],"duration":[30,30,30,30]}；stacking=刷新时长，不叠加。；limits=防御惩罚明确存在，作为代价。

### 原生天赋计划
- 领袖（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_172_svrash/talents/0`）：mode=rewrite；runtimeBinding=modePassive:0
  - 由 modePassive[0] 单份承接：自身攻击力+5%/5%/10%/10%，且银灰编入队伍时全体我方单位再部署时间-5%/8%/10%/12%。原生天赋不再另行安装；增益每战编队安装一次，未编入队伍即移除，不整局留存到卖出之后。
  - scope=undefined；parameters={"atkBonus":[0.05,0.05,0.1,0.1],"redeployReduce":[0.05,0.08,0.1,0.12],"installOncePerBattleFormation":true,"removedWhenNotInTeam":true,"notPersistAfterSell":true}
- 鹰眼视觉（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_172_svrash/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：攻击范围内敌人的隐匿效果失效。进击沿用反隐范围。
  - scope=攻击范围内敌人；parameters={"revealInvisible":[1,1,1,1]}；trigger=范围内的对应事件；unlockStar=1

### 进击被动
- 被动0：银灰编入队伍时，自身攻击力+5%/5%/10%/10%，全体我方单位再部署时间-5%/8%/10%/12%；由银灰一个来源提供，同源不叠。每战编队安装一次，未编入队伍即移除，不整局留到卖出之后。再部署减时不是加速（haste 仅指自然SP+100%），此处直接修改再部署时间。
  - trigger=银灰编入队伍（每战编队安装一次）；target=自身与我方全体单位；action=nativeMechanism；lifecycle=battle
  - values={"atkBonusSelf":[0.05,0.05,0.1,0.1],"redeployReduceTeam":[0.05,0.08,0.1,0.12],"installOncePerBattleFormation":true,"removedWhenNotInTeam":true,"notPersistAfterSell":true,"notHaste":true}；stacking=同源只取一次；limits=仅当银灰在编入队伍中，移除即失效。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：真银斩5目标140%、防御-70%、攻击+140%/30秒。
  - 被动：领袖自身+5%攻/全队再部署-5%；反隐。
- ★2（攻×1.55、生命×1.65）：160%、+160%。
  - 被动：领袖+5%攻/再部署-8%。
- ★3（攻×2.2、生命×2.6）：6目标180%、+180%。
  - 被动：领袖+10%攻/再部署-10%。
- ★4（攻×3、生命×4）：200%、+200%。
  - 被动：领袖+10%攻/再部署-12%。

### 模组
- 默认模组：uniequip_002_svrash
- `uniequip_001_svrash`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_svrash`（ADVANCED/rewrite）：三星解锁：真银斩目标数+1；施放时若命中至少3个目标，防御惩罚降低至-50%。；四星加强：本效果随角色四星身体放大，无额外模块机制。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_172_svrash`
实现：复用 lord 领主 KIT 与多目标判定；把 MANUAL 真银斩改写为技力回满瞬发。需新增 primitive：multi_target_as_melee(maxTarget)、self_def_penalty_buff、team_redeploy_reduce_aura、reveal_invisible；复用原生真银斩特效。
因果检查：
- 再部署支援只由银灰一个来源提供，即使编入两名同名单位也不叠加；再部署减少作用于费用与时长而非购买价。
- 防御惩罚与攻击增益同生命周期，增益结束时防御立即恢复；真银斩命中被反隐的隐匿敌人正常造成伤害。

## 仇白（`char_4082_qiubai`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`skillCycle`
- 定位：领主近卫·束缚法术叠加
- 档位理由：六费的领主核心，以束缚控制配合法术多目标输出并逐次叠加攻速，落四档。
- 设计理由：以原生入隙与问雪为核心：技力回满立即扩大范围、转为法术并额外攻击目标，每次攻击叠加攻速，对停顿/束缚目标追加法术，保留控制联动特色。

### 固定技能：问雪（进击）
- 来源技能：`skchr_qiubai_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,21,18,15]；初始技力：12
- 自然技力回满时立即自动结算：扩大攻击范围、提升攻击力并转为法术伤害，额外攻击2个目标，远程攻击不再降低伤害，每次攻击叠加攻速。
- 效果1：对至多3个目标造成攻击力40%/48%/52%/55%的法术伤害，范围+1格。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多3个目标；action=damage；lifecycle=instant
  - values={"atkScale":[0.4,0.48,0.52,0.55],"extraTargets":[2,2,2,2],"rangeExtend":[1,1,1,1],"damageType":["法术","法术","法术","法术"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：30秒内每次攻击自身攻击速度+13，最多叠加6层（四星8层），远程攻击不降低伤害。
  - trigger=问雪持续期间每次攻击；target=自身；action=growth；lifecycle=battle
  - values={"attackSpeedPerHit":[13,13,13,13],"maxStacks":[6,6,6,8],"duration":[30,30,30,30]}；stacking=按攻击次数线性叠加，达上限停止。；limits=状态结束时层数清空。
- 效果3：对处于停顿或束缚的命中目标额外造成攻击力25%/30%/35%/40%的法术伤害。
  - trigger=命中处于停顿或束缚的敌人；target=该敌人；action=damage；lifecycle=instant
  - values={"extraAtkScale":[0.25,0.3,0.35,0.4],"damageType":["法术","法术","法术","法术"]}；stacking=逐目标结算。；limits=每个目标每次命中最多一次。

### 原生天赋计划
- 入隙（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4082_qiubai/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击处于停顿、束缚的敌人时额外造成攻击力25%/40%的法术伤害。进击沿用对受控目标的额外法术。
  - scope=自身；parameters={"extraAtkScale":[0.25,0.25,0.25,0.4]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 落英（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4082_qiubai/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：攻击时有20%几率使目标束缚1.5秒。进击沿用普攻几率束缚。
  - scope=被攻击目标；parameters={"rootProb":[0.2,0.2,0.2,0.2],"rootDuration":1.5}

### 进击被动
- 被动0：进击落英扳机：普攻有20%几率束缚命中目标1.5秒，重复成功施加重复计数，已受控目标不重复触发本被动。
  - trigger=普通攻击命中未处于停顿/束缚的敌人；target=该敌人；action=applyStatus；lifecycle=battle
  - values={"rootDuration":[1.5,1.5,1.5,1.5],"prob":[0.2,0.2,0.2,0.2]}；stacking=每次成功施加独立计数。；limits=对已处于束缚的目标不再触发本被动，避免同一链重复。；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：问雪3目标40%法术、范围+1、每次攻击+13攻速×6；对受控+25%。
  - 被动：入隙+25%；落英20%束缚1.5秒。
- ★2（攻×1.55、生命×1.65）：48%、对受控+30%。
  - 被动：入隙+25%；落英20%束缚1.5秒。
- ★3（攻×2.2、生命×2.6）：52%、对受控+35%。
  - 被动：入隙+40%。
- ★4（攻×3、生命×4）：55%、攻速×8、对受控+40%。
  - 被动：入隙+40%。

### 模组
- 默认模组：uniequip_002_qiubai
- `uniequip_001_qiubai`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_qiubai`（ADVANCED/rewrite）：三星解锁：问雪额外攻击目标+1；四星加强：对受控目标的额外法术伤害+15%。
- `uniequip_003_qiubai`（ADVANCED/rewrite）：三星解锁：入隙额外伤害+5%；四星加强：落英束缚时长+0.5秒。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4082_qiubai`
实现：复用 lord 领主与束缚/停顿查询；把 MANUAL 问雪改写为技力回满瞬发。需新增 primitive：damage_type_override(法术)、remote_no_penalty、attack_speed_stack_on_hit、extra_damage_vs_controlled；复用原生问雪特效。
因果检查：
- 落英对已处于束缚的目标不再触发，避免同一因果链重复；入隙对受控目标的增伤仍照常结算（不同被动来源）。
- 攻速叠加达上限后继续攻击不再增加层数，状态结束时清空为0，验证上限与清空。

## 乌尔比安（`char_4145_ulpia`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`healShield`
- 定位：重剑近卫·受击回血承伤核心
- 档位理由：八费的承伤核心，靠每次受击回血与击杀成长叠加生命攻击，越战越硬，落五档。
- 设计理由：以原生本性的坚守与血脉的哺养为核心：技力回满立即抛锚拖拽并群晕、提升生命上限与攻击，受击持续回血，保留深海猎人成长与承伤特色。

### 固定技能：必须开辟的通路（进击）
- 来源技能：`skchr_ulpia_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,22,19,16]；初始技力：12
- 自然技力回满时立即自动结算：提升最大生命与攻击力，向面前抛出锚并拖拽、晕眩周围敌人，若锚停留处可部署则移动到该处。
- 效果1：25秒内最大生命+60%/70%/80%/80%，攻击力+230%/245%/260%/260%。
  - trigger=技力自然回满时自动施放；target=自身；action=addBuff；lifecycle=battle
  - values={"maxHpBonus":[0.6,0.7,0.8,0.8],"atkBonus":[2.3,2.45,2.6,2.6],"duration":[25,25,25,25]}；stacking=刷新时长，不叠加层数。；limits=每次施放刷新，生命增益同步提升当前生命。
- 效果2：对锚落点周围八格内所有敌人造成攻击力140%/150%/160%/160%的物理伤害。
  - trigger=锚命中或达到最远距离；target=锚落点周围所有敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.4,1.5,1.6,1.6],"radius":[1,1,1,1],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算。；limits=每次施放一次。
- 效果3：使命中目标晕眩6秒。
  - trigger=锚命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"stunDuration":[6,6,6,6]}；stacking=刷新时长，每次成功施加计数一次。；limits=免疫晕眩者不计。
- 效果4：若锚停留位置可部署，乌尔比安移动至该位置进行攻击，结束时返回原位置。
  - trigger=锚停留位置可部署；target=自身；action=move；lifecycle=instant
  - values={"dashToAnchor":[1,1,1,1]}；stacking=每次施放一次。；limits=移位不是再部署，不触发再部署效果。

### 原生天赋计划
- 本性的坚守（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4145_ulpia/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：每次受到伤害时治疗自身80/100点生命，生命低于50%时提升至120/160点。进击沿用受击回血，固定治疗点数按设计表处理。
  - scope=自身；parameters={"healPerHit":[80,80,100,100],"lowHpHeal":[120,120,160,160],"hpThreshold":0.5}
- 血脉的哺养（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4145_ulpia/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：每次击倒敌人自身生命上限+120、攻击+30，最多9层，其他深海猎人干员获得50%效果。进击沿用击杀成长，局内保存。
  - scope=自身与深海猎人；parameters={"hpPerKill":120,"atkPerKill":30,"maxStacks":9,"allyRatio":0.5}；trigger=击倒敌人时；unlockStar=1
- 隐蔽天赋槽2（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4145_ulpia/talents/2`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}

### 进击被动
- 被动0：进击受击扳机：每次受击回复80/100点生命，生命低于50%时回复120/160点，重复受击重复计数。
  - trigger=自身受到一次伤害；target=自身；action=heal；lifecycle=battle
  - values={"healPerHit":[80,80,100,100],"lowHpHeal":[120,120,160,160],"hpThreshold":[0.5,0.5,0.5,0.5]}；stacking=按受击事件逐次计数。；limits=免疫或未命中的攻击不计。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：开路最大生命+60%/攻击+230%/25秒、锚140%物理+晕6秒+位移。
  - 被动：受击回80/120；血脉每杀+120/+30×9。
- ★2（攻×1.55、生命×1.65）：+70%/+245%、锚150%。
  - 被动：受击回80/120；血脉每杀+120/+30×9。
- ★3（攻×2.2、生命×2.6）：+80%/+260%、锚160%，受击回100/160。
  - 被动：深潜应激减伤15%。
- ★4（攻×3、生命×4）：+80%/+260%、锚160%，受击回100/160。
  - 被动：深潜应激减伤15%。

### 模组
- 默认模组：uniequip_002_ulpia
- `uniequip_001_ulpia`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_ulpia`（ADVANCED/rewrite）：三星解锁：受击回血+20点；四星加强：生命低于50%时回血提升比例提高至60%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4145_ulpia`
实现：复用 crusher 重剑近卫与受击事件；把 MANUAL 必须开辟的通路改写为技力回满瞬发。需新增 primitive：anchor_throw_with_stun(radius)、dash_to_anchor、self_maxhp_buff_sync_heal、on_damage_taken_heal(fixed)；锚特效复用原生。
因果检查：
- 受击回血按每次实际受伤事件结算，闪避或护盾完全吸收的伤害若未命中则不回血。
- 锚停留处不可部署时不移动但仍造成伤害与晕眩，验证位移条件是独立判定。

## 佩佩（`char_4058_pepe`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`skillCycle`
- 定位：锤卫·范围晕眩叠层
- 档位理由：六费的锤卫核心，靠范围晕眩与逐次扩大溅射的攻击成长压制群敌，落四档。
- 设计理由：以原生往昔传承与弥漫莲香为核心：技力回满立即对周围群敌造成多段物理伤害并晕眩，每次施放后溅射范围与攻击力叠加成长，保留锤卫控场与近卫增益特色。

### 固定技能：时光震荡（进击）
- 来源技能：`skchr_pepe_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[22,20,17,14]；初始技力：11
- 自然技力回满时立即自动结算：攻击间隔略微增大，对周围敌人造成物理伤害并晕眩主目标更久；每次攻击后溅射范围扩大且攻击力额外提升，最多叠加4层。
- 效果1：对周围八格内敌人造成攻击力180%/200%/220%/240%的物理伤害。
  - trigger=技力自然回满时自动施放；target=自身周围敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1.8,2,2.2,2.4],"radius":[1,1,1,1],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：使命中目标晕眩0.8秒，对主目标提升至1.5秒。
  - trigger=时光震荡命中目标；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"stunDuration":[0.8,0.8,0.8,0.8],"stunMain":[1.5,1.5,1.5,1.5]}；stacking=刷新时长，每次成功施加计数。；limits=免疫晕眩者不计。
- 效果3：每次攻击后攻击力额外+16%/18%/22%/25%、溅射范围+0.25格，最多叠加4层，状态结束时清空。
  - trigger=自身每次攻击命中后；target=自身；action=growth；lifecycle=battle
  - values={"atkPerStack":[0.16,0.18,0.22,0.25],"rangeExtendPerStack":[0.25,0.25,0.25,0.25],"maxStacks":[4,4,4,4]}；stacking=按攻击次数线性叠加，达上限停止。；limits=状态结束时层数清空。

### 原生天赋计划
- 往昔传承（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4058_pepe/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：技能期间每击倒1名敌人，技能结束时获得1点技力，至多回复10/14点。进击沿用技能击杀回技力。
  - scope=自身；parameters={"spPerKill":1,"maxSp":[10,10,10,14]}
- 弥漫莲香（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4058_pepe/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：在场时所有近卫干员攻击力+16%。进击沿用该职业范围被动，不发明全队人数羁绊。
  - scope=全场近卫；parameters={"atkBonus":[0.16,0.16,0.16,0.16]}；trigger=被动常驻；unlockStar=1

### 进击被动
- 被动0：进击击杀扳机：技能期间每击倒1名敌人于结束时获得1点技力，单次施放至多回10/14点。
  - trigger=技能持续期间击倒敌人；target=自身；action=spGain；lifecycle=battle
  - values={"spPerKill":[1,1,1,1],"maxPerCast":[10,10,10,14]}；stacking=按击杀数累加至上限。；limits=明确为每次技能施放累计上限。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：时光震荡180%物理、晕0.8/主1.5秒、每层+16%攻/+0.25格×4。
  - 被动：近卫+16%；技能击杀回技力上限10。
- ★2（攻×1.55、生命×1.65）：200%、每层+18%。
  - 被动：近卫+16%；技能击杀回技力上限10。
- ★3（攻×2.2、生命×2.6）：220%、每层+22%。
  - 被动：近卫+16%；技能击杀回技力上限10。
- ★4（攻×3、生命×4）：240%、每层+25%。
  - 被动：技能击杀回技力上限14。

### 模组
- 默认模组：uniequip_002_pepe
- `uniequip_001_pepe`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_pepe`（ADVANCED/rewrite）：三星解锁：攻击叠层上限+1；四星加强：主目标晕眩时长+0.3秒。
- `uniequip_003_pepe`（ADVANCED/rewrite）：三星解锁：每层攻击增益+3%；四星加强：击倒敌人时额外获得1点技力（计入上限）。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4058_pepe`
实现：复用 hammer 锤卫与范围晕眩；把 MANUAL 时光震荡改写为技力回满瞬发。需新增 primitive：aoe_stun_with_main(duration,mainDuration)、attack_stack_growth(atkPerStack,rangePerStack,max)、sp_on_kill_during_skill；锤击特效复用原生。
因果检查：
- 攻击叠层在状态结束时清空为0，重新施放从0开始，验证跨施放不保留。
- 技能击杀回技力在单次施放内封顶10/14点，超过的击杀不额外回复；多次施放分别封顶。

## 锏（`char_4116_blkkgt`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`pierceCrit`
- 定位：剑卫·战栗斩击核心
- 档位理由：八费的范围斩击核心，连续斩击拖拽群敌并对战栗目标无视防御，控场与爆发兼备，落五档。
- 设计理由：以原生“天生的武者”与活着的传奇为核心：技力回满立即发动多段范围斩击、持续拖拽敌人并对战栗目标无视防御，保留战栗与斩击特色。

### 固定技能：归于宁静（进击）
- 来源技能：`skchr_blkkgt_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,22,19,16]；初始技力：11
- 自然技力回满时立即自动结算：对范围内至多6名敌人发动多段斩击并持续拖拽至自身中心，随后造成一次高倍率物理伤害并以更大力度拖拽。
- 效果1：发动10段斩击，每段对至多6名敌人各造成攻击力200%/210%/225%/235%的物理伤害。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多6名敌人；action=damage；lifecycle=instant
  - values={"hits":[10,10,10,10],"atkScalePerHit":[2,2.1,2.25,2.35],"maxTarget":[6,6,6,6],"damageType":["物理","物理","物理","物理"]}；stacking=逐段逐目标结算。；limits=总段数固定为10。
- 效果2：持续将敌人以中等力度拖拽至自身中心，结束后以较大力度再拖拽一次。
  - trigger=斩击命中目标；target=被命中敌人；action=move；lifecycle=instant
  - values={"pullToCenterForce":[1,1,1,1],"endForce":[2,2,2,2]}；stacking=逐目标结算。；limits=免疫位移者不动但仍受伤。
- 效果3：技能期间天赋“天生的武者”发动概率提升至100%，使目标战栗5秒；重复命中刷新时长并计数。
  - trigger=造成伤害；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"trembleDuration":[5,5,5,5],"trembleChance":[1,1,1,1]}；stacking=刷新时长，每次成功施加计数。；limits=只在本技能期间提升概率。

### 原生天赋计划
- “天生的武者”（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4116_blkkgt/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：造成伤害时有10%概率攻击力提升至130%/160%，并使目标战栗5秒。进击沿用概率强化与战栗施加。
  - scope=自身与目标；parameters={"prob":[0.1,0.1,0.1,0.1],"atkScale":[1.3,1.3,1.3,1.6],"trembleDuration":5}
- 活着的传奇（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4116_blkkgt/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：攻击被战栗的目标时无视其25%防御力。进击沿用以战栗为条件的破防。
  - scope=自身；parameters={"ignoreDefRatio":0.25}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击战栗扳机：造成伤害时有10%概率使目标战栗5秒，重复成功施加重复计数；已战栗目标再次被施加仍计一次。
  - trigger=自身造成伤害；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"trembleDuration":[5,5,5,5],"prob":[0.1,0.1,0.1,0.1]}；stacking=按成功施加次数计数，战栗不叠加层数。；limits=免疫战栗者不计。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：归于宁静10段每段200%×6目标、持续拖拽+结尾较大力度。
  - 被动：天生武者10%/130%战栗5秒；战栗破防25%。
- ★2（攻×1.55、生命×1.65）：每段210%。
  - 被动：天生武者10%/130%战栗5秒；战栗破防25%。
- ★3（攻×2.2、生命×2.6）：每段225%。
  - 被动：天生武者10%/130%战栗5秒；战栗破防25%。
- ★4（攻×3、生命×4）：每段235%。
  - 被动：天生武者10%/160%战栗5秒。

### 模组
- 默认模组：uniequip_002_blkkgt
- `uniequip_001_blkkgt`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_blkkgt`（ADVANCED/rewrite）：三星解锁：战栗目标被无视防御比例+5%；四星加强：归于宁静段数+2。
- `uniequip_003_blkkgt`（ADVANCED/rewrite）：三星解锁：斩击命中至少3名敌人时退返1点技力；四星加强：结尾拖拽力度+1级（提升一档）。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4116_blkkgt`
实现：复用 sword 剑卫与战栗状态；把 MANUAL 归于宁静改写为技力回满瞬发的多段斩击+拖拽。需新增 primitive：multi_slash(maxTarget,hits,scale)、continuous_pull_to_center、talent_prob_override_during_skill、tremble_on_damage；斩击特效复用原生。
因果检查：
- 战栗在技能期间100%施加，技能结束后恢复天赋10%概率；已战栗目标再次被施加仍各计一次成功施加。
- 拖拽与伤害分属两个事件，免疫位移的敌人只受伤不被拖拽；结尾大力度拖拽对同一目标只结算一次。

## 百炼嘉维尔（`char_1026_gvial2`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`blockCounter`
- 定位：群攻近卫·延迟伤害承伤
- 档位理由：八费的群攻承伤核心，把伤害延后结算以争取站场并随阻挡数增伤，落五档。
- 设计理由：以原生战地巨斧与医学背景为核心：技力回满立即提升攻击、攻速与阻挡数，并把部分受伤延后为生命流失，配合按阻挡数的增伤，保留群攻承伤特色。

### 固定技能：丛林之魂（进击）
- 来源技能：`skchr_gvial2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,22,19,16]；初始技力：11
- 自然技力回满时立即自动结算：提升攻击力、攻击速度与阻挡数，技能期间只承受部分伤害，其余伤害延后为持续生命流失。
- 效果1：25秒内攻击力+100%/120%/130%/140%、攻击速度+80/90/95/100、阻挡数+2。
  - trigger=技力自然回满时自动施放；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[1,1.2,1.3,1.4],"attackSpeedBonus":[80,90,95,100],"blockBonus":[2,2,2,2],"duration":[25,25,25,25]}；stacking=刷新时长，不叠加。；limits=每次施放刷新。
- 效果2：具名机制“延迟伤害”：技能期间仅立即承受50%伤害，其余50%延后为持续20秒、每0.1秒一跳的生命流失，技能结束时按剩余量继续结算。
  - trigger=技能期间自身受到伤害；target=自身；action=nativeMechanism；lifecycle=battle
  - values={"damageResistance":[0.5,0.5,0.5,0.5],"deferredRatio":[0.5,0.5,0.5,0.5],"finalDuration":[20,20,20,20],"interval":[0.1,0.1,0.1,0.1]}；stacking=多次受伤的延后量累加，不互相覆盖。；limits=延后伤害不致死时可延迟，致死时立即结算。

### 原生天赋计划
- 战地巨斧（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1026_gvial2/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：攻击力和防御力提升5%/10%，每再阻挡一个敌人提升3%/4%。进击沿用按阻挡数递增的攻防增益。
  - scope=自身；parameters={"baseAtkDef":[0.05,0.05,0.1,0.1],"perExtraBlock":[0.03,0.03,0.04,0.04]}
- 医学背景（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1026_gvial2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：受到的治疗效果提升20%，生命值低于一半时提升至40%。进击沿用受治疗增幅与低血提升。
  - scope=自身；parameters={"healTakenBonus":[0.2,0.2,0.2,0.2],"lowHpHealTaken":[0.4,0.4,0.4,0.4],"hpThreshold":0.5}；trigger=自身受到相关事件时；unlockStar=1

### 进击被动
- 被动0：进击阻挡扳机：按当前阻挡数实时给予攻击力与防御力增益，基础5%/10%并每多阻挡一个敌人额外+3%/4%，阻挡数下降即回落。
  - trigger=自身阻挡数变化；target=自身；action=addBuff；lifecycle=battle
  - values={"baseAtkDef":[0.05,0.1,0.1,0.1],"perExtraBlock":[0.03,0.04,0.04,0.04]}；stacking=按当前阻挡数计算，不做层数累加。；limits=按实时阻挡数判定。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：丛林之魂+100%攻/+80攻速/阻挡+2、仅受50%伤害并延后50%/20秒。
  - 被动：战地巨斧+5%/每多挡+3%；医学背景治疗+20/40%。
- ★2（攻×1.55、生命×1.65）：+120%/+90。
  - 被动：战地巨斧+10%/每多挡+4%；医学背景治疗+20/40%。
- ★3（攻×2.2、生命×2.6）：+130%/+95。
  - 被动：战地巨斧+10%/每多挡+4%。
- ★4（攻×3、生命×4）：+140%/+100。
  - 被动：战地巨斧+10%/每多挡+4%。

### 模组
- 默认模组：uniequip_002_gvial2
- `uniequip_001_gvial2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_gvial2`（ADVANCED/rewrite）：三星解锁：延迟伤害的延后比例+10%；四星加强：技能期间攻击力额外+10%。
- `uniequip_003_gvial2`（ADVANCED/rewrite）：三星解锁：阻挡数上限+1；四星加强：每多阻挡一个敌人的增伤额外+1%。
- `uniequip_004_gvial2`（ADVANCED/rewrite）：三星解锁：勇冠三军高血攻击额外+3%；四星加强：技能结束后清空50%未结算延迟伤害。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1026_gvial2`
实现：复用 centurion 群攻近卫与承伤管线；把 MANUAL 丛林之魂改写为技力回满瞬发。需新增 primitive：deferred_damage_buffer(resistance,ratio,finalDuration)、block_count_scaled_buff、heal_taken_bonus；延迟伤害与布尔基原生一致。
因果检查：
- 延迟伤害在技能结束后仍继续按剩余量结算，不会因技能结束而清空；多次受伤的延后量累加而非覆盖。
- 阻挡数下降时战地巨斧增益立即回落，回到高阻挡数重新计算，不保留高挡时的层数。

## 史尔特尔（`char_350_surtr`）
- 职业：WARRIOR；档位：6（12 金币）；路线：`element`
- 定位：法伤近卫·范围真伤核心
- 档位理由：十二费的顶级法伤核心，靠无视法抗的持续范围爆发清场，以一己之力改写战局，落六档。
- 设计理由：以原生熔火与黄昏为核心：技力回满立即回满生命、大幅提升攻击、范围与目标数并持续流失生命，保留无视法抗与自我熔毁特色，不做普通增伤单击。

### 固定技能：黄昏（进击）
- 来源技能：`skchr_surtr_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[30,26,22,18]；初始技力：14
- 自然技力回满时立即自动结算：立即回复全部生命，大幅提升攻击力、攻击距离、攻击目标数与生命上限，随后逐渐流失生命至每秒高比例。
- 效果1：立即回复自身全部生命。
  - trigger=技力自然回满时自动施放；target=自身；action=heal；lifecycle=instant
  - values={"healFull":[1,1,1,1]}；stacking=每次施放一次。；limits=每次施放一次。
- 效果2：持续期间攻击力+240%/280%/310%/330%、攻击距离+2、攻击目标数+3/3/4/4（含原目标）、生命上限+5000（按设计表固定值）。
  - trigger=黄昏结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[2.4,2.8,3.1,3.3],"rangeExtend":[2,2,2,2],"extraTargets":[2,2,3,3],"maxHpFixed":[5000,5000,5000,5000],"duration":[-1,-1,-1,-1]}；stacking=刷新时长，不叠加。；limits=持续时间无限直至技能结束或干员倒下。
- 效果3：逐渐流失生命，60秒后达到每秒最大生命20%的流失；流失不因治疗而停止。
  - trigger=黄昏持续期间；target=自身；action=applyStatus；lifecycle=battle
  - values={"hpLossPerSecRatio":[0.2,0.2,0.2,0.2],"rampSec":[60,60,60,60]}；stacking=按时间线性增长，不叠加。；limits=持续时间结束时流失立即停止。

### 原生天赋计划
- 熔火（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_350_surtr/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：无视攻击目标12/20法术抗性。进击沿用固定法抗穿透。
  - scope=自身攻击目标；parameters={"ignoreRes":[12,12,12,20]}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1
- 余烬（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_350_surtr/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：受到致命伤害时持续使生命值不低于1，4/8秒后强制退出战场。进击沿用濒死续航与强制退场。
  - scope=自身；parameters={"surviveSec":[4,4,4,8]}；trigger=自身受到相关事件时；unlockStar=1

### 进击被动
- 被动0：进击濒死扳机：每场战斗一次，受到致命伤害时生命保持不低于1持续4/8秒，之后强制退场。
  - trigger=自身受到致命伤害；target=自身；action=nativeMechanism；lifecycle=battle
  - values={"minHp":[1,1,1,1],"surviveSec":[4,4,4,8],"perBattle":[1,1,1,1]}；stacking=每场战斗一次，不叠加。；limits=明确为每战斗一次。

### 星级
- ★1（攻×1、生命×1）：黄昏回满生命、+240%攻/范围+2/目标+3/生命上限+5000、60秒后每秒流失20%。
  - 被动：熔火无视法抗12；余烬不死4秒。
- ★2（攻×1.55、生命×1.65）：+280%攻。
  - 被动：熔火无视法抗12；余烬不死4秒。
- ★3（攻×2.2、生命×2.6）：+310%攻/目标+4。
  - 被动：熔火无视法抗20；余烬不死8秒。
- ★4（攻×3、生命×4）：+330%攻/目标+4。
  - 被动：熔火无视法抗20；余烬不死8秒。

### 模组
- 默认模组：uniequip_002_surtr
- `uniequip_001_surtr`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_surtr`（ADVANCED/rewrite）：三星解锁：熔火无视法抗+5；四星加强：黄昏生命流失达到上限的时间延长至90秒。
- `uniequip_003_surtr`（ADVANCED/rewrite）：三星解锁：余烬濒死期间攻击力+20%；四星加强：强制退场后返还20点技力。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_350_surtr`
实现：复用 artsfghter 法伤近卫与法抗穿透；把 MANUAL 黄昏改写为技力回满自动施放。需新增 primitive：self_lifesteal_ramp(hpRatio,rampSec)、multi_target_plus(extraTargets)、maxhp_fixed_buff、fatal_to_indestructible(sec)。黄昏特效复用原生。
因果检查：
- 生命上限+5000同步当前生命，避免提升后治疗失效；增益结束按比例回落且不致死。
- 余烬每场战斗只触发一次，濒死期间覆盖范围内仍可输出；强制退场后不再触发余烬。

## 维娜·维多利亚（`char_1019_siege2`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`summon`
- 定位：法伤近卫·真实伤害召唤核心
- 档位理由：八费的真实伤害核心，召唤黄金盟誓并让范围内的攻击附加真实伤害，兼具团队防护，落五档。
- 设计理由：以原生诸王的叹息与俱以我之名为核心：技力回满立即召唤具名“黄金盟誓”，扩大攻击并让攻击转为真实伤害，保留随友军数量增伤与首次伤害战栗的特色。

### 固定技能：俱以我之名（进击）
- 来源技能：`skchr_siege2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[24,22,19,16]；初始技力：12
- 自然技力回满时立即自动结算：在可部署地面召唤具名“黄金盟誓”，提升攻击力与攻击目标数、缩短攻击间隔，攻击时伤害类型转为真实。
- 效果1：在周围四邻可部署地面召唤具名“黄金盟誓”，持续25秒，场上同时最多1个，新召唤替换旧召唤物。
  - trigger=技力自然回满时自动施放；target=周围四邻可部署地面；action=summon；lifecycle=battle
  - values={"summonName":["黄金盟誓","黄金盟誓","黄金盟誓","黄金盟誓"],"summonCount":[1,1,1,1],"duration":[25,25,25,25]}；stacking=同名召唤物替换而非并存。；limits=每次施放最多1个。
- 效果2：25秒内攻击力+160%/175%/190%/190%、攻击目标数+2/2/3/3、攻击间隔缩短0.25秒，攻击伤害类型变为真实，并可攻击被天赋范围内友方阻挡的敌人。
  - trigger=俱以我之名结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[1.6,1.75,1.9,1.9],"extraTargets":[2,2,3,3],"attackIntervalDelta":[-0.25,-0.25,-0.25,-0.25],"damageTypeOverride":["真实","真实","真实","真实"],"duration":[25,25,25,25]}；stacking=刷新时长，不叠加。；limits=每次施放刷新。

### 原生天赋计划
- 诸王的叹息（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1019_siege2/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：自身与周围8格友方单位受到的物理伤害减少12%/20%，且此范围内每有一名友方单位使维娜攻击力+3%/5%。进击沿用范围减伤与按友军数增伤。
  - scope=自身与周围八邻；parameters={"physReduction":[0.12,0.12,0.2,0.2],"atkPerAlly":[0.03,0.03,0.05,0.05]}；trigger=自身受到相关事件时；unlockStar=1
- 无拘的锋芒（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1019_siege2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：对每个敌人首次造成伤害时使其战栗4秒。进击沿用每敌人首次伤害施加战栗（每敌人一次）。
  - scope=被首次命中的敌人；parameters={"trembleDuration":4,"perEnemy":1}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击首伤扳机：对每个敌人首次造成伤害时使其战栗4秒，同一敌人整场只触发一次。
  - trigger=对每个敌人首次造成伤害；target=该敌人；action=applyStatus；lifecycle=battle
  - values={"trembleDuration":[4,4,4,4],"perEnemy":[1,1,1,1]}；stacking=每敌人一次，不重复。；limits=明确为每敌人一次。

### 星级
- ★1（攻×1、生命×1）：俱以我之名召唤黄金盟誓、+160%攻/目标+2/真伤/25秒。
  - 被动：诸王减伤12%、每友军+3%攻；首次伤害战栗4秒。
- ★2（攻×1.55、生命×1.65）：+175%攻。
  - 被动：诸王减伤12%、每友军+3%攻；首次伤害战栗4秒。
- ★3（攻×2.2、生命×2.6）：+190%攻/目标+3。
  - 被动：诸王减伤20%、每友军+5%攻。
- ★4（攻×3、生命×4）：+190%攻/目标+3。
  - 被动：诸王减伤20%、每友军+5%攻。

### 模组
- 默认模组：uniequip_002_siege2
- `uniequip_001_siege2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_siege2`（ADVANCED/rewrite）：三星解锁：召唤物“黄金盟誓”持续+5秒；四星加强：真伤期间攻击力额外+10%。
- `uniequip_003_siege2`（ADVANCED/rewrite）：三星解锁：诸王范围减伤+5%；四星加强：范围内每名友军攻击增伤+1%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1019_siege2`
实现：复用 artsfghter 近卫与召唤/真伤；把 MANUAL 俱以我之名改写为技力回满瞬发。需新增 primitive：summon_named_token(黄金盟誓)、damage_type_override(真实)、attack_target_plus、first_damage_tremble_per_enemy；召唤物资源复用原生黄金盟誓。
因果检查：
- 同一敌人只触发一次首次伤害战栗，之后再次命中不重复；新敌人生成后再首次命中可再次触发。
- 召唤物同时最多1个，替换旧召唤物时旧的不触发退场伤害类事件；真伤覆盖期间远程攻击也不降低伤害。

## 赫拉格（`char_188_helage`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`pierceCrit`
- 定位：绝食近卫·低血多目标
- 档位理由：六费的绝食近卫，未阻挡时自动回血、低血时攻速暴涨，多目标输出稳定，落四档。
- 设计理由：以原生月盈星亏与运筹帷幄为核心：技力回满立即扩大范围并同时对至多3个目标输出，低血时攻速触发提升，保留绝食自愈与低血爆发特色。

### 固定技能：满月（进击）
- 来源技能：`skchr_helage_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[20,18,15,13]；初始技力：8
- 自然技力回满时立即自动结算：提升攻击力、攻击范围并同时对至多3个目标造成物理伤害，若自身生命低于阈值则额外获得攻速。
- 效果1：对至多3个目标造成攻击力70%/80%/90%/100%的物理伤害，攻击距离+1格（四星+2格）。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多3个目标；action=damage；lifecycle=instant
  - values={"atkScale":[0.7,0.8,0.9,1],"maxTarget":[3,3,3,3],"rangeExtend":[1,1,1,2],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：15秒内自身攻击力+50%/60%/70%/80%并保持多目标攻击。
  - trigger=满月结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[0.5,0.6,0.7,0.8],"duration":[15,15,15,15]}；stacking=刷新时长。；limits=每次施放刷新。
- 效果3：生命低于50%时额外获得攻击速度+30/40/50/60，持续10秒。
  - trigger=施放时自身生命低于50%；target=自身；action=haste；lifecycle=battle
  - values={"attackSpeedBonus":[30,40,50,60],"duration":[10,10,10,10]}；stacking=与低血天赋线性相加，不乘算。；limits=每次施放最多触发一次。

### 原生天赋计划
- 月盈星亏（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_188_helage/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：在场时自身获得最高+50/75/100攻击速度的坚忍，损失50%/60%/70%生命时达到最大加成。进击随损失生命线性给予攻速。
  - scope=自身；parameters={"maxAttackSpeed":[50,50,75,100],"lossThreshold":[0.5,0.5,0.6,0.7]}；trigger=被动常驻；unlockStar=1
- 运筹帷幄（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_188_helage/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：未阻挡敌人时每秒回复60生命。进击沿用未阻挡自愈。
  - scope=自身；parameters={"healPerSec":60}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击未阻挡扳机：未阻挡敌人时每秒回复60生命，一旦阻挡立即停止。
  - trigger=自身当前未阻挡任何敌人；target=自身；action=heal；lifecycle=battle
  - values={"healPerSec":[60,60,60,60]}；stacking=按秒结算一次。；limits=按当前阻挡状态实时判定。

### 星级
- ★1（攻×1、生命×1）：满月3目标70%物理、范围+1、自身+50%攻；低血+30攻速。
  - 被动：坚忍最高+50攻速；未阻挡回60/秒。
- ★2（攻×1.55、生命×1.65）：80%、+60%攻；低血+40。
  - 被动：坚忍最高+50攻速；未阻挡回60/秒。
- ★3（攻×2.2、生命×2.6）：90%、+70%攻；低血+50。
  - 被动：坚忍最高+75攻速（损失60%生命）。
- ★4（攻×3、生命×4）：100%、范围+2、+80%攻；低血+60。
  - 被动：坚忍最高+100攻速（损失70%生命）。

### 模组
- 默认模组：uniequip_002_helage
- `uniequip_001_helage`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_helage`（ADVANCED/rewrite）：三星解锁：满月目标数+1；四星加强：低血攻速额外+10。
- `uniequip_003_helage`（ADVANCED/rewrite）：三星解锁：未阻挡回血+20/秒；四星加强：坚忍达到最大加成所需损失生命降低10%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_188_helage`
实现：复用 musha 绝食近卫与损失生命事件；把 MANUAL 满月改写为技力回满瞬发。需新增 primitive：multi_target_damage(maxTarget)、range_extend_buff、low_hp_haste(threshold,bonus)、unblocked_regen；满月特效复用原生。
因果检查：
- 坚忍攻速随损失生命线性变化，回到阈值以上立即回落，不是一次性永久加成。
- 未阻挡回血在阻挡时立即停止，解除阻挡后恢复，验证按实时阻挡状态。

## 耀骑士临光（`char_1014_nearl2`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`summon`
- 定位：无畏近卫·真实伤害召唤核心
- 档位理由：八费的真实伤害核心，落地真伤晕眩并召唤耀阳协同，兼具范围承伤，落五档。
- 设计理由：以原生不畏苦暗与耀阳颔首为核心：技力回满立即在四邻召唤具名“耀阳”并对周围敌人造成真实伤害与晕眩，自身获得攻防并让阻挡目标承受真伤，保留落地爆发特色。

### 固定技能：耀阳颔首（进击）
- 来源技能：`skchr_nearl2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[22,20,17,14]；初始技力：11
- 自然技力回满时立即自动结算：在周围四邻可部署地面召唤具名“耀阳”，对周围敌人造成真实伤害并晕眩；自身提升攻击与防御，攻击自身与耀阳阻挡的单位时转为真实伤害。
- 效果1：在周围四邻可部署地面召唤具名“耀阳”，持续25秒，场上同时最多1个。
  - trigger=技力自然回满时自动施放；target=周围四邻可部署地面；action=summon；lifecycle=battle
  - values={"summonName":["耀阳","耀阳","耀阳","耀阳"],"summonCount":[1,1,1,1],"duration":[25,25,25,25]}；stacking=同名召唤物替换而非并存。；limits=每次施放最多1个。
- 效果2：对耀阳周围八格内敌人造成相当于耀骑士临光攻击力100%/105%/110%/110%的真实伤害。
  - trigger=耀阳出现；target=耀阳周围敌人；action=damage；lifecycle=instant
  - values={"atkScale":[1,1.05,1.1,1.1],"radius":[1,1,1,1],"damageType":["真实","真实","真实","真实"]}；stacking=逐目标结算。；limits=每次召唤一次。
- 效果3：使命中目标晕眩3秒。
  - trigger=耀阳出现；target=被命中敌人；action=applyStatus；lifecycle=battle
  - values={"stunDuration":[3,3,3,3]}；stacking=刷新时长，每次成功施加计数。；limits=免疫晕眩者不计。
- 效果4：25秒内攻击力+100%/120%/130%/140%、防御力+70%/85%/100%/100%、范围扩大，攻击自身与耀阳阻挡的单位时伤害类型变为真实。
  - trigger=耀阳颔首结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[1,1.2,1.3,1.4],"defBonus":[0.7,0.85,1,1],"rangeExtend":[1,1,1,1],"blockedTrueDamage":[1,1,1,1],"duration":[25,25,25,25]}；stacking=刷新时长，不叠加。；limits=每次施放刷新。

### 原生天赋计划
- 不畏苦暗（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1014_nearl2/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：部署时对周围四格敌人造成50%/80%攻击力真实伤害并晕眩2/3秒，上一名部署干员势力为卡西米尔时额外造成一次伤害。进击沿用落地真伤晕眩与卡西米尔追加。
  - scope=周围四邻；parameters={"atkScale":[0.5,0.5,0.8,0.8],"stun":[2,2,3,3],"kazimierzExtra":[1,1,1,1]}
- 破晓（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1014_nearl2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：攻击无视敌人20%防御力。进击沿用固定比例破防。
  - scope=自身攻击目标；parameters={"ignoreDefRatio":0.2}；trigger=原生天赋触发（按 sourcePointer 原生天赋）；unlockStar=1

### 进击被动
- 被动0：进击部署扳机：每次部署后对周围四邻敌人造成真实伤害与晕眩；上一名部署干员为卡西米尔时额外一次，重复部署重复计数。
  - trigger=自身完成一次部署；target=周围四邻敌人；action=damage；lifecycle=instant
  - values={"atkScale":[0.5,0.5,0.8,0.8],"radius":[1,1,1,1],"damageType":["真实","真实","真实","真实"],"kazimierzExtra":[1,1,1,1]}；stacking=每次部署独立结算。；limits=仅真实部署触发，移位不算。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：耀阳颔首召唤耀阳、真伤100%/晕3秒、自身+100%攻/+70%防/真伤对阻挡。
  - 被动：不畏苦暗落地50%真伤晕2秒；破晓无视20%防。
- ★2（攻×1.55、生命×1.65）：+120%攻/+85%防。
  - 被动：不畏苦暗落地50%真伤晕2秒；破晓无视20%防。
- ★3（攻×2.2、生命×2.6）：+130%攻/+100%防。
  - 被动：不畏苦暗落地80%真伤晕3秒。
- ★4（攻×3、生命×4）：+140%攻。
  - 被动：不畏苦暗落地80%真伤晕3秒。

### 模组
- 默认模组：uniequip_002_nearl2
- `uniequip_001_nearl2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_nearl2`（ADVANCED/rewrite）：三星解锁：耀阳出现真伤+10%；四星加强：耀阳持续时间+5秒。
- `uniequip_003_nearl2`（ADVANCED/rewrite）：三星解锁：卡西米尔追加伤害+10%；四星加强：卡西米尔追加伤害翻倍（×2），仅一次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1014_nearl2`
实现：复用 fearless 近卫与部署事件；把 MANUAL 耀阳颔首改写为技力回满瞬发召唤。需新增 primitive：summon_named_token(耀阳)、on_deploy_adjacent_true_damage(radius)、blocked_targets_true_damage、kazimierz_previous_deploy_check；耀阳资源复用原生。
因果检查：
- 耀阳同时最多1个，替换旧耀阳时旧的不结算落地真伤；自身落地真伤与耀阳落地真伤是两个不同来源，各自结算。
- 卡西米尔追加只在上一名部署干员势力为卡西米尔时触发，来源按最近一次真实部署判定，移位不改变记录。

## 圣约送葬人（`char_1032_excu2`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`ammo`
- 定位：收割近卫·弹药穿透核心
- 档位理由：六费的弹药输出核心，按消耗弹药逐发叠加攻击并附带固定破防，持续输出高，落四档。
- 设计理由：以原生受选之人与圣约决裁为核心：技力回满即装填弹药并持续攻击，每消耗一枚弹药叠加攻击、强化吸血，结束时对攻击过的目标追加伤害，保留弹药与固定破防特色。

### 固定技能：圣约决裁（进击）
- 来源技能：`skchr_excu2_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[20,18,15,13]；初始技力：9
- 自然技力回满时立即自动结算：装入16发弹药并持续攻击，每消耗一枚弹药攻击力额外提升（可叠至30层），特性回复生命提高，弹药打空后对攻击过的目标追加一次物理伤害。
- 效果1：装入16发弹药，攻击间隔略微增大，每次攻击造成攻击力150%/160%/170%/180%的物理伤害；特性的回复生命效果提高至2/2/3/3倍。
  - trigger=技力自然回满时自动施放；target=攻击范围内敌人；action=ammo；lifecycle=battle
  - values={"ammoCount":[16,16,16,16],"atkScale":[1.5,1.6,1.7,1.8],"baseAttackTimeDelta":[0.5,0.5,0.5,0.5],"traitHealMultiplier":[2,2,3,3],"damageType":["物理","物理","物理","物理"]}；stacking=新施放重置弹药为16发，不累加。；limits=打空弹药结束技能。
- 效果2：每消耗一枚弹药自身攻击力额外+5%/5%/6%/6%，最多叠加30层，技能结束时重置。
  - trigger=每消耗一枚弹药；target=自身；action=growth；lifecycle=battle
  - values={"atkPerAmmo":[0.05,0.05,0.06,0.06],"maxStacks":[30,30,30,30]}；stacking=按消耗弹药数线性叠加，达上限停止。；limits=技能结束时清空层数。
- 效果3：对技能期间攻击过的每个目标造成攻击力200%/220%/240%/250%的物理伤害，并固定无视280/320/360/400防御。
  - trigger=弹药打空时；target=技能期间攻击过的目标；action=damage；lifecycle=instant
  - values={"finalAtkScale":[2,2.2,2.4,2.5],"ignoreDefFixed":[280,320,360,400],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算一次。；limits=每个被攻击过的目标最多一次。

### 原生天赋计划
- 受选之人（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1032_excu2/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击时有10%/20%几率额外攻击一次，技能期间每消耗1颗弹药该几率提升3%/5%，技能结束时重置。进击沿用弹药驱动的额外攻击概率。
  - scope=自身；parameters={"baseProb":[0.1,0.1,0.2,0.2],"probPerAmmo":[0.03,0.03,0.05,0.05],"resetOnSkillEnd":1}；trigger=普通攻击时；unlockStar=1
- 铳弹共感（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_1032_excu2/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：每有一名拉特兰干员在场，自身弹药类技能弹药上限+1（最多4层）。进击沿用该阵营联动，不虚构无弹药干员的消耗。
  - scope=自身弹药；parameters={"perLaterano":1,"maxStacks":4}；trigger=技能/技力事件时；unlockStar=1

### 进击被动
- 被动0：进击弹药扳机：每消耗1枚弹药额外攻击概率+3%/5%（叠加），技能结束时重置为0；重复消耗重复计数。
  - trigger=技能期间消耗一枚弹药；target=自身；action=addBuff；lifecycle=battle
  - values={"extraAttackProb":[0.03,0.03,0.05,0.05],"maxStacks":[30,30,30,30]}；stacking=按消耗弹药数叠加，技能结束重置。；limits=只统计真实消耗的弹药。

### 星级
- ★1（攻×1、生命×1）：圣约决裁16发、每发150%物理、吸血×2、每弹药+5%攻×30、结束追加200%固定破防280。
  - 被动：受选之人10%额外攻击、每弹药+3%；铳弹共感每拉特兰+1弹药。
- ★2（攻×1.55、生命×1.65）：160%、追加220%/破防320。
  - 被动：受选之人10%额外攻击、每弹药+3%；铳弹共感每拉特兰+1弹药。
- ★3（攻×2.2、生命×2.6）：170%、吸血×3、每弹药+6%、追加240%/破防360。
  - 被动：受选之人20%、每弹药+5%。
- ★4（攻×3、生命×4）：180%、追加250%/破防400。
  - 被动：受选之人20%、每弹药+5%。

### 模组
- 默认模组：uniequip_002_excu2
- `uniequip_001_excu2`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_excu2`（ADVANCED/rewrite）：三星解锁：弹药上限+2；四星加强：结束时追加伤害的目标数上限+2。
- `uniequip_003_excu2`（ADVANCED/rewrite）：三星解锁：每弹攻击叠加上限+5；四星加强：特性回复生命倍率额外+1。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_1032_excu2`
实现：复用 reaper 收割近卫与弹药系统；把 MANUAL 圣约决裁改写为技力回满自动装填。需新增 primitive：ammo_state(count,atkScale,traitHealMultiplier)、on_ammo_consumed_growth、ammo_empty_final_damage(attackedTargets)、fixed_def_penetrate；弹药表现复用原生。
因果检查：
- 每消耗一枚弹药叠加攻击并计数，达到30层后继续消耗不再增加层数；技能结束时层数清零。
- 结束时追加伤害只对技能期间实际攻击过的目标结算一次，未被命中的敌人不受影响。

## 隐德来希（`char_4010_etlchi`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`summon`
- 定位：收割近卫·偷取生命与心烛召唤
- 档位理由：六费的召唤型收割者，把高生命目标转化为心烛并借其偷取生命，机制独特，落四档。
- 设计理由：以原生萃血与灵与欲的惜别为核心：技力回满立即为高生命地面敌人召唤具名心烛并提升攻击攻速，攻击心烛即为攻击本体，保留偷取生命与召唤特色。

### 固定技能：灵与欲的惜别（进击）
- 来源技能：`skchr_etlchi_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[20,18,15,13]；初始技力：10
- 自然技力回满时立即自动结算：扩大攻击范围、提升攻击力与攻击速度，立即为攻击范围内生命值最高的至多3名地面敌人召唤对应心烛，攻击心烛即对本体结算。
- 效果1：为至多3名生命值最高的地面敌人各召唤对应“心烛”，心烛继承原敌人当前生命的60%，持续20秒；攻击心烛对本体结算同等生命流失。
  - trigger=技力自然回满时自动施放；target=攻击范围内生命最高的至多3名地面敌人；action=summon；lifecycle=battle
  - values={"summonName":["心烛","心烛","心烛","心烛"],"maxTarget":[3,3,3,3],"hpScale":[0.6,0.6,0.6,0.6],"duration":[20,20,20,20]}；stacking=每个敌人一个心烛，独立存在。；limits=仅对地面敌人生效。
- 效果2：20秒内攻击力+110%/120%/130%/135%、攻击速度+100、攻击范围扩大。
  - trigger=灵与欲的惜别结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[1.1,1.2,1.3,1.35],"attackSpeedBonus":[100,100,100,100],"rangeExtend":[1,1,1,1],"duration":[20,20,20,20]}；stacking=刷新时长，不叠加。；limits=每次施放刷新。
- 效果3：每次攻击对心烛至少造成35%攻击力的伤害，心烛受击时原敌人流失同等生命值。
  - trigger=攻击心烛；target=心烛；action=damage；lifecycle=instant
  - values={"minAtkScale":[0.35,0.35,0.35,0.35],"damageType":["物理","物理","物理","物理"]}；stacking=每次攻击结算一次。；limits=心烛只受隐德来希攻击影响。

### 原生天赋计划
- 萃血（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4010_etlchi/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：每次攻击敌人时偷取目标50/75点生命上限（最高900/1350）并使目标每秒受100/200点法术伤害持续5秒。进击沿用偷取与持续伤害。
  - scope=被攻击敌人；parameters={"stealHp":[50,50,50,75],"stealCap":[900,900,900,1350],"dotPerSec":[100,100,100,200],"dotDuration":5}
- 重盈（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4010_etlchi/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：生命值低于25%时，仅一次立刻回复50%最大生命，且之后受到的物理伤害降低10%。进击沿用一次保命与后续物理减伤。
  - scope=自身；parameters={"healRatio":0.5,"physReduction":0.1,"hpThreshold":0.25,"perBattle":1}；trigger=自身受到相关事件时；unlockStar=1
- 隐蔽天赋槽2（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4010_etlchi/talents/2`）：mode=retain；runtimeBinding=none
  - 原生无效果的空天赋槽位，进击保留为空，不产生机制。
  - scope=无；parameters={}

### 进击被动
- 被动0：进击偷取扳机：每次攻击偷取目标50/75生命上限并使其每秒受100/200点法术伤害持续5秒，重复命中刷新持续伤害并重复计数。
  - trigger=自身攻击命中敌人；target=被命中敌人；action=nativeMechanism；lifecycle=battle
  - values={"stealHp":[50,50,50,75],"stealCap":[900,900,900,1350],"dotPerSec":[100,100,100,200],"dotDuration":[5,5,5,5]}；stacking=偷取按上限封顶；持续伤害刷新时长不叠加数值。；limits=偷取量以当前可偷上限封顶，已达上限不再偷取但仍施加持续伤害。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：惜别3心烛继承60%生命、自身+110%攻/+100攻速/20秒、心烛至少受35%攻。
  - 被动：萃血偷50/持续100；重盈一次回50%并减物伤10%。
- ★2（攻×1.55、生命×1.65）：+120%攻。
  - 被动：萃血偷50/持续100；重盈一次回50%并减物伤10%。
- ★3（攻×2.2、生命×2.6）：+130%攻。
  - 被动：萃血偷50/持续100；重盈一次回50%并减物伤10%。
- ★4（攻×3、生命×4）：+135%攻。
  - 被动：萃血偷75/持续200；心烛消散追加40%攻。

### 模组
- 默认模组：uniequip_002_etlchi
- `uniequip_001_etlchi`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_etlchi`（ADVANCED/rewrite）：三星解锁：心烛继承生命比例+10%；四星加强：偷取生命上限+200。
- `uniequip_003_etlchi`（ADVANCED/rewrite）：三星解锁：心烛持续时间+5秒；四星加强：攻击心烛时额外偷取生命+1次。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4010_etlchi`
实现：复用 reaper 收割近卫与召唤/偷取；把 MANUAL 灵与欲的惜别改写为技力回满瞬发召唤心烛。需新增 primitive：summon_shadow_candle(linkedEnemy,hpScale)、damage_shadow_linked_to_original、steal_max_hp_up_to_cap、dot_on_hit；心烛资源新建并按原生血镰表现。
因果检查：
- 攻击心烛使原敌人流失同等生命，心烛只受隐德来希攻击影响；其他来源不改变心烛生命。
- 偷取生命上限达到封顶后继续命中不再偷取，但持续伤害仍照常施加并刷新。

## 玛恩纳（`char_4064_mlynar`）
- 职业：WARRIOR；档位：5（8 金币）；路线：`pierceCrit`
- 定位：解放者·反击真实伤害核心
- 档位理由：八费的解放者核心，靠受击反伤与超大范围多目标真伤压制，是阵地核心，落五档。
- 设计理由：以原生游侠与无动于衷为核心：技力回满立即扩大范围、提升特性倍率并对多个目标造成物理伤害，同时让范围内卡西米尔干员的攻击附带真实伤害，保留受击反伤特色。

### 固定技能：未照耀的荣光（进击）
- 来源技能：`skchr_mlynar_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[26,23,20,17]；初始技力：12
- 自然技力回满时立即自动结算：扩大攻击范围、特性倍率提升至2倍，对至多5个目标造成物理伤害，并使范围内敌人受到卡西米尔干员攻击时额外附带真实伤害。
- 效果1：对至多5个目标造成攻击力150%/160%/170%/180%的物理伤害，攻击范围扩大。
  - trigger=技力自然回满时自动施放；target=攻击范围内至多5个目标；action=damage；lifecycle=instant
  - values={"atkScale":[1.5,1.6,1.7,1.8],"maxTarget":[5,5,5,5],"rangeExtend":[1,1,1,1],"damageType":["物理","物理","物理","物理"]}；stacking=逐目标结算。；limits=仅命中施放瞬间在范围内的敌人。
- 效果2：范围内敌人受到卡西米尔干员攻击时额外附带玛恩纳攻击力11%/11.5%/12%/12%的真实伤害。
  - trigger=未照耀的荣光持续期间；target=范围内被卡西米尔干员攻击的敌人；action=damage；lifecycle=battle
  - values={"extraTrueAtkScale":[0.11,0.115,0.12,0.12],"damageType":["真实","真实","真实","真实"]}；stacking=每次被卡西米尔干员攻击结算一次。；limits=仅对范围内敌人生效。
- 效果3：28秒内特性倍率提升至2倍（每击倒一名敌人特性倍率降低10%）、更易被攻击、攻击范围内敌人对自身伤害降低10%/15%。
  - trigger=未照耀的荣光结算后；target=自身；action=addBuff；lifecycle=battle
  - values={"traitMultiplier":[2,2,2,2],"targetedMoreLikely":[1,1,1,1],"damageReduction":[0.1,0.1,0.15,0.15],"duration":[28,28,28,28]}；stacking=刷新时长，不叠加。；limits=每击倒一名敌人特性倍率递减，最低降至1倍。

### 原生天赋计划
- 游侠（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4064_mlynar/talents/0`）：mode=retain；runtimeBinding=assaultTalent:native_talent_0；stableKey=native_talent_0
  - 保留原生：攻击敌人时攻击力提升至105%/110%，周围存在3名及以上敌人时提升至110%/115%且受到伤害减少10%/15%。进击沿用条件增伤与减伤。
  - scope=自身；parameters={"baseAtkScale":[1.05,1.05,1.1,1.1],"crowdAtkScale":[1.1,1.1,1.15,1.15],"crowdThreshold":3,"damageReduction":[0.1,0.1,0.15,0.15]}；trigger=自身受到相关事件时；unlockStar=1
- 无动于衷（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_4064_mlynar/talents/1`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：在场时自身更容易受到攻击，所有卡西米尔干员被攻击时反弹相当于玛恩纳攻击力15%的真实伤害。进击沿用受击反伤与更易被选为目标。
  - scope=自身与卡西米尔干员；parameters={"tauntIncrease":1,"reflectAtkScale":[0.15,0.15,0.15,0.15]}

### 进击被动
- 被动0：进击反伤扳机：任意卡西米尔干员被攻击时，攻击者受到玛恩纳攻击力15%的真实伤害，重复受击重复计数。
  - trigger=卡西米尔干员被攻击；target=该攻击者；action=damage；lifecycle=instant
  - values={"reflectAtkScale":[0.15,0.15,0.15,0.15],"damageType":["真实","真实","真实","真实"]}；stacking=按受击事件逐次结算。；limits=只对真实攻击者结算。；replacesTalentIndices=[1]

### 星级
- ★1（攻×1、生命×1）：未照耀的荣光5目标150%物理、范围扩大、卡西米尔攻击附带11%真伤、特性2倍/28秒。
  - 被动：游侠105/110%；反伤15%真伤。
- ★2（攻×1.55、生命×1.65）：160%、真伤11.5%。
  - 被动：游侠105/110%；反伤15%真伤。
- ★3（攻×2.2、生命×2.6）：170%、真伤12%、范围减伤15%。
  - 被动：游侠110/115%。
- ★4（攻×3、生命×4）：180%、真伤12%。
  - 被动：游侠110/115%。

### 模组
- 默认模组：uniequip_002_mlynar
- `uniequip_001_mlynar`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_mlynar`（ADVANCED/rewrite）：三星解锁：卡西米尔附带真伤+3%；四星加强：特性倍率不再因击杀下降（下降幅度0）。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_4064_mlynar`
实现：复用 librator 解放者特性与反伤；把 MANUAL 未照耀的荣光改写为技力回满瞬发。需新增 primitive：trait_multiplier_buff、crowd_damage_reduction、kazimierz_ally_attack_true_extra、taunt_increase、on_kazimierz_hit_reflect；真伤与反伤复用原生。
因果检查：
- 范围内敌方受到卡西米尔干员攻击时逐次附加真伤，玛恩纳自己也是卡西米尔干员时其攻击同样触发；同一攻击对同一敌人只附加一次。
- 特性倍率每击倒一名敌人降低10%，多个敌人被同时击倒按击杀事件分别递减，最低到1倍。

## 斯卡蒂（`char_263_skadi`）
- 职业：WARRIOR；档位：4（6 金币）；路线：`skillCycle`
- 定位：无畏近卫·攻防生命三围核心
- 档位理由：六费的三围核心，靠同时提升攻击、防御与生命上限成为稳定前排兼输出，落四档。
- 设计理由：以原生深海掠食者与涌潮悲歌为核心：技力回满立即同时提升攻击、防御与生命上限，保留深海猎人编队增攻与快速再部署特色。

### 固定技能：涌潮悲歌（进击）
- 来源技能：`skchr_skadi_3`（index 2）；类型：instant；自然回复：1/秒
- 技力：[26,23,20,17]；初始技力：16
- 自然技力回满时立即自动结算：同时提升攻击力、防御力与生命上限，并使生命上限增益同步当前生命，持续50秒。
- 效果1：50秒内攻击力、防御力与生命上限各+100%/115%/130%/130%，生命上限提升同步当前生命。
  - trigger=技力自然回满时自动施放；target=自身；action=addBuff；lifecycle=battle
  - values={"atkBonus":[1,1.15,1.3,1.3],"defBonus":[1,1.15,1.3,1.3],"maxHpBonus":[1,1.15,1.3,1.3],"duration":[50,50,50,50]}；stacking=刷新时长，不叠加。；limits=每次施放刷新，增益结束按比例回落且不致死。

### 原生天赋计划
- 深海掠食者（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_263_skadi/talents/0`）：mode=retain；runtimeBinding=modePassive:0
  - 保留原生：编入队伍时所有深海猎人干员攻击力+7%/+14%。进击沿用该编入队伍阵营被动，不发明全队人数羁绊。
  - scope=编入队伍的深海猎人；parameters={"atkBonus":[0.07,0.07,0.14,0.14]}
- 迅捷出击（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json#/char_263_skadi/talents/1`）：mode=retain；runtimeBinding=assaultTalent:native_talent_1；stableKey=native_talent_1
  - 保留原生：自身再部署时间-10秒。进击沿用个人再部署缩短。
  - scope=自身；parameters={"redeployReduceSec":-10}；trigger=部署/再部署后；unlockStar=1

### 进击被动
- 被动0：进击编入队伍被动：斯卡蒂在队伍中时所有深海猎人干员攻击力+7%/14%，只由斯卡蒂一个来源提供，不与其它同源叠加。
  - trigger=编入队伍；target=深海猎人干员；action=addBuff；lifecycle=run
  - values={"atkBonus":[0.07,0.07,0.14,0.14]}；stacking=同源只取一次。；limits=整局生效。；replacesTalentIndices=[0]

### 星级
- ★1（攻×1、生命×1）：涌潮悲歌攻/防/生命上限各+100%/50秒。
  - 被动：深海+7%攻；再部署-10秒。
- ★2（攻×1.55、生命×1.65）：各+115%。
  - 被动：深海+7%攻；再部署-10秒。
- ★3（攻×2.2、生命×2.6）：各+130%。
  - 被动：深海+14%攻。
- ★4（攻×3、生命×4）：各+130%。
  - 被动：深海+14%攻。

### 模组
- 默认模组：uniequip_002_skadi
- `uniequip_001_skadi`（INITIAL/disabled）：禁用：不装入战斗，仅登记来源。
- `uniequip_002_skadi`（ADVANCED/rewrite）：三星解锁：涌潮悲歌持续时间+10秒；四星加强：生命上限增益额外+10%。
- `uniequip_003_skadi`（ADVANCED/rewrite）：三星解锁：再部署时间再-5秒；四星加强：深海掠食者攻击加成+3%。

来源：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json` → `/char_263_skadi`
实现：复用 fearless 近卫与深海猎人标签；把 MANUAL 涌潮悲歌改写为技力回满瞬发。需新增 primitive：triple_stat_buff(atk,def,maxhp)、maxhp_buff_sync_heal、abyssal_hunter_aura、personal_redeploy_reduce；涌潮特效复用原生。
因果检查：
- 生命上限增益同步提升当前生命，避免提升后治疗失效；增益结束按比例回落且不致死。
- 深海猎人增攻只由斯卡蒂一个来源提供，编入两名同源单位不叠加；再部署缩短只作用于自身。



## 当前源增量：克莱门莎（`char_4231_clemnt`）

WARRIOR／本源近卫，近战部署，价格8金币，可阻挡2名敌人并造成元素伤害。战技“与海为敌”技力回满启动10发弹药窗口：原生3-2范围内普攻最多3名地面敌人，造成200/220/230/235%攻击力物理伤害并附加20%物理侵蚀损伤；敌方侵蚀爆发时消耗1发，在爆发格与四邻地面目标各结算3次270/280/290/300%攻击力物理伤害及200/210/230/250%攻击力元素伤害。天赋另提供概率物理增幅与前方物理/法术减伤。来源：`data/assault-rules/assault-runtime.json#/operators/char_4231_clemnt`、`data/assault-rules/assault-public-text.json#/operators/char_4231_clemnt`。