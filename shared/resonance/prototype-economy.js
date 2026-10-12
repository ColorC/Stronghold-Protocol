import { prototypeSourceGearDefinitions } from './prototype-source-gear.js';
import { nativeFlatAmount } from './native-effect-scale.js';

/** Source pointers and source-backed progression constants for Set 13 (14.23).
 * Random reward contents are supplied by the session adapter from its seeded
 * reward tables; this module never invents a prize or a price.
 */
export const prototypeEconomySources = Object.freeze({
  season: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/into-the-arcane-overview/',
  chemBaron: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/into-the-arcane-overview/',
  academy: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/into-the-arcane-overview/',
  chemBaronTable: 'https://lolchess.gg/rewards/set13/chem-baron-black-market?hl=en',
  academyTable: 'https://lolchess.gg/rewards/set13/academy-sponsored-items?hl=en',
  academyProjection: '本模式把14.23来源赞助成装池按用途投影到共鸣现有装备；伤害增幅、法力、攻速、防护与回复各映射到本模式对应机制。来源组合保留；装备效果使用共鸣规则，不宣称复刻TFT装备数值。',
  conquerorTable: 'https://lolchess.gg/rewards/set13/conqueror-war-chest-rewards?hl=en',
  familyTable: 'https://lolchess.gg/rewards/set13/family-heist-rewards?hl=en',
  junkerKingTable: 'https://lolchess.gg/rewards/set13/junkerking-items?hl=en',
  rewardTableCaveat: 'LoLCHESS Set 13 reward tables are mutable community-maintained tables. They identify reward rows, not a patch-pinned probability distribution; the mode presents listed rows as selectable PvE reward choices.',
  gearAdaptation: 'Anvil, remover, reforger, and Radiant effects use existing Resonance equipment and combat-stat primitives. Reward names retain their Set 13 source identity; the displayed equipment effects state the Resonance adaptation explicitly.',
});

export const prototypeEconomyRules = Object.freeze({
  xpToLevel: Object.freeze({ 3: 6, 4: 10, 5: 20, 6: 36, 7: 48, 8: 76, 9: 84 }),
  shopOddsByLevel: Object.freeze({
    3: Object.freeze([75,25,0,0,0]), 4: Object.freeze([55,30,15,0,0]),
    5: Object.freeze([45,33,20,2,0]), 6: Object.freeze([30,40,25,5,0]),
    7: Object.freeze([19,30,40,10,1]), 8: Object.freeze([18,25,32,22,3]),
    9: Object.freeze([15,20,25,30,10]), 10: Object.freeze([5,10,20,40,25]),
  }),
  sourceVersions: Object.freeze({
    xpBaseline: 'TFT 14.15', xpLevel10: 'TFT 14.23',
    oddsLevel7: 'TFT 14.24', oddsLevel8: 'TFT 14.18', oddsLevel9: 'TFT 14.9',
  }),
  academy: Object.freeze({ traitId: 'academy', sourceName: 'Academy', itemsByTier: Object.freeze({ 3: 1, 4: 2, 5: 3, 6: 3 }) }),
  chemBaron: Object.freeze({ traitId: 'risk', sourceName: 'Chem-Baron', shimmerBreakpoint: 100, minStreakLength: 3 }),
  conqueror: Object.freeze({ traitId: 'conqueror', sourceName: 'Conqueror', chestThresholds: Object.freeze([10,35,65,100,150,200,330,440,550,660,750,850,1000,1200,1500]) }),
  family: Object.freeze({ traitId: 'family', sourceName: 'Family', heistThresholds: Object.freeze([10,17,20,30]), projectProgressPerSurvivor: 1 }),
  junkerKing: Object.freeze({ traitId: 'armory', sourceName: 'Junker King', roundsPerArmory: 3 }),
});

// Exact 14.23 item-side values from the pinned CommunityDragon source extract.
// These are compact mechanic records, not copied game assets or data bundles.
export const chemBaronItems = Object.freeze([
  Object.freeze({
    id:'prototype_chem_salvaged_contraption',name:'回收式减伤装置',sourceName:'Salvaged Contraption',sourceApiName:'TFT13_Crime_Bronze_ChemGrips',
    description:'生命值+200、护甲与法术抗性+10，受到的所有伤害降低10%。',sourceDescription:'Reduce all incoming damage by 10.',sourceEffects:Object.freeze({Health:200,Armor:10,MagicResist:10,ReducedDamage:10}),stats:Object.freeze({health:200,armor:10,magicResist:10}),effect:Object.freeze({kind:'flat_damage_reduction',amount:10}),
  }),
  Object.freeze({
    id:'prototype_chem_salvaged_revolver',name:'回收式法术增幅器',sourceName:'Salvaged Revolver',sourceApiName:'TFT13_Crime_Bronze_MageGuard',
    description:'法术强度+20、初始法力+15；每5秒额外获得10点法术强度。',sourceDescription:'Gain 20 Ability Power and 10 Ability Power every 5 seconds.',sourceEffects:Object.freeze({AP:20,Mana:15,APPerTick:10,TickRate:5}),stats:Object.freeze({ap:20,mana:15}),effect:Object.freeze({kind:'periodic_arts_power',basePct:20,perTickPct:10,interval:5}),
  }),
  Object.freeze({
    id:'prototype_chem_salvaged_gauntlet',name:'回收式真伤护手',sourceName:'Salvaged Gauntlet',sourceApiName:'TFT13_Crime_Bronze_MiningGauntlet',
    description:'攻击力+25%、攻击速度+10%；普攻额外造成15点真实伤害。',sourceDescription:'Gain 25% Attack Damage and 10% Attack Speed. Attacks deal 15 additional true damage.',sourceEffects:Object.freeze({AD:0.25,AS:10,BonusDamageOnAttack:15}),stats:Object.freeze({atkPct:0.25,aspd:10}),effect:Object.freeze({kind:'attack_true_damage',amount:15}),
  }),
]);

