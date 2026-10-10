# 共鸣 Set 13 首发原型（14.23）

此候选季采用 TFT Set 13 首发 patch 14.23 的自然英雄和天然羁绊作为机械原型。新局使用的规则版本由catalog入口配置决定，v1/v2存档读取路径保留。原始输入：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft-set13-14.23.json`。来源、排除规则及证据类型见下方。

## 证据与口径

- 自然英雄、天然羁绊成员、层级边界、描述和变量来自固定版本 CommunityDragon 客户端数据：https://raw.communitydragon.org/14.23/cdragon/tft/en_us.json
- 官方首发季与补丁页面仅确认 Set 13 发布背景，不声称官方页面完整列出所有成员/变量：https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/into-the-arcane-overview/；https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-14-23-notes/
- 不含 conditional Team-Up traits；每个原型 trait 只按对应 Set 13 自然成员映射到本模式干员，不把干员原生国籍计为盟约。源 natural member 名称与 canonical operator ID 的映射由 compiler 唯一性校验。
- 60个唯一干员槽位；费用数组：{"1":14,"2":13,"3":13,"4":12,"5":8}。当前池只用于新 rulesVersion 3，v1/v2 保留读取。首发均统一“标准开局”。

## 自然成员逐干员

| 费 | Set 13 英文名 | 映射干员 | 原生角色 | Set 13 天然特性 |
|---:|---|---|---|---|
| 1 | Amumu | 角峰 | frontline | Automata、Watcher |
| 1 | Darius | 艾丝黛尔 | frontline | Conqueror、Watcher |
| 1 | Draven | 普罗旺斯 | damage | Conqueror、Pit Fighter |
| 1 | Irelia | 古米 | frontline | Rebel、Sentinel |
| 1 | Lux | 调香师 | healer | Academy、Sorcerer |
| 1 | Maddie | 送葬人 | damage | Enforcer、Sniper |
| 1 | Morgana | 深靛 | control | Black Rose、Visionary |
| 1 | Powder | 凯瑟琳 | summoner | Family、Scrap、Ambusher |
| 1 | Singed | 香草 | damage | Chem-Baron、Sentinel |
| 1 | Steb | 清流 | healer | Enforcer、Bruiser |
| 1 | Trundle | 宴 | frontline | Scrap、Bruiser |
| 1 | Vex | 耶拉 | control | Rebel、Visionary |
| 1 | Violet | 休谟斯 | damage | Family、Pit Fighter |
| 1 | Zyra | 格雷伊 | control | Experiment、Sorcerer |
| 2 | Akali | 德克萨斯 | control | Rebel、Quickstriker |
| 2 | Camille | 砾 | frontline | Enforcer、Ambusher |
| 2 | Leona | 泡泡 | frontline | Academy、Sentinel |
| 2 | Nocturne | 因陀罗 | damage | Automata、Quickstriker |
| 2 | Rell | 雷蛇 | frontline | Conqueror、Sentinel、Visionary |
| 2 | Renata Glasc | 赫默 | healer | Chem-Baron、Visionary |
| 2 | Sett | 深巡 | control | Rebel、Bruiser |
| 2 | Tristana | 能天使 | damage | Emissary、Artillerist |
| 2 | Urgot | 灰毫 | damage | Experiment、Pit Fighter、Artillerist |
| 2 | Vander | 折桠 | frontline | Family、Watcher |
| 2 | Vladimir | 刺玫 | damage | Black Rose、Watcher、Sorcerer |
| 2 | Zeri | 隐现 | damage | Firelight、Sniper |
| 2 | Ziggs | 惊蛰 | damage | Scrap、Dominator |
| 3 | Blitzcrank | 星熊 | frontline | Automata、Dominator |
| 3 | Cassiopeia | 巫恋 | summoner | Black Rose、Dominator |
| 3 | Ezreal | 雪猎 | damage | Academy、Rebel、Artillerist |
| 3 | Gangplank | 风丸 | summoner | Scrap、Form Swapper、Pit Fighter |
| 3 | Kog'Maw | 白金 | damage | Automata、Sniper |
| 3 | Loris | 瑕光 | frontline | Enforcer、Sentinel |
| 3 | Nami | 流明 | healer | Emissary、Sorcerer |
| 3 | Nunu & Willump | 幽灵鲨 | frontline | Experiment、Bruiser、Visionary |
| 3 | Renni | 摩根 | frontline | Chem-Baron、Bruiser |
| 3 | Scar | 缄默德克萨斯 | control | Firelight、Watcher |
| 3 | Smeech | 伊内丝 | damage | Chem-Baron、Ambusher |
| 3 | Swain | 薄绿 | control | Conqueror、Form Swapper、Sorcerer |
| 3 | Twisted Fate | 诗怀雅 | damage | Enforcer、Quickstriker |
| 4 | Ambessa | 锏 | damage | Emissary、Conqueror、Quickstriker |
| 4 | Corki | 号角 | damage | Scrap、Artillerist |
| 4 | Dr. Mundo | 乌尔比安 | frontline | Experiment、Dominator |
| 4 | Ekko | 拉普兰德 | damage | Firelight、Scrap、Ambusher |
| 4 | Elise | 归溟幽灵鲨 | summoner | Black Rose、Form Swapper、Bruiser |
| 4 | Garen | 塞雷娅 | frontline | Emissary、Watcher |
| 4 | Heimerdinger | 白面鸮 | healer | Academy、Visionary |
| 4 | Illaoi | 歌蕾蒂娅 | control | Rebel、Sentinel |
| 4 | Silco | 多萝西 | summoner | Chem-Baron、Dominator |
| 4 | Twitch | 远牙 | damage | Experiment、Sniper |
| 4 | Vi | 耀骑士临光 | frontline | Enforcer、Pit Fighter |
| 4 | Zoe | 卡涅利安 | control | Rebel、Sorcerer |
| 5 | Caitlyn | 蕾缪安 | damage | Enforcer、Sniper |
| 5 | Jayce | 缪尔赛思 | control | Academy、Form Swapper |
| 5 | Jinx | 凛御银灰 | control | Rebel、Ambusher |
| 5 | LeBlanc | 令 | summoner | Black Rose、Sorcerer |
| 5 | Malzahar | 圣聆初雪 | control | Automata、Visionary |
| 5 | Mordekaiser | 余 | frontline | Conqueror、Dominator |
| 5 | Rumble | 维娜·维多利亚 | summoner | Junker King、Scrap、Sentinel |
| 5 | Sevika | 新约能天使 | damage | High Roller、Chem-Baron、Pit Fighter |

## 26 项天然特性

费用分布对象的键为费档 1–5。档位区间直接来自该 patch 的 minUnits/maxUnits（25000 表示无上限）。exact 档位按原生区间保留，不统一门槛。

| 中性盟约（Set 13 trait） | 自然人数 | 费用分布 | 档位区间 | 高档需额外身份 | Set 13 自然成员 |
|---|---:|---|---|---|---|
| 机巧 (Automata) | 5 | {"1":1,"2":1,"3":2,"4":0,"5":1} | 2–3 / 4–5 / 6–∞ | 需转职/额外身份 | Amumu、Nocturne、Blitzcrank、Kog'Maw、Malzahar |
| 术式 (Sorcerer) | 7 | {"1":2,"2":1,"3":2,"4":1,"5":1} | 2–3 / 4–5 / 6–7 / 8–∞ | 需转职/额外身份 | Lux、Zyra、Vladimir、Nami、Swain、Zoe、LeBlanc |
| 战地整备 (Scrap) | 7 | {"1":2,"2":1,"3":1,"4":2,"5":1} | 2–3 / 4–5 / 6–8 / 9–∞ | 需转职/额外身份 | Powder、Trundle、Ziggs、Gangplank、Corki、Ekko、Rumble |
| 炮术 (Artillerist) | 4 | {"1":0,"2":2,"3":1,"4":1,"5":0} | 2–3 / 4–5 / 6–∞ | 需转职/额外身份 | Tristana、Urgot、Ezreal、Corki |
| 双形 (Form Swapper) | 4 | {"1":0,"2":0,"3":2,"4":1,"5":1} | 2–3 / 4–∞ | 自然人数可达 | Gangplank、Swain、Elise、Jayce |
| 领军 (Emissary) | 4 | {"1":0,"2":1,"3":1,"4":2,"5":0} | 1–1 / 4–4 | 自然人数可达 | Tristana、Nami、Ambessa、Garen |
| 坚阵 (Sentinel) | 7 | {"1":2,"2":2,"3":1,"4":1,"5":1} | 2–3 / 4–5 / 6–∞ | 自然人数可达 | Irelia、Singed、Leona、Rell、Loris、Illaoi、Rumble |
| 并肩 (Family) | 3 | {"1":2,"2":1,"3":0,"4":0,"5":0} | 3–3 / 4–4 / 5–∞ | 需转职/额外身份 | Powder、Violet、Vander |
| 突袭 (Ambusher) | 5 | {"1":1,"2":1,"3":1,"4":1,"5":1} | 2–2 / 3–3 / 4–4 / 5–∞ | 自然人数可达 | Powder、Camille、Smeech、Ekko、Jinx |
| 技力协同 (Visionary) | 7 | {"1":2,"2":2,"3":1,"4":1,"5":1} | 2–3 / 4–5 / 6–7 / 8–∞ | 需转职/额外身份 | Morgana、Vex、Rell、Renata Glasc、Nunu & Willump、Heimerdinger、Malzahar |
| 狙击 (Sniper) | 5 | {"1":1,"2":1,"3":1,"4":1,"5":1} | 2–3 / 4–5 / 6–∞ | 需转职/额外身份 | Maddie、Zeri、Kog'Maw、Twitch、Caitlyn |
| 远征 (Conqueror) | 6 | {"1":2,"2":1,"3":1,"4":1,"5":1} | 2–3 / 4–5 / 6–8 / 9–∞ | 需转职/额外身份 | Darius、Draven、Rell、Swain、Ambessa、Mordekaiser |
| 圣枪 (High Roller) | 1 | {"1":0,"2":0,"3":0,"4":0,"5":1} | 1–∞ | 自然人数可达 | Sevika |
| 研发 (Academy) | 5 | {"1":1,"2":1,"3":1,"4":1,"5":1} | 3–3 / 4–4 / 5–5 / 6–∞ | 需转职/额外身份 | Lux、Leona、Ezreal、Heimerdinger、Jayce |
| 险境 (Chem-Baron) | 6 | {"1":1,"2":1,"3":2,"4":1,"5":1} | 3–3 / 4–4 / 5–5 / 6–6 / 7–∞ | 需转职/额外身份 | Singed、Renata Glasc、Renni、Smeech、Silco、Sevika |
| 逆潮 (Rebel) | 8 | {"1":2,"2":2,"3":1,"4":2,"5":1} | 3–4 / 5–6 / 7–9 / 10–∞ | 需转职/额外身份 | Irelia、Vex、Akali、Sett、Ezreal、Illaoi、Zoe、Jinx |
| 掌控 (Dominator) | 6 | {"1":0,"2":1,"3":2,"4":2,"5":1} | 2–3 / 4–5 / 6–∞ | 自然人数可达 | Ziggs、Blitzcrank、Cassiopeia、Dr. Mundo、Silco、Mordekaiser |
| 决斗 (Pit Fighter) | 6 | {"1":2,"2":1,"3":1,"4":1,"5":1} | 2–3 / 4–5 / 6–7 / 8–∞ | 需转职/额外身份 | Draven、Violet、Urgot、Gangplank、Vi、Sevika |
| 围剿 (Enforcer) | 7 | {"1":2,"2":1,"3":2,"4":1,"5":1} | 2–3 / 4–5 / 6–7 / 8–9 / 10–∞ | 需转职/额外身份 | Maddie、Steb、Camille、Loris、Twisted Fate、Vi、Caitlyn |
| 游击 (Firelight) | 3 | {"1":0,"2":1,"3":1,"4":1,"5":0} | 2–2 / 3–3 / 4–∞ | 需转职/额外身份 | Zeri、Scar、Ekko |
| 共生 (Experiment) | 5 | {"1":1,"2":1,"3":1,"4":2,"5":0} | 3–4 / 5–6 / 7–∞ | 需转职/额外身份 | Zyra、Urgot、Nunu & Willump、Dr. Mundo、Twitch |
| 重装 (Bruiser) | 6 | {"1":2,"2":1,"3":2,"4":1,"5":0} | 2–3 / 4–5 / 6–∞ | 自然人数可达 | Steb、Trundle、Sett、Nunu & Willump、Renni、Elise |
| 铸军 (Junker King) | 1 | {"1":0,"2":0,"3":0,"4":0,"5":1} | 1–∞ | 自然人数可达 | Rumble |
| 幻造 (Black Rose) | 5 | {"1":1,"2":1,"3":1,"4":1,"5":1} | 3–3 / 4–4 / 5–6 / 7–∞ | 需转职/额外身份 | Morgana、Vladimir、Cassiopeia、Elise、LeBlanc |
| 迅击 (Quickstriker) | 4 | {"1":0,"2":2,"3":1,"4":1,"5":0} | 2–2 / 3–3 / 4–∞ | 自然人数可达 | Akali、Nocturne、Twisted Fate、Ambessa |
| 守望 (Watcher) | 6 | {"1":2,"2":2,"3":1,"4":1,"5":0} | 2–3 / 4–5 / 6–∞ | 自然人数可达 | Amumu、Darius、Vander、Vladimir、Scar、Garen |

## 转职与强化候选

此表的附赠单位和物品来自锁定的Set 13来源记录；是否可选及本模式的实际奖励以rulesVersion 3 catalog为准，不表示来源附赠均已逐项复刻。

| Set 13 强化 | 盟约 | Source API 名 | Set 13 原描述 | 来源记录中的单位 | 来源记录中的物品 | 当前模式适配 |
|---|---|---|---|---|---|---|
| Academy Crest | 研发 | TFT13_Augment_AcademyCrest | Gain an Academy Emblem and a Leona. | 泡泡 | Academy Emblem | 转职与奖励以当前catalog为准 |
| Academy Crown | 研发 | TFT13_Augment_AcademyCrown | Gain an Academy Emblem and a random sponsored item. | 未记录 | Academy Emblem | 转职与奖励以当前catalog为准 |
| Ambusher Crest | 突袭 | TFT13_Augment_AmbusherCrest | Gain an Ambusher Emblem and a Camille. | 砾 | Ambusher Emblem | 转职与奖励以当前catalog为准 |
| Ambusher Crown | 突袭 | TFT13_Augment_AmbusherCrown | Gain an Ambusher Emblem, a Hand of Justice, and a Camille. | 砾 | Ambusher Emblem、Hand Of Justice | 转职与奖励以当前catalog为准 |
| Artillerist Crest | 炮术 | TFT13_Augment_ArtilleristCrest | Gain an Artillerist Emblem and a Tristana. | 能天使 | Artillerist Emblem | 转职与奖励以当前catalog为准 |
| Artillerist Crown | 炮术 | TFT13_Augment_ArtilleristCrown | Gain an Artillerist Emblem, a Runaan's Hurricane, and a Tristana. | 能天使 | Artillerist Emblem、Runaan's Hurricane | 转职与奖励以当前catalog为准 |
| Fractured Crystals | 机巧 | TFT13_Augment_Automata | When an Automata champion fires their blast, they fire a second blast at the closest enemy dealing @Percentage*100@% of the original damage. Gain an Amumu and Nocturne. | 角峰、因陀罗 | 未记录 | 战斗效果以当前catalog为准 |
| Automata Crest | 机巧 | TFT13_Augment_AutomataCrest | Gain an Automata Emblem and a Nocturne. | 因陀罗 | Automata Emblem | 转职与奖励以当前catalog为准 |
| Automata Crown | 机巧 | TFT13_Augment_AutomataCrown | Gain an Automata Emblem, a Guardbreaker, and a Nocturne. | 因陀罗 | Automata Emblem、Guardbreaker | 转职与奖励以当前catalog为准 |
| Heavily Smash | 重装 | TFT13_Augment_Bruiser | Every @RefreshSeconds@ seconds, Bruisers deal @SlamPercentHealth*100@% bonus max Health bonus physical damage on their next attack. Gain a Steb and a Trundle. | 清流、宴 | 未记录 | 战斗效果以当前catalog为准 |
| Bruiser Crest | 重装 | TFT13_Augment_BruiserCrest | Gain a Bruiser Emblem and a Sett. | 深巡 | Bruiser Emblem | 转职与奖励以当前catalog为准 |
| Bruiser Crown | 重装 | TFT13_Augment_BruiserCrown | Gain a Bruiser Emblem, a Redemption, and a Sett. | 深巡 | Bruiser Emblem、Redemption | 转职与奖励以当前catalog为准 |
| Black Rose Crest | 幻造 | TFT13_Augment_CabalCrest | Gain a Black Rose Emblem. | 未记录 | Black Rose Emblem | 转职与奖励以当前catalog为准 |
| Black Rose Crown | 幻造 | TFT13_Augment_CabalCrown | Gain a Black Rose Emblem, a Morellonomicon, and a Cassiopeia. | 巫恋 | Black Rose Emblem、Morellonomicon | 转职与奖励以当前catalog为准 |
| Chem-Baron Crest | 险境 | TFT13_Augment_ChembaronCrest | Gain a Chem-Baron Emblem and a Renata Glasc. | 赫默 | Chem-Baron Emblem | 转职与奖励以当前catalog为准 |
| Chem-Baron Crown | 险境 | TFT13_Augment_ChembaronCrown | Gain a Chem-Baron Emblem, a Nashor's Tooth, and a Smeech. | 伊内丝 | Chem-Baron Emblem、Nashor's Tooth | 转职与奖励以当前catalog为准 |
| Noxian Guillotine | 远征 | TFT13_Augment_Conqueror | Conquerors execute enemies below @BaseExecuteThreshold@% Health. When they do, they gain @ArmorandMagicResist@ Armor and Magic Resist for the rest of combat. Gain a Darius and Draven. | 艾丝黛尔、普罗旺斯 | 未记录 | 战斗效果以当前catalog为准 |
| Conqueror Crest | 远征 | TFT13_Augment_ConquerorCrest | Gain a Conqueror Emblem and a Rell. | 雷蛇 | Conqueror Emblem | 转职与奖励以当前catalog为准 |
| Conqueror Crown | 远征 | TFT13_Augment_ConquerorCrown | Gain a Conqueror Emblem, a Last Whisper, and a Rell. | 雷蛇 | Conqueror Emblem、Last Whisper | 转职与奖励以当前catalog为准 |
| Domination | 掌控 | TFT13_Augment_Dominator | Dominators gain @ShieldPercentAS*100@% Attack Speed while shielded. When a Dominator gets a kill, all Dominators gain @ShieldAmount@ Shield for @ShieldDuration@ seconds. Gain a Cassiopeia. | 巫恋 | 未记录 | 战斗效果以当前catalog为准 |
| Dominator Crest | 掌控 | TFT13_Augment_DominatorCrest | Gain a Dominator Emblem and a Blitzcrank. | 星熊 | Dominator Emblem | 转职与奖励以当前catalog为准 |
| Dominator Crown | 掌控 | TFT13_Augment_DominatorCrown | Gain a Dominator Emblem, a Protector's Vow, and a Blitzcrank. | 星熊 | Dominator Emblem、Protector's Vow | 转职与奖励以当前catalog为准 |
| Enforcer Crest | 围剿 | TFT13_Augment_EnforcerCrest | Gain an Enforcer Emblem and a Loris. | 瑕光 | Enforcer Emblem | 转职与奖励以当前catalog为准 |
| Enforcer Crown | 围剿 | TFT13_Augment_EnforcerCrown | Gain an Enforcer Emblem, an Infinity Edge, and a Loris. | 瑕光 | Enforcer Emblem、Infinity Edge | 转职与奖励以当前catalog为准 |
| Family Crest | 并肩 | TFT13_Augment_FamilyCrest | Gain a Family Emblem and a Violet. | 休谟斯 | Family Emblem | 转职与奖励以当前catalog为准 |
| Family Crown | 并肩 | TFT13_Augment_FamilyCrown | Gain a Family Emblem, a Redemption, a Vander, and a Violet. | 休谟斯、折桠 | Family Emblem、Redemption | 转职与奖励以当前catalog为准 |
| Firelight Crest | 游击 | TFT13_Augment_FirelightCrest | Gain a Firelight Emblem and a Zeri. | 隐现 | Firelight Emblem | 转职与奖励以当前catalog为准 |
| Firelight Crown | 游击 | TFT13_Augment_FirelightCrown | Gain a Firelight Emblem, a Protector's Vow, and a Scar. | 缄默德克萨斯 | Firelight Emblem、Protector's Vow | 转职与奖励以当前catalog为准 |
| Pit Fighter Crest | 决斗 | TFT13_Augment_PitFighterCrest | Gain a Pit Fighter Emblem and an Urgot. | 灰毫 | Pit Fighter Emblem | 转职与奖励以当前catalog为准 |
| Pit Fighter Crown | 决斗 | TFT13_Augment_PitFighterCrown | Gain a Pit Fighter Emblem, a Sterak's Gage, and a Gangplank. | 风丸 | Pit Fighter Emblem、Sterak's Gage | 转职与奖励以当前catalog为准 |
| Adrenaline Burst | 迅击 | TFT13_Augment_Quickstriker | Combat start and every @TimeBetweenProcs@ seconds, all Quickstrikers attack @AttackSpeed*100@% faster for @BuffDuration@ seconds. Gain a Nocturne and Akali. | 德克萨斯、因陀罗 | 未记录 | 战斗效果以当前catalog为准 |
| Quickstriker Crest | 迅击 | TFT13_Augment_QuickstrikerCrest | Gain a Quickstriker Emblem and an Akali. | 德克萨斯 | Quickstriker Emblem | 转职与奖励以当前catalog为准 |
| Quickstriker Crown | 迅击 | TFT13_Augment_QuickstrikerCrown | Gain a Quickstriker Emblem, a Guinsoo's Rageblade, and a Nocturne. | 因陀罗 | Quickstriker Emblem、Guinsoo's Rageblade | 转职与奖励以当前catalog为准 |
| Rebel Crest | 逆潮 | TFT13_Augment_RebelCrest | Gain a Rebel Emblem and an Akali. | 德克萨斯 | Rebel Emblem | 转职与奖励以当前catalog为准 |
| Rebel Crown | 逆潮 | TFT13_Augment_RebelCrown | Gain a Rebel Emblem, a Jeweled Gauntlet, and an Akali. | 德克萨斯 | Rebel Emblem、Jeweled Gauntlet | 转职与奖励以当前catalog为准 |
| Scrap Crest | 战地整备 | TFT13_Augment_ScrapCrest | Gain a Scrap Emblem and a Ziggs. | 惊蛰 | Scrap Emblem | 转职与奖励以当前catalog为准 |
| Scrap Crown | 战地整备 | TFT13_Augment_ScrapCrown | Gain a Scrap Emblem, a Ziggs, and @NumComponents@ random components. | 惊蛰 | Scrap Emblem | 转职与奖励以当前catalog为准 |
| Shield Bash | 坚阵 | TFT13_Augment_Sentinel | Sentinels gain @PercGain*100@% bonus Armor and Magic Resist. Every @Interval@ seconds, their next attack deals @ResistToDamageRatio*100@% of their total resistances as magic damage. Gain a Loris. | 瑕光 | 未记录 | 战斗效果以当前catalog为准 |
| Sentinel Crest | 坚阵 | TFT13_Augment_SentinelCrest | Gain a Sentinel Emblem and a Rell. | 雷蛇 | Sentinel Emblem | 转职与奖励以当前catalog为准 |
| Sentinel Crown | 坚阵 | TFT13_Augment_SentinelCrown | Gain a Sentinel Emblem, a Crownguard, and a Loris. | 瑕光 | Sentinel Emblem、Crownguard | 转职与奖励以当前catalog为准 |
| Sniper Crest | 狙击 | TFT13_Augment_SniperCrest | Gain a Sniper Emblem and a Zeri. | 隐现 | Sniper Emblem | 转职与奖励以当前catalog为准 |
| Sniper Crown | 狙击 | TFT13_Augment_SniperCrown | Gain a Sniper Emblem, an Infinity Edge, and a Zeri. | 隐现 | Sniper Emblem、Infinity Edge | 转职与奖励以当前catalog为准 |
| Arcane Retribution | 术式 | TFT13_Augment_Sorcerer | When Sorcerers die, they deal @DeathPercentage*100@% of their Ability Power as magic damage to all adjacent units. Gain a Vladimir. | 刺玫 | 未记录 | 战斗效果以当前catalog为准 |
| Sorcerer Crest | 术式 | TFT13_Augment_SorcererCrest | Gain a Sorcerer Emblem and a Vladimir. | 刺玫 | Sorcerer Emblem | 转职与奖励以当前catalog为准 |
| Sorcerer Crown | 术式 | TFT13_Augment_SorcererCrown | Gain a Sorcerer Emblem, an Adaptive Helm, and a Vladimir. | 刺玫 | Sorcerer Emblem、Adaptive Helm | 转职与奖励以当前catalog为准 |
| Visionary Crest | 技力协同 | TFT13_Augment_VisionaryCrest | Gain a Visionary Emblem and a Renata Glasc. | 赫默 | Visionary Emblem | 转职与奖励以当前catalog为准 |
| Visionary Crown | 技力协同 | TFT13_Augment_VisionaryCrown | Gain a Visionary Emblem, a Spear of Shojin, and a Renata Glasc. | 赫默 | Visionary Emblem、Spear of Shojin | 转职与奖励以当前catalog为准 |
| Battle Scars | 守望 | TFT13_Augment_Watcher | Every time Watchers are attacked, they gain @IncreaseADByTakeAttack@% Attack Damage. Every time Watchers are hit by an ability, they gain @IncreaseAPByTakeSpell@ Ability Power. Gain a Vander. | 折桠 | 未记录 | 战斗效果以当前catalog为准 |
| Watcher Crest | 守望 | TFT13_Augment_WatcherCrest | Gain a Watcher Emblem and a Vander. | 折桠 | Watcher Emblem | 转职与奖励以当前catalog为准 |
| Watcher Crown | 守望 | TFT13_Augment_WatcherCrown | Gain a Watcher Emblem, a Steadfast Heart, and a Scar. | 缄默德克萨斯 | Watcher Emblem、Steadfast Heart | 转职与奖励以当前catalog为准 |

## 首版战力预算（待真实 Battle Audit）

一星基础 HP 目标为 1100/1450/1900/2350/3100，DPS 目标为 130/180/260/350/470，依次对应费档 1–5。角色相对系数：

- frontline: HP ×1.55, DPS ×0.75
- damage: HP ×0.8, DPS ×1.1
- control: HP ×0.85, DPS ×0.8
- healer: HP ×0.8, DPS ×0.75
- summoner: HP ×0.85, DPS ×0.75
- support: HP ×0.85, DPS ×0.65

升星预算倍率：HP为1星 ×1、2星 ×1.8、3星 ×3.24；ATK为1星 ×1、2星 ×1.5、3星 ×2.25。固定技能保留其原生升星成长并纳入实战贡献校准。固定技能、冷却、覆盖范围、治疗、控制、召唤、装备及防御均须进入独立实战预算；这些标称数值不是强度验收结果。

## 来源机制与完整变量

### 机巧 · Automata

原始描述：Automata gain a crystal when they deal damage. At @TriggerNumCrystals@&nbsp;crystals, they blast their current target, dealing magic damage + @ConversionDamagePct*100@% of damage dealt since the previous blast and reset. They also gain Armor and Magic&nbsp;Resist. (@MinUnits@) @MagicDamage@ damage, @Resists@&nbsp;%i:scaleArmor%%i:scaleMR%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "ConversionDamagePct": 0.25,
      "MagicDamage": 150,
      "Resists": 20,
      "TriggerNumCrystals": 20,
      "{a142f31c}": 1
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "ConversionDamagePct": 0.25,
      "MagicDamage": 350,
      "Resists": 50,
      "TriggerNumCrystals": 20,
      "{a142f31c}": 1
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "ConversionDamagePct": 0.25,
      "MagicDamage": 800,
      "Resists": 100,
      "TriggerNumCrystals": 20,
      "{a142f31c}": 1
    }
  }
]
```

