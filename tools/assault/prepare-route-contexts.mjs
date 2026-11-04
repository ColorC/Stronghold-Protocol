import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeployMap, FIELD } from '../../server/match/board.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = name => JSON.parse(fs.readFileSync(path.join(root, `data/${name}.json`), 'utf8'));
const stages = load('stages'), waves = load('waves'), enemies = load('enemies'), bosses = load('bosses');
const out = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/assault/route-context.json';
const data = {
  schema: 'assault-route-source-context/v1', sourceRoot: root,
  field: FIELD, bossCoordinateMap: { rowOffset: -7, mirrorRightColumn: 20 },
  stages: Object.entries(stages).map(([id, s]) => ({
    id, name: s.name, active: s.active, size: s.size, rows: s.rows, tiles: s.tiles,
    devices: s.devices, sourceRef: { file: path.join(root, 'data/stages.json'), pointer: `/${id}` },
    legalTiles: Object.fromEntries(['normal', 'bossL'].map(field => [field, Object.fromEntries(buildDeployMap(s, { field }))])),
  })),
  waves: Object.entries(waves).map(([id, w]) => ({ id, kind: w.kind, solo: w.solo, bossId: w.bossId,
    routes: w.routes, extraRoutes: w.extraRoutes, spawns: w.spawns, overrides: w.overrides, devices: w.devices,
    sourceRef: { file: path.join(root, 'data/waves.json'), pointer: `/${id}` },
  })),
  enemies: Object.entries(enemies).map(([key, e]) => ({ key, name: e.name, stats: e.stats,
    abilities: e.abilities, talents: e.talents, skills: e.skills, sourceRef: { file: path.join(root, 'data/enemies.json'), pointer: `/${key}` } })),
  bosses: Object.values(bosses),
  note: 'Exact source data and native legal tile computation only. No battle run, no inferred wave/scene association. Alliance devices require explicit review before installation.',
};
fs.writeFileSync(out, JSON.stringify(data));
console.log(JSON.stringify({ file: out, purpose: 'compact source context with native deployment legality', bytes: fs.statSync(out).size, stages: data.stages.length, waves: data.waves.length, enemies: data.enemies.length, bosses: data.bosses.length }));
