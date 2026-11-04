# 工坊轻量托管与外部分发

2026-10-07 已上线试玩：[卫戍协议：工坊](https://colorc.cc/stronghold/independent.html)。实际 colorc VPS 提供入口、FIFO 排队和文本存档；浏览器 Worker 使用原经济、行动和战斗模块，原三维棋盘、Spine 和音频继续使用。无需升级 VPS 套餐。

## 实际资源来源

原安装流程由 tools/fetch-assets.mjs 从公开社区仓库下载到本机 public/assets，再由本机静态服务把文件发给玩家；玩家原本没有直接使用这些上游。现在优先让浏览器从他人的固定 Git 版本下载未转换素材。

5,158 个原始素材候选已完成完整流式字节比较，其中 5,157 个一致；唯一不一致的敌人纹理保留原文件。3 个原始字体也一致，但转换后的 WOFF2 仍由静态包提供。考虑现有音频隐藏扩展名的兼容路由，当前启用 2,954 个非媒体映射、250,666,191 B；这批素材又与本次冻结包逐字节核对，全部一致。没有更换游戏素材。

Cloudflare Pages 已由账号 API Token 实际创建并发布成功，只使用免费纯静态服务，未开通付费订阅或 Functions。托管包从 557,798,758 B 降为 307,132,567 B，保留转换图集、字体、本地提取资源、代码和音频兼容路径。实际上传 6,947 个文件，另上传 _headers；单文件最大 15,994,892 B，符合免费直传限制。[Pages 限制](https://developers.cloudflare.com/pages/platform/limits/) · [静态请求计费](https://developers.cloudflare.com/pages/functions/pricing/)。

生产静态地址固定到原生 Cloudflare 部署：https://9b524c7f.stronghold-protocol-assets.pages.dev/Stronghold-Protocol/a7b493b14e3ea2529d376352735d082a71bba685/ 。不用可变的 production 域名作为版本依据；以后新上传不会改变现有游戏的资源来源。自有 VPS 对素材只发空正文 307，不代理素材，不在外源失败时回流下载大文件。同源 Worker 壳只导入外部模块。

应用原生 Git 版本 a7b493b14e3ea2529d376352735d082a71bba685；服务器版本 1de032651b4418fad6676d4874a35eaa147b597d 是该版本仅叠加精确素材来源路由。规则和玩家存档仍在独立正式目录。Cloudflare 原生 deployment 为 9b524c7f-ecc3-4217-9f06-a16aabeef2c7。未向 GitHub push；原候选发布 worktree 已原生回收，独立分支保留 Git 恢复点。

## 公网验收

真实 Chrome 已在 https://colorc.cc/stronghold/independent.html 完成购买、拖拽布阵、方向选择、刷新恢复、原三维战斗、结算、第二回合和手机布局；前端 execution=client，0 JS/请求错误。公网截图已人工检查，角色和棋盘正常。页面网络记录包含 Cloudflare 446 次请求、raw GitHub 77 次请求，自有 VPS 可观测传输 131,045 B；这份记录不包含 Worker 的独立网络目标，也不是完整冷缓存流量估计。请求记录中没有服务端 actions 或战斗计算调用，存档通过 checkpoint 写入。

切换固定 Cloudflare 部署后，另外一轮全新 Chrome 启动通过；BGM 实际 HTTP 200、audio/mpeg，WebAudio 解码为 71.11 秒双声道，所有可观测 Pages 请求使用固定部署域名。

本地混合来源的两套 Chrome 流程也已通过：客户端完整战斗、revision 冲突和恢复，以及原渲染器布阵和结算。2,954 个固定源均在 Chrome HEAD 实际网络验证为 200；剩余静态包 858 请求、140,216,857 B、0 404。完整流式 GET 比较、Chrome HEAD、完整游戏流程分别验证内容、跨源可达性和接入行为，没有混为同一证据。

修正过两项测试方法问题：首次资格比较工具漏传本地路径，失败结果保留后修正重跑；首次公网脚本在开始按钮出现前尝试点击，导致等待超时，修正显式等待后完整流程通过。部署预检使用 Python 默认 UA 被 Pages 拒绝，真实浏览器及浏览器 UA 返回 200；据此不能认定大陆不可达。不同玩家运营商的访问效果仍待实际体验。

## 人数、服务器与排队

目前限制 50 人同时游玩、最多 200 人 FIFO 等待；离线等待租约 90 秒，游玩租约 120 秒、30 秒心跳、25 秒长轮询。等待页 764 B、控制脚本 5,442 B，不提前加载游戏资源。VPS 上 50 游玩加 200 排队、最早者获空位及第 251 个请求 503 均已实测，全部测试租约已释放。

VPS 独立 Node v22.23.3 与 ws 8.22.0，限一个 CPU 核心、512 MiB；空闲约 45–49 MB。真实磁盘隔离测试使用早期和第九轮存档，每客户端准入、两次创建和两次 checkpoint：50/100/200 档耗时 1.684/2.975/5.898 秒，checkpoint p95 约 386–392 毫秒，均 0 失败。只验证有限接口负载，没有测出绝对最大游玩人数；上线保持 50。

实际出口三并发样本约 3.50 Mbit/s，套餐标称值未确认。checkpoint 确认正文 68 B，50 人每五秒保存时正文约 5.44 kbit/s，另计 TLS/HTTP 头和心跳；首次创建、恢复仍传完整文本存档。

## 主页、磁盘与维护

系统盘已释放 2,279,821,312 B；72 份历史发布 tar 已原样整合为独立数据盘上的一个私有历史包，逐项 cmp 和恢复通过，系统盘仅留两个有效回滚点。没有销毁私人内容的唯一恢复来源；历史包仍与 VPS 同一故障域。安装工坊后系统盘约剩 6.60 GB，数据盘约剩 17.15 GB。

主页未来默认发布去掉大 demos、字体包及 lab，只备份被覆盖文件并保留两个回滚点；默认 dry-run 包约 15.75 MB，三次 Linux 发布/回滚演练通过。主站 gzip 与缓存已上线，HTML 25,081 B 降至 9,810 B，约减少 61%，原安全头与主页功能保留。主机还有反馈、Everpoint、旧 Next 与代理消费者，未停掉既有服务。journal/cron 历史未删。

以后更新：先使用新 Git 版本生成客户端引擎和公开白名单包；已有固定上游资源优先沿用，变化素材重新核验；更新小型 source map、静态余量包和必要后端代码。发布完成并验收后才切换 VPS 的固定外源地址。默认保留当前和上一可恢复部署，任何仍被使用的版本先核实消费者再收口；不持续堆积全量发布备份。

## 费用与开通

当前方案只用免费 Pages。付费备选的流量样例：腾讯 CDN 大陆 0–2 TB 档 0.21 元/GB，100 GB 为 21 元；亚太 1 档 0.46 元/GB，为 46 元，均另计源站和其它适用费用。境内加速要求备案。[计价](https://cloud.tencent.com/document/product/228/75562) · [接入要求](https://cloud.tencent.com/document/product/228/3149/)。Bunny Standard 亚洲 0.03 美元/GB，100 GB 约 3 美元，存储另计，活跃账号最低月消费 1 美元。[计价](https://bunny.net/pricing/) · [账号最低消费](https://bunny.net/faq/)。没有购买这些服务。

Cloudflare 当前付款列表含银联、Visa、Mastercard、PayPal 等；实际扣款取决于银行及支付校验。普通免费/Pro 不包含中国大陆节点，大陆网络是 Enterprise 的独立订阅且要求 ICP 备案，能付款不等于大陆访问会快。[付款](https://developers.cloudflare.com/billing/understand/billing-policy/) · [中国网络](https://developers.cloudflare.com/china-network/)。本次账号级 Token 的正确验证端点、Pages 创建、上传和原生部署状态均成功，凭据没有进入代码、报告、公开资源或 VPS。

## 证据入口

实际绝对路径索引：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\artifact-index.json。
公开流程：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\public-browser-final\browser-receipt.json。
固定部署音频验收：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\pinned-browser\receipt.json。
外源资格、混合包与浏览器：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\hybrid-preview\summary.json，E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\hybrid-preview\browser\hybrid-browser-receipt.json。
磁盘逐项与恢复：E:\WindowsWorkspace\webworks\apps\personal-homepage\.omni\tmp\colorc-disk-cleanup-20261007\backup-retention-manifest.csv，E:\WindowsWorkspace\webworks\apps\personal-homepage\.omni\tmp\colorc-disk-cleanup-20261007\deploy-linux-test.txt。

## 首轮历史记录（旧方案与状态已由上文替代，不作当前决策依据）

2026-10-07。目标是以后迁到 colorc.cc 自有服务器：保持工坊现有玩法、规则和渲染器，前端承担计算，大资源从外部下载，同时准入约 50 人。本次实现和隔离验收，不是正式迁移；现有线上发布未重启。

## 建议的部署形态

浏览器的 Web Worker 执行原版工坊经济、行动与战斗代码，使用同一版本配置；三维棋盘、Spine 和音频仍由原渲染器处理。录像存在浏览器 IndexedDB，保留最多八场、总计 32 MiB。自有服务器只提供小型入口、准入租约、初始存档与存档增量写入，使用原生 revision 比较，拒绝过期写入；不生成工坊战斗或录像。

所有大素材、代码、字体和公开配置发布到独立 HTTPS 静态站。优先采用完整的固定版本 Cloudflare Pages 包。自有服务器对静态路径返回无正文的 307，后续模块导入直接使用外部版本路径；不代理素材，也不在 CDN 失败时回流下载大文件。同源 Worker 入口只是小型 import 壳。

第三方原始资源的代表样本已经用真实 Chrome 验证 CORS 和 Spine 渲染。但不能把全部游戏路径直接替换成 GitHub 地址：本地素材没有完整公共映射，一些图像、字体和 Spine 图集经过转换，jsDelivr 的 voice 样本也返回 404。为了保持现有游戏，完整外部静态包比拼接多个不完整的热链源更可控。原始仓库可继续用于构建供给；玩家无需经 colorc.cc 下载素材正文。

资源清单的 5,700 个实际引用均已核验存在，补齐了缺失的中文语音和一项告警音。完整包约 556.7 MB，包括为现有扩展名隐藏音频路径保留的 78.2 MB 兼容副本；不是每位用户一次下载全包。文件约 9,891 个，最大单文件 16.0 MB，低于 Pages Wrangler 直传的 20,000 文件与 25 MiB 单文件上限。[官方限制](https://developers.cloudflare.com/pages/platform/limits/)。Pages 的静态资源请求免费且不设计费请求数量上限，Functions 另计；本方案不使用 Functions。[官方计价](https://developers.cloudflare.com/pages/functions/pricing/)。尚未创建或发布实际 Pages 站点，大陆访问速度与可达性也未验证。

## 人数、网络和存储

设 `SP_INDEPENDENT_MAX_ACTIVE=50` 后，在返回游戏入口和加载模块前获取租约。第 51 个新访客收到小型 503 满员页面和 Retry-After，不下载游戏资源。租约 120 秒，浏览器每 30 秒续租，关闭或掉线后到期回收；原盟约的 WebSocket 连接也参与总数限制。它是单进程正常访客限额，不是 DDoS 防护，也不是按真人身份去重的统计。多进程部署需要共享准入设施。

实测普通操作增量：购买 5,340 B、移动 529 B、装备 653 B、刷新 678 B。假设 50 人每五秒操作一次、上述动作等比例，JSON 正文约 144 kbit/s；全员购买的隔离 HTTP 样本约 455 kbit/s。HTTP/TLS、入口和心跳还需额外余量，战斗结束也有突发写入，不能把这些数当成公网带宽保证。

完整十五回合样本的最大存档 101,299 B，50 份约 5.1 MB；最大单场录像约 5.9 MB，由浏览器保存。隔离测试同时接受 50 个客户端、拒绝一个，50 次存档写入完成，服务器录像文件为零。这些运行在开发机上，未进行 colorc.cc VPS 的 50 人压力测试。

客户端持有单人存档，因此适合当前工坊体验，不能作为排名、奖励等竞争性记录的权威。服务器已限制请求体并校验存档结构；存档保留和累计容量配额尚需在正式上线前明确，当前不会自动删除历史存档。配置目录应使用独立、明确的 canonical 运行路径，不能放在发布 checkout 里。

## colorc.cc 当前实际负担

只读 SSH 与公开域名响应对照确认：主机为 2 vCPU、3.57 GiB 内存，当时可用 2.55 GiB，load 0.06 / 0.02 / 0.00。CPU、内存当时不紧张。根盘 79%，剩 4.22 GiB；另有数据盘约 19 GB 可用，但用途尚未核实。

主页静态树约 393 MiB，其中 demos 约 300 MiB、lab 约 70 MiB。72 份发布备份占 2.53 GiB；日志约 808 MiB，其中 journal 644.8 MiB、cron 125 MiB。未删除任何备份或日志。

当前服务还包括反馈接口、Everpoint、旧 Next.js，以及若干代理路由；不是只有主页和转发。Workshop 当前是外跳，主要运行负担不在这台 VPS 上。旧 Next.js 仍被默认虚拟主机和 /lab/api 使用，不能依据“废弃版”名称直接停掉。主站公开静态响应有 ETag/Last-Modified，但未看到 gzip 或明确 Cache-Control。

优化顺序：核验并收敛发布备份的保留与恢复链；给 cron/journald 设置合理轮转和增长上限；为 HTML/CSS/JS/JSON 做预压缩，版本资源长缓存、固定名资源短缓存，动态接口保持独立缓存策略；核验旧服务和失效代理的真实消费者后再调整。大体积 demos/lab 可逐项迁到外部静态站，保留原 URL 跳转或代理规则中的直接外跳，避免复制游戏素材到 VPS。

公网带宽套餐上限仍未知。元数据没有提供该值，当前没有可用腾讯云 API 客户端或控制台 connector；10 秒网卡采样不能证明上限。腾讯云的原生字段是 `InternetAccessible.InternetMaxBandwidthOut`。[官方实例结构](https://cloud.tencent.com/document/product/213/15753)。因此尚不能承诺现有套餐的 50 人峰值。

## 正式上线配置与验收

建议工坊使用独立子域，避免与主页的 /assets、/data 和 /js 路径冲突。后端设：

```text
SP_INDEPENDENT_EXECUTION=client
SP_INDEPENDENT_MAX_ACTIVE=50
SP_INDEPENDENT_DIRECTORY=<独立运行数据区的绝对路径>
SP_STATIC_BASE=https://<实际静态站>/<完整 Git commit>
```

构建同一干净 Git 版本的 Worker 和静态包，先上传外部静态站，再配置 API 服务。只有大陆真实入口整局通过、确认套餐带宽及存档配额、在目标 VPS 做有界负载验收后才切换正式入口。旧版本的 CDN 路径须在仍有玩家运行期间保留。

本次完整测试 4,208 项通过、0 失败、11 跳过；原服务器执行方式的真实 Chrome 招募、拖动部署、战斗、第二回合通过。新跨域路径修改另有针对性测试（39 通过、0 失败、6 跳过）。最终代码验收版本 Git `a8ad2ef866afb12d7164c1598eb60ad051fb6e7a`：实际购买、鼠标拖动部署、方向、刷新、战斗回放、结算、第二回合与手机尺寸通过；Worker catalog 与服务器线协议值相同，存档冲突拒绝、浏览器录像和服务器无录像通过。两个浏览器检查共 899 次外部静态请求、132,772,097 B，零静态失败；这是包含刷新和两组流程的总量，不是每位玩家一次开局下载量。

最终静态包 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\client-hosting-20261007\integration\static-package-ui\static-build.json`，版本同上，9,891 文件、556,729,423 B。跨域总回执 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\client-hosting-20261007\integration\cdn-ui\cdn-receipt.json`，UI 回执 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\client-hosting-20261007\integration\cdn-ui\ui-browser\browser-receipt.json`。后续文档提交不改变这份已验收的代码或静态包。

证据根：`E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\client-hosting-20261007\`。具体文件与作用由 `artifact-index.json` 列出。主机只读报告：`E:\WindowsWorkspace\webworks\apps\personal-homepage\.omni\tmp\colorc-host-audit-20261007\colorc-host-audit.md`，其中列有所有实际采集文件与作用。
