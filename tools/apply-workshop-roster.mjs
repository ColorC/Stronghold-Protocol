#!/usr/bin/env node
// Compile the named 19.2 Battlegrounds roster against the immutable source snapshot.
// Source text is copied verbatim into metadata; this compiler emits authored rules keyed by
// source card id. Runtime code must consume these records, never parse localized card text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DARKMOON_COMBAT_SUPPORTED_IDS, darkmoonCombatMetadata } from '../server/sim/content/independent/darkmoonCombat.js';

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
  BGS_038:['坚守盟约'], BGS_060:['坚守盟约'], BGS_121:['坚守盟约'], BGS_124:['坚守盟约'],
  BGS_127:['坚守盟约'], BGS_201:['坚守盟约'], FP1_024:['坚守盟约'],
  BGS_071:['护盾发生器'], BGS_119:['护盾发生器'], BGS_205:['护盾发生器','不屈盟约'],
  BOT_911:['坚守盟约','护盾发生器'], ICC_858:['护盾发生器'], ULD_217:['不屈盟约'],
  BGS_131:['精准盟约'], FP1_010:['精准盟约'], GVG_113:['巨锤盟约'], LOOT_078:['巨锤盟约']
});
// Executable source-id keyed adaptations whose prep behavior already exists in native.js.
// Descriptors are written from the source effect, with ordinary/golden parameters kept distinct.
const PREP_ADAPTERS = Object.freeze({
  BGS_033: { trigger:'roundStart', sourceTrigger:'startOfPrepAfterVictory', recipient:'self', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonPreviousWinSelfGrowth', params:{ attackUnits:{normal:2,elite:4}, secondaryUnits:{normal:2,elite:4} } },
  BGS_017: { trigger:'gain', sourceTrigger:'newMappedFactionRecruit', recipient:'newSiracusaRecruit', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonBeastSummonGrowth', params:{faction:'叙拉古',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:0,elite:0}} },
  BGS_021: { trigger:'gain', sourceTrigger:'newMappedFactionRecruit', recipient:'newSiracusaRecruit', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonBeastSummonGrowth', params:{faction:'叙拉古',attackUnits:{normal:4,elite:8},secondaryUnits:{normal:4,elite:8}} },
  BOT_911: { trigger:'gain', sourceTrigger:'optionalMagneticFusion', recipient:'selectedColumbiaFriendly', duration:'permanentAttachment', kind:'magneticAttachment', adapter:'darkmoonMagneticMerge', params:{sourceId:'BOT_911',faction:'哥伦比亚',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}} },
  BGS_017: { trigger:'gain', sourceTrigger:'newMappedFactionRecruit', recipient:'newSiracusaRecruit', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonBeastSummonGrowth', params:{faction:'叙拉古',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:0,elite:0}} },
  BGS_021: { trigger:'gain', sourceTrigger:'newMappedFactionRecruit', recipient:'newSiracusaRecruit', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonBeastSummonGrowth', params:{faction:'叙拉古',attackUnits:{normal:4,elite:8},secondaryUnits:{normal:4,elite:8}} },
  BGS_115: { trigger:'sold', sourceTrigger:'sell', recipient:'hand', duration:'untilPlayedOrSold', kind:'supportRecruitOffer', adapter:'darkmoonElementalTokenOffer', params:{supportId:'darkmoon:support-elemental-2-2',count:{normal:1,elite:2}}, runtimeParams:{normal:{count:1},elite:{count:2}} },
  CFM_315: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'friendlyWarbandSupport', duration:'untilSoldOrRetired', kind:'supportSummon', adapter:'darkmoonSummonSupport', params:{normalId:'darkmoon:support-cat-1-1',eliteId:'darkmoon:support-cat-2-2'} },
  BGS_027: { trigger:'roundStart', sourceTrigger:'turnStart', recipient:'self', duration:'permanentWornGear', kind:'badgeGrowth', effect:{ normal:1, elite:2 }, adapter:'grantEquipment', params:{ landOn:'self', outputs:[{id:'precision',normal:1,elite:2}] } },
  BGS_120: { trigger:'gain', sourceTrigger:'afterPlayMappedFaction', recipient:'oneRandomOtherFriendlyMappedFaction', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonPlayedTribeGrowth', params:{ faction:'炎', attackUnits:{normal:1,elite:2}, secondaryUnits:{normal:1,elite:2} } },
  BGS_124: { trigger:'gain', sourceTrigger:'afterPlayMappedFaction', recipient:'self', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonPlayedFactionCountSelfGrowth', params:{ faction:'炎', attackUnits:{normal:0,elite:0}, secondaryUnitsPerTarget:{normal:1,elite:2} } },
  ULD_217: { trigger:'prepEnd', sourceTrigger:'turnEnd', recipient:'oneRandomOtherFriendly', duration:'permanentWornGrowth', kind:'badgeGrowth', adapter:'darkmoonEndTurnGrowth', params:{ mode:'randomOtherFriendly', attackUnits:{normal:1,elite:2}, secondaryUnits:{normal:0,elite:0} } },
  BGS_037: { trigger:'sold', sourceTrigger:'sell', recipient:'currentShopOffers', duration:'currentShopOnly', kind:'shopGrowth', effect:{normal:1,elite:2}, adapter:'darkmoonShopGrowth', params:{rosterTribe:'*',persistent:false} },
  BGS_049: { trigger:'sold', sourceTrigger:'sell', recipient:'playerResource', duration:'immediateOnSale', kind:'gold', effect:{ normal:3, elite:6 }, adapter:'factionReaction', params:{ mode:'funds',targets:'all',maxEventsPerPrep:1 }, runtimeParams:{normal:{count:2},elite:{count:5}}, note:'Base sell already grants 1 gold; adapter adds 2/5 immediately to reach original 3/6 total.' },
  BGS_055: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'shopUpgradeCost', duration:'nextUpgrade', kind:'upgradeDiscount', effect:{ normal:1, elite:2 }, adapter:'factionReaction', params:{ mode:'discount',targets:'self',count:{normal:1,elite:2},excludeSelf:false,maxEventsPerPrep:3 } },
  BGS_072: { trigger:'bought', sourceTrigger:'buyMatchingMappedFaction', recipient:'playerResource', duration:'thisTurnOnly', kind:'gold', effect:{ normal:1, elite:2 }, adapter:'darkmoonRosterTribePurchaseFunds', params:{ faction:'维多利亚' }, runtimeParams:{normal:{count:1},elite:{count:2}} },
  BGS_104: { trigger:'bought', sourceTrigger:'buyMatchingRosterTribe', recipient:'matchingTribeShopOffers', duration:'permanent', kind:'shopGrowth', effect:{normal:1,elite:2}, adapter:'darkmoonShopGrowth', params:{rosterTribe:'ELEMENTAL',faction:'炎',persistent:true} },
  BGS_113: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'selectedShopMinion', duration:'permanentTransformation', kind:'transform', effect:{normal:1,elite:1}, adapter:'darkmoonTransformFromShop', params:{eliteCopy:false}, runtimeParams:{normal:{eliteCopy:false},elite:{eliteCopy:true}} },
  BGS_041: { trigger:'gain', sourceTrigger:'otherBattlecryOnGain', recipient:'allFriendlyDragonOperators', duration:'permanentWornGrowth', kind:'badgeGrowth', effect:{normal:1,elite:2}, adapter:'darkmoonBattlecryFactionGrowth', params:{faction:'卡西米尔',outputs:['precision','vitality']} },
  BGS_053: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'otherFriendlyPirates', duration:'permanentWornGrowth', kind:'badgeGrowth', effect:{normal:3,elite:6}, adapter:'darkmoonBattlecryFactionGrowth', params:{faction:'维多利亚',outputs:['precision'],excludeSelf:true} },
  BGS_128: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'otherFriendlyElementals', duration:'permanentWornGrowth', kind:'badgeGrowth', effect:{normal:1,elite:2}, adapter:'darkmoonBattlecryFactionGrowth', params:{faction:'炎',outputs:['precision','vitality'],excludeSelf:true} },
  BGS_122: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'shop', duration:'frozenUntilPurchase', kind:'shopOffer', effect:{normal:1,elite:2}, adapter:'darkmoonAddTribeShopOffer', params:{faction:'炎'} },
  BGS_123: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'hand', duration:'untilRecruited', kind:'recruitOffer', effect:{normal:1,elite:2}, adapter:'darkmoonRecruitTribeToHand', params:{faction:'炎'} },
  BGS_048: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'selectedFriendlyPirate', duration:'permanentWornGrowth', kind:'badgeGrowth', effect:{normal:'1 per mapped-faction purchase',elite:'2 per mapped-faction purchase'}, adapter:'darkmoonBattlecryTargetGrowth', params:{faction:'维多利亚',outputs:['precision','vitality']} },
  BGS_100: { trigger:'bought', sourceTrigger:'buyElemental', recipient:'selectedFriendlyOperator', duration:'permanentWornGrowth', kind:'badgeGrowth', effect:{normal:'Elemental mapped-faction tier',elite:'Elemental mapped-faction tier'}, adapter:'darkmoonBoughtTribeTargetGrowth', params:{triggerFaction:'炎',outputs:['precision','vitality']} },
  BGS_116: { trigger:'gain', sourceTrigger:'battlecryOnGain', recipient:'playerResource', duration:'nextRefreshes', kind:'freeRefresh', effect:{ normal:1, elite:2 }, adapter:'freeRefresh', params:{ normal:1, elite:2 } },
  BGS_043: {trigger:'gain',sourceTrigger:'battlecryOnGain',recipient:'hand',duration:'untilFirstPlay',kind:'recruitOffer',adapter:'darkmoonLastWarbandRecruit',params:{source:'previousRoundFriendlyWarband',pristine:true}},
  BGS_127: {trigger:'bought',sourceTrigger:'buyElemental',recipient:'self',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonBoughtSelfGrowth',params:{faction:'炎',attackUnits:{normal:0,elite:0},secondaryUnits:{normal:1,elite:2}}},
  BGS_009: {trigger:'prepEnd',recipient:'oneRandomFriendlyPerFaction',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'randomEachFaction',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  BGS_036: {trigger:'prepEnd',recipient:'self',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'selfPerFaction',faction:'卡西米尔',attackPer:{normal:1,elite:2},secondaryPer:{normal:1,elite:2}}},
  BGS_038: {trigger:'gain',recipient:'selectedFriendlyDragon',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonBattlecryTargetGrowth',params:{faction:'卡西米尔',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  BGS_066: {trigger:'prepEnd',recipient:'self',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'selfIfGolden',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  BGS_075: {trigger:'gain',recipient:'self',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonPlayedTagSelfGrowth',params:{tag:'deathrattle',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}},
  BGS_081: {trigger:'bought',recipient:'self',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonBoughtSelfGrowth',params:{faction:'维多利亚',attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}},
  BGS_082: {trigger:'gain',recipient:'threeFriendlyDifferentFactions',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'randomDistinctFaction',targets:{normal:3,elite:3},attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2}}},
  BGS_083: {trigger:'gain',recipient:'threeFriendlyDifferentFactions',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'randomDistinctFaction',targets:{normal:3,elite:3},attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  BGS_105: {trigger:'prepEnd',recipient:'leftmostFriendly',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'leftmostPerPurchase',faction:'炎',attackPer:{normal:1,elite:2},secondaryPer:{normal:1,elite:2}}},
  BGS_202: {trigger:'prepEnd',recipient:'self',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'selfPerDistinctFaction',attackPer:{normal:1,elite:2},secondaryPer:{normal:2,elite:4}}},
  CFM_816: {trigger:'gain',recipient:'selectedFriendlyBeast',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonBattlecryTargetGrowth',params:{faction:'叙拉古',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  DS1_070: {trigger:'gain',recipient:'selectedFriendlyBeast',duration:'permanentWornGrowth',kind:'badgeGrowthAndGear',adapter:'darkmoonBattlecryTargetGrowth',params:{faction:'叙拉古',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4},extraGear:['independent:坚守盟约']}},
  EX1_093: {trigger:'gain',recipient:'adjacentFriendlyOperators',duration:'permanentWornGrowth',kind:'badgeGrowthAndGear',adapter:'darkmoonAdjacentGrowth',params:{attackUnits:{normal:1,elite:2},secondaryUnits:{normal:1,elite:2},extraGear:['independent:坚守盟约']}},
  GVG_027: {trigger:'prepEnd',recipient:'randomOtherFriendlyMechanical',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'randomOtherFaction',faction:'哥伦比亚',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  GVG_055: {trigger:'gain',recipient:'selectedFriendlyMechanical',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonBattlecryTargetGrowth',params:{faction:'哥伦比亚',fixedCount:0,attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  GVG_048: {trigger:'gain',sourceTrigger:'battlecryOnGain',recipient:'allOtherFriendlyMappedFaction',duration:'permanentWornGrowth',kind:'badgeGrowth',effect:{normal:2,elite:4},adapter:'darkmoonBattlecryFactionGrowth',params:{faction:'哥伦比亚',excludeSelf:true,outputs:['precision']}},
  ICC_029: {trigger:'prepEnd',recipient:'randomOtherFriendly',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonEndTurnGrowth',params:{mode:'randomOtherFriendly',attackUnits:{normal:3,elite:6},secondaryUnits:{normal:0,elite:0}}},
  ICC_807: {trigger:'gain',recipient:'allFriendlyWithTaunt',duration:'permanentWornGrowth',kind:'badgeGrowth',adapter:'darkmoonTaggedGrowth',params:{gearId:'oath-cover',attackUnits:{normal:2,elite:4},secondaryUnits:{normal:2,elite:4}}},
  LOE_077: { trigger:'battlecryMultiplier', sourceTrigger:'battlecry', recipient:'originalBattlecryOutputs', duration:'whileOwnerOnField', kind:'triggerMultiplier', effect:{normal:2,elite:3}, adapter:'triggerMultiplier', params:{hook:'gain',filter:'darkmoonBattlecry'}, runtimeParams:{normal:{extraRuns:1},elite:{extraRuns:2}} },
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
function hasOwnBattlecry(text) {
  const plain=String(text||'').replace(/<[^>]*>/g,'');
  return /(?:^|[\r\n])\s*Battlecry\s*:/i.test(plain);
}
function hasOwnDeathrattle(text) {
  const plain=String(text||'').replace(/<[^>]*>/g,'');
  return /(?:^|[\r\n])\s*Deathrattle\s*:/i.test(plain);
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
const DELIVERY_RECIPIENTS = Object.freeze({
  self:'自身', inventory:'装备栏', hand:'整备区手牌', playerResource:'玩家资源', shopUpgradeCost:'下次酒馆升级费用',
  selectedFriendlyDragon:'你选择的一名友方卡西米尔干员', selectedFriendlyBeast:'你选择的一名友方叙拉古干员',
  selectedFriendlyMechanical:'你选择的一名友方哥伦比亚干员', adjacentFriendlyOperators:'相邻友方干员',
  allFriendlyWithTaunt:'所有已装备坚守盟约的友方干员', currentShopOffers:'当前酒馆在售干员', matchingTribeShopOffers:'符合条件的酒馆在售干员',
  oneRandomOtherFriendlyMappedFaction:'一名随机的其他友方炎阵营干员', oneRandomOtherFriendly:'一名随机的其他友方干员',
  oneRandomFriendlyPerFaction:'每个阵营各一名随机友方干员', threeFriendlyDifferentFactions:'三名不同阵营的友方干员',
  leftmostFriendly:'最左侧友方干员', randomOtherFriendlyMechanical:'一名随机其他友方哥伦比亚干员',
  allOtherFriendlyMappedFaction:'所有其他友方哥伦比亚干员', combatants:'本场战斗中的参战单位',
  combatBoardSummons:'本场战斗召唤物', combatSummonAndHand:'战斗召唤物与整备区手牌', selectedShopMinion:'你选中的一名酒馆干员',
  shop:'酒馆', currentShopOnly:'本次商店', inventoryOnly:'装备栏'
});
const triggerLabel = trigger => ({gain:'招募获得或首次上阵时',bought:'购买时',sold:'出售时',prepEnd:'每回合休整结束时',roundStart:'每回合休整开始时',combatStart:'战斗开始时',death:'退场时',battlecry:'招募获得时触发战吼'}[trigger] || (typeof trigger==='string'?`${trigger}时`:''));
const displayCount=(value,variant)=>value&&typeof value==='object'?Number(value[variant]??value.normal??0):Number(value||0);
function deliveryDisplay(e,variant,mode='badges') {
  const p=e.params||{},when=triggerLabel(e.trigger),who=DELIVERY_RECIPIENTS[e.recipient]||e.recipient||'符合条件的目标';
  if(e.kind==='keywordGear')return `${when}，${who}永久装备${STATIC_KEYWORD_GEAR[e.tags?.[0]]?.label||String(e.text||'关键词装备').replace(/<[^>]*>/g,'')}。`;
  if(e.kind==='sourceSpecificCombat') {
    let adapted=e.adaptation||'本场战斗中触发对应战斗效果。';
    if(mode==='levels')adapted=adapted.replace(/攻击徽章/g,'攻击训练等级').replace(/副属性装备/g,'职业副属性训练等级');
    return adapted;
  }
  if(e.adaptation)return `${when}，${e.adaptation}`;
  if(e.kind==='badgeGrowth'||e.kind==='badgeGrowthAndGear') {
    const amount=p.amount??p.count??p.fixedCount;
    const attack= p.attackUnits!==undefined?displayCount(p.attackUnits,variant):p.attackPer!==undefined?displayCount(p.attackPer,variant):p.outputs?.includes('precision')?displayCount(amount,variant):0;
    const secondary=p.secondaryUnits!==undefined?displayCount(p.secondaryUnits,variant):p.secondaryUnitsPerTarget!==undefined?displayCount(p.secondaryUnitsPerTarget,variant):p.secondaryPer!==undefined?displayCount(p.secondaryPer,variant):p.outputs?.some(x=>x!=='precision')?displayCount(amount,variant):0;
    const label=mode==='levels'?['攻击训练等级','职业副属性训练等级']:['攻击成长徽章','职业副属性成长徽章'];
    const delta=[]; if(attack)delta.push(`${label[0]}×${attack}`);if(secondary)delta.push(`${label[1]}×${secondary}`);
    const faction=p.faction?`（${p.faction}阵营条件）`:'';
    if(!delta.length)return `${when}，${who}${faction}获得固定目标的本局永久成长。`;
    return `${when}，${who}${faction}获得${delta.join('与')}；成长直接穿戴并永久保留。`;
  }
  if(e.kind==='shopGrowth')return `${when}，${who}获得酒馆成长：攻击与生命各+${p.amount??displayCount(p.attack,variant)??1}；${p.persistent?'本局后续酒馆持续生效':'仅当前商店有效'}。`;
  if(e.kind==='upgradeDiscount')return `${when}，酒馆升级费用减少${p.count??p.amount??1}，在下次升级前生效。`;
  if(e.kind==='gold')return `${when}，玩家获得${p.count??p.amount??1}枚金币。`;
  if(e.kind==='recruitOffer')return `${when}，将符合描述的干员放入整备区手牌；首次上阵才触发其招募效果。`;
  if(e.kind==='supportRecruitOffer')return `${when}，将${displayCount(p.count,variant)}个2/2炎阵营支援单位加入整备区手牌；选取后可部署，本体不可商店招募。`;
  if(e.kind==='supportSummon')return `${when}，免费召唤1个${variant==='elite'?'2/2':'1/1'}猫形支援单位进入整备区；可部署，本体不可商店招募。`;
  if(e.kind==='magneticAttachment')return e.params?.sourceId==='BOT_911'
    ? `${when}，可直接招募；也可消耗此干员，为你选择的一名哥伦比亚友方干员永久装备坚守盟约与护盾发生器，并获得攻击与职业副属性各×${displayCount(e.params.attackUnits,variant)}成长。`
    : `招募时可直接进入阵容；也可消耗此干员，将其退场效果附加到你选择的一名哥伦比亚友方干员，本体不进入阵容。`;
  if(e.kind==='combatBoardAction')return `${when}，在本场战斗中执行对应召唤。`;
  if(e.kind==='statOrCombatBuff')return `${when}，${who}获得本场战斗临时强化。`;
  if(e.implementation==='unsupported')return `${when}，该效果尚未接入可执行适配。`;
  return `${when}，${who}：${String(e.text||'执行对应效果。').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()}`;
}
function effectDeliveries(card, variant, isElite = false) {
  const authored = PREP_ADAPTERS[card.id];
  if (authored) {
    const rows=[{ trigger:authored.trigger, sourceTrigger:authored.sourceTrigger||authored.trigger, recipient:authored.recipient||'self', duration:authored.duration||'permanent', kind:authored.kind, text:variant.text_zh||'', textEn:variant.text_en||'', tags:[], params:{ ...(authored.params||{}), ...(authored.effect?{amount:authored.effect[isElite?'elite':'normal']}:{}) }, adapter:[authored.adapter], implementation:'supported', unsupportedReason:null }];
    const tags=parseEffect(card,variant).tags;
    for(const tag of ['taunt','divineShield','reborn','poison']) if(tags.includes(tag) && KEYWORD_ADAPTERS[card.id]?.includes(STATIC_KEYWORD_GEAR[tag].gear)) {
      const descriptor=STATIC_KEYWORD_GEAR[tag],gearId=descriptor.gear;
      rows.push({trigger:'gain',sourceTrigger:'staticCombat',recipient:'self',duration:'permanentWornGear',kind:'keywordGear',text:`<b>${descriptor.label}</b>`,textEn:tag,tags:[tag],params:{},adapter:[`independent:${gearId}`],implementation:'supported',unsupportedReason:null});
    }
    if(/Also damages the minions next to whom(?:ever)? this attacks/i.test(variant.text_en||'') && KEYWORD_ADAPTERS[card.id]?.includes('巨锤盟约')) {
      const gearId='巨锤盟约';
      rows.push({trigger:'gain',sourceTrigger:'staticCombat',recipient:'self',duration:'permanentWornGear',kind:'keywordGear',text:'<b>攻击相邻随从</b>',textEn:'cleave',tags:['cleave'],params:{},adapter:[`independent:${gearId}`],implementation:'supported',unsupportedReason:null});
    }
    return rows;
  }
  const base = parseEffect(card, variant), found = [];
  const combatMetadata=darkmoonCombatMetadata(card.id,isElite);
  if(combatMetadata) Object.assign(base,{trigger:typeof combatMetadata.trigger==='string'?combatMetadata.trigger:'combat',sourceTrigger:'darkmoonCombat',recipient:({BGS_046:'hand',BGS_121:'combatSummonAndHand',BGS_200:'inventory'})[card.id]||combatMetadata.recipient||'combatants',duration:combatMetadata.duration||'thisCombat',kind:'sourceSpecificCombat',adaptation:combatMetadata.text,adapter:['darkmoonCombat'],params:{sourceId:card.id},implementation:'supported',unsupportedReason:null});
  for (const tag of ['taunt','divineShield','reborn','poison']) if (base.tags.includes(tag)&&KEYWORD_ADAPTERS[card.id]?.some(name=>name===STATIC_KEYWORD_GEAR[tag].gear)) found.push(tag);
  if (/Also damages the minions next to whom(?:ever)? this attacks/i.test(variant.text_en || '')&&KEYWORD_ADAPTERS[card.id]?.includes('巨锤盟约')) found.push('cleave');
  const rows = found.map(tag => {
    const descriptor = STATIC_KEYWORD_GEAR[tag];
    return { trigger:'gain', sourceTrigger:'staticCombat', recipient:'self', duration:'permanentWornGear', kind:'keywordGear', text:`<b>${descriptor.label}</b>`, textEn:tag, tags:[tag], params:{}, adapter:[`independent:${descriptor.gear}`], implementation:KEYWORD_ADAPTERS[card.id]?.includes(descriptor.gear) ? 'supported' : 'unsupported', unsupportedReason:KEYWORD_ADAPTERS[card.id]?.includes(descriptor.gear) ? null : 'Static keyword has no source-id-specific delivery rule wired.' };
  });
  if (/\bMagnetic\b/i.test(variant.text_en || '')) rows.push({ trigger:'gain', sourceTrigger:'optionalMagneticFusion', recipient:'selectedColumbiaFriendly', duration:'permanentAttachment', kind:'magneticAttachment', text:'磁力', textEn:'Magnetic', tags:['magnetic'], params:{sourceId:card.id,faction:'哥伦比亚'}, adapter:['darkmoonMagneticMerge'], implementation:['BOT_312','BOT_911'].includes(card.id)?'supported':'unsupported', unsupportedReason:['BOT_312','BOT_911'].includes(card.id)?null:'Magnetic source has no source-id-specific merge adapter.' });
  const textWithoutTags=(variant.text_en||'').replace(/<b>(?:Taunt|Divine Shield|Reborn|Poisonous|Windfury|Mega-Windfury)<\/b>/gi,'').replace(/\bMagnetic\b/gi,'').replace(/\[x\]/gi,'').replace(/<[^>]*>/g,'').replace(/[\s\n.,:;]+/g,'');
  const hasMainText=Boolean(textWithoutTags);
  if (hasMainText) {
    if (KEYWORD_ADAPTERS[card.id] && found.length===0) {
      const names=KEYWORD_ADAPTERS[card.id];
      Object.assign(base,{trigger:'gain',recipient:'self',duration:'permanentWornGear',kind:'keywordGear',adapter:names.map(n=>`independent:${n}`),implementation:'supported',unsupportedReason:null});
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
    for(const row of [...normal,...elite]) {
      if(['selectedFriendlyDragon','selectedFriendlyBeast','selectedFriendlyMechanical'].includes(row.recipient)) row.targetSelection={kind:'friendly',faction:row.params?.faction||({selectedFriendlyDragon:'卡西米尔',selectedFriendlyBeast:'叙拉古',selectedFriendlyMechanical:'哥伦比亚'}[row.recipient]),count:1};
      if(row.kind==='magneticAttachment') row.targetSelection={kind:'magnetic',faction:'哥伦比亚',count:1,optional:true};
      if(row.recipient==='selectedShopMinion')row.targetSelection={kind:'shopSlot',count:1,excludeSource:true};
    }
    for(const row of normal) { row.text=deliveryDisplay(row,'normal','badges'); row.textEn=''; }
    for(const row of elite) { row.text=deliveryDisplay(row,'elite','badges'); row.textEn=''; }
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
      authoredRule: PREP_ADAPTERS[card.id] ? {
        sourceId:card.id, mechanic:PREP_ADAPTERS[card.id].kind,
        normal:{trigger:PREP_ADAPTERS[card.id].trigger,recipient:PREP_ADAPTERS[card.id].recipient,duration:PREP_ADAPTERS[card.id].duration,adapter:PREP_ADAPTERS[card.id].adapter,params:{...structuredClone(PREP_ADAPTERS[card.id].params),...(PREP_ADAPTERS[card.id].runtimeParams?.normal||{}),...(card.id==='BGS_055'?{count:1}:{})}, ...(PREP_ADAPTERS[card.id].note?{adaptation:PREP_ADAPTERS[card.id].note}:{})},
        elite:{trigger:PREP_ADAPTERS[card.id].trigger,recipient:PREP_ADAPTERS[card.id].recipient,duration:PREP_ADAPTERS[card.id].duration,adapter:PREP_ADAPTERS[card.id].adapter,params:{...structuredClone(PREP_ADAPTERS[card.id].params),...(PREP_ADAPTERS[card.id].runtimeParams?.elite||{}),...(card.id==='BGS_055'?{count:2}:{})}, ...(PREP_ADAPTERS[card.id].note?{adaptation:PREP_ADAPTERS[card.id].note}:{})},
        status:'supported',reason:null
      } : DARKMOON_COMBAT_SUPPORTED_IDS.includes(card.id) ? {
        sourceId:card.id,mechanic:'darkmoonCombat',
        normal:darkmoonCombatMetadata(card.id,false),elite:darkmoonCombatMetadata(card.id,true),status:'supported',reason:null
      } : SOURCE_RULES[card.id] ? structuredClone(SOURCE_RULES[card.id]) : KEYWORD_ADAPTERS[card.id] ? {
        sourceId:card.id,
        mechanic:'keywordGearGrant',
        normal:{trigger:'gain',recipient:'self',duration:'permanentWornGear',outputs:KEYWORD_ADAPTERS[card.id].map(name=>({id:`independent:${name}`,quantity:1}))},
        elite:{trigger:'gain',recipient:'self',duration:'permanentWornGear',outputs:KEYWORD_ADAPTERS[card.id].map(name=>({id:`independent:${name}`,quantity:1}))},
        status:'supported',
        reason:null
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
  nativeDispatchedKeywordGear: entries.filter(x=>KEYWORD_ADAPTERS[x.sourceId]).length,
  nativeDispatchedCombatSources:entries.filter(x=>DARKMOON_COMBAT_SUPPORTED_IDS.includes(x.sourceId)).map(x=>({id:x.sourceId,name:x.name,normal:darkmoonCombatMetadata(x.sourceId,false),elite:darkmoonCombatMetadata(x.sourceId,true)})),
  sourceSpecificPrepAdapters:entries.filter(x=>PREP_ADAPTERS[x.sourceId]).map(x=>({id:x.sourceId,name:x.name,mechanic:PREP_ADAPTERS[x.sourceId].kind,status:'supported',normal:x.metadata.op.effectDelivery.normal,elite:x.metadata.op.effectDelivery.elite})),
  totalNormalEffects:entries.reduce((n,x)=>n+x.metadata.op.effectDelivery.normal.length,0),
  totalEliteEffects:entries.reduce((n,x)=>n+x.metadata.op.effectDelivery.elite.length,0),
  deliveryCounts:{
    normal:{pendingLanding:entries.flatMap(x=>x.metadata.op.effectDelivery.normal).filter(e=>e.implementation==='dispatched-pending-gear-landing-verification').length,unsupported:entries.flatMap(x=>x.metadata.op.effectDelivery.normal).filter(e=>e.implementation==='unsupported').length},
    elite:{pendingLanding:entries.flatMap(x=>x.metadata.op.effectDelivery.elite).filter(e=>e.implementation==='dispatched-pending-gear-landing-verification').length,unsupported:entries.flatMap(x=>x.metadata.op.effectDelivery.elite).filter(e=>e.implementation==='unsupported').length}
  },
  executableByNative: entries.filter(x => x.metadata.op.effectDelivery.normal.every(e=>e.implementation==='supported') && x.metadata.op.effectDelivery.elite.every(e=>e.implementation==='supported')).length,
  unsupportedSourceIds: entries.filter(x=>[...x.metadata.op.effectDelivery.normal,...x.metadata.op.effectDelivery.elite].some(e=>e.implementation==='unsupported')).map(x=>({id:x.sourceId,name:x.name,reason:x.metadata.op.effectDelivery.normal.find(e=>e.implementation==='unsupported')?.unsupportedReason || 'At least one variant effect is unsupported.'})),
  verifiedKeywordGearSourceIds: entries.filter(x=>KEYWORD_ADAPTERS[x.sourceId]).map(x=>({id:x.sourceId,name:x.name,gear:KEYWORD_ADAPTERS[x.sourceId]})),
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
    sourceRefs:{ darkmoon19_2:{ id:x.sourceId, name:x.name, nameEn:x.nameEn, tier:x.originalTier, rosterTribe:x.rosterTribe, faction:x.faction, nationId:x.nationId, originalRaces:x.originalRaces, battlecry:hasOwnBattlecry(x.sourceTextsEn.normal), deathrattle:hasOwnDeathrattle(x.sourceTextsEn.normal), version:x.sourceVersion, type:'Battlegrounds', sourceUrl:x.sourceUrl }, cards:[{id:x.sourceId,name:x.name,nameEn:x.nameEn,tier:x.originalTier,version:x.sourceVersion,type:'Battlegrounds',sourceUrl:x.sourceUrl,text:x.sourceTexts.normal,textElite:x.sourceTexts.elite}] },
    authoredRule:x.authoredRule,
    metadata:{op:{effectDelivery:x.metadata.op.effectDelivery}},
    effectDelivery:x.metadata.op.effectDelivery,
    modeEffects:null
  })),
  pendingNativeDefinitions: entries.filter(x=>!nativeByName.has(x.operator)).map(x=>({name:x.operator,sourceId:x.sourceId})),
  supportOperators:[
    {id:'darkmoon:support-cat-1-1',name:'召唤猫',attack:1,health:1,faction:'叙拉古',sourceId:'CFM_315',recruitable:false,mergeable:false,freePoolCopy:true},
    {id:'darkmoon:support-cat-2-2',name:'强化召唤猫',attack:2,health:2,faction:'叙拉古',sourceId:'CFM_315',recruitable:false,mergeable:false,freePoolCopy:true},
    {id:'darkmoon:support-elemental-2-2',name:'炎阵营支援单位',attack:2,health:2,faction:'炎',sourceId:'BGS_115',recruitable:false,mergeable:false,freePoolCopy:true}
  ]
};
const gameTextAddon = {
  schema:'stronghold.darkmoon-game-text-addon/v1',
  sourceBuild:roster.sourceBuild,
  basedOnGameText:path.basename(gameTextPath),
  operators:Object.fromEntries(entries.map(x=>{
    const render=(variant,mode)=>[...new Set((x.metadata.op.effectDelivery[variant]||[]).map(e=>deliveryDisplay(e,variant,mode)))].join('\n');
    const sourceCard={id:x.sourceId,name:x.name,nameEn:x.nameEn,tier:x.originalTier,version:x.sourceVersion,type:'Battlegrounds',sourceUrl:x.sourceUrl,text:x.sourceTexts.normal,textElite:x.sourceTexts.elite};
    return [x.operator,{sourceId:x.sourceId,name:x.name,nameEn:x.nameEn,normal:render('normal','badges'),elite:render('elite','badges'),normalEn:'',eliteEn:'',sourceRefs:{cards:[sourceCard]},
      normalLevels:render('normal','levels'),eliteLevels:render('elite','levels')}];
  }))
};
for (const [p, value] of [[designAddonPath,designAddon],[gameTextAddonPath,gameTextAddon]]) {
  fs.mkdirSync(path.dirname(p), { recursive:true });
  fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n');
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ blueprint: outPath, designAddon:designAddonPath, gameTextAddon:gameTextAddonPath, report: reportPath, cards: entries.length, nativeDefinitionMatches:designAddon.operators.length, counts, executable: report.executableByNative }, null, 2));
