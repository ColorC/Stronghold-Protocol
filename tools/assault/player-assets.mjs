#!/usr/bin/env node
// tools/assault/player-assets.mjs — first-run download of the art the 进击 (assault) mode needs on top of the base
// game's (tools/fetch-assets.mjs, run by tools/setup.mjs). Used by scripts/launch.mjs --assault and the Windows
// release (docs/WINDOWS.md); a source checkout can run it by hand.
//
//   node tools/assault/player-assets.mjs --dir <assault assets dir> [--assets <public/assets dir>] [--check] [--quiet]
//
// What it reads: data/assault-assets.json (committed). Every file there carries its own public source:
//   * `/assault-assets/<rel>` rows (operator portraits and avatars, collectible icons, event art, summon models)
//     → <dir>/<rel>, fetched byte for byte from the row's sourceUrls (GitHub dumps, jsDelivr as fallback);
//   * `/assets/<rel>` rows that tools/fetch-assets.mjs does not list (extra operators, skill icons, summon avatars)
//     → <assets>/<rel>, the same way;
//   * the chapter enemies (`assets.enemies`): the base asset pipeline's own plan, downloader and Spine
//     post-processing for those enemy ids (as tools/assault/chapter-enemy-assets.mjs added them), into <assets>.
// Rows whose source is the local game client (native://…, the official CDN bundles) cannot be downloaded; the game
// keeps its fallback look for those. Nothing is ever deleted or rewritten: a file already on disk is kept.
//
// Exit code: 0 when the run finished (files that could not be fetched are reported and fetched again next time),
// 1 on a usage error. --check downloads nothing and exits 1 when a downloadable file is missing.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'data', 'assault-assets.json');
const MB = (n) => `${(n / 1048576).toFixed(1)} MB`;

