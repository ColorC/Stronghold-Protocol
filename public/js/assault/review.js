import { createReplayReviewConfig, createReplayCommentAnchor, reviewCommentHref } from './replayReviewConfig.js';
let config;
let invalidLink=false;
try{config=createReplayReviewConfig(location.href);}catch{invalidLink=true;config={recordingId:'',title:'游玩回放与批注',sourceUrl:'',commentsApi:'',apiName:'__SP_REPLAY_REVIEW__',duration:0};}
const recordingId=config.recordingId;
if(new URLSearchParams(location.search).get('film')==='1')document.documentElement.classList.add('film');
const film=document.getElementById('film');
const stage=document.getElementById('stage');
const toggle=document.getElementById('toggle');
const seek=document.getElementById('seek');
const marks=document.getElementById('marks');
const clock=document.getElementById('clock');
const status=document.getElementById('status');
const sourceLink=document.getElementById('sourceLink');
const pickBtn=document.getElementById('pick');
const composer=document.getElementById('composer');
const composerAt=document.getElementById('composerAt');
const composerEl=document.getElementById('composerEl');
const composerText=document.getElementById('composerText');
const composerSave=document.getElementById('composerSave');
const composerCancel=document.getElementById('composerCancel');
const composerHint=document.getElementById('composerHint');
const lockbox=document.getElementById('lockbox');
const commentsBox=document.getElementById('comments');
const commentsCount=document.getElementById('commentsCount');
const clist=document.getElementById('clist');
const cempty=document.getElementById('cempty');
const showResolved=document.getElementById('showResolved');
document.title=config.title;
document.getElementById('title').textContent=config.title;
if(invalidLink){status.className='status err';status.textContent='回放链接无效，请检查链接后重试。';toggle.disabled=true;seek.disabled=true;pickBtn.disabled=true;film.hidden=true;}
else film.src=config.sourceUrl;
const reviewUrl=new URL('assault-review.html',location.href);reviewUrl.searchParams.set('recording',recordingId);sourceLink.href=reviewUrl.href;
seek.max=String(config.duration||1);
let requestedPlaying=false;
let initialSeekApplied=false;
const requestedTime=Math.max(0,Number(new URLSearchParams(location.search).get('t'))||0);
const api=()=>film.contentWindow?.[config.apiName];
const fmt=value=>{
  const t=Math.max(0,Number(value)||0);
  return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
};
let seekRequest=0;
const setTime=async value=>{
  const current=api();
  const sequence=++seekRequest;
  const state=typeof current?.state==='function'?(current.state()||{}):{};
  const limit=Number(state.duration??current?.duration??seek.max)||0;
  const target=Math.max(0,Math.min(limit,Number(value)||0));
  if(typeof current?.setTime==='function')await current.setTime(target);
  else if(typeof current?.seek==='function')await current.seek(target);
  else throw new Error('回放定位暂不可用');
  if(sequence===seekRequest)seek.value=String(target);
  return target;
};
const readState=()=>{
  const current=api();
  if(!current)return null;
  const state=typeof current.state==='function'?(current.state()||{}):{};
  return {
    time:Number(state.time??current.getTime?.()??0),
    duration:Number(state.duration??current.duration??config.duration??0),
    ready:state.ready!==false&&state.seeking!==true,
    paused:typeof state.paused==='boolean'?state.paused:!requestedPlaying,
    viewport:state.viewport||null,
    error:typeof state.error==='string'?state.error:'',
  };
};
const pause=()=>{
  const current=api();
  current?.pause?.();
  requestedPlaying=false;
};
toggle.onclick=async()=>{
  const current=api();
  if(!current)return;
  const state=readState();
  if(state&&!state.paused){
    current.pause?.();
    requestedPlaying=false;
  }else{
    await Promise.resolve(current.play?.());
    requestedPlaying=true;
  }
};
seek.oninput=()=>{void setTime(seek.value).catch(error=>{if(error?.name!=='AbortError')setStatusText(`定位失败：${error?.message||error}`,'err');});};

