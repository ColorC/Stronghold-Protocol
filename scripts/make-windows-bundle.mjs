#!/usr/bin/env node
// scripts/make-windows-bundle.mjs — 打一份「开箱即用」的 Windows 便携包（docs/WINDOWS.md）。
//
//   node scripts/make-windows-bundle.mjs [--out <dir>] [--no-node] [--force]
//
// 产物目录（默认 <仓库的上一级>\Stronghold-Protocol-Windows）：
//   node\node.exe            官方 Windows x64 便携版 Node（使用固定官方发布版本）
//   node\LICENSE-node.txt    Node 自己的许可证（和 node.exe 一起从官方 zip 里取出来）
//   app\                     游戏本体：**只收 git 跟踪的文件** + 生产依赖 + 素材，离线可玩
//   启动游戏.exe             启动器（scripts/windows/launcher.cs）：app\scripts\launch.mjs --workshop [--no-setup]
//   README-开箱即用.md       给玩家看的说明（含非官方 / 严禁盈利 / 素材版权声明）
//   LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md
//
// 目标机器无需预装 Node：解压 → 双击 启动游戏.exe；轻量包首次联网获取资源。
// 发行包里不放 .bat 启动脚本。启动器用 Windows 自带的 .NET Framework 4 csc.exe 编译，所以打包要在 Windows 上运行；
// 安装包（msi / exe）由 scripts/make-windows-installers.mjs 在这个目录的基础上生成。
//
// 三条硬规则（都是踩过的坑）：
//   1. app\ 的文件清单来自 `git ls-files`，不是手写的跳过表 —— `.env` / `.venv` / `.claude` /
//      `scripts/service.env.cmd` 这些本机文件被 .gitignore 挡在版本库外，因此天然进不了发行包。
//      旧实现用一张窄表整树复制，漏一项就是把密钥打进别人下载的压缩包。
//   2. node_modules 用 `npm ci --omit=dev` 重新装一遍，不带 devDependency（puppeteer-core 之类）。
//   3. 每次从固定版本的官方 zip 重新解压 Node，Windows 上运行 --version 验证原生版本。
//      zip 保留为下载缓存，解压目录每次新建，避免复用中断留下的可执行文件。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workshopIco } from './windows/icon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const MB = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** 官方 Node zip 的下载缓存（不进版本库）。放仓库下而不是系统临时目录：后者是共享的，中断留下的残片会混进来。 */
const NODE_CACHE_DIR = path.join(ROOT, '.cache');

/**
 * 便携版 Node 使用具体的官方发布版本，避免 latest-v22.x 随时间变化。
 * 版本身份来自发布号及 Windows 可执行文件的 --version；历史摘要字段不参与判定。
 */
const NODE_PIN = Object.freeze({
  version: 'v22.23.3',
  file: 'node-v22.23.3-win-x64.zip',
  sha256: '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71',
});

/** 这几份不进版本库（npm / tools/setup.mjs 生成），但必须进包，否则游戏缺素材或缺前端库。 */
const ASSET_DIRS = ['public/assets', 'public/fonts', 'public/vendor'];

/**
 * 留在源码仓库、不放进玩家运行包的跟踪文件：开发页面、测试夹具、CI 配置、启动器与安装包的源码、
 * 从源码目录启动用的 start-windows 脚本，以及开机自启服务（install-service-windows.ps1 → run-server.cmd，
 * 只用于源码部署，docs/DEPLOY.md §1.4）。
 */
const SKIP_TRACKED = ['test/', 'public/dev/', '.github/', 'scripts/windows/', 'scripts/start-windows.bat', 'scripts/start-windows.ps1',
  'scripts/install-service-windows.ps1', 'scripts/run-server.cmd'];

/** 发给玩家的包（zip / msi / exe）里任何时候都不放批处理：启动只用 启动游戏.exe。 */
const BATCH_FILE = /\.(bat|cmd)$/i;

/** 这个 git 跟踪的文件（仓库相对路径，posix 分隔符）进不进运行包。 */
export function isPackagedTrackedFile(rel) {
  return !SKIP_TRACKED.some((p) => rel === p || rel.startsWith(p)) && !BATCH_FILE.test(rel);
}

/**
 * 目录里的批处理文件（相对路径）。打包最后用它把关：运行包里出现任何 .bat / .cmd 就失败，
 * 不管它是跟踪文件、依赖带来的，还是以后哪一步新加的。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function findBatchFiles(dir) {
  const found = [];
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);   // eslint-disable-line no-await-in-loop
      else if (BATCH_FILE.test(e.name)) found.push(path.relative(dir, p));
    }
  };
  await walk(dir);
  return found;
}

/** 启动器源码与发行包里的文件名。 */
const LAUNCHER_SOURCE = path.join(ROOT, 'scripts', 'windows', 'launcher.cs');
export const LAUNCHER_NAME = '启动游戏.exe';

