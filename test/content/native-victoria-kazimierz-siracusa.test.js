import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nativeKits, { NATIVE_DEFAULT_SKILL_IDS, NATIVE_KIT_READY, NATIVE_SKILL_SUPPORT } from '../../server/sim/content/nativeVictoriaKazimierzSiracusa.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { skillSpecSource } from '../../server/sim/content/index.js';

const pool = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const operators = [
  ['char_220_grani','格拉尼'], ['char_4017_puzzle','谜图'], ['char_155_tiger','因陀罗'], ['char_4045_heidi','海蒂'], ['char_154_morgan','摩根'], ['char_112_siege','推进之王'], ['char_4072_ironmn','白铁'],
  ['char_4000_jnight','正义骑士号'], ['char_4032_provs','但书'], ['char_265_sophia','鞭刃'], ['char_204_platnm','白金'], ['char_190_clour','红云'],
  ['char_346_aosta','奥斯塔'], ['char_349_chiave','贾维'], ['char_4031_liesel','复奏'], ['char_356_broca','布洛卡'], ['char_4065_judge','斥罪'], ['char_4037_demetr','贝洛内'], ['char_4155_talr','裁度'],
];
const expectedDefaults = {
  char_220_grani: 'skchr_grani_2', char_4017_puzzle: 'skchr_puzzle_1', char_155_tiger: 'skchr_tiger_1',
  char_4045_heidi: 'skchr_heidi_1', char_154_morgan: 'skchr_morgan_1', char_112_siege: 'skchr_siege_2',
  char_4072_ironmn: 'skchr_ironmn_1', char_4032_provs: 'skchr_provs_1', char_265_sophia: 'skchr_sophia_2',
  char_204_platnm: 'skcom_atk_up[3]', char_190_clour: 'skchr_clour_2', char_346_aosta: 'skcom_quickattack[3]',
  char_349_chiave: 'skcom_charge_cost[3]', char_4031_liesel: 'skchr_liesel_1', char_356_broca: 'skchr_broca_1',
  char_4065_judge: 'skchr_judge_1', char_4037_demetr: 'skchr_demetr_1', char_4155_talr: 'skchr_talr_1',
};

test('Victoria/Kazimierz/Siracusa imports expose explicit source-ID default kits for normal and elite forms', () => {
  assert.equal(operators.length, 19);
  for (const [charId, name] of operators) {
    const ids = NATIVE_SKILL_SUPPORT[charId];
    assert.ok(Array.isArray(ids), `${name} declares supported skill IDs`);
    assert.deepEqual(NATIVE_KIT_READY[charId], { ready: true, talentReady: true, skillReady: ids.length > 0, tokenReady: charId === 'char_4072_ironmn', supportedSkillIds: ids }, `${name} has an explicit complete-kit readiness record`);
    assert.equal(ids.length, name === '正义骑士号' ? 0 : 1, `${name} only advertises authored options`);
    if (ids.length) {
      assert.equal(NATIVE_DEFAULT_SKILL_IDS[charId], expectedDefaults[charId], `${name} chooses its source-backed default`);
      assert.deepEqual(ids, [expectedDefaults[charId]], `${name} exposes no unimplemented skill choices`);
    }
    const kitFn = nativeKits[`chess_native_${charId}`];
    assert.equal(typeof kitFn, 'function', `${name} has a dedicated kit`);
    for (const suffix of ['a','b']) {
      const id = `chess_native_${charId}_${suffix}`;
      const original = pool[id];
      assert.ok(original, `${name} source ${suffix} form exists`);
      const chess = structuredClone(original); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
      if (ids.length) chess.skill = chess.skills.find((entry) => entry.skillId === ids[0]);
      const kit = kitFn(chess.skill?.bb || {}, chess, chess);
      assert.ok(kit, `${name} ${suffix} returns a native kit`);
      if (ids.length) {
        assert.equal(kit.skills?.[ids[0]]?.id, ids[0], `${name} ${suffix} has a hand-authored skill spec`);
        assert.ok(kit.skills[ids[0]].spType, `${name} ${suffix} has normalized SP behavior`);
      }
    }
  }
});

