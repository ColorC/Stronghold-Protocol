import { eligiblePiecesForEffect } from '../../../shared/independentEligibility.js';

export function buyTargetSpec(slot, catalog) {
  const op=catalog?.operators?.[slot?.id];
  const delivery=op?.effectDelivery||op?.metadata?.op?.effectDelivery||op?.sourceRefs?.darkmoon19_2?.effectDelivery;
  const rows=[...(delivery?.normal||[]),...(delivery?.elite||[])];
  return rows.find(row=>row.targetSelection)?.targetSelection||null;
}

export function buyTargetChoices(spec, state, catalog, buySlot) {
  if(!spec)return [];
  if(spec.kind==='shopSlot')return (state?.shop?.slots||[]).map((slot,index)=>({slot,index})).filter(x=>x.index!==buySlot&&!x.slot.sold&&x.slot.id).map(x=>({kind:'shopSlot',slot:x.index,id:x.slot.id}));
  if(spec.kind==='friendly'||spec.kind==='magnetic') {
    const faction=spec.faction;
    return eligiblePiecesForEffect({behavior:'teamForge',params:{targets:`faction:${faction}`,excludeSelf:false}}, {pieces:state?.pieces||[],catalog}).map(piece=>({kind:'friendly',uid:piece.uid,chessId:piece.chessId,name:catalog?.operators?.[piece.chessId]?.name||piece.name||piece.chessId}));
  }
  return [];
}

export function buyTargetCount(spec, state, catalog, slot) {
  if(spec?.kind==='magnetic')return 1;
  const requested=Math.max(1,Number(spec?.count)||1);
  if(spec?.kind!=='shopSlot'||!catalog?.operators?.[slot?.id]?.sourceRefs?.darkmoon19_2?.battlecry)return requested;
  let extra=0;
  for(const piece of state?.pieces||[]) {
    if(piece.row==null||piece.col==null)continue;
    const rules=catalog?.operators?.[piece.chessId]?.nativeTrait?.effect?.prep||[];
    for(const rule of rules) if(rule.trigger==='aura'&&rule.behavior==='triggerMultiplier'&&rule.params?.hook==='gain'&&rule.params?.filter==='darkmoonBattlecry') {
      const amount=rule.params.extra;
      extra=Math.max(extra,Number(typeof amount==='object'?(piece.elite?amount.elite:amount.normal):amount)||0);
    }
  }
  return requested+extra;
}

export function buyRequiresTarget(spec) {
  return !!spec && !spec.optional;
}
