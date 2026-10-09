import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_REPO = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const SOURCE_COMMIT = '4ed1ad32ec10da15c23f9d7939dade603950759b';
const FILES = [
  'chess', 'bonds', 'items', 'choices', 'bands', 'garrisons', 'effects', 'factions',
  'native-factions', 'native-skill-trigger-source', 'independent-design',
  'independent-game-text', 'independent-native-power', 'independent-source-reference',
  'independent-roster-plan', 'independent-darkmoon-design-addon',
  'independent-darkmoon-game-text-addon',
];

function readSource(name) {
  const sourcePath = `data/${name}.json`;
  const raw = execFileSync('git', ['-C', SOURCE_REPO, 'show', `${SOURCE_COMMIT}:${sourcePath}`], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

const source = Object.fromEntries(FILES.map((name) => [name, readSource(name)]));
const nativeOperators = source['native-factions'].operators;
const nativeIds = new Set(nativeOperators.map((operator) => operator.charId));
const designOperators = source['independent-design'].operators;
const compatibilityOperators = designOperators.filter((operator) => !nativeIds.has(operator.charId));
const chessEntries = Object.values(source.chess);
const perOperator = nativeOperators.map((operator) => {
  const forms = chessEntries.filter((entry) => entry.charId === operator.charId);
  const normal = forms.filter((entry) => entry.isGolden === false);
  const elite = forms.filter((entry) => entry.isGolden === true);
  const missing = [];
  if (!normal.length) missing.push('normal-form');
  if (!elite.length) missing.push('elite-form');
  for (const [label, entries] of [['normal', normal], ['elite', elite]]) {
    if (entries.some((entry) => !Array.isArray(entry.skills))) missing.push(`${label}-skills`);
    if (entries.some((entry) => !Array.isArray(entry.talents))) missing.push(`${label}-talents`);
    if (entries.some((entry) => !entry.nativeGrowth)) missing.push(`${label}-attributes`);
  }
  return {
    charId: operator.charId,
    name: operator.name,
    normalChessIds: normal.map((entry) => entry.chessId),
    eliteChessIds: elite.map((entry) => entry.chessId),
    complete: missing.length === 0,
    missing,
  };
});

const records = Object.fromEntries(FILES.map((name) => [name, {
  sourcePath: `data/${name}.json`,
  data: source[name],
}]));
const valuesAt = (groups, field) => [...new Set(groups.flatMap((group) => Object.values(group ?? {})
  .map((entry) => entry?.[field]).filter((value) => typeof value === 'string' && value.length)))].sort();
const choiceGroups = Object.entries(source.choices)
  .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
  .map(([, value]) => value);
const output = {
  schema: 'stronghold.existing-game-reference/v1',
  sourceCommit: SOURCE_COMMIT,
  sourceRepository: SOURCE_REPO,
  generatedBy: 'tools/resonance/export-existing.mjs',
  sourcePaths: FILES.map((name) => `data/${name}.json`),
  coverage: {
    workshopActiveRoster: nativeOperators.length,
    compatibilityDesignEntries: compatibilityOperators.length,
    designEntries: designOperators.length,
    nativeRosterComplete: perOperator.filter((entry) => entry.complete).length,
    nativeRosterIncomplete: perOperator.filter((entry) => !entry.complete).length,
    workshopActiveMissing: perOperator.filter((entry) => !entry.complete).map((entry) => ({
      charId: entry.charId, name: entry.name, missing: entry.missing,
    })),
    nativeFormsWithSkillsTalentsAttributes: perOperator,
    classification: 'Active roster = charIds in native-factions. Compatibility = design operators whose charIds are absent from native-factions.',
    limitations: [
      'Native roster skill/talent/attribute coverage is resolved from chess forms. An explicitly empty skills array is retained as authored and is not treated as missing. Any unavailable source record is listed in workshopActiveMissing; no gameplay effects are inferred.',
      'Native source metadata and trigger tables are preserved as authored in their source files; this export does not add upstream assets or runtime data.',
    ],
    categories: {
      professions: [...new Set(chessEntries.map((entry) => entry.profession).filter(Boolean))].sort(),
      bondIds: Object.keys(source.bonds),
      bondTypes: [...new Set(Object.values(source.bonds).map((entry) => entry.bondType).filter(Boolean))].sort(),
      bandIds: Object.keys(source.bands),
      bandEffectIds: [...new Set(Object.values(source.bands).map((entry) => entry.effectId).filter(Boolean))].sort(),
      garrisonIds: Object.keys(source.garrisons),
      garrisonEventTypes: [...new Set(Object.values(source.garrisons).map((entry) => entry.eventType).filter(Boolean))].sort(),
      garrisonEffectTypes: [...new Set(Object.values(source.garrisons).map((entry) => entry.effectType).filter(Boolean))].sort(),
      itemIds: Object.keys(source.items),
      itemTypes: [...new Set(Object.values(source.items).map((entry) => entry.itemType).filter(Boolean))].sort(),
      choiceTypes: valuesAt(choiceGroups, 'choiceType'),
      choiceEffectTypes: valuesAt(choiceGroups, 'effectType'),
      choiceFamilies: valuesAt(choiceGroups, 'family'),
      effectIds: Object.keys(source.effects),
      effectTypes: [...new Set(Object.values(source.effects).map((entry) => entry.effectType).filter(Boolean))].sort(),
      factionSections: Object.keys(source.factions),
    },
  },
  records,
};

const jsonPath = resolve(REPO_ROOT, 'docs/resonance/reference/existing-game.json');
const markdownPath = resolve(REPO_ROOT, 'docs/resonance/reference/existing-game.md');
mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(output)}\n`, 'utf8');
const lines = [
  '# Existing game reference',
  '',
  `- Source commit: \`${SOURCE_COMMIT}\``,
  `- Source repository: \`${SOURCE_REPO}\``,
  `- Active workshop roster: ${output.coverage.workshopActiveRoster}`,
  `- Compatibility design entries: ${output.coverage.compatibilityDesignEntries}`,
  `- Design entries: ${output.coverage.designEntries}`,
  `- Active roster with normal and elite skills, talents, and native growth attributes: ${output.coverage.nativeRosterComplete}/${output.coverage.workshopActiveRoster}`,
  `- Missing records: ${output.coverage.workshopActiveMissing.length}`,
  '',
  'The JSON retains the complete source objects for workshop forms, native roster metadata, designs, player facing text, native power records, strategy choices, bonds, bands, garrisons, equipment, effects, and faction classifications. Source fields are preserved as authored; derived coverage is limited to roster resolution and category enumeration.',
  '',
  '## Source files',
  ...FILES.map((name) => `- \`data/${name}.json\``),
  '',
  '## Missing active roster records',
  ...(output.coverage.workshopActiveMissing.length
    ? output.coverage.workshopActiveMissing.map((entry) => `- ${entry.charId} ${entry.name}: ${entry.missing.join(', ')}`)
    : ['- None']),
  '',
  '## Enumerated categories',
  ...['professions', 'bondTypes', 'itemTypes', 'choiceTypes', 'choiceEffectTypes', 'choiceFamilies', 'garrisonEventTypes', 'garrisonEffectTypes', 'effectTypes']
    .map((category) => `- ${category}: ${output.coverage.categories[category].join(', ')}`),
  `- IDs retained in JSON: ${['bondIds', 'bandIds', 'bandEffectIds', 'garrisonIds', 'itemIds', 'effectIds'].map((category) => `${category} ${output.coverage.categories[category].length}`).join('; ')}`,
  '',
];
writeFileSync(markdownPath, lines.join('\n'), 'utf8');
console.log(JSON.stringify({
  jsonPath,
  markdownPath,
  sourceCommit: SOURCE_COMMIT,
  workshopActiveRoster: output.coverage.workshopActiveRoster,
  compatibilityDesignEntries: output.coverage.compatibilityDesignEntries,
  designEntries: output.coverage.designEntries,
  nativeRosterComplete: output.coverage.nativeRosterComplete,
  nativeRosterIncomplete: output.coverage.nativeRosterIncomplete,
  missing: output.coverage.workshopActiveMissing,
  categoryCounts: Object.fromEntries(Object.entries(output.coverage.categories).map(([key, values]) => [key, values.length])),
}, null, 2));
