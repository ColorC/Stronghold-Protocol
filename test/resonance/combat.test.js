import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { installResonanceBattle } from '../../server/sim/content/resonance/battle.js';
import { createResonanceKits } from '../../server/sim/content/resonance/kits.js';
import { resonanceContent } from '../../shared/resonance/catalog.js';

const unit = (id) => chessRec({ id, charId: id, profession: 'WARRIOR', stats: { maxHp: 2000, atk: 500, def: 100, blockCnt: 1 }, rangeGrid: [[0,0],[0,1]], skill: null });
const pactCatalog = {
  operators: {
    test_a: { id: 'test_a', charId: 'test_a', sourceChessId: 'test_a', pacts: ['aegir'], stars: { 1: { passive: { kind: 'none', params: {} } } } },
    test_b: { id: 'test_b', charId: 'test_b', sourceChessId: 'test_b', pacts: ['aegir'], stars: { 1: { passive: { kind: 'none', params: {} } } } },
  },
  pacts: { aegir: { levels: [{ threshold: 2, effects: [
    { kind: 'stat', params: { stat: 'maxHp', mode: 'percent', value: 25 } },
    { kind: 'aegir_cycle', params: { hp: 25, regen: 1, atkFromHp: 2, block: 0, retaliation: 2.5, retaliationRadius: 1.5, cd: 2, damageType: 'arts' } },
  ] }] } },
  equipment: {},
};

function signatureFixture(name,{star=3,skillKind='duration',tokens=[],allies=[],enemies=[]}={}){
  const operator=Object.values(resonanceContent.operators).find(row=>row.name===name);assert.ok(operator,`catalog signature exists: ${name}`);
  const opDef=chessRec({id:'signature_owner',charId:operator.charId,profession:'WARRIOR',position:operator.position??'MELEE',rangeGrid:[[0,0],[0,1],[0,2],[1,0],[-1,0]],tokens,skill:{skillId:'signature_skill',id:'signature_skill',skillType:'MANUAL',durationType:'TIME',duration:30,spType:'INCREASE_WITH_TIME',spCost:1,initSp:0,bb:{}}});
  const defMap={chess:{signature_owner:opDef},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e6,speed:0})},tokens:Object.fromEntries(tokens.map(id=>[id,{stats:{maxHp:1000,atk:100,def:0,res:0,aspd:100,bat:1,blockCnt:1}}]))};
  for(const [id,def] of Object.entries(allies))defMap.chess[id]=def;
  const catalog={operators:{[operator.sourceChessId]:operator},pacts:{},equipment:{}};
  const state={pieces:[{uid:'signature-owner',star}]};
  const h=makeBattle({defs:defMap,units:[{chessId:'signature_owner',uid:'signature-owner',row:9,col:5,star},...Object.keys(allies).map((id,i)=>({chessId:id,uid:id,row:10,col:4+i}))],enemies:[],content:'generic',autoFinish:false,recordEvents:false,
    kits:{signature_owner:()=>({skill:{id:'signature_skill',kind:skillKind,duration:30,ammo:2,spCost:1,initSp:0,spType:'time'}})},extraContent:[b=>installResonanceBattle(b,{catalog,state})]});
  h.b.start();return {h,owner:h.unit('signature-owner'),catalogOp:operator,state};
}

test('Aegir applies HP-derived ATK in the same stat recalc and retaliates only to an incoming enemy attack', () => {
  const h = makeBattle({
    defs: { chess: { test_a: unit('test_a'), test_b: unit('test_b') }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0, atk: 100 }) } },
    units: [{ chessId: 'test_a', uid: 'a', row: 9, col: 5 }, { chessId: 'test_b', uid: 'b', row: 10, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 7] }], content: 'none', autoFinish: false, recordEvents: false,
    extraContent: [b => installResonanceBattle(b, { catalog: pactCatalog, state: {} })],
  });
  h.step();
  const a = h.unit('a'); const enemy = h.enemy('enemy_dummy');
  assert.equal(a.s.maxHp, 2500);
  assert.equal(a.s.atk, 550);
  h.b.dealDamage(a, enemy, { amount: 1, type: 'phys', isAttack: true, canDodge: false });
  assert.equal(h.b.resonanceMetrics.triggers.aegir ?? 0, 0, 'outgoing ally damage cannot start retaliation');
  h.b.dealDamage(enemy, a, { amount: 1, type: 'phys', isAttack: true, canDodge: false });
  assert.equal(h.b.resonanceMetrics.triggers.aegir, 1, 'effective incoming enemy hit starts one retaliation');
  assert.equal(h.b.resonanceDynamicFloors, null, 'recording:false does not allocate display regions');
});

test('Dragon Gate halves only the first leak loss with floor rounding; other environments keep native loss', () => {
  const make = (environmentId) => makeBattle({
    defs: { chess: {}, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1000, speed: 0 }) } },
    units: [], enemies: [], content: 'none', autoFinish: false, recordEvents: false,
    extraContent: [b => installResonanceBattle(b, { catalog: {
      operators: {}, pacts: {}, equipment: {},
      environments: { origin_lungmen: { rule: { kind: 'environment_leak_reduction', params: { firstLeak: 50 } } }, origin_yan: { rule: { kind: 'environment_skill_refund', params: { firstCasts: 2, sp: 1 } } } },
    }, state: { environmentId, pieces: [] } })],
  });
  const dragon = make('origin_lungmen');
  const first = dragon.spawn('enemy_dummy', { pos: [9, 3] });
  const second = dragon.spawn('enemy_dummy', { pos: [9, 4] });
  dragon.b.leak(first); dragon.b.leak(second);
  assert.equal(first.lpr, 0, 'floor(1 / 2) records zero loss for the first 1-LP leak');
  assert.equal(second.lpr, 1, 'the second leak keeps its full native loss');

  const other = make('origin_yan');
  const unchanged = other.spawn('enemy_dummy', { pos: [9, 3] });
  other.b.leak(unchanged);
  assert.equal(unchanged.lpr, 1, 'an unrelated environment does not change leak loss');
});

test('Yela marks walkable and objective tiles, shares each tile cooldown, and star-three skill adds its single-target hits', () => {
  const yelaDef = { ...unit('chess_char_6_02_a'),id:'chess_char_6_02_a',baseId:'chess_char_6_02_a',chessId:'chess_char_6_02_a',charId: 'char_1046_sbell2', resonanceOperatorId: 'yela', resonanceStar: 3, position: 'RANGED', profession: 'CASTER',subProfessionId:'phalanx',skill:{id:'skchr_sbell2_3',skillId:'skchr_sbell2_3',skillType:'AUTO',durationType:'TIME',duration:30,spType:'INCREASE_WITH_TIME',spCost:10,initSp:0,trigger:{rule:'DEFAULT'},rangeGrid:[[0,0],[0,1]],bb:{}} };
  const state={pieces:[{uid:'yela-owner',star:3}]};
  const catalog = {
    operators: { yela: { id: 'yela', charId: 'char_1046_sbell2', sourceChessId: 'chess_char_6_02_a', fixedSkillId:'skchr_sbell2_3', name: '圣聆初雪', cost: 5, pacts: ['yela'], stars: { 1:{record:yelaDef,passive:{kind:'none',params:{}}}, 3: {record:yelaDef,passive: { kind: 'star3_yela', params: { tileCooldown: 1, coldDuration: 3, permanentSkill: true, singleTargetExtraHits: 2, hitDamage: 500, paralysisStacks: 1 } } } } } },
    pacts: { yela: { levels: [{ threshold: 1, effects: [{ kind: 'yela_breath', params: { byStar: { 3: { tileCooldown: 1, coldDuration: 3, perColdSp: .2, skillAtk: 10, skillAspd: 10 } } } }] }] } },
    equipment: {},
  };
  const h = makeBattle({ defs: { chess: { chess_char_6_02_a: yelaDef }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 50000, speed: 0 }) } }, units: [{ chessId: 'chess_char_6_02_a', uid: 'yela-owner', row: 9, col: 5,star:3 }], enemies: [], kits:createResonanceKits(catalog,state), content: 'generic', autoFinish: false, recordEvents: false, extraContent: [b => installResonanceBattle(b, { catalog, state })] });
  h.b.start();
  assert.ok(h.b.resonanceFloors.some(([r,c]) => r === 9 && c === 2), 'the objective tile is included in static snow');
  const enemy = h.spawn('enemy_dummy', { pos: [9, 7] });
  const coOccupant = h.spawn('enemy_dummy', { pos: [9, 7] });
  h.step(20);
  assert.equal(enemy.s.flags.cold, true, 'the enemy entering a snow tile receives the cold status');
  assert.equal(coOccupant.s.flags.cold, true, 'all enemies on the tile are hit when its shared cooldown fires');
  assert.equal(h.unit('yela-owner').skill.active,true,'star-three signature skill is active for the whole fight');
  assert.ok(h.unit('yela-owner').findBuff('trait:phalanxGuard'),'star-three Yela retains the phalanx defensive trait while active');
  const late=h.spawn('enemy_dummy',{pos:[9,7]});h.step(1);
  assert.notEqual(late.s.flags.cold,true,'a later enemy cannot bypass the tile-wide cooldown');
  const before=enemy.hp;h.b.emit('attack',{attacker:h.unit('yela-owner'),targets:[enemy],isSkill:false});
  assert.equal(before-enemy.hp,h.unit('yela-owner').s.atk*10,'the active star-three single-target attack adds exactly two 500% hits');
  assert.equal(enemy.findBuff('palsy')?.stacks,1,'the single-target bonus uses the engine paralysis status');
  assert.equal(h.b.resonanceDynamicFloors, null, 'static snow does not allocate dynamic display regions');
});