// The compiler projects every Chem-Baron item from the pinned 14.23 client
// record. These families map source behavior to existing Battle primitives;
// numeric source values stay intact and are read from the projected record.
const CHEM_ITEM_FAMILIES=Object.freeze({
  ChemGrips:{kind:'flat_damage_reduction',name:'回收式减伤装置',copy:'减少受到的伤害。'},
  MageGuard:{kind:'periodic_arts_power',name:'回收式法术增幅器',copy:'周期性提升法术伤害。'},
  MiningGauntlet:{kind:'attack_true_damage',name:'回收式真伤护手',copy:'普攻额外造成真实伤害。'},
  DestabilizedChemtank:{kind:'threshold_shield',name:'化学储罐',copy:'生命降至一半时获得护盾，之后周期性获得护盾。'},
  ExecutionersVorpalblade:{kind:'execute_kill',name:'处决链刃',copy:'攻击与技能可处决低生命敌人；击倒后短暂提高伤害与防护。'},
  FleshRipper:{kind:'low_health_ripper',name:'血肉撕裂者',copy:'生命降至阈值时恢复生命并短暂强化攻击；强化版首次阵亡后复起。'},
  PiltovenHexplating:{kind:'stacking_hexarmor',name:'皮尔特沃夫六边装甲',copy:'受击叠加双抗；叠满后反击附近敌人。'},
  ShimmerBloom:{kind:'team_shimmer_bloom',name:'微光绽放',copy:'周期性为持有者及低生命队友提供护盾；强化版同时提升其战力。'},
  UnleashedToxins:{kind:'skill_toxins',name:'释放毒素',copy:'攻击回复技力，施放技能后向目标发射法术毒弹；强化版另有范围毒浪。'},
  VirulentVirus:{kind:'skill_virus',name:'毒性病毒',copy:'技能命中使敌人持续承受真实伤害；强化版还会削弱感染者。'},
  VoltaicSaber:{kind:'voltaic_saber',name:'电涌军刀',copy:'累计受击与攻击后向低生命敌人释放电击；强化版触发时提高攻速。'},
  DimensionalHeirloom:{kind:'dimensional_heirloom',name:'维度遗珍',copy:'战斗中周期性召来援手；本模式将援手表现为持有者的短时幻影。'},
});
const CHEM_TIER_NAMES=Object.freeze({Bronze:'青铜',Silver:'白银',Gold:'黄金',Prismatic:'棱彩',OmegaPrismatic:'欧米伽棱彩'});
const CHEM_ITEM_NAMES=Object.freeze({
  ChemGrips:'回收式减伤装置',MageGuard:'回收式法术增幅器',MiningGauntlet:'回收式真伤护手',
  DestabilizedChemtank:'化学储罐',ExecutionersVorpalblade:'处决链刃',FleshRipper:'血肉撕裂者',
  PiltovenHexplating:'六边装甲',ShimmerBloom:'微光绽放',UnleashedToxins:'释放毒素',
  VirulentVirus:'毒性病毒',VoltaicSaber:'电涌军刀',DimensionalHeirloom:'维度遗珍',
});
const CHEM_NATIVE_FLAT_FIELDS=Object.freeze(['Health','BonusDamageOnAttack','ShieldAmount','PrismaticHeal','FlatDamage','JoltDamage','PrismaticWaveDamage','PrismaticZombieHealth']);
function chemEffectiveEffects(season,sourceEffects={}){
  const effective=structuredClone(sourceEffects);
  for(const key of CHEM_NATIVE_FLAT_FIELDS)if(Number.isFinite(Number(effective[key])))effective[key]=nativeFlatAmount(season,effective[key]);
  return effective;
}
function chemFamily(apiName){return Object.keys(CHEM_ITEM_FAMILIES).find((suffix)=>apiName.endsWith(suffix))??null;}
function chemTier(apiName){return ['OmegaPrismatic','Prismatic','Gold','Silver','Bronze'].find((tier)=>apiName.includes(`_${tier}_`))??null;}
function chemStats(effects={}){
  return {health:Number(effects.Health??0),armor:Number(effects.Armor??0),magicResist:Number(effects.MagicResist??0),
    ap:Number(effects.AP??0),mana:Number(effects.Mana??0),atkPct:Number(effects.AD??0),aspd:Number(effects.AS??0),critChance:Number(effects.CritChance??0),
    omnivamp:Number(effects.StatOmnivamp??0),reducedDamage:Number(effects.ReducedDamage??0)};
}
function chemStatCopy(stats){return [stats.health?`生命值+${stats.health}`:'',stats.armor?`护甲评分+${stats.armor}`:'',stats.magicResist?`法抗评分+${stats.magicResist}`:'',stats.ap?`法术伤害提高${stats.ap}%`:'',stats.mana?`开战技力为固定技能消耗的${stats.mana}%`:'',stats.atkPct?`攻击力提高${Math.round(stats.atkPct*100)}%`:'',stats.aspd?`攻击速度+${stats.aspd}`:'',stats.critChance?`暴击率+${stats.critChance}%`:'',stats.omnivamp?`伤害转化为${Math.round(stats.omnivamp*100)}%生命恢复`:''].filter(Boolean).join('，');}
const pct=(value)=>`${Math.round(Number(value??0)*100)}%`;
const chemMechanicCopy=(family,effects,tier)=>{
  const v=(key,fallback=0)=>Number(effects[key]??fallback),perfect=tier==='Prismatic'||tier==='OmegaPrismatic';
  switch(family){
    case 'ChemGrips':return `受到的伤害降低${v('ReducedDamage')}%。`;
    case 'MageGuard':return `每${v('TickRate',5)}秒额外获得${v('APPerTick',10)}点法术强度。`;
    case 'MiningGauntlet':return `普通攻击额外造成${v('BonusDamageOnAttack',15)}点真实伤害。`;
    case 'DestabilizedChemtank':return `生命降至${pct(v('HealthThreshold',.5))}时，获得相当于最大生命${pct(v('InitialPercentShield',.2))}的护盾；之后每${v('TickRate',8)}秒获得${pct(v('PercentShield',.1))}护盾。${perfect?`每次获得护盾后，对附近${v('PrismaticNumChampions')}名敌人造成其最大生命${pct(v('PrismaticDamagePercent'))}的法术伤害。`:''}`;
    case 'ExecutionersVorpalblade':return `攻击或技能可处决生命低于${pct(v('ExecuteThreshold',.1))}的敌人；击倒后${v('Duration',5)}秒内伤害提高${pct(v('OnKillDA',.1))}、受到伤害降低${pct(v('OnKillDR',.1))}。${perfect?`处决另获${v('PrismaticGold')}枚金币并恢复${v('PrismaticHeal')}生命。`:''}`;
    case 'FleshRipper':return `生命降至${pct(v('HealthThreshold',.4))}时短暂无法被敌人选中，恢复最大生命${pct(v('PercentHeal',.25))}，并获得攻击力${pct(v('EnhancedAD',.1))}与全能吸血${pct(v('EnhancedOmnivamp',.1))}，持续5秒。${perfect?`首次阵亡后以最大生命${pct(v('PrismaticReviveHeal',1))}复起。`:''}`;
    case 'PiltovenHexplating':return `每次受击获得${v('ArmorPerStack',3)}护甲评分与法抗评分，最多${v('MaxStacks',15)}层；叠满后每${v('Cooldown',2)}秒对${v('HexRange',1)}格内敌人造成相当于自身双抗评分总和${pct(v('ResistancePercentageDamage',.5))}的${perfect?'真实':'法术'}伤害。`;
    case 'ShimmerBloom':return `治疗与护盾效果提高${pct(v('IncreasedHealShieldPercent',.2))}；每${v('Cadence',8)}秒为自己及生命最低的${v('NumAllies',2)}名队友提供${v('ShieldAmount',300)}点护盾，持续${v('ShieldDuration',10)}秒。${perfect?`受治疗或护盾的队友另获${v('PrismaticAllyAP',30)}点法术强度与${pct(v('PrismaticAllyAS',.3))}攻击速度。`:''}`;
    case 'UnleashedToxins':return `每次普攻额外获得固定技能消耗的${v('ExtraManaOnAttack',5)}%技力；技能结束后向当前目标发射${v('NumMissiles',3)}枚毒弹，每枚造成${v('FlatDamage',100)}点法术伤害。${perfect?`另造成${v('PrismaticWaveDamage',450)}点范围法术伤害并使敌人停顿${v('PrismaticWaveStunDuration',1.5)}秒。`:''}`;
    case 'VirulentVirus':return `技能伤害使敌人额外承受${pct(v('DoTPercentDamage',.15))}伤害，持续${v('Duration',3)}秒。${perfect?`感染敌人造成的伤害降低${pct(v('PrismaticReducedDamage',.25))}；其阵亡后成为我方援军，生命${v('PrismaticZombieHealth',1600)}并逐渐衰减（${v('PrismaticZombieDecayDuration',8)}秒）。`:''}`;
    case 'VoltaicSaber':return `每累计${v('NumDamageInstances',6)}次伤害，对生命最低的${v('NumEnemies',2)}名敌人各造成${v('JoltDamage',150)}点物理伤害。${perfect?`每次电击另提高${pct(v('PrismaticASPerTrigger',.2))}攻击速度。`:''}`;
    case 'DimensionalHeirloom':return `战斗中每${v('Cadence',4)}秒召唤一名纸偶幻影，继承持有者35%生命与攻击，持续6秒。`;
    default:return CHEM_ITEM_FAMILIES[family]?.copy??'';
  }
};
function adaptChemItem(row,season=null){
  const apiName=String(row.apiName??row.sourceApiName??''),family=chemFamily(apiName),tier=chemTier(apiName);
  if(!family||!tier)return null;
  const profile=CHEM_ITEM_FAMILIES[family],sourceEffects=structuredClone(row.effects??{}),effects=chemEffectiveEffects(season,sourceEffects),stats=chemStats(effects);
  const bronze=family==='ChemGrips'?{kind:'flat_damage_reduction',amount:stats.reducedDamage}
    :family==='MageGuard'?{kind:'periodic_arts_power',basePct:stats.ap,perTickPct:Number(effects.APPerTick??0),interval:Number(effects.TickRate??5)}
    :family==='MiningGauntlet'?{kind:'attack_true_damage',amount:Number(effects.BonusDamageOnAttack??0)}
    :{...profile,sourceTier:tier,perfected:tier==='Prismatic'||tier==='OmegaPrismatic'};
  const sourceName=String(row.name??family);
  const name=tier==='Bronze'?CHEM_ITEM_NAMES[family]:`${CHEM_TIER_NAMES[tier]}·${CHEM_ITEM_NAMES[family]}`;
  const modeAdaptation=family==='DimensionalHeirloom'
    ?'来源记录每4秒生成援军并记载5000生命，但未给援军单位的其余战斗数值或存续时间；本模式映射为持有者35%生命与攻击、持续6秒，并沿用纸偶Spine外观且不装载其原技能。'
    :family==='FleshRipper'
      ?'来源描述短暂强化但未提供强化时长；本模式将强化时长映射为5秒。'
      :family==='VirulentVirus'&&bronze.perfected
        ?'来源记录感染者阵亡后以1600生命加入持有者阵营并在8秒内衰减；本模式保留原敌人的攻击与双抗，并使用既有纸偶外观且不装载其原技能。'
        :null;
  return {id:apiName.startsWith('TFT13_Crime_Bronze_')?({ChemGrips:'prototype_chem_salvaged_contraption',MageGuard:'prototype_chem_salvaged_revolver',MiningGauntlet:'prototype_chem_salvaged_gauntlet'}[family]):`prototype_chem13_${apiName.replace(/^TFT13_Crime_/,'').replace(/[^A-Za-z0-9]+/g,'_').toLowerCase()}`,
    sourceApiName:apiName,sourceName,tier,name,description:`${chemStatCopy(stats)?`${chemStatCopy(stats)}。`:''}${chemMechanicCopy(family,effects,tier)}`,sourceDescription:row.description??row.desc??'',modeAdaptation,
    sourceEffects,effectiveEffects:effects,unique:row.unique===true,stats,effect:bronze};
}

