import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installAssaultModule, assaultAdvancedModuleIds, assaultAdvancedModuleCount } from '../../server/sim/content/assault/cards/assault-modules.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { COLS } from '../../server/sim/constants.js';
import { bodyDist } from '../../server/sim/body.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const forms = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/forms.json', import.meta.url), 'utf8'));
const ranged = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-ranged.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(new URL('../../data/assault-coverage-assault-modules.json', import.meta.url), 'utf8'));
// 大巴扎卡面模组数值（按星级）。
const cardModule = (charId, moduleId, key, rank) => Number(runtime.bodies[charId].bazaar.modules[moduleId].params[key][rank - 1]);
const assaultBodies = [...roster.operators, ...forms.forms, ...ranged.operators.filter((entry) => entry.charId === 'char_393_toledo')].map((entry) => runtime.bodies[entry.charId]);
const advanced = assaultBodies.flatMap((body) => (body.modulePlans ?? []).filter((plan) => plan.type === 'ADVANCED')
  .map((plan) => ({ body, plan })));

const pieceFor = (body, star, moduleId) => ({ uid: `module:${body.charId}:${moduleId ?? 'none'}:${star}`, charId: body.charId, star,
  moduleId, moduleChoices: { [body.charId]: moduleId }, fixedSkill: body.fixedSkill, sourceCopies: 1,
  permanentFlat: {}, permanentPercent: {}, tagEdits: { add: [], remove: [] }, claimed: [] });

function dummyBattle() {
  const handlers = new Map();
  return {
    time: 0, allyUnits: [], enemies: [], grid: { isLow: () => true },
    opts: { assault: { kits: {} } },
    addBuff() { return {}; }, removeBuff() {}, heal() { return 0; }, dealDamage() { return 0; },
    on(type, fn) { const list = handlers.get(type) ?? []; list.push(fn); handlers.set(type, list); return { type, fn }; },
    assaultRuntime: { currentCause: null, withCause(_cause, fn) { return fn(); }, observe() { return () => {}; } },
  };
}

function dummyUnit(body, piece) {
  return { uid: piece.uid, side: 'ally', alive: true, deployed: true, hidden: false, removed: false, tileR: 10, tileC: 5,
    hp: 1000, mem: {}, def: { charId: body.charId, raw: { assaultBody: body, assaultPiece: piece } }, s: { maxHp: 1000, atk: 100, def: 0 },
    blocking: [], buffs: [], findBuff() { return null; } };
}

test('compiled Assault source covers 49 assault/form bodies plus selected ranged Toledo and 71 ADVANCED modules', () => {
  assert.equal(assaultBodies.length, 49);
  assert.equal(advanced.length, 71);
  assert.equal(new Set(advanced.map(({ plan }) => plan.id)).size, 71);
  assert.equal(assaultAdvancedModuleCount, 71);
  assert.equal(assaultAdvancedModuleIds.handledHere.length, 53);
  assert.equal(assaultAdvancedModuleIds.delegatedToMain.length, 18);
});

