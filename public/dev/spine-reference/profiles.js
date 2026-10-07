const bone = (name, local = [0, 0], status = 'joint-candidate') => ({kind:'bone-local', bone:name, local, status});
const blend = (ids, weights) => ({kind:'blend', ids, weights, status:'virtual-reference'});

export const landmarks = {
  pelvis:'骨盆参考', waist:'腰', chest:'胸部参考', neck:'颈根', 'head.center':'头部中心',
  ...Object.fromEntries(['L','R'].flatMap(s=>[
    [`arm.${s}.shoulder`,`肩 ${s}链`],[`arm.${s}.elbow`,`肘 ${s}链`],[`arm.${s}.wrist`,`腕 ${s}链`],
    [`arm.${s}.palm`,`掌心 ${s}链`],[`leg.${s}.hip`,`髋 ${s}链`],[`leg.${s}.knee`,`膝 ${s}链`],
    [`leg.${s}.ankle`,`踝 ${s}链`],[`leg.${s}.sole`,`脚底参考 ${s}链`],
  ])),
  'weapon.grip':'武器握持点','weapon.tip':'武器尖端',
};
export const connections = [
  ['pelvis','waist'],['waist','chest'],['chest','neck'],['neck','head.center'],
  ...['L','R'].flatMap(s=>[['chest',`arm.${s}.shoulder`],[`arm.${s}.shoulder`,`arm.${s}.elbow`],[`arm.${s}.elbow`,`arm.${s}.wrist`],['pelvis',`leg.${s}.hip`],[`leg.${s}.hip`,`leg.${s}.knee`],[`leg.${s}.knee`,`leg.${s}.ankle`],[`leg.${s}.ankle`,`leg.${s}.sole`]]),
  ['weapon.grip','weapon.tip'],
];
function body(bindings) {
  return {pelvis:blend(['leg.L.hip','leg.R.hip'],[.5,.5]),chest:blend(['waist','neck'],[.45,.55]),...bindings};
}
function surtr(id,prefix,view) {
  const p = prefix, bindings = body({waist:bone(`${p}_Waist`),neck:bone(`${p}_Head`), 'head.center':bone(`${p}_Head`,[0,55],'offset-candidate')});
  for(const s of ['L','R']) {
    bindings[`arm.${s}.shoulder`]=bone(`${p}_${s}_Arm${s==='R'?'_b':''}`);
    bindings[`arm.${s}.elbow`]=bone(`${p}_${s}_${s==='L'?'Forearm':'Arm'}`);
    bindings[`arm.${s}.wrist`]=s==='L'?bone(`${p}_L_Hand`):{
      kind:'active-slot', candidates:[{slot:`${p}_R_Hand`,bone:`${p}_R_Hand_A_b`},{slot:`${p}_R_Hand_A_b`,bone:`${p}_R_Hand_A_b`},{slot:`${p}_R_Hand_C_b`,bone:`${p}_R_Hand_C_b`}],status:'joint-candidate'};
    bindings[`leg.${s}.hip`]=bone(`${p}_${s}_Leg`);
    bindings[`leg.${s}.knee`]=bone(`${p}_${s}_Calf`);
    bindings[`leg.${s}.ankle`]=bone(`${p}_${s}_Foot`);
    bindings[`leg.${s}.sole`]=bone(`${p}_${s}_Foot`,[25,8],'offset-candidate');
  }
  bindings['weapon.grip']=bone(`${p}_Weapon2`);
  // The native weapon bone length stops inside the blade. Texture-local tip
  // calibration is deliberately unresolved until its point is checked.
  return {id,title:`史尔特尔 · ${view==='front'?'正面':'背面'}`,view,url:`/assets/spine/op/char_350_surtr/${view}/char_350_surtr.skel`,prefix:p,normalizer:350,bindings,weaponSide:'L',notes:'常态形态；变身形态尚未标定。手腕按当前可见手部附件选择。'};
}
export const profiles = {
  '2b-front':{id:'2b-front',title:'2B · 正面',view:'front',url:'/dev/diy-2b/model/front/char_diy_2b.json',normalizer:350,weaponSide:'R',notes:'保留现有动画；关节原点与视觉解剖位置仍需逐帧核验。',bindings:body({
    waist:bone('hip'),neck:bone('head'),'head.center':bone('head',[5,52],'offset-candidate'),
    ...Object.fromEntries(['L','R'].flatMap(s=>{
      const n=s.toLowerCase();return [
        [`arm.${s}.shoulder`,bone(`upperarm_${n}`)],[`arm.${s}.elbow`,bone(`forearm_${n}`)],[`arm.${s}.wrist`,bone(`hand_${n}`)],
        [`leg.${s}.hip`,bone(`thigh_${n}`)],[`leg.${s}.knee`,bone(`shin_${n}`)],[`leg.${s}.ankle`,bone(`foot_${n}`)],
        [`leg.${s}.sole`,bone(`foot_${n}`,[8,-33],'offset-candidate')],
      ];})),
    'weapon.grip':bone('sword'),'weapon.tip':bone('sword_tip',[0,0],'offset-candidate'),
  })},
  'surtr-front':surtr('surtr-front','F','front'),
  'surtr-back':surtr('surtr-back','B','back'),
};

// These rules are per-asset bindings, not a general-purpose name recognizer.
export function partFor(profile,slot) {
  const name=slot.id;
  if(profile.id==='2b-front') {
    if(/^(face|hair_)/.test(name))return 'head';
    if(name==='sword')return 'weapon';
    if(name==='pod')return 'accessory';
    const limb=name.match(/^(upperarm|forearm|hand|thigh|shin|foot)_([lr])$/);
    if(limb)return `${/upperarm|forearm|hand/.test(limb[1])?'arm':'leg'}.${limb[2].toUpperCase()}`;
    if(/torso|skirt/.test(name))return 'torso';
  } else {
    const p=profile.prefix;
    if(!name.startsWith(p+'_')||name.startsWith(p+'_Rb_'))return 'unmapped';
    if(new RegExp(`^${p}_(Head|Face|Hair|[LR]_Ear)`).test(name))return 'head';
    if(new RegExp(`^${p}_Weapon`).test(name))return 'weapon';
    const limb=name.match(new RegExp(`^${p}_([LR])_(Arm|Forearm|Hand|Leg|Calf|Foot)`));
    if(limb)return `${/Arm|Forearm|Hand/.test(limb[2])?'arm':'leg'}.${limb[1]}`;
    if(new RegExp(`^${p}_(Chest|Waist|Hip|Coat)`).test(name))return 'torso';
    if(name.startsWith(p+'_Annex'))return 'accessory';
  }
  return 'unmapped';
}
export function subpartFor(profile,slot) {
  if(partFor(profile,slot)==='unmapped')return null;
  const n=slot.id;
  if(/hand/i.test(n))return 'hand';
  if(/forearm/i.test(n))return 'forearm';
  if(/upperarm|_[LR]_Arm/i.test(n))return 'upperarm';
  if(/foot/i.test(n))return 'foot';
  if(/shin|calf/i.test(n))return 'calf';
  if(/thigh|_[LR]_Leg/i.test(n))return 'thigh';
  return null;
}
