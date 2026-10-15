# 进击事件表

由 `data/assault-rules/assault-design/events.json` 确定性生成，勿手改。schema: `assault-events-design/v1`；本表当前条目数：26。

## evt_rogue1_treasure1 · 历史馈赠

- topic: `rogue_1`  unlockDay: 2  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_1/choiceScenes/scene_treasure1_enter`
- background: `pic_rogue_1_26`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `treasure1_pry` | 撬开腐朽的宝箱 | free | 60%:gold+8, xp+1; 40%:gold+2 | none |
| `treasure1_manuscript` | 研读半老的剧本手稿 | hp2 | 100%:xp+6 | none |
| `treasure1_exchange` | 以古城遗物交换一件收藏品 | gold3 | 100%:relic[economyGrowth/rare]x1 | none |
| `treasure1_leave` | 离开 | free | 100%:leave | none |

## evt_rogue1_treasure2 · 命运馈赠

- topic: `rogue_1`  unlockDay: 3  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_1/choiceScenes/scene_treasure2_enter`
- background: `pic_rogue_1_25`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `treasure2_open` | 直接开启盒子 | free | 50%:relic[pierceCrit/rare]x1; 30%:gold+7; 20%:hp-2, xp+2 | none |
| `treasure2_guided` | 以金币占卜，定向招募 | gold4 | 100%:recruit[profession:<player-chosen>]x1 | recruit |
| `treasure2_leave` | 离开 | free | 100%:leave | none |

## evt_rogue1_rest · 安全的角落

- topic: `rogue_1`  unlockDay: 1  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_1/choiceScenes/scene_rest_enter`
- background: `avg_ac13_2`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `rest_recover` | 抓紧时间休整 | free | 100%:hp+2, repair[all percent 40] | none |
| `rest_organize` | 清点物资并整备装备 | gold2 | 100%:enhance[def 15% team/nextBattle] | none |
| `rest_swap` | 把待命干员调到安全位置 | gold1 | 100%:redeploy[selected free] | selectTeam |
| `rest_leave` | 离开 | free | 100%:leave | none |

## evt_rogue1_stage · 微型舞台

- topic: `rogue_1`  unlockDay: 2  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_1/choiceScenes/scene_ent1_enter`
- background: `pic_rogue_1_16`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `stage_coin` | 投币开演，指定职业招募 | gold3 | 100%:recruit[profession:<player-chosen>]x1 | recruit |
| `stage_perform` | 亲自登台演出 | hp2 | 100%:xp+5, tag[舞台之星/run] | none |
| `stage_sign` | 在剧团名录上留下身份 | free | 100%:tag[剧团员/run] | none |
| `stage_leave` | 离开 | free | 100%:leave | none |

## evt_rogue2_wish · 消失的习俗

- topic: `rogue_2`  unlockDay: 3  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_2/choiceScenes/scene_ro2_wish_enter`
- background: `pic_rogue_2_20`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `wish_fish` | 剖开贴着许愿条的风干鳞鱼 | free | 55%:gold+7; 35%:gold+3, xp+1; 10%:hp-1 | none |
| `wish_offer` | 向大海许下一个愿望 | gold3 | 100%:relic[healShield/common]x1 | none |
| `wish_listen` | 听老人讲旧日习俗 | hp2 | 100%:xp+5, tag[海边遗民/run] | none |
| `wish_leave` | 离开 | free | 100%:leave | none |

## evt_rogue2_home · 重返家园

- topic: `rogue_2`  unlockDay: 3  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_2/choiceScenes/scene_ro2_recruit1_enter`
- background: `pic_rogue_2_33`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `home_contact` | 请教士联络当地干员 | gold4 | 100%:recruit[faction:<player-chosen>]x1 | recruit |
| `home_sermon` | 聆听布道，整理信念 | hp2 | 100%:xp+5, tag[布道者/run] | none |
| `home_donate` | 资助他的盘缠，收纳一路见闻 | gold2 | 100%:xp+3 | none |
| `home_leave` | 离开 | free | 100%:leave | none |

