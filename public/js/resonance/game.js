import { useCallback,useEffect,useLayoutEffect,useRef,useState } from '../../vendor/hooks.module.js';
import { html, Button } from '../ui/components.js';
import { useFieldView } from '../ui/fieldHost.js';
import { useGameData } from '../ui/gameComponents.js';
import { FacingWheel,holdPiece,setPieceDir } from '../ui/facingWheel.js';
import { data } from '../data.js';
import { actionErrorText,adjacentDeployedPairs,choiceDescription,choiceLabel,copyLink,needsAdjacentStrategyPair,parseDetailHash,pieceNum,prepView } from './model.js';
import { LinkCopy } from './panels.js';
import { resonanceApi } from './api.js';
import { toast } from '../ui/toasts.js';
import { audio } from '../audio.js';
import { GIcon } from '../ui/gameComponents.js';
import { GameChrome } from './gameChrome.js';

export function GameScreen({id,initial,catalog,onLeave,onState}) {
 const [state,setState]=useState(initial); const stateRef=useRef(state);stateRef.current=state;
 const [busy,setBusy]=useState(false),[detail,setDetail]=useState(null),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[replay,setReplay]=useState(null),[facing,setFacing]=useState(null),[summary,setSummary]=useState(null),[choiceSelections,setChoiceSelections]=useState({}),[strategyTargets,setStrategyTargets]=useState({}),[memberLinkMenu,setMemberLinkMenu]=useState(null),[panel,setPanel]=useState(null),[shopCollapsed,setShopCollapsed]=useState(false);
 const host=useRef(null);const {view}=useFieldView(host);const gd=useGameData();const actLock=useRef(false);
 useEffect(()=>{const open=()=>{const target=parseDetailHash(location.hash);if(!target)return;const {kind,id}=target;const sections={pacts:'pacts',pact:'pacts',equipment:'equipment',inventory:'equipment',equipped:'equipment',shop:'shop',offer:'shop',strategies:'strategies','battle-report':'report',field:'formation',settlement:'settlement','last-settlement':'settlement',choice:'choice',node:'enemy',battleNode:'enemy'};if(kind==='member'||kind==='finalMember'){const piece=stateRef.current.pieces.find(p=>p.uid===id);if(piece){setPanel(null);setDetail({kind:'operator',id:piece.operatorId,pieceUid:piece.uid})}}else if(['operator','pact','item','recipe','strategy','environment'].includes(kind))setDetail({kind,id});else if(kind==='section')setPanel(sections[id]||'codex');else if(kind==='offer'){const offer=stateRef.current.shop?.offers?.find(x=>x.uid===id);if(offer?.operatorId)setDetail({kind:'operator',id:offer.operatorId});setPanel('shop')}else if(kind==='node'||kind==='battleNode')setPanel('enemy');else if(kind==='battleReport')setPanel('report');else if(kind==='replay'){const round=Number(id);if(Number.isInteger(round)&&round>0)showReplay(round)}else if(kind==='choice')setPanel('choice');else if(kind==='inventory'||kind==='equipped')setPanel('equipment')};open();addEventListener('hashchange',open);return()=>removeEventListener('hashchange',open)},[]);
 useEffect(()=>{const target=parseDetailHash(location.hash);if(!target)return;const {kind,id}=target;const key={offer:`offer-${encodeURIComponent(id)}`,inventory:`inventory-${id}`,equipped:`equipped-${id}`,finalMember:`final-member-${encodeURIComponent(id)}`,node:`node-${id}`,battleNode:`battle-node-${id}`,battleReport:`battle-report-${id}`,choice:`choice-${id}`}[kind]|| (kind==='section'?`rs-section-${id}`:null);if(!key)return;requestAnimationFrame(()=>requestAnimationFrame(()=>{const element=document.getElementById(key);element?.scrollIntoView?.({behavior:'smooth',block:kind==='section'?'start':'center',inline:'center'});element?.focus?.({preventScroll:true})}))},[panel,state]);
 const update=useCallback((packet)=>{if(packet?.state){stateRef.current=packet.state;setState(packet.state);onState?.(packet.state)}},[onState]);
 const act=useCallback(async(action)=>{if(actLock.current)return;actLock.current=true;setBusy(true);try{let res=await resonanceApi.act(id,stateRef.current.revision,action);if(res.state)update(res);if(!res.ok){if(res.error?.code==='STALE_REVISION'){const latest=await resonanceApi.load(id);if(latest.ok)update(latest);toast('对局状态已更新，请重新操作','warn')}else toast(actionErrorText(res.error),'warn');return null}const logisticsReady=res.state?.phase==='prep'&&res.state?.difficulty==='FUNNY'&&res.state?.node?.kind==='logistics'&&res.state?.nodeStarted&&res.state?.round%2===1&&res.state?.pendingChoices?.length===0;if(logisticsReady&&(action.type==='advanceSupply'||action.type==='claimReward'||action.type==='chooseStrategy')){const settled=await resonanceApi.act(id,res.state.revision,{type:'advanceSupply'});if(!settled.ok){toast(actionErrorText(settled.error),'warn');return null}res={...settled,events:[...(res.events||[]),...(settled.events||[])]};update(res)}if(action.type==='fight'){const ev=(res.events||[]).find(e=>e.type==='fight-settled');setSummary(ev||null);const round=ev?.round||Math.max(1,(res.state.round||2)-1);const rep=await resonanceApi.replay(id,round);if(rep){setPanel(null);setDetail(null);setMemberLinkMenu(null);frame.current=0;setReplay(rep);setPlaying(true)}}return res;}catch{toast('连接中断，请检查网络后重试','warn');return null}finally{actLock.current=false;setBusy(false)}},[id,update]);
 useEffect(()=>{if(!view||!gd.ready||replay)return;const stageId=state.node?.stageId;const stage=stageId?data.lookup('stages',stageId):null;if(stage)view.setStage(stage);view.setCamera('prep');const occupied=new Set(state.pieces.filter(p=>p.row!=null).map(p=>`${p.row},${p.col}`));view.setPrep(prepView(state,catalog),{editable:['prep','choice'].includes(state.phase)&&!busy,canPlace:(n,t)=>{const p=state.pieces.find(x=>pieceNum(x.uid)===n);if(!p||!['prep','choice'].includes(state.phase)||!t)return false;if(t.area==='hand')return p.row!=null;if(t.area!=='board')return false;const key=`${t.row},${t.col}`;return (p.legalTiles||[]).includes(key)&&(!occupied.has(key)||(p.row===t.row&&p.col===t.col));}});},[view,gd.ready,state,busy,replay,catalog]);
 useEffect(()=>{if(!view||replay)return;const off=view.on('pieceDrop',async(e)=>{const p=stateRef.current.pieces.find(x=>pieceNum(x.uid)===e?.uid);const t=e?.target||{};if(!p)return;if(t.area==='hand'){await act({type:'bench',pieceUid:p.uid});return}if(t.area==='board'&&Number.isInteger(t.row)&&Number.isInteger(t.col)){holdPiece(view,e.uid,{row:t.row,col:t.col});const rec=data.lookup('chess',p.operatorId);setFacing({piece:p,row:t.row,col:t.col,grid:Array.isArray(rec?.rangeGrid)?rec.rangeGrid:null,name:rec?.name||''});}});return()=>off?.();},[view,replay,act]);
 useEffect(()=>{if(!view||replay)return;const off=view.on('pieceDetail',(event)=>{const piece=stateRef.current.pieces.find(p=>pieceNum(p.uid)===Number(event?.uid));if(piece)setMemberLinkMenu({uid:piece.uid,x:event.clientX||20,y:event.clientY||20})});return()=>off?.();},[view,replay]);
 useEffect(()=>{if(!view||!replay)return;const stage=replay.stageId?data.lookup('stages',replay.stageId):null;if(stage)view.setStage(stage);view.enterBattle(replay.field);view.setCamera(replay.kind==='hidden'?'boss':replay.kind||'normal',{rect:replay.field?.rect,side:'L'});audio.setFieldUnits([]);setPlaying(true);},[view,replay]);
 const showReplay=async(round)=>{const rec=await resonanceApi.replay(id,round);if(rec){setPanel(null);setDetail(null);setMemberLinkMenu(null);frame.current=0;setReplay(rec);setPlaying(true)}};
 const jumpToEnd=()=>{const frames=replay?.frames||[];const last=frames.at(-1);for(let index=frame.current;index<frames.length;index++){const pending=frames[index];if(pending?.ev?.length){view?.pushEvents({t:'b.ev',fieldId:replay.field?.fieldId,gt:pending.snap?.t,ev:pending.ev});audio.handleBattleEvents(pending.ev)}}if(last?.snap&&frame.current<frames.length)view?.pushSnapshot(last.snap);frame.current=frames.length;setPlaying(false)};
 const frame=useRef(0);useEffect(()=>{if(!playing||!view||!replay?.frames?.length)return;let timer;const step=()=>{const frames=replay.frames;if(frame.current>=frames.length){setPlaying(false);return}const f=frames[frame.current++];if(f.ev?.length){view.pushEvents({t:'b.ev',fieldId:replay.field?.fieldId,gt:f.snap?.t,ev:f.ev});audio.handleBattleEvents(f.ev)}if(f.snap)view.pushSnapshot(f.snap);timer=setTimeout(step,Math.max(1,40/speed))};step();return()=>clearTimeout(timer)},[playing,view,replay,speed]);
 const move=async(piece,row,col,dir)=>{if(row==null){await act({type:'bench',pieceUid:piece.uid});return}if(dir&&dir!==piece.dir){await act({type:'turn',pieceUid:piece.uid,dir});return}if(piece.row==null)await act({type:'deploy',pieceUid:piece.uid,row,col,dir:'RIGHT'});else await act({type:'move',pieceUid:piece.uid,row,col,dir:dir||piece.dir||'RIGHT'})};
 const commitFacing=async(dir)=>{const f=facing;if(!f)return;setFacing(null);const p=stateRef.current.pieces.find(x=>x.uid===f.piece.uid);const result=p.row==null?await act({type:'deploy',pieceUid:p.uid,row:f.row,col:f.col,dir}):await act({type:'move',pieceUid:p.uid,row:f.row,col:f.col,dir});holdPiece(view,pieceNum(p.uid),null);if(!result)setPieceDir(view,pieceNum(p.uid),p.dir||'RIGHT');};
 const cancelFacing=()=>{if(facing){holdPiece(view,pieceNum(facing.piece.uid),null);setPieceDir(view,pieceNum(facing.piece.uid),facing.piece.dir||'RIGHT')}setFacing(null)};
 const copyHistory=()=>copyLink('session',id);
 const lastSettlement=summary||[...(state.history||[])].reverse().find(entry=>entry.type==='fight-settled')||null;
 useEffect(()=>{if(state.phase==='choice'&&state.pendingChoices?.length)setPanel('choice')},[state.phase,state.pendingChoices]);
 const openDetail=(target)=>{if(panel!=='codex')setPanel(null);setDetail(target)};
 useLayoutEffect(()=>{const onKeyDown=(event)=>{
   const key=event.key.toLowerCase(),target=event.target;
   if(key==='escape'){
     const modal=document.querySelector('.modal');
     if(modal){
       const localPanelModal=document.querySelector('.modal__box.rs-game-panel-modal')?.closest('.modal');
       if(panel&&panel!=='codex'&&localPanelModal===modal){setPanel(null);event.preventDefault();event.stopImmediatePropagation()}
       return;
     }
     if(detail){setDetail(null);event.preventDefault();return}
     if(memberLinkMenu){setMemberLinkMenu(null);event.preventDefault();return}
     if(panel){setPanel(null);event.preventDefault();return}
     return;
   }
   if(target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
   if(key===' '||key==='spacebar'){
     if(!replay||frame.current>=(replay.frames?.length||0)||document.querySelector('.modal,.rs-codex-overlay,.rs-choice-full'))return;
     event.preventDefault();setPlaying(value=>!value);return;
   }
   if(!['r','f','d'].includes(key)||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
   if(busy||!['prep','choice'].includes(state.phase)||replay||detail||panel||facing||memberLinkMenu||document.querySelector('.modal,.rs-choice-full,.rs-codex-overlay'))return;
   if(key==='r'){
     const price=Number(state.actionCosts?.refreshGold??2);if(state.gold>=price){event.preventDefault();act({type:'refresh'})}
   }else if(key==='f'){
     if(state.actionCosts?.canLockShop!==false){event.preventDefault();act({type:'lockShop',locked:!state.shop?.locked})}
   }else if(key==='d'){
     const price=Number(state.actionCosts?.xpGold??4);if(state.level<10&&state.gold>=price){event.preventDefault();act({type:'buyXp'})}
   }
 };
 window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown)
 },[state,busy,replay,detail,panel,facing,memberLinkMenu,act]);
 const makeChoice=(choice)=>{const selected=choiceSelections[choice.uid]||[];return html`<section class="spov__inner rs-choice-overlay" id=${`choice-${choice.uid}`} key=${choice.uid}>
   <header class="spov__head"><div class="spov__titles"><small class="micro">共鸣 · 选择</small><h2 class="spov__title">${choice.type==='strategy'?'选择策略':'领取补给'} · 还需 ${Math.max(0,choice.remaining-selected.length)} 项</h2>
     <p class="spov__sub">点选选项预览，再确认生效</p></div><${Button} variant="primary" size="lg" icon="check" class="spov__confirm" disabled=${busy||selected.length<choice.remaining||(choice.type==='strategy'&&needsAdjacentStrategyPair(catalog.strategies?.[selected[0]])&&!strategyTargets[selected[0]])} onClick=${()=>{
       if(choice.type==='strategy'){const option=selected[0],pair=strategyTargets[option]||'',targets=pair?{pieceUids:pair.split('|')}:{},def=catalog.strategies?.[option];
         if(needsAdjacentStrategyPair(def)&&!pair)return;act({type:'chooseStrategy',choiceUid:choice.uid,strategyId:option,targets});}
       else act({type:'claimReward',choiceUid:choice.uid,optionIds:selected});setChoiceSelections({...choiceSelections,[choice.uid]:[]});}}>确认选择</${Button}></header>
   <div class="spov__grid spov__grid--3">${choice.options?.map(option=>{const def=catalog.strategies?.[option],needsPair=choice.type==='strategy'&&needsAdjacentStrategyPair(def),pairs=needsPair?adjacentDeployedPairs(state):[],pair=strategyTargets[option]||'';
      return html`<article class="rs-choice-option" key=${option}><button type="button" class=${`spcard spcard--tactic ${selected.includes(option)?'is-armed':''}`} aria-pressed=${String(selected.includes(option))}
        onClick=${()=>{if(choice.type==='strategy'){setChoiceSelections({...choiceSelections,[choice.uid]:[option]});setDetail({kind:'strategy',id:option});return}
          setChoiceSelections({...choiceSelections,[choice.uid]:selected.includes(option)?selected.filter(x=>x!==option):selected.length<choice.remaining?[...selected,option]:selected});
          const target=catalog.operators?.[option]?{kind:'operator',id:option}:catalog.pacts?.[option]?{kind:'pact',id:option}:catalog.equipment?.[option]?{kind:'item',id:option}:null;if(target)setDetail(target)}}>
        <span class="spcard__glow"></span><span class="spcard__head"><span class="spcard__icon"><${GIcon} name="bolt"/></span><span class="spcard__title"><b class="spcard__name">${choiceLabel(choice,option,state,catalog)}</b></span></span>
        <span class="spcard__desc">${choiceDescription(choice,option,state,catalog)}</span></button>
        ${needsPair?html`<label>相邻干员<select value=${pair} onChange=${e=>setStrategyTargets({...strategyTargets,[option]:e.target.value})}><option value="">选择一组相邻干员</option>${pairs.map(([a,b])=>html`<option value=${`${a.uid}|${b.uid}`}>${a.operator?.name||catalog.operators[a.operatorId]?.name} + ${b.operator?.name||catalog.operators[b.operatorId]?.name}</option>`)}</select></label>`:null}
        ${choice.type==='strategy'?html`<${LinkCopy} kind="strategy" id=${option}/>`:choice.type==='recipe'?html`<${LinkCopy} kind="recipe" id=${catalog.recipes.findIndex(x=>x.resultId===option)}/>`:null}</article>`})}</div></section>`};
 return html`<${GameChrome} state=${state} catalog=${catalog} host=${host} detail=${detail} setDetail=${setDetail} setPanel=${setPanel} panel=${panel} busy=${busy} act=${act} onLeave=${onLeave}
   copyHistory=${copyHistory} shopCollapsed=${shopCollapsed} setShopCollapsed=${setShopCollapsed} replay=${replay} playing=${playing} setPlaying=${setPlaying} speed=${speed} setSpeed=${setSpeed}
   frame=${frame} jumpToEnd=${jumpToEnd} view=${view} summary=${lastSettlement} showReplay=${showReplay} setReplay=${setReplay} move=${move} openDetail=${openDetail}
   facing=${facing} commitFacing=${commitFacing} cancelFacing=${cancelFacing} choiceSelections=${choiceSelections} setChoiceSelections=${setChoiceSelections} strategyTargets=${strategyTargets}
   setStrategyTargets=${setStrategyTargets} makeChoice=${makeChoice} choiceOpen=${panel==='choice'} memberLinkMenu=${memberLinkMenu} setMemberLinkMenu=${setMemberLinkMenu} copyLinkFn=${copyLink} />`;

}
