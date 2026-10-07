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
function nativeFront(id,title,code,overrides={}) {
  const bindings=body({waist:bone(overrides.waist||'F_Waist'),neck:bone(overrides.neck||'F_Head'),'head.center':bone(overrides.neck||'F_Head',overrides.headLocal||[55,0],'offset-candidate')});
  for(const s of ['L','R']){
    bindings[`arm.${s}.shoulder`]=bone(`F_${s}_Arm`);
    bindings[`arm.${s}.elbow`]=bone(overrides[`elbow${s}`]||`F_${s}_Forearm`);
    bindings[`arm.${s}.wrist`]=bone(`F_${s}_Hand`);
    bindings[`leg.${s}.hip`]=bone(overrides[`hip${s}`]||`F_${s}_Leg`);
    bindings[`leg.${s}.knee`]=bone(overrides[`knee${s}`]||`F_${s}_Calf`);
    bindings[`leg.${s}.ankle`]=bone(`F_${s}_Foot`);
    // Sole landmarks require texture-local review per asset; leave unresolved.
  }
  if(overrides.bindings)Object.assign(bindings,overrides.bindings);
  return {id,title,view:'front',prefix:'F',url:`/assets/spine/op/char_${code}/front/char_${code}.skel`,normalizer:overrides.normalizer||350,weaponSide:'L',defaultAttack:'Attack',notes:'新增素材的关节原点是候选；脚底与武器尖端未校准，接触未知。',...overrides,bindings};
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
  'blkkgt-front':nativeFront('blkkgt-front','锏 · 正面','4116_blkkgt',{waist:'F_Wast_1',neck:'F_Face',headLocal:[57,0],hipL:'F_L_Thigh',hipR:'F_R_Thigh',kneeL:'F_L_Leg',kneeR:'F_R_Leg',bindings:{'weapon.grip':bone('F_L_Handweapon')}}),
  'mlynar-front':nativeFront('mlynar-front','玛恩纳 · 正面','4064_mlynar',{waist:'F_Hip2',neck:'F_Face',headLocal:[60,0],elbowL:'F_L_Forearm_C',hipR:'F_R_leg',defaultAttack:'Skill_1_Loop',weaponSides:['L','R'],bindings:{'arm.R.wrist':{kind:'active-slot',candidates:[{slot:'F_R_Hand',bone:'F_R_Hand'},{slot:'F_R_HandD',bone:'F_R_HandD'}],status:'joint-candidate'}},notes:'站姿含读报附件，没有原生 Attack；用 Skill_1_Loop 对照挥剑，两手参与。武器锚点尚未标定。'}),
  'skadi-front':nativeFront('skadi-front','斯卡蒂 · 正面','263_skadi',{headLocal:[60,0],bindings:{'weapon.grip':bone('F_L_Hand',[0,0],'joint-candidate')}}),
  'nearl2-front':nativeFront('nearl2-front','耀骑士临光 · 正面','1014_nearl2',{headLocal:[65,0],defaultAttack:'Attack_Loop',bindings:{'weapon.grip':bone('F_Weapon_T'),'weapon.tip':bone('F_Weapon_Top',[0,0],'offset-candidate')},notes:'剑尖控制点已与站姿图像核对为候选；脚底、掌面和接触仍未知。'}),
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
    if(profile.id==='blkkgt-front'&&/^C_Weapon/.test(name))return 'weapon';
    if(profile.id==='nearl2-front'&&/^Weapon_/.test(name))return 'weapon';
    // This artist-named "Hand" attachment is bound to the foot and depicts it.
    if(profile.id==='nearl2-front'&&name==='F_L_Hand_a')return 'leg.L';
    if(!name.startsWith(p+'_')||name.startsWith(p+'_Rb_'))return 'unmapped';
    if(new RegExp(`^${p}_(Head|Face|Hair|Back_Hair|Front_Hair|Front_Hat|Hat|Tophair|Bangs|BKH|DM|Mouth|[LR]_(Ear|Horn|Hair|Hiar|Bangs|Eye|White|Brow|ES|Frown|Lid|Wrinkle))`).test(name))return 'head';
    if(new RegExp(`^${p}_Weapon`).test(name))return 'weapon';
    const limb=name.match(new RegExp(`^${p}_([LR])_(Arm|Forearm|Hand|Palm|Finger|Sleeve|Leg|leg|Calf|Foot|Thigh|Knee)`));
    if(limb)return `${/Arm|Forearm|Hand|Palm|Finger|Sleeve/.test(limb[2])?'arm':'leg'}.${limb[1]}`;
    if(new RegExp(`^${p}_(Chest|Waist|Hip|Coat|Wast|Body|Belt|Shirt|Vest|Skirt|Neck|Collar|[LR]_(Coat|Shirt|Cloak|Cape|Collar|Cloth|Skirt|Shoulder))`).test(name))return 'torso';
    if(name.startsWith(p+'_Annex'))return 'accessory';
  }
  return 'unmapped';
}
export function subpartFor(profile,slot) {
  if(partFor(profile,slot)==='unmapped')return null;
  const n=slot.id;
  if(profile.id==='nearl2-front'&&n==='F_L_Hand_a')return 'foot';
  if(/hand|palm|finger/i.test(n))return 'hand';
  if(/forearm/i.test(n))return 'forearm';
  if(/upperarm|_[LR]_Arm/i.test(n))return 'upperarm';
  if(/foot/i.test(n))return 'foot';
  if(/shin|calf/.test(n.toLowerCase())||(profile.id==='blkkgt-front'&&/_[LR]_Leg$/.test(n)))return 'calf';
  if(/thigh|_[LR]_Leg/i.test(n))return 'thigh';
  return null;
}
