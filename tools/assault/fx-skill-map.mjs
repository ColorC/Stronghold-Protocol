#!/usr/bin/env node
// tools/assault/fx-skill-map.mjs — the assault ↔ official-effects mapping table (fx-mapping-spec.md):
//   seed      build the skeleton (172 bodies, official = fixedSkill.sourceSkillId, all default)
//   inputs    one input package per body for the F01–F04 filling batches (seed + skill_table + plan summary + cards)
//   check     the six validations of the spec (§10) on the formal file or a batch
//   merge     validate batches, then overwrite their entries in the formal file
//   coverage  the official-effects coverage of the assault bodies (tools/vfx-skill-coverage.mjs coverage())
//
// Read-only over data/** and server/**; writes only the paths named on the command line. No options of its own are
// unknown: `node tools/assault/fx-skill-map.mjs <subcommand> [options]` (exit code 2 on a bad option).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSkill, skillPlan, skillRecordOf } from '../../public/js/render/vfx/skills.js';
import { coverage } from '../vfx-skill-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN_ROOT = path.resolve(ROOT, '../../..');
const SCHEMA = 'assault-fx-skill-map/v1';
const DEFAULT_MAP = path.join(ROOT, 'public/js/assault/fx-skill-map.json');
const DEFAULT_INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');
const DEFAULT_SEED = path.join(MAIN_ROOT, '.omni/tmp/assault/upstream-visual/mapping-seed.json');
const DEFAULT_EXCEL = path.join(MAIN_ROOT, 'data/assault-sources/arknights/excel/skill_table.json');
const DEFAULT_INPUT_DIR = path.join(MAIN_ROOT, '.omni/tmp/assault/upstream-visual/mapping-input');
const RUNTIME = path.join(ROOT, 'data/assault-runtime.json');
const CARDS_DIR = path.join(ROOT, 'server/sim/content/assault/cards');

const USAGE = {
  seed: 'usage: node tools/assault/fx-skill-map.mjs seed [--seed <path>] [--out <path>] [--force]',
  inputs: 'usage: node tools/assault/fx-skill-map.mjs inputs [--index <index.json>] [--seed <path>] [--excel <skill_table.json>] [--out <dir>] [--only <charId,…>]',
  check: 'usage: node tools/assault/fx-skill-map.mjs check [--map <path>] [--batch <path>] [--index <index.json>]',
  merge: 'usage: node tools/assault/fx-skill-map.mjs merge --batch <path>… [--map <path>] [--index <index.json>]',
  coverage: 'usage: node tools/assault/fx-skill-map.mjs coverage [--index <index.json>] [--json]',
};

/** The spec's §2 defaults, as written there (key order matters: the file is generated). */
const DEFAULTS = {
  instant: { loop: { holdS: 0.8 }, range: { holdS: 0.8 }, targets: 'status', attackFrom: 'skill', hits: 'byCount', end: 'play', ready: 'skip', modeSwitch: false },
  passive: { loop: 'skill', range: 'skill', targets: 'status', attackFrom: 'skill', hits: 'byCount', end: 'play', ready: 'skip', modeSwitch: true },
};

const ENTRY_KEYS = new Set(['assaultSkill', 'shape', 'official', 'phases', 'extras', 'evidence', 'confidence', 'status', 'notes']);
const PHASE_KEYS = new Set(['start', 'range', 'loop', 'attackFrom', 'hits', 'projectile', 'targets', 'end', 'endDelayS', 'ready', 'modeSwitch']);
const EXTRA_KEYS = new Set(['what', 'signal', 'look', 'why']);
const EXTRA_WHAT = /^(costGain|spGain|charge|atkBuff|haste|shield|heal|summon|redeploy|link|other|status:.+)$/;
const SIGNAL_EVENTS = new Set(['fx', 'status', 'deploy', 'spawn', 'none']);
const SHAPES = new Set(['instant', 'passive']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const STATUSES = new Set(['filled', 'default', 'needs-index']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// ---- options ----------------------------------------------------------------------------------------------------------

function parseArgs(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) return null;
    const name = a.slice(2);
    const def = spec[name];
    if (!def) return null;
    if (def.type === 'flag') { out[name] = true; continue; }
    if (def.multi) {
      const vals = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) vals.push(argv[++i]);
      if (!vals.length) return null;
      for (const v of vals) (out[name] ||= []).push(v);
      continue;
    }
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) return null;
    i++;
    out[name] = v;
  }
  return out;
}

