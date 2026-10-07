# 工坊轻量托管与试部署

2026-10-07 后续实测。保持工坊玩法与原渲染器，浏览器Worker执行同版本原经济、行动与战斗模块。VPS只提供小型入口、排队、文本存档和revision CAS；大资源直接由外部静态站提供。

VPS轻后端已经安装、启动，目前仅监听 `127.0.0.1:18010`，尚未开放公网游戏入口。发布快照为原生Git `a7b493b14e3ea2529d376352735d082a71bba685`；其他职责线之后仍在更新主仓，不混入本次冻结包。新服务独立使用Node v22.23.3与ws 8.22.0，进程限512 MiB和一个CPU核心预算；空闲内存实测约49 MB。规则和玩家存档放独立正式目录，无发布树中的可写链接。

公开静态包已完成：9,900资源文件、557,798,758 B，最大文件15,994,892 B；不含用户存档、运行目录、私有文档和开发演示。拟用现有 `ColorC/Stronghold-Protocol` 独立gh-pages分支做免费试用分发，资源地址为 `https://colorc.github.io/Stronghold-Protocol/<完整Git版本>/`。VPS仅给无正文307和很小的同源Worker import壳，不代理资源或在外源失败时回流。音频现已兼容外源的application/octet-stream，并仍经过WebAudio解码验证。

GitHub Pages站点上限1 GB，带宽软限制100 GB/月；本包适合先试用，不能无限保留全量版本或承诺长期流量。[官方限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。本地候选发布commit `d80374aa06fede039c1dbeb12c330bbfc99514c2`，应用版本目录仍为a7。源包复制和9,902个实际Git blob均逐字节比较一致；`.gitattributes`防止Git换行转换改动Spine等二进制资源。

外部发布尚未执行，等待用户对GitHub push的单独确认，依据 `E:\WindowsWorkspace\omnicompany\AGENTS.md` 第38行。服务器路由激活脚本已准备；外源真实可达后才开放拟定试用入口 `https://colorc.cc/stronghold/independent.html` 并做公网Chrome整局验收，目前该链接尚不能作为可玩入口。

## 排队和实际容量

配置50人游玩、最多200人排队，FIFO和25秒长轮询；离线排队租约90秒，游玩租约120秒、30秒心跳。等待页正文764 B，控制脚本5,442 B，不引用游戏大资源。VPS实测50个游玩和200个排队全部正确，第251个503，空位优先让最早排队者进入；结束后全部租约回收。原盟约WebSocket也占总人数。

现成的[Cloudflare Waiting Room](https://developers.cloudflare.com/waiting-room/plans/)有FIFO，但Free/Pro不提供，Business/Enterprise才包含。目前轻量队列不用新增付费服务。

实际VPS隔离负载使用同一a7代码与配置、真实磁盘保存，限一个CPU核心和512 MiB；每个客户端做准入、两次创建和两次checkpoint，使用5,912 B早期存档与73,771 B第九轮存档。每档最多8秒，测试目录与玩家目录分离。

| 并发 | 全批耗时 | checkpoint p95 | 失败 | Node最终RSS | 落盘 |
| --- | --- | --- | --- | --- | --- |
| 50 | 1.684秒 | 388.75毫秒 | 0 | 168.8 MB | 100份 / 3.98 MB |
| 100 | 2.975秒 | 392.08毫秒 | 0 | 174.3 MB | 200份 / 7.97 MB |
| 200 | 5.898秒 | 385.51毫秒 | 0 | 172.5 MB | 400份 / 15.94 MB |

服务器战斗接口调用和录像文件均为零。负载生成器也在同一Node进程，CPU/RSS包含它的开销。这证明有限样本下轻存档接口能处理200客户端，不是200人完整游玩保证，也没有测出绝对最大人数；试用保持50人，公网整局和长期数据后再调。

本机从VPS下载五份既有字体，三并发聚合出口实测约3.50 Mbit/s。这是当时链路样本，不是套餐标称上限。存档请求主要入站；checkpoint确认正文68 B，50人每五秒保存一次时确认正文仅约5.44 kbit/s，另计TLS/HTTP头与心跳。首次创建与恢复仍传完整文本存档；本轮容量测试两份创建回应合计约79.8 KB/客户端，不能误计成每次常规动作出口。

## 主页、磁盘和备份的实际变化

主机除主页和转发还有反馈、Everpoint、旧Next及代理消费者，本轮保留这些服务。72份历史tar原样归档到独立数据盘，逐份解出后cmp一致；系统盘留两个有效回滚点，70个旧源逐项unlink，腾出2,279,821,312 B。历史包存在不能认定可丢弃的私人内容，没有销毁唯一恢复来源。私有单一归档 `/mnt/datadisk0/colorc-backup-archive/colorc.cc-historical-deploy-backups.tar` 仍与VPS处在同一故障域。安装新Node等之后系统盘剩约6.60 GB，数据盘剩约17.15 GB。

主页未来默认发布已去掉大demos、字体包和lab，只为本批覆盖文件生成窄回滚包，最多两个活跃点。canonical默认dry-run包15,747,582 B，Linux三次窄备份/恢复及留存演练通过；用户原有脏文件逐字节保全。没有删除现网旧内容或发布主页内容改稿。

主站已开启gzip与静态短缓存。首页HTML实际由25,081 B降到9,810 B，约减少61%；HTTPS Chrome首页启动完成、无JS错误，缓存与原安全头保留。journal和cron日志未删。

## 验收范围和接续

下文首轮代码a8的原模式、本地HTTPS外源完整Chrome整局已通过，899外源请求零失败；此前全仓4208通过、0失败、11跳过。它不代表新a7包已通过公网Chrome验收。本轮队列、checkpoint和音频针对性验证通过，a7在真实VPS的容量和FIFO通过。首次最小包漏掉server display引用的assetUrls模块，已补入；正式配置目录也显式设置SP_INDEPENDENT_DESIGN_PATH，修正后服务启动成功。

证据索引：`E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\artifact-index.json`，列实际绝对路径及作用。关键回执为同目录 `vps-capacity.json`、`queue-live-test.log`、`server-start-final.log`、`network/outbound.json`、`network/homepage.headers.txt`、`network/homepage-js.headers.txt`、`homepage-browser/receipt.json`、`github-pages-package-final/static-build.json`、`pages-preparation/preparation.json`。主页逐项记录为 `E:\WindowsWorkspace\webworks\apps\personal-homepage\.omni\tmp\colorc-disk-cleanup-20261007\backup-retention-manifest.csv` 和 `deploy-linux-test.txt`。

收到发布确认后推送候选独立分支、开启Pages、确定性等待构建终态，再开VPS入口，做公网购买、拖动、刷新、战斗、结算和第二回合验收。外源大陆速度不合格时换外源，不让素材正文回流VPS。

## 首轮历史记录（下列状态已由上文更新）

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
