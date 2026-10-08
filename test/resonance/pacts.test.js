import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SP_DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';

const [{ getData }, { getResonanceCatalog }, { Battle }, { installResonancePacts }, { installResonanceEquipment }, { createResonanceKits }, { installResonanceBattle }] = await Promise.all([
  import('../../server/data.js'),
  import('../../server/modes/resonance/catalog.js'),
  import('../../server/sim/Battle.js'),
  import('../../server/sim/content/resonance/pacts.js'),
  import('../../server/sim/content/resonance/equipment.js'),
  import('../../server/sim/content/resonance/kits.js'),
  import('../../server/sim/content/resonance/battle.js'),
]);
const { enemyRec, flatStage } = await import('../helpers/battleHarness.js');
const { performAttack } = await import('../../server/sim/ai.js');

const data=getData();
const catalog=getResonanceCatalog(data,{environmentId:'origin_laterano',seed:912});
const ordinaryIds=['laterano','kjerag','yan','victoria','columbia','kazimierz','siracusa','rhodes','lungmen','sargon','leithania','iberia','higashi','ursus','bolivar','rim','babel','sami','ammo','combo','control','creation','symbiosis','logistics','redeploy','flight','arts','breaker','burn','necrosis','sui','crown'];

function makeBattle(loadouts,{content=catalog,seed=912,state={pieces:[]},skillKind='instant'}={}){
  const player={playerId:'resonance',units:loadouts.map((row,index)=>({uid:`piece-${index+1}`,chessId:row.operator.id,skillIndex:row.operator.fixedSkillIndex??0,moduleId:'none',row:9,col:2+index,dir:'RIGHT',star:row.star??1,items:row.items??[],extraPacts:row.extraPacts??[]}))};
  const kits=Object.fromEntries(loadouts.map(({operator})=>[operator.id,()=>({trait:{noAttack:true},skill:{id:'resonance-test-skill',kind:skillKind,duration:100,trigger:'SP_FULL',spCost:1,initSp:0,spType:'none'}})]));
  const battle=new Battle({seed,kind:'normal',round:1,timeLimit:60,autoFinish:false,stage:flatStage({id:'resonance-test'}),data,players:[player],kits,content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:20,dpPerSec:1,dpMax:99}});
  battle.resonanceMetrics={triggers:Object.create(null)};
  battle.resonanceMetric=(key,amount=1)=>{const [group,name]=key.split('.');if(group==='triggers')battle.resonanceMetrics.triggers[name]=(battle.resonanceMetrics.triggers[name]??0)+amount;};
  battle.resonanceResults={growth:[],coins:[],forge:[]};
  installResonanceEquipment(battle,{catalog:content,state});
  const active=installResonancePacts(battle,{catalog:content,state});
  return {battle,active,units:battle.allyUnits,player};
}
function advance(battle,seconds){const ticks=Math.ceil(seconds/battle.dt);for(let i=0;i<ticks&&!battle.finished;i++)battle.step();}
function spawnDummy(battle,pos=[9,10],rank='NORMAL'){return battle.spawnEnemy('resonance-test-enemy',{pos,def:enemyRec({key:'resonance-test-enemy',hp:1e9,atk:0,speed:0,rank})});}
function cast(battle,unit,seconds=.1){assert.equal(unit.skill?.activate?.('resonance-test',{free:true}),true,`SkillRuntime cast for ${unit.defId} (noSkill=${unit.skill?.noSkill}, active=${unit.skill?.active}, deployed=${unit.deployed})`);advance(battle,seconds);}
function castNow(unit){assert.equal(unit.skill?.activate?.('resonance-test',{free:true}),true,'the real SkillRuntime accepts the cast');}
function skilledOperators(count){return Object.values(catalog.operators).filter((row)=>data.chess[row.sourceChessId]?.skill).slice(0,count);}
function uniqueLoadouts(pact,count){const rows=[...new Map(Object.values(catalog.operators).map((row)=>[row.charId,row])).values()].slice(0,count);assert.equal(rows.length,count);return rows.map((operator)=>({operator,extraPacts:[pact]}));}

test('all 32 ordinary pact definitions have every configured tier effect covered',()=>{
  assert.equal(ordinaryIds.length,32);
  for(const id of ordinaryIds){
    const pact=catalog.pacts[id];assert.ok(pact,`missing pact ${id}`);
    assert.ok(pact.levels.length>0,`missing pact tiers ${id}`);
    assert.deepEqual(pact.levels.map(row=>row.threshold),pact.thresholds);
    for(const tier of pact.levels)for(const row of tier.effects)assert.ok(row.kind,'every pact effect has an explicit kind');
  }
});

test('ordinary effects stay inactive below threshold, including duplicate copies of one identity',()=>{
  for(const id of ordinaryIds){
    const first=catalog.pacts[id].thresholds[0];
    if(first<=1)continue;
    const operator=Object.values(catalog.operators).find((row)=>!row.pacts.includes(id));assert.ok(operator,`fixture for ${id}`);
    const single=makeBattle([{operator,extraPacts:[id]}]);
    assert.equal(single.active.has(id),false,`${id} cannot trigger with one unique member`);
    const duplicate=makeBattle([{operator,extraPacts:[id]},{operator,extraPacts:[id]}]);
    assert.equal(duplicate.active.has(id),false,`${id} counts duplicate instances as one identity`);
  }
});

test('every ordinary pact tier resolves at its configured unique-operator threshold',()=>{
  const unique=[...new Map(Object.values(catalog.operators).map((row)=>[row.charId,row])).values()];
  for(const id of ordinaryIds){
    const levels=catalog.pacts[id].levels;
    for(const row of levels){
      const threshold=row.threshold;
      assert.ok(unique.length>=threshold,`${id} fixture has ${threshold} distinct source identities`);
      const loadouts=unique.slice(0,threshold).map((operator)=>({operator,extraPacts:[id]}));
      const {active}=makeBattle(loadouts);
      assert.equal(active.get(id)?.tier,threshold,`${id} resolves exact tier ${threshold}`);
    }
  }
});

