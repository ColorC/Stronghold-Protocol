// Compile the assault DTO from the checked-in design and canonical official inputs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeToken } from '../../server/sim/simdata.js';
import { nativeTrait } from './native-traits.mjs';
import { assertFixedSkillContract } from './instant-source.mjs';
import { refreshRangedCoverage } from './refresh-ranged-coverage.mjs';
import { SKILL_RESOLUTIONS } from '../../shared/assault/skill-resolutions.js';
import { chapterEnemyRecords } from './chapter-enemy-sets.mjs';
import { GROWTH_IDENTITIES } from '../../shared/assault/growth-policy.js';
import { adaptationPlan, compiledAdaptation, adaptationCard, adaptationModules } from './adaptation-authoring.mjs';
import { extendedGrid } from '../../shared/loadoutRecord.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOT = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources';
const ARKNIGHTS_ROOT = path.join(SOURCE_ROOT, 'arknights');
const EXPECTED_SOURCE_REVISION = '17759cc8cdf37388414145d16262a3a06f3ab25e';
const ATTACK_MULTIPLIERS = [1, 1.55, 2.2, 3];
const HEALTH_MULTIPLIERS = [1, 1.65, 2.6, 4];
const ASSAULT_GROUPS = ['assault', 'ranged', 'support'];
const RUNTIME_SOURCE_TABLES = new Set(['characterTable', 'skillTable', 'rangeTable', 'uniequipTable',
  'battleEquipTable', 'charPatchTable', 'enemyDatabase']);
