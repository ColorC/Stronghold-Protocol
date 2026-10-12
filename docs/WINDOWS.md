# Windows 安装包与便携包

Windows 玩家可以从三种下载里任选一种，内容相同：启动器 `启动游戏.exe`、官方便携 Node、游戏代码与运行依赖。
都不包含游戏美术，首次启动联网下载资源并显示进度，下载完成后可离线游玩。目标电脑不需要另装 Node 或其它运行库。
工坊入口是 `/independent.html`，原版盟约仍可从 `/index.html` 进入。连接别人已运行的服务器只需要浏览器。

| 下载 | 安装位置 | 卸载 |
|---|---|---|
| 安装程序 `Stronghold-Protocol-Workshop-Setup-<版本>.exe`（推荐） | `%LOCALAPPDATA%\Programs\Stronghold-Protocol-Workshop`，只为当前用户安装，不需要管理员 | 「设置 → 应用」 |
| MSI `Stronghold-Protocol-Workshop-<版本>.msi` | 同上 | 「设置 → 应用」，或 `msiexec /x <msi>` |
| 便携包 `Stronghold-Protocol-Windows-Lite-workshop-v<版本>.zip` | 解压到的文件夹 | 删除该文件夹 |

相关代码：`scripts/windows/launcher.cs`（启动器）、`scripts/make-windows-bundle.mjs`（便携包目录）、
`scripts/make-windows-installers.mjs`（zip、MSI、安装程序）、`scripts/windows/installer.wxs`（MSI）、
`scripts/windows/installer.nsi`（安装程序）、`scripts/launch.mjs`（准备、启动与打开浏览器）。

## 启动

- 双击开始菜单或桌面上的「卫戍协议：工坊」；便携包则双击 `启动游戏.exe`。
- 启动窗口显示首次资源下载进度；服务器就绪后浏览器打开 `http://localhost:3000/independent.html`，窗口里列出可以发给朋友的局域网地址。
- 关闭窗口（或按 `Ctrl+C`）即停止服务器。服务器已经在运行时再次启动只会打开浏览器。
- 启动参数原样交给 `app\scripts\launch.mjs`，例如换端口：`启动游戏.exe --port 3001`。
- 安装包和启动器没有代码签名。Windows 显示「Windows 已保护你的电脑」时点「更多信息」→「仍要运行」；浏览器提示文件不常下载时选择保留。

## 存档、资源与卸载

- **存档**：启动器把工坊存档放在 `%LOCALAPPDATA%\Stronghold-Protocol-Workshop\independent-sessions`（启动窗口第一行显示完整路径），
  做法是为服务器设置 `SP_INDEPENDENT_DIRECTORY`；已经自己设置了这个环境变量时以你的为准。卸载、升级、把便携包解压到别的文件夹都不影响存档。
  旧版便携包留在 `app\runtime\independent-sessions` 的存档会在第一次启动时复制过来。浏览器还会按地址（如 `http://localhost:3000`）记住当前对局和昵称。
- **资源**：游戏下载的美术、音频、字体、前端库与下载缓存都在安装目录的 `app\` 里（`public\assets`、`public\fonts`、`public\vendor`、`.cache`；
  从本机客户端提取时还有 `data\local-assets.json`、`public\assets\local`、`.venv-extract`）。
- **卸载**：两种安装包都会删除整个安装目录（包括下载的资源与缓存）、开始菜单和桌面快捷方式，以及「应用」里的条目；存档目录保留，不再需要时手动删除
  `%LOCALAPPDATA%\Stronghold-Protocol-Workshop`。便携包直接删除文件夹即可，不写注册表。
- **升级**：直接运行新版本的安装包，已下载的资源保留，其余程序文件替换。MSI 使用固定的 UpgradeCode 做主要升级；安装程序 exe 覆盖安装。
  MSI 与安装程序 exe 装在同一个目录，彼此不会叠加安装：要换另一种，先在「设置 → 应用」里卸载。

## 打包

在 Windows 10/11 的源码仓库（git 检出）执行，需要 Node 22+、npm 和 `dotnet`（.NET 6 或更高的运行时即可，不需要 SDK）：

```powershell
node scripts/make-windows-installers.mjs --out D:\Release\workshop
```

它依次完成：

1. 运行 `make-windows-bundle.mjs --lite` 生成便携包目录，其中的 `启动游戏.exe` 用 Windows 自带的 .NET Framework 4 编译器
   `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 编译，图标由 `scripts/windows/icon.mjs` 按网页图标的形状生成。
2. 准备工具，不做系统安装：

   | 工具 | 来源 |
   |---|---|
   | NSIS 3（makensis） | `--makensis <exe>` 或环境变量 `SP_MAKENSIS`；默认用 Tauri 构建缓存的 `%LOCALAPPDATA%\tauri\NSIS\makensis.exe`；都没有时才下载 NSIS 3.11 zip（downloads.sourceforge.net） |
   | WiX 5.0.2、WixToolset.UI.wixext 5.0.2、WixToolset.Util.wixext 5.0.2 | nuget.org（v5 没有 v6 的维护费条款）。`installer.wxs` 用到 WiX 4 起才有的 `Files` 收集和带条件的 `RemoveFolderEx`，所以不用 WiX 3 |

   下载件固定版本并校验 SHA-256，缓存在 `.cache\windows-installer-tools`（`--cache` 可改；缓存里已有就不联网），只在构建目录里解压使用。

3. 在 `--out` 写出 `Stronghold-Protocol-Windows-Lite-workshop-v<版本>.zip`（UTF-8 文件名，包内顶层目录 `Stronghold-Protocol-Windows-Lite`）、
   `Stronghold-Protocol-Workshop-<版本>.msi`、`Stronghold-Protocol-Workshop-Setup-<版本>.exe` 和 `SHA256SUMS.txt`。

