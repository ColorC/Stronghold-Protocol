// Lists every rest of the mouse longer than 0.5 s and the reason it is allowed:
//   detail-open | voice (a guide card is being spoken) | static-look (whole screen read once) | battle | game (the game's own animation / scene load)
// usage: node analyze-dwell.mjs <outDir> [minGapSec=0.5]
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2]; const MIN = Number(process.argv[3] || 0.5);
const ptr = JSON.parse(fs.readFileSync(path.join(dir, 'pointer-trace.json'), 'utf8'));
const rows = fs.readFileSync(path.join(dir, 'driver.log.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const pl = JSON.parse(fs.readFileSync(path.join(dir, 'page-log.json'), 'utf8'));
const sum = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));

// page-log t is wall ms; driver clock is seconds from capture start (or process start). Anchor via the first cue-queued row in both logs.
const firstQ = rows.find((r) => r.ev === 'cue-queued'); const firstP = pl.find((x) => x.ev === 'cue-queued');
const off = firstQ && firstP ? firstP.t - firstQ.t * 1000 : 0; // wall ms at driver time 0
const rel = (t) => (t - off) / 1000;
const intervals = [];
for (const r of rows.filter((x) => x.ev === 'dwell')) intervals.push({ why: r.why, a: r.from, b: r.from + r.ms / 1000 });
for (const c of pl.filter((x) => x.ev === 'card-start')) { const e = pl.find((y) => y.id === c.id && y.ev === 'card-end'); if (e) intervals.push({ why: 'voice', a: rel(c.t), b: rel(e.t) + 0.1 }); }
for (const r of rows.filter((x) => x.ev === 'op-start' && x.type === 'readyBattle')) { const d = rows.find((x) => x.ev === 'op-done' && x.i === r.i); intervals.push({ why: 'battle', a: r.t, b: d ? d.t : r.t + 300 }); }
// scene changes: the first 1.2 s after a step's last click (the game animates / loads the next screen)
for (const d of rows.filter((x) => x.ev === 'op-done')) intervals.push({ why: 'game', a: d.t - 1.5, b: d.t + 1.0 });
const out = []; let total = 0; const byWhy = {};
for (let k = 1; k < ptr.length; k++) {
  const gap = ptr[k][0] - ptr[k - 1][0]; if (gap < MIN) continue;
  const a = ptr[k - 1][0], b = ptr[k][0];
  const cover = intervals.filter((iv) => iv.a <= a + 0.35 && iv.b >= b - 0.35);
  const part = cover.length ? cover[0].why : intervals.filter((iv) => iv.a < b && iv.b > a).map((iv) => iv.why)[0] || null;
  const ctx = rows.filter((r) => r.t >= a - 1 && r.t <= b + 0.2 && ['op-start', 'op-done', 'dwell', 'cue-queued', 'click'].includes(r.ev)).slice(-3).map((r) => `${r.ev}${r.i ?? ''}${r.why ? ':' + r.why : ''}`).join(' ');
  out.push({ from: +a.toFixed(2), to: +b.toFixed(2), gapSec: +gap.toFixed(2), why: part, ctx });
  total += gap; byWhy[part || 'UNCLASSIFIED'] = (byWhy[part || 'UNCLASSIFIED'] || 0) + 1;
}
fs.writeFileSync(path.join(dir, 'dwell-report.json'), JSON.stringify({ minGapSec: MIN, count: out.length, byWhy, rests: out }, null, 1));
console.log(JSON.stringify({ count: out.length, byWhy }));
for (const r of out.filter((x) => !x.why)) console.log('UNCLASSIFIED', JSON.stringify(r));
