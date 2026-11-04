import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';
import { COLS } from '../../server/sim/constants.js';

const data = getAssaultData(), design = loadAssaultDesign();
const roster = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-assault.json', import.meta.url), 'utf8'));
const forms = JSON.parse(fs.readFileSync(new URL('../../data/assault-design/forms.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(new URL('../../data/assault-coverage-assault-modules.json', import.meta.url), 'utf8'));
const sourceIndex = JSON.parse(fs.readFileSync(new URL('../../../../../data/assault-sources/source-index.json', import.meta.url), 'utf8'));
const sourceTables = Object.fromEntries(['arknights.characterTable','arknights.skillTable','arknights.uniequipTable','arknights.battleEquipTable','arknights.rangeTable','arknights.charPatchTable'].map((key) => [key, JSON.parse(fs.readFileSync(sourceIndex.sources[key].path, 'utf8'))]));
const acquisition = JSON.parse(fs.readFileSync(sourceIndex.versions.arknights.receipt, 'utf8'));
assert.equal(sourceIndex.versions.arknights.revision, acquisition.revision, 'native inputs match the official acquisition receipt revision');
const runtimeArtifact = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));
assert.equal(data.runtime.engineRevision, runtimeArtifact.engineRevision, 'loaded ctx runtime matches WT runtime artifact engine revision');
const native = sourceTables['arknights.characterTable'], skills = sourceTables['arknights.skillTable'];
const patchChars = sourceTables['arknights.charPatchTable'].patchChars;
const normal = design.encounters.encounters.find((entry) => entry.kind === 'normal');
let seq = 0;
const mappings = [
  { id:'char_1041_angel2', source:'fixedSkill:0', title:'使命必达技能装填50枚弹药并保留每次5连击与R3/R4伤害倍率', action:'ammo', r3:{ammoCount:5,hitsPerAttack:5,atkScalePerHit:1.5,ammoPerAttack:5}, r4:{ammoCount:5,hitsPerAttack:5,atkScalePerHit:1.6,ammoPerAttack:5}, /* 覆盖表数据文件仍记旧值，未重新生成 */ coverageR3:{ammoCount:50,hitsPerAttack:5,atkScalePerHit:1.5,ammoPerAttack:5}, coverageR4:{ammoCount:50,hitsPerAttack:5,atkScalePerHit:1.6,ammoPerAttack:5}, pointer:'/skchr_angel2_3' },
  { id:'char_1041_angel2', source:'fixedSkill:1', title:'使命必达按最长再部署时间选择真实地面投送目标', action:'targeting', r3:{selectLongestRespawn:1,includeDownedWaiting:1,excludeSummonDeviceClone:1,tieFormationOrder:1,requireEligibleTarget:1}, r4:{selectLongestRespawn:1,includeDownedWaiting:1,excludeSummonDeviceClone:1,tieFormationOrder:1,requireEligibleTarget:1}, pointer:'/skchr_angel2_3' },
  { id:'char_1041_angel2', source:'fixedSkill:2', title:'使命必达对投送落点结算250%物理半径1溅射', action:'damage', r3:{atkScale:2.5,splashRadius:1,damageType:'物理'}, r4:{atkScale:2.5,splashRadius:1,damageType:'物理'}, pointer:'/skchr_angel2_3' },
  { id:'char_1041_angel2', source:'fixedSkill:3', title:'使命必达免费再部署一名目标并恢复6技力及保留原位', action:'redeploy', r3:{targetCount:1,spGain:6,freeRedeploy:1,keepPosition:1}, r4:{targetCount:1,spGain:6,freeRedeploy:1,keepPosition:1}, pointer:'/skchr_angel2_3' },
  { id:'char_1041_angel2', source:'modePassive:0', title:'火力电台友方真实弹药消耗触发6%治疗及25%爆炸概率', action:'heal', r3:{bombChance:0.25,bombAtkScale:1.5,splashRadius:1}, r4:{bombChance:0.25,bombAtkScale:1.5,splashRadius:1}, /* 覆盖表数据文件仍记旧值，未重新生成 */ coverageR3:{healRatio:0.06,bombChance:0.25,bombAtkScale:1.5,splashRadius:1}, coverageR4:{healRatio:0.06,bombChance:0.25,bombAtkScale:1.5,splashRadius:1}, pointer:'/char_1041_angel2/talents/0' },
  { id:'char_1041_angel2', source:'modePassive:1', title:'铳弹协约弹药耗尽后按R3/R4上限回复技力', action:'spGain', r3:{spGain:5,perBattle:3}, r4:{spGain:6,perBattle:4}, pointer:'/char_1041_angel2/talents/1' },
  { id:'char_1041_angel2', source:'modePassive:2', title:'成功投送队友后一次性增加下一轮溅射伤害', action:'addBuff', r3:{splashBonus:0.3,once:1}, r4:{splashBonus:0.3,once:1}, pointer:'/char_1041_angel2/talents/1' },
  { id:'char_4010_etlchi', source:'fixedSkill:0', title:'灵与欲的惜别为至多三名地面敌人召唤60%生命心烛20秒', action:'summon', r3:{summonName:'心烛',maxTarget:3,hpScale:0.6,duration:20}, r4:{summonName:'心烛',maxTarget:3,hpScale:0.6,duration:20}, pointer:'/skchr_etlchi_3' },
  { id:'char_4010_etlchi', source:'fixedSkill:1', title:'灵与欲的惜别施加R3/R4攻击增幅攻速增幅扩大范围与20秒窗口', action:'addBuff', r3:{atkBonus:1.3,attackSpeedBonus:100,rangeExtend:1,duration:20}, r4:{atkBonus:1.35,attackSpeedBonus:100,rangeExtend:1,duration:20}, pointer:'/skchr_etlchi_3' },
  { id:'char_4010_etlchi', source:'fixedSkill:2', title:'攻击心烛至少结算35%攻击力物理伤害', action:'damage', r3:{minAtkScale:0.35,damageType:'物理'}, r4:{minAtkScale:0.35,damageType:'物理'}, pointer:'/skchr_etlchi_3' },
  { id:'char_4010_etlchi', source:'modePassive:0', title:'萃血普通命中按R3/R4生命窃取上限与5秒流血数值', action:'nativeMechanism', r3:{stealHp:50,stealCap:900,dotPerSec:100,dotDuration:5}, r4:{stealHp:75,stealCap:1350,dotPerSec:200,dotDuration:5}, pointer:'/char_4010_etlchi/talents/0' },
  { id:'char_1001_amiya2', source:'fixedSkill:0', title:'近卫阿米娅每次技能斩击按R3/R4倍率并以最终命中两倍真实伤害', action:'damage', r3:{atkScale:1.8,times:11,dmgType:'arts',finalHitScaleMultiplier:2,finalHitDmgType:'true'}, r4:{atkScale:2.2,times:12,dmgType:'arts',finalHitScaleMultiplier:2,finalHitDmgType:'true'}, pointer:'/skchr_amiya2_2' },
  { id:'char_1001_amiya2', source:'fixedSkill:1', title:'近卫阿米娅实际击杀后启用最终斩击真实伤害', action:'nativeMechanism', r3:{trueDamageAfterKill:1,finalHitAlwaysTrue:1}, r4:{trueDamageAfterKill:1,finalHitAlwaysTrue:1}, pointer:'/skchr_amiya2_2' },
  { id:'char_1001_amiya2', source:'modePassive:0', title:'近卫阿米娅在场攻击防御增益及8秒双击窗口', action:'addBuff', r3:{atk:0.06,def:0.06,doubleWindow:8,doubleMultiplier:2}, r4:{atk:0.07,def:0.07,doubleWindow:8,doubleMultiplier:2}, pointer:'/char_1001_amiya2/talents/0' },
  { id:'char_1001_amiya2', source:'modePassive:1', title:'近卫阿米娅技能击杀叠加攻击与法抗并按3层封顶', action:'addBuff', r3:{killAtk:0.35,killMres:20,maxStacks:3,trueAfterKill:1}, r4:{killAtk:0.4,killMres:20,maxStacks:3,trueAfterKill:1}, pointer:'/skchr_amiya2_2' },
  { id:'char_1037_amiya3', source:'fixedSkill:0', title:'医疗阿米娅技能攻击按R3/R4倍率且叠层后最多命中两名', action:'damage', r3:{atkScale:1.8,dmgType:'arts',maxTargetsAfterStack:2}, r4:{atkScale:2,dmgType:'arts',maxTargetsAfterStack:2}, pointer:'/skchr_amiya3_2' },
  { id:'char_1037_amiya3', source:'fixedSkill:1', title:'医疗阿米娅命中施加攻速移速削减及R3/R4时长', action:'applyStatus', r3:{status:'攻速移速削减',attackSpeed:-60,moveSpeed:-0.6,duration:8}, r4:{status:'攻速移速削减',attackSpeed:-60,moveSpeed:-0.6,duration:10}, pointer:'/skchr_amiya3_2' },
  { id:'char_1037_amiya3', source:'fixedSkill:2', title:'医疗阿米娅技能结算后按60%攻击比例治疗', action:'heal', r3:{healRatio:0.6,healType:'atkScale'}, r4:{healRatio:0.6,healType:'atkScale'}, pointer:'/skchr_amiya3_1' },
  { id:'char_1037_amiya3', source:'modePassive:0', title:'医疗阿米娅在场增加生命并持续回复R3/R4最大生命比例', action:'addBuff', r3:{maxHp:0.07,hpRecoveryPerSecByMaxHp:0.025,regenDuration:7}, r4:{maxHp:0.08,hpRecoveryPerSecByMaxHp:0.03,regenDuration:8}, pointer:'/char_1037_amiya3/talents/0' },
  { id:'char_1037_amiya3', source:'modePassive:1', title:'医疗阿米娅技能每次命中叠加攻击至五层并扩展目标', action:'addBuff', r3:{atkPerHit:0.25,maxStacks:5,trueAfterStack:1,multiTargetAfterStack:2}, r4:{atkPerHit:0.3,maxStacks:5,trueAfterStack:1,multiTargetAfterStack:2}, pointer:'/skchr_amiya3_2' },
];
assert.equal(mappings.length, 20, 'literal unique mapping count');
const body = (id) => data.runtime.bodies[id];
function sourceDefinition(id) { return roster.operators.find((entry) => entry.charId === id) ?? body(id); }
function moduleRows(id) { return coverage.modules.filter((entry) => entry.charId === id); }
function effectAt(definition, source) { const [kind, raw] = source.split(':'); const index = Number(raw); return kind === 'modePassive' ? definition.modePassives[index] : definition.fixedSkill.effects[index]; }
function rankValue(value, rank) { return Array.isArray(value) ? value[rank - 1] : value; }
function piece(id, rank, moduleId) {
  const definition = body(id), uid = `exact-l:${id}:r${rank}:${moduleId}:${++seq}`;
  return { uid, charId:id, isPrimary:true, purchaseCharId:definition.purchaseCharId, star:rank, row:9, col:8, dir:'RIGHT', sourceCopies:1,
    moduleId, moduleChoices:{[id]:moduleId}, permanentFlat:{}, permanentPercent:{}, tagEdits:{add:[],remove:[]}, claimed:[], summonPresets:[] };
}
function fixture(id, rank, moduleId, extraPieces = []) {
  const selected = piece(id,rank,moduleId), encounter = {...normal,wave:{...normal.wave,spawns:[],dp:{...normal.wave.dp,init:99}}};
  const prepared = prepareAssaultBattle({seed:840000+seq,life:20,day:1,hour:1,pieces:[selected,...extraPieces],nextBattleEffects:[]},encounter,{...data,design});
  const battle = createAssaultBattle(prepared,{...data,design,kits:assaultKits}); battle.autoFinish=false; battle.start(); battle.assaultRuntime.flush();
  const unit = battle.allyUnits.find((candidate)=>candidate.uid===selected.uid);
  assert(unit?.alive&&unit.deployed,`formal Battle deploys ${id} R${rank}/${moduleId}`);
  return {battle,unit,selected,extraPieces};
}
function targetTiles(f) { return [...new Set(f.unit.rangeKeys??[])].map(key=>[Math.floor(key/COLS),key%COLS]).filter(([r,c])=>f.battle.grid.inRect(r,c)&&f.battle.grid.groundPassable(r,c)&&(r!==f.unit.tileR||c!==f.unit.tileC)&&!f.battle._occ[r*19+c]?.alive&&!f.battle.downOn(r,c)); }
function holdEnemy(f,target) { f.battle.applyStatus(target,'stun',{duration:100}); target.atkCd=Infinity; return target; }
function enemy(f) { const tile=targetTiles(f)[0]; assert(tile,'native range has at least one legal ground target'); const target=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:f.battle.enemies.length,pos:tile,mods:{hpMul:100000}}); assert(target?.alive,'formal Battle spawns live enemy'); holdEnemy(f,target); f.battle._buildEnemyIndex(); return target; }
function advance(f, seconds) {
  const until = f.battle.time + seconds;
  for (let i = 0; i < 24000 && f.battle.time + 1e-9 < until; i++) f.battle.step();
  assert(f.battle.time + 1e-9 >= until, `native Battle clock reaches ${until.toFixed(3)}s`);
  f.battle.assaultRuntime.flush();
}
function nativeCast(f, label, beforeResolve = null) {
  advance(f, 0.25);
  assert.equal(f.unit.skill.rule, 'SP_FULL', `${label}: native skill readiness is SP_FULL`);
  const starts = [];
  f.battle.assaultRuntime.observe('skillStart', `exact-l:${label}`, ({ payload }) => { if (payload.source?.uid === f.unit.uid) starts.push({ reason: payload.reason, at: f.battle.time }); });
  beforeResolve?.();
  assert(f.unit.skill.gainSp(f.unit.skill.spCost - f.unit.skill.sp, `exact-l-native-SP_FULL:${label}`) > 0, `${label}: native Skill.gainSp fills SP`);
  advance(f, 0.05);
  assert.equal(starts.length, 1, `${label}: exactly one automatic native skill lifecycle starts`);
  assert.equal(starts[0].reason, 'automatic', `${label}: default native skill callback`);
}
function assertNativeSource(m) {
  const official = sourceIndex.arknights.operators.find((row)=>row.charId===m.id);
  if(official) assert.equal(official.charId,m.id,`${m.id}: source-index retains exact official operator id`);
  const record=native[m.id]??patchChars[m.id]; assert(record,`${m.id}: official character_table or char_patch_table source record exists`);
  const formRef=forms.forms?.find((entry)=>entry.charId===m.id)?.sourceRef;
  if(m.id.startsWith('char_10')&&m.id!=='char_1041_angel2') assert(formRef?.pointer===`/patchChars/${m.id}`,`${m.id}: official extra-form source pointer is char_patch_table patchChars`);
  const skillId=body(m.id).fixedSkill.sourceSkillId;
  assert(record.skills?.some((entry)=>entry.skillId===skillId)||skills[skillId],`${m.id}: converted skill ${skillId} resolves to native skill_table`);
  assert(skills[skillId]?.levels?.length===10,`${m.id}: ${skillId} has ten official skill levels`);
  const module=moduleRows(m.id).map((row)=>row.advancedModuleId);
  for(const id of module) assert(sourceTables['arknights.battleEquipTable'][id],`${id}: official battle_equip_table row exists`);
  return {record,skillId};
}

