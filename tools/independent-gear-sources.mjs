#!/usr/bin/env node
// The 「谁带来哪件装备」 lists of docs/independent-mode/design.md (商店与装备来源) come from the rules themselves: the
// special badges, the functional and combat gear and the used items, each with the operators whose trait names it
// (「随机」 when it comes out of a random pool). Gear nobody brings any more is listed as 停产. Since 干员表 v3
// (2026-10-07) the lists are generated, so they cannot drift from the rules:
//   node tools/independent-gear-sources.mjs check   → exit 1 when the doc's block differs from the rules
//   node tools/independent-gear-sources.mjs write   → rewrites the block between the two markers
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCatalog } from '../server/modes/independent/catalog.js';

const ROOT = resolve(import.meta.dirname, '..');
const DOC = resolve(ROOT, 'docs/independent-mode/design.md');
const START = '<!-- gear-sources:start (node tools/independent-gear-sources.mjs write) -->';
const END = '<!-- gear-sources:end -->';
const USED = new Set(['补给', '玩家设施']);

/** item id → { fixed: Set<name>, random: Set<name> } over every operator's rules (the normal form; the elite brings the same). */
function sources(catalog) {
  const items = { ...catalog.badges, ...catalog.equipment };
  const canonical = (id) => {
    const d = items[id];
    if (d?.mechanism === 'badge') return d.badgeId;
    return d?.canonicalId && d.canonicalId !== id ? (Object.values(catalog.equipment).find((x) => x.canonicalId === d.canonicalId && x.id === d.canonicalId)?.id ?? id) : id;
  };
  const out = new Map();
  const add = (id, name, random) => {
    const key = canonical(id);
    if (!out.has(key)) out.set(key, { fixed: new Set(), random: new Set() });
    out.get(key)[random ? 'random' : 'fixed'].add(name);
  };
  const walk = (v, name, random) => {
    if (typeof v === 'string' && items[v]) add(v, name, random);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, name, random));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, name, random));
  };
  for (const op of Object.values(catalog.operators)) {
    if (op.elite) continue;
    for (const r of [...op.nativeTrait.effect.prep, ...op.nativeTrait.effect.combat]) {
      const pool = r.params?.poolId ? catalog.pools?.[r.params.poolId] : null;
      if (pool) walk(pool, op.name, true);
      else if (r.behavior === 'randomEquipment' || r.behavior === 'randomSupply') walk(r.params.ids, op.name, true);
      else if (r.behavior !== 'randomUnlockedEquipment') walk([...(r.params?.outputs || []).map((x) => x.id), r.params?.id], op.name, false);
    }
  }
  return out;
}

const who = (s) => [...s.fixed, ...[...s.random].filter((n) => !s.fixed.has(n)).map((n) => `${n}（随机）`)].join('、');

export function gearSourcesBlock(catalog = getCatalog()) {
  const src = sources(catalog);
  const none = { fixed: new Set(), random: new Set() };
  const lines = [START, '', '特殊徽章的产出干员（基础徽章由许多干员产出，不列）：', ''];
  const special = Object.values(catalog.badges).filter((b) => b.basic === false || !['precision', 'agility', 'vitality', 'defense', 'assault', 'recovery'].includes(b.id));
  for (const b of special) {
    const s = src.get(b.id) || none;
    lines.push(`- **${b.name}**：${s.fixed.size || s.random.size ? who(s) : '停产（没有干员产出；旧存档里已有的照常生效）'}`);
  }
  lines.push('', '功能与战斗装备的来源（凯瑟琳随机获得已解锁的通用装备，不列；停产的装备不进她的随机池）：', '');
  const gear = Object.values(catalog.equipment).filter((d) => d.available !== false && d.mechanism !== 'badge' && d.mechanism !== 'disabled'
    && !['prizeGear', 'permit', '停用'].includes(d.kind) && !USED.has(d.kind) && d.canonicalId === d.id);
  const retired = []; const pending = [];
  for (const d of gear) {
    const s = src.get(d.id) || none;
    // gear v4 (2026-10-07): a piece marked `unassigned` waits for its operator; a retired one some trait still names is flagged
    if (!s.fixed.size && !s.random.size) { (d.unassigned && !d.retired ? pending : retired).push(d.newName || d.name); continue; }
    lines.push(`- **${d.newName || d.name}**：${who(s)}${d.retired ? '（已停用，来源待重新分配）' : ''}`);
  }
  if (pending.length) lines.push(`- **来源待定**（第四版新装备与改回的装备，还没有干员带来，也不进凯瑟琳的随机池）：${pending.join('、')}`);
  if (retired.length) lines.push(`- **停产**（没有干员带来；旧存档里已有的照常生效）：${retired.join('、')}`);
  const used = Object.values(catalog.equipment).filter((d) => d.available !== false && USED.has(d.kind)).map((d) => {
    const s = src.get(d.id) || none;
    const named = [...s.fixed, ...[...s.random].filter((n) => !s.fixed.has(n)).map((n) => `${n}随机`)].join('、');
    return `${d.newName || d.name}（${named || '只由工程部特供发放'}）`;
  });
  lines.push('', `补给与玩家设施（后勤物资）：${used.join('、')}。`, '', END);
  return lines.join('\n');
}

export function gearSourcesDiff(doc = readFileSync(DOC, 'utf8'), catalog = getCatalog()) {
  const a = doc.indexOf(START); const b = doc.indexOf(END);
  if (a < 0 || b < 0) return { ok: false, reason: 'markers missing' };
  const current = doc.slice(a, b + END.length);
  const want = gearSourcesBlock(catalog);
  return current === want ? { ok: true } : { ok: false, reason: 'block differs', current, want };
}

function main() {
  const mode = process.argv[2];
  if (mode === 'write') {
    const doc = readFileSync(DOC, 'utf8');
    const a = doc.indexOf(START); const b = doc.indexOf(END);
    if (a < 0 || b < 0) throw new Error(`design.md lacks the markers ${START} … ${END}`);
    writeFileSync(DOC, doc.slice(0, a) + gearSourcesBlock() + doc.slice(b + END.length));
    console.log(JSON.stringify({ written: true, doc: DOC }));
  } else if (mode === 'check') {
    const d = gearSourcesDiff();
    console.log(JSON.stringify({ ok: d.ok, reason: d.reason, doc: DOC }));
    if (!d.ok) process.exitCode = 1;
  } else {
    console.error('usage: node tools/independent-gear-sources.mjs check|write');
    process.exitCode = 2;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
