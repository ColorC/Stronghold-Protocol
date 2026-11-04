#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const CANONICAL_PUBLIC = path.join(CANONICAL_ROOT, 'public');
const DEPENDENCIES = path.join(CANONICAL_ROOT, '.omni', 'tmp', 'assault', 'dependencies');
const ACORN_PARSER = path.join(CANONICAL_ROOT, '.omni', 'tmp', 'assault', 'deps', 'package', 'dist', 'acorn.mjs');
const TEMP = path.join(CANONICAL_ROOT, '.omni', 'tmp', 'assault', 'checks');
const RUNTIME = path.join(CANONICAL_ROOT, 'runtime', 'assault');
const LOADER = path.join(ROOT, 'tools', 'assault', 'test-resource-loader.mjs');
const SCRIPT = fileURLToPath(import.meta.url);
const CONFIG = path.join(ROOT, 'eslint.config.js');
export const CHECK_LIMITS_MS = Object.freeze({ total: 1_200_000, eachChild: 900_000 });
const startedAt = Date.now();
const RUN_ID = new Date(startedAt).toISOString();
const RECEIPT_PATH = path.join(RUNTIME, 'base-checks.json');

export const BROWSER_OFF_ENV = Object.freeze({
  SP_E2E: '0',
  SP_REAL_E2E: '0',
  RENDER_E2E: '0',
  SIM_E2E: '0',
  NO_COLOR: '1',
  SP_REUSED_PUBLIC_DIR: CANONICAL_PUBLIC,
  SP_ASSAULT_DEPS_DIR: DEPENDENCIES,
  SP_ASSAULT_ACORN_PATH: ACORN_PARSER,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(LOADER).href}`].filter(Boolean).join(' '),
  TEMP,
  TMP: TEMP,
  TMPDIR: TEMP,
});

const logPaths = Object.freeze({
  fullTests: path.join(RUNTIME, 'base-full-tests.log'),
  lint: path.join(RUNTIME, 'base-lint.log'),
  typecheck: path.join(RUNTIME, 'base-typecheck.log'),
  i18n: path.join(RUNTIME, 'base-i18n.log'),
  golden: path.join(RUNTIME, 'base-golden.log'),
  bazaarStyle: path.join(RUNTIME, 'base-bazaar-style.log'),
});

export function parseTapSummary(output) {
  const summary = {};
  const text = String(output);
  const outputMarker = '===== child output =====';
  const markerAt = text.lastIndexOf(outputMarker);
  const outputStart = markerAt < 0 ? 0 : markerAt + outputMarker.length;
  const resultAt = text.indexOf('===== child result =====', outputStart);
  const currentOutput = text.slice(outputStart, resultAt < 0 ? undefined : resultAt);
  for (const line of currentOutput.split(/\r?\n/)) {
    const match = /^(?:#|ℹ)\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/.exec(line.trim());
    if (match) summary[match[1]] = Number(match[2]);
  }
  return summary;
}

export function createCheckPlan() {
  const node = process.execPath;
  return [
    {
      id: 'full-tests',
      command: node,
      args: ['--test', '--test-concurrency=2'],
      logPath: logPaths.fullTests,
      env: true,
      requires: ['acorn'],
    },
    {
      id: 'lint',
      command: node,
      args: [SCRIPT, '--lint-api'],
      logPath: logPaths.lint,
      env: false,
      requires: ['eslint', '@eslint/js', 'globals'],
    },
    {
      id: 'imports',
      command: node,
      args: [path.join(ROOT, 'tools', 'check-imports.mjs')],
      logPath: logPaths.lint,
      env: false,
      requires: [],
    },
    {
      id: 'typecheck',
      command: node,
      args: [
        path.join(DEPENDENCIES, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit', '--checkJs', '-p', path.join(ROOT, 'jsconfig.json'),
      ],
      logPath: logPaths.typecheck,
      env: false,
      requires: ['typescript'],
    },
    {
      id: 'i18n',
      command: node,
      args: [path.join(ROOT, 'tools', 'i18n.mjs'), 'check', '--all', '--strict'],
      logPath: logPaths.i18n,
      env: true,
      requires: ['acorn'],
    },
    {
      id: 'golden',
      command: node,
      args: [path.join(ROOT, 'tools', 'golden.mjs'), '--jobs', '2'],
      logPath: logPaths.golden,
      env: false,
      requires: [],
    },
    {
      // Card face against docs/assault-mode/bazaar-skill-style.md (compiled public text).
      id: 'bazaar-style',
      command: node,
      args: [path.join(ROOT, 'tools', 'assault', 'check-bazaar-style.mjs')],
      logPath: logPaths.bazaarStyle,
      env: false,
      requires: [],
    },
  ];
}

export function selectChecks(plan, ids) {
  if (!ids) return plan;
  const selected = new Set(ids);
  const unknown = [...selected].filter((id) => !plan.some((check) => check.id === id));
  if (unknown.length) throw new Error(`unknown check(s): ${unknown.join(', ')}`);
  return plan.filter((check) => selected.has(check.id));
}

export function dependencyPreflight(checks, inventory) {
  const available = new Set((inventory?.packages ?? []).map((pkg) => pkg.name));
  return checks.map((check) => ({ id: check.id, missing: (check.requires ?? []).filter((name) => !available.has(name)) }))
    .filter((check) => check.missing.length > 0);
}

export function dependencyInventory(checks = createCheckPlan()) {
  const required = [...new Set(checks.flatMap((check) => check.requires ?? []))];
  const anchor = path.join(DEPENDENCIES, 'package.json');
  const requireFromCache = fs.existsSync(anchor) ? createRequire(anchor) : null;
  const packages = [];
  const missing = [];
  for (const name of required) {
    let entry = null;
    try { if (requireFromCache) entry = requireFromCache.resolve(name); } catch { /* report selected missing dependencies below */ }
    if (name === 'acorn' && fs.existsSync(ACORN_PARSER)) entry = ACORN_PARSER;
    if (!entry) { missing.push(name); continue; }
    let dir = path.dirname(entry);
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir);
      if (parent === dir) { dir = null; break; }
      dir = parent;
    }
    if (!dir) { missing.push(name); continue; }
    const manifestPath = path.join(dir, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    packages.push({ name, version: manifest.version, path: dir,
      role: name === 'acorn' ? 'existing absolute parser cache' : 'pinned selected-check dependency' });
  }
  let bytes = 0;
  let files = 0;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) { bytes += fs.statSync(file).size; files++; }
    }
  };
  const nodeModules = path.join(DEPENDENCIES, 'node_modules');
  if (fs.existsSync(nodeModules)) visit(nodeModules);
  return { root: DEPENDENCIES, bytes, files, packages, missing };
}

function writeLogHeader(stream, plan, timeoutMs, runId) {
  stream.write(`\n===== ${plan.id} =====\n`);
  stream.write(`run_id: ${runId}\n`);
  stream.write(`cwd: ${ROOT}\n`);
  stream.write(`command: ${JSON.stringify([plan.command, ...plan.args])}\n`);
  stream.write(`timeout_ms: ${timeoutMs}\n`);
  if (plan.env) stream.write(`browser_flags: SP_E2E=0 SP_REAL_E2E=0 RENDER_E2E=0 SIM_E2E=0\n`);
  stream.write('===== child output =====\n');
}

function killProcessTree(pid) {
  if (!pid || process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    const timeout = setTimeout(() => { killer.kill(); resolve(); }, 15_000);
    killer.once('error', () => { clearTimeout(timeout); resolve(); });
    killer.once('close', () => { clearTimeout(timeout); resolve(); });
  });
}

async function runChild(plan, timeoutMs) {
  const stream = fs.createWriteStream(plan.logPath, { flags: 'a' });
  await new Promise((resolve, reject) => {
    stream.once('open', resolve);
    stream.once('error', reject);
  });
  writeLogHeader(stream, plan, timeoutMs, RUN_ID);

  const childStarted = Date.now();
  const env = { ...process.env, ...(plan.env ? BROWSER_OFF_ENV : {}) };
  const child = spawn(plan.command, plan.args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  let timedOut = false;
  let spawnError = null;
  let killTree = null;
  const treeTimer = setTimeout(() => {
    timedOut = true;
    killTree = killProcessTree(child.pid);
  }, Math.max(1, timeoutMs - 1000));
  child.stdout.on('data', (chunk) => stream.write(chunk));
  child.stderr.on('data', (chunk) => stream.write(chunk));
  child.once('error', (error) => { spawnError = error.message; stream.write(`\nspawn error: ${error.stack || error.message}\n`); });

  const ended = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(treeTimer);
  if (killTree) await killTree;
  const elapsedMs = Date.now() - childStarted;
  stream.write(`\n===== child result =====\nexit_code: ${ended.code ?? 'null'}\nsignal: ${ended.signal || 'none'}\ntimed_out: ${timedOut}\nelapsed_ms: ${elapsedMs}\n`);
  await new Promise((resolve) => stream.end(resolve));
  return {
    id: plan.id,
    command: [plan.command, ...plan.args],
    logPath: plan.logPath,
    elapsedMs,
    exitCode: ended.code,
    signal: ended.signal,
    timedOut,
    spawnError,
    status: ended.code === 0 && !timedOut ? 'passed' : 'failed',
  };
}

async function runLintApi() {
  const configPath = path.resolve(CONFIG).toLowerCase();
  const configUrl = pathToFileURL(CONFIG).href.toLowerCase();
  const fromCache = createRequire(path.join(DEPENDENCIES, 'package.json'));
  const configImports = new Map([
    ['@eslint/js', fromCache.resolve('@eslint/js')],
    ['globals', fromCache.resolve('globals')],
  ]);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      let parentPath = null;
      let parentHref = null;
      if (context.parentURL) {
        const parentUrl = new URL(context.parentURL);
        parentUrl.search = '';
        parentUrl.hash = '';
        if (parentUrl.protocol === 'file:') {
          parentHref = parentUrl.href.toLowerCase();
          parentPath = path.resolve(fileURLToPath(parentUrl)).toLowerCase();
        }
      }
      const cached = parentPath === configPath || parentHref === configUrl ? configImports.get(specifier) : null;
      return cached ? nextResolve(pathToFileURL(cached).href, context) : nextResolve(specifier, context);
    },
  });

  const apiPath = path.join(DEPENDENCIES, 'node_modules', 'eslint', 'lib', 'api.js');
  const { ESLint } = await import(pathToFileURL(apiPath).href);
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: CONFIG });
  const results = await eslint.lintFiles(['.']);
  const formatter = await eslint.loadFormatter('stylish');
  const formatted = await formatter.format(results);
  if (formatted) process.stdout.write(formatted);
  const errors = results.reduce((sum, result) => sum + result.errorCount, 0);
  const warnings = results.reduce((sum, result) => sum + result.warningCount, 0);
  console.log(`ESLint API: ${results.length} files, ${errors} errors, ${warnings} warnings`);
  return errors ? 1 : 0;
}

function gitRevision() {
  return new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 10_000 });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.once('close', (code) => resolve(code === 0 ? output.trim() : null));
    child.once('error', () => resolve(null));
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--lint-api') {
    try { return await runLintApi(); }
    catch (error) { console.error(error?.stack || error); return 1; }
  }

  let only = null;
  if (argv.length) {
    if (argv.length !== 2 || argv[0] !== '--only' || !argv[1]) {
      console.error('usage: node tools/assault/check-base.mjs [--only full-tests,lint,imports,typecheck,i18n,golden,bazaar-style]');
      return 2;
    }
    only = argv[1].split(',').map((id) => id.trim()).filter(Boolean);
  }
  const plan = selectChecks(createCheckPlan(), only);
  if (!plan.length) { console.error('no checks selected'); return 2; }

  const dependencies = dependencyInventory(plan);
  const missingByCheck = new Map(dependencyPreflight(plan, dependencies).map((entry) => [entry.id, entry.missing]));
  const revision = await gitRevision();
  let previousRun = null;
  if (fs.existsSync(RECEIPT_PATH)) {
    const previous = JSON.parse(fs.readFileSync(RECEIPT_PATH, 'utf8'));
    previousRun = {
      elapsedMs: previous.elapsedMs,
      checks: previous.checks.map(({ id, status, exitCode, signal, elapsedMs, logPath }) => ({ id, status, exitCode, signal, elapsedMs, logPath })),
    };
  }
  const checks = [];
  for (const checkPlan of plan) {
    const missing = missingByCheck.get(checkPlan.id);
    if (missing) {
      const reason = `missing selected dependency package(s): ${missing.join(', ')}`;
      console.error(`${checkPlan.id}: ${reason}`);
      checks.push({ id: checkPlan.id, command: [checkPlan.command, ...checkPlan.args], logPath: checkPlan.logPath,
        elapsedMs: 0, exitCode: null, signal: null, timedOut: false, status: 'failed', reason });
      continue;
    }
    const remainingMs = CHECK_LIMITS_MS.total - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      checks.push({ id: checkPlan.id, command: [checkPlan.command, ...checkPlan.args], logPath: checkPlan.logPath, elapsedMs: 0, exitCode: null, signal: null, timedOut: false, status: 'not-run', reason: '1200-second total deadline reached' });
      continue;
    }
    const timeoutMs = Math.max(1, Math.min(CHECK_LIMITS_MS.eachChild, remainingMs));
    const runPlan = checkPlan;
    // Runtime logs stay append-only; run_id headers separate this invocation from history.
    console.log(`running ${runPlan.id}; timeout=${timeoutMs}ms; log=${runPlan.logPath}`);
    checks.push(await runChild(runPlan, timeoutMs));
    if (runPlan.id === 'full-tests') {
      const output = fs.readFileSync(runPlan.logPath, 'utf8');
      checks.at(-1).testSummary = parseTapSummary(output);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const receipt = {
    schema: 'assault-base-checks/v1',
    runId: RUN_ID,
    root: ROOT,
    canonicalRoot: CANONICAL_ROOT,
    gitRevision: revision,
    browserSuites: { SP_E2E: '0', SP_REAL_E2E: '0', RENDER_E2E: '0', SIM_E2E: '0' },
    concurrency: { nodeTests: 2, goldenJobs: 2, parallelChecks: 1 },
    limitsMs: CHECK_LIMITS_MS,
    elapsedMs,
    selectedChecks: plan.map((check) => check.id),
    previousRun,
    temp: TEMP,
    reusedPublicDirectory: CANONICAL_PUBLIC,
    dependencies,
    sources: [SCRIPT, LOADER, path.join(ROOT, 'test', 'assault', 'check-base.test.mjs')],
    checks,
  };
  fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

  for (const check of checks) {
    const code = check.exitCode === null ? 'null' : check.exitCode;
    console.log(`${check.status.padEnd(7)} ${check.id}: exit=${code}${check.signal ? ` signal=${check.signal}` : ''} ${check.elapsedMs}ms`);
    if (check.testSummary) console.log(`         node tests: ${JSON.stringify(check.testSummary)}`);
  }
  console.log(`receipt: ${RECEIPT_PATH}`);
  console.log(`total: ${elapsedMs}ms; installed cache: ${dependencies.bytes} bytes (${dependencies.files} files)`);
  return checks.every((check) => check.status === 'passed') ? 0 : 1;
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT;
if (direct) main().then((code) => { process.exitCode = code; }, (error) => { console.error(error?.stack || error); process.exitCode = 1; });
