// tools/assault/source-corpus.mjs
//
// 进击「来源语料完整性程序」：只做数据读取、索引与机械校验。
// 不设计卡池、不改游戏引擎、不复制完整 raw：索引只给出真实标量字段、
// 源文件绝对路径与 JSON Pointer，供设计逐条回读。
//
// ESM，可 import 纯函数；直接 CLI：
//   node tools/assault/source-corpus.mjs \
//     --source-root <abs> --index <abs> --operators <abs> --receipt <abs>
// 四个参数均必填且必须为绝对路径；未知参数直接失败；失败不覆盖旧产物。

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA_INDEX = 'assault-source-corpus/v1';
export const SCHEMA_OPERATORS = 'assault-operator-index/v1';
export const SCHEMA_RECEIPT = 'assault-source-corpus-receipt/v1';

// ---------------------------------------------------------------------------
// JSON Pointer
// ---------------------------------------------------------------------------

export function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointerToken(token) {
  return String(token).replace(/~1/g, '/').replace(/~0/g, '~');
}

export function pointerOf(...tokens) {
  return '/' + tokens.map(escapePointerToken).join('/');
}

export function joinPointer(base, ...tokens) {
  const prefix = base && base !== '' ? base.replace(/\/$/, '') : '';
  return prefix + pointerOf(...tokens);
}

export function readPointer(root, pointer) {
  if (pointer === '' || pointer === undefined || pointer === null) return { found: true, value: root };
  if (typeof pointer !== 'string' || pointer[0] !== '/') return { found: false, value: undefined };
  const tokens = pointer.split('/').slice(1).map(unescapePointerToken);
  let cursor = root;
  for (const token of tokens) {
    if (cursor === null || cursor === undefined) return { found: false, value: undefined };
    if (Array.isArray(cursor)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { found: false, value: undefined };
      const idx = Number(token);
      if (idx >= cursor.length) return { found: false, value: undefined };
      cursor = cursor[idx];
    } else if (typeof cursor === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cursor, token)) return { found: false, value: undefined };
      cursor = cursor[token];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: cursor };
}

// ---------------------------------------------------------------------------
// 输入文件契约（相对 source-root）
// ---------------------------------------------------------------------------

export const SOURCE_FILES = {
  bazaar: {
    cards: 'bazaar/cards_generated.json',
    skills: 'bazaar/skills_generated.json',
    encounters: 'bazaar/encounters_generated.json',
    monsters: 'bazaar/monsters_generated.json',
    events: 'bazaar/events.json',
    eventOverrides: 'bazaar/event_overrides.json',
    cardpacks: 'bazaar/cardpacks.json',
    challenges: 'bazaar/challenges.json',
    merchantMeta: 'bazaar/merchant_meta.json',
    rarityRules: 'bazaar/rarity_rules.json',
    translations: 'bazaar/translations_zh_cn.json',
    cacheImportSummary: 'bazaar/cache_import_summary.json',
  },
  arknights: {
    characterTable: 'arknights/excel/character_table.json',
    skillTable: 'arknights/excel/skill_table.json',
    uniequipTable: 'arknights/excel/uniequip_table.json',
    battleEquipTable: 'arknights/excel/battle_equip_table.json',
    rangeTable: 'arknights/excel/range_table.json',
    charPatchTable: 'arknights/excel/char_patch_table.json',
    charMetaTable: 'arknights/excel/char_meta_table.json',
    gamedataConst: 'arknights/excel/gamedata_const.json',
    roguelikeTopicTable: 'arknights/excel/roguelike_topic_table.json',
    roguelikeTable: 'arknights/excel/roguelike_table.json',
    enemyHandbookTable: 'arknights/excel/enemy_handbook_table.json',
    handbookTeamTable: 'arknights/excel/handbook_team_table.json',
    activityTable: 'arknights/excel/activity_table.json',
    enemyDatabase: 'arknights/levels/enemydata/enemy_database.json',
    buffTemplateData: 'arknights/battle/buff_template_data.json',
    epBreakbuffTable: 'arknights/battle/ep_breakbuff_table.json',
    buffTable: 'arknights/buff_table.json',
  },
};

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function objectKeys(v) {
  return isPlainObject(v) ? Object.keys(v) : [];
}

function missingFields(record, required) {
  const out = [];
  for (const field of required) {
    const v = record?.[field];
    if (v === undefined || v === null || v === '') out.push(field);
  }
  return out;
}

/** 递归遍历 JSON 值，回调 (value, pointer)；有深度上限，不复制值。 */
export function walkJson(value, visitor, pointer = '', depth = 0) {
  if (depth > 96 || !isPlainObject(value) && !Array.isArray(value)) return;
  visitor(value, pointer);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) walkJson(value[i], visitor, `${pointer}/${i}`, depth + 1);
    return;
  }
  for (const key of Object.keys(value)) {
    walkJson(value[key], visitor, `${pointer}/${escapePointerToken(key)}`, depth + 1);
  }
}

// ---------------------------------------------------------------------------
// 明日方舟：实体分类与干员索引
// ---------------------------------------------------------------------------

export const TOKEN_PROFESSION = 'TOKEN';
export const TRAP_PROFESSION = 'TRAP';

export function classifyArknightsEntity(record) {
  if (!isPlainObject(record)) return 'unknown';
  if (record.profession === TOKEN_PROFESSION) return 'token';
  if (record.profession === TRAP_PROFESSION) return 'trap';
  return 'character';
}

export function isObtainableOperator(record) {
  return classifyArknightsEntity(record) === 'character' && record.isNotObtainable !== true;
}

function moduleRefsFor(charId, uniequipTable, battleEquipTable) {
  const charEquip = isPlainObject(uniequipTable?.charEquip) ? uniequipTable.charEquip[charId] : undefined;
  const equipDict = isPlainObject(uniequipTable?.equipDict) ? uniequipTable.equipDict : {};
  const battle = isPlainObject(battleEquipTable) ? battleEquipTable : {};
  const refs = [];
  for (const moduleId of Array.isArray(charEquip) ? charEquip : []) {
    const info = equipDict[moduleId];
    refs.push({
      moduleId,
      equipType: info ? info.type ?? null : null,
      inEquipDict: Boolean(info),
      inBattleEquip: Object.prototype.hasOwnProperty.call(battle, moduleId),
      charEquipPointer: joinPointer('', 'charEquip', charId),
      equipDictPointer: joinPointer('', 'equipDict', moduleId),
      battleEquipPointer: joinPointer('', moduleId),
    });
  }
  return refs;
}

/**
 * 由已解析的明日方舟表构建索引入口。纯函数，不做 IO。
 * 返回的每个干员项只含真实标量 / 计数 / 指针，不含完整 raw。
 */
