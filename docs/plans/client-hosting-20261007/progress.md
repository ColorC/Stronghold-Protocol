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