function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

/** Read the optional index; a missing/unreadable file skips the index checks with a warning. */
function optionalIndex(file) {
  if (!file) return { idx: null, warning: '没有 --index，跳过依赖素材索引的检查' };
  if (!fs.existsSync(file)) return { idx: null, warning: `索引不存在：${file}，跳过依赖素材索引的检查` };
  try {
    return { idx: readJson(file), warning: null };
  } catch (e) {
    return { idx: null, warning: `索引无法解析：${file}（${e.message}），跳过依赖素材索引的检查` };
  }
}

// ---- seed -------------------------------------------------------------------------------------------------------------

function buildSkeleton(seed) {
  const entries = {};
  for (const s of seed.entries) {
    const skill = s.skill || {};
    const official = skill.sourceSkillId ? { unit: s.charId, skill: skill.sourceSkillId } : null;
    entries[s.charId] = {
      assaultSkill: skill.name || '',
      shape: skill.kind || 'instant',
      official,
      phases: {},
      extras: [],
      confidence: 'high',
      status: official ? 'default' : 'filled',
      notes: official ? '' : '无原生技能，只用 extras',
    };
  }
  return { schema: SCHEMA, index: { version: null, client: null }, defaults: clone(DEFAULTS), entries };
}

function cmdSeed(argv) {
  const opts = parseArgs(argv, { seed: { type: 'value' }, out: { type: 'value' }, force: { type: 'flag' } });
  if (!opts) die(2, USAGE.seed);
  const seedPath = path.resolve(opts.seed || DEFAULT_SEED);
  const out = path.resolve(opts.out || DEFAULT_MAP);
  if (!fs.existsSync(seedPath)) die(1, `种子不存在：${seedPath}`);
  if (fs.existsSync(out) && !opts.force) die(1, `目标已存在（加 --force 覆盖）：${out}`);
  const seed = readJson(seedPath);
  const map = buildSkeleton(seed);
  writeJson(out, map);
  console.log(`wrote ${rel(out) || out}: ${Object.keys(map.entries).length} entries`);
}

// ---- inputs -----------------------------------------------------------------------------------------------------------

const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);

function skillTableOf(excel, skillId) {
  if (!skillId || !isObj(excel)) return null;
  const s = excel[skillId];
  const levels = Array.isArray(s?.levels) ? s.levels : null;
  if (!levels?.length) return null;
  const lv = levels[levels.length - 1];   // the highest level bracket
  const sp = isObj(lv.spData) ? lv.spData : {};
  return {
    skillType: lv.skillType ?? null,
    durationType: lv.durationType ?? null,
    duration: lv.duration ?? null,
    spType: sp.spType ?? null,
    spCost: sp.spCost ?? null,
    maxChargeTime: sp.maxChargeTime ?? null,
  };
}

function entriesOf(list) {
  return (list || []).map((e) => ({ key: e.key, hold: e.hold ?? null, loop: !!e.loop }));
}

