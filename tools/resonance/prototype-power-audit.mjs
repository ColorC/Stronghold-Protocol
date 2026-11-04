import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const canonicalData='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const outputPath='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.omni/tmp/resonance/prototype-power-audit.json';
process.env.SP_DATA_DIR=canonicalData;
const [{getData},{getResonanceCatalog},{getResonanceField,runResonanceBattle,buildResonanceBattle,previewUnitStats},{prototypeSeason},{createSession,applyAction,validateSession},{canPlace}]=await Promise.all([
  import('../../server/data.js'),import('../../server/modes/resonance/catalog.js'),import('../../server/modes/resonance/battle.js'),import('../../shared/resonance/prototype-season.js'),import('../../server/modes/resonance/session.js'),import('../../server/match/board.js'),
]);
const {activePrototypeTraits}=await import('../../server/sim/content/resonance/prototype-meta.js');
const {COLS,ROWS}=await import('../../server/sim/constants.js');
const {GEO}=await import('../../shared/constants.js');
const {absoluteRangeKeys}=await import('../../server/sim/targeting.js');
const {dirFromDelta}=await import('../../server/sim/dir.js');
const controlledNoTrait=process.argv.includes('--traits-off')||process.env.SP_POWER_TRAITS_OFF==='1';
if((process.argv.includes('--batch')||process.argv.includes('--control-batch'))&&!process.env.SP_POWER_SAMPLE_CHILD){
  const startedAt=new Date().toISOString(),deadline=Date.now()+8*60*1000;
  const git=(args)=>spawnSync('git',args,{cwd:repoRoot,encoding:'utf8'});
  const base=git(['rev-parse','HEAD']);
  const dirty=git(['status','--short','--','tools/resonance/prototype-power-audit.mjs','server/sim/content/resonance/prototype-pacts.js','shared/resonance/prototype-season.js','test/resonance/prototype-season.test.js']);
  const control=process.argv.includes('--control-batch');
  const attempt={attemptKey:`${control?'legal-60-no-traits':'legal-60'}-${Date.now()}`,startedAt,status:'running',kind:control?'legal-60-one-star-trait-disabled-control':'legal-60-one-star-native-battle-batch',seed:741923,recording:false,
    catalogSnapshot:{seasonId:'resonance-set13-14.23',rulesVersion:3,sourcePath:'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native',traitMode:control?'active prototype trait catalog list suppressed for diagnostic control; same hero/support/round/map/battle engine':'normal active prototype traits'},
    nativeGitBase:base.stdout.trim(),dirtyOwnedPaths:dirty.stdout.trim().split(/\r?\n/).filter(Boolean),method:'Each natural prototype hero is bought through createSession/applyAction, paired with fixed one-star frontline+healer controls, placed via current native deployMap keys/canPlace+route scoring and applyAction(deploy), validated before actual round-12 runResonanceBattle. Every row stores hero role, source-start/base stats, actual battle stats, skills/attacks, taken, heals, kills, control applications and survival. The first normal-trait batch retains natural cross-trait confounds; the separate disabled-trait control suppresses only prototype trait tiers and is diagnostic, not a playable ruleset.',samples:[]};
  const write=()=>{let doc={schemaVersion:2,kind:'headless-runtime-power-audit',seasonId:'resonance-set13-14.23',rulesVersion:3,attempts:[]};if(fs.existsSync(outputPath)){const old=JSON.parse(fs.readFileSync(outputPath,'utf8'));doc=Array.isArray(old.attempts)?old:{...doc,attempts:[old]};}const existing=doc.attempts.findIndex((row)=>row.attemptKey===attempt.attemptKey);if(existing<0)doc.attempts.push(attempt);else doc.attempts[existing]=attempt;fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,`${JSON.stringify(doc,null,2)}\n`,'utf8');};
  write();
  try{
    for(let index=0;index<prototypeSeason.heroes.length;index++){
      if(Date.now()>=deadline)throw new Error(`DETERMINISTIC_BATCH_DEADLINE:${index}/60`);
      const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--sample-index=${index}`,...(control?['--traits-off']:[])],{cwd:repoRoot,encoding:'utf8',timeout:Math.max(1000,deadline-Date.now()),env:{...process.env,SP_POWER_SAMPLE_CHILD:'1',SP_POWER_TRAITS_OFF:control?'1':'0'},maxBuffer:16*1024*1024});
      if(child.error||child.status!==0)throw new Error(`SAMPLE_${index}_FAILED:${child.error?.message??child.stderr??child.status}`);
      attempt.samples.push(JSON.parse(child.stdout.trim()));
      if((index+1)%5===0)write();
    }
    attempt.status='complete';
  }catch(error){attempt.status='partial-failed';attempt.error=String(error?.message??error);}
  attempt.endedAt=new Date().toISOString();attempt.elapsedMs=Date.parse(attempt.endedAt)-Date.parse(startedAt);
  attempt.counts={heroesCompleted:attempt.samples.length,heroesExpected:prototypeSeason.heroes.length,errors:attempt.samples.reduce((n,row)=>n+(row.errors?.length??0),0),illegalPlacements:attempt.samples.reduce((n,row)=>n+(row.placements?.filter((p)=>p.legal!==true).length??0),0)};
  const groups=new Map();for(const sample of attempt.samples){const k=`${sample.hero.cost}:${sample.hero.role}`;const rows=groups.get(k)??[];rows.push({name:sample.hero.name,damage:sample.total.damage,healing:sample.total.healing,taken:sample.total.taken,shield:sample.total.shield,summonDamage:sample.total.summonDamage,casts:sample.total.casts,attacks:sample.total.attacks,kills:sample.total.kills,controlAppliedMs:sample.total.controlAppliedMs,survived:sample.total.survived,startStats:sample.heroStats});groups.set(k,rows);}
  attempt.sameCostRoleSamples=Object.fromEntries([...groups].map(([key,rows])=>[key,rows]));
  write();
  console.log(JSON.stringify({outputPath,attemptKey:attempt.attemptKey,status:attempt.status,startedAt,endedAt:attempt.endedAt,elapsedMs:attempt.elapsedMs,counts:attempt.counts}));
  process.exitCode=attempt.status==='complete'?0:1;
  process.exit();
}
const data=getData({dir:canonicalData});
const seed=741923;
const baseCatalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed});
const catalog=controlledNoTrait?{...baseCatalog,prototypeSeason:{...baseCatalog.prototypeSeason,traits:[]}}:baseCatalog;
const signatureProbe=process.argv.includes('--signature');
const sampleIndexArg=process.argv.find((arg)=>arg.startsWith('--sample-index='));
const sampleIndex=sampleIndexArg?Number(sampleIndexArg.split('=')[1]):-1;
const heroApiArg=process.argv.find((arg)=>arg.startsWith('--hero-api='))?.slice('--hero-api='.length);
const requestedStar=Number(process.argv.find((arg)=>arg.startsWith('--star='))?.split('=')[1]??1);
const exposureTargetCount=Number(process.argv.find((arg)=>arg.startsWith('--fixed-exposure='))?.split('=')[1]??0);
const exposureSeconds=Number(process.argv.find((arg)=>arg.startsWith('--fixed-exposure-seconds='))?.split('=')[1]??60);
const heroesForSample=sampleIndex>=0?[
  prototypeSeason.heroes[sampleIndex],
  prototypeSeason.heroes.find((hero)=>hero.role==='frontline'&&hero.apiName!==prototypeSeason.heroes[sampleIndex]?.apiName),
  prototypeSeason.heroes.find((hero)=>hero.role==='healer'&&hero.apiName!==prototypeSeason.heroes[sampleIndex]?.apiName),
]:null;
const selected=heroesForSample??(heroApiArg?[
  prototypeSeason.heroes.find((hero)=>hero.apiName===heroApiArg),
  prototypeSeason.heroes.find((hero)=>hero.role==='frontline'&&hero.apiName!==heroApiArg),
  prototypeSeason.heroes.find((hero)=>hero.role==='healer'&&hero.apiName!==heroApiArg),
]:signatureProbe?[
  prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Malzahar'),
  prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Lieutenant'),
  prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Shooter'),
]:[
  prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Irelia'),
  prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Lux'),
  prototypeSeason.heroes.find((hero)=>hero.apiName==='TFT13_Nocturne'),
]);
if(selected.some((hero)=>!hero))throw new Error('MISSING_PROBE_HERO');
const opened=createSession({seed,difficulty:'NORMAL',catalog});
if(!opened.ok)throw new Error(`CREATE_SESSION_FAILED:${opened.error}`);
let state=opened.state;
state.round=12;
state.level=10;state.gold=100;
const actionLog=[];
const apply=(action)=>{
  const result=applyAction(state,action,{catalog,recording:false,fieldResolver:(current)=>getResonanceField(current,{data,catalog})});
  if(!result.ok)throw new Error(`ACTION_${action.type}_FAILED:${result.error}`);
  state=result.state;actionLog.push({action,result:result.events});
  return result;
};
function ensurePiece(hero){
  const existing=state.pieces.find((piece)=>piece.operatorId===hero.sourceChessId);
  if(existing)return existing;
  if((state.poolRemaining[hero.sourceChessId]??0)<1)throw new Error(`POOL_EMPTY:${hero.sourceChessId}`);
  let offer=state.shop.offers.find((entry)=>entry.operatorId===hero.sourceChessId);
  if(!offer){
    const slot=state.shop.offers.find((entry)=>entry.operatorId);
    if(!slot)throw new Error('SHOP_HAS_NO_REPLACEABLE_OFFER');
    state.poolRemaining[slot.operatorId]++;
    state.poolRemaining[hero.sourceChessId]--;
    slot.operatorId=hero.sourceChessId;slot.cost=Number(catalog.operators[hero.sourceChessId].cost);
    offer=slot;
  }
  if(state.gold<Number(offer.cost))throw new Error(`INSUFFICIENT_PROBE_GOLD:${hero.sourceChessId}`);
  const result=apply({type:'buy',offerUid:offer.uid});
  const uid=result.events.find((event)=>event.type==='operator-bought')?.uid;
  const piece=state.pieces.find((entry)=>entry.uid===uid);
  if(!piece)throw new Error(`BOUGHT_PIECE_NOT_FOUND:${hero.sourceChessId}`);
  return piece;
}
const pieces=selected.map(ensurePiece);
function ensureStar(hero, targetStar) {
  let piece=state.pieces.find((row)=>row.operatorId===hero.sourceChessId);
  if(!piece)throw new Error(`STAR_TARGET_PIECE_MISSING:${hero.apiName}`);
  const buyCopy=()=>{
    let offer=state.shop.offers.find((entry)=>entry.operatorId===hero.sourceChessId);
    if(!offer){
      if(!state.shop.offers.some((entry)=>entry.operatorId))apply({type:'refresh'});
      const slot=state.shop.offers.find((entry)=>entry.operatorId);
      if(!slot)throw new Error(`NO_REPLACEABLE_OFFER_FOR_STAR:${hero.apiName}`);
      if((state.poolRemaining[hero.sourceChessId]??0)<1)throw new Error(`POOL_EMPTY_FOR_STAR:${hero.apiName}`);
      state.poolRemaining[slot.operatorId]++;
      state.poolRemaining[hero.sourceChessId]--;
      slot.operatorId=hero.sourceChessId;slot.cost=Number(catalog.operators[hero.sourceChessId].cost);
      offer=slot;
    }
    if(state.gold<Number(offer.cost))throw new Error(`INSUFFICIENT_STAR_UP_GOLD:${hero.apiName}`);
    apply({type:'buy',offerUid:offer.uid});
  };
  while(piece.star<targetStar){
    const currentStar=piece.star;
    const existing=state.pieces.filter((row)=>row.operatorId===hero.sourceChessId&&row.star===currentStar).length;
    const copiesNeeded=Math.max(1,3-existing);
    for(let i=0;i<copiesNeeded;i++)buyCopy();
    piece=state.pieces.find((row)=>row.operatorId===hero.sourceChessId&&row.star>currentStar)??piece;
    const current=state.pieces.filter((row)=>row.operatorId===hero.sourceChessId).reduce((best,row)=>row.star>best.star?row:best,piece);
    piece=current;
  }
  return piece;
}
if(sampleIndex<0&&heroApiArg){
  if(!Number.isInteger(requestedStar)||requestedStar<1||requestedStar>3)throw new Error(`BAD_REQUESTED_STAR:${requestedStar}`);
  pieces[0]=ensureStar(selected[0],requestedStar);
}
const field=getResonanceField(state,{data,catalog});
const map=field.deployMap;
if(!(map instanceof Map)||map.size===0)throw new Error('EMPTY_NATIVE_DEPLOY_MAP');
const routes=(field.wave?.routes??[]).filter((route)=>Array.isArray(route.start)&&Array.isArray(route.end));
if(!routes.length)throw new Error('NATIVE_WAVE_HAS_NO_ROUTES');
const routePoints=routes.flatMap((route)=>[route.start,...(route.checkpoints??[]),route.end]);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// row 0 is the bottom row: a larger row is UP (server/sim/dir.js)
const directionToward=(from,to)=>dirFromDelta(to[0]-from[0],to[1]-from[1]);
const occupied=new Set();
const placements=[];
const placementPreview=previewUnitStats(state,{data,catalog});
for(const piece of pieces){
  const operator=catalog.operators[piece.operatorId];
  const placementClass=operator.position==='MELEE'?(operator.canDeployHighGround===true?'all':'melee'):'ranged';
  const candidates=[...map.entries()].map(([key,tileClass])=>{
    const [row,col]=key.split(',').map(Number);
    const allowed=operator.position==='RANGED'||tileClass==='melee'||(tileClass==='ranged'&&operator.canDeployHighGround===true);
    if(!allowed||!canPlace(map,placementClass,row,col)||occupied.has(key))return null;
    const pos=[row,col];
    let nearest=routePoints[0],routeDistance=Infinity;
    for(const point of routePoints){const d=distance(pos,point);if(d<routeDistance){routeDistance=d;nearest=point;}}
    const rangeCells=exposureTargetCount>0&&piece.uid===pieces[0].uid
      ?absoluteRangeKeys(placementPreview[piece.uid]?.range??[[0,1]],row,col,'RIGHT').map((rangeKey)=>({row:Math.floor(rangeKey/COLS),col:rangeKey%COLS})).filter((cell)=>cell.row>=GEO.NORMAL_RECT.r0&&cell.row<=GEO.NORMAL_RECT.r1&&cell.col>=GEO.NORMAL_RECT.c0&&cell.col<=GEO.NORMAL_RECT.c1)
      :[];
    return {key,row,col,tileClass,routeDistance,nearest,startDistance:Math.min(...routes.map((route)=>distance(pos,route.start))),rangeCells};
  }).filter(Boolean).sort((a,b)=>a.routeDistance-b.routeDistance||a.startDistance-b.startDistance||a.row-b.row||a.col-b.col);
  const chosen=exposureTargetCount>0&&piece.uid===pieces[0].uid
    ?candidates.filter((candidate)=>candidate.rangeCells.length).sort((a,b)=>b.rangeCells.length-a.rangeCells.length||Math.min(...a.rangeCells.map((cell)=>Math.abs(Math.max(Math.abs(cell.row-a.row),Math.abs(cell.col-a.col))-2)))-Math.min(...b.rangeCells.map((cell)=>Math.abs(Math.max(Math.abs(cell.row-b.row),Math.abs(cell.col-b.col))-2)))||a.row-b.row||a.col-b.col)[0]
    :candidates[0];
  if(!chosen)throw new Error(`NO_LEGAL_ROUTE_CELL:${piece.operatorId}:${operator.position}`);
  const chosenDir=exposureTargetCount>0&&piece.uid===pieces[0].uid?'RIGHT':directionToward([chosen.row,chosen.col],chosen.nearest);
  apply({type:'deploy',pieceUid:piece.uid,row:chosen.row,col:chosen.col,dir:chosenDir});
  occupied.add(chosen.key);
  placements.push({uid:piece.uid,operatorId:piece.operatorId,position:operator.position,cell:chosen.key,tileClass:chosen.tileClass,legal:true,
    closestRoutePoint:chosen.nearest,routeDistance:chosen.routeDistance,dir:state.pieces.find((row)=>row.uid===piece.uid).dir,...(exposureTargetCount>0&&piece.uid===pieces[0].uid?{fixtureRangeCells:chosen.rangeCells}:{})});
}
const validation=validateSession(state,{catalog});
if(!validation.ok)throw new Error(`PLACED_SESSION_INVALID:${JSON.stringify(validation.errors)}`);
const postField=getResonanceField(state,{data,catalog});
for(const placement of placements){
  const piece=state.pieces.find((row)=>row.uid===placement.uid),operator=catalog.operators[piece.operatorId];
  const tile=postField.deployMap.get(placement.cell);
  if(tile!==placement.tileClass)throw new Error(`PLACEMENT_CELL_MISMATCH:${placement.cell}:${tile}`);
  const legal=operator.position==='RANGED'||tile==='melee'||(tile==='ranged'&&operator.canDeployHighGround===true);
  if(!legal)throw new Error(`PLACEMENT_CLASS_MISMATCH:${placement.uid}`);
}
let outcome,exposure=null;
  if(exposureTargetCount>0){
  if(![1,3].includes(exposureTargetCount))throw new Error(`FIXED_EXPOSURE_TARGET_COUNT_INVALID:${exposureTargetCount}`);
  const built=buildResonanceBattle(state,{data,catalog,recording:false,preview:true}),battle=built.battle;
  battle.autoFinish=false;battle.start();
  const suppressedWaveSpawns=Array.isArray(battle._pending)?battle._pending.length:0;
  if(!Array.isArray(battle._pending))throw new Error('FIXED_EXPOSURE_REQUIRES_NATIVE_SPAWN_QUEUE');
  battle._pending.length=0;
  battle.total=0;
  for(const player of battle.players??[]){if(Number.isFinite(player.total))player.total=0;}
  const heroUnit=battle.allyUnits.find((unit)=>String(unit.uid)===String(pieces[0].uid));
  if(!heroUnit)throw new Error('FIXED_EXPOSURE_HERO_NOT_DEPLOYED');
  const originRow=Math.round(heroUnit.y),originCol=Math.round(heroUnit.x);
  const rangeKeys=Array.isArray(heroUnit.rangeKeys)?heroUnit.rangeKeys.map((key)=>typeof key==='number'?key:Number(key?.r)*COLS+Number(key?.c)):[];
  if(!rangeKeys.length)throw new Error(`FIXED_EXPOSURE_ACTUAL_RANGE_EMPTY:${heroUnit.uid}:${JSON.stringify({rangeGrid:heroUnit.rangeGrid,liveRangeGrid:heroUnit.liveRangeGrid})}`);
  const rangeSet=new Set(rangeKeys);
  const rangeCells=[...rangeKeys].map((key)=>({key,row:Math.floor(Number(key)/COLS),col:Number(key)%COLS}))
    .filter((cell)=>Number.isInteger(cell.row)&&Number.isInteger(cell.col)&&cell.row>=battle.rect.r0&&cell.row<=battle.rect.r1&&cell.col>=battle.rect.c0&&cell.col<=battle.rect.c1&&cell.row<ROWS&&cell.col<COLS)
    .map((cell)=>({...cell,distance:Math.max(Math.abs(cell.row-originRow),Math.abs(cell.col-originCol))}))
    .filter((cell)=>cell.distance>0||(heroUnit.def?.attackKind==='melee'&&Number(heroUnit.s?.blockCnt)>0&&cell.key===heroUnit.tileR*COLS+heroUnit.tileC))
    .sort((a,b)=>Math.abs(a.distance-2)-Math.abs(b.distance-2)||a.distance-b.distance||a.row-b.row||a.col-b.col);
  const selectedCells=[];
  for(const cell of rangeCells){if(!selectedCells.some((other)=>other.key===cell.key))selectedCells.push(cell);if(selectedCells.length===exposureTargetCount)break;}
  if(selectedCells.length!==exposureTargetCount)throw new Error(`INSUFFICIENT_HERO_ATTACK_RANGE_CELLS:${selectedCells.length}/${exposureTargetCount}:${JSON.stringify({tileR:heroUnit.tileR,tileC:heroUnit.tileC,x:heroUnit.x,y:heroUnit.y,dir:heroUnit.dir,rangeGrid:heroUnit.rangeGrid,rangeKeys:heroUnit.rangeKeys,baseRangeKeys:heroUnit.baseRangeKeys,rect:battle.rect})}`);
  const targets=[];
  for(let index=0;index<exposureTargetCount;index++){
    const {row,col,distance}=selectedCells[index],key=`prototype-power-target-${index}`;
    const target=battle.spawnEnemy(key,{pos:[row,col],def:{key,name:'固定训练目标',rank:'NORMAL',applyWay:'RANGED',stats:{maxHp:1_000_000_000,atk:0,def:100,res:50,moveSpeed:0,bat:2,aspd:100,rangeRadius:0,blockCnt:1,massLevel:1,lpr:1,hpRecoveryPerSec:0,elementRes:0,elementDmgRes:0,dmgType:'phys',motion:'WALK',immunities:{},otherImmunities:[],tauntLevel:0},notCountInTotal:true,tags:[],abilities:[],talents:{bb:{}},skills:[]}});
    target.mem.prototypePowerFixtureTarget=true;
    target.mem.prototypePowerFixtureRangeDistance=distance;
    targets.push(target);
  }
  const outOfRangeTargets=targets.filter((target)=>!rangeSet.has(Math.round(target.y)*COLS+Math.round(target.x)));
  if(outOfRangeTargets.length)throw new Error(`FIXED_EXPOSURE_TARGET_OUTSIDE_ACTUAL_ATTACK_RANGE:${JSON.stringify(outOfRangeTargets.map((target)=>({x:target.x,y:target.y})))}:${JSON.stringify(rangeKeys)}`);
  let nextPressure=1,pressureEvents=0;const exposureDamageEvents=[],exposureSnapshots=[],heroEvents={attacks:0,casts:0};
  battle.on('attack',(event)=>{if(String(event?.attacker?.uid)===String(heroUnit.uid))heroEvents.attacks++;},{owner:battle});
  battle.on('skillStart',(event)=>{if(String(event?.unit?.uid)===String(heroUnit.uid))heroEvents.casts++;},{owner:battle});
  battle.on('damaged',(event)=>{
    if(event?.source?.side==='ally'&&event?.target?.mem?.prototypePowerFixtureTarget===true)exposureDamageEvents.push({sourceUid:event.source.uid??null,targetId:event.target.id,targetKey:event.target.defId??null,dealt:Number(event.dealt??0),type:event.type??null});
  },{owner:battle});
  battle.on('tick',()=>{
    if(battle.time+1e-9<nextPressure)return;
    nextPressure++;
    const live=targets[0];if(!live?.alive||!heroUnit.alive)return;
    battle.dealDamage(live,heroUnit,{amount:10,type:'phys',canDodge:false,tags:['prototype-power-fixed-pressure']});pressureEvents++;
  },{owner:battle});
  let nextSnapshot=Math.min(15,exposureSeconds);
  const maxSeconds=exposureSeconds,steps=Math.ceil(maxSeconds/Math.max(0.001,battle.dt));
  for(let index=0;index<steps&&!battle.finished;index++){
    battle.step();
    if(battle.time+1e-9>=nextSnapshot){
      const contribution=(battle.resonanceContributions??[]).find((row)=>String(row.uid)===String(heroUnit.uid))??{};
      const current={damage:exposureDamageEvents.reduce((sum,event)=>sum+event.dealt,0),healing:Number(contribution.healing??0),shieldAbsorbed:Number(contribution.shieldAbsorbed??0),casts:heroEvents.casts,attacks:heroEvents.attacks,hp:Number(heroUnit.hp??0),maxHp:Number(heroUnit.s?.maxHp??0),alive:!!heroUnit.alive,
        targets:targets.map((target)=>({id:target.id,hp:Number(target.hp??0),alive:!!target.alive}))};
      exposureSnapshots.push({seconds:nextSnapshot,...current});
      nextSnapshot+=nextSnapshot===15?30:15;
    }
  }
  const actualSeconds=battle.time;
  if(!battle.finished)battle.forceEnd('forced');
  const result=battle.result(),playerResult=result.perPlayer?.resonance??Object.values(result.perPlayer??{})[0]??{};
  const units=(playerResult.unitStats??[]).map((unit)=>({uid:unit.uid,defId:unit.defId,kind:unit.kind,dmg:Number(unit.dmg??0),heal:Number(unit.heal??0),taken:Number(unit.taken??0),kills:Number(unit.kills??0),attacks:Number(unit.attacks??0)}));
  const survivors=battle.allyUnits.filter((unit)=>unit?.kind==='op'&&unit.alive&&!unit.removed).map((unit)=>({uid:unit.uid,charId:catalog.operators[state.pieces.find((row)=>String(row.uid)===String(unit.uid))?.operatorId]?.charId??null,alive:true,hpPct:unit.hpRatio}));
  outcome={won:false,result,combatStats:{units},contributions:battle.resonanceContributions??[],survivors,metrics:battle.resonanceMetrics??{},diagnostics:{errors:battle.errors??[],errorCount:battle.errorCount}};
  exposure={kind:'fixed-exposure-mechanic-fixture',notNaturalCampaign:true,waveSuppressed:true,suppressedWaveSpawns,seconds:actualSeconds,targetCount:exposureTargetCount,heroAttackOrigin:{row:originRow,col:originCol,dir:heroUnit.dir},actualRangeSource:'deployed Battle unit.rangeKeys after Battle._refreshRange',actualRangeCells:rangeKeys.map((key)=>({row:Math.floor(key/COLS),col:key%COLS})),targetStats:{hp:1_000_000_000,armor:100,resistance:50,movement:0},targetCells:targets.map((target)=>({row:Math.round(target.y),col:Math.round(target.x),rangeDistance:target.mem.prototypePowerFixtureRangeDistance,contactMode:target.mem.prototypePowerFixtureRangeDistance===0?'melee-contact-on-own-rangeKey':'in-range-tile',inAttackRange:rangeSet.has(Math.round(target.y)*COLS+Math.round(target.x))})),incomingPressure:{source:'Native Battle dealDamage pulse, fixture-only',amount:10,intervalSeconds:1,pulses:pressureEvents},snapshots:exposureSnapshots,targetsRemaining:battle.enemies.filter((enemy)=>enemy.mem?.prototypePowerFixtureTarget).map((target)=>({id:target.id,hp:target.hp,maxHp:target.s.maxHp})),damageEvents:exposureDamageEvents,seed};
}else outcome=runResonanceBattle(state,{data,catalog,recording:false});
const statsPreview=previewUnitStats(state,{data,catalog});
const heroUnit=outcome.combatStats?.units?.find((row)=>String(row.uid)===String(pieces[0].uid));
const heroContribution=(outcome.contributions??[]).find((row)=>row.charId===selected[0].charId)??{};
const heroOperator=catalog.operators[pieces[0].operatorId];
const heroSurvivor=(outcome.survivors??[]).find((row)=>String(row.uid)===String(pieces[0].uid));
const sample={hero:{apiName:selected[0].apiName,name:selected[0].operatorName??selected[0].name??selected[0].apiName,charId:selected[0].charId,cost:selected[0].cost,role:selected[0].role,star:state.pieces.find((row)=>row.uid===pieces[0].uid)?.star??pieces[0].star,currentFeeAdjustment:heroOperator.currentFeeAdjustment??null},supports:selected.slice(1).map((hero)=>({apiName:hero.apiName,name:hero.operatorName??hero.name??hero.apiName,charId:hero.charId,cost:hero.cost,role:hero.role})),
  activeTraits:activePrototypeTraits(state,catalog).map(({id,tier,count,members})=>({id,tier,count,members})),seed,difficulty:state.difficulty,round:state.round,node:{stageId:postField.stageId,field:postField.field,waveRound:postField.waveRound},
  legalMapCells:[...postField.deployMap.keys()],routeStarts:routes.map((route)=>route.start),routeEnds:routes.map((route)=>route.end),
  placements,actions:actionLog,sessionValid:validation.ok,won:outcome.won,reason:outcome.result.reason,time:outcome.result.time,
  startStats:statsPreview,heroKit:{sourceChessId:heroOperator.id,role:heroOperator.role,position:heroOperator.position,fixedSkillId:heroOperator.fixedSkillId,currentFeeAdjustment:heroOperator.currentFeeAdjustment??null,sourceNativeStats:heroOperator.source?.stats??null,sourceNativeSkill:heroOperator.source?.skill??null},
  units:outcome.combatStats?.units??[],contributions:outcome.contributions,survivors:outcome.survivors??[],metrics:outcome.metrics,errors:outcome.diagnostics.errors,
  heroStats:statsPreview[pieces[0].uid]??null,heroCombat:heroUnit??null,heroContribution,
  ...(exposure?{exposure}:{}),
  total:{damage:Number(heroUnit?.dmg??0),healing:Number(heroUnit?.heal??0),taken:Number(heroUnit?.taken??0),shield:Number(heroContribution.shieldAbsorbed??0),shieldLayersBroken:Number(heroContribution.shieldLayersBroken??0),summonDamage:Number(heroContribution.summonDamage??0),casts:Number(heroContribution.skills??0),controlAppliedMs:heroContribution.controlAppliedMs??null,controlApplications:heroContribution.controlApplications??null,kills:Number(heroUnit?.kills??0),attacks:Number(heroUnit?.attacks??0),survived:!!heroSurvivor}};
if(process.env.SP_POWER_SAMPLE_CHILD){console.log(JSON.stringify(sample));process.exit(0);}
const newAttempt={attemptKey:`${heroApiArg?(exposure?'fixed-exposure':'star-boundary'):'legal'}-probe-${Date.now()}`,startedAt:new Date().toISOString(),status:heroApiArg?(exposure?'single-sample-legal-fixed-exposure-mechanic-probe':'single-sample-legal-star-boundary-probe'):signatureProbe?'single-sample-signature-trigger-probe':'single-sample-legal-placement-probe',
  priorPowerAttemptsInvalidatedForBalance:true,invalidReason:'Historical power attempts hardcoded cells outside the native deploy map and did not use applyAction(deploy); they remain archival only.',
  node:'NORMAL round 12 native regular wave',recording:false,validationMethod:'createSession + native getResonanceField(map.keys) + canPlace + session applyAction(deploy) + validateSession before runResonanceBattle',sample};
fs.mkdirSync(path.dirname(outputPath),{recursive:true});
let previous={schemaVersion:1,kind:'headless-runtime-power-sample',seasonId:prototypeSeason.id,rulesVersion:3,attempts:[]};
if(fs.existsSync(outputPath)){
  const existing=JSON.parse(fs.readFileSync(outputPath,'utf8'));
  previous=Array.isArray(existing.attempts)?existing:{schemaVersion:1,kind:existing.kind??'headless-runtime-power-sample',seasonId:existing.seasonId??prototypeSeason.id,rulesVersion:existing.rulesVersion??3,attempts:[existing]};
}
previous.attempts.push(newAttempt);
fs.writeFileSync(outputPath,`${JSON.stringify(previous,null,2)}\n`,'utf8');
console.log(JSON.stringify({outputPath,attemptKey:newAttempt.attemptKey,status:newAttempt.status,sessionValid:validation.ok,
  stageId:postField.stageId,legalMapCells:postField.deployMap.size,placements,actions:actionLog.length,errors:outcome.diagnostics.errors.length}));
