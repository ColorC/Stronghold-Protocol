// Shared helpers of the ranged family's synergy card tests (test/assault/synergy-ranged*.test.mjs).
import assert from 'node:assert/strict';
import { synergyBattle } from '../helpers/synergyCard.js';
import { redeployNow } from '../../server/sim/content/assault/synergy.js';

export const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
export const buffOf = (unit, part) => unit.buffs.find((b) => String(b.key).includes(part));
/** The 本场叠加 buff of the card's stack `name` (fx.stack key). */
export const stackOf = (unit, name) => unit.buffs.find((b) => String(b.key).startsWith('assault:battleStack:') && String(b.key).includes(`:${name}:`));
export const extraCast = (h, unit) => { const ok = h.battle.assaultRuntime.cast(unit, { extra: true, force: true }); h.flush(); return ok; };
export const again = (h, unit) => { h.battle.assaultRedeployChain = null; const ok = redeployNow(h.battle, unit, unit); h.flush(); return ok; };
export const weakAt = (h, pos) => h.spawn(pos, { mods: { hpMul: 0.001, speedMul: 0 } });
export const killBy = (h, unit, pos) => { const e = weakAt(h, pos); h.battle.dealDamage(unit, e, { amount: 1e6, type: 'true' }); h.flush(); assert.equal(e.alive, false); return e; };
/** The HP an attack instance of `unit` removes from a fresh sturdy enemy (true damage of `amount`). */
export const attackHit = (h, unit, target, amount = 100, attackId = ++h.attackSeq) => { const hp = target.hp; h.battle.dealDamage(unit, target, { amount, type: 'true', isAttack: true, attackId }); h.flush(); return hp - target.hp; };
export const battle = (entries, opts) => { const h = synergyBattle(entries, opts); h.attackSeq = 1e6; return h; };
export const statusOf = (e, status) => e.buffs.find((b) => b.status === status);
export const dpOf = (h, unit) => h.battle.getPlayer(unit.ownerId).dp;
/** Durations of `status` on the targets of `unit`'s attacks, read as each attack goes off (after the card's own hook). */
export function onAttacks(h, unit, status, part = '') {
  const seen = [];
  h.battle.on('attack', ({ attacker, targets }) => {
    if (attacker === unit) for (const t of targets) seen.push(t.buffs.find((b) => b.status === status && String(b.key).includes(part))?.duration ?? null);
  }, { priority: -100 });
  return seen;
}
/** The run growth (本局内永久) of `unit` on `stat` recorded in this battle, summed. */
export const growthOf = (h, unit, stat, mode = 'percent') => (h.battle.assaultPermanentEffects ?? [])
  .filter((x) => x.uid === unit.uid && x.stat === stat && x.mode === mode).reduce((sum, x) => sum + x.amount, 0);
/** Make `unit` take a hit from `enemy` (an attack instance). */
export const hurt = (h, enemy, unit, amount = 10) => { h.battle.dealDamage(enemy, unit, { amount, type: 'true', isAttack: true }); h.flush(); };
/** Durations of every `status` that `unit` applies from now on (the native statusApplied hook). */
export function statusesBy(h, unit, status) {
  const seen = [];
  h.battle.on('statusApplied', (c) => { if (c.source === unit && c.status === status) seen.push(c.duration); }, { priority: -100 });
  return seen;
}
/** Every damage instance `unit` deals from now on: { target, amount, opts } (a spy on battle.dealDamage). */
export function damageBy(h, unit) {
  const seen = [];
  const deal = h.battle.dealDamage.bind(h.battle);
  h.battle.dealDamage = (source, target, opts) => { if (source === unit) seen.push({ target, amount: opts.amount, opts, time: h.battle.time }); return deal(source, target, opts); };
  return seen;
}
/** Make an enemy an elite (rank ELITE). */
export const elite = (e) => { e.def = { ...e.def, rank: 'ELITE' }; return e; };
