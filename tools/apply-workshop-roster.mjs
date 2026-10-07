#!/usr/bin/env node
// Compile the named 19.2 Battlegrounds roster against the immutable source snapshot.
// Source text is copied verbatim into metadata; this compiler emits authored rules keyed by
// source card id. Runtime code must consume these records, never parse localized card text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const args = Object.fromEntries(process.argv.slice(2).map((x, i, a) => x.startsWith('--') ? [x.slice(2), a[i + 1]] : null).filter(Boolean));
const rosterPath = path.resolve(args.roster || path.join(repo, '..', 'growth-destination-20261008', 'data', 'independent-roster-plan.json'));
const sourcePath = path.resolve(args.source || 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/bg-translation-20261007/darkmoon-candidate-inventory.json');
const outPath = path.resolve(args.out || path.join(repo, 'data', 'independent-darkmoon-blueprints.json'));
const reportPath = path.resolve(args.report || 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/darkmoon/blueprint-coverage.json');

const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const byName = new Map(source.cards.map(c => [c.name_zh, c]));
// Explicit source-id keyed semantic rules for mechanics where a tempting generic
// implementation would materially change the original target or trigger scope.
const SOURCE_RULES = Object.freeze({
  BGS_043: {
    mechanic: 'lastWarbandRecruit',
    adaptation: { trigger: 'gainOnce', recipient: 'hand', duration: 'untilPlayedOrSold', source: 'randomFriendlyOperatorFromPreviousRound' },
    status: 'unsupported', reason: 'No PvP opponent warband exists in this co-op mode; implement the approved previous-round friendly copy source, never an invented enemy.'
  },
  DAL_575: {
    mechanic: 'summonMultiplier',
    normal: { trigger: 'summon', recipient: 'combatBoardSummons', multiplier: 2 },
    elite: { trigger: 'summon', recipient: 'combatBoardSummons', multiplier: 3 },
    status: 'unsupported', reason: 'This multiplies summoned units; it must not copy, duplicate, or grant equipment/badges.'
  },
  LOE_077: {
    mechanic: 'battlecryMultiplier',
    normal: { trigger: 'battlecryOnGain', recipient: 'originalBattlecryOutput', multiplier: 2 },
    elite: { trigger: 'battlecryOnGain', recipient: 'originalBattlecryOutput', multiplier: 3 },
    status: 'unsupported', reason: 'Only the source minion Battlecry output repeats on recruitment; unrelated gain hooks do not.'
  },
  FP1_031: {
    mechanic: 'deathrattleMultiplier',
    normal: { trigger: 'retiringEffect', recipient: 'deathrattleOutputs', multiplier: 2 },
    elite: { trigger: 'retiringEffect', recipient: 'deathrattleOutputs', multiplier: 3 },
    status: 'unsupported', reason: 'Only eligible retiring/deathrattle outputs repeat; this does not multiply all combat gains.'
  }
});

function triggerOf(text) {
  if (/Start of Combat/i.test(text)) return 'combatStart';
  if (/Deathrattle/i.test(text)) return 'death';
  if (/Battlecry/i.test(text)) return 'battlecry';
  if (/Overkill/i.test(text)) return 'overkill';
  if (/At the end of your turn/i.test(text)) return 'turnEnd';
  if (/At the start of (?:each|your) turn/i.test(text)) return 'turnStart';
  if (/When this attacks and kills|Whenever this attacks|After this attacks|whom it attacks/i.test(text)) return 'attack';
  if (/When you sell|After you buy|After you play|Whenever you play|Whenever you summon/i.test(text)) return 'prepEvent';
  if (/Whenever|After you|When you|When this|After this/i.test(text)) return 'conditionalEvent';
  if (/^\s*(?:\[x\])?(?:<[^>]+>\s*)+(?:\n|$)/i.test(text) || /<b>(?:Taunt|Divine Shield|Reborn|Poisonous|Windfury|Mega-Windfury)<\/b>/i.test(text)) return 'staticCombat';
  return 'combatPassive';
}
function recipientOf(text) {
  const t = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (/bob's tavern|tavern/.test(t)) return 'shop';
  if (/to your hand|add .* to your hand/.test(t)) return 'hand';
  if (/gain .* gold|your hero|upgrade bob|refresh/.test(t)) return 'playerResource';
  if (/left-most/.test(t)) return 'leftmostFriendly';
  if (/right-most/.test(t)) return 'rightmostFriendly';
  if (/adjacent|neighbors/.test(t)) return 'adjacentFriendly';
  if (/of each (?:minion )?type|different minion types/.test(t)) return 'onePerEligibleType';
  if (/all friendly minions|your minions|give all minions/.test(t)) return 'allFriendly';
  if (/your other (?:mechs|pirates|elementals)|your dragons|your beasts|friendly (?:mech|pirate|elemental|dragon|beast)s?/.test(t)) return 'eligibleFriendlyTribe';
  if (/another random friendly/.test(t)) return 'randomOtherFriendly';
  if (/random friendly/.test(t)) return 'randomFriendly';
  if (/another friendly/.test(t)) return 'otherFriendly';
  if (/friendly .* minion/.test(t)) return 'chosenFriendly';
  if (/friendly minion/.test(t)) return 'chosenFriendly';
  if (/this minion|this gets|gain \+|gain .* attack|gain .* health|this attacks/.test(t)) return 'self';
  if (/enemy minion|enemy/.test(t)) return 'enemy';
  if (/summon/.test(t)) return 'combatBoardSummon';
  return 'selfOrBoard';
}
function durationOf(text, recipient) {
  const t = text.toLowerCase();
  if (/rest of the game|permanently/.test(t)) return 'game';
  if (/this turn only|this turn/.test(t)) return 'turn';
  if (recipient === 'shop') return 'untilShopRefreshOrPurchase';
  if (recipient === 'playerResource') return /gold|cost|refresh/.test(t) ? 'turnOrNextUse' : 'game';
  if (recipient === 'hand') return 'untilPlayedOrSold';
  if (recipient === 'combatBoardSummon' || /start of combat|deathrattle|attacks|attack immediately|enemy minion|damage|taunt|divine shield|reborn|poisonous|windfury|overkill/.test(t)) return 'combat';
  if (/end of your turn|start of your turn|each turn|whenever you|after you play|whenever a friendly|after a friendly/.test(t)) return 'game';
  return 'game';
}
function parseEffect(card, variant) {
  const text = variant.text_en || '';
  const trigger = triggerOf(text);
  const recipient = recipientOf(text);
  const duration = durationOf(text, recipient);
  const tags = [];
  for (const [re, tag] of [[/Taunt/i,'taunt'],[/Divine Shield/i,'divineShield'],[/Reborn/i,'reborn'],[/Poisonous/i,'poison'],[/Windfury/i,'windfury'],[/Cleave|next to whom/i,'cleave'],[/Battlecry/i,'battlecry'],[/Deathrattle/i,'deathrattle']]) if (re.test(text)) tags.push(tag);
  // The source-specific effect is preserved as an authored per-id descriptor. This is
  // deliberately not marked executable until a matching native behavior is wired and tested.
  const kind = recipient === 'shop' || recipient === 'hand' || recipient === 'playerResource' ? 'resourceOrShopState' : /summon|deal .* damage|attacks immediately/i.test(text) ? 'combatBoardAction' : tags.some(x => ['taunt','divineShield','reborn','poison','windfury'].includes(x)) ? 'combatKeyword' : 'statOrCombatBuff';
  return { trigger, recipient, duration, kind, text: variant.text_zh || '', textEn: text, tags, implementation: 'unsupported', unsupportedReason: 'No source-id-specific native behavior has yet been implemented and exercised.' };
}

const entries = [];
const duplicates = new Set();
const missing = [];
for (const [tribe, group] of Object.entries(roster.groups)) {
  for (const [name, operator] of group.pairs) {
    const card = byName.get(name);
    if (!card) { missing.push(name); continue; }
    if (duplicates.has(card.id)) throw new Error(`duplicate source id ${card.id}`);
    duplicates.add(card.id);
    const normal = parseEffect(card, { text_en: card.text_en, text_zh: card.text_zh });
    const elite = parseEffect(card, card.golden || { text_en: card.text_en, text_zh: card.text_zh });
    entries.push({
      sourceId: card.id,
      dbfId: card.dbf_id,
      premiumId: card.golden?.id || null,
      premiumDbfId: card.premium_dbf_id || null,
      name: card.name_zh,
      nameEn: card.name_en,
      operator,
      rosterTribe: tribe,
      faction: group.faction,
      nationId: group.nationId,
      originalRaces: card.races,
      originalTier: card.tier,
      sourceVersion: source.source?.carddefs_xml?.match(/68600/) ? '19.2.0.68600' : roster.sourceBuild,
      sourceTexts: { normal: card.text_zh || '', elite: card.golden?.text_zh || card.text_zh || '' },
      sourceTextsEn: { normal: card.text_en || '', elite: card.golden?.text_en || card.text_en || '' },
      sourceUrl: `https://api.hearthstonejson.com/v1/68600/zhCN/cards.json`,
      metadata: { op: { effectDelivery: { normal: [normal], elite: [elite] } } },
      authoredRule: SOURCE_RULES[card.id] ? structuredClone(SOURCE_RULES[card.id]) : {
        sourceId: card.id,
        status: 'unsupported',
        reason: 'Needs a source-specific adapter rule and matching ordinary/elite trigger test.'
      },
      sourceEffect: {
        normal: { trigger: normal.trigger, recipient: normal.recipient, duration: normal.duration, text: normal.text },
        elite: { trigger: elite.trigger, recipient: elite.recipient, duration: elite.duration, text: elite.text }
      }
    });
  }
}
if (missing.length) throw new Error(`source names missing: ${missing.join(', ')}`);
entries.sort((a,b) => a.sourceId.localeCompare(b.sourceId));
const counts = Object.fromEntries(Object.entries(roster.groups).map(([k,v]) => [k, v.pairs.length]));
const report = {
  schema: 'stronghold.darkmoon-blueprint-coverage/v1',
  source: sourcePath,
  roster: rosterPath,
  rosterUniqueSourceCards: entries.length,
  expectedSourceCards: 101,
  counts,
  mainFactions: Object.fromEntries(Object.entries(roster.groups).filter(([k]) => k !== 'NEUTRAL').map(([k,v]) => [k, v.pairs.length])),
  neutral: counts.NEUTRAL,
  exactSourceBodyCoverage: entries.length === 101 && new Set(entries.map(x=>x.name)).size === 101 && new Set(entries.map(x=>x.sourceId)).size === 101,
  ordinaryAndEliteEffectsPresent: entries.every(x => x.metadata.op.effectDelivery.normal.length > 0 && x.metadata.op.effectDelivery.elite.length > 0),
  executableByNative: entries.filter(x => x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='supported') && x.metadata.op.effectDelivery.elite.every(e=>e.implementation==='supported')).length,
  unsupportedSourceIds: entries.filter(x=>x.metadata.op.effectDelivery.normal.some(e=>e.implementation!=='supported') || x.metadata.op.effectDelivery.elite.some(e=>e.implementation!=='supported')).map(x=>({id:x.sourceId,name:x.name,reason:x.metadata.op.effectDelivery.normal[0].unsupportedReason})),
  sourceSpecificSemanticRules: entries.filter(x=>SOURCE_RULES[x.sourceId]).map(x=>({id:x.sourceId,name:x.name,mechanic:x.authoredRule.mechanic,status:x.authoredRule.status})),
  caveats: ['This compiler records source text and an initial fixed-recipient interpretation; it does not claim mechanics execution.', 'Text-derived descriptors are compile-time metadata only; runtime must use source-id-keyed authored rules, never parse localized source text.', 'All entries remain unsupported until a matching native behavior is wired and ordinary/elite trigger, target, duration, and reset are tested.']
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ schema:'stronghold.darkmoon-blueprints/v1', sourceBuild: roster.sourceBuild, rosterCommit: roster.sourceCommit, entries }, null, 2) + '\n');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ blueprint: outPath, report: reportPath, cards: entries.length, counts, executable: report.executableByNative }, null, 2));
