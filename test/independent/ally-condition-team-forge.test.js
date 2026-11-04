import test from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { nativeEffectFor, runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment, EQUIPMENT_CAPACITY, INVENTORY_CAPACITY } from '../../server/modes/independent/equipment.js';
import { traitSummary } from '../../server/modes/independent/summary.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const base = getCatalog();
const condition = (match = {}, more = {}) => ({ trigger: 'passive', behavior: 'allyConditionStats', params: { match, countBy: 'operators', maxCount: 2, stats: { attackPercent: 0.1 }, ...more } });
const forge = (more = {}) => ({ trigger: 'prepEnd', behavior: 'teamForge', params: { targets: 'all', excludeSelf: true, count: 2, sort: 'leastEquipment', outputs: [{ id: 'precision', normal: 2, elite: 4 }], ...more } });
const piece = (uid, row = 10, col = 3, more = {}) => ({ uid, chessId: `test_${uid}_a`, row, col, dir: 'RIGHT', skillIndex: 0, moduleId: 'none', equipment: [], attachments: [], nativeState: {}, ...more });

function fixture(pieces, rule, overrides = {}) {
  const operators = { ...base.operators }, chess = {};
  for (const p of pieces) {
    const rec = chessRec({ id: p.chessId, skill: null, stats: { atk: 100, maxHp: 1000, def: 100, aspd: 100 }, ...(overrides[p.uid] || {}) });
    if(overrides[p.uid]?.modules)rec.modules=overrides[p.uid].modules;
    chess[p.chessId] = rec;
    operators[p.chessId] = { chessId: p.chessId, source: { normalChess: rec, eliteChess: rec }, nativeFactionTags: p.factions || [], nativeTrait: { effect: { prep: [], combat: p.uid === 'w' ? [rule] : [] } } };
  }
  const catalog = { ...base, operators };
  const h = makeBattle({ content: 'none', units: pieces.map(({ uid, chessId, row, col }) => ({ uid, chessId, row, col })), defs: { chess }, autoFinish: false,
    flags: { independent: { catalog, pieces } }, extraContent: [(b) => installIndependentBattle(b, { catalog, state: { pieces } })] });
  h.step(1);
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  return { ...h, catalog, pieces };
}

test('condition excludes self/bench/other owner/nonoperators, caps, removes instantly and restores without stacking', () => {
  const h = fixture([piece('w'), piece('a',10,4), piece('b',11,3), piece('c',11,4), piece('bench',null,null)], condition());
  const w = h.unit('w');
  assert.equal(Math.round(w.s.atk),120);
  h.unit('a').ownerId = 'p2'; h.unit('b').kind = 'token'; h.unit('c').kind = 'device';
  h.run(0.25); assert.equal(w.s.atk,100);
  h.unit('a').ownerId = w.ownerId; h.unit('b').kind = 'op';
  h.run(0.25); assert.equal(Math.round(w.s.atk),120);
  h.b.kill(h.unit('a')); assert.equal(Math.round(w.s.atk),110);
  h.b.retreat(w); assert.equal(w.findBuff('independent:trait:w:0'),null);
  h.b.redeploy(w); h.step(1); assert.equal(Math.round(w.s.atk),110);
  h.b.retreat(w); h.b.redeploy(w); h.step(1); assert.equal(Math.round(w.s.atk),110);
  h.b.kill(w); assert.equal(w.findBuff('independent:trait:w:0'),null);
  assert.equal(h.b.independentRewards?.length || 0,0);
  assert.equal(h.pieces[0].equipment.length,0);
});

test('native profession and faction diversity deduplicate operators and identity factions', () => {
  const ident = Object.values(base.equipment).find((d) => d.mechanism === 'identityTag');
  assert.ok(ident);
  const pieces = [piece('w'), piece('a',10,4,{factions:['炎'],equipment:[{id:ident.id,quantity:1,state:{faction:'维多利亚'}}]}),piece('b',11,3,{factions:['炎']})];
  const h = fixture(pieces,condition({}, { countBy:'factions',maxCount:8 }));
  assert.equal(Math.round(h.unit('w').s.atk),120);
  pieces[1].equipment[0].state.faction='拉特兰'; h.run(0.25); assert.equal(Math.round(h.unit('w').s.atk),120);
  pieces[1].equipment=[]; h.run(0.25); assert.equal(Math.round(h.unit('w').s.atk),110);
  const prof = fixture([piece('w'),piece('a',10,4),piece('b',11,3),piece('c',11,4)], condition({ professions:['WARRIOR','MEDIC'] },{countBy:'professions',maxCount:8}),{c:{profession:'MEDIC'}});
  assert.equal(Math.round(prof.unit('w').s.atk),120);
  const faction = fixture(pieces,condition({faction:'拉特兰'}));
  assert.equal(faction.unit('w').s.atk,100);
  pieces[1].equipment=[{id:ident.id,quantity:1,state:{faction:'拉特兰'}}]; faction.run(0.25);
  assert.equal(Math.round(faction.unit('w').s.atk),110);
});

