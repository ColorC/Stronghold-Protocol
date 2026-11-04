#!/usr/bin/env node
// Native server release producer. The default control-server archive path remains compatible;
// --assault-plan is RAM-only and --assault-adopt moves only the already-reviewed file plan.
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
function findReleaseProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, 'publish', 'assault', 'code', 'tools', 'check-imports.mjs'))
      && fs.existsSync(path.join(current, 'publish', 'assault', 'code', 'server', 'packs.js'))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`cannot locate registered Assault release project from ${start}`);
    current = parent;
  }
}
let root, helperTools, helperServer;
if (fs.existsSync(path.join(scriptDirectory, 'check-imports.mjs'))
  && fs.existsSync(path.join(scriptDirectory, '..', 'server', 'packs.js'))) {
  helperTools = scriptDirectory;
  helperServer = path.join(scriptDirectory, '..', 'server');
  root = path.resolve(scriptDirectory, '..');
} else {
  // The fixed task-local producer lives outside both native source and release trees.
  // Its dependencies are read from the registered formal module tree, never copied.
  const releaseProjectRoot = findReleaseProjectRoot(scriptDirectory);
  const formalCodeRoot = path.join(releaseProjectRoot, 'publish', 'assault', 'code');
  helperTools = path.join(formalCodeRoot, 'tools');
  helperServer = path.join(formalCodeRoot, 'server');
  root = releaseProjectRoot;
}
const { findSpecifiers } = await import(pathToFileURL(path.join(helperTools, 'check-imports.mjs')).href);
const { scanPacks } = await import(pathToFileURL(path.join(helperServer, 'packs.js')).href);
const CANONICAL_RELEASE_PATHS = Object.freeze({
  code: path.join('publish', 'assault', 'code'),
  rules: path.join('data', 'assault-rules'),
  runtime: path.join('runtime', 'assault'),
});
const ENGINE_FALLBACK_KEYS = Object.freeze([
  'server/data.js', 'server/modes/independent/catalog.js',
]);
const NATIVE_ENGINE_PROOF_SOURCE_SCOPE = Object.freeze([
  'server/sim', 'shared', 'data/assault-runtime.json', 'public/js/assault/client-sim.js',
]);
const ASSAULT_EXTRA_RULES = Object.freeze([
  'assault-assets.json', 'assault-public-text.json', 'assault-runtime.json',
  'independent-design.json', 'independent-game-text.json',
  'assault-design/collectibles.json', 'assault-design/encounters.json',
  'assault-design/events.json', 'assault-design/system.json',
]);
const HTML_EXTERNAL_FALLBACKS = Object.freeze([
  'public/vendor/preact.module.js', 'public/vendor/hooks.module.js', 'public/vendor/htm.module.js',
  'public/vendor/pixi.min.js', 'public/vendor/pixi-spine.js', 'public/fonts/fonts.css',
  'public/vendor/rrweb.css', 'public/vendor/rrweb.umd.js', // structured play recording (installed vendor files, never in Git)
]);

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }).trim();
}

function isGitAncestor(cwd, ancestor, descendant) {
  const result = spawnSync('git', ['-C', cwd, 'merge-base', '--is-ancestor', ancestor, descendant], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`native Git ancestry check failed (${result.status}): ${result.stderr || `${ancestor} -> ${descendant}`}`);
}

function gitBlob(cwd, revision, sourceGitPath) {
  return execFileSync('git', ['-C', cwd, 'show', `${revision}:${sourceGitPath}`], {
    encoding: null, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  });
}

export function readNativeGitBlobBatch(cwd, revision, sourceGitPaths) {
  const uniquePaths = [...new Set(sourceGitPaths)];
  const input = Buffer.from(uniquePaths.map((sourceGitPath) => `${revision}:${sourceGitPath}\n`).join(''), 'utf8');
  const output = execFileSync('git', ['-C', cwd, 'cat-file', '--batch'], {
    input, encoding: null, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  });
  const blobs = new Map();
  let offset = 0;
  for (const sourceGitPath of uniquePaths) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error(`native Git batch header missing for ${sourceGitPath}`);
    const header = output.subarray(offset, newline).toString('ascii').trim().split(/\s+/);
    if (header.length !== 3 || !/^[0-9a-f]{40,64}$/i.test(header[0]) || header[1] !== 'blob'
      || !/^(0|[1-9]\d*)$/.test(header[2]))
      throw new Error(`native Git batch did not return a blob for ${sourceGitPath}: ${header.join(' ')}`);
    const byteLength = Number(header[2]);
    if (!Number.isSafeInteger(byteLength)) throw new Error(`native Git blob length is invalid for ${sourceGitPath}`);
    const start = newline + 1;
    const end = start + byteLength;
    if (end >= output.length || output[end] !== 0x0a)
      throw new Error(`native Git batch body boundary is invalid for ${sourceGitPath}`);
    blobs.set(sourceGitPath, output.subarray(start, end));
    offset = end + 1;
  }
  if (offset !== output.length) throw new Error('native Git batch returned unexpected trailing bytes');
  return blobs;
}

function parseOptions(args) {
  const out = new Map();
  const switches = new Set(['--assault-plan', '--assault-adopt', '--assault-repair-from-git', '--assault-update-from-git', '--adopt', '--repin-install-data']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { out.set('help', true); continue; }
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    if (out.has(arg)) throw new Error(`duplicate option: ${arg}`);
    if (switches.has(arg)) { out.set(arg, true); continue; }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    out.set(arg, value); i++;
  }
  return out;
}

function requireAbsolute(value, flag) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${flag} must be an absolute path`);
  return path.resolve(value);
}

function samePath(a, b) {
  const aa = process.platform === 'win32' ? path.resolve(a).toLowerCase() : path.resolve(a);
  const bb = process.platform === 'win32' ? path.resolve(b).toLowerCase() : path.resolve(b);
  return aa === bb;
}

function gitRoot(dir) { return path.resolve(git(dir, 'rev-parse', '--show-toplevel')); }

function assertNoReparse(absPath, { allowMissing = false } = {}) {
  const resolved = path.resolve(absPath);
  const { root: volume } = path.parse(resolved);
  const relative = path.relative(volume, resolved);
  let current = volume;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let st;
    try { st = fs.lstatSync(current, { bigint: true }); }
    catch (error) {
      if (allowMissing && error.code === 'ENOENT') continue;
      throw new Error(`missing path component: ${current}`);
    }
    if (st.isSymbolicLink()) throw new Error(`reparse point is not allowed: ${current}`);
  }
  return resolved;
}

function fileIdentity(absPath, { allowMissing = false } = {}) {
  const p = assertNoReparse(absPath, { allowMissing });
  let st;
  try { st = fs.lstatSync(p, { bigint: true }); }
  catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw error;
  }
  if (!st.isFile()) throw new Error(`expected ordinary file: ${p}`);
  const links = Number(st.nlink); const bytes = Number(st.size);
  if (!Number.isSafeInteger(links) || !Number.isSafeInteger(bytes)) throw new Error(`native file metadata exceeds safe integer range: ${p}`);
  return { device: String(st.dev), fileId: String(st.ino), links, bytes, mtimeNs: String(st.mtimeNs), reparsePoint: false };
}

function nativePathIdentity(absPath) {
  const p = assertNoReparse(absPath);
  const st = fs.lstatSync(p, { bigint: true });
  if (!st.isFile() && !st.isDirectory()) throw new Error(`expected ordinary file or directory: ${p}`);
  const links = Number(st.nlink); const bytes = st.isFile() ? Number(st.size) : 0;
  if (!Number.isSafeInteger(links) || !Number.isSafeInteger(bytes)) throw new Error(`native path metadata exceeds safe integer range: ${p}`);
  return { device: String(st.dev), fileId: String(st.ino), links, bytes, mtimeNs: String(st.mtimeNs), reparsePoint: false };
}

function resolveRelativeModule(sourceRoot, fromRelative, specifier, area) {
  const clean = specifier.split(/[?#]/, 1)[0];
  let relative;
  if (area === 'server' || area === 'root-relative') {
    if (!clean.startsWith('.')) return { external: clean };
    relative = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelative), clean));
  } else {
    if (!clean.startsWith('.') && !clean.startsWith('/')) return { external: clean };
    let virtual = clean.startsWith('.')
      ? path.posix.normalize(path.posix.join('/' + path.posix.dirname(fromRelative.replace(/^public\//, '')), clean))
      : path.posix.normalize(clean);
    if (virtual === '/shared' || virtual.startsWith('/shared/')) relative = virtual.slice(1);
    else if (virtual === '/sim' || virtual.startsWith('/sim/')) relative = `server/sim/${virtual.slice('/sim/'.length)}`;
    else if (virtual === '/data' || virtual.startsWith('/data/')) return { external: 'canonical data mount' };
    else if (virtual.startsWith('/')) relative = `public/${virtual.slice(1)}`;
    else relative = virtual;
  }
  relative = relative.replaceAll('\\', '/');
  if (relative.startsWith('../') || path.posix.isAbsolute(relative)) throw new Error(`module import escapes release root: ${fromRelative} -> ${specifier}`);
  if (area === 'browser' && relative.startsWith('public/js/independent/engine/'))
    return { external: `verified generated engine cache ${relative}` };
  const candidates = path.posix.extname(relative)
    ? [relative]
    : [relative, `${relative}.js`, `${relative}.mjs`, `${relative}.cjs`, `${relative}.json`, `${relative}/index.js`];
  for (const candidate of candidates) {
    const abs = path.join(sourceRoot, ...candidate.split('/'));
    try {
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`module path is a reparse point: ${abs}`);
      if (st.isFile()) return { relative: candidate };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (area === 'browser' && HTML_EXTERNAL_FALLBACKS.includes(relative))
    return { external: `canonical install fallback ${relative}` };
  throw new Error(`unresolved ${area} module import: ${fromRelative} -> ${specifier}`);
}

function addModuleClosure(sourceRoot, entries, area, rows, consumer = area) {
  const seen = new Set();
  const pending = [...entries];
  const external = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (seen.has(relative)) continue;
    seen.add(relative);
    const abs = path.join(sourceRoot, ...relative.split('/'));
    const identity = fileIdentity(abs);
    const previous = rows.get(relative);
    rows.set(relative, { sourceRelative: relative, role: 'logical-code',
      consumers: [...new Set([...(previous?.consumers || []), consumer])], identity });
    const text = fs.readFileSync(abs, 'utf8');
    for (const { spec } of findSpecifiers(text)) {
      // DATA_SHIM_JS in server/http/static.js is a generated browser module embedded
      // in a template string; its import is not a Node-side relative dependency.
      if (relative === 'server/http/static.js' && spec === './sim/simdata.js') continue;
      const resolved = resolveRelativeModule(sourceRoot, relative, spec, area);
      if (resolved.external) {
        if (!resolved.external.startsWith('node:') && !/^(?:assert|buffer|crypto|events|fs|http|https|module|net|os|path|process|stream|timers|url|util|zlib|ws)$/.test(resolved.external)) {
          external.add(resolved.external);
        }
      } else pending.push(resolved.relative);
    }
  }
  return { seen, external };
}

// Assault's Node battle content is selected through import(path) calls driven by
// registry arrays, so static ESM import scanning cannot see the modules. The whole
// server/sim/content tree is the bounded runtime registry pool; include its JS
// candidates and then follow each candidate's ordinary static imports.
export function assaultDynamicContentModulePaths(paths) {
  const prefix = 'server/sim/content/';
  return [...new Set(paths.filter((value) => typeof value === 'string'
    && value.startsWith(prefix) && value.endsWith('.js')))].sort();
}

function listAssaultDynamicContentModules(sourceRoot) {
  const contentRoot = path.join(sourceRoot, 'server', 'sim', 'content');
  const result = [];
  const visit = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Assault dynamic content path is a reparse point: ${absolute}`);
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(absolute, child);
      else if (entry.isFile() && entry.name.endsWith('.js')) result.push(child);
    }
  };
  if (!fs.lstatSync(contentRoot).isDirectory()) throw new Error(`Assault dynamic content root is not a directory: ${contentRoot}`);
  visit(contentRoot, 'server/sim/content');
  return assaultDynamicContentModulePaths(result);
}

export function collectAssaultDynamicContentClosure(sourceRoot, rows = new Map()) {
  const entries = listAssaultDynamicContentModules(sourceRoot);
  if (!entries.includes('server/sim/content/index.js') || !entries.includes('server/sim/content/kits/index.js'))
    throw new Error('Assault Node simulation content registry is missing its runtime entry modules');
  const closure = addModuleClosure(sourceRoot, entries, 'root-relative', rows,
    'Assault Node simulation dynamic content registry');
  return { entries, rows, seen: closure.seen, external: closure.external };
}

