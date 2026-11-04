# 可重复的原作 VFX 源提取

这一工具链保留动作出处、原始材质和图像合成语义。录制完整与源引用完整仍不等于干员视觉还原完成；正式接入还须验证动作事件、owner/target/tile/bone 挂点、方向、范围和生命周期。

## 工具与目录

- `tools/assets/official-bundle-evidence.py`：按官方原生资源版本目录下载指定 bundle，保留原始包与 typetree；回执记录来源 URL 和实际绝对文件路径。不使用自算摘要判断版本。
- `tools/assets/character-vfx-evidence.py`：沿 GameObject 和组件的本地引用遍历角色、技能和投射物。保留每个 MonoBehaviour 的全部业务字段和嵌套字段路径；不再只取第一个同名字段，Buff 的 `overrideEffectKey` 也在清单内。Buff blackboard 的 `key: projectile` 与同级 `valueStr` 同样按精确 prefab 名追踪；音频信号使用相同前缀不构成投射物引用。缺少根、引用或素材均明确报告。
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

## 有界分页与播放器生命周期

后处理默认写 `format: 2` 图集：`pages` 连续声明每页文件、起始帧、帧数、列数和尺寸。每页最多 4,194,304 像素、单边最多 4096；一个完整的颜色/覆盖度帧不可缩放或拆开，超限则报错。帧率、逻辑尺寸与原点保持不变。输出必须是新目录或空目录。

已有无损图集可直接重新分页，不重复录制 Unity：

```text
python tools/assets/vfx-atlas-post.py <existing-atlas-root> <new-paged-output> --atlas-source --workers 1
```

有 `index.json` 时只转换已登记项，保留空白捕获项，不因旁边还有目录就扩大素材集合。空白捕获在播放器里记为 unresolved，不计作成功播放。

`OriginalVfxPlayer` 同时支持旧单图集和分页格式。每帧同时切换纹理、UV 和 texel；页面拥有自己的纹理资源，同 URL 的其它战场不受销毁影响。预载会分帧上传纹理并准备公共 Shader；`app.js → FxSystem → OriginalVfxPlayer` 必须一路传递 renderer，单独解码图片不能预热 GPU。

相同素材选择重播保留已预载页；更换干员或技能选择会取消旧请求并释放旧页，迟到的 manifest、图片和 mesh 请求不能回写新的资源代次。结束的 mesh 粒子也销毁其显示对象。对比页的加载和播放状态由独立选择代次保护，加载期间暂停和连续点击重播不会被旧请求改回播放。

分页回归覆盖颜色/覆盖度逐像素不变、页序列完整、原点为零、并发请求合并、迟到 manifest、销毁时取消、不同战场资源独立、重复选择释放和 mesh 结束清理。浏览器检查还覆盖复制链接、同页面及新页面定位、默认收起运行参数、文字可选中和全屏打开。

这层解决资产上传和场景资源状态；仍须区分冷启动的其它长任务、素材本身的内存规模与原作语义是否正确，不能用 warm replay 平顺替代首次播放或全部干员的验收。

## 继续接入的边界

角色包不能省略。五名样板仅看 `[uc]skills` 与投射物时能追到 27 个特效，加入各自 charpack 和 Buff blackboard 投射物引用后能追到 99 个：其中包含普通攻击、技能模式中的攻击、Buff、地图与召唤物相关字段。仇白技能一的额外投射物进一步引用爆发特效，省略 blackboard 会漏掉这一链路。没有技能显式 cast 字段，不代表该技能没有表现；它可能通过模式切换或 Buff 驱动。

现有浏览器对比页仍只有迷迭香与锏。新 atlas、source-evidence-only 清单和 Shader 编译成功不得标成“干员已还原”；需要把这些来源编译为带事件、持续时间和挂点语义的运行时契约，并以源画面与真实浏览器验收。
