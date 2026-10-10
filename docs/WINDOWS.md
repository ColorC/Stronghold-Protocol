# Windows 便携包

便携包让 Windows 电脑运行游戏服务器。自带 Node 的版本无需另装 Node，解压后双击 `启动游戏.bat`，浏览器会打开工坊。
工坊入口是 `/independent.html`，原版盟约仍可从 `/index.html` 进入。连接别人已运行的服务器只需要浏览器。

相关代码：`scripts/make-windows-bundle.mjs`（打包）、`scripts/launch.mjs`（准备、启动与打开浏览器）。

## 轻量包与完整包

| 包 | 包含内容 | 首次启动 | 下载完成后 |
|---|---|---|---|
| Lite 轻量包 | 游戏代码、生产依赖、官方便携 Node | 联网获取公开游戏资源和字体，生成前端库；中断后再次启动继续下载 | 可离线游玩 |
| Full 完整包 | 以上内容及准备好的资源、字体、前端库 | 跳过资源准备，直接开服 | 可离线游玩 |

`--no-node` 会省略便携 Node；这种包需要目标电脑已安装 Node 22 或更高。联网时页面也可能加载 Google Fonts；
字体外链不阻塞游戏，断网时使用已下载的字体和系统字体。

## 打包

在已有 Node 22+ 的源码仓库执行：

```bash
node scripts/make-windows-bundle.mjs --lite --out D:\Game\Stronghold-Protocol-Windows-Lite
```

完整包先准备资源，再打包：

```bash
node tools/setup.mjs --no-local
node scripts/make-windows-bundle.mjs --out D:\Game\Stronghold-Protocol-Windows
```

可追加 `--no-node`，或用 `--node-version vX.Y.Z` 指定官方具体发行版本。Windows 构建会运行解压后的
`node.exe --version` 核对原生版本。源码版本使用 Git commit；不以自行计算的摘要作为版本身份或交付闸门。
官方归档缓存位于仓库 `.cache/`，每次从归档解压新的 `node.exe` 与同包许可证。解压器依次使用
`tar`、`unzip` 或 Windows `Expand-Archive`。

`--out` 应是专用产物目录，不能指向仓库本身或其上级。已有目录需要 `--force`；工具只接受空目录或有
`README-开箱即用.md` 与 `app/` 的既有便携包，其余目录保留并报错。

## 包内文件与启动

```text
node/node.exe            官方 Windows x64 Node（--no-node 时省略）
node/LICENSE-node.txt    同一官方归档的 Node 许可证
app/                     游戏代码、数据与生产依赖
启动游戏.bat             工坊启动入口
README-开箱即用.md       对应 Lite / Full 的使用说明
LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md
```

Lite 启动命令为 `app/scripts/launch.mjs --workshop`，必须保留资源准备步骤。
Full 使用 `app/scripts/launch.mjs --workshop --no-setup`。
源码 launcher 不带 `--workshop` 时默认打开原版盟约；该 flag 只选择浏览器入口，不传给资源准备工具。
控制台会显示工坊地址和原版盟约入口，朋友可使用打印出的局域网地址。

`app/` 的源码清单来自 `git ls-files`，略过 `test/`；`.env`、本机服务配置及其它未跟踪文件不收进包。
生产依赖通过 `npm ci --omit=dev --ignore-scripts` 安装，开发浏览器工具不进入发行包。
Full 额外收取准备好的 `public/assets`、`public/fonts` 与 `public/vendor`；Lite 不嵌入这些目录，也不携带
本机提取的 `data/local-assets.json`。整目录复制跳过符号链接和以点开头的条目。

游戏不安装服务、不写注册表；卸载时删除解压目录即可。需要服务部署时，参见 [DEPLOY.md](DEPLOY.md)。

## 常见问题

| 情况 | 处理 |
|---|---|
| `.bat` 一闪而过 | 在终端运行 `启动游戏.bat` 查看错误；手动运行 Lite 时保留 setup，Full 可追加 `--no-setup` |
| Lite 首次下载中断 | 网络恢复后再次启动；工具继续获取尚未下载的资源 |
| 找不到 Node | 自带 Node 的包应有 `node/node.exe`；`--no-node` 包需已安装 Node 22+ |
| 端口被占用 | 运行 `node tools/doctor.mjs` 定位，或启动时追加 `--port 3001` |
| 浏览器未自动打开 | 使用控制台地址，工坊路径为 `/independent.html`，盟约为 `/index.html` |
| 朋友无法连接 | 核对局域网、防火墙专用网络和访问地址；参见 [DEPLOY.md](DEPLOY.md) |
| Linux 上解压失败 | GNU tar 不支持 zip 时安装 `unzip` |

## 素材与第三方许可

本项目为非官方同人作品，与 Hypergryph、Yostar 及其关联方无隶属关系，未获其授权或认可。
游戏名称、角色、美术、音乐、音效、文本与数据归原权利人；这些资源不适用本项目的 GPL。
仅供学习交流与个人非商业使用，严禁任何形式的盈利，也不得单独再分发游戏资源。
权利人可通过 Issue 联系删除相关内容。本项目按现状提供，不提供任何担保。
完整条款见 [NOTICE.md](../NOTICE.md)，Node 与其它组件的许可见 [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)。