/** 包根要带的许可证 / 声明。 */
const LEGAL_FILES = ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md'];

/**
 * 本机从游戏文件里提取出来的 3D 棋盘贴图清单（不进版本库）。
 *
 * `public/assets/local`（约 68 MB）会随 `public/assets` 一起进包，但游戏是**靠这份 JSON** 才知道哪些贴图
 * 可用 —— 只带贴图不带清单，玩家拿到的是 68 MB 用不上的文件。它存在时就一起收。
 */
const LOCAL_ASSET_MANIFEST = path.join('data', 'local-assets.json');

function parseArgs(argv) {
  const o = { out: '', node: true, force: false, lite: false, nodeSpec: '', sha256: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--out') o.out = String(val() || '');
    else if (k === '--node-version') o.nodeSpec = String(val() || '');
    else if (k === '--sha256') o.sha256 = String(val() || '').toLowerCase();
    else if (a === '--no-node') o.node = false;
    else if (a === '--lite') o.lite = true;
    else if (a === '--force') o.force = true;
    else if (a === '-h' || a === '--help') o.help = true;
  }
  return o;
}

const HELP = `node scripts/make-windows-bundle.mjs — 生成 Windows 开箱即用便携包

  --lite             不嵌入美术 / 音频 / 字体，首次启动通过 setup 下载；仍自带 Node 与生产依赖
  --out <dir>        产物目录（默认 <仓库上一级>/Stronghold-Protocol-Windows）
  --no-node          不下载便携版 Node（目标机器需自备 Node 22+）
  --force            目录已存在时先删掉（只肯删空目录，或上一次打的便携包；其余情况拒绝）
  --node-version X   指定官方 Node 发布版本（默认 ${NODE_PIN.version}）

  app\\ 里只放 git 跟踪的文件 + 生产依赖（npm ci --omit=dev）+ public/{assets,fonts,vendor}；
  因此 .env / .venv / .claude / scripts/service.env.cmd 这些本机文件不会被打进去；
  开机自启服务脚本只留在源码仓库，产物里出现任何 .bat / .cmd 打包即失败。
  完整包会在存在本地棋盘贴图时附上 data/local-assets.json；轻量包不复制本机资源和清单。

  启动游戏.exe 运行 app\\scripts\\launch.mjs --workshop 进入工坊（启动器源码 scripts/windows/launcher.cs，
  用 Windows 自带的 .NET Framework csc.exe 编译，因此只能在 Windows 上打包）。
  完整包附加 --no-setup；轻量包保留首次启动的资源准备步骤。
  安装包（msi / 安装程序 exe）：node scripts/make-windows-installers.mjs（docs/WINDOWS.md）。
`;

/**
 * 路径的规范形式：把符号链接、macOS 的 `/tmp`、Windows 的 8.3 短名与大小写都归一。
 *
 * 产物目录通常还不存在，`fs.realpathSync.native` 会 ENOENT，所以只对**已存在的最深祖先**做归一，
 * 剩下的段原样接回去。Windows / macOS 的文件系统默认不区分大小写，比较前统一转小写 —— 不然
 * `--out c:\users\…\stronghold-protocol` 这种写法会绕过检查，而它指向的就是仓库本身。
 * @param {string} p
 * @returns {string}
 */
function canonical(p) {
  let head = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      head = fs.realpathSync.native(head);
      break;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) break;                 // 到根都还不存在：只能按字面量比
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
  const joined = tail.length ? path.join(head, ...tail) : head;
  // 只有 Linux 的默认文件系统区分大小写；darwin 上按不区分处理是偏保守的一侧（宁可拒绝也不误删）。
  return process.platform === 'linux' ? joined : joined.toLowerCase();
}

/**
 * `--out` 指到仓库本身或它的**上级**目录时，`--force` 会先 `rm -rf` 那个目录 —— 也就是把仓库整个删掉。
 * 这种路径直接拒绝（指向仓库内部是允许的，只是产物会出现在 git status 里）。
 *
 * 注意这只是第一道防线：真正的保险是下面 `forceDeleteVerdict()` 那条「不确定就不删」的规则，
 * 因为再小心的路径比较也挡不住 8.3 短名之类的花样。
 * @param {string} out
 * @param {string} [root]
 */
