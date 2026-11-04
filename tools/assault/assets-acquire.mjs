// Bounded, add-only acquisition for the assault content bundle.
// Existing canonical assets are referenced in place; new bytes are staged in
// the fixed temp root and promoted one file at a time into the dedicated root.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadUrls, joinUrl, RAW, safeName } from '../assets/sources.mjs';
import { isCompletePng, isSkelBinary, isAtlasText } from '../assets/formats.mjs';
import { parseSkel } from '../assets/skel.mjs';
import { resolveRoles } from '../assets/anim-roles.mjs';
import { applyRoleFix, PREFAB_SPINE_ROLES } from '../assets/spine.mjs';
import { assertKnownAssetScope, assertNativeLocalOnlyScope, mergeIncrementalManifest, parseAssetScope } from './asset-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(ROOT, '../../..');
const DESIGN_ROOT = path.join(ROOT, 'data', 'assault-design');
const SOURCE_ROOT = path.join(REPO_ROOT, 'data', 'assault-sources', 'assets');
const TEMP_ROOT = path.join(REPO_ROOT, '.omni', 'tmp', 'assault', 'assets');
const CANONICAL_ROOT = path.join(REPO_ROOT, 'public', 'assets');
const CANONICAL_MANIFEST = path.join(REPO_ROOT, 'data', 'assets.json');
const MANIFEST_PATH = path.join(ROOT, 'data', 'assault-assets.json');
const RECEIPT_PATH = process.env.ASSAULT_ASSETS_RECEIPT_PATH || path.join(REPO_ROOT, 'runtime', 'assault', 'assets-acquisition.json');
const LOG_PATH = process.env.ASSAULT_ASSETS_LOG_PATH || path.join(REPO_ROOT, 'runtime', 'assault', 'assets-acquisition.log');
const SPINE_METADATA_REPAIR_PATH = path.join(REPO_ROOT, '.omni', 'tmp', 'assault', 'assault-assets-repair.json');
const SPINE_METADATA_REPAIR_RECEIPT = path.join(REPO_ROOT, 'runtime', 'assault', 'spine-metadata-repair.json');
const CLI_PATH = path.join(ROOT, 'tools', 'assault', 'assets-acquire.mjs');
const SCHEMA = 'assault-assets-manifest/v1';
const RECEIPT_SCHEMA = 'assault-assets-acquisition/v1';
const TOLEDO_NATIVE_ID = 'token_10067_toledo_tldptm';
const TOLEDO_NATIVE_VERSION = '26-10-08-04-51-28-56071834';
const TOKEN_SKIN_MODEL_DIRS = {
  token_10004_otter_motter: 'Spine',
  token_10020_ling_soul3: 'Front',
  token_10027_ironmn_pile2: 'Front',
  token_10034_ray_sndbst: 'Front',
  token_10035_wisdel_wward: 'Front',
};
const WORKSHOP_SOURCE = {
  templateId: 'token_10027_ironmn_pile3',
  skinId: 'token_10027_ironmn_pile3_summer#11',
  modelDir: 'Front',
};
const RETRIES = 2;
const TIMEOUT_MS = 9000;
const CONCURRENCY = 8;
let rawDownloadLimit = Number.POSITIVE_INFINITY;
let rawDownloadedBytes = 0;
const GIT_HEADS = new Map();
const NATIVE_ASSET_REVISION = '404cf368572a4f346f66614612c40fd7779012b5';
const NATIVE_ASSET_ROOT = `https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/${NATIVE_ASSET_REVISION}/assets/dyn/`;
const NATIVE_ASSET_REPOSITORY = 'https://github.com/ArknightsAssets/ArknightsAssets2';
GIT_HEADS.set('https://github.com/ArknightsAssets/ArknightsAssets2', NATIVE_ASSET_REVISION);
const PREVIOUS_SOURCES = new Map();
const NATIVE_MODEL_EVIDENCE_PATH = path.join(ROOT, 'data', 'assault-native-model-evidence.json');
const NATIVE_MODEL_EVIDENCE = existsSync(NATIVE_MODEL_EVIDENCE_PATH)
  ? JSON.parse(readFileSync(NATIVE_MODEL_EVIDENCE_PATH, 'utf8')) : null;
const SINGLE_SPINE_MODELS = new Map((NATIVE_MODEL_EVIDENCE?.operators ?? [])
  .filter((record) => record.nativeSingleSpine && record.skeletonAnimationCount === 1
    && record.animator?.script?.className === 'SingleSpineAnimator')
  .map((record) => [record.characterId, record]));
const SPINE_METADATA_CACHE = new Map();
if (existsSync(MANIFEST_PATH)) {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.sourcePath && value.sourceUrl) PREVIOUS_SOURCES.set(path.resolve(value.sourcePath), value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
}
if (NATIVE_MODEL_EVIDENCE?.ok && NATIVE_MODEL_EVIDENCE.cathy?.output?.status !== 'not-requested') {
  const record = NATIVE_MODEL_EVIDENCE.cathy;
  PREVIOUS_SOURCES.set(path.resolve(record.output.path), {
    sourceUrl: record.source.url,
    sourceVersion: { nativeAssetVersion: NATIVE_MODEL_EVIDENCE.sourceVersion,
      gitRepository: null, gitCommit: null, gitRef: null,
      nativeContainer: record.containerPath, texturePathId: record.chain.mainTexture.pathId,
      sourceBundle: record.source.path },
  });
}

const localOfUrl = (url) => url?.startsWith('/assets/') ? url.slice('/assets/'.length) : null;
const dedupe = (values) => [...new Set(values.filter((x) => typeof x === 'string' && x))];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sourceVersion(url, lastModified, responseDate) {
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//.exec(url || '');
  const gitRepository = match ? `https://github.com/${match[1]}/${match[2]}` : null;
  return { gitRepository, gitRef: match?.[3] || null, gitCommit: gitRepository ? GIT_HEADS.get(gitRepository) || null : null, lastModified: lastModified || null, responseDate: responseDate || null };
}

function captureGitHeads() {
  const remotes = [
    ['https://github.com/yuanyan3060/ArknightsGameResource', 'yuanyan3060/ArknightsGameResource'],
    ['https://github.com/fexli/ArknightsResource', 'fexli/ArknightsResource'],
    ['https://github.com/Aceship/Arknight-Images', 'Aceship/Arknight-Images'],
  ];
  for (const [repository, slug] of remotes) {
    try {
      const line = execFileSync('git', ['ls-remote', `${repository}.git`, 'refs/heads/main'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/);
      if (/^[a-f0-9]{40}$/i.test(line[0] || '') && line[1] === 'refs/heads/main') GIT_HEADS.set(repository, line[0]);
    } catch { /* the HTTP last-modified field remains available when Git is offline */ }
  }
}

function captureNativeAssetPin() {
  const line = execFileSync('git', ['ls-remote', `${NATIVE_ASSET_REPOSITORY}.git`, 'refs/heads/cn'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/);
  if (!/^[a-f0-9]{40}$/i.test(line[0] || '') || line[1] !== 'refs/heads/cn') throw new Error('could not resolve native ArknightsAssets2 cn revision');
  GIT_HEADS.set(NATIVE_ASSET_REPOSITORY, line[0]);
  return `https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/${line[0]}/assets/dyn/`;
}

function collectDesign() {
  const read = (name) => JSON.parse(readFileSync(path.join(DESIGN_ROOT, name), 'utf8'));
  const operators = [
    ...read('roster-assault.json').operators,
    ...read('roster-ranged.json').operators,
    ...read('roster-support.json').operators,
  ];
  const forms = read('forms.json').forms;
  const bodies = new Map();
  for (const unit of [...operators, ...forms]) {
    const old = bodies.get(unit.charId);
    bodies.set(unit.charId, old ? { ...old, ...unit } : unit);
  }
  const refs = new Map();
  const walk = (value, owner) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      const tokenKey = typeof value.tokenKey === 'string' ? value.tokenKey : null;
      const sourceTemplateId = typeof value.sourceTemplateId === 'string' ? value.sourceTemplateId : null;
      if (tokenKey || sourceTemplateId) {
        const key = tokenKey || sourceTemplateId;
        const entry = refs.get(key) || { tokenKey: key, sourceTemplateIds: [], usedBy: [] };
        if (sourceTemplateId && !entry.sourceTemplateIds.includes(sourceTemplateId)) entry.sourceTemplateIds.push(sourceTemplateId);
        if (!entry.usedBy.includes(owner)) entry.usedBy.push(owner);
        refs.set(key, entry);
      }
    }
    for (const child of Object.values(value)) walk(child, owner);
  };
  for (const unit of [...operators, ...forms]) walk(unit, unit.charId);
  return { operators, bodies, summons: [...refs.values()].sort((a, b) => a.tokenKey.localeCompare(b.tokenKey)), collectibles: read('collectibles.json').items, events: read('events.json').events };
}

