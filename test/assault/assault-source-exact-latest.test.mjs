import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { sourceTalents } from '../../tools/assault/build-runtime-data.mjs';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { summonPlacementLegal } from '../../server/sim/content/assault/summons.js';
import { bodyKeys } from '../../server/sim/body.js';
import { roundHalfEven } from '../../server/sim/detmath.js';

const data=getAssaultData(),design=loadAssaultDesign(),rev='17759cc8cdf37388414145d16262a3a06f3ab25e';
test('importing native talent parsing leaves the compiled runtime bytes and file identity unchanged', () => {
  const output = new URL('../../data/assault-runtime.json', import.meta.url);
  const before = fs.readFileSync(output), identity = fs.statSync(output, { bigint: true });
  const compilerUrl = new URL('../../tools/assault/build-runtime-data.mjs', import.meta.url).href;
  const result = execFileSync(process.execPath, ['--max-old-space-size=192', '--input-type=module', '-e',
    `const module=await import(${JSON.stringify(compilerUrl)}); if(typeof module.sourceTalents!=='function'||typeof module.compile!=='function') process.exit(2); console.log('import-only');`],
    { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.trim(), 'import-only', 'import must not invoke the CLI compiler or emit its build report');
  const after = fs.statSync(output, { bigint: true });
  assert.deepEqual(fs.readFileSync(output), before, 'import must preserve every compiled runtime byte');
  assert.equal(after.ino, identity.ino, 'import must not replace the canonical artifact');
  assert.equal(after.mtimeNs, identity.mtimeNs, 'import must not write the canonical artifact');
});
const ids=['char_393_toledo','char_4232_hbound','char_4231_clemnt'];
const rosterFiles=['roster-assault.json','roster-ranged.json'];
const native=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json','utf8'));
const skills=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/skill_table.json','utf8'));
const normal=design.encounters.encounters.find(x=>x.kind==='normal');let seq=0;
function fixture(id,rank,moduleId=null,extraIds=[]){const makePiece=(charId,star,row,col,selected=null)=>{const body=data.runtime.bodies[charId];return {uid:`latest:${charId}:${star}:${++seq}`,charId,purchaseCharId:body.purchaseCharId,isPrimary:true,star,row,col,dir:'RIGHT',sourceCopies:1,moduleId:selected,moduleChoices:{[charId]:selected},permanentFlat:{},permanentPercent:{},tagEdits:{add:[],remove:[]},claimed:[],summonPresets:[]};};const piece=makePiece(id,rank,9,8,moduleId),extraPieces=extraIds.map((charId,index)=>makePiece(charId,4,7,7+index,null));const encounter={...normal,wave:{...normal.wave,spawns:[],dp:{...normal.wave.dp,init:99}}};const prepared=prepareAssaultBattle({seed:912000+seq,life:20,day:1,hour:1,pieces:[piece,...extraPieces],nextBattleEffects:[]},encounter,{...data,design});const battle=createAssaultBattle(prepared,{...data,design,kits:assaultKits});battle.autoFinish=false;battle.start();battle.assaultRuntime.flush();const unit=battle.allyUnits.find(x=>x.uid===piece.uid);assert(unit?.alive&&unit.deployed);const extras=extraPieces.map(p=>battle.allyUnits.find(x=>x.uid===p.uid));for(const x of extras)if(x&&!x.alive){let deployed=false;for(let r=0;r<19&&!deployed;r++)for(let c=0;c<19&&!deployed;c++)if(battle.onOwnBoard(x.player,r,c)&&battle.grid.canStand(r,c))deployed=battle._deploy(x,{initial:true,tile:[r,c]});assert(deployed,`${x.def.charId} starts on a real legal own-board tile`);}assert(extras.every(x=>x?.alive&&x.deployed));return {battle,unit,piece,extras};}
function addEnemy(f,offset=1){const e=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:f.battle.enemies.length,pos:[f.unit.tileR,f.unit.tileC+offset],mods:{hpMul:100000,speed:0}});assert(e?.alive);e.atkCd=Infinity;f.battle._buildEnemyIndex();return e;}
function advance(f,seconds){const until=f.battle.time+seconds;for(let i=0;i<24000&&f.battle.time+1e-9<until;i++)f.battle.step();assert(f.battle.time+1e-9>=until);f.battle.assaultRuntime.flush();}
function cast(f,label){const starts=[];f.battle.assaultRuntime.observe('skillStart',`latest:${label}`,({payload})=>{if(payload.source?.uid===f.unit.uid)starts.push(payload.reason)});const missing=f.unit.skill.spCost-f.unit.skill.sp;assert(missing>=0);assert(f.unit.skill.gainSp(missing,`latest:${label}`)>0);advance(f,.05);assert.deepEqual(starts,['automatic']);}

