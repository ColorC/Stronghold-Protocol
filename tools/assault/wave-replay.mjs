#!/usr/bin/env node
// Winnability replay for the assault encounter waves: fixed lineups fight every encounter of an
// encounters.json, so two wave versions can be compared on the same operators, stars and
// deterministic placement.
//
//   node tools/assault/wave-replay.mjs [--encounters <abs>] [--out <abs.json>]
//
// Three lineups x two star levels per encounter. One deterministic fight can flip on a small change
// of spawn order, so only the group rates over all six runs are meaningful. The lineups stand for a
// plain run (no upgrades, relics or enchantments); the numbers only compare wave versions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { loadAssaultDesign } from '../../server/modes/assault/data.js';
import { createAssaultBattle, runAssaultBattle } from '../../server/modes/assault/battle.js';
import { createRun } from '../../shared/assault/run.js';
import { pieceFromBody } from '../../shared/assault/inventory.js';
import { assaultNativeDirection } from '../../shared/assault/battle-input.js';
import { boardTileOf, ownerRangeKeys } from '../../server/match/board.js';
import { bandOf } from './wave-pacing.mjs';

// Lineup order = deployment priority; a band fields the first N (N = its population cap).
export const REPLAY_LINEUPS = Object.freeze({
  A: ['char_102_texas', 'char_202_demkni', 'char_204_platnm', 'char_181_flower', 'char_143_ghost',
    'char_306_leizi', 'char_136_hsguma', 'char_126_shotst', 'char_151_myrtle', 'char_002_amiya'],
  B: ['char_151_myrtle', 'char_136_hsguma', 'char_126_shotst', 'char_128_plosis', 'char_155_tiger',
    'char_002_amiya', 'char_199_yak', 'char_204_platnm', 'char_102_texas', 'char_306_leizi'],
  C: ['char_240_wyvern', 'char_107_liskam', 'char_235_jesica', 'char_002_amiya', 'char_108_silent',
    'char_294_ayer', 'char_190_clour', 'char_469_indigo', 'char_150_snakek', 'char_204_platnm'],
});
// Days 1-2, 3-4, 5-6, 7-8, 9-10, finals.
export const REPLAY_POPULATION = Object.freeze([4, 6, 7, 8, 9, 10]);
export const REPLAY_STARS = Object.freeze({ med: [1, 2, 2, 3, 3, 3], strong: [2, 3, 3, 4, 4, 4] });

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function routeSamples(ctx, state, encounter) {
  const battle = createAssaultBattle(ctx.prepareBattle(state, encounter), ctx);
  battle.start();
  const field = ctx.fieldFor(state).field;
  const clamp = ([r, c]) => [Math.max(battle.rect.r0, Math.min(battle.rect.r1, Math.round(r))),
    Math.max(battle.rect.c0, Math.min(battle.rect.c1, Math.round(c)))];
  const samples = [];
  battle.routes.forEach((route, routeIndex) => {
    const spawns = encounter.wave.spawns.filter((spawn) => (spawn.routeIndex ?? 0) === routeIndex);
    if (!spawns.length) return;
    const flight = route.motion === 'FLY' || spawns.some((spawn) => ctx.nativeData.enemies[spawn.key]?.stats?.motion === 'FLY');
    const pressure = spawns.reduce((sum, spawn) => sum + spawn.count, 0);
    let prior = clamp(route.start);
    const push = (tiles) => { for (const tile of tiles) { const [row, col] = boardTileOf(field, ...clamp(tile)); samples.push({ row, col, flight, pressure }); } };
    push([prior]);
    const goals = [...(route.checkpoints ?? []).map((c) => (Array.isArray(c) ? { type: 'MOVE', pos: c } : c))
      .filter((c) => ['MOVE', 'APPEAR'].includes(String(c.type ?? 'MOVE').toUpperCase())), { type: 'MOVE', pos: route.end }];
    for (const goal of goals) {
      const target = clamp(goal.pos);
      const segment = String(goal.type).toUpperCase() === 'APPEAR' || flight ? [target]
        : (battle.grid.findPath(prior[0], prior[1], target[0], target[1]) ?? [target]);
      push(segment);
      prior = target;
    }
  });
  return samples;
}

