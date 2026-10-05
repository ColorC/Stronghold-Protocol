# 罗德岛战备演习实施计划

所属项目：stronghold-protocol。主仓：E:/WindowsWorkspace/webworks/apps/stronghold-protocol。开发基线：26a3aaad2f993b0d2dc60a79f4535351566203ee，包含上游 8774379d3be06fba3961f388f21c2eea3b666152。

## 完成条件

在保留原独立模拟与同盟模拟的前提下，新增“罗德岛战备演习”。先提供可持久化的纯后端、CLI 操作和无头验证，再保存后端 Git 版本，接入简单网页。复用已有 Battle、283 个技能、召唤物、敌人、地图、SharedPool、GameData、board 合法性与波次生成。独立经济与回合规则需要单独编排，不复制原 Match 的网络、合作与计时流程。

覆盖完整112名干员的普通与精锐自有特质、15种一级徽章、59种原物品去向、独立功能装备、12个稀有继承词条、4种外来附加效果与全部暗月奖品。所有机制使用明确结构化规则或明确注册的处理器，运行时不解析中文描述、不用空处理器冒充完成。原技能、天赋和模组从上游取数及实现。

## 持久状态和公共接口

`server/modes/independent/session.js` 导出 `createSession(options = {})`、`applyAction(state, action, options = {})`、`viewSession(state)`、`validateSession(state)`。成功动作返回 `{ ok:true, state, events:[] }`，失败返回 `{ ok:false, error:{code,message}, state }`，失败必须保持输入状态完全不变。所有调用不直接修改输入状态；state 可 JSON 往返且保存 rngState 和 nextUid。

state 的字段：schemaVersion、modeId（independent）、seed、rngState、nextUid、revision、round、roundLimit（9/14/15）、difficulty（FUNNY/NORMAL/HARD/ABYSS）、phase（prep/prize/finished）、funds、pendingFunds、lp、deployCap（默认8，最多9）、shop、pieces、inventory、offers、playerEffects、counters、pool、history。

shop 为 `{level, upgradePrice, slots:[{kind:'chess'|'equipment',id,elite:false,price,sold:false,equipment:[]}], frozen, freeRefreshes}`。pieces 为 `{uid,chessId,elite:false,row:null,col:null,dir:'RIGHT',skillIndex:0,moduleId:'none',equipment:[],attachments:[],nativeState:{},bodyPenaltyApplied:false,poolCopies:1}`。equipment/inventory 条目为 `{uid,id,elite:false,quantity:1,state:{}}`；attachments 为 `{id,state:{}}`。物品 ID 用来源 sourceId（已重命名装备保留sourceId），徽章 ID 用稳定的英文语义 id；通过catalog查名与等级。chessId保留上游普通 `_a` 或精锐 `_b` ID。offers 队列为 `{id,type:'recruit'|'prize'|'attachment',choices:[],tier,source,targetUid?}`。counters 包含 gained、bought、paidRefreshes、spent、sold，原生效果逐实例次数放在 nativeState。

动作：buy(slot)、refresh、freeze、upgrade、sell(uid)、move(uid,row,col,dir)、bench(uid)、loadout(uid,skillIndex,moduleId)、equip(itemUid,targetUid,quantity?)、merge-item(firstUid,secondUid)、use-item(itemUid,targetUid?/slot?/faction?/selection?)、choose(offerId,index,targetUid?/selection?)、inherit-preview(donorUid,receiverUid)、inherit(donorUid,receiverUid,uniqueSelections?)、ready、inspect(uid?)。view要包含角色名字、原技能、自有特质、装备总等级、装备/附加效果/继承资格分开表示、当前阶段合法动作、真实棋盘合法格、战斗摘要与战斗采样帧。

买价3、卖价1、刷新价1。复用基础收入、升级价、商店科技分布和拷贝卡池。新模式不启用旧盟约层数、策略轮选、机变、悬赏与旧物品处理器。所有徽章一级；装备容量99，数量按实际件数计算，不可卸下或替换；普通出售销毁全部穿戴装备与附加效果。库存两件同名普通物品可以按catalog规则合成精锐，不把已穿戴装备拖入合成。三连保留合法装备和附加效果，自有特质升级为精锐，容量或唯一冲突必须原子预检；保留选择必须明确，无静默丢失。

继承资格为本体稀有词条。给予限制满足或接收限制满足即可，限制仅用原生科技/阵营/职业。同格地形、容量、唯一冲突先预检；旧本体出售一次并退出，原身材/技能/天赋/自有特质/资格不转移。允许转移的装备和满足接收限制的附加效果整体转移；次数不能重置。新本体原生攻击和生命暂按20%损耗一次，此值放config可调且标明试验参数；装备贡献不扣。

## 内容模块接口