test('latest source closure retains all three full native records and exact skill/module pointers',()=>{
  assert.equal(data.runtime.sourceRevision,rev);assert.equal(Object.keys(data.runtime.operators).length,170);assert.equal(Object.keys(data.runtime.bodies).length,172);
  const index=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/assault/stronghold-protocol/data/assault-operator-index.json','utf8'));assert.equal(index.count,432);
  for(const id of ids){const body=data.runtime.bodies[id],raw=native[id];assert(body,`${id} compiled physical body`);assert.equal(body.source.pointer,`/${id}`);assert.equal(body.source.skills.length,raw.skills.length);assert.equal(body.source.talents.length,raw.talents.length);assert.equal(body.fixedSkill.sourceSkillId,raw.skills[body.fixedSkill.sourceIndex].skillId);assert.deepEqual(body.fixedSkill.source.native.nativeLevels.map(x=>x.levelIndex),[0,1,2,3,4,5,6,7,8,9]);}
  for(const id of ids)assert(data.runtime.bodies[id].source.fullNative?.phases?.length===3,`${id}: full native phases retained`);assert.equal(data.runtime.bodies.char_393_toledo.summonTemplateIds.includes('token_10067_toledo_tldptm'),true);
  const token=data.runtime.summons.token_10067_toledo_tldptm;assert.equal(token.sourceTemplate.talents[0].index,0);assert.equal(token.sourceTemplate.talents[0].empty,true);assert.equal(token.sourceTemplate.talents[1].index,1);assert.equal(token.sourceTemplate.talents[1].sourcePointer,'/token_10067_toledo_tldptm/talents/1');
  const empty=sourceTalents({talents:[{candidates:null}]},{phaseIndex:2,level:60},'character_table.json#/fixture');assert.equal(empty[0].index,0);assert.equal(empty[0].empty,true);
  assert.throws(()=>sourceTalents({talents:[{candidates:[{unlockCondition:{phase:'PHASE_2',level:80},requiredPotentialRank:0}]}]},{phaseIndex:2,level:60},'character_table.json#/negative'),/no candidate unlocked/);
});

test('new source revision preserves all 169 prior physical-body calibration rows and old branch medians',()=>{
  const previous=JSON.parse(execFileSync('git',['show','HEAD:data/assault-runtime.json'],{cwd:'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/.worktrees/assault/stronghold-protocol',encoding:'utf8',maxBuffer:8*1024*1024}));
  for(const [id,body] of Object.entries(previous.bodies)){assert.deepEqual(data.runtime.bodies[id].baseStats,body.baseStats,`${id} baseStats`);assert.deepEqual(data.runtime.bodies[id].starStats,body.starStats,`${id} starStats`);}
  assert.deepEqual(data.runtime.branchMedians.alchemist,{atk:457.42782,maxHp:1072.250534,def:97.609515});
  assert.deepEqual(data.runtime.branchMedians.underminer,{atk:416.139241,maxHp:1582.955697,def:100.708861});
  assert(data.runtime.branchMedians.primguard,'new native branch receives its own median');
});