function moduleImportMap(html) {
  const m = html.match(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  return m ? (JSON.parse(m[1]).imports || {}) : {};
}

function mapBareSpecifier(imports, spec) {
  if (Object.hasOwn(imports, spec)) return imports[spec];
  const prefix = Object.keys(imports).filter((key) => key.endsWith('/') && spec.startsWith(key)).sort((a, b) => b.length - a.length)[0];
  return prefix ? `${imports[prefix]}${spec.slice(prefix.length)}` : null;
}

function relativeCssReferences(sourceRoot, cssRelative) {
  const css = fs.readFileSync(path.join(sourceRoot, ...cssRelative.split('/')), 'utf8');
  const refs = [];
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const value = match[1].trim();
    if (/^(?:data:|https?:|\/\/|#)/i.test(value) || value.startsWith('%23')) continue;
    const url = new URL(value, `https://release.invalid/${cssRelative.replace(/^public\//, '')}`);
    refs.push(url.pathname.startsWith('/shared/') ? `shared/${url.pathname.slice(8)}`
      : url.pathname.startsWith('/sim/') ? `server/sim/${url.pathname.slice(5)}`
        : `public/${url.pathname.slice(1)}`);
  }
  return refs;
}

function ensureTrackedCommitted(sourceRoot, revision, rels) {
  const status = git(sourceRoot, 'status', '--porcelain', '--untracked-files=no', '--', ...rels);
  if (status) throw new Error(`selected Assault release source must be committed and clean:\n${status}`);
  const tracked = new Set(git(sourceRoot, 'ls-tree', '-r', '--name-only', revision, '--', ...rels).split(/\r?\n/).filter(Boolean));
  for (const rel of rels) if (!tracked.has(rel)) throw new Error(`selected source is not in Git revision ${revision}: ${rel}`);
}

function ensureUnder(rootPath, candidate) {
  const relative = path.relative(rootPath, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path is outside registered root: ${candidate}`);
  }
}

export function assertNativeProofRevisionEquivalent({ canonicalRoot, sourceRoot, sourceRevision, nativeProof }) {
  const proofRevision = nativeProof?.sourceRevision;
  for (const [label, revision] of [['current source', sourceRevision], ['native proof', proofRevision]]) {
    if (!/^[0-9a-f]{40}$/.test(revision || '')) throw new Error(`${label} revision is not a native Git commit`);
    if (git(canonicalRoot, 'cat-file', '-t', revision) !== 'commit')
      throw new Error(`canonical Git cannot recover ${label} commit ${revision}`);
  }
  if (proofRevision === sourceRevision) return { equivalent: true, proofRevision, sourceRevision, comparedPaths: [], changedPaths: [] };
  const paths = new Set(NATIVE_ENGINE_PROOF_SOURCE_SCOPE);
  for (const check of nativeProof.checks || []) {
    if (!String(check.url || '').startsWith('http://127.0.0.1:') || typeof check.sourcePath !== 'string'
      || !/\.m?js$/i.test(check.sourcePath)) continue;
    const abs = path.resolve(check.sourcePath);
    const relative = path.relative(sourceRoot, abs);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`native proof served JS source is outside the release worktree: ${check.sourcePath}`);
    paths.add(relative.split(path.sep).join('/'));
  }
  return assertNativeProofScopedEquivalent({ canonicalRoot, proofRevision, sourceRevision, comparedPaths: [...paths] });
}

export function assertNativeProofScopedEquivalent({ canonicalRoot, proofRevision, sourceRevision, comparedPaths }) {
  for (const [label, revision] of [['native proof', proofRevision], ['requested source', sourceRevision]]) {
    if (!/^[0-9a-f]{40}$/.test(revision || '') || git(canonicalRoot, 'cat-file', '-t', revision) !== 'commit')
      throw new Error(`canonical Git cannot recover ${label} commit ${revision}`);
  }
  const scopedPaths = [...new Set([...NATIVE_ENGINE_PROOF_SOURCE_SCOPE, ...(comparedPaths || [])])].sort();
  const changedPaths = git(canonicalRoot, 'diff', '--name-only', proofRevision, sourceRevision, '--', ...scopedPaths)
    .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (changedPaths.length) throw new Error(`native HTTP proof source closure changed between ${proofRevision} and ${sourceRevision}: ${changedPaths.join(', ')}`);
  return { equivalent: true, proofRevision, sourceRevision, comparedPaths: scopedPaths, changedPaths };
}

function targetRow({ sourceRoot, canonicalRoot, sourceRelative, targetRelative, role, consumers, lifetime }) {
  const source = path.join(sourceRoot, ...sourceRelative.split('/'));
  const target = path.join(canonicalRoot, ...targetRelative.split('/'));
  const identity = fileIdentity(source);
  if (identity.links !== 1) throw new Error(`movable source must have exactly one native file link: ${source} (${identity.links})`);
  ensureUnder(canonicalRoot, target);
  assertNoReparse(target, { allowMissing: true });
  if (fs.existsSync(target)) throw new Error(`Assault release target conflict: ${target}`);
  if (path.parse(source).root.toLowerCase() !== path.parse(target).root.toLowerCase())
    throw new Error(`same-volume adoption required: ${source} -> ${target}`);
  return { source, target, sourceRelative, targetRelative, role, consumers, lifetime, identity, logicalBytes: identity.bytes, adopt: true };
}

function rulesTargetRow({ sourceRoot, canonicalRoot, sourceRelative, targetRelative }) {
  return targetRow({ sourceRoot, canonicalRoot, sourceRelative, targetRelative,
    role: 'versioned-public-rules', consumers: ['server/data.js', 'server/modes/assault', 'server/modes/independent'],
    lifetime: 'formal versioned rules; retain while this release is in service' });
}

function assertEngineProof(canonicalRoot, sourceRoot, sourceRevision, runtimeData) {
  const engineRoot = path.join(sourceRoot, 'public', 'js', 'independent', 'engine');
  const buildPath = path.join(engineRoot, 'engine-build.json');
  const build = JSON.parse(fs.readFileSync(assertNoReparse(buildPath), 'utf8'));
  if (!Array.isArray(build.modules) || build.sourceDirty !== false || !/^[0-9a-f]{40}$/.test(build.sourceRevision || ''))
    throw new Error('client engine build manifest is invalid or dirty');
  if (runtimeData.engineRevision !== '1a2eb3811b7ad622008441eb81d8280966c4e3cd')
    throw new Error('Assault runtime has an unexpected native engine revision');
  const nativeProofPath = path.join(canonicalRoot, 'runtime', 'assault', 'root-live-engine-archives.json');
  const nativeProof = JSON.parse(fs.readFileSync(assertNoReparse(nativeProofPath), 'utf8'));
  if (nativeProof.status !== 'pass' || nativeProof.engineRevision !== runtimeData.engineRevision
    || nativeProof.archiveSourceRevision !== build.sourceRevision)
    throw new Error('current native engine proof does not match source and compiled revisions');
  const proofEquivalence = assertNativeProofRevisionEquivalent({ canonicalRoot, sourceRoot, sourceRevision, nativeProof });
  for (const key of ENGINE_FALLBACK_KEYS) {
    const url = `/js/independent/engine/${key}`;
    const checks = nativeProof.checks.filter((row) => row.url?.endsWith(url));
    if (!checks.some((row) => row.encoding === 'identity' && row.status === 200 && row.fullBytesMatched === true)
      || !checks.some((row) => row.encoding === 'gzip' && row.status === 200 && row.fullBytesMatched === true))
      throw new Error(`native engine proof lacks full identity/gzip byte checks: ${key}`);
  }
  const preservedPath = path.join(canonicalRoot, 'runtime', 'assault', 'current-generated-engine-cache-preservation.json');
  const preserved = JSON.parse(fs.readFileSync(assertNoReparse(preservedPath), 'utf8'));
  if (preserved.status !== 'pass' || preserved.sourceRevision !== build.sourceRevision || preserved.sourceDirty !== false)
    throw new Error('engine cache preservation proof does not match generated build revision');
  const fallbacks = new Map();
  for (const expected of ENGINE_FALLBACK_KEYS) {
    const item = preserved.files.find((row) => row.logicalPath === expected
      || String(row.path).replaceAll('\\', '/').endsWith(`/engine/${expected}`));
    if (!item || !path.isAbsolute(item.gzip)) throw new Error(`missing preserved engine fallback: ${expected}`);
    const gzipIdentity = fileIdentity(item.gzip);
    if (gzipIdentity.links !== 1) throw new Error(`engine recovery file must have exactly one native file link: ${item.gzip}`);
    ensureUnder(path.join(canonicalRoot, 'runtime', 'assault'), item.gzip);
    fallbacks.set(expected, { logicalPath: expected, source: item.gzip, target: item.gzip,
      role: 'generated-engine-runtime-reference', consumers: ['public/js/independent/client-worker.js'],
      lifetime: 'canonical runtime gzip; retain while this code release is in service',
      logicalBytes: build.modules.find((m) => m.path === expected)?.bytes ?? null,
      storedBytes: gzipIdentity.bytes, identity: gzipIdentity, bytewiseVerified: true, identityPreserved: true,
      reparsePoint: false, adopt: false });
  }
  const manifestRows = [];
  const modulePaths = new Set();
  const missing = new Set();
  for (const mod of build.modules) {
    const rel = mod?.path;
    if (typeof rel !== 'string' || !/^(?:server|shared|public\/js\/ui)\/.+\.m?js$/.test(rel)
      || rel.includes('\\') || rel.includes(':') || rel.split('/').some((x) => !x || x === '.' || x === '..')
      || !Number.isSafeInteger(mod.bytes) || mod.bytes < 0 || modulePaths.has(rel)) throw new Error(`invalid or duplicate generated engine module: ${String(rel)}`);
    modulePaths.add(rel);
    const abs = path.join(engineRoot, ...rel.split('/'));
    if (fs.existsSync(abs)) {
      const identity = fileIdentity(abs);
      if (identity.bytes !== mod.bytes) throw new Error(`generated engine byte size mismatch: ${abs}`);
      manifestRows.push({ sourceRelative: `public/js/independent/engine/${rel}`, role: 'generated-native-engine',
        consumers: ['public/js/independent/client-worker.js'], lifetime: 'formal code release; retain while release active', identity });
    } else if (ENGINE_FALLBACK_KEYS.includes(rel)) missing.add(rel);
    else throw new Error(`unproven missing generated engine module: ${abs}`);
  }
  if (ENGINE_FALLBACK_KEYS.some((key) => !modulePaths.has(key) || !missing.has(key)))
    throw new Error(`generated engine fallback manifest differs from expected gzip-backed modules: ${ENGINE_FALLBACK_KEYS.filter((key) => !modulePaths.has(key) || !missing.has(key)).join(', ')}`);
  const actual = new Set();
  const walk = (dir, rel = '') => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`generated engine contains a reparse point: ${abs}`);
      if (st.isDirectory()) walk(abs, childRel);
      else if (st.isFile()) actual.add(`public/js/independent/engine/${childRel.replaceAll('\\', '/')}`);
      else throw new Error(`unexpected generated engine filesystem entry: ${abs}`);
    }
  };
  walk(engineRoot);
  const expectedFiles = new Set(['public/js/independent/engine/engine-build.json', ...manifestRows.map((r) => r.sourceRelative)]);
  for (const file of actual) if (!expectedFiles.has(file)) throw new Error(`unlisted generated engine file: ${file}`);
  if (!actual.has('public/js/independent/engine/engine-build.json')) throw new Error('generated engine manifest is missing');
  return { build, nativeProof, proofEquivalence, preserved, rows: manifestRows, fallbacks: [...fallbacks.values()],
    declaredModules: build.modules.length, presentModules: manifestRows.length,
    logicalBytes: build.modules.reduce((sum, item) => sum + item.bytes, 0), filesystemEntries: actual.size };
}

export function planAssaultRelease({ sourceRoot, canonicalRoot, revision = 'HEAD' }) {
  sourceRoot = requireAbsolute(sourceRoot, '--source-root');
  canonicalRoot = requireAbsolute(canonicalRoot, '--canonical-root');
  if (samePath(sourceRoot, canonicalRoot)) throw new Error('source root and canonical root must be distinct native Git worktrees');
  if (!samePath(gitRoot(sourceRoot), sourceRoot)) throw new Error(`source root is not the repository root: ${sourceRoot}`);
  if (!samePath(gitRoot(canonicalRoot), canonicalRoot)) throw new Error(`canonical root is not the repository root: ${canonicalRoot}`);
  const sourceCommon = path.resolve(sourceRoot, git(sourceRoot, 'rev-parse', '--git-common-dir'));
  const canonicalCommon = path.resolve(canonicalRoot, git(canonicalRoot, 'rev-parse', '--git-common-dir'));
  if (!samePath(sourceCommon, canonicalCommon)) throw new Error('source and canonical roots do not share the same native Git object database');
  const sourceRevision = git(sourceRoot, 'rev-parse', `${revision}^{commit}`);
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error(`source revision is not a native Git commit: ${sourceRevision}`);
  if (git(canonicalRoot, 'cat-file', '-t', sourceRevision) !== 'commit') throw new Error(`canonical Git cannot recover source commit ${sourceRevision}`);
  const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package-lock.json'), 'utf8'));
  const ws = lock.packages?.['node_modules/ws'];
  if (!packageJson.version || !ws?.version) throw new Error('source package version or locked ws dependency is missing');
  const outputCode = path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.code);
  const outputRules = path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.rules);
  for (const target of [outputCode, outputRules]) {
    ensureUnder(canonicalRoot, target);
    assertNoReparse(target, { allowMissing: true });
    if (fs.existsSync(target)) throw new Error(`Assault release target conflict: ${target}`);
  }

  const sourceRows = new Map();
  const server = addModuleClosure(sourceRoot, ['server/index.js'], 'server', sourceRows);
  const launcherRelative = 'tools/assault/local-service.mjs';
  sourceRows.set(launcherRelative, { sourceRelative: launcherRelative, role: 'logical-code',
    consumers: ['Assault local service launcher'], identity: fileIdentity(path.join(sourceRoot, launcherRelative)) });
  // Assault's client simulation is loaded with runtime import() URLs, so it is not in
  // the static ESM closure rooted at server/index.js or the HTML module tag. The
  // static handler serves these two source trees directly under /assault-engine/.
  const assaultClientSimRel = 'public/js/assault/client-sim.js';
  const assaultClientSim = fs.readFileSync(path.join(sourceRoot, assaultClientSimRel), 'utf8');
  const dynamicUrls = [...assaultClientSim.matchAll(/moduleUrl\(\s*['"](assault-engine\/(?:server\/sim|shared)\/[^'"]+)['"]\s*\)/g)]
    .map((match) => match[1]);
  if (!dynamicUrls.length) throw new Error('Assault client simulation has no recognized dynamic engine imports');
  const simEntries = [...new Set(dynamicUrls.map((url) => url.startsWith('assault-engine/server/sim/')
    ? `server/sim/${url.slice('assault-engine/server/sim/'.length)}`
    : `shared/${url.slice('assault-engine/shared/'.length)}`))];
  const sim = addModuleClosure(sourceRoot, simEntries, 'root-relative', sourceRows, 'Assault dynamic client simulation');
  const dynamicContent = collectAssaultDynamicContentClosure(sourceRoot, sourceRows);
  const htmlPages = ['public/assault.html', 'public/assault-replay.html', 'public/assault-review.html', 'public/index.html', 'public/independent.html'];
  const browserSeen = new Set();
  const browserExternals = new Set();
  const publicRefs = new Set([...htmlPages, 'public/icons/favicon.ico', 'public/icons/app.svg']);
  const cssRel = new Set();
  const workerEntryRel = 'public/js/independent/client-worker.js';
  for (const htmlRel of htmlPages) {
    const html = fs.readFileSync(path.join(sourceRoot, htmlRel), 'utf8');
    const importMap = moduleImportMap(html);
    const moduleEntries = [];
    for (const tag of html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      if (!/type=["']module["']/i.test(tag[1])) continue;
      const resolved = resolveRelativeModule(sourceRoot, htmlRel, tag[2], 'browser');
      if (resolved.external) throw new Error(`${htmlRel} module entry cannot be external: ${tag[2]}`);
      moduleEntries.push(resolved.relative);
    }
    if (!moduleEntries.length) throw new Error(`native page has no module entry: ${htmlRel}`);
    if (htmlRel === 'public/independent.html') {
      const apiPath = path.join(sourceRoot, 'public', 'js', 'independent', 'api.js');
      const apiText = fs.readFileSync(apiPath, 'utf8');
      if (!apiText.includes("new URL('/js/independent/client-worker.js'"))
        throw new Error('independent UI no longer names its native module worker');
      moduleEntries.push(workerEntryRel);
    }
    const pageSeen = new Set();
    const pending = [...moduleEntries];
    while (pending.length) {
      const relative = pending.pop();
      if (pageSeen.has(relative)) continue;
      pageSeen.add(relative); browserSeen.add(relative); publicRefs.add(relative);
      const abs = path.join(sourceRoot, ...relative.split('/'));
      const previous = sourceRows.get(relative);
      sourceRows.set(relative, { sourceRelative: relative, role: 'logical-code',
        consumers: [...new Set([...(previous?.consumers || []), htmlRel])], identity: fileIdentity(abs) });
      const text = fs.readFileSync(abs, 'utf8');
      for (const { spec } of findSpecifiers(text)) {
        const mapped = mapBareSpecifier(importMap, spec);
        if (mapped) {
          const resolved = resolveRelativeModule(sourceRoot, htmlRel, mapped, 'browser');
          if (resolved.external) throw new Error(`unresolved ${htmlRel} import-map target: ${spec} -> ${mapped}`);
          if (resolved.relative?.startsWith('public/vendor/')) { browserExternals.add(resolved.relative); continue; }
          pending.push(resolved.relative); continue;
        }
        const resolved = resolveRelativeModule(sourceRoot, relative, spec, 'browser');
        if (resolved.external) { browserExternals.add(resolved.external); continue; }
        pending.push(resolved.relative);
      }
    }
    for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
      const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
      if (!href || /^(?:data:|https?:|\/\/|#)/i.test(href)) continue;
      const isStylesheet = /\brel=["'][^"']*stylesheet[^"']*["']/i.test(match[1]);
      if (isStylesheet) {
        const rel = path.posix.normalize(path.posix.join('public', href.replace(/^\.\//, '')));
        if (!HTML_EXTERNAL_FALLBACKS.includes(rel)) cssRel.add(rel);
      } else {
        const resolved = resolveRelativeModule(sourceRoot, htmlRel, href, 'browser');
        if (resolved.external) browserExternals.add(resolved.external);
        else publicRefs.add(resolved.relative);
      }
    }
  }
  for (const css of cssRel) publicRefs.add(css);
  const cssQueue = [...cssRel]; const cssScanned = new Set(); let usesPublicAssets = false;
  while (cssQueue.length) {
    const css = cssQueue.pop();
    if (cssScanned.has(css)) continue;
    cssScanned.add(css);
    for (const rel of relativeCssReferences(sourceRoot, css)) {
      if (HTML_EXTERNAL_FALLBACKS.includes(rel) || rel.startsWith('public/vendor/') || rel.startsWith('public/fonts/')) continue;
      if (rel.startsWith('public/assets/')) { usesPublicAssets = true; continue; }
      if (rel.endsWith('.css')) { cssRel.add(rel); cssQueue.push(rel); publicRefs.add(rel); continue; }
      publicRefs.add(rel);
    }
  }

  const runtimeData = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'data', 'assault-runtime.json'), 'utf8'));
  const engine = assertEngineProof(canonicalRoot, sourceRoot, sourceRevision, runtimeData);
  for (const entry of HTML_EXTERNAL_FALLBACKS) {
    const abs = path.join(canonicalRoot, ...entry.split('/'));
    const identity = fileIdentity(abs);
    if (identity.links !== 1) throw new Error(`canonical install fallback must be a unique ordinary file: ${abs}`);
  }
  const localAssetsManifest = path.join(canonicalRoot, 'data', 'local-assets.json');
  const localAssetsIdentity = fileIdentity(localAssetsManifest);
  if (localAssetsIdentity.links !== 1) throw new Error(`canonical local-art manifest must have exactly one native file link: ${localAssetsManifest}`);
  const assetsRoot = path.join(canonicalRoot, 'data', 'assault-sources', 'assets');
  assertNoReparse(assetsRoot);
  if (!fs.lstatSync(assetsRoot).isDirectory()) throw new Error(`canonical native Assault assets directory is missing: ${assetsRoot}`);
  const publicAssetsRoot = path.join(canonicalRoot, 'public', 'assets');
  if (usesPublicAssets) {
    assertNoReparse(publicAssetsRoot);
    if (!fs.lstatSync(publicAssetsRoot).isDirectory()) throw new Error(`canonical public assets fallback is missing: ${publicAssetsRoot}`);
  }

  const dataModule = fs.readFileSync(path.join(sourceRoot, 'server', 'data.js'), 'utf8');
  const expectedMatch = dataModule.match(/export const DATA_FILES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!expectedMatch) throw new Error('cannot parse native server DATA_FILES contract');
  const nativeDataFiles = [...expectedMatch[1].matchAll(/["']([a-z0-9-]+)["']/gi)].map((m) => `${m[1]}.json`);
  if (!nativeDataFiles.length) throw new Error('native server DATA_FILES contract is empty');
  const packScan = scanPacks({ publicDir: path.join(sourceRoot, 'public'), dataDir: path.join(sourceRoot, 'data'), packsDir: path.join(sourceRoot, 'packs') }, { app: packageJson.version });
  const packCodeRelatives = new Set();
  const packRuleRelatives = new Set();
  for (const pack of packScan.packs) {
    if (!pack.supported) continue;
    if (pack.layout === 'folder') packCodeRelatives.add(`packs/${pack.id}/pack.json`);
    for (const file of Object.values(pack.files)) {
      const rel = path.relative(sourceRoot, file.abs).split(path.sep).join('/');
      if (rel.startsWith('public/i18n/')) packCodeRelatives.add(rel);
      else if (rel.startsWith('data/i18n/')) packRuleRelatives.add(rel);
      else if (pack.layout === 'folder' && rel.startsWith(`packs/${pack.id}/`)) packCodeRelatives.add(rel);
      else throw new Error(`native pack scanner returned a file outside the release allowlist: ${rel}`);
    }
  }
  const ruleRelatives = [...new Set([
    ...nativeDataFiles,
    ...ASSAULT_EXTRA_RULES,
    ...[...packRuleRelatives].map((rel) => path.posix.relative('data', rel)),
  ])].map((rel) => `data/${rel}`);
  const missingRules = ruleRelatives.filter((rel) => !fs.existsSync(path.join(sourceRoot, ...rel.split('/'))));
  if (missingRules.length) throw new Error(`required versioned rules are missing: ${missingRules.join(', ')}`);

  for (const rel of packCodeRelatives) publicRefs.add(rel);
  const trackedRelatives = [...new Set([...sourceRows.keys(), ...publicRefs, ...ruleRelatives])];
  ensureTrackedCommitted(sourceRoot, sourceRevision, trackedRelatives);
  const files = [];
  for (const rel of [...new Set([...sourceRows.keys(), ...publicRefs])].sort()) {
    const row = sourceRows.get(rel);
    const file = targetRow({ sourceRoot, canonicalRoot, sourceRelative: rel, targetRelative: `${CANONICAL_RELEASE_PATHS.code}/${rel}`,
      role: row?.role || 'logical-code', consumers: row?.consumers || ['Assault browser/static entry'],
      lifetime: 'formal Assault code release; retain while this release is in service' });
    if (file.identity.bytes !== row?.identity?.bytes && row?.identity) throw new Error(`module changed while planning: ${file.source}`);
    files.push(file);
  }
  for (const rel of ruleRelatives.sort()) files.push(rulesTargetRow({ sourceRoot, canonicalRoot, sourceRelative: rel,
    targetRelative: `${CANONICAL_RELEASE_PATHS.rules}/${path.posix.relative('data', rel)}` }));
  for (const row of engine.rows) {
    files.push(targetRow({ sourceRoot, canonicalRoot, sourceRelative: row.sourceRelative,
      targetRelative: `${CANONICAL_RELEASE_PATHS.code}/${row.sourceRelative}`, role: row.role, consumers: row.consumers, lifetime: row.lifetime }));
  }
  const engineBuildRel = 'public/js/independent/engine/engine-build.json';
  files.push(targetRow({ sourceRoot, canonicalRoot, sourceRelative: engineBuildRel,
    targetRelative: `${CANONICAL_RELEASE_PATHS.code}/${engineBuildRel}`, role: 'generated-engine-manifest',
    consumers: ['release provenance', 'native engine closure'], lifetime: 'retain with code release' }));

  const rootPackage = { name: 'stronghold-protocol-assault-release', version: packageJson.version, private: true, type: 'module', engines: { node: '>=22' }, dependencies: { ws: ws.version } };
  const roots = { code: outputCode, rules: outputRules, canonical: canonicalRoot,
    runtime: path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.runtime) };
  const source = { nativeGitCommit: sourceRevision, version: packageJson.version,
    engineRevision: runtimeData.engineRevision, engineSourceRevision: engine.build.sourceRevision };
  const manifest = { schema: 'assault-release/v1', status: 'planned', adoptionStatus: 'planned', roots, source,
    files: [], engineFallbacks: Object.fromEntries(engine.fallbacks.map((x) => [x.logicalPath, x.source])),
    rulesRoot: outputRules, package: rootPackage };
  const generatedMetadata = [
    { target: path.join(outputCode, 'package.json'), role: 'generated-module-package', contents: `${JSON.stringify(rootPackage, null, 2)}\n` },
    { target: path.join(outputCode, 'assault-release.json'), role: 'generated-release-manifest', contents: `${JSON.stringify(manifest, null, 2)}\n` },
    { target: path.join(outputCode, 'copy.json'), role: 'generated-adoption-receipt', contents: '' },
  ].map((row) => ({ ...row, logicalBytes: Buffer.byteLength(row.contents), identity: null, reparsePoint: false,
    lifetime: 'formal provenance/module metadata; retain with code release', adopt: false }));
  for (const row of generatedMetadata) {
    assertNoReparse(row.target, { allowMissing: true });
    if (fs.existsSync(row.target)) throw new Error(`Assault release target conflict: ${row.target}`);
  }
  for (const row of engine.fallbacks) files.push({ ...row, sourcePath: row.source, targetPath: row.target,
    storedBytes: row.storedBytes, bytewiseVerified: true, identityPreserved: true, sourceIdentity: row.identity,
    targetIdentity: row.identity, adopted: false });
  const references = [];
  for (const fallback of HTML_EXTERNAL_FALLBACKS) {
    const source = path.join(canonicalRoot, ...fallback.split('/'));
    const consumer = fallback.includes('/fonts/') ? 'native page fonts stylesheet'
      : fallback.includes('/vendor/pixi') ? 'native page renderer-library prefetch'
        : 'native page import map';
    references.push({ source, target: source, sourcePath: source, targetPath: source, sourceRelative: fallback, targetRelative: fallback,
      role: 'canonical-readonly-install-fallback', consumers: [consumer],
      lifetime: 'canonical install lifetime; shared, not owned by release', identity: fileIdentity(source),
      sourceIdentity: fileIdentity(source), targetIdentity: fileIdentity(source), logicalBytes: 0,
      storedBytes: fileIdentity(source).bytes, bytewiseVerified: true, identityPreserved: true,
      reparsePoint: false, adopt: false });
  }
  references.push({ source: localAssetsManifest, target: localAssetsManifest, sourcePath: localAssetsManifest, targetPath: localAssetsManifest,
    sourceRelative: 'data/local-assets.json', targetRelative: 'data/local-assets.json', role: 'canonical-readonly-install-data',
    consumers: ['public/js/main.js /data/local-assets.json'], lifetime: 'canonical local-art manifest lifetime; shared, not owned by release',
    identity: localAssetsIdentity, sourceIdentity: localAssetsIdentity, targetIdentity: localAssetsIdentity,
    logicalBytes: 0, storedBytes: localAssetsIdentity.bytes, bytewiseVerified: true, identityPreserved: true,
    reparsePoint: false, adopt: false });
  const assetIdentity = fs.lstatSync(assetsRoot, { bigint: true });
  const assetRefIdentity = { device: String(assetIdentity.dev), fileId: String(assetIdentity.ino), links: Number(assetIdentity.nlink),
    bytes: 0, mtimeNs: String(assetIdentity.mtimeNs), reparsePoint: false };
  references.push({ source: assetsRoot, target: assetsRoot, sourcePath: assetsRoot, targetPath: assetsRoot, sourceRelative: 'data/assault-sources/assets', targetRelative: 'data/assault-sources/assets',
    role: 'canonical-readonly-asset-mount', consumers: ['Assault native assets'], lifetime: 'canonical source asset lifetime; not owned by release',
    identity: assetRefIdentity, sourceIdentity: assetRefIdentity, targetIdentity: assetRefIdentity,
    logicalBytes: 0, storedBytes: 0, adopt: false });
  if (usesPublicAssets) {
    const st = fs.lstatSync(publicAssetsRoot, { bigint: true });
    const publicAssetIdentity = { device: String(st.dev), fileId: String(st.ino), links: Number(st.nlink),
      bytes: 0, mtimeNs: String(st.mtimeNs), reparsePoint: false };
    references.push({ source: publicAssetsRoot, target: publicAssetsRoot, sourcePath: publicAssetsRoot, targetPath: publicAssetsRoot,
      sourceRelative: 'public/assets', targetRelative: 'public/assets', role: 'canonical-readonly-public-assets',
      consumers: ['native page CSS resources via install fallback'], lifetime: 'canonical install asset lifetime; not owned by release',
      identity: publicAssetIdentity, sourceIdentity: publicAssetIdentity, targetIdentity: publicAssetIdentity,
      logicalBytes: 0, storedBytes: 0, adopt: false });
  }
  const movable = files.filter((row) => row.adopt);
  return {
    schema: 'assault-release-plan/v1', mode: 'assault', status: 'planned', adoptionStatus: 'planned', sourceRoot, canonicalRoot, sourceRevision,
    version: packageJson.version, engineRevision: runtimeData.engineRevision,
    engineSourceRevision: engine.build.sourceRevision, sourceGitCommonDir: sourceCommon,
    canonicalGitRoot: gitRoot(canonicalRoot), roots, source, package: rootPackage,
    proofEquivalence: engine.proofEquivalence,
    moduleClosure: { serverFiles: server.seen.size, browserFiles: browserSeen.size,
      nodeSimulationDynamicContentFiles: dynamicContent.seen.size,
      serverExternalImports: [...server.external].sort(), browserExternalImports: [...browserExternals].sort(),
      supportedPacks: packScan.packs.map((pack) => ({ id: pack.id, type: pack.type, files: Object.values(pack.files).map((file) => path.relative(sourceRoot, file.abs).split(path.sep).join('/')) })),
      skippedPacks: packScan.skipped,
      simulationFiles: sim.seen.size, simulationEntryUrls: dynamicUrls,
      codeFileCount: new Set([...sourceRows.keys(), ...publicRefs]).size,
      cssCount: cssRel.length, engineDeclaredModules: engine.declaredModules,
      enginePresentModules: engine.presentModules, engineFallbacks: engine.fallbacks.map((x) => x.logicalPath),
      engineManifestEntries: engine.filesystemEntries },
    rules: { root: outputRules, nativeDataFiles, extras: ASSAULT_EXTRA_RULES, languageOverlays: [...packRuleRelatives].sort(), missing: [],
      directConsumers: ['server/data.js DATA_FILES', 'server/modes/assault/data.js', 'server/modes/independent/catalog.js', 'server/modes/independent/http.js'] },
    files: files.map((row) => ({ ...row, sourcePath: row.source, targetPath: row.target,
      storedBytes: row.storedBytes ?? row.logicalBytes, bytewiseVerified: row.bytewiseVerified ?? false,
      identityPreserved: row.identityPreserved ?? null,
      sourceIdentity: Object.hasOwn(row, 'sourceIdentity') ? row.sourceIdentity : row.identity,
      targetIdentity: row.targetIdentity ?? null, adopted: row.adopt ?? false })), references, generatedMetadata,
    engineFallbacks: Object.fromEntries(engine.fallbacks.map((row) => [row.logicalPath, row.source])),
    totals: { movableFiles: movable.length, movableBytes: movable.reduce((n, x) => n + x.logicalBytes, 0),
      codeAndRulesBytes: files.filter((x) => x.adopt).reduce((n, x) => n + x.logicalBytes, 0),
      generatedMetadataBytes: generatedMetadata.reduce((n, x) => n + x.logicalBytes, 0),
      engineModuleBytes: engine.logicalBytes, externalReferenceCount: references.length + engine.fallbacks.length },
    lifetime: { code: 'formal published release, retained until superseded by normal release lifecycle',
      rules: 'versioned public game rules, retained while code release or rollback refers to this revision',
      runtime: 'existing canonical player state/logs/receipts; not included, moved, or rewritten' },
  };
}

function sameIdentity(before, after) {
  return before.device === after.device && before.fileId === after.fileId && before.bytes === after.bytes
    && before.links === after.links && before.mtimeNs === after.mtimeNs;
}

const FILETIME_UNIX_EPOCH_TICKS = 116444736000000000n;

// Rollback rewrites original bytes in place, which stamps a new mtime and breaks the
// recorded native identity (sameIdentity compares mtimeNs). Node's utimes rounds through
// a double and lands within a few hundred ns, so on Windows the exact 100 ns FILETIME is
// set through .NET in one batch. Returns error strings; verifies every file afterwards.
export function restoreNativeMtimes(rows) {
  if (!rows.length) return [];
  const errors = [];
  if (process.platform === 'win32') {
    const lines = rows.map(({ target, mtimeNs }) => `[IO.File]::SetLastWriteTimeUtc('${target.replace(/'/g, "''")}',`
      + `[DateTime]::FromFileTimeUtc(${BigInt(mtimeNs) / 100n + FILETIME_UNIX_EPOCH_TICKS}))`);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop';${lines.join(';')}`], { encoding: 'utf8' });
    if (r.status !== 0) errors.push(`mtime restore failed: ${(r.stderr || r.error || '').toString().trim()}`);
  } else {
    for (const { target, mtimeNs } of rows) {
      try { const st = fs.statSync(target); fs.utimesSync(target, st.atime, Number(BigInt(mtimeNs)) / 1e9); }
      catch (e) { errors.push(String(e)); }
    }
  }
  for (const { target, mtimeNs } of rows) {
    try {
      const now = String(fs.lstatSync(target, { bigint: true }).mtimeNs);
      if (now !== String(mtimeNs)) errors.push(`mtime not restored: ${target} (${now} != ${mtimeNs})`);
    } catch (e) { errors.push(String(e)); }
  }
  return errors;
}

