import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENGINE_KEYS = Object.freeze(['server/data.js', 'server/modes/independent/catalog.js']);

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }).trim();
}

function samePath(a, b) {
  const left = path.resolve(a); const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function requireRoot(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return path.resolve(value);
}

function readOrdinaryJson(file, label) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`${label} must be an ordinary file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function verifyCanonicalRoot(canonicalRoot) {
  if (!samePath(git(canonicalRoot, 'rev-parse', '--show-toplevel'), canonicalRoot))
    throw new Error(`configured canonical path is not the repository root: ${canonicalRoot}`);
}

export function validateReleaseContract(releaseManifest, { codeRoot, canonicalRoot, packageJson }) {
  if (releaseManifest?.schema !== 'assault-release/v1' || releaseManifest.status !== 'pass' || releaseManifest.adoptionStatus !== 'adopted')
    throw new Error('Assault release manifest must be a fully adopted pass');
  const expectedCode = path.join(canonicalRoot, 'publish', 'assault', 'code');
  const expectedRules = path.join(canonicalRoot, 'data', 'assault-rules');
  const expectedRuntime = path.join(canonicalRoot, 'runtime', 'assault');
  if (!samePath(codeRoot, expectedCode) || !samePath(releaseManifest.roots?.code, expectedCode)
    || !samePath(releaseManifest.roots?.canonical, canonicalRoot)
    || !samePath(releaseManifest.roots?.rules, expectedRules)
    || !samePath(releaseManifest.roots?.runtime, expectedRuntime))
    throw new Error('Assault release roots do not match the registered canonical paths');
  if (packageJson?.type !== 'module' || !packageJson.version || typeof packageJson.dependencies?.ws !== 'string'
    || releaseManifest.source?.version !== packageJson.version)
    throw new Error('Assault release package version or module type differs from its manifest');
  if (!Array.isArray(releaseManifest.metadataAllowlist)
    || releaseManifest.metadataAllowlist.join('|') !== 'package.json|assault-release.json|copy.json')
    throw new Error('Assault release metadata allowlist is invalid');
  const revision = releaseManifest.source?.nativeGitCommit;
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Assault release source commit is invalid');
  return { codeRoot: expectedCode, rulesRoot: expectedRules, runtimeRoot: expectedRuntime, revision };
}

function verifyPreservation(runtimeRoot, sourceRoot, manifest = null) {
  const preservationPath = path.join(runtimeRoot, 'current-generated-engine-cache-preservation.json');
  const preserved = readOrdinaryJson(preservationPath, 'engine cache preservation receipt');
  if (preserved.status !== 'pass' || preserved.sourceDirty || !Array.isArray(preserved.files) || preserved.files.length !== 2)
    throw new Error('Verified independent engine recovery is required');
  const engineArchiveFiles = {};
  for (const key of ENGINE_KEYS) {
    const file = preserved.files.find((row) => String(row.path).replaceAll('\\', '/').endsWith(`/public/js/independent/engine/${key}`));
    if (!file || !path.isAbsolute(file.gzip)) throw new Error(`Independent engine recovery is missing logical key ${key}`);
    const gzipPath = path.resolve(file.gzip);
    if (!samePath(path.dirname(gzipPath), runtimeRoot)) throw new Error(`Independent engine recovery must use canonical runtime: ${gzipPath}`);
    if (manifest && !samePath(manifest.engineFallbacks?.[key], gzipPath))
      throw new Error(`release manifest engine fallback differs from recovery receipt: ${key}`);
    const st = fs.lstatSync(gzipPath);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`engine recovery path is not an ordinary file: ${gzipPath}`);
    engineArchiveFiles[key] = gzipPath;
  }
  return { preserved, engineArchiveFiles };
}

export function resolveAssaultServiceConfig({ sourceRoot = DEFAULT_SOURCE_ROOT, canonicalRoot = process.env.SP_ASSAULT_CANONICAL_ROOT } = {}) {
  sourceRoot = requireRoot(sourceRoot, 'source root');
  canonicalRoot = requireRoot(canonicalRoot, 'SP_ASSAULT_CANONICAL_ROOT');
  verifyCanonicalRoot(canonicalRoot);
  const runtimeRoot = path.join(canonicalRoot, 'runtime', 'assault');
  const manifestPath = path.join(sourceRoot, 'assault-release.json');
  let codeRoot = sourceRoot; let rulesRoot = path.join(sourceRoot, 'data'); let sourceRevision; let releaseManifest = null;
  if (fs.existsSync(manifestPath)) {
    releaseManifest = readOrdinaryJson(manifestPath, 'Assault release manifest');
    codeRoot = sourceRoot;
    const packageJson = JSON.parse(fs.readFileSync(path.join(codeRoot, 'package.json'), 'utf8'));
    const contract = validateReleaseContract(releaseManifest, { codeRoot, canonicalRoot, packageJson });
    if (git(canonicalRoot, 'cat-file', '-t', contract.revision) !== 'commit')
      throw new Error('Assault release source commit is not recoverable from the canonical Git repository');
    sourceRevision = contract.revision; rulesRoot = contract.rulesRoot; codeRoot = contract.codeRoot;
  } else {
    if (!samePath(git(sourceRoot, 'rev-parse', '--show-toplevel'), sourceRoot))
      throw new Error(`development source path is not its own Git root: ${sourceRoot}`);
    sourceRevision = git(sourceRoot, 'rev-parse', 'HEAD');
  }
  const { preserved, engineArchiveFiles } = verifyPreservation(runtimeRoot, sourceRoot, releaseManifest);
  return { mode: releaseManifest ? 'published' : 'development', sourceRoot: codeRoot, sourceRevision,
    rulesRoot, dataRoot: rulesRoot, canonicalRoot, runtimeRoot, releaseManifest,
    preservedEngine: preserved, engineArchiveFiles,
    publicDir: path.join(codeRoot, 'public'), sharedDir: path.join(codeRoot, 'shared'),
    assaultAssetsDir: path.join(canonicalRoot, 'data', 'assault-sources', 'assets') };
}

async function runService() {
  const config = resolveAssaultServiceConfig();
  process.env.SP_DATA_DIR = config.dataRoot;
  process.env.SP_ASSAULT_RULES_ROOT = config.rulesRoot;
  process.env.SP_INDEPENDENT_DESIGN_PATH = path.join(config.dataRoot, 'independent-design.json');
  process.env.SP_INDEPENDENT_GAME_TEXT_PATH = path.join(config.dataRoot, 'independent-game-text.json');
  if (config.mode === 'development')
    process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH = path.join(config.dataRoot, 'independent-darkmoon-design-addon.json');
  else delete process.env.SP_INDEPENDENT_DARKMOON_ADDON_PATH;

  const { startServer } = await import(pathToFileURL(path.join(config.sourceRoot, 'server', 'index.js')).href);
  const service = await startServer({
    port: Number(process.env.SP_ASSAULT_PORT || 13002),
    host: '127.0.0.1', quiet: true,
    publicDir: config.publicDir, dataDir: config.dataRoot,
    sharedDir: config.sharedDir, installDir: config.canonicalRoot,
    assaultDirectory: path.join(config.runtimeRoot, 'player-sessions'),
    assaultAssetsDir: config.assaultAssetsDir,
    independentDirectory: path.join(config.runtimeRoot, 'independent-service-state'),
    recordingDirectory: path.join(config.runtimeRoot, 'recordings'),
    staticBase: '', assetSources: {},
    independentEngineArchives: { revision: config.preservedEngine.sourceRevision, files: config.engineArchiveFiles },
  });
  console.log(JSON.stringify({ kind: 'assault-local-service', mode: config.mode, sourceRoot: config.sourceRoot,
    sourceRevision: config.sourceRevision, dataRoot: config.dataRoot, canonicalRoot: config.canonicalRoot,
    runtimeRoot: config.runtimeRoot, url: service.url, startedAt: new Date().toISOString() }));

  let stopping = false;
  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`[assault-local] ${signal}: closing`);
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    try { await service.close(); clearTimeout(deadline); process.exitCode = 0; }
    catch (error) { console.error(error); process.exitCode = 1; }
  }
  process.once('SIGINT', () => { void stop('SIGINT'); });
  process.once('SIGTERM', () => { void stop('SIGTERM'); });
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (invoked) runService().catch((error) => { console.error(error); process.exitCode = 1; });