export function buildArknightsCorpus(input) {
  const {
    characterTable = {},
    skillTable = {},
    rangeTable = {},
    uniequipTable = {},
    battleEquipTable = {},
    charPatchTable = {},
    charMetaTable = {},
    paths = {},
  } = input;

  const characterIds = Object.keys(characterTable);
  const classification = {
    allEntities: characterIds.length,
    characters: 0,
    obtainableOperators: 0,
    nonObtainableCharacters: 0,
    tokens: 0,
    traps: 0,
    extraForms: objectKeys(charPatchTable?.patchChars).length,
  };

  const operators = [];
  const tokens = [];
  const traps = [];
  const nonObtainableCharacters = [];
  const missingReferences = [];
  const skillRefs = { referenced: 0, resolved: 0, missing: 0, withoutLevels: 0, prefabIds: new Set() };
  let operatorsWithKeyFrames = 0;
  const operatorsMissingKeyFrames = [];
  let operatorsWithAllSkillLvlup = 0;
  const operatorsMissingAllSkillLvlup = [];

  for (const charId of characterIds) {
    const record = characterTable[charId];
    const kind = classifyArknightsEntity(record);
    if (kind === 'token') { classification.tokens += 1; tokens.push(charId); continue; }
    if (kind === 'trap') { classification.traps += 1; traps.push(charId); continue; }
    classification.characters += 1;
    if (record.isNotObtainable === true) {
      classification.nonObtainableCharacters += 1;
      nonObtainableCharacters.push(charId);
      continue;
    }
    classification.obtainableOperators += 1;
    const basePointer = pointerOf(charId);

    // 技能引用
    const skillEntries = [];
    for (let si = 0; si < (Array.isArray(record.skills) ? record.skills.length : 0); si += 1) {
      const skillRef = record.skills[si];
      const skillId = skillRef?.skillId ?? null;
      const skillPointer = `/skills/${si}`;
      const template = skillId != null ? skillTable[skillId] : undefined;
      const resolved = Boolean(template);
      skillRefs.referenced += 1;
      if (resolved) {
        skillRefs.resolved += 1;
        const levels = Array.isArray(template.levels) ? template.levels : [];
        if (levels.length === 0) {
          skillRefs.withoutLevels += 1;
          missingReferences.push({ kind: 'skill-without-levels', charId, skillId, pointer: basePointer + skillPointer, templatePointer: pointerOf(skillId) });
        }
        for (const level of levels) {
          if (level?.prefabId) skillRefs.prefabIds.add(level.prefabId);
          if (level?.rangeId && !rangeTable[level.rangeId]) {
            missingReferences.push({ kind: 'skill-level-range', charId, skillId, rangeId: level.rangeId, pointer: basePointer + skillPointer, rangePointer: pointerOf(level.rangeId) });
          }
        }
      } else {
        skillRefs.missing += 1;
        missingReferences.push({ kind: 'skill-missing', charId, skillId, pointer: basePointer + skillPointer, templatePointer: skillId != null ? pointerOf(skillId) : null });
      }
      skillEntries.push({
        skillId,
        resolved,
        unlockCond: skillRef?.unlockCond ?? null,
        overridePrefabKey: skillRef?.overridePrefabKey ?? null,
        overrideTokenKey: skillRef?.overrideTokenKey ?? null,
        pointer: basePointer + skillPointer,
        templatePointer: skillId != null ? pointerOf(skillId) : null,
        templatePath: paths.skillTable ?? null,
      });
    }

    // 阶段、关键帧、范围
    const phases = Array.isArray(record.phases) ? record.phases : [];
    const keyFrameCounts = [];
    const phaseRangeIds = [];
    for (let pi = 0; pi < phases.length; pi += 1) {
      const phase = phases[pi];
      keyFrameCounts.push(Array.isArray(phase?.attributesKeyFrames) ? phase.attributesKeyFrames.length : 0);
      phaseRangeIds.push(phase?.rangeId ?? null);
      if (phase?.rangeId && !rangeTable[phase.rangeId]) {
        missingReferences.push({ kind: 'phase-range', charId, phase: pi, rangeId: phase.rangeId, pointer: `${basePointer}/phases/${pi}/rangeId` });
      }
    }
    if (phases.length === 0 || keyFrameCounts.every((n) => n === 0)) {
      operatorsMissingKeyFrames.push(charId);
    } else {
      operatorsWithKeyFrames += 1;
    }
    if (Array.isArray(record.allSkillLvlup) && record.allSkillLvlup.length > 0) {
      operatorsWithAllSkillLvlup += 1;
    } else {
      operatorsMissingAllSkillLvlup.push(charId);
    }

    // 天赋候选
    const talents = (Array.isArray(record.talents) ? record.talents : []).map((talent, index) => {
      const candidates = Array.isArray(talent?.candidates) ? talent.candidates : [];
      return {
        index,
        candidateCount: candidates.length,
        prefabKeys: [...new Set(candidates.map((c) => c?.prefabKey).filter((v) => v != null))],
        names: [...new Set(candidates.map((c) => c?.name).filter((v) => typeof v === 'string'))],
        pointer: `${basePointer}/talents/${index}`,
      };
    });

    // 特性
    const trait = record.trait
      ? {
        prefabKey: record.trait.prefabKey ?? null,
        rangeId: record.trait.rangeId ?? null,
        candidateCount: Array.isArray(record.trait.candidates) ? record.trait.candidates.length : 0,
        pointer: `${basePointer}/trait`,
      }
      : null;
    if (trait?.rangeId && !rangeTable[trait.rangeId]) {
      missingReferences.push({ kind: 'trait-range', charId, rangeId: trait.rangeId, pointer: `${basePointer}/trait/rangeId` });
    }

    // 模组引用
    const modules = moduleRefsFor(charId, uniequipTable, battleEquipTable);
    for (const mod of modules) {
      if (!mod.inEquipDict) {
        missingReferences.push({ kind: 'module-not-in-equipDict', charId, moduleId: mod.moduleId, pointer: mod.charEquipPointer });
      } else if (mod.equipType && mod.equipType !== 'INITIAL' && !mod.inBattleEquip) {
        missingReferences.push({ kind: 'module-not-in-battle-equip', charId, moduleId: mod.moduleId, equipType: mod.equipType, pointer: mod.battleEquipPointer });
      }
    }

    operators.push({
      charId,
      name: record.name ?? null,
      rarity: record.rarity ?? null,
      profession: record.profession ?? null,
      subProfessionId: record.subProfessionId ?? null,
      position: record.position ?? null,
      tagList: Array.isArray(record.tagList) ? record.tagList : [],
      affiliation: {
        nationId: record.nationId ?? null,
        groupId: record.groupId ?? null,
        teamId: record.teamId ?? null,
        mainPower: record.mainPower ?? null,
        subPower: record.subPower ?? null,
      },
      skillIds: skillEntries.map((s) => s.skillId),
      skills: skillEntries,
      phaseCount: phases.length,
      keyFrameCounts,
      phaseRangeIds,
      talents,
      trait,
      modules,
      pointers: {
        record: basePointer,
        name: `${basePointer}/name`,
        rarity: `${basePointer}/rarity`,
        profession: `${basePointer}/profession`,
        subProfessionId: `${basePointer}/subProfessionId`,
        affiliation: `${basePointer}/mainPower`,
        skills: `${basePointer}/skills`,
        phases: `${basePointer}/phases`,
        talents: `${basePointer}/talents`,
        trait: `${basePointer}/trait`,
        modules: paths.uniequipTable ? joinPointer('', 'charEquip', charId) : null,
      },
      source: {
        characterTable: paths.characterTable ?? null,
        skillTable: paths.skillTable ?? null,
        rangeTable: paths.rangeTable ?? null,
        uniequipTable: paths.uniequipTable ?? null,
        battleEquipTable: paths.battleEquipTable ?? null,
      },
    });
  }

  // 多职业额外形态（本体不在 character_table 内，如阿米娅近卫/医疗）
  const extraForms = [];
  const patchChars = isPlainObject(charPatchTable?.patchChars) ? charPatchTable.patchChars : {};
  const infos = isPlainObject(charPatchTable?.infos) ? charPatchTable.infos : {};
  const groupOf = {};
  for (const [baseCharId, info] of Object.entries(infos)) {
    for (const tmplId of Array.isArray(info?.tmplIds) ? info.tmplIds : []) groupOf[tmplId] = baseCharId;
  }
  for (const charId of Object.keys(patchChars)) {
    const record = patchChars[charId] ?? {};
    extraForms.push({
      charId,
      group: groupOf[charId] ?? null,
      name: record.name ?? null,
      rarity: record.rarity ?? null,
      profession: record.profession ?? null,
      subProfessionId: record.subProfessionId ?? null,
      isNotObtainable: record.isNotObtainable === true,
      skillIds: (Array.isArray(record.skills) ? record.skills : []).map((s) => s?.skillId ?? null),
      phaseCount: Array.isArray(record.phases) ? record.phases.length : 0,
      pointer: pointerOf('patchChars', charId),
      source: paths.charPatchTable ?? null,
    });
  }

  // 特殊精通（char_meta_table）
  const charIdMasterListMap = isPlainObject(charMetaTable?.charIdMasterListMap) ? charMetaTable.charIdMasterListMap : {};
  const charMasterDataMap = isPlainObject(charMetaTable?.charMasterDataMap) ? charMetaTable.charMasterDataMap : {};
  const masterOperators = Object.keys(charIdMasterListMap).map((charId) => ({
    charId,
    masterIds: Array.isArray(charIdMasterListMap[charId]) ? charIdMasterListMap[charId] : [],
    pointer: pointerOf(charId),
  }));

  return {
    classification,
    operators,
    tokens,
    traps,
    nonObtainableCharacters,
    extraForms,
    missingReferences,
    integrity: {
      skillTemplates: {
        source: paths.skillTable ?? null,
        referencedSkillIds: skillRefs.referenced,
        resolved: skillRefs.resolved,
        missing: skillRefs.missing,
        withoutLevels: skillRefs.withoutLevels,
        distinctPrefabIds: skillRefs.prefabIds.size,
      },
      growthSources: {
        source: paths.characterTable ?? null,
        operatorsWithKeyFrames,
        operatorsMissingKeyFrames,
        operatorsWithAllSkillLvlup,
        operatorsMissingAllSkillLvlup,
      },
    },
    masters: {
      source: paths.charMetaTable ?? null,
      charIdMasterListMapCount: Object.keys(charIdMasterListMap).length,
      charMasterDataMapCount: Object.keys(charMasterDataMap).length,
      operators: masterOperators,
    },
  };
}

// ---------------------------------------------------------------------------
// 大巴扎：卡牌 / 技能 / 遭遇 / 怪物 / 事件
// ---------------------------------------------------------------------------

const TRIGGER_NAMESPACE = 'Trigger';
const ACTION_NAMESPACES = new Set(['Actions', 'AuraActions']);

function scanRawEffects(rawEffects, pointerBase) {
  const state = {
    abilitySlots: 0,
    auraSlots: 0,
    abilityEntries: 0,
    auraEntries: 0,
    triggerTypes: {},
    actionTypes: {},
    cooldownCount: 0,
    cooldownSample: null,
    ammoCount: 0,
    ammoSample: null,
    buyPriceCount: 0,
    buyPriceSample: null,
    tierRawKeys: 0,
  };
  if (!isPlainObject(rawEffects)) return state;
  if (isPlainObject(rawEffects.abilities)) state.abilitySlots = Object.keys(rawEffects.abilities).length;
  if (isPlainObject(rawEffects.auras)) state.auraSlots = Object.keys(rawEffects.auras).length;
  if (isPlainObject(rawEffects.tiers_raw)) state.tierRawKeys = Object.keys(rawEffects.tiers_raw).length;

  walkJson(rawEffects, (value, pointer) => {
    if (!isPlainObject(value)) return;
    const type = value.$type;
    if (typeof type === 'string') {
      const parts = type.split('.');
      const last = parts[parts.length - 1];
      const ns = parts[parts.length - 2];
      if (last === 'TCardAbility') state.abilityEntries += 1;
      if (last === 'TCardAura') state.auraEntries += 1;
      if (ns === TRIGGER_NAMESPACE) state.triggerTypes[last] = (state.triggerTypes[last] ?? 0) + 1;
      if (ACTION_NAMESPACES.has(ns)) state.actionTypes[last] = (state.actionTypes[last] ?? 0) + 1;
    }
    for (const key of Object.keys(value)) {
      if (/cooldown/i.test(key)) {
        state.cooldownCount += 1;
        if (!state.cooldownSample) state.cooldownSample = { pointer: `${pointer}/${escapePointerToken(key)}`, key };
      }
      if (/ammo/i.test(key)) {
        state.ammoCount += 1;
        if (!state.ammoSample) state.ammoSample = { pointer: `${pointer}/${escapePointerToken(key)}`, key };
      }
      if (key === 'Attributes' && isPlainObject(value[key]) && 'BuyPrice' in value[key]) {
        state.buyPriceCount += 1;
        if (!state.buyPriceSample) state.buyPriceSample = `${pointer}/Attributes/BuyPrice`;
      }
    }
  }, pointerBase);

  return state;
}

function mergeCounter(target, source) {
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}

function pushSample(list, entry, cap = 25) {
  if (list.length < cap) list.push(entry);
}

export function buildBazaarCards(cards, path) {
  const result = {
    path,
    pointerRoot: '',
    total: Object.keys(cards).length,
    byType: {},
    coverage: {
      abilitySlots: 0,
      auraSlots: 0,
      abilityEntries: 0,
      auraEntries: 0,
      tierRawKeys: 0,
      buyPriceCards: 0,
      buyPricesFieldNonEmpty: 0,
      sellPricesFieldNonEmpty: 0,
      cooldownRefs: 0,
      ammoRefs: 0,
      triggerTypes: {},
      actionTypes: {},
    },
    gaps: {},
    samples: {},
  };

  const gapIds = {
    noAbilities: [],
    noAuras: [],
    noTiersRaw: [],
    noBuyPrice: [],
    noBuyPricesField: [],
    noSellPricesField: [],
    noTrigger: [],
    noAction: [],
    noCooldown: [],
    noAmmo: [],
  };

  for (const [name, card] of Object.entries(cards)) {
    const type = card?.type ?? 'unknown';
    result.byType[type] = (result.byType[type] ?? 0) + 1;
    const pointerBase = `/${escapePointerToken(name)}/raw_effects`;
    const stats = scanRawEffects(card?.raw_effects, pointerBase);
    result.coverage.abilitySlots += stats.abilitySlots;
    result.coverage.auraSlots += stats.auraSlots;
    result.coverage.abilityEntries += stats.abilityEntries;
    result.coverage.auraEntries += stats.auraEntries;
    result.coverage.tierRawKeys += stats.tierRawKeys;
    result.coverage.cooldownRefs += stats.cooldownCount;
    result.coverage.ammoRefs += stats.ammoCount;
    if (stats.buyPriceCount > 0) result.coverage.buyPriceCards += 1;
    if (isPlainObject(card?.buy_prices) && Object.keys(card.buy_prices).length > 0) result.coverage.buyPricesFieldNonEmpty += 1;
    if (isPlainObject(card?.sell_prices) && Object.keys(card.sell_prices).length > 0) result.coverage.sellPricesFieldNonEmpty += 1;
    mergeCounter(result.coverage.triggerTypes, stats.triggerTypes);
    mergeCounter(result.coverage.actionTypes, stats.actionTypes);

    const id = card?.id ?? null;
    const base = { id, name: card?.name ?? name, type, pointer: `/${escapePointerToken(name)}` };
    if (stats.abilitySlots === 0) gapIds.noAbilities.push(base);
    if (stats.auraSlots === 0) gapIds.noAuras.push(base);
    if (stats.tierRawKeys === 0) gapIds.noTiersRaw.push(base);
    if (stats.buyPriceCount === 0) gapIds.noBuyPrice.push(base);
    if (!isPlainObject(card?.buy_prices) || Object.keys(card.buy_prices).length === 0) gapIds.noBuyPricesField.push(base);
    if (!isPlainObject(card?.sell_prices) || Object.keys(card.sell_prices).length === 0) gapIds.noSellPricesField.push(base);
    if (Object.keys(stats.triggerTypes).length === 0) gapIds.noTrigger.push(base);
    if (Object.keys(stats.actionTypes).length === 0) gapIds.noAction.push(base);
    if (stats.cooldownCount === 0) gapIds.noCooldown.push(base);
    if (stats.ammoCount === 0) gapIds.noAmmo.push(base);
    if (stats.cooldownSample) pushSample(result.samples.cooldown = result.samples.cooldown ?? [], { ...base, ...stats.cooldownSample });
    if (stats.ammoSample) pushSample(result.samples.ammo = result.samples.ammo ?? [], { ...base, ...stats.ammoSample });
    if (stats.buyPriceSample) pushSample(result.samples.buyPrice = result.samples.buyPrice ?? [], { ...base, pointer: `/${escapePointerToken(name)}/raw_effects${stats.buyPriceSample}` });
  }

  for (const [key, list] of Object.entries(gapIds)) {
    result.gaps[key] = {
      count: list.length,
      allIds: list.map((e) => e.id),
      sample: list.slice(0, 25),
    };
  }
  return result;
}

export function compareCardSkillsAndSkillsGenerated(cards, skillsGenerated, paths) {
  const cardSkills = new Map();
  for (const [name, card] of Object.entries(cards)) {
    if (card?.type === 'Skill') cardSkills.set(card.id, { name: card.name ?? name, record: card });
  }
  const genById = new Map();
  const genByName = new Map();
  for (const [name, skill] of Object.entries(skillsGenerated)) {
    genById.set(skill?.id, { name: skill.name ?? name, record: skill });
    genByName.set(skill?.name ?? name, skill?.id ?? null);
  }

  const sameId = [];
  const onlyInCards = [];
  const onlyInGenerated = [];
  for (const id of cardSkills.keys()) {
    if (genById.has(id)) sameId.push(id);
    else onlyInCards.push(id);
  }
  for (const id of genById.keys()) {
    if (!cardSkills.has(id)) onlyInGenerated.push(id);
  }

  const sameNameDifferentId = [];
  for (const [name, card] of Object.entries(cards)) {
    if (card?.type !== 'Skill') continue;
    if (genByName.has(name)) {
      const genId = genByName.get(name);
      if (genId !== card.id) sameNameDifferentId.push({ name, cardId: card.id, generatedId: genId });
    }
  }

  const requiredFields = ['id', 'internal_name', 'name', 'type', 'heroes', 'tags', 'description'];
  const generatedMissingFields = [];
  for (const [name, skill] of Object.entries(skillsGenerated)) {
    const missing = missingFields(skill, requiredFields);
    if (missing.length > 0) generatedMissingFields.push({ name, id: skill?.id ?? null, missing, pointer: `/${escapePointerToken(name)}` });
  }

  return {
    cardsPath: paths?.cards ?? null,
    skillsGeneratedPath: paths?.skills ?? null,
    cardSkillCount: cardSkills.size,
    skillsGeneratedCount: genById.size,
    sameIdCount: sameId.length,
    onlyInCardsCount: onlyInCards.length,
    onlyInSkillsGeneratedCount: onlyInGenerated.length,
    unionCount: cardSkills.size + genById.size - sameId.length,
    arithmeticSum: cardSkills.size + genById.size,
    note: '两个集合按原生 id 比较；不得把计数相加当并集。',
    sameId,
    onlyInCards,
    onlyInSkillsGenerated: onlyInGenerated,
    sameNameDifferentId,
    generatedMissingFields,
    cardsCarryRawEffects: [...cardSkills.values()].filter((v) => isPlainObject(v.record?.raw_effects)).length,
    generatedCarryRawEffects: [...genById.values()].filter((v) => isPlainObject(v.record?.raw_effects)).length,
  };
}

export function buildBazaarEncounters(encounters, path) {
  const items = Object.entries(encounters);
  const byType = {};
  const byCacheType = {};
  const rawEffectFields = {};
  let reselectable = 0;
  const missingId = [];
  for (const [name, enc] of items) {
    byType[enc?.type ?? 'unknown'] = (byType[enc?.type ?? 'unknown'] ?? 0) + 1;
    byCacheType[enc?.cache_type ?? 'unknown'] = (byCacheType[enc?.cache_type ?? 'unknown'] ?? 0) + 1;
    for (const f of Array.isArray(enc?.raw_effect_fields) ? enc.raw_effect_fields : []) rawEffectFields[f] = (rawEffectFields[f] ?? 0) + 1;
    if (enc?.isReselectable === true) reselectable += 1;
    if (enc?.id == null) missingId.push(`/${escapePointerToken(name)}`);
  }
  return {
    path,
    total: items.length,
    byType,
    byCacheType,
    rawEffectFields,
    reselectable,
    missingId,
  };
}

export function buildBazaarMonsters(monsters, cards, path) {
  const cardsById = new Map();
  for (const [name, card] of Object.entries(cards)) {
    if (card?.id != null) cardsById.set(card.id, { name, card });
  }
  const items = Object.entries(monsters);
  const health = { present: 0, combatPresent: 0, maxPresent: 0, missing: [] };
  const boardRefs = { total: 0, resolved: 0, missing: [] };
  const itemRefs = { total: 0, resolved: 0, missing: [] };
  for (const [key, monster] of items) {
    const pointerBase = `/${escapePointerToken(key)}`;
    if (monster?.health != null) health.present += 1; else health.missing.push({ id: monster?.id ?? null, field: 'health', pointer: `${pointerBase}/health` });
    if (monster?.combat_health != null) health.combatPresent += 1;
    if (monster?.max_health != null) health.maxPresent += 1;
    for (let i = 0; i < (Array.isArray(monster?.board_items) ? monster.board_items.length : 0); i += 1) {
      const ref = monster.board_items[i];
      boardRefs.total += 1;
      const refId = ref?.template_id ?? ref?.source_id ?? ref?.id ?? null;
      if (refId != null && cardsById.has(refId)) boardRefs.resolved += 1;
      else boardRefs.missing.push({ monsterId: monster?.id ?? null, refId, name: ref?.name ?? null, pointer: `${pointerBase}/board_items/${i}` });
    }
    for (let i = 0; i < (Array.isArray(monster?.items) ? monster.items.length : 0); i += 1) {
      const ref = monster.items[i];
      itemRefs.total += 1;
      const refId = ref?.template_id ?? ref?.source_id ?? ref?.id ?? null;
      if (refId != null && cardsById.has(refId)) itemRefs.resolved += 1;
      else itemRefs.missing.push({ monsterId: monster?.id ?? null, refId, name: ref?.name ?? null, pointer: `${pointerBase}/items/${i}` });
    }
  }
  return {
    path,
    total: items.length,
    health: { ...health, missing: health.missing.slice(0, 50) },
    boardRefs: { ...boardRefs, missing: boardRefs.missing.slice(0, 50) },
    itemRefs: { ...itemRefs, missing: itemRefs.missing.slice(0, 50) },
  };
}

export function buildBazaarEvents(events, path) {
  const categories = {};
  for (const [category, list] of Object.entries(events)) {
    const entries = Array.isArray(list) ? list : [];
    const missingId = [];
    const sample = [];
    let withResourceRewards = 0;
    let withFollowupOptions = 0;
    let followupOptionCount = 0;
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      if (e?.source_id == null && e?.name == null) missingId.push(`/${escapePointerToken(category)}/${i}`);
      if (isPlainObject(e?.resource_rewards)) withResourceRewards += 1;
      const options = Array.isArray(e?.followup_options) ? e.followup_options : [];
      if (options.length > 0) { withFollowupOptions += 1; followupOptionCount += options.length; }
      if (sample.length < 10) sample.push({ name: e?.name ?? null, source_id: e?.source_id ?? null, pointer: `/${category}/${i}` });
    }
    categories[category] = {
      count: entries.length,
      withResourceRewards,
      withFollowupOptions,
      followupOptionCount,
      missingIdCount: missingId.length,
      sample,
    };
  }
  return { path, categories };
}

export function buildBazaarCorpus(input) {
  const {
    cards = {},
    skillsGenerated = {},
    encounters = {},
    monsters = {},
    events = {},
    eventOverrides = {},
    cardpacks = {},
    challenges = [],
    merchantMeta = {},
    rarityRules = {},
    translations = {},
    cacheImportSummary = {},
    paths = {},
  } = input;

  const cardResult = buildBazaarCards(cards, paths.cards ?? null);
  const skillCompare = compareCardSkillsAndSkillsGenerated(cards, skillsGenerated, { cards: paths.cards, skills: paths.skills });

  const overrideEntries = Object.entries(eventOverrides);
  const eventOverridesResult = {
    path: paths.eventOverrides ?? null,
    total: overrideEntries.length,
    withDynamicReward: overrideEntries.filter(([, v]) => v?._dynamic_reward != null).length,
    withOverrideReason: overrideEntries.filter(([, v]) => v?._override_reason != null).length,
    missingReason: overrideEntries.filter(([, v]) => v?._override_reason == null).map(([name]) => name),
  };

  const cardpackEntries = Object.entries(cardpacks);
  const cardpacksResult = {
    path: paths.cardpacks ?? null,
    total: cardpackEntries.length,
    cardCounts: Object.fromEntries(cardpackEntries.map(([k, v]) => [k, Array.isArray(v?.cards) ? v.cards.length : 0])),
  };

  const challengeList = Array.isArray(challenges) ? challenges : [];
  const challengesResult = {
    path: paths.challenges ?? null,
    total: challengeList.length,
    withDuration: challengeList.filter((c) => c?.duration != null).length,
    withCompletion: challengeList.filter((c) => c?.completion_requirement != null).length,
  };

  const translationKeys = {
    by_name: objectKeys(translations?.by_name).length,
    by_id: objectKeys(translations?.by_id).length,
  };

  return {
    cardsPath: paths.cards ?? null,
    cards: cardResult,
    skills: skillCompare,
    encounters: buildBazaarEncounters(encounters, paths.encounters ?? null),
    monsters: buildBazaarMonsters(monsters, cards, paths.monsters ?? null),
    events: buildBazaarEvents(events, paths.events ?? null),
    eventOverrides: eventOverridesResult,
    cardpacks: cardpacksResult,
    challenges: challengesResult,
    merchantMeta: { path: paths.merchantMeta ?? null, total: Object.keys(merchantMeta).length },
    rarityRules: { path: paths.rarityRules ?? null, keys: Object.keys(rarityRules) },
    translations: { path: paths.translations ?? null, ...translationKeys },
    cacheImportSummary: {
      path: paths.cacheImportSummary ?? null,
      rawCardCount: cacheImportSummary?.raw_card_count ?? null,
      typeCounts: cacheImportSummary?.type_counts ?? null,
      itemCount: cacheImportSummary?.item_count ?? null,
      skillCount: cacheImportSummary?.skill_count ?? null,
      note: 'cache_import_summary 是上游自带摘要，仅原样引用，不参与本工具判定。',
    },
  };
}

// ---------------------------------------------------------------------------
// 肉鸽：按 topic 分类收藏品与 relic 效果
// ---------------------------------------------------------------------------

export function isCollectibleType(type) {
  return type === 9 || type === 'RELIC' || (isPlainObject(type) && type.name === 'RELIC');
}

export function buildRoguelikeCorpus(topicTable, roguelikeTable, paths) {
  const details = isPlainObject(topicTable?.details) ? topicTable.details : {};
  const topics = {};
  const unknown = [];

  for (const [topicId, detail] of Object.entries(details)) {
    const items = isPlainObject(detail?.items) ? detail.items : {};
    const typeDist = {};
    const collectibles = [];
    const notCollectible = {};
    for (const [itemId, item] of Object.entries(items)) {
      const nativeType = item?.type ?? null;
      const label = nativeType == null ? 'undefined' : String(nativeType);
      typeDist[label] = (typeDist[label] ?? 0) + 1;
      if (isCollectibleType(nativeType)) collectibles.push({ itemId, type: nativeType, name: item?.name ?? null, pointer: pointerOf('items', itemId) });
      else {
        if (!notCollectible[label]) notCollectible[label] = { count: 0, sampleIds: [] };
        notCollectible[label].count += 1;
        if (notCollectible[label].sampleIds.length < 10) notCollectible[label].sampleIds.push(itemId);
      }
    }

    const relics = isPlainObject(detail?.relics) ? detail.relics : {};
    const relicIds = Object.keys(relics);
    const relicsWithoutBuffs = relicIds.filter((id) => !Array.isArray(relics[id]?.buffs) || relics[id].buffs.length === 0);
    const relicParams = isPlainObject(detail?.relicParams) ? detail.relicParams : {};

    const choices = isPlainObject(detail?.choices) ? detail.choices : {};
    const choicesList = Object.entries(choices);
    const choiceScenes = isPlainObject(detail?.choiceScenes) ? detail.choiceScenes : {};
    const sceneIds = new Set(Object.keys(choiceScenes));
    const choicesMissingNextScene = choicesList
      .filter(([, choice]) => choice?.nextSceneId != null && !sceneIds.has(choice.nextSceneId))
      .map(([id, choice]) => ({ choiceId: id, nextSceneId: choice.nextSceneId, pointer: pointerOf('choices', id, 'nextSceneId') }));

    // 原生条件 / 消耗 / 概率字段探测
    const probeKeys = { condition: 0, cost: 0, probability: 0 };
    const scanProbe = (obj, pointerBase) => {
      walkJson(obj, (value, pointer) => {
        if (!isPlainObject(value)) return;
        for (const key of Object.keys(value)) {
          if (/condition/i.test(key)) probeKeys.condition += 1;
          if (/cost/i.test(key)) probeKeys.cost += 1;
          if (/probab/i.test(key)) probeKeys.probability += 1;
        }
      }, pointerBase);
    };
    scanProbe(choices, pointerOf('choices'));
    scanProbe(relics, pointerOf('relics'));

    topics[topicId] = {
      source: paths.roguelikeTopicTable ?? null,
      pointerRoot: pointerOf(topicId),
      items: { total: Object.keys(items).length, typeDist },
      collectibles: {
        rule: 'items[].type === 9 或原生字符串 "RELIC"',
        count: collectibles.length,
        ids: collectibles.map((c) => c.itemId),
        sample: collectibles.slice(0, 25),
      },
      notCollectible: {
        note: '非收藏品（招募券/升级券/band/feature/capsule 等原生辅助项）不计入收藏品。',
        byType: notCollectible,
      },
      relicEffects: {
        relics: relicIds.length,
        relicsWithBuffs: relicIds.length - relicsWithoutBuffs.length,
        relicsWithoutBuffsCount: relicsWithoutBuffs.length,
        relicParams: Object.keys(relicParams).length,
        sample: relicIds.slice(0, 10).map((id) => ({ relicId: id, pointer: pointerOf('relics', id) })),
      },
      events: {
        choices: choicesList.length,
        choiceScenes: Object.keys(choiceScenes).length,
        choicesMissingNextScene,
      },
      nativeFields: {
        conditionKeys: probeKeys.condition,
        costKeys: probeKeys.cost,
        probabilityKeys: probeKeys.probability,
      },
    };

    if (probeKeys.condition === 0) unknown.push(`${topicId}: choices/relics 未出现原生 condition 字段`);
    if (probeKeys.cost === 0) unknown.push(`${topicId}: choices/relics 未出现原生 cost 字段`);
    if (probeKeys.probability === 0) unknown.push(`${topicId}: choices/relics 未出现原生 probability 字段`);
  }

  // 全局 roguelike_table.itemTable（原生辅助表，非收藏品定义）
  const itemTable = isPlainObject(roguelikeTable?.itemTable) ? roguelikeTable.itemTable : {};
  const globalItemTable = {};
  for (const [sub, table] of Object.entries(itemTable)) {
    const dist = {};
    for (const item of Object.values(isPlainObject(table) ? table : {})) {
      const label = item?.type == null ? 'undefined' : String(item.type);
      dist[label] = (dist[label] ?? 0) + 1;
    }
    globalItemTable[sub] = { total: Object.keys(table ?? {}).length, typeDist: dist };
  }

  return {
    source: paths.roguelikeTopicTable ?? null,
    roguelikeTableSource: paths.roguelikeTable ?? null,
    topicsTable: objectKeys(topicTable?.topics),
    topicCount: objectKeys(details).length,
    topics,
    globalItemTable: { source: paths.roguelikeTable ?? null, itemTable: globalItemTable },
    unknown,
  };
}

// ---------------------------------------------------------------------------
// 已实现池（本体 112 / 工坊 101）：与全游戏语料显式区分
// ---------------------------------------------------------------------------

export function buildPoolContext({ chess, independentDesign, paths }) {
  const note = '全游戏语料（1375 实体 / 429 可获得 + 额外形态）是候选来源；可执行游戏实现只认下面两个已实现池，不能把全量语料当游戏实现。';
  const result = {
    note,
    chessPath: paths?.chess ?? null,
    independentDesignPath: paths?.independentDesign ?? null,
    base112: null,
    workshop101: null,
    unknown: [],
  };

  if (isPlainObject(chess)) {
    const baseIds = new Set();
    const charIds = new Set();
    const entries = [];
    for (const [chessId, chessEntry] of Object.entries(chess)) {
      if (chessEntry?.visible === true) {
        baseIds.add(chessEntry.baseId ?? chessId);
        if (chessEntry.charId != null) charIds.add(chessEntry.charId);
      }
    }
    result.base112 = {
      label: '本体',
      rule: 'chess.json 中 visible === true 的去重 baseId',
      count: baseIds.size,
      baseIds: [...baseIds],
      charIds: [...charIds],
      pointerRoot: '',
    };
  } else {
    result.unknown.push('本体 112 池定义文件不可用（data/chess.json 缺失）');
  }

  if (isPlainObject(independentDesign) && Array.isArray(independentDesign.operators)) {
    const activeEntries = independentDesign.operators
      .map((operator, index) => ({ operator, index }))
      .filter(({ operator }) => operator?.active === true);
    const charIds = [...new Set(activeEntries.map(({ operator }) => operator?.charId).filter((v) => v != null))];
    result.workshop101 = {
      label: '工坊',
      rule: 'independent-design.json operators[].active === true 的去重 charId',
      count: charIds.length,
      charIds,
      pointers: activeEntries.map(({ operator, index }) => ({
        charId: operator?.charId ?? null,
        pointer: pointerOf('operators', index),
      })),
    };
  } else {
    result.unknown.push('工坊 101 池定义文件不可用（data/independent-design.json 缺失）');
  }

  return result;
}

// ---------------------------------------------------------------------------
// 来源登记 / 汇总
// ---------------------------------------------------------------------------

export function registerSources(sourceRoot, loaded) {
  const sources = {};
  for (const [group, files] of Object.entries(SOURCE_FILES)) {
    for (const [name, rel] of Object.entries(files)) {
      const abs = path.join(sourceRoot, rel);
      const entry = loaded?.[group]?.[name];
      sources[`${group}.${name}`] = {
        path: abs,
        pointerRoot: '',
        present: entry !== undefined && entry !== null,
        topLevelEntries: Array.isArray(entry) ? entry.length : (isPlainObject(entry) ? Object.keys(entry).length : null),
      };
    }
  }
  return sources;
}

export function buildSupplementary({ gamedataConst, enemyHandbookTable, handbookTeamTable, enemyDatabase, activityTable, buffTemplateData, epBreakbuffTable, buffTable, paths }) {
  const enemyData = isPlainObject(enemyHandbookTable?.enemyData) ? enemyHandbookTable.enemyData : {};
  const enemiesArray = Array.isArray(enemyDatabase?.enemies) ? enemyDatabase.enemies : [];
  return {
    gamedataConst: { path: paths?.gamedataConst ?? null, keys: Object.keys(isPlainObject(gamedataConst) ? gamedataConst : {}).length },
    handbookTeams: { path: paths?.handbookTeamTable ?? null, labels: Object.fromEntries(Object.entries(handbookTeamTable ?? {}).map(([id, team]) => [id, { name: team.powerName, pointer: pointerOf(id) }])) },
    enemyHandbook: {
      path: paths?.enemyHandbookTable ?? null,
      enemyDataCount: Object.keys(enemyData).length,
      raceDataCount: Object.keys(isPlainObject(enemyHandbookTable?.raceData) ? enemyHandbookTable.raceData : {}).length,
      levelInfoCount: Array.isArray(enemyHandbookTable?.levelInfoList) ? enemyHandbookTable.levelInfoList.length : 0,
    },
    enemyDatabase: { path: paths?.enemyDatabase ?? null, enemyCount: enemiesArray.length, pointerRoot: '/enemies' },
    activityTable: { path: paths?.activityTable ?? null, topLevelKeys: Object.keys(isPlainObject(activityTable) ? activityTable : {}) },
    buffTemplateData: { path: paths?.buffTemplateData ?? null, entries: isPlainObject(buffTemplateData) ? Object.keys(buffTemplateData).length : null },
    epBreakbuffTable: { path: paths?.epBreakbuffTable ?? null, entries: isPlainObject(epBreakbuffTable) ? Object.keys(epBreakbuffTable).length : null },
    buffTable: { path: paths?.buffTable ?? null, entries: isPlainObject(buffTable) ? Object.keys(buffTable).length : null },
  };
}