/* ───────── 评论设施：锚点 = 某一秒 + 某一元素 ─────────
   为什么两者都必须有：画面是时间驱动重渲染的，同一个选择器在不同秒指向完全不同的内容。
   只记元素 → 回放时指到别的东西；只记秒 → 说不清在说这一帧里的哪个东西。
   所以圈选前强制暂停（时间定住），锚点把 time_sec 与 selector 一起存。 */
const commentsApi=typeof config.commentsApi==='string'?config.commentsApi:'';
let comments=[];
let picking=false;
let detachPick=null;
let pendingAnchor=null;
let pendingTarget=null;   // {el,frames} 被圈中的元素与它的 iframe 链, 只用于浮层贴位置

/** 选择器构造：规则与 frontend/src/lib/iframePicker.ts 的 buildSelectorPath 同源，
    额外先试影片渲染器自带的稳定属性——class/nth-child 链一改样式就断，data-* 不会。 */
const STABLE_ATTRS=['data-testid','data-visual-engine','data-geom'];
const buildSelector=(el,doc,maxDepth=5)=>{
  if(!el||el===doc.documentElement)return 'html';
  if(el.id)return `#${CSS.escape(el.id)}`;
  for(const attr of STABLE_ATTRS){
    const value=el.getAttribute?.(attr);
    if(!value)continue;
    const candidate=`[${attr}="${CSS.escape(value)}"]`;
    try{ if(doc.querySelectorAll(candidate).length===1)return candidate; }catch{ /* 属性值不可选择, 继续 */ }
  }
  const parts=[];
  let cur=el,depth=0;
  while(cur&&cur!==doc.body&&depth<maxDepth){
    let part=cur.tagName.toLowerCase();
    if(cur.classList?.length){
      part+='.'+[...cur.classList].slice(0,2).map(c=>CSS.escape(c)).join('.');
    }else if(cur.parentElement){
      part+=`:nth-child(${[...cur.parentElement.children].indexOf(cur)+1})`;
    }
    parts.unshift(part);
    cur=cur.parentElement;
    depth++;
  }
  return parts.join(' > ')||el.tagName.toLowerCase();
};
/** 可圈选的文档集合：从影片 iframe 出发递归进嵌套 iframe（同源才可读，跨域自然跳过）。
    path  = 该 doc 相对上一层的 iframe 选择器链，存进锚点，回放时按同一条链逐层进去找元素。
    frames = 同一条链的 iframe **元素引用**，只在本次圈选期间用来把元素坐标换算到
    审阅壳的视口坐标（评论框要贴在元素旁边，就必须知道它在屏幕上的位置）。 */
const collectDocs=()=>{
  const out=[];
  const walk=(doc,path,frames,depth)=>{
    if(!doc||depth>5)return;
    out.push({doc,path,frames});
    for(const frame of [...doc.querySelectorAll('iframe')]){
      let inner=null;
      try{ inner=frame.contentDocument; }catch{ inner=null; }
      if(inner)walk(inner,[...path,buildSelector(frame,doc)],[...frames,frame],depth+1);
    }
  };
  let root=null;
  try{ root=film.contentDocument; }catch{ root=null; }
  walk(root,[],[film],0);
  return out;
};
/** 元素在**审阅壳视口**里的矩形：从最内层往外，逐层按 iframe 的显示/内容比换算并加偏移。
    乘缩放而不是直接相加，是因为 iframe 的显示尺寸和它内部的 CSS 像素尺寸不一定 1:1
    （影片是 1600×900 设计稿，窗口一窄就等于整体缩放）。 */