test('transfer gear is applied before unique-member tier resolution and control observes cooldown and membership',()=>{
  const controller=Object.values(catalog.operators).find((op)=>op.pacts.includes('control'));
  const transferred=Object.values(catalog.operators).find((op)=>!op.pacts.includes('control')&&!op.pacts.includes('symbiosis'));
  const unrelated=Object.values(catalog.operators).find((op)=>!op.pacts.includes('control')&&op.id!==transferred.id);
  assert.ok(controller&&transferred&&unrelated);
  const {battle,active,units}=makeBattle([{operator:controller},{operator:transferred,items:['transfer_control','blade']},{operator:unrelated}]);
  assert.equal(active.get('control')?.count,2);
  assert.equal(active.get('control')?.tier,2);
  assert.ok(units[1].mem.resonancePacts.has('control'));
  const before=units[1].base.atk;
  battle.start();
  assert.equal(units[1].base.atk,before,'equipment leaves source base stats intact');
  assert.equal(units[1].s.atk,before+15,'component attack applies in Battle effective stats');
  const enemyKey=Object.keys(data.enemies)[0];
  const enemy=battle.spawnEnemy(enemyKey,{pos:[9,10]});assert.ok(enemy);
  const hp=enemy.hp;
  battle.applyStatus(enemy,'stun',{duration:1,source:units[0]});
  const afterFirst=enemy.hp;assert.ok(afterFirst<hp,'real status application reaches the pact combat hook');
  battle.applyStatus(enemy,'stun',{duration:1,source:units[0]});
  assert.equal(enemy.hp,afterFirst,'per-target cooldown prevents duplicate same-frame proc');
  battle.applyStatus(enemy,'stun',{duration:1,source:units[2]});
  assert.equal(enemy.hp,afterFirst,'non-member receives no pact trigger');
  assert.ok(enemy.findBuff?.('stun')?.timeLeft>1,'control duration is adjusted in the native status pipeline');
  assert.equal(battle.errorCount,0);
});

test('actual dpGained events preserve cumulative Logistics gains across intervening spending',()=>{
  const operators=Object.values(catalog.operators).slice(0,2);
  const {battle,units,active}=makeBattle(operators.map((operator)=>({operator,extraPacts:['logistics']})));
  assert.equal(active.get('logistics')?.count,2);
  battle.start();battle.resonanceLogisticsAcc.clear();
  let teamSp=0;for(const unit of units)unit.skill.gainSp=(amount)=>{teamSp+=amount;};
  battle.addDp('resonance',6);battle.addDp('resonance',-4);
  battle.addDp('resonance',6);battle.addDp('resonance',-3);battle.addDp('resonance',6);
  advance(battle,.25);assert.ok(Math.abs(teamSp-4)<.1,'one cumulative ten-point threshold rewards both members');
  advance(battle,2);assert.ok(Math.abs(teamSp-8)<.1,'the next threshold survives intervening DP spending and cooldown');
  assert.equal(battle.errorCount,0);
});

test('Rhodes first-cast support and Arts cycle proc through natural SkillRuntime starts',()=>{
  const rhodesOps=Object.values(catalog.operators).slice(0,2);
  const rhodes=makeBattle(rhodesOps.map((operator)=>({operator,extraPacts:['rhodes']})));
  rhodes.battle.start();const rhodesUnit=rhodes.units[0];
  rhodesUnit.hp=rhodesUnit.s.maxHp-100;cast(rhodes.battle,rhodesUnit);
  assert.ok(rhodesUnit.buffs.some((row)=>row.key.includes('rhodes-first-cast')),'the first member cast grants its configured timed support buff');
  assert.ok(rhodesUnit.hp>rhodesUnit.s.maxHp-100,'the first cast heals its pact member through Battle.heal');
  cast(rhodes.battle,rhodesUnit);assert.equal(rhodesUnit.buffs.filter((row)=>row.key.includes('rhodes-first-cast')).length,1,'the once-per-operator trigger does not duplicate');
  assert.equal(rhodes.battle.errorCount,0);

  const arts=makeBattle(rhodesOps.map((operator)=>({operator,extraPacts:['arts']})));
  arts.battle.start();const target=spawnDummy(arts.battle,[arts.units[0].y,arts.units[0].x+1]);assert.ok(target);const before=target.hp;
  cast(arts.battle,arts.units[0]);assert.equal(target.hp,before,'the configured two-cast interval has not fired after one cast');
  cast(arts.battle,arts.units[0]);assert.ok(target.hp<before,'the second natural cast applies configured arts damage');
  assert.equal(arts.battle.errorCount,0);
});

test('Kjerag frost, Kazimierz true strike, and Combo six-hit cadence run on core attacks at low and terminal tiers',()=>{
  for(const [pact,every,terminalCount] of [['kjerag',5,7],['kazimierz',3,9]]){
    const lower=makeBattle(uniqueLoadouts(pact,2));lower.battle.start();const target=spawnDummy(lower.battle,[lower.units[0].y,lower.units[0].x+1]);
    for(let index=0;index<every-1;index++)performAttack(lower.battle,lower.units[0],lower.battle.effectiveProfile(lower.units[0]),[target]);
    assert.equal(target.buffs.some((row)=>['cold'].includes(row.status)),false,`${pact} does not proc one attack early`);
    const prior=target.hp;performAttack(lower.battle,lower.units[0],lower.battle.effectiveProfile(lower.units[0]),[target]);
    assert.ok(pact==='kjerag'?target.buffs.some((row)=>row.status==='cold'):(lower.units[0].mem.pactKazCount===every&&prior-target.hp>20),`${pact} reaches its configured minimum tier cadence and effect`);
    if(pact==='kjerag'){
      const frozen=spawnDummy(lower.battle,[9,12]);lower.battle.applyStatus(frozen,'freeze',{duration:2,source:lower.units[0]});const stored=lower.units[0].mem.pactKjeragNextHit;
      lower.battle.applyStatus(frozen,'freeze',{duration:2,source:lower.units[0]});assert.equal(lower.units[0].mem.pactKjeragNextHit,stored,'repeated freeze on one target respects its configured cooldown');
      advance(lower.battle,2.1);lower.battle.applyStatus(frozen,'freeze',{duration:2,source:lower.units[0]});assert.ok(lower.units[0].mem.pactKjeragNextHit>stored,'the freeze reward becomes available after its cooldown');
    }
    const terminal=makeBattle(uniqueLoadouts(pact,terminalCount));terminal.battle.start();const high=spawnDummy(terminal.battle,[terminal.units[0].y,terminal.units[0].x+1]);
    for(let index=0;index<3;index++)performAttack(terminal.battle,terminal.units[0],terminal.battle.effectiveProfile(terminal.units[0]),[high]);
    assert.ok(pact==='kjerag'?high.buffs.some((row)=>row.status==='cold'):(terminal.units[0].mem.pactKazCount===3&&high.hp<high.s.maxHp),`${pact} terminal tier uses its resolved three-attack cadence`);
    assert.equal(lower.battle.errorCount+terminal.battle.errorCount,0);
  }
  const lower=makeBattle(uniqueLoadouts('combo',2));lower.battle.start();const lowTarget=spawnDummy(lower.battle,[lower.units[0].y,lower.units[0].x+1]);
  for(let index=0;index<5;index++)performAttack(lower.battle,lower.units[0],lower.battle.effectiveProfile(lower.units[0]),[lowTarget]);
  assert.equal(lower.units[0].mem.pactCombo,5);const lowAspd=lower.units[0].s.aspd,preSixth=lowTarget.hp;
  performAttack(lower.battle,lower.units[0],lower.battle.effectiveProfile(lower.units[0]),[lowTarget]);assert.equal(lower.units[0].s.aspd,lowAspd+2);assert.ok(preSixth-lowTarget.hp>lower.units[0].s.atk*.1,'sixth attack adds configured pact damage');
  const terminal=makeBattle(uniqueLoadouts('combo',6));terminal.battle.start();const highTarget=spawnDummy(terminal.battle,[terminal.units[0].y,terminal.units[0].x+1]);const startAspd=terminal.units[0].s.aspd;
  for(let index=0;index<5;index++)performAttack(terminal.battle,terminal.units[0],terminal.battle.effectiveProfile(terminal.units[0]),[highTarget]);const beforeTerminalSixth=highTarget.hp;
  performAttack(terminal.battle,terminal.units[0],terminal.battle.effectiveProfile(terminal.units[0]),[highTarget]);assert.equal(terminal.units[0].s.aspd,startAspd+24);assert.ok(beforeTerminalSixth-highTarget.hp>terminal.units[0].s.atk*.1,'terminal sixth hit applies its stronger configured damage');
  assert.equal(lower.battle.errorCount+terminal.battle.errorCount,0);
});

