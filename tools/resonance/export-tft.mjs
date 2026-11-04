import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft';
const TFTRAITS_MANIFEST_PATH = `${SOURCE_ROOT}/tftraits-source-manifest-18.4.json`;
const INPUTS = {
  en: `${SOURCE_ROOT}/client-16.20-en_us.json`,
  zh: `${SOURCE_ROOT}/client-16.20-zh_cn.json`,
};
const MAP22_INPUT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/tft/map22-client-16.20.json';
const SOURCE_VERSION = '16.20.1';
const PATCH_DATE = '2026-10-06';
const CDRAGON_SOURCE = 'https://raw.communitydragon.org/16.20/cdragon/tft/{locale}.json';
const RIOT_PATCH_SOURCE = 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/';
const data = Object.fromEntries(Object.entries(INPUTS).map(([locale, path]) => [
  locale, JSON.parse(readFileSync(path, 'utf8')),
]));
const map22 = JSON.parse(readFileSync(MAP22_INPUT, 'utf8'));
const tftraitsManifest = JSON.parse(readFileSync(TFTRAITS_MANIFEST_PATH, 'utf8'));
function loadTftraitsAsset(fileName, format = 'json') {
  const manifestEntries = tftraitsManifest.files.filter((entry) => basename(entry.path).toLowerCase() === fileName.toLowerCase());
  if (manifestEntries.length !== 1) throw new Error(`TFTraits manifest ${fileName}: expected one record, got ${manifestEntries.length}`);
  const manifestEntry = manifestEntries[0];
  const actualPath = `${SOURCE_ROOT}/${fileName}`;
  const bytes = readFileSync(actualPath);
  const value = format === 'json' ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8');
  return { value, source: { ...manifestEntry, manifestPath: TFTRAITS_MANIFEST_PATH, actualPath, actualBytes: statSync(actualPath).size } };
}
const tftraitsFiles = Object.fromEntries([
  ['champions', 'tftraits-display-champions-18.4.json'],
  ['items', 'tftraits-display-items-18.4.json'],
  ['traits', 'tftraits-display-traits-18.4.json'],
  ['tables', 'tftraits-display-tables-18.4.json'],
  ['wisps', 'tftraits-wisps-18.4.html'],
  ['augmentsIndex', 'tftraits-augments-index-18.4.html'],
  ['rollOdds', 'tftraits-roll-odds-18.4.html'],
  ['poolSizes', 'tftraits-pool-sizes-18.4.html'],
  ['xpToLevel', 'tftraits-xp-to-level-18.4.html'],
  ['rounds', 'tftraits-rounds-18.4.html'],
  ['topmetaEconomy', 'topmeta-economy-set18-18.4.html'],
  ['topmetaLeveling', 'topmeta-leveling-set18-18.4b.html'],
  ['noxuSystem', 'noxutft-system-tables-set18-oct8.html'],
  ['tftNinjaEconomy', 'tft-ninja-economy-set18-sept25.html'],
  ['riotPatch18_2Xp', 'riot-patch-18.2-including-sept14-xp.html'],
  ['riotPatch', 'riot-patch-18.4-including-oct7-b.html'],
].map(([key, fileName]) => [key, loadTftraitsAsset(fileName, fileName.endsWith('.json') ? 'json' : 'html')]));
const MAP22_SET_PATH = 'Maps/Shipping/Map22/Sets/TFTSet18';
const map22Set = map22[MAP22_SET_PATH];
if (!map22Set) throw new Error(`Map22 TFTSet18 source missing at ${MAP22_SET_PATH}`);

function requireOne(matches, description) {
  if (matches.length !== 1) throw new Error(`${description}: expected 1 source record, got ${matches.length}`);
  return matches[0];
}

const setMeta = Object.fromEntries(Object.entries(data).map(([locale, source]) => {
  const matches = source.setData.filter((entry) => entry.number === 18 && entry.mutator === 'TFTSet18');
  return [locale, requireOne(matches, `${locale} Set18/TFTSet18 setData`)];
}));
const rawSets = Object.fromEntries(Object.entries(data).map(([locale, source]) => [locale, source.sets['18']]));
if (Object.values(rawSets).some((set) => !set)) throw new Error('sets["18"] is missing for a locale');

function makeItemIndex(source, locale) {
  const index = new Map();
  for (const item of source.items) {
    if (!item.apiName) continue;
    const list = index.get(item.apiName) ?? [];
    list.push(item);
    index.set(item.apiName, list);
  }
  return (apiName, group) => requireOne(index.get(apiName) ?? [], `${locale} root.items ${group} ${apiName}`);
}
const resolveItem = Object.fromEntries(Object.entries(data).map(([locale, source]) => [
  locale, makeItemIndex(source, locale),
]));
function requireMapPath(path, description) {
  const value = map22[path];
  if (!value || typeof value !== 'object') throw new Error(`${description}: unresolved Map22 path ${path}`);
  return value;
}
const shopContentData = requireMapPath(map22Set.ShopContentData, 'Set18 ShopContentData');
const shopDropRateTable = requireMapPath(map22Set.DropRateTables?.Shop, 'Set18 Shop drop rate table');
const tierBagEntries = shopContentData.TierBags.flatMap((tierBag, tierIndex) => tierBag.TierBagEntries.map((entry) => {
  const shopData = requireMapPath(entry.ShopData, 'Set18 tier bag shop entry');
  const characterPath = `Characters/${shopData.mName}`;
  const characterRecord = requireMapPath(characterPath, 'Set18 tier bag actual Character');
  if (characterRecord.name !== shopData.mName) throw new Error(`TftShopData.mName does not match ${characterPath}.name: ${shopData.mName}`);
  return {
    apiName: shopData.mName,
    tierIndex,
    tier: tierIndex + 1,
    count: entry.Count,
    entry,
    shopDataPath: entry.ShopData,
    shopData,
    characterPath,
    characterRecord,
  };
}));
const shopPoolByApiName = new Map();
for (const entry of tierBagEntries) {
  if (shopPoolByApiName.has(entry.apiName)) throw new Error(`Duplicate Set18 tier bag member ${entry.apiName}`);
  shopPoolByApiName.set(entry.apiName, entry);
}
const itemListSources = map22Set.itemLists.map((path) => {
  const record = requireMapPath(path, 'Set18 itemList source');
  const memberships = new Map();
  for (const memberPath of record.mItems ?? []) {
    const apiName = memberPath.split('/').at(-1);
    const list = memberships.get(apiName) ?? [];
    list.push({ listName: record.name, listPath: path, memberPath });
    memberships.set(apiName, list);
  }
  return { path, record, memberships };
});
function sourceListMembership(apiName) {
  return itemListSources.flatMap((list) => list.memberships.get(apiName) ?? []);
}
const shopDataListRecords = (map22Set.ShopDataLists ?? []).map((pathOrId) => {
  const list = requireMapPath(pathOrId, 'Set18 ShopDataList');
  return {
    pathOrId,
    list,
    shopDatas: (list.ShopDatas ?? []).map((path) => ({ path, record: requireMapPath(path, 'Set18 shop action') })),
  };
});
const tftCharacterListRecords = (map22Set.tftCharacterLists ?? []).map((ref) => {
  const list = requireMapPath(ref, 'Set18 TftCharacterList');
  return {
    ref,
    list,
    characters: (list.characters ?? []).map((path) => ({ path, record: map22[path] ?? null })),
  };
});
const characterListMembership = new Map();
for (const group of tftCharacterListRecords) {
  for (const { path, record } of group.characters) {
    if (!record?.name) continue;
    const refs = characterListMembership.get(record.name) ?? [];
    refs.push(group.ref);
    characterListMembership.set(record.name, refs);
  }
}

function indexByApiName(records, locale, group) {
  const result = new Map();
  for (const record of records) {
    if (!record.apiName) throw new Error(`${locale} ${group} member has no apiName`);
    if (result.has(record.apiName)) throw new Error(`${locale} ${group} duplicate apiName ${record.apiName}`);
    result.set(record.apiName, record);
  }
  return result;
}

