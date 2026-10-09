import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SP_DATA_DIR ??= 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const [{ getData }, { getResonanceCatalog, getLegacyResonanceCatalog }, { resonanceDisplayCatalog }] = await Promise.all([
  import('../../server/data.js'), import('../../server/modes/resonance/catalog.js'), import('../../server/modes/resonance/display.js'),
]);
const [{ createResonanceKits }, { installResonanceBattle }, { makeBattle, enemyRec }] = await Promise.all([
  import('../../server/sim/content/resonance/kits.js'), import('../../server/sim/content/resonance/battle.js'), import('../helpers/battleHarness.js'),
]);
const data = getData();
const v1 = getLegacyResonanceCatalog(data, { environmentId: 'origin_laterano' });
const v2 = getResonanceCatalog(data, { rulesVersion: 2 });
const ids = {
  zhuhuang: 'chess_char_5_03_a', lingering: 'chess_char_6_09_a', muelseye: 'chess_char_6_11_a',
  yu: 'chess_char_6_03_a', ulpianus: 'chess_char_5_05_a', yela: 'chess_char_6_02_a', tippy: 'chess_char_2_13_a',
};

test('v2 operator overlay retains all 154 operators and every native skill/talent record', () => {
  assert.equal(Object.keys(v2.operators).length, 154);
  assert.deepEqual(Object.keys(v2.operators).sort(), Object.keys(v1.operators).sort());
  for (const [id, operator] of Object.entries(v2.operators)) {
    const prior = v1.operators[id];
    for (const star of [1, 2, 3]) {
      assert.deepEqual(operator.stars[star].skillOverrides, prior.stars[star].skillOverrides, `${id} star ${star} skill overrides`);
      assert.deepEqual(operator.stars[star].talentOverrides, prior.stars[star].talentOverrides, `${id} star ${star} talent overrides`);
      assert.deepEqual(operator.stars[star].record.skill, prior.stars[star].record.skill, `${id} star ${star} native skill`);
      assert.deepEqual(operator.stars[star].record.talents, prior.stars[star].record.talents, `${id} star ${star} native talents`);
    }
    const passive = operator.stars[3].passive;
    assert.ok(!['star3_control', 'star3_burn', 'star3_necrosis'].includes(passive?.kind), `${id} has no unsupported generic first-trigger passive`);
    assert.ok(!['star3_control', 'star3_burn', 'star3_necrosis'].includes(passive?.additionalEffect?.kind), `${id} has no unsupported generic additional effect`);
  }
});

test('targeted v2 signatures and player-facing passive descriptions match the approved overlay', () => {
  const passive = (key) => v2.operators[ids[key]].stars[3].passive;
  assert.equal(passive('zhuhuang').kind, 'star3_zhuhuang');
  assert.equal(passive('zhuhuang').additionalEffect, null);
  assert.match(passive('zhuhuang').description, /火墙/);
  assert.doesNotMatch(passive('zhuhuang').description, /技力/);
  assert.equal(passive('lingering'), null);
  assert.equal(passive('muelseye').kind, 'star3_creation');
  assert.equal(passive('yu').kind, 'star3_combo');
  assert.equal(passive('ulpianus').kind, 'star3_breaker');
  assert.equal(passive('yela').kind, 'star3_yela');
  assert.equal(passive('yela').additionalEffect, null);
  assert.equal(passive('tippy'), null);

  const display = resonanceDisplayCatalog(v2, data);
  const removedMechanicCopy = /首次施加控制后恢复15技力|首次(?:灼燃|凋亡)爆发后恢复10技力|传播200%攻击力凋亡损伤|分担本体30%治疗|每第3次攻击沿直线|永久增加50生命和5攻击|腾空期间攻速提高30/;
  for (const operator of Object.values(display.operators)) assert.doesNotMatch(operator.stars[3].passive, removedMechanicCopy, `${operator.name} has no retired star-three player text`);
  assert.match(display.operators[ids.zhuhuang].stars[3].passive, /火墙/);
  assert.equal(display.operators[ids.lingering].stars[3].passive, '');
  assert.match(display.operators[ids.muelseye].stars[3].passive, /造物生命提高20%/);
  assert.match(v2.playerText.operators[ids.yu].stars[3].passiveDescription, /每第6次攻击恢复2技力/);
});

