import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { Battle } from '../../server/sim/Battle.js';
import { installResonancePacts } from '../../server/sim/content/resonance/pacts.js';
import { CURRENT_PACT_VERSION } from '../../shared/resonance/current-pacts.js';
import { enemyRec, flatStage } from '../helpers/battleHarness.js';

const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
const current=getResonanceCatalog(data,{rulesVersion:2,seed:3});
const legacy=getResonanceCatalog(data,{environmentId:'origin_laterano',seed:3});
const shieldKey='resonance:pact:symbiosis-periodic-shield';
const oldKey='resonance:pact:symbiosis-shield';
const starKey='resonance:star3:symbiosis-shield';
const shield=unit=>unit.buffs.find(row=>row.key===shieldKey);
const speed=unit=>unit.buffs.find(row=>row.key===`resonance:pact:symbiosis-periodic-speed:${unit.id}`);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function setup(count,{rules=current,starOwner=false,timeLimit=60}={}) {
  const operators=Object.fromEntries(Object.entries(rules.operators).map(([id,op])=>[id,{...op,pacts:[]}]));
  const rows=[...new Map(rules.config.activeOperatorIds.map(id=>operators[id]).map(op=>[op.charId,op])).values()];
  if(starOwner){const owner=Object.values(operators).find(op=>op.stars[3].passive?.kind==='star3_symbiosis');assert.ok(owner);rows.splice(rows.findIndex(op=>op.charId===owner.charId),1);rows.unshift(owner);}
  const chosen=rows.slice(0,8),content={...rules,operators};
  const player={playerId:'resonance',units:chosen.map((op,index)=>({uid:`piece-${index}`,chessId:op.id,skillIndex:op.fixedSkillIndex??0,moduleId:'none',row:9,col:1+index,dir:'RIGHT',star:starOwner&&index===0?3:1,items:[],extraPacts:index<count?['symbiosis']:[]}))};
  const kits=Object.fromEntries(chosen.map(op=>[op.id,()=>({trait:{noAttack:true},skill:{id:'symbiosis-test',kind:'instant',trigger:'SP_FULL',spCost:999,initSp:0,spType:'none'}})]));
  const battle=new Battle({seed:3,kind:'normal',round:1,timeLimit,autoFinish:false,stage:flatStage({id:'symbiosis-test'}),data,players:[player],kits,content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:20,dpPerSec:1,dpMax:99}});
  const active=installResonancePacts(battle,{catalog:content,state:{pieces:[]}});
  assert.equal(active.get('symbiosis').tier,count);
  return {battle,units:battle.allyUnits,chosen};
}
function advance(battle,to) { while(battle.time<to-1e-9&&!battle.finished)battle.step();assert.equal(battle.errorCount,0); }
function dummy(battle) { return battle.spawnEnemy('symbiosis-enemy',{pos:[9,10],def:enemyRec({key:'symbiosis-enemy',hp:1e9,atk:0,def:0,res:0,speed:0,rank:'NORMAL'})}); }

test('current pact version and player text describe all adapted numbers while v1 remains heal-to-shield',()=>{
  assert.equal(CURRENT_PACT_VERSION,4);
  for(const [index,threshold] of [2,4,6].entries()) {
    const level=current.pacts.symbiosis.levels[index];assert.equal(level.threshold,threshold);
    assert.equal(level.effects[0].kind,'symbiosis_guard');assert.equal(level.effects[0].params.interval,8);assert.equal(level.effects[0].params.duration,5);
    assert.deepEqual(current.playerText.pacts.symbiosis.levels[index],{threshold,description:level.description});
    for(const number of Object.values(level.effects[0].params))assert.ok(level.description.includes(String(number)));
    assert.ok(!level.description.includes('下一击'));
    assert.equal(legacy.pacts.symbiosis.levels[index].effects[0].kind,'symbiosis_barrier');
    assert.ok(!Object.hasOwn(legacy.pacts.symbiosis.levels[index].effects[0].params,'aspd'));
  }
});