const localizedChampions = Object.fromEntries(Object.entries(data).map(([locale, source]) => [
  locale, indexByApiName(setMeta[locale].champions, locale, 'champion'),
]));
const localizedTraits = Object.fromEntries(Object.entries(data).map(([locale, source]) => [
  locale, indexByApiName(setMeta[locale].traits, locale, 'trait'),
]));
for (const entry of tierBagEntries) {
  if (!localizedChampions.en.has(entry.apiName) || !localizedChampions.zh.has(entry.apiName)) {
    throw new Error(`ShopData.mName ${entry.apiName} does not resolve to a champion in both locales`);
  }
}

function pairById(ids, resolver, description) {
  return ids.map((apiName) => ({
    apiName,
    en: requireOne([resolver.en.get(apiName)].filter(Boolean), `en ${description} ${apiName}`),
    zh: requireOne([resolver.zh.get(apiName)].filter(Boolean), `zh ${description} ${apiName}`),
  }));
}

const localeItems = Object.fromEntries(Object.entries(resolveItem).map(([locale, getItem]) => [
  locale,
  (ids, group) => ids.map((apiName) => getItem(apiName, group)),
]));

function tokenAudit(description, variables = [], effects = {}) {
  const tokens = [...new Set(description.match(/@[A-Za-z0-9_.:*+-]+@|%i:[^%]+%|\{[0-9a-fA-F]{8}\}/g) ?? [])];
  const resolved = [];
  const unresolved = [];
  for (const token of tokens) {
    const body = token.startsWith('@') ? token.slice(1, -1) : null;
    const [, tokenName = '', multiplier = ''] = body?.match(/^([^*]+)(?:\*([0-9.]+))?$/) ?? [];
    const variable = body == null ? undefined : variables.find((entry) => entry.name === tokenName);
    const templateMultiplier = multiplier ? Number(multiplier) : null;
    if (variable) {
      resolved.push({ token, source: `variables[name=${variable.name}].value`, value: variable.value, templateMultiplier });
      continue;
    }
    if (body != null && Object.hasOwn(effects, tokenName)) {
      resolved.push({ token, source: `effects.${tokenName}`, value: effects[tokenName], templateMultiplier });
      continue;
    }
    const hashedField = body == null ? null : binHashField(tokenName);
    if (hashedField && Object.hasOwn(effects, hashedField)) {
      resolved.push({ token, source: `effects.${hashedField}`, sourceFieldName: tokenName, hashAlgorithm: 'FNV-1a-32-lowercase', value: effects[hashedField], templateMultiplier });
      continue;
    }
    unresolved.push(token);
  }
  return { resolvedExactSourceValues: resolved, unresolvedTokens: unresolved };
}

function binHashField(value) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value.toLowerCase(), 'utf8')) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `{${hash.toString(16).padStart(8, '0')}}`;
}
if (binHashField('BonusDamagePercentBase') !== '{a9a813e7}' || binHashField('StonebarkTreeBonusHealth') !== '{b027c2f9}') {
  throw new Error('CDragon BIN field hash verification failed');
}

function itemMember(apiName, group) {
  const en = resolveItem.en(apiName, group);
  const zh = resolveItem.zh(apiName, group);
  const memberships = sourceListMembership(apiName);
  const listNames = [...new Set(memberships.map((entry) => entry.listName))];
  const classification = en.isAugment === true
    ? { category: 'augment', evidence: 'isAugment=true' }
    : listNames.includes('TFTSet18_Items_Charms')
      ? { category: 'clientItem: Set18_Items_Charms', evidence: memberships.filter((entry) => entry.listName === 'TFTSet18_Items_Charms') }
      : listNames.includes('Set18_Items_Augments') || listNames.includes('Common_Items_Augments_Set17') || listNames.includes('Common_Items_Augments')
        ? { category: 'clientItem: augment itemList', evidence: memberships.filter((entry) => /Augments/.test(entry.listName)) }
        : listNames.includes('Set18_Items') || listNames.includes('Common_Items')
          ? { category: 'clientItem: equipment itemList', evidence: memberships.filter((entry) => ['Set18_Items', 'Common_Items'].includes(entry.listName)) }
    : Array.isArray(en.composition) && en.composition.length > 0
      ? { category: 'clientItem: recipe-backed', evidence: 'composition is non-empty' }
      : { category: 'clientItem/分类待核', evidence: 'source fields do not establish a narrower item role' };
  return {
    apiName,
    sourceClassification: classification,
    sourceListMembership: memberships,
    availabilityFromInputs: { legalCurrentPool: 'unknown', activeDisabled: 'unknown' },
    en: { ...en, tokenAudit: tokenAudit(en.desc ?? '', [], en.effects ?? {}) },
    zh: { ...zh, tokenAudit: tokenAudit(zh.desc ?? '', [], zh.effects ?? {}) },
  };
}

const championIds = setMeta.en.champions.map((record) => record.apiName);
const traitIds = setMeta.en.traits.map((record) => record.apiName);
const augmentIds = setMeta.en.augments;
const setItemIds = setMeta.en.items;
for (const [name, ids] of Object.entries({ champions: championIds, traits: traitIds, augments: augmentIds, items: setItemIds })) {
  if (!Array.isArray(ids)) throw new Error(`Set18 setData.${name} is not an array`);
  if (new Set(ids).size !== ids.length) throw new Error(`Set18 setData.${name} contains duplicate IDs`);
}
if (championIds.length !== 91 || traitIds.length !== 36 || augmentIds.length !== 592 || setItemIds.length !== 776) {
  throw new Error(`Unexpected Set18 coverage counts: champions=${championIds.length}, traits=${traitIds.length}, augments=${augmentIds.length}, items=${setItemIds.length}`);
}
for (const locale of ['en', 'zh']) {
  for (const [name, ids] of Object.entries({ champions: championIds, traits: traitIds, augments: augmentIds, items: setItemIds })) {
    const rawValues = setMeta[locale][name];
    const sourceIds = name === 'champions' || name === 'traits' ? rawValues.map((record) => record.apiName) : rawValues;
    if (sourceIds.length !== ids.length || sourceIds.some((id) => !ids.includes(id))) throw new Error(`${locale} Set18 ${name} candidate IDs differ from en_us`);
  }
}