export function extractVersions(bazaarReceipt, arknightsReceipt) {
  return {
    bazaar: {
      sourceRepository: bazaarReceipt?.sourceRepository ?? null,
      revision: bazaarReceipt?.revision ?? null,
      receipt: bazaarReceipt?.receipt ?? null,
    },
    arknights: {
      sourceRepository: arknightsReceipt?.sourceRepository ?? null,
      revision: arknightsReceipt?.revision ?? null,
      receipt: arknightsReceipt?.receipt ?? null,
    },
    note: '版本取自主代理 acquisition 回执的原生 revision；不计算摘要、不使用 raw sha 字段。',
  };
}

export function assembleSourceIndex({
  sourceRoot,
  sources,
  arknights,
  bazaar,
  roguelike,
  pools,
  supplementary,
  versions,
}) {
  return {
    schema: SCHEMA_INDEX,
    generatedBy: 'tools/assault/source-corpus.mjs',
    sourceRoot,
    sources,
    versions,
    arknights: {
      classification: arknights.classification,
      operators: arknights.operators,
      nonObtainableCharacters: arknights.nonObtainableCharacters,
      tokens: arknights.tokens,
      traps: arknights.traps,
      extraForms: arknights.extraForms,
      missingReferences: arknights.missingReferences,
      integrity: arknights.integrity,
      masters: arknights.masters,
      supplementary,
    },
    bazaar,
    roguelike,
    pools,
    unknowns: [
      ...(pools?.unknown ?? []),
      ...(roguelike?.unknown ?? []),
      '额外形态仅来自 char_patch_table.patchChars；character_table 内不含阿米娅近卫/医疗形态。',
    ],
  };
}

export function buildOperatorIndex(sourceRoot, index, operators, operatorPath, uniequipPath) {
  return {
    schema: SCHEMA_OPERATORS,
    generatedBy: 'tools/assault/source-corpus.mjs',
    sourceRoot,
    sourceIndex: operatorPath,
    operatorPath,
    sources: {
      characterTable: path.join(sourceRoot, SOURCE_FILES.arknights.characterTable),
      skillTable: path.join(sourceRoot, SOURCE_FILES.arknights.skillTable),
      rangeTable: path.join(sourceRoot, SOURCE_FILES.arknights.rangeTable),
      uniequipTable: path.join(sourceRoot, SOURCE_FILES.arknights.uniequipTable),
      battleEquipTable: path.join(sourceRoot, SOURCE_FILES.arknights.battleEquipTable),
      charPatchTable: path.join(sourceRoot, SOURCE_FILES.arknights.charPatchTable),
      charMetaTable: path.join(sourceRoot, SOURCE_FILES.arknights.charMetaTable),
    },
    count: operators.length,
    operators,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const REQUIRED_ARGS = ['source-root', 'index', 'operators', 'receipt'];

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    let key;
    let value;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      key = token.slice(2, eq);
      value = token.slice(eq + 1);
    } else {
      key = token.slice(2);
      value = argv[i + 1];
      i += 1;
    }
    if (!REQUIRED_ARGS.includes(key)) throw new Error(`unknown argument: --${key}`);
    if (value === undefined || value === '') throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  for (const key of REQUIRED_ARGS) {
    if (!out[key]) throw new Error(`missing required argument: --${key}`);
    if (!path.isAbsolute(out[key])) throw new Error(`--${key} must be an absolute path: ${out[key]}`);
  }
  return out;
}

function readJson(absPath) {
  if (!existsSync(absPath)) return { present: false, value: null };
  return { present: true, value: JSON.parse(readFileSync(absPath, 'utf8')) };
}

function writeAllAtomically(files) {
  const temps = [];
  try {
    for (const { target, content } of files) {
      const tmp = `${target}.tmp-${process.pid}`;
      writeFileSync(tmp, content, { encoding: 'utf8' });
      temps.push({ tmp, target });
    }
    for (const { tmp, target } of temps) renameSync(tmp, target);
    return temps.map((t) => t.target);
  } catch (err) {
    for (const { tmp } of temps) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* noop */ }
    }
    throw err;
  }
}