test('Victoria artillery uses tier cadence and blocked-front Breaker bonuses require native blocking',()=>{
  for(const [count,shots] of [[2,20],[9,8]]){
    const setup=makeBattle(uniqueLoadouts('victoria',count));setup.battle.start();const unit=setup.units[0],target=spawnDummy(setup.battle,[unit.y,unit.x+1]);
    for(let index=0;index<shots-1;index++)performAttack(setup.battle,unit,setup.battle.effectiveProfile(unit),[target]);
    assert.equal(setup.battle.resonanceAttackCount,shots-1);const hp=target.hp;
    performAttack(setup.battle,unit,setup.battle.effectiveProfile(unit),[target]);assert.ok(target.hp<hp,'the tier artillery fires at its configured attack count');
    assert.equal(setup.battle.errorCount,0);
  }
  const lower=makeBattle(uniqueLoadouts('breaker',2));lower.battle.start();const attacker=lower.units[0];const unblocked=spawnDummy(lower.battle,[9,10]);
  const baseline=lower.battle.dealDamage(attacker,unblocked,{amount:100,type:'phys',canDodge:false});
  const target=spawnDummy(lower.battle,[attacker.y,attacker.x+1]);target.x=attacker.x;target.y=attacker.y;assert.equal(lower.battle._checkBlock(target),true);
  assert.equal(target.blockedBy,attacker);const actual=lower.battle.dealDamage(attacker,target,{amount:100,type:'phys',canDodge:false});
  assert.ok(actual>baseline,'the blocked target takes the configured front-line hit multiplier through damage resolution');
  assert.equal(lower.battle.dealDamage(attacker,target,{amount:100,type:'phys',canDodge:false}),baseline,'the boost observes its per-target quarter-second cooldown');
  const terminal=makeBattle(uniqueLoadouts('breaker',6));assert.ok(terminal.active.get('breaker').effects.find((row)=>row.kind==='breaker_front').params.blockedBonus>lower.active.get('breaker').effects.find((row)=>row.kind==='breaker_front').params.blockedBonus);
  terminal.battle.start();const highUnit=terminal.units[0],highBaseline=spawnDummy(terminal.battle,[9,10]),highTarget=spawnDummy(terminal.battle,[highUnit.y,highUnit.x+1]);
  const highNormal=terminal.battle.dealDamage(highUnit,highBaseline,{amount:100,type:'phys',canDodge:false});highTarget.x=highUnit.x;highTarget.y=highUnit.y;assert.equal(terminal.battle._checkBlock(highTarget),true);
  const highBoost=terminal.battle.dealDamage(highUnit,highTarget,{amount:100,type:'phys',canDodge:false});assert.ok(highBoost>highNormal,'terminal tier bonus also applies in the native hit pipeline');
  assert.equal(lower.battle.errorCount+terminal.battle.errorCount,0);
});