## evt_rogue2_lighthouse · 灯塔看守人

- topic: `rogue_2`  unlockDay: 4  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_2/choiceScenes/scene_ro2_up2_enter`
- background: `pic_rogue_2_35`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `lh_gift` | 收下老人的特产礼物 | free | 100%:relic[blockCounter/common]x1 | none |
| `lh_guide` | 请看守人们为你指路 | gold1 | 100%:redeploy[selected free] | selectTeam |
| `lh_stories` | 听他们讲海上的故事 | hp2 | 100%:xp+4 | none |
| `lh_leave` | 离开 | free | 100%:leave | none |

## evt_rogue2_printer · 现买现印

- topic: `rogue_2`  unlockDay: 4  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_2/choiceScenes/scene_ro2_ent1_enter`
- background: `pic_rogue_2_19`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `printer_coupon` | 投币打印折扣券 | gold2 | 100%:shop-1[next] | none |
| `printer_lottery` | 投币抽奖 | gold3 | 50%:recruit[random]x1; 30%:relic[skillCycle/common]x1; 20%:gold+4 | none |
| `printer_dismantle` | 拆解抽奖机 | free | 60%:relic[economyGrowth/rare]x1; 40%:hp-2, xp+2 | none |
| `printer_leave` | 离开 | free | 100%:leave | none |

## evt_rogue3_market · 低地市集

- topic: `rogue_3`  unlockDay: 4  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_3/choiceScenes/scene_ro3_sacrifice1_enter`
- background: `pic_rogue_3_21`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `market_buy` | 在集市采购干员 | gold4 | 100%:recruit[profession:<player-chosen>]x1 | recruit |
| `market_sell` | 出售多余补给 | free | 100%:gold+5 | none |
| `market_trade` | 以收藏品换取收藏品 | gold2 | 100%:relic[summon/rare]x1 | none |
| `market_leave` | 离开 | free | 100%:leave | none |

## evt_rogue3_convoy · 特里蒙旅行社特派团

- topic: `rogue_3`  unlockDay: 5  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_3/choiceScenes/scene_ro3_relic1_enter`
- background: `pic_rogue_3_13`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `convoy_container` | 撬开耐低温贮藏盒 | free | 50%:relic[cold/rare]x1; 30%:relic[cold/common]x1; 20%:hp-2, xp+2 | none |
| `convoy_guide` | 雇请讲萨米语的向导 | gold3 | 100%:enhance[def 15% team/nextBattle] | none |
| `convoy_flyer` | 收下旅行社宣传单 | free | 100%:shop-1[next] | none |
| `convoy_leave` | 离开 | free | 100%:leave | none |

## evt_rogue3_blackrain · 雨！

- topic: `rogue_3`  unlockDay: 5  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_3/choiceScenes/scene_ro3_res2_enter`
- background: `pic_rogue_3_5`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `rain_help` | 帮他清点残存样本 | hp2 | 100%:xp+5, gold+2 | none |
| `rain_extract` | 从黑雨中提取有效成分 | gold2 | 100%:relic[element/rare]x1 | none |
| `rain_shelter` | 搭建遮蔽物并休整 | gold2 | 100%:repair[all percent 35], hp+1 | none |
| `rain_leave` | 离开 | free | 100%:leave | none |

## evt_rogue3_cards · 不见群山

- topic: `rogue_3`  unlockDay: 5  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_3/choiceScenes/scene_ro3_pick1_enter`
- background: `pic_rogue_3_16`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `cards_draw` | 抽一张牌 | free | 50%:relic[pierceCrit/rare]x1; 30%:tag[命运眷顾/run], xp+2; 20%:hp-2, xp+3 | none |
| `cards_ask` | 请她指明前路 | gold2 | 100%:redeploy[selected free] | selectTeam |
| `cards_learn` | 学习她的占卜手法 | hp2 | 100%:tag[占卜者/run], xp+3 | none |
| `cards_leave` | 离开 | free | 100%:leave | none |

