import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Battle} from '../../server/sim/Battle.js';
import {DataSource,getDefaultSource} from '../../server/sim/simdata.js';
import {getData} from '../../server/data.js';
import {getAssaultData} from '../../server/modes/assault/data.js';
import {assaultKits} from '../../server/sim/content/assault/cards/registry.js';
import {makeChessRecords} from '../../shared/assault/battle-input.js';
import {toAssaultSimData} from '../../shared/assault/catalog.js';
import {flatStage,flatRoutes,enemyRec} from '../../test/helpers/battleHarness.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const runtime=JSON.parse(fs.readFileSync(path.join(root,'data/assault-runtime.json'),'utf8'));
const output=process.env.SP_SKILL_PROBE_OUTPUT;
if(!output||!path.isAbsolute(output))throw new Error('SP_SKILL_PROBE_OUTPUT must be an explicit absolute registered runtime path');
const quiet={warn(){},error(){},info(){},log(){}};
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();
const data=toAssaultSimData(runtime,getAssaultData({nativeData:getData({dir:process.env.SP_DATA_DIR,log:quiet}),runtime}).nativeData);
const rows=[];
for(const body of Object.values(runtime.bodies).filter(body=>!process.env.SP_SKILL_PROBE_ID||body.charId===process.env.SP_SKILL_PROBE_ID))for(const star of [1,2,3,4]){
 const modules=[null,...body.modulePlans.filter(m=>m.type==='ADVANCED'&&star>=3).map(m=>m.id)];
 for(const moduleId of modules){
  const row={id:body.charId,star,moduleId,status:'error'};
  try{
   const piece=(charId,uid)=>({charId,uid,star,moduleId:uid==='actor'?moduleId:null,moduleChoices:{},sourceCopies:1,
    permanentFlat:{},permanentPercent:{},claimed:[],tagEdits:{add:[],remove:[]},dir:'E',row:10,col:uid==='actor'?5:6});
   const buddyId=body.charId==='char_181_flower'?'char_240_wyvern':'char_181_flower';
   const built=makeChessRecords(runtime,[piece(body.charId,'actor'),piece(buddyId,'buddy')],[],{});
   const victim=enemyRec({key:'probe-victim',hp:1e8,atk:0,def:0,res:0,speed:0});
   const ds=new DataSource({chess:built.chess,tokens:data.tokens,enemies:{...data.enemies,'probe-victim':victim}},getDefaultSource());
   const b=new Battle({kind:'normal',modeId:'assault-skill-repair',stage:flatStage(),routes:flatRoutes(),spawns:[],data:ds,
    players:[{playerId:'isolated-probe',seat:0,side:'L',units:built.units}],content:'assault',
    assault:{kits:{...assaultKits},strict:true},flags:{dpInit:999,dpMax:999,dpPerSec:0,startOpCooldown:0},
    autoFinish:false,timeLimit:120,recordEvents:false,quiet:true,logger:quiet});
   // deployment effects settle before the stakes are placed (见行者 would push them out of range otherwise)
   b.start();b.assaultRuntime.flush();const u=b.allyUnits.find(u=>u.uid==='actor'),buddy=b.allyUnits.find(u=>u.uid==='buddy');
   if(!u||!buddy)throw new Error('Native deployment missing actor/buddy');
   const nativeSpType=u.skill.spType;u.skill.spType='none';buddy.skill.spType='none';
   u.skill.setSpTotal(0);buddy.skill.setSpTotal(0);
   const inRange=[...u.rangeKeys].map(k=>[Math.floor(k/21),k%21]).filter(([r,c])=>b.grid.inRect(r,c));
   const needsFreeFront=['char_108_silent','char_1033_swire2','char_393_toledo'].includes(body.charId);
   if(needsFreeFront)b.relocate(buddy,11,6);
   else if(!u.rangeKeys.includes(buddy.tileR*21+buddy.tileC))for(const [r,c]of inRange)if(b.relocate(buddy,r,c))break;
   const positions=[...inRange.filter(([r,c])=>!needsFreeFront||r!==u.tileR||c!==u.tileC+1).slice(0,3),[u.tileR,u.tileC],[buddy.tileR,buddy.tileC]];
   for(const pos of positions)b.spawnEnemy('probe-victim',{routeIndex:0,pos});
   const player=b._pp(u.ownerId);if(player)player.coins=99;
   b.step();u.hp=u.s.maxHp*.25;buddy.hp=buddy.s.maxHp*.25;
   if(body.fixedSkill.kind==='passive'){
    row.status=b.errors.length?'error':'passive-installed';row.errors=b.errors;
   }else{
    if(nativeSpType!=='time')throw new Error('Active skill does not naturally recover');
    const before=Number(u.skill.activations??0),hpBefore=b.enemies.reduce((n,e)=>n+e.hp,0),friendBefore=u.hp+buddy.hp;
    u.skill.setSpTotal(u.skill.spCost);
    const canCast=typeof u.skill.spec.canCast!=='function'||u.skill.spec.canCast(u.skill._ctx({reason:'ready',force:false}));
    // a skill that fires when its owner is attacked with full SP (蒂比): one enemy attack is its natural cast
    const castOnHit=['char_4191_tippi'].includes(body.charId);
    let cast;
    if(castOnHit){for(let i=0;i<2400&&u.s.flags.liftoff;i++)b.step(); // ground enemies cannot hit her while she is lifted off (deploy line)
      u.skill.setSpTotal(u.skill.spCost);const attacker=b.enemies.find(e=>e.alive);b.dealDamage(attacker,u,{amount:1,type:'phys',isAttack:true});b.assaultRuntime.flush();cast=Number(u.skill.activations??0)>before;}
    else{cast=b.assaultRuntime.cast(u,{force:false});b.assaultRuntime.flush();}
    row.cast=cast;row.canCast=!!canCast;row.activationDelta=Number(u.skill.activations??0)-before;
    row.enemyDamage=hpBefore-b.enemies.reduce((n,e)=>n+e.hp,0);row.healDelta=u.hp+buddy.hp-friendBefore;
    row.status=cast&&row.activationDelta>0&&!u.skill.active&&!b.errors.length?'cast-passed':'failed';
    // the old card's guard snapshot; the synergy card is tested line by line in its own suite
    if(body.charId==='char_393_toledo'&&body.bazaar?.format!=='synergy'&&cast){
      const guard=b.allyUnits.find(t=>t.kind==='token'&&t.ownerUnit===u&&t.alive);
      const grant=guard?.buffs.find(buff=>buff.key===`toledo:${u.uid}:guard-snapshot`);
      row.guardSnapshot={atk:guard?.s.atk,multiplier:grant?.mods.atkMul,casterWindow:u.mem.latestToledoUntil??null,
        units:b.allyUnits.map(t=>({uid:t.uid,kind:t.kind,defId:t.defId,owner:t.ownerUnit?.uid,alive:t.alive,buffs:t.buffs.map(f=>({key:f.key,mods:f.mods}))}))};
      if(grant?.mods.atkMul!==body.fixedSkill.effects[0].values.summonAtkMultiplier[star-1]||u.mem.latestToledoUntil!=null)row.status='failed';
    }
    row.spCost=u.skill.spCost;row.maxCharges=u.skill.maxCharges;
    row.battleErrors=b.errors.slice(0,2);
    // Observe one cast through subsequent ordinary attacks; repeat activation
    // and targeted causal assertions live in the dedicated regression suites.
    u.skill.spType='none';for(let i=0;i<90&&!b.finished;i++)b.step();
    if(b.errors.length){row.status='failed';row.battleErrors=b.errors.slice(0,2);}
    row.casterActiveAfter=u.skill.active;
   }
  }catch(error){row.error=String(error.stack??error).slice(0,1500);}
  rows.push(row);
 }
}
const failures=rows.filter(row=>!['cast-passed','passive-installed'].includes(row.status));
const report={schema:'assault-skill-repair-probe/v1',status:failures.length?'fail':'pass',createdAt:new Date().toISOString(),
 runtime:path.join(root,'data/assault-runtime.json'),sourceCommit:git('rev-parse','HEAD'),sourceClean:!git('status','--porcelain','--untracked-files=normal'),
 compiledFromCommit:runtime.contentSourceRevision,engineRevision:runtime.engineRevision,
 counts:{forms:new Set(rows.map(r=>r.id)).size,baseline:rows.filter(r=>r.moduleId==null).length,cases:rows.length,
  passed:rows.length-failures.length,failed:failures.length},playerReads:0,playerWrites:0,
 scope:'Native Battle with normal toAssaultSimData(runtime,nativeData) tokens, actual normal compiled DTO, all four stars and all advanced modules at stars three/four; legal SP_FULL casts with force:false. Cast success alone does not establish balance or every effect.',rows};
if(fs.existsSync(output)){
 const previous=JSON.parse(fs.readFileSync(output,'utf8'));
 report.previousAttempts=[...(previous.previousAttempts??[]),{createdAt:previous.createdAt,status:previous.status,counts:previous.counts,
  failures:previous.rows.filter(r=>!['cast-passed','passive-installed'].includes(r.status)).map(r=>({id:r.id,star:r.star,moduleId:r.moduleId,error:r.error?.split('\n')[0]??r.status}))}];
}
fs.writeFileSync(output,JSON.stringify(report)+'\n');
console.log(JSON.stringify({status:report.status,counts:report.counts,output,failures:failures.map(r=>({id:r.id,star:r.star,moduleId:r.moduleId,status:r.status,error:r.error?.split('\n')[0]}))}));
if(failures.length)process.exitCode=1;