function modeAttackOf(idx, unitKey, modeName, modeIndex) {
  const unit = unitKey ? idx?.units?.[unitKey] : null;
  const modes = Array.isArray(unit?.modes) ? unit.modes : [];
  const mode = (modeName != null ? modes.find((m) => m.name === modeName) : null) || (Number.isInteger(modeIndex) ? modes[modeIndex] : null);
  const a = isObj(mode?.attack) ? mode.attack : null;
  if (!a) return null;
  const rowKeys = (r) => (Array.isArray(r?.effects) ? r.effects : []).map(lc).filter(Boolean);
  const keys = (rows) => (Array.isArray(rows) ? rows : []).flatMap(rowKeys);
  // a MultiHit emitter's rows carry `group`; without it every row is one hit of its own
  const hitRows = Array.isArray(a.hit) ? a.hit : [];
  const grouped = hitRows.some((r) => Number.isInteger(r?.group));
  let hit;
  if (grouped) {
    const n = Math.max(0, ...hitRows.map((r) => (Number.isInteger(r?.groups) ? r.groups : 0)), ...hitRows.map((r) => (Number.isInteger(r?.group) ? r.group + 1 : 0)));
    hit = Array.from({ length: n }, () => []);
    for (const r of hitRows) if (Number.isInteger(r?.group) && r.group >= 0) hit[r.group].push(...rowKeys(r));
  } else hit = hitRows.map(rowKeys);
  return {
    node: a.node ?? null,
    cast: keys(a.cast),
    castTarget: keys(a.castTarget),
    inputTarget: keys(a.inputTarget),
    hit,
    projectile: a.projectileKey ?? null,
  };
}

function planSummary(idx, seedEntry) {
  const skill = seedEntry.skill || {};
  const src = skill.sourceSkillId || null;
  const index = Number.isInteger(skill.sourceIndex) ? skill.sourceIndex : 0;
  const record = { skillId: src, prefabId: src, index };
  const rec = src ? { charId: seedEntry.charId, skill: record, skills: [record] } : { charId: seedEntry.charId };
  const info = { kind: 'op', side: 'ally', defId: seedEntry.charId, spine: seedEntry.charId, skillIndex: index };
  const res = resolveSkill(idx, { info, rec });
  const srec = skillRecordOf(rec, index);
  const plan = res.skill ? skillPlan(idx, res.unitKey, res.skillId, { rec: srec }) : null;
  return {
    exists: !!res.skill,
    unit: res.unitKey,
    skill: res.skillId,
    summary: {
      kind: plan?.kind ?? null,
      modeName: plan?.modeName ?? null,
      start: entriesOf(plan?.start),
      loop: entriesOf(plan?.loop),
      range: entriesOf(plan?.range),
      end: entriesOf(plan?.end),
      ready: entriesOf(plan?.ready),
      targets: entriesOf(plan?.targets),
      attacks: (plan?.attacks || []).map((a) => ({
        ability: a.ability,
        castKeys: (a.cast || []).map((e) => e.key),
        hitGroups: (a.hit || []).map((g) => g.map((e) => e.key)),
        projectile: a.projectile,
      })),
      modeAttack: modeAttackOf(idx, res.unitKey, plan?.modeName ?? null, plan?.mode ?? null),
    },
  };
}

function walkJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJs(p));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

function cardHits(charId, skillId) {
  const needles = [charId, skillId].filter(Boolean);
  const out = [];
  for (const file of walkJs(CARDS_DIR)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < 10; i++) {
      if (needles.some((n) => lines[i].includes(n))) out.push(`${rel(file)}:${i + 1}`);
    }
    if (out.length >= 10) break;
  }
  return out;
}