/** 声明输入必须全部存在；缺失时抛错，绝不写出空索引覆盖旧产物。 */
export function assertInputsPresent(sourceRoot, exists = existsSync, join = path.join) {
  const missing = [];
  for (const files of Object.values(SOURCE_FILES)) {
    for (const rel of Object.values(files)) {
      if (!exists(join(sourceRoot, rel))) missing.push(join(sourceRoot, rel));
    }
  }
  if (missing.length > 0) {
    throw new Error(`source-root 缺少已声明输入（${missing.length}）:\n${missing.join('\n')}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const sourceRoot = args['source-root'];
  const index = args.index;
  const operatorsTarget = args.operators;
  const receiptTarget = args.receipt;

  const abs = (rel) => path.join(sourceRoot, rel);
  const paths = {};
  for (const [group, files] of Object.entries(SOURCE_FILES)) {
    for (const [name, rel] of Object.entries(files)) paths[`${group}.${name}`] = abs(rel);
  }

  assertInputsPresent(sourceRoot);

  const load = (rel) => readJson(abs(rel));

  const bazaarLoads = {
    cards: load(SOURCE_FILES.bazaar.cards),
    skills: load(SOURCE_FILES.bazaar.skills),
    encounters: load(SOURCE_FILES.bazaar.encounters),
    monsters: load(SOURCE_FILES.bazaar.monsters),
    events: load(SOURCE_FILES.bazaar.events),
    eventOverrides: load(SOURCE_FILES.bazaar.eventOverrides),
    cardpacks: load(SOURCE_FILES.bazaar.cardpacks),
    challenges: load(SOURCE_FILES.bazaar.challenges),
    merchantMeta: load(SOURCE_FILES.bazaar.merchantMeta),
    rarityRules: load(SOURCE_FILES.bazaar.rarityRules),
    translations: load(SOURCE_FILES.bazaar.translations),
    cacheImportSummary: load(SOURCE_FILES.bazaar.cacheImportSummary),
  };
  const akLoads = {
    characterTable: load(SOURCE_FILES.arknights.characterTable),
    skillTable: load(SOURCE_FILES.arknights.skillTable),
    uniequipTable: load(SOURCE_FILES.arknights.uniequipTable),
    battleEquipTable: load(SOURCE_FILES.arknights.battleEquipTable),
    rangeTable: load(SOURCE_FILES.arknights.rangeTable),
    charPatchTable: load(SOURCE_FILES.arknights.charPatchTable),
    charMetaTable: load(SOURCE_FILES.arknights.charMetaTable),
    gamedataConst: load(SOURCE_FILES.arknights.gamedataConst),
    roguelikeTopicTable: load(SOURCE_FILES.arknights.roguelikeTopicTable),
    roguelikeTable: load(SOURCE_FILES.arknights.roguelikeTable),
    enemyHandbookTable: load(SOURCE_FILES.arknights.enemyHandbookTable),
    handbookTeamTable: load(SOURCE_FILES.arknights.handbookTeamTable),
    activityTable: load(SOURCE_FILES.arknights.activityTable),
    enemyDatabase: load(SOURCE_FILES.arknights.enemyDatabase),
    buffTemplateData: load(SOURCE_FILES.arknights.buffTemplateData),
    epBreakbuffTable: load(SOURCE_FILES.arknights.epBreakbuffTable),
    buffTable: load(SOURCE_FILES.arknights.buffTable),
  };

  const arknightsPaths = {
    characterTable: paths['arknights.characterTable'],
    skillTable: paths['arknights.skillTable'],
    uniequipTable: paths['arknights.uniequipTable'],
    battleEquipTable: paths['arknights.battleEquipTable'],
    rangeTable: paths['arknights.rangeTable'],
    charPatchTable: paths['arknights.charPatchTable'],
    charMetaTable: paths['arknights.charMetaTable'],
  };

  const arknights = buildArknightsCorpus({
    characterTable: akLoads.characterTable.value ?? {},
    skillTable: akLoads.skillTable.value ?? {},
    rangeTable: akLoads.rangeTable.value ?? {},
    uniequipTable: akLoads.uniequipTable.value ?? {},
    battleEquipTable: akLoads.battleEquipTable.value ?? {},
    charPatchTable: akLoads.charPatchTable.value ?? {},
    charMetaTable: akLoads.charMetaTable.value ?? {},
    paths: arknightsPaths,
  });

  const bazaar = buildBazaarCorpus({
    cards: bazaarLoads.cards.value ?? {},
    skillsGenerated: bazaarLoads.skills.value ?? {},
    encounters: bazaarLoads.encounters.value ?? {},
    monsters: bazaarLoads.monsters.value ?? {},
    events: bazaarLoads.events.value ?? {},
    eventOverrides: bazaarLoads.eventOverrides.value ?? {},
    cardpacks: bazaarLoads.cardpacks.value ?? {},
    challenges: bazaarLoads.challenges.value ?? [],
    merchantMeta: bazaarLoads.merchantMeta.value ?? {},
    rarityRules: bazaarLoads.rarityRules.value ?? {},
    translations: bazaarLoads.translations.value ?? {},
    cacheImportSummary: bazaarLoads.cacheImportSummary.value ?? {},
    paths: {
      cards: paths['bazaar.cards'],
      skills: paths['bazaar.skills'],
      encounters: paths['bazaar.encounters'],
      monsters: paths['bazaar.monsters'],
      events: paths['bazaar.events'],
      eventOverrides: paths['bazaar.eventOverrides'],
      cardpacks: paths['bazaar.cardpacks'],
      challenges: paths['bazaar.challenges'],
      merchantMeta: paths['bazaar.merchantMeta'],
      rarityRules: paths['bazaar.rarityRules'],
      translations: paths['bazaar.translations'],
      cacheImportSummary: paths['bazaar.cacheImportSummary'],
    },
  });

  const roguelike = buildRoguelikeCorpus(
    akLoads.roguelikeTopicTable.value ?? {},
    akLoads.roguelikeTable.value ?? {},
    { roguelikeTopicTable: paths['arknights.roguelikeTopicTable'], roguelikeTable: paths['arknights.roguelikeTable'] },
  );

  const supplementary = buildSupplementary({
    gamedataConst: akLoads.gamedataConst.value,
    enemyHandbookTable: akLoads.enemyHandbookTable.value,
    handbookTeamTable: akLoads.handbookTeamTable.value,
    enemyDatabase: akLoads.enemyDatabase.value,
    activityTable: akLoads.activityTable.value,
    buffTemplateData: akLoads.buffTemplateData.value,
    epBreakbuffTable: akLoads.epBreakbuffTable.value,
    buffTable: akLoads.buffTable.value,
    paths: {
      gamedataConst: paths['arknights.gamedataConst'],
      enemyHandbookTable: paths['arknights.enemyHandbookTable'],
      handbookTeamTable: paths['arknights.handbookTeamTable'],
      enemyDatabase: paths['arknights.enemyDatabase'],
      activityTable: paths['arknights.activityTable'],
      buffTemplateData: paths['arknights.buffTemplateData'],
      epBreakbuffTable: paths['arknights.epBreakbuffTable'],
      buffTable: paths['arknights.buffTable'],
    },
  });

  // 已实现池定义位于项目 data 根（source-root 的父目录）。
  const dataRoot = path.dirname(sourceRoot);
  const chessPath = path.join(dataRoot, 'chess.json');
  const independentPath = path.join(dataRoot, 'independent-design.json');
  const chess = existsSync(chessPath) ? JSON.parse(readFileSync(chessPath, 'utf8')) : null;
  const independentDesign = existsSync(independentPath) ? JSON.parse(readFileSync(independentPath, 'utf8')) : null;
  const pools = buildPoolContext({ chess, independentDesign, paths: { chess: chessPath, independentDesign: independentPath } });

  // 版本回执（主代理 acquisition）
  const runtimeDir = path.dirname(path.dirname(receiptTarget)); // .../runtime
  const bazaarReceiptPath = path.join(runtimeDir, 'assault', 'bazaar-helper-acquisition.json');
  const arknightsReceiptPath = path.join(runtimeDir, 'assault', 'arknights-acquisition.json');
  const bazaarReceipt = existsSync(bazaarReceiptPath) ? JSON.parse(readFileSync(bazaarReceiptPath, 'utf8')) : null;
  const arknightsReceipt = existsSync(arknightsReceiptPath) ? JSON.parse(readFileSync(arknightsReceiptPath, 'utf8')) : null;
  const versions = extractVersions(bazaarReceipt, arknightsReceipt);

  const sources = registerSources(sourceRoot, { bazaar: Object.fromEntries(Object.entries(bazaarLoads).map(([k, v]) => [k, v.value])), arknights: Object.fromEntries(Object.entries(akLoads).map(([k, v]) => [k, v.value])) });

  const sourceIndex = assembleSourceIndex({ sourceRoot, sources, arknights, bazaar, roguelike, pools, supplementary, versions });
  const nativeReceiptPath = path.join(runtimeDir, 'assault', 'bazaar-native-index.json');
  if (existsSync(nativeReceiptPath)) {
    const nativeReceipt = JSON.parse(readFileSync(nativeReceiptPath, 'utf8'));
    sourceIndex.bazaarNative = { index: nativeReceipt.index, receipt: nativeReceiptPath, database: nativeReceipt.database, sourceUrl: nativeReceipt.sourceUrl, versions: nativeReceipt.versions, counts: nativeReceipt.counts, referenceCheck: nativeReceipt.referenceCheck };
  }
  const operatorIndex = buildOperatorIndex(sourceRoot, sourceIndex, arknights.operators, operatorsTarget, paths['arknights.uniequipTable']);

  const receipt = {
    schema: SCHEMA_RECEIPT,
    tool: 'tools/assault/source-corpus.mjs',
    sourceRoot,
    versions,
    counts: {
      arknights: arknights.classification,
      arknightsMissingReferences: arknights.missingReferences.length,
      operatorsIndexed: arknights.operators.length,
      bazaarCards: bazaar.cards.total,
      bazaarCardSkills: bazaar.skills.cardSkillCount,
      bazaarSkillsGenerated: bazaar.skills.skillsGeneratedCount,
      bazaarSkillSameId: bazaar.skills.sameIdCount,
      bazaarEncounters: bazaar.encounters.total,
      bazaarMonsters: bazaar.monsters.total,
      bazaarEventCategories: Object.keys(bazaar.events.categories).length,
      roguelikeTopics: roguelike.topicCount,
      base112: pools.base112?.count ?? null,
      workshop101: pools.workshop101?.count ?? null,
    },
    operators: { path: operatorsTarget, count: arknights.operators.length },
    index: { path: index },
    unknown: sourceIndex.unknowns,
    outputOnly: true,
  };

  writeAllAtomically([
    { target: index, content: JSON.stringify(sourceIndex) },
    { target: operatorsTarget, content: JSON.stringify(operatorIndex) },
    { target: receiptTarget, content: JSON.stringify(receipt, null, 2) },
  ]);

  return { sourceIndex, operatorIndex, receipt };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`source-corpus failed: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  }
}
