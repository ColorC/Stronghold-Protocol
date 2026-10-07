import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { skillSpecSource } from '../../server/sim/content/index.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { COLS } from '../../server/sim/constants.js';
import { NATIVE_DEFAULT_SKILL_IDS, NATIVE_KIT_READY, NATIVE_SKILL_SUPPORT } from '../../server/sim/content/newnativekits.js';
import { NATIVE_KIT_READY as VKS_READY } from '../../server/sim/content/nativeVictoriaKazimierzSiracusa.js';

const chessData = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const tokenData = JSON.parse(fs.readFileSync(new URL('../../data/tokens.json', import.meta.url), 'utf8'));
const id = 'chess_native_char_235_jesica_a';
const record = chessData[id];
const meleeId = 'chess_char_1_02_a';
const normalized = new DataSource({ chess: { [id]: record } }, getDefaultSource()).getChess(id);
const vanillaId = 'chess_native_char_240_wyvern_a';
const vanillaRecord = chessData[vanillaId];
const acidDropId = 'chess_native_char_366_acdrop_a';
const acidDropRecord = chessData[acidDropId];
const qingliuId = 'chess_native_char_385_finlpp_a';
const qingliuRecord = chessData[qingliuId];
const wanqingId = 'chess_native_char_4119_wanqin_a';
const wanqingRecord = chessData[wanqingId];
const nineColoredDeerId = 'chess_native_char_4019_ncdeer_a';
const nineColoredDeerRecord = chessData[nineColoredDeerId];
const shuId = 'chess_native_char_2025_shu_a';
const shuRecord = chessData[shuId];
const chongyueId = 'chess_native_char_2024_chyue_a';
const chongyueRecord = chessData[chongyueId];
const robertaId = 'chess_native_char_484_robrta_a';
const robertaRecord = chessData[robertaId];
const robinId = 'chess_native_char_451_robin_a';
const robinRecord = { ...chessData[robinId], skill: chessData[robinId].skills?.[0] ?? null };
const dorothyId = 'chess_native_char_4048_doroth_a';
const dorothyRecord = { ...chessData[dorothyId], skill: chessData[dorothyId].skills?.[0] ?? null };
const fireJessicaId = 'chess_native_char_1034_jesca2_a';
const fireJessicaRecord = { ...chessData[fireJessicaId], skill: chessData[fireJessicaId].skills?.[0] ?? null };
const lingId = 'chess_native_char_2023_ling_b';
const lingRecord = { ...chessData[lingId], skill: chessData[lingId].skills?.[0] ?? null };
const taraxaId = 'chess_native_char_4222_taraxa_a';
const taraxaRecord = chessData[taraxaId];
const melId = 'chess_native_char_242_otter_a';
const melRecord = chessData[melId];
const miboTokenId = 'token_10004_otter_motter';
const miboTokenRecord = tokenData[miboTokenId];

test('native importer marks only complete default kits Workshop-playable while preserving global hidden status', () => {
  const readyIds = new Set([...NATIVE_KIT_READY,...Object.entries(VKS_READY).filter(([,r])=>r.ready&&r.talentReady&&r.skillReady&&r.tokenReady).map(([id])=>id)]);
  const candidates = Object.values(chessData).filter((rec) => rec.chessType === 'NATIVE_IMPORT_CANDIDATE');
  for (const rec of candidates) {
    assert.equal(rec.visible, false);
    assert.equal(rec.isHidden, true);
    assert.equal(rec.nativeImport.playable,readyIds.has(rec.charId),`${rec.charId} eligibility matches the explicit tested-kit manifest`);
    if (rec.nativeImport.playable) {
      assert.ok(readyIds.has(rec.charId), `${rec.charId} source data cannot mark an unregistered native kit ready`);
      assert.equal(rec.nativeImport.playable, true, `${rec.charId} complete default kit is independent-only playable`);
      assert.equal(rec.nativeImport.status, 'workshop-default-kit-ready');
      assert.deepEqual(rec.nativeImport.availableModes, ['independent']);
    }
  }
  for (const charId of ['char_484_robrta', 'char_451_robin', 'char_4048_doroth', 'char_1034_jesca2', 'char_2023_ling']) {
    assert.ok(readyIds.has(charId));
    assert.ok(NATIVE_DEFAULT_SKILL_IDS[charId]);
    assert.ok(NATIVE_SKILL_SUPPORT[charId]?.includes(NATIVE_DEFAULT_SKILL_IDS[charId]));
  }
});

