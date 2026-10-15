---
handoff_id: "ho-20261011T113058Z"
kind: "handoff"
title: "卫戍协议工坊讲解视频：配音、台本与游戏音频交接"
status: "draft"
reason: "用户明确将音频和台本工作转交其他 agent；当前会话继续完成连续画面、鼠标与字幕布局"
created_at: "2026-10-11T11:30:58.548314+00:00"
from_provider: "codex"
from_trace_id: "codex_01a114b9-e86d-78a3-81c9-ff8fd2290e0a"
from_session_id: "01a114b9-e86d-78a3-81c9-ff8fd2290e0a"
cwd: "E:\\WindowsWorkspace"
plan: ""
project: "stronghold-protocol"
workstream: ""
task: ""
---

# 卫戍协议工坊讲解视频：配音、台本与游戏音频交接

> 交接文档 · `omni handoff draft` 起草骨架, 正文由本会话补齐, 再 `omni handoff seal ho-20261011T113058Z` 过校验。
> 接手方入口: `omni handoff show ho-20261011T113058Z`(或在继任会话里 `omni handoff current`)。

## 机器事实(自动采集, 别手改)

- 交接方会话: `codex` · trace `codex_01a114b9-e86d-78a3-81c9-ff8fd2290e0a` · session `01a114b9-e86d-78a3-81c9-ff8fd2290e0a` · pty `e5d66fd4a8cd41a2`
- 工作目录: `E:\WindowsWorkspace`
- 绑定: plan `-` · project `stronghold-protocol` · workstream `-` · task `-`
- 原始对话真源(要深读读这个, 不以摘要代替): `C:\Users\lilithgames\.codex\sessions\2026\10\07\rollout-2026-10-07T12-58-10-01a114b9-e86d-78a3-81c9-ff8fd2290e0a.jsonl` (528.1 MB)

## 一句话状态

用户已把配音、台本、讲解与画面的对应和游戏声音重建转交另一位 agent；本会话继续重建连续画面、平滑鼠标和小字幕布局。上一版已被用户否定剪辑与观感，不能作为最终交付。新的连续画面尚未完成。

素材可用性更新（2026-10-11 13:09 UTC）：原 C3 录制在 12:32 UTC 的浏览器探针中仍可读取；12:54 UTC 复查时，本机和公开录制 API 均返回 404。下文引用的三个旧运行批次当前均不在原路径：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008、E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/replay-seek-timeout-20261011、E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/teio-continuous-20261011。原录像、旧成片、整批音频及相关回执的路径是历史来源，不能按当前存在处理；已在另一会话的原生命令与日志中确认：这些目录于 12:40–12:43 UTC 被直接删除，并非迁移。删除涉及原用户录像、成片和音频，而不只是可重建的渲染缓存。删除证据：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/deletion-cause.observed.json。接手方先确认真实素材落点，再运行下文的生成与验收命令。

当前仍存在的材料包括本文、E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011 的审计/短样片/鼠标事件，以及 .omni/tmp 下的脚本与 VITS 模型。原生有界库存 E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/backup-inventory.json 未找到完整 C3 备份；部分事件和短样片不足以替代整局。限定浏览器缓存的两轮检查也没有找到原事件、评论或完整视频。ROOT 正在核查远端与恢复路径，不要为绕开 404 重启现有游戏服务，也不要重录别局冒充原用户局。

已从本会话此前读取的内存对象保全旧剪辑清单：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/cached-edit-plan.json，正文在 value 下，含 46 段旧台词与旧字幕 cues、23 条评论的时间/ID 映射。E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/cached-source-to-output-map.json 是旧成片映射，同样在 value 下。它们是旧数据的保全副本，尚未按用户新要求改写，不代表最终台本；没有包含原评论正文、音频二进制或完整原录制。保全回执：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/cached-input-preservation.receipt.json。

评论正文恢复更新：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/comment-evidence/recovered-original-comment-text.json 现已保全全部 23 条原评论的 ID、原文、原时间及选择器/聚焦框。原文与会话中直接读取评论的完整工具输出逐条相符，也与另两次完整清单中的 originalText/originalTimeSecond 相符，覆盖旧剪辑清单的所有评论 ID。文件附原日志绝对路径、行号、tool call ID 与时间，未执行历史命令、未改写评论。作者和创建时间等原数据库字段尚未恢复，所以这是原文输入保全，不是完整 comments.json 的替代，也未恢复画面或音频。