function holyGunCatalog(twoLaterano=false) {
  return { operators: {
    exu: { id:'exu', charId:'char_1041_angel2', sourceChessId:'exu', name:'新约能天使', cost:5, pacts:['laterano','holyGun'], stars:{
      1:{passive:{kind:'none',params:{}}},
      3:{passive:{kind:'star3_holyGun',params:{ammoSkillVulnerability:50,skillBombs:15,skillTargeting:'randomBattleTiles'}}},
    } },
    laterano: { id:'laterano', charId:'char_laterano', sourceChessId:'laterano', name:'拉特兰干员', cost:4, pacts:['laterano'], stars:{1:{passive:{kind:'none',params:{}}}} },
    ...(twoLaterano?{laterano2:{id:'laterano2',charId:'char_laterano_2',sourceChessId:'laterano2',name:'第二拉特兰干员',cost:4,pacts:['laterano'],stars:{1:{passive:{kind:'none',params:{}}}}}}:{}),
    neutral: { id:'neutral', charId:'char_neutral', sourceChessId:'neutral', name:'其他干员', cost:4, pacts:[], stars:{1:{passive:{kind:'none',params:{}}}} },
  }, pacts:{holyGun:{levels:[{threshold:1,effects:[{kind:'holy_gun',params:{actionCooldown:.4,bombCount:15,skillId:'skchr_angel2_2',byStar:{1:{chance:15,damage:60,cap:100,factor:.005,radius:1.5},3:{chance:100,damage:500,cap:500,factor:.02,radius:2}}}}]}]}}, equipment:{} };
}

function holyGunBattle(star=3, skill=false, twoLaterano=false) {
  const exuDef={...unit('exu'),charId:'char_1041_angel2',resonanceStar:star,name:'新约能天使',
    skill: skill ? {id:'skchr_angel2_2',skillId:'skchr_angel2_2',spCost:1,initSp:0,spType:'INCREASE_WITH_TIME',duration:10,bb:{}} : null};
  const lateranoDef={...unit('laterano'),charId:'char_laterano'};
  const laterano2Def={...unit('laterano2'),charId:'char_laterano_2'};
  const neutralDef={...unit('neutral'),charId:'char_neutral'};
  return makeBattle({defs:{chess:{exu:exuDef,laterano:lateranoDef,laterano2:laterano2Def,neutral:neutralDef},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e9,speed:0})}},
    units:[{chessId:'exu',uid:`exu-${star}`,row:9,col:5,star},{chessId:'laterano',uid:'laterano',row:10,col:5},...(twoLaterano?[{chessId:'laterano2',uid:'laterano2',row:11,col:5}]:[]),{chessId:'neutral',uid:'neutral',row:12,col:5}],enemies:[],content:'none',autoFinish:false,recordEvents:false,
    extraContent:[b=>installResonanceBattle(b,{catalog:holyGunCatalog(twoLaterano),state:{pieces:[{uid:`exu-${star}`,star}]}})]});
}

test('Holy Gun proc uses the Saint star profile, triggers from any Laterano attack, and rejects non-Laterano attacks',()=>{
  const star1=holyGunBattle(1);star1.b.start();const exu1=star1.unit('exu-1'),laterano1=star1.unit('laterano'),enemy1=star1.spawn('enemy_dummy',{pos:[9,7]});
  star1.b.rng=()=>0;star1.b.emit('attack',{attacker:laterano1,targets:[enemy1],isSkill:false});
  assert.equal(star1.b.resonanceMetrics.triggers.holyGun,1,'a 15% star-one roll can trigger from another Laterano operator');
  const missed=holyGunBattle(1);missed.b.start();const missedAttack=missed.unit('laterano'),missedTarget=missed.spawn('enemy_dummy',{pos:[9,7]});
  missed.b.rng=()=>.99;missed.b.emit('attack',{attacker:missedAttack,targets:[missedTarget],isSkill:false});
  assert.equal(missed.b.resonanceMetrics.triggers.holyGun??0,0,'a star-one roll above its 15% chance does not trigger');
  const star3=holyGunBattle(3);star3.b.start();const laterano3=star3.unit('laterano'),neutral3=star3.unit('neutral'),enemy3=star3.spawn('enemy_dummy',{pos:[9,7]});
  star3.b.rng=()=>.99;star3.b.emit('attack',{attacker:neutral3,targets:[enemy3],isSkill:false});
  assert.equal(star3.b.resonanceMetrics.triggers.holyGun??0,0,'a non-Laterano attack cannot invoke the pact');
  const beforeFirstProc=enemy3.hp;
  star3.b.emit('attack',{attacker:laterano3,targets:[enemy3],isSkill:false});
  assert.equal(star3.b.resonanceMetrics.triggers.holyGun,1,'star-three guaranteed chance is independent of the roll');
  assert.equal(beforeFirstProc-enemy3.hp,star3.unit('exu-3').s.atk*5,'the star-three pact airstrike uses its 500% profile');
  assert.ok(enemy3.findBuff('resonance:ammoVulnerability'),'star-three airstrike marks its struck target');
  const beforeAmmoHit=enemy3.hp;star3.b.dealDamage(laterano3,enemy3,{amount:100,type:'phys',isAttack:true,tags:['ammoSkill'],canDodge:false});
  assert.equal(beforeAmmoHit-enemy3.hp,150,'only ammoSkill damage receives the 50% vulnerability');
  const beforeOrdinaryHit=enemy3.hp;star3.b.dealDamage(laterano3,enemy3,{amount:100,type:'phys',isAttack:true,tags:[],canDodge:false});
  assert.equal(beforeOrdinaryHit-enemy3.hp,100,'ordinary attack damage does not receive ammoSkill vulnerability');
  star3.b.emit('ammoUsed',{unit:neutral3});star3.b.emit('ammoUsed',{unit:laterano3});
  star3.b.time=.4;const beforeScaledProc=enemy3.hp;star3.b.emit('attack',{attacker:laterano3,targets:[enemy3],isSkill:false});
  assert.equal(beforeScaledProc-enemy3.hp,star3.unit('exu-3').s.atk*5.2,'two actual ammoUsed events scale the next star-three pact airstrike');
});

test('Holy Gun counts real ammoUsed globally and the fixed skill creates fifteen random-tile strikes',()=>{
  const h=holyGunBattle(3,true);h.b.start();const exu=h.unit('exu-3'),laterano=h.unit('laterano'),target=h.spawn('enemy_dummy',{pos:[9,7]});
  h.b.emit('ammoUsed',{unit:laterano});h.b.emit('ammoUsed',{unit:laterano});
  assert.equal(h.b.resonanceMetrics.totalAmmoSpent,2,'ammo consumption is counted independently of whether an ammo pact exists');
  const tiles=[];for(let r=h.b.rect.r0;r<=h.b.rect.r1;r++)for(let c=h.b.rect.c0;c<=h.b.rect.c1;c++)if(h.b.grid.walkable(r,c))tiles.push([r,c]);
  const index=tiles.findIndex(([r,c])=>r===9&&c===7);assert.notEqual(index,-1,'test target occupies a legal snowfield tile');
  h.b.rng=()=>((index+.01)/tiles.length);const before=target.hp;
  h.b.emit('skillStart',{unit:exu});
  assert.equal(target.hp,before-15*exu.s.atk*5,'the fixed skill makes fifteen 500% strikes on the selected random battlefield tile');
});

test('Holy Gun action cooldown is per Laterano attacker, so two operators can proc in the same instant',()=>{
  const h=holyGunBattle(3,false,true);h.b.start();h.b.rng=()=>0;const first=h.unit('laterano'),second=h.unit('laterano2'),target=h.spawn('enemy_dummy',{pos:[9,7]});
  h.b.emit('attack',{attacker:first,targets:[target],isSkill:false});h.b.emit('attack',{attacker:second,targets:[target],isSkill:false});
  assert.equal(h.b.resonanceMetrics.triggers.holyGun,2,'a team-global cooldown does not suppress a second member in the same frame');
  h.b.emit('attack',{attacker:first,targets:[target],isSkill:false});assert.equal(h.b.resonanceMetrics.triggers.holyGun,2,'the first member still respects its own 0.4-second cooldown');
});

test('the five fixed signature kits install their original talent hooks on the Battle kit',()=>{
  const defs={},operators={},units=[];
  const add=(id,name,skillId,bb,opts={})=>{
    const raw=chessRec({id,charId:id,profession:opts.profession??'WARRIOR',subProfessionId:opts.subProfessionId??null,position:opts.position??'MELEE',stats:{maxHp:2000,atk:500,def:100,aspd:100},skill:{id:skillId,skillId,skillType:'AUTO',durationType:'TIME',duration:15,spType:'INCREASE_WITH_TIME',spCost:10,initSp:0,trigger:{rule:'DEFAULT'},rangeGrid:[[0,0],[0,1]],bb}});
    raw.talents=opts.talents??[];defs[id]=raw;operators[id]={id,charId:id,sourceChessId:id,name,cost:5,fixedSkillId:skillId,stars:{1:{record:raw,passive:opts.passive??{kind:'none',params:{}}}}};
    units.push({chessId:id,uid:id,row:opts.row??9,col:opts.col??5,star:1});return raw;
  };
  add('wan','万顷','skchr_wanqin_2',{value:20,'attack@attack_speed':15,'attack@heal_scale':.12,'wanqin_s_2[cost].interval':.75,'wanqin_s_2[cost].cost':1},{row:9,col:5});
  add('plat','白金','skchr_platnm_2',{atk:.6,attack_speed:-20},{row:10,col:5,talents:[{bb:{'attack@min_delta':1,'attack@max_delta':2.5,'attack@min_atk_scale':1,'attack@max_atk_scale':1.4}}]});
  add('aosta','奥斯塔','skchr_aosta_2',{atk:.35,base_attack_time:.5,'attack@frozen_duration':1,talent_scale:2},{row:11,col:5});
  add('chiave','贾维','skchr_chiave_2',{cost:11,atk_scale:2.5,magic_resistance:-.1,duration:6},{row:12,col:5,talents:[{bb:{respawn_time:.4}}]});
  add('justice','正义骑士号','resonance_judgement_support',{}, {row:11,col:7,profession:'SUPPORT',position:'RANGED',passive:{kind:'judgement_support',params:{interval:1,range:2,healFromAtk:120,aspd:20,aspdDuration:3}}});
  defs.robot=chessRec({id:'robot',charId:'robot',profession:'SPECIAL',subProfessionId:'notchar1',position:'MELEE',stats:{maxHp:500,atk:100}});units.push({chessId:'robot',uid:'robot',row:12,col:6,star:1});
  const catalog={operators,pacts:{},equipment:{}};const state={pieces:units.map(x=>({uid:x.uid,star:x.star}))};
  const h=makeBattle({defs:{chess:defs,enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e6,speed:0})}},units,enemies:[],kits:createResonanceKits(catalog,state),content:'generic',autoFinish:false,recordEvents:false});
  h.b.start();h.step(100);
  const wan=h.unit('wan'),neighbor=h.unit('plat'),robot=h.unit('robot'),chiave=h.unit('chiave'),justice=h.unit('justice'),aosta=h.unit('aosta');
  assert.equal(neighbor.findBuff('resonance:wanqinTalent:'+wan.id)?.mods.aspd,15,'Wanqing same-direction ally receives the authored ASPD talent');
  assert.ok(wan.kit.talents.length>0&&neighbor.findBuff('resonance:wanqinTalent:'+wan.id),'the fixed skill talent is installed at Kit level');
  const plat=h.unit('plat'),target=h.spawn('enemy_dummy',{pos:[10,7]});const hp=target.hp;
  h.b.dealDamage(plat,target,{amount:100,type:'phys',isAttack:true,canDodge:false});
  assert.equal(hp-target.hp,140,'Platinum talent scales the actual hit by its charge blackboard');
  const aostaTarget=h.spawn('enemy_dummy',{pos:[11,7]});h.b.emit('attack',{attacker:aosta,targets:[aostaTarget],isSkill:false});
  assert.ok(aostaTarget.findBuff(`resonance:aostaDot:${aosta.id}`),'Aosta S2 talent installs the unblocked-target damage-over-time hook');
  assert.equal(robot.findBuff(`resonance:chiaveRobotDeploy:${chiave.id}`)?.mods.redeployMul,.6,'Chiave talent recognizes allied robot operators and lowers their redeploy time');
  aosta.hp=500;h.run(1.1);
  assert.ok(aosta.hp>500,'Justice Knight healing is applied by the passive talent timer');
  assert.ok(aosta.buffs.some(x=>String(x.key).startsWith(`resonance:judgement:${justice.id}`)),'Justice Knight haste uses the configured passive duration');
});

