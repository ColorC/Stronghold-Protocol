/* global document */
// Step 0: GPU renderer + 60 s native tab capture of a live battle. usage: node step0.mjs <runId> <outMp4> <fps>
import { createRequire } from 'node:module';
import { GPU_ARGS } from './gpu-args.mjs';
import { startCapture, stopCapture } from './capture.mjs';
const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const puppeteer = createRequire(ROOT + '/package.json')('puppeteer-core');
const [,, runId, out, fpsArg = '60'] = process.argv;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', pipe: true,
  userDataDir: ROOT + '/.omni/tmp/assault/film-1103/profile-step0-' + Date.now(),
  args: [...GPU_ARGS, '--auto-accept-this-tab-capture', '--auto-select-tab-capture-source-by-title=STRONGHOLD'] });
console.log('browser pid', browser.process().pid);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:13004/assault.html?run=' + runId, { waitUntil: 'domcontentloaded' });
  const gl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  console.log('WEBGL RENDERER', gl);
  const h = await page.waitForFunction(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '继续'), { timeout: 30000 });
  await h.asElement().click();
  await new Promise((r) => setTimeout(r, 8000));
  const cap = await startCapture(page, out, { fps: Number(fpsArg), videoBps: Number(process.env.BPS || 6000000), mode: process.env.MODE });
  console.log('capture', JSON.stringify(cap.info));
  await new Promise((r) => setTimeout(r, Number(process.env.SECS || 60) * 1000));
  const res = await stopCapture(page, cap);
  console.log('stopped', JSON.stringify(res));
  await page.screenshot({ path: out.replace(/\.mp4$/, '.png') });
} finally { const pid = browser.process().pid; await browser.close(); console.log('closed', pid); }
