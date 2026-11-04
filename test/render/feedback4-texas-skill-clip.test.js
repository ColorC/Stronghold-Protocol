// test/render/feedback4-texas-skill-clip.test.js — player report (after 0.1.3): 德克萨斯 S2「剑雨」释放时不播放技能动画.
//
// Her Front model's skill roles are { begin: null, loop: 'Skill', end: null } — the 2.17 s 剑雨 clip — and both her
// skills are instant (server/sim/skills.js fires 'skill' 1 and 0 inside one tick and holds only the anim code SKILL for
// 0.5 s, snapshot.js animOf). spine.js setSkill(true) had a branch for a Begin clip and otherwise just re-played the
// base clip, so the skill clip never played: the actor showed its idle through the whole cast. The same clip shape
// (no Begin, no own Idle) carries 58 instant skills across the manifest.
//
// Real manifest entries, headless fake PIXI (test/render/fakepixi.js), like feedback3-skill-idle.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi } from './fakepixi.js';
import { assaultAssets } from '../../public/js/assault/model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeAssets = JSON.parse(readFileSync(path.join(process.env.SP_DATA_DIR || path.join(ROOT, 'data'), 'assets.json'), 'utf8'));
const assets = process.env.ASSAULT_RULES_ROOT ? assaultAssets(JSON.parse(readFileSync(path.join(process.env.ASSAULT_RULES_ROOT, 'assault-assets.json'), 'utf8')), nativeAssets) : nativeAssets;

let fake, SpineActor;
before(async () => {
  fake = installFakePixi();
  ({ SpineActor } = await import('../../public/js/render/spine.js'));
});
after(() => fake.restore());

/** An actor of a real operator's Front model with its equipped skill, recording every clip set / queued. */
function actor(charId, skillIndex) {
  const entry = assets.chars[charId].spine.front;
  const a = new SpineActor({ animations: Object.keys(entry.animations).map((name) => ({ name })) }, entry);
  a.setSkillIndex(skillIndex);
  a.log = [];
  const st = a.spine.state;
  const set = st.setAnimation, add = st.addAnimation;
  st.setAnimation = (i, name, loop) => { a.log.push(['set', name, !!loop]); return set(i, name, loop); };
  st.addAnimation = (i, name, loop) => { a.log.push(['queue', name, !!loop]); return add(i, name, loop); };
  return a;
}
const run = (a, s, dt = 1 / 60) => { for (let t = 0; t < s - 1e-9; t += dt) a.update(dt); };
const names = (a) => a.log.map(([, n]) => n);

test('a same-frame instant cast with an own Idle and no Begin plays its loop once, while a sustained window rests', () => {
  const a = actor('char_1014_nearl2', 2);
  a.setSkill(true); a.setSkill(false);
  assert.equal(a.current, a.roles.skill.loop);
  assert.match(a.current, /^Skill_3/);
  run(a, a.dur(a.roles.skill.loop) + .1);
  assert.equal(a.mode, 'base');
  assert.equal(a.current, 'Idle');
  const sustained = actor('char_1014_nearl2', 2);
  sustained.setSkill(true); run(sustained, 1);
  assert.equal(sustained.current, 'Skill_3_Idle');
});

test('Surtr S3 converted to an instant cast keeps its Begin clip when on/off arrive in the same tick', () => {
  const a = actor('char_350_surtr', 2);
  assert.equal(a.roles.skill.begin, 'Skill_3_Begin');
  a.setSkill(true);
  a.setSkill(false);
  assert.equal(a.current, 'Skill_3_Begin');
  assert.equal(a.skillEndPending, true);
  run(a, a.dur('Skill_3_Begin') / 2);
  assert.equal(a.current, 'Skill_3_Begin');
  run(a, a.dur('Skill_3_Begin'));
  assert.equal(a.mode, 'base');
  assert.equal(a.current, 'Idle');
  assert.equal(a.skillOn, false);
});

test('an interrupted Begin clip still yields to deployment or death rather than resuming a cancelled cast', () => {
  const a = actor('char_350_surtr', 2);
  a.setSkill(true); a.setSkill(false); a.deploy();
  assert.equal(a.mode, 'deploy');
  run(a, a.dur('Start') + .1);
  assert.equal(a.current, 'Idle');
  const dead = actor('char_350_surtr', 2);
  dead.setSkill(true); dead.setSkill(false); dead.die();
  assert.equal(dead.mode, 'die');
  assert.equal(dead.current, 'Die');
});

