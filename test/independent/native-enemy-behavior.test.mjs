import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
const ENEMIES = JSON.parse(readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const RECEIPTS = [];
const noAttacks = (h, e) => h.hooksOf('attack').filter((event) => event.attacker === e);
const blocker = () => chessRec({ id: 'qa_native_enemy_blocker', name: 'QA blocker', profession: 'TANK', skill: null, stats: { maxHp: 50000, atk: 0, def: 1000, res: 90, blockCnt: 1, bat: 1, aspd: 100, hpRecoveryPerSec: 0 }, rangeGrid: [[0, 0]] });
function battleFor(key) { return makeBattle({ content: 'independent', seed: 8, autoFinish: false, captureNoisy: true, defs: { chess: { qa_native_enemy_blocker: blocker() } }, units: [{ chessId: 'qa_native_enemy_blocker', row: 10, col: 5 }], enemies: [{ key, pos: [10, 7], time: 0 }] }); }
function waitEnemy(h, key) { assert.ok(h.runUntil((b) => b.enemies.some((e) => e.defId === key), 1), key + ' spawns in independent battle'); return h.b.enemies.find((e) => e.defId === key); }
function waitChannel(h, e) { return h.runUntil(() => e.mem.jazzChannel && !e.mem.jazzChannel.cancelled, 8); }
for (const key of ['enemy_1234_dsubrl', 'enemy_1234_dsubrl_2']) test(key + ' uses moving nest pulses instead of stationary ranged attacks', () => {
  const source = ENEMIES[key]; assert.ok(source, 'actual source enemy exists'); assert.equal(source.applyWay, 'RANGED'); assert.ok(source.stats.rangeRadius > 0); assert.ok(source.stats.atk > 0);
  const h = battleFor(key); const e = waitEnemy(h, key); const ally = h.allies()[0]; const x0 = e.x;
  assert.equal(e.profile.noAttack, true); h.run(2.5); assert.ok(e.x < x0 - 0.2, 'real enemy advances instead of stopping to shoot');
  assert.ok(h.events.some((v) => v[0] === 'fx' && v[1] === 'pulse' && v[4]?.id === e.id), 'real nest pulse event');
  assert.ok(h.events.some((v) => v[0] === 'dmg' && v[1] === ally.id && v[3] === 'arts' && v[4] === e.id), 'pulse deals arts damage to the deployed ally');
  assert.deepEqual(noAttacks(h, e), [], 'RANGED source never falls back to generic attacks'); RECEIPTS.push({ enemy: key, sourceName: source.name, moving: true, pulseObserved: true, genericAttacks: 0 });
});
test('节日爵士乐手 approaches while hidden, then channels after a real block; silence and target departure cancel without stacking', () => {
  const source = ENEMIES.enemy_10034_cnvsax; assert.equal(source?.name, '节日爵士乐手'); assert.equal(source.applyWay, 'ALL');
  const h = battleFor('enemy_10034_cnvsax'); const e = waitEnemy(h, 'enemy_10034_cnvsax'); const ally = h.allies()[0]; const x0 = e.x; h.run(1.5);
  assert.ok(e.buffs.some((v) => v.key === 'ab:stealth')); assert.ok(e.x < x0 - 0.2); assert.equal(e.blockedBy, null); assert.equal(e.mem.jazzChannel, undefined); assert.deepEqual(noAttacks(h, e), [], 'hidden unblocked enemy does not use generic ranged attacks');
  assert.ok(h.runUntil(() => e.blockedBy === ally, 8), 'real path collision blocks enemy'); assert.ok(waitChannel(h, e), 'skill starts after blocking'); assert.equal(e.blockedBy, ally); assert.equal(noAttacks(h, e).length, 0);
  const channel = e.mem.jazzChannel; h.run(2); assert.equal(e.mem.jazzChannel, channel, 'one active handle; no stacked recast'); assert.equal(e.buffs.filter((v) => v.key === 'ab:channel').length, 1); assert.ok(h.events.some((v) => v[0] === 'fx' && v[1] === 'beam' && v[4]?.from === e.id));
  RECEIPTS.push({ enemy: source.key, movingWhileHidden: true, blockedBeforeChannel: true, channelsStacked: false });
  const silence = battleFor('enemy_10034_cnvsax'); const se = waitEnemy(silence, 'enemy_10034_cnvsax'); assert.ok(silence.runUntil(() => se.blockedBy && se.mem.jazzChannel, 10)); silence.b.addBuff(se, { key: 'qa:silence', duration: 4, flags: { silence: true } }); silence.run(0.6); assert.equal(se.mem.jazzChannel, null); assert.equal(se.buffs.some((v) => v.key === 'ab:channel'), false);
  const departure = battleFor('enemy_10034_cnvsax'); const de = waitEnemy(departure, 'enemy_10034_cnvsax'); assert.ok(departure.runUntil(() => de.blockedBy && de.mem.jazzChannel, 10)); departure.b.retreat(departure.allies()[0], { reason: 'qa-target-left' }); departure.run(0.6); assert.equal(de.mem.jazzChannel, null); assert.equal(de.buffs.some((v) => v.key === 'ab:channel'), false); RECEIPTS.push({ enemy: source.key, silenceCancels: true, targetDepartureCancels: true });
});
after(() => { const target = process.env.SP_NATIVE_ENEMY_QA_RESULT_PATH; if (!target) return; const fullPath = path.resolve(target); mkdirSync(path.dirname(fullPath), { recursive: true }); writeFileSync(fullPath, JSON.stringify({ sourceCommit: 'b29a0883d72851dc7020ed9ca2377c78279a36e6', cases: RECEIPTS }, null, 2), 'utf8'); });
