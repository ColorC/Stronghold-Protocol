---
id: stronghold-assault
project: stronghold-protocol
status: completed
owner: codex_01a11ca8-878a-7742-85bb-d338b6010202
started: 2026-10-09
---

# 卫戍协议：进击

## 目标与依据

独立实现《卫戍协议：迁移合集》的进击路线，完成数据来源、全体系和全卡池设计、最新上游及本体引擎更新、完整内容、前端、平衡与真实端到端交付。

用户需求：先拉取大巴扎卡牌、技能、事件、敌人及相关内容；复用或拉取明日方舟全干员属性与成长、职业特性、天赋、技能、模组、收藏品和肉鸽事件；考虑新增干员完成全设计；随后更新上游并补本体内容和机制；依据工坊完成度实现独立进击模式。

原文：https://workshop.colorc.cc/bside/canvas?project=arknights&canvas=canvas-0470c0a1#card=text-c536b659-3c89-40ab-ba70-db5648e64081 。读取画布原生 revision 263；不得用正文附带摘要字段作版本判断。

## 执行纪律

- 全任务 GLOBAL 新增磁盘占用合计严格小于 2,000,000,000 字节；包括所有路线和自建批次的源码、输入、工作树、构建、日志、录制、临时产物、原生子代理/CLI 会话记录、共享事件归因以及远端副本，不能把每条路线分别计算成 2 GB。复用既有资源，不复制运行包、不新增可写链接。
- 开发阶段复用唯一工作树和活动分支 `assault`；当前源码已按原生 Git 保全，正式运行位于 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/publish/assault/code`，规则位于 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-rules`。开发与发布工作树已归零，不重建副本。
- 正式来源输入 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources`；唯一临时批次 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/assault`；运行回执 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/assault`。
- 既有明日方舟数据、素材按已核验的 canonical 绝对路径读取；不改另项目的数据或运行状态。
- 主要用小范围无头战斗、机制因果与平衡测试；全部内容完成后才做全面真实浏览器端到端测试和整局录制。
- 每阶段配置确定性截止提醒；到点回报并原地调整，不轮询、不另起副本、不把期限转成用户续授权。
- 主仓未知改动与其他职责簇内容受到保护；合并自行处理冲突，原生版本恢复和收尾。
- 界面以最新盟约原生组件、字体、阶级牌、肖像、按钮、提示、音效、动效和渲染器为真源；适配进击各阶段布局，禁止另外设计一套进击视觉语言。布局不要求复制盟约商店页面，元素与效果不随布局转换丢失。进击不接入共鸣规则。

## 阶段与完成条件

1. 来源：大巴扎各类全表及原始机制字段、版本和覆盖度；明日方舟各类完整输入及版本、覆盖计数和引用闭合。原始缺失与不可执行内容必须显式列出，不能拿摘要或占位数值冒充完整。
2. 设计：领导选择、时段/PVE路线、经济、科技与人口、条件商店、星级、技能转换、乘区、扳机/阵营/职业、再部署、元素、收藏品、事件与遭遇全部规定；完整活跃卡池逐卡有来源、瞬发/被动技能、天赋改写、星级数值与关键联动，新增干员有资产及引擎计划。全游戏干员候选需明确纳入或不纳入理由，不默认仅限旧112名。
3. 上游与本体：设计完成后才 fetch 最新上游；固定 Git commit，合入必要内容与引擎版本，保留本地功能；本体相关回归通过。
4. 独立进击：独立会话、存档与内容域；复用工坊和本体可用机制及原渲染器，完整接入设计数据、真实技能/天赋/召唤物/敌人、事件和收藏品；无假白板/无效果卡/文字有而机制无。
5. 验收：逐机制因果测试、全卡/星级/领导/事件选择覆盖、引用与获取路径闭合、定种子无头整局和平衡；最后真实浏览器完整用户故事、可复制文本、组件定位链接、小全屏打开按钮、公开文案检查；原模式和工坊保持功能。
6. 交付：设计及模式通过 Workshop 原生渠道展示，远程游戏链接、原生版本、测试和磁盘回执齐备；未知影响明确；无消费者临时工作树通过原生 Git 收尾。全部完成前 goal 保持 active。

## 大巴扎体系补齐验收

商店去重、每日品质、升级、刷新限制、职业收购、局外买卖与日开始联动、独立战术和附魔均已实现，实际效果、获取路径和继承规则已有因果及整局验收证据。

- 局外通用买入、出售、升级、入店、小时及日开始触发：在存档原子与幂等边界内执行有效成长/经济结果，证明失败回滚、合成继承和初始日/跨日次数。
- 独立战术（对应 Skill）：独立于干员战技、收藏品和模组的持有/品质/获取/升级与战斗联动，来源与塔防转换明确，原生视觉入口可用。
- 单卡强化（对应 Enchant）：官方全附魔类型逐项转换、合法对象、替换/继承、实际战斗效果和视觉说明，不能用永久数值字段冒充完整层。
- 卡池和路线接入：合法获取路径、事件/商人/等级成长、经济与职业联动均贯通；现有玩家存档与独立模式边界保留。
- 全流程验证：逐项因果证据、全卡/星级/策略/强化覆盖，定种子真实战斗整局与平衡，最后用真实浏览器体验。UI沿用盟约元素及效果，布局避免遮挡商店。

## 过程记录

过程只追加本目录 `progress.md`。不把阶段回执当独立成果提审。

## 完整交付验收

2026-10-14正式版本d3ff0cc745e9e5d972890d2a47894069eebdf6f2的真实UI对局78bb061c-6b7d-4988-888a-ca5f78fccb89完成20场唯一结算、十天六时段、生命19、completed=true；页面、请求及编码错误为0。连续21分51秒录像已上传并经远端逐字节核对。完整设计写回原Workshop Review卡，原生正文版本8、画布revision308，52张卡未增加，原有人为布局保留。

[进入进击](https://workshop.colorc.cc/stronghold/assault/assault.html)；[完整设计与录像](https://workshop.colorc.cc/bside/canvas?project=arknights&canvas=canvas-0470c0a1#card=review-1a122ca6816-7ffe3e45)。最终完整GLOBAL回执为E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/assault/disk-budget.json，原生文档保全回执为E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/assault/root-final-doc-preservation.json。