### 术式 · Sorcerer

原始描述：Your team gains @TeamAP@ Ability Power. Sorcerers gain more. (@MinUnits@) @BaseAP@&nbsp;%i:scaleAP% (@MinUnits@) @BaseAP@&nbsp;%i:scaleAP% (@MinUnits@) @BaseAP@&nbsp;%i:scaleAP% (@MinUnits@) @BaseAP@&nbsp;%i:scaleAP%, Abilities reduce their target's damage by @DamageDecrease*100@% for @DamageDecreaseDuration@&nbsp;seconds

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "BaseAP": 20,
      "TeamAP": 10
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "BaseAP": 50,
      "TeamAP": 10
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 7,
    "style": 5,
    "variables": {
      "BaseAP": 85,
      "TeamAP": 10
    }
  },
  {
    "minUnits": 8,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "BaseAP": 100,
      "DamageDecrease": 0.25,
      "DamageDecreaseDuration": 3,
      "TeamAP": 10
    }
  }
]
```

### 战地整备 · Scrap

原始描述：Combat start: Components held by Scrap units temporarily turn into full items. Scrap units gain Shield for @ShieldDuration@ seconds for each component held by your team, including those that make up a full item. (@MinUnits@) @NumComponents@ component, @HPShieldAmount@ Shield (@MinUnits@) @NumComponents@ components, @HPShieldAmount@ Shield (@MinUnits@) All components, and full items become lucky! @HPShieldAmount@ Shield (@MinUnits@) Generate Radiant items! @HPShieldAmount@ Shield Shield Amount:&nbsp;@TFTUnitProperty.:TFT13_Trait_Scrap_ShieldTotal@

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "HPShieldAmount": 25,
      "NumComponents": 1,
      "ShieldDuration": 30,
      "{659aef8d}": null,
      "{7e2474c8}": null
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "HPShieldAmount": 40,
      "NumComponents": 3,
      "ShieldDuration": 30,
      "{659aef8d}": null,
      "{7e2474c8}": null
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 8,
    "style": 5,
    "variables": {
      "HPShieldAmount": 60,
      "NumComponents": 20,
      "ShieldDuration": 30,
      "{659aef8d}": 1,
      "{7e2474c8}": null
    }
  },
  {
    "minUnits": 9,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "HPShieldAmount": 70,
      "NumComponents": 20,
      "ShieldDuration": 30,
      "{659aef8d}": 1,
      "{7e2474c8}": 1
    }
  }
]
```

