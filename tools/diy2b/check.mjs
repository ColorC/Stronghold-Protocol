// Structural regressions plus the existing real Spine runtime pose checker.
// node check.mjs <model.json> <existing validate.mjs> [report.json]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const [model, validator, output] = process.argv.slice(2);
const sk = JSON.parse(fs.readFileSync(model, 'utf8'));
const a = sk.animations;
const errors = [];
const check = (name, f) => { try { f(); } catch (e) { errors.push(`${name}: ${e.message}`); } };
check('continuous blade', () => {
  for (const name of ['Attack', 'Skill_1']) {
    assert(a[name].bones.sword.rotate.every(k => k.curve !== 'stepped'), `${name} has a blade jump`);
    assert(a[name].bones.sword.scale.every(k => k.y >= .99), `${name} changes blade thickness`);
    if (name === 'Attack') assert(a[name].bones.sword.scale.every(k => k.x >= .99), 'attack collapses blade');
  }
});
check('retained-frame transition', () => {
  const keys = a.Attack.bones.hip.translate;
  const at = t => keys.find(k => Math.abs(k.time - t) < .0001);
  if (at(.51) && at(.45)) assert(Math.abs(at(.51).x - at(.45).x) <= 2, 'stationary hip drifts across removed video frame');
});
check('settled root', () => {
  for (const name of ['Attack', 'Skill_1', 'Start', 'Skill_2_End']) {
    const last = a[name].bones.hip.translate.at(-1);
    assert(Math.hypot(last.x || 0, last.y || 0) < .05, `${name} ends away from its rest origin`);
  }
});
check('shared clip boundary', () => {
  for (const [p, n] of [['Skill_3_Begin', 'Skill_3_End'], ['Skill_3_End', 'Stun_Skill_3']]) {
    for (const [bone, channels] of Object.entries(a[p].bones)) {
      if (bone.startsWith('pod')) continue;
      for (const type of ['rotate', 'translate', 'scale']) {
        if (!channels[type] || !a[n].bones[bone]?.[type]) continue;
        const x = channels[type].at(-1), y = a[n].bones[bone][type][0];
        for (const field of ['x', 'y', 'angle']) if (field in x) assert(Math.abs(x[field] - (y[field] || 0)) < .05, `${p} → ${n}: ${bone}.${field}`);
      }
    }
  }
});
check('hit events', () => {
  assert.deepEqual(a.Attack.events.filter(e => e.name === 'OnAttack').map(e => e.time), [.42, .7]);
  assert.deepEqual(a.Skill_1.events.filter(e => e.name === 'OnAttack').map(e => e.time), [.28, .52, .84]);
});
const raw = execFileSync(process.execPath, [validator, path.dirname(model), `skel=/${path.basename(model)}&lying=Die,Stun_Skill_3`], { encoding: 'utf8', timeout: 90000, maxBuffer: 4e6 });
const runtime = JSON.parse(raw.trim().split('\n').findLast(l => l.startsWith('{')));
const runtimeIssues = Object.fromEntries(Object.entries(runtime).filter(([, issues]) => Object.keys(issues).length));
const report = { model: path.resolve(model), errors, runtimeIssues, runtime, passed: !errors.length && !Object.keys(runtimeIssues).length };
if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
