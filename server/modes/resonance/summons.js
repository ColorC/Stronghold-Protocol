import { canPlace, ownerRangeKeys, positionClass } from '../../match/board.js';

export function selectedSummonIds(operator, star) {
  const record=operator?.stars?.[star]?.record??{};
  const ids=(record.skill?.tokens??record.tokens??[]).map(x=>typeof x==='string'?x:x?.tokenId).filter(Boolean);
  return [...new Set(record.skill?.overrideTokenKey?ids.filter(id=>id===record.skill.overrideTokenKey):ids)];
}

export function legalSummonCells(field, state, piece, operator, tokenId) {
  if(!field?.resolveToken||!(field.deployMap instanceof Map)||piece.row==null)return [];
  const token=field.resolveToken(tokenId,operator.id,operator.fixedSkillIndex);
  if(!token||!token.placeable)return [];
  const occupied=new Set(state.pieces.filter(p=>p.row!=null).map(p=>`${p.row},${p.col}`));
  for(const other of state.pieces)for(const order of other.summonOrders??[])
    if(other.uid!==piece.uid||order.tokenId!==tokenId)occupied.add(`${order.row},${order.col}`);
  const range=token.ownerRange?ownerRangeKeys(operator.stars[piece.star].record.rangeGrid,piece.row,piece.col,piece.dir):null;
  return [...field.deployMap.keys()].filter(key=>{
    const [r,c]=key.split(',').map(Number);
    return !occupied.has(key)&&(!range||range.has(key))&&canPlace(field.deployMap,positionClass(token),r,c);
  });
}
