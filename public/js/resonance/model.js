// Pure, player-facing reshaping helpers for the Resonance page.
export const pieceNum = (uid) => Number(String(uid).replace(/^\D+/, ''));
export const isDeployed = (piece) => piece?.row != null && piece?.col != null;
export function prepView(state,catalog) {
  const bench = (state?.pieces || []).filter((piece) => !isDeployed(piece));
  const toRender = (piece) => ({ uid: pieceNum(piece.uid), kind: 'chess', id: piece.operatorId,
    tier: catalog?.operators?.[piece.operatorId]?.cost ?? 1, resonanceStar: Number(piece.star), items: [], ...(isDeployed(piece) ? { row: piece.row, col: piece.col, dir: piece.dir || 'RIGHT' } : {}) });
  return { hand: Array.from({ length: 9 }, (_, i) => bench[i] ? toRender(bench[i]) : null), temp: [],
    board: (state?.pieces || []).filter(isDeployed).map(toRender), nextEnemies: state?.nextEnemies || [] };
}
export function formatStat(value, suffix = '') { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? `${Number(value)}${suffix}` : '—'; }
export function detailHash(kind, id) { return `#${encodeURIComponent(kind)}-${encodeURIComponent(id)}`; }
export function parseDetailHash(hash) {
  const raw=String(hash||'').replace(/^#/,'');const at=raw.indexOf('-');if(at<1)return null;
  try{return {kind:decodeURIComponent(raw.slice(0,at)),id:decodeURIComponent(raw.slice(at+1))}}catch{return null}
}
export function filterOperators(operators, activeIds, {query='',cost='',pact='',role='',onlyActive=false}={}) {
  const needle=String(query).trim().toLocaleLowerCase();const active=new Set(activeIds||[]);
  return Object.entries(operators||{}).filter(([id,op])=>(!onlyActive||active.has(id))&&(!needle||`${id} ${op.name||''}`.toLocaleLowerCase().includes(needle))&&(!cost||Number(op.cost)===Number(cost))&&(!pact||(op.pacts||[]).includes(pact))&&(!role||op.role===role));
}
export function choiceDescription(choice, option, state, catalog) {
  if(choice?.type==='strategy') {const s=catalog.strategies?.[option];return [s?.description,s?.condition&&`条件：${strategyConditionText(s.condition)}`,s?.timing&&`时点：${strategyTimingText(s.timing)}`].filter(Boolean).join(' · ')||'策略效果将在详情中显示';}
  if(choice?.type==='pact_tag'||choice?.type==='identity_transfer')return catalog.pacts?.[option]?.description||'获得该盟约身份';
  if(choice?.type==='disassemble') {const found=[...(state.inventory||[]),...(state.pieces||[]).flatMap(p=>p.equipment||[])].find(x=>x.uid===option);return found?`${catalog.equipment?.[found.itemId]?.description||''} · 拆解为基础组件`:'拆解这件装备';}
  if(choice?.type==='recipe') {const recipe=(catalog.recipes||[]).find(entry=>entry.resultId===option);return recipe?`${recipe.names.join(' + ')} → ${recipe.resultName}`:'选择这件装备后将按配方合成';}
  const piece=(state.pieces||[]).find(p=>p.uid===option);if(piece)return `${piece.operator?.name||catalog.operators?.[piece.operatorId]?.name||'干员'} · ${piece.star}星 · ${piece.row==null?'备战区':'已部署'}`;
  const item=catalog.equipment?.[option];if(item)return item.description||'获得这件装备';
  const op=catalog.operators?.[option];if(op)return `${op.cost}费 · ${roleLabel(op.role)} · ${(op.pacts||[]).map(id=>catalog.pacts?.[id]?.name).filter(Boolean).join(' / ')}`;
  return '领取这项补给';
}
export function strategyConditionText(condition) {
 if(typeof condition==='string'&&condition.trim())return condition;if(!condition)return '按策略说明生效';const p=condition.params||{};
 switch(condition.kind){case'always':return '无额外条件';case'metric_threshold':return `达成${p.metric||'指定目标'} ${p.threshold??''}次`;case'current_hp_above':return `目标生命高于${p.value??p.threshold??'指定值'}`;case'no_owned_cost':return `尚未拥有${p.cost??'指定费用'}费干员`;case'gold_min':return `至少持有${p.value??p.amount??'指定数量'}金币可选`;case'start_of_run':return '开局时生效';case'formation_count':return `阵容中至少有${p.count??p.value??'指定数量'}名符合条件的干员`;case'choose_adjacent_pair':return '选择相邻的两名干员';default:return '需满足策略条件';}
}
export function strategyTimingText(timing) {
 if(typeof timing==='string'&&timing.trim()&&!['on-pick','run-or-node','battle-metric','node-delay','battle-start','on-node-start','on-battle-start','on-battle-end','delayed','task'].includes(timing))return timing;const known={'on-pick':'选择后立即','run-or-node':'每场开局或节点开始','battle-metric':'达成战斗目标后','node-delay':'延后若干节点','battle-start':'战斗开始时','on-node-start':'节点开始时','on-battle-start':'战斗开始时','on-battle-end':'战斗结算时','delayed':'延后生效','task':'完成目标后'};return known[timing]||'按节点规则生效';
}
export function strategyProgressText(progress) {
 if(typeof progress?.progressText==='string'&&progress.progressText.trim())return progress.progressText;
 return '';
}
export function needsAdjacentStrategyPair(strategy) { return strategy?.conditionKind === 'choose_adjacent_pair'; }
export function roleLabel(role) {return ({damage:'输出',frontline:'前排',control:'控场',healer:'治疗',summoner:'召唤',support:'辅助'})[role]||'干员';}
export function adjacentDeployedPairs(state) {
 const pieces=(state?.pieces||[]).filter(piece=>piece.row!=null&&piece.col!=null);const pairs=[];
 for(let i=0;i<pieces.length;i++)for(let j=i+1;j<pieces.length;j++)if(Math.abs(pieces[i].row-pieces[j].row)+Math.abs(pieces[i].col-pieces[j].col)===1)pairs.push([pieces[i],pieces[j]]);
 return pairs;
}
export function actionErrorText(error) {
  const known={NO_FUNDS:'金币不足',SOLD_OUT:'这名干员已售罄',DEPLOY_CAP:'已达到当前人口上限',POPULATION_OVER_CAPACITY:'已达到当前人口上限',ILLEGAL_TILE:'无法部署在该位置',ILLEGAL_DEPLOYMENT:'无法部署在该位置',CELL_OCCUPIED:'这个位置已有干员',NO_DEPLOYED_PIECES:'至少部署一名干员才能开战',BENCH_FULL:'备战区已满',INVENTORY_CAPACITY:'装备背包已满，请先整理装备',EQUIPMENT_CAPACITY:'这名干员的装备槽已满',CROSS_OPERATOR_COMBINE:'只能合成背包装备或同一名干员身上的装备',ITEM_NOT_IN_INVENTORY:'这件装备当前不在背包中',EQUIPPED_ITEM_NOT_FOUND:'找不到这件已装备的物品',RECIPE_NOT_FOUND:'没有适用于这两件装备的配方',TOKEN_NOT_OWNED:'这名干员没有该召唤物',ILLEGAL_SUMMON_POSITION:'召唤位置不可用',COPY_COST_LIMIT:'低费复制器只能用于低费干员',POOL_EMPTY:'该干员已无可用卡池份数',SESSION_NOT_FOUND:'找不到这局存档，它可能已过期',BAD_SESSION:'存档内容无法读取，请重新载入',STALE_REVISION:'对局状态已变化，正在同步',UNKNOWN_ENVIRONMENT:'请选择有效环境',NETWORK:'连接中断，请检查网络后重试',BAD_RESPONSE:'服务器返回的数据暂时无法读取'};
  return known[error?.code]||'操作没有完成，请检查当前阶段后重试';
}
export function choiceLabel(choice, option, state, catalog) {
  if(choice.type==='strategy')return catalog.strategies?.[option]?.name??'策略';
  if(['pact_tag','identity_transfer'].includes(choice.type))return catalog.pacts?.[option]?.name??'盟约';
  if(choice.type==='disassemble') {
    const item=[...(state.inventory??[]),...(state.pieces??[]).flatMap(p=>p.equipment??[])].find(item=>item.uid===option);
    const owner=(state.pieces??[]).find(piece=>piece.equipment?.some(item=>item.uid===option));
    return `${catalog.equipment?.[item?.itemId]?.name??'装备'}${owner?` · ${catalog.operators?.[owner.operatorId]?.name??'干员'}`:''}`;
  }
  const piece=(state.pieces??[]).find(piece=>piece.uid===option);
  if(piece)return `${catalog.operators?.[piece.operatorId]?.name??'干员'} · ${piece.star}星${piece.row==null?' · 备战':''}`;
  if(choice?.type==='recipe'){const recipe=(catalog.recipes||[]).find(entry=>entry.resultId===option);if(recipe)return recipe.resultName;}
  return catalog.equipment?.[option]?.name??catalog.operators?.[option]?.name??'选择目标';
}
export async function copyLink(kind, id) {
  const url = new URL(location.href); url.hash = detailHash(kind, id);
  try { await navigator.clipboard.writeText(url.href); return true; }
  catch { const field = document.createElement('textarea'); field.value = url.href; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select(); const ok = document.execCommand('copy'); field.remove(); return ok; }
}
