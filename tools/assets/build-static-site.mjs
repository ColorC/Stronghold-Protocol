#!/usr/bin/env node
// Assemble the browser-visible, version-pinned static package for an external GET origin.
// This tool copies only the static allow-list. It never copies server/API/session/runtime data.

import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HELP = `Usage: node tools/assets/build-static-site.mjs --source-root=<canonical checkout> --out=<new absolute directory> [--revision=<git commit>] [--base-path=/<prefix>/<commit>] [--resource-root=<canonical public directory>] [--data-root=<canonical rules directory>] [--local-assets=<canonical manifest file>]

Builds <out>/<full-git-commit>/{js,css,vendor,fonts,assets,data,shared,sim,media} and Pages _headers.
The source checkout must be clean for tracked static code/data. Generated assets are read from --resource-root
when supplied or from the source checkout; data/local-assets.json is read from --local-assets or source checkout.
Allow-listed rule JSON is read from --data-root or source checkout/data. No network, deploy, or push occurs.`;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20_000;
const DATA_FILES = new Set([
  'assets.json', 'bands.json', 'bonds.json', 'bosses.json', 'chess.json', 'choices.json', 'config.json',
  'effects.json', 'emotes.json', 'enemies.json', 'factions.json', 'garrisons.json', 'independent-design.json',
  'independent-game-text.json', 'items.json', 'local-assets.json', 'stages.json', 'tokens.json', 'tuning.json', 'waves.json',
]);
const EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav']);

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    const i = arg.indexOf('=');
    if (i < 0) throw new Error(`unknown option: ${arg}`);
    const key = arg.slice(0, i), value = arg.slice(i + 1);
    if (!['--source-root', '--out', '--revision', '--base-path', '--resource-root', '--data-root', '--local-assets'].includes(key) || !value) throw new Error(`invalid option: ${arg}`);
    opts[key.slice(2)] = value;
  }
  if (!opts.help && (!opts['source-root'] || !opts.out)) throw new Error('both --source-root and --out are required');
  return opts;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function normalizeBasePath(value, revision) {
  const base = value || `/${revision}`;
  if (!base.startsWith('/') || base.startsWith('//') || base.includes('\\') || /[?#%\s]/.test(base)) {
    throw new Error('--base-path must be a plain absolute URL path without escapes, query, or fragment');
  }
  const parts = base.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..') || parts.at(-1).toLowerCase() !== revision.toLowerCase()) {
    throw new Error('--base-path must end in the full source Git commit');
  }
  return `/${parts.join('/')}`;
}