// The eight upgrade names and their combat text come directly from the pinned
// 14.23 client records. Prices below are an explicit PvE adaptation (source
// armory is purchasable, but its exact prices are not exposed by the source).
export const junkerKingUpgrades = Object.freeze([
  {id:'TFT13_JunkerKing_Pass',name:'备用零件',description:'获得50生命值与3点法术强度。',price:0,stats:{health:50,ap:3}},
  {id:'TFT13_JunkerKing_SuperPass',name:'强化零件',description:'获得300生命值与25点法术强度。',price:5,stats:{health:300,ap:25}},
  {id:'TFT13_JunkerKing_Flamethrower',name:'喷焰器',description:'持续对锥形区域造成法术伤害。',price:5,combat:{kind:'flamethrower',interval:2,damagePctByStar:[35,50,600]}},
  {id:'TFT13_JunkerKing_PertriciteRod',name:'源石棒',description:'每5秒对4格内最远敌人造成持续15秒的法术伤害。',price:5,combat:{kind:'pertricite',interval:5,duration:15,range:4,damagePctByStar:[350,525,6000]}},
  {id:'TFT13_JunkerKing_RepairingMicrobots',name:'修复微型机器人',description:'每3秒恢复最大生命值的6%（3星25%）。',price:5,combat:{kind:'repair',interval:3,healPctByStar:[0.06,0.06,0.25]}},
  {id:'TFT13_JunkerKing_SelfDestructButton',name:'自毁按钮',description:'护甲评分与法抗评分各提高25%；阵亡时对附近敌人造成基于双抗评分的法术伤害。',price:5,stats:{armorPct:0.25,resistPct:0.25},combat:{kind:'self_destruct',armorMrPctByStar:[200,300,2000],radius:2}},
  {id:'TFT13_JunkerKing_Tankbuster',name:'破甲弹',description:'每3秒对双抗最高的敌人造成真实伤害。',price:5,combat:{kind:'tankbuster',interval:3,trueDamagePctByStar:[120,180,1600]}},
  {id:'TFT13_JunkerKing_3Star',name:'全套机甲',description:'仅3星维娜可购买；耐久提高90%，并解锁其余升级。',price:10,stats:{durability:0.9},combat:{kind:'unlock_all'}},
].map((row)=>Object.freeze({...row,sourceApiName:row.id,priceAdaptation:'本模式PvE金币定价；来源确认可购买，但未提供可核实的原始金币价格。'})));

