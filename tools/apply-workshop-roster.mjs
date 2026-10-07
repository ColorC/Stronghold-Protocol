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
const designPath = path.resolve(args.design || path.join(repo, 'data', 'independent-design.json'));
const designAddonPath = path.resolve(args.designAddon || path.join(repo, 'data', 'independent-darkmoon-design-addon.json'));
const gameTextPath = path.resolve(args.gameText || path.join(repo, 'data', 'independent-game-text.json'));
const gameTextAddonPath = path.resolve(args.gameTextAddon || path.join(repo, 'data', 'independent-darkmoon-game-text-addon.json'));
const reportPath = path.resolve(args.report || 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/runtime/growth-destination-20261008/darkmoon/blueprint-coverage.json');

const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const design = JSON.parse(fs.readFileSync(designPath, 'utf8'));
const gameText = JSON.parse(fs.readFileSync(gameTextPath, 'utf8'));
const nativeByName = new Map(design.operators.map(x => [x.name, x]));
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
const KEYWORD_ADAPTERS = Object.freeze({
  BGS_039:['坚守盟约'], BGS_106:['坚守盟约','不屈盟约'], BGS_034:['护盾发生器','不屈盟约'],
  BGS_131:['精准盟约'], FP1_010:['精准盟约'], GVG_113:['巨锤盟约'], LOOT_078:['巨锤盟约']
});
// Executable source-id keyed adaptations whose prep behavior already exists in native.js.
// Descriptors are written from the source effect, with ordinary/golden parameters kept distinct.
const PREP_ADAPTERS = Object.freeze({
  BGS_027: { trigger:'roundStart', sourceTrigger:'turnStart', recipient:'self', duration:'permanentWornGear', kind:'badgeGrowth', effect:{ normal:1, elite:2 }, adapter:'grantEquipment', params:{ landOn:'self', outputs:[{id:'precision',normal:1,elite:2}] } },
  BGS_049: { trigger:'sold', sourceTrigger:'sell', recipient:'playerResource', duration:'immediateOnSale', kind:'gold', effect:{ normal:3, elite:6 }, adapter:'factionReaction', params:{ mode:'funds',targets:'all',maxEventsPerPrep:1 }, runtimeParams:{normal:{count:2},elite:{count:5}}, note:'Base sell already grants 1 gold; adapter adds 2/5 immediately to reach original 3/6 total.' },
  BGS_055: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'shopUpgradeCost', duration:'nextUpgrade', kind:'upgradeDiscount', effect:{ normal:1, elite:2 }, adapter:'factionReaction', params:{ mode:'discount',targets:'self',count:{normal:1,elite:2},excludeSelf:false,maxEventsPerPrep:1 } },
  BGS_072: { trigger:'bought', sourceTrigger:'buyMatchingRace', recipient:'playerResource', duration:'thisTurnOnly', kind:'gold', effect:{ normal:1, elite:2 }, adapter:'darkmoonRacePurchaseFunds', params:{ race:'PIRATE' }, runtimeParams:{normal:{count:1},elite:{count:2}} },
  BGS_116: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'playerResource', duration:'nextRefreshes', kind:'freeRefresh', effect:{ normal:1, elite:2 }, adapter:'freeRefresh', params:{ normal:1, elite:2 } },
});