export function outDirIsUnsafe(out, root = ROOT) {
  const r = canonical(root);
  const o = canonical(out);
  if (o === r) return true;
  const rel = path.relative(o, r);          // 从 out 看 root 的相对位置
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 上一次打的便携包长这样：包根有这份说明，还有一个 app\ 目录。 */
const BUNDLE_MARKERS = Object.freeze(['README-开箱即用.md', 'app']);

/**
 * `--force` 允不允许删掉这个目录？
 *
 * 只认三种情况：目录还不存在；目录是空的；目录**看起来就是上次打的便携包**。
 * 其余一律拒绝 —— 路径比较挡不住大小写、符号链接、8.3 短名的花招，所以规则反过来写：
 * 只有能确认「这就是上次的产物」才动手删，认不出来就什么都不删。
 * @param {string} dir
 * @returns {'missing' | 'empty' | 'bundle' | 'refuse'}
 */
export function forceDeleteVerdict(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return e?.code === 'ENOENT' ? 'missing' : 'refuse';   // 读不出来（权限 / 不是目录）就别删
  }
  if (entries.length === 0) return 'empty';
  const app = entries.find((e) => e.name === 'app');
  const looksLikeBundle = BUNDLE_MARKERS.every((n) => entries.some((e) => e.name === n))
    && !!app && (app.isDirectory() || app.isSymbolicLink());
  return looksLikeBundle ? 'bundle' : 'refuse';
}

/**
 * 版本库里跟踪的文件（仓库相对路径，posix 分隔符）。
 *
 * 这是 app\ 文件清单的唯一来源。用 NUL 分隔读，避免中文 / 空格文件名被 git 转义或截断。
 * @returns {string[]}
 */
function trackedFiles() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error('git ls-files 失败：打包只收版本库里跟踪的文件，请在完整的 git 仓库里运行');
  }
  return r.stdout.toString('utf8').split('\0').filter(Boolean);
}

/** 按相对路径清单逐个复制（自动建目录）；必须的跟踪文件缺失时失败。 */
export async function copyFiles(relPaths, dst, root = ROOT) {
  let files = 0; let bytes = 0;
  for (const rel of relPaths) {
    const from = path.join(root, rel);
    const to = path.join(dst, rel);
    let st;
    try {
      // eslint-disable-next-line no-await-in-loop
      st = await fsp.stat(from);
    } catch (error) { throw new Error(`打包源文件缺失：${rel}（${from}）`, { cause: error }); }
    if (!st.isFile()) throw new Error(`打包源不是普通文件：${rel}（${from}）`);
    // eslint-disable-next-line no-await-in-loop
    await fsp.mkdir(path.dirname(to), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fsp.copyFile(from, to);
    files++; bytes += st.size;
  }
  return { files, bytes };
}

/**
 * 整目录复制（素材 / 依赖），跳过符号链接与点开头的条目。
 *
 * 点开头的条目一律不要：`public/assets` 里可能躺着打包机器自己的 `.DS_Store`，它既不属于项目也不该发出去。
 */
export async function copyDir(src, dst) {
  let files = 0; let bytes = 0;
  const walk = async (d, out) => {
    await fsp.mkdir(out, { recursive: true });
    const entries = await fsp.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const from = path.join(d, e.name);
      const to = path.join(out, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(from, to);
        continue;
      }
      if (!e.isFile()) continue;
      // eslint-disable-next-line no-await-in-loop
      await fsp.copyFile(from, to);
      files++;
      try {
        // eslint-disable-next-line no-await-in-loop
        bytes += (await fsp.stat(to)).size;
      } catch { /* ignore */ }
    }
  };
  await walk(src, dst);
  return { files, bytes };
}

async function dirSize(dir) {
  let bytes = 0; let files = 0;
  const walk = async (d) => {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) { files++; try { bytes += (await fsp.stat(p)).size; } catch { /* ignore */ } }
    }
  };
  await walk(dir);
  return { bytes, files };
}

/**
 * 只装生产依赖，装到 app\node_modules。
 *
 * 在临时目录里 `npm ci --omit=dev` 再搬过来：既拿到干净的生产依赖（不带 puppeteer-core 这类
 * devDependency），又不会动本仓库自己的 node_modules。
 */