test('Sami cold bonus, Siracusa execute, Burn cooldown, and Crown memory alter real damage by tier',()=>{
  const sami=makeBattle([{operator:Object.values(catalog.operators)[0],extraPacts:['sami']}]);sami.battle.start();
  const chilled=spawnDummy(sami.battle,[9,10]);const ordinary=spawnDummy(sami.battle,[9,11]);
  sami.battle.applyStatus(chilled,'cold',{duration:10,source:sami.units[0]});
  const normal=sami.battle.dealDamage(sami.units[0],ordinary,{amount:100,type:'phys',canDodge:false});
  const cold=sami.battle.dealDamage(sami.units[0],chilled,{amount:100,type:'phys',canDodge:false});
  assert.ok(cold>normal,'Sami amplifies damage only on an actually cold target');
  const healed=sami.units[0];healed.hp=healed.s.maxHp-100;cast(sami.battle,healed);assert.ok(healed.hp>healed.s.maxHp-100,'Sami first-cast support heals through SkillRuntime');
  assert.equal(sami.battle.errorCount,0);

  for(const [count,bonus] of [[2,15],[8,70]]){
    const setup=makeBattle(uniqueLoadouts('siracusa',count));setup.battle.start();const unit=setup.units[0];
    const healthy=spawnDummy(setup.battle,[9,10]);const low=spawnDummy(setup.battle,[9,11]);const boss=spawnDummy(setup.battle,[9,12],'BOSS');
    low.hp=low.s.maxHp*.2;boss.hp=boss.s.maxHp*.2;
    const baseline=setup.battle.dealDamage(unit,healthy,{amount:100,type:'phys',canDodge:false});
    const execute=setup.battle.dealDamage(unit,low,{amount:100,type:'phys',canDodge:false});
    const bossExecute=setup.battle.dealDamage(unit,boss,{amount:100,type:'phys',canDodge:false});
    assert.ok(execute>baseline&&bossExecute>baseline,`tier with ${bonus}% below-threshold bonus applies on bosses too`);
    assert.ok(setup.active.get('siracusa').effects.find((row)=>row.kind==='siracusa_execute').params.executeBonus===bonus);
    assert.equal(setup.battle.errorCount,0);
  }
  const burn=makeBattle(uniqueLoadouts('burn',2));burn.battle.start();const source=burn.units[0],target=spawnDummy(burn.battle,[9,10]);
  burn.battle.dealDamage(source,target,{amount:100,type:'phys',canDodge:false});const firstGauge=target.elem.burn;
  assert.ok(firstGauge>0,'a natural non-resonance damage event applies the configured burn element');
  burn.battle.dealDamage(source,target,{amount:100,type:'phys',canDodge:false});assert.equal(target.elem.burn,firstGauge,'the same target does not retrigger before its cooldown and resonance damage does not propagate');
  advance(burn.battle,3.1);burn.battle.dealDamage(source,target,{amount:100,type:'phys',canDodge:false});assert.ok(target.elem.burn>firstGauge,'the configured three-second target cooldown expires');
  assert.equal(burn.battle.errorCount,0);
  const burnTop=makeBattle(uniqueLoadouts('burn',4));burnTop.battle.start();const burnOwner=burnTop.units[0],burnTarget=spawnDummy(burnTop.battle,[9,10]);burnTop.battle.dealDamage(burnOwner,burnTarget,{amount:100,type:'phys',canDodge:false});
  assert.ok(burnTarget.elem.burn>target.elem.burn,'terminal burn tier applies its larger element fill');

  const kings=uniqueLoadouts('crown',1);kings[0].star=3;const crown=makeBattle([...kings,{operator:Object.values(catalog.operators).find((row)=>!row.pacts.includes('crown')),star:1}],{skillKind:'duration'});crown.battle.start();
  cast(crown.battle,crown.units[1]);assert.equal(crown.units[0].mem.pactCrownBonus,.1,'the terminal star-specific byCast value is retained');
  castNow(crown.units[0]);const crownTarget=spawnDummy(crown.battle,[9,10]),normalTarget=spawnDummy(crown.battle,[9,11]);const base=crown.battle.dealDamage(crown.units[0],normalTarget,{amount:100,type:'arts',isSkill:false,canDodge:false});const skill=crown.battle.dealDamage(crown.units[0],crownTarget,{amount:100,type:'arts',isSkill:true,canDodge:false});
  assert.ok(skill>base,`the stored cast memory applies on a real skill-damage event (skill=${skill},base=${base},memory=${crown.units[0].mem.pactCrownSkillBonus},raw=${JSON.stringify({charId:crown.units[0].def.raw?.charId,id:crown.units[0].def.raw?.id})})`);assert.equal(crown.battle.errorCount,0);
  const crownBase=makeBattle([{operator:Object.values(catalog.operators).find((row)=>row.pacts.includes('crown')),star:1,extraPacts:['crown']},{operator:Object.values(catalog.operators).find((row)=>!row.pacts.includes('crown'))}],{skillKind:'duration'});crownBase.battle.start();cast(crownBase.battle,crownBase.units[1]);assert.equal(crownBase.units[0].mem.pactCrownBonus,.03,'the one-star memory uses the configured minimum-star increment');
});

test('Ammo last-shot rider and Lungmen kill cap are driven by real skill and lethal-damage events',()=>{
  for(const [count,lastDamage] of [[2,80],[6,220]]){
    const setup=makeBattle(uniqueLoadouts('ammo',count),{skillKind:'ammo'});setup.battle.start();const unit=setup.units[0],target=spawnDummy(setup.battle,[9,10]);
    unit.skill.ammoLeft=1;const before=target.hp;castNow(unit);performAttack(setup.battle,unit,setup.battle.effectiveProfile(unit),[target]);
    assert.ok(unit.skill.ammoLeft===0,'a real ammo SkillRuntime cast consumes its final round');
    assert.ok(before-target.hp>unit.s.atk*.75,`the last-round rider applies the tier value ${lastDamage}% ATK`);
    assert.equal(setup.active.get('ammo').effects.find((row)=>row.kind==='ammo_last_round').params.lastDamage,lastDamage);
    assert.equal(setup.battle.errorCount,0);
  }
  const lower=makeBattle(uniqueLoadouts('lungmen',2));lower.battle.start();let sp=0;for(const unit of lower.units)unit.skill.gainSp=(value)=>{sp+=value;};
  for(let index=0;index<4;index++){const victim=spawnDummy(lower.battle,[9,10+index]);victim.hp=1;lower.battle.dealDamage(lower.units[0],victim,{amount:100,type:'true',canDodge:false});}
  assert.equal(sp,3,'the configured three team SP rewards cap across real kill events');
  assert.equal(lower.battle.resonanceKills,4,'all four lethal hits reach the native kill hook');
  lower.battle.resonanceOutcome={won:true};lower.battle.forceEnd('cleared');
  assert.deepEqual(lower.battle.resonanceResults.coins,[{amount:1,source:'lungmen'}],'a canonical win adds the configured minimum-tier gold reward');
  const terminal=makeBattle(uniqueLoadouts('lungmen',6));assert.equal(terminal.active.get('lungmen').effects.find((row)=>row.kind==='lungmen_reward').params.victoryGold,3);terminal.battle.start();terminal.battle.resonanceOutcome={won:true};terminal.battle.forceEnd('cleared');assert.deepEqual(terminal.battle.resonanceResults.coins,[{amount:3,source:'lungmen'}]);
});

