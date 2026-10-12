import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SP_DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';

const [{ getData }, { getResonanceCatalog }, { Battle }, { installResonanceEquipment, openingDamageFactor }, { installResonancePacts }] = await Promise.all([
  import('../../server/data.js'),
  import('../../server/modes/resonance/catalog.js'),
  import('../../server/sim/Battle.js'),
  import('../../server/sim/content/resonance/equipment.js'),
  import('../../server/sim/content/resonance/pacts.js'),
]);
const { performAttack } = await import('../../server/sim/ai.js');
const { elementIntake } = await import('../../server/sim/damage.js');
const { enemyRec, flatStage } = await import('../helpers/battleHarness.js');
const { COMPONENT_ICON_IDS } = await import('../../public/js/resonance/itemIconMap.js');
const data=getData();
const catalog=getResonanceCatalog(data,{environmentId:'origin_laterano',seed:420});
const nativeItems=JSON.parse(fs.readFileSync(`${process.env.SP_DATA_DIR}/items.json`,'utf8'));
const nativeById=new Map((Array.isArray(nativeItems)?nativeItems:Object.values(nativeItems)).map((row)=>[row.id,row]));
// operators whose own pacts never activate alone, so a one-unit battle shows equipment stats only
const solos=Object.values(catalog.operators).filter((op)=>op.pacts.every((id)=>Math.min(...catalog.pacts[id].thresholds)>=2));
const solo=solos[0],healer=solos.find((op)=>op.role==='healer'),melee=solos.find((op)=>op.position==='MELEE'&&op.role==='frontline');
const COMPONENTS=['blade','staff','bow','plate','cloak','belt','tear','crest'];

function makeBattle(operator,items,{config=catalog,party=[],skillHarness=false,skillCost=1,pacts=true}={}){
  const units=[{uid:'equipped',chessId:operator.id,skillIndex:operator.fixedSkillIndex??0,moduleId:'none',row:9,col:2,dir:'RIGHT',items},...party.map((row,index)=>({uid:`ally-${index}`,chessId:row.operator.id,skillIndex:row.operator.fixedSkillIndex??0,moduleId:'none',row:9,col:3+index,dir:'RIGHT',items:row.items??[]}))];
  const player={playerId:'resonance',units};
  const kits=skillHarness?Object.fromEntries([operator,...party.map((row)=>row.operator)].map((row)=>[row.id,()=>({skill:{id:'resonance-equipment-test-skill',kind:'instant',trigger:'SP_FULL',spCost:skillCost,initSp:0,spType:'none'}})])):undefined;
  const battle=new Battle({seed:420,kind:'normal',round:1,timeLimit:90,autoFinish:false,stage:flatStage({id:'equipment-test'}),data,players:[player],kits,content:'independent',recordEvents:false,flags:{startOpCooldown:0,dpInit:20,dpPerSec:1,dpMax:99}});
  battle.resonanceMetrics={triggers:Object.create(null)};battle.resonanceResults={growth:[],coins:[],forge:[]};
  const applied=installResonanceEquipment(battle,{catalog:config,state:{pieces:[]}});
  if(pacts)installResonancePacts(battle,{catalog:config,state:{pieces:[]}});
  return {battle,unit:battle.allyUnits[0],applied,player};
}
function advance(battle,seconds){const end=battle.time+seconds;while(battle.time+1e-9<end&&!battle.finished)battle.step();}
function cast(battle,unit){assert.equal(unit.skill?.activate?.('resonance-test',{free:true}),true,'the real SkillRuntime accepts the cast');advance(battle,.1);}
function spawnDummy(battle,pos=[9,10],overrides={}){return battle.spawnEnemy('resonance-test-enemy',{pos,def:enemyRec({key:'resonance-test-enemy',hp:1e9,atk:0,speed:0,rank:'NORMAL',...overrides})});}
const close=(actual,expected,message,eps=1e-6)=>assert.ok(Math.abs(actual-expected)<eps,`${message}: ${actual} vs ${expected}`);
const statusOn=(unit,status)=>unit.buffs.some((row)=>row.status===status);
const loss=(battle,source,target,dmg)=>{const before=target.hp;battle.dealDamage(source,target,{canDodge:false,...dmg});return before-target.hp;};

