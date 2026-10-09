import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { loadData } from '../../server/data.js';
import { toDataSource } from '../../server/sim/simdata.js';
import { KITS, skillSpecSource } from '../../server/sim/content/index.js';
import { meleeOnHighGround } from '../../shared/highGround.js';
import { compileResonancePlayerText } from '../../shared/resonance/player-text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL_ROOT = path.dirname(path.resolve(ROOT,execFileSync('git',['-C',ROOT,'rev-parse','--git-common-dir'],{encoding:'utf8'}).trim()));
const DATA_DIR = process.env.SP_DATA_DIR
  ? path.resolve(process.env.SP_DATA_DIR)
  : path.join(CANONICAL_ROOT, 'data');
const WORKTABLE = path.join(ROOT, 'docs/resonance/roster-worktable.json');
const OUT = path.join(ROOT, 'shared/resonance/catalog.js');
const DOC = path.join(ROOT, 'docs/resonance/catalog.md');
const SKILL_TABLE = process.env.SP_RESONANCE_SKILL_TABLE
  ? path.resolve(process.env.SP_RESONANCE_SKILL_TABLE)
  : path.join(CANONICAL_ROOT, 'data/resonance-reference/arknights/skill-table.json.gz');
const STAGING=path.join(CANONICAL_ROOT,'.omni/tmp/resonance');
function publishGenerated(target,content) {
  fs.mkdirSync(STAGING,{recursive:true});fs.mkdirSync(path.dirname(target),{recursive:true});
  const pending=path.join(STAGING,`${path.basename(target)}.pending`);
  fs.writeFileSync(pending,content,'utf8');fs.renameSync(pending,target);
}
const sourceCommit = '4ed1ad32ec10da15c23f9d7939dade603950759b';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (value) => structuredClone(value);
const work = readJson(WORKTABLE);
const canonicalData = loadData(DATA_DIR, { log: { warn() {}, error() {} } });
const chess = canonicalData.chess;
const nativeSource = toDataSource(canonicalData);
if (work.sourceCommit !== sourceCommit || work.operators?.length !== 154) throw new Error('roster worktable source/coverage mismatch');

const ids = ['aegir','laterano','kjerag','yan','victoria','columbia','kazimierz','siracusa','rhodes','lungmen','sargon','leithania','iberia','higashi','ursus','bolivar','rim','babel','sami','ammo','combo','control','creation','symbiosis','logistics','redeploy','flight','arts','breaker','burn','necrosis','holyGun','yela','sui','crown'];
const pactNames = ['阿戈尔','拉特兰','谢拉格','炎国','维多利亚','哥伦比亚','卡西米尔','叙拉古','罗德岛','龙门','萨尔贡','莱塔尼亚','伊比利亚','东','乌萨斯','玻利瓦尔','雷姆必拓','巴别塔','萨米','弹药','连击','控制','造物','共生','后勤','再部署','飞行','术式','破阵','灼燃','凋亡','圣枪','耶拉之息','岁','王冠'];
const thresholds = [[2,4,6,8],[2,4,6,8],[2,4,7],[3,5,7,10],[2,4,6,9],[2,4,6,10],[2,4,6,9],[2,4,6,8],[2,4,6],[2,4,6],[2,4,6],[2,3,5],[2,3,4],[2,3,4],[2,3],[2],[2],[2],[1],[2,4,6],[2,4,6],[2,4,6],[2,4,6],[2,4,6],[2,4,6],[2,3,5],[1,2,3],[2,4,6],[2,4,6],[2,3,4],[2,3,4],[1],[1],[1,2,3],[1]];
const pactDescriptions = [
  '生命、恢复、近战阻挡与生命转攻击组成反击循环；受击反击有个人冷却且不递归。', '拉特兰成员攻击可呼叫空袭；技能弹药真实消耗推进下一击弹药，八人无人机支援。', '谢拉格成员按普攻次数为目标留下短暂标记，友方首次命中追加物理伤害；七人时第三名友方响应后全体谢拉格成员集火。', '成员施法互相回技力，按全队施法次数发动各自就近合击；十人天师阵持续攻击。', '提高成员攻击；按全队攻击次数由最高攻击者向同一目标发射对空重炮，九人留下火墙。', '强化召唤物并周期性补充机械无人机；十人首次死亡造物可在空位重构。', '成员攻击穿甲并周期造成真实伤害；九人技能落下持续真实伤害耀阳。', '对低生命敌人增伤；累计真实伤害触发个人技力与强化下一击，八人狼影追击。', '成员首次施法前减伤，施法后恢复生命并获得短时攻速。', '前排击倒为全队回技力；获胜取得金币，六人警戒炮弹支援。', '周期恢复最低生命成员并在其附近生成减速流沙。', '提高法术伤害；周期施法留下可见音域，五人音域沉默敌人。', '首次阻挡获得一次性屏障，破盾时造成范围法术伤害。', '部署获得限时闪避；成员退出后为最近队友补技力，四人部署攻击真实伤害。', '相邻单位获得防御，结算时存活成员无论胜负获得有上限的个人生命成长。', '对受控敌人增伤，胜利后两名成员获得有限个人攻击成长。', '技能行动积累锻造进度，满额后从基础装备中选择一件。', '成员首次退出时补充全队技力，胜利后随机存活成员获得有限攻击成长。', '对寒冷或冻结目标增伤；首次施法恢复全队生命。', '真实弹药消耗有概率返还技力，弹药技能最后一发获得额外伤害。', '连续攻击积累攻速，第六次攻击追加伤害。', '首次施加控制造成额外伤害并延长控制时间，保留领袖抗控规则。', '造物攻击补充主人技力，主人施法强化并治疗自己的造物。', '有效治疗转为限量屏障，破盾后下一击强化。', '产生部署费用时恢复全队技力与生命；部署费用有独立上限。', '降低再部署时间；首次返场获得治疗与范围伤害。', '腾空期间减伤并加速，技能结束俯冲造成范围伤害。', '提高自然技力与法术穿透；每第二次技能追加范围法术伤害。', '普攻穿甲并对阻挡敌增伤，首次击倒精英获得短时攻速。', '攻击附带灼燃，爆发可溅射但不会继续传播。', '提高凋亡伤害，首次爆发补充技力并造成限时持续伤害。', '拉特兰攻击有独立概率呼叫范围弹药空袭；新约能天使技能投放十五枚随机弹药。', '铺设全地图雪地，寒冷目标提供技力或攻击增益；三星固定技能质变。', '岁成员首次施法获得全队屏障；技能计数召唤唯一可见岁影。', '队友施法积累魔王下一次技能伤害，整场层数封顶。',
];
const pacts = Object.fromEntries(ids.map((id,i)=>[id,{id,name:pactNames[i],thresholds:thresholds[i],levels:thresholds[i].map((threshold,level)=>({threshold,effects:[],description:pactDescriptions[i]}))}]));
const E=(kind,params)=>({kind,params});
const pactStats={aegir:[['hp','maxHp','percent']],laterano:[['aspd','aspd','add']],victoria:[['atk','atk','percent']],leithania:[['arts','artsDamage','percent']]};
function profiles(id, kind, rows, extra={}) { const p=pacts[id]; p.levels.forEach((x,i)=>{const tierExtra=Object.fromEntries(Object.entries(extra).map(([key,value])=>[key,Array.isArray(value)&&value.length===p.levels.length&&value.every(Number.isFinite)?value[i]:value]));const params={...tierExtra,...rows[i]};const effects=[];for(const [key,stat,mode] of pactStats[id]??[]){if(params[key]!==undefined){effects.push(E('stat',{stat,mode,value:params[key]}));delete params[key];}}effects.push(E(kind,params));x.effects=effects;}); }
profiles('aegir','aegir_cycle',[{hp:25,regen:1,atkFromHp:2,retaliation:2.5,block:0,cd:2},{hp:45,regen:1.5,atkFromHp:3,retaliation:4,block:0,cd:1.5},{hp:70,regen:2,atkFromHp:4,retaliation:6,block:1,cd:1},{hp:110,regen:3,atkFromHp:6,retaliation:10,block:1,cd:.8}],{retaliationRadius:1.5,damageType:'arts'});
profiles('laterano','laterano_ammo',[{aspd:10,skillAmmo:2,ammoSpend:6,bonus:20},{aspd:20,skillAmmo:4,ammoSpend:5,bonus:35},{aspd:35,skillAmmo:6,ammoSpend:4,bonus:55},{aspd:55,skillAmmo:10,ammoSpend:3,bonus:90}],{droneAt:8,droneInterval:2,droneShots:3,droneDamage:180,antiAir:true});
profiles('kjerag','kjerag_coordination',[{attackEvery:5,responseDamage:80},{attackEvery:4,responseDamage:140},{attackEvery:3,responseDamage:220}],{markDuration:6,markCooldown:6,crossfireAt:7,crossfireResponders:3,crossfireDamage:100});
profiles('yan','yan_combo',[{teamSp:1,comboEvery:5,comboDamage:100},{teamSp:2,comboEvery:4,comboDamage:160},{teamSp:3,comboEvery:3,comboDamage:240},{teamSp:5,comboEvery:2,comboDamage:400}],{receiverCooldown:2,formationAt:10,formationInterval:2,formationDamage:200});
profiles('victoria','victoria_artillery',[{atk:15,shots:20,damage:180},{atk:25,shots:16,damage:250},{atk:40,shots:12,damage:350},{atk:65,shots:8,damage:600}],{radius:1.5,antiAir:true,firewallAt:9,firewallDps:80,firewallDuration:4});
profiles('columbia','columbia_construct',[{hp:20,atk:15,interval:12,constructAtk:35},{hp:35,atk:30,interval:10,constructAtk:45},{hp:55,atk:50,interval:8,constructAtk:60},{hp:100,atk:100,interval:6,constructAtk:90}],{constructDuration:8,maxConstructs:2,rebuildAt:10});
profiles('kazimierz','kazimierz_true_damage',[{pierce:15,attackEvery:3,trueDamage:25},{pierce:25,attackEvery:3,trueDamage:45},{pierce:40,attackEvery:3,trueDamage:75},{pierce:65,attackEvery:3,trueDamage:140}],{solarAt:9,solarDuration:2,solarDps:100,solarRadius:1.5,solarCooldown:4});
profiles('siracusa','siracusa_execute',[{executeBelow:40,executeBonus:15,damageCycle:4000,sp:3,nextHit:60},{executeBelow:40,executeBonus:25,damageCycle:3500,sp:4,nextHit:100},{executeBelow:40,executeBonus:40,damageCycle:3000,sp:5,nextHit:160},{executeBelow:40,executeBonus:70,damageCycle:2000,sp:8,nextHit:300}],{personalCooldown:2,wolfAt:8,wolfInterval:20,wolfDamage:800,bossNoExecute:true});
profiles('rhodes','rhodes_first_cast',[{mitigation:10,heal:20,aspd:15},{mitigation:20,heal:30,aspd:25},{mitigation:30,heal:40,aspd:40}],{duration:10,oncePerOperator:true});
profiles('lungmen','lungmen_reward',[{killSp:.5,victoryGold:1},{killSp:1,victoryGold:2},{killSp:1.5,victoryGold:3}],{teamSpCap:[3,5,8],goldOncePerNode:true,artilleryEvery:4,artilleryDamage:200,artilleryRadius:2});
profiles('sargon','sargon_sand',[{interval:12,heal:15,slow:25,dps:30},{interval:10,heal:20,slow:35,dps:50},{interval:8,heal:30,slow:50,dps:90}],{areaRadius:1.5,duration:4});
profiles('leithania','leithania_sound',[{arts:15,castEvery:3,dps:40},{arts:25,castEvery:3,dps:70},{arts:45,castEvery:3,dps:120}],{areaDuration:6,maxAreas:3,silenceAt:5,silenceInterval:2,silenceDuration:1});
profiles('iberia','iberia_barrier',[{barrier:20,breakDamage:120},{barrier:30,breakDamage:180},{barrier:45,breakDamage:280}],{radius:2,firstBlockOnly:true,antiAir:true});
profiles('higashi','higashi_redeploy',[{stealthSeconds:8,dodge:25,returnSp:15},{stealthSeconds:10,dodge:35,returnSp:25},{stealthSeconds:14,dodge:50,returnSp:40}],{returnLimit:2,deployTrueDamageAt:4,deployTrueDamage:80});
profiles('ursus','ursus_adjacency',[{adjacentDef:80,victoryHp:25},{adjacentDef:150,victoryHp:50}],{personalGrowthCap:[250,500]});
profiles('bolivar','bolivar_slow',[{controlledDamage:25,victoryAtk:10}],{controlled:['slow','cold','bind'],growthCap:100});
profiles('rim','rim_forge',[{skillCount:5,choiceCount:1}],{nodeLimit:1});
profiles('babel','babel_exit',[{exitSp:5,victoryAtk:12}],{growthCap:120});
profiles('sami','sami_cold',[{coldTargetBonus:20,firstCastHeal:10}],{healPercentMaxHp:true});
profiles('ammo','ammo_last_round',[{refundChance:20,lastDamage:80},{refundChance:35,lastDamage:130},{refundChance:50,lastDamage:220}],{refundSp:0.5,noCrossRefund:true});
profiles('combo','combo_sixth',[{aspdPerAttack:2,speedCap:20,damage:40},{aspdPerAttack:3,speedCap:35,damage:70},{aspdPerAttack:4,speedCap:55,damage:120}],{every:6,otherTargetAt:6});
profiles('control','control_first',[{damage:40,durationBonus:10},{damage:75,durationBonus:20},{damage:130,durationBonus:30}],{sameTargetCooldown:3,respectBossResistance:true});
profiles('creation','creation_construct',[{ownerSp:.25,heal:15,aspd:15},{ownerSp:.4,heal:25,aspd:25},{ownerSp:.6,heal:40,aspd:40}],{ownerSpCap:[1,2,3],duration:6});
profiles('symbiosis','symbiosis_barrier',[{healToShield:15,barrierCap:15,breakBonus:30},{healToShield:25,barrierCap:25,breakBonus:50},{healToShield:40,barrierCap:40,breakBonus:90}],{targetCooldown:2,breakOnce:true});
profiles('logistics','logistics_dp',[{startingDp:10,per10DpSp:2,heal:3},{startingDp:20,per10DpSp:3,heal:5},{startingDp:35,per10DpSp:5,heal:8}],{teamCooldown:2,baseDp:20,dpPerSecond:1,dpCap:99});
profiles('redeploy','redeploy_return',[{timeMultiplier:.8,heal:20,damage:100},{timeMultiplier:.65,heal:35,damage:180},{timeMultiplier:.4,heal:60,damage:320}],{returnLimit:2,damageType:'arts'});
profiles('flight','flight_dive',[{mitigation:10,aspd:15,dive:60},{mitigation:20,aspd:25,dive:120},{mitigation:35,aspd:45,dive:240}],{radius:1.5,antiAir:true});
profiles('arts','arts_cycle',[{sp:.2,resPen:10,damage:60},{sp:.4,resPen:18,damage:110},{sp:.7,resPen:30,damage:200}],{every:2,targetCount:3});
profiles('breaker','breaker_front',[{defPen:10,blockedBonus:15,eliteAspd:20},{defPen:20,blockedBonus:25,eliteAspd:30},{defPen:35,blockedBonus:40,eliteAspd:50}],{duration:8,eliteOnce:true});
profiles('burn','burn_spread',[{burn:10,burst:30},{burn:18,burst:60},{burn:30,burst:100}],{targetCooldown:3,noPropagation:true});
profiles('necrosis','necrosis_burst',[{bonus:20,firstBurstSp:3,dps:50},{bonus:40,firstBurstSp:6,dps:90},{bonus:70,firstBurstSp:10,dps:150}],{duration:5,noSameSourceStack:true});
profiles('holyGun','holy_gun',[{byStar:{1:{chance:15,damage:60,cap:100,factor:.005,radius:1.5},2:{chance:25,damage:100,cap:150,factor:.008,radius:1.5},3:{chance:100,damage:500,cap:500,factor:.02,radius:2}}}],{actionCooldown:.4,bombCount:15,skillId:'skchr_angel2_2'});
profiles('yela','yela_breath',[{byStar:{1:{tileCooldown:3,coldDuration:1.5,perColdSp:.2,skillAtk:10,skillAspd:10},2:{tileCooldown:2,coldDuration:2,perColdSp:.2,skillAtk:10,skillAspd:10},3:{tileCooldown:3,coldDuration:1.5,perColdSp:.2,skillAtk:10,skillAspd:10}}}],{tileCoverage:'walkable-and-objective',starThreeDoubleHit:500,paralysis:1,permanentSkillAt:3});
profiles('sui','sui_shadow',[{barrier:20,summonEvery:10,summonAtk:80,summonHp:150},{barrier:30,summonEvery:8,summonAtk:120,summonHp:200},{barrier:50,summonEvery:6,summonAtk:200,summonHp:300}],{barrierOnFirstCast:true,summonDuration:8,maxSummons:1,visible:true});
profiles('crown','crown_memory',[{byStar:{1:{perCast:3},2:{perCast:5},3:{perCast:10}}}],{maxStacks:30,battleOnly:true});