test('keyword gear counts a carrier once and requires the catalog mechanism, including elite stat magnitude', () => {
  const keyword = Object.values(base.equipment).find((d) => d.mechanism === 'keywordGear');
  assert.ok(keyword);
  const pieces=[piece('w'),piece('a',10,4,{equipment:[{id:keyword.id,quantity:1,state:{}},{id:keyword.id,quantity:2,state:{}}]}),piece('b',11,3)];
  const h=fixture(pieces,condition({keywordGear:keyword.name},{stats:{attackPercent:0.2,defensePercent:0.2,maxHpPercent:0.2,attackSpeedFlat:20}}));
  assert.equal(Math.round(h.unit('w').s.atk),120); assert.equal(h.unit('w').s.aspd,120);
  assert.equal(h.unit('w').s.maxHp,1200); assert.equal(h.unit('w').s.def,120);
  pieces[1].equipment=[]; h.run(0.25); assert.equal(h.unit('w').s.atk,100);
});

test('base stat threshold ignores combat buffs and uses native body handover penalty', () => {
  const h=fixture([piece('w'),piece('a',10,4),piece('b',11,3,{bodyPenaltyApplied:true})],condition({baseStat:'atk',minBaseStatRatioToSelf:1.5,minBaseStat:150}),{a:{stats:{atk:150}},b:{stats:{atk:150}}});
  assert.equal(Math.round(h.unit('w').s.atk),110);
  h.b.addBuff(h.unit('b'),{key:'skill',mods:{atkPct:100},persist:true});
  h.run(0.25); assert.equal(Math.round(h.unit('w').s.atk),110);
  h.b.retreat(h.unit('a')); assert.equal(h.unit('w').s.atk,100);
});

test('base defense/HP thresholds use the selected native module and do not cascade between mutual conditional traits',()=>{
  for(const stat of ['def','maxHp']){
    const pieces=[piece('w'),piece('a',10,4,{moduleId:'test_module'}),piece('b',11,3)];
    const h=fixture(pieces,condition({baseStat:stat,minBaseStat:stat==='def'?200:2000}),{a:{modules:[{uniEquipId:'test_module',attr:{def:200,maxHp:2000}}]}});
    assert.equal(Math.round(h.unit('w').s.atk),110);
  }
  const h=fixture([piece('w'),piece('a',10,4)],condition({baseStat:'atk',minBaseStatRatioToSelf:1.1}));
  h.b.addBuff(h.unit('a'),{key:'independent:otherCondition',mods:{atkPct:0.5},persist:true});
  h.run(0.25); assert.equal(h.unit('w').s.atk,100);
});