test('coverage records both rank effect keys and does not overstate unverified module effects', () => {
  assert.equal(coverage.bodyCount, 49);
  assert.equal(coverage.advancedModuleCount, 71);
  assert.equal(coverage.count, 71);
  assert.equal(coverage.modules.length, 71);
  const sourceIds = new Set(advanced.map(({ plan }) => plan.id));
  assert.deepEqual(new Set(coverage.modules.map((row) => row.advancedModuleId)), sourceIds);
  for (const row of coverage.modules) {
    assert.equal(typeof row.charId, 'string');
    assert.ok(row.effectKeys.rank3.length > 0, `${row.advancedModuleId} has no rank3 effect keys`);
    assert.ok(row.effectKeys.rank4.length > 0, `${row.advancedModuleId} has no rank4 effect keys`);
    assert.equal(typeof row.handler, 'string');
    assert.equal(typeof row.realAssertion, 'string');
    assert.ok(['complete', 'partial'].includes(row.completeness));
    assert.ok(row.sourceEffects.every((effect) => ['partial', 'complete'].includes(effect.status)), `${row.advancedModuleId} source-effect status is explicit`);
    if (row.completeness === 'complete') {
      assert.ok(row.sourceEffects.every((effect) => effect.status === 'complete'), `${row.advancedModuleId} has no unverified source effect`);
      assert.ok(row.verifiedModuleBehaviors?.length > 0, `${row.advancedModuleId} has a named real module behavior proof`);
    }
    for (const effect of row.sourceEffects.filter((entry) => entry.status === 'complete')) {
      assert.match(effect.assertion, /^test:/, `${row.advancedModuleId}/${effect.source} names a real test`);
    }
    if (row.status === 'delegated-to-main') assert.ok(row.handler === 'delegated-to-main');
  }
  const sourceEffects = coverage.modules.flatMap((row) => row.sourceEffects);
  assert.equal(coverage.pendingSourceEffectCount, sourceEffects.filter((effect) => effect.status !== 'complete').length);
  assert.equal(coverage.verifiedSourceEffectCount, sourceEffects.filter((effect) => effect.status === 'complete').length);
});

test('Ulpia CRU-Y R3/R4 consumes native white stats and native Abyssal kill growth with a nine-stack cap', () => {
  // 大巴扎：乌尔比安模组 003 卡面没有战斗效果，旧的「前路」击杀成长不再安装。
  const body = runtime.bodies.char_4145_ulpia;
  assert.equal(body.bazaar.modules?.uniequip_003_ulpia?.params ? Object.keys(body.bazaar.modules.uniequip_003_ulpia.params).length : 0, 0, 'the card face carries no 003 combat number');
  for (const star of [3, 4]) {
    const f = realBattle('char_4145_ulpia', 'uniequip_003_ulpia', `ulpia003-${star}`, [], star, 'char_263_skadi');
    const { battle, unit, extraUnit } = f;
    const initialBlock = unit.s.blockCnt, sharedHp = extraUnit.s.maxHp;
    for (let count = 1; count <= 9; count++) {
      const target = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [10, 7], mods: { hpMul: 100 } });
      battle.kill(target, unit);
      battle.assaultRuntime.flush();
    }
    assert.equal(unit.mem.assaultUlpiaYStacks ?? 0, 0, `R${star}: owner kills no longer grow CRU-Y stacks`);
    assert.equal(unit.s.blockCnt, initialBlock, `R${star}: no hidden +1 block`);
    assert.equal(extraUnit.s.maxHp, sharedHp, `R${star}: no shared Abyssal HP growth`);
  }
});

