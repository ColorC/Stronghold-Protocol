import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { getAssaultField, prepareAssaultBattle, createAssaultBattle, runAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultFieldRoutes, assaultNativeTemplateId, buildAssaultBattleInput } from '../../shared/assault/battle-input.js';
import { DataSource } from '../../server/sim/simdata.js';
import { templateOf } from '../../server/sim/content/bosses.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { projectAssaultBattleDto } from '../../server/modes/assault/http.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const loaded = getAssaultData({ runtime: loadAssaultRuntime() });
const design = loadAssaultDesign();
const encounterByKind = (kind) => design.encounters.encounters.find((entry) => entry.kind === kind);
const fixturePiece = (runtime, { charId = Object.keys(runtime.bodies)[0], star = 1, row = 9, col = 2, uid = 'fixture-op', ...extra } = {}) => ({
  uid, charId, purchaseCharId: runtime.bodies[charId].purchaseCharId, star, sourceCopies: 1,
  permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [], moduleChoices: { [charId]: null },
  row, col, dir: 'RIGHT', summonPresets: [], ...extra,
});
const fixtureKit = (charId) => ({ [charId]: () => ({ skill: { id: 'explicit-engine-fixture', kind: 'passive', onStart() {} } }) });
const battleState = (runtime, extra = {}) => ({ seed: 20261009, life: 20, day: 1, hour: 1,
  pieces: [fixturePiece(runtime)], nextBattleEffects: [], ...extra });


test('field preparation uses actual native normal and bossL stages and legal deploy maps', () => {
  for (const kind of ['normal', 'final']) {
    const encounter = encounterByKind(kind);
    const prepared = prepareAssaultBattle(battleState(loaded.runtime), encounter, { ...loaded, design });
    const dto=projectAssaultBattleDto({runId:'clock-contract',revision:1},prepared).battle;
    assert.deepEqual(dto.config,prepared.config,'HTTP projection must preserve the simulator clock');
    assert.equal(dto.config.battleSeconds,encounter.id.startsWith('enc_final_')?600:120);
    assert.equal(prepared.field.stageId, encounter.stageId);
    assert.ok(prepared.field.normalizedDeployMap instanceof Map);
    assert.ok(prepared.field.normalizedDeployMap.size > 0);
    assert.equal(prepared.field.field, kind === 'final' ? 'bossL' : 'normal');
  }
  const normal = getAssaultField({}, encounterByKind('normal'), loaded);
  const final = getAssaultField({}, encounterByKind('final'), loaded);
  assert.ok(normal.stage.devices.some((device) => device.role === 'crate'));
  assert.ok(!normal.stage.devices.some((device) => ['coldWind', 'turret'].includes(device.role)));
  assert.ok(final.normalizedDeployMap.size > 0);
  const byId = getAssaultField({}, encounterByKind('normal').id, { ...loaded, design });
  assert.equal(byId.stageId, normal.stageId);
  assert.deepEqual([...byId.normalizedDeployMap], [...normal.normalizedDeployMap]);
});

test('all 36 encounters resolve native stage/wave/enemy/boss sources and expand real wave counts', () => {
  const counts = [];
  for (const encounter of design.encounters.encounters) {
    const prepared = prepareAssaultBattle(battleState(loaded.runtime), encounter, { ...loaded, design });
    const built = buildAssaultBattleInput(prepared, { ...loaded, kits: fixtureKit(loaded.runtime.bodies[Object.keys(loaded.runtime.bodies)[0]].charId) });
    counts.push(built.spawnSpecs.reduce((sum, spawn) => sum + spawn.count, 0));
    assert.ok(built.battle.routes.length > 0, encounter.id);
    assert.ok(built.spawnSpecs.every((spawn) => (Array.isArray(loaded.nativeData.enemies) ? loaded.nativeData.enemies : Object.values(loaded.nativeData.enemies)).some((enemy) => enemy.key === spawn.enemyKey)), encounter.id);
    assert.ok((Array.isArray(loaded.nativeData.waves) ? loaded.nativeData.waves : Object.values(loaded.nativeData.waves)).some((wave) => wave.id === prepared.waveId), encounter.id);
    if (encounter.kind === 'final') {
      assert.equal(built.battle.kind, 'boss');
      assert.ok(built.battle.sharedBoss.maxHp > 0);
      assert.ok(built.spawnSpecs.some((spawn) => spawn.tag === 'boss'));
    } else assert.equal(built.battle.waveTemplate, undefined, `${encounter.id}: non-final template behavior remains unchanged`);
  }
  assert.equal(counts.length, 36);
  assert.ok(counts.every((count) => count > 0));
});

