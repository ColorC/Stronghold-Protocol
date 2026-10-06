# 卫戍协议：工坊（内部名：罗德岛战备演习）开发交接

核验日期：2026-10-06（第二次更新：前端已接入原模式渲染器）。本文交接已完成的后端与前端，供继续开发时使用；没有启动新会话或后台开发任务。前端信息设计、战斗演出与特效方案见 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/independent-mode/frontend-design.md`。

## 接手时先看这些

- 主仓：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol`，分支 `master`。前端适配用的 `.worktrees/independent-frontend-v2` 与特效用的 `.worktrees/fx-registry` 均已合并并用原生 Git 收尾，不能继续使用旧 worktree 路径。
- 新模式：[卫戍协议：工坊](https://workshop.colorc.cc/stronghold/independent.html)（10-06 起对玩家改名，主题突出装备；暗月奖品对玩家显示为「工程部特供」，三档起步、成型、决胜；模式为短局、标准局、追加挑战）。玩家文本全部手写在 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/independent-game-text.json`，写法与自动术语说明见设计稿「包装与文本」。原模式：[卫戍协议](https://workshop.colorc.cc/stronghold/)。本次只读检查公网健康接口正常，版本为 `0.1.3`。
- Fork：[ColorC/Stronghold-Protocol](https://github.com/ColorC/Stronghold-Protocol)。上游：[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)。本阶段提交保存在本地 Git，未推送远端；不能假设 GitHub 已有这些提交。
- 已完成“更新上游 → 纯后端与 CLI → 无头测试和首轮调参 → 保存后端版本 → 前端接入原渲染器 → 特效注册表解耦”。接下来是还原原版特效、补齐战斗中的产出提示与少数交互的浏览器验收、扩展平衡验证；不重写后端机制。

| 版本节点 | Git commit |
| --- | --- |
| 合入上游 0.1.3 | 上游 `8774379d3be06fba3961f388f21c2eea3b666152`；合并 `26a3aaad2f993b0d2dc60a79f4535351566203ee` |
| 后端验收里程碑 | `62b417b6579160aac3495b7f5e267008056b61ea` |
| 独立模式持久化 HTTP 接口 | `6f6279e` |
| 初版前端（已被替换） | `c01119ac05c4ec471a9c03c76a150d6e7e439a4b` |
| 产出账、休整结束预告、战斗录像 | `b92e66b`、`ffd4f3a` |
| 前端接入原渲染器（含敌情预览） | `17f4932` … `93bf0f0` |
| 特效注册表与事件字段（合并） | `ee68bb1`；合并 `c7e111b` |
| 合入上游 0.1.4（地形说明、提示改进等） | 合并 `92414f1` |

版本依据使用 Git commit、会话 revision；不要用自算摘要作版本闸门。

## 需求依据与不能改丢的口径

批准的设计来自 [arknights 画布内容设计卡](https://workshop.colorc.cc/bside/canvas?project=arknights&canvas=canvas-0470c0a1#card=text-79039e4e-14f4-4df2-9ed1-93678e3ae214)，当时 revision 为 143。版本化设计位于 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/independent-mode/design.md`，机器输入位于 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/independent-design.json`。设计稿开头“尚未实装”是设计阶段留下的历史说明；当前实现状态以本交接和运行证据为准。

同一套规则写在几处，改规则时一起改：design.md（含完整干员表）、data/independent-design.json、画布「第一期内容设计：干员特质、徽章与附加效果」卡（design.md 的副本，表格改成列表，画布不渲染表格）、画布原需求卡末尾的修订记录（附用户原话）。design.md 的干员表由 `node tools/independent-design-table.mjs write` 从设计数据生成，`test/independent/design-doc-sync.test.js` 守着两者一致；修订逐条记在 design.md 文末「修订记录」。

- 完整 112 名可招募干员，普通与精锐共 224 个目录形态。保留原战斗技能、天赋、模组；酒馆自有特质属于本体，不强行装备化；部分特质在获得时带来装备（交接凭证、各条装备线），带来的装备按装备规则处理。
- 15 种基础徽章全部一级，效果简单；阵营与职业配方使用其中六种，其余九种各有固定的产出干员。功能装备保留独立等级，普通与精锐效果分别配置；同名唯一装备的普通/精锐视为同名。
- 单个身体最多穿戴 999 件（10-06 由 99 改），按实际数量计（`equipment.js` EQUIPMENT_CAPACITY）。库存与全队没有这个上限。不能主动拆卸或替换已穿戴装备；出售身体会销毁其装备和附加效果。
- 普通干员自动三连，风丸两份合成；资产与计数保留。同名唯一冲突要明确选择，多余部分销毁，不退库存；超过容量则整次拒绝。精锐保留消耗的全部卡池份额，出售才归还。
- 交接资格是稀有装备「交接凭证」（kind permit，mechanism inheritancePermit）：只有 12 名干员获得时自带一件（session.js gainChess，uid 随干员为 permit-<干员uid>，不占用 nextUid），三连只留一件不需选择；不显示等级、占一格容量；不可继承，交出方的随之失去；商店与随机装备不出。给予方或接收方任一人穿着的凭证完整条件成立即可（shared/independentRules.js inheritanceQualification 只看穿着的凭证）；限制使用原生科技、职业和阵营。额外酒馆标签不能伪造原生阵营。旧存档在查看和下一次动作时补发。
- 交接只转移允许转移的装备和合法附加效果，不搬运旧本体能力。接收者原生攻击与最大生命损耗 20%，先扣再算装备，同一身体只扣一次；旧本体按出售结算一次。资格、地形、容量、唯一冲突失败均原子拒绝。
- 商店只卖干员（10-06）：等级 1～6 依次 4/5/5/6/6/6 名干员，原装备位改为干员位（`session.js` slotsFor）。所有装备经干员获得：原有产出不变，另有 9 名干员加产一种特殊徽章、40 名干员获得时带来一件装备、新约能天使带来随机后勤物资；工程部特供不受影响。逐件来源见 design.md「商店与装备来源」；`test/independent/gear-lines.test.js` 保证每种徽章和每件穿戴装备都有按名产出的干员，且特质文字写的物品就是规则发的物品（同时修正了耶拉、卡涅利安发错物品）。同一干员同一战斗触发上的第二条产出规则用独立计数（`battle.js` productionOnTrigger），原有规则的计数键不变。
- 装备库存最多 20 格（10-06）：每种物品按普通/精锐一格、叠放不限（`equipment.js` INVENTORY_CAPACITY、inventoryTiles）；需要新格而已满时不入库，产出账记 `lost: true`；留待使用的特供不占格；合成精锐要开新格时报 INVENTORY_FULL。页面把库存平铺成格子，拖到干员身上即穿戴（`hud.js` InventoryStrip、`game.js` dropFromStock；落点用渲染器新增的可选方法 `view.pieceAtClient`，与点按棋盘同一套拾取）。
- 四项外来附加效果为军需备品、弹药回收、寒区记录、医疗整备，独立保存，不占装备容量或等级。
- 第一期全局活动是暗月奖品（对玩家称工程部特供，三档为起步、成型、决胜），共 19 项；短局第 4/8 轮发放，长局第 4/8/12 轮发放。回合开始顺序为收入 → 选奖品 → 开始生产。
- 买价 3、卖价 1、刷新价 1；原单人、合作模式保持独立。所有机制描述写全，不用“记一件”等缩略表达。

几个容易回归的边界：重复验收许可只复演本轮“获得时”的徽章锻造，不能重跑休整开始/结束或资金招募；魔王每次原生生产只复制一项输出，固定普通 1/精锐 2，不乘源数量、不递归复制；归溟幽灵鲨死亡与替身切换共用每场产量上限；装备制造的冻结和治疗不能刷原生附加效果；产物计数不随复活、替身或再部署重置。

## 实现入口与复用边界

| 职责 | 正式文件 |
| --- | --- |
| 会话、经济、阶段、动作与合成 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/session.js` |
| 内容目录与初版平衡参数 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/catalog.js` |
| 准备阶段本体特质 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/native.js` |
| 物品穿戴、合成、等级 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/equipment.js` |
| 暗月奖品、补给、玩家设施 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/prizes.js` |
| 交接预览与执行 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/inheritance.js` |
| 原生身份、资格和身材损耗共享规则 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/shared/independentRules.js` |
| 波次、地图与真实 Battle 无头适配 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/battle.js` |
| 战斗特质、徽章、装备、附加效果事件处理器 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/sim/content/independent/battle.js` |
| 持久化 HTTP 薄适配 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/http.js` |
| CLI | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/tools/independent.mjs` |
| 特质图标摘要（展示目录用） | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/server/modes/independent/summary.js` |
| 页面入口与样式 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public/independent.html`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public/css/independent.css` |
| 页面模块：启动、开局、对局屏、HUD、面板、纯数据适配、HTTP 客户端 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public/js/independent/`（main、app、game、hud、panels、model、api） |
| 战斗特效注册表与默认配方（原模式共用） | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public/js/render/fxRegistry.js`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public/js/render/fxRecipes.js` |

公共逻辑是 `createSession → applyAction → viewSession`。动作成功返回 `{ok,state,events}`；失败返回错误与原状态。输入不被修改，失败不部分扣钱或转移资产。状态包含 RNG、revision、计数和卡池，可 JSON 持久化。只读 inspect/交接预览不推进 RNG 或 revision。

复用原 `Battle`、技能 KITS、召唤物、设备、敌人、领袖、GameData、SharedPool、board 合法性和波次生成。`content:'independent'` 仅在新模式跳过旧盟约、旧物品、策略等处理器；原技能、职业与召唤物实现继续运行。不要重新造伤害、寻路、技能或另一套前端经济。

HTTP 对外相对路径为 `independent/api/`：GET `catalog`；POST `sessions` 创建；GET `sessions/:id` 恢复；POST `sessions/:id/actions` 提交 `{expectedRevision,action}`；GET `sessions/:id/replays/:round` 取该回合战斗录像（gzip，存于会话文件旁，不进会话存档）。请求带 `?catalog=0` 或正文 `catalog:false` 时回包不含 625 KB 的展示目录，页面开局只取一次目录。视图另含产出账 `production`、休整结束预告 `forecast`、下一轮敌人 `nextEnemies` 和每名干员的 `legalTiles`、`bodyStats`。过期版本返回 409，失败动作返回 422，正文上限 64 KiB。保存使用临时文件后原生 rename，同一会话动作串行。网页中的 `?session=...` 可恢复对应演习。

## 运行与复验

以下 PowerShell 命令从项目主仓运行。先执行 `git status --short`，保护接手时已有改动；不要直接重置到本文 commit。

```powershell
Set-Location 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol'
git status --short
git log -1 --oneline
node --version
```

要求 Node.js 22 或以上。当前依赖与资源已供给；缺失时使用现有 setup/vendor/assets 工具补齐，不从零做下载器。

CLI 新建、检查和批量动作示例。输出只写本次独立临时目录，不要使用线上会话文件做实验：

```powershell
$handoffRun = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/handoff-followup'
New-Item -ItemType Directory -Path $handoffRun -Force | Out-Null
node tools/independent.mjs new --file "$handoffRun/session.json" --seed 1 --difficulty FUNNY --round-limit 9
node tools/independent.mjs show --file "$handoffRun/session.json"
@{ actions = @(@{ type = 'buy'; slot = 0 }) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$handoffRun/actions.json" -Encoding utf8NoBOM
node tools/independent.mjs batch --file "$handoffRun/session.json" --actions "$handoffRun/actions.json"
```

CLI 有 `new/act/show/catalog/play/batch`；生产入口不提供任意 grant、注入资金或伪造胜利。`batch/play` 只有全部动作成功才保存文件；失败时持久文件仍是原状态，输出中包含失败前的工作状态。

常用复验命令如下，每条按改动需要单独执行，产物用新的批次路径，消费已有终态回执，不短间隔轮询：

```powershell
node --test
$independentTests = @(rg --files test/independent -g '*.test.js')
node --test $independentTests
node tools/independent-audit.mjs --output 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/handoff-followup/content-audit.json'
node tools/independent-smoke.mjs --output-directory 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/handoff-followup/cli-short'
node tools/independent-smoke.mjs --output-directory 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/handoff-followup/cli-long' --seed 2 --route assault --difficulty NORMAL --round-limit 14
node tools/independent-browser-smoke.mjs --output 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/handoff-followup/browser-local'
# 在没有安装资源的 worktree 里：先设 $env:STRONGHOLD_INSTALL_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol'
```

浏览器烟测在原渲染器上玩一整轮：开局、购买、拖到合法格并选朝向、刷新恢复、定位链接、开战回放、跳到结尾、核对结算与服务器一致、进入第 2 轮、手机横屏截图。使用 Puppeteer + headless Chrome（软件 WebGL），默认 Chrome 路径 `C:/Program Files/Google/Chrome/Application/chrome.exe`，可以用 `CHROME_PATH` 指定。默认起随机端口的测试服务器；增加 `--url https://workshop.colorc.cc/stronghold/independent.html` 会在真实服务创建测试演习。不要用本机可见窗口替代远端体验链接。

全仓默认并发回归曾用约 128 秒完成；限制四并发的首次运行曾触及五分钟上限。整局 smoke 的上限为三分钟，当前真实用时约十几秒。需要更长任务时使用有上限的原生等待和到点检查，不把预估上限当停止完整工作的理由。

## 已有证据与实际证明范围

| 已完成验证 | 证据的完整绝对路径 |
| --- | --- |
| 全仓 3787 项：3776 通过、11 可选浏览器测试跳过、0 失败 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/backend-regression-parallel.stdout.log` |
| 新 HTTP 与原服务器相关 77 项全部通过 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/http-integration-fixed.stdout.log` |
| 224 个本体形态 + 95 个可穿戴装备形态的真实 Battle 安装运行审计，319/319 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/content-audit-integrated.json` |
| 九回合 CLI：176 个动作，重复种子一致，CLI/pilot 最终 JSON 状态一致并胜利 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/cli-replay/seed-1-2026-10-05T17-22-31.588Z-504872/result.json` |
| 十四回合 CLI：359 个动作，重复种子一致并胜利 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/cli-long-replay/seed-2-2026-10-05T18-04-28.969Z-405232/result.json` |
| 公网真实浏览器：购买、部署、恢复、定位链接、ready 到第 2 轮；桌面/手机画面 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/frontend-public-mobile-final/browser-receipt.json` |
| 重启后公网页面和会话 revision/round 保持 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/deployment-final.json` |
| 前端接入后全仓 3829 项：3818 通过、11 可选浏览器测试跳过、0 失败（含特效注册表合并） | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-frontend-20261006/full-regression-merged.stdout.log` |
| 公网真实浏览器在原渲染器上玩一整轮，结算与服务器一致 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-frontend-20261006/browser-public-merged/browser-receipt.json` |
| 录像接入前后两局试玩（9 轮、14 轮）终局状态与动作序列逐字一致；23 次就绪的休整结束预告与实际锻造一致 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/test/independent/production-ledger.test.js`、进度记录 2026-10-06 条目 |
| 特效注册表前后 8 场战斗结算一致、44 例逐帧显示树一致、浏览器截图差异在同版本自比的噪声量级 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-frontend-20261006/fx-registry/sim-vs-master.log`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-frontend-20261006/fx-registry/equiv-results.log`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-frontend-20261006/fx-registry/browser/report.txt` |
| 合并后九回合 CLI 烟测 176 个动作胜利；内容审计 319/319 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-frontend-20261006/cli-short`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-frontend-20261006/content-audit.json` |
| 原单人、两人合作四难度整局审计 | `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/original-solo-audit.stdout.log`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/original-coop-audit.stdout.log` |

319 项审计证明全目录能安装并运行，不等于 112 名干员每条特质都已逐条触发验证。关键真实事件、属性与边界测试集中在 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/test/independent`；后续发现具体语义问题，应增加对应事件场景测试。11 项跳过的可选浏览器测试不能写成已通过。

首轮平衡采用真实购买、装备、部署、战斗动作，无注入单位、资金或结局。九回合三路线各三 seed 全部通关；普通十四回合首批 2/9 通关。独立配置仅增加“第八轮起基础收入 +1”，微调后仍 2/9，只改变获胜路线，不能宣称已验证竞技平衡改善。

平衡原始报告：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/balance-nine.json`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/balance-fourteen.json`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-mode-20261005/balance-fourteen-tuned.json`。试验路线和机器人策略本身有局限，胜率不是人类玩家体验结论。

## 前端完成度与下一步

页面运行在原模式渲染器上：3D 棋盘、Spine 干员、拖拽部署与原版朝向轮盘、原模式顶栏与商店栏样式；数据只来自新模式视图与动作。信息分层与各区设计见 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/independent-mode/frontend-design.md`。

已经可以在网页完成：
- 开局选短程、完整、追加挑战三种演习，演习编号留空则随机，填写则可复现；`?session=` 恢复，`#piece-…`、`#shop-…`、`#item-…` 定位到对应组件，详情卡可复制链接。
- 商店两次点击购买（第一次打开详情卡），右键只看详情，刷新、冻结、升级、收起；卡片保留原卡的技能图标、阵营、价格与不能买的原因，三连进度点和「可晋升」（选中时精锐落点格亮金色），商品附带装备提示；特质图标摘要由结构化数据生成，完整文字在详情卡。
- 拖到服务器给出的合法格并选朝向，拖错位置提示原因；点选干员出现原版底框（撤退[Q]、出售[X]）和按朝向画出的攻击范围；撤回整备区，出售带装备的干员前确认；整备区超过 10 名时另列在右上角。快捷键与 Esc 关闭顺序同原版。
- 左上库存条、左侧产出栏（休整结束将锻造的预告、本次不触发的干员、上一轮结算与本轮获得的来源）、单位脚下常驻装备总等级与附加效果/交接凭证标记。
- 详情卡：原版详情卡组件，分「特质 / 属性 / 技能 / 天赋 / 装备」五页——中英文名、职业分支与站位、8 项属性（备战时为开战数值与增减，战斗中为实时数值）、攻击范围、技能图标与技力（可切换）、模组与天赋（精锐可切换），两种形态的自有特质全文、商店干员获得时自带的交接凭证、按种类合并的装备与数值合计、附加效果、蒸汽重锤款式、魔王产物偏好。点战斗中的敌人 / 召唤物、等候区的敌人、特殊地形也有原版详情。
- 库存面板：20 个格子加选中格的说明与操作（不滚动）；按件数穿戴徽章、身份标签选阵营、使用补给与保留的奖品（需要选干员、商店格或阵营的先选择）、两件合成精锐。
- 暗月奖品、免费招募、专项战备授训、三连唯一冲突的叠加层；交接面板含角色方向选择、服务器预览、原生攻击与生命的前后数值、交接后装备总等级与唯一项选择。
- 就绪后取本轮服务器录像在原渲染器回放，可 1×/2×/4× 或跳到结尾；回放中有原版音效、背景音乐、语音、阶段横幅、部署费用、击倒数、首领血量与实时漏怪；结算显示损失生命、击倒与各干员伤害治疗；顶栏右侧放大镜把镜头转到下一轮敌人的等候区，左侧放大镜打开「本局信息 / 敌方情报」抽屉；最后一场后是原版样式的终局结算页。设置面板、退出确认、右侧生效中的效果列同原版。

仍需继续，不能称为成品：
1. **原版特效还原**：注册表与事件字段已就绪（`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public/js/render/fxRegistry.js`、`fxRecipes.js`），现有效果仍是程序绘制。路线见设计稿「特效解耦与原版特效还原」第 3 步：扩展 `tools/local-extract` 导出特效贴图与预制体参数，PIXI 侧写精简粒子解释器，逐个对照原版录像验收。同日「角色DIY」线已从官方资源服务器直接下载 battle/prefabs/effects 并用 UnityPy+aklz4 解包出迷迭香的 43 个原作特效与贴图（见 `E:/WindowsWorkspace/omnicompany/docs/projects/stronghold-protocol/PROJECT_INDEX.md` 10-06 条目），下载与解包可直接复用。
2. **战斗中的产出提示**：新模式战斗内容不发事件，单位头顶「+1 灵巧（战后）」与每场上限计数尚未显示，目前在结算后的产出栏可见。
3. **浏览器逐项验收缺口**：库存使用中需要选择的补给（紧急征调凭证、阵营征调、拟态招募样本、博士晋升授权）、专项战备授训与战备晋升令的目标选择、三连唯一冲突，已有界面与参数，但只做了接口级核对，没有逐项在浏览器里点通。
4. **玩法说明**：原版的「玩法说明」是官方教程图，讲盟约、机变等本模式没有的规则，没有接入；本模式需要自己的说明页。
5. **整备区上限待定**：新模式整备区没有上限，原模式为 10 格加临时区 5 格。设计稿建议沿用原规则并做成可配置参数（会影响平衡，需重跑整局试验）；在你决定前，页面把第 11 名起列在右上角。
6. **扩展验证与平衡**：同上一阶段，九/十四轮整局 CLI 验证仍有效；十五轮追加挑战未做同等级整局验收。

前端继续通过 `applyAction` 薄接口，不另写经济/生产/交接规则。默认层只放当前阶段需要的信息，战斗里隐藏采购信息；面向玩家的文案不暴露内部 ID、管线和取证话术。

## 服务与文件职责

- 当前监听：`127.0.0.1:13000`。入口脚本：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/start-server.mjs`。执行 `node runtime/start-server.mjs` 在健康服务已存在时只返回现状，不会重启或重新加载后端。
- 服务原生回执：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/service.json`。其中 serverPid 是历史启动快照，接手时读回并核对进程命令与占用；不要照抄 PID 杀进程。重启前核对原模式连接/对局，且仅操作本项目已确认的服务。HTTP 会话持久化在独立文件中。
- 公网网关规则：`C:/Users/lilithgames/codeweb/stronghold-workshop-routes.caddy`。现有 `/stronghold/` 前缀代理已覆盖新页面与接口，本阶段没有另开网关。
- 演习持久状态：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/independent-sessions`。这是真实运行数据，不能用作清理目录或测试 fixture。
- 当前服务日志：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/2026-10-06/server.stdout.log`、`E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/2026-10-06/server.stderr.log`（上一阶段在 `runtime/2026-10-05/`）。新启动日志按实际 UTC 日期分目录，始终消费当次回执中的绝对路径。
- 项目角色与登记：`E:/WindowsWorkspace/omnicompany/docs/projects/stronghold-protocol/PROJECT_INDEX.md`，directory_contract 已 ready。正式文档在 docs、输入在 data、运行证据在 runtime、临时文件在 `.omni/tmp/<task>`；不混放，不把正式数据链接到 worktree 或临时目录。
- 过程只追加 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/independent-mode/progress.md`。实施接口计划在 `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/independent-mode/implementation-plan.md`；其中旧 worktree 段落是历史派发记录，不代表仍有活动 worker。

接手后先核对当前 Git/工作树和一个只读服务入口，再按新需求开所属主仓下的独立 worktree。用户没有授权新一轮具体开发范围时，只读取本交接，不自行扩展改造。不要覆盖未知改动、清除现有会话、推送远端或重复建一批文档卡。
