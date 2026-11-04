#!/usr/bin/env node
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const INPUT = path.join(CANONICAL, 'data/resonance-reference/tft-set13-14.23.json');
const DOC = path.join(ROOT, 'docs/resonance/reference/tft-set13-14.23.md');
const SOURCE_URL = 'https://raw.communitydragon.org/14.23/cdragon/tft/en_us.json';
const RELEASE = 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/into-the-arcane-overview/';
const PATCH_NOTES = 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-14-23-notes/';
const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`source HTTP ${response.status}: ${url}`);
  return response.json();
};
const costVector = (units) => Object.fromEntries([1, 2, 3, 4, 5].map(cost => [cost, units.filter(unit => unit.cost === cost).length]));
const apiPrefixCounts = (rows) => Object.fromEntries([...rows.reduce((counts, row) => {
  const prefix = String(row.apiName).split('_').slice(0, 2).join('_');
  counts.set(prefix, (counts.get(prefix) || 0) + 1);
  return counts;
}, new Map())].sort(([a], [b]) => a.localeCompare(b)));
const safeText = (value = '') => String(value).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const mdTable = (headers, rows) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(value => String(value ?? '').replaceAll('|', '\\|')).join(' | ')} |`)].join('\n');

function build(raw) {
  const set = raw.sets?.['13'];
  const setData = raw.setData?.find(row => Number(row.number) === 13);
  if (!set || !setData) throw new Error('CDragon Set 13 payload is missing');
  const naturalChampions = set.champions
    .filter(unit => /^TFT13_/.test(unit.apiName || '') && Number.isInteger(unit.cost) && unit.cost >= 1 && unit.cost <= 5 && unit.traits?.length)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  const naturalTraitRows = set.traits.filter(trait => /^TFT13_(?!Teamup_)/.test(trait.apiName || ''));
  const teamUpTraitRows = set.traits.filter(trait => /^TFT13_Teamup_/.test(trait.apiName || ''));
  const naturalTraits = naturalTraitRows.map(trait => {
    const members = naturalChampions.filter(champion => champion.traits.includes(trait.name));
    return { ...trait, naturalMemberApiNames: members.map(member => member.apiName), naturalMemberNames: members.map(member => member.name), memberCount: members.length, feeDistribution: costVector(members) };
  });
  const itemByApiName = new Map(raw.items.map(item => [item.apiName, item]));
  const resolveSetList = (ids, label) => ids.map(id => {
    const value = itemByApiName.get(id);
    if (!value) throw new Error(`${label} reference unresolved: ${id}`);
    return value;
  });
  const equipmentCandidates = resolveSetList(setData.items, 'Set 13 item');
  const augmentCandidates = resolveSetList(setData.augments, 'Set 13 augment');
  if (naturalChampions.length !== 60 || naturalTraits.length !== 26 || teamUpTraitRows.length !== 7 || equipmentCandidates.length !== 284 || augmentCandidates.length !== 308) {
    throw new Error(`unexpected Set 13 extraction counts: champions=${naturalChampions.length}, traits=${naturalTraits.length}, teamups=${teamUpTraitRows.length}, items=${equipmentCandidates.length}, augments=${augmentCandidates.length}`);
  }
  for (const champion of naturalChampions) for (const traitName of champion.traits) {
    if (!naturalTraits.some(trait => trait.name === traitName)) throw new Error(`natural trait join failed: ${champion.name} -> ${traitName}`);
  }
  return {
    provenance: {
      season: 'Into the Arcane', setNumber: 13, releasePatch: '14.23', locale: 'en_us',
      fetchedAt: new Date().toISOString(),
      sourceUrl: SOURCE_URL,
      sourceType: 'CommunityDragon extracted game-client data; version pinned by URL, unofficial mirror, not a Riot-published public roster API',
      primarySeasonSource: RELEASE,
      primaryPatchSource: PATCH_NOTES,
      extraction: 'Fetched the 14.23 en_us CDragon payload in memory; selected sets["13"], plus only the item and augment apiName references listed by setData[number=13]. Natural champions are apiName TFT13_* with cost 1..5 and at least one native trait. Natural traits are TFT13_* excluding TFT13_Teamup_*; Team-Up traits are preserved separately as conditional mechanic candidates.',
      excluded: 'No other setData rows, other sets, or unreferenced top-level items included. Excluded neutral PvE encounters, cost-8 loot/anvil/chest entries, and cost-11 summoned/encounter entities from the natural champion pool.',
    },
    schema: {
      champions: 'Complete CDragon Set13 champion rows, including name/apiName/cost/traits/stats/ability and client asset identifiers.',
      traits: '26 naturally assigned traits, complete CDragon rows with desc and effects[{minUnits,maxUnits,style,variables}], plus joined natural membership and fee distribution.',
      conditionalTeamUpTraits: '7 separately preserved TFT13_Teamup_* rows; they are not in natural champion trait memberships and require conditional Team-Up activation.',
      equipmentCandidates: 'Exactly setData[number=13].items references resolved to top-level item rows; includes carried-forward items when listed as Set 13 members, excludes items absent from this Set 13 list.',
      augmentCandidates: 'Exactly setData[number=13].augments references resolved to top-level item rows; includes returning augments when listed as Set 13 members, excludes all unreferenced augments.',
    },
    summary: {
      naturalChampionCount: naturalChampions.length,
      naturalChampionFeeDistribution: costVector(naturalChampions),
      naturalTraitCount: naturalTraits.length,
      teamUpTraitCount: teamUpTraitRows.length,
      equipmentCandidateCount: equipmentCandidates.length,
      equipmentApiPrefixCounts: apiPrefixCounts(equipmentCandidates),
      equipmentEntriesMissingNameOrDescription: equipmentCandidates.filter(row => !row.name || !row.desc).map(row => ({ apiName: row.apiName, missing: ['name', 'desc'].filter(key => !row[key]) })),
      augmentCandidateCount: augmentCandidates.length,
      augmentApiPrefixCounts: apiPrefixCounts(augmentCandidates),
      augmentEntriesMissingNameOrDescription: augmentCandidates.filter(row => !row.name || !row.desc).map(row => ({ apiName: row.apiName, missing: ['name', 'desc'].filter(key => !row[key]) })),
    },
    naturalChampions,
    naturalTraits,
    conditionalTeamUpTraits: teamUpTraitRows,
    equipmentCandidates,
    augmentCandidates,
  };
}

function documentation(data) {
  const championRows = data.naturalChampions.map(unit => [unit.cost, unit.name, unit.traits.join(', '), unit.ability?.name, safeText(unit.ability?.desc), JSON.stringify(unit.stats), JSON.stringify(unit.ability?.variables ?? [])]);
  const traitRows = data.naturalTraits.map(trait => [trait.name, trait.memberCount, Object.values(trait.feeDistribution).join('/'), trait.effects.map(effect => effect.minUnits).join('/'), trait.naturalMemberNames.join(', '), safeText(trait.desc)]);
  const traitEffects = data.naturalTraits.flatMap(trait => trait.effects.map(effect => [trait.name, effect.minUnits, effect.maxUnits, effect.style, JSON.stringify(effect.variables)]));
  const teamups = data.conditionalTeamUpTraits.map(trait => `- **${trait.name}** (${trait.apiName}, ${trait.effects.map(effect => effect.minUnits).join('/')}): ${safeText(trait.desc)}\n  Effects: \`${JSON.stringify(trait.effects)}\``).join('\n');
  const candidateRows = rows => rows.map(row => [row.name ?? 'Missing in client data', row.apiName, safeText(row.desc) || 'Missing in client data', JSON.stringify(row.effects), (row.composition ?? []).join(', '), String(row.unique ?? false)]);
  return `# TFT Set 13: Into the Arcane — Patch 14.23 reference\n\n`+
    `This is a fixed Set 13 launch-patch extraction, not a cross-set comparison. Riot's official overview says the set launched with patch 14.23; Riot's 14.24 notes later introduce Viktor, Mel, and Warwick as 6-cost units. The natural Set 13 pool below therefore excludes those later units.\n\n`+
    `- Natural roster: **${data.summary.naturalChampionCount}**; fee distribution 1/2/3/4/5 = **${Object.values(data.summary.naturalChampionFeeDistribution).join('/')}**.\n`+
    `- Natural traits: **${data.summary.naturalTraitCount}**; Set 13 conditional Team-Up traits: **${data.summary.teamUpTraitCount}**.\n`+
    `- Set 13 referenced item candidates: **${data.summary.equipmentCandidateCount}**; augment candidates: **${data.summary.augmentCandidateCount}**. Returning items/augments are included only when referenced by Set 13's own setData row.\n`+
    `- Full raw stats, ability variables, trait tier effects/variables, item and augment records are in the canonical JSON input.\n\n`+
    `## Natural roster\n\nThe full client variable arrays are preserved in their original order. Runtime expressions such as \`@ModifiedDamage@\` require the client formula and actual unit state; they are retained rather than guessed.\n\n${mdTable(['Cost', 'Hero', 'Natural traits', 'Ability', 'Ability text', 'Stats (source JSON)', 'Ability variables (source JSON)'], championRows)}\n\n`+
    `## Natural trait roster and effects\n\n`+
    `Fee vectors use cost order 1/2/3/4/5. Tiers are the exact effects.minUnits sequence. Effect details and variables are retained in the JSON.\n\n`+
    `${mdTable(['Trait', 'Members', 'Fee vector', 'Tiers', 'Natural members', 'Mechanic'], traitRows)}\n\n`+
    `### Every natural trait tier\n\nBoth bounds are authoritative. The exact-count Emissary tier must not stay active between its one-unit and four-unit conditions. Unnamed client keys are preserved and are not assigned invented meanings.\n\n${mdTable(['Trait', 'Minimum units', 'Maximum units', 'Client tier style', 'Effect variables (source JSON)'], traitEffects)}\n\n`+
    `## Conditional Team-Up traits\n\n${teamups}\n\n`+
    `## Equipment and augment candidate scope\n\n`+
    `- Items are selected by exact membership in \`setData[number=13].items\`, then resolved by apiName against the CDragon items table. API prefix counts: \`${JSON.stringify(data.summary.equipmentApiPrefixCounts)}\`. This preserves the actual launch-set pool, including returning items that are still members of Set 13, without importing unrelated item records from other sets. Missing item display fields (preserved as null, not guessed): \`${JSON.stringify(data.summary.equipmentEntriesMissingNameOrDescription)}\`.\n`+
    `- Augments are selected by exact membership in \`setData[number=13].augments\`, then resolved by apiName. API prefix counts: \`${JSON.stringify(data.summary.augmentApiPrefixCounts)}\`. Prefix identifies original content family, not the active set; set membership is the filter. Missing display fields: \`${JSON.stringify(data.summary.augmentEntriesMissingNameOrDescription)}\`.\n\n`+
    `### Every Set 13 equipment record\n\nMissing fields remain explicit. A record in this reference is not a claim that it is craftable or selectable in 共鸣.\n\n${mdTable(['Name', 'Client identifier', 'Effect text', 'Effect variables (source JSON)', 'Composition', 'Unique'], candidateRows(data.equipmentCandidates))}\n\n`+
    `### Every Set 13 augment record\n\nReturning augments are included by Set 13 membership. Full source effects are shown even when a mode adaptation has not selected the augment. Global starting encounters and the Anomaly are described separately in [Set 13 global mechanics](set13-global-mechanics.md).\n\n${mdTable(['Name', 'Client identifier', 'Effect text', 'Effect variables (source JSON)', 'Composition', 'Unique'], candidateRows(data.augmentCandidates))}\n\n`+
    `## Provenance and limits\n\n`+
    `- CommunityDragon pinned 14.23 payload: <${data.provenance.sourceUrl}>. It is an extracted client-data mirror, not an official Riot data endpoint.\n`+
    `- Riot launch overview: <${data.provenance.primarySeasonSource}>. Riot patch 14.23 notes: <${data.provenance.primaryPatchSource}>.\n`+
    `- Riot's public article is primary evidence for launch timing and the examples it names, but does not expose a full machine-readable list of all 60 heroes and 26 trait effects. Completeness here is supported by the exact-version client extraction and join/count checks, not by claiming Riot's public page individually confirms every row.\n`;
}

