import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
// the full registry: a bystander already on its synergy card (design of 2026-10-21) gets that kit
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { registerAssaultAmmo, reloadAssaultAmmo } from '../../server/sim/content/assault/ammo.js';

// Causal checks for the support-family bazaar module lines: build a real Battle,
// fire the trigger through the engine, then assert the card-text effect.
const compiled = JSON.parse(readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
const quiet = { warn() {}, error() {}, info() {}, log() {} };

function arena(specs, { enemyAtk = 0, seed = 7 } = {}) {
  const chess = {}, units = [];
  specs.forEach((spec, i) => {
    const { charId, star = 3, module = null, row = 10, col = 3 + i } = spec, body = compiled.bodies[charId];
    const piece = { uid: `bz-module-${i}`, charId, star, moduleChoices: module ? { [charId]: module } : {} };
    const c = chessRec({ id: `bz-module-chess-${i}`, charId, profession: body.profession, subProfessionId: body.subProfessionId,
      stats: body.starStats[star - 1].stats, rangeGrid: body.range, attackKind: body.physicalProfile?.attackKind,
      projectile: body.physicalProfile?.projectile, dmgType: body.physicalProfile?.dmgType, canHitFly: body.physicalProfile?.canHitFly });
    c.assaultPiece = piece; c.assaultBody = body; chess[c.chessId] = c;
    units.push({ uid: piece.uid, chessId: c.chessId, row, col });
  });
  const foe = enemyRec({ key: 'bz-module-foe', hp: 1000000, atk: enemyAtk, def: 0, res: 0, speed: 0, applyWay: 'MELEE' });
  const data = new DataSource({ chess, enemies: { [foe.key]: foe } }, getDefaultSource());
  const battle = new Battle({ seed, kind: 'normal', modeId: 'bazaar-support-modules', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units }], content: 'assault', assault: { kits: { ...assaultKits }, strict: true },
    flags: { dpInit: 150, dpPerSec: 0, dpMax: 300, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60, quiet: true, logger: quiet });
  battle.start();
  const ops = units.map(u => battle.allyUnits.find(x => x.uid === u.uid));
  const dp = () => battle.getPlayer('p1').dp;
  const cast = who => { who.skill.setSpTotal(who.skill.spCost); const ok = battle.assaultRuntime.cast(who, { force: true }); battle.assaultRuntime.flush(); return ok; };
  const spawn = (pos = [10, 9]) => { const e = battle.spawnEnemy(foe.key, { routeIndex: 0, pos, countInTotal: false }); e.atkCd = Infinity; battle._buildEnemyIndex(); return e; };
  const kill = (victim, killer) => { battle.kill(victim, killer); battle.assaultRuntime.flush(); };
  const strike = (source, target) => { assert.equal(battle.forceAttack(source, [target]), true); battle.projectiles.update(10); battle.assaultRuntime.flush(); };
  return { battle, ops, dp, cast, spawn, kill, strike };
}
const healthy = f => assert.equal(f.battle.errors.length, 0, JSON.stringify(f.battle.errors));

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// 琴柳 / 焰尾: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-6.test.mjs

// 信仰搅拌机 / 森蚺: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-5.test.mjs

test('Hsguma 002: an enemy attack is fully blocked with {a}% chance', () => {
  for (const [roll, blocked] of [[0, true], [0.99, false]]) {
    const f = arena([{ charId: 'char_136_hsguma', module: 'uniequip_002_hsguma', col: 5 }], { enemyAtk: 2000 }), [hsguma] = f.ops, foe = f.spawn([10, 6]);
    f.battle.rng = () => roll;
    const before = hsguma.hp; f.strike(foe, hsguma);
    assert.equal(hsguma.hp === before, blocked, `roll ${roll}`);
    healthy(f);
  }
});

// 信仰搅拌机 / 森蚺: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-5.test.mjs

// 流明 / 缇缇: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-3.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// 角峰: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-4.test.mjs

// 录武官: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-2.test.mjs

// 流明 / 缇缇: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-3.test.mjs

// 琴柳 / 焰尾: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-6.test.mjs