test('all six final battles retain source identity and explicitly adopt their exact native solo wave variant', () => {
  const finals = design.encounters.encounters.filter((entry) => entry.kind === 'final');
  assert.equal(finals.length, 6);
  for (const encounter of finals) {
    const sourceId = encounter.waveSourceRef.pointer.slice(1);
    const source = loaded.nativeData.waves[sourceId];
    const nativeTemplateId = `${sourceId}_s`;
    const native = loaded.nativeData.waves[nativeTemplateId];
    assert.ok(source, `${encounter.id}: full source wave ${sourceId} exists`);
    assert.ok(native, `${encounter.id}: native solo variant ${nativeTemplateId} exists`);
    assert.equal(source.solo, false);
    assert.equal(native.solo, true);
    assert.equal(native.kind, source.kind);
    assert.equal(native.bossId, source.bossId);
    const prepared = prepareAssaultBattle(battleState(loaded.runtime), encounter, { ...loaded, design });
    assert.equal(prepared.waveId, sourceId, `${encounter.id}: source ref is authoritative`);
    assert.equal(prepared.nativeTemplateId, nativeTemplateId, `${encounter.id}: select native solo variant explicitly`);
    const built = buildAssaultBattleInput(prepared, { ...loaded, kits: fixtureKit(loaded.runtime.bodies[Object.keys(loaded.runtime.bodies)[0]].charId) });
    assert.equal(built.battle.nativeTemplateId, nativeTemplateId);
    assert.deepEqual(built.battle.waveTemplate, native, `${encounter.id}: preserve complete native solo template`);
    const legacyPrepared = { ...prepared }; delete legacyPrepared.nativeTemplateId;
    const legacyBuilt = buildAssaultBattleInput(legacyPrepared, { ...loaded, kits: fixtureKit(loaded.runtime.bodies[Object.keys(loaded.runtime.bodies)[0]].charId) });
    assert.equal(legacyBuilt.battle.nativeTemplateId, nativeTemplateId, 'persisted pre-field battles derive the same verified solo variant');
    assert.throws(() => buildAssaultBattleInput({ ...prepared, nativeTemplateId: sourceId }, { ...loaded, kits: fixtureKit(loaded.runtime.bodies[Object.keys(loaded.runtime.bodies)[0]].charId) }), /native template mismatch/);
    assert.deepEqual(built.battle.spawns, built.spawnSpecs, `${encounter.id}: retain compiled solo spawn specs`);
    assert.deepEqual(built.battle.routes, assaultFieldRoutes(encounter.wave.routes, prepared.field.stage, prepared.field.field), `${encounter.id}: retain projected solo routes`);
    const battle = createAssaultBattle(prepared, { ...loaded, kits: fixtureKit(loaded.runtime.bodies[Object.keys(loaded.runtime.bodies)[0]].charId) });
    assert.equal(templateOf(battle)?.id, nativeTemplateId, `${encounter.id}: native boss hooks resolve the explicit solo template`);
    assert.deepEqual(templateOf(battle).branches, native.branches);
    assert.deepEqual(templateOf(battle).extraRoutes, native.extraRoutes);
    assert.deepEqual(templateOf(battle).devices, native.devices);
    assert.deepEqual(templateOf(battle).patrol, native.patrol);
  }
});