test('Higashi deploy/retreat, Iberia first block shield, and Flight airborne dive use Battle state transitions',()=>{
  for(const [count,returnSp] of [[2,15],[4,40]]){
    const setup=makeBattle(uniqueLoadouts('higashi',count));setup.battle.start();const unit=setup.units[0];let gained=0;unit.skill.gainSp=(value)=>{gained+=value;};
    assert.ok(unit.buffs.some((row)=>row.key.includes('higashi-deploy')),'the real initial deploy installs Higashi evasion');
    setup.battle.retreat(unit);assert.equal(gained,returnSp,'a genuine retreat yields the resolved tier SP');
    assert.ok(setup.active.get('higashi').effects.find((row)=>row.kind==='higashi_redeploy').params.returnSp===returnSp);
  }
  for(const [count,barrier,breakDamage] of [[2,20,120],[4,45,280]]){
    const iberia=makeBattle(uniqueLoadouts('iberia',count));iberia.battle.start();const blocker=iberia.units[0],attacker=spawnDummy(iberia.battle,[blocker.y,blocker.x+1]),splash=spawnDummy(iberia.battle,[blocker.y,blocker.x+2]);
    attacker.x=blocker.x;attacker.y=blocker.y;assert.equal(iberia.battle._checkBlock(attacker),true);const shield=blocker.buffs.find((row)=>row.key.includes('iberia-barrier'));assert.ok(shield,'first real block installs Iberia shield');assert.equal(shield.shield,blocker.s.maxHp*barrier/100);
    blocker.s.blockCnt=2;const extra=spawnDummy(iberia.battle,[blocker.y,blocker.x+2]);extra.x=blocker.x;extra.y=blocker.y;assert.equal(iberia.battle._checkBlock(extra),true);assert.equal(blocker.buffs.find((row)=>row.key.includes('iberia-barrier')).shield,shield.shield,'subsequent blocks do not grant another first-block shield');
    const splashBefore=splash.hp;iberia.battle.dealDamage(attacker,blocker,{amount:1e9,type:'true',isAttack:true,canDodge:false});
    assert.ok(splashBefore-splash.hp>=blocker.s.atk*breakDamage/100*.99,'breaking the shield sends the tier damage to nearby enemies');assert.equal(iberia.battle.errorCount,0);
  }

  const flight=makeBattle(uniqueLoadouts('flight',1));flight.battle.start();const flyer=flight.units[0],target=spawnDummy(flight.battle,[flyer.y,flyer.x+1]);flyer.motion='FLY';
  const hp=target.hp;cast(flight.battle,flyer);assert.ok(target.hp<hp,'an airborne member skill end performs its real nearby dive');
  const hit=spawnDummy(flight.battle,[flyer.y,flyer.x+2]);const reduced=flight.battle.dealDamage(hit,flyer,{amount:100,type:'phys',isAttack:true,canDodge:false});
  flyer.motion='GROUND';const grounded=flight.battle.dealDamage(hit,flyer,{amount:100,type:'phys',isAttack:true,canDodge:false});assert.ok(reduced<grounded,'flight mitigation applies only while airborne');
  assert.equal(flight.battle.errorCount,0);
  const topFlight=makeBattle(uniqueLoadouts('flight',3));topFlight.battle.start();const topFlyer=topFlight.units[0],topTarget=spawnDummy(topFlight.battle,[topFlyer.y,topFlyer.x+1]);topFlyer.motion='FLY';const topHp=topTarget.hp;cast(topFlight.battle,topFlyer);assert.ok(topHp-topTarget.hp>topFlyer.s.atk*2,'terminal Flight tier applies its 240%-ATK dive');
});

test('Creation supports a real source token and Redeploy restores a killed operator through native respawn',()=>{
  const owner=Object.values(catalog.operators).find((row)=>data.chess[row.sourceChessId]?.tokens?.length);assert.ok(owner,'fixture selects a source-defined token owner');
  const creationOperators=[owner,...[...new Map(Object.values(catalog.operators).map((row)=>[row.charId,row])).values()].filter((row)=>row.charId!==owner.charId).slice(0,1)];
  const creation=makeBattle(creationOperators.map((operator)=>({operator,extraPacts:['creation']})));creation.battle.start();
  const nativeTokenId=data.chess[owner.sourceChessId].tokens[0],creationOwner=creation.units.find((unit)=>unit.def.raw?.charId===owner.charId);
  const token=creation.battle.spawnToken(creationOwner,nativeTokenId,9,4,{def:data.tokens[nativeTokenId]});assert.ok(token,`the existing source token ${nativeTokenId} deploys through Battle`);
  token.hp=token.s.maxHp/2;const ownerSpBefore=creationOwner.skill.sp;cast(creation.battle,creationOwner);
  assert.ok(token.hp>token.s.maxHp/2,'a real owner skill start heals its deployed construct');assert.ok(token.buffs.some((row)=>row.key.includes('creation-cast')),'the construct receives the configured temporary ASPD buff');
  const enemy=spawnDummy(creation.battle,[token.y,token.x+1]);performAttack(creation.battle,token,creation.battle.effectiveProfile(token),[enemy]);
  assert.ok(creationOwner.skill.sp>ownerSpBefore,'a construct attack returns configured capped SP to its exact owner');
  const topOperators=[owner,...[...new Map(Object.values(catalog.operators).map((row)=>[row.charId,row])).values()].filter((row)=>row.charId!==owner.charId).slice(0,5)];
  const terminal=makeBattle(topOperators.map((operator)=>({operator,extraPacts:['creation']})));terminal.battle.start();const topOwner=terminal.units.find((unit)=>unit.def.raw?.charId===owner.charId);
  const topToken=terminal.battle.spawnToken(topOwner,nativeTokenId,9,8,{def:data.tokens[nativeTokenId]});assert.ok(topToken,'terminal roster uses the same existing source token');let topSp=0;topOwner.skill.gainSp=(value)=>{topSp+=value;};
  performAttack(terminal.battle,topToken,terminal.battle.effectiveProfile(topToken),[spawnDummy(terminal.battle,[topToken.y,topToken.x+1])]);
  assert.equal(topSp,.6,'terminal roster owner receives the configured 0.6 SP on a real token attack');assert.equal(terminal.active.get('creation').tier,6);
  assert.equal(creation.battle.errorCount,0);

  for(const [count,timeMultiplier] of [[2,.8],[5,.4]]){
    const redeploy=makeBattle(uniqueLoadouts('redeploy',count));redeploy.battle.start();const unit=redeploy.units[0];unit.base.respawnTime=.5;unit.hp=1;
    const killer=spawnDummy(redeploy.battle,[unit.y,unit.x+1]),victim=spawnDummy(redeploy.battle,[unit.y,unit.x+2]);
    const before=victim.hp;redeploy.battle.dealDamage(killer,unit,{amount:1e6,type:'true',canDodge:false});
    assert.equal(unit.alive,false);assert.ok(unit.mem.pactRedeployPending);assert.ok(Math.abs(unit.respawnAt-unit.deathAt-.5*timeMultiplier)<1e-8,'the configured tier changes the native redeploy timer');
    advance(redeploy.battle,1);assert.equal(unit.alive,true,'native Battle redeploys the downed operator when its timer and DP allow');
    assert.ok(unit.hp>unit.s.maxHp*.9,'the redeploy trigger returns the configured HP');assert.ok(victim.hp<before,'deploy emits the configured nearby arts burst');
    assert.equal(redeploy.battle.errorCount,0);
  }
});

