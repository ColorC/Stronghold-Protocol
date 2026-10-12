// test/windows-installers.test.js — Windows 启动器与安装包脚本里「写错就会发出坏包」的部分。
//
// 真正的 MSI / exe 要下载 WiX、NSIS 并且只能在 Windows 上生成，不放进单元测试；这里盯住：
//   * 版本号换成 Windows 四段数字（MSI ProductVersion、exe 文件版本）；
//   * 启动器：编进 exe 的参数与版本、Windows 上真编译一次并检查参数原样传给 launch.mjs、非零退出码原样返回；
//   * zip：UTF-8 文件名标记、顶层目录、内容可以原样解出；
//   * 安装包的须知页（RTF 纯 ASCII、带全部声明要点）与卸载清单（只删包里顶层的条目）；
//   * 图标：.ico 目录与 256 像素 PNG。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const IS_WIN = process.platform === 'win32';

describe('Windows 版本号', () => {
  test('预发布序号进第四段；普通版本补 0；写不成四段数字就报错', async () => {
    const { numericVersion } = await mod('scripts/make-windows-bundle.mjs');
    assert.equal(numericVersion('0.3.0-workshop.1'), '0.3.0.1');
    assert.equal(numericVersion('1.2.3'), '1.2.3.0');
    assert.equal(numericVersion('0.3.0-workshop.12'), '0.3.0.12');
    assert.throws(() => numericVersion('0.3.0-workshop'), /四段数字/);
    assert.throws(() => numericVersion('latest'), /四段数字/);
    assert.throws(() => numericVersion('256.0.0'), /范围/, 'MSI 主版本号最大 255');
  });
});