/** Faction season 2 armory at the native scale: shares of 生命上限, 法术伤害 and 防御力 instead of TFT health, AP and
 * ratings; the 3★ steps no longer multiply ATK tens of times (喷焰器 600% → 80%, 源石棒 6000% → 800%, 破甲弹 1600% →
 * 300%) and 全套机甲 takes 20% less damage instead of 90%. Same ids, prices and kinds as the season-1 list. */
export const junkerKingUpgradesV2 = Object.freeze([
  {id:'TFT13_JunkerKing_Pass',name:'备用零件',description:'生命上限+3%，法术伤害+3%。',price:0,stats:{hpPct:0.03,apPct:0.03}},
  {id:'TFT13_JunkerKing_SuperPass',name:'强化零件',description:'生命上限+10%，法术伤害+12%。',price:5,stats:{hpPct:0.1,apPct:0.12}},
  {id:'TFT13_JunkerKing_Flamethrower',name:'喷焰器',description:'每2秒对周围的敌人造成攻击力35%（二星50%，三星80%）的法术伤害。',price:5,combat:{kind:'flamethrower',interval:2,damagePctByStar:[35,50,80]}},
  {id:'TFT13_JunkerKing_PertriciteRod',name:'源石棒',description:'每5秒选中4格内最远的敌人，15秒内共造成攻击力350%（二星525%，三星800%）的法术伤害。',price:5,combat:{kind:'pertricite',interval:5,duration:15,range:4,damagePctByStar:[350,525,800]}},
  {id:'TFT13_JunkerKing_RepairingMicrobots',name:'修复微型机器人',description:'每3秒回复生命上限6%的生命（三星10%）。',price:5,combat:{kind:'repair',interval:3,healPctByStar:[0.06,0.06,0.1]}},
  {id:'TFT13_JunkerKing_SelfDestructButton',name:'自毁按钮',description:'防御力+20%，法术抗性+10；倒下时对周围的敌人造成防御力200%（二星300%，三星600%）的法术伤害。',price:5,stats:{defPct:0.2,resFlat:10},combat:{kind:'self_destruct',defPctByStar:[200,300,600],radius:2}},
  {id:'TFT13_JunkerKing_Tankbuster',name:'破甲弹',description:'每3秒对防御力与法术抗性之和最高的敌人造成攻击力120%（二星180%，三星300%）的真实伤害。',price:5,combat:{kind:'tankbuster',interval:3,trueDamagePctByStar:[120,180,300]}},
  {id:'TFT13_JunkerKing_3Star',name:'全套机甲',description:'仅三星时可购买；受到的伤害-20%，并解锁其余升级。',price:10,stats:{durability:0.2},combat:{kind:'unlock_all'}},
].map((row)=>Object.freeze({...row,sourceApiName:row.id,priceAdaptation:'本模式PvE金币定价；来源确认可购买，但未提供可核实的原始金币价格。'})));

// LoLCHESS Set 13 table lists fixed groups of three sponsored items. Each
// source item is explicitly projected onto an existing Resonance equipment
// mechanic; the project-level mapping is disclosed above and not presented as
// a claim that these are the same TFT items.
export const academySponsorSets = Object.freeze([
  [['Nashor’s Tooth','berserkBow'],['Steadfast Heart','guardianPlate'],['Infinity Edge','giantSlayer']],
  [['Bramble Vest','thornArmor'],['Giant Slayer','giantSlayer'],['Bloodthirster','vampBlade']],
  [['Hand of Justice','vampBlade'],['Bramble Vest','thornArmor'],['Runaan’s Hurricane','hurricane']],
  [['Guardbreaker','prototype_academy_guardbreaker'],['Evenshroud','spellblade'],['Jeweled Gauntlet','resonanceStaff']],
  [['Statikk Shiv','thunderRing'],['Guinsoo’s Rageblade','berserkBow'],['Dragon’s Claw','holyCloak']],
  [['Spear of Shojin','quickCharger'],['Warmog’s Armor','deepSeaBelt'],['Titan’s Resolve','titanArmor']],
  [['Guinsoo’s Rageblade','berserkBow'],['Crownguard','guardianPlate'],['Hand of Justice','vampBlade']],
  [['Adaptive Helm','quietCape'],['Infinity Edge','giantSlayer'],['Redemption','redemptionCloak']],
  [['Giant Slayer','giantSlayer'],['Guardbreaker','prototype_academy_guardbreaker'],['Crownguard','guardianPlate']],
  [['Archangel’s Staff','archangelStaff'],['Dragon’s Claw','holyCloak'],['Infinity Edge','giantSlayer']],
  [['Adaptive Helm','quietCape'],['Deathblade','giantSlayer'],['Nashor’s Tooth','berserkBow']],
  [['Bramble Vest','thornArmor'],['Infinity Edge','giantSlayer'],['Statikk Shiv','thunderRing']],
  [['Hextech Gunblade','lifeSpring'],['Gargoyle Stoneplate','golemArmor'],['Sterak’s Gage','titanArmor']],
  [['Runaan’s Hurricane','hurricane'],['Warmog’s Armor','deepSeaBelt'],['Jeweled Gauntlet','resonanceStaff']],
  [['Steadfast Heart','guardianPlate'],['Deathblade','giantSlayer'],['Ionic Spark','thunderRing']],
  [['Gargoyle Stoneplate','golemArmor'],['Rabadon’s Deathcap','resonanceStaff'],['Protector’s Vow','guardianPlate']],
  [['Jeweled Gauntlet','resonanceStaff'],['Infinity Edge','giantSlayer'],['Adaptive Helm','quietCape']],
  [['Hand of Justice','vampBlade'],['Warmog’s Armor','deepSeaBelt'],['Giant Slayer','giantSlayer']],
  [['Spear of Shojin','quickCharger'],['Gargoyle Stoneplate','golemArmor'],['Guardbreaker','prototype_academy_guardbreaker']],
  [['Guardbreaker','prototype_academy_guardbreaker'],['Statikk Shiv','thunderRing'],['Bloodthirster','vampBlade']],
  [['Steadfast Heart','guardianPlate'],['Infinity Edge','giantSlayer'],['Rabadon’s Deathcap','resonanceStaff']],
  [['Infinity Edge','giantSlayer'],['Ionic Spark','thunderRing'],['Warmog’s Armor','deepSeaBelt']],
]);

