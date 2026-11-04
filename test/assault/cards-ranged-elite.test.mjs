import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rangedEliteCards } from '../../server/sim/content/assault/cards/ranged-elite.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { synergyRangedKits } from '../../server/sim/content/assault/cards/synergy-ranged.js';
import { rangedEliteTokenKits } from '../../server/sim/content/assault/cards/ranged-elite/tokens.js';
import { Battle } from '../../server/sim/Battle.js';
import { COLS } from '../../server/sim/constants.js';
import { dirVec } from '../../server/sim/dir.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { assaultAmmoState, setAssaultAmmoCapacityBonus } from '../../server/sim/content/assault/ammo.js';
import { ledgerFor, returnSummon, summonPlacementLegal } from '../../server/sim/content/assault/summons.js';
import { heal } from '../../server/sim/content/assault/primitives.js';
import { slowShots, endShots } from '../../server/sim/content/kits/ops/op-logos.js';
import { getData } from '../../server/data.js';
import { getAssaultData } from '../../server/modes/assault/data.js';
import { toAssaultSimData } from '../../shared/assault/catalog.js';
import { loadAssaultRuntime } from '../helpers/assaultRuntime.js';

const runtime = loadAssaultRuntime();
const quiet = { warn() {}, error() {}, info() {}, log() {} };
const simData = toAssaultSimData(runtime, getAssaultData({ runtime,
  nativeData: getData({ dir: process.env.SP_DATA_DIR, log: quiet }) }).nativeData);
const coverage = JSON.parse(fs.readFileSync(new URL('../../data/assault-coverage-ranged-elite.json', import.meta.url), 'utf8'));
const CHAR_IDS = [
  'char_430_fartth', 'char_4193_lemuen', 'char_391_rosmon', 'char_1035_wisdel', 'char_4117_ray',
  'char_213_mostma', 'char_4027_heyak', 'char_4133_logos', 'char_2015_dusk', 'char_472_pasngr',
  'char_426_billro', 'char_1046_sbell2', 'char_1038_whitw2', 'char_4146_nymph', 'char_1040_blaze2',
  'char_206_gnosis', 'char_291_aglina', 'char_358_lisa', 'char_1047_halo2', 'char_1012_skadi2',
  'char_4134_cetsyr', 'char_4202_haruka', 'char_2023_ling', 'char_4072_ironmn', 'char_245_cello',
];
const TOKEN_IDS = [
  'token_10012_rosmon_shield', 'token_10035_wisdel_wward', 'token_10034_ray_sndbst',
  'token_10015_dusk_drgn', 'token_10017_skadi2_dedant', 'token_10020_ling_soul3',
  'token_10027_ironmn_pile2', 'token_10020_ling_soul1', 'token_10020_ling_soul2',
  'token_10027_ironmn_pile1', 'token_10027_ironmn_pile3',
];

// 卡面参数（data/assault-design/bazaar-cards-ranged.json 编译进 body.bazaar；百分数以整数存）。
const cardLine = (charId, index, name, star) => runtime.bodies[charId].bazaar.lines[index].params[name][star - 1];
const cardModule = (charId, moduleId, name, star) => runtime.bodies[charId].bazaar.modules[moduleId].params[name][star - 1];
const near = (actual, expected, eps = 1e-6) => Math.abs(actual - expected) < eps;

function pieceFor(body, star = 4, moduleId = null, uid = `ranged-elite:${body.charId}:${moduleId ?? 'base'}`) {
  return { uid, charId: body.charId, star, moduleChoices: moduleId ? { [body.charId]: moduleId } : {} };
}