`server/modes/independent/catalog.js` 导出 `getCatalog(data?)`，默认读取版本化的 `data/independent-design.json` 与上游 getData。返回 `{id,name,config,badges,equipment,operators,permissions,attachments,prizes}`，operators以实际 chessId可查询且包含112普通及精锐对应项，badge/equipment/prize都有稳定 id、名字、等级/类型和明确规则。重命名物品仍以sourceId查找，随身身份牌与变形同构体归并调和识别牌。只能在catalog中禁用那5种物品，不投放未知或无处理器物品。

`server/modes/independent/native.js` 导出 `runNativeHook(state, hook, event, services)`、`nativeTraitFor(chessId,catalog)`。hook为gain/sold/roundStart/prepEnd/refresh/spend/merge。services提供 `{data,catalog,rng,grantEquipment(state,id,quantity,extra?),grantChess(state,chessId,extra?),addOffer(state,offer),record(state,event)}`。处理器作用于工作副本；生产事件带origin:native/equipment/attachment及sourceUid防止递归。复制和复演只读取自有特质，不能搬运资格/装备/附加效果。延后资金、商店携装和装备供给按设计完整结算。battle自有特质由战斗模块负责。

`server/modes/independent/battle.js` 导出 `runIndependentBattle(state, {data?,catalog?}={})`，不修改state，返回 `{result,rewards:[{id,quantity,origin,sourceUid}],pieceStates, samples, diagnostics}`。使用上游Battle、地图和波次，headless按固定步进运行，显式tick上限；为客户端保留有限采样，不构造新战斗引擎。flags.independent包含序列化catalog与pieces等模式输入；每名operator input的uid对应piece.uid。

`server/sim/content/independent/battle.js` 导出 `installIndependentBattle(battle)`，纯ESM不得引入Node API。技能天赋与tokens/devices/enemies/bosses走上游；模式隔离通过 `content:'independent'`，仅该模式跳过旧bonds/garrisons/items/bands/choices安装，保留手写KITS与token kits。新机制做成事件钩子与属性buff，不改伤害、寻路、技能引擎。battle生成的实体产物只进入战后rewards，不能反向复制生产。

## 并行任务和落点

- catalog/native：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/independent-catalog，分支feature/independent-catalog；只写catalog.js、native.js和test/independent/catalog-native.test.js。读取版本化设计input与当前上游数据。范围固定为全部内容目录、完整准备阶段原生效果与注册覆盖验证。
- battle：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/independent-battle，分支feature/independent-battle；只写两个battle.js、server/sim/content/index.js必要模式分支和test/independent/battle*.test.js。范围固定为全部战斗自有特质、徽章、功能装备和附加效果钩子及实际无头战斗。
- core：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/independent-core，分支feature/independent-core；只写session.js、equipment.js、prizes.js、inheritance.js、tools/independent.mjs和test/independent/core*.test.js。范围固定为CLI可执行的全流程、经济/物品/奖品/继承/持久化与原子校验。

root负责接口裁定、版本化设计输入、合并冲突、整局和原模式回归、平衡实验、后端Git版本、HTTP接线与简单前端。禁止代理增加模式外功能、写原模式数据或覆盖其他任务文件。交付为Git commit、修改路径、真实测试命令与日志绝对路径、明确剩余缺口。测试fixture允许注入直接内存state，生产CLI不提供任意grant作弊入口。测试不要求浏览器；不得用虚构战斗结果代替Battle。

每个任务预期首次结果约20分钟，最长首次检查25分钟；超时由root检查一次并处理，不能长期静默。完成即提交本分支，由root合并；最终用git worktree原生收尾，无force删除。运行日志统一root/runtime/independent-mode-20261005，任务临时资料统一root/.omni/tmp/independent-mode-20261005。不得创建正式内容的链接。

## 验收

目录112普通/112精锐全覆盖；每个效果明确可执行处理器；无未实现/空处理器。实际无头事件测试覆盖获得/出售/开始/结束/耗弹/部署/冻结/死亡/施技/击杀/治疗、转移次数保持、唯一冲突、99容量、三连、补给与玩家设施、暗月19项奖品及4附加效果。CLI新建、动作、保存、重载、完整9轮和14轮对局运行，并对seed重复产生一致结果。原模式回归全套Node测试（包括已有无头浏览器测试，浏览器为headless），单人和合作整局工具检查。平衡只改独立config，记录种子、路线、成功率、产物量、装备等级分布和调参前后证据，不宣称竞技平衡已完成。

后端验收并保存Git commit后，新增复用后端动作API的简单页面，保留原首页模式。界面核心只有商店、阵地、资源、角色装备总等级和当前阶段操作；角色/装备详情折叠。文字可选中，角色和物品可复制定位链接，独立页面含全屏打开。网页不能另写经济或战斗规则。原有https://workshop.colorc.cc/stronghold/继续使用，新模式入口https://workshop.colorc.cc/stronghold/independent.html。