function triggerOf(text) {
  if (/your Battlecries trigger|your minions trigger their Deathrattles|cards that summon minions summon/i.test(text)) return 'passiveMultiplier';
  if (/Magnetic/i.test(text)) return 'playAttach';
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
  if (/your battlecries trigger/.test(t)) return 'eligibleBattlecryOutputs';
  if (/your minions trigger their deathrattles/.test(t)) return 'eligibleDeathrattleOutputs';
  if (/cards that summon minions/.test(t)) return 'summonedUnitOutputs';
  if (/magnetic/.test(t)) return 'chosenFriendlyMech';
  if (/deal .* damage to all minions/.test(t)) return 'allCombatants';
  if (/taunt minions/.test(t)) return 'eligibleTaggedFriendly';
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
  return 'unresolved';
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
  const statDeltas = {};
  const pair = text.match(/\+(\d+)\s*\/\s*\+(\d+)/);
  if (pair) { statDeltas.attack = Number(pair[1]); statDeltas.health = Number(pair[2]); }
  const attack = text.match(/\+(\d+)\s+Attack/i); if (attack) statDeltas.attack = Number(attack[1]);
  const health = text.match(/\+(\d+)\s+Health/i); if (health) statDeltas.health = Number(health[1]);
  const damage = text.match(/(?:deal|deals)\s+(\d+)\s+damage/i); const damageAmount = damage ? Number(damage[1]) : null;
  const summonStats = text.match(/summon(?:s)?\s+(?:a|an|two|three|four|\d+)?\s*(\d+)\s*\/\s*(\d+)/i);
  const params = { ...(Object.keys(statDeltas).length ? { statDeltas } : {}), ...(damageAmount ? { damage:damageAmount } : {}), ...(summonStats ? { summonStats:{ attack:Number(summonStats[1]), health:Number(summonStats[2]) } } : {}), numericLiterals:[...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m=>Number(m[0])) };
  return { trigger, sourceTrigger:trigger, recipient, duration, kind, params, text: variant.text_zh || '', textEn: text, tags, implementation: 'unsupported', unsupportedReason: 'No source-id-specific native behavior has yet been implemented and exercised.' };
}

