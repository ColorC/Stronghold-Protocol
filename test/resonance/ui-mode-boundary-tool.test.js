import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getSeasonCampaignCatalog } from '../../tools/resonance/balance-campaign.mjs';
import { createSession, applyAction } from '../../server/modes/resonance/session.js';
import { selectResonanceOpening } from '../../shared/resonance/openings.js';

const script=fileURLToPath(new URL('../../tools/resonance/ui-flow-check.mjs',import.meta.url));
const source=await readFile(script,'utf8');
const validate=(args)=>spawnSync(process.execPath,[script,...args,'--validate-args'],{encoding:'utf8',timeout:10000});

test('mode boundary validates without loading a browser or creating a session',()=>{
  const result=validate(['--mode-boundary']);assert.equal(result.status,0,result.stderr);
  const value=JSON.parse(result.stdout);assert.equal(value.mode,'mode-boundary');assert.equal(value.browserStarted,false);
  assert.equal(value.maxCreates,1);assert.equal(value.maxFights,1);assert.equal(value.deadlineMs,600000);assert.equal(value.opening,'cheaper_levels');
  assert.equal(value.report.replaceAll('\\','/'),'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/resonance/ui-verification/ui-mode-boundary-receipt.json');
  assert.equal(value.data.replaceAll('\\','/'),'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
});

test('prior replay inspection reuses an open native replay and checks action-count deltas',()=>{
  const start=source.indexOf('async function inspectPriorFightReplay('),end=source.indexOf('\nasync function runFinishTail(',start);
  assert.ok(start>=0&&end>start,'inspection helper exists');
  const helper=source.slice(start,end);
  const opened=helper.indexOf("if(!await page.$(replaySelector)){");
  const reportClick=helper.indexOf("clickVisibleButtonText(page,'.rs-dock','战报','prior-fight-report-opener')");
  const countsStart=helper.indexOf('const actionCountsAtStart={creates:receipt.creates,fights:receipt.fights};');
  const countDelta=helper.indexOf('actionCountsAfter.creates===actionCountsAtStart.creates&&actionCountsAfter.fights===actionCountsAtStart.fights');
  assert.ok(opened>=0&&reportClick>opened,'report navigation only runs when the native replay is not already open');
  assert.ok(countsStart>=0&&countDelta>countsStart,'read-only inspection preserves its starting create/fight counts');
  assert.match(helper,/readonlyRemainsZero=.*actionCountsAtStart\.creates!==0\|\|actionCountsAtStart\.fights!==0/,'a zero-action inspection still asserts that both totals remain zero');
});

test('mode boundary rejects all old or external session entry points before work',()=>{
  for(const args of [['--url','http://127.0.0.1:1234/resonance.html'],['--session','aaaaaaaa-1111'],['--created-session','aaaaaaaa-1111'],['--resume-tail','aaaaaaaa-1111'],['--finish-tail','aaaaaaaa-1111'],['--battle-ui']]){
    const result=validate(['--mode-boundary',...args]);assert.notEqual(result.status,0);assert.match(result.stderr,/isolated, local/);assert.equal(result.stdout,'');
  }
});

test('existing browser flow parameter combinations retain their earlier meaning',()=>{
  for(const args of [[],['--session','aaaaaaaa-1111'],['--resume-tail','aaaaaaaa-1111'],['--finish-tail','aaaaaaaa-1111'],['--url','http://127.0.0.1:1234/resonance.html','--battle-ui','--created-session','aaaaaaaa-1111']]){
    const result=validate(args);assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.mode,'legacy');assert.equal(value.browserStarted,false);assert.doesNotMatch(value.report,/ui-mode-boundary/);
  }
});

test('duplicate and unknown mode parameters fail before any work',()=>{
  for(const args of [['--mode-boundary','--mode-boundary'],['--mode-boundary','--opening','cheaper_levels'],['--mode-boundary','--seed','0'],['--mode-boundary','--unknown'],['--session','../outside']]){
    const result=validate(args);assert.notEqual(result.status,0);assert.match(result.stderr,/no work started/);assert.equal(result.stdout,'');
  }
});

test('the deterministic growth seed funds the real one-cost purchase and four-XP flow',()=>{
  assert.equal(selectResonanceOpening(1),'cheaper_levels');
  const catalog=getSeasonCampaignCatalog(1);const created=createSession({seed:1,difficulty:'NORMAL',catalog});assert.equal(created.ok,true);
  const offer=created.state.shop.offers.find(offer=>offer.cost===1);assert.ok(offer,'seed must have a legal one-cost offer without paid refresh');
  assert.equal(created.state.gold,5);assert.equal(created.state.inventory.length>=1,true);assert.equal(created.state.pieces.length,3);
  const bought=applyAction(created.state,{type:'buy',offerUid:offer.uid},{catalog});assert.equal(bought.ok,true);assert.equal(bought.state.gold,4);
  const xp=applyAction(bought.state,{type:'buyXp'},{catalog});assert.equal(xp.ok,true);assert.equal(xp.state.gold,0);assert.equal(xp.state.level,4);
  assert.ok(xp.events.some(event=>event.type==='xp-purchased'&&event.gold===4&&event.xp===4));
});
