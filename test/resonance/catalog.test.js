import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { toDataSource } from '../../server/sim/simdata.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { tftArmorToNativeDefense, tftMrToNativeResistance } from '../../shared/resonance/prototype-resistance.js';
import { resonanceContent, resonanceSourceSkillGaps, buildRecruitmentPool } from '../../shared/resonance/catalog.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = process.env.SP_DATA_DIR ? path.resolve(process.env.SP_DATA_DIR) : path.join(ROOT, 'data');
const DATA = loadData(DATA_DIR, { log: { warn() {}, error() {} } });

test('published operator catalog preserves all 154 source identities and explicit star records', () => {
  const ops = Object.values(resonanceContent.operators);
  assert.equal(resonanceContent.schemaVersion, 1);
  assert.equal(ops.length, 154);
  assert.equal(new Set(ops.map((op) => op.charId)).size, 154);
  assert.deepEqual(Object.fromEntries([1,2,3,4,5].map((cost) => [cost, ops.filter((op) => op.cost === cost).length])), { 1:23, 2:33, 3:40, 4:38, 5:20 });
  for (const op of ops) {
    assert.equal(op.id, op.sourceChessId);
    assert.ok(op.source.normalChess);
    assert.ok(op.source.commit);
    assert.ok(op.fixedSkillId);
    assert.ok(op.pacts.length >= 2 && op.pacts.length <= 3);
    for (const star of [1,2,3]) {
      const spec = op.stars[star];
      assert.ok(spec.record?.stats?.maxHp > 0, `${op.name} star ${star} record`);
      assert.ok(spec.record?.stats?.atk >= 0, `${op.name} star ${star} attack`);
      assert.ok(spec.skillOverrides && Object.hasOwn(spec.skillOverrides, 'spCost'));
      assert.ok(Array.isArray(spec.talentOverrides));
      assert.ok(spec.passive?.kind && typeof spec.passive.description === 'string');
      if (star === 3 && op.cost === 5) assert.ok(spec.passive.additionalEffect?.kind, `${op.name} retains the regular star-three effect`);
    }
  }
  const byName = Object.fromEntries(ops.map((op) => [op.name, op]));
  assert.ok(byName['万顷'].pacts.includes('logistics'));
  assert.ok(byName['圣聆初雪'].pacts.includes('control'));
  assert.ok(byName['乌尔比安'].pacts.includes('breaker'));
  for (const name of ['送葬人','松果','奥斯塔']) assert.equal(byName[name].role, 'damage', `${name} stays damage role`);
  for (const name of ['波登可','深巡','雷蛇','薄绿','铃兰','地灵','圣聆初雪']) assert.equal(byName[name].pacts.includes('control'), true, `${name} control pact`);
  assert.equal(byName['雷蛇'].role, 'frontline');
  assert.equal(byName['德克萨斯'].role, 'control');
  assert.equal(byName['德克萨斯'].pacts.includes('logistics'), true);
  assert.equal(byName['万顷'].role, 'damage');
  assert.equal(byName['万顷'].pacts.includes('logistics'), true);
  assert.equal(byName['迷迭香'].pacts.includes('creation'), true);
  assert.equal(byName['夕'].pacts.includes('creation'), true);
  assert.ok(byName['令'].source.tokenSources.some((token) => token.sources.includes('skill')));
  assert.ok(byName['乌尔比安'].source.tokenSources.some((token) => token.sources.includes('skill')));
  assert.equal(byName['贝洛内'].pacts.includes('creation'), false);
  assert.equal(byName['新约能天使'].pacts.includes('holyGun'), true);
  assert.equal(resonanceContent.pacts.holyGun.levels[0].effects[0].params.skillId, 'skchr_angel2_2');
  assert.ok(byName['烛煌'].skillScaleAudit.scaledKeys.includes('attack@atk_scale'));
  assert.equal(byName['烛煌'].stars[3].skillOverrides.bb['attack@atk_scale'], 4.8);
  assert.ok(byName['圣聆初雪'].skillScaleAudit.scaledKeys.includes('attack@atk_scale_s3'));
  assert.ok(byName['深靛'].skillScaleAudit.scaledKeys.includes('indigo_s_2[damage].atk_scale'));
  assert.ok(byName['风絮'].skillScaleAudit.scaledKeys.includes('attack@heal_scale'));
  assert.ok(byName['普罗旺斯'].skillScaleAudit.unscaledCandidates.includes('atk_scale_up'));
  for (const op of ops) {
    assert.ok(Array.isArray(op.skillScaleAudit.scaledKeys));
    assert.ok(Array.isArray(op.skillScaleAudit.unscaledCandidates));
    for (const key of op.skillScaleAudit.scaledKeys) assert.ok(!/(?:^|@)(?:atk|atk_pct|prob_atk_scale|atk_scale_up)$/i.test(key), `${op.name} scaled non-direct key ${key}`);
  }
  assert.equal(byName['乌尔比安'].stars[1].record.stats.cost, DATA.chess[byName['乌尔比安'].id].stats.cost);
  assert.equal(byName['灰毫'].stars[1].skillOverrides.spCost, 12);
  assert.equal(byName['灰毫'].stars[1].skillOverrides.initSp, 4);
  assert.equal(byName['灰毫'].stars[1].skillOverrides.trigger.rule, 'DEFAULT');
  assert.equal(resonanceContent.pacts.aegir.levels[0].effects.find((effect) => effect.kind === 'aegir_cycle').params.retaliation, 2.5);
  assert.equal(resonanceContent.pacts.siracusa.levels[0].effects[0].params.damageCycle, 4000);
  const pactEffect = (id) => resonanceContent.pacts[id].levels[0].effects[0].params;
  assert.deepEqual(pactEffect('holyGun').byStar, {
    1:{chance:15,damage:60,cap:100,factor:0.005,radius:1.5},
    2:{chance:25,damage:100,cap:150,factor:0.008,radius:1.5},
    3:{chance:100,damage:500,cap:500,factor:0.02,radius:2},
  });
  assert.deepEqual([1,2,3].map((star)=>pactEffect('yela').byStar[star].tileCooldown),[3,2,3]);
  assert.ok(pactEffect('yela').byStar[3].coldDuration<pactEffect('yela').byStar[3].tileCooldown,'permanent snow must leave enemies a movement window');
  assert.equal(byName['圣聆初雪'].stars[3].passive.params.coldDuration,pactEffect('yela').byStar[3].coldDuration);
  assert.deepEqual(resonanceContent.campaign.supply.transfers.map(x=>x.node),[12,22,26]);
  assert.deepEqual([1,2,3].map((star)=>pactEffect('crown').byStar[star].perCast),[3,5,10]);
  assert.equal(pactEffect('crown').maxStacks,30);
});

