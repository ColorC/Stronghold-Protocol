import { html, Button, MicroLabel, DifficultyTag, HexBadge, Spinner, Icon } from '../ui/components.js';
import { TopBar } from '../ui/hud.js';
import { ShopBar } from '../ui/shopBar.js';
import { BondStrip } from '../ui/bondStrip.js';
import { GIcon, CoinGlyph } from '../ui/gameComponents.js';
import { useCallback, useEffect, useState } from '../../vendor/hooks.module.js';
import { SettingsModal } from '../ui/settings.js';
import { EffectsList } from '../ui/effectsList.js';
import { EmoteWheel } from '../ui/emotes.js';
import { FullscreenButton } from '../ui/device.js';
import { PHASE } from '../../../shared/constants.js';
import { data } from '../data.js';
import { FacingWheel, setPieceDir } from '../ui/facingWheel.js';
import { FieldPanel, InventoryPanel, PactPanel } from './panels.js';
import { ResonanceItemIcon } from './itemIcon.js';
import { BattleReport } from './battleReport.js';
import { CodexScreen } from './codex.js';
import { DetailPanel } from './detail.js';
import { operatorShopPreview, pieceNum, prepView, resolveOpeningEvent, roleLabel, strategyProgressText } from './model.js';
import { pactIconUrl } from './pactIcon.js';
import { StrategyIcon } from './strategyIcon.js';
import { resolveOperatorSkillIcon } from './operatorSkillIcon.js';
import { shopCostPresentation } from './hudPresentation.js';
import { InventoryDock } from './native/equipmentDock.js';
import { IncomePanel, RoundSettlementPanel } from './economyPanels.js';

const xpForLevel = (level) => [6,10,20,36,56,68,68][level-3] || 68;
const mergeAvailable = (state,id) => (state.pieces||[]).filter(piece=>piece.operatorId===id&&piece.star===1).length >= 2;

export function GameChrome(p) {
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [codexInitialTab,setCodexInitialTab]=useState('operators');
  const [bondsCollapsed,setBondsCollapsed]=useState(false);
  const [fieldDropTarget,setFieldDropTarget]=useState(null);
  const [seekPosition,setSeekPosition]=useState(0);
  const {state,catalog,host,detail,setDetail,setPanel:setPanelState,panel,busy,act,onLeave,shopCollapsed,setShopCollapsed,
    replay,setReplay,playing,setPlaying,speed,setSpeed,frame,jumpToEnd,view,summary,showReplay,
    move,openDetail,facing,commitFacing,cancelFacing,choiceSelections,setChoiceSelections,strategyTargets,setStrategyTargets,
    makeChoice,choiceOpen,saleZoneRef,sellingPiece,equipDrop,fieldKind,fieldError,retryField} = p;
  useEffect(()=>{setSeekPosition(0)},[replay?.round]);
  const setPanel=useCallback(next=>{if(next!=null)setDetail(null);setPanelState(next)},[setPanelState,setDetail]);
  const xpNeed=Number(state.actionCosts?.xpToLevel??catalog.campaign?.economy?.xpToLevel?.[state.level]??xpForLevel(state.level));
  const openingEvent=resolveOpeningEvent(state,catalog);
  const prep=prepView(state,catalog);
  const shopPriv={funds:state.gold,deployCount:state.deployedCount,deployCap:state.level,hand:prep.hand,board:prep.board,temp:prep.temp,loadout:null,
    shop:{slots:(state.shop?.offers||[]).map(o=>({kind:'chess',id:o.operatorId,price:o.cost??catalog.operators?.[o.operatorId]?.cost??0,sold:!o.operatorId||!!o.sold,offerUid:o.uid})),
      frozen:!!state.shop?.locked,refreshPrice:state.actionCosts?.refreshGold??2,freeRefreshes:Number(state.actionCosts?.freeRefreshes??state.freeRefreshes??(Number(state.actionCosts?.refreshGold)===0?1:0)),level:state.level,maxLevel:10,upgradePrice:state.actionCosts?.xpGold??4}};
  const pacts=catalog.pacts||{};
  const pactRecords=Object.fromEntries(Object.entries(pacts).map(([id,x])=>[id,{name:x.name,noStack:true,thresholds:(x.levels||[]).map(y=>y.threshold)}]));
  const bonds=Object.entries(state.pacts||{}).filter(([,x])=>(x.count||0)>0).map(([bondId,x])=>({bondId,count:x.count||0,layers:0,noStack:true,
    thresholds:(pacts[bondId]?.levels||[]).map(y=>y.threshold),tier:(pacts[bondId]?.levels||[]).filter(y=>y.threshold<=(x.count||0)).length,active:!!x.activeThreshold}));
  const cardPresentation=(slot)=>{const op=catalog.operators?.[slot.id];if(!op)return {};
    const skillIcon=resolveOperatorSkillIcon(op),skill=op.stars?.[1]?.skill||null;
    const cost=shopCostPresentation(op.cost);
    const previewText=operatorShopPreview(op);
    const copies=state.pieces.filter(x=>x.operatorId===slot.id&&x.star===1).length;
    const nextStar=state.pieces.filter(x=>x.operatorId===slot.id&&x.star===2).length>=2?'三星':'二星';
    return {record:{...op,skill:skill?{...skill,iconId:skillIcon?.iconId||skill.iconId,name:skillIcon?.name||skill.name}:op.skill,tier:cost.tier,costTone:cost.tone,bonds:op.pacts||[],profession:data.lookup('chess',slot.id)?.profession,subProfessionName:roleLabel(op.role),assets:{...(op.assets||{}),portrait:op.charId||op.assets?.portrait||op.portrait,...(skillIcon?.iconId?{skillIcon:skillIcon.iconId}:{})}},
      merge:{copies:Math.min(2,copies),need:3,hint:copies>=2?`干员将晋升为${nextStar}`:''},previewText};
  };
  const reasonFor=(_kind,slot,_priv,editable)=>!editable||busy||!['prep','choice'].includes(state.phase)?'当前阶段无法招募':slot.sold?'已售罄':
    state.gold<Number(slot.price??catalog.operators?.[slot.id]?.cost??0)?'金币不足':
    state.benchCount>=9&&!mergeAvailable(state,slot.id)?'整备区已满':null;
  const phase=state.phase==='choice'?'选择补给':state.phase==='complete'?'本局结束':state.node?.kind==='logistics'?'后勤节点':state.nodeStarted?'整备阶段':'节点补给';
  const showShop=!replay&&['prep','choice'].includes(state.phase);
  const title=replay?'战斗记录':state.phase==='complete'&&panel==='settlement'?'':({equipment:'装备',pacts:'盟约',strategies:'本局策略',enemy:'敌情与路径',report:'战斗记录',formation:'阵容管理',settlement:'本场结算',shopOdds:'等级与招募概率',income:'收入与利息'}[panel]||'');
  const nativePhase=state.phase==='prep'?PHASE.PREP:state.phase==='choice'?PHASE.SP_DRAFT:state.phase==='battle'||replay?PHASE.COMBAT:state.phase==='complete'?PHASE.RESULT:PHASE.ROUND_START;
  const nativePub={round:replay?.round??state.round,phase:nativePhase,difficulty:state.difficulty,players:[],fields:[]};
  const nativePriv={...shopPriv,lp:state.hp,alive:true,ready:false,effects:state.effects||[]};
  const campaign=catalog.campaign||{},shopOdds=campaign.shopOdds||{},interestRule=campaign.economy?.interest||{};
  const interestNow=Math.min(Number(state.actionCosts?.interestCap??interestRule.cap??5),Math.floor(state.gold/Math.max(1,Number(interestRule.perGold)||10)));
  const oddsForLevel=(level)=>{const values=shopOdds[String(level)]||shopOdds[level]||[];return Array.from({length:5},(_,i)=>Number(values[i]||0))};
  const currentOdds=oddsForLevel(state.level);
  const saleCopies=sellingPiece?.star===3?9:sellingPiece?.star===2?3:1;
  const saleCost=Number(catalog.operators?.[sellingPiece?.operatorId]?.cost)||0;
  const saleValue=sellingPiece?(saleCost===1?saleCost*saleCopies:Math.max(0,saleCost*saleCopies-(sellingPiece.star>1?1:0))):0;
  const closeReplay=()=>{setPlaying(false);setReplay(null);frame.current=0;setSeekPosition(0);view?.setCamera('prep');location.hash='';setPanel(state.phase==='choice'&&state.pendingChoices?.length?'choice':null)};
  const seekReplay=(event)=>{const frames=replay?.frames||[],index=Math.max(0,Math.min(frames.length,Number(event.currentTarget.value)||0));frame.current=index;setSeekPosition(index);setPlaying(false);const snapshot=frames[Math.max(0,index-1)]?.snap;if(snapshot)view?.pushSnapshot(snapshot)};
  const content=replay?html`<section class="rs-replay-seek" aria-label="战报回放定位"><label>第 ${replay.round} 场回放 <input type="range" min="0" max=${replay.frames?.length||0} value=${seekPosition} onInput=${seekReplay}/></label><span>${seekPosition} / ${replay.frames?.length||0}</span><${Button} size="sm" onClick=${jumpToEnd}>跳到结算</${Button}><${Button} size="sm" onClick=${closeReplay}>关闭回放</${Button}></section><${BattleReport} state=${state} catalog=${catalog} onReplay=${showReplay} onDetail=${openDetail}/>`:
    panel==='equipment'?html`<${InventoryPanel} state=${state} catalog=${catalog} act=${act} onDetail=${openDetail} busy=${busy}/>`:
    panel==='pacts'?html`<${PactPanel} state=${state} catalog=${catalog} onDetail=${openDetail} onCodex=${()=>{location.hash='section-pact-catalog'}}/>`:
    panel==='formation'?html`<${FieldPanel} state=${state} catalog=${catalog} onFight=${()=>act({type:'fight'})} onSupply=${()=>act({type:'advanceSupply'})} onDetail=${openDetail} busy=${busy}/>`:
    panel==='enemy'?html`<section class="rs-native-list" id=${`rs-section-node-${state.round}`}><h2>${state.node?.bossName||(state.node?.kind==='logistics'?'后勤节点':'下一场遭遇')}</h2><p id=${`node-${state.round}`}>第 ${state.round} 节点 · ${phase}</p>
      ${(state.nextEnemies||[]).map((x,i)=>html`<article key=${i}><b>${x.name}</b><span>× ${x.count}</span></article>`)}<span id=${`battle-node-${state.round}`}></span></section>`:
    panel==='report'?html`<${BattleReport} state=${state} catalog=${catalog} onReplay=${showReplay} onDetail=${openDetail}/>`:
    panel==='strategies'?html`<section class="rs-native-list">${(state.strategies||[]).map(entry=>{const id=typeof entry==='string'?entry:entry.id,s=catalog.strategies[id];return html`<article key=${id}><${StrategyIcon} catalog=${catalog} id=${id} size="sm"/><b>${s?.name||'已选策略'}</b><span>${s?.description||''}</span><button onClick=${()=>openDetail({kind:'strategy',id})}>条文</button></article>`})}</section>`:
    panel==='shopOdds'?html`<section class="rs-economy-help"><p>当前等级 ${state.level} · 上场人数上限 ${state.level} · 经验 ${state.xp}/${xpNeed} · 升级费用 ${state.actionCosts?.xpGold??4} 金</p><div class="rs-economy-help__odds">${Object.keys(shopOdds).map(Number).sort((a,b)=>a-b).map(level=>html`<p key=${level} class=${level===state.level?'is-current':''}><b>${level}级</b>${oddsForLevel(level).map((chance,index)=>html`<span key=${index}>${index+1}费 ${chance}%</span>`)}</p>`)}</div></section>`:
    panel==='income'?html`<${IncomePanel} state=${state} catalog=${catalog}/>`:
    panel==='settlement'?state.phase==='complete'?null:html`<${RoundSettlementPanel} summary=${summary} state=${state} catalog=${catalog} onReplay=${showReplay} onDetail=${openDetail}/>`:null;
  const readyAction=()=>{if(state.phase!=='prep'||busy)return;if(state.node?.kind==='logistics'||!state.nodeStarted)act({type:'advanceSupply'});else act({type:'fight'})};
  return html`<div class=${`screen gm rs-game ${showShop?'has-shop':''} ${state.phase==='complete'&&!replay?'is-terminal':''}`} data-camera="prep" onDragOver=${event=>{if(!event.dataTransfer?.types?.includes('application/x-stronghold-equipment'))return;event.preventDefault();if(!event.target?.closest?.('.gm__field')){setFieldDropTarget(null);return}const hit=view?.pieceAtClient?.(event.clientX,event.clientY),piece=hit&&state.pieces.find(candidate=>pieceNum(candidate.uid)===Number(hit.uid));setFieldDropTarget(piece?.uid||null)}} onDrop=${event=>{equipDrop(event);setFieldDropTarget(null)}}>
    <div class="gm__field" ref=${host} aria-label="共鸣战场" onContextMenu=${event=>event.preventDefault()}></div>
    <div class="gm__vignette" aria-hidden="true"></div>
    ${fieldKind!=='engine'&&(state.phase!=='complete'||replay)?html`<div class="rs-field-status" role="status"><div class="panel brackets rs-field-status__panel">${fieldKind==='error'?html`<h2>战场未能载入</h2><p>检查连接后重试，对局进度已保留。</p><${Button} variant="primary" onClick=${retryField}>重新载入战场</${Button}>`:html`<${Spinner} label=${fieldError?'正在重新载入战场…':'正在载入战场…'}/>`}</div></div>`:null}
    <div class="gm__hud">
      <${TopBar} pub=${nativePub} priv=${nativePriv} conn=${{status:'online'}} hud=${null} total=${null} drawer=${panel==='formation'?'info':null} onExit=${onLeave}
        onDrawer=${tab=>setPanel(tab==='info'?(panel==='formation'?null:'formation'):null)} onReady=${readyAction} readyBusy=${busy} readyCount=${0} playerCount=${1}
        pen=${!replay&&panel==='enemy'} penAvail=${!replay&&!!state.nextEnemies?.length&&state.node?.kind!=='logistics'} onPen=${enabled=>setPanel(enabled?'enemy':null)}
        leftMeta=${html`<div class="rs-gmeta"><${MicroLabel} tone="mint">卫戍协议 · 共鸣</${MicroLabel}>${openingEvent?.id?html`<button type="button" class="rs-gmeta__opening" onClick=${()=>openDetail({kind:'opening',id:openingEvent.id})}>${openingEvent.id==='none'?'共鸣':openingEvent.name}</button>`:html`<b>共鸣</b>`}<${DifficultyTag} difficulty=${state.difficulty} size="sm" code=${({FUNNY:'轻松',NORMAL:'标准',HARD:'困难',ABYSS:'深渊'})[state.difficulty]||'标准'}/></div>`}
        phaseContent=${html`<span class="rs-phase">${replay?'战斗回放':phase}</span>`}/>
      <div class="gm__bonds">
        <button type="button" class="bonds-toggle" aria-expanded="${!bondsCollapsed}" aria-controls="resonance-bond-strip" onClick=${()=>setBondsCollapsed(!bondsCollapsed)}><${Icon} name=${bondsCollapsed?'chevronRight':'chevronLeft'}/><span>${bondsCollapsed?'盟约':'收起'}</span></button>
        <div id="resonance-bond-strip" class="gm__bond-list" hidden=${bondsCollapsed}><${BondStrip} bonds=${bonds} records=${pactRecords} onOpen=${id=>openDetail({kind:'pact',id})} iconFor=${id=>pactIconUrl(catalog,id)} iconMask=${true} emptyLabel="部署激活" max=${8}/></div>
      </div>
      ${!replay?html`<${InventoryDock} state=${state} catalog=${catalog} busy=${busy} fieldTargetUid=${fieldDropTarget} onDetail=${openDetail} onOpen=${()=>setPanel('equipment')} onCombine=${act}/>`:null}
      <div class="gm__effects"><${EffectsList} effects=${nativePriv.effects}/></div>
      ${showShop?html`<${ShopBar} priv=${nativePriv} editable=${!busy} collapsed=${shopCollapsed} onCollapse=${setShopCollapsed} barRef=${null} hideItem=${true} interaction="direct" cardPresentation=${cardPresentation} bondRenderer=${id=>html`<span>${pacts[id]?.name||''}</span>`} reasonFor=${reasonFor}
        onBuy=${i=>{const offer=state.shop?.offers?.[i];if(offer)act({type:'buy',offerUid:offer.uid})}} onLevel=${()=>act({type:'buyXp'})} onRefresh=${()=>act({type:'refresh'})} onFreeze=${()=>act({type:'lockShop',locked:!state.shop?.locked})}
        onDetail=${(id,kind)=>openDetail({kind:kind==='chess'?'operator':kind==='item'?'item':kind,id})} onDetailClose=${()=>setDetail(null)} onRefuse=${()=>{}}
        renderLevel=${()=>{const xpPrice=state.actionCosts?.xpGold??4,full=state.level>=10,disabled=busy||full||state.gold<xpPrice;const oddsText=currentOdds.map((chance,index)=>`${index+1}费 ${chance}%`).join(' · ');return html`<button type="button" class=${`lvcard rs-level-card ${full?'is-max':''} ${disabled?'is-disabled':''}`} aria-disabled=${String(disabled)} disabled=${disabled} onClick=${()=>act({type:'buyXp'})} onContextMenu=${event=>{event.preventDefault();setPanel('shopOdds')}} title=${`${full?'已满级':`购买经验 · ${xpPrice}金`} · ${state.level}级上场上限 ${state.level} · 经验 ${state.xp}/${xpNeed} · ${oddsText}`}>
          ${!full?html`<${HexBadge} value=${xpPrice} tone=${disabled?'dark':'gold'} size="md" class="lvcard__price"/>`:null}<span class="lvcard__frame"><span class="lvcard__micro">LEVEL</span><b class="lvcard__num num">${state.level}</b></span><span class="lvcard__xp"><i><em style=${{width:`${Math.min(100,state.xp/xpNeed*100)}%`}}></em></i><small>${state.xp}/${xpNeed}</small></span><span class="lvcard__label">${full?'已满级':'购买经验'}</span></button>`}}
        renderFunds=${html`<div class="funds rs-funds"><button type="button" class="funds__hex" title="查看收入与利息" onClick=${()=>setPanel('income')}><${CoinGlyph} class="funds__coin"/><b class="funds__num num">${state.gold}</b></button><button type="button" class="funds__label" onClick=${()=>setPanel('income')}>金币</button><button type="button" class="rs-interest" title=${`预计利息 ${interestNow}`} onClick=${()=>setPanel('income')}>${Array.from({length:5},(_,i)=>html`<i class=${i<interestNow?'is-on':''}/>`)}<small>利息</small></button><button type="button" class="funds__collapse" onClick=${()=>setShopCollapsed(true)}>收起</button></div>`}/>`:null}
      ${replay?html`<div class="chud rs-replay-hud" role="region" aria-label="回放控制"><div class="chud__bottom"><b>第 ${replay.round} 场回放</b><${Button} size="sm" onClick=${()=>setPlaying(!playing)}>${playing?'暂停':'继续'}</${Button}><label>速度<select value=${speed} onChange=${event=>setSpeed(Number(event.currentTarget.value))}>${[1,2,4,8].map(value=>html`<option key=${value} value=${value}>${value}倍</option>`)}</select></label><${Button} size="sm" onClick=${closeReplay}>关闭</${Button}></div></div>`:null}
      ${!replay?html`<nav class="rs-strategy-pins" aria-label="已选策略">${(state.strategies||[]).map(entry=>{const id=typeof entry==='string'?entry:entry.id,record=catalog.strategies?.[id];return html`<button key=${id} title=${record?.description||record?.name} onClick=${()=>openDetail({kind:'strategy',id})}><${StrategyIcon} catalog=${catalog} id=${id} size="sm"/><span><b>${record?.name||'策略'}</b><small>${strategyProgressText(state.strategyState?.[id])||'效果详情'}</small></span></button>`})}</nav>`:null}
      <div class="gm__corner"><nav class="rs-dock rs-native-actions" aria-label="局内面板">
        ${!replay?html`<${Button} size="sm" variant="secondary" title="装备" onClick=${()=>setPanel('equipment')}><${GIcon} name="item"/>装备</${Button}><${Button} size="sm" variant="secondary" title="盟约" onClick=${()=>setPanel('pacts')}><${GIcon} name="bond"/>盟约</${Button}><${Button} size="sm" variant="secondary" title="战报" onClick=${()=>setPanel('report')}><${GIcon} name="eye"/>战报</${Button}>`:null}
        <button type="button" class="gm__gear" aria-label="设置" title="设置" onClick=${()=>setSettingsOpen(true)}><${GIcon} name="gear"/></button><button type="button" class="gm__gear gm__guide" aria-label="战术图鉴" title="战术图鉴" onClick=${()=>{setCodexInitialTab('operators');setPanel('codex')}}><${GIcon} name="book"/></button><${FullscreenButton} class="gm__gear gm__fs"/>
      </nav></div>
      ${!replay&&sellingPiece?html`<aside class="rs-sell-zone" data-drop="sell" ref=${saleZoneRef}><b>松开出售</b><span>${catalog.operators?.[sellingPiece.operatorId]?.name||'干员'} · +${saleValue}金</span></aside>`:null}
      ${!replay&&panel==='enemy'?html`<aside class="rs-native-list rs-enemy-peek"><h2>${state.node?.bossName||(state.node?.kind==='logistics'?'后勤节点':'下一场遭遇')}</h2><p>第 ${state.round} 节点 · ${phase}</p>${(state.nextEnemies||[]).map((x,i)=>html`<article key=${i}><b>${x.name}</b><span>× ${x.count}</span></article>`)}</aside>`:null}
      ${(replay||panel)&&panel!=='codex'&&panel!=='choice'&&panel!=='enemy'?html`<aside class=${`dpanel dpanel--right rs-side-panel ${showShop?'is-shop':''}`} role="dialog" aria-label=${title}><header class="rs-side-panel__head"><${MicroLabel} tone="mint">共鸣 · 局内</${MicroLabel}><h2>${title}</h2><button class="dpanel__close" aria-label="关闭面板" onClick=${()=>replay?closeReplay():setPanel(null)}><${Icon} name="close"/></button></header><div class="dpanel__scroll">${content}</div></aside>`:null}
    </div>
    ${!replay&&state.pendingChoices?.length&&state.phase==='choice'&&choiceOpen?html`<div class="spov rs-choice-full" role="dialog" aria-modal="true" aria-label="选择补给"><div class="spov__veil"></div><${Button} class="rs-choice-collapse" size="sm" onClick=${()=>setPanel(null)}>收起整备</${Button}>${state.pendingChoices.map(makeChoice)}</div>`:null}
    ${!replay&&facing&&view?html`<${FacingWheel} key=${`${facing.piece.uid}:${facing.row},${facing.col}`} view=${view} row=${facing.row} col=${facing.col} grid=${facing.grid} name=${facing.name} onPreview=${dir=>setPieceDir(view,pieceNum(facing.piece.uid),dir||facing.piece.dir||'RIGHT')} onCommit=${commitFacing} onCancel=${cancelFacing}/>`:null}
    ${panel==='codex'?html`<div class="rs-codex-overlay"><${CodexScreen} catalog=${catalog} activeIds=${state.activeOperatorIds||[]} initialTab=${codexInitialTab} onBack=${()=>{location.hash='';setDetail(null);setPanel(null)}} onDetail=${openDetail}/></div>`:null}
    ${panel==='codex'?null:html`<${DetailPanel} detail=${detail} catalog=${catalog} state=${state} onDetail=${openDetail} onAction=${replay||!['prep','choice'].includes(state.phase)?null:act} busy=${busy} readOnly=${!!replay||!['prep','choice'].includes(state.phase)} onClose=${()=>setDetail(null)}/>`}
    ${settingsOpen?html`<${SettingsModal} open=${true} onClose=${()=>setSettingsOpen(false)} onGuide=${()=>{setSettingsOpen(false);setDetail(null);setCodexInitialTab('economy');setPanel('codex')}} guideLabel="经营规则"/>`:null}
  </div>`;
}