function versionAbsoluteStaticUrls(text, basePath, ext, relativeFile) {
  if (ext === '.css') {
    // Generated font CSS uses root-absolute /fonts URLs. Relative URLs preserve the version prefix after the CDN redirect.
    return text.replace(/([("'])\/(fonts|assets)\//g, `$1${basePath}/$2/`);
  }
  if (ext !== '.js' && ext !== '.mjs') return text;
  // Dynamic ESM imports resolve from the importing module URL. Prefix only quoted, root-absolute static module paths.
  // Ordinary strings belong to the page context (asset manifests, fetch URLs, MEDIA_PREFIX). Preserve them.
  // ESM import specifiers alone resolve from the module's CDN URL.
  return text.replace(/(\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)(["'`])([^"'`]*?)\2/g,
    (original, lead, quote, specifier) => {
      if ((!specifier.startsWith('.') && !specifier.startsWith('/')) || specifier.includes('${')) return original;
      // Resolve against the original public URL layout first. ../../../shared from /js/ui is /shared;
      // resolving it after adding /<commit> would escape that immutable prefix.
      const resolved = new URL(specifier, `https://static.invalid/${relativeFile}`);
      return `${lead}${quote}${basePath}${resolved.pathname}${resolved.search}${resolved.hash}${quote}`;
    });
}

async function walkFiles(root, rel = '') {
  const abs = path.join(root, rel);
  const info = await lstat(abs);
  if (info.isSymbolicLink() || info.isReparsePoint?.()) throw new Error(`reparse point is not allowed in static input: ${abs}`);
  if (info.isFile()) return [rel.replaceAll(path.sep, '/')];
  if (!info.isDirectory()) throw new Error(`not a regular file or directory: ${abs}`);
  const out = [];
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    const childInfo = await lstat(path.join(root, child));
    if (childInfo.isSymbolicLink() || childInfo.isReparsePoint?.()) throw new Error(`reparse point is not allowed in static input: ${path.join(root, child)}`);
    if (childInfo.isDirectory()) out.push(...await walkFiles(root, child));
    else if (childInfo.isFile()) out.push(child.replaceAll(path.sep, '/'));
    else throw new Error(`not a regular file: ${path.join(root, child)}`);
  }
  return out;
}

function trackedFiles(root, prefix, suffix = null) {
  return git(root, 'ls-files', '-z', '--', prefix).split('\0').filter(Boolean)
    .map((p) => p.replaceAll('\\', '/'))
    .filter((p) => !suffix || p.toLowerCase().endsWith(suffix));
}

async function ensureNoReparseAncestors(target) {
  const root = path.parse(target).root;
  let current = root;
  for (const part of target.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || info.isReparsePoint?.()) throw new Error(`reparse point in output path: ${current}`);
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  const sourceRoot = path.resolve(opts['source-root']);
  const outputRoot = path.resolve(opts.out);
  if (!path.isAbsolute(opts['source-root']) || !path.isAbsolute(opts.out)
      || (opts['resource-root'] && !path.isAbsolute(opts['resource-root']))
      || (opts['data-root'] && !path.isAbsolute(opts['data-root']))
      || (opts['local-assets'] && !path.isAbsolute(opts['local-assets']))) {
    throw new Error('--source-root, --out, --resource-root, --data-root and --local-assets paths must be absolute');
  }
  const resourceRoot = path.resolve(opts['resource-root'] || path.join(sourceRoot, 'public'));
  const dataRoot = path.resolve(opts['data-root'] || path.join(sourceRoot, 'data'));
  const localAssetsPath = path.resolve(opts['local-assets'] || path.join(sourceRoot, 'data', 'local-assets.json'));
  if (!existsSync(path.join(sourceRoot, '.git')) && !existsSync(path.join(sourceRoot, '.git', 'worktrees'))) throw new Error(`not a Git checkout: ${sourceRoot}`);
  const revision = opts.revision || git(sourceRoot, 'rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error('--revision must be a full 40-character Git commit');
  const actual = git(sourceRoot, 'rev-parse', 'HEAD');
  if (actual.toLowerCase() !== revision.toLowerCase()) throw new Error(`source checkout is ${actual}; requested ${revision}`);
  const { DATA_SHIM_JS } = await import(pathToFileURL(path.join(sourceRoot, 'server', 'index.js')).href);
  if (existsSync(outputRoot)) throw new Error(`output already exists; choose a new runtime batch path: ${outputRoot}`);
  await ensureNoReparseAncestors(outputRoot);
  await ensureNoReparseAncestors(sourceRoot);
  await ensureNoReparseAncestors(resourceRoot);
  const resourceRootInfo = await lstat(resourceRoot);
  if (!resourceRootInfo.isDirectory() || resourceRootInfo.isSymbolicLink() || resourceRootInfo.isReparsePoint?.()) {
    throw new Error(`resource root must be a plain directory: ${resourceRoot}`);
  }
  if (opts['data-root'] || existsSync(dataRoot)) {
    await ensureNoReparseAncestors(dataRoot);
    let dataRootInfo;
    try { dataRootInfo = await lstat(dataRoot); }
    catch (err) {
      if (err.code === 'ENOENT') throw new Error(`data root must be an existing plain directory: ${dataRoot}`);
      throw err;
    }
    if (!dataRootInfo.isDirectory() || dataRootInfo.isSymbolicLink() || dataRootInfo.isReparsePoint?.()) {
      throw new Error(`data root must be a plain directory: ${dataRoot}`);
    }
  }
  const hasLocalAssets = existsSync(localAssetsPath);
  if (opts['local-assets'] && !hasLocalAssets) throw new Error(`local assets manifest is missing: ${localAssetsPath}`);
  if (hasLocalAssets) {
    await ensureNoReparseAncestors(localAssetsPath);
    const localAssetsInfo = await lstat(localAssetsPath);
    if (!localAssetsInfo.isFile() || localAssetsInfo.isSymbolicLink() || localAssetsInfo.isReparsePoint?.()) {
      throw new Error(`local assets manifest must be a plain file: ${localAssetsPath}`);
    }
  }

  const trackedStatic = [
    ...trackedFiles(sourceRoot, 'public/js/').map((p) => ({ source: p, target: p.replace(/^public\//, '') })),
    ...trackedFiles(sourceRoot, 'public/css/').map((p) => ({ source: p, target: p.replace(/^public\//, '') })),
    ...trackedFiles(sourceRoot, 'shared/'),
    ...trackedFiles(sourceRoot, 'server/sim/').filter((p) => p.toLowerCase().endsWith('.js') && path.posix.basename(p).toLowerCase() !== 'nodedata.js')
      .map((p) => ({ source: p, target: p.replace(/^server\/sim\//, 'sim/') })),
    ...[...DATA_FILES].filter((name) => name !== 'local-assets.json' && existsSync(path.join(dataRoot, name)))
      .map((name) => ({ source: `data/${name}`, externalInput: path.join(dataRoot, name), target: `data/${name}` })),
  ].map((entry) => typeof entry === 'string' ? ({ source: entry, target: entry }) : entry);
  if (hasLocalAssets) trackedStatic.push({ source: 'data/local-assets.json', externalInput: localAssetsPath, target: 'data/local-assets.json' });
  const engineRel = 'public/js/independent/engine';
  const enginePath = path.join(sourceRoot, engineRel);
  const needsEngine = existsSync(path.join(sourceRoot, 'public/js/independent/client-worker.js'));
  let engineBuild = null;
  if (needsEngine || existsSync(enginePath)) {
    if (!existsSync(enginePath)) throw new Error(`generate the client engine before packaging: ${enginePath}`);
    engineBuild = JSON.parse(await readFile(path.join(enginePath, 'engine-build.json'), 'utf8'));
    if (engineBuild.sourceRevision !== revision || engineBuild.sourceDirty) throw new Error('client engine must be generated from the same clean Git commit as the static package');
    for (const rel of await walkFiles(enginePath)) {
      if (!rel.endsWith('.js') && rel !== 'engine-build.json') throw new Error(`unexpected generated engine file: ${rel}`);
      trackedStatic.push({ source: `${engineRel}/${rel}`, target: `js/independent/engine/${rel}` });
    }
  }
  for (const prefix of ['public/js/', 'public/css/', 'shared/', 'server/sim/', 'data/']) {
    const dirty = git(sourceRoot, 'status', '--porcelain', '--untracked-files=no', '--', prefix);
    if (dirty) throw new Error(`tracked static source has local modifications under ${prefix}; build from its committed checkout`);
  }

  const basePath = normalizeBasePath(opts['base-path'], revision);
  const staticRoot = path.join(outputRoot, ...basePath.slice(1).split('/'));
  await mkdir(staticRoot, { recursive: true });
  const stats = { files: 0, bytes: 0, byTopDir: {}, oversized: [], maxFileBytes: 0 };
  const copies = [...trackedStatic];
  for (const [src, dest] of [
    ['assets', 'assets'], ['fonts', 'fonts'], ['vendor', 'vendor'],
  ]) {
    const abs = path.join(resourceRoot, src);
    if (!existsSync(abs)) throw new Error(`required static source directory is missing: ${abs}`);
    const files = await walkFiles(abs);
    for (const rel of files) copies.push({ target: `${dest}/${rel}` });
    // Keep each selected ignored tree's full path while reading from its canonical location.
  }
  const seen = new Set();
  for (const { target } of copies) {
    if (seen.has(target)) throw new Error(`duplicate static path: ${target}`);
    seen.add(target);
  }

  for (const { source: sourceRel, externalInput, target: rel } of trackedStatic) {
    const source = sourceRel === 'data/local-assets.json' && hasLocalAssets
      ? localAssetsPath
      : externalInput || path.join(sourceRoot, ...sourceRel.split('/'));
    const dest = path.join(staticRoot, ...rel.split('/'));
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || info.isReparsePoint?.()) throw new Error(`static input must be a plain file: ${source}`);
    await mkdir(path.dirname(dest), { recursive: true });
    const ext = path.extname(rel).toLowerCase();
    if (ext === '.js' || ext === '.mjs' || ext === '.css') {
      const sourceText = await readFile(source, 'utf8');
      await writeFile(dest, versionAbsoluteStaticUrls(sourceText, basePath, ext, rel), { flag: 'wx' });
    } else await cp(source, dest, { errorOnExist: true, force: false, dereference: false });
    const emittedBytes = (await lstat(dest)).size;
    stats.files++;
    stats.bytes += emittedBytes;
    stats.maxFileBytes = Math.max(stats.maxFileBytes, emittedBytes);
    stats.byTopDir[rel.split('/')[0]] = (stats.byTopDir[rel.split('/')[0]] || 0) + emittedBytes;
    if (emittedBytes > MAX_FILE_BYTES) stats.oversized.push({ path: rel, bytes: emittedBytes });
  }
  for (const [src, dest] of [['assets', 'assets'], ['fonts', 'fonts'], ['vendor', 'vendor']]) {
    for (const rel of await walkFiles(path.join(resourceRoot, src))) {
      const target = `${dest}/${rel}`;
      const abs = path.join(resourceRoot, src, ...rel.split('/'));
      const info = await lstat(abs);
      const out = path.join(staticRoot, ...target.split('/'));
      await mkdir(path.dirname(out), { recursive: true });
      const ext = path.extname(target).toLowerCase();
      if (ext === '.js' || ext === '.mjs' || ext === '.css') {
        const sourceText = await readFile(abs, 'utf8');
        await writeFile(out, versionAbsoluteStaticUrls(sourceText, basePath, ext, target), { flag: 'wx' });
      } else await cp(abs, out, { errorOnExist: true, force: false, dereference: false });
      const emittedBytes = (await lstat(out)).size;
      stats.files++;
      stats.bytes += emittedBytes;
      stats.maxFileBytes = Math.max(stats.maxFileBytes, emittedBytes);
      stats.byTopDir[dest] = (stats.byTopDir[dest] || 0) + emittedBytes;
      if (emittedBytes > MAX_FILE_BYTES) stats.oversized.push({ path: target, bytes: emittedBytes });
    }
  }

  // server/index.js owns the canonical browser shim; copy only its generated body, never server code.
  const shimPath = path.join(staticRoot, 'data.js');
  await writeFile(shimPath, DATA_SHIM_JS, { flag: 'wx' });
  const shimBytes = Buffer.byteLength(DATA_SHIM_JS);
    stats.files++;
    stats.bytes += shimBytes;
    stats.maxFileBytes = Math.max(stats.maxFileBytes, shimBytes);
  stats.byTopDir.dataJs = shimBytes;

  // The browser asks /media/<audio-relative-path-without-extension>. Copy the MP3 bytes under that path,
  // preserving the extensionless route and MIME type that suppresses download-manager popups.
  const audioRoot = path.join(resourceRoot, 'assets', 'audio');
  const audioFiles = await walkFiles(audioRoot);
  for (const rel of audioFiles) {
    const ext = path.posix.extname(rel).toLowerCase();
    if (!EXTENSIONS.has(ext)) throw new Error(`unsupported media extension for /media aliases: ${rel}`);
    const source = path.join(audioRoot, ...rel.split('/'));
    const info = await lstat(source);
    const alias = path.join(staticRoot, 'media', ...rel.split('/').slice(0, -1), path.posix.basename(rel, path.posix.extname(rel)));
    await mkdir(path.dirname(alias), { recursive: true });
    await cp(source, alias, { errorOnExist: true, force: false, dereference: false });
    stats.files++;
    stats.bytes += info.size;
    stats.maxFileBytes = Math.max(stats.maxFileBytes, info.size);
    stats.byTopDir.media = (stats.byTopDir.media || 0) + info.size;
    if (info.size > MAX_FILE_BYTES) stats.oversized.push({ path: `media/${rel}`, bytes: info.size });
  }

  if (stats.files + 1 > MAX_FILES) throw new Error(`Pages Wrangler upload limit exceeded: ${stats.files + 1} files > ${MAX_FILES}`);
  if (stats.oversized.length) throw new Error(`Pages single-file limit exceeded: ${JSON.stringify(stats.oversized)}`);
  const mediaTypes = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav' };
  const mediaExtensions = [...new Set(audioFiles.map((rel) => path.posix.extname(rel).toLowerCase()))];
  if (mediaExtensions.length !== 1) throw new Error(`extensionless /media aliases need one consistent MIME type; found ${mediaExtensions.join(', ')}`);
  const headers = `${basePath}/*\n  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin\n  Cache-Control: public, max-age=31536000, immutable\n` +
    `\n${basePath}/media/*\n  Content-Type: ${mediaTypes[mediaExtensions[0]]}\n`;
  await writeFile(path.join(outputRoot, '_headers'), headers, { flag: 'wx' });
  stats.files++; // static-build.json is uploaded; Pages parses but does not serve/count _headers as an asset.
  const report = {
    version: 1,
    sourceRevision: revision,
    resourceRoot,
    dataRoot,
    localAssetsPath: hasLocalAssets ? localAssetsPath : null,
    clientEngineRevision: engineBuild?.sourceRevision || null,
    immutablePrefix: `${basePath}/`,
    files: stats.files,
    bytes: stats.bytes,
    maxSingleFileBytes: stats.maxFileBytes,
    byTopDir: stats.byTopDir,
    mediaAliasFiles: audioFiles.length,
    mediaAliasBytes: stats.byTopDir.media || 0,
    limits: { provider: 'Cloudflare Pages Free Wrangler direct upload', files: MAX_FILES, fileBytes: MAX_FILE_BYTES },
    generatedFiles: ['_headers', `${revision}/data.js`],
    excluded: ['index.html', 'public/dev/**', 'server/** except browser /sim/** and generated data.js shim', 'server/data.js', 'sim/nodedata.js', 'runtime/**', 'session data', 'private docs'],
  };
  await writeFile(path.join(outputRoot, 'static-build.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  stats.files++;
  console.log(JSON.stringify({ outputRoot, staticRoot, revision, ...report }, null, 2));
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error(`[static-build] ${err.message}`);
  process.exitCode = 1;
});