test('all pacts, items, recipes, strategies, and environments carry executable effect objects', () => {
  assert.equal(Object.keys(resonanceContent.pacts).length, 35);
  for (const pact of Object.values(resonanceContent.pacts)) {
    assert.deepEqual(pact.levels.map((level) => level.threshold), pact.thresholds);
    for (const level of pact.levels) assert.ok(level.effects.length && level.effects.every((effect) => effect.kind && effect.params));
  }
  assert.equal(resonanceContent.recipes.length, 36);
  const pairs = resonanceContent.recipes.map((recipe) => [...recipe.parts].sort().join('|'));
  assert.equal(new Set(pairs).size, 36);
  assert.equal(new Set(resonanceContent.recipes.map((recipe) => recipe.resultId)).size, 36);
  for (const item of Object.values(resonanceContent.equipment)) {
    assert.ok(['component','completed','emblem'].includes(item.kind), item.id);
    assert.ok(item.effects.length && item.effects.every((effect) => effect.kind && effect.params), item.id);
  }
  assert.equal(Object.keys(resonanceContent.strategies).length, 36);
  for (const strategy of Object.values(resonanceContent.strategies)) {
    assert.ok(strategy.condition?.kind);
    assert.ok(strategy.effects.length && strategy.effects.every((effect) => effect.kind && effect.params));
    assert.ok(strategy.timing && strategy.description);
  }
  assert.equal(Object.keys(resonanceContent.environments).length, 19);
  for (const env of Object.values(resonanceContent.environments)) assert.ok(env.rule.kind && env.rule.params && env.description);
});