function cmdInputs(argv) {
  const opts = parseArgs(argv, {
    index: { type: 'value' }, seed: { type: 'value' }, excel: { type: 'value' }, out: { type: 'value' }, only: { type: 'value', multi: true },
  });
  if (!opts) die(2, USAGE.inputs);
  const indexPath = path.resolve(opts.index || DEFAULT_INDEX);
  const seedPath = path.resolve(opts.seed || DEFAULT_SEED);
  const excelPath = path.resolve(opts.excel || DEFAULT_EXCEL);
  const outDir = path.resolve(opts.out || DEFAULT_INPUT_DIR);
  if (!fs.existsSync(indexPath)) die(1, `索引不存在：${indexPath}`);
  if (!fs.existsSync(seedPath)) die(1, `种子不存在：${seedPath}`);
  const idx = readJson(indexPath);
  const seed = readJson(seedPath);
  const excel = fs.existsSync(excelPath) ? readJson(excelPath) : {};
  const runtime = readJson(RUNTIME);
  const only = opts.only ? new Set(opts.only.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)) : null;
  let n = 0;
  for (const entry of seed.entries) {
    if (only && !only.has(entry.charId)) continue;
    const skill = entry.skill || {};
    const { exists, unit, skill: skillId, summary } = planSummary(idx, entry);
    const body = runtime.bodies?.[entry.charId];
    const costs = Array.isArray(body?.fixedSkill?.spCosts) ? body.fixedSkill.spCosts : [];
    const pkg = {
      charId: entry.charId,
      name: entry.name ?? null,
      design: entry.design ?? null,
      seed: entry,
      skillTable: skillTableOf(excel, skill.sourceSkillId),
      plan: summary,
      index: { skillExists: exists, unit, skill: skillId },
      cards: cardHits(entry.charId, skill.sourceSkillId),
      simStatuses: Object.keys(idx?.generic?.status || {}),
      genericKeys: Array.isArray(idx?.generic?.keys) ? idx.generic.keys : [],
      spCostMin: costs.length ? Math.min(...costs) : null,
    };
    writeJson(path.join(outDir, `${entry.charId}.json`), pkg);
    n++;
  }
  console.log(`wrote ${n} input packages to ${outDir}`);
}

// ---- check ------------------------------------------------------------------------------------------------------------

function validateEntry(charId, entry, ctx, errors, warnings, counts) {
  const p = `entries.${charId}`;
  if (!isObj(entry)) { errors.push(`${p}: 不是对象`); return; }
  for (const k of Object.keys(entry)) if (!ENTRY_KEYS.has(k)) errors.push(`${p}.${k}: 多余键`);

  const body = ctx.bodies[charId];
  const source = body?.fixedSkill?.sourceSkillId ?? null;
  const official = entry.official ?? null;
  if (official !== null && !isObj(official)) errors.push(`${p}.official: 不是对象或 null`);
  const officialSkill = isObj(official) ? (official.skill ?? null) : null;
  if (String(officialSkill) !== String(source) && !(typeof entry.notes === 'string' && entry.notes.trim())) {
    errors.push(`${p}.official.skill: ${officialSkill} ≠ 来源技能 ${source}，且没有 notes 说明`);
  }

  if (entry.shape != null && !SHAPES.has(entry.shape)) errors.push(`${p}.shape: ${entry.shape} 不是 instant/passive`);
  if (entry.confidence != null && !CONFIDENCES.has(entry.confidence)) errors.push(`${p}.confidence: ${entry.confidence} 不在 high/medium/low`);
  if (entry.status != null && !STATUSES.has(entry.status)) errors.push(`${p}.status: ${entry.status} 不在 filled/default/needs-index`);
  const status = entry.status ?? 'default';
  const confidence = entry.confidence ?? 'high';
  counts.byStatus[status] = (counts.byStatus[status] || 0) + 1;
  counts.byConfidence[confidence] = (counts.byConfidence[confidence] || 0) + 1;
  if (status === 'needs-index') warnings.push(`${p}: needs-index（素材里没有该技能）`);

  const phases = entry.phases ?? {};
  if (!isObj(phases)) errors.push(`${p}.phases: 不是对象`);
  else {
    for (const k of Object.keys(phases)) if (!PHASE_KEYS.has(k)) errors.push(`${p}.phases.${k}: 多余键`);
    validatePhases(p, phases, official, ctx, errors);
  }

  if (entry.extras != null && !Array.isArray(entry.extras)) errors.push(`${p}.extras: 不是数组`);
  else if (Array.isArray(entry.extras)) entry.extras.forEach((extra, i) => validateExtra(`${p}.extras[${i}]`, extra, official, ctx, errors));

  // §5: only `default` entries may skip the evidence; a body with no official skill and nothing overridden has none to give
  const overridden = (isObj(phases) && Object.keys(phases).length > 0) || (Array.isArray(entry.extras) && entry.extras.length > 0);
  const needsEvidence = status !== 'default' && !(official === null && !overridden);
  if (needsEvidence) validateEvidence(p, entry.evidence, ctx, errors);

  if (ctx.idx && isObj(official)) {
    const unit = ctx.idx.units?.[official.unit];
    const hasSkill = !!(unit?.skills?.[official.skill] || ctx.idx.skills?.[official.skill]);
    if (status !== 'needs-index') {
      if (!unit) errors.push(`${p}.official.unit: ${official.unit} 不在 index.units（status 应为 needs-index）`);
      else if (!hasSkill) errors.push(`${p}.official.skill: ${official.skill} 不在 index.skills（status 应为 needs-index）`);
    }
  }
}