const STATIC_KEYWORD_GEAR = Object.freeze({
  taunt:{ label:'嘲讽', gear:'坚守盟约' }, divineShield:{ label:'圣盾', gear:'护盾发生器' },
  reborn:{ label:'复生', gear:'不屈盟约' }, poison:{ label:'剧毒', gear:'精准盟约' },
  cleave:{ label:'攻击相邻随从', gear:'巨锤盟约' }
});
function effectDeliveries(card, variant, isElite = false) {
  const authored = PREP_ADAPTERS[card.id];
    if (authored) return [{ trigger:authored.trigger, sourceTrigger:authored.sourceTrigger, recipient:authored.recipient, duration:authored.duration, kind:authored.kind, text:variant.text_zh||'', textEn:variant.text_en||'', tags:[], params:{ ...(authored.params||{}), ...(authored.effect?{amount:authored.effect[isElite?'elite':'normal']}:{}) }, adapter:[authored.adapter], implementation:'supported', unsupportedReason:null }];
  const base = parseEffect(card, variant), found = [];
  for (const tag of ['taunt','divineShield','reborn','poison']) if (base.tags.includes(tag)) found.push(tag);
  if (/Also damages the minions next to whom(?:ever)? this attacks/i.test(variant.text_en || '')) found.push('cleave');
  const rows = found.map(tag => {
    const descriptor = STATIC_KEYWORD_GEAR[tag];
    return { trigger:'gain', sourceTrigger:'staticCombat', recipient:'self', duration:'permanentWornGear', kind:'keywordGear', text:`<b>${descriptor.label}</b>`, textEn:tag, tags:[tag], params:{}, adapter:[`independent:${descriptor.gear}`], implementation:KEYWORD_ADAPTERS[card.id]?.includes(descriptor.gear) ? 'dispatched-pending-gear-landing-verification' : 'unsupported', unsupportedReason:KEYWORD_ADAPTERS[card.id]?.includes(descriptor.gear) ? 'Native gain dispatch is implemented; full execution awaits the authorized landOn:self fix for non-badge gear and its concrete grant test.' : 'Static keyword has no source-id-specific delivery rule wired.' };
  });
  if (/\bMagnetic\b/i.test(variant.text_en || '')) rows.push({ trigger:'playAttach', sourceTrigger:'magnetic', recipient:'chosenFriendlyMech', duration:'game', kind:'magneticAttachment', text:'磁力', textEn:'Magnetic', tags:['magnetic'], params:{}, implementation:'unsupported', unsupportedReason:'Magnetic requires an explicit friendly Mech attachment/merge rule; no native adapter has been tested.' });
  const textWithoutTags=(variant.text_en||'').replace(/<b>(?:Taunt|Divine Shield|Reborn|Poisonous|Windfury|Mega-Windfury)<\/b>/gi,'').replace(/\bMagnetic\b/gi,'').replace(/\[x\]/gi,'').replace(/<[^>]*>/g,'').replace(/[\s\n.,:;]+/g,'');
  const hasMainText=Boolean(textWithoutTags);
  if (hasMainText) {
    if (KEYWORD_ADAPTERS[card.id] && found.length===0) {
      const names=KEYWORD_ADAPTERS[card.id];
      Object.assign(base,{trigger:'gain',recipient:'self',duration:'permanentWornGear',kind:'keywordGear',adapter:names.map(n=>`independent:${n}`),implementation:'dispatched-pending-gear-landing-verification',unsupportedReason:'Native gain dispatch is implemented; full execution awaits the authorized landOn:self fix for non-badge gear and its concrete grant test.'});
    }
    rows.push(base);
  }
  if (!rows.length) rows.push(base);
  return rows;
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
    const normal = effectDeliveries(card, { text_en:card.text_en, text_zh:card.text_zh }, false);
    const elite = effectDeliveries(card, card.golden || { text_en:card.text_en, text_zh:card.text_zh }, true);
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
      metadata: { op: { effectDelivery: { normal, elite } } },
      authoredRule: SOURCE_RULES[card.id] ? structuredClone(SOURCE_RULES[card.id]) : PREP_ADAPTERS[card.id] ? {
        sourceId:card.id, mechanic:PREP_ADAPTERS[card.id].kind,
        normal:{trigger:PREP_ADAPTERS[card.id].trigger,recipient:PREP_ADAPTERS[card.id].recipient,duration:PREP_ADAPTERS[card.id].duration,adapter:PREP_ADAPTERS[card.id].adapter,params:{...structuredClone(PREP_ADAPTERS[card.id].params),...(PREP_ADAPTERS[card.id].runtimeParams?.normal||{}),...(card.id==='BGS_055'?{count:1}:{})}, ...(PREP_ADAPTERS[card.id].note?{adaptation:PREP_ADAPTERS[card.id].note}:{})},
        elite:{trigger:PREP_ADAPTERS[card.id].trigger,recipient:PREP_ADAPTERS[card.id].recipient,duration:PREP_ADAPTERS[card.id].duration,adapter:PREP_ADAPTERS[card.id].adapter,params:{...structuredClone(PREP_ADAPTERS[card.id].params),...(PREP_ADAPTERS[card.id].runtimeParams?.elite||{}),...(card.id==='BGS_055'?{count:2}:{})}, ...(PREP_ADAPTERS[card.id].note?{adaptation:PREP_ADAPTERS[card.id].note}:{})},
        status:'supported',reason:null
      } : KEYWORD_ADAPTERS[card.id] ? {
        sourceId:card.id,
        mechanic:'keywordGearGrant',
        normal:{trigger:'gain',recipient:'self',duration:'permanentWornGear',outputs:KEYWORD_ADAPTERS[card.id].map(name=>({id:`independent:${name}`,quantity:1}))},
        elite:{trigger:'gain',recipient:'self',duration:'permanentWornGear',outputs:KEYWORD_ADAPTERS[card.id].map(name=>({id:`independent:${name}`,quantity:1}))},
        status:'pending-gear-landing',
        reason:'Source-id keyed native gain dispatch is implemented; full execution awaits concrete non-badge landOn:self verification.'
      } : {
        sourceId: card.id,
        status: 'unsupported',
        reason: 'Needs a source-specific adapter rule and matching ordinary/elite trigger test.'
      },
      sourceEffect: {
        normal: normal.map(({trigger,sourceTrigger,recipient,duration,text,params})=>({trigger,sourceTrigger,recipient,duration,text,params})),
        elite: elite.map(({trigger,sourceTrigger,recipient,duration,text,params})=>({trigger,sourceTrigger,recipient,duration,text,params}))
      }
    });
  }
}
if (missing.length) throw new Error(`source names missing: ${missing.join(', ')}`);
entries.sort((a,b) => a.sourceId.localeCompare(b.sourceId));
const counts = Object.fromEntries(Object.entries(roster.groups).map(([k,v]) => [k, v.pairs.length]));
const recipientCounts = variant => Object.fromEntries(Object.entries(entries.flatMap(x=>x.metadata.op.effectDelivery[variant]).reduce((acc,e)=>{acc[e.recipient]=(acc[e.recipient]||0)+1;return acc;},{})).sort(([a],[b])=>a.localeCompare(b)));
const durationCounts = variant => Object.fromEntries(Object.entries(entries.flatMap(x=>x.metadata.op.effectDelivery[variant]).reduce((acc,e)=>{acc[e.duration]=(acc[e.duration]||0)+1;return acc;},{})).sort(([a],[b])=>a.localeCompare(b)));
const report = {
  schema: 'stronghold.darkmoon-blueprint-coverage/v1',
  source: sourcePath,
  roster: rosterPath,
  rosterUniqueSourceCards: entries.length,
  sourceIds: entries.map(x=>x.sourceId),
  expectedSourceCards: 101,
  counts,
  mainFactions: Object.fromEntries(Object.entries(roster.groups).filter(([k]) => k !== 'NEUTRAL').map(([k,v]) => [k, v.pairs.length])),
  neutral: counts.NEUTRAL,
  exactSourceBodyCoverage: entries.length === 101 && new Set(entries.map(x=>x.name)).size === 101 && new Set(entries.map(x=>x.sourceId)).size === 101,
  unresolvedRecipientEffectCount:entries.flatMap(x=>[...x.metadata.op.effectDelivery.normal,...x.metadata.op.effectDelivery.elite]).filter(e=>e.recipient==='unresolved').length,
  recipients:{normal:recipientCounts('normal'),elite:recipientCounts('elite')},
  durations:{normal:durationCounts('normal'),elite:durationCounts('elite')},
  ordinaryAndEliteEffectsPresent: entries.every(x => x.metadata.op.effectDelivery.normal.length > 0 && x.metadata.op.effectDelivery.elite.length > 0),
  nativeDispatchedPendingLanding: entries.filter(x=>KEYWORD_ADAPTERS[x.sourceId]).length,
  sourceSpecificPrepAdapters:entries.filter(x=>PREP_ADAPTERS[x.sourceId]).map(x=>({id:x.sourceId,name:x.name,mechanic:PREP_ADAPTERS[x.sourceId].kind,status:'supported',normal:x.metadata.op.effectDelivery.normal,elite:x.metadata.op.effectDelivery.elite})),
  totalNormalEffects:entries.reduce((n,x)=>n+x.metadata.op.effectDelivery.normal.length,0),
  totalEliteEffects:entries.reduce((n,x)=>n+x.metadata.op.effectDelivery.elite.length,0),
  deliveryCounts:{
    normal:{pendingLanding:entries.flatMap(x=>x.metadata.op.effectDelivery.normal).filter(e=>e.implementation==='dispatched-pending-gear-landing-verification').length,unsupported:entries.flatMap(x=>x.metadata.op.effectDelivery.normal).filter(e=>e.implementation==='unsupported').length},
    elite:{pendingLanding:entries.flatMap(x=>x.metadata.op.effectDelivery.elite).filter(e=>e.implementation==='dispatched-pending-gear-landing-verification').length,unsupported:entries.flatMap(x=>x.metadata.op.effectDelivery.elite).filter(e=>e.implementation==='unsupported').length}
  },
  executableByNative: entries.filter(x => x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='supported') && x.metadata.op.effectDelivery.elite.every(e=>e.implementation==='supported')).length,
  unsupportedSourceIds: entries.filter(x=>[...x.metadata.op.effectDelivery.normal,...x.metadata.op.effectDelivery.elite].some(e=>e.implementation==='unsupported')).map(x=>({id:x.sourceId,name:x.name,reason:x.metadata.op.effectDelivery.normal.find(e=>e.implementation==='unsupported')?.unsupportedReason || 'At least one variant effect is unsupported.'})),
  pendingGearLandingSourceIds: entries.filter(x=>KEYWORD_ADAPTERS[x.sourceId]).map(x=>({id:x.sourceId,name:x.name,gear:KEYWORD_ADAPTERS[x.sourceId]})),
  sourceSpecificSemanticRules: entries.filter(x=>SOURCE_RULES[x.sourceId]).map(x=>({id:x.sourceId,name:x.name,mechanic:x.authoredRule.mechanic,status:x.authoredRule.status})),
  nativeDefinitionMatches: entries.filter(x=>nativeByName.has(x.operator)).length,
  nativeDefinitionPending: entries.filter(x=>!nativeByName.has(x.operator)).map(x=>({id:x.sourceId,name:x.name,operator:x.operator,reason:'No matching operator definition in the currently checked-in design input; no native body is fabricated.'})),
  caveats: ['Text-derived descriptors are compile-time metadata only; runtime uses source-id-keyed authored rules, never parses localized source text.', 'Only effect rows marked supported have a matching runtime behavior; pendingLanding is dispatched but awaits non-badge self-landing proof; unsupported rows need matching ordinary/elite trigger, target, duration, and reset behavior.']
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ schema:'stronghold.darkmoon-blueprints/v1', sourceBuild: roster.sourceBuild, rosterCommit: roster.sourceCommit, entries }, null, 2) + '\n');
// Emit non-conflicting add-ons, never overwrite the project's canonical design/game-text files.
const designAddon = {
  schema: 'stronghold.darkmoon-design-addon/v1',
  sourceBuild: roster.sourceBuild,
  basedOnDesign: path.basename(designPath),
  operators: entries.filter(x=>nativeByName.has(x.operator)).map(x=>({
    name:x.operator,
    chessId:nativeByName.get(x.operator).chessId,
    sourceId:x.sourceId,
    sourceRefs:{ darkmoon19_2:{ id:x.sourceId, name:x.name, nameEn:x.nameEn, tier:x.originalTier, originalRaces:x.originalRaces, version:x.sourceVersion, type:'Battlegrounds', sourceUrl:x.sourceUrl } },
    authoredRule:x.authoredRule,
    metadata:{op:{effectDelivery:x.metadata.op.effectDelivery}},
    modeEffects:null
  })),
  pendingNativeDefinitions: entries.filter(x=>!nativeByName.has(x.operator)).map(x=>({name:x.operator,sourceId:x.sourceId}))
};
const gameTextAddon = {
  schema:'stronghold.darkmoon-game-text-addon/v1',
  sourceBuild:roster.sourceBuild,
  basedOnGameText:path.basename(gameTextPath),
  operators:Object.fromEntries(entries.map(x=>[x.operator,{sourceId:x.sourceId,name:x.name,nameEn:x.nameEn,normal:x.sourceTexts.normal,elite:x.sourceTexts.elite,normalEn:x.sourceTextsEn.normal,eliteEn:x.sourceTextsEn.elite}]))
};
for (const [p, value] of [[designAddonPath,designAddon],[gameTextAddonPath,gameTextAddon]]) {
  fs.mkdirSync(path.dirname(p), { recursive:true });
  fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n');
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ blueprint: outPath, designAddon:designAddonPath, gameTextAddon:gameTextAddonPath, report: reportPath, cards: entries.length, nativeDefinitionMatches:designAddon.operators.length, counts, executable: report.executableByNative }, null, 2));