test('final source identity fails closed, solo variant errors reject, and boss3 executes its native solo summon route', () => {
  const encounter = encounterByKind('final');
  const wrong = { ...encounter, waveSourceRef: { ...encounter.waveSourceRef, pointer: '/act1autochess_h07_03_s' } };
  assert.throws(() => prepareAssaultBattle(battleState(loaded.runtime), wrong, { ...loaded, design }), /wave source mismatch/);
  assert.throws(() => prepareAssaultBattle(battleState(loaded.runtime), { ...encounter, waveSourceRef: { ...encounter.waveSourceRef, pointer: '//act1autochess_h07_01' } }, { ...loaded, design }), /invalid assault wave source pointer/);
  assert.throws(() => prepareAssaultBattle(battleState(loaded.runtime), { ...encounter, waveSourceRef: { ...encounter.waveSourceRef, file: 'data/enemies.json' } }, { ...loaded, design }), /unsupported assault wave source file/);

  const boss3 = design.encounters.encounters.find((entry) => entry.id === 'enc_final_boss3_acduml');
  const prepared = prepareAssaultBattle(battleState(loaded.runtime), boss3, { ...loaded, design });
  const battle = createAssaultBattle(prepared, { ...loaded, design, kits: fixtureKit(loaded.runtime.bodies[Object.keys(loaded.runtime.bodies)[0]].charId) });
  assert.equal(prepared.waveId, 'act1autochess_h07_03', 'the encounter/runtime source remains the full wave identity');
  assert.equal(prepared.nativeTemplateId, 'act1autochess_h07_03_s');
  assert.equal(templateOf(battle)?.id, 'act1autochess_h07_03_s');
  assert.equal(battle.players.length, 1, 'the native branch executes through the single-player Assault field');
  assert.deepEqual(battle.rect, { r0: 0, r1: 5, c0: 0, c1: 20 });
  const echoes = [];
  battle.on('enemySpawn', ({ enemy }) => { if (enemy.defId === 'enemy_9023_acdums') echoes.push(enemy); });
  battle.start();
  for (let tick = 0; tick < Math.ceil(55 / battle.dt) && !battle.finished && !echoes.length; tick++) battle.step();
  assert.ok(echoes.length > 0, 'the native boss3 summon_enemy branch actually spawns its echo');
  assert.deepEqual([echoes[0].spawnX, echoes[0].spawnY], [10, 5], 'branch route 0 supplies its native single-player start');
  assert.ok(echoes[0].route.legs.some((leg) => leg.r === 1 && leg.c === 3), 'the solo template route ends on its native solo-side tile');
  assert.ok(echoes[0].route.legs.every((leg) => leg.c <= 10), 'the multiplayer right-side teleport/end route is not used');

  const waves = { ...loaded.nativeData.waves };
  assert.throws(() => assaultNativeTemplateId('act1autochess_h07_03', { ...waves, act1autochess_h07_03_s: undefined }, 1), /invalid native solo wave variant/);
  assert.throws(() => assaultNativeTemplateId('act1autochess_h07_03', { ...waves, act1autochess_h07_03_s: { ...waves.act1autochess_h07_03_s, bossId: 'boss_2' } }, 1), /invalid native solo wave variant/);
  assert.throws(() => assaultNativeTemplateId('act1autochess_h07_03', { ...waves, act1autochess_h07_03_s: { ...waves.act1autochess_h07_03_s, solo: false } }, 1), /invalid native solo wave variant/);
});

test('native compiled body preserves UID, rank stats, fixed skill and permanent growth exactly once', () => {
  const body = loaded.runtime.bodies.char_127_estell;
  const piece = fixturePiece(loaded.runtime, { charId: body.charId, star: 4, permanentFlat: { atk: 100 }, permanentPercent: { maxHp: 0.1 } });
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('normal'), { ...loaded, design });
  const kits = fixtureKit(body.charId);
  const input = buildAssaultBattleInput(prepared, { ...loaded, kits });
  const ds = new DataSource(input.data);
  const def = ds.getChess('assault:fixture-op');
  assert.equal(def.charId, body.charId);
  assert.equal(def.raw.assaultPiece.fixedSkill.sourceSkillId, body.fixedSkill.sourceSkillId);
  assert.equal(def.raw.assaultBody, body);
  assert.equal(def.stats.maxHp, body.starStats[3].stats.maxHp * 1.1);
  assert.equal(def.stats.atk, body.starStats[3].stats.atk + 100);
  assert.equal(def.stats.maxHp, body.baseStats.maxHp * 4 * 1.1);
});