const componentInfo = [
  ['blade','长刃','攻击力+15'],['staff','法杖','攻击力+10，初始技力回复+0.1'],['bow','弓弦','攻速+10'],['plate','板甲','防御力+40'],['cloak','斗篷','法术抗性+8'],['belt','腰带','生命值+150'],['tear','泪滴','初始技力+5'],['crest','纹章','不提供基础属性，用于合成转职。'],
];
const componentEffects=[{atk:15},{atk:10,sp:.1},{aspd:10},{def:40},{res:8},{hp:150},{initialSp:5},{ }];
const equipment=Object.fromEntries(componentInfo.map(([id,name,description],i)=>[id,{id,name,description,kind:'component',effects:[E('component_stat',componentEffects[i])]}]));
const recipeNames=[
 ['giantSlayer','巨人杀手','对生命值高于5000的敌人造成伤害+25%'],['spellblade','破法刃','攻击使目标法抗降低12，持续3秒'],['rapidBlade','疾射刃','每第5次攻击追加80%攻击力物理伤害'],['armorAxe','破甲斧','攻击穿透25%防御'],['vampBlade','饮血刃','物理或法术实际伤害的10%转为生命，冷却0.5秒'],['titanArmor','泰坦战甲','受击后防御+8、攻击+1%，本场最多20层'],['duelistCrest','决斗徽记','首次施法后攻速+35，持续8秒'],['breakerTransfer','破阵转职','获得破阵盟约'],
 ['resonanceStaff','共鸣法杖','技能伤害+25%'],['thunderRing','雷电环','每第4次攻击对半径1.5内造成80%攻击力法伤'],['counterMirror','反击镜','受击时造成40%防御力法伤，冷却1秒'],['arcaneMantle','奥术披肩','法抗+12，技能目标受到法伤+15%，持续3秒'],['lifeSpring','生命泉杖','每5秒为生命最低的盟友恢复80%攻击力生命'],['archangelStaff','大天使杖','每次施法攻击+8%，本场最多40%'],['artsTransfer','术式转职','获得术式盟约'],
 ['berserkBow','狂战弓','每次攻击攻速+3，最多45'],['ironWing','铁羽翼','每场首次致死时免于倒下2秒'],['lightCloak','轻羽披风','物理与法术闪避15%'],['hurricane','飓风机芯','每第3次攻击追加最近另一敌人60%攻击力物伤'],['quickCharger','快速充能器','攻击获得1技力，每秒最多2'],['ammoTransfer','弹药转职','获得弹药盟约'],
 ['thornArmor','棘刺甲','受敌攻击时对周围造成80%防御力物伤，冷却1秒'],['golemArmor','石像铠','每阻挡敌人防御+20、法抗+4，最多3层'],['guardianPlate','守护板甲','生命+15%，每场首次致死获得15%生命屏障'],['shockShield','震荡盾','施法使最近敌人眩晕1秒，冷却5秒'],['controlTransfer','控制转职','获得控制盟约'],
 ['holyCloak','圣佑斗篷','法抗额外+12，每5秒清除寒冷或冻结'],['redemptionCloak','救赎斗篷','每8秒恢复两格内盟友6%生命，不触发共生'],['quietCape','静谧披风','技能结束恢复4技力'],['symbiosisTransfer','共生转职','获得共生盟约'],
 ['deepSeaBelt','深海腰带','生命+25%，每秒恢复最大生命0.6%'],['vitalEngine','活力引擎','受敌攻击获得1技力，每秒最多2'],['aegirTransfer','阿戈尔转职','获得阿戈尔盟约'],
 ['azureTear','青龙之泪','技能结束返还5技力，冷却3秒'],['yanTransfer','炎国转职','获得炎国盟约'],['doubleCrest','双纹章','选择一个身份盟约转职，领取选择保留至完成'],
];
const recipeProfiles=[
 ['giant_slayer',{healthAbove:5000,damageBonus:25}],['resistance_shred',{resReduction:12,duration:3}],['fifth_strike',{every:5,damage:80,damageType:'physical'}],['armor_pierce',{defensePenetration:25}],['lifesteal',{actualDamagePercent:10,cooldown:.5}],['hit_stack',{defPerHit:8,atkPercentPerHit:1,maxStacks:20,battleOnly:true}],['first_cast_haste',{aspd:35,duration:8,once:true}],['pact_transfer',{pactId:'breaker'}],
 ['skill_damage',{skillDamageBonus:25}],['chain_lightning',{every:4,radius:1.5,damage:80,damageType:'arts'}],['counter_magic',{damageFromDef:40,cooldown:1}],['spell_vulnerability',{resBonus:12,targetArtsVulnerability:15,duration:3}],['periodic_heal',{interval:5,healFromAtk:80,target:'lowestHpAlly'}],['cast_stack',{atkPercentPerCast:8,maxPercent:40,battleOnly:true}],['pact_transfer',{pactId:'arts'}],
 ['attack_stack',{aspdPerAttack:3,maxAspd:45}],['death_save',{duration:2,uses:1,battleOnly:true}],['evasion',{physicalDodge:15,artsDodge:15}],['splash_strike',{every:3,otherTargetDamage:60}],['attack_sp',{spPerAttack:1,perSecondCap:2}],['pact_transfer',{pactId:'ammo'}],
 ['thorns',{damageFromDef:80,radius:1,cooldown:1}],['block_stack',{defPerBlock:20,resPerBlock:4,maxStacks:3}],['death_barrier',{hpPercent:15,uses:1,battleOnly:true,baseHpBonus:15}],['cast_stun',{duration:1,cooldown:5,target:'nearestEnemy'}],['pact_transfer',{pactId:'control'}],
 ['resistance_cleanse',{extraRes:12,interval:5,cleanses:['cold','freeze']}],['periodic_heal',{interval:8,healTargetCount:2,healMaxHp:6,range:2,noSymbiosisRecursion:true}],['cast_sp',{sp:4,trigger:'skillEnd'}],['pact_transfer',{pactId:'symbiosis'}],
 ['regeneration',{maxHpBonus:25,healMaxHpPerSecond:.6}],['hit_sp',{spPerHit:1,perSecondCap:2}],['pact_transfer',{pactId:'aegir'}],
 ['skill_sp',{sp:5,cooldown:3,trigger:'skillEnd'}],['pact_transfer',{pactId:'yan'}],['choose_identity_transfer',{choice:'identityPact',keepsPendingSelection:true}],
];
let idx=0; let recipeNo=0; const recipes=[];
for(let a=0;a<8;a++) for(let b=a;b<8;b++) {
  const [id,name,description]=recipeNames[recipeNo];
  if(!id) throw new Error(`missing recipe ${recipeNo}`);
  const parts=[componentInfo[a][0],componentInfo[b][0]];
  const [kind,params]=recipeProfiles[recipeNo];const transfer=kind==='pact_transfer'||kind==='choose_identity_transfer';
  const baseEffects=parts.map(part=>E('component_stat',componentEffects[componentInfo.findIndex(x=>x[0]===part)]));
  equipment[id]={id,name,description,kind:transfer?'emblem':'completed',parts,baseEffects,unique:true,effects:[...baseEffects,E(kind,params)]};
  recipes.push({parts,resultId:id}); recipeNo++;
}
for(const id of ids) {
  const transferId=`transfer_${id}`;
  if(!equipment[transferId]) equipment[transferId]={id:transferId,name:`${pacts[id].name}转职`,description:`穿戴后额外获得${pacts[id].name}盟约标签。`,kind:'emblem',unique:true,effects:[E('transfer_pact',{pactId:id})]};
}

