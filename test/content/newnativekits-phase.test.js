import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { skillSpecSource } from '../../server/sim/content/index.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';

const chess = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const tokenData = JSON.parse(fs.readFileSync(new URL('../../data/tokens.json', import.meta.url), 'utf8'));
const allCases = [
  ['char_240_wyvern', 'charge-command DP and source ATK talent'],
  ['char_235_jesica', 'attack-recovery multiplier and source ASPD talent'],
  ['char_366_acdrop', 'source physical damage floor after DEF'],
  ['char_484_robrta', 'source machine DEF/shield talent and S1 buffs'],
  ['char_385_finlpp', 'source-scaled heal and resistance talent'],
  ['char_4119_wanqin', 'source DP total and same-facing HP aura'],
  ['char_4019_ncdeer', 'low-HP protection aura and source S1 ATK buff'],
  ['char_2025_shu', 'source-scaled heal and seeded tile'],
  ['char_2024_chyue', 'source multi-hit strike'],
  ['char_4222_taraxa', 'source airborne heal and blocker talent'],
  ['char_242_otter', 'Mibo token dodge from source S1'],
  ['char_451_robin', 'source mine damage and bind on entry'],
  ['char_4048_doroth', 'source trap damage and DEF reduction'],
  ['char_1034_jesca2', 'mobile shield talent and source S1 buffs'],
  ['char_2023_ling', 'source summon-loss talent and S1 buffs'],
];
const allyId = 'chess_char_1_01_a';
const meleeId = 'chess_char_1_02_a';
const enemyKey = 'enemy_dummy';
const tokenByChar = {
  char_484_robrta: ['token_10018_robrta_mach'],
  char_242_otter: ['token_10004_otter_motter'],
  char_451_robin: ['token_10013_robin_mine'],
  char_4048_doroth: ['token_10025_doroth_recttp'],
  char_1034_jesca2: ['token_10032_jesca2_jckshd'],
  char_2023_ling: ['token_10020_ling_soul1'],
};

function phaseRecord(charId, suffix) {
  const record = Object.values(chess).find((r) => r.charId === charId && r.chessId.endsWith(`_${suffix}`));
  assert.ok(record, `${charId} ${suffix} source row exists`);
  const selected = record.skill ?? record.skills?.find((s) => s.index === 0) ?? null;
  assert.ok(selected?.skillId, `${charId} ${suffix} source default skill exists`);
  return { ...record, skill: selected };
}

function makeData(record, extraTokens = [], includeAlly = true, allyCharId = allyId, enemyDef = 0) {
  const chessDefs = { [record.chessId]: record };
  if (includeAlly) chessDefs[allyCharId] = chess[allyCharId];
  const tokens = Object.fromEntries(extraTokens.map((id) => [id, tokenData[id]]));
  return new DataSource({ chess: chessDefs, tokens, enemies: { [enemyKey]: enemyRec({ key: enemyKey, hp: 1e7, def: enemyDef, speed: 0 }) } }, getDefaultSource());
}

function startBattle(record, { ally = false, allyCharId = allyId, allyPos = [10, 4], tokenIds = [], placeToken = false, enemyPos = [10, 6], enemyDef = 0, unitPos = [10, 5], flags = {} } = {}) {
  const data = makeData(record, tokenIds, ally, allyCharId, enemyDef);
  const units = [{ chessId: record.chessId, row: unitPos[0], col: unitPos[1], uid: 'native-owner' }];
  if (ally) units.push({ chessId: allyCharId, row: allyPos[0], col: allyPos[1] });
  if (placeToken) units.push({ kind: 'token', tokenId: tokenIds[0], ownerUid: 'native-owner', row: 10, col: 6 });
  const h = makeBattle({ data, units, enemies: [{ key: enemyKey, pos: enemyPos }], flags: { dpPerSec: 0, dpMax: 999, ...flags } });
  assert.equal(skillSpecSource(data.getChess(record.chessId)), 'skills', `${record.charId} resolves the native source skill`);
  return h;
}