### 炮术 · Artillerist

原始描述：Every @NumOfAttacks@ attacks, Artillerists launch a rocket that deals @PercentDamage*100@% Attack Damage around the target. They also gain Attack Damage. (@MinUnits@) @AD*100@% %i:scaleAD% (@MinUnits@) @AD*100@%&nbsp;%i:scaleAD% (@MinUnits@) @AD*100@%&nbsp;%i:scaleAD%, Launch a rocket every @NumOfAttacks@ attacks that deals double&nbsp;damage.

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "AD": 0.10000000149011612,
      "NumOfAttacks": 5,
      "PercentDamage": 1.25
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 5,
    "variables": {
      "AD": 0.4000000059604645,
      "NumOfAttacks": 5,
      "PercentDamage": 1.25
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "AD": 0.5,
      "NumOfAttacks": 4,
      "PercentDamage": 2.5
    }
  }
]
```

### 双形 · Form Swapper

原始描述：Innate: Form Swappers change their stats and ability based on if they're placed in the front 2 rows or back 2&nbsp;rows. Frontline Form Swappers gain Durability. Backline Form Swappers gain Damage&nbsp;Amp. (@MinUnits@) @DR*100@%&nbsp;%i:scaleDR% or @DA*100@%&nbsp;%i:scaleDA%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "DA": 0.20000000298023224,
      "DR": 0.15000000596046448
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "DA": 0.4000000059604645,
      "DR": 0.30000001192092896
    }
  }
]
```

