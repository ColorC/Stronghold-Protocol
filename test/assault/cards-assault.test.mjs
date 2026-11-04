import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData } from '../../server/modes/assault/data.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { supportKits } from '../../server/sim/content/assault/cards/support.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { loadAssaultDesign } from '../../server/modes/assault/data.js';
import { createAssaultContext } from '../../server/modes/assault/context.js';
import { assaultTokenKits } from '../../server/sim/content/assault/cards/assault-tokens.js';
import { assaultAmmoState, reloadAssaultAmmo, setAssaultAmmoCapacityBonus } from '../../server/sim/content/assault/ammo.js';
import { damage as assaultDamage, unitTag } from '../../server/sim/content/assault/primitives.js';
import { COLS } from '../../server/sim/constants.js';
import { grantSummon, ledgerFor } from '../../server/sim/content/assault/summons.js';

const { runtime } = getAssaultData();
const pieceFor = (body, star = 4, moduleId = null) => ({ uid: `test:${body.charId}`, charId: body.charId, star, fixedSkill: body.fixedSkill,
  sourceCopies: 1, moduleChoices: { [body.charId]: moduleId }, moduleId, permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [] });

function cardBattle(bodies, seed = 800, setup = null, dpInit = null) {
  const design = loadAssaultDesign();
  const pieces = bodies.map(({ body, row = 9, col = 2, star = 4, moduleId = null, uid: pieceUid }) => ({ ...pieceFor(body, star, moduleId), uid: pieceUid ?? `test:${body.charId}`,
    purchaseCharId: body.purchaseCharId, row, col, dir: 'RIGHT', permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] }));
  const state = { seed, life: 20, day: 1, hour: 1, pieces, nextBattleEffects: [] };
  const data = { ...getAssaultData(), design };
  const sourceEncounter = design.encounters.encounters.find((encounter) => encounter.kind === 'normal');
  const encounter = dpInit == null ? sourceEncounter : { ...sourceEncounter, wave: { ...sourceEncounter.wave, dp: { ...sourceEncounter.wave.dp, init: dpInit } } };
  const prepared = prepareAssaultBattle(state, encounter, data);
  const battle = createAssaultBattle(prepared, { ...data, kits: assaultKits });
  setup?.(battle);
  battle.start(); battle.assaultRuntime.flush(); battle._buildEnemyIndex();
  return { battle, pieces };
}

test('all 46 assault bodies have an explicit strict KIT builder and four-rank fixed skill data', () => {
  assert.equal(Object.keys(assaultKits).length, 46);
  for (const [charId, builder] of Object.entries(assaultKits)) {
    const body = runtime.bodies[charId];
    assert.ok(body, `compiled body ${charId}`);
    assert.ok(body.fixedSkill?.sourceSkillId && body.fixedSkill.effects?.length, `fixed skill ${charId}`);
    const piece = pieceFor(body);
    const def = { charId, raw: { assaultPiece: piece, assaultBody: body } };
    const kit = builder(null, piece, def);
    assert.equal(kit.skill.id, body.fixedSkill.sourceSkillId, charId);
    assert.equal(kit.skill.kind, 'instant', charId);
    assert.equal(typeof kit.skill.assaultCast, 'function', charId);
    for (const plan of body.modulePlans ?? []) {
      if (plan.type !== 'ADVANCED') continue;
      assert.ok(plan.translation?.effectHandling ?? plan.effectHandling, `${charId} ${plan.id} module source`);
      const selected = builder(null, pieceFor(body, 4, plan.id), { charId, raw: { assaultPiece: pieceFor(body, 4, plan.id), assaultBody: body } });
      assert.equal(selected.skill.id, body.fixedSkill.sourceSkillId);
    }
  }
});

test('per-body action inventories expose every source effect and one-copy passive binding', () => {
  for (const charId of Object.keys(assaultKits)) {
    const body = runtime.bodies[charId];
    assert.ok(body.fixedSkill.effects.every((effect) => typeof effect.action === 'string' && effect.values), charId);
    for (const passive of body.modePassives ?? []) {
      assert.ok(passive.replacesTalentIndices || (body.talentBindings ?? []).some((binding) => binding.singleBinding), `${charId} passive has no single-owner talent binding`);
    }
  }
  const guardAmiya = runtime.bodies.char_1001_amiya2;
  const medicAmiya = runtime.bodies.char_1037_amiya3;
  assert.equal(guardAmiya.fixedSkill.effects[0].values.times[3], 12);
  assert.equal(guardAmiya.fixedSkill.effects[0].values.finalHitDmgType, 'true');
  assert.equal(medicAmiya.fixedSkill.effects[2].values.healType, 'atkScale');
});

test('coverage ledger enumerates every roster body, talent binding, passive, and advanced module source', () => {
  const coverage = JSON.parse(fs.readFileSync(new URL('../../data/assault-coverage-assault.json', import.meta.url), 'utf8'));
  assert.equal(coverage.count, 46);
  assert.equal(coverage.cards.length, 46);
  for (const body of Object.values(runtime.bodies)) {
    const row = coverage.cards.find((entry) => entry.charId === body.charId);
    if (!row) continue;
    assert.equal(row.fixedSkill.effects.length, body.fixedSkill.effects.length, body.charId);
    assert.equal(row.modePassives.length, (body.modePassives ?? []).length, body.charId);
    assert.equal(row.modules.length, (body.modulePlans ?? []).filter((module) => module.type === 'ADVANCED').length, body.charId);
  }
});

