// Chapter enemies' effects reach the client as the same display events the native enemies use (statuses, fx kinds and the
// skill-animation window). The effects themselves are unchanged: these events never carry a number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle } from '../helpers/synergyCard.js';

const fighter = () => synergyBattle([{ charId: 'char_150_snakek', row: 9, col: 3 }]);
const events = (h, seconds, names, { keep = false } = {}) => {
  const seen = [];
  if (!keep) h.battle.drainEvents();
  const n = Math.round(seconds / h.battle.dt);
  for (let i = 0; i < n; i++) { h.step(1); for (const ev of h.battle.drainEvents()) if (names.includes(ev[0])) seen.push(ev); }
  return seen;
};

test('shackle caster: the lasso shows a link beam, the cast animation and the stun status on its target, then clears it', () => {
  const h = fighter(); h.units.forEach(h.hold);
  const enemy = h.spawn([9, 4], { key: 'enemy_1022_dmage', mods: { hpMul: 100, speedMul: 0 } });
  const seen = events(h, 3, ['status', 'fx']);
  const target = h.units[0];
  assert.ok(seen.some((e) => e[0] === 'fx' && e[1] === 'link' && e[4].from === enemy.id && e[4].to === target.id), 'link beam');
  assert.ok(seen.some((e) => e[0] === 'status' && e[1] === target.id && e[2] === 'stun' && e[3] === 1), 'stun on');
  const lasso = target.buffs.find((b) => b.key === `ab:chapter:lasso:${enemy.id}`);
  assert.ok(lasso && lasso.status == null, 'the chapter buff stays status-free (card lines purge by status)');
  assert.equal(target.s.flags.stun, true, 'still stunned');
  h.battle.dealDamage(target, enemy, { amount: 1e9, type: 'true', source: target }); h.flush();
  const after = events(h, 1, ['status'], { keep: true });
  assert.ok(after.some((e) => e[1] === target.id && e[2] === 'stun' && e[3] === 0), 'stun off when the caster dies');
  assert.equal(target.s.flags.stun, false);
  assert.deepEqual(h.battle.errors, []);
});

test('shackle display skips the status event while a native stun is already shown', () => {
  const h = fighter(); h.units.forEach(h.hold);
  const target = h.units[0];
  h.battle.applyStatus(target, 'stun', { duration: 30, source: null });
  const enemy = h.spawn([9, 4], { key: 'enemy_1022_dmage', mods: { hpMul: 100, speedMul: 0 } });
  const seen = events(h, 3, ['status']).filter((e) => e[2] === 'stun' && e[1] === target.id);
  assert.equal(seen.length, 0, 'no second stun-on event');
  assert.ok(enemy.alive);
});

test('caster pulse, splash attackers and the herald announce their effects', () => {
  const cases = [
    ['enemy_1085_sotiwz', (e) => e[0] === 'fx' && e[1] === 'explode' && e[4].kind === 'artsPulse', 8],
    ['enemy_1018_aoemag', (e) => e[0] === 'fx' && e[1] === 'explode' && e[4].kind === 'aoeAttack' && Array.isArray(e[4].tiles) && e[4].tiles.length === 5, 8],
    ['enemy_1024_mortar', (e) => e[0] === 'fx' && e[1] === 'explode' && e[4].kind === 'aoeAttack' && e[4].tiles === 'box', 10],
    ['enemy_1080_sotidp', (e) => e[0] === 'fx' && e[1] === 'buff' && e[4].kind === 'herald', 2],
    ['enemy_1020_obsv', (e) => e[0] === 'fx' && e[1] === 'reveal', 2],
  ];
  for (const [key, match, seconds] of cases) {
    const h = fighter(); h.units.forEach(h.hold);
    const enemy = h.spawn([9, 4], { key, mods: { hpMul: 100, speedMul: 0 } });
    if (key === 'enemy_1080_sotidp') h.spawn([9, 5], { key: 'enemy_1083_sotiab', mods: { hpMul: 100, speedMul: 0 } });
    const seen = events(h, seconds, ['fx']);
    assert.ok(seen.some(match), `${key}: expected display event, got ${JSON.stringify(seen.slice(0, 3))}`);
    if (key === 'enemy_1085_sotiwz' || key === 'enemy_1080_sotidp') assert.ok(enemy.skillAnimUntil > 0, `${key}: skill animation window`);
    assert.deepEqual(h.battle.errors, [], key);
  }
});

test('frost strikers show a strike on a frozen target only', () => {
  const h = fighter(); h.units.forEach(h.hold);
  const target = h.units[0];
  h.spawn([9, 4], { key: 'enemy_1065_snwolf', mods: { hpMul: 100 } }); // moving: it is blocked by the operator and attacks
  assert.equal(events(h, 4, ['fx']).filter((e) => e[4]?.kind === 'frostStrike').length, 0, 'not frozen: nothing');
  h.battle.applyStatus(target, 'freeze', { duration: 30, source: null });
  assert.ok(events(h, 6, ['fx']).some((e) => e[4]?.kind === 'frostStrike' && e[4].id === target.id), 'frozen: strike shown');
});