function validateHoldS(where, v, errors) {
  if (!isObj(v)) { errors.push(`${where}: 需要 { "holdS": … }`); return; }
  const h = v.holdS;
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 0.3 || h > 3.0) errors.push(`${where}.holdS: ${JSON.stringify(h)} 不在 0.3–3.0`);
}

function validatePhases(p, phases, official, ctx, errors) {
  const one = (k, ok, want) => { if (Object.hasOwn(phases, k) && !ok(phases[k])) errors.push(`${p}.phases.${k}: ${JSON.stringify(phases[k])} 不是 ${want}`); };
  one('start', (v) => v === 'play' || v === 'skip', 'play/skip');
  for (const k of ['range', 'loop']) {
    if (!Object.hasOwn(phases, k)) continue;
    const v = phases[k];
    if (v === 'skip' || v === 'skill') continue;
    validateHoldS(`${p}.phases.${k}`, v, errors);
  }
  one('attackFrom', (v) => v === 'skill' || v === 'none' || v === 'normal' || (typeof v === 'string' && v.startsWith('mode:')), 'skill/mode:<名>/normal/none');
  one('hits', (v) => v === 'byCount' || v === 'first' || v === 'last' || v === 'all', 'byCount/first/last/all');
  one('projectile', (v) => v === 'auto' || v === 'none', 'auto/none');
  one('end', (v) => v === 'play' || v === 'skip', 'play/skip');
  one('ready', (v) => v === 'skip' || v === 'play', 'skip/play');
  one('modeSwitch', (v) => typeof v === 'boolean', '布尔');
  if (Object.hasOwn(phases, 'targets')) {
    const v = phases.targets;
    if (v !== 'status' && v !== 'skip') validateHoldS(`${p}.phases.targets`, v, errors);
  }
  if (Object.hasOwn(phases, 'endDelayS') && (typeof phases.endDelayS !== 'number' || !Number.isFinite(phases.endDelayS) || phases.endDelayS < 0)) {
    errors.push(`${p}.phases.endDelayS: 需要 ≥ 0 的数`);
  }
  if (ctx.idx && isObj(official) && typeof phases.attackFrom === 'string' && phases.attackFrom.startsWith('mode:')) {
    const name = phases.attackFrom.slice(5);
    const modes = Array.isArray(ctx.idx.units?.[official.unit]?.modes) ? ctx.idx.units[official.unit].modes : [];
    if (!modes.some((m) => m.name === name)) errors.push(`${p}.phases.attackFrom: 模式 ${name} 不在 ${official.unit} 的 modes`);
  }
}

function validateExtra(where, extra, official, ctx, errors) {
  if (!isObj(extra)) { errors.push(`${where}: 不是对象`); return; }
  for (const k of Object.keys(extra)) if (!EXTRA_KEYS.has(k)) errors.push(`${where}.${k}: 多余键`);
  if (typeof extra.what !== 'string' || !EXTRA_WHAT.test(extra.what)) errors.push(`${where}.what: ${JSON.stringify(extra.what)} 不是 §6 的效果名`);
  if (!isObj(extra.signal) || !SIGNAL_EVENTS.has(extra.signal.event)) errors.push(`${where}.signal: 需要 { "event": fx/status/deploy/spawn/none }`);
  if (!isObj(extra.look)) errors.push(`${where}.look: 不是对象`);
  if (typeof extra.why !== 'string' || !extra.why.trim()) errors.push(`${where}.why: 需要一句话`);
  if (ctx.idx && isObj(official) && isObj(extra.look) && Array.isArray(extra.look.official)) {
    const unit = ctx.idx.units?.[official.unit];
    const allowed = new Set([...(Array.isArray(ctx.idx.generic?.keys) ? ctx.idx.generic.keys : []), ...(Array.isArray(unit?.refs) ? unit.refs : [])].map(lc).filter(Boolean));
    for (const k of extra.look.official) {
      if (!allowed.has(lc(k))) errors.push(`${where}.look.official: ${k} 不在 index.generic.keys 或 ${official.unit} 的 refs`);
    }
  }
}

