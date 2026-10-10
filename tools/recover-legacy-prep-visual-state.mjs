#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverPrepVisualEvents } from './legacy-prep-visuals.mjs';
import { buildLegacyPrepVisualState } from './legacy-prep-visual-state.mjs';

export function parseRecoveryArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--') || i + 1 >= argv.length) throw new Error(`invalid argument near ${argv[i]}`);
    args[argv[i].slice(2)] = argv[++i];
  }
  for (const key of ['events', 'identities', 'geometry', 'facing', 'recording-id', 'session-id', 'started-at', 'output']) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  return args;
}

async function main(argv) {
  const args = parseRecoveryArgs(argv), events = [];
  for await (const line of readline.createInterface({ input: fs.createReadStream(path.resolve(args.events), { encoding: 'utf8' }), crlfDelay: Infinity })) {
    try { const event = JSON.parse(line); if (event.sid === args['recording-id']) events.push(event); } catch { /* malformed unrelated line */ }
  }
  const identitiesDoc = JSON.parse(await fsp.readFile(path.resolve(args.identities), 'utf8'));
  const geometryDoc = JSON.parse(await fsp.readFile(path.resolve(args.geometry), 'utf8'));
  const facingDoc = JSON.parse(await fsp.readFile(path.resolve(args.facing), 'utf8'));
  if (identitiesDoc.recordingId !== args['recording-id'] || identitiesDoc.sessionId !== args['session-id']) throw new Error('identity source is for another recording/session');
  if (geometryDoc.ok !== true || !Array.isArray(geometryDoc.geometry?.coords)) throw new Error('geometry source lacks a validated native geometry table');
  const facingOrigin = Number.isFinite(Number(facingDoc.startedAt)) ? Number(facingDoc.startedAt) : Date.parse(facingDoc.startedAt);
  if (facingDoc.recordingId !== args['recording-id'] || facingOrigin !== Date.parse(args['started-at'])) throw new Error('facing trace does not share the recording clock');
  const recovered = recoverPrepVisualEvents(events, { recordingId: args['recording-id'], recordingStartedAt: args['started-at'] });
  const result = buildLegacyPrepVisualState({ recovered, identities: identitiesDoc.identities, geometry: geometryDoc.geometry,
    facingSamples: facingDoc.samples, recordingId: args['recording-id'], sessionId: args['session-id'], recordingStartedAt: args['started-at'],
    viewport: geometryDoc.geometry.canvas || { width: 2187, height: 1077 } });
  result.sources = { events: path.resolve(args.events), identities: path.resolve(args.identities), geometry: path.resolve(args.geometry),
    facing: path.resolve(args.facing) };
  const output = path.resolve(args.output);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(output, JSON.stringify(result));
  console.log(JSON.stringify({ output, coverage: result.coverage, unresolvedExamples: result.unresolved.slice(0, 8) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.stack || String(error)); process.exitCode = 1; });
}
