// Replacement for assertions on the intentionally removed timed attack windows.
// Check the advanced module and two real casts, rather than merely an activation.
import assert from 'node:assert/strict';
import { synergyBattle,runtime } from './synergyCard.js';
import { cycleRedeploy } from '../../server/sim/content/assault/redeploy-cycle.js';
export function revisedSkillContract(charId) {
 const body=runtime.bodies[charId];
 const h=synergyBattle([{charId,star:4,row:9,col:3,moduleId:body.defaultModuleId},
   {charId:'char_150_snakek',star:1,row:9,col:4}]);
 const [unit,other]=h.units;h.hold(unit);h.hold(other);
 const keys=[...unit.rangeKeys].map(k=>[Math.floor(k/21),k%21]).filter(([r,c])=>h.battle.grid.inRect(r,c));
 const enemies=[...Array.from({length:8},()=>h.spawn([unit.tileR,unit.tileC+1],{mods:{hpMul:100,speedMul:0,atkMul:0}})),...Array.from({length:8},()=>h.spawn([unit.tileR,unit.tileC],{mods:{hpMul:100,speedMul:0,atkMul:0}})),...Array.from({length:8},()=>h.spawn(keys[0]??[unit.tileR,unit.tileC+1],{mods:{hpMul:100,speedMul:0,atkMul:0}}))];
 enemies.forEach(e=>{e.hp=e.s.maxHp*.6;});h.run(.1);h.units.forEach(h.hold);
 for(const u of h.units)u.hp=u.s.maxHp*.35;
 const state=()=>JSON.stringify({hp:enemies.map(e=>[e.hp,e.buffs.map(b=>[b.status,b.timeLeft])]),allies:h.units.map(u=>[u.hp,u.s.atk,u.s.def,u.s.maxHp,u.s.aspd,u.s.res,
   u.buffs.map(b=>[b.key,b.shield,b.mods,b.flags])]),stacks:h.battle.assaultBattleStacks,dp:h.battle.getPlayer(unit.ownerId).dp});
 const cast=()=>{if(unit.skill.kind!=='passive')return h.castNow(unit);const result=cycleRedeploy(h.battle,unit,{reason:'skill'});h.flush();return result;};
 const initial=state();assert.equal(cast(),true);const first=state();assert.notEqual(first,initial);
 h.run(.1);for(const u of h.units)u.hp=u.s.maxHp*.35;assert.equal(cast(),true);assert.notEqual(state(),first,'second cast delivers another payoff');
 assert.deepEqual(h.battle.errors,[]);
}
