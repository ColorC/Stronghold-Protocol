import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { modeIdFor } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.NATIVE_SUMMON_E2E === '1';

function preparedVigil(mode, data, catalog) {
  const op = Object.values(catalog.operators).find((x) => x.name === '伺夜' && !x.elite);
  assert.ok(op, 'Vigil exists in the current operator catalog');
  const tokenId = 'token_10028_vigil_wolf';
  const gd = new GameData(data, modeIdFor('solo', 'NORMAL'));
  const skillIndex = [0, 1, 2].find((i) => gd.placeableTokens(op.chessId, { skillIndex: i, moduleId: 'none' }).some((t) => t.tokenId === tokenId));
  assert.notEqual(skillIndex, undefined, 'the selected native loadout grants a placeable wolf stack');
  let state = createSession({ seed: mode === 'badges' ? 81211 : 81212, growthMode: mode });
  state.growthMode = mode;
  state.shop.slots[0] = { ...state.shop.slots[0], kind: 'chess', id: op.chessId, sold: false, price: 3 };
  state.pool[op.chessId] ||= { left: 5, cap: 5 };
  state.funds = Math.max(3, state.funds);
  let action = applyAction(state, { type: 'buy', slot: 0 });
  assert.equal(action.ok, true, action.error?.message); state = action.state;
  const owner = state.pieces[0]; owner.skillIndex = skillIndex;
  const ownerTile = viewSession(state, { data, catalog }).pieces.find((x) => x.uid === owner.uid).legalTiles[0].split(',').map(Number);
  action = applyAction(state, { type: 'move', uid: owner.uid, row: ownerTile[0], col: ownerTile[1] });
  assert.equal(action.ok, true, action.error?.message); state = action.state;
  const stack = state.summons.find((x) => x.ownerUid === owner.uid && x.tokenId === tokenId);
  assert.ok(stack, 'deployment produced the real native stack');
  const tokenView = viewSession(state, { data, catalog }).pieces.find((x) => x.uid === stack.uid);
  const tokenRaw = data.tokens[tokenId];
  assert.equal(tokenRaw.ownerRange, true, 'the tested marker uses an original summon with ownerRange');
  assert.ok(tokenView.legalTiles.length);
  return { state, owner, stack, op, tokenId, tokenView, view: viewSession(state, { data, catalog }), legalTiles: tokenView.legalTiles };
}

function preparedWorkshopProjection(data, catalog) {
  const source = id => Object.values(catalog.operators).find(op => !op.elite && op.sourceRefs?.darkmoon19_2?.id === id);
  const trainer = source('BGS_021'); const summoner = source('CFM_316');
  assert.ok(trainer && summoner, 'real BGS021 trainer and CFM316 token source exist');
  let state = createSession({ seed: 82131, growthMode: 'levels' }); state.growthMode = 'levels'; state.funds = 30;
  for (const [slot, op] of [[0, trainer], [1, summoner]]) {
    state.shop.slots[slot] = { ...state.shop.slots[slot], kind: 'chess', id: op.chessId, sold: false, price: 3 };
    state.pool[op.chessId] ||= { left: 5, cap: 5 };
    const bought = applyAction(state, { type: 'buy', slot }, { catalog });
    assert.equal(bought.ok, true, bought.error?.message); state = bought.state;
  }
  for (const piece of [...state.pieces]) {
    const cells = viewSession(state, { data, catalog }).pieces.find(x => x.uid === piece.uid).legalTiles;
    assert.ok(cells.length, `${piece.chessId} has a legal deployment cell`);
    const [row, col] = cells[0].split(',').map(Number);
    const moved = applyAction(state, { type: 'move', uid: piece.uid, row, col }, { catalog });
    assert.equal(moved.ok, true, moved.error?.message); state = moved.state;
  }
  const preparedView = viewSession(state, { data, catalog });
  const ready = applyAction(state, { type: 'ready' }, { catalog });
  assert.equal(ready.ok, true, ready.error?.message);
  const units = ready.replay.field?.units || [];
  const projection = units.find(u => u.kind === 'token' && u.defId === 'token_10028_vigil_wolf' && u.name === '狼群投影');
  assert.ok(projection, `real CFM316 deployment creates a Workshop wolf projection; actors=${JSON.stringify(units.map(u => ({ kind: u.kind, defId: u.defId, name: u.name, ownerName: u.ownerName })))}`);
  assert.equal(projection.ownerName, summoner.name, 'the projection is attributed to the actual CFM316 summoner; BGS021 only supplies its training');
  const live = [...(ready.replay.frames || [])].reverse().map(frame => frame.stats?.[projection.id]).find(Boolean);
  assert.ok(live && Number.isFinite(live.atk), 'battle replay records the projected token live attack');
  const native = data.tokens.token_10028_vigil_wolf;
  const prototypeOwner = 'chess_char_3_19_a';
  const baseAttack = Math.round(native.variants[prototypeOwner].stats.atk * 0.4);
  assert.ok(live.atk > baseAttack, `opening training raises projected attack above untrained ${baseAttack}`);
  return { state: preparedView, unit: projection, live, baseAttack, trainerName: trainer.name };
}

