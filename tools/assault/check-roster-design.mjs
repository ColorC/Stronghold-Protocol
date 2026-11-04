import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const partial = args[2] === '--partial';
if ((args.length !== 2 && !(args.length === 3 && partial)) || args[0] !== '--group' || !['support', 'assault', 'ranged'].includes(args[1])) {
  throw new Error('Usage: node tools/assault/check-roster-design.mjs --group support|assault|ranged [--partial]');
}
const group = args[1];
// Design validation reads independent formal inputs. A cleaned authoring context
// must neither disable validation nor force another copy of the official tables.
const sourceRoot = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel';
const sourceJson = name => JSON.parse(fs.readFileSync(path.join(sourceRoot, name), 'utf8'));
const characters = sourceJson('character_table.json');
const equipment = sourceJson('uniequip_table.json');
const selection = JSON.parse(fs.readFileSync(path.join(root, 'data/assault-roster-selection.json'), 'utf8'));
const professions = { support: ['PIONEER', 'TANK', 'MEDIC'], assault: ['WARRIOR', 'SPECIAL'], ranged: ['SNIPER', 'CASTER', 'SUPPORT'] };
const required = new Map();
for (const selected of selection.candidates.filter(candidate => candidate.selected)) {
  const raw = characters[selected.charId];
  if (!raw) throw new Error(`Official operator source missing: ${selected.charId}`);
  if (!professions[group].includes(raw.profession)) continue;
  required.set(selected.charId, { charId: selected.charId, name: raw.name, profession: raw.profession,
    skills: raw.skills ?? [], talents: (raw.talents ?? []).map((talent, index) => ({ index })),
    modules: (equipment.charEquip[selected.charId] ?? []).map(id => ({ id })) });
}
const target = path.join(root, `data/assault-design/roster-${group}.json`);
const design = JSON.parse(fs.readFileSync(target, 'utf8'));
const errors = [];
const seen = new Set();
const prices = [0, 2, 3, 4, 6, 8, 12];
const archetypes = new Set(['cold', 'redeploy', 'ammo', 'element', 'summon', 'healShield', 'blockCounter', 'pierceCrit', 'skillCycle', 'economyGrowth']);
const actions = new Set(['damage', 'heal', 'applyStatus', 'addBuff', 'spGain', 'haste', 'spCost', 'redeploy', 'summon', 'device', 'ammo', 'targeting', 'move', 'modifyTag', 'economy', 'growth', 'nativeMechanism']);
function checkEffect(effect, label) {
  if (!effect || typeof effect !== 'object') { errors.push(`${label}: missing effect`); return; }
  for (const key of ['trigger', 'target', 'action', 'description']) {
    if (typeof effect[key] !== 'string' || !effect[key].trim()) errors.push(`${label}: missing ${key}`);
  }
  if (effect.values == null || typeof effect.values !== 'object') errors.push(`${label}: exact values required`);
  if (!actions.has(effect.action)) errors.push(`${label}: unknown action ${effect.action}`);
  if (!['instant', 'battle', 'run'].includes(effect.lifecycle)) errors.push(`${label}: invalid lifecycle`);
  for (const key of ['stacking', 'limits']) if (typeof effect[key] !== 'string' || !effect[key].trim()) errors.push(`${label}: explicit ${key} required`);
  if (/周围[8八]格|八邻/.test(JSON.stringify(effect)) && [effect.values?.radius].flat().includes(8)) errors.push(`${label}: adjacent eight tiles is radius one, not radius eight`);
}
if (design.schema !== 'assault-roster-design/v1' || design.group !== group) errors.push('Wrong schema or group');
if (!Array.isArray(design.operators)) errors.push('operators must be an array');
for (const card of design.operators ?? []) {
  const raw = required.get(card.charId);
  if (!raw || seen.has(card.charId)) { errors.push(`Unknown/duplicate ${card.charId}`); continue; }
  seen.add(card.charId);
  if (card.name !== raw.name || card.profession !== raw.profession) errors.push(`${card.charId}: identity mismatch`);
  if (!Number.isInteger(card.priceTier) || card.price !== prices[card.priceTier]) errors.push(`${card.charId}: invalid price`);
  if (!archetypes.has(card.archetype)) errors.push(`${card.charId}: invalid archetype`);
  for (const k of ['role', 'priceReason', 'designReason']) if (typeof card[k] !== 'string' || card[k].length < 8) errors.push(`${card.charId}: incomplete ${k}`);
  const skill = card.fixedSkill;
  if (!skill || !['instant', 'passive'].includes(skill.kind)) errors.push(`${card.charId}: invalid fixed skill`);
  if (skill?.sourceSkillId != null && !raw.skills.some(s => s.skillId === skill.sourceSkillId)) errors.push(`${card.charId}: skill does not belong to source operator`);
  if (skill?.sourceSkillId == null && raw.skills.length && skill?.kind !== 'passive') errors.push(`${card.charId}: source skill required`);
  if (!skill?.name || !skill?.description || !Array.isArray(skill?.effects) || !skill.effects.length) errors.push(`${card.charId}: incomplete fixed skill`);
  if (skill?.kind === 'instant' && (!Array.isArray(skill.spCosts) || skill.spCosts.length !== 4 || skill.spCosts.some(n => !Number.isFinite(n) || n <= 0))) errors.push(`${card.charId}: four exact positive SP costs required`);
  if (skill?.kind === 'instant' && !([skill.initSp].flat().length === 1 || [skill.initSp].flat().length === 4)) errors.push(`${card.charId}: initial SP must be scalar or four values`);
  if (skill?.kind === 'instant' && [skill.initSp].flat().some(n => !Number.isFinite(n) || n < 0)) errors.push(`${card.charId}: exact nonnegative initial SP required`);
  for (const [i, e] of (skill?.effects ?? []).entries()) checkEffect(e, `${card.charId}: skill effect ${i}`);
  if (!Array.isArray(card.talentPlans) || card.talentPlans.length < raw.talents.length) errors.push(`${card.charId}: native talents not addressed`);
  for (const talent of card.talentPlans ?? []) {
    if (!['retain', 'rewrite'].includes(talent.mode) || !talent.name || !talent.description || !talent.sourcePointer) errors.push(`${card.charId}: incomplete talent`);
  }
  const talentIndices = new Set((card.talentPlans ?? []).map(t => Number(String(t.sourcePointer).match(/\/talents\/(\d+)(?:\/|$)/)?.[1])));
  for (const native of raw.talents) if (!talentIndices.has(native.index)) errors.push(`${card.charId}: talent source ${native.index} not covered`);
  if (!Array.isArray(card.modePassives) || !card.modePassives.length) errors.push(`${card.charId}: mode linkage required`);
  for (const [i, e] of (card.modePassives ?? []).entries()) checkEffect(e, `${card.charId}: passive ${i}`);
  if (!Array.isArray(card.stars) || card.stars.length !== 4 || card.stars.some((s, i) => s.star !== i + 1 || s.atkMultiplier !== [1, 1.55, 2.2, 3][i] || s.hpMultiplier !== [1, 1.65, 2.6, 4][i] || !s.skillChange || !s.passiveChange)) errors.push(`${card.charId}: four complete star states with agreed body scaling required`);
  if (!Array.isArray(card.modulePlans) || !card.sourceRef || !card.implementationPlan || !Array.isArray(card.causalChecks) || card.causalChecks.length < 2) errors.push(`${card.charId}: missing provenance/module/implementation/causal checks`);
  const nativeModules = new Set(raw.modules.map(m => m.id));
  const designedModules = new Set((card.modulePlans ?? []).map(m => m.id));
  for (const id of nativeModules) if (!designedModules.has(id)) errors.push(`${card.charId}: module ${id} not addressed`);
  for (const id of designedModules) if (!nativeModules.has(id)) errors.push(`${card.charId}: invented module ${id}`);
  if (card.sourceRef?.pointer !== `/${card.charId}` || !card.sourceRef?.file?.endsWith('/character_table.json')) errors.push(`${card.charId}: wrong native character source`);
  const text = JSON.stringify(card);
  if (/待设计|TBD|TODO|通用模板|尚未决定/.test(text)) errors.push(`${card.charId}: unresolved design placeholder`);
}
if (!partial) for (const id of required.keys()) if (!seen.has(id)) errors.push(`Missing selected operator ${id}`);
console.log(JSON.stringify({ group, file: target, partial, expected: required.size, actual: seen.size, ok: !errors.length, errors }));
process.exitCode = errors.length ? 1 : 0;
