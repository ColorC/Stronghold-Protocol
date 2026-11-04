import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptationCard } from './adaptation-authoring.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = { runtime: path.join(ROOT, 'data/assault-runtime.json'), output: path.join(ROOT, 'data/assault-public-text.json'),
  skillTable: 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/skill_table.json' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--runtime': 'runtime', '--output': 'output', '--skill-table': 'skillTable' }[process.argv[i]];
  const value = process.argv[i + 1];
  if (!key || !value || !path.isAbsolute(value)) throw new Error(`Expected an absolute path for ${process.argv[i]}`);
  options[key] = value;
}
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const designs = [
  read('data/assault-design/roster-support.json'),
  read('data/assault-design/roster-assault.json'),
  read('data/assault-design/roster-ranged.json'),
];
const forms = read('data/assault-design/forms.json').forms;
const roster = [...designs.flatMap((item) => item.operators), ...forms];
const collectibles = read('data/assault-design/collectibles.json').items;
const events = read('data/assault-design/events.json').events;
const encounters = read('data/assault-design/encounters.json').encounters;
const directors = read('data/assault-design/system.json').directors;
const runtime = JSON.parse(fs.readFileSync(options.runtime, 'utf8'));
const skillTable = JSON.parse(fs.readFileSync(options.skillTable, 'utf8'));

// Native proper names that happen to contain a word of the internal-wording check (阿罗玛's talent 「起泡性能测试」):
// they are taken out of a text before it is checked. test/assault/public-text.test.mjs keeps the same list.
export const NATIVE_PROPER_NAMES = Object.freeze(['起泡性能测试']);
const withoutProperNames = (text) => NATIVE_PROPER_NAMES.reduce((out, name) => out.replaceAll(name, ''), String(text));
const forbiddenWords = /token_|char_|enemy_|ownerUid|JSONpointer|真实素材|按标准|脱敏|证据|源场景|制作|实现|白板|测试|待固定|待无头|待修订|RNG|fixedSkill|effectHandling|sourceTemplate|derivedTemplate|nationId|lpr|attrPower|stats\.|internal|native|routeIndex|spawn|damageInstance|translation|epResistance|maxHP|status\/debuff|enemyID|assault_|absorbed|scaleBasis|perDevice|blockCnt|attackKind|track\/rarity|技能\.|沿用|延续|对应数值|后续调整|服务端|服务器|LIVE BATTLE/i;
const forbidden = { test: (text) => forbiddenWords.test(withoutProperNames(text)) };
const ids = {
  operators: roster.map((item) => item.charId),
  collectibles: collectibles.map((item) => item.id),
  events: events.map((item) => item.id),
  choices: events.flatMap((event) => event.choices.map((choice) => `${event.id}/${choice.id}`)),
  encounters: encounters.map((item) => item.id),
  directors: directors.map((item) => item.id),
};

function strings(value, at = '$') {
  if (typeof value === 'string') return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${at}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => strings(item, `${at}.${key}`));
  return [];
}

