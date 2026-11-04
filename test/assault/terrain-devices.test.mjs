// Assault battle fields must install the stage floor / device mechanics (server/sim/content/devices.js):
// 活性源石, 沼泽, 烟雾, 深水 and 气流 are part of the field design (docs/assault-mode/design.md §地图: "属于格子、
// 机关或敌人机制的效果保留"), but the assault content path used to install only the enemies/bosses modules, so no
// floor ever did anything (10-22 player report: "源石活性地板（流血加攻）什么的不奏效了").
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';

const loaded = getAssaultData({runtime:loadAssaultRuntime()}), design = loadAssaultDesign();
const encounter = (id) => design.encounters.encounters.find((e) => e.id === id);
const piece = (uid, charId, row, col, dir, star = 2) => ({ uid, charId, star, sourceCopies: 1,
  row, col, dir, permanentFlat: {}, permanentPercent: {}, moduleChoices: {}, summonPresets: [] });
const battleFor = (encId, pieces) => {
  const prepared = prepareAssaultBattle({ seed: 20261022, life: 1000, day: 1, hour: 1, pieces, nextBattleEffects: [] },
    encounter(encId), { ...loaded, design });
  const battle = createAssaultBattle(prepared, { ...loaded, design, kits: assaultKits });
  battle.start();
  battle.drainEvents();
  return battle;
};
const run = (battle, seconds) => {
  for (let i = 0, n = Math.ceil(seconds / battle.dt); i < n && !battle.finished; i++) { battle.step(); battle.drainEvents(); }
};
const operator = (battle, uid) => battle.allyUnits.find((u) => u.uid === uid);

test('活性源石: the operator on it gains ATK/ASPD and bleeds true damage; the in-place 再部署 keeps the effect', () => {
  const battle = battleFor('enc_band1_risk_m04', [piece('inf-op', 'char_127_estell', 10, 6, 'N')]);
  const unit = operator(battle, 'inf-op');
  assert.equal(battle.grid.tile(10, 6).terrain, 'infection');
  const buff = unit.findBuff('terrain:infection');
  assert.ok(buff, 'operator deployed on 活性源石 carries its effect');
  assert.equal(buff.mods.atkPct, 0.2);
  assert.equal(buff.mods.aspd, 20);
  assert.ok(Math.abs(unit.s.atk / unit.base.atk - 1.2) < 0.02, `ATK +20 % (base ${unit.base.atk}, now ${unit.s.atk})`);
  assert.equal(Math.round(unit.s.aspd), Math.round(unit.base.aspd + 20));
  // 流血: 70 true damage per second (stage special infection.bb.damage), no other damage source this early
  const maxHp = unit.s.maxHp;
  run(battle, 2);
  const hpAt2 = unit.hp;
  run(battle, 2);
  const loss = hpAt2 - unit.hp;
  assert.ok(loss > 100 && loss < 180, `two more seconds on the tile bleed ~140 HP, lost ${Math.round(loss)}`);
  assert.ok(unit.hp < maxHp, 'the tile costs HP before the cycle');
  // the in-place 再部署 refills HP but keeps the floor effect and its per-second bleed
  assert.equal(cycleRedeploy(battle, unit), true, 'an in-place redeployment succeeds');
  battle.drainEvents();
  assert.equal(unit.assaultCycle.count, 1);
  assert.equal(unit.hp, unit.s.maxHp, 'the cycle refilled HP');
  assert.ok(unit.findBuff('terrain:infection'), 'the floor effect survives the in-place 再部署');
  run(battle, 3);
  assert.ok(unit.hp < unit.s.maxHp, 'the bleed resumes right after the refill');
});

test('活性源石: enemies walking over it carry the lasting effect (damage + ATK after leaving the tile)', () => {
  const battle = battleFor('enc_band1_risk_m04', [piece('inf-watch', 'char_150_snakek', 10, 6, 'N')]);
  const infected = new Set();
  for (let i = 0, n = Math.ceil(50 / battle.dt); i < n && !battle.finished; i++) {
    battle.step(); battle.drainEvents();
    for (const e of battle.enemies) if (e.alive && e.findBuff('terrain:infection')) infected.add(e.id);
  }
  assert.ok(infected.size > 0, 'at least one enemy picked up the 活性源石 effect crossing the tiles');
});

