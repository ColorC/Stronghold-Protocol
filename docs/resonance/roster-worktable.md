# 共鸣干员费用与技能工作表

> 这是由冻结工坊参考与 `docs/resonance/design.md` 机械生成的派生工作表，供设计逐项核定，不是最终玩法或生产配置真源。属性重平衡、星级效果、盟约与技能数值仍需深度设计及推演。

来源版本：现有干员参考 Git commit `4ed1ad32ec10da15c23f9d7939dade603950759b`；费用映射读取 `docs/resonance/design.md`。干员 154 名，费用分布 1费 23 / 2费 33 / 3费 40 / 4费 38 / 5费 20；原生技能选项合计 373 个。
固定技能提议：万顷 → `skchr_wanqin_2`（专属第二技能）；白金 → `skchr_platnm_2`（专属第二技能）；灰毫 → `skchr_ashlok_2`（专属第二技能）；奥斯塔 → `skchr_aosta_2`（专属第二技能）；贾维 → `skchr_chiave_2`（专属第二技能）。正义骑士号无原生技能，标记为需要设计被动，不生成伪造技能。

## 1 费（23 名）

| 干员 | charId | 原档 | 当前默认技能 | 其他原生技能选项 | 固定技能提议 | 原始阵营标签 |
|---|---|---:|---|---|---|---|
| 角峰 | `char_199_yak` | 1 | 抗寒体质（skchr_yak_2，index 1） | 体能强化（skchr_yak_1，index 0） | skchr_yak_2（index 1，保留当前默认） | 谢拉格、喀兰贸易、bond:kjeragShip、bond:steadShip |
| 刺玫 | `char_494_vendla` | 1 | 荆藤庇荫（skchr_vendla_2，index 1） | 战术咏唱·γ型（skcom_magic_rage[3]，index 0） | skchr_vendla_2（index 1，保留当前默认） | 维多利亚、bond:victoriaShip、bond:deputShip |
| 普罗旺斯 | `char_145_prove` | 2 | 狼眼（skchr_prove_1，index 0） | 杀戮嗅觉（skchr_prove_2，index 1） | skchr_prove_1（index 0，保留当前默认） | 叙拉古、bond:siracusaShip |
| 跃跃 | `char_4100_caper` | 1 | 乐趣加倍（skchr_caper_2，index 1） | 强力击·β型（skchr_caper_1，index 0） | skchr_caper_2（index 1，保留当前默认） | 玻利瓦尔、bond:preciShip |
| 古米 | `char_196_sunbr` | 1 | 备用军粮（skchr_sunbr_1，index 0） | 食粮烹制（skchr_sunbr_2，index 1） | skchr_sunbr_1（index 0，保留当前默认） | 乌萨斯、乌萨斯学生自治团、bond:steadShip |
| 艾丝黛尔 | `char_127_estell` | 1 | 舍身突击（skchr_estell_2，index 1） | 攻击力强化·β型（skcom_atk_up[2]，index 0） | skchr_estell_2（index 1，保留当前默认） | 萨尔贡、bond:sargonShip |
| 波登可 | `char_258_podego` | 2 | 孢子扩散（skchr_podego_2，index 1） | 花香疗法（skchr_podego_1，index 0） | skchr_podego_2（index 1，保留当前默认） | 罗德岛、bond:deputShip |
| 格雷伊 | `char_253_greyy` | 2 | 静电释放（skchr_greyy_2，index 1） | 战术咏唱·β型（skcom_magic_rage[2]，index 0） | skchr_greyy_2（index 1，保留当前默认） | 玻利瓦尔、bond:skillfulShip |
| 深靛 | `char_469_indigo` | 1 | 光影迷宫（skchr_indigo_2，index 1） | 灯塔守卫者（skchr_indigo_1，index 0） | skchr_indigo_2（index 1，保留当前默认） | 伊比利亚、bond:arcaneShip、bond:preciShip |
| 宴 | `char_337_utage` | 1 | 落地斩·破门（skchr_utage_2，index 1） | 分神（skchr_utage_1，index 0） | skchr_utage_2（index 1，保留当前默认） | 东、bond:raidShip |
| 送葬人 | `char_279_excu` | 2 | 最终旅程（skchr_excu_2，index 1） | 铳口收束（skchr_excu_1，index 0） | skchr_excu_2（index 1，保留当前默认） | 拉特兰、bond:lateranoShip、bond:preciShip |
| 砾 | `char_237_gravel` | 1 | 鼠群（skchr_gravel_2，index 1） | 影袭（skchr_gravel_1，index 0） | skchr_gravel_2（index 1，保留当前默认） | 卡西米尔、bond:kazimierzShip、bond:indomShip |
| 调香师 | `char_181_flower` | 2 | 精调（skchr_flower_2，index 1） | 治疗强化·β型（skcom_heal_up[2]，index 0） | skchr_flower_2（index 1，保留当前默认） | 罗德岛、bond:deputShip、bond:emptyShip |
| 耶拉 | `char_4013_kjera` | 1 | 心随意动（skchr_kjera_2，index 1） | 攻击力强化·γ型（skcom_atk_up[3]，index 0） | skchr_kjera_2（index 1，保留当前默认） | 谢拉格、喀兰贸易、bond:kjeragShip、bond:deputShip |
| 凯瑟琳 | `char_4162_cathy` | 1 | 战火淬炼（skchr_cathy_2，index 1） | 岁月锻打（skchr_cathy_1，index 0） | skchr_cathy_2（index 1，保留当前默认） | 维多利亚、bond:victoriaShip、bond:skillfulShip |
| 红豆 | `char_290_vigna` | 1 | 槌音（skchr_vigna_2，index 1） | 攻击力强化·β型（skchr_vigna_1，index 0） | skchr_vigna_2（index 1，保留当前默认） | 哥伦比亚、bond:indomShip |
| 协律 | `char_4051_akkord` | 2 | 震爆调谐（skchr_akkord_2，index 1） | 反拍重音（skchr_akkord_1，index 0） | skchr_akkord_2（index 1，保留当前默认） | 莱塔尼亚、bond:arcaneShip、bond:deputShip |
| 香草 | `char_240_wyvern` | 1 | 冲锋号令·援军（skchr_wyvern_1，index 0） | 无 | skchr_wyvern_1（index 0，保留当前默认） | 哥伦比亚、黑钢国际 |
| 罗比菈塔 | `char_484_robrta` | 1 | 叙拉古式上妆（skchr_robrta_1，index 0） | 全自动造型仪（skchr_robrta_2，index 1） | skchr_robrta_1（index 0，保留当前默认） | 哥伦比亚 |
| 清流 | `char_385_finlpp` | 1 | 治愈水波（skchr_finlpp_1，index 0） | 涌泉（skchr_finlpp_2，index 1） | skchr_finlpp_1（index 0，保留当前默认） | 炎 |
| 九色鹿 | `char_4019_ncdeer` | 1 | 人间降吉（skchr_ncdeer_1，index 0） | 仙山去远（skchr_ncdeer_2，index 1） | skchr_ncdeer_1（index 0，保留当前默认） | 炎 |
| 正义骑士号 | `char_4000_jnight` | 1 | 无原生技能 | 无 | 待设计：补充固定被动 | 卡西米尔、红松骑士团 |
| 红云 | `char_190_clour` | 1 | 双弦开弓（skchr_clour_2，index 1） | 攻击力强化·β型（skcom_atk_up[2]，index 0） | skchr_clour_2（index 1，保留当前默认） | 叙拉古 |

