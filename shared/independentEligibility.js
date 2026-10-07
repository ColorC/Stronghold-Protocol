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