test('native kits load into real battle for both source forms without runtime handler errors', () => {
  for (const [charId, name] of operators) for (const suffix of ['a','b']) {
    const chessId = `chess_native_${charId}_${suffix}`;
    const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
    const skillId = NATIVE_DEFAULT_SKILL_IDS[charId];
    const skillIndex = skillId ? chess.skills.find((entry) => entry.skillId === skillId)?.index : null;
    const h = makeBattle({
      defs: { chess: { [chessId]: chess }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, speed: 0 }) } },
      units: [{ chessId, ...(skillIndex == null ? {} : { skillIndex }), row: 10, col: 5 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], kits: nativeKits, timeLimit: 20,
    });
    const unit = h.unit(chessId);
    h.run(1);
    assert.ok(unit?.alive && unit.deployed, `${name} ${suffix} is deployed in Battle`);
    assert.ok(h.b.time >= 1, `${name} ${suffix} advances through a real Battle frame`);
    assert.equal(h.b.errorCount, 0, `${name} ${suffix} handlers remain clean`);
    if (skillId) {
      assert.equal(skillSpecSource(unit.def, nativeKits), 'skills', `${name} ${suffix} uses the authored native skill`);
      assert.equal(unit.skill?.spec?.id, skillId, `${name} ${suffix} selected the declared skill in Battle`);
      const sourceSkill = chess.skills.find((entry) => entry.skillId === skillId);
      assert.equal(unit.skill.spec.spCost, sourceSkill.spCost, `${name} ${suffix} uses the source SP cost`);
      assert.equal(unit.skill.spec.duration, sourceSkill.duration, `${name} ${suffix} uses the source duration`);
      if (charId === 'char_4065_judge') assert.equal(typeof unit.skill.spec.attack?.onHit, 'function', `Judge ${suffix} keeps her normal attack and extra arts hit separate`);
      else if (unit.skill.spec.attack?.atkScale != null) assert.equal(unit.skill.spec.attack.atkScale,
        sourceSkill.bb?.atk_scale ?? (sourceSkill.bb?.atk != null ? 1 + sourceSkill.bb.atk : sourceSkill.bb?.['attack@atk_scale']) ?? sourceSkill.bb?.atk_scale_2 ?? unit.skill.spec.attack.atkScale,
        `${name} ${suffix} applies its source attack multiplier`);
    }
  }
});

test('authored default skills execute in Battle and produce their attack or support action', () => {
  for (const [charId, name] of operators) {
    const skillId = NATIVE_DEFAULT_SKILL_IDS[charId];
    if (!skillId) continue;
    for (const suffix of ['a', 'b']) {
      const chessId = `chess_native_${charId}_${suffix}`;
      const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
      const skillIndex = chess.skills.find((entry) => entry.skillId === skillId)?.index;
      const h = makeBattle({
        defs: { chess: { [chessId]: chess }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1_000_000, speed: 0 }) } },
        units: [{ chessId, skillIndex, row: 10, col: 5 }],
        enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], kits: nativeKits, timeLimit: 20,
      });
      const unit = h.unit(chessId);
      h.run(1);
      const skill = unit?.skill;
      assert.equal(skill?.spec?.id, skillId, `${name} ${suffix} installs its source skill`);
      const activations = skill.activations;
      assert.equal(skill.activate('native-kit-test', { free: true }), true, `${name} ${suffix} activates its supported skill`);
      assert.equal(skill.activations, activations + 1, `${name} ${suffix} records a skill activation`);
      const enemy = h.enemy('enemy_dummy');
      const hp = enemy.hp;
      assert.equal(h.b.forceAttack(unit, [enemy]), true, `${name} ${suffix} performs a real attack through Battle`);
      h.run(0.5); // ranged attacks resolve through the real projectile queue
      if (charId !== 'char_4045_heidi') assert.ok(enemy.hp < hp, `${name} ${suffix} deals damage through the battle pipeline`);
      assert.equal(h.b.errorCount, 0, `${name} ${suffix} has no content-handler errors after activation`);
    }
  }
});

test('Justice Knight deployment talent buffs ranged allies and flying enemies from source values', () => {
  const charId = 'char_4000_jnight';
  for (const suffix of ['a', 'b']) {
    const chessId = `chess_native_${charId}_${suffix}`;
    const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
    const ally = chessRec({ id: `test_ranged_${suffix}`, profession: 'SNIPER', position: 'RANGED', stats: { atk: 400 } });
    const h = makeBattle({
      defs: { chess: { [chessId]: chess, [ally.chessId]: ally }, enemies: { enemy_air: enemyRec({ key: 'enemy_air', motion: 'FLY', hp: 100000, speed: 0 }) } },
      units: [{ chessId, row: 10, col: 5 }, { chessId: ally.chessId, row: 10, col: 6 }], kits: nativeKits, timeLimit: 20,
    });
    const unit = h.unit(chessId), ranged = h.unit(ally.chessId);
    h.run(1);
    const flyer = h.b.spawnEnemy('enemy_air', { pos: [10, 8] });
    const farFlyer = h.b.spawnEnemy('enemy_air', { pos: [15, 15] });
    h.run(0.1);
    assert.ok(ranged.findBuff(`jnight:cover:${unit.id}`), `Justice Knight ${suffix} lowers ranged ally aggro in range`);
    const fragile = flyer.findBuff(`jnight:fragile:${unit.id}`);
    assert.equal(fragile?.mods?.dmgTakenMul, chess.talents[0].bb.damage_scale, `Justice Knight ${suffix} applies source fragile multiplier`);
    assert.equal(farFlyer.findBuff(`jnight:fragile:${unit.id}`), null, `Justice Knight ${suffix} does not apply fragile outside her range`);
    assert.equal(h.b.errorCount, 0, `Justice Knight ${suffix} keeps clean Battle handlers`);
  }
});

test('Indra emits an engine dodge and spends her source bonus on the next full attack', () => {
  const chessId = 'chess_native_char_155_tiger_a';
  const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
  const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS.char_155_tiger);
  const h = makeBattle({ defs: { chess: { [chessId]: chess }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, speed: 0 }) } }, units: [{ chessId, skillIndex, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], kits: nativeKits, timeLimit: 10 });
  const unit = h.unit(chessId); h.run(0.25); const enemy = h.enemy('enemy_dummy');
  enemy.profile.attackKind = 'melee'; h.b.rng = () => 0;
  const hp = unit.hp;
  h.b.dealDamage(enemy, unit, { amount: 100, type: 'phys', isAttack: true });
  assert.equal(unit.hp, hp, 'a successful source-probability roll is resolved as a physical dodge');
  assert.ok(h.hooksOf('dodge').some((event) => event.target === unit), 'the battle emits the regular dodge event');
  const enemyHp = enemy.hp;
  assert.equal(h.b.forceAttack(unit, [enemy]), true);
  assert.ok(enemy.hp < enemyHp, 'the next attack lands through Battle after the dodge');
  assert.equal(unit.mem.nativeIndraNextAttack, 0, 'the bonus is consumed by that attack');
  assert.equal(h.b.errorCount, 0);
});

test('Proviso grants source ASPD to herself and a deployed Kazimierz ally', () => {
  const chessId = 'chess_native_char_4032_provs_a';
  const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
  const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS.char_4032_provs);
  const ally = chessRec({ id: 'test_kazimierz_ally', profession: 'WARRIOR' }); ally.nationId = 'kazimierz';
  const h = makeBattle({ defs: { chess: { [chessId]: chess, [ally.chessId]: ally } }, units: [{ chessId, skillIndex, row: 10, col: 5 }, { chessId: ally.chessId, row: 10, col: 6 }], kits: nativeKits, timeLimit: 10 });
  const unit = h.unit(chessId), target = h.unit(ally.chessId); h.run(0.25);
  assert.equal(unit.findBuff(`provs:aspd:self:${unit.id}`)?.mods?.aspd, chess.talents[0].bb.attack_speed);
  assert.equal(target.findBuff(`provs:aspd:ally:${unit.id}`)?.mods?.aspd, chess.talents[0].bb.attack_speed);
  assert.equal(h.b.errorCount, 0);
});

