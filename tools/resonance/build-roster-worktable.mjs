import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FROZEN_PATH = resolve(ROOT, 'docs/resonance/reference/existing-game.json');
const DESIGN_PATH = resolve(ROOT, 'docs/resonance/design.md');
const JSON_PATH = resolve(ROOT, 'docs/resonance/roster-worktable.json');
const MD_PATH = resolve(ROOT, 'docs/resonance/roster-worktable.md');
const frozen = JSON.parse(readFileSync(FROZEN_PATH, 'utf8'));
const design = readFileSync(DESIGN_PATH, 'utf8');
if (frozen.schema !== 'stronghold.existing-game-reference/v1') throw new Error(`Unexpected frozen reference schema: ${frozen.schema}`);
if (frozen.sourceCommit !== '4ed1ad32ec10da15c23f9d7939dade603950759b') throw new Error(`Unexpected frozen source commit: ${frozen.sourceCommit}`);
const operators = frozen.records?.['independent-design']?.data?.operators;
const chessById = frozen.records?.chess?.data;
if (!Array.isArray(operators) || operators.length !== 154 || !chessById) throw new Error('Frozen roster/chess reference incomplete');

function listFromRule(pattern, ruleLabel) {
  const match = design.match(pattern);
  if (!match) throw new Error(`Could not parse ${ruleLabel} from design.md`);
  const names = match[1].split('、').map((name) => name.trim()).filter(Boolean);
  if (!names.length || names.some((name) => !operators.some((operator) => operator.name === name))) {
    throw new Error(`${ruleLabel} has an empty or unknown name`);
  }
  return new Set(names);
}

const tier2To1 = listFromRule(/原二档的([^；\n]+?)迁到一费/, '原二档→一费');
const tier3To2 = listFromRule(/原三档的([^；\n]+?)迁到二费/, '原三档→二费');
const tier4To3 = listFromRule(/原四档的([^；\n]+?)迁到三费/, '原四档→三费');
const fiveCostNames = listFromRule(/五费名单：([^。\n]+)。/, '五费名单');
const tier6To4 = listFromRule(/原六档的([^；\n]+?)迁到四费/, '原六档→四费');
const specialSkillIds = new Map([
  ['万顷', 'skchr_wanqin_2'],
  ['白金', 'skchr_platnm_2'],
  ['灰毫', 'skchr_ashlok_2'],
  ['奥斯塔', 'skchr_aosta_2'],
  ['贾维', 'skchr_chiave_2'],
]);
const designedPassiveName = '正义骑士号';
function newCost(operator) {
  switch (operator.tier) {
    case 1: return 1;
    case 2: return tier2To1.has(operator.name) ? 1 : 2;
    case 3: return tier3To2.has(operator.name) ? 2 : 3;
    case 4: return tier4To3.has(operator.name) ? 3 : operator.name === '魔王' ? 5 : 4;
    case 5: return fiveCostNames.has(operator.name) ? 5 : 4;
    case 6: return tier6To4.has(operator.name) ? 4 : 5;
    default: throw new Error(`Unsupported source tier ${operator.tier} for ${operator.name}`);
  }
}
function skillFields(skill) {
  return {
    skillId: skill.skillId,
    index: skill.index,
    name: skill.name,
    desc: skill.desc,
    descRaw: skill.descRaw ?? null,
    skillType: skill.skillType ?? null,
    spType: skill.spType ?? null,
    spCost: skill.spCost ?? null,
    initSp: skill.initSp ?? null,
    duration: skill.duration ?? null,
    durationType: skill.durationType ?? null,
    bb: skill.bb ?? null,
    bbStr: skill.bbStr ?? null,
    trigger: skill.trigger ?? null,
    maxChargeTime: skill.maxChargeTime ?? null,
    increment: skill.increment ?? null,
    rangeId: skill.rangeId ?? null,
    rangeGrid: skill.rangeGrid ?? null,
    isDefault: skill.isDefault === true,
  };
}
const normalFields = [
  'chessId', 'baseId', 'goldenId', 'isGolden', 'tier', 'charId', 'name', 'appellation',
  'profession', 'subProfessionId', 'subProfessionName', 'position', 'nationId', 'bonds', 'garrisonIds',
  'stats', 'immunities', 'rangeId', 'rangeGrid', 'dmgType', 'attackKind', 'projectile', 'canHitFly',
  'targetPriority', 'trait', 'talents', 'tokens', 'assets', 'skill', 'skills',
];
function pickSourceNormal(chess) {
  return Object.fromEntries(normalFields.filter((key) => Object.hasOwn(chess, key)).map((key) => [
    key, key === 'skills' ? chess.skills.map(skillFields) : chess[key],
  ]));
}