test('Perfumer naturally heals an injured in-range ally through the native medic attack path', () => {
  const perfumerBody = runtime.bodies.char_181_flower;
  const patientBody = runtime.bodies.char_1001_amiya2;
  assert.ok(perfumerBody && patientBody, 'both compiled native operators are available');
  const ctx = createAssaultContext();
  const encounter = ctx.design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const pieces = [
    { ...pieceFor(perfumerBody), purchaseCharId: perfumerBody.purchaseCharId, row: 9, col: 2, dir: 'RIGHT', uid: 'test:perfumer' },
    { ...pieceFor(patientBody), purchaseCharId: patientBody.purchaseCharId, row: 9, col: 3, dir: 'RIGHT', uid: 'test:patient' },
  ];
  const prepared = ctx.prepareBattle({ seed: 18114, life: 20, day: 1, hour: 1, gold: 0, pieces, nextBattleEffects: [] }, encounter);
  const battle = createAssaultBattle(prepared, ctx);
  battle.start(); battle.assaultRuntime.flush(); battle._buildEnemyIndex();
  const healer = battle.allyUnits.find((unit) => unit.uid === pieces[0].uid);
  const patient = battle.allyUnits.find((unit) => unit.uid === pieces[1].uid);
  assert.equal(healer.def.profession, 'MEDIC');
  assert.equal(healer.profile.dmgType, 'heal');
  assert.ok(healer.rangeKeySet.has(patient.tileR * COLS + patient.tileC), 'real field positions are inside her native heal range');

  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { speed: 0 } });
  assert.ok(battle.dealDamage(enemy, patient, { amount: Math.min(100, patient.hp / 4), type: 'true', canDodge: false }) > 0,
    'create the missing-HP condition through the native damage pipeline');
  const hpAfterDamage = patient.hp;
  assert.ok(battle.injuredAlliesInKeys(healer.rangeKeys, healer).includes(patient), 'the damaged friend becomes a legal native heal target');
  const healing = [];
  battle.on('heal', (event) => { if (event.source === healer && event.target === patient) healing.push(event.amount); }, { owner: healer });
  for (let tick = 0; tick < 240 && patient.hp <= hpAfterDamage; tick++) battle.step();
  assert.ok(patient.hp > hpAfterDamage, 'the live medic attack restores HP without a synthetic heal event');
  assert.ok(healing.some((amount) => amount > 0), 'native combat publishes the applied heal with Perfumer as source');
});

test('natural full-SP melee skills start from legal native battlefield states', () => {
  for (const charId of ['char_1033_swire2', 'char_4145_ulpia', 'char_4058_pepe', 'char_1014_nearl2']) {
    const body = runtime.bodies[charId];
    const { battle, pieces } = cardBattle([{ body }], 912);
    const unit = battle.allyUnits.find((candidate) => candidate.uid === pieces[0].uid);
    if (charId === 'char_1033_swire2') battle._pp(unit.ownerId).coins = 1;
    const target = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { hpMul: 1000, speed: 0 } });
    let hpAtSkillStart = null;
    battle.on('skillStart', ({ unit: caster }) => { if (caster === unit) hpAtSkillStart = target.hp; });
    for (let tick = 0; tick < 500 && unit.skill.activations === 0; tick++) battle.step();
    assert.ok(unit.skill.activations > 0, `${charId} should naturally cast with full native SP and an in-range target`);
    if (charId === 'char_1033_swire2') assert.equal(battle._pp(unit.ownerId).coins, 0, 'Swire2 spends the required coin on its actual device cast');
    if (charId === 'char_4145_ulpia') assert.ok(unit.mem.assaultUlpiaAnchor?.marker?.alive, 'Ulpia creates the live anchor from the legal target');
    if (charId === 'char_4058_pepe') {
      assert.ok(hpAtSkillStart != null && target.hp < hpAtSkillStart, 'Pepe deals skill damage on the natural cast');
      assert.ok(target.s.flags.stun || target.statuses?.stun, 'Pepe applies the source stun to the struck target');
    }
    if (charId === 'char_1014_nearl2') assert.ok(battle.allyUnits.some((candidate) => candidate.defId === 'token_10019_nearl2_sword' && candidate.ownerUnit === unit), 'Nearl2 creates her native sword summon');
  }
});

test('all 46 typed passive owners install into an actual Assault Battle', () => {
  const design = loadAssaultDesign();
  const data = getAssaultData();
  const sourceEncounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const encounter = { ...sourceEncounter, wave: { ...sourceEncounter.wave, dp: { ...sourceEncounter.wave.dp, init: 99 } } };
  for (const [index, charId] of Object.keys(assaultKits).entries()) {
    const body = runtime.bodies[charId];
    const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
    const state = { seed: 7000 + index, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
    const prepared = prepareAssaultBattle(state, encounter, { ...data, design });
    const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
    assert.doesNotThrow(() => battle.start(), `${charId} passive installation`);
    const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
    assert.ok(unit, `${charId} creates a live battle owner`);
    assert.equal(unit.def.raw.assaultBody.modePassives?.length ?? 0, body.modePassives?.length ?? 0, `${charId} retains typed passive plans`);
  }
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Texas rewritten talent grants cast buff and once-per-entry first-kill heal with rain extension', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_1028_texas2;
  const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const prepared = prepareAssaultBattle({ seed: 741, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 4], mods: { hpMul: 100 } });
  battle.start();
  battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  const player = battle._pp(unit.ownerId); if (player) player.dp = 1000;
  assert.ok(unit.buffs.some((entry) => entry.key === 'char_1028_texas2:pre-first-kill-talent'));
  unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true, JSON.stringify({ errors: battle.errors, targets: battle.enemies.map((e) => [e.alive,e.tileR,e.tileC]), skill:{ sp:unit.skill.sp, cost:unit.skill.spCost, charges:unit.skill.charges }, range: unit.rangeKeys?.length }));
  assert.ok(unit.buffs.some((entry) => entry.key === 'char_1028_texas2:post-skill-atk'));
  const rain = unit.mem.assaultTexasRain;
  assert.ok(rain);
  const priorExpiry = rain.expires;
  unit.hp = Math.floor(unit.s.maxHp / 2);
  battle.kill(enemy, unit);
  battle.assaultRuntime.flush();
  assert.equal(unit.hp, unit.s.maxHp, 'first credited enemy kill restores current HP to max');
  assert.ok(!unit.buffs.some((entry) => entry.key === 'char_1028_texas2:pre-first-kill-talent'), 'native pre-kill AS and damage reduction end on first kill');
  assert.equal(rain.expires, priorExpiry + 4, 'first kill extends the live rain sequence by four seconds');
  assert.equal(battle.skillRedeploy(unit), true, 'the real live free skill-redeployment path succeeds');
  unit.hp = Math.floor(unit.s.maxHp / 2);
  const second = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 4], mods: { hpMul: 100 } });
  battle.kill(second, unit);
  assert.equal(unit.hp, Math.floor(unit.s.maxHp / 2), 'surviving free redeploy does not reset the first-kill marker');
});