/** Deterministically select one source-listed three-item sponsor set for this run. */
export function chooseAcademySponsorSet(seed, sets = academySponsorSets) {
  const rows = (sets ?? []).map((row) => {
    if (Array.isArray(row)) return { sourceNames: row.map((entry) => entry?.[0]).filter(Boolean), itemIds: row.map((entry) => entry?.[1]).filter(Boolean) };
    return { sourceNames: row?.sourceNames ?? [], itemIds: row?.itemIds ?? [] };
  }).filter((row) => row.itemIds.length === 3 && row.sourceNames.length === 3);
  const score = (key) => { let value = 2166136261; for (const ch of `${seed}:${key}`) { value ^= ch.charCodeAt(0); value = Math.imul(value, 16777619); } return value >>> 0; };
  rows.sort((a, b) => score(a.sourceNames.join('|')) - score(b.sourceNames.join('|')) || a.sourceNames.join('|').localeCompare(b.sourceNames.join('|')));
  return rows[0]?.itemIds ?? [];
}

const rewardOption=(id,label,description,grant,source)=>({id,label,description,cost:{currency:'gold',amount:0},grant,source});
const CHEST_REWARDS=Object.freeze({
  10:[rewardOption('gold-2','2枚金币','获得2枚金币。',[{kind:'gold',amount:2}],'Conqueror Chest 10: x2 Gold')],
  35:[rewardOption('unit-cost-2','2费干员','获得一名2费干员。',[{kind:'operator',targetCost:2}],'Conqueror Chest 35: 2 Cost Unit')],
  65:[rewardOption('unit-cost-4','4费干员','获得一名4费干员。',[{kind:'operator',targetCost:4}],'Conqueror Chest 65: 4 Cost Unit')],
  100:[rewardOption('copy-3','低阶复制券与3费干员','获得一张低阶复制券与一名3费干员。',[{kind:'consumable',id:'smallCopy'},{kind:'operator',targetCost:3}],'Conqueror Chest 100: Lesser Champion Duplicator + 3 Cost Unit')],
  150:[rewardOption('component-reforger','组件与重铸器','获得一件组件和一枚重铸器。',[{kind:'component',pool:'components'},{kind:'consumable',id:'prototype_reforger'}],'Conqueror Chest 150: Random Component + Reforger; the component is drawn from allowed mode components')],
  200:[rewardOption('units-4-5','4费与5费干员','获得一名4费干员与一名5费干员。',[{kind:'operator',targetCost:4},{kind:'operator',targetCost:5}],'Conqueror Chest 200: 4 Cost Unit + 5 Cost Unit')],
  330:[rewardOption('unit-5','5费干员','获得一名5费干员。',[{kind:'operator',targetCost:5}],'Conqueror Chest 330: 5 Cost Unit')],
  440:[rewardOption('thief-gloves','窃盗手套','获得两件随机成装。',[{kind:'consumable',id:'prototype_thiefs_gloves'}],'Conqueror Chest 440: Thief’s Item; mode grants two seeded completed items')],
  550:[rewardOption('completed-anvil','成装铁砧','选择一件本模式成装。',[{kind:'consumable',id:'prototype_completed_anvil'}],'Conqueror Chest 550: Completed Item Anvil; opens an actual Resonance gear selection')],
  660:[rewardOption('artifact-anvil','遗物铁砧','选择一件本模式遗物装备。',[{kind:'consumable',id:'prototype_artifact_anvil'}],'Conqueror Chest 660: Artifact Anvil; opens an actual tagged Resonance gear selection')],
  750:[rewardOption('support-anvil','辅助装备铁砧','选择一件本模式辅助装备。',[{kind:'consumable',id:'prototype_support_anvil'}],'Conqueror Chest 750: Support Item Anvil; opens an actual current support gear selection')],
  850:[rewardOption('gold-20','20枚金币','获得20枚金币。',[{kind:'gold',amount:20}],'Conqueror Chest 850: x20 Gold')],
  1000:[rewardOption('remover-gold','卸除器与金币','获得一枚卸除器和20枚金币。',[{kind:'consumable',id:'prototype_item_remover'},{kind:'gold',amount:20}],'Conqueror Chest 1000: Remover + x20 Gold')],
  1200:[rewardOption('radiant-artifact-remover','辉光装备、遗物铁砧、卸除器与金币','选择辉光装备与遗物装备，获得卸除器和50枚金币。',[{kind:'consumable',id:'prototype_radiant_anvil'},{kind:'consumable',id:'prototype_artifact_anvil'},{kind:'consumable',id:'prototype_item_remover'},{kind:'gold',amount:50}],'Conqueror Chest 1200: Radiant Item + Artifact Anvil + Remover + x50 Gold')],
  1500:[rewardOption('radiant-conversion-gold','辉光升格与金币','获得一枚辉光转化器和80枚金币。',[{kind:'consumable',id:'prototype_radiant_conversion'},{kind:'gold',amount:80}],'Conqueror Chest 1500: Radiant Conversion + x80 Gold')],
});
const FAMILY_REWARDS=Object.freeze({
  10:[rewardOption('training-dummies','三只训练纸偶','获得三只训练纸偶，可放置在战场并承受敌方攻击。',[{kind:'special_entity',id:'TFT_TrainingDummy',count:3}],'Family Heist 10: x3 Training Dummy; source object uses native sand-obelisk appearance only')],
  17:[
    rewardOption('family17-copies','低阶复制券','获得三张低阶复制券。',[{kind:'consumable',id:'smallCopy'},{kind:'consumable',id:'smallCopy'},{kind:'consumable',id:'smallCopy'}],'Family Heist 17: x3 Lesser Champion Duplicators'),
    rewardOption('family17-components','随机组件','获得两件组件。',[{kind:'component',pool:'components'},{kind:'component',pool:'components'}],'Family Heist 17: x2 Random Component'),
  ],
  20:[
    rewardOption('family20-gold','20枚金币','获得20枚金币。',[{kind:'gold',amount:20}],'Family Heist 20: x20 Gold'),
    rewardOption('family20-artifact','遗物装备','选择一件本模式遗物装备。',[{kind:'consumable',id:'prototype_artifact_anvil'}],'Family Heist 20: Artifact Item; project maps this to its supported Artifact selection'),
  ],
  30:[
    rewardOption('family30-gold','30枚金币','获得30枚金币。',[{kind:'gold',amount:30}],'Family Heist 30: x30 Gold'),
    rewardOption('family30-components','随机组件','获得三件组件。',[{kind:'component',pool:'components'},{kind:'component',pool:'components'},{kind:'component',pool:'components'}],'Family Heist 30: x3 Random Component'),
  ],
});

