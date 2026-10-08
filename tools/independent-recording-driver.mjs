#!/usr/bin/env node
// Real UI-only 14-round playthrough for the independent game recorder.
// Read-only session GETs choose among visible options; all gameplay input is sent as browser clicks/drags.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import { startServer } from '../server/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chessCatalog = JSON.parse(await fs.readFile(path.join(repo, 'data/chess.json'), 'utf8'));
const canonical = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const runtime = path.join(canonical, 'runtime/growth-destination-20261008/recording');
const tmp = path.join(canonical, '.omni/tmp/growth-destination-20261008/recording');
const output = path.resolve(process.env.SP_RECORD_DRIVER_OUTPUT || path.join(runtime, 'driver-run'));
const runLog = path.join(tmp, `independent-recording-driver-${path.basename(output)}.log`);
const processStartedAt = Date.now();
const defaultHardLimitMs = process.env.SP_RECORD_DRIVER_PREP_ONLY === '1' ? 3 * 60 * 1000 : 30 * 60 * 1000;
const requestedHardLimitMs = Number(process.env.SP_RECORD_DRIVER_HARD_TIMEOUT_MS || defaultHardLimitMs);
const hardLimitMs = Number.isFinite(requestedHardLimitMs) && requestedHardLimitMs > 0
  ? Math.max(60 * 1000, Math.min(60 * 60 * 1000, requestedHardLimitMs)) : defaultHardLimitMs;
const maxRounds = Math.max(1, Math.min(14, Number(process.env.SP_RECORD_DRIVER_MAX_ROUNDS || 14)));
const seed = Number.isSafeInteger(Number(process.env.SP_RECORD_DRIVER_SEED))
  ? Math.trunc(Number(process.env.SP_RECORD_DRIVER_SEED)) : Math.floor(Math.random() * 2 ** 31);
