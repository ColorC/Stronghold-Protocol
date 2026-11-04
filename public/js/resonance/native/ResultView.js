// Adapted from public/js/screens/result.js at upstream 1db8e51023ae6abaec9370beb81a513d5c4d0b01.
// The standalone resonance run has one player, so this keeps the native result hero/card hierarchy
// while projecting only fields the campaign state actually records.
import { html, Button, MicroLabel, DifficultyTag } from '../../ui/components.js';
import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { Img, LpTower } from '../../ui/gameComponents.js';
import { uiUrl } from '../../ui/assetUrls.js';
import { data, useData } from '../../data.js';
import { assets } from '../../assets.js';
import { ResonanceItemIcon } from '../itemIcon.js';
import { StrategyIcon } from '../strategyIcon.js';

export function ResultView({ state, catalog, onLeave, onReport, onDetail }) {
  useData('assets','items');
  const [,setAssetRevision]=useState(0);
  useEffect(()=>{let live=true;const refresh=()=>{if(live)setAssetRevision(value=>value+1)};const off=assets.onChange(refresh);assets.ready().then(refresh).catch(refresh);return()=>{live=false;off()}},[]);
  const won=state.terminalReason==='victory';
  const bg=uiUrl(data.get('assets'),won?'settle/settlemen_teamshow_success':'settle/settlemen_teamshow_fail');
  const stats=[['推进节点',state.round],['剩余生命',state.hp],['当前金币',state.gold]].filter(([,value])=>Number.isFinite(value));
  const pieces=state.pieces||[];
  return html`<div class=${`screen result ${won?'is-win':'is-lose'} rs-native-result`} style=${bg?`--result-bg:url("${bg}")`:undefined}>
    <div class="result__bg" aria-hidden="true"></div><div class="result__grid" aria-hidden="true"></div>
    <main class="result__main"><section class="result__hero">
      <${DifficultyTag} difficulty=${state.difficulty} size="lg"/><h1 class="result__headline">${won?'防线守住了':state.terminalReason==='hp-depleted'?'目标已失守':'本局未通关'}</h1>
      <p class="result__sub">${won?'最终领袖已被击败。':state.terminalReason==='hp-depleted'?'保护目标生命已耗尽。':'最终领袖未被击败。'}</p>
      <div class="result__rounds"><span class="result__rlabel">推进节点</span><b class="result__rnum num">${state.round}</b><span class="result__rof num">/ ${state.roundLimit}</span></div>
      <footer class="result__foot"><${Button} variant="primary" size="xl" icon="chevronLeft" onClick=${onLeave}>返回开始界面<//><${Button} size="xl" onClick=${onReport}>查看战报<//></footer>
    </section><section class="result__players"><h2 class="brief-h"><span>最终阵容</span><${MicroLabel}>RUN REPORT</${MicroLabel}></h2>
      <article class="rcard is-self"><header class="rcard__head"><div class="rcard__who"><b class="rcard__name">共鸣战线</b><span class="rcard__band">单人战役</span></div>
        <div class="rcard__mid"><div class="rcard__lineup">${pieces.map(piece=>{const op=catalog.operators?.[piece.operatorId],portrait=assets.avatar(op?.charId);return html`<div class="rs-result-unit" key=${piece.uid}><button type="button" class="rs-result-unit__portrait" onClick=${()=>onDetail({kind:'operator',id:piece.operatorId,pieceUid:piece.uid})} aria-label=${`查看${op?.name||'干员'}`}>
          <${Img} src=${portrait} class="rs-result-unit__avatar" alt="" fallback=${html`<span class="rs-result-unit__initial">${(op?.name||'干').slice(0,1)}</span>`}/><b>${op?.name||'干员'}</b><small>${piece.star}星 · ${piece.row==null?'整备区':'作战区'}</small></button>
          ${(piece.equipment||[]).length?html`<div class="rs-result-unit__gear">${piece.equipment.map(item=>html`<button key=${item.uid} onClick=${()=>onDetail({kind:'item',id:item.itemId})}><${ResonanceItemIcon} catalog=${catalog} itemId=${item.itemId} size="sm"/><span>${catalog.equipment?.[item.itemId]?.name||'装备'}</span></button>`)}</div>`:null}</div>`})}</div></div>
        <div class="rcard__round"><${MicroLabel}>NODES</${MicroLabel}><b class="num">${state.round}</b></div></header>
        <div class="rcard__stats">${stats.map(([label,value])=>html`<div class="rstat" key=${label}><span>${label}</span>${label==='剩余生命'?html`<${LpTower} value=${value} size="sm"/>`:html`<b class="num">${value}</b>`}</div>`)}</div>
      </article>
      ${(state.strategies||[]).length?html`<details class="rs-result-strategies"><summary>本局策略</summary><div>${state.strategies.map(entry=>{const id=typeof entry==='string'?entry:entry.id;return html`<button key=${id} onClick=${()=>onDetail({kind:'strategy',id})}><${StrategyIcon} catalog=${catalog} id=${id} size="sm"/>${catalog.strategies?.[id]?.name||'策略'}</button>`})}</div></details>`:null}
    </section></main>
  </div>`;
}
