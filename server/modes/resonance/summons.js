import { canPlace, ownerRangeKeys, positionClass } from '../../match/board.js';

export function selectedSummonIds(operator, star) {
  const record=operator?.stars?.[star]?.record??{};
  const ids=(record.skill?.tokens??record.tokens??[]).map(x=>typeof x==='string'?x:x?.tokenId).filter(Boolean);
  return [...new Set(record.skill?.overrideTokenKey?ids.filter(id=>id===record.skill.overrideTokenKey):ids)];
}

/** Which copy of its summon an order places: orders saved before copies existed carry none and are the first (copy 0). */
export const orderCopy=(order)=>Number.isInteger(order?.copy)&&order.copy>0?order.copy:0;

/** How many copies of a placeable summon its owner may place (data `deployLimit`: 凯瑟琳 2, 罗比菈塔 3, 机械水獭 5, “夹子” 10). */
export function summonLimit(token) {
  const limit=Math.floor(Number(token?.deployLimit??token?.stats?.deployLimit??token?.raw?.deployLimit??token?.raw?.stats?.deployLimit));
  return Number.isFinite(limit)&&limit>=1?Math.min(limit,10):1;
}

/** The placeable summons a deployed operator offers the player: [{ tokenId, token, limit }] (token records from the field's resolver). */
export function placeableSummons(field, operator, star) {
  if(!field?.resolveToken||!operator)return [];
  return selectedSummonIds(operator,star).map(tokenId=>{
    const token=field.resolveToken(tokenId,operator.id,operator.fixedSkillIndex);
    return token?.placeable?{tokenId,token,limit:summonLimit(token)}:null;
  }).filter(Boolean);
}

/**
 * Tiles where a summon of `piece` may stand: free of operators and of every other placed summon, legal for the summon's
 * position class and — for 狼群 / 流形 ("只能部署在召唤者攻击范围内") — inside the owner's attack range.
 * `except` ({ pieceUid, tokenId, copy }) is a placed copy being moved: its own tile counts as free. Without it a token
 * that allows one copy is re-placed (its single order is the one replaced); one that allows several gets a new copy.
 */
export function legalSummonCells(field, state, piece, operator, tokenId, except=undefined) {
  if(!field?.resolveToken||!(field.deployMap instanceof Map)||piece.row==null)return [];
  const token=field.resolveToken(tokenId,operator.id,operator.fixedSkillIndex);
  if(!token||!token.placeable)return [];
  if(except===undefined&&summonLimit(token)===1)except={pieceUid:piece.uid,tokenId,copy:0};
  const occupied=new Set(state.pieces.filter(p=>p.row!=null).map(p=>`${p.row},${p.col}`));
  for(const entity of state.specialEntities??[])if(Number.isInteger(entity?.row)&&Number.isInteger(entity?.col))occupied.add(`${entity.row},${entity.col}`);
  for(const other of state.pieces)for(const order of other.summonOrders??[])
    if(!(except&&other.uid===except.pieceUid&&order.tokenId===except.tokenId&&orderCopy(order)===except.copy))occupied.add(`${order.row},${order.col}`);
  const range=token.ownerRange?ownerRangeKeys(operator.stars[piece.star].record.rangeGrid,piece.row,piece.col,piece.dir):null;
  return [...field.deployMap.keys()].filter(key=>{
    const [r,c]=key.split(',').map(Number);
    return !occupied.has(key)&&(!range||range.has(key))&&canPlace(field.deployMap,positionClass(token),r,c);
  });
}

/** The orders of `piece` that stay legal once it stands where it now stands: a range-bound summon outside the owner's attack range goes back. */
export function ordersStillInRange(field, piece, operator) {
  const orders=piece.summonOrders??[];
  if(!orders.length||!field?.resolveToken||piece.row==null)return orders;
  const range=ownerRangeKeys(operator.stars[piece.star].record.rangeGrid,piece.row,piece.col,piece.dir);
  return orders.filter(order=>{
    const token=field.resolveToken(order.tokenId,operator.id,operator.fixedSkillIndex);
    return !token?.ownerRange||range.has(`${order.row},${order.col}`);
  });
}
