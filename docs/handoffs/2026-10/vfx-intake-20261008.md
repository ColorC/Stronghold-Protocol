---
handoff_id: "in-20261008T075045Z-stronghold-vfx"
kind: "intake"
title: "接续 Stronghold 干员 VFX 全流程还原"
status: "draft"
reason: "原会话 1b19612b54114e0e 连续 model capacity 失败；保留业务产物接续"
created_at: "2026-10-08T07:50:45.556478+00:00"
from_provider: "codex"
from_trace_id: "codex_01a114f0-28c6-7d21-93a9-0c314a4d1f42"
from_session_id: "01a114f0-28c6-7d21-93a9-0c314a4d1f42"
cwd: "E:\\WindowsWorkspace"
plan: ""
project: "stronghold-protocol"
workstream: ""
task: ""
---

# 接续 Stronghold 干员 VFX 全流程还原

> 接手理解文档 · `omni handoff draft` 起草骨架, 正文由本会话补齐, 再 `omni handoff seal in-20261008T075045Z-stronghold-vfx` 过校验。
> 接手方入口: `omni handoff show in-20261008T075045Z-stronghold-vfx`(或在继任会话里 `omni handoff current`)。

## 机器事实(自动采集, 别手改)

- 交接方会话: `codex` · trace `codex_01a114f0-28c6-7d21-93a9-0c314a4d1f42` · session `01a114f0-28c6-7d21-93a9-0c314a4d1f42` · pty `07e36cd41d5247c1`
- 工作目录: `E:\WindowsWorkspace`
- 绑定: plan `-` · project `stronghold-protocol` · workstream `-` · task `-`
- 原始对话真源(要深读读这个, 不以摘要代替): `C:\Users\lilithgames\.codex\sessions\2026\10\07\rollout-2026-10-07T13-57-25-01a114f0-28c6-7d21-93a9-0c314a4d1f42.jsonl` (3.5 MB)

## 一句话理解

接续旧 PTY 1b19612b54114e0e（原生 Codex 会话 01a110e9-1da4-7af0-ad22-5846aae03078）的 Stronghold 干员 VFX 全流程还原；当前只有迷迭香、锏已接入，批量提取和视觉验收均未完成。原会话连续 model capacity 失败，业务数据保留。

用户原始要求先检查原作素材与上游缺口，随后明确补全已有和援助干员的 VFX。2B 与语音不属于这条职责线。最终要求是无需用户逐个指出错误，也能按反编译源语义自动还原攻击、受击、技能起止、地图表现和骨骼挂点；优先五本/六本，38 名高本只是第一批，不是全部任务。

## 我读了什么

- 原会话原始记录：`C:\Users\lilithgames\.codex-2\sessions\2026\10\06\rollout-2026-10-06T19-11-15-01a110e9-1da4-7af0-ad22-5846aae03078.jsonl`。窄读用户请求、最终答复、最后批次命令和错误；未复制整份记录。
- 项目登记：`E:\WindowsWorkspace\omnicompany\docs\projects\stronghold-protocol\PROJECT_INDEX.md`。
- 流程：`E:\WindowsWorkspace\webworks\apps\stronghold-protocol\docs\research\13-high-tier-vfx-batch.md` 和 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\docs\research\12-character-vfx-translation.md`。
- 队列与源映射：`E:\WindowsWorkspace\webworks\apps\stronghold-protocol\data\vfx\high-tier-vfx-queue.json` 和 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\data\vfx\character-vfx-coverage.json`。
- 录制批次、浏览器记录和服务回执，见下面的核验事实。

## 我核实与推翻了什么

