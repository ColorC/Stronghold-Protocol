#!/usr/bin/env node
// Exact, bounded extraction of the original Workshop 1613886175 game-data mirror.
// Reads public data and parses KV/Lua literals. It never executes downloaded Lua.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_COMMIT = '8dde7071e6f07d1b5bbe3d415bcf4ef0a6a18b8e';
const REPOSITORY = 'QFunnn/dota2-customs';
const INPUT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-reference/dota';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = path.join(ROOT, 'docs/resonance/reference');
const LIMIT = 20 * 1024 * 1024;
const deadline = setTimeout(() => { console.error(JSON.stringify({ ok: false, reason: '60-second acquisition/parse deadline', input: INPUT, output: OUTPUT })); process.exit(124); }, 60000);
deadline.unref();
const sourceUrl = p => `https://raw.githubusercontent.com/${REPOSITORY}/${SOURCE_COMMIT}/${p}`;
const initialPaths = ['info.json', 'addoninfo.txt', 'dac_config.txt', 'scripts/npc/dac_common_kv.txt', 'scripts/npc/npc_units_custom.txt', 'scripts/npc/npc_abilities_custom.txt', 'scripts/npc/npc_items_custom.txt', 'scripts/npc/npc_heroes_custom.txt', 'scripts/vscripts/addon_game_mode.lua', 'resource/addon_schinese.txt', 'resource/addon_english.txt'];
let bytes = 0;
const texts = new Map(), sourceEntries = [];

async function safeAncestors(target) {
  let current = path.resolve(target);
  while (true) {
    try { const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw new Error(`Linked path: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function decode(buffer) { return buffer[0] === 255 && buffer[1] === 254 ? buffer.subarray(2).toString('utf16le') : buffer.toString('utf8').replace(/^\uFEFF/, ''); }
async function acquire(sourcePath) {
  if (texts.has(sourcePath)) return texts.get(sourcePath);
  if (sourcePath.includes('..') || path.isAbsolute(sourcePath)) throw new Error(`Invalid source path ${sourcePath}`);
  const absolute = path.join(INPUT, ...sourcePath.split('/'));
  await safeAncestors(absolute);
  let buffer;
  try { buffer = await fs.readFile(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(sourceUrl(sourcePath), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${sourceUrl(sourcePath)}`);
    buffer = Buffer.from(await response.arrayBuffer());
    if (bytes + buffer.length > LIMIT) throw new Error('Input size limit exceeded');
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer, { flag: 'wx' });
  }
  bytes += buffer.length;
  if (bytes > LIMIT) throw new Error('Input size limit exceeded');
  const text = decode(buffer); texts.set(sourcePath, text);
  sourceEntries.push({ sourceCommit: SOURCE_COMMIT, sourcePath, url: sourceUrl(sourcePath), absolutePath: absolute, bytes: buffer.length });
  return text;
}