const screenRectOf=(el,frames)=>{
  const rect=el.getBoundingClientRect();
  let box={x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  for(let i=frames.length-1;i>=0;i--){
    const frame=frames[i];
    const fr=frame.getBoundingClientRect();
    let inner=null;
    try{ inner=frame.contentDocument?.documentElement; }catch{ inner=null; }
    const sx=inner?.clientWidth?fr.width/inner.clientWidth:1;
    const sy=inner?.clientHeight?fr.height/inner.clientHeight:1;
    box={x:fr.x+box.x*sx,y:fr.y+box.y*sy,width:box.width*sx,height:box.height*sy};
  }
  return box;
};
const PICK_STYLE_ID='omni-review-pick-style';
const PICK_CSS=`[data-omni-pick-hover]{outline:2px solid #52d4ff!important;outline-offset:2px}
  [data-omni-pick-flash]{outline:3px solid #ffd166!important;outline-offset:2px;animation:omniPickFlash 1.1s ease-out 2}
  @keyframes omniPickFlash{0%{background:#ffd16640}100%{background:transparent}}
  html[data-omni-picking] *{cursor:crosshair!important}`;
const ensurePickStyle=doc=>{
  if(doc.getElementById(PICK_STYLE_ID))return;
  const style=doc.createElement('style');
  style.id=PICK_STYLE_ID;
  style.textContent=PICK_CSS;
  (doc.head||doc.documentElement).appendChild(style);
};
const clearHover=doc=>doc.querySelectorAll('[data-omni-pick-hover]')
  .forEach(el=>el.removeAttribute('data-omni-pick-hover'));

const stopPicking=()=>{
  picking=false;
  detachPick?.();
  detachPick=null;
  stage.classList.remove('picking');
  pickBtn.setAttribute('aria-pressed','false');
  pickBtn.textContent='圈选加评论';
  statusHold=0;   // 圈选态是常驻文字, 退出就得让轮询收走, 否则会一直写着"圈选中"
};
const startPicking=()=>{
  /* 未 ready 时影片的 setTime 是空转、state().time 恒为 0 —— 此刻圈选会把评论锚到
     00:00 而画面明明停在别处。实测过这个坑（e2e 第一版就锚成了 0 秒），所以挡在门口。 */
  const state=readState();
  if(!state||state.ready===false){
    setStatusText('回放正在载入，等时间轴就绪再圈选','err');
    return;
  }
  const docs=collectDocs();
  if(!docs.length){
    setStatusText('读不到画面 DOM（跨域或还没加载完），圈选不可用','err');
    return;
  }
  pause();                       // 时间必须先定住, 否则锚到的秒和你看到的画面不是同一帧
  /* 圈选按钮在画面下方, 页面又比视口高: 点它会让浏览器为"把按钮露出来"把页面滚到底,
     实测 scrollY 0→310、影片被推到视口上方外(filmRect.y=-207)——画面都看不见了还圈什么。
     所以进圈选先松掉按钮焦点, 再把画面拉回视野; 画面比视口还高时就对齐顶部。 */
  pickBtn.blur();
  stage.scrollIntoView({
    block:stage.getBoundingClientRect().height>innerHeight?'start':'center',
    behavior:'instant',
  });
  picking=true;
  stage.classList.add('picking');
  pickBtn.setAttribute('aria-pressed','true');
  pickBtn.textContent='取消圈选';
  const bound=[];
  for(const {doc,path,frames} of docs){
    ensurePickStyle(doc);
    doc.documentElement.setAttribute('data-omni-picking','1');
    const onOver=ev=>{clearHover(doc);ev.target?.setAttribute?.('data-omni-pick-hover','true')};
    const onClick=ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      const target=ev.target;
      if(!target?.tagName)return;
      const rect=target.getBoundingClientRect?.();
      const state=readState();
      const time=Number(state?.time??seek.value??0);
      pendingAnchor=createReplayCommentAnchor({time,selector:buildSelector(target,doc),framePath:path,tag:target.tagName.toLowerCase(),textExcerpt:target.textContent||'',rect,viewport:{width:doc.documentElement.clientWidth,height:doc.documentElement.clientHeight}});
      pendingTarget={el:target,frames};   // 评论框贴位置用, 只活在本次编辑期间
      stopPicking();
      openComposer();
    };
    doc.addEventListener('mouseover',onOver,true);
    doc.addEventListener('click',onClick,true);
    bound.push(()=>{
      doc.removeEventListener('mouseover',onOver,true);
      doc.removeEventListener('click',onClick,true);
      clearHover(doc);
      doc.documentElement.removeAttribute('data-omni-picking');
      doc.getElementById(PICK_STYLE_ID)?.remove();
    });
  }
  detachPick=()=>bound.forEach(fn=>fn());
  setStatusText('圈选中：点击要评论的画面区域','picking');
};
pickBtn.onclick=()=>{picking?stopPicking():startPicking()};
document.addEventListener('keydown',ev=>{
  if(ev.key!=='Escape')return;
  if(picking)stopPicking();
  else if(composer.dataset.open==='true')closeComposer();
});

