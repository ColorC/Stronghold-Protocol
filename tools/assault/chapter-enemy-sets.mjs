// Chapter rosters are read from pinned native level SPAWN actions, not from
// Alliance's ten round templates. Only PVE budgets/timing/routes are adapted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const REVISION='17759cc8cdf37388414145d16262a3a06f3ab25e';
export const SOURCE_ROOT='E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights';
export const CHAPTER_LEVELS=[
 ['01-02','01-05','01-07','02-01','02-03','02-05'],
 ['02-07','02-08','03-03','03-04','03-07','03-08'],
 ['04-03','04-04','04-07','04-08','05-03','05-05'],
 ['05-07','05-09','06-05','06-08','06-11','06-14'],
 ['07-05','07-09','07-13','07-16','07-15','07-14'],
];
// Enemy tuning. Strength follows the original single-player ultimate difficulty (ABYSS): attack = native x
// 1.1^k and HP = native x 1.2^k, k rising round by round (original R1..R14 = 1,2,2,2,2,3,3,3,3,4,5,5,6,7;
// docs/research/01-core-rules.md). Our ten days map onto R1..R13 and the final onto R14. Two global constants
// (C.atk, C.hp) compensate for the player's x5 HP; they are the only knobs of the strength curve. The player's
// side is never touched. Count, spawn span and speed are separate curves.
export const ENEMY_TUNING=Object.freeze({
 schema:'assault-enemy-tuning/v2',
 atkBase:1.1,
 hpBase:1.2,
 C:Object.freeze({atk:2.74,hp:1.57}),
 // k per day (index 0 = day 1); fights of that day use it, a risk fight uses k + riskExtraK
 dayK:Object.freeze([1,2,2,2,3,3,3,4,5,6]),
 finalK:7,
 riskExtraK:1,
 // move speed x speedMul from this day on (original: from its 3rd round)
 speedFromDay:2,
 speedMul:1.15,
 // enemies per normal fight (one value per day band: days 1-2, 3-4, 5-6, 7-8, 9-10); a risk fight holds riskCountFactor times as many
 count:[19,28,40,55,72],
 riskCountFactor:[1,1,1.15,1.3,1.3],
 // finals: the shared boss pool = base pool x finalBossPoolMul, it does not take k; its attack stays as designed
 finalBossPoolMul:1.4,
 finalBossBasePool:{boss_1:300000,boss_2:240000,boss_3:260000,boss_4:280000,boss_5:200000,boss_7:270000},
 // seconds between the first and the last spawn (medians of the original R1-3, R4-5, R6-8, R9-10, R11-13)
 span:[28,34,57,61,64],
 firstSpawn:8,
 spawnExponent:.72,
 // one enemy type may hold at most this share of one fight
 maxShare:.4,
});
const POOL_NOTE='；第二轮补强：首领共享池按 finalBossPoolMul 放大';
const r4=v=>Math.round(v*1e4)/1e4;
/** Per-day multipliers on top of the encounter's constant overrides (C): `{k, atk, hp, speed}` for `day` (the final is day 10 with finalK). */
export function enemyDayScale(day,{risk=false,final=false}={}) {
 const t=ENEMY_TUNING,k=final?t.finalK:t.dayK[day-1]+(risk?t.riskExtraK:0);
 if(!Number.isInteger(k))throw Error(`no k for day ${day}`);
 return {k,atk:r4(t.atkBase**k),hp:r4(t.hpBase**k),speed:day>=t.speedFromDay?t.speedMul:1};
}
const dayScaleTable=(days,opts)=>Object.fromEntries(days.map(d=>[String(d),enemyDayScale(d,opts)]));
const bandDays=([from,to])=>Array.from({length:to-from+1},(_,i)=>from+i);
/** Largest-remainder split of `total` over the allocations by `fraction`, no type above floor(total*maxShare). */
export function capAllocations(allocations,total,maxShare=ENEMY_TUNING.maxShare) {
 const cap=Math.floor(total*maxShare+1e-9);
 if(allocations.length*cap<total)throw Error(`cannot hold ${total} enemies in ${allocations.length} types under a ${maxShare} share`);
 const fixed=new Set();
 for(;;) {
  const free=allocations.filter(a=>!fixed.has(a.key)),left=total-fixed.size*cap,sum=free.reduce((s,a)=>s+a.fraction,0);
  const over=free.filter(a=>left*a.fraction/sum>cap+1e-9);
  if(!over.length){
   const real=free.map(a=>({a,v:left*a.fraction/sum}));
   for(const {a,v}of real)a.count=Math.min(cap,Math.max(1,Math.floor(v)));
   for(const a of allocations)if(fixed.has(a.key))a.count=cap;
   while(allocations.reduce((s,a)=>s+a.count,0)<total) {
    const pick=real.filter(({a})=>a.count<cap).sort((x,y)=>(y.v-y.a.count)-(x.v-x.a.count)||x.a.key.localeCompare(y.a.key))[0];
    if(!pick)throw Error('allocation cannot reach the total');pick.a.count++;
   }
   while(allocations.reduce((s,a)=>s+a.count,0)>total) {
    const pick=real.filter(({a})=>a.count>1).sort((x,y)=>(y.a.count-y.v)-(x.a.count-x.v)||x.a.key.localeCompare(y.a.key))[0];
    if(!pick)break;pick.a.count--;
   }
   return allocations;
  }
  over.forEach(a=>fixed.add(a.key));
 }
}
const levelFile=id=>path.join(SOURCE_ROOT,'levels/obt/main',`level_main_${id}.json`);
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const mv=(v,fallback=null)=>v?.m_defined?v.m_value:fallback;
function merge(base,patch) {
  if(patch==null)return structuredClone(base);
  if(typeof patch!=='object'||Array.isArray(patch))return structuredClone(patch);
  if(Object.hasOwn(patch,'m_defined'))return patch.m_defined?structuredClone(patch):structuredClone(base);
  const result={...base};for(const [key,value]of Object.entries(patch))if(value!=null)result[key]=merge(base?.[key],value);return result;
}
export function chapterEnemyRecords(database,baseEnemies) {
  const refs=new Map();
  for(const id of CHAPTER_LEVELS.flat())for(const ref of json(levelFile(id)).enemyDbRefs??[]) {
    const entry=database.find(e=>e.Key===ref.id);if(!entry)throw Error(`Missing native enemy ${ref.id}`);
    const raw=entry.Value.reduce((value,row)=>row.level<=ref.level?merge(value,row.enemyData):value,{});
    const exact=merge(raw,ref.overwrittenData);if(mv(exact.levelType)==='BOSS')continue;
    if(!refs.has(ref.id))refs.set(ref.id,{raw:exact,level:ref.level,levelFile:levelFile(id)});
  }
  const handbook=json(path.join(SOURCE_ROOT,'excel/enemy_handbook_table.json')).enemyData;
  const records={};
  for(const [key,{raw,level,levelFile:source}]of refs) {
    if(baseEnemies[key])continue;
    const a=raw.attributes??{},stats={};
    for(const [from,to]of Object.entries({maxHp:'maxHp',atk:'atk',def:'def',magicResistance:'res',moveSpeed:'moveSpeed',baseAttackTime:'bat',attackSpeed:'aspd',massLevel:'massLevel',hpRecoveryPerSec:'hpRecoveryPerSec'}))stats[to]=mv(a[from],0);
    const hb=handbook[key]??{},types=hb.damageType??[];
    const applyWay=mv(raw.applyWay,'NONE');
    Object.assign(stats,{rangeRadius:mv(raw.rangeRadius,0),rawRangeRadius:mv(raw.rangeRadius,0),motion:mv(raw.motion,'WALK'),lpr:mv(raw.lifePointReduce,1),
      dmgType:applyWay==='NONE'?'none':types.includes('MAGIC')?'arts':'phys',aspd:stats.aspd||100,bat:stats.bat||2,moveSpeed:stats.moveSpeed||1,
      immunities:Object.fromEntries(['stun','silence','sleep','frozen','levitate'].map(k=>[k,mv(a[`${k}Immune`],false)]))});
    const bb=items=>Object.fromEntries((items??[]).filter(x=>x.value!=null).map(x=>[x.key,x.value]));
    records[key]={key,name:mv(raw.name,key),rank:mv(raw.levelType,'NORMAL'),level,applyWay,stats,
      spine:mv(raw.prefabKey,key),iconId:hb.enemyId??key,description:mv(raw.description,''),
      talents:{bb:bb(raw.talentBlackboard)},skills:(raw.skills??[]).map(s=>({prefabKey:s.prefabKey,priority:s.priority,
        bb:bb(s.blackboard),cooldown:s.cooldown,initCooldown:s.initCooldown,spCost:s.spCost})),
      abilities:(hb.abilityList??[]).map(a=>({text:a.text,format:a.textFormat})),
      source:{file:source,pointer:'/enemyDbRefs',revision:REVISION},assaultChapter:true};
  }
  return records;
}
export function applyChapterSets(doc,allEnemies) {
  const output=structuredClone(doc);
  const stages=Object.values(json(path.join(SOURCE_ROOT,'excel/stage_table.json')).stages);
  const chapterNames={'01':'觉醒','02':'异卵同生','03':'二次呼吸','04':'急性衰竭','05':'靶向药物','06':'局部坏死','07':'苦难摇篮'};
  for(let band=0;band<5;band++) {
    const encounters=output.encounters.filter(e=>e.kind!=='final'&&e.dayRange[0]===band*2+1);
    encounters.forEach((enc,index)=>{
      const id=CHAPTER_LEVELS[band][index],level=json(levelFile(id)),counts={};
      const stage=stages.find(s=>s.levelId?.toLowerCase()===`obt/main/level_main_${id}`);
      if(!stage)throw Error(`Chapter stage metadata missing ${id}`);
      for(const wave of level.waves??[])for(const fragment of wave.fragments??[])for(const action of fragment.actions??[])
        if(action.actionType==='SPAWN'&&allEnemies[action.key]&&allEnemies[action.key].rank!=='BOSS')counts[action.key]=(counts[action.key]??0)+action.count;
      const pool=Object.entries(counts).filter(([key])=>allEnemies[key].rank!=='BOSS');
      if(pool.length<2)throw Error(`Native level ${id} has fewer than two supported nonboss enemies`);
      const risk=enc.kind==='risk';
      const total=Math.round(ENEMY_TUNING.count[band]*(risk?ENEMY_TUNING.riskCountFactor[band]:1));
      const originalTotal=pool.reduce((sum,[,n])=>sum+n,0);
      const allocations=pool.map(([key,n])=>({key,count:0,fraction:n/originalTotal}));
      capAllocations(allocations,total);
      // Interleave native roles without flattening every wave to the same roster.
      // Elite/armour entries arrive later; early slots are genuinely sparse.
      const entries=[];
      for(const allocation of allocations)for(let i=0;i<allocation.count;i++)entries.push({key:allocation.key,
        order:(i+.5)/allocation.count+(allEnemies[allocation.key].rank==='ELITE'?.18:0)});
      entries.sort((a,b)=>a.order-b.order||a.key.localeCompare(b.key));
      // every enemy: native x C (constant); the day's 1.1^k / 1.2^k / speed come from wave.dayScale
      const overrides={};for(const {key}of allocations)overrides[key]={stats:{maxHp:ENEMY_TUNING.C.hp,atk:ENEMY_TUNING.C.atk}};
      const dayScale=dayScaleTable(bandDays(enc.dayRange),{risk});
      const routes=enc.wave.routes.filter(r=>r.motion!=='FLY');
      if(!routes.length)throw Error(`${enc.id} has no native ground route`);
      const flying=allocations.some(x=>allEnemies[x.key].stats.motion==='FLY');
      const flyIndex=routes.length;if(flying)routes.push({...structuredClone(routes[0]),motion:'FLY'});
      const spawns=entries.map((x,i)=>({key:x.key,count:1,interval:0,routeIndex:allEnemies[x.key].stats.motion==='FLY'?flyIndex:i%(routes.length-(flying?1:0)),
        time:Math.round((ENEMY_TUNING.firstSpawn+ENEMY_TUNING.span[band]*Math.pow(i/Math.max(1,entries.length-1),ENEMY_TUNING.spawnExponent))*1000)/1000}));
      enc.name=`${chapterNames[id.slice(0,2)]} ${stage.code} · ${stage.name} · ${risk?'高风险':'普通'}`;
      enc.description=`以原作主线${stage.code}「${stage.name}」的出敌比例组成套组：${allocations.map(x=>`${allEnemies[x.key].name}×${x.count}`).join('、')}。`;
      enc.riskExplanation=`${risk?'高风险':'普通'}：共${entries.length}名敌人，攻击与生命按原作终极难度随天数逐关上升${risk?'，高风险再多升一档':''}；从稀疏前哨逐渐推进至密集尾波。`;
      enc.chapterSourceRef={file:levelFile(id),pointer:'/waves',revision:REVISION};
      enc.chapterRoster=allocations.map(({key,count})=>({key,count}));
      enc.wave={...enc.wave,routes,spawns,overrides,dayScale,pacing:{schema:'assault-chapter-pacing/v1',nativeLevel:id,total:entries.length,tuning:ENEMY_TUNING.schema}};
    });
  }
  for(const enc of output.encounters.filter(e=>e.kind==='final')) {
    const bossId=enc.wave.bossId,basePool=ENEMY_TUNING.finalBossBasePool[bossId];
    if(!basePool)throw Error(`${enc.id}: no base boss pool for ${bossId}`);
    enc.wave.dayScale=dayScaleTable([10],{final:true});
    for(const [key,o]of Object.entries(enc.wave.overrides)) {
      if(key!==bossId) {
        // escorts follow the same formula as every other enemy (their old hand-set multipliers are gone)
        o.stats={maxHp:ENEMY_TUNING.C.hp,atk:ENEMY_TUNING.C.atk};delete o.note;continue;
      }
      // the boss keeps its designed attack; its shared pool does not take k
      const pool=Math.round(basePool*ENEMY_TUNING.finalBossPoolMul);
      o.stats.moveSpeed=ENEMY_TUNING.speedMul;
      o.stats.maxHp=pool;o.stats.sharedPoolHp=pool;
      o.note=String(o.note??'').replace(POOL_NOTE,'')+(ENEMY_TUNING.finalBossPoolMul!==1?POOL_NOTE:'');
    }
  }
  return output;
}
async function main(){
  if(process.argv.includes('--acquire')){
    const ids=CHAPTER_LEVELS.flat();let next=0;
    await Promise.all(Array.from({length:4},async()=>{while(next<ids.length){const id=ids[next++],file=levelFile(id);if(fs.existsSync(file))continue;
      const url=`https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${REVISION}/zh_CN/gamedata/levels/obt/main/level_main_${id}.json`;
      const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`${id}: HTTP ${response.status}`);
      const text=await response.text(),data=JSON.parse(text);if(!data.waves||!data.enemyDbRefs)throw Error(`Invalid chapter input ${id}`);
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);console.log(`acquired ${id} (${text.length})`);
    }}));
  }
  if(process.argv.includes('--apply')){
    const base=process.env.SP_DATA_DIR??'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-rules';
    const native=json(path.join(base,'enemies.json'));
    const database=json(path.join(SOURCE_ROOT,'levels/enemydata/enemy_database.json')).enemies;
    const extra=chapterEnemyRecords(database,native);const all={...native,...extra};
    const file='data/assault-design/encounters.json';const doc=applyChapterSets(json(file),all);fs.writeFileSync(file,JSON.stringify(doc,null,1)+'\n');
    const textFile='data/assault-design/public-text.json',copy=json(textFile);
    for(const e of doc.encounters.filter(e=>e.chapterSourceRef))copy.encounters[e.id]={...copy.encounters[e.id],name:e.name,description:e.description,summary:e.riskExplanation};
    fs.writeFileSync(textFile,JSON.stringify(copy,null,2)+'\n');
    console.log(JSON.stringify({encounters:30,chapterEnemies:Object.keys(extra).length,distinctEnemies:new Set(doc.encounters.flatMap(e=>e.wave.spawns.map(x=>x.key))).size}));
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
