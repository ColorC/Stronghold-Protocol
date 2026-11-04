import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function refreshRangedCoverage(runtime){
 const file=path.join(root,'data/assault-coverage-ranged.json');
 const coverage=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const row of coverage.sourceAudit){
  const body=runtime.bodies[row.charId];if(!body)throw Error('Coverage body missing '+row.charId);
  if(body.adaptation){
   row.testFile='test/assault/synergy-adaptation-core.test.mjs';
   row.implementation='server/sim/content/assault/cards/adaptation-registry.js';
   row.adaptation={sourceSkillId:body.adaptation.sourceSkillId,sourceTalent:body.adaptation.sourceTalent,
    causalSuites:['core','ammo','workshop','deploy'].map(group=>`test/assault/synergy-adaptation-${group}.test.mjs`)};
   row.fixedSkill=[];row.stagedEffects=[];row.modePassives=[];row.talentBindings=body.talentBindings;
   row.moduleIds=body.modulePlans.map(module=>module.id);
   continue;
  }
  // a synergy card (design of 2026-10-21) is tested line by line in test/assault/synergy-*.test.mjs, by its name
  if(body.bazaar?.format==='synergy'){
   const files=fs.readdirSync(path.join(root,'test/assault')).filter(name=>/^synergy-.*\.test\.mjs$/.test(name)).sort();
   const hit=files.map(name=>[name,[...fs.readFileSync(path.join(root,'test/assault',name),'utf8').matchAll(/\btest\((['"])(.*?)\1/g)].map(m=>m[2]).filter(t=>t.startsWith(body.name+'：'))]).find(([,tests])=>tests.length);
   if(!hit)throw Error('No synergy card test for '+row.charId);
   row.testFile='test/assault/'+hit[0];
   row.implementation='server/sim/content/assault/cards/synergy-ranged.js';
   for(const field of ['fixedSkill','stagedEffects','modePassives','talentBindings'])for(const entry of row[field]??[])entry.evidenceTests=hit[1];
  }
  const text=fs.readFileSync(path.join(root,row.testFile),'utf8');
  const names=[...text.matchAll(/\btest\((['"])(.*?)\1/g)].map(match=>match[2]);
  const prior=[...row.fixedSkill,...row.stagedEffects,...row.modePassives,...row.talentBindings].flatMap(entry=>entry.evidenceTests??[]);
  let evidence=[...new Set(prior.filter(name=>names.includes(name)))];
  if(!evidence.length){const prefix=prior[0]?.split(' ')[0];evidence=names.filter(name=>prefix&&name.startsWith(prefix+' '));}
  if(!evidence.length)throw Error('No current named behavior evidence for '+row.charId);
  for(const [field,effects,prefix]of [['fixedSkill',body.fixedSkill.effects,'fixedSkill.effect:'],['stagedEffects',body.stagedEffects??[],'stagedEffect:'],['modePassives',body.modePassives,'modePassive:']]){
   row[field]=effects.map((effect,index)=>({sourceRef:prefix+index,action:effect.action,...(effect.trigger?{trigger:effect.trigger}:{}),valueKeys:Object.keys(effect.values??{}),evidenceTests:evidence,implementation:row.implementation}));
  }
  row.talentBindings=body.talentBindings.map(binding=>({...binding,evidenceTests:evidence,implementation:row.implementation}));
  row.moduleIds=body.modulePlans.filter(module=>module.type==='ADVANCED').map(module=>module.id);
 }
 for(const row of coverage.moduleAudit){const body=runtime.bodies[row.charId];const module=(body?.source.modules??body?.modulePlans)?.find(module=>module.id===row.moduleId);if(!module)throw Error('Coverage module missing '+row.moduleId);row.effectHandling=module.translation.effectHandling;if(body.adaptation)row.supersededBy=body.modulePlans.map(m=>m.id);}
 coverage.inventorySourceRevision=runtime.contentSourceRevision;
 coverage.inventoryScope='Current compiled parameter inventory and existing named test declarations; test execution and current effect acceptance come from the gameplay validation receipt. Historical module subeffect labels are not new execution proof.';
 fs.writeFileSync(file,JSON.stringify(coverage,null,2)+'\n');
 const companionFiles=[];
 for(const suffix of ['mid','elite']){
  const companionFile=path.join(root,`data/assault-coverage-ranged-${suffix}.json`);
  const companion=JSON.parse(fs.readFileSync(companionFile,'utf8'));
  for(const row of [...(companion.moduleAudit??[]),...(companion.modules??[])]){
   const body=runtime.bodies[row.charId];
   const module=(body?.source.modules??body?.modulePlans)?.find(item=>item.id===(row.moduleId??row.advancedModuleId));
   if(!module)throw Error('Companion coverage module missing '+(row.moduleId??row.advancedModuleId));
   row.effectHandling=module.translation.effectHandling;
   if(body.adaptation)row.supersededBy=body.modulePlans.map(m=>m.id);
  }
  for(const row of companion.cardCoverage??[]){
   const body=runtime.bodies[row.charId];if(!body)throw Error('Companion coverage body missing '+row.charId);
   row.fixedEffects=body.fixedSkill.effects.map((_,index)=>`fixedSkill.effect:${index}`);
   row.modePassives=body.modePassives.map((_,index)=>`modePassive:${index}`);
   row.talents=body.talentBindings.map(binding=>binding.binding);
  }
  companion.inventorySourceRevision=runtime.contentSourceRevision;
  companion.inventoryScope=coverage.inventoryScope;
  fs.writeFileSync(companionFile,JSON.stringify(companion,null,2)+'\n');
  companionFiles.push({file:companionFile,moduleRows:companion.moduleAudit.length});
 }
 return {file,sourceRows:coverage.sourceAudit.length,moduleRows:coverage.moduleAudit.length,companionFiles};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(refreshRangedCoverage(JSON.parse(fs.readFileSync(path.join(root,'data/assault-runtime.json'),'utf8')))));
