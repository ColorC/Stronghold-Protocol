#!/usr/bin/env node
// Reproducible native-kit scenarios, without Workshop traits or equipment.
// These measurements inform tier review; DPS is never a substitute for utility.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { skillSpecSource } from '../server/sim/content/index.js';
import { makeBattle,chessRec,enemyRec } from '../test/helpers/battleHarness.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),outArg=args.indexOf('--out');
if(outArg<0||!args[outArg+1])throw new Error('Supply an absolute --out report path');
const out=path.resolve(args[outArg+1]);
const data=getData(),source=new DataSource(data);
const plan=JSON.parse(fs.readFileSync(path.join(root,'data/independent-roster-plan.json'),'utf8'));
const names=Object.values(plan.groups).flatMap(x=>x.pairs.map(p=>p[1]));
const records=Object.values(data.chess).filter(r=>r.chessId?.endsWith('_a')&&!r.isDiy&&names.includes(r.name));
const report={scenario:{seconds:90,enemyDefense:300,enemyResistance:30,enemyCount:4,enemyAttack:40,enemyPositions:[[10,5.5],[10,7],[11,6],[11,7]],equipment:[],workshopTraits:false},operators:[],pending:[]};
for(const name of names){
  const raw=records.find(r=>r.name===name&&r.chessType!=='NATIVE_IMPORT_CANDIDATE')||records.find(r=>r.name===name);
  if(!raw){report.pending.push({name,reason:'native definition missing'});continue;}
  const forms=[];
  for(const record of [raw,data.chess[raw.chessId.replace(/_a$/,'_b')]].filter(Boolean)){
    if(record.nativeImport?.sourceNativeSkillIds?.length&&!record.skill){report.pending.push({name,chessId:record.chessId,reason:'native default loadout not implemented'});continue;}
    const normalized=source.getChess(record.chessId,{skillIndex:record.skill?.index??0,moduleId:'none'}),specSource=normalized.skill?skillSpecSource(normalized):'no-skill';
    if(specSource==='generic'){report.pending.push({name,chessId:record.chessId,reason:'default native skill has no explicit kit'});continue;}
    const allyId='power_probe_ally_a',ally=chessRec({id:allyId,skill:null,stats:{cost:0,atk:0,maxHp:1e7,def:0,blockCnt:0},rangeGrid:[[0,0]]});
    const h=makeBattle({data:new DataSource({...data,chess:{...data.chess,[allyId]:ally},enemies:{...data.enemies,power_probe:enemyRec({key:'power_probe',hp:1e9,atk:40,def:300,res:30,speed:0,bat:1})}}),
      units:[{uid:'native',chessId:record.chessId,row:10,col:5,skillIndex:record.skill?.index??0,moduleId:'none'},{uid:'heal-target',chessId:allyId,row:11,col:5}],
      enemies:report.scenario.enemyPositions.map(pos=>({key:'power_probe',pos})),
      content:'independent',autoFinish:false,timeLimit:90,recordEvents:false,
      extraContent:[b=>b.every(.5,()=>{const target=b.allyUnits.find(u=>u.uid==='heal-target');if(target?.alive)target.hp=Math.max(1,target.hp-10000);})]});
    h.run(90);h.invariants();
    const unit=h.unit('native');
    forms.push({chessId:record.chessId,elite:!!record.isGolden,provisional:record.nativeImport?.playable===false,phase:record.status.phase,nativeLevel:record.status.level,
      skillId:record.skill?.skillId??null,skillSpecSource:specSource,base:{atk:unit.base.atk,maxHp:unit.base.maxHp,def:unit.base.def,res:unit.base.res},
      damage:Math.round(unit.stats.dmg),dps:Math.round(unit.stats.dmg/90),healing:Math.round(unit.stats.heal||unit.stats.healing||0),
      attacks:unit.stats.attacks,skillActivations:unit.skill?.activations||0,deaths:unit.player?.deaths||0,dp:unit.player?.dp||0,
      summons:h.b.allyUnits.filter(u=>u.kind==='token').length,errors:h.b.errors.map(e=>({message:e.message,phase:e.phase}))});
  }
  report.operators.push({name,profession:raw.profession,subProfession:raw.subProfessionId,forms});
}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:out,operators:report.operators.length,measuredForms:report.operators.reduce((n,o)=>n+o.forms.length,0),pending:report.pending.length,errors:report.operators.flatMap(o=>o.forms).reduce((n,f)=>n+f.errors.length,0)}));