const openComposer=()=>{
  if(!pendingAnchor)return;
  composerAt.textContent=fmt(pendingAnchor.time_sec);
  composerEl.textContent='画面区域';
  composerEl.title='';
  composerText.value='';
  composerHint.textContent='';
  composer.dataset.open='true';
  placeComposer();
  composerText.focus();
};
/** 把评论框摆在被圈元素**正下方**，摆不下就翻到上方，再不行就贴住视口边——
    任何一边都不许出界。元素本身可能比视口还高（整块图元区就是），所以先夹取锚点矩形
    到可见范围，再据此定位；否则"元素下方"会算到屏幕外面去。 */
const placeComposer=()=>{
  if(composer.dataset.open!=='true'||!pendingTarget)return;
  const pad=10,gap=8;
  const vw=window.innerWidth,vh=window.innerHeight;
  let box;
  try{ box=screenRectOf(pendingTarget.el,pendingTarget.frames); }catch{ box=null; }
  if(!box){ lockbox.dataset.open='false'; return; }

  // 锁定框照元素真实位置画(超出部分自然被视口裁掉)
  lockbox.style.left=`${Math.round(box.x)}px`;
  lockbox.style.top=`${Math.round(box.y)}px`;
  lockbox.style.width=`${Math.max(2,Math.round(box.width))}px`;
  lockbox.style.height=`${Math.max(2,Math.round(box.height))}px`;
  lockbox.dataset.open='true';

  // 定位用的锚点矩形先夹到可见范围内
  const top=Math.max(pad,Math.min(box.y,vh-pad));
  const bottom=Math.max(pad,Math.min(box.y+box.height,vh-pad));
  const cw=composer.offsetWidth,ch=composer.offsetHeight;

  let y=bottom+gap;
  if(y+ch>vh-pad){
    const above=top-gap-ch;
    y=above>=pad?above:Math.max(pad,vh-pad-ch);
  }
  let x=box.x;
  x=Math.min(x,vw-pad-cw);
  x=Math.max(pad,x);
  composer.style.left=`${Math.round(x)}px`;
  composer.style.top=`${Math.round(y)}px`;
};
const closeComposer=()=>{
  composer.dataset.open='false';
  lockbox.dataset.open='false';
  pendingAnchor=null;
  pendingTarget=null;
  composerText.value='';
};
/* 页面滚动/窗口变形/影片重排都会让元素跑位，浮层得跟着走，不能停在原地指着空气。 */
addEventListener('scroll',placeComposer,{passive:true});
addEventListener('resize',placeComposer);
composerCancel.onclick=closeComposer;
composerSave.onclick=async()=>{
  if(!pendingAnchor||!commentsApi)return;
  const text=composerText.value.trim();
  if(!text){composerHint.textContent='写点内容再保存';return}
  composerSave.disabled=true;
  composerHint.textContent='保存中…';
  try{
    const res=await fetch(commentsApi,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({anchor:pendingAnchor,comment:text}),
    });
    if(!res.ok)throw new Error(`${res.status} ${res.statusText}`);
    closeComposer();
    await loadComments();
  }catch(e){
    composerHint.textContent=`保存失败：${e?.message||e}`;
  }finally{
    composerSave.disabled=false;
  }
};

/** 回放定位：先把时间设回锚点那一秒，等渲染完成再按 frame_path + selector 找元素。
    找不到就明说找不到——不做模糊重锚，那只会把评论贴到别的东西上。 */