test('沼泽: the operator on it loses attack speed and enemies in it gain slow stacks', () => {
  const battle = battleFor('enc_band1_risk_a2m02', [piece('mire-op', 'char_127_estell', 10, 7, 'N')]);
  const unit = operator(battle, 'mire-op');
  assert.equal(battle.grid.tile(10, 7).terrain, 'mire');
  run(battle, 3);
  assert.ok(unit.findBuff('terrain:mire'), 'operator in the mire carries its debuff');
  assert.ok(unit.s.aspd < unit.base.aspd, `ASPD dropped (base ${unit.base.aspd}, now ${unit.s.aspd})`);
  const slowed = new Set();
  for (let i = 0, n = Math.ceil(45 / battle.dt); i < n && !battle.finished; i++) {
    battle.step(); battle.drainEvents();
    for (const e of battle.enemies) if (e.alive && e.findBuff('terrain:mire')) slowed.add(e.id);
  }
  assert.ok(slowed.size > 0, 'at least one enemy gained mire stacks');
});

test('烟雾: the operator on it is hidden from enemy ranged targeting', () => {
  const battle = battleFor('enc_band2_normal_a2m03', [piece('smog-op', 'char_127_estell', 10, 6, 'N')]);
  const unit = operator(battle, 'smog-op');
  assert.equal(battle.grid.tile(10, 6).terrain, 'smog');
  assert.ok(unit.findBuff('terrain:smog'), 'operator in the smoke carries its effect');
  assert.equal(unit.s.flags.stealth, true, 'the operator is stealthed while in the smoke');
});

test('深水: ground enemies crossing the water take its true damage over time', () => {
  const battle = battleFor('enc_band2_normal_a2m04', []);
  let wet = null, wetHp = null, wetSince = 0, wetHpLater = null;
  for (let i = 0, n = Math.ceil(90 / battle.dt); i < n && !battle.finished && wetHpLater == null; i++) {
    battle.step(); battle.drainEvents();
    if (!wet?.alive || !wet?.findBuff('terrain:deepsea')) {
      wet = battle.enemies.find((e) => e.alive && e.findBuff('terrain:deepsea') && !e.blockedBy) ?? null;
      if (wet) { wetHp = wet.hp; wetSince = battle.time; }
    } else if (!wet.blockedBy && battle.time - wetSince > 1) {
      wetHpLater = wet.hp;
    }
  }
  assert.ok(wet, 'at least one ground enemy entered the deep water');
  assert.ok(wetHpLater != null, 'an enemy stayed in the water long enough to measure');
  assert.ok(wetHpLater < wetHp, `the water burns (HP ${Math.round(wetHp)} → ${Math.round(wetHpLater)})`);
});

test('气流: an operator facing with the flow gains ATK, facing against it loses ATK', () => {
  const battle = battleFor('enc_band1_risk_a2m01', [
    piece('flow-with', 'char_127_estell', 10, 5, 'S'),
    piece('flow-against', 'char_136_hsguma', 10, 9, 'N'),
  ]);
  const withFlow = operator(battle, 'flow-with'), against = operator(battle, 'flow-against');
  assert.ok(withFlow.findBuff('terrain:airflow'), 'operator in the airflow carries its effect');
  assert.ok(Math.abs(withFlow.s.atk / withFlow.base.atk - 1.3) < 0.02,
    `with the flow: ATK +30 % (base ${withFlow.base.atk}, now ${withFlow.s.atk})`);
  assert.ok(against.findBuff('terrain:airflow'), 'operator against the airflow carries its effect');
  assert.ok(Math.abs(against.s.atk / against.base.atk - 0.7) < 0.02,
    `against the flow: ATK −30 % (base ${against.base.atk}, now ${against.s.atk})`);
});
