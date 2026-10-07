# 干员战斗 VFX 转译与不漏项验收

这份记录把反编译产物里的战斗动作拆成 `动作 → 投射物 → 特效槽 → 挂点`，作为渲染器的输入契约。清单真源是 [data/vfx/character-vfx-coverage.json](../../data/vfx/character-vfx-coverage.json)，实现入口是 [fxRecipes.js](../../public/js/render/fxRecipes.js) 和 [originalVfx.js](../../public/js/render/originalVfx.js)。

反编译的 `[uc]skills` 对锏三技能给出 `Skill_3_Loop`、`_additionalTimes: 9`、`blkkgt_skill_03_hit_1`，以及结束动作 `Skill_3_End`、`blkkgt_skill_03_hit_2`。原始 `blkkgt` effects prefab 又给出：`start_02` 的 `_spawnLocation: 5`、`ground`/`range_line` 和四个本地 ±2 子节点；`hit_1` 是 `_spawnLocation: 2` 的持有者效果；`start_03/04` 分别是 `_spawnLocation: 8/11`、挂点类型 5/9 的持有者效果。因而 `start_02` 不能作为普通角色 billboard 播放；它现在进入 tile-bound procedural ground pass。`start_03/04` 的数字挂点到 Spine bone 的最终枚举映射仍标成 `unresolved`，不会被清单静默吞掉。

迷迭香投射物 prefab 分开列出 `effectsToTargetWhenStart`、`effectsWhenReached`、`effectsWhenHit`，并且这些记录的 source-face-vector 开关均为 0。渲染器因此把开始、到达、命中分别落到目标槽，不对目标特效使用施法者朝向镜像。

## 不漏项标准

每个反编译出来的 prefab 必须满足以下条件之一：

1. 在动作清单的一个事件槽里列出，并由 `translated` 绑定到 root、tile、target 或 bone；
2. 原始 shader/vertex stream 无法由 atlas 表达时，列为 `procedural`，同时给出原始 prefab 结构和代码入口；
3. 暂时不能解出的挂点或表现列为 `unresolved`，进入运行时覆盖诊断，不能默认为完成。

运行时 `OriginalVfxPlayer.coverage()` 会记录 requested / loaded / missing / procedural 四组集合。验收不能只看画面；必须检查动作事件计数、资源加载集合、挂点状态和 unresolved 数量。tile/range 特效必须用整数行列投影；packed atlas 的锚点和显示宽度按颜色半帧计算，不能按颜色+遮罩的打包宽度计算。
