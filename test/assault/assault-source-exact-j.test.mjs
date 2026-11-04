import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { COLS } from '../../server/sim/constants.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const sourceIndex = JSON.parse(fs.readFileSync(new URL('../../../../../data/assault-sources/source-index.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(new URL('../../data/assault-coverage-assault-modules.json', import.meta.url), 'utf8'));
const normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
let seq = 0;
const ids = ['char_4145_ulpia', 'char_4058_pepe', 'char_4116_blkkgt'];
const body = (id) => data.runtime.bodies[id];
const idOf = (entity) => entity?.uid ?? entity?.id;

function formal(id) {
  const row = roster.operators.find((operator) => operator.charId === id);
  assert(row, `${id}: formal roster row exists`);
  return row;
}
function nativeOperator(id) {
  const row = sourceIndex.arknights.operators.find((operator) => operator.charId === id);
  assert(row, `${id}: canonical source-index ID exists`);
  assert.equal(row.source.characterTable.endsWith('character_table.json'), true, `${id}: official character table source pointer`);
  assert.equal(row.source.skillTable.endsWith('skill_table.json'), true, `${id}: official skill table source pointer`);
  assert.equal(row.source.uniequipTable.endsWith('uniequip_table.json'), true, `${id}: official uniequip source pointer`);
  assert.equal(row.source.battleEquipTable.endsWith('battle_equip_table.json'), true, `${id}: official battle-equip source pointer`);
  assert.equal(row.source.rangeTable.endsWith('range_table.json'), true, `${id}: official range source pointer`);
  return row;
}
function sourceBindings(id) {
  const rows = coverage.modules.filter((entry) => entry.charId === id);
  const expectedModules = [...new Set([...formal(id).modulePlans, ...body(id).modulePlans].filter((plan) => plan.type === 'ADVANCED').map((plan) => plan.id))].sort();
  assert.deepEqual(rows.map((row) => row.advancedModuleId).sort(), expectedModules, `${id}: canonical coverage contains every formal advanced-module variant`);
  const effects = new Map();
  for (const row of rows) for (const effect of row.sourceEffects ?? []) {
    assert(['partial', 'complete'].includes(effect.status), `${id}/${row.advancedModuleId}/${effect.source}: source binding has an accepted coverage state`);
    const match = /^test:(test\/assault\/[^:]+\.test\.mjs)::(.+)$/.exec(effect.assertion ?? '');
    assert(match, `${id}/${row.advancedModuleId}/${effect.source}: exact proof file and literal title are registered`);
    const proofText = fs.readFileSync(new URL(`../../${match[1]}`, import.meta.url), 'utf8');
    assert(proofText.includes(`test('${match[2]}'`), `${id}/${row.advancedModuleId}/${effect.source}: registered proof title exists literally`);
    const prior = effects.get(effect.source);
    const binding = { action: effect.action, rank3: effect.rank3, rank4: effect.rank4 };
    if (prior) assert.deepEqual(prior, binding, `${id}/${effect.source}: source literals agree across module variants`);
    else effects.set(effect.source, binding);
  }
  return effects;
}
function piece(id, rank, moduleId = null) {
  const definition = body(id), uid = `exact-j:${id}:r${rank}:${moduleId ?? 'base'}:${++seq}`;
  return { uid, charId: id, isPrimary: true, purchaseCharId: definition.purchaseCharId, star: rank, row: 9, col: 8,
    dir: 'RIGHT', sourceCopies: 1, moduleId, moduleChoices: { [id]: moduleId }, permanentFlat: {}, permanentPercent: {},
    tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
}
function fixture(id, rank, moduleId = null) {
  const selected = piece(id, rank, moduleId);
  const encounter = { ...normal, wave: { ...normal.wave, spawns: [], dp: { ...normal.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 835000 + seq, life: 20, day: 1, hour: 1, pieces: [selected], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.autoFinish = false; battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === selected.uid);
  assert(unit?.alive && unit.deployed, `formal native Battle deploys ${id} R${rank}/${moduleId ?? 'base'}`);
  return { battle, unit, selected };
}
function advance(f, seconds) {
  const until = f.battle.time + seconds;
  for (let index = 0; index < 24000 && f.battle.time + 1e-9 < until; index++) f.battle.step();
  assert(f.battle.time + 1e-9 >= until, `native Battle clock reaches ${until.toFixed(3)}s`);
  f.battle.assaultRuntime.flush();
}
function targetTiles(f) {
  return [...new Set(f.unit.rangeKeys ?? [])].map((key) => [Math.floor(key / COLS), key % COLS])
    .filter(([row, col]) => f.battle.grid.inRect(row, col) && f.battle.grid.groundPassable(row, col) &&
      (row !== f.unit.tileR || col !== f.unit.tileC) && !f.battle._occ[row * 19 + col]?.alive && !f.battle.downOn(row, col));
}
function spawn(f, pos, hpMul = 100000) {
  const [row, col] = pos;
  assert(f.battle.grid.groundPassable(row, col), `official-stage ground tile ${row},${col} is passable`);
  const enemy = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: f.battle.enemies.length, pos: [row, col], mods: { hpMul, speed: 0 } });
  assert(enemy?.alive, `native Battle creates live enemy at ${row},${col}`);
  enemy.atkCd = Infinity; f.battle._buildEnemyIndex();
  return enemy;
}
function nativeCast(f, label, beforeResolve = null) {
  advance(f, 0.25);
  assert.equal(f.unit.skill.rule, 'SP_FULL', `${label}: source compiles to natural SP_FULL`);
  const starts = [];
  f.battle.assaultRuntime.observe('skillStart', `exact-j:${label}`, ({ payload }) => {
    if (payload.source?.uid === f.unit.uid) starts.push({ reason: payload.reason, at: f.battle.time });
  });
  assert(f.unit.skill.gainSp(f.unit.skill.spCost - f.unit.skill.sp, `exact-j-natural-SP_FULL:${label}`) > 0,
    `${label}: native Skill.gainSp fills the bar`);
  beforeResolve?.();
  advance(f, 0.05);
  assert.equal(starts.length, 1, `${label}: one automatic native skill start`);
  assert.equal(starts[0].reason, 'automatic', `${label}: default native cast callback`);
  return starts[0];
}
function exactDamage(event, attackerAtk, unit, target, scale, mul = 1) {
  const raw = attackerAtk * scale;
  const expected = Math.max(raw - target.s.def, raw * 0.05) * unit.s.dmgDealtMul * unit.s.physDealtMul * target.s.dmgTakenMul * target.s.physTakenMul * mul;
  assert.equal(event.dmg.type, 'phys', 'official physical damage type');
  assert(Math.abs(event.amount - expected) < 1e-6, `actual hit equals literal ${scale}x ATK: amount=${event.amount} expected=${expected} preAtk=${attackerAtk} liveAtk=${unit.s.atk} def=${target.s.def} dmgMul=${unit.s.dmgDealtMul} physMul=${unit.s.physDealtMul} targetDmgMul=${target.s.dmgTakenMul} targetPhysMul=${target.s.physTakenMul}`);
}
function assertSourceSet(id, expectedSources) {
  const actual = sourceBindings(id);
  assert.deepEqual([...actual.keys()].sort(), expectedSources.slice().sort(), `${id}: exact source bindings match the tested source-title set`);
  nativeOperator(id);
  const source = formal(id), compiled = body(id);
  assert.deepEqual(compiled.fixedSkill.effects.map((effect) => effect.values), source.fixedSkill.effects.map((effect) => effect.values), `${id}: compiled skill preserves formal source values`);
  assert.deepEqual(compiled.modePassives.map((effect) => effect.values), source.modePassives.map((effect) => effect.values), `${id}: compiled passive preserves formal source values`);
  return { actual, source, compiled };
}

// 大巴扎卡面数值（按星级）。
const cardLine = (id, line, key) => body(id).bazaar.lines[line].params[key];
const cardModule = (id, moduleId, key, rank) => Number(body(id).bazaar.modules?.[moduleId]?.params?.[key]?.[rank - 1] ?? 0);

test('exact-j Ulpia R3/R4 applies four official skill literals through natural anchor Battle callbacks', { timeout: 85000 }, () => {
  // 大巴扎：卡面第一行「对 2 名敌人造成 a% 物理伤害，并拉拽它们」取代了旧的增益/锚点/晕眩/冲刺技能。
  const { actual, source } = assertSourceSet('char_4145_ulpia', ['fixedSkill:0', 'fixedSkill:1', 'fixedSkill:2', 'fixedSkill:3', 'modePassive:0']);
  const a = cardLine('char_4145_ulpia', 0, 'a');
  assert.deepEqual(source.fixedSkill.effects[0].values.atkScale, a.map((value) => value / 100), 'skill scale is the card a%');
  assert.deepEqual(source.fixedSkill.effects[0].values.maxTarget, [2, 2, 2, 2], 'card: 2 enemies');
  assert.equal(source.fixedSkill.effects.length, 1, 'the old buff, stun and dash effects are gone');
  assert.equal(actual.size, 5);
  for (const rank of [3, 4]) for (const moduleId of [null, 'uniequip_002_ulpia']) {
    const f = fixture('char_4145_ulpia', rank, moduleId), tile = targetTiles(f)[0];
    assert(tile, `R${rank}/${moduleId ?? 'base'}: legal target exists`);
    const target = spawn(f, tile), atk = f.unit.s.atk, maxHp = f.unit.s.maxHp, hits = [];
    f.battle.on('damaged', (event) => { if (event.source === f.unit && event.dmg?.isSkill && event.target?.side === 'enemy') hits.push(event); }, { owner: f.unit });
    const home = [f.unit.tileR, f.unit.tileC], stunEvents = [];
    f.battle.on('statusApplied', (event) => { if (event.target === target && event.status === 'stun') stunEvents.push(event.duration); });
    nativeCast(f, `ulpia-r${rank}-${moduleId ?? 'base'}`);
    assert(hits.length > 0, 'the skill produces an actual skill damage packet');
    for (const event of hits) exactDamage(event, f.unit.s.atk, f.unit, event.target, a[rank - 1] / 100);
    assert(new Set(hits.map((event) => event.target)).size <= 2, 'at most 2 enemies are hit');
    assert.equal(f.unit.buffs.some((entry) => String(entry.key).startsWith('char_4145_ulpia:addBuff')), false, 'no old timed HP/ATK buff');
    assert.equal(f.unit.s.atk, atk); assert.equal(f.unit.s.maxHp, maxHp);
    assert.equal(stunEvents.length, 0, 'no old six-second stun');
    assert.deepEqual([f.unit.tileR, f.unit.tileC], home, 'no old dash to an anchor');
    assert.equal(f.battle.errors.length, 0);
  }
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
