# 高本干员 VFX 批量还原流程

## 目标

优先完成可见、非 DIY、五本和六本干员的角色战斗表现。当前批次共有 38 名干员：六本 19 名、五本 19 名。验收以干员的完整战斗表现为单位，包含攻击起手、投射或动作、受击、技能起止、场地范围、地图斩击、骨骼挂点、朝向和资源生命周期。

## 证据层级

1. **上游动画证据**：读取 upstream/master 的 `data/assets.json`，记录每名干员的 front/back Spine 动画、命中时刻和动作事件。该层只证明动作时序，不把动画名猜成 VFX。
2. **反编译战斗绑定**：从 `[uc]skills`、projectile prefab 和 action effect 槽中确认效果名称、触发事件、重复次数、目标侧/持有者侧/地面侧和方向。
3. **原始 prefab 解算**：逐个解算粒子层级、材质、shader、纹理、Mesh、粒子寿命和自定义顶点流；不能解算的 shader 必须进入未解决清单。
4. **Unity 取证导出**：对 atlas 和 Mesh 分开导出。atlas 保存颜色与 coverage，Mesh 保留顶点、索引、UV、节点变换和材质。
   统一 atlas 后处理入口为 `tools/assets/vfx-atlas-post.py`；它保留原始颜色与 coverage。加法发光允许颜色大于 coverage，不能截断颜色或从亮度构造 coverage；直接 Unity 地面参考与合成验证见 `docs/research/14-vfx-source-pipeline.md`。
5. **语义绑定**：把每个效果绑定到干员、目标、格子或骨骼挂点。命中效果不能挂到施法者；地图 Mesh 不能压成干员 billboard。
6. **浏览器接入**：按事件时序播放，资源带批次缓存键，预加载分批让事件循环可响应；加载、缺失、未解决和活动挂点都可观测。
7. **密集验收**：浏览器抓取 pageerror、console error、网络失败、长任务、事件日志、活动 prefab、followId、anchor、帧号、截图，并检查 missing/unresolved 必须为零。肉眼截图只作为最后一层对齐检查，不能替代源绑定证据。

## 当前批次状态

- 迷迭香和锏已经有反编译动作绑定和源 prefab 证据。
- 锏的 24 个 prefab 已用修正后的 Unity shader/coverage 批次接入正式资源；正式 manifest 为 24 项，未移植 shader 为 0。
- 锏技能 2 的探针确认 `skill_02_hit_1` 以 followId 20/21 等敌方目标播放，施法起手效果 followId 为 1、anchor 为 root；`start_05` 现在由反编译语义驱动为 followId 1、anchor 为 tile，资源帧尺寸已从旧 atlas 更新到新批次。这样地图扇形不再被错误地挂到干员根节点。
- 对比页加入批次缓存键并把 atlas 预热改为两项一批，避免旧 atlas 与新 manifest 混用，也避免首次播放把全部纹理上传集中到一个长任务。
- 锏技能 2 命中层曾被原始采集图直接证明存在 premultiplied 违规：颜色半幅出现整块橙色，而 coverage 半幅仍是斩击形状。转换器现在在写 atlas 前按 coverage 约束颜色，正式资源已重烘 `blkkgt_skill_02_hit_1`；逐层 isolate 复验确认隐藏命中层会移除目标侧斩击，施法者侧扇形仍来自起手层。
- 浏览器取证 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-final-verify-20261008\browser-evidence.json` 的实际记录为 0 pageerror、0 console error、0 网络失败，但有 41 次 longtask，最大 2124ms；此前“longtask 为 0”的总结被该文件推翻。活动记录保留 `start_05` 的 tile anchor 和命中层的目标 followId。页面已有预热等待上限，但卡住/卡顿仍须在当前发布版独立复验。
- 扇形存活帧的专项截图和活动记录写入 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-capture-start05-20261008\skchr_blkkgt_2-start05-tile.png` 与 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-capture-start05-20261008\evidence.json`：`start_05` 的 `anchor` 为 `tile`、`direction` 为 `RIGHT`、帧号为 0，页面错误数为 0；截图可见扇形从施法格向目标方向展开。
- 36 名其它高本干员仍处于 `needs-source-extraction`。已有动画证据不等于已有 VFX prefab 证据；在拿到对应原始 bundle 前不生成猜测性的正式特效。

## 完成判据

单名干员只有同时满足以下条件才从待提取转为可验收：

- 所有技能和普通攻击的 action/effect 引用有反编译出处；
- 所有引用 prefab 的 shader、材质和纹理状态已取证；
- 每个效果的 owner、target、tile、bone 挂点和朝向有明确映射；
- atlas、Mesh、场地范围和多段命中均按源语义接入；
- 浏览器取证无 pageerror、console error、网络失败，coverage 无 missing/unresolved；
- 每个技能有按时间轴的密集截图和活动记录，位置与尺寸通过源 origin、格点和挂点校验。

当前批量任务继续沿这个门槛推进，先取六本，再取五本；没有源证据的干员只进入提取队列，不标记为已还原。
