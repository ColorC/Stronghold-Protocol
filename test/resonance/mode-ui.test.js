import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(file)=>fs.readFileSync(path.join(ROOT,file),'utf8');
const app=read('public/js/resonance/app.js');
const html=read('public/resonance.html');
const gameCss=read('public/css/resonance.css');
const detailCss=read('public/css/resonance-detail.css');
const entryCss=read('public/css/resonance-entry.css');
const api=read('public/js/resonance/api.js');
const codex=read('public/js/resonance/codex.js');
const panels=read('public/js/resonance/panels.js');
const detail=read('public/js/resonance/detail.js');
const chrome=read('public/js/resonance/gameChrome.js');
const model=read('public/js/resonance/model.js');

test('entry is title, difficulty (1/2), native briefing (2/2), then preparation; legacy extra-step URLs return to difficulty',()=>{
 assert.match(app,/\['difficulty', 'environment', 'briefing'\]\.includes\(stepName\) \? 1 : 0/);
 assert.match(app,/const names = \{ 1: 'difficulty' \}/);
 // 选择难度是第 1 步，原生「确认本局信息」是第 2 步（共两步），之后直接备战
 assert.match(app,/step=\$\{step\} of=\$\{2\}/);
 assert.match(app,/onClick=\$\{start\}>开始备战/);
 assert.match(app,/if \(creatingSession\.current \|\| !seedValid \|\| step !== 1 \|\| catalogKey !== String\(numericSeed\)\) return/);
 assert.match(app,/disabled=\$\{busy \|\| !catalogReady\} loading=\$\{busy\} onClick=\$\{start\}/);
 assert.doesNotMatch(app,/rs-flow--briefing|本局简报|查看本局简报|确认并开始本局|setStep\(2\)/);
 assert.doesNotMatch(entryCss,/rs-flow--briefing|rs-opening-event|rs-brief-(?:identity|pact|prep|route)/);
 assert.doesNotMatch(app,/选择战场|本局推荐战场|主盟约/);
});

test('HTML stylesheet imports keep native screens before local overrides without late duplicate links',()=>{
 assert.match(html,/<link rel="stylesheet" href="\.\/css\/resonance\.css"\s*\/>/);
 assert.doesNotMatch(app,/document\.createElement\('link'\)|const styles = \[/,'app does not append a second screen stylesheet stack');
 for(const screen of ['game','game-shop','game-panels','title','lobby','draft','result','loadout']){
  assert.ok(gameCss.includes(`@import url("./resonance-native/screens/${screen}.css")`),`${screen} uses its native stylesheet`);
 }
 assert.ok(gameCss.includes('@import url("./resonance-entry.css")'));
 assert.ok(gameCss.includes('@import url("./resonance-detail.css")'));
 assert.ok(detailCss.includes("@import url('./resonance-native/screens/game-panels.css')"));
 assert.doesNotMatch(detailCss,/\/css\/screens\/game-panels\.css/);
 assert.match(detailCss,/\.rs-game \.rs-detail-panel\{[^}]*top:[^}]*bottom:[^}]*max-height:none/);
});

test('seed refresh disables creation until matching catalog data resolves and resume/codex stay independent',()=>{
 assert.match(app,/if \(!seedValid\) \{ setCatalogKey\(''\); return; \}/);
 assert.match(app,/const requestedSeed = numericSeed;\s*setCatalogKey\(''\);\s*const response = await resonanceApi\.catalog\(requestedSeed\)/);
 assert.match(app,/if \(!alive\) return;[\s\S]*setCatalogKey\(String\(requestedSeed\)\)/);
 assert.match(app,/useState\(\(\) => query\.has\('session'\) \? 0 : stepFromUrl\)/);
 assert.match(app,/const openCodex = \(\) => showCodex\('operators'\)/);
 assert.match(app,/label: busy \? '正在载入…' : '继续上一局'/);
 assert.match(app,/creatingSession\.current = false; setBusy\(false\)/);
});

test('catalog and create requests do not send an environment selection',()=>{
 assert.match(api,/catalog: \(seed = 1\) =>/);
 assert.doesNotMatch(api,/environmentId/);
 assert.match(api,/create: \(\{ seed, difficulty \}\).*JSON\.stringify\(\{ seed, difficulty \}\)/);
 assert.match(app,/resonanceApi\.catalog\(requestedSeed\)/);
 assert.match(app,/resonanceApi\.create\(\{ seed: numericSeed, difficulty \}\)/);
 assert.match(app,/url\.searchParams\.delete\('environment'\)/);
});

test('automatic opening event remains seed-bound, with details in the game HUD, codex and saved-game header',()=>{
 assert.match(app,/catalog\.openingEvent/);
 assert.match(app,/catalogReady = seedValid && catalogKey === String\(numericSeed\) && !!openingEvent/);
 assert.doesNotMatch(app,/kind: 'opening'/);
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

test('resonance briefing shows the season bonds instead of native core/add-on bonds and bans, and no loadout',()=>{
 const screen=read('public/js/resonance/native-match-screen.js');
 const brief=read('public/js/resonance/seasonBondsBrief.js');
 assert.match(screen,/BriefingScreen\} step=\$\{2\} of=\$\{2\} loadout=\$\{false\}/);
 assert.match(screen,/SeasonBondsBrief\} catalog=\$\{seasonCatalog\}/);
 assert.match(brief,/阵营盟约/);assert.match(brief,/职业与机制盟约/);
 assert.doesNotMatch(brief,/import[^;]*(MatchInfo|BannedOperators)|bannedChess/);
});

test('native 🔍▶▶ opens the pen only with enemies to meet and lists them by name × count there',()=>{
 const screen=read('public/js/resonance/native-match-screen.js');
 assert.match(screen,/const penAvail = phase === PHASE\.PREP && !!view && viewKind !== 'loading' && !!priv\?\.nextEnemies\?\.length;/);
 assert.match(screen,/\$\{pen \? html`<\$\{PenEnemyList\} list=\$\{priv\?\.nextEnemies\} onEnemy=\$\{\(k, n\) => setDetail\(\{ kind: 'enemy', id: k, count: n \}\)\}/);
 assert.match(screen,/<header class="rs-pen-enemies__head"><b>下一场遭遇<\/b><span>即将迎击 <b class="num">\$\{total\}<\/b> 名敌人<\/span><\/header>/);
 assert.match(screen,/<b class="erow__count num">×\$\{r\.count\}<\/b>/);
 assert.match(gameCss,/\.rs-native-match \.rs-pen-enemies \{ position: absolute;/);
});