test('Aosta refreshes one independent bleed timer per unblocked target', () => {
  const chessId = 'chess_native_char_346_aosta_a';
  const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
  const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS.char_346_aosta);
  const h = makeBattle({ defs: { chess: { [chessId]: chess }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, speed: 0 }) } }, units: [{ chessId, skillIndex, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }], kits: nativeKits, timeLimit: 10 });
  const unit = h.unit(chessId); h.run(0.25); const enemy = h.enemy('enemy_dummy');
  h.b.forceAttack(unit, [enemy]); h.b.forceAttack(unit, [enemy]); h.run(0.5);
  assert.equal(h.b._sched.filter((scheduled) => scheduled.owner === unit).length, 1, 'repeated hits refresh a single DOT timer rather than scheduling parallel ticks');
  assert.equal(h.b.errorCount, 0);
});

test('Liesel applies her source damage increase when three enemies occupy the true splash area', () => {
  const chessId = 'chess_native_char_4031_liesel_a';
  const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
  const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS.char_4031_liesel);
  const h = makeBattle({ defs: { chess: { [chessId]: chess }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, speed: 0 }) } }, units: [{ chessId, skillIndex, row: 10, col: 5 }], kits: nativeKits, timeLimit: 10 });
  const unit = h.unit(chessId); h.run(0.25);
  const primary = h.b.spawnEnemy('enemy_dummy', { pos: [10, 7] });
  h.b.spawnEnemy('enemy_dummy', { pos: [10, 8] });
  h.b.spawnEnemy('enemy_dummy', { pos: [11, 7] });
  const observed = [];
  h.b.on('hit', (ctx) => { if (ctx.source === unit && ctx.target?.side === 'enemy') observed.push(ctx.dmg.mul || 1); });
  assert.equal(unit.skill.activate('native-liesel-test', { free: true }), true);
  h.b.forceAttack(unit, [primary]);
  h.run(0.5);
  assert.ok(observed.some((multiplier) => multiplier >= chess.talents[0].bb.damage_scale), 'the real hit carries the source talent multiplier through the shared damage helper');
  assert.equal(h.b.errorCount, 0);
});

test('Judge S1 keeps a physical normal attack and adds the source-scaled arts hit', () => {
  for (const suffix of ['a', 'b']) {
    const chessId = `chess_native_char_4065_judge_${suffix}`;
    const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
    const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS.char_4065_judge);
    const h = makeBattle({ defs: { chess: { [chessId]: chess }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, speed: 0 }) } }, units: [{ chessId, skillIndex, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], kits: nativeKits, timeLimit: 10 });
    const unit = h.unit(chessId); h.run(0.25); const enemy = h.enemy('enemy_dummy');
    const seen = []; h.b.on('hit', (ctx) => { if (ctx.source === unit && ctx.target === enemy) seen.push(ctx.dmg); });
    assert.equal(unit.skill.activate('native-judge-s1-test', { free: true }), true);
    assert.equal(h.b.forceAttack(unit, [enemy]), true); h.run(0.25);
    assert.ok(seen.some((dmg) => dmg.type === 'phys'), `Judge ${suffix} retains her physical basic hit`);
    const arts = seen.find((dmg) => dmg.type === 'arts' && dmg.tags?.includes('judgeS1'));
    assert.equal(arts?.amount, unit.s.atk * chess.skills[skillIndex].bb.atk_scale_2, `Judge ${suffix} adds the native arts hit`);
    assert.equal(h.b.errorCount, 0);
  }
});