function realBattle(charId, moduleId = null, { star = 4, enemyCount = 1, enemyOptions = {}, extraOwners = [],summonPresets=null } = {}) {
  const body = runtime.bodies[charId];
  const piece = pieceFor(body, star, moduleId);
  if(body.adaptation?.type==='E')piece.summonPresets=[{tokenId:body.fixedSkill.source.native.overrideTokenKey,row:10,col:8,dir:'RIGHT'}];
  if(summonPresets)piece.summonPresets=summonPresets;
  const chess = chessRec({ id: piece.uid, charId, profession: body.profession, stats: body.starStats[star - 1].stats, rangeGrid: body.range });
  chess.assaultPiece = piece;
  chess.assaultBody = body;
  const extras = extraOwners.map((entry, index) => {
    const extraBody = runtime.bodies[entry.charId];
    const extraPiece = pieceFor(extraBody, entry.star ?? 4, null, entry.uid ?? `${piece.uid}:extra:${index}`);
    const extraChess = chessRec({ id: extraPiece.uid, charId: extraPiece.charId, profession: extraBody.profession,
      stats: extraBody.starStats[(entry.star ?? 4) - 1].stats, rangeGrid: extraBody.range });
    extraChess.assaultPiece = extraPiece; extraChess.assaultBody = extraBody;
    return { body: extraBody, piece: extraPiece, chess: extraChess, row: entry.row ?? 10, col: entry.col ?? 6 };
  });
  const enemies = Object.fromEntries(Array.from({ length: enemyCount }, (_, index) => {
    const key = `${piece.uid}:enemy:${index}`;
    return [key, enemyRec({ key, hp: 100000, atk: 0, def: 0, res: 0, speed: 0, ...enemyOptions })];
  }));
  const spawns = Object.keys(enemies).map((key, index) => ({ enemyKey: key, time: 0, routeIndex: 0, pos: [10, 7 + index] }));
  const data = new DataSource({ chess: Object.fromEntries([chess, ...extras.map((entry) => entry.chess)].map((record) => [record.chessId, record])), tokens: simData.tokens, enemies }, getDefaultSource());
  const battle = new Battle({ seed: 20261009, kind: 'normal', modeId: piece.uid, stage: flatStage(), routes: flatRoutes(), spawns, data,
    players: [{ playerId: 'p1', units: [{ uid: piece.uid, chessId: piece.uid, row: 10, col: 5 }, ...extras.map((entry) => ({ uid: entry.piece.uid, chessId: entry.chess.chessId, row: entry.row, col: entry.col }))] }],
    content: 'assault', assault: { kits: { ...assaultKits }, strict: true },
    flags: { dpInit: 99, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.on('battleStart', () => {
    for (const ally of battle.allyUnits) if (ally.skill) { ally.skill.sp = 0; ally.skill.charges = ally.skill.maxCharges; }
  }, { priority: 1000 });
  battle.start();
  // Setup must not auto-cast a full initial-SP skill before a test installs
  // its causal observers; each probe explicitly primes the one cast it checks.
  for (const ally of battle.allyUnits) if (ally.skill) { ally.skill.sp = 0; ally.skill.charges = 0; }
  battle.step();
  for (const ally of battle.allyUnits) if (ally.skill) { ally.skill.sp = 0; ally.skill.charges = ally.skill.maxCharges; }
  const unit = battle.allyUnits.find((candidate) => candidate.uid === piece.uid);
  return { battle, body, piece, unit, enemies: battle.enemies, extraUnits: extras.map((entry) => battle.allyUnits.find((candidate) => candidate.uid === entry.piece.uid)) };
}

function castOnce(ctx, { advance = true } = {}) {
  const before = ctx.enemies.reduce((sum, target) => sum + target.hp, 0);
  // Fill the real SkillRuntime once per probe so SP consumption, skill events, and
  // the outer instant contract are exercised alongside the typed assault handler.
  ctx.unit.skill.sp = ctx.unit.skill.spCost;
  ctx.unit.skill.charges = ctx.unit.skill.maxCharges;
  const result = ctx.unit.skill.activate('ranged-elite-test');
  ctx.battle.assaultRuntime.flush();
  if (advance) ctx.battle.step();
  return { result, damage: before - ctx.enemies.reduce((sum, target) => sum + target.hp, 0) };
}

function prepareRosmonBlockedTarget(ctx, target) {
  castOnce(ctx);
  const landingStun = target.buffs.find((entry) => entry.status === 'stun' && String(entry.key).includes('token:rosmon')) ?? null;
  for (let tick = 0; tick < 600 && target.blockedBy?.ownerUnit !== ctx.unit; tick++) ctx.battle.step();
  assert.ok(target.blockedBy?.ownerUnit === ctx.unit, `a real deployed Rosmontis device blocks the enemy through native route movement; target=${JSON.stringify({ tile:[target.tileR,target.tileC],pos:[target.x,target.y],moveSpeed:target.s.moveSpeed,moving:target.moving,routeIndex:target.routeIndex,alive:target.alive,blockedBy:target.blockedBy?.uid })} tokens=${JSON.stringify(ctx.battle.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===ctx.unit).map(x=>({uid:x.uid,kind:x.kind,tile:[x.tileR,x.tileC],alive:x.alive,deployed:x.deployed,blocking:x.blocking?.map(y=>y.uid)})))}`);
  assert.ok(ctx.unit.summons?.some((summon) => summon.ownerUnit === ctx.unit && summon.alive && summon.deployed)
    || ctx.battle.allyUnits.some((summon) => summon.kind === 'token' && summon.ownerUnit === ctx.unit && summon.alive && summon.deployed),
  'the blocker is an active source-backed Rosmontis device');
  return { blocker: target.blockedBy, landingStun };
}

test('ranged-elite exports exactly the assigned 25 cards and 11 real token identities', () => {
  assert.deepEqual(Object.keys(rangedEliteCards), CHAR_IDS);
  assert.deepEqual([...Object.keys(rangedEliteTokenKits)].sort(), [...TOKEN_IDS].sort());
  for (const charId of CHAR_IDS) {
    const body = runtime.bodies[charId];
    assert.ok(body?.fixedSkill, `${charId} fixed skill`);
    assert.ok(Array.isArray(body.modePassives), `${charId} mode passives`);
    assert.ok(Array.isArray(body.talentBindings), `${charId} retained talents`);
    const base = realBattle(charId);
    assert.equal(typeof base.unit.kit.skill.assaultCast, 'function', `${charId} cast handler`);
  }
});

test('summon kits preserve only source-backed ordinary attacks and native cadence', () => {
  const attackProbe = (charId, tokenId, { summonBySkill = false } = {}) => {
    const ctx = realBattle(charId);
    let token;
    if (summonBySkill) {
      castOnce(ctx);
      token = ctx.battle.allyUnits.find((candidate) => candidate.kind === 'token' && candidate.ownerUnit === ctx.unit && candidate.defId === tokenId && candidate.alive && candidate.deployed);
    } else token = ctx.battle.spawnToken(ctx.unit, tokenId, 10, 9, { anySource: true });
    assert.ok(token, `${tokenId} is deployed by its actual source token path`);
    assert.equal(token.profile.noAttack, false, `${tokenId} retains its ordinary attack profile`);
    assert.ok(token.s.atk > 0, `${tokenId} has positive compiled source attack`);
    const target = ctx.enemies[0];
    const targetKey = [...token.rangeKeySet][0];
    assert.ok(targetKey != null, `${tokenId} has a source attack-range tile`);
    target.tileR = Math.floor(targetKey / COLS); target.tileC = targetKey % COLS;
    target.x = target.tileC; target.y = target.tileR;
    ctx.battle._buildEnemyIndex();
    const beforeHp = target.hp;
    const attacks = [];
    ctx.battle.on('attack', ({ attacker, targets, isSkill }) => {
      if (attacker === token && !isSkill && targets?.includes(target)) attacks.push(ctx.battle.time);
    });
    for (let i = 0; i < 100 && !attacks.length; i++) ctx.battle.step();
    assert.ok(attacks.length > 0, `${tokenId} launches a normal attack through native Battle AI`);
    assert.ok(target.hp < beforeHp, `${tokenId} causes actual target HP loss (${beforeHp} -> ${target.hp})`);
    assert.equal(ctx.battle.errors?.length ?? 0, 0);
    return { ctx, token, target, beforeHp };
  };

  // 迷迭香: a synergy card (design of 2026-10-21) without a summon
  const dusk = attackProbe('char_2015_dusk', 'token_10015_dusk_drgn');
  assert.equal(dusk.token.s.atk, simData.tokens.token_10015_dusk_drgn.stats.atk, 'Dusk token attack equals its current normalized source profile');
  assert.equal(dusk.token.s.maxHp, simData.tokens.token_10015_dusk_drgn.stats.maxHp,
    'Dusk runtime HP equals the compiled five-times native source profile');
  assert.equal(dusk.token.s.maxHp, simData.tokens.token_10015_dusk_drgn.sourceTemplate.stats.maxHp * simData.tokens.token_10015_dusk_drgn.lifeScaleFactor,
    'the compiled source life multiplier explains the runtime HP instead of reusing old unscaled HP');
  const ling = attackProbe('char_2023_ling', 'token_10020_ling_soul2', { summonBySkill: true });
  attackProbe('char_2023_ling', 'token_10020_ling_soul1');
  attackProbe('char_2023_ling', 'token_10020_ling_soul2');

  assert.equal(runtime.bodies.char_2023_ling.fixedSkill.sourceSkillId, 'skchr_ling_2', 'Ling uses the native S2 remote summon');
  assert.equal(ling.token.defId, 'token_10020_ling_soul2', 'the S2 summon retains its source identity and normal attack');
  assert.equal(ling.ctx.battle.allyUnits.some((candidate) => candidate.ownerUnit === ling.ctx.unit && candidate.defId === 'lingLargeDragon'), false,
    'the S2 single-cast skill does not create the retired S3 fused dragon');

  for (const [charId, tokenId] of [
    ['char_1012_skadi2', 'token_10017_skadi2_dedant'],
    ['char_4072_ironmn', 'token_10027_ironmn_pile2'],
  ]) {
    const ctx = realBattle(charId,null,{summonPresets:[{tokenId,row:10,col:6,dir:'RIGHT'}]});
    const target = ctx.enemies[0], rangeKey = [...ctx.unit.rangeKeys][0];
    target.tileR = Math.floor(rangeKey / COLS); target.tileC = rangeKey % COLS; target.x = target.tileC; target.y = target.tileR;
    ctx.battle._buildEnemyIndex();
    castOnce(ctx);
    const support = ctx.battle.allyUnits.find((candidate) => candidate.kind === 'token' && candidate.ownerUnit === ctx.unit && candidate.defId === tokenId && candidate.alive && candidate.deployed);
    assert.ok(support, `${tokenId} support token is actually deployed`);
    assert.equal(support.profile.noAttack, true, `${tokenId} remains a source-defined support entity`);
  }
  for (const tokenId of ['token_10027_ironmn_pile1', 'token_10027_ironmn_pile3']) {
    assert.equal(rangedEliteTokenKits[tokenId]().trait.noAttack, true, `${tokenId} retains the native nonattacking device policy`);
  }
  assert.equal(dusk.ctx.battle.errors?.length ?? 0, 0);
  assert.equal(ling.ctx.battle.errors?.length ?? 0, 0);
});

test('every assigned card and every translated ADVANCED module deploys and resolves through a real Battle', () => {
  let probes = 0;
  for (const charId of CHAR_IDS) {
    const body = runtime.bodies[charId];
    const modulePlans = (body.modulePlans ?? []).filter((plan) => plan.type === 'ADVANCED');
    for (const [moduleId, stars] of [[null, [4]], ...modulePlans.map((plan) => [plan.id, [3, 4]])]) {
      for (const star of stars) {
        const ctx = realBattle(charId, moduleId, { star, enemyCount: charId === 'char_4193_lemuen' ? 2 : 1 });
        const { result } = castOnce(ctx);
        assert.equal(typeof result, 'boolean', `${charId}/${moduleId ?? 'base'}/star${star} cast result`);
        assert.equal(ctx.battle.errors?.length ?? 0, 0, `${charId}/${moduleId ?? 'base'}/star${star} battle errors`);
        assert.ok(ctx.battle.allyUnits.some((unit) => unit.kind === 'token' && unit.ownerUnit === ctx.unit)
          || ctx.enemies.some((target) => target.hp < 100000)
          || ctx.unit.mem?.rangedEliteFields?.size
          || ctx.unit.mem?.cetsyrDust != null
          || ctx.unit.buffs?.length > 0
          || result === true,
        `${charId}/${moduleId ?? 'base'}/star${star} produced no observable skill result`);
        probes++;
      }
    }
  }
  assert.equal(probes, CHAR_IDS.reduce((sum,id)=>sum+1+2*runtime.bodies[id].modulePlans.filter(m=>m.type==='ADVANCED').length,0));
});

// 令: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-pilot.test.mjs

// replaced by the synergy cards (design of 2026-10-21) — 浊心斯卡蒂 / 遥 are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-7.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// 莫斯提马: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-pilot.test.mjs

// 莫斯提马: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-pilot.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

test('Logos native projectile helper releases one source without orphaning overlapping field slows', () => {
  const shot = { source: { side: 'enemy' }, x: 2, y: 2, speed: 10, maxAge: 10, age: 0 };
  const battle = { projectiles: { list: [shot] } };
  const tile = 2 * COLS + 2;
  const first = { id: 'logos-a', rangeKeySet: new Set([tile]), rangeKeys: [tile] };
  const second = { id: 'logos-b', rangeKeySet: new Set([tile]), rangeKeys: [tile] };
  slowShots(battle, first, 0.05);
  slowShots(battle, second, 0.05);
  assert.equal(shot.speed, 0.5);
  endShots(battle, first, false);
  assert.equal(shot.speed, 0.5, 'the other field still owns its slow');
  endShots(battle, second, false);
  assert.equal(shot.speed, 10, 'the last field restores the original projectile speed');
});

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-5.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-ranged-6.test.mjs

test('coverage requires every elite source effect to have a complete per-star Battle audit', () => {
  assert.deepEqual(coverage.cards, CHAR_IDS);
  assert.deepEqual(coverage.tokens, TOKEN_IDS);
  const cardRows = new Map(coverage.cardCoverage.map((row) => [row.charId, row]));
  const moduleRows = new Map(coverage.modules.map((row) => [row.advancedModuleId, row]));
  const moduleAudit = new Map(coverage.moduleAudit.map((row) => [`${row.charId}/${row.moduleId}`, row]));
  let advancedCount = 0;
  for (const charId of CHAR_IDS) {
    const body = runtime.bodies[charId];
    const row = cardRows.get(charId);
    assert.ok(row, `${charId} coverage row`);
    assert.equal(row.status, 'complete');
    assert.deepEqual(row.fixedEffects, body.fixedSkill.effects.map((_, index) => `fixedSkill.effect:${index}`));
    assert.deepEqual(row.modePassives, body.modePassives.map((_, index) => `modePassive:${index}`));
    assert.deepEqual(row.talents, body.talentBindings.map((entry) => entry.binding));
    for (const plan of (body.modulePlans ?? []).filter((entry) => entry.type === 'ADVANCED')) {
      advancedCount++;
      if(body.adaptation){assert.ok(plan.adaptationUpgrade&&plan.source.pointer);continue;}
      const module = moduleRows.get(plan.id);
      assert.ok(module, `${charId}/${plan.id} coverage row`);
      assert.equal(module.status, 'complete');
      assert.equal(module.charId, charId);
      assert.deepEqual(module.effectHandling, plan.translation.effectHandling);
      const audit = moduleAudit.get(`${charId}/${plan.id}`);
      assert.ok(audit, `${charId}/${plan.id} per-star audit row`);
      assert.equal(audit.star3.status, 'complete');
      assert.equal(audit.star4.status, 'complete');
      assert.equal(typeof audit.star3.testName, 'string');
      assert.equal(typeof audit.star4.testName, 'string');
      for (const star of [audit.star3, audit.star4]) {
        assert.ok(star.effects.length > 0 && star.effects.every((effect) => effect.status === 'complete' && effect.testName), `${charId}/${plan.id} completes each source effect individually`);
      }
    }
  }
  assert.equal(coverage.moduleAudit.length, CHAR_IDS.reduce((sum,id)=>sum+(runtime.bodies[id].source.modules??runtime.bodies[id].modulePlans).filter(m=>m.type==='ADVANCED').length,0));
  assert.equal(cardRows.get('char_4117_ray').ammoPool.status, 'implemented');
  assert.equal(cardRows.get('char_1035_wisdel').ammoPool.status, 'unused-source');
});
