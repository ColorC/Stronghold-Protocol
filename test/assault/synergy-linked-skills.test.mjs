import test from 'node:test';
import assert from 'node:assert/strict';
import {LINKED_SKILLS} from '../../shared/assault/global-skill-pool.js';
import {installLinkedSkills} from '../../server/sim/content/assault/linked-skills.js';
import {synergyBattle} from '../helpers/synergyCard.js';
import {assaultAmmoState} from '../../server/sim/content/assault/ammo.js';
for(const skill of LINKED_SKILLS)test(`${skill.name}: the real trigger benefits another operator, with a shared 2s cooldown`,()=>{
  const h=synergyBattle([{charId:'char_127_estell',row:9,col:3},{charId:'char_498_inside',row:9,col:4}]);
  const [source,target]=h.units;h.hold(source);h.hold(target);
  const enemy=h.spawn([9,5]);target.hp=target.s.maxHp*.4;
  assert.equal(h.castNow(target),true);h.hold(target);
  const ammo=target._assaultAmmoController;assert.ok(ammo);ammo.set(Math.max(0,ammo.max()-4));
  installLinkedSkills(h.battle,{input:{skillRanks:{[skill.id]:4}}},[skill]);
  const value=()=>JSON.stringify([target.hp,target.s.atk,target.skill.sp,target.assaultCycle.at,
    assaultAmmoState(target),target.buffs.map(b=>[b.key,b.shield])]);
  const sourceBefore=[source.s.atk,source.skill.sp,source.assaultCycle.at];
  const emit=()=>{h.battle.assaultRuntime.publish(skill.battle.event,{source,target:enemy,status:skill.battle.status,applied:true,amount:1});h.flush();};
  const initial=value();emit();const first=value();assert.notEqual(first,initial);
  emit();assert.equal(value(),first,'the same Skill cannot pay twice inside its cooldown');
  assert.deepEqual([source.s.atk,source.skill.sp,source.assaultCycle.at],sourceBefore,'the triggering operator never rewards itself');
  assert.deepEqual(h.battle.errors,[]);
});