## 2 费（33 名）

| 干员 | charId | 原档 | 当前默认技能 | 其他原生技能选项 | 固定技能提议 | 原始阵营标签 |
|---|---|---:|---|---|---|---|
| 隐现 | `char_498_inside` | 2 | “解决麻烦”（skchr_inside_2，index 1） | “不惹麻烦”（skchr_inside_1，index 0） | skchr_inside_2（index 1，保留当前默认） | 拉特兰、bond:lateranoShip、bond:swiftShip |
| 惊蛰 | `char_306_leizi` | 3 | 初雷（skchr_leizi_2，index 1） | 攻击力强化·γ型（skcom_atk_up[3]，index 0） | skchr_leizi_2（index 1，保留当前默认） | 炎、bond:yanShip |
| 深巡 | `char_4137_udflow` | 3 | 行动能力剥夺（skchr_udflow_2，index 1） | 侵袭破坏应对（skchr_udflow_1，index 0） | skchr_udflow_2（index 1，保留当前默认） | 阿戈尔、bond:egirShip |
| 德克萨斯 | `char_102_texas` | 3 | 剑雨（skchr_texas_2，index 1） | 冲锋号令·γ型（skcom_charge_cost[3]，index 0） | skchr_texas_2（index 1，保留当前默认） | 龙门、企鹅物流、叙拉古、bond:soloShip、bond:siracusaShip |
| 野鬃 | `char_496_wildmn` | 2 | 夹枪冲锋（skchr_wildmn_2，index 1） | 骑枪刺击（skchr_wildmn_1，index 0） | skchr_wildmn_2（index 1，保留当前默认） | 卡西米尔、红松骑士团、bond:kazimierzShip、bond:swiftShip |
| 赫默 | `char_108_silent` | 3 | 医疗无人机（skchr_silent_2，index 1） | 治疗强化·γ型（skcom_heal_up[3]，index 0） | skchr_silent_2（index 1，保留当前默认） | 哥伦比亚、莱茵生命、bond:visiShip |
| 小满 | `char_4122_grabds` | 2 | 乡音沉沉（skchr_grabds_2，index 1） | 竹笛飞声（skchr_grabds_1，index 0） | skchr_grabds_2（index 1，保留当前默认） | 炎、bond:yanShip、bond:skillfulShip |
| 莎草 | `char_4139_papyrs` | 2 | 巧思乍现（skchr_papyrs_1，index 0） | 临考发挥（skchr_papyrs_2，index 1） | skchr_papyrs_1（index 0，保留当前默认） | 萨尔贡、bond:sargonShip |
| 泡泡 | `char_381_bubble` | 2 | “挨打”（skchr_bubble_2，index 1） | 防御力强化·β型（skcom_def_up[2]，index 0） | skchr_bubble_2（index 1，保留当前默认） | 萨尔贡、bond:sargonShip、bond:steadShip |
| 休谟斯 | `char_491_humus` | 3 | 高效处理（skchr_humus_2，index 1） | 固废切割（skchr_humus_1，index 0） | skchr_humus_2（index 1，保留当前默认） | 罗德岛、bond:raidShip |
| 洛洛 | `char_4040_rockr` | 3 | 自负此轭（skchr_rockr_2，index 1） | 战术咏唱·γ型（skcom_magic_rage[3]，index 0） | skchr_rockr_2（index 1，保留当前默认） | 维多利亚、bond:victoriaShip、bond:arcaneShip |
| 蒂比 | `char_4191_tippi` | 3 | 紧急赶场通知（skchr_tippi_2，index 1） | 专业喷绘技巧（skchr_tippi_1，index 0） | skchr_tippi_2（index 1，保留当前默认） | 哥伦比亚、bond:swiftShip、bond:skillfulShip |
| 琳琅诗怀雅 | `char_1033_swire2` | 2 | “见面礼”（skchr_swire2_2，index 1） | 仗义疏财（skchr_swire2_1，index 0）；千金一掷（skchr_swire2_3，index 2） | skchr_swire2_2（index 1，保留当前默认） | 龙门、bond:yanShip、bond:investShip |
| 松果 | `char_440_pinecn` | 3 | 电能过载（skchr_pinecn_2，index 1） | RMA长钉（skchr_pinecn_1，index 0） | skchr_pinecn_2（index 1，保留当前默认） | 哥伦比亚、bond:swiftShip、bond:emptyShip |
| 流星 | `char_126_shotst` | 3 | 碎甲击·扩散（skchr_shotst_2，index 1） | 碎甲击（skchr_shotst_1，index 0） | skchr_shotst_2（index 1，保留当前默认） | 卡西米尔、bond:kazimierzShip、bond:soloShip |
| 忍冬 | `char_4026_vulpis` | 2 | 隐狐之艺（skchr_vulpis_3，index 2） | 小施惩戒（skchr_vulpis_1，index 0）；坠刃拷问（skchr_vulpis_2，index 1） | skchr_vulpis_3（index 2，保留当前默认） | 叙拉古、bond:siracusaShip、bond:swiftShip |
| 信仰搅拌机 | `char_4194_rmixer` | 2 | 退休前布道（skchr_rmixer_3，index 2） | 铳骑主考官（skchr_rmixer_1，index 0）；八臂电锯侠（skchr_rmixer_2，index 1） | skchr_rmixer_3（index 2，保留当前默认） | 拉特兰、bond:lateranoShip、bond:steadShip |
| 阿罗玛 | `char_446_aroma` | 2 | 小心地滑（skchr_aroma_2，index 1） | 强效清洁（skchr_aroma_1，index 0） | skchr_aroma_2（index 1，保留当前默认） | 叙拉古、bond:siracusaShip、bond:arcaneShip |
| 华法琳 | `char_171_bldsk` | 2 | 紧急包扎（skchr_bldsk_1，index 0） | 不稳定血浆（skchr_bldsk_2，index 1） | skchr_bldsk_1（index 0，保留当前默认） | 罗德岛、bond:miraShip |
| 录武官 | `char_4196_reckpr` | 3 | 一点关窍（skchr_reckpr_2，index 1） | 触类旁通（skchr_reckpr_1，index 0） | skchr_reckpr_2（index 1，保留当前默认） | 炎、bond:yanShip、bond:miraShip |
| 地灵 | `char_183_skgoat` | 3 | 攻击力强化·β型（skcom_atk_up[2]，index 0） | 流沙化（skchr_skgoat_2，index 1） | skcom_atk_up[2]（index 0，保留当前默认） | 莱塔尼亚、bond:miraShip、bond:visiShip |
| 见行者 | `char_4036_forcer` | 2 | 惊爆射击（skchr_forcer_2，index 1） | 护身射击（skchr_forcer_1，index 0） | skchr_forcer_2（index 1，保留当前默认） | 拉特兰、bond:lateranoShip |
| 蜜蜡 | `char_344_beewax` | 2 | 守卫尖碑（skchr_beewax_2，index 1） | 沙暴扩散（skchr_beewax_1，index 0） | skchr_beewax_2（index 1，保留当前默认） | 萨尔贡、bond:sargonShip、bond:deputShip |
| 瑰盐 | `char_4163_rosesa` | 2 | 绝妙的长效药呀（skchr_rosesa_2，index 1） | 上佳的应急药呀（skchr_rosesa_1，index 0） | skchr_rosesa_2（index 1，保留当前默认） | 伊比利亚、bond:emptyShip |
| 杰西卡 | `char_235_jesica` | 2 | 强力击·β型（skchr_jesica_1，index 0） | 掩护烟幕（skchr_jesica_2，index 1） | skchr_jesica_1（index 0，保留当前默认） | 哥伦比亚、黑钢国际 |
| 酸糖 | `char_366_acdrop` | 2 | 花式点射（skchr_acdrop_1，index 0） | 扳机时刻（skchr_acdrop_2，index 1） | skchr_acdrop_1（index 0，保留当前默认） | 哥伦比亚 |
| 格拉尼 | `char_220_grani` | 2 | 永不后退！（skchr_grani_2，index 1） | 防御力强化·γ型（skcom_def_up[3]，index 0） | skchr_grani_2（index 1，保留当前默认） | 维多利亚 |
| 谜图 | `char_4017_puzzle` | 2 | 关键线索（skchr_puzzle_1，index 0） | 疑点追踪（skchr_puzzle_2，index 1） | skchr_puzzle_1（index 0，保留当前默认） | 维多利亚 |
| 因陀罗 | `char_155_tiger` | 2 | 碎甲拳（skchr_tiger_1，index 0） | 裂魂（skchr_tiger_2，index 1） | skchr_tiger_1（index 0，保留当前默认） | 维多利亚、格拉斯哥帮 |
| 风絮 | `char_4222_taraxa` | 2 | 何处着（skchr_taraxa_1，index 0） | 扶风起（skchr_taraxa_2，index 1） | skchr_taraxa_1（index 0，保留当前默认） | 炎 |
| 但书 | `char_4032_provs` | 2 | 纠纷起诉（skchr_provs_1，index 0） | 致胜立论（skchr_provs_2，index 1） | skchr_provs_1（index 0，保留当前默认） | 卡西米尔 |
| 奥斯塔 | `char_346_aosta` | 2 | 迅捷打击·γ型（skcom_quickattack[3]，index 0） | 影钉（skchr_aosta_2，index 1） | skchr_aosta_2（index 1，专属第二技能） | 叙拉古、贾维团伙 |
| 贾维 | `char_349_chiave` | 3 | 冲锋号令·γ型（skcom_charge_cost[3]，index 0） | 火焰剥离（skchr_chiave_2，index 1） | skchr_chiave_2（index 1，专属第二技能） | 叙拉古、贾维团伙 |

