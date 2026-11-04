// P4.2 bounded background v2/v3 comparison. Each worker owns its receipts;
// all game actions go through the same campaign player / public run commands.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const canonicalRoot=path.resolve(sourceRoot,'../../..');
const argv=process.argv.slice(2),arg=k=>argv[argv.indexOf(k)+1];
const out=arg('--out');if(!out||!path.isAbsolute(out))throw Error('Explicit absolute --out required');
fs.mkdirSync(out,{recursive:true});
const strategies=['public-signatures-native-boss-geometry-and-unlocked-modules/v2','line-builder/v3'];
const directors=['director_svash2','director_ironmn','director_angel2'];
const sourceCommit=execFileSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const save=(file,value)=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value)+'\n');fs.renameSync(temp,file);};
if(argv.includes('--worker')){
 const policy=arg('--policy'),directorId=arg('--director'),deadlineMs=Number(arg('--deadline'));
 if(!strategies.includes(policy)||!directors.includes(directorId)||!Number.isFinite(deadlineMs))throw Error('Invalid worker configuration');
 const {runCampaign}=await import('./campaign-player.mjs');
 for(let seed=20261101;seed<=20261110&&Date.now()<deadlineMs;seed++){
  const record={sourceCommit,policy,directorId,seed,startedAt:new Date().toISOString()};
  try{record.run=runCampaign(directorId,seed,{policy,deadlineMs});record.status=record.run.nativeErrorCount===0?'complete':'simulation-error';}
  catch(error){record.status='failed';record.error=String(error.stack||error);}
  record.finishedAt=new Date().toISOString();save(path.join(out,`${policy.endsWith('/v3')?'v3':'v2'}-${directorId}-${seed}.json`),record);
  process.stdout.write(JSON.stringify({policy,directorId,seed,status:record.status,completed:record.run?.completed})+'\n');
 }
}else{
 const dirty=execFileSync('git',['-C',sourceRoot,'status','--porcelain'],{encoding:'utf8',windowsHide:true}).trim();
 if(dirty)throw Error('Commit the tested tools before running the comparison');
 if(fs.existsSync(path.join(out,'batch.json')))throw Error('Refusing to overwrite an existing batch; use a new explicit output directory');
 const startedMs=Date.now(),deadlineMs=startedMs+30*60*1000;
 const record={schema:'assault-line-campaign/v3',status:'running',sourceCommit,sourceRoot,canonicalRoot,startedAt:new Date(startedMs).toISOString(),deadlineAt:new Date(deadlineMs).toISOString(),expectedRuns:60,seedRange:[20261101,20261110],maxWorkers:3,strategies,directors,writesPlayerState:false,jobs:[]};
 save(path.join(out,'batch.json'),record);
 const jobs=strategies.flatMap(policy=>directors.map(directorId=>({policy,directorId}))),children=new Set();
 const timer=setTimeout(()=>{for(const child of children)child.kill();},Math.max(1,deadlineMs-Date.now()));
 try{
  await Promise.all(Array.from({length:3},async()=>{
   while(jobs.length&&Date.now()<deadlineMs){
    const job=jobs.shift(),log=path.join(out,`${job.policy.endsWith('/v3')?'v3':'v2'}-${job.directorId}.log`),fd=fs.openSync(log,'a');
    const child=spawn(process.execPath,['--max-old-space-size=384','--import',path.join(sourceRoot,'tools/assault/test-resource-loader.mjs').replaceAll('\\','/').replace(/^([A-Za-z]:)/,'file:///$1'),fileURLToPath(import.meta.url),'--worker','--policy',job.policy,'--director',job.directorId,'--out',out,'--deadline',String(deadlineMs)],{cwd:sourceRoot,env:process.env,windowsHide:true,stdio:['ignore',fd,fd]});
    fs.closeSync(fd);children.add(child);
    const result=await new Promise(resolve=>{child.once('error',e=>resolve({error:String(e)}));child.once('exit',(code,signal)=>resolve({code,signal}));});
    children.delete(child);record.jobs.push({...job,pid:child.pid,log,...result});save(path.join(out,'batch.json'),record);
   }
  }));
 }finally{clearTimeout(timer);}
 // One final inventory at completion/deadline, never repeated progress polling.
 const records=fs.readdirSync(out).filter(f=>/^v[23]-.*-\d+\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(out,f),'utf8')));
 record.finishedAt=new Date().toISOString();record.completedRuns=records.filter(r=>r.status==='complete').length;
 record.status=record.completedRuns===60?'complete':Date.now()>=deadlineMs?'deadline':'failed';
 record.failures=records.filter(r=>r.status!=='complete').map(({policy,directorId,seed,error})=>({policy,directorId,seed,error}));
 record.comparison=directors.map(directorId=>({directorId,...Object.fromEntries(strategies.map(policy=>{
  const runs=records.filter(r=>r.policy===policy&&r.directorId===directorId&&r.run).map(r=>r.run),bs=runs.flatMap(r=>r.battles),normal=bs.filter(b=>!b.encounterId.startsWith('enc_final_')),final=bs.filter(b=>b.encounterId.startsWith('enc_final_'));
  return[policy.endsWith('/v3')?'v3':'v2',{runs:runs.length,clears:runs.filter(r=>r.completed).length,normalWins:normal.filter(b=>b.outcome.victory).length,normalBattles:normal.length,finalWins:final.filter(b=>b.outcome.victory).length,finalBattles:final.length}];
 }))}));
 save(path.join(out,'batch.json'),record);console.log(JSON.stringify(record));
 if(record.status!=='complete')process.exitCode=1;
}
