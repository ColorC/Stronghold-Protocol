import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SP_DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';

const [{ getData }, { getResonanceCatalog }, { Battle }, { installResonanceEquipment }, { installResonancePacts }] = await Promise.all([
  import('../../server/data.js'),
  import('../../server/modes/resonance/catalog.js'),
  import('../../server/sim/Battle.js'),
  import('../../server/sim/content/resonance/equipment.js'),
  import('../../server/sim/content/resonance/pacts.js'),
]);
const { performAttack } = await import('../../server/sim/ai.js');
const { enemyRec, flatStage } = await import('../helpers/battleHarness.js');
const data=getData();
const catalog=getResonanceCatalog(data,{environmentId:'origin_laterano',seed:420});

function makeBattle(operator,items,{config=catalog,party=[],skillHarness=false,skillCost=1}={}){
  const units=[{uid:'equipped',chessId:operator.id,skillIndex:operator.fixedSkillIndex??0,moduleId:'none',row:9,col:2,dir:'RIGHT',items},...party.map((row,index)=>({uid:`ally-${index}`,chessId:row.operator.id,skillIndex:row.operator.fixedSkillIndex??0,moduleId:'none',row:9,col:3+index,dir:'RIGHT',items:[]}))];
  const player={playerId:'resonance',units};
  const kits=skillHarness?Object.fromEntries([operator,...party.map((row)=>row.operator)].map((row)=>[row.id,()=>({skill:{id:'resonance-equipment-test-skill',kind:'instant',trigger:'SP_FULL',spCost:skillCost,initSp:0,spType:'none'}})])):undefined;
  const battle=new Battle({seed:420,kind:'normal',round:1,timeLimit:60,autoFinish:false,stage:flatStage({id:'equipment-test'}),data,players:[player],kits,content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:20,dpPerSec:1,dpMax:99}});
  battle.resonanceMetrics={triggers:Object.create(null)};battle.resonanceResults={growth:[],coins:[],forge:[]};
  const applied=installResonanceEquipment(battle,{catalog:config,state:{pieces:[]}});
  installResonancePacts(battle,{catalog:config,state:{pieces:[]}});
  return {battle,unit:battle.allyUnits[0],applied,player};
}
function advance(battle,seconds){for(let i=0;i<Math.ceil(seconds/battle.dt)&&!battle.finished;i++)battle.step();}
function cast(battle,unit){assert.equal(unit.skill?.activate?.('resonance-test',{free:true}),true,'the real SkillRuntime accepts the cast');advance(battle,.1);}
function spawnDummy(battle,pos=[9,10],overrides={}){return battle.spawnEnemy('resonance-test-enemy',{pos,def:enemyRec({key:'resonance-test-enemy',hp:1e9,atk:0,speed:0,rank:'NORMAL',...overrides})});}

test('all equipment effects have explicit installer coverage and all recipe components remain stackable',()=>{
  assert.equal(Object.values(catalog.equipment).filter((item)=>item.kind==='component').length,8);
  assert.equal(catalog.recipes.length,36,'the full recipe book has 36 outputs, including eight transfer emblems');
  assert.equal(Object.values(catalog.equipment).filter((item)=>item.kind==='completed').length,28);
  assert.ok(Object.keys(catalog.equipment).filter((id)=>id.startsWith('transfer_')).length>=35,'all transferable pact emblems are present');
  for(const [id,item] of Object.entries(catalog.equipment))for(const effect of item.effects??[])assert.ok(effect.kind,`${id} effect is typed`);
});

test('real Battle applies duplicate component stats twice but installs a unique completed passive once',()=>{
  const operator=Object.values(catalog.operators)[0];
  const {battle,unit}=makeBattle(operator,['rapidBlade','rapidBlade']);
  const rows=unit.mem.resonanceEquipmentEffects;
  assert.equal(rows.filter((row)=>row.kind==='fifth_strike').length,1);
  assert.equal(rows.filter((row)=>row.kind==='component_stat').length,4);
  const beforeAtk=unit.base.atk,beforeAspd=unit.base.aspd;
  battle.start();
  assert.equal(unit.base.atk,beforeAtk,'equipment does not rewrite the source base record');
  assert.equal(unit.s.atk,beforeAtk+30,'each item contributes its component attributes');
  assert.equal(unit.s.aspd,beforeAspd+20,'duplicate bow components stack');
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);assert.ok(enemy);
  const before=enemy.hp;
  for(let index=0;index<4;index++)performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);
  assert.equal(unit.mem.gearFifth,4,'four completed core attacks remain below the configured strike threshold');
  performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);
  assert.equal(unit.mem.gearFifth,5,'the fifth completed core attack advances the actual Battle attack hook');
  assert.ok(enemy.hp<before,'the fifth native Battle attack applies configured damage');
  assert.equal(battle.errorCount,0);
});

