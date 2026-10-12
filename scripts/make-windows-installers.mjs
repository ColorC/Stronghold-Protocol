#!/usr/bin/env node
// scripts/make-windows-installers.mjs — the Windows release files of the Workshop Lite build (docs/WINDOWS.md).
//
//   node scripts/make-windows-installers.mjs [--out <dir>] [--cache <dir>] [--makensis <exe>] [--bundle <dir>] [--keep-stage]
//
// Produces, in --out (default <repo parent>/Stronghold-Protocol-Windows-Installers):
//   Stronghold-Protocol-Windows-Lite-workshop-v<version>.zip   portable bundle: unpack, double-click 启动游戏.exe
//   Stronghold-Protocol-Workshop-<version>.msi                 per-user MSI (WiX 5, scripts/windows/installer.wxs)
//   Stronghold-Protocol-Workshop-Setup-<version>.exe           per-user setup (NSIS 3, scripts/windows/installer.nsi)
//   SHA256SUMS.txt
//
// All three carry the same payload, `make-windows-bundle.mjs --lite`: the launcher, the portable Node, game code and
// production dependencies, no art (the launcher downloads the resources on first start). <version> is package.json's.
//
// Windows only: the launcher is compiled with the .NET Framework csc.exe that ships with Windows, WiX runs on the
// .NET runtime (`dotnet` 6 or newer on PATH; no SDK needed) and makensis is a Windows program. Nothing is installed
// system-wide:
//   makensis   --makensis, else SP_MAKENSIS, else the NSIS 3 that Tauri builds cache in %LOCALAPPDATA%\tauri\NSIS;
//              only when none exists, the pinned NSIS 3.11 zip from downloads.sourceforge.net
//   WiX 5.0.2 + WixToolset.UI / WixToolset.Util extensions from nuget.org (v5: no maintenance-fee EULA of v6).
//              installer.wxs needs WiX 4+ (Files harvesting, RemoveFolderEx Condition), so a cached WiX 3 is not used.
// Downloads are pinned, checked by SHA-256, kept in --cache (default <repo>/.cache/windows-installer-tools; a cache
// that already holds the files needs no network) and unpacked into the staging directory.
// Every payload is checked before packaging: a .bat / .cmd anywhere in it fails the build.
//
// No code signing: SmartScreen warns on the first start of each file (docs/WINDOWS.md tells players how to proceed).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractZip, findBatchFiles, noticePoints, numericVersion, outDirIsUnsafe } from './make-windows-bundle.mjs';
import { workshopIco, crc32 } from './windows/icon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const MB = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** Pinned build tools (the nupkg / zip files themselves are what the SHA-256 covers). */
export const TOOLS = Object.freeze({
  wix: {
    file: 'wix.5.0.2.nupkg',
    url: 'https://api.nuget.org/v3-flatcontainer/wix/5.0.2/wix.5.0.2.nupkg',
    sha256: 'f30ef0c74e2a986126539c5780be93ac24e8136eaf723b1937b26272703ae173',
  },
  wixUi: {
    file: 'wixtoolset.ui.wixext.5.0.2.nupkg',
    url: 'https://api.nuget.org/v3-flatcontainer/wixtoolset.ui.wixext/5.0.2/wixtoolset.ui.wixext.5.0.2.nupkg',
    sha256: '5ef2c707614b9f70b6bbadd2d4abcb4124efee215e9b16bfbc80113079a604c7',
  },
  wixUtil: {
    file: 'wixtoolset.util.wixext.5.0.2.nupkg',
    url: 'https://api.nuget.org/v3-flatcontainer/wixtoolset.util.wixext/5.0.2/wixtoolset.util.wixext.5.0.2.nupkg',
    sha256: 'dda1cc1b4d3b2305b1246f167c6af6fcded5000be84b3bbff3dda4f442bf4740',
  },
  nsis: {
    file: 'nsis-3.11.zip',
    url: 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11.zip',
    sha256: 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1',
  },
});