test('legacy v1 passive signatures remain frozen', () => {
  assert.equal(v1.operators[ids.zhuhuang].stars[3].passive.additionalEffect.kind, 'star3_burn');
  assert.equal(v1.operators[ids.lingering].stars[3].passive.kind, 'star3_lingering');
  assert.equal(v1.operators[ids.muelseye].stars[3].passive.kind, 'star3_muelseye');
  assert.equal(v1.operators[ids.yu].stars[3].passive.kind, 'star3_yu');
  assert.equal(v1.operators[ids.ulpianus].stars[3].passive.kind, 'star3_ulpius');
  assert.equal(v1.operators[ids.tippy].stars[3].passive.kind, 'star3_flight');
});

test('real v2 Battle keeps selected native skills while removed star-three triggers stay inactive', () => {
  const battleIds = [ids.zhuhuang, ids.lingering, ids.muelseye, ids.yu, ids.ulpianus, ids.yela, ids.tippy];
  const state = { rulesVersion: 2, pieces: battleIds.map((id) => ({ uid: id, star: 3, growth: {} })) };
  const units = battleIds.map((chessId, index) => ({ chessId, uid: chessId, row: 9, col: 2 + index, star: 3, skillIndex: v2.operators[chessId].fixedSkillIndex ?? 0 }));
  const h = makeBattle({ data, units, enemies: [], kits: createResonanceKits(v2, state, data), content: 'generic', autoFinish: false, recordEvents: false,
    extraContent: [battle => installResonanceBattle(battle, { catalog: v2, state })] });
  h.b.start();
  const owners = Object.fromEntries(battleIds.map((id) => [id, h.unit(id)]));
  for (const id of battleIds) {
    assert.equal(owners[id]?.skill?.id, v2.operators[id].fixedSkillId, `${id} loads its selected native skill`);
    assert.equal(owners[id]?.skill?.noSkill, false, `${id} native skill remains runnable`);
    if (!owners[id].skill.active) {
      owners[id].skill.sp = owners[id].skill.spCost;
      assert.equal(owners[id].skill.activate('current-native-skill-check', { free: true }), true, `${id} selected skill activates in Battle`);
    }
  }

  let controlSp = 0;
  owners[ids.yela].skill.gainSp = (amount) => { controlSp += amount; };
  const controlTarget = h.spawn('current-control-target', { pos: [8, 10] });
  h.b.applyStatus(controlTarget, 'stun', { duration: 1, source: owners[ids.yela] });
  assert.equal(controlSp, 0, 'Yela no longer gains SP from first control');

  let burstSp = 0;
  owners[ids.zhuhuang].skill.gainSp = (amount) => { burstSp += amount; };
  const burstTarget = h.spawn('current-burst-target', { pos: [8, 11] });
  h.b.emit('elementBurst', { source: owners[ids.zhuhuang], target: burstTarget, element: 'burn' });
  h.b.emit('elementBurst', { source: owners[ids.lingering], target: burstTarget, element: 'apoptosis' });
  assert.equal(burstSp, 0, 'removed first-element-burst SP riders stay inactive');
  assert.equal(burstTarget.elem.apoptosis ?? 0, 0, 'Lingering does not propagate apoptosis to the target');

  const owner = owners[ids.muelseye];
  const clone = h.b.allyUnits.find((unit) => unit.kind === 'token' && unit.ownerUnit === owner && unit.alive && unit.deployed)
    ?? h.b.spawnToken(owner, 'token_10030_mlyss_wtrman', owner.y + 1, owner.x, { anySource: true });
  assert.ok(clone);
  clone.hp -= 200;
  owner.hp -= 200;
  const cloneBefore = clone.hp;
  h.b.heal(owner, owner, 100);
  assert.equal(clone.hp, cloneBefore, 'Muel base healing is not shared to fluid-form tokens');

  const yu = owners[ids.yu];
  yu.hp -= 200;
  const adjacent = h.spawn('current-yu-adjacent', { pos: [9, 6] });
  const line = h.spawn('current-yu-line', { pos: [9, 7] });
  const hpBefore = yu.hp;
  const lineBefore = line.hp;
  for (let i = 0; i < 3; i++) h.b.emit('attack', { attacker: yu, targets: [adjacent], isSkill: false });
  assert.equal(line.hp, lineBefore, 'Yu has no extra three-hit line attack');
  assert.equal(yu.hp, hpBefore, 'Yu has no extra line-attack healing');

  const ulp = owners[ids.ulpianus];
  h.b.dealDamage(adjacent, ulp, { amount: 10, type: 'phys', isAttack: true, canDodge: false });
  assert.equal(ulp.mem.star3UlpiusGrowth, undefined, 'incoming hits no longer grant permanent Ulpianus growth');
  assert.deepEqual(state.pieces.find((piece) => piece.uid === ids.ulpianus).growth, {});
  assert.equal(h.b.errorCount, 0);
});
