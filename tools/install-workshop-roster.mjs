#!/usr/bin/env node
// Install the single authored roster while retaining retired records for existing saves.
// A source reference, native affiliation and an executable default kit are required for every new member.
import fs from 'node:fs';
import path from 'node:path';
import { classifyRosterKind } from './independent-roster-classification.mjs';
import { fileURLToPath } from 'node:url';
import { makeDarkmoonSupport } from '../server/modes/independent/catalog.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=(flag,fallback)=>{const i=args.indexOf(flag);return i>=0?path.resolve(args[i+1]):path.join(root,fallback);};
const playerText=(value)=>String(value||'').replaceAll('该干员','该名干员');
const load=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const designPath=value('--design','data/independent-design.json'),textPath=value('--game-text','data/independent-game-text.json');
const chessPath=value('--chess','data/chess.json');
const nativePowerPath=value('--native-power','data/independent-native-power.json');
const design=load(designPath),gameText=load(textPath),plan=load(value('--plan','data/independent-roster-plan.json')),
  chess=load(chessPath),affiliations=load(value('--factions','data/native-factions.json')),
  blueprints=load(value('--blueprints','data/independent-darkmoon-blueprints.json')),
  addon=load(value('--addon','data/independent-darkmoon-design-addon.json')),
  nativePower=load(nativePowerPath),
  textAddon=load(value('--text-addon','data/independent-darkmoon-game-text-addon.json'));