test('Texas S3 reapplies its compiled 0.2-second stun on every real periodic damage hit', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_1028_texas2;
  const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  for (const rank of [2, 3, 4]) {
    const piece = { ...pieceFor(body, rank), uid: `texas2:rain-stun:${rank}`, purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT',
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
    const prepared = prepareAssaultBattle({ seed: 8200 + rank, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] }, encounter, { ...data, design });
    const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
    battle.start();
    const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
    const key = unit.rangeKeys.find((candidate) => candidate !== unit.tileR * COLS + unit.tileC && battle.grid.inRect(Math.floor(candidate / COLS), candidate % COLS) && battle.grid.isLow(Math.floor(candidate / COLS), candidate % COLS));
    const targets = Array.from({ length: 4 }, (_, index) => battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: index, pos: [Math.floor(key / COLS), key % COLS], mods: { hpMul: 1000 } }));
    const target = targets[0];
    battle._buildEnemyIndex();
    const stuns = [];
    battle.on('statusApplied', (event) => { if (event.source === unit && event.target === target && event.status === 'stun') stuns.push(event.duration); }, { owner: unit });
    const periodicHits = [];
    battle.on('damaged', (event) => { if (event.source === unit && targets.includes(event.target) && event.amount > 0 && event.dmg?.isSkill && battle.time > 0) periodicHits.push({ time: battle.time, type: event.dmg.type, amount: event.amount, target: event.target }); }, { owner: unit });
    unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
    assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
    for (let tick = 0; tick < 240; tick++) battle.step();
    assert.ok(stuns.filter((duration) => duration === body.fixedSkill.effects[2].values.stunPerHit[rank - 1]).length >= 1,
      `rank ${rank} rain damage emitted a real compiled 0.2-second stun application`);
    const hitGroups = new Map();
    for (const hit of periodicHits) { const key = Math.round(hit.time); (hitGroups.get(key) ?? hitGroups.set(key, []).get(key)).push(hit); }
    assert.equal(hitGroups.size, 7, `rank ${rank} has seven periodic ticks before the eight-second rain expiry`);
    const cap = Number(body.fixedSkill.effects[2].values.maxTarget[rank - 1]);
    const firstTickHits = [...hitGroups.values()][0];
    assert.equal(new Set(firstTickHits.map((hit) => hit.target)).size, cap, `rank ${rank} first tick observes its exact ${cap}-enemy cap`);
    for (const [tick, hits] of hitGroups) assert.ok(new Set(hits.map((hit) => hit.target)).size <= cap, `rank ${rank} tick ${tick} never exceeds its ${cap}-enemy cap`);
    assert.ok(periodicHits.every((hit) => hit.type === 'arts'), 'the rain source description specifies arts damage');
    const orderedTicks = [...hitGroups.keys()].sort((a, b) => a - b);
    assert.equal(orderedTicks[1] - orderedTicks[0], 1, 'periodic damage uses a one-second cadence');
    const scale = Number(body.fixedSkill.effects[2].values.atkScalePerSec[rank - 1]);
    const expectedDamage = unit.s.atk * scale * (1 - target.s.res / 100);
    assert.ok(Math.abs(hitGroups.get(orderedTicks[0])[0].amount - expectedDamage) < 1e-6, `rank ${rank} first rain hit uses compiled ${scale} ATK/s after target RES`);
  }
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

test('Phantom death passive leaves a timed real decoy that slows and damages a nearby enemy', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_1023_ghost2;
  const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const prepared = prepareAssaultBattle({ seed: 746, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 4], mods: { hpMul: 100 } });
  battle.start(); battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  battle.applyStatus(enemy, 'stun', { duration: 3 });
  battle.kill(unit, enemy);
  battle.assaultRuntime.flush();
  const decoy = battle.allyUnits.find((candidate) => candidate.kind === 'device' && candidate.name === '替身');
  assert.ok(decoy?.alive, 'the operator death places the named decoy over the downed body tile');
  const hp = enemy.hp;
  for (let i = 0; i < 45; i++) battle.step();
  assert.ok(enemy.hp < hp, 'the decoy emits real periodic arts damage');
  // 大巴扎卡面：替身只造成 d% 法术伤害；减速只来自模组 003（未装备时不再减速）。
  const nativeSlow = enemy.buffs.find((entry) => entry.status === 'slow' && entry.source === unit);
  assert.ok(!nativeSlow, 'without module 003 the decoy no longer slows');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Blitz tremble applies on the compiled chance and does not refresh after a failed roll', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_4116_blkkgt;
  const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const prepared = prepareAssaultBattle({ seed: 748, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 4], mods: { hpMul: 100 } });
  battle.start(); battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  let trembleApplications = 0;
  battle.on('statusApplied', ({ source, target, status }) => { if (source === unit && target === enemy && status === 'tremble') trembleApplications++; }, { owner: unit });
  battle.rng = () => 0;
  battle.dealDamage(unit, enemy, { amount: 1, type: 'true' });
  battle.assaultRuntime.flush();
  const tremble = enemy.findBuff('char_4116_blkkgt:tremble');
  assert.ok(tremble, 'a successful 10% roll applies the real tremble status');
  assert.equal(trembleApplications, 1);
  battle.rng = () => 1;
  battle.dealDamage(unit, enemy, { amount: 1, type: 'true' });
  battle.assaultRuntime.flush();
  assert.equal(trembleApplications, 1, 'a failed chance neither applies nor refreshes the status');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('handled module hooks run around a real multi-target cast and the afterCast SP delta is consumed', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_264_f12yin;
  const piece = { ...pieceFor(body, 4, 'uniequip_002_f12yin'), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT', permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 7018, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
  const source = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const encounter = { ...source, wave: { ...source.wave, dp: { ...source.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle(state, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  // Distinct enemies may share the same legal lane tile; rows below the field are not attack targets.
  assert.equal(battle.grid.groundPassable(9, 3), true);
  for (const pos of [[9, 3], [9, 3], [9, 3], [9, 4]]) battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos, mods: { hpMul: 100 } });
  battle.start();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  for (const key of unit.rangeKeys ?? []) {
    const row = Math.floor(key / COLS), col = key % COLS;
    if ((row === unit.tileR && col === unit.tileC) || !battle.grid.inRect(row, col) || !battle.grid.isLow(row, col)) continue;
    battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [row, col], mods: { hpMul: 100 } });
  }
  battle._buildEnemyIndex();
  unit.skill.charges = 1;
  unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  assert.ok(unit.mem.assaultLastSkillTargetCount >= 3, 'the typed effect selected and resolved enough real targets');
  assert.equal(unit.skill.sp, 1, 'the module afterCast hook grants its one SP after the actual multi-target effect');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Ulpia heals by the compiled amount after each actual damage event', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_4145_ulpia;
  const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT', permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 7012, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
  const source = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const encounter = { ...source, wave: { ...source.wave, dp: { ...source.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle(state, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { hpMul: 100 } });
  for (const pos of [[8, 2], [10, 2], [9, 4], [8, 3]]) battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos, mods: { hpMul: 100 } });
  battle.start();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  unit.hp -= 500;
  let passiveHeal = 0;
  battle.on('heal', ({ source: healer, target, amount }) => { if (healer === unit && target === unit) passiveHeal += amount; }, { owner: unit });
  assert.equal(battle.forceAttack(enemy, [unit]), true);
  battle.assaultRuntime.flush();
  assert.ok(passiveHeal >= 100, 'the low-HP heal uses the compiled 160-point four-star value, subject to missing HP');
});

