// Bounded real-consumer regression through the normal sparse-source loader.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonicalRoot = path.resolve(sourceRoot, '../../..');
const runtimeRoot = path.join(canonicalRoot, 'runtime/assault');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i] === '--label' && /^[a-z0-9-]+$/.test(process.argv[i + 1] ?? '')) { args.set('--label', process.argv[i + 1]); continue; }
  if (process.argv[i] === '--adaptation-scope' && ['core', 'full'].includes(process.argv[i + 1])) { args.set('--adaptation-scope', process.argv[i + 1]); continue; }
  if (!['--runtime', '--public-text'].includes(process.argv[i]) || !path.isAbsolute(process.argv[i + 1] ?? '')) throw Error('Expected an explicit absolute --runtime or --public-text path, or --label <name>');
  args.set(process.argv[i], process.argv[i + 1]);
}
// Each validated change keeps its own receipt and log under runtime/assault.
const label = args.get('--label') ?? 'skill-repair';
const receipt = path.join(runtimeRoot, `${label}-gameplay-validation.json`);
const log = path.join(runtimeRoot, `${label}-review-tests.log`);
const git = (...argv) => execFileSync('git', ['-C', sourceRoot, ...argv], { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }).trim();
if (path.resolve(git('rev-parse', '--show-toplevel')) !== sourceRoot) throw Error('Incorrect source repository root');
if (git('status', '--porcelain', '--untracked-files=normal')) throw Error('Gameplay validation requires committed, clean source');
const release = JSON.parse(fs.readFileSync(path.join(canonicalRoot, 'publish/assault/code/assault-release.json'), 'utf8'));
const suites = ['collection-redesign', 'relic-rules', 'relics', 'relic-ammo-element-behavior',
  'relic-heal-block-behavior', 'relic-redeploy-summon-cross-behavior', 'public-text', 'release-content-update']
  .concat(['relic-cold-behavior', 'relic-cycle-pierce', 'relic-boss-pool-behavior', 'summon-relic-income',
    'battle', 'upgrades-battle', 'run', 'run-lifecycle','context','inventory','store','primitives','page-model','ui-polish',
    'skill-source-contract','skill-instant-melee','skill-instant-ranged','skill-instant-support','skill-instant-flow',
    'cards-ranged','cards-ranged-mid','cards-ranged-elite','cast-needs-enemy','legacy-save-compat','wave-pacing','enemy-tuning','rule-error-messages',
    'terrain-devices','snap-compat'])
  // synergy cards (design of 2026-10-21): every test/assault/synergy-*.test.mjs joins by its name — primitives, card-line
  // wiring and each family's card tests — so a new card test file needs no edit here
  .concat(fs.readdirSync(path.join(sourceRoot, 'test/assault')).filter(name => /^synergy-.+\.test\.mjs$/.test(name)).sort()
    .map(name => name.replace(/\.test\.mjs$/, '')))
  .concat(['bazaar-engine', 'bazaar-assault', 'bazaar-support', 'bazaar-support-modules', 'bazaar-native', 'bazaar-ranged', 'check-base']
    .filter(name => fs.existsSync(path.join(sourceRoot, 'test/assault', `${name}.test.mjs`))))
  .map(name => `test/assault/${name}.test.mjs`);
const record = { schema: 'assault-gameplay-validation/v1', status: 'running', startedAt: new Date().toISOString(),
  nativeSourceCommit: git('rev-parse', 'HEAD'), previousPublicSourceCommit: release.source.nativeGitCommit,
  engineRevision: release.source.engineRevision, sourceRoot, canonicalRoot, sourceClean: true, suites, log, receipt,
  rulesRoot: release.roots.rules, runtimeInput: args.get('--runtime') ?? path.join(release.roots.rules, 'assault-runtime.json'),
  publicTextInput: args.get('--public-text') ?? path.join(release.roots.rules, 'assault-public-text.json'),
  // the synergy card tests join by name (test/assault/synergy-*.test.mjs): room for 172 cards' suites on a busy machine
  writesPlayerState: false, timeoutMs: 600000 };