const DERIVED_SUMMONS = {
  chiaveMechanicalClaw: {
    derivedTemplateId: 'chiave_mech_claw',
    name: '贾维机械爪',
    sourceTokenId: 'token_10004_otter_motter',
    ownerCharId: 'char_349_chiave',
    sourceSkillId: null,
    sourceUse: 'visualOnly',
    rule: '进击原创机械爪；只复用米波外观，属性取召唤前主人的有效属性快照，不继承米波技能或天赋。',
    statBasis: 'ownerAlreadyNormalizedStats',
    maxHpRatio: 0.5,
    atkRatio: 0.6,
    defRatio: 0.5,
    resRatio: 1,
    bat: 1.5,
    aspd: 100,
    blockCnt: 1,
    rangeGrid: [[0, 0], [0, 1]],
    cost: 0,
    lifeScale: 1,
    lifeScaleApplications: 0,
  },
  lingLargeDragon: {
    derivedTemplateId: 'assault_ling_large',
    sourceTokenId: 'token_10020_ling_soul3',
    ownerCharId: 'char_2023_ling',
    sourceSkillId: 'skchr_ling_3',
    rule: '令两只小龙合并为进击派生大龙；主身体变形、后者仅产生一次吸收事件，合计属性乘1.8且占一个召唤格。',
    statBasis: 'sumOfAlreadyScaledSummonStats',
    statMultiplier: 1.8,
    occupySlots: 1,
    lifeScale: 1,
    lifeScaleApplications: 0,
  },
  workshopRepairPlatform: {
    derivedTemplateId: 'assault_workshop_platform',
    sourceTokenId: 'token_10027_ironmn_pile3',
    ownerCharId: 'char_4072_ironmn',
    sourceSkillId: null,
    sourceRelicId: 'leader-ironmn-workshopkey',
    sourceUse: 'visualAndRangeOnly',
    rule: '工坊修复台为进击收藏品派生；pile3仅作外观与3-13范围来源，不安装原生技能或属性。',
    statBasis: 'ownerAlreadyNormalizedStats',
    maxHpRatio: 0.75,
    lifeScale: 1,
    lifeScaleApplications: 0,
  },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON source ${file}: ${error.message}`);
  }
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function stableRound(value) {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

function parseArgs(argv) {
  const args = { output: path.join(ROOT, 'data/assault-runtime.json'), nativeDataRoot: path.join(ROOT, 'data'), engineRevision: null, compressOutput: false };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split('=', 2);
    if (key === '--compress-output') {
      if (inline != null) throw new Error('--compress-output does not take a value');
      args.compressOutput = true;
      continue;
    }
    if (!['--output', '--native-data-root', '--engine-revision'].includes(key)) throw new Error(`Unknown argument: ${argv[i]}`);
    const value = inline ?? argv[++i];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === '--engine-revision') {
      invariant(/^[0-9a-f]{40}$/.test(value), '--engine-revision must be a native Git commit');
      invariant(execFileSync('git', ['cat-file', '-t', value], { cwd: ROOT, encoding: 'utf8' }).trim() === 'commit', '--engine-revision must be recoverable');
      args.engineRevision = value;
    } else {
      invariant(path.isAbsolute(value), `${key} must be an explicit absolute path`);
      args[key === '--output' ? 'output' : 'nativeDataRoot'] = path.resolve(value);
    }
  }
  return args;
}

function loadDesign() {
  const groups = Object.fromEntries(ASSAULT_GROUPS.map((group) => {
    const file = path.join(ROOT, `data/assault-design/roster-${group}.json`);
    const design = readJson(file);
    invariant(design.sourceRevision === EXPECTED_SOURCE_REVISION, `${file}: expected sourceRevision ${EXPECTED_SOURCE_REVISION}, got ${design.sourceRevision}`);
    return [group, design];
  }));
  const formsFile = path.join(ROOT, 'data/assault-design/forms.json');
  const forms = readJson(formsFile);
  invariant(forms.sourceRevision === EXPECTED_SOURCE_REVISION, `${formsFile}: sourceRevision mismatch`);
  const bazaar = new Map();
  for (const group of ASSAULT_GROUPS) {
    const file = path.join(ROOT, `data/assault-design/bazaar-cards-${group}.json`);
    const cards = readJson(file);
    invariant(cards.schema === 'assault-bazaar-cards/v1', `${file}: schema mismatch`);
    for (const card of cards.operators) {
      invariant(!bazaar.has(card.id), `${file}: duplicate bazaar card ${card.id}`);
      bazaar.set(card.id, card);
    }
  }
  return {
    groups,
    forms,
    bazaar,
    encounters: readJson(path.join(ROOT, 'data/assault-design/encounters.json')),
  };
}

// Card lines are the single source for both the public card text and the
// numbers a card's runtime reads; only kind and four-star params reach the DTO.
function compileBazaar(body, card) {
  invariant(card, `${body.charId}: bazaar card missing`);
  if (body.fixedSkill?.kind !== 'passive' && Array.isArray(card.sp)) {
    invariant(JSON.stringify(card.sp) === JSON.stringify(body.fixedSkill.spCosts), `${body.charId}: bazaar sp ${JSON.stringify(card.sp)} != spCosts ${JSON.stringify(body.fixedSkill.spCosts)}`);
  }
  const moduleIds = new Set((body.modulePlans ?? []).map((m) => m.id));
  for (const m of card.modules) invariant(moduleIds.has(m.id), `${body.charId}: bazaar module ${m.id} is not a module plan`);
  if (card.format === 'synergy') return compileSynergyCard(body, card);
  if (card.format === 'adaptation') return {
    format: 'adaptation', sp: card.sp, labels: cardLabels(card), tags: card.tags,
    redeploySeconds: body.starStats.map(row => row.stats.respawnTime),
    lines: card.lines.map(line => ({ kind: line.kind, text: line.template, params: {} })),
    modules: Object.fromEntries(card.modules.filter(m => m.line).map(m => [m.id, { params: m.line.params }])),
  };
  return {
    sp: card.sp ?? null, labels: cardLabels(card),
    lines: card.lines.map((line) => ({ kind: line.kind, params: line.params })),
    modules: Object.fromEntries(card.modules.filter((m) => m.line).map((m) => [m.id, { params: m.line.params }])),
  };
}

// Synergy cards (design of 2026-10-21, imported by tools/assault/import-synergy-design.mjs): each line keeps its
// structured trigger / limit / target / effect so the runtime wires the line from the same data its text comes from
// (server/sim/content/assault/card-lines.js); the card's class words become the labels 「你的某类干员」 matches.
// 职业 · 分支 · 阵营 · 小队 of the card (「炎-岁」 also as 「岁」): the class words 「你的某类干员」 matches on every card
function cardLabels(card) {
  return [...new Set(String(card.typeLabel ?? '').split(' · ').flatMap((part) => [part, ...part.split('-')])
    .concat(card.team ? [card.team] : []).map((x) => x.trim()).filter(Boolean))];
}
const SYNERGY_LINE_KINDS = new Set(['deploy', 'skill', 'talent', 'module', 'growth', 'grant', 'stack']);
function synergyLine(line, where) {
  invariant(SYNERGY_LINE_KINDS.has(line.kind), `${where}: unknown synergy line kind ${line.kind}`);
  for (const [key, values] of Object.entries(line.params ?? {})) invariant(Array.isArray(values) && values.length === 4, `${where}: param ${key} needs four stars`);
  return { kind: line.kind, suppressed:line.suppressed===true,growthSuppressed:line.growthSuppressed===true, params: line.params ?? {}, trigger: line.trigger ?? null, limit: line.limit ?? null,
    target: line.target ?? null, effect: line.effect ?? null, scope: line.scope ?? null, ...(line.selfTrigger ? { selfTrigger: true } : null) };
}
function compileSynergyCard(body, card) {
  invariant(Array.isArray(card.redeploySeconds) && card.redeploySeconds.length === 4 && card.redeploySeconds.every((x) => Number.isFinite(x) && x > 0),
    `${body.charId}: synergy card needs four 再部署时间`);
  return {
    format: 'synergy', growthIdentity:GROWTH_IDENTITIES[body.charId]??null, sp: card.sp ?? null, castOnDeploy: card.castOnDeploy === true, redeploySeconds: Array(4).fill(body.baseStats.respawnTime), labels: cardLabels(card),
    ...(SKILL_RESOLUTIONS[body.charId] ? { skillResolution: SKILL_RESOLUTIONS[body.charId] } : {}),
    lines: card.lines.map((line, index) => synergyLine(line, `${body.charId}/lines/${index}`)),
    modules: Object.fromEntries(card.modules.filter((m) => m.line).map((m) => [m.id, synergyLine(m.line, `${body.charId}/modules/${m.id}`)])),
  };
}

function loadOfficialSources() {
  const indexFile = path.join(SOURCE_ROOT, 'source-index.json');
  const index = readJson(indexFile);
  const tableEntries = Object.entries(index.sources).filter(([key]) => key.startsWith('arknights.'));
  invariant(tableEntries.length === 17, `${indexFile}: expected 17 indexed official tables, found ${tableEntries.length}`);
  const tables = {};
  for (const [key, entry] of tableEntries) {
    invariant(entry.present, `${key} is marked absent in ${indexFile}`);
    const file = entry.path;
    invariant(path.isAbsolute(file) && fs.existsSync(file), `${key}: missing official source ${file}`);
    const name = key.slice('arknights.'.length);
    invariant(fs.statSync(file).isFile() && fs.statSync(file).size > 0, `${key}: official input is not a nonempty file ${file}`);
    if (RUNTIME_SOURCE_TABLES.has(name)) tables[name] = readJson(file);
  }

  const levelsRoot = path.join(ARKNIGHTS_ROOT, 'levels/activities');
  const levelFiles = [];
  for (const activity of ['act1autochess', 'act2autochess']) {
    const dir = path.join(levelsRoot, activity);
    invariant(fs.existsSync(dir), `Missing official level directory ${dir}`);
    for (const name of fs.readdirSync(dir).filter((item) => /^level_.*\.json$/.test(item))) {
      const file = path.join(dir, name);
      levelFiles.push(file);
      invariant(fs.statSync(file).isFile() && fs.statSync(file).size > 0, `Official level is not a nonempty file ${file}`);
    }
  }
  invariant(levelFiles.length === 50, `${levelsRoot}: expected 50 official battle level files, found ${levelFiles.length}`);
  const loaded = {
    index,
    tables,
    inventory: { officialTables: tableEntries.length, levelFiles: levelFiles.length,
      parsedOfficialTables: Object.keys(tables).length,
      compilationScope: 'Parse consumed runtime tables; retain all indexed source tables and levels without rereading unused JSON.' },
  };
  for (const key of RUNTIME_SOURCE_TABLES) {
    invariant(loaded.tables[key], `${indexFile}: required official table arknights.${key} is missing`);
  }
  return loaded;
}

function buildSources(design, official) {
  const table = official.tables.characterTable;
  const patch = official.tables.charPatchTable.patchChars ?? {};
  const byId = new Map();
  const add = (record, group, index, isForm = false) => {
    invariant(record?.charId && !byId.has(record.charId), `Duplicate/missing design charId ${record?.charId ?? '(missing)'}`);
    const rosterFile = isForm ? 'forms.json' : `roster-${group}.json`;
    const roster = isForm ? design.forms.forms : design.groups[group].operators;
    const plan = roster[index];
    const native = table[record.charId] ?? patch[record.charId];
    invariant(native, `${rosterFile}#/operators/${record.charId}: official character record missing at ${table[record.charId] ? 'character_table.json' : 'char_patch_table.json'}`);
    const sourceFile = table[record.charId] ? 'character_table.json' : 'char_patch_table.json';
    invariant(Array.isArray(native.phases) && native.phases.length, `${sourceFile}#/${record.charId}: no official growth phases`);
    invariant(native.profession && native.subProfessionId && native.position, `${sourceFile}#/${record.charId}: profession/subProfessionId/position missing`);
    byId.set(record.charId, { plan, native, sourceFile, group, isForm });
  };
  for (const group of ASSAULT_GROUPS) design.groups[group].operators.forEach((record, index) => add(record, group, index));
  design.forms.forms.forEach((record, index) => add(record, null, index, true));
  invariant(byId.size === 172, `Expected 172 physical bodies (170 purchase identities + 2 Amiya forms), found ${byId.size}`);
  return byId;
}

function maxLevel(phase) {
  return phase.attributesKeyFrames?.at(-1)?.level ?? null;
}

