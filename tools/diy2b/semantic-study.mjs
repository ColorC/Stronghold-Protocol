// Semantic checks for a front/back single-hand Attack using the real Pixi Spine runtime.
// The measurements report mechanical continuity and movement; they do not judge art quality.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PROJECT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const BROWSER = 'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const TIME_LIMIT_MS = 180_000;
const USAGE = 'Usage: node tools/diy2b/semantic-study.mjs <motion-page-url> <absolute-output-directory> <absolute-candidate-root>';
const JOINTS = ['upperarm_r', 'forearm_r', 'hand_r', 'thigh_r', 'shin_r', 'foot_r', 'thigh_l', 'shin_l', 'foot_l', 'sword', 'sword_tip'];

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(baseUrl, outputDir, candidateRoot) {
  must(typeof baseUrl === 'string' && new URL(baseUrl).pathname.endsWith('/dev/diy-2b/motion.html'), USAGE);
  must(path.isAbsolute(outputDir) && path.isAbsolute(candidateRoot), USAGE);
  must(fs.existsSync(BROWSER), `Chromium executable missing: ${BROWSER}`);
  const candidateFiles = {
    '/dev/diy-2b/model/front/char_diy_2b.json': path.join(candidateRoot, 'public/dev/diy-2b/model/front/char_diy_2b.json'),
    '/dev/diy-2b/model/back/char_diy_2b_back.json': path.join(candidateRoot, 'public/dev/diy-2b/model/back/char_diy_2b_back.json')
  };
  for (const [urlPath, file] of Object.entries(candidateFiles)) must(fs.existsSync(file), `Candidate JSON missing for ${urlPath}: ${file}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const profile = path.join(PROJECT, '.omni/tmp/spine-attack-validation-20261008/browser-profile');
  fs.mkdirSync(profile, { recursive: true });
  const report = { baseUrl, candidateRoot, runtime: 'PixiJS + pixi-spine through public/dev/diy-2b/motion.html', startedAt: new Date().toISOString(), checks: [], errors: [], screenshots: [], results: [], interaction: null, artQualityVerdict: 'not assessed by numeric checks' };
  let browser;
  let timeout;
  const work = (async () => {
    const pageUrl = baseUrl;
    const puppeteer = createRequire(path.join(PROJECT, 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, userDataDir: profile, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1120, height: 850, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.errors.push(`pageerror: ${error.message}`));
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.setRequestInterception(true);
    let useCandidate = false;
    page.on('request', request => {
      const candidate = useCandidate && candidateFiles[new URL(request.url()).pathname];
      if (candidate) return request.respond({ status: 200, contentType: 'application/json', body: fs.readFileSync(candidate) });
      return request.continue();
    });

    for (const variant of ['source', 'candidate']) for (const side of ['front', 'back']) {
      useCandidate = variant === 'candidate';
      const url = new URL(pageUrl);
      url.searchParams.set('side', side);
      url.searchParams.set('action', 'Attack');
      await page.goto(url.href, { waitUntil: 'networkidle2', timeout: 25_000 });
      await page.waitForFunction(() => window.__motion?.ready, { timeout: 20_000 });
      const sampled = await page.evaluate(async (jointNames) => {
        const motion = window.__motion;
        const spine = motion.sp();
        const skeleton = spine.skeleton;
        const data = spine.spineData;
        const idle = data.findAnimation('Idle');
        const attack = data.findAnimation('Attack');
        if (!idle || !attack) throw new Error(`Required animations missing: Idle=${!!idle}, Attack=${!!attack}`);
        const duration = attack.duration;
        const signedFold = (a, joint, c) => {
          const u = [a[0] - joint[0], a[1] - joint[1]], v = [c[0] - joint[0], c[1] - joint[1]];
          return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI;
        };
        const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const point = name => {
          const bone = skeleton.findBone(name);
          if (!bone) throw new Error(`Required bone missing: ${name}`);
          return [bone.matrix.tx, -bone.matrix.ty];
        };
        const resetClip = (name, loop) => { skeleton.setToSetupPose(); spine.state.clearTracks(); spine.state.setAnimation(0, name, loop); spine.update(0); };
        const tick = dt => { spine.update(dt); };
        resetClip('Idle', true);
        tick(0.5);
        const idlePose = Object.fromEntries(jointNames.map(name => [name, point(name)]));
        const idleArmFold = signedFold(point('upperarm_r'), point('forearm_r'), point('hand_r'));
        const idleKneeFold = signedFold(point('thigh_r'), point('shin_r'), point('foot_r'));
        spine.state.setAnimation(0, 'Attack', false);
        tick(0);
        const frameCount = Math.max(1, Math.ceil(duration * 60));
        const frames = [];
        for (let i = 0; i <= frameCount; i++) {
          if (i) tick(duration / frameCount);
          const bones = Object.fromEntries(jointNames.map(name => [name, point(name)]));
          const slots = {};
          for (const name of ['foot_r', 'foot_l']) {
            const slot = skeleton.slots.find(item => item.data.name === name);
            if (slot) {
              const bounds = spine.slotContainers[skeleton.slots.indexOf(slot)].getBounds();
              slots[name] = [bounds.x, bounds.y, bounds.width, bounds.height];
            }
          }
          frames.push({ t: Math.min(duration, i * duration / frameCount), bones, slots });
        }
        const attackEnd = frames.at(-1).bones;
        spine.state.setAnimation(0, 'Idle', true);
        tick(1 / 60);
        const idleReturn = Object.fromEntries(jointNames.map(name => [name, point(name)]));
        const startDiscontinuity = Object.fromEntries(jointNames.map(name => [name, distance(frames[0].bones[name], idlePose[name])]));
        const endDiscontinuity = Object.fromEntries(jointNames.map(name => [name, distance(idleReturn[name], attackEnd[name])]));
        const handFold = frames.map(frame => signedFold(frame.bones.upperarm_r, frame.bones.forearm_r, frame.bones.hand_r));
        const kneeFold = frames.map(frame => signedFold(frame.bones.thigh_r, frame.bones.shin_r, frame.bones.foot_r));
        const range = values => Math.max(...values) - Math.min(...values);
        const swordLengths = frames.map(frame => distance(frame.bones.sword, frame.bones.sword_tip));
        const gripOffsets = frames.map(frame => [frame.bones.sword[0] - frame.bones.hand_r[0], frame.bones.sword[1] - frame.bones.hand_r[1]]);
        const gripAngles = gripOffsets.map(offset => Math.atan2(offset[1], offset[0]));
        const wrapAngle = angle => { let value = angle; while (value > Math.PI) value -= 2 * Math.PI; while (value < -Math.PI) value += 2 * Math.PI; return value; };
        const tipY = frames.map(frame => frame.bones.sword_tip[1]);
        return {
          duration, frames,
          idlePose, idleReturn,
          startDiscontinuity,
          hasBothSoleSlots: ['foot_r', 'foot_l'].every(name => frames[0].slots[name]),
          folds: { idleArmRightDegrees: idleArmFold, idleKneeRightDegrees: idleKneeFold, armRightDegrees: handFold, kneeRightDegrees: kneeFold, armDeltaFromIdleDegrees: handFold.map(value => value - idleArmFold), kneeDeltaFromIdleDegrees: kneeFold.map(value => value - idleKneeFold), armSignedRange: range(handFold), kneeSignedRange: range(kneeFold) },
          maxFootBoneDrift: Math.max(...['foot_r', 'foot_l'].map(name => Math.max(...frames.map(frame => distance(frame.bones[name], frames[0].bones[name]))))),
          maxSoleBoundsDriftPx: Math.max(...['foot_r', 'foot_l'].flatMap(name => {
            const origin = frames[0].slots[name];
            return origin ? frames.map(frame => frame.slots[name] ? Math.hypot(frame.slots[name][0] - origin[0], frame.slots[name][1] - origin[1]) : 0) : [0];
          })),
          swordLengthRange: range(swordLengths),
          gripOffsetRange: range(gripOffsets.map(offset => Math.hypot(...offset))),
          gripAngleRangeDegrees: range(gripAngles.map(wrapAngle)) * 180 / Math.PI,
          minSwordTipY: Math.min(...tipY),
          endDiscontinuity,
          endToIdlePose: Object.fromEntries(jointNames.map(name => [name, distance(attackEnd[name], idlePose[name])])),
          returnIdleDiscontinuity: Object.fromEntries(jointNames.map(name => [name, distance(idleReturn[name], idlePose[name])])),
          framesForEvidence: frames.filter((_, index) => index % Math.max(1, Math.floor(frameCount / 24)) === 0)
        };
      }, JOINTS);
      sampled.side = side;
      sampled.variant = variant;
      const limits = { footBoneDrift: 0.5, soleBoundsDriftPx: 0.75, swordLengthRange: 0.05, gripOffsetRange: 0.5, gripAngleRangeDegrees: 2, jointDiscontinuity: 1.0 };
      const maxJointDiscontinuity = Math.max(...Object.values(sampled.endDiscontinuity));
      const checks = [
        ['signed-fold-values-present', sampled.folds.armRightDegrees.every(Number.isFinite) && sampled.folds.kneeRightDegrees.every(Number.isFinite), 'Reports signed elbow and knee fold through the Attack clip; values do not define a preferred artistic direction.'],
        ['both-sole-slots-measured', sampled.hasBothSoleSlots, 'Requires rendered left and right foot slots for sole drift measurement.'],
        ['foot-bones-fixed', sampled.maxFootBoneDrift <= limits.footBoneDrift, `max drift ${sampled.maxFootBoneDrift.toFixed(3)} <= ${limits.footBoneDrift}`],
        ['sole-bounds-fixed', sampled.maxSoleBoundsDriftPx <= limits.soleBoundsDriftPx, `max screen drift ${sampled.maxSoleBoundsDriftPx.toFixed(3)} px <= ${limits.soleBoundsDriftPx} px`],
        ['sword-length-stable', sampled.swordLengthRange <= limits.swordLengthRange, `range ${sampled.swordLengthRange.toFixed(4)} <= ${limits.swordLengthRange}`],
        ['sword-grip-stable', sampled.gripOffsetRange <= limits.gripOffsetRange && sampled.gripAngleRangeDegrees <= limits.gripAngleRangeDegrees, `hand_r offset range ${sampled.gripOffsetRange.toFixed(3)}, angle range ${sampled.gripAngleRangeDegrees.toFixed(3)}°`],
        ['sword-tip-above-floor', sampled.minSwordTipY >= -1, `minimum floor-relative Y ${sampled.minSwordTipY.toFixed(3)}; negative means below floor`],
        ['idle-attack-return-joints-continuous', Math.max(maxJointDiscontinuity, ...Object.values(sampled.startDiscontinuity)) <= limits.jointDiscontinuity, `maximum entry/return displacement ${Math.max(maxJointDiscontinuity, ...Object.values(sampled.startDiscontinuity)).toFixed(3)} <= ${limits.jointDiscontinuity}`],
        ['attack-end-matches-idle-joints', Math.max(...Object.values(sampled.endToIdlePose)) <= limits.jointDiscontinuity, `maximum Attack-end to Idle displacement ${Math.max(...Object.values(sampled.endToIdlePose)).toFixed(3)} <= ${limits.jointDiscontinuity}`]
      ];
      report.checks.push(...checks.map(([id, passed, detail]) => ({ variant, side, id, passed, detail })));
      report.screenshots.push(path.join(outputDir, `${variant}-${side}-attack.png`));
      const seekTo = Math.min(0.58, sampled.duration * 0.55);
      await page.goto(url.href, { waitUntil: 'networkidle2', timeout: 25_000 });
      await page.waitForFunction(() => window.__motion?.ready, { timeout: 20_000 });
      await page.evaluate(time => { window.__motion.pose(time); document.querySelector('#bones').checked = true; }, seekTo);
      await page.screenshot({ path: report.screenshots.at(-1) });
      report.results.push(sampled);
    }

    const interaction = await page.evaluate(async () => {
      const pause = document.querySelector('#pause');
      const slider = document.querySelector('#progress');
      pause.click();
      const paused = pause.textContent === '播放';
      slider.value = '0.37';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const seekTime = document.querySelector('#time').textContent;
      const duration = window.__motion.sp().spineData.findAnimation('Attack').duration;
      const normalizedSeek = Number.parseFloat(seekTime) / duration;
      return { pauseButtonWorks: paused, seekControlWorks: Math.abs(normalizedSeek - 0.37) < 0.01, seekTime, normalizedSeek, frameLink: document.querySelector('#frameLink').href };
    });
    report.interaction = interaction;
    report.checks.push({ id: 'pause-and-drag-seek-operable', passed: interaction.pauseButtonWorks && interaction.seekControlWorks, detail: JSON.stringify(interaction) });
    report.url = pageUrl;
    const candidateChecks = report.checks.filter(check => check.variant === 'candidate');
    report.baselineFindings = report.checks.filter(check => check.variant === 'source' && !check.passed);
    report.baselineIdleAttackFoldEndpoint = report.results.filter(result => result.variant === 'source').map(result => ({ side: result.side, idleArmRightDegrees: result.folds.idleArmRightDegrees, attackArmDeltaRangeDegrees: result.folds.armSignedRange, idleKneeRightDegrees: result.folds.idleKneeRightDegrees, attackKneeDeltaRangeDegrees: result.folds.kneeSignedRange, entryDisplacement: result.startDiscontinuity, returnDisplacement: result.endDiscontinuity }));
    report.passed = !candidateChecks.some(check => !check.passed) && interaction.pauseButtonWorks && interaction.seekControlWorks && report.errors.length === 0;
  })();
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Hard deadline reached after ${TIME_LIMIT_MS} ms`)), TIME_LIMIT_MS); });
  try { await Promise.race([work, deadline]); }
  catch (error) { report.errors.push(error.stack || String(error)); report.passed = false; }
  finally {
    clearTimeout(timeout);
    await browser?.close().catch(error => report.errors.push(`browser close: ${error.message}`));
    report.finishedAt = new Date().toISOString();
    report.passed = report.passed === true && report.errors.length === 0 && !report.checks.some(check => !check.passed);
    const receipt = path.join(outputDir, 'semantic-study.json');
    fs.writeFileSync(receipt, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ receipt, screenshots: report.screenshots, passed: report.passed, errors: report.errors, checks: report.checks }, null, 2));
  }
  return report;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain && !process.env.NODE_TEST_CONTEXT) {
  const [baseUrl, outputDir, candidateRoot] = process.argv.slice(2);
  if (!baseUrl || !outputDir || !candidateRoot) { console.error(USAGE); process.exitCode = 2; }
  else { const report = await run(baseUrl, outputDir, candidateRoot); if (!report.passed) process.exitCode = 1; }
}