record.nativeArtifactBindings = [
  ['data/assault-runtime.json', record.runtimeInput], ['data/assault-public-text.json', record.publicTextInput],
].map(([sourceGitPath, input]) => {
  const blob = execFileSync('git', ['-C', sourceRoot, 'show', `${record.nativeSourceCommit}:${sourceGitPath}`],
    { encoding: null, windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  if (!fs.readFileSync(input).equals(blob)) throw Error(`Gameplay test input differs from its native Git source: ${input}`);
  return { sourceGitPath, nativeGitCommit: record.nativeSourceCommit, input, bytewiseMatched: true };
});
// Some real-context/HTTP consumers use getData() rather than the card helper.
// Give all of them the same candidate inputs, retaining the registered native
// archives as ordinary copies. Never mutate or link the live rules directory.
record.testDataRoot=path.join(canonicalRoot,'.omni/tmp/assault/review-data',label,record.nativeSourceCommit);
fs.mkdirSync(record.testDataRoot,{recursive:true});
const copyInput=(source,name)=>{
  const target=path.join(record.testDataRoot,name);
  if(fs.existsSync(target)){
    const st=fs.lstatSync(target);
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('Test data target must be an ordinary private copy: '+target);
  }
  fs.copyFileSync(source,target);
  return target;
};
for(const entry of fs.readdirSync(release.roots.rules,{withFileTypes:true}))
  if(entry.isFile()&&entry.name.endsWith('.json')&&!['assault-runtime.json','assault-public-text.json'].includes(entry.name))
    copyInput(path.join(release.roots.rules,entry.name),entry.name);
record.defaultDataBindings=record.nativeArtifactBindings.map(binding=>{
  const target=copyInput(binding.input,path.basename(binding.sourceGitPath));
  return {sourceGitPath:binding.sourceGitPath,input:target,bytewiseMatched:fs.readFileSync(target).equals(fs.readFileSync(binding.input))};
});
// Card-face style gate on the exact public text and runtime under test.
const style = spawnSync(process.execPath, ['tools/assault/check-bazaar-style.mjs', '--json', '--public-text', record.publicTextInput, '--runtime', record.runtimeInput],
  { cwd: sourceRoot, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
try { const parsed = JSON.parse(style.stdout); record.bazaarStyle = { exitCode: style.status, operators: parsed.operators, linked: parsed.linked, errors: parsed.errors.length, firstErrors: parsed.errors.slice(0, 20) }; }
catch { record.bazaarStyle = { exitCode: style.status, errors: null, output: String(style.stdout ?? '').slice(0, 2000) + String(style.stderr ?? '').slice(0, 2000) }; }
const quotaReceipt = path.join(runtimeRoot, `${label}-adaptation-quotas.json`);
const quota = spawnSync(process.execPath, ['--max-old-space-size=512', 'tools/assault/check-adaptation-quotas.mjs',
  '--scope', args.get('--adaptation-scope') ?? 'full', '--runtime', record.runtimeInput, '--public-text', record.publicTextInput, '--output', quotaReceipt],
  { cwd: sourceRoot, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
try {
  const result = JSON.parse(fs.readFileSync(quotaReceipt, 'utf8'));
  record.adaptationQuota = { exitCode: quota.status, receipt: quotaReceipt, status: result.status, scope: result.scope,
    sourceRevision: result.sourceRevision, sourceClean: result.sourceClean, adapted: result.adapted, pending: result.pending.length, errors: result.errors.length };
} catch { record.adaptationQuota = { exitCode: quota.status, receipt: quotaReceipt, status: 'fail', output: `${quota.stdout ?? ''}${quota.stderr ?? ''}`.slice(0, 2000) }; }
const result = spawnSync(process.execPath, ['--max-old-space-size=384', '--import', './tools/assault/test-resource-loader.mjs', '--test', '--test-concurrency=2', '--test-reporter=tap', ...suites], {
  cwd: sourceRoot, windowsHide: true, encoding: 'utf8', timeout: record.timeoutMs, maxBuffer: 2 * 1024 * 1024,
  env: { ...process.env, SP_REUSED_PUBLIC_DIR: path.join(canonicalRoot, 'public'), SP_ASSAULT_SOURCE_BASE: release.roots.code,
    SP_DATA_DIR: record.testDataRoot, SP_ASSAULT_RULES_ROOT: path.join(sourceRoot, 'data'),
    ASSAULT_RULES_ROOT: record.testDataRoot, ASSAULT_RUNTIME_PATH: record.runtimeInput, ASSAULT_PUBLIC_TEXT_PATH: record.publicTextInput },
});
const output = (result.stdout ?? '') + (result.stderr ?? '');
fs.appendFileSync(log, `\n--- gameplay source ${record.nativeSourceCommit} ${record.startedAt} ---\n${output}`);
const total = key => Number(output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
record.testResults = { total: total('tests'), passed: total('pass'), failed: total('fail'), skipped: total('skipped'), cancelled: total('cancelled') };
record.exitCode = result.status;
record.sourceClean = !git('status', '--porcelain', '--untracked-files=normal') && git('rev-parse', 'HEAD') === record.nativeSourceCommit;
for (const binding of record.nativeArtifactBindings) {
  const blob = execFileSync('git', ['-C', sourceRoot, 'show', `${record.nativeSourceCommit}:${binding.sourceGitPath}`],
    { encoding: null, windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  binding.bytewiseMatched = binding.bytewiseMatched && fs.readFileSync(binding.input).equals(blob);
  if (!binding.bytewiseMatched) record.sourceClean = false;
}
for(const binding of record.defaultDataBindings){
  const direct=record.nativeArtifactBindings.find(source=>source.sourceGitPath===binding.sourceGitPath);
  binding.bytewiseMatched=binding.bytewiseMatched&&fs.readFileSync(binding.input).equals(fs.readFileSync(direct.input));
  if(!binding.bytewiseMatched)record.sourceClean=false;
}
record.status = !result.error && result.status === 0 && record.sourceClean && record.testResults.total > 0
  && record.bazaarStyle?.exitCode === 0
  && record.adaptationQuota?.exitCode === 0 && record.adaptationQuota.sourceRevision === record.nativeSourceCommit && record.adaptationQuota.sourceClean === true
  && record.testResults.total === record.testResults.passed && record.testResults.failed === 0
  && record.testResults.skipped === 0 && record.testResults.cancelled === 0 ? 'pass' : 'fail';
record.finishedAt = new Date().toISOString();
if (result.error) record.error = String(result.error);
let prior = null;
try { prior = JSON.parse(fs.readFileSync(receipt, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (prior) record.previousAttempts = [...(prior.previousAttempts ?? []), Object.fromEntries(Object.entries(prior).filter(([key]) => key !== 'previousAttempts'))];
fs.writeFileSync(receipt, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
process.exitCode = record.status === 'pass' ? 0 : 1;