test('Logistics opening DP is excluded and the three-star bonus follows only its own sourced first income',()=>{
  const operator=Object.values(catalog.operators).find((row)=>row.cost<5&&row.stars?.[3]?.passive?.kind==='star3_logistics');assert.ok(operator);
  const partner=Object.values(catalog.operators).find((row)=>row.id!==operator.id);assert.ok(partner);
  const {battle,units}=makeBattle([{operator,star:3,extraPacts:['logistics']},{operator:partner,extraPacts:['logistics']}]);
  const gains=[];battle.on('dpGained',(event)=>gains.push(event));battle.start();
  assert.equal(gains[0]?.source,'initial','opening pact DP is explicitly marked initial');
  assert.equal(gains.some((row)=>row.sourceUnitId===units[0].id),false,'opening income cannot trigger a personal first-production bonus');
  const before=battle.getPlayer('resonance').dp;battle.addDp('resonance',1,{source:'natural'});assert.equal(battle.getPlayer('resonance').dp,before+1,'natural regeneration counts for the team pool but has no personal producer');
  const afterNatural=battle.getPlayer('resonance').dp;
  battle.addDp('resonance',1,{sourceUnitId:units[0].id});
  assert.equal(battle.getPlayer('resonance').dp,afterNatural+1+5,'the star-three producer receives its configured one-time bonus');
  assert.ok(gains.some((event)=>event.source==='resonance_bonus'),'the passive bonus is marked to prevent itself triggering again');
  battle.addDp('resonance',1,{sourceUnitId:units[0].id});
  assert.equal(battle.getPlayer('resonance').dp,afterNatural+7,'a later production by the same owner receives no second bonus');
  battle.addDp('resonance',1,{sourceUnitId:units[1].id});
  assert.equal(battle.getPlayer('resonance').dp,afterNatural+8,'another producer cannot receive the star-three owner bonus');
  const accrued=battle.resonanceLogisticsAcc.get('resonance');battle.addDp('resonance',10,{source:'refund'});assert.equal(battle.resonanceLogisticsAcc.get('resonance'),accrued,'a failed-purchase refund is not counted as production');
  assert.equal(battle.errorCount,0);
});

test('Babel grants each member its first exit once and battle-end growth stays on its living pact members',()=>{
  const operators=Object.values(catalog.operators).slice(0,2),pieces=operators.map((operator,index)=>({uid:`piece-${index+1}`,growth:{'babel:atk':118}}));
  const {battle,units}=makeBattle(operators.map((operator)=>({operator,extraPacts:['babel']})),{state:{pieces}});
  battle.start();const sp=[0,0];units.forEach((unit,index)=>{unit.skill.gainSp=(amount)=>{sp[index]+=amount;};});
  battle.retreat(units[0],{reason:'test'});assert.deepEqual(sp,[5,5]);
  units[0].hp=0;battle.retreat(units[0],{reason:'test-death',permanent:true});assert.deepEqual(sp,[5,5],'a later exit does not duplicate the first-exit reward');
  units[0].hp=0;units[1].hp=0;battle.forceEnd('defeated');
  assert.deepEqual(battle.resonanceResults.growth,[],'no living Babel member means no random growth award');
  const living=makeBattle(operators.map((operator)=>({operator,extraPacts:['babel']})),{state:{pieces}});living.battle.start();living.battle.resonanceOutcome={won:true};living.battle.forceEnd('forced');
  assert.equal(living.battle.resonanceResults.growth.length,1);
  assert.equal(living.battle.resonanceResults.growth[0].key,'babel:atk');
  assert.ok(['piece-1','piece-2'].includes(living.battle.resonanceResults.growth[0].pieceUid));
  assert.equal(living.battle.resonanceResults.growth[0].amount,2,'existing growth is respected at the configured cap');
});

test('Ursus growth applies after any ended battle while Bolivar requires the canonical win outcome',()=>{
  const operators=Object.values(catalog.operators).slice(0,2),pieces=operators.map((operator,index)=>({uid:`piece-${index+1}`,growth:{}}));
  const defeated=makeBattle(operators.map((operator)=>({operator,extraPacts:['ursus','bolivar']})),{state:{pieces}});
  assert.equal(defeated.active.get('ursus')?.count,2);defeated.battle.start();assert.equal(defeated.units.filter((unit)=>unit.kind==='op'&&unit.alive).length,2);
  defeated.battle.forceEnd('defeated');
  assert.equal(defeated.battle.resonanceResults.growth.filter((row)=>row.source==='ursus').length,2,'each surviving Ursus member receives end-of-battle HP growth on defeat');
  assert.equal(defeated.battle.resonanceResults.growth.some((row)=>row.source==='bolivar'),false,'Bolivar receives no growth on defeat');
  const won=makeBattle(operators.map((operator)=>({operator,extraPacts:['bolivar']})),{state:{pieces}});
  won.battle.start();won.battle.resonanceOutcome={won:true};won.units[1].alive=false;won.battle.forceEnd('cleared');
  assert.equal(won.battle.resonanceResults.growth.filter((row)=>row.source==='bolivar').length,2,'the canonical win grants growth to both pact members even if one did not survive');
});

test('ordinary stat multipliers use live simulator buff keys and Rim records one capped forge reward',()=>{
  const operators=skilledOperators(2);
  const leitha=makeBattle(operators.map((operator)=>({operator,extraPacts:['leithania']})));
  leitha.battle.start();assert.equal(leitha.units[0].s.artsDealtMul,1.15,'percent arts damage is a 1.15 multiplier, not 0.15');
  const rimOps=skilledOperators(5);
  const rim=makeBattle(rimOps.map((operator)=>({operator,extraPacts:['rim']})),{skillKind:'duration'});
  rim.battle.start();
  for(const unit of rim.units)castNow(unit);
  assert.ok(rim.units.every((unit)=>unit.skill.active),'the fixture keeps every cast open, so no skillEnd can account for the forge threshold');
  assert.equal(rim.battle.resonanceResults.forge.length,1,'the node-level forge cap is enforced');
  assert.deepEqual(rim.battle.resonanceResults.forge[0],{progress:1,threshold:5,source:'rim',nodeCap:1});
});

test('low-cost three-star Necrosis grants its one-time SP on a real elemental burst',()=>{
  const operator=Object.values(catalog.operators).find((row)=>row.cost<5&&row.stars?.[3]?.passive?.kind==='star3_necrosis');assert.ok(operator);
  const {battle,units}=makeBattle([{operator,star:3}]);battle.start();
  const enemy=spawnDummy(battle);assert.ok(enemy);
  const before=units[0].skill.sp;
  battle.dealDamage(units[0],enemy,{amount:enemy.gaugeMax,type:'element',element:'apoptosis',canDodge:false});
  assert.equal(units[0].skill.sp,Math.min(units[0].skill.spCost,before+10));
  assert.equal(units[0].mem.star3NecrosisUsed,true);
  assert.equal(battle.errorCount,0);
});

