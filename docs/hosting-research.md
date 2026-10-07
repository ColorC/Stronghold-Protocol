# 工坊低负担托管研发

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