## 3 费（40 名）

| 干员 | charId | 原档 | 当前默认技能 | 其他原生技能选项 | 固定技能提议 | 原始阵营标签 |
|---|---|---:|---|---|---|---|
| 雷蛇 | `char_107_liskam` | 3 | 反击电弧（skchr_liskam_2，index 1） | 充能防御（skchr_liskam_1，index 0） | skchr_liskam_2（index 1，保留当前默认） | 哥伦比亚、黑钢国际、bond:indomShip |
| 哈洛德 | `char_4114_harold` | 4 | 重症优先（skchr_harold_2，index 1） | 治疗强化·γ型（skcom_heal_up[3]，index 0） | skchr_harold_2（index 1，保留当前默认） | 维多利亚、谢拉格、bond:kjeragShip、bond:victoriaShip |
| 幽灵鲨 | `char_143_ghost` | 3 | 肉斩骨断（skchr_ghost_2，index 1） | 攻击力强化·γ型（skcom_atk_up[3]，index 0） | skchr_ghost_2（index 1，保留当前默认） | 阿戈尔、深海猎人、bond:egirShip |
| 风丸 | `char_4016_kazema` | 3 | 纸艺·双影（skchr_kazema_2，index 1） | 纸艺·迅击（skchr_kazema_1，index 0） | skchr_kazema_2（index 1，保留当前默认） | 东、bond:miraShip |
| 折桠 | `char_4207_branch` | 3 | 生存决心（skchr_branch_2，index 1） | 绝境抵抗（skchr_branch_1，index 0） | skchr_branch_2（index 1，保留当前默认） | 乌萨斯、bond:steadShip、bond:soloShip |
| 锡人 | `char_4151_tinman` | 4 | “大拉里”（skchr_tinman_2，index 1） | “老科利”（skchr_tinman_1，index 0） | skchr_tinman_2（index 1，保留当前默认） | 哥伦比亚、bond:investShip、bond:swiftShip |
| 能天使 | `char_103_angel` | 3 | 过载模式（skchr_angel_3，index 2） | 冲锋模式（skchr_angel_1，index 0）；扫射模式（skchr_angel_2，index 1） | skchr_angel_3（index 2，保留当前默认） | 龙门、企鹅物流、拉特兰、bond:lateranoShip、bond:miraShip |
| 断崖 | `char_294_ayer` | 4 | 浮游刃启动（skchr_ayer_2，index 1） | 多导向散射弹丸（skchr_ayer_1，index 0） | skchr_ayer_2（index 1，保留当前默认） | 雷姆必拓、bond:skillfulShip |
| 诗怀雅 | `char_308_swire` | 4 | 协同作战（skchr_swire_2，index 1） | 指挥调度（skchr_swire_1，index 0） | skchr_swire_2（index 1，保留当前默认） | 炎-龙门、龙门近卫局、bond:yanShip、bond:visiShip |
| 斯卡蒂 | `char_263_skadi` | 3 | 涌潮悲歌（skchr_skadi_3，index 2） | 迅捷打击·γ型（skcom_quickattack[3]，index 0）；跃浪击（skchr_skadi_2，index 1） | skchr_skadi_3（index 2，保留当前默认） | 阿戈尔、深海猎人、bond:egirShip、bond:steadShip、bond:raidShip |
| 菲莱 | `char_4148_philae` | 3 | 冥河诅咒（skchr_philae_2，index 1） | 灵河护佑（skchr_philae_1，index 0） | skchr_philae_2（index 1，保留当前默认） | 萨尔贡、bond:sargonShip |
| 薄绿 | `char_388_mint` | 3 | 聚能涡旋（skchr_mint_2，index 1） | 风语（skchr_mint_1，index 0） | skchr_mint_2（index 1，保留当前默认） | 维多利亚、bond:victoriaShip |
| 海霓 | `char_4079_haini` | 4 | 阻滞性显色剂（skchr_haini_2，index 1） | 迷惑性洋流图（skchr_haini_1，index 0） | skchr_haini_2（index 1，保留当前默认） | 阿戈尔、bond:egirShip、bond:arcaneShip |
| 雪猎 | `char_4211_snhunt` | 3 | 风雪连弩（skchr_snhunt_2，index 1） | 强力击·β型（skchr_snhunt_1，index 0） | skchr_snhunt_2（index 1，保留当前默认） | 谢拉格、bond:kjeragShip、bond:preciShip |
| 至简 | `char_4054_malist` | 3 | 神工意匠（skchr_malist_2，index 1） | 迅捷打击·γ型（skcom_quickattack[3]，index 0） | skchr_malist_2（index 1，保留当前默认） | 萨尔贡、bond:sargonShip、bond:skillfulShip |
| 蛇屠箱 | `char_150_snakek` | 4 | 壳状防御（skchr_snakek_2，index 1） | 防御力强化·β型（skcom_def_up[2]，index 0） | skchr_snakek_2（index 1，保留当前默认） | 哥伦比亚、bond:steadShip、bond:indomShip |
| 伺夜 | `char_427_vigil` | 3 | 领袖的尊严（skchr_vigil_3，index 2） | 领袖的呼唤（skchr_vigil_1，index 0）；领袖的馈赠（skchr_vigil_2，index 1） | skchr_vigil_3（index 2，保留当前默认） | 叙拉古、bond:siracusaShip、bond:miraShip |
| 空弦 | `char_332_archet` | 4 | 箭矢·暴风（skchr_archet_3，index 2） | 箭矢·散逸（skchr_archet_1，index 0）；箭矢·追猎（skchr_archet_2，index 1） | skchr_archet_3（index 2，保留当前默认） | 拉特兰、bond:lateranoShip、bond:skillfulShip |
| 莫斯提马 | `char_213_mostma` | 4 | 序时之匙（skchr_mostma_3，index 2） | 攻击力强化·γ型（skcom_atk_up[3]，index 0）；荒时之锁（skchr_mostma_2，index 1） | skchr_mostma_3（index 2，保留当前默认） | 拉特兰、bond:lateranoShip、bond:arcaneShip |
| 伊内丝 | `char_4087_ines` | 3 | 暗夜无明（skchr_ines_2，index 1） | 淬影突袭（skchr_ines_1，index 0）；独影归途（skchr_ines_3，index 2） | skchr_ines_2（index 1，保留当前默认） | 巴别塔、bond:visiShip、bond:raidShip |
| 寒芒克洛丝 | `char_1021_kroos2` | 4 | 封喉（skchr_kroos2_2，index 1） | 无痕（skchr_kroos2_1，index 0） | skchr_kroos2_2（index 1，保留当前默认） | 罗德岛、bond:preciShip |
| 水月 | `char_437_mizuki` | 4 | 囚徒困境（skchr_mizuki_2，index 1） | 唤醒（skchr_mizuki_1，index 0）；镜花水月（skchr_mizuki_3，index 2） | skchr_mizuki_2（index 1，保留当前默认） | 东、bond:egirShip、bond:soloShip |
| 歌蕾蒂娅 | `char_474_glady` | 3 | 缺水的碎漩狂舞（skchr_glady_3，index 2） | 缺水的大洋裂断（skchr_glady_1，index 0）；缺水的掌握怒海（skchr_glady_2，index 1） | skchr_glady_3（index 2，保留当前默认） | 阿戈尔、深海猎人、bond:egirShip |
| 灵知 | `char_206_gnosis` | 3 | 零度爆发（skchr_gnosis_2，index 1） | 高速思考（skchr_gnosis_1，index 0）；失温症（skchr_gnosis_3，index 2） | skchr_gnosis_2（index 1，保留当前默认） | 谢拉格、喀兰贸易、bond:kjeragShip、bond:skillfulShip |
| 莱恩哈特 | `char_373_lionhd` | 4 | 解构与爆破（skchr_lionhd_2，index 1） | 攻击力强化·γ型（skcom_atk_up[3]，index 0） | skchr_lionhd_2（index 1，保留当前默认） | 雷姆必拓、bond:swiftShip、bond:preciShip |
| 星熊 | `char_136_hsguma` | 4 | 荆棘（skchr_hsguma_2，index 1） | 战意（skchr_hsguma_1，index 0）；力之锯（skchr_hsguma_3，index 2） | skchr_hsguma_2（index 1，保留当前默认） | 龙门、龙门近卫局、东、bond:yanShip |
| 白面鸮 | `char_128_plosis` | 3 | 脑啡肽（skchr_plosis_2，index 1） | 治疗强化·γ型（skcom_heal_up[3]，index 0） | skchr_plosis_2（index 1，保留当前默认） | 哥伦比亚、莱茵生命、bond:deputShip、bond:skillfulShip |
| 银灰 | `char_172_svrash` | 3 | 真银斩（skchr_svrash_3，index 2） | 强力击·γ型（skchr_svrash_1，index 0）；雪境生存法则（skchr_svrash_2，index 1） | skchr_svrash_3（index 2，保留当前默认） | 谢拉格、喀兰贸易、bond:kjeragShip |
| 百炼嘉维尔 | `char_1026_gvial2` | 3 | 丛林之魂（skchr_gvial2_3，index 2） | 精准痛击（skchr_gvial2_1，index 0）；链锯强袭（skchr_gvial2_2，index 1） | skchr_gvial2_3（index 2，保留当前默认） | 罗德岛、萨尔贡、bond:sargonShip |
| 流明 | `char_4042_lumen` | 4 | 灯火不灭（skchr_lumen_3，index 2） | 沐雨（skchr_lumen_1，index 0）；沛霖（skchr_lumen_2，index 1） | skchr_lumen_3（index 2，保留当前默认） | 伊比利亚、bond:deputShip |
| 仇白 | `char_4082_qiubai` | 4 | 问雪（skchr_qiubai_3，index 2） | 留羽（skchr_qiubai_1，index 0）；承影（skchr_qiubai_2，index 1） | skchr_qiubai_3（index 2，保留当前默认） | 炎、bond:yanShip、bond:raidShip |
| 崖心 | `char_173_slchan` | 3 | 束缚链（skchr_slchan_2，index 1） | 锁链勾爪（skchr_slchan_1，index 0） | skchr_slchan_2（index 1，保留当前默认） | 谢拉格、喀兰贸易、bond:kjeragShip、bond:indomShip |
| 梅尔 | `char_242_otter` | 3 | 迷惑装置（skchr_otter_1，index 0） | 爆破回收（skchr_otter_2，index 1） | skchr_otter_1（index 0，保留当前默认） | 哥伦比亚、莱茵生命 |
| 罗宾 | `char_451_robin` | 4 | 束缚“夹子”（skchr_robin_1，index 0） | 弹射“夹子”（skchr_robin_2，index 1） | skchr_robin_1（index 0，保留当前默认） | 哥伦比亚 |
| 海蒂 | `char_4045_heidi` | 3 | 虚构故事·怒士（skchr_heidi_1，index 0） | 虚构故事·锈城（skchr_heidi_2，index 1） | skchr_heidi_1（index 0，保留当前默认） | 维多利亚 |
| 摩根 | `char_154_morgan` | 4 | 街头好手（skchr_morgan_1，index 0） | 无畏招架（skchr_morgan_2，index 1） | skchr_morgan_1（index 0，保留当前默认） | 维多利亚、格拉斯哥帮 |
| 万顷 | `char_4119_wanqin` | 3 | 支援号令·γ型（skcom_assist_cost[3]，index 0） | 应东风（skchr_wanqin_2，index 1） | skchr_wanqin_2（index 1，专属第二技能） | 炎 |
| 鞭刃 | `char_265_sophia` | 3 | 鞭刃（skchr_sophia_2，index 1） | 激励艺术（skchr_sophia_1，index 0） | skchr_sophia_2（index 1，保留当前默认） | 卡西米尔 |
| 白金 | `char_204_platnm` | 3 | 攻击力强化·γ型（skcom_atk_up[3]，index 0） | 天马视域（skchr_platnm_2，index 1） | skchr_platnm_2（index 1，专属第二技能） | 卡西米尔 |
| 复奏 | `char_4031_liesel` | 3 | 合奏起拍（skchr_liesel_1，index 0） | 直到终曲（skchr_liesel_2，index 1） | skchr_liesel_1（index 0，保留当前默认） | 叙拉古 |