const revealComment=async comment=>{
  const anchor=comment.anchor||{};
  pause();
  try{await setTime(anchor.time_sec||0);}catch(error){setStatusText(`无法定位到评论时间：${error?.message||error}`,'err');return;}
  stage.scrollIntoView({block:stage.getBoundingClientRect().height>innerHeight?'start':'center',behavior:'instant'});
  await new Promise(resolve=>requestAnimationFrame(resolve));
  let doc=null;
  try{ doc=film.contentDocument; }catch{ doc=null; }
  const frames=[film];
  for(const frameSelector of anchor.frame_path||[]){
    const frame=doc?.querySelector(frameSelector);
    try{ doc=frame?.contentDocument||null; }catch{ doc=null; }
    if(!doc)break;
    frames.push(frame);
  }
  let target=null;
  try{ target=doc?.querySelector(anchor.selector); }catch{ target=null; }
  if(!target){
    setStatusText('这一刻没有找到评论标记的画面区域','err');
    return;
  }
  ensurePickStyle(doc);
  doc.querySelectorAll('[data-omni-pick-flash]').forEach(el=>el.removeAttribute('data-omni-pick-flash'));
  target.setAttribute('data-omni-pick-flash','true');
  await new Promise(resolve=>requestAnimationFrame(resolve));
  const box=screenRectOf(target,frames);
  lockbox.style.left=`${Math.round(box.x)}px`;lockbox.style.top=`${Math.round(box.y)}px`;
  lockbox.style.width=`${Math.max(2,Math.round(box.width))}px`;lockbox.style.height=`${Math.max(2,Math.round(box.height))}px`;
  lockbox.dataset.highlight='true';lockbox.dataset.open='true';
  clearTimeout(highlightTimer);highlightTimer=setTimeout(()=>{target.removeAttribute('data-omni-pick-flash');lockbox.dataset.open='false';delete lockbox.dataset.highlight;},2400);
  setStatusText(`已跳到 ${fmt(anchor.time_sec)} 并标出评论区域`,'ready');
};

const renderMarks=()=>{
  const duration=Number(seek.max)||0;
  marks.textContent='';
  if(duration<=0)return;
  for(const comment of comments){
    const at=Number(comment.anchor?.time_sec||0);
    const tick=document.createElement('i');
    tick.style.left=`${Math.min(100,Math.max(0,at/duration*100))}%`;
    if(comment.resolved)tick.className='done';
    tick.title=`${fmt(at)} · ${comment.comment.slice(0,60)}`;
    marks.appendChild(tick);
  }
};
const renderComments=()=>{
  const visible=comments.filter(c=>showResolved.checked||!c.resolved);
  const open=comments.filter(c=>!c.resolved).length;
  commentsCount.textContent=`评论 ${comments.length}${comments.length?` · 待处理 ${open}`:''}`;
  clist.textContent='';
  cempty.hidden=visible.length>0;
  /* 空态要说清是哪种空：一边写着「评论 1」一边说「还没有评论」是自相矛盾的
     （截图里就出现过），被过滤掉和真的没有是两件事。 */
  cempty.textContent=comments.length===0
    ? '还没有评论。暂停在某一秒，圈选画面里的元素即可写下第一条。'
    : `${comments.length} 条都已处理，勾上「显示已处理」可以看。`;
  for(const comment of visible){
    const anchor=comment.anchor||{};
    const item=document.createElement('div');
    item.className='citem';
    item.dataset.resolved=String(!!comment.resolved);
    item.dataset.commentId=comment.id;

    const at=document.createElement('a');
    at.className='at';
    at.textContent=fmt(anchor.time_sec);
    at.title='跳到这一刻并标出评论区域';
    at.href=reviewCommentHref(location.href,anchor.time_sec,comment.id);
    at.onclick=event=>{event.preventDefault();void revealComment(comment);};

    const body=document.createElement('div');
    body.className='body';
    const txt=document.createElement('div');
    txt.className='txt';
    txt.textContent=comment.comment;
    const meta=document.createElement('div');
    meta.className='meta';
    meta.textContent=anchor.text_excerpt?anchor.text_excerpt.slice(0,72):'画面区域';
    meta.title='';
    body.append(txt,meta);

    const ops=document.createElement('div');
    ops.className='ops';
    const resolve=document.createElement('button');
    resolve.type='button';
    resolve.textContent=comment.resolved?'重开':'处理掉';
    resolve.onclick=()=>void patchComment(comment.id,{resolved:!comment.resolved});
    const remove=document.createElement('button');
    remove.type='button';
    remove.textContent='删除';
    remove.onclick=()=>void deleteComment(comment.id);
    ops.append(resolve,remove);

    item.append(at,body,ops);
    clist.appendChild(item);
  }
  renderMarks();
};
showResolved.onchange=renderComments;