// Valve KeyValues: retains all raw strings, nested fields and duplicate keys.
function parseKv(text) {
  text = text.replace(/^--\[\[[\s\S]*?\]\]/, '');
  const tokens = [...text.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[{}]|#[A-Za-z_]+/g)].map(m => m[0]).filter(t => !t.startsWith('//') && !t.startsWith('/*'));
  let position = 0;
  const value = t => t.startsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : t;
  function body(untilClose = false) {
    const object = {};
    while (position < tokens.length) {
      const token = tokens[position++];
      if (token === '}') { if (!untilClose) throw new Error('Unexpected KV closing brace'); return object; }
      const key = value(token), next = tokens[position++];
      if (next === undefined) throw new Error(`Missing KV value: ${key}`);
      const result = next === '{' ? body(true) : value(next);
      if (Object.hasOwn(object, key)) { object.__duplicates ??= {}; object.__duplicates[key] ??= [object[key]]; object.__duplicates[key].push(result); }
      object[key] = result;
    }
    if (untilClose) throw new Error('Unclosed KV object');
    return object;
  }
  return body();
}
function cleanLua(text) {
  // Token-aware comment stripping leaves comment-shaped text inside strings alone.
  return text.replace(/--\[\[[\s\S]*?\]\]|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, token => token.startsWith('--') ? ' ' : token);
}
function luaTable(lua, name) {
  const clean = cleanLua(lua), match = new RegExp(`_G\\.${name}\\s*=\\s*\\{`).exec(clean);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let level = 0, quote = null;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') level++;
    if (c === '}' && --level === 0) return clean.slice(start, i + 1);
  }
  throw new Error(`Unclosed Lua table ${name}`);
}
const quoted = text => [...(text || '').matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
const tiers = text => Object.fromEntries([...(text || '').matchAll(/\[(\d+)\]\s*=\s*\{([^}]*)\}/g)].map(m => [m[1], quoted(m[2])]));
function luaReferences(text) {
  return [...text.matchAll(/(?:ScriptFile"?\s*"|(?:LinkLuaModifier\([^,]+,\s*)["'])([^"']+\.lua|[^"']+)["']/g)].map(m => m[1]);
}
function normalizedTokens(tokens) { return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key.toLowerCase(), value])); }
function localized(tokens, key) { return tokens[key.toLowerCase()] ?? ''; }
function parameters(kv, level) {
  const result = {};
  const select = raw => {
    if (typeof raw !== 'string') return raw;
    const values = raw.trim().split(/\s+/);
    return values.every(value => /^-?\d+(?:\.\d+)?$/.test(value)) && values.length > 1 ? values[Math.min(level - 1, values.length - 1)] : raw;
  };
  for (const [key, value] of Object.entries(kv || {})) if (typeof value === 'string' && /^(Ability|MaxLevel)/.test(key)) result[key] = select(value);
  for (const [key, value] of Object.entries(kv?.AbilityValues || {})) result[key] = select(typeof value === 'object' ? value.value : value);
  for (const group of Object.values(kv?.AbilitySpecial || {})) if (group && typeof group === 'object') for (const [key, value] of Object.entries(group)) if (key !== 'var_type') result[key] = select(value);
  return result;
}
function decodeDescription(raw, values) {
  return (raw || '').replace(/%([a-zA-Z0-9_]+)%/g, (match, key) => values[key] ?? values[key.toLowerCase()] ?? match).replace(/<[^>]+>/g, '').replace(/\\n/g, '\n').replace(/%%/g, '%');
}
function callbackNames(kv) {
  const names = new Set();
  function visit(value) { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (key === 'Function' && typeof child === 'string') names.add(child); else visit(child); } }
  visit(kv); return [...names];
}
function functionRecords(sourceText, sourcePath) {
  const matches = [...sourceText.matchAll(/^function\s+([^\s(]+)\s*\(/gm)];
  return matches.map((match, index) => ({ name: match[1], sourceCommit: SOURCE_COMMIT, sourcePath, lineStart: sourceText.slice(0, match.index).split('\n').length, bodyRaw: sourceText.slice(match.index, matches[index + 1]?.index ?? sourceText.length) }));
}
function sourceRecord(id, kv, tokens, sourcePath, prefix = 'DOTA_Tooltip_Ability_') {
  const descriptionRaw = localized(tokens, `${prefix}${id}_Description`);
  const parameterValuesByLevel = [1, 2, 3].map(level => parameters(kv, level));
  return { id, name: localized(tokens, `${prefix}${id}`) || localized(tokens, id) || id, descriptionRaw, descriptionByLevel: parameterValuesByLevel.map(values => decodeDescription(descriptionRaw, values)), parameterValuesByLevel, callbackFunctions: callbackNames(kv), loreRaw: localized(tokens, `${prefix}${id}_Lore`), localizedFields: Object.fromEntries(Object.entries(tokens).filter(([key]) => key.startsWith(`${prefix}${id}_`.toLowerCase()))), valuesRaw: kv, sourceCommit: SOURCE_COMMIT, sourcePath };
}
function referencedScriptPaths(objects) {
  const result = new Set();
  function visit(value) {
    if (typeof value !== 'object' || !value) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'ScriptFile' && typeof child === 'string') {
        let p = child.replaceAll('\\', '/');
        if (!p.startsWith('scripts/vscripts/')) p = `scripts/vscripts/${p}`;
        if (!p.endsWith('.lua')) p += '.lua';
        if (!p.includes('..')) result.add(p);
      } else visit(child);
    }
  }
  objects.forEach(visit); return result;
}
function sectionsAround(lua, patterns, context = 5) {
  const lines = lua.split(/\r?\n/), selected = new Set();
  for (let i = 0; i < lines.length; i++) if (patterns.some(p => p.test(lines[i]))) {
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) selected.add(j);
  }
  const groups = []; let previous = -2, active;
  for (const line of [...selected].sort((a, b) => a - b)) {
    if (line !== previous + 1) { active = { lineStart: line + 1, sourcePath: 'scripts/vscripts/addon_game_mode.lua', sourceCommit: SOURCE_COMMIT, text: '' }; groups.push(active); }
    active.text += lines[line] + '\n'; previous = line;
  }
  return groups;
}

