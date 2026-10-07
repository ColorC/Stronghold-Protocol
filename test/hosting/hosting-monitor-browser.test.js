import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '../..');
const canonicalRoot = path.basename(path.dirname(checkout)) === '.worktrees' ? path.resolve(checkout, '../..') : checkout;
const output = path.resolve(process.env.SP_TEST_ARTIFACT_DIR || path.join(canonicalRoot, 'runtime/server-monitor-20261007/browser'));
const htmlPath = path.join(checkout, 'tools/hosting-monitor.html');
const fixture = {
  at: new Date().toISOString(), intervalSeconds: 60,
  host: { cpuPercent: 24.5, availableMemoryBytes: 3 * 1024 ** 3, totalMemoryBytes: 8 * 1024 ** 3, txBitsPerSecond: 1250000, rxBitsPerSecond: 250000, systemDiskAvailableBytes: 50 * 1024 ** 3 },
  game: { healthy: true, cpuPercent: 8.3, memoryBytes: 512 * 1024 ** 2, rssBytes: 600 * 1024 ** 2, active: 3, waiting: 1, activeLimit: 50, waitingLimit: 200, restarts: 0, uptimeSeconds: 5400 },
  requests: { windowSeconds: 300, total: 140, status5xx: 2, status4xx: 4, checkpoint: { count: 0, p95Ms: null, p50Ms: null, maxMs: null }, admission: { count: 0, p95Ms: null } },
  history: [
    { at: '2026-10-07T00:00:00Z', hostCpuPercent: 20, gameCpuPercent: 6, txBitsPerSecond: 800000, active: 2, waiting: 1 },
    { at: '2026-10-07T00:01:00Z', hostCpuPercent: 24.5, gameCpuPercent: 8.3, txBitsPerSecond: 1250000, active: 3, waiting: 1 },
  ],
};

test('hosting monitor renders fixture, preserves values on fetch failure, and copies card anchors', async () => {
  await mkdir(output, { recursive: true });
  const html = await readFile(htmlPath, 'utf8');
  const receiptPath = path.join(output, 'browser-receipt.json');
  const screenshotPath = path.join(output, 'hosting-monitor.png');
  const receipt = { ok: false, fixtureOnly: true, fixtureDataIsNotServerTelemetry: true, artifacts: [{ path: receiptPath, role: 'browser fixture test receipt' }, { path: screenshotPath, role: 'monitor UI fixture screenshot' }], checks: {} };
  let failMetrics = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics.json') {
      if (failMetrics) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"fixture unavailable"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(fixture)); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  });
  let browser;
  try {
    assert.ok(Buffer.byteLength(html) < 15 * 1024, 'single source file stays below 15 KiB');
    assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i, 'no external runtime dependencies');
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { let copied = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; }, readText: async () => copied } }); });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-key="hostCpu"]')?.textContent === '24.5%');
    receipt.checks.render = await page.evaluate(() => ({ hostCpu: document.querySelector('[data-key="hostCpu"]').textContent, active: document.querySelector('[data-key="active"]').textContent,
      checkpointP95: document.querySelector('[data-key="checkpointP95"]').textContent, admissionP95: document.querySelector('[data-key="admissionP95"]').textContent,
      trendLines: document.querySelectorAll('#trend-lines polyline').length, freshness: document.querySelector('#freshness').textContent,
      hasExternalDependencies: !!document.querySelector('script[src],link[rel="stylesheet"][href]') }));
    assert.equal(receipt.checks.render.hostCpu, '24.5%');
    assert.equal(receipt.checks.render.checkpointP95, '尚无样本');
    assert.equal(receipt.checks.render.admissionP95, '尚无样本');
    assert.ok(receipt.checks.render.trendLines >= 2);
    assert.equal(receipt.checks.render.hasExternalDependencies, false);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await page.click('[data-anchor="game"]');
    await page.waitForFunction(() => document.querySelector('[data-anchor="game"]').textContent.includes('已复制'));
    receipt.checks.anchorCopy = await page.evaluate(async () => ({ text: await navigator.clipboard.readText(), hash: new URL(location.href).hash }));
    assert.match(receipt.checks.anchorCopy.text, /#game$/);
    assert.equal(receipt.checks.anchorCopy.hash, '');

    failMetrics = true;
    await page.click('#refresh');
    await page.waitForFunction(() => document.querySelector('#freshness').textContent.includes('保留最近数据'));
    receipt.checks.failedFetch = await page.evaluate(() => ({ hostCpu: document.querySelector('[data-key="hostCpu"]').textContent, status: document.querySelector('#freshness').textContent, state: document.querySelector('#freshness').dataset.state }));
    assert.equal(receipt.checks.failedFetch.hostCpu, '24.5%', 'failed fetch retains prior sample');
    assert.equal(receipt.checks.failedFetch.state, 'stale');
    assert.deepEqual(errors, []);
    receipt.checks.pageErrors = errors;
    receipt.ok = true;
  } catch (error) {
    receipt.error = error.stack || String(error);
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
});

