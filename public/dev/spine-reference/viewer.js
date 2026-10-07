import {loadRig,poseRig,readRig} from './runtime.js';
import {profiles,landmarks,connections} from './profiles.js';
import {observe,queryPose,motionBetween} from './semantic.js';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
let profile,sp,pose,selected=params.get('point')||'leg.L.knee',part=params.get('part')||'all',playing=false,last=0;
const cache=new Map(),views=new Map(), app=new PIXI.Application({width:600,height:680,backgroundAlpha:0,antialias:true,preserveDrawingBuffer:true});
$('zoom').value=params.get('zoom')||1;
$('sourceStage').append(app.view);
const partLabels={all:'整体',head:'头部',torso:'躯干','arm.L':'手臂 L链','arm.R':'手臂 R链','leg.L':'腿 L链','leg.R':'腿 R链',weapon:'武器',accessory:'饰物',unmapped:'未映射'};
const statusLabels={'joint-candidate':'候选关节（控制骨原点）','offset-candidate':'校准候选（骨局部偏移）','virtual-reference':'虚拟参考点',unknown:'未知'};
for(const p of Object.values(profiles))$('source').add(new Option(p.title,p.id));
for(const [id,label]of Object.entries(partLabels)){const b=document.createElement('button');b.textContent=label;b.dataset.part=id;b.onclick=()=>{part=id;render();syncURL();};$('parts').append(b);}
for(const [id,label]of Object.entries(landmarks)){const a=document.createElement('a');a.textContent=label;a.dataset.point=id;a.href=makeURL({point:id});a.onclick=e=>{e.preventDefault();selectPoint(id);};$('points').append(a);}
function makeURL(overrides={}) {const url=new URL(location.href);const values={source:profile?.id||$('source').value,animation:$('animation').value||'Idle',t:Number($('time').value||.15).toFixed(3),point:selected,part,zoom:$('zoom').value,...overrides};for(const [k,v]of Object.entries(values))url.searchParams.set(k,v);return url.href;}
function syncURL(){history.replaceState(null,'',makeURL());$('fullscreen').href=makeURL();for(const a of $('points').children)a.href=makeURL({point:a.dataset.point});}
async function copyURL(overrides,button){const value=makeURL(overrides);try{await navigator.clipboard.writeText(value);button.textContent='已复制';setTimeout(()=>button.textContent=button.dataset.label,1300);}catch{const input=document.createElement('textarea');input.value=value;document.body.append(input);input.select();document.execCommand('copy');input.remove();}}
for(const [button,changes]of [['frameLink',{}],['pointLink',{point:selected}],['partLink',{part}]]){$(button).dataset.label=$(button).textContent;$(button).onclick=()=>copyURL(button==='pointLink'?{point:selected}:button==='partLink'?{part}: {},$(button));}
function selectPoint(id){if(!landmarks[id])return;selected=id;render();syncURL();}
function sample(animation,time){poseRig(sp,animation,time);return observe(readRig(sp),profile,{animation,time});}
async function loadSource(id,animation,time){playing=false;$('play').textContent='播放';profile=profiles[id];if(!profile)throw Error('没有该素材');if(!cache.has(id))cache.set(id,await loadRig(profile.url));sp=cache.get(id);app.stage.removeChildren();sp.scale.set(1);sp.position.set(270,410);app.stage.addChild(sp);$('source').value=id;$('animation').replaceChildren();for(const a of sp.spineData.animations)$('animation').add(new Option(a.name,a.name));$('animation').value=sp.spineData.findAnimation(animation)?animation:'Idle';setDuration();$('time').value=Math.min(time,Number($('time').max));render();syncURL();}
function setDuration(){$('time').max=sp.spineData.findAnimation($('animation').value)?.duration||.001;}
function applyView(){const animation=$('animation').value,key=profile.id+':'+animation;
  if(!views.has(key)){const duration=sp.spineData.findAnimation(animation)?.duration||0,points=[];
    for(let i=0;i<25;i++)for(const p of sample(animation,duration*i/24).parts)if(p.rendered)points.push(...p.geometry);
    if(!points.length)points.push([-200,0],[200,360]);
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    views.set(key,{x:(minX+maxX)/2,y:(minY+maxY)/2,scale:Math.min(560/Math.max(1,maxX-minX),640/Math.max(1,maxY-minY))});}
  const v=views.get(key),s=v.scale*Number($('zoom').value),viewBox=`${v.x-300/s} ${-v.y-340/s} ${600/s} ${680/s}`;
  sp.scale.set(s);sp.position.set(300-v.x*s,340+v.y*s);for(const id of ['skeleton','sourceOverlay'])$(id).setAttribute('viewBox',viewBox);
}
function pointGroup(p){if(p.id.startsWith('arm.'))return p.id.split('.').slice(0,2).join('.');if(p.id.startsWith('leg.'))return p.id.split('.').slice(0,2).join('.');if(p.id.startsWith('weapon.'))return 'weapon';return p.id==='head.center'||p.id==='neck'?'head':'torso';}
function render(){if(!sp)return;applyView();const t=Number($('time').value);pose=sample($('animation').value,t);
  for(let i=0;i<sp.skeleton.slots.length;i++){const record=pose.parts[i];if(sp.slotContainers[i])sp.slotContainers[i].visible=record.rendered&&(part==='all'||record.semanticPart===part);}
  app.renderer.render(app.stage);
  $('clock').textContent=`${t.toFixed(3)} / ${Number($('time').max).toFixed(3)} 秒`;
  for(const b of $('parts').children)b.setAttribute('aria-pressed',String(b.dataset.part===part));
  for(const a of $('points').children){const p=pose.landmarks[a.dataset.point];a.className=(selected===p.id?'selected ':'')+(p.status==='unknown'?'unknown':'');}
  const trajectory=$('trail').checked?Array.from({length:16},(_,i)=>sample($('animation').value,Math.max(0,t-.8)+Math.min(t,.8)*i/15).landmarks[selected].position).filter(Boolean):[];
  poseRig(sp,$('animation').value,t);
  const svg=$('skeleton');svg.replaceChildren();$('sourceOverlay').replaceChildren();
  function node(tag,attrs,parent=svg){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;}
  node('line',{x1:-270,y1:0,x2:330,y2:0,stroke:'#d4dee7','stroke-dasharray':'5 5'});
  if(trajectory.length){const coords=trajectory.map(p=>`${p[0]},${-p[1]}`).join(' ');for(const parent of [svg,$('sourceOverlay')])node('polyline',{points:coords,fill:'none',stroke:'#d27716','stroke-width':2,'stroke-dasharray':'4 3'},parent);}
  for(const [a,b]of connections){const pa=pose.landmarks[a],pb=pose.landmarks[b];if(!pa.position||!pb.position)continue;const show=part==='all'||pointGroup(pa)===part||pointGroup(pb)===part;node('line',{x1:pa.position[0],y1:-pa.position[1],x2:pb.position[0],y2:-pb.position[1],stroke:show?'#599abc':'#ced7dd','stroke-width':a.startsWith('weapon')?3:2});}
  for(const p of Object.values(pose.landmarks)){if(!p.position)continue;const group=node('g',{class:'point',tabindex:0,role:'link','aria-label':p.label});group.addEventListener('click',()=>selectPoint(p.id));group.addEventListener('keydown',e=>{if(e.key==='Enter')selectPoint(p.id);});group.addEventListener('contextmenu',e=>{e.preventDefault();copyURL({point:p.id},$('pointLink'));});const [x,y]=p.position;node('circle',{cx:x,cy:-y,r:selected===p.id?7:4,stroke:selected===p.id?'#d27716':'#1b759f','stroke-width':2,fill:p.status==='offset-candidate'?'white':selected===p.id?'#f7c85c':'#65bad7'},group);if(selected===p.id){const label=node('text',{x:x+11,y:-y-10,fill:'#1e526b','font-size':14},group);label.textContent=p.label;}}
  const p=pose.landmarks[selected], previous=sample($('animation').value,Math.max(0,t-.1));poseRig(sp,$('animation').value,t);const motion=motionBetween(previous,pose,selected);const displacement=motion.displacement?.map(v=>v.toFixed(2)).join(', ')||'未知';
  if(p.position){const[x,y]=p.position;node('circle',{cx:x,cy:-y,r:8,stroke:'#9a4b00','stroke-width':2,fill:'#ffd46a','fill-opacity':.75},$('sourceOverlay'));const label=node('text',{x:x+12,y:-y-9,fill:'#9a4b00','font-size':14,'paint-order':'stroke',stroke:'white','stroke-width':3},$('sourceOverlay'));label.textContent=p.label;}
  $('selectedTitle').textContent=p.label;$('detail').textContent=`${statusLabels[p.status]}\n位置：${p.position?.map(v=>v.toFixed(2)).join(', ')||'未知'}\n前 0.1 秒位移：${displacement}\n人体左右：未核验\n${p.reason||'绘制层级已记录；该点是否被遮挡仍未知。'}`;
  $('raw').textContent=JSON.stringify({point:queryPose(pose,selected),motion,matchedParts:pose.parts.filter(v=>v.semanticPart===pointGroup(p)),orientation:pose.orientation,contacts:pose.contacts,sideConvention:pose.sideConvention},null,2);
  $('formNote').textContent=pose.form==='normal'?profile.notes:'当前为变身形态：人体参考点全部保留未知，避免读到隐藏的常态骨架。';
  // Restore isolation after the prior-frame read; poseRig restores native slots.
  for(let i=0;i<pose.parts.length;i++)if(sp.slotContainers[i])sp.slotContainers[i].visible=pose.parts[i].rendered&&(part==='all'||pose.parts[i].semanticPart===part);
  app.renderer.render(app.stage);
  window.currentPose=pose;
}
function exportClip(animation=$('animation').value,samples=25){if(!Number.isInteger(samples)||samples<2||samples>300)throw Error('采样数须在 2 到 300');const duration=sp.spineData.findAnimation(animation)?.duration;if(duration===undefined)throw Error('动作不存在');const frames=Array.from({length:samples},(_,i)=>sample(animation,duration*i/(samples-1)));render();return {schemaVersion:pose.schemaVersion,source:profile.id,animation,duration,samples,frames};}
function download(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>download(pose,`${profile.id}-pose.json`);$('clipExport').onclick=()=>download(exportClip(),`${profile.id}-${$('animation').value}-semantic.json`);
$('source').onchange=()=>loadSource($('source').value,$('animation').value,Number($('time').value)).catch(showError);
$('animation').onchange=()=>{setDuration();$('time').value=0;render();syncURL();};$('time').oninput=()=>{render();syncURL();};$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'暂停':'播放';last=performance.now();};
$('trail').onchange=render;
$('zoom').oninput=()=>{render();syncURL();};
function tick(now){if(playing&&sp){$('time').value=(Number($('time').value)+(now-last)/1000)%Number($('time').max);render();}last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
function showError(e){$('error').textContent=String(e.stack||e);window.__error=String(e.stack||e);}
window.reference={loadSource,exportClip,sample,query:id=>queryPose(pose,id),selectPoint,setPart:id=>{part=id;render();syncURL();},setTime:t=>{$('time').value=t;render();syncURL();},getRig:()=>sp,getProfile:()=>profile};
try{await loadSource(params.get('source')||'2b-front',params.get('animation')||'Idle',Number(params.get('t')||.15));window.__ready=true;}catch(e){showError(e);}
