#!/usr/bin/env node
// Import forms of the synergy design table (design-172.json, 2026-10-21) into the card sources:
//   data/assault-design/bazaar-cards-<family>.json  the card (format 'synergy'): lines with templates + four-star params,
//                                                  structured trigger / limit / target / effect, 再部署时间, castOnDeploy
//   data/assault-design/roster-<family>.json        fixedSkill: the chosen native skill, its name, description and SP
//                                                  (Amiya's two extra forms: data/assault-design/forms.json)
//   data/assault-design/public-text.json            the operator's skill name / description / summary and its module
//                                                  descriptions (the detail card's mechanics page and upgrade previews)
// Then rebuild: node tools/assault/build-runtime-data.mjs && node tools/assault/build-public-text.mjs
// The design table itself is the design line's working file; this tool copies the forms you name, deterministically,
// and prints a worklist: each line's template with its param letters, its trigger binding, and what needs code.
//
// usage: node tools/assault/import-synergy-design.mjs --design <abs design-172.json> --ids <charId,charId…> [--report <abs>] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FAMILIES = ['assault', 'ranged', 'support'];

function args(argv) {
  const out = { ids: [], dryRun: false, backfillCharges: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--dry-run') { out.dryRun = true; continue; }
    if (key === '--backfill-charges') { out.backfillCharges = true; continue; }
    const value = argv[++i];
    if (key === '--design' && value && path.isAbsolute(value)) out.design = value;
    else if (key === '--report' && value && path.isAbsolute(value)) out.report = value;
    else if (key === '--ids' && value) out.ids = value.split(',').map((x) => x.trim()).filter(Boolean);
    else throw new Error('usage: import-synergy-design.mjs --design <abs> (--ids <a,b> | --backfill-charges) [--report <abs>] [--dry-run]');
  }
  if (!out.design || (!out.ids.length && !out.backfillCharges)) throw new Error('--design <abs> and --ids (or --backfill-charges) are required');
  return out;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// keep each source file's own indentation (bazaar-cards-assault / -support use 1, the others 2)
function indentOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(text);
  for (const n of [1, 2]) if (text === `${JSON.stringify(parsed, null, n)}\n`) return n;
  throw new Error(`${file}: unknown JSON layout`);
}
const writeJson = (file, value, indent) => fs.writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);