test('Crossfire strategy requires its live rule; fallback-applied strategy grants no battle buff', () => {
  const defs = { chess: {
    m1: chessRec({ id:'m1', position:'MELEE', profession:'WARRIOR', stats:{ maxHp:1000, atk:100, aspd:100 } }),
    m2: chessRec({ id:'m2', position:'MELEE', profession:'WARRIOR', stats:{ maxHp:1000, atk:100, aspd:100 } }),
    r1: chessRec({ id:'r1', position:'RANGED', profession:'SNIPER', stats:{ maxHp:1000, atk:100, aspd:100 } }),
    r2: chessRec({ id:'r2', position:'RANGED', profession:'SNIPER', stats:{ maxHp:1000, atk:100, aspd:100 } }),
  }, enemies:{} };
  const catalog={ operators:{},pacts:{},equipment:{},strategies:{cross:{...resonanceContent.strategies.strategy_31,id:'cross'}} };
  const run=(fallbackApplied,unknownPair=false)=>makeBattle({defs:unknownPair?{chess:{...defs.chess,u1:chessRec({id:'u1',position:'UNKNOWN'}),u2:chessRec({id:'u2',position:'UNKNOWN'})},enemies:{}}:defs,units:[
    {chessId:'m1',uid:'m1',row:9,col:5},{chessId:'m2',uid:'m2',row:10,col:5},
    {chessId:unknownPair?'u1':'r1',uid:unknownPair?'u1':'r1',row:9,col:7},{chessId:unknownPair?'u2':'r2',uid:unknownPair?'u2':'r2',row:10,col:7},
  ],enemies:[],content:'none',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state:{strategies:[{id:'cross'}],strategyState:fallbackApplied?{cross:{fallbackApplied:true}}:{}}})]});
  const active=run(false);active.b.start();assert.equal(active.unit('r1').s.aspd,120);assert.equal(active.unit('m1').s.maxHp,1200);
  const fallback=run(true);fallback.b.start();assert.equal(fallback.unit('r1').s.aspd,100);assert.equal(fallback.unit('m1').s.maxHp,1000);
  const unknown=run(false,true);unknown.b.start();assert.equal(unknown.unit('m1').s.maxHp,1000,'unknown positions do not count toward either role threshold');
});

test('battle strategies pair guard, last ammo, first freeze, construct rebuild, and execute use live Battle mechanics', () => {
  const op=(id,pos='MELEE',charId=id)=>chessRec({id,charId,position:pos,profession:pos==='MELEE'?'WARRIOR':'SNIPER',rangeGrid:[[0,0],[0,1],[0,2]],stats:{maxHp:1000,atk:100,def:0,res:0,aspd:100,bat:1,blockCnt:1},skill:{id:'ammo_skill',skillId:'ammo_skill',skillType:'AMMO',durationType:'TIME',duration:10,spType:'INCREASE_WITH_TIME',spCost:10,initSp:0,trigger:{rule:'DEFAULT'},bb:{}}});
  const strategyCatalog=(id,kind,params,units)=>{const source=Object.values(resonanceContent.strategies).find(s=>s.effects?.some(e=>e.kind===kind));assert.ok(source,`canonical strategy exists: ${kind}`);const operators=Object.fromEntries(units.map(u=>{const native=Object.values(resonanceContent.operators).find(o=>o.charId===u.charId);return [u.chessId,native?{...native,sourceChessId:u.chessId}:{id:u.chessId,charId:u.chessId,sourceChessId:u.chessId,name:u.chessId,cost:3,pacts:[],stars:{1:{passive:{kind:'none'}}}}];}));return {operators,pacts:{},equipment:{},strategies:{[id]:{...source,id}}};};
  const run=(strategyId,kind,params,units,targets=[],tokens={},ammoCount=1)=>makeBattle({defs:{chess:Object.fromEntries(units.map(u=>[u.chessId,op(u.chessId,u.position,u.charId)])),tokens,enemies:{dummy:enemyRec({key:'dummy',hp:1000,speed:0,def:0}),boss:enemyRec({key:'boss',hp:1000,speed:0,def:0,rank:'BOSS'})}},units,enemies:[],kits:Object.fromEntries(units.map(u=>[u.chessId,()=>({skill:{id:'ammo_skill',kind:'ammo',duration:10,ammo:ammoCount,spCost:10,initSp:0,spType:'time'}})])),content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog:strategyCatalog(strategyId,kind,params,units),state:{pieces:units.map(u=>({uid:u.uid,star:u.star??1})),strategies:[{id:strategyId,targets}],strategyState:{}}})]});
  const pair=run('pair','pair_guard',{share:20,adjacent:true,noRecursion:true},[{chessId:'a',uid:'a',row:9,col:5,position:'MELEE'},{chessId:'b',uid:'b',row:10,col:5,position:'MELEE'}],['a','b']);pair.b.start();const [a,b]=[pair.unit('a'),pair.unit('b')],foe=pair.spawn('dummy',{pos:[9,7]}),aHp=a.hp,bHp=b.hp;
  pair.b.dealDamage(foe,a,{amount:100,type:'phys',isAttack:true,canDodge:false});assert.equal(aHp-a.hp,80,'selected adjacent member takes eighty percent');assert.equal(bHp-b.hp,20,'the other selected member receives the remaining twenty percent once');
  const spaced=run('pair','pair_guard',{share:20,adjacent:true},[{chessId:'a',uid:'a',row:9,col:5,position:'MELEE'},{chessId:'b',uid:'b',row:12,col:5,position:'MELEE'}],['a','b']);spaced.b.start();const spacedA=spaced.unit('a'),spacedEnemy=spaced.spawn('dummy',{pos:[9,7]}),spacedHp=spacedA.hp;spaced.b.dealDamage(spacedEnemy,spacedA,{amount:100,type:'phys',isAttack:true,canDodge:false});assert.equal(spacedHp-spacedA.hp,100,'non-adjacent choices receive no pair reduction');
  const ammo=run('last','lastAmmo',{sp:3,damage:150},[{chessId:'gun',uid:'gun',row:9,col:5,position:'RANGED'}]);ammo.b.start();const gun=ammo.unit('gun'),victim=ammo.spawn('dummy',{pos:[9,7]});gun.skill.gainSp(10,'init');assert.equal(gun.skill.activate('test'),true);const beforeSp=gun.skill.sp,beforeHp=victim.hp;assert.equal(gun.skill.ammoLeft,1);assert.equal(ammo.b.forceAttack(gun,[victim]),true);assert.equal(gun.skill.ammoLeft,0,'actual ammo attack consumes the final shot');assert.equal(gun.skill.sp-beforeSp,3,'only final-ammo consumption refunds three SP after the ammo skill ends');assert.equal(beforeHp-victim.hp,150,'final-ammo follow-up deals exactly 150% ATK physical damage');
  const notLast=run('last','lastAmmo',{sp:3,damage:150},[{chessId:'gun',uid:'gun',row:9,col:5,position:'RANGED'}],[],{},2);notLast.b.start();const gun2=notLast.unit('gun'),target2=notLast.spawn('dummy',{pos:[9,6]});gun2.skill.gainSp(10,'init');assert.equal(gun2.skill.activate('test'),true);const plainHitHp=target2.hp,attackCount=gun2.stats.attacks;assert.equal(notLast.b.forceAttack(gun2,[target2]),true,'the ammo unit performs a genuine Battle attack');assert.equal(gun2.stats.attacks,attackCount+1);assert.equal(gun2.skill.ammoLeft,1);assert.equal(target2.hp,plainHitHp,'nonfinal ammo attacks receive no last-shot follow-up');assert.equal(gun2.skill.sp,0,'nonfinal ammo consumption does not return the last-shot SP');
  const executorOp=Object.values(resonanceContent.operators).find(o=>o.name==='圣约送葬人');const executorBattle=run('last','lastAmmo',{sp:3,damage:150},[{chessId:'executor',uid:'executor',charId:executorOp.charId,row:9,col:5,position:'RANGED',star:3}]);executorBattle.b.start();const executor=executorBattle.unit('executor'),nearest=executorBattle.spawn('dummy',{pos:[9,6]}),chosen=executorBattle.spawn('dummy',{pos:[9,7]});executor.skill.gainSp(10,'init');assert.equal(executor.skill.activate('test'),true);assert.equal(executor.skill.ammoLeft,4,'the canonical Executor star-three passive adds its real three bullets');for(let i=0;i<3;i++)executorBattle.b.forceAttack(executor,[nearest]);assert.equal(executor.skill.ammoLeft,1);const nearestBefore=nearest.hp,chosenBefore=chosen.hp;assert.equal(executorBattle.b.forceAttack(executor,[chosen]),true);assert.equal(executorBattle.b.resonanceMetrics.triggers.signature_executor_refund,1,'Executor naturally refills the depleted ammo skill at its last bullet');assert.equal(executor.skill.ammoLeft,4,'the real per-battle refund restores the four-shot clip');assert.equal(nearest.hp,nearestBefore,'the bonus follows the attack target even when a closer enemy is present');assert.equal(chosenBefore-chosen.hp,150,'the selected target receives the configured 150% physical follow-up');executor.skill.end('fixture');assert.equal(executor.skill.sp,3,'the deferred strategy SP refund is paid after the refilled skill eventually ends');
  const ice=run('freeze','firstFreezeSplash',{damage:80,adjacent:true},[{chessId:'caster',uid:'caster',row:9,col:5,position:'RANGED'}]);ice.b.start();const caster=ice.unit('caster'),center=ice.spawn('dummy',{pos:[9,8]}),near=ice.spawn('dummy',{pos:[9,9]}),far=ice.spawn('dummy',{pos:[11,10]}),nearHp=near.hp;ice.b.applyStatus(center,'freeze',{duration:2,source:caster});assert.equal(nearHp-near.hp,80,'a real first freeze splashes 80% ATK arts to adjacent enemy');ice.b.applyStatus(center,'freeze',{duration:2,source:caster,reenter:true});assert.equal(nearHp-near.hp,80,'a repeated freeze does not splash the same target twice');assert.equal(far.hp,1000,'the splash does not reach non-adjacent targets');
  const tokenDef={token_construct:{stats:{maxHp:100,atk:1,def:0,res:0,aspd:100,bat:1,blockCnt:1}}};const rebuild=run('rebuild','firstConstructRebuild',{perBattle:1,originalTile:true},[{chessId:'owner',uid:'owner',row:9,col:5,position:'MELEE'}],[],tokenDef);rebuild.b.start();const owner=rebuild.unit('owner'),construct=rebuild.b.spawnToken(owner,'token_construct',11,5,{duration:Infinity,anySource:true});assert.ok(construct);const dummy=rebuild.spawn('dummy',{pos:[9,8]});rebuild.b.dealDamage(dummy,construct,{amount:1000,type:'true',canDodge:false});rebuild.run(.1);const replacement=rebuild.b.allyUnits.find(u=>u.kind==='token'&&u.ownerUnit===owner&&u.alive&&u.deployed);assert.ok(replacement,'the first genuine construct death rebuilds at its original legal tile');assert.deepEqual([replacement.tileR,replacement.tileC],[11,5]);
  const occupied=run('rebuild','firstConstructRebuild',{perBattle:1,originalTile:true},[{chessId:'owner',uid:'owner',row:9,col:5,position:'MELEE'}],[],tokenDef);occupied.b.start();const owner2=occupied.unit('owner'),construct2=occupied.b.spawnToken(owner2,'token_construct',11,5,{duration:Infinity,anySource:true}),killer=occupied.spawn('dummy',{pos:[9,8]});occupied.b.dealDamage(killer,construct2,{amount:1000,type:'true',canDodge:false});const blocker=occupied.b.spawnToken(owner2,'token_construct',11,5,{duration:Infinity,anySource:true});assert.ok(blocker,'the fixture fills the original tile after death but before the scheduled rebuild');occupied.run(.1);assert.equal(occupied.b.allyUnits.filter(u=>u.kind==='token'&&u.ownerUnit===owner2&&u.alive&&u.deployed).length,1,'no additional construct is forced into an occupied original tile');
  const invalid=run('rebuild','firstConstructRebuild',{perBattle:1,originalTile:true},[{chessId:'owner',uid:'owner',row:9,col:5,position:'MELEE'}],[],tokenDef);invalid.b.start();const owner3=invalid.unit('owner'),construct3=invalid.b.spawnToken(owner3,'token_construct',11,5,{duration:Infinity,anySource:true}),killer3=invalid.spawn('dummy',{pos:[9,8]});invalid.b.dealDamage(killer3,construct3,{amount:1000,type:'true',canDodge:false});invalid.b.setObstacle(11,5,true);invalid.run(.1);assert.equal(invalid.b.allyUnits.filter(u=>u.kind==='token'&&u.ownerUnit===owner3&&u.alive&&u.deployed).length,0,'rebuild is skipped if the original tile becomes an illegal blocked tile before the scheduled deployment');
  const exec=run('execute','executeBonus',{hpBelow:20,regular:50,boss:15},[{chessId:'striker',uid:'striker',row:9,col:5,position:'MELEE'}]);exec.b.start();const striker=exec.unit('striker'),regular=exec.spawn('dummy',{pos:[9,7]}),leader=exec.spawn('boss',{pos:[9,8]}),above=exec.spawn('dummy',{pos:[10,8]});regular.hp=100;leader.hp=100;above.hp=200;exec.b.dealDamage(striker,regular,{amount:10,type:'true',isAttack:true,canDodge:false});exec.b.dealDamage(striker,leader,{amount:10,type:'true',isAttack:true,canDodge:false});const aboveHp=above.hp;exec.b.dealDamage(striker,above,{amount:10,type:'true',isAttack:true,canDodge:false});assert.equal(regular.hp,85,'below twenty percent, ordinary targets take fifty percent more across damage types');assert.equal(leader.hp,88.5,'below twenty percent, leaders take fifteen percent more');assert.equal(above.hp,aboveHp-10,'at the threshold and above, execute adds no damage');
});