- 主仓 HEAD 为 Git commit `48e1dfc9`，主仓存在其它职责线的未提交改动，未覆盖。服务回执所指发布源码为 `dfcc02724e3764b88afffccea15ce54436b71bd7`，根目录是 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.worktrees\final-publication-20261008`；不得直接切服务回旧 release。
- 高本队列 38 名（六本 19、五本 19），仅迷迭香和锏是 source-mapped；source-mapped 不能视为视觉验收完成。
- 新批次五名：仇白、纯烬艾雅法拉、荒芜拉普兰德、蕾缪安、流明。清单 131 prefab，接手时只有 130 份元数据与帧集完整；`whitw2_skill_03_mark_02` 只有 47 帧、无 meta.json。原始残帧保留于 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\high-tier-source-20261008\frames\whitw2_skill_03_mark_02`。
- 修正 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\high-tier-source-20261008\make_resume_jobs.py`：按元数据、prefab 身份、声明帧数和逐帧文件完成性判断，不再把目录存在当完成。实际运行得到 complete=130、missing=1；续跑清单为 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\high-tier-source-20261008\resume_effects_index.json`。
- 已录制项中 11 个特效有未支持 shader，包含 Dissolve(CustomData)、Ram/Add、Ram/AlphaBlend。不能把它们发布为已还原。
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-final-verify-20261008\browser-evidence.json` 实际是 0 页面错误、0 console error、0 网络失败，但有 41 次 longtask，最长 2124ms，取样帧率约 18–23FPS。旧报告的“0 longtask/卡顿已解决”未被该证据支持。
- 旧等待 PID 70940 现在属于 `igame-mold-render-mini`，不是本批录制。resume Unity 日志已有正常退出尾部；不继续等错误 PID，也不重跑完成的 130 项。
- 原会话 2026-10-08 11:09、11:29、14:55、15:12、15:28、15:40 的 task_complete 记录均有 server_overloaded/model capacity 错误。记录可证明恢复失败；不将其当业务实现无法完成的依据。
- 本轮核验回执：`E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-resume-20261008\intake-audit.json`。缺失项已在 Stronghold 自有独立 Unity 临时工程补录成功，真实启动 2026-10-08 15:53:00、结束 15:53:36（Asia/Singapore），exitCode=0、未超时，120 帧、元数据和帧编号全部验证通过，该项 unportedShaders 为空。终态回执为 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-resume-20261008\repair-receipt.json`，其中 generatedFiles 列出本次输出完整绝对文件路径；Unity 日志为 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-resume-20261008\repair.unity.log`，summary 为 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-resume-20261008\repair.summary.txt`。
- 旧残帧保持，新完整源为 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-resume-20261008\frames\whitw2_skill_03_mark_02\meta.json`。131 项完整源的绝对路径映射为 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-resume-20261008\verified-frame-sources.json`；全量元数据、声明帧数及逐帧编号已复验。11 项 shader 未解决状态保留。
- 当前会话已承接原明确要求建立的完整 goal，状态 active，无自行设置 token 上限；未将 131 项录制完整视为 VFX 还原完成。

## 未知与风险

- 锏 S1/S2 的纹理、尺寸、方向和地图/目标表现仍需与原作源画面密集对比，测试通过不等于视觉等价。
- 页面冷启动和运行期卡顿尚需在当前实际发布版复验，先区分错误、Promise、纹理生命周期与主线程长任务。
- 新五名的动作绑定与地图/bone/target 挂点未在浏览器接入；其它 31 名高本尚未开始这一轮录制。
- 官方资源中的未支持材质需按 shader 原始源码移植，不能用程序化方块或猜测性默认特效掩盖。
- 源码正式改动按主仓 `.worktrees` 的稀疏工作副本推进，不复制运行数据；不更改其它会话的功能或占用其 Unity 工程。

## 我的下一步

1. 补齐三类未支持 shader，重录受影响 11 个 prefab，按原始引用建立五名干员的完整动作/素材/挂点/时序映射。接续使用 verified-frame-sources.json；不重录已完成的 131 项。
2. 将完整源帧通过 `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\tools\assets\vfx-atlas-post.py` 后处理成独立临时结果；完成源验证后再提升为正式 assets。
3. 先复验锏 S1/S2 和迷迭香卡顿，再把五名新干员接入相同对比页、正式战斗事件和覆盖诊断；用密集截图、原作对照、事件日志与相关回归共同验收。
4. 扩展剩余五本/六本，再覆盖低本与援助干员。最终形成可重复的还原管线和上游可审查改动；对外 Git push 按独立授权要求处理。

当前远程体验入口：https://workshop.colorc.cc/stronghold/dev/vfx-compare.html 。该页目前只提供迷迭香与锏，不能代表全干员已经完成。

## 必读入口

- `E:\WindowsWorkspace\omnicompany\docs\projects\stronghold-protocol\PROJECT_INDEX.md`
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\docs\research\13-high-tier-vfx-batch.md`
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\data\vfx\high-tier-vfx-queue.json`
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\data\vfx\character-vfx-coverage.json`
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\runtime\service.json`
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\vfx-resume-20261008\intake-audit.json`
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\.omni\tmp\high-tier-source-20261008\make_resume_jobs.py`
- `E:\WindowsWorkspace\webworks\apps\stronghold-protocol\tools\assets\vfx-atlas-post.py`