function addJob(jobs, byKey, job) {
  if (!job?.sourceUrl || !job.rel || !job.kind) return;
  if (byKey.has(job.key)) return;
  byKey.set(job.key, job);
  jobs.push(job);
}

function sourceRecord({ key, kind, rel, sourceUrl, existingUrl = null, existingRoot = null, note = null }) {
  return { key, kind, rel, sourceUrl, existingUrl, existingRoot, note, entry: null };
}

function decodeAssetId(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function atlasPages(text) {
  return [...text.matchAll(/^([^\s:][^\r\n:]*\.(?:png|webp|jpg))\s*$/gmi)].map((match) => match[1]);
}

function candidateUrls(urls) {
  return [...new Set(urls.flatMap((url) => downloadUrls(url, { source: 'direct' })))];
}

async function fileExistsAndValid(root, rel, kind) {
  const file = path.join(root, rel);
  try {
    const st = await stat(file);
    if (!st.isFile() || st.size === 0) return false;
    const buf = await readFile(file);
    if (kind === 'png') return isCompletePng(buf);
    if (kind === 'skel') return isSkelBinary(buf);
    if (kind === 'atlas') return isAtlasText(buf);
    return false;
  } catch { return false; }
}

async function canonicalEntry(record, manifest) {
  const direct = record.existingUrl;
  if (direct) {
    const rel = localOfUrl(direct);
    if (rel && await fileExistsAndValid(CANONICAL_ROOT, rel, record.kind)) {
      return { url: direct, sourcePath: path.join(CANONICAL_ROOT, rel), sourceRel: rel, sourceUrl: record.sourceUrl, sourceRoot: CANONICAL_ROOT, reusedCanonical: true, sourceVersion: sourceVersion(record.sourceUrl, null, null) };
    }
  }
  const fromManifest = record.manifestUrl;
  if (fromManifest) {
    const rel = localOfUrl(fromManifest);
    if (rel && await fileExistsAndValid(CANONICAL_ROOT, rel, record.kind)) {
      return { url: fromManifest, sourcePath: path.join(CANONICAL_ROOT, rel), sourceRel: rel, sourceUrl: record.sourceUrl, sourceRoot: CANONICAL_ROOT, reusedCanonical: true, sourceVersion: sourceVersion(record.sourceUrl, null, null) };
    }
  }
  return null;
}

async function acquireNativeToledoLocally(localAssets, design, characters) {
  const id = TOLEDO_NATIVE_ID;
  const groupName = `spine/token/${id}`;
  const group = localAssets.groups?.[groupName];
  if (!group) throw new Error(`native-local-only requires local-assets group ${groupName}`);
  const sourceUrl = `native://arknights/${TOLEDO_NATIVE_VERSION}/pkgrps/btl_pfb_tokens_6.ab`;
  const sourceVersionRecord = { nativeAssetVersion: TOLEDO_NATIVE_VERSION,
    nativeContainer: 'dyn/battle/prefabs/[uc]tokens/token_10067_toledo_tldptm.prefab',
    sourceBundle: 'pkgrps/btl_pfb_tokens_6.ab', sourceKind: 'official-native-spine' };
  const parts = {};
  const expected = [['skel', 'TextAsset'], ['atlas', 'TextAsset'], ['png', 'Texture2D']];
  for (const [ext, kind] of expected) {
    const name = `${id}.${ext}`;
    const record = group[name];
    const rel = `local/${groupName}/${name}`;
    if (!record || record.kind !== kind || record.path !== `/assets/${rel}`) {
      throw new Error(`native-local-only has no exact typed local manifest row: ${groupName}/${name}`);
    }
    if (!await fileExistsAndValid(CANONICAL_ROOT, rel, ext === 'png' ? 'png' : ext)) {
      throw new Error(`native-local-only formal file is absent or invalid: ${path.join(CANONICAL_ROOT, rel)}`);
    }
    const file = path.join(CANONICAL_ROOT, rel);
    const bytes = (await stat(file)).size;
    parts[ext === 'png' ? 'texture' : ext] = {
      url: record.path, sourcePath: file, sourceRel: rel, sourceUrl, sourceRoot: CANONICAL_ROOT,
      reusedCanonical: true, sourceVersion: sourceVersionRecord, bytes,
    };
  }
  const atlasText = await readFile(parts.atlas.sourcePath, 'utf8');
  const page = atlasPages(atlasText);
  if (page.length !== 1 || page[0] !== `${id}.png` || path.resolve(path.dirname(parts.atlas.sourcePath), page[0]) !== path.resolve(parts.texture.sourcePath)) {
    throw new Error(`native-local-only atlas page does not close over the exact PNG: ${page.join(',')}`);
  }
  const png = await readFile(parts.texture.sourcePath);
  const pngSize = png.length >= 24 ? [png.readUInt32BE(16), png.readUInt32BE(20)] : [];
  const atlasSize = /^size:\s*(\d+)\s*,\s*(\d+)\s*$/mi.exec(atlasText);
  if (!atlasSize || pngSize[0] !== Number(atlasSize[1]) || pngSize[1] !== Number(atlasSize[2])
      || pngSize[0] !== group[`${id}.png`].w || pngSize[1] !== group[`${id}.png`].h) {
    throw new Error(`native-local-only atlas dimensions do not match PNG page: ${pngSize.join('x')}`);
  }
  const summon = design.summons.find((item) => item.tokenKey === id) || {
    tokenKey: id, sourceTemplateIds: [id],
    usedBy: Object.entries(characters).filter(([, record]) => (record.skills || []).some((skill) => skill.overrideTokenKey === id)).map(([key]) => key),
  };
  if (!summon) throw new Error(`native-local-only target is absent from current summon design: ${id}`);
  const model = { skel: parts.skel, atlas: parts.atlas, texture: parts.texture,
    nativeEvidence: { ...sourceVersionRecord, prefab: 'dyn/battle/prefabs/[uc]tokens/token_10067_toledo_tldptm.prefab' } };
  const addition = { schema: SCHEMA, generatedBy: CLI_PATH, sourceRoot: SOURCE_ROOT, tempRoot: TEMP_ROOT,
    mappings: { '/assault-assets/': SOURCE_ROOT, '/assets/': CANONICAL_ROOT },
    assets: { units: {}, summons: { [id]: { tokenKey: id, sourceTemplateIds: summon.sourceTemplateIds, usedBy: summon.usedBy,
      avatar: null, model } }, derivedModels: {}, collectibles: {}, events: {}, skills: {}, modules: {} },
    missing: { units: [], unitModels: [], summons: [id], summonModels: [], derivedModels: [], collectibleIcons: [], eventBackgrounds: [], skills: [] },
    incremental: { ids: [id], preservedExistingMappings: true } };
  const prior = existsSync(MANIFEST_PATH) ? JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) : { assets: {} };
  const output = mergeIncrementalManifest(prior, addition, new Set([id]));
  const receipt = { schema: RECEIPT_SCHEMA, generatedBy: CLI_PATH, nativeAssetVersion: TOLEDO_NATIVE_VERSION,
    sourceBundle: sourceVersionRecord.sourceBundle, nativeContainer: sourceVersionRecord.nativeContainer,
    exactIds: [id], networkRequests: 0, rawBytesReceived: 0, bytesDownloadedThisRun: 0,
    files: [parts.skel.sourcePath, parts.atlas.sourcePath, parts.texture.sourcePath],
    fileBytes: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, value.bytes])),
    coverage: { summons: { modelComplete: 1, missingModels: [] } } };
  for (const [file, kind] of [[MANIFEST_PATH, 'manifest'], [RECEIPT_PATH, 'receipt'], [LOG_PATH, 'log']]) {
    if (!existsSync(file)) continue;
    let owned = false;
    try {
      if (kind === 'manifest') owned = JSON.parse(await readFile(file, 'utf8')).generatedBy === CLI_PATH;
      else if (kind === 'receipt') owned = JSON.parse(await readFile(file, 'utf8')).generatedBy === CLI_PATH;
      else owned = (await readFile(file, 'utf8')).startsWith(`generatedBy=${CLI_PATH}\n`);
    } catch { /* unknown output remains protected */ }
    if (!owned) throw new Error(`refusing to overwrite unknown output: ${file}`);
  }
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
  const atomicWrite = async (file, content) => { const tmp = `${file}.part-${process.pid}`; await writeFile(tmp, content, { flag: 'wx' }); await rename(tmp, file); };
  await atomicWrite(MANIFEST_PATH, `${JSON.stringify(output, null, 2)}\n`);
  await atomicWrite(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  await atomicWrite(LOG_PATH, `generatedBy=${CLI_PATH}\nnativeVersion=${TOLEDO_NATIVE_VERSION}\nnetworkRequests=0\n` + receipt.files.map((file) => `FILE ${file}`).join('\n') + '\n');
  console.log(`native local adoption: ${id} (${Object.values(parts).reduce((total, part) => total + part.bytes, 0)} bytes; no network)`);
}