test('star-three Vina adds true damage to native lion attacks and Ling rebuilds one native dragon after death', () => {
  const vinaDef={...unit('vina'),charId:'char_1019_siege2',resonanceStar:3,tokens:['token_10040_siege2_vlion']};
  const lingDef={...unit('ling'),charId:'char_2023_ling',resonanceStar:3,tokens:['token_10020_ling_soul3'],skill:{id:'skchr_ling_3',skillId:'skchr_ling_3',duration:25,spCost:10,initSp:10,spType:'time',summonOnCast:0,bb:{atk:.55,def:.5}}};
  const lingRecord={...lingDef,skill:{...lingDef.skill},talents:[{bb:{cnt:4}},{bb:{max_stack_cnt:5,sp:2,atk:.02}}]};
  const catalog={operators:{
    vina:{id:'vina',charId:'char_1019_siege2',sourceChessId:'vina',name:'维娜·维多利亚',cost:5,stars:{3:{passive:{kind:'star3_vina',params:{swordTrueDamage:600,maxSwords:4}}}}},
    ling:{id:'ling',charId:'char_2023_ling',sourceChessId:'ling',name:'令',cost:5,fixedSkillId:'skchr_ling_3',stars:{1:{record:lingRecord},3:{record:lingRecord,passive:{kind:'star3_ling',params:{dragonHpMultiplier:2,dragonAtkMultiplier:2,dragonRebuilds:1}}}}},
  },pacts:{},equipment:{}};
  const lingState={pieces:[{uid:'ling',star:3}]};
  const h=makeBattle({defs:{chess:{vina:vinaDef,ling:lingDef},tokens:{token_10040_siege2_vlion:{stats:{maxHp:1000,atk:100,def:0,res:0,aspd:100,bat:1,blockCnt:1}},token_10020_ling_soul3:{stats:{maxHp:3000,atk:100,def:100,res:0,aspd:100,bat:1,blockCnt:2,cost:23},rangeGrid:[[0,0],[0,1],[0,-1],[1,0],[-1,0]],skill:{bb:{'2.max_hp':1,'2.atk':.8,'2.def':.8,'2.magic_resistance':1,'2.base_attack_time':.8,'2.block_cnt':2}}}},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e7,speed:0})}},units:[
    {chessId:'vina',uid:'vina',row:9,col:5,star:3},{chessId:'ling',uid:'ling',row:10,col:5,star:3},
  ],enemies:[],kits:createResonanceKits(catalog,lingState),content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state:{pieces:[{uid:'vina',star:3},{uid:'ling',star:3}]}})]});
  h.b.start();const vina=h.unit('vina'),ling=h.unit('ling'),enemy=h.spawn('enemy_dummy',{pos:[9,8]});
  const sword=h.b.spawnToken(vina,'token_10040_siege2_vlion',11,5,{duration:Infinity,anySource:true});assert.ok(sword,'the native Vina lion exists as a real token');
  const beforeSword=enemy.hp;h.b.emit('attack',{attacker:sword,targets:[enemy],isSkill:false});
  assert.equal(beforeSword-enemy.hp,vina.s.atk*6,'a native lion attack adds the configured 600% ATK true damage');
  const dragon=h.b.spawnToken(ling,'token_10020_ling_soul3',12,5,{duration:Infinity,anySource:true}),absorbed=h.b.spawnToken(ling,'token_10020_ling_soul3',12,6,{duration:Infinity,anySource:true});assert.ok(dragon&&absorbed,'the native Ling S3 dragon exists as two real source-token instances');
  assert.equal(dragon.s.maxHp,3000,'a base-form star-three soul3 does not receive the advanced-only multiplier');
  assert.equal(ling.skill.activate('fixture',{free:true}),true);assert.equal(dragon.form,'resonance_ling_advanced');assert.equal(dragon.s.maxHp,12000,'native form2 and star-three multipliers apply only after fusion');
  const deathRow=dragon.tileR,deathCol=dragon.tileC;h.b.dealDamage(enemy,dragon,{amount:1e9,type:'true',canDodge:false});h.run(.1);
  const rebuilt=h.b.allyUnits.find(x=>x.kind==='token'&&x.ownerUnit===ling&&x.defId==='token_10020_ling_soul3'&&x.alive&&x.deployed&&x.mem.resonanceLingAdvanced);
  assert.ok(rebuilt,'the dead advanced native dragon is rebuilt once in a legal tile');assert.equal(rebuilt.tileR,deathRow,'the one-time rebuild uses the original legal summon tile');assert.equal(rebuilt.tileC,deathCol);assert.equal(rebuilt.s.maxHp,12000);assert.equal(rebuilt.profile.dmgType,'arts');
  h.b.dealDamage(enemy,rebuilt,{amount:1e9,type:'true',canDodge:false});h.run(.1);
  assert.equal(h.b.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===ling&&x.defId==='token_10020_ling_soul3'&&x.alive&&x.deployed&&x.mem.resonanceLingAdvanced).length,0,'the one-time advanced rebuild does not loop');
});

