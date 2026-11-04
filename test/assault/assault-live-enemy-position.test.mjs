import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { bodyInKeys, bodyKeys } from '../../server/sim/body.js';
import { tileKeyOf } from '../../server/sim/targeting.js';
import { COLS } from '../../server/sim/constants.js';
import fs from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
import { rangedEliteCards } from '../../server/sim/content/assault/cards/ranged-elite.js';
import { rangedEliteTokenKits } from '../../server/sim/content/assault/cards/ranged-elite/tokens.js';
import { getAssaultData, loadAssaultDesign } from '../../server/modes/assault/data.js';
import { prepareAssaultBattle, createAssaultBattle } from '../../server/modes/assault/battle.js';
import { assaultKits } from '../../server/sim/content/assault/cards/assault.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json', import.meta.url), 'utf8'));

test('native moving enemy consumers use live x/y keys while allies retain deployment cells', () => {
  const route = { motion: 'WALK', start: [4, 2], end: [4, 9], checkpoints: [] };
  const h = makeBattle({ enemies: [], autoFinish: false, timeLimit: 30, routes: [route], content: 'full' });
  const enemy = h.spawn('enemy_1000_gopro_2', { route: route, pos: [4, 2], mods: { speedMul: 1, hpMul: 1000 } });
  assert(enemy?.alive);
  const spawnTile = enemy.tileR * COLS + enemy.tileC;
  const crossed = new Set([spawnTile]);
  h.b.start();
  for (let i = 0; i < 240 && tileKeyOf(enemy) === spawnTile; i++) h.b.step();
  assert.notEqual(tileKeyOf(enemy), spawnTile, 'native step advances live enemy position off its cached spawn tile');
  const liveKey = tileKeyOf(enemy);
  assert.equal(bodyInKeys(enemy, new Set([liveKey])), true, 'current-position range includes the moved enemy');
  assert.equal(bodyInKeys(enemy, crossed), false, 'old spawn-only range no longer matches the moved enemy');
  assert.equal(enemy.tileR * COLS + enemy.tileC, spawnTile, 'enemy tileR/tileC remain native spawn cache');
  assert.equal(h.b.errors.length, 0);
});

test('large native enemy hitArea remains included by range-key consumers at its live position', () => {
  const h = makeBattle({ enemies: [], autoFinish: false, timeLimit: 30, content: 'full' });
  const enemy = h.spawn('enemy_9013_acstmk', { route: 0, pos: [6, 8], mods: { speedMul: 0, hpMul: 1000 } });
  assert(enemy?.alive);
  assert(enemy.hitArea, 'fixture uses the native large-body hitArea');
  const occupied = bodyKeys(enemy);
  assert(occupied.length > 1, 'native large-body footprint occupies multiple tiles');
  assert.equal(bodyInKeys(enemy, new Set(occupied)), true, 'range helper intersects the complete current hitArea');
  const origin = tileKeyOf(enemy);
  assert.equal(bodyInKeys(enemy, new Set([origin])), true, 'position tile is in the large enemy footprint');
});

// replaced by the synergy cards of the assault family (design of 2026-10-21) — their lines are tested in test/assault/synergy-assault*.test.mjs

