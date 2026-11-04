import { html, Button, Icon, Panel } from '../ui/components.js';
import { CoinGlyph } from '../ui/gameComponents.js';
import { BattleReport } from './battleReport.js';
import { useRef, useState } from '../../vendor/hooks.module.js';
import { finiteValue, forecastIncome, interestFor, settlementBreakdown } from '../../../shared/resonance/economy-view.js';

const number = finiteValue;
const shown = value => number(value) == null ? '—' : String(number(value));
const battleHistory = state => (state?.history || []).filter(entry => entry.type === 'fight-settled').slice().sort((a,b) => Number(a.round)-Number(b.round));

function InterestLadder({gold,winBonus,perGold,cap}) {
 const interest=interestFor(gold,winBonus,perGold,cap),next=interest!=null&&interest<cap?(interest+1)*perGold-winBonus:null;
 return html`<div class="rs-income__interest" aria-label=${interest==null?'利息数据未知':`利息 ${interest}，上限 ${cap}`}><div class="rs-income__coin-steps">${interest==null?html`<span class="rs-income__unknown">利息数据未知</span>`:Array.from({length:cap},(_,i)=>{const threshold=(i+1)*perGold;return html`<span class=${`rs-income__coin-step${i<interest?' is-lit':''}`} key=${i} title=${`${threshold} 金币档，利息 ${i+1}`}><${CoinGlyph}/><small>${threshold}</small></span>`})}</div><div class="rs-income__interest-meta"><b>${interest==null?'—':`${interest} / ${cap}`} 利息</b><span>${interest==null?'缺少金币或经济配置':next==null?'已达利息上限':`再有 ${Math.max(0,next-gold)} 金到下一档${winBonus?`（已计入胜利奖励）`:''}`}</span></div></div>`;
}

function StreakTrack({forecast,won,history}) {
 const current=won?'winStreak':'lossStreak',count=forecast?.nextCount??null,length=Math.max(6,...(forecast?[]:[6]));
 const recent=(history||[]).slice(-length);
 return html`<div class=${`rs-income__streak${won?' is-win':' is-loss'}`}><b class="rs-income__streak-mark" aria-label=${won?'连胜趋势':'连败趋势'}><${Icon} name="signal"/></b><div><strong>${won?'连胜预览':'连败预览'} · ${count==null?'—':`第 ${count} 场`}</strong><div class="rs-income__streak-track" aria-label=${`${won?'胜':'败'} ${count??'未知'} 场`}>${Array.from({length:Math.max(6,count||0)},(_,i)=>{const row=recent[i];return html`<i class=${`rs-income__streak-cell${i<(count||0)?' is-filled':''}${row?(row.won?' is-history-win':' is-history-loss'):''}`} key=${i} title=${row?`第 ${row.round} 场${row.won?'胜':'败'}`:`第 ${i+1} 场`}></i>`})}</div></div><span>${forecast?`+${forecast.streak} 金`:'—'}</span></div>`;
}

function Forecast({state,economy,campaign,won,history,logistics=false}) {
 const values=forecastIncome({state,economy,campaign,won}),rule=economy.interest||{},gold=number(state?.gold),perGold=number(rule.perGold),cap=number(state?.actionCosts?.interestCap??rule.cap);
 if(!values||Boolean(values.kind==='logistics')!==logistics)return null;
 const label=logistics?'补给节点':won?'胜利':'失利';
 return html`<details class="rs-income__forecast" open=${won||logistics}><summary>${label} · 收入${won&&!logistics?'预计':''} <b>${values.total==null?'—':`+${values.total} 金`}</b></summary><div class="rs-income__forecast-body"><div class="rs-income__columns"><span><small>${logistics?'补给收入':'基础收入'}</small><b>+${values.base}</b></span><span><small>胜利奖励</small><b>+${values.winBonus}</b></span><span><small>${won?'连胜':'连败'}奖励</small><b>+${values.streak}</b></span><span><small>利息</small><b>+${values.interest}</b></span></div><${InterestLadder} gold=${gold} winBonus=${values.winBonus} perGold=${perGold} cap=${cap}/>${!logistics?html`<${StreakTrack} forecast=${values} won=${won} history=${history}/>`:null}<small class="rs-income__estimate">${logistics?'按当前补给节点配置计算。':'预计收入；最终收入包含策略和战斗奖励。'}</small></div></details>`;
}

export function IncomePanel({state,catalog}) {
 const campaign=catalog?.campaign||{},economy=campaign.economy||{},history=battleHistory(state),rule=economy.interest||{},perGold=number(rule.perGold),cap=number(state?.actionCosts?.interestCap??rule.cap),gold=number(state?.gold),logistics=state?.difficulty==='FUNNY'&&number(state?.round)!=null&&number(state.round)%2===1&&state?.nodeStarted===true;
 return html`<${Panel} id="rs-income-panel" title="金币与收入" micro="INCOME" class="rs-panel rs-income-panel"><div class="rs-income"><div class="rs-income__balance"><${CoinGlyph}/><strong>${shown(state?.gold)}</strong><small>当前金币</small></div><${InterestLadder} gold=${gold} winBonus=${0} perGold=${perGold} cap=${cap}/><div class="rs-income__forecasts">${logistics?html`<${Forecast} state=${state} economy=${economy} campaign=${campaign} won=${false} history=${history} logistics=${true}/>`:html`<${Forecast} state=${state} economy=${economy} campaign=${campaign} won=${true} history=${history}/><${Forecast} state=${state} economy=${economy} campaign=${campaign} won=${false} history=${history}/>`}</div></div></${Panel}>`;
}

function IncomeColumn({label,value,icon}) {
 return html`<div class="rs-settlement__income-cell"><small>${label}</small><b>${icon?html`<${CoinGlyph}/>`:null}${value==null?'—':`${value>=0?'+':''}${value}`}</b></div>`;
}

export function RoundSettlementPanel({summary,state,catalog,onReplay=()=>{},onDetail=()=>{},showReplay=true}) {
 const [reportOpen,setReportOpen]=useState(false),reportRef=useRef(null);
 const history=battleHistory(state),won=summary?.won===true,values=settlementBreakdown(summary),loss=values?.hpLoss,goldAfter=values?.goldAfter,xpDelta=values?.xpDelta;
 return html`<${Panel} id="rs-round-settlement" title="本场结算" micro="ROUND SETTLEMENT" class=${`rs-panel rs-settlement${summary?(won?' is-win':' is-loss'):''}`}>
  ${summary?html`<div class="rs-settlement__banner"><b>${won?'本场守住':'本场失守'}</b><span>第 ${shown(summary.round)} 场</span></div><div class="rs-settlement__body"><div class="rs-settlement__loss"><span class="rs-settlement__life-mark" aria-hidden="true">♥</span><span>目标生命损失</span><b>${shown(loss)}</b></div>
   <div class="rs-settlement__income"><${IncomeColumn} label="基础" value=${values.income}/><${IncomeColumn} label="胜利" value=${values.winBonus}/><${IncomeColumn} label="连胜奖励" value=${values.streakBonus}/><${IncomeColumn} label="利息" value=${values.interest}/><${IncomeColumn} label="其他收入 / 修正" value=${values.other}/></div>
   <div class="rs-settlement__totals"><span><${CoinGlyph}/>金币变化 <b>${values.goldDelta==null?'—':`${values.goldDelta>=0?'+':''}${values.goldDelta}`}</b><small>${goldAfter==null?'':`结算后 ${goldAfter}`}</small></span><span><b>XP</b>经验变化 <b>${xpDelta==null?'—':`${xpDelta>=0?'+':''}${xpDelta}`}</b><small>${values.xpAfter==null?'':`结算后 ${values.xpAfter}`}</small></span></div>
   <div class="rs-settlement__actions">${showReplay?html`<${Button} size="sm" onClick=${()=>onReplay(summary.round)}>回放本场<//>`:null}<${Button} size="sm" variant="ghost" onClick=${()=>{setReportOpen(true);requestAnimationFrame(()=>reportRef.current?.scrollIntoView({block:'nearest'}))}}>查看战斗图表<//></div>
   <details class="rs-settlement__report" ref=${reportRef} open=${reportOpen} onToggle=${event=>setReportOpen(event.currentTarget.open)}><summary>伤害、治疗与承伤榜</summary><${BattleReport} state=${state} catalog=${catalog} onReplay=${onReplay} onDetail=${onDetail}/></details></div>`:html`<div class="rs-settlement__empty"><p>本场结算尚未记录。</p><p>完成一场战斗后，这里会显示收入、金币与经验变化，并可查看战斗图表。</p></div>`}
 </${Panel}>`;
}
