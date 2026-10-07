#!/usr/bin/env node
// Install the single authored roster while retaining retired records for existing saves.
// A source reference, native affiliation and an executable default kit are required for every new member.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDarkmoonSupport } from '../server/modes/independent/catalog.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=(flag,fallback)=>{const i=args.indexOf(flag);return i>=0?path.resolve(args[i+1]):path.join(root,fallback);};
const load=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const designPath=value('--design','data/independent-design.json'),textPath=value('--game-text','data/independent-game-text.json');
const chessPath=value('--chess','data/chess.json');
const design=load(designPath),gameText=load(textPath),plan=load(value('--plan','data/independent-roster-plan.json')),
  chess=load(chessPath),affiliations=load(value('--factions','data/native-factions.json')),
  blueprints=load(value('--blueprints','data/independent-darkmoon-blueprints.json')),
  addon=load(value('--addon','data/independent-darkmoon-design-addon.json')),
  textAddon=load(value('--text-addon','data/independent-darkmoon-game-text-addon.json'));
const selected=Object.values(plan.groups).flatMap(x=>x.pairs.map(p=>p[1])),active=[];
const byNative=new Map(affiliations.operators.map(o=>[o.name,o]));
const old=new Map(design.operators.map(o=>[o.name,o]));
const receipts=[],pending=[];
const extraRefs=new Map(addon.operators.map(o=>[o.name,o]));
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
  const cardRef={id:blueprint.sourceId,name:blueprint.name,dbfId:blueprint.dbfId,tier:blueprint.originalTier,
    text:blueprint.sourceTexts.normal,textElite:blueprint.sourceTexts.elite,goldenText:blueprint.sourceTexts.elite,
    version:blueprint.sourceVersion,sourceUrl:blueprint.sourceUrl,type:'Battlegrounds'};
  const t=textAddon.operators[name];if(!t)throw new Error(`MISSING_TRANSLATED_TEXT:${name}`);
  operator={...(operator||{}),name,chessId:raw.chessId,charId:raw.charId,tier,nativeFactionTags:tags,
    sourceRefs:{...(extra?.sourceRefs||{}),darkmoon19_2:{id:blueprint.sourceId,name:blueprint.name,nameEn:blueprint.nameEn,tier:blueprint.originalTier,
      rosterTribe:blueprint.rosterTribe,faction:blueprint.faction,nationId:blueprint.nationId,originalRaces:blueprint.originalRaces,
      battlecry:/Battlecry:/i.test(blueprint.sourceTextsEn.normal),deathrattle:/Deathrattle:/i.test(blueprint.sourceTextsEn.normal),version:blueprint.sourceVersion,type:'Battlegrounds',sourceUrl:blueprint.sourceUrl},cards:[cardRef]},effectDelivery:blueprint.metadata.op.effectDelivery,
    nativeTrait:{normal:t.normal,elite:t.elite,inheritable:false,origin:'operator body'},
    modeEffects:null,inheritance:null,tierReason:plan.tierOverrides?.[name]?.reason||'按原卡科技与功能安排',
    defaultSkillIndex:raw.skill?.index??0,skills:(raw.skills||[]).map(s=>s.skillId),talents:raw.talents||[],
    growthLandOn:'self',sourceIdentity:{...native.sourceFields}};
  delete operator.tavernFactionProxy;delete operator.permitGearId;delete operator.modeEffects;
  old.set(name,operator);active.push(raw.chessId);
  gameText.operators[raw.chessId]={normal:t.normal,elite:t.elite,normalLevels:t.normalLevels||t.normal,eliteLevels:t.eliteLevels||t.elite};
  receipts.push({name,chessId:raw.chessId,sourceId:blueprint.sourceId,originalTier:blueprint.originalTier,tier,nativeFactions:tags});
}
if(active.length!==101||new Set(active).size!==101)throw new Error('WRONG_ROSTER_COUNT');
design.operators=[...old.values()];
design.rules={...design.rules,activeRosterIds:active,factionIdentityEquipment:false,tavernFactions:[...new Set(receipts.flatMap(o=>o.nativeFactions))]};
design.rules.factionDetails=Object.fromEntries(affiliations.operators.flatMap(o=>Object.values(o.factions).filter(Boolean).map(f=>[f.name,{name:f.name,iconUrl:f.iconPath,type:Object.entries(o.factions).find(([,x])=>x===f)?.[0]}])));
design.status='implemented';
for(const support of addon.supportOperators||[])chess[support.id]=makeDarkmoonSupport(support).source.normalChess;
const report={operators:receipts,tierCounts:receipts.reduce((a,o)=>(a[o.tier]=(a[o.tier]||0)+1,a),{}),factionCounts:receipts.reduce((a,o)=>{for(const f of o.nativeFactions)a[f]=(a[f]||0)+1;return a;},{}),pending};
const reportArg=args.indexOf('--report');if(reportArg<0||!args[reportArg+1])throw new Error('Absolute --report is required');
const reportPath=path.resolve(args[reportArg+1]);fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
if(args.includes('--write')){
  if(pending.length)throw new Error(`ROSTER_NOT_READY:${pending.length}; see ${reportPath}`);
  fs.writeFileSync(designPath,JSON.stringify(design,null,2)+'\n');fs.writeFileSync(textPath,JSON.stringify(gameText,null,2)+'\n');fs.writeFileSync(chessPath,JSON.stringify(chess)+'\n');
}
console.log(JSON.stringify({report:reportPath,ready:pending.length===0,roster:receipts.length,tierCounts:report.tierCounts,pending:pending.length,written:args.includes('--write')}));