## 用户约束与口径

1. 观众了解明日方舟和原版卫戍协议。讲解重点是工坊带来的改动，不用大篇幅教原版机制。
2. 用户接受目前东海帝皇参考声线；请改善语速和连贯性，并重新比较直接 VITS 的可用性。角色声线方向保留，技术路线由接手者验证。
3. 台词要像普通人在玩游戏时说话，避免书面腔、生造词、套式转折、刻意拆碎句子和 AI 总结腔。最终交付台本和字幕文字去掉标点；完整意义句与自然讲话的停顿仍需单独设计，避免去标点后把短碎片各自生成、造成讲话断裂。
4. 全稿逐句检查语言和内容，尤其检查台词说到的东西当时是否真的在画面里。用户评论时机可能不准，可以重排解说时机，原评论记录原文/作者/时间保持可追溯。
5. 用户明确反例：单位 027 的“同一个干员攒到三个，就能进阶，效果跟着翻上去”。三同名进阶属于原版已有机制，不应作为工坊改动重点；“翻上去”不是自然中文，必须删除。全稿按同一标准检查，不能只修这一句。
6. 尽量减少尴尬的无声空缺，不要把长段空白简单填满无关旁白。游戏需要适量操作、部署、技能、攻击等声音和合理底声；查证资源与时机后重建，保证讲解能听清。
7. 画面必须沿原一局完整顺序连续播放，游戏速率 1x。不得为配音删运营/等待段、突然插截图、切进别的补拍局；只在当时确有内容的原画面上平滑放大，短暂停顿最多 1.2 秒。
8. 字幕要小，游戏占主要画面；沿用游戏字体，无整条大黑栏挤占游玩区。鼠标是清晰黑白箭头，平滑移动并精确对齐实际点击。
9. 保留所有旧录像/评论/成片/候选和失败回执。新产物写独立批次，源码改动走独立稀疏 worktree，不复制正式数据或挂可写链接。文件引用用完整绝对路径，版本依据用原生 Git commit / 录制 ID / canvas revision。

## 已完成且有实证

### 声音来源与选择依据

现配音路线是 VITS 角色参考声 → Qwen 中文 voice clone，不是 Qwen 内置 speaker 2。VITS 为 zomehwh/vits-uma-genshin-honkai，Git 51eab19013363ef62bc688f56247052fa766cecd，speaker 2 标为东海帝皇。Qwen Base 为 fd4b254389122332181a7c3db7f27e918eec64e3，x_vector_only_mode=true、ref_text=null，没有使用用户的声音。

直接 VITS 曾有三候选和整稿输出。无 expected-text prompt 的 Whisper-small 对照出现普通词偏差，例如候选 03 的“小装备，数值调整了一下”被识别为“小宫妹，输给乔治瑞侠”，全 46 句直出 review 的平均无声调音节误差约 0.2074。此前因此选择 Qwen 内容稳定性较好的参考链。ASR 会误识别，所有 listened/auditioned 都是 false；这不是人耳证明，也不能据此永久否定 VITS。原样本、配置、两条路线输出和识别原文都保留供接手者比较。

完整可机读清单：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/audio-handoff-inventory.json。简短来源说明：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/audio-handoff-input.md。原生 VITS checkpoint：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/teio-continuous-20261011/voice/model/G_953000.pth。Qwen 模型：E:/WindowsWorkspace/tts-lab/models/Qwen3-TTS-12Hz-1.7B-Base。

现选择清单有 46 个口播单位，是 43 个原批次输出加 3 个真实修订，不要误称一次合成 46 段。权威路径：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/teio-continuous-20261011/voice/selected-qwen-audio-manifest.json。原始评论输入：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/replay-seek-timeout-20261011/review-comments-input.json，23 条。旧字幕 181 cues：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/teio-continuous-20261011/edit/compatible-film/narration.srt。

实测总口播 1486 个汉字、364.46 秒，约 4.077 字/秒。原成片口播间隔合计 342.347 秒，最大 50.513 秒。1.25 倍 atempo 短样片把完整 001–003 的 29.04 秒变为 23.243 秒；这只是参数与时长试验，未做主观试听或全量处理。样片：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/tokai-teio-sample-1.25x.wav。收据：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/voice-speed-audit.receipt.json。

