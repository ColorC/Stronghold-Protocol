import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.TEMP_LEVEL_E2E === '1';

test('battle temporary badges update visible equipment totals without mutating permanent gear', { skip: enabled ? false : 'set TEMP_LEVEL_E2E=1 for native DOM regression', timeout: 90000 }, async () => {
  const { getCatalog } = await import('../../server/modes/independent/catalog.js');
  const { getData } = await import('../../server/data.js');
  const { independentDisplayCatalog } = await import('../../server/modes/independent/display.js');
  const { unitStatsEntry } = await import('../../shared/protocol.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const game = getData(), rawCatalog = getCatalog(game), catalog = independentDisplayCatalog(game, rawCatalog);
  const op = Object.values(rawCatalog.operators).find(x => !x.elite && x.source?.normalChess?.stats);
  assert.ok(op, 'a real catalog operator and source stat record are available');
  const piece = { uid: 'temp-level-piece', chessId: op.chessId, elite: false, factions: op.nativeFactionTags || [],
    equipmentLevel: 5, equipment: [{ uid: 'permanent-five', id: 'precision', quantity: 5 }], attachments: [], row: 1, col: 1 };
  const probeUnit = { id: 901, uid: piece.uid, defId: piece.chessId, hp: 100, alive: true, base: op.source.normalChess.stats };
  const stats = (entries) => unitStatsEntry({ ...probeUnit, mem: { darkmoonTemporaryEquipment: Object.fromEntries(entries.map((entry, i) => [`growth-${i}`, entry])) } }, probeUnit.base);
  const probes = {
    none: stats([]),
    three: stats([{ sourceId: 'BGS_061', attackUnits: 2, secondaryUnits: 1, badgeIds: ['precision', 'damage'], expires: 'battleEnd' }]),
    four: stats([{ sourceId: 'BGS_061', attackUnits: 3, secondaryUnits: 1, badgeIds: ['precision', 'damage'], expires: 'battleEnd' }]),
    levels: unitStatsEntry({ ...probeUnit, mem: { darkmoonTemporaryEquipment: { growth: { sourceId: 'BGS_061', temporaryTrainingLevels: 8, expires: 'battleEnd' } } } }, probeUnit.base),
  };
  const fixture = { catalog, state: { phase: 'battle', growthMode: 'badges', funds: 10, pieces: [piece], shop: { slots: [] }, inventory: [] } };
  const boot = `<!doctype html><html lang="zh-CN" class="ix-ws"><head><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/game-panels.css"><link rel="stylesheet" href="/css/independent.css"></head><body><div id="root" class="ix-game"></div><div id="badge-root"></div><script type="module">
    import {h,render} from '/vendor/preact.module.js';import {DetailCard} from '/js/independent/detail.js';import {UnitBadges} from '/js/independent/hud.js';import {loadData} from '/js/data.js';
    const fixture=await (await fetch('/fixture.json')).json(),probes=await (await fetch('/probes.json')).json();await loadData('chess','assets','bonds','items','garrisons','tokens','enemies','config');
    const unit={id:901,uid:fixture.state.pieces[0].uid,side:'ally',kind:'op'},view={pieceScreenRect(){return {x:20,bottom:40};}};
    window.mount=(name,mode='badges')=>{const live=probes[name];const battle={stats:id=>id===901?live:null,snapHp:()=>({hp:100,max:100})};render(null,document.querySelector('#root'));render(h(DetailCard,{...fixture,state:{...fixture.state,growthMode:mode},battle,target:{kind:'unit',unit},busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){}}),document.querySelector('#root'));render(null,document.querySelector('#badge-root'));render(h(UnitBadges,{view,pieces:fixture.state.pieces,catalog:fixture.catalog,hidden:false,battleUnits:[unit],battleStats:id=>id===901?live:null,growthMode:mode}),document.querySelector('#badge-root'));};window.ready=true;
  </script></body></html>`;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (name === '/') { res.setHeader('content-type', 'text/html'); return res.end(boot); }
    if (name === '/fixture.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(fixture)); }
    if (name === '/probes.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(probes)); }
    const file = name.startsWith('/vendor/') || name.startsWith('/assets/') || name.startsWith('/fonts/')
      ? path.join(path.resolve(process.env.SP_INSTALL_ROOT || ROOT), 'public', name)
      : name.startsWith('/data/') ? path.join(path.resolve(process.env.SP_DATA_DIR || path.join(ROOT, 'data')), path.basename(name))
        : name.startsWith('/shared/') ? path.join(ROOT, name) : path.join(ROOT, 'public', name);
    if (fs.existsSync(file)) { const ext = path.extname(file).toLowerCase(), mime = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[ext]; if (mime) { res.setHeader('content-type', mime); return res.end(fs.readFileSync(file)); } }
    res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const profileRoot = path.resolve(process.env.SP_DETAIL_PANEL_PROFILE_ROOT || path.join(ROOT, '.omni', 'tmp', 'temp-level-browser'));
    fs.mkdirSync(profileRoot, { recursive: true });
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      userDataDir: fs.mkdtempSync(path.join(profileRoot, 'edge-profile-')), timeout: 30000, args: ['--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    try { await page.waitForFunction(() => window.ready, { timeout: 10000 }); } catch (error) { fs.writeFileSync(process.env.SP_DETAIL_PANEL_REPORT,JSON.stringify({ok:false,error:error.message,errors,html:await page.content()},null,2)); throw error; }
    await page.evaluate(() => window.mount('three'));
    await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.startsWith('装备'))?.click());
    const three = await page.evaluate(() => ({
      main: document.querySelector('.ix-dchips__lv')?.textContent || '', temporary: document.querySelector('.ix-dchips__temporary')?.textContent || '',
      tab: [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.startsWith('装备'))?.textContent || '',
      field: document.querySelector('#badge-root .ix-badge .num')?.textContent || '',
      tempTileCount: document.querySelectorAll('.ix-dgear__temporary-tag').length,
    }));
    assert.equal(three.main, '装备叠加 ×8'); assert.equal(three.temporary, '临时装备 ×3'); assert.match(three.tab, /装备\s*8/); assert.equal(three.field, '×8'); assert.equal(three.tempTileCount, 2);
    await page.evaluate(() => window.mount('four'));
    const increased = await page.evaluate(() => ({ main: document.querySelector('.ix-dchips__lv')?.textContent || '', tab: [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.startsWith('装备'))?.textContent || '', field: document.querySelector('#badge-root .ix-badge .num')?.textContent || '' }));
    assert.equal(increased.main, '装备叠加 ×9'); assert.match(increased.tab, /装备\s*9/); assert.equal(increased.field, '×9');
    await page.evaluate(() => window.mount('none'));
    const afterBattle = await page.evaluate(() => ({ main: document.querySelector('.ix-dchips__lv')?.textContent || '', temporary: !!document.querySelector('.ix-dchips__temporary'), field: document.querySelector('#badge-root .ix-badge .num')?.textContent || '' }));
    assert.equal(afterBattle.main, '装备叠加 ×5'); assert.equal(afterBattle.temporary, false); assert.equal(afterBattle.field, '×5');
    await page.evaluate(() => window.mount('levels', 'levels'));
    await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.startsWith('装备'))?.click());
    const training = await page.evaluate(() => ({ main: document.querySelector('.ix-dchips__lv')?.textContent || '', tab: [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.startsWith('装备'))?.textContent || '', training: document.querySelector('[aria-label="临时训练等级"]')?.textContent || '', field: document.querySelector('#badge-root .ix-badge .num')?.textContent || '' }));
    assert.equal(training.main, '装备叠加 ×5'); assert.match(training.tab, /装备\s*5/); assert.match(training.training, /\+8/); assert.equal(training.field, '×5'); assert.deepEqual(errors, []);
    if (process.env.SP_DETAIL_PANEL_REPORT) fs.writeFileSync(process.env.SP_DETAIL_PANEL_REPORT, JSON.stringify({ ok: true, three, increased, afterBattle, training, errors }, null, 2) + '\n');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
