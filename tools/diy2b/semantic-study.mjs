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
const JOINTS = ['upperarm_r', 'forearm_r', 'hand_r', 'upperarm_l', 'forearm_l', 'hand_l', 'thigh_r', 'shin_r', 'foot_r', 'thigh_l', 'shin_l', 'foot_l', 'sword', 'sword_tip'];

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
  const report = { baseUrl, candidateRoot, candidateFiles, candidateInterceptions: {}, runtime: 'PixiJS + pixi-spine through public/dev/diy-2b/motion.html', startedAt: new Date().toISOString(), checks: [], errors: [], screenshots: [], results: [], interaction: null, artQualityVerdict: 'not assessed by numeric checks' };
  let browser;
  let timeout;
  const work = (async () => {
    const pageUrl = baseUrl;
    const puppeteer = createRequire(path.join(PROJECT, 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, userDataDir: profile, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1120, height: 850, deviceScaleFactor: 1 });
    await page.setCacheEnabled(false);
    page.on('pageerror', error => report.errors.push(`pageerror: ${error.message}`));
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.setRequestInterception(true);
    let useCandidate = false;
    page.on('request', request => {
      const candidate = useCandidate && candidateFiles[new URL(request.url()).pathname];
      if (candidate) {
        const pathname = new URL(request.url()).pathname;
        report.candidateInterceptions[pathname] = (report.candidateInterceptions[pathname] || 0) + 1;
        return request.respond({ status: 200, contentType: 'application/json', body: fs.readFileSync(candidate) });
      }
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
        const limbBones = { arm_r: ['upperarm_r', 'forearm_r', 'hand_r'], arm_l: ['upperarm_l', 'forearm_l', 'hand_l'], knee_r: ['thigh_r', 'shin_r', 'foot_r'], knee_l: ['thigh_l', 'shin_l', 'foot_l'] };
        const signedTurn = (a, joint, c) => {
          const u = [joint[0] - a[0], joint[1] - a[1]], v = [c[0] - joint[0], c[1] - joint[1]];
          return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI;
        };
        const interiorAngle = (a, joint, c) => {
          const u = [a[0] - joint[0], a[1] - joint[1]], v = [c[0] - joint[0], c[1] - joint[1]];
          return Math.atan2(Math.abs(u[0] * v[1] - u[1] * v[0]), u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI;
        };
        const wrapAngle = angle => { let value = angle; while (value > Math.PI) value -= 2 * Math.PI; while (value < -Math.PI) value += 2 * Math.PI; return value; };
        const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const point = name => {
          const bone = skeleton.findBone(name);
          if (!bone) throw new Error(`Required bone missing: ${name}`);
          return [bone.matrix.tx, -bone.matrix.ty];
        };
        const setPose = (name, time) => {
          skeleton.setToSetupPose();
          spine.state.clearTracks();
          spine.state.setAnimation(0, name, name === 'Idle');
          const entry = spine.state.getCurrent(0);
          entry.trackTime = time;
          spine.update(0);
        };
        const capturePose = () => {
          const bones = Object.fromEntries(jointNames.map(name => [name, point(name)]));
          const limbs = Object.fromEntries(Object.entries(limbBones).map(([name, [a, joint, c]]) => [
            name, { signedTurnDegrees: signedTurn(bones[a], bones[joint], bones[c]), interiorAngleDegrees: interiorAngle(bones[a], bones[joint], bones[c]), points: { proximal: bones[a], joint: bones[joint], distal: bones[c] } }
          ]));
          const leftHand = skeleton.slots.find(item => item.data.name === 'hand_l');
          return { bones, limbs, handLeftSlotPresent: !!leftHand, handLeftAttachment: leftHand?.attachment?.name ?? leftHand?.data?.attachmentName ?? null };
        };
        setPose('Idle', 0);
        const idle0 = capturePose();
        setPose('Idle', 0.5);
        const idleHalf = capturePose();
        setPose('Attack', 0);
        const attack0 = capturePose();
        setPose('Attack', duration);
        const attackEndPose = capturePose();
        const deltaFromIdle = (limbName, pose) => wrapAngle((pose.limbs[limbName].signedTurnDegrees - idle0.limbs[limbName].signedTurnDegrees) * Math.PI / 180) * 180 / Math.PI;
        const frameCount = Math.max(1, Math.ceil(duration * 60));
        const frames = [];
        for (let i = 0; i <= frameCount; i++) {
          setPose('Attack', Math.min(duration, i * duration / frameCount));
          const pose = capturePose();
          const frameGrip = (() => {
            const handMatrix = skeleton.findBone('hand_r').matrix, swordMatrix = skeleton.findBone('sword').matrix;
            const det = handMatrix.a * handMatrix.d - handMatrix.b * handMatrix.c;
            const dx = swordMatrix.tx - handMatrix.tx, dy = swordMatrix.ty - handMatrix.ty;
            return [(handMatrix.d * dx - handMatrix.c * dy) / det, (-handMatrix.b * dx + handMatrix.a * dy) / det, wrapAngle(Math.atan2(swordMatrix.b, swordMatrix.a) - Math.atan2(handMatrix.b, handMatrix.a))];
          })();
          const slots = {};
          for (const name of ['foot_r', 'foot_l']) {
            const slot = skeleton.slots.find(item => item.data.name === name);
            if (slot) {
              const bounds = spine.slotContainers[skeleton.slots.indexOf(slot)].getBounds();
              slots[name] = [bounds.x, bounds.y, bounds.width, bounds.height];
            }
          }
          frames.push({ t: Math.min(duration, i * duration / frameCount), ...pose, slots, gripRelative: frameGrip, foldDeltaFromIdle: Object.fromEntries(Object.keys(limbBones).map(name => [name, deltaFromIdle(name, pose)])) });
        }
        const idleHandSlot = idle0.handLeftAttachment;
        const attackHandAttachments = frames.map(frame => frame.handLeftAttachment);
        const range = values => Math.max(...values) - Math.min(...values);
        const circularRange = values => {
          if (values.length < 2) return 0;
          const origin = values[0];
          return range(values.map(value => origin + wrapAngle(value - origin)));
        };
        const swordLengths = frames.map(frame => distance(frame.bones.sword, frame.bones.sword_tip));
        const tipY = frames.map(frame => frame.bones.sword_tip[1]);
        const endpointDisplacements = Object.fromEntries(['attack0', 'attackEnd'].map(key => {
          const pose = key === 'attack0' ? attack0 : attackEndPose;
          return [key, Object.fromEntries(jointNames.map(name => [name, distance(pose.bones[name], idle0.bones[name])]))];
        }));
        const directionalSignature = Object.fromEntries(Object.keys(limbBones).map(name => [name, frames.map(frame => Math.sign(frame.foldDeltaFromIdle[name]))]));
        const handAttachmentStable = idle0.handLeftSlotPresent && attackHandAttachments.every(name => name === idleHandSlot && !/sword|grip|weapon/i.test(String(name ?? '')));
        return {
          duration, frames, idle0, idleHalf, attack0, attackEndPose, endpointDisplacements,
          handLeftAttachment: { slotPresent: idle0.handLeftSlotPresent, idle0: idleHandSlot, attack: attackHandAttachments, stableSingleHandAttachment: handAttachmentStable },
          directionalSignature,
          hasBothSoleSlots: ['foot_r', 'foot_l'].every(name => frames[0].slots[name]),
          limbFoldRanges: Object.fromEntries(Object.keys(limbBones).map(name => [name, { signedTurnDegrees: range(frames.map(frame => frame.limbs[name].signedTurnDegrees)), interiorAngleDegrees: range(frames.map(frame => frame.limbs[name].interiorAngleDegrees)) }])),
          maxFootBoneDrift: Math.max(...['foot_r', 'foot_l'].map(name => Math.max(...frames.map(frame => distance(frame.bones[name], frames[0].bones[name]))))),
          maxSoleBoundsDriftPx: Math.max(...['foot_r', 'foot_l'].flatMap(name => {
            const origin = frames[0].slots[name];
            return origin ? frames.map(frame => frame.slots[name] ? Math.hypot(frame.slots[name][0] - origin[0], frame.slots[name][1] - origin[1]) : 0) : [0];
          })),
          swordLengthRange: range(swordLengths),
          gripOffsetRange: Math.max(range(frames.map(frame => frame.gripRelative[0])), range(frames.map(frame => frame.gripRelative[1]))),
          gripAngleRangeDegrees: circularRange(frames.map(frame => frame.gripRelative[2])) * 180 / Math.PI,
          minSwordTipY: Math.min(...tipY),
          framesForEvidence: frames.filter((_, index) => index % Math.max(1, Math.floor(frameCount / 24)) === 0)
        };
      }, JOINTS);
      sampled.side = side;
      sampled.variant = variant;
      const limits = { footBoneDrift: 0.5, soleBoundsDriftPx: 0.75, swordLengthRange: 0.05, gripOffsetRange: 0.5, gripAngleRangeDegrees: 2, jointDiscontinuity: 1.0 };
      const maxAttack0Displacement = Math.max(...Object.values(sampled.endpointDisplacements.attack0));
      const maxAttackEndDisplacement = Math.max(...Object.values(sampled.endpointDisplacements.attackEnd));
      const signaturePresent = sampled.frames.length > 1 && Object.keys(sampled.directionalSignature).length === 4 && Object.values(sampled.directionalSignature).every(values => values.length === sampled.frames.length && values.every(Number.isFinite));
      const checks = variant === 'candidate' ? [
        ['four-limb-signed-and-interior-trajectories-present', signaturePresent && sampled.frames.every(frame => Object.values(frame.limbs).every(limb => Number.isFinite(limb.signedTurnDegrees) && Number.isFinite(limb.interiorAngleDegrees))), 'Stores signed turn and separate interior angle for each arm and knee at every Attack sample.'],
        ['both-sole-slots-measured', sampled.hasBothSoleSlots, 'Requires rendered left and right foot slots for sole drift measurement.'],
        ['foot-bones-fixed', sampled.maxFootBoneDrift <= limits.footBoneDrift, `max drift ${sampled.maxFootBoneDrift.toFixed(3)} <= ${limits.footBoneDrift}`],
        ['sole-bounds-fixed', sampled.maxSoleBoundsDriftPx <= limits.soleBoundsDriftPx, `max screen drift ${sampled.maxSoleBoundsDriftPx.toFixed(3)} px <= ${limits.soleBoundsDriftPx} px`],
        ['sword-length-stable', sampled.swordLengthRange <= limits.swordLengthRange, `range ${sampled.swordLengthRange.toFixed(4)} <= ${limits.swordLengthRange}`],
        ['sword-grip-stable', sampled.gripOffsetRange <= limits.gripOffsetRange && sampled.gripAngleRangeDegrees <= limits.gripAngleRangeDegrees, `hand_r offset range ${sampled.gripOffsetRange.toFixed(3)}, angle range ${sampled.gripAngleRangeDegrees.toFixed(3)}°`],
        ['sword-tip-above-floor', sampled.minSwordTipY >= -1, `minimum floor-relative Y ${sampled.minSwordTipY.toFixed(3)}; negative means below floor`],
        ['idle0-attack0-joints-continuous', maxAttack0Displacement <= limits.jointDiscontinuity, `maximum raw Idle0 to Attack0 bone displacement ${maxAttack0Displacement.toFixed(3)} <= ${limits.jointDiscontinuity}`],
        ['attack-end-idle0-joints-continuous', maxAttackEndDisplacement <= limits.jointDiscontinuity, `maximum raw Attack-end to Idle0 bone displacement ${maxAttackEndDisplacement.toFixed(3)} <= ${limits.jointDiscontinuity}`],
        ['hand-left-slot-attachment-stable', sampled.handLeftAttachment.stableSingleHandAttachment, `slotPresent=${sampled.handLeftAttachment.slotPresent}; Idle0=${sampled.handLeftAttachment.idle0}; Attack samples=${[...new Set(sampled.handLeftAttachment.attack)].join(',')}`]
      ] : [];
      report.checks.push(...checks.map(([id, passed, detail]) => ({ variant, side, id, passed, detail })));
      report.screenshots.push(path.join(outputDir, `${variant}-${side}-attack.png`));
      const seekTo = Math.min(0.58, sampled.duration * 0.55);
      await page.goto(url.href, { waitUntil: 'networkidle2', timeout: 25_000 });
      await page.waitForFunction(() => window.__motion?.ready, { timeout: 20_000 });
      await page.evaluate(time => { window.__motion.pose(time); document.querySelector('#bones').checked = true; }, seekTo);
      await page.screenshot({ path: report.screenshots.at(-1) });
      report.results.push(sampled);
    }

    await page.reload({ waitUntil: 'networkidle2', timeout: 25_000 });
    await page.waitForFunction(() => window.__motion?.ready, { timeout: 20_000 });
    await page.click('#pause');
    const paused = await page.$eval('#pause', button => button.textContent === '播放');
    const slider = await page.$('#progress');
    const box = await slider.boundingBox();
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.37, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const interaction = await page.evaluate(() => {
      const seekTime = document.querySelector('#time').textContent;
      const duration = window.__motion.sp().spineData.findAnimation('Attack').duration;
      const normalizedSeek = Number.parseFloat(seekTime) / duration;
      return { pauseButtonWorks: document.querySelector('#pause').textContent === '播放', seekControlWorks: Math.abs(normalizedSeek - 0.37) < 0.01, seekTime, normalizedSeek, frameLink: document.querySelector('#frameLink').href };
    });
    interaction.pauseButtonWorks = paused && interaction.pauseButtonWorks;
    report.interaction = interaction;
    report.checks.push({ id: 'pause-and-drag-seek-operable', passed: interaction.pauseButtonWorks && interaction.seekControlWorks, detail: JSON.stringify(interaction) });
    const sourceFront = report.results.find(result => result.variant === 'source' && result.side === 'front');
    const candidateDirectionComparisons = [];
    for (const side of ['front', 'back']) {
      const source = report.results.find(result => result.variant === 'source' && result.side === side);
      const candidate = report.results.find(result => result.variant === 'candidate' && result.side === side);
      for (const limb of ['arm_r', 'arm_l', 'knee_r', 'knee_l']) {
        const sourceDirections = source.directionalSignature[limb];
        const candidateDirections = candidate.directionalSignature[limb];
        const count = Math.min(sourceDirections.length, candidateDirections.length);
        const mismatches = [];
        for (let i = 0; i < count; i++) if (sourceDirections[i] !== candidateDirections[i]) mismatches.push({ frame: i, t: candidate.frames[i].t, source: sourceDirections[i], candidate: candidateDirections[i] });
        candidateDirectionComparisons.push({ side, limb, comparedSamples: count, mismatchCount: mismatches.length, firstMismatches: mismatches.slice(0, 8) });
      }
    }
    report.candidateDirectionComparisons = candidateDirectionComparisons;
    for (const comparison of candidateDirectionComparisons) report.checks.push({ variant: 'candidate', side: comparison.side, id: `fold-direction-matches-source-${comparison.limb}`, passed: comparison.mismatchCount === 0, detail: JSON.stringify(comparison) });
    const degreeDelta = (to, from) => { let value = to - from; while (value > 180) value -= 360; while (value < -180) value += 360; return value; };
    const frontLeftDelta = sourceFront && degreeDelta(sourceFront.attack0.limbs.arm_l.signedTurnDegrees, sourceFront.idle0.limbs.arm_l.signedTurnDegrees);
    const frontRightDelta = sourceFront && degreeDelta(sourceFront.attack0.limbs.arm_r.signedTurnDegrees, sourceFront.idle0.limbs.arm_r.signedTurnDegrees);
    report.baselineDiscovery = sourceFront ? {
      frontAttack0ArmFoldDeltas: { arm_l: frontLeftDelta, arm_r: frontRightDelta },
      frontAttack0SignedTurns: { arm_l: sourceFront.attack0.limbs.arm_l.signedTurnDegrees, arm_r: sourceFront.attack0.limbs.arm_r.signedTurnDegrees },
      elbowDirectionsDifferIdle0ToAttack0: Math.sign(frontLeftDelta) !== Math.sign(frontRightDelta),
      elbowDirectionsDifferAtAttack0: Math.sign(sourceFront.attack0.limbs.arm_l.signedTurnDegrees) !== Math.sign(sourceFront.attack0.limbs.arm_r.signedTurnDegrees),
      shoulders: { arm_l: sourceFront.attack0.limbs.arm_l.points.proximal, arm_r: sourceFront.attack0.limbs.arm_r.points.proximal },
      elbows: { arm_l: sourceFront.attack0.limbs.arm_l.points.joint, arm_r: sourceFront.attack0.limbs.arm_r.points.joint },
      wrists: { arm_l: sourceFront.attack0.limbs.arm_l.points.distal, arm_r: sourceFront.attack0.limbs.arm_r.points.distal }
    } : null;
    const interceptedBothCandidates = Object.values(candidateFiles).every((file, index) => report.candidateInterceptions[Object.keys(candidateFiles)[index]] > 0);
    report.checks.push({ variant: 'candidate', id: 'front-back-candidate-json-intercepted', passed: interceptedBothCandidates, detail: JSON.stringify(report.candidateInterceptions) });
    report.url = pageUrl;
    report.passed = !report.checks.some(check => (check.variant === 'candidate' || !check.variant) && !check.passed) && report.errors.length === 0;
  })();
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Hard deadline reached after ${TIME_LIMIT_MS} ms`)), TIME_LIMIT_MS); });
  try { await Promise.race([work, deadline]); }
  catch (error) { report.errors.push(error.stack || String(error)); report.passed = false; }
  finally {
    clearTimeout(timeout);
    await browser?.close().catch(error => report.errors.push(`browser close: ${error.message}`));
    report.finishedAt = new Date().toISOString();
    report.passed = report.passed === true && report.errors.length === 0 && !report.checks.some(check => (check.variant === 'candidate' || !check.variant) && !check.passed);
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