test('Ulpia CRU-Y applies native 1.1 only to ally-blocked enemies and rejects non-Abyssal credited kills', () => {
 // 大巴扎：003 不再给被阻挡敌人额外倍率，也不再按击杀叠层。
 for(const star of [3,4]){
  const blocked=realBattle('char_4145_ulpia','uniequip_003_ulpia',`ulpia003-blocked-${star}`,[[10,6]],star);
  const free=realBattle('char_4145_ulpia','uniequip_003_ulpia',`ulpia003-free-${star}`,[[10,6]],star);
  blocked.target.blockedBy=blocked.unit;blocked.target.s.def=500;free.target.s.def=500;
  const take=(f)=>{const before=f.target.hp;f.battle.dealDamage(f.unit,f.target,{amount:1000,type:'phys',isAttack:true,attackId:`ulpia003-${star}`});return before-f.target.hp;};
  const blockedLoss=take(blocked),freeLoss=take(free);
  assert.ok(Math.abs(blockedLoss/freeLoss-1)<1e-9,`R${star} blocked and free targets take the same damage (${blockedLoss}/${freeLoss})`);
  const nonAh=realBattle('char_4145_ulpia','uniequip_003_ulpia',`ulpia003-non-ah-${star}`,[[10,6]],star,'char_294_ayer');
  const victim=nonAh.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[10,7],mods:{hpMul:100}});
  nonAh.battle.kill(victim,nonAh.extraUnit);nonAh.battle.assaultRuntime.flush();
  assert.equal(nonAh.unit.mem.assaultUlpiaYStacks ?? 0,0,'a real non-Abyssal ally credited kill does not grow native stacks');
 }
});
test('module selection is exact, array-shaped choices are rejected, and rank gates are real', () => {
  const body = runtime.bodies.char_237_gravel;
  const battle = dummyBattle();
  const unit = dummyUnit(body, pieceFor(body, 2, 'uniequip_002_gravel'));
  assert.equal(installAssaultModule({ battle, unit, body, piece: unit.def.raw.assaultPiece, rank: 2 }).active, false);
  const enabledFalsePiece = pieceFor(body, 4, 'uniequip_002_gravel');
  const enabledFalseHook = installAssaultModule({ battle, unit: dummyUnit(body, enabledFalsePiece), body, piece: enabledFalsePiece, rank: 4 });
  assert.equal(body.modulePlans.find((plan) => plan.id === 'uniequip_002_gravel').enabled, false);
  assert.equal(enabledFalseHook.active, true);
  assert.throws(() => installAssaultModule({ battle, unit, body, piece: { ...unit.def.raw.assaultPiece, moduleChoices: [] }, rank: 4 }), /moduleChoices/);
  assert.throws(() => installAssaultModule({ battle, unit, body, piece: { ...unit.def.raw.assaultPiece, moduleId: 'uniequip_002_unknown' }, rank: 4 }), /unknown ADVANCED/);
  const estell = runtime.bodies.char_127_estell;
  const delegatedPiece = pieceFor(estell, 4, 'uniequip_002_estell');
  const delegated = installAssaultModule({ battle, unit: dummyUnit(estell, delegatedPiece), body: estell, piece: delegatedPiece, rank: 4 });
  assert.equal(delegated.delegatedToMain, true);
});

test('every handled module has both rank hooks for every compiled source effect', () => {
  for (const { body, plan } of advanced.filter(({ plan }) => !assaultAdvancedModuleIds.delegatedToMain.includes(plan.id))) {
    for (const star of [3, 4]) {
      const battle = dummyBattle();
      const piece = pieceFor(body, star, plan.id);
      const unit = dummyUnit(body, piece);
      const hook = installAssaultModule({ battle, unit, body, piece, rank: star });
      hook.beforeCast({ battle, unit, body, piece, rank: star, cause: null });
      for (const [effectIndex, source] of [...(body.fixedSkill.effects ?? []), ...(body.modePassives ?? [])].entries()) {
        const effect = { ...source, values: { ...(source.values ?? {}) } };
        const ctx = { battle, unit, body, piece, rank: star, cause: null, effect, params: effect.values,
          effectIndex, targets: [], hitCount: 0, damageScale: 1 };
        assert.doesNotThrow(() => hook.beforeEffect(ctx), `${body.charId}/${plan.id}/star${star}/effect${effectIndex}`);
        assert.doesNotThrow(() => hook.afterEffect(ctx), `${body.charId}/${plan.id}/star${star}/after${effectIndex}`);
      }
      assert.doesNotThrow(() => hook.afterCast({ battle, unit, body, piece, rank: star, hitCount: 0, cause: null }));
    }
  }
});

