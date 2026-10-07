# 干员战斗 VFX 转译与不漏项验收

这份记录把反编译产物里的战斗动作拆成 `动作 → 投射物 → 特效槽 → 挂点`，作为渲染器的输入契约。清单真源是 [data/vfx/character-vfx-coverage.json](../../data/vfx/character-vfx-coverage.json)，实现入口是 [fxRecipes.js](../../public/js/render/fxRecipes.js) 和 [originalVfx.js](../../public/js/render/originalVfx.js)。

反编译的 `[uc]skills` 对锏三技能给出 `Skill_3_Loop`、`_additionalTimes: 9`、`blkkgt_skill_03_hit_1`，以及结束动作 `Skill_3_End`、`blkkgt_skill_03_hit_2`。原始 `blkkgt` effects prefab 又给出：`start_02` 的 `_spawnLocation: 5`、`fixed`/`ground`/`range_line`、五个本地粒子子节点，以及 `range_line` 的 Unity Mesh 渲染模式；技能表的 `x-1` 范围是 13 个格点 `[2,0]、[1,-1..1]、[0,-2..2]、[-1,-1..1]、[-2,0]`。因而 `start_02` 不能作为普通角色 billboard 播放；它现在按干员朝向旋转到实际 13 格范围，并进入 tile-bound procedural ground pass。`end` 的 Mesh 子节点已由 `tools/assets/extract-mesh-vfx.py` 导出为顶点、索引、UV、层级变换、粒子尺寸/寿命和材质纹理数据，运行时按 tile 坐标重建 `dg_1`/`dg_2`/`dg_3` 的三组斩击和 `smoke_line`，不再把 Mesh atlas 当角色 billboard。`hit_1` 是 `_spawnLocation: 2` 的目标效果，每次斩击对范围内每个实际受击目标各播一次；结束命中同样按目标逐个播 `hit_2`。`start_03/04` 分别是 `_spawnLocation: 8/11`、挂点类型 5/9 的持有者效果。因而数字挂点到 Spine bone 的最终枚举映射仍标成 `unresolved`，不会被清单静默吞掉。

Mesh 转译现在可以重复运行：导出器遍历 prefab 的所有 Mesh 粒子节点，保留每个节点的层级矩阵、Mesh 顶点/索引/UV、全部材质纹理槽和 CustomData 曲线；`DissolveTex` 等辅助纹理不会再被丢弃。对已知的烟雾材质，导出阶段从原始 MainTex 与 DissolveTex 生成带 alpha 的预览纹理，避免浏览器把不透明遮罩当成整块白片。运行时按导出数据建立 Pixi Mesh，并在覆盖率中记录 `requested/loaded/missing`，因此新 prefab 可以沿同一命令接入，不能解析的字段会留在覆盖率而不是静默退化。

迷迭香投射物 prefab 分开列出 `effectsToTargetWhenStart`、`effectsWhenReached`、`effectsWhenHit`，并且这些记录的 source-face-vector 开关均为 0。渲染器因此把开始、到达、命中分别落到目标槽，不对目标特效使用施法者朝向镜像。

## 不漏项标准

每个反编译出来的 prefab 必须满足以下条件之一：

1. 在动作清单的一个事件槽里列出，并由 `translated` 绑定到 root、tile、target 或 bone；
2. 原始 shader/vertex stream 无法由 atlas 表达时，列为 `procedural`，同时给出原始 prefab 结构和代码入口；
3. 暂时不能解出的挂点或表现列为 `unresolved`，进入运行时覆盖诊断，不能默认为完成。

运行时 `OriginalVfxPlayer.coverage()` 会记录 requested / loaded / missing / procedural / unresolved 五组集合。验收不能只看画面；必须检查动作事件计数、资源加载集合、挂点状态和 unresolved 数量。tile/range 特效必须用整数行列投影；packed atlas 的锚点和显示宽度按颜色半帧计算，不能按颜色+遮罩的打包宽度计算。