const charIds = operators.map((operator) => operator.charId);
if (new Set(charIds).size !== 154) throw new Error('Roster charId is not unique for all 154 operators');
const records = operators.map((operator, sourceOrder) => {
  const normalChess = chessById[operator.chessId];
  if (!normalChess || normalChess.charId !== operator.charId || normalChess.isGolden) throw new Error(`Normal chess mismatch: ${operator.name}/${operator.chessId}`);
  const sourceSkills = normalChess.skills ?? [];
  const defaultSkills = sourceSkills.filter((skill) => skill.isDefault === true);
  const currentWorkshopDefaultIndex = defaultSkills.length === 1 ? defaultSkills[0].index : null;
  const isDesignedPassive = operator.name === designedPassiveName;
  if (isDesignedPassive) {
    if (sourceSkills.length !== 0 || normalChess.skill !== null) throw new Error('Justice Knight source unexpectedly has a native skill');
  } else if (defaultSkills.length !== 1) {
    throw new Error(`Expected one current default skill for ${operator.name}, found ${defaultSkills.length}`);
  }
  const specialSkillId = specialSkillIds.get(operator.name) ?? null;
  let proposedFixedSkillIndex = currentWorkshopDefaultIndex;
  if (specialSkillId) {
    const specialSkill = sourceSkills.find((skill) => skill.skillId === specialSkillId);
    if (!specialSkill || specialSkill.index !== 1) throw new Error(`${operator.name} expected dedicated second skill ${specialSkillId}`);
    proposedFixedSkillIndex = specialSkill.index;
  }
  if (specialSkillId && operator.skills?.[1] !== specialSkillId) throw new Error(`${operator.name} design reference does not list ${specialSkillId} as second skill`);
  const fields = pickSourceNormal(normalChess);
  return {
    sourceOrder,
    charId: operator.charId,
    name: operator.name,
    chessId: operator.chessId,
    newCost: newCost(operator),
    sourceTier: operator.tier,
    sourceCommit: frozen.sourceCommit,
    sourceFactions: {
      nativeFactionTags: operator.nativeFactionTags ?? [],
      nativeBondIds: normalChess.bonds ?? [],
    },
    sourceNormalChess: fields,
    skillOptions: sourceSkills.map(skillFields),
    currentWorkshopDefaultIndex,
    currentWorkshopDefaultSkillId: currentWorkshopDefaultIndex === null ? null : sourceSkills.find((skill) => skill.index === currentWorkshopDefaultIndex)?.skillId ?? null,
    proposedFixedSkillIndex,
    proposedFixedSkillId: proposedFixedSkillIndex === null ? null : sourceSkills.find((skill) => skill.index === proposedFixedSkillIndex)?.skillId ?? null,
    proposedChange: specialSkillId ? 'use the explicitly requested dedicated second native skill' : 'retain the current workshop default index',
    requiresDesignedPassive: isDesignedPassive,
  };
});
const tierCounts = Object.fromEntries([1,2,3,4,5].map((cost) => [cost, records.filter((record) => record.newCost === cost).length]));
if (JSON.stringify(Object.values(tierCounts)) !== JSON.stringify([23,33,40,38,20])) throw new Error(`New cost distribution mismatch: ${JSON.stringify(tierCounts)}`);
if (specialSkillIds.size !== 5 || [...specialSkillIds].some(([name, skillId]) => !records.some((record) => record.name === name && record.proposedFixedSkillId === skillId && record.proposedFixedSkillIndex === 1))) throw new Error('Dedicated second-skill selection mismatch');
if (records.filter((record) => record.requiresDesignedPassive).length !== 1 || records.find((record) => record.requiresDesignedPassive)?.name !== designedPassiveName) throw new Error('Designed passive placeholder mismatch');

const output = {
  schema: 'stronghold.resonance-roster-worktable/v1',
  status: 'derived-worktable-awaiting-deep-design-and-simulation',
  sourceCommit: frozen.sourceCommit,
  sources: {
    frozenExistingGame: 'docs/resonance/reference/existing-game.json',
    frozenExistingGameCommit: frozen.sourceCommit,
    designRules: 'docs/resonance/design.md',
    sourceRosterPath: frozen.records['independent-design'].sourcePath,
    nativeChessPath: frozen.records.chess.sourcePath,
  },
  migrationRules: {
    sourceTierToNewCost: 'Mechanically parsed from the fee mapping in docs/resonance/design.md; source tiers are retained on every row.',
    tier2To1: [...tier2To1], tier3To2: [...tier3To2], tier4To3: [...tier4To3],
    tier4MaowangTo5: '魔王', fiveCostNames: [...fiveCostNames], tier6To4: [...tier6To4],
  },
  coverage: {
    operators: records.length,
    uniqueCharIds: new Set(records.map((record) => record.charId)).size,
    tiers: tierCounts,
    skillOptions: records.reduce((sum, record) => sum + record.skillOptions.length, 0),
    specialSecondSkills: Object.fromEntries(specialSkillIds),
    requiresDesignedPassive: records.filter((record) => record.requiresDesignedPassive).map((record) => ({ charId: record.charId, name: record.name })),
  },
  note: 'Derived analysis worktable only. Final fixed skills, costs, stat rebalance, star effects, bonds and simulation outcomes remain subject to deep design; this file is not a production configuration or alternate rules source.',
  operators: records,
};

