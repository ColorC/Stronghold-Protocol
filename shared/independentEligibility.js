import { nativeBodyStats, nativeRecord, tavernFactions } from './independentRules.js';
import { composeStats } from './loadoutRecord.js';

const deployed = (piece) => piece?.row != null && piece?.col != null;
const owner = (piece) => piece?.playerId ?? piece?.ownerId;
const formRecord = (piece, catalog) => {
  const op = catalog?.operators?.[piece?.chessId];
  if (op?.source) return nativeRecord(piece, catalog);
  return op || null;
};
const professionOf = (piece, catalog) => formRecord(piece, catalog)?.profession;
const realOperator = (piece, catalog) => {
  if (!piece || piece.deleted || piece.removed || piece.kind && piece.kind !== 'op') return false;
  return !!catalog?.operators?.[piece.chessId];
};
function factionsFor(piece, catalog) {
  const op = catalog?.operators?.[piece?.chessId];
  if (op?.source) return tavernFactions(piece, catalog);
  const factions = new Set([...(piece?.factions || []), ...(op?.factions || []), ...(op?.nativeFactions || [])]);
  if(catalog?.rules?.factionIdentityEquipment===false||catalog?.config?.factionIdentityEquipment===false)return [...factions];
  if (op?.tavernFactionProxy === 'ALL') for (const faction of catalog?.config?.tavernFactions || []) factions.add(faction);
  for (const item of gearItems(piece)) {
    const def = catalog?.equipment?.[item.id] || catalog?.gear?.[item.id] || item;
    const faction = item.state?.faction || item.state?.tavernFaction;
    if (def?.mechanism === 'identityTag' && faction && (catalog?.config?.tavernFactions || []).includes(faction)) factions.add(faction);
  }
  return [...factions];
}
const effectRule = (effect) => effect?.behavior ? effect : effect?.rule?.behavior ? effect.rule : null;
const gearItems = (piece) => [...(piece?.equipment || []), ...(piece?.equipmentDetails || []).map((x) => x?.record ? { ...x, ...x.record } : x)];

function boardOnly(rule) {
  return rule?.behavior === 'teamForge' || rule?.behavior === 'allyConditionStats'
    || rule?.params?.boardOnly === true || rule?.params?.scope === 'boardonly';
}

function matchesMatch(candidate, source, match = {}, catalog) {
  const factions = factionsFor(candidate, catalog);
  const profession = professionOf(candidate, catalog);
  if(match.elite===true&&!candidate.elite&&!String(candidate.chessId).endsWith('_b'))return false;
  if (match.faction && !factions.includes(match.faction)) return false;
  const professions = match.professions || (match.profession ? [match.profession] : null);
  if (professions?.length && !professions.includes(profession)) return false;
  if (match.keywordGear && !gearItems(candidate).some((item) => {
    const def = catalog?.equipment?.[item.id] || catalog?.gear?.[item.id] || item;
    return def?.mechanism === 'keywordGear' && def.name === match.keywordGear && Number(item.quantity ?? 1) > 0;
  })) return false;
  if (match.baseStat) {
    const self = statsForPiece(source, catalog)?.[match.baseStat];
    const own = statsForPiece(candidate, catalog)?.[match.baseStat];
    if (!(Number.isFinite(own) && own >= Number(match.minBaseStat || 0)
      && (!Number.isFinite(match.minBaseStatRatioToSelf) || own >= Number(self || 0) * match.minBaseStatRatioToSelf))) return false;
  }
  return true;
}

function statsForPiece(piece, catalog) {
  if (!piece) return null;
  if (catalog?.operators?.[piece.chessId]?.source) return nativeBodyStats(piece, catalog);
  const base = catalog?.operators?.[piece.chessId];
  const form = piece.elite && base?.eliteChessId ? catalog?.operators?.[base.eliteChessId] || base : base;
  const stats = form?.nativeStats || form?.stats;
  if (!stats) return null;
  const moduleId = piece.moduleId;
  const mod = moduleId && moduleId !== 'none' ? (form.modules || []).find((x) => (x.uniEquipId || x.id) === moduleId) : null;
  const out = mod ? composeStats(stats, mod.attr) : { ...stats };
  if (piece.bodyPenaltyApplied) {
    const penalty = catalog?.rules?.bodyPenalty || {};
    out.atk = Math.floor((out.atk || 0) * (penalty.baseAttackRatio ?? 0.8));
    out.maxHp = Math.floor((out.maxHp || 0) * (penalty.baseLifeRatio ?? 0.8));
  }
  return out;
}