按原 sourceAnchorSecond 重新测窗，即使 1.25 倍仍有 10 处碰撞。开头 001+002 要约 17.1 秒而原菜单窗口仅约 6 秒，不能用插截图解决。证据：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/source-anchor-pressure.json。旧 042–045/053/047 依赖其他补拍局，回归原整局后须重选真实对应时机或删除无画面依据的讲解。

### 原录制、视频各层及统一时间轴

原用户局 ID：c3c3f89e-eae2-46ac-a118-a6deda3aa3b6；会话：8e9c96d2-576e-4f8d-8e9b-f7668e093d09。原局评论版：https://workshop.colorc.cc/stronghold/independent-review.html?recording=c3c3f89e-eae2-46ac-a118-a6deda3aa3b6。

| 组成 | 真源与职责 |
| --- | --- |
| 录制元信息/媒体时钟 | E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/meta.json |
| DOM 变化/操作/光标事件 | E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/events.jsonl；包含 rrweb 与独立操作事件，不等于最终视频帧 |
| 原生连续 canvas 像素 | E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/canvas-playback.webm；1280×630 VP8，video-local 时长约 1194.147 秒，单媒体段 |
| 原始媒体封装 | E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/canvas.webm；不要把它的元数据时间基直接当播放时间，不覆盖它 |
| 原局评论数据库 | E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/comments.json |
| 连续合成视觉层 | 原 rrweb DOM + 对应 native canvas + 同时钟的单个光标；本棒正在 source-audit/continuous-prototype 验证，尚未把样片冒充完整成片 |
| 聚焦层 | 同一时刻原画面平滑缩放；允许很短原帧停顿，不插独立静图/不同录制 |
| 解说层 | 接手者重审台本、重选时机、生成或复用音频；旧 narration-master 是纯旧布局输入，不能整轨照搬 |
| 游戏音频层 | 接手者检查原媒体实际 stream 与记录事件，使用真实资源按可验证的动作时机重建独立 stem |
| 字幕层 | 新台本对应的时间段/纯文字由接手者提供；本棒负责小字 overlay 渲染和去显示标点，不增大黑边/缩小游戏 |
| 编码/分发/批注 | 新 MP4 + SRT/ASS + source-to-output map + manifest；公开播放与批注 API、既有画布卡片，发布另做最终验收 |

统一基准是录制 wall time。startedAt=2026-10-10T10:27:41.608Z，endedAt=10:47:38.691Z，共 1197.083 秒。native canvas 开始于 10:27:44.205Z，比 wall 起点晚 2.597 秒。canvasVideoSecond=sourceWallSecond−2.597；首 2.597 秒按原 DOM 的起始菜单呈现，不拿未来 canvas 帧铺底；native EOF 后仅保留最后实际解码帧直到原 DOM 录制结束，精确保持时长须由实际 PTS 与 wall 结束点计算。原 full snapshot 初段确有 ix-start 菜单，没有 gm__field。

rrweb 首时间点比 wall 起点晚约 131ms；旧 renderer 将负 offset 截成 0，导致事件相位提前。新方案必须保留 signed offset。光标按自身真实 wall 时间独立插值，首次 causal 点之前隐藏，click/scroll 断点不能跨越。30fps 编码不代表鼠标每秒有 30 个新位置。证据入口：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/cursor-layout-audit/original-pointer-events.json；E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/cursor-layout-audit/cursor-window-events-and-dom.json。

旧 24 剪辑窗只覆盖约 649.783 秒，间隙总计约 547.3 秒；new1db 仍是 57 个 motion 段、6 个静帧 cut-in 和多个 MP4 来源。此前“片段内帧率连续”的检查漏掉了全局跳切，这是已确认的错误验收口径。新画面必须覆盖整个原 wall axis，再加少量批准的同帧 focus holds。源1280×630放大到2560×1260不会恢复原生细节，DOM文字可以重新高清绘制，canvas须如实说明源像素能力。

### 网页游戏本体与现有发布

当前无 session 游玩入口：https://workshop.colorc.cc/stronghold/independent.html。当前源码公开分支：https://github.com/ColorC/Stronghold-Protocol/tree/workshop。已运行源码 Git：6b94345b4c1dec27a6de8032b9b1aeca90b43fd8。

