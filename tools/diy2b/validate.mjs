// node validate.mjs <servedRoot> "<validate.html query>"
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const puppeteer = createRequire('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/package.json')('puppeteer-core');
const [root, query, out] = process.argv.slice(2);
const exe = 'C:/Users/lilithgames/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.atlas': 'text/plain', '.json': 'application/json' };
const tools = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const vendor = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/public/vendor';
const srv = http.createServer((q, s) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = /^\/tools\/pixi(?:-spine|\.min)\.js$/.test(u) ? path.join(vendor, path.basename(u)) : u.startsWith('/tools/') ? path.join(tools, u.slice(7)) : path.join(root, u); fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(b); }); }).listen(0);
const br = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage(); pg.on('pageerror', e => console.log('pageerror:', e.message));
await pg.goto(`http://127.0.0.1:${srv.address().port}/tools/validate.html?${query}`);
await pg.waitForFunction(() => document.title === "ready" || document.title.startsWith("error"), { timeout: 60000 }).catch(async e => { console.log("timeout; title:", await pg.title()); throw e; });
const title = await pg.title(); if (title !== 'ready') { console.log(title); process.exit(1); }
console.log(JSON.stringify(await pg.evaluate(() => window.info))); 
await br.close(); srv.close();