test('full-health combat start grants exact 2/4/6 tier target counts, shields and independent attack speed',()=>{
  for(const [count,targetCount,hpPercent,aspd] of [[2,1,15,20],[4,2,25,35],[6,3,35,50]]) {
    const {battle,units,chosen}=setup(count);const baselines=units.map(unit=>unit.s.aspd);battle.start();
    const expected=[...units].sort((a,b)=>Number(chosen[units.indexOf(b)].role==='frontline'||chosen[units.indexOf(b)].position==='MELEE')-Number(chosen[units.indexOf(a)].role==='frontline'||chosen[units.indexOf(a)].position==='MELEE')||a.id-b.id).slice(0,targetCount);
    assert.deepEqual(units.filter(unit=>shield(unit)),units.filter(unit=>expected.includes(unit)));
    for(const unit of units){near(unit.hp,unit.s.maxHp);near(unit.s.aspd,baselines[units.indexOf(unit)]+(expected.includes(unit)?aspd:0));if(expected.includes(unit)){near(shield(unit).shield,unit.s.maxHp*hpPercent/100);assert.equal(speed(unit).duration,5);}}
    assert.equal(battle.errorCount,0);
  }
});

test('breaking a periodic shield leaves attack speed until five seconds and grants no next-hit bonus',()=>{
  const {battle,units}=setup(6);const baseline=units.map(unit=>unit.s.aspd);battle.start();const target=units.find(unit=>shield(unit)),enemy=dummy(battle);
  battle.dealDamage(enemy,target,{amount:shield(target).shield+1,type:'true',isAttack:true,canDodge:false});
  assert.equal(shield(target),undefined);near(target.s.aspd,baseline[units.indexOf(target)]+50);
  assert.equal(target.mem.pactSymbiosisAttackBonus,undefined);
  advance(battle,4.9);assert.ok(speed(target));advance(battle,5.1);assert.equal(speed(target),undefined);near(target.s.aspd,baseline[units.indexOf(target)]);
});

test('eight-second pulse chooses distinct lowest-ratio living deployed operators and excludes dead, removed, bench, token and enemy',()=>{
  const {battle,units}=setup(6);battle.start();const enemy=dummy(battle);
  battle.dealDamage(enemy,units[0],{amount:1e7,type:'true',canDodge:false});assert.equal(units[0].alive,false);
  units[1].removed=true;units[2].deployed=false;
  const tokenId=Object.values(data.chess).find(row=>row.tokens?.length).tokens[0],token=battle.spawnToken(units[3],tokenId,9,9,{def:data.tokens[tokenId],kit:{trait:{noAttack:true}}});assert.ok(token);token.hp=1;
  units[3].hp=units[3].s.maxHp*.9;units[4].hp=units[4].s.maxHp*.4;units[5].hp=units[5].s.maxHp*.3;units[6].hp=units[6].s.maxHp*.2;units[7].hp=units[7].s.maxHp*.8;
  advance(battle,7.9);assert.equal(units.some(unit=>shield(unit)),false);advance(battle,8.1);
  assert.deepEqual(units.filter(unit=>shield(unit)),[units[4],units[5],units[6]]);
  assert.equal(shield(token),undefined);assert.equal(shield(enemy),undefined);
  for(const unit of units.filter(unit=>shield(unit))){near(shield(unit).shield,unit.s.maxHp*.35);assert.equal(unit.buffs.filter(row=>row.key===shieldKey).length,1);near(speed(unit).mods.aspd,50);}
  advance(battle,16.1);for(const unit of [units[4],units[5],units[6]])assert.equal(unit.buffs.filter(row=>row.key===shieldKey).length,1);
});

test('healing amplification applies only to members with real effective healing at every tier',()=>{
  for(const [count,bonus] of [[2,15],[4,30],[6,50]]) {
    const {battle,units}=setup(count);battle.start();const target=units[7];target.hp=target.s.maxHp-1000;
    const before=target.hp;battle.heal(units[0],target,40);near(target.hp-before,40*(1+bonus/100));
    const again=target.hp;battle.heal(units[7],target,40);near(target.hp-again,40);
    near(units[0].s.healingDealtMul,1+bonus/100);near(units[7].s.healingDealtMul,1);
  }
});