canonical 项目目录：E:/WindowsWorkspace/webworks/apps/stronghold-protocol；当前实际运行 checkout：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/workshop/stronghold-protocol。正式服务清单：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/service.json；启动入口：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/release-server.mjs，端口 13000。服务清单记录 dataRoot 为运行 checkout 的 data；音频资源审计是在 canonical 的 data/assault-sources/assets/audio 完成，接手时要核实际服务的资产可达路径，不能假设两处相同，也不要为省事建可写链接。

网页关键模块均在当前运行 checkout：public/independent.html 是入口；public/js/independent/recorder.js 负责记录；public/js/independent/replay.js 负责 rrweb 与媒体回放；public/js/independent/recordingMediaClock.js、recordingCanvas.js 负责媒体时钟/画布采集；server/modes/independent/recordings.js 负责记录、评论与媒体 API；tools/render-independent-recording.mjs 是已有离线渲染器，有前述 offset 坑，不能原样跑整片；public/js/audio.js 为游戏音频播放管理。正式游戏改动与离线配音/合成分开。

当前受用户否定的旧兼容片：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/teio-continuous-20261011/edit/compatible-film/showcase.mp4；公开 ID 1db70610-d466-4456-91d3-96c88c274734，https://workshop.colorc.cc/stronghold/independent-video.html?recording=1db70610-d466-4456-91d3-96c88c274734。其 public-final 是传输/解码检查通过，不代表新一轮内容、剪辑或听感验收通过。不要覆盖这份历史片。

画布：https://workshop.colorc.cc/bside/canvas?project=arknights&canvas=canvas-0470c0a1#card=replay-ec05c047-45c7-4e0f-ae7d-2416dfe045b4。既有 stable card ID replay-ec05c047-45c7-4e0f-ae7d-2416dfe045b4，上轮 revision 292 指向旧兼容片。最终更新需 fresh GET revision、仅改目标卡、保留其余卡与关系，不新增同一影片重复卡。

## 未完成与下一步

1. 接手方先采用 ho-20261011T113058Z，读取本文和音频清单，运行下一节的只读复验命令。不要把根的连续画面工作接走；先与原会话约定同一 sourceWallMs 接口。
2. 逐句审稿，把“工坊改动”和原版已有机制分清，核对 unit027 以及所有类似措辞；把过碎短句合成自然话语，保留用户原评论原文作为输入，不把原评论时点强当口播开始时点。
3. 对整局的真实画面/操作建立 cue 对照表：sourceWallStart/End、话题、画面对象、是否可见、可用focus矩形、旁白文字、音频文件。核心内容只有在确实对应的画面出现时讲，赶不上窗口就精简或挪到后续对应时机。
4. 比较直接 VITS 与现声线的自然度/可懂度，在可验证证据上决定；用户已接受现声线方向，可先利用已存样本。提高语速但避免过碎分段，按完整意义句生成；语音停顿、文本段落和字幕切分分别处理。
5. 检查原媒体有没有声音轨。查游戏 audio manager 和资源索引，从已记录动作/战斗事件、可重现日志建立 sound-cues。仅按可证明的动作重建 SFX/部署/技能/操作/适量底声；不得以旧 seed/config 的另一次战斗冒称原声音。
6. 输出版至少保留 narration stem、gameaudio stem、mix、纯文字无显示标点的 SRT/结构化 cues；各项用同一 wall/source map，与原点击/聚焦时机匹配。
7. 先交短片验证速度、语言、字幕对应、游戏声与旁白比例，再做全片。所有任务原生 bounded 执行，有真实 PID/start/deadline/数字退出码，模型不短轮询。
8. 根负责交连续 picture base、cursor/layout/focus 接口与实际样片验收。新台本与声音未验收前，不能把无声视觉底片当完整讲解成片发布。最终合成后需完整解码、实际默认浏览器播放/seek/评论映射和画布检查。

## 坑与已知失败