function realBattle(charId, moduleId, enemyKey, positions = [[10, 6]], star = 4, extraAllyCharId = null) {
  const body = runtime.bodies[charId];
  const piece = pieceFor(body, star, moduleId);
  const chess = chessRec({ id: `module-chess:${charId}:${moduleId}`, charId, profession: body.profession,
    stats: body.starStats[star - 1].stats, rangeGrid: body.range });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  const extraBody = extraAllyCharId ? runtime.bodies[extraAllyCharId] : null;
  const extraPiece = extraBody ? pieceFor(extraBody, 2, null) : null;
  const extraChess = extraBody ? chessRec({ id: `module-chess:${extraAllyCharId}:support`, charId: extraAllyCharId,
    profession: extraBody.profession, stats: extraBody.starStats[1].stats, rangeGrid: extraBody.range }) : null;
  if (extraChess) { extraChess.assaultPiece = extraPiece; extraChess.assaultBody = extraBody; }
  const enemy = enemyRec({ key: enemyKey, hp: 1000000000, def: 0, res: 0, atk: 0, speed: 0 });
  const data = new DataSource({ chess: { [chess.chessId]: chess, ...(extraChess ? { [extraChess.chessId]: extraChess } : {}) }, enemies: { [enemy.key]: enemy } }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: `module:${charId}:${moduleId}`, stage: flatStage(), routes: flatRoutes(),
    spawns: [{ enemyKey: enemy.key, time: 0, routeIndex: 0, pos: positions[0] }], data,
    players: [{ playerId: 'p1', units: [{ uid: piece.uid, chessId: chess.chessId, row: 10, col: 5 },
      ...(extraPiece ? [{ uid: extraPiece.uid, chessId: extraChess.chessId, row: 9, col: 5 }] : [])] }],
    content: 'assault', assault: { kits: { ...assaultKits }, strict: true }, flags: { dpInit: 99, dpPerSec: 0, dpMax: 99 },
    autoFinish: false, timeLimit: 60, quiet: true, logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  for (const pos of positions.slice(1)) battle.spawnEnemy(enemy.key, { routeIndex: 0, pos });
  battle._buildEnemyIndex();
  battle.step();
  return { battle, body, piece, unit: battle.allyUnits.find((candidate) => candidate.uid === piece.uid),
    extraUnit: extraPiece ? battle.allyUnits.find((candidate) => candidate.uid === extraPiece.uid) : null, target: battle.enemies[0] };
}

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

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('SilverAsh S3 source-tagged melee slashes publish real skill attacks', () => {
  for (const rank of [2, 4]) {
    const moduleId = rank === 4 ? 'uniequip_002_svrash' : null;
    const fixture = realBattle('char_172_svrash', moduleId, `module-svrash-melee-${rank}`, [[10, 6]], rank);
    const hits = [];
    fixture.battle.on('hit', (payload) => { if (payload.source === fixture.unit) hits.push(payload); }, { owner: fixture.unit });
    fixture.unit.skill.charges = 1;
    fixture.unit.skill.sp = fixture.unit.skill.spCost;
    const hp = fixture.target.hp;
    assert.equal(fixture.battle.assaultRuntime.cast(fixture.unit, { force: true }), true);
    assert.ok(fixture.target.hp < hp, `rank ${rank}: S3 performs real damage`);
    assert.ok(hits.length > 0 && hits.every((payload) => payload.dmg?.isAttack && payload.dmg?.isSkill && !payload.dmg?.isProjectile),
      `rank ${rank}: compiled asMelee source marks actual S3 hits as melee attacks`);
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

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Chongyue second module enters the real enhanced form on exactly the fourth skill cast', () => {
  for (const rank of [3, 4]) {
    const enabled = realBattle('char_2024_chyue', 'uniequip_002_chyue', `module-chyue-002-${rank}`, [[10, 6]], rank);
    const baseline = realBattle('char_2024_chyue', null, `module-chyue-002-base-${rank}`, [[10, 6]], rank);
    const cast = (fixture) => {
      fixture.unit.skill.charges = 1; fixture.unit.skill.sp = fixture.unit.skill.spCost;
      assert.equal(fixture.battle.assaultRuntime.cast(fixture.unit, { force: true }), true, `rank ${rank}: actual fixed-skill cast`);
      fixture.battle.assaultRuntime.flush();
    };
    // 大巴扎：重岳卡面没有「累计施放后觉醒」，模组 002 改为每次施放技能伤害 +x%。
    for (let i = 0; i < 5; i++) { cast(enabled); cast(baseline); }
    assert.notEqual(enabled.unit.mem.assaultChyueAwakened, true, `rank ${rank}: no enhanced form after four casts with the module`);
    assert.notEqual(baseline.unit.mem.assaultChyueAwakened, true, `rank ${rank}: no enhanced form after five casts either`);
  }
});

// 乌尔比安: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-pilot.test.mjs



// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Assault push extraDistance adds exact travel after weight correction and reports each real blocked terrain once', () => {
  const travel = (weight, extraDistance) => {
    const fixture = realBattle('char_4036_forcer', null, `extra-distance-${weight}-${extraDistance}`, [[10, 6]], 3);
    const { battle, unit, target } = fixture;
    Object.assign(target, { x: 6, y: 10, tileC: 6, tileR: 10 });
    target.s.massLevel = weight;
    const result = battle.assaultPushEnemy(target, unit, 3,
      { from: unit, dir: { x: 1, y: 0 }, fixed: true, extraDistance });
    return result.moved;
  };
  for (const weight of [1, 2]) {
    const baseline = travel(weight, 0), extended = travel(weight, 1);
    assert.ok(baseline > 0, `weight ${weight} has native movement`);
    assert.ok(Math.abs((extended - baseline) - 1) < 1e-8,
      `weight ${weight} receives precisely one additional tile after native force/weight calculation; ${baseline} -> ${extended}`);
  }
  assert.notEqual(travel(1, 0), travel(2, 0), 'native baseline movement still differs by enemy weight');

  const blocked = realBattle('char_4036_forcer', null, 'extra-distance-blocked', [[10, 6]], 3);
  Object.assign(blocked.target, { x: 6, y: 10, tileC: 6, tileR: 10 });
  blocked.target.s.massLevel = 1;
  const wallKey = 10 * blocked.battle.grid.cols + 8;
  blocked.battle.grid.tiles[wallKey] = { ...blocked.battle.grid.tile(10, 8), height: 'HIGH', pass: 'FLY' };
  const contacts = [];
  blocked.battle.assaultRuntime.observe('pushCollision', 'extra-distance-blocked-test', ({ payload }) => contacts.push(payload));
  const wallResult = blocked.battle.assaultPushEnemy(blocked.target, blocked.unit, 3,
    { from: blocked.unit, dir: { x: 1, y: 0 }, fixed: true, extraDistance: 1 });
  assert.equal(wallResult.collision.kind, 'highland');
  assert.equal(contacts.length, 1, 'one physical stop produces one real collision callback');
  assert.ok(wallResult.moved < 2.7, 'the native wall shortens the requested base-plus-extra travel');

  const solidWall = realBattle('char_4036_forcer', null, 'extra-distance-wall', [[10, 6]], 3);
  Object.assign(solidWall.target, { x: 6, y: 10, tileC: 6, tileR: 10 });
  solidWall.target.s.massLevel = 1;
  const solidKey = 10 * solidWall.battle.grid.cols + 8;
  solidWall.battle.grid.tiles[solidKey] = { ...solidWall.battle.grid.tile(10, 8), height: 'LOW', pass: 'NONE' };
  const wallContact = solidWall.battle.assaultPushEnemy(solidWall.target, solidWall.unit, 3,
    { from: solidWall.unit, dir: { x: 1, y: 0 }, fixed: true, extraDistance: 1 });
  assert.equal(wallContact.collision.kind, 'wall');

  const edge = realBattle('char_4036_forcer', null, 'extra-distance-boundary', [[10, 6]], 3);
  const edgeCol = edge.battle.grid.rect.c1;
  edge.battle.grid.tiles[10 * edge.battle.grid.cols + edgeCol] = { ...edge.battle.grid.tile(10, edgeCol), height: 'LOW', pass: 'ALL', build: 'ALL' };
  Object.assign(edge.target, { x: edgeCol - 0.1, y: 10, tileC: edgeCol, tileR: 10 });
  edge.target.s.massLevel = 1;
  const boundary = edge.battle.assaultPushEnemy(edge.target, edge.unit, 3,
    { from: edge.unit, dir: { x: 1, y: 0 }, fixed: true, extraDistance: 1 });
  assert.equal(boundary.collision.kind, 'boundary');

  const device = realBattle('char_4036_forcer', null, 'extra-distance-device', [[10, 6]], 3);
  Object.assign(device.target, { x: 6, y: 10, tileC: 6, tileR: 10 });
  device.target.s.massLevel = 1;
  const blocker = device.battle.spawnDevice('fixture:crate', 10, 8, { name: 'fixture crate', hp: 100, obstacle: true, obstacleKind: 'crate' });
  const deviceContact = device.battle.assaultPushEnemy(device.target, device.unit, 3,
    { from: device.unit, dir: { x: 1, y: 0 }, fixed: true, extraDistance: 1 });
  assert.equal(deviceContact.collision.kind, 'device');
  assert.equal(deviceContact.collision.other, blocker, 'the report identifies the actual blocking device object');

  const immune = realBattle('char_4036_forcer', null, 'extra-distance-no-native-motion', [[10, 6]], 3);
  Object.assign(immune.target, { x: 6, y: 10, tileC: 6, tileR: 10 });
  immune.target.s.massLevel = 6;
  assert.deepEqual(immune.battle.assaultPushEnemy(immune.target, immune.unit, 3,
    { from: immune.unit, dir: { x: 1, y: 0 }, fixed: true, extraDistance: 2 }), { moved: 0, collision: null },
  'extra distance never creates travel when the native force/weight result is zero');
  assert.throws(() => immune.battle.push(immune.target, 3,
    { from: immune.unit, dir: { x: 1, y: 0 }, fixed: true, extraDistance: -1 }), /finite non-negative/);
  immune.battle.assaultStrict = false;
  assert.throws(() => immune.battle.push(immune.target, 3, { extraDistance: 0 }), /requires assault content/);
});