test('Heyak distance-scaled skill uses a moving enemy live projection instead of its spawn cell', () => {
  const charId='char_4027_heyak',body=runtime.bodies[charId],piece={uid:'live-position:heyak',charId,star:4,moduleChoices:{}};
  const chess=chessRec({id:piece.uid,charId,profession:body.profession,stats:body.starStats[3].stats,rangeGrid:body.range});chess.assaultPiece=piece;chess.assaultBody=body;
  const key='live-position:heyak-enemy',enemyDef=enemyRec({key,hp:1e8,atk:0,def:0,res:0,speed:1.5});
  const route={motion:'WALK',start:[10,6],end:[10,17],checkpoints:[]},data=new DataSource({chess:{[piece.uid]:chess},enemies:{[key]:enemyDef}},getDefaultSource());
  const battle=new Battle({seed:2046,kind:'normal',modeId:'live-position-heyak',stage:flatStage(),routes:flatRoutes(),spawns:[{enemyKey:key,time:0,routeIndex:0,route,pos:[10,6]}],data,
    players:[{playerId:'p1',units:[{uid:piece.uid,chessId:piece.uid,row:10,col:5}]}],content:'assault',assault:{kits:{...rangedEliteCards,...rangedEliteTokenKits},strict:true},
    flags:{dpInit:99,dpPerSec:0,dpMax:999,startOpCooldown:0},autoFinish:false,timeLimit:60,quiet:true,logger:{warn(){},error(){},info(){},log(){}}});
  battle.start();battle.step();const unit=battle.allyUnits.find(x=>x.uid===piece.uid),target=battle.enemies[0];assert(unit&&target);
  const cached=target.tileC;for(let i=0;i<1200&&target.x<7.1;i++)battle.step();
  assert(target.x>=7.1&&target.x<8,'real route movement reaches a new live cell still inside the native three-tile line distance');
  assert.equal(target.tileC,cached,'moving enemy retains its original deployment tile cache');
  const scaleValues=body.fixedSkill.effects[0].values, distance=target.x-unit.tileC, expectedScale=scaleValues.atkScaleMin[3]+(scaleValues.atkScaleMax[3]-scaleValues.atkScaleMin[3])*distance/3;
  const hits=[];battle.on('damaged',e=>{if(e.source===unit&&e.target===target&&e.dmg?.isSkill)hits.push(e);});
  unit.skill.sp=unit.skill.spCost;unit.skill.charges=1;assert.equal(unit.skill.activate('live-position-distance-probe'),true);battle.assaultRuntime.flush();battle.step();
  assert.equal(hits.length,1,'native skill produces one actual hit against the moving target');
  assert(Math.abs(hits[0].amount-unit.s.atk*expectedScale)<1e-5,`distance interpolation uses current x: expected ${expectedScale}, actual ${hits[0].amount/unit.s.atk}`);
  assert.equal(battle.errors.length,0);
});

test('Tinman device placement chooses the nearest legal tile to a moved enemy live position', () => {
  const data=getAssaultData(),design=loadAssaultDesign(),normal=design.encounters.encounters.find(x=>x.kind==='normal'),charId='char_4151_tinman';
  const body=data.runtime.bodies[charId],piece={uid:'live-position:tinman',charId,isPrimary:true,purchaseCharId:body.purchaseCharId,star:4,row:9,col:8,dir:'RIGHT',sourceCopies:1,moduleId:null,moduleChoices:{[charId]:null},permanentFlat:{},permanentPercent:{},tagEdits:{add:[],remove:[]},claimed:[],summonPresets:[]};
  const encounter={...normal,wave:{...normal.wave,spawns:[],dp:{...normal.wave.dp,init:99}}},prepared=prepareAssaultBattle({seed:2048,life:20,day:1,hour:1,pieces:[piece],nextBattleEffects:[]},encounter,{...data,design});
  const battle=createAssaultBattle(prepared,{...data,design,kits:assaultKits});battle.autoFinish=false;battle.start();battle.assaultRuntime.flush();
  const unit=battle.allyUnits.find(x=>x.uid===piece.uid),route={motion:'WALK',start:[9,9],end:[9,16],checkpoints:[]};assert(unit?.alive&&unit.deployed);
  const target=battle.spawnEnemy('enemy_1000_gopro_2',{route,routeIndex:0,pos:[9,9],mods:{speedMul:1,hpMul:100000}});assert(target?.alive);battle._buildEnemyIndex();
  const spawnX=target.x;for(let i=0;i<900&&target.x<spawnX+0.8;i++)battle.step();assert(target.x>=spawnX+0.8,'native enemy step moves before the device cast');
  const legal=(unit.rangeKeys??[]).map(k=>[Math.floor(k/COLS),k%COLS]).filter(([r,c])=>battle.grid.inRect(r,c)&&battle.grid.isLow(r,c)&&!battle._occ[r*COLS+c]?.alive&&!battle.downOn(r,c));
  assert(legal.length,'unit has native legal device cells');
  assert.equal(unit.skill.rule,'SP_FULL');assert.equal(unit.skill.spec.canCast({battle,unit}),true,'source skill gate accepts the live target/device action');
  assert(unit.skill.gainSp(unit.skill.spCost-unit.skill.sp,'live-position-tinman')>0);battle.assaultRuntime.flush();battle.step();battle.step();battle.assaultRuntime.flush();
  const device=battle.allyUnits.find(x=>x.kind==='device'&&x.ownerUnit===unit&&x.alive);assert(device,'Tinman device is deployed');
  const distance=([r,c])=>Math.hypot(target.y-r,target.x-c),chosen=distance([device.tileR,device.tileC]);
  assert(legal.every(tile=>chosen<=distance(tile)+1e-9),`device is nearest to current enemy x/y; chosen=${chosen} spawnX=${spawnX} liveX=${target.x}`);
  assert.equal(target.tileC,Math.round(spawnX),'device placement test preserves native spawn cell cache');
  assert.equal(battle.errors.length,0);
});