- 旧时间线与旧 source-to-output.map 带删窗和补拍，不能复用旧输出秒数；原 comment source wall 时间保留，新输出时间另按完整连续 map 重算。
- 旧字幕是字号96+较大黑栏，占据1600输出中的额外区域；新目标为原游戏纵横比铺满，小字约40–48px/2560宽，保留字体、局部描边/细底，最多两行，去显示标点。最终尺寸以连续样片真实浏览器验收为准。
- 旧 renderer 的 offset Math.max(0,...) 与 last-point hold 引起鼠标相位及卡顿。后补局并不具备整局连贯性，也不能替换原 user trajectory。
- 原生 canvas PTS 有效24fps左右变帧率信息；59.94是标称值，不能据此声称60个真实动作帧。约29111包、最后PTS1194.131s，大多数相邻<100ms。输出CFR只补输出节拍，不能伪造源动作。
- 大黑底字幕带、原始静页半透明永久覆盖、为圈选额外画矩形、重复mouse overlay都已被用户否定。原用户圈选可以随DOM事件出现/消失，不另做强调框。
- 先前 NVENC p5/VBR/AQ 版本会在默认 D3D11 解码报错。已实际通过的兼容参数为 Main L5、p4、bf0、refs1、GOP60、CBR约28Mbps；软件解码对照通过不能替代默认浏览器验收。不要单凭样本把故障归咎某一个编码参数。
- Windows python 别名指向不可执行的 WindowsApps。已用健康绝对解释器，不改全局PATH或安装环境：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/replay-seek-timeout-20261011/final-video/qwen-venv/Scripts/python.exe。
- 本会话不支持人耳听音，不得声称“亲耳听过”“百分百还原角色”；ASR、字/秒、峰值只证明相应机械指标。

## 复验命令

```powershell
omni handoff adopt ho-20261011T113058Z
omni handoff show ho-20261011T113058Z
git -C "E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/workshop/stronghold-protocol" rev-parse --show-toplevel HEAD
Get-Content -LiteralPath "E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/audio-handoff-inventory.json" -Raw | ConvertFrom-Json | Select-Object status,scope
Get-Item -LiteralPath "E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/canvas-playback.webm" -ErrorAction Stop
# 仅在真实原文件已恢复后运行下一行；该 ffprobe 为当前可运行工具，旧批次中的 8.0 工具已随目录删除。
& "C:/Users/lilithgames/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffprobe.exe" -v error -show_streams -show_format -of json "E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/canvas-playback.webm"
```

这些命令只读确认记录、版本和媒体当前状态，不重跑合成/编码。不要扫描528MB完整对话来代替先读交接。

## 必读入口

- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/deletion-cause.observed.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/comment-evidence/recovered-original-comment-text.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/cached-edit-plan.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/source-recovery/cached-source-to-output-map.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/audio-handoff-inventory.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/continuous-correction-20261011/voice-audit/source-anchor-pressure.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/service.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/workshop/stronghold-protocol/public/js/audio.js`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/workshop/stronghold-protocol/public/js/independent/replay.js`

## 待恢复的原始输入

以下路径仍是原来源，当前缺失。交接文档可读性的校验不代表这些素材恢复，也不代表可以完成整局重建。

- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/teio-continuous-20261011/voice/selected-qwen-audio-manifest.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/replay-seek-timeout-20261011/review-comments-input.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/meta.json`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/events.jsonl`
- `E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/recording/recordings/c3c3f89e-eae2-46ac-a118-a6deda3aa3b6/canvas-playback.webm`

交接范围：本文件只转交音频、台本与声画语义对应；连续画面、鼠标插值、字幕视觉样式仍由原会话完成。

## 接手结果（10-12，Claude 会话 dd306274）