async function installProductionDeps(appDir) {
  const stage = path.join(appDir, '.deps-stage');
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) throw new Error(`缺少 ${f}：无法安装生产依赖`);
    await fsp.copyFile(src, path.join(stage, f));
  }
  console.log('  · 安装生产依赖 npm ci --omit=dev（稍等）…');
  // --ignore-scripts：本仓库的 postinstall 是 `node tools/vendor.mjs`（把 npm 里的前端库拷进
  // public/vendor）。这个暂存目录里只有一份 package.json，脚本根本不存在，npm ci 会在 postinstall
  // 阶段 MODULE_NOT_FOUND；而 public/vendor 本来就是整目录进包（见 ASSET_DIRS），不需要再跑一次。
  // 依赖里也没有需要编译的原生模块（htm / pixi / preact / three / ws 都是纯 JS）。
  const args = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  // Windows 上 npm 是 npm.cmd（批处理），不能直接 spawn；显式走 cmd.exe，避免 shell:true 的参数转义告警。
  const r = IS_WIN
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: stage, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd: stage, stdio: 'inherit' });
  if (r.error || r.status !== 0) throw new Error('npm ci --omit=dev 失败（便携包需要生产依赖，请先联网）');
  await fsp.rm(path.join(appDir, 'node_modules'), { recursive: true, force: true });
  await fsp.rename(path.join(stage, 'node_modules'), path.join(appDir, 'node_modules'));
  await fsp.rm(stage, { recursive: true, force: true });
  // npm 的命令行垫片（.bin/*.cmd 等）只给 npm scripts 用，游戏运行用不到；运行包里不放 .cmd / .bat。
  await fsp.rm(path.join(appDir, 'node_modules', '.bin'), { recursive: true, force: true });
}

/**
 * PowerShell 单引号字符串的字面量，内部 `'` 要写成 `''`。
 *
 * 路径是拼进 `-Command` 的，合法路径里带 `'`（中文输入法很容易打出来）时直接拼接会截断命令，
 * 解压那一档就整条失效。
 * @param {string} s
 */
export function psSingleQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * 把 zip 解到 dir（必须是已存在的空目录）。
 *
 * 三种解压器按平台兜底：`tar`（Windows 10+ 的 bsdtar、macOS 的 bsdtar 都认得 zip）、`unzip`（GNU tar
 * 解不了 zip，Linux 上是这一档）、Windows 自带的 `Expand-Archive`。全试过才报错。
 * @returns {string} 实际成功的命令名
 */