## 4 费（38 名）

| 干员 | charId | 原档 | 当前默认技能 | 其他原生技能选项 | 固定技能提议 | 原始阵营标签 |
|---|---|---:|---|---|---|---|
| 拉普兰德 | `char_140_whitew` | 4 | 狼魂（skchr_whitew_2，index 1） | 日晷（skchr_whitew_1，index 0） | skchr_whitew_2（index 1，保留当前默认） | 叙拉古、bond:siracusaShip |
| 灰毫 | `char_431_ashlok` | 4 | 攻击力强化·γ型（skcom_atk_up[3]，index 0） | 专注轰击（skchr_ashlok_2，index 1） | skchr_ashlok_2（index 1，专属第二技能） | 卡西米尔、红松骑士团、bond:kazimierzShip、bond:steadShip |
| 瑕光 | `char_423_blemsh` | 4 | 先贤化身（skchr_blemsh_3，index 2） | 光芒涌动（skchr_blemsh_1，index 0）；慑敌辉光（skchr_blemsh_2，index 1） | skchr_blemsh_3（index 2，保留当前默认） | 卡西米尔、bond:kazimierzShip、bond:raidShip |
| 初雪 | `char_174_slbell` | 4 | 自然震慑（skchr_slbell_2，index 1） | 传音回响（skchr_slbell_1，index 0） | skchr_slbell_2（index 1，保留当前默认） | 谢拉格、喀兰贸易、bond:kjeragShip、bond:visiShip |
| 风笛 | `char_222_bpipe` | 5 | 高效冲击（skchr_bpipe_2，index 1） | 迅捷打击·γ型（skcom_quickattack[3]，index 0）；闭膛连发（skchr_bpipe_3，index 2） | skchr_bpipe_2（index 1，保留当前默认） | 维多利亚、bond:victoriaShip、bond:visiShip、bond:indomShip |
| 缄默德克萨斯 | `char_1028_texas2` | 5 | 剑雨滂沱（skchr_texas2_3，index 2） | 细雨无声（skchr_texas2_1，index 0）；阵雨连绵（skchr_texas2_2，index 1） | skchr_texas2_3（index 2，保留当前默认） | 炎-龙门、企鹅物流、bond:siracusaShip、bond:raidShip |
| 泥岩 | `char_311_mudrok` | 4 | 岩崩锤（skchr_mudrok_2，index 1） | 防御力强化·γ型（skcom_def_up[3]，index 0）；秽壤的血脉（skchr_mudrok_3，index 2） | skchr_mudrok_2（index 1，保留当前默认） | 罗德岛、bond:soloShip |
| 焰尾 | `char_420_flamtl` | 4 | 焰心（skchr_flamtl_3，index 2） | 迅敏直觉（skchr_flamtl_1，index 0）；“红松林”（skchr_flamtl_2，index 1） | skchr_flamtl_3（index 2，保留当前默认） | 卡西米尔、红松骑士团、bond:kazimierzShip |
| 远牙 | `char_430_fartth` | 5 | 光羽箭（skchr_fartth_3，index 2） | 迅捷打击·γ型（skcom_quickattack[3]，index 0）；同盟支援（skchr_fartth_2，index 1） | skchr_fartth_3（index 2，保留当前默认） | 卡西米尔、红松骑士团、bond:kazimierzShip、bond:preciShip |
| 卡涅利安 | `char_426_billro` | 4 | 沙缚镣锁（skchr_billro_2，index 1） | 沙暴守卫（skchr_billro_1，index 0）；食噬之印（skchr_billro_3，index 2） | skchr_billro_2（index 1，保留当前默认） | 莱塔尼亚、萨尔贡、bond:sargonShip、bond:deputShip |
| 缇缇 | `char_4056_titi` | 5 | 旧日绽放（skchr_titi_3，index 2） | 缓蚀（skchr_titi_1，index 0）；封护（skchr_titi_2，index 1） | skchr_titi_3（index 2，保留当前默认） | 萨尔贡、米诺斯、bond:sargonShip、bond:preciShip |
| 号角 | `char_4039_horn` | 5 | 终极防线（skchr_horn_3，index 2） | 照明榴弹（skchr_horn_1，index 0）；暴风号令（skchr_horn_2，index 1） | skchr_horn_3（index 2，保留当前默认） | 维多利亚、bond:victoriaShip |
| 铃兰 | `char_358_lisa` | 5 | 狐火渺然（skchr_lisa_3，index 2） | 全力以赴（skchr_lisa_1，index 0）；儿时的舞乐（skchr_lisa_2，index 1） | skchr_lisa_3（index 2，保留当前默认） | 叙拉古、bond:siracusaShip、bond:emptyShip |
| 塞雷娅 | `char_202_demkni` | 5 | 药物配置（skchr_demkni_2，index 1） | 急救（skchr_demkni_1，index 0）；钙质化（skchr_demkni_3，index 2） | skchr_demkni_2（index 1，保留当前默认） | 哥伦比亚、莱茵生命、bond:steadShip、bond:soloShip |
| 夕 | `char_2015_dusk` | 5 | 工笔入化（skchr_dusk_1，index 0） | 泼墨淋漓（skchr_dusk_2，index 1）；写意胜形（skchr_dusk_3，index 2） | skchr_dusk_1（index 0，保留当前默认） | 炎、炎-岁、bond:yanShip、bond:arcaneShip |
| 归溟幽灵鲨 | `char_1023_ghost2` | 5 | 生存的渴望（skchr_ghost2_2，index 1） | 生存的技巧（skchr_ghost2_1，index 0）；生存的重压（skchr_ghost2_3，index 2） | skchr_ghost2_2（index 1，保留当前默认） | 阿戈尔、深海猎人、bond:egirShip、bond:indomShip |
| 引星棘刺 | `char_1039_thorn2` | 4 | 解构涌潮（skchr_thorn2_2，index 1） | 度算浪波（skchr_thorn2_1，index 0）；“我的海疆”（skchr_thorn2_3，index 2） | skchr_thorn2_2（index 1，保留当前默认） | 伊比利亚、bond:swiftShip、bond:miraShip |
| 山 | `char_264_f12yin` | 5 | 横扫架势（skchr_f12yin_2，index 1） | 左勾扫拳（skchr_f12yin_1，index 0）；震地碎岩击（skchr_f12yin_3，index 2） | skchr_f12yin_2（index 1，保留当前默认） | 哥伦比亚、bond:investShip |
| 玛恩纳 | `char_4064_mlynar` | 5 | 未照耀的荣光（skchr_mlynar_3，index 2） | 未声张的怒火（skchr_mlynar_1，index 0）；未宽解的悲哀（skchr_mlynar_2，index 1） | skchr_mlynar_3（index 2，保留当前默认） | 卡西米尔、bond:kazimierzShip |
| 安洁莉娜 | `char_291_aglina` | 5 | 秘杖·反重力模式（skchr_aglina_3，index 2） | 秘杖·速充模式（skchr_aglina_1，index 0）；秘杖·微粒模式（skchr_aglina_2，index 1） | skchr_aglina_3（index 2，保留当前默认） | 叙拉古、bond:siracusaShip、bond:miraShip |
| 寒檀 | `char_341_sntlla` | 5 | “女巫之泪”（skchr_sntlla_2，index 1） | 迅捷打击·γ型（skcom_quickattack[3]，index 0） | skchr_sntlla_2（index 1，保留当前默认） | 萨米、bond:visiShip |
| 妮芙 | `char_4146_nymph` | 5 | 怵然震爆（skchr_nymph_2，index 1） | 笞心击（skchr_nymph_1，index 0）；心防溃决（skchr_nymph_3，index 2） | skchr_nymph_2（index 1，保留当前默认） | 罗德岛、bond:swiftShip |
| 浊心斯卡蒂 | `char_1012_skadi2` | 5 | "潮涌，潮枯"（skchr_skadi2_3，index 2） | 同归殊途之吟（skchr_skadi2_1，index 0）；同葬无光之愿（skchr_skadi2_2，index 1） | skchr_skadi2_3（index 2，保留当前默认） | 阿戈尔、bond:egirShip |
| 异客 | `char_472_pasngr` | 5 | 辉煌裂片（skchr_pasngr_3，index 2） | 电能之触（skchr_pasngr_1，index 0）；聚焦指令（skchr_pasngr_2，index 1） | skchr_pasngr_3（index 2，保留当前默认） | 萨尔贡、bond:sargonShip、bond:swiftShip、bond:preciShip |
| 佩佩 | `char_4058_pepe` | 6 | 时光震荡（skchr_pepe_3，index 2） | 盖戳！（skchr_pepe_1，index 0）；阻遏混乱锤（skchr_pepe_2，index 1） | skchr_pepe_3（index 2，保留当前默认） | 萨尔贡、bond:sargonShip、bond:indomShip |
| 焰影苇草 | `char_1020_reed2` | 5 | 生命火种（skchr_reed2_3，index 2） | 迅捷打击·γ型（skcom_quickattack[3]，index 0）；枯荣共息（skchr_reed2_2，index 1） | skchr_reed2_3（index 2，保留当前默认） | 维多利亚、塔拉、bond:victoriaShip、bond:preciShip |
| 溯光星源 | `char_1047_halo2` | 5 | 并流连锁（skchr_halo2_3，index 2） | 星图闪烁（skchr_halo2_1，index 0）；星束引力（skchr_halo2_2，index 1） | skchr_halo2_3（index 2，保留当前默认） | 哥伦比亚、莱茵生命、bond:arcaneShip、bond:skillfulShip |
| 锏 | `char_4116_blkkgt` | 5 | 归于宁静（skchr_blkkgt_3，index 2） | 纯粹的武力（skchr_blkkgt_1，index 0）；无声的嘲笑（skchr_blkkgt_2，index 1） | skchr_blkkgt_3（index 2，保留当前默认） | 谢拉格、喀兰贸易、卡西米尔、莱塔尼亚、bond:kjeragShip、bond:kazimierzShip、bond:swiftShip |
| 纯烬艾雅法拉 | `char_1016_agoat2` | 4 | 火山回响（skchr_agoat2_3，index 2） | 无声润物（skchr_agoat2_1，index 0）；云霭荫佑（skchr_agoat2_2，index 1） | skchr_agoat2_3（index 2，保留当前默认） | 莱塔尼亚、bond:deputShip |
| 巫恋 | `char_254_vodfox` | 5 | 诅咒娃娃（skchr_vodfox_2，index 1） | 病入膏肓（skchr_vodfox_1，index 0） | skchr_vodfox_2（index 1，保留当前默认） | 叙拉古、bond:siracusaShip、bond:deputShip |
| 多萝西 | `char_4048_doroth` | 4 | 危险目标清除（skchr_doroth_1，index 0） | 流沙区域生成（skchr_doroth_2，index 1）；高速共振排障（skchr_doroth_3，index 2） | skchr_doroth_1（index 0，保留当前默认） | 哥伦比亚、莱茵生命 |
| 涤火杰西卡 | `char_1034_jesca2` | 6 | 坚守阵线（skchr_jesca2_1，index 0） | 掩蔽护卫（skchr_jesca2_2，index 1）；饱和迸射（skchr_jesca2_3，index 2） | skchr_jesca2_1（index 0，保留当前默认） | 哥伦比亚、黑钢国际 |
| 推进之王 | `char_112_siege` | 5 | 跃空锤（skchr_siege_2，index 1） | 冲锋号令·γ型（skcom_charge_cost[3]，index 0）；碎颅击（skchr_siege_3，index 2） | skchr_siege_2（index 1，保留当前默认） | 维多利亚、格拉斯哥帮 |
| 白铁 | `char_4072_ironmn` | 5 | 极致火力（skchr_ironmn_1，index 0） | 高效补给（skchr_ironmn_2，index 1）；铁钳号·原型机（skchr_ironmn_3，index 2） | skchr_ironmn_1（index 0，保留当前默认） | 维多利亚 |
| 布洛卡 | `char_356_broca` | 4 | 通电（skchr_broca_1，index 0） | 高压电流（skchr_broca_2，index 1） | skchr_broca_1（index 0，保留当前默认） | 叙拉古、贾维团伙 |
| 斥罪 | `char_4065_judge` | 5 | 一锤定音（skchr_judge_1，index 0） | 坚心苦修（skchr_judge_2，index 1）；披荆斩棘（skchr_judge_3，index 2） | skchr_judge_1（index 0，保留当前默认） | 叙拉古 |
| 贝洛内 | `char_4037_demetr` | 6 | 家主的余裕（skchr_demetr_1，index 0） | 军师的手段（skchr_demetr_2，index 1）；清算（skchr_demetr_3，index 2） | skchr_demetr_1（index 0，保留当前默认） | 叙拉古 |
| 裁度 | `char_4155_talr` | 6 | 量衣尺（skchr_talr_1，index 0） | 缝线缠身（skchr_talr_2，index 1） | skchr_talr_1（index 0，保留当前默认） | 叙拉古 |

## 5 费（20 名）

| 干员 | charId | 原档 | 当前默认技能 | 其他原生技能选项 | 固定技能提议 | 原始阵营标签 |
|---|---|---:|---|---|---|---|
| 魔王 | `char_4134_cetsyr` | 4 | 编织重构现世（skchr_cetsyr_3，index 2） | 往昔萦绕身旁（skchr_cetsyr_1，index 0）；明日渺远不及（skchr_cetsyr_2，index 1） | skchr_cetsyr_3（index 2，保留当前默认） | 罗德岛、巴别塔、bond:emptyShip |
| 圣约送葬人 | `char_1032_excu2` | 6 | 近身铳斗（skchr_excu2_2，index 1） | 遗嘱执行（skchr_excu2_1，index 0）；圣约决裁（skchr_excu2_3，index 2） | skchr_excu2_2（index 1，保留当前默认） | 拉特兰、bond:lateranoShip、bond:visiShip |
| 烛煌 | `char_1040_blaze2` | 5 | 众恶的焚场（skchr_blaze2_3，index 2） | 炙手之援（skchr_blaze2_1，index 0）；沸血燎原（skchr_blaze2_2，index 1） | skchr_blaze2_3（index 2，保留当前默认） | 罗德岛、罗德岛-精英干员、bond:victoriaShip、bond:yanShip |
| 乌尔比安 | `char_4145_ulpia` | 6 | 必须开辟的通路（skchr_ulpia_3，index 2） | 必须促成的接触（skchr_ulpia_1，index 0）；必须维系的界限（skchr_ulpia_2，index 1） | skchr_ulpia_3（index 2，保留当前默认） | 阿戈尔、深海猎人、bond:egirShip |
| 隐德来希 | `char_4010_etlchi` | 6 | 灵与欲的惜别（skchr_etlchi_3，index 2） | 玫影觅迹（skchr_etlchi_1，index 0）；绯红壁合（skchr_etlchi_2，index 1） | skchr_etlchi_3（index 2，保留当前默认） | 罗德岛、bond:indomShip、bond:skillfulShip |
| 史尔特尔 | `char_350_surtr` | 6 | 黄昏（skchr_surtr_3，index 2） | 烈焰魔剑（skchr_surtr_1，index 0）；熔核巨影（skchr_surtr_2，index 1） | skchr_surtr_3（index 2，保留当前默认） | 罗德岛、bond:raidShip、bond:arcaneShip |
| 凛御银灰 | `char_1045_svash2` | 6 | 御敌的锋锐（skchr_svash2_2，index 1） | 周旋的谋略（skchr_svash2_1，index 0）；变革已至（skchr_svash2_3，index 2） | skchr_svash2_2（index 1，保留当前默认） | 谢拉格、bond:kjeragShip、bond:investShip、bond:swiftShip |
| 蕾缪安 | `char_4193_lemuen` | 6 | 礼炮·强制追思（skchr_lemuen_3，index 2） | 重逢问候（skchr_lemuen_1，index 0）；归乡邀约（skchr_lemuen_2，index 1） | skchr_lemuen_3（index 2，保留当前默认） | 拉特兰、bond:lateranoShip、bond:preciShip |
| 圣聆初雪 | `char_1046_sbell2` | 6 | 群山俯首（skchr_sbell2_3，index 2） | 铃音吹雪（skchr_sbell2_1，index 0）；霜涛覆岭（skchr_sbell2_2，index 1） | skchr_sbell2_3（index 2，保留当前默认） | 谢拉格、bond:kjeragShip、bond:arcaneShip |
| 余 | `char_2026_yu` | 6 | 灶里乾坤（skchr_yu_3，index 2） | 今日做东（skchr_yu_1，index 0）；厚礼上宾（skchr_yu_2，index 1） | skchr_yu_3（index 2，保留当前默认） | 炎、炎-岁、bond:yanShip、bond:steadShip |
| 维娜·维多利亚 | `char_1019_siege2` | 6 | 俱以我之名（skchr_siege2_3，index 2） | 重铸晖光（skchr_siege2_1，index 0）；进赴故土（skchr_siege2_2，index 1） | skchr_siege2_3（index 2，保留当前默认） | 维多利亚、bond:victoriaShip、bond:miraShip |
| 塑心 | `char_245_cello` | 5 | “黄金的狂喜”（skchr_cello_1，index 0） | “安魂的弥撒”（skchr_cello_2，index 1）；“自由的探戈”（skchr_cello_3，index 2） | skchr_cello_1（index 0，保留当前默认） | 拉特兰、bond:lateranoShip |
| 缪尔赛思 | `char_249_mlyss` | 6 | 浅层非熵适应（skchr_mlyss_3，index 2） | 渐进性润化（skchr_mlyss_1，index 0）；生态耦合（skchr_mlyss_2，index 1） | skchr_mlyss_3（index 2，保留当前默认） | 哥伦比亚、莱茵生命、bond:maniShip |
| 迷迭香 | `char_391_rosmon` | 5 | 末梢阻断（skchr_rosmon_2，index 1） | 思维膨大（skchr_rosmon_1，index 0）；“如你所愿”（skchr_rosmon_3，index 2） | skchr_rosmon_2（index 1，保留当前默认） | 罗德岛、罗德岛-精英干员、哥伦比亚、bond:preciShip、bond:visiShip、bond:emptyShip |
| 新约能天使 | `char_1041_angel2` | 5 | 开火成瘾症（skchr_angel2_2，index 1） | 天空大扫除（skchr_angel2_1，index 0）；使命必达！（skchr_angel2_3，index 2） | skchr_angel2_2（index 1，保留当前默认） | 龙门、企鹅物流、拉特兰、bond:lateranoShip |
| 耀骑士临光 | `char_1014_nearl2` | 6 | 耀阳颔首（skchr_nearl2_3，index 2） | 灿焰长刃（skchr_nearl2_1，index 0）；逐夜烁光（skchr_nearl2_2，index 1） | skchr_nearl2_3（index 2，保留当前默认） | 卡西米尔、bond:kazimierzShip、bond:raidShip |
| 荒芜拉普兰德 | `char_1038_whitw2` | 6 | 终幕·浩劫（skchr_whitw2_3，index 2） | 慵怠者悲鸣（skchr_whitw2_1，index 0）；逐猎狂飙（skchr_whitw2_2，index 1） | skchr_whitw2_3（index 2，保留当前默认） | 叙拉古、bond:siracusaShip |
| 令 | `char_2023_ling` | 6 | 重进酒（skchr_ling_1，index 0） | 笑鸣瑟（skchr_ling_2，index 1）；宁作吾（skchr_ling_3，index 2） | skchr_ling_1（index 0，保留当前默认） | 炎、炎-岁 |
| 黍 | `char_2025_shu` | 6 | 化被草木（skchr_shu_1，index 0） | 嘉禾盈仓（skchr_shu_2，index 1）；离离枯荣（skchr_shu_3，index 2） | skchr_shu_1（index 0，保留当前默认） | 炎、炎-岁 |
| 重岳 | `char_2024_chyue` | 6 | 冲盈（skchr_chyue_1，index 0） | 拂尘（skchr_chyue_2，index 1）；我无（skchr_chyue_3，index 2） | skchr_chyue_1（index 0，保留当前默认） | 炎、炎-岁 |

## 核对说明

- JSON 为每名干员保留必要的原生普通形态字段、全部技能选项及原始描述/BB、原生天赋、属性、射程、职业、子职业、阵营关系与资源标识。源字段未被新费用或技能提议覆盖。
- `currentWorkshopDefaultIndex` 来自该普通棋子源技能的 `isDefault`；除正义骑士号外均要求恰有一个。非五名特殊干员的固定技能提议沿用该 index。
- `sourceFactions` 同时保留工坊设计记录中的原生阵营标签和普通棋子原生 bond ID；未来共鸣阵营标签由后续设计确定。
- 本表没有生成未定属性、升星数值或技能效果，也没有复制素材、运行数据或依赖。