test('each Tear contributes its initial SP after the native battle-start skill reset',()=>{
  const operator=Object.values(catalog.operators)[0];
  const single=makeBattle(operator,['tear']),double=makeBattle(operator,['tear','tear']);
  single.battle.start();double.battle.start();
  assert.equal(single.unit.skill.sp,single.unit.skill.initSp+5);
  assert.equal(double.unit.skill.sp,double.unit.skill.initSp+10,'two Tears retain both five-SP component bonuses after native skill initialization');
});

test('transfer emblems add the configured pact before roster thresholds, while identity transfer remains an explicit pending choice',()=>{
  const laterano=Object.values(catalog.operators).find((row)=>(row.pacts??[]).includes('laterano'));
  const other=Object.values(catalog.operators).find((row)=>(row.pacts??[]).includes('yan')&&!(row.pacts??[]).includes('laterano'));
  assert.ok(laterano&&other);
  const transferred=makeBattle(other,['transfer_laterano'],{party:[{operator:laterano}]});
  assert.ok(transferred.unit.mem.resonancePacts.has('laterano'));
  assert.equal(transferred.battle.resonancePactCache.get('laterano').count,2,'the transfer adds one distinct eligible identity before pact thresholds resolve');
  const selected=makeBattle(other,['doubleCrest']);
  assert.equal(selected.unit.mem.resonanceIdentityChoicePending,true,'the item exposes the pending identity choice without silently assigning a pact');
  assert.equal(selected.unit.mem.resonancePacts,undefined);
});

test('equipment with an unknown effect kind fails explicitly',()=>{
  const operator=Object.values(catalog.operators)[0];
  const malformed={...catalog,equipment:{...catalog.equipment,rapidBlade:{...catalog.equipment.rapidBlade,effects:[{kind:'missing_effect',params:{}}]}}};
  const {battle}=makeBattle(operator,[],{config:catalog});
  const player=battle.players[0].input;
  player.units[0].items=['rapidBlade'];
  assert.throws(()=>installResonanceEquipment(battle,{catalog:malformed,state:{pieces:[]}}),/UNKNOWN_RESONANCE_EQUIPMENT_EFFECT:rapidBlade:missing_effect/);
});

test('received hits stack Titan Armor, Arcane Mantle marks enemies, and lifesteal only counts physical or arts damage',()=>{
  const operator=Object.values(catalog.operators)[0];
  const {battle,unit}=makeBattle(operator,['titanArmor','arcaneMantle','vampBlade'],{skillHarness:true});
  battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);assert.ok(enemy);
  const attacker=battle.enemies[0];unit.hp=Math.floor(unit.s.maxHp/2);
  battle.dealDamage(attacker,unit,{amount:10,type:'phys',canDodge:false});
  assert.equal(unit.mem.gearHitStacks,1,'incoming enemy damage, rather than outgoing damage, increments stacks');
  const beforeHp=unit.hp;
  battle.dealDamage(unit,enemy,{amount:30,type:'true',canDodge:false});
  assert.equal(unit.hp,beforeHp,'true damage does not trigger physical/arts lifesteal');
  const dealt=battle.dealDamage(unit,enemy,{amount:30,type:'phys',canDodge:false});
  assert.ok(Math.abs(unit.hp-(beforeHp+dealt*.1))<1e-8,'lifesteal uses actual physical HP damage, after mitigation and overkill clamping');
  enemy.x=unit.x+1;enemy.y=unit.y;enemy.hp=enemy.s.maxHp;
  cast(battle,unit);
  assert.ok(enemy.mem.resonanceEquipmentSpellVulnUntil>battle.time,'the completed runtime skill marks its actual nearby target');
  enemy.s.res=0;enemy.base.res=0;enemy.hp=enemy.s.maxHp;
  const artsDamage=battle.dealDamage(unit,enemy,{amount:30,type:'arts',canDodge:false});
  assert.ok(artsDamage>0,'the marked target receives a real arts hit through Battle damage resolution');
  const unmarked=spawnDummy(battle,[unit.y,unit.x+2]);assert.ok(unmarked);
  const noVuln=battle.dealDamage(unit,unmarked,{amount:30,type:'arts',canDodge:false});
  assert.ok(noVuln<=30,'the marker does not apply to unrelated unmarked enemies');
  assert.equal(battle.errorCount,0);
});

