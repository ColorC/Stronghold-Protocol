import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {resonanceDisplayCatalog} from '../../server/modes/resonance/display.js';
import {getActivePrototypeSeason} from '../../shared/resonance/season-registry.js';
import {STRATEGY_UI_ICONS,strategyIcon,strategyPactId,strategyEmblemId,resolveStrategyIconUrl} from '../../public/js/resonance/strategyIconMap.js';
import {fileURLToPath} from 'node:url';
import {choiceDescription,strategyConditionNote} from '../../public/js/resonance/model.js';

const INSTALL='E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const data=loadData(path.join(INSTALL,'data/resonance-native'));
const bonds=Object.values(data.bonds);
const season=getActivePrototypeSeason();
const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:season.id,seed:13});
const display=resonanceDisplayCatalog(catalog,data);
const REPO=fileURLToPath(new URL('../../',import.meta.url));
// mode art (emblem badges under /css/) ships with this checkout; native art (/assets/) lives in the install
const fileOf=(url)=>[path.join(REPO,'public',url),path.join(INSTALL,'public',url)].find(file=>fs.existsSync(file))??path.join(REPO,'public',url);

test('every current-season strategy resolves to an existing icon file, the same from the raw and the display catalog',()=>{
 const ids=Object.keys(catalog.strategies);
 assert.ok(ids.length>=50,`season ${season.id} has its strategy pool`);
 for(const id of ids){
  const raw=resolveStrategyIconUrl(catalog,id,data.assets,bonds),shown=resolveStrategyIconUrl(display,id,data.assets,bonds);
  assert.ok(shown,`${id} has an icon`);
  assert.ok(fs.existsSync(fileOf(shown)),`${id} icon ${shown} exists`);
  assert.equal(raw,shown,`${id}: the client (display catalog) shows the icon the strategy's own effects choose`);
  assert.deepEqual(strategyIcon(display,id),strategyIcon(catalog,id),id);
 }
});

test('徽记 / 王冠 strategies show the emblem they hand out; other pact strategies their pact icon; gold, experience and refresh strategies the HUD art; the rest the group icon',()=>{
 let emblems=0;
 for(const [id,strategy] of Object.entries(catalog.strategies)){
  const effect=strategy.effects?.[0],params=effect?.params??{};
  const pactId=[params.traitId,params.prototypeTraitId].find(value=>value&&catalog.pacts[value])??null;
  assert.equal(strategyPactId(display,id),pactId,id);
  if(effect?.kind==='choose_transfer'){
   const itemId=params.itemIds[0];
   assert.equal(catalog.equipment[itemId].kind,'emblem',id);
   assert.equal(strategyEmblemId(display,id),itemId,id);
   assert.deepEqual(strategyIcon(display,id),{kind:'emblem',itemId,pactId},id);
   assert.equal(resolveStrategyIconUrl(display,id,data.assets,bonds),`/css/resonance-emblems/${pactId}.webp`,`${id}: the inventory's badge for ${itemId}`);
   emblems++;
  }else if(pactId)assert.deepEqual(strategyIcon(display,id),{kind:'pact',pactId},id);
 }
 assert.ok(emblems>=40,'every 徽记 and 王冠 strategy');
 const theme=(id)=>strategyIcon(display,id).theme;
 assert.equal(strategyIcon(display,'prototype_set13_academycrest').itemId,'prototype_emblem_academy','拉特兰徽记 → the 拉特兰徽记 badge');
 assert.equal(strategyIcon(display,'prototype_set13_snipercrown').itemId,'prototype_emblem_ammo','狙击王冠 → the 狙击徽记 badge');
 assert.equal(strategyIcon(display,'prototype_set13_quickstriker').pactId,'combo','迅击爆发 → 迅击');
 assert.equal(strategyIcon(display,'prototype_source_pitfighter').pactId,'bruiser','重装成长 → 重装');
 for(const id of ['prototype_source_raininggold','prototype_source_raininggoldplus','prototype_source_goinglong'])assert.equal(theme(id),'gold',id);
 for(const id of ['prototype_source_epoch','prototype_source_epochplus','prototype_source_clearmind','prototype_source_maxlevel10','prototype_source_learningfromexperience2'])assert.equal(theme(id),'xp',id);
 for(const id of ['prototype_source_tradesector','prototype_source_highendsector'])assert.equal(theme(id),'refresh',id);
 assert.deepEqual(strategyIcon({strategies:{x:{name:'未知',effectKind:'something_new'}}},'x'),{kind:'ui',theme:'group',...STRATEGY_UI_ICONS.group});
 for(const icon of Object.values(STRATEGY_UI_ICONS))assert.ok(fs.existsSync(fileOf(data.assets.ui[icon.key])),icon.key);
});

test('strategy cards carry no 时点 line and show 条件 only for a real condition',()=>{
 for(const id of Object.keys(display.strategies)){
  const text=choiceDescription({type:'strategy'},id,{},display);
  assert.ok(!text.includes('时点'),`${id}: ${text}`);
  if(display.strategies[id].conditionKind==='always')assert.ok(!text.includes('条件'),`${id}: ${text}`);
 }
 assert.equal(strategyConditionNote({condition:'无额外前提',conditionKind:'always'}),'');
 assert.equal(strategyConditionNote({condition:{kind:'always'}}),'');
 assert.equal(strategyConditionNote({condition:{kind:'gold_min',params:{value:8}}}),'至少持有8金币可选');
});
