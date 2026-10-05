#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playSeed } from './independent-balance.mjs';

const LIMIT_MS = 180_000;
const seed = 1;
const route = 'defense';
const difficulty = 'FUNNY';
const roundLimit = 9;

function parseOutputDirectory(argv) {
  const index = argv.indexOf('--output-directory');
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error('USAGE: node tools/independent-smoke.mjs --output-directory <absolute-path>');
  }
  const output = argv[index + 1];
  if (!isAbsolute(output)) throw new Error('--output-directory must be an absolute path');
  return resolve(output);
}

function rootCheck(root) {
  if (!existsSync(join(root, 'package.json')) || !existsSync(join(root, 'tools', 'independent.mjs'))) {
    throw new Error(`NOT_IN_INDEPENDENT_REPO_ROOT:${root}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const root = process.cwd();
  rootCheck(root);
  const outputBase = parseOutputDirectory(argv);
  const startedAt = Date.now();
  const remainingMs = () => LIMIT_MS - (Date.now() - startedAt);
  const ensureTime = () => { if (remainingMs() <= 0) throw new Error(`SMOKE_TIMEOUT_${LIMIT_MS}MS`); };

  const pilotA = playSeed({ seed, route, difficulty, roundLimit });
  ensureTime();
  const pilotB = playSeed({ seed, route, difficulty, roundLimit });
  ensureTime();
  assert.deepStrictEqual(pilotA.state, pilotB.state, 'repeated pilot final states differ');
  assert.deepStrictEqual(pilotA.actionLog, pilotB.actionLog, 'repeated pilot action logs differ');
  assert.equal(pilotA.completed, true, 'pilot did not win the nine-round run');
  assert.equal(pilotA.state.outcome, 'win', 'pilot outcome is not win');
  ensureTime();

  await mkdir(outputBase, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const runDir = join(outputBase, `seed-${seed}-${stamp}-${process.pid}`);
  await mkdir(runDir, { recursive: false });
  const file = join(runDir, 'session.json');
  const actionsFile = join(runDir, 'actions.json');
  const pilotFile = join(runDir, 'pilot-state.json');
  await writeFile(actionsFile, `${JSON.stringify({ actions: pilotA.actionLog }, null, 2)}\n`, { flag: 'wx' });
  await writeFile(pilotFile, `${JSON.stringify(pilotA.state, null, 2)}\n`, { flag: 'wx' });

  async function runCli(name, args) {
    ensureTime();
    let stdout = '';
    let stderr = '';
    let status = 0;
    try {
      stdout = execFileSync(process.execPath, [join(root, 'tools', 'independent.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: remainingMs(),
        maxBuffer: 128 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (error) {
      stdout = error.stdout?.toString?.() || '';
      stderr = error.stderr?.toString?.() || '';
      status = Number.isInteger(error.status) ? error.status : 1;
    }
    await writeFile(join(runDir, `${name}.stdout.log`), stdout, { flag: 'wx' });
    await writeFile(join(runDir, `${name}.stderr.log`), stderr, { flag: 'wx' });
    assert.equal(status, 0, `${name} CLI failed with status ${status}; see ${join(runDir, `${name}.stderr.log`)}`);
    return stdout;
  }

  await runCli('new', ['new', '--file', file, '--difficulty', difficulty, '--round-limit', String(roundLimit), '--seed', String(seed)]);
  const newState = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(newState.seed, seed);
  assert.equal(newState.difficulty, difficulty);
  await runCli('batch', ['batch', '--file', file, '--actions', actionsFile]);
  const finalState = JSON.parse(await readFile(file, 'utf8'));
  // The CLI persists JSON, so compare against the pilot's exact JSON round-trip.
  // This removes only non-serializable undefined object properties from Battle results.
  const persistedPilotState = JSON.parse(JSON.stringify(pilotA.state));
  assert.deepStrictEqual(finalState, persistedPilotState, 'CLI replay final state differs from pilot JSON state');
  assert.equal(finalState.outcome, 'win');
  assert.deepStrictEqual(JSON.parse(await readFile(pilotFile, 'utf8')), persistedPilotState);

  const report = {
    ok: true,
    seed,
    route,
    difficulty,
    roundLimit,
    outcome: finalState.outcome,
    rounds: pilotA.rounds,
    actions: pilotA.actions,
    runDirectory: runDir,
    files: {
      session: file,
      actions: actionsFile,
      pilotState: pilotFile,
      newStdout: join(runDir, 'new.stdout.log'),
      newStderr: join(runDir, 'new.stderr.log'),
      batchStdout: join(runDir, 'batch.stdout.log'),
      batchStderr: join(runDir, 'batch.stderr.log'),
    },
  };
  await writeFile(join(runDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
