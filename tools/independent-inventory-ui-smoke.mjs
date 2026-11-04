import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1]);
assert.ok(path.isAbsolute(output));
await mkdir(output, { recursive: true });
const sessions = path.join(output, 'sessions'); await mkdir(sessions, { recursive: true });
const receiptPath = path.join(output, 'browser-receipt.json');
const receipt = { ok: false, checks: {}, artifacts: [{ path: receiptPath, role: 'desktop and touch landscape UI validation' }, { path: sessions, role: 'isolated browser test sessions' }] };
let browser; let server;
const deadline = setTimeout(async () => {
  receipt.error = 'UI browser validation exceeded 4 minutes';
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  process.stderr.write(`${receipt.error}; receipt: ${receiptPath}\n`);
  if (browser) await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  process.exit(2);
}, 240000);
try {
  receipt.stage = 'load server modules'; await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  const { startServer } = await import('../server/index.js');
  const { createSession, applyAction } = await import('../server/modes/independent/session.js');
  receipt.stage = 'create fixture'; await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  let fixture = createSession({ seed: 2, difficulty: 'FUNNY', roundLimit: 9 });
  const slot = fixture.shop.slots.findIndex((x) => x.kind === 'chess');
  fixture = applyAction(fixture, { type: 'buy', slot }).state;
  const id = '11111111-1111-4111-8111-111111111111';
  fixture.inventory = [{ uid: 'i900', id: 'precision', quantity: 1200 }, { uid: 'i901', id: 'agility', quantity: 6 },
    { uid: 'i902', id: 'vitality', quantity: 4 }, { uid: 'i903', id: 'defense', quantity: 3 }];
  fixture.nextItemId = 904;
  await writeFile(path.join(sessions, `${id}.json`), JSON.stringify(fixture));
  receipt.artifacts.push({ path: path.join(sessions, `${id}.json`), role: 'valid legacy inventory browser fixture with 1200 same-name badges' });
  server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, independentDirectory: sessions });
  receipt.stage = 'launch Chrome'; await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  const catalog = (await (await fetch(new URL('independent/api/catalog', server.url))).json()).catalog;
  const whistle = Object.entries(catalog.gear).find(([, g]) => g.name.includes('狼嚎哨'))?.[0];
  if (whistle) { fixture.inventory.push({ uid: 'i904', id: whistle, quantity: 2 }); await writeFile(path.join(sessions, `${id}.json`), JSON.stringify(fixture)); }
  const profile = await mkdtemp(path.join(output, 'chrome-profile-'));
  receipt.artifacts.push({ path: profile, role: 'isolated Chrome validation profile' });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', userDataDir: profile, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  receipt.stage = 'load workshop'; await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const url = new URL(`independent.html?session=${id}`, server.url).href; receipt.url = url;
  const shot = async (name) => { await page.waitForSelector('.pbanner--overlay', { hidden: true, timeout: 10000 });
    const file = path.join(output, name); await page.screenshot({ path: file }); receipt.artifacts.push({ path: file, role: 'browser screenshot' }); };
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => globalThis.__SP_VIEW__ && !document.querySelector('.gm__loading'), { timeout: 90000 });
  await page.waitForSelector('[data-testid="ix-strip"]');
  const layout = async () => page.evaluate(() => {
    const box = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null; };
    return { detail: box('[data-testid="ix-detail"]'), stock: box('[data-testid="ix-strip"]'), ready: box('[data-testid="ix-ready"]'), production: box('[data-testid="ix-prod"]'),
      cells: [...document.querySelectorAll('.ix-strip__slot b')].map((x) => Number(x.textContent)), stockHeader: document.querySelector('.ix-strip__head').textContent, viewport: { w: innerWidth, h: innerHeight } };
  });
  receipt.checks.desktop = await layout();
  receipt.checks.statefulCells = await page.evaluate(async () => {
    const { inventoryStacks } = await import('./js/independent/model.js');
    return inventoryStacks([{ uid: 'a', id: 'x', quantity: 1000, state: { charges: 1 } }, { uid: 'b', id: 'x', quantity: 1, state: { charges: 2 } }], { gear: {} })
      .map((x) => ({ count: x.count, items: x.items.map((i) => ({ uid: i.uid, quantity: i.quantity })) }));
  });
  assert.deepEqual(receipt.checks.statefulCells, [{ count: 999, items: [{ uid: 'a', quantity: 999 }] }, { count: 1, items: [{ uid: 'a', quantity: 1 }] }, { count: 1, items: [{ uid: 'b', quantity: 1 }] }]);
  assert.deepEqual(receipt.checks.desktop.cells.slice(0, 2), [999, 201]);
  assert.ok(!receipt.checks.desktop.stockHeader.includes('/'));
  assert.ok(receipt.checks.desktop.stock.x > 1000);
  assert.ok(receipt.checks.desktop.production.right <= receipt.checks.desktop.ready.x);
  if (whistle) { assert.ok(await page.$(`[data-testid="ix-tile-${whistle}:n"] svg`));
    receipt.checks.whistleIcon = await page.$eval(`[data-testid="ix-tile-${whistle}:n"] svg`, (x) => ({ width: x.getBoundingClientRect().width, name: x.getAttribute('aria-label') })); }
  await shot('01-desktop-inventory.png');
  await page.evaluate((uid) => { location.hash = `piece-${uid}`; }, fixture.pieces[0].uid);
  await page.waitForSelector('[data-testid="ix-detail"]');
  receipt.checks.detail = await layout();
  assert.ok(receipt.checks.detail.detail.x < 40);
  assert.ok(receipt.checks.detail.detail.width >= 650);
  await shot('02-desktop-detail-left.png');
  await page.click('.ix-dtabs__tab:nth-child(2)');
  await shot('03-desktop-skill.png');
  await page.click('.dpanel__close');
  await page.click('[data-testid="ix-prod-toggle"]');
  await page.waitForSelector('.ix-prod__body');
  await shot('04-production-expanded.png');
  await page.click('[data-testid="ix-prod-toggle"]');
  await page.click('[data-testid="ix-tile-precision:n"]');
  await page.waitForSelector('[data-testid="ix-inv-target"]');
  await page.select('[data-testid="ix-inv-target"]', fixture.pieces[0].uid);
  await page.click('.ix-qty button:last-child');
  const chosen = await page.$eval('.ix-qty b', (el) => Number(el.textContent));
  assert.equal(chosen, 999);
  await shot('05-inventory-selection.png');
  await page.click('.ix-inv__act .btn');
  await page.waitForFunction(() => !document.querySelector('[data-testid="ix-tile-precision:n"]')?.textContent.includes('999'), { timeout: 10000 });
  receipt.checks.equip = await page.evaluate(async () => (await (await fetch(`independent/api/sessions/${new URL(location.href).searchParams.get('session')}?catalog=0`)).json()).state.pieces[0].equipment);
  assert.equal(receipt.checks.equip.find((x) => x.id === 'precision').quantity, 999);
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => innerWidth === 844);
  await page.evaluate((uid) => { location.hash = `piece-${uid}`; }, fixture.pieces[0].uid);
  await page.waitForSelector('[data-testid="ix-detail"]');
  receipt.checks.phone = await layout();
  assert.ok(receipt.checks.phone.detail.x < 20);
  assert.ok(receipt.checks.phone.detail.right < receipt.checks.phone.stock.x);
  assert.ok(receipt.checks.phone.stock.bottom <= 390);
  await shot('06-touch-landscape-detail.png');
  await page.click('.dpanel__close');
  await page.evaluate(() => { location.hash = 'stock-precision:n'; });
  await page.waitForSelector('[data-testid="ix-inv-target"]');
  assert.equal(await page.$eval('.ix-inv__head b', (x) => x.textContent), '攻击徽章');
  await shot('07-touch-landscape-inventory.png');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('[data-testid="ix-inv-target"]'), null, 'Escape closes the inventory');
  assert.equal(await page.evaluate(() => location.hash), '', 'closing clears the item component link');
  fixture.inventory = [{ uid: 'i900', id: 'precision', quantity: 999 * catalog.rules.inventoryCapacity }];
  await writeFile(path.join(sessions, `${id}.json`), JSON.stringify(fixture));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="ix-strip"]');
  const full = await page.$eval('.ix-strip__head', (x) => x.textContent);
  assert.ok(full.includes('库存已满') && !full.includes('/'));
  receipt.checks.fullInventory = full;
  await shot('08-inventory-full.png');
  receipt.checks.errors = errors; assert.deepEqual(errors, []);
  receipt.ok = true;
  receipt.stage = 'complete';
} catch (e) { receipt.error = e.stack || String(e); }
finally {
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  await Promise.race([Promise.allSettled([browser?.close(), server?.close()]), new Promise((resolve) => setTimeout(resolve, 10000))]);
  clearTimeout(deadline);
  process.stdout.write(`${JSON.stringify({ ok: receipt.ok, receipt: receiptPath, error: receipt.error })}\n`);
  process.exitCode = receipt.ok ? 0 : 1;
}