test('the 36 items are native 卫戍协议 equipment, or the four 养成材料 components, with their own name, art and two-component recipes',()=>{
  const items=Object.values(catalog.equipment).filter((item)=>item.kind==='component'||item.kind==='completed');
  assert.deepEqual(Object.values(catalog.equipment).filter((item)=>item.kind==='component').map((item)=>item.id),COMPONENTS);
  assert.equal(items.length,36);
  assert.equal(catalog.recipes.length,36,'28 completed recipes and eight 随身身份牌 recipes');
  const names=new Set();
  for(const item of items){
    if(COMPONENT_ICON_IDS.includes(item.id)){
      assert.equal(item.kind,'component');
      assert.equal(item.nativeItemId,undefined,`${item.id} is a 养成材料, not a native item`);
      assert.equal(item.iconId,undefined,`${item.id} carries no native art id`);
    }else{
      const native=nativeById.get(item.nativeItemId);
      assert.ok(native,`${item.id} names its native record`);
      assert.equal(item.name,native.name,`${item.id} keeps the native name`);
      assert.equal(item.iconId,native.iconId,`${item.id} keeps the native art`);
    }
    assert.ok(!names.has(item.name),`${item.name} is used once`);names.add(item.name);
  }
  for(const recipe of catalog.recipes.filter((row)=>catalog.equipment[row.resultId].kind==='completed')){
    const item=catalog.equipment[recipe.resultId];
    assert.ok(recipe.parts.every((part)=>part!=='crest'),`${item.name} is a two-component item`);
    assert.deepEqual(item.baseEffects,recipe.parts.map((part)=>catalog.equipment[part].effects[0]),`${item.name} carries both component stats`);
    assert.deepEqual(item.effects.slice(0,2),item.baseEffects);assert.ok(item.effects.length>2,`${item.name} adds its own stat or effect`);
    assert.equal(item.unique,true,`${item.name} is limited to one per operator`);
  }
  for(const recipe of catalog.recipes.filter((row)=>row.parts.includes('crest')))assert.equal(catalog.equipment[recipe.resultId].kind,'emblem');
});

test('stats use the native scale and the handwritten text states exactly the configured numbers',()=>{
  const statText=[['atkPct',/攻击力\+(\d+(?:\.\d+)?)%/],['defPct',/防御力\+(\d+(?:\.\d+)?)%/],['hpPct',/生命值\+(\d+(?:\.\d+)?)%/],['aspd',/攻击速度\+(\d+(?:\.\d+)?)/],
    ['res',/法术抗性\+(\d+(?:\.\d+)?)/],['sp',/技力自然回复速度\+(\d+(?:\.\d+)?)\/秒/],['initialSp',/初始技力\+(\d+(?:\.\d+)?)/]];
  for(const item of Object.values(catalog.equipment).filter((row)=>row.kind==='component'||row.kind==='completed')){
    const totals={};
    for(const effect of item.effects.filter((row)=>row.kind==='component_stat'||row.kind==='item_stat')){
      for(const key of Object.keys(effect.params))assert.ok(!['atk','def','hp','maxHp'].includes(key),`${item.name} has no flat ${key}`);
      for(const [key,value] of Object.entries(effect.params))totals[key]=Number(((totals[key]??0)+value).toFixed(4));
    }
    const statPart=item.description.split('；')[0];
    for(const [key,pattern] of statText){
      const match=statPart.match(pattern);
      assert.equal(match?Number(match[1]):undefined,totals[key],`${item.name} ${key} text matches its stats: ${item.description}`);
    }
    if(totals.resIgnorePct)assert.match(item.description,new RegExp(`攻击无视目标${totals.resIgnorePct}%法术抗性`));
    assert.doesNotMatch(item.description,/攻击力\+\d+(?!\d|%|\.)|防御力\+\d+(?!\d|%|\.)|生命值\+\d+(?!\d|%|\.)/,`${item.name} states no flat ATK/DEF/HP`);
  }
});

test('three items on one operator each apply their stats in the real Battle',()=>{
  const {battle,unit}=makeBattle(solo,['giantSlayer','lifeSpring','quietCape'],{skillHarness:true,skillCost:60});
  const base=unit.base;battle.start();
  assert.equal(unit.mem.resonanceEquipmentEffects.filter((row)=>row.kind==='component_stat').length,6,'three items contribute six component rows');
  close(unit.s.atk,base.atk*1.4,'铳骑之威 攻击力+40%');
  close(unit.s.maxHp,base.maxHp*1.45,'天师古鼎 生命值+45%');
  close(unit.s.res,Math.min(100,base.res+15),'激光发射器 法术抗性+15');
  close(unit.s.spRecovery,base.spRecovery+.15,'天师古鼎 keeps its 萨尔贡浓茶 component');
  close(unit.s.resIgnorePct,.25,'激光发射器 ignores 25% RES');
  assert.equal(unit.skill.sp,unit.skill.initSp+6,'技巧概要·卷1 initial SP after the native battle-start reset');
  assert.equal(battle.errorCount,0);
});

