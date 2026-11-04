import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { COLS } from '../../server/sim/constants.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(new URL('../../data/assault-coverage-assault-modules.json', import.meta.url), 'utf8'));
const normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
let seq = 0;

const mappings = [
  ['char_188_helage', 'fixedSkill:0', 'skchr_helage_3', '满月自然技力结算物理伤害与范围', 'damage', { atkScale: [0.9, 1], maxTarget: [3, 3], rangeExtend: [2, 2], damageType: ['物理', '物理'] }],
  ['char_188_helage', 'fixedSkill:1', 'skchr_helage_3', '满月结算后攻击力提升15秒', 'addBuff', { atkBonus: [0.7, 0.8], duration: [15, 15] }],
  ['char_188_helage', 'fixedSkill:2', 'skchr_helage_3', '施放时低于半血获得10秒攻速', 'haste', { attackSpeedBonus: [50, 60], duration: [10, 10] }],
  ['char_188_helage', 'modePassive:0', 'skchr_helage_3', '未阻挡时每秒回复生命', 'heal', { healPerSec: [60, 60] }],
  ['char_1014_nearl2', 'fixedSkill:0', 'skchr_nearl2_3', '自然技力召唤耀阳并维持25秒', 'summon', { summonName: ['耀阳', '耀阳'], summonCount: [1, 1], duration: [25, 25] }],
  ['char_1014_nearl2', 'fixedSkill:1', 'skchr_nearl2_3', '耀阳出现造成范围真实伤害', 'damage', { atkScale: [1.1, 1.1], radius: [1, 1], damageType: ['真实', '真实'] }],
  ['char_1014_nearl2', 'fixedSkill:2', 'skchr_nearl2_3', '耀阳命中施加3秒眩晕', 'applyStatus', { stunDuration: [3, 3] }],
  ['char_1014_nearl2', 'fixedSkill:3', 'skchr_nearl2_3', '耀阳结算后提升攻击防御范围与阻挡真伤25秒', 'addBuff', { atkBonus: [1.3, 1.4], defBonus: [1, 1], rangeExtend: [1, 1], blockedTrueDamage: [1, 1], duration: [25, 25] }],
  ['char_1014_nearl2', 'modePassive:0', 'skchr_nearl2_3', '部署时四邻真实伤害与卡西米尔追加命中', 'damage', { atkScale: [0.8, 0.8], radius: [1, 1], damageType: ['真实', '真实'], kazimierzExtra: [1, 1] }],
  ['char_1032_excu2', 'fixedSkill:0', 'skchr_excu2_3', '自然技力装弹并提升射击伤害与特性治疗', 'ammo', { ammoCount: [16, 16], atkScale: [1.7, 1.8], baseAttackTimeDelta: [0.5, 0.5], traitHealMultiplier: [3, 3], damageType: ['物理', '物理'] }],
  ['char_1032_excu2', 'fixedSkill:1', 'skchr_excu2_3', '每消耗弹药提升攻击力至上限', 'growth', { atkPerAmmo: [0.06, 0.06], maxStacks: [30, 30] }],
  ['char_1032_excu2', 'fixedSkill:2', 'skchr_excu2_3', '打空弹药对实际命中过的目标造成物理伤害', 'damage', { finalAtkScale: [2.4, 2.5], ignoreDefFixed: [360, 400], damageType: ['物理', '物理'] }],
  ['char_1032_excu2', 'modePassive:0', 'skchr_excu2_3', '技能期间每发弹药叠加额外攻击概率并在结束清零', 'addBuff', { extraAttackProb: [0.05, 0.05], maxStacks: [30, 30] }],
];