export function parseArgs(argv) {
  const o = { dir: '', assets: path.join(ROOT, 'public', 'assets'), check: false, quiet: false, help: false, report: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--dir') o.dir = String(val() || '');
    else if (k === '--assets') o.assets = String(val() || '');
    else if (k === '--report') o.report = String(val() || '');
    else if (a === '--check') o.check = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

const kindOfRel = (rel) => {
  const ext = path.extname(rel).toLowerCase();
  return ext === '.png' ? 'png' : ext === '.skel' ? 'skel' : ext === '.atlas' ? 'atlas' : ext === '.json' ? 'json' : 'bin';
};

/**
 * The downloadable files of the assault manifest: every `{ url, sourceUrl(s) }` row whose url is under
 * /assault-assets/ or /assets/ and whose sources include an https URL that is not the official CDN.
 * @returns {{ assault: Array<{rel:string,urls:string[],kind:string}>, assets: Array<{rel:string,urls:string[],kind:string}>,
 *             local: string[], enemyIds: string[] }}
 */
export function collectJobs(manifest) {
  const assault = new Map(); const assets = new Map(); const local = new Set();
  const visit = (v) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.url === 'string' && (v.sourceUrl || v.sourceUrls)) {
      // the row's sourceUrl is the file the maintainer actually took; the other sourceUrls are fallbacks
      const urls = [...new Set([v.sourceUrl, ...(Array.isArray(v.sourceUrls) ? v.sourceUrls : [])]
        .filter((u) => typeof u === 'string' && /^https:\/\//.test(u) && !/^https:\/\/ak\.hycdn\.cn\//.test(u)))];
      const bucket = v.url.startsWith('/assault-assets/') ? assault : v.url.startsWith('/assets/') ? assets : null;
      const rel = bucket === assault ? v.url.slice('/assault-assets/'.length) : v.url.slice('/assets/'.length);
      if (bucket && urls.length) {
        const prev = bucket.get(rel);
        bucket.set(rel, { rel, kind: kindOfRel(rel), urls: prev ? [...new Set([...prev.urls, ...urls])] : urls });
      } else if (bucket) local.add(v.url);
    }
    for (const [k, c] of Object.entries(v)) if (!['sourceUrls', 'sourceVersion'].includes(k)) visit(c);
  };
  visit(manifest.assets);
  const enemyIds = Object.keys(manifest.assets?.enemies ?? {}).sort();
  return { assault: [...assault.values()], assets: [...assets.values()], local: [...local].sort(), enemyIds };
}

async function exists(file) {
  try { const st = await fsp.stat(file); return st.isFile() && st.size > 0; } catch { return false; }
}

async function dirBytes(dir) {
  let bytes = 0;
  const walk = async (d) => {
    let entries; try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (e.isFile()) { try { bytes += (await fsp.stat(p)).size; } catch { /* gone */ } }
    }
  };
  await walk(dir);
  return bytes;
}

/** The files the chapter enemies' rows point at (icon, skel, atlas, pages), relative to public/assets. */
export function enemyFiles(manifest) {
  const out = new Set();
  const add = (u) => { if (typeof u === 'string' && u.startsWith('/assets/')) out.add(u.slice('/assets/'.length)); };
  for (const e of Object.values(manifest.assets?.enemies ?? {})) {
    add(e?.icon); add(e?.spine?.skel); add(e?.spine?.atlas);
    for (const t of e?.spine?.textures ?? []) add(t);
  }
  return [...out].sort();
}

/** Add the missing `size:` page lines (real PNG size) to the given atlases; pages renamed to their local file names. */
export async function normalizeAtlases(root, rels) {
  const { normalizeAtlas, atlasInfo } = await import('../assets/atlas.mjs');
  const { pngSize } = await import('../assets/formats.mjs');
  const { safeName } = await import('../assets/sources.mjs');
  let changed = 0;
  for (const rel of rels) {
    const file = path.join(root, rel);
    let text;
    try { text = await fsp.readFile(file, 'utf8'); } catch { continue; }
    if (atlasInfo(text).hasSize) continue;
    const sizes = new Map();
    for (const page of atlasInfo(text).pages) {
      const buf = await fsp.readFile(path.join(path.dirname(file), safeName(page))).catch(() => null);
      const sz = buf ? pngSize(buf) : null;
      if (sz) sizes.set(page, sz);
    }
    const norm = normalizeAtlas(text, { pageSize: (p) => sizes.get(p) || null, renamePage: (p) => safeName(p) });
    if (norm.missingSize.length || !norm.changed) continue;
    await fsp.writeFile(`${file}.tmp`, norm.text);
    await fsp.rename(`${file}.tmp`, file);
    changed++;
  }
  return changed;
}

/** The chapter enemies through the base pipeline (same plan, downloader and atlas post-processing as fetch-assets). */
async function fetchEnemies(ids, assetsDir, log) {
  const { buildPlan } = await import('../assets/plan.mjs');
  const { indexAudio } = await import('../assets/audio.mjs');
  const { cachedJson } = await import('../assets/cache.mjs');
  const { RAW } = await import('../assets/sources.mjs');
  const { Downloader } = await import('../assets/downloader.mjs');
  const { processModels } = await import('../assets/spine.mjs');
  const { collectLeaves, downloadLeaves } = await import('../assets/manifest.mjs');
  const cacheDir = path.join(ROOT, '.cache');
  const modelsData = await cachedJson({ cacheFile: path.join(cacheDir, 'ark-models', 'models_data.json'), url: `${RAW.arkModels}models_data.json`, timeoutMs: 60000, log });
  const plan = buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio: indexAudio({}), modelsData, voiceJp: false, extraEnemyIds: ids });
  const template = { enemies: Object.fromEntries(ids.filter((id) => plan.template.enemies[id]).map((id) => [id, plan.template.enemies[id]])) };
  const refs = new Set();
  const walk = (x) => { if (!x || typeof x !== 'object') return; if (x.model) refs.add(x.model); for (const v of Object.values(x)) walk(v); };
  walk(template);
  const models = new Map([...plan.models].filter(([key]) => refs.has(key)));
  const dl = new Downloader({ root: assetsDir, ledgerPath: path.join(cacheDir, 'assault-enemy-assets-ledger.json'),
    concurrency: 8, retries: 3, timeoutMs: 60000, keepExisting: true, log });
  await dl.loadLedger();
  await processModels(models, { root: assetsDir, dl, cachePath: path.join(cacheDir, 'assault-enemy-spine-cache.json'), writable: (rel) => dl.written.has(rel), log });
  await downloadLeaves(collectLeaves(template), dl, assetsDir, '进击敌人头像');
  return dl.totals.bytesDownloaded;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  if (!o.dir || !path.isAbsolute(o.dir)) throw new Error('--dir <absolute assault assets directory> is required');
  const assetsDir = path.resolve(o.assets);
  const log = o.quiet ? () => {} : (m) => console.log(m);
  const manifest = JSON.parse(await fsp.readFile(MANIFEST, 'utf8'));
  const jobs = collectJobs(manifest);
  const enemyRels = enemyFiles(manifest);

  const missing = async () => ({
    assault: (await Promise.all(jobs.assault.map(async (j) => (await exists(path.join(o.dir, j.rel)) ? null : j)))).filter(Boolean),
    assets: (await Promise.all(jobs.assets.map(async (j) => (await exists(path.join(assetsDir, j.rel)) ? null : j)))).filter(Boolean),
    enemies: (await Promise.all(enemyRels.map(async (r) => (await exists(path.join(assetsDir, r)) ? null : r)))).filter(Boolean),
  });
  const before = await missing();
  const todo = before.assault.length + before.assets.length + before.enemies.length;
  if (o.check) {
    console.log(JSON.stringify({ missingAssault: before.assault.length, missingAssets: before.assets.length, missingEnemyFiles: before.enemies.length }));
    return todo ? 1 : 0;
  }
  if (!todo) {
    await normalizeAtlases(assetsDir, jobs.assets.filter((j) => j.kind === 'atlas').map((j) => j.rel));
    log('[进击资源] 已就绪');
    return 0;
  }

  const t0 = Date.now();
  const bytesBefore = await dirBytes(o.dir);
  console.log(`[进击资源] 需要下载：进击素材 ${before.assault.length} 个、游戏素材 ${before.assets.length} 个、敌人文件 ${before.enemies.length} 个（中断后再次启动会继续）`);
  const { Downloader } = await import('../assets/downloader.mjs');
  let downloaded = 0;
  const failures = [];
  const run = async (root, list, ledger, label) => {
    if (!list.length) return;
    const dl = new Downloader({ root, ledgerPath: path.join(ROOT, '.cache', ledger), concurrency: 8, retries: 3, timeoutMs: 60000, keepExisting: true, log });
    await dl.loadLedger();
    const results = await dl.run(list, label);
    downloaded += dl.totals.bytesDownloaded;
    for (const [rel, r] of results) if (r.status === 'miss' || r.status === 'error') failures.push(`${rel}: ${r.error}`);
  };
  await fsp.mkdir(o.dir, { recursive: true });
  await run(o.dir, before.assault, 'assault-assets-ledger.json', '进击素材');
  await run(assetsDir, before.assets, 'assault-public-assets-ledger.json', '进击用到的游戏素材');
  // Spine atlases under public/assets carry their page size, as tools/fetch-assets.mjs writes them (the GitHub dumps
  // leave it out); only this list's atlases that still lack it are touched.
  await normalizeAtlases(assetsDir, jobs.assets.filter((j) => j.kind === 'atlas').map((j) => j.rel));
  if (before.enemies.length) {
    try { downloaded += await fetchEnemies(jobs.enemyIds, assetsDir, log); } catch (e) { failures.push(`chapter enemies: ${e?.message || e}`); }
  }
  const after = await missing();
  const left = after.assault.length + after.assets.length + after.enemies.length;
  const summary = { downloadedBytes: downloaded, assaultDirBytes: await dirBytes(o.dir), assaultDirBytesBefore: bytesBefore,
    seconds: Math.round((Date.now() - t0) / 100) / 10, missingAfter: { assault: after.assault.length, assets: after.assets.length, enemies: after.enemies.length },
    localOnly: jobs.local.length, failures: failures.slice(0, 50) };
  if (o.report) await fsp.writeFile(o.report, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`[进击资源] 下载 ${MB(downloaded)}，用时 ${summary.seconds} 秒${left ? `；还有 ${left} 个文件没下到，下次启动会重试（游戏用替代样式显示）` : '，全部就绪'}`);
  return 0;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) main().then((code) => { process.exitCode = code; }, (e) => { console.error(`[进击资源] ${e?.message || e}`); process.exitCode = 1; });