function place(ctx, state, encounter, pieces) {
  const samples = routeSamples(ctx, state, encounter);
  const used = new Set();
  const isBlocker = (body) => body.position === 'MELEE' && Number(body.baseStats?.blockCnt ?? 0) > 0;
  const order = [...pieces].sort((a, b) => Number(isBlocker(ctx.runtime.bodies[b.charId])) - Number(isBlocker(ctx.runtime.bodies[a.charId]))
    || Number(ctx.runtime.bodies[a.charId].profession === 'MEDIC') - Number(ctx.runtime.bodies[b.charId].profession === 'MEDIC'));
  for (const piece of order) {
    const body = ctx.runtime.bodies[piece.charId];
    const medic = body.profession === 'MEDIC';
    let best = null;
    for (const key of ctx.fieldFor(state).normalizedDeployMap.keys()) {
      const [row, col] = key.split(',').map(Number);
      if (used.has(key) || !ctx.canPlace(state, piece, row, col)) continue;
      for (const dir of ['E', 'N', 'W', 'S']) {
        const range = ownerRangeKeys(body.range ?? body.simChess?.rangeGrid, row, col, assaultNativeDirection(dir));
        let score = 0;
        if (medic) score = state.pieces.filter((other) => other.row != null && range.has(`${other.row},${other.col}`)).length * 40;
        else for (const sample of samples) if ((!sample.flight || body.position === 'RANGED') && range.has(`${sample.row},${sample.col}`)) score += sample.pressure * (sample.flight ? 4 : 1);
        if (isBlocker(body)) score += samples.filter((s) => !s.flight && s.row === row && s.col === col).reduce((sum, s) => sum + 4 * s.pressure, 0);
        if (!best || score > best.score) best = { row, col, dir, score };
      }
    }
    if (!best) continue;
    Object.assign(piece, { row: best.row, col: best.col, dir: best.dir });
    used.add(`${best.row},${best.col}`);
  }
}

export function replayEncounter(ctx, encounter, lineup, level) {
  const band = encounter.kind === 'final' ? 5 : bandOf(encounter);
  const state = createRun({ runId: `wave-replay-${encounter.id}`, seed: 20261021, directorId: ctx.design.system.directors[0].id }, ctx);
  state.day = encounter.dayRange[0];
  state.hour = encounter.kind === 'final' ? 6 : 3;
  state.xp = ctx.design.system.run.xpThresholds[Math.max(0, REPLAY_POPULATION[band] - 3)] ?? 0;
  state.prepEncounterId = encounter.id;
  state.currentNode = { id: encounter.id, kind: 'battle', encounterId: encounter.id, battleKind: encounter.kind,
    name: encounter.name, rewards: encounter.rewards, boardRegion: encounter.boardRegion, stageId: encounter.stageId };
  state.phase = 'battlePrep';
  state.pieces = [];
  state.pieces = REPLAY_LINEUPS[lineup].slice(0, REPLAY_POPULATION[band])
    .map((charId) => pieceFromBody(state, ctx, charId, 1, { star: REPLAY_STARS[level][band] }));
  place(ctx, state, encounter, state.pieces);
  const result = runAssaultBattle(ctx.prepareBattle(state, encounter), ctx);
  return { id: encounter.id, lineup, level, kind: encounter.kind, band: band + 1, placed: state.pieces.filter((p) => p.row != null).length,
    won: result.won === true, remainingLife: result.remainingLife, leaked: result.leakedLife,
    bossHpLeft: result.bossHpLeft, killed: Number(result.stats?.killed ?? 0), total: Number(result.stats?.total ?? 0),
    reason: result.reason, durationSec: Math.round(Number(result.durationSec ?? 0)) };
}

export function replayDesign(doc) {
  const design = { ...loadAssaultDesign(), encounters: doc };
  const ctx = createAssaultContext({ design });
  return doc.encounters.flatMap((encounter) => Object.keys(REPLAY_STARS).flatMap((level) =>
    Object.keys(REPLAY_LINEUPS).map((lineup) => replayEncounter(ctx, encounter, lineup, level))));
}

const rate = (list) => ({ runs: list.length, wins: list.filter((r) => r.won).length,
  winRate: Math.round(1000 * list.filter((r) => r.won).length / list.length) / 1000,
  meanLife: Math.round(list.reduce((s, r) => s + r.remainingLife, 0) / list.length * 10) / 10 });

export function summarize(rows) {
  const groups = new Map();
  for (const row of rows) for (const k of [`${row.kind}/band${row.band}`, `${row.kind}/band${row.band}/${row.level}`]) {
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return { groups: [...groups].map(([group, list]) => ({ group, ...rate(list) })),
    levels: Object.keys(REPLAY_STARS).map((level) => ({ level, ...rate(rows.filter((r) => r.level === level)) })),
    total: rate(rows) };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const file = argValue('--encounters') ?? path.join(root, 'data/assault-design/encounters.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = replayDesign(doc);
  for (const row of rows) console.log(`${row.id.padEnd(24)} ${row.lineup}/${row.level.padEnd(6)} ${row.kind.padEnd(6)} band${row.band} placed=${row.placed} won=${row.won ? 1 : 0} life=${row.remainingLife} leaked=${row.leaked} killed=${row.killed}/${row.total} ${row.reason}@${row.durationSec}s${row.bossHpLeft != null ? ` bossHp=${Math.round(row.bossHpLeft)}` : ''}`);
  const summary = summarize(rows);
  for (const line of [...summary.groups, ...summary.levels, summary.total]) console.log(JSON.stringify(line));
  const out = argValue('--out');
  if (out) fs.writeFileSync(out, `${JSON.stringify({ schema: 'assault-wave-replay/v2', source: file, lineups: REPLAY_LINEUPS, stars: REPLAY_STARS, rows, summary }, null, 1)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