const strategyRows = [
 ['instant','零钱袋','获得10金币',{kind:'gold',amount:10}],['instant','经验书','获得12经验',{kind:'xp',amount:12}],['instant','零件柜','从全部8种基础组件中任选两件',{kind:'choose_components',optionCount:8,count:2}],['instant','战线补员','选择本池两名一费干员',{kind:'choose_pool_operators',cost:1,count:2}],['instant','军备调整器','拆一件有配方成品并返还两件组件，转职不可拆',{kind:'disassemble_recipe_item',returns:2}],['instant','换阵凭证','接下来两次售出二或三星非一费干员时返价+1',{kind:'sell_bonus',uses:2,amount:1,costMin:2,starMin:2,starMax:3}],
 ['economy','复利契约','本局利息上限增加2',{kind:'interest_cap',amount:2}],['economy','折扣培训','前五次购买经验各少花1金币',{kind:'xp_discount',uses:5,amount:1}],['economy','百货柜台','每第三次付费刷新免费一次，免费刷新不计数',{kind:'refresh_discount',paidRefreshEvery:3}],['economy','团结采购','首次凑齐任意四人盟约获8金币与一次奖励',{kind:'pact_set_reward',threshold:4,gold:8,once:true}],['economy','追星清单','指定在场一至三费干员，三次胜利后复制一份；池空则换等费用金币',{kind:'target_copy',costMin:1,costMax:3,wins:3,poolAware:true}],['economy','迟来的援军','四节点后领取指定本池四费干员，满席待领',{kind:'delayed_operator',delayNodes:4,cost:4,pendingIfFull:true}],
 ['task','控场演练','本场控制触发20次后获得一枚小复制器',{kind:'metric_reward',metric:'controlTriggers',threshold:20,reward:'minor_copy'}],['task','弹匣挑战','本场真实消耗60枚弹药后，从两种基础组件候选中任选一件',{kind:'metric_reward',metric:'ammoSpent',threshold:60,reward:'choose_component',optionCount:2}],['task','建筑竞赛','本场造物攻击80次后获得通用复制器',{kind:'metric_reward',metric:'constructAttacks',threshold:80,reward:'universal_copy'}],['task','治疗里程','本场有效治疗20000后获得共生转职',{kind:'metric_reward',metric:'effectiveHealing',threshold:20000,reward:'transfer_symbiosis'}],['task','无伤合约','连续两胜且无漏敌后获得12金币',{kind:'metric_reward',metric:'winNoLeakStreak',threshold:2,reward:'gold',amount:12}],['task','精英悬赏','本场击倒三名精英后获得12经验',{kind:'metric_reward',metric:'eliteKills',threshold:3,reward:'xp',amount:12}],
 ['risk','背水一战','失去15生命并获得15金币；生命不高于20时不能选择',{kind:'risk_exchange',hpCost:15,gold:15,minHpExclusive:20}],['risk','精简后勤','备战区容量降为7，每次后勤结算额外获得2金币',{kind:'bench_capacity_and_gold',capacity:7,postBattleGold:2}],['risk','孤注一掷','本局不能锁定商店，每次刷新费用为1金币',{kind:'shop_rule',lockDisabled:true,refreshCost:1}],['risk','主将独行','场上不能有重复身份；唯一最高星主核攻击+40%',{kind:'unique_nation_core',attack:40}],['risk','延迟领薪','后两节点基础金币暂存，第三节点返还暂存总额并额外+8',{kind:'delayed_income',holdNodes:2,releaseNode:3,bonus:8}],['risk','伤痕契约','每场胜利额外失去2生命，全队攻击+15%',{kind:'victory_tradeoff',hpCost:2,teamAtk:15}],
 ['rule','盟约密约','选择一件合法盟约转职',{kind:'choose_transfer',category:'pact'}],['rule','双重编制','指定成员获得第二个机制盟约，不增加盟约计数',{kind:'dual_pact',extraTag:true,noExtraCount:true}],['rule','低费专精','禁止招募五费；一费三星额外生命+35%、攻击+25%',{kind:'low_cost_specialist',forbidCost:5,star:3,hp:35,atk:25}],['rule','大器晚成','选择时支付8金币，本局五费一星生命与攻击+25%',{kind:'late_game',startGold:-8,cost:5,star:1,hp:25,atk:25}],['rule','灵活变阵','更换核心后获得2金币，每节点最多一次；同一核心连续锁定三场后才可再次记入',{kind:'flexible_core',gold:2,nodeCap:1,lockBattles:3}],['rule','装备熔炉','每四节点免费拆卸一次并选择一个有材料的配方',{kind:'free_disassemble_and_recipe',everyNodes:4,requiresComponents:true}],
 ['battle','后排交叉火力','至少两名前排和两名远程时，远程攻速+20、近战生命+20%',{kind:'crossfire',minMelee:2,minRanged:2,rangedAspd:20,meleeHp:20}],['battle','双人互保','选择的相邻两名干员分摊20%伤害，不能递归',{kind:'pair_guard',share:20,adjacent:true,noRecursion:true}],['battle','最后一弹','弹药技能最后一发返3技力并造成150%攻击力物伤',{kind:'lastAmmo',sp:3,damage:150}],['battle','冰面回声','每个目标首次冻结时对邻格造成80%施法者攻击力法伤',{kind:'firstFreezeSplash',damage:80,adjacent:true}],['battle','重构许可','每场首次造物死亡时在原位重召一次',{kind:'firstConstructRebuild',perBattle:1,originalTile:true}],['battle','处决专利','对生命低于20%的普通敌伤害+50%，领袖+15%',{kind:'executeBonus',hpBelow:20,regular:50,boss:15}],
];
const strategies=Object.fromEntries(strategyRows.map(([group,name,description,effect],i)=>{
  const id=`strategy_${String(i+1).padStart(2,'0')}`;
  const condition=group==='risk'&&effect.minHpExclusive?{kind:'current_hp_above',value:effect.minHpExclusive}
    :group==='task'?{kind:'metric_threshold',metric:effect.metric,threshold:effect.threshold}
      :group==='battle'&&effect.kind==='crossfire'?{kind:'formation_count',minMelee:effect.minMelee,minRanged:effect.minRanged}
        :group==='battle'&&effect.kind==='pair_guard'?{kind:'choose_adjacent_pair'}
          :group==='rule'&&effect.kind==='late_game'?{kind:'gold_min',value:8}
            :group==='rule'&&effect.kind==='low_cost_specialist'?{kind:'no_owned_cost',cost:effect.forbidCost}
              :{kind:'always'};
  const timing=group==='instant'?'on-pick':group==='task'?'battle-metric':group==='battle'?'battle-start':group==='risk'&&effect.kind==='delayed_income'?'node-delay':'run-or-node';
  const params={...effect};delete params.kind;
  if(effect.kind==='metric_reward')params.scope=effect.metric==='winNoLeakStreak'?'streak':'battle';
  return[id,{id,name,group,description,timing,condition,mutuallyExclusive:[],unique:true,effects:[E(effect.kind,params)],invalidFallback:E('gold',{amount:6})}];
}));

