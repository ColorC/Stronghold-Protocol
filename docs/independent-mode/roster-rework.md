# 工坊配置与玩法

[全屏打开工坊](https://colorc.cc/stronghold/independent.html) · [Workshop入口](https://workshop.colorc.cc/stronghold/independent.html) · [集中配置表](https://workshop.colorc.cc/bside/canvas?project=arknights&canvas=canvas-0470c0a1#card=workshop-roster-rework-table-20261007)

固定101名干员，普通和进阶均有额外特质。集中表把参考原卡、本体技能与天赋、输出倾向、普通与进阶效果、徽章、装备、奖品和五套阵容放在一起。

徽章采用百分比。装备在右侧按格存放，同名且状态相同的装备每格最多999件；干员详情在左侧，产出从开始战斗旁展开。

狼嚎哨在同一干员身上唯一，每十二次普通攻击使主目标恐惧0.75秒，冷却八秒。融毁教学仪和反冲空降仓由六本干员提供。交接可双向进行，另一方无需凭证；新局仅幽灵鲨和蛇屠箱自动携带相应凭证。

## 五套阵容

| 阵容 | 参考族群 | 成员 | 联动链 |
|---|---|---|---|
| 叙拉古退场与召唤 | 野兽 | 忍冬、伺夜、德克萨斯、拉普兰德、缄默德克萨斯、巫恋、荒芜拉普兰德 | 伺夜补召唤物，缄默德克萨斯强化召唤；德克萨斯重放荒芜拉普兰德退场增益，巫恋放大退场特质，拉普兰德负责溅射收割。 |
| 谢拉格护盾与成长 | 龙 | 耶拉、崖心、银灰、初雪、锏、凛御银灰、圣聆初雪 | 耶拉帮助过渡；银灰与锏持续成长；凛御银灰把获得时特质转阵营徽章，圣聆初雪退场补盾，初雪从累计破盾获得临时增益。 |
| 哥伦比亚召唤回收 | 机械 | 松果、赫默、雷蛇、白面鸮、蛇屠箱、迷迭香、缪尔赛思 | 松果与赫默退场留下小单位，雷蛇刷新护盾，白面鸮补永久徽章，迷迭香回收退场价值，缪尔赛思还原早先损失的原始召唤物。 |
| 卡西米尔采购与攻击 | 海盗 | 流星、焰尾、瑕光、锏、玛恩纳、灰毫、耀骑士临光 | 玛恩纳的当期返金支持更多采购，焰尾按卡西米尔获得永久成长；瑕光强化攻击者，耀骑士临光强化全队，灰毫退场补军团，锏提供击杀支援。 |
| 维多利亚商店成长 | 元素 | 凯瑟琳、刺玫、薄绿、洛洛、号角、安洁莉娜、维娜·维多利亚 | 凯瑟琳免费刷新、刺玫售出补过渡单位；薄绿与洛洛强化维多利亚干员，号角强化前方队友，安洁莉娜作为诺米对应的中立商店成长引擎，维娜按买入科技提供高本增益。 |

安洁莉娜对应诺米的中立成长引擎。其他成员按原生阵营连接；锏可以参与谢拉格和卡西米尔两套阵容。

## 数值与参考

科技一至六分别为11、19、21、18、18、14名。成员的原生技能、天赋与可选择模组保留；科技同时考虑输出倍率、治疗、控制、阻挡、射程、部署周期及额外功能。

参照[暗月奖品初版19.2](https://hearthstone.blizzard.com/en-us/news/23584141/19-2-patch-notes)及[固定客户端卡池快照](https://github.com/HearthSim/hsdata/blob/cb9444afd722a16112745e5510ec191d8c813c07/CardDefs.xml)。数量筛选保留野兽、龙、元素、机械、海盗和中立，排除畸变怪及三张依赖恶魔的中立卡，得到101张参照候选；后三张的排除依据是效果文字推断。原卡参考列分别注明19.2酒馆卡、构筑补充和后续版本补充。鲁莽的火车王来自[23.2版本](https://hearthstone.blizzard.com/en-us/news/23784375/23-2-patch-notes)，原五本；融毁教学仪按六本范围爆发调整。

原生白值攻击、技能攻击加成、造成伤害、脆弱、攻速和附加伤害分别结算。巨锤每次攻击动作提供当前攻击力50%的物理溅射，每多一件加十个百分点；实际范围0.9格，单独计算防御。护盾发生器每次部署五层，每多一件加三层；与原生护盾共存，相关特质按累计层数触发。

敌人继续使用原波次的防御、法抗、免疫、路线和出场时间。休闲生命倍率随阶段为1.00／1.03／1.05；标准生命为0.90／0.88／0.95、攻击为0.90／0.92／0.95，后期领袖生命为0.90。首轮三十局公开动作跑测无机制错误，休闲完成15／15局、标准完成8／15局；这用于本轮调参，不能视为真人胜率。

## 原生资料范围

PRTS国服目录截至本轮按独立对象统计431项（429基础对象及阿米娅另外两种职业形态），包括异格、联动与作业平台，不计召唤物、陷阱和不可获得NPC。来源：[PRTS目录](https://prts.wiki/w/PRTS:Gameinfo/国服/干员一览)、[Cargo检查](https://prts.wiki/w/PRTS:Cargo检查单)。游戏现有120条本体定义中启用101条，其余19条兼容旧存档。

已有897个90秒木桩场景覆盖299个技能选择，每个选择测试单体零防零抗、单体800防40抗、四目标零防零抗。集中表保留技能、天赋全文及对应探针。木桩输出只代表特定场景；治疗、控制、部署周期和经济价值同时影响科技分配。

职责按当前数据分为生成13、成长41、联动22、临时战斗14、一次性工具6、经济5。所有活动干员两种形态都有执行规则，未设置空特质类别。

<details>
<summary>版本与验证记录</summary>

全仓4402项，4390通过、0失败、12项环境条件跳过。101名干员普通与进阶共202次实际战斗、五套阵容十条联动链通过。桌面与触屏布局、两个入口的购买、部署、详情直链、重新载入、三维回放、结算、下一轮，以及客户端目录一致性与存档冲突检查通过。

核心测试与公网版本：Git `86f9475eb059f6d0fd8d205f90cb1c81f1857486`。Workshop发布Git `18e9d9812f5b6f2148397a4f9ee70ca1ed01738f`，玩法源码与核心版一致，保留同期特效更新。Cloudflare原生部署号 `fb272973-7401-42e9-ba64-70b4bd34d934`。

改动前保存的Git标签：`workshop-before-trait-revision-20261007`、`workshop-before-whole-warband-20261007`、`workshop-before-whole-warband-live-20261007`。旧干员定义、已持有装备、旧交接凭证与存档保留。十种失去具名来源的装备只供旧持有兼容，新局不再发放。

集中表186行、11列，2046个单元格回读同值。正式规则来自项目data目录；表格修改需要同步玩法规则与文案。

| 用途 | 文件绝对路径 |
|---|---|
| 原卡与整阵容来源 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/independent-source-reference.json` |
| 正式设计 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/independent-design.json` |
| 正式游戏文案 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/independent-game-text.json` |
| 集中表 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/independent-mode/roster-rework-table.json` |
| 全仓回归与编译 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/full-suite-final/runner-receipt.json` |
| 202种形态战斗 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/full-suite-final/all-202-bodies.json` |
| 三十局跑测 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/whole-balance-final/runner-receipt.json` |
| 桌面与触屏界面 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/final-ui/browser-receipt.json` |
| 公网发布与两个执行模式 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/publication-86f9475e/publication-final-receipt.json` |
| Workshop入口 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/workshop-public-final/host-smoke-final-receipt.json` |
| 集中表回读 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/concentrated-table-verification.json` |
| 任务副本收尾 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/trait-revision-20261007/final-worktree-closeout/receipt.json` |

</details>

<details>
<summary>工坊画面</summary>

![左侧干员详情与右侧装备格](../lofa/overlay/asset/fda940bd8c30b6db70f6d074b3b80fbd.png)

![触屏横屏](../lofa/overlay/asset/8f42e254bdf88b2ad5fa91369a34e7dc.png)

</details>

<details>
<summary>旧版画面</summary>

![旧版整备界面](../lofa/overlay/asset/7fe32d1bd0282621c063fa6a3548e6ae.png)

![旧版手机横屏](../lofa/overlay/asset/ffa0dc5af41903f9c91c34abf1d973f7.png)

</details>
