# Set 13 全局机制与适配边界

本页补充同一 14.23 首发季的全局参考。棋子、羁绊、装备和强化的完整客户端记录见同目录 `tft-set13-14.23.md` 及正式输入。本页区分竞品规则与共鸣的取舍，不能把未采用的竞品机制写成当前玩法。

## 开局遭遇

官方 14.23 公布的开局名单如下。概率属于竞品，不是共鸣的随机权重。

| 角色 | 遭遇 | 概率 |
|---|---|---:|
| 无 | No Encounter | 10% |
| Jinx | Scuttle Puddle | 7.5% |
| Jinx | Crab Rave | 2.5% |
| Vander | Triple Gold | 15% |
| Ekko | Triple Prismatic | 5% |
| Heimerdinger | Prismatic Last | 8% |
| Heimerdinger | Prismatic First | 10% |
| Caitlyn | Gold Subscription | 6% |
| Sevika | Loot Subscription | 5% |
| Ambessa | Wandering Trainer | 4% |
| Powder | Wind-up Monkey | 12% |
| Vi | Component Anvils | 15% |

这些遭遇改变奖励或强化环境，不按角色划分棋子名单。共鸣当前采用标准开局，直接进入备战，不展示内容相同的额外选择页，也不分战场或主盟约卡池。

来源：[Riot 14.23 补丁说明，Opening Encounter](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-14-23-notes/)。

## 异常突变

竞品在 4-6 为一名棋子选择永久异变；首发有六十种选项，每次刷新花费一金币，遍历完选项前不重复。卖掉该角色后再次购买，其异变仍保留。这是独立赛季机制，不等于强化符文，也不能混进天然羁绊人数。

共鸣当前不采用这一阶段，不能以一个泛用属性奖励冒充完整异变系统。已在本季强化来源中保存的异变相关强化仍属于参考记录；依赖该阶段且没有完整适配的强化不进入可玩候选。

来源：[Riot 14.23 补丁说明，The Anomaly](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-14-23-notes/)、[Riot 赛季机制说明](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/mechanics-into-the-arcane/)。

## 常驻与回归强化

同季客户端名单以 `setData[number=13].augments` 为准。API 名中的 TFT6、TFT9 等前缀记录最初出现的内容家族，不表示该强化已从 Set 13 移除。只筛选 TFT13 前缀会漏掉本季实际存在的经济、经验、刷新和装备强化。

共鸣从完整名单选择可完整实现的效果，保留原型名称、版本、触发和数值出处；PVP 阶段或对手条件改成 PVE 节点时，明确记录适配。徽记、强化专属棋子与配套装备一并领取，不能只保留同类转职而丢掉其它收益。

来源：[锁定版本客户端镜像](https://raw.communitydragon.org/14.23/cdragon/tft/en_us.json)。该镜像不是 Riot 官方 API；完整名单由精确赛季引用和连接校验支持。

## 装备库存

本季官方库存容纳二十件物品或消耗品，支持库存内组件合成与重排，消耗品可叠放。共鸣采用独立物品区和九格棋子备战，身上最多三件；拖到持有者的第二组件立即合成，库存也提供产物预览。

来源：[Riot 14.23 补丁说明，Item Bench](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-14-23-notes/)。

## 升星与费用贡献

竞品的攻击和生命升星成长不是同一个倍率。Riot 12.14 将每升一星的攻击成长由八成改为五成，目的之一是将三星的主要收益留给技能，避免低费三星依赖过强普攻。共鸣以这项全局规则为基础：

| 属性 | 一星 | 二星 | 三星 |
|---|---:|---:|---:|
| 基础生命 | 1 | 1.8 | 3.24 |
| 基础攻击 | 1 | 1.5 | 2.25 |

这是基础属性成长，不替代各干员的实际技能、天赋、覆盖和启动预算。共鸣保留原生选定技能的身份与各星表现，按同职责、同装备和盟约投入校准其完整贡献；低费三星、高费二星与五费一星分别对照，不能用标称攻击代替真实输出、治疗、控制和有效屏障。

来源：[Riot 12.14 攻击成长调整](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-12-14-notes/)；[Set 13 努努资料](https://lolchess.gg/champions/set13/nunu?hl=en)提供本季攻击数列作交叉核对，后者为可更新的第三方页面，不用于覆盖固定14.23技能变量。