function mkdirTracked(dir, created) {
  if (fs.existsSync(dir)) return;
  const parent = path.dirname(dir);
  if (parent === dir) throw new Error(`cannot create release target directory: ${dir}`);
  mkdirTracked(parent, created);
  fs.mkdirSync(dir);
  created.push(dir);
}

export function buildAssaultReleaseManifest(plan) {
  const releaseManifest = { schema: 'assault-release/v1', status: 'pass', adoptionStatus: 'adopted',
    roots: plan.roots, source: plan.source,
    files: plan.files.map((row) => ({ sourcePath: row.sourcePath, targetPath: row.targetPath, role: row.role,
      logicalBytes: row.logicalBytes, storedBytes: row.storedBytes,
      bytewiseVerified: row.bytewiseVerified ?? false, identityPreserved: row.identityPreserved ?? null,
      sourceIdentity: Object.hasOwn(row, 'sourceIdentity') ? row.sourceIdentity : (row.identity ?? null),
      targetIdentity: row.targetIdentity ?? null,
      adopted: row.adopted ?? row.adopt ?? false, metadata: row.metadata ?? false,
      consumers: row.consumers ?? [], lifetime: row.lifetime ?? '',
      ...(row.restorationMethod ? { restorationMethod: row.restorationMethod,
        sourceCommit: row.sourceCommit, sourceGitPath: row.sourceGitPath } : {}) })),
    engineFallbacks: plan.engineFallbacks, references: plan.references ?? [], totals: plan.totals ?? {}, rules: plan.rules ?? {},
    ...(plan.proofEquivalence ? { nativeEngineProof: { status: 'pass', sourceRevision: plan.proofEquivalence.proofRevision,
      scopedEquivalentTo: plan.proofEquivalence.equivalent ? plan.proofEquivalence.sourceRevision : null,
      ...(plan.proofEquivalence.reviewedContentDelta ? { coreEquivalentTo: plan.proofEquivalence.sourceRevision,
        reviewedContentDelta: plan.proofEquivalence.reviewedContentDelta } : {}),
      comparedPaths: plan.proofEquivalence.comparedPaths, changedPaths: plan.proofEquivalence.changedPaths } } : {}),
    ...(plan.nativeSourceUpgradeProof ? { nativeSourceUpgradeProof: plan.nativeSourceUpgradeProof } : {}),
    ...(plan.releaseUpdates ? { releaseUpdates: plan.releaseUpdates } : {}),
    metadataAllowlist: ['package.json', 'assault-release.json', 'copy.json'] };
  const restoredRows = plan.files.filter((row) => row.restorationMethod === 'git-show-exact-blob');
  const copyReceipt = { schema: 'assault-code-adoption/v1', status: 'pass', version: plan.version,
    manifest: path.join(plan.roots.code, 'assault-release.json'),
    owner: 'stronghold-protocol Assault release producer',
    kind: plan.releaseUpdates ? 'native-git-source-update'
      : restoredRows.length ? 'same-volume-native-adoption-with-native-git-restoration' : 'same-volume-native-adoption',
    source: { nativeGitCommit: plan.source.nativeGitCommit, sourceRoot: plan.sourceRoot },
    ...(restoredRows.length ? { restoration: { method: 'git-show-exact-blob', sourceCommit: plan.source.nativeGitCommit,
      files: restoredRows.length, bytes: restoredRows.reduce((sum, row) => sum + row.logicalBytes, 0),
      provenance: 'native Git source blobs; sourceIdentity is null and target identity is measured after restoration' } } : {}),
    purpose: 'published Assault code and versioned public rules',
    consumers: ['tools/assault/local-service.mjs', 'server/http/static.js'], maxCurrent: 1,
    expiryCondition: 'superseded by a verified Assault release and no active rollback reference',
    ...(plan.releaseUpdates ? { releaseUpdates: plan.releaseUpdates } : {}),
    cleanup: { sourceWorktreeNativeEntry: 'git worktree remove <exact old sourceRoot>',
      publishedArtifactLifecycle: 'normal producer replaces only manifest-listed files; retain while active or rollback-referenced and retire only when consumers are zero' } };
  const metadataTargets = new Map((plan.generatedMetadata || []).map((meta) => [path.basename(meta.target), meta.target]));
  const packageBytes = Buffer.from(`${JSON.stringify(plan.package)}\n`, 'utf8');
  const copyBytes = Buffer.from(`${JSON.stringify(copyReceipt)}\n`, 'utf8');
  const metadataRows = [
    { filename: 'package.json', role: 'generated-module-package', bytes: packageBytes, consumers: ['Node module loader'] },
    { filename: 'assault-release.json', role: 'generated-release-manifest', bytes: null, consumers: ['launcher', 'release lifecycle'] },
    { filename: 'copy.json', role: 'generated-adoption-receipt', bytes: copyBytes, consumers: ['release lifecycle'] },
  ].map((meta) => ({ sourcePath: null, targetPath: metadataTargets.get(meta.filename), role: meta.role,
    logicalBytes: meta.bytes?.length ?? 0, storedBytes: meta.bytes?.length ?? 0,
    bytewiseVerified: false, identityPreserved: null, sourceIdentity: null, targetIdentity: null,
    adopted: false, metadata: true, consumers: meta.consumers, lifetime: 'retain with code release' }));
  if (metadataRows.some((row) => !row.targetPath)) throw new Error('release metadata plan is incomplete');
  releaseManifest.files.push(...metadataRows);
  const [packageRow, manifestRow, copyRow] = metadataRows;
  let manifestBytes = Buffer.alloc(0);
  releaseManifest.totals.generatedMetadataBytes = packageBytes.length + copyBytes.length;
  for (let i = 0; i < 8; i++) {
    manifestBytes = Buffer.from(`${JSON.stringify(releaseManifest)}\n`, 'utf8');
    const fullMetadataBytes = packageBytes.length + copyBytes.length + manifestBytes.length;
    if (manifestRow.logicalBytes === manifestBytes.length && manifestRow.storedBytes === manifestBytes.length
      && releaseManifest.totals.generatedMetadataBytes === fullMetadataBytes) break;
    manifestRow.logicalBytes = manifestBytes.length; manifestRow.storedBytes = manifestBytes.length;
    releaseManifest.totals.generatedMetadataBytes = fullMetadataBytes;
  }
  manifestBytes = Buffer.from(`${JSON.stringify(releaseManifest)}\n`, 'utf8');
  if (manifestRow.logicalBytes !== manifestBytes.length
    || releaseManifest.totals.generatedMetadataBytes !== packageBytes.length + copyBytes.length + manifestBytes.length)
    throw new Error('release manifest self-size did not converge');
  return { releaseManifest, metadata: [
    { target: packageRow.targetPath, contents: packageBytes },
    { target: copyRow.targetPath, contents: copyBytes },
    { target: manifestRow.targetPath, contents: manifestBytes },
  ] };
}