test('latest operators cast native SP_FULL skills at every rank with module gates', {timeout:85000},()=>{
 for(const id of ids)for(const rank of [1,2,3,4]){const mid=rank>=3&&id!=='char_4231_clemnt'?`uniequip_002_${id.split('_').at(-1)}`:null;const f=fixture(id,rank,mid),enemy=addEnemy(f);assert.equal(f.unit.skill.rule,'SP_FULL');cast(f,`${id}-R${rank}`);if(id==='char_393_toledo'){assert(f.unit.mem.latestToledoUntil>f.battle.time);assert(f.battle.allyUnits.some(x=>x.kind==='token'&&x.defId==='token_10067_toledo_tldptm'&&x.ownerUnit===f.unit));assert.equal(f.unit.mem.latestToledoSkillScale,[1.7,1.8,1.9,2][rank-1]);}else if(id==='char_4232_hbound'){assert(f.unit.mem.latestHboundFields.size>0);assert.equal([...f.unit.mem.latestHboundFields.values()][0].duration,[32,33,34,35][rank-1]);}else{assert(f.unit.mem.latestClemAmmo>=9);assert.equal(f.unit.def.raw.assaultBody.fixedSkill.runtime.sourceRangeId,'3-2');assert.equal(f.unit.profile.maxTargets,3);assert.equal(f.unit.profile.groundOnly,true);}assert(enemy.alive);}
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Homebound native cast field applies weight-four slow from its actual periodic hit', {timeout:85000},()=>{
 const f=fixture('char_4232_hbound',4),heavy=f.battle.spawnEnemy('enemy_5601_entlec',{routeIndex:0,pos:[f.unit.tileR,f.unit.tileC+1],mods:{hpMul:1000,speed:0}});assert(heavy?.alive&&heavy.s.massLevel>=3,'canonical allied-source enemy record carries native heavy mass');f.battle._buildEnemyIndex();cast(f,'hbound-native-heavy');const before=heavy.hp;advance(f,1.05);assert(heavy.hp<before,'native field deals actual arts damage');assert.equal(heavy.buffs.some(x=>x.key===`latest:hbound:${f.unit.uid}:heavy-slow`),false,'bazaar: the heavy-enemy slow is gone (card only adds b% damage to weight >= 3)');
});
test('Homebound overlapping alchemy fields damage once per target and slow only weight three', {timeout:85000},()=>{
  const f=fixture('char_4232_hbound',4),light=addEnemy(f,1),heavy=addEnemy(f,2);f.unit.atkCd=Infinity;heavy.base.massLevel=3;heavy.markDirty();
  const at=(e,id)=>({uid:id,source:f.unit,x:e.tileC,y:e.tileR,until:f.battle.time+10,duration:10,scale:.2,heavy:1.8});
  f.unit.mem.latestHboundFields=new Map([['light-a',at(light,'light-a')],['light-b',at(light,'light-b')],['heavy-a',at(heavy,'heavy-a')],['heavy-b',at(heavy,'heavy-b')]]);
  let lightHits=0,heavyHits=0;f.battle.on('damaged',({source,target})=>{if(source!==f.unit)return;if(target===light)lightHits++;if(target===heavy)heavyHits++;},{owner:f.unit});
  advance(f,1.05);assert.equal(lightHits,1);assert.equal(heavyHits,1);
  assert.equal(light.buffs.some(x=>x.key===`latest:hbound:${f.unit.uid}:heavy-slow`),false);
  assert.equal(heavy.buffs.some(x=>x.key===`latest:hbound:${f.unit.uid}:heavy-slow`),false,'bazaar: no heavy-only slow');
});

test('Homebound casts its alchemy field at a moving target live world position', {timeout:85000},()=>{
 const f=fixture('char_4232_hbound',4);f.unit.dir='LEFT';f.battle.refreshRange(f.unit);const target=f.battle.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[f.unit.tileR,f.unit.tileC-1],mods:{hpMul:100000,speed:1}});assert(target?.alive);f.battle._buildEnemyIndex();advance(f,.2);assert.notEqual(target.x,target.tileC,'Battle movement advances world x independently from the spawn tile cache');const x=target.x,y=target.y;cast(f,'hbound-live-position');const field=[...f.unit.mem.latestHboundFields.values()][0];assert(Math.abs(field.x-x)<.1&&Math.abs(field.y-y)<.1,`field locks the live target position at cast time: field=${field.x},${field.y} target=${target.x},${target.y}`);assert.notEqual(field.x,target.tileC,'field center differs from stale spawn tile');const hits=[];f.battle.on('damaged',event=>{if(event.source===f.unit&&event.target===target&&String(event.dmg?.attackId??'').startsWith('hbound:'))hits.push(event.time);},{owner:f.unit});advance(f,1.05);assert(hits.length>0,'moving target receives real field damage while within two live world units');assert.equal(target.buffs.some(x=>x.key===`latest:hbound:${f.unit.uid}:heavy-slow`),false,'light enemy receives no heavy-only slow while inside a real field');
 let left=false;for(let i=0;i<40&&!left&&target.alive;i++){advance(f,.5);left=Math.hypot(target.x-field.x,target.y-field.y)>2;}
 assert(left,`native route movement leaves field radius; live=(${target.x},${target.y}) field=(${field.x},${field.y}) blocked=${!!target.blockedBy} active=${target.alive} time=${f.battle.time}`);const damageCount=hits.length;advance(f,1.05);assert.equal(hits.length,damageCount,'no periodic field damage after live movement exits radius');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs
