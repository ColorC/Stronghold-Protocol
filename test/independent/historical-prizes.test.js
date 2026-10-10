import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { createSession, applyAction, viewSession } from '../../server/modes/independent/session.js';
import { makePrizeOffer } from '../../server/modes/independent/prizes.js';
import { runIndependentBattle } from '../../server/modes/independent/battle.js';
import { independentPermanentStats } from '../../server/sim/content/independent/battle.js';
import { PRIZE_JESSICA_ID } from '../../server/modes/independent/historicalPrizes.js';
import { independentDisplayCatalog } from '../../server/modes/independent/display.js';
import { inventoryTiles } from '../../server/modes/independent/equipment.js';
import { independentGrowthCatalog } from '../../shared/independentPrizeText.js';
const data=getData(),catalog=getCatalog(data),records=Object.values(catalog.prizes).filter(x=>x.historical);
const id = s=>'darkmoon-prize:'+s;
const cleared=()=>({result:{reason:'cleared',bossHpLeft:0,perPlayer:{independent:{leaked:[]}}},diagnostics:{capped:false},pieceStates:{},rewards:[]});
function run(s,a,options={}) {const r=applyAction(s,a,{data,catalog,...options});assert.equal(r.ok,true,a.type+' '+JSON.stringify(a)+': '+r.error?.message);return r.state;}
function fixture(mode='badges') {
  let s=createSession({seed:331,roundLimit:18,growthMode:mode});s.funds=99;
  s=run(s,{type:'buy',slot:0});const p=s.pieces[0];const [row,col]=viewSession(s,{data,catalog}).pieces[0].legalTiles[0].split(',').map(Number);
  s=run(s,{type:'move',uid:p.uid,row,col});return s;
}
function acquire(s,key) {const prize=id(key);s.offers.push({id:'o'+s.nextUid++,type:'prize',choices:[prize],tier:'start'});s.phase='prize';return run(s,{type:'choose',offerId:s.offers.at(-1).id,index:0});}
function use(s,key,action={}) {const item=s.inventory.find(x=>x.id===id(key));assert.ok(item,key+' card');return run(s,{type:'use-item',itemUid:item.uid,targetUid:s.pieces[0]?.uid,...action});}
test('exact historical30 and tier7/8/8/7; four offers contain only real same-tier sources',()=>{
 assert.equal(records.length,30);assert.deepEqual([1,2,3,4].map(t=>records.filter(x=>x.prizeTier===t).length),[7,8,8,7]);
 for(const [stage,tier]of [['start',1],['build',2],['cashout',3],['finale',4]])for(let seed=1;seed<9;seed++){
  const s=createSession({seed,roundLimit:18});const o=makePrizeOffer(s,catalog,stage);assert.equal(new Set(o.choices).size,3);for(const key of o.choices)assert.equal(catalog.prizes[key].prizeTier,tier);
 }
});
test('all30 awards preserve cards or give actual prize support; all29 spells are usable with their real destinations',()=>{
 for(const prize of records){
  let s=fixture();s.shop.level=3;s.previousRoundWarband=[{chessId:s.pieces[0].chessId}];const originalUid=s.pieces[0].uid;
  s=acquire(s,prize.params.sourceId);
  if(prize.params.sourceId==='SCH_149'){assert.ok(s.pieces.some(p=>p.chessId===PRIZE_JESSICA_ID));continue;}
  assert.ok(s.inventory.some(x=>x.id===prize.id));assert.equal(inventoryTiles(s,catalog),0,'prize takes no ordinary gear tile');
  s=use(s,prize.params.sourceId,{targetUid:originalUid});
  const remain=s.inventory.find(x=>x.id===prize.id);assert.equal(Boolean(remain),prize.params.sourceId==='BGS_Treasures_014');
  if(prize.mechanism==='darkmoonTargetPrize')assert.ok(!s.inventory.some(x=>['precision','vitality','damage','independent:护盾发生器','independent:坚守盟约'].includes(x.id)),'targeted buffs never go to public stock');
  if(prize.params.sourceId==='BGS_Treasures_011'){assert.equal(s.offers[0].type,'logistics');s=run(s,{type:'choose',offerId:s.offers[0].id,index:0});assert.ok(s.playerEffects.some(x=>x.type==='darkmoonPrizeProductionBoost'));}
  if(prize.params.sourceId==='BGS_Treasures_032')assert.deepEqual(s.offers.map(o=>o.tier),['start','build','cashout']);
 }
});
test('reusable Gold coin, reserve Gold, discounts and free refresh persist without natural cap clamping',()=>{
 let s=fixture();s.funds=12;s=use(acquire(s,'BGS_Treasures_014'),'BGS_Treasures_014');assert.equal(s.funds,13);
 const item=s.inventory.find(x=>x.id===id('BGS_Treasures_014'));const denied=applyAction(s,{type:'use-item',itemUid:item.uid},{data,catalog});assert.equal(denied.ok,false);assert.equal(denied.error.code,'ALREADY_USED_THIS_ROUND');
 s=use(acquire(s,'BGS_Treasures_001'),'BGS_Treasures_001');s=use(s,'gold-coin');assert.equal(s.funds,14);
 s=use(acquire(s,'BGS_Treasures_023'),'BGS_Treasures_023');s=use(acquire(s,'BGS_Treasures_022'),'BGS_Treasures_022');s=use(acquire(s,'BGS_Treasures_033'),'BGS_Treasures_033');
 assert.ok(s.shop.slots.every(x=>x.price===2));const size=s.shop.slots.length;s=run(s,{type:'ready'},{battleRunner:cleared});assert.equal(s.shop.freeRefreshes,5);assert.equal(s.shop.slots.length,size);assert.ok(s.shop.slots.every(x=>x.price===2));
 s=use(s,'BGS_Treasures_014');assert.equal(s.funds,5);s=use(acquire(s,'BGS_Treasures_025'),'BGS_Treasures_025');assert.equal(s.funds,5);
});
test('Gruul grows its wearer at prepEnd, GreatDeal stacks the true endturn upgrade discount, and frozen slot keeps shop growth once',()=>{
 let s=fixture();const uid=s.pieces[0].uid;s=use(acquire(s,'BGS_Treasures_009'),'BGS_Treasures_009');s=use(acquire(s,'BGS_Treasures_036'),'BGS_Treasures_036');s=use(acquire(s,'BGS_Treasures_013'),'BGS_Treasures_013');s.shop.frozen=true;s.shop.upgradePrice=7;
 s=run(s,{type:'ready'},{battleRunner:cleared});assert.equal(s.shop.upgradePrice,4);
 const p=s.pieces.find(x=>x.uid===uid);assert.ok(p.equipment.some(x=>x.id==='precision'&&x.quantity>=2));assert.ok(p.equipment.some(x=>x.id==='damage'&&x.quantity>=2));
 assert.ok(s.shop.slots.every(x=>x.equipment.filter(e=>e.origin===id('BGS_Treasures_013')).length===1));
});
test('Golden shop picks randomly once and can be purchased; returned target retains equipment and native original-copy discovery carries none',()=>{
 let s=fixture();s=use(acquire(s,'BGS_Treasures_037'),'BGS_Treasures_037');const n=s.shop.slots.findIndex(x=>x.elite);assert.ok(n>=0);s=run(s,{type:'buy',slot:n});assert.ok(s.pieces.some(x=>x.elite));
 s.previousRoundWarband=[{chessId:s.pieces[0].chessId},{chessId:s.pieces[0].chessId}];s=use(acquire(s,'BGS_Treasures_010'),'BGS_Treasures_010');assert.equal(s.offers[0].choices.length,1);const original=s.pieces[0];original.equipment.push({uid:'i'+s.nextUid++,id:'precision',quantity:8,state:{}});s=run(s,{type:'choose',offerId:s.offers[0].id,index:0});const copy=s.pieces.at(-1);assert.equal(copy.equipment.filter(x=>x.id==='precision').length,0);
 s=use(acquire(s,'BGS_Treasures_034'),'BGS_Treasures_034',{targetUid:original.uid});assert.equal(s.pieces.find(x=>x.uid===original.uid).row,null);assert.ok(s.pieces.find(x=>x.uid===original.uid).equipment.find(x=>x.id==='precision').quantity>=10);
});
test('IceBlock prevents fatal LP loss but does not manufacture a boss victory',()=>{
 let s=fixture();s.lp=1;s=use(acquire(s,'TB_Bacon_Secrets_12'),'TB_Bacon_Secrets_12');s=run(s,{type:'ready'},{battleRunner:()=>({result:{reason:'leaked',perPlayer:{independent:{leaked:[{lpr:5}]}}},diagnostics:{capped:false},pieceStates:{},rewards:[]})});assert.equal(s.lp,1);assert.equal(s.phase,'prep');assert.ok(!s.playerEffects.some(x=>x.type==='darkmoonPrizeIceBlock'));
});
test('SCH149 body/skills/factions come from Jessica, permanent panels match individually, and no FoeReaper special effect is inherited',()=>{
 for(const mode of ['badges','levels']){
  let s=fixture(mode);const friend=s.pieces[0];friend.equipment.push({uid:'i'+s.nextUid++,id:'precision',quantity:20,state:{}},{uid:'i'+s.nextUid++,id:'vitality',quantity:20,state:{}});const before=independentPermanentStats(friend,catalog,s);
  s=acquire(s,'SCH_149');const award=s.pieces.find(x=>x.chessId===PRIZE_JESSICA_ID);assert.ok(award);assert.equal(catalog.operators[PRIZE_JESSICA_ID].recruitable,false);assert.ok(data.chess[PRIZE_JESSICA_ID]);assert.equal(data.chess[PRIZE_JESSICA_ID].baseId,'chess_native_char_1034_jesca2_a');assert.deepEqual(data.chess[PRIZE_JESSICA_ID].skills,data.chess.chess_native_char_1034_jesca2_a.skills);assert.ok(!s.pool[PRIZE_JESSICA_ID]);assert.equal(catalog.operators[PRIZE_JESSICA_ID].sourceRefs.cards[0].attack,1);assert.equal(catalog.operators[PRIZE_JESSICA_ID].sourceRefs.cards[0].goldenAttack,2);assert.equal(catalog.operators[PRIZE_JESSICA_ID].sourceRefs.cards.length,1);assert.equal(catalog.operators[PRIZE_JESSICA_ID].sourceRefs.darkmoon19_2.id,'SCH_149');
  assert.deepEqual(catalog.operators[PRIZE_JESSICA_ID].source.normalChess.stats,catalog.operators.chess_native_char_1034_jesca2_a.source.normalChess.stats);
  assert.deepEqual(catalog.operators[PRIZE_JESSICA_ID].nativeTrait.effect.combat,[]);assert.ok(catalog.operators[PRIZE_JESSICA_ID].nativeFactionTags.length);
  const after=independentPermanentStats(award,catalog,s);if(mode==='badges'){assert.ok(after.atk>=before.atk);assert.ok(after.maxHp>=before.maxHp);}else assert.ok(award.growthLevel>=1);
  const [row,col]=viewSession(s,{data,catalog}).pieces.find(x=>x.uid===award.uid).legalTiles.find(x=>x!==friend.row+','+friend.col).split(',').map(Number);s=run(s,{type:'move',uid:award.uid,row,col});
  const battle=runIndependentBattle(s,{data,catalog});assert.equal(battle.diagnostics.errorCount,0);assert.ok(battle.result.perPlayer.independent.unitStats.some(x=>x.uid===award.uid));
 }
});
test('new gear and all prizes expose loadable native item identities and displayed source references',()=>{
 const display=independentDisplayCatalog(data,catalog);
 for(const p of records){assert.ok(display.prizes[p.id].sourceRefs.cards[0].text);const icon=display.prizes[p.id].iconItemId;assert.ok(icon);assert.ok(data.items[icon],icon);}
 for(const gear of ['darkmoon-gruul-training','darkmoon-windfury-trigger']){assert.ok(display.gear[gear].iconItemId);assert.ok(data.items[display.gear[gear].iconItemId]);assert.ok(catalog.equipment[gear].prizeOnly);assert.ok(catalog.equipment[gear].sourcePrizeId);assert.ok(catalog.equipment[gear].sourceRefs.cards[0].text);assert.equal(catalog.equipment[gear].sourceRefs.cards[0].id,gear==='darkmoon-gruul-training'?'BGS_Treasures_009':'BGS_Treasures_028');}
 assert.equal(display.operators[PRIZE_JESSICA_ID].name,'涤火杰西卡');assert.ok(display.operators[PRIZE_JESSICA_ID].nativeFactions.length);
});

test('growth-mode text remains separate for prizes, logistics and their persistent equipment',()=>{
 const display=independentDisplayCatalog(data,catalog),levels=independentGrowthCatalog(display,'levels'),badges=independentGrowthCatalog(display,'badges');
 for(const source of ['BGS_Treasures_000','BGS_Treasures_007','BGS_Treasures_009','BGS_Treasures_011','BGS_Treasures_013','BGS_Treasures_018','BGS_Treasures_019','BGS_Treasures_026','BGS_Treasures_028','BGS_Treasures_034','SCH_149']){assert.ok(!levels.prizes[id(source)].effect.includes('徽章'),source);assert.ok(!badges.prizes[id(source)].effect.includes('训练模式'),source);}
 assert.equal(levels.prizes['prize-logistics-production'].effect,'本局干员产出的训练等级数量加倍。');
 assert.ok(levels.gear['darkmoon-gruul-training'].normal.includes('4级训练'));
 assert.ok(catalog.operators[PRIZE_JESSICA_ID].sourceRefs.cards[0].textElite.includes('两倍'));
});