const lineCache = new Map();
function lineCount(file) {
  if (!lineCache.has(file)) {
    try { lineCache.set(file, fs.readFileSync(file, 'utf8').split(/\r?\n/).length); } catch { lineCache.set(file, null); }
  }
  return lineCache.get(file);
}

function validateEvidence(p, ev, ctx, errors) {
  if (!isObj(ev)) { errors.push(`${p}.evidence: status 不是 default 时四项证据必填`); return; }
  for (const k of ['design', 'card', 'original', 'index']) {
    if (typeof ev[k] !== 'string' || !ev[k].trim()) errors.push(`${p}.evidence.${k}: 缺失（没有事实就写 "无"）`);
  }
  if (typeof ev.card !== 'string' || !ev.card.trim() || ev.card.trim() === '无') return;
  const m = /^(.*):(\d+)$/.exec(ev.card.trim());
  if (!m) { errors.push(`${p}.evidence.card: 需要 文件:行`); return; }
  const file = path.isAbsolute(m[1]) ? m[1] : path.join(ROOT, m[1]);
  const lines = lineCount(file);
  if (lines == null) { errors.push(`${p}.evidence.card: 文件不存在 ${m[1]}`); return; }
  const line = Number(m[2]);
  if (!(line >= 1 && line <= lines)) errors.push(`${p}.evidence.card: ${m[1]} 只有 ${lines} 行，没有 ${line}`);
}

function validateMap(map, { batch = false, idx = null, bodies } = {}) {
  const errors = [];
  const warnings = [];
  const counts = { byConfidence: {}, byStatus: {} };
  if (!isObj(map)) return { errors: ['文件不是 JSON 对象'], warnings, counts };
  if (map.schema !== SCHEMA) errors.push(`schema: ${JSON.stringify(map.schema)} ≠ ${SCHEMA}`);
  if (!isObj(map.entries)) return { errors: [...errors, 'entries: 缺失或不是对象'], warnings, counts };
  if (!batch) for (const k of Object.keys(bodies)) if (!Object.hasOwn(map.entries, k)) errors.push(`entries: 缺少身体 ${k}`);
  for (const [charId, entry] of Object.entries(map.entries)) {
    if (!Object.hasOwn(bodies, charId)) { errors.push(`entries.${charId}: 不在 172 个进击身体里`); continue; }
    validateEntry(charId, entry, { idx, bodies }, errors, warnings, counts);
  }
  return { errors, warnings, counts };
}

function loadBodies() {
  const runtime = readJson(RUNTIME);
  return runtime.bodies || {};
}

function cmdCheck(argv) {
  const opts = parseArgs(argv, { map: { type: 'value' }, batch: { type: 'value' }, index: { type: 'value' } });
  if (!opts) die(2, USAGE.check);
  const target = path.resolve(opts.batch || opts.map || DEFAULT_MAP);
  if (!fs.existsSync(target)) die(1, `文件不存在：${target}`);
  let map;
  try {
    map = readJson(target);
  } catch (e) {
    const out = { errors: [`JSON 无法解析：${e.message}`], warnings: [], counts: { byConfidence: {}, byStatus: {} } };
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
  const { idx, warning } = optionalIndex(opts.index ? path.resolve(opts.index) : null);
  const res = validateMap(map, { batch: !!opts.batch, idx, bodies: loadBodies() });
  if (warning) res.warnings.unshift(warning);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.errors.length ? 1 : 0);
}

