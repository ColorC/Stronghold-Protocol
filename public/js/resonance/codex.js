import {useEffect,useState} from '../../vendor/hooks.module.js';
import {html,Button,Icon,MicroLabel} from '../ui/components.js';
import {CatalogPanels,RosterPanel} from './panels.js';
import {parseDetailHash} from './model.js';

const TABS=[['operators','干员'],['pacts','盟约'],['equipment','装备'],['recipes','配方'],['strategies','策略'],['openingEvents','开局事件'],['economy','经营规则']];
const SECTION={pacts:'pact-catalog',equipment:'equipment-catalog',recipes:'recipe-catalog',strategies:'strategy-catalog',openingEvents:'opening-event-catalog',economy:'economy-rules'};
const DETAIL_TAB={operator:'operators',pact:'pacts',item:'equipment',recipe:'recipes',strategy:'strategies',opening:'openingEvents'};
export function CodexScreen({catalog,activeIds,onBack=()=>{},onDetail,initialTab='operators',overlayDetail=null}){
 const tabs=TABS.filter(([id])=>id!=='openingEvents'||!!catalog.openingEvents);
 const [tab,setTab]=useState(()=>{if(initialTab!=='operators')return initialTab;const target=parseDetailHash(location.hash);return target?.kind==='section'?(Object.entries(SECTION).find(([,id])=>id===target.id)?.[0]||'operators'):DETAIL_TAB[target?.kind]||'operators'});
 const activeTab=tabs.some(([id])=>id===tab)?tab:'operators';
 useEffect(()=>{const target=parseDetailHash(location.hash);if(target&&target.kind!=='section')return;const url=new URL(location.href);url.searchParams.set('view','codex');url.hash=activeTab==='operators'?'':`section-${SECTION[activeTab]}`;history.replaceState(null,'',url)},[activeTab]);
 return html`<main class=${`lo rs-start rs-codex rs-codex--${activeTab}`}><div class="lo__bg" aria-hidden="true"></div><header class="lo-top"><div class="lo-top__left"><${Button} variant="ghost" icon="chevronLeft" onClick=${onBack}>返回<//></div><div class="lo-top__center"><h1 class="lo-top__title"><${Icon} name="book"/>战术图鉴</h1><${MicroLabel} tone="mint">干员 · 盟约 · 装备 · 战术<//></div><div class="lo-top__right"><a class="rs-fullscreen" href=${location.href} target="_blank" rel="noopener">全屏打开</a></div></header><nav class="lo-seg rs-codex__tabs" role="tablist">${tabs.map(([id,label])=>html`<button role="tab" aria-selected=${activeTab===id} class=${activeTab===id?'is-selected':''} onClick=${()=>setTab(id)}>${label}</button>`)}</nav><div class="lo-body rs-codex__content" key=${activeTab}>${activeTab==='operators'?html`<${RosterPanel} catalog=${catalog} activeIds=${activeIds} onlyActive=${true} onDetail=${onDetail}/>`:html`<${CatalogPanels} catalog=${catalog} onDetail=${onDetail} section=${SECTION[activeTab]}/>`}</div>${overlayDetail}</main>`;
}