// Browser smoke test through the deployed demo; --candidate substitutes only
// the candidate model files, leaving battle code/assets on their real service.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const [url, output, candidate] = process.argv.slice(2);
const puppeteer = createRequire('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/package.json')('puppeteer-core');
const exe = 'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
fs.mkdirSync(output, { recursive: true });
let browser;
const deadline = setTimeout(() => { console.error('Browser smoke deadline exceeded'); browser?.close().finally(() => process.exit(124)); }, 120000);
try {
  browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  if (candidate) {
    await page.setRequestInterception(true);
    page.on('request', req => {
      const relative = new URL(req.url()).pathname.match(/\/dev\/(diy-2b(?:\.html|\/.*))$/)?.[1];
      if (relative && !relative.includes('..') && /^[\w./-]+$/.test(relative)) {
        const file = path.join(candidate, 'public/dev', relative);
        const ext = path.extname(file);
        const mime = { '.json': 'application/json', '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png' };
        if (fs.existsSync(file)) return req.respond({ status: 200, contentType: mime[ext] || 'text/plain', body: fs.readFileSync(file) });
      }
      req.continue();
    });
  }
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__diy?.ready, { timeout: 45000 });
  const defaultView = await page.evaluate(() => ({ panelClosed: document.body.classList.contains('panel-closed'), selectable: getComputedStyle(document.body).userSelect === 'text', heading: document.querySelector('h1').textContent }));
  if (!defaultView.panelClosed || !defaultView.selectable || defaultView.heading.includes('草案')) errors.push('Default view regression');
  await page.screenshot({ path: path.join(output, 'default.png') });
  const results = [];
  for (const side of ['front', 'back']) {
    if (side === 'back') { await page.evaluate(() => window.__diy.switchModel('back')); await page.waitForFunction(() => window.__diy.stats().op.side === 'back', { timeout: 10000 }); }
    for (const [clip, wait] of [['Attack', .65], ['Skill_1', .28], ['Start', .35], ['Stun_Skill_3', .5], ['Die', 1.]]) {
      await page.evaluate(n => { const d = window.__diy; d.setAuto(false); d.pause(false); d.play(n); }, clip);
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
      await page.evaluate(() => window.__diy.pause(true));
      await page.screenshot({ path: path.join(output, `${side}-${clip}.png`) });
      results.push({ side, clip, state: await page.evaluate(() => window.__diy.stats().op.track0) });
    }
    await page.evaluate(() => { const d = window.__diy; d.pause(false); d.setAuto(true); });
    await page.waitForFunction(() => window.__diy.stats().op.state === 'idle', { timeout: 6000 });
    await page.evaluate(() => { const d = window.__diy; d.fillSp(); d.cast(2); });
    await new Promise(resolve => setTimeout(resolve, 2700));
    const stats = await page.evaluate(() => window.__diy.stats());
    results.push({ side, s3: stats.skill.s3, track0: stats.op.track0, contract: stats.contract });
    if (stats.skill.s3 !== 'reboot') errors.push(`${side}: self-destruct did not reach reboot`);
    if (stats.contract.missing.length) errors.push(`${side}: missing animation contract`);
    await page.screenshot({ path: path.join(output, `${side}-reboot.png`) });
  }
  const direct = new URL(url); direct.searchParams.set('auto', '0'); direct.searchParams.set('action', 'Skill_1'); direct.searchParams.set('side', 'back'); direct.searchParams.set('panel', '1');
  await page.goto(direct.href, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.__diy?.ready && window.__diy.stats().op.side === 'back' && window.__diy.stats().op.track0 === 'Skill_1', { timeout: 15000 });
  await page.screenshot({ path: path.join(output, 'direct-action.png') });
  const report = { url, candidate: candidate || null, defaultView, directAction: direct.href, errors, results, passed: !errors.length };
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally { clearTimeout(deadline); await browser?.close(); }
