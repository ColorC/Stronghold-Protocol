import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const runtime=JSON.parse(fs.readFileSync(source+'/data/assault-runtime.json'));
const linkKinds=JSON.parse(fs.readFileSync(source+'/tools/assault/line-builds.json')).acceptanceLinks??{};
const argv=process.argv.slice(2),arg=k=>argv[argv.indexOf(k)+1];
const batchDir=arg('--batch-dir'),sampleDir=arg('--sample-dir'),out=arg('--out');
if(![batchDir,sampleDir,out].every(p=>p&&path.isAbsolute(p)))throw Error('Absolute --batch-dir --sample-dir --out required');
const batch=JSON.parse(fs.readFileSync(path.join(batchDir,'batch.json'))),samples=JSON.parse(fs.readFileSync(path.join(sampleDir,'samples.json')));
if(batch.status!=='complete'||samples.status!=='complete')throw Error('Completed P4.2 and P4.3 samples required');
const rows=new Map(Object.values(runtime.bodies).map(b=>[b.charId,{charId:b.charId,name:b.name,type:b.adaptation.passive?'passive':b.adaptation.type,tier:b.adaptation.tempo?.tier,sourceSkillId:b.adaptation.sourceSkillId,sourceTalentId:b.adaptation.sourceTalentId,records:[]} ]));
const mainKey=key=>!/^adaptation:module:|module-watch:|adaptation:native-end:|^view:/.test(String(key));
function add(charId,battle,ledger,evidence,origin){
 if(!ledger||!(ledger.aliveSeconds>0))return;
 const counters=(evidence?.counters??[]).filter(c=>mainKey(c.key));
 const moduleMax=(evidence?.counters??[]).filter(c=>!mainKey(c.key)).reduce((n,c)=>n+c.emitted,0);
 const linkEffects=evidence?.linkEffects??[];
 // An indexed event link has its own earned/proc evidence. A separate native
 // stat buff must not disguise that link's missing reward or rare condition.
 const unindexedLinkEffects=counters.length?[]:linkEffects;
 const mainApplications=Math.max(unindexedLinkEffects.length,evidence?.applications?Object.entries(evidence.applications).filter(([k])=>mainKey(k)).reduce((n,[,v])=>n+v,0):Math.max(0,ledger.triggers-moduleMax));
 const accepted=(evidence?.acceptedObservers??[]).filter(mainKey);
 const conditionKnown=counters.length>0||accepted.length>0||unindexedLinkEffects.length>0;
 // "Every N" is a qualifying condition only after N events accrued. Seeing
 // the first of eight events does not yet mean an earned proc was lost.
 const condition=counters.some(c=>c.rewards>0)||accepted.length>0||mainApplications>0;
 const produced=['damage','healing','shieldHp','shieldLayers','chargeGiven','hasteSeconds','triggers'].some(k=>ledger[k]>0);
 rows.get(charId).records.push({origin,seed:battle.seed??null,day:battle.day,hour:battle.hour,encounterId:battle.encounterId,
  aliveSeconds:ledger.aliveSeconds,casts:ledger.casts,stateEntered:evidence?.stateEntered===true,produced,
  auraBeneficiaries:evidence?.auraBeneficiaries?.length??0,conditionKnown,condition,mainApplications,
  counters:counters.map(c=>({key:c.key,counted:c.counted,emitted:c.emitted})),acceptedObservers:accepted,linkEffects});
}
for(const file of fs.readdirSync(batchDir).filter(f=>/^v3-director_.+-\d+\.json$/.test(f))){
 const record=JSON.parse(fs.readFileSync(path.join(batchDir,file)));
 if(record.status!=='complete')throw Error('Invalid v3 run '+file);
 for(const battle of record.run.battles)for(const op of battle.ledger.operators)add(op.charId,{...battle,seed:record.seed},op,battle.evidence?.operators?.find(x=>x.uid===op.uid),'campaign');
}
for(const sample of samples.records){
 const record=JSON.parse(fs.readFileSync(sample.file));
 if(record.battles.length!==5)throw Error('Five fixed samples required '+record.charId);
 for(const battle of record.battles){const op=battle.outcome.ledger.operators.find(x=>x.charId===record.charId);add(record.charId,battle,op,battle.outcome.battleEvidence?.operators?.find(x=>x.uid===op?.uid),'single-card');}
}
const cards=[];
for(const result of rows.values()){
 const plan=runtime.bodies[result.charId].adaptation,records=result.records,fields=records.length,failures=[];
 const ratio=(n,d)=>d?n/d:0;
 result.fields=fields;result.campaignFields=records.filter(r=>r.origin==='campaign').length;result.sampleFields=records.filter(r=>r.origin==='single-card').length;
 if(result.type==='passive'){
  const produced=records.filter(r=>r.produced).length;result.passive={produced,fields,rate:ratio(produced,fields),threshold:.9};
  if(result.passive.rate<.9)failures.push('被动账本产出不足90%');
 }else if(result.type==='C'){
  const entered=records.filter(r=>r.stateEntered).length;result.state={entered,fields,rate:ratio(entered,fields),threshold:.9};
  if(result.state.rate<.9)failures.push('本场状态进入率不足90%');
 }else{
  const eligible=records.filter(r=>r.aliveSeconds+1e-6>=40),casts=eligible.reduce((n,r)=>n+r.casts,0),threshold=result.tier==='fast'?3:2;
  result.active={eligibleBattles:eligible.length,casts,mean:eligible.length?casts/eligible.length:null,threshold};
  if(!eligible.length)failures.push('无在场40秒的有效主动样本');else if(result.active.mean<threshold)failures.push(`主动均值${result.active.mean.toFixed(3)}低于${threshold}`);
 }
 const linkKind=linkKinds[result.charId];
 if(linkKind){if(linkKind.kind!=='aura'||!plan.roles.includes('aura'))throw Error('Invalid audited aura '+result.charId);result.linkMetric={...linkKind};}
 if(!linkKind&&(plan.consumes.length||records.some(r=>r.counters.length)||/友军.*(?:累计|闪避|受击|命中|首次)|相邻.*(?:未受|闪避)|部署时.*(?:未部署|随机)|自身治疗的目标/.test(plan.lines.slice(1).join('')))){
  const known=records.filter(r=>r.conditionKnown),unknown=records.filter(r=>!r.conditionKnown),opportunities=records.filter(r=>r.condition),applied=opportunities.filter(r=>r.mainApplications>0);
  const appliedAll=records.filter(r=>r.mainApplications>0).length;
  const lowerBound=ratio(appliedAll,fields),occurrence=ratio(opportunities.length,fields),conditional=ratio(applied.length,opportunities.length);
  const proven=unknown.length===0||lowerBound>=.8;
  result.trigger={knownBattles:known.length,unmeasuredBattles:unknown.length,conditionBattles:opportunities.length,actualBattles:applied.length,fields,occurrenceRate:occurrence,conditionalRate:conditional,allBattleLowerBound:lowerBound,proven};
  if(!proven)failures.push('扳机条件证据不足，需定向核验');
  else if(occurrence<.2)failures.push('死线：条件出现率低于20%');
  else if(conditional<.8)failures.push('有条件场次实际触发不足80%');
 }
 if(plan.roles.includes('aura')){
  const benefited=records.filter(r=>r.auraBeneficiaries>0).length;
  result.aura={benefited,fields,rate:ratio(benefited,fields),threshold:.9};
  if(result.aura.rate<.9)failures.push('光环有受益者的场次不足90%');
 }
 if(!fields)failures.push('未实际上场');
 result.failures=failures;result.status=failures.length?'not-passed':'pass';cards.push(result);
}
const comparison=batch.comparison;
const clears=comparison.map(row=>row.v3.clears),normalWins=comparison.reduce((n,row)=>n+row.v3.normalWins,0),normalBattles=comparison.reduce((n,row)=>n+row.v3.normalBattles,0);
const victory={clearsAtLeast5:clears.every(n=>n>=5),noneBelow3:clears.every(n=>n>=3),spreadAtMost3:Math.max(...clears)-Math.min(...clears)<=3,normalWinRate:normalWins/normalBattles,normalAtLeast90:normalWins/normalBattles>=.9};
const result={schema:'assault-p4-typed-acceptance/v1',status:cards.every(c=>c.status==='pass')&&Object.values(victory).every(v=>typeof v!=='boolean'||v)?'pass':'not-passed',
 sourceCommit:samples.sourceCommit,batchSourceCommit:batch.sourceCommit,checkedAt:new Date().toISOString(),coverage:{cards:cards.length,sampled:samples.cards,fixedSampleBattles:samples.battles,campaignEntered:cards.filter(c=>c.campaignFields).length},
 comparison,victory,failedCards:cards.filter(c=>c.status!=='pass').map(({charId,name,type,failures,active,state,passive,trigger,aura})=>({charId,name,type,failures,active,state,passive,trigger,aura})),cards};
fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,coverage:result.coverage,victory,failed:result.failedCards.length,failedCards:result.failedCards.map(c=>({id:c.charId,name:c.name,why:c.failures})),receipt:out}));


