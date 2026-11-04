import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { absoluteRangeKeys, canTargetEnemy, tileKeyOf } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
let seq = 0;
const body = (id) => data.runtime.bodies[id];
const idOf = (entity) => entity?.uid ?? entity?.id;

function formal(id) {
  const row = roster.operators.find((operator) => operator.charId === id);
  assert(row, `${id}: formal roster-assault.json entry exists`);
  return row;
}
function piece(id, rank, moduleId = null) {
  const definition = body(id), uid = `exact-i:${id}:r${rank}:${moduleId ?? 'base'}:${++seq}`;
  return { uid, charId: id, isPrimary: true, purchaseCharId: definition.purchaseCharId, star: rank, row: 9, col: 8,
    dir: 'RIGHT', sourceCopies: 1, moduleId, moduleChoices: { [id]: moduleId }, permanentFlat: {}, permanentPercent: {},
    tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
}
function fixture(id, rank, moduleId = null) {
  const selected = piece(id, rank, moduleId);
  const encounter = { ...normal, wave: { ...normal.wave, spawns: [], dp: { ...normal.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 831700 + seq, life: 20, day: 1, hour: 1, pieces: [selected], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.autoFinish = false;
  battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === selected.uid);
  assert(unit?.alive && unit.deployed, `native Assault Battle deploys ${id} R${rank}`);
  return { battle, unit, selected };
}
function advance(f, seconds) {
  const until = f.battle.time + seconds;
  for (let index = 0; index < 24000 && f.battle.time + 1e-9 < until; index++) f.battle.step();
  assert(f.battle.time + 1e-9 >= until, `native Battle clock reaches ${until.toFixed(3)}s`);
  f.battle.assaultRuntime.flush();
}
function groundRangeTiles(f) {
  return [...new Set(f.unit.rangeKeys ?? [])].map((key) => [Math.floor(key / COLS), key % COLS])
    .filter(([row, col]) => f.battle.grid.inRect(row, col) && f.battle.grid.groundPassable(row, col) &&
      (row !== f.unit.tileR || col !== f.unit.tileC) && !f.battle._occ[row * 19 + col]?.alive && !f.battle.downOn(row, col));
}
function spawn(f, [row, col], { hpMul = 100000, speed = 0, bind = false } = {}) {
  assert(f.battle.grid.groundPassable(row, col), `native official-stage ground tile ${row},${col} is passable`);
  const enemy = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: f.battle.enemies.length, pos: [row, col], mods: { hpMul, speed } });
  assert(enemy?.alive, `normal Battle spawns live enemy at ${row},${col}`);
  enemy.atkCd = Infinity;
  if (bind) f.battle.applyStatus(enemy, 'bind', { duration: 90, key: `exact-i:hold:${enemy.uid}` });
  f.battle._buildEnemyIndex();
  return enemy;
}
function nativeCast(f, label) {
  advance(f, 0.25);
  assert.equal(f.unit.skill.rule, 'SP_FULL', `${label}: compiled skill uses natural SP_FULL`);
  assert.equal(f.unit.skill.spec.canCast({ battle: f.battle, unit: f.unit }), true,
    `${label}: native cast gate sees legal enemies; range=${JSON.stringify(f.unit.rangeKeys)} unit=${f.unit.x},${f.unit.y}/${f.unit.tileR},${f.unit.tileC} profile=${JSON.stringify(f.unit.profile.range)} enemies=${f.battle.enemies.map((enemy) => `${idOf(enemy)}@${enemy.x},${enemy.y}:key=${tileKeyOf(enemy)}:alive=${enemy.alive}:deployed=${enemy.deployed}:targetable=${canTargetEnemy(f.unit, enemy, f.unit.profile)}:sleep=${enemy.s.flags.sleep}:stealth=${enemy.s.flags.stealth}`).join(';')}`);
  const starts = [];
  f.battle.assaultRuntime.observe('skillStart', `exact-i:${label}`, ({ payload }) => {
    if (payload.source?.uid === f.unit.uid) starts.push({ reason: payload.reason, at: f.battle.time });
  });
  assert(f.unit.skill.gainSp(f.unit.skill.spCost - f.unit.skill.sp, `exact-i-natural-SP_FULL:${label}`) > 0,
    `${label}: Skill.gainSp fills the native bar`);
  advance(f, 0.05);
  assert.equal(starts.length, 1, `${label}: one automatic native skill start`);
  assert.equal(starts[0].reason, 'automatic');
  return starts[0];
}
function nativeValuesMatch(id) {
  const source = formal(id), compiled = body(id);
  assert.deepEqual(compiled.fixedSkill.effects.map((effect) => effect.values), source.fixedSkill.effects.map((effect) => effect.values), `${id}: native compiled fixed effects preserve all formal values`);
  assert.deepEqual(compiled.modePassives.map((effect) => effect.values), source.modePassives.map((effect) => effect.values), `${id}: native compiled passive preserves formal values`);
}

test('exact-i Mountain R3/R4 natural skill hits, push, temporary punch strength, and native punch debuff use literal values', { timeout: 85000 }, () => {
  const id = 'char_264_f12yin', source = formal(id);
  nativeValuesMatch(id);
  assert.deepEqual(source.fixedSkill.effects[0].values.hits.slice(2), [2, 2]);
  assert.deepEqual(source.fixedSkill.effects[0].values.atkScalePerHit.slice(2), [0.9, 1]);
  assert.deepEqual(source.fixedSkill.effects[0].values.maxTarget.slice(2), [4, 4]);
  assert.deepEqual(source.fixedSkill.effects[0].values.damageType.slice(2), ['物理', '物理']);
  assert.deepEqual(source.fixedSkill.effects[1].values.force.slice(2), [1, 1]);
  assert.deepEqual(source.fixedSkill.effects[2].values.talentProbBonus.slice(2), [0.65, 0.75]);
  assert.deepEqual(source.fixedSkill.effects[2].values.duration.slice(2), [30, 30]);
  assert.deepEqual(source.modePassives[0].values.targetAtkDown.slice(2), [0.1, 0.15]);
  assert.deepEqual(source.modePassives[0].values.duration.slice(2), [3, 3]);

  for (const scenario of [
    { rank: 3, moduleId: null }, { rank: 4, moduleId: null },
    { rank: 3, moduleId: 'uniequip_002_f12yin' }, { rank: 4, moduleId: 'uniequip_002_f12yin' },
    { rank: 3, moduleId: 'uniequip_003_f12yin' }, { rank: 4, moduleId: 'uniequip_003_f12yin' },
  ]) {
    const f = fixture(id, scenario.rank, scenario.moduleId), tiles = groundRangeTiles(f);
    assert(tiles.length, `R${scenario.rank}/${scenario.moduleId ?? 'base'}: legal native target tile available`);
    const targets = Array.from({ length: 4 }, (_, index) => spawn(f, tiles[0], { bind: true, hpMul: 100000 + index }));
    const before = new Map(targets.map((target) => [idOf(target), [target.x, target.y]]));
    const skillHits = [];
    f.battle.on('damaged', (event) => {
      if (event.source?.uid === f.unit.uid && event.dmg?.attackId === `${id}:damage`)
        skillHits.push({ targetUid: idOf(event.target), amount: event.amount, type: event.dmg.type, isSkill: event.dmg.isSkill });
    });
    nativeCast(f, `f12yin-r${scenario.rank}-${scenario.moduleId ?? 'base'}`);
    assert.equal(new Set(skillHits.map((hit) => hit.targetUid)).size, 4, 'natural skill hits the literal four-target cap');
    assert.equal(skillHits.length, 8, 'natural skill lands two real hits on each of four selected enemies');
    assert(skillHits.every((hit) => hit.amount > 0 && hit.type === 'phys' && hit.isSkill), 'all recorded source packets are positive physical skill damage');
    const movingTarget = spawn(f, tiles[0], { hpMul: 100000 });
    const movingBefore = [movingTarget.x, movingTarget.y];
    nativeCast(f, `f12yin-force-r${scenario.rank}-${scenario.moduleId ?? 'base'}`);
    assert(Math.hypot(movingTarget.x - movingBefore[0], movingTarget.y - movingBefore[1]) > 0.01,
      'second natural cast applies the literal force-1 movement to a real unbound target');
    const punchBonus = scenario.moduleId === 'uniequip_003_f12yin' ? (scenario.rank === 3 ? 0.70 : 0.80) : (scenario.rank === 3 ? 0.65 : 0.75);
    assert(Math.abs(f.unit.mem.assaultF12yinPunchBonus - punchBonus) < 1e-12,
      'natural cast installs the rank literal temporary punch chance bonus plus selected module delta');
    if (scenario.moduleId === 'uniequip_002_f12yin') {
      assert(f.unit.skill.sp >= 1, 'advanced module 002 returns one actual SP after the natural cast hits at least three enemies');
    }
    const normalHits = [];
    f.battle.on('damaged', (event) => {
      if (event.source?.uid === f.unit.uid && event.target?.side === 'enemy' && event.dmg?.isAttack && !event.dmg.isSkill)
        normalHits.push({ uid: idOf(event.target), at: f.battle.time, amount: event.amount, atk: event.target.s.atk,
          attackId: event.dmg.attackId, punchId: f.unit.mem.assaultF12yinPunchAttackId, seq: f.battle._attackSeq });
    });
    const punchCandidates = [...targets, movingTarget];
    for (let tick = 0; tick < 300 && !punchCandidates.some((target) => target.buffs.some((buff) => buff.key === `${id}:punch-weaken:${idOf(target)}`)); tick++) advance(f, 0.1);
    const weakenedTarget = punchCandidates.find((target) => target.buffs.some((buff) => buff.key === `${id}:punch-weaken:${idOf(target)}`));
    const weakened = weakenedTarget?.buffs.find((buff) => buff.key === `${id}:punch-weaken:${idOf(weakenedTarget)}`);
    assert(weakened, `R${scenario.rank}/${scenario.moduleId ?? 'base'}: normal physical attack triggers a real giant-punch ATK debuff; hitCount=${normalHits.length} idMatches=${normalHits.filter((hit) => hit.attackId === hit.punchId).length} sample=${JSON.stringify(normalHits.slice(0, 4))} targetBuffs=${punchCandidates.map((target) => `${idOf(target)}:${target.buffs.map((buff) => buff.key).join(',')}`).join(';')}`);
    assert.equal(weakened.mods.atkPct, scenario.rank === 3 ? -0.1 : -0.15, 'normal hit applies the literal rank target ATK reduction');
    if (scenario.moduleId === 'uniequip_002_f12yin' && scenario.rank === 4)
      assert(weakened.timeLeft > 4.8, 'R4 advanced module 002 extends actual punch debuff from three to five seconds');
    assert.equal(f.battle.errors.length, 0);
  }
});

test('exact-i Chyue R3/R4 natural skill grows on cast, adds the fifth-hit awakening, and refunds SP on a real skill kill', { timeout: 85000 }, () => {
  const id = 'char_2024_chyue', source = formal(id);
  nativeValuesMatch(id);
  assert.deepEqual(source.fixedSkill.effects[0].values.atkScale.slice(2), [3.5, 3.8]);
  assert.deepEqual(source.fixedSkill.effects[0].values.splashRadius.slice(2), [1, 1]);
  assert.deepEqual(source.fixedSkill.effects[0].values.damageType.slice(2), ['物理', '物理']);
  assert.deepEqual(source.fixedSkill.effects[1].values.rangeExtend.slice(2), [1, 1]);
  assert.deepEqual(source.fixedSkill.effects[1].values.extraHit.slice(2), [1, 1]);
  assert.deepEqual(source.fixedSkill.effects[1].values.threshold.slice(2), [5, 5]);
  assert.deepEqual(source.fixedSkill.effects[2].values.talentAtkScale.slice(2), [1.6, 1.65]);
  assert.deepEqual(source.fixedSkill.effects[2].values.duration.slice(2), [2.5, 2.5]);
  assert.deepEqual(source.modePassives[0].values.sp.slice(2), [3, 3]);
  assert.deepEqual(source.modePassives[0].values.perCast.slice(2), [1, 1]);

  for (const scenario of [
    { rank: 3, moduleId: null, threshold: 5 }, { rank: 4, moduleId: null, threshold: 5 },
    { rank: 3, moduleId: 'uniequip_002_chyue', threshold: 4 }, { rank: 4, moduleId: 'uniequip_002_chyue', threshold: 4 },
  ]) {
    const f = fixture(id, scenario.rank, scenario.moduleId), tile = groundRangeTiles(f)[0];
    assert(tile, `R${scenario.rank}: one legal native target tile exists`);
    const target = spawn(f, tile, { hpMul: 1000000 });
    const hitPackets = [];
    f.battle.on('damaged', (event) => {
      if (event.source?.uid === f.unit.uid && event.target?.uid === target.uid && event.dmg?.attackId === `${id}:damage`)
        hitPackets.push({ amount: event.amount, type: event.dmg.type, isSkill: event.dmg.isSkill });
    });
    // 大巴扎卡面：重岳技能只「对目标及周围敌人造成 a% 物理伤害」——累计施放不再觉醒（扩范围、加段数）。
    for (let cast = 1; cast <= scenario.threshold + 1; cast++) {
      const before = hitPackets.length;
      nativeCast(f, `chyue-growth-r${scenario.rank}-${scenario.moduleId ?? 'base'}-${cast}`);
      assert.equal(hitPackets.length - before, 1, `cast ${cast} lands exactly one physical skill hit on the target`);
    }
    assert(!f.unit.buffs.some((buff) => buff.key === `${id}:awakened`), `R${scenario.rank}/${scenario.moduleId ?? 'base'}: no awakening range buff after ${scenario.threshold + 1} casts`);
    assert(hitPackets.every((hit) => hit.amount > 0 && hit.type === 'phys' && hit.isSkill), 'skill hits are real positive physical skill packets');
    assert.equal(f.battle.errors.length, 0);
  }

  for (const scenario of [{ rank: 3, moduleId: null }, { rank: 4, moduleId: 'uniequip_002_chyue' }]) {
    const f = fixture(id, scenario.rank, scenario.moduleId), tile = groundRangeTiles(f)[0];
    const target = spawn(f, tile, { bind: true, hpMul: 1000000 });
    const markerKey = `assault:${id}:zhige:${idOf(f.unit)}`;
    for (let tick = 0; tick < 100; tick++) advance(f, 0.1);
    assert(!target.buffs.some((buff) => buff.key === markerKey), `R${scenario.rank}: ordinary attacks no longer apply the zhige mark (卡面没有)`);
    assert.equal(f.battle.errors.length, 0);
  }

  const f = fixture(id, 4, 'uniequip_003_chyue');
  const tile = groundRangeTiles(f)[0];
  const killTarget = spawn(f, tile, { hpMul: 1 });
  const spBefore = f.unit.skill.sp;
  nativeCast(f, 'chyue-passive-real-skill-kill');
  assert.equal(killTarget.alive, false, 'normal natural skill lethally damages its actual native target');
  advance(f, 0.1);
  assert(f.unit.skill.sp >= 3, `formal once-per-cast kill passive grants three real SP after a skill kill; before=${spBefore} after=${f.unit.skill.sp}`);
  assert.equal(f.battle.errors.length, 0);
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
