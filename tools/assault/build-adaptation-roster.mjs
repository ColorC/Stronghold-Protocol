// Full-pool source worksheet for the 10-24 rewrite. A draft row is not a ready
// card and cannot pass check-adaptation-quotas. Keep source effects visible so
// choosing a signature never silently deletes one of its mechanics.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_ADAPTATIONS } from '../../shared/assault/core-adaptations.js';
import { AUTHORED_ADAPTATIONS, AUTHORED_CARD_ROLES } from './adaptation-authoring.mjs';
import { skillTempo } from '../../shared/assault/adaptation.js';
import { extendedGrid } from '../../shared/loadoutRecord.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const characters = read(path.join(sourceRoot, 'character_table.json'));
const patches = read(path.join(sourceRoot, 'char_patch_table.json')).patchChars;
const skills = read(path.join(sourceRoot, 'skill_table.json'));
const ranges = read(path.join(sourceRoot, 'range_table.json'));
const design = ['assault', 'ranged', 'support'].flatMap(family => read(path.join(root, `data/assault-design/roster-${family}.json`)).operators);
design.push(...read(path.join(root, 'data/assault-design/forms.json')).forms);
const sourceRevision = '17759cc8cdf37388414145d16262a3a06f3ab25e';
const rows = design.map(previous => {
  const id = previous.charId, native = characters[id] ?? patches?.[id], core = AUTHORED_ADAPTATIONS[id];
  if (!native?.skills?.length) return { id, name: previous.name, status: core ? 'authored-implementation-requires-release-gate' : 'draft-native-passive-review-required',
    proposed: { type: 'C', passive: true, sourceSkillId: null, sourceTraitId: `character_table.json#/${id}/talents/0`,
      tempo: null, nativeDeploy: true, ...(core ? {card:core,coverage:AUTHORED_CARD_ROLES[id]} : {}) },
    original: { skills: [], description: native.description, talents: native.talents,
      rangeId: native.phases.at(-1).rangeId, rangeGrid: ranges[native.phases.at(-1).rangeId].grids.map(cell => [cell.row, cell.col]) },
    previousSkillId: previous.fixedSkill.sourceSkillId ?? null };
  // Non-core choices are deliberately provisional. They are not imported into
  // the runtime until their signature and talent link have been reviewed.
  const index = core?.index ?? native.skills.length - 1;
  const slot = native.skills[index], level = skills[slot.skillId].levels.at(-1);
  const rangeId = level.rangeId ?? level.blackboard.find(entry => entry.key === 'range_id' && entry.valueStr)?.valueStr ?? native.phases.at(-1).rangeId;
  const extension = level.blackboard.find(entry => entry.key === 'ability_range_forward_extend')?.value ?? 0;
  const grid = extendedGrid(ranges[rangeId].grids.map(cell => [cell.row, cell.col]), extension);
  const nativeDeploy = level.spData.spCost === 0 && level.spData.spType === 8;
  const rawText = level.description.replace(/<[^>]*>/g, '').replaceAll('\\n', ' ');
  const type = core?.type ?? (level.durationType === 'AMMO' ? 'D'
    : slot.overrideTokenKey || /召唤|无人机|装置|影哨|流形/.test(rawText) ? 'E'
      : /持续时间无限/.test(rawText) || level.duration < 0 && level.skillType === 'PASSIVE' ? 'C'
        : level.duration > 0 ? 'B' : 'A');
  const tier = core?.tier ?? (type === 'A' && level.spData.spCost <= 15 ? 'fast'
    : type === 'B' && native.rarity === 'TIER_6' ? 'slow' : 'medium');
  const cost = core?.cost ?? ({ fast: 10, medium: 20, slow: 35 }[tier]);
  const passive = core?.passive ?? nativeDeploy;
  return { id, name: previous.name, status: core ? (CORE_ADAPTATIONS[id]?'implemented-core':'authored-implementation-requires-release-gate') : 'draft-signature-and-link-review-required',
    proposed: { sourceSkillId: slot.skillId, sourceIndex: index, sourceSkillName: level.name, type,
      passive, nativeDeploy: core?.nativeDeploy ?? nativeDeploy, tempo: passive ? null : skillTempo(tier, cost),
      ...(core ? { card: core, coverage: AUTHORED_CARD_ROLES[id] } : {}) },
    original: { description: rawText, rangeId, rangeGrid: grid,
      targetCount: level.blackboard.find(entry => /(?:^|@)max_target$/.test(entry.key))?.value ?? null,
      sp: level.spData, duration: level.duration, durationType: level.durationType, blackboard: level.blackboard,
      tokenId: slot.overrideTokenKey, trait: native.description,
      talents: (native.talents ?? []).flatMap((talent, talentIndex) => {
        const candidate = [...(talent.candidates ?? [])].reverse().find(c => c.requiredPotentialRank === 0 && c.name);
        return candidate ? [{ index: talentIndex, name: candidate.name, description: candidate.description, blackboard: candidate.blackboard }] : [];
      }) },
    previousSkillId: previous.fixedSkill.sourceSkillId ?? null,
    sourcePointers: { character: `character_table.json#/${id}`, skill: `skill_table.json#/${slot.skillId}/levels/${skills[slot.skillId].levels.length - 1}` },
  };
});
if (rows.length !== 172 || new Set(rows.map(row => row.id)).size !== 172) throw Error('Adaptation worksheet must cover exactly 172 unique bodies');
const output = path.join(root, 'data/assault-design/adaptation-roster.json');
fs.writeFileSync(output, JSON.stringify({ schema: 'assault-adaptation-roster/v1', sourceRevision, readyForRelease: false,
  note: 'draft行仅为原始机制与待复核签名候选；authored行仍须通过运行与正式发布门禁。整表不代表全池已经验收。', operators: rows }, null, 2) + '\n');
console.log(JSON.stringify({ output, bodies: rows.length, core:Object.keys(CORE_ADAPTATIONS).length, authored: rows.filter(row => row.proposed?.card).length,
  draft: rows.filter(row => row.status.startsWith('draft')).length, changedSignatureCandidates: rows.filter(row => row.proposed?.sourceSkillId !== row.previousSkillId).length }));