test('every component contributes its native-scale stat',()=>{
  const {battle,unit}=makeBattle(solo,['blade','plate','belt'],{skillHarness:true,skillCost:60});const base=unit.base;battle.start();
  close(unit.s.atk,base.atk*1.15,'维式重锤');close(unit.s.def,base.def*1.2,'坚守盾牌');close(unit.s.maxHp,base.maxHp*1.2,'糖');
  const other=makeBattle(solo,['bow','cloak','staff']);other.battle.start();
  close(other.unit.s.aspd,other.unit.base.aspd+15,'装置');close(other.unit.s.res,Math.min(100,other.unit.base.res+15),'固源岩');close(other.unit.s.spRecovery,other.unit.base.spRecovery+.15,'萨尔贡浓茶');
  const sp=makeBattle(solo,['azureTear'],{skillHarness:true,skillCost:60});sp.battle.start();
  assert.equal(sp.unit.skill.sp,sp.unit.skill.initSp+25,'黄沙罗盘 = two 技巧概要·卷1 + 13');
  assert.equal(battle.errorCount+other.battle.errorCount+sp.battle.errorCount,0);
});

test('炎国短刀 adds 5% ATK per skill activation up to 50%',()=>{
  const {battle,unit}=makeBattle(solo,['spellblade'],{skillHarness:true});const base=unit.base;battle.start();
  cast(battle,unit);close(unit.s.atk,base.atk*1.2,'one activation');
  for(let i=0;i<11;i++)cast(battle,unit);
  close(unit.s.atk,base.atk*1.65,'ten stacks cap at +50% on top of the 15% component');
  assert.equal(battle.errorCount,0);
});