test('native Jessica S1: native blackboard powers attack-recovery next-hit multiplier in battle', () => {
  assert.ok(record?.nativeGrowth?.phases?.length);
  assert.equal(record.skill.skillId, 'skchr_jesica_1');
  assert.equal(record.skill.bb.atk_scale, 1.85);
  assert.equal(skillSpecSource(normalized), 'skills');

  const h = makeBattle({
    defs: { chess: { [id]: record }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } },
    units: [{ chessId: id, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 8] }],
    captureNoisy: true,
  });
  const unit = h.unit(id);
  h.run(8);
  assert.ok(unit.skill.activations > 0, 'AUTO attack-recovery skill activates');
  assert.ok(Math.abs(unit.s.aspd - (unit.base.aspd + 6)) < 1e-8, 'native first talent ASPD applies');
  const enemy = h.enemy('enemy_dummy');
  const hits = h.eventsOf('dmg').filter((event) => event[1] === enemy.id && event[4] === unit.id);
  assert.ok(hits.length >= 5);
  const expected = unit.s.atk * 1.85;
  assert.ok(hits.some((event) => Math.abs(event[2] - expected) <= 1), `expected an S1 hit near ${expected}, got ${hits.map((event) => event[2])}`);
  h.invariants();
});

test('native Vanilla: first talent ATK and charge-command DP/ATK skill execute from native blackboards', () => {
  const data = new DataSource({
    chess: { [vanillaId]: vanillaRecord },
    enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) },
  }, getDefaultSource());
  const def = data.getChess(vanillaId);
  assert.equal(def.skill.id, 'skchr_wyvern_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: vanillaId, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
  h.run(24);
  const unit = h.unit(vanillaId);
  assert.ok(unit.skill.activations > 0);
  assert.equal(unit.skill.active, true);
  assert.ok(Math.abs(unit.s.atk - unit.base.atk * 1.28) < 1e-5, '8% source talent and 20% source skill buff are active');
  assert.ok(h.eventsOf('fx').some((event) => event[1] === 'dp' && event[4].n === 6), 'native source cost BB grants 6 DP on skill start');
  h.invariants();
});

