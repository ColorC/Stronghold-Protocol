import {pieceNum} from './model.js';

export function equippedUnitItems(state,replay){
 if(replay)return (replay.field?.units||[]).filter(u=>u.side==='ally'&&u.kind==='op'&&u.items?.length).map(u=>({key:`battle:${u.id}`,screenUid:u.uid??u.id,alternateUid:u.id,items:u.items.slice(0,3),historical:true}));
 return (state?.pieces||[]).filter(p=>p.equipment?.length).map(p=>({key:`prep:${p.uid}`,screenUid:pieceNum(p.uid),items:p.equipment.slice(0,3).map(i=>i.itemId),historical:false}));
}

export function mountUnitItemOverlay({view,getState,getReplay,getCatalog,getIcon=()=>null,onDetail,getDragging=()=>false,document:doc=globalThis.document,requestFrame=globalThis.requestAnimationFrame,cancelFrame=globalThis.cancelAnimationFrame}){
 const root=doc.createElement('div');root.className='rs-unit-items';doc.body.append(root);
 const rows=new Map();let frame=null,last=-Infinity,disposed=false,nativeDrag=false;
 const cssId='resonance-unit-items-css';if(!doc.getElementById(cssId)){const link=doc.createElement('link');link.id=cssId;link.rel='stylesheet';link.href=new URL('../../css/resonance-unit-items.css',import.meta.url).href;doc.head.append(link);}
 const dragStart=()=>{nativeDrag=true;root.classList.toggle('is-dragging',true)},dragEnd=()=>{nativeDrag=false;root.classList.toggle('is-dragging',getDragging())};doc.addEventListener('dragstart',dragStart);doc.addEventListener('dragend',dragEnd);doc.addEventListener('drop',dragEnd);
 const tick=time=>{
  if(disposed)return;
  frame=requestFrame(tick);if(time-last<1000/30)return;last=time;
  const catalog=getCatalog(),entries=equippedUnitItems(getState(),getReplay()),live=new Set(entries.map(e=>e.key));
  for(const [key,row] of rows)if(!live.has(key)){row.element.remove();rows.delete(key);}
  root.classList.toggle('is-dragging',nativeDrag||getDragging());
  for(const entry of entries){
   let row=rows.get(entry.key);const signature=entry.items.map(id=>`${id}:${getIcon(catalog,id)||''}`).join('|');
   if(!row){const element=doc.createElement('div');element.className='rs-unit-items__row';element.dataset.unitKey=entry.key;root.append(element);row={element,signature:null};rows.set(entry.key,row);}
   if(row.signature!==signature){row.element.replaceChildren();for(const id of entry.items){const item=catalog?.equipment?.[id],button=doc.createElement('button'),image=doc.createElement('img');button.type='button';button.className='rs-unit-items__item';button.title=`${item?.name||'装备'}${item?.description?`：${item.description}`:''}`;button.setAttribute('aria-label',item?.name||'装备');button.dataset.itemId=id;image.src=getIcon(catalog,id)||'';image.alt=item?.name||'装备';image.draggable=false;button.append(image);const show=event=>{if(nativeDrag||getDragging())return;event?.stopPropagation();onDetail?.({kind:'item',id,source:entry.historical?'battle-snapshot':'member'});};button.addEventListener('click',show);button.addEventListener('contextmenu',event=>{event.preventDefault();show(event)});button.addEventListener('pointerdown',event=>event.stopPropagation());row.element.append(button);}row.signature=signature;}
   const rect=view.pieceScreenRect?.(entry.screenUid)??view.pieceScreenRect?.(entry.alternateUid),width=doc.documentElement.clientWidth,height=doc.documentElement.clientHeight;
   const visible=rect&&Number.isFinite(rect.left)&&Number.isFinite(rect.top)&&rect.width>0&&rect.right>0&&rect.left<width&&rect.bottom>0&&rect.top<height;
   row.element.hidden=!visible;if(!visible)continue;
   const size=Math.min(22,Math.max(12,rect.width*.24));row.element.style.setProperty('--unit-item-size',`${size}px`);row.element.style.transform=`translate(${rect.left+rect.width/2}px,${Math.max(0,rect.top-size-4)}px) translateX(-50%)`;
  }
 };
 frame=requestFrame(tick);
 return ()=>{disposed=true;if(frame!=null)cancelFrame(frame);doc.removeEventListener('dragstart',dragStart);doc.removeEventListener('dragend',dragEnd);doc.removeEventListener('drop',dragEnd);root.remove();rows.clear();};
}
