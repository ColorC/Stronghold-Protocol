import test from 'node:test';
import assert from 'node:assert/strict';

import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { AURA } from '../../server/sim/content/kits/shared/tier4.js';
import { COLS } from '../../server/sim/constants.js';

const data = getAssaultData(), design = loadAssaultDesign();
const runtime = data.runtime;
const ranks = [1, 2, 3, 4];
const expectedTide = { regenPerSec: [0, 0, 0.015, 0.025], seaMonsterReduction: [0, 0, 0.15, 0.25] };
const expectedHunger = { weightThreshold: 3, atkScale: [1.3, 1.3, 1.3, 1.3] };

function fixture(star, allowAttack = false) {
  const allies = ['char_263_skadi', 'char_356_broca'];
  const ids = ['char_474_glady', ...allies];
  const pieces = ids.map((id, i) => {
    const body = data.runtime.bodies[id];
    return { uid: `gladiia-retained:${star}:${i}:${id}`, charId: id, purchaseCharId: body.purchaseCharId,
      star, row: 10, col: [4, 8, 6][i], dir: i === 2 ? 'LEFT' : 'RIGHT', sourceCopies: 1, moduleId: null, moduleChoices: { [id]: null },
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  });
  const encounter = design.encounters.encounters.find(e => e.id === 'enc_band5_normal_a1m06');
  assert(encounter, 'the declared native normal encounter is present');
  const prepared = prepareAssaultBattle({ seed: 48100 + star, life: 20, day: 1, hour: 1, pieces, nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.start(); battle.assaultRuntime.flush();
  const units = pieces.map(p => battle.allyUnits.find(u => u.uid === p.uid));
  for (const u of units) {
    assert(u.alive && u.deployed, 'every source fixture is legally deployed by the native engine');
    battle.addBuff(u, { key: `fixture:no-skill:${u.uid}`, flags: { noSp: true, disarm: !allowAttack }, duration: 30 });
  }
  return { battle, owner: units[0], abyssal: units[1], ordinary: units[2], units };
}

function tick(battle, seconds) {
  const until = battle.time + seconds;
  for (let i = 0; i < 1200 && battle.time < until; i++) battle.step();
  assert(battle.time >= until, 'native Battle clock reached the requested time');
}

function spawn(battle, key, pos, routeIndex) {
  assert(battle.grid.groundPassable(pos[0], pos[1]), 'enemy fixture uses native passable ground');
  const e = battle.spawnEnemy(key, { routeIndex, pos, mods: { hpMul: 1000, speed: 0 } });
  battle.applyStatus(e, 'stun', { duration: 30 }); battle._buildEnemyIndex();
  return e;
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