function formal(id) {
  const row = roster.operators.find((entry) => entry.charId === id);
  assert(row, `${id}: formal roster entry exists`);
  return row;
}
function body(id) { return data.runtime.bodies[id]; }
function valueAt(values, rank) { return Array.isArray(values) ? values[rank - 1] : values; }
function piece(id, rank, moduleId = null) {
  const definition = body(id), uid = `exact-k:${id}:r${rank}:${moduleId ?? 'base'}:${++seq}`;
  return { uid, charId: id, isPrimary: true, purchaseCharId: definition.purchaseCharId, star: rank, row: 9, col: 8,
    dir: 'RIGHT', sourceCopies: 1, moduleId, moduleChoices: { [id]: moduleId }, permanentFlat: {}, permanentPercent: {},
    tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
}
function fixture(id, rank, moduleId = null) {
  const selected = piece(id, rank, moduleId);
  const encounter = { ...normal, wave: { ...normal.wave, spawns: [], dp: { ...normal.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 831900 + seq, life: 20, day: 1, hour: 1, pieces: [selected], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.autoFinish = false; battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === selected.uid);
  assert(unit?.alive && unit.deployed, `native Battle deploys ${id} R${rank}`);
  return { battle, unit, selected };
}
function advance(f, seconds) {
  const until = f.battle.time + seconds;
  for (let i = 0; i < 24000 && f.battle.time + 1e-9 < until; i++) f.battle.step();
  assert(f.battle.time + 1e-9 >= until, `native Battle clock reaches ${until.toFixed(3)}s`);
  f.battle.assaultRuntime.flush();
}
function enemy(f, offset = 1) {
  const r = f.unit.tileR, c = f.unit.tileC + offset;
  const target = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: f.battle.enemies.length, pos: [r, c], mods: { hpMul: 100000, speed: 0 } });
  assert(target?.alive, `native Battle spawns a live target at ${r},${c}`);
  target.atkCd = Infinity; f.battle._buildEnemyIndex();
  return target;
}
function nativeCast(f, label) {
  advance(f, 0.25);
  assert.equal(f.unit.skill.rule, 'SP_FULL', `${label}: native readiness rule`);
  const starts = [];
  f.battle.assaultRuntime.observe('skillStart', `exact-k:${label}`, ({ payload }) => {
    if (payload.source?.uid === f.unit.uid) starts.push(payload.reason);
  });
  assert(f.unit.skill.gainSp(f.unit.skill.spCost - f.unit.skill.sp, `exact-k-natural-SP_FULL:${label}`) > 0,
    `${label}: native Skill.gainSp fills SP`);
  advance(f, 0.05);
  assert.deepEqual(starts, ['automatic'], `${label}: one default native callback starts the skill`);
}
function mappingValue(entry, key, rank) { return valueAt(entry.values[key], rank); }

function assertMapping([id, source, skillId, title, action, literals]) {
    const operator = formal(id), compiled = body(id), index = Number(source.split(':')[1]);
    assert.equal(operator.fixedSkill.sourceSkillId, skillId, `${id}: source title binds to canonical skill slot`);
    assert.equal(operator.fixedSkill.sourceIndex, 2, `${id}: source title binds to the third official character skill slot`);
    const effect = source.startsWith('modePassive:') ? operator.modePassives[index] : operator.fixedSkill.effects[index];
    const runtime = source.startsWith('modePassive:') ? compiled.modePassives[index] : compiled.fixedSkill.effects[index];
    assert.equal(effect.action, action, `${id} ${source}: source action`);
    for (const [key, expected] of Object.entries(literals)) {
      assert.deepEqual([valueAt(effect.values[key], 3), valueAt(effect.values[key], 4)], expected,
        `${id} ${source}.${key}: literal rank-3/rank-4 values`);
      assert.deepEqual([valueAt(runtime.values[key], 3), valueAt(runtime.values[key], 4)], expected,
        `${id} ${source}.${key}: native runtime carries literal rank-3/rank-4 values`);
    }
    const rows = coverage.modules.filter((entry) => entry.charId === id);
    assert.equal(rows.length, 2, `${id}: both advanced module variants are in canonical coverage`);
    for (const row of rows) {
      const covered = row.sourceEffects.find((candidate) => candidate.source === source && candidate.action === action);
      assert(covered, `${row.advancedModuleId}: ${source} ${action} binding is mapped`);
      assert(['partial', 'complete'].includes(covered.status), `${row.advancedModuleId}: ${source} ${action} keeps a valid coverage state`);
      const proof = /^test:(test\/assault\/assault-source-exact-k\.test\.mjs)::(.+)$/.exec(covered.assertion ?? '');
      assert(proof, `${row.advancedModuleId}: ${source} ${action} names an exact K proof file/title`);
      assert(fs.readFileSync(new URL(`../../${proof[1]}`, import.meta.url), 'utf8').includes(`test('${proof[2]}'`),
        `${row.advancedModuleId}: ${source} ${action} proof title exists literally`);
      assert.deepEqual(Object.keys(literals).sort(), [...new Set([...Object.keys(covered.rank3), ...Object.keys(covered.rank4)])].sort(),
        `${row.advancedModuleId}: exact effect fields match pending coverage`);
      assert.deepEqual(Object.fromEntries(Object.keys(literals).map((key) => [key, covered.rank3[key]])),
        Object.fromEntries(Object.keys(literals).map((key) => [key, literals[key][0]])), `${row.advancedModuleId}: rank-three coverage literal`);
      assert.deepEqual(Object.fromEntries(Object.keys(literals).map((key) => [key, covered.rank4[key]])),
        Object.fromEntries(Object.keys(literals).map((key) => [key, literals[key][1]])), `${row.advancedModuleId}: rank-four coverage literal`);
    }
}

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