test('every handled module enters its selected main KIT and produces a real Battle state change at both ranks', () => {
  const handled = new Set(assaultAdvancedModuleIds.handledHere);
  for (const { body, plan } of advanced.filter(({ plan }) => handled.has(plan.id))) {
    for (const star of [3, 4]) {
      const matrixPositions = body.charId === 'char_294_ayer' ? [[9, 5]] : ['uniequip_002_kazema', 'uniequip_002_siege2', 'uniequip_003_siege2'].includes(plan.id)
        ? [[10, 7]]
        : ['uniequip_002_nearl2', 'uniequip_003_nearl2'].includes(plan.id)
          ? [[10, 6]] : [[10, 6], [10, 6], [9, 6], [11, 6], [10, 7]];
      const fixture = realBattle(body.charId, plan.id, `module-matrix-${body.charId}-${plan.id}-${star}`,
        matrixPositions, star, body.charId === 'char_294_ayer' ? 'char_127_estell' : null);
      const { battle, unit } = fixture;
      if (body.charId === 'char_294_ayer') {
        assert.ok(fixture.extraUnit?.alive && fixture.extraUnit.deployed);
        assert.equal(battle._checkBlock(fixture.target), true);
        assert.equal(fixture.target.blockedBy, fixture.extraUnit, 'Ayer module matrix uses its real neighboring ally blocker');
      }
      if (['char_491_humus', 'char_1023_ghost2'].includes(body.charId)) {
        const blocked = battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex: 0, pos: [unit.tileR, unit.tileC], mods: { hpMul: 100 } });
        assert.equal(battle._checkBlock(blocked), true, `${body.charId} module matrix uses actual native self blocking`);
        assert.equal(blocked.blockedBy, unit);
        battle._buildEnemyIndex();
      }
      if (['uniequip_003_swire2', 'uniequip_004_swire2'].includes(plan.id)) battle.addCoins(unit.ownerId, 2);
      unit.skill.charges = 1;
      unit.skill.sp = unit.skill.spCost;
      const beforeHp = unit.hp;
      const beforeEnemies = battle.enemies.map((enemy) => ({ hp: enemy.hp, flags: { ...(enemy.s?.flags ?? {}) } }));
      const beforeAllyCount = battle.allyUnits.length;
      const beforeDp = battle.getPlayer(unit.ownerId)?.dp;
      const beforeCoins = battle.getPlayer(unit.ownerId)?.coins;
      const beforeAmmo = unit.mem.assaultAmmo?.left;
      assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true, `${plan.id} rank ${star} real assaultCast`);
      battle.assaultRuntime.flush();
      const enemyChanged = battle.enemies.some((enemy, index) => enemy.hp !== beforeEnemies[index]?.hp ||
        JSON.stringify(enemy.s?.flags ?? {}) !== JSON.stringify(beforeEnemies[index]?.flags ?? {}));
      const player = battle.getPlayer(unit.ownerId);
      const changed = enemyChanged || unit.hp !== beforeHp || unit.buffs.length > 0 ||
        (plan.id === 'uniequip_002_hbound' && unit.mem.latestHboundFields?.size > 0) ||
        battle.allyUnits.length > beforeAllyCount || player?.dp !== beforeDp || player?.coins !== beforeCoins || unit.mem.assaultAmmo?.left !== beforeAmmo;
      assert.ok(changed, `${body.charId}/${plan.id} rank ${star} changed no real Battle state`);
    }
  }
});

