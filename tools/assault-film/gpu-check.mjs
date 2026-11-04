/* global document */
// Step-0 helper: launch headless Chrome with the GPU flags and print the WebGL renderer.
import { createRequire } from 'node:module';
const ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
import { GPU_ARGS } from './gpu-args.mjs';
const puppeteer = createRequire(ROOT + '/package.json')('puppeteer-core');
if (process.argv[2]) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', pipe: true,
    userDataDir: process.argv[2], args: GPU_ARGS });
  console.log('browser pid', browser.process().pid);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto('about:blank');
    console.log(JSON.stringify(await page.evaluate(() => {
      const out = {};
      for (const kind of ['webgl2', 'webgl']) {
        const c = document.createElement('canvas'); const gl = c.getContext(kind); if (!gl) { out[kind] = null; continue; }
        const e = gl.getExtension('WEBGL_debug_renderer_info');
        out[kind] = e ? { vendor: gl.getParameter(e.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(e.UNMASKED_RENDERER_WEBGL) } : 'no-debug-info';
      }
      return out;
    }), null, 1));
  } finally { const pid = browser.process().pid; await browser.close(); console.log('closed', pid); }
}