const ASSAULT_REPAIR_PRODUCER_PATHS = Object.freeze([
  'tools/build-server-release.mjs', 'tools/check-imports.mjs', 'server/packs.js',
]);

export function planAssaultReleaseRepairFromGit({ canonicalRoot, sourceCommit }) {
  canonicalRoot = requireAbsolute(canonicalRoot, '--canonical-root');
  if (!samePath(gitRoot(canonicalRoot), canonicalRoot)) throw new Error(`canonical root is not the repository root: ${canonicalRoot}`);
  const revision = git(canonicalRoot, 'rev-parse', `${sourceCommit}^{commit}`);
  if (!/^[0-9a-f]{40}$/.test(revision) || git(canonicalRoot, 'cat-file', '-t', revision) !== 'commit')
    throw new Error(`repair source is not a recoverable native Git commit: ${sourceCommit}`);
  const codeRoot = path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.code);
  const rulesRoot = path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.rules);
  const manifestPath = path.join(codeRoot, 'assault-release.json');
  const copyPath = path.join(codeRoot, 'copy.json');
  assertNoReparse(codeRoot); assertNoReparse(rulesRoot);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const copy = JSON.parse(fs.readFileSync(copyPath, 'utf8'));
  if (manifest.schema !== 'assault-release/v1' || manifest.status !== 'pass' || manifest.adoptionStatus !== 'adopted')
    throw new Error('Git repair requires an adopted Assault release manifest');
  for (const [name, expected] of [['code', codeRoot], ['rules', rulesRoot], ['canonical', canonicalRoot]]) {
    if (!samePath(manifest.roots?.[name], expected)) throw new Error(`adopted manifest ${name} root mismatch`);
  }
  const historicSourceRoot = requireAbsolute(copy.source?.sourceRoot, 'manifest source root');
  if (!samePath(path.resolve(historicSourceRoot), path.resolve(canonicalRoot, '.worktrees/assault/stronghold-protocol')))
    throw new Error(`adopted manifest has unexpected historic source root: ${historicSourceRoot}`);

  const oldRows = manifest.files.filter((row) => !row.metadata);
  const originalProof = manifest.nativeEngineProof;
  if (!originalProof?.sourceRevision || !Array.isArray(originalProof.comparedPaths))
    throw new Error('adopted release manifest lacks native engine proof scope');
  const proofEquivalence = assertNativeProofScopedEquivalent({ canonicalRoot,
    proofRevision: originalProof.sourceRevision, sourceRevision: revision,
    comparedPaths: originalProof.comparedPaths });
  const rowByTarget = new Map(oldRows.map((row) => [path.resolve(row.targetPath).toLowerCase(), row]));
  for (const row of oldRows) {
    if (!row.bytewiseVerified || row.identityPreserved !== true || !row.targetIdentity)
      throw new Error(`release row has no complete original proof: ${row.targetPath}`);
    const target = path.resolve(row.targetPath);
    const inRoot = (base) => {
      const relative = path.relative(base, target);
      return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    const isEngineRuntimeReference = row.role === 'generated-engine-runtime-reference'
      && inRoot(path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.runtime));
    if (!row.adopted && !isEngineRuntimeReference) throw new Error(`unexpected non-adopted release row: ${row.targetPath}`);
    if (!inRoot(codeRoot) && !inRoot(rulesRoot) && !isEngineRuntimeReference)
      throw new Error(`adopted row target is outside registered release roots: ${row.targetPath}`);
    const current = fileIdentity(row.targetPath);
    if (!sameIdentity(row.targetIdentity, current) || current.bytes !== row.storedBytes)
      throw new Error(`release target identity changed: ${row.targetPath}`);
  }
  for (const reference of manifest.references ?? []) {
    if (!reference.targetIdentity) throw new Error(`canonical reference has no original native identity: ${reference.targetPath}`);
    const current = nativePathIdentity(reference.targetPath);
    if (!sameIdentity(reference.targetIdentity, current) || current.bytes !== reference.storedBytes)
      throw new Error(`canonical reference identity changed: ${reference.targetPath}`);
  }

  const dynamicTree = git(canonicalRoot, 'ls-tree', '-r', '--name-only', revision, '--', 'server/sim/content')
    .split(/\r?\n/).filter(Boolean);
  const contentPaths = assaultDynamicContentModulePaths(dynamicTree);
  if (!contentPaths.includes('server/sim/content/index.js') || !contentPaths.includes('server/sim/content/kits/index.js'))
    throw new Error('native Git repair source lacks Assault dynamic content registry entries');
  const requested = [...contentPaths, ...ASSAULT_REPAIR_PRODUCER_PATHS];
  const blobCache = readNativeGitBlobBatch(canonicalRoot, revision, requested);
  const rows = [];
  for (const sourceGitPath of requested) {
    const role = sourceGitPath.startsWith('server/sim/content/')
      ? 'native-git-restored-runtime-module' : 'native-git-restored-release-producer';
    const blob = blobCache.get(sourceGitPath);
    if (!blob) throw new Error(`native Git repair blob is absent from batch cache: ${sourceGitPath}`);
    const targetPath = path.join(codeRoot, ...sourceGitPath.split('/'));
    ensureUnder(codeRoot, targetPath); assertNoReparse(targetPath, { allowMissing: true });
    const old = rowByTarget.get(path.resolve(targetPath).toLowerCase());
    if (old) {
      // Existing adoption proof is authoritative for Git checkout bytes (including
      // native line-ending conversion); identity/mtime/size are rechecked above.
      continue;
    }
    const targetIdentity = fileIdentity(targetPath, { allowMissing: true });
    if (targetIdentity) {
      if (!fs.readFileSync(targetPath).equals(blob)) throw new Error(`repair target conflict: ${targetPath}`);
      rows.push({ sourcePath: path.join(historicSourceRoot, ...sourceGitPath.split('/')), targetPath,
        role, logicalBytes: blob.length, storedBytes: blob.length, bytewiseVerified: true,
        identityPreserved: false, sourceIdentity: null, targetIdentity, adopted: true, metadata: false,
        restorationMethod: 'git-show-exact-blob', sourceCommit: revision, sourceGitPath,
        consumers: [role === 'native-git-restored-runtime-module' ? 'Assault Node battle content registry' : 'normal Assault release producer'],
        lifetime: 'retain with formal Assault code release' });
    } else {
      rows.push({ sourcePath: path.join(historicSourceRoot, ...sourceGitPath.split('/')), targetPath,
        role, logicalBytes: blob.length, storedBytes: blob.length, bytewiseVerified: false,
        identityPreserved: false, sourceIdentity: null, targetIdentity: null, adopted: false, adopt: true, metadata: false,
        restorationMethod: 'git-show-exact-blob', sourceCommit: revision, sourceGitPath,
        consumers: [role === 'native-git-restored-runtime-module' ? 'Assault Node battle content registry' : 'normal Assault release producer'],
        lifetime: 'retain with formal Assault code release' });
    }
  }
  const missing = rows.filter((row) => row.adopt);
  const addedBytes = missing.reduce((sum, row) => sum + row.logicalBytes, 0);
  const plan = { schema: 'assault-git-repair-plan/v1', status: 'planned', adoptionStatus: 'pending',
    canonicalRoot, codeRoot, rulesRoot, manifestPath, copyPath, sourceCommit: revision, historicSourceRoot,
    originalManifest: manifest, originalCopy: copy, originalManifestBytes: fs.readFileSync(manifestPath),
    originalCopyBytes: fs.readFileSync(copyPath), originalMetadataIdentities: {
      manifest: fileIdentity(manifestPath), copy: fileIdentity(copyPath), package: fileIdentity(path.join(codeRoot, 'package.json')),
    }, rows, missingFiles: missing.length, missingBytes: addedBytes,
    reusableFiles: rows.length - missing.length, existingManifestRows: oldRows.length,
    proofEquivalence,
    blobCache,
    outputRows: [...oldRows, ...rows],
  };
  return plan;
}