test('德克萨斯 S2 剑雨: an instant skill with no Begin clip plays its Skill clip and keeps it for the clip length', () => {
  const a = actor('char_102_texas', 1);
  assert.deepEqual([a.roles.skill.begin, a.roles.skill.loop, a.roles.skill.end, a.roles.skill.idle], [null, 'Skill', null, null], 'the manifest roles');
  assert.equal(a.dur('Skill'), 2.167, 'the 剑雨 clip');
  a.setSkill(true);
  assert.deepEqual(a.log, [['set', 'Skill', false]], 'the skill clip itself, played once');
  a.setSkill(false);   // the sim fires 'skill' 1 and 0 in the same tick: the flag is already off
  run(a, 1);
  assert.equal(a.mode, 'skillBegin');
  assert.equal(a.current, 'Skill', 'still on screen halfway through the cast');
  run(a, 1.3);
  assert.equal(a.mode, 'base');
  assert.equal(a.current, 'Idle', 'back to the idle once the clip has run');
  assert.deepEqual(names(a), ['Skill', 'Idle'], 'no end clip, no base flash before it');
});

test('the other instant skills with the same clip shape play their clip too (char_140_whitew S1 日晷, char_206_gnosis S2 零度爆发, 德克萨斯 S1)', () => {
  for (const [charId, idx, clip] of [['char_140_whitew', 0, 'Skill'], ['char_206_gnosis', 1, 'Skill_2'], ['char_102_texas', 0, 'Skill']]) {
    const a = actor(charId, idx);
    assert.equal(a.roles.skill.begin, null, `${charId} S${idx + 1}: no Begin clip`);
    assert.equal(a.roles.skill.idle, null, `${charId} S${idx + 1}: no own Idle`);
    a.setSkill(true);
    assert.equal(a.current, clip, `${charId} S${idx + 1} plays ${clip}`);
  }
});

test('a skill that stays on (银灰 S3 真银斩: same clip shape, 1.33 s clip) plays it once and then rests — no freeze on its last frame', () => {
  const a = actor('char_172_svrash', 2);
  assert.deepEqual([a.roles.skill.begin, a.roles.skill.loop, a.roles.skill.idle], [null, 'Skill', null]);
  a.setSkill(true);
  assert.equal(a.current, 'Skill');
  run(a, 2);
  assert.equal(a.mode, 'base', 'the one-shot window is over');
  assert.equal(a.current, 'Idle', 'rests on the idle while the skill is still running');
  a.log.length = 0;
  a.attack(1.2);
  assert.equal(a.current, 'Skill', 'attacks still use the skill loop, as before');
  a.setSkill(false);
  assert.equal(a.current, 'Idle', 'no End clip: straight back to the idle');
});

test('unchanged: a Begin clip still runs into its queued next clip, a skill with its own Idle still idles, and End still closes the skill', () => {
  const b = actor('char_4207_branch', 1);   // 折桠 S2: Skill_2_Begin → Skill_2_Idle (community report #23)
  b.setSkill(true);
  assert.deepEqual(b.log, [['set', 'Skill_2_Begin', false], ['queue', 'Skill_2_Idle', true]]);
  const n = actor('char_1014_nearl2', 2);   // 耀骑士临光 S3: no Begin, own Idle — plays that idle at once
  n.setSkill(true);
  assert.deepEqual(n.log, [['set', 'Skill_3_Idle', true]]);
  const u = actor('char_337_utage', 0);     // 宴 S1 分神: Begin → loop, unchanged (her S2 has no skill clip, DESIGN §25.22.9)
  u.setSkill(true);
  assert.deepEqual(u.log, [['set', 'Skill_Start', false], ['queue', 'Skill_Loop', true]]);
});

test('the deploy-time passives the sim now opens a window for play their clip (琳琅诗怀雅 S1/S2: kind passive, no duration)', () => {
  // server/sim/skills.js `_startPassive` fires ['skill', id, 1] at the deployment and 0 after SKILL_ANIM_WINDOW (0.5 s),
  // which is shorter than her 1 s clips: the actor holds the clip to its own end and then idles.
  for (const [idx, clip] of [[0, 'Skill_1'], [1, 'Skill_2']]) {
    const a = actor('char_1033_swire2', idx);
    assert.deepEqual([a.roles.skill.begin, a.roles.skill.loop, a.roles.skill.idle], [null, clip, null]);
    assert.equal(a.dur(clip), 1);
    a.setSkill(true);
    assert.equal(a.current, clip, `S${idx + 1} plays ${clip} at the deployment`);
    run(a, 0.5);
    a.setSkill(false);                      // the sim closes the window at 0.5 s …
    run(a, 0.4);
    assert.equal(a.current, clip, '… the clip is still running (it is 1 s long)');
    run(a, 0.2);
    assert.equal(a.mode, 'base');
    assert.equal(a.current, 'Idle', 'and then back to the idle');
  }
});

test('a skill clip that IS the normal attack clip is not played as a skill animation (no attack twitch at the deployment)', () => {
  const a = actor('char_1028_texas2', 0);   // 缄默德克萨斯 S1: anims.skill.loop === anims.attack.loop ('Attack')
  assert.equal(a.roles.skill.loop, a.roles.attack.loop);
  a.setSkill(true);
  assert.deepEqual(a.log, [['set', 'Idle', true]], 'falls through to the base clip, as before');
  assert.equal(a.current, 'Idle');
});