const cell = (value) => String(value ?? '—').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
const markdown = [
  '# 共鸣干员费用与技能工作表', '',
  '> 这是由冻结工坊参考与 `docs/resonance/design.md` 机械生成的派生工作表，供设计逐项核定，不是最终玩法或生产配置真源。属性重平衡、星级效果、盟约与技能数值仍需深度设计及推演。', '',
  `来源版本：现有干员参考 Git commit \`${frozen.sourceCommit}\`；费用映射读取 \`${output.sources.designRules}\`。干员 ${records.length} 名，费用分布 ${Object.entries(tierCounts).map(([cost,count]) => `${cost}费 ${count}`).join(' / ')}；原生技能选项合计 ${output.coverage.skillOptions} 个。`,
  `固定技能提议：${[...specialSkillIds].map(([name,id]) => `${name} → \`${id}\`（专属第二技能）`).join('；')}。正义骑士号无原生技能，标记为需要设计被动，不生成伪造技能。`, '',
  ...[1,2,3,4,5].flatMap((cost) => {
    const rows = records.filter((record) => record.newCost === cost);
    return [`## ${cost} 费（${rows.length} 名）`, '', '| 干员 | charId | 原档 | 当前默认技能 | 其他原生技能选项 | 固定技能提议 | 原始阵营标签 |', '|---|---|---:|---|---|---|---|',
      ...rows.map((record) => {
        const defaultSkill = record.currentWorkshopDefaultSkillId ? record.skillOptions.find((skill) => skill.skillId === record.currentWorkshopDefaultSkillId) : null;
        const alternatives = record.skillOptions.filter((skill) => skill.skillId !== record.currentWorkshopDefaultSkillId).map((skill) => `${skill.name}（${skill.skillId}，index ${skill.index}）`).join('；') || '无';
        const proposal = record.requiresDesignedPassive ? '待设计：补充固定被动' : `${record.proposedFixedSkillId}（index ${record.proposedFixedSkillIndex}${record.proposedFixedSkillId !== record.currentWorkshopDefaultSkillId ? '，专属第二技能' : '，保留当前默认'}）`;
        const factionTags = [...record.sourceFactions.nativeFactionTags, ...record.sourceFactions.nativeBondIds.map((id) => `bond:${id}`)].join('、');
        return `| ${cell(record.name)} | \`${record.charId}\` | ${record.sourceTier} | ${defaultSkill ? `${cell(defaultSkill.name)}（${defaultSkill.skillId}，index ${defaultSkill.index}）` : '无原生技能'} | ${cell(alternatives)} | ${cell(proposal)} | ${cell(factionTags)} |`;
      }), ''];
  }),
  '## 核对说明', '',
  '- JSON 为每名干员保留必要的原生普通形态字段、全部技能选项及原始描述/BB、原生天赋、属性、射程、职业、子职业、阵营关系与资源标识。源字段未被新费用或技能提议覆盖。',
  '- `currentWorkshopDefaultIndex` 来自该普通棋子源技能的 `isDefault`；除正义骑士号外均要求恰有一个。非五名特殊干员的固定技能提议沿用该 index。',
  '- `sourceFactions` 同时保留工坊设计记录中的原生阵营标签和普通棋子原生 bond ID；未来共鸣阵营标签由后续设计确定。',
  '- 本表没有生成未定属性、升星数值或技能效果，也没有复制素材、运行数据或依赖。', '',
].join('\n');

writeFileSync(JSON_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
writeFileSync(MD_PATH, markdown, 'utf8');
console.log(JSON.stringify({ jsonPath: JSON_PATH, markdownPath: MD_PATH, sourceCommit: frozen.sourceCommit, operators: records.length, uniqueCharIds: output.coverage.uniqueCharIds, tierCounts, skillOptions: output.coverage.skillOptions, specialSecondSkills: output.coverage.specialSecondSkills, designedPassive: output.coverage.requiresDesignedPassive }, null, 2));
