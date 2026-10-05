#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.js';

const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
const output = path.resolve(args.includes('--output') ? option('--output') : 'runtime/independent-mode-20261005/frontend');
await mkdir(output, { recursive: true });
const directory = path.join(output, 'sessions');
const server = args.includes('--url') ? null : await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentDirectory: directory });
const base = args.includes('--url') ? option('--url') : new URL('independent.html', server.url).href;
const reportPath = path.join(output, 'browser-receipt.json');
const artifacts = [{ path: reportPath, role: 'headless browser validation receipt' }];
const errors = [];
let browser;
const receipt = { ok: false, url: base, artifacts };
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 30000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 30000 });
  const click = async (text) => {
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((el) => el.offsetParent && !el.disabled && el.textContent.trim().startsWith(label)), { timeout: 15000 }, text);
    await page.evaluate((label) => [...document.querySelectorAll('button')].find((el) => el.offsetParent && !el.disabled && el.textContent.trim().startsWith(label)).click(), text);
  };
  const current = () => page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('session');
    return fetch(new URL(`./independent/api/sessions/${id}`, location.href)).then((r) => r.json());
  });
  await click('开始演习');
  await page.waitForSelector('.shop-slots', { timeout: 15000 });
  let packet = await current();
  assert.equal(packet.ok, true);
  const slot = packet.state.shop.slots.findIndex((x) => x.kind === 'chess' && packet.catalog.operators[x.id].position === 'MELEE');
  assert.ok(slot >= 0);
  await page.click(`#shop-${slot} .primary`);
  await page.waitForFunction(() => document.querySelector('.bench-list')?.textContent.includes('装备'), { timeout: 15000 });
  packet = await current();
  const piece = packet.state.pieces[0];
  await page.click('.bench-list button');
  await page.waitForSelector('.shade');
  assert.ok((await page.$eval('.shade', (el) => el.textContent)).includes('装备'));
  await click('关闭');
  const tile = packet.state.board.map.find(([, kind]) => kind === 'melee');
  const tileId = 'tile-' + tile[0];
  await page.evaluate((id) => document.getElementById(id).click(), tileId);
  await page.waitForFunction((id) => document.getElementById(id)?.textContent.includes('装备'), { timeout: 15000 }, tileId);
  packet = await current();
  assert.equal(packet.state.pieces.find((p) => p.uid === piece.uid).row, Number(tile[0].split(',')[0]));
  if (packet.state.inventory.length) {
    await click('装备库存');
    await page.waitForSelector('.shade');
    receipt.inventoryVisible = (await page.$eval('.shade', (el) => el.textContent)).includes(packet.catalog.gear[packet.state.inventory[0].id]?.name || '');
    await click('关闭');
  }
  const prepImage = path.join(output, 'preparation.png');
  await page.screenshot({ path: prepImage, fullPage: true });
  artifacts.push({ path: prepImage, role: 'actual preparation screen' });
  const restoredUrl = page.url();
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(page.url(), restoredUrl);
  assert.deepEqual((await current()).state, packet.state);
  await page.goto(restoredUrl + `#piece-${piece.uid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.shade', { timeout: 15000 });
  assert.ok((await page.$eval('.shade', (el) => el.textContent)).includes(piece.name));
  await click('关闭');
  await click('开始战斗');
  await page.waitForSelector('.result', { timeout: 30000 });
  packet = await current();
  assert.equal(packet.state.round, 2);
  assert.equal(packet.state.battleSummary.diagnostics.errorCount, 0);
  const battleImage = path.join(output, 'battle-result.png');
  await page.screenshot({ path: battleImage, fullPage: true });
  artifacts.push({ path: battleImage, role: 'actual backend battle result screen' });
  await page.setViewport({ width: 390, height: 844 });
  const mobileImage = path.join(output, 'mobile.png');
  await page.screenshot({ path: mobileImage, fullPage: true });
  artifacts.push({ path: mobileImage, role: 'actual phone-size page' });
  assert.ok(await page.$('a.fullscreen'));
  assert.equal(await page.$eval('.topbar', (el) => getComputedStyle(el).userSelect === 'none'), false);
  assert.deepEqual(errors, []);
  receipt.ok = true;
  receipt.sessionUrl = page.url();
  receipt.revision = packet.state.revision;
  receipt.round = packet.state.round;
} catch (error) { receipt.error = error.stack; receipt.pageErrors = errors; process.exitCode = 1; }
finally {
  await browser?.close();
  await server?.close();
  await writeFile(reportPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}