test('star-three heal conversion has its own shield and cooldown without suppressing periodic protection',()=>{
  const {battle,units}=setup(2,{starOwner:true});battle.start();const [owner,target]=units;
  target.hp=target.s.maxHp-500;battle.heal(owner,target,100);const passive=target.buffs.find(row=>row.key===starKey);assert.ok(passive);near(passive.shield,115*.15);
  assert.equal(target.mem.pactSymbiosisAt,undefined);assert.equal(target.mem.pactSymbiosisShieldUsed,undefined);
  const amount=passive.shield;battle.heal(owner,target,100);near(passive.shield,amount);
  advance(battle,7.9);target.hp=target.s.maxHp*.1;battle.heal(owner,target,10);const at=target.mem.star3SymbiosisAt;
  advance(battle,8.1);assert.equal(target.mem.star3SymbiosisAt,at);near(shield(target).shield,target.s.maxHp*.15);
  assert.equal(target.mem.pactSymbiosisAttackBonus,undefined);
});

test('member healing amplification survives a genuine defeat and native redeployment without spreading to others',()=>{
  const {battle,units}=setup(2,{timeLimit:120});battle.start();const owner=units[0],enemy=dummy(battle);
  battle.dealDamage(enemy,owner,{amount:1e7,type:'true',canDodge:false});assert.equal(owner.alive,false);assert.ok(Number.isFinite(owner.respawnAt));
  assert.ok(owner.respawnAt<battle.timeLimit);near(owner.s.healingDealtMul,1.15);advance(battle,owner.respawnAt+.2);assert.equal(owner.alive,true);assert.equal(owner.deployed,true);near(owner.s.healingDealtMul,1.15);
  const target=units.find((unit,index)=>index>=2&&unit.alive&&unit.deployed&&!unit.profile?.noHeal&&!unit.s.flags.noHeal&&!unit.s.flags.healFree);assert.ok(target);
  target.hp=target.s.maxHp-100;const before=target.hp;battle.heal(owner,target,40);near(target.hp-before,46);near(target.s.healingDealtMul,1);
});

test('v1 enemy break queues a single ordinary hit; skill and extra damage do not consume or recursively replay it',()=>{
  const {battle,units}=setup(2,{rules:legacy});battle.start();const source=units[0],target=units.find((unit,index)=>index>=2&&!unit.profile?.noHeal&&!unit.s.flags.noHeal&&!unit.s.flags.healFree),enemy=dummy(battle);assert.ok(target);
  target.hp=target.s.maxHp-100;battle.heal(source,target,100);assert.ok(target.buffs.find(row=>row.key===oldKey));
  battle.dealDamage(enemy,target,{amount:16,type:'true',isAttack:true,canDodge:false});near(target.mem.pactSymbiosisAttackBonus,.3);
  battle.dealDamage(target,enemy,{amount:10,type:'true',isAttack:true,isSkill:true,canDodge:false});near(target.mem.pactSymbiosisAttackBonus,.3);
  battle.dealDamage(target,enemy,{amount:10,type:'true',isAttack:true,tags:['resonance'],canDodge:false});near(target.mem.pactSymbiosisAttackBonus,.3);
  const first=battle.dealDamage(target,enemy,{amount:10,type:'true',isAttack:true,canDodge:false});near(first,10+target.s.atk*.3);assert.equal(target.mem.pactSymbiosisAttackBonus,0);
  const second=battle.dealDamage(target,enemy,{amount:10,type:'true',isAttack:true,canDodge:false});near(second,10);assert.equal(target.mem.pactSymbiosisShieldUsed,false);
});

test('v1 star-three shield does not share the pact cooldown or arm a break reward by itself',()=>{
  const {battle,units}=setup(2,{rules:legacy,starOwner:true});battle.start();const [owner,target]=units;
  target.hp=target.s.maxHp-100;battle.heal(owner,target,100);
  near(target.buffs.find(row=>row.key===oldKey).shield,15);near(target.buffs.find(row=>row.key===starKey).shield,15);
  assert.equal(target.mem.pactSymbiosisAt,battle.time);assert.equal(target.mem.star3SymbiosisAt,battle.time);
  battle.removeBuff(target,oldKey);target.mem.pactSymbiosisShieldUsed=false;
  battle.dealDamage(dummy(battle),target,{amount:16,type:'true',isAttack:true,canDodge:false});assert.equal(target.mem.pactSymbiosisAttackBonus,undefined);
});
