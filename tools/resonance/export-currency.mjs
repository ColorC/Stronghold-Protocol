/** Fixed release-data ingestion. No discovery, media download, dependency install or game execution. */
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMMIT = '724b139d8c9c32d12552eb95745a4fee72bfe48b';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT = process.env.RESONANCE_CURRENCY_INPUT || 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/currency';
const OUTPUT = path.join(ROOT, 'docs/resonance/reference/currency-current.json');
const MARKDOWN = path.join(ROOT, 'docs/resonance/reference/currency-current.md');
const LIMIT = 100_000_000;
const TABLES = [
  'GridFightRoleBasicInfo','GridFightRoleConfig_Index_SeasonID','GridFightRoleStar','GridFightRoleSkillDisplay',
  'GridFightFrontSkill','GridFightBackBEData','GridFightBackBEConfig','GridFightBackBESkillConfig',
  'GridFightBackRoleRank','GridFightBackSkillExtraDesc','GridFightRolePropertyConfig','GridFightRankSkillModify',
  'GridFightRankAttachment','GridFightSkillDescMod','GridFightRoleGlobalModifier','GridFightRoleSwitchConfig',
  'GridFightTraitBasicInfo','GridFightTraitLayer','GridFightTraitMazebuff','GridFightTraitMazebuffPlus',
  'GridFightTraitRemark','GridFightTraitEffect','GridFightTraitEffectLayerPa','GridFightTraitThreshold',
  'GridFightSeasonTrait_Index_SeasonID','GridFightSeasonTraitShow','GridFightEquipment','GridFightItems','GridFightSeasonItem','GridFightSeasonCraft',
  'GridFightCraftConfig','GridFightEquipUpgrade','GridFightEquipMazebuff','GridFightAugment','GridFightAugmentMazebuff',
  'GridFightSeasonAugment','GridFightPortalBuff','GridFightPortalMazebuff','GridFightSeasonPortal',
  'GridFightPlayerLevel','GridFightRarityWeight','GridFightShopPrice','GridFightConstCommon','GridFightConstValueCommonV2',
  'GridFightTalent','GridFightSeasonTalent','GridFightSeasonModule','GridFightExpertRestrict',
  'GridFightModuleBanRole','GridFightModuleBanAugment','GridFightModuleBanPortal','AvatarConfig','AvatarConfigLD','AvatarSkillConfig','AvatarSkillConfigLD',
  'GridFightServantSkill','GridFightServantStar','GridFightBackServant','ExtraEffectConfig',
];
const sourceUrl = rel => `https://raw.githubusercontent.com/DimbreathBot/TurnBasedGameData/${COMMIT}/${rel}`;
const sourcePage = rel => `https://github.com/DimbreathBot/TurnBasedGameData/blob/${COMMIT}/${rel}`;
const values = x => Array.isArray(x) ? x : Object.values(x || {});
const exactParse = text => JSON.parse(text.replace(/(:\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
const inlineTextNames = new Map();

async function verifyAncestors(target) {
  let current = path.resolve(target);
  for (;;) {
    try { const stat = await lstat(current); if (stat.isSymbolicLink()) throw new Error(`LINK_PATH:${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
async function download(rel) {
  const destination = path.join(INPUT, `${path.basename(rel)}.gz`);
  try { const stat = await lstat(destination); if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) throw new Error(`UNSAFE_SOURCE_FILE:${destination}`); return destination; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(sourceUrl(rel), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`DOWNLOAD_${response.status}:${sourceUrl(rel)}`);
  await pipeline(Readable.fromWeb(response.body), createGzip({ level: 6 }), createWriteStream(destination, { flags: 'wx' }));
  return destination;
}
async function load(rel) {
  const file = await download(rel);
  const started = Date.now();
  const data = exactParse(gunzipSync(await readFile(file)).toString('utf8'));
  if (Date.now() - started > 60000) throw new Error(`PARSE_TIMEOUT:${file}`);
  return data;
}
function hashesOf(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (node.Hash !== undefined) out.add(String(node.Hash));
  for (const value of Object.values(node)) if (value && typeof value === 'object') hashesOf(value, out);
  return out;
}
function parameterValues(record, field) {
  if (field.startsWith('Simple') && record.SimpleParamList) return record.SimpleParamList;
  if (field === 'TraitEffectDesc' && record.DescParamList) return record.DescParamList;
  if (field === 'PropertyDesc' && record.PropertyParamList) return record.PropertyParamList;
  const base = field.replace(/(?:Simple)?Desc$|Name$|Title$/, '');
  return [record[`${base}ParamList`], field.startsWith('Front') ? record.FrontParamList : field.startsWith('Back') ? record.BackParamList : null,
    record[`${field}ParamList`], record.EffectParamList, record.BaseDescParamList, record.TraitRemarkParamList, record.ParamList, record.BackParamList]
    .find(params => Array.isArray(params) && params.length > 0) || [];
}
function formatText(template, params) {
  // TextMap also uses unformatted #N. Exclude markup so color literals and entry IDs stay intact.
  return template.split(/(<[^>]*>)/g).map(part => part.startsWith('<') ? part : part.replace(/#(\d+)(?:\[([if])(\d*)\])?(%?)(?![\d\[])/g, (token, index, kind, decimals, percent) => {
    const raw = params[Number(index) - 1]; const value = typeof raw === 'number' ? raw : raw?.Value;
    if (typeof value !== 'number') return token;
    const number = percent && kind ? value * 100 : value;
    return (kind === 'i' ? Math.round(number).toString() : kind === 'f' ? number.toFixed(Number(decimals || 1)) : String(number)) + percent;
  })).join('');
}
function parameterTokens(text) {
  return [...new Set(text.replace(/<[^>]*>/g, '').match(/#\d+(?:\[[^\]]*\])?|@[A-Za-z_][\w.]*/g) || [])];
}
function resolved(record, textMap, missing, parent = null, field = '') {
  if (record === null || typeof record !== 'object') return record;
  if (record.Hash !== undefined && Object.keys(record).length === 1) {
    const hash = String(record.Hash); const sourceText = textMap[hash]; const template = typeof sourceText === 'object' ? sourceText.text : sourceText;
    if (template === undefined) { missing.add(hash); return { hash, text: null, unresolved: true }; }
    const text = formatText(template, parameterValues(parent || {}, field)).replace(/<gridfightinfo\s+type=(\w+)\s+id=(\d+)[^>]*>/g,
      (token,type,id) => inlineTextNames.get(`${type}:${id}`) || token);
    const tokens = parameterTokens(text);
    const parameterUnitWarnings = template.replace(/<[^>]*>/g,'').match(/#\d+%/g) || [];
    return { hash, template, text, ...(typeof sourceText === 'object' ? { language:sourceText.language, fallback:true } : {}), ...(tokens.length ? { unresolvedParameters:tokens } : {}),
      ...(parameterUnitWarnings.length ? {parameterUnitWarnings:parameterUnitWarnings.map(token=>`${token}: raw numeric literal retained; runtime percentage-unit semantics unverified`)} : {}) };
  }
  if (Array.isArray(record)) return record.map(x => resolved(x, textMap, missing, parent, field));
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, resolved(value, textMap, missing, record, key)]));
}
async function totalBytes() {
  let total = 0;
  for (const entry of await readdir(INPUT, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`NON_FILE_INPUT:${path.join(INPUT, entry.name)}`);
    total += (await lstat(path.join(INPUT, entry.name))).size;
  }
  for (const file of [OUTPUT, MARKDOWN]) { try { total += (await lstat(file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  total += (await lstat(fileURLToPath(import.meta.url))).size;
  return total;
}
async function main() {
  const deadline = setTimeout(() => { console.error(JSON.stringify({ error:'STAGE_TIMEOUT', input:INPUT, output:OUTPUT, markdown:MARKDOWN })); process.exit(124); }, 60000);
  try {
    for (const target of [INPUT, OUTPUT, MARKDOWN]) await verifyAncestors(target);
    await mkdir(INPUT, { recursive: true }); await mkdir(path.dirname(OUTPUT), { recursive: true });
    try { const manifest = JSON.parse(await readFile(path.join(INPUT, 'source.json'), 'utf8')); if (manifest.commit !== COMMIT) throw new Error(`SOURCE_COMMIT_CONFLICT:${path.join(INPUT,'source.json')}:${manifest.commit}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const tables = {};
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < TABLES.length) { const name = TABLES[next++]; tables[name] = await load(`ExcelOutput/${name}.json`); }
    }));
    const textMap = await load('TextMap/TextMapCHS.json');
    const englishText = await load('TextMap/TextMapEN.json');
    for (const [hash,text] of Object.entries(englishText)) if (textMap[hash] === undefined) textMap[hash] = {text,language:'en'};
    const roleList = values(tables.GridFightRoleBasicInfo);
    const starList = values(tables.GridFightRoleStar);
    const avatars = new Map([...values(tables.AvatarConfig), ...values(tables.AvatarConfigLD)].map(x => [x.AvatarID, x]));
    const lookupText = hash => { const value = textMap[String(hash)]; return typeof value === 'object' ? value.text : value; };
    for (const item of values(tables.GridFightItems)) inlineTextNames.set(`item:${item.ID}`, lookupText(item.ItemName?.Hash));
    for (const role of roleList) inlineTextNames.set(`role:${role.ID}`, role.AvatarID === 8007 ? '开拓者•记忆' : role.AvatarID === 8009 ? '开拓者•欢愉' : lookupText(avatars.get(role.AvatarID)?.AvatarName?.Hash));
    const front = values(tables.GridFightFrontSkill);
    const back = values(tables.GridFightBackBESkillConfig);
    const normalSkills = [...values(tables.AvatarSkillConfig), ...values(tables.AvatarSkillConfigLD)];
    const referencedFront = new Set(starList.flatMap(x => [...(x.SkillOverrideDest || []), ...(x.FrontShowSkillIDList || [])]));
    const referencedBack = new Set(starList.flatMap(x => [...(x.BackShowSkillIDList || []), ...(x.BESkillIDList || [])]));
    const missing = new Set();
    const characters = roleList.map(role => {
      const avatar = avatars.get(role.AvatarID);
      const stars = starList.filter(x => x.ID === role.ID);
      return {
        id:role.ID, avatarId:role.AvatarID, name:inlineTextNames.get(`role:${role.ID}`) || null,
        cost:role.Rarity, position:role.FrontBackType || 'FrontAndBack', positionDefaultOmitted:role.FrontBackType === undefined,
        expert:Boolean(role.IsExpert), inBook:Boolean(role.IsInBook), inPool:Boolean(role.IsInPool), traits:role.TraitList,
        source:resolved(role, textMap, missing), stars:resolved(stars, textMap, missing),
        baseCharacter:{ nameHash:String(avatar?.AvatarName?.Hash), damageType:avatar?.DamageType, skillIds:avatar?.SkillList || [], configPath:avatar?.JsonPath },
        unmodifiedBaseSkills:resolved(normalSkills.filter(x => (avatar?.SkillList || []).includes(x.SkillID) && !stars.every(s => (s.SkillOverrideSrc || []).includes(x.SkillID))), textMap, missing),
        frontSkills:resolved(front.filter(x => stars.some(s => [...(s.SkillOverrideDest || []), ...(s.FrontShowSkillIDList || [])].includes(x.SkillID))), textMap, missing),
        backSkills:resolved(back.filter(x => stars.some(s => [...(s.BackShowSkillIDList || []), ...(s.BESkillIDList || [])].includes(x.SkillID))), textMap, missing),
      };
    });
    const table = name => resolved(tables[name], textMap, missing);
    const seasonTraitIds = new Set(values(tables.GridFightSeasonTrait_Index_SeasonID).flatMap(x => x.MGNHKOHFLPO || []).map(x => x.BNCKFPAGOMF));
    const traits = values(tables.GridFightTraitBasicInfo).map(trait => ({
      ...resolved(trait, textMap, missing), members:characters.filter(x => x.traits.includes(trait.ID)).map(x => ({ id:x.id, name:x.name, cost:x.cost })),
      currentSeason:seasonTraitIds.has(trait.ID) || (trait.TraitType === 'Unique' && characters.some(x => x.traits.includes(trait.ID))) || trait.ID === 1014,
      seasonBaseIndexed:seasonTraitIds.has(trait.ID),
      layers:values(tables.GridFightTraitLayer).filter(x => x.TraitID === trait.ID).map(layer => ({
        ...resolved(layer, textMap, missing),
        buff:resolved(values(tables.GridFightTraitMazebuff).find(x => x.ID === layer.MazebuffID) || null, textMap, missing),
        battleParameters:values(tables.GridFightTraitMazebuffPlus).find(x => x.MazebuffID === layer.MazebuffID) || null,
      })),
      remarks:resolved(values(tables.GridFightTraitRemark).filter(x => x.ID === trait.ID), textMap, missing),
      ...(trait.ID === 1014 ? {activationScope:'conditionalAugmentTrait', conditionalStrategyIds:[352701,352702],
        conditionalMembers:[{strategyId:352701,roleIds:[1212,12041,12042,1204],condition:'Strategy grants 镜流 and special 1-fee 景元; 景元 becomes 3-fee at 镜流 2-star and 5-fee at 镜流 3-star.'},
          {strategyId:352702,roleIds:[1209,1204],condition:'Strategy grants 彦卿 and 景元 and assigns 师徒; strengthening depends on both being deployed.'}]} : {}),
    }));
    const equipment = values(tables.GridFightEquipment).map(equipment => ({
      ...resolved(equipment, textMap, missing), name:textMap[String(values(tables.GridFightItems).find(x => x.ID === equipment.ID)?.ItemName?.Hash)] || null,
      recipes:values(tables.GridFightCraftConfig).filter(x => x.CraftEquipID === equipment.ID),
      upgrades:values(tables.GridFightEquipUpgrade).filter(x => x.PreID === equipment.ID || x.UpgradeID === equipment.ID),
    }));
    const supportingNames = TABLES.filter(x => !['AvatarConfig','AvatarConfigLD','AvatarSkillConfig','AvatarSkillConfigLD','GridFightRoleBasicInfo','GridFightRoleStar','GridFightFrontSkill','GridFightBackBESkillConfig','GridFightEquipment','GridFightTraitBasicInfo','GridFightAugment','GridFightPortalBuff','GridFightTalent','GridFightSeasonTalent'].includes(x));
    const references = Object.fromEntries(supportingNames.map(name => [name, table(name)]));
    const sourceManifest = [...TABLES.map(x => `ExcelOutput/${x}.json`), 'TextMap/TextMapCHS.json','TextMap/TextMapEN.json'].map(rel => ({ path:rel, source:sourcePage(rel), rawUrl:sourceUrl(rel), local:path.join(INPUT, `${path.basename(rel)}.gz`), rows:rel.startsWith('ExcelOutput/') ? values(tables[path.basename(rel,'.json')]).length : Object.keys(rel.endsWith('EN.json') ? englishText : textMap).length }));
    const unresolvedFrontIds = [...referencedFront].filter(id => id !== 0 && !front.some(x => x.SkillID === id));
    const unresolvedBackIds = [...referencedBack].filter(id => id !== 0 && !back.some(x => x.SkillID === id));
    const unresolvedTraitIds = [...new Set(characters.flatMap(x => x.traits))].filter(id => !traits.some(x => x.ID === id));
    const unresolvedOccurrences = [];
    const unresolvedParameters = [];
    const englishFallback = [];
    const percentUnits = {typedOccurrences:0,unformattedOccurrences:0,greaterThanOneOccurrences:0,greaterThanOneUnique:[],unformatted:[]};
    const percentKeys = new Set();
    function audit(node, location, parent = null) {
      if (!node || typeof node !== 'object') return;
      if (node.unresolved) unresolvedOccurrences.push({ location, hash:node.hash });
      if (node.unresolvedParameters) unresolvedParameters.push({ location, tokens:node.unresolvedParameters });
      if (node.fallback) englishFallback.push({location,hash:node.hash});
      if (typeof node.template === 'string') {
        const field = location.split('.').at(-1), params = parameterValues(parent || {}, field);
        for (const token of node.template.replace(/<[^>]*>/g,'').matchAll(/#(\d+)(?:\[([if])(\d*)\])?%/g)) {
          const raw = params[Number(token[1])-1], rawValue = typeof raw === 'number' ? raw : raw?.Value;
          percentUnits[token[2]?'typedOccurrences':'unformattedOccurrences']++;
          const item = {location,recordId:parent?.SkillID ?? parent?.ID ?? parent?.TraitID ?? null,level:parent?.Level ?? parent?.Star ?? parent?.Layer ?? null,field,
            textHash:node.hash,token:token[0],rawValue:rawValue ?? null,format:token[2]?'typed normalized-ratio display':'unformatted literal; runtime unit unverified'};
          if (!token[2]) percentUnits.unformatted.push(item);
          if (typeof rawValue === 'number' && rawValue > 1) {
            percentUnits.greaterThanOneOccurrences++;
            const key = `${node.hash}:${token[1]}:${token[2]||'literal'}:${rawValue}`;
            if (!percentKeys.has(key)) {percentKeys.add(key); percentUnits.greaterThanOneUnique.push(item);}
          }
        }
      }
      for (const [key,value] of Object.entries(node)) if (value && typeof value === 'object') audit(value, `${location}.${key}`, node);
    }
    const investmentStrategies = table('GridFightAugment'), investmentEnvironments = table('GridFightPortalBuff');
    const permanentEnhancements = table('GridFightTalent'), seasonalEnhancements = table('GridFightSeasonTalent');
    audit({characters,traits,equipment,investmentStrategies,investmentEnvironments,permanentEnhancements,seasonalEnhancements,references}, 'reference');
    const data = {
      schemaVersion:1, version:'4.6.0', platform:'OSPRODWin', sourceCommit:COMMIT,
      sourceRevision:'OSPRODWin4.6.0_D16707949_A16704710_L16700845', sourceKind:'community mirror of release game data; no official endorsement',
      scope:'Currency Wars: Zero-Sum Game, SeasonID 1; variant records and module restrictions retained',
      characters, traits, equipment, investmentStrategies, investmentEnvironments,
      permanentEnhancements, seasonalEnhancements, references,
      sourceManifest,
      completeness:{ rawRoleRecords:roleList.length, uniqueAvatarIds:new Set(roleList.map(x=>x.AvatarID)).size,
        bookRoleRecords:characters.filter(x=>x.inBook).length, experts:characters.filter(x=>x.expert).length,
        roleStarRecords:starList.length, traitRecords:traits.length, currentSeasonTraitRecords:traits.filter(x=>x.currentSeason).length,
        standardSeasonTraitRecords:traits.filter(x=>x.currentSeason && x.activationScope !== 'conditionalAugmentTrait').length,
        conditionalAugmentTraitRecords:traits.filter(x=>x.activationScope==='conditionalAugmentTrait').length, equipmentRecords:equipment.length,
        strategies:values(tables.GridFightAugment).length, environments:values(tables.GridFightPortalBuff).length,
        currentSeasonStrategies:values(tables.GridFightSeasonAugment).filter(x=>x.SeasonID===1).length,
        currentSeasonEnvironments:values(tables.GridFightSeasonPortal).filter(x=>x.SeasonID===1).length,
        frontSkillRows:front.length, linkedFrontSkillRows:front.filter(x=>referencedFront.has(x.SkillID)).length,
        backSkillRows:back.length, linkedBackSkillRows:back.filter(x=>referencedBack.has(x.SkillID)).length,
        missingCharacterNames:characters.filter(x=>!x.name).map(x=>x.id),
        missingTextHashes:[...missing], unresolvedFrontSkillIds:unresolvedFrontIds, unresolvedBackSkillIds:unresolvedBackIds, unresolvedTraitIds,
        unresolvedTextLocations:unresolvedOccurrences, unresolvedParameterLocations:unresolvedParameters,
        englishFallbackLocations:englishFallback, percentageParameterAudit:percentUnits,
      },
      limitations:[
        'Large integer TextMap keys are retained as strings before JSON parsing; they are text lookup IDs, never version checks.',
        'Displayed effects resolve explicit parameter templates; dynamic saved values, uncommon placeholders and runtime conditions remain explicit.',
        'Config/ runtime behavior JSON and battle execution are not imported; referenced JsonPath/AbilityName identify the dynamic behavior gap.',
        'Omitted FrontBackType is the serialized default; FrontAndBack label is inferred from current BWIKI dual-position entries and marked positionDefaultOmitted.',
        'Raw data contains transformations and changing-cost variants; raw role count is not the number of distinct characters.',
        '32 traits are current-season indexed or character-linked; the 33rd 师徒 is conditionalAugmentTrait granted by current strategies 352701/352702, with assigned members and changing-cost 景元 forms retained.',
        '84 raw environment definitions include 群攻概念股, absent from the 83-entry season list; it is retained as an unlisted record.',
        'Augment 302101 黄晶矿工 uniquely uses unformatted #1% with raw value 50: rendered as literal 50%, corroborated by current BWIKI, while runtime unit semantics remain unverified. Typed percent templates retain normalized ratios and extreme multipliers; no value-magnitude normalization is applied.',
      ],
    };
    const outputText = JSON.stringify(data) + '\n';
    const propertyLabels = {
      ExtraHPAddedRatio1:'生命增幅', ExtraAllDamageTypeAddedRatio1:'伤害增幅', ExtraFrontPowerAddedRatio1:'前台强度', ExtraBackPowerAddedRatio1:'后台强度',
      ExtraSpeedAddedRatio1:'速度增幅', ExtraHealAddedRatio:'治疗强度', ExtraShieldAddedRatio:'护盾强度', ExtraLuckChance:'幸运一击率',
      ExtraLuckDamage:'幸运一击伤害', ExtraUltraDamageAddedRatio1:'终结技伤害增幅', ExtraBPAddedRatio1:'战技伤害增幅',
    };
    const humanText = value => (typeof value === 'string' ? value : value?.text || '')
      .replace(/<property\s+type=([^\s>]+)[^>]*>/g, (_,type)=>`【${propertyLabels[type] || type}】`)
      .replace(/<[^>]*>/g,'').replaceAll('\\n',' ').replaceAll('|','／');
    const lines = [
      '# 货币战争：零和博弈现行参考表', '',
      `版本：**4.6.0 正式服发布数据**；Git 原生 commit：\`${COMMIT}\`。`,
      `数据发布标识：\`${data.sourceRevision}\`；来源为社区发布服数据镜像，不代表官方背书。`, '',
      `[全量解算表](currency-current.json)保留所有角色前后台/星级记录、羁绊阈值与效果、装备配方/升级、投资策略/环境、全局强化及经济人口表。原始输入只放独立 canonical 数据区，gzip 保留源字节。`, '',
      '## 规模与边界', '',
      `- ${data.completeness.rawRoleRecords} 条角色记录，${data.completeness.uniqueAvatarIds} 个 AvatarID；${data.completeness.bookRoleRecords} 条图鉴角色记录；${data.completeness.experts} 条专家记录；${starList.length} 条星级记录。`,
      `- ${traits.length} 条羁绊：${data.completeness.standardSeasonTraitRecords} 条赛季常规/角色独立羁绊，以及 1 条由当前投资策略赋予的条件羁绊【师徒】；${equipment.length} 条装备、${values(tables.GridFightCraftConfig).length} 条配方、${values(tables.GridFightEquipUpgrade).length} 条升级映射。`,
      `- ${data.completeness.strategies} 条投资策略；${data.completeness.environments} 条环境，其中赛季名单 ${data.completeness.currentSeasonEnvironments} 条。`,
      `- ${values(tables.GridFightTalent).length} 条常驻强化、${values(tables.GridFightSeasonTalent).length} 条赛季强化；模块禁用规则独立保留。`,
      `- 缺失正文键 ${missing.size}；未解算参数位置 ${unresolvedParameters.length}；未关联前台技能 ID ${unresolvedFrontIds.length}；后台 ${unresolvedBackIds.length}；羁绊 ${unresolvedTraitIds.length}。具体 ID 与字段路径见 JSON completeness；不以空白或猜值隐藏缺口。`, '',
      '## 全角色索引', '', '| 角色 | 费用 | 站位 | 专家 | 图鉴 | 星级 | 羁绊 ID |', '| --- | --- | --- | --- | --- | --- | --- |',
      ...characters.map(x=>`| ${x.name || `未知(${x.avatarId})`} | ${x.cost} | ${x.position === 'Front' ? '前台' : x.position === 'Back' ? '后台' : '前后台¹'} | ${x.expert ? '是' : ''} | ${x.inBook ? '是' : '动态形态'} | ${x.stars.map(s=>s.Star).join('/')} | ${x.traits.join(', ')} |`), '',
      '¹ 前后台为源记录省略枚举默认值，表内保留 positionDefaultOmitted，未把省略值伪装成显式源字段。', '',
      '## 全角色人读技能与星级效果', '',
      '下列模式技能按全部源技能等级列出已经代入的数值；星级条目保留对应技能 ID 与属性增幅。未改本体技能保留在全量 JSON 的 unmodifiedBaseSkills；技能施放的动态条件以原文和原参数说明，不补造运行结果。', '',
      ...characters.flatMap(character => {
        const plain = humanText;
        const number = x => x?.Value === undefined ? 0 : x.Value;
        const output = [`### ${character.name} · ${character.cost} 费 · ${character.position}`, ''];
        for (const star of character.stars) {
          output.push(`- ${star.Star} 星：前台强度 ${number(star.FrontPowerBase)}，后台强度 ${number(star.BackPowerBase)}；幸运概率 ${number(star.LuckChance)*100}%、幸运伤害 ${number(star.LuckDamage)*100}%；治疗基值 ${number(star.ExtraHealBase)}、护盾基值 ${number(star.ExtraShieldBase)}。${plain(star.FrontOneWordDesc)} ${plain(star.BackOneWordDesc)}`);
          output.push(`  属性变化：${star.GeneralPropertyModifyList.map(x=>`${x.PropertyType}=${number(x.Value)}`).join('；')}。前台技能：${[...(star.SkillOverrideDest||[]),...(star.FrontShowSkillIDList||[])].filter(x=>x!==0).join(', ')}；后台技能：${(star.BackShowSkillIDList||[]).join(', ')}。`);
        }
        output.push('', '| 位置 | 技能 | 源等级 | 已代入数值的效果 |', '| --- | --- | --- | --- |');
        for (const [position,skills] of [['前台',character.frontSkills],['后台',character.backSkills]]) for(const skill of skills) output.push(`| ${position} | ${plain(skill.SkillName)} (${skill.SkillID}) | ${skill.Level || '固定'} | ${plain(skill.SkillDesc)} |`);
        output.push(''); return output;
      }),
      '## 全羁绊阈值与效果', '',
      ...traits.flatMap(trait=>{
        const output = [`### ${trait.TraitName.text}${trait.activationScope === 'conditionalAugmentTrait' ? '（当前投资策略赋予）' : trait.currentSeason ? '' : '（未列入赛季基础名单）'}`, '', humanText(trait.TraitBaseDesc), '', `成员：${trait.members.map(x=>`${x.name}(${x.cost}费)`).join('、') || '由条件策略指定，非角色基础标签'}。`, ''];
        if (trait.activationScope === 'conditionalAugmentTrait') output.push('赋予方式：352701【飞光•映月】给予镜流和特殊1费景元；镜流2星/3星时，景元分别变为3费/5费。352702【飞光•传剑】给予彦卿和景元，两者获得师徒；同时上场时可累加策略强化。', '');
        for(const layer of trait.layers) output.push(`- ${layer.Layer} 人：${humanText(layer.PropertyDesc)} ${humanText(layer.buff?.BuffDesc) || '原始buff描述键缺失；上列阈值属性正文完整，未猜测缺失正文'}；参数 ${JSON.stringify(layer.buff?.ParamList || [])}；战斗参数 ${JSON.stringify(layer.battleParameters?.BEParamList || [])}；属性 ${JSON.stringify(layer.TraitMemberPropertyList || [])}/${JSON.stringify(layer.AllMemberPropertyList || [])}。`);
        output.push('');return output;
      }),
      '## 全装备、配方与升级', '',
      ...equipment.map(equipment=>`- **${equipment.name}** (${equipment.ID}, ${equipment.EquipCategory})：${humanText(equipment.EquipDesc) || '无额外描述'}；属性 ${JSON.stringify(equipment.GeneralPropertyList)}；配方 ${equipment.recipes.map(x=>x.CostEquipList.join('+')).join(' / ') || '无合成配方'}；升级 ${equipment.upgrades.map(x=>`${x.PreID}→${x.UpgradeID}`).join(' / ') || '无升级映射'}。`), '',
      '## 全投资策略', '',
      ...values(data.investmentStrategies).map(x=>`- **${x.HexName.text}** (${x.ID}, ${x.Quality}, 位面${x.ChapterLimitList.join('/')})：${humanText(x.HexDesc)}${x.HexDesc.parameterUnitWarnings?.length ? '（百分数字面按原值保留；运行单位未核实）' : ''}`), '',
      '## 全投资环境', '',
      ...values(data.investmentEnvironments).map(x=>`- **${x.PortalBuffTitle.text}** (${x.ID}${values(tables.GridFightSeasonPortal).some(s=>s.PortalID===x.ID) ? '' : '，未列入赛季'})：${humanText(x.PortalBuffDesc)}`), '',
      '## 全局强化', '',
      ...[...values(data.permanentEnhancements),...values(data.seasonalEnhancements)].map(x=>`- **${x.EffectTitle.text}** (${x.ID}${x.SeasonID ? '，赛季' : '，常驻'})：${humanText(x.EffectDesc)}`), '',
      '## 经济与人口', '',
      '人口等级、各档招募概率与升级经验见 JSON references.GridFightPlayerLevel；各费用和星级买卖价见 GridFightShopPrice；利息、刷新、购买经验、卡池份数见 ConstCommon 与 ConstValueCommonV2。', '',
      '## 未知与动态规则', '', ...data.limitations.map(x=>`- ${x}`), '',
      '## 原始来源', '', ...sourceManifest.map(x=>`- [${x.path}](${x.source})：${x.rows} 条；原始 gzip：\`${x.local}\`。`), '',
      '## 复现', '',
      `\`node tools/resonance/export-currency.mjs\` 从固定 commit 取确定表清单，已存在原始输入直接复用；下载/解析阶段上限 60 秒，源输入与整理产出及工具总量上限 100,000,000 字节，无媒体、无依赖安装、无战斗。`, '',
    ];
    const markdownText = lines.map(line=>line.replace(/[ \t]+$/,'')).join('\n');
    const manifestText = JSON.stringify({commit:COMMIT,version:'4.6.0',files:sourceManifest},null,2)+'\n';
    const inputBytes = (await Promise.all(sourceManifest.map(x=>lstat(x.local)))).reduce((total,x)=>total+x.size,0);
    const projectedBytes = inputBytes + Buffer.byteLength(outputText) + Buffer.byteLength(markdownText) + Buffer.byteLength(manifestText) + (await lstat(fileURLToPath(import.meta.url))).size;
    if (projectedBytes > LIMIT) throw new Error(`DISK_BUDGET_EXCEEDED_BEFORE_WRITE:${projectedBytes}:${LIMIT}`);
    await writeFile(OUTPUT, outputText);
    await writeFile(MARKDOWN, markdownText);
    await writeFile(path.join(INPUT, 'source.json'), manifestText);
    const bytes = await totalBytes();
    if (bytes > LIMIT) throw new Error(`DISK_BUDGET_EXCEEDED:${bytes}:${LIMIT}`);
    const summary = value => Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,summary(item)])) : value;
    console.log(JSON.stringify({ok:true,commit:COMMIT,input:INPUT,output:OUTPUT,markdown:MARKDOWN,sourceFiles:sourceManifest.length,bytes,limitBytes:LIMIT,completeness:summary(data.completeness)},null,2));
  } finally { clearTimeout(deadline); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
