// tools/assault/bazaar-native.mjs
//
// 进击「官方大巴扎 SQLite 语料索引」：只读取随包 official-GameData.db（readOnly + query_only），
// 索引原始表、稀疏 tier 继承、标准价格默认、本地化占位解析与引用覆盖检查。
// 不设计玩法、不改游戏引擎、不复制整份 raw；每个实体保留源 Id、原生 Version 与
// sourceRef {database,table,rowId,pointer}，供设计逐条回读。
//
// 官方随包快照的原生 Version 字段为 5.0.0，不等同当前联网 19.0。
// 旧 community（bazaar-helper 生成 JSON）单独放在 community 段，两源不混。
//
// ESM，可 import 纯函数；CLI：
//   node tools/assault/bazaar-native.mjs --database <abs> --out <abs> --receipt <abs>
// 三个参数均必填且必须为绝对路径；未知参数直接失败；失败不覆盖旧产物。

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_INDEX = 'assault-bazaar-native-index/v1';
export const SCHEMA_RECEIPT = 'assault-bazaar-native-index-receipt/v1';
export const TIER_ORDER = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Legendary'];
export const OFFICIAL_TABLES = ['cards', 'challenges', 'collectibles', 'game_modes', 'level_ups', 'monsters', 'seasons', 'tooltips'];
export const COMMUNITY_FILES = {
  cards: 'cards_generated.json',
  encounters: 'encounters_generated.json',
  monsters: 'monsters_generated.json',
};
export const OFFICIAL_SOURCE_URL = 'https://data.playthebazaar.com/static/GameData.db.zip';
export const COMMUNITY_SOURCE_REPO = 'https://github.com/lifein-ai/bazaar-helper';
export const NATIVE_DISCLAIMER = '原生 Data Version 字段读作 5.0.0，它不是市场补丁号；当前正式官方库（static/GameData.db.zip）的原生行已验证含 8 件 patch 19 物品与 TCardMusicNoteSocketEffect，两库 Version 字段相同，不能写成旧游戏 5.0。';
export const PATCH19_ITEMS = {
  'Dragon Harp': '7d2322c3-0b07-4518-84d6-1def5bfb2262',
  'Aged Cask': '17a4e1db-dd45-4ed2-b0c5-31200dfb0db9',
  'Dreampearl': '7f310e00-4379-4321-bc63-0fee747ca058',
  'Soda Machine': '16005305-bce3-4cae-8c90-8b6560def112',
  'Sunlight Vault': 'b242a1b0-78ac-4513-ace4-5acf3e42cb11',
  'Games Table': 'd3e0728d-dfc9-49e3-bdfd-abb16cb9e176',
  'Cauterizer': 'ec7a81eb-529c-416c-921a-609b44eda2de',
  'Lightning Focuser': 'cf3b77df-37f4-48f0-829e-178f2a677ca2',
};
export const BASELINE_CARD_TYPES = ['TCardItem', 'TCardSkill', 'TCardEncounterEvent', 'TCardEncounterStep', 'TCardEncounterCombat', 'TCardPlayerEffect', 'TCardEncounterPedestal', 'TCardSocketEffect'];

export const SCHEMA_NOTES = {
  sourceRef: '每个实体带 sourceRef.database(绝对路径)/table/rowId/pointer；pointer 指向该表 Data 内的实体位置（数组按元素索引）。',
  tiers: 'tiers.entries[tier]={attrs 生效标量属性, inh 继承键(在更低 tier 设定), cd={s 秒,src,from}, buy/sell={v,src,from?,std?}, abilities/auras/tooltips 引用 id 数组}；src∈explicit|inherited|standard|unknown；显式键=attrs 键去掉 inh。',
  effects: 'official.effectCatalog 为去重的 ability/aura 结构（trigger/action/priority/activeIn/targetCount/value/enchantment）；卡片 abilities/auras 为 [{k:原生 key,e:catalog 下标}]，精确 $type 指针=sourceRef.pointer+"/Abilities|Auras/<k>/Trigger|Action/$type"。',
  enchantments: '卡片 enchantments 数组元素={v:变体 id,a?:该卡属性覆盖}；变体定义见 official.enchantmentCatalog（ab/au 为 [{k,e:catalog 下标}]）；实体指针=sourceRef.pointer+"/Enchantments/<name>"。',
  texts: 'official.texts 按本地化 Content.Key 去重的原文；placeholder=true 表示仍含未解占位符。',
  localization: '卡片 localization={titleKey,descriptionKey,flavorKey,tooltips:[{i,key,tooltipType,values:{占位符:{tier:值}},unresolved:[{token,reason}]}]}；tooltip 精确指针=sourceRef.pointer+"/Localization/Tooltips/"+i。',
  community: 'community.files.<name>.entities 为旧 bazaar-helper 生成 JSON 的逐条最小索引，path 为该文件绝对路径，pointer 为文件内 JSON 指针；与官方 DB 分开。',
};

const ENCHANT_ACTIONS = new Set(['TActionCardEnchant', 'TActionCardEnchantRandom']);
const PRICE_KINDS = { Item: { buy: 'ItemBuyPrices', sell: 'ItemSellPrices' }, Skill: { buy: 'SkillBuyPrices', sell: 'SkillSellPrices' } };
const PLACEHOLDER_RE = /\{[^}]+\}/;

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
// 通用小工具
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isScalar(v) {
  return v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}

function toUtf8(blob) {
  if (blob === null || blob === undefined) return null;
  if (typeof blob === 'string') return blob;
  if (Buffer.isBuffer(blob)) return blob.toString('utf8');
  if (blob instanceof Uint8Array) return Buffer.from(blob).toString('utf8');
  return String(blob);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function scalarOrUnknown(v) {
  return isScalar(v) ? v : { unknown: true };
}

function countKeys(v) {
  return isPlainObject(v) ? Object.keys(v).length : 0;
}

/** 递归遍历 JSON 值，回调 (value, pointer)。有深度上限，不复制值。 */
export function walkJson(value, visitor, pointer = '', depth = 0) {
  if (depth > 96) return;
  if (!isPlainObject(value) && !Array.isArray(value)) return;
  visitor(value, pointer);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) walkJson(value[i], visitor, `${pointer}/${i}`, depth + 1);
    return;
  }
  for (const key of Object.keys(value)) walkJson(value[key], visitor, `${pointer}/${escapePointerToken(key)}`, depth + 1);
}

// ---------------------------------------------------------------------------
// Data blob -> 实体列表：严格区分数组
// ---------------------------------------------------------------------------

/**
 * 把一个表的 Data 解析成实体列表。数组必须逐元素展开（pointer 指向元素），
 * 单对象整体为一个实体（pointer 空），对象字典逐键展开。
 */
export function normalizeDataEntities(rowId, data) {
  if (Array.isArray(data)) {
    return data.map((entity, index) => ({ key: String(index), entity, pointer: `/${index}`, rowIsArray: true }));
  }
  if (isPlainObject(data)) {
    const values = Object.values(data);
    const looksSingle = ('$type' in data) || ('Id' in data) || values.length === 0 || values.some((v) => !isPlainObject(v));
    if (looksSingle) return [{ key: null, entity: data, pointer: '', rowIsArray: false }];
    return Object.keys(data).map((key) => ({ key, entity: data[key], pointer: pointerOf(key), rowIsArray: false }));
  }
  return [{ key: null, entity: data, pointer: '', rowIsArray: false }];
}