test('periodic healing restores up to three injured allies once without symbiosis recursion',()=>{
  const operators=Object.values(catalog.operators).slice(0,4);const {battle,unit}=makeBattle(operators[0],['lifeSpring'],{party:operators.slice(1).map((operator)=>({operator}))});
  battle.start();const allies=battle.allyUnits.filter((row)=>row.kind==='op');assert.equal(allies.length,4);for(const ally of allies)ally.hp=ally.s.maxHp-100;
  const healEvents=[];battle.on('healed',(event)=>healEvents.push(event));
  advance(battle,5.2);
  const healed=allies.filter((ally)=>ally.hp>ally.s.maxHp-100);assert.equal(healed.length,3,'the data-default count is three, and the lowest-health tie resolves deterministically');
  assert.ok(healed.every((ally)=>Math.abs(ally.hp-(ally.s.maxHp-100+Math.min(100,unit.s.atk*.8)))<1e-8),'each target receives the configured 80%-ATK heal, clamped by missing HP');
  assert.equal(healEvents.length,3);assert.ok(healEvents.every((event)=>event.opts?.noSymbiosisRecursion===true),'noSymbiosisRecursion is carried through each real heal event');
  assert.equal(battle.errorCount,0);
});

test('holy cloak adds its configured resistance and cleanses cold/freeze on its five-second received-hit cooldown',()=>{
  const operator=Object.values(catalog.operators)[0];const {battle,unit}=makeBattle(operator,['holyCloak']);
  battle.start();assert.equal(unit.s.res,unit.base.res+28,'two cloak components and the effect add their full resistance');
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);assert.ok(enemy);
  battle.applyStatus(unit,'cold',{duration:20,source:enemy});battle.applyStatus(unit,'freeze',{duration:20,source:enemy});
  battle.dealDamage(enemy,unit,{amount:1,type:'phys',canDodge:false,isAttack:true});
  assert.equal(unit.buffs.some((row)=>row.status==='cold'||row.status==='freeze'),false,'the first qualifying hit removes both configured status keys');
  battle.applyStatus(unit,'cold',{duration:20,source:enemy});battle.applyStatus(unit,'freeze',{duration:20,source:enemy});
  advance(battle,4.9);battle.dealDamage(enemy,unit,{amount:1,type:'phys',canDodge:false,isAttack:true});
  assert.ok(unit.buffs.some((row)=>row.status==='cold')&&unit.buffs.some((row)=>row.status==='freeze'),'the cleanse does not refresh before five seconds');
  advance(battle,.1);battle.dealDamage(enemy,unit,{amount:1,type:'phys',canDodge:false,isAttack:true});
  assert.equal(unit.buffs.some((row)=>row.status==='cold'||row.status==='freeze'),false,'the next cooldown boundary cleanses again');
  assert.equal(battle.errorCount,0);
});

test('counter, thorns, and hit-SP effects resolve from one genuine enemy damage action',()=>{
  const operator=Object.values(catalog.operators).find((row)=>data.chess[row.sourceChessId]?.skill);assert.ok(operator);
  const {battle,unit}=makeBattle(operator,['counterMirror','thornArmor','vitalEngine'],{skillHarness:true});battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);assert.ok(enemy);const before=enemy.hp;
  battle.dealDamage(enemy,unit,{amount:20,type:'phys',canDodge:false,isAttack:true});
  assert.ok(enemy.hp<before,'counter-magic and thorns return actual Battle damage to the attacker');
  assert.equal(unit.skill.sp,1,'the incoming hit grants the configured hit-SP through the SkillRuntime');
  assert.equal(battle.errorCount,0);
});