test('native Jessica S2: native duration, ATK% and physical/arts dodge execute in battle while the candidate stays hidden', () => {
  const s2 = record.skills.find((skill) => skill.skillId === 'skchr_jesica_2');
  const data = new DataSource({ chess: { [id]: record }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const selected = data.getChess(id, { skillIndex: s2.index });
  assert.equal(record.visible, false);
  assert.equal(selected.skill.id, s2.skillId);
  assert.equal(skillSpecSource(selected), 'skills');

  const h = makeBattle({
    data,
    units: [{ chessId: id, skillIndex: s2.index, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 8] }],
  });
  h.run(39);
  const unit = h.unit(id);
  assert.ok(unit.skill.activations > 0, 'manual-default skill automatically activates in its native trigger strategy');
  assert.equal(unit.skill.active, true);
  assert.ok(Math.abs(unit.s.dodgePhys - 0.75) < 1e-8);
  assert.ok(Math.abs(unit.s.dodgeArts - 0.75) < 1e-8);
  assert.ok(unit.s.atk > record.stats.atk, 'native atk% blackboard is active with evasion');
  h.invariants();
});

test('native Aciddrop S1 applies its duration ASPD buff and her source minimum-damage talent after DEF', () => {
  const data = new DataSource({ chess: { [acidDropId]: acidDropRecord }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, def: 100000, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(acidDropId);
  assert.equal(def.skill.id, 'skchr_acdrop_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: acidDropId, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
  h.run(38);
  const unit = h.unit(acidDropId);
  assert.ok(unit.skill.activations > 0);
  assert.ok(unit.skill.active);
  assert.ok(Math.abs(unit.s.aspd - (unit.base.aspd + acidDropRecord.skill.bb.attack_speed)) < 1e-8);
  const hit = h.eventsOf('dmg').find((event) => event[1] === h.enemy('enemy_dummy').id && event[4] === unit.id);
  assert.ok(hit && hit[2] >= unit.base.atk * acidDropRecord.talents[0].bb.atk_scale_2 - 1,
    'a target one tile forward takes at least the native forward attack-damage floor despite high DEF');
  h.invariants();
});

test('native Qingliu S1 applies the source heal scale to a healing attack', () => {
  const data = new DataSource({ chess: { [qingliuId]: qingliuRecord, chess_char_1_01_a: chessData.chess_char_1_01_a }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(qingliuId);
  assert.equal(def.skill.id, 'skchr_finlpp_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: qingliuId, row: 10, col: 5 }, { chessId: 'chess_char_1_01_a', row: 10, col: 7 }], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }] });
  const ally = h.unit('chess_char_1_01_a');
  h.run(15);
  ally.hp = ally.s.maxHp * 0.4;
  h.run(3);
  const unit = h.unit(qingliuId);
  assert.ok(unit.skill.activations > 0);
  assert.ok(h.eventsOf('heal').some((event) => event[1] === ally.id && event[2] > 0));
  assert.ok(Math.abs(h.b.resistOf(ally) - 0.5) < 1e-8, 'source talent grants the native 50% status-duration resistance');
  h.invariants();
});

test('native Wanqing talent grants in-range same-facing HP and S1 distributes its native DP total', () => {
  const data = new DataSource({ chess: { [wanqingId]: wanqingRecord, chess_char_1_01_a: chessData.chess_char_1_01_a }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(wanqingId);
  assert.equal(def.skill.id, 'skcom_assist_cost[3]');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: wanqingId, row: 10, col: 5 }, { chessId: 'chess_char_1_01_a', row: 11, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], flags: { dpPerSec: 0, dpMax: 999 } });
  const ally = h.unit('chess_char_1_01_a');
  h.run(0.6);
  assert.ok(Math.abs(ally.s.maxHp - ally.base.maxHp * 1.05) < 1, 'normal-phase source common and facing HP bonuses apply');
  const before = h.b.getPlayer('p1').dp;
  h.run(55);
  const unit = h.unit(wanqingId);
  assert.ok(unit.skill.activations > 0);
  assert.ok(h.b.getPlayer('p1').dp - before >= wanqingRecord.skill.bb.value);
  h.invariants();
});

test('native Nine-Colored Deer S1 and low-HP ally protection read source blackboards in battle', () => {
  const data = new DataSource({ chess: { [nineColoredDeerId]: nineColoredDeerRecord, chess_char_1_01_a: chessData.chess_char_1_01_a }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(nineColoredDeerId);
  assert.equal(def.skill.id, 'skchr_ncdeer_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: nineColoredDeerId, row: 10, col: 5 }, { chessId: 'chess_char_1_01_a', row: 10, col: 7 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
  const ally = h.unit('chess_char_1_01_a');
  h.run(22);
  ally.hp = ally.s.maxHp * 0.35;
  h.run(2);
  assert.ok(ally.buffs.some((buff) => buff.key === `native:ncdeer:${h.unit(nineColoredDeerId).id}`));
  h.run(20);
  assert.ok(h.unit(nineColoredDeerId).skill.activations > 0);
  h.invariants();
});

test('native Shu S1 heals from its source scale and plants the source regen/protection around the healed ally', () => {
  const data = new DataSource({ chess: { [shuId]: shuRecord, chess_char_1_01_a: chessData.chess_char_1_01_a }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(shuId);
  assert.equal(def.skill.id, 'skchr_shu_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: shuId, row: 10, col: 5 }, { chessId: 'chess_char_1_01_a', row: 10, col: 6 }], enemies: [{ key: 'enemy_dummy', pos: [10, 11] }] });
  const shuUnit = h.unit(shuId), ally = h.unit('chess_char_1_01_a');
  h.run(6);
  ally.hp = ally.s.maxHp * 0.4;
  h.run(4);
  assert.ok(shuUnit.skill.activations > 0);
  assert.ok(h.eventsOf('heal').some((event) => event[1] === ally.id && event[2] > 0), 'source heal scale restores an ally');
  assert.ok(ally.buffs.some((buff) => buff.key === 'native:shu:seed' && buff.mods.hpRegen === shuRecord.talents[0].bb.hp_recovery_per_sec), 'seeded tile grants source HP regeneration and protection');
  assert.ok(ally.hp > ally.s.maxHp * 0.4, 'seeded area applies its source HP recovery');
  h.invariants();
});

test('native Chongyue S1 executes its three-charge triple strike from native blackboards', () => {
  const data = new DataSource({ chess: { [chongyueId]: chongyueRecord }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(chongyueId);
  assert.equal(def.skill.id, 'skchr_chyue_1');
  assert.equal(def.skill.bb.atk_scale, chongyueRecord.skill.bb.atk_scale);
  assert.equal(def.skill.bb.times, chongyueRecord.skill.bb.times);
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: chongyueId, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
  h.run(45);
  const unit = h.unit(chongyueId);
  assert.ok(unit.skill.activations > 0);
  const hits = h.eventsOf('dmg').filter((event) => event[1] === h.enemy('enemy_dummy').id && event[4] === unit.id);
  assert.ok(hits.length >= 6);
  h.invariants();
});

test('native Roberta S1 applies source ATK and DEF buffs during its duration', () => {
  const data = new DataSource({ chess: { [robertaId]: robertaRecord, [meleeId]: chessData[meleeId] }, tokens: { [miboTokenId]: miboTokenRecord, token_10018_robrta_mach: tokenData.token_10018_robrta_mach }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(robertaId);
  assert.equal(def.skill.id, 'skchr_robrta_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: robertaId, row: 10, col: 5 }, { chessId: meleeId, row: 10, col: 6 }], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }] });
  const robertaUnit = h.unit(robertaId), ally = h.unit(meleeId);
  h.run(0.6);
  const machine = h.b.spawnToken(robertaUnit, 'token_10018_robrta_mach', 10, 7, { dir: 'LEFT' });
  assert.ok(machine, 'the source token can be deployed in range of the selected melee ally');
  h.run(0.3);
  const talent = machine.def.talents[0].bb;
  assert.ok(Math.abs(ally.s.def - ally.base.def * (1 + talent.def)) < 1e-8);
  assert.ok(ally.buffs.some((buff) => buff.key.startsWith(`native:robrta:shield:${machine.id}`) && buff.shieldHits === 1));
  h.run(40);
  const unit = robertaUnit;
  unit.skill.setSpTotal(unit.skill.spCost);
  assert.equal(unit.skill.activate('manual'), true, 'the native manual skill activates when ready');
  assert.ok(unit.skill.activations > 0);
  assert.ok(unit.skill.active);
  assert.ok(unit.s.atk > unit.base.atk);
  assert.ok(unit.s.def > unit.base.def);
  h.invariants();
});

test('native Robin S1 mine deals its source physical damage and binds the first ground enemy entering its tile', () => {
  const data = new DataSource({ chess: { [robinId]: robinRecord }, tokens: { token_10013_robin_mine: tokenData.token_10013_robin_mine }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(robinId);
  assert.equal(def.skill.id, 'skchr_robin_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: robinId, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
  const unit = h.unit(robinId);
  const mine = h.b.spawnToken(unit, 'token_10013_robin_mine', 10, 6);
  assert.ok(mine);
  h.run(0.2);
  const enemy = h.enemy('enemy_dummy');
  assert.ok(enemy.hp < enemy.maxHp);
  assert.ok(enemy.buffs.some((status) => status.status === 'bind' && status.timeLeft > 0));
  assert.equal(mine.alive, false, 'the triggered trap is consumed');
  h.invariants();
});

test('native Dorothy S1 resonance mine deals source damage and applies its source DEF reduction on entry', () => {
  const data = new DataSource({ chess: { [dorothyId]: dorothyRecord }, tokens: { token_10025_doroth_recttp: tokenData.token_10025_doroth_recttp }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, def: 400, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(dorothyId);
  assert.equal(def.skill.id, 'skchr_doroth_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: dorothyId, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
  const unit = h.unit(dorothyId);
  const mine = h.b.spawnToken(unit, 'token_10025_doroth_recttp', 10, 6);
  assert.ok(mine);
  h.run(0.2);
  const enemy = h.enemy('enemy_dummy');
  assert.ok(enemy.hp < enemy.maxHp);
  assert.ok(enemy.s.def < enemy.base.def);
  assert.ok(enemy.buffs.some((buff) => buff.key.startsWith(`native:skchr_doroth_1:def:${mine.id}`)));
  assert.equal(mine.alive, false);
  h.invariants();
});

test('native Firewatch Jessica S1 and mobile shield talent apply source attack and defense bonuses', () => {
  const data = new DataSource({ chess: { [fireJessicaId]: fireJessicaRecord, [meleeId]: chessData[meleeId] }, tokens: { token_10032_jesca2_jckshd: tokenData.token_10032_jesca2_jckshd }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(fireJessicaId);
  assert.equal(def.skill.id, 'skchr_jesca2_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: fireJessicaId, row: 10, col: 5 }, { chessId: meleeId, row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }] });
  const unit = h.unit(fireJessicaId), ally = h.unit(meleeId);
  h.run(0.6);
  const shield = h.b.spawnToken(unit, 'token_10032_jesca2_jckshd', 10, 6);
  assert.ok(shield);
  assert.equal(shield.def.talents[0].bb.duration, 35);
  assert.ok(Math.abs(unit.s.def - unit.base.def * 1.1) < 1e-8);
  assert.ok(Math.abs(ally.s.def - ally.base.def * 1.1) < 1e-8);
  unit.skill.setSpTotal(unit.skill.spCost);
  assert.equal(unit.skill.activate('manual'), true);
  assert.ok(unit.s.atk > unit.base.atk);
  assert.ok(unit.s.def > unit.base.def * 1.1);
  h.run(35.1);
  assert.equal(shield.alive, false, 'the shield expires at its source talent duration');
  assert.ok(Math.abs(unit.s.def - unit.base.def) < 1e-8);
  h.invariants();
});

test('native Ling S1 uses source ATK and ASPD, and her source talent responds to a spirit retreat', () => {
  const spiritId = 'token_10020_ling_soul1';
  const data = new DataSource({ chess: { [lingId]: lingRecord }, tokens: { [spiritId]: tokenData[spiritId] }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(lingId);
  assert.equal(def.skill.id, 'skchr_ling_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: lingId, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }] });
  const unit = h.unit(lingId);
  h.run(0.6);
  const spirit = h.b.spawnToken(unit, spiritId, 10, 6);
  assert.ok(spirit);
  unit.skill.setSpTotal(0);
  h.b.retreat(spirit, { reason: 'expired', permanent: true });
  assert.ok(unit.skill.spTotal > 0, 'losing a summon grants source SP');
  assert.ok(unit.s.atk > unit.base.atk, 'losing a summon grants source ATK%');
  const atk = unit.s.atk;
  unit.skill.setSpTotal(unit.skill.spCost);
  assert.equal(unit.skill.activate('manual'), true);
  assert.ok(unit.s.atk > atk, 'S1 adds its source ATK% on top of the talent stack');
  assert.ok(unit.s.aspd > unit.base.aspd, 'S1 grants source ASPD');
  h.invariants();
});

test('native Taraxacum S1 heals faster while airborne and her talent protects air blockers in range', () => {
  const data = new DataSource({ chess: { [taraxaId]: taraxaRecord, chess_char_1_01_a: chessData.chess_char_1_01_a }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(taraxaId);
  assert.equal(def.skill.id, 'skchr_taraxa_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: taraxaId, row: 10, col: 5 }, { chessId: 'chess_char_1_01_a', row: 10, col: 7 }], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }] });
  const unit = h.unit(taraxaId), ally = h.unit('chess_char_1_01_a');
  h.run(0.6);
  assert.ok(unit.rangeKeySet?.has(ally.tileR * COLS + ally.tileC), 'ally is in the source attack range');
  h.b.addBuff(ally, { key: 'test:blockFly', persist: true, flags: { blockFly: true } });
  h.run(0.6);
  assert.equal(ally.s.blockCnt, ally.base.blockCnt + taraxaRecord.talents[0].bb.block_cnt);
  assert.ok(Math.abs(ally.s.dmgTakenMul - (1 - taraxaRecord.talents[0].bb.damage_resistance)) < 1e-8);
  ally.hp = ally.s.maxHp * 0.25;
  unit.skill.setSpTotal(unit.skill.spCost);
  assert.equal(unit.skill.activate('manual'), true, 'manual source skill can be activated when ready');
  h.run(2);
  assert.ok(unit.skill.activations > 0);
  assert.ok(unit.s.flags.liftoff && unit.s.flags.blockFly, 'the active S1 grants native lift-off and air blocking');
  assert.ok(h.eventsOf('heal').some((event) => event[1] === ally.id && event[2] > 0));
  h.invariants();
});

test('native Mayer S1 grants source physical and arts evasion to her source-scaled Mibo token', () => {
  assert.ok(miboTokenRecord?.variants?.[melId]);
  assert.equal(miboTokenRecord.variants[melId].stats.deployLimit, 4);
  assert.ok(miboTokenRecord.placeable);
  assert.ok(miboTokenRecord.variants[melId].sources.includes('talent'));
  const data = new DataSource({ chess: { [melId]: melRecord }, tokens: { [miboTokenId]: miboTokenRecord }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, getDefaultSource());
  const def = data.getChess(melId);
  assert.equal(def.skill.id, 'skchr_otter_1');
  assert.equal(skillSpecSource(def), 'skills');
  const h = makeBattle({ data, units: [{ chessId: melId, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }] });
  const owner = h.unit(melId);
  h.run(0.6);
  const token = h.b.spawnToken(owner, miboTokenId, 10, 6);
  assert.ok(token);
  h.run(0.5);
  assert.equal(token.s.dodgePhys, melRecord.skill.bb.prob);
  assert.equal(token.s.dodgeArts, melRecord.skill.bb.prob);
  h.invariants();
});