const championPairs = pairById(championIds, localizedChampions, 'champion');
const traitPairs = pairById(traitIds, localizedTraits, 'trait');
const champions = championPairs.map(({ apiName, en, zh }) => {
  const shopPoolEntry = shopPoolByApiName.get(apiName);
  const listRefs = characterListMembership.get(apiName) ?? [];
  const helperListRef = tftCharacterListRecords[0]?.ref;
  const generalListRef = tftCharacterListRecords[1]?.ref;
  const supportListRef = tftCharacterListRecords[2]?.ref;
  const classification = shopPoolEntry ? 'bonded-recruitable-form'
    : listRefs.includes(supportListRef) ? 'nonshop-support-character-list'
      : listRefs.includes(helperListRef) ? 'nonshop-helper-character-list'
        : listRefs.includes(generalListRef) ? 'nonshop-character-list-form'
          : 'nonshop-role-unknown';
  const characterPath = `Characters/${apiName}`;
  return {
    apiName,
    classification,
    classificationEvidence: shopPoolEntry
      ? { shopDataPath: shopPoolEntry.shopDataPath, actualCharacterPath: shopPoolEntry.characterPath, tier: shopPoolEntry.tier, count: shopPoolEntry.count }
      : { sourcePath: MAP22_SET_PATH, reason: 'apiName is absent from all ShopContentData.TierBagEntries', tftCharacterListRefs: listRefs },
    sourceCharacter: map22[characterPath] ?? null,
    shop: shopPoolEntry ? { tier: shopPoolEntry.tier, count: shopPoolEntry.count, BaseCost: shopPoolEntry.shopData.BaseCost, mRarity: shopPoolEntry.shopData.mRarity } : null,
    en: { ...en, ability: { ...en.ability, tokenAudit: tokenAudit(en.ability?.desc ?? '', en.ability?.variables ?? {}) } },
    zh: { ...zh, ability: { ...zh.ability, tokenAudit: tokenAudit(zh.ability?.desc ?? '', zh.ability?.variables ?? {}) } },
  };
});
const traits = traitPairs.map(({ apiName, en, zh }) => ({
  apiName,
  en: { ...en, tokenAudit: tokenAudit(en.desc ?? '', [], traitTokenValues(en.effects ?? [])) },
  zh: { ...zh, tokenAudit: tokenAudit(zh.desc ?? '', [], traitTokenValues(zh.effects ?? [])) },
}));
const augments = augmentIds.map((apiName) => itemMember(apiName, 'augment candidate'));
const setItems = setItemIds.map((apiName) => itemMember(apiName, 'set item candidate'));
if (augments.some((entry) => entry.en.isAugment !== true || entry.zh.isAugment !== true)) throw new Error('A Set18 augment candidate did not resolve to isAugment=true in both locales');
const activeDisabledStatus = { status: 'unknown', reason: 'Set18 setData and resolved root.items expose no active, enabled, disabled, or live-pool field.' };
if (tierBagEntries.length !== 65 || champions.filter((entry) => entry.classification === 'bonded-recruitable-form').length !== 65 || champions.some((entry) => entry.classification === 'bonded-recruitable-form' && !entry.shop)) {
  throw new Error(`Set18 shop-pool identity mismatch: tier entries=${tierBagEntries.length}, classified recruitable=${champions.filter((entry) => entry.classification === 'bonded-recruitable-form').length}`);
}
const shopLevelProbabilities = shopDropRateTable.mDropRatesByLevel.map((row, sourceIndex) => {
  const probabilityField = Object.keys(row).find((key) => key !== '__type');
  const probabilities = row[probabilityField];
  return {
    sourceIndex,
    sourceField: probabilityField,
    raw: row,
    probabilityByTierIndex: probabilities.map((probability, tierIndex) => ({ tierIndex, probability })),
  };
});

function traitTokenValues(effectRows) {
  const values = {};
  for (const [effectIndex, row] of effectRows.entries()) {
    for (const field of ['MinUnits', 'MaxUnits', 'Style']) {
      const sourceField = field[0].toLowerCase() + field.slice(1);
      if (row[sourceField] !== undefined) (values[field] ??= []).push({ effectIndex, minUnits: row.minUnits, maxUnits: row.maxUnits, value: row[sourceField] });
    }
    for (const [key, value] of Object.entries(row.variables ?? {})) (values[key] ??= []).push({ effectIndex, minUnits: row.minUnits, maxUnits: row.maxUnits, value });
  }
  return values;
}

const ICON_LABELS = Object.freeze({ scaleAP: 'AP', scaleAD: 'AD', scaleHealth: 'HP', scaleHP: 'HP' });
function decodeHtml(value) {
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    const key = entity.toLowerCase();
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    if (key === 'nbsp') return ' ';
    const numeric = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    try { return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : whole; } catch { return whole; }
  });
}
function plainText(value) {
  return decodeHtml(String(value ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/row>/gi, ' ')
    .replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
function renderTemplate(template, variables, { star = null, constants = {}, derivedValues = {} } = {}) {
  const values = new Map();
  const derivedSources = new Map();
  if (Array.isArray(variables)) {
    for (const row of variables) if (row?.name != null) values.set(String(row.name), row.value);
  } else if (variables && typeof variables === 'object') {
    for (const [key, value] of Object.entries(variables)) values.set(key, value);
  }
  for (const [key, value] of Object.entries(constants)) values.set(key, value);
  for (const [key, mapping] of Object.entries(derivedValues)) {
    values.set(key, mapping.value);
    derivedSources.set(key, mapping);
  }
  const resolved = [];
  const unresolved = [];
  const text = String(template ?? '').replace(/@([^@]+)@/g, (token, body) => {
    const match = body.match(/^([^*]+?)(?:\*([+-]?(?:\d+\.?\d*|\.\d+)))?$/);
    const name = match?.[1] ?? body;
    if (!values.has(name)) { unresolved.push(token); return token; }
    const raw = values.get(name);
    const value = Array.isArray(raw) ? (star == null ? undefined : raw[star]) : raw;
    if (value === undefined) { unresolved.push(token); return token; }
    const multiplier = match?.[2] == null ? null : Number(match[2]);
    const renderedValue = typeof value === 'number' && multiplier != null
      ? Math.round(value * multiplier * 1_000_000) / 1_000_000
      : value;
    resolved.push({ token, source: derivedSources.has(name) ? 'semantic-derived' : name, ...(derivedSources.has(name) ? { derivedFrom: derivedSources.get(name) } : {}), rawValue: value, templateMultiplier: multiplier, renderedValue });
    return String(renderedValue);
  });
  const unknownIcons = [];
  const withIcons = text.replace(/%i:([^%]+)%/g, (token, id) => {
    if (ICON_LABELS[id]) return ICON_LABELS[id];
    unknownIcons.push(token);
    return token;
  });
  return { text: withIcons, resolved, unresolved: [...new Set(unresolved)], unknownIconTokens: [...new Set(unknownIcons)] };
}

function stripRecommendationAndSimulationFields(value) {
  if (Array.isArray(value)) return value.map(stripRecommendationAndSimulationFields);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (['recommendations', 'dps', 'primarydps', 'share', 'reasoning'].includes(normalized)
      || normalized.startsWith('simulated') || normalized.startsWith('simderived')) continue;
    out[key] = stripRecommendationAndSimulationFields(child);
  }
  return out;
}

function abilityStars(ability) {
  const template = ability?.descriptionTemplate ?? ability?.desc ?? '';
  const variables = ability?.variables ?? [];
  return [1, 2, 3].map((star) => {
    const rendered = renderTemplate(template, variables, { star });
    const starVariables = variables.filter((row) => row && Array.isArray(row.value)).map((row) => ({
      name: row.name,
      value: row.value[star],
      sourceValueIndex: star,
    }));
    return { star, sourceValueIndex: star, text: rendered.text, values: starVariables, resolved: rendered.resolved, unresolved: rendered.unresolved, unknownIconTokens: rendered.unknownIconTokens };
  });
}

function collectChampionForms(record) {
  const forms = [];
  const visit = (node, variantPath) => {
    if (!node || typeof node !== 'object') return;
    if (node.ability && typeof node.ability === 'object') {
      forms.push({
        variantPath,
        profile: node.profile ?? null,
        role: node.role ?? null,
        stats: node.stats ?? null,
        ability: stripRecommendationAndSimulationFields(node.ability),
        stars: abilityStars(node.ability),
      });
    }
    if (node.adaptorAlt) visit(node.adaptorAlt, `${variantPath}.adaptorAlt`);
    for (const key of ['flexVariants', 'evolutions']) {
      const variants = node[key];
      if (Array.isArray(variants)) variants.forEach((variant, index) => visit(variant, `${variantPath}.${key}[${index}]`));
      else if (variants && typeof variants === 'object') for (const [name, variant] of Object.entries(variants)) visit(variant, `${variantPath}.${key}.${name}`);
    }
  };
  visit(record, 'base');
  return forms;
}

function resolvedTraitTiers(record) {
  const rows = [...String(record.tooltipTemplate ?? record.descriptionTemplate ?? '').matchAll(/<row>([\s\S]*?)<\/row>/gi)].map((match) => match[1]);
  return (record.effects ?? []).map((effect, index) => {
    const constants = { MinUnits: effect.minUnits, MaxUnits: effect.maxUnits, Style: effect.style };
    const template = rows.length === record.effects.length ? rows[index] : record.descriptionTemplate ?? record.tooltipTemplate ?? '';
    const rendered = renderTemplate(template, effect.variables ?? {}, { constants });
    return { effectIndex: index, minUnits: effect.minUnits, maxUnits: effect.maxUnits, style: effect.style, renderedText: rendered.text, resolved: rendered.resolved, unresolved: rendered.unresolved, unknownIconTokens: rendered.unknownIconTokens };
  });
}

function parseWispRows(html, publishedItems) {
  const byIcon = new Map();
  for (const item of publishedItems) {
    for (const field of ['iconPath', 'sourceIconPath']) {
      if (!item[field]) continue;
      const key = String(item[field]).split('?')[0].toLowerCase();
      const list = byIcon.get(key) ?? [];
      list.push(item.apiName);
      byIcon.set(key, list);
    }
  }
  const articles = [...html.matchAll(/<article class="wisp-card"([^>]*)>([\s\S]*?)<\/article>/gi)];
  return articles.map(([, attributes, body], index) => {
    const title = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? null;
    const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => plainText(match[1]));
    const images = [...body.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/gi)].map((match) => match[1]);
    const priceRaw = attributes.match(/data-row-price="([^"]*)"/i)?.[1] ?? null;
    const parsedPrice = priceRaw != null && /^\d+(?:\.\d+)?$/.test(priceRaw) ? Number(priceRaw) : null;
    const itemIds = images[0] ? [...new Set(byIcon.get(images[0].toLowerCase()) ?? [])] : [];
    return {
      sourceRow: index,
      name: title == null ? null : plainText(title),
      price: parsedPrice,
      priceRaw,
      effect: paragraphs[0] ?? null,
      blossomEffect: paragraphs[1] ?? null,
      iconPath: images[0] ?? null,
      blossomIconPath: images[1] ?? null,
      publishedItemApiName: itemIds.length === 1 ? itemIds[0] : null,
      itemAssociationStatus: itemIds.length === 1 ? 'exact-icon-path' : itemIds.length === 0 ? 'unresolved' : 'ambiguous',
      itemAssociationCandidates: itemIds,
    };
  });
}

