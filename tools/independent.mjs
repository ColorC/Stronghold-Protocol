#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSession, applyAction, viewSession } from '../server/modes/independent/session.js';
import { getCatalog } from '../server/modes/independent/catalog.js';

function parseArgs(argv) {
  const [command, ...rest] = argv; const opts = {}; const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const x = rest[i];
    if (x.startsWith('--')) {
      const key = x.slice(2); if (!['file', 'difficulty', 'round-limit', 'seed', 'actions'].includes(key)) throw new Error(`UNKNOWN_OPTION:${x}`);
      if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new Error(`MISSING_VALUE:${x}`);
      opts[key] = rest[++i];
    } else positional.push(x);
  }
  return { command, opts, positional };
}
async function load(file) { return JSON.parse(await readFile(resolve(file), 'utf8')); }
async function save(file, state) {
  const target = resolve(file); await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const requireFile = (opts) => { if (!opts.file) throw new Error('REQUIRES_EXPLICIT_FILE'); return resolve(opts.file); };

export async function main(argv = process.argv.slice(2)) {
  const { command, opts, positional } = parseArgs(argv);
  if (command === 'catalog') { output(getCatalog()); return 0; }
  if (command === 'new') {
    const file = requireFile(opts);
    const state = createSession({ difficulty: opts.difficulty, roundLimit: opts['round-limit'] === undefined ? undefined : Number(opts['round-limit']), seed: opts.seed === undefined ? undefined : Number(opts.seed) });
    await save(file, state); output({ ok: true, file, state }); return 0;
  }
  if (!['show', 'act', 'play', 'batch'].includes(command)) throw new Error('USAGE:new|act|show|catalog|play|batch');
  const file = requireFile(opts); const state = await load(file);
  if (command === 'show') { output(viewSession(state)); return 0; }
  let actions;
  if (command === 'act') actions = [JSON.parse(positional.join(' '))];
  else {
    if (!opts.actions) throw new Error('REQUIRES_ACTIONS_FILE');
    const data = await load(opts.actions); actions = Array.isArray(data) ? data : data.actions;
    if (!Array.isArray(actions)) throw new Error('BAD_ACTIONS_FILE');
  }
  let current = state; const results = [];
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) { output({ ok: false, error: result.error, state: current, results }); return 2; }
    current = result.state; results.push({ events: result.events, revision: current.revision });
  }
  await save(file, current); output({ ok: true, file, state: current, results }); return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${error.message || error}\n`); process.exitCode = 2; });
}
