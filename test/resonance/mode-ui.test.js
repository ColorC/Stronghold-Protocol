import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(file)=>fs.readFileSync(path.join(ROOT,file),'utf8');
const app=read('public/js/resonance/app.js');
const api=read('public/js/resonance/api.js');
const codex=read('public/js/resonance/codex.js');
const panels=read('public/js/resonance/panels.js');
const detail=read('public/js/resonance/detail.js');
const chrome=read('public/js/resonance/gameChrome.js');
const model=read('public/js/resonance/model.js');

test('new entry path is difficulty then briefing, including legacy step URLs',()=>{
 assert.match(app,/stepName === 'difficulty' \? 1 : \['environment', 'briefing'\]\.includes\(stepName\) \? 2/);
 assert.match(app,/step=\$\{2\} title="本局简报"/);
 assert.match(app,/step=\$\{step\} of=\$\{2\}/);
 assert.match(app,/查看本局简报/);
 assert.match(app,/本赛季名单/);
 assert.match(app,/本赛季可招募干员 <b class="num">\$\{activeIds\.length\}/);
 assert.match(panels,/本赛季可招募 <b>\$\{activeIds\.length\}/);
 assert.doesNotMatch(app,/选择战场|本局推荐战场|主盟约/);
});

test('catalog and create requests do not send an environment selection',()=>{
 assert.match(api,/catalog: \(seed = 1\) =>/);
 assert.doesNotMatch(api,/environmentId/);
 assert.match(api,/create: \(\{ seed, difficulty \}\).*JSON\.stringify\(\{ seed, difficulty \}\)/);
 assert.match(app,/resonanceApi\.catalog\(requestedSeed\)/);
 assert.match(app,/resonanceApi\.create\(\{ seed: numericSeed, difficulty \}\)/);
 assert.match(app,/url\.searchParams\.delete\('environment'\)/);
});

test('opening event is shown in the brief, codex, detail, and saved-game header',()=>{
 assert.match(app,/catalog\.openingEvent/);
 assert.match(app,/kind: 'opening'/);
 assert.match(codex,/\['openingEvents','开局事件'\]/);
 assert.doesNotMatch(codex,/\['environments','环境'\]/);
 assert.match(panels,/group\('开局事件','opening',Object\.entries\(catalog\.openingEvents\)/);
 assert.match(detail,/kind==='opening'/);
 assert.match(detail,/旧局规则/);
 assert.doesNotMatch(detail,/catalog\.pacts\?\.\[environment\.identityPactId\]/);
 assert.match(chrome,/resolveOpeningEvent\(state,catalog\)/);
 assert.match(chrome,/kind:'opening'/);
 assert.match(model,/export function resolveOpeningEvent/);
});

test('economy reference shows three strategy nodes and opening event rewards',()=>{
 assert.match(panels,/strategyNodes=\(campaign\.strategyNodes\|\|\[\]\)\.slice\(0,3\)/);
 assert.match(panels,/开局事件与额外奖励/);
 assert.doesNotMatch(panels,/supply\.acceleratedStrategy/);
});

test('current action costs drive XP and free-refresh display without coin pricing',()=>{
 assert.match(chrome,/state\.actionCosts\?\.xpToLevel/);
 const passed=chrome.match(/freeRefreshes:([^\n]+?),level:/)?.[1]?.trim();assert.ok(passed,'ShopBar receives actual available refresh count');
 const expression=/^[a-zA-Z_$][\w$]*$/.test(passed)?chrome.match(new RegExp(`(?:const|let)\\s+${passed}\\s*=([^;\\n]+)`))?.[1]:passed;
 assert.ok(expression);const displayed=new Function('state',`return (${expression});`);
 assert.equal(displayed({actionCosts:{freeRefreshes:9},freeRefreshes:8}),9,'per-node entitlement plus stored balance');
 assert.equal(displayed({actionCosts:{freeRefreshes:1},freeRefreshes:0}),1,'independent per-node entitlement');
 assert.equal(displayed({actionCosts:{freeRefreshes:0,refreshGold:2},freeRefreshes:0}),0,'exhausted sources remain empty');
 assert.equal(displayed({actionCosts:{refreshGold:0}}),1,'legacy free-price fallback');
 assert.match(panels,/refreshLabel=freeRefreshes>0\?`免费 ×\$\{freeRefreshes\}`:refreshGold===0\?'免费'/);
});
