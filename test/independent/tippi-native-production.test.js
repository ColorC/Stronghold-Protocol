import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { installIndependentBattle } from '../../server/sim/content/independent/battle.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { createSession, applyAction } from '../../server/modes/independent/session.js';
import { darkmoonGrowthBadges } from '../../server/modes/independent/darkmoonShop.js';
import { nativeEffectFor, runNativeHook } from '../../server/modes/independent/native.js';
import { grantEquipment } from '../../server/modes/independent/equipment.js';

const data = getData();
const catalog = getCatalog(data);
const preWarbandCommit = '4ce0539d';
const fromGit = path => JSON.parse(execFileSync('git', ['show', `${preWarbandCommit}:${path}`], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 }));
const preWarbandDesign = fromGit('data/independent-design.json');
const preWarbandData = { ...data, 'independent-game-text': fromGit('data/independent-game-text.json') };
const preWarbandCatalog = getCatalog(preWarbandData, preWarbandDesign);
for (const elite of [false, true]) {
  test(`pre-warband Tippi dodge production stays covered by Git design/text ${preWarbandCommit}, ${elite ? 'elite' : 'ordinary'}`, () => {
    const id = elite ? 'chess_char_2_13_b' : 'chess_char_2_13_a';
    const piece = { uid: 'tippi', chessId: id, elite, row: 10, col: 5, dir: 'RIGHT', skillIndex: 1, moduleId: 'none', equipment: [], attachments: [], nativeState: {} };
    const h = makeBattle({ data: preWarbandData, units: [piece], content: 'full', autoFinish: false,
      defs: { enemies: { probe: enemyRec({ key: 'probe', hp: 1e9, atk: 100, speed: 0 }) } },
      enemies: [{ key: 'probe', pos: [10, 7] }],
      flags: { independent: { catalog: preWarbandCatalog, pieces: [piece] } },
      extraContent: [(b) => installIndependentBattle(b, { catalog: preWarbandCatalog, state: { pieces: [piece] } })] });
    h.step(1);
    const unit = h.unit('tippi');
    const attacker = h.enemies()[0];
    const dodges = [];
    h.b.on('dodge', (e) => { if (e.target === unit) dodges.push(e); });
    const before = unit.hp;
    h.b.dealDamage(attacker, unit, { amount: 100, type: 'phys', canDodge: true, isAttack: true });
    assert.equal(unit.hp, before, 'native talent really avoids damage');
    assert.equal(dodges.length, 1, 'one logical dodge, not just the visual MISS');
    assert.equal(h.b.independentRewards.find((r) => r.id === 'agility' && r.sourceUid === 'tippi')?.quantity, elite ? 2 : 1);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  });
}

test('current GVG_055 gain action grows an explicitly selected Columbia recipient and records the exact source ledger', () => {
  const source = Object.values(catalog.operators).find(x => x.sourceRefs?.darkmoon19_2?.id === 'GVG_055' && !x.elite);
  const targetOp = Object.values(catalog.operators).find(x => !x.elite && x.chessId !== source.chessId && x.nativeFactionTags?.includes('哥伦比亚'));
  assert.ok(source?.eliteChessId);assert.ok(targetOp);
  const state=createSession({seed:5501,data,catalog});state.funds=99;
  state.pieces.push({uid:'gain-target',chessId:targetOp.chessId,row:9,col:2,equipment:[],attachments:[],nativeState:{}});
  state.shop.slots[0]={kind:'chess',id:source.chessId,price:3,sold:false,equipment:[]};
  const bought=applyAction(state,{type:'buy',slot:0,targetUid:'gain-target'},{data,catalog});
  assert.equal(bought.ok,true,bought.error?.message);
  const boughtTarget=bought.state.pieces.find(x=>x.uid==='gain-target'),[attack,secondary]=darkmoonGrowthBadges(boughtTarget,catalog);
  assert.deepEqual(boughtTarget.equipment.map(x=>[x.id,x.quantity]).sort((a,b)=>a[0].localeCompare(b[0])),[[attack,2],[secondary,2]].sort((a,b)=>a[0].localeCompare(b[0])),'ordinary GVG_055 buy grants +2/+2 exactly once to the selected Columbia target');
  const boughtSource=bought.state.pieces.find(x=>x.chessId===source.chessId);
  assert.deepEqual(bought.state.production.filter(x=>x.sourceUid===boughtSource.uid&&x.targetUid==='gain-target').map(x=>[x.id,x.quantity]).sort((a,b)=>a[0].localeCompare(b[0])),[[attack,2],[secondary,2]].sort((a,b)=>a[0].localeCompare(b[0])),'ordinary gain ledger records the source and selected recipient');

  const eliteSource={...source,chessId:source.eliteChessId,elite:true,nativeTrait:{...source.nativeTrait,effect:nativeEffectFor(source.chessId,source,true)}};
  const eliteTarget={uid:'gold-target',chessId:targetOp.chessId,row:9,col:2,equipment:[],attachments:[],nativeState:{}};
  const eliteState={round:1,pieces:[{uid:'gold-source',chessId:eliteSource.chessId,elite:true,nativeState:{},equipment:[]},eliteTarget],inventory:[],production:[]};
  const services={catalog,data:{},rng:()=>0,grantEquipment:(s,id,n,e)=>grantEquipment(s,catalog,id,n,e),grantChess(){},addOffer(){},record(){}};
  runNativeHook(eliteState,'gain',{piece:eliteState.pieces[0],source:'golden-gain',targetUid:eliteTarget.uid},services);
  assert.deepEqual(eliteTarget.equipment.map(x=>[x.id,x.quantity]).sort((a,b)=>a[0].localeCompare(b[0])),[[attack,4],[secondary,4]].sort((a,b)=>a[0].localeCompare(b[0])),'golden GVG_055 gain grants +4/+4 exactly once to the selected Columbia target');
  assert.deepEqual(eliteState.production.filter(x=>x.sourceUid==='gold-source'&&x.targetUid==='gold-target').map(x=>[x.id,x.quantity]).sort((a,b)=>a[0].localeCompare(b[0])),[[attack,4],[secondary,4]].sort((a,b)=>a[0].localeCompare(b[0])),'golden gain ledger records the source and selected recipient');
});

test('current Tippi still emits its native dodge event without the replaced dodge-to-agility reward', () => {
  const piece={uid:'tippi-current',chessId:'chess_char_2_13_a',row:10,col:5,dir:'RIGHT',skillIndex:1,moduleId:'none',equipment:[],attachments:[],nativeState:{}};
  const h=makeBattle({data,units:[piece],content:'full',autoFinish:false,
    defs:{enemies:{probe:enemyRec({key:'probe',hp:1e9,atk:100,speed:0})}},enemies:[{key:'probe',pos:[10,7]}],
    flags:{independent:{catalog,pieces:[piece]}},extraContent:[b=>installIndependentBattle(b,{catalog,state:{pieces:[piece]}})]});
  h.step(1);const unit=h.unit('tippi-current'),attacker=h.enemies()[0],dodges=[];h.b.on('dodge',e=>{if(e.target===unit)dodges.push(e);});
  const before=unit.hp;h.b.dealDamage(attacker,unit,{amount:100,type:'phys',canDodge:true,isAttack:true});
  assert.equal(unit.hp,before);assert.equal(dodges.length,1);assert.equal(h.b.independentRewards.some(x=>x.id==='agility'&&x.sourceUid==='tippi-current'),false);
});
