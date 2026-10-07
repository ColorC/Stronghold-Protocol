import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { skillSpecSource } from '../../server/sim/content/index.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';

const chessData = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const id = 'chess_native_char_235_jesica_a';
const record = chessData[id];
const normalized = new DataSource({ chess: { [id]: record } }, getDefaultSource()).getChess(id);

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
  const enemy = h.enemy('enemy_dummy');
  const hits = h.eventsOf('dmg').filter((event) => event[1] === enemy.id && event[4] === unit.id);
  assert.ok(hits.length >= 5);
  const expected = unit.s.atk * 1.85;
  assert.ok(hits.some((event) => Math.abs(event[2] - expected) <= 1), `expected an S1 hit near ${expected}, got ${hits.map((event) => event[2])}`);
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