function prepFixture(rule, elite = false) {
  const pieces=[piece('w',10,3,{elite}),piece('a',10,4),piece('b',11,3),piece('bench',null,null),piece('deleted',10,5,{deleted:true}),piece('foreign',11,5,{ownerId:'p2'})];
  const operators={...base.operators};
  for(const p of pieces)operators[p.chessId]={chessId:p.chessId,source:{normalChess:chessRec({id:p.chessId,stats:{atk:p.uid==='b'?300:100}})},nativeFactionTags:p.uid==='b'?['炎']:[],nativeTrait:{effect:{prep:p.uid==='w'?[rule]:[],combat:[]}}};
  const catalog={...base,operators};
  const state={round:1,revision:0,nextUid:100,inventory:[],pieces};
  const services={catalog,grantEquipment:(s,id,n,e)=>grantEquipment(s,catalog,id,n,e)};
  return {state,services,pieces,catalog};
}
test('team forge lands normal/elite outputs on selected allies across rounds with source/target ledger and overflow', () => {
  for(const elite of [false,true]){
    const f=prepFixture(forge(),elite),n=elite?4:2;
    runNativeHook(f.state,'prepEnd',{},f.services);
    assert.deepEqual(f.pieces.map(p=>p.equipment.reduce((n,x)=>n+x.quantity,0)),[0,n,n,0,0,0]);
    assert.deepEqual(f.state.production.map(x=>[x.sourceUid,x.targetUid,x.quantity]),[['w','a',n],['w','b',n]]);
    runNativeHook(f.state,'prepEnd',{},f.services); assert.equal(f.state.production.length,2);
    f.state.round++; runNativeHook(f.state,'prepEnd',{},f.services); assert.equal(f.pieces[1].equipment[0].quantity,n*2);
    f.pieces[1].equipment[0].quantity=EQUIPMENT_CAPACITY-1;
    f.services.catalog.operators[f.pieces[0].chessId].nativeTrait.effect.prep=[forge({targets:'adjacent',count:1,sort:'highestBaseHp'})];
    f.state.round++; runNativeHook(f.state,'prepEnd',{},f.services);
    assert.equal(f.pieces[1].equipment[0].quantity,EQUIPMENT_CAPACITY);
    assert.equal(f.state.inventory[0].quantity,n-1);
    assert.equal(f.state.production.at(-1).targetUid,'a'); assert.equal(f.state.production.at(-1).sourceUid,'w');
  }
});
test('team forge target filters and base sorting are stable, and explicit landing rejects invalid targets',()=>{
  for(const [targets,sort,uid] of [['row','leastEquipment','a'],['adjacent','highestBaseAttack','b'],['faction:炎','highestBaseHp','b'],['profession:WARRIOR','highestBaseAttack','b']]){
    const f=prepFixture(forge({targets,sort,count:1}));
    runNativeHook(f.state,'prepEnd',{},f.services); assert.equal(f.state.production[0].targetUid,uid);
  }
  const f=prepFixture(forge());
  for(const uid of ['missing','bench','deleted','foreign'])assert.throws(()=>grantEquipment(f.state,f.catalog,'precision',1,{origin:'native',sourceUid:'w',targetUid:uid,landOn:`uid:${uid}`}),/BAD_LANDING_TARGET/);
  f.catalog.operators[f.pieces[0].chessId].nativeTrait.effect.prep=[forge({outputs:[{id:'unknown',normal:1,elite:2}]})];
  assert.throws(()=>runNativeHook(f.state,'prepEnd',{},f.services),/REQUIRES_BADGES/);
});
test('team forge preserves the existing full-inventory loss rule and records its exact source/target',()=>{
  const f=prepFixture(forge({count:1,targets:'row'}));
  f.pieces[1].equipment=[{id:'precision',quantity:EQUIPMENT_CAPACITY,state:{}}];
  const ids=Object.keys(f.catalog.equipment).filter(id=>id!=='precision' && f.catalog.equipment[id].available!==false && f.catalog.equipment[id].mechanism!=='disabled');
  f.state.inventory=ids.slice(0,INVENTORY_CAPACITY).map((id,i)=>({uid:`i${i}`,id,quantity:1,state:{}}));
  assert.equal(f.state.inventory.length,INVENTORY_CAPACITY);
  runNativeHook(f.state,'prepEnd',{},f.services);
  assert.equal(f.state.production.at(-1).lost,true);
  assert.equal(f.state.production.at(-1).quantity,2);
  assert.equal(f.state.production.at(-1).sourceUid,'w'); assert.equal(f.state.production.at(-1).targetUid,'a');
});
test('authored schema fails fast for unsupported fields/values/NaN/zero caps and exposes summaries',()=>{
  const authored=(r,kind='combat')=>({chessId:'test',modeEffects:{normal:{prep:[],combat:[],[kind]:[r]},elite:{prep:[],combat:[],[kind]:[r]}}});
  const good=condition(); assert.equal(nativeEffectFor('test',authored(good)).combat.length,1);
  for(const p of [{maxCount:0},{countBy:'pets'},{stats:{atkPct:0.1}},{stats:{attackPercent:NaN}},{match:{profession:'GUARD'}},{match:{baseStat:'attack'}},{match:{minBaseStat:100}},{match:{faction:'炎',typo:1}},{typo:1}])assert.throws(()=>nativeEffectFor('test',authored(condition({},p))));
  for(const p of [{count:0},{targets:'around8'},{sort:'attack'},{outputs:[{id:'precision',normal:0,elite:2}]}])assert.throws(()=>nativeEffectFor('test',authored(forge(p),'prep')));
  assert.equal(nativeEffectFor('test',authored(forge(),'prep')).prep.length,1);
  assert.equal(nativeEffectFor('test',authored({trigger:'passive',behavior:'badgeAmplifier',params:{badgeIds:['precision'],multiplier:2}})).combat.length,1);
  const summary=traitSummary({combat:[condition({faction:'炎'})],prep:[forge()]});
  assert.equal(summary[0].kind,'forge'); assert.equal(summary[0].grows,true);
  assert.equal(summary[1].temporary,true); assert.equal(summary[1].kind,'stat'); assert.equal(summary[1].condition,'炎友方');
});