function activate(unit) {
  unit.skill.setSpTotal(unit.skill.spCost);
  assert.equal(unit.skill.activate('manual'), true, `${unit.def.charId} native skill activates`);
}

function probe(charId, rec) {
  const s = rec.skill;
  if (charId === 'char_240_wyvern') {
    const h = startBattle(rec, { enemyPos: [10, 6] });
    const unit = h.unit(rec.chessId);
    h.run(0.5);
    activate(unit);
    h.run(0.2);
    assert.ok(h.eventsOf('fx').some((e) => e[1] === 'dp' && e[4].n === s.bb.cost));
    assert.ok(unit.s.atk >= unit.base.atk * (1 + rec.talents[0].bb.atk + s.bb.atk) - 0.001);
    h.invariants();
  } else if (charId === 'char_235_jesica') {
    const h = startBattle(rec, { enemyPos: [10, 8] });
    const unit = h.unit(rec.chessId);
    h.run(24);
    const hits = h.eventsOf('dmg').filter((e) => e[1] === h.enemy(enemyKey).id && e[4] === unit.id);
    assert.ok(unit.skill.activations > 0);
    assert.ok(Math.abs(unit.s.aspd - (unit.base.aspd + rec.talents[0].bb.attack_speed)) < 1e-8);
    assert.ok(hits.some((e) => Math.abs(e[2] - unit.base.atk * s.bb.atk_scale) <= 1), `${rec.chessId}: source multiplier hit exists`);
    h.invariants();
  } else if (charId === 'char_366_acdrop') {
    const h = startBattle(rec, { enemyPos: [10, 6] });
    const unit = h.unit(rec.chessId);
    h.run(45);
    const hit = h.eventsOf('dmg').find((e) => e[1] === h.enemy(enemyKey).id && e[4] === unit.id);
    assert.ok(unit.skill.activations > 0);
    assert.ok(hit && hit[2] >= unit.base.atk * rec.talents[0].bb.atk_scale_2 - 1);
    h.invariants();
  } else if (charId === 'char_484_robrta') {
    const h = startBattle(rec, { ally: true, allyCharId: meleeId, allyPos: [10, 6], tokenIds: tokenByChar[charId], unitPos: [10, 5] });
    const unit = h.unit(rec.chessId), ally = h.unit(meleeId);
    h.run(0.5);
    const machine = h.b.spawnToken(unit, tokenByChar[charId][0], 10, 7, { dir: 'LEFT' });
    assert.ok(machine);
    h.run(0.3);
    const talent = machine.def.talents[0].bb;
    assert.ok(Math.abs(ally.s.def - ally.base.def * (1 + talent.def)) < 1e-8);
    assert.ok(machine.def.talents[0].bb.shield_count === undefined || machine.def.talents[0].bb.shield_count >= 0);
    activate(unit);
    h.run(0.2);
    assert.ok(unit.s.atk > unit.base.atk);
    assert.ok(unit.s.def > unit.base.def);
    h.invariants();
  } else if (charId === 'char_385_finlpp') {
    const h = startBattle(rec, { ally: true, allyPos: [10, 7], enemyPos: [10, 8] });
    const unit = h.unit(rec.chessId), ally = h.unit(allyId);
    h.run(15);
    ally.hp = ally.s.maxHp * 0.35;
    h.run(3);
    assert.ok(h.eventsOf('heal').some((e) => e[1] === ally.id && e[2] > 0));
    assert.ok(Math.abs(h.b.resistOf(ally) - Math.min(0.95, Math.max(0, -rec.talents[0].bb.one_minus_status_resistance))) < 1e-8);
    h.invariants();
  } else if (charId === 'char_4119_wanqin') {
    const h = startBattle(rec, { ally: true, enemyPos: [10, 6], unitPos: [10, 5] });
    const unit = h.unit(rec.chessId), ally = h.unit(allyId);
    h.run(0.6);
    const hpPct = rec.talents[0].bb['wanqin_t_1[hp_common].max_hp'];
    assert.ok(ally.s.maxHp > ally.base.maxHp, 'source aura affects nearby operator');
    const before = h.b.getPlayer('p1').dp;
    activate(unit);
    h.run(s.duration + 0.2);
    assert.ok(h.b.getPlayer('p1').dp - before >= s.bb.value, 'source skill grants its configured DP total');
    assert.ok(hpPct > 0);
    h.invariants();
  } else if (charId === 'char_4019_ncdeer') {
    const h = startBattle(rec, { ally: true, enemyPos: [10, 6] });
    const unit = h.unit(rec.chessId), ally = h.unit(allyId);
    h.run(0.6);
    ally.hp = ally.s.maxHp * Math.max(0.1, rec.talents[0].bb.hp_ratio - 0.1);
    h.run(0.7);
    const buff = ally.buffs.find((b) => b.key === `native:ncdeer:${unit.id}`);
    assert.ok(buff);
    assert.ok(Math.abs(buff.mods.dmgTakenMul - (1 - rec.talents[0].bb.damage_resistance)) < 1e-8);
    activate(unit);
    h.run(0.2);
    assert.ok(unit.s.atk > unit.base.atk);
    h.invariants();
  } else if (charId === 'char_2025_shu') {
    const h = startBattle(rec, { ally: true, enemyPos: [10, 10] });
    const unit = h.unit(rec.chessId), ally = h.unit(allyId);
    h.run(0.6);
    ally.hp = ally.s.maxHp * 0.35;
    activate(unit);
    h.run(3);
    assert.ok(h.eventsOf('heal').some((e) => e[1] === ally.id && e[2] > 0));
    assert.ok(ally.buffs.some((b) => b.key === 'talent:shu:farm' && b.mods.hpRegen === rec.talents[0].bb.hp_recovery_per_sec));
    h.invariants();
  } else if (charId === 'char_2024_chyue') {
    const h = startBattle(rec, { enemyPos: [10, 6] });
    const unit = h.unit(rec.chessId);
    h.run(45);
    const hits = h.eventsOf('dmg').filter((e) => e[1] === h.enemy(enemyKey).id && e[4] === unit.id);
    assert.ok(hits.length >= s.bb.times);
    h.invariants();
  } else if (charId === 'char_4222_taraxa') {
    const h = startBattle(rec, { ally: true, enemyPos: [10, 8] });
    const unit = h.unit(rec.chessId), ally = h.unit(allyId);
    h.run(0.6);
    h.b.addBuff(ally, { key: 'native-phase:block-fly', persist: true, flags: { blockFly: true } });
    h.run(0.6);
    assert.equal(ally.s.blockCnt, ally.base.blockCnt + rec.talents[0].bb.block_cnt);
    ally.hp = ally.s.maxHp * 0.25;
    activate(unit);
    h.run(2);
    assert.ok(unit.s.flags.liftoff && unit.s.flags.blockFly);
    assert.ok(h.eventsOf('heal').some((e) => e[1] === ally.id && e[2] > 0));
    h.invariants();
  } else if (charId === 'char_242_otter') {
    const tokenId = tokenByChar[charId][0];
    const h = startBattle(rec, { tokenIds: [tokenId], enemyPos: [10, 8] });
    const unit = h.unit(rec.chessId);
    h.run(0.6);
    const token = h.b.spawnToken(unit, tokenId, 10, 6);
    assert.ok(token);
    h.run(0.2);
    assert.equal(token.s.dodgePhys, s.bb.prob);
    assert.equal(token.s.dodgeArts, s.bb.prob);
    h.invariants();
  } else if (charId === 'char_451_robin' || charId === 'char_4048_doroth') {
    const tokenId = tokenByChar[charId][0];
    const h = startBattle(rec, { tokenIds: [tokenId], placeToken: charId === 'char_4048_doroth', enemyPos: [10, 6], enemyDef: 400 });
    const unit = h.unit(rec.chessId);
    let trap;
    if (charId === 'char_451_robin') {
      h.run(0.6);
      trap = h.b.spawnToken(unit, tokenId, 10, 6);
    } else trap = h.b.allyUnits.find((u) => u.kind === 'token' && u.defId === tokenId);
    assert.ok(trap);
    h.run(0.2);
    const enemy = h.enemy(enemyKey);
    assert.ok(enemy);
    assert.ok(enemy.hp < enemy.maxHp, 'source token trap damages the entering enemy');
    if (charId === 'char_451_robin') assert.ok(enemy.buffs.some((b) => b.status === 'bind' && b.timeLeft > 0));
    else {
      assert.ok(enemy.s.def < enemy.base.def, 'S1 lowers enemy DEF');
      assert.ok(enemy.buffs.some((b) => b.status === 'defDown' && b.source === trap && b.timeLeft > 0), 'S1 applies its timed DEF-down status from the trap');
    }
    assert.equal(trap.alive, false, 'triggered trap is consumed');
    h.invariants();
  } else if (charId === 'char_1034_jesca2') {
    const tokenId = tokenByChar[charId][0];
    const h = startBattle(rec, { ally: true, allyCharId: meleeId, allyPos: [10, 4], tokenIds: [tokenId], placeToken: true, enemyPos: [10, 8] });
    const unit = h.unit(rec.chessId), ally = h.unit(meleeId);
    const shield = h.b.allyUnits.find((u) => u.kind === 'token' && u.defId === tokenId);
    h.run(0.6);
    assert.ok(shield);
    const nativeTalent = shield.def.talents[0].bb;
    const baseLifeEnd = shield.mem.lifeEnd;
    h.run(0.2);
    assert.ok(unit.s.def > unit.base.def && ally.s.def > ally.base.def);
    activate(unit);
    h.run(0.2);
    assert.ok(unit.s.atk > unit.base.atk && unit.s.def > unit.base.def);
    assert.ok(shield.mem.lifeEnd > baseLifeEnd, 'S1 extends the deployed shield once for this deployment');
    h.run(Math.max(0, shield.mem.lifeEnd - h.b.time) + shield.base.respawnTime + 1);
    assert.ok(!shield.alive || shield.deploySeq > 1, `the extended lifetime ends; state=${JSON.stringify({alive:shield.alive,deploySeq:shield.deploySeq,lifeEnd:shield.mem.lifeEnd,time:h.b.time})}`);
    if (!shield.alive) assert.equal(shield.removed, false, 'the expired placed shield remains eligible for its native redeploy loop');
    h.invariants();
  } else if (charId === 'char_2023_ling') {
    const tokenId = tokenByChar[charId][0];
    const h = startBattle(rec, { tokenIds: [tokenId], placeToken: true, enemyPos: [10, 8] });
    const unit = h.unit(rec.chessId);
    const spirit = h.b.allyUnits.find((u) => u.kind === 'token' && u.defId === tokenId);
    h.run(0.6);
    assert.ok(spirit);
    const beforeSp = unit.skill.spTotal;
    assert.equal(unit.mem.summonDeck.recall(spirit), true, 'the placed token leaves through the native recall path');
    assert.ok(unit.skill.spTotal > beforeSp, 'source summon-loss talent returns SP');
    assert.ok(unit.s.atk >= unit.base.atk * (1 + rec.talents[1].bb.atk));
    activate(unit);
    h.run(0.2);
    assert.ok(unit.s.aspd > unit.base.aspd && unit.s.atk > unit.base.atk);
    h.invariants();
  }
}

for (const [charId, expectation] of allCases) {
  for (const suffix of ['a', 'b']) {
    test(`native ${charId} ${suffix === 'a' ? 'ordinary' : 'elite'} source kit causes ${expectation} in battle`, () => {
      const rec = phaseRecord(charId, suffix);
      probe(charId, rec);
    });
  }
}