function verify(source) {
  if (source?.schema !== 'assault-public-text-source/v1') throw new Error('文字真源 schema 不正确');
  for (const key of ['operators', 'collectibles', 'events', 'encounters', 'directors']) {
    const actual = Object.keys(source[key] ?? {});
    const missing = ids[key].filter((id) => !actual.includes(id));
    const extra = actual.filter((id) => !ids[key].includes(id));
    if (missing.length || extra.length) throw new Error(`${key} 覆盖不完整：missing=${missing.length} extra=${extra.length}`);
  }
  for (const [at, value] of strings(source)) {
    if (at.endsWith('.schema')) continue;
    if (!value.trim()) throw new Error(`空文字：${at}`);
    if (forbidden.test(value)) throw new Error(`包含内部或过程文字：${at} = ${value}`);
  }
  for (const id of ids.operators) {
    const item = source.operators[id];
    const body = runtime.bodies[id];
    if (!item.name || !item.role || !item.skill?.name || !item.skill?.description) throw new Error(`干员文字不完整：${id}`);
    if(body.fixedSkill.kind!=='passive'&&item.skill.name!==body.fixedSkill.name)
      throw new Error(`进击技能名与当前技能表不一致：${id}`);
    if(/\{[a-zA-Z_]+(?::[^}]*)?\}/.test(item.skill.description+' '+(item.skill.summary??'')))
      throw new Error(`进击技能说明残留未代入原作参数：${id}`);
    if(/^下(?:一)?次攻击/.test(item.skill.summary??''))
      throw new Error(`进击首屏仍指向以后普通攻击：${id}`);
    if (!Array.isArray(item.talents) || !item.modules || typeof item.modules !== 'object') throw new Error(`干员细项不完整：${id}`);
    if (!Array.isArray(item.modePassives) || item.modePassives.length !== body.modePassives.length) throw new Error(`进击被动覆盖不完整：${id}`);
    if (item.talents.length !== (body.adaptation ? 0 : (body.source?.talents || []).length)) throw new Error(`天赋槽位覆盖不完整：${id}`);
    const expectedModules = (body.modulePlans || []).map((module) => module.id).sort();
    const actualModules = Object.keys(item.modules).sort();
    if (expectedModules.length !== actualModules.length || expectedModules.some((moduleId, index) => moduleId !== actualModules[index])) {
      throw new Error(`模组覆盖不完整：${id}`);
    }
  }
  for (const [id, event] of Object.entries(source.events)) {
    if (!event.name || !event.story || !event.choices || !Object.keys(event.choices).length) throw new Error(`事件文字不完整：${id}`);
  }
  const counts = {
    operators: ids.operators.length,
    talents: Object.values(source.operators).reduce((sum, item) => sum + item.talents.length, 0),
    modules: Object.values(source.operators).reduce((sum, item) => sum + Object.keys(item.modules).length, 0),
    modePassives: Object.values(source.operators).reduce((sum, item) => sum + item.modePassives.length, 0),
    collectibles: ids.collectibles.length,
    events: ids.events.length,
    choices: Object.values(source.events).reduce((sum, item) => sum + Object.keys(item.choices).length, 0),
    encounters: ids.encounters.length,
    directors: ids.directors.length,
  };
  const expectedTalents = ids.operators.reduce((sum, id) => sum + (runtime.bodies[id].adaptation ? 0 : (runtime.bodies[id].source?.talents || []).length), 0);
  const expectedModules = ids.operators.reduce((sum, id) => sum + (runtime.bodies[id].modulePlans || []).length, 0);
  if (counts.talents !== expectedTalents || counts.modules !== expectedModules || counts.choices !== ids.choices.length) {
    throw new Error(`细项覆盖不完整：${JSON.stringify({ ...counts, expectedTalents, expectedModules })}`);
  }
  return counts;
}

const source = read('data/assault-design/public-text.json');
for(const [id,body]of Object.entries(runtime.bodies))if(body.adaptation) {
  source.operators[id].skill={...source.operators[id].skill,name:body.fixedSkill.name,
    description:body.fixedSkill.description,summary:body.fixedSkill.description};
  source.operators[id].modePassives=[];
  source.operators[id].modules=Object.fromEntries(body.modulePlans.map(m=>[m.id,{name:m.name,description:m.description}]));
  // Adapted skill/talent behavior is on the short face. The original tab below
  // still carries every native description; obsolete mode translations do not.
  source.operators[id].talents=[];
  source.operators[id].innates=body.adaptation.innates;
}
const summary = verify(source);
const generated = { ...source, schema: 'assault-public-text/v1' };
const unresolved = [];
function originalDescription(level, label) {
  const values = Object.fromEntries((level.blackboard || []).map(entry => [entry.key.toLowerCase(), entry.valueStr ?? entry.value]));
  values.duration ??= level.duration;
  return String(level.description || '').replace(/\{([^{}:]+)(?::([^{}]+))?\}/g, (raw, key, format = '') => {
    const normalized = key.toLowerCase();
    const value = values[normalized] ?? (normalized.startsWith('-') && typeof values[normalized.slice(1)] === 'number' ? -values[normalized.slice(1)] : null);
    if (value == null) { unresolved.push({ label, key }); return raw; }
    if (typeof value !== 'number') return String(value);
    const percent = format.endsWith('%');
    const precision = format.match(/\.(0+)/)?.[1].length || 0;
    const number = percent ? value * 100 : value;
    return `${format ? number.toFixed(precision) : Number(number.toFixed(6))}${percent ? '%' : ''}`;
  });
}
generated.operators = Object.fromEntries(Object.entries(source.operators).map(([id, copy]) => {
  const body = runtime.bodies[id];
  const original = { trait: originalDescription(body.source?.trait || {}, `${id}/trait`),
    skills: (body.source?.skills || []).map(skill => {
      const level = skillTable[skill.skillId]?.levels?.at(-1);
      if (!level) throw new Error(`原作技能来源缺失：${skill.skillId}`);
      return { name: level.name, description: originalDescription(level, `${id}/${skill.skillId}`) };
    }),
    talents: (body.source?.talents || []).filter(talent => !talent.hidden && talent.name && !/空槽位/.test(talent.name))
      .map(talent => ({ name: talent.name, description: originalDescription(talent, `${id}/talent`) })),
  };
  return [id, { ...copy, original }];
}));
if (unresolved.length) throw new Error(`原作技能数值未闭合：${JSON.stringify(unresolved)}`);