const DARKMOON_CONDITIONAL = new Set(['darkmoonBattlecryTargetGrowth','darkmoonBattlecryFactionGrowth','darkmoonAdjacentGrowth','darkmoonTaggedGrowth','darkmoonEndTurnGrowth','darkmoonBoughtTribeTargetGrowth','darkmoonShopGrowth','darkmoonBoughtSelfGrowth','darkmoonPlayedTribeGrowth','darkmoonRosterTribePurchaseFunds','darkmoonBeastSummonGrowth']);
export function hasConditionalTargets(effect){
  const r=effectRule(effect),p=r?.params||{};
  return !!r&&(DARKMOON_CONDITIONAL.has(r.behavior)||['teamForge','allyConditionStats'].includes(r.behavior)||!!(p.targets||p.match||p.requiresFactionOnField||p.scope==='boardonly'));
}
function projectionRule(rule){
  if(!DARKMOON_CONDITIONAL.has(rule?.behavior))return rule;
  const p={...rule.params,match:{...(rule.params?.match||{})}};
  if(rule.behavior==='darkmoonBoughtTribeTargetGrowth')return {...rule,params:{...p,targets:'all'}};
  p.scope=['darkmoonShopGrowth','darkmoonBoughtSelfGrowth','darkmoonPlayedTribeGrowth','darkmoonRosterTribePurchaseFunds'].includes(rule.behavior)?'all':'boardonly';
  p.targets='all';
  if(p.faction)p.match.faction=p.faction;
  if(rule.behavior==='darkmoonAdjacentGrowth'){p.targets='adjacent';p.excludeSelf=true;}
  if(rule.behavior==='darkmoonTaggedGrowth')p.match.keywordGear='坚守盟约';
  if(rule.behavior==='darkmoonEndTurnGrowth'){
    if(['randomOtherFriendly','randomOtherFaction'].includes(p.mode))p.excludeSelf=true;
    if(p.mode==='selfIfGolden')p.match.elite=true;
    if(p.mode==='leftmostPerPurchase'){p.targets='leftmost';delete p.match.faction;}
  }
  return {...rule,params:p};
}

/** Pure UI projection of the current pieces that satisfy a structured trait/equipment target rule. */
export function eligiblePiecesForEffect(effect, { pieces = [], catalog, source = null } = {}) {
  const rule = projectionRule(effectRule(effect));
  const params = rule?.params || effect?.params || {};
  const behavior = rule?.behavior || effect?.behavior;
  const roster = pieces.filter((piece) => realOperator(piece, catalog)
    && (owner(source) == null || owner(piece) == null || owner(piece) === owner(source))
    && (!boardOnly(rule) || deployed(piece))
    && (!['board', 'boardonly'].includes(params.scope) || deployed(piece))
    && (!['bench', 'hand'].includes(params.scope) || !deployed(piece))
    && (behavior !== 'teamForge' || params.excludeSelf !== true || piece.uid !== source?.uid)
    && (behavior !== 'allyConditionStats' || piece.uid !== source?.uid)
    && matchesMatch(piece, source, params.match || {}, catalog));

  if (params.requiresFactionOnField) return roster.filter((piece) => deployed(piece) && factionsFor(piece, catalog).includes(params.requiresFactionOnField));

  let target = params.targets;
  const excludeSource = behavior === 'allyConditionStats' || params.excludeSelf === true;
  if (typeof target === 'string' && target.startsWith('faction:')) {
    const faction = target.slice(8);
    return roster.filter((piece) => (!excludeSource || piece.uid !== source?.uid) && matchesMatch(piece, source, { faction }, catalog));
  }
  if (typeof target === 'string' && target.startsWith('profession:')) {
    const profession = target.slice(11);
    return roster.filter((piece) => (!excludeSource || piece.uid !== source?.uid) && professionOf(piece, catalog) === profession);
  }
  if (target === 'self' || target === 'selfOnly') return source ? roster.filter((piece) => piece.uid === source.uid) : [];
  if(target==='leftmost')return roster.filter(deployed).sort((a,b)=>a.col-b.col||a.row-b.row).slice(0,1);
  if (target === 'front') {
    if (!source || !deployed(source)) return [];
    const dirs = { RIGHT: [0, 1], LEFT: [0, -1], UP: [-1, 0], DOWN: [1, 0] };
    const [dr, dc] = dirs[source.dir || 'RIGHT'];
    return roster.filter((piece) => piece.uid !== source.uid && piece.row === source.row + dr && piece.col === source.col + dc);
  }
  if (target === 'adjacent') return source && deployed(source) ? roster.filter((piece) => piece.uid !== source.uid
    && Math.abs(piece.row - source.row) + Math.abs(piece.col - source.col) === 1) : [];
  if (target === 'adjacentRadius') return source && deployed(source) ? roster.filter((piece)=>piece.uid!==source.uid
    && Math.hypot(piece.row-source.row,piece.col-source.col)<=Number(params.radius||1.5)) : [];
  if (target === 'row') return source && deployed(source) ? roster.filter((piece) => (!excludeSource || piece.uid !== source.uid) && piece.row === source.row) : [];
  if (target === 'boardonly') return roster.filter(deployed);
  if (Array.isArray(target)) {
    const matched = target.flatMap((scope) => eligiblePiecesForEffect({ behavior, params: { ...params, targets: scope } }, { pieces, catalog, source }));
    return [...new Map(matched.map((piece) => [piece.uid, piece])).values()];
  }
  // teamForge is board scoped by its mechanics; all is board scoped for battle ally effects only.
  if (target === 'all' && behavior !== 'teamForge' && behavior !== 'allyConditionStats') return roster.filter(piece=>!excludeSource||piece.uid!==source?.uid);
  if (behavior === 'teamForge' || behavior === 'allyConditionStats') return roster.filter(deployed);
  return target == null ? roster.filter(piece=>!excludeSource||piece.uid!==source?.uid) : [];
}