### 领军 · Emissary

原始描述：This trait is active only when you have exactly 1 or 4 unique Emissaries. (@MinUnits@) Gain that Emissary's bonus (@MinUnits@) Gain all bonuses. Emissaries gain @BonusHealth@&nbsp;%i:scaleHealth% and @SelfishDamageAmp*100@%&nbsp;%i:scaleDA% Ambessa: Allies gain @AmbessaArmor@ Armor and Magic Resist for each opponent defeated. (@TFTUnitProperty.trait:TFT13_Ambassador_PlayersDefeated@/7) Garen: On Combat Start, Garen and allies to his left and right gain @GarenHealthPercent*100@% of his max Health. Nami: Allies' attacks grant @NamiMana@ bonus Mana. Tristana: Allies gain @StarAS*100@% Attack Speed per star level.

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 1,
    "maxUnits": 1,
    "style": 1,
    "variables": {
      "AmbessaArmor": 2,
      "AmbessaArmor_PVE": 4,
      "BonusAS": null,
      "BonusHealth": 200,
      "CCImmuneDuration": 8,
      "GarenHealthPercent": 0.20000000298023224,
      "NamiMana": 2,
      "SelfishDamageAmp": 0.20000000298023224,
      "StarAS": 0.05999999865889549,
      "{3854f478}": 2,
      "{4b20f990}": null,
      "{845be53a}": 4
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 4,
    "style": 5,
    "variables": {
      "AmbessaArmor": 2,
      "AmbessaArmor_PVE": 4,
      "BonusAS": null,
      "BonusHealth": 200,
      "CCImmuneDuration": 8,
      "GarenHealthPercent": 0.20000000298023224,
      "NamiMana": 2,
      "SelfishDamageAmp": 0.20000000298023224,
      "StarAS": 0.05999999865889549,
      "{3854f478}": 2,
      "{4b20f990}": null,
      "{845be53a}": 4
    }
  }
]
```

### 坚阵 · Sentinel

原始描述：Your team gains Armor and Magic Resist. Sentinels gain triple. (@MinUnits@) @BonusArmor@&nbsp;%i:scaleArmor%%i:scaleMR%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "BonusArmor": 12,
      "{5921fc26}": 2
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "BonusArmor": 25,
      "{5921fc26}": 2
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "BonusArmor": 42,
      "{5921fc26}": 2
    }
  }
]
```

