import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const screen = read('public/js/resonance/native-match-screen.js');
const briefing = read('public/js/screens/briefing.js');
const drawer = read('public/js/ui/enemyDrawer.js');
const server = read('server/modes/resonance/native-match.js');

test('the briefing and the enemy drawer name the campaign leader node, not the native single-player R14', () => {
  // the server's phase machine: leader at min(28, roundLimit)
  assert.match(server, /bossRound: Math\.min\(28, this\.state\.roundLimit\)/);
  const helper = screen.match(/export function resonanceBossRound\(roundLimit\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const resonanceBossRound = new Function('roundLimit', helper);
  assert.equal(resonanceBossRound(28), 28, '标准 / 困难: 第 28 节点');
  assert.equal(resonanceBossRound(30), 28, '深渊: the leader is still node 28, the hidden leader follows');
  assert.equal(resonanceBossRound(undefined), null, 'no state yet falls back to the shared screen');
  assert.match(screen, /<\$\{BriefingScreen\}[^`]*bossRound=\$\{bossRound\}/);
  assert.match(screen, /<\$\{EnemyDrawer\}[^`]*bossRound=\$\{resonanceBossRound\(resonanceState\?\.roundLimit\)\}/);
  // both shared screens prefer the explicit value and keep their native fallback for the other modes
  assert.match(briefing, /\$\{bossRound \?\? mode\?\.bossRound \?\? pub\.lastRound \?\? 14\}/);
  assert.match(drawer, /\$\{bossRound \?\? data\.get\('config'\)\?\.modes\?\.\[pub\.modeId\]\?\.bossRound \?\? pub\.lastRound \?\? 14\}/);
});