- 原录像 c3c3f89e 已被清盘会话删除；画面改为同局复刻：录制当天版本 3aa847d0 + 对局编号 931068944 + 原 764 次点击/指针轨迹，16 场战斗回放与最终存档和原局逐字节一致（回执 E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/audio-script-20261011/reenact/reenact-receipt.json，最终用 full-6）。
- 讲解停顿只放在开局菜单与备战期（21 处、112 s），画面不冻结；战斗中不停。
- 台本 v2.1：用户 23 条评论原话保留，补充 15 句只讲当时画面上的机制；逐句抽帧核对 41 句，修正 4 处（E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/audio-script-20261011/script-v2.json）。
- 成片：E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/audio-script-20261011/film-v2/stronghold-bg-explainer-20261012.mp4（2560×1260，30 fps，1310.2 s，完整解码无错）；Workshop 下载 https://workshop.colorc.cc/bside/downloads/dl_mv44oasr_cd33d567?project=arknights 。
- 在线审阅：https://workshop.colorc.cc/stronghold/independent-review.html?recording=327d5b1a-d11e-42b6-b33b-9b717abf4ba2（录像 327d5b1a，13000 原生审阅页，用户 23 条原评论已按新时间导入；发布脚本 .omni/tmp/audio-script-20261011/publish-review.py，回执 runtime/audio-script-20261011/review-publication/publication.receipt.json）。别用 /bside/hosted 托管大视频：/bside 经 8210 uvicorn 代理，整段缓冲后才回，1.3 GB 视频在用户浏览器 60 秒仍 0 字节。
- 已存 B 站草稿：账号 吟游机_official，草稿号 3976162，标题【假如卫戍协议就是酒馆战棋】，读回 10 项一致，未投稿（E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/audio-script-20261011/bili-release-v1/draft-readback.json）。公开发布由业主操作；配音为东海帝皇声线 AI 克隆，是否公开、是否点名声线由业主定。

### 10-12 晚：下载渠道与 B 站简介

- 业主把草稿标题改成「我许愿卫戍协议就是酒馆战棋」并清空了简介；简介按业主要求只写两行：GitHub https://github.com/ColorC/Stronghold-Protocol 和百度网盘 https://pan.baidu.com/s/1W-k5F97NsAg-dFpBDL1jjw?pwd=a0d6（提取码 a0d6，分享整个「卫戍协议工坊」目录，永久）。草稿 3976162 读回一致，只存草稿。回执 runtime/audio-script-20261011/bili-release-v2/draft-readback.json。
- 业主要求任何时候不给 .bat：工坊发布改为 exe 启动器 + exe 安装程序（NSIS）+ msi（WiX 5），都能卸载，存档放 %LOCALAPPDATA%\Stronghold-Protocol-Workshop。提交 b576f306 + 文档 78796d0b，已快进推到 origin/workshop，本地 workshop 同步；发布页 workshop-v0.3.0-workshop.1 的三个文件与 SHA256SUMS.txt 已替换/补上，GitHub digest 与本地一致。产物与验证在 runtime/windows-installer-20261012/。
- 业主：GitHub 的 master 不该还是原版（搜到的人会觉得不对劲）。origin/master 已从原版 bdb0765c 快进到工坊 2242bfaa，仓库简介改为写明工坊模式；本地 master 仍是共鸣（13001）开发线、跟踪 origin/master 但从未推送，两边已分叉，别从本地 master 推送。各模式以后各用自己的分支构建，master 跟最新发布的那条线。
- 10-12 19:06 已投稿：https://www.bilibili.com/video/BV1jJp96zExH（审核中）。业主删掉了草稿 3976162 要求重新投稿；创作声明按业主决定「内容无需标注」，自制+禁止转载，简介按 omnicompany bilibili_publish/RELEASE_STANDARD.md 样板（先署名原作 Ausevay）。发布包与回执 runtime/audio-script-20261011/bili-release-v3/（submit-receipt.json 读回全部一致）。
- 小红书短版（视频上限 15 分钟，业主手动投稿）：runtime/audio-script-20261011/xhs-cut-v1/stronghold-workshop-xhs-cut.mp4，6 分 16 秒，12 段按原顺序 1 倍速、只在台词之间切（切点 segments.json，脚本 .omni/tmp/audio-script-20261011/make-xhs-cut.py），1920×946，142 MB；已放业主百度网盘 /投稿视频/我许愿卫戍协议就是酒馆战棋-小红书短版.mp4，另有 7 天分享（netdisk-share.json）。
- 10-12 玩家视角整局测试（从 GitHub 下载 exe 安装→首次下载 579 MB→徽章成长打到第 10 轮失守→关闭→卸载）：329 条断言 323 过，失败 6 条均为测试脚本或口径问题；玩家生成的资源清单与正式清单逐项一致。证据 .omni/tmp/player-e2e-20261012/evidence/。测出真缺陷：最后一轮漏怪超过剩余防线时「损失生命」多记（31/28），已修 08000d6a 并推到 workshop 与 master；13000 重启后生效；发布包仍是 6b94345b，未重打。测试脚本误关了本机系统 Chrome 一个窗口（多为授权页，可 Ctrl+Shift+T 恢复）。