// a/b/c/d by star; 「—」 marks a star without the value (module lines: —/—/75/80%)
const N = '(?:—|[+-]?\\d+(?:\\.\\d+)?)';
const TIER = new RegExp(`([+-]?)(${N})(%?)\\/(${N})%?\\/(${N})%?\\/(${N})(%?)`, 'g');
const LETTERS = 'abcdefghijklmnopqrsuvwxyz'; // no t: the design uses t= for durations
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(Number(x) - Number(b[i])) < 1e-9);
const effectLetters = (effect) => [...String(effect ?? '').matchAll(/(?<![A-Za-z_])([a-z])(?![A-Za-z_(])/g)].map((m) => m[1]);

/** Text with a/b/c/d tiers → { template, params }: each four-tier group becomes {x}; letters follow the design's
 * `values` when a group equals one of them (preferring the letters the effect names), else a, b, c … in order. */
export function templateOf(text, values = {}, effect = null, { moduleLine = false } = {}) {
  const params = {};
  const used = new Set();
  const named = effectLetters(effect);
  const template = String(text).replace(TIER, (raw, sign, n1, pct1, n2, n3, n4, pct4) => {
    const tiers = [n1, n2, n3, n4].map((x) => (x === '—' ? null : Number(String(x).replace(/^\+/, ''))));
    const candidates = Object.entries(values ?? {}).filter(([k, v]) => !used.has(k) && same(v, tiers)).map(([k]) => k)
      .sort((x, y) => (named.indexOf(x) < 0 ? 99 : named.indexOf(x)) - (named.indexOf(y) < 0 ? 99 : named.indexOf(y)));
    const letter = candidates[0] ?? [...LETTERS].find((k) => !used.has(k) && !(k in (values ?? {})));
    used.add(letter);
    params[letter] = moduleLine ? [null, null, tiers[2], tiers[3]] : tiers;
    return `${sign}{${letter}}${pct1 || pct4 ? '%' : ''}`;
  });
  return { template, params };
}

const stripQuotes = (s) => String(s ?? '').replace(/[“”"「」『』]/g, '').trim();

// 「部署或再部署时」 written as event redeploy (condition 含部署): every deployment counts, the first one included — the
// runtime binds that as redeploy|deployed (one firing per deployment / in-place 再部署)
function triggerOf(line) {
  const t = line.trigger ?? null;
  if (t?.event === 'redeploy' && (/含部署/.test(t.condition ?? '') || /部署或再部署/.test(line.text))) return { ...t, event: 'redeploy|deployed' };
  return t;
}

function convertLine(line, form) {
  const { template, params } = templateOf(line.text, form.values, line.effect, { moduleLine: line.kind === 'module' });
  return {
    kind: line.kind, template, params,
    trigger: triggerOf(line), target: line.target ?? null, effect: line.effect ?? null, limit: line.limit ?? null,
    scope: line.scope ?? null, newPrimitives: line.newPrimitives ?? [],
    ...(line.consumeKey ? { consumeKey: line.consumeKey } : null), ...(line.selfTrigger ? { selfTrigger: true } : null),
  };
}

export async function importForms({ design, ids, dryRun = false }) {
  const table = readJson(design);
  const { EVENTS, INSTALL_EVENTS, limitOf, subjectOf } = await import(pathToFileURL(path.join(ROOT, 'server/sim/content/assault/card-lines.js')).href);
  const files = Object.fromEntries(FAMILIES.map((family) => {
    const cards = path.join(ROOT, `data/assault-design/bazaar-cards-${family}.json`);
    const roster = path.join(ROOT, `data/assault-design/roster-${family}.json`);
    return [family, { cards, roster, cardsJson: readJson(cards), rosterJson: readJson(roster), cardsIndent: indentOf(cards), rosterIndent: indentOf(roster) }];
  }));
  // Amiya's extra forms keep their skill in forms.json, not in a roster
  const formsFile = path.join(ROOT, 'data/assault-design/forms.json');
  const formsJson = readJson(formsFile);
  const formsIndent = indentOf(formsFile);
  let formsTouched = false;
  const rosterTouched = new Set();
  const publicTextFile = path.join(ROOT, 'data/assault-design/public-text.json');
  const publicText = readJson(publicTextFile);
  const publicIndent = indentOf(publicTextFile);
  // native skill slots of each body (the design table counts S1 = 1; the roster counts from 0)
  const runtime = readJson(path.join(ROOT, 'data/assault-runtime.json'));
  const report = [];
  for (const id of ids) {
    const form = table.forms.find((f) => f.charId === id);
    if (!form) throw new Error(`${id}: not in the design table`);
    const family = FAMILIES.find((f) => files[f].cardsJson.operators.some((c) => c.id === id));
    if (family !== form.family) throw new Error(`${id}: design family ${form.family} but its card is in ${family}`);
    const { cardsJson } = files[family];
    const index = cardsJson.operators.findIndex((c) => c.id === id);
    const old = cardsJson.operators[index];
    // the roster group of an operator is not always its card family (the three latest operators: roster-ranged)
    const rosterFamily = FAMILIES.find((f) => files[f].rosterJson.operators.some((o) => o.charId === id));
    const operator = rosterFamily ? files[rosterFamily].rosterJson.operators.find((o) => o.charId === id) : formsJson.forms.find((f) => f.charId === id);
    if (!operator) throw new Error(`${id}: in no roster and not in forms.json`);
    if (rosterFamily) rosterTouched.add(rosterFamily); else formsTouched = true;
    const issues = [];
    const lines = form.lines.filter((l) => l.kind !== 'module').map((l) => convertLine(l, form));
    const moduleLines = form.lines.filter((l) => l.kind === 'module');
    const modules = old.modules.map((m) => {
      const match = moduleLines.find((l) => stripQuotes(l.text.split('：')[0]) === stripQuotes(m.name));
      return { id: m.id, name: m.name, line: match ? convertLine(match, form) : null };
    });
    for (const l of moduleLines) if (!modules.some((m) => m.line && stripQuotes(l.text.split('：')[0]) === stripQuotes(m.name)))
      issues.push(`module line names no module of the card (${old.modules.map((m) => m.name).join(' / ') || 'none'}): ${l.text}`);
    if (!moduleLines.length && old.modules.length) issues.push(`no module line: the advanced modules ${old.modules.map((m) => m.name).join(' / ')} have no effect`);
    const passive = form.skill.sp.every((x) => x === 0);
    const skillLine = form.lines.find((l) => l.kind === 'skill');
    const card = {
      id, name: old.name, typeLabel: old.typeLabel, profession: old.profession, branch: old.branch, nation: old.nation,
      group: old.group, team: old.team, format: 'synergy', skillName: form.skill.name, skillKind: passive ? 'passive' : 'instant',
      sp: passive ? null : form.skill.sp, castOnDeploy: form.skill.castOnDeploy === true, redeploySeconds: form.redeploy.seconds,
      lines, modules, sourceFile: `server/sim/content/assault/cards/synergy-${family}.js`,
    };
    // the worklist: param letters and the binding each line gets from data
    const rows = [...lines.map((l, i) => [i, l]), ...modules.filter((m) => m.line).map((m) => [`module:${m.id}`, m.line])].map(([at, l]) => {
      const event = String(l.trigger?.event ?? '');
      let binding;
      if (l.kind === 'skill') binding = 'cast';
      else if (l.kind === 'deploy') binding = 'deployEffect';
      else if (INSTALL_EVENTS.includes(event) || !event) binding = 'install';
      else {
        const names = event.split(':')[0].split('|');
        binding = names.every((n) => EVENTS[n] || n === 'deployed') ? `trigger ${event} by ${l.trigger?.subject}` : `NO RUNTIME EVENT ${event} (custom install)`;
        try { subjectOf(l.trigger?.subject); } catch (e) { binding += ` · ${e.message}`; }
      }
      try { limitOf(l.limit); } catch (e) { binding += ` · ${e.message}`; }
      return { at, kind: l.kind, template: l.template, params: l.params, binding, effect: l.effect };
    });
    if (!passive && !form.skill.sourceSkillId) issues.push('the design names no native skill (sourceSkillId null): the roster skill is left as it is — needs the design line');
    else if (!passive) {
      const slots = (runtime.bodies[id]?.source?.skills ?? []).map((x) => x.skillId ?? x.id);
      const sourceIndex = slots.indexOf(form.skill.sourceSkillId);
      if (sourceIndex < 0) throw new Error(`${id}: ${form.skill.sourceSkillId} is not one of its native skills ${slots.join(', ')}`);
      if (sourceIndex !== form.skill.sourceIndex - 1) issues.push(`design sourceIndex ${form.skill.sourceIndex} (S${form.skill.sourceIndex}) but ${form.skill.sourceSkillId} is S${sourceIndex + 1}`);
      const fixed = operator.fixedSkill;
      const charges = form.skill.charges ?? 1;
      const initSp = Array.isArray(fixed.initSp) ? fixed.initSp : fixed.initSp;
      const fits = (cost) => Number(Array.isArray(initSp) ? Math.max(...initSp) : initSp) <= cost * charges;
      // 可储存次数 is the design's (ruled 10-21: the card and the code follow the design, not the native skill)
      Object.assign(fixed, { sourceSkillId: form.skill.sourceSkillId, sourceIndex, name: form.skill.name,
        description: skillLine?.text ?? fixed.description, spCosts: form.skill.sp, initSp: form.skill.sp.every(fits) ? initSp : 0, charges });
    } else {
      // 部署即发的被动 (all SP 0; ruled 10-21): a passive skill — no native slot, no SP — that the kit casts at every
      // deployment and in-place 再部署; the native skill it adapts stays on the card (skillSource) for reference
      if (!form.skill.castOnDeploy) issues.push('passive skill without castOnDeploy: nothing casts it');
      const fixed = operator.fixedSkill;
      Object.assign(fixed, { sourceSkillId: null, sourceIndex: null, name: form.skill.name, kind: 'passive',
        description: skillLine?.text ?? fixed.description, spCosts: [], initSp: 0 });
      card.skillSource = form.skill.sourceSkillId ?? null;
    }
    cardsJson.operators[index] = card;
    const text = publicText.operators[id];
    const skillTexts = form.lines.filter((l) => l.kind === 'skill').map((l) => l.text);
    text.skill = { ...text.skill, name: form.skill.name, description: skillTexts.join('') || text.skill.description,
      summary: skillTexts[0] || text.skill.summary };
    for (const m of modules) if (text.modules?.[m.id]) text.modules[m.id] = { ...text.modules[m.id],
      description: m.line ? m.line.template.replace(/\{(\w+)\}/g, (_, k) => m.line.params[k].filter((x) => x != null).join('/')).replace(/^[^：]*：/, '')
        : '该模组不提供额外战斗效果。' };
    report.push({ id, name: old.name, family, lines: rows, issues });
  }
  if (!dryRun) writeJson(publicTextFile, publicText, publicIndent);
  if (!dryRun && formsTouched) writeJson(formsFile, formsJson, formsIndent);
  if (!dryRun) for (const family of FAMILIES) {
    const f = files[family];
    if (report.some((r) => r.family === family)) writeJson(f.cards, f.cardsJson, f.cardsIndent);
    if (rosterTouched.has(family)) writeJson(f.roster, f.rosterJson, f.rosterIndent);
  }
  return report;
}

/**
 * Writes the design's 可储存次数 (skill.charges) onto the roster skill of every card already imported as synergy, and
 * touches nothing else (cards imported before the importer carried it). Returns [{ id, charges }] of what changed.
 */
export function backfillCharges({ design, dryRun = false }) {
  const table = readJson(design);
  const synergyIds = new Set(FAMILIES.flatMap((family) => readJson(path.join(ROOT, `data/assault-design/bazaar-cards-${family}.json`))
    .operators.filter((card) => card.format === 'synergy').map((card) => card.id)));
  const targets = [...FAMILIES.map((family) => path.join(ROOT, `data/assault-design/roster-${family}.json`)), path.join(ROOT, 'data/assault-design/forms.json')];
  const changed = [];
  for (const file of targets) {
    const json = readJson(file);
    let touched = false;
    for (const operator of json.operators ?? json.forms ?? []) {
      if (!synergyIds.has(operator.charId) || operator.fixedSkill?.kind === 'passive') continue;
      const form = table.forms.find((f) => f.charId === operator.charId);
      if (!form) throw new Error(`${operator.charId}: a synergy card not in the design table`);
      const charges = form.skill.charges ?? 1;
      if (operator.fixedSkill.charges === charges) continue;
      operator.fixedSkill.charges = charges;
      changed.push({ id: operator.charId, charges });
      touched = true;
    }
    if (touched && !dryRun) writeJson(file, json, indentOf(file));
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--backfill-charges')) {
  const opts = args(process.argv.slice(2));
  const changed = backfillCharges(opts);
  console.log(`可储存次数 written for ${changed.length} cards${opts.dryRun ? ' (dry run)' : ''}`);
  for (const c of changed) console.log(`  ${c.id} → ${c.charges}`);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = args(process.argv.slice(2));
  const report = await importForms(opts);
  if (opts.report) fs.writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
  for (const r of report) {
    console.log(`== ${r.name} [${r.id}] (${r.family})`);
    for (const l of r.lines) console.log(`  [${l.at}] ${l.kind} · ${l.binding}\n      ${l.template}  ${JSON.stringify(l.params)}`);
    for (const i of r.issues) console.log(`  ! ${i}`);
  }
}