/** Folder name inside the zip (earlier releases unpacked to this folder too). */
const ZIP_TOP = 'Stronghold-Protocol-Windows-Lite';
const WXS = path.join(ROOT, 'scripts', 'windows', 'installer.wxs');
const NSI = path.join(ROOT, 'scripts', 'windows', 'installer.nsi');

export function artifactNames(version) {
  return {
    zip: `Stronghold-Protocol-Windows-Lite-workshop-v${version}.zip`,
    msi: `Stronghold-Protocol-Workshop-${version}.msi`,
    exe: `Stronghold-Protocol-Workshop-Setup-${version}.exe`,
  };
}

function parseArgs(argv) {
  const o = { out: '', cache: '', makensis: '', bundle: '', keepStage: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--out') o.out = String(val() || '');
    else if (k === '--cache') o.cache = String(val() || '');
    else if (k === '--makensis') o.makensis = String(val() || '');
    else if (k === '--bundle') o.bundle = String(val() || '');
    else if (a === '--keep-stage') o.keepStage = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return o;
}

const HELP = `node scripts/make-windows-installers.mjs — 生成工坊 Windows 轻量包 zip、MSI 与安装程序 exe

  --out <dir>      产物目录（默认 <仓库上一级>/Stronghold-Protocol-Windows-Installers）
  --cache <dir>    WiX / NSIS 下载缓存（默认 <仓库>/.cache/windows-installer-tools）
  --makensis <exe> 使用这台电脑上的 NSIS 3（也可用环境变量 SP_MAKENSIS）；
                   默认 %LOCALAPPDATA%\\tauri\\NSIS\\makensis.exe（Tauri 构建缓存的 NSIS），都没有时才下载 NSIS 3.11
  --bundle <dir>   复用已经打好的轻量包目录（make-windows-bundle.mjs --lite 的产物），不重新打包
  --keep-stage     保留 <out>/.stage（轻量包目录、WiX 中间文件、解压的工具），默认成功后删除

  只能在 Windows 上运行：需要系统自带的 .NET Framework csc.exe、PATH 里的 dotnet（.NET 6 或更高运行时）。
`;

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** The pinned tool in the cache, downloaded when missing; a file whose SHA-256 differs is never used. */
async function fetchTool(tool, cacheDir) {
  const file = path.join(cacheDir, tool.file);
  if (fs.existsSync(file) && sha256File(file) === tool.sha256) return file;
  console.log(`  · 下载 ${tool.url}`);
  const res = await fetch(tool.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${res.statusText}：${tool.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== tool.sha256) throw new Error(`${tool.file} 的 SHA-256 不符：预期 ${tool.sha256}，实际 ${got}（${tool.url}）`);
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.writeFile(`${file}.part`, buf);
  await fsp.rename(`${file}.part`, file);
  return file;
}

async function unpackTool(archive, dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  extractZip(archive, dir);
  return dir;
}

/** `dotnet` with a .NET 6+ runtime (WiX 5 is a framework-dependent .NET 6 tool), or null. */
function dotnetRuntimeMajor() {
  const r = spawnSync('dotnet', ['--list-runtimes'], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) return 0;
  const majors = [...r.stdout.matchAll(/^Microsoft\.NETCore\.App (\d+)\./gm)].map((m) => Number(m[1]));
  return majors.length ? Math.max(...majors) : 0;
}

function run(cmd, args, what, env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true, env: env ? { ...process.env, ...env } : process.env });
  if (r.error || r.status !== 0) throw new Error(`${what}失败（${r.error ? r.error.message : `退出码 ${r.status}`}）：${cmd} ${args.join(' ')}`);
}

/** Markdown bullet → plain text (bold markers and links dropped). */
const plain = (md) => md.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/** Where Tauri builds cache NSIS; used as the default makensis when it exists. */
export function tauriMakensis(env = process.env) {
  return env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'tauri', 'NSIS', 'makensis.exe') : '';
}

/**
 * The makensis to use: --makensis, SP_MAKENSIS, the Tauri cache, in that order. An explicit choice that does not
 * exist is an error (not a silent download); null means "download the pinned NSIS".
 */