### 并肩 · Family

原始描述：Family members support each other, reducing their max Mana and gaining extra bonuses. (@MinUnits@) @ManaReduction*100@% reduction, @DamageReduction*100@%&nbsp;%i:scaleDR% (@MinUnits@) @ManaReduction*100@% reduction, @AttackSpeed*100@%&nbsp;%i:scaleAS% (@MinUnits@) @ManaReduction*100@% reduction, heist on topside! After combat, progress the heist, increased for each surviving Family&nbsp;member!

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 3,
    "maxUnits": 3,
    "style": 5,
    "variables": {
      "AttackSpeed": 0.20000000298023224,
      "DamageReduction": 0.15000000596046448,
      "ManaReduction": 0.25
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 4,
    "style": 5,
    "variables": {
      "AttackSpeed": 0.20000000298023224,
      "DamageReduction": 0.15000000596046448,
      "ManaReduction": 0.30000001192092896
    }
  },
  {
    "minUnits": 5,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "AttackSpeed": 0.20000000298023224,
      "DamageReduction": 0.15000000596046448,
      "ManaReduction": 0.4000000059604645,
      "{01fcc30b}": 0.75,
      "{217874f1}": 2.5,
      "{43cb93dd}": 1.25,
      "{46c3fc24}": 1.5,
      "{6fc9f267}": 17,
      "{8173be81}": 2,
      "{9000fe5b}": 2,
      "{92029cea}": 0.5
    }
  }
]
```

### 突袭 · Ambusher

原始描述：Damage from Ambushers' Abilities can critically strike. They also gain bonus Critical Strike Chance and Critical Strike Damage. (@MinUnits@) @CritChance*100@%&nbsp;%i:scaleCrit%, @CritDamage*100@%&nbsp;%i:scaleCritMult% (@MinUnits@) @CritChance*100@%&nbsp;%i:scaleCrit%, @CritDamage*100@%&nbsp;%i:scaleCritMult% (@MinUnits@) @CritChance*100@%&nbsp;%i:scaleCrit%, @CritDamage*100@%&nbsp;%i:scaleCritMult% (@MinUnits@) @CritChance*100@%&nbsp;%i:scaleCrit%, @CritDamage*100@%&nbsp;%i:scaleCritMult%; also gain @DamageReductionPct*100@% Durability

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 2,
    "style": 1,
    "variables": {
      "CritChance": 0.20000000298023224,
      "CritDamage": 0.10000000149011612
    }
  },
  {
    "minUnits": 3,
    "maxUnits": 3,
    "style": 3,
    "variables": {
      "CritChance": 0.30000001192092896,
      "CritDamage": 0.20000000298023224
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 4,
    "style": 3,
    "variables": {
      "CritChance": 0.4000000059604645,
      "CritDamage": 0.30000001192092896
    }
  },
  {
    "minUnits": 5,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "CritChance": 0.550000011920929,
      "CritDamage": 0.3499999940395355,
      "DamageReductionPct": 0.15000000596046448
    }
  }
]
```

### 技力协同 · Visionary

原始描述：Whenever Visionaries gain Mana, they gain more. (@MinUnits@) @EnlightenedBonusMana*100@% %i:scaleMana% (@MinUnits@) @EnlightenedBonusMana*100@%&nbsp;%i:scaleMana% (@MinUnits@) @EnlightenedBonusMana*100@%&nbsp;%i:scaleMana% (@MinUnits@) @EnlightenedBonusMana*100@%&nbsp;%i:scaleMana%, Abilities heal an ally for @AllyHealing*100@% of damage dealt

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "EnlightenedBonusMana": 0.25
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "EnlightenedBonusMana": 0.5
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 7,
    "style": 5,
    "variables": {
      "EnlightenedBonusMana": 0.800000011920929
    }
  },
  {
    "minUnits": 8,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "AllyHealing": 0.20000000298023224,
      "EnlightenedBonusMana": 1
    }
  }
]
```

### 狙击 · Sniper

原始描述：Snipers deal more damage to targets farther away. (@MinUnits@) @PercentDamageIncrease@%&nbsp;damage per hex (@MinUnits@) @PercentDamageIncrease@%&nbsp;damage per hex (@MinUnits@) @PercentDamageIncrease@%&nbsp;damage per hex and +@BonusHexRangeIncrease@ Attack Range

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "BonusHexRangeIncrease": null,
      "PercentDamageIncrease": 7
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 5,
    "variables": {
      "BonusHexRangeIncrease": null,
      "PercentDamageIncrease": 16
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "BonusHexRangeIncrease": 5,
      "PercentDamageIncrease": 35
    }
  }
]
```

### 远征 · Conqueror

