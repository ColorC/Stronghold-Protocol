# 工坊计算与分发减负研发

2026-10-07：用户目标是后续部署到自有 colorc.cc 主机，保持工坊玩法与画面，计算尽量前移、内容尽量外部分发，同时50人，超限拒绝。当前不是正式迁移或购买服务。

- 编号 e5d66fd4a8cd41a2 为同项目暗月效果译稿会话；读取原生画布 revision 1 和材料引用，未更改译稿。
- 主仓基线 d31592f27b1567267ff35ac95932f08c8ae74d9d；线上 release 7e726de4872934236522d01a9a519e4c8c36dc19。原盟约支持 client combat，工坊 applyAction ready 仍在服务器战斗、保存录像。
- 并行三个有界任务：主机只读审计20分钟，客户端实现40分钟，素材分发30分钟；原生等待/确定性到点提醒，不使用退役技能。
- 所有代码工作副本由 git worktree add --no-checkout 创建后稀疏检出，排除 runtime/var/.omni 和素材。运行证据落 canonical runtime/client-hosting-20261007/，无正式内容的可写链接。
- 客户端方案复用同版本原经济与战斗代码，在 Web Worker 运算；服务器做 bounded checkpoint + revision CAS；既有服务器执行方式兼容。原生 Git commit 为版本依据。
- 入场方案 SP_INDEPENDENT_MAX_ACTIVE=50，内存租约120秒、30秒心跳；与原盟约WebSocket计数共享上限。在HTML返回与API动作前校验，第51个请求返回无素材引用的小型503页；默认未开启保持现网兼容。
- admission四项纯逻辑测试已通过；真实HTTP并发51请求与退出回收验证待执行。
- 技术来源：Cloudflare R2官方计价页（2026-10-07查）提供标准存储免费量与零出口流量计费；Pages官方上限单文件25MiB，不预设大陆访问速度。需原始源CORS/Spine图集一致性验证才能判可直取。

2026-10-07：入场与外部分发入口实现通过8项测试，50个并发HTTP成功、第51个503无素材引用；API无租约403，续租/释放可回收。SP_STATIC_BASE要求HTTPS和完整Git commit，静态请求307外源、同源Worker回小型import壳，无代理回流。默认配置兼容。

静态回归首次因sparse副本没有generated public/vendor失败，已按精确7个库提供独立测试代码缓存后258项全部通过。失败与修正日志分别为 E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/admission/static-regression.log 和 E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/admission/static-regression-fixed.log；入场/外源日志 E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/admission/tests.log。未修改线上发布。

2026-10-07：后续部署可用 SP_INDEPENDENT_EXECUTION=client 强制工坊前端计算，bootstrap开局前选择client模式，旧服务器actions入口返回409而不运算。SP_INDEPENDENT_DIRECTORY要求绝对独立运行路径，发布目录不作为存档真源。9项相关测试通过，回执 E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/admission/tests-final.log。

主机只读审计完成，证据报告 E:/WindowsWorkspace/webworks/apps/personal-homepage/.omni/tmp/colorc-host-audit-20261007/colorc-host-audit.md 和 audit-data.json：2CPU/3.57GiB，快照可用2.55GiB/load低；根盘79%，剩4.22GiB，备份72份共2.53GiB，日志808MiB；另有数据盘用途未验证。当前Workshop为外跳。主站无gzip/主要静态明确缓存；旧Next仍被路由依赖，禁止凭废弃名称直接停。50人动态/公网带宽峰值未验证。

2026-10-07：前端引擎与外部分发完成整合。完整全仓测试4208通过、0失败、11跳过（E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/integration/full-suite.log）；跨域路径后续修改针对性39通过、0失败、6跳过（同目录cdn-path-tests-fixed.log）。首次稀疏副本无vendor的失败保留在cdn-path-tests.log，补齐独立代码缓存后通过。全5700素材引用missing=0，1679语音和告警补供回执在E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/asset-distribution/manifest-assets-final.json、manifest-voice-repair-results.json、alarmenter-repair.json。

最终验收代码a8ad2ef866afb12d7164c1598eb60ad051fb6e7a，原规则复用Worker、增量checkpoint、50准入、固定Git路径静态包；完整跨域Chrome购买/拖动/朝向/回放/下一回合/手机尺寸通过，catalog线协议相同，899外源请求0失败。实际回执E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/integration/cdn-ui/cdn-receipt.json、cdn-ui/browser/browser-receipt.json、cdn-ui/ui-browser/browser-receipt.json。独立50客户端写入并第51个拒绝通过，实际回执同integration/capacity/capacity.json；未在colorc VPS压测，未迁移或重启现网。

