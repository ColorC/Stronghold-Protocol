import test from 'node:test';
import assert from 'node:assert/strict';
import {CAST_PAYOFFS} from '../../shared/assault/skill-resolutions.js';
import {synergyBattle,runtime} from '../helpers/synergyCard.js';

// §4.2 replaces the 10-23 universal two-cast payoff contract. Each native
// signature has its own A/B/C/D/E causal suite; C may be once per battle,
// and independent original projectiles/fields need not settle on the same tick.
test('retired generic recast payoffs are absent from every compiled card',()=>{
  for(const charId of Object.keys(CAST_PAYOFFS))assert.equal(runtime.bodies[charId].bazaar.castPayoff,undefined,charId);
});

test('Exusiai resolves a complete twelve-shot burst on every skill cast',()=>{
  const h=synergyBattle([{charId:'char_103_angel',star:4,row:9,col:3}]),[u]=h.units;
  const enemy=h.spawn(h.rangeTile(u,{nearest:true}));h.hold(u);
  let hits=0;h.battle.on('hit',({source,dmg})=>{if(source===u&&dmg.isSkill)hits++;});
  h.castNow(u);assert.equal(hits,12);h.castNow(u);assert.equal(hits,24);assert.ok(enemy.hp<enemy.s.maxHp);
});

test('Reed native S3 keeps two targets and both casts of stored scorch pulses really deal damage',()=>{
  const h=synergyBattle([{charId:'char_1020_reed2',row:9,col:3},{charId:'char_150_snakek',row:9,col:4}]),[u]=h.units;
  h.units.forEach(x=>{h.hold(x);x.profile.noAttack=true;});h.spawn([9,5]);h.spawn([9,4]);
  h.castNow(u);assert.equal(u.mem.adaptReedPulses.length,6);h.castNow(u);assert.equal(u.mem.adaptReedPulses.length,12);
  const targets=new Set();h.battle.on('hit',({source,target,dmg})=>{if(source===u&&dmg.isSkill&&!dmg.isAttack)targets.add(target);});
  h.run(1.1);assert.equal(u.mem.adaptReedPulses.length,11);assert.equal(targets.size,2);
  assert.deepEqual(h.battle.errors,[]);
});