test('death barrier and death save prevent the first lethal Battle hit once per holder',()=>{
  const operator=Object.values(catalog.operators)[0];
  const barrier=makeBattle(operator,['guardianPlate']);barrier.battle.start();const enemy=spawnDummy(barrier.battle,[barrier.unit.y,barrier.unit.x+1]);assert.ok(enemy);
  barrier.unit.hp=1;barrier.battle.dealDamage(enemy,barrier.unit,{amount:1000,type:'true',canDodge:false});
  assert.equal(barrier.unit.alive,true);assert.ok(barrier.unit.buffs.some((row)=>row.key==='resonance:equipment:death-barrier:'+barrier.unit.id&&row.shield>0));
  barrier.battle.dealDamage(enemy,barrier.unit,{amount:1000,type:'true',canDodge:false});assert.equal(barrier.unit.alive,false,'a consumed unique barrier cannot prevent a second lethal hit');
  const saved=makeBattle(operator,['ironWing']);saved.battle.start();const attacker=spawnDummy(saved.battle,[saved.unit.y,saved.unit.x+1]);saved.unit.hp=1;
  saved.battle.dealDamage(attacker,saved.unit,{amount:1000,type:'true',canDodge:false});
  assert.equal(saved.unit.alive,true);assert.equal(saved.unit.s.flags.invulnerable,true,'death-save grants its configured temporary invulnerability');
  assert.equal(saved.battle.errorCount,0);assert.equal(barrier.battle.errorCount,0);
});

test('cast stun, first-cast haste, cast-stack, and two skill-end SP effects use the SkillRuntime lifecycle',()=>{
  const operator=Object.values(catalog.operators).find((row)=>data.chess[row.sourceChessId]?.skill);assert.ok(operator);
  const {battle,unit}=makeBattle(operator,['shockShield','duelistCrest','quietCape','azureTear','archangelStaff'],{skillHarness:true,skillCost:40});battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);assert.ok(enemy);
  assert.equal(unit.skill.sp,30,'initial SP from each equipped source contributes at battle start');
  const aspd=unit.s.aspd;cast(battle,unit);
  assert.ok(enemy.buffs.some((row)=>row.status==='stun'),'the skill-start hook applies the configured nearest-target stun');
  assert.ok(unit.s.aspd>aspd,'first-cast haste applies its temporary attack-speed buff');
  assert.equal(unit.skill.sp,39,'cast-sp and skill-sp both grant their configured SP after the actual skill end');
  const stackedAttack=unit.s.atk;cast(battle,unit);assert.ok(unit.s.atk>stackedAttack,'each actual cast updates the persistent configured cast-stack attack bonus');
  assert.equal(battle.errorCount,0);
});

test('skill damage equipment changes only actual skill damage resolved by Battle',()=>{
  const operator=Object.values(catalog.operators)[0];
  const equipped=makeBattle(operator,['resonanceStaff']),control=makeBattle(operator,[]);
  equipped.battle.start();control.battle.start();
  const targetA=spawnDummy(equipped.battle,[equipped.unit.y,equipped.unit.x+1]);
  const targetB=spawnDummy(control.battle,[control.unit.y,control.unit.x+1]);
  const skillDamage=equipped.battle.dealDamage(equipped.unit,targetA,{amount:100,type:'arts',isSkill:true,canDodge:false});
  const normalDamage=control.battle.dealDamage(control.unit,targetB,{amount:100,type:'arts',isSkill:false,canDodge:false});
  assert.ok(skillDamage>normalDamage,'skill_damage raises the damage hook only when Battle marks the hit as a skill');
  assert.equal(equipped.battle.errorCount,0);assert.equal(control.battle.errorCount,0);
});