旧外源测试先发现模块相对路径越过版本根、变量动态import和CSS自定义属性从CDN根解析的问题，已修复；中间catalog字符串比较失败在精确版本复测不再出现，诊断增强记录语义首差异，未改Worker或游戏数据来消除检测误报。原服务器方式Chrome整轮通过，回执E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/integration/legacy-browser/browser-receipt.json。

assets/client子任务工作副本与分支已原生收尾，原始client诊断9d9fcc保留merge ancestry。client自产失败generated目录此前被工具policy拦截删除，未重试；改为保全迁移至E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/client-hosting-20261007/preserved-client-generated，再原生worktree remove，无force。实际收尾回执E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/client-hosting-20261007/asset-distribution/worktree-cleanup.json与client-compute/worktree-cleanup.json。

2026-10-07 后续：用户追加FIFO排队、磁盘清理、主页轻量收窄和VPS试部署，少量回滚即可。queue delivery ddd0be49已合入，MAX_ACTIVE50/MAX_WAITING200，25秒长轮询；音频octet-stream兼容ac810b1已合入。真实VPS以冻结a7b493b14e3ea2529d376352735d082a71bba685最小发布安装Node22.23.3/ws8.22.0并启用独立sp-workshop服务，监听127.0.0.1:18010，CPUQuota100%/MemoryMax512M，空闲内存约49MB。首包漏assetUrls和独立design路径导致两次启动失败，保留日志；packager ea2d895和显式SP_INDEPENDENT_DESIGN_PATH修正后启动成功。未开放公网游戏入口。

真实VPS隔离50/100/200矩阵均0失败，checkpoint p95 388.75/392.08/385.51ms；700份合成存档，共27,889,050B，0服务器录像。回执 E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/server-deploy-20261007/vps-capacity.json；真实生产后端租约50+200/第251个503/FIFO提升/释放全部通过，queue-live-test.log；两者不代表完整公网游戏最大容量。五字体下载三并发出口实测3.501Mbps，network/outbound.json，只是链路样本非套餐上限。

主机72份旧tar私有单一归档到/mnt/datadisk0/colorc-backup-archive/colorc.cc-historical-deploy-backups.tar，72/72 byte cmp通过、精确unlink70份，系统盘腾出2,279,821,312B，留两个有效回滚；不销毁含私人内容的唯一历史来源。主页27c72996合入默认轻量白名单/窄回滚/留2、canonical dry-run包15,747,582B与Linux三次演练通过，现网正文不发布。VPS gzip/静态缓存已上线且安全头保留，首页25,081到9,810B；实际Chrome首页启动无JS错误。系统盘装Node后剩6.60GB。

外源包a7已构建557,798,758B/9,900资源，Pages候选orphan commit d80374aa06fede039c1dbeb12c330bbfc99514c2逐blob对比9,902项0差异，专属-text属性防二进制换行转换；仅本地准备，等待用户确认external git push（omnicompany/AGENTS.md第38行），未修改远端。外源可达后才启用拟定https://colorc.cc/stronghold/independent.html并实际公网整局验收。所有本批产物与作用由runtime/server-deploy-20261007/artifact-index.json列出，Workshop沿用同两张结果卡。

### 2026-10-07 Cloudflare 真实发布与公网验收
- 用户明确提供账号 Token 并授权试用 Pages，正确账号级验证 active，免费纯静态项目创建及发布成功；未购买付费、未 GitHub push。原生 deployment 9b524c7f-ecc3-4217-9f06-a16aabeef2c7；应用a7，后端1de03265。
- 全量上游资格完成，5157素材+3字体一致；启用2954非媒体项，移出250666191 B，余包307132567 B。冻结包再次本地字节核对全通过，Chrome全2954 HEAD与两套本地游戏流程通过。
- colorc公网入口已接通；真实Chrome购买/拖拽/恢复/战斗结算/第二轮/手机布局通过，0错误。Pages固定部署域名启动与BGM WebAudio解码再次通过，避免后续发布覆盖现有来源。
- a7叠加仅hosting映射的后端提交1de已在VPS运行；fixture测试先因稀疏checkout假设失败，改用独立public fixture后7/7；修正提交1bac合入master7cdf，未改游戏。首次安装尾部健康校验用了错误字段maxActive，实际服务已启动；改读limit后复核通过，未重复安装。
- no-checkout工作副本初始index为空导致cherry-pick失败；配置稀疏后read-tree尊重范围补齐，再cherry成功，没有完整checkout data/runtime。原生清理后端与未推送Pages候选worktree，报告branch保留Git恢复点。
- 证据索引：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\artifact-index.json。公网回执：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\public-browser-final\browser-receipt.json；固定部署：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-deploy-20261007\pinned-browser\receipt.json。首轮失败日志保留，不当成功计数。
