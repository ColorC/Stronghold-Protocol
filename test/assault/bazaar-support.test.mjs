// Causal tests for the support family's bazaar card lines (data/assault-design/bazaar-cards-support.json).
// Each test builds a real strict assault Battle, triggers the line's event and checks the effect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// the full registry: a bystander already on its synergy card (design of 2026-10-21) gets that kit
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { supportBazaarHandledCards } from '../../server/sim/content/assault/cards/support-bazaar.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { assaultRuntimePath } from '../helpers/assaultRuntime.js';
import { damage, heal, gainDP, applyStatus } from '../../server/sim/content/assault/primitives.js';

const compiled = JSON.parse(readFileSync(assaultRuntimePath, 'utf8'));
const cards = JSON.parse(readFileSync(new URL('../../data/assault-design/bazaar-cards-support.json', import.meta.url), 'utf8'));
const linePar = (charId, line, name, star = 4) => compiled.bodies[charId].bazaar.lines[line].params[name][star - 1];
const modPar = (charId, moduleId, name, star = 4) => compiled.bodies[charId].bazaar.modules[moduleId].params[name][star - 1];

function setup(units, { dp = 99 } = {}) {
  const chess = {}, entries = [];
  for (const [i, u] of units.entries()) {
    const body = compiled.bodies[u.charId], star = u.star ?? 4, uidv = `bz-${i}-${u.charId}`;
    const piece = { uid: uidv, charId: u.charId, star, moduleChoices: u.module ? { [u.charId]: u.module } : {} };
    const rec = chessRec({ id: `bz_chess_${i}`, charId: u.charId, profession: body.profession, stats: body.starStats[star - 1].stats, rangeGrid: body.range });
    rec.assaultPiece = piece; rec.assaultBody = body; chess[rec.chessId] = rec;
    entries.push({ uid: uidv, chessId: rec.chessId, row: u.row, col: u.col });
  }
  const enemy = enemyRec({ key: 'bz_enemy', hp: 100000, speed: 0 });
  const data = new DataSource({ chess, enemies: { [enemy.key]: enemy } }, getDefaultSource());
  const battle = new Battle({ kind: 'normal', modeId: 'bazaar-support-fixture', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: entries }], content: 'assault', assault: { kits: { ...assaultKits }, strict: true },
    flags: { dpInit: dp, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 60, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  battle.assaultRuntime.flush(); // settle the initial deployment events first
  const by = {};
  for (const e of entries) by[e.uid.replace(/^bz-\d+-/, '')] ??= battle.allyUnits.find(x => x.uid === e.uid);
  const flush = () => battle.assaultRuntime.flush();
  const spawn = (r, c) => battle.spawnEnemy('bz_enemy', { routeIndex: 0, pos: [r, c] });
  const spOf = u => u.skill.spTotal ?? u.skill.sp;
  for (const u of Object.values(by)) u.skill?.setSpTotal?.(0); // observers start empty so a charge is measurable
  const advance = (seconds) => { const end = battle.time + seconds; let n = 0; while (battle.time + 1e-9 < end && n++ < 600) battle.step(); };
  return { battle, by, flush, spawn, spOf, advance };
}
const publish = (battle, type, payload) => { battle.assaultRuntime.publish(type, payload); battle.assaultRuntime.flush(); };
const findBuff = (u, key) => u.buffs.find(b => b.key === key);

test('every support bazaar handler reads its numbers from the compiled bazaar DTO', () => {
  assert.equal(cards.operators.length, 56);
  for (const charId of supportBazaarHandledCards) assert.ok(compiled.bodies[charId]?.bazaar?.lines?.length, `${charId} has compiled bazaar lines`);
});

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// 古米: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-4.test.mjs

// 白面鸮 / replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-2.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs

// 斥罪 (and the 忍冬 part, replaced next): replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-5.test.mjs

// 缇缇 (and the 角峰 part, replaced next): replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-3.test.mjs

// 蛇屠箱 / 折桠 (and the 星熊 part, replaced next): replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-4.test.mjs

// 菲莱 (and the 伊内丝 / 信仰搅拌机 parts, replaced next): replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-4.test.mjs

// 瑰盐 / 刺玫 (and the 塞雷娅 part, replaced next): replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-2.test.mjs
