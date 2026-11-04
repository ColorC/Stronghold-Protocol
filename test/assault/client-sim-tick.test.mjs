import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { runBattleFrame } from '../../public/js/assault/client-sim.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { flatRoutes, flatStage } from '../helpers/battleHarness.js';

test('client frame adapter uses the Native Battle step and advances one simulated second in one real second', () => {
  const battle = new Battle({ kind: 'normal', modeId: 'client-sim-tick-test', seed: 1,
    stage: flatStage(), routes: flatRoutes(), spawns: [], data: getDefaultSource(), players: [],
    content: 'none', autoFinish: false, timeLimit: 60, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} },
  });
  battle.start();
  const tick = Number(battle.dt);
  assert.ok(Number.isFinite(tick) && tick > 0);
  const session = { battle, tick, maxSeconds: 120, paused: false, accumulator: 0 };
  const startTime = battle.time;
  const frames = Array.from({ length: 5 }, () => runBattleFrame(session, 0.2, 1));
  assert.equal(frames.reduce((sum, frame) => sum + frame.ticks, 0), 30);
  assert.ok(Math.abs((battle.time - startTime) - 1) < 1e-9, `simulated duration was ${battle.time - startTime}`);
  session.paused = true;
  const savedAccumulator = session.accumulator;
  const pausedFrame = runBattleFrame(session, 1, 8);
  assert.equal(pausedFrame.time, battle.time, 'paused frame keeps the actual displayed battle clock');
  assert.equal(pausedFrame.ticks, 0);
  assert.equal(session.accumulator, savedAccumulator, 'paused wall time must not accumulate simulated catch-up');
  assert.ok(Math.abs(battle.time - startTime - 1) < 1e-9);
  battle.dispose?.();
});

test('every speed chip (1× 2× 4×) only changes the pace: the clock still counts simulated seconds and stops at the limit', () => {
  for (const speed of [1, 2, 4]) {
    const battle = new Battle({ kind: 'normal', modeId: 'client-sim-speed-test', seed: 1,
      stage: flatStage(), routes: flatRoutes(), spawns: [], data: getDefaultSource(), players: [],
      content: 'none', autoFinish: false, timeLimit: 60, quiet: true,
      logger: { warn() {}, error() {}, info() {}, log() {} },
    });
    battle.start();
    const session = { battle, tick: Number(battle.dt), maxSeconds: 12, paused: false, accumulator: 0 };
    const t0 = battle.time;
    for (let i = 0; i < 5; i += 1) runBattleFrame(session, 0.2, speed);
    assert.ok(Math.abs(battle.time - t0 - speed) < 1e-6, `one real second at ${speed}x advanced ${battle.time - t0} simulated seconds`);
    // the limit is in simulated seconds: 3 s more is 3 s of 1x, 1.5 s of 2x, 0.75 s of 4x real time, never passed by more than a tick
    const limit = battle.time + 3;
    session.maxSeconds = limit;
    for (let i = 0; i < 80 && !battle.finished; i += 1) runBattleFrame(session, 0.1, speed);
    assert.ok(battle.finished, `the battle at ${speed}x ends at its limit`);
    assert.ok(battle.time >= limit - 1e-9 && battle.time <= limit + session.tick * 2, `ended at ${battle.time}, limit ${limit}`);
    battle.dispose?.();
  }
});
