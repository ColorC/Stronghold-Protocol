# 可重复的原作 VFX 源提取

这一工具链保留动作出处、原始材质和图像合成语义。录制完整与源引用完整仍不等于干员视觉还原完成；正式接入还须验证动作事件、owner/target/tile/bone 挂点、方向、范围和生命周期。

## 工具与目录

- `tools/assets/official-bundle-evidence.py`：按官方原生资源版本目录下载指定 bundle，保留原始包与 typetree；回执记录来源 URL 和实际绝对文件路径。不使用自算摘要判断版本。
- `tools/assets/character-vfx-evidence.py`：沿 GameObject 和组件的本地引用遍历角色、技能和投射物。保留每个 MonoBehaviour 的全部业务字段和嵌套字段路径；不再只取第一个同名字段，Buff 的 `overrideEffectKey` 也在清单内。缺少根、引用或素材均明确报告。
- `tools/assets/ark-vfx/`：Unity 批量录制器与源 Shader 的 HLSL 移植。除了既有移植，加入 Ram/Add、Ram/AlphaBlend（主纹理与 Ram 纹理相乘，以及源 sprite-sheet 变体）和 L2D Dissolve(CustomData)（UV 速度取 frac、CustomData 通道和源混合状态）。
- `tools/assets/record-vfx.ps1`：新建本批独立的最小 Unity 工程，不借用其它项目的运行工程。输入通过显式绝对路径读取，输出限定本批 frames 树；拒绝非空输出和未核验目录链接。按进程真实启动计算最长等待，到点停止自己启动的进程并写回执。
- `tools/assets/vfx-atlas-post.py`：把源帧转成 `[颜色 | 覆盖度]` atlas，可用 `--source-manifest` 接入多个批次的明确源路径。声明帧缺失或 Shader 未支持时，拒绝把它提升为有效 atlas。

业务代码在项目 `tools/assets`，测试在 `test/assets`。源包、Unity 工程、帧和临时 atlas 使用 canonical 项目 `.omni/tmp/<batch>`，不进入每个 worktree，不挂可写链接。正式资源在验收后提升到既有 `public/assets/vfx`。

## 图像合成

Unity 用半浮点渲染目标分别拍黑底和白底，得到颜色 P 和覆盖度 A。浏览器按 `P + (1-A) * background` 合成，使用 `ONE / ONE_MINUS_SRC_ALPHA`。

**不能要求所有像素 P <= A。** 加法发光允许 P>A，甚至 A=0、P>0。把 P 截断到 A，或者从亮度推造 A，会削弱原作的剑光、拖尾和光晕。

录制任务可设 `captureReference: true`：除 packed 源帧外，额外输出同一模拟状态下 Unity 直接渲染的地面底色画面，以逐像素验证浏览器合成公式。HLSL 移植的时间由录制器传入模拟时间，避免编辑器的墙钟时间改变 UV 滚动和重跑结果。

2026-10-08 用纯烬艾雅法拉出生/技能一起手与蕾缪安普攻拖尾的 360 帧对照：原始 P/A 合成最大误差为 1.22/255，旧截断算法最大误差为 197/255。证据为 canonical 项目 `.omni/tmp/vfx-composite-reference-20261008/composite-validation.json`。这只证明所测素材的图像合成，不证明五名干员的战斗绑定已经验收。

## 调用方式

以下路径是变量示意；调用时全部传实际绝对路径。`BatchRoot` 必须是本次新建的独立临时批次，不能选正式数据、用户上传或其它任务的工程。

```powershell
& <repo>/tools/assets/record-vfx.ps1 `
  -BundleList <canonical-bundle-list> `
  -JobsDirectory <canonical-batch>/jobs `
  -BatchRoot <canonical-batch> -TimeoutSeconds 600
```

每个 job 是 `ArkVfxRecorder.Job` JSON：包含 `prefab`、本批 `frames/<prefab>` 下的绝对 `outDir`、帧率、画幅与采样参数。录制器不覆写已有帧；重新录制使用新的批次并在源清单里明确替换该项，不用“目录存在”判断任务完成。

```text
python tools/assets/vfx-atlas-post.py <original-frames> <new-atlas-output> --source-manifest <absolute-source-manifest> --workers 2
python test/assets/character-vfx-evidence.test.py
python test/assets/vfx-atlas-post.test.py
```

源清单结构为 `{"sources":[{"prefab":"...","source":"绝对帧目录"}]}`。后处理不会将未支持 Shader 的 fallback 帧当作可发布内容。

## 继续接入的边界

角色包不能省略。五名样板仅看 `[uc]skills` 与投射物时能追到 27 个特效，加入各自 charpack 后才能追到 98 个：其中包含普通攻击、技能模式中的攻击、Buff、地图与召唤物相关字段。没有技能显式 cast 字段，不代表该技能没有表现；它可能通过模式切换或 Buff 驱动。

现有浏览器对比页仍只有迷迭香与锏。新 atlas、source-evidence-only 清单和 Shader 编译成功不得标成“干员已还原”；需要把这些来源编译为带事件、持续时间和挂点语义的运行时契约，并以源画面与真实浏览器验收。
