import {landmarks,connections,partFor,subpartFor} from './profiles.js';
export const schemaVersion='spine-reference/0.1';
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
export function observe(raw,profile,{animation=null,time=0}={}) {
  const bones=new Map(raw.bones.map(b=>[b.id,b]));
  const slots=new Map(raw.slots.map(s=>[s.id,s]));
  const points={}, visiting=new Set();
  // A form switch cannot silently keep emitting the hidden normal-form body.
  const transformed=raw.slots.some(s=>s.alpha>.01&&s.attachment&&s.id.startsWith(`${profile.prefix}_Rb_`));
  const resolve=id=>{
    if(points[id])return points[id];
    let binding=profile.bindings[id], position=null,reason=null, resolvedBinding=binding;
    if(transformed)reason='当前变身形态未标定';
    else if(!binding)reason='尚未标定该语义点';
    else if(visiting.has(id))reason='绑定循环';
    else {
      visiting.add(id);
      if(binding.kind==='active-slot') {
        const active=binding.candidates.filter(c=>slots.get(c.slot)?.alpha>.01&&slots.get(c.slot)?.attachment);
        if(active.length===1)resolvedBinding={...binding,kind:'bone-local',bone:active[0].bone,local:[0,0],selectedSlot:active[0].slot};
        else reason=active.length?'多套手部同时可见，支点有歧义':'当前手部附件未匹配';
      }
      if(!reason&&resolvedBinding.kind==='bone-local') {
        const b=bones.get(resolvedBinding.bone), local=resolvedBinding.local;
        if(!b||!local)reason='绑定骨或局部坐标缺失';
        else {const [a,bm,c,d,x,y]=b.matrix;position=[a*local[0]+c*local[1]+x,bm*local[0]+d*local[1]+y];}
      } else if(!reason&&binding.kind==='blend') {
        const refs=binding.ids.map(resolve);
        if(refs.every(r=>validPoint(r.position)))position=[0,1].map(axis=>refs.reduce((v,r,i)=>v+r.position[axis]*binding.weights[i],0));
        else reason='所依赖的语义点未知';
      }
      visiting.delete(id);
    }
    if(position&&!validPoint(position)){position=null;reason='非有限坐标';}
    return points[id]={id,label:landmarks[id],anatomicalType:id.split('.').at(-1),position,normalized:null,status:position?(resolvedBinding?.status||'candidate'):'unknown',reason,provenance:resolvedBinding||null,visibility:'unknown',anatomicalSide:null,sourceSide:id.match(/\.(L|R)\./)?.[1]||null};
  };
  Object.keys(landmarks).forEach(resolve);
  const origin=points.pelvis.position;
  for(const p of Object.values(points))if(p.position&&origin)p.normalized=p.position.map((v,i)=>(v-origin[i])/profile.normalizer);
  const parts=raw.slots.map(s=>({id:s.id,semanticPart:partFor(profile,s),subpart:subpartFor(profile,s),sourceBone:s.bone,attachment:s.attachment?.name||null,rendered:Boolean(s.alpha>.01&&s.attachment?.points?.length),alpha:s.alpha,drawOrder:s.drawOrder,geometry:s.attachment?.points||[],weighted:s.attachment?.weighted||false,status:partFor(profile,s)==='unmapped'?'unknown':'asset-specific-binding'}));
  const grip=points['weapon.grip'].position,tip=points['weapon.tip'].position;
  return {schemaVersion,source:profile.id,view:profile.view,animation,time,form:transformed?'unsupported-transformed':'normal',coordinateSystem:{...raw.coordinateSystem,normalizedOrigin:'pelvis',fixedScale:profile.normalizer,normalization:'fixed reference height; not a per-frame bounding box'},sideConvention:{basis:'stable source L/R identifiers',anatomicalLaterality:'unverified',screenXSorting:false},landmarks:points,connections,parts,contacts:{'leg.L.sole':{state:'unknown',reason:'没有接触标注，位置不能证明踩实'},'leg.R.sole':{state:'unknown',reason:'没有接触标注，位置不能证明踩实'}},orientation:{weaponAxis:grip&&tip?Math.atan2(tip[1]-grip[1],tip[0]-grip[0]):null,palmFacing:'unknown',bladeEdgeFacing:'unknown'},occlusion:{renderOrderAvailable:true,pointVisibility:'unknown; draw order alone does not prove coverage'},unmappedVisibleParts:parts.filter(p=>p.rendered&&p.semanticPart==='unmapped').map(p=>p.id)};
}
export function queryPose(pose,id) {
  if(!Object.hasOwn(pose.landmarks,id))throw Error(`Unknown semantic landmark: ${id}`);
  return {...pose.landmarks[id],source:pose.source,time:pose.time,contacts:pose.contacts[id]||null};
}
export function motionBetween(before,after,id) {
  const a=queryPose(before,id),b=queryPose(after,id),dt=after.time-before.time;
  return {id,from:before.time,to:after.time,displacement:a.position&&b.position?b.position.map((v,i)=>v-a.position[i]):null,velocity:a.position&&b.position&&dt>0?b.position.map((v,i)=>(v-a.position[i])/dt):null,contact:after.contacts[id]?.state||'unknown',orientationIsIndependent:true};
}