function selectedGrowth(native) {
  const phaseIndex = native.phases.length - 1;
  const phase = native.phases[phaseIndex];
  const cap = maxLevel(phase);
  invariant(Number.isFinite(cap) && cap > 0, `${native.name}: last phase has no positive max keyframe level`);
  const level = Math.min(60, cap);
  const frames = phase.attributesKeyFrames;
  invariant(Array.isArray(frames) && frames.length > 0, `${native.name}: phase ${phaseIndex} has no attribute keyframes`);
  const upperIndex = frames.findIndex((frame) => frame.level >= level);
  const low = frames[Math.max(0, upperIndex < 0 ? frames.length - 1 : upperIndex - 1)];
  const high = frames[Math.max(0, upperIndex < 0 ? frames.length - 1 : upperIndex)];
  invariant(low?.data && high?.data, `${native.name}: malformed keyframes around level ${level}`);
  const keys = new Set([...Object.keys(low.data), ...Object.keys(high.data)]);
  const fraction = high.level === low.level ? 0 : (level - low.level) / (high.level - low.level);
  const interpolated = {};
  for (const key of keys) {
    const a = low.data[key];
    const b = high.data[key];
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      interpolated[key] = fraction < 0.5 ? (a ?? b) : (b ?? a);
    } else if (Number.isFinite(a) && Number.isFinite(b)) {
      interpolated[key] = stableRound(a + (b - a) * fraction);
    } else {
      invariant(a === b, `${native.name}: cannot interpolate non-numeric attribute ${key}`);
      interpolated[key] = a;
    }
  }
  const training = { phase: phaseIndex, level, trust: 0, potential: 1, extraPotential: 0, potentialRank: 0 };
  return { phase, phaseIndex, level, stats: interpolated, training };
}