describe('启动器 启动游戏.exe', () => {
  test('BuildInfo 带上启动参数与两种版本号，字符串按 C# 转义', async () => {
    const { launcherBuildInfo } = await mod('scripts/make-windows-bundle.mjs');
    const cs = launcherBuildInfo({ launchArgs: ['--workshop', 'a"b\\c'], version: '0.3.0-workshop.1' });
    assert.match(cs, /AssemblyVersion\("0\.3\.0\.1"\)/);
    assert.match(cs, /AssemblyInformationalVersion\("0\.3\.0-workshop\.1"\)/);
    assert.ok(cs.includes('LaunchArguments = { "--workshop", "a\\"b\\\\c" }'), cs);
  });

  test('包内说明让玩家双击 exe，不再出现 .bat', async () => {
    const { bundleReadme } = await mod('scripts/make-windows-bundle.mjs');
    for (const lite of [true, false]) {
      const r = bundleReadme({ version: 'v22.23.3', withNode: true, lite });
      assert.match(r, /双击 `启动游戏\.exe`/);
      assert.doesNotMatch(r, /\.bat/);
      assert.match(r, /仍要运行/, '没有代码签名，要告诉玩家 SmartScreen 怎么放行');
      assert.match(r, /%LOCALAPPDATA%\\Stronghold-Protocol-Workshop/, '存档位置要写清');
    }
  });

  test('找到 Windows 自带的 csc.exe（Framework64 优先），找不到时返回 null', async () => {
    const { findCsc } = await mod('scripts/make-windows-bundle.mjs');
    const exists = (p) => /Framework64/.test(p);
    assert.equal(findCsc({ env: { SystemRoot: 'C:\\Windows' }, exists }), 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe');
    assert.equal(findCsc({ env: { SystemRoot: 'C:\\Windows' }, exists: () => false }), null);
  });

  test('编译后：参数原样传给 launch.mjs，存档目录变量不被覆盖，退出码原样返回', { skip: !IS_WIN }, async () => {
    const { compileLauncher } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-launcher-test-'));
    try {
      const exe = path.join(base, '启动游戏.exe');
      await compileLauncher(exe, { launchArgs: ['--workshop'], version: '0.3.0-workshop.1' });

      // 没有 app\ 时提示解压，退出码 1（stdin 不是控制台，不等待按键）
      const missing = spawnSync(exe, [], { encoding: 'utf8', input: '' });
      assert.equal(missing.status, 1);
      assert.match(missing.stdout, /没有找到游戏文件/);

      // 假的 launch.mjs 记下收到的参数和环境；没有 node\node.exe 时用 PATH 里的 Node
      const scripts = path.join(base, 'app', 'scripts');
      await fsp.mkdir(scripts, { recursive: true });
      const report = path.join(base, 'report.json');
      await fsp.writeFile(path.join(scripts, 'launch.mjs'), `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ argv: process.argv.slice(2), saves: process.env.SP_INDEPENDENT_DIRECTORY, cwd: process.cwd() }));
process.exit(7);
`);
      const saves = path.join(base, 'saves dir');
      const args = ['--port', '3001', 'a b', 'quote"d', 'trail\\', ''];
      const r = spawnSync(exe, args, { encoding: 'utf8', input: '', env: { ...process.env, SP_INDEPENDENT_DIRECTORY: saves } });
      assert.equal(r.status, 7, `退出码应原样返回：${r.stdout}${r.stderr}`);
      const got = JSON.parse(await fsp.readFile(report, 'utf8'));
      assert.deepEqual(got.argv, ['--workshop', ...args]);
      assert.equal(got.saves, saves, '用户自己设置的存档目录优先');
      assert.equal(path.resolve(got.cwd).toLowerCase(), path.join(base, 'app').toLowerCase());
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

/** Minimal reader for the zips writeZip produces (stored / deflate, no zip64). */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const flags = buf.readUInt16LE(p + 8); const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16); const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    entries.push({ name, flags, crc, data });
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

describe('make-windows-installers.mjs: zip', () => {
  test('UTF-8 文件名、统一顶层目录、目录条目，内容与 CRC 都能原样还原', async () => {
    const { writeZip } = await mod('scripts/make-windows-installers.mjs');
    const { crc32 } = await mod('scripts/windows/icon.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-zip-'));
    try {
      const src = path.join(base, 'src');
      await fsp.mkdir(path.join(src, 'app', 'empty'), { recursive: true });
      const big = Buffer.from('卫戍协议'.repeat(5000));
      await fsp.writeFile(path.join(src, '启动游戏.exe'), Buffer.from([0x4d, 0x5a, 1, 2, 3]));
      await fsp.writeFile(path.join(src, 'app', 'big.txt'), big);
      const zipPath = path.join(base, 'out.zip');
      const { entries } = await writeZip(src, zipPath, 'Top');
      const got = readZip(await fsp.readFile(zipPath));
      assert.equal(got.length, entries);
      assert.deepEqual(got.map((e) => e.name), ['Top/', 'Top/app/', 'Top/app/big.txt', 'Top/app/empty/', 'Top/启动游戏.exe']);
      for (const e of got) assert.equal(e.flags & 0x0800, 0x0800, `${e.name} 要带 UTF-8 标记`);
      const bigEntry = got.find((e) => e.name === 'Top/app/big.txt');
      assert.deepEqual(bigEntry.data, big);
      assert.equal(bigEntry.crc, crc32(big));
      assert.deepEqual(got.find((e) => e.name === 'Top/启动游戏.exe').data, Buffer.from([0x4d, 0x5a, 1, 2, 3]));
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-installers.mjs: 安装包文字与卸载清单', () => {
  test('产物文件名跟随 package.json 版本', async () => {
    const { artifactNames } = await mod('scripts/make-windows-installers.mjs');
    assert.deepEqual(artifactNames('0.3.0-workshop.1'), {
      zip: 'Stronghold-Protocol-Windows-Lite-workshop-v0.3.0-workshop.1.zip',
      msi: 'Stronghold-Protocol-Workshop-0.3.0-workshop.1.msi',
      exe: 'Stronghold-Protocol-Workshop-Setup-0.3.0-workshop.1.exe',
    });
  });

  test('须知页带全部声明要点，RTF 本身是纯 ASCII（中文写成 \\u 转义）', async () => {
    const { installerNotice, toRtf } = await mod('scripts/make-windows-installers.mjs');
    const text = installerNotice().join('\n');
    for (const must of ['非官方同人作品', '版权归原权利人所有', '严禁任何形式的盈利', '单独再分发', '立即删除', '不提供任何担保', 'GPL-3.0-or-later', '卸载时保留']) {
      assert.ok(text.includes(must), must);
    }
    assert.doesNotMatch(text, /\*\*|\]\(/, '不能把 Markdown 记号带进安装界面');
    const rtf = toRtf(['卫戍 {x} a\\b']);
    assert.match(rtf, /^\{\\rtf1/);
    assert.ok(/^[\x00-\x7f]*$/.test(rtf), 'RTF 必须是 ASCII');
    assert.ok(rtf.includes('\\u21355?\\u25101? \\{x\\} a\\\\b'), rtf);
  });

  test('卸载清单只列包里的顶层条目：目录整树删除、文件逐个删除、$ 转义', async () => {
    const { payloadNsh } = await mod('scripts/make-windows-installers.mjs');
    const nsh = payloadNsh([{ name: 'app', dir: true }, { name: '启动游戏.exe', dir: false }, { name: 'a$b.md', dir: false }]);
    assert.ok(nsh.includes('!macro RemovePayloadRoot'));
    assert.ok(nsh.includes('RMDir /r "$INSTDIR\\app"'), nsh);
    assert.ok(nsh.includes('Delete "$INSTDIR\\启动游戏.exe"'), nsh);
    assert.ok(nsh.includes('Delete "$INSTDIR\\a$$b.md"'), nsh);
    assert.doesNotMatch(nsh, /\$INSTDIR"/, '不能出现删除整个安装目录的命令');
  });
});

describe('运行包不带批处理', () => {
  test('跟踪文件里的 .bat / .cmd、开机自启服务脚本、启动器源码都不进包；游戏代码照常进包', async () => {
    const { isPackagedTrackedFile } = await mod('scripts/make-windows-bundle.mjs');
    for (const rel of ['scripts/run-server.cmd', 'scripts/install-service-windows.ps1', 'scripts/start-windows.bat',
      'scripts/start-windows.ps1', 'scripts/windows/launcher.cs', 'tools/x/helper.CMD', 'docs/a.bat', 'test/x.test.js']) {
      assert.equal(isPackagedTrackedFile(rel), false, rel);
    }
    for (const rel of ['scripts/launch.mjs', 'scripts/start.sh', 'server/index.js', 'data/chess.json']) {
      assert.equal(isPackagedTrackedFile(rel), true, rel);
    }
  });

  test('findBatchFiles 找出目录树里任何位置的 .bat / .cmd（大小写不限）', async () => {
    const { findBatchFiles } = await mod('scripts/make-windows-bundle.mjs');
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-batch-'));
    try {
      await fsp.mkdir(path.join(base, 'app', 'node_modules', '.bin'), { recursive: true });
      await fsp.writeFile(path.join(base, '启动游戏.exe'), 'x');
      await fsp.writeFile(path.join(base, 'app', 'node_modules', '.bin', 'nanoid.CMD'), 'x');
      await fsp.writeFile(path.join(base, 'app', 'run.bat'), 'x');
      assert.deepEqual((await findBatchFiles(base)).sort(), [path.join('app', 'node_modules', '.bin', 'nanoid.CMD'), path.join('app', 'run.bat')].sort());
      assert.deepEqual(await findBatchFiles(path.join(base, 'app', 'node_modules')), [path.join('.bin', 'nanoid.CMD')]);
    } finally {
      await fsp.rm(base, { recursive: true, force: true });
    }
  });
});

describe('make-windows-installers.mjs: 用哪个 makensis', () => {
  test('--makensis 优先，其次 SP_MAKENSIS，再次 Tauri 缓存；都没有返回 null（下载固定版本）', async () => {
    const { chooseMakensis, tauriMakensis } = await mod('scripts/make-windows-installers.mjs');
    const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
    const tauri = 'C:\\Users\\u\\AppData\\Local\\tauri\\NSIS\\makensis.exe';
    assert.equal(tauriMakensis(env), tauri);
    const all = () => true;
    assert.equal(chooseMakensis({ flag: 'D:\\nsis\\makensis.exe', env: { ...env, SP_MAKENSIS: 'E:\\m.exe' }, exists: all }), 'D:\\nsis\\makensis.exe');
    assert.equal(chooseMakensis({ env: { ...env, SP_MAKENSIS: 'E:\\m.exe' }, exists: all }), 'E:\\m.exe');
    assert.equal(chooseMakensis({ env, exists: all }), tauri);
    assert.equal(chooseMakensis({ env, exists: () => false }), null);
    assert.throws(() => chooseMakensis({ flag: 'D:\\missing.exe', env, exists: () => false }), /不存在/, '指定了却不存在要报错，不能悄悄下载');
  });
});

describe('Workshop 图标', () => {
  test('.ico 含 16–256 各尺寸，256 用 PNG，其余是 32 位 DIB', async () => {
    const { workshopIco, ICON_SIZES } = await mod('scripts/windows/icon.mjs');
    const ico = workshopIco();
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), ICON_SIZES.length);
    ICON_SIZES.forEach((size, i) => {
      const e = 6 + 16 * i;
      assert.equal(ico[e], size >= 256 ? 0 : size);
      const off = ico.readUInt32LE(e + 12);
      if (size >= 256) assert.deepEqual([...ico.subarray(off, off + 4)], [0x89, 0x50, 0x4e, 0x47]);
      else assert.equal(ico.readUInt32LE(off), 40);
    });
  });
});
