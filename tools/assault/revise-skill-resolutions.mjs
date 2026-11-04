// Reconcile authored 10-23 skill rules into the existing design sources.
import fs from 'node:fs';
import { SKILL_RESOLUTIONS } from '../../shared/assault/skill-resolutions.js';
import { LINKED_SKILLS } from '../../shared/assault/global-skill-pool.js';
import { NATIVE_SKILL_IDENTITIES } from './native-skill-identities.mjs';
import { growthAllowed,lifetimeText } from '../../shared/assault/growth-policy.js';
const characters=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json','utf8'));
const priorRuntime=JSON.parse(fs.readFileSync('data/assault-runtime.json','utf8'));
const normalized=value=>typeof value==='string'?lifetimeText(value):Array.isArray(value)?value.map(normalized):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalized(v)])):value;
const read=n=>JSON.parse(fs.readFileSync(`data/assault-design/${n}.json`,'utf8'));
function write(n,value){const file=`data/assault-design/${n}.json`;const text=fs.readFileSync(file,'utf8');const indent=/\n( +)"/.exec(text)?.[1].length??2;fs.writeFileSync(file,JSON.stringify(normalized(value),null,indent)+'\n');}
const copy=read('public-text');let count=0;
for(const family of ['assault','ranged','support']) {
  const cards=read(`bazaar-cards-${family}`),roster=read(`roster-${family}`);
  for(const card of cards.operators) {
    const identity=NATIVE_SKILL_IDENTITIES[card.id];
    if(identity) {
      const body=roster.operators.find(x=>x.charId===card.id);
      body.fixedSkill=structuredClone(identity.fixedSkill);
      let index=0;
      card.lines=card.lines.map(line=>line.kind==='skill'?structuredClone(identity.lines[index++]):line);
      if(identity.supportLine) {card.lines[2]=structuredClone(identity.supportLine);card.modules=structuredClone(identity.modules);}
    }
    if(card.id==='char_401_elysm') {card.lines[1].template=card.lines[1].template.replace('8 秒内逐渐获得','立即获得');roster.operators.find(x=>x.charId===card.id).fixedSkill.description=roster.operators.find(x=>x.charId===card.id).fixedSkill.description.replace('8秒内逐渐获得','立即获得').replace('8 秒内逐渐获得','立即获得');}
    if(card.id==='char_1045_svash2') {
      card.sp=[17,17,17,17];
      card.lines[1].template='御敌的锋锐：对原技能范围内至多6名敌人造成 {a}% 物理伤害，寒冷6秒并揭露隐匿。可储存2次。';
      card.lines[1].params.a=[200,300,350,380];
      card.lines[2].template='每次施放，你的其他谢拉格干员当前再部署时间 -{b} 秒；其他干员各自获得1次协击，最多各存2次，部署后1.1秒开始、每0.5秒释放1次，使用各自的攻击力、位置和朝向及御敌的锋锐原范围。';
      const body=roster.operators.find(x=>x.charId===card.id);body.fixedSkill.spCosts=card.sp;body.fixedSkill.description=card.lines[1].template+' '+card.lines[2].template;
      copy.operators[card.id].skill.description='御敌的锋锐：在原技能范围内打击至多6名敌人并寒冷、揭隐。每次施放为其他干员各自储存1次部署协击，最多2次，各自在部署位置沿朝向释放。';copy.operators[card.id].skill.summary=copy.operators[card.id].skill.description;
    }
    // The 10-24 design retires the synthetic recast payoff. Preserve the native
    // skill while the typed A–E adaptation replaces it; never append a payoff.
    const currentBody=roster.operators.find(x=>x.charId===card.id);
    currentBody.fixedSkill.description=currentBody.fixedSkill.description.split(' 重复施放结算：')[0];
    for(const line of card.lines)if(line.kind==='skill') {
      line.template=line.template.split(' 重复施放结算：')[0];
      if(line.overlap==='refresh-stance-and-independent-payoff')delete line.overlap;
    }
    copy.operators[card.id].skill.description=currentBody.fixedSkill.description;
    copy.operators[card.id].skill.summary=currentBody.fixedSkill.description;
    const resolution=SKILL_RESOLUTIONS[card.id];
    if(!resolution)continue;
    const body=roster.operators.find(x=>x.charId===card.id);
    if(!body)throw Error(`Missing authored body ${card.id}`);
    const description=`${body.fixedSkill.name}：${resolution.text}`;
    body.fixedSkill.description=description;
    body.fixedSkill.resolution='immediate-or-battle-growth-v1';
    body.fixedSkill.effects=[{trigger:body.fixedSkill.kind==='passive'?'部署或再部署':'自然技力满',target:'逐项选择',action:'resolvedSkill',values:resolution,
      lifecycle:'instant',description:resolution.text,stacking:'每次施放分别立即结算；本场成长累加；姿态不重复增加。'}];
    const skills=card.lines.filter(l=>l.kind==='skill');
    const params={...skills[0].params};let n=0;
    const template=description.replace(/([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)/g,(match,...values)=>{
      const key=`r${n++}`;params[key]=values.slice(0,4).map(Number);return `${match.startsWith('+')?'+':''}{${key}}`;
    });
    skills[0]={...skills[0],template,params,scope:'instant',effect:'resolvedSkill',overlap:'independent-payoff'};
    let skillIndex=0;
    card.lines=card.lines.map(line=>{
      if(line.kind!=='skill')return line;
      if(skillIndex++===0)return skills[0];
      return {...line,template:resolution.steps.some(s=>s.action==='damage')?'重复施放立即再次造成伤害。':resolution.steps.some(s=>s.action==='heal')?'重复施放立即再次回复生命。':'本场成长可以反复累加。',scope:'instant',effect:'resolvedSkill',overlap:'independent-payoff'};
    });
    copy.operators[card.id].skill.description=description;
    copy.operators[card.id].skill.summary=description;
    if(card.id==='char_388_mint')card.lines[3].template='地质学者：周围四格干员防御力 +{d}%。';
    if(card.id==='char_291_aglina')card.lines[3].template='兼职工作：你的其他干员每秒回复 {f} 点生命。';
    if(card.id==='char_469_indigo')card.lines[3].template=card.lines[3].template.replace(/（技能期间[^）]*）/g,'');
    count++;
    for(const module of card.modules)if(module.line) {
      if(card.id==='char_151_myrtle')module.line.template='“私人收藏”：首次施放后自身阻挡-1、身前1名干员阻挡+1（本场，不重复增加）；你的先锋干员每秒回复33生命。';
      if(card.id==='char_4207_branch')module.line.template='“时间的痕迹”：本场施放后防御力额外+18%（不重复增加）；每次施放立即恢复80%最大生命。';
      if(card.id==='char_213_mostma')module.line.template='锁与匙之家：荒时之锁晕眩+1秒，本次法术伤害额外增加15%攻击力。';
    }
  }
  // New Covenant Exusiai keeps her redeploy selection; the volley now lands in
  // this cast rather than opening a non-stacking five-hit attack window.
  if(family==='assault') {
    cards.operators.find(c=>c.id==='char_4058_pepe').lines[2].template='弥漫莲香：你的其他近卫干员通过技能伤害击倒敌人，或在持续技能中击倒敌人时，此干员充能1（每2秒最多一次）。';
    const card=cards.operators.find(c=>c.id==='char_1041_angel2');
    const line=card.lines[2];
    line.template='使命必达！：立即向当前敌人结算5连击，每击造成 {b}% 物理伤害，伤害提升30%；重复施放完整结算。';
    line.effect='damage(hits=5, scale=b, mul=1.3)';line.scope='instant';
    const body=roster.operators.find(c=>c.charId===card.id);
    body.fixedSkill.description=body.fixedSkill.description.replace(/之后.*$/,'立即结算5连击，每击120/135/150/160%物理伤害，伤害提升30%；立即再部署与充能效果每次分别结算。');
    copy.operators[card.id].skill.description=body.fixedSkill.description;
    copy.operators[card.id].skill.summary=body.fixedSkill.description;
    const surtr=roster.operators.find(c=>c.charId==='char_350_surtr');
    if(surtr){surtr.fixedSkill.description=surtr.fixedSkill.description.split('重复施放立即')[0]+'重复施放立即对3名敌人结算黄昏斩击，不再回满生命或重置流失生命的速度。';copy.operators[surtr.charId].skill.description=surtr.fixedSkill.description;}
    const dusk=cards.operators.find(c=>c.id==='char_350_surtr').lines.find(l=>l.kind==='skill');
    dusk.template=dusk.template.replace('再次发起时重新回复所有生命','重复施放立即对3名敌人结算黄昏斩击，不重置生命流失速度');
    const gravel=cards.operators.find(c=>c.id==='char_237_gravel').lines.find(l=>l.kind==='skill');
    gravel.template=gravel.template.split(' 每次部署')[0]+' 每次部署的屏障分别保留与衰减，可重叠。';
  }
  if(family==='ranged') {
    const robrta=cards.operators.find(c=>c.id==='char_484_robrta');
    robrta.lines[1].template=robrta.lines[1].template.replace('结束时为','每次施放立即为');
    robrta.lines[2].template='全自动造型仪：每次施放立即补充造型仪，护盾层数累加，防御加成取最高；防护姿态刷新持续时间。';
    const iron=cards.operators.find(c=>c.id==='char_4072_ironmn').lines.find(l=>l.kind==='skill');
    iron.template=iron.template.replace('结束时获得','每次施放立即获得');
  }
  if(family==='support') {
    const liskam=cards.operators.find(c=>c.id==='char_107_liskam').lines.find(l=>l.kind==='skill');
    liskam.template='充能防御：每次获得1层可抵挡伤害的护盾（可叠加，直到消耗）；防御力 +{a}%，持续8秒，重复刷新防御持续时间。';
    const reed=cards.operators.find(c=>c.id==='char_1020_reed2').lines.find(l=>l.kind==='skill');
    reed.template=reed.template.split(' 重复施放')[0]+' 重复施放新增独立火球组，各组分别持续20秒、造成伤害和治疗。';
  }
  for(const card of cards.operators) {
    const native=characters[card.id]?.phases?.at(-1)?.attributesKeyFrames?.at(-1)?.data?.respawnTime??priorRuntime.bodies[card.id]?.baseStats.respawnTime;
    if(!Number.isFinite(native))throw Error('Missing native respawn '+card.id);
    card.redeploySeconds=Array(4).fill(native);
    if(card.id==='char_151_myrtle')Object.assign(card.lines[4],{kind:'talent',suppressed:false,growthSuppressed:false,
      trigger:{event:'aura',subject:'allAllies'},effect:'regen(vanguard,25)',
      template:'浮光跃金：在场时，你的先锋干员每秒回复25生命。'});
    for(const line of card.lines)if(['growth','stack'].includes(line.kind)||line.growthSuppressed||(card.id==='char_127_estell'&&line.effect==='heal(maxHpRatio=a)')||(card.id==='char_437_mizuki'&&line.effect==='heal(maxHpRatio=0.1)')) {
      line.suppressed=!growthAllowed({charId:card.id});
      if(card.id==='char_127_estell') {line.suppressed=false;line.growthSuppressed=true;line.kind='talent';line.effect='heal(maxHpRatio=a)';line.template='自愈能力：周围8格内有敌人被你的其他干员击倒时，回复 {a}% 最大生命。';}
      if(card.id==='char_437_mizuki') {line.suppressed=false;line.growthSuppressed=true;line.kind='talent';line.effect='heal(maxHpRatio=0.1)';line.template='深蓝之籽：周围有敌人被你的其他干员击倒时，回复10%最大生命。';}
    }
  }
  write(`bazaar-cards-${family}`,cards);write(`roster-${family}`,roster);
}
write('public-text',copy);
for(const name of ['collectibles','bazaar-collectibles'])write(name,read(name));
const system=read('system');
system.strategySkills=[...system.strategySkills.filter(s=>!s.id.startsWith('strategy_link_')),...LINKED_SKILLS];
system.shopSelectionWeights={general:60,specialist:30,utility:10};
system.nodeReroll={cost:2,maxPerHour:1};
write('system',system);
const events=read('events');
const rest=events.events.find(event=>event.id==='evt_rogue1_rest');
rest.repeatable=true;rest.conditions.oncePerRun=false;rest.conditions.maxDay=10;
rest.conditions.requires=rest.conditions.requires.filter(text=>!text.startsWith('本局尚未进入过'));
rest.implementationPlan='休整事件可重复出现，保证补给时段始终存在免费的有益事件选项；每次正常动作幂等结算，护盾与强化只作用于下一场战斗。';
write('events',events);
console.log(JSON.stringify({revised:count,newCovenantVolley:true}));