async function main() {
  if (process.argv.includes('--documentation-only')) {
    const data = JSON.parse(await readFile(INPUT, 'utf8'));
    const markdown = documentation(data);
    await writeFile(DOC, markdown, 'utf8');
    process.stdout.write(`${JSON.stringify({ input: INPUT, inputRole: 'read-only canonical client reference', documentation: DOC, documentationRole: 'complete source effect reference', documentationBytes: Buffer.byteLength(markdown), naturalChampions: data.naturalChampions.length, naturalTraitTiers: data.naturalTraits.reduce((total, trait) => total + trait.effects.length, 0), equipmentRecords: data.equipmentCandidates.length, augmentRecords: data.augmentCandidates.length })}\n`);
    return;
  }
  const raw = await fetchJson(SOURCE_URL);
  const data = build(raw);
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const markdown = documentation(data);
  const jsonHandle = await open(INPUT, 'wx');
  try { await jsonHandle.writeFile(json, 'utf8'); } finally { await jsonHandle.close(); }
  const docHandle = await open(DOC, 'wx');
  try { await docHandle.writeFile(markdown, 'utf8'); } finally { await docHandle.close(); }
  process.stdout.write(`${JSON.stringify({ input: INPUT, inputBytes: Buffer.byteLength(json), documentation: DOC, documentationBytes: Buffer.byteLength(markdown), naturalChampions: data.summary.naturalChampionCount, naturalChampionFeeDistribution: data.summary.naturalChampionFeeDistribution, naturalTraits: data.summary.naturalTraitCount, teamUpTraits: data.summary.teamUpTraitCount, equipmentCandidates: data.summary.equipmentCandidateCount, augmentCandidates: data.summary.augmentCandidateCount, equipmentEntriesMissingNameOrDescription: data.summary.equipmentEntriesMissingNameOrDescription, augmentEntriesMissingNameOrDescription: data.summary.augmentEntriesMissingNameOrDescription, itemApiPrefixCounts: data.summary.equipmentApiPrefixCounts, augmentApiPrefixCounts: data.summary.augmentApiPrefixCounts })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
