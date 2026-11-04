import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource } from '../../server/sim/simdata.js';
import { Battle } from '../../server/sim/Battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { flatRoutes, flatStage, enemyRec } from '../helpers/battleHarness.js';
import { assertAssaultCatalog, getAssaultBody, getAssaultOperator, toAssaultSimData } from '../../shared/assault/catalog.js';

const SOURCE = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources';
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const runtime = json(new URL('../../data/assault-runtime.json', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const runtimeSourcePaths = [
  'server/sim', 'server/modes/assault', 'shared/assault', 'server/data.js',
  'tools/assault/build-runtime-data.mjs', 'tools/assault/native-traits.mjs',
  'data/assault-design', ':(exclude)data/assault-design/public-text.json', 'data/chess.json', 'data/tokens.json', 'data/enemies.json',
  'data/bosses.json', 'data/stages.json', 'data/waves.json',
];
const git = (...args) => execFileSync('git', ['-C', repositoryRoot, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
}).trim();
const characterTable = json(`${SOURCE}/arknights/excel/character_table.json`);
const patchTable = json(`${SOURCE}/arknights/excel/char_patch_table.json`).patchChars;
const skillTable = json(`${SOURCE}/arknights/excel/skill_table.json`);
const rangeTable = json(`${SOURCE}/arknights/excel/range_table.json`);
const equipmentTable = json(`${SOURCE}/arknights/excel/uniequip_table.json`);
const battleEquipTable = json(`${SOURCE}/arknights/excel/battle_equip_table.json`);
const rosterGroups = ['assault', 'ranged', 'support'].map((group) => json(new URL(`../../data/assault-design/roster-${group}.json`, import.meta.url)));
const formsDesign = json(new URL('../../data/assault-design/forms.json', import.meta.url));
const encounterDesign = json(new URL('../../data/assault-design/encounters.json', import.meta.url));
const nativeBody = (charId) => characterTable[charId] ?? patchTable[charId];
const sharedData = Object.fromEntries(['tokens', 'enemies', 'bosses', 'stages', 'waves'].map((key) => [key, json(new URL(`../../data/${key}.json`, import.meta.url))]));

function interpolate(data, level) {
  const frames = data.phases.at(-1).attributesKeyFrames;
  const hi = frames.findIndex((frame) => frame.level >= level);
  const low = frames[Math.max(0, hi - 1)];
  const high = frames[Math.max(0, hi)];
  const ratio = high.level === low.level ? 0 : (level - low.level) / (high.level - low.level);
  const result = {};
  for (const key of new Set([...Object.keys(low.data), ...Object.keys(high.data)])) {
    const a = low.data[key];
    const b = high.data[key];
    result[key] = typeof a === 'number' && typeof b === 'number' ? Math.round((a + (b - a) * ratio + Number.EPSILON) * 1e6) / 1e6 : a;
  }
  return result;
}

function gridFor(rangeId) {
  return rangeTable[rangeId].grids.map(({ row, col }) => [row, col]);
}

test('runtime catalog covers 170 purchases, 172 physical bodies, and keeps source/engine revisions', () => {
  assertAssaultCatalog(runtime);
  assert.equal(runtime.sourceRevision, '17759cc8cdf37388414145d16262a3a06f3ab25e');
  assert.equal(path.resolve(git('rev-parse', '--show-toplevel')).toLowerCase(),
    path.resolve(repositoryRoot).toLowerCase(), 'version checks must use this actual repository');
  assert.equal(git('cat-file', '-t', runtime.engineRevision), 'commit');
  assert.equal(git('rev-parse', `${runtime.engineRevision}^{commit}`), runtime.engineRevision);
  git('merge-base', '--is-ancestor', runtime.engineRevision, 'HEAD');
  assert.equal(git('diff', '--name-only', runtime.engineRevision, '--', ...runtimeSourcePaths), '',
    'runtime must be generated from the current committed engine/design sources');
  const { officialTables, levelFiles, parsedOfficialTables } = runtime.sourceInventory;
  assert.deepEqual({ officialTables, levelFiles, parsedOfficialTables },
    { officialTables: 17, levelFiles: 50, parsedOfficialTables: 7 });
  assert.equal(Object.keys(runtime.operators).length, 170);
  assert.equal(Object.keys(runtime.bodies).length, 172);
  assert.equal(Object.keys(runtime.encounters).length, 36);

  const expectedBodies = [...rosterGroups.flatMap((group) => group.operators), ...formsDesign.forms];
  assert.equal(new Set(expectedBodies.map((entry) => entry.charId)).size, 172);
  for (const plan of expectedBodies) {
    const body = runtime.bodies[plan.charId];
    assert.ok(body, `missing body ${plan.charId}`);
    assert.equal(body.charId, plan.charId);
    assert.equal(body.formId, plan.charId);
    assert.equal(body.purchaseCharId, plan.charId === 'char_1001_amiya2' || plan.charId === 'char_1037_amiya3' ? 'char_002_amiya' : plan.charId);
    assert.equal(body.training.trust, 0);
    assert.equal(body.training.potential, 1, 'potential 1 is zero extra potential in the native API');
    assert.equal(body.training.extraPotential, 0);
    assert.equal(body.training.potentialRank, 0);
    assert.equal(body.source.interpolatedAttributes.maxHp, interpolate(nativeBody(plan.charId), body.training.level).maxHp);

    const source = nativeBody(plan.charId);
    const selectedPhase = source.phases.at(-1);
    assert.equal(body.training.phase, source.phases.length - 1);
    assert.equal(body.training.level, Math.min(60, selectedPhase.attributesKeyFrames.at(-1).level));
    assert.equal(body.rangeId, selectedPhase.rangeId);
    assert.deepEqual(body.range, gridFor(selectedPhase.rangeId));
    assert.equal(body.position, source.position);
    const interpolated = interpolate(source, body.training.level);
    assert.equal(body.baseStats.cost, interpolated.cost);
    assert.equal(body.baseStats.bat, interpolated.baseAttackTime);
    assert.equal(body.baseStats.blockCnt, interpolated.blockCnt);
    assert.equal(body.baseStats.aspd, interpolated.attackSpeed);
    assert.equal(body.baseStats.respawnTime, interpolated.respawnTime);
    assert.equal(body.baseStats.deployLimit, interpolated.maxDeployCount);
    assert.equal(body.physicalProfile.profession, source.profession);
    assert.equal(body.physicalProfile.subProfessionId, source.subProfessionId);
    assert.equal(body.physicalProfile.position, source.position);
    assert.deepEqual(body.physicalProfile.rangeGrid, gridFor(selectedPhase.rangeId));
    assert.equal(body.source.skills.length, source.skills.length);
    assert.equal(body.source.talents.length, source.talents.length);

    const fixed = plan.fixedSkill;
    assert.deepEqual(body.fixedSkill.spCosts, fixed.spCosts);
    assert.deepEqual(body.fixedSkill.initSp, fixed.initSp);
    if (fixed.kind === 'passive') {
      assert.equal(body.fixedSkill.runtime.skillType, 'PASSIVE');
      assert.equal(body.simChess.skill, null);
    } else {
      assert.equal(source.skills[fixed.sourceIndex].skillId, fixed.sourceSkillId);
      const sourceSkill = body.fixedSkill.source.native;
      assert.equal(sourceSkill.skillId, fixed.sourceSkillId);
      assert.equal(sourceSkill.index, fixed.sourceIndex);
      assert.equal(sourceSkill.skillType, skillTable[fixed.sourceSkillId].levels.at(-1).skillType);
      assert.equal(body.fixedSkill.runtime.skillType, 'AUTO');
      assert.equal(body.simChess.skill.skillType, 'AUTO');
      assert.equal(body.simChess.skill.skillId, fixed.sourceSkillId);
    }

    for (const module of body.modulePlans) {
      assert.equal(module.enabled, false);
      assert.equal(module.nativeWhiteStatsApplied, false);
      assert.equal(module.nativeCallbacksApplied, false);
      assert.ok(equipmentTable.equipDict[module.id], `${plan.charId}: missing native module ${module.id}`);
      if (module.type === 'ADVANCED') {
        const levels = battleEquipTable[module.id]?.phases ?? [];
        assert.equal(module.sourceLevel, Math.max(...levels.map((entry) => entry.equipLevel)));
        assert.ok(module.theme.parts.length > 0);
        for (const part of module.theme.parts) {
          assert.ok(part.talentCandidates.every((candidate) => (candidate.requiredPotentialRank ?? 0) === 0));
          assert.ok(part.traitCandidates.every((candidate) => (candidate.requiredPotentialRank ?? 0) === 0));
        }
      }
    }
    assert.equal(body.defaultModuleId, plan.defaultModuleId ?? null);
    assert.equal(body.defaultModule?.id ?? null, body.defaultModuleId);
    assert.equal(body.moduleSelection.selectedModuleId, body.defaultModuleId);
    assert.equal(body.moduleSelection.onlyOneActive, true);
  }

  const amiya = getAssaultOperator(runtime, 'char_002_amiya');
  assert.ok(amiya);
  assert.deepEqual(amiya.extraForms, ['char_1001_amiya2', 'char_1037_amiya3']);
  for (const id of ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3']) {
    assert.equal(getAssaultBody(runtime, id).purchaseCharId, 'char_002_amiya');
  }
});

test('concrete E2 level-60 interpolation and branch-median normalization match official keyframes', () => {
  const body = runtime.bodies.char_127_estell;
  const native = nativeBody('char_127_estell');
  const frames = native.phases[2].attributesKeyFrames;
  assert.deepEqual(frames.map(({ level, data }) => [level, data.maxHp, data.atk, data.def]), [
    [1, 1875, 524, 258],
    [70, 2500, 690, 315],
  ]);
  assert.deepEqual(
    ['maxHp', 'atk', 'def'].map((key) => body.source.interpolatedAttributes[key]),
    [2409.42029, 665.942029, 306.73913],
  );
  assert.deepEqual(body.branchMedian, { atk: 692.463448, maxHp: 2436.419006, def: 344.044303 });
  assert.deepEqual(
    [body.baseStats.maxHp, body.baseStats.atk, body.baseStats.def, body.baseStats.res],
    [12114.59824, 679.202739, 325.391717, 0],
  );
  assert.deepEqual(
    [body.starStats[3].stats.maxHp, body.starStats[3].stats.atk, body.starStats[3].stats.def, body.starStats[3].stats.res],
    [48458.39296, 2037.608217, 325.391717, 0],
  );
  assert.equal(body.baseStats.maxHp / 5, 2422.919648, 'normalized life applies the x5 factor only once');

  const zeroDefense = runtime.bodies.char_4145_ulpia;
  assert.equal(zeroDefense.source.interpolatedAttributes.def, 0);
  assert.equal(zeroDefense.baseStats.def, 0);
  assert.equal(zeroDefense.baseStats.res, 0);
  assert.equal(zeroDefense.starStats[3].stats.def, 0);

  const cappedAt30 = runtime.bodies.char_4000_jnight;
  assert.equal(cappedAt30.training.level, 30);
  assert.equal(cappedAt30.fixedSkill.runtime.skillType, 'PASSIVE');
  assert.equal(cappedAt30.fixedSkill.runtime.trigger, 'PASSIVE');
  assert.equal(cappedAt30.fixedSkill.runtime.spType, null);
  assert.equal(cappedAt30.simChess.skill, null);
});

test('DataSource resolves generated bodies to real range/attack profiles and forced design skills', () => {
  const simData = toAssaultSimData(runtime, sharedData);
  const source = new DataSource(simData, null);
  assert.equal(Object.keys(simData.chess).length, 172);
  for (const [key, record] of Object.entries(sharedData.enemies)) assert.equal(simData.enemies[key], record, key);
  assert.equal(simData.bosses, sharedData.bosses);
  assert.equal(simData.stages, sharedData.stages);
  assert.equal(simData.waves, sharedData.waves);

  for (const [charId, body] of Object.entries(runtime.bodies)) {
    const def = source.getChess(charId);
    assert.ok(def, `${charId}: DataSource.getChess returned null`);
    assert.equal(def.charId, charId);
    assert.equal(def.profession, body.profession);
    assert.equal(def.subProf, body.subProfessionId);
    assert.equal(def.position, body.position);
    assert.equal(def.attackKind, body.physicalProfile.attackKind);
    assert.equal(def.dmgType, body.physicalProfile.dmgType);
    assert.deepEqual(def.rangeGrid, body.range);
    for (const key of ['maxHp', 'atk', 'def', 'res', 'aspd', 'bat', 'blockCnt', 'cost', 'respawnTime', 'spRecovery', 'tauntLevel', 'massLevel', 'hpRecoveryPerSec', 'moveSpeed']) {
      assert.equal(def.stats[key], body.baseStats[key], `${charId}: DataSource stat ${key}`);
    }
    assert.equal(def.skill?.skillType ?? 'PASSIVE', body.fixedSkill.runtime.skillType);
    assert.equal(def.skill?.id ?? null, body.fixedSkill.runtime.skillId ?? null);
    assert.notEqual(def.skill?.skillType, 'MANUAL', `${charId}: raw native manual skill type leaked into runtime`);
  }

  const mine = source.getToken('token_10013_robin_mine');
  assert.equal(source.getToken('token_10015_dusk_drgn').stats.maxHp, 9985, 'existing Alliance summons use the Assault life scale too');
  for (const [tokenId, token] of Object.entries(runtime.summons)) {
    assert.equal(source.getToken(tokenId).stats.maxHp, token.stats.maxHp, `${tokenId}: compiled Assault summon takes precedence over Alliance`);
  }
  assert.ok(mine, 'missing native token templates are made available through the assault catalog');
  assert.equal(mine.charId, 'token_10013_robin_mine');
  assert.equal(mine.stats.maxHp, runtime.summons.token_10013_robin_mine.stats.maxHp);
  assert.equal(runtime.summons.token_10013_robin_mine.sourceTemplate.stats.maxHp, nativeBody('token_10013_robin_mine').phases.at(-1).attributesKeyFrames.at(-1).data.maxHp);
  assert.equal(runtime.summons.token_10013_robin_mine.lifeScaleFactor, 5);
  assert.equal(runtime.summons.token_10013_robin_mine.lifeScaleApplications, 1);
  assert.deepEqual(mine.rangeGrid, runtime.summons.token_10013_robin_mine.rangeGrid);
});

test('native talent/module source bindings and summon derivatives retain real identities', () => {
  for (const [charId, body] of Object.entries(runtime.bodies)) {
    const source = nativeBody(charId);
    const plan = [...rosterGroups.flatMap((group) => group.operators), ...formsDesign.forms].find((entry) => entry.charId === charId);
    for (const binding of body.talentBindings) {
      const pointerIndex = Number(/\/talents\/(\d+)/.exec(binding.translation.sourcePointer ?? '')?.[1]);
      assert.ok(Number.isInteger(pointerIndex));
      const candidates = source.talents[pointerIndex].candidates.filter((candidate) => (candidate.requiredPotentialRank ?? 0) === 0);
      assert.ok(candidates.length > 0);
      assert.equal(binding.nativeTalent.name, candidates.at(-1).name);
      assert.deepEqual(binding.nativeTalent.blackboard, candidates.at(-1).blackboard);
      assert.equal(binding.singleBinding, true);
    }
    assert.equal(body.defaultModuleId, plan.defaultModuleId ?? null);
  }

  assert.ok(runtime.summons.token_10020_ling_soul3);
  assert.ok(runtime.summons.token_10027_ironmn_pile2);
  assert.ok(runtime.derivedTemplates.lingLargeDragon.sourceTokenId === 'token_10020_ling_soul3');
  assert.equal(runtime.derivedTemplates.workshopRepairPlatform.sourceTokenId, 'token_10027_ironmn_pile3');
  assert.equal(runtime.derivedTemplates.workshopRepairPlatform.sourceUse, 'visualAndRangeOnly');
  assert.equal(runtime.derivedTemplates.workshopRepairPlatform.maxHpRatio, 0.75);
  assert.equal(runtime.derivedTemplates.lingLargeDragon.statMultiplier, 1.8);
  assert.equal(runtime.derivedTemplates.lingLargeDragon.occupySlots, 1);
  assert.equal(runtime.derivedTemplates.lingLargeDragon.lifeScaleApplications, 0);
  assert.equal(runtime.derivedTemplates.workshopRepairPlatform.lifeScaleApplications, 0);
  assert.equal(runtime.derivedTemplates.workshopRepairPlatform.ownerUidPolicy, 'useRuntimeOwnerUid');
  assert.equal(runtime.summons.token_10020_ling_soul3.rawTokenIdentityPreserved, true);
  assert.equal(runtime.summons.token_10027_ironmn_pile2.rawTokenIdentityPreserved, true);
  assert.equal(Object.hasOwn(characterTable, 'assault_ling_large'), false);
  for (const [tokenId, token] of Object.entries(runtime.summons)) {
    assert.equal(token.tokenId, tokenId);
    assert.equal(characterTable[tokenId]?.profession, 'TOKEN');
    assert.ok(token.sources.length > 0);
  }
});

test('hidden skill enemy identities remain distinct from tokens and preserve native host-override references', () => {
  const key = 'enemy_5601_entlec';
  const entity = runtime.auxiliaryEnemies[key];
  assert.equal(entity.source.ownerCharId, 'char_4010_etlchi');
  assert.equal(entity.name, '心烛');
  assert.equal(entity.stats.maxHp, 1000, 'native placeholder is retained until the card applies host inheritance');
  assert.equal(entity.nativeAttributesRequireHostInheritance, true);
  assert.equal(Object.hasOwn(runtime.summons, key), false);
  const source = new DataSource(toAssaultSimData(runtime, sharedData));
  assert.equal(source.getEnemy(key).name, '心烛');
  assert.equal(source.getEnemy(key).maxHp, 1000);
  assert.equal(Object.hasOwn(sharedData.enemies, key), false, 'Alliance data is untouched');
});

test('all encounter stage, wave, enemy, and boss references close against shared 0.2.2 data', () => {
  for (const plan of encounterDesign.encounters) {
    const encounter = runtime.encounters[plan.id];
    assert.ok(encounter, `missing encounter ${plan.id}`);
    assert.ok(sharedData.stages[encounter.stageId], `${plan.id}: stage missing`);
    assert.ok(sharedData.waves[encounter.waveId], `${plan.id}: wave missing`);
    if (encounter.bossId) assert.ok(sharedData.bosses[encounter.bossId], `${plan.id}: boss missing`);
    for (const spawn of encounter.spawnRefs) {
      if (spawn.enemyKey) assert.ok(sharedData.enemies[spawn.enemyKey], `${plan.id}: enemy ${spawn.enemyKey} missing`);
      if (spawn.bossId) assert.ok(sharedData.bosses[spawn.bossId], `${plan.id}: boss ${spawn.bossId} missing`);
    }
  }
  for (const key of ['enemies', 'bosses', 'stages', 'waves']) assert.equal(Object.hasOwn(runtime, key), false, `runtime must not duplicate ${key}.json`);
});

test('all native profession trait blackboards reach the same trained body with no module or potential leakage', () => {
  const source = new DataSource(toAssaultSimData(runtime, sharedData));
  for (const body of Object.values(runtime.bodies)) {
    const native = nativeBody(body.charId);
    const selected = (native.trait?.candidates ?? []).filter((candidate) => {
      const phase = ['PHASE_0', 'PHASE_1', 'PHASE_2'].indexOf(candidate.unlockCondition?.phase ?? 'PHASE_0');
      return (candidate.requiredPotentialRank ?? 0) === 0 && phase <= body.training.phase
        && (phase < body.training.phase || (candidate.unlockCondition?.level ?? 1) <= body.training.level);
    }).at(-1);
    assert.deepEqual(body.trait.source.blackboard, selected?.blackboard ?? [], body.charId);
    assert.deepEqual(body.source.trait, body.trait.source, body.charId);
    assert.deepEqual(source.getChess(body.charId).traitBb, body.trait.bb, body.charId);
    if (!['musha', 'reaper'].includes(body.subProfessionId)) {
      assert.equal(body.trait.normalization.applications, 0, body.charId);
      for (const entry of selected?.blackboard ?? []) {
        const value = entry.valueStr && (entry.value == null || entry.value === 0) ? entry.valueStr : entry.value;
        assert.equal(body.trait.bb[entry.key], value, `${body.charId}/${entry.key}`);
      }
    }
  }
  assert.equal(source.getChess('char_188_helage').traitBb.value, 350, 'E2 native 70 life points ×5 exactly once');
  assert.equal(source.getChess('char_491_humus').traitBb.value, 250, 'native 50 life points ×5 exactly once');
  assert.equal(source.getChess('char_494_vendla').traitBb.scale, 0.5, 'damage-based trait ratio remains 50%');
});

test('the production compiled Musha trait restores exactly 350 life points on a real hit', () => {
  const id = 'char_188_helage', body = runtime.bodies[id];
  const piece = { uid: 'trait-owner', charId: id, star: 1, moduleId: null, moduleChoices: {}, fixedSkill: body.fixedSkill,
    permanentFlat: {}, permanentPercent: {}, sourceCopies: 1, claimed: [], tagEdits: { add: [], remove: [] } };
  const sim = toAssaultSimData(runtime, sharedData);
  const data = new DataSource({ ...sim,
    chess: { [id]: { ...body.simChess, assaultBody: body, assaultPiece: piece } },
    enemies: { target: enemyRec({ key: 'target', hp: 100000, atk: 0, def: 0, res: 0, speed: 0 }) },
  });
  const battle = new Battle({ stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: [{ uid: piece.uid, chessId: id, row: 10, col: 5 }] }],
    content: 'assault', assault: { kits: assaultKits, strict: true },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 },
    autoFinish: false, timeLimit: 60, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} },
  });
  battle.start();
  const unit = battle.allyUnits.find((entry) => entry.uid === piece.uid);
  assert.equal(unit.profile.selfHeal, 350);
  unit.hp -= 1000;
  const target = battle.spawnEnemy('target', { routeIndex: 0, pos: [6, 10] });
  const before = unit.hp;
  battle.forceAttack(unit, [target]);
  battle.assaultRuntime.flush();
  assert.equal(unit.hp - before, 350);
  assert.equal(battle.result?.errors?.length ?? battle._errors?.length ?? 0, 0);
});
