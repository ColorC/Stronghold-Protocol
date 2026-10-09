import { useEffect,useState } from '../../vendor/hooks.module.js';
import { html,Button,Panel,ProgressBar,Tabs } from '../ui/components.js';
import { assets } from '../assets.js';
import { data } from '../data.js';
import { pieceNum,parseDetailHash } from './model.js';
import { LinkCopy } from './panels.js';

const METRICS=[{id:'dmg',label:'伤害'},{id:'heal',label:'治疗'},{id:'taken',label:'承伤'}];
const num=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const shown=value=>{const n=num(value);return n===null?'—':Number.isInteger(n)?String(n):String(Number(n.toFixed(1)))};
const exact=value=>num(value)===null?'未知':String(value);
const roundNumber=entry=>num(entry?.round);

export function BattleReport({state,catalog,onReplay,onDetail}) {
 const battles=(state.history||[]).filter(entry=>entry.type==='fight-settled').slice().sort((a,b)=>(roundNumber(a)??0)-(roundNumber(b)??0));
 const latest=battles.at(-1);
 const initial=()=>{const target=parseDetailHash(location.hash);return target?.kind==='battleReport'&&battles.some(x=>String(x.round)===String(target.id))?String(target.id):String(latest?.round??'')};
 const [selectedRound,setSelectedRound]=useState(initial);
 const [metric,setMetric]=useState('dmg');
 useEffect(()=>{const sync=()=>{const target=parseDetailHash(location.hash);if(target?.kind==='battleReport'&&battles.some(x=>String(x.round)===String(target.id)))setSelectedRound(String(target.id));else if(target?.kind==='section'&&target.id==='battle-report')setSelectedRound(String(latest?.round??''))};addEventListener('hashchange',sync);return()=>removeEventListener('hashchange',sync)},[state.history]);
 const current=battles.find(entry=>String(entry.round)===selectedRound)||latest;
 const units=current?.combatStats?.units;
 const entries=Array.isArray(units)?units.map(unit=>{
   const piece=(state.pieces||[]).find(p=>pieceNum(p.uid)===pieceNum(unit.uid));
   const operator=catalog.operators?.[unit.defId]||catalog.operators?.[piece?.operatorId]||null;
   const token=data.lookup('tokens',unit.defId);
   const kind=String(unit.kind||'').toLowerCase();
   return {unit,piece,operator,token,name:operator?.name||token?.name||(kind==='token'||kind==='summon'?'召唤物':'作战单位'),operatorId:operator?((catalog.operators?.[unit.defId]?unit.defId:piece?.operatorId)||unit.defId):null,value:num(unit[metric])};
 }).sort((a,b)=>a.value===null?(b.value===null?0:1):b.value===null?-1:b.value-a.value):[];
 const maxValue=Math.max(0,...entries.map(entry=>entry.value??0));
 const choose=round=>{setSelectedRound(String(round));location.hash=`battleReport-${encodeURIComponent(round)}`};
 const title=`第 ${current?.round??'—'} 场 · ${current?.won?'守住':'失守'}`;
 return html`<${Panel} id="rs-section-battle-report" title="战斗记录" micro="BATTLE REPORT" class="rs-panel rs-battle-report">
   <nav class="rs-battle-report__rounds" aria-label="选择战斗场次">${battles.slice().reverse().map(entry=>html`<span class="rs-battle-report__round-entry" key=${entry.round}><button id=${`battle-report-${entry.round}`} type="button" class=${`rs-battle-report__round${String(entry.round)===selectedRound?' is-selected':''}`} onClick=${()=>choose(entry.round)}>第 ${entry.round} 场 · ${entry.won?'守住':'失守'}</button><${LinkCopy} kind="battleReport" id=${entry.round} label="链接"/></span>`)}</nav>
   ${current?html`<div class="rs-battle-report__summary"><h3>${title}</h3><span>目标损失 <b>${shown(current.hpLoss)}</b></span><span>收入 <b>${shown(current.income)}</b></span><span>利息 <b>${shown(current.interest)}</b></span><${LinkCopy} kind="battleReport" id=${current.round}/><${Button} size="sm" onClick=${()=>onReplay(current.round)}>回放<//></div>`:html`<p>本局尚无战斗记录。</p>`}
   ${current&&Array.isArray(units)&&units.length?html`<${Tabs} class="rs-battle-report__metrics" items=${METRICS} value=${metric} onChange=${setMetric}/><div class="rs-battle-report__chart" role="list" aria-label=${`${title}单位${METRICS.find(x=>x.id===metric)?.label||''}`}>
     ${entries.map(({unit,piece,operator,token,name,operatorId,value})=>{const portrait=operator?assets.avatar(operator.charId):token?assets.avatar(token.id):null;const detail=operatorId?()=>onDetail({kind:'operator',id:operatorId,pieceUid:piece?.uid}):null;return html`<article class="rs-battle-report__unit" role="listitem" key=${`${unit.uid}:${unit.defId}`} title=${`${name} · ${METRICS.find(x=>x.id===metric)?.label}：${exact(unit[metric])}`}>
       <button type="button" class="rs-battle-report__identity" disabled=${!detail} onClick=${detail}><span class="rs-battle-report__avatar">${portrait?html`<img src=${portrait} alt="" loading="lazy"/>`:name.slice(0,1)}</span><span><b>${name}</b><small>${unit.kind==='token'||unit.kind==='summon'?'召唤物':'作战单位'}</small></span></button>
       <div class="rs-battle-report__bar">${value===null?html`<span class="rs-battle-report__unknown" title="此单位缺少该项统计">未知</span>`:html`<${ProgressBar} value=${value} max=${maxValue||1} tone=${metric==='heal'?'mint':metric==='taken'?'amber':'gold'} size="md"/>`}<b title=${`精确值：${exact(unit[metric])}`}>${shown(unit[metric])}</b></div>
       <div class="rs-battle-report__aux"><span>击杀 <b title=${`精确值：${exact(unit.kills)}`}>${shown(unit.kills)}</b></span><span>攻击 <b title=${`精确值：${exact(unit.attacks)}`}>${shown(unit.attacks)}</b></span></div>
     </article>`})}
   </div>`:current?html`<p class="rs-battle-report__empty">此场战斗没有单位统计。</p>`:null}
 </${Panel}>`;
}