`<版本>` 来自 `package.json`。MSI 的 ProductVersion 只能是数字，`0.3.0-workshop.1` 换成 `0.3.0.1`；MSI 升级只比较前三段，
所以允许同版本升级。`installer.wxs` 里的 UpgradeCode 是这个产品的固定身份，不能修改。中间文件在 `<out>\.stage`，
成功后删除（`--keep-stage` 保留）；`--bundle <dir>` 复用已打好的便携包目录。没有代码签名证书时三个文件都未签名。

只要便携包目录时：

```powershell
node scripts/make-windows-bundle.mjs --lite --out D:\Game\Stronghold-Protocol-Windows-Lite
```

完整包先准备资源，再打包：

```powershell
node tools/setup.mjs --no-local
node scripts/make-windows-bundle.mjs --out D:\Game\Stronghold-Protocol-Windows
```

可追加 `--no-node`，或用 `--node-version vX.Y.Z` 指定官方具体发行版本。Windows 构建会运行解压后的
`node.exe --version` 核对原生版本。源码版本使用 Git commit；不以自行计算的摘要作为版本身份或交付闸门。
官方归档缓存位于仓库 `.cache/`，每次从归档解压新的 `node.exe` 与同包许可证。解压器依次使用
`tar`、`unzip` 或 Windows `Expand-Archive`。

`--out` 应是专用产物目录，不能指向仓库本身或其上级。已有目录需要 `--force`；工具只接受空目录或有
`README-开箱即用.md` 与 `app/` 的既有便携包，其余目录保留并报错。

## 包内文件

```text
node/node.exe            官方 Windows x64 Node（--no-node 时省略）
node/LICENSE-node.txt    同一官方归档的 Node 许可证
app/                     游戏代码、数据与生产依赖
启动游戏.exe             启动器
README-开箱即用.md       对应 Lite / Full 的使用说明
LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md
```

启动参数编译进启动器：Lite 为 `app/scripts/launch.mjs --workshop`，必须保留资源准备步骤；
Full 为 `app/scripts/launch.mjs --workshop --no-setup`。启动器优先使用包内 `node\node.exe`，`--no-node` 包使用 PATH 里的 Node。
源码 launcher 不带 `--workshop` 时默认打开原版盟约；该 flag 只选择浏览器入口，不传给资源准备工具。

`app/` 的源码清单来自 `git ls-files`，略过 `test/`、`public/dev/`、`.github/`、`scripts/windows/`（启动器与安装包源码）、
从源码目录启动用的 `scripts/start-windows.*`，以及开机自启服务的 `scripts/install-service-windows.ps1` 与 `scripts/run-server.cmd`
（它们只留在源码仓库，供源码部署使用，见 [DEPLOY.md](DEPLOY.md) §1.4）；`.env`、本机服务配置 `service.env.cmd` 及其它未跟踪文件不收进包。
发给玩家的 zip、MSI 和安装程序里任何时候都没有 `.bat` / `.cmd`：两个打包脚本都会检查产物，出现就失败。
生产依赖通过 `npm ci --omit=dev --ignore-scripts` 安装并去掉 npm 的命令行垫片 `node_modules/.bin`，开发浏览器工具不进入发行包。
Full 额外收取准备好的 `public/assets`、`public/fonts` 与 `public/vendor`；Lite 不嵌入这些目录，也不携带
本机提取的 `data/local-assets.json`。整目录复制跳过符号链接和以点开头的条目。

开机自启等服务部署需要源码检出，参见 [DEPLOY.md](DEPLOY.md)。

## 常见问题

| 情况 | 处理 |
|---|---|
| 「Windows 已保护你的电脑」 | 安装包和启动器没有代码签名：点「更多信息」→「仍要运行」 |
| 启动窗口一打开就关闭 | 服务器已经在另一个窗口里运行，启动器只打开了浏览器 |
| 启动窗口显示错误并停住 | 按窗口提示处理；端口被占用时用 `启动游戏.exe --port 3001`，或运行 `node tools/doctor.mjs` 定位 |
| 提示已用另一种安装包安装 | MSI 与安装程序 exe 不叠加安装：先在「设置 → 应用」卸载已安装的那一个 |
| 卸载或升级时提示游戏正在运行 | 先关闭启动窗口，再重试 |
| 首次下载中断 | 网络恢复后再次启动；工具继续获取尚未下载的资源 |
| 找不到 Node | 自带 Node 的包应有 `node\node.exe`；`--no-node` 包需已安装 Node 22+ |
| 浏览器未自动打开 | 使用窗口里的地址，工坊路径为 `/independent.html`，盟约为 `/index.html` |
| 朋友无法连接 | 核对局域网、防火墙专用网络和访问地址；参见 [DEPLOY.md](DEPLOY.md) |
| Linux 上解压失败 | GNU tar 不支持 zip 时安装 `unzip` |

## 素材与第三方许可

本项目为非官方同人作品，与 Hypergryph、Yostar 及其关联方无隶属关系，未获其授权或认可。
游戏名称、角色、美术、音乐、音效、文本与数据归原权利人；这些资源不适用本项目的 GPL。
仅供学习交流与个人非商业使用，严禁任何形式的盈利，也不得单独再分发游戏资源。
权利人可通过 Issue 联系删除相关内容。本项目按现状提供，不提供任何担保。
完整条款见 [NOTICE.md](../NOTICE.md)，Node 与其它组件的许可见 [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)。