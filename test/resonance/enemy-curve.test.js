import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {buildResonanceBattle,getResonanceField,resolveEnemyBalance,enemyNodeCurveFactor} from '../../server/modes/resonance/battle.js';
const data=loadData(process.env.SP_DATA_DIR,{log:{warn(){},error(){}}});
const catalog=getResonanceCatalog(data,{rulesVersion:3,seed:23});
const config=catalog.campaign.enemyBalance;
const DIFFICULTIES=['FUNNY','NORMAL','HARD','ABYSS'];
const at=(difficulty,node,kind='normal')=>resolveEnemyBalance(config,difficulty,kind,node);

test('the current campaign raises regular-wave HP and ATK along each difficulty curve (key points)',()=>{
  // [difficulty, node, HP, ATK]: start, mid and end of every curve on top of the difficulty profile
  for(const [difficulty,node,hp,atk] of [
    ['FUNNY',2,0.55,0.75],['FUNNY',12,0.55,0.75],['FUNNY',26,0.6013,0.82],
    ['NORMAL',1,0.65,0.85],['NORMAL',6,0.65,0.85],['NORMAL',12,0.715,0.935],['NORMAL',20,0.78,1.02],['NORMAL',27,0.8125,1.0625],
    ['HARD',1,0.9,1],['HARD',10,1.035,1.15],['HARD',20,1.26,1.4],['HARD',27,1.35,1.5],
    ['ABYSS',1,1,1],['ABYSS',4,1,1],['ABYSS',8,1.15,1.15],['ABYSS',12,1.4,1.4],['ABYSS',18,1.7,1.7],['ABYSS',22,1.9,1.9],['ABYSS',27,1.9714,1.9714],
  ]){
    const profile=at(difficulty,node);
    assert.deepEqual([profile.hpMultiplier,profile.atkMultiplier],[hp,atk],`${difficulty} node ${node}`);
  }
  assert.deepEqual([at('ABYSS',29,'elite').hpMultiplier,at('ABYSS',29,'elite').atkMultiplier],[2,2],'ABYSS elite node 29 ends the curve at ×2');
});

test('the curve never falls, keeps the four difficulties apart, and leaves DEF and leader nodes alone',()=>{
  for(const difficulty of DIFFICULTIES){
    let previous=0;
    for(let node=1;node<=27;node++){
      const profile=at(difficulty,node);
      assert.ok(profile.hpMultiplier>=previous,`${difficulty} HP does not fall at node ${node}`);
      previous=profile.hpMultiplier;
      assert.equal(profile.defMultiplier,resolveEnemyBalance(config,difficulty,'normal').defMultiplier,`${difficulty} DEF stays on the profile`);
    }
    assert.deepEqual(at(difficulty,28,'boss'),resolveEnemyBalance(config,difficulty,'boss'),`${difficulty} leader node keeps the terminal profile`);
  }
  assert.deepEqual(at('ABYSS',30,'hidden'),resolveEnemyBalance(config,'ABYSS','hidden'));
  for(let node=2;node<=27;node+=1){
    const hp=DIFFICULTIES.map(difficulty=>at(difficulty,node).hpMultiplier);
    assert.ok(hp[0]<hp[1]&&hp[1]<hp[2]&&hp[2]<hp[3],`HP order 轻松<标准<困难<深渊 at node ${node}: ${hp}`);
  }
  // late-game gap: ABYSS regular enemies carry about 2.4× the NORMAL HP and 1.85× the ATK
  assert.ok(at('ABYSS',26).hpMultiplier/at('NORMAL',26).hpMultiplier>2.3);
});

test('a built battle and the field preview use the node value; the profile alone is unchanged without a node',()=>{
  const state={seed:23,difficulty:'ABYSS',round:20,roundLimit:30,rulesVersion:3,seasonId:catalog.config.seasonId,level:1,hp:100,strategies:[],pieces:[]};
  const {prepared}=buildResonanceBattle(state,{data,catalog});
  assert.equal(prepared.enemyBalance.hpMultiplier,1.8);
  assert.equal(prepared.enemyBalance.atkMultiplier,1.8);
  assert.ok(prepared.wave.spawns.filter(spawn=>spawn.mods).every(spawn=>spawn.mods.resonanceHpMul===1.8&&spawn.mods.resonanceAtkMul===1.8));
  assert.equal(getResonanceField(state,{data,catalog}).enemyBalance.hpMultiplier,1.8);
  assert.deepEqual(resolveEnemyBalance(config,'NORMAL','normal'),{hpMultiplier:0.65,atkMultiplier:0.85,defMultiplier:0.35,resMultiplier:1,speedMultiplier:1,bossPoolMultiplier:1});
  const legacy=getResonanceCatalog(data,{rulesVersion:2,seed:23});
  assert.equal(legacy.campaign.enemyBalance.nodeCurve,undefined,'older rules keep their flat profiles');
});

test('node curve points are validated and interpolated linearly with flat ends',()=>{
  const points=[{node:4,hpMultiplier:1,atkMultiplier:1},{node:8,hpMultiplier:2,atkMultiplier:1.5}];
  assert.deepEqual(enemyNodeCurveFactor(points,1),{hpMultiplier:1,atkMultiplier:1});
  assert.deepEqual(enemyNodeCurveFactor(points,6),{hpMultiplier:1.5,atkMultiplier:1.25});
  assert.deepEqual(enemyNodeCurveFactor(points,30),{hpMultiplier:2,atkMultiplier:1.5});
  assert.throws(()=>resolveEnemyBalance({nodeCurve:{NORMAL:[{node:5,hpMultiplier:1,atkMultiplier:1},{node:5,hpMultiplier:1,atkMultiplier:1}]}},'NORMAL','normal',5),/increasing integers/);
  assert.throws(()=>resolveEnemyBalance({nodeCurve:{NORMAL:[{node:1,hpMultiplier:0,atkMultiplier:1}]}},'NORMAL','normal',1),/finite and > 0/);
  assert.throws(()=>resolveEnemyBalance({nodeCurve:{NORMAL:[{node:1,hpMultiplier:1,atkMultiplier:1,defMultiplier:2}]}},'NORMAL','normal',1),/unknown resonance enemy node curve field/);
  assert.throws(()=>resolveEnemyBalance({nodeCurve:{EASY:[{node:1,hpMultiplier:1,atkMultiplier:1}]}},'NORMAL','normal',1),/difficulty/);
});