test('Ulpia S3 reserves its original tile during the anchor dash and returns to that exact tile', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_4145_ulpia;
  const piece = { ...pieceFor(body, 4), uid: 'ulpia:anchor-owner', purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const otherBody = runtime.bodies.char_127_estell;
  const otherPiece = { ...pieceFor(otherBody, 4), uid: 'ulpia:anchor-intruder', purchaseCharId: otherBody.purchaseCharId, row: 9, col: 7, dir: 'LEFT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const source = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const encounter = { ...source, wave: { ...source.wave, dp: { ...source.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 7013, life: 20, day: 1, hour: 1, pieces: [piece, otherPiece], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 4], mods: { hpMul: 100, speed: 0 } });
  battle.start();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  const intruder = battle.allyUnits.find((candidate) => candidate.uid === otherPiece.uid);
  battle.kill(intruder, null);
  battle.applyStatus(enemy, 'stun', { duration: 40 });
  const enemyHp = enemy.hp;
  const home = [unit.tileR, unit.tileC];
  unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  assert.notDeepEqual([unit.tileR, unit.tileC], home, 'Ulpian moves to the real low tile beside the anchor hit');
  const marker = battle.allyUnits.find((candidate) => candidate.kind === 'device' && candidate.name === '从不混淆的方向' && candidate.alive);
  assert.ok(marker && marker.tileR === home[0] && marker.tileC === home[1], 'the native anchor marker occupies the original deployment tile');
  assert.equal(battle.redeploy(intruder, { free: true, tile: home }), false, 'another operator cannot deploy onto the reserved anchor tile');
  assert.ok(enemy.hp < enemyHp, 'the anchor landing point applies the real S3 hit');
  for (let i = 0; i < 800; i++) battle.step();
  assert.deepEqual([unit.tileR, unit.tileC], home, 'the timed skill returns Ulpian to the exact original tile');
  assert.equal(marker.alive, false, 'the reservation marker is removed after the return');
  assert.equal(battle.redeploy(intruder, { free: true, tile: home }), false, 'Ulpian continues to occupy the original tile after returning');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Exusiai skill ammo shares external Laterano capacity and consumes one bullet per fired attack', () => {
  const design = loadAssaultDesign(), data = getAssaultData(), body = runtime.bodies.char_1032_excu2;
  const piece = { ...pieceFor(body, 4), uid: 'excu2:shared-ammo', purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const source = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const encounter = { ...source, wave: { ...source.wave, dp: { ...source.wave.dp, init: 99 } } };
  const prepared = prepareAssaultBattle({ seed: 8112, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] }, encounter, { ...data, design });
  const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
  battle.start();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  const targetKey = unit.rangeKeys.find((key) => battle.grid.isLow(Math.floor(key / COLS), key % COLS) &&
    !(Math.floor(key / COLS) === unit.tileR && key % COLS === unit.tileC));
  assert.ok(Number.isInteger(targetKey), 'Exusiai has a real low target tile in attack range');
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [Math.floor(targetKey / COLS), targetKey % COLS], mods: { hpMul: 100 } });
  battle._buildEnemyIndex();
  unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
  const baseSelfHeal = unit.profile.selfHeal;
  assert.equal(baseSelfHeal, 250, 'the Reaper profile trait starts at its compiled 250 HP value');
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  assert.equal(unit.profile.selfHeal, 750, 'rank four applies the source traitHealMultiplier of three to the live Reaper profile');
  setAssaultAmmoCapacityBonus(unit, 'fixture:laterano-bond', 3);
  assert.deepEqual(assaultAmmoState(unit), { current: 16, capacity: 20 }, 'the native on-field Laterano talent contributes one bullet in addition to the named external +3 capacity');
  assert.equal(reloadAssaultAmmo(battle, unit, unit, 3, 'fixture:laterano-reload'), 3);
  assert.equal(assaultAmmoState(unit).current, 19);
  const spent = [];
  battle.on('ammoUsed', (event) => { if (event.unit === unit && event.assaultAmmo) spent.push(event.amount); }, { owner: unit });
  unit.hp -= 1000;
  const hpBeforeAmmoAttack = unit.hp;
  assert.equal(battle.forceAttack(unit, [enemy]), true);
  assert.deepEqual(spent, [1]);
  assert.equal(assaultAmmoState(unit).current, 18);
  assert.equal(unit.hp - hpBeforeAmmoAttack, 750, 'a real skill-ammo attack heals exactly the multiplied Reaper trait value');
  for (let shot = 0; shot < 18; shot++) assert.equal(battle.forceAttack(unit, [enemy]), true);
  assert.equal(unit.mem.assaultAmmo, null, 'the last real bullet ends the skill');
  assert.equal(unit.profile.selfHeal, baseSelfHeal, 'ending the ammo skill restores the 250 HP Reaper profile value');
});

