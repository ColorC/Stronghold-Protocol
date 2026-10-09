// 特殊战斗装备 (user 2026-10-07 item 3): 弹射、溅射、造成伤害时治疗周围随机友军、盟约脆弱、盟约庇护 — the engine behaviors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const baseCatalog = getCatalog();
const gear = (id, behavior, params) => ({ id, sourceId: id, canonicalId: id, available: true, kind: 'equipment', mechanism: 'combatEquipment', inheritable: false,
  params: { effects: [{ trigger: 'hit', behavior, params }] } });
const GEAR = {
  'test:ricochet': gear('test:ricochet', 'ricochet', { atkPercent: 0.5, radius: 2, bounces: 2 }),
  'test:splash': gear('test:splash', 'splash', { atkPercent: 0.4, radius: 1.2 }),
  'test:heal': gear('test:heal', 'healAllyOnDamage', { damagePercent: 0.5, radius: 3, cooldownSeconds: 1 }),
  'test:vulnerable': gear('test:vulnerable', 'factionVulnerable', { damagePercent: 0.2, durationSeconds: 5 }),
  'test:guard': gear('test:guard', 'factionGuard', { damageReduction: 0.3 }),
};
// Keep source factions for equipment targeting, while removing these operators'
// unrelated workshop traits and source adapters from isolated equipment cases.
const OPS = { provence: 'chess_char_1_07_a', texas: 'chess_char_1_08_a', lateran: 'chess_char_1_01_a', loner: 'chess_char_1_09_a', loner2: 'chess_char_1_17_a' };
const isolatedOperators = { ...baseCatalog.operators };
for (const id of [OPS.provence, OPS.texas]) {
  const op = isolatedOperators[id], sourceRefs = { ...op.sourceRefs };
  delete sourceRefs.darkmoon19_2;
  isolatedOperators[id] = { ...op, sourceRefs, nativeTrait: { ...op.nativeTrait, effect: { prep: [], combat: [] } } };
}
const catalog = { ...baseCatalog, operators: isolatedOperators, equipment: { ...baseCatalog.equipment, ...GEAR } };

function setup(pieces) {
  const chess = {};
  for (const p of pieces) chess[p.chessId] = chessRec({ id: p.chessId, stats: { atk: 100, maxHp: 1000, def: 0, res: 0, aspd: 100, spRecovery: 0, respawnTime: 20 }, skill: null });
  const full = pieces.map((p) => ({ dir: 'RIGHT', skillIndex: 0, moduleId: 'none', attachments: [], nativeState: {}, equipment: [], ...p }));
  const h = makeBattle({
    units: full.map(({ uid, chessId, row, col, dir }) => ({ uid, chessId, row, col, dir })),
    defs: { chess, enemies: { enemy_test: enemyRec({ key: 'enemy_test', hp: 10000, def: 0, res: 0 }) } },
    autoFinish: false, content: 'independent',
    flags: { independent: { catalog, pieces: full } },
    extraContent: [(battle) => installIndependentBattle(battle, { catalog, state: { pieces: full } })],
  });
  h.step(1);
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors)); // a rule the engine cannot install is an error
  return h;
}
const lost = (e) => e.s.maxHp - e.hp;

test('equipment-only fixture keeps Syrian faction matching but has no embedded operator deployment source', () => {
  for (const id of [OPS.provence, OPS.texas]) {
    const op = catalog.operators[id];
    assert.ok(op.nativeFactionTags.includes('叙拉古'));
    assert.equal(op.sourceRefs.darkmoon19_2, undefined);
    assert.deepEqual(op.nativeTrait.effect.combat, []);
  }
});

test('弹射: an attack bounces from its main target to the nearest enemy, then on, within the radius each time', () => {
  const h = setup([{ uid: 'w', chessId: OPS.loner, row: 10, col: 3, equipment: [{ id: 'test:ricochet' }] }]);
  const main = h.spawn('enemy_test', { pos: [10, 4] });
  const near = h.spawn('enemy_test', { pos: [10, 5.5] });
  const next = h.spawn('enemy_test', { pos: [10, 7] });
  const far = h.spawn('enemy_test', { pos: [10, 10] });
  assert.equal(h.b.forceAttack(h.unit('w'), [main]), true);
  assert.ok(Math.abs(lost(main) - 100) < 1e-6, `main ${lost(main)}`);
  assert.ok(Math.abs(lost(near) - 50) < 1e-6, `first bounce ${lost(near)}`);
  assert.ok(Math.abs(lost(next) - 50) < 1e-6, `second bounce ${lost(next)}`);
  assert.equal(lost(far), 0);
});