// Current community tables show separate alternative rows at each shimmer
// cash-out. The mode maps listed item tiers to its existing equipment pools.
const CHEM_MARKET_ROWS=Object.freeze({
  100:[{t0:1,copies:1},{t0:1},{t0:1},{t0:1,gold:2},{copies:1},{t0:1}],
  200:[{t0:1,t1:1,gold:5,removers:1},{t1:1,copies:1,gold:5,removers:1},{t1:1},{t0:1,t1:1,removers:1},{t0:1,t1:1,gold:5,removers:1},{t1:1,removers:1}],
  300:[{t1:1,t2:1,removers:1},{t1:1,t2:1,removers:1},{t2:1,gold:10,removers:1},{gold:5,removers:1},{gold:5,removers:1},{removers:1}],
  400:[{t1:1,t2:2,removers:1},{t2:2,removers:1},{t1:1,t2:2},{removers:1}],
  500:[{t1:1,t2:1,t3:1,gold:2,removers:1},{t1:1,t2:1,t3:1,removers:1},{t2:1,t3:1,gold:10},{t3:1,gold:20},{t1:1,t2:1,t3:1,removers:1}],
  600:[{t3:2,gold:25},{t3:2,gold:55,removers:1},{t2:1,t3:2,gold:25,removers:2},{t3:2,gold:20,removers:2},{t3:2,gold:10}],
  700:[{t3:3}],800:[{t4:1}],
});
const CHEM_CONSUMABLE_BY_TIER=Object.freeze({Bronze:'prototype_chem_market_anvil',Silver:'prototype_chem_silver_anvil',Gold:'prototype_chem_gold_anvil',Prismatic:'prototype_chem_prismatic_anvil',OmegaPrismatic:'prototype_chem_omega_anvil'});
function chemMarketOptions() {
  return Object.fromEntries(Object.entries(CHEM_MARKET_ROWS).map(([threshold,bundles])=>[threshold,bundles.map((bundle,index)=>{
    const grant=[], add=(key,id)=>{for(let n=0;n<(bundle[key]??0);n++)grant.push({kind:'consumable',id});};
    for(const [key,tier] of [['t0','Bronze'],['t1','Silver'],['t2','Gold'],['t3','Prismatic'],['t4','OmegaPrismatic']])add(key,CHEM_CONSUMABLE_BY_TIER[tier]);
    add('copies','smallCopy');add('removers','prototype_item_remover');
    if(bundle.gold)grant.push({kind:'gold',amount:bundle.gold});
    const choices=(bundle.t0??0)+(bundle.t1??0)+(bundle.t2??0)+(bundle.t3??0)+(bundle.t4??0);
    const label=[choices?`${choices}件装备选择`:null,bundle.copies?`${bundle.copies}张复制券`:null,bundle.removers?`${bundle.removers}枚卸除器`:null,bundle.gold?`${bundle.gold}枚金币`:null].filter(Boolean).join('、')||'卸除器';
    return rewardOption(`chem-${threshold}-${index+1}`,label,'领取这组奖励；装备选择可在背包中打开并挑选可用装备。',grant,`Chem-Baron Black Market ${threshold}: source reward row ${index+1}; item tiers map to implemented Resonance pools`);
  })]));
}

export const prototypeEconomyCopy = Object.freeze({
  academy:'研发院每局确定三件赞助装备；达到不同人数档位后，累计领取一、二或三件。赞助装备的持有者获得生命与伤害增幅，研发干员加成更高。',
  chemBaron:'险境干员在每场战斗后积累微光；本模式按战斗结算后的连败数判定额外微光，胜利会先重置连败。每积累一百微光，可选择一件违禁装备或略过市场；略过会提高险境干员生命。',
  conqueror:'远征干员的实际击倒按当前人数档位累积征服进度；达到战利品箱门槛后领取来源对应的奖励。',
  family:'并肩最高档在战斗后推进劫掠；存活的家族成员越多，推进越快。到达战利品目标后，可在多种奖励中领取一项。',
  junkerKing:'铸军每三场已结算战斗开放一次军械铺，只能为场上最强的维娜选择一项永久机甲升级。升级需金币；备用零件免费。',
});

function economyCopyFor(catalog) {
  if (catalog.prototypeSeason?.id !== 'resonance-factions-1') return { ...prototypeEconomyCopy };
  const name = (id, fallback) => catalog.pacts?.[id]?.name ?? fallback;
  const academy = name('academy', '研发院');
  const risk = name('risk', '险境');
  const conqueror = name('conqueror', '远征');
  const family = name('family', '并肩');
  const armory = name('armory', '铸军');
  return {
    academy: `${academy}每局确定三件赞助装备；达到不同人数档位后，累计领取一、二或三件。赞助装备的持有者获得生命与伤害增幅，${academy}干员加成更高。`,
    chemBaron: `${risk}干员在每场战斗后积累微光，连败时积累更多，胜利会重置连败。每积累一百微光，可选择一件违禁装备或略过市场；略过会提高${risk}干员生命。`,
    conqueror: `${conqueror}干员击倒敌人累积征服进度；达到宝箱目标即可领取奖励。`,
    family: `${family}最高档在战斗后推进劫掠；存活的${family}成员越多，推进越快。到达战利品目标后，可在多种奖励中领取一项。`,
    junkerKing: `${armory}每三场战斗开放一次军械铺，可为场上最强的${armory}干员选择一项永久升级。升级需金币；备用零件免费。`,
  };
}