test('坚固维式重锤 keeps the carrier at 1 HP for 8 seconds after the first lethal hit, then the window ends',()=>{
  const {battle,unit}=makeBattle(solo,['armorAxe']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.dealDamage(enemy,unit,{amount:1e7,type:'true',canDodge:false});
  assert.equal(unit.alive,true);assert.equal(unit.hp,1);
  advance(battle,7.5);battle.dealDamage(enemy,unit,{amount:1e7,type:'true',canDodge:false});
  assert.equal(unit.alive,true,'still inside the 8-second window');
  advance(battle,.7);battle.dealDamage(enemy,unit,{amount:1e7,type:'true',canDodge:false});
  assert.equal(unit.alive,false,'the window is spent once per battle');
  assert.equal(battle.errorCount,0);
});

test('M3茧甲 revives once with 30% HP',()=>{
  const {battle,unit}=makeBattle(solo,['deepSeaBelt']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.dealDamage(enemy,unit,{amount:1e8,type:'true',canDodge:false});
  assert.equal(unit.alive,true);close(unit.hp,unit.s.maxHp*.3,'revived HP');
  battle.dealDamage(enemy,unit,{amount:1e8,type:'true',canDodge:false});
  assert.equal(unit.alive,false,'one revive per battle');
  assert.equal(battle.errorCount,0);
});

test('休眠子裔 heals 2% max HP per attacked target',()=>{
  const {battle,unit}=makeBattle(solo,['vampBlade']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);unit.hp=unit.s.maxHp*.5;const before=unit.hp;
  performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);
  close(unit.hp-before,unit.s.maxHp*.02,'one target heals 2%');
  assert.equal(battle.errorCount,0);
});

test('天马之枪 and 天马之盔 work only as a set: true damage per damage instance and regeneration',()=>{
  const lance=makeBattle(solo,['titanArmor']),set=makeBattle(solo,['titanArmor','guardianPlate']);
  lance.battle.start();set.battle.start();
  const a=spawnDummy(lance.battle,[lance.unit.y,lance.unit.x+1]),b=spawnDummy(set.battle,[set.unit.y,set.unit.x+1]);
  assert.equal(loss(lance.battle,lance.unit,a,{amount:100,type:'phys'}),100,'the lance alone adds nothing');
  close(loss(set.battle,set.unit,b,{amount:100,type:'phys'}),100+set.unit.s.atk*.3,'with the helm every damage instance adds 30% ATK true damage');
  lance.unit.hp=lance.unit.s.maxHp*.5;set.unit.hp=set.unit.s.maxHp*.5;
  advance(lance.battle,1.05);advance(set.battle,1.05);
  close(lance.unit.hp,lance.unit.s.maxHp*.5,'no regeneration without the set');
  close(set.unit.hp,set.unit.s.maxHp*.53,'天马之盔 regenerates 3% per second with the lance');
  assert.equal(lance.battle.errorCount+set.battle.errorCount,0);
});

test('灼燃维式重锤 attacks add ATK-scaled 灼燃损伤; other damage does not',()=>{
  const {battle,unit}=makeBattle(solo,['duelistCrest']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.dealDamage(unit,enemy,{amount:50,type:'arts',canDodge:false});
  assert.equal(enemy.elem.burn,0,'non-attack damage carries no burn');
  battle.dealDamage(unit,enemy,{amount:50,type:'phys',isAttack:true,canDodge:false});
  close(enemy.elem.burn,unit.s.atk*.1*elementIntake(enemy),'an attack adds 10% ATK burn');
  assert.equal(battle.errorCount,0);
});

test('有限加速器 counts attacks and heals, +2 attack speed each up to +40',()=>{
  const ally=solos.find((op)=>op.id!==healer.id);
  const {battle,unit}=makeBattle(healer,['thunderRing'],{party:[{operator:ally}]});battle.start();
  const injured=battle.allyUnits.find((row)=>row.kind==='op'&&row!==unit);injured.hp=injured.s.maxHp*.5;
  const base=unit.base.aspd+15;
  performAttack(battle,unit,battle.effectiveProfile(unit),[injured]);
  close(unit.s.aspd,base+2,'a heal counts');
  for(let i=0;i<25;i++)performAttack(battle,unit,battle.effectiveProfile(unit),[injured]);
  close(unit.s.aspd,base+40,'capped at +40 (20 layers)');
  assert.equal(battle.errorCount,0);
});

test('战栗维式重锤 and 谢拉格不融冰 roll their chance per attacked target',()=>{
  const {battle,unit}=makeBattle(solo,['counterMirror','holyCloak']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.rng=()=>.5;performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);
  assert.equal(statusOn(enemy,'tremble')||statusOn(enemy,'cold'),false,'a 50% roll misses both');
  battle.rng=()=>0;performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);
  assert.ok(statusOn(enemy,'tremble'),'战栗');assert.ok(statusOn(enemy,'cold'),'寒冷');
  close(enemy.buffs.find((row)=>row.status==='tremble').timeLeft,2,'战栗 lasts 2 seconds',.05);
  close(enemy.buffs.find((row)=>row.status==='cold').timeLeft,1.5,'寒冷 lasts 1.5 seconds',.05);
  close(unit.s.atk,unit.base.atk*1.2,'战栗维式重锤 攻击力+20%');
  assert.equal(battle.errorCount,0);
});

test('奥术法阵 silences enemies hit by skills, once per target every 8 seconds',()=>{
  const {battle,unit}=makeBattle(solo,['arcaneMantle']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.dealDamage(unit,enemy,{amount:10,type:'arts',canDodge:false});
  assert.equal(statusOn(enemy,'silence'),false,'normal damage does not silence');
  battle.dealDamage(unit,enemy,{amount:10,type:'arts',isSkill:true,canDodge:false});
  assert.ok(statusOn(enemy,'silence'),'a skill hit removes special abilities');
  advance(battle,3.2);assert.equal(statusOn(enemy,'silence'),false,'for 3 seconds');
  battle.dealDamage(unit,enemy,{amount:10,type:'arts',isSkill:true,canDodge:false});
  assert.equal(statusOn(enemy,'silence'),false,'the same enemy waits 8 seconds');
  advance(battle,5);battle.dealDamage(unit,enemy,{amount:10,type:'arts',isSkill:true,canDodge:false});
  assert.ok(statusOn(enemy,'silence'),'after 8 seconds it applies again');
  assert.equal(battle.errorCount,0);
});

test('源石溶剂 drains 1% max HP per second as true damage',()=>{
  const {battle,unit}=makeBattle(solo,['archangelStaff']);battle.start();
  close(unit.s.atk,unit.base.atk*1.3,'攻击力+30%');
  const before=unit.hp;advance(battle,1.05);
  close(before-unit.hp,unit.s.maxHp*.01,'one second of drain');
  assert.equal(battle.errorCount,0);
});

test('防暴盾 reduces damage from units the blocking carrier does not block',()=>{
  const {battle,unit}=makeBattle(melee,['ironWing']);battle.start();
  const blocked=spawnDummy(battle,[unit.y,unit.x+1]),other=spawnDummy(battle,[unit.y,unit.x+3]);
  blocked.x=unit.x;blocked.y=unit.y;assert.equal(battle._checkBlock(blocked),true);assert.ok(unit.blocking.includes(blocked));
  assert.equal(loss(battle,blocked,unit,{amount:100,type:'true'}),100,'the blocked enemy deals full damage');
  close(loss(battle,other,unit,{amount:100,type:'true'}),60,'an unblocked enemy deals 40% less');
  assert.equal(battle.errorCount,0);
});

test('浓缩嗅盐 cancels stun and freeze only above 70% HP',()=>{
  const {battle,unit}=makeBattle(solo,['lightCloak']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.applyStatus(unit,'stun',{duration:2,source:enemy});battle.applyStatus(unit,'freeze',{duration:2,source:enemy});
  assert.equal(statusOn(unit,'stun')||statusOn(unit,'freeze'),false);
  unit.hp=unit.s.maxHp*.6;battle.applyStatus(unit,'stun',{duration:2,source:enemy});
  assert.ok(statusOn(unit,'stun'),'below the threshold the stun lands');
  assert.equal(battle.errorCount,0);
});

test('卡西米尔竞技旗 raises damage to 135% for 15 seconds after deployment, then decays over 15 seconds',()=>{
  const {battle,unit}=makeBattle(solo,['hurricane']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  close(loss(battle,unit,enemy,{amount:100,type:'true'}),135,'inside the first 15 seconds');
  advance(battle,22.5-battle.time+unit.deployedAt);
  close(loss(battle,unit,enemy,{amount:100,type:'true'}),100*openingDamageFactor({damagePercent:135,duration:15,decay:15},battle.time-unit.deployedAt),'halfway through the decay');
  assert.ok(openingDamageFactor({damagePercent:135,duration:15,decay:15},22.5)<1.35&&openingDamageFactor({damagePercent:135,duration:15,decay:15},22.5)>1);
  advance(battle,9);
  assert.equal(loss(battle,unit,enemy,{amount:100,type:'true'}),100,'back to normal after 30 seconds');
  assert.equal(battle.errorCount,0);
});

test('精准狙击镜 adds 30% damage against targets three or more tiles away',()=>{
  const {battle,unit}=makeBattle(solo,['quickCharger']);battle.start();
  const near=spawnDummy(battle,[unit.y,unit.x+1]),far=spawnDummy(battle,[unit.y,unit.x+3]);
  assert.equal(loss(battle,unit,near,{amount:100,type:'true'}),100);
  close(loss(battle,unit,far,{amount:100,type:'true'}),130,'3 tiles');
  assert.equal(battle.errorCount,0);
});

test('海沟实验体 removes 120 from every damage instance; 蜂鸣器 draws attacks and takes 10% less',()=>{
  const trench=makeBattle(solo,['thornArmor']);trench.battle.start();
  const a=spawnDummy(trench.battle,[trench.unit.y,trench.unit.x+1]);
  assert.equal(loss(trench.battle,a,trench.unit,{amount:500,type:'true'}),380);
  assert.equal(loss(trench.battle,a,trench.unit,{amount:100,type:'true'}),0,'a hit below the reduction deals nothing');
  const buzzer=makeBattle(solo,['golemArmor']);buzzer.battle.start();
  const b=spawnDummy(buzzer.battle,[buzzer.unit.y,buzzer.unit.x+1]);
  assert.equal(buzzer.unit.s.taunt,(buzzer.unit.base.tauntLevel??0)+1,'更容易受到攻击');
  close(loss(buzzer.battle,b,buzzer.unit,{amount:100,type:'true'}),90,'受到的伤害降低10%');
  assert.equal(trench.battle.errorCount+buzzer.battle.errorCount,0);
});

test('突袭手雷 stuns on attack within 10 seconds of deployment, once per target every 4 seconds',()=>{
  const {battle,unit}=makeBattle(solo,['shockShield']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  const attack=()=>performAttack(battle,unit,battle.effectiveProfile(unit),[enemy]);
  attack();assert.ok(statusOn(enemy,'stun'));close(enemy.buffs.find((row)=>row.status==='stun').timeLeft,1,'1 second stun',.05);
  advance(battle,1.1);attack();assert.equal(statusOn(enemy,'stun'),false,'per-target cooldown');
  advance(battle,3);attack();assert.ok(statusOn(enemy,'stun'),'after 4 seconds the target can be stunned again');
  advance(battle,10);attack();assert.equal(statusOn(enemy,'stun'),false,'only within 10 seconds of deployment');
  assert.equal(battle.errorCount,0);
});

test('伪装服 grants 5 seconds of 隐匿 on the first damage taken only',()=>{
  const {battle,unit}=makeBattle(solo,['redemptionCloak']);battle.start();
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.dealDamage(enemy,unit,{amount:10,type:'true',canDodge:false});
  assert.equal(unit.s.flags.stealth,true);
  advance(battle,5.1);assert.equal(!!unit.s.flags.stealth,false,'5 seconds');
  battle.dealDamage(enemy,unit,{amount:10,type:'true',canDodge:false});
  assert.equal(!!unit.s.flags.stealth,false,'only the first damage');
  assert.equal(battle.errorCount,0);
});

test('护盾无人机 grants a 12% 生命上限 barrier on deployment and refreshes it on each skill activation',()=>{
  const {battle,unit}=makeBattle(solo,['vitalEngine'],{skillHarness:true});battle.start();
  const key=`resonance:equipment:barrier:${unit.id}`;
  close(unit.findBuff(key)?.shield,unit.s.maxHp*.12,'deployment barrier');
  const enemy=spawnDummy(battle,[unit.y,unit.x+1]);
  battle.dealDamage(enemy,unit,{amount:unit.s.maxHp*.05,type:'true',canDodge:false});
  close(unit.findBuff(key)?.shield,unit.s.maxHp*.07,'the barrier absorbs damage');
  cast(battle,unit);
  close(unit.findBuff(key)?.shield,unit.s.maxHp*.12,'a skill activation refreshes it without stacking');
  cast(battle,unit);
  close(unit.findBuff(key)?.shield,unit.s.maxHp*.12,'never above 12%');
  assert.equal(battle.errorCount,0);
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
  const malformed={...catalog,equipment:{...catalog.equipment,rapidBlade:{...catalog.equipment.rapidBlade,effects:[{kind:'missing_effect',params:{}}]}}};
  const {battle}=makeBattle(solo,[],{config:catalog});
  battle.players[0].input.units[0].items=['rapidBlade'];
  assert.throws(()=>installResonanceEquipment(battle,{catalog:malformed,state:{pieces:[]}}),/UNKNOWN_RESONANCE_EQUIPMENT_EFFECT:rapidBlade:missing_effect/);
});

test('current-season saves keep old source-item ids as hidden aliases of the native items that replace them',()=>{
  const v3=getResonanceCatalog(data,{rulesVersion:3,seed:1});
  const expected={TFT_Item_UnstableConcoction:'vampBlade',TFT_Item_Morellonomicon:'duelistCrest',TFT_Item_LastWhisper:'quietCape',TFT_Item_FrozenHeart:'armorAxe',
    TFT_Item_GuinsoosRageblade:'thunderRing',TFT_Item_JeweledGauntlet:'spellblade',TFT_Item_Crownguard:'vitalEngine'};
  assert.deepEqual(v3.prototypeSourceGear.bySourceApiName,expected,'Crown rewards grant the native completed items');
  for(const row of v3.prototypeSourceGear.definitions){
    const alias=v3.equipment[row.id],native=v3.equipment[row.nativeItemId];
    assert.equal(alias.legacyAliasOf,row.nativeItemId);assert.equal(alias.grantAllowed,false);
    assert.equal(alias.name,native.name);assert.equal(alias.description,native.description);assert.deepEqual(alias.effects,native.effects);
  }
  const {battle,unit}=makeBattle(solo,['prototype_source_gear_crownguard'],{config:v3,pacts:false});battle.start();
  close(unit.findBuff(`resonance:equipment:barrier:${unit.id}`)?.shield,unit.s.maxHp*.12,'an old Crownguard acts as 护盾无人机');
  assert.ok(unit.mem.resonanceEquipmentEffects.every((row)=>row.itemId==='vitalEngine'),'alias rows resolve to the native item identity');
  assert.equal(battle.errorCount,0);
});