function median(values) {
  invariant(values.length > 0, 'Cannot compute an empty active-pool branch median');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function branchMedians(sources) {
  const grouped = new Map();
  // Preserve the already-calibrated 167 purchase identities + 2 selectable Amiya forms.
  // New identities contribute only when their native branch has no established baseline.
  const latest = new Set(['char_393_toledo', 'char_4232_hbound', 'char_4231_clemnt']);
  const baseline = [...sources.entries()].filter(([id]) => !latest.has(id));
  const baselineBranches = new Set(baseline.map(([, s]) => s.native.subProfessionId));
  const pool = [...baseline, ...[...sources.entries()].filter(([id, s]) => latest.has(id) && !baselineBranches.has(s.native.subProfessionId))];
  for (const [, { native }] of pool) {
    const growth = selectedGrowth(native);
    const key = native.subProfessionId;
    if (!grouped.has(key)) grouped.set(key, { atk: [], maxHp: [], def: [] });
    for (const stat of ['atk', 'maxHp', 'def']) {
      const value = growth.stats[stat];
      invariant(Number.isFinite(value), `${native.name}: official ${stat} missing at phase ${growth.phaseIndex} level ${growth.level}`);
      grouped.get(key)[stat].push(value);
    }
  }
  return Object.fromEntries([...grouped].map(([branch, stats]) => [branch, Object.fromEntries(Object.entries(stats).map(([key, values]) => [key, stableRound(median(values))]))]));
}

function rangeGrid(rangeId, rangeTable, label) {
  const record = rangeId ? rangeTable[rangeId] : null;
  invariant(record && Array.isArray(record.grids), `${label}: official range ${rangeId ?? '(null)'} missing in range_table.json`);
  return record.grids.map((grid) => {
    const row = grid.row ?? grid.r;
    const col = grid.col ?? grid.c;
    invariant(Number.isFinite(row) && Number.isFinite(col), `${label}: malformed grid in range ${rangeId}`);
    return [row, col];
  });
}

const RANGED_MELEE_BRANCHES = new Set(['lord', 'fortress', 'shotprotector', 'agent', 'hookmaster']);
function officialAttackKind(native, dmgType) {
  const branch = native.subProfessionId;
  if (['bard', 'phalanx', 'librator'].includes(branch)) return 'none';
  if (dmgType === 'heal') return 'heal';
  if (native.position === 'RANGED' || RANGED_MELEE_BRANCHES.has(branch)) return 'ranged';
  return 'melee';
}

function officialDamageType(native, body) {
  if (['MEDIC'].includes(native.profession) && native.subProfessionId !== 'incantationmedic') return 'heal';
  if (native.subProfessionId === 'bard') return 'heal';
  const traitText = [native.trait?.candidates, native.description].flat().filter(Boolean)
    .flatMap((candidate) => Array.isArray(candidate) ? candidate : [candidate])
    .map((candidate) => typeof candidate === 'string' ? candidate : `${candidate.description ?? ''} ${candidate.additionalDescription ?? ''}`)
    .join(' ');
  if (native.profession === 'CASTER' || /法术伤害/.test(traitText) || ['artsfghter'].includes(native.subProfessionId)) return 'arts';
  return body.nativeChess?.dmgType ?? 'phys';
}

function skillRecord(skillId, slotIndex, skillTable, label, slotTokenKey = null) {
  const template = skillTable[skillId];
  invariant(template && Array.isArray(template.levels) && template.levels.length, `${label}: source skill ${skillId} missing/empty in skill_table.json`);
  const level = template.levels.at(-1);
  const sp = level.spData;
  invariant(sp && Number.isFinite(sp.spCost) && Number.isFinite(sp.initSp), `${label}: ${skillId} max-level SP source malformed`);
  return {
    skillId,
    index: slotIndex,
    name: level.name,
    skillType: level.skillType,
    spData: { spType: sp.spType, spCost: sp.spCost, initSp: sp.initSp, maxChargeTime: sp.maxChargeTime, increment: sp.increment },
    blackboard: level.blackboard ?? [],
    rangeId: level.rangeId ?? null,
    prefabId: level.prefabId ?? null,
    overrideTokenKey: slotTokenKey ?? template.overrideTokenKey ?? null,
    ...(new Set(['char_393_toledo','char_4232_hbound','char_4231_clemnt']).has(label.split('#/')[1]) ? { nativeLevels: template.levels.map((entry, levelIndex) => ({ levelIndex, ...entry, sourcePointer: `/${skillId}/levels/${levelIndex}` })) } : {}),
  };
}

export function sourceTalents(native, growth, label) {
  const phaseName = ['PHASE_0', 'PHASE_1', 'PHASE_2'][growth.phaseIndex];
  return (native.talents ?? []).map((talent, talentIndex) => {
    const pointerBase = String(label).replace(/^.*#/, '');
    if (!Array.isArray(talent.candidates) || talent.candidates.length === 0) return { index: talentIndex, name: null, description: null, requiredPotentialRank: null, unlockCondition: null, blackboard: [], rangeId: null, tokenKey: null, hidden: true, empty: true, sourcePointer: `${pointerBase}/talents/${talentIndex}` };
    const choices = talent.candidates.filter((candidate) => {
      const unlockPhase = ['PHASE_0', 'PHASE_1', 'PHASE_2'].indexOf(candidate.unlockCondition?.phase ?? 'PHASE_0');
      return (candidate.requiredPotentialRank ?? 0) === 0 && unlockPhase <= growth.phaseIndex
        && (unlockPhase < growth.phaseIndex || (candidate.unlockCondition?.level ?? 1) <= growth.level);
    });
    invariant(choices.length > 0, `${label}: native talent ${talentIndex} has no candidate unlocked at ${phaseName} Lv.${growth.level} with zero extra potential`);
    const chosen = choices.at(-1);
    return {
      index: talentIndex,
      name: chosen.name,
      description: chosen.description,
      requiredPotentialRank: 0,
      unlockCondition: chosen.unlockCondition,
      blackboard: chosen.blackboard ?? [],
      rangeId: chosen.rangeId ?? null,
      tokenKey: chosen.tokenKey ?? null,
      hidden: !!chosen.isHideTalent,
      empty: false,
      sourcePointer: `${pointerBase}/talents/${talentIndex}`,
    };
  });
}

function moduleSources(modulePlans, native, official, bodyId) {
  const equipment = official.tables.uniequipTable;
  const battle = official.tables.battleEquipTable;
  const nativeIds = new Set(equipment.charEquip?.[bodyId] ?? []);
  const bodyPhase = native.phases.length - 1;
  const bodyLevel = Math.min(60, maxLevel(native.phases.at(-1)));
  const zeroPotentialCandidates = (candidates) => (candidates ?? []).filter((candidate) => {
    const phase = ['PHASE_0', 'PHASE_1', 'PHASE_2'].indexOf(candidate.unlockCondition?.phase ?? 'PHASE_0');
    return (candidate.requiredPotentialRank ?? 0) === 0 && phase <= bodyPhase
      && (phase < bodyPhase || (candidate.unlockCondition?.level ?? 1) <= bodyLevel);
  });
  return modulePlans.map((plan) => {
    invariant(nativeIds.has(plan.id), `${bodyId}: planned module ${plan.id} missing from uniequip_table.json#charEquip`);
    const record = equipment.equipDict?.[plan.id];
    invariant(record, `${bodyId}: planned module ${plan.id} missing from uniequip_table.json#equipDict`);
    const source = battle[plan.id];
    const phases = source?.phases ?? [];
    const nativeLevel = phases.reduce((max, phase) => Math.max(max, phase.equipLevel ?? 0), 0);
    const phase = phases.find((entry) => entry.equipLevel === nativeLevel) ?? null;
    const parts = (phase?.parts ?? []).map((part) => ({
      target: part.target,
      isToken: !!part.isToken,
      talentCandidates: zeroPotentialCandidates(part.addOrOverrideTalentDataBundle?.candidates),
      traitCandidates: zeroPotentialCandidates(part.overrideTraitDataBundle?.candidates),
    }));
    const tokenTheme = Object.fromEntries(Object.entries(phase?.tokenAttributeBlackboard ?? {}).map(([tokenId, blackboard]) => [tokenId, blackboard]));
    return {
      id: plan.id,
      type: record.type,
      name: record.uniEquipName,
      typeName: record.typeName1 && record.typeName2 ? `${record.typeName1}-${record.typeName2}` : null,
      sourceLevel: nativeLevel || null,
      enabled: false,
      nativeWhiteStatsApplied: false,
      nativeCallbacksApplied: false,
      theme: { parts, tokenBlackboards: tokenTheme },
      translation: plan,
      source: { table: source ? 'battle_equip_table.json' : 'uniequip_table.json', id: plan.id,
        ...(source && ((bodyId === 'char_393_toledo' && plan.id === 'uniequip_002_toledo') || (bodyId === 'char_4232_hbound' && plan.id === 'uniequip_002_hbound')) ? { nativeWhiteStatsByLevel: phases.map((entry) => ({ equipLevel: entry.equipLevel, attributes: entry.attributeBlackboard ?? [], sourcePointer: `/${plan.id}/phases/${entry.equipLevel - 1}/attributeBlackboard` })) } : {}),
        ...(source && ((bodyId === 'char_4145_ulpia' && plan.id === 'uniequip_003_ulpia') || (bodyId === 'char_393_toledo' && plan.id === 'uniequip_002_toledo') || (bodyId === 'char_4232_hbound' && plan.id === 'uniequip_002_hbound')) ? { nativeLevels: phases.map((entry, phaseIndex) => ({ equipLevel: entry.equipLevel,
          attributes: entry.attributeBlackboard ?? [], parts: (entry.parts ?? []).map((part, partIndex) => ({ target: part.target, isToken: !!part.isToken,
            talentCandidates: zeroPotentialCandidates(part.addOrOverrideTalentDataBundle?.candidates),
            traitCandidates: zeroPotentialCandidates(part.overrideTraitDataBundle?.candidates),
            sourcePointer: `/${plan.id}/phases/${phaseIndex}/parts/${partIndex}` })),
          sourcePointer: `/${plan.id}/phases/${phaseIndex}` })) } : {}) },
    };
  });
}

function makeBody(bodyId, source, purchaseCharId, medians, official, nativeChess) {
  const { native, sourceFile, isForm } = source;
  const plan = adaptationPlan(source.plan, native, official.tables.skillTable);
  const label = `${sourceFile}#/${bodyId}`;
  const growth = selectedGrowth(native);
  const branch = medians[native.subProfessionId];
  const trait = nativeTrait(native, growth, official.tables.rangeTable);
  invariant(branch, `${label}: active-pool median missing for branch ${native.subProfessionId}`);
  const raw = growth.stats;
  const blended = {};
  for (const key of ['atk', 'maxHp', 'def']) {
    invariant(Number.isFinite(raw[key]), `${label}: missing interpolated ${key}`);
    blended[key] = raw[key] === 0 ? 0 : stableRound((raw[key] + branch[key]) / 2);
  }
  const physicalStats = {
    ...raw,
    atk: blended.atk,
    maxHp: stableRound(blended.maxHp * 5),
    def: blended.def,
    magicResistance: raw.magicResistance,
  };
  const baseStats = {
    maxHp: physicalStats.maxHp,
    atk: physicalStats.atk,
    def: physicalStats.def,
    res: physicalStats.magicResistance,
    cost: physicalStats.cost,
    blockCnt: physicalStats.blockCnt,
    bat: physicalStats.baseAttackTime,
    aspd: physicalStats.attackSpeed,
    respawnTime: physicalStats.respawnTime,
    spRecovery: physicalStats.spRecoveryPerSec,
    hpRecoveryPerSec: physicalStats.hpRecoveryPerSec,
    moveSpeed: physicalStats.moveSpeed,
    tauntLevel: physicalStats.tauntLevel,
    massLevel: physicalStats.massLevel,
    deployLimit: physicalStats.maxDeployCount,
    deckStack: physicalStats.maxDeckStackCnt,
  };
  invariant(Object.values(baseStats).every(Number.isFinite), `${label}: non-finite compiled baseStats`);
  const starStats = ATTACK_MULTIPLIERS.map((atkMultiplier, index) => ({
    star: index + 1,
    stats: {
      ...baseStats,
      atk: stableRound(baseStats.atk * atkMultiplier),
      maxHp: stableRound(baseStats.maxHp * HEALTH_MULTIPLIERS[index]),
    },
  }));
  const skillSpec = plan.fixedSkill;
  invariant(skillSpec, `${label}: fixed design skill record missing`);
  const slots = native.skills ?? [];
  const sourceSkills = slots.map((slot, index) => skillRecord(slot.skillId, index, official.tables.skillTable, label, slot.overrideTokenKey));
  const passiveSkill = skillSpec.kind === 'passive';
  const sourcedPassive = passiveSkill && skillSpec.adaptation?.nativeDeploy === true && skillSpec.sourceSkillId != null;
  if (passiveSkill && !sourcedPassive) {
    invariant(skillSpec.sourceSkillId == null && skillSpec.sourceIndex == null && skillSpec.spCosts.length === 0, `${label}: PASSIVE skill must not claim a native skill slot or SP cost`);
  } else {
    invariant(skillSpec.sourceSkillId && Number.isInteger(skillSpec.sourceIndex), `${label}: fixed design skill sourceSkillId/sourceIndex missing`);
    invariant(slots[skillSpec.sourceIndex]?.skillId === skillSpec.sourceSkillId, `${label}: design sourceSkillId/index do not match official character_table skill slots`);
  }
  const nativeSkill = passiveSkill && !sourcedPassive ? null : sourceSkills[skillSpec.sourceIndex];
  const skillLevels = passiveSkill && !sourcedPassive ? [] : official.tables.skillTable[skillSpec.sourceSkillId].levels;
  if (sourcedPassive) invariant(skillLevels.at(-1).spData.spCost === 0, `${label}: native deployment passive must have no SP cost`);
  // a synergy card stores what its design says (skill.charges, every star; ruled 10-21), others the native skill's
  if (skillSpec.charges != null) invariant(Number.isInteger(skillSpec.charges) && skillSpec.charges >= 1, `${label}: fixed design skill charges must be a positive integer`);
  const maxCharges = passiveSkill ? [1,1,1,1] : skillSpec.charges != null ? [1,2,3,4].map(() => skillSpec.charges) : [6,7,8,9].map(index =>
    Math.max(1, skillLevels[Math.min(index,skillLevels.length-1)].spData.maxChargeTime ?? 1));
  const fixedSkill = {
    ...skillSpec,
    maxCharges,
    spType: passiveSkill ? 'none' : 'time',
    source: {
      table: passiveSkill && !sourcedPassive ? null : 'skill_table.json',
      id: skillSpec.sourceSkillId,
      index: skillSpec.sourceIndex,
      native: nativeSkill,
    },
    runtime: {
      skillId: skillSpec.sourceSkillId,
      index: skillSpec.sourceIndex,
      name: skillSpec.name,
      skillType: passiveSkill ? 'PASSIVE' : 'AUTO',
      kind: skillSpec.kind,
      trigger: passiveSkill ? 'PASSIVE' : 'SP_FULL',
      spType: passiveSkill ? null : 'INCREASE_WITH_TIME',
      spCosts: skillSpec.spCosts,
      initSp: skillSpec.initSp,
      maxCharges,
      recoveryPerSec: passiveSkill ? null : skillSpec.recoveryPerSec,
      sourceRangeId: nativeSkill?.rangeId ?? null,
      sourceRangeGrid: nativeSkill?.rangeId ? rangeGrid(nativeSkill.rangeId, official.tables.rangeTable, `${label}: fixed skill`) : null,
      sourceSkillType: undefined,
      effects: skillSpec.effects,
    },
  };
  delete fixedSkill.runtime.sourceSkillType;
  const rangeId = growth.phase.rangeId;
  const grid = rangeGrid(rangeId, official.tables.rangeTable, label);
  if (fixedSkill.adaptation && !fixedSkill.runtime.sourceRangeGrid) {
    const extension = nativeSkill?.blackboard?.find(entry => entry.key === 'ability_range_forward_extend')?.value ?? 0;
    fixedSkill.runtime.sourceRangeGrid = extendedGrid(grid, extension);
  }
  if (fixedSkill.adaptation?.nativeRange === 'forwardLine') {
    invariant(/无限长的直线/.test(skillLevels.at(-1).description), `${label}: forward-line range lacks native source`);
    fixedSkill.runtime.sourceRangeGrid = Array.from({ length: 21 }, (_, i) => [0, i]);
  }
  const dmgType = officialDamageType(native, { nativeChess });
  const attackKind = officialAttackKind(native, dmgType);
  const position = native.position;
  const projectiles = { phys: 'arrow', arts: 'bolt', heal: 'orb' };
  const profile = {
    profession: native.profession,
    subProfessionId: native.subProfessionId,
    subProfessionName: official.tables.uniequipTable.subProfDict?.[native.subProfessionId]?.subProfessionName || nativeChess?.subProfessionName || null,
    position,
    rangeId,
    rangeGrid: grid,
    attackKind,
    dmgType,
    projectile: attackKind === 'ranged' ? (projectiles[dmgType] ?? 'arrow') : 'none',
    canHitFly: nativeChess?.canHitFly ?? (attackKind === 'ranged' && !['fortress', 'thrower'].includes(native.subProfessionId)),
    targetPriority: nativeChess?.targetPriority ?? null,
    stats: physicalStats,
    trait,
    nativeSourceLevel: growth.level,
  };
  const talents = sourceTalents(native, growth, label);
  const talentPlans = plan.talentPlans ?? [];
  const talentBindings = talentPlans.map((talentPlan) => {
    const index = Number(/\/talents\/(\d+)/.exec(talentPlan.sourcePointer ?? '')?.[1]);
    invariant(Number.isInteger(index) && talents[index], `${label}: talent plan has unresolved native source pointer ${talentPlan.sourcePointer}`);
    return {
      binding: talentPlan.runtimeBinding ?? null,
      mode: talentPlan.mode,
      nativeTalentIndex: index,
      nativeTalent: talents[index],
      translation: talentPlan,
      singleBinding: true,
    };
  });
  const originalModules = moduleSources(plan.modulePlans ?? [], native, official, bodyId);
  const modules = adaptationModules(bodyId, fixedSkill, originalModules);
  const adaptation = compiledAdaptation(fixedSkill, grid);
  if (adaptation) adaptation.moduleAliases = Object.fromEntries(originalModules.map((m, index) => [m.id, modules[index % 2].id]));
  const deployAnchors = talentBindings.filter((binding) => binding.translation?.parameters?.anchorKind === 'deployAnchor').map((binding) => {
    const sourceTemplateId = fixedSkill.source.native?.overrideTokenKey;
    const sourceAnchor = official.tables.characterTable[sourceTemplateId];
    invariant(sourceAnchor, `${label}: deployment anchor source ${sourceTemplateId} is missing`);
    const deployCost = selectedGrowth(sourceAnchor).stats.cost;
    invariant(Number.isFinite(deployCost) && deployCost >= 0, `${label}: invalid source deployment anchor cost`);
    return { kind: 'deployAnchor', name: binding.translation.parameters.anchorName, sourceTemplateId, deployCost,
      combatant: false, population: 0, attackable: false, healable: false, sourceRef: { table: 'character_table.json', pointer: `/${sourceTemplateId}` } };
  });
  const defaultModuleId = adaptation ? null : plan.defaultModuleId ?? plan.defaultModule ?? null;
  invariant(!defaultModuleId || modules.some((module) => module.id === defaultModuleId && module.type === 'ADVANCED'), `${label}: default module ${defaultModuleId} is not an advanced module`);
  const selectedModule = modules.find((module) => module.id === defaultModuleId) ?? null;
  const sourceRecord = {
    table: sourceFile,
    pointer: `/${bodyId}`,
    ...(new Set(['char_393_toledo','char_4232_hbound','char_4231_clemnt']).has(bodyId) ? { fullNative: { phases: native.phases, favorKeyFrames: native.favorKeyFrames ?? [], talents: native.talents ?? [], skills: slots.map((slot,index) => ({ ...slot, index, pointer: `/${bodyId}/skills/${index}`, sourcePointer: `/${slot.skillId}` })) } } : {}),
    level: growth.level,
    phase: growth.phaseIndex,
    rangeId,
    interpolatedAttributes: raw,
    trait: trait.source,
    skills: sourceSkills,
    talents,
    ...(adaptation ? { modules: originalModules } : {}),
  };
  const simChess = {
    chessId: bodyId,
    charId: bodyId,
    name: plan.name,
    tier: plan.priceTier ?? null,
    profession: native.profession,
    subProfessionId: native.subProfessionId,
    subProfessionName: profile.subProfessionName,
    position,
    assaultPlacementClass: position === 'MELEE' && ['hookmaster', 'pusher'].includes(native.subProfessionId) ? 'all' : position === 'MELEE' ? 'melee' : 'ranged',
    stats: baseStats,
    trait: { desc: trait.desc, bb: trait.bb, rangeGrid: trait.rangeGrid },
    rangeId,
    rangeGrid: grid,
    attackKind,
    dmgType,
    projectile: profile.projectile,
    canHitFly: profile.canHitFly,
    targetPriority: profile.targetPriority,
    skill: passiveSkill ? null : {
      skillId: fixedSkill.runtime.skillId,
      index: fixedSkill.runtime.index,
      name: fixedSkill.runtime.name,
      skillType: fixedSkill.runtime.skillType,
      kind: fixedSkill.runtime.kind,
      trigger: fixedSkill.runtime.trigger,
      spType: fixedSkill.runtime.spType,
      spCost: fixedSkill.runtime.spCosts[0],
      initSp: Array.isArray(fixedSkill.runtime.initSp) ? fixedSkill.runtime.initSp[0] : fixedSkill.runtime.initSp,
      maxCharges: maxCharges[0],
      durationType: 'NONE',
      duration: 0,
      description: fixedSkill.description,
      bb: {},
    },
    talents: talentBindings.filter((binding) => binding.mode === 'retain').map((binding) => ({
      name: binding.nativeTalent.name,
      description: binding.nativeTalent.description,
      bb: Object.fromEntries(binding.nativeTalent.blackboard.filter((entry) => typeof entry.value === 'number').map((entry) => [entry.key, entry.value])),
      rangeId: binding.nativeTalent.rangeId,
      tokenKey: binding.nativeTalent.tokenKey,
    })),
  };
  return {
    charId: bodyId,
    formId: bodyId,
    purchaseCharId,
    name: plan.name,
    profession: native.profession,
    nationId: native.nationId ?? null,
    groupId: native.groupId ?? null,
    teamId: native.teamId ?? null,
    raceId: native.raceId ?? null,
    tags: [...new Set([native.profession, native.nationId, native.groupId, native.teamId, plan.archetype].filter(Boolean))],
    subProfession: native.subProfessionId,
    subProfessionId: native.subProfessionId,
    rangeId,
    range: grid,
    position,
    price: plan.price,
    priceTier: plan.priceTier,
    archetype: plan.archetype,
    baseStats,
    starStats,
    physicalProfile: profile,
    trait,
    deployAnchors,
    summonTemplateIds: [...new Set([...Object.keys(native.displayTokenDict ?? {}).filter((id) => id.startsWith('token_')),
      ...(adaptation?.manualSummons??[]).map(entry=>entry.tokenId)])],
    fixedSkill,
    ...(adaptation ? { adaptation } : {}),
    talentBindings,
    modePassives: adaptation ? [] : structuredClone(plan.modePassives ?? []),
    modulePlans: modules,
    defaultModuleId,
    defaultModule: selectedModule ? { id: selectedModule.id, type: selectedModule.type, sourceLevel: selectedModule.sourceLevel } : null,
    moduleSelection: { selectedModuleId: defaultModuleId, onlyOneActive: true, perPhysicalBody: true },
    training: growth.training,
    branchMedian: branch,
    source: sourceRecord,
    simChess,
  };
}

export function sourceTokenIds(bodies, characterTable) {
  const sources = new Map();
  const add = (tokenId, source) => {
    if (!tokenId) return;
    if (!sources.has(tokenId)) sources.set(tokenId, []);
    if (!sources.get(tokenId).some((entry) => entry.bodyCharId === source.bodyCharId && entry.kind === source.kind && entry.id === source.id)) sources.get(tokenId).push(source);
  };
  for (const body of Object.values(bodies)) {
    const owner = body.charId;
    const skill = body.fixedSkill.source.native;
    // a talent may name a family key with no template of its own that each skill overrides (凛御银灰's eagle →
    // eagle1/2/3): the skills' templates stand for it
    const overridden = [skill, ...(body.source?.skills ?? [])].some((slot) => slot?.overrideTokenKey);
    const talentKey = (talent) => {
      const key = talent.nativeTalent?.tokenKey;
      return key && (characterTable?.[key] || !overridden) ? key : null;
    };
    if (skill?.overrideTokenKey) add(skill.overrideTokenKey, { bodyCharId: owner, kind: 'skill', id: skill.skillId, index: skill.index });
    for (const talent of body.talentBindings) {
      if (talent.mode === 'retain' && talentKey(talent)) add(talent.nativeTalent.tokenKey, { bodyCharId: owner, kind: 'talent', id: `talent_${talent.nativeTalentIndex}`, index: talent.nativeTalentIndex });
    }
    for (const module of body.modulePlans.filter((entry) => entry.id === body.defaultModuleId)) {
      for (const tokenId of Object.keys(module.theme.tokenBlackboards)) {
        add(tokenId, { bodyCharId: owner, kind: 'module', id: module.id });
      }
    }
    // a synergy card's lines may summon what any native skill, talent or module of the operator summons (风丸's 替身 is
    // S2's token while the card adapts S1): every such template of the body is compiled
    if (body.bazaar?.format === 'synergy' || body.adaptation) {
      for (const slot of body.source?.skills ?? []) if (slot?.overrideTokenKey) add(slot.overrideTokenKey, { bodyCharId: owner, kind: 'skill', id: slot.skillId, index: slot.index });
      for (const talent of body.talentBindings) if (talentKey(talent)) add(talent.nativeTalent.tokenKey, { bodyCharId: owner, kind: 'talent', id: `talent_${talent.nativeTalentIndex}`, index: talent.nativeTalentIndex });
      for (const module of body.source.modules ?? body.modulePlans) for (const tokenId of Object.keys(module.theme?.tokenBlackboards ?? {})) add(tokenId, { bodyCharId: owner, kind: 'module', id: module.id });
    }
  }
  for (const [name, derived] of Object.entries(DERIVED_SUMMONS)) {
    add(derived.sourceTokenId, { bodyCharId: derived.ownerCharId, kind: 'derivedTemplate', id: name });
  }
  return sources;
}

function nativeTokenTemplate(tokenId, official, generatedTokens) {
  const native = official.tables.characterTable[tokenId];
  invariant(native?.profession === 'TOKEN', `character_table.json#/${tokenId}: official summon template missing or not a TOKEN`);
  const growth = selectedGrowth(native);
  const trait = nativeTrait(native, growth, official.tables.rangeTable);
  const raw = growth.stats;
  const rangeId = growth.phase.rangeId;
  const generated = generatedTokens[tokenId];
  const skillSlot = native.skills?.find((entry) => entry?.skillId) ?? null;
  let skill = null;
  if (skillSlot) {
    const nativeSkill = skillRecord(skillSlot.skillId, 0, official.tables.skillTable, tokenId, skillSlot.overrideTokenKey);
    const sp = nativeSkill.spData;
    skill = {
      skillId: nativeSkill.skillId,
      name: nativeSkill.name,
      index: 0,
      skillType: nativeSkill.skillType,
      spType: sp.spType,
      spCost: sp.spCost,
      initSp: sp.initSp,
      maxChargeTime: sp.maxChargeTime,
      bb: Object.fromEntries(nativeSkill.blackboard.filter((entry) => typeof entry.value === 'number').map((entry) => [entry.key, entry.value])),
      rangeGrid: nativeSkill.rangeId ? rangeGrid(nativeSkill.rangeId, official.tables.rangeTable, tokenId) : null,
      description: '',
    };
  }
  const talents = sourceTalents(native, growth, `character_table.json#/${tokenId}`);
  const sourceRecord = {
    tokenId,
    name: native.name,
    description: native.description ?? native.trait?.candidates?.map((candidate) => candidate.description ?? '').filter(Boolean).join(' ') ?? '',
    trait: { desc: trait.desc, bb: trait.bb, rangeGrid: trait.rangeGrid },
    profession: native.profession,
    subProfessionId: native.subProfessionId,
    position: native.position,
    nativeStats: raw,
    stats: {
      ...raw,
      maxHp: raw.maxHp === 0 ? 0 : stableRound(raw.maxHp * 5),
    },
    rangeId,
    rangeGrid: rangeGrid(rangeId, official.tables.rangeTable, tokenId),
    attackKind: generated?.attackKind ?? null,
    dmgType: generated?.dmgType ?? null,
    projectile: generated?.projectile ?? null,
    canHitFly: generated?.canHitFly ?? null,
    targetPriority: generated?.targetPriority ?? null,
    skill,
    talents: talents.map((talent) => ({
      index: talent.index, empty: talent.empty, sourcePointer: talent.sourcePointer,
      name: talent.name,
      desc: talent.description,
      bb: Object.fromEntries(talent.blackboard.filter((entry) => typeof entry.value === 'number').map((entry) => [entry.key, entry.value])),
      rangeId: talent.rangeId,
      tokenKey: talent.tokenKey,
    })),
    source: { table: 'character_table.json', pointer: `/${tokenId}`, level: growth.level, phase: growth.phaseIndex },
  };
  const token = normalizeToken(tokenId, sourceRecord);
  return {
    tokenId,
    name: token.name,
    profession: token.profession,
    subProfessionId: token.subProf,
    position: token.position,
    rangeId,
    rangeGrid: token.rangeGrid,
    attackKind: token.attackKind,
    dmgType: token.dmgType,
    projectile: token.projectile,
    canHitFly: token.canHitFly,
    targetPriority: token.targetPriority,
    stats: token.stats,
    skill: token.skill,
    talents: token.talents,
    trait,
    count: token.count,
    source: sourceRecord.source,
    sourceTemplate: { ...sourceRecord, stats: raw },
    lifeScaleFactor: 5,
    lifeScaleApplications: 1,
    rawTokenIdentityPreserved: true,
  };
}

function compileSummons(bodies, official, generatedTokens) {
  const refs = sourceTokenIds(bodies, official.tables.characterTable);
  const summons = {};
  for (const [tokenId, sources] of refs) {
    const template = nativeTokenTemplate(tokenId, official, generatedTokens);
    summons[tokenId] = {
      ...template,
      sources,
    };
  }
  const derivedTemplates = Object.fromEntries(Object.entries(DERIVED_SUMMONS).map(([key, value]) => {
    invariant(summons[value.sourceTokenId], `Derived summon ${key} is missing source template ${value.sourceTokenId}`);
    const body = bodies[value.ownerCharId];
    invariant(body, `Derived summon ${key}: owner body ${value.ownerCharId} missing`);
    return [key, { ...value, ownerUidPolicy: 'useRuntimeOwnerUid', bodyCharId: value.ownerCharId, translationSource: body.source }];
  }));
  return { summons, derivedTemplates };
}

function compileEncounters(design, sharedData) {
  const encounters = {};
  const keys = new Set();
  for (const entry of design) {
    invariant(!keys.has(entry.id), `Duplicate encounter id ${entry.id}`);
    keys.add(entry.id);
    const waveId = entry.waveSourceRef?.pointer?.replace(/^\//, '');
    invariant(entry.stageId && sharedData.stages[entry.stageId], `${entry.id}: stage reference ${entry.stageId} is not in shared data/stages.json`);
    invariant(waveId && sharedData.waves[waveId], `${entry.id}: wave reference ${waveId ?? '(missing)'} is not in shared data/waves.json`);
    const spawns = entry.wave?.spawns ?? [];
    for (const spawn of spawns) {
      if (spawn.key.startsWith('boss_')) invariant(sharedData.bosses[spawn.key], `${entry.id}: boss spawn reference ${spawn.key} is not in shared data/bosses.json`);
      else invariant(sharedData.enemies[spawn.key], `${entry.id}: enemy spawn reference ${spawn.key} is not in shared data/enemies.json`);
    }
    const bossId = entry.wave?.bossId ?? entry.bossId ?? null;
    if (bossId) invariant(sharedData.bosses[bossId], `${entry.id}: boss reference ${bossId} is not in shared data/bosses.json`);
    encounters[entry.id] = {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      dayRange: entry.dayRange,
      stageId: entry.stageId,
      waveId,
      bossId,
      spawnRefs: spawns.map(({ key, count, interval, routeIndex, time }) => ({
        ...(key.startsWith('boss_') ? { bossId: key } : { enemyKey: key }), count, interval, routeIndex, time,
      })),
      source: {
        design: 'data/assault-design/encounters.json',
        stage: entry.stageSourceRef,
        wave: entry.waveSourceRef,
      },
    };
  }
  invariant(Object.keys(encounters).length === 36, `Expected 36 encounter references, found ${Object.keys(encounters).length}`);
  return encounters;
}

// Hidden operator talents may refer to enemy-shaped skill entities which are
// absent from the Alliance encounter pool. Keep their native identity separate
// from tokens; the owning card applies the documented host inheritance.
function compileAuxiliaryEnemies(sources, official, baseEnemies) {
  const result = {};
  const database = official.tables.enemyDatabase.enemies;
  const fields = { maxHp: 'maxHp', atk: 'atk', def: 'def', magicResistance: 'res',
    moveSpeed: 'moveSpeed', baseAttackTime: 'bat', attackSpeed: 'aspd',
    massLevel: 'massLevel', hpRecoveryPerSec: 'hpRecoveryPerSec', tauntLevel: 'tauntLevel',
    epDamageResistance: 'elementDmgRes', epResistance: 'elementRes' };
  for (const [charId, source] of sources) {
    for (const [talentIndex, talent] of (source.native.talents ?? []).entries()) {
      for (const [candidateIndex, candidate] of (talent.candidates ?? []).entries()) {
        for (const bb of candidate.blackboard ?? []) {
          if (bb.key !== 'take_extra_enemy_key' || !bb.valueStr?.startsWith('enemy_')) continue;
          const key = bb.valueStr;
          if (baseEnemies[key] || result[key]) continue;
          const index = database.findIndex((entry) => entry.Key === key);
          invariant(index >= 0, `${charId}: native skill entity ${key} is missing`);
          const levelIndex = database[index].Value.findIndex((entry) => entry.level === 0);
          invariant(levelIndex >= 0, `${key}: native level zero is missing`);
          const raw = database[index].Value[levelIndex].enemyData;
          const stats = {};
          for (const [from, to] of Object.entries(fields)) {
            const field = raw.attributes[from];
            if (field?.m_defined) stats[to] = field.m_value;
          }
          stats.rangeRadius = raw.rangeRadius.m_value;
          stats.rawRangeRadius = raw.rangeRadius.m_value;
          stats.lpr = raw.lifePointReduce.m_value;
          stats.immunities = Object.fromEntries(Object.entries(raw.attributes)
            .filter(([name, field]) => name.endsWith('Immune') && field.m_defined)
            .map(([name, field]) => [name.slice(0, -6), field.m_value]));
          result[key] = { key, name: raw.name.m_value, level: 0,
            rank: raw.levelType.m_value, applyWay: raw.applyWay.m_value,
            stats, talents: { bb: Object.fromEntries((raw.talentBlackboard ?? [])
              .filter((entry) => entry.value != null).map((entry) => [entry.key, entry.value])) },
            skills: [], abilities: [], spine: raw.prefabKey.m_value,
            assaultAuxiliary: true, nativeAttributesRequireHostInheritance: true,
            source: { file: path.join(ARKNIGHTS_ROOT, 'levels/enemydata/enemy_database.json'),
              pointer: `/enemies/${index}/Value/${levelIndex}/enemyData`,
              ownerCharId: charId, ownerTalentPointer: `/${charId}/talents/${talentIndex}/candidates/${candidateIndex}` } };
        }
      }
    }
  }
  return result;
}

export function compile() {
  const args = parseArgs(process.argv.slice(2));
  const design = loadDesign();
  const official = loadOfficialSources();
  const sources = buildSources(design, official);
  const medians = branchMedians(sources);
  const sharedData = {
    chess: readJson(path.join(args.nativeDataRoot, 'chess.json')),
    tokens: readJson(path.join(args.nativeDataRoot, 'tokens.json')),
    enemies: readJson(path.join(args.nativeDataRoot, 'enemies.json')),
    bosses: readJson(path.join(args.nativeDataRoot, 'bosses.json')),
    stages: readJson(path.join(args.nativeDataRoot, 'stages.json')),
    waves: readJson(path.join(args.nativeDataRoot, 'waves.json')),
  };
  const nativeByChar = new Map(Object.entries(sharedData.chess).filter(([, record]) => record.charId).map(([id, record]) => [record.charId, { id, ...record }]));
  const bodies = {};
  const operators = {};
  for (const [bodyId, source] of sources) {
    const purchaseCharId = source.isForm ? design.forms.family.charId : bodyId;
    const nativeChess = nativeByChar.get(bodyId) ?? null;
    const body = makeBody(bodyId, source, purchaseCharId, medians, official, nativeChess);
    body.bazaar = compileBazaar(body, adaptationCard(body, design.bazaar.get(bodyId)));
    assertFixedSkillContract(body, official.tables.skillTable);
    // Respawn comes from the original character table at every star. The
    // automatic in-place cycle and actual knocked-out return share this base.
    bodies[bodyId] = body;
    if (!source.isForm) operators[bodyId] = { ...body, extraForms: [] };
  }
  for (const form of design.forms.forms) {
    const purchase = operators[design.forms.family.charId];
    invariant(purchase, `Amiya purchase identity ${design.forms.family.charId} missing`);
    purchase.extraForms.push(form.charId);
  }
  const { summons, derivedTemplates } = compileSummons(bodies, official, sharedData.tokens);
  const auxiliaryEnemies = { ...compileAuxiliaryEnemies(sources, official, sharedData.enemies),
    ...chapterEnemyRecords(official.tables.enemyDatabase.enemies, sharedData.enemies) };
  const encounters = compileEncounters(design.encounters.encounters, { ...sharedData, enemies: { ...sharedData.enemies, ...auxiliaryEnemies } });
  const contentSourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const engineRevision = args.engineRevision ?? contentSourceRevision;
  const output = {
    schema: 'assault-runtime/v1',
    sourceRevision: EXPECTED_SOURCE_REVISION,
    engineRevision,
    contentSourceRevision,
    sourceInventory: official.inventory,
    training: { phase: 'highest', level: 'min(60, highestPhaseCap)', trust: 0, potential: 1, extraPotential: 0, potentialRank: 0 },
    normalization: {
      branchMedianPool: 'baseline 167 purchase identities + 2 selectable Amiya forms from nativeGit 4fcdf; latest additions char_393_toledo,char_4232_hbound,char_4231_clemnt contribute only to previously unseen branches; source stats remain nativeGit 17759cc',
      blend: { atk: 0.5, maxHp: 0.5, def: 0.5 },
      preserveZero: true,
      maxHpScale: 5,
      maxHpScaleApplications: 1,
      starAtkMultipliers: ATTACK_MULTIPLIERS,
      starHealthMultipliers: HEALTH_MULTIPLIERS,
      starDefenseMultiplier: 1,
      starResistanceMultiplier: 1,
      moduleWhiteStatsApplied: false,
      nativePotentialModifiersApplied: false,
    },
    branchMedians: medians,
    operators,
    bodies,
    summons,
    auxiliaryEnemies,
    derivedTemplates,
    encounters,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const staging = path.resolve(SOURCE_ROOT, '../../.omni/tmp/assault');
  fs.mkdirSync(staging, { recursive: true });
  const temporary = path.join(staging, `assault-runtime.pending-${process.pid}.json`);
  if (args.compressOutput) {
    invariant(process.platform === 'win32', '--compress-output requires native NTFS support');
    fs.writeFileSync(temporary, '', { flag: 'wx' });
    execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'compact.exe'), ['/C', '/F', temporary],
      { windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  fs.writeFileSync(temporary, `${JSON.stringify(output)}\n`);
  // Windows readers or the native indexer can briefly hold an otherwise valid
  // generated target. Retry this same atomic replacement, never recompile or
  // remove the previous good DTO to work around a sharing violation.
  const renameDeadline = Date.now() + 5000;
  for (;;) {
    try { fs.renameSync(temporary, args.output); break; }
    catch (error) {
      if (!['EPERM','EBUSY','EACCES'].includes(error.code) || Date.now() >= renameDeadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
    }
  }
  console.log(`Compiled ${Object.keys(operators).length} purchase identities, ${Object.keys(bodies).length} physical bodies, ${Object.keys(summons).length} source summon templates, ${Object.keys(derivedTemplates).length} derived templates, ${Object.keys(encounters).length} encounters.`);
  console.log(`Source revision ${output.sourceRevision}; engine revision ${output.engineRevision}; ${official.inventory.officialTables} indexed official tables and ${official.inventory.levelFiles} indexed official levels present; ${official.inventory.parsedOfficialTables} consumed tables parsed.`);
  console.log(JSON.stringify({coverage:refreshRangedCoverage(output)}));
  console.log(`Output: ${args.output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    compile();
  } catch (error) {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  }
}