const loadComments=async()=>{
  if(!commentsApi)return null;
  try{
    const res=await fetch(commentsApi);
    if(!res.ok)throw new Error(`${res.status} ${res.statusText}`);
    const data=await res.json();
    comments=Array.isArray(data.items)?data.items:[];
    renderComments();
    return comments;
  }catch(e){
    setStatusText(`评论读取失败：${e?.message||e}`,'err');
    return null;
  }
};
const patchComment=async(id,patch)=>{
  try{
    const res=await fetch(`${commentsApi}/${encodeURIComponent(id)}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(patch),
    });
    if(!res.ok)throw new Error(`${res.status} ${res.statusText}`);
    await loadComments();
  }catch(e){ setStatusText(`更新失败：${e?.message||e}`,'err'); }
};
const deleteComment=async id=>{
  try{
    const res=await fetch(`${commentsApi}/${encodeURIComponent(id)}`,{method:'DELETE'});
    if(!res.ok)throw new Error(`${res.status} ${res.statusText}`);
    await loadComments();
  }catch(e){ setStatusText(`删除失败：${e?.message||e}`,'err'); }
};

/* status 只在有话可说时说话：圈选态 / 定位结果 / 错误。
   连接成功不再刷一行"已连接"——那是在把没有信息的字占着位置。 */
let statusHold=0;let highlightTimer=0;
const setStatusText=(text,cls)=>{
  status.className=`status${cls?` ${cls}`:''}`;
  status.textContent=text;
  statusHold=cls==='picking'?Infinity:Date.now()+4000;
};

if(commentsApi){
  pickBtn.hidden=false;
  commentsBox.hidden=false;
  void loadComments();
}

setInterval(()=>{
  try{window.__SP_REPLAY_DONE__=!!film.contentWindow?.__SP_REPLAY_DONE__;}catch{/* iframe not ready */}
  const state=readState();
  if(!state)return;
  if(state.error){setStatusText(state.error,'err');toggle.disabled=true;pickBtn.disabled=true;return;}
  if(state.duration>0&&String(seek.max)!==String(state.duration)){
    seek.max=String(state.duration);
    renderMarks();
  }
  if(!initialSeekApplied&&state.ready){
    initialSeekApplied=true;
    const commentId=new URLSearchParams(location.search).get('comment');
    if(commentId){
      void loadComments().then(items=>{
        const comment=items?.find(item=>item.id===commentId);
        if(comment)return revealComment(comment);
        setStatusText('找不到这条评论','err');
      });
    }else if(requestedTime)void setTime(requestedTime).catch(error=>setStatusText(`定位失败：${error?.message||error}`,'err'));
  }
  if(document.activeElement!==seek)seek.value=String(state.time);
  if(state.viewport?.width>0&&state.viewport?.height>0){stage.style.aspectRatio=`${state.viewport.width} / ${state.viewport.height}`;}
  if(state.duration>0&&state.time>=state.duration-.03)requestedPlaying=false;
  clock.textContent=`${fmt(state.time)} / ${fmt(state.duration)}`;
  toggle.disabled=!state.ready;
  pickBtn.disabled=!state.ready;
  toggle.textContent=state.paused?'播放':'暂停';
  const fullUrl=new URL('assault-review.html',location.href);fullUrl.searchParams.set('recording',recordingId);fullUrl.searchParams.set('t',String(Number(state.time.toFixed(2))));sourceLink.href=fullUrl.href;
  if(Date.now()>statusHold&&!picking){
    status.className='status';
    status.textContent=state.ready?'':'正在准备回放…';
  }
},80);
  