原始描述：Conquerors' takedowns grant stacks of Conquest. After gaining enough Conquest, open War Chests full of loot! Conquerors gain Attack Damage and Ability Power, increased by @PercentIncreasePerChest*100@% for each War Chest opened. (@MinUnits@) @ADAPBase*100@%&nbsp;%i:scaleAD%%i:scaleAP%; @StacksPerKill@x&nbsp;Conquest War Chests Opened: @TFTUnitProperty.trait:TFT13_Warband_ChestsCompleted@ Current Stats: @TFTUnitProperty.trait:TFT13_Warband_CurrentADAP@%&nbsp;%i:scaleAD%%i:scaleAP%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "ADAPBase": 0.1599999964237213,
      "PercentIncreasePerChest": 0.029999999329447746,
      "StacksPerKill": 1
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "ADAPBase": 0.25,
      "PercentIncreasePerChest": 0.029999999329447746,
      "StacksPerKill": 3
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 8,
    "style": 5,
    "variables": {
      "ADAPBase": 0.4000000059604645,
      "PercentIncreasePerChest": 0.029999999329447746,
      "StacksPerKill": 6
    }
  },
  {
    "minUnits": 9,
    "maxUnits": 25000,
    "style": 6,
    "variables": {
      "ADAPBase": 1,
      "PercentIncreasePerChest": 0.029999999329447746,
      "StacksPerKill": 20
    }
  }
]
```

### 圣枪 · High Roller

原始描述：When casting, Sevika rolls a random Jinx modification to her Ability and gains @Durability*100@% Durability for @Duration@ seconds. Mods: -Rocket: Launch @Bonus1NumRockets@ rockets that deal @Bonus1RocketDamage@ physical damage each -Shield: Gain @Bonus2ShieldAmount@ Shield for @Bonus2ShieldDuration@ seconds -Coin: Gain @Bonus4Gold@ gold -Triple: Enhance her rolled ability!

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 1,
    "maxUnits": 25000,
    "style": 4,
    "variables": {
      "Bonus1NumRockets": 8,
      "Bonus1RocketDamage": 100,
      "Bonus2ShieldAmount": 500,
      "Bonus2ShieldDuration": 4,
      "Bonus4Gold": 3,
      "Durability": 0.800000011920929,
      "Duration": 1.5,
      "{01148678}": 0.3499999940395355,
      "{267deafa}": 0.3499999940395355,
      "{52aec87f}": 0.10000000149011612,
      "{592d23e5}": 0.3499999940395355,
      "{699f6a87}": 0.20000000298023224,
      "{9ad9e572}": 0.004999999888241291,
      "{9b22c5ec}": null,
      "{bcedb441}": 1.5,
      "{e1fc0fa1}": 0.24500000476837158,
      "{e640e05f}": 0.4000000059604645
    }
  }
]
```

### 研发 · Academy

原始描述：The Academy sponsors 3 items each game. Copies of sponsored items grant bonus max Health and Damage Amp. Academy units holding sponsored items gain double the amount, plus an additional @BaseValues*100@% Health and Damage Amp. (@MinUnits@) @PercentIncreaseSponsored*100@% %i:scaleHealth% %i:scaleDA%; gain 1 sponsored item. (@MinUnits@) @PercentIncreaseSponsored*100@% %i:scaleHealth% %i:scaleDA%; gain 1 sponsored item. (@MinUnits@) @PercentIncreaseSponsored*100@% %i:scaleHealth% %i:scaleDA%; gain 1 sponsored item. (@MinUnits@) @PercentIncreaseSponsored*100@% %i:scaleHealth% %i:scaleDA%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 3,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "BaseValues": 0.05000000074505806,
      "NumOfItems": 1,
      "PercentIncreaseSponsored": 0.019999999552965164
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 4,
    "style": 3,
    "variables": {
      "BaseValues": 0.05000000074505806,
      "NumOfItems": 2,
      "PercentIncreaseSponsored": 0.029999999329447746
    }
  },
  {
    "minUnits": 5,
    "maxUnits": 5,
    "style": 5,
    "variables": {
      "BaseValues": 0.05000000074505806,
      "NumOfItems": 3,
      "PercentIncreaseSponsored": 0.03999999910593033
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "BaseValues": 0.05000000074505806,
      "NumOfItems": 3,
      "PercentIncreaseSponsored": 0.07999999821186066
    }
  }
]
```

### 险境 · Chem-Baron

原始描述：Gain Shimmer after each player combat. If your loss streak is at least @MinStreakLength@, gain more. At each stack of @ShimmerBreakpoint@ Shimmer, the Black Market offers you contraband that only Chem-Barons can use. Chem-Barons gain max Health for each Black Market you pass on. (@MinUnits@) @ShimmerPerCombat@ or @ShimmerPerCombatStreaking@; @HealthPerSkip@&nbsp;%i:scaleHealth% Markets Skipped: @TFTUnitProperty.trait:TFT13_Crime_PassedMarkets@ Current Health: @TFTUnitProperty.trait:TFT13_Crime_CurrentHealth@&nbsp;%i:scaleHealth%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 3,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "HealthPerSkip": 20,
      "MinStreakLength": 3,
      "ShimmerBreakpoint": 100,
      "ShimmerPerCombat": 15,
      "ShimmerPerCombatStreaking": 30,
      "ShimmerPerCombatStreaking_HR": 50,
      "ShimmerPerCombat_HR": 25,
      "ShimmerPerDeath_PVE": 1,
      "ShimmerPerRound_PVE": 15,
      "{ecbc38fd}": 1
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 4,
    "style": 3,
    "variables": {
      "HealthPerSkip": 50,
      "MinStreakLength": 3,
      "ShimmerBreakpoint": 100,
      "ShimmerPerCombat": 20,
      "ShimmerPerCombatStreaking": 40,
      "ShimmerPerCombatStreaking_HR": 60,
      "ShimmerPerCombat_HR": 30,
      "ShimmerPerDeath_PVE": 1,
      "ShimmerPerRound_PVE": 20,
      "{ecbc38fd}": 1
    }
  },
  {
    "minUnits": 5,
    "maxUnits": 5,
    "style": 5,
    "variables": {
      "HealthPerSkip": 90,
      "MinStreakLength": 3,
      "ShimmerBreakpoint": 100,
      "ShimmerPerCombat": 20,
      "ShimmerPerCombatStreaking": 50,
      "ShimmerPerCombatStreaking_HR": 70,
      "ShimmerPerCombat_HR": 35,
      "ShimmerPerDeath_PVE": 2,
      "ShimmerPerRound_PVE": 30,
      "{ecbc38fd}": 1
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 6,
    "style": 5,
    "variables": {
      "HealthPerSkip": 125,
      "MinStreakLength": 3,
      "ShimmerBreakpoint": 100,
      "ShimmerPerCombat": 25,
      "ShimmerPerCombatStreaking": 70,
      "ShimmerPerCombatStreaking_HR": 90,
      "ShimmerPerCombat_HR": 45,
      "ShimmerPerDeath_PVE": 3,
      "ShimmerPerRound_PVE": 40,
      "{ecbc38fd}": 1
    }
  },
  {
    "minUnits": 7,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "HealthPerSkip": 180,
      "MinStreakLength": 3,
      "ShimmerBreakpoint": 100,
      "ShimmerPerCombat": 30,
      "ShimmerPerCombatStreaking": 100,
      "ShimmerPerCombatStreaking_HR": 125,
      "ShimmerPerCombat_HR": 60,
      "ShimmerPerDeath_PVE": 15,
      "ShimmerPerRound_PVE": 65,
      "{ecbc38fd}": 1
    }
  }
]
```

### 逆潮 · Rebel