test('native battle metadata shows the actual upgrade stars and preserves their exact compiled stats', () => {
  const body = loaded.runtime.bodies.char_127_estell;
  for (const star of [1, 2, 3, 4]) {
    const piece = fixturePiece(loaded.runtime, { charId: body.charId, star, sourceCopies: 2 ** (star - 1) });
    const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('normal'), loaded);
    const battle = createAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId) });
    battle.start();
    const unit = battle.allyUnits.find((entry) => entry.uid === piece.uid);
    assert.ok(unit.deployed);
    const info = unitInfo(unit);
    assert.equal(info.tier, star);
    assert.equal(info.golden, star === 4);
    assert.equal(unit.base.maxHp, body.starStats[star - 1].stats.maxHp);
    assert.equal(unit.base.atk, body.starStats[star - 1].stats.atk);
    assert.equal('resonanceStar' in info, false);
    assert.equal('resonanceFloors' in info, false);
  }
});

test('all runtime-catalog bodies are complete and the three Amiya forms keep distinct physical profiles', () => {
  const bodyEntries = Object.entries(loaded.runtime.bodies);
  assert.ok(bodyEntries.length > 0);
  for (const [charId, body] of bodyEntries) {
    assert.equal(body.charId, charId);
    assert.equal(body.simChess?.charId, charId);
    assert.equal(body.starStats?.length, 4);
    assert.ok(body.baseStats && body.starStats.every((profile, index) => profile.star === index + 1 && profile.stats?.maxHp > 0));
  }
  const forms = ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3'].map((id) => loaded.runtime.bodies[id]);
  assert.ok(forms.every((body) => body && body.starStats.length === 4 && body.fixedSkill?.sourceSkillId));
  assert.equal(new Set(forms.map((body) => body.charId)).size, 3);
  assert.ok(new Set(forms.map((body) => `${body.profession}:${body.rangeId}:${body.position}`)).size > 1);
  const pieces = forms.map((body, index) => fixturePiece(loaded.runtime, { charId: body.charId, uid: `amiya-form-${index}`, sourceCopies: index + 1, star: 2, row: null, col: null }));
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces }), encounterByKind('normal'), { ...loaded, design });
  const input = buildAssaultBattleInput(prepared, { ...loaded, kits: Object.fromEntries(forms.map((body) => [body.charId, fixtureKit(body.charId)[body.charId]])) });
  const ds = new DataSource(input.data);
  for (const piece of pieces) {
    const def = ds.getChess(`assault:${piece.uid}`);
    assert.equal(def.raw.assaultPiece.uid, piece.uid);
    assert.equal(def.raw.assaultPiece.sourceCopies, piece.sourceCopies);
    assert.equal(def.raw.assaultBody.charId, piece.charId);
  }
});

test('native stealth enemy definition remains available with its actual ability data', () => {
  const enemies = Array.isArray(loaded.nativeData.enemies) ? loaded.nativeData.enemies : Object.values(loaded.nativeData.enemies);
  const lurker = enemies.find((enemy) => enemy.key === 'enemy_1009_lurker');
  assert.ok(lurker);
  assert.ok(lurker.abilities.length > 0 || lurker.talents.length > 0 || lurker.skills.length > 0);
  assert.equal(lurker.applyWay, 'MELEE');
  assert.ok(lurker.abilities.length > 0 || lurker.talents.length > 0 || lurker.skills.length > 0);
});

test('missing complete KIT registry fails strict setup and does not substitute a placeholder', () => {
  const prepared = prepareAssaultBattle(battleState(loaded.runtime), encounterByKind('normal'), { ...loaded, design });
  assert.throws(() => createAssaultBattle(prepared, loaded), /complete registered KIT registry/);
  const onePiece = prepareAssaultBattle(battleState(loaded.runtime), encounterByKind('normal'), { ...loaded, design });
  assert.throws(() => createAssaultBattle(onePiece, { ...loaded, kits: {} }), /missing exact key|missing its fixed skill spec|missing calibrated fixed skill/);
});

test('normal encounter runs the 120 second native leak and settlement path with bounded summary and no frames by default', () => {
  const piece = fixturePiece(loaded.runtime, { charId: 'char_127_estell', row: 9, col: 2 });
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('normal'), { ...loaded, design });
  const result = runAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId), design }, { summaryLimit: 8 });
  assert.ok(result.durationSec <= 120);
  assert.ok(result.events.length <= 8);
  assert.deepEqual(result.frames, []);
  assert.ok(result.stats.total > 0);
  assert.ok(result.reason === 'cleared' || result.reason === 'timeout');
  assert.equal(result.leakedLife, result.stats.leaks.reduce((sum, leak) => sum + Number(leak.lpr ?? 1), 0));
  assert.equal(result.leakLife, result.leakedLife);
  assert.equal(result.remainingLife, Math.max(0, 20 - result.leakedLife));
  assert.equal(result.stats.leakLifeLost, result.leakedLife);
});