/** Injects mode-backed economy items and immutable source tables into a v3 catalog. */
export function applyPrototypeEconomy(catalog={}) {
  const economyCopy=economyCopyFor(catalog);
  const riskName=catalog.prototypeSeason?.id==='resonance-factions-1'?(catalog.pacts?.risk?.name??'险境'):'险境';
  const equipment={...(catalog.equipment??{})};
  const sourceChemRows=Array.isArray(catalog.prototypeSeason?.chemBaronItems)?catalog.prototypeSeason.chemBaronItems:[];
  const projectedChem=sourceChemRows.length?sourceChemRows.map(row=>adaptChemItem(row,catalog.prototypeSeason)).filter(Boolean):chemBaronItems.map(row=>{
    const sourceEffects=structuredClone(row.sourceEffects??{}),effectiveEffects=chemEffectiveEffects(catalog.prototypeSeason,sourceEffects);
    const stats={...row.stats,health:nativeFlatAmount(catalog.prototypeSeason,row.stats?.health??0)};
    const effect=structuredClone(row.effect);
    if(effect.kind==='attack_true_damage')effect.amount=nativeFlatAmount(catalog.prototypeSeason,effect.amount);
    const description=`${chemStatCopy(stats)?`${chemStatCopy(stats)}。`:''}${row.sourceApiName.endsWith('ChemGrips')?`受到的伤害降低${effect.amount}%。`:row.sourceApiName.endsWith('MageGuard')?`每${effect.interval}秒额外获得${effect.perTickPct}点法术强度。`:`普攻额外造成${effect.amount}点真实伤害。`}`;
    return {...row,sourceEffects,effectiveEffects,stats,effect,description};
  });
  const chemById=new Map(projectedChem.map((row)=>[row.id,row]));
  for(const record of chemById.values()){
    equipment[record.id]={id:record.id,name:record.name,kind:'passive',unique:record.unique===true,grantAllowed:true,prototype:true,
      source:{game:'Teamfight Tactics',version:'Set 13 launch patch 14.23',apiName:record.sourceApiName,sourceEffectText:record.sourceDescription,sourceEffects:structuredClone(record.sourceEffects??{}),
        sourceKind:'CommunityDragon pinned 14.23 client extract; official overview establishes the trait and item family, not this exact item record'},
      description:record.description,prototypeEconomyTier:record.tier??'Bronze',prototypeEconomyEffect:structuredClone(record.effect),prototypeEconomyStats:structuredClone(record.stats),prototypeSourceEffects:structuredClone(record.sourceEffects??{}),prototypeEffectiveEffects:structuredClone(record.effectiveEffects??record.sourceEffects??{}),...(record.modeAdaptation?{prototypeModeAdaptation:record.modeAdaptation}:{}),effects:[]};
  }
  // Faction season 2 has no sponsor economy and grants its native replacement instead (rewardItemSubstitutions).
  const retiredGuardbreaker=Object.hasOwn(catalog.prototypeSeason?.rewardItemSubstitutions??{},'Guardbreaker');
  if(equipment.giantSlayer&&!equipment.prototype_academy_guardbreaker&&!retiredGuardbreaker){
    equipment.prototype_academy_guardbreaker={...structuredClone(equipment.giantSlayer),id:'prototype_academy_guardbreaker',name:'破障重刃',unique:false,prototype:true,
      description:'攻击增幅装备。',source:{game:'TFT Set 13 Academy Sponsored Items',version:'14.23',apiName:'Guardbreaker',sourceKind:'LoLCHESS Set 13 source table; projected to the existing Resonance damage-amplification effect profile'}};
  }
  const sponsorSets=academySponsorSets.map((entries)=>({sourceNames:entries.map(([name])=>name),itemIds:entries.map(([,id])=>id)}))
    .filter((set)=>set.itemIds.length===3&&new Set(set.itemIds).size===3&&set.itemIds.every((id)=>equipment[id]?.kind==='completed'&&equipment[id].grantAllowed!==false));
  const academyPool=[...new Set(sponsorSets.flatMap((set)=>set.itemIds))].sort();
  const sponsorOptions=[...new Map(sponsorSets.flatMap((set)=>set.sourceNames.map((sourceName,index)=>{
    const id=set.itemIds[index],item=equipment[id];
    return [id,{id,label:item.name??id,description:'领取本局赞助装备。',cost:{currency:'gold',amount:0},grant:[{kind:'item',id}],sourceName,
      sourceMapping:'Set 13赞助装备按用途映射至共鸣现有装备；战斗机制与数值使用本模式规则。'}];
  }))).values()];
  const componentIds=Object.values(equipment).filter((item)=>item?.kind==='component'&&item.grantAllowed!==false&&item.id).map((item)=>item.id).sort();
  const completedGearIds=Object.values(equipment).filter((item)=>item?.kind==='completed'&&item.grantAllowed!==false&&item.id).map((item)=>item.id).sort();
  const gearPools={completed:completedGearIds,artifact:completedGearIds,support:completedGearIds,radiant:completedGearIds};
  gearPools.chemBaron=chemBaronItems.map((item)=>item.id).filter((id)=>equipment[id]?.grantAllowed!==false);
  for(const tier of Object.keys(CHEM_CONSUMABLE_BY_TIER))gearPools[`chemBaron${tier}`]=[...chemById.values()].filter((item)=>item.tier===tier&&equipment[item.id]?.grantAllowed!==false).map((item)=>item.id).sort();
  const qualityEffects={};
  for(const quality of ['artifact','support','radiant','radiant_conversion']){
    qualityEffects[quality]={};
    for(const id of gearPools[quality==='radiant_conversion'?'radiant':quality]??completedGearIds){
      const item=equipment[id],stats={};
      for(const effect of item.baseEffects??item.effects??[]){if(effect?.kind!=='component_stat')continue;for(const [key,value] of Object.entries(effect.params??{}))if(Number.isFinite(Number(value)))stats[key]=(stats[key]??0)+Number(value);}
      const factor=quality==='artifact'?0.5:quality==='support'?0.25:quality==='radiant'?1:0.5;
      // the same stat reading as the equipment installer (equipment.js equipmentRowMods): percentages in percent,
      // ASPD / RES in points, sp = SP per second; flat ATK/DEF/HP only on pre-rework rows. Initial SP is not a battle stat.
      const mods={};
      for(const [source,target,scale] of [['atkPct','atkPct',0.01],['defPct','defPct',0.01],['hpPct','hpPct',0.01],['resIgnorePct','resIgnorePct',0.01],['aspd','aspd',1],['res','resFlat',1],['sp','spRecoveryFlat',1]])
        if(stats[source])mods[target]=stats[source]*scale*factor;
      if(stats.hp)mods.hpFlat=Math.round(stats.hp*factor);
      if(stats.atk)mods.atkFlat=Math.round(stats.atk*factor);
      if(stats.def)mods.defFlat=Math.round(stats.def*factor);
      qualityEffects[quality][id]={mods,qualityBonus:quality==='artifact'?'装备基础属性提高50%':quality==='support'?'装备基础属性提高25%，并为全队提供小幅支援':quality==='radiant'?'装备基础属性提高100%':'辉光升格后，装备基础属性提高50%',...(quality==='support'?{teamMods:{atkPct:0.05}}:{})};
    }
    const sourceFactor=quality==='artifact'||quality==='radiant_conversion'?0.5:quality==='support'?0.25:1;
    for(const sourceGear of prototypeSourceGearDefinitions){
      if(!equipment[sourceGear.id])continue;
      qualityEffects[quality][sourceGear.id]={sourceStatsFactor:sourceFactor,qualityBonus:quality==='radiant'?'来源装备基础属性提高100%':`来源装备基础属性提高${Math.round(sourceFactor*100)}%`,adaptation:'仅增加来源装备的基础属性；不复制或强化其被动效果。'};
    }
  }
  const gearConsumables={
    prototype_item_remover:{id:'prototype_item_remover',name:'卸除器',kind:'remover',description:'将一件干员携带的装备卸下并放回背包。',source:'Set 13 Chem-Baron / Conqueror reward tables',adaptation:'保留本模式原装备及品质；背包满时无法使用。'},
    prototype_reforger:{id:'prototype_reforger',name:'重铸器',kind:'reforger',description:'将一件装备重铸为同类的另一件可用装备。',source:'Set 13 Conqueror reward table',adaptation:'按本模式当前可获得的同类装备池确定性重铸。'},
    prototype_completed_anvil:{id:'prototype_completed_anvil',name:'成装铁砧',kind:'anvil',quality:'completed',description:'从本模式已完成装备中选择一件。',source:'Set 13 Conqueror reward table',adaptation:'装备效果遵循本模式规则。'},
    prototype_artifact_anvil:{id:'prototype_artifact_anvil',name:'遗物铁砧',kind:'anvil',quality:'artifact',description:'从本模式已完成装备中选择一件遗物强化装备；额外获得该装备基础属性的50%。',source:'Set 13 Family Heist / Conqueror reward tables',adaptation:'以本模式装备与战斗属性实现遗物强化。'},
    prototype_support_anvil:{id:'prototype_support_anvil',name:'辅助装备铁砧',kind:'anvil',quality:'support',description:'选择一件辅助强化装备；装备基础属性提高25%，全队攻击提高5%。',source:'Set 13 Conqueror reward table',adaptation:'将辅助装备团队增益映射到本模式全队攻击属性。'},
    prototype_radiant_anvil:{id:'prototype_radiant_anvil',name:'辉光铁砧',kind:'anvil',quality:'radiant',description:'从本模式已完成装备中选择一件辉光强化装备；额外获得该装备基础属性。',source:'Set 13 Conqueror reward table',adaptation:'以本模式装备与战斗属性实现辉光强化。'},
    prototype_radiant_conversion:{id:'prototype_radiant_conversion',name:'辉光转化器',kind:'radiant_conversion',description:'将一件未强化装备升为辉光品质；其基础属性提高50%。',source:'Set 13 Conqueror reward table',adaptation:'对已装备或背包装备添加本模式辉光强化品质。'},
    prototype_thiefs_gloves:{id:'prototype_thiefs_gloves',name:'窃盗手套',kind:'thiefs_gloves',description:'打开后获得两件随机本模式成装。',source:'Set 13 Conqueror reward table',adaptation:'从本模式可获得成装池各抽取一件。'},
    prototype_roster_crown:{id:'prototype_roster_crown',name:'战术王冠',kind:'roster_crown',description:'提高一格上阵容量，最多提高两格。',source:'Set 13 Conqueror reward table',adaptation:'用于本模式战场部署容量。'},
  };
  const familyHeistOptions={...Object.fromEntries(Object.entries(FAMILY_REWARDS).map(([threshold,rows])=>[threshold,rows.map((row)=>({...row}))]))};
  return {...catalog,equipment,prototypeEconomy:{...(catalog.prototypeEconomy??{}),
    source:{...prototypeEconomySources},rules:{...prototypeEconomyRules},copy:economyCopy,
    academy:{...(catalog.prototypeEconomy?.academy??{}),eligibleItemIds:academyPool,sponsorSets,sponsorOptions},
    chemBaron:{...(catalog.prototypeEconomy?.chemBaron??{}),marketOptionsByThreshold:chemMarketOptions(),marketOptions:chemBaronItems.map((item)=>({id:item.id,label:item.name,description:item.description,
      grant:[{kind:'item',id:item.id}],cost:{currency:'shimmer',amount:0},sourceApiName:item.sourceApiName})),
      skipOption:{id:'skip-market',label:'略过市场',description:`略过本次市场，${riskName}干员获得本档生命加成。`,cost:{currency:'shimmer',amount:0},action:'skip'}},
    conqueror:{...(catalog.prototypeEconomy?.conqueror??{}),chestOptionsByThreshold:Object.fromEntries(Object.entries(CHEST_REWARDS).map(([threshold,rows])=>[threshold,rows.map((row)=>({...row}))]))},
    family:{...(catalog.prototypeEconomy?.family??{}),heistOptionsByThreshold:familyHeistOptions},
    gearConsumables:{...gearConsumables,...Object.fromEntries(Object.entries(CHEM_CONSUMABLE_BY_TIER).map(([tier,id])=>[id,{id,name:`${CHEM_TIER_NAMES[tier]}违禁装备选择`,kind:'anvil',quality:`chemBaron${tier}`,description:`从${CHEM_TIER_NAMES[tier]}${riskName}装备中选择一件。`,source:'Set 13 Chem-Baron Black Market reward rows',adaptation:'保留来源装备属性与效果，转译为本模式干员战斗属性及事件。'}]))},gearPools,qualityEffects,
    junkerKing:{...(catalog.prototypeEconomy?.junkerKing??{}),upgradeOptions:[...(catalog.prototypeSeason?.junkerKingUpgrades??junkerKingUpgrades).map((row)=>({id:row.id,label:row.name,description:row.description,cost:{currency:'gold',amount:row.price},grant:[{kind:'rumble_upgrade',id:row.id}],sourceApiName:row.sourceApiName,priceAdaptation:row.priceAdaptation})),{id:'skip-armory',label:'暂不购买',description:'本轮保留金币。',action:'skip',cost:{currency:'gold',amount:0}}]},
  }};
}
