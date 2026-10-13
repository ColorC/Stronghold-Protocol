import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {buildResonanceBattle,getResonanceField,resolveEnemyBalance,enemyNodeCurveFactor} from '../../server/modes/resonance/battle.js';
import {GameData} from '../../server/match/gamedata.js';
import {bossPoolHp} from '../../server/match/finalAssault.js';
import {enemyLeaderBalance} from '../../shared/resonance/enemy-curve.js';
const data=loadData(process.env.SP_DATA_DIR,{log:{warn(){},error(){}}});
const catalog=getResonanceCatalog(data,{rulesVersion:3,seed:23});
const config=catalog.campaign.enemyBalance;
const DIFFICULTIES=['FUNNY','NORMAL','HARD','ABYSS'];
const at=(difficulty,node,kind='normal')=>resolveEnemyBalance(config,difficulty,kind,node);

test('the current campaign raises regular-wave HP and ATK along each difficulty curve (key points)',()=>{
  // [difficulty, node, HP, ATK]: start, mid and end of every curve on top of the difficulty profile
  for(const [difficulty,node,hp,atk] of [
    ['FUNNY',2,0.55,0.75],['FUNNY',12,0.55,0.75],['FUNNY',26,0.6013,0.82],
    ['NORMAL',1,0.65,0.85],['NORMAL',5,0.715,0.918],['NORMAL',9,0.9425,1.0625],['NORMAL',13,1.235,1.275],['NORMAL',17,1.495,1.462],['NORMAL',21,1.69,1.632],['NORMAL',27,1.885,1.8275],
    ['HARD',1,0.9,1],['HARD',4,0.945,1],['HARD',8,1.08,1.12],['HARD',12,1.35,1.36],['HARD',18,1.665,1.65],['HARD',22,1.845,1.85],['HARD',27,1.935,1.92],
    ['ABYSS',1,1,1],['ABYSS',4,1,1],['ABYSS',8,1.15,1.15],['ABYSS',12,1.4,1.4],['ABYSS',18,1.7,1.7],['ABYSS',22,1.9,1.9],['ABYSS',27,1.9714,1.9714],
  ]){
    const profile=at(difficulty,node);
    assert.deepEqual([profile.hpMultiplier,profile.atkMultiplier],[hp,atk],`${difficulty} node ${node}`);
  }
  assert.deepEqual([at('ABYSS',29,'elite').hpMultiplier,at('ABYSS',29,'elite').atkMultiplier],[2,2],'ABYSS elite node 29 ends the curve at ×2');
});

test('the curve never falls, keeps the four difficulties apart, and leaves DEF on the profile',()=>{
  for(const difficulty of DIFFICULTIES){
    let hp=0,atk=0;
    for(let node=1;node<=27;node++){
      const profile=at(difficulty,node);
      assert.ok(profile.hpMultiplier>=hp&&profile.atkMultiplier>=atk,`${difficulty} HP and ATK do not fall at node ${node}`);
      hp=profile.hpMultiplier;atk=profile.atkMultiplier;
      assert.equal(profile.defMultiplier,resolveEnemyBalance(config,difficulty,'normal').defMultiplier,`${difficulty} DEF stays on the profile`);
    }
  }
  for(let node=1;node<=27;node+=1){
    const hp=DIFFICULTIES.map(difficulty=>at(difficulty,node).hpMultiplier),atk=DIFFICULTIES.map(difficulty=>at(difficulty,node).atkMultiplier);
    assert.ok(hp[0]<hp[1]&&hp[1]<hp[2]&&hp[2]<hp[3],`HP order 轻松<标准<困难<深渊 at node ${node}: ${hp}`);
    assert.ok(atk[0]<atk[1]&&atk[1]<=atk[2]&&atk[2]<=atk[3],`ATK order never reversed at node ${node}: ${atk}`);
  }
  // 标准 rises from node 1: by node 9 its regular enemies carry 1.45× the HP of the flat 0.65 profile, by node 27 2.15× the ATK
  assert.ok(at('NORMAL',9).hpMultiplier/0.65>1.4&&at('NORMAL',27).atkMultiplier/0.85>2.1);
});

test('leader nodes take their own profile over the terminal one, not the curve',()=>{
  for(const difficulty of DIFFICULTIES){
    const leader=at(difficulty,28,'boss');
    for(const [key,value] of Object.entries(enemyLeaderBalance[difficulty]))assert.equal(leader[key],value,`${difficulty} leader ${key}`);
    assert.equal(leader.defMultiplier,at(difficulty,1).defMultiplier,`${difficulty} leader DEF stays on the profile`);
    assert.deepEqual(leader,resolveEnemyBalance(config,difficulty,'boss'),`${difficulty} leader does not depend on the node`);
    // the difficulty card reads byDifficulty alone: its terminal profile is written out whole
    for(const key of ['hpMultiplier','atkMultiplier','defMultiplier','bossPoolMultiplier'])assert.equal(config.byDifficulty[difficulty].terminal[key],leader[key],`${difficulty} byDifficulty terminal ${key}`);
  }
  assert.deepEqual(at('ABYSS',30,'hidden'),at('ABYSS',28,'boss'));
  const pick=(difficulty)=>{const x=at(difficulty,28,'boss');return [x.hpMultiplier,x.atkMultiplier,x.bossPoolMultiplier];};
  assert.deepEqual(pick('FUNNY'),[0.65,0.8,0.4]);
  assert.deepEqual(pick('NORMAL'),[0.85,0.9,2]);
  assert.deepEqual(pick('HARD'),[0.95,1,1.3]);
  assert.deepEqual(pick('ABYSS'),[1,1,1]);
  const hp=DIFFICULTIES.map(difficulty=>pick(difficulty)[0]),atk=DIFFICULTIES.map(difficulty=>pick(difficulty)[1]);
  assert.ok(hp[0]<hp[1]&&hp[1]<hp[2]&&hp[2]<=hp[3]&&atk[0]<atk[1]&&atk[1]<atk[2]&&atk[2]<=atk[3],`escort order: ${hp} / ${atk}`);
  // the pool multipliers are not ordered, the pools are: every leader's pool grows from 轻松 to 深渊
  const modes={FUNNY:'mode_single_normal',NORMAL:'mode_single_normal',HARD:'mode_single_hard',ABYSS:'mode_single_abyss'};
  for(let index=1;index<=10;index++){
    const pools=DIFFICULTIES.map(difficulty=>bossPoolHp(new GameData(data,modes[difficulty]),`boss_${index}`,1)*pick(difficulty)[2]);
    assert.ok(pools[0]<pools[1]&&pools[1]<pools[2]&&pools[2]<pools[3],`boss_${index} pool order: ${pools}`);
  }
  // a built 标准 leader fight carries twice its native pool
  const state={seed:23,difficulty:'NORMAL',round:28,roundLimit:28,rulesVersion:3,seasonId:catalog.config.seasonId,level:1,hp:100,strategies:[],pieces:[]};
  const {battle,prepared}=buildResonanceBattle(state,{data,catalog});
  assert.equal(prepared.enemyBalance.bossPoolMultiplier,2);
  assert.equal(battle.sharedBoss.maxHp,Math.round(bossPoolHp(prepared.gd,prepared.bossId,1)*2));
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
  assert.equal(resolveEnemyBalance(legacy.campaign.enemyBalance,'NORMAL','boss').bossPoolMultiplier,0.5,'and their leader profiles');
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