原始描述：Rebels gain @MaxHealthIncrease*100@% max Health. After your team loses @PercentHealthTrigger*100@% of their Health, a smoke signal appears, granting Rebels @BurstAS*100@% Attack Speed for @BurstDuration@ seconds and extra power for the rest of&nbsp;combat. (@MinUnits@) @ADAP*100@%&nbsp;%i:scaleAD%%i:scaleAP% (@MinUnits@) @ADAP*100@%&nbsp;%i:scaleAD%%i:scaleAP%, @PercentMaxHealthBonus*100@%&nbsp;%i:scaleHealth% (@MinUnits@) @ADAP*100@%&nbsp;%i:scaleAD%%i:scaleAP%, @PercentMaxHealthBonus*100@%&nbsp;%i:scaleHealth%, and Stun all enemies for @StunDuration@&nbsp;seconds (@MinUnits@) The smoke signal triggers at Combat Start and every @ForceDuration@&nbsp;seconds.

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 3,
    "maxUnits": 4,
    "style": 1,
    "variables": {
      "ADAP": 0.20000000298023224,
      "BurstAS": 0.6000000238418579,
      "BurstDuration": 4,
      "ForceDuration": null,
      "MaxHealthIncrease": 0.11999999731779099,
      "PercentHealthTrigger": 0.30000001192092896,
      "PercentMaxHealthBonus": null,
      "StunDuration": null,
      "{1ec59053}": null
    }
  },
  {
    "minUnits": 5,
    "maxUnits": 6,
    "style": 3,
    "variables": {
      "ADAP": 0.4000000059604645,
      "BurstAS": 0.6000000238418579,
      "BurstDuration": 4,
      "ForceDuration": null,
      "MaxHealthIncrease": 0.11999999731779099,
      "PercentHealthTrigger": 0.30000001192092896,
      "PercentMaxHealthBonus": 0.11999999731779099,
      "StunDuration": null,
      "{1ec59053}": null
    }
  },
  {
    "minUnits": 7,
    "maxUnits": 9,
    "style": 5,
    "variables": {
      "ADAP": 0.44999998807907104,
      "BurstAS": 0.6000000238418579,
      "BurstDuration": 4,
      "ForceDuration": null,
      "MaxHealthIncrease": 0.11999999731779099,
      "PercentHealthTrigger": 0.30000001192092896,
      "PercentMaxHealthBonus": 0.15000000596046448,
      "StunDuration": 2,
      "{1ec59053}": null
    }
  },
  {
    "minUnits": 10,
    "maxUnits": 25000,
    "style": 6,
    "variables": {
      "ADAP": 0.5,
      "BurstAS": 0.6000000238418579,
      "BurstDuration": 4,
      "ForceDuration": 8,
      "MaxHealthIncrease": 0.11999999731779099,
      "PercentHealthTrigger": 0.30000001192092896,
      "PercentMaxHealthBonus": 0.30000001192092896,
      "StunDuration": 2,
      "{1ec59053}": 1
    }
  }
]
```

### 掌控 · Dominator

原始描述：Combat start: Dominators gain a Shield for @ShieldDuration@ seconds. When Dominators cast, they gain stacking Ability Power based on the Mana spent. (@MinUnits@) @ShieldAmount@ Shield, @APPercent*100@%&nbsp;%i:scaleAP%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "APPercent": 0.25,
      "ShieldAmount": 350,
      "ShieldDuration": 15
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "APPercent": 0.44999998807907104,
      "ShieldAmount": 500,
      "ShieldDuration": 15
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "APPercent": 0.6499999761581421,
      "ShieldAmount": 700,
      "ShieldDuration": 15
    }
  }
]
```

### 决斗 · Pit Fighter

原始描述：Pit Fighters gain @OmnivampPercent*100@% Omnivamp and deal bonus true damage. Once per combat at @HealthThreshold*100@% Health, they heal a percentage of their max Health over @Duration@ seconds. (@MinUnits@) @TrueDamagePercent*100@%&nbsp;true damage, @HealPercent*100@%&nbsp;%i:scaleHealth%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "Duration": 2,
      "HealPercent": 0.10000000149011612,
      "HealthThreshold": 0.5,
      "OmnivampPercent": 0.15000000596046448,
      "TrueDamagePercent": 0.05999999865889549
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "Duration": 2,
      "HealPercent": 0.25,
      "HealthThreshold": 0.5,
      "OmnivampPercent": 0.15000000596046448,
      "TrueDamagePercent": 0.11999999731779099
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 7,
    "style": 5,
    "variables": {
      "Duration": 2,
      "HealPercent": 0.4000000059604645,
      "HealthThreshold": 0.5,
      "OmnivampPercent": 0.15000000596046448,
      "TrueDamagePercent": 0.20000000298023224
    }
  },
  {
    "minUnits": 8,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "Duration": 2,
      "HealPercent": 0.9900000095367432,
      "HealthThreshold": 0.5,
      "OmnivampPercent": 0.15000000596046448,
      "TrueDamagePercent": 0.5
    }
  }
]
```

### 围剿 · Enforcer

原始描述：Combat Start: Enforcers gain Shield and Damage Amp. The highest Health enemy units become WANTED! When a Wanted enemy dies, Enforcers gain @AttackSpeedPerWantedKill*100@% Attack Speed. (@MinUnits@) @NumOfWantedEnemies@&nbsp;units; @PercentMaxHealthShield*100*100@%&nbsp;%i:scaleHealth%,&nbsp;@BaseDA*100@%&nbsp;%i:scaleDA% (@MinUnits@) @NumOfWantedEnemies@&nbsp;units; @PercentMaxHealthShield*100*100@%&nbsp;%i:scaleHealth%,&nbsp;@BaseDA*100@%&nbsp;%i:scaleDA% (@MinUnits@) @NumOfWantedEnemies@&nbsp;units; @PercentMaxHealthShield*100*100@%&nbsp;%i:scaleHealth%,&nbsp;@BaseDA*100@%&nbsp;%i:scaleDA% (@MinUnits@) @NumOfWantedEnemies@&nbsp;units; @PercentMaxHealthShield*100*100@%&nbsp;%i:scaleHealth%,&nbsp;@BaseDA*100@%&nbsp;%i:scaleDA% (@MinUnits@) ALL enemies; @PercentMaxHealthShield*100*100@%&nbsp;%i:scaleHealth%, @BaseDA*100@%&nbsp;%i:scaleDA%; Combat Start: Confiscate all enemy&nbsp;items!

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "AttackSpeedPerWantedKill": 0.30000001192092896,
      "BaseDA": 0.11999999731779099,
      "NumOfWantedEnemies": 1,
      "PercentMaxHealthShield": 0.11999999731779099,
      "{36b1550f}": null,
      "{9edd4912}": null
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "AttackSpeedPerWantedKill": 0.30000001192092896,
      "BaseDA": 0.20000000298023224,
      "NumOfWantedEnemies": 2,
      "PercentMaxHealthShield": 0.20000000298023224,
      "{36b1550f}": null,
      "{9edd4912}": null
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 7,
    "style": 5,
    "variables": {
      "AttackSpeedPerWantedKill": 0.30000001192092896,
      "BaseDA": 0.33000001311302185,
      "NumOfWantedEnemies": 4,
      "PercentMaxHealthShield": 0.30000001192092896,
      "{36b1550f}": null,
      "{9edd4912}": null
    }
  },
  {
    "minUnits": 8,
    "maxUnits": 9,
    "style": 5,
    "variables": {
      "AttackSpeedPerWantedKill": 0.30000001192092896,
      "BaseDA": 0.5,
      "NumOfWantedEnemies": 5,
      "PercentMaxHealthShield": 0.4000000059604645,
      "{36b1550f}": null,
      "{9edd4912}": null
    }
  },
  {
    "minUnits": 10,
    "maxUnits": 25000,
    "style": 6,
    "variables": {
      "AttackSpeedPerWantedKill": 0.30000001192092896,
      "BaseDA": 1.5,
      "NumOfWantedEnemies": 99,
      "PercentMaxHealthShield": 1,
      "{36b1550f}": null,
      "{9edd4912}": 1
    }
  }
]
```

### 游击 · Firelight