## evt_rogue4_scarmarket · 刀口舔血

- topic: `rogue_4`  unlockDay: 5  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_4/choiceScenes/scene_ro4_rec1_enter`
- background: `pic_rogue_4_10`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `scar_hire` | 花重金雇佣一名打手 | gold5 | 100%:recruit[profession:<player-chosen>]x1 | recruit |
| `scar_brawl` | 亲自下场打一场表演赛 | hp2 | 100%:gold+4, xp+2 | none |
| `scar_refresh` | 贿赂管事刷新雇佣名单 | gold2 | 100%:shop-1[next] | none |
| `scar_leave` | 离开 | free | 100%:leave | none |

## evt_rogue4_artsalon · 失落财宝

- topic: `rogue_4`  unlockDay: 5  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_4/choiceScenes/scene_ro4_relic1_enter`
- background: `pic_rogue_4_12`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `salon_buy` | 买下古老传说的油画 | gold3 | 100%:relic[cross/rare]x1 | none |
| `salon_listen` | 听画家讲画中传说 | hp2 | 100%:xp+4, tag[鉴赏家/run] | none |
| `salon_sketch` | 请画家为全队作画像 | gold2 | 100%:enhance[atk 10% team/nextBattle] | none |
| `salon_leave` | 离开 | free | 100%:leave | none |

## evt_rogue4_riddle · 解惑

- topic: `rogue_4`  unlockDay: 6  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_4/choiceScenes/scene_ro4_res1_enter`
- background: `pic_rogue_4_3`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `riddle_read` | 替他读出结局 | hp2 | 100%:xp+6, tag[解读者/run] | none |
| `riddle_hide` | 隐瞒结局，换取报酬 | free | 100%:gold+6 | none |
| `riddle_study` | 与他一起推演书中的可能 | gold2 | 100%:relic[blockCounter/common]x1 | none |
| `riddle_leave` | 离开 | free | 100%:leave | none |

## evt_rogue4_caravan · 驮兽旅行家

- topic: `rogue_4`  unlockDay: 6  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_4/choiceScenes/scene_ro4_normal3_enter`
- background: `pic_rogue_4_17`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `caravan_guide` | 应征做它的向导 | hp2 | 100%:gold+3, xp+3 | none |
| `caravan_goods` | 换取它行李中的补给 | gold3 | 100%:relic[redeploy/common]x1 | none |
| `caravan_stamp` | 收集它册子上的邮戳 | free | 100%:tag[泰拉旅人/run], xp+1 | none |
| `caravan_leave` | 离开 | free | 100%:leave | none |

## evt_rogue5_brush · 点睛

- topic: `rogue_5`  unlockDay: 6  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_5/choiceScenes/scene_ro5_market_enter`
- background: `pic_rogue_5_28`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `brush_fix` | 将一件收藏品固定在现实中 | gold3 | 100%:relic[ammo/rare]x1 | none |
| `brush_enhance` | 为干员补上缺笔，强化其能力 | gold2 | 100%:enhance[atk 12% team/nextBattle] | none |
| `brush_repair` | 用墨修复受损的干员 | gold2 | 100%:repair[all percent 40] | none |
| `brush_leave` | 离开 | free | 100%:leave | none |

## evt_rogue5_beasts · 偏安

- topic: `rogue_5`  unlockDay: 6  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_5/choiceScenes/scene_ro5_res1_enter`
- background: `pic_rogue_5_11`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `beasts_feed` | 用补给喂食这些生灵 | gold2 | 100%:relic[summon/common]x1 | none |
| `beasts_rest` | 在此放松休整 | free | 100%:hp+2, repair[all percent 25] | none |
| `beasts_bond` | 与生灵结下缘分 | free | 100%:tag[兽缘/run], xp+1 | none |
| `beasts_leave` | 离开 | free | 100%:leave | none |

## evt_rogue5_mahjong · 三缺一

