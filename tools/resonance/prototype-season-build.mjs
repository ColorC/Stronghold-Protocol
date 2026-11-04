import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { PROTOTYPE_FORM_SWAP } from '../../shared/resonance/prototype-form.js';
import { academySponsorSets, prototypeEconomySources } from '../../shared/resonance/prototype-economy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inputPath = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft-set13-14.23.json';
const nativeDataPath = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const outputPath = path.join(root, 'shared/resonance/prototype-season.js');
const jsonDocPath = path.join(root, 'docs/resonance/prototype-season.json');
const markdownDocPath = path.join(root, 'docs/resonance/prototype-season.md');
const logPath = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/prototype-season-build.log';
const mappings = [
  'Amumu=角峰','Darius=艾丝黛尔','Draven=普罗旺斯','Irelia=古米','Lux=调香师','Maddie=送葬人','Morgana=深靛','Powder=凯瑟琳','Singed=香草','Steb=清流','Trundle=宴','Vex=耶拉','Violet=休谟斯','Zyra=格雷伊',
  'Akali=德克萨斯','Camille=砾','Leona=泡泡','Nocturne=因陀罗','Rell=雷蛇','Renata Glasc=赫默','Sett=深巡','Tristana=能天使','Urgot=灰毫','Vander=折桠','Vladimir=刺玫','Zeri=隐现','Ziggs=惊蛰',
  'Blitzcrank=星熊','Cassiopeia=巫恋','Ezreal=雪猎','Gangplank=风丸','Kog\'Maw=白金','Loris=瑕光','Nami=流明','Nunu & Willump=幽灵鲨','Renni=摩根','Scar=缄默德克萨斯','Smeech=伊内丝','Swain=薄绿','Twisted Fate=诗怀雅',
  'Ambessa=锏','Corki=号角','Dr. Mundo=乌尔比安','Ekko=拉普兰德','Elise=归溟幽灵鲨','Garen=塞雷娅','Heimerdinger=白面鸮','Illaoi=歌蕾蒂娅','Silco=多萝西','Twitch=远牙','Vi=耀骑士临光','Zoe=卡涅利安',
  'Caitlyn=蕾缪安','Jayce=缪尔赛思','Jinx=凛御银灰','LeBlanc=令','Malzahar=圣聆初雪','Mordekaiser=余','Rumble=维娜·维多利亚','Sevika=新约能天使',
].map((value) => value.split('='));
const pactIds = {
  Automata:'creation', Sorcerer:'arts', Scrap:'rhodes', Artillerist:'artillery', 'Form Swapper':'formSwap', Emissary:'emissary', Sentinel:'sentinel', Family:'family', Ambusher:'redeploy', Visionary:'logistics', Sniper:'ammo', Conqueror:'conqueror', 'High Roller':'holyGun', Academy:'academy', 'Chem-Baron':'risk', Rebel:'resistance', Dominator:'dominator', 'Pit Fighter':'breaker', Enforcer:'enforcer', Firelight:'flight', Experiment:'experiment', Bruiser:'bruiser', 'Junker King':'armory', 'Black Rose':'sui', Quickstriker:'combo', Watcher:'watcher',
};
const pactNames = { creation:'机巧',arts:'术式',rhodes:'战地整备',artillery:'炮术',formSwap:'双形',emissary:'领军',sentinel:'坚阵',family:'并肩',redeploy:'突袭',logistics:'技力协同',ammo:'狙击',conqueror:'远征',holyGun:'圣枪',academy:'研发',risk:'险境',resistance:'逆潮',dominator:'掌控',breaker:'决斗',enforcer:'围剿',flight:'游击',experiment:'共生',bruiser:'重装',armory:'铸军',sui:'幻造',combo:'迅击',watcher:'守望' };
const emblemTraitByApi = {TFT13_Item_AcademyEmblemItem:'academy',TFT13_Item_AmbusherEmblemItem:'redeploy',TFT13_Item_AutomataEmblemItem:'creation',TFT13_Item_BruiserEmblemItem:'bruiser',TFT13_Item_CabalEmblemItem:'sui',TFT13_Item_ChallengerEmblemItem:'combo',TFT13_Item_CrimeEmblemItem:'risk',TFT13_Item_DemolitionistEmblemItem:'artillery',TFT13_Item_ExperimentEmblemItem:'experiment',TFT13_Item_FamilyEmblemItem:'family',TFT13_Item_HoverboardEmblemItem:'flight',TFT13_Item_InfusedEmblemItem:'dominator',TFT13_Item_InvokerEmblemItem:'logistics',TFT13_Item_PitFighterEmblemItem:'breaker',TFT13_Item_RebelEmblemItem:'resistance',TFT13_Item_ScrapEmblemItem:'rhodes',TFT13_Item_SniperEmblemItem:'ammo',TFT13_Item_SorcererEmblemItem:'arts',TFT13_Item_SquadEmblemItem:'enforcer',TFT13_Item_TitanEmblemItem:'sentinel',TFT13_Item_WarbandEmblemItem:'conqueror',TFT13_Item_WatcherEmblemItem:'watcher'};
const augmentTraitByPrefix={Academy:'academy',Ambusher:'redeploy',Automata:'creation',Bruiser:'bruiser','Black Rose':'sui',Quickstriker:'combo','Chem-Baron':'risk',Artillerist:'artillery',Experiment:'experiment',Family:'family',Firelight:'flight',Dominator:'dominator',Visionary:'logistics','Pit Fighter':'breaker',Rebel:'resistance',Scrap:'rhodes',Sniper:'ammo',Sorcerer:'arts',Enforcer:'enforcer',Sentinel:'sentinel',Conqueror:'conqueror',Watcher:'watcher'};
const battleAugmentByApi={
  TFT13_Augment_Automata:{kind:'automata_second_blast',name:'晶碎回响',traitId:'creation',description:'机巧的晶体爆破会额外弹射至最近敌人，造成原爆破一半伤害。',grantedHeroes:['Amumu','Nocturne']},
  TFT13_Augment_Bruiser:{kind:'bruiser_health_strike',name:'重装猛击',traitId:'bruiser',description:'每4秒，重装下一次攻击额外造成相当于目标最大生命值7%的物理伤害。',grantedHeroes:['Steb','Trundle']},
  TFT13_Augment_Conqueror:{kind:'conqueror_execute',name:'远征断头台',traitId:'conqueror',description:'远征攻击生命值低于12%的敌人时将其击倒；击倒后获得5点双抗，持续整场战斗。',grantedHeroes:['Darius','Draven']},
  TFT13_Augment_Dominator:{kind:'dominator_shield_rush',name:'掌盾支配',traitId:'dominator',description:'掌控干员持有护盾时获得10%攻速；掌控干员击倒敌人后，全体掌控获得100点护盾，持续3秒。',grantedHeroes:['Cassiopeia']},
  TFT13_Augment_Quickstriker:{kind:'quickstriker_burst',name:'迅击爆发',traitId:'combo',description:'战斗开始并每6秒，迅击干员攻速提高85%，持续2.5秒。',grantedHeroes:['Nocturne','Akali']},
  TFT13_Augment_Sentinel:{kind:'sentinel_shield_bash',name:'坚阵盾击',traitId:'sentinel',description:'坚阵干员双抗提高5%；每4秒下一次攻击额外造成总双抗75%的法术伤害。',grantedHeroes:['Loris']},
  TFT13_Augment_Sorcerer:{kind:'sorcerer_death_burst',name:'术式还击',traitId:'arts',description:'术式干员倒下时，对相邻单位造成相当于其法术强度3倍的法术伤害。',grantedHeroes:['Vladimir']},
  TFT13_Augment_Watcher:{kind:'watcher_battle_scars',name:'守望战痕',traitId:'watcher',description:'守望干员每受到一次普通攻击，攻击力提高2%；每受到一次技能命中，法术强度提高4点。',grantedHeroes:['Vander']},
};
const roleBudget = { frontline:[1.55,.75],damage:[.8,1.1],control:[.85,.8],healer:[.8,.75],summoner:[.85,.75],support:[.85,.65] };
const escapeRegExp=(value)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const containsWholeMention=(text,name)=>{
  const term=String(name??'').trim();if(!term)return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?=$|[^\\p{L}\\p{N}])`,'iu').test(String(text??''));
};
// Role is an ability-budget bucket. Camille's mapped native fixed kit is a deployment shield,
// so it belongs to frontline despite the legacy catalog's generic damage label.
const roleBySourceApi = { TFT13_Camille:'frontline' };
function log(line) { fs.mkdirSync(path.dirname(logPath), { recursive: true }); fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const ref = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
assert(ref.provenance?.patch === '14.23' || JSON.stringify(ref.provenance).includes('14.23'), 'SET13_REFERENCE_VERSION_MISMATCH');
const prototypeEntityRows = ref.prototypeEntities?.entities ?? {};
const summonedEntityRows = Object.fromEntries(Object.entries(prototypeEntityRows).filter(([id]) => id !== 'TFT_TrainingDummy'));
const trainingDummySource = prototypeEntityRows.TFT_TrainingDummy;
const specialEntityRows = trainingDummySource ? {
  TFT_TrainingDummy: {
    id:'TFT_TrainingDummy', kind:'training_dummy', nativeTokenId:trainingDummySource.modeAdaptation?.visualNativeToken,
    maxHp:Number(trainingDummySource.stats?.hp??0), def:Number(trainingDummySource.stats?.armor??0), res:Number(trainingDummySource.stats?.magicResist??0),
    atk:0, aspd:0, range:Number(trainingDummySource.stats?.range??0), blockCount:Number(trainingDummySource.modeAdaptation?.nativeBlockCount??0),
    attackDisabled:trainingDummySource.modeAdaptation?.noAttack===true, canMove:trainingDummySource.modeAdaptation?.noMove!==true,
    stageScaling:null, source:{version:trainingDummySource.sourceVersion,apiName:trainingDummySource.apiName,name:trainingDummySource.name,description:trainingDummySource.ability?.desc,stats:trainingDummySource.stats,ability:trainingDummySource.ability,url:trainingDummySource.sourceUrl},
    adaptation:{visualOnly:trainingDummySource.modeAdaptation?.visualOnly===true,blockCountSource:trainingDummySource.modeAdaptation?.blockCountSource},
  },
} : {};
const nativeData = getData({ dir:nativeDataPath });
const native = getResonanceCatalog(nativeData, { rulesVersion: 2, seed: 1 });
const byName = new Map();
for (const op of Object.values(native.operators)) {
  const rows = byName.get(op.name) ?? [];
  rows.push(op);
  byName.set(op.name, rows);
}
assert(mappings.length === 60 && new Set(mappings.map(([name]) => name)).size === 60, 'PROTOTYPE_MAPPING_COUNT');
const mapByTftName = new Map();
const mappedCharIds = new Set();
const heroes = mappings.map(([tftName, operatorName]) => {
  const source = ref.naturalChampions.find((row) => row.name === tftName);
  assert(source, `TFT_HERO_MISSING:${tftName}`);
  const matches = byName.get(operatorName) ?? [];
  assert(matches.length === 1, `NATIVE_OPERATOR_NAME_NOT_UNIQUE:${operatorName}:${matches.length}`);
  const op = matches[0];
  const sourceNumber=(value)=>value==null?null:Number(value);
  const powerReference={hp:sourceNumber(source.stats?.hp),attackDamage:sourceNumber(source.stats?.damage),armor:sourceNumber(source.stats?.armor),magicResist:sourceNumber(source.stats?.magicResist),attackSpeed:sourceNumber(source.stats?.attackSpeed),range:sourceNumber(source.stats?.range)};
  assert(['hp','attackDamage','armor','attackSpeed','range'].every((key)=>Number.isFinite(powerReference[key])),`PROTOTYPE_POWER_SOURCE_STATS_MISSING:${source.apiName}`);
  const experimentAbilityVariables={
    TFT13_Zyra:['ExperimentTrueDamage','ExperimentDuration'],
    TFT13_Urgot:['ExperimentPercentHealthShield','ExperimentAttackSpeed','ExperimentDuration'],
    TFT13_NunuWillump:['ExperimentMaxHealthDamage','ExperimentICD'],
    TFT13_DrMundo:['BaseExperimentHealthGain','ExperimentHealthGain'],
    TFT13_Twitch:['ExperimentDamageTicks','ExperimentMaxHealthDamage'],
  }[source.apiName];
  const experimentBonus=experimentAbilityVariables?{
    sourceApiName:source.apiName,sourceAbilityName:source.ability?.name??null,sourceAbilityDescription:source.ability?.desc??null,
    sourceVariables:Object.fromEntries(experimentAbilityVariables.map((name)=>[name,source.ability?.variables?.find((entry)=>entry.name===name)?.value?.[0]??null])),
    ...(source.apiName==='TFT13_NunuWillump'?{sourceAmbiguity:'The pinned tooltip says max-health bonus magic damage but does not identify whose maximum health.',modeAdaptation:{maxHealthBasis:'holder',reason:'Use the Experiment holder’s maximum health for a self-scaling bruiser bonus; this is a mode interpretation, not a resolved TFT source fact.'}}:{}),
    trigger:({TFT13_Zyra:'ability_damage_bleed',TFT13_Urgot:'combat_start_and_after_cast',TFT13_NunuWillump:'after_damage_cooldown',TFT13_DrMundo:'combat_start_and_takedown',TFT13_Twitch:'every_n_attacks'}[source.apiName]),
  }:null;
  const row = { apiName: source.apiName, name: source.name, sourceChessId: op.sourceChessId, charId: op.charId, operatorName: op.name, cost: source.cost, role: roleBySourceApi[source.apiName]??op.role, tftRole: source.role, traits: [...source.traits], ...(experimentBonus?{experimentBonus}:{}),powerReference:{...powerReference,source:'CommunityDragon client data',version:'Set 13 patch 14.23',apiName:source.apiName} };
  assert(!mapByTftName.has(source.apiName) && !mappedCharIds.has(op.charId), `DUPLICATE_PROTOTYPE_HERO:${tftName}`);
  mapByTftName.set(source.apiName, row);
  mappedCharIds.add(op.charId);
  return row;
});
const counts = Object.fromEntries([1,2,3,4,5].map((cost) => [cost, heroes.filter((h) => h.cost === cost).length]));
assert(JSON.stringify(counts) === JSON.stringify({1:14,2:13,3:13,4:12,5:8}), `PROTOTYPE_COST_COUNTS:${JSON.stringify(counts)}`);
const traits = ref.naturalTraits.map((source) => {
  const id = pactIds[source.name];
  assert(id, `UNMAPPED_NATURAL_TRAIT:${source.name}`);
  const members = source.naturalMemberApiNames.map((apiName) => {
    const hero = mapByTftName.get(apiName);
    assert(hero, `TRAIT_MEMBER_OUTSIDE_PROTOTYPE_ROSTER:${source.name}:${apiName}`);
    return hero.charId;
  });
  const effects = source.effects.map((tier) => ({ minUnits:tier.minUnits, maxUnits:tier.maxUnits, style:tier.style, variables:tier.variables }));
  const maxTierMembers = Math.max(...effects.map((tier) => tier.minUnits));
  return { id, name:pactNames[id], sourceName:source.name, sourceApiName:source.apiName, description:source.desc, icon:source.icon, naturalMemberApiNames:source.naturalMemberApiNames, naturalMemberNames:source.naturalMemberNames, members, memberCount:members.length, costDistribution:Object.fromEntries([1,2,3,4,5].map((cost)=>[cost,members.filter((member)=>heroes.find((h)=>h.charId===member)?.cost===cost).length])), maxNaturalMembers:members.length, maxTierMembers, emblemRequired:maxTierMembers>members.length, effects, ...(id==='arts'?{modeAdaptation:{sourceConcept:'AP',nativeStat:'artsDealtMul',playerTerm:'术法伤害提高',rule:'non-members receive TeamAP; members receive BaseAP as their total bonus, without stacking TeamAP',reference:'CommunityDragon Set 13 patch 14.23 trait variables; native simulator adaptation'}}:{}), reference:{game:'Teamfight Tactics',version:'Set 13 launch patch 14.23',sourceKind:'CommunityDragon raw game-data extract, pinned to patch 14.23; official patch notes establish launch context, not complete mechanics',referenceData:inputPath} };
});
assert(traits.length === 26 && new Set(traits.map((t)=>t.sourceName)).size===26, 'PROTOTYPE_NATURAL_TRAIT_COUNT');
const emblemCandidates=ref.equipmentCandidates.filter((row)=>emblemTraitByApi[row.apiName]).map((row)=>({apiName:row.apiName,name:row.name,description:row.desc,icon:row.icon,composition:row.composition??null,effects:row.effects,incompatibleTraits:row.incompatibleTraits??[],unique:row.unique??false,traitId:emblemTraitByApi[row.apiName],recipeEvidence:row.composition?'source-recipe':'source-composition-unknown'}));
const chemBaronItems=ref.equipmentCandidates.filter((row)=>/^TFT13_Crime_(Bronze|Silver|Gold|Prismatic|OmegaPrismatic)_/.test(row.apiName)).map((row)=>({apiName:row.apiName,name:row.name,description:row.desc??null,unique:row.unique??false,effects:row.effects??{},tier:row.apiName.match(/^TFT13_Crime_([^_]+)_/)?.[1]??'unknown'}));
assert(chemBaronItems.length===28,`CHEM_BARON_ITEM_COUNT:${chemBaronItems.length}`);
const augmentCandidates=ref.augmentCandidates.filter((row)=>row.apiName.startsWith('TFT13_Augment_')&&(/( Crest| Crown)$/.test(row.name)||battleAugmentByApi[row.apiName])).map((row)=>{
  const prefix=Object.keys(augmentTraitByPrefix).sort((a,b)=>b.length-a.length).find((name)=>row.name.startsWith(`${name} `));
  const traitId=battleAugmentByApi[row.apiName]?.traitId??(prefix?augmentTraitByPrefix[prefix]:null);
  assert(traitId,`UNMAPPED_PROTOTYPE_AUGMENT:${row.name}`);
  const grantedHeroes=ref.naturalChampions.filter((hero)=>containsWholeMention(row.desc,hero.name)).map((hero)=>({apiName:hero.apiName,sourceName:hero.name,name:mapByTftName.get(hero.apiName)?.operatorName??hero.name,charId:mapByTftName.get(hero.apiName)?.charId??null,operatorId:mapByTftName.get(hero.apiName)?.sourceChessId??null}));
  const grantedItems=ref.equipmentCandidates.filter((item)=>item.name?.trim()&&containsWholeMention(row.desc,item.name)).map((item)=>({apiName:item.apiName,name:item.name,sourceComposition:item.composition??null}));
  const battleAugment=battleAugmentByApi[row.apiName];
  const modeRewardPool=row.apiName==='TFT13_Augment_AcademyCrown'?{
    kind:'academy_sponsor',
    sourceUrl:prototypeEconomySources.academyTable,
    sourceKind:'Set 13 sponsor group reference, adapted to existing Resonance equipment IDs',
    sets:academySponsorSets.map((set)=>({sourceNames:set.map(([name])=>name),itemIds:set.map(([,itemId])=>itemId)})),
  }:null;
  const adaptation=battleAugment?.description??`获得「${pactNames[traitId]}」转职徽记；原型来源赠送单位：${grantedHeroes.map((hero)=>hero.name).join('、')||'无'}。${modeRewardPool?'本模式按赞助装备映射池随机获得一件装备。':grantedItems.length?'来源还点名了装备：'+grantedItems.map((item)=>item.name).join('、')+'。':'来源未解析出指定装备。'}`;
  const suffix=/ Crown$/.test(row.name)?'王冠':' 徽记';
  return {apiName:row.apiName,name:row.name,displayName:battleAugment?.name??`${pactNames[traitId]}${suffix}`,description:row.desc,icon:row.icon,effects:row.effects??{},associatedTraits:row.associatedTraits??[],traitId,adaptation,adapter:battleAugment?'battle':'choose_transfer',mechanic:battleAugment?.kind??null,grantedHeroes,grantedItems,...(modeRewardPool?{modeRewardPool}:{}),reference:{game:'Teamfight Tactics',version:'Set 13 launch patch 14.23',sourceKind:'CommunityDragon raw game-data extract',referenceData:inputPath}};
});
// This input list is the exact 308-row resolveSetList(Set 13) result. Many
// candidates reuse older TFT API prefixes and 52 have no numeric effects;
// retain every resolved row as reference data and leave adaptation to runtime.
const strategyCandidates=ref.augmentCandidates.map((row)=>{
  const grantedHeroes=ref.naturalChampions.filter((hero)=>containsWholeMention(row.desc,hero.name)).map((hero)=>({apiName:hero.apiName,sourceName:hero.name,name:mapByTftName.get(hero.apiName)?.operatorName??hero.name,charId:mapByTftName.get(hero.apiName)?.charId??null,operatorId:mapByTftName.get(hero.apiName)?.sourceChessId??null}));
  const grantedItems=ref.equipmentCandidates.filter((item)=>item.name?.trim()&&containsWholeMention(row.desc,item.name)).map((item)=>({apiName:item.apiName,name:item.name,sourceComposition:item.composition??null}));
  return {apiName:row.apiName,name:row.name,description:row.desc,icon:row.icon??null,effects:row.effects??{},associatedTraits:row.associatedTraits??[],unique:row.unique??false,grantedHeroes,grantedItems,adapterHint:null,reference:{game:'Teamfight Tactics',version:'Set 13 launch patch 14.23',sourceKind:'CommunityDragon raw game-data extract',referenceData:inputPath,setListResolution:'SetData[number=13] resolveSetList result'}};
});
const payload = {
  id:'resonance-set13-14.23', displayName:'共鸣', rulesVersion:3,
  source:{game:'Teamfight Tactics',set:'Into the Arcane / Set 13',patch:'14.23 launch',url:ref.provenance.sourceUrl,referenceData:inputPath,extraction:'Only 60 natural TFT13 champions and 26 natural traits in SetData. Conditional Team-Up traits excluded. Champion-to-operator name mapping follows the approved fixed roster; native cost is replaced by the Set 13 cost. powerReference copies only pinned source champion hp/damage/armor/magicResist/attackSpeed/range for balancing projections.'},
  costDistribution:counts, heroes, traits, emblemCandidates, chemBaronItems, augmentCandidates,strategyCandidates,
  formSwapAdaptation:PROTOTYPE_FORM_SWAP,
  summonedEntities:summonedEntityRows,
  specialEntities:specialEntityRows,
  statAdapters:{armor:{source:'TFT armor rating',native:'flat def',formula:'sourceAttackDamage * armorRating / (100 + armorRating)',anchor:'the champion source attack damage; candidate power-budget equivalence, not formula parity'},magicResist:{source:'TFT magic-resistance rating',native:'percentage res',formula:'100 * magicResistRating / (100 + magicResistRating)',cap:'Native 100 resistance remains intact; source raw ratings stay in each hero powerReference'}},
  powerBudget:{oneStarBaseHp:[1100,1450,1900,2350,3100],oneStarBaseDps:[130,180,260,350,470],roleMultipliers:Object.fromEntries(Object.entries(roleBudget).map(([role,[hp,dps]])=>[role,{hp,dps}])),starMultipliers:{hp:[1,1.8,3.24],atk:[1,1.5,2.25]},starGrowthSource:{url:'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-12-14-notes/',rule:'TFT AD growth per star: base × 1 / 1.5 / 2.25; HP growth remains × 1 / 1.8 / 3.24.',adaptation:'Native fixed skills retain their own star scaling; battle contribution audit must include skill damage, healing, shields, control, and summons.'},note:'Candidate normalization budget. Fixed source skill, role scope, DEF, skill uptime and coverage must be included in battle audit before approval.'},
};
const source = `// Generated by tools/resonance/prototype-season-build.mjs from the pinned canonical Set 13 reference input.\nexport const prototypeSeason = Object.freeze(${JSON.stringify(payload,null,2)});\nexport const prototypeHeroByCharId = Object.freeze(Object.fromEntries(prototypeSeason.heroes.map((hero)=>[hero.charId,hero])));\nexport const prototypeTraitById = Object.freeze(Object.fromEntries(prototypeSeason.traits.map((trait)=>[trait.id,trait])));\n`;
fs.writeFileSync(outputPath, source, 'utf8');
fs.writeFileSync(jsonDocPath, `${JSON.stringify(payload,null,2)}\n`, 'utf8');
const traitTable=traits.map((trait)=>`| ${trait.name} (${trait.sourceName}) | ${trait.members.length} | ${JSON.stringify(trait.costDistribution)} | ${trait.effects.map((tier)=>`${tier.minUnits}–${tier.maxUnits===25000?'∞':tier.maxUnits}`).join(' / ')} | ${trait.emblemRequired?'需转职/额外身份':'自然人数可达'} | ${trait.naturalMemberNames.join('、')} |`).join('\n');
const traitVars=traits.map((trait)=>`### ${trait.name} · ${trait.sourceName}\n\n原始描述：${trait.description.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}\n\n档位变量（Set 13 14.23 原始数值）：\n\n\`\`\`json\n${JSON.stringify(trait.effects,null,2)}\n\`\`\`\n`).join('\n');
const heroTable=heroes.map((hero)=>`| ${hero.cost} | ${hero.name} | ${hero.operatorName} | ${hero.role} | ${hero.traits.join('、')} |`).join('\n');
const markdown=`# 共鸣 Set 13 首发原型（14.23）\n\n此候选季采用 TFT Set 13 首发 patch 14.23 的自然英雄和天然羁绊作为机械原型。新局使用的规则版本由catalog入口配置决定，v1/v2存档读取路径保留。原始输入：\`${inputPath}\`。来源、排除规则及证据类型见下方。\n\n## 证据与口径\n\n- 自然英雄、天然羁绊成员、层级边界、描述和变量来自固定版本 CommunityDragon 客户端数据：${ref.provenance.sourceUrl}\n- 官方首发季与补丁页面仅确认 Set 13 发布背景，不声称官方页面完整列出所有成员/变量：${ref.provenance.primarySeasonSource}；${ref.provenance.primaryPatchSource}\n- 不含 conditional Team-Up traits；每个原型 trait 只按对应 Set 13 自然成员映射到本模式干员，不把干员原生国籍计为盟约。源 natural member 名称与 canonical operator ID 的映射由 compiler 唯一性校验。\n- 60个唯一干员槽位；费用数组：${JSON.stringify(counts)}。当前池只用于新 rulesVersion 3，v1/v2 保留读取。首发均统一“标准开局”。\n\n## 自然成员逐干员\n\n| 费 | Set 13 英文名 | 映射干员 | 原生角色 | Set 13 天然特性 |\n|---:|---|---|---|---|\n${heroTable}\n\n## 26 项天然特性\n\n费用分布对象的键为费档 1–5。档位区间直接来自该 patch 的 minUnits/maxUnits（25000 表示无上限）。exact 档位按原生区间保留，不统一门槛。\n\n| 中性盟约（Set 13 trait） | 自然人数 | 费用分布 | 档位区间 | 高档需额外身份 | Set 13 自然成员 |\n|---|---|---:|---|---|---|\n${traitTable}\n\n## 首版战力预算（待真实 Battle Audit）\n\n一星基础 HP 目标为 1100/1450/1900/2350/3100，DPS 目标为 130/180/260/350/470，依次对应费档 1–5。角色相对系数：\n\n${Object.entries(roleBudget).map(([role,[hp,dps]])=>`- ${role}: HP ×${hp}, DPS ×${dps}`).join('\n')}\n\n升星预算倍率：HP为1星 ×1、2星 ×1.8、3星 ×3.24；ATK为1星 ×1、2星 ×1.5、3星 ×2.25。固定技能保留其原生升星成长并纳入实战贡献校准。固定技能、冷却、覆盖范围、治疗、控制、召唤、装备及防御均须进入独立实战预算；这些标称数值不是强度验收结果。\n\n## 来源机制与完整变量\n\n${traitVars}`;
const withEmblems=markdown;
const rewardNames=(rows)=>rows?.length?rows.map((row)=>row.name??row.apiName??row.sourceName).filter(Boolean).join('、'):'未记录';
const augmentRows=augmentCandidates.map((augment)=>{
  const mode=augment.adapter==='battle'?'战斗效果以当前catalog为准':augment.adapter==='choose_transfer'?'转职与奖励以当前catalog为准':'当前catalog记录为准';
  const description=augment.description.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  return `| ${augment.name} | ${pactNames[augment.traitId]} | ${augment.apiName} | ${description} | ${rewardNames(augment.grantedHeroes)} | ${rewardNames(augment.grantedItems)} | ${mode} |`;
}).join('\n');
const augmentSection=[
  '',
  '## 转职与强化候选',
  '',
  '此表的附赠单位和物品来自锁定的Set 13来源记录；是否可选及本模式的实际奖励以rulesVersion 3 catalog为准，不表示来源附赠均已逐项复刻。',
  '',
  '| Set 13 强化 | 盟约 | Source API 名 | Set 13 原描述 | 来源记录中的单位 | 来源记录中的物品 | 当前模式适配 |',
  '|---|---|---|---|---|---|---|',
  augmentRows,
  ''
].join('\n');const finalMarkdown=withEmblems.replace('\n## 首版战力预算（待真实 Battle Audit）',`${augmentSection}\n## 首版战力预算（待真实 Battle Audit）`);
fs.writeFileSync(markdownDocPath, finalMarkdown, 'utf8');
log(`built ${outputPath}; heroes=${heroes.length}; traits=${traits.length}; costs=${JSON.stringify(counts)}`);
console.log(JSON.stringify({ outputPath, jsonDocPath, markdownDocPath, inputPath, bytes:Buffer.byteLength(source), docBytes:Buffer.byteLength(finalMarkdown), heroes:heroes.length, traits:traits.length, costs:counts }));