test('Exusiai rank two multiplies the native Reaper self-heal profile by two during ammo attacks', () => {
  const body = runtime.bodies.char_1032_excu2;
  const { battle, pieces } = cardBattle([{ body, star: 2 }], 8113, null, 99);
  const unit = battle.allyUnits.find((candidate) => candidate.uid === pieces[0].uid);
  const targetKey = unit.rangeKeys.find((key) => battle.grid.isLow(Math.floor(key / COLS), key % COLS) &&
    !(Math.floor(key / COLS) === unit.tileR && key % COLS === unit.tileC));
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [Math.floor(targetKey / COLS), targetKey % COLS], mods: { hpMul: 100 } });
  battle._buildEnemyIndex();
  unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
  assert.equal(unit.profile.selfHeal, 250);
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  assert.equal(unit.profile.selfHeal, 500);
  unit.hp -= 1000;
  const before = unit.hp;
  assert.equal(battle.forceAttack(unit, [enemy]), true);
  assert.equal(unit.hp - before, 500, 'a real ammo attack heals the native 250-point trait multiplied by the compiled rank-two value');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('each of the 46 fixed skills executes its typed handler in a real Assault Battle when cast is ready', () => {
  const design = loadAssaultDesign(), data = getAssaultData();
  const sourceEncounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const encounter = { ...sourceEncounter, wave: { ...sourceEncounter.wave, dp: { ...sourceEncounter.wave.dp, init: 99 } } };
  for (const [index, charId] of Object.keys(assaultKits).entries()) {
    const body = runtime.bodies[charId];
    const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
    const fixturePieces = [piece];
    if (charId === 'char_294_ayer') {
      const blocker = runtime.bodies.char_127_estell;
      fixturePieces.push({ ...pieceFor(blocker, 4), uid: 'matrix:ayer:blocker', purchaseCharId: blocker.purchaseCharId,
        row: piece.row, col: piece.col + 1, dir: 'RIGHT', summonPresets: [] });
    }
    const state = { seed: 8000 + index, life: 20, day: 1, hour: 1, pieces: fixturePieces, nextBattleEffects: [] };
    const prepared = prepareAssaultBattle(state, encounter, { ...data, design });
    const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
    for (const pos of [[9, 3], [8, 2], [10, 2], [9, 4], [8, 3]]) battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos, mods: { hpMul: 100 } });
    battle.start();
    const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
    assert.ok(unit.alive && unit.deployed, `${charId} deploys with the test wave's initial DP`);
    for (const key of unit.rangeKeys ?? []) {
      const row = Math.floor(key / COLS), col = key % COLS;
      if ((row === unit.tileR && col === unit.tileC) || !battle.grid.inRect(row, col) || !battle.grid.isLow(row, col)) continue;
      battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [row, col], mods: { hpMul: 100 } });
    }
    battle._buildEnemyIndex();
    if (charId === 'char_294_ayer') {
      const blocker = battle.allyUnits.find(candidate => candidate.uid === 'matrix:ayer:blocker');
      const target = battle.enemies.find(candidate => candidate.tileR === blocker.tileR && candidate.tileC === blocker.tileC);
      assert.ok(target, 'Ayer matrix has an enemy at the actual neighboring ally tile');
      assert.equal(battle._checkBlock(target), true);
      assert.equal(target.blockedBy, blocker, 'Ayer targets a genuinely ally-blocked enemy');
    }
    if (['char_491_humus', 'char_1023_ghost2'].includes(charId)) {
      const blocked = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [unit.tileR, unit.tileC], mods: { hpMul: 100 } });
      assert.equal(battle._checkBlock(blocked), true, `${charId} fixture establishes actual native self blocking`);
      assert.equal(blocked.blockedBy, unit);
    }
    const player = battle.getPlayer(unit.ownerId);
    player.dp = 1000;
    const assaultPlayer = battle._pp(unit.ownerId);
    if (assaultPlayer) { assaultPlayer.dp = 1000; assaultPlayer.coins = 100; }
    unit.skill.charges = 1;
    unit.skill.sp = unit.skill.spCost;
    assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true, `${charId} fixed skill cast with ready SP and fixture targets`);
  }
});