const selected=Object.values(plan.groups).flatMap(x=>x.pairs.map(p=>p[1])),active=[];
const byNative=new Map(affiliations.operators.map(o=>[o.name,o]));
const old=new Map(design.operators.map(o=>[o.name,o]));
const powerByName=new Map(nativePower.operators.map(o=>[o.name,o]));
const receipts=[],pending=[];
const extraRefs=new Map(addon.operators.map(o=>[o.name,o]));
// Only the two original Magnetic cards bring handover permissions.
const magneticPermits={
  BOT_312:{gear:'医疗装置交接单',partnerFaction:'哥伦比亚',partnerMaxTier:4,limit:'可以与科技等级不高于4的哥伦比亚干员交接，对方无需凭证。'},
  BOT_911:{gear:'重装器械适配单',partnerFaction:'哥伦比亚',partnerProfession:'TANK',partnerMaxTier:4,limit:'可以与科技等级不高于4的哥伦比亚重装干员交接，对方无需凭证。'},
};
const permissions=[];
const plain=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const DAMAGE_TYPE_LABELS={phys:'物理',arts:'法术',true:'真实',heal:'治疗'};
function effectEvidence(e){
  return {trigger:e.triggerLabel||e.trigger||'未标记触发',recipient:e.recipientLabel||e.recipient||'未标记对象',
    duration:e.durationLabel||e.duration||'持续范围未标记',rule:plain(e.text||e.adaptation||e.kind)};
}
function allocationEvidenceFor(name,raw,blueprint,powerRecord){
  if(!powerRecord||!Array.isArray(powerRecord.forms)||powerRecord.forms.length!==2)throw new Error(`MISSING_NATIVE_POWER_FORMS:${name}`);
  if(powerRecord.forms.some(f=>f.errors?.length||f.provisional))throw new Error(`INVALID_NATIVE_POWER_PROBE:${name}`);
  if(nativePower.scenario.seconds!==90)throw new Error(`UNEXPECTED_NATIVE_POWER_DURATION:${nativePower.scenario.seconds}`);
  if(powerRecord.forms.some(f=>(f.skillId||null)!==(raw.skill?.skillId||null)))throw new Error(`NATIVE_POWER_SKILL_MISMATCH:${name}`);
  if(powerRecord.forms.some(f=>!['damage','dps','healing'].every(k=>Number.isFinite(f[k]))))throw new Error(`INCOMPLETE_NATIVE_POWER_METRICS:${name}`);
  const forms=powerRecord.forms.map(f=>({form:f.elite?'进阶':'普通',skill:raw.skill?.name||'无主动技能',
    damage:f.damage,dps:f.dps,healing:f.healing,attacks:f.attacks,skillActivations:f.skillActivations,
    deaths:f.deaths,summons:f.summons}));
  const sourceText=plain(blueprint.sourceTexts.normal);
  const normal=(blueprint.metadata.op.effectDelivery.normal||[]).map(effectEvidence);
  const elite=(blueprint.metadata.op.effectDelivery.elite||[]).map(effectEvidence);
  const sourceTier=blueprint.originalTier;
  const override=plan.tierOverrides?.[name];
  const tierReason=override?.reason || `沿用《${blueprint.name}》原科技${sourceTier}：源卡功能为“${sourceText}”；工坊将其落实为普通/进阶各自列出的触发、收益对象与持续范围。该科技档位按功能收益和触发条件保留，90秒本体探针用于核对输出与治疗，不单独决定档位。`;
  return {
    source:{name:blueprint.name,tier:sourceTier,normal:sourceText,elite:plain(blueprint.sourceTexts.elite)},
    workshop:{normal,elite},
    nativeBody:{profession:raw.profession,position:raw.position,attackKind:raw.attackKind,
      damageType:DAMAGE_TYPE_LABELS[raw.dmgType]||raw.dmgType||'未标记',defaultSkill:raw.skill?.name||'无主动技能',
      defaultSkillLevel:raw.skill?.level??null},
    probe:{seconds:nativePower.scenario.seconds,enemyCount:nativePower.scenario.enemyCount,
      enemyDefense:nativePower.scenario.enemyDefense,enemyResistance:nativePower.scenario.enemyResistance,
      equipment:nativePower.scenario.equipment,workshopTraits:nativePower.scenario.workshopTraits,forms},
    tierReason,
  };
}
for(const name of selected){
  const native=byNative.get(name),blueprint=blueprints.entries.find(o=>o.operator===name);
  if(!native||!blueprint)throw new Error(`MISSING_ROSTER_SOURCE:${name}`);
  let operator=old.get(name);
  const raw=operator?chess[operator.chessId]:Object.values(chess).find(r=>r.name===name&&r.chessId?.endsWith('_a')&&r.charId===native.charId);
  if(!raw)throw new Error(`MISSING_NATIVE_BODY:${name}`);
  if(raw.nativeImport?.playable===false)pending.push({name,chessId:raw.chessId,reason:'native default kit/talents/tokens not ready'});
  const effects=[...blueprint.metadata.op.effectDelivery.normal,...blueprint.metadata.op.effectDelivery.elite];
  if(effects.some(e=>e.implementation!=='supported'))pending.push({name,sourceId:blueprint.sourceId,reason:'source adaptation not ready'});
  const tags=Object.values(native.factions).filter(Boolean).map(f=>f.name);
  if(!tags.length)throw new Error(`MISSING_NATIVE_AFFILIATION:${name}`);
  if(blueprint.faction&&!tags.includes(blueprint.faction))throw new Error(`WRONG_NATIVE_AFFILIATION:${name}`);
  const tier=plan.tierOverrides?.[name]?.tier??blueprint.originalTier;
  const extra=extraRefs.get(name);
  const allocationEvidence=allocationEvidenceFor(name,raw,blueprint,powerByName.get(name));
  const cardRef={id:blueprint.sourceId,name:blueprint.name,dbfId:blueprint.dbfId,tier:blueprint.originalTier,
    text:blueprint.sourceTexts.normal,textElite:blueprint.sourceTexts.elite,goldenText:blueprint.sourceTexts.elite,
    version:blueprint.sourceVersion,sourceUrl:blueprint.sourceUrl,type:'Battlegrounds'};
  const t=textAddon.operators[name];if(!t)throw new Error(`MISSING_TRANSLATED_TEXT:${name}`);
   operator={...(operator||{}),name,chessId:raw.chessId,charId:raw.charId,tier,nativeFactionTags:tags,
     skill:raw.skill?.name??operator?.skill??(raw.nativeImport?.playable?'无主动技能':''),
    sourceRefs:{...(extra?.sourceRefs||{}),darkmoon19_2:{id:blueprint.sourceId,name:blueprint.name,nameEn:blueprint.nameEn,tier:blueprint.originalTier,
      rosterTribe:blueprint.rosterTribe,faction:blueprint.faction,nationId:blueprint.nationId,originalRaces:blueprint.originalRaces,
      battlecry:/Battlecry:/i.test(blueprint.sourceTextsEn.normal),deathrattle:/Deathrattle:/i.test(blueprint.sourceTextsEn.normal),version:blueprint.sourceVersion,type:'Battlegrounds',sourceUrl:blueprint.sourceUrl},cards:[cardRef]},effectDelivery:blueprint.metadata.op.effectDelivery,
    nativeTrait:{normal:t.normal,elite:t.elite,inheritable:false,origin:'operator body'},
    modeEffects:null,inheritance:null,tierReason:allocationEvidence.tierReason,allocationEvidence,
    defaultSkillIndex:raw.skill?.index??0,skills:(raw.skills||[]).map(s=>s.skillId),talents:raw.talents||[],
     growthLandOn:'self',sourceIdentity:{...native.sourceFields}};
  delete operator.tavernFactionProxy;delete operator.permitGearId;delete operator.modeEffects;
  if(magneticPermits[blueprint.sourceId]){
    const permission={name,...magneticPermits[blueprint.sourceId],autoGrant:true,sourceRefs:{cards:[cardRef],basis:'磁力的可选设备整合提供双向装备交接；另一方无需凭证。'}};
    operator.inheritance=permission;permissions.push(permission);
  }
   operator.active=true;
   operator.roster=classifyRosterKind(operator);
   operator.role ||= operator.roster;
   old.set(name,operator);active.push(raw.chessId);
  gameText.operators[raw.chessId]={name,normal:playerText(t.normal),elite:playerText(t.elite),normalLevels:playerText(t.normalLevels||t.normal),eliteLevels:playerText(t.eliteLevels||t.elite)};
  receipts.push({name,chessId:raw.chessId,sourceId:blueprint.sourceId,originalTier:blueprint.originalTier,tier,nativeFactions:tags});
}
if(active.length!==101||new Set(active).size!==101)throw new Error('WRONG_ROSTER_COUNT');
const activeSet=new Set(active);
for(const operator of old.values())operator.active=activeSet.has(operator.chessId);
design.operators=[...old.values()];
design.permissions=permissions;
for(const name of ['便携式融毁教学仪','反冲空降仓']){
  const gear=design.extraGear.find(x=>x.name===name);if(gear){gear.level=6;gear.shopTier=6;}
}
design.rules={...design.rules,activeRosterIds:active,factionIdentityEquipment:false,tavernFactions:[...new Set(receipts.flatMap(o=>o.nativeFactions))]};
design.rules.factionDetails=Object.fromEntries(affiliations.operators.flatMap(o=>Object.values(o.factions).filter(Boolean).map(f=>[f.name,{name:f.name,iconUrl:f.iconPath,type:Object.entries(o.factions).find(([,x])=>x===f)?.[0]}])));
design.status='implemented';
for(const support of addon.supportOperators||[])chess[support.id]=makeDarkmoonSupport(support).source.normalChess;
const report={operators:receipts,tierCounts:receipts.reduce((a,o)=>(a[o.tier]=(a[o.tier]||0)+1,a),{}),factionCounts:receipts.reduce((a,o)=>{for(const f of o.nativeFactions)a[f]=(a[f]||0)+1;return a;},{}),allocationEvidence:{source:nativePowerPath,scenario:nativePower.scenario,operators:receipts.length,forms:receipts.length*2},pending};
const reportArg=args.indexOf('--report');if(reportArg<0||!args[reportArg+1])throw new Error('Absolute --report is required');
const reportPath=path.resolve(args[reportArg+1]);fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
if(args.includes('--write')){
  if(pending.length)throw new Error(`ROSTER_NOT_READY:${pending.length}; see ${reportPath}`);
  fs.writeFileSync(designPath,JSON.stringify(design,null,2)+'\n');fs.writeFileSync(textPath,JSON.stringify(gameText,null,2)+'\n');fs.writeFileSync(chessPath,JSON.stringify(chess)+'\n');
}
console.log(JSON.stringify({report:reportPath,ready:pending.length===0,roster:receipts.length,tierCounts:report.tierCounts,pending:pending.length,written:args.includes('--write')}));
