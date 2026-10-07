const $=id=>document.getElementById(id), q=new URLSearchParams(location.search);
const clips={Attack:'普攻',Skill_1:'三连斩',Stun_Skill_3:'机体重组',Skill_3_End:'自爆到跪地'};
const groups={all:'全身',legs:'腿脚',arms:'手臂',blade:'剑',body:'躯干'};
const partSlots={legs:['thigh_r','shin_r','foot_r','thigh_l','shin_l','foot_l'],arms:['upperarm_r','forearm_r','hand_r','upperarm_l','forearm_l','hand_l'],blade:['sword','hand_r'],body:['torso','skirt','face','hair_a','hair_b']};
let clip=q.get('action') in clips?q.get('action'):'Attack',part=q.get('part') in groups?q.get('part'):'all',side=q.get('side')==='back'?'back':'front',playing=true,t=0,lastT=0,sp,app,trace=[];
let error=[];
function controls(){
  $('controls').replaceChildren();
  for(const [key,label] of Object.entries(clips))link(label,'action',key,clip===key);
  for(const [key,label] of Object.entries(groups))link(label,'part',key,part===key);
  for(const [key,label] of [['front','正面'],['back','背面']])link(label,'side',key,side===key);
}
function link(label,key,value,on){const a=document.createElement('a');a.textContent=label;a.className='control'+(on?' on':'');const u=new URL(location.href);u.searchParams.set(key,value);a.href=u;a.onclick=async e=>{e.preventDefault();history.replaceState(null,'',u);if(key==='part')part=value;else if(key==='action'){clip=value;t=0;trace=[];sp.state.setAnimation(0,clip,false)}else{side=value;await load()}controls()};$('controls').append(a)}
const floor=new PIXI.Graphics(),paths=new PIXI.Graphics();
function resize(){const el=$('scene');app.renderer.resize(el.clientWidth,el.clientHeight);if(sp){const top=$('controls').offsetHeight+12,room=el.clientHeight-top,z=Math.min(room/560,el.clientWidth/690);sp.scale.set(z);sp.position.set(el.clientWidth*.45,top+room*.92);floor.clear().lineStyle(1,0x71818d,.6).moveTo(0,sp.y).lineTo(el.clientWidth,sp.y)}}
async function load(){const name=side==='back'?'char_diy_2b_back':'char_diy_2b',data=await PIXI.Assets.load(`model/${side}/${name}.json`);if(sp){app.stage.removeChild(sp);sp.destroy({children:true})}sp=new PIXI.spine.Spine(data.spineData);sp.autoUpdate=false;app.stage.addChildAt(sp,1);sp.state.setAnimation(0,clip,false);const requested=new URL(location.href).searchParams.get('t');t=requested===null?0:Math.max(0,Math.min(+requested||0,sp.spineData.findAnimation(clip).duration));if(requested!==null)pause(true);lastT=0;trace=[];resize()}
function pose(){const duration=sp.spineData.findAnimation(clip).duration;sp.skeleton.setToSetupPose();sp.state.getCurrent(0).trackTime=Math.min(t,duration);sp.update(0);sp.skeleton.slots.forEach((s,i)=>sp.slotContainers[i].visible=part==='all'||partSlots[part].includes(s.data.name));
  paths.clear();const bone=n=>sp.skeleton.findBone(n), point=b=>[sp.x+b.matrix.tx*sp.scale.x,sp.y+b.matrix.ty*sp.scale.y];
  if(t<lastT)trace=[];if(t!==lastT){const b=bone('sword_tip');trace.push(point(b));if(trace.length>45)trace.shift()}lastT=t;
  if($('trail').checked&&(part==='all'||part==='blade')){paths.lineStyle(2,0x96dacb,.85);trace.forEach((p,i)=>i?paths.lineTo(...p):paths.moveTo(...p))}
  if($('bones').checked)for(const b of sp.skeleton.bones){if(!b.parent||b.data.name.startsWith('pod'))continue;const leg=/thigh|shin|foot/.test(b.data.name),arm=/arm|hand|sword/.test(b.data.name);if(part==='legs'&&!leg||part==='arms'&&!arm||part==='blade'&&!/sword/.test(b.data.name))continue;const a=point(b.parent),c=point(b);paths.lineStyle(1,0x76c3ee,.8).moveTo(...a).lineTo(...c).beginFill(0xffcf74).drawCircle(...c,3).endFill()}
  $('progress').value=t/duration;$('time').textContent=`${t.toFixed(2)} / ${duration.toFixed(2)}`;const frame=new URL(location.href);frame.searchParams.set('t',t.toFixed(4));frame.searchParams.set('part',part);frame.searchParams.set('action',clip);frame.searchParams.set('side',side);$('frameLink').href=frame;
}
function pause(v){playing=!v;$('pause').textContent=v?'播放':'暂停'}
$('pause').onclick=()=>pause(playing);$('step').onclick=()=>{pause(true);t=Math.min(sp.spineData.findAnimation(clip).duration,t+1/60);pose()};$('progress').oninput=()=>{pause(true);trace=[];t=+$('progress').value*sp.spineData.findAnimation(clip).duration;pose()};
try{app=new PIXI.Application({backgroundColor:0x20272d,antialias:true,resolution:devicePixelRatio,autoDensity:true});$('scene').append(app.view);app.stage.addChild(floor);app.stage.addChild(paths);await load();app.stage.setChildIndex(paths,app.stage.children.length-1);controls();resize();window.addEventListener('resize',resize);app.ticker.add(()=>{if(playing)t=(t+app.ticker.deltaMS/1000*+$('speed').value)%sp.spineData.findAnimation(clip).duration;pose()});window.__motion={ready:true,pose:(time)=>{pause(true);t=time;trace=[];pose()},part:(p)=>{part=p;controls();pose()},sp:()=>sp,errors:error};}catch(e){error.push(e.message);$('error').textContent=e.message;throw e}