test('fixed Ling and Shu S3 kits apply their source identities and Shu returns a ground enemy to its first seed tile', () => {
  const shuDef={...unit('shu'),charId:'char_2025_shu',resonanceStar:3,position:'MELEE',skill:{id:'skchr_shu_3',skillId:'skchr_shu_3',duration:30,spCost:10,initSp:10,spType:'time',rangeGrid:[[0,0],[0,1],[0,2]],bb:{atk:.22,e_atk:.15,e_ASPD:15,heal_scale:1}}};
  const friendDef={...unit('shu_friend'),position:'MELEE'};
  const shuRecord={...shuDef,talents:[{bb:{hp_recovery_per_sec:40,damage_resistance:.05}}]};
  const lingRecord={...unit('ling'),charId:'char_2023_ling',skill:{id:'skchr_ling_3',duration:25,spCost:10,initSp:10,bb:{atk:.55,def:.5}},tokens:['token_10020_ling_soul1','token_10020_ling_soul2','token_10020_ling_soul3']};
  const catalog={operators:{
    ling:{id:'ling',charId:'char_2023_ling',sourceChessId:'ling',name:'令',cost:5,fixedSkillId:'skchr_ling_3',stars:{1:{record:lingRecord},3:{record:lingRecord,passive:{kind:'star3_ling',params:{dragonHpMultiplier:2,dragonAtkMultiplier:2,dragonRebuilds:1}}}}},
    shu:{id:'shu',charId:'char_2025_shu',sourceChessId:'shu',name:'黍',cost:5,fixedSkillId:'skchr_shu_3',stars:{1:{record:shuRecord},3:{record:shuRecord,passive:{kind:'star3_shu',params:{teleportDamage:100,leaderSlow:true,leaderSlowPercent:20,leaderSlowDuration:3,leaderSlowCooldown:3}}}}},
  },pacts:{},equipment:{}};
  const h=makeBattle({defs:{chess:{shu:shuDef,friend:friendDef},tokens:{token_10020_ling_soul1:{stats:{maxHp:1000,atk:100,def:100,res:0,aspd:100,bat:1,blockCnt:1}},token_10020_ling_soul2:{stats:{maxHp:2000,atk:200,def:200,res:0,aspd:100,bat:1,blockCnt:2}},token_10020_ling_soul3:{stats:{maxHp:5000,atk:500,def:500,res:0,aspd:100,bat:1,blockCnt:3}}},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e6,speed:0}),enemy_boss:enemyRec({key:'enemy_boss',name:'Boss',rank:'BOSS',hp:1e6,speed:0})}},units:[
    {chessId:'shu',uid:'shu',row:9,col:5,star:3},{chessId:'friend',uid:'friend',row:10,col:5},
  ],enemies:[],kits:createResonanceKits(catalog,{pieces:[{uid:'shu',star:3}] }),content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state:{pieces:[{uid:'shu',star:3}]}})]});
  h.b.start();const shu=h.unit('shu'),friend=h.unit('friend');
  assert.equal(shu.skill.id,'skchr_shu_3','the terminal fixed skill is the authored Shu S3');
  assert.equal(shu.skill.activate('fixture',{free:true}),true,`S3 activation state: alive=${shu.alive} deployed=${shu.deployed} kind=${shu.skill.kind} noSkill=${shu.skill.noSkill}`);
  friend.hp-=300;h.b.heal(shu,friend,100,{tags:['fixture']});
  const enemy=h.spawn('enemy_dummy',{pos:[9,5]});h.run(.1);
  assert.ok(shu.mem.resonanceShuEnemySource?.has(enemy.id),'the enemy records the first planted seed tile');
  enemy.x=0;enemy.y=9;h.run(.1);
  assert.equal(enemy.tileR,9,'the ground enemy is returned to the first seed row after moving beyond four tiles');
  assert.equal(enemy.tileC,5,'the ground enemy returns to the first seed column');
  assert.ok(enemy.hp<1e6,'a star-three return deals the catalogued 100% owner-ATK arts hit');
  h.run(1);
  assert.ok(friend.findBuff(`resonance:shu:seedGuard:${shu.id}:${shu.id}:10,5`),'the persistent seed grants its authored damage protection');
  const boss=h.spawn('enemy_boss',{pos:[10,5]});h.run(.1);assert.equal(boss.def.rank,'BOSS');assert.ok(shu.mem.resonanceShuEnemySource?.has(boss.id));boss.x=10;boss.y=10;h.run(.1);
  assert.equal(boss.findBuff(`resonance:shu:leaderSlow:${shu.id}`)?.mods?.moveMul,.8,'the star-three boss receives the authored 20% movement slow');
  const beforeImmune=h.b.resonanceMetrics.triggers.shuTeleport??0;
  const immovable=h.spawn('enemy_dummy',{pos:[10,5]});h.b.addBuff(immovable,{key:'fixture:noDisplace',persist:true,flags:{noDisplace:true}});h.run(.1);immovable.x=10;immovable.y=10;h.run(.1);
  assert.equal(h.b.resonanceMetrics.triggers.shuTeleport??0,beforeImmune,'an enemy with native noDisplace immunity never triggers a return');
  shu.skill.end('fixture');assert.ok(shu.mem.resonanceShuSeeds.size>0,'the planted seed field remains after S3 ends');
});

test('Ling S3 fuses adjacent source soul3 tokens in place into the canonical advanced form', () => {
  const lingDef={...unit('ling'),charId:'char_2023_ling',resonanceStar:3,skill:{id:'skchr_ling_3',skillId:'skchr_ling_3',duration:25,spCost:40,initSp:12,spType:'time',summonOnCast:0,bb:{atk:.55,def:.5,atk_scale:.2,interval:.5}}};
  const record={...lingDef,talents:[{bb:{cnt:4}},{bb:{max_stack_cnt:5,sp:2,atk:.02}}],tokens:['token_10020_ling_soul3']};
  const catalog={operators:{ling:{id:'ling',charId:'char_2023_ling',sourceChessId:'ling',name:'令',cost:5,fixedSkillId:'skchr_ling_3',stars:{1:{record}}}},pacts:{},equipment:{}};
  const defs={chess:{ling:lingDef},tokens:{token_10020_ling_soul3:{stats:{maxHp:5000,atk:500,def:500,res:10,aspd:100,bat:1.5,blockCnt:2},rangeGrid:[[0,0],[0,1],[0,-1],[1,0],[-1,0]],skill:{bb:{'2.max_hp':1,'2.atk':.8,'2.def':.8,'2.magic_resistance':1,'2.base_attack_time':.8,'2.block_cnt':2}}}},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:50000,def:0,speed:0})}};
  const catalogLing={...catalog.operators.ling,stars:{...catalog.operators.ling.stars,3:{record,passive:{kind:'star3_ling',params:{dragonHpMultiplier:2,dragonAtkMultiplier:2,dragonRebuilds:1}}}}};catalog.operators.ling=catalogLing;
  const state={pieces:[{uid:'ling',star:3}]};
  const h=makeBattle({defs,units:[{chessId:'ling',uid:'ling',row:9,col:5}],enemies:[],kits:createResonanceKits(catalog,state),content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state})]});
  h.b.start();const ling=h.unit('ling');
  const first=h.b.spawnToken(ling,'token_10020_ling_soul3',11,5,{anySource:true});
  const second=h.b.spawnToken(ling,'token_10020_ling_soul3',11,6,{anySource:true});
  assert.ok(first&&second,'the inventory can deploy two instances of the one native S3 token');
  const before=ling.s.atk,base={maxHp:first.base.maxHp,atk:first.base.atk,def:first.base.def,bat:first.base.bat};
  assert.equal(ling.skill.activate('fixture',{free:true}),true);
  assert.equal(first.defId,'token_10020_ling_soul3','fusion retains the canonical token identity');
  assert.equal(first.form,'resonance_ling_advanced');
  assert.ok(first.mem.resonanceLingAdvanced);
  assert.equal(first.base.maxHp,base.maxHp*4,'canonical form2 and star-three advanced-only max-HP multipliers are applied');
  assert.equal(first.base.atk,base.atk*3.6,'canonical form2 and star-three advanced-only ATK multipliers are applied');
  assert.equal(first.base.def,base.def*1.8,'canonical form2 DEF coefficient is applied');
  assert.equal(first.base.res,20,'canonical form2 resistance multiplier is applied');
  assert.equal(first.base.bat,base.bat+.8,'canonical form2 attack-time increase is applied');
  assert.equal(first.base.blockCnt,4,'canonical form2 block increase is applied');
  assert.equal(first.profile.dmgType,'arts','advanced dragon changes from physical to arts damage');
  assert.ok(!second.alive||!second.deployed,'exactly the absorbed instance leaves the board');
  assert.ok(ling.s.atk>before,'one absorbed summon grants one authored permanent ATK growth stack');
  assert.equal(second.base.maxHp,5000,'the absorbed base-form token never receives the star-three advanced-form multiplier');
  assert.equal(first.mem.resonanceLingDragon,true,'only the advanced form carries the star-three signature marker');
  assert.ok(first.findBuff(`resonance:ling:skill:${ling.id}`),'the fused summon receives the active S3 buff');
  assert.equal(ling.mem.resonanceLingStock,2,'fusion consumes the two already deployed summons without refunding stock');
  assert.equal(h.b.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===ling&&x.alive&&x.deployed).reduce((n,x)=>n+(x.mem.resonanceLingAdvanced?2:1),0),2,'the advanced form occupies two of the three summon slots');
  const orthogonal=h.spawn('enemy_dummy',{pos:[11,6]}),diagonal=h.spawn('enemy_dummy',{pos:[13,5]});const diagonalHp=diagonal.hp;h.run(.51);
  assert.ok(orthogonal.hp<50000,'the advanced dragon pulse damages an enemy on an orthogonal adjacent tile');
  assert.equal(diagonal.hp,diagonalHp,'the four-tile pulse excludes nearby tiles outside the native orthogonal range');
  const killedStats={maxHp:first.base.maxHp,atk:first.base.atk,def:first.base.def,res:first.base.res,bat:first.base.bat,blockCnt:first.base.blockCnt},returnTile=[first.tileR,first.tileC],stockBeforeDeath=ling.mem.resonanceLingStock,foe=h.spawn('enemy_dummy',{pos:[10,8]});
  h.b.dealDamage(foe,first,{amount:1e9,type:'true',canDodge:false});h.run(.1);
  const rebuilt=h.b.allyUnits.find(x=>x.kind==='token'&&x.ownerUnit===ling&&x.defId==='token_10020_ling_soul3'&&x.alive&&x.deployed&&x.mem.resonanceLingAdvanced);
  assert.ok(rebuilt,'star three rebuilds the advanced dragon once after a real lethal damage event');
  assert.deepEqual([rebuilt.tileR,rebuilt.tileC],returnTile,'the advanced dragon returns only to its original legal tile');
  for(const [key,value] of Object.entries(killedStats))assert.equal(rebuilt.base[key],value,`the rebuild preserves advanced ${key}`);
  assert.equal(rebuilt.profile.dmgType,'arts');assert.equal(ling.mem.resonanceLingStock,stockBeforeDeath,'death and free star-three rebuild do not refund or spend summon inventory');
  h.b.dealDamage(foe,rebuilt,{amount:1e9,type:'true',canDodge:false});h.run(.1);
  assert.equal(h.b.allyUnits.filter(x=>x.kind==='token'&&x.ownerUnit===ling&&x.alive&&x.deployed&&x.mem.resonanceLingAdvanced).length,0,'the advanced-form rebuild is limited to one per battle');
  assert.equal(ling.skill.active,true,'the custom S3 remains active before the explicit end');
  ling.skill.end('fixture');
  assert.equal(ling.mem.resonanceLingStock,3,'ending S3 restores exactly one summon stock');
});