// ---- merge ------------------------------------------------------------------------------------------------------------

function cmdMerge(argv) {
  const opts = parseArgs(argv, { batch: { type: 'value', multi: true }, map: { type: 'value' }, index: { type: 'value' } });
  if (!opts || !opts.batch) die(2, USAGE.merge);
  const mapPath = path.resolve(opts.map || DEFAULT_MAP);
  if (!fs.existsSync(mapPath)) die(1, `正式文件不存在：${mapPath}`);
  const map = readJson(mapPath);
  const { idx } = optionalIndex(opts.index ? path.resolve(opts.index) : null);
  const bodies = loadBodies();
  const batches = [];
  const errors = [];
  for (const file of opts.batch) {
    const p = path.resolve(file);
    if (!fs.existsSync(p)) { errors.push(`${file}: 文件不存在`); continue; }
    const batch = readJson(p);
    const res = validateMap(batch, { batch: true, idx, bodies });
    if (res.errors.length) errors.push(...res.errors.map((e) => `${file}: ${e}`));
    batches.push({ file, batch, ok: !res.errors.length });
  }
  if (errors.length) {
    console.log(JSON.stringify({ ok: false, errors }, null, 2));
    process.exit(1);
  }
  for (const { batch } of batches) {
    for (const [charId, entry] of Object.entries(batch.entries || {})) map.entries[charId] = entry;
    if (isObj(batch.index)) map.index = batch.index;
  }
  writeJson(mapPath, map);
  console.log(JSON.stringify({ ok: true, map: rel(mapPath), merged: batches.map((b) => b.file), entries: Object.keys(map.entries).length }, null, 2));
}

// ---- coverage ---------------------------------------------------------------------------------------------------------

function cmdCoverage(argv) {
  const opts = parseArgs(argv, { index: { type: 'value' }, json: { type: 'flag' } });
  if (!opts) die(2, USAGE.coverage);
  const indexPath = path.resolve(opts.index || DEFAULT_INDEX);
  if (!fs.existsSync(indexPath)) die(1, `索引不存在：${indexPath}`);
  const idx = readJson(indexPath);
  if (!isObj(idx.units)) die(1, `索引里没有 units：${indexPath}`);
  const runtime = readJson(RUNTIME);
  // data.chess: each body's simChess record, keyed by its charId (the skill it fights with is on the record)
  const chess = {};
  for (const [charId, body] of Object.entries(runtime.bodies || {})) {
    if (isObj(body?.simChess)) chess[charId] = body.simChess;
  }
  const rep = coverage(idx, { chess, tokens: runtime.summons || {} });
  if (opts.json) {
    console.log(JSON.stringify(rep, null, 2));
    return;
  }
  console.log(`index.json: set ${rep.index.set}, client ${rep.index.client}, ${rep.index.skills} skills`);
  for (const [name, g] of Object.entries(rep.groups)) {
    const pct = g.skills ? `${Math.round((g.planned / g.skills) * 1000) / 10} %` : '—';
    console.log(`${name}: ${g.skills} (unit, skill) pairs — ${g.resolved} in index, ${g.planned} with a drivable plan (${pct}), ${g.targetsOnly} targets only, ${g.modeOnly} mode only, ${g.empty} without effects`);
    if (g.resolved) console.log(`  effect keys: ${g.entries} — ${g.placed} placed, ${g.entries - g.placed} unmapped`);
  }
}

// ---- main -------------------------------------------------------------------------------------------------------------

const SUB = { seed: cmdSeed, inputs: cmdInputs, check: cmdCheck, merge: cmdMerge, coverage: cmdCoverage };
const sub = process.argv[2];
const fn = SUB[sub];
if (!fn) die(2, `unknown subcommand: ${sub ?? '(none)'}\n${Object.values(USAGE).join('\n')}`);
fn(process.argv.slice(3));