async function main() {
  await safeAncestors(INPUT); await safeAncestors(OUTPUT);
  const markerPath = path.join(INPUT, 'source-manifest.json');
  try {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    if (marker.sourceCommit !== SOURCE_COMMIT) throw new Error(`Different existing source version: ${markerPath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const existing = await fs.readdir(INPUT).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    if (existing.length) throw new Error(`Unregistered existing input must be preserved: ${INPUT}`);
    await fs.mkdir(INPUT, { recursive: true });
    await fs.writeFile(markerPath, JSON.stringify({ sourceCommit: SOURCE_COMMIT, repository: REPOSITORY, status: 'acquiring', sources: [] }, null, 2));
  }
  await Promise.all(initialPaths.map(acquire));
  const lua = texts.get('scripts/vscripts/addon_game_mode.lua');
  const npc = parseKv(texts.get('scripts/npc/npc_units_custom.txt')).DOTAUnits;
  const abilities = parseKv(texts.get('scripts/npc/npc_abilities_custom.txt')).DOTAAbilities;
  const items = parseKv(texts.get('scripts/npc/npc_items_custom.txt')).DOTAAbilities;
  const zh = normalizedTokens(parseKv(texts.get('resource/addon_schinese.txt')).lang.Tokens);
  const en = normalizedTokens(parseKv(texts.get('resource/addon_english.txt')).lang.Tokens);
  if (!npc || !abilities || !items || !zh) throw new Error('Missing expected KV roots');
  const scriptPaths = referencedScriptPaths([abilities, items]);
  for (const reference of luaReferences(lua)) {
    const p = reference.startsWith('scripts/vscripts/') ? reference : `scripts/vscripts/${reference}`;
    scriptPaths.add(p.endsWith('.lua') ? p : `${p}.lua`);
  }
  scriptPaths.delete('scripts/vscripts/addon_game_mode.lua');
  const missingScripts = [];
  // A small fixed batch cap limits total input. All references remain in the output.
  const pending = [...scriptPaths], discovered = new Set(pending);
  for (let i = 0; i < pending.length; i += 8) await Promise.all(pending.slice(i, i + 8).map(async p => {
    try {
      const text = await acquire(p);
      for (const reference of luaReferences(text)) {
        const source = reference.startsWith('scripts/vscripts/') ? reference : `scripts/vscripts/${reference}`;
        const next = source.endsWith('.lua') ? source : `${source}.lua`;
        if (!discovered.has(next) && next !== 'scripts/vscripts/addon_game_mode.lua') { discovered.add(next); pending.push(next); }
      }
    } catch (error) { if (/HTTP 404/.test(error.message)) missingScripts.push({ sourcePath: p, reason: error.message }); else throw error; }
  }));
  const poolNames = ['chess_list_by_mana', 'chess_list_by_mana_black', 'chess_list_by_mana_special'];
  const pools = Object.fromEntries(poolNames.map(name => [name, tiers(luaTable(lua, name))]));
  const eligible = new Map();
  for (const [pool, groups] of Object.entries(pools)) for (const [cost, ids] of Object.entries(groups)) for (const id of ids) {
    const record = eligible.get(id) || { id, cost: Number(cost), pools: [] }; record.pools.push(pool); eligible.set(id, record);
  }
  for (const id of quoted(luaTable(lua, 'chess_list_ssr'))) if (!eligible.has(id)) eligible.set(id, { id, cost: Number(npc[id]?.Level), sourceUnitLevelRaw: npc[id]?.Level || null, pools: ['chess_list_ssr'], acquisitionNote: 'Special rare shop draw: courier level >=7 and both RandomInt(1,10000) draws <=1, outside special-draw modes. Base displayed price=NPC Level (9), as InitGameMode sets chess_2_mana from Level and RandomNDrawChessNew uses force_price or chess_2_mana; discounts/runtime rules remain separate.', priceSourceFunctions: ['DAC:InitGameMode', 'RandomDrawChessNew', 'RandomNDrawChessNew'] });
  const skillMap = Object.fromEntries([...luaTable(lua, 'chess_ability_list_base').matchAll(/([a-zA-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g)].map(m => [m[1], m[2]]));
  const abilityRows = Object.entries(abilities).filter(([, kv]) => kv && typeof kv === 'object').map(([id, kv]) => sourceRecord(id, kv, zh, 'scripts/npc/npc_abilities_custom.txt'));
  const abilityById = new Map(abilityRows.map(row => [row.id, row]));
  const executionFunctions = [...texts.entries()].filter(([p]) => p.endsWith('.lua')).flatMap(([p, text]) => functionRecords(text, p));
  const missingUnits = [], missingAbilityOverrides = [];
  const pieces = [...eligible.values()].map(record => {
    const starIds = record.pools.includes('chess_list_ssr') ? [record.id] : [record.id, `${record.id}1`, `${record.id}11`];
    const stars = starIds.map((id, index) => {
      const raw = npc[id]; if (!raw) missingUnits.push(id);
      const abilityId = skillMap[record.id];
      const identityIds = Object.entries(raw || {}).filter(([key, value]) => /^Ability\d+$/.test(key) && typeof value === 'string' && value.startsWith('is_')).map(([, value]) => value);
      const skill = abilityById.get(abilityId);
      if (abilityId && !skill) missingAbilityOverrides.push({ piece: id, abilityId, reason: 'Not overridden in custom KV; resolve against the Dota 2 base-game definition.' });
      const skillDescriptionRaw = skill?.descriptionRaw || localized(zh, `DOTA_Tooltip_Ability_${abilityId}_Description`) || localized(en, `DOTA_Tooltip_Ability_${abilityId}_Description`);
      const skillLevel = index + 1;
      const selectedParameters = parameters(skill?.valuesRaw, skillLevel);
      const allUnitAbilityIds = Object.entries(raw || {}).filter(([key, value]) => /^Ability\d+$/.test(key) && typeof value === 'string' && value).map(([, value]) => value);
      const secondarySkills = allUnitAbilityIds.filter(value => value !== abilityId && !value.startsWith('is_') && !['no_collision', 'dac_guai_base'].includes(value)).map(value => {
        const extra = abilityById.get(value);
        return { id: value, name: extra?.name || value, descriptionRaw: extra?.descriptionRaw || '', parameterValuesRaw: extra?.parameterValuesByLevel || null, valuesRaw: extra?.valuesRaw || null, callbackFunctions: extra?.callbackFunctions || [], sourceCommit: SOURCE_COMMIT, sourcePath: 'scripts/npc/npc_abilities_custom.txt', note: 'Intrinsic NPC ability; levels and dynamic changes follow creation/runtime Lua, not the primary-skill star selector.' };
      });
      return { stars: record.pools.includes('chess_list_ssr') ? 3 : index + 1, skillLevel, skillLevelSource: 'GetChessAbility (normal suffix 1/11 selects levels 2/3; SSR has no suffix and defaults to level 1)', unitId: id, unitValuesRaw: raw || null, allUnitAbilityIds, identityIds, secondarySkills, skillId: abilityId || null, skillName: skill?.name || abilityId, skillDescriptionRaw, skillDescription: decodeDescription(skillDescriptionRaw, selectedParameters), skillParameters: selectedParameters, callbackFunctions: skill?.callbackFunctions || [], skillValuesRaw: skill?.valuesRaw || null, sourceCommit: SOURCE_COMMIT, sourcePath: 'scripts/npc/npc_units_custom.txt' };
    });
    return { ...record, name: localized(zh, record.id) || localized(en, record.id) || record.id, stars, ...(record.pools.includes('chess_list_ssr') ? { starDefinitionNote: 'GetChessStar returns 3 for SSR. Each SSR has one NPC definition, no <id>1 / <id>11. GetChessAbility defaults their skill to level 1; creation/ability callbacks are preserved in executionFunctions.' } : {}), sourceCommit: SOURCE_COMMIT, sourcePath: 'scripts/vscripts/addon_game_mode.lua' };
  }).sort((a, b) => (a.cost ?? 9) - (b.cost ?? 9) || a.id.localeCompare(b.id));
  const identities = [...luaTable(lua, 'class_type').matchAll(/\[(\d+)\]\s*=\s*['"]([^'"]+)['"]/g)].map(m => ({ index: Number(m[1]), id: m[2], kind: Number(m[1]) < 200 ? 'species' : 'class' }));
  const combos = [...luaTable(lua, 'combo_ability_type').matchAll(/([a-zA-Z0-9_]+)\s*=\s*\{([^}]*)\}/g)].map(m => {
    const abilityId = /ability\s*=\s*['"]([^'"]+)['"]/.exec(m[2])?.[1];
    const condition = /condition\s*=\s*(\d+)/.exec(m[2])?.[1], targetType = /type\s*=\s*(\d+)/.exec(m[2])?.[1];
    return { id: m[1], condition: Number(condition), targetType: Number(targetType), abilityId: abilityId || null, definitionRaw: m[2].trim(), effect: abilityById.get(abilityId) || null, sourceCommit: SOURCE_COMMIT, sourcePath: 'scripts/vscripts/addon_game_mode.lua' };
  });
  const synergies = identities.map(identity => ({ ...identity, name: localized(zh, `DOTA_Tooltip_Ability_${identity.id}`) || identity.id, descriptionRaw: localized(zh, `DOTA_Tooltip_Ability_${identity.id}_Description`), thresholds: combos.filter(combo => combo.id.replace(/11$|1$/, '') === identity.id), identityAbility: abilityById.get(identity.id) || null, sourceCommit: SOURCE_COMMIT, sourcePath: 'scripts/vscripts/addon_game_mode.lua' }));
  const itemRows = Object.entries(items).filter(([, kv]) => kv && typeof kv === 'object').map(([id, kv]) => sourceRecord(id, kv, zh, 'scripts/npc/npc_items_custom.txt'));
  const itemsById = new Map(itemRows.map(row => [row.id, row]));
  const itemTiers = tiers(luaTable(lua, 'ITEM_LIST_BY_LEVEL'));
  const equipment = Object.entries(itemTiers).flatMap(([tier, ids]) => ids.map(id => ({ tier: Number(tier), ...itemsById.get(id), id })));
  const relics = quoted(luaTable(lua, 'DROP_RELIC_LIST')).map(id => ({ id, ...itemsById.get(id) }));
  const promotionDefault = Number(/^\s*_G\.PER_2B\s*=\s*(\d+)/m.exec(lua)?.[1]);
  const talents = [...luaTable(lua, 'TALENT_TREE').matchAll(/\[['"]([^'"]+)['"]\]\s*=\s*['"]([^'"]+)['"]/g)].map(m => {
    const descriptionRaw = localized(zh, `talent_${m[1]}_description`);
    return { choice: m[1], milestoneRound: Number(m[1][0]) * 10 - 5, ...abilityById.get(m[2]), id: m[2], name: localized(zh, `talent_${m[1]}_title`), descriptionRaw, description: decodeDescription(descriptionRaw, m[1] === '2b' ? { per: String(promotionDefault) } : {}), ...(m[1] === '2b' ? { defaultParameters: { per: promotionDefault }, runtimeOverride: 't.chess_pool.per_2b or 50', effectiveRule: 'RandomInt(1,100)<=PER_2B grants draw_level+1, capped at draw level 11.' } : {}), localizationSourcePath: 'resource/addon_schinese.txt' };
  });
  const economyPatterns = [/income|interest|\bexp\b|exp_book|chess_gailv|CHESS_INIT_COUNT|CHESS_POOL_SIZE|black_market|chess_discount|mana_per_turn|lixi|利息|经验|工资|经济|每回合收入|人口|TALENT_TREE|PER_2B|HeroExpTable/i];
  const economy = { sourceSummary: ['每回合基础收入=floor(round/2+0.5)，最高4；利息=floor(当前金币/10)，通常最高4，特定圣物能提高。', '买经验默认花费4金币、增加4经验；通常信使等级上限10，繁盛天赋将上限扩至16。', '扬升默认50%概率以当前信使等级+1抽取，最高按11级抽取；服务器 chess_pool.per_2b 可覆盖50。'], tables: Object.fromEntries(['CHESS_INIT_COUNT', 'CHESS_AFRICA_VALUE', 'chess_gailv', 'chess_discount_list', 'TALENT_TREE', 'HeroExpTable'].map(name => [name, luaTable(lua, name)])), implementationExcerpts: sectionsAround(lua, economyPatterns), sourceCommit: SOURCE_COMMIT, sourcePath: 'scripts/vscripts/addon_game_mode.lua' };
  const dynamic = sectionsAround(lua, [/t\.chess_pool|t\.black_market|RandomLegendary|RandomRelic|RandomRMClass|chess_rm_class|CHESS_POOL_SIZE\s*=/], 12);
  const counts = { pieces: pieces.length, normalPool: Object.values(pools.chess_list_by_mana).flat().length, blackPool: Object.values(pools.chess_list_by_mana_black).flat().length, specialPool: Object.values(pools.chess_list_by_mana_special).flat().length, ssr: quoted(luaTable(lua, 'chess_list_ssr')).length, species: synergies.filter(s => s.kind === 'species').length, classes: synergies.filter(s => s.kind === 'class').length, synergyThresholds: combos.length, equipment: equipment.length, activeRelics: relics.length, talents: talents.length, customAbilityDefinitions: abilityRows.length, allCustomItemDefinitions: itemRows.length, associatedLua: sourceEntries.filter(s => s.sourcePath.endsWith('.lua')).length };
  const info = JSON.parse(texts.get('info.json'));
  const gaps = [
    'This is a traceable automated community mirror of author game files, not a Drodo-maintained repository. Exact VPK binary fidelity has not been independently verified.',
    'Some custom abilities inherit Dota 2 base definitions. Custom overrides alone do not prove inherited fields; base-game build must be resolved for full executable semantics.',
    'Server responses may override pool sizes, pool copies and black-market prices; these runtime values cannot be certified from the client package alone.',
    'Active pools vary per match: five-cost normal pool is randomized to ten, relic pool to ten, and Ringmaster class identities vary. Disabled definitions are preserved separately, not counted as active recruits.',
    'Descriptions retain original placeholders and all numeric KV strings. Star arrays are not flattened incorrectly; Lua can modify effective behavior and must be read with KV.',
  ];
  const coverageGaps = { pieceDescriptions: pieces.filter(p => !p.stars[0].skillDescriptionRaw).map(p => ({ id: p.id, skillId: p.stars[0].skillId })), synergyDescriptions: synergies.filter(s => !s.descriptionRaw).map(s => s.id), relicDescriptions: relics.filter(r => !r.descriptionRaw).map(r => r.id), talentDescriptions: talents.filter(t => !t.descriptionRaw).map(t => t.id), unresolvedTalentPlaceholders: talents.filter(t => /%[a-zA-Z0-9_]+%/.test(t.description)).map(t => ({ id: t.id, placeholders: t.description.match(/%[a-zA-Z0-9_]+%/g) })), unresolvedPiecePlaceholders: pieces.flatMap(p => p.stars.filter(s => /%[a-zA-Z0-9_]+%/.test(s.skillDescription)).map(s => ({ piece: p.id, stars: s.stars, placeholders: s.skillDescription.match(/%[a-zA-Z0-9_]+%/g) }))) };
  coverageGaps.secondaryDescriptions = [...new Set(pieces.flatMap(p => p.stars.flatMap(s => s.secondarySkills.filter(extra => !extra.descriptionRaw).map(extra => extra.id))))].map(id => ({ id, reason: 'Custom Chinese resource has no separate descriptive label. Exact KV effects/values and referenced Lua functions are retained; no descriptive text was invented.' }));
  const auxiliaryUnits = Object.fromEntries(Object.entries(npc).filter(([id]) => !pieces.some(p => p.stars.some(s => s.unitId === id))));
  const output = { schema: 'stronghold.resonance-reference.dota/v1', title: 'Drodo 原版 Dota 自走棋完整参考输入', retrievedAt: new Date().toISOString(), sourceCommit: SOURCE_COMMIT, workshopId: '1613886175', sourceInfo: info, repository: `https://github.com/${REPOSITORY}`, counts, pools, goldenMechanicalPool: quoted(luaTable(lua, 'chess_list_by_mana_gold')), pieces, synergies, equipment, relics, talents, allCustomAbilities: abilityRows, allCustomItems: itemRows, auxiliaryUnits, executionFunctions, economy, dynamicRuntimeOverrides: dynamic, coverageGaps, missingUnits, missingAbilityOverrides, missingScripts, gaps, sources: sourceEntries };
  if (missingUnits.length) throw new Error(`Missing star unit definitions: ${missingUnits.join(', ')}`);
  if (counts.pieces !== 122 || counts.species !== 23 || counts.classes !== 13 || counts.equipment !== 77 || counts.activeRelics !== 17 || counts.talents !== 8) throw new Error(`Enumeration contract mismatch: ${JSON.stringify(counts)}`);
  const json = JSON.stringify(output, null, 2) + '\n';
  const md = [`# Drodo 原版 Dota 自走棋：全量参考索引`, ``, `Workshop：[1613886175](https://steamcommunity.com/sharedfiles/filedetails/?id=1613886175)。来源是自动获取 Workshop VPK 的社区镜像，固定 Git commit \`${SOURCE_COMMIT}\`。原包更新时间 ${new Date(Number(info.time_updated) * 1000).toISOString()}，解析时间 ${info.parsed_at}。`, ``, `正式原始输入：\`${INPUT}\`。完整机器表：\`dota-current.json\`。全部效果、原始数字、每颗棋子三种星级定义及关联 Lua 均保留；原文占位符未伪造填值。`, ``, `## 完整性`, ``, ...Object.entries(counts).map(([key, value]) => `- ${key}：${value}`), ``, ...gaps.map(gap => `- ${gap}`), ``, `## 全棋子与三档技能`, ``];
  for (const piece of pieces) {
    md.push(`### ${piece.name} · ${piece.cost === null ? '特殊获取' : `${piece.cost}费`} · ${piece.id}`, ``, `获取：${piece.pools.join('、')}。来源：\`${piece.sourcePath}\`，commit \`${SOURCE_COMMIT}\`。`, ``);
    if (piece.starDefinitionNote) md.push(piece.starDefinitionNote, '');
    for (const star of piece.stars) md.push(`**${star.stars}星**：${star.unitId}；种族职业 ${star.identityIds.join('、')}；技能 ${star.skillName || star.skillId || '未指定'}（技能等级 ${star.skillLevel}）。`, ``, star.skillDescription || '中文技能描述未提供；详见机器表与原始 KV。', ``, `实际回调：${star.callbackFunctions.join('、') || 'KV 内建效果'}。`, ``, ...star.secondarySkills.map(s => `额外固有能力「${s.name}」：${s.descriptionRaw || '源未提供中文说明，完整KV及回调保留如下；不能假造文本。'}`), '', '```json', JSON.stringify({ selectedParameters: star.skillParameters, secondarySkills: star.secondarySkills, unit: star.unitValuesRaw, skill: star.skillValuesRaw }, null, 2), '```', '');
  }
  for (const [heading, rows] of [['全羁绊', synergies], ['全装备', equipment], ['当前圣物', relics], ['信使天赋', talents]]) {
    md.push(`## ${heading}`, '');
    for (const row of rows) md.push(`### ${row.name || row.id}`, '', row.description || row.descriptionRaw || '', '', '```json', JSON.stringify(row, null, 2), '```', '');
  }
  md.push('## 全局经济、人口、概率与动态覆写', '', '完整原值及代码段见 JSON 的 economy 与 dynamicRuntimeOverrides。它们保留源码行号与路径；运行时服务器返回未知明确列入缺口。', '', '```json', JSON.stringify(economy.tables, null, 2), '```', '', '## 原始输入清单', '', ...sourceEntries.map(s => `- [${s.sourcePath}](${s.url})（${s.bytes} bytes）：\`${s.absolutePath}\``), '', '## 待核对项', '', '```json', JSON.stringify(coverageGaps, null, 2), '```', ...missingScripts.map(s => `- ${s.sourcePath}：${s.reason}`), ...missingAbilityOverrides.map(s => `- ${s.piece} / ${s.abilityId}：${s.reason}`), '');
  const markdown = md.map(line => line.replace(/[ \t]+$/, '')).join('\n');
  const finalBytes = bytes + Buffer.byteLength(json) + Buffer.byteLength(markdown);
  if (finalBytes > LIMIT) throw new Error(`Total input/output ${finalBytes} exceeds ${LIMIT}`);
  await fs.mkdir(OUTPUT, { recursive: true });
  const jsonPath = path.join(OUTPUT, 'dota-current.json'), mdPath = path.join(OUTPUT, 'dota-current.md');
  await fs.writeFile(jsonPath, json); await fs.writeFile(mdPath, markdown);
  await fs.writeFile(markerPath, JSON.stringify({ sourceCommit: SOURCE_COMMIT, repository: REPOSITORY, status: 'complete', sourceInfo: info, sources: sourceEntries }, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, sourceCommit: SOURCE_COMMIT, counts, bytes: finalBytes, inputManifest: markerPath, outputJson: jsonPath, outputMarkdown: mdPath, missingScripts, missingAbilityOverrides, artifacts: sourceEntries.map(s => ({ path: s.absolutePath, role: 'exact source input' })) }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message, input: INPUT, output: OUTPUT, sourceCommit: SOURCE_COMMIT })); process.exitCode = 1; });