test('remaining cost-five star-three signatures execute their real Battle hooks and respect trigger boundaries', () => {
  const activate=x=>assert.equal(x.owner.skill.activate('fixture',{free:true}),true);
  const attack=(x,target,targets=[target])=>x.h.b.emit('attack',{attacker:x.owner,targets,isSkill:false});
  {
    const x=signatureFixture('凛御银灰',{tokens:['hawk1','hawk2','hawk3']});
    const enemy=x.h.spawn('enemy_dummy',{pos:[9,7]});x.h.run(2.1);
    assert.ok(x.h.b.allyUnits.some(u=>u.kind==='token'&&u.ownerUnit===x.owner&&u.defId==='hawk3'),'SilverAsh deploys the source star-three eagle');
    assert.ok(enemy.hp<1e6,'SilverAsh deals his configured interval damage on the real battle timer');
  }
  {
    const x=signatureFixture('蕾缪安');const first=x.h.spawn('enemy_dummy',{pos:[9,6]}),extra=x.h.spawn('enemy_dummy',{pos:[9,7]});
    activate(x);attack(x,first);assert.ok(extra.hp<1e6,'Lemuen splashes one nearby enemy while her skill is active');
    x.owner.skill.end('fixture');const next=x.h.spawn('enemy_dummy',{pos:[9,8]}),before=next.hp;attack(x,first,[first,next]);assert.equal(next.hp,before,'Lemuen adds no charged splash after the skill ends');
  }
  {
    const x=signatureFixture('余');const main=x.h.spawn('enemy_dummy',{pos:[9,6]}),line=x.h.spawn('enemy_dummy',{pos:[9,7]});x.owner.hp-=300;
    attack(x,main);attack(x,main);assert.equal(line.hp,1e6,'Yu does not release her line attack before the third hit');attack(x,main);
    assert.ok(line.hp<1e6,'Yu hits the third-attack line');assert.ok(x.owner.hp>1700,'Yu restores the configured share of her max HP on the third hit');
  }
  {
    const x=signatureFixture('缪尔赛思',{tokens:['fluid']});const clone=x.h.b.spawnToken(x.owner,'fluid',11,5,{anySource:true}),enemy=x.h.spawn('enemy_dummy',{pos:[11,6]});
    const before=enemy.hp;attack(x,enemy);assert.equal(enemy.hp,before,'Muel does not echo attacks from clones outside her active skill');
    activate(x);attack(x,enemy);assert.ok(enemy.hp<before,'Muel clones attack a nearby target while S3 is active');
  }
  {
    const x=signatureFixture('耀骑士临光'),enemy=x.h.spawn('enemy_dummy',{pos:[9,7]});activate(x);const before=enemy.hp;x.h.run(1.1);
    assert.ok(enemy.hp<before,'Nearl creates the configured damaging sun area after skill start');
  }
  {
    const x=signatureFixture('重岳');const main=x.h.spawn('enemy_dummy',{pos:[9,6]}),splash=x.h.spawn('enemy_dummy',{pos:[9,7]});
    for(let n=0;n<4;n++)attack(x,main);assert.equal(splash.hp,1e6,'Chongyue waits for the fifth attack');attack(x,main);
    assert.ok(splash.hp<1e6,'Chongyue applies his fifth-hit splash to the neighboring target');
  }
  {
    const x=signatureFixture('圣约送葬人',{skillKind:'ammo'});activate(x);x.owner.skill.ammoLeft=0;x.h.b.emit('ammoUsed',{unit:x.owner});
    assert.equal(x.owner.skill.ammoLeft,x.owner.skill.ammoMax,'Executor restores the whole exhausted ammo skill once');
  }
  {
    const x=signatureFixture('烛煌');x.owner.dir='RIGHT';activate(x);const enemy=x.h.spawn('enemy_dummy',{pos:[9,6]});const before=enemy.hp;x.h.run(1.1);
    assert.ok(enemy.hp<before,'Zhuhuang damages enemies standing on the real forward firewall tile');
  }
  {
    const x=signatureFixture('塑心');const first=x.h.spawn('enemy_dummy',{pos:[9,6]}),neighbor=x.h.spawn('enemy_dummy',{pos:[9,7]});x.h.b.emit('elementBurst',{source:x.owner,target:first,element:'apoptosis'});
    assert.equal(x.owner.mem.star3NecrosisUsed,true,`Lingering observes an apoptosis burst (cost=${x.catalogOp.cost},passive=${JSON.stringify(x.owner.mem.resonancePassives)})`);assert.ok(neighbor.elem.apoptosis>0,'Lingering spreads 200% ATK apoptosis gauge to a configured nearby target');
  }
  {
    const friend=chessRec({id:'crown_friend',charId:'crown_friend',profession:'MEDIC',position:'RANGED',skill:{skillId:'crown_friend_skill',skillType:'MANUAL',durationType:'TIME',duration:30,spType:'INCREASE_WITH_TIME',spCost:20,initSp:0,bb:{}}});
    const x=signatureFixture('魔王',{allies:{crown_friend:friend}});const enemy=x.h.spawn('enemy_dummy',{pos:[9,7]});activate(x);const before=enemy.hp;x.h.run(3.1);
    assert.ok(x.h.unit('crown_friend').skill.sp>=5,'Crown grants her configured team SP while the signature skill is active');assert.ok(enemy.hp<before,'Crown releases the timed team combo damage');
  }
  {
    const x=signatureFixture('迷迭香');const main=x.h.spawn('enemy_dummy',{pos:[9,6]}),aftershock=x.h.spawn('enemy_dummy',{pos:[9,7]});attack(x,main);
    assert.ok(aftershock.hp<1e6,'Rosmontis applies aftershock damage around the attacked target');
  }
});

test('Ursus environment growth requires two authored frontline roles at battle start and persists after a loss', () => {
  const mk=(eligible)=>{
    const operators={},chess={},units=[];
    for(let i=0;i<3;i++){
      const id=`u${i}`,charId=`char_${id}`,role=i<2&&eligible?'frontline':'damage';
      operators[id]={id,charId,sourceChessId:id,name:id,cost:3,role,pacts:[],stars:{1:{passive:{kind:'none'}}}};
      chess[id]={...unit(id),charId,resonanceStar:1};units.push({chessId:id,uid:id,row:9+i,col:5});
    }
    const catalog={operators,pacts:{},equipment:{},environments:{origin_ursus:{rule:{kind:'environment_frontline_reward',params:{minFront:2,hp:5}}}}};
    const state={environmentId:'origin_ursus',pieces:units.map(x=>({uid:x.uid,growth:{}}))};
    return {h:makeBattle({defs:{chess,enemies:{}},units,enemies:[],content:'none',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state})]}),state};
  };
  const eligible=mk(true);eligible.h.b.start();
  eligible.h.b.emit('battleEnd',{result:{reason:'failed'}});
  assert.equal(eligible.h.b.resonanceResults.growth.length,2,'a loss still grants growth to both eligible frontlines that survived');
  const noFront=mk(false);noFront.h.b.start();noFront.h.b.emit('battleEnd',{result:{reason:'cleared'}});
  assert.equal(noFront.h.b.resonanceResults.growth.length,0,'ranged/damage roles cannot qualify by standing on a melee tile');
});

test('star-three Lappland replaces freeze with one-second silence and repeats one native skill only once', () => {
  const lapDef={...unit('lap'),charId:'char_1038_whitw2',resonanceStar:3,skill:{id:'skchr_whitw2_2',skillId:'skchr_whitw2_2',skillType:'AUTO',durationType:'TIME',duration:.5,spType:'INCREASE_WITH_TIME',spCost:1,initSp:0,trigger:{rule:'DEFAULT'},bb:{}}};
  const catalog={operators:{lap:{id:'lap',charId:'char_1038_whitw2',sourceChessId:'lap',name:'荒芜拉普兰德',cost:5,fixedSkillId:'skchr_whitw2_2',stars:{3:{record:lapDef,passive:{kind:'star3_lappland',params:{repeatSkillOnce:true,freezeReplacement:'silence',silenceDuration:1}}}}}},pacts:{},equipment:{}};
  const h=makeBattle({defs:{chess:{lap:lapDef},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e6,speed:0})}},units:[{chessId:'lap',uid:'lap',row:9,col:5,star:3}],enemies:[],kits:{lap:()=>({skill:{id:'skchr_whitw2_2',kind:'duration',duration:.5,spCost:1,initSp:0,spType:'time'}})},content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state:{pieces:[{uid:'lap',star:3}]}})]});
  h.b.start();const lap=h.unit('lap'),enemy=h.spawn('enemy_dummy',{pos:[9,8]});
  h.b.applyStatus(enemy,'freeze',{duration:4,source:lap});
  assert.equal(enemy.findBuff('freeze'),null,'the signature removes the incoming freeze status');
  assert.ok(enemy.findBuff('silence'),'the same control action applies the authored one-second silence');
  assert.ok(lap.skill.activate('test',{free:true}));h.run(.7);
  assert.equal(lap.skill.activations,2,'the first native skill end immediately starts one free repeat');
  h.run(.7);
  assert.equal(lap.skill.activations,2,'the repeat is limited to one additional activation per battle');
});