test('seeded recruitment guarantees per-cost quotas, origin signature, terminal, and valid starters', () => {
  for (const [environmentId, env] of Object.entries(resonanceContent.environments)) {
    const catalog = getResonanceCatalog(DATA, { environmentId, seed: 'catalog-check' });
    const ids = catalog.config.activeOperatorIds;
    assert.equal(ids.length, 65, environmentId);
    assert.equal(new Set(ids).size, 65, environmentId);
    assert.deepEqual(buildRecruitmentPool(catalog, { environmentId, seed: 'catalog-check' }), ids);
    const active = ids.map((id) => catalog.operators[id]);
    assert.deepEqual(Object.fromEntries([1,2,3,4,5].map((cost) => [cost, active.filter((op) => op.cost === cost).length])), { 1:14, 2:13, 3:14, 4:14, 5:10 });
    assert.ok(active.filter((op) => op.pacts[0] === env.identityPactId).length >= env.guaranteedNaturalMembers, `${environmentId} signature`);
    assert.ok(ids.includes(env.guaranteedTerminalId), `${environmentId} terminal`);
    assert.ok(active.filter((op) => op.role === 'frontline').length >= 2, `${environmentId} frontline`);
    assert.ok(active.some((op) => op.position === 'RANGED'), `${environmentId} ranged`);
    assert.ok(active.some((op) => op.role === 'healer'), `${environmentId} healer`);
    assert.equal(catalog.config.starterIds.length, 3);
    assert.ok(catalog.config.starterIds.every((id) => ids.includes(id) && catalog.operators[id].cost === 1));
  }
  assert.throws(() => getResonanceCatalog(DATA, { environmentId: 'origin_unknown' }), /RESONANCE_UNKNOWN_ENVIRONMENT/);
});

test('native Kit coverage reports the exact generic or missing fixed skill records', () => {
  assert.deepEqual(resonanceSourceSkillGaps.map((entry) => [entry.name, entry.skillSpecSource]).sort((a,b)=>a[0].localeCompare(b[0])), [
    ['万顷','generic'], ['白金','generic'], ['正义骑士号','none'], ['奥斯塔','generic'], ['贾维','generic'], ['令','generic'], ['黍','generic'],
  ].sort((a,b)=>a[0].localeCompare(b[0])));
});

test('fixed skill index resolves to the configured raw skill and blackboard in Battle data', () => {
  for (const op of Object.values(resonanceContent.operators)) {
    if (op.fixedSkillIndex === null) continue;
    const record = op.stars[1].record;
    assert.equal(record.skills[op.fixedSkillIndex]?.skillId, op.fixedSkillId, `${op.name} source order`);
    const testData = { ...DATA, chess: { ...DATA.chess, [op.id]: record } };
    const resolved = toDataSource(testData).getChess(op.id, { skillIndex: op.fixedSkillIndex });
    assert.equal(resolved.skill.id, op.fixedSkillId, `${op.name} normalized skill`);
    assert.deepEqual(resolved.skill.bb, op.stars[1].skillOverrides.bb, `${op.name} normalized blackboard`);
  }
});