test('armor penetration, evasion, regeneration, per-attack speed, and attack-SP effects use live unit state',()=>{
  const operator=Object.values(catalog.operators).find((row)=>data.chess[row.sourceChessId]?.skill);assert.ok(operator);
  const {battle,unit}=makeBattle(operator,['armorAxe','lightCloak','deepSeaBelt','berserkBow','quickCharger'],{skillHarness:true,skillCost:40});battle.start();
  assert.equal(unit.s.defIgnorePct,.25,'armor-axe penetration enters the actual damage profile');
  assert.equal(unit.s.dodgePhys,.15);assert.equal(unit.s.dodgeArts,.15,'light-cloak installs both configured evasion chances');
  assert.ok(unit.s.maxHp>unit.base.maxHp,'regeneration gear applies its maximum-HP increase');
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);assert.ok(enemy);enemy.s.def=0;enemy.base.def=0;
  const initialSp=unit.skill.sp,initialAspd=unit.s.aspd;
  performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);
  assert.equal(unit.skill.sp,initialSp+2,'attack-SP obeys its configured two-gain same-second cap');
  assert.ok(unit.s.aspd>=initialAspd+6,'attack-stack gains ASPD through actual attack hooks');
  unit.hp=unit.s.maxHp-100;advance(battle,1.1);
  assert.ok(unit.hp>unit.s.maxHp-100,'regeneration heals during real Battle ticks');
  assert.equal(battle.errorCount,0);
});

test('Golem Armor scales defense from the real native blocking list and respects its configured stack cap',()=>{
  const operator=Object.values(catalog.operators)[0];const {battle,unit}=makeBattle(operator,['golemArmor']);battle.start();
  const enemies=[1,2,3,4].map((index)=>spawnDummy(battle,[unit.y,unit.x+index]));
  battle.addBuff(unit,{key:'test-block-cap',mods:{blockCnt:4}});
  const def=unit.s.def,res=unit.s.res;
  for(const enemy of enemies){enemy.x=unit.x;enemy.y=unit.y;assert.equal(battle._checkBlock(enemy),true,'the native block resolver assigns the overlapping enemy');}
  advance(battle,.1);
  assert.equal(unit.blocking.length,4,'Battle owns all four block references');
  assert.equal(unit.s.def,def+60,'the native blocked hook caps defense at three stacks');
  assert.equal(unit.s.res,res+12,'the native blocked hook caps resistance at the same three stacks');
  assert.equal(battle.errorCount,0);
});

test('chain and splash attacks use core attack targets while giant-slayer and shred modify actual damage',()=>{
  const operator=Object.values(catalog.operators)[0];
  const {battle,unit}=makeBattle(operator,['thunderRing','hurricane','giantSlayer','spellblade']);battle.start();
  const primary=spawnDummy(battle,[unit.y,unit.x+1],{res:50}),secondary=spawnDummy(battle,[unit.y,unit.x+2]);assert.ok(primary&&secondary);
  secondary.s.res=0;secondary.base.res=0;
  const secondaryHp=secondary.hp;
  for(let index=0;index<2;index++)performAttack(battle,unit,battle.effectiveProfile(unit),[primary]);
  assert.equal(secondary.hp,secondaryHp,'chain/splash effects wait for their configured attack intervals');
  performAttack(battle,unit,battle.effectiveProfile(unit),[primary]);
  assert.ok(secondary.hp<secondaryHp,'the third core attack triggers the configured splash strike');
  const afterSplash=secondary.hp;
  performAttack(battle,unit,battle.effectiveProfile(unit),[primary]);
  assert.ok(secondary.hp<afterSplash,'the fourth core attack triggers the configured chain-lightning interval');
  const beforeShred=primary.s.res;
  const baseline=unit.mem.resonanceEquipmentEffects;
  unit.mem.resonanceEquipmentEffects=baseline.filter((row)=>row.kind!=='giant_slayer');
  const without= battle.dealDamage(unit,primary,{amount:unit.s.atk,type:'phys',canDodge:false});
  unit.mem.resonanceEquipmentEffects=baseline;
  const withGiant=battle.dealDamage(unit,primary,{amount:unit.s.atk,type:'phys',canDodge:false});
  assert.ok(withGiant>without,'giant-slayer increases damage against a target whose max HP exceeds its threshold');
  assert.ok(primary.s.res<beforeShred,'spellblade applies a real resistance-reduction buff after damage');
  assert.equal(battle.errorCount,0);
});