test('star-three Ulpian growth doubles per hit, caps each battle at twenty hits, and queues uncapped permanent growth', () => {
  const ulp={...unit('ulp'),charId:'char_4145_ulpia',resonanceStar:3};
  const catalog={operators:{ulp:{id:'ulp',charId:'char_4145_ulpia',sourceChessId:'ulp',name:'乌尔比安',cost:5,role:'frontline',stars:{3:{passive:{kind:'star3_ulpius',params:{hitGrowthHp:50,hitGrowthAtk:5,starThreeMultiplier:2,battleGrowthCap:20}}}}}},pacts:{},equipment:{}};
  const state={pieces:[{uid:'ulp',growth:{}}]};const h=makeBattle({defs:{chess:{ulp},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e6,speed:0,atk:10})}},units:[{chessId:'ulp',uid:'ulp',row:9,col:5,star:3}],enemies:[],content:'none',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state})]});
  h.b.start();const op=h.unit('ulp'),enemy=h.spawn('enemy_dummy',{pos:[9,7]});
  for(let i=0;i<21;i++)h.b.emit('damaged',{source:enemy,target:op,amount:1,dmg:{isAttack:true}});
  assert.equal(op.mem.star3UlpiusGrowth,20,'the signature stops after twenty enemy attack events, not forty');
  assert.equal(op.s.maxHp,op.base.maxHp+2000,'each of the twenty star-three hits adds 100 HP in battle');
  assert.equal(h.b.resonanceResults.growth.filter(x=>x.key==='ulpius:hp').reduce((sum,x)=>sum+x.amount,0),2000,'persistent growth matches the battle cap without over-queueing');
  assert.equal(h.b.resonanceResults.growth.filter(x=>x.key==='ulpius:atk').reduce((sum,x)=>sum+x.amount,0),200,'persistent attack growth matches twenty doubled five-ATK hits');
});

test('star-three Ines gets one lethal refusal with global armor reduction; Surtr keeps her ember until retreat', () => {
  const ines={...unit('ines'),charId:'char_4010_etlchi',resonanceStar:3},surtr={...unit('surtr'),charId:'char_350_surtr',resonanceStar:3};
  const catalog={operators:{
    ines:{id:'ines',charId:'char_4010_etlchi',sourceChessId:'ines',name:'隐德来希',cost:5,stars:{3:{passive:{kind:'star3_ines',params:{firstLethalRefusalSeconds:8,globalEnemyDefReduction:40}}}}},
    surtr:{id:'surtr',charId:'char_350_surtr',sourceChessId:'surtr',name:'史尔特尔',cost:5,stars:{3:{passive:{kind:'star3_surtur',params:{selfDamagePerSecondMaxHp:10,bonusTrueDamagePerHit:100}}}}},
  },pacts:{},equipment:{}};
  const h=makeBattle({defs:{chess:{ines,surtr},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e6,def:100,speed:0})}},units:[{chessId:'ines',uid:'ines',row:9,col:5,star:3},{chessId:'surtr',uid:'surtr',row:10,col:5,star:3}],enemies:[],content:'none',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog,state:{pieces:[{uid:'ines',star:3},{uid:'surtr',star:3}]}})]});
  h.b.start();const inesOp=h.unit('ines'),surtrOp=h.unit('surtr'),enemy=h.spawn('enemy_dummy',{pos:[9,7]});
  h.b.emit('skillStart',{unit:inesOp});h.b.emit('skillStart',{unit:surtrOp});
  const lethal={unit:inesOp,prevented:false};h.b.emit('fatal',lethal);assert.equal(lethal.prevented,true,'Ines prevents the first lethal event');
  const second={unit:inesOp,prevented:false};h.b.emit('fatal',second);assert.equal(second.prevented,false,'Ines cannot reuse the same refusal');
  h.run(.3);assert.equal(enemy.findBuff(`resonance:inesArmor:${inesOp.id}`)?.mods.defPct,-.4,'the refusal weakens enemy armor globally during its eight seconds');
  const before=enemy.hp;h.b.emit('attack',{attacker:surtrOp,targets:[enemy],isSkill:false});assert.equal(before-enemy.hp,surtrOp.s.atk,'Surtr adds one hundred percent ATK true damage per attack');
  const fatalSurtr={unit:surtrOp,prevented:false};h.b.emit('fatal',fatalSurtr);assert.equal(fatalSurtr.prevented,true,'Surtr refuses fatal damage while her ember is active');
  h.b.retreat(surtrOp,{reason:'retreat'});assert.equal(surtrOp.mem.resonanceSurtr,false,'retreat ends Surtr’s permanent ember');
});

test('post-healed and damaged.dealt report actual resolved amounts without changing legacy heal modifiers', () => {
  const h=makeBattle({defs:{chess:{ally:unit('ally')},enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:10,def:0,speed:0})}},units:[{chessId:'ally',uid:'ally',row:9,col:5}],enemies:[],content:'none',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog:{operators:{},pacts:{},equipment:{}},state:{}})]});
  h.b.start();const ally=h.unit('ally'),enemy=h.spawn('enemy_dummy',{pos:[9,8]});let legacyHealAmount=0,actualHeal=null,damageInfo=null;
  h.b.on('heal',event=>{legacyHealAmount=event.amount;event.amount*=2;});
  h.b.on('healed',event=>{actualHeal=event.amount;});
  h.b.on('damaged',event=>{if(event.target===enemy)damageInfo={amount:event.amount,dealt:event.dealt};});
  enemy.hp=1;const dealt=h.b.dealDamage(ally,enemy,{amount:100,type:'true',canDodge:false});
  assert.equal(dealt,1);assert.equal(damageInfo.dealt,1);assert.equal(damageInfo.amount,100,'legacy damaged amount stays the post-mitigation pre-HP-cap value');
  ally.hp=ally.s.maxHp-100;h.b.heal(ally,ally,200);
  assert.equal(legacyHealAmount,200,'legacy heal hooks still see the mutable pre-clamp amount');
  assert.equal(actualHeal,100,'post-healed reports the actual restored HP after modifiers and clamping');
  assert.equal(h.b.resonanceMetrics.healing,100,'aggregate healing uses actual HP restored rather than over-heal');
});

