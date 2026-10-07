#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { getData } from '../server/data.js';
import { getCatalog } from '../server/modes/independent/catalog.js';
import { getIndependentField, runIndependentBattle } from '../server/modes/independent/battle.js';
import { positionClass, canPlace } from '../server/match/board.js';

const data=getData({log:{info(){},warn(){},error(){}}});
const catalog=getCatalog(data);
const args=process.argv.slice(2);
if(args.length && !(args.length===1 && !args[0].startsWith('--')) && !(args.length===2 && args[0]==='--output')) throw new Error('Usage: independent-audit.mjs [--output path]');
const output=resolve((args[0]==='--output'?args[1]:args[0])||'runtime/independent-mode-20261005/content-audit.json');
const cases=[];
const badges=Object.keys(catalog.badges).map((id,i)=>({uid:`badge${i}`,id,quantity:1,elite:false,state:{}}));
const ordinary=Object.values(catalog.operators).find(op=>!op.elite && op.name==='角峰');
const run=(op,equipment,label)=>{
  const state={modeId:'independent',seed:7,round:1,roundLimit:9,difficulty:'FUNNY',pieces:[]};
  const field=getIndependentField(state,{data,catalog});
  const raw=data.chess[op.chessId];
  const tile=[...field.deployMap.keys()].map(k=>k.split(',').map(Number)).find(([r,c])=>canPlace(field.deployMap,positionClass(raw,'none'),r,c));
  if(!tile) throw new Error('No legal tile for '+op.name);
  state.pieces.push({uid:'p1',chessId:op.chessId,elite:op.elite,row:tile[0],col:tile[1],dir:'RIGHT',skillIndex:raw.skill?.index??0,moduleId:'none',equipment,attachments:[],nativeState:{}});
  try {
    const result=runIndependentBattle(state,{data,catalog});
    if(result.diagnostics.errorCount || result.diagnostics.capped) throw new Error('Battle error or tick bound');
    cases.push({label,ok:true,ticks:result.diagnostics.ticks,rewards:result.rewards});
  }catch(error){cases.push({label,ok:false,error:error.message,diagnostics:error.diagnostics});}
};
for(const op of Object.values(catalog.operators)) run(op,badges,`${op.name}:${op.elite?'elite':'normal'}`);
for(const gear of Object.values(catalog.equipment)) {
  if(gear.available===false || ['停用','补给','玩家设施'].includes(gear.kind))continue;
  for(const elite of gear.eliteLevel==null?[false]:[false,true])run(ordinary,[...badges,{uid:'gear',id:gear.id,quantity:1,elite,state:{}}],`equipment:${gear.id}:${elite?'elite':'normal'}`);
}
const report={createdAt:new Date().toISOString(),cases:cases.length,passed:cases.filter(c=>c.ok).length,failed:cases.filter(c=>!c.ok).length,results:cases};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,role:'real Battle audit of every ordinary/elite body and wearable item',cases:report.cases,passed:report.passed,failed:report.failed,failures:cases.filter(c=>!c.ok).map(c=>({label:c.label,error:c.error}))},null,2));
if(report.failed)process.exitCode=1;