const originNames=['阿戈尔','拉特兰','谢拉格','炎国','维多利亚','哥伦比亚','卡西米尔','叙拉古','罗德岛','龙门','萨尔贡','莱塔尼亚','伊比利亚','东','乌萨斯','玻利瓦尔','雷姆必拓','巴别塔','萨米'];
const factionAliases={'喀兰贸易':'谢拉格','炎':'炎国','乌萨斯学生自治团':'乌萨斯','红松骑士团':'卡西米尔','深海猎人':'阿戈尔','炎-龙门':'龙门','龙门近卫局':'龙门','炎-岁':'炎国','塔拉':'维多利亚','格拉斯哥帮':'维多利亚','雷姆必托':'雷姆必拓'};
const environmentEffect=[
 ['阿戈尔','aegir',{kind:'aegir_first_hit_growth',params:{maxHp:5,maxStacks:5}}],['拉特兰','laterano',{kind:'environment_ammo',params:{firstSkillAmmo:2}}],['谢拉格','kjerag',{kind:'environment_snow',params:{tileCooldown:4,coldDuration:1}}],['炎国','yan',{kind:'environment_skill_refund',params:{firstCasts:2,sp:1}}],['维多利亚','victoria',{kind:'environment_elite_hit',params:{every:3,damage:50}}],['哥伦比亚','columbia',{kind:'environment_construct_shield',params:{hp:20}}],['卡西米尔','kazimierz',{kind:'environment_elite_bounty',params:{firstKillGold:2}}],['叙拉古','siracusa',{kind:'environment_first_harvest',params:{sp:5}}],['罗德岛','rhodes',{kind:'environment_lowest_heal',params:{heal:25,perBattle:1}}],['龙门','lungmen',{kind:'environment_leak_reduction',params:{firstLeak:50}}],['萨尔贡','sargon',{kind:'environment_component_choice',params:{extraOptions:1}}],['莱塔尼亚','leithania',{kind:'environment_opening_sp',params:{duration:10,perSecond:.3}}],['伊比利亚','iberia',{kind:'environment_front_barrier',params:{hp:15}}],['东','higashi',{kind:'environment_deploy_stealth',params:{seconds:2}}],['乌萨斯','ursus',{kind:'environment_frontline_reward',params:{minFront:2,hp:5,role:'frontline',survivorsOnly:true,anyResult:true}}],['玻利瓦尔','bolivar',{kind:'environment_slow_armor',params:{defReduction:10}}],['雷姆必拓','rim',{kind:'environment_component_supply',params:{everyNode:8,count:1}}],['巴别塔','babel',{kind:'environment_first_death_sp',params:{sp:2}}],['萨米','sami',{kind:'environment_random_cold',params:{everySeconds:20,duration:1}}],
];
const environmentDescriptions={
  aegir:'本场每名干员首次受到敌人攻击后最大生命提高5%，每名干员最多触发5次。',laterano:'本场弹药技能首次装填额外获得2枚弹药。',kjerag:'寒冷地格每4秒可再次施加1秒寒冷。',yan:'全队前两次施法各返还1技力。',victoria:'精英每第三次受到攻击时额外承受最高攻击成员50%攻击力的物理伤害。',columbia:'造物首次部署时获得相当于自身生命20%的屏障。',kazimierz:'本场首次击倒精英获得2金币。',siracusa:'本场首次触发收割后恢复5技力。',rhodes:'每场为生命最低的干员恢复25%最大生命一次。',lungmen:'第一个漏敌造成的生命损失减半。',sargon:'节点补给出现4个不重复基础组件候选，仍领取2件。',leithania:'战斗前10秒全队每秒恢复0.3技力。',iberia:'开场前排获得最大生命15%的屏障。',higashi:'首次部署时获得2秒潜行。',ursus:'结算时若曾部署至少两名前线，所有存活前线无论胜负均永久增加5点生命。',bolivar:'减速敌人的防御降低10%。',rim:'每第8节点获得一件基础组件。',babel:'本场首次有友方倒下时全队恢复2技力。',sami:'每20秒在随机行走格施加1秒寒冷。',
};
const environments=Object.fromEntries(environmentEffect.map(([name,pactId,rule])=>{const id=`origin_${pactId}`;return[id,{id,name,identityPactId:pactId,minThreshold:Math.max(...pacts[pactId].thresholds),rule:E(rule.kind,rule.params),description:environmentDescriptions[pactId]}]}));
const supply={
  components:{nodes:[4,8,12,16,20,24],optionCount:3,countPerNode:2,kind:'basic-component'},
  copies:[{node:10,count:1,kind:'minor',costMax:3},{node:18,count:1,kind:'universal'},{node:24,count:1,kind:'universal'}],
  transfers:[{node:12,count:1,selection:'main-or-viable-pact'},{node:22,count:1,selection:'main-or-viable-pact'},{node:26,count:1,selection:'main-or-viable-pact'}],
  xp:[{node:14,amount:8},{node:20,amount:8}],acceleratedStrategy:{node:26,count:1},
  delivery:'next-prep-before-fight',lastRoundNoPostBattleSupply:true,requiresCapacityCheck:true,pendingRewardDraftOnFull:true,
};
const campaign={
  terminalTimeLimitSeconds:180,
  poolByCost:{1:14,2:13,3:14,4:14,5:10},copiesByCost:{1:30,2:25,3:18,4:10,5:9},
  opening:{level:3,population:3,starterCount:3,gold:5,basicComponents:2,componentKind:'basic'},
  economy:{xpOnBattleEnd:2,xpPurchase:{gold:4,xp:4},xpToLevel:{3:6,4:10,5:20,6:36,7:56,8:68,9:68},maxLevel:10,shopSize:5,paidRefreshGold:2,firstBattleBaseGold:4,laterBaseGold:5,victoryGold:1,interest:{perGold:10,cap:5},streakBonus:{2:1,3:1,4:1,5:2,6:3},benchCapacity:9,inventoryCapacity:20},
  shopOdds:{3:[75,25,0,0,0],4:[55,30,15,0,0],5:[45,33,20,2,0],6:[30,40,25,5,0],7:[16,30,43,10,1],8:[15,20,32,30,3],9:[10,17,25,33,15],10:[5,10,20,40,25]},
  supply,rounds:{FUNNY:28,NORMAL:28,HARD:28,ABYSS:30},nodeSchedule:{FUNNY:{nodes:28,battleOnEvenNodes:true,battleCount:14,oddNodeGold:5,oddNodeXp:2,keepStreak:true},NORMAL:{nodes:28,bossNode:28},HARD:{nodes:28,bossNode:28},ABYSS:{nodes:30,baseBossNode:28,eliteNode:29,hiddenBossNode:30},regularWave:{formula:'ceil(node/2)',max:13,bossWave:14,hiddenBossWave:15}},strategyNodes:[3,9,15,21],shopSize:5,starterCount:3,
  enemyBalance:{
    regular:{hpMultiplier:.65,atkMultiplier:.85,defMultiplier:.35},
    terminal:{hpMultiplier:.75,atkMultiplier:.85,defMultiplier:.35,bossPoolMultiplier:.5},
    byDifficulty:{
      FUNNY:{regular:{hpMultiplier:.55,atkMultiplier:.75,defMultiplier:.3},terminal:{hpMultiplier:.65,atkMultiplier:.8,defMultiplier:.3,bossPoolMultiplier:.4}},
      HARD:{regular:{hpMultiplier:.9,atkMultiplier:1,defMultiplier:.65},terminal:{hpMultiplier:.95,atkMultiplier:1,defMultiplier:.65,bossPoolMultiplier:.9}},
      ABYSS:{regular:{hpMultiplier:1,atkMultiplier:1,defMultiplier:1},terminal:{hpMultiplier:1,atkMultiplier:1,defMultiplier:1,bossPoolMultiplier:1}},
    },
  },
};