test('every advanced module at both unlock ranks enters and casts its owning skill in a real Assault Battle', () => {
  const design = loadAssaultDesign(), data = getAssaultData();
  const sourceEncounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
  const encounter = { ...sourceEncounter, wave: { ...sourceEncounter.wave, dp: { ...sourceEncounter.wave.dp, init: 99 } } };
  let seed = 9000;
  for (const charId of Object.keys(assaultKits)) for (const plan of (runtime.bodies[charId].modulePlans ?? []).filter((entry) => entry.type === 'ADVANCED')) for (const star of [3, 4]) {
    const body = runtime.bodies[charId];
    const piece = { ...pieceFor(body, star, plan.id), purchaseCharId: body.purchaseCharId, row: 9, col: 3, dir: 'RIGHT',
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
    const fixturePieces = [piece];
    if (charId === 'char_294_ayer') {
      const blocker = runtime.bodies.char_127_estell;
      fixturePieces.push({ ...pieceFor(blocker, 4), uid: 'matrix:ayer:blocker', purchaseCharId: blocker.purchaseCharId,
        row: piece.row, col: piece.col + 1, dir: 'RIGHT', summonPresets: [] });
    }
    const state = { seed: seed++, life: 20, day: 1, hour: 1, pieces: fixturePieces, nextBattleEffects: [] };
    const prepared = prepareAssaultBattle(state, encounter, { ...data, design });
    const battle = createAssaultBattle(prepared, { ...data, design, kits: assaultKits });
    battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 4], mods: { hpMul: 100 } });
    battle.start();
    const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
    assert.ok(unit.alive && unit.deployed, `${charId} ${plan.id} ${star}★ deploys under the explicit initial-DP fixture`);
    for (const key of unit.rangeKeys ?? []) {
      const row = Math.floor(key / COLS), col = key % COLS;
      if ((row === unit.tileR && col === unit.tileC) || !battle.grid.inRect(row, col) || !battle.grid.isLow(row, col)) continue;
      battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [row, col], mods: { hpMul: 100 } });
    }
    battle._buildEnemyIndex();
    if (charId === 'char_294_ayer') {
      const blocker = battle.allyUnits.find(candidate => candidate.uid === 'matrix:ayer:blocker');
      const target = battle.enemies.find(candidate => candidate.tileR === blocker.tileR && candidate.tileC === blocker.tileC);
      assert.ok(target, 'Ayer matrix has an enemy at the actual neighboring ally tile');
      assert.equal(battle._checkBlock(target), true);
      assert.equal(target.blockedBy, blocker, 'Ayer targets a genuinely ally-blocked enemy');
    }
    if (['char_491_humus', 'char_1023_ghost2'].includes(charId)) {
      const blocked = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [unit.tileR, unit.tileC], mods: { hpMul: 100 } });
      assert.equal(battle._checkBlock(blocked), true, `${charId} fixture establishes actual native self blocking`);
      assert.equal(blocked.blockedBy, unit);
    }
    const player = battle._pp(unit.ownerId);
    if (player) { player.dp = 1000; player.coins = 100; }
    unit.skill.charges = 1;
    unit.skill.sp = unit.skill.spCost;
    assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true, `${charId} ${plan.id} ${star}★ fixed skill with module selected`);
  }
});

test('summon mappings use exact compiled native token IDs and the radiant sun has a strict skill KIT', () => {
  for (const id of ['token_10022_kazema_shadow', 'token_10040_siege2_vlion', 'token_10019_nearl2_sword']) {
    assert.ok(runtime.summons[id], id);
    assert.equal(typeof assaultTokenKits[id], 'function', id);
  }
  const sun = assaultTokenKits.token_10019_nearl2_sword();
  assert.equal(sun.skill.id, 'sktok_nearl2_3');
  assert.equal(typeof sun.skill.assaultCast, 'function');
  assert.equal(typeof sun.install, 'function');
});

test('four-star Silverash with the selected advanced module installs leader and anti-stealth state in a real Battle', () => {
  const design = loadAssaultDesign();
  const body = runtime.bodies.char_172_svrash;
  const piece = { ...pieceFor(body, 4, 'uniequip_002_svrash'), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 731, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((encounter) => encounter.kind === 'normal'), { ...getAssaultData(), design });
  const battle = createAssaultBattle(prepared, { ...getAssaultData(), design, kits: assaultKits });
  battle.start();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  assert.ok(unit);
  assert.ok(unit.buffs.some((entry) => entry.key === 'char_172_svrash:leader-atk'));
  assert.ok(unit.buffs.some((entry) => entry.key === 'char_172_svrash:leader-redeploy'));
  assert.equal(unit.mem.assaultSilverAshModule, true);
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

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('four-star Exusiai consumes five real bullets per attack through Battle attack events', () => {
  const design = loadAssaultDesign();
  const body = runtime.bodies.char_1041_angel2;
  const piece = { ...pieceFor(body, 4, 'uniequip_002_angel2'), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 995, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((encounter) => encounter.kind === 'normal'), { ...getAssaultData(), design });
  const battle = createAssaultBattle(prepared, { ...getAssaultData(), design, kits: assaultKits });
  const target = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { hpMul: 100 } });
  battle.start();
  battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  unit.skill.charges = 1;
  unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  assert.equal(unit.mem.assaultAmmo.left, 60, 'three-star advanced module adds ten rounds to the compiled 50-round capacity');
  unit.hp = Math.max(1, unit.hp - 100);
  const hpBeforeAmmo = unit.hp;
  assert.equal(battle.forceAttack(unit, [target]), true);
  battle.assaultRuntime.flush();
  battle.step();
  assert.ok(unit.hp > hpBeforeAmmo, 'a real ammoUsed event heals Exusiai through her typed talent binding');
  for (let i = 0; i < 50; i++) battle.step();
  const damageEvents = battle.drainEvents().filter((event) => event[0] === 'dmg' && event[1] === target.id);
  assert.ok(damageEvents.length >= 5, 'normal attacks consume and resolve a burst of ammo hits');
  assert.equal(unit.mem.assaultAmmo.left % 5, 0);
  assert.ok(unit.mem.assaultAmmo.left < 60, 'ammo count includes the module increase and decreases only after real attack events');
});

