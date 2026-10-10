import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction, viewSession, validateSession } from '../../server/modes/independent/session.js';
import { getIndependentField, runIndependentBattle } from '../../server/modes/independent/battle.js';
import { GameData } from '../../server/match/gamedata.js';
import { modeIdFor } from '../../shared/constants.js';
import { independentIncome, independentUpgradeBase, independentRoundPlan, independentRoundScale, independentShopSlots } from '../../shared/independentEconomy.js';
const data = getData(); const catalog = getCatalog(data);
const cleared = () => ({ result: { reason:'cleared', bossHpLeft:0, perPlayer:{independent:{leaked:[]}} }, diagnostics:{capped:false}, pieceStates:{}, rewards:[] });
function readyPiece(state) {
  state.funds = 99;
  let out = applyAction(state, { type:'buy',slot:state.shop.slots.findIndex(s=>s.id) }, {data,catalog});
  assert.equal(out.ok,true,out.error?.message); state=out.state;
  const p=state.pieces[0], cell=viewSession(state,{data,catalog}).pieces.find(x=>x.uid===p.uid).legalTiles[0];
  const [row,col]=cell.split(',').map(Number);
  out=applyAction(state,{type:'move',uid:p.uid,row,col},{data,catalog}); assert.equal(out.ok,true,out.error?.message); return out.state;
}
test('all Workshop difficulties use three starting Gold, historical upgrade prices and shop sizes',()=>{
  for(const difficulty of ['FUNNY','NORMAL','HARD','ABYSS']){
    const s=createSession({seed:913,difficulty}); assert.equal(s.funds,3); assert.equal(s.shop.upgradePrice,5); assert.equal(s.shop.slots.length,3);
    assert.equal(s.roundLimit,difficulty==='FUNNY'?9:18);
  }
  assert.deepEqual(Array.from({length:6},(_,i)=>independentShopSlots(i+1)),[3,4,4,5,5,6]);
  assert.deepEqual(Array.from({length:5},(_,i)=>independentUpgradeBase(i+1)),[5,7,8,9,10]);
  assert.deepEqual(Array.from({length:19},(_,i)=>independentIncome(i+1)),[3,4,5,6,7,8,9,10,11,12,12,12,12,12,12,12,12,12,12]);
});
test('same-turn upgrades reset new base, next round discounts once, leftover Gold is lost and extra income exceeds natural cap',()=>{
  let s=readyPiece(createSession({seed:913,roundLimit:18})); s.funds=100;
  for(const expected of [7,8,9,10,0]) {const r=applyAction(s,{type:'upgrade'},{data,catalog});assert.equal(r.ok,true,r.error?.message);s=r.state;assert.equal(s.shop.upgradePrice,expected);}
  s.shop.level=3;s.shop.upgradePrice=8;s.round=11;s.funds=123;s.pendingFunds=7;s.playerEffects.push({type:'facilityIncome',source:'test-facility',amount:2});
  const r=applyAction(s,{type:'ready'},{data,catalog,battleRunner:cleared});assert.equal(r.ok,true,r.error?.message);assert.equal(r.state.round,12);assert.equal(r.state.funds,21);assert.equal(r.state.incomeThisRound,12);assert.equal(r.state.shop.upgradePrice,7);assert.equal(r.state.pendingFunds,0);
  const sold=applyAction({...r.state,phase:'prep',offers:[],funds:12},{type:'sell',uid:r.state.pieces[0].uid},{data,catalog});assert.equal(sold.ok,true,sold.error?.message);assert.ok(sold.state.funds>=13);
});
test('all 18/19 round native waves have real templates, routed enemies and unchanged real round identity',()=>{
  for(const limit of [18,19]) for(let round=1;round<=limit;round++){
    const s=createSession({seed:913,difficulty:'NORMAL',roundLimit:limit});s.round=round;
    const f=getIndependentField(s,{data,catalog}),p=independentRoundPlan(limit,round);
    assert.ok(f.wave.templateId,'native template '+round);assert.ok(f.wave.spawns.length>0,'non-empty native enemies '+round);assert.ok(f.stage);assert.equal(f.field,p.kind==='normal'?'normal':'bossL');
    if(round>=14&&round<=17)assert.equal(p.waveRound,round-4);
  }
});
test('late repeated templates use real-round increasing enemy scale exactly once and do not mutate native GameData',()=>{
  const gd=new GameData(data,modeIdFor('solo','NORMAL'));const native=structuredClone(gd.mode);
  let previous=independentRoundScale(gd,13,18);
  for(let round=14;round<=19;round++){
    const scale=independentRoundScale(gd,round,19);assert.ok(scale.hpMul>previous.hpMul);assert.ok(scale.atkMul>previous.atkMul);assert.equal(scale.speedMul,previous.speedMul);previous=scale;
  }
  assert.deepEqual(gd.mode,native);assert.equal(gd.enemyScale(18).hpMul,1,'original mode still falls back as before');
  const f=getIndependentField({...createSession({seed:913,roundLimit:18}),round:14},{data,catalog});
  const expected=independentRoundScale(gd,14,18).hpMul * catalog.config.enemyBalanceByGrowthMode.badges.NORMAL.at(-1).hpMul;
  assert.ok(f.wave.spawns.some(x=>Math.abs(x.mods.hpMul-expected)<1e-8),'ordinary enemy receives actual scale once, not old R10 multiplied twice');
});
test('old 9/14/15 saves keep original boss and hidden schedule without mutating reads',()=>{
  for(const [limit,boss,hidden] of [[9,9,null],[14,14,null],[15,14,15]]){
    const s=createSession({seed:913,difficulty:limit===9?'FUNNY':'NORMAL',roundLimit:limit});s.round=boss;const before=JSON.stringify(s);const v=viewSession(s,{data,catalog});assert.equal(v.board.bossRound,boss);assert.equal(v.board.field,'bossL');assert.equal(JSON.stringify(s),before);assert.deepEqual(validateSession(s),[]);
    if(hidden){s.round=hidden;assert.equal(getIndependentField(s,{data,catalog}).field,'bossL');}
  }
});
test('new standard and hidden terminal phases do not stop at legacy round14',()=>{
  for(const limit of [18,19]){
    let s=readyPiece(createSession({seed:913,roundLimit:limit}));
    for(let round=1;round<=limit;round++){
      s.round=round;s.phase='prep';s.offers=[];s.funds=20;
      // Actual native legality is exercised each round; fake victory only isolates the session transition.
      const piece=s.pieces[0];piece.row=null;piece.col=null;const cell=viewSession(s,{data,catalog}).pieces.find(x=>x.uid===piece.uid).legalTiles[0];[piece.row,piece.col]=cell.split(',').map(Number);
      const result=applyAction(s,{type:'ready'},{data,catalog,battleRunner:cleared});assert.equal(result.ok,true,result.error?.message);s=result.state;
      assert.equal(s.phase==='finished',round===limit,'terminal round '+round+'/'+limit);
      if(round===15)assert.ok(s.offers.some(o=>o.type==='prize'&&o.tier==='finale'),'fourth prize offered entering16');
    }
    assert.equal(s.outcome,'win');
  }
});
test('real late-wave Battle and new final assault resolve without content errors',()=>{
  const lowBossData={...data,bosses:Object.fromEntries(Object.entries(data.bosses).map(([id,b])=>[id,{...b,bloodPoint:{FUNNY:1000,NORMAL:1000,HARD:1000,ABYSS:1000}}]))};
  for(const [limit,round,kind] of [[18,14,'normal'],[18,18,'boss'],[19,19,'hidden']]){
    const s=readyPiece(createSession({seed:913,roundLimit:limit}));s.round=round;const p=s.pieces[0];p.row=null;p.col=null;const cell=viewSession(s,{data:lowBossData,catalog}).pieces.find(x=>x.uid===p.uid).legalTiles[0];[p.row,p.col]=cell.split(',').map(Number);
    const out=runIndependentBattle(s,{data:lowBossData,catalog});assert.equal(out.diagnostics.round,round);assert.equal(out.diagnostics.waveRound,independentRoundPlan(limit,round).waveRound);assert.equal(out.diagnostics.kind,kind);assert.equal(out.diagnostics.errorCount,0);assert.ok(out.result.total>0);assert.ok(out.replay.frames.length>0);
  }
});
