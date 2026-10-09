#!/usr/bin/env node
// Incrementally sync generated Workshop cells while preserving the live table's rows, order, columns and manual edits.
// Usage: node tools/merge-workshop-concentrated-table.mjs --base B.json --next N.json --current C.json --output O.json --report R.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EDITABLE_FIELDS = new Set(['role', 'normal', 'upgrade', 'landing', 'basis']);
const keyOf = (row) => JSON.stringify([row.section, row.level, row.name]);

function index(table, label) {
  const out = new Map();
  for (const row of table.rows) {
    const key = keyOf(row);
    if (out.has(key)) throw new Error(`${label} has duplicate row identity ${key}`);
    out.set(key, row);
  }
  return out;
}

export function mergeTables(base, next, current) {
  for (const [label, table] of [['base', base], ['next', next], ['current', current]]) {
    if (table?.schema !== 'workshop.table/v1' || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new Error(`${label} is not a workshop.table/v1 table`);
  }
  const bRows = index(base, 'base'), nRows = index(next, 'next'), liveRows = index(current, 'current');
  const merged = structuredClone(current), mergedRows = index(merged, 'merged');
  const changed = [], preserved = [], missingCurrent = [], removedSource = [], addedLiveRows = [];
  for (const [key, row] of liveRows) if (!bRows.has(key)) addedLiveRows.push({ key, row: structuredClone(row) });
  for (const [key, newRow] of nRows) {
    const oldRow = bRows.get(key), liveRow = mergedRows.get(key);
    if (!oldRow) { missingCurrent.push({ key, reason: 'row-not-in-baseline' }); continue; }
    if (!liveRow) { missingCurrent.push({ key, reason: 'row-missing-from-live-table' }); continue; }
    for (const field of EDITABLE_FIELDS) {
      if (newRow[field] === oldRow[field]) continue;
      if (liveRow[field] === oldRow[field]) {
        liveRow[field] = newRow[field];
        changed.push({ row: key, field, before: oldRow[field] ?? '', after: newRow[field] ?? '' });
      } else {
        preserved.push({ row: key, field, baseline: oldRow[field] ?? '', live: liveRow[field] ?? '', generated: newRow[field] ?? '' });
      }
    }
  }
  for (const key of bRows.keys()) if (!nRows.has(key)) removedSource.push({ key, reason: 'row-absent-from-generated-table' });
  return {
    merged,
    report: {
      schema: 'workshop.table.incremental-sync-report/v1',
      title: current.title,
      counts: { liveRows: current.rows.length, baselineRows: base.rows.length, generatedRows: next.rows.length, changedCells: changed.length, preservedManualCells: preserved.length, addedLiveRows: addedLiveRows.length, missingCurrentRows: missingCurrent.length, rowsAbsentFromGenerated: removedSource.length },
      changed, preserved, addedLiveRows, missingCurrent, removedSource,
    },
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
    if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
    return out;
  }, []));
  const required = ['base', 'next', 'current', 'output', 'report'];
  for (const key of required) if (!args[key] || !path.isAbsolute(args[key])) throw new Error(`--${key} must name an absolute file`);
  for (const key of ['base', 'next', 'current']) if (!fs.existsSync(args[key])) throw new Error(`--${key} does not exist: ${args[key]}`);
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const { merged, report } = mergeTables(read(args.base), read(args.next), read(args.current));
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, output: args.output, report: args.report, counts: report.counts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