- topic: `rogue_5`  unlockDay: 7  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_5/choiceScenes/scene_ro5_ent1_enter`
- background: `pic_rogue_5_37`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `mj_play` | 坐下来打一局 | gold3 | 45%:gold+9, xp+2; 30%:gold+2; 25%:hp-2, xp+3 | none |
| `mj_watch` | 只在旁观看，研究牌路 | hp2 | 100%:xp+5, tag[观牌人/run] | none |
| `mj_bet` | 押上额外金币赌大的 | gold5 | 35%:gold+15; 65%:gold+2 | none |
| `mj_leave` | 离开 | free | 100%:leave | none |

## evt_rogue5_yi · 会友

- topic: `rogue_5`  unlockDay: 7  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_5/choiceScenes/scene_ro5_sacrifice1_enter`
- background: `pic_rogue_5_19`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `yi_exchange` | 以收藏品与易先生交换 | gold3 | 100%:relic[ammo/epic]x1 | none |
| `yi_commission` | 请他工造一件器材 | gold4 | 100%:enhance[spGain 20% team/nextBattle] | none |
| `yi_gift` | 拿出合乎心意的物件，托他引荐 | gold4 | 100%:recruit[profession:<player-chosen>]x1 | recruit |
| `yi_leave` | 离开 | free | 100%:leave | none |

## evt_rogue6_agency · 临时中介所

- topic: `rogue_6`  unlockDay: 7  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_6/choiceScenes/scene_ro6_hire1_enter`
- background: `pic_rogue_6_19`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `agency_hire` | 雇下中介所推荐的帮手 | gold4 | 100%:recruit[profession:<player-chosen>]x1 | recruit |
| `agency_bargain` | 讨价还价压低佣金 | gold2 | 100%:shop-1[next] | none |
| `agency_inspect` | 亲自测试这些“商品” | hp2 | 100%:xp+4, gold+2 | none |
| `agency_leave` | 离开 | free | 100%:leave | none |

## evt_rogue6_unmanned · 无人商店

- topic: `rogue_6`  unlockDay: 8  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_6/choiceScenes/scene_ro6_wish_enter`
- background: `pic_rogue_6_25`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `store_haul` | 按字条搬运木桶 | free | 65%:gold+8; 20%:gold+3, xp+1; 15%:hp-2 | none |
| `store_loot` | 拿走店里的罐装物资 | free | 100%:gold+4, xp+1 | none |
| `store_armor` | 研究那套防爆盔甲 | gold2 | 100%:enhance[def 12% team/nextBattle] | none |
| `store_leave` | 离开 | free | 100%:leave | none |

## evt_rogue6_bloodclothes · 血衣之下

- topic: `rogue_6`  unlockDay: 8  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_6/choiceScenes/scene_ro6_relic1_enter`
- background: `pic_rogue_6_12`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `blood_exchange` | 以收藏品交换黑流结晶 | gold3 | 100%:relic[blockCounter/rare]x1 | none |
| `blood_harvest` | 采集黑流样本 | hp2 | 100%:xp+5, gold+2 | none |
| `blood_ward` | 用血液与藤蔓设置路障 | gold2 | 100%:enhance[def 15% team/nextBattle] | none |
| `blood_leave` | 离开 | free | 100%:leave | none |

## evt_rogue6_pixelcat · 安眠一隅

- topic: `rogue_6`  unlockDay: 8  repeatable: false
- source: `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/roguelike_topic_table.json#/details/rogue_6/choiceScenes/scene_ro6_surprise_enter`
- background: `pic_rogue_6_34`

| choice | label | costs | outcomes | targeting |
| --- | --- | --- | --- | --- |
| `cat_rest` | 触摸像素猫，原地休整 | free | 100%:hp+2, repair[all percent 30] | none |
| `cat_pull` | 顺着拉扯跨越空间 | gold1 | 100%:redeploy[selected free] | selectTeam |
| `cat_mark` | 记住这条小径 | free | 100%:tag[树海归途/run], xp+1 | none |
| `cat_leave` | 离开 | free | 100%:leave | none |