test('four-star Exusiai free-redeploys the longest-waiting fallen operator at its rest tile', () => {
  const design = loadAssaultDesign();
  const body = runtime.bodies.char_1041_angel2;
  const fallenBody = runtime.bodies.char_127_estell;
  const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const fallenPiece = { ...pieceFor(fallenBody, 2), uid: 'fallen-estell', purchaseCharId: fallenBody.purchaseCharId, row: 9, col: 4, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 996, life: 20, day: 1, hour: 1, pieces: [piece, fallenPiece], nextBattleEffects: [] };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((encounter) => encounter.kind === 'normal'), { ...getAssaultData(), design });
  const battle = createAssaultBattle(prepared, { ...getAssaultData(), design, kits: assaultKits });
  battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { hpMul: 100 } });
  battle.start();
  battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  const fallen = battle.allyUnits.find((candidate) => candidate.uid === fallenPiece.uid);
  battle.loseHp(fallen, fallen.hp + 1, { source: null });
  assert.equal(fallen.alive, false);
  unit.skill.charges = 1;
  unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  assert.equal(fallen.alive, true);
  assert.equal(fallen.tileR, fallenPiece.row);
  assert.equal(fallen.tileC, fallenPiece.col);
  assert.ok(fallen.skill.sp >= 6);
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Chongyue restores compiled SP once when one instant skill cast kills multiple enemies', () => {
  const body = runtime.bodies.char_2024_chyue;
  const { battle, pieces } = cardBattle([{ body }], 1101);
  const first = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { hpMul: 100 } });
  const second = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 1, pos: [8, 3], mods: { hpMul: 100 } });
  battle._buildEnemyIndex(); first.hp = 1; second.hp = 1;
  const unit = battle.allyUnits.find((candidate) => candidate.uid === pieces[0].uid);
  unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  assert.equal(first.alive, false); assert.equal(second.alive, false);
  assert.equal(unit.skill.sp, body.modePassives[0].values.sp[3], 'same-cast multi-kill gives exactly one compiled 3 SP grant');
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

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('four-star Thorn Alter places a ramping field that deals arts damage and applies defense reduction', () => {
  const design = loadAssaultDesign();
  const body = runtime.bodies.char_1039_thorn2;
  const piece = { ...pieceFor(body, 4, 'uniequip_002_thorn2'), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 1002, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((encounter) => encounter.kind === 'normal'), { ...getAssaultData(), design });
  const battle = createAssaultBattle(prepared, { ...getAssaultData(), design, kits: assaultKits });
  const target = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { hpMul: 100 } });
  battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 10], mods: { hpMul: 100 } });
  battle.start();
  battle._buildEnemyIndex();
  battle.applyStatus(target, 'stun', { duration: 5 });
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  unit.skill.charges = 1;
  unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
  const hp = target.hp;
  for (let i = 0; i < 40; i++) battle.step();
  assert.ok(target.hp < hp, 'the zone applies periodic arts damage');
  const debuff = target.buffs.find((entry) => entry.key.startsWith('char_1039_thorn2:field-debuff:'));
  assert.ok(debuff?.mods?.defPct < 0 && debuff.mods.resFlat < 0, 'the field weakens defense and resistance while active');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('four-star Eltlchi steals target max HP and applies her compiled timed arts damage on real attacks', () => {
  const design = loadAssaultDesign();
  const body = runtime.bodies.char_4010_etlchi;
  const piece = { ...pieceFor(body, 4), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 1004, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
  const data = { ...getAssaultData(), design };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((encounter) => encounter.kind === 'normal'), data);
  const battle = createAssaultBattle(prepared, { ...data, kits: assaultKits });
  const enemy = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 3], mods: { hpMul: 100 } });
  battle.start();
  battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  unit.hp = unit.s.maxHp / 2;
  const maxHp = enemy.s.maxHp;
  const enemyHp = enemy.hp;
  assert.equal(battle.forceAttack(unit, [enemy]), true);
  assert.equal(enemy.s.maxHp, maxHp - unit.mem.assaultEtlchiStolen, 'each attack steals compiled enemy maximum HP');
  assert.equal(unit.mem.assaultEtlchiStolen, 75, 'four-star body uses its compiled per-hit theft value');
  for (let i = 0; i < 50; i++) battle.step();
  assert.ok(enemy.hp < enemyHp - 50, 'the compiled timed arts damage continues after the attack');
});

test('four-star Eltlchi summons the native enemy entity as host-scaled candles and transfers candle hits', () => {
  const design = loadAssaultDesign();
  const source = getAssaultData();
  const nativeDog = source.nativeData.enemies.enemy_1000_gopro_2;
  const nativeData = { ...source.nativeData, enemies: { ...source.nativeData.enemies, enemy_5601_entlec: {
    ...nativeDog, key: 'enemy_5601_entlec', name: '心烛', rank: 'NORMAL', notCountInTotal: true,
    stats: { ...nativeDog.stats, maxHp: 1000, atk: 1000, def: 1000, res: 1000, moveSpeed: 0.45, dmgType: 'none', lpr: 0 },
  } } };
  const data = { ...getAssaultData({ nativeData }), design };
  const body = runtime.bodies.char_4010_etlchi;
  const piece = { ...pieceFor(body, 4, 'uniequip_002_etlchi'), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
    permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
  const state = { seed: 1008, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] };
  const prepared = prepareAssaultBattle(state, design.encounters.encounters.find((encounter) => encounter.kind === 'normal'), data);
  const battle = createAssaultBattle(prepared, { ...data, kits: assaultKits });
  for (const pos of [[10, 3], [9, 3], [8, 3]]) battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos, mods: { hpMul: 100 } });
  battle.start();
  battle._buildEnemyIndex();
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  const atkBeforeSkill = unit.s.atk;
  unit.skill.charges = 1;
  unit.skill.sp = unit.skill.spCost;
  assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true,
    JSON.stringify({ alive: unit.alive, deployed: unit.deployed, sp: unit.skill.sp, cost: unit.skill.spCost, charges: unit.skill.charges, canCast: unit.skill.canCast?.(), range: unit.rangeKeys.map((key) => [Math.floor(key / COLS), key % COLS]), targets: battle.enemies.map((enemy) => [Math.round(enemy.y), Math.round(enemy.x), enemy.alive]), candles: unit.mem.assaultEtlchiCandles?.length }));
  const candles = battle.enemies.filter((enemy) => enemy.mem.candleOwner === unit);
  assert.equal(candles.length, 3, JSON.stringify({ range: unit.rangeKeys.map((key) => [Math.floor(key / COLS), key % COLS]), targets: battle.enemies.map((enemy) => [Math.round(enemy.y), Math.round(enemy.x), enemy.alive, enemy.deployed, enemy.hidden, enemy.isFlying]), created: unit.mem.assaultEtlchiCandles?.length }));
  assert.ok(unit.s.atk > atkBeforeSkill, 'the same S3 cast applies the compiled attack buff');
  for (const candle of candles) {
    assert.equal(candle.defId, 'enemy_5601_entlec');
    assert.ok(Math.abs(candle.s.maxHp / candle.mem.candleHost.hp - 0.7) < 1e-9, 'module 002 transfers its 70% host-HP ratio');
    assert.equal(candle.s.def, candle.mem.candleHost.s.def);
    assert.equal(candle.s.res, candle.mem.candleHost.s.res);
    assert.equal(candle.profile.noAttack, true);
  }
  const candle = candles[0], host = candle.mem.candleHost, before = host.hp;
  assert.equal(battle.forceAttack(unit, [candle]), true);
  assert.equal(host.hp, before, 'the host transfer waits for the current damage event to finish');
  battle.assaultRuntime.flush();
  assert.ok(host.hp < before, 'the Eltlchi attack transfers candle damage to its host');
  for (let i = 0; i < 500; i++) battle.step();
  assert.ok(candles.every((entry) => !entry.alive), 'the compiled skill duration cleans up all candles');
});

