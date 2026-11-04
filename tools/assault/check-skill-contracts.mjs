import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertFixedSkillContract} from './instant-source.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const runtime=read(process.env.SP_SKILL_RUNTIME??path.join(root,'data/assault-runtime.json'));
const table=read('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/skill_table.json');
const publicFile=process.env.SP_SKILL_PUBLIC_TEXT??path.join(root,'data/assault-public-text.json');
const publicText=fs.existsSync(publicFile)?read(publicFile):null;
const failures=[],counts={forms:0,active:0,passive:0,nativeInstant:0,converted:0,singleSlotExceptions:0,publicNames:0};
for(const body of Object.values(runtime.bodies)){
  counts.forms++;
  try{
    const source=assertFixedSkillContract(body,table),fixed=body.fixedSkill;
    if(fixed.kind==='passive'){
      // passives: 正义骑士号 (no native skill at all) and the synergy cards' deploy-cast passives (ruled 10-21)
      if(body.source.skills.length&&!(body.bazaar?.format==='synergy'&&body.bazaar.castOnDeploy===true))throw Error('Passive body without a deploy cast');
      counts.passive++;continue;
    }
    counts.active++;if(source.candidates.length)counts.nativeInstant++;else counts.converted++;
    if(source.singleSlotException)counts.singleSlotExceptions++;
    if(publicText){
      const copy=publicText.operators[body.charId];if(copy?.skill?.name!==fixed.name)throw Error('Public fixed skill name differs');
      const summary=copy.skill.summary||fixed.effects.map(effect=>effect.description).filter(Boolean).join('\n');
      if(!summary||!copy.skill.description)throw Error('Public skill effect missing');counts.publicNames++;
    }
  }catch(error){failures.push({id:body.charId,name:body.name,error:error.message});}
}
if(counts.forms!==172||counts.active+counts.passive!==172||counts.passive<1)failures.push({error:'Full fixed roster coverage failed'});
console.log(JSON.stringify({status:failures.length?'fail':'pass',counts,runtime:process.env.SP_SKILL_RUNTIME??path.join(root,'data/assault-runtime.json'),publicText:publicText?publicFile:null,failures}));
if(failures.length)process.exitCode=1;