test('combat environment dispatch applies authored positive and negative cases through real Battle hooks', () => {
  const envCatalog=(id,spec={})=>{const {kind,operatorPosition,...overrides}=spec;const operator=(key,charId)=>({id:key,charId,sourceChessId:key,name:'Operator',cost:3,role:'frontline',pacts:[],stars:{1:{passive:{kind:'none'}}}});const source=resonanceContent.environments[id];assert.ok(source,`canonical environment exists: ${id}`);return {operators:{op:operator('op','char_op'),peer:operator('peer','char_peer')},pacts:{},equipment:{},environments:{[id]:{...source,rule:{...source.rule,kind:kind??source.rule.kind,params:{...source.rule.params,...overrides}}}}};};
  const mk=(id,params={},withPeer=false)=>{
    const raw={...unit('op'),charId:'char_op',position:params.operatorPosition??'MELEE',skill:{id:'test_skill',skillId:'test_skill',skillType:'AUTO',durationType:'TIME',duration:10,spType:'INCREASE_WITH_TIME',spCost:10,initSp:0,trigger:{rule:'DEFAULT'},bb:{}}};
    const peer={...raw,id:'peer',baseId:'peer',charId:'char_peer'};
    const defs={op:raw,...(withPeer?{peer}:{})},units=[{chessId:'op',uid:'op',row:9,col:5},...(withPeer?[{chessId:'peer',uid:'peer',row:10,col:5}]:[])],kits={op:()=>({skill:{id:'test_skill',kind:'duration',duration:10,spCost:10,initSp:0,spType:'time'}}),...(withPeer?{peer:()=>({skill:{id:'test_skill',kind:'duration',duration:10,spCost:10,initSp:0,spType:'time'}})}:{})};
    return makeBattle({defs:{chess:defs,enemies:{enemy_dummy:enemyRec({key:'enemy_dummy',hp:1e6,speed:0,rank:'ELITE'})}},units,enemies:[],kits,content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog:envCatalog(id,params),state:{environmentId:id,pieces:units.map(x=>({uid:x.uid,star:1}))}})]});
  };
  const aegir=mk('origin_aegir');aegir.b.start();const aegirOp=aegir.unit('op'),enemy=aegir.spawn('enemy_dummy',{pos:[9,7]});
  aegir.b.dealDamage(enemy,aegirOp,{amount:1,type:'true',isAttack:true,canDodge:false});
  assert.equal(aegirOp.mem.environmentAegirStacks,1,'the first real incoming attack grants the authored HP stack');
  assert.equal(aegirOp.s.maxHp,2100,'environment HP stacks feed through normal stat recalculation');
  for(let i=0;i<4;i++)aegir.b.dealDamage(enemy,aegirOp,{amount:1,type:'true',isAttack:true,canDodge:false});assert.equal(aegirOp.mem.environmentAegirStacks,5,'the canonical five-stack cap prevents further growth');
  const yan=mk('origin_yan',{kind:'environment_skill_refund',firstCasts:2,sp:1},true);yan.b.start();const yanOp=yan.unit('op'),yanPeer=yan.unit('peer'),beforeYan=yanPeer.skill.sp;
  assert.equal(yanOp.skill.activate('environment',{free:true}),true);yanOp.skill.end('environment');
  assert.equal(yanOp.skill.activate('environment',{free:true}),true);yanOp.skill.end('environment');
  assert.equal(yanOp.skill.activate('environment',{free:true}),true);yanOp.skill.end('environment');
  assert.equal(yanPeer.skill.sp-beforeYan,2,'only the first two casts return one team SP each to other active skills');
  const leitha=mk('origin_leithania',{kind:'environment_opening_sp',duration:10,perSecond:.3});leitha.b.start();
  assert.equal(leitha.unit('op').findBuff('resonance:environment:openingSp')?.mods.spRecoveryFlat,.3,'Leithania adds its opening SP recovery');
  leitha.run(10.2);assert.equal(leitha.unit('op').findBuff('resonance:environment:openingSp'),null,'Leithania recovery expires at its configured duration');
  const lungmen=mk('origin_lungmen',{kind:'environment_leak_reduction',firstLeak:50});lungmen.b.start();const firstLeak=lungmen.spawn('enemy_dummy',{pos:[9,5]}),secondLeak=lungmen.spawn('enemy_dummy',{pos:[10,5]});firstLeak.lpr=4;secondLeak.lpr=4;lungmen.b.leak(firstLeak);lungmen.b.leak(secondLeak);
  assert.equal(firstLeak.lpr,2,'Lungmen halves only the first real leak loss');assert.equal(secondLeak.lpr,4,'subsequent real leaks retain their full loss');
  const iberia=mk('origin_iberia',{kind:'environment_front_barrier',hp:15});iberia.b.start();
  assert.equal(iberia.unit('op').findBuff('resonance:environment:frontBarrier')?.shield,300,'Iberia shields the front line at battle start');
  const iberiaBack=mk('origin_iberia',{kind:'environment_front_barrier',hp:15,operatorPosition:'RANGED'});iberiaBack.b.start();assert.equal(iberiaBack.unit('op').findBuff('resonance:environment:frontBarrier'),null,'Iberia does not shield a ranged operator');
  const bolivar=mk('origin_bolivar',{kind:'environment_slow_armor',defReduction:10});bolivar.b.start();const bolivarEnemy=bolivar.spawn('enemy_dummy',{pos:[9,7]}),bolivarClear=bolivar.spawn('enemy_dummy',{pos:[10,7]});bolivar.b.applyStatus(bolivarEnemy,'cold',{duration:2,source:bolivar.unit('op')});
  assert.equal(bolivarEnemy.findBuff('resonance:environment:slowArmor')?.mods.defPct,-.1,'Bolivar weakens only the controlled target');
  assert.equal(bolivarClear.findBuff('resonance:environment:slowArmor'),null,'Bolivar does not weaken an uncontrolled enemy');
  const babel=mk('origin_babel',{kind:'environment_first_death_sp',sp:2},true);babel.b.start();const babelOp=babel.unit('op'),babelPeer=babel.unit('peer'),beforeBabel=babelPeer.skill.sp,babelEnemy=babel.spawn('enemy_dummy',{pos:[9,7]});
  babel.b.dealDamage(babelEnemy,babelOp,{amount:1e9,type:'true',canDodge:false});assert.equal(babel.b.redeploy(babelOp,{free:true}),true);
  babel.b.dealDamage(babelEnemy,babelOp,{amount:1e9,type:'true',canDodge:false});
  assert.equal(babelPeer.skill.sp-beforeBabel,2,'the first ally death grants SP once per battle to surviving allies');
  const siracusa=mk('origin_siracusa',{kind:'environment_first_harvest',sp:5});siracusa.b.start();const siraOp=siracusa.unit('op'),siraEnemy=siracusa.spawn('enemy_dummy',{pos:[9,7]}),siraEnemy2=siracusa.spawn('enemy_dummy',{pos:[9,8]}),beforeSira=siraOp.skill.sp;
  siracusa.b.dealDamage(siraOp,siraEnemy,{amount:1e9,type:'true',canDodge:false});siracusa.b.dealDamage(siraOp,siraEnemy2,{amount:1e9,type:'true',canDodge:false});
  assert.equal(siraOp.skill.sp-beforeSira,5,'the first harvest restores the configured SP only once');
  const bounty=mk('origin_kazimierz',{kind:'environment_elite_bounty',firstKillGold:2});bounty.b.start();const bountyOp=bounty.unit('op'),boss=bounty.spawn('enemy_dummy',{pos:[9,7]}),boss2=bounty.spawn('enemy_dummy',{pos:[9,8]});
  bounty.b.dealDamage(bountyOp,boss,{amount:1e9,type:'true',canDodge:false});bounty.b.dealDamage(bountyOp,boss2,{amount:1e9,type:'true',canDodge:false});
  assert.deepEqual(bounty.b.resonanceResults.coins,[{amount:2,reason:'environment_elite_bounty'}],'Kazimierz bounty is awarded once on an elite kill');
  const rhodes=mk('origin_rhodes',{kind:'environment_lowest_heal',heal:25});rhodes.b.start();const rhodesOp=rhodes.unit('op');rhodesOp.hp=rhodesOp.s.maxHp/2;const rhodesHp=rhodesOp.hp;
  rhodes.b.dealDamage(rhodes.spawn('enemy_dummy',{pos:[9,7]}),rhodesOp,{amount:1,type:'true',isAttack:true,canDodge:false});
  assert.equal(rhodesOp.hp-rhodesHp,rhodesOp.s.maxHp*.25-1,'Rhodes heals the lowest-HP ally once on its first received attack after taking the real hit');
  const rhodesAfter=rhodesOp.hp;rhodes.b.dealDamage(rhodes.spawn('enemy_dummy',{pos:[10,7]}),rhodesOp,{amount:1,type:'true',isAttack:true,canDodge:false});assert.equal(rhodesOp.hp,rhodesAfter-1,'Rhodes does not repeat its one-time first-hit heal');
  const higashi=mk('origin_higashi',{kind:'environment_deploy_stealth',seconds:2},true);higashi.b.start();const higashiOp=higashi.unit('op'),higashiPeer=higashi.unit('peer');
  assert.notEqual(!!higashiOp.findBuff('stealth'),!!higashiPeer.findBuff('stealth'),'Higashi grants stealth to exactly one first deployed operator');
  const victoria=mk('origin_victoria',{kind:'environment_elite_hit',every:3,damage:50});victoria.b.start();const victorOp=victoria.unit('op'),elite=victoria.spawn('enemy_dummy',{pos:[9,7]});
  for(let i=0;i<2;i++)assert.equal(victoria.b.forceAttack(victorOp,[elite]),true,'real Battle attacks drive the elite-hit counter');assert.equal(elite.s.maxHp-elite.hp,victorOp.s.atk*2,'no retaliation fires before the third elite hit');assert.equal(victoria.b.forceAttack(victorOp,[elite]),true);
  assert.equal(elite.s.maxHp-elite.hp,victorOp.s.atk*3+victorOp.s.atk*.5,'three real attacks plus the every-third-hit retaliation are resolved');
  const tokenDefs={chess:{op:{...unit('op'),charId:'char_op'}},tokens:{token_test:{name:'Test Construct',stats:{maxHp:1000,atk:50,def:0,res:0,aspd:100,bat:1,blockCnt:1}}},enemies:{}};
  const columbia=makeBattle({defs:tokenDefs,units:[{chessId:'op',uid:'op',row:9,col:5}],enemies:[],content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog:envCatalog('origin_columbia',{kind:'environment_construct_shield',hp:20}),state:{environmentId:'origin_columbia'}})]});
  columbia.b.start();const construct=columbia.b.spawnToken(columbia.unit('op'),'token_test',11,5,{anySource:true});
  assert.equal(construct.findBuff('resonance:environment:constructShield')?.shield,200,'Columbia shields a real native-shaped construct on deploy');
  assert.equal(columbia.unit('op').findBuff('resonance:environment:constructShield'),null,'Columbia does not shield the operator instead of a construct');
  const snow=mk('origin_kjerag',{kind:'environment_snow',tileCooldown:4,coldDuration:1});snow.b.start();const snowEnemy=snow.spawn('enemy_dummy',{pos:[9,7]});snow.run(.3);
  assert.ok(snowEnemy.findBuff('cold'),'Kjerag snow applies its independent ground-tile cold effect');
  const snowLater=snow.spawn('enemy_dummy',{pos:[9,7]});snow.run(.3);assert.equal(snowLater.findBuff('cold'),null,'the tile cooldown prevents another chill before four seconds');
  const sami=mk('origin_sami',{kind:'environment_random_cold',everySeconds:20,duration:1});sami.b.start();const rect=sami.b.rect;let firstTile=null;
  for(let r=rect.r0;r<=rect.r1&&!firstTile;r++)for(let c=rect.c0;c<=rect.c1;c++)if(sami.b.grid.walkable(r,c)){firstTile=[r,c];break;}
  assert.ok(firstTile);const samiEnemy=sami.spawn('enemy_dummy',{pos:firstTile});sami.b.rng=()=>0;sami.run(19.5);
  assert.equal(samiEnemy.findBuff('cold'),null,'Sami does not chill before its 20-second interval');sami.run(.8);
  assert.ok(samiEnemy.findBuff('cold'),'Sami selects a seeded battlefield tile and chills its occupant');
  const ursus=mk('origin_ursus',{kind:'environment_frontline_reward',minFront:2,hp:5},true);ursus.b.start();ursus.b.resonanceResults.growth.length=0;ursus.b.forceEnd();
  assert.equal(ursus.b.resonanceResults.growth.length,2,'Ursus grants permanent HP growth to both surviving deployed frontline instances on any result');
  const ammoRaw={...unit('ammo'),charId:'char_op',skill:{id:'ammo_skill',skillId:'ammo_skill',skillType:'AMMO',durationType:'TIME',duration:10,spType:'INCREASE_WITH_TIME',spCost:1,initSp:0,trigger:{rule:'DEFAULT'},bb:{}}};
  const ammo=makeBattle({defs:{chess:{ammo:ammoRaw},enemies:{}},units:[{chessId:'ammo',uid:'ammo',row:9,col:5}],enemies:[],kits:{ammo:()=>({skill:{id:'ammo_skill',kind:'ammo',duration:10,ammo:4,spCost:1,initSp:0,spType:'time'}})},content:'generic',autoFinish:false,recordEvents:false,extraContent:[b=>installResonanceBattle(b,{catalog:envCatalog('origin_laterano',{kind:'environment_ammo',firstSkillAmmo:2}),state:{environmentId:'origin_laterano'}})]});
  ammo.b.start();const ammoOp=ammo.unit('ammo');assert.ok(ammoOp.skill.activate('test',{free:true}));
  assert.equal(ammoOp.skill.ammoLeft,6,'Laterano environment adds two shots to the first actual ammo skill');
  ammoOp.skill.end('fixture');assert.ok(ammoOp.skill.activate('test',{free:true}));assert.equal(ammoOp.skill.ammoLeft,4,'Laterano does not grant the one-time opening ammunition twice');
});