const NON_FIELD_EFFECTS = new Set([
  'darkmoonBoughtSelfGrowth', 'darkmoonShopGrowth', 'darkmoonRosterTribePurchaseFunds',
  'darkmoonAddTribeShopOffer', 'darkmoonRecruitTribeToHand', 'darkmoonBoughtTribeTargetGrowth',
]);
const FIELD_RULES = new Set([
  'teamForge', 'allyConditionStats', 'battleStartBuff', 'darkmoonCombat',
  'darkmoonBattlecryTargetGrowth', 'darkmoonBattlecryFactionGrowth', 'darkmoonAdjacentGrowth',
  'darkmoonTaggedGrowth', 'darkmoonEndTurnGrowth', 'darkmoonPlayedFactionCountSelfGrowth',
  'darkmoonPlayedTribeGrowth', 'forgeFactionTierPair', 'forgeAdjacent', 'deathrattleEcho',
  'dominantFactionRecruit', 'warbandEvent', 'aura',
]);

/**
 * UI-only list of current field operators relevant to a conditional effect.
 * null means the effect is not conditioned on the current field; [] is a real zero.
 * This deliberately does not replace eligiblePiecesForEffect, which also serves action selectors.
 */
export function fieldConditionPiecesForEffect(effect, { pieces = [], catalog, source = null, rangeTiles = null } = {}) {
  const raw = effectRule(effect);
  if (!raw || NON_FIELD_EFFECTS.has(raw.behavior) || !FIELD_RULES.has(raw.behavior)) return null;
  const p = raw.params || {};
  if (raw.behavior === 'darkmoonPlayedTribeGrowth' && p.scope !== 'boardonly' && p.scope !== 'board') return null;

  let params = { ...p, scope: 'boardonly' };
  let excludeSelf = p.excludeSelf === true;
  switch (raw.behavior) {
    case 'forgeFactionTierPair':
      if (!p.faction) return null;
      params.targets = `faction:${p.faction}`;
      params.excludeSelf = false;
      break;
    case 'forgeAdjacent':
      if (!deployed(source)) return null;
      params.targets = p.direction === 'front' ? ['self', 'front'] : ['self', 'adjacent'];
      params.excludeSelf = false;
      break;
    case 'deathrattleEcho':
      if (!p.faction) return null;
      params.targets = `faction:${p.faction}`;
      params.excludeSelf = true;
      break;
    case 'dominantFactionRecruit':
      if (!deployed(source) || !String(p.normalRequires || p.eliteRequires || '').startsWith('sameRowCount>=')) return null;
      params.targets = 'row';
      params.excludeSelf = false;
      break;
    case 'darkmoonPlayedFactionCountSelfGrowth':
      if (!p.faction) return null;
      params.targets = `faction:${p.faction}`;
      params.excludeSelf = false;
      break;
    case 'warbandEvent':
      // For effects received by self, the condition is the triggering ally (e.g. a Siracusan retiree).
      if (p.targets === 'self' && p.faction) {
        params.targets = `faction:${p.faction}`;
        params.excludeSelf = p.event === 'death';
      } else if (p.targets === 'actor' && p.faction) {
        params.targets = `faction:${p.faction}`;
        params.excludeSelf = false;
      } else if (p.targetFaction) {
        params.targets = `faction:${p.targetFaction}`;
        params.excludeSelf = false;
      } else if (!p.match && !p.targets) return null;
      break;
    case 'darkmoonCombat':
      // A unit created by a future summon is not a current field candidate.
      if (p.event === 'summon' || p.actor === 'newSummonedToken') return null;
      // Deployment payloads react to the deployed actor, not the source operator or the effect recipients.
      // UnitInfo can represent tokens which are not entries in state.pieces; keep this UI projection separate
      // from eligiblePiecesForEffect, whose operator-only semantics are used by gameplay target selectors.
      if (p.event === 'deploy' && p.actor === 'deployedFriendly' && Array.isArray(p.actorKinds)) {
        const kinds = new Set(p.actorKinds);
        const match = p.match || {};
        const hasKeyword = (piece, keyword) => {
          if (keyword === '坚守盟约' && piece.darkmoonCover) return true;
          return matchesMatch(piece, source, { keywordGear: keyword }, catalog);
        };
        return pieces.filter((piece) => {
          const kind = piece.kind || (catalog?.operators?.[piece.chessId] ? 'op' : null);
          if (!kinds.has(kind) || !deployed(piece) || piece.deleted || piece.removed) return false;
          if (p.excludeSelf && source?.uid != null && piece.uid === source.uid) return false;
          if (owner(source) != null && owner(piece) != null && owner(source) !== owner(piece)) return false;
          const factions = new Set([...(piece.factions || []), ...(piece.darkmoonFactionTags || []), ...factionsFor(piece, catalog)]);
          if (match.faction && !factions.has(match.faction)) return false;
          if (match.keywordGear && !hasKeyword(piece, match.keywordGear)) return false;
          return true;
        });
      }
      // Older field-scoped payload rules already name a current ally match. Do not count generic future effects.
      if (!p.match && !p.requiresFactionOnField && p.scope !== 'boardonly') return null;
      params.targets = 'all';
      break;
    case 'aura':
      if (p.targets !== 'inRange' || !Array.isArray(rangeTiles) || !deployed(source)) return null;
      params.targets = 'boardonly';
      break;
    case 'darkmoonBattlecryTargetGrowth':
    case 'darkmoonBattlecryFactionGrowth':
    case 'darkmoonAdjacentGrowth':
    case 'darkmoonTaggedGrowth':
    case 'darkmoonEndTurnGrowth':
      params = projectionRule(raw).params;
      params.scope = 'boardonly';
      break;
    case 'darkmoonPlayedTribeGrowth':
      if (!p.faction && !p.match) return null;
      params.targets = p.targets || (p.faction ? `faction:${p.faction}` : 'all');
      break;
    default:
      break;
  }

  const rule = { ...raw, params };
  let matched = eligiblePiecesForEffect(rule, { pieces, catalog, source });
  if (raw.behavior === 'aura') {
    const allowed = new Set(rangeTiles.map((x) => Array.isArray(x) ? `${x[0]},${x[1]}` : `${x.row},${x.col}`));
    matched = matched.filter((piece) => piece.uid !== source?.uid && allowed.has(`${piece.row},${piece.col}`));
    const hpAbove = p.only?.hpAbove;
    if (hpAbove != null) matched = matched.filter((piece) => {
      const maxHp = Number(piece.maxHp ?? piece.maxHP ?? statsForPiece(piece, catalog)?.maxHp);
      const hp = Number(piece.hp ?? piece.currentHp ?? maxHp);
      return maxHp > 0 && hp / maxHp > Number(hpAbove);
    });
  }
  return matched.filter((piece) => deployed(piece) && (!excludeSelf || piece.uid !== source?.uid));
}

/** Deployed purchase reactors request one shared recipient before any funds or pool stock are consumed. */
export function reactiveBuyTargetSpec(slot, state, catalog) {
  if(!slot?.id || !state?.pieces) return null;
  const buyerFactions=factionsFor({chessId:slot.id},catalog);
  const holders=state.pieces.filter(piece=>realOperator(piece,catalog)&&deployed(piece)
    && (catalog.operators[piece.chessId]?.nativeTrait?.effect?.prep||catalog.operators[piece.chessId]?.effectRules?.prep||[]).some(rule=>rule.trigger==='bought' && rule.behavior==='darkmoonBoughtTribeTargetGrowth' && buyerFactions.includes(rule.params?.triggerFaction)));
  return holders.length ? {kind:'friendly',count:1,scope:'boardonly',sourceUids:holders.map(piece=>piece.uid)} : null;
}