export function extractZip(zipPath, dir) {
  const attempts = [
    ['tar', ['-xf', zipPath, '-C', dir]],
    ['unzip', ['-q', zipPath, '-d', dir]],
  ];
  if (IS_WIN) attempts.push(['powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${psSingleQuote(zipPath)} -DestinationPath ${psSingleQuote(dir)} -Force`]]);
  let last = '';
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    if (!r.error && r.status === 0) return cmd;
    last = `${cmd}: ${r.error ? r.error.message : `退出码 ${r.status}`}`;
  }
  throw new Error(`解压 ${path.basename(zipPath)} 失败（需要 tar / unzip，Windows 上也可以是 Expand-Archive）：${last}`);
}

/**
 * 从具体版本的官方 HTTPS 地址获取 zip，下载缓存放在仓库的 .cache\。
 * @returns {Promise<string>} zip 的绝对路径
 */
async function ensureNodeZip(version) {
  const zipName = `node-${version}-win-x64.zip`;
  const zipPath = path.join(NODE_CACHE_DIR, zipName);

  if (fs.existsSync(zipPath)) return zipPath;

  const url = `https://nodejs.org/dist/${version}/${zipName}`;
  console.log(`  · 下载 ${url}（约 30 MB）`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.mkdir(NODE_CACHE_DIR, { recursive: true });
  await fsp.writeFile(zipPath, buf);
  return zipPath;
}

/** Verify the official release using the executable's own native version. */
export function verifyPortableNodeVersion(nodeExe, version) {
  if (!IS_WIN) return version;
  const result = spawnSync(nodeExe, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`无法运行便携 Node：${nodeExe}；${result.error?.message || `退出码 ${result.status}`}`);
  }
  const actual = result.stdout.trim();
  if (actual !== version) throw new Error(`便携 Node 版本不符：${nodeExe}；预期 ${version}，实际 ${actual}`);
  return actual;
}

/**
 * 从官方发布 zip 解出 node.exe 与 LICENSE，并验证原生版本。
 *
 * 每次都新建一个临时目录重新解压，绝不复用上一次解压出来的文件 —— 缓存的是 zip，不是解压结果：
 * 解压中断留下的残缺 node.exe 与 zip 没有任何对应关系，直接复制就会把坏文件发出去。
 * @param {string} bundleNodeDir
 * @param {string} version 形如 v22.23.3
 * @param {string} zipPath 官方 win-x64 发布 zip
 */
async function extractPortableNode(bundleNodeDir, version, zipPath) {
  const zipName = `node-${version}-win-x64.zip`;
  const rootName = zipName.replace(/\.zip$/, '');   // win-x64 zip 的固定布局：<zip 名>/node.exe
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-node-'));
  try {
    const tool = extractZip(zipPath, tmp);
    const nodeExe = path.join(tmp, rootName, 'node.exe');
    const license = path.join(tmp, rootName, 'LICENSE');
    if (!fs.existsSync(nodeExe)) throw new Error(`解压后没找到 node.exe：${nodeExe}`);
    const actualVersion = verifyPortableNodeVersion(nodeExe, version);
    // 发出去的二进制必须带它自己的许可证 —— 官方 zip 里就有，取出来放旁边。
    if (!fs.existsSync(license)) throw new Error(`官方 zip 里没有 LICENSE：${license}（不能就这样打包发出去）`);
    await fsp.mkdir(bundleNodeDir, { recursive: true });
    await fsp.copyFile(nodeExe, path.join(bundleNodeDir, 'node.exe'));
    await fsp.copyFile(license, path.join(bundleNodeDir, 'LICENSE-node.txt'));
    console.log(`    解压器：${tool}`);
    return {
      version: actualVersion,
      bytes: (await fsp.stat(path.join(bundleNodeDir, 'node.exe'))).size,
      licenseBytes: (await fsp.stat(path.join(bundleNodeDir, 'LICENSE-node.txt'))).size,
    };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/**
 * 数字版本号：0.3.0-workshop.1 → 0.3.0.1。启动器 exe 的文件版本和 MSI 的 ProductVersion 都只认四段数字；
 * 预发布序号放进第四段（MSI 升级比较只看前三段，安装包因此允许同版本升级，见 scripts/windows/installer.wxs）。
 * @param {string} version package.json 的 version
 */
export function numericVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+\.(\d+))?$/.exec(String(version));
  if (!m) throw new Error(`版本号 ${version} 无法换成四段数字（支持 1.2.3 和 1.2.3-label.4）`);
  const parts = [m[1], m[2], m[3], m[4] ?? '0'].map(Number);
  const limits = [255, 255, 65535, 65535];
  if (parts.some((n, i) => n > limits[i])) throw new Error(`版本号 ${version} 超出 Windows 版本号范围（${limits.join('.')}）`);
  return parts.join('.');
}

/** Windows 自带的 .NET Framework 4 C# 编译器（Windows 10/11 都带 4.8，编出来的 exe 在干净系统上直接能跑）。 */
export function findCsc({ env = process.env, exists = fs.existsSync } = {}) {
  const windir = env.SystemRoot || env.windir || 'C:\\Windows';
  for (const fw of ['Framework64', 'Framework']) {
    const csc = path.win32.join(windir, 'Microsoft.NET', fw, 'v4.0.30319', 'csc.exe');
    if (exists(csc)) return csc;
  }
  return null;
}

/** C# 字符串字面量。 */
const csString = (s) => `"${String(s).replace(/[\\"]/g, '\\$&')}"`;

/**
 * 编译时生成的 BuildInfo.cs：启动参数与版本（launcher.cs 引用 BuildInfo.LaunchArguments）。
 * @param {{ launchArgs: string[], version: string }} o
 */
export function launcherBuildInfo({ launchArgs, version }) {
  const num = numericVersion(version);
  return [
    '// Generated by scripts/make-windows-bundle.mjs for scripts/windows/launcher.cs.',
    `[assembly: System.Reflection.AssemblyVersion(${csString(num)})]`,
    `[assembly: System.Reflection.AssemblyFileVersion(${csString(num)})]`,
    `[assembly: System.Reflection.AssemblyInformationalVersion(${csString(version)})]`,
    `static class BuildInfo { public static readonly string[] LaunchArguments = { ${launchArgs.map(csString).join(', ')} }; }`,
    '',
  ].join('\r\n');
}

/**
 * 编译 启动游戏.exe 到 outExe。
 *
 * 先编到临时目录里的 ASCII 文件名再复制：老版 csc 在非中文区域设置的系统上未必能处理中文的 /out 路径。
 * @param {string} outExe
 * @param {{ launchArgs: string[], version: string }} o
 */
export async function compileLauncher(outExe, { launchArgs, version }) {
  const csc = IS_WIN ? findCsc() : null;
  if (!csc) {
    throw new Error(`编译 ${LAUNCHER_NAME} 需要 Windows 自带的 .NET Framework 4 编译器 csc.exe`
      + '（%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe）：请在 Windows 10/11 上打包');
  }
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-launcher-'));
  try {
    const buildInfo = path.join(tmp, 'BuildInfo.cs');
    const icon = path.join(tmp, 'workshop.ico');
    const exe = path.join(tmp, 'launcher.exe');
    await fsp.writeFile(buildInfo, launcherBuildInfo({ launchArgs, version }), 'utf8');
    await fsp.writeFile(icon, workshopIco());
    const r = spawnSync(csc, ['/nologo', '/target:exe', '/optimize+', '/codepage:65001', `/win32icon:${icon}`, `/out:${exe}`,
      LAUNCHER_SOURCE, buildInfo], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    if (r.error || r.status !== 0) throw new Error(`csc.exe 编译启动器失败（${r.error ? r.error.message : `退出码 ${r.status}`}）：${LAUNCHER_SOURCE}`);
    await fsp.copyFile(exe, outExe);
    return { csc, bytes: (await fsp.stat(outExe)).size };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/**
 * 声明要点（Markdown）。包内说明和安装包的「使用前须知」页用同一份，免得两处措辞走样。
 * @param {{ lite?: boolean }} o
 */
export function noticePoints({ lite = false } = {}) {
  return [
    '本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关系**，未获其授权或认可。',
    '《明日方舟》及「卫戍协议」相关的名称、角色、美术、音乐、音效、文本与数据等素材，版权归原权利人所有。这些素材**不适用**本项目的 GPL-3.0 许可证；GPL 只覆盖本项目自己编写的代码。',
    '仅供学习交流与个人非商业使用。**严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。',
    `${lite ? '首次启动时获取的游戏美术与音频素材仅供本项目使用。' : '本包附带游戏的美术与音频素材。'}请勿将素材用于本项目以外的用途或**单独再分发**。完整条款见 [NOTICE.md](NOTICE.md)。`,
    '权利人如认为本项目侵犯其权益，请通过 Issue 联系，我们会**立即删除**相关内容。',
    '本项目按「现状」提供，**不提供任何担保**，使用风险自负。',
  ];
}

/**
 * 包内说明。带不带便携版 Node 会影响三处措辞（是否需要预装 Node、许可证在哪、目录结构），
 * 所以先算好片段再拼，别在模板里嵌套引号。
 */
export function bundleReadme({ version, withNode, lite = false }) {
  const nodeNeed = withNode
    ? `目标机器**不需要安装 Node**：包内的 \`node\\node.exe\` 就是便携版 Node ${version}。`
    : '这个包**没有带便携版 Node**，请先在这台机器上安装 Node 22 或 24（LTS）。';
  const nodeLicence = withNode ? ' 与 `node\\LICENSE-node.txt`（Node 自己的 MIT 许可证）' : '';
  const tree = withNode
    ? `node\\node.exe            便携版 Node ${version}（官方 x64）
node\\LICENSE-node.txt    Node 自己的许可证（MIT）
app\\                    游戏本体：server / shared / public${lite ? '（首次启动获取资源）' : '（完整资源）'} / data / scripts / tools
启动游戏.exe             启动器：app\\scripts\\launch.mjs --workshop${lite ? '' : ' --no-setup'}
README-开箱即用.md       本文件
LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md`
    : `app\\                    游戏本体：server / shared / public${lite ? '（首次启动获取资源）' : '（完整资源）'} / data / scripts / tools
启动游戏.exe             启动器：app\\scripts\\launch.mjs --workshop${lite ? '' : ' --no-setup'}
README-开箱即用.md       本文件
LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md

（没有 node\\ 这一层：本包不带便携版 Node，请自行安装 Node 22/24 LTS）`;

  const title = lite ? '卫戍协议：工坊 · Windows 轻量包' : '卫戍协议：工坊 · Windows 完整包';
  const firstRun = lite
    ? `首次启动需要联网获取游戏资源和字体，窗口会显示下载进度；中断后再次双击会继续下载。资源下载完成后可以离线游玩。没有本地《明日方舟》客户端资源时，棋盘使用 2D。`
    : `公开资源和依赖已包含在包内，不需要首次下载。没有本地《明日方舟》客户端资源时，棋盘使用 2D，部分图标和模型使用替代样式。`;
  return `# ${title}

解压后**双击 \`启动游戏.exe\`** 即可。
${nodeNeed}
启动器没有代码签名：如果 Windows 显示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。
${firstRun}

${lite ? '**下载完成后可以离线游玩**：轻量包自带游戏依赖，美术、音频和字体在首次启动时下载。断网时使用已下载的字体和系统黑体。' : '**不联网也能玩**：美术 / 音频 / 依赖 / 字体全部在包内，断网时使用自带字体和系统黑体。'}
**联网时**页面还会去 Google Fonts 加载
Noto Sans SC 这类网页字体（\`index.html\` 的字体外链不阻塞渲染），
只是让中文更接近原版观感 —— 断网不会因此卡住或报错。

## 声明

> [!IMPORTANT]
${noticePoints({ lite }).map((p) => `> - ${p}`).join('\n')}

包内 [LICENSE](LICENSE) 里的 GPL-3.0-or-later 覆盖的是**本项目自己编写的代码**；内置 Node.js（MIT）以及其它
第三方组件的许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)${nodeLicence}。

## 怎么玩

\`\`\`
本机当服务器   双击 启动游戏.exe：在这台电脑开服，浏览器自动打开；
               控制台会打印「发给朋友」的局域网地址（形如 http://192.168.1.23:3000）
连别人的服务器 不需要这个包，直接用浏览器打开对方的网址就行
\`\`\`

浏览器会打开工坊入口 \`/independent.html\`。原版盟约入口是 \`/index.html\`。
工坊对局自动保存；原版盟约建房后可把同盟密钥或房间链接发给朋友。
第一次开服时 Windows 防火墙可能弹窗，需要局域网访问时允许专用网络。


## 目录结构

\`\`\`
${tree}
\`\`\`

工坊对局的存档保存在 \`%LOCALAPPDATA%\\Stronghold-Protocol-Workshop\`（窗口第一行会显示完整路径），
解压新版本到别的文件夹也能接着玩；浏览器还会记住当前对局与昵称。

卸载＝直接删掉整个文件夹（不写注册表、不放系统目录）。不再需要存档时，再删掉上面的存档目录。
`;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  const out = path.resolve(o.out || path.join(path.dirname(ROOT), 'Stronghold-Protocol-Windows'));
  const appDir = path.join(out, 'app');
  const nodeDir = path.join(out, 'node');

  // Release identity comes from the official Node version; legacy digest arguments are ignored.
  let nodeVersion = NODE_PIN.version;
  if (o.nodeSpec) {
    if (!/^v?\d+\.\d+\.\d+$/.test(o.nodeSpec)) {
      console.error(`✖ --node-version 要写成 v22.23.3 这样的具体版本，收到的是 ${o.nodeSpec}（latest-22.x 这类浮动版本不行，那样两次打包内容会不一样）。`);
      return 1;
    }
    nodeVersion = o.nodeSpec.startsWith('v') ? o.nodeSpec : `v${o.nodeSpec}`;
  }

  console.log(`\n卫戍协议 · Windows ${o.lite ? '轻量' : '完整'}包\n  源仓库：${ROOT}\n  产物：  ${out}\n`);

  // --out 指到仓库本身 / 上级目录时直接拒绝；--force 另外只肯删「空目录」或「上一次打的包」。
  if (outDirIsUnsafe(out)) {
    console.error(`✖ --out 指向仓库本身或它的上级目录：${out}\n  加 --force 会把仓库删掉，请换一个仓库之外的目录（例如 D:\\Game\\Stronghold-Protocol-Windows）。`);
    return 1;
  }
  const verdict = forceDeleteVerdict(out);
  if (verdict !== 'missing') {
    if (!o.force) {
      console.error(`✖ ${out} 已存在。要覆盖请加 --force —— 它只会删掉空目录，或上一次打的便携包，其余情况一律拒绝。`);
      return 1;
    }
    if (verdict === 'refuse') {
      console.error(`✖ ${out} 已存在，但它既不是空目录，也不像上一次打的便携包（包根要有 README-开箱即用.md 和 app\\）。`
        + '\n  为免误删，这里不会动它：请自己确认后删掉，或换一个 --out（例如 D:\\Game\\Stronghold-Protocol-Windows）。');
      return 1;
    }
    await fsp.rm(out, { recursive: true, force: true });
    console.log(`  · 清掉 ${out}（${verdict === 'empty' ? '空目录' : '上一次的便携包'}）`);
  }
  await fsp.mkdir(out, { recursive: true });

  // 1) 游戏代码：只收 git 跟踪的文件
  const all = trackedFiles();
  const wanted = all.filter(isPackagedTrackedFile);
  console.log(`  · 复制游戏本体（git 跟踪的 ${wanted.length} 个文件，略过 ${all.length - wanted.length} 个开发与测试文件）…`);
  const copied = await copyFiles(wanted, appDir);
  console.log(`    完成：${copied.files} 个文件 / ${MB(copied.bytes)}`);

  // 2) 素材与前端库（不进版本库，必须存在）
  const packageAssets = o.lite ? [] : ASSET_DIRS;
  for (const d of packageAssets) {
    if (!fs.existsSync(path.join(ROOT, d))) {
      throw new Error(`缺少 ${d} —— 先运行 node tools/setup.mjs 把素材 / 前端库准备好`);
    }
  }
  console.log(o.lite ? '  · 轻量包跳过 public/assets、public/fonts、public/vendor（首次启动由 setup 获取）…' : `  · 复制素材与前端库（${ASSET_DIRS.join('、')}）…`);
  let assetFiles = 0; let assetBytes = 0;
  for (const d of packageAssets) {
    // eslint-disable-next-line no-await-in-loop
    const s = await copyDir(path.join(ROOT, d), path.join(appDir, d));
    assetFiles += s.files; assetBytes += s.bytes;
  }
  console.log(`    完成：${assetFiles} 个文件 / ${MB(assetBytes)}`);

  // 2b) 3D 棋盘贴图的清单（本机提取过才有）：贴图在 public/assets/local 里，靠这份 JSON 才会被游戏采用。
  const localManifest = path.join(ROOT, LOCAL_ASSET_MANIFEST);
  const localTextures = path.join(ROOT, 'public', 'assets', 'local');
  if (!o.lite && fs.existsSync(localManifest)) {
    await fsp.copyFile(localManifest, path.join(appDir, LOCAL_ASSET_MANIFEST));
    console.log(`    带上 ${LOCAL_ASSET_MANIFEST}（3D 棋盘贴图的清单，贴图本体在 public/assets/local）`);
  } else if (!o.lite && fs.existsSync(localTextures)) {
    console.log(`    ! 有 public/assets/local 但没有 ${LOCAL_ASSET_MANIFEST}：贴图进了包也用不上，`
      + '先跑 node tools/setup.mjs --local 生成清单（或删掉该目录）');
  }

  // 3) 生产依赖
  await installProductionDeps(appDir);
  const deps = await dirSize(path.join(appDir, 'node_modules'));
  console.log(`    完成：${deps.files} 个文件 / ${MB(deps.bytes)}（只含生产依赖）`);

  // 4) 便携版 Node（每次从官方发布 zip 重新解压并验证原生版本）
  let nodeInfo = { version: '（未打包，目标机器需自备 Node 22+）', bytes: 0 };
  if (o.node) {
    console.log(`  · 准备便携版 Node ${nodeVersion}…`);
    await fsp.mkdir(nodeDir, { recursive: true });
    const zipPath = await ensureNodeZip(nodeVersion);
    nodeInfo = await extractPortableNode(nodeDir, nodeVersion, zipPath);
    console.log(`    完成：Node ${nodeInfo.version} / ${MB(nodeInfo.bytes)} + LICENSE`);
  }

  // 5) 包根的法律文件（本项目的 LICENSE / NOTICE / 第三方声明）
  for (const f of LEGAL_FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) {
      console.log(`    ! 版本库里没有 ${f}，包根将缺少这份声明`);
      continue;
    }
    await fsp.copyFile(src, path.join(out, f));
  }

  // 6) 启动器：用 Windows 自带的 csc.exe 编译，启动参数编进 exe（轻量包保留资源准备步骤）
  const launchArgs = ['--workshop', ...(o.lite ? [] : ['--no-setup'])];
  const version = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
  const launcher = await compileLauncher(path.join(out, LAUNCHER_NAME), { launchArgs, version });
  console.log(`  · 启动器 ${LAUNCHER_NAME}（${launchArgs.join(' ')}，版本 ${version}）：${MB(launcher.bytes)}，编译器 ${launcher.csc}`);
  await fsp.writeFile(path.join(out, 'README-开箱即用.md'), bundleReadme({ version: nodeVersion, withNode: !!o.node, lite: o.lite }), 'utf8');

  const batch = await findBatchFiles(out);
  if (batch.length) throw new Error(`运行包里不能有 .bat / .cmd：${batch.join('、')}`);

  const total = await dirSize(out);
  console.log(`\n✔ 便携包已生成：${out}\n  ${total.files} 个文件 / ${MB(total.bytes)}`);
  console.log(`  双击「${LAUNCHER_NAME}」即可（本机开服，浏览器自动打开）${o.lite ? '；首次启动会运行 setup 下载资源' : ''}。`);
  return 0;
}

// 作为脚本运行时才打包（被 import 时只导出纯函数，方便测试）。
// 用 realpath 比较：路径经过符号链接（macOS 的 /tmp、Windows 的 8.3 短名）时 argv[1] 与 import.meta.url
// 的字面量不同，直接比 URL 会让脚本什么都不做就退出。
function isMain() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isMain()) main().then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
