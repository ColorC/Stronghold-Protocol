import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultFieldRoutes, buildAssaultBattleInput } from '../../shared/assault/battle-input.js';
import { Grid } from '../../server/sim/grid.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource } from '../../server/sim/simdata.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { GEO } from '../../shared/constants.js';
import { pendingDeployments } from '../../public/js/assault/client-sim.js';

const loaded = getAssaultData(), design = loadAssaultDesign();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preparedFor = (encounter, pieces = []) => prepareAssaultBattle({ seed: 20261010, life: 1000,
  day: 1, hour: 1, pieces, nextBattleEffects: [] }, encounter, { ...loaded, design });

test('opposite-side native entrances in existing solo prepared saves project to same-row native gates', () => {
  const encounter = design.encounters.encounters[0], prepared = preparedFor(encounter);
  const stale = [{ motion: 'WALK', start: [9, 18], end: [9, 2], checkpoints: [] },
    { motion: 'WALK', start: [12, 18], end: [9, 2], checkpoints: [] }];
  const projected = assaultFieldRoutes(stale, prepared.field.stage, 'normal');
  assert.deepEqual(projected.map((r) => r.start), [[9, 10], [12, 10]]);
  assert.deepEqual(stale.map((r) => r.start), [[9, 18], [12, 18]], 'saved source remains unchanged');
  const grid = new Grid(prepared.field.stage, GEO.NORMAL_RECT);
  assert.ok(projected.every((r) => grid.tile(...r.start).special === 'start'));
  assert.ok(projected.every((r) => grid.findPath(...r.start, ...r.end)?.length > 8), 'native path detours around the wall');
  assert.throws(() => assaultFieldRoutes(stale, prepared.field.stage, 'bossL'), /outside its native field/);
  assert.throws(() => assaultFieldRoutes([{ ...stale[0], checkpoints: [[9, 18]] }], prepared.field.stage, 'normal'), /checkpoint.*outside/);
});

test('all used native ground routes of all 36 encounters avoid forbidden terrain in actual simulator movement', () => {
  let checked = 0;
  for (const encounter of design.encounters.encounters) {
    const input = buildAssaultBattleInput(preparedFor(encounter), { ...loaded, kits: assaultKits });
    for (const [i, route] of input.battle.routes.entries()) {
      const spawn = input.spawnSpecs.find((s) => s.routeIndex === i);
      if (!spawn) continue;
      const data = new DataSource(input.data);
      if (data.getEnemy(spawn.enemyKey).motion === 'FLY') continue;
      const battle = new Battle({ ...input.battle, timeLimit: Infinity, autoFinish: false,
        data, players: [], spawns: [], content: 'none' });
      const enemy = battle.spawnEnemy(spawn.enemyKey, { routeIndex: i, mods: spawn.mods });
      assert.deepEqual([enemy.spawnY, enemy.spawnX], route.start, `${encounter.id}: native entrance was not clamped`);
      for (let n = 0; n < 3600 && enemy.alive; n++) {
        battle.step();
        if (enemy.hidden) continue;
        const row = Math.round(enemy.y), col = Math.round(enemy.x);
        assert.equal(battle.grid.tile(row, col).pass, 'ALL', `${encounter.id}/${i}: walked into ${row},${col}`);
      }
      checked++;
    }
  }
  assert.equal(checked, 132);
});

test('native ally death retains its down entry and redeploys the same unit after its actual timer', () => {
  const piece = { uid: 'lifecycle-regression', charId: 'char_127_estell', star: 1, sourceCopies: 1,
    row: 12, col: 4, dir: 'RIGHT', permanentFlat: {}, permanentPercent: {}, moduleChoices: {}, summonPresets: [] };
  const prepared = preparedFor(design.encounters.encounters[0], [piece]);
  const battle = createAssaultBattle(prepared, { ...loaded, design, kits: assaultKits });
  battle.autoFinish = false; battle.timeLimit = Infinity; battle._pending = [];
  battle.start(); const ally = battle.allyUnits.find((u) => u.uid === piece.uid);
  assert.equal(ally.alive, true); battle.drainEvents(); battle.kill(ally);
  assert.ok(battle.drainEvents().some((e) => e[0] === 'die' && e[1] === ally.id && e[2] === 'killed'));
  const until = ally.respawnAt;
  while (battle.time < until - battle.dt) {
    battle.step();
    assert.ok(battle.snapshot().down?.some((d) => d[0] === ally.id), 'a dead operator stays represented after its death animation');
  }
  while (battle.time < until + .1) battle.step();
  assert.equal(ally.alive, true); assert.equal(ally.deployed, true);
  assert.ok(battle.snapshot().units.some((u) => u[0] === ally.id));
  assert.ok(battle.drainEvents().some((e) => e[0] === 'deploy' && e[1] === ally.id));
});

test('ordinary route checker rejects the actual former opposite-side entrance while accepting solo design', () => {
  const positive = spawnSync(process.execPath, ['tools/assault/check-route-design.mjs', '--encounters'],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  const invalid = structuredClone(design.encounters); invalid.encounters[0].wave.routes[2].start = [9, 18];
  const canonical = path.resolve(root, '../../..');
  const fixturePath = path.join(canonical, '.omni/tmp/assault/invalid-solo-route-regression.json');
  fs.writeFileSync(fixturePath, JSON.stringify(invalid));
  const negative = spawnSync(process.execPath, ['tools/assault/check-route-design.mjs', '--encounters', '--encounters-file', fixturePath],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(negative.status, 1);
  assert.match(negative.stdout, /9,18 is outside normal simulation field/);
});

test('the opening entry is free: no pending formation marker even with zero DP; a real death uses native down', () => {
  const piece = { uid: 'pending-regression', charId: 'char_127_estell', star: 1, sourceCopies: 1,
    row: 12, col: 4, dir: 'RIGHT', permanentFlat: {}, permanentPercent: {}, moduleChoices: {}, summonPresets: [] };
  const encounter = structuredClone(design.encounters.encounters[0]); encounter.wave.dp = { init: 0, perSec: 2, max: 160 };
  const battle = createAssaultBattle(preparedFor(encounter, [piece]), { ...loaded, design, kits: assaultKits });
  battle.autoFinish = false; battle.timeLimit = Infinity; battle._pending = []; battle.start();
  const ally = battle.allyUnits.find((u) => u.uid === piece.uid), session = { battle };
  assert.ok(ally.deploySeq > 0); assert.equal(ally.deployed, true); assert.equal(battle.isDown(ally), false);
  assert.deepEqual(pendingDeployments(session), [], 'nobody waits for DP at battle start');
  assert.equal(battle.getPlayer(ally.ownerId).dp, 0, 'the opening entry cost nothing');
  assert.equal(battle.snapshot().units.some((u) => u[0] === ally.id), true, 'the opening unit is a fighting unit at t=0');
  battle.kill(ally); assert.ok(battle.isDown(ally)); assert.deepEqual(pendingDeployments(session), []);
});