async function fetchOne(job) {
  const finalPath = path.join(SOURCE_ROOT, job.rel);
  const stagedPath = path.join(TEMP_ROOT, job.rel);
  if (await fileExistsAndValid(SOURCE_ROOT, job.rel, job.kind)) {
    const st = await stat(finalPath);
    const prior = PREVIOUS_SOURCES.get(path.resolve(finalPath));
    if (job.verifyExistingFromSource) {
      const response = await fetch(job.sourceUrl, { headers: { 'user-agent': 'stronghold-protocol-assault-assets/1.0' }, redirect: 'follow' });
      if (!response.ok) return { ok: false, error: `pinned source verification HTTP ${response.status}; existing target left untouched` };
      const bytes = Buffer.from(await response.arrayBuffer());
      rawDownloadedBytes += bytes.length;
      if (rawDownloadedBytes > rawDownloadLimit) return { ok: false, error: `scoped raw download limit exceeded (${rawDownloadedBytes}/${rawDownloadLimit} bytes)` };
      if (bytes.length !== st.size || !bytes.equals(await readFile(finalPath))) return { ok: false, error: 'existing target differs from pinned source; left untouched' };
      return { ok: true, existing: true, verifiedPinned: true, path: finalPath, bytes: st.size, url: job.sourceUrl,
        sourceVersion: sourceVersion(job.sourceUrl, response.headers.get('last-modified'), response.headers.get('date')) };
    }
    return { ok: true, existing: true, path: finalPath, bytes: st.size, lastModified: prior?.sourceVersion?.lastModified ?? null, url: prior?.sourceUrl ?? job.urls[0], sourceVersion: prior?.sourceVersion };
  }
  if (existsSync(finalPath)) return { ok: false, error: 'formal target exists but is not a valid expected asset; left untouched' };
  if (await fileExistsAndValid(TEMP_ROOT, job.rel, job.kind)) {
    const st = await stat(stagedPath);
    await mkdir(path.dirname(finalPath), { recursive: true });
    if (existsSync(finalPath)) return { ok: false, error: 'formal target appeared during promotion; left untouched' };
    await rename(stagedPath, finalPath);
    return { ok: true, promoted: true, path: finalPath, bytes: st.size, lastModified: null, url: job.urls[0] };
  }
  if (existsSync(stagedPath)) return { ok: false, error: 'temporary target exists but is invalid; left untouched' };

  let lastError = 'not found on every source';
  for (const url of job.urls) {
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'stronghold-protocol-assault-assets/1.0' }, redirect: 'follow' });
        if (response.status === 404 || response.status === 410) { await response.body?.cancel(); break; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        rawDownloadedBytes += bytes.length;
        if (rawDownloadedBytes > rawDownloadLimit) throw new Error(`scoped raw download limit exceeded (${rawDownloadedBytes}/${rawDownloadLimit} bytes)`);
        const valid = job.kind === 'png' ? isCompletePng(bytes) : job.kind === 'skel' ? isSkelBinary(bytes) : isAtlasText(bytes);
        if (!valid) throw new Error(`invalid ${job.kind} payload (${bytes.length} bytes)`);
        const lastModified = response.headers.get('last-modified');
        await mkdir(path.dirname(stagedPath), { recursive: true });
        const partPath = `${stagedPath}.part-${process.pid}`;
        await writeFile(partPath, bytes, { flag: 'wx' });
        await rename(partPath, stagedPath);
        await mkdir(path.dirname(finalPath), { recursive: true });
        if (existsSync(finalPath)) return { ok: false, error: 'formal target appeared during promotion; staged file retained' };
        await rename(stagedPath, finalPath);
        return { ok: true, path: finalPath, bytes: bytes.length, url, lastModified, responseDate: response.headers.get('date') };
      } catch (error) {
        lastError = error?.message || String(error);
        if (attempt + 1 < RETRIES) await sleep(250 * (attempt + 1));
      } finally { clearTimeout(timer); }
    }
  }
  return { ok: false, error: lastError };
}

async function runJobs(jobs, doAcquire) {
  let next = 0;
  const results = new Map();
  if (!doAcquire) return results;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      results.set(job.key, await fetchOne(job));
    }
  };
  const concurrency = Number.isFinite(rawDownloadLimit) ? 1 : CONCURRENCY;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

function toPublicUrl(rel) { return `/assault-assets/${rel.split(path.sep).join('/')}`; }

const SPINE_METADATA_FIELDS = ['anims', 'animations', 'events', 'hits', 'bounds'];

export function parseMetadataOnlyArgs(argv) {
  if (argv.length !== 5 || argv[0] !== '--metadata-only' || argv[1] !== '--input' || argv[3] !== '--output') {
    throw new Error('metadata-only requires exactly: --metadata-only --input <absolute-manifest> --output <absolute-manifest>');
  }
  const inputPath = path.resolve(argv[2]);
  const outputPath = path.resolve(argv[4]);
  if (!path.isAbsolute(argv[2]) || inputPath !== path.join(REPO_ROOT, 'data', 'assault-rules', 'assault-assets.json')) {
    throw new Error(`metadata-only input must be the registered canonical source manifest: ${inputPath}`);
  }
  if (!path.isAbsolute(argv[4]) || outputPath !== SPINE_METADATA_REPAIR_PATH) {
    throw new Error(`metadata-only output must be the fixed Assault tmp manifest: ${outputPath}`);
  }
  return { inputPath, outputPath };
}

export async function repairManifestSpineMetadata(input, { inputPath, outputPath, pid = process.pid, startedAt = new Date().toISOString() }) {
  if (!input || typeof input !== 'object' || !input.assets || typeof input.assets !== 'object') {
    throw new Error('metadata-only source manifest has no assets object');
  }
  const output = structuredClone(input);
  const receipt = {
    schema: 'assault-spine-metadata-repair/v1', status: 'running', pid, startedAt,
    inputPath, outputPath, networkRequests: 0, downloadedBytes: 0,
    counts: { modelEntries: 0, parsed: 0, preservedComplete: 0, errors: 0 },
    fieldCoverage: Object.fromEntries(SPINE_METADATA_FIELDS.map((field) => [field, 0])),
    explicitNullFields: Object.fromEntries(SPINE_METADATA_FIELDS.map((field) => [field, 0])),
    singleAnimationNoAttack: [], firstErrors: [],
  };
  const visitModel = async (model, ownerId, side) => {
    if (!model?.skel) return;
    receipt.counts.modelEntries += 1;
    try {
      const sourcePath = model.skel.sourcePath;
      const canonicalAssetRoots = [path.resolve(REPO_ROOT, 'public', 'assets'), path.resolve(REPO_ROOT, 'data', 'assault-sources', 'assets')];
      const allowedSource = typeof sourcePath === 'string' && path.isAbsolute(sourcePath) && canonicalAssetRoots.some((root) => {
        const relative = path.relative(root, path.resolve(sourcePath));
        return !relative.startsWith('..') && !path.isAbsolute(relative);
      });
      if (!allowedSource || path.extname(sourcePath || '').toLowerCase() !== '.skel') {
        throw new Error(`registered skeleton path is outside canonical asset roots: ${sourcePath || '<missing>'}`);
      }
      const repaired = await enrichSpineAnimationMetadata(model, {
        ownerId,
        skillIndices: Array.isArray(output.assets.units?.[ownerId]?.skills)
          ? output.assets.units[ownerId].skills.map((_, i) => i)
          : Object.keys(output.assets.units?.[ownerId]?.skills || {}).map((_, i) => i),
        singleSpine: SINGLE_SPINE_MODELS.has(ownerId),
      });
      Object.assign(model, repaired);
      for (const field of SPINE_METADATA_FIELDS) {
        if (!Object.hasOwn(model, field) || (model[field] == null && field !== 'bounds')) throw new Error(`metadata field ${field} unresolved for ${ownerId}/${side}`);
        receipt.fieldCoverage[field] += 1;
        if (model[field] == null) receipt.explicitNullFields[field] += 1;
      }
      const parsed = SPINE_METADATA_CACHE.get(sourcePath);
      if (parsed) receipt.counts.parsed += 1;
      else receipt.counts.preservedComplete += 1;
      const roles = model.anims || {};
      if (Array.isArray(model.animations) && model.animations.length === 1
          && (!roles.attack || roles.attack.via === 'idle')) {
        receipt.singleAnimationNoAttack.push({ ownerId, side, sourcePath: model.skel.sourcePath,
          animation: model.animations[0], evidence: 'one parsed native animation; no non-idle attack role resolved' });
      }
    } catch (error) {
      receipt.counts.errors += 1;
      const row = { ownerId, side, sourcePath: model.skel?.sourcePath || null, error: error?.message || String(error) };
      if (receipt.firstErrors.length < 20) receipt.firstErrors.push(row);
    }
  };
  for (const [id, unit] of Object.entries(output.assets.units || {})) {
    for (const side of ['front', 'back']) await visitModel(unit.model?.[side], id, side);
  }
  for (const [id, summon] of Object.entries(output.assets.summons || {})) await visitModel(summon.model, id, 'model');
  for (const [id, derived] of Object.entries(output.assets.derivedModels || {})) await visitModel(derived.model, id, 'model');
  receipt.finishedAt = new Date().toISOString();
  receipt.status = receipt.counts.errors === 0 ? 'pass' : 'fail';
  if (receipt.status !== 'pass') throw Object.assign(new Error(`metadata-only failed for ${receipt.counts.errors} model entries`), { metadataReceipt: receipt });
  return { output, receipt };
}