const pactFromNation = (operator) => {
  const name=operator.name;
  if(['能天使','新约能天使','蕾缪安'].includes(name)) return 'laterano';
  if(['德克萨斯','缄默德克萨斯'].includes(name)) return 'siracusa';
  if(name==='哈洛德') return 'kjerag';
  if(['炎-龙门','龙门'].includes(name)) return 'lungmen';
  const sourceFactions=operator.sourceFactions?.nativeFactionTags??[];
  const explicit={
    '能天使':'拉特兰','新约能天使':'拉特兰','蕾缪安':'拉特兰','德克萨斯':'叙拉古','缄默德克萨斯':'叙拉古',
    '哈洛德':'谢拉格','炎-龙门':'龙门','龙门':'龙门','伊内丝':'巴别塔','雷姆必拓':'雷姆必拓','雷姆必托':'雷姆必拓',
  };
  const explicitName=explicit[name];
  const faction=explicitName??sourceFactions[0]??null;
  const label=factionAliases[faction]??(faction&&originNames.includes(faction)?faction:null);
  return label ? ids[originNames.indexOf(label)] : 'rhodes';
};
const skillText = (skill) => `${skill?.name??''} ${skill?.desc??''}`;
const roleOverrides={
  '万顷':'damage','送葬人':'damage','松果':'damage','奥斯塔':'damage','雷蛇':'frontline','乌尔比安':'frontline','余':'frontline','耀骑士临光':'frontline',
  '德克萨斯':'control','波登可':'control','深巡':'control','薄绿':'control','铃兰':'control','初雪':'damage','海霓':'damage','锡人':'damage','地灵':'control',
  '九色鹿':'support','流明':'healer','浊心斯卡蒂':'support','新约能天使':'damage','圣聆初雪':'control','烛煌':'damage','塑心':'damage','魔王':'support',
  '贝洛内':'damage','迷迭香':'damage','耀骑士临光':'frontline',
};
const mechanismOverrides={
  '万顷':'logistics','圣聆初雪':'control','乌尔比安':'breaker','新约能天使':'ammo','波登可':'control','深巡':'control','雷蛇':'control','德克萨斯':'logistics',
  '薄绿':'control','铃兰':'control','初雪':'arts','海霓':'arts','锡人':'arts','地灵':'control','九色鹿':'symbiosis','流明':'symbiosis','浊心斯卡蒂':'symbiosis',
  '余':'combo','烛煌':'burn','塑心':'necrosis','魔王':'arts','贝洛内':'combo','迷迭香':'creation','耀骑士临光':'creation','令':'creation',
};
const frontlineSubProfessions=new Set(['protector','guardian','centurion','unyield','primprotector','fearless','musha']);
function roleFor(op, chosen) {
  const sub=op.sourceNormalChess.subProfessionId??''; const prof=op.sourceNormalChess.profession;
  if(roleOverrides[op.name])return roleOverrides[op.name];
  if(sub==='bard')return 'support';
  if(frontlineSubProfessions.has(sub)) return 'frontline';
  if(prof==='MEDIC'&&!/incantationmedic/.test(sub)) return 'healer';
  if(/寒冷|冻结|眩|晕|束缚|沉睡|浮空|战栗|推开|推回|击退|拉拽|停顿|减速/.test(skillText(chosen))) return 'control';
  const deployableToken=(op.sourceNormalChess.tokens??[]).some(id=>{const token=canonicalData.tokens?.[id];return token&&token.placeable!==false&&token.displayType!=='HIDDEN';});
  if(/dollkeeper|tactician|craftsman|summoner/.test(sub)||hasSelectedSkillTokenSource(op,chosen)||(deployableToken&&/召唤|召出|部署.{0,6}(装置|造物|单位)/.test(skillText(chosen)))) return 'summoner';
  return 'damage';
}
function mechanismFor(op,chosen) {
  const sub=op.sourceNormalChess.subProfessionId??'';const prof=op.sourceNormalChess.profession;const text=skillText(chosen);
  if(mechanismOverrides[op.name])return mechanismOverrides[op.name];
  if(/executor|agent/.test(sub)) return 'redeploy'; if(/skywalker/.test(sub))return 'flight';
  if(/弹药|子弹|发射.{0,4}枚/.test(text)||chosen?.durationType==='AMMO')return 'ammo';
  if(/summoner|tactician|dollkeeper|craftsman/.test(sub)||hasSelectedSkillTokenSource(op,chosen))return 'creation';
  if(/灼燃/.test(text))return 'burn'; if(/凋亡/.test(text))return 'necrosis';
  if(/寒冷|冻结|眩|晕|束缚|沉睡|浮空|战栗|推开|推回|击退|拉拽|停顿|减速/.test(text))return 'control';
  if(prof==='MEDIC'||/guardian|bard/.test(sub))return 'symbiosis';
  if(prof==='PIONEER'||/charger|merchant/.test(sub))return 'logistics';
  if(['INCREASE_WHEN_ATTACK','INCREASE_WHEN_ATTACKED'].includes(chosen?.spType)||/fastshot|fighter|funnel/.test(sub))return 'combo';
  if(['CASTER','SUPPORTER'].includes(prof))return 'arts';return 'breaker';
}
function hasSelectedSkillTokenSource(op, chosen) {
  if (!chosen) return false;
  const ownerLoadout={skillIndex:chosen.index};
  return (op.sourceNormalChess.tokens??[]).some((entry)=>{
    const id=typeof entry==='string'?entry:entry?.tokenId??entry?.id;
    if(!id)return false;
    const token=nativeSource.getToken(id,op.chessId,ownerLoadout);
    return Array.isArray(token?.sources)&&token.sources.some((source)=>source==='skill'||source==='talent');
  });
}
const specialSkills=new Map([['万顷','skchr_wanqin_2'],['白金','skchr_platnm_2'],['灰毫','skchr_ashlok_2'],['奥斯塔','skchr_aosta_2'],['贾维','skchr_chiave_2'],['令','skchr_ling_3'],['黍','skchr_shu_3'],['耀骑士临光','skchr_nearl2_3']]);
const specialTiming={
  '白金':{spCost:24,initSp:8,spType:'INCREASE_WITH_TIME',duration:-1},
  '万顷':{spCost:26,initSp:10,spType:'INCREASE_WITH_TIME'},
  '奥斯塔':{spCost:28,initSp:10,spType:'INCREASE_WITH_TIME'},
  '贾维':{spCost:24,initSp:8,spType:'INCREASE_WITH_TIME'},
  '灰毫':{spCost:12,initSp:4,spType:'INCREASE_WHEN_TAKEN_DAMAGE',trigger:{rule:'DEFAULT'}},
};
const passiveProfiles={
  ammo:{kind:'star3_ammo',params:{firstSkillExtraAmmo:3,perBattle:1},description:'本场首次弹药技能额外获得3枚弹药。'},
  control:{kind:'star3_control',params:{firstControlSp:15,perBattle:1},description:'本场首次施加控制后恢复15技力。'},
  creation:{kind:'star3_creation',params:{firstConstructHp:20,firstConstructAtk:30,perBattle:1},description:'本场首次召唤的造物生命提高20%，攻击提高30%。'},
  symbiosis:{kind:'star3_symbiosis',params:{healShield:15,targetCooldown:2},description:'有效治疗的15%转为目标屏障，同一目标冷却2秒。'},
  logistics:{kind:'star3_logistics',params:{firstDp:5,perBattle:1},description:'本场首次产生部署费用时额外获得5点。'},
  combo:{kind:'star3_combo',params:{everyAttacks:6,sp:2},description:'每第6次攻击额外恢复2技力。'},
  breaker:{kind:'star3_breaker',params:{hpBelow:35,damage:20},description:'对生命低于35%的敌人造成的物理与法术伤害提高20%。'},
  arts:{kind:'star3_arts',params:{firstSkillDamage:100,perBattle:1},description:'本场首次技能在范围内追加100%攻击力法术伤害。'},
  burn:{kind:'star3_burn',params:{firstElementBurstSp:10,perBattle:1},description:'本场首次灼燃爆发后恢复10技力。'},
  necrosis:{kind:'star3_necrosis',params:{firstElementBurstSp:10,perBattle:1},description:'本场首次凋亡爆发后恢复10技力。'},
  redeploy:{kind:'star3_redeploy',params:{firstRedeployTimeMultiplier:.5,perBattle:1},description:'本场首次再部署等待时间减半。'},
  flight:{kind:'star3_flight',params:{airborneAspd:30},description:'腾空期间攻速提高30。'},
};
const fiveStarProfiles={
  '新约能天使':{kind:'star3_holyGun',params:{airstrikeChance:100,airstrikeMultiplier:500,ammoMultiplierCap:500,ammoScale:.02,airstrikeRadius:2,skillBombs:15,skillTargeting:'randomBattleTiles',ammoSkillVulnerability:50},description:'每个拉特兰攻击动作必定呼叫空袭；空袭攻击倍率为500%，弹药消耗加成最高500枚。技能随机投放15枚弹药，命中目标获得持续本场的弹药技能易伤50%。'},
  '圣聆初雪':{kind:'star3_yela',params:{perColdAttack:10,perColdAspd:10,perColdSp:.2,tileCooldown:3,coldDuration:1.5,phalanxDefenseRetained:true,permanentSkill:true,singleTargetExtraHits:2,hitDamage:500,paralysisStacks:1},description:'技能永久保持；铺雪持续造成寒冷。每个寒冷或冻结敌人提高10%攻击和10攻速。单体攻击追加两次500%攻击力法伤并施加1层麻痹。'},
  '凛御银灰':{kind:'star3_silverash',params:{allyInterval:2,allyDamage:10,hawkAntiAir:true},description:'每2秒对技能范围内所有敌人造成自身攻击力10%的额外物理伤害，并召唤可攻击空中单位的风雪鹰。'},
  '蕾缪安':{kind:'star3_lemuen',params:{chargedExtraTargets:1,splashDamage:80},description:'每次蓄力射击额外贯穿1个目标，并对溅射范围造成本次伤害的80%。'},
  '乌尔比安':{kind:'star3_ulpius',params:{hitGrowthHp:50,hitGrowthAtk:5,starThreeMultiplier:2,battleGrowthCap:20,anchorAntiAir:true},description:'每场最多20次受击成长，每次永久增加50生命和5攻击；三星效果翻倍，锚击波可命中空中敌人。'},
  '隐德来希':{kind:'star3_ines',params:{firstLethalRefusalSeconds:8,globalEnemyDefReduction:40},description:'首次受到致死伤害时进入8秒不倒状态，并使全地图敌人防御降低40%。'},
  '史尔特尔':{kind:'star3_surtur',params:{emberUntilRetreat:true,selfDamagePerSecondMaxHp:10,bonusTrueDamagePerHit:100},description:'首次余烬持续至退场；每秒自损不超过最大生命10%，每次攻击追加100%攻击力真实伤害。'},
  '余':{kind:'star3_yu',params:{everyAttacks:3,lineTiles:3,antiAir:true,healMaxHp:10},description:'每第3次攻击沿直线攻击3格并可命中空中目标，同时恢复最大生命的10%。'},
  '维娜·维多利亚':{kind:'star3_vina',params:{swordTrueDamage:600,maxSwords:4},description:'召出的剑每轮攻击追加600%攻击力真实伤害，最多存在4把。'},
  '缪尔赛思':{kind:'star3_muelseye',params:{maxFluidForms:3,sharedHealing:30,copySkill:true,noPactCount:true},description:'流形最多3个，分担本体30%治疗并复制技能，不额外计入盟约人数。'},
  '耀骑士临光':{kind:'star3_nearl',params:{sunAreaRadius:2,sunDps:100,sunDuration:8},description:'每次技能以目标为中心留下耀阳，半径2内每秒造成100%攻击力真实伤害，持续8秒。'},
  '荒芜拉普兰德':{kind:'star3_lappland',params:{repeatSkillOnce:true,freezeReplacement:'silence',silenceDuration:1},description:'本场技能结束后立即额外施放一次；冻结效果改为1秒沉默。'},
  '令':{kind:'star3_ling',params:{dragonHpMultiplier:2,dragonAtkMultiplier:2,dragonRebuilds:1,occupiesTile:true},description:'大龙生命和攻击再提高一倍；大龙倒下后可在空格重召一次并占用部署格。'},
  '黍':{kind:'star3_shu',params:{leaderDisplacement:false,leaderSlow:true,leaderSlowPercent:20,leaderSlowDuration:3,leaderSlowCooldown:3,teleportDamage:100},description:'范围传送对领袖改为减速20%，持续3秒、冷却3秒；每次传送对普通敌人造成100%攻击力法术伤害。'},
  '重岳':{kind:'star3_chongyue',params:{everyAttacks:5,damage:400,splashTiles:1},description:'每第5次连拳追加400%攻击力物理伤害，并溅射相邻一格。'},
  '圣约送葬人':{kind:'star3_executor',params:{lastAmmoRefundFull:true,perBattle:1},description:'本场弹药技能最后一发返还全部弹药一次。'},
  '烛煌':{kind:'star3_zhuhuang',params:{firewallTiles:'forwardPath',dps:100,burn:true,burnPercent:10},description:'技能期间火墙贯穿正前方路径，每秒造成100%攻击力法术伤害并附加10%攻击力灼燃损伤。'},
  '塑心':{kind:'star3_lingering',params:{spreadTargets:3,necrosis:200,targetCooldown:2,noRepeatBurst:true},description:'每次凋亡爆发向最近3个未爆发目标传播200%攻击力凋亡损伤，同一目标间隔至少2秒。'},
  '魔王':{kind:'star3_crown',params:{teamSpPerSecond:2,comboEverySeconds:3,comboDamage:300},description:'技能期间全队每秒恢复2技力，并每3秒发动300%攻击力合击。'},
  '迷迭香':{kind:'star3_rosmontis',params:{splashRadius:1,aftershockDamage:200},description:'攻击溅射半径增加1格，并追加200%攻击力余震；保留原有浮空免疫规则。'},
};
const directAttackActionKey=/^attack@atk_scale(?:_s\d+)?$/i;
const directDamageScalarKey=/^(?:atk_scale(?:_s\d+|_\d+)?|damage(?:_scale)?)$/i;
const directHealKey=/^(?:attack@)?(?:heal_scale|hp_recovery_per_sec_ratio)$/i;
const directShieldKey=/^(?:shield_scale|barrier_scale|shield_max_hp_ratio)$/i;
const directDamageDescription=/(?:相当于.{0,12}攻击力.{0,18}(?:伤害|灼燃|凋亡)|攻击力.{0,18}(?:物理|法术|真实|元素)?伤害|(?:造成|追加|附加).{0,18}(?:物理|法术|真实|元素|凋亡|灼燃)?伤害)/;
const directHealDescription=/(?:治疗|恢复).{0,24}(?:生命|生命值|攻击力|治疗量)|(?:生命|生命值).{0,16}(?:治疗|恢复)/;
const directShieldDescription=/(?:屏障|护盾).{0,24}(?:生命|生命值|攻击力|上限|提高|获得)|(?:获得|提供|生成).{0,12}(?:屏障|护盾)/;
const explicitDirectScaleKeys={
  skchr_indigo_2:['indigo_s_2[damage].atk_scale'],skchr_papyrs_1:['shield_scale_skill'],skchr_philae_2:['ep_damage_ratio'],
  skchr_snhunt_2:['atk_scale_1','atk_scale_2'],skchr_blemsh_3:['attack@blemsh_s_3_extra_dmg[magic].atk_scale'],
  skchr_snakek_2:['hp_recovery_per_sec_by_max_hp_ratio'],skchr_vigil_3:['attack@vigil_s_3.atk_scale'],
  skchr_bpipe_2:['atk_scale'],skchr_aroma_2:['attack@atk_scale_when_fly_finish'],skchr_texas2_3:['appear.atk_scale'],
  skchr_cetsyr_3:['attack@atk_to_hp_recovery_ratio'],skchr_lisa_3:['attack@atk_to_hp_recovery_ratio'],skchr_titi_3:['min_atk_scale','max_atk_scale'],
  skchr_thorn2_2:['hp_recovery_per_sec','hp_recovery_per_sec_by_max_hp_ratio','hp_recovery_per_sec_ratio_chr'],
  skchr_f12yin_2:['hp_recovery_per_sec_by_max_hp_ratio'],skchr_nymph_2:['ep_damage_ratio','element_atk_scale'],
  skchr_lemuen_3:['attack@proj_atk_scale_1','attack@proj_atk_scale_2'],skchr_yu_3:['ep_damage_ratio'],
  skchr_pasngr_3:['atk_scale'],skchr_reed2_3:['talent@damage_scale'],skchr_cello_1:['ep_damage_ratio'],
  skchr_whitw2_3:['attack@magic_atk_scale'],skchr_blkkgt_3:['d_atk_scale','e_atk_scale_end'],
  skchr_akkord_2:['attack@aoe_atk_scale'],skchr_rosesa_2:['attack@damage_scale'],skchr_jesica_1:['atk_scale'],
  skchr_taraxa_1:['attack@heal_scale'],skchr_judge_1:['judge_s_1_enhance_checker.atk_scale'],
};
const starRatio=(star,cost)=>star===1?1:star===2?1.2:cost===3?1.6:cost===4?2.5:cost===5?8:1.5;
const fixedSkill=(row)=> specialSkills.get(row.name) ?? (row.name==='正义骑士号'?'resonance_judgement_support':row.proposedFixedSkillId);
const crew=work.operators.map(row=>{
  const original=chess[row.chessId]; if(!original) throw new Error(`missing canonical chess record ${row.chessId}`);
  const chosen=row.skillOptions.find(s=>s.skillId===fixedSkill(row));
  if(row.name!=='正义骑士号'&&!chosen) throw new Error(`fixed skill missing from worktable ${row.name}`);
  const role=roleFor(row,chosen); const identity=pactFromNation(row); const mechanism=mechanismFor(row,chosen);
  const pacts=[identity,mechanism];
  if(row.name==='新约能天使')pacts.push('holyGun'); if(row.name==='圣聆初雪')pacts.push('yela'); if(['令','黍','重岳'].includes(row.name))pacts.push('sui'); if(row.name==='魔王')pacts.push('crown');
  const cost=row.newCost, base=original.stats;
  const hpBudget={1:1300,2:1550,3:1850,4:2250,5:2750}[cost]; const atkBudget={1:160,2:195,3:235,4:290,5:350}[cost];
  const hpScale=role==='frontline'?1:role==='healer'?.7:.65; const atkScale=role==='frontline'?1:role==='healer'?.95:1.15;
  const sameJob=work.operators.map(other=>other.sourceNormalChess).filter(other=>other.profession===original.profession&&other.subProfessionId===original.subProfessionId);
  const median=(values)=>{const v=[...values].sort((a,b)=>a-b);return v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;};
  const hpRatio=Math.max(.8,Math.min(1.2,(base.maxHp??1)/Math.max(1,median(sameJob.map(x=>x.stats.maxHp??1)))));
  const atkRatio=Math.max(.8,Math.min(1.2,(base.atk??1)/Math.max(1,median(sameJob.map(x=>x.stats.atk??1)))));
  const stats1={...base,maxHp:Math.round(hpBudget*hpScale*hpRatio),atk:Math.round(atkBudget*atkScale*atkRatio),def:Math.max(40,Math.min(500,base.def??40)),res:Math.max(0,Math.min(30,base.res??0))};
  const nativeTalents=original.talents??[];
  const stars={};
  for(let star=1;star<=3;star++) {
    const factor={1:1,2:1.8,3:3.24}[star],atkFactor={1:1,2:1.5,3:2.25}[star];
    const starStats={...stats1,maxHp:Math.round(stats1.maxHp*factor),atk:Math.round(stats1.atk*atkFactor)};
    const bb={...(chosen?.bb??{})};
    const chosenText=skillText(chosen);
    const descriptionConfirmsDamage=directDamageDescription.test(chosenText);
    const descriptionConfirmsHeal=directHealDescription.test(chosenText);
    const descriptionConfirmsShield=directShieldDescription.test(chosenText);
    const scaledKeys=[];
    for(const [key,value] of Object.entries(bb)) {
      const keyIsDirectRatio=(explicitDirectScaleKeys[fixedSkill(row)]??[]).includes(key)
        ||directAttackActionKey.test(key)
        ||(directDamageScalarKey.test(key)&&descriptionConfirmsDamage)
        ||(directHealKey.test(key)&&descriptionConfirmsHeal)
        ||(directShieldKey.test(key)&&descriptionConfirmsShield);
      if(keyIsDirectRatio&&Number.isFinite(value)) { bb[key]=Number((value*starRatio(star,cost)).toFixed(4));scaledKeys.push(key); }
    }
    const spType=chosen?.spType??'INCREASE_WITH_TIME';
    let spCost=chosen?.spCost??0,initSp=chosen?.initSp??0;let effectiveSpType=spType;let trigger=chosen?.trigger??{rule:'DEFAULT'};let duration=chosen?.duration??0;
    if(specialTiming[row.name]) { const timing=specialTiming[row.name];spCost=timing.spCost;initSp=timing.initSp;effectiveSpType=timing.spType;duration=timing.duration??duration;trigger=timing.trigger??trigger; }
    if(!specialTiming[row.name]&&chosen&&chosen.spCost>0&&(chosen.duration>0||chosen.durationType==='AMMO')) {
      if(spType==='INCREASE_WHEN_ATTACK')spCost=Math.max(3,Math.min(10,spCost||6));
      else if(spType==='INCREASE_WHEN_ATTACKED'||spType==='INCREASE_WHEN_TAKEN_DAMAGE')spCost=Math.max(6,Math.min(16,spCost||8));
      else {spCost=Math.max(18,Math.min(40,spCost));initSp=Math.min(initSp,Math.round(spCost*.6));}
    }
    if(chosen?.duration>0&&chosen.skillType!=='PASSIVE'&&chosen.trigger?.rule!=='ON_DEPLOY'&&chosen.durationType!=='INFINITE')duration=Math.max(8,Math.min(30,chosen.duration));
    const signature=star===3?fiveStarProfiles[row.name]:null;
    const ordinaryPassive=star===3?passiveProfiles[mechanism]??{kind:'star3_damage',params:{firstSkillBonus:100,perBattle:1},description:'本场首次技能额外造成100%攻击力伤害。'}:null;
    const passive = star===3
      ? signature ? {...signature,additionalEffect:ordinaryPassive,description:`${ordinaryPassive.description} ${signature.description}`}
        : ordinaryPassive
      : {kind:'none',params:{},description:''};
    const skillOverrides=row.name==='正义骑士号'?{spCost:0,initSp:0,spType:'NOT_RECOVER',trigger:{rule:'NEVER'},duration:0,bb:{}}:{spCost,initSp,spType:effectiveSpType,trigger,duration,bb};
    const selected={...original.skill,...chosen,skillId:fixedSkill(row),index:chosen?.index??0,bb:{...bb},spCost,initSp,spType:effectiveSpType,trigger,duration};
    if(row.name==='令'){skillOverrides.summonOnCast=1;selected.summonOnCast=1;}
    const talentOverrides=nativeTalents.map((t,i)=>({index:i,bb:{...(t.bb??{})},sourceId:`${row.charId}:talent:${i}`}));
    const record={...original,stats:starStats,skill:selected,skills:original.skills.map((skill)=>skill.skillId===selected.skillId?selected:{...skill}),talents:nativeTalents.map((t,i)=>({...t,bb:{...(talentOverrides[i]?.bb??t.bb??{})}}))};
    if(row.name==='正义骑士号') { record.skill=null;record.skills=[]; }
    let starPassive=passive;
    if(row.name==='正义骑士号') {
      const support=[{interval:6,healFromAtk:120,aspd:8},{interval:5,healFromAtk:150,aspd:12},{interval:3,healFromAtk:220,aspd:20}][star-1];
      starPassive={kind:'judgement_support',params:{...support,range:2,aspdDuration:3,spGeneration:0,target:'lowestHpAlly'},description:`每${support.interval}秒为2格内生命最低的友方恢复自身攻击力${support.healFromAtk}%，并使其攻速提高${support.aspd}持续3秒；不获得技力。`};
    }
    stars[star]={stats:starStats,skillOverrides,talentOverrides,passive:starPassive,record};
  }
  const skillDef=chosen ? nativeSource.getChess(row.chessId,{skillIndex:chosen.index}) : null;
  const kitSource=chosen ? skillSpecSource(skillDef,KITS) : 'none';
  const actualSource=kitSource;
  const nativeTokenSources=(original.tokens??[]).map((entry)=>{
    const tokenId=typeof entry==='string'?entry:entry?.tokenId??entry?.id;
    if(!tokenId)return null;
    const token=nativeSource.getToken(tokenId,row.chessId,chosen?{skillIndex:chosen.index}:null);
    return {tokenId,sources:token?.sources??[]};
  }).filter(Boolean);
  const fixedSource=clone(original);if(chosen) fixedSource.skill={...chosen,skillId:fixedSkill(row)};
  const chosenText=skillText(chosen);
  const scalingDescriptionConfirmsDamage=directDamageDescription.test(chosenText);
  const scalingCandidates=Object.keys(chosen?.bb??{}).filter((key)=>/atk_scale|damage|heal|shield|barrier|hp_recovery/i.test(key));
  const scaledSkillKeys=scalingCandidates.filter((key)=>(explicitDirectScaleKeys[fixedSkill(row)]??[]).includes(key)
    ||directAttackActionKey.test(key)
    ||(directDamageScalarKey.test(key)&&scalingDescriptionConfirmsDamage)
    ||(directHealKey.test(key)&&directHealDescription.test(chosenText))
    ||(directShieldKey.test(key)&&directShieldDescription.test(chosenText)));
  const unscaledSkillKeys=scalingCandidates.filter((key)=>!scaledSkillKeys.includes(key));
  return {id:row.chessId,name:row.name,charId:row.charId,sourceChessId:row.chessId,cost,position:original.position,canDeployHighGround:original.position==='RANGED'||meleeOnHighGround(original),role,fixedSkillIndex:chosen?.index??null,fixedSkillId:fixedSkill(row),pacts,assets:original.assets,skillScaleAudit:{scaledKeys:scaledSkillKeys,unscaledCandidates:unscaledSkillKeys,damageDescriptionConfirmed:scalingDescriptionConfirmsDamage},source:{commit:sourceCommit,recordId:row.charId,normalChess:fixedSource,worktableRecordId:row.charId,skillSpecSource:actualSource,tokenSources:nativeTokenSources},stars};
});
const operators=Object.fromEntries(crew.map(o=>[o.id,o]));
const preferredTerminals={aegir:'乌尔比安',laterano:'新约能天使',kjerag:'圣聆初雪'};
for(const env of Object.values(environments)) {
  const natural=crew.filter(o=>o.pacts[0]===env.identityPactId);
  env.minThreshold=Math.min(env.minThreshold,natural.length);
  const terminal=preferredTerminals[env.identityPactId]
    ? crew.find(o=>o.name===preferredTerminals[env.identityPactId])
    : natural.find(o=>o.cost===5);
  env.guaranteedTerminalId=(terminal??crew.find(o=>o.cost===5)).id;
  env.guaranteedNaturalMembers=env.minThreshold;
}
const sourceSkillGaps=crew.filter(o=>['generic','none'].includes(o.source.skillSpecSource)).map(o=>({name:o.name,charId:o.charId,sourceChessId:o.sourceChessId,fixedSkillId:o.fixedSkillId,skillSpecSource:o.source.skillSpecSource}));
const rosterByPact=(pactId)=>crew.filter(o=>o.pacts.includes(pactId));
const poolSeed = (value) => { if(typeof value==='number')return value>>>0; let h=2166136261;for(const c of String(value??''))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h; };
function shuffle(list,seed){const out=[...list];let s=seed>>>0;for(let i=out.length-1;i>0;i--){s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);const j=((t^(t>>>14))>>>0)%(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}
function buildRecruitmentPool(catalog,{environmentId,seed}={}) {
  const env=catalog.environments[environmentId]??catalog.environments[`origin_${environmentId}`]??catalog.environments.origin_laterano;const all=Object.values(catalog.operators);const rng=poolSeed(seed);const selected=new Set();
  const add=(op)=>{if(op)selected.add(op.id);};
  const main=all.filter(o=>o.pacts.includes(env.identityPactId));
  const desired=Math.min(env.minThreshold,main.length);for(const op of shuffle(main,rng).slice(0,desired))add(op);
  const terminal=catalog.operators[env.guaranteedTerminalId]??shuffle(all.filter(o=>o.cost===5&&o.pacts.includes(env.identityPactId)),rng^0xa511e9b3)[0]??shuffle(all.filter(o=>o.cost===5),rng^0x77)[0];add(terminal);
  const oneCost=all.filter(o=>o.cost===1);const front=shuffle(oneCost.filter(o=>o.role==='frontline'),rng^0x11);const ranged=shuffle(oneCost.filter(o=>o.position==='RANGED'),rng^0x22);const healers=shuffle(oneCost.filter(o=>o.role==='healer'),rng^0x33);
  for(const op of front.slice(0,2))add(op);add(ranged.find(o=>!selected.has(o.id))??ranged[0]);add(healers.find(o=>!selected.has(o.id))??healers[0]);
  const quotas=catalog.campaign.poolByCost;
  for(let cost=1;cost<=5;cost++){
    const reserved=[...selected].map(id=>catalog.operators[id]).filter(o=>o.cost===cost);if(reserved.length>quotas[cost])throw new Error(`guarantees exceed fee quota ${cost}`);
    const rest=shuffle(all.filter(o=>o.cost===cost&&!selected.has(o.id)),rng^Math.imul(cost,0x9e3779b1));
    for(const op of rest.slice(0,quotas[cost]-reserved.length))add(op);
  }
  if(selected.size!==65)throw new Error(`pool should contain 65 unique operators; got ${selected.size}`);
  const result=[...selected].sort((a,b)=>catalog.operators[a].cost-catalog.operators[b].cost||(a<b?-1:a>b?1:0));
  return result;
}
const content={schemaVersion:1,source:{commit:sourceCommit,worktable:'docs/resonance/roster-worktable.json',nativeChess:'data/chess.json',kitResolver:'server/sim/content/index.js::skillSpecSource(KITS)',playerTextTemplateCommit:'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add'},operators,pacts,equipment,recipes,strategies,environments,campaign};
if(!fs.existsSync(SKILL_TABLE)) throw new Error(`canonical pinned skill table missing: ${SKILL_TABLE}`);
const skillTable=JSON.parse(gunzipSync(fs.readFileSync(SKILL_TABLE)).toString('utf8'));
const playerText=compileResonancePlayerText(content,skillTable);
const fatalTextIssues=playerText.diagnostics.filter(x=>x.type==='missing-template'||x.type==='missing-blackboard-values'||x.type==='unknown-pact-effect'||x.type==='unknown-equipment-effect');
if(fatalTextIssues.length) throw new Error(`player text compilation has ${fatalTextIssues.length} unresolved issues: ${JSON.stringify(fatalTextIssues.slice(0,12))}`);
content.playerText=playerText;
const catalogSource=`// Generated by tools/resonance/build-content.mjs from the frozen roster and canonical native records.\nexport const resonanceContent = ${JSON.stringify(content,null,2)};\nexport const resonanceSourceSkillGaps = ${JSON.stringify(sourceSkillGaps,null,2)};\nexport { buildRecruitmentPool };\n\n${buildRecruitmentPool.toString()}\nconst poolSeed = ${poolSeed.toString()};\nconst shuffle = ${shuffle.toString()};\n`;
publishGenerated(OUT,catalogSource);
const counts=Object.fromEntries([1,2,3,4,5].map(cost=>[cost,crew.filter(o=>o.cost===cost).length]));
const envChecks=Object.values(environments).map(env=>({id:env.id,name:env.name,identityPactId:env.identityPactId,natural:crew.filter(o=>o.pacts[0]===env.identityPactId).length,required:env.guaranteedNaturalMembers,terminal:crew.find(o=>o.id===env.guaranteedTerminalId)?.name??''}));
const starLine=(op,star)=>{
  const spec=op.stars[star];
  const permanentDuration=spec.passive.params?.permanentSkill===true
    ? `\n- 持续值对照：共鸣运行时按永久持续处理（-1）；原生固定技能记录时长 ${spec.skillOverrides.duration} 秒，仅作来源对照。`
    : '';
  return `- 星${star}：属性 \`${JSON.stringify(spec.stats)}\`；固定技能参数 \`${JSON.stringify(spec.skillOverrides)}\`；天赋覆盖 \`${JSON.stringify(spec.talentOverrides)}\`；被动 ${spec.passive.description||'沿用原生天赋，无额外盟约被动'} \`${JSON.stringify(spec.passive.params)}\`${permanentDuration}`;
};
const enemyBalanceRows=['NORMAL','FUNNY','HARD','ABYSS'].map(difficulty=>{
  const configured=campaign.enemyBalance??{};
  const override=configured.byDifficulty?.[difficulty]??{};
  const regular={...configured.regular,...override.regular};
  const terminal={...configured.terminal,...override.terminal};
  const factors=rule=>['hpMultiplier','atkMultiplier','defMultiplier','resMultiplier','speedMultiplier']
    .map(key=>(rule[key]??1).toFixed(2)).join(' / ');
  return `| ${difficulty} | ${factors(regular)} | ${factors(terminal)} | ${(terminal.bossPoolMultiplier??1).toFixed(2)} |`;
});
const lines=[
  '# 共鸣正式配置终值清单','',
  `来源 commit：${sourceCommit}。名单 ${crew.length} 人；费用分布 ${JSON.stringify(counts)}。`,
  `盟约 ${Object.keys(pacts).length} 项；配方 ${recipes.length} 项；策略 ${Object.keys(strategies).length} 项；环境 ${Object.keys(environments).length} 项。`,
  '', '## 环境自然成员核验','',
  '| 环境 | 主盟约 | 自然人数 | 本局保证人数 | 固定终端 |','|---|---|---:|---:|---|',
  ...envChecks.map(e=>`| ${e.name} | ${pacts[e.identityPactId].name} | ${e.natural} | ${e.required} | ${e.terminal} |`),
  '', '职责按正式角色配置读取：魔王与普通吟游者海蒂为支援；职责分类不从职业名推导盟约。',
  '', '## 敌方强度终值','',
  '普通波与终端波分别应用下表倍率；终端领袖生命池单独应用最后一列。未配置的 RES 与移速倍率按 1 计算。','',
  '| 难度 | 普通波 HP / ATK / DEF / RES / 移速 | 终端波 HP / ATK / DEF / RES / 移速 | 领袖生命池 |','|---|---|---|---:|',
  ...enemyBalanceRows,
  '', '## 原生 Kit 分类记录',`${sourceSkillGaps.length} 名干员的原生分类为 generic/none；该字段保留原始 Kit 分类。运行时由共鸣固定技能承接这些分类例外，其中正义骑士号使用周期支援被动。`,'',
  ...sourceSkillGaps.map(o=>`- ${o.name}（${o.charId}，${o.sourceChessId}）：${o.fixedSkillId} — ${o.skillSpecSource}`),
  '', '## 干员逐项终值','',
  ...crew.flatMap(o=>[
    `### ${o.name}`,
    `- charId：${o.charId}；sourceChessId：${o.sourceChessId}；费用：${o.cost}；位置：${o.position}；职责：${o.role}；可部署高台：${o.canDeployHighGround?'是':'否'}`,
    `- 固定技能：${o.fixedSkillId}（技能索引 ${o.fixedSkillIndex??'自定义被动'}；Kit 来源 ${o.source.skillSpecSource}）`,
    `- 技能倍率审计：直伤/治疗/护盾倍率键 ${JSON.stringify(o.skillScaleAudit.scaledKeys)}；未应用倍率的候选键 ${JSON.stringify(o.skillScaleAudit.unscaledCandidates)}；技能文案支持直接伤害判断 ${o.skillScaleAudit.damageDescriptionConfirmed?'是':'否'}。`,
    `- 当前技能可见造物来源：${JSON.stringify(o.source.tokenSources)}`,
    `- 盟约：${o.pacts.map(id=>pacts[id].name).join('、')}；资源：\`${JSON.stringify(o.assets)}\``,
    ...[1,2,3].map(star=>`${starLine(o,star)}\n- 玩家技能说明：${playerText.operators[o.id].stars[star].skillDescription??o.stars[star].passive.description??'战线应答由固定支援被动执行。'}`),
  ]),
  '', '## 盟约效果',
  ...ids.flatMap(id=>[`### ${pacts[id].name} (${id})`,...pacts[id].levels.map((l,i)=>`- ${l.threshold} 人：${playerText.pacts[id].levels[i].description} 效果：\`${JSON.stringify(l.effects)}\``)]),
  '', '## 配方','','| 组件 | 结果 | 效果参数 |','|---|---|---|',
  ...recipes.map(r=>`| ${r.parts.map(id=>equipment[id].name).join(' + ')} | ${equipment[r.resultId].name} | \`${JSON.stringify(equipment[r.resultId].effects)}\``),
  '', '## 策略','',
  ...Object.values(strategies).map(s=>`- ${s.name}（${s.group}，${s.timing}）：${s.description} 条件 \`${JSON.stringify(s.condition)}\`；效果 \`${JSON.stringify(s.effects)}\`；无效时 \`${JSON.stringify(s.invalidFallback)}\``),
  '', '## 环境','',
  ...Object.values(environments).map(e=>`- ${e.name}（主盟约${pacts[e.identityPactId].name}；自然保证${e.guaranteedNaturalMembers}人；终端${crew.find(o=>o.id===e.guaranteedTerminalId)?.name}）：${e.description} 效果 \`${JSON.stringify(e.rule)}\``),
].join('\n');
publishGenerated(DOC,lines);
console.log(`generated ${OUT}`);console.log(`generated ${DOC}`);console.log(`operators=${crew.length} costs=${JSON.stringify(counts)} pacts=${ids.length} recipes=${recipes.length} strategies=${strategyRows.length} environments=${Object.keys(environments).length} sourceSkillGaps=${sourceSkillGaps.length}`);