// Bazaar-style card face: one source for text and the numbers the card reads.
const renderLine = (template, params, star) => {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (raw, key) => {
    const value = params?.[key]?.[star];
    if (value == null) { missing = true; return raw; }
    return String(value);
  });
  return missing ? null : text;
};
const publicLine = (line, where) => {
  if(line.suppressed)return {kind:line.kind,template:'',params:line.params??{},textByStar:['','','','']};
  for (const [key, values] of Object.entries(line.params ?? {})) {
    if (!Array.isArray(values) || values.length !== 4) throw new Error(`卡面参数需四档：${where}.${key}`);
  }
  const textByStar = [0, 1, 2, 3].map((star) => renderLine(line.template, line.params, star));
  for (const text of textByStar) if (text != null && (forbidden.test(text) || /\{\w+\}/.test(text))) throw new Error(`卡面文字不合格：${where} = ${text}`);
  return { kind: line.kind, template: line.template, params: line.params ?? {}, textByStar };
};
const cards = new Map();
for (const family of ['assault', 'ranged', 'support']) {
  const file = read(`data/assault-design/bazaar-cards-${family}.json`);
  if (file.schema !== 'assault-bazaar-cards/v1') throw new Error(`卡面真源 schema 不正确：${family}`);
  for (const card of file.operators) cards.set(card.id, card);
}
for (const [id, copy] of Object.entries(generated.operators)) {
  const card = adaptationCard(runtime.bodies[id], cards.get(id));
  if (!card) throw new Error(`卡面缺失：${id}`);
  const body = runtime.bodies[id];
  if (body.fixedSkill.kind !== 'passive' && JSON.stringify(card.sp) !== JSON.stringify(body.fixedSkill.spCosts)) throw new Error(`卡面技力与技能不一致：${id}`);
  const lines = card.lines.map((line, index) => publicLine(line, `${id}/lines/${index}`));
  // a synergy card (design of 2026-10-21) shows every line of its design; the older bazaar cards keep 1–3
  if (!lines.length || lines.length > (card.format === 'synergy' ? 12 : 3)) throw new Error(`卡面行数超出：${id}`);
  const modules = Object.fromEntries(card.modules.map((m) => [m.id, { name: m.name, line: m.line ? publicLine(m.line, `${id}/modules/${m.id}`) : null }]));
  // 「炎-龙门」 shows as 「龙门」: the nation is already its own segment.
  const typeLabel = card.typeLabel.split(' · ').map((part) => part.replace(/^(?:炎|罗德岛)-/, '')).filter((part, index, parts) => parts.indexOf(part) === index).join(' · ');
  copy.card = { typeLabel, sp: card.sp ?? null, lines, modules, ...(card.tags ? { tags: card.tags } : {}) };
}
const bazaarCollectibles = new Map(read('data/assault-design/bazaar-collectibles.json').collectibles.map((item) => [item.id, item]));
for (const [id, copy] of Object.entries(generated.collectibles)) {
  const item = bazaarCollectibles.get(id);
  if (!item) throw new Error(`收藏品卡面缺失：${id}`);
  const text = renderLine(item.template, Object.fromEntries(Object.entries(item.params ?? {}).map(([k, v]) => [k, [v, v, v, v].flat().slice(0, 4)])), 0) ?? item.text;
  if (text !== item.text || forbidden.test(text)) throw new Error(`收藏品卡面文字不合格：${id}`);
  copy.line = text;
}
fs.writeFileSync(options.output, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ source: path.join(ROOT, 'data/assault-design/public-text.json'), runtime: options.runtime, output: options.output, summary }));