function parseHtmlTables(html) {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((tableMatch, tableIndex) => {
    const table = tableMatch[1];
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) =>
      [...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => plainText(cell[1])));
    const before = html.slice(Math.max(0, tableMatch.index - 1800), tableMatch.index);
    const headings = [...before.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)];
    return { tableIndex, heading: headings.length ? plainText(headings.at(-1)[1]) : null, rows };
  });
}

function supplementSourceRef(key) {
  return tftraitsFiles[key].source;
}

const publishedChampionsSource = tftraitsFiles.champions.value;
const publishedItemsSource = tftraitsFiles.items.value;
const publishedTraitsSource = tftraitsFiles.traits.value;
const publishedTablesSource = tftraitsFiles.tables.value;
const publishedChampionIds = publishedChampionsSource.map((entry) => entry.characterId);
if (publishedChampionsSource.length !== 65 || new Set(publishedChampionIds).size !== 65) throw new Error(`TFTraits champion identity count/uniqueness mismatch: ${publishedChampionIds.length}`);
const nativeShopIds = [...shopPoolByApiName.keys()];
if (nativeShopIds.length !== 65 || nativeShopIds.some((id) => !publishedChampionIds.includes(id)) || publishedChampionIds.some((id) => !shopPoolByApiName.has(id))) {
  throw new Error('TFTraits published champion characterId set does not exactly equal the 65 native Map22 shop identities');
}
const publishedChampions = publishedChampionsSource.map((record) => ({
  characterId: record.characterId,
  nativeApiName: record.characterId,
  nativeShopIdentity: { tier: shopPoolByApiName.get(record.characterId).tier, count: shopPoolByApiName.get(record.characterId).count },
  reference: stripRecommendationAndSimulationFields(record),
  forms: collectChampionForms(record),
}));
const publishedTraits = publishedTraitsSource.map((record) => ({
  ...stripRecommendationAndSimulationFields(record),
  resolvedTiers: resolvedTraitTiers(record),
}));
const publishedItems = publishedItemsSource.map((record) => {
  let semanticDerivedMappings = {};
  if (record.apiName === 'DA_WeStickTogether') {
    const attackSpeed = record.effects?.Attackspeed;
    const displayedPercent = record.effects?.AS;
    if (typeof attackSpeed !== 'number' || typeof displayedPercent !== 'number') throw new Error('DA_WeStickTogether semantic mapping source fields missing');
    const value = attackSpeed - 1;
    if (Math.abs(value * 100 - displayedPercent) > 1e-9) throw new Error('DA_WeStickTogether semantic derivation does not reconcile to source AS');
    semanticDerivedMappings = { AttackSpeedMinusOne: { value, derivedFromFields: ['effects.Attackspeed'], operation: 'Attackspeed - 1', consistencyCheck: { derivedValueTimes100: Math.round(value * 100 * 1_000_000) / 1_000_000, sourceField: 'effects.AS', sourceValue: displayedPercent } } };
  }
  const rendered = renderTemplate(record.descriptionTemplate ?? '', record.effects ?? {}, { derivedValues: semanticDerivedMappings });
  return {
    ...stripRecommendationAndSimulationFields(record),
    resolvedDescription: rendered.text,
    tokenResolution: { resolved: rendered.resolved, unresolved: rendered.unresolved, unknownIconTokens: rendered.unknownIconTokens },
    semanticDerivedMappings,
  };
});
const publishedAugmentItems = publishedItems.filter((record) => record.setDataKind === 'augment');
if (publishedTraits.length !== 36 || publishedItems.length !== 571 || publishedAugmentItems.length !== 257) {
  throw new Error(`TFTraits published coverage mismatch: traits=${publishedTraits.length}, items=${publishedItems.length}, augments=${publishedAugmentItems.length}`);
}
const publishedWisps = parseWispRows(tftraitsFiles.wisps.value, publishedItemsSource);
const mechanismTables = publishedTablesSource;
const globalEconomyTables = Object.fromEntries(['rollOdds', 'poolSizes', 'xpToLevel', 'rounds'].map((key) => [
  key, { source: supplementSourceRef(key), tables: parseHtmlTables(tftraitsFiles[key].value) },
]));
globalEconomyTables.topmetaSet18CrossCheck = { source: supplementSourceRef('topmetaEconomy'), tables: parseHtmlTables(tftraitsFiles.topmetaEconomy.value), interpretation: 'Third-party published Set18 economy table. Compare rows against native Map22 and TFTraits source; source conflicts remain visible and are not silently merged.' };
for (const key of ['topmetaLeveling', 'noxuSystem', 'tftNinjaEconomy']) globalEconomyTables[key] = { source: supplementSourceRef(key), tables: parseHtmlTables(tftraitsFiles[key].value), interpretation: 'Cross-check only; retain source values without treating third-party tables as native game configuration.' };
const currentXpTargets = [2,3,4,5,6,7,8,9,10];
const currentXpToReach = [2,2,6,10,20,36,56,68,68];
const currentPublishedL7Row = tftraitsFiles.rollOdds.value;
const nativeL7Percent = shopLevelProbabilities[6].probabilityByTierIndex.map(({ probability }) => Math.round(probability * 100));
const currentRollOddsTable = parseHtmlTables(currentPublishedL7Row).flatMap((table) => table.rows).find((row) => row[0] === '7');
if (!currentRollOddsTable || currentRollOddsTable.slice(1).map((value) => Number.parseFloat(value)).join(',') !== '16,30,43,10,1') throw new Error('Published current level 7 roll odds source mismatch');
if (nativeL7Percent.join(',') !== '19,30,40,10,1') throw new Error(`Expected native Map22 level 7 odds conflict, got ${nativeL7Percent}`);
globalEconomyTables.currentPublishedReference = {
  source: { actualPath: supplementSourceRef('rollOdds').actualPath },
  leveling: { transitionTargetLevel: currentXpTargets, xpToReach: currentXpToReach, sourceBasis: 'Riot 18.2 primary XP change plus Sept 14 follow-up establishes 56/68/68. TopMeta 18.4B corroborates these values; TFTraits and Noxu still publish the conflicting old level 8 cost of 60, despite their current version or update labels.', sourcePaths: [supplementSourceRef('riotPatch18_2Xp').actualPath, supplementSourceRef('topmetaLeveling').actualPath, supplementSourceRef('noxuSystem').actualPath] },
  shopOdds: { level: 7, tierPercent: [16,30,43,10,1], publishedCurrentReference: true, sourcePath: supplementSourceRef('rollOdds').actualPath, cdragonRawPercent: nativeL7Percent, cdragonSourcePath: MAP22_INPUT, interpretation: 'Published-source choice and explicit CDragon Map22 conflict; not asserted as live engine behavior.' },
  tables: [
    { heading:'Current published XP to reach level', rows:[['Target level','XP to reach'], ...currentXpTargets.map((level,index)=>[String(level),String(currentXpToReach[index])])] },
    { heading:'Level 7 shop odds: published reference and native Map22 conflict', rows:[['Source','1-cost','2-cost','3-cost','4-cost','5-cost'], ['TFTraits current published', '16%','30%','43%','10%','1%'], ['CDragon native Map22', ...nativeL7Percent.map(value=>`${value}%`)]] },
  ],
};