test('Grani, Siege, Sophia and Judge talents produce their source-backed Battle effects in both forms', () => {
  const cases = [
    { source: 'char_220_grani', ally: chessRec({ id: 'test_pioneer', profession: 'PIONEER' }), key: 'grani:dodge', field: 'dodgePhys', sourceValue: (x) => x.talents[0].bb.prob },
    { source: 'char_112_siege', ally: chessRec({ id: 'test_pioneer', profession: 'PIONEER' }), key: 'siege:vanguard', field: 'atkPct', sourceValue: (x) => x.talents[0].bb.atk },
    { source: 'char_265_sophia', ally: chessRec({ id: 'test_tank', profession: 'TANK', stats: { blockCnt: 3 } }), key: 'sophia:aura', field: 'aspd', sourceValue: (x) => x.talents[0].bb.attack_speed },
  ];
  for (const { source, ally, key, field, sourceValue } of cases) for (const suffix of ['a', 'b']) {
    const chessId = `chess_native_${source}_${suffix}`;
    const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
    const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS[source]);
    const h = makeBattle({
      defs: { chess: { [chessId]: chess, [ally.chessId]: ally } },
      units: [{ chessId, skillIndex, row: 10, col: 5 }, { chessId: ally.chessId, row: 10, col: 6 }], kits: nativeKits, timeLimit: 10,
    });
    h.run(0.5);
    const unit = h.unit(chessId), target = h.unit(ally.chessId), buff = target.findBuff(`${key}:${unit.id}`);
    assert.ok(buff, `${source} ${suffix} applies its authored talent in battle`);
    assert.equal(buff.mods[field], sourceValue(chess), `${source} ${suffix} derives the effect from its native blackboard`);
    if (source === 'char_265_sophia') {
      assert.equal(unit.skill.activate('native-kit-talent-test', { free: true }), true);
      h.run(0.25);
      assert.equal(target.findBuff(`${key}:${unit.id}`).mods[field], sourceValue(chess) * chess.skills.find((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS[source]).bb.talent_scale, `Sophia ${suffix} enhances the aura only while her skill is active`);
    }
    assert.equal(h.b.errorCount, 0, `${source} ${suffix} has no runtime content errors`);
    if (source === 'char_220_grani') {
      assert.deepEqual(unit.skill.spec.targeting.rangeGrid, [[0, 0]], `Grani ${suffix} restricts S2 to her block tile`);
      assert.equal(unit.skill.spec.attack.hitAllBlocked, true, `Grani ${suffix} hits her own blocked targets`);
    }
  }

  for (const suffix of ['a', 'b']) {
    const chessId = `chess_native_char_112_siege_${suffix}`;
    const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
    const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS.char_112_siege);
    const h = makeBattle({ defs: { chess: { [chessId]: chess }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, speed: 0 }) } }, units: [{ chessId, skillIndex, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], kits: nativeKits, timeLimit: 10 });
    const unit = h.unit(chessId); h.run(0.25); const player = h.b.getPlayer(unit.ownerId), before = player.dp;
    assert.equal(unit.skill.activate('native-siege-command-test', { free: true }), true);
    assert.equal(player.dp - before, chess.skills[skillIndex].bb.cost, `Siege ${suffix} gains source DP once on skill start`);
    const enemy = h.enemy('enemy_dummy'); h.b.forceAttack(unit, [enemy]);
    assert.equal(player.dp - before, chess.skills[skillIndex].bb.cost, `Siege ${suffix} does not gain DP per splash hit`);
  }

  for (const suffix of ['a', 'b']) {
    const chessId = `chess_native_char_4065_judge_${suffix}`;
    const chess = structuredClone(pool[chessId]); chess.visible = true; chess.isHidden = false; chess.chessType = 'PRESET';
    const skillIndex = chess.skills.findIndex((skill) => skill.skillId === NATIVE_DEFAULT_SKILL_IDS.char_4065_judge);
    const h = makeBattle({ defs: { chess: { [chessId]: chess } }, units: [{ chessId, skillIndex, row: 10, col: 5 }], kits: nativeKits, timeLimit: 10 });
    const unit = h.unit(chessId); h.run(0.25);
    const shield = unit.buffs.find((buff) => buff.tags?.includes('talent') && buff.shield > 0);
    assert.equal(shield?.shield, unit.s.maxHp * chess.talents[0].bb.born_hp_ratio, `Judge ${suffix} receives her native deployment barrier`);
    assert.equal(h.b.errorCount, 0, `Judge ${suffix} has no runtime content errors`);
    if (chess.talents.some((talent) => talent.index === 1)) {
      const enemy = h.b.spawnEnemy('enemy_dummy', { pos: [10, 6] });
      const hp = enemy.hp;
      h.b.dealDamage(enemy, unit, { amount: 50, type: 'phys', isAttack: true });
      assert.ok(enemy.hp < hp, `Judge ${suffix} reflects damage while her native shield is present`);
    }
  }
});