test('prototype server catalog retains its season while display projection omits source tables', () => {
  const prototypeData = loadData(process.env.SP_DATA_DIR ? path.resolve(process.env.SP_DATA_DIR) : path.join(ROOT, 'data/resonance-native'), { log: { warn() {}, error() {} } });
  const catalog = getResonanceCatalog(prototypeData, { rulesVersion: 3, seasonId: 'resonance-set13-14.23', seed: 1 });
  assert.equal(catalog.prototypeSeason.id, 'resonance-set13-14.23');
  assert.equal(catalog.prototypeSeason.chemBaronItems.length, 28);
  assert.equal(Object.hasOwn(resonanceDisplayCatalog(catalog), 'prototypeSeason'), false);
  assert.equal(Object.values(catalog.equipment).filter((item) => item.source?.apiName?.startsWith('TFT13_Crime_')).length, 28);
  for (const hero of prototypeSeason.heroes) {
    const stats = catalog.operators[hero.sourceChessId].stars[1].stats;
    const nativeStats=resonanceContent.operators[hero.sourceChessId].stars[1].stats;
    assert.equal(stats.def, typeof hero.powerReference.armor==='number'?tftArmorToNativeDefense(hero.powerReference.armor,hero.powerReference.attackDamage):nativeStats.def, `${hero.name} adapted armor source/fallback`);
    assert.equal(stats.res, typeof hero.powerReference.magicResist==='number'?tftMrToNativeResistance(hero.powerReference.magicResist):nativeStats.res, `${hero.name} adapted magic-resist source/fallback`);
    if(hero.powerReference.magicResist===null)assert.equal(hero.powerReference.magicResist,null,`${hero.name} source unknown remains explicit`);
    assert.ok(Math.abs(stats.bat - 1 / hero.powerReference.attackSpeed) < 1e-9, `${hero.name} source attack cadence`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(catalog.prototypeEconomy.gearPools).filter(([key]) => key.startsWith('chemBaron')).map(([key, ids]) => [key, ids.length])), {
    chemBaron: 3,
    chemBaronBronze: 3,
    chemBaronSilver: 8,
    chemBaronGold: 8,
    chemBaronPrismatic: 8,
    chemBaronOmegaPrismatic: 1,
  });
  assert.equal(Object.keys(catalog.prototypeEconomy.chemBaron.marketOptionsByThreshold).length, 8);
});

test('current documentation is regenerated deterministically from the v3 catalog while preserving source catalog code', () => {
  const outputPath = path.join(ROOT, 'shared/resonance/catalog.js');
  const reviewPath = path.join(ROOT, 'docs/resonance/catalog.md');
  const compilerPath = path.join(ROOT, 'tools/resonance/export-prototype-catalog.mjs');
  const originalConfig = fs.readFileSync(outputPath);
  const env = { ...process.env, SP_DATA_DIR: process.env.SP_DATA_DIR ? path.resolve(process.env.SP_DATA_DIR) : path.join(ROOT, 'data/resonance-native') };
  const options = { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 4*1024*1024, timeout: 30000 };
  const defaultResult=JSON.parse(execFileSync(process.execPath, [compilerPath], options).trim());
  assert.equal(defaultResult.rulesVersion,3);assert.equal(defaultResult.active,60);assert.equal(defaultResult.pacts,26);
  assert.ok(fs.readFileSync(outputPath).equals(originalConfig));
  const firstReview = fs.readFileSync(reviewPath, 'utf8');
  execFileSync(process.execPath, [compilerPath], options);
  assert.ok(fs.readFileSync(outputPath).equals(originalConfig));
  assert.equal(fs.readFileSync(reviewPath, 'utf8'), firstReview);
  assert.match(firstReview,/rulesVersion 3/);assert.match(firstReview,/当前招募名单/);assert.match(firstReview,/当前自然盟约/);assert.match(firstReview,/独立图鉴记录 154 名/);assert.match(firstReview,/旧存档兼容/);
  assert.doesNotMatch(firstReview,/固定招募名单 65 人/);
});