const officialPatchOverlay = {
  source: { url: RIOT_PATCH_SOURCE, declaredPatch: '18.4B', date: '2026-10-07', sourceFile: supplementSourceRef('riotPatch').actualPath },
  championChanges: [
    { characterId: 'DA_18_Camille', field: 'ability.AbilityDamage', baseValue: [150,225,375], to: [150,225,400] },
    { characterId: 'DA_18_Varus', field: 'startingMana/mana', baseValue: [30,120], to: [20,110], fieldMappingStatus: 'published source stats.initialMana is 0; official pair conflicts with source representation' },
    { characterId: 'DA_18_Alistar', field: 'AllyHeal', baseValue: [200,260,320], to: [230,300,400], fieldMappingStatus: 'unverified; raw AllyHeal is [80,105,130], official wording says Heal' },
    { characterId: 'DA_18_Alistar', field: 'Damage', baseValue: [100,150,225], to: [180,270,420] },
    { characterId: 'DA_Gromp18_AP', field: 'SecondaryDamageAP', baseValue: [160,240,375], to: [180,270,435] },
    { characterId: 'DA_Gromp18_AP', field: 'stats.damage', baseValue: 45, to: 50 },
    { characterId: 'DA_Gromp18_AP', field: 'stats.attackSpeed', baseValue: 0.7, to: 0.75 },
    { characterId: 'DA_Murkwolf18', field: 'EmpoweredDamageAD', baseValue: [60,90,135], to: [65,100,160] },
    { characterId: 'DA_18_Warwick', field: 'BiteDamage', baseValue: [215,325,500], to: [230,345,535] },
    { characterId: 'DA_18_Warwick', field: 'description.healPercent', baseValue: 20, to: 25 },
    { characterId: 'DA_CrimsonRaptor18', field: 'stats.damage', baseValue: 55, to: 60 },
    { characterId: 'DA_Nidalee18_AP', field: 'ADform.armorPenetrationBehavior', baseValue: 'bugged behavior', to: 'fixed behavior', tooltipValues: [60,60,80], note: 'tooltip values unchanged' },
  ],
  augmentChanges: [
    ['DA_ChallengersGrace','BuffDuration',3,4], ['DA_EarlyLearnings','InitialStacks',5,3],
    ['DA_ElectrochargeI','stageDamage',[30,50,70,90],[25,40,60,80]], ['DA_FutureFocused','RewardGold',8,5],
    ['DA_GiantAndMighty','FlatHealth',200,225], ['DA_GroupHugI','Armor_Silver/MR_Silver',6,7],
    ['DA_GroupHugII','Armor_Gold/MR_Gold',9,10], ['DA_HeroicGrabBag','Gold',4,6],
    ['DA_HoldTheLine','AttackDamagePcntPerFrontLiner',0.09,0.11], ['DA_HoldTheLine','AbilityPowerPcntPerFrontLiner',0.10,0.11],
    ['DA_SpiritOfRedemption','PercentMissingHealth',0.075,0.09],
  ].map(([apiName, field, baseValue, to]) => ({ apiName, field, baseValue, to })),
  wispChanges: [
    { apiName:'DA_AbandonShip18', field:'StopsAppearingAfterThisManySeconds', baseValue:10, to:2 },
    { apiName:'DA_ArmorMRBooster18', field:'Armor/MR/MagicResist', baseValue:10, to:8 },
    { apiName:'DA_SpeedBooster18', field:'AS/AttackSpeed/AttackSpeedMinusOne', baseValue:[8,1.08,0.08], to:[6,1.06,0.06] },
    { apiName:'DA_Combust18', field:'maxHealthExplosionDamage', baseValue:0.12, to:0.15, variants:'upgrade/prismatic values not specified; retain raw values' },
    { apiName:'DA_18_HealingPool', field:'AmountOfMissingHealthToSee', baseValue:10, to:10, status:'official eligibility threshold agrees with source' },
    { apiName:'DA_ManaRichSoil18', field:'ManaReduction upgrade/base/inverted-base', baseValue:[0.75,0.82], to:[0.80,0.85,0.15], note:'official 20% / 15%; keep source variable meaning' },
    { apiName:'DA_SearchParty18', field:'Cost/Cost_Upgrade', baseValue:[3,2], to:[1,0], fieldMappingStatus:'source representation conflicts with official 3/1 old pair' },
    { apiName:'DA_ThreeMe18', field:'Cost', baseValue:9, to:10, sourceAssociation:'Map22 charm list exact identity; absent from published 571 item list' },
    { apiName:'DA_ThingamajigJar18/Bag18/Sack18', field:'ManaRegenBooster appearance probability', baseValue:null, to:null, status:'reduced; exact probability unknown' },
  ],
  availabilityAndBehavior: [
    { apiName:'DA_HeartOfSteel', status:'temporarily disabled', effectRetainedInBaseData:'18 HP' },
    { apiName:'DA_18_CovenTraitAugment + DA_18_CovenTraitAugment_LootToAP', status:'combined lobby cap 1' },
    { apiName:'DA_18_SolarTraitAugment', status:'lobby cap 1' },
    { apiName:'DA_WeightTheWorth', status:'no longer creates GoldenEgg copy' },
    { apiName:'abilities', status:'some abilities no longer disappear before dealing damage', exactAffectedList:'unknown' },
    { apiName:'DA_MinMax', status:'adds Golden Magnetic Remover' },
    { apiName:'traits', status:'no trait value changes reported; augment appearance rates and lobby limits changed' },
  ],
  sourceConflictsAndGaps: [
    { apiName:'DA_EarlyLearnings', issue:'source description refers only to TFT Vegas Open 2023; official baseline semantic is 5% to 3% AD/AP via InitialStacks and Buff .01' },
    { apiName:'DA_ElectrochargeI', issue:'published effects expose DamageI=30 and DamageII=50 only; all-stage values come from published tables and are kept separately' },
    { apiName:'DA_18_CovenTraitAugment/DA_18_CovenTraitAugment_LootToAP/DA_18_SolarTraitAugment', issue:'candidate source does not establish current active pool' },
  ],
  economySourceNotes: [
    { fact:'Level 7 to 8 XP', baseValues:{ cdragon:60, tftraits:60, noxu:56, topmeta:56 }, currentReference:56, sourcePaths:[supplementSourceRef('topmetaLeveling').actualPath,supplementSourceRef('noxuSystem').actualPath], reason:'Riot primary patch history states 18.2 changed 60 to 56; Sept 14 changed the 8→9 and 9→10 values back to 68 while retaining 7→8 at 56.' },
    { fact:'XP level 8 to 9 / 9 to 10', baseValues:{ cdragon:[68,68], tftraits:[68,68], noxu:[68,68], topmeta:[68,68] }, currentReference:[68,68], sourcePaths:[supplementSourceRef('riotPatch18_2Xp').actualPath,supplementSourceRef('topmetaLeveling').actualPath], reason:'Riot primary patch history identifies 64 then 68; source values remain available in their original tables.' },
    { fact:'base income, interest, win/loss streak, sell values', status:'current public sources align; live native engine consumer/configuration is not verified', sourcePaths:[supplementSourceRef('topmetaEconomy').actualPath,supplementSourceRef('tftNinjaEconomy').actualPath,supplementSourceRef('noxuSystem').actualPath] },
    { fact:'level 7 shop odds', status:'published-table conflict', sourceValues:{ cdragon:[19,30,40,10,1], tftraits:[16,30,43,10,1], noxu:[16,30,43,10,1] }, currentReference:'retain each source independently; no live engine claim' },
  ],
};
const skillCoverage = (() => {
  const forms = publishedChampions.flatMap((champion) => champion.forms.map((form) => ({ champion, form })));
  const stars = forms.flatMap(({ champion, form }) => form.stars.map((star) => ({ characterId: champion.characterId, variantPath: form.variantPath, ...star })));
  return { forms: forms.length, starEntries: stars.length, resolvedTemplateTokens: stars.reduce((sum, row) => sum + row.resolved.length, 0), unresolvedTemplateTokens: stars.flatMap((row) => row.unresolved.map((token) => ({ characterId: row.characterId, variantPath: row.variantPath, star: row.star, token }))), starsWithUnresolved: stars.filter((row) => row.unresolved.length).length };
})();
if (skillCoverage.forms !== 79 || publishedWisps.length !== 152) throw new Error(`Published form/Wisp count mismatch: forms=${skillCoverage.forms}, wisps=${publishedWisps.length}`);

