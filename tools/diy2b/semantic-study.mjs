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
const LIMBS = ['arm_r', 'arm_l', 'knee_r', 'knee_l'];
const REANALYSIS_USAGE = 'Usage: node tools/diy2b/semantic-study.mjs --reanalyze-json <source-report.json> <new-output-report.json>';

function must(condition, message) {
  if (!condition) throw new Error(message);
}

function wrappedDegrees(degrees) {
  let value = degrees;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function neutralDirection(degrees, epsilon = 0.1) {
  return Math.abs(degrees) <= epsilon ? 0 : Math.sign(degrees);
}

function maximumValue(object) {
  return Math.max(...Object.values(object).map(Number));
}

function analyzeReport(sourceReport, sourceReportPath) {
  must(Array.isArray(sourceReport.results), 'Source report has no sampled results array.');
  const checks = [];
  const resultFor = (variant, side) => sourceReport.results.find(result => result.variant === variant && result.side === side);
  const baseline = {};
  const candidateResults = [];
  const previousDeltaDirectionDifferences = [];
  const candidateTrajectories = [];
  const staticJointLimit = 1.0;
  const limits = { footBoneDrift: 0.5, soleBoundsDriftPx: 0.75, swordLengthRange: 0.05, gripOffsetRange: 0.5, gripAngleRangeDegrees: 2, rawEndpointDisplacement: staticJointLimit };

  for (const side of ['front', 'back']) {
    const source = resultFor('source', side);
    const candidate = resultFor('candidate', side);
    must(source?.idle0?.limbs && source?.attack0?.limbs && Array.isArray(source.frames), `Source ${side} sample is incomplete.`);
    must(candidate?.idle0?.limbs && candidate?.attack0?.limbs && Array.isArray(candidate.frames), `Candidate ${side} sample is incomplete.`);
    const limbChecks = [];
    const perLimbComparisons = [];

    for (const limb of LIMBS) {
      const sourceIdle = source.idle0.limbs[limb].signedTurnDegrees;
      const candidateIdle = candidate.idle0.limbs[limb].signedTurnDegrees;
      const idleDifference = Math.abs(wrappedDegrees(candidateIdle - sourceIdle));
      const idleMatches = idleDifference <= 0.1;
      const sourceBranch = neutralDirection(sourceIdle);
      const trajectory = candidate.frames.map(frame => {
        const absolute = frame.limbs[limb].signedTurnDegrees;
        const direction = neutralDirection(absolute);
        return { t: frame.t, signedTurnDegrees: absolute, interiorAngleDegrees: frame.limbs[limb].interiorAngleDegrees, sourceIdle0Branch: sourceBranch, neutralizedCandidateDirection: direction, matchesSourceIdle0Branch: direction === sourceBranch };
      });
      const branchMismatches = trajectory.filter(frame => !frame.matchesSourceIdle0Branch);
      limbChecks.push({ limb, sourceIdle0SignedTurnDegrees: sourceIdle, candidateIdle0SignedTurnDegrees: candidateIdle, idleDifferenceDegrees: idleDifference, idleMatches, sourceBranch, attackSamples: trajectory.length, branchMismatchCount: branchMismatches.length, firstBranchMismatches: branchMismatches.slice(0, 8) });
      perLimbComparisons.push({ limb, idleMatches, idleDifferenceDegrees: idleDifference, branchMismatchCount: branchMismatches.length, samples: trajectory.length });
      candidateTrajectories.push({ side, limb, sourceIdle0SignedTurnDegrees: sourceIdle, frames: trajectory });

      const prior = sourceReport.candidateDirectionComparisons?.find(item => item.side === side && item.limb === limb);
      const sourceDeltaSigns = source.frames.map(frame => Math.sign(frame.foldDeltaFromIdle?.[limb] ?? 0));
      const candidateDeltaSigns = candidate.frames.map(frame => Math.sign(frame.foldDeltaFromIdle?.[limb] ?? 0));
      const oldCount = Math.min(sourceDeltaSigns.length, candidateDeltaSigns.length);
      const oldMismatches = [];
      for (let i = 0; i < oldCount; i++) if (sourceDeltaSigns[i] !== candidateDeltaSigns[i]) oldMismatches.push({ frame: i, t: candidate.frames[i].t, sourceDeltaSign: sourceDeltaSigns[i], candidateDeltaSign: candidateDeltaSigns[i] });
      previousDeltaDirectionDifferences.push({ side, limb, priorGateId: `fold-direction-matches-source-${limb}`, priorComparedSamples: prior?.comparedSamples ?? oldCount, priorMismatchCount: prior?.mismatchCount ?? oldMismatches.length, recomputedComparedSamples: oldCount, recomputedMismatchCount: oldMismatches.length, sourceDeltaSigns, candidateDeltaSigns, mismatches: oldMismatches, excludedFromPass: true });
    }

    const endpoint0Maximum = maximumValue(candidate.endpointDisplacements.attack0);
    const endpointEndMaximum = maximumValue(candidate.endpointDisplacements.attackEnd);
    const sampledFourLimbTrajectory = candidate.frames.length > 1 && candidate.frames.every(frame => LIMBS.every(limb => Number.isFinite(frame.limbs?.[limb]?.signedTurnDegrees) && Number.isFinite(frame.limbs?.[limb]?.interiorAngleDegrees)));
    const sideChecks = [
      ['idle0-four-limb-angles-match-source', limbChecks.every(item => item.idleMatches), JSON.stringify(limbChecks.map(({ limb, idleDifferenceDegrees, idleMatches }) => ({ limb, idleDifferenceDegrees, idleMatches })))],
      ['candidate-four-limb-folds-follow-source-idle0-branch', limbChecks.every(item => item.branchMismatchCount === 0), JSON.stringify(limbChecks.map(({ limb, sourceBranch, attackSamples, branchMismatchCount }) => ({ limb, sourceBranch, attackSamples, branchMismatchCount })))],
      ['four-limb-signed-turn-and-interior-trajectories-present', sampledFourLimbTrajectory, `samples=${candidate.frames.length}; each sample stores signed turn and interior angle for all four limbs`],
      ['both-sole-slots-measured', candidate.hasBothSoleSlots === true, `measured=${candidate.hasBothSoleSlots}`],
      ['foot-bones-fixed', candidate.maxFootBoneDrift <= limits.footBoneDrift, `${candidate.maxFootBoneDrift} <= ${limits.footBoneDrift}`],
      ['sole-bounds-fixed', candidate.maxSoleBoundsDriftPx <= limits.soleBoundsDriftPx, `${candidate.maxSoleBoundsDriftPx} <= ${limits.soleBoundsDriftPx}`],
      ['sword-length-stable', candidate.swordLengthRange <= limits.swordLengthRange, `${candidate.swordLengthRange} <= ${limits.swordLengthRange}`],
      ['sword-grip-stable', candidate.gripOffsetRange <= limits.gripOffsetRange && candidate.gripAngleRangeDegrees <= limits.gripAngleRangeDegrees, `relative position ${candidate.gripOffsetRange}; angle ${candidate.gripAngleRangeDegrees}°`],
      ['sword-tip-above-floor', candidate.minSwordTipY >= -1, `floor-relative Y=${candidate.minSwordTipY}; negative means below floor`],
      ['idle0-attack0-joints-continuous', endpoint0Maximum <= limits.rawEndpointDisplacement, `maximum raw endpoint displacement ${endpoint0Maximum} <= ${limits.rawEndpointDisplacement}`],
      ['attack-end-idle0-joints-continuous', endpointEndMaximum <= limits.rawEndpointDisplacement, `maximum raw endpoint displacement ${endpointEndMaximum} <= ${limits.rawEndpointDisplacement}`],
      ['hand-left-slot-attachment-stable', candidate.handLeftAttachment?.stableSingleHandAttachment === true, JSON.stringify(candidate.handLeftAttachment)]
    ];
    checks.push(...sideChecks.map(([id, passed, detail]) => ({ scope: 'candidate', side, id, passed, detail })));
    candidateResults.push({ side, metrics: { maxFootBoneDrift: candidate.maxFootBoneDrift, maxSoleBoundsDriftPx: candidate.maxSoleBoundsDriftPx, swordLengthRange: candidate.swordLengthRange, gripOffsetRange: candidate.gripOffsetRange, gripAngleRangeDegrees: candidate.gripAngleRangeDegrees, minSwordTipY: candidate.minSwordTipY, endpointDisplacements: candidate.endpointDisplacements, handLeftAttachment: candidate.handLeftAttachment }, limbChecks, perLimbComparisons });

    if (side === 'front') {
      const elbowBaseline = {};
      for (const limb of ['arm_l', 'arm_r']) {
        const idle = source.idle0.limbs[limb], attack = source.attack0.limbs[limb];
        const chain = limb === 'arm_l' ? ['upperarm_l', 'forearm_l', 'hand_l'] : ['upperarm_r', 'forearm_r', 'hand_r'];
        const [shoulder, elbow, wrist] = chain.map(name => source.endpointDisplacements.attack0[name]);
        const signedTurnReversed = neutralDirection(idle.signedTurnDegrees) !== 0 && neutralDirection(attack.signedTurnDegrees) === -neutralDirection(idle.signedTurnDegrees);
        const interiorAngleDeltaDegrees = attack.interiorAngleDegrees - idle.interiorAngleDegrees;
        elbowBaseline[limb] = { idle0SignedTurnDegrees: idle.signedTurnDegrees, attack0SignedTurnDegrees: attack.signedTurnDegrees, signedTurnReversed, idle0InteriorAngleDegrees: idle.interiorAngleDegrees, attack0InteriorAngleDegrees: attack.interiorAngleDegrees, interiorAngleDeltaDegrees, interiorAngleNearlyUnchanged: Math.abs(interiorAngleDeltaDegrees) <= 0.1, shoulderDisplacement: shoulder, elbowDisplacement: elbow, wristDisplacement: wrist, shoulderWristNearElbowStable: shoulder < elbow && wrist < elbow && elbow > 0, endpointBones: Object.fromEntries(chain.map(name => [name, { idle0: source.idle0.bones[name], attack0: source.attack0.bones[name], displacement: source.endpointDisplacements.attack0[name] }])) };
      }
      baseline.frontElbows = elbowBaseline;
      baseline.detectsIdle0Attack0ReversalWithStableShoulderWristAndInteriorAngle = Object.values(elbowBaseline).every(item => item.signedTurnReversed && item.shoulderWristNearElbowStable && item.interiorAngleNearlyUnchanged);
    }
  }

  const pageCheck = { scope: 'global', id: 'source-browser-run-had-no-page-errors', passed: sourceReport.errors.length === 0, detail: `${sourceReport.errors.length} recorded page/runtime errors` };
  const interactionCheck = { scope: 'global', id: 'pause-and-drag-seek-operable', passed: sourceReport.interaction?.pauseButtonWorks === true && sourceReport.interaction?.seekControlWorks === true, detail: JSON.stringify(sourceReport.interaction) };
  const candidateFiles = sourceReport.candidateFiles || {};
  const interceptionCheck = { scope: 'global', id: 'front-back-candidate-json-intercepted', passed: Object.keys(candidateFiles).length === 2 && Object.keys(candidateFiles).every(urlPath => sourceReport.candidateInterceptions?.[urlPath] > 0), detail: JSON.stringify(sourceReport.candidateInterceptions) };
  checks.push(pageCheck, interactionCheck, interceptionCheck);

  return {
    analysisMode: 'pure-json-reanalysis',
    analyzedAt: new Date().toISOString(),
    passed: checks.every(check => check.passed),
    checks,
    samplingSource: { sourceReportPath, browserUrl: sourceReport.baseUrl, candidateRoot: sourceReport.candidateRoot, candidateFiles: sourceReport.candidateFiles, candidateInterceptions: sourceReport.candidateInterceptions, startedAt: sourceReport.startedAt, finishedAt: sourceReport.finishedAt, screenshots: sourceReport.screenshots, browserErrors: sourceReport.errors, interaction: sourceReport.interaction },
    previousGate: { gate: 'fold-direction-matches-source-<limb>', outcome: 'excluded-from-pass', reason: 'The prior rule compared candidate Attack delta-from-Idle0 signs against source Attack delta-from-Idle0 signs. Source Attack is itself under repair, so this required the candidate to reproduce the source Attack trajectory. Its observed per-frame differences are retained below as diagnostics.' },
    baselineDiscovery: { sourceFrontIdle0ToAttack0: baseline.frontElbows, detected: baseline.detectsIdle0Attack0ReversalWithStableShoulderWristAndInteriorAngle, interpretation: 'Reports absolute signed-turn reversals for both elbows, stable shoulder/wrist positions, elbow movement, and nearly unchanged interior angles. This is a mechanical baseline finding, not an art judgment.' },
    candidateResults,
    candidateAbsoluteFoldTrajectories: candidateTrajectories,
    priorSourceVsCandidateDeltaDirectionDifferences: previousDeltaDirectionDifferences,
    numericalRules: { branchNeutralEpsilonDegrees: 0.1, endpointDisplacementLimit: staticJointLimit, existingMechanicalLimits: limits },
    notes: ['The 0.1 degree tolerance only treats near-zero signed angles as numerically neutral and compares candidate Idle0 to source Idle0.', 'Candidate Attack absolute signedTurn follows the source Idle0 branch at every recorded sample; source Attack is not used as a direction baseline.', 'No art-quality verdict is produced.']
  };
}

async function reanalyzeJson(sourcePath, outputPath) {
  must(path.isAbsolute(sourcePath) && path.isAbsolute(outputPath), REANALYSIS_USAGE);
  const savedReport = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const sourceReport = savedReport.rawSampling || savedReport;
  const result = analyzeReport(sourceReport, sourcePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ report: outputPath, passed: result.passed, failedChecks: result.checks.filter(check => !check.passed).map(({ scope, side, id, detail }) => ({ scope, side, id, detail })), baselineDetected: result.baselineDiscovery.detected }, null, 2));
  return result;
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
    report.url = pageUrl;
  })();
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Hard deadline reached after ${TIME_LIMIT_MS} ms`)), TIME_LIMIT_MS); });
  try { await Promise.race([work, deadline]); }
  catch (error) { report.errors.push(error.stack || String(error)); report.passed = false; }
  finally {
    clearTimeout(timeout);
    await browser?.close().catch(error => report.errors.push(`browser close: ${error.message}`));
    report.finishedAt = new Date().toISOString();
    const receipt = path.join(outputDir, 'semantic-study.json');
    let finalReport;
    try {
      finalReport = analyzeReport(report, receipt);
      finalReport.samplingSource.finishedAt = report.finishedAt;
      finalReport.rawSampling = structuredClone(report);
    } catch (error) {
      finalReport = { analysisMode: 'browser-run-shared-analysis', passed: false, analyzedAt: new Date().toISOString(), errors: [...report.errors, error.stack || String(error)], failedChecks: [{ scope: 'browser-sampling', id: 'complete-source-and-candidate-samples-required', passed: false, detail: 'Shared analysis could not run because browser sampling failed or required samples were incomplete.' }], samplingSource: { sourceReportPath: receipt, browserUrl: report.baseUrl, candidateRoot: report.candidateRoot, candidateFiles, candidateInterceptions: report.candidateInterceptions, startedAt: report.startedAt, finishedAt: report.finishedAt, screenshots: report.screenshots, browserErrors: report.errors, interaction: report.interaction }, partialResults: report.results };
    }
    fs.writeFileSync(receipt, JSON.stringify(finalReport, null, 2));
    report.passed = finalReport.passed;
    report.finalReport = finalReport;
    console.log(JSON.stringify({ receipt, screenshots: report.screenshots, passed: finalReport.passed, errors: finalReport.errors || finalReport.samplingSource?.browserErrors, failedChecks: finalReport.checks?.filter(check => !check.passed) || finalReport.failedChecks }, null, 2));
  }
  return report.finalReport;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain && !process.env.NODE_TEST_CONTEXT) {
  const args = process.argv.slice(2);
  if (args[0] === '--reanalyze-json') {
    const [sourcePath, outputPath] = args.slice(1);
    if (!sourcePath || !outputPath) { console.error(REANALYSIS_USAGE); process.exitCode = 2; }
    else { const report = await reanalyzeJson(sourcePath, outputPath); if (!report.passed) process.exitCode = 1; }
  } else {
    const [baseUrl, outputDir, candidateRoot] = args;
    if (!baseUrl || !outputDir || !candidateRoot) { console.error(USAGE); process.exitCode = 2; }
    else { const report = await run(baseUrl, outputDir, candidateRoot); if (!report.passed) process.exitCode = 1; }
  }
}