export function chooseMakensis({ flag = '', env = process.env, exists = fs.existsSync } = {}) {
  const explicit = flag || env.SP_MAKENSIS || '';
  if (explicit) {
    if (!exists(explicit)) throw new Error(`指定的 makensis 不存在：${explicit}`);
    return explicit;
  }
  const tauri = tauriMakensis(env);
  return tauri && exists(tauri) ? tauri : null;
}

/** makensis must be NSIS 3 (Unicode, MUI2 with SimpChinese); returns its version string. */
function makensisVersion(makensis) {
  const r = spawnSync(makensis, ['-VERSION'], { encoding: 'utf8', windowsHide: true });
  const v = `${r.stdout || ''}`.trim();
  if (r.error || r.status !== 0 || !/^v3\./.test(v)) throw new Error(`需要 NSIS 3 的 makensis：${makensis}（${r.error?.message || v || `退出码 ${r.status}`}）`);
  return v;
}

/** The text of the installers' notice page (MSI license dialog, NSIS license page). */
export function installerNotice() {
  return [
    '卫戍协议：工坊 · 使用前须知',
    '安装后在这台电脑上开服，并在浏览器里游玩。首次启动需要联网下载游戏资源，窗口会显示下载进度；下载完成后可以离线游玩。',
    ...noticePoints({ lite: true }).map((p) => `• ${plain(p)}`),
    '本程序自己编写的代码按 GPL-3.0-or-later 授权，全文见安装目录里的 LICENSE；内置 Node.js 等第三方组件的许可见 THIRD-PARTY-NOTICES.md。',
    '工坊存档保存在 %LOCALAPPDATA%\\Stronghold-Protocol-Workshop，卸载时保留；游戏下载的资源随卸载一起删除。',
  ];
}

/** Paragraphs → RTF (non-ASCII as \uN escapes, so the file itself is plain ASCII). */
export function toRtf(paragraphs) {
  const esc = (s) => s.replace(/[\\{}]/g, '\\$&')
    .replace(/[^\x00-\x7f]/g, (ch) => { const n = ch.charCodeAt(0); return `\\u${n > 32767 ? n - 65536 : n}?`; });
  const body = paragraphs.map((p, i) => (i === 0 ? `{\\b ${esc(p)}}` : esc(p))).join('\\par\\par\r\n');
  return `{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei;}}\r\n\\viewkind4\\uc1\\pard\\f0\\fs18 ${body}\\par\r\n}\r\n`;
}

/**
 * NSIS include: the macro that removes the payload's top-level entries (uninstall, and before an upgrade).
 * Generated from the actual payload so a new top-level file cannot be left behind by the uninstaller.
 */
