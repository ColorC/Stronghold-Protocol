import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.resolve(source,'../../..');
const {ctx,configureCampaign,candidatePlacements,reportByRun}=await import(pathToFileURL(source+'/tools/assault/campaign-player.mjs'));
const {createRun,applyAction}=await import(pathToFileURL(source+'/shared/assault/run.js'));
const {addBodyToInventory}=await import(pathToFileURL(source+'/shared/assault/inventory.js'));
const {moduleForLine}=await import(pathToFileURL(source+'/tools/assault/line-builder.mjs'));
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
const out=arg('--out'),batchFile=arg('--batch');
if(!out||!path.isAbsolute(out)||!batchFile||!path.isAbsolute(batchFile))throw Error('Absolute --out and --batch required');
const batch=JSON.parse(fs.readFileSync(batchFile,'utf8'));
if(batch.status!=='complete'||batch.completedRuns!==60)throw Error('P4.2 must complete before P4.3');
fs.mkdirSync(out,{recursive:true});
const install=ctx.install;
ctx.install=(battle,prepared)=>{
 install(battle,prepared);
 const applications=new Map(),registered=new Map(),originalObserve=battle.assaultRuntime.observe;
 battle.assaultRuntime.observe=function(type,key,fn,options){
  if(options?.owner?.kind==='op'){
   const id=options.owner.uid,list=registered.get(id)??[];list.push({type,key});registered.set(id,list);
  }
  return originalObserve.call(this,type,key,fn,options);
 };
 originalObserve.call(battle.assaultRuntime,'triggerResolved','p4:typed-applications',({payload:p})=>{
  if(!p.source||!(p.amount>0))return;
  const id=p.source.uid,entries=applications.get(id)??new Map(),key=p.key;
  entries.set(key,(entries.get(key)??0)+1);applications.set(id,entries);
 });
 const snapshot=battle.campaignEvidence;
 battle.campaignEvidence=()=>{const result=snapshot();for(const row of result.operators){row.applications=Object.fromEntries(applications.get(row.uid)??[]);row.observers=registered.get(row.uid)??[];}return result;};
};
configureCampaign({policy:'line-builder/v3'});
const standards={
 redeploy:['char_1045_svash2','char_172_svrash','char_206_gnosis','char_1028_texas2','char_4087_ines','char_263_skadi','char_174_slbell','char_385_finlpp'],
 workshop:['char_4072_ironmn','char_2023_ling','char_4051_akkord','char_2015_dusk','char_242_otter','char_181_flower','char_202_demkni','char_240_wyvern'],
 ammo:['char_1041_angel2','char_332_archet','char_128_plosis','char_103_angel','char_1034_jesca2','char_498_inside','char_202_demkni','char_401_elysm'],
};
const directors={redeploy:'director_svash2',workshop:'director_ironmn',ammo:'director_angel2'};
// e84939d21b's 60-run v3 snapshots: median leader star is 2 in all three
// lines at both day 5–6 and day 9–10. Keep the standard at that observed tier.
const standardStar=2;
const normal=ctx.design.encounters.encounters.filter(e=>e.kind==='normal'&&e.dayRange[0]===5);
const risk=ctx.design.encounters.encounters.filter(e=>e.kind==='risk'&&e.dayRange[0]===9);
if(normal.length!==3||risk.length!==3)throw Error('Expected native three-map day-band encounters');
const schedule=[{encounter:normal[0],day:5,hour:3},{encounter:normal[1],day:5,hour:6},{encounter:normal[2],day:6,hour:3},{encounter:risk[0],day:9,hour:6},{encounter:risk[1],day:10,hour:3}];
const startedAt=new Date().toISOString(),records=[];
const bodies=Object.values(ctx.runtime.bodies).sort((a,b)=>a.charId.localeCompare(b.charId));
const only=arg('--only');
for(const body of bodies.filter(b=>!args.includes('--only')||b.charId===only)){
 const record={charId:body.charId,name:body.name,line:body.adaptation.line,type:body.adaptation.type,passive:body.adaptation.passive===true,battles:[]};
 try{
  for(let index=0;index<schedule.length;index++){
   const {encounter,day,hour}=schedule[index],seed=20261101+index,directorId=directors[record.line];
   const state=createRun({runId:`p4-sample:${body.charId}:${index}`,seed,directorId},ctx);
   Object.assign(state,{pieces:[],xp:day<9?68:90,day,hour,phase:'battlePrep',prepEncounterId:encounter.id,
    currentNode:{id:encounter.id,kind:'battle',encounterId:encounter.id,battleKind:encounter.kind,name:encounter.name,rewards:encounter.rewards}});
   reportByRun.set(state.runId,{directorId,upgradeObservations:[]});
   const standard=standards[record.line];
   const slot=body.profession==='MEDIC'
     ?{redeploy:'char_385_finlpp',workshop:'char_181_flower',ammo:'char_128_plosis'}[record.line]
     :{redeploy:'char_263_skadi',workshop:'char_2015_dusk',ammo:'char_103_angel'}[record.line];
   // Replace a role slot. Truncating an appended ninth card used to silently
   // remove the line's only medic / DP producer from every non-standard sample.
   const ids=standard.includes(body.charId)?[body.charId,...standard.filter(id=>id!==body.charId)]
     :[body.charId,...standard.filter(id=>id!==slot)];
   for(const id of ids){
    const star=standardStar;
    const piece=addBodyToInventory(state,ctx,id,2**(star-1),{star,row:null,col:null});
    if(star>=3)piece.moduleChoices[id]=moduleForLine(state,piece,ctx,reportByRun).id;
   }
   const layout=candidatePlacements(state,encounter,state.pieces,5);
   if(!layout)throw Error('No standard formation');
   const ready=applyAction(layout.state,{type:'readyBattle',opId:`sample-ready:${index}`,expectedRevision:layout.state.revision},ctx).state;
   const outcome=ctx.settleBattle(ready,ready.currentBattle);
   if(outcome.diagnostics.errorCount)throw Error(`Native simulation errors: ${outcome.diagnostics.errorCount}`);
   record.battles.push({seed,day,hour,encounterId:encounter.id,prepared:ready.currentBattle,outcome});
  }
  record.status='complete';
 }catch(error){record.status='failed';record.error=String(error.stack||error);}
 const file=path.join(out,body.charId+'.json');fs.writeFileSync(file,JSON.stringify(record)+'\n');
 records.push({charId:record.charId,status:record.status,battles:record.battles.length,error:record.error,file});
 reportByRun.clear();
}
const result={schema:'assault-p4-typed-samples/v2',status:records.every(r=>r.status==='complete')?'complete':'failed',sourceCommit:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),baselineSourceCommit:batch.sourceCommit,
 basis:'all 172 cards in line-standard formations; five fixed native encounters each, including mandatory unpurchased-card coverage',
 formation:{leaderStar:standardStar,memberStar:standardStar,calibrationSource:'e84939d21b v3 snapshots; observed median at both sampled day bands in all three lines'},
 startedAt,finishedAt:new Date().toISOString(),schedule:schedule.map(({encounter,...x})=>({...x,encounterId:encounter.id})),cards:records.length,battles:records.reduce((n,r)=>n+r.battles,0),records};
fs.writeFileSync(path.join(out,'samples.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,cards:result.cards,battles:result.battles,failures:records.filter(r=>r.status!=='complete'),receipt:path.join(out,'samples.json')}));
if(result.status!=='complete')process.exitCode=1;