const legalPoolStatus = 'unknown';
const output = {
  schema: 'stronghold.tft-set-reference/v1',
  source: {
    communityDragonTemplate: CDRAGON_SOURCE,
    sourceVersion: SOURCE_VERSION,
    officialPatchDate: PATCH_DATE,
    officialPatchAnnouncement: RIOT_PATCH_SOURCE,
    cdragonBinFieldHashDocumentation: 'https://communitydragon.org/documentation/binfile',
    cdragonBinFieldHashAlgorithm: '32-bit FNV-1a of the lowercased UTF-8 field name; only exact hash-to-template-token matches are resolved.',
    inputs: { ...INPUTS, map22: MAP22_INPUT },
    rawSetNumber: 18,
    rawSetName: rawSets.en.name,
    displayedSetName: 'Set18',
    mutator: setMeta.en.mutator,
    clientSetData: { en: setMeta.en, zh: setMeta.zh },
    clientMap22SetPath: MAP22_SET_PATH,
    rawDropRateTableReferences: map22Set.DropRateTables,
    rawLegacyScriptData: map22Set.ScriptData,
  },
  coverage: {
    championClassificationMethod: 'Recruitment classification resolves ShopContentData.TierBagEntries[].ShopData to the raw TftShopData, follows TftShopData.mName to Characters/<mName>, verifies Character.name equals mName, then joins that identity to the champion apiName. Remaining 26 are split only by exact TftCharacterList membership; absent list membership stays unknown.',
    nonShopFormsRemainSeparate: 'All 26 non-shop champion records remain in the export and are not counted as base recruitable cards; source-list subtype is retained per record without merging character forms.',
    champions: { total: champions.length, bondedRecruitableForms: champions.filter((entry) => entry.classification === 'bonded-recruitable-form').length, nonShopRecords: champions.filter((entry) => entry.classification !== 'bonded-recruitable-form').length },
    nonShopClassification: Object.fromEntries([...new Set(champions.filter((entry) => entry.classification !== 'bonded-recruitable-form').map((entry) => entry.classification))].map((category) => [category, champions.filter((entry) => entry.classification === category).length])),
    traits: traits.length,
    augmentCandidates: { total: augments.length, isAugmentTrue: augments.filter((entry) => entry.en.isAugment === true && entry.zh.isAugment === true).length, legalPoolStatus },
    setItemCandidates: { total: setItems.length, byIsAugment: { true: setItems.filter((entry) => entry.en.isAugment === true).length, false: setItems.filter((entry) => entry.en.isAugment === false).length, unavailable: setItems.filter((entry) => typeof entry.en.isAugment !== 'boolean').length }, legalPoolStatus },
    itemSourceClassification: Object.fromEntries([...new Set(setItems.map((entry) => entry.sourceClassification.category))].map((category) => [category, setItems.filter((entry) => entry.sourceClassification.category === category).length])),
    itemListSourceCounts: Object.fromEntries(itemListSources.map((list) => [list.record.name, list.record.mItems?.length ?? 0])),
    activeDisabledStatus,
    resolvedAllLocales: { champions: champions.length, traits: traits.length, augmentCandidates: augments.length, setItemCandidates: setItems.length },
    unresolvedTokens: {
      champions: champions.flatMap((entry) => ['en', 'zh'].flatMap((locale) => entry[locale].ability.tokenAudit.unresolvedTokens.map((token) => ({ apiName: entry.apiName, locale, token })))),
      traits: traits.flatMap((entry) => ['en', 'zh'].flatMap((locale) => entry[locale].tokenAudit.unresolvedTokens.map((token) => ({ apiName: entry.apiName, locale, token })))),
      augmentCandidates: augments.flatMap((entry) => ['en', 'zh'].flatMap((locale) => entry[locale].tokenAudit.unresolvedTokens.map((token) => ({ apiName: entry.apiName, locale, token })))),
      setItemCandidates: setItems.flatMap((entry) => ['en', 'zh'].flatMap((locale) => entry[locale].tokenAudit.unresolvedTokens.map((token) => ({ apiName: entry.apiName, locale, token })))),
    },
  },
  members: { champions, traits, augmentCandidates: augments, setItemCandidates: setItems },
  economy: {
    shopPool: {
      sourcePath: MAP22_SET_PATH,
      shopContentDataPath: map22Set.ShopContentData,
      rawShopContentData: shopContentData,
      tiers: shopContentData.TierBags.map((tierBag, tierIndex) => ({
        sourceIndex: tierIndex,
        tier: tierIndex + 1,
        entryCount: tierBag.TierBagEntries.length,
        totalCopies: tierBag.TierBagEntries.reduce((sum, entry) => sum + entry.Count, 0),
      })),
      totalDistinctMembers: tierBagEntries.length,
      entries: tierBagEntries,
    },
    dropRates: {
      sourceReference: map22Set.DropRateTables.Shop,
      raw: shopDropRateTable,
      levels: shopLevelProbabilities,
      tierIndexMeaning: 'probability array index corresponds positionally to ShopContentData.TierBags; raw arrays are retained.',
    },
    shopDataLists: shopDataListRecords,
    tftCharacterLists: tftCharacterListRecords,
    itemListSources: itemListSources.map(({ path, record }) => ({ path, record })),
    legacyScriptDataNote: 'ScriptData and non-Shop DropRateTables references are retained verbatim; Set10 and Headliner labels are legacy source fields and do not establish Set18 gameplay behavior.',
  },
  poolInterpretation: {
    clientCandidatesAreNotLegalPool: true,
    legalPoolStatus,
    activeDisabledStatus,
    note: 'Champion recruitment is determined from the exact Map22 Set18 TierBagEntries. setData augments and items and Map22 itemLists are client candidates, not proof of the currently enabled live legal pool.',
  },
  supplement: {
    sources: { manifest: { actualPath: TFTRAITS_MANIFEST_PATH, schemaVersion: tftraitsManifest.schemaVersion, declaredVersion: tftraitsManifest.declaredSourceVersion, coverageBoundary: tftraitsManifest.coverageBoundary }, champions: supplementSourceRef('champions'), items: supplementSourceRef('items'), traits: supplementSourceRef('traits'), tables: supplementSourceRef('tables'), wisps: supplementSourceRef('wisps'), augmentsIndex: supplementSourceRef('augmentsIndex'), rollOdds: supplementSourceRef('rollOdds'), poolSizes: supplementSourceRef('poolSizes'), xpToLevel: supplementSourceRef('xpToLevel'), rounds: supplementSourceRef('rounds'), topmetaEconomy: supplementSourceRef('topmetaEconomy'), topmetaLeveling: supplementSourceRef('topmetaLeveling'), noxuSystem: supplementSourceRef('noxuSystem'), tftNinjaEconomy: supplementSourceRef('tftNinjaEconomy'), riotPatch18_2Xp: supplementSourceRef('riotPatch18_2Xp') },
    declaredVersion: tftraitsManifest.declaredSourceVersion,
    lastModified: supplementSourceRef('champions').lastModified,
    actualGameVersion: { communityDragon: SOURCE_VERSION, officialAnnouncement: '18.4B', retrievedAt: supplementSourceRef('champions').retrievedAt },
    publishedChampions, publishedTraits, publishedItems, publishedAugmentItems,
    publishedWisps, mechanismTables, globalEconomyTables, officialPatchOverlay,
    skillCoverage,
  publishedCoverage: { champions: publishedChampions.length, championForms: skillCoverage.forms, traits: publishedTraits.length, items: publishedItems.length, augments: publishedAugmentItems.length, wisps: publishedWisps.length },
    effectResolution: { unresolvedPublishedItemTokens: publishedItems.reduce((sum,item)=>sum+item.tokenResolution.unresolved.length,0), semanticDerivedPublishedItemTokens: publishedItems.reduce((sum,item)=>sum+item.tokenResolution.resolved.filter(token=>token.source==='semantic-derived').length,0) },
    clientCandidates: { setDataAugments: augments.length, publishedAugments: publishedAugmentItems.length, onlineActiveLegalPool: 'unknown' },
    unresolvedPublishedData: { skillTokens: skillCoverage.unresolvedTemplateTokens, itemTokens: publishedItems.flatMap((item) => item.tokenResolution.unresolved.map((token) => ({ apiName: item.apiName, token }))), wispAssociations: publishedWisps.filter((wisp) => wisp.itemAssociationStatus !== 'exact-icon-path').map((wisp) => ({ name: wisp.name, status: wisp.itemAssociationStatus, candidates: wisp.itemAssociationCandidates, iconPath: wisp.iconPath })) },
  },
};