原始描述：Every @Duration@ seconds, Firelights dash. While dashing, they attack with infinite range and heal a percentage of the damage taken since their last dash. (@MinUnits@) @PercentDamageTakenHeal*100@% of damage taken (@MinUnits@) @PercentDamageTakenHeal*100@% of damage taken (@MinUnits@) @PercentDamageTakenHeal*100@% of damage taken. While dashing, gain a massive burst of Attack Speed.

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 2,
    "style": 1,
    "variables": {
      "Duration": 6,
      "PercentDamageTakenHeal": 0.25,
      "{0a9a9714}": null,
      "{3c0d594a}": 1
    }
  },
  {
    "minUnits": 3,
    "maxUnits": 3,
    "style": 5,
    "variables": {
      "Duration": 6,
      "PercentDamageTakenHeal": 0.4000000059604645,
      "{0a9a9714}": null,
      "{3c0d594a}": 1
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "Duration": 6,
      "PercentDamageTakenHeal": 0.44999998807907104,
      "{0a9a9714}": 3.5,
      "{3c0d594a}": 1
    }
  }
]
```

### 共生 · Experiment

原始描述：Gain Laboratory hexes on your board. Combat start: Experiments standing on Laboratory hexes gain the Experiment bonuses of all Experiments on Laboratory hexes, plus max Health. (@MinUnits@) @NumLaboratory@ Laboratories, @MaxHealth@&nbsp;%i:scaleHealth% (@MinUnits@) @NumLaboratory@ Laboratories, @MaxHealth@&nbsp;%i:scaleHealth% (@MinUnits@) Experiment bonuses increase by @ExperimentBonusIncrease*100@%!

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 3,
    "maxUnits": 4,
    "style": 1,
    "variables": {
      "ExperimentBonusIncrease": null,
      "MaxHealth": 100,
      "NumLaboratory": 2,
      "{a02e81c2}": 1.149999976158142
    }
  },
  {
    "minUnits": 5,
    "maxUnits": 6,
    "style": 5,
    "variables": {
      "ExperimentBonusIncrease": null,
      "MaxHealth": 300,
      "NumLaboratory": 3,
      "{a02e81c2}": 1.2999999523162842
    }
  },
  {
    "minUnits": 7,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "ExperimentBonusIncrease": 1,
      "MaxHealth": 200,
      "NumLaboratory": 3,
      "{a02e81c2}": 1.5
    }
  }
]
```

### 重装 · Bruiser

原始描述：Your team gains @TeamFlatHealth@ max Health. Bruisers gain more. (@MinUnits@) @BonusPercentHealth*100@%&nbsp;%i:scaleHealth%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "BonusPercentHealth": 0.20000000298023224,
      "TeamFlatHealth": 100
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "BonusPercentHealth": 0.44999998807907104,
      "TeamFlatHealth": 100
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "BonusPercentHealth": 0.800000011920929,
      "TeamFlatHealth": 100
    }
  }
]
```

### 铸军 · Junker King

原始描述：Every @NumRounds1Star@ rounds, open an armory to purchase permanent upgrades to your strongest Rumble's&nbsp;mech. Rounds Until Upgrade: @TFTUnitProperty.trait:TFT13_JunkerKing_RoundsUntilOpening@

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 1,
    "maxUnits": 25000,
    "style": 4,
    "variables": {
      "NumRounds1Star": 3,
      "NumRounds1Star_HR": 2,
      "{7b91cfd3}": 2,
      "{da177dfb}": 1,
      "{ea33712c}": 3,
      "{ed4fa85a}": 1
    }
  }
]
```

### 幻造 · Black Rose

原始描述：(@MinUnits@) Summon a chained Sion. He is freed after @NumCastsToUnlock@ casts from Black Rose units or when he drops below @PercentHealthUnlock*100@% health. (@MinUnits@) Sion grows stronger and his enemies take more damage from Black Rose units. (@MinUnits@) Sion unleashes dark magic and heals to full Health when freed. (@MinUnits@) When Sion dies, he restores to life with power beyond death! Each Black Rose champion's star level increases Sion's power

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 3,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "NumCastsToUnlock": 5,
      "PercentHealthPerStarLevel": 0.15000000596046448,
      "PercentHealthUnlock": 0.6499999761581421,
      "{2c6be05c}": 0.11999999731779099,
      "{2e45fc86}": 40,
      "{85b293ec}": 0.3499999940395355,
      "{92ef9cd7}": 4
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 4,
    "style": 3,
    "variables": {
      "NumCastsToUnlock": 5,
      "PercentHealthPerStarLevel": 0.15000000596046448,
      "PercentHealthUnlock": 0.6499999761581421,
      "{2c6be05c}": 0.11999999731779099,
      "{2e45fc86}": 60,
      "{85b293ec}": 0.3499999940395355,
      "{92ef9cd7}": 4
    }
  },
  {
    "minUnits": 5,
    "maxUnits": 6,
    "style": 5,
    "variables": {
      "NumCastsToUnlock": 5,
      "PercentHealthPerStarLevel": 0.15000000596046448,
      "PercentHealthUnlock": 0.6499999761581421,
      "{2c6be05c}": 0.11999999731779099,
      "{2e45fc86}": 90,
      "{85b293ec}": 0.3499999940395355,
      "{92ef9cd7}": 4
    }
  },
  {
    "minUnits": 7,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "NumCastsToUnlock": 5,
      "PercentHealthPerStarLevel": 0.15000000596046448,
      "PercentHealthUnlock": 0.6499999761581421,
      "{2c6be05c}": 0.11999999731779099,
      "{2e45fc86}": 120,
      "{85b293ec}": 0.3499999940395355,
      "{92ef9cd7}": 4
    }
  }
]
```

### 迅击 · Quickstriker

原始描述：Quickstrikers move faster and gain Attack Speed, based on their target's missing Health. (@MinUnits@) @MinBonusAS*100@-@MaxBonusAS*100@%&nbsp;%i:scaleAS% (@MinUnits@) @MinBonusAS*100@-@MaxBonusAS*100@%&nbsp;%i:scaleAS% (@MinUnits@) @MinBonusAS*100@-@MaxBonusAS*100@%&nbsp;%i:scaleAS%. On target death, Quickstrikers dash to a new target and gain @ShieldAmount@ shield for @ShieldDuration@&nbsp;seconds.

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 2,
    "style": 1,
    "variables": {
      "MaxBonusAS": 0.6000000238418579,
      "MinBonusAS": 0.20000000298023224,
      "{0e9453af}": null,
      "{bdb9953b}": 200
    }
  },
  {
    "minUnits": 3,
    "maxUnits": 3,
    "style": 3,
    "variables": {
      "MaxBonusAS": 0.800000011920929,
      "MinBonusAS": 0.30000001192092896,
      "{0e9453af}": null,
      "{bdb9953b}": 200
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "MaxBonusAS": 1,
      "MinBonusAS": 0.4000000059604645,
      "ShieldAmount": 200,
      "ShieldDuration": 3,
      "{0e9453af}": null,
      "{bdb9953b}": 200
    }
  }
]
```

### 守望 · Watcher

原始描述：Watchers gain Durability, increased while above @HealthBreakpoint*100@%&nbsp;Health. (@MinUnits@) @BaseDR*100@% or @IncreasedDR*100@%&nbsp;%i:scaleDR%

档位变量（Set 13 14.23 原始数值）：

```json
[
  {
    "minUnits": 2,
    "maxUnits": 3,
    "style": 1,
    "variables": {
      "BaseDR": 0.15000000596046448,
      "HealthBreakpoint": 0.5,
      "IncreasedDR": 0.30000001192092896
    }
  },
  {
    "minUnits": 4,
    "maxUnits": 5,
    "style": 3,
    "variables": {
      "BaseDR": 0.25,
      "HealthBreakpoint": 0.5,
      "IncreasedDR": 0.44999998807907104
    }
  },
  {
    "minUnits": 6,
    "maxUnits": 25000,
    "style": 5,
    "variables": {
      "BaseDR": 0.3499999940395355,
      "HealthBreakpoint": 0.5,
      "IncreasedDR": 0.5
    }
  }
]
```