test('final boss settlement cannot report victory until the native shared pool is depleted', () => {
  const prepared = prepareAssaultBattle(battleState(loaded.runtime), encounterByKind('final'), { ...loaded, design });
  const result = runAssaultBattle(prepared, { ...loaded, kits: fixtureKit(loaded.runtime.bodies[Object.keys(loaded.runtime.bodies)[0]].charId), design }, { summaryLimit: 4 });
  assert.equal(result.won, false);
  assert.ok(Number.isFinite(result.bossMaxHp) && result.bossMaxHp > 0);
  assert.ok(Number.isFinite(result.bossHpLeft) && result.bossHpLeft > 0 && result.bossHpLeft <= result.bossMaxHp);
  assert.ok(['timeout', 'cleared', 'forced', 'life-depleted'].includes(result.reason));
  assert.ok(result.durationSec <= 120);
  assert.equal(result.frames.length, 0);
});

test('separate run hours receive distinct battle identities and use the stored next RNG state', () => {
  const encounter = encounterByKind('normal');
  const first = prepareAssaultBattle(battleState(loaded.runtime, { runId: 'same-run', rngState: 123, hour: 1 }), encounter, loaded);
  const second = prepareAssaultBattle(battleState(loaded.runtime, { runId: 'same-run', rngState: 123, hour: 2 }), encounter, loaded);
  assert.notEqual(first.battleId, second.battleId);
  assert.equal(first.seed, 123);
  assert.equal(first.input.seed, first.seed);
});

test('summon presets specify future ledger placement without granting tokens or deploying benched owners', () => {
  const tokenId = Object.keys(loaded.runtime.summons)[0];
  for (const benched of [false, true]) {
    const piece = fixturePiece(loaded.runtime, { row: benched ? null : 9, col: benched ? null : 2,
      summonPresets: [{ tokenId, row: 10, col: 3 }] });
    const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('normal'), loaded);
    const built = buildAssaultBattleInput(prepared, { ...loaded, kits: fixtureKit(piece.charId) });
    assert.equal(built.units.length, benched ? 0 : 1);
    assert.ok(built.units.every(unit => unit.kind === 'chess'));
    assert.deepEqual(built.data.chess['assault:fixture-op'].assaultPiece.summonPresets,
      piece.summonPresets.map((preset) => ({ ...preset, dir: 'RIGHT' })));
  }
});

test('cardinal preparation directions reach native units and future summons without mutating the stored snapshot', () => {
  for (const [cardinal, native] of [['N', 'UP'], ['E', 'RIGHT'], ['S', 'DOWN'], ['W', 'LEFT']]) {
    const piece = fixturePiece(loaded.runtime, { dir: cardinal, summonPresets: [{ tokenId: Object.keys(loaded.runtime.summons)[0], row: 10, col: 3, dir: cardinal }] });
    const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('normal'), loaded);
    const built = buildAssaultBattleInput(prepared, { ...loaded, kits: fixtureKit(piece.charId) });
    const battle = createAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId) });
    assert.equal(battle.allyUnits.find((unit) => unit.uid === piece.uid).dir, native);
    assert.equal(built.data.chess['assault:fixture-op'].assaultPiece.summonPresets[0].dir, native);
    assert.equal(prepared.input.pieces[0].dir, cardinal);
    assert.equal(prepared.input.pieces[0].summonPresets[0].dir, cardinal);
  }
});

