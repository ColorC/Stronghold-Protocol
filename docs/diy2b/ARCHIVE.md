# 2B 动作封档

2026-10-10，按用户决定封存 Spine / 2B 动作试验。此页只用于查看最后保留的正面与背面动作；视觉反馈仍未通过，封档不表示问题已修好。

## 最后保留版本

- 最新普攻源码恢复点：Git commit `323119340a720d616936262b4fcadd4b5517a364`，提交说明为 “Move the sword hand outward during 2B preparation”。源仓库：`E:/WindowsWorkspace/webworks/apps/stronghold-protocol`。
- 正背面各一套 JSON、atlas 与 PNG 共六个模型文件，已复制为自足封档集；总计 2,790,836 bytes。最终位置为 `public/dev/spine-archive/model/front/char_diy_2b.json`、`char_diy_2b.atlas`、`char_diy_2b.png`，以及 `public/dev/spine-archive/model/back/char_diy_2b_back.json`、`char_diy_2b_back.atlas`、`char_diy_2b_back.png`。查看页直接读取这六个封档文件。
- 页面保留播放、暂停、速度、拖帧、正背面、动作与部位查看，以及带当前帧参数的链接。

## 视觉结论与限制

原画与骨架的并排复核发现：正面蓄力时剑朝右上，但前臂朝右下、手在腹前；背面剑也朝右上，而前臂朝右上、手举到头侧。剑的屏幕朝向相近，不代表握持姿态相同。屏幕投影轴不是三维关节角度，仍需回到原图判断手掌、握柄、袖口、遮挡与剑刃空间关系。

最新视觉反馈尚未验收，当前版本不能作为修复完成的证明，也不代表动作质量已达标。此页只展示封档版本，不生成视频、不自动判定脚部接触或动作正确性。

## 恢复与证据

源码历史恢复点为上述 Git commit。工作副本中的存档页代码位于 `public/dev/spine-archive/`；封档模型文件位于该目录下 `model/front/` 与 `model/back/`。精简画布图示与 Git 原生历史保留。旧试验工具、查看页、原始帧、视频及下载包已纳入用户授权的封档清理范围；运行材料和下载包通过各自原生设施处理，不依赖临时运行目录。