test('Judgement Knight Kit and pacts installer together produce only one configured three-star pulse',()=>{
  const operator=Object.values(catalog.operators).find((row)=>row.cost<5&&row.stars?.[3]?.passive?.kind==='judgement_support');assert.ok(operator);
  const targetOperator=Object.values(catalog.operators).find((row)=>row.id!==operator.id);
  const state={environmentId:'origin_laterano',pieces:[{uid:'justice',star:3},{uid:'target',star:1}]};
  const battleData={...data,chess:{...data.chess,[operator.sourceChessId]:{...data.chess[operator.sourceChessId],...operator.stars[3].record,id:operator.sourceChessId,chessId:operator.sourceChessId,resonanceStar:3}}};
  const player={playerId:'resonance',units:[
    {uid:'justice',chessId:operator.sourceChessId,skillIndex:operator.fixedSkillIndex??0,moduleId:'none',row:9,col:5,dir:'RIGHT',star:3,items:[]},
    {uid:'target',chessId:targetOperator.sourceChessId,skillIndex:targetOperator.fixedSkillIndex??0,moduleId:'none',row:9,col:6,dir:'RIGHT',star:1,items:[]},
  ]};
  const battle=new Battle({seed:912,kind:'normal',round:1,timeLimit:60,autoFinish:false,stage:flatStage({id:'resonance-judgement-test'}),data:battleData,players:[player],kits:createResonanceKits(catalog,state,battleData),content:'independent',recordEvents:false,flags:{dpInit:20,dpPerSec:1,dpMax:99},extraContent:[b=>installResonanceBattle(b,{catalog,state})]});
  battle.start();const justice=battle.allyUnits.find(row=>row.uid==='justice'),target=battle.allyUnits.find(row=>row.uid==='target');
  assert.ok(justice.kit.talents.length,'the named passive is installed by its fixed-skill Kit');
  assert.ok(battle._sched.some(row=>row.owner===justice&&row.interval===3),'star-three profile schedules the configured three-second Kit pulse');
  target.hp=target.s.maxHp/3;const before=target.hp,beforeAspd=target.s.aspd;
  advance(battle,3.1);
  const expected=Math.min(target.s.maxHp-before,justice.s.atk*220/100);
  assert.ok(Math.abs(target.hp-(before+expected))<1e-8,`one periodic Kit consumer heals exactly the configured 220%-ATK amount (delta=${target.hp-before}, expected=${expected}, atk=${justice.s.atk}, star=${justice.def.raw?.resonanceStar}, skill=${justice.skill?.kind}, coords=${justice.x},${justice.y}/${target.x},${target.y}, alive=${justice.alive}/${target.alive}, deployed=${justice.deployed}/${target.deployed}, sched=${battle._sched.map(row=>`${row.owner?.uid}:${row.interval}:${row.due}`).join(',')})`);
  assert.ok(target.s.aspd>beforeAspd,'the same Kit pulse applies configured temporary ASPD');
  assert.equal(battle.allyUnits.filter(row=>row.kind==='op'&&row.buffs.some(buff=>String(buff.key).includes('judgement'))).length,1,'pacts does not duplicate the Kit-owned effect');
  assert.equal(battle.errorCount,0);
});

test('symbiosis heal conversion uses only actual HP restored and ignores overheal',()=>{
  const operators=Object.values(catalog.operators).slice(0,2);
  const {battle,units,active}=makeBattle(operators.map((operator)=>({operator,extraPacts:['symbiosis']})));
  assert.equal(active.get('symbiosis')?.count,2);
  battle.start();
  const target=units[0],source=units[1];target.hp=target.s.maxHp-10;
  assert.equal(battle.heal(source,target,100,{tags:['test']}),10);
  const shield=target.buffs.find((row)=>row.key==='resonance:pact:symbiosis-shield')?.shield;
  assert.equal(shield,1.5,'the shield is derived from the ten HP actually restored');
  assert.equal(battle.heal(source,target,100,{tags:['test']}),0);
  assert.equal(target.buffs.find((row)=>row.key==='resonance:pact:symbiosis-shield')?.shield,shield,'overheal at full HP cannot inflate the shield');
});

test('Columbia and eight-member Laterano create visible synthetic units without native owner tokens',()=>{
  const operators=Object.values(catalog.operators).slice(0,8);
  const loadouts=operators.map((operator,index)=>({operator,extraPacts:index<2?['columbia','laterano']:['laterano']}));
  const {battle,active}=makeBattle(loadouts);
  assert.equal(active.get('columbia')?.count,2);assert.equal(active.get('laterano')?.count,8);
  battle.start();
  const enemy=spawnDummy(battle);assert.ok(enemy);const enemyHp=enemy.hp;
  assert.ok(battle.allyUnits.filter((unit)=>unit.kind==='op').every((unit)=>unit.def.tokens.length===0),'the selected records exercise empty native token lists');
  advance(battle,12.25);
  const construct=battle.allyUnits.find((unit)=>unit.kind==='token'&&unit.mem.resonanceSyntheticKind==='columbia-construct'&&unit.alive);assert.ok(construct,'Columbia constructs are explicit visible summons');
  enemy.x=construct.x;enemy.y=construct.y;enemy.tileR=construct.tileR;enemy.tileC=construct.tileC;
  assert.ok(enemy.alive&&enemy.deployed,`attack target remains available (alive=${enemy.alive}, deployed=${enemy.deployed}, hp=${enemy.hp}, max=${enemy.s.maxHp})`);
  advance(battle,1);
  assert.ok((battle.resonanceMetrics.triggers.columbiaConstructAttacks??0)>0,'the visible Columbia construct performs its configured attack');
  advance(battle,1);
  assert.ok(battle.allyUnits.some((unit)=>unit.kind==='token'&&unit.mem.resonanceSyntheticKind==='laterano-drone'&&unit.alive),'Laterano creates one visible drone without borrowing an unrelated token');
  assert.equal(battle.allyUnits.filter((unit)=>unit.kind==='token'&&unit.mem.resonanceSyntheticKind==='laterano-drone'&&unit.alive).length,1,'the drone is persistent rather than respawned each tick');
  assert.equal(battle.resonanceMetrics.triggers.lateranoDroneShots%3,0,'the persistent drone fires in groups of three configured 180% shots');
  assert.ok(battle.resonanceMetrics.triggers.lateranoDroneShots>=6,'the persistent drone fires across the real elapsed intervals');
  assert.ok(enemy.hp<enemyHp,'visible construct/drone attacks deal real Battle damage');
  assert.equal(battle.errorCount,0);
});