test('event percentages, distinct opening shields and first entry fee waiver use actual normalized stats', () => {
  const piece = fixturePiece(loaded.runtime, { charId: 'char_127_estell' });
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece], nextBattleEffects: [
    { kind: 'openingShield', amount: 40, mode: 'percent', target: 'all', sourceEventId: 'same-event', durationSec: 120 },
    { kind: 'openingShield', amount: 35, mode: 'percent', target: 'all', sourceEventId: 'same-event', durationSec: 120 },
    { kind: 'enhance', stat: 'spGain', amount: 0.2, mode: 'percent', scope: 'team' },
    { kind: 'firstNaturalEntryCostWaiver', uid: piece.uid, countsAsSkillRedeploy: false },
  ] }), encounterByKind('normal'), loaded);
  const battle = createAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId) });
  battle.start();
  const unit = battle.allyUnits.find(unit => unit.uid === piece.uid);
  assert.ok(unit.alive && unit.deployed);
  assert.equal(battle.getPlayer('assault').dp, encounterByKind('normal').wave.dp.init,
    'the first-entry waiver leaves the current formal encounter opening DP unchanged');
  assert.equal(unit.base.spRecovery, loaded.runtime.bodies[piece.charId].starStats[0].stats.spRecovery * 1.2);
  const shields = unit.buffs.filter(buff => buff.key.startsWith('assault:opening-shield:'));
  assert.equal(shields.length, 2);
  assert.equal(shields.reduce((sum, buff) => sum + buff.shield, 0), unit.s.maxHp * 0.75);
  battle.skillRedeploy(unit);
  assert.equal(unit.buffs.filter(buff => buff.key.startsWith('assault:opening-shield:')).length, 2);
});

test('settlement returns only battle growth deltas rather than reapplying whole piece snapshots', () => {
  const piece = fixturePiece(loaded.runtime, { permanentFlat: { atk: 7 } });
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('normal'), loaded);
  const delta = { uid: piece.uid, effectKey: 'fixture-growth', stat: 'atk', amount: 5, mode: 'flat' };
  const result = runAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId), install: battle => {
    battle.on('battleStart', () => { battle.assaultPermanentEffects = [delta]; });
  } });
  assert.deepEqual(result.permanentEffects, [delta]);
  assert.equal(result.victory, result.won);
  assert.equal(result.leakedLife, result.stats.leakLifeLost);
});

test('P4.1 final pool depletion wins without waiting for remaining enemy waves', () => {
  const piece = fixturePiece(loaded.runtime);
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('final'), loaded);
  const battle = createAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId) });
  battle.start();
  assert.ok(battle._pending.length > 0);
  battle.sharedBoss.hp = 0;
  battle.step();
  assert.equal(battle.finished, true);
});

// Isolate the final clock from damage/leaks: retain a real native pending wave
// after the observation window, rather than replacing the simulator or its clock.
const holdFinalWave = battle => {
  battle.on('battleStart', () => {
    for (const spawn of battle._pending) spawn.time += 550;
  });
};

test('P4.1 final survives 130 seconds, drains exactly ten LP at 160, and ordinary/risk limits stay 120', () => {
  const piece = fixturePiece(loaded.runtime);
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('final'), loaded);
  assert.equal(prepared.config.battleSeconds, 600);
  const battle = createAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId), install: holdFinalWave });
  battle.start();
  while (battle.time < 130 && !battle.finished) battle.step();
  assert.equal(battle.time, 130);
  assert.equal(battle.finished, false);
  assert.ok(battle.sharedBoss.hp > 0);
  while (battle.time < 160 && !battle.finished) battle.step();
  assert.equal(battle.time, 160);
  assert.equal(battle.assaultLeakLife(), 10);
  assert.equal(battle.assaultOvertimeLoss, 10);
  for (const encounter of design.encounters.encounters.filter(e => !e.id.startsWith('enc_final_'))) {
    assert.equal(prepareAssaultBattle(battleState(loaded.runtime), encounter, loaded).config.battleSeconds, 120);
  }
});

test('P4.1 real final settlement clears the pool after 120 seconds and accounts for overtime LP', () => {
  const piece = fixturePiece(loaded.runtime);
  const prepared = prepareAssaultBattle(battleState(loaded.runtime, { pieces: [piece] }), encounterByKind('final'), loaded);
  const outcome = runAssaultBattle(prepared, { ...loaded, kits: fixtureKit(piece.charId), install: battle => {
    holdFinalWave(battle);
    battle.on('tick', () => { if (battle.time >= 160) battle.sharedBoss.hp = 0; });
  } });
  assert.equal(outcome.victory, true);
  assert.ok(outcome.durationSec > 120);
  assert.equal(outcome.bossHpLeft, 0);
  assert.equal(outcome.remainingLife, 10);
  assert.equal(outcome.leakedLife, 10);
  assert.equal(outcome.reason, 'cleared');
  assert.equal(outcome.diagnostics.errorCount, 0);
});
