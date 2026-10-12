import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {buildResonanceBattle,finishResonanceTerminalIfEscaped} from '../../server/modes/resonance/battle.js';
import {mitigate} from '../../server/sim/damage.js';
import {MIN_DAMAGE_RATIO} from '../../server/sim/constants.js';
import {factionSeason} from '../../shared/resonance/faction-season.js';
import {factionSeasonV2} from '../../shared/resonance/faction-season-v2.js';
import {nativePowerBudget,nativePowerBudgetV2} from '../../shared/resonance/native-power.js';
import {OPERATOR_ADAPTATIONS} from '../../shared/resonance/operator-adaptations.js';
const data=loadData(process.env.SP_DATA_DIR,{log:{warn(){},error(){}}});
const v2=getResonanceCatalog(data,{rulesVersion:3,seasonId:factionSeasonV2.id});
const v1=getResonanceCatalog(data,{rulesVersion:3,seasonId:factionSeason.id});
const REFERENCE=nativePowerBudgetV2.physicalDefenseReference;
const physical=op=>op.source.normalChess.dmgType==='phys';
const heroes=factionSeasonV2.heroes.map(hero=>v2.operators[hero.sourceChessId]);
const lowCostPhysical=heroes.filter(op=>op.cost<=2&&physical(op));
// 莱茵生命防卫科高级成员: a regular enemy of the first abyss waves at native DEF 300; 深池重甲卫士: an elite 重装 at DEF 750
const REGULAR=data.enemies.enemy_1249_lysdb_2,HEAVY=data.enemies.enemy_1170_dushld;
const atFloor=(atk,def)=>mitigate(atk,'phys',{def})<=MIN_DAMAGE_RATIO*atk+1e-9;

test('season 2 physical ATK is the season budget plus the 150 reference DEF at every star; arts, healing and season 1 are unchanged',()=>{
  assert.equal(REFERENCE,150);
  assert.equal(nativePowerBudget.physicalDefenseReference,undefined);
  assert.equal(factionSeasonV2.nativePowerBudget,nativePowerBudgetV2);
  assert.ok(lowCostPhysical.length>=14,'every physical 1–2 cost operator is covered');
  for(const op of heroes){
    const old=v1.operators[op.id];
    for(const star of [1,2,3]){
      const stats=op.stars[star].stats;
      assert.equal(stats.atk,old.stars[star].stats.atk+(physical(op)?REFERENCE:0),`${op.name} ${star}★`);
      assert.equal(op.stars[star].record.stats.atk,stats.atk,`${op.name} ${star}★ record`);
      // an adaptation that pays for an economy effect with a weaker body (格拉尼) scales its health budget
      const hpScale=OPERATOR_ADAPTATIONS[op.id]?.budget?.hp??1;
      assert.ok(Math.abs(stats.maxHp-old.stars[star].stats.maxHp*hpScale)<=star,`${op.name} ${star}★ health`);assert.equal(stats.def,old.stars[star].stats.def);
    }
    // stars still multiply the budget part (the damage left after the reference DEF) by 1.8 and 3.24
    const budget=star=>op.stars[star].stats.atk-(physical(op)?REFERENCE:0);
    assert.ok(Math.abs(budget(2)-budget(1)*1.8)<=1&&Math.abs(budget(3)-budget(1)*3.24)<=1,op.name);
  }
});

test('a 1★ cost 1–2 physical operator hits a regular DEF 300 enemy above the 5% floor, and a 重装 still resists it',()=>{
  assert.equal(REGULAR.stats.def,300);assert.equal(REGULAR.rank,'NORMAL');assert.equal(HEAVY.stats.def,750);
  for(const op of lowCostPhysical){
    const atk=op.stars[1].stats.atk;
    assert.ok(mitigate(atk,'phys',{def:REGULAR.stats.def})>=0.1*atk,`${op.name} ${atk} ATK keeps at least 10% against DEF 300`);
    assert.ok(mitigate(atk,'phys',{def:HEAVY.stats.def})<=0.35*atk,`${op.name} is still blunted by the DEF 750 重装`);
  }
  // the season-1 budget this replaces left most of them at the floor against the same enemy
  assert.ok(lowCostPhysical.filter(op=>atFloor(v1.operators[op.id].stars[1].stats.atk,REGULAR.stats.def)).length>=lowCostPhysical.length/2);
  // high cost keeps the larger budget: no 1★ cost 1–2 physical operator out-hits the 1★ physical operators of cost 4–5 on average
  const mean=list=>list.reduce((sum,op)=>sum+op.stars[1].stats.atk,0)/list.length;
  assert.ok(mean(lowCostPhysical)<mean(heroes.filter(op=>op.cost>=4&&physical(op))));
});

test('the owner\'s abyss node 5: 1★ cost 1–2 physical normal attacks on the DEF 300 regulars never sit at the floor in a real Battle',()=>{
  // seed, node and tiles of a saved abyss run; 休谟斯 and 艾丝黛尔 block, 正义骑士号 and 红云 shoot (all 1★, cost 1–2, physical)
  const tiles={休谟斯:[11,5,'UP'],艾丝黛尔:[12,5,'RIGHT'],正义骑士号:[12,4,'RIGHT'],红云:[11,4,'RIGHT']};
  const pieces=Object.entries(tiles).map(([name,[row,col,dir]],i)=>({uid:`low${i}`,operatorId:heroes.find(op=>op.name===name).id,star:1,row,col,dir,equipment:[],extraPacts:[]}));
  const state={seed:2101601287,difficulty:'ABYSS',round:5,roundLimit:30,rulesVersion:3,seasonId:factionSeasonV2.id,level:5,hp:100,strategies:[],pieces};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog:v2});
  const uids=new Set(pieces.map(p=>p.uid)),hits={regular:0,floor:0};
  battle.on('hit',({source,target,dmg})=>{
    if(target?.side!=='enemy'||target.defId!==REGULAR.key||dmg.type!=='phys'||!dmg.isAttack||dmg.isSkill||dmg.isSplash||!uids.has(String(source?.uid)))return;
    hits.regular++;
    if(mitigate(dmg.amount,'phys',target.s,{defIgnorePct:dmg.defIgnorePct+source.s.defIgnorePct,defIgnoreFlat:dmg.defIgnoreFlat+source.s.defIgnoreFlat})<=MIN_DAMAGE_RATIO*dmg.amount+1e-9)hits.floor++;
  },{priority:-1e9});
  while(!battle.finished&&battle.tickCount<30*300){battle.step();finishResonanceTerminalIfEscaped(battle,prepared.nodeKind);}
  assert.equal(battle.errorCount,0);
  assert.ok(hits.regular>=20,`normal attacks on 莱茵生命防卫科高级成员: ${hits.regular}`);
  assert.equal(hits.floor,0,`${hits.floor}/${hits.regular} normal attacks at the 5% floor`);
});
