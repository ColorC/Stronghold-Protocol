// Causal regression against saved real inputs: an idle rear guard must engage
// after the test player's route fix, without any card or simulator changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {ctx,configureCampaign,candidatePlacements,reportByRun} from './campaign-player.mjs';
import {createRun} from '../../shared/assault/run.js';
const [baselineFile,out]=process.argv.slice(2);
if(!baselineFile||!out)throw Error('Expected baseline card receipt and output paths');
const input=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
assert.equal(input.charId,'char_290_vigna');assert.equal(input.battles.length,5);
configureCampaign({policy:'line-builder/v3'});
const comparisons=[];
for(const sample of input.battles){
 const before=ctx.settleBattle({},sample.prepared);
 const state=createRun({runId:`position-check:${sample.seed}`,seed:sample.seed,directorId:'director_svash2'},ctx);
 Object.assign(state,sample.prepared.input,{runId:state.runId,revision:0,rngState:sample.prepared.seed,phase:'battlePrep',xp:68,
  currentNode:{kind:'battle',encounterId:sample.encounterId},prepEncounterId:sample.encounterId});
 reportByRun.set(state.runId,{directorId:'director_svash2'});
 const immutable=JSON.stringify(state);
 const layout=candidatePlacements(state,sample.prepared.encounter,state.pieces,1);
 assert.equal(JSON.stringify(state),immutable);
 const after=ctx.settleBattle({},ctx.prepareBattle(layout.state,sample.encounterId));
 const row=r=>r.ledger.operators.find(o=>o.charId===input.charId);
 assert.equal(row(before).casts,0);assert.equal(row(before).damage,0);
 assert(row(after).casts>=2);assert(row(after).damage>0);
 assert.equal(before.diagnostics.errorCount+after.diagnostics.errorCount,0);
 comparisons.push({seed:sample.seed,encounterId:sample.encounterId,before:row(before),after:row(after)});
}
const result={status:'pass',gameChanged:false,cardChanged:false,comparisons};
fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,seeds:comparisons.length,casts:comparisons.map(c=>[c.before.casts,c.after.casts]),receipt:out}));
