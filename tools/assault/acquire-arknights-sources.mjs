// Pinned, bounded refresh for the 11 Arknights source tables changed by the
// audited upstream compare. This tool never updates source-index or derived data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCE_FILES } from './source-corpus.mjs';

export const OLD_REVISION = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
export const NEW_REVISION = '17759cc8cdf37388414145d16262a3a06f3ab25e';
export const REPOSITORY = 'https://github.com/Kengxxiao/ArknightsGameData';
export const COMPARE_PAGE_URL = `${REPOSITORY}/compare/${OLD_REVISION}...${NEW_REVISION}`;
export const API_COMPARE_URL = `https://api.github.com/repos/Kengxxiao/ArknightsGameData/compare/${OLD_REVISION}...${NEW_REVISION}`;
export const RAW_ROOT = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${NEW_REVISION}/zh_CN/gamedata/`;
export const SOURCE_KEYS = Object.freeze({
  'arknights.battleEquipTable': { rel: 'excel/battle_equip_table.json', maxBytes: 5_763_741 },
  'arknights.charMetaTable': { rel: 'excel/char_meta_table.json', maxBytes: 67_151 },
  'arknights.characterTable': { rel: 'excel/character_table.json', maxBytes: 15_069_101 },
  'arknights.gamedataConst': { rel: 'excel/gamedata_const.json', maxBytes: 57_974 },
  'arknights.enemyHandbookTable': { rel: 'excel/enemy_handbook_table.json', maxBytes: 1_854_506 },
  'arknights.roguelikeTopicTable': { rel: 'excel/roguelike_topic_table.json', maxBytes: 17_958_101 },
  'arknights.enemyDatabase': { rel: 'levels/enemydata/enemy_database.json', maxBytes: 15_163_830 },
  'arknights.activityTable': { rel: 'excel/activity_table.json', maxBytes: 14_126_572 },
  'arknights.buffTemplateData': { rel: 'battle/buff_template_data.json', maxBytes: 28_623_543 },
  'arknights.skillTable': { rel: 'excel/skill_table.json', maxBytes: 11_557_971 },
  'arknights.uniequipTable': { rel: 'excel/uniequip_table.json', maxBytes: 3_392_727 },
});
export const AUDITED_NEW_CHARACTER_IDS = Object.freeze({
  char_393_toledo: { name: '德·托莱多', rarity: 'TIER_5', profession: 'SUPPORT', subProfessionId: 'underminer' },
  char_4232_hbound: { name: '旅骨', rarity: 'TIER_5', profession: 'SPECIAL', subProfessionId: 'alchemist' },
  char_4231_clemnt: { name: '克莱门莎', rarity: 'TIER_6', profession: 'WARRIOR', subProfessionId: 'primguard' },
});
export const AUDITED_NEW_NATIVE_ENTITIES = Object.freeze({
  token_10067_toledo_tldptm: { profession: 'TOKEN', subProfessionId: 'notchar1' },
  trap_331_spksum: { profession: 'TRAP', subProfessionId: 'notchar2' },
  trap_332_blkcan: { profession: 'TRAP', subProfessionId: 'notchar2' },
  trap_338_almytw: { profession: 'TRAP', subProfessionId: 'notchar2' },
});
export const MAX_TABLE_BYTES = Math.max(...Object.values(SOURCE_KEYS).map((x) => x.maxBytes));
export const OLD_RAW_CAP_OVERHEAD_BYTES = 4 * 1024 * 1024;
export const MAX_OLD_BACKUP_BYTES = 160 * 1024 * 1024;
export const MAX_TOTAL_NEW_BYTES = 2_000_000_000;
export const BUDGET_MAX_AGE_MS = 300_000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const TOTAL_TIMEOUT_MS = 15 * 60_000;
const BUDGET_RESERVE_OVERHEAD = 1_048_576;

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(toolDir, '../..');
export const PROJECT_ROOT = path.resolve(worktreeRoot, '../../..');
export const PRODUCTION_PATHS = Object.freeze({
  projectRoot: PROJECT_ROOT,
  sourceRoot: path.join(PROJECT_ROOT, 'data', 'assault-sources'),
  sourceIndex: path.join(PROJECT_ROOT, 'data', 'assault-sources', 'source-index.json'),
  acquisition: path.join(PROJECT_ROOT, 'runtime', 'assault', 'arknights-acquisition.json'),
  receiptDir: path.join(PROJECT_ROOT, 'runtime', 'assault'),
  staging: path.join(PROJECT_ROOT, '.omni', 'tmp', 'assault', 'arknights-source-refresh.pending.json'),
  stagingDir: path.join(PROJECT_ROOT, '.omni', 'tmp', 'assault'),
  diskBudget: path.join(PROJECT_ROOT, 'runtime', 'assault', 'disk-budget.json'),
  wofQueryScript: path.join(PROJECT_ROOT, '.omni', 'tmp', 'assault', 'native-wof-query.ps1'),
});

export class AcquisitionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AcquisitionError';
    this.details = details;
  }
}

export function sameNativePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!path.win32.isAbsolute(a.replaceAll('/', '\\')) || !path.win32.isAbsolute(b.replaceAll('/', '\\'))) return false;
  const norm = (v) => path.win32.resolve(v.replaceAll('/', '\\')).replaceAll('/', '\\').toLowerCase();
  return norm(a) === norm(b);
}

export function deepEqualJson(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => deepEqualJson(value, b[i]));
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, i) => key === bKeys[i] && deepEqualJson(a[key], b[key]));
}

export function validateAuditedCharacterAnchors(characterTable) {
  for (const [id, expected] of Object.entries(AUDITED_NEW_CHARACTER_IDS)) {
    const row = characterTable?.[id];
    if (!row || row.name !== expected.name || row.rarity !== expected.rarity || row.profession !== expected.profession || row.subProfessionId !== expected.subProfessionId) {
      throw new AcquisitionError(`new character anchor mismatch at /${id} (name/rarity/profession/subProfessionId)`);
    }
  }
  for (const [id, expected] of Object.entries(AUDITED_NEW_NATIVE_ENTITIES)) {
    const row = characterTable?.[id];
    if (!row || row.profession !== expected.profession || row.subProfessionId !== expected.subProfessionId) {
      throw new AcquisitionError(`native entity anchor mismatch at /${id} (profession/subProfessionId)`);
    }
  }
  const tokenRef = characterTable.char_393_toledo.skills?.[1]?.overrideTokenKey;
  if (tokenRef !== 'token_10067_toledo_tldptm' || !characterTable[tokenRef]) {
    throw new AcquisitionError('Toledo summon reference /char_393_toledo/skills/1/overrideTokenKey is missing or unresolved');
  }
  return { characters: 3, nativeEntities: 4, resolvedSummonReferences: 1 };
}

function parseJsonBytes(bytes, label) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (error) {
    throw new AcquisitionError(`${label}: invalid UTF-8 (${error.message})`);
  }
  try { return JSON.parse(text); } catch (error) {
    throw new AcquisitionError(`${label}: invalid JSON (${error.message})`);
  }
}

function statIdentity(stat) {
  return {
    dev: stat.dev.toString(), ino: stat.ino.toString(), size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString(), nlink: stat.nlink.toString(),
  };
}

function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function normalizeNativePath(value) {
  return path.win32.resolve(value.replaceAll('/', '\\')).replaceAll('/', '\\').toLowerCase();
}

export function assertNoReparsePath(absPath, { lstat = fs.lstatSync, realpath = fs.realpathSync } = {}) {
  if (typeof absPath !== 'string' || !path.win32.isAbsolute(absPath.replaceAll('/', '\\'))) {
    throw new AcquisitionError(`path must be absolute: ${String(absPath)}`);
  }
  const full = path.win32.resolve(absPath.replaceAll('/', '\\'));
  const parsed = path.win32.parse(full);
  const segments = full.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.win32.join(current, segment);
    let stat;
    try { stat = lstat(current, { bigint: true }); } catch (error) {
      if (error.code === 'ENOENT') break;
      throw new AcquisitionError(`cannot inspect path ancestor ${current}: ${error.message}`);
    }
    if (stat.isSymbolicLink()) throw new AcquisitionError(`reparse/link path rejected: ${current}`);
    let resolved;
    try { resolved = realpath(current); } catch (error) {
      throw new AcquisitionError(`cannot resolve path ancestor ${current}: ${error.message}`);
    }
    if (normalizeNativePath(resolved) !== normalizeNativePath(current)) {
      throw new AcquisitionError(`path ancestor resolves through a link/reparse point: ${current}`);
    }
  }
  return full;
}

function requirePlainRegularFile(absPath) {
  assertNoReparsePath(absPath);
  const st = fs.lstatSync(absPath, { bigint: true });
  if (!st.isFile() || st.isSymbolicLink()) throw new AcquisitionError(`expected plain regular file: ${absPath}`);
  if (st.nlink !== 1n) throw new AcquisitionError(`hard-linked file rejected (nlink=${st.nlink}): ${absPath}`);
  return st;
}

function requirePlainDirectory(absPath) {
  assertNoReparsePath(absPath);
  const st = fs.lstatSync(absPath, { bigint: true });
  if (!st.isDirectory() || st.isSymbolicLink()) throw new AcquisitionError(`expected plain directory: ${absPath}`);
  return st;
}

function buildRegisteredTables(sourceRoot) {
  const registered = SOURCE_FILES.arknights;
  const tables = [];
  for (const [sourceKey, spec] of Object.entries(SOURCE_KEYS)) {
    const registryKey = sourceKey.slice('arknights.'.length);
    const registeredRel = registered[registryKey];
    const expectedRel = `arknights/${spec.rel}`;
    if (registeredRel !== expectedRel) throw new AcquisitionError(`source-corpus registration drift for ${sourceKey}: expected ${expectedRel}, got ${registeredRel}`);
    const relFromRoot = registeredRel;
    const target = path.resolve(sourceRoot, ...relFromRoot.split('/'));
    tables.push({ sourceKey, sourceRel: registeredRel, upstreamRel: spec.rel, maxBytes: spec.maxBytes, target });
  }
  if (tables.length !== 11) throw new AcquisitionError(`expected 11 compare-registered inputs, found ${tables.length}`);
  return tables;
}

function getContext(paths = PRODUCTION_PATHS) {
  const expectedRoot = path.resolve(paths.projectRoot);
  const expectedSourceRoot = path.join(expectedRoot, 'data', 'assault-sources');
  if (!sameNativePath(paths.sourceRoot, expectedSourceRoot)) throw new AcquisitionError('sourceRoot is outside the canonical project data/assault-sources root');
  if (!sameNativePath(paths.sourceIndex, path.join(expectedSourceRoot, 'source-index.json'))) throw new AcquisitionError('source-index path is not canonical');
  if (!sameNativePath(paths.acquisition, path.join(expectedRoot, 'runtime', 'assault', 'arknights-acquisition.json'))) throw new AcquisitionError('acquisition receipt path is not canonical');
  if (!sameNativePath(paths.staging, path.join(expectedRoot, '.omni', 'tmp', 'assault', 'arknights-source-refresh.pending.json'))) {
    throw new AcquisitionError('staging path must be the single registered assault pending file');
  }
  if (!sameNativePath(paths.stagingDir, path.dirname(paths.staging))) throw new AcquisitionError('staging directory mismatch');
  if (!sameNativePath(paths.diskBudget, path.join(expectedRoot, 'runtime', 'assault', 'disk-budget.json'))) throw new AcquisitionError('disk budget path is not canonical');
  return { ...paths, projectRoot: expectedRoot, tables: buildRegisteredTables(expectedSourceRoot) };
}

function validateIndexAndReceipt(index, acquisition, ctx) {
  if (index.schema !== 'assault-source-corpus/v1') throw new AcquisitionError(`unexpected source-index schema: ${index.schema}`);
  if (!sameNativePath(index.sourceRoot, ctx.sourceRoot)) throw new AcquisitionError('source-index sourceRoot mismatch');
  if (index.versions?.arknights?.revision !== OLD_REVISION) throw new AcquisitionError(`source-index is not pinned to expected old revision ${OLD_REVISION}`);
  if (acquisition.sourceRepository !== REPOSITORY || acquisition.revision !== OLD_REVISION) {
    throw new AcquisitionError(`acquisition receipt is not pinned to expected old revision ${OLD_REVISION}`);
  }
  const registered = Object.entries(SOURCE_FILES.arknights);
  if (registered.length !== 17 || !Array.isArray(acquisition.files) || acquisition.files.length !== registered.length) {
    throw new AcquisitionError('source-index/acquisition must contain exactly the 17 registered Arknights inputs');
  }
  const byPath = new Map(acquisition.files.map((f) => [normalizeNativePath(f.file), f]));
  if (byPath.size !== acquisition.files.length) throw new AcquisitionError('acquisition receipt contains duplicate file identities');
  for (const [registryKey, sourceRel] of registered) {
    const sourceKey = `arknights.${registryKey}`;
    const target = path.resolve(ctx.sourceRoot, ...sourceRel.split('/'));
    const indexRow = index.sources?.[sourceKey];
    if (!indexRow?.present || !sameNativePath(indexRow.path, target)) throw new AcquisitionError(`source-index path/presence mismatch for registered input ${sourceKey}`);
    const row = byPath.get(normalizeNativePath(target));
    if (!row || row.revision !== OLD_REVISION || !sameNativePath(row.file, target) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) {
      throw new AcquisitionError(`native acquisition row missing, invalid, or wrong revision for registered input ${sourceKey}`);
    }
  }
  for (const table of ctx.tables) {
    const indexRow = index.sources?.[table.sourceKey];
    if (!indexRow?.present || !sameNativePath(indexRow.path, table.target)) throw new AcquisitionError(`source-index path/presence mismatch for ${table.sourceKey}`);
    const receiptRow = byPath.get(normalizeNativePath(table.target));
    if (!receiptRow || receiptRow.revision !== OLD_REVISION || !sameNativePath(receiptRow.file, table.target)) {
      throw new AcquisitionError(`native acquisition row missing or wrong revision for ${table.sourceKey}`);
    }
    table.receiptRow = receiptRow;
  }
}

function readBudgetFile(filePath) {
  const raw = fs.readFileSync(filePath);
  const budget = parseJsonBytes(raw, `disk-budget ${filePath}`);
  return budget;
}

export function validateFreshBudget(budget, nowMonotonicMs, reserveBytes, maxAgeMs = BUDGET_MAX_AGE_MS) {
  if (!budget || budget.monotonicClock !== 'Windows.GetTickCount64') throw new AcquisitionError('disk budget does not use Windows.GetTickCount64');
  if (!Number.isFinite(budget.checkedAtMonotonicMs) || !Number.isFinite(nowMonotonicMs)) throw new AcquisitionError('disk budget monotonic timestamp missing');
  const age = nowMonotonicMs - budget.checkedAtMonotonicMs;
  if (age < 0 || age > maxAgeMs) throw new AcquisitionError(`disk budget is stale/invalid (ageMs=${Math.floor(age)})`);
  if (!Array.isArray(budget.unmeasured) || budget.unmeasured.length !== 0) throw new AcquisitionError('disk budget has unmeasured paths');
  if (!Number.isSafeInteger(budget.limitBytes) || !Number.isSafeInteger(budget.totalAccountedBytes) || !Number.isSafeInteger(budget.remainingBytes)) {
    throw new AcquisitionError('disk budget byte fields are invalid');
  }
  if (budget.limitBytes !== MAX_TOTAL_NEW_BYTES || budget.remainingBytes !== budget.limitBytes - budget.totalAccountedBytes) {
    throw new AcquisitionError('disk budget accounting does not match the declared 2,000,000,000-byte monotonic ledger');
  }
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0 || budget.remainingBytes < reserveBytes) {
    throw new AcquisitionError(`fresh disk budget exhausted: need=${reserveBytes} remaining=${budget.remainingBytes}`);
  }
  return { ageMs: Math.floor(age), reserveBytes, remainingAfterReserve: budget.remainingBytes - reserveBytes };
}

async function fetchBytes(url, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = 10 * 1024 * 1024) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'stronghold-protocol-assault-source-refresh/1.0' } });
    if (!response.ok) throw new AcquisitionError(`HTTP ${response.status} from ${url}`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new AcquisitionError(`HTTP content-length exceeds byte cap (${declaredLength} > ${maxBytes}): ${url}`);
    const reader = response.body?.getReader();
    if (!reader) throw new AcquisitionError(`HTTP response has no readable body: ${url}`);
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AcquisitionError(`HTTP streamed bytes exceed byte cap (${total} > ${maxBytes}): ${url}`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error.name === 'AbortError') throw new AcquisitionError(`network timeout after ${timeoutMs}ms: ${url}`);
    throw error;
  } finally { clearTimeout(timer); }
}

async function fetchJson(url, maxBytes, label, fetcher) {
  const bytes = await fetcher(url, REQUEST_TIMEOUT_MS, maxBytes);
  if (!Buffer.isBuffer(bytes)) throw new AcquisitionError(`${label}: fetcher must return a Buffer`);
  if (bytes.length > maxBytes) throw new AcquisitionError(`${label}: byte cap exceeded (${bytes.length} > ${maxBytes})`);
  const value = parseJsonBytes(bytes, label);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AcquisitionError(`${label}: expected a top-level JSON object`);
  return { bytes, value, topLevelEntries: Object.keys(value).length };
}

async function fetchCompareProof(fetcher) {
  const bytes = await fetcher(API_COMPARE_URL, REQUEST_TIMEOUT_MS, 10 * 1024 * 1024);
  if (bytes.length > 10 * 1024 * 1024) throw new AcquisitionError(`GitHub compare response exceeds 10 MiB safety cap (${bytes.length})`);
  const compare = parseJsonBytes(bytes, 'GitHub compare proof');
  if (compare.status !== 'ahead' || compare.ahead_by !== 2 || compare.total_commits !== 2 || compare.truncated === true || !Array.isArray(compare.files)) {
    throw new AcquisitionError('GitHub compare does not prove the complete pinned two-commit update');
  }
  const fileNames = new Set((compare.files ?? []).map((f) => f.filename));
  for (const table of Object.values(SOURCE_KEYS)) {
    const upstreamPath = `zh_CN/gamedata/${table.rel}`;
    if (!fileNames.has(upstreamPath)) throw new AcquisitionError(`GitHub compare does not list registered changed input ${upstreamPath}`);
  }
  return { status: compare.status, aheadBy: compare.ahead_by, totalCommits: compare.total_commits, fileCount: compare.files.length };
}

function assertCurrentUnchanged(absPath, snapshot) {
  const stat = requirePlainRegularFile(absPath);
  if (!sameIdentity(snapshot.identity, statIdentity(stat))) throw new AcquisitionError(`canonical identity/mtime/size changed before promotion: ${absPath}`);
  const current = fs.readFileSync(absPath);
  if (!current.equals(snapshot.bytes)) throw new AcquisitionError(`canonical bytes changed before promotion: ${absPath}`);
}

function getWofProfile(absPath, scriptPath) {
  const escapedScript = scriptPath.replaceAll("'", "''");
  const escapedFile = absPath.replaceAll("'", "''");
  const ps = `$ErrorActionPreference='Stop'; . '${escapedScript}'; $i=Get-Item -LiteralPath '${escapedFile}' -Force; $w=[AssaultWofNativeQuery]::Query('${escapedFile}'); [pscustomobject]@{attributeCompressed=($i.Attributes -band [IO.FileAttributes]::Compressed) -ne 0;wof=$w}|ConvertTo-Json -Compress -Depth 4`;
  const text = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    windowsHide: true, timeout: REQUEST_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(text.trim());
}

function assertLzxWof(profile, label) {
  if (!profile?.wof || profile.wof.hresult !== 0 || profile.wof.isExternal !== true || profile.wof.provider !== 2 || profile.wof.algorithm !== 1) {
    throw new AcquisitionError(`${label}: file is not native WOF LZX compressed`);
  }
}

function compressLzx(pathToFile, scriptPath) {
  if (process.platform !== 'win32') throw new AcquisitionError('apply requires Windows NTFS native compression');
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  execFileSync(path.join(systemRoot, 'System32', 'compact.exe'), ['/C', '/EXE:LZX', '/F', pathToFile], {
    windowsHide: true, timeout: REQUEST_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assertLzxWof(getWofProfile(pathToFile, scriptPath), pathToFile);
}

function restoreProfile(pathToFile, profile, scriptPath) {
  if (profile?.wof?.isExternal === true) {
    if (profile.wof.provider !== 2 || profile.wof.algorithm !== 1) throw new AcquisitionError('cannot restore unsupported original WOF compression profile');
    compressLzx(pathToFile, scriptPath);
  } else if (profile?.attributeCompressed === true) {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    execFileSync(path.join(systemRoot, 'System32', 'compact.exe'), ['/C', '/F', pathToFile], {
      windowsHide: true, timeout: REQUEST_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

function writeStage(staging, bytes) {
  assertNoReparsePath(staging);
  fs.writeFileSync(staging, bytes, { flag: 'wx' });
}

function promoteBuffer({ bytes, target, staging, scriptPath, expectedProfile = 'lzx', compress = true, rename = fs.renameSync, onRenamed, beforeRename }) {
  writeStage(staging, bytes);
  if (compress) {
    if (expectedProfile === 'lzx') compressLzx(staging, scriptPath);
    else throw new AcquisitionError('unsupported staging compression profile');
  }
  const staged = fs.readFileSync(staging);
  if (!staged.equals(bytes)) throw new AcquisitionError(`staging full-byte mismatch before rename: ${staging}`);
  if (compress) assertLzxWof(getWofProfile(staging, scriptPath), staging);
  assertNoReparsePath(target);
  assertNoReparsePath(staging);
  beforeRename?.();
  rename(staging, target);
  onRenamed?.(statIdentity(fs.lstatSync(target, { bigint: true })));
  const installed = fs.readFileSync(target);
  if (!installed.equals(bytes)) throw new AcquisitionError(`promoted full-byte mismatch after rename: ${target}`);
  if (compress) assertLzxWof(getWofProfile(target, scriptPath), target);
  return statIdentity(fs.lstatSync(target, { bigint: true }));
}

function restoreBuffer({ bytes, target, staging, scriptPath, profile, rename = fs.renameSync }) {
  if (fs.existsSync(staging)) throw new AcquisitionError(`cannot rollback while fixed staging path is occupied: ${staging}`);
  writeStage(staging, bytes);
  restoreProfile(staging, profile, scriptPath);
  const staged = fs.readFileSync(staging);
  if (!staged.equals(bytes)) throw new AcquisitionError(`rollback staging full-byte mismatch: ${staging}`);
  rename(staging, target);
  if (!fs.readFileSync(target).equals(bytes)) throw new AcquisitionError(`rollback full-byte mismatch: ${target}`);
  const restoredProfile = getWofProfile(target, scriptPath);
  if (profile?.wof?.isExternal === true) assertLzxWof(restoredProfile, `rollback ${target}`);
  else if (Boolean(restoredProfile.attributeCompressed) !== Boolean(profile?.attributeCompressed)) {
    throw new AcquisitionError(`rollback compression profile mismatch: ${target}`);
  }
}

function serializeReceipt(oldReceipt, updates, ctx, completedAt) {
  const previousAttempts = Array.isArray(oldReceipt.previousAttempts) ? [...oldReceipt.previousAttempts] : [];
  previousAttempts.push({
    revision: oldReceipt.revision,
    completedAt: oldReceipt.completedAt ?? null,
    totalBytes: oldReceipt.totalBytes,
    files: oldReceipt.files.map((f) => ({ file: f.file, revision: f.revision, bytes: f.bytes })),
  });
  const files = oldReceipt.files.map((row) => {
    const update = updates.get(normalizeNativePath(row.file));
    return update ? {
      ...row, ok: true, file: update.target, source: update.url, reusedFrom: null,
      bytes: update.bytes, topLevelEntries: update.topLevelEntries, revision: NEW_REVISION,
    } : row;
  });
  return {
    ...oldReceipt,
    revision: NEW_REVISION,
    files,
    totalBytes: files.reduce((sum, row) => sum + Number(row.bytes || 0), 0),
    receipt: ctx.acquisition,
    completedAt,
    previousAttempts,
  };
}

export async function runRefresh({ mode, paths = PRODUCTION_PATHS, dependencies = {}, maxAgeMs = BUDGET_MAX_AGE_MS, totalTimeoutMs = TOTAL_TIMEOUT_MS } = {}) {
  if (mode !== 'verify-only' && mode !== 'apply') throw new AcquisitionError('choose exactly one mode: --verify-only or --apply');
  const ctx = getContext(paths);
  const started = performance.now();
  const fetcher = dependencies.fetchBytes ?? fetchBytes;
  const budgetReader = dependencies.readBudget ?? (() => readBudgetFile(ctx.diskBudget));
  const monotonicNow = dependencies.monotonicNow ?? (() => os.uptime() * 1000);
  const fileOps = dependencies.fileOps ?? {};
  const snapshots = new Map();
  let stagingOwned = false;
  const promoted = [];
  let receiptPromoted = false;
  let receiptPromotedIdentity = null;
  let sourceIndexSnapshot;
  let acquisitionSnapshot;
  let acquisitionValue;
  let oldTotal = 0;
  let oldSidecars = 0;
  let budgetProof;
  let compareProof;
  const ensureDeadline = () => {
    if (performance.now() - started > totalTimeoutMs) throw new AcquisitionError(`total refresh deadline exceeded (${totalTimeoutMs}ms)`);
  };
  try {
    requirePlainDirectory(ctx.stagingDir);
    if (fs.existsSync(ctx.staging)) throw new AcquisitionError(`fixed staging file already exists; preserve and inspect it: ${ctx.staging}`);
    requirePlainFileOnly(ctx.sourceIndex);
    requirePlainFileOnly(ctx.acquisition);
    sourceIndexSnapshot = { bytes: fs.readFileSync(ctx.sourceIndex), identity: statIdentity(fs.lstatSync(ctx.sourceIndex, { bigint: true })) };
    acquisitionSnapshot = {
      bytes: fs.readFileSync(ctx.acquisition),
      identity: statIdentity(fs.lstatSync(ctx.acquisition, { bigint: true })),
      profile: dependencies.getCompressionProfile?.(ctx.acquisition) ?? getWofProfile(ctx.acquisition, ctx.wofQueryScript),
    };
    const index = parseJsonBytes(sourceIndexSnapshot.bytes, 'canonical source-index');
    acquisitionValue = parseJsonBytes(acquisitionSnapshot.bytes, 'canonical acquisition receipt');
    validateIndexAndReceipt(index, acquisitionValue, ctx);
    for (const table of ctx.tables) {
      requirePlainDirectory(path.dirname(table.target));
      const stat = requirePlainRegularFile(table.target);
      const bytes = fs.readFileSync(table.target);
      if (bytes.length !== Number(table.receiptRow.bytes)) throw new AcquisitionError(`canonical receipt byte count drift for ${table.sourceKey}`);
      snapshots.set(table.sourceKey, { bytes, identity: statIdentity(stat), profile: dependencies.getCompressionProfile?.(table.target) ?? getWofProfile(table.target, ctx.wofQueryScript) });
      oldTotal += bytes.length;
    }
    oldSidecars = sourceIndexSnapshot.bytes.length + acquisitionSnapshot.bytes.length;
    if (oldTotal + oldSidecars > MAX_OLD_BACKUP_BYTES) throw new AcquisitionError(`RAM old-state backup cap exceeded (${oldTotal + oldSidecars} > ${MAX_OLD_BACKUP_BYTES})`);
    const reserveBytes = MAX_TABLE_BYTES + BUDGET_RESERVE_OVERHEAD;
    const budget = await budgetReader();
    budgetProof = validateFreshBudget(budget, monotonicNow(), reserveBytes, maxAgeMs);
    compareProof = await fetchCompareProof(fetcher);
    ensureDeadline();

    const oldEntries = new Map();
    for (const table of ctx.tables) {
      ensureDeadline();
      const previousUrl = `${REPOSITORY}/raw/${OLD_REVISION}/zh_CN/gamedata/${table.upstreamRel}`;
      const oldRawCap = Math.max(Number(table.receiptRow.bytes), table.maxBytes) + OLD_RAW_CAP_OVERHEAD_BYTES;
      const oldRemote = await fetchJson(previousUrl, oldRawCap, `pinned old ${table.sourceKey}`, fetcher);
      const snapshot = snapshots.get(table.sourceKey);
      let canonical = parseJsonBytes(snapshot.bytes, `canonical ${table.sourceKey}`);
      if (!deepEqualJson(canonical, oldRemote.value)) throw new AcquisitionError(`canonical data is not deep-equal to pinned old official JSON: ${table.target}`);
      if (Object.keys(oldRemote.value).length !== Number(table.receiptRow.topLevelEntries)) throw new AcquisitionError(`pinned old entry count differs from acquisition receipt for ${table.sourceKey}`);
      oldEntries.set(table.sourceKey, { topLevelEntries: Object.keys(oldRemote.value).length });
      canonical = null;
      oldRemote.value = null;
      oldRemote.bytes = null;
      ensureDeadline();
    }

    if (mode === 'verify-only') {
      for (const table of ctx.tables) assertCurrentUnchanged(table.target, snapshots.get(table.sourceKey));
      assertCurrentUnchanged(ctx.sourceIndex, sourceIndexSnapshot);
      assertCurrentUnchanged(ctx.acquisition, acquisitionSnapshot);
      return { status: 'verified', mode, oldRevision: OLD_REVISION, newRevision: NEW_REVISION, tableCount: ctx.tables.length, oldBackupBytes: oldTotal + oldSidecars, budgetProof, compareProof };
    }

    const updates = new Map();
    const compress = dependencies.compress ?? ((stage) => compressLzx(stage, ctx.wofQueryScript));
    const getProfile = dependencies.getCompressionProfile ?? ((file) => getWofProfile(file, ctx.wofQueryScript));
    const rename = fileOps.rename ?? fs.renameSync;
    for (const table of ctx.tables) {
      ensureDeadline();
      const budgetNow = await budgetReader();
      budgetProof = validateFreshBudget(budgetNow, monotonicNow(), reserveBytes, maxAgeMs);
      assertCurrentUnchanged(ctx.sourceIndex, sourceIndexSnapshot);
      assertCurrentUnchanged(ctx.acquisition, acquisitionSnapshot);
      const snapshot = snapshots.get(table.sourceKey);
      assertCurrentUnchanged(table.target, snapshot);
      if (dependencies.beforePromotion) await dependencies.beforePromotion(table, promoted.length);
      // Recheck after test hooks and immediately before staging/promotion.
      assertCurrentUnchanged(table.target, snapshot);
      const url = `${RAW_ROOT}${table.upstreamRel}`;
      const maxBytes = dependencies.maxBytesByKey?.[table.sourceKey] ?? table.maxBytes;
      const downloaded = await fetchJson(url, maxBytes, `new ${table.sourceKey}`, fetcher);
      if (Object.keys(downloaded.value).length === 0) throw new AcquisitionError(`new ${table.sourceKey} is unexpectedly empty`);
      if (table.sourceKey === 'arknights.characterTable') validateAuditedCharacterAnchors(downloaded.value);
      // Keep only entry count and exact byte count; the old file buffers remain the rollback source.
      const update = { sourceKey: table.sourceKey, target: table.target, url, bytes: downloaded.bytes.length, topLevelEntries: Object.keys(downloaded.value).length };
      const afterFetchBudget = await budgetReader();
      budgetProof = validateFreshBudget(afterFetchBudget, monotonicNow(), reserveBytes, maxAgeMs);
      assertCurrentUnchanged(ctx.sourceIndex, sourceIndexSnapshot);
      assertCurrentUnchanged(ctx.acquisition, acquisitionSnapshot);
      assertCurrentUnchanged(table.target, snapshot);
      if (fs.existsSync(ctx.staging)) throw new AcquisitionError(`fixed staging file appeared during refresh: ${ctx.staging}`);
      stagingOwned = true;
      const promote = dependencies.promote ?? ((args) => promoteBuffer({ ...args, scriptPath: ctx.wofQueryScript, compress: true, rename }));
      const promotedIdentity = promote({
        bytes: downloaded.bytes,
        target: table.target,
        staging: ctx.staging,
        onRenamed: (identity) => promoted.push({ table, promotedIdentity: identity }),
        beforeRename: () => {
          assertCurrentUnchanged(table.target, snapshot);
          assertCurrentUnchanged(ctx.sourceIndex, sourceIndexSnapshot);
          assertCurrentUnchanged(ctx.acquisition, acquisitionSnapshot);
        },
      });
      stagingOwned = false;
      if (!promoted.length || promoted.at(-1).table !== table) promoted.push({ table, promotedIdentity });
      updates.set(normalizeNativePath(table.target), update);
      downloaded.value = null;
      downloaded.bytes = null;
      ensureDeadline();
    }

    const newReceipt = serializeReceipt(acquisitionValue, updates, ctx, new Date().toISOString());
    const receiptBytes = Buffer.from(`${JSON.stringify(newReceipt, null, 2)}\n`, 'utf8');
    assertCurrentUnchanged(ctx.sourceIndex, sourceIndexSnapshot);
    assertCurrentUnchanged(ctx.acquisition, acquisitionSnapshot);
    stagingOwned = true;
    const promote = dependencies.promote ?? ((args) => promoteBuffer({ ...args, scriptPath: ctx.wofQueryScript, compress: true, rename }));
    const receiptIdentity = promote({
      bytes: receiptBytes,
      target: ctx.acquisition,
      staging: ctx.staging,
      onRenamed: (identity) => { receiptPromoted = true; receiptPromotedIdentity = identity; },
      beforeRename: () => {
        assertCurrentUnchanged(ctx.sourceIndex, sourceIndexSnapshot);
        assertCurrentUnchanged(ctx.acquisition, acquisitionSnapshot);
      },
    });
    stagingOwned = false;
    receiptPromoted = true;
    receiptPromotedIdentity = receiptIdentity;
    if (!sameIdentity(receiptPromotedIdentity, statIdentity(fs.lstatSync(ctx.acquisition, { bigint: true })))) throw new AcquisitionError('acquisition receipt identity changed after promotion');
    return { status: 'applied', mode, revision: NEW_REVISION, tableCount: ctx.tables.length, totalBytes: newReceipt.totalBytes, oldBackupBytes: oldTotal + oldSidecars, budgetProof, compareProof };
  } catch (error) {
    const rollbackErrors = [];
    const restore = dependencies.restore ?? ((args) => restoreBuffer({ ...args, scriptPath: ctx.wofQueryScript, rename: fileOps.rename ?? fs.renameSync }));
    if (receiptPromoted && acquisitionSnapshot) {
      try {
        const current = statIdentity(fs.lstatSync(ctx.acquisition, { bigint: true }));
        if (!receiptPromotedIdentity || !sameIdentity(current, receiptPromotedIdentity)) throw new Error('receipt identity drift during rollback; preserving external change');
        restore({ bytes: acquisitionSnapshot.bytes, target: ctx.acquisition, staging: ctx.staging, profile: acquisitionSnapshot.profile });
        receiptPromoted = false;
      } catch (restoreError) { rollbackErrors.push(`acquisition receipt: ${restoreError.message}`); }
    }
    for (const row of [...promoted].reverse()) {
      try {
        const stat = requirePlainRegularFile(row.table.target);
        if (!sameIdentity(row.promotedIdentity, statIdentity(stat))) throw new Error('promoted file identity changed after our rename; preserving external change');
        const snapshot = snapshots.get(row.table.sourceKey);
        restore({ bytes: snapshot.bytes, target: row.table.target, staging: ctx.staging, profile: snapshot.profile });
      } catch (restoreError) { rollbackErrors.push(`${row.table.target}: ${restoreError.message}`); }
    }
    if (stagingOwned && fs.existsSync(ctx.staging)) {
      try { fs.unlinkSync(ctx.staging); stagingOwned = false; } catch (cleanupError) { rollbackErrors.push(`staging ${ctx.staging}: ${cleanupError.message}`); }
    }
    throw new AcquisitionError(error.message, { rolledBack: promoted.length === 0 || rollbackErrors.length === 0, promotedCount: promoted.length, rollbackErrors });
  }
}

function requirePlainFileOnly(absPath) {
  requirePlainRegularFile(absPath);
  return absPath;
}

export function parseMode(argv) {
  if (argv.length !== 1) throw new AcquisitionError('usage: node acquire-arknights-sources.mjs --verify-only | --apply');
  const args = new Set(argv);
  const hasVerify = args.has('--verify-only');
  const hasApply = args.has('--apply');
  if (hasVerify === hasApply || args.size !== 1) throw new AcquisitionError('usage: node acquire-arknights-sources.mjs --verify-only | --apply');
  return hasApply ? 'apply' : 'verify-only';
}

async function main(argv) {
  const mode = parseMode(argv);
  const result = await runRefresh({ mode });
  console.log(JSON.stringify({ status: result.status, revision: result.revision ?? result.newRevision, tables: result.tableCount, bytes: result.totalBytes ?? null }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
