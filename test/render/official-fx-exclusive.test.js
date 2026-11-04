// test/render/official-fx-exclusive.test.js — the official effects layer (render/vfx) and the fork's own effects are
// exclusive per event: app.js asks the official layer first (`wiring.*`), and the answer reaches the fork's cues as
// `cue.official` — the procedural recipe (render/fxRecipes.js) and the fork's own sim-fx drawings are skipped, while
// the damage / heal numbers stay (the equivalent of the upstream NO_SPARK).
//   * FxCues: the 6 event methods mark the cue only when asked; `dmg` hands the melee-paired attacker to `officialFor`
//   * FxEvents.play: an official cue draws nothing procedural, the numbers still show
//   * app.js: every event asks the official layer, the flag reaches the cues, and the upstream-only identifiers stay out

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FxCues } from '../../public/js/render/fxRegistry.js';
import { FxEvents } from '../../public/js/render/fx/events.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const app = readFileSync(join(ROOT, 'public/js/render/app.js'), 'utf8');
const count = (needle) => app.split(needle).length - 1;

const view = (id) => ({ id, alive: true });

/** A FxCues over a system that only records what it is played. */
function makeCues() {
  const played = [];
  const cues = new FxCues({ fx: { play: (channel, cue) => played.push([channel, cue]) }, view: () => null });
  return { cues, played };
}

describe('FxCues carries the official flag', () => {
  test('atk / heal / skill / die / deploy / fx: passed official=true marks the cue, not passing it leaves it plain', () => {
    const { cues, played } = makeCues();
    const me = view(1), foe = view(20);
    cues.atk(['atk', 1, 20, 'arrow'], me, foe, 0, true);
    cues.atk(['atk', 1, 20, 'arrow'], me, foe, 0);
    cues.heal(['heal', 1, 40], me, true);
    cues.heal(['heal', 1, 40], me);
    cues.skill(['skill', 1, 1, 'sk_1'], me, true);
    cues.skill(['skill', 1, 1, 'sk_1'], me);
    cues.die(me, true);
    cues.die(me);
    cues.deploy(me, true);
    cues.deploy(me);
    cues.fx(['fx', 'burst', 3, 10, { id: 1 }], true);
    cues.fx(['fx', 'burst', 3, 10, { id: 1 }]);
    assert.deepEqual(played.map(([channel]) => channel), ['atk', 'atk', 'heal', 'heal', 'skill', 'skill', 'die', 'die', 'deploy', 'deploy', 'fx', 'fx']);
    for (const [i, [, cue]] of played.entries()) {
      if (i % 2 === 0) assert.equal(cue.official, true, `${played[i][0]} ${i}: the official flag`);
      else assert.ok(!('official' in cue), `${played[i][0]} ${i}: no flag when not asked`);
    }
  });

  test('dmg hands officialFor the melee-paired attacker and marks the cue; the pairing bookkeeping is unchanged', () => {
    const { cues, played } = makeCues();
    const me = view(1), foe = view(20);
    const seen = [];
    cues.atk(['atk', 1, 20, 'none'], me, foe, 10);
    cues.dmg(['dmg', 20, 300, 'phys'], foe, 10.1, (src) => { seen.push(src ? src.id : null); return true; });
    assert.deepEqual(seen, [1], 'the paired attacker');
    assert.equal(played.at(-1)[0], 'dmg');
    assert.equal(played.at(-1)[1].official, true, 'drawn officially: the recipe is skipped, the number stays');
    // a hit with no blow of its own: officialFor still runs, with null; its answer decides the flag
    cues.dmg(['dmg', 20, 300, 'phys'], foe, 20, (src) => { seen.push(src ? src.id : null); return false; });
    assert.deepEqual(seen, [1, null]);
    assert.ok(!('official' in played.at(-1)[1]));
    // no callback (the fork's older call sites) and no view: nothing breaks, nothing is marked
    cues.dmg(['dmg', 20, 300, 'phys'], foe, 21);
    assert.ok(!('official' in played.at(-1)[1]));
    const before = played.length;
    cues.dmg(['dmg', 999, 300, 'phys'], null, 21, () => true);
    assert.equal(played.length, before, 'no view: no cue');
  });
});

