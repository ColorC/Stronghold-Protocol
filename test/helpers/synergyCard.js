// test/helpers/synergyCard.js — battles of real compiled synergy cards (design of 2026-10-21) for card tests.
//
//   import { synergyBattle } from '../helpers/synergyCard.js';
//   const h = synergyBattle([{ charId: 'char_172_svrash', row: 9, col: 3 }, { charId: 'char_2024_chyue', row: 9, col: 4 }]);
//   const [svrash, chyue] = h.units;
//   const e = h.spawn([9, 5]);           // a sturdy standing enemy (猎狗pro ×100 HP, speed 0) at row/col
//   h.castNow(svrash); h.flush();
//   assert.equal(h.param(svrash, 2, 'a'), 2);   // the card's own number at the unit's star
//
// The battle is the production one: prepareAssaultBattle + createAssaultBattle with the full kit registry and the
// compiled runtime (ASSAULT_RUNTIME_PATH, else data/assault-runtime.json), relics included. Entry options: row, col,
// star (default 4), moduleId, piece (extra piece fields, e.g. permanentCounters); battle options: seed, beforeStart(battle).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { cardParam, cardLine } from '../../server/sim/content/assault/card-lines.js';
import { loadAssaultRuntime } from './assaultRuntime.js';

const data = getAssaultData({ runtime: loadAssaultRuntime() });
export const runtime = data.runtime;
const design = loadAssaultDesign();

export const STURDY = 'enemy_1000_gopro_2';
export const FLYER = 'enemy_1005_yokai';

/** `quiet` pushes the encounter's scheduled spawns past the battle time limit: the encounter only lends its map, so timing tests run against the enemies they spawn themselves (an empty schedule would end the battle at once). */
export function synergyBattle(entries, { seed = 7100, beforeStart = null, quiet = false } = {}) {
  const pieces = entries.map(({ charId, row = 9, col = 2, star = 4, moduleId = null, uid = `t:${charId}:${row}:${col}`, piece: extra = {} }) => {
    const body = runtime.bodies[charId];
    assert.ok(body, `${charId} is a compiled body`);
    return { uid, charId, purchaseCharId: body.purchaseCharId, star, fixedSkill: body.fixedSkill, sourceCopies: 2 ** (star - 1),
      moduleChoices: { [charId]: moduleId }, moduleId, row, col, dir: 'RIGHT', permanentFlat: {}, permanentPercent: {},
      tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [], ...extra };
  });
  const state = { seed, life: 20, day: 1, hour: 1, pieces, nextBattleEffects: [] };
  const context = { ...data, design };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((e) => e.kind === 'normal'), context);
  const battle = createAssaultBattle(prepared, { ...context, kits: assaultKits });
  // every piece enters at the start (the wave's opening DP would hold later ones back)
  battle.flags.dpMax = Math.max(battle.flags.dpMax, 999);
  for (const player of battle.players) battle.getPlayer(player.playerId).dp = 999;
  beforeStart?.(battle);
  if (quiet) for (const spawn of battle._pending) spawn.time += 1000;
  battle.start();
  battle.assaultRuntime.flush();
  battle._buildEnemyIndex();
  const units = pieces.map((piece) => battle.allyUnits.find((u) => u.uid === piece.uid));
  for (const [i, u] of units.entries()) assert.ok(u?.deployed, `${entries[i].charId} deployed at ${entries[i].row},${entries[i].col}: ${JSON.stringify(battle.allyUnits.map((x) => [x.uid, x.kind, x.tileR, x.tileC, x.deployed]))}`);
  const flush = () => battle.assaultRuntime.flush();
  const h = {
    battle, units, flush,
    step: (n = 1) => { for (let i = 0; i < n; i++) battle.step(); flush(); },
    run: (seconds) => { const n = Math.round(seconds / battle.dt); for (let i = 0; i < n; i++) battle.step(); flush(); },
    /** A standing enemy at [row, col] (mods default: ×100 HP, speed 0). */
    spawn: (pos, { key = STURDY, mods = { hpMul: 100, speedMul: 0 } } = {}) => {
      const e = battle.spawnEnemy(key, { routeIndex: 0, pos, mods });
      battle._buildEnemyIndex();
      return e;
    },
    /** A tile of the unit's attack range inside the field: the farthest one (or the nearest with { nearest: true }). */
    rangeTile: (unit, { nearest = false } = {}) => {
      const tiles = [...unit.rangeKeys].map((k) => [Math.floor(k / 21), k % 21]).filter(([r, c]) => battle.grid.inRect(r, c) && !(r === unit.tileR && c === unit.tileC))
        .sort((a, b) => (Math.abs(a[0] - unit.tileR) + Math.abs(a[1] - unit.tileC)) - (Math.abs(b[0] - unit.tileR) + Math.abs(b[1] - unit.tileC)));
      assert.ok(tiles.length, 'the unit has a range tile in the field');
      return nearest ? tiles[0] : tiles.at(-1);
    },
    /** Cast the unit's skill now through the real assault cast (full SP, one charge). */
    castNow: (unit) => { unit.skill.charges = Math.max(1, unit.skill.charges ?? 0); unit.skill.sp = unit.skill.spCost; const ok = battle.assaultRuntime.cast(unit, { force: true }); flush(); return ok; },
    spOf: (unit) => unit.skill.sp + (unit.skill.charges ?? 0) * unit.skill.spCost,
    /** The SP total with charges cleared, so a gain is visible (the skill does not fire by itself: SP type none). */
    hold: (unit) => { unit.skill.spType = 'none'; unit.skill.charges = 0; unit.skill.sp = 0; },
    param: (unit, index, key) => cardParam(unit, index, key),
    line: (unit, index) => cardLine(unit, index),
    text: (charId, index, star = 4) => runtimeText(charId, index, star),
  };
  return h;
}

/** The card text the player reads (compiled public text) of line `index` (or a module id) at `star`. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicTextPath = process.env.ASSAULT_PUBLIC_TEXT_PATH && path.isAbsolute(process.env.ASSAULT_PUBLIC_TEXT_PATH)
  ? process.env.ASSAULT_PUBLIC_TEXT_PATH : path.join(root, 'data/assault-public-text.json');
let publicText = null;
export function runtimeText(charId, index, star = 4) {
  publicText ??= JSON.parse(fs.readFileSync(publicTextPath, 'utf8'));
  const card = publicText.operators[charId]?.card;
  if (typeof index === 'string') return card?.modules?.[index]?.line?.textByStar?.[star - 1] ?? null;
  return card?.lines?.[index]?.textByStar?.[star - 1] ?? null;
}