export function payloadNsh(entries) {
  const nsis = (name) => name.replace(/\$/g, '$$$$');
  const lines = entries.map((e) => (e.dir ? `  RMDir /r "$INSTDIR\\${nsis(e.name)}"` : `  Delete "$INSTDIR\\${nsis(e.name)}"`));
  return `\ufeff; Generated by scripts/make-windows-installers.mjs from the payload's top level.\r\n!macro RemovePayloadRoot\r\n${lines.join('\r\n')}\r\n!macroend\r\n`;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function listTree(dir, rel = '') {
  const out = [];
  const entries = (await fsp.readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { out.push({ rel: r, dir: true }); out.push(...await listTree(dir, r)); }
    else if (e.isFile()) out.push({ rel: r, dir: false });
    else throw new Error(`打包目录里有既不是文件也不是目录的条目：${path.join(dir, r)}`);
  }
  return out;
}

/**
 * Zip `srcDir` as `<top>/…` with UTF-8 names (general purpose flag bit 11, so 启动游戏.exe unpacks with its name).
 * Plain zip without zip64: the bundle is far below 4 GB and 65535 entries, which is checked.
 */
export async function writeZip(srcDir, zipPath, top) {
  const crcOf = typeof zlib.crc32 === 'function' ? (b) => zlib.crc32(b) : (b) => crc32(b);
  const items = [{ rel: '', dir: true }, ...await listTree(srcDir)];
  if (items.length > 0xffff) throw new Error(`zip 条目太多（${items.length}）`);
  const part = `${zipPath}.part`;
  const fd = await fsp.open(part, 'w');
  const central = [];
  let offset = 0;
  try {
    for (const item of items) {
      const abs = path.join(srcDir, item.rel);
      const st = await fsp.stat(abs);
      const name = Buffer.from(item.dir ? `${top}/${item.rel ? `${item.rel}/` : ''}` : `${top}/${item.rel}`, 'utf8');
      let data = Buffer.alloc(0); let method = 0; let crc = 0; let size = 0;
      if (!item.dir) {
        const raw = await fsp.readFile(abs);
        const deflated = zlib.deflateRawSync(raw, { level: 9 });
        crc = crcOf(raw); size = raw.length;
        if (deflated.length < raw.length) { data = deflated; method = 8; } else { data = raw; }
      }
      const { time, date } = dosDateTime(st.mtime);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
      await fd.write(local); await fd.write(name); if (data.length) await fd.write(data);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
      cd.writeUInt16LE(method, 10); cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(size, 24);
      cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(item.dir ? 0x10 : 0x20, 38); cd.writeUInt32LE(offset, 42);
      central.push(cd, name);
      offset += local.length + name.length + data.length;
      if (offset > 0xffffffff) throw new Error('zip 超过 4 GB，需要 zip64');
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
    end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
    await fd.write(cdBuf); await fd.write(end);
  } finally {
    await fd.close();
  }
  await fsp.rename(part, zipPath);
  return { entries: items.length };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  if (!IS_WIN) { console.error('✖ 只能在 Windows 上生成（启动器用系统自带的 csc.exe 编译，makensis 也是 Windows 程序）。'); return 1; }

  const version = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
  const msiVersion = numericVersion(version);
  const names = artifactNames(version);
  const out = path.resolve(o.out || path.join(path.dirname(ROOT), 'Stronghold-Protocol-Windows-Installers'));
  if (outDirIsUnsafe(out)) { console.error(`✖ --out 不能指向仓库本身或它的上级目录：${out}`); return 1; }
  const cacheDir = path.resolve(o.cache || path.join(ROOT, '.cache', 'windows-installer-tools'));
  const stage = path.join(out, '.stage');
  console.log(`\n卫戍协议：工坊 · Windows 安装包 ${version}（MSI ProductVersion ${msiVersion}）\n  源仓库：${ROOT}\n  产物：  ${out}\n`);

  const dotnetMajor = dotnetRuntimeMajor();
  if (dotnetMajor < 6) { console.error('✖ 需要 PATH 里的 dotnet 和 .NET 6 或更高的运行时来运行 WiX 5（https://dotnet.microsoft.com/download）。'); return 1; }

  await fsp.mkdir(out, { recursive: true });
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });

  // 1) Payload: the lite bundle (launcher compiled with the bundle)
  let bundle = o.bundle ? path.resolve(o.bundle) : path.join(stage, ZIP_TOP);
  if (o.bundle) {
    if (!fs.existsSync(path.join(bundle, '启动游戏.exe')) || !fs.existsSync(path.join(bundle, 'app'))) {
      console.error(`✖ --bundle 不是轻量包目录（缺少 启动游戏.exe 或 app\\）：${bundle}`); return 1;
    }
    console.log(`  · 使用已有的轻量包：${bundle}`);
  } else {
    console.log('  · 生成轻量包（make-windows-bundle.mjs --lite）…');
    run(process.execPath, [path.join(ROOT, 'scripts', 'make-windows-bundle.mjs'), '--lite', '--out', bundle], '生成轻量包');
  }
  const batch = await findBatchFiles(bundle);
  if (batch.length) { console.error(`✖ 运行包里不能有 .bat / .cmd：${batch.join('、')}（${bundle}）`); return 1; }
  const top = (await fsp.readdir(bundle, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() }));

  // 2) Tools
  const toolDir = path.join(stage, 'tools');
  let makensis = chooseMakensis({ flag: o.makensis });
  if (!makensis) {
    console.log('  · 这台电脑没有可用的 NSIS，下载固定版本 NSIS 3.11（校验 SHA-256）…');
    const nsis = await unpackTool(await fetchTool(TOOLS.nsis, cacheDir), path.join(toolDir, 'nsis'));
    makensis = path.join(nsis, 'nsis-3.11', 'makensis.exe');
  }
  console.log(`  · NSIS：${makensis}（${makensisVersion(makensis)}）`);
  console.log('  · 准备 WiX 5.0.2（固定版本，校验 SHA-256）…');
  const wix = await unpackTool(await fetchTool(TOOLS.wix, cacheDir), path.join(toolDir, 'wix'));
  const wixUi = await unpackTool(await fetchTool(TOOLS.wixUi, cacheDir), path.join(toolDir, 'wix-ui'));
  const wixUtil = await unpackTool(await fetchTool(TOOLS.wixUtil, cacheDir), path.join(toolDir, 'wix-util'));
  const wixDll = path.join(wix, 'tools', 'net6.0', 'any', 'wix.dll');
  if (!fs.existsSync(wixDll)) throw new Error(`工具包里没有 ${wixDll}`);

  // 3) Shared inputs
  const icon = path.join(stage, 'workshop.ico');
  const license = path.join(stage, 'notice.rtf');
  const nsh = path.join(stage, 'payload.nsh');
  await fsp.writeFile(icon, workshopIco());
  await fsp.writeFile(license, toRtf(installerNotice()), 'ascii');
  await fsp.writeFile(nsh, payloadNsh(top), 'utf8');

  // 4) zip
  const zipPath = path.join(out, names.zip);
  console.log(`  · 压缩 ${names.zip} …`);
  const zip = await writeZip(bundle, zipPath, ZIP_TOP);
  console.log(`    完成：${zip.entries} 个条目`);

  // 5) MSI
  const msiPath = path.join(out, names.msi);
  console.log(`  · WiX 生成 ${names.msi} …`);
  await fsp.rm(msiPath, { force: true });
  run('dotnet', [wixDll, 'build', '-nologo', '-arch', 'x64', '-culture', 'zh-CN', '-pdbtype', 'none',
    '-ext', path.join(wixUi, 'wixext5', 'WixToolset.UI.wixext.dll'),
    '-ext', path.join(wixUtil, 'wixext5', 'WixToolset.Util.wixext.dll'),
    '-d', `Version=${msiVersion}`, '-d', `DisplayVersion=${version}`, '-d', `PayloadDir=${bundle}`,
    '-d', `IconFile=${icon}`, '-d', `LicenseRtf=${license}`,
    '-intermediatefolder', path.join(stage, 'wix-obj'), '-out', msiPath, WXS], 'WiX 生成 MSI',
  { DOTNET_ROLL_FORWARD: 'Major', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' });

  // 6) exe setup
  const exePath = path.join(out, names.exe);
  console.log(`  · NSIS 生成 ${names.exe} …`);
  await fsp.rm(exePath, { force: true });
  run(makensis, ['/V2', '/INPUTCHARSET', 'UTF8', `/DVERSION=${version}`, `/DVERSION_NUMERIC=${msiVersion}`,
    `/DPAYLOAD=${bundle}`, `/DPAYLOAD_NSH=${nsh}`, `/DICON=${icon}`, `/DLICENSE=${license}`, `/DOUTFILE=${exePath}`, NSI], 'NSIS 生成安装程序');

  // 7) Checksums and summary
  const files = [zipPath, msiPath, exePath];
  const sums = files.map((f) => ({ f, sha: sha256File(f), size: fs.statSync(f).size }));
  const sumsPath = path.join(out, 'SHA256SUMS.txt');
  await fsp.writeFile(sumsPath, sums.map((s) => `${s.sha}  ${path.basename(s.f)}`).join('\n') + '\n', 'utf8');
  if (!o.keepStage) await fsp.rm(stage, { recursive: true, force: true });

  console.log('\n✔ 生成完成：');
  for (const s of sums) console.log(`  ${s.f}\n    ${MB(s.size)}  SHA-256 ${s.sha}`);
  console.log(`  ${sumsPath}（校验和）`);
  if (o.keepStage) console.log(`  ${stage}（中间文件，--keep-stage 保留）`);
  return 0;
}

function isMain() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isMain()) main().then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });