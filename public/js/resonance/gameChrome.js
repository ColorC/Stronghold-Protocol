import { html, Button, Modal, MicroLabel, DifficultyTag, HexBadge } from '../ui/components.js';
import { TopBar } from '../ui/hud.js';
import { ShopBar } from '../ui/shopBar.js';
import { BondStrip } from '../ui/bondStrip.js';
import { GIcon, CoinGlyph } from '../ui/gameComponents.js';
import { data } from '../data.js';
import { assets } from '../assets.js';
import { uiUrl } from '../ui/assetUrls.js';
import { FacingWheel, setPieceDir } from '../ui/facingWheel.js';
import { FieldPanel, InventoryPanel, PactPanel, LinkCopy } from './panels.js';
import { BattleReport } from './battleReport.js';
import { ReplayControls } from './replayControls.js';
import { CodexScreen } from './codex.js';
import { DetailPanel } from './detail.js';
import { pieceNum, prepView, strategyProgressText } from './model.js';

const xpForLevel = (level) => [6,10,20,36,56,68,68][level-3] || 68;
const mergeAvailable = (state,id) => (state.pieces||[]).filter(piece=>piece.operatorId===id&&piece.star===1).length >= 2;

export function GameChrome(p) {
  const {state,catalog,host,detail,setDetail,setPanel,panel,busy,act,onLeave,copyHistory,shopCollapsed,setShopCollapsed,
    replay,setReplay,playing,setPlaying,speed,setSpeed,frame,jumpToEnd,view,summary,showReplay,
    move,openDetail,facing,commitFacing,cancelFacing,choiceSelections,setChoiceSelections,strategyTargets,setStrategyTargets,
    makeChoice,choiceOpen,memberLinkMenu,setMemberLinkMenu,copyLinkFn} = p;
  const xpNeed=xpForLevel(state.level);
  const prep=prepView(state,catalog);
  const shopPriv={funds:state.gold,deployCount:state.deployedCount,deployCap:state.level,hand:prep.hand,board:prep.board,temp:prep.temp,loadout:null,
    shop:{slots:(state.shop?.offers||[]).map(o=>({kind:'chess',id:o.operatorId,price:o.cost??catalog.operators?.[o.operatorId]?.cost??0,sold:!o.operatorId||!!o.sold,offerUid:o.uid})),
      frozen:!!state.shop?.locked,refreshPrice:state.actionCosts?.refreshGold??2,freeRefreshes:0,level:state.level,maxLevel:10,upgradePrice:state.actionCosts?.xpGold??4}};
  const pacts=catalog.pacts||{};
  const pactRecords=Object.fromEntries(Object.entries(pacts).map(([id,x])=>[id,{name:x.name,noStack:true,thresholds:(x.levels||[]).map(y=>y.threshold)}]));
  const bonds=Object.entries(state.pacts||{}).filter(([,x])=>(x.count||0)>0).map(([bondId,x])=>({bondId,count:x.count||0,layers:0,noStack:true,
    thresholds:(pacts[bondId]?.levels||[]).map(y=>y.threshold),tier:(pacts[bondId]?.levels||[]).filter(y=>y.threshold<=(x.count||0)).length,active:!!x.activeThreshold}));
  const cardPresentation=(slot)=>{const op=catalog.operators?.[slot.id];if(!op)return {};
    const skill=op.stars?.[1]?.skill||null;
    const copies=state.pieces.filter(x=>x.operatorId===slot.id&&x.star===1).length;
    const nextStar=state.pieces.filter(x=>x.operatorId===slot.id&&x.star===2).length>=2?'三星':'二星';
    return {record:{...op,tier:op.cost,bonds:op.pacts||[],profession:data.lookup('chess',slot.id)?.profession,subProfessionName:op.role,assets:{...(op.assets||{}),portrait:op.charId||op.assets?.portrait||op.portrait}},
      skill:skill?{...skill,index:Number.isInteger(skill.index)?skill.index:undefined}:null,
      merge:{copies:Math.min(2,copies),need:3,hint:copies>=2?`干员将晋升为${nextStar}`:''}};
  };
  const reasonFor=(_kind,slot,_priv,editable)=>!editable||busy||!['prep','choice'].includes(state.phase)?'当前阶段无法招募':slot.sold?'已售罄':
    state.gold<Number(slot.price??catalog.operators?.[slot.id]?.cost??0)?'金币不足':
    state.benchCount>=9&&!mergeAvailable(state,slot.id)?'整备区已满':null;
  const phase=state.phase==='choice'?'选择补给':state.phase==='complete'?'本局结束':state.node?.kind==='logistics'?'后勤节点':state.nodeStarted?'整备阶段':'节点补给';
  const title=state.phase==='complete'&&panel==='settlement'?'':({equipment:'装备',pacts:'盟约',strategies:'本局策略',enemy:'敌情与路径',report:'战斗记录',formation:'阵容管理',settlement:'本场结算'}[panel]||'');
  const settled=(state.history||[]).filter(entry=>entry.type==='fight-settled');
  const won=state.terminalReason==='victory';
  const resultBg=uiUrl(data.get('assets'),won?'settle/settlemen_teamshow_success':'settle/settlemen_teamshow_fail');
  const closeReplay=()=>{setPlaying(false);setReplay(null);frame.current=0;view?.setCamera('prep');setPanel(state.phase==='choice'&&state.pendingChoices?.length?'choice':null)};
  const content=panel==='equipment'?html`<${InventoryPanel} state=${state} catalog=${catalog} act=${act} onDetail=${openDetail} busy=${busy}/>`:
    panel==='pacts'?html`<${PactPanel} state=${state} catalog=${catalog} onDetail=${openDetail} onCodex=${()=>{location.hash='section-pact-catalog'}}/>`:
    panel==='formation'?html`<${FieldPanel} state=${state} catalog=${catalog} onFight=${()=>act({type:'fight'})} onSupply=${()=>act({type:'advanceSupply'})} onDetail=${openDetail} busy=${busy}/>`:
    panel==='enemy'?html`<section class="rs-native-list" id=${`rs-section-node-${state.round}`}><h2>${state.node?.bossName||(state.node?.kind==='logistics'?'后勤节点':'下一场遭遇')}</h2><p id=${`node-${state.round}`}>第 ${state.round} 节点 · ${phase}</p>
      ${(state.nextEnemies||[]).map((x,i)=>html`<article key=${i}><b>${x.name}</b><span>× ${x.count}</span></article>`)}<${LinkCopy} kind="node" id=${state.round}/><${LinkCopy} kind="battleNode" id=${state.round}/><span id=${`battle-node-${state.round}`}></span></section>`:
    panel==='report'?html`<${BattleReport} state=${state} catalog=${catalog} onReplay=${showReplay} onDetail=${openDetail}/>`:
    panel==='strategies'?html`<section class="rs-native-list">${(state.strategies||[]).map(entry=>{const id=typeof entry==='string'?entry:entry.id,s=catalog.strategies[id];return html`<article key=${id}><b>${s?.name||'已选策略'}</b><span>${s?.description||''}</span><button onClick=${()=>openDetail({kind:'strategy',id})}>条文</button><${LinkCopy} kind="strategy" id=${id}/></article>`})}</section>`:
    panel==='settlement'?state.phase==='complete'?null:summary?html`<section class="rs-native-settlement"><h2>${summary.won?'本场守住防线':'本场防线失守'}</h2>
      <p>目标生命损失 <b>${summary.hpLoss}</b></p><p>收入 ${summary.income} · 胜利奖励 ${summary.winBonus} · 连胜奖励 ${summary.streakBonus}</p>
      <p>利息 ${summary.interest} · 结算金币 ${summary.goldAfter} · 经验 ${summary.xpAfter}</p><button onClick=${()=>showReplay(summary.round)}>回放本场</button><${LinkCopy} kind="section" id="last-settlement"/></section>`:html`<p>本场结算尚未记录</p>`:null;
  return html`<main class=${`screen gm rs-game ${state.phase==='complete'&&!replay?'is-terminal':''}`}>
    <section class="gm__field" ref=${host} aria-label="共鸣战场"><div class="gm__vignette"></div></section>
    <div class="gm__hud">
      <${TopBar} pub=${{round:replay?.round??state.round,phase:replay?'battle':state.phase}} priv=${{lp:state.hp,alive:true}} conn=${null} hud=${null} total=${null} drawer=${panel==='formation'?'info':null} pen=${!replay&&panel==='enemy'} penAvail=${!replay&&!!state.nextEnemies?.length&&state.node?.kind!=='logistics'} onPen=${enabled=>setPanel(enabled?'enemy':null)} onExit=${onLeave} onDrawer=${tab=>setPanel(tab==='info'?(panel==='formation'?null:'formation'):null)} onReady=${()=>{}}
        leftMeta=${html`<div class="rs-gmeta"><${MicroLabel} tone="mint">卫戍协议 · 共鸣</${MicroLabel}><b>${catalog.environments[state.environmentId]?.shortName||catalog.environments[state.environmentId]?.name||'共鸣'}</b><${DifficultyTag} difficulty=${state.difficulty} size="sm"/></div>`}
        phaseContent=${html`<span class="rs-phase">${replay?'战斗回放':state.phase==='choice'?'选择补给':state.phase==='battle'?'交战':state.phase==='complete'?'已结束':state.nodeStarted?'整备':'补给'}</span>`}
        rightContent=${replay?html`<div class="rs-hud-actions"><span class="rs-phase">第 ${replay.round} 场</span></div>`:html`<div class="rs-hud-actions">
          ${state.phase==='choice'&&state.pendingChoices?.length&&panel!=='choice'?html`<${Button} size="sm" onClick=${()=>setPanel('choice')}>继续选择</${Button}>`:null}
          <${Button} size="sm" square=${true} title="装备" onClick=${()=>setPanel('equipment')}><${GIcon} name="gear"/></${Button}><${Button} size="sm" square=${true} title="战术图鉴" onClick=${()=>setPanel('codex')}><${GIcon} name="book"/></${Button}>
          <a class="rs-fullscreen-small" href=${location.href} target="_blank" rel="noopener">全屏打开</a><${Button} size="sm" onClick=${copyHistory}>复制本局链接</${Button}></div>`}/>
      ${replay?null:html`<div class="rs-gm-bonds"><${BondStrip} bonds=${bonds} records=${pactRecords} onOpen=${id=>openDetail({kind:'pact',id})} iconFor=${()=>null} emptyLabel="部署激活" max=${8}/></div>`}
      ${replay?null:html`<nav class="rs-strategy-pins" aria-label="已选策略">${(state.strategies||[]).map(entry=>{const id=typeof entry==='string'?entry:entry.id,record=catalog.strategies?.[id],progress=state.strategyState?.[id];return html`<button key=${id} title=${record?.description||record?.name} onClick=${()=>openDetail({kind:'strategy',id})}><${GIcon} name="book"/><span><b>${record?.name||'本局策略'}</b><small>${strategyProgressText(progress)||'生效条件依策略而定'}</small></span></button>`})}</nav>`}
      ${replay?null:html`<nav class="rs-dock" aria-label="局内面板"><${Button} size="sm" variant="secondary" onClick=${()=>setPanel('pacts')}><${GIcon} name="bond"/>盟约</${Button}><${Button} size="sm" variant="secondary" onClick=${()=>setPanel('enemy')}><${GIcon} name="target"/>敌情</${Button}>
        <${Button} size="sm" variant="secondary" onClick=${()=>setPanel('formation')}><${GIcon} name="team"/>阵容</${Button}><${Button} size="sm" variant="secondary" onClick=${()=>setPanel('strategies')}><${GIcon} name="book"/>策略</${Button}><${Button} size="sm" variant="secondary" onClick=${()=>setPanel('report')}><${GIcon} name="eye"/>战报</${Button}></nav>`}
      ${replay?null:html`<${ShopBar} priv=${shopPriv} editable=${!busy&&['prep','choice'].includes(state.phase)} collapsed=${shopCollapsed} onCollapse=${setShopCollapsed}
        onBuy=${i=>{const offer=state.shop?.offers?.[i];if(offer)act({type:'buy',offerUid:offer.uid})}} onLevel=${()=>act({type:'buyXp'})} onRefresh=${()=>act({type:'refresh'})}
        onFreeze=${()=>act({type:'lockShop',locked:!state.shop.locked})} onDetail=${(target,kind)=>openDetail({kind:kind==='chess'?'operator':kind==='item'?'item':kind,id:target})} hideItem=${true}
        onDetailClose=${()=>setDetail(null)} onRefuse=${reason=>{}} barRef=${null} cardPresentation=${cardPresentation}
        renderSlotAction=${(slot)=>slot.offerUid?html`<${Button} variant="ghost" size="sm" square=${true} icon="copy" class="rs-shop-offer-copy" title="复制招募卡链接" aria-label="复制招募卡链接" onClick=${()=>copyLinkFn('offer',slot.offerUid)}/>`:null}
        bondRenderer=${id=>html`<span>${pacts[id]?.name||''}</span>`} reasonFor=${reasonFor}
        renderLevel=${()=>{const xpPrice=state.actionCosts?.xpGold??4,full=state.level>=10,disabled=busy||full||!['prep','choice'].includes(state.phase)||state.gold<xpPrice;return html`<button type="button" class=${`lvcard rs-level-card ${full?'is-max':''} ${disabled?'is-disabled':''}`} disabled=${disabled} onClick=${()=>act({type:'buyXp'})} title=${full?'科技已满级':`购买经验 · ${xpPrice}金`}>
          ${!full?html`<${HexBadge} value=${xpPrice} tone=${disabled?'dark':'gold'} size="md" class="lvcard__price"/>`:null}<span class="lvcard__frame"><span class="lvcard__micro">LEVEL</span><b class="lvcard__num num">${state.level}</b></span>
          <span class="lvcard__xp"><i><em style=${{width:`${Math.min(100,state.xp/xpNeed*100)}%`}}></em></i><small>${state.xp}/${xpNeed}</small></span><span class="lvcard__label">${full?'已满级':'购买经验'}</span>${full?null:html`<kbd class="lvcard__key">D</kbd>`}</button>`}}
        renderFunds=${html`<div class="funds rs-funds"><div class="funds__hex"><${CoinGlyph} class="funds__coin"/><b class="funds__num num">${state.gold}</b></div><span class="funds__label">金币</span><span class="rs-interest" title=${`当前利息 ${Math.min(state.actionCosts?.interestCap??5,Math.floor(state.gold/10))}，每十金增加一点`}>${Array.from({length:5},(_,i)=>html`<i class=${i<Math.min(state.actionCosts?.interestCap??5,Math.floor(state.gold/10))?'is-on':''}/>`)}<small>利息</small></span><button class="funds__collapse" onClick=${()=>setShopCollapsed(true)}>收起</button></div>`}/>`}
      ${replay?null:html`<div class="rs-turn-action"><${Button} variant="primary" size="lg" disabled=${busy||state.phase!=='prep'||(state.node?.kind!=='logistics'&&!state.deployedCount)} onClick=${()=>state.node?.kind==='logistics'||!state.nodeStarted?act({type:'advanceSupply'}):act({type:'fight'})}>${state.node?.kind==='logistics'||!state.nodeStarted?'领取补给':'开始战斗'}</${Button}></div>`}
    </div>
    ${!replay&&state.pendingChoices?.length&&state.phase==='choice'&&choiceOpen?html`<div class="spov rs-choice-full" role="dialog" aria-modal="true" aria-label="选择补给"><div class="spov__veil"></div><${Button} class="rs-choice-collapse" size="sm" onClick=${()=>setPanel(null)}>收起整备</${Button}>${state.pendingChoices.map(makeChoice)}</div>`:null}
    ${!replay&&panel==='codex'?html`<div class="rs-codex-overlay"><${CodexScreen} catalog=${catalog} activeIds=${state.activeOperatorIds||[]} onBack=${()=>{const url=new URL(location.href);url.searchParams.delete('view');url.hash='';history.replaceState(null,'',url);setDetail(null);setPanel(null)}} onDetail=${openDetail} overlayDetail=${detail?html`<${DetailPanel} detail=${detail} catalog=${catalog} state=${state} onDetail=${openDetail} onAction=${act} busy=${busy} onClose=${()=>setDetail(null)}/>`:null}/></div>`:null}
    ${!replay&&title?html`<${Modal} open=${true} title=${title} micro="共鸣 · 局内" class="rs-game-panel-modal" onClose=${()=>setPanel(null)} width=${panel==='report'?'min(1100px,96vw)':'min(92vw,920px)'}>${content}<//>`:null}
    ${replay?html`<${ReplayControls} key=${`${replay.round}:${replay.frames?.length||0}`} replay=${replay} frame=${frame} playing=${playing} setPlaying=${setPlaying} speed=${speed} setSpeed=${setSpeed} jumpToEnd=${jumpToEnd} onClose=${closeReplay}/>`:null}
    ${state.phase==='complete'&&!replay?html`<section class="rs-final-screen"><div class=${`screen result ${won?'is-win':'is-lose'}`} id="rs-section-settlement" style=${resultBg?{'--result-bg':`url("${resultBg}")`}:undefined}>
      <div class="result__bg" aria-hidden="true"></div><div class="result__grid" aria-hidden="true"></div>
      <main class="result__main"><section class="result__hero"><${DifficultyTag} difficulty=${state.difficulty} size="md"/><h1 class="result__headline">${won?'防线守住了':state.terminalReason==='hp-depleted'?'目标已失守':'本局未通关'}</h1>
        <p class="result__sub">${won?'最终领袖已被击败。':state.terminalReason==='hp-depleted'?'保护目标生命已耗尽。':'最终领袖未被击败。'}</p>
        <div class="result__rounds"><span class="result__rlabel">推进节点</span><b class="result__rnum num">${state.round}</b><span class="result__rof num">/ ${state.roundLimit}</span></div>
        <p class="rs-result-record">守住 ${settled.filter(x=>x.won).length} 场 · 失守 ${settled.filter(x=>!x.won).length} 场</p>
        <footer class="result__foot"><${Button} variant="primary" size="lg" onClick=${onLeave}>返回开始界面</${Button}><${Button} size="lg" onClick=${()=>setPanel('report')}>查看战报</${Button}><${LinkCopy} kind="section" id="settlement"/></footer>
      </section><section class="result__players"><h2 class="brief-h">最终阵容</h2>
        ${(state.pieces||[]).map(piece=>{const op=catalog.operators[piece.operatorId],gear=piece.equipment||[],portrait=assets.avatar(op?.charId);return html`<details class="rs-result-member" id=${`final-member-${encodeURIComponent(piece.uid)}`} key=${piece.uid}><summary>${portrait?html`<img src=${portrait} alt="" loading="lazy"/>`:null}<b>${op?.name||'干员'}</b><span>${piece.star}星 · ${piece.row==null?'整备区':'作战区'}</span><${LinkCopy} kind="finalMember" id=${piece.uid}/></summary>
          <div><span>装备：${gear.length?gear.map(item=>html`<span key=${item.uid}>${catalog.equipment[item.itemId]?.name||'装备'} <${LinkCopy} kind="item" id=${item.itemId}/></span>`):'未装备'}</span><button class="rs-inline-detail" onClick=${()=>openDetail({kind:'operator',id:piece.operatorId,pieceUid:piece.uid})}>查看干员</button></div></details>`})}
        <details class="rs-result-member"><summary>本局策略</summary><div>${(state.strategies||[]).map(entry=>{const id=typeof entry==='string'?entry:entry.id;return html`<span key=${id}><button class="rs-inline-detail" onClick=${()=>openDetail({kind:'strategy',id})}>${catalog.strategies?.[id]?.name||'本局策略'}</button> <${LinkCopy} kind="strategy" id=${id}/></span>`})}</div></details>
      </section></main></div></section>`:null}
    ${!replay&&summary?html`<aside class="rs-settlement-toast"><b>${summary.won?'本场守住防线':'本场防线失守'}</b><button onClick=${()=>setPanel('settlement')}>结算明细</button><button onClick=${()=>showReplay(summary.round)}>回放</button></aside>`:null}
    ${!replay&&facing&&view?html`<${FacingWheel} key=${`${facing.piece.uid}:${facing.row},${facing.col}`} view=${view} row=${facing.row} col=${facing.col} grid=${facing.grid} name=${facing.name} onPreview=${dir=>setPieceDir(view,pieceNum(facing.piece.uid),dir||facing.piece.dir||'RIGHT')} onCommit=${commitFacing} onCancel=${cancelFacing}/>`:null}
    ${!replay&&memberLinkMenu?html`<aside role="menu" class="rs-member-menu"><span>${state.pieces.find(x=>x.uid===memberLinkMenu.uid)?.operator?.name||'干员'}</span><button onClick=${()=>{const x=state.pieces.find(y=>y.uid===memberLinkMenu.uid);if(x)openDetail({kind:'operator',id:x.operatorId,pieceUid:x.uid});setMemberLinkMenu(null)}}>干员操作</button><button onClick=${async()=>{await copyLinkFn('member',memberLinkMenu.uid);setMemberLinkMenu(null)}}>复制成员链接</button><button onClick=${()=>setMemberLinkMenu(null)}>关闭</button></aside>`:null}
    ${replay||panel==='codex'?null:html`<${DetailPanel} detail=${detail} catalog=${catalog} state=${state} onDetail=${openDetail} onAction=${act} busy=${busy} onClose=${()=>setDetail(null)}/>`}
  </main>`;
}