const jsonPath = resolve(ROOT, 'docs/resonance/reference/tft-set18.json');
const markdownPath = resolve(ROOT, 'docs/resonance/reference/tft-set18.md');
mkdirSync(dirname(jsonPath), { recursive: true });
const unresolvedCount = Object.values(output.coverage.unresolvedTokens).reduce((sum, entries) => sum + entries.length, 0);
const exactResolvedTokenCount = [...champions.map((entry) => ['en', 'zh'].map((locale) => entry[locale].ability.tokenAudit)),
  ...traits.map((entry) => ['en', 'zh'].map((locale) => entry[locale].tokenAudit)),
  ...augments.map((entry) => ['en', 'zh'].map((locale) => entry[locale].tokenAudit)),
  ...setItems.map((entry) => ['en', 'zh'].map((locale) => entry[locale].tokenAudit))]
  .flat(2).reduce((sum, audit) => sum + audit.resolvedExactSourceValues.length, 0);
output.coverage.tokenResolution = { exactSourceValueMappings: exactResolvedTokenCount, unresolvedTokenEntries: unresolvedCount };
writeFileSync(jsonPath, `${JSON.stringify(output)}\n`, 'utf8');
const mdCell = (value) => String(value ?? '—').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
const markdown = [
  '# TFT Set18 reference', '',
  `- Sources: CommunityDragon client ${SOURCE_VERSION}; TFTraits publication ${mdCell(output.supplement.declaredVersion)} (last modified ${mdCell(output.supplement.lastModified)}); Riot 18.4B announcement dated 2026-10-07.`,
  `- Mutator: \`${setMeta.en.mutator}\`; source set number: ${setMeta.en.number}; raw legacy name: \`${rawSets.en.name}\`; displayed as Set18.`,
  `- Exact native recruitable identities: ${output.coverage.champions.bondedRecruitableForms}; published champion references: 65; ability forms: ${skillCoverage.forms}; published traits: 36; published items: 571 (257 marked augment); Wisp cards: ${publishedWisps.length}.`,
  `- Native shop pool by tier: ${output.economy.shopPool.tiers.map((tier) => `T${tier.tier} ${tier.entryCount} kinds / ${tier.totalCopies} copies`).join('; ')}. Published/candidate augment lists do not establish the currently active legal pool; live availability is unknown.`,
  '- TFTraits champion stats, cast data, roles and traits are reference data. Build recommendations and simulated DPS fields are excluded. Each form lists only source variable indices 1★, 2★ and 3★; no fourth-star claim is inferred from later array elements.',
  `- Skill tokens: ${skillCoverage.resolvedTemplateTokens} exact variable substitutions; unresolved entries ${skillCoverage.unresolvedTemplateTokens.length}. Icon tokens are rendered as stat labels only.`,
  '', '## Champions and ability forms', '',
  'Each champion is joined by exact `characterId` to one native Set18 shop identity. Ability values are shown per source variable index; form stats and original variable objects remain in JSON.', '',
  ...publishedChampions.flatMap((champion) => {
    const ref = champion.reference;
    const baseStats = ref.stats ?? {};
    const list = [`### ${mdCell(ref.displayName)} — \`${champion.characterId}\``, '',
      `Cost ${mdCell(ref.cost)}; role ${mdCell(ref.role)}; traits ${mdCell((ref.traits ?? []).map((trait) => trait.name).join(', '))}; native shop tier ${champion.nativeShopIdentity.tier}, copies ${champion.nativeShopIdentity.count}.`,
      `Stats: HP ${mdCell(baseStats.hp)}, mana ${mdCell(baseStats.initialMana)}/${mdCell(baseStats.mana)}, AD ${mdCell(baseStats.damage)}, armor/MR ${mdCell(baseStats.armor)}/${mdCell(baseStats.magicResist)}, attack speed ${mdCell(baseStats.attackSpeed)}, range ${mdCell(baseStats.range)}.`, ''];
    for (const form of champion.forms) {
      list.push(`**${mdCell(form.variantPath)}**${form.profile ? ` (${mdCell(form.profile)})` : ''}; role ${mdCell(form.role)}; stats ${form.stats ? `HP ${mdCell(form.stats.hp)}, mana ${mdCell(form.stats.initialMana)}/${mdCell(form.stats.mana)}, AD ${mdCell(form.stats.damage)}, AS ${mdCell(form.stats.attackSpeed)}` : 'same as champion reference'}.`);
      list.push(`Ability: ${mdCell(form.ability.name)}.`);
      for (const star of form.stars) list.push(`- ${star.star}★: ${mdCell(star.text)}${star.unresolved.length ? ` [unresolved: ${star.unresolved.map(mdCell).join(', ')}]` : ''}`);
      list.push('');
    }
    return list;
  }),
  '## Traits and tier effects', '',
  '| Trait | Threshold | Published effect | Unresolved tokens |', '|---|---:|---|---|',
  ...publishedTraits.flatMap((trait) => (trait.resolvedTiers.length ? trait.resolvedTiers.map((tier) => `| ${mdCell(trait.displayName)} | ${mdCell(tier.minUnits)} | ${mdCell(tier.renderedText)} | ${mdCell(tier.unresolved.join(', '))} |`) : [`| ${mdCell(trait.displayName)} | — | ${mdCell(trait.descriptionTemplate)} | — |`])),
  '', '## Published items and augment effects', '',
  `All ${publishedItems.length} published items are listed below. The ${publishedAugmentItems.length} TFTraits entries tagged as augment are distinct from ${augments.length} CommunityDragon setData augment candidates.`, '',
  '| Kind | Name (`apiName`) | Tags / traits | Published effect | Unresolved |', '|---|---|---|---|---|',
  ...publishedItems.map((item) => `| ${mdCell(item.setDataKind ?? item.category)} | ${mdCell(item.name)} (\`${mdCell(item.apiName)}\`) | ${mdCell([...(item.tags ?? []), ...(item.associatedTraits ?? []).map((trait) => typeof trait === 'string' ? trait : trait.name)].join(', '))} | ${mdCell(item.resolvedDescription || item.descriptionTemplate)} | ${mdCell(item.tokenResolution.unresolved.join(', '))} |`),
  '', '## Wisps and consumables', '',
  `All ${publishedWisps.length} published Wisp-card rows are included. Exact icon associations are shown where source icon paths match; unresolved rows remain explicit.`, '',
  '| Wisp | Price | Effect | Blossom effect | Item association |', '|---|---:|---|---|---|',
  ...publishedWisps.map((wisp) => `| ${mdCell(wisp.name)} | ${mdCell(wisp.price)} | ${mdCell(wisp.effect)} | ${mdCell(wisp.blossomEffect)} | ${mdCell(wisp.publishedItemApiName ?? `${wisp.itemAssociationStatus}: ${wisp.iconPath}`)} |`),
  '', '## Economy reference', '',
  `Native shop tier pool: ${output.economy.shopPool.tiers.map((tier) => `T${tier.tier}: ${tier.entryCount} shop identities, ${tier.totalCopies} copies`).join('; ')}. The JSON retains every TierBagEntries object and its ShopData/Character association.`,
  'Shop odds, champion pool size, XP to level and stage/round timing are transcribed from the versioned published tables below; they do not establish live server configuration.', '',
  'Native Map22 shop odds (exact Set18 DropRateTables.Shop association):', '',
  '| Level row | ' + shopContentData.TierBags.map((_, index) => `Tier ${index + 1}`).join(' | ') + ' |',
  '|---:|' + shopContentData.TierBags.map(() => '---:').join('|') + '|',
  ...output.economy.dropRates.levels.map((row) => `| ${row.sourceIndex + 1} | ${row.probabilityByTierIndex.map((entry) => mdCell(entry.probability)).join(' | ')} |`),
  '',
  ...Object.entries(globalEconomyTables).flatMap(([key, record]) => [`### ${key}`, '', `Source: ${mdCell(record.source.actualPath)}.`, '', ...record.tables.flatMap((table, index) => [`#### ${mdCell(table.heading ?? `${key} table ${index + 1}`)}`, '', ...(table.rows.length ? [`| ${table.rows[0].map(mdCell).join(' | ')} |`, `| ${table.rows[0].map(() => '---').join(' | ')} |`, ...table.rows.slice(1).map((row) => `| ${row.map(mdCell).join(' | ')} |`)] : ['(No rows parsed.)']), ''])]),
  '', '## Official 18.4B overlay', '',
  'Overlay statements are separate from the unchanged CDragon/TFTraits base. `baseValue` records the observed published value (or a documented conflict); `to` records the official change. Unknown or ambiguous mappings remain flagged.', '',
  '| Group | Identity | Field | Base | Official result / status |', '|---|---|---|---|---|',
  ...officialPatchOverlay.championChanges.map((row) => `| Champion | \`${row.characterId}\` | ${mdCell(row.field)} | ${mdCell(JSON.stringify(row.baseValue))} | ${mdCell(JSON.stringify(row.to))}${row.fieldMappingStatus ? `; ${mdCell(row.fieldMappingStatus)}` : ''}${row.note ? `; ${mdCell(row.note)}` : ''} |`),
  ...officialPatchOverlay.augmentChanges.map((row) => `| Augment | \`${row.apiName}\` | ${mdCell(row.field)} | ${mdCell(JSON.stringify(row.baseValue))} | ${mdCell(JSON.stringify(row.to))} |`),
  ...officialPatchOverlay.wispChanges.map((row) => `| Wisp | \`${row.apiName}\` | ${mdCell(row.field)} | ${mdCell(JSON.stringify(row.baseValue))} | ${mdCell(JSON.stringify(row.to))}; ${mdCell(row.note ?? row.status ?? row.variants ?? row.fieldMappingStatus ?? row.sourceAssociation ?? '')} |`),
  ...officialPatchOverlay.availabilityAndBehavior.map((row) => `| Availability/behavior | \`${row.apiName}\` | status | — | ${mdCell(row.status)}${row.effectRetainedInBaseData ? `; base retains ${mdCell(row.effectRetainedInBaseData)}` : ''}${row.exactAffectedList ? `; ${mdCell(row.exactAffectedList)}` : ''} |`),
  '', '## Source gaps and interpretation', '',
  ...officialPatchOverlay.sourceConflictsAndGaps.map((row) => `- \`${row.apiName}\`: ${row.issue}.`),
  ...officialPatchOverlay.economySourceNotes.map((row) => `- Economy — ${mdCell(row.fact)}: ${mdCell(row.currentReference ?? row.status)}; source values ${mdCell(JSON.stringify(row.baseValues ?? row.sourceValues ?? {}))}. ${mdCell(row.reason ?? '')}`),
  `- Published data has ${publishedWisps.filter((wisp) => wisp.itemAssociationStatus !== 'exact-icon-path').length} Wisp rows without an exact item icon association; these remain listed with source image paths.`,
  `- Unresolved published item tokens: ${publishedItems.reduce((n, item) => n + item.tokenResolution.unresolved.length, 0)}; unresolved skill tokens: ${skillCoverage.unresolvedTemplateTokens.length}. No missing value is inferred from an unrelated field.`,
  `- Semantic effect mapping: \`DA_WeStickTogether @AttackSpeedMinusOne*100@\` resolves as ${mdCell(Math.round(publishedItems.find(item=>item.apiName==='DA_WeStickTogether').semanticDerivedMappings.AttackSpeedMinusOne.value * 100 * 1_000_000) / 1_000_000)}% using exact source \`Attackspeed - 1\` and is checked against source \`AS=30\`; the raw effect object is unchanged.`,
  '- Client augment/item candidates and third-party published lists are not evidence of the current online legal pool; live active/disabled status remains unknown except explicit official patch notes.',
  '', `Sources: [CommunityDragon 16.20 client data](${CDRAGON_SOURCE}); [TFTraits source manifest](${TFTRAITS_MANIFEST_PATH}); [Riot patch 18.4 announcement](${RIOT_PATCH_SOURCE}); Riot 18.2 XP correction source: ${mdCell(supplementSourceRef('riotPatch18_2Xp').actualPath)}.`, '',
].map(line => line.replace(/[ \t]+$/, '')).join('\n');
writeFileSync(markdownPath, markdown, 'utf8');
console.log(JSON.stringify({
  jsonPath,
  markdownPath,
  sourceVersion: SOURCE_VERSION,
  mutator: setMeta.en.mutator,
  rawSetName: rawSets.en.name,
  champions: { ...output.coverage.champions, nonShopClassification: output.coverage.nonShopClassification },
  traits: output.coverage.traits,
  augmentCandidates: output.coverage.augmentCandidates,
  setItemCandidates: output.coverage.setItemCandidates,
  resolvedAllLocales: output.coverage.resolvedAllLocales,
  tokenResolution: output.coverage.tokenResolution,
  unresolvedTokenCounts: Object.fromEntries(Object.entries(output.coverage.unresolvedTokens).map(([key, values]) => [key, values.length])),
}, null, 2));