describe('FxEvents.play skips the procedural drawing of an official cue', () => {
  function makeEvents(settings = { damageNumbers: true }) {
    const calls = [];
    const ev = Object.create(FxEvents.prototype);
    ev.ctx = { registry: { play: (fx, channel, cue) => calls.push(['registry', channel, cue?.kind]) }, settings };
    ev.number = (v) => calls.push(['number', v?.id ?? null]);
    ev.officialNumber = (v) => calls.push(['officialNumber', v?.id ?? null]);
    ev._drawSimFx = (kind) => calls.push(['simFx', kind]);
    return { ev, calls };
  }

  test('an official dmg cue: the recipe is not run, the damage number is drawn once', () => {
    const { ev, calls } = makeEvents();
    ev.play('dmg', { kind: 'phys', view: view(20), amount: 300, official: true });
    assert.deepEqual(calls.map((c) => c[0]), ['number']);
    // the fork's own cue (no flag): the recipe and the number
    calls.length = 0;
    ev.play('dmg', { kind: 'phys', view: view(20), amount: 300 });
    assert.deepEqual(calls.map((c) => c[0]), ['registry', 'number']);
  });

  test('an official fx cue draws neither the fork sim fx nor the registry recipe', () => {
    const { ev, calls } = makeEvents();
    ev.play('fx', { kind: 'chen3Wave', x: 1, y: 2, extra: { id: 1 }, official: true });
    assert.deepEqual(calls, []);
    calls.length = 0;
    ev.play('fx', { kind: 'chen3Wave', x: 1, y: 2, extra: { id: 1 } });
    assert.deepEqual(calls.map((c) => c[0]), ['simFx']);
    calls.length = 0;
    ev.play('fx', { kind: 'coldWind', x: 1, y: 2, extra: { id: 1 } });
    assert.deepEqual(calls.map((c) => c[0]), ['simFx']);
    calls.length = 0;
    ev.play('fx', { kind: 'aoe', x: 1, y: 2, extra: { id: 1 }, official: true });
    assert.deepEqual(calls, []);
    ev.play('fx', { kind: 'aoe', x: 1, y: 2, extra: { id: 1 } });
    assert.deepEqual(calls.map((c) => c[0]), ['registry']);
  });

  test('an official heal / atk / skill cue: the recipe is skipped as well', () => {
    const { ev, calls } = makeEvents();
    ev.play('heal', { kind: 'heal', view: view(1), amount: 40, official: true });
    assert.deepEqual(calls.map((c) => c[0]), ['number']);
    calls.length = 0;
    ev.play('atk', { kind: 'arrow', official: true });
    ev.play('skill', { kind: 'on', view: view(1), official: true });
    assert.deepEqual(calls, []);
  });
});

test('app.js asks the official layer first in every event handler', () => {
  for (const needle of [
    'wiring.spawned(', 'wiring.deploy(', 'wiring.attack(', 'wiring.chain(', 'wiring.damage(', 'wiring.heal(',
    'wiring.skill(', 'wiring.enemyCast(', 'wiring.death(', 'wiring.status(', 'wiring.form(', 'wiring.simFx(',
    'wiring.castStart(', 'copyFrom',
  ]) {
    assert.ok(app.includes(needle), needle);
  }
  // leak + die release the unit's official loops
  assert.ok(count('wiring.release(') >= 2, `wiring.release( ${count('wiring.release(')} < 2`);
  for (const needle of ['pluginFx', 'NO_SPARK', 'meleePending']) assert.equal(count(needle), 0, needle);
});

test('the official answer reaches the fork cues, so the fork skips its own effects of a drawn event', () => {
  for (const needle of [
    'fxCues.atk(e, src, tgt, now, official)',
    'fxCues.dmg(e, v, now, v ? (src) => wiring.damage(v, e[3], src, now) : null)',
    'fxCues.heal(e, v, v ? wiring.heal(v, now) : false)',
    'fxCues.skill(e, v, on && drew)',
    'fxCues.die(v, wiring.death(v))',
    'fxCues.deploy(v, wiring.deploy(v))',
    'fxCues.fx(e, official || officialForm)',
  ]) {
    assert.ok(app.includes(needle), needle);
  }
});