const chromePath = process.env.SP_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(path.join(repo, 'package.json'));
const puppeteer = require('puppeteer-core');
const { mkdir, writeFile } = fs;
const report = {
  seed, maxRounds, startedAt: new Date(processStartedAt).toISOString(), hardLimitMs, baseCommit: process.env.SP_RECORD_DRIVER_BASE_COMMIT || null,
  actions: [], notes: [], rounds: [], screenshots: [], errors: [], pageErrors: [], preparationSnapshots: [],
  interactionPolicy: 'UI clicks and pointer drags only; state reads use GET; no action API or state injection.',
};
let server; let assetProxy; let browser; let page; let hardTimer; let recordingId = ''; let sessionId = '';
const pendingActionRequests = new WeakMap();

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (s) => String(s || 'state').normalize('NFKD').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 42) || 'state';
async function screenshot(name) {
  const file = path.join(output, `${String(report.screenshots.length + 1).padStart(3, '0')}-${slug(name)}.png`);
  await page.screenshot({ path: file }); report.screenshots.push(file); return file;
}
async function visibleText(selector) {
  return page.$$eval(selector, (els) => els.filter((e) => e.getClientRects().length).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()));
}
async function clickText(selector, predicate, { nth = 0 } = {}) {
  const els = await page.$$(selector); const found = [];
  for (const el of els) {
    if (!(await el.evaluate((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'))) continue;
    const text = await el.evaluate((e) => (e.innerText || e.getAttribute('aria-label') || '').trim());
    if (predicate(text)) found.push(el);
  }
  if (!found[nth]) return false;
  await found[nth].click(); return true;
}
async function readState() {
  return page.evaluate(async (id) => {
    const r = await fetch(`/independent/api/sessions/${encodeURIComponent(id)}?catalog=0`, { credentials: 'same-origin', cache: 'no-store' });
    const packet = await r.json(); if (!r.ok || !packet.ok) throw new Error(`state GET failed: ${r.status}`);
    return packet.state;
  }, sessionId);
}
async function readRecording() {
  if (!recordingId) return null;
  return page.evaluate(async (id) => {
    const r = await fetch(`/independent/api/recordings/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return null; return r.json();
  }, recordingId);
}
async function verifyNarratedReplay(recording) {
  const meta = recording?.meta;
  const cue = (recording?.events || []).find((event) => event.kind === 'caption' && event.p?.key === 'first-native-mechanic');
  if (!meta?.endedAt || !cue?.ts) throw new Error('录制结束或首次干员机制讲解字幕缺失，无法验收回放');
  const cueSecond = Math.max(0, (cue.ts - Date.parse(meta.startedAt)) / 1000);
  const replayUrl = new URL(`/independent-replay.html?recording=${encodeURIComponent(recordingId)}`, page.url()).href;
  await page.goto(replayUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === '记录已结束', { timeout: 45000 });
  await page.evaluate((second) => {
    const timeline = document.querySelector('#timeline'); timeline.value = String(second + 0.05);
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
  }, cueSecond);
  await page.waitForFunction((second) => Math.abs(Number(document.querySelector('#timeline')?.value) - second) < 0.25, { timeout: 15000 }, cueSecond + 0.05);
  await page.click('#play');
  await page.waitForFunction((expected) => {
    const caption = document.querySelector('#caption'); const stage = document.querySelector('#stage');
    return caption && !caption.hidden && caption.textContent === expected && document.querySelector('#play')?.textContent === '播放' && /scale\(/.test(stage?.style.transform || '');
  }, { timeout: 8000 }, cue.p.text);
  const visibleProof = await page.evaluate(() => {
    const iframe = document.querySelector('#stage iframe'); const doc = iframe?.contentDocument;
    const detail = doc?.querySelector('[data-testid="ix-detail"]'); const card = detail?.querySelector('.ix-original-card');
    const video = document.querySelector('#stage video[data-sp-canvas-media]');
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
    };
    const text = card?.innerText?.trim() || '';
    return {
      caption: document.querySelector('#caption')?.textContent || '',
      playbackPaused: document.querySelector('#play')?.textContent === '播放',
      zoomTransform: document.querySelector('#stage')?.style.transform || '',
      iframeVisible: visible(iframe), detailVisible: visible(detail), cardVisible: visible(card),
      cardText: text, ordinaryFullText: /普通[\s\S]{5,}/.test(text), eliteFullText: /精锐[\s\S]{5,}/.test(text),
      webglMediaVisible: visible(video), mediaReadyState: video?.readyState ?? 0,
      canvasWidth: video?.videoWidth ?? 0, canvasHeight: video?.videoHeight ?? 0,
      stageText: doc?.body?.innerText?.slice(0, 1200) || '',
    };
  });
  const proofFile = await screenshot('replay-first-mechanic-paused-zoomed');
  const result = { cueSecond, proofFile, ...visibleProof };
  await writeFile(path.join(output, 'replay-visual-proof.json'), JSON.stringify(result, null, 2));
  if (!result.playbackPaused || !result.zoomTransform || !result.iframeVisible || !result.detailVisible || !result.cardVisible || !result.ordinaryFullText || !result.eliteFullText || !result.webglMediaVisible || result.mediaReadyState < 2 || !result.canvasWidth || !result.canvasHeight) {
    throw new Error(`回放字幕/原卡/HUD/WebGL像素的同帧可见性验收失败：${JSON.stringify(result)}`);
  }
  return result;
}
async function waitRevision(revision) {
  await page.waitForFunction(async (id, old) => {
    try { const r = await fetch(`/independent/api/sessions/${encodeURIComponent(id)}?catalog=0`, { cache: 'no-store' }); const p = await r.json(); return p.ok && p.state.revision > old; }
    catch { return false; }
  }, { timeout: 20000 }, sessionId, revision);
}
async function note(text, selector, key) {
  if (report.notes.some((n) => n.key === key)) return;
  await page.evaluate(({ text, selector, key }) => globalThis.__SP_RECORD_NOTE__?.(text, selector, key), { text, selector, key });
  report.notes.push({ key, text, selector, at: new Date().toISOString() });
}
function pieceNumber(uid) { const n = Number(String(uid).replace(/^\D+/, '')); return Number.isInteger(n) ? n : NaN; }
function pieceGrowthLevel(piece) { return Number(piece?.growthLevel ?? piece?.level ?? 0); }
function tileTuple(value) {
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]), Number(value[1])];
  if (typeof value === 'string') return value.split(',').map(Number);
  return null;
}
async function piecePoint(piece, state = null) {
  let row = piece.row; let col = piece.col;
  if (!Number.isInteger(row)) {
    if (piece.temp) {
      const temp = (state?.pieces || []).filter((p) => p.temp).sort((a, b) => pieceNumber(a.uid) - pieceNumber(b.uid));
      row = 8; col = 4 + temp.findIndex((p) => p.uid === piece.uid);
    } else {
      const hand = (state?.pieces || []).filter((p) => !Number.isInteger(p.row) && !p.temp).sort((a, b) => pieceNumber(a.uid) - pieceNumber(b.uid));
      row = 7; col = hand.findIndex((p) => p.uid === piece.uid);
    }
  }
  if (!Number.isInteger(row) || !Number.isInteger(col) || col < 0) return null;
  return page.evaluate(([r, c]) => {
    const t = globalThis.__SP_VIEW__?.tileScreen?.(r, c);
    return t ? { x: t.x, y: t.y + t.s * 0.25, tile: t } : null;
  }, [row, col]);
}
async function tilePoint(row, col) {
  return page.evaluate(([r, c]) => {
    const t = globalThis.__SP_VIEW__?.tileScreen?.(r, c); if (!t) return null;
    return { x: t.x, y: t.y + t.s * 0.25, tile: t };
  }, [row, col]);
}
async function dragPointer(from, to, onTarget) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let i = 1; i <= 16; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16);
    await pause(40);
  }
  if (onTarget) await onTarget();
  await page.mouse.up();
}
async function deployPiece(state, piece) {
  const failure = { uid: piece.uid, name: piece.name, row: piece.row ?? null, col: piece.col ?? null,
    legalTiles: piece.legalTiles || [], attempts: [], revision: state.revision, funds: state.funds };
  const from = await piecePoint(piece, state);
  if (!from) { failure.reason = 'hand geometry unavailable'; report.deployFailures ||= []; report.deployFailures.push(failure); return false; }
  const occupied = new Set((state.pieces || []).filter((p) => Number.isInteger(p.row) && Number.isInteger(p.col)).map((p) => `${p.row},${p.col}`));
  const legal = (piece.legalTiles || []).map(tileTuple).filter((t) => t && t.every(Number.isFinite) && !occupied.has(`${t[0]},${t[1]}`));
  const candidates = [];
  for (const [row, col] of legal) { const p = await tilePoint(row, col); if (p) candidates.push({ row, col, ...p }); }
  candidates.sort((a, b) => Math.abs(a.row - 10) - Math.abs(b.row - 10) || Math.abs(a.col - 7) - Math.abs(b.col - 7));
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  failure.from = from; failure.occupied = [...occupied]; failure.candidates = candidates.map(({ row, col, x, y }) => ({ row, col, x, y })); failure.viewport = viewport;
  for (const target of candidates.filter((p) => p.x >= 0 && p.x < viewport.width && p.y >= 0 && p.y < viewport.height)) {
    await dragPointer(from, target);
    const diagnostic = await page.evaluate(({ from, target, legalCount }) => {
      const describe = (x, y) => {
        const e = document.elementFromPoint(x, y);
        return e ? { tag: e.tagName, id: e.id, className: typeof e.className === 'string' ? e.className : '', text: (e.innerText || e.getAttribute('aria-label') || '').slice(0, 160), html: e.outerHTML.slice(0, 800) } : null;
      };
      return {
        from: { x: from.x, y: from.y }, to: { x: target.x, y: target.y }, row: target.row, col: target.col, legalTiles: legalCount,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        elementFromPoint: { from: describe(from.x, from.y), to: describe(target.x, target.y) },
        wheelVisible: !!document.querySelector('.fwheel[role="dialog"]'),
      };
    }, { from, target, legalCount: legal.length });
    if (!report.firstDeployDiagnostic) {
      report.firstDeployDiagnostic = { ...diagnostic, screenshot: await screenshot('first-deploy-after-drop') };
      await writeFile(path.join(output, 'first-deploy-diagnostic.json'), JSON.stringify(report.firstDeployDiagnostic, null, 2));
    }
    try { await page.waitForSelector('.fwheel[role="dialog"]', { timeout: 1200 }); } catch { continue; }
    if (report.firstDeployDiagnostic?.row === target.row && report.firstDeployDiagnostic?.col === target.col) {
      report.firstDeployDiagnostic.wheelVisibleAfterWait = true;
      await writeFile(path.join(output, 'first-deploy-diagnostic.json'), JSON.stringify(report.firstDeployDiagnostic, null, 2));
    }
    // Choose the visible right-facing arrow with a real pointer click, using the rendered wheel geometry.
    const facingTarget = await page.$eval('.fwheel__dia', (e) => {
      const r = e.getBoundingClientRect();
      return { start: { x: r.left + r.width * 0.78, y: r.top + r.height * 0.5 }, target: { x: r.left + r.width * 0.84, y: r.top + r.height * 0.5 }, width: r.width, height: r.height };
    });
    const facingHit = await page.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      return { tag: e?.tagName || '', className: typeof e?.className === 'string' ? e.className : '', wheel: !!e?.closest?.('.fwheel') };
    }, facingTarget.start);
    if (!facingHit.wheel || /cancel/i.test(facingHit.className)) throw new Error(`朝向拖动起点未命中轮盘扇区：${JSON.stringify({ facingTarget, facingHit })}`);
    // Press in the visible right sector, outside both the center dead-zone and the cancel tag.
    // Wait for the direction preview to render before the small outward move and release.
    await page.evaluate(() => {
      const wheel = document.querySelector('.fwheel'); window.__spFacingTrace = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) wheel?.addEventListener(type, (e) => {
        window.__spFacingTrace.push({ type, x: e.clientX, y: e.clientY, buttons: e.buttons, pointerId: e.pointerId, target: e.target?.className?.baseVal || e.target?.className || e.target?.tagName || '', defaultPrevented: e.defaultPrevented });
      }, true);
    });
    await page.mouse.move(facingTarget.start.x, facingTarget.start.y); await page.mouse.down(); await pause(150);
    await page.mouse.move(facingTarget.target.x, facingTarget.target.y); await pause(100);
    await (async () => {
      if (!report.facingPreviewScreenshot) {
        report.facingPreview = await page.$eval('.fwheel__sr', (e) => e.innerText).catch(() => '');
        report.facingPreviewScreenshot = await screenshot('facing-wheel-right-preview');
      }
    })();
    await page.mouse.up();
    const pointerTrace = await page.evaluate(() => window.__spFacingTrace || []);
    try { await page.waitForSelector('.fwheel[role="dialog"]', { hidden: true, timeout: 10000 }); } catch { /* preserve the diagnostic and continue to state verification */ }
    await pause(500);
    const after = await readState();
    if ((after.pieces || []).some((p) => p.uid === piece.uid && Number.isInteger(p.row))) {
      report.actions.push({ type: 'deploy', uid: piece.uid, row: target.row, col: target.col, input: 'pointer drag + facing-wheel click' });
      return true;
    }
    failure.attempts.push({ row: target.row, col: target.col, wheelVisible: !!(await page.$('.fwheel[role="dialog"]')),
      revisionAfter: after.revision, movedPiece: (after.pieces || []).find((p) => p.uid === piece.uid)?.row ?? null,
      readyReason: (await visibleText('[data-testid="ready-why"]')).join(' '),
      gameToasts: (await visibleText('.toast-host, .toast__text')).join(' '), facingTarget, facingHit, pointerTrace });
    state = after;
  }
  failure.reason = failure.legalTiles.length ? 'all rendered legal positions rejected' : 'server supplied no legal tiles for this bench piece';
  failure.screenshot = await screenshot(`deploy-failed-${piece.uid}`);
  report.deployFailures ||= []; report.deployFailures.push(failure);
  return false;
}
async function annotateObservedChanges(before, after) {
  const oldByUid = new Map((before?.pieces || []).map((p) => [p.uid, p]));
  for (const piece of after?.pieces || []) {
    const old = oldByUid.get(piece.uid);
    if (old && (old.equipment || []).length < (piece.equipment || []).length) {
      await note('装备与徽章会把可见属性转化为实际战力，干员的详情卡记录了当前配置。', '.ix-dpanel, .ix-strip', 'equipment-growth');
    }
    if (old && (old.attachments || []).length < (piece.attachments || []).length) {
      await note('这项战备效果会持续跟随干员，直到本局结束。', '.ix-dpanel, .ix-effects', 'permanent-attachment');
    }
    if (old && pieceGrowthLevel(old) !== pieceGrowthLevel(piece) && pieceGrowthLevel(piece) > pieceGrowthLevel(old)) {
      await note('干员在本局中继续成长，等级会带来持续的属性变化。', '.ix-dpanel, .ix-effects', 'operator-level-growth');
    }
  }
  if (JSON.stringify(before?.playerEffects || []) !== JSON.stringify(after?.playerEffects || [])) {
    const effectRows = after?.playerEffects || [];
    const hasTimed = effectRows.some((x) => x?.expiresRound || x?.untilRound || x?.duration || x?.temporary);
    const hasPersistent = effectRows.some((x) => x?.permanent || x?.term === 'permanent' || x?.duration === 'run');
    const label = hasTimed && hasPersistent ? '有些强化只在有限时间内生效，有些则会贯穿整局；当前效果栏列出了它们。'
      : hasTimed ? '这项临时强化会在对应时限内帮助队伍。'
        : '新的强化已加入本局效果栏，可从这里查看它影响的对象。';
    await note(label, '.ix-effects, .ix-prod', `effect-change-${after?.round || 'run'}`);
  }
  if ((before?.pieces || []).length > (after?.pieces || []).length || (before?.pieces || []).some((p) => !p.elite && after?.pieces?.some((n) => n.uid === p.uid && n.elite))) {
    await note('相同干员合成后会晋升精锐，保留可选的装备并获得更强形态。', '.ix-offer, .ix-dpanel', 'promotion-merge');
  }
}
async function resolveOffer(round) {
  const dialog = await page.$('.ix-offer[role="dialog"]'); if (!dialog) return false;
  const text = await dialog.evaluate((e) => (e.innerText || '').trim());
  await screenshot(`round-${round}-choice-${text.split('\n').slice(0, 2).join('-')}`);
  await note('先读完选项上的效果与干员特质，再作出本轮选择。', '.ix-offer', `choice-profile-${round}`);
  const picks = await page.$$('.ix-offer .ix-choice');
  if (picks.length) {
    const ranks = await Promise.all(picks.map((el) => el.evaluate((e) => {
      const s = `${e.innerText || ''} ${e.getAttribute('aria-label') || ''}`;
      const words = ['永久', '装备', '招募', '生命', '攻击', '徽章', '免费', '精锐', '发现', '治疗'];
      return { text: s, score: words.reduce((n, w, i) => n + (s.includes(w) ? 10 - i * 0.1 : 0), 0) };
    })));
    let best = 0; for (let i = 1; i < ranks.length; i++) if (ranks[i].score > ranks[best].score) best = i;
    await picks[best].click(); report.actions.push({ type: 'choose-visible-card', text: ranks[best].text.slice(0, 240) }); await pause(350);
    if (await page.$('.ix-offer[role="dialog"]')) return true;
  }
  const radios = await page.$$('.ix-offer input[type="radio"]');
  for (const radio of radios) await radio.click();
  const finalPick = await clickText('.ix-offer button', (s) => /^(晋升|确认(?:（|目标)|消耗合体)/.test(s));
  if (finalPick) { report.actions.push({ type: 'confirm-visible-choice' }); await pause(350); return true; }
  const buttons = await page.$$('.ix-offer button');
  const buttonTexts = await Promise.all(buttons.map((e) => e.evaluate((x) => (x.innerText || '').trim())));
  const candidate = buttons.findIndex((_, i) => /^(晋升|确认|选择|返回|取消)/.test(buttonTexts[i]));
  if (candidate >= 0) { await buttons[candidate].click(); report.actions.push({ type: 'resolve-visible-choice', text: buttonTexts[candidate] }); await pause(350); return true; }
  return false;
}
async function equipVisibleItem(state) {
  const deployed = (state.pieces || []).filter((p) => Number.isInteger(p.row)); if (!deployed.length) return false;
  const buttons = await page.$$('[data-testid^="ix-tile-"]'); if (!buttons.length) return false;
  const target = deployed.sort((a, b) => pieceGrowthLevel(b) - pieceGrowthLevel(a))[0];
  const to = await piecePoint(target, state); if (!to) return false;
  const before = state.revision;
  for (const button of buttons) {
    const label = await button.evaluate((e) => `${e.getAttribute('aria-label') || ''} ${e.innerText || ''}`);
    if (/奖品/.test(label)) continue;
    const rect = await button.evaluate((e) => e.getBoundingClientRect().toJSON());
    if (!rect.width || !rect.height) continue;
    await dragPointer({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, to);
    await pause(700);
    const after = await readState();
    if (after.revision > before) {
      report.actions.push({ type: 'equip-or-use-by-drag', target: target.uid, itemLabel: label.slice(0, 120), input: 'inventory tile pointer drag' });
      await annotateObservedChanges(state, after); return true;
    }
  }
  return false;
}
async function buyOne(state, { triplesOnly = false } = {}) {
  const deployed = (state.pieces || []).filter((p) => Number.isInteger(p.row)).length;
  const roster = (state.pieces || []).filter((p) => !p.temp);
  const reserve = roster.length >= 4 && deployed > 0 && Number(state.shop?.level) < 6 ? Number(state.shop?.upgradePrice || 0) + 3 : 0;
  const counts = new Map(); for (const p of state.pieces || []) counts.set(p.chessId, (counts.get(p.chessId) || 0) + 1);
  const viable = (state.shop?.slots || []).map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'chess' && !s.sold && s.id && Number(s.price) <= Number(state.funds) - reserve && (!triplesOnly || counts.get(s.id) === 2));
  const roleCounts = roster.reduce((out, p) => {
    const card = chessCatalog[p.chessId] || {};
    if (card.profession === 'MEDIC') out.medic += 1;
    if (card.position === 'MELEE') out.melee += 1;
    if (card.position === 'RANGED') out.ranged += 1;
    return out;
  }, { medic: 0, melee: 0, ranged: 0 });
  viable.sort((a, b) => {
    const ca = counts.get(a.s.id) || 0, cb = counts.get(b.s.id) || 0;
    const score = ({ s }, duplicateCount) => {
      const card = chessCatalog[s.id] || {};
      let value = 0;
      if (!roleCounts.medic && card.profession === 'MEDIC') value += 100;
      if (roleCounts.melee < 2 && card.position === 'MELEE') value += 60;
      if (roleCounts.ranged < 2 && card.position === 'RANGED') value += 50;
      if (roster.length < 4 && duplicateCount === 0) value += 24;
      if (roster.length >= 4 && duplicateCount === 2) value += 40;
      const currentTier = Number(state.shop?.level) || 1;
      if (currentTier >= 4 && Number(card.tier) >= 4) value += 30;
      const sharedBonds = new Set(roster.flatMap((p) => chessCatalog[p.chessId]?.bonds || []));
      value += (card.bonds || []).filter((bond) => sharedBonds.has(bond)).length * 4;
      return value;
    };
    return score(b, cb) - score(a, ca) || a.s.price - b.s.price || a.i - b.i;
  });
  for (const { s, i } of viable) {
    const card = await page.$(`[data-testid="ix-shop-${i}"]`); if (!card) continue;
    const before = state.revision;
    await card.click();
    try { await page.waitForSelector('[data-testid="ix-detail"]', { timeout: 3000 }); } catch { continue; }
    const buyClicked = await clickText('[data-testid="ix-detail"] button', (t) => /^购买(?:\s|·)/.test(t));
    if (!buyClicked) { await clickText('[data-testid="ix-detail"] button', (t) => t === '关闭'); continue; }
    if (await page.$('.ix-buy-targets')) {
      const choices = await page.$$('.ix-buy-targets__choice[aria-pressed="false"]'); if (choices.length) await choices[0].click();
      await clickText('.ix-buy-targets__actions button', (t) => /确认目标|消耗合体/.test(t));
    }
    try { await waitRevision(before); } catch { await clickText('[data-testid="ix-detail"] button', (t) => t === '关闭'); continue; }
    report.actions.push({ type: 'buy-operator', slot: i, name: await card.evaluate((e) => e.innerText.trim()) });
    const next = await readState(); await annotateObservedChanges(state, next); await pause(500); return true;
  }
  return false;
}
function roleCountsOf(pieces) {
  return (pieces || []).filter((p) => !p.temp).reduce((out, p) => {
    const card = chessCatalog[p.chessId] || {};
    if (card.profession === 'MEDIC') out.medic += 1;
    if (card.position === 'MELEE') out.melee += 1;
    if (card.position === 'RANGED') out.ranged += 1;
    return out;
  }, { medic: 0, melee: 0, ranged: 0 });
}
function highTierReplacement(state) {
  if (Number(state.shop?.level) < 4) return null;
  const roster = (state.pieces || []).filter((p) => !p.temp);
  const roles = roleCountsOf(roster);
  const counts = new Map(); for (const p of roster) counts.set(p.chessId, (counts.get(p.chessId) || 0) + 1);
  const candidates = (state.shop?.slots || []).map((slot, index) => ({ slot, index, card: chessCatalog[slot.id] || {} }))
    .filter(({ slot, card }) => slot.kind === 'chess' && !slot.sold && slot.id && Number(slot.price) <= Number(state.funds) && Number(card.tier) >= 4 && counts.get(slot.id) !== 2)
    .sort((a, b) => Number(b.card.tier) - Number(a.card.tier) || a.slot.price - b.slot.price || a.index - b.index);
  const replacements = [];
  for (const candidate of candidates) for (const piece of roster) {
    if ((piece.equipment || []).length || piece.elite || pieceGrowthLevel(piece) > 0) continue;
    const current = chessCatalog[piece.chessId] || {};
    if (Number(candidate.card.tier) <= Number(current.tier || 0)) continue;
    if (current.profession === 'MEDIC' && roles.medic <= 1) continue;
    if (current.position === 'MELEE' && roles.melee <= 2) continue;
    if (current.position === 'RANGED' && roles.ranged <= 2) continue;
    replacements.push({ candidate, piece, gap: Number(candidate.card.tier) - Number(current.tier || 0) });
  }
  replacements.sort((a, b) => b.gap - a.gap || Number(a.candidate.card.tier) - Number(b.candidate.card.tier) || pieceGrowthLevel(a.piece) - pieceGrowthLevel(b.piece));
  return replacements[0] || null;
}
async function sellForHighTierReplacement(state, replacement) {
  const { candidate, piece } = replacement;
  const bounds = await page.evaluate((n) => globalThis.__SP_VIEW__?.pieceScreenRect?.(n) || null, pieceNumber(piece.uid));
  if (!bounds?.width || !bounds?.height) return false;
  await page.mouse.click(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); await pause(350);
  if (!await page.$eval('[data-testid="ix-detail"]', (e, name) => (e.innerText || '').includes(name), piece.name).catch(() => false)) return false;
  const before = state.revision;
  if (!await clickText('[data-testid="ix-detail"] button', (text) => /^出售\s*\+/.test(text))) return false;
  if (!await clickText('[data-testid="ix-detail"] button', (text) => /^确认出售\s*\+/.test(text))) return false;
  try { await waitRevision(before); } catch { return false; }
  const next = await readState();
  if ((next.pieces || []).some((p) => p.uid === piece.uid)) return false;
  report.actions.push({ type: 'sell-for-high-tier-replacement', unit: piece.name, replacement: chessCatalog[candidate.slot.id]?.name || candidate.slot.id, tier: candidate.card.tier });
  await annotateObservedChanges(state, next);
  await note('酒馆等级提高后，队伍用更高阶干员替换较弱战力，并保留了现有的支援与前线配合。', '[data-testid="ix-ready"]', 'high-tier-replacement');
  await pause(350); return true;
}
async function maybeUpgrade(state) {
  if ((state.pieces || []).filter((p) => !p.temp).length < 4 || state.shop?.level >= 6 || state.funds < Number(state.shop?.upgradePrice) + 3) return false;
  const button = await page.$('[data-testid="ix-upgrade"]'); if (!button) return false;
  const before = state.revision; await button.click(); await pause(200); await button.click();
  try { await waitRevision(before); } catch { return false; }
  const next = await readState(); report.actions.push({ type: 'upgrade-dispatch' }); await annotateObservedChanges(state, next); return true;
}
async function triggerRefresh(state) {
  if ((state.pieces || []).filter((p) => !p.temp).length < 4) return false;
  const button = await page.$('.ix-shop button[title^="刷新商店"]'); if (!button || await button.evaluate((e) => e.disabled)) return false;
  await button.click(); report.actions.push({ type: 'refresh-shop' }); await pause(600); return true;
}
async function attemptHandover(state) {
  if (report.notes.some((n) => n.key === 'handover-transfer')) return false;
  const pieces = state.pieces || [];
  const pair = pieces.flatMap((donor) => (donor.handover?.give || []).map((uid) => ({ donor, receiver: pieces.find((p) => p.uid === uid) })))
    .find((x) => x.receiver && (x.donor.equipment || []).length && !x.donor.temp && !x.receiver.temp);
  if (!pair) return false;
  const donorPoint = await piecePoint(pair.donor, state); if (!donorPoint) return false;
  await page.mouse.click(donorPoint.x, donorPoint.y); await pause(300);
  if (!await clickText('[data-testid="ix-detail"] button', (s) => s === '交接')) return false;
  await page.waitForSelector('.ix-inherit', { timeout: 5000 });
  const recipients = await page.$$('.ix-inherit [data-uid]');
  let actualRecipient = null;
  for (const el of recipients) if (await el.evaluate((e) => e.dataset.uid) === pair.receiver.uid) { actualRecipient = el; break; }
  if (!actualRecipient) { await page.keyboard.press('Escape'); return false; }
  await actualRecipient.click(); await pause(500);
  const modal = await page.$('.ix-inherit'); if (!modal) return false;
  await screenshot('handover-preview');
  const ok = await clickText('.ix-inherit button', (s) => s === '确认交接');
  if (!ok) { await page.keyboard.press('Escape'); return false; }
  await note('交接会把一名干员的装备移交给有凭证的队友，并预先展示属性变化与损耗。', '.ix-inherit', 'handover-transfer');
  await pause(800); report.actions.push({ type: 'inherit-through-visible-preview', donor: pair.donor.uid, receiver: pair.receiver.uid }); return true;
}
async function inspectReferenceCard(piece, kind) {
  if (!piece || report.references?.some((x) => x.kind === kind) || report.referenceAttempts?.[kind]) return false;
  report.referenceAttempts ||= {}; report.referenceAttempts[kind] = new Date().toISOString();
  const diagnoseFailure = async (reason) => {
    const detail = await page.$('[data-testid="ix-detail"]');
    const evidence = detail ? await detail.evaluate((e) => ({
      text: (e.innerText || '').slice(0, 5000),
      tabs: [...e.querySelectorAll('[role="tab"]')].map((tab) => ({ text: (tab.innerText || '').trim(), selected: tab.getAttribute('aria-selected') })),
    })) : { text: '', tabs: [] };
    const failure = { kind, uid: piece.uid, reason, ...evidence, at: new Date().toISOString() };
    report.referenceFailures ||= []; report.referenceFailures.push(failure);
    failure.screenshot = await screenshot(`reference-${kind}-diagnostic`);
    await writeFile(path.join(output, `reference-${kind}-diagnostic.json`), JSON.stringify(failure, null, 2));
    if (detail) await page.keyboard.press('Escape');
    return false;
  };
  // Click the center of the visible rendered sprite; tileScreen points at the board tile and can land below the art.
  const bounds = await page.evaluate((n) => globalThis.__SP_VIEW__?.pieceScreenRect?.(n) || null, pieceNumber(piece.uid));
  if (!bounds?.width || !bounds?.height) return diagnoseFailure('干员画面范围不可用');
  await page.mouse.click(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); await pause(400);
  const correctDetailOpen = async () => page.$eval('[data-testid="ix-detail"]', (e, name) => (e.innerText || '').includes(name), piece.name).catch(() => false);
  if (!await correctDetailOpen()) {
    // Fallback to the same visible, copyable component route used by the game's own links.
    await page.evaluate((uid) => { location.hash = `piece-${uid}`; }, piece.uid);
    try { await page.waitForFunction((name) => {
      const detail = document.querySelector('[data-testid="ix-detail"]'); return !!detail && (detail.innerText || '').includes(name);
    }, { timeout: 5000 }, piece.name); }
    catch { return diagnoseFailure('可见点击先打开了其它面板，组件链接也未定位到目标干员'); }
  }
  const tabs = await page.$$('[data-testid="ix-detail"] [role="tab"]');
  for (const tab of tabs) {
    if (await tab.evaluate((e) => (e.innerText || '').trim() === '特质')) {
      if (await tab.evaluate((e) => e.getAttribute('aria-selected') !== 'true')) await tab.click();
      break;
    }
  }
  const summary = await page.$('[data-testid="ix-detail"] .ix-original-card summary');
  if (!summary) return diagnoseFailure('原卡内容在可见详情中不可用');
  const opened = await summary.evaluate((e) => e.parentElement.open); if (!opened) await summary.click();
  await pause(300);
  const text = await page.$eval('[data-testid="ix-detail"] .ix-original-card', (e) => e.innerText.trim());
  const evidence = { kind, uid: piece.uid, visibleText: text, ordinaryTextVisible: /普通[\s\S]{5,}/.test(text), eliteTextVisible: /精锐[\s\S]{5,}/.test(text) };
  report.references ||= []; report.references.push(evidence);
  await screenshot(`${kind}-original-card`);
  await note(kind === 'elite' ? '精锐形态会展示对应的完整卡面文字，方便核对强化后的能力。' : '这里展示对应炉石原卡的普通与金色效果，可对照卫戍特质的转换。', '.ix-original-card', `${kind}-original-reference`);
  if (kind === 'ordinary' && piece.nativeTrait) {
    const trait = String(piece.nativeTrait).replace(/\s+/g, ' ').trim();
    const explanation = /退场时召唤/.test(trait)
      ? `${piece.name}退场时会召唤作战支援单位；对应原卡的亡语会成为战场增援。`
      : /回合开始/.test(trait)
        ? `${piece.name}的特质会在回合开始时生效，持续留场就能逐轮发挥。`
        : `${piece.name}的特质会这样生效：${trait}`;
    await note(explanation, '[data-testid="ix-detail"]', 'first-native-mechanic');
  }
  if (!await clickText('[data-testid="ix-detail"] button', (s) => s === '关闭')) await page.keyboard.press('Escape');
  return true;
}
async function waitBattleResult(round) {
  const speed = await page.$$('[data-testid="ix-battlebar"] button');
  for (const el of speed) if ((await el.evaluate((e) => (e.innerText || '').trim())) === '4×') await el.click();
  await screenshot(`round-${round}-battle`);
  try { await page.waitForSelector('[data-testid="ix-result-ok"]', { timeout: 180000 }); }
  catch {
    const skip = await page.$('[data-testid="ix-skip"]'); if (skip && !(await skip.evaluate((e) => e.disabled))) await skip.click();
    await page.waitForSelector('[data-testid="ix-result-ok"]', { timeout: 30000 });
  }
  const summary = await page.$eval('[data-testid="ix-result-ok"]', (e) => ({ button: e.innerText.trim(), title: e.closest('[role="dialog"]')?.innerText?.slice(0, 1000) || document.querySelector('#app')?.innerText?.slice(-1200) || '' }));
  await screenshot(`round-${round}-result`); report.rounds.push({ round, result: summary });
  await page.click('[data-testid="ix-result-ok"]'); await pause(500);
  if (summary.button === '查看结算') { await screenshot('terminal-result'); }
}
async function stopRecording() {
  report.recordingControlBeforeStop = await page.evaluate(() => {
    const panel = document.querySelector('.ix-recording'); const button = panel?.querySelector('button');
    const rect = (node) => { const r = node?.getBoundingClientRect(); return r ? r.toJSON() : null; };
    const style = (node) => node ? Object.fromEntries(['display', 'visibility', 'opacity', 'position', 'zIndex', 'pointerEvents', 'clipPath'].map((k) => [k, getComputedStyle(node)[k]])) : null;
    const b = button && rect(button); const at = b && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { exists: !!panel, text: panel?.innerText || '', panelRect: rect(panel), panelStyle: style(panel), buttonText: button?.innerText || '', buttonRect: b,
      buttonStyle: style(button), centerHit: at ? { tag: at.tagName, className: typeof at.className === 'string' ? at.className : '', text: (at.innerText || '').slice(0, 120) } : null };
  });
  await writeFile(path.join(output, 'recording-control-diagnostic.json'), JSON.stringify(report.recordingControlBeforeStop, null, 2));
  const stopDeadline = Math.min(Date.now() + 6 * 60 * 1000, processStartedAt + hardLimitMs);
  let attempts = 0;
  while (Date.now() < stopDeadline) {
    const panelText = await page.$eval('.ix-recording', (e) => e.innerText).catch(() => '');
    if (/录制已结束/.test(panelText)) { report.recordingStopAttempts = attempts; delete report.recordingStopError; return; }
    const button = await page.$('.ix-recording button');
    const available = button && await button.evaluate((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.disabled);
    if (!available) { await pause(1000); continue; }
    attempts += 1; await button.click();
    try { await page.waitForFunction(() => /录制已结束/.test(document.querySelector('.ix-recording')?.innerText || ''), { timeout: 10000 }); }
    catch { await pause(1500); }
  }
  report.recordingStopAttempts = attempts;
  report.recordingStopError = await page.$eval('.ix-recording', (e) => e.innerText).catch(() => 'Recorder panel disappeared before completion');
}
const mime = (file) => ({ '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf', '.skel': 'application/octet-stream', '.atlas': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4' }[path.extname(file).toLowerCase()] || 'application/octet-stream');
async function serveCanonicalAsset(req, res, pathname) {
  const prefix = ['/assets/', '/fonts/'].find((x) => pathname.startsWith(x));
  const dir = path.join(canonical, 'public', prefix.slice(1, -1));
  let rel; try { rel = decodeURIComponent(pathname.slice(prefix.length)); } catch { rel = ''; }
  const file = path.resolve(dir, rel); const root = path.resolve(dir);
  if (!rel || !file.startsWith(root + path.sep)) { res.writeHead(400, { 'Cache-Control': 'no-store' }); res.end(); return; }
  try {
    const stat = await fs.stat(file); if (!stat.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': mime(file), 'Content-Length': String(stat.size), 'Cache-Control': 'public, max-age=86400' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  } catch { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); }
}
async function serveCanonicalMedia(req, res, pathname) {
  let rel; try { rel = decodeURIComponent(pathname.slice('/media/'.length)); } catch { rel = ''; }
  const root = path.resolve(canonical, 'public', 'assets', 'audio');
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length || segments.some((x) => x === '.' || x === '..' || x.startsWith('.') || x.endsWith('.'))) {
    res.writeHead(400, { 'Cache-Control': 'no-store' }); res.end(); return;
  }
  const given = path.extname(segments.at(-1)).toLowerCase();
  const extensions = ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav'];
  const candidates = given ? [path.resolve(root, ...segments)] : extensions.map((ext) => path.resolve(root, ...segments.slice(0, -1), `${segments.at(-1)}${ext}`));
  for (const file of candidates) {
    if (!file.startsWith(root + path.sep)) continue;
    try {
      const stat = await fs.stat(file); if (!stat.isFile()) continue;
      res.writeHead(200, { 'Content-Type': mime(file), 'Content-Length': String(stat.size), 'Cache-Control': 'public, max-age=86400' });
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
      return;
    } catch { /* try the next supported audio extension */ }
  }
  res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end();
}
function proxyUpstream(req, res, backendPort) {
  const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers }, (answer) => {
    const headers = { ...answer.headers }; delete headers.connection; delete headers['keep-alive']; delete headers['proxy-authenticate']; delete headers['proxy-authorization']; delete headers.te; delete headers.trailer; delete headers['transfer-encoding']; delete headers.upgrade;
    res.writeHead(answer.statusCode || 502, headers); answer.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
}
async function startAssetProxy(backendPort) {
  assetProxy = http.createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://local').pathname;
    if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) { await serveCanonicalAsset(req, res, pathname); return; }
    if (pathname.startsWith('/media/')) { await serveCanonicalMedia(req, res, pathname); return; }
    proxyUpstream(req, res, backendPort);
  });
  assetProxy.on('upgrade', (req, socket, head) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.url, headers: req.headers });
    upstream.on('upgrade', (res, peer, peerHead) => {
      socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n${Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (peerHead.length) socket.write(peerHead); if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
    });
    upstream.on('error', () => socket.destroy()); upstream.end();
  });
  await new Promise((resolve, reject) => { assetProxy.once('error', reject); assetProxy.listen(0, '127.0.0.1', resolve); });
  const address = assetProxy.address(); return `http://127.0.0.1:${address.port}`;
}

try {
  await mkdir(output, { recursive: true }); await mkdir(tmp, { recursive: true });
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(repo, 'public'), dataDir: path.join(repo, 'data'), sharedDir: path.join(repo, 'shared'),
    independentDirectory: path.join(runtime, 'sessions'), recordingDirectory: path.join(runtime, 'recordings') });
  const origin = await startAssetProxy(server.port);
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--no-proxy-server', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'] });
  page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    let pathname = '';
    try { pathname = new URL(request.url()).pathname; } catch { /* let Chromium handle malformed URLs */ }
    if (request.method() === 'POST' && /\/independent\/api\/sessions\/[^/]+\/actions$/.test(pathname)) {
      let body = {}; try { body = JSON.parse(request.postData() || '{}'); } catch { /* preserve malformed requests in diagnostics */ }
      const entry = { requestedAt: new Date().toISOString(), url: request.url(), expectedRevision: body.expectedRevision,
        action: body.action ? { type: body.action.type, uid: body.action.uid, targetUid: body.action.targetUid, row: body.action.row, col: body.action.col, dir: body.action.dir } : null };
      pendingActionRequests.set(request, entry); (report.uiActionRequests ||= []).push(entry);
    }
    if (pathname === '/favicon.ico') void request.respond({ status: 204, body: '' }).catch(() => {});
    else void request.continue().catch(() => {});
  });
  page.on('pageerror', (error) => { const detail = { message: error.message, stack: error.stack || '' }; report.pageErrors.push(detail); report.errors.push({ type: 'pageerror', ...detail }); });
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', async (response) => {
    const actionEntry = pendingActionRequests.get(response.request());
    if (actionEntry) {
      actionEntry.status = response.status();
      try {
        const body = await response.json(); const state = body.state;
        actionEntry.result = { ok: body.ok, error: body.error?.code || body.error || null, revision: state?.revision,
          pieces: (state?.pieces || []).map((p) => ({ uid: p.uid, row: p.row ?? null, col: p.col ?? null })) };
        actionEntry.respondedAt = new Date().toISOString();
      } catch { actionEntry.result = { unreadable: true }; }
    }
    if (response.status() >= 400) report.errors.push(`response ${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => report.errors.push(`request failed ${request.url()}: ${request.failure()?.errorText}`));
  hardTimer = setTimeout(() => { report.hardTimeout = true; report.hardTimeoutAt = new Date().toISOString(); void browser?.close().catch(() => {}); }, Math.max(0, processStartedAt + hardLimitMs - Date.now()));
  await page.goto(`${origin}/independent.html?record=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ix-start__modes .ix-mode', { timeout: 60000 });
  // Chrome can reset an about:blank viewport during navigation; size the real game before session creation so
  // renderer-provided pointer geometry and the initial recording share the same full-resolution canvas.
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const growthOptions = await page.$$('.ix-growth-mode button[role="radio"]');
  for (const option of growthOptions) {
    const label = await option.evaluate((e) => (e.innerText || '').trim());
    if (label.includes('徽章成长') && await option.evaluate((e) => e.getAttribute('aria-checked') !== 'true')) { await option.click(); break; }
  }
  await clickText('.ix-start__modes .ix-mode', (s) => s.includes('十四轮'));
  await page.waitForSelector('[data-testid="ix-game"]', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.gm__loading') && globalThis.__SP_VIEW__, { timeout: 90000 });
  await pause(2500);
  await page.waitForFunction(() => !!new URL(location.href).searchParams.get('session') && !!new URL(location.href).searchParams.get('recording'), { timeout: 30000 });
  const url = new URL(page.url()); sessionId = url.searchParams.get('session'); recordingId = url.searchParams.get('recording');
  if (!sessionId || !recordingId) throw new Error('UI 创建对局或录制未完成');
  await page.waitForFunction(() => document.querySelector('.ix-recording__dot.is-live'), { timeout: 30000 });
  const initial = await readState(); report.sessionId = sessionId; report.recordingId = recordingId; report.growthMode = initial.growthMode; report.roundLimit = initial.roundLimit;
  await screenshot('first-preparation');
  let roundsDriven = 0; let idle = 0; let lastPrepRevision = null; let sameRevisionSince = Date.now();
  while (Date.now() - processStartedAt < hardLimitMs) {
    if (await page.$('[data-testid="ix-result-ok"]')) {
      const liveRound = Number((await readState()).lastBattle?.round) || roundsDriven + 1;
      await waitBattleResult(liveRound); roundsDriven++;
      if (roundsDriven >= maxRounds) break;
      continue;
    }
    if (await page.$('[data-testid="ix-battlebar"]')) {
      const liveRound = Number((await readState()).lastBattle?.round) || roundsDriven + 1;
      await waitBattleResult(liveRound); roundsDriven++;
      if (roundsDriven >= maxRounds) break;
      continue;
    }
    const state = await readState();
    if (state.phase === 'prep' && !report.preparationSnapshots.some((x) => x.revision === state.revision)) {
      const roster = (state.pieces || []).filter((p) => !p.temp);
      const roles = roster.map((p) => ({ name: p.name, profession: chessCatalog[p.chessId]?.profession || '', position: chessCatalog[p.chessId]?.position || '' }));
      report.preparationSnapshots.push({ round: state.round, revision: state.revision, funds: state.funds, shopLevel: state.shop?.level,
        upgradePrice: state.shop?.upgradePrice, roster: roles, slots: (state.shop?.slots || []).map((s, i) => ({ i, kind: s.kind, name: chessCatalog[s.id]?.name || s.id, price: s.price, sold: s.sold })) });
    }
    if (state.phase !== 'prep') { lastPrepRevision = null; sameRevisionSince = Date.now(); }
    else if (state.revision !== lastPrepRevision) { lastPrepRevision = state.revision; sameRevisionSince = Date.now(); }
    else if (Date.now() - sameRevisionSince > 60000) {
      report.stalledPreparation = { revision: state.revision, round: state.round, phase: state.phase, actions: report.actions.length,
        since: new Date(sameRevisionSince).toISOString(), reason: (await visibleText('[data-testid="ready-why"]')).join(' ') };
      const live = await readState();
      report.stalledPreparation.liveState = { revision: live.revision, phase: live.phase, round: live.round, funds: live.funds,
        pieces: (live.pieces || []).map((p) => ({ uid: p.uid, name: p.name, chessId: p.chessId, row: p.row ?? null, col: p.col ?? null, temp: !!p.temp })) };
      report.stalledPreparation.readyUi = await page.evaluate(() => {
        const button = document.querySelector('[data-testid="ix-ready"]');
        return { disabled: button?.disabled ?? null, className: button?.className || '', html: button?.outerHTML || '',
          parentText: button?.parentElement?.innerText || '', why: [...document.querySelectorAll('[data-testid="ready-why"]')].map((x) => x.innerText),
          toasts: [...document.querySelectorAll('.toast-host, .toast__text')].map((x) => x.innerText).filter(Boolean),
          facing: !!document.querySelector('.fwheel'), detailOpen: !!document.querySelector('[data-testid="ix-detail"]') };
      });
      report.stalledPreparation.pendingActions = report.uiActionRequests || [];
      report.stalledPreparation.screenshot = await screenshot(`stalled-preparation-round-${state.round || 0}`);
      await writeFile(path.join(output, 'stalled-preparation-diagnostic.json'), JSON.stringify(report.stalledPreparation, null, 2));
      throw new Error(`同一准备阶段 revision ${state.revision} 超过一分钟没有可见动作推进`);
    }
    if (state.phase === 'finished') { await screenshot('terminal-finished'); break; }
    if (await page.$('.ix-offer[role="dialog"]')) {
      const done = await resolveOffer(Number(state.round) || roundsDriven + 1);
      if (!done) throw new Error(`可见选择面板无法自动完成：${(await visibleText('.ix-offer')).join(' | ')}`);
      idle = 0; continue;
    }
    if (await page.$('.ix-inherit')) { await pause(250); continue; }
    if (state.phase !== 'prep') { await pause(250); continue; }
    const deployed = (state.pieces || []).filter((p) => Number.isInteger(p.row)).length;
    const ordinary = (state.pieces || []).find((p) => !p.elite && Number.isInteger(p.row));
    if (ordinary && !report.references?.some((x) => x.kind === 'ordinary') && !report.referenceAttempts?.ordinary) {
      if (await inspectReferenceCard(ordinary, 'ordinary')) { idle = 0; sameRevisionSince = Date.now(); continue; }
      sameRevisionSince = Date.now();
    }
    const elite = (state.pieces || []).find((p) => p.elite && Number.isInteger(p.row));
    if (elite && !report.references?.some((x) => x.kind === 'elite') && !report.referenceAttempts?.elite) {
      if (await inspectReferenceCard(elite, 'elite')) { idle = 0; sameRevisionSince = Date.now(); continue; }
      sameRevisionSince = Date.now();
    }
    const nonTemporary = (state.pieces || []).filter((p) => !p.temp).length;
    const desired = Math.min(8, Math.max(1, nonTemporary));
    if (deployed < desired) {
      const bench = (state.pieces || []).find((p) => !Number.isInteger(p.row) && !p.temp);
      if (bench && await deployPiece(state, bench)) {
        idle = 0; const afterDeploy = await readState(); await annotateObservedChanges(state, afterDeploy);
        if (process.env.SP_RECORD_DRIVER_PREP_ONLY === '1') {
          if (report.firstDeployDiagnostic) {
            report.firstDeployDiagnostic.afterDropState = (afterDeploy.pieces || []).find((p) => p.uid === bench.uid) || null;
            report.firstDeployDiagnostic.wheelVisibleAfterDirection = !!(await page.$('.fwheel[role="dialog"]'));
            await writeFile(path.join(output, 'first-deploy-diagnostic.json'), JSON.stringify(report.firstDeployDiagnostic, null, 2));
          }
          await screenshot('prep-diagnostic-complete'); report.prepDiagnosticComplete = true; break;
        }
        continue;
      }
      if (bench) throw new Error(`可见手牌干员 ${bench.uid} 无法部署，已保存合法格、轮盘命中与截图诊断`);
    }
    if (await equipVisibleItem(state)) { idle = 0; continue; }
    if (await attemptHandover(state)) { idle = 0; continue; }
    const rosterSize = (state.pieces || []).filter((p) => !p.temp).length;
    if (rosterSize < 10 && await buyOne(state)) { idle = 0; continue; }
    if (deployed >= 8 && rosterSize >= 10) {
      if (await buyOne(state, { triplesOnly: true })) { idle = 0; continue; }
      const replacement = highTierReplacement(state);
      if (replacement && await sellForHighTierReplacement(state, replacement)) { idle = 0; continue; }
    }
    if (await maybeUpgrade(state)) { idle = 0; continue; }
    if (idle < 1 && Number(state.funds) >= Number(state.shop?.refreshPrice || 1) + 2) { if (await triggerRefresh(state)) { idle++; continue; } }
    if (deployed > 0) {
      const ready = await page.$('[data-testid="ix-ready"]');
      if (ready && !(await ready.evaluate((e) => e.disabled))) {
        if (await page.$('[data-testid="ix-detail"]')) {
          if (!await clickText('[data-testid="ix-detail"] button', (label) => label === '关闭')) await page.keyboard.press('Escape');
          await pause(250);
        }
        const round = Number(state.round) || roundsDriven + 1;
        const readyHit = await page.evaluate(() => {
          const button = document.querySelector('[data-testid="ix-ready"]'); if (!button) return null;
          const r = button.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { disabled: button.disabled, rect: r.toJSON(), buttonText: button.innerText, hitTag: hit?.tagName || '',
            hitClass: typeof hit?.className === 'string' ? hit.className : '', hitIsButton: hit === button || button.contains(hit),
            detailOpen: !!document.querySelector('[data-testid="ix-detail"]'), facingOpen: !!document.querySelector('.fwheel') };
        });
        (report.readyAttempts ||= []).push({ round, revision: state.revision, deployed, readyHit });
        if (!readyHit?.hitIsButton || readyHit.disabled || readyHit.detailOpen || readyHit.facingOpen) throw new Error(`开始战斗按钮未命中可交互位置：${JSON.stringify(readyHit)}`);
        await screenshot(`round-${round}-preparation`);
        if (round === 1) await note('从商店招募干员后，拖入战场并选择朝向；之后可以继续扩充与调整阵容。', '[data-testid="ix-ready"]', 'first-deployment');
        await ready.click(); report.actions.push({ type: 'start-battle', round, funds: state.funds, deployed });
        try {
          await page.waitForFunction(() => document.querySelector('[data-testid="ix-battlebar"]') || document.querySelector('[data-testid="ix-result-ok"]'), { timeout: 180000 });
        } catch { throw new Error(`第 ${round} 轮开始战斗后未出现战斗回放或结算：${(await visibleText('[role=status]')).join(' ')}`); }
        continue;
      }
      const reason = await page.$eval('[data-testid="ready-why"]', (e) => e.innerText).catch(() => '');
      if (reason.includes('临时整备区')) {
        const temporary = (state.pieces || []).find((p) => p.temp);
        if (temporary) { const ok = await deployPiece(state, temporary); if (ok) continue; }
      }
    }
    await pause(500); idle++;
    if (idle > 6) throw new Error(`无法推进整备阶段，当前提示：${(await visibleText('[data-testid="ready-why"]')).join(' ')}`);
  }
  if (Date.now() - processStartedAt >= hardLimitMs) throw new Error(`对局驾驶达到${Math.round(hardLimitMs / 60000)}分钟执行时限`);
  await stopRecording(); await pause(1000);
  report.roundsDriven = roundsDriven; report.endedAt = new Date().toISOString();
  const recording = await readRecording();
  report.replayVisualProof = await verifyNarratedReplay(recording);
  report.recording = recording ? { meta: recording.meta, events: (recording.events || []).filter((e) => e.kind === 'server-action' || e.kind === 'caption' || e.kind === 'custom').map((e) => ({ ts: e.ts, kind: e.kind, p: e.p })) } : null;
  report.actions = report.recording?.events?.filter((e) => e.kind === 'server-action').map((e) => ({ at: e.ts, ...e.p })) || report.actions;
  report.artifacts = { screenshots: report.screenshots, log: runLog, json: path.join(output, 'driver-run.json') };
  const reportFile = path.join(output, 'driver-run.json'); await writeFile(reportFile, JSON.stringify(report, null, 2));
  const summary = `ok=${!!recording?.meta?.endedAt} rounds=${roundsDriven} recording=${recordingId} events=${report.recording?.events?.length || 0} media=${JSON.stringify(recording?.meta?.mediaSegments || [])}`;
  await writeFile(runLog, `${report.startedAt}\n${summary}\n${report.errors.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ report: reportFile, log: runLog, recordingId, sessionId, roundsDriven, endedAt: recording?.meta?.endedAt, mediaSegments: recording?.meta?.mediaSegments, errors: report.errors, screenshots: report.screenshots }, null, 2));
  if (!recording?.meta?.endedAt || !recording?.meta?.mediaSegments?.length || report.errors.length || report.recordingStopError) process.exitCode = 1;
} catch (error) {
  report.failure = error?.stack || String(error); report.endedAt = new Date().toISOString();
  try { if (page && !page.isClosed()) { await screenshot('driver-failure'); await stopRecording(); const stopped = await readRecording(); report.recordingMeta = stopped?.meta || null; } } catch { /* include original failure */ }
  const file = path.join(output, 'driver-run-failure.json'); await writeFile(file, JSON.stringify(report, null, 2)).catch(() => {});
  const log = runLog; await writeFile(log, `${report.startedAt}\nFAILED ${error?.stack || error}\n`, 'utf8').catch(() => {});
  console.error(JSON.stringify({ failure: error?.message || String(error), report: file, log, screenshots: report.screenshots }, null, 2)); process.exitCode = 1;
} finally {
  clearTimeout(hardTimer);
  if (browser) await browser.close().catch(() => {});
  if (assetProxy) await new Promise((resolve) => { assetProxy.closeAllConnections?.(); assetProxy.close(resolve); }).catch(() => {});
  if (server) { server.closeAllConnections?.(); await server.close().catch(() => {}); }
}