test('delegated modules are checked through the real main KIT path before coverage is promoted', () => {
  const delegated = new Set(assaultAdvancedModuleIds.delegatedToMain);
  const partialCandidates = new Set(['uniequip_002_robin', 'uniequip_002_tinman', 'uniequip_002_angel2',
    'uniequip_002_thorn2', 'uniequip_002_svrash', 'uniequip_002_gvial2', 'uniequip_002_amiya2', 'uniequip_002_amiya3']);
  for (const { body, plan } of advanced.filter(({ plan }) => delegated.has(plan.id) && partialCandidates.has(plan.id))) {
    for (const star of [3, 4]) {
      const fixture = realBattle(body.charId, plan.id, `delegated-matrix-${body.charId}-${plan.id}-${star}`,
        [[10, 6], [10, 6], [9, 6], [11, 6]], star, body.charId === 'char_1041_angel2' ? 'char_127_estell' : null);
      const { battle, unit } = fixture;
      if (body.charId === 'char_1041_angel2') battle.kill(fixture.extraUnit, null);
      unit.skill.charges = 1;
      unit.skill.sp = unit.skill.spCost;
      const beforeHp = unit.hp;
      const beforeEnemies = battle.enemies.map((enemy) => ({ hp: enemy.hp, flags: { ...(enemy.s?.flags ?? {}) } }));
      const beforeAllyCount = battle.allyUnits.length;
      const beforeDeliveryState = fixture.extraUnit ? `${fixture.extraUnit.alive}/${fixture.extraUnit.deployed}` : null;
      assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true, `${plan.id} rank ${star} delegated real assaultCast`);
      battle.assaultRuntime.flush();
      const enemyChanged = battle.enemies.some((enemy, index) => enemy.hp !== beforeEnemies[index]?.hp ||
        JSON.stringify(enemy.s?.flags ?? {}) !== JSON.stringify(beforeEnemies[index]?.flags ?? {}));
      const deliveryChanged = fixture.extraUnit && `${fixture.extraUnit.alive}/${fixture.extraUnit.deployed}` !== beforeDeliveryState;
      assert.ok(enemyChanged || unit.hp !== beforeHp || unit.buffs.length > 0 || battle.allyUnits.length > beforeAllyCount || deliveryChanged,
        `${body.charId}/${plan.id} rank ${star} delegated cast produced no real Battle state change`);
    }
  }
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// 重岳: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-pilot.test.mjs

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