test('Sui team-wide casts and ten-member Yan formation are visible without borrowed native token IDs',()=>{
  const ten=skilledOperators(10),operator=ten[0];
  const sui=makeBattle([{operator:ten[0],extraPacts:['sui']},{operator:ten[1],extraPacts:['sui']},{operator:ten[2]}]);assert.equal(sui.active.get('sui')?.count,2);sui.battle.start();
  const suiUnits=sui.battle.allyUnits.filter((row)=>row.kind==='op');assert.equal(suiUnits.length,3);
  const unit=suiUnits[0];
  const eliteId=Object.entries(data.enemies).find(([,row])=>/ELITE|BOSS/i.test(String(row.rank??row.raw?.rank)))?.[0];
  if(eliteId){assert.ok(sui.battle.spawnEnemy(eliteId,{pos:[9,10]}));castNow(suiUnits[2]);assert.ok(suiUnits.every((row)=>row.buffs.filter((buff)=>buff.key==='resonance:pact:sui-barrier').length===1),'a non-Sui ally first cast grants one barrier to each team member');for(let index=1;index<10;index++)castNow(suiUnits[index%2]);assert.equal(sui.battle.resonanceSuiCast,10,'the global cast counter includes the non-Sui caster');const shadows=sui.battle.allyUnits.filter((row)=>row.kind==='token'&&row.mem.resonanceSyntheticKind==='sui-shadow'&&row.alive);assert.equal(shadows.length,1,'the global team cast threshold creates exactly one shadow');const expectedOwner=suiUnits.slice(0,2).sort((a,z)=>z.s.atk-a.s.atk||a.id-z.id)[0];assert.equal(shadows[0].ownerUnit,expectedOwner,'the highest-ATK Sui member owns the one team summon');}
  const leithania=makeBattle(ten.slice(0,3).map((row)=>({operator:row,extraPacts:['leithania']})));leithania.battle.start();const soundUnits=leithania.battle.allyUnits.filter((row)=>row.kind==='op');const soundEnemy=spawnDummy(leithania.battle);assert.ok(soundEnemy);for(let index=0;index<12;index++)cast(leithania.battle,soundUnits[index%3]);assert.equal(leithania.battle.resonanceLeithaniaAreas.length,3,'every third team cast creates an area and the oldest is replaced at the three-area cap');assert.equal(leithania.battle.resonanceLeithaniaCasts,12);const field=leithania.battle.resonanceLeithaniaAreas[0];soundEnemy.x=field.x;soundEnemy.y=field.y;soundEnemy.tileR=field.y;soundEnemy.tileC=field.x;const hpAtField=soundEnemy.hp;advance(leithania.battle,2);assert.ok(soundEnemy.hp<hpAtField,'the fixed sound tile deals real area damage');soundEnemy.x=0;soundEnemy.y=0;soundEnemy.tileR=0;soundEnemy.tileC=0;const hpAway=soundEnemy.hp;advance(leithania.battle,1);assert.equal(soundEnemy.hp,hpAway,'the area does not follow a moving target');
  const yan=makeBattle(ten.map((row,index)=>({operator:row,extraPacts:['yan']})));assert.equal(yan.active.get('yan')?.count,10);yan.battle.start();advance(yan.battle,2);
  assert.ok(yan.battle.allyUnits.some((row)=>row.kind==='token'&&row.mem.resonanceSyntheticKind==='yan-formation'&&row.alive),'ten-member Yan formation is an explicit visible summon');
  assert.equal(sui.battle.errorCount,0);assert.equal(leithania.battle.errorCount,0);assert.equal(yan.battle.errorCount,0);
});

test('Yan combo counts team casts and Sargon leaves a four-second fixed sand area',()=>{
  const operators=skilledOperators(3);
  const yan=makeBattle(operators.map((operator)=>({operator,extraPacts:['yan']})));assert.equal(yan.active.get('yan')?.count,3);yan.battle.start();
  const target=spawnDummy(yan.battle);assert.ok(target);const before=target.hp;const yanUnits=yan.battle.allyUnits.filter((unit)=>unit.kind==='op');
  for(let index=0;index<4;index++){yan.battle.time=index*2.1;const unit=yanUnits[index%yanUnits.length];castNow(unit);}
  assert.equal(target.hp,before,'fewer than five combined team casts do not fire the tier-three combo');
  yan.battle.time=8.4;castNow(yanUnits[1]);assert.ok(target.hp<before,'the fifth accepted cast after the per-member cooldown triggers the shared combo');

  const sargon=makeBattle(operators.slice(0,2).map((operator)=>({operator,extraPacts:['sargon']})));assert.equal(sargon.active.get('sargon')?.count,2);sargon.battle.start();
  const sandOwner=sargon.battle.allyUnits.find((unit)=>unit.kind==='op');const sandEnemy=spawnDummy(sargon.battle,[sandOwner.y,sandOwner.x]);assert.ok(sandEnemy);
  advance(sargon.battle,12.25);const area=sandOwner.mem.pactSargonArea;assert.ok(area&&area.until<=sargon.battle.time+4,'the configured sand area lasts four seconds at a fixed tile');
  sandEnemy.x=area.x;sandEnemy.y=area.y;const hpIn=sandEnemy.hp;advance(sargon.battle,1);assert.ok(sandEnemy.hp<hpIn,'the area deals actual damage at its fixed center');const sandSlow=sandEnemy.buffs.find((row)=>String(row.key).startsWith('resonance:pact:sargon-slow:'));assert.equal(sandSlow.mods.moveMul,.75,'the active sand area applies its configured movement slow');
  sandEnemy.x=area.x+5;sandEnemy.y=area.y+5;const hpOut=sandEnemy.hp;advance(sargon.battle,1);assert.equal(sandEnemy.hp,hpOut,'moving outside the area stops its damage');
  sandEnemy.x=area.x;sandEnemy.y=area.y;advance(sargon.battle,5);assert.ok(sandEnemy.buffs.every((row)=>!String(row.key).startsWith('resonance:pact:sargon-slow:')||row.timeLeft<=0),'the four-second field no longer applies its movement slow after expiry');
  assert.equal(yan.battle.errorCount,0);assert.equal(sargon.battle.errorCount,0);
});

test('installer rejects an unrecognized pact effect instead of silently ignoring it',()=>{
  const malformed={...catalog,pacts:{...catalog.pacts,ammo:{...catalog.pacts.ammo,levels:[{threshold:2,effects:[{kind:'invented_effect',params:{}}]}]}}};
  const operator=Object.values(catalog.operators)[0];
  const {battle}=makeBattle([{operator,extraPacts:['ammo']},{operator:Object.values(catalog.operators)[1],extraPacts:['ammo']}]);
  assert.throws(()=>installResonancePacts(battle,{catalog:malformed,state:{pieces:[]}}),/UNKNOWN_RESONANCE_PACT_EFFECT:ammo:invented_effect/);
});