test('native summon marker is mouse-placed within owner range, details identify its owner, and battle retains it in both growth modes', {
  skip: enabled ? false : 'set NATIVE_SUMMON_E2E=1 for real Chromium UI verification', timeout: 180000,
}, async () => {
  const data = getData(); const catalog = getCatalog(data);
  const installationRoot = path.resolve(process.env.SP_INSTALL_ROOT || path.join(ROOT, '../..'));
  const fixtures = Object.fromEntries(['badges', 'levels'].map((mode) => [mode, preparedVigil(mode, data, catalog)]));
  const workshopProjection = preparedWorkshopProjection(data, catalog);
  const states = Object.fromEntries(Object.entries(fixtures).map(([mode, f]) => [mode, f.state]));
  const browserReport = process.env.NATIVE_SUMMON_REPORT;
  const screenshotDir = process.env.NATIVE_SUMMON_SCREENSHOT_DIR;
  const browserErrors = [];
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/game-panels.css"><link rel="stylesheet" href="/css/independent.css"><style>
    body{font:16px sans-serif;background:#15202b;color:#f2f5f6;padding:24px}.board{display:grid;grid-template-columns:repeat(8,64px);gap:8px;margin:24px 0}.tile{width:64px;height:64px;border:1px solid #687984;background:#243541;color:white}.tile.legal{outline:3px solid #49cdab}.card{display:inline-flex;padding:16px;border:1px solid #d6b566;background:#293b47;cursor:grab}#root{max-width:760px}
  </style></head><body><main><p>原生召唤标记浏览器验收</p><section id="fixture-scope"></section><section id="hand"></section><section class="board" id="board"></section><div id="root"></div></main><script type="module">
    import { h, render } from '/vendor/preact.module.js';
    import { DetailCard } from '/js/independent/detail.js';
    import { loadData } from '/js/data.js';
    await loadData('chess','assets','bonds','items','tokens','enemies','config');
    const qs=new URLSearchParams(location.search);const mode=qs.get('mode')||'badges';const fixture=await(await fetch('/fixture?mode='+mode)).json();
    window.fixture=fixture;window.dragUid=null;document.querySelector('#fixture-scope').textContent='受控浏览器UI fixture：真实 catalog/session/API 状态；为流程验证预置伺夜并部署主人，不代表完整3D实战局。成长模式：'+mode;
    const hand=document.querySelector('#hand'),board=document.querySelector('#board');
    const card=document.createElement('div');card.className='card';card.id='native-token';card.textContent=fixture.token.name+' ×'+fixture.stack.count+' · 主人 '+fixture.ownerName;card.setAttribute('draggable','false');card.onpointerdown=()=>{window.dragUid=fixture.stack.uid};hand.append(card);
    for(const key of fixture.legalTiles){const cell=document.createElement('button');cell.className='tile legal';cell.dataset.tile=key;cell.textContent='可放置';cell.onpointerup=async()=>{if(!window.dragUid)return;const [row,col]=cell.dataset.tile.split(',').map(Number);const res=await fetch('/action?mode='+mode,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'move',uid:window.dragUid,row,col})}).then(r=>r.json());window.dropResult=res;window.dragUid=null;if(res.ok){cell.textContent='狼群已放置';cell.dataset.placed='true';window.fixture.view=res.view;window.openDetails()}else cell.textContent='操作失败：'+res.error?.code};board.append(cell)}
    window.openDetails=()=>{const state=window.fixture.view;const token=state.pieces.find(p=>p.uid===fixture.stack.uid);render(h(DetailCard,{catalog:fixture.catalog,state,target:{kind:'piece',uid:token.uid},busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){}}),document.querySelector('#root'))};
    window.mountProjection=(projection)=>{const live={...projection.live,src:'battle'};const battle={stats:()=>live,snapHp:()=>({hp:projection.unit.maxHp,max:projection.unit.maxHp})};render(h(DetailCard,{catalog:window.fixture.catalog,state:projection.state,target:{kind:'unit',unit:projection.unit},battle,busy:false,onClose(){},onAct(){},onInherit(){},onBuy(){},onEquipHere(){}}),document.querySelector('#root'))};
    window.readyBattle=async()=>fetch('/ready?mode='+mode,{method:'POST'}).then(r=>r.json()).then(x=>window.battleResult=x);
    window.initialized=true;
  </script></body></html>`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (value) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(html); }
    if (url.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    if (url.pathname === '/fixture') {
      const mode = url.searchParams.get('mode'); const f = fixtures[mode];
      if (!f) { res.statusCode = 404; return json({ error: 'BAD_MODE' }); }
      return json({ mode, catalog, view: f.view, stack: f.stack, ownerName: f.op.name, legalTiles: f.legalTiles, token: data.tokens[f.tokenId],
        fixtureScope: 'test-only prepared session with a native owner; all placements, details and battle execution use current server functions' });
    }
    if (url.pathname === '/projection') return json(workshopProjection);
    if (url.pathname === '/action' && req.method === 'POST') {
      const mode = url.searchParams.get('mode'); let body = '';
      for await (const chunk of req) body += chunk;
      const result = applyAction(states[mode], JSON.parse(body));
      if (result.ok) states[mode] = result.state;
      return json({ ok: result.ok, error: result.error, view: result.ok ? viewSession(result.state, { data, catalog }) : null });
    }
    if (url.pathname === '/ready' && req.method === 'POST') {
      const mode = url.searchParams.get('mode'); const result = applyAction(states[mode], { type: 'ready' });
      if (!result.ok) return json({ ok: false, error: result.error });
      states[mode] = result.state;
      return json({ ok: true, replay: result.replay, replayText: JSON.stringify(result.replay), summary: result.state.battleSummary });
    }
    if (url.pathname.startsWith('/data/')) {
      const file = path.join(ROOT, 'data', path.basename(url.pathname));
      if (fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader('content-type', 'application/json'); return fs.createReadStream(file).pipe(res); }
    }
    const file = url.pathname.startsWith('/shared/')
      ? path.join(ROOT, url.pathname.replace(/^\//, ''))
      : path.join(url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') ? installationRoot : ROOT, 'public', url.pathname.replace(/^\//, ''));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const types = { '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
      res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
      return fs.createReadStream(file).pipe(res);
    }
    res.statusCode = 404; return res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puppeteer = (await import('puppeteer-core')).default;
  let browser; let context; let owned = false; const screenshots = [];
  try {
    if (process.env.SP_DETAIL_PANEL_CDP) { browser = await puppeteer.connect({ browserURL: process.env.SP_DETAIL_PANEL_CDP }); context = await browser.createBrowserContext(); }
    else {
      owned = true;
      browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', headless: true, timeout: 150000, args: ['--no-sandbox','--disable-gpu','--disable-software-rasterizer'] });
      context = await browser.createBrowserContext();
    }
    const results = [];
    for (const mode of ['badges', 'levels']) {
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => browserErrors.push(e.message)); page.on('console', m => { if (m.type() === 'error') browserErrors.push(m.text()); }); page.on('requestfailed', r => browserErrors.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`)); page.on('response', r => { if (r.status() >= 400) browserErrors.push(`http ${r.status()} ${r.url()}`); });
      await page.setViewport({ width: 1100, height: 900 });
      await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`, { waitUntil: 'domcontentloaded' });
      try { await page.waitForFunction(() => window.initialized); }
      catch (error) { throw new Error(`browser init failed ${mode}: ${error.message}; errors=${JSON.stringify(browserErrors)}`); }
      const shown = await page.$eval('#native-token', x => x.textContent);
      assert.match(shown, /狼群.*主人 伺夜/, `${mode}: real native token stack is visible with its owner`);
      const target = await page.$eval('.tile.legal', el => { const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,tile:el.dataset.tile}; });
      const source = await page.$eval('#native-token', el => { const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
      await page.mouse.move(source.x, source.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
      await page.waitForFunction(() => window.dropResult?.ok === true);
      const detail = await page.$eval('#root', el => el.textContent);
      assert.match(detail, /伺夜/, `${mode}: actual owner is shown after placement`);
      assert.match(detail, /战斗部署|召唤/, `${mode}: detail carries its source`);
      assert.match(detail, /攻击|生命上限/, `${mode}: detail shows token stats`);
      const prepScreenshot = path.join(screenshotDir || os.tmpdir(), `native-token-${mode}-prep.png`);
      fs.mkdirSync(path.dirname(prepScreenshot), { recursive: true }); await page.screenshot({ path: prepScreenshot, fullPage: true }); screenshots.push(prepScreenshot);
      const battle = await page.evaluate(() => window.readyBattle());
      assert.equal(battle.ok, true, `${mode}: normal ready action runs a real battle`);
      assert.match(battle.replayText, /狼群/, `${mode}: ready replay contains the native wolf`);
      assert.match(battle.replayText, new RegExp(fixtures[mode].owner.uid), `${mode}: replay preserves the owner uid`);
      const battleScreenshot = path.join(screenshotDir || os.tmpdir(), `native-token-${mode}-battle-result.png`);
      await page.evaluate(() => { document.querySelector('#fixture-scope').textContent += ' · 实战结算已完成'; document.querySelector('#root').textContent='战斗回放已生成，狼群与伺夜主人关系见服务端回放。'; });
      await page.screenshot({ path: battleScreenshot, fullPage: true }); screenshots.push(battleScreenshot);
      results.push({ mode, legalTile: target.tile, owner: '伺夜', token: '狼群', battleRan: true, replayContainsToken: true, replayContainsOwner: true });
      await page.close();
    }
    const projectionPage = await context.newPage(); projectionPage.setDefaultTimeout(15000);
    projectionPage.on('pageerror', e => browserErrors.push(e.message));
    projectionPage.on('console', m => { if (m.type() === 'error') browserErrors.push(m.text()); });
    projectionPage.on('requestfailed', r => browserErrors.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`));
    projectionPage.on('response', r => { if (r.status() >= 400) browserErrors.push(`http ${r.status()} ${r.url()}`); });
    await projectionPage.setViewport({ width: 1100, height: 900 });
    await projectionPage.goto(`http://127.0.0.1:${server.address().port}/?mode=levels`, { waitUntil: 'domcontentloaded' });
    await projectionPage.waitForFunction(() => window.initialized);
    const projection = await projectionPage.evaluate(async () => fetch('/projection').then(r => r.json()));
    await projectionPage.evaluate(({ projection }) => {
      window.mountProjection(projection);
      document.querySelector('#fixture-scope').textContent = '受控Workshop投影详情fixture：CFM316实际生成狼群、BGS021开战训练及回放属性；不代表完整3D实战局。';
    }, { projection });
    const projectionText = await projectionPage.$eval('#root', el => el.textContent);
    assert.match(projectionText, /狼群投影/, JSON.stringify({ unit: workshopProjection.unit, live: workshopProjection.live }));
    assert.match(projectionText, /原型：狼群/);
    assert.match(projectionText, new RegExp(workshopProjection.unit.ownerName));
    assert.match(projectionText, /额外特质生成/);
    assert.doesNotMatch(projectionText, /技能/,'the effective projected token has no installed skill, so its prototype record is not used as a fallback');
    assert.doesNotMatch(projectionText, /攻击范围/,'the all-board Workshop projection must not show native ownerRange placement text');
    assert.match(projectionText, new RegExp(`攻击\\s*${workshopProjection.live.atk}`),'the detail uses the post-training replay attack');
    assert.match(projectionText, /攻击间隔\s*1\.25/,'the displayed attack interval preserves the battle actor value');
    const projectionScreenshot = path.join(screenshotDir || os.tmpdir(), 'workshop-wolf-projection-trained-detail.png');
    fs.mkdirSync(path.dirname(projectionScreenshot), { recursive: true }); await projectionPage.screenshot({ path: projectionScreenshot, fullPage: true }); screenshots.push(projectionScreenshot);
    results.push({ mode: 'levels', fixtureScope: 'Workshop CFM316 projection + BGS021 opening training in a real Battle replay, presented through the real DetailCard; controlled UI fixture, not a full match', projection: workshopProjection.unit.name, owner: workshopProjection.unit.ownerName, baseAttack: workshopProjection.baseAttack, trainedAttack: workshopProjection.live.atk, showsEffectiveSkill: !!workshopProjection.unit.runtimeDetail?.skill });
    await projectionPage.close();
    if (browserReport) fs.writeFileSync(browserReport, JSON.stringify({ ok: true, browserConnectionMode: process.env.SP_DETAIL_PANEL_CDP ? 'shared-headless-browser-isolated-context' : 'owned-headless-browser-isolated-context', fixtureScope: '仅预置伺夜原生阵容与placeable狼群marker来测试浏览器放置/详情；服务端负责合法性与战斗，不代表完整3D游玩', results, screenshots, browserErrors }, null, 2)+'\n');
    assert.deepEqual(browserErrors, [], 'browser page has no errors');
  } finally {
    await context?.close(); if (owned) await browser?.close(); else browser?.disconnect(); await new Promise(resolve => server.close(resolve));
  }
});
