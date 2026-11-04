// 进击大巴扎改写（assault 族）：卡面扳机与运行时一致的因果测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { latestOperatorKits } from '../../server/sim/content/assault/cards/latest-operators.js';
import { assaultKits as allKits } from '../../server/sim/content/assault/cards/registry.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { applyStatus } from '../../server/sim/content/assault/primitives.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';

// The worktree runtime carries the compiled body.bazaar numbers (ASSAULT_RUNTIME_PATH).
const assaultData = getAssaultData({ runtime: loadAssaultRuntime() });
const { runtime } = assaultData;
const pieceFor = (body, star = 4, moduleId = null) => ({ uid: `test:${body.charId}`, charId: body.charId, star, fixedSkill: body.fixedSkill,
  sourceCopies: 1, moduleChoices: { [body.charId]: moduleId }, moduleId, permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [] });

function cardBattle(entries, seed = 4800, beforeStart = null, kits = { ...allKits }) {
  const design = loadAssaultDesign();
  const pieces = entries.map(({ charId, row = 9, col = 2, star = 4, moduleId = null }) => {
    const body = runtime.bodies[charId];
    return { ...pieceFor(body, star, moduleId), purchaseCharId: body.purchaseCharId, row, col, dir: 'RIGHT',
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  });
  const state = { seed, life: 20, day: 1, hour: 1, pieces, nextBattleEffects: [] };
  const data = { ...assaultData, design };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((encounter) => encounter.kind === 'normal'), data);
  const battle = createAssaultBattle(prepared, { ...data, kits });
  beforeStart?.(battle);
  battle.start(); battle.assaultRuntime.flush(); battle._buildEnemyIndex();
  const units = pieces.map((piece) => battle.allyUnits.find((unit) => unit.uid === piece.uid));
  for (const [i, unit] of units.entries()) assert.ok(unit?.deployed, `${entries[i].charId} deployed at ${entries[i].row},${entries[i].col}`);
  return { battle, units };
}
const settle = (battle) => battle.assaultRuntime.flush();
const spOf = (unit) => unit.skill.sp + (unit.skill.charges ?? 0) * unit.skill.spCost;
const castNow = (battle, unit) => { unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost; return battle.assaultRuntime.cast(unit, { force: true }); };
const bazaar = (charId) => runtime.bodies[charId].bazaar;

test('bazaar params are compiled into every assault-family body', () => {
  for (const charId of ['char_4048_doroth', 'char_1033_swire2', 'char_393_toledo', 'char_4232_hbound', 'char_4231_clemnt']) {
    assert.ok(Array.isArray(bazaar(charId)?.lines), charId);
  }
  // 罗宾 is a synergy card now (design of 2026-10-21): test/assault/synergy-assault-2.test.mjs
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('银灰不再使用已撤回的寒冷充能连线', () => {
  const { battle, units: [svrash] } = cardBattle([{ charId: 'char_172_svrash', row: 9, col: 2 }], 4806);
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 6], mods: { hpMul: 100, speed: 0 } });
  svrash.skill.charges = 0; svrash.skill.sp = 0;
  const before = spOf(svrash);
  for (let i = 0; i < 12; i++) { applyStatus(battle, svrash, enemy, { status: 'cold', duration: 3, key: 'cold' }); settle(battle); }
  const gained = Math.min(spOf(svrash), svrash.skill.spCost * (svrash.skill.maxCharges ?? 1)) - before;
  assert.equal(gained, 0);
  assert.equal(svrash.mem.assaultBazaarCounts?.['svrash-cold'], undefined);
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