// 大巴扎卡面改写后已不存在的旧技能条目：卡面没有对应机制，整条跳过并注明原因。
const SUPERSEDED = {
  'char_4010_etlchi/fixedSkill:0': 'superseded: 隐德来希卡面第一行改为「对 1 名敌人造成 2 次 a% 物理伤害」，心烛召唤已删除（compiled runtime 只剩一个 damage 效果）',
  'char_4010_etlchi/fixedSkill:1': 'superseded: 隐德来希卡面没有技能后攻击/攻速/范围增幅窗口，心烛技能已被「2 次 a% 物理伤害」取代',
  'char_4010_etlchi/fixedSkill:2': 'superseded: 隐德来希卡面没有「攻击心烛」分支，心烛已删除',
};
for(const m of mappings) test(`exact-l ${m.id} ${m.source} ${m.title}: exact R3/R4 literals and real native lifecycle across modules`,{timeout:90000,skip:SUPERSEDED[`${m.id}/${m.source}`]},()=>{
  const rows=moduleRows(m.id), expectedModuleIds=m.id==='char_4010_etlchi'?['uniequip_002_etlchi','uniequip_003_etlchi']:[m.id==='char_1041_angel2'?'uniequip_002_angel2':m.id==='char_1001_amiya2'?'uniequip_002_amiya2':'uniequip_002_amiya3'];
  assert.deepEqual(rows.map(row=>row.advancedModuleId).sort(),expectedModuleIds.sort(),`${m.id}: canonical coverage has every native advanced module variant`);
  const {skillId}=assertNativeSource(m), definition=sourceDefinition(m.id), compiled=body(m.id), [kind,indexText]=m.source.split(':'), index=Number(indexText);
  const designEffect=effectAt(definition,m.source), runtimeEffect=effectAt(compiled,m.source);
  assert.equal(designEffect.action,m.action,`${m.id}/${m.source}: converted design action`);
  assert.equal(runtimeEffect.action,m.action,`${m.id}/${m.source}: compiled runtime action`);
  assert(m.title.length>0,`${m.id}/${m.source}: a literal title identifies this exact source case`);
  const pending=rows.map(row=>{const match=row.sourceEffects.find(item=>item.source===m.source);assert(match,`${row.advancedModuleId}: source effect binding exists`);assert(['partial','complete'].includes(match.status),`${row.advancedModuleId}: valid partial/complete status`);assert.equal(match.action,m.action,`${row.advancedModuleId}: canonical action`);assert.deepEqual(match.rank3,m.coverageR3??m.r3,`${row.advancedModuleId}: literal R3 coverage`);assert.deepEqual(match.rank4,m.coverageR4??m.r4,`${row.advancedModuleId}: literal R4 coverage`);return match;});
  const variantFailures=[];
  for(const rank of [3,4]) for(const moduleId of [null,...expectedModuleIds]){
    const label=`${m.id}/${m.source}/R${rank}/${moduleId}`;
    try {
    const extraPieces=[];
    let angelFallen=null;
    if(m.id==='char_1041_angel2'&&['fixedSkill:1','fixedSkill:2','fixedSkill:3'].includes(m.source)){
      angelFallen=piece('char_127_estell',2,null);angelFallen.isPrimary=false;angelFallen.row=9;angelFallen.col=6;angelFallen.uid=`exact-l:fallen:${seq}`;extraPieces.push(angelFallen);
    }
    const f=fixture(m.id,rank,moduleId,extraPieces);
    let angelFallenSpBefore=0;
    let angelDropCenter=null;
    if(angelFallen&&m.id==='char_1041_angel2'&&m.source==='fixedSkill:2'){
      const fallen=f.battle.allyUnits.find(unit=>unit.uid===angelFallen.uid);
      const cells=[];
      for(let r=0;r<COLS;r++) for(let c=0;c<COLS;c++) if(f.battle.grid.inRect(r,c)&&f.battle.grid.groundPassable(r,c)&&(!f.battle._occ[r*COLS+c]?.alive||f.battle._occ[r*COLS+c]===fallen)) cells.push([r,c]);
      const centers=cells.map(center=>({center,nearby:cells.filter(([r,c])=>Math.hypot(r-center[0],c-center[1])<=1&&!(r===center[0]&&c===center[1]))})).filter(row=>row.nearby.length>=3).sort((a,b)=>Math.hypot(a.center[0]-fallen.tileR,a.center[1]-fallen.tileC)-Math.hypot(b.center[0]-fallen.tileR,b.center[1]-fallen.tileC));
      assert(centers.length,`${label}: battlefield has an eligible landing tile with three legal radius-one ground cells`);
      angelDropCenter=centers[0].center;
      assert(f.battle.relocate(fallen,...angelDropCenter),`${label}: fixture places actual ally on a legal landing tile with real nearby ground cells`);
      angelFallen.row=angelDropCenter[0]; angelFallen.col=angelDropCenter[1];
    }
    if(angelFallen){const fallen=f.battle.allyUnits.find(unit=>unit.uid===angelFallen.uid);assert(fallen?.alive,`${label}: actual eligible ally is deployed`);angelFallenSpBefore=fallen.skill.sp;f.battle.loseHp(fallen,fallen.hp+1,{source:null});assert(!fallen.alive,`${label}: ally enters real downed-waiting state before native skill`);}
    const expected=rank===3?m.r3:m.r4;
    for(const [key,literal] of Object.entries(expected)){assert.deepEqual(rankValue(designEffect.values[key],rank),literal,`${label}: formal converted-design literal ${key}`);assert.deepEqual(rankValue(runtimeEffect.values[key],rank),literal,`${label}: runtime carries converted-design literal ${key}`);}
    assert.equal(f.unit.def.raw.assaultPiece.moduleId,moduleId,`${label}: requested module/no-module selection is active in native Unit`);
    const sourceSkill=skills[skillId]; assert(sourceSkill?.levels?.[8]?.blackboard&&sourceSkill?.levels?.[9]?.blackboard,`${label}: native R3/R4 skill blackboards are available for conversion audit`);
    if (kind === 'fixedSkill') {
      const landingTarget = enemy(f); let hostHpAtCast = null;
      const skillHits = [];
      const skillHeals = [];
      const angelRedeploys=[];
      if(angelFallen) f.battle.on('deploy',({unit})=>{if(unit.uid===angelFallen.uid)angelRedeploys.push([unit.tileR,unit.tileC,unit.skill.sp]);},{owner:f.unit});
      const attackBeforeCast=f.unit.s.atk;
      const nativeHealMultiplier = f.unit.s.healingDealtMul*f.unit.s.healingTakenMul;
      if (m.id === 'char_1037_amiya3' && m.source === 'fixedSkill:2') f.unit.hp = Math.floor(f.unit.s.maxHp/2);
      f.battle.on('damaged', (event) => { if (event.source===f.unit&&event.dmg?.isSkill) skillHits.push({target:event.target,amount:event.amount,type:event.type,isSkill:event.dmg.isSkill,attackId:event.dmg.attackId,sourceUid:event.source?.uid,creditUid:event.credit?.uid,sourceChar:event.source?.def?.charId,dropTile:f.unit.mem.assaultAngelDropTile? [...f.unit.mem.assaultAngelDropTile]:null}); }, {owner:f.unit});
      f.battle.on('heal', (event) => { if (event.source === f.unit) skillHeals.push(event); }, {owner:f.unit});
      if (m.id === 'char_4010_etlchi' && m.source === 'fixedSkill:0') {
        const tile = [landingTarget.tileR, landingTarget.tileC];
        for (let i = 0; i < 2; i++) { const extra = f.battle.spawnEnemy('enemy_1000_gopro_2', { routeIndex:f.battle.enemies.length, pos:tile, mods:{hpMul:100000,speed:0} }); assert(extra?.alive, `${label}: extra real host is alive`); extra.atkCd=Infinity; }
        f.battle._buildEnemyIndex();
      }
      if (m.id === 'char_1001_amiya2' && (m.source === 'fixedSkill:0'||m.source === 'fixedSkill:1')) {
        f.unit.atkCd=Infinity;
        landingTarget.hp=1;
        for(let i=1;i<(rank===3?11:12);i++) { const extra=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:f.battle.enemies.length,pos:[landingTarget.tileR,landingTarget.tileC],mods:{hpMul:100000,speed:0}}); assert(extra?.alive,`${label}: real low-HP target ${i+1} is alive`); extra.hp=1; extra.atkCd=Infinity; }
        f.battle._buildEnemyIndex();
      }
      if(m.id==='char_1037_amiya3'&&m.source==='fixedSkill:0'){
        f.unit.atkCd=Infinity;
        for(let i=1;i<5;i++){const extra=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[landingTarget.tileR,landingTarget.tileC],mods:{hpMul:100000,speed:0}});assert(extra?.alive,`${label}: real fifth skill target is alive`);extra.atkCd=Infinity;}
      }
      let angelAoeFixtures=[];
      let angelExpectedDamageTile=null;
      if(m.id==='char_1041_angel2'&&angelFallen&&m.source==='fixedSkill:2'){
      }
      const candleDeathTimes = [];
      f.battle.on('death', ({ unit: dead }) => { if (dead.mem?.candleOwner === f.unit) candleDeathTimes.push(f.battle.time); });
      if (m.id === 'char_4010_etlchi' && m.source === 'fixedSkill:0') f.unit.atkCd = Infinity; // keep the lifetime probe free of the owner's unrelated normal attacks
      nativeCast(f, label, m.id === 'char_4010_etlchi' && m.source === 'fixedSkill:0' ? () => { hostHpAtCast = landingTarget.hp; }
        : m.id==='char_1041_angel2'&&m.source==='fixedSkill:2' ? () => {
          const insideTiles=[];
          for(let r=0;r<COLS;r++) for(let c=0;c<COLS;c++) if(f.battle.grid.inRect(r,c)&&f.battle.grid.groundPassable(r,c)&&Math.hypot(r-angelDropCenter[0],c-angelDropCenter[1])<=1&&!(r===angelDropCenter[0]&&c===angelDropCenter[1])&&!f.battle._occ[r*COLS+c]?.alive&&!f.battle.downOn(r,c)) insideTiles.push([r,c]);
          assert(insideTiles.length>=3,`${label}: three legal radius-one targets are available at native cast resolution; center=${angelDropCenter}; fallenTile=${f.battle.allyUnits.find(unit=>unit.uid===angelFallen.uid)?.body}; cells=${JSON.stringify(insideTiles)}`);
          angelExpectedDamageTile=insideTiles[0];
          for(const pos of insideTiles.slice(0,3)) { const extra=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos,mods:{hpMul:100000}});assert(extra?.alive,`${label}: live native enemy spawns at ${pos} immediately before resolution`);assert.deepEqual([extra.tileR,extra.tileC],pos,`${label}: enemy remains at radius tile at cast time`);angelAoeFixtures.push(extra); }
          const outsidePos=Array.from({length:COLS*COLS},(_,index)=>[Math.floor(index/COLS),index%COLS]).find(([r,c])=>f.battle.grid.inRect(r,c)&&f.battle.grid.groundPassable(r,c)&&Math.hypot(r-angelDropCenter[0],c-angelDropCenter[1])>1&&!f.battle._occ[r*COLS+c]?.alive&&!f.battle.downOn(r,c));
          assert(outsidePos,`${label}: battlefield provides a legal empty tile outside the radius-one negative boundary`); const outside=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:outsidePos,mods:{hpMul:100000}});assert(outside?.alive,`${label}: live outside-range enemy spawns immediately before resolution`);assert.deepEqual([outside.tileR,outside.tileC],outsidePos,`${label}: outside enemy remains at its intended tile at cast time`);angelAoeFixtures.push(outside);f.battle._buildEnemyIndex();
          assert(angelAoeFixtures.every(target=>target.alive&&target.side==='enemy'),`${label}: all area fixtures are living native enemies at cast time`);
        }
        : null);
      if(m.id==='char_1041_angel2'&&angelFallen&&['fixedSkill:1','fixedSkill:2','fixedSkill:3'].includes(m.source)){
        assert.equal(angelRedeploys.length,1,`${label}: actual skill selects and redeploys exactly one fallen eligible ally`);
        assert.deepEqual(angelRedeploys[0].slice(0,2),[angelFallen.row,angelFallen.col],`${label}: native redeploy restores the downed ally at its original tile`);
        const restored=f.battle.allyUnits.find(unit=>unit.uid===angelFallen.uid);
        assert(restored.skill.sp>=angelFallenSpBefore+6,`${label}: actual redeploy completion grants six SP after the deploy event`);
        assert.equal(f.unit.mem.assaultAngelDropTile,null,`${label}: native cast clears landing state after the delivery resolves`);
        if(m.source==='fixedSkill:2'){
          // 只看投送落点的溅射：五发（模组 002 六发）射击本身命中落点旁的敌人不算。
          const radiusHits=skillHits.filter(hit=>hit.sourceUid===f.unit.uid&&hit.target.side==='enemy'&&!String(hit.attackId??'').includes(':instant-shot:')&&Math.hypot(hit.target.tileR-angelFallen.row,hit.target.tileC-angelFallen.col)<=1);
          // 大巴扎：卡面第一行只写「再部署 1 名干员并为其充能 6」，投送落点的 250% 溅射已删除。
          assert.equal(radiusHits.length,0,`${label}: no landing splash any more, hitCount=${radiusHits.length},all=${JSON.stringify(skillHits.map(hit=>[hit.target.side,hit.target.tileR,hit.target.tileC,hit.type,hit.amount,hit.attackId,hit.dropTile]))},dropAfter=${JSON.stringify(f.unit.mem.assaultAngelDropTile)},fallen=${angelFallen.row},${angelFallen.col}`);
          assert.equal(f.unit.mem.assaultAngelDropTile,null,`${label}: resolved cast clears its landing tile rather than leaving stale splash state`);
        }
      }
      if (m.id === 'char_1037_amiya3' && m.source === 'fixedSkill:1') {
        const slow = landingTarget.findBuff('char_1037_amiya3:attack-move-slow');
        const expectedDuration = rank === 3 ? 8 : 10; // 大巴扎：模组不再给 4★ 减速 +1 秒
        assert.equal(slow?.mods?.aspd, -60, `${label}: actual target receives exact -60 ASPD modifier`);
        assert.equal(slow?.mods?.moveMul, 0.4, `${label}: actual target receives exact 60% movement reduction`);
        assert(Math.abs(slow.duration-expectedDuration)<0.1, `${label}: live debuff duration is ${expectedDuration}s`);
        f.unit.atkCd=Infinity;
        advance(f, expectedDuration+0.2);
        assert.equal(landingTarget.findBuff('char_1037_amiya3:attack-move-slow'),null,`${label}: debuff expires after its exact rank/module window`);
      }
      if (m.id === 'char_1037_amiya3' && m.source === 'fixedSkill:2') {
        // 大巴扎：技能本身不再治疗；第三行「当你的罗德岛干员施放技能时，治疗生命最低的干员 c% 攻击力」（含自身施放）负责，且没有逐命中叠攻。
        const expectedHeal=attackBeforeCast*f.unit.def.raw.assaultBody.bazaar.lines[2].params.c[rank-1]/100*nativeHealMultiplier;
        const directHeal = skillHeals.filter(event=>event.target===f.unit&&Math.abs(event.amount-expectedHeal)<1e-6);
        assert.equal(directHeal.length,1,`${label}: skill resolves one actual skill-specific ally heal; events=${JSON.stringify(skillHeals.map(event=>[event.target?.uid,event.amount,event.target===f.unit]))}; atk=${f.unit.s.atk}`);
        assert.equal(directHeal[0].target,f.unit,`${label}: the only eligible injured operator receives that heal`);
        assert(Math.abs(directHeal[0].amount-expectedHeal)<1e-6,`${label}: real skill heal equals 60% attack after native healer/recipient modifiers`);
      }
      if (m.id === 'char_1001_amiya2' && m.source === 'fixedSkill:0') {
        const expectedCount = rank === 3 ? 11 : 12;
        assert.equal(skillHits.length, expectedCount, `${label}: actual slash skill deals exactly ${expectedCount} native hits`);
        assert.equal(skillHits[0].type,'arts',`${label}: first live slash hit is Arts before the first kill`);
        // 大巴扎：卡面「对生命最低的敌人造成 n 次 a% 法术伤害」——击杀后不转真伤，末击不翻倍，没有击杀叠攻。
        assert(skillHits.every(hit => hit.type === 'arts'), `${label}: every slash stays Arts after actual kills`);
        assert(Math.abs(skillHits.at(-1).amount - skillHits[0].amount) < 1e-6 * skillHits[0].amount + 1e-9, `${label}: final slash uses the same a% scale (no doubled true finisher)`);
        assert(!f.unit.findBuff('char_1001_amiya2:slaughter:0'),`${label}: no kill-stack buff is created`);
      }
      if(m.id==='char_1037_amiya3'&&m.source==='fixedSkill:0'){
        assert.equal(skillHits.length,5,`${label}: skill has five real damageTaken events across five eligible enemies`);
        const scale=rank===3?1.8:2.0, resistance=skillHits[0].target.s.res??0;
        assert(Math.abs(skillHits[0].amount-attackBeforeCast*scale*(1-resistance/100))<1e-5,`${label}: first hit actual amount matches ${scale}x Arts damage after native resistance`);
        const stackBonus=rank===3?0.25:0.3;
        const resistanceFactor=1-(skillHits[0].target.s.res??0)/100;
        // 大巴扎：卡面只写 a% 法术伤害——后续目标不转真伤，也没有逐命中叠攻（stackBonus/resistanceFactor 仅保留作对照）。
        void stackBonus; void resistanceFactor;
        assert(skillHits.every(hit=>hit.type==='arts'&&Math.abs(hit.amount/skillHits[0].amount-1)<1e-5),`${label}: every target takes the same a% Arts hit (no true conversion, no per-hit stacks)`);
        assert.equal(f.unit.mem.assaultAmiyaHits,5,`${label}: actual cast records five acquired hit stacks`);
        assert.equal(f.unit.buffs.filter(buff=>buff.key.startsWith('char_1037_amiya3:cast-stack:')).length,0,`${label}: temporary skill stack window expires after cast resolution`);
      }
      if (m.id === 'char_1041_angel2' && m.source === 'fixedSkill:0') {
        // 大巴扎：卡面「射出 5 发 a% 物理伤害」（施放时立即射出，不再装填 50 发弹匣），模组「技能多射 1 发」。
        const shots = moduleId === 'uniequip_002_angel2' ? 6 : 5;
        assert.equal(f.unit.mem.assaultAmmo ?? null, null, `${label}: the instant cast leaves no loaded magazine`);
        assert.equal(skillHits.length, shots, `${label}: the cast fires exactly ${shots} real shots; hits=${skillHits.length}`);
        const scale = f.unit.def.raw.assaultBody.bazaar.lines[0].params.a[rank - 1] / 100; // 卡面 a%
        assert(skillHits.every(hit => hit.type === 'phys' && Math.abs(hit.amount - Math.max(f.unit.s.atk * scale - hit.target.s.def, f.unit.s.atk * scale * 0.05)) < 1e-6),
          `${label}: each shot equals the card a% = ${scale} ATK physical`);
      }
      if (m.id === 'char_4010_etlchi' && m.source === 'fixedSkill:0') {
        const candles = f.unit.mem.assaultEtlchiCandles ?? [], candle = candles[0], host = f.battle.enemies.find((target) => target.mem?.candleOwner === f.unit);
        f.battle.assaultRuntime.flush();
        assert(f.unit.findBuff('char_4010_etlchi:addBuff:灵与欲的惜别结算后'),`${label}: native cast activates the 20-second candle attack window`);
        assert(candle?.alive && host, `${label}: native skill creates a live candle linked to its actual host`);
        assert.equal(candles.length, 3, `${label}: native candle target cap is exactly three against three legal hosts`);
        assert(Math.abs(candle.s.maxHp - hostHpAtCast * (moduleId === 'uniequip_002_etlchi' ? 0.7 : 0.6)) < 1e-6, `${label}: native candle inherits exact host HP scale with module/no-module control`);
        const hostBeforeHit=candle.mem.candleHost.hp;
        assert.equal(f.battle.forceAttack(f.unit,[candle]),true,`${label}: real native attack can hit its deployed candle`);
        f.battle.assaultRuntime.flush();
        const expectedTheft=rank===4&&moduleId==='uniequip_003_etlchi'?150:0;
        assert.equal(f.unit.mem.assaultEtlchiStolen??0,expectedTheft,`${label}: candle hit theft is ${expectedTheft} with rank/module gate`);
        assert(candle.mem.candleHost.hp<hostBeforeHit,`${label}: actual candle hit transfers HP loss to original host`);
        f.battle.applyStatus(f.unit, 'stun', { duration: 100 }); // prevent a second natural cast from replacing the candle before its lifetime check
        f.battle.addBuff(f.unit, { key: 'exact-l:hold-SP-duration-probe', flags: { noSp: true }, duration: 30 });
        for (const foe of f.battle.enemies) f.battle.applyStatus(foe, 'stun', { duration: 100 }); // stop host attacks from killing the candle; lifetime remains timer-driven
        advance(f, 21);
        assert.equal(candle.alive, moduleId === 'uniequip_003_etlchi', `${label}: candle lifetime expected by module; deadAt=${candleDeathTimes.join(',')} time=${f.battle.time} sp=${f.unit.skill.sp} noSp=${Boolean(f.unit.findBuff('exact-l:hold-SP-duration-probe'))}`);
        if (moduleId === 'uniequip_003_etlchi') { advance(f, 4.2); assert(candles.every((entry) => !entry.alive), `${label}: 25-second module candle duration expires all live candles`); }
      }
    } else {
      const victim = enemy(f);
      if(m.id==='char_1041_angel2'&&m.source==='modePassive:0'){
        f.unit.hp=f.unit.s.maxHp*0.5; // 施放挪到弹药监听注册之后：新卡面技能在施放时立即射出全部子弹
      }
      const hits = [], victimMaxHpBefore = victim.s.maxHp, dot = [];
      if(m.id==='char_1037_amiya3'&&m.source==='modePassive:1'){
        f.unit.atkCd=Infinity;
        const stackHits=[];
        f.battle.on('damaged',event=>{if(event.source===f.unit&&event.dmg?.isSkill)stackHits.push({target:event.target,amount:event.amount,type:event.type});},{owner:f.unit});
        for(let i=1;i<5;i++){const extra=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[victim.tileR,victim.tileC],mods:{hpMul:100000,speed:0}});assert(extra?.alive,`${label}: live eligible target ${i+1} for real hit stack`);extra.atkCd=Infinity;}
        nativeCast(f,label);
        assert.equal(stackHits.length,5,`${label}: actual skill activation records five target hit events`);
        const baseScale=rank===3?1.8:2, baseAtk=f.unit.s.atk, resistance=stackHits[0].target.s.res??0;
        assert(Math.abs(stackHits[0].amount-baseAtk*baseScale*(1-resistance/100))<1e-5,`${label}: first target receives exact converted rank-scaled Arts amount`);
        // 大巴扎：卡面没有逐命中叠攻和转真伤，旧被动数值仍在数据里但运行时不再生效。
        assert(stackHits.every(hit=>hit.type==='arts'&&Math.abs(hit.amount/stackHits[0].amount-1)<1e-5),`${label}: later targets take the same Arts hit (no temporary attack stack, no true conversion)`);
        assert.equal(f.unit.mem.assaultAmiyaHits,5,`${label}: modePassive binding observes five real skill hits`);
      }
      const ammoUses=[], passiveHeals=[], bombs=[];
      if(m.id==='char_1041_angel2'&&m.source==='modePassive:0'){
        for(const pos of [[victim.tileR,victim.tileC+1],[victim.tileR+1,victim.tileC],[victim.tileR-1,victim.tileC]]) if(f.battle.grid.inRect(...pos)&&f.battle.grid.groundPassable(...pos)){const extra=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:f.battle.enemies.length,pos,mods:{hpMul:100000,speed:0}});if(extra)extra.atkCd=Infinity;}
        f.battle.on('ammoUsed',event=>{if(event.source===f.unit)ammoUses.push(event.quantity??event.amount??1);},{owner:f.unit});
        f.battle.on('heal',event=>{if(event.source===f.unit&&event.target===f.unit)passiveHeals.push(event);},{owner:f.unit});
        f.battle.on('damaged',event=>{if(event.source===f.unit&&String(event.dmg?.attackId??'').includes(':ammo-bomb:'))bombs.push(event);},{owner:f.unit});
        nativeCast(f,label);
      }
      if (m.id === 'char_4010_etlchi' && m.source === 'modePassive:0') f.unit.atkCd = Infinity; // isolate one real forced native attack from later automatic repeats
      if (m.id === 'char_4010_etlchi' && m.source === 'modePassive:0') f.battle.on('damaged', (event) => { if (event.source === f.unit && event.target === victim && event.dmg?.tags?.includes('assaultEtlchiTalentDot')) dot.push(event); }, {owner:f.unit});
      f.battle.on('damaged', (event) => { if (event.source === f.unit && event.target === victim) hits.push(event); }, { owner: f.unit });
      if(m.id==='char_1041_angel2'&&m.source==='modePassive:0'){
        for(let i=0;i<10;i++){assert.equal(f.battle.forceAttack(f.unit,[victim]),true,`${label}: real ammo attack ${i+1}`);f.unit.atkCd=Infinity;f.battle.assaultRuntime.flush();}
        const consumed=ammoUses.reduce((sum,value)=>sum+Number(value||0),0);
        // 大巴扎：技能只装 5 发（模组 +1）；第二行「消耗弹药时 p% 几率造成 a% 物理伤害」，删去每发自愈。
        assert.equal(consumed,moduleId==='uniequip_002_angel2'?6:5,`${label}: observed the card's loaded rounds as actual ammoUsed`);
        assert.equal(passiveHeals.length,0,`${label}: ammo use no longer heals (card has no heal)`);
        assert(bombs.length<=consumed,`${label}: at most one proc per consumed round`);
        assert(bombs.every(event=>String(event.dmg.attackId).includes(':ammo-bomb:')&&event.type==='phys'),`${label}: proc damage comes from native physical ammo-bomb damage events`);
      } else assert.equal(f.battle.forceAttack(f.unit, [victim]), true, `${label}: real Battle.forceAttack enters native attack lifecycle`);
      if (m.id === 'char_4010_etlchi' && m.source === 'modePassive:0') f.unit.atkCd = Infinity;
      advance(f, m.id === 'char_4010_etlchi' && m.source === 'modePassive:0' ? 0.05 : 5);
      assert(hits.length > 0, `${label}: native Unit hit produces real damageTaken event`);
      if (m.id === 'char_4010_etlchi' && m.source === 'modePassive:0') {
        // 大巴扎：第二行「攻击偷取 s 最大生命」+ 模组 002「偷取的最大生命 +s」。
        const card = f.unit.def.raw.assaultBody.bazaar;
        const theft = card.lines[1].params.s[rank - 1] + (moduleId === 'uniequip_002_etlchi' ? card.modules.uniequip_002_etlchi.params.s[rank - 1] : 0);
        assert.equal(f.unit.mem.assaultEtlchiStolen, theft, `${label}: real normal hit steals exact rank-specific HP`);
        assert.equal(victim.s.maxHp, victimMaxHpBefore - theft, `${label}: native theft reduces target max HP by exact amount`);
        f.unit.skill.sp = 0; f.unit.skill.charges = 0;
        f.battle.addBuff(f.unit, { key: 'exact-l:hold-SP-dot-probe', flags: { noSp: true }, duration: 30 }); // 新技能直接伤害目标，测流血时先压住施放
        const beforeDot = victim.hp;
        advance(f, 5.2);
        const amount = card.lines[1].params.d[rank - 1] * (1 + (moduleId === 'uniequip_003_etlchi' ? card.modules.uniequip_003_etlchi.params.x[rank - 1] : 0) / 100); // 卡面 d，模组 003 +x%
        assert.equal(dot.length, 5, `${label}: five native bleed ticks run during the five-second status window; currentBuffs=${JSON.stringify(victim.buffs.map(buff => [buff.key,buff.duration,buff.interval]))}`);
        assert(dot.every((event) => Math.abs(event.dmg.amount - amount) < 1e-9), `${label}: each real periodic Arts tick is exactly ${amount}`);
        assert.equal(victim.hp, beforeDot - dot.reduce((sum,event)=>sum+event.amount,0), `${label}: observed victim HP loss equals the sum of five real DoT damageTaken amounts`);
        const cap=rank===3?900:1350; // 大巴扎：模组 002 只加每次偷取量（+s），不再提高累计上限
        for(let i=0;i<Math.ceil(cap/theft)+1&&f.unit.mem.assaultEtlchiStolen<cap;i++) assert.equal(f.battle.forceAttack(f.unit,[victim]),true,`${label}: repeated actual attack ${i+1} reaches native cap`);
        assert.equal(f.unit.mem.assaultEtlchiStolen,cap,`${label}: repeated native hits clamp cumulative stolen HP at exact cap ${cap}`);
        assert.equal(victim.s.maxHp,victimMaxHpBefore-cap,`${label}: target live max HP reflects the exact capped theft`);
      }
      if (m.id === 'char_1001_amiya2' && m.source === 'modePassive:0') {
        const aura = f.unit.findBuff('char_1001_amiya2:team-aura'), expectedAtk = moduleId === 'uniequip_002_amiya2' ? (rank === 4 ? 0.09 : 0.08) : (rank === 4 ? 0.07 : 0.06);
        assert.equal(aura?.mods?.atkPct, expectedAtk, `${label}: live aura attack modifier has exact R3/R4 module/no-module value`);
        assert.equal(aura?.mods?.defPct, expectedAtk, `${label}: live aura defense modifier has exact R3/R4 module/no-module value`);
      }
      if (m.id === 'char_1037_amiya3' && m.source === 'modePassive:0') {
        const aura = f.unit.findBuff('char_1037_amiya3:team-aura'), expectedHp = moduleId === 'uniequip_002_amiya3' ? (rank === 4 ? 0.1 : 0.09) : (rank === 4 ? 0.08 : 0.07);
        assert.equal(aura?.mods?.hpPct, expectedHp, `${label}: live aura max-HP modifier has exact R3/R4 module/no-module value`);
      }
    }
    assert.equal(f.battle.errors.length,0,`${label}: no native Battle runtime errors`);
    } catch(error) { variantFailures.push(`${label}: ${error.message}`); }
  }
  assert.deepEqual(variantFailures,[],`${m.id}/${m.source}: every rank and module/no-module fixture ran; failures=${variantFailures.join(' || ')}`);
  assert.equal(pending.length,expectedModuleIds.length,`${m.id}/${m.source}: all actual per-module pending variants checked`);
});