export function restoreAssaultReleaseFromGit(plan) {
  if (!plan || plan.schema !== 'assault-git-repair-plan/v1') throw new Error('invalid native Git repair plan');
  const { canonicalRoot, sourceCommit, rows, originalManifest } = plan;
  if (git(canonicalRoot, 'rev-parse', `${sourceCommit}^{commit}`) !== sourceCommit)
    throw new Error('repair source commit changed after planning');
  for (const row of originalManifest.files.filter((item) => !item.metadata)) {
    const current = fileIdentity(row.targetPath);
    if (!sameIdentity(row.targetIdentity, current) || current.bytes !== row.storedBytes)
      throw new Error(`adopted release target changed after repair planning: ${row.targetPath}`);
  }
  for (const reference of originalManifest.references ?? []) {
    const current = nativePathIdentity(reference.targetPath);
    if (!sameIdentity(reference.targetIdentity, current) || current.bytes !== reference.storedBytes)
      throw new Error(`canonical reference changed after repair planning: ${reference.targetPath}`);
  }
  for (const row of rows) {
    if (!row.adopt) continue;
    assertNoReparse(row.targetPath, { allowMissing: true });
    if (fs.existsSync(row.targetPath)) throw new Error(`repair target conflict: ${row.targetPath}`);
    if (!samePath(path.parse(row.sourcePath).root, path.parse(row.targetPath).root))
      throw new Error(`cross-volume native Git repair refused: ${row.targetPath}`);
  }
  const created = [];
  const restored = [];
  const metadataBackups = [];
  try {
    for (const row of rows.filter((item) => item.adopt)) {
      const bytes = plan.blobCache?.get(row.sourceGitPath);
      if (!Buffer.isBuffer(bytes)) throw new Error(`native Git repair plan lacks its RAM blob: ${row.sourceGitPath}`);
      mkdirTracked(path.dirname(row.targetPath), created);
      fs.writeFileSync(row.targetPath, bytes, { flag: 'wx' });
      restored.push({ row, bytes, identity: fileIdentity(row.targetPath) });
      if (restored.at(-1).identity.bytes !== bytes.length || !fs.readFileSync(row.targetPath).equals(bytes))
        throw new Error(`native Git exact-blob restoration proof failed: ${row.targetPath}`);
      row.targetIdentity = restored.at(-1).identity;
      row.bytewiseVerified = true; row.identityPreserved = false; row.adopted = true; row.adopt = false;
    }

    const metadata = (name) => originalManifest.files.find((row) => row.metadata && path.basename(row.targetPath) === name)?.targetPath;
    const packagePath = metadata('package.json'); const manifestPath = plan.manifestPath; const copyPath = plan.copyPath;
    const physicalRows = [...originalManifest.files.filter((row) => !row.metadata), ...rows].map((row) => ({
      ...row, identity: row.targetIdentity, adopt: false,
    }));
    const restoredRows = rows.filter((row) => row.restorationMethod === 'git-show-exact-blob');
    const updatedTotals = { ...originalManifest.totals,
      movableFiles: originalManifest.totals.movableFiles,
      movableBytes: originalManifest.totals.movableBytes,
      restoredFiles: (originalManifest.totals.restoredFiles ?? 0) + restoredRows.length,
      restoredBytes: (originalManifest.totals.restoredBytes ?? 0) + restoredRows.reduce((sum, row) => sum + row.logicalBytes, 0),
      codeAndRulesBytes: originalManifest.totals.codeAndRulesBytes + restoredRows.reduce((sum, row) => sum + row.logicalBytes, 0),
    };
    const { releaseManifest, metadata: generated } = buildAssaultReleaseManifest({
      roots: originalManifest.roots, source: { ...originalManifest.source, nativeGitCommit: sourceCommit },
      sourceRoot: plan.historicSourceRoot, version: originalManifest.source.version,
      package: JSON.parse(fs.readFileSync(packagePath, 'utf8')), generatedMetadata: [packagePath, manifestPath, copyPath].map((target) => ({ target })),
      files: physicalRows, engineFallbacks: originalManifest.engineFallbacks, references: originalManifest.references,
      totals: updatedTotals, rules: originalManifest.rules,
      proofEquivalence: plan.proofEquivalence,
    });
    // Existing metadata is producer-owned. Recheck the original byte content and
    // native identity immediately before replacing it; rollback only our exact writes.
    const originals = new Map([[manifestPath, plan.originalManifestBytes], [copyPath, plan.originalCopyBytes]]);
    const oldIdentities = new Map([[manifestPath, plan.originalMetadataIdentities.manifest], [copyPath, plan.originalMetadataIdentities.copy]]);
    for (const target of [copyPath, manifestPath]) {
      if (!sameIdentity(oldIdentities.get(target), fileIdentity(target)) || !fs.readFileSync(target).equals(originals.get(target)))
        throw new Error(`release metadata changed after repair planning: ${target}`);
    }
    for (const meta of generated.filter((item) => item.target === copyPath || item.target === manifestPath)) {
      fs.writeFileSync(meta.target, meta.contents);
      const current = fileIdentity(meta.target);
      if (current.bytes !== meta.contents.length || !fs.readFileSync(meta.target).equals(meta.contents))
        throw new Error(`release metadata byte verification failed: ${meta.target}`);
      metadataBackups.push({ target: meta.target, bytes: originals.get(meta.target), writtenBytes: meta.contents,
        identity: current, oldIdentity: oldIdentities.get(meta.target) });
    }
    return { status: 'pass', adoptionStatus: 'adopted', sourceCommit,
      restoredFiles: restored.length, restoredBytes: restored.reduce((sum, entry) => sum + entry.bytes.length, 0),
      manifest: manifestPath, copyReceipt: copyPath, releaseManifest };
  } catch (error) {
    const rollbackErrors = [], rewritten = [];
    for (const item of [...metadataBackups].reverse()) {
      try {
        const current = fileIdentity(item.target);
        if (current.device !== item.identity.device || current.fileId !== item.identity.fileId
          || current.links !== item.identity.links || !fs.readFileSync(item.target).equals(item.writtenBytes))
          throw new Error(`release metadata changed before rollback: ${item.target}`);
        fs.writeFileSync(item.target, item.bytes);
        rewritten.push({ target: item.target, mtimeNs: item.oldIdentity.mtimeNs });
      } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    rollbackErrors.push(...restoreNativeMtimes(rewritten));
    for (const item of [...restored].reverse()) {
      try {
        const current = fileIdentity(item.row.targetPath);
        if (!sameIdentity(item.identity, current) || !fs.readFileSync(item.row.targetPath).equals(item.bytes))
          throw new Error(`restored file changed before rollback: ${item.row.targetPath}`);
        fs.unlinkSync(item.row.targetPath);
      } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    for (const directory of [...new Set(created)].sort((a, b) => b.length - a.length)) {
      try { fs.rmdirSync(directory); } catch (rollbackError) {
        if (rollbackError.code !== 'ENOENT' && rollbackError.code !== 'ENOTEMPTY') rollbackErrors.push(String(rollbackError));
      }
    }
    if (rollbackErrors.length) error.message += `; repair rollback incomplete: ${rollbackErrors.join(' | ')}`;
    throw error;
  }
}

function normalizeCheckoutBytes(bytes) { return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'); }

export function assertReleaseTargetMatchesNativeBlob(actualBytes, nativeBytes, label = 'release target') {
  if (!normalizeCheckoutBytes(actualBytes).equals(normalizeCheckoutBytes(nativeBytes)))
    throw new Error(`adopted content conflicts with old native source: ${label}`);
  return true;
}

function releaseSourceRelative(codeRoot, targetPath) {
  const relative = path.relative(codeRoot, path.resolve(targetPath));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

export function classifyAssaultReleaseUpdateChanges({ changedPaths, oldRows, codeRoot, rulesRoot, updateKind = 'transport' }) {
  const content = ['content', 'gameplay'].includes(updateKind);
  const supported = sourcePath => CONTENT_UPDATE_PATHS.has(sourcePath) || (updateKind === 'gameplay' && GAMEPLAY_RUNTIME_PATHS.has(sourcePath));
  const byPath = new Map(oldRows.map((row) => [releaseSourceRelative(codeRoot, row.targetPath), row]).filter(([p]) => p));
  if (content) for (const row of oldRows) {
    const relative = releaseSourceRelative(rulesRoot, row.targetPath);
    if (relative) byPath.set(`data/${relative}`, row);
  }
  const selected = [];
  const ignored = [];
  for (const sourceGitPath of [...new Set(changedPaths)].sort()) {
    if (/^(?:docs?|test|tests|\.omni)\//i.test(sourceGitPath) || /\.md$/i.test(sourceGitPath)) { ignored.push(sourceGitPath); continue; }
    if (content && (CONTENT_BUILD_SOURCE_PATHS.has(sourceGitPath) || (updateKind === 'gameplay' && GAMEPLAY_BUILD_SOURCE_PATHS.has(sourceGitPath)))) { ignored.push(sourceGitPath); continue; }
    if (sourceGitPath.startsWith('data/') && !(content && supported(sourceGitPath))) throw new Error(`Assault release update refuses rules/data drift: ${sourceGitPath}`);
    if (sourceGitPath.startsWith('public/js/independent/engine/')) throw new Error(`Assault release update refuses generated engine drift: ${sourceGitPath}`);
    if (!TRANSPORT_ONLY_PATHS.has(sourceGitPath) && !(content && supported(sourceGitPath)))
      throw new Error(`Assault update supports only transport source paths: ${sourceGitPath}`);
    if (!/^(?:server|shared|public)\/.+\.m?js$/.test(sourceGitPath) && sourceGitPath !== 'tools/build-server-release.mjs' && !(content && supported(sourceGitPath)))
      throw new Error(`Assault release update does not support changed path: ${sourceGitPath}`);
    let row = byPath.get(sourceGitPath);
    if (!row && updateKind === 'gameplay' && GAMEPLAY_ADDED_RUNTIME_PATHS.has(sourceGitPath)) {
      const targetPath=path.join(codeRoot,...sourceGitPath.split('/'));
      row={targetPath,sourcePath:null,role:'logical-code',adopted:true,metadata:false,
        sourceGitPath,sourceIdentity:null,targetIdentity:null,logicalBytes:0,storedBytes:0,bytewiseVerified:false};
      selected.push({sourceGitPath,row,added:true});continue;
    }
    if (!row || !row.adopted || row.metadata || !['logical-code', 'native-git-restored-release-producer', 'native-git-restored-runtime-module', ...(content ? ['versioned-public-rules'] : [])].includes(row.role))
      throw new Error(`changed source is not an adopted code row: ${sourceGitPath}`);
    selected.push({ sourceGitPath, row });
  }
  return { selected, ignored };
}

const TRANSPORT_ONLY_PATHS = new Set(['server/modes/assault/http.js', 'tools/build-server-release.mjs']);
// Explicit public/content boundary. Core simulation, shared rules and player stores
// remain subject to the existing native proof; content updates are never advertised
// as compatible with a previously prepared battle.
const CONTENT_UPDATE_PATHS = new Set([
  'public/js/assault/main.js', 'public/js/assault/model.js', 'public/js/assault/mechanicsView.js', 'public/js/assault/ui.js', 'public/js/assault/choiceVisuals.js',
  'public/js/render/spine.js',
  'public/css/assault-native.css', 'data/assault-assets.json', 'data/assault-public-text.json',
  'data/assault-design/collectibles.json', 'data/assault-design/system.json',
]);
const CONTENT_BUILD_SOURCE_PATHS = new Set([
  'data/assault-design/public-text.json', 'tools/assault/build-public-text.mjs', 'tools/assault/assets-acquire.mjs', 'tools/assault/check-collectibles-design.mjs',
]);
// 10-30 structured play recording: the new recorder / replay modules, the two replay pages and the recording routes.
// None of it touches battle rules; it only adds files and mounts `/api/assault/recordings` in the existing Assault http.
const RECORDING_ADDED_RUNTIME_PATHS = Object.freeze([
  'public/js/recording/index.js', 'public/js/recording/pageCapture.js', 'public/js/recording/canvasMedia.js', 'public/js/recording/selectionTimeline.js',
  'public/js/assault/recorder.js', 'public/js/assault/recorderCanvas.js', 'public/js/assault/recorderMediaClock.js', 'public/js/assault/recorderLifecycle.js',
  'public/js/assault/replay.js', 'public/js/assault/replayAssets.js', 'public/js/assault/replayCaptions.js', 'public/js/assault/replayMediaSurface.js',
  'public/js/assault/replayMediaTime.js', 'public/js/assault/replayReviewConfig.js', 'public/js/assault/replayReviewSeek.js', 'public/js/assault/review.js',
  'public/assault-replay.html', 'public/assault-review.html', 'public/css/assault-recording.css',
  'server/modes/assault/recordings.js', 'server/modes/assault/recording-comments.js',
]);
// Assault visual line (official effects, 3D board, Spine): client render modules, settings UI,
// i18n and the static asset route. Exact reviewed paths; battle rules are not in this list.
const VISUAL_RUNTIME_PATHS = Object.freeze([
  ...RECORDING_ADDED_RUNTIME_PATHS,
  'server/index.js', // 10-30: mounts the recording directory (default beside the run root) for `/api/assault/recordings`
  'public/js/screens/stats.js', // optional mode-owned ledger tab; native defaults stay intact
  'public/js/ui/components.js', 'public/js/render/textures.js', // opt-in Assault stars; native tier look stays the default
  'public/js/independent/game.js', // 10-27: the single-player screen renders the shared BattleSpeedBar (ui/components.js) that Assault now uses too
  'public/js/ui/ticker.js', // 10-27: a status line (`replaces`) supersedes the one before it on screen and in the queue; Assault's phase line
  'public/js/ui/choiceOverlay.js', // 10-28: ChoiceView `presentation.quiet` (default off) drops the header sentences; Assault's pick-one screens use it
  'public/i18n/en.json', 'public/i18n/ja.json', 'public/i18n/ko.json', 'public/i18n/zh-TW.json',
  'public/js/assault/client-sim.js', 'public/js/assault/field.js', 'public/js/assault/fx-skill-map.json',
  'public/js/assault/fxCompat.js', 'public/js/assault/snapCompat.js', 'public/js/render/app.js',
  'public/js/render/app/pixi.js', 'public/js/resourceBase.js', // page-relative vendor/texture loading under a mounted path
  'public/assault.html', 'public/css/assault-bazaar.css', // Assault bronze-frame skin (page-scoped stylesheet)
  'public/js/render/app/view.js', 'public/js/render/board3d/layout.js', 'public/js/render/board3d/load.js',
  'public/js/render/board3d/materials.js', 'public/js/render/board3d/scene.js', 'public/js/render/fx/events.js',
  'public/js/render/fxRegistry.js', 'public/js/render/fx/kinds.js', 'public/js/render/impostor.js', 'public/js/render/interp.js',
  'public/js/render/manifold.js', 'public/js/render/skillAttack.js', 'public/js/render/spine.js',
  'public/js/render/style.js', 'public/js/render/tiles.js', 'public/js/render/units.js',
  'public/js/render/vfx/available.js', 'public/js/render/vfx/clips.js', 'public/js/render/vfx/curves.js',
  'public/js/render/vfx/effect.js', 'public/js/render/vfx/flight.js', 'public/js/render/vfx/funnelfx.js',
  'public/js/render/vfx/funnels.js', 'public/js/render/vfx/geom.js', 'public/js/render/vfx/gl.js',
  'public/js/render/vfx/glsl.js', 'public/js/render/vfx/library.js', 'public/js/render/vfx/materials.js',
  'public/js/render/vfx/math.js', 'public/js/render/vfx/mounts.js', 'public/js/render/vfx/psys.js',
  'public/js/render/vfx/rng.js', 'public/js/render/vfx/shapes.js', 'public/js/render/vfx/skillfx.js',
  'public/js/render/vfx/skills.js', 'public/js/render/vfx/system.js', 'public/js/render/vfx/talentfx.js',
  'public/js/render/vfx/talents.js', 'public/js/render/vfx/tier.js', 'public/js/render/vfx/wiring.js',
  'public/js/render/vfx/yuwall.js', 'public/js/ui/gameLogic/settings.js', 'public/js/ui/settings.js',
  'server/http/static.js',
]);
const VISUAL_ADDED_RUNTIME_PATHS = Object.freeze([
  ...RECORDING_ADDED_RUNTIME_PATHS,
  'public/css/assault-bazaar.css', 'public/js/assault/fx-skill-map.json', 'public/js/assault/fxCompat.js', 'public/js/assault/snapCompat.js',
  'public/js/render/manifold.js', 'public/js/render/skillAttack.js', 'public/js/render/vfx/available.js',
  'public/js/render/vfx/clips.js', 'public/js/render/vfx/curves.js', 'public/js/render/vfx/effect.js',
  'public/js/render/vfx/flight.js', 'public/js/render/vfx/funnelfx.js', 'public/js/render/vfx/funnels.js',
  'public/js/render/vfx/geom.js', 'public/js/render/vfx/gl.js', 'public/js/render/vfx/glsl.js',
  'public/js/render/vfx/library.js', 'public/js/render/vfx/materials.js', 'public/js/render/vfx/math.js',
  'public/js/render/vfx/mounts.js', 'public/js/render/vfx/psys.js', 'public/js/render/vfx/rng.js',
  'public/js/render/vfx/shapes.js', 'public/js/render/vfx/skillfx.js', 'public/js/render/vfx/skills.js',
  'public/js/render/vfx/system.js', 'public/js/render/vfx/talentfx.js', 'public/js/render/vfx/talents.js',
  'public/js/render/vfx/tier.js', 'public/js/render/vfx/wiring.js', 'public/js/render/vfx/yuwall.js',
]);
// Dev viewer, extraction tools and the checkout asset manifest: never shipped (the service reads the
// installed manifest in the canonical working tree).
const VISUAL_BUILD_SOURCE_PATHS = Object.freeze([
  '.gitignore', 'data/local-assets.json', 'public/dev/fx-viewer.html', 'public/dev/fx-viewer.js',
  'tools/assault/fx-skill-map.mjs', 'tools/local-extract/extract.py', 'tools/vfx-skill-coverage.mjs',
]);
// Explicit Assault rule changes. Generic simulation, generated native archives,
// other modes and player stores remain outside this update boundary.
const GAMEPLAY_RUNTIME_PATHS = new Set([
  // 10-24 adaptation contract: exact Assault-only event, duration, ammo and ledger helpers.
  'shared/assault/adaptation.js', 'shared/assault/core-adaptations.js', 'shared/assault/run-lifecycle.js',
  'shared/assault/pool-adaptations.js', 'server/sim/content/assault/cards/adaptation-pool.js',
  'shared/assault/ranged-adaptations.js', 'server/sim/content/assault/cards/adaptation-ranged.js',
  'shared/assault/support-adaptations.js', 'server/sim/content/assault/cards/adaptation-support.js',
  'shared/assault/melee-adaptations.js', 'server/sim/content/assault/cards/adaptation-melee.js',
  'shared/assault/caster-adaptations.js', 'server/sim/content/assault/cards/adaptation-caster.js', 'server/sim/content/assault/adaptation-auras.js',
  'shared/assault/frontline-adaptations.js', 'server/sim/content/assault/cards/adaptation-frontline.js',
  'shared/assault/summon-adaptations.js', 'server/sim/content/assault/cards/adaptation-summons.js',
  'shared/assault/special-adaptations.js', 'server/sim/content/assault/cards/adaptation-special.js',
  'shared/assault/advanced-adaptations.js', 'server/sim/content/assault/cards/adaptation-advanced.js', 'server/sim/content/assault/cards/adaptation-native.js',
  'shared/assault/precision-adaptations.js', 'server/sim/content/assault/cards/adaptation-precision.js',
  'shared/assault/late-adaptations.js', 'server/sim/content/assault/cards/adaptation-late.js',
  'shared/assault/cooperative-adaptations.js', 'server/sim/content/assault/cards/adaptation-cooperative.js',
  'shared/assault/companion-adaptations.js', 'server/sim/content/assault/cards/adaptation-companions.js',
  'server/sim/content/assault/runtime.js', 'server/sim/content/assault/ammo.js',
  'server/sim/content/assault/adaptation-primitives.js', 'server/sim/content/assault/adapted-kit.js',
  'server/sim/content/assault/ledger.js', 'server/sim/content/assault/cards/adaptation-core.js',
  'server/sim/content/assault/cards/adaptation-ammo.js', 'server/sim/content/assault/cards/adaptation-workshop.js',
  'server/sim/content/assault/cards/adaptation-deploy.js', 'server/sim/content/assault/cards/adaptation-registry.js',
  'shared/assault/growth-policy.js',
  // Same-slot operator price curve, fixed run map and explicit summon placements.
  'shared/assault/shops.js', 'server/modes/assault/context.js', 'server/sim/content/assault/summons.js',
  // 10-23: the exact reviewed Assault-only helpers. Chapter abilities attach through
  // its content entry; the shared native enemy registry remains byte-identical.
  'server/sim/content/assault/linked-skills.js', 'server/sim/content/assault/skill-resolution.js',
  'server/sim/content/assault/chapter-enemies.js', 'server/sim/content/assault/upgrades.js',
  'shared/assault/global-skill-pool.js', 'shared/assault/skill-resolutions.js',
  'server/sim/content/assault/cards/ranged-elite.js', 'server/sim/content/assault/relics.js',
  'server/modes/assault/battle.js', 'shared/assault/battle-input.js',
  'shared/assault/relic-rules.js', 'shared/assault/run.js',
  'public/js/assault/client-sim.js', 'data/assault-runtime.json',
  'server/sim/content/assault/cards/assault.js', 'server/sim/content/assault/cards/assault-modules.js',
  'server/sim/content/assault/cards/ranged.js', 'server/sim/content/assault/cards/ranged-mid.js',
  'server/sim/content/assault/cards/ranged-plans.js',
  'server/sim/content/assault/cards/ranged-elite/tokens.js',
  'server/sim/content/assault/cards/latest-operators.js', 'server/sim/content/assault/cards/support.js',
  'server/sim/content/assault/cards/support-modules.js', 'server/sim/content/assault/cards/support-instant.js',
  'server/sim/content/assault/primitives.js',
  // Bazaar-style card rewrite: card-line triggers, device bridge and collectible rewiring.
  'server/sim/content/assault/events.js', 'server/sim/content/assault/relics/helpers.js',
  'server/sim/content/assault/cards/support-plans.js', 'server/sim/content/assault/cards/support-retained-extra.js',
  'server/sim/content/assault/cards/support-tokens.js',
  'server/sim/content/assault/cards/assault-bazaar.js', 'server/sim/content/assault/cards/ranged-bazaar.js',
  'server/sim/content/assault/cards/support-bazaar.js',
  // Bazaar closing round: token kits of the assault and ranged families follow their cards too.
  'server/sim/content/assault/cards/assault-tokens.js', 'server/sim/content/assault/cards/ranged-tokens.js',
  // Synergy primitives (triggers, SP tools, air block, stacks, growth) and the in-place 再部署 loop, installed by the
  // assault content entry; the native battle files stay unchanged.
  'server/sim/content/assault/index.js', 'server/sim/content/assault/synergy.js', 'server/sim/content/assault/redeploy-cycle.js',
  // Synergy cards: card lines wired from their compiled data, one kit file per family, registered over the old kits.
  'server/sim/content/assault/card-lines.js', 'server/sim/content/assault/cards/registry.js',
  'server/sim/content/assault/cards/synergy-assault.js', 'server/sim/content/assault/cards/synergy-ranged.js',
  'server/sim/content/assault/cards/synergy-support.js',
  // 卡内本局永久成长 (piece.permanentCounters): applied at settlement, summed when stars merge, checked when a save loads
  'shared/assault/inventory.js', 'server/modes/assault/store.js',
  // Opening entry is free and immediate (design 4.3): the one Assault branch of the native deploy path, covered by the full gameplay gate.
  'server/sim/battle/deploy.js',
  // Paced encounter waves (tools/assault/wave-pacing.mjs); battles read wave.spawns from this rules file.
  'data/assault-design/encounters.json',
  'data/assault-design/events.json', // repeatable free rest stop used by the one-shop/event/reward supply flow
  // 10-22 feedback fixes: the stage floors (活性源石 沼泽 烟雾 深水 气流) are installed in the assault
  // branch of the shared content installer; the in-place redeploy cue floats its text on canvas
  // (the bitmap font has no CJK glyphs).
  'server/sim/content/index.js', 'public/js/render/fx/numbers.js', 'public/js/render/fx/system.js',
  ...VISUAL_RUNTIME_PATHS,
]);
// Exact reviewed new helper. This is not permission to install arbitrary new
// modules or overwrite an unregistered file already present in the release.
const GAMEPLAY_ADDED_RUNTIME_PATHS = new Set(['server/sim/content/assault/cards/support-instant.js',
  'shared/assault/adaptation.js', 'shared/assault/core-adaptations.js',
  'shared/assault/pool-adaptations.js', 'server/sim/content/assault/cards/adaptation-pool.js',
  'shared/assault/ranged-adaptations.js', 'server/sim/content/assault/cards/adaptation-ranged.js',
  'shared/assault/support-adaptations.js', 'server/sim/content/assault/cards/adaptation-support.js',
  'shared/assault/melee-adaptations.js', 'server/sim/content/assault/cards/adaptation-melee.js',
  'shared/assault/caster-adaptations.js', 'server/sim/content/assault/cards/adaptation-caster.js', 'server/sim/content/assault/adaptation-auras.js',
  'shared/assault/frontline-adaptations.js', 'server/sim/content/assault/cards/adaptation-frontline.js',
  'shared/assault/summon-adaptations.js', 'server/sim/content/assault/cards/adaptation-summons.js',
  'shared/assault/special-adaptations.js', 'server/sim/content/assault/cards/adaptation-special.js',
  'shared/assault/advanced-adaptations.js', 'server/sim/content/assault/cards/adaptation-advanced.js', 'server/sim/content/assault/cards/adaptation-native.js',
  'shared/assault/precision-adaptations.js', 'server/sim/content/assault/cards/adaptation-precision.js',
  'shared/assault/late-adaptations.js', 'server/sim/content/assault/cards/adaptation-late.js',
  'shared/assault/cooperative-adaptations.js', 'server/sim/content/assault/cards/adaptation-cooperative.js',
  'shared/assault/companion-adaptations.js', 'server/sim/content/assault/cards/adaptation-companions.js',
  'server/sim/content/assault/adaptation-primitives.js', 'server/sim/content/assault/adapted-kit.js',
  'server/sim/content/assault/ledger.js', 'server/sim/content/assault/cards/adaptation-core.js',
  'server/sim/content/assault/cards/adaptation-ammo.js', 'server/sim/content/assault/cards/adaptation-workshop.js',
  'server/sim/content/assault/cards/adaptation-deploy.js', 'server/sim/content/assault/cards/adaptation-registry.js',
  'shared/assault/growth-policy.js',
  'server/sim/content/assault/linked-skills.js', 'server/sim/content/assault/skill-resolution.js',
  'server/sim/content/assault/chapter-enemies.js',
  'shared/assault/global-skill-pool.js', 'shared/assault/skill-resolutions.js',
  'server/sim/content/assault/cards/assault-bazaar.js', 'server/sim/content/assault/cards/ranged-bazaar.js',
  'server/sim/content/assault/cards/support-bazaar.js', 'server/sim/content/assault/synergy.js',
  'server/sim/content/assault/redeploy-cycle.js', 'server/sim/content/assault/card-lines.js',
  'server/sim/content/assault/cards/synergy-assault.js', 'server/sim/content/assault/cards/synergy-ranged.js',
  'server/sim/content/assault/cards/synergy-support.js', ...VISUAL_ADDED_RUNTIME_PATHS]);
const GAMEPLAY_BUILD_SOURCE_PATHS = new Set([
  // P4 deterministic test players and evidence; never server/browser runtime.
  'tools/assault/campaign-evidence.mjs', 'tools/assault/campaign-player.mjs',
  'tools/assault/line-builder.mjs', 'tools/assault/line-builder-check.mjs',
  'tools/assault/line-builds.json', 'tools/assault/line-campaign.mjs',
  'tools/assault/typed-card-samples.mjs', 'tools/assault/typed-card-acceptance.mjs',
  'tools/assault/position-check.mjs',
  'tools/assault/adaptation-authoring.mjs', 'tools/assault/check-adaptation-quotas.mjs',
  'tools/assault/build-adaptation-roster.mjs', 'data/assault-design/adaptation-roster.json',
  'tools/assault/native-skill-identities.mjs',
  'tools/assault/chapter-enemy-sets.mjs', 'tools/assault/chapter-enemy-assets.mjs',
  'tools/assault/revise-skill-resolutions.mjs',
  'data/assault-design/roster-ranged.json', 'tools/assault/build-runtime-data.mjs',
  'tools/assault/test-resource-loader.mjs', 'tools/assault/verify-gameplay.mjs',
  'data/assault-design/roster-assault.json', 'data/assault-design/roster-support.json',
  'tools/assault/instant-source.mjs', 'tools/assault/check-skill-contracts.mjs',
  'tools/assault/probe-skill-repair.mjs',
  'tools/assault/refresh-ranged-coverage.mjs', 'data/assault-coverage-ranged.json',
  'data/assault-coverage-ranged-mid.json', 'data/assault-coverage-ranged-elite.json',
  'data/assault-design/bazaar-cards-assault.json', 'data/assault-design/bazaar-cards-ranged.json',
  'data/assault-design/bazaar-cards-support.json', 'data/assault-design/bazaar-collectibles.json',
  'tools/assault/check-bazaar-style.mjs', 'tools/assault/check-base.mjs', 'tools/assault/import-synergy-design.mjs',
  // Test coverage ledgers and their generator: build-time evidence, never shipped as rules.
  'tools/assault/assault-modules-coverage.mjs', 'data/assault-coverage-assault-modules.json',
  'data/assault-coverage-assault.json', 'data/assault-coverage-support.json', 'data/assault-coverage-support-modules.json',
  // Synergy support ledgers (rebuilt from the synergy-support tests) and the Amiya forms the synergy importer writes.
  'tools/assault/refresh-support-coverage.mjs', 'data/assault-coverage-support-retained-extra.json', 'data/assault-design/forms.json',
  // Wave pacing generator and its winnability replay.
  'tools/assault/wave-pacing.mjs', 'tools/assault/wave-replay.mjs',
  ...VISUAL_BUILD_SOURCE_PATHS,
]);

export function assertAssaultGameplayCoreEquivalent({ canonicalRoot, proof, sourceRevision, validationPath, requireExact = true }) {
  validationPath = requireAbsolute(validationPath, '--validation-receipt');
  ensureUnder(path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.runtime), validationPath);
  const validation = JSON.parse(fs.readFileSync(assertNoReparse(validationPath), 'utf8'));
  const validatedRevision = validation.nativeSourceCommit;
  if (validation.schema !== 'assault-gameplay-validation/v1' || validation.status !== 'pass'
    || validation.sourceClean !== true || validation.exitCode !== 0
    || validation.engineRevision !== '1a2eb3811b7ad622008441eb81d8280966c4e3cd'
    || (requireExact ? validatedRevision !== sourceRevision : !isGitAncestor(canonicalRoot, validatedRevision, sourceRevision)))
    throw new Error('Assault gameplay validation does not cover this clean native source revision');
  const required = ['collection-redesign', 'relic-rules', 'relics', 'relic-ammo-element-behavior',
    'relic-heal-block-behavior', 'relic-redeploy-summon-cross-behavior', 'relic-cold-behavior',
    'relic-cycle-pierce', 'relic-boss-pool-behavior', 'summon-relic-income'];
  if (git(canonicalRoot, 'ls-tree', '--name-only', sourceRevision, '--', 'shared/assault/adaptation.js').trim()) {
    const quota = validation.adaptationQuota;
    if (quota?.status !== 'pass' || quota.exitCode !== 0 || quota.sourceClean !== true || quota.sourceRevision !== validatedRevision
      || !['core', 'full'].includes(quota.scope) || (quota.scope === 'full' && (quota.adapted !== 172 || quota.pending !== 0)))
      throw new Error('Assault adaptation release lacks a passing quota gate for this exact source');
    required.push('synergy-adaptation-rules', 'synergy-adaptation-core', 'synergy-adaptation-ammo', 'synergy-adaptation-workshop', 'synergy-adaptation-deploy', 'synergy-adaptation-modules');
  }
  if (git(canonicalRoot,'diff','--name-only',proof.sourceRevision,sourceRevision,'--',
    'server/sim/content/assault/cards/support-instant.js'))required.push('skill-source-contract','skill-instant-melee',
      'skill-instant-ranged','skill-instant-support','skill-instant-flow','cards-ranged','cards-ranged-mid','cards-ranged-elite','public-text');
  if (!required.every(name => validation.suites?.includes(`test/assault/${name}.test.mjs`))
    || !(validation.testResults?.passed > 0) || validation.testResults.failed !== 0
    || validation.testResults.skipped !== 0 || validation.testResults.cancelled !== 0)
    throw new Error('Assault gameplay validation lacks its real consumer regression suites');
  if (!['data/assault-runtime.json', 'data/assault-public-text.json'].every(sourceGitPath =>
    validation.nativeArtifactBindings?.some(binding => binding.sourceGitPath === sourceGitPath
      && binding.nativeGitCommit === validatedRevision && binding.bytewiseMatched === true)))
    throw new Error('Assault gameplay validation inputs lack their exact native Git artifact binding');
  const comparedPaths = [...new Set([...NATIVE_ENGINE_PROOF_SOURCE_SCOPE, ...proof.comparedPaths])].sort();
  const changedPaths = git(canonicalRoot, 'diff', '--name-only', proof.sourceRevision, sourceRevision, '--', ...comparedPaths).split(/\r?\n/).filter(Boolean);
  const forbidden = changedPaths.filter(p => !GAMEPLAY_RUNTIME_PATHS.has(p));
  if (forbidden.length) throw new Error(`native core changed outside reviewed Assault content: ${forbidden.join(', ')}`);
  const unvalidated = git(canonicalRoot, 'diff', '--name-only', validatedRevision, sourceRevision, '--', ...GAMEPLAY_RUNTIME_PATHS).trim();
  if (unvalidated) throw new Error(`Assault gameplay changed after validation: ${unvalidated}`);
  return { equivalent: changedPaths.length === 0, proofRevision: proof.sourceRevision, sourceRevision, comparedPaths, changedPaths,
    reviewedContentDelta: { kind: 'assault-gameplay', from: proof.sourceRevision, to: validatedRevision,
      changedPaths, validationReceipt: validationPath, nativeCoreUnchanged: true,
      scope: 'Original HTTP proof retained for unchanged native core; changed Assault rules covered by the named real-consumer regression, not claimed byte-equivalent.' } };
}

function isTransportOnlyDiff(canonicalRoot, fromRevision, toRevision) {
  if (!isGitAncestor(canonicalRoot, fromRevision, toRevision))
    throw new Error(`compatible source is not an ancestor of target: ${fromRevision} -> ${toRevision}`);
  const paths = git(canonicalRoot, 'diff', '--name-only', fromRevision, toRevision).split(/\r?\n/).filter(Boolean);
  for (const item of paths) {
    if (/^(?:docs?|test|tests|\.omni)\//i.test(item) || /\.md$/i.test(item)) continue;
    if (!TRANSPORT_ONLY_PATHS.has(item)) return { compatible: false, changedPaths: paths };
  }
  return { compatible: true, changedPaths: paths };
}

export function planAssaultReleaseUpdateFromGit({ canonicalRoot, sourceCommit, updateKind = 'transport', validationPath, repinInstallData = false }) {
  if (!['transport', 'content', 'gameplay'].includes(updateKind)) throw new Error(`unsupported Assault update kind: ${updateKind}`);
  canonicalRoot = requireAbsolute(canonicalRoot, '--canonical-root');
  if (!samePath(gitRoot(canonicalRoot), canonicalRoot)) throw new Error(`canonical root is not the repository root: ${canonicalRoot}`);
  const sourceRevision = git(canonicalRoot, 'rev-parse', `${sourceCommit}^{commit}`);
  if (git(canonicalRoot, 'cat-file', '-t', sourceRevision) !== 'commit') throw new Error(`update source is not recoverable: ${sourceCommit}`);
  const codeRoot = path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.code);
  const rulesRoot = path.join(canonicalRoot, CANONICAL_RELEASE_PATHS.rules);
  const manifestPath = path.join(codeRoot, 'assault-release.json');
  const copyPath = path.join(codeRoot, 'copy.json');
  const packagePath = path.join(codeRoot, 'package.json');
  assertNoReparse(codeRoot); assertNoReparse(rulesRoot);
  const manifestBytes = fs.readFileSync(manifestPath), copyBytes = fs.readFileSync(copyPath), packageBytes = fs.readFileSync(packagePath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const copy = JSON.parse(copyBytes.toString('utf8'));
  if (manifest.schema !== 'assault-release/v1' || manifest.status !== 'pass' || manifest.adoptionStatus !== 'adopted')
    throw new Error('Assault update requires a passing adopted release manifest');
  for (const [name, expected] of [['canonical', canonicalRoot], ['code', codeRoot], ['rules', rulesRoot]])
    if (!samePath(manifest.roots?.[name], expected)) throw new Error(`adopted manifest ${name} root mismatch`);
  const oldRevision = manifest.source?.nativeGitCommit;
  if (!/^[0-9a-f]{40}$/.test(oldRevision || '') || git(canonicalRoot, 'cat-file', '-t', oldRevision) !== 'commit')
    throw new Error('adopted release source commit is not recoverable');
  if (copy.schema !== 'assault-code-adoption/v1' || copy.status !== 'pass'
    || !samePath(copy.manifest, manifestPath) || copy.source?.nativeGitCommit !== oldRevision)
    throw new Error('adoption receipt does not match the current release source and manifest');
  if (!isGitAncestor(canonicalRoot, oldRevision, sourceRevision))
    throw new Error(`update source is not a descendant of adopted source ${oldRevision}`);
  const proof = manifest.nativeEngineProof;
  if (!proof || proof.status !== 'pass' || !Array.isArray(proof.comparedPaths)) throw new Error('release lacks native engine proof scope');
  const proofEquivalence = updateKind === 'gameplay' || proof.reviewedContentDelta
    ? assertAssaultGameplayCoreEquivalent({ canonicalRoot, proof, sourceRevision,
      validationPath: validationPath ?? proof.reviewedContentDelta?.validationReceipt, requireExact: updateKind === 'gameplay' })
    : assertNativeProofScopedEquivalent({ canonicalRoot,
      proofRevision: proof.sourceRevision, sourceRevision, comparedPaths: proof.comparedPaths });
  const oldRows = manifest.files.filter((row) => !row.metadata);
  for (const row of oldRows) {
    if (!row.targetIdentity || !row.bytewiseVerified) throw new Error(`release row lacks native proof: ${row.targetPath}`);
    const current = fileIdentity(row.targetPath);
    if (!sameIdentity(row.targetIdentity, current) || current.bytes !== row.storedBytes)
      throw new Error(`adopted release target identity changed: ${row.targetPath}`);
  }
  const references = [], repinnedReferences = [];
  for (const reference of manifest.references ?? []) {
    const current = nativePathIdentity(reference.targetPath);
    if (sameIdentity(reference.targetIdentity, current) && current.bytes === reference.storedBytes) { references.push(reference); continue; }
    // The installed local-art manifest belongs to the canonical working tree, not to the release. Only an
    // explicitly requested update re-pins it, after checking it is still a JSON manifest; every other reference stays fixed.
    if (!repinInstallData || reference.role !== 'canonical-readonly-install-data')
      throw new Error(`canonical release reference changed: ${reference.targetPath}`);
    const parsed = JSON.parse(fs.readFileSync(reference.targetPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error(`re-pinned install data is not a JSON manifest: ${reference.targetPath}`);
    const identity = fileIdentity(reference.targetPath);
    repinnedReferences.push({ targetPath: reference.targetPath, role: reference.role, before: reference.targetIdentity, after: identity });
    references.push({ ...reference, identity, sourceIdentity: identity, targetIdentity: identity, storedBytes: identity.bytes });
  }
  const changedPaths = git(canonicalRoot, 'diff', '--name-only', oldRevision, sourceRevision)
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const classified = classifyAssaultReleaseUpdateChanges({ changedPaths, oldRows, codeRoot, rulesRoot, updateKind });
  if (!classified.selected.length) throw new Error('update has no changed adopted Assault source modules');
  for (const item of classified.selected) if (updateKind === 'transport' && !TRANSPORT_ONLY_PATHS.has(item.sourceGitPath))
    throw new Error(`release update cannot claim transport-only compatibility for ${item.sourceGitPath}`);
  const blobs = readNativeGitBlobBatch(canonicalRoot, sourceRevision, classified.selected.map((item) => item.sourceGitPath));
  for(const item of classified.selected.filter(item=>item.added)){
    for(const {spec}of findSpecifiers(blobs.get(item.sourceGitPath).toString('utf8'))){
      if(spec.startsWith('node:'))continue; // Node built-ins (the recording routes use fs / zlib / crypto)
      if(!spec.startsWith('.'))throw new Error(`new Assault helper imports an unsupported external module: ${spec}`);
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(item.sourceGitPath),spec));
      if(dependency.startsWith('../')||!oldRows.some(row=>releaseSourceRelative(codeRoot,row.targetPath)===dependency)
        &&!classified.selected.some(other=>other.sourceGitPath===dependency))
        throw new Error(`new Assault helper dependency is not in the adopted module graph: ${dependency}`);
    }
  }
  for (const item of classified.selected) {
    if(item.added){
      assertNoReparse(item.row.targetPath,{allowMissing:true});
      if(fs.existsSync(item.row.targetPath)||git(canonicalRoot,'ls-tree',oldRevision,'--',item.sourceGitPath))
        throw new Error(`new runtime module conflicts with a pre-existing target/source: ${item.row.targetPath}`);
      item.oldIdentity=null;item.oldBytes=Buffer.alloc(0);item.newBytes=blobs.get(item.sourceGitPath);continue;
    }
    const oldBlob = gitBlob(canonicalRoot, oldRevision, item.sourceGitPath);
    const actual = fs.readFileSync(item.row.targetPath);
    assertReleaseTargetMatchesNativeBlob(actual, oldBlob, item.row.targetPath);
    item.oldIdentity = fileIdentity(item.row.targetPath);
    item.oldBytes = actual;
    item.newBytes = blobs.get(item.sourceGitPath);
  }
  const priorCompatible = manifest.source.compatibleNativeSourceCommits ?? [];
  if (!Array.isArray(priorCompatible) || priorCompatible.some((commit) => !/^[0-9a-f]{40}$/.test(commit)))
    throw new Error('prior compatible native source list is malformed');
  const compatible = updateKind !== 'transport' ? [] : [...new Set([...priorCompatible, oldRevision])];
  for (const commit of compatible) {
    if (git(canonicalRoot, 'cat-file', '-t', commit) !== 'commit') throw new Error(`compatible source commit is unrecoverable: ${commit}`);
    if (!isGitAncestor(canonicalRoot, commit, oldRevision)) throw new Error(`prior compatible source is not an ancestor of adopted source: ${commit}`);
    const lineage = isTransportOnlyDiff(canonicalRoot, commit, sourceRevision);
    if (!lineage.compatible) throw new Error(`compatible source history contains non-transport changes: ${lineage.changedPaths.filter((p) => !TRANSPORT_ONLY_PATHS.has(p)).join(', ')}`);
  }
  if (updateKind === 'transport' && classified.selected.some((item) => !TRANSPORT_ONLY_PATHS.has(item.sourceGitPath)))
    throw new Error('native source compatibility is limited to Assault HTTP and release producer paths');
  const nativeSourceUpgradeProof = { status: 'pass', from: oldRevision, to: sourceRevision,
    kind: updateKind, changedCodePaths: classified.selected.map((item) => item.sourceGitPath), unchangedRules: !classified.selected.some(item => item.sourceGitPath.startsWith('data/')),
    unchangedEngineProof: proofEquivalence.equivalent, unchangedNativeCore: true,
    ...(proofEquivalence.reviewedContentDelta ? { gameplayValidation: proofEquivalence.reviewedContentDelta } : {}),
    ...(repinnedReferences.length ? { repinnedReferences } : {}),
    transportOnly: classified.selected.every((item) => TRANSPORT_ONLY_PATHS.has(item.sourceGitPath)) };
  if (updateKind === 'transport' && !nativeSourceUpgradeProof.transportOnly) throw new Error('update does not meet transport-only compatibility scope');
  return { schema: 'assault-git-update-plan/v1', status: 'planned', adoptionStatus: 'pending', canonicalRoot,
    codeRoot, rulesRoot, manifestPath, copyPath, packagePath, oldRevision, sourceRevision,
    oldVersion: manifest.source.version, newVersion: manifest.source.version,
    updateKind, compatibleNativeSourceCommits: compatible, nativeSourceUpgradeProof,
    manifest, copy, package: JSON.parse(packageBytes.toString('utf8')), manifestBytes, copyBytes, packageBytes,
    metadataIdentities: { manifest: fileIdentity(manifestPath), copy: fileIdentity(copyPath), package: fileIdentity(packagePath) },
    selected: classified.selected, ignoredPaths: classified.ignored, changedPaths, proofEquivalence, references, repinnedReferences };
}

export function adoptAssaultReleaseUpdate(plan) {
  if (!plan || plan.schema !== 'assault-git-update-plan/v1') throw new Error('invalid Assault Git update plan');
  if (git(plan.canonicalRoot, 'rev-parse', `${plan.sourceRevision}^{commit}`) !== plan.sourceRevision
    || !isGitAncestor(plan.canonicalRoot, plan.oldRevision, plan.sourceRevision))
    throw new Error('update Git ancestry changed after planning');
  for (const [name, target, bytes] of [['manifest', plan.manifestPath, plan.manifestBytes], ['copy', plan.copyPath, plan.copyBytes], ['package', plan.packagePath, plan.packageBytes]]) {
    if (!sameIdentity(plan.metadataIdentities[name], fileIdentity(target)) || !fs.readFileSync(target).equals(bytes))
      throw new Error(`release ${name} changed after update planning: ${target}`);
  }
  for (const reference of plan.references ?? []) {
    const current = nativePathIdentity(reference.targetPath);
    if (!sameIdentity(reference.targetIdentity, current) || current.bytes !== reference.storedBytes)
      throw new Error(`canonical release reference changed after update planning: ${reference.targetPath}`);
  }
  for (const item of plan.selected) {
    if(item.added){
      assertNoReparse(item.row.targetPath,{allowMissing:true});
      if(fs.existsSync(item.row.targetPath))throw new Error(`new release module appeared after planning: ${item.row.targetPath}`);
      continue;
    }
    if (!sameIdentity(item.oldIdentity, fileIdentity(item.row.targetPath)) || !fs.readFileSync(item.row.targetPath).equals(item.oldBytes))
      throw new Error(`release target changed after update planning: ${item.row.targetPath}`);
  }
  const changed = [], metadataWritten = [], createdDirs = [];
  try {
    for (const item of plan.selected) {
      // A new module may sit in a new directory under the code root (e.g. public/js/render/vfx/).
      if (item.added) mkdirTracked(path.dirname(item.row.targetPath), createdDirs);
      fs.writeFileSync(item.row.targetPath, item.newBytes,item.added?{flag:'wx'}:undefined);
      const after = fileIdentity(item.row.targetPath);
      changed.push({ item, after });
      if ((!item.added&&(after.device !== item.oldIdentity.device || after.fileId !== item.oldIdentity.fileId || after.links !== item.oldIdentity.links))
        || after.links!==1
        || !fs.readFileSync(item.row.targetPath).equals(item.newBytes)) throw new Error(`in-place source update proof failed: ${item.row.targetPath}`);
      item.row.sourceIdentity = null; item.row.targetIdentity = after; item.row.logicalBytes = item.newBytes.length;
      item.row.storedBytes = item.newBytes.length; item.row.bytewiseVerified = true; item.row.identityPreserved = false;
      item.row.sourceCommit = plan.sourceRevision; item.row.sourceGitPath = item.sourceGitPath;
      item.row.restorationMethod = 'git-show-exact-blob-in-place-update';
    }
    const priorUpdates = Array.isArray(plan.manifest.releaseUpdates) ? plan.manifest.releaseUpdates : [];
    const updateRecord = { fromCommit: plan.oldRevision, toCommit: plan.sourceRevision, fromVersion: plan.oldVersion,
      toVersion: plan.newVersion, rollbackSourceCommit: plan.oldRevision, changedPaths: plan.selected.map((x) => x.sourceGitPath),
      ignoredSourcePaths: plan.ignoredPaths, ...(plan.repinnedReferences?.length ? { repinnedReferences: plan.repinnedReferences } : {}),
      previousLogicalBytes: plan.selected.reduce((sum, item) => sum + item.oldBytes.length, 0),
      updatedLogicalBytes: plan.selected.reduce((sum, item) => sum + item.newBytes.length, 0) };
    const oldBytes = plan.selected.reduce((s, item) => s + item.oldBytes.length, 0);
    const newBytes = plan.selected.reduce((s, item) => s + item.newBytes.length, 0);
    const totals = { ...plan.manifest.totals, codeAndRulesBytes: plan.manifest.totals.codeAndRulesBytes + newBytes - oldBytes,
      updatedFiles: (plan.manifest.totals.updatedFiles || 0) + plan.selected.length,
      updatedBytes: (plan.manifest.totals.updatedBytes || 0) + newBytes };
    const files = [...plan.manifest.files.filter((row) => !row.metadata),...plan.selected.filter(item=>item.added).map(item=>item.row)].map((row) => ({ ...row }));
    const { metadata } = buildAssaultReleaseManifest({ roots: plan.manifest.roots,
      source: { ...plan.manifest.source, nativeGitCommit: plan.sourceRevision,
        compatibleNativeSourceCommits: plan.compatibleNativeSourceCommits }, sourceRoot: plan.copy.source?.sourceRoot,
      version: plan.newVersion, package: plan.package, generatedMetadata: [plan.packagePath, plan.manifestPath, plan.copyPath].map((target) => ({ target })),
      files, engineFallbacks: plan.manifest.engineFallbacks, references: plan.references ?? plan.manifest.references, totals,
      rules: plan.manifest.rules, proofEquivalence: plan.proofEquivalence,
      nativeSourceUpgradeProof: plan.nativeSourceUpgradeProof,
      releaseUpdates: [...priorUpdates, updateRecord] });
    for (const meta of metadata) {
      const before = fs.readFileSync(meta.target); const identity = fileIdentity(meta.target);
      fs.writeFileSync(meta.target, meta.contents);
      if (!fs.readFileSync(meta.target).equals(meta.contents)) throw new Error(`updated metadata byte proof failed: ${meta.target}`);
      metadataWritten.push({ target: meta.target, before, written: meta.contents, identity: fileIdentity(meta.target), beforeIdentity: identity });
    }
    return { status: 'pass', adoptionStatus: 'adopted', sourceCommit: plan.sourceRevision, changedFiles: changed.length,
      changedPaths: plan.selected.map((item) => item.sourceGitPath), manifest: plan.manifestPath, copyReceipt: plan.copyPath };
  } catch (error) {
    const rollbackErrors = [], rewritten = [];
    for (const row of [...metadataWritten].reverse()) try {
      const now = fileIdentity(row.target);
      if (now.device !== row.identity.device || now.fileId !== row.identity.fileId || !fs.readFileSync(row.target).equals(row.written))
        throw new Error(`metadata changed before rollback: ${row.target}`);
      fs.writeFileSync(row.target, row.before);
      rewritten.push({ target: row.target, mtimeNs: row.beforeIdentity.mtimeNs });
    } catch (e) { rollbackErrors.push(String(e)); }
    for (const { item, after } of [...changed].reverse()) try {
      const now = fileIdentity(item.row.targetPath);
      if (now.device !== after.device || now.fileId !== after.fileId || !fs.readFileSync(item.row.targetPath).equals(item.newBytes))
        throw new Error(`updated target changed before rollback: ${item.row.targetPath}`);
      if(item.added){fs.unlinkSync(item.row.targetPath);continue;}
      fs.writeFileSync(item.row.targetPath, item.oldBytes);
      if (!fs.readFileSync(item.row.targetPath).equals(item.oldBytes)) throw new Error(`rollback byte verification failed: ${item.row.targetPath}`);
      rewritten.push({ target: item.row.targetPath, mtimeNs: item.oldIdentity.mtimeNs });
    } catch (e) { rollbackErrors.push(String(e)); }
    rollbackErrors.push(...restoreNativeMtimes(rewritten));
    for (const dir of [...createdDirs].reverse()) try { fs.rmdirSync(dir); } catch (e) { rollbackErrors.push(String(e)); }
    if (rollbackErrors.length) error.message += `; update rollback incomplete: ${rollbackErrors.join(' | ')}`;
    throw error;
  }
}

export function selectedTrackedStatus(sourceRoot, paths, commandBudget = 12000) {
  const results=[];let batch=[],chars=0;
  function flush(){if(batch.length){const value=git(sourceRoot,'status','--porcelain','--untracked-files=no','--',...batch);if(value)results.push(value);batch=[];chars=0;}}
  for(const relative of [...new Set(paths)]){
    if(typeof relative!=='string'||!relative)throw new Error('selected source path is missing');
    const cost=relative.length+3;
    if(cost>commandBudget)throw new Error(`selected source path exceeds native command budget: ${relative}`);
    if(chars+cost>commandBudget)flush();batch.push(relative);chars+=cost;
  }
  flush();return results.join('\n');
}

export function movePlanFiles(plan, { afterMove = null, afterMetadata = null } = {}) {
  const moved = [];
  const createdDirs = [];
  try {
    if (!plan || !Array.isArray(plan.files)) throw new Error('invalid Assault release plan');
    const movable = plan.files.filter((row) => row.adopt);
    if (plan.sourceRoot && plan.sourceRevision) {
      if (git(plan.sourceRoot, 'rev-parse', 'HEAD') !== plan.sourceRevision)
        throw new Error('source HEAD changed after the Assault release plan was created');
      const selected = movable.map((row) => row.sourceRelative);
      const dirty = selectedTrackedStatus(plan.sourceRoot, selected);
      if (dirty) throw new Error(`selected Assault release source changed after planning:\n${dirty}`);
    }
    for (const row of movable) {
      const now = fileIdentity(row.source);
      if (!sameIdentity(row.identity, now)) throw new Error(`source file identity changed since plan: ${row.source}`);
      assertNoReparse(row.target, { allowMissing: true });
      if (fs.existsSync(row.target)) throw new Error(`Assault release target conflict: ${row.target}`);
      if (path.parse(row.source).root.toLowerCase() !== path.parse(row.target).root.toLowerCase()) throw new Error(`cross-volume adopt refused: ${row.source} -> ${row.target}`);
    }
    for (const row of movable) {
      mkdirTracked(path.dirname(row.target), createdDirs);
      const beforeBytes = fs.readFileSync(row.source);
      const sourceIdentity = fileIdentity(row.source);
      fs.renameSync(row.source, row.target);
      moved.push(row);
      const after = fileIdentity(row.target);
      const afterBytes = fs.readFileSync(row.target);
      if (!sameIdentity(row.identity, after)) throw new Error(`native file identity changed during adoption: ${row.target}`);
      if (!beforeBytes.equals(afterBytes)) throw new Error(`full byte comparison failed during adoption: ${row.target}`);
      row.sourceIdentity = sourceIdentity; row.targetIdentity = after;
      row.bytewiseVerified = true; row.identityPreserved = true; row.adopted = true;
      afterMove?.(row, moved.length);
    }
    plan.status = 'pass'; plan.adoptionStatus = 'adopted';
    const { releaseManifest, metadata } = buildAssaultReleaseManifest(plan);
    for (const [metadataIndex, meta] of metadata.entries()) {
      mkdirTracked(path.dirname(meta.target), createdDirs);
      if (fs.existsSync(meta.target)) throw new Error(`Assault release target conflict: ${meta.target}`);
      try {
        fs.writeFileSync(meta.target, meta.contents, { flag: 'wx' });
        const identity = fileIdentity(meta.target);
        if (identity.bytes !== meta.contents.length) throw new Error(`generated metadata byte count mismatch: ${meta.target}`);
        moved.push({ target: meta.target, generated: true, identity, generatedBytes: meta.contents });
      } catch (writeError) {
        if (fs.existsSync(meta.target) && !moved.some((row) => row.target === meta.target)) {
          const partialIdentity = fileIdentity(meta.target);
          const partialBytes = fs.readFileSync(meta.target);
          moved.push({ target: meta.target, generated: true, identity: partialIdentity, generatedBytes: partialBytes });
        }
        throw writeError;
      }
      afterMetadata?.(meta, metadataIndex);
    }
    return { status: 'pass', adoptionStatus: 'adopted', moved: moved.length, movedFiles: movable.length, createdDirs,
      manifest: path.join(plan.roots.code, 'assault-release.json'), copyReceipt: path.join(plan.roots.code, 'copy.json'),
      releaseManifest };
  } catch (error) {
    const rollbackErrors = [];
    for (const row of [...moved].reverse()) {
      try {
        if (row.generated) {
          const current = fileIdentity(row.target);
          if (!sameIdentity(row.identity, current) || !fs.readFileSync(row.target).equals(row.generatedBytes))
            throw new Error(`generated metadata changed before rollback: ${row.target}`);
          fs.unlinkSync(row.target);
        }
        else {
          mkdirTracked(path.dirname(row.source), createdDirs);
          if (fs.existsSync(row.source)) throw new Error(`rollback source conflict: ${row.source}`);
          if (!sameIdentity(row.identity, fileIdentity(row.target))) throw new Error(`rollback target changed: ${row.target}`);
          fs.renameSync(row.target, row.source);
          if (!sameIdentity(row.identity, fileIdentity(row.source))) throw new Error(`rollback identity changed: ${row.source}`);
        }
      } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    for (const dir of [...new Set(createdDirs)].sort((a, b) => b.length - a.length)) {
      try { fs.rmdirSync(dir); } catch (removeError) { if (removeError.code !== 'ENOENT' && removeError.code !== 'ENOTEMPTY') rollbackErrors.push(String(removeError)); }
    }
    plan.status = 'failed'; plan.adoptionStatus = 'failed';
    for (const row of moved.filter((item) => !item.generated)) {
      if (fs.existsSync(row.source) && !fs.existsSync(row.target)) {
        row.sourceIdentity = fileIdentity(row.source); row.targetIdentity = null;
        row.bytewiseVerified = false; row.identityPreserved = null; row.adopted = false;
      }
    }
    if (rollbackErrors.length) error.message += `; rollback incomplete: ${rollbackErrors.join(' | ')}`;
    throw error;
  }
}

function defaultRelease(args) {
  const output = requireAbsolute(args.get('--output'), '--output');
  const canonical = requireAbsolute(args.get('--source-root'), '--source-root');
  if (fs.existsSync(output)) throw new Error('use a fresh release batch');
  assertNoReparse(output, { allowMissing: true });
  const revision = git(canonical, 'rev-parse', args.get('--revision') ? `${args.get('--revision')}^{commit}` : 'HEAD');
  const selected = ['server', 'shared', 'public/independent.html', 'public/js/hostingBootstrap.js', 'public/js/hostingWait.js', 'public/js/ui/assetUrls.js', 'LICENSE'];
  if (git(canonical, 'status', '--porcelain', '--untracked-files=no', '--', ...selected, 'data', 'package-lock.json'))
    throw new Error('selected release source must be committed');
  fs.mkdirSync(output, { recursive: true });
  const codeArchive = path.join(output, 'server-code.tar'); const rulesArchive = path.join(output, 'public-rules.tar');
  execFileSync('git', ['-C', canonical, 'archive', '--format=tar', `--output=${codeArchive}`, revision, ...selected]);
  execFileSync('git', ['-C', canonical, 'archive', '--format=tar', `--output=${rulesArchive}`, revision, 'data']);
  const sourceLock = JSON.parse(git(canonical, 'show', `${revision}:package-lock.json`)); const ws = sourceLock.packages['node_modules/ws'];
  const manifest = { name: 'stronghold-protocol-control-server', version: '1.0.0', private: true, type: 'module', engines: { node: '>=22' }, dependencies: { ws: ws.version } };
  const pkgPath = path.join(output, 'package.json'); const lockPath = path.join(output, 'package-lock.json');
  fs.writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: { '': { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, engines: manifest.engines }, 'node_modules/ws': ws } }, null, 2)}\n`);
  const receiptPath = path.join(output, 'server-release.json');
  const receipt = { sourceRevision: revision, dependencyVersion: { ws: ws.version },
    roles: { code: 'read-only release; no assets or runtime/input mount', rules: 'public game definitions for separate canonical data directory', state: 'not included' },
    artifacts: [{ path: codeArchive, role: 'backend and small control page/code archive' }, { path: rulesArchive, role: 'native Git public rule snapshot; no player state' },
      { path: pkgPath, role: 'minimal server dependency manifest' }, { path: lockPath, role: 'ws version from existing native package lock' }, { path: receiptPath, role: 'release provenance and absolute artifact paths' }] };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`); process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseOptions(argv);
    if (args.has('help')) {
      process.stdout.write('usage: node tools/build-server-release.mjs --output <dir> --source-root <git-root> [--revision <commit>]\n'
        + '       node tools/build-server-release.mjs --assault-plan --source-root <worktree-root> --canonical-root <canonical-git-root>\n'
        + '       node tools/build-server-release.mjs --assault-adopt --source-root <worktree-root> --canonical-root <canonical-git-root>\n'
        + '       node tools/build-server-release.mjs --assault-repair-from-git --canonical-root <canonical-git-root> --source-commit <commit> [--adopt]\n'
        + '       node tools/build-server-release.mjs --assault-update-from-git --canonical-root <canonical-git-root> --source-commit <descendant-commit> [--repin-install-data] [--adopt]\n');
      return 0;
    }
    if (args.has('--assault-update-from-git')) {
      if (args.has('--assault-plan') || args.has('--assault-adopt') || args.has('--assault-repair-from-git') || args.has('--source-root') || args.has('--output'))
        throw new Error('Git update is a separate mode and accepts no source worktree, repair, or archive output');
      if (!args.has('--source-commit')) throw new Error('Git update requires --source-commit');
      const plan = planAssaultReleaseUpdateFromGit({ canonicalRoot: args.get('--canonical-root'), sourceCommit: args.get('--source-commit'), updateKind: args.get('--update-kind') || 'transport', validationPath: args.get('--validation-receipt'), repinInstallData: args.has('--repin-install-data') });
      const result = args.has('--adopt') ? adoptAssaultReleaseUpdate(plan) : {
        schema: plan.schema, status: 'planned', adoptionStatus: 'pending', oldSourceCommit: plan.oldRevision,
        sourceCommit: plan.sourceRevision, oldVersion: plan.oldVersion, newVersion: plan.newVersion,
        manifest: plan.manifestPath, changedPaths: plan.selected.map((item) => item.sourceGitPath),
        ignoredPaths: plan.ignoredPaths, changedBytes: plan.selected.reduce((sum, item) => sum + item.newBytes.length, 0),
        rollbackSourceCommit: plan.oldRevision,
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (args.has('--assault-repair-from-git')) {
      if (args.has('--assault-plan') || args.has('--assault-adopt') || args.has('--source-root') || args.has('--output'))
        throw new Error('Git repair is a separate mode and accepts no source worktree or archive output');
      if (!args.has('--source-commit')) throw new Error('Git repair requires --source-commit');
      const plan = planAssaultReleaseRepairFromGit({ canonicalRoot: args.get('--canonical-root'), sourceCommit: args.get('--source-commit') });
      const result = args.has('--adopt') ? restoreAssaultReleaseFromGit(plan) : {
        status: 'planned', adoptionStatus: 'pending', sourceCommit: plan.sourceCommit,
        manifest: plan.manifestPath, missingFiles: plan.missingFiles, missingBytes: plan.missingBytes,
        reusableFiles: plan.reusableFiles, existingManifestRows: plan.existingManifestRows,
        rows: plan.rows.map(({ sourcePath, targetPath, role, logicalBytes, sourceCommit, sourceGitPath, restorationMethod, adopt }) => ({
          sourcePath, targetPath, role, logicalBytes, sourceCommit, sourceGitPath, restorationMethod, adopt,
        })),
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (args.has('--adopt')) throw new Error('--adopt is valid only with a native Assault Git repair or update');
    if (args.has('--assault-plan') || args.has('--assault-adopt')) {
      if (args.has('--assault-plan') === args.has('--assault-adopt')) throw new Error('choose exactly one of --assault-plan or --assault-adopt');
      if (args.has('--output')) throw new Error('Assault mode uses only the registered canonical publish/data roots; --output is forbidden');
      const plan = planAssaultRelease({ sourceRoot: args.get('--source-root'), canonicalRoot: args.get('--canonical-root'), revision: args.get('--revision') || 'HEAD' });
      if (args.has('--assault-plan')) process.stdout.write(`${JSON.stringify(plan)}\n`);
      else process.stdout.write(`${JSON.stringify({ mode: 'assault-adopt', plan: plan.schema, sourceRevision: plan.sourceRevision, ...movePlanFiles(plan) })}\n`);
      return 0;
    }
    defaultRelease(args); return 0;
  } catch (error) {
    process.stderr.write(`build-server-release: ${error.message}\n`); return 1;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (invoked) process.exitCode = main();