async function runMetadataOnly(argv) {
  const { inputPath, outputPath } = parseMetadataOnlyArgs(argv);
  const startedAt = new Date().toISOString();
  const receiptPath = SPINE_METADATA_REPAIR_RECEIPT;
  const readReceipt = async () => {
    if (!existsSync(receiptPath)) return null;
    try { return JSON.parse(await readFile(receiptPath, 'utf8')); } catch { throw new Error(`existing metadata receipt is invalid JSON: ${receiptPath}`); }
  };
  const previous = await readReceipt();
  if (previous && previous.schema !== 'assault-spine-metadata-repair/v1') {
    throw new Error(`refusing to overwrite an unowned metadata receipt: ${receiptPath}`);
  }
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite existing metadata output: ${outputPath}`);
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  let result;
  try { result = await repairManifestSpineMetadata(input, { inputPath, outputPath, startedAt }); }
  catch (error) {
    const failed = error.metadataReceipt || { schema: 'assault-spine-metadata-repair/v1', status: 'fail', pid: process.pid,
      startedAt, finishedAt: new Date().toISOString(), inputPath, outputPath, networkRequests: 0,
      firstErrors: [{ error: error?.message || String(error) }] };
    await mkdir(path.dirname(receiptPath), { recursive: true });
    const receipt = { ...failed, previousAttempts: [...(previous?.previousAttempts || []), ...(previous ? [previous] : [])] };
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { flag: 'w' });
    throw error;
  }
  const outputText = `${JSON.stringify(result.output)}\n`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(outputPath, outputText, { flag: 'wx' });
  const receipt = { ...result.receipt, outputBytes: Buffer.byteLength(outputText),
    previousAttempts: [...(previous?.previousAttempts || []), ...(previous ? [previous] : [])] };
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { flag: 'w' });
  console.log(`metadata-only ${receipt.status}: models=${receipt.counts.modelEntries} parsed=${receipt.counts.parsed} preserved=${receipt.counts.preservedComplete} errors=${receipt.counts.errors} noAttack=${receipt.singleAnimationNoAttack.length} outputBytes=${receipt.outputBytes}`);
  console.log(`output=${outputPath}\nreceipt=${receiptPath}`);
}

/**
 * Preserve complete role metadata when present; otherwise parse the actual registered skeleton file and
 * resolve roles from its real animation names. This never copies or writes the source skeleton.
 */
export async function enrichSpineAnimationMetadata(entry, { ownerId = null, skillIndices = [0], singleSpine = false } = {}) {
  if (!entry) return entry;
  const existingRoles = entry.anims && typeof entry.anims === 'object' && !Array.isArray(entry.anims) ? entry.anims : null;
  const hasResolvedRoles = !!existingRoles && Object.keys(existingRoles).length > 0;
  const hasAllMetadata = SPINE_METADATA_FIELDS.every(field => Object.hasOwn(entry, field));
  const existingSingleSpineNoAttack = singleSpine && Object.keys(entry.animations || {}).length === 1 &&
    (!existingRoles?.attack || existingRoles.attack.via === 'idle');
  if (hasResolvedRoles && hasAllMetadata && !existingSingleSpineNoAttack) return entry;
  const sourcePath = entry.skel?.sourcePath;
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw new Error(`Spine animation metadata requires an absolute registered skeleton sourcePath${ownerId ? ` (${ownerId})` : ''}`);
  }
  let parsed = SPINE_METADATA_CACHE.get(sourcePath);
  if (!parsed) {
    parsed = parseSkel(await readFile(sourcePath));
    SPINE_METADATA_CACHE.set(sourcePath, parsed);
  }
  if (!Array.isArray(parsed.animations) || parsed.animations.length === 0) {
    throw new Error(`Spine skeleton has no parsed animation names: ${sourcePath}`);
  }
  return resolveSpineAnimationMetadata(entry, parsed, { ownerId, skillIndices, singleSpine });
}

/** Apply parsed metadata without altering the producer's source/reference fields. */
export function resolveSpineAnimationMetadata(entry, parsed, { ownerId = null, skillIndices = [0], singleSpine = false } = {}) {
  if (!entry || !Array.isArray(parsed?.animations) || parsed.animations.length === 0) {
    throw new Error('Spine metadata resolution requires a parsed skeleton with animation names');
  }
  const existingRoles = entry.anims && typeof entry.anims === 'object' && !Array.isArray(entry.anims) ? entry.anims : null;
  const hasResolvedRoles = !!existingRoles && Object.keys(existingRoles).length > 0;
  const resolved = resolveRoles(parsed.animations, {
    skillIndices: Array.isArray(skillIndices) && skillIndices.length ? skillIndices : [0],
    durations: parsed.durations,
  });
  const roles = applyRoleFix(resolved, ownerId ? PREFAB_SPINE_ROLES[ownerId] : undefined, parsed.durations).roles;
  const noNativeAttack = singleSpine && parsed.animations.length === 1 &&
    (!roles.attack || roles.attack.via === 'idle');
  if (noNativeAttack) {
    roles.attack = null;
    roles.skill = null;
    if (roles.skills) roles.skills = Object.fromEntries(Object.entries(roles.skills).map(([index, clip]) =>
      [index, clip?.via === 'idle' ? null : clip]).filter(([, clip]) => clip));
  }
  return {
    ...entry,
    anims: noNativeAttack ? roles : hasResolvedRoles ? existingRoles : roles,
    animations: entry.animations ?? parsed.durations,
    events: entry.events ?? parsed.events,
    hits: entry.hits ?? parsed.hits,
    bounds: entry.bounds ?? parsed.bounds,
    ...(noNativeAttack ? { animationRoleStatus: 'native-single-spine-no-attack' } : {}),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--metadata-only') { await runMetadataOnly(argv); return; }
  const args = new Set(argv.filter((x) => !x.startsWith('--ids=')));
  const requestedIds = parseAssetScope(argv);
  const nativeLocalOnly = args.has('--native-local-only');
  if (nativeLocalOnly && args.has('--plan')) throw new Error('--native-local-only requires acquisition mode; --plan remains read-only');
  if (nativeLocalOnly) assertNativeLocalOnlyScope(requestedIds, TOLEDO_NATIVE_ID);
  if (requestedIds) rawDownloadLimit = 12 * 1024 * 1024;
  const acquire = args.has('--acquire') || !args.has('--plan');
  const design = collectDesign();
  const nativeRoot = path.join(REPO_ROOT, 'data', 'assault-sources', 'arknights', 'excel');
  const characters = JSON.parse(await readFile(path.join(nativeRoot, 'character_table.json'), 'utf8'));
  const skillsTable = JSON.parse(await readFile(path.join(nativeRoot, 'skill_table.json'), 'utf8'));
  const skinsTable = JSON.parse(await readFile(path.join(nativeRoot, 'skin_table.json'), 'utf8'));
  const equipmentTable = JSON.parse(await readFile(path.join(nativeRoot, 'uniequip_table.json'), 'utf8'));
  const localAssets = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'local-assets.json'), 'utf8'));
  if (nativeLocalOnly) {
    await acquireNativeToledoLocally(localAssets, design, characters);
    return;
  }
  if (requestedIds) {
    const known = new Set([...Object.keys(characters), ...design.summons.map((x) => x.tokenKey)]);
    assertKnownAssetScope(requestedIds, known);
    const selectedOperators = design.operators.filter((x) => requestedIds.has(x.charId));
    const selectedOperatorIds = new Set(selectedOperators.map((x) => x.charId));
    design.operators = selectedOperators;
    design.bodies = new Map([...design.bodies].filter(([id]) => selectedOperatorIds.has(id)));
    design.summons = design.summons.filter((x) => requestedIds.has(x.tokenKey) || x.usedBy.some((id) => selectedOperatorIds.has(id)));
    const referencedTokens = new Map();
    for (const charId of selectedOperatorIds) {
      for (const skill of characters[charId]?.skills || []) {
        const tokenKey = skill.overrideTokenKey;
        if (tokenKey && (requestedIds.has(tokenKey) || requestedIds.has(charId))) {
          const entry = referencedTokens.get(tokenKey) || { tokenKey, sourceTemplateIds: [tokenKey], usedBy: [] };
          if (!entry.usedBy.includes(charId)) entry.usedBy.push(charId);
          referencedTokens.set(tokenKey, entry);
        }
      }
    }
    for (const [tokenKey, entry] of referencedTokens) {
      if (!design.summons.some((x) => x.tokenKey === tokenKey)) design.summons.push(entry);
      if (!requestedIds.has(tokenKey)) requestedIds.add(tokenKey);
    }
    design.collectibles = [];
    design.events = [];
  }
  captureGitHeads();
  const activeNativeAssetRoot = requestedIds ? captureNativeAssetPin() : NATIVE_ASSET_ROOT;
  const canonical = JSON.parse(await readFile(CANONICAL_MANIFEST, 'utf8'));
  const jobs = [];
  const byKey = new Map();
  const assets = { units: {}, summons: {}, derivedModels: {}, collectibles: {}, events: {}, skills: {} };

  const put = (section, id, slot, record) => {
    (((assets[section][id] ||= {})[slot] = record));
  };
  const image = (key, rel, sourceUrl, existingUrl, note = null) => sourceRecord({ key, kind: 'png', rel, sourceUrl, existingUrl, existingRoot: CANONICAL_ROOT, note });
  const modelPart = (key, rel, sourceUrl, kind) => sourceRecord({ key, kind, rel, sourceUrl });

  for (const [id, body] of [...design.bodies].sort(([a], [b]) => a.localeCompare(b))) {
    const old = canonical.chars[id] || {};
    const unit = {};
    const nativePatchSkin = Object.values(skinsTable.buildinPatchMap || {}).map((forms) => forms?.[id]).find(Boolean);
    const evolveSkins = skinsTable.buildinEvolveMap?.[id] || {};
    const baseSkinId = nativePatchSkin || evolveSkins['0'] || `${id}#1`;
    const e2SkinId = nativePatchSkin || evolveSkins['2'] || baseSkinId;
    const baseSkin = skinsTable.charSkins?.[baseSkinId];
    const e2Skin = skinsTable.charSkins?.[e2SkinId] || baseSkin;
    const baseAvatarId = baseSkin?.avatarId || id;
    const e2AvatarId = e2Skin?.avatarId || baseAvatarId;
    const basePortraitId = baseSkin?.portraitId || (requestedIds?.has(id) ? `${id}_1` : null);
    const e2PortraitId = e2Skin?.portraitId || (requestedIds?.has(id) ? `${id}_2` : basePortraitId);
    const sharedPatchForm = !!nativePatchSkin;
    const avatarSlot = e2AvatarId === baseAvatarId && sharedPatchForm ? 'avatarE2' : 'avatar';
    const portraitSlot = e2PortraitId === basePortraitId && sharedPatchForm ? 'portraitE2' : 'portrait';
    const avatarBase = image(`unit:${id}:${avatarSlot}`, `operators/${id}/${avatarSlot}.png`, joinUrl(RAW.yuanyan, `avatar/${baseAvatarId}.png`), avatarSlot === 'avatarE2' ? old.avatarE2 : old.avatar, e2AvatarId === baseAvatarId ? '原生皮肤表只有一个默认头像资源；各阶段槽位共享。' : null);
    const avatarSecond = e2AvatarId === baseAvatarId ? avatarBase : image(`unit:${id}:avatarE2`, `operators/${id}/avatarE2.png`, joinUrl(RAW.yuanyan, `avatar/${e2AvatarId}.png`), old.avatarE2);
    const portraitBase = basePortraitId ? image(`unit:${id}:${portraitSlot}`, `operators/${id}/${portraitSlot}.png`, joinUrl(RAW.yuanyan, `portrait/${basePortraitId}.png`), portraitSlot === 'portraitE2' ? old.portraitE2 : old.portrait, e2PortraitId === basePortraitId ? '原生皮肤表只有一个默认立绘资源；各阶段槽位共享。' : null) : null;
    const portraitSecond = e2PortraitId === basePortraitId ? portraitBase : e2PortraitId ? image(`unit:${id}:portraitE2`, `operators/${id}/portraitE2.png`, joinUrl(RAW.yuanyan, `portrait/${e2PortraitId}.png`), old.portraitE2) : null;
    unit.avatar = avatarBase;
    unit.avatarE2 = avatarSecond;
    unit.portrait = portraitBase;
    unit.portraitE2 = portraitSecond;
    unit.model = {};
    for (const side of ['front', 'back']) {
      const oldModel = old.spine?.[side];
      const existingStem = oldModel?.skel?.slice(oldModel.skel.lastIndexOf('/') + 1).replace(/\.skel$/i, '') || id;
      const upstreamBase = `${RAW.fexli}spine/${encodeURIComponent(id)}/${encodeURIComponent(id)}/${side === 'front' ? 'Front' : 'Back'}/${encodeURIComponent(existingStem)}`;
      const relDir = `operators/${id}/model/${side}`;
      const fileBase = `${relDir}/${existingStem}`;
      const part = {
        skel: modelPart(`unit:${id}:${side}:skel`, `${fileBase}.skel`, `${upstreamBase}.skel`, 'skel'),
        atlas: modelPart(`unit:${id}:${side}:atlas`, `${fileBase}.atlas`, `${upstreamBase}.atlas`, 'atlas'),
        texture: modelPart(`unit:${id}:${side}:texture`, `${fileBase}.png`, `${upstreamBase}.png`, 'png'),
      };
      part.skel.manifestUrl = oldModel?.skel;
      part.atlas.manifestUrl = oldModel?.atlas;
      part.texture.manifestUrl = oldModel?.textures?.[0];
      unit.model[side] = part;
    }
    const native = characters[id];
    const skillIds = dedupe([...(native?.skills || []).map((s) => s.skillId), body.fixedSkill?.sourceSkillId]);
    unit.skillIds = skillIds;
    for (const skillId of skillIds) {
      if (!skillId) continue;
      const nativeSkill = skillsTable[skillId] || {};
      const iconId = nativeSkill.iconId || skillId;
      const sourceIconId = decodeAssetId(iconId);
      const key = `skill:${iconId}`;
      if (!byKey.has(key)) {
        const safe = safeName(iconId);
        addJob(jobs, byKey, image(key, `skills/${safe}.png`, joinUrl(RAW.yuanyan, `skill/skill_icon_${sourceIconId}.png`), canonical.skills?.[iconId] || canonical.skills?.[sourceIconId]));
      }
      unit.skills ||= {};
      unit.skills[skillId] = key;
    }
    assets.units[id] = unit;
  }

  for (const summon of design.summons) {
    const id = summon.tokenKey;
    const old = canonical.tokens[id] || {};
    const entry = { tokenKey: id, sourceTemplateIds: summon.sourceTemplateIds, usedBy: summon.usedBy, avatar: null, model: null };
    const avKey = `summon:${id}:avatar`;
    const avatar = image(avKey, `summons/${id}/avatar.png`, joinUrl(RAW.yuanyan, `avatar/${id}.png`), old.avatar);
    if (id === 'token_10012_rosmon_shield') {
      const skinAvatar = `${NATIVE_ASSET_ROOT}arts/charavatars/token_10012_rosmon_shield_sale%2316.png`;
      avatar.sourceUrl = skinAvatar;
      avatar.sourceUrls = [skinAvatar];
      avatar.note = 'Native skin_table binds sale#16 avatar to this exact Rosmontis shield token.';
    }
    addJob(jobs, byKey, avatar);
    entry.avatar = avKey;
    const sourceModelId = summon.sourceTemplateIds.includes(id) ? id : (summon.sourceTemplateIds[0] || id);
    const oldSpine = old.spine;
    const tokenSkins = Object.values(skinsTable.charSkins || {}).filter((skin) => skin.charId === sourceModelId);
    const firstSkinVariant = tokenSkins.find((skin) => skin.skinId !== `${sourceModelId}#1` && skin.battleSkin?.skinOrPrefabId);
    const skinModelStem = firstSkinVariant?.skinId?.replace(/#(\d+)$/, '_$1');
    const stem = oldSpine?.skel?.slice(oldSpine.skel.lastIndexOf('/') + 1).replace(/\.skel$/i, '') || skinModelStem || sourceModelId;
    const variant = old.spineVariant || skinModelStem || sourceModelId;
    const modelDir = TOKEN_SKIN_MODEL_DIRS[id] || 'Spine';
    const modelBase = `${RAW.fexli}spine/${encodeURIComponent(sourceModelId)}/${encodeURIComponent(variant)}/${modelDir}/${encodeURIComponent(stem)}`;
    const model = {};
    for (const [slot, ext, kind, prior] of [['skel', 'skel', 'skel', oldSpine?.skel], ['atlas', 'atlas', 'atlas', oldSpine?.atlas], ['texture', 'png', 'png', oldSpine?.textures?.[0]]]) {
      const key = `summon:${id}:model:${slot}`;
      const record = modelPart(key, `summons/${id}/model/${stem}.${ext}`, `${modelBase}.${ext}`, kind);
      if (id === 'token_10041_cathy_catsld') {
        record.sourceUrl = `${NATIVE_ASSET_ROOT}battle/prefabs/%5Buc%5Dtokens/${id}/${id}.${ext}`;
        record.sourceUrls = [record.sourceUrl];
      }
      record.manifestUrl = prior;
      if (firstSkinVariant && !oldSpine) record.note = `default summon model absent from the source mirror; using the native first available skin model ${firstSkinVariant.skinId} at ${modelDir}/.`;
      if (id === 'token_10020_ling_soul3') record.note = `${record.note ? `${record.note} ` : ''}The large dragon is an Assault-derived entity (assault_ling_large), not a separate native template; this model is the real source token model.`;
      addJob(jobs, byKey, record);
      model[slot] = key;
    }
    entry.model = model;
    assets.summons[id] = entry;
  }

  const workshopVariant = WORKSHOP_SOURCE.skinId.replace(/#(\d+)$/, '_$1');
  const workshopStem = workshopVariant;
  const workshopModel = {};
  for (const [slot, ext, kind] of [['skel', 'skel', 'skel'], ['atlas', 'atlas', 'atlas'], ['texture', 'png', 'png']]) {
    const key = `derived:workshop-platform:${slot}`;
    const record = modelPart(key, `derived/workshop-platform/${workshopStem}.${ext}`, `${RAW.fexli}spine/${WORKSHOP_SOURCE.templateId}/${workshopVariant}/${WORKSHOP_SOURCE.modelDir}/${workshopStem}.${ext}`, kind);
    record.note = 'Assault-original repair platform derives its visual model from the native Iron Pipe pile3 token; native combat effects are not imported.';
    addJob(jobs, byKey, record);
    workshopModel[slot] = key;
  }
  assets.derivedModels.workshopPlatform = {
    derivedTemplateId: 'assault_workshop_platform',
    sourceTemplateId: WORKSHOP_SOURCE.templateId,
    sourceSkinId: WORKSHOP_SOURCE.skinId,
    sourceUse: 'visualAndRangeOnly',
    model: workshopModel,
  };

  const leaderAvatars = {
    'assault/original/leader_svash2_frost_sigil': ['char_1045_svash2', '银灰头像（原创起步收藏品，明确复用领袖头像）'],
    'assault/original/leader_ironmn_workshop_key': ['char_4072_ironmn', '白铁头像（原创起步收藏品，明确复用领袖头像）'],
    'assault/original/leader_angel2_old_magazine': ['char_1041_angel2', '新约能天使头像（原创起步收藏品，明确复用领袖头像）'],
  };
  for (const collectible of design.collectibles) {
    const id = collectible.id;
    const source = leaderAvatars[collectible.iconId];
    if (source) {
      const avatarUrl = canonical.chars[source[0]]?.avatar || `/assets/char/avatar/${source[0]}.png`;
      const rec = image(`collectible:${id}:icon`, `collectibles/${safeName(id)}.png`, joinUrl(RAW.yuanyan, `avatar/${source[0]}.png`), avatarUrl, source[1]);
      put('collectibles', id, 'icon', rec);
      addJob(jobs, byKey, rec);
      continue;
    }
    const key = `collectible:${id}:icon`;
    const urls = [
      joinUrl(RAW.fexli, `rogueitem/${collectible.iconId}.png`),
      `https://raw.githubusercontent.com/Aceship/Arknight-Images/main/ui/roguelike/item/${encodeURIComponent(collectible.iconId)}.png`,
      joinUrl(RAW.fexli, `avgs/${collectible.iconId}.png`),
      joinUrl(RAW.fexli, `items/${collectible.iconId}.png`),
      joinUrl(RAW.yuanyan, `item/${collectible.iconId}.png`),
    ];
    const rec = image(key, `collectibles/${safeName(id)}.png`, urls[0], null);
    rec.sourceUrls = urls;
    put('collectibles', id, 'icon', rec);
    addJob(jobs, byKey, { ...rec, urls: candidateUrls(urls) });
  }

  for (const event of design.events) {
    const id = event.id;
    const eventUrls = [
      `${NATIVE_ASSET_ROOT}avg/images/${event.backgroundId}.png`,
      joinUrl(RAW.fexli, `avgs/${event.backgroundId}.png`),
      `https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avgs/${encodeURIComponent(event.backgroundId)}.png`,
    ];
    const rec = image(`event:${id}:background`, `events/${safeName(event.backgroundId)}.png`, eventUrls[0], null);
    rec.sourceUrls = eventUrls;
    rec.backgroundId = event.backgroundId;
    put('events', id, 'background', rec);
    addJob(jobs, byKey, { ...rec, urls: candidateUrls(eventUrls) });
  }

  // Expand regular source jobs and preserve model triplets as individual leaves.
  for (const [id, unit] of Object.entries(assets.units)) {
    if (SINGLE_SPINE_MODELS.has(id)) unit.model.back = unit.model.front;
    for (const slot of ['avatar', 'avatarE2', 'portrait', 'portraitE2']) addJob(jobs, byKey, unit[slot]);
    for (const side of ['front', 'back']) for (const rec of Object.values(unit.model[side])) addJob(jobs, byKey, rec);
    for (const [skillId, key] of Object.entries(unit.skills || {})) {
      const rec = byKey.get(key);
      if (rec) put('skills', key.slice('skill:'.length), 'icon', rec);
      void skillId;
    }
  }

  const incompleteTokenModels = new Map();
  if (requestedIds) {
    for (const summon of design.summons) {
      if (!requestedIds.has(summon.tokenKey)) continue;
      const page = `${activeNativeAssetRoot}battle/prefabs/%5Buc%5Dtokens/${summon.tokenKey}/${summon.tokenKey}.png`;
      const response = await fetch(page, { method: 'HEAD', headers: { 'user-agent': 'stronghold-protocol-assault-assets/1.0' }, redirect: 'follow' });
      if (!response.ok) incompleteTokenModels.set(summon.tokenKey, { page, status: response.status });
      await response.body?.cancel();
    }
  }
  for (const [id, summon] of Object.entries(assets.summons)) {
    for (const key of [summon.avatar, ...Object.values(summon.model)]) {
      const rec = byKey.get(key);
      if (rec) rec.summonId = id;
    }
  }

  if (requestedIds) {
    for (const job of jobs) {
      let pinnedPath = null;
      const unitMatch = /^operators\/(char_[^/]+)\/(avatar|avatarE2|portrait|portraitE2)\.png$/.exec(job.rel);
      const skillMatch = /^skills\/([^/]+\.png)$/.exec(job.rel);
      const tokenMatch = /^summons\/(token_[^/]+)\/(avatar\.png|model\/[^/]+\.(?:skel|atlas|png))$/.exec(job.rel);
      if (unitMatch) {
        const [, id, slot] = unitMatch;
        pinnedPath = slot.startsWith('avatar') ? `arts/charavatars/${id}.png` : `arts/charportraits/${id}_${slot === 'portraitE2' ? '2' : '1'}.png`;
      } else if (skillMatch) pinnedPath = `arts/skills/skill_icon_${skillMatch[1]}`;
      else if (tokenMatch) {
        const [, id, tail] = tokenMatch;
        pinnedPath = tail === 'avatar.png' ? `arts/charavatars/${id}.png` : `battle/prefabs/%5Buc%5Dtokens/${id}/${id}.${path.extname(tail).slice(1)}`;
      }
      if (pinnedPath) {
        if (skillMatch) {
          const revision = GIT_HEADS.get(NATIVE_ASSET_REPOSITORY);
          job.rel = `native-assets/${revision}/skills/${skillMatch[1]}`;
        }
        job.sourceUrl = `${activeNativeAssetRoot}${pinnedPath}`;
        job.sourceUrls = [job.sourceUrl];
        job.urls = undefined;
        if (skillMatch) job.verifyExistingFromSource = true;
      }
    }
  }

  // Canonical physical files take precedence; only missing records become jobs.
  const filteredJobs = [];
  const preflightErrors = [];
  for (const job of jobs) {
    const blockedModel = /^summons\/(token_[^/]+)\/model\//.exec(job.rel);
    if (blockedModel && incompleteTokenModels.has(blockedModel[1])) continue;
    const prior = await canonicalEntry(job, canonical);
    if (prior) job.entry = prior;
    else {
      job.urls ||= candidateUrls(job.sourceUrls || [job.sourceUrl]);
      filteredJobs.push(job);
    }
  }
  let expectedRawBytes = 0;
  let preflightBudgetError = null;
  if (requestedIds && filteredJobs.length) {
    const unmeasuredKeys = new Set();
    for (const job of filteredJobs) {
      let size = null;
      for (const url of job.urls) {
        try {
          const response = await fetch(url, { method: 'HEAD', headers: { 'user-agent': 'stronghold-protocol-assault-assets/1.0' }, redirect: 'follow' });
          const value = Number(response.headers.get('content-length'));
          await response.body?.cancel();
          if (response.ok && Number.isFinite(value) && value >= 0) { size = value; break; }
        } catch { /* try the next source */ }
      }
      if (size === null) {
        unmeasuredKeys.add(job.key);
        preflightErrors.push({ key: job.key, urls: job.urls, error: 'could not establish raw size from a source HEAD; skipped to preserve the scoped download ceiling' });
        continue;
      }
      expectedRawBytes += size;
    }
    if (unmeasuredKeys.size) {
      for (let index = filteredJobs.length - 1; index >= 0; index -= 1) {
        if (unmeasuredKeys.has(filteredJobs[index].key)) filteredJobs.splice(index, 1);
      }
    }
    if (expectedRawBytes > rawDownloadLimit) preflightBudgetError = `scoped raw size estimate exceeds limit (${expectedRawBytes}/${rawDownloadLimit} bytes); no asset transfer started`;
  }
  if (preflightBudgetError) {
    for (const job of filteredJobs) preflightErrors.push({ key: job.key, urls: job.urls, error: preflightBudgetError });
    filteredJobs.length = 0;
  }
  for (const [tokenId, evidence] of incompleteTokenModels) {
    preflightErrors.push({ key: `summon:${tokenId}:model`, urls: [evidence.page], error: `native atlas page unavailable at pinned source (HTTP ${evidence.status}); model triplet was not promoted` });
  }
  const results = await runJobs(filteredJobs, acquire);
  const newlyWritten = [];
  const downloadErrors = [...preflightErrors];
  let bytesDownloaded = 0;
  for (const job of filteredJobs) {
    const result = results.get(job.key);
    if (!result?.ok) {
      downloadErrors.push({ key: job.key, urls: job.urls, error: result?.error || 'not acquired' });
      continue;
    }
    if (!result.existing) newlyWritten.push(result.path);
    if (!result.existing && !result.promoted) bytesDownloaded += result.bytes;
    job.entry = { url: toPublicUrl(job.rel), sourcePath: result.path, sourceRel: path.relative(SOURCE_ROOT, result.path).split(path.sep).join('/'), sourceUrl: result.url, sourceRoot: SOURCE_ROOT, reusedCanonical: false, sourceVersion: result.sourceVersion ?? sourceVersion(result.url, result.lastModified, result.responseDate) };
  }

  const missing = { units: [], unitModels: [], summons: [], summonModels: [], derivedModels: [], collectibleIcons: [], eventBackgrounds: [], skills: [] };
  const emit = (rec, category, owner) => {
    if (!rec) return null;
    const job = byKey.get(rec.key);
    if (!job?.entry) { if (category) missing[category].push(owner); return null; }
    return { ...job.entry, sourceUrls: rec.sourceUrls || [rec.sourceUrl], note: rec.note || undefined };
  };
  const output = { schema: SCHEMA, generatedBy: CLI_PATH, sourceRoot: SOURCE_ROOT, reusedRoot: CANONICAL_ROOT, tempRoot: TEMP_ROOT, mappings: { '/assault-assets/': SOURCE_ROOT, '/assets/': CANONICAL_ROOT }, assets: { units: {}, summons: {}, derivedModels: {}, collectibles: {}, events: {}, skills: {}, modules: {} }, missing };
  if (requestedIds) {
    for (const unit of design.operators) {
      for (const equipId of equipmentTable.charEquip?.[unit.charId] || []) {
        const equip = equipmentTable.equipDict?.[equipId];
        if (equip?.type !== 'ADVANCED') continue;
        const localIcon = localAssets.groups?.module?.[equip.typeIcon]?.path;
        const localPath = localIcon?.startsWith('/assets/') ? path.join(CANONICAL_ROOT, localIcon.slice('/assets/'.length)) : null;
        if (localPath && await fileExistsAndValid(CANONICAL_ROOT, localIcon.slice('/assets/'.length), 'png')) {
          output.assets.modules[equip.uniEquipIcon] = localIcon;
          output.assets.modules[equip.uniEquipId] = localIcon;
          output.assets.modules[equip.typeIcon] ||= localIcon;
        }
      }
    }
  }
  for (const [id, unit] of Object.entries(assets.units)) {
    const entry = { avatar: emit(unit.avatar, 'units', `${id}:avatar`), avatarE2: emit(unit.avatarE2, 'units', `${id}:avatarE2`), portrait: emit(unit.portrait, 'units', `${id}:portrait`), portraitE2: emit(unit.portraitE2, 'units', `${id}:portraitE2`), model: {}, skills: {} };
    for (const side of ['front', 'back']) {
      const parts = unit.model[side];
      const model = Object.fromEntries(Object.entries(parts).map(([part, rec]) => [part, emit(rec, null, `${id}:model:${side}:${part}`)]));
      const required = ['skel', 'atlas', 'texture'];
      entry.model[side] = model;
      if (model.skel) entry.model[side] = await enrichSpineAnimationMetadata(model, {
        ownerId: id,
        skillIndices: Object.keys(unit.skills || {}).map((_, index) => index),
        singleSpine: SINGLE_SPINE_MODELS.has(id),
      });
      if (required.some((part) => !model[part])) missing.unitModels.push(`${id}:${side}`);
    }
    if (SINGLE_SPINE_MODELS.has(id)) {
      const proof = SINGLE_SPINE_MODELS.get(id);
      entry.model.directionModelSharing = { kind: 'native-single-spine',
        nativeAssetVersion: NATIVE_MODEL_EVIDENCE.sourceVersion,
        sourceUrl: proof.source.url, sourcePath: proof.source.path,
        containerPath: proof.containerPath, animatorPathId: proof.animator.pathId,
        skeletonPathId: proof.chain.skeleton.pathId };
    }
    for (const [skillId, key] of Object.entries(unit.skills || {})) {
      const rec = byKey.get(key);
      const mapped = emit(rec, null, skillId);
      if (mapped) entry.skills[skillId] = mapped;
    }
    if (!entry.avatar || !entry.portrait || !entry.model.front.skel) missing.units.push(`${id}:required-avatar-portrait-front-model`);
    output.assets.units[id] = entry;
  }
  for (const [id, summon] of Object.entries(assets.summons)) {
    const entry = { tokenKey: summon.tokenKey, sourceTemplateIds: summon.sourceTemplateIds, usedBy: summon.usedBy, avatar: emit(byKey.get(summon.avatar), 'summons', `${id}:avatar`), model: {} };
    for (const [part, key] of Object.entries(summon.model)) entry.model[part] = emit(byKey.get(key), null, `${id}:model:${part}`);
    if (entry.model.skel) Object.assign(entry.model, await enrichSpineAnimationMetadata(entry.model, { ownerId: id }));
    if (['skel', 'atlas', 'texture'].some((part) => !entry.model[part])) missing.summonModels.push(id);
    output.assets.summons[id] = entry;
  }
  for (const [id, derived] of Object.entries(assets.derivedModels)) {
    let model = Object.fromEntries(Object.entries(derived.model).map(([part, key]) => [part, emit(byKey.get(key), null, `${id}:model:${part}`)]));
    if (model.skel) model = await enrichSpineAnimationMetadata(model, { ownerId: id });
    if (['skel', 'atlas', 'texture'].some((part) => !model[part])) missing.derivedModels.push(id);
    output.assets.derivedModels[id] = { ...derived, model };
  }
  const lingSummon = output.assets.summons.token_10020_ling_soul3;
  const chiaveModel = output.assets.summons.token_10004_otter_motter;
  if (chiaveModel) output.assets.derivedModels.chiaveMechanicalClaw = {
    derivedTemplateId: 'chiave_mech_claw',
    sourceTemplateId: 'token_10004_otter_motter',
    sourceUse: 'visualOnly',
    avatar: chiaveModel.avatar,
    model: chiaveModel.model,
    note: 'Original Assault combat device; Meebo supplies its model only, without native stats, skills or talents.',
  };
  if (lingSummon) output.assets.derivedModels.lingLargeDragon = {
    derivedTemplateId: 'assault_ling_large',
    sourceTemplateId: 'token_10020_ling_soul3',
    sourceUse: 'realNativeSummonModel',
    model: lingSummon.model,
    note: 'Assault merges native Ling small summons into this derived large-dragon entity; no separate native summon ID is claimed.',
  };
  for (const item of design.collectibles) {
    const rec = assets.collectibles[item.id].icon;
    const entry = emit(rec, 'collectibleIcons', item.id);
    if (entry) output.assets.collectibles[item.id] = { iconId: item.iconId, icon: entry };
  }
  for (const event of design.events) {
    const rec = assets.events[event.id].background;
    const entry = emit(rec, 'eventBackgrounds', event.id);
    if (entry) output.assets.events[event.id] = { backgroundId: event.backgroundId, background: entry };
  }
  for (const iconId of [...new Set(Object.values(assets.units).flatMap((unit) => Object.keys(unit.skills || {}).map((skillId) => {
    const key = unit.skills[skillId];
    return key.slice('skill:'.length);
  })))].sort()) {
    const rec = byKey.get(`skill:${iconId}`);
    const entry = emit(rec, null, `icon:${iconId}`);
    if (entry) output.assets.skills[iconId] = entry;
    else missing.skills.push(iconId);
  }

  const checkAtlasClosure = async (owner, side, model) => {
    if (!model?.atlas?.sourcePath || !model.texture?.sourcePath) return false;
    const atlasText = await readFile(model.atlas.sourcePath, 'utf8');
    const pages = atlasPages(atlasText);
    let closed = pages.length > 0;
    for (const page of pages) {
      const pagePath = path.resolve(path.dirname(model.atlas.sourcePath), page);
      const valid = await fileExistsAndValid(path.dirname(model.atlas.sourcePath), page, 'png');
      if (!valid || path.resolve(model.texture.sourcePath) !== pagePath) {
        closed = false;
        downloadErrors.push({ key: `${owner}:${side}:atlas-page:${page}`, urls: [model.atlas.sourceUrl], error: !valid ? `atlas page missing or invalid: ${pagePath}` : `atlas page does not match mapped texture: ${pagePath}` });
      }
    }
    return closed;
  };
  for (const [id, unit] of Object.entries(output.assets.units)) {
    for (const side of ['front', 'back']) {
      if (!(await checkAtlasClosure(id, side, unit.model[side]))) missing.unitModels.push(`${id}:${side}`);
    }
  }
  for (const [id, summon] of Object.entries(output.assets.summons)) {
    if (!(await checkAtlasClosure(id, 'summon', summon.model))) missing.summonModels.push(id);
  }
  for (const [id, derived] of Object.entries(output.assets.derivedModels)) {
    if (!(await checkAtlasClosure(id, 'derived', derived.model))) missing.derivedModels.push(id);
  }
  for (const key of Object.keys(missing)) missing[key] = dedupe(missing[key]).sort();

  const files = [];
  for (const section of Object.values(output.assets)) {
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.sourcePath === 'string' && value.sourcePath.startsWith(SOURCE_ROOT)) files.push(value.sourcePath);
      for (const child of Object.values(value)) visit(child);
    };
    visit(section);
  }
  const uniqueFiles = dedupe(files).sort();
  let formalBytes = 0;
  for (const file of uniqueFiles) formalBytes += (await stat(file)).size;
  const unitCount = Object.keys(output.assets.units).length;
  const frontCovered = Object.values(output.assets.units).filter((u) => u.model.front.skel && u.model.front.atlas && u.model.front.texture).length;
  const avatarCovered = Object.values(output.assets.units).filter((u) => u.avatar).length;
  const skillIconCount = new Set(Object.values(assets.units).flatMap((unit) => Object.values(unit.skills || {}).map((key) => key.slice('skill:'.length)))).size;
  const receipt = {
    schema: RECEIPT_SCHEMA,
    generatedBy: CLI_PATH,
    manifest: MANIFEST_PATH,
    sourceRoot: SOURCE_ROOT,
    tempRoot: TEMP_ROOT,
    versionSemantics: 'Each source records its native HTTP Last-Modified when sent and the observed refs/heads/main Git commit from git ls-remote. The Git commit is provenance only: it is not an asset checksum, rejection gate, or byte-integrity substitute. Pre-existing canonical files retain no claimed original fetch timestamp.',
    counts: { purchaseIdentities: design.operators.length, bodies: unitCount, summons: design.summons.length, collectibles: design.collectibles.length, events: design.events.length, skills: skillIconCount },
    coverage: { units: { bodyCount: unitCount, avatar: `${avatarCovered}/${unitCount}`, portrait: `${Object.values(output.assets.units).filter((u) => u.portrait).length}/${unitCount}`, frontModel: `${frontCovered}/${unitCount}`, missing: missing.units, missingModelSides: missing.unitModels }, summons: { total: design.summons.length, avatar: `${design.summons.length - missing.summons.length}/${design.summons.length}`, modelComplete: design.summons.length - missing.summonModels.length, missingAvatar: missing.summons, missingModels: missing.summonModels }, collectibleIcons: { total: design.collectibles.length, complete: Object.keys(output.assets.collectibles).length, missing: missing.collectibleIcons }, eventBackgrounds: { total: design.events.length, complete: Object.keys(output.assets.events).length, missing: missing.eventBackgrounds }, skills: { total: skillIconCount, complete: Object.keys(output.assets.skills).length, missing: missing.skills } },
    bytesDownloaded: formalBytes,
    bytesDownloadedThisRun: bytesDownloaded,
    rawBytesReceived: rawDownloadedBytes,
    rawByteLimit: Number.isFinite(rawDownloadLimit) ? rawDownloadLimit : null,
    expectedRawBytes,
    nativeAssetPin: requestedIds ? { repository: NATIVE_ASSET_REPOSITORY, branch: 'cn', commit: GIT_HEADS.get(NATIVE_ASSET_REPOSITORY), previousPin: NATIVE_ASSET_REVISION } : null,
    files: uniqueFiles,
    downloadErrors,
  };

  if (requestedIds && existsSync(MANIFEST_PATH)) {
    const priorManifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    Object.assign(output, mergeIncrementalManifest(priorManifest, output, requestedIds));
  }

  if (acquire) {
    for (const file of [MANIFEST_PATH, RECEIPT_PATH, LOG_PATH]) {
      if (existsSync(file)) {
        let owned = false;
        try {
          if (file === MANIFEST_PATH) owned = JSON.parse(await readFile(file, 'utf8')).generatedBy === CLI_PATH;
          else if (file === RECEIPT_PATH) {
            const prior = JSON.parse(await readFile(file, 'utf8'));
            owned = prior.generatedBy === CLI_PATH || (prior.schema === 'assault-new-operators-assets-worker/v1'
              && prior.generatedBy === path.join(ROOT, '.omni', 'tmp', 'assault', 'new-operators-assets-runner.mjs'));
          } else owned = (await readFile(file, 'utf8')).startsWith(`generatedBy=${CLI_PATH}\n`);
        } catch { /* unknown output */ }
        if (!owned) throw new Error(`refusing to overwrite unknown output: ${file}`);
      }
    }
    await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
    await mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
    const atomicWrite = async (file, text) => { const tmp = `${file}.part-${process.pid}`; await writeFile(tmp, text, { flag: 'wx' }); await rename(tmp, file); };
    await atomicWrite(MANIFEST_PATH, `${JSON.stringify(output, null, 2)}\n`);
    await atomicWrite(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
    const lines = [`generatedBy=${CLI_PATH}`, `bytesDownloaded=${bytesDownloaded}`, `formalFiles=${uniqueFiles.length}`, `downloadErrors=${downloadErrors.length}`, ...downloadErrors.map((x) => `MISS ${x.key} ${x.error}`), ...uniqueFiles.map((x) => `FILE ${x}`)];
    await atomicWrite(LOG_PATH, `${lines.join('\n')}\n`);
  }

  console.log(`assault asset ${acquire ? 'acquisition' : 'plan'}: bodies=${unitCount}/${design.operators.length} summons=${design.summons.length} collectibles=${design.collectibles.length} events=${design.events.length} skills=${Object.keys(output.assets.skills).length}`);
  console.log(`coverage avatar=${avatarCovered}/${unitCount} portrait=${receipt.coverage.units.portrait} front=${frontCovered}/${unitCount} summons=${receipt.coverage.summons.modelComplete}/${design.summons.length} icons=${receipt.coverage.collectibleIcons.complete}/${design.collectibles.length} backgrounds=${receipt.coverage.eventBackgrounds.complete}/${design.events.length} skills=${receipt.coverage.skills.complete}/${skillIconCount}`);
  console.log(`missing unitAssets=${missing.units.length} unitModelSides=${missing.unitModels.length} summonAvatars=${missing.summons.length} summonModels=${missing.summonModels.length} icons=${missing.collectibleIcons.length} backgrounds=${missing.eventBackgrounds.length} skills=${missing.skills.length}; downloadedBytes=${formalBytes} thisRun=${bytesDownloaded}; files=${uniqueFiles.length}; expectedRaw=${expectedRawBytes}; rawLimit=${Number.isFinite(rawDownloadLimit) ? rawDownloadLimit : 'unbounded'}`);
  if (acquire) console.log(`manifest=${MANIFEST_PATH}\nreceipt=${RECEIPT_PATH}\nlog=${LOG_PATH}`);
  if (downloadErrors.length && acquire) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`assets-acquire: ${error?.stack || error?.message || error}`); process.exitCode = 1; });
}
