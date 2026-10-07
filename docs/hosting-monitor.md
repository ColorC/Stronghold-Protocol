# colorc.cc 工坊服务器监测

工坊实际 VPS 已有 sysstat（十分钟采集）及云监测 Agent。新增的轻量 Python sampler 由 systemd 按分钟运行，不读玩家存档，也不采集请求身份、Cookie、查询串或玩家设备信息。

监测入口存于运行回执 E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-monitor-20261007\deployment.json；不将私人查看链接提交到公开源码。页面仅显示主机CPU/可用内存/磁盘/网络，以及工坊cgroupCPU/内存、游玩名额、等待人数、重启、近期HTTP错误和checkpoint延迟。所有文字可选择，每块可复制带锚点链接。断连/数据过期保留旧值并明确标记；无延迟样本不显示为零。

服务端 source: tools/hosting-monitor.py；页面: tools/hosting-monitor.html。服务端一分钟采样约0.10秒CPU时间，进程短暂启动后退出；限制64 MiB和0.1 CPU，history最多360条，浏览器取最近60条。正常状态每次记录约0.2秒墙钟，不是持续占用0.1核。

角色与正式路径：
- 代码：/opt/stronghold-protocol/monitor/releases/<原生Git>/tools/hosting-monitor.py 和 hosting-monitor.html。
- 运行数据：/var/lib/stronghold-protocol/monitor/latest.json、state.json、history.json；不是玩家存档。
- 匿名请求日志：/var/log/stronghold-protocol/requests.log；仅时间、路由类别、status、duration及body字节。
- 分钟采样：/etc/systemd/system/stronghold-monitor-sample.service 与 stronghold-monitor-sample.timer。
- 日志轮转：/etc/systemd/system/stronghold-monitor-logrotate.service 与 stronghold-monitor-logrotate.timer；每分钟检查1 MiB阈值，只保留两个旧文件，轮转用nginx原生reopen。日志轮转配置 /etc/stronghold-monitor-logrotate.conf 独立于全局任务。
- Nginx 格式：/etc/nginx/conf.d/00-stronghold-monitor-format.conf；只读页面 /etc/nginx/snippets/stronghold-monitor-ui.conf。

CPU口径：整机为所有CPU汇总百分比；工坊以单核100%为基准，服务实际限制一核。内存memoryBytes为systemd计入512 MiB限制的值；rssBytes包含共享映射，不能与cgroup值相加。页面B/KB/MB/GB使用十进制单位。流量为eth0整台VPS，包括已有代理及运维SSH，不能推断为游戏专属流量；外部素材不经过VPS，因此未计入。服务器监测也看不到玩家画面帧率和直接外源下载失败。

当前只有新 colorc.cc 游戏在监测范围内，原 workshop.colorc.cc 游戏仍由Windows服务承载。admission.active是占用名额的浏览器租约，不等于唯一自然人数，页面隐藏或离线会到期。当前完整game进程保持PID326997，自安装监测起未重启。

真实 HTTPS 和 Chrome 已验证页面读取实时VPS数据、复制链接、无外部依赖、无JS错误。fixture另外覆盖null延迟、失联保留及趋势图。首轮URI以斜线结尾却alias单个文件，Nginx index模块返回500；已改为显式index.html文件路由，游戏入口不受影响。失败回执保留。

本批证据：E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-monitor-20261007\public-browser-final\receipt.json（真实运行），E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-monitor-20261007\parent-browser-test.log（fixture复核），E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\server-monitor-20261007\install-sampler.log（服务安装与sampler测试）。