// ---------------------------------------------------------------------------
// 标准价格 / 稀疏 tier 继承
// ---------------------------------------------------------------------------

/** 从原生 game_modes.StandardPrices 取默认价；不存在返回 null（不得当 0）。 */
export function standardPrice(standardPrices, type, direction, size, tier) {
  const keys = PRICE_KINDS[type];
  if (!keys || !isPlainObject(standardPrices)) return null;
  const table = standardPrices[keys[direction]];
  if (!isPlainObject(table)) return null;
  const bySize = table[size];
  if (!isPlainObject(bySize)) return null;
  const value = bySize[tier];
  return value === undefined ? null : value;
}

function describePrice({ cardType, size, tier, effective, owningTier, standardPrices, direction }) {
  if (owningTier !== undefined && effective !== undefined) {
    return { v: scalarOrUnknown(effective), src: owningTier === tier ? 'explicit' : 'inherited', from: owningTier };
  }
  const keys = PRICE_KINDS[cardType];
  if (!keys || !isPlainObject(standardPrices)) return { v: null, src: 'unknown' };
  const std = standardPrice(standardPrices, cardType, direction, size, tier);
  if (std !== null) return { v: std, src: 'standard', std: keys[direction] };
  return { v: null, src: 'unknown' };
}

/**
 * 构建稀疏 tier 视图。Bronze..Legendary 依序折叠：某字段在更高 tier 缺失时继承
 * 最近一个较低已定义 tier 的显式值；没有更低定义则为 unknown。
 * 不从尚不存在的低 tier 生成卡：只对 Data.Tiers 里实际存在的 tier 产出条目。
 */