test('four-star Eltlchi third module extends native candles and doubles theft from a candle host', () => {
  const design = loadAssaultDesign(), data = { ...getAssaultData(), design }, body = runtime.bodies.char_4010_etlchi;
  assert.ok(data.nativeData.enemies.enemy_5601_entlec, 'the auxiliary candle uses its actual compiled native enemy source');
  const make = (moduleId, seed) => {
    const piece = { ...pieceFor(body, 4, moduleId), purchaseCharId: body.purchaseCharId, row: 9, col: 2, dir: 'RIGHT',
      permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], summonPresets: [] };
    const encounter = design.encounters.encounters.find((entry) => entry.kind === 'normal');
    const prepared = prepareAssaultBattle({ seed, life: 20, day: 1, hour: 1, pieces: [piece], nextBattleEffects: [] }, encounter, data);
    const battle = createAssaultBattle(prepared, { ...data, kits: assaultKits });
    for (const pos of [[10, 3], [9, 3], [8, 3]]) {
      battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos, mods: { hpMul: 100 },
        route: { motion: 'WALK', start: pos, end: pos, steps: [{ t: 'wait', s: 99999 }] } });
    }
    battle.start(); battle._buildEnemyIndex();
    const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
    unit.skill.charges = 1; unit.skill.sp = unit.skill.spCost;
    assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true);
    return { battle, unit, candles: [...unit.mem.assaultEtlchiCandles] };
  };
  const enabled = make('uniequip_003_etlchi', 1009), baseline = make(null, 1010);
  assert.equal(enabled.candles.length, 3); assert.equal(baseline.candles.length, 3);
  assert.equal(enabled.battle.forceAttack(enabled.unit, [enabled.candles[0]]), true);
  enabled.battle.assaultRuntime.flush();
  assert.equal(enabled.unit.mem.assaultEtlchiStolen, 150, 'rank-four module takes two compiled 75-HP increments through the real candle attack');
  enabled.battle.applyStatus(enabled.unit, 'stun', { duration: 100 });
  baseline.battle.applyStatus(baseline.unit, 'stun', { duration: 100 });
  while (enabled.battle.time < 20.1) enabled.battle.step();
  while (baseline.battle.time < 20.1) baseline.battle.step();
  assert.ok(enabled.candles.every((candle) => candle.alive), JSON.stringify({ time: enabled.battle.time, candles: enabled.candles.map((candle) => [candle.alive, candle.hp, candle.mem.candleHost?.alive]), owner: enabled.unit.alive }));
  assert.ok(baseline.candles.every((candle) => !candle.alive), 'baseline candles expire at the native 20-second duration');
  while (enabled.battle.time < 25.1) enabled.battle.step();
  assert.ok(enabled.candles.every((candle) => !candle.alive), 'selected module candles expire after exactly 25 seconds');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('sourceless environment damage skips attacker-only retaliation but keeps owner damage passives', () => {
  const sophia = runtime.bodies.char_265_sophia, morgan = runtime.bodies.char_154_morgan, estell = runtime.bodies.char_127_estell;
  const { battle, pieces } = cardBattle([
    { body: sophia, row: 9, col: 2 },
    { body: morgan, row: 10, col: 2 },
    { body: estell, row: 11, col: 2 },
  ], 1207);
  const sophiaUnit = battle.allyUnits.find((unit) => unit.uid === pieces[0].uid);
  const morganUnit = battle.allyUnits.find((unit) => unit.uid === pieces[1].uid);
  const estellUnit = battle.allyUnits.find((unit) => unit.uid === pieces[2].uid);

  morganUnit.hp = morganUnit.s.maxHp * 0.55;
  battle.dealDamage(null, morganUnit, { amount: morganUnit.s.maxHp * 0.2, type: 'true', canDodge: false, tags: ['terrain'] });
  battle.assaultRuntime.flush();
  assert.ok(morganUnit.findBuff('char_154_morgan:low-hp-passive'), 'Morgan retains her own low-HP passive on sourceless terrain damage');

  const environmentHit = sophiaUnit.s.maxHp * 0.1;
  const sophiaHp = sophiaUnit.hp;
  battle.dealDamage(null, sophiaUnit, { amount: environmentHit, type: 'true', canDodge: false, tags: ['terrain'] });
  battle.assaultRuntime.flush();
  assert.ok(sophiaUnit.hp < sophiaHp, 'sourceless environment damage still applies to its real target');

  // 大巴扎：鞭刃第二行「当周围干员受到近战攻击时，对攻击者造成 a% 物理伤害」——不再要求阻挡 3 个，只看周围与近战。
  const attacker = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [9, 4], mods: { hpMul: 100, def: 0, speed: 0 } });
  const attackerHp = attacker.hp;
  battle.dealDamage(attacker, estellUnit, { amount: 1, type: 'phys', isAttack: true });
  battle.assaultRuntime.flush();
  assert.equal(attacker.hp, attackerHp, 'Estelle is two tiles away from Sophia and the hit is not melee: no retaliation');
  const melee = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [10, 3], mods: { hpMul: 100, def: 0, speed: 0 } });
  const meleeHp = melee.hp;
  battle.dealDamage(melee, morganUnit, { amount: 1, type: 'phys', isAttack: true });
  battle.assaultRuntime.flush();
  assert.ok(melee.hp < meleeHp, 'a genuine enemy Unit melee-attacking an ally around Sophia receives Sophia’s retaliation');
  assert.equal(battle.errorCount, 0, 'known environment sources are handled without weakening strict Unit validation');
});
