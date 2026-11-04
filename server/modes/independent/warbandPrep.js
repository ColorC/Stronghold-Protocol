import { tavernFactions } from '../../../shared/independentRules.js';
import { validateWarbandRule } from '../../../shared/warbandSchema.js';
const present = p => p && p.row != null && p.col != null && !p.removed && !p.deleted;
const owner = p => p?.playerId ?? p?.ownerId;
const uidOrder = (a,b) => String(a.uid).localeCompare(String(b.uid));
export function shopCarryApplies(effect, slot, catalog) {
  return !effect.faction || tavernFactions({ chessId: slot.id, equipment: [] }, catalog).includes(effect.faction);
}
export function runFactionReaction(state, holder, event, rule, services) {
  validateWarbandRule(rule);
  const p = rule.params, gained = event.piece, catalog = services.catalog;
  if (!gained || owner(gained) !== owner(holder)) return;
  if (['gain','sold'].includes(rule.trigger) && gained.uid !== holder.uid) return;
  if (!['discount','funds'].includes(p.mode) && !p.anyGainFaction && !tavernFactions(gained,catalog).includes(p.faction)) return;
  if ((p.requireGainTrait||p.anyGainFaction) && !(catalog.operators?.[gained.chessId]?.nativeTrait?.effect?.prep || []).some(r => r.trigger === 'gain')) return;
  const memo = ((holder.nativeState ||= {}).warbandReactions ||= {});
  const key = JSON.stringify(rule);
  if (memo[key]?.round !== state.round) memo[key] = { round: state.round, count: 0 };
  if (memo[key].count >= p.maxEventsPerPrep) return;
  memo[key].count++;
  const scale = p.perTier ? Number(catalog.operators?.[gained.chessId]?.tier || 1) : 1;
  if (p.mode === 'refund' || p.mode === 'funds') { state.funds = Number(state.funds || 0) + p.count * scale; return; }
  if (p.mode === 'discount') { state.shop.upgradePrice = Math.max(0, Number(state.shop.upgradePrice || 0) - p.count * scale); return; }
  if (!p.outputs.every(o => catalog.badges?.[o.id] || catalog.equipment?.[o.id]?.mechanism === 'badge')) throw new Error('FACTION_REACTION_REQUIRES_BADGES');
  if (p.mode === 'shop') {
    for (const output of p.outputs) {
      const quantity = output.quantity * scale;
      const effects = (state.playerEffects ||= []);
      let fx = effects.find(x => x.type === 'shopCarry' && x.id === output.id && x.faction === p.faction);
      if (!fx) { fx = { type:'shopCarry',id:output.id,faction:p.faction,quantity:0 }; effects.push(fx); }
      fx.quantity += quantity;
      for (const slot of state.shop.slots || []) if (!slot.sold && slot.kind === 'chess' && shopCarryApplies(fx,slot,catalog)) (slot.equipment ||= []).push({ id:output.id,quantity,origin:'shopCarry' });
    }
    return;
  }
  let targets = (state.pieces || []).filter(x => present(x) && (!x.kind || x.kind === 'op') && owner(x) === owner(holder) && (!p.excludeSelf || x.uid !== holder.uid));
  if(p.targets!=='self'&&!p.targetAnyFaction)targets=targets.filter(x=>tavernFactions(x,catalog).includes(p.targetFaction||p.faction));
  if (p.targets === 'self') targets = targets.filter(x => x.uid === holder.uid);
  if (p.targets === 'front') {
    const [dr,dc] = { RIGHT:[0,1],LEFT:[0,-1],UP:[-1,0],DOWN:[1,0] }[holder.dir || 'RIGHT'];
    targets = targets.filter(x => x.row === holder.row + dr && x.col === holder.col + dc);
  }
  targets.sort(p.targets === 'leastEquipment' ? (a,b) => (a.equipment || []).reduce((n,x)=>n+(x.quantity||1),0) - (b.equipment || []).reduce((n,x)=>n+(x.quantity||1),0) || uidOrder(a,b) : uidOrder);
  for (const target of p.targets==='all'?targets:targets.slice(0,p.count)) for (const output of p.outputs) services.grantEquipment(state,output.id,output.quantity*scale,{ origin:'native',sourceUid:holder.uid,targetUid:target.uid,landOn:`uid:${target.uid}` });
}
