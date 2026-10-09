# 共鸣用户故事与接口

本文件固定首轮界面和状态流。使用现有 Preact、ui/fieldHost、朝向轮、音频、原生 Pixi/Spine 战场与 DOM fallback。经营/战斗都由服务器同一权威状态与配置完成，客户端只提交动作和播放该场结果，不另写经济或伤害模拟。

## 开局与整备

`resonance.html` 经共用 admission 进入独立共鸣入口。开局选择四难度之一，再从按种子抽出的三个环境选一个；也可展开全部环境查看规则及可招募名单。重开与继续上局分别可用，URL `?session=<id>` 可以远程恢复，环境选择在创建session前完成，不能局中换环境套供给。环境描述只说明该环境实际全局规则，不替换成盟约说明。

上栏直接显示当前经营节点、下一遭遇名称、目标生命、金币、经验/科技人口、部署人数、预估利息与连续胜败。五格商店只售干员，显示原头像、招募费用、基础盟约、固定技能摘要；点击购买结果立即回整备阵容，自动升星标识主实例和保留装备。刷新、锁定、购买经验都有当前价格与可用状态，概率在科技详情里查看。九格备战区与场上支持原拖放/四朝向轮；已部署者可换合法空格、换回备战区，不能因session初版只接受bench→deploy而漏掉基本移动故事。

左侧盟约显示实际不同charId人数、当前档位、下一档位；点击查看完整效果、在场成员、可招募成员与所需转职。异格计独立charId，重复同charId只算一次。装备转职标签额外生效，不以重复同名装备刷人数。所有配方和转职规则来自正式配置，界面不能依文字重新判定效果。

装备栏显示背包内每件装备；选择干员即可穿戴，穿戴栏可以拆卸，选两组件查看配方并合成。满栏合成、穿戴组件与背包组件合成、同名唯一机制都能看结果；回收按钮显示被处理的装备名，玩家明确回收后毁弃且不返钱。复制器是独立补给令（不占三装备槽、不计盟约），选择已有合法干员使用；只从当前池取一份，池空不消耗令并明确显示。

干员详情含当前真实属性、三个星级预览、固定技能及施放节奏、原天赋、追加星级被动、攻击射程/对空/召唤物、盟约与装备。调整后的数值必须反映在玩家说明，不能原文字还写旧SP/倍率。具体成长为实例拥有，不聚合到全体角色。图鉴可筛费用、盟约、职责与当前池，并查看未入本局者。

## 策略、后勤与奖励

经营节点开始时先处理固定补给和策略，未领取奖励保留在状态，不塞爆背包/备战区，不静默转币。一次操作可以建立次级选择（例选择策略→选择装备/转职/目标；装备熔炉拆卸→选择现有材料可合成的配方），完成后继续整备。容量不足可直接穿戴、合成、卖牌、回收，处理后领取原奖励；不得创建无上限临时备战区。FUNNY奇数节点显示“领取后勤并继续”，走权威后勤结算，不播放伪战斗；其余节点准备后“开始战斗”。

所有策略显示实际生效时点/条件/次数，延迟援军与任务显示进度与剩余节点。前提不满足的策略不进入三选一；在选择后因卖牌等行为失去前提时按配置替代收益处理，不假触发。任务由权威Battle小聚合计数推进，断线恢复不能重复兑现。

状态增量：`pendingChoices`有稳定uid、type、source、remaining、options；`consumables`有uid/kind（smallCopy/universalCopy）和来源；`strategyState`按strategyId保存次数/任务值/到期节点/选中目标；`claimedNodes`保存已供给节点避免重复领取；`activeOperatorIds`可从已保存环境+seed确定性重建但存档需验证相同池。history为紧凑经营摘要，战斗replay独立持有，不能整帧塞进session。

动作接口除现有经营动作增加：`move(pieceUid,row,col,dir)`、`advanceSupply`、`chooseStrategy(choiceUid,strategyId,targets?)`、`claimReward(choiceUid,optionIds)`、`useCopy(consumableUid,pieceUid)`、`disassemble(itemUid)`、`setSummonOrder(pieceUid,tokenId,row,col)`、`clearSummonOrder(pieceUid,tokenId?)`。非法/过期动作原子拒绝，state不变。`choice`阶段允许部署、卖牌、穿拆合回收等容量整理；只禁止战斗或后勤推进跨过未决选择。

## 战斗与结束

真实权威Battle返回逐帧记录供玩家这次播放；快推演默认recording:false。战斗画面沿用原场地/敌人/领袖/Spine/声音、技力/弹药条/元素标识/部署费用/目标生命；新增冰雪、火墙、音域、召唤实体必须在3D与fallback均可见。播放支持暂停/继续、倍速、跳到结算；记录与结果同一Battle，不能播放另一场重算结果。

单场结束显示胜败、目标损失、基础币/胜利币/连续币/利息/额外收益分项与经验，任务完成与永久实例成长可查。敌人情报始终可看实际本场wave/领袖/天赋。最终结果提供完整阵容、装备、策略、环境与主要伤害/治疗/控制等聚合；继续浏览本局详情、回看保留单场、回到开局皆可操作。用户录像功能可在完整内容完成后沿用既有 recording 设施，不让日常平衡流程自动生成录像。

## HTTP与存储

独立前缀 `/resonance/api/`，保持共用admission，不改原工坊路径语义。`GET catalog`返回轻量玩家catalog而非每人三份完整原record；`POST sessions`仅接受seed/difficulty/environmentId，禁止rawState创建/任意checkpoint绕过玩法。`GET sessions/:id`返回stateView含field/preview/legalTiles/pacts/choices；`POST sessions/:id/actions`要求expectedRevision和action，串行排队、每session锁、真实revision并发拒绝；`GET sessions/:id/replays/:round`返回该round保留replay。stateView包含当前行动所需信息，原生技术source只在主动打开开发诊断时返回。

目录为canonical `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance`，session数据独立，不复制其它runtime。玩家回看按本session每场最多一份gzip；当前源码候选/测试生成的存档与replay统一计入2GB预算。headless test禁止默默落文件。HTTP正确原子保存、同源限制、body大小/会话ID验证、损坏存档明确错误；不得用digest阻止内容可见或替代原生版本。发行版保留既有工坊功能及资源复用配置。

## 定位、复制与全屏

正文可鼠标选取复制；拖拽操作仅在实际拖拽时禁选。每个干员、盟约、装备、配方、策略、环境、节点、详情具有明显“复制链接”操作；URL fragment稳定类型/原生ID，重开直接打开对应详情，即使不在当前池也可看图鉴。内部ID只在URL与诊断数据，不打印到默认界面。重叠选择沿用原renderer循环选中。嵌入Workshop时显示小的“全屏打开”链接，打开独立页面并保留session与fragment，不只调用本机全屏API。

## 完整浏览器验收

全部内容、规则和无头推演完成后，真正浏览器逐一执行：开局三环境选择/全部目录，九备战/人口边界，五商店/利息/XP/锁定/池守恒，3→2→3星保位/满装备，36配方对称与领取满容量，转职去重/大盟约成型，所有36策略的六种时点流，FUNNY后勤，普通/困难/深渊终战，固定技能/召唤/四朝向、两签名终端/雪/火墙、断线重载/过期revision/回看、文字复制/详情深链接/嵌入全屏、桌面和移动横屏。未知或失败项保留准确证据，修复后继续验证，不把部分流程通过写成全模式完成。