export function buildTierView(card, standardPrices) {
  const tiersRaw = isPlainObject(card?.Tiers) ? card.Tiers : null;
  const base = {
    applicable: Boolean(tiersRaw),
    tierOrder: TIER_ORDER,
    startingTier: card?.StartingTier ?? null,
    present: [],
    extraTierKeys: [],
    entries: {},
    unknown: [],
  };
  if (!tiersRaw) return base;

  const extraTierKeys = Object.keys(tiersRaw).filter((t) => !TIER_ORDER.includes(t));
  const present = TIER_ORDER.filter((t) => isPlainObject(tiersRaw[t]));
  base.present = present;
  base.extraTierKeys = extraTierKeys;
  if (extraTierKeys.length > 0) base.unknown.push(`Tiers 含未知 tier 键: ${extraTierKeys.join(',')}`);
  if (present.length === 0) {
    base.unknown.push('Tiers 存在但没有任何 Bronze/Silver/Gold/Diamond/Legendary 定义');
    return base;
  }

  const cardType = card?.Type ?? null;
  const size = card?.Size ?? null;
  const effective = {};
  const sources = {};

  for (const tier of TIER_ORDER) {
    if (!isPlainObject(tiersRaw[tier])) continue;
    const rawAttrs = isPlainObject(tiersRaw[tier].Attributes) ? tiersRaw[tier].Attributes : {};
    for (const [key, value] of Object.entries(rawAttrs)) {
      effective[key] = value;
      sources[key] = tier;
    }

    const attrs = {};
    for (const [key, value] of Object.entries(effective)) attrs[key] = scalarOrUnknown(value);
    const inherited = Object.keys(effective).filter((k) => sources[k] !== tier);

    let cd;
    if (effective.CooldownMax === undefined) {
      cd = { src: 'unknown' };
    } else {
      const owner = sources.CooldownMax;
      cd = {
        s: typeof effective.CooldownMax === 'number' ? effective.CooldownMax / 1000 : null,
        src: owner === tier ? 'explicit' : 'inherited',
        from: owner,
      };
    }

    base.entries[tier] = {
      attrs,
      inh: inherited,
      cd,
      buy: describePrice({ cardType, size, tier, effective: effective.BuyPrice, owningTier: sources.BuyPrice, standardPrices, direction: 'buy' }),
      sell: describePrice({ cardType, size, tier, effective: effective.SellPrice, owningTier: sources.SellPrice, standardPrices, direction: 'sell' }),
      abilities: asArray(tiersRaw[tier].AbilityIds),
      auras: asArray(tiersRaw[tier].AuraIds),
      tooltips: asArray(tiersRaw[tier].TooltipIds),
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Ability / Aura 结构 + 占位解析
// ---------------------------------------------------------------------------

export function summarizeValue(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return { scalar: value };
  const type = value.$type ?? null;
  if (type === 'TFixedValue') return { fixed: value.Value ?? null };
  if (type === 'TReferenceValueCardAttribute') {
    return {
      attr: value.AttributeType ?? null,
      mod: isPlainObject(value.Modifier) ? { mode: value.Modifier.ModifyMode ?? null, value: value.Modifier.Value?.Value ?? null, round: value.Modifier.ShouldRound === true } : null,
    };
  }
  if (type === 'TReferenceValueCardCount') return { count: value.Target?.$type ?? null };
  if (type === 'TRangeValue') return { range: { min: value.MinValue ?? null, max: value.MaxValue ?? null, def: value.DefaultValue ?? null } };
  return { type: type ?? 'unknown' };
}

/** 去重的 ability/aura 结构（不含 key/pointer）。 */
export function effectStructure(effect) {
  const action = effect?.Action;
  return {
    trigger: effect?.Trigger?.$type ?? null,
    action: action?.$type ?? null,
    priority: effect?.Priority ?? null,
    activeIn: effect?.ActiveIn ?? null,
    targetCount: action?.TargetCount ?? null,
    value: summarizeValue(action?.Value),
    enchantment: action?.Enchantment ?? null,
  };
}

function makeEffectRegistry() {
  const list = [];
  const map = new Map();
  return {
    list,
    register(effect) {
      const s = JSON.stringify(effectStructure(effect));
      let id = map.get(s);
      if (id === undefined) { id = list.length; list.push(effectStructure(effect)); map.set(s, id); }
      return id;
    },
  };
}

function modifierFactor(modifier) {
  if (!isPlainObject(modifier)) return { resolved: false, value: null };
  const inner = modifier.Value;
  if (isPlainObject(inner) && inner.$type === 'TFixedValue' && typeof inner.Value === 'number') {
    return { resolved: true, mode: modifier.ModifyMode ?? null, value: inner.Value, round: modifier.ShouldRound === true };
  }
  return { resolved: false, value: null };
}

function baseEffectValue(effect, tierAttributes) {
  const value = effect?.Action?.Value;
  if (!isPlainObject(value)) return { resolved: false, reason: 'action.value.absent' };
  if (value.$type === 'TFixedValue') return { resolved: true, value: value.Value ?? null };
  if (value.$type === 'TReferenceValueCardAttribute') {
    const attr = value.AttributeType;
    if (attr === undefined || !isPlainObject(tierAttributes) || !(attr in tierAttributes)) return { resolved: false, reason: `tier.attribute.${attr ?? 'unknown'}.absent` };
    let out = tierAttributes[attr];
    const factor = modifierFactor(value.Modifier);
    if (isPlainObject(value.Modifier) && !factor.resolved) return { resolved: false, reason: 'modifier.unresolved' };
    if (factor.resolved && typeof out === 'number') {
      if (factor.mode === 'Multiply') out *= factor.value;
      else if (factor.mode === 'Add') out += factor.value;
      if (factor.round) out = Math.round(out);
    }
    return { resolved: true, value: out };
  }
  if (value.$type === 'TReferenceValueCardCount') return { resolved: false, reason: 'dynamic.count' };
  if (value.$type === 'TRangeValue') return { resolved: false, reason: 'range.value' };
  return { resolved: false, reason: `value.${value.$type ?? 'unknown'}.unsupported` };
}

/**
 * 逐个占位解析 tooltip：{ability.N}/{aura.N} 及各 .targets/.mod 后缀。
 * 能解析则给出数值，不能解析保留 unknown 与源指针，不猜。
 */
export function resolveTooltipTemplate(template, scope, tierAttributes, extra = {}) {
  const tokens = [];
  if (typeof template !== 'string') return { text: template ?? null, tokens, complete: true };
  const rendered = template.replace(/\{([^}]+)\}/g, (match, token) => {
    const parts = token.split('.');
    const kind = parts[0];
    const key = parts[1];
    const role = parts[2] ?? 'value';
    const out = { token, kind, key, role, resolved: false, value: null, reason: null, sourcePointer: null };
    if (extra.completionRequirement !== undefined && token === 'completionRequirement') {
      out.resolved = true; out.value = extra.completionRequirement; out.sourcePointer = extra.completionRequirementPointer ?? null;
    } else if (kind === 'ability' || kind === 'aura') {
      const map = kind === 'ability' ? scope?.abilities : scope?.auras;
      const effect = isPlainObject(map) ? map[key] : undefined;
      if (!effect) {
        out.reason = `${kind}.${key}.absent`;
      } else if (role === 'targets') {
        const tc = effect.Action?.TargetCount;
        if (typeof tc === 'number') { out.resolved = true; out.value = tc; out.sourcePointer = `${kind}.${key}.Action.TargetCount`; }
        else out.reason = 'targetCount.absent';
      } else if (role === 'mod') {
        const factor = modifierFactor(effect.Action?.Value?.Modifier);
        if (factor.resolved) { out.resolved = true; out.value = factor.value; out.sourcePointer = `${kind}.${key}.Action.Value.Modifier.Value.Value`; }
        else out.reason = 'modifier.absent';
      } else {
        const base = baseEffectValue(effect, tierAttributes);
        out.resolved = base.resolved;
        out.value = base.resolved ? base.value : null;
        out.reason = base.resolved ? null : base.reason;
        out.sourcePointer = `${kind}.${key}`;
      }
    } else {
      out.reason = 'unknown.namespace';
    }
    tokens.push(out);
    return out.resolved ? String(out.value) : match;
  });
  return { text: rendered, tokens, complete: tokens.every((t) => t.resolved) };
}

function registerText(registry, key, text) {
  if (!key || typeof key !== 'string') return false;
  const placeholder = typeof text === 'string' && PLACEHOLDER_RE.test(text);
  if (!registry.has(key)) registry.set(key, { text: text ?? null, placeholder });
  else {
    const entry = registry.get(key);
    if (entry.text == null && text != null) entry.text = text;
  }
  return true;
}

function localizationField(field, registry) {
  if (!isPlainObject(field)) return null;
  const key = field.Key ?? null;
  const text = typeof field.Text === 'string' ? field.Text : null;
  registerText(registry, key, text);
  return key ? { key } : (text == null ? null : { text });
}

function summarizeLocalization(localization, scope, tierView, registry) {
  if (!isPlainObject(localization)) return null;
  const out = {
    titleKey: localizationField(localization.Title, registry),
    descriptionKey: localizationField(localization.Description, registry),
    flavorKey: localizationField(localization.FlavorText, registry),
    tooltips: [],
  };
  const tips = asArray(localization.Tooltips);
  for (let i = 0; i < tips.length; i += 1) {
    const tip = tips[i];
    if (!isPlainObject(tip)) continue;
    const key = tip.Content?.Key ?? null;
    const template = tip.Content?.Text ?? null;
    registerText(registry, key, template);
    const values = {};
    const unresolved = [];
    let completeAll = true;
    const tiers = tierView?.applicable && tierView.present.length > 0 ? tierView.present : [null];
    for (const tier of tiers) {
      const attrs = tier !== null ? (tierView.entries[tier]?.attrs ?? {}) : {};
      const numeric = {};
      for (const [k, v] of Object.entries(attrs)) if (typeof v === 'number') numeric[k] = v;
      const result = resolveTooltipTemplate(template, scope, numeric, {});
      for (const token of result.tokens) {
        if (token.resolved) {
          values[token.token] = values[token.token] ?? {};
          values[token.token][tier !== null ? tier : 'default'] = token.value;
        } else {
          completeAll = false;
          if (!unresolved.some((u) => u.token === token.token)) unresolved.push({ token: token.token, reason: token.reason });
        }
      }
    }
    const entry = { i, key, tooltipType: tip.TooltipType ?? null, values, unresolved, completeAll };
    if (!key && template != null) entry.template = template;
    out.tooltips.push(entry);
  }
  return out;
}

function summarizeEffectMap(map, registry) {
  const out = [];
  if (!isPlainObject(map)) return out;
  for (const key of Object.keys(map)) out.push({ k: key, e: registry.register(map[key]) });
  return out;
}

function summarizeTransform(transform, registry) {
  if (!isPlainObject(transform)) return null;
  return { spawnContextType: transform.SpawnContext?.$type ?? null, abilities: summarizeEffectMap(transform.Abilities, registry) };
}

function summarizeQuests(quests, basePointer) {
  if (!Array.isArray(quests)) return null;
  return { count: quests.length, pointers: quests.map((q, i) => ({ pointer: `${basePointer}/${i}`, entryCount: asArray(q?.Entries).length })) };
}

function summarizeEncounter(card) {
  const type = card?.$type;
  if (!type || !type.startsWith('TCardEncounter')) return null;
  const sc = card.SelectionContext;
  const out = {
    experienceAwardUponSelection: card.ExperienceAwardUponSelection ?? null,
    selectionContext: isPlainObject(sc) ? {
      spawnContextType: sc.SpawnContext?.$type ?? null,
      spawnLimit: sc.SpawnContext?.Limit?.Value ?? null,
      rules: isPlainObject(sc.Rules) ? {
        canSelectMultiple: sc.Rules.CanSelectMultiple ?? null,
        selectionIsFree: sc.Rules.SelectionIsFree ?? null,
        canExit: sc.Rules.CanExit ?? null,
        willAutoSellOnExit: sc.Rules.WillAutoSellOnExit ?? null,
        nextEncounterOnExit: sc.Rules.NextEncounterOnExit ?? null,
      } : null,
    } : null,
    selectionRequirements: isPlainObject(card.SelectionRequirements) ? { type: card.SelectionRequirements.$type ?? null } : null,
    selectionCriteria: isPlainObject(card.SelectionCriteria) ? { type: card.SelectionCriteria.$type ?? null, conditionTypes: asArray(card.SelectionCriteria.Conditions).map((c) => c?.$type ?? null) } : null,
  };
  if (type === 'TCardEncounterStep') out.isReselectable = card.IsReselectable === true;
  if (type === 'TCardEncounterCombat') {
    out.combatant = { type: card.CombatantType?.$type ?? null, monsterTemplateId: card.CombatantType?.MonsterTemplateId ?? null, level: card.CombatantType?.Level ?? null };
    out.rewards = {
      combatGold: card.RewardCombatGold ?? null,
      combatXp: card.RewardCombatXp ?? null,
      victory: isPlainObject(card.RewardVictory) ? { gold: card.RewardVictory.GoldReward ?? null, xp: card.RewardVictory.ExperienceReward ?? null } : null,
      defeat: isPlainObject(card.RewardDefeat) ? { gold: card.RewardDefeat.GoldReward ?? null, xp: card.RewardDefeat.ExperienceReward ?? null } : null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 引用扫描
// ---------------------------------------------------------------------------

function scanCardRefs(entity, basePointer, out) {
  walkJson(entity, (value, pointer) => {
    if (!isPlainObject(value)) return;
    const type = value.$type;
    if (type === 'TCardConditionalId' && typeof value.Id === 'string') out.cardIdRefs.push({ id: value.Id, isNot: value.IsNot === true, pointer: basePointer + pointer + '/Id' });
    if (ENCHANT_ACTIONS.has(type) && typeof value.Enchantment === 'string') out.enchantRefs.push({ enchantment: value.Enchantment, pointer: basePointer + pointer + '/Enchantment' });
  }, '');
}

// ---------------------------------------------------------------------------
// 官方表读取
// ---------------------------------------------------------------------------

/** 只读打开数据库并设置 query_only。 */
export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA query_only = ON;');
  return db;
}

/** 读取所有表的原始行（Id + UTF8 Data），不解析。 */
export function readDatabase(dbPath, tables = OFFICIAL_TABLES) {
  const db = openDatabase(dbPath);
  const out = {};
  try {
    for (const table of tables) {
      const rows = db.prepare(`SELECT Id, Data FROM ${table} ORDER BY Id`).all();
      out[table] = rows.map((row) => ({ rowId: row.Id, dataText: toUtf8(row.Data) }));
    }
  } finally {
    db.close();
  }
  return out;
}

// ---------------------------------------------------------------------------
// 官方索引构建
// ---------------------------------------------------------------------------

function sourceRef(databasePath, table, rowId, pointer) {
  return { database: databasePath, table, rowId, pointer };
}

function buildCards(rows, databasePath, standardPrices, texts, registry) {
  const entities = [];
  const refs = {
    abilityIds: { referenced: 0, resolved: 0, missing: [] },
    auraIds: { referenced: 0, resolved: 0, missing: [] },
    tooltipIds: { referenced: 0, resolved: 0, missing: [] },
    cardIdRefs: [],
    enchantRefs: [],
  };
  const typeCounts = {};
  const nativeVersions = {};
  const enchantmentCatalog = {};
  const enchantCatalogIndex = {};
  let localizationPlaceholders = 0;

  for (const row of rows) {
    const data = JSON.parse(row.dataText);
    for (const { entity, pointer, key } of normalizeDataEntities(row.rowId, data)) {
      const cardType = entity?.$type ?? 'unknown';
      typeCounts[cardType] = (typeCounts[cardType] ?? 0) + 1;
      const version = entity?.Version ?? null;
      nativeVersions[String(version)] = (nativeVersions[String(version)] ?? 0) + 1;

      const tierView = buildTierView(entity, standardPrices);
      const scope = { abilities: entity.Abilities, auras: entity.Auras };
      const localization = summarizeLocalization(entity.Localization, scope, tierView, texts);
      if (localization) {
        for (const f of [localization.titleKey, localization.descriptionKey, localization.flavorKey]) {
          if (f?.key && texts.get(f.key)?.placeholder) localizationPlaceholders += 1;
        }
      }

      const abilities = summarizeEffectMap(entity.Abilities, registry);
      const auras = summarizeEffectMap(entity.Auras, registry);

      const abilityKeys = new Set(isPlainObject(entity.Abilities) ? Object.keys(entity.Abilities) : []);
      const auraKeys = new Set(isPlainObject(entity.Auras) ? Object.keys(entity.Auras) : []);
      const tooltipArrLen = asArray(entity.Localization?.Tooltips).length;
      for (const tier of tierView.present) {
        const entry = tierView.entries[tier];
        for (const aid of entry.abilities) {
          refs.abilityIds.referenced += 1;
          if (abilityKeys.has(String(aid))) refs.abilityIds.resolved += 1;
          else refs.abilityIds.missing.push({ cardId: entity.Id ?? row.rowId, tier, abilityId: aid, pointer: `${pointer}/Tiers/${tier}/AbilityIds` });
        }
        for (const uid of entry.auras) {
          refs.auraIds.referenced += 1;
          if (auraKeys.has(String(uid))) refs.auraIds.resolved += 1;
          else refs.auraIds.missing.push({ cardId: entity.Id ?? row.rowId, tier, auraId: uid, pointer: `${pointer}/Tiers/${tier}/AuraIds` });
        }
        for (const tid of entry.tooltips) {
          refs.tooltipIds.referenced += 1;
          if (Number.isInteger(tid) && tid >= 0 && tid < tooltipArrLen) refs.tooltipIds.resolved += 1;
          else refs.tooltipIds.missing.push({ cardId: entity.Id ?? row.rowId, tier, tooltipId: tid, pointer: `${pointer}/Tiers/${tier}/TooltipIds` });
        }
      }

      scanCardRefs(entity, pointer, refs);

      const enchantments = [];
      for (const [name, e] of Object.entries(isPlainObject(entity.Enchantments) ? entity.Enchantments : {})) {
        const locTips = isPlainObject(e.Localization) ? asArray(e.Localization.Tooltips) : [];
        for (const t of locTips) registerText(texts, t?.Content?.Key ?? null, t?.Content?.Text ?? null);
        const summary = {
          ab: summarizeEffectMap(e.Abilities, registry),
          au: summarizeEffectMap(e.Auras, registry),
          tags: asArray(e.Tags),
          hiddenTags: asArray(e.HiddenTags),
          tooltipKeys: locTips.map((t) => t?.Content?.Key ?? null),
          hasAbilities: e.HasAbilities === true,
          hasAuras: e.HasAuras === true,
        };
        const sig = JSON.stringify(summary);
        const index = (enchantCatalogIndex[name] = enchantCatalogIndex[name] ?? new Map());
        let vid = index.get(sig);
        if (vid === undefined) {
          vid = `${name}#${index.size}`;
          index.set(sig, vid);
          enchantmentCatalog[name] = enchantmentCatalog[name] ?? { variantCount: 0, variants: {} };
          enchantmentCatalog[name].variants[vid] = summary;
          enchantmentCatalog[name].variantCount += 1;
        }
        const entry = { v: vid };
        if (countKeys(e.Attributes) > 0) entry.a = e.Attributes;
        enchantments.push(entry);
      }

      entities.push({
        id: entity.Id ?? row.rowId,
        rowId: row.rowId,
        sourceRef: sourceRef(databasePath, 'cards', row.rowId, pointer),
        nativeVersion: version,
        cardType,
        type: entity.Type ?? null,
        internalName: entity.InternalName ?? null,
        startingTier: entity.StartingTier ?? null,
        size: entity.Size ?? null,
        heroes: asArray(entity.Heroes),
        tags: asArray(entity.Tags),
        hiddenTags: asArray(entity.HiddenTags),
        artKey: entity.ArtKey ?? null,
        translationKey: entity.TranslationKey ?? null,
        tiers: tierView,
        abilities,
        auras,
        enchantments,
        transform: summarizeTransform(entity.Transform, registry),
        quests: summarizeQuests(entity.Quests, pointer),
        encounter: summarizeEncounter(entity),
        localization,
      });
    }
  }
  entities.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { entities, refs, typeCounts, nativeVersions, localizationPlaceholders, enchantmentCatalog };
}

function buildMonsters(rows, databasePath) {
  const entities = [];
  const nativeVersions = {};
  const refs = { itemTemplates: { total: 0, resolved: 0, missing: [] }, skillTemplates: { total: 0, resolved: 0, missing: [] }, instanceIdsNonNull: 0 };
  const itemTypes = {};
  const skillTypes = {};
  const effectTypes = {};

  for (const row of rows) {
    const data = JSON.parse(row.dataText);
    for (const { entity, pointer } of normalizeDataEntities(row.rowId, data)) {
      const version = entity?.Version ?? null;
      nativeVersions[String(version)] = (nativeVersions[String(version)] ?? 0) + 1;
      const player = isPlainObject(entity.Player) ? entity.Player : {};
      const itemEntry = (it, p, section) => {
        if (!isPlainObject(it)) return null;
        if (it.$type) itemTypes[it.$type] = (itemTypes[it.$type] ?? 0) + 1;
        if (it.InstanceId !== null && it.InstanceId !== undefined) refs.instanceIdsNonNull += 1;
        refs.itemTemplates.total += 1;
        return {
          instanceType: it.$type ?? null,
          section,
          socketId: it.SocketId ?? null,
          templateId: it.TemplateId ?? null,
          templateVersion: it.TemplateVersion ?? null,
          instanceId: it.InstanceId ?? null,
          tier: it.Tier ?? null,
          enchantmentType: it.EnchantmentType ?? null,
          attributes: isPlainObject(it.Attributes) ? it.Attributes : {},
          pointer: p,
        };
      };
      const handItems = asArray(player.Hand?.Items).map((it, i) => itemEntry(it, `${pointer}/Player/Hand/Items/${i}`, 'Hand')).filter(Boolean);
      const stashItems = asArray(player.Stash?.Items).map((it, i) => itemEntry(it, `${pointer}/Player/Stash/Items/${i}`, 'Stash')).filter(Boolean);
      const skills = asArray(player.Skills).map((sk, i) => {
        if (!isPlainObject(sk)) return null;
        if (sk.$type) skillTypes[sk.$type] = (skillTypes[sk.$type] ?? 0) + 1;
        refs.skillTemplates.total += 1;
        return {
          instanceType: sk.$type ?? null,
          templateId: sk.TemplateId ?? null,
          templateVersion: sk.TemplateVersion ?? null,
          instanceId: sk.InstanceId ?? null,
          tier: sk.Tier ?? null,
          attributes: isPlainObject(sk.Attributes) ? sk.Attributes : {},
          pointer: `${pointer}/Player/Skills/${i}`,
        };
      }).filter(Boolean);
      const effects = [];
      for (const [i, e] of asArray(player.Socket?.Effects).entries()) {
        if (e?.$type) effectTypes[e.$type] = (effectTypes[e.$type] ?? 0) + 1;
        effects.push({ type: e?.$type ?? null, templateId: e?.TemplateId ?? null, pointer: `${pointer}/Player/Socket/Effects/${i}` });
      }
      for (const [i, e] of asArray(player.Effects).entries()) {
        if (e?.$type) effectTypes[e.$type] = (effectTypes[e.$type] ?? 0) + 1;
        effects.push({ type: e?.$type ?? null, templateId: e?.TemplateId ?? null, pointer: `${pointer}/Player/Effects/${i}` });
      }

      entities.push({
        id: entity.Id ?? row.rowId,
        rowId: row.rowId,
        sourceRef: sourceRef(databasePath, 'monsters', row.rowId, pointer),
        nativeVersion: version,
        internalName: entity.InternalName ?? null,
        player: {
          attributes: isPlainObject(player.Attributes) ? player.Attributes : {},
          healthMax: player.Attributes?.HealthMax ?? null,
          prestige: player.Attributes?.Prestige ?? null,
          level: player.Attributes?.Level ?? null,
          hand: { unlockedSlots: player.Hand?.UnlockedSlots ?? null, items: handItems },
          stash: { unlockedSlots: player.Stash?.UnlockedSlots ?? null, items: stashItems },
          skills,
          socket: { effects },
        },
      });
    }
  }
  entities.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { entities, nativeVersions, refs, itemTypes, skillTypes, effectTypes };
}

function buildSimpleTable(rows, databasePath, table, extract) {
  const entities = [];
  const nativeVersions = {};
  for (const row of rows) {
    const data = JSON.parse(row.dataText);
    for (const { entity, pointer } of normalizeDataEntities(row.rowId, data)) {
      const version = entity?.Version ?? null;
      nativeVersions[String(version)] = (nativeVersions[String(version)] ?? 0) + 1;
      entities.push({ rowId: row.rowId, sourceRef: sourceRef(databasePath, table, row.rowId, pointer), nativeVersion: version, ...extract(entity, pointer, row.rowId) });
    }
  }
  return { entities, nativeVersions };
}

function buildGameModes(rows, databasePath) {
  const built = buildSimpleTable(rows, databasePath, 'game_modes', (e, pointer) => ({
    id: e.Id ?? null,
    modeType: e.$type ?? null,
    victoriesToWin: e.VictoriesToWin ?? null,
    numberOfDays: e.NumberOfDays ?? null,
    hoursInADay: e.HoursInADay ?? null,
    experiencePerLevel: e.ExperiencePerLevel ?? null,
    experiencePerHour: e.ExperiencePerHour ?? null,
    maxLevel: e.MaxLevel ?? null,
    carpetSocketsUnlockPerLevel: e.NumCarpetSocketsUnlockPerLevel ?? null,
    prestige: isPlainObject(e.Prestige) ? { ...e.Prestige } : null,
    standardPrices: isPlainObject(e.StandardPrices) ? e.StandardPrices : null,
    standardPricesPointer: `${pointer}/StandardPrices`,
  }));
  const mode = built.entities[0] ?? null;
  return { ...built, standardPrices: mode?.standardPrices ?? {}, standardPricesPointer: mode?.standardPricesPointer ?? null };
}

function buildCollectibles(rows, databasePath) {
  const entities = [];
  const nativeVersions = {};
  const byRow = {};
  for (const row of rows) {
    const data = JSON.parse(row.dataText);
    byRow[row.rowId] = Array.isArray(data) ? data.length : normalizeDataEntities(row.rowId, data).length;
    for (const { entity, pointer, key } of normalizeDataEntities(row.rowId, data)) {
      const version = entity?.Version ?? null;
      nativeVersions[String(version)] = (nativeVersions[String(version)] ?? 0) + 1;
      entities.push({
        id: entity.Id ?? null,
        rowId: row.rowId,
        dataKey: key,
        sourceRef: sourceRef(databasePath, 'collectibles', row.rowId, pointer),
        nativeVersion: version,
        type: entity.Type ?? null,
        name: entity.Name ?? null,
        internalName: entity.InternalName ?? null,
        rarity: entity.Rarity ?? null,
        isFoundInChests: entity.IsFoundInChests ?? null,
        heroId: entity.HeroId ?? null,
        seasonId: entity.SeasonId ?? null,
      });
    }
  }
  return { entities, nativeVersions, byRow };
}

function buildReferences(cards, monsters, collectibles) {
  const cardIds = new Set(cards.entities.map((c) => c.id));
  const monsterIds = new Set(monsters.entities.map((m) => m.id));
  const seasonIds = new Set(collectibles.entities.map((c) => c.seasonId).filter((v) => v != null).map(String));

  for (const monster of monsters.entities) {
    for (const item of [...monster.player.hand.items, ...monster.player.stash.items]) {
      if (item.templateId == null) monsters.refs.itemTemplates.missing.push({ monsterId: monster.id, templateId: null, pointer: item.pointer, reason: 'TemplateId 缺失' });
      else if (!cardIds.has(item.templateId)) monsters.refs.itemTemplates.missing.push({ monsterId: monster.id, templateId: item.templateId, pointer: item.pointer, reason: 'TemplateId 在 cards 表找不到对应实体（InstanceId 不能当 TemplateId）' });
    }
    for (const skill of monster.player.skills) {
      if (skill.templateId == null) monsters.refs.skillTemplates.missing.push({ monsterId: monster.id, templateId: null, pointer: skill.pointer, reason: 'TemplateId 缺失' });
      else if (!cardIds.has(skill.templateId)) monsters.refs.skillTemplates.missing.push({ monsterId: monster.id, templateId: skill.templateId, pointer: skill.pointer, reason: 'TemplateId 在 cards 表找不到对应实体（InstanceId 不能当 TemplateId）' });
    }
  }
  monsters.refs.itemTemplates.resolved = monsters.refs.itemTemplates.total - monsters.refs.itemTemplates.missing.length;
  monsters.refs.skillTemplates.resolved = monsters.refs.skillTemplates.total - monsters.refs.skillTemplates.missing.length;

  const combatMonsterRefs = { total: 0, resolved: 0, missing: [] };
  for (const card of cards.entities) {
    const id = card.encounter?.combatant?.monsterTemplateId;
    if (id === undefined || id === null) continue;
    combatMonsterRefs.total += 1;
    if (monsterIds.has(id)) combatMonsterRefs.resolved += 1;
    else combatMonsterRefs.missing.push({ cardId: card.id, monsterTemplateId: id, level: card.encounter.combatant.level, pointer: `${card.sourceRef.pointer}/CombatantType/MonsterTemplateId` });
  }
  const cardIdRefs = cards.refs.cardIdRefs.map((entry) => ({ ...entry, resolved: cardIds.has(entry.id) }));
  const enchantRefs = cards.refs.enchantRefs;
  const knownEnchantments = new Set();
  for (const card of cards.entities) for (const e of card.enchantments) knownEnchantments.add(e.v.split('#')[0]);
  const enchantMissing = enchantRefs.filter((e) => !knownEnchantments.has(e.enchantment));

  return {
    cardCount: cardIds.size,
    monsterCount: monsterIds.size,
    abilityIds: cards.refs.abilityIds,
    auraIds: cards.refs.auraIds,
    tooltipIds: cards.refs.tooltipIds,
    cardIdRefs: { total: cardIdRefs.length, resolved: cardIdRefs.filter((r) => r.resolved).length, missing: cardIdRefs.filter((r) => !r.resolved) },
    enchantmentRefs: { total: enchantRefs.length, known: enchantRefs.length - enchantMissing.length, missing: enchantMissing, knownNames: [...knownEnchantments].sort() },
    combatMonsterRefs,
    monsterItemTemplates: monsters.refs.itemTemplates,
    monsterSkillTemplates: monsters.refs.skillTemplates,
    monsterInstanceIds: { nonNull: monsters.refs.instanceIdsNonNull, note: '本快照所有怪物实例 InstanceId 均为 null；InstanceId 是实例标识，不能当 TemplateId 使用。' },
    collectibleSeasons: { seasonIds: [...seasonIds].sort() },
  };
}

function buildOfficial({ dbPath, tables, receipts = {} }) {
  const gameModes = buildGameModes(tables.game_modes, dbPath);
  const texts = new Map();
  const registry = makeEffectRegistry();
  const cards = buildCards(tables.cards, dbPath, gameModes.standardPrices, texts, registry);
  const monsters = buildMonsters(tables.monsters, dbPath);
  const collectibles = buildCollectibles(tables.collectibles, dbPath);
  const challenges = buildSimpleTable(tables.challenges, dbPath, 'challenges', (e, pointer) => ({
    id: e.Id ?? null,
    duration: e.Duration ?? null,
    xpReward: e.XpReward ?? null,
    currencyRewardsCount: asArray(e.CurrencyRewards).length,
    completionRequirement: e.CompletionRequirement ?? null,
    isActive: e.IsActive ?? null,
    trigger: e.Trigger?.$type ?? null,
    triggerPointer: `${pointer}/Trigger/$type`,
    titleKey: e.Localization?.Title?.Key ?? null,
    descriptionKey: e.Localization?.Description?.Key ?? null,
    localizationPointer: `${pointer}/Localization`,
  }));
  const levelUps = buildSimpleTable(tables.level_ups, dbPath, 'level_ups', (e) => ({ id: e.Level ?? null, level: e.Level ?? null, healthIncrease: e.HealthIncrease ?? null }));
  const seasons = buildSimpleTable(tables.seasons, dbPath, 'seasons', (e, pointer) => ({
    id: e.Id ?? null,
    internalName: e.InternalName ?? null,
    textSeasonalAssetId: e.TextSeasonalAssetId ?? null,
    spriteSeasonalAssetId: e.SpriteSeasonalAssetId ?? null,
    chestSeasonalAssetId: e.ChestSeasonalAssetId ?? null,
    pointer,
  }));
  const tooltips = buildSimpleTable(tables.tooltips, dbPath, 'tooltips', (e, pointer) => ({
    id: e.Id ?? null,
    icon: e.Icon ?? null,
    singleton: e.Singleton ?? null,
    postSymbol: e.PostSymbol ?? null,
    postWord: e.PostWord ?? null,
    tag: e.Tag ?? null,
    keyword: e.Keyword ?? null,
    pointer,
  }));

  const references = buildReferences(cards, monsters, collectibles);

  const occurrences = new Map();
  const note = (table, id, rowId, pointer, kind) => {
    if (id === null || id === undefined) return;
    const list = occurrences.get(String(id)) ?? [];
    list.push({ table, id, rowId, pointer, kind });
    occurrences.set(String(id), list);
  };
  for (const c of cards.entities) note('cards', c.id, c.rowId, c.sourceRef.pointer, c.cardType);
  for (const m of monsters.entities) note('monsters', m.id, m.rowId, m.sourceRef.pointer, 'TMonster');
  for (const c of collectibles.entities) note('collectibles', c.id, c.rowId, c.sourceRef.pointer, c.type);
  for (const c of challenges.entities) note('challenges', c.id, c.rowId, c.sourceRef.pointer, 'TChallenge');
  for (const c of seasons.entities) note('seasons', c.id, c.rowId, c.sourceRef.pointer, 'TSeason');
  const duplicates = [];
  let totalOccurrences = 0;
  for (const [id, list] of occurrences) {
    totalOccurrences += list.length;
    if (list.length > 1) duplicates.push({ id, count: list.length, occurrences: list });
  }
  duplicates.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const versionDist = {};
  for (const group of [cards.nativeVersions, monsters.nativeVersions, gameModes.nativeVersions, collectibles.nativeVersions, challenges.nativeVersions, levelUps.nativeVersions, seasons.nativeVersions, tooltips.nativeVersions]) {
    for (const [v, n] of Object.entries(group)) versionDist[v] = (versionDist[v] ?? 0) + n;
  }
  const versions = Object.keys(versionDist).filter((v) => v !== 'null' && v !== 'undefined');
  const nativeVersion = versions.length === 1 ? versions[0] : (versions.sort().pop() ?? null);

  return {
    nativeVersion,
    versionEvidence: {
      databaseVersionField: nativeVersion,
      versionDistribution: versionDist,
      sourceUrl: receipts.sourceUrl ?? OFFICIAL_SOURCE_URL,
      currentAcquisitionReceipt: receipts.currentAcquisitionReceipt ?? null,
      note: 'Data Version 字段=5.0.0，是数据字段而非市场补丁号（两库相同）；当前正式官方库原生行已验证含 patch 19 新增内容。版本以 DB 字段 + 获取回执 + 来源地址为准，不使用摘要/ETag/hash。',
    },
    tables: {
      cards: { databaseRows: tables.cards.length, records: cards.entities.length, types: cards.typeCounts, nativeVersions: cards.nativeVersions, localizationPlaceholders: cards.localizationPlaceholders },
      challenges: { databaseRows: tables.challenges.length, records: challenges.entities.length, nativeVersions: challenges.nativeVersions },
      collectibles: { databaseRows: tables.collectibles.length, records: collectibles.entities.length, byRow: collectibles.byRow, nativeVersions: collectibles.nativeVersions, dataIsArray: true },
      game_modes: { databaseRows: tables.game_modes.length, records: gameModes.entities.length, nativeVersions: gameModes.nativeVersions },
      level_ups: { databaseRows: tables.level_ups.length, records: levelUps.entities.length, nativeVersions: levelUps.nativeVersions },
      monsters: { databaseRows: tables.monsters.length, records: monsters.entities.length, nativeVersions: monsters.nativeVersions, itemInstanceTypes: monsters.itemTypes, skillInstanceTypes: monsters.skillTypes, effectInstanceTypes: monsters.effectTypes },
      seasons: { databaseRows: tables.seasons.length, records: seasons.entities.length, nativeVersions: seasons.nativeVersions },
      tooltips: { databaseRows: tables.tooltips.length, records: tooltips.entities.length, nativeVersions: tooltips.nativeVersions, dataIsDictionary: true },
    },
    texts: Object.fromEntries([...texts].sort((a, b) => a[0].localeCompare(b[0]))),
    effectCatalog: registry.list,
    enchantmentCatalog: cards.enchantmentCatalog,
    cards: cards.entities,
    monsters: monsters.entities,
    gameModes: gameModes.entities,
    standardPrices: gameModes.standardPrices,
    standardPricesPointer: gameModes.standardPricesPointer,
    collectibles: collectibles.entities,
    challenges: challenges.entities,
    levelUps: levelUps.entities,
    seasons: seasons.entities,
    tooltips: tooltips.entities,
    heroStarts: buildHeroStarts(cards.entities),
    latest: buildLatest(cards.entities, cards.typeCounts, receipts),
    references,
    identity: { distinctIds: occurrences.size, totalOccurrences, duplicateIdCount: duplicates.length, duplicates },
  };
}

function buildLatest(cardEntities, cardTypes, receipts) {
  const byId = new Map(cardEntities.map((c) => [c.id, c]));
  const patch19Items = Object.entries(PATCH19_ITEMS).map(([name, id]) => {
    const card = byId.get(id);
    return {
      name,
      id,
      present: Boolean(card),
      actualInternalName: card?.internalName ?? null,
      cardType: card?.cardType ?? null,
      heroes: card?.heroes ?? null,
      sourceRef: card?.sourceRef ?? null,
    };
  });
  const newTypes = Object.keys(cardTypes).filter((t) => !BASELINE_CARD_TYPES.includes(t));
  const receipt = receipts.currentAcquisition ?? null;
  return {
    patch: 19,
    evidenceReceipt: receipts.currentAcquisitionReceipt ?? null,
    sourceUrl: receipts.sourceUrl ?? OFFICIAL_SOURCE_URL,
    versionInterpretation: '原生 Data Version=5.0.0 是数据字段，不是市场补丁号；当前库原生行含 patch 19 新增内容。',
    cardTypes,
    newCardTypes: Object.fromEntries(newTypes.map((t) => [t, cardTypes[t]])),
    patch19Items,
    patch19PresentCount: patch19Items.filter((p) => p.present).length,
    patch19Total: patch19Items.length,
    receiptPatch19Samples: receipt?.patch19Samples ?? null,
  };
}

function buildHeroStarts(cardEntities) {
  const starts = cardEntities.filter((c) => c.cardType === 'TCardEncounterEvent' && /start run/i.test(String(c.internalName ?? '')));
  const heroes = [...new Set(starts.map((s) => (s.heroes && s.heroes[0]) || null).filter((h) => h != null))];
  return {
    rule: 'InternalName 含 "Start Run" 的 TCardEncounterEvent；英雄名取原生 Heroes[0]，不以枚举 Hero8 猜命名。',
    eventCount: starts.length,
    distinctHeroes: heroes,
    events: starts.map((c) => ({
      eventId: c.id,
      hero: c.heroes?.[0] ?? null,
      internalName: c.internalName,
      titleKey: c.localization?.titleKey?.key ?? null,
      descriptionKey: c.localization?.descriptionKey?.key ?? null,
      startingTier: c.startingTier,
      selectionContext: c.encounter?.selectionContext ?? null,
      selectionRequirements: c.encounter?.selectionRequirements ?? null,
      abilities: c.abilities,
      sourceRef: c.sourceRef,
    })),
    startingResources: { status: 'unknown', reason: 'Start Run 事件原生字段只有 SelectionContext(SpawnContext/Rules) 与空的 Abilities/Auras，未携带起步 Gold/卡/技能明细；不猜。' },
  };
}

// ---------------------------------------------------------------------------
// community（旧 bazaar-helper 生成 JSON）单独索引
// ---------------------------------------------------------------------------

function buildCommunity(communityDir, receipts) {
  const files = {};
  const missingFiles = [];
  for (const [name, file] of Object.entries(COMMUNITY_FILES)) {
    const abs = path.join(communityDir, file);
    if (!existsSync(abs)) { files[name] = { path: abs, present: false, count: 0, entities: [] }; missingFiles.push(abs); continue; }
    const value = JSON.parse(readFileSync(abs, 'utf8'));
    const entities = [];
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    for (const [key, entry] of entries) {
      if (!isPlainObject(entry)) continue;
      const pointer = Array.isArray(value) ? `/${key}` : pointerOf(key);
      entities.push({ key, id: entry.id ?? null, internalName: entry.internal_name ?? null, name: entry.name ?? null, type: entry.type ?? null, templateId: entry.template_id ?? null, pointer });
    }
    files[name] = { path: abs, present: true, count: entities.length, entities };
  }

  return {
    note: '旧 community bazaar-helper 生成 JSON，与官方 DB 分开索引；两源都缺当前 19.0 新增内容，不合并成虚构最新版本。',
    sourceRepository: receipts.communityRevision?.sourceRepository ?? COMMUNITY_SOURCE_REPO,
    revision: receipts.communityRevision?.revision ?? null,
    communityDir,
    files,
    missingFiles,
    nativeGameVersion: null,
    nativeGameVersionNote: 'community 生成 JSON 条目不携带原生游戏 Version 字段；版本以上游仓库 revision（获取回执）为准，不用摘要。',
  };
}

// ---------------------------------------------------------------------------
// 汇总与 CLI
// ---------------------------------------------------------------------------

export function buildIndex({ dbPath, tables, receipts = {} }) {
  const official = buildOfficial({ dbPath, tables, receipts });
  const community = buildCommunity(receipts.communityDir ?? path.dirname(dbPath), receipts);
  const r = official.references;
  const staleReceipts = [];
  if (Array.isArray(receipts.databaseReceipt?.tables)) {
    for (const t of receipts.databaseReceipt.tables) {
      const actual = official.tables[t.table]?.databaseRows;
      if (actual !== undefined && actual !== t.databaseRows) staleReceipts.push(`${t.table}: 回执 ${t.databaseRows} vs 实际 ${actual}`);
    }
  }
  const unknown = [
    NATIVE_DISCLAIMER,
    `patch19 物品核实 ${official.latest.patch19PresentCount}/${official.latest.patch19Total}；新卡片类型=${Object.keys(official.latest.newCardTypes).join(',') || '无'}`,
    ...(staleReceipts.length ? [`旧回执与当前库计数不一致（旧 official 回执已过期，仅作历史）: ${staleReceipts.join('; ')}`] : []),
    `未解析 AbilityIds 引用 ${r.abilityIds.missing.length} 条`,
    `未解析 AuraIds 引用 ${r.auraIds.missing.length} 条`,
    `未解析 TooltipIds 引用 ${r.tooltipIds.missing.length} 条`,
    `未解析遭遇怪 TemplateId ${r.combatMonsterRefs.missing.length} 条`,
    `未解析怪物道具 TemplateId ${r.monsterItemTemplates.missing.length} 条`,
    official.heroStarts.startingResources.reason,
  ];
  return {
    schema: SCHEMA_INDEX,
    generatedBy: 'tools/assault/bazaar-native.mjs',
    schemaNotes: SCHEMA_NOTES,
    official,
    community,
    unknown,
  };
}

const REQUIRED_ARGS = ['database', 'out', 'receipt'];

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    let key;
    let value;
    const eq = token.indexOf('=');
    if (eq !== -1) { key = token.slice(2, eq); value = token.slice(eq + 1); }
    else { key = token.slice(2); value = argv[i + 1]; i += 1; }
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
    for (const { tmp } of temps) { try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* noop */ } }
    throw err;
  }
}

export function loadReceipts(receiptTarget, dbPath) {
  const dir = path.dirname(receiptTarget);
  const read = (name) => {
    const abs = path.join(dir, name);
    if (!existsSync(abs)) return { path: abs, present: false, value: null };
    try { return { path: abs, present: true, value: JSON.parse(readFileSync(abs, 'utf8')) }; }
    catch { return { path: abs, present: false, value: null }; }
  };
  const range = read('bazaar-official-range.json');
  const database = read('bazaar-official-database.json');
  const current = read('bazaar-current-acquisition.json');
  const community = read('bazaar-helper-acquisition.json');
  return {
    officialSource: { range: range.path, rangePresent: range.present, database: database.path, databasePresent: database.present, current: current.path, currentPresent: current.present },
    sourceUrl: current.value?.source ?? OFFICIAL_SOURCE_URL,
    legacyRangeReceipt: range.value,
    databaseReceipt: database.value,
    currentAcquisition: current.value,
    currentAcquisitionReceipt: current.present ? current.path : null,
    communityDir: path.dirname(dbPath),
    communityRevision: community.value ? { sourceRepository: community.value.sourceRepository ?? null, revision: community.value.revision ?? null, receipt: community.path } : null,
  };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dbPath = args.database;
  const outPath = args.out;
  const receiptPath = args.receipt;

  if (!existsSync(dbPath)) throw new Error(`database 不存在: ${dbPath}`);

  const receipts = loadReceipts(receiptPath, dbPath);
  const tables = readDatabase(dbPath, OFFICIAL_TABLES);
  const index = buildIndex({ dbPath, tables, receipts });
  const indexText = JSON.stringify(index);
  const bytes = Buffer.byteLength(indexText, 'utf8');

  const receipt = {
    schema: SCHEMA_RECEIPT,
    tool: 'tools/assault/bazaar-native.mjs',
    database: { path: dbPath, bytes: statSync(dbPath).size, nativeVersion: index.official.nativeVersion },
    index: { path: outPath, bytes, schema: index.schema },
    sourceUrl: receipts.sourceUrl,
    versions: { officialNativeVersion: index.official.nativeVersion, communityRevision: index.community.revision, note: '版本取自 DB Version 字段与获取回执 revision；不使用摘要/ETag/hash。' },
    counts: {
      tables: Object.fromEntries(Object.entries(index.official.tables).map(([k, v]) => [k, { databaseRows: v.databaseRows, records: v.records }])),
      cards: index.official.tables.cards.records,
      cardTypes: index.official.tables.cards.types,
      monsters: index.official.tables.monsters.records,
      collectibles: index.official.tables.collectibles.records,
      challenges: index.official.challenges.length,
      levelUps: index.official.levelUps.length,
      seasons: index.official.seasons.length,
      tooltips: index.official.tooltips.length,
      heroStartEvents: index.official.heroStarts.eventCount,
      heroStartHeroes: index.official.heroStarts.distinctHeroes,
      distinctIds: index.official.identity.distinctIds,
      duplicateIdCount: index.official.identity.duplicateIdCount,
      patch19Present: index.official.latest.patch19PresentCount,
      newCardTypes: index.official.latest.newCardTypes,
      communityCards: index.community.files.cards?.count ?? 0,
      communityEncounters: index.community.files.encounters?.count ?? 0,
      communityMonsters: index.community.files.monsters?.count ?? 0,
    },
    referenceCheck: {
      abilityIds: { referenced: index.official.references.abilityIds.referenced, resolved: index.official.references.abilityIds.resolved, missing: index.official.references.abilityIds.missing.length },
      auraIds: { referenced: index.official.references.auraIds.referenced, resolved: index.official.references.auraIds.resolved, missing: index.official.references.auraIds.missing.length },
      tooltipIds: { referenced: index.official.references.tooltipIds.referenced, resolved: index.official.references.tooltipIds.resolved, missing: index.official.references.tooltipIds.missing.length },
      combatMonsterRefs: { total: index.official.references.combatMonsterRefs.total, resolved: index.official.references.combatMonsterRefs.resolved, missing: index.official.references.combatMonsterRefs.missing.length },
      monsterItemTemplates: { total: index.official.references.monsterItemTemplates.total, resolved: index.official.references.monsterItemTemplates.resolved, missing: index.official.references.monsterItemTemplates.missing.length },
      monsterSkillTemplates: { total: index.official.references.monsterSkillTemplates.total, resolved: index.official.references.monsterSkillTemplates.resolved, missing: index.official.references.monsterSkillTemplates.missing.length },
    },
    unknown: index.unknown,
    outputOnly: true,
  };

  writeAllAtomically([
    { target: outPath, content: indexText },
    { target: receiptPath, content: JSON.stringify(receipt, null, 2) },
  ]);

  return { index, receipt };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const { receipt } = main();
    process.stdout.write(`bazaar-native: ok indexBytes=${receipt.index.bytes} nativeVersion=${receipt.database.nativeVersion} cards=${receipt.counts.cards} monsters=${receipt.counts.monsters} collectibles=${receipt.counts.collectibles} community=${receipt.counts.communityCards}+${receipt.counts.communityEncounters}+${receipt.counts.communityMonsters}\n`);
  } catch (err) {
    process.stderr.write(`bazaar-native failed: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  }
}