test('溅射: every other enemy within the radius of the main target takes a share; its own damage starts nothing again', () => {
  const h = setup([{ uid: 'w', chessId: OPS.loner, row: 10, col: 3, equipment: [{ id: 'test:splash' }, { id: 'test:ricochet' }] }]);
  const main = h.spawn('enemy_test', { pos: [10, 4] });
  const a = h.spawn('enemy_test', { pos: [10, 5] });
  const b = h.spawn('enemy_test', { pos: [11, 4] });
  h.b.forceAttack(h.unit('w'), [main]);
  // splash 40 each; the ricochet adds 50 to the nearest one (a or b) and once more to the other; splash damage itself never bounces
  assert.ok(Math.abs(lost(a) + lost(b) - (40 + 40 + 50 + 50)) < 1e-6, `${lost(a)} + ${lost(b)}`);
  assert.ok(Math.abs(lost(main) - 100) < 1e-6);
});

test('造成伤害时治疗周围随机友军: each damage event heals a hurt ally nearby; the wearer never', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.loner, row: 10, col: 3, equipment: [{ id: 'test:heal' }] },
    { uid: 'ally', chessId: OPS.loner2, row: 10, col: 2 },
    { uid: 'far', chessId: OPS.lateran, row: 12, col: 9 },
  ]);
  const w = h.unit('w'); const ally = h.unit('ally'); const far = h.unit('far');
  w.hp = 500; ally.hp = 500; far.hp = 500;
  const e = h.spawn('enemy_test', { pos: [10, 4] });
  h.b.forceAttack(w, [e]);
  assert.equal(ally.hp, 550);
  assert.equal(w.hp, 500);
  assert.equal(far.hp, 500);
  h.b.forceAttack(w, [e]);
  assert.equal(ally.hp, 600, 'the next damage event heals again without a synthetic cooldown');
  h.run(1.1);
  h.b.forceAttack(w, [e]);
  assert.ok(ally.hp>600,'later attack events continue to heal');
});

test('盟约脆弱: an enemy the wearer hit takes more damage from its faction only, for a while', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3, equipment: [{ id: 'test:vulnerable' }] },
    { uid: 'same', chessId: OPS.texas, row: 9, col: 4 },
    { uid: 'other', chessId: OPS.lateran, row: 11, col: 4 },
  ]);
  const e = h.spawn('enemy_test', { pos: [10, 4], mods: { speedMul: 0 } });
  const hitBy = (uid) => { const before = e.hp; h.b.forceAttack(h.unit(uid), [e]); return before - e.hp; };
  assert.equal(hitBy('same'), 100, 'no mark yet');
  assert.equal(hitBy('w'), 100, 'the marking hit itself is plain');
  assert.ok(Math.abs(hitBy('same') - 120) < 1e-6);
  assert.equal(hitBy('other'), 100);
  h.b.kill(h.unit('w')); // its own attacks would keep renewing the mark
  h.run(5.5);
  assert.equal(hitBy('same'), 100, 'the mark wore off');
});

test('盟约脆弱 on an operator without a faction marks for the wearer alone', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.loner, row: 10, col: 3, equipment: [{ id: 'test:vulnerable' }] },
    { uid: 'other', chessId: OPS.loner2, row: 9, col: 4 },
  ]);
  const e = h.spawn('enemy_test', { pos: [10, 4] });
  const hitBy = (uid) => { const before = e.hp; h.b.forceAttack(h.unit(uid), [e]); return before - e.hp; };
  hitBy('w');
  assert.ok(Math.abs(hitBy('w') - 120) < 1e-6);
  assert.equal(hitBy('other'), 100);
});

test('盟约庇护: allies of the wearer\'s faction take less damage while the wearer stands', () => {
  const h = setup([
    { uid: 'w', chessId: OPS.provence, row: 10, col: 3, equipment: [{ id: 'test:guard' }] },
    { uid: 'same', chessId: OPS.texas, row: 9, col: 4 },
    { uid: 'other', chessId: OPS.lateran, row: 11, col: 4 },
  ]);
  const e = h.spawn('enemy_test', { pos: [10, 6] });
  const take = (uid) => { const u = h.unit(uid); const before = u.hp; h.b.dealDamage(e, u, { amount: 100, type: 'true' }); return before - u.hp; };
  assert.ok(Math.abs(take('same') - 70) < 1e-6);
  assert.ok(Math.abs(take('w') - 70) < 1e-6);
  assert.equal(take('other'), 100);
  h.b.kill(h.unit('w'));
  assert.equal(take('same'), 100, 'gone with the wearer');
});
