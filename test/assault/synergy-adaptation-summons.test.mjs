import test from 'node:test';
import assert from 'node:assert/strict';
import { synergyBattle, runtime } from '../helpers/synergyCard.js';
import { flatStage } from '../helpers/battleHarness.js';
import { Grid } from '../../server/sim/grid.js';
import { SUMMON_ADAPTATIONS } from '../../shared/assault/summon-adaptations.js';
import { MANUAL_TOKENS as ID } from '../../server/sim/content/assault/cards/adaptation-summons.js';
import { ledgerFor, summonPlacementLegal } from '../../server/sim/content/assault/summons.js';
import { hasStatus } from '../../server/sim/content/assault/synergy.js';
import { summonTemplateOptions } from '../../public/js/assault/model.js';

function setup(id,positions=[],extras=[]){const stage=flatStage();
  const high=['char_451_robin','char_4048_doroth','char_344_beewax','char_254_vodfox','char_393_toledo'].includes(id);
  const h=synergyBattle([{charId:id,row:10,col:high?2:3,piece:{summonPresets:positions.map(([r,c,dir='RIGHT'])=>({tokenId:ID[id.split('_').at(-1)],row:r,col:c,dir}))}},...extras],
    {beforeStart:b=>{b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);}});
  for(const unit of h.units){h.hold(unit);unit.profile.noAttack=true;unit.skill.rule='NEVER';}
  h.tokens=()=>h.battle.allyUnits.filter(t=>t.kind==='token'&&t.ownerUnit===h.units[0]&&t.alive&&t.deployed);
  return h;
}
const foe=(h,pos)=>h.spawn(pos,{mods:{hpMul:10000,speedMul:0}});
function movingFoe(h,from,to){const enemy=foe(h,from);enemy.tileR=from[0];enemy.tileC=from[1];[enemy.y,enemy.x]=to;h.battle._buildEnemyIndex();return enemy;}
function record(h){const hits=[];h.battle.on('hit',p=>hits.push(p),{priority:-100});return hits;}

test('eight summon signatures have original slots, strict card limits and visible manual placement options',()=>{
  for(const [id,plan] of Object.entries(SUMMON_ADAPTATIONS)){
    const body=runtime.bodies[id];assert.equal(body.source.skills[plan.index].skillId,body.fixedSkill.sourceSkillId);
    assert.ok(plan.lines.length<=3);assert.ok(plan.lines.every(l=>[...l].length<=32),`${id}: ${plan.lines}`);
    const options=summonTemplateOptions({runtime}, {charId:id});assert.equal(options.length,1,id);assert.equal(options[0].max,plan.manualSummons[0].max);
  }
});
test('paper shadow, obelisk, legend and radiant sword retain their original finite summon lifetimes',()=>{
  for(const[id,tile,seconds]of [['char_4016_kazema',[10,4],20],['char_344_beewax',[10,4],20],
    ['char_393_toledo',[10,4],20],['char_1014_nearl2',[10,4],25]]){
    const h=setup(id,[tile]);h.castNow(h.units[0]);assert.equal(h.tokens().length,1,id);const token=h.tokens()[0];
    h.run(seconds-.2);assert.equal(token.alive,true,id);h.run(.4);assert.equal(token.alive,false,id);assert.deepEqual(h.battle.errors,[]);
  }
});
test('Robin manual traps deploy free, keep all eight held copies and wait five seconds before spending native replacement DP',()=>{
  const h=setup('char_451_robin',[[10,4]]),[unit]=h.units;
  assert.equal(h.tokens().length,1);assert.equal(ledgerFor(h.battle,unit).stock.get(ID.robin),8);
  const enemy=foe(h,[10,4]),seen=record(h),paid=[];h.battle.on('deploy',p=>{if(p.unit.defId===ID.robin)paid.push(p.actualPaid);});
  h.battle.getPlayer(unit.ownerId).dp=100;h.run(.2);
  assert.equal(h.tokens().length,0);assert.equal(seen.filter(p=>p.source===unit&&p.dmg.type==='phys').length,1);
  assert.ok(enemy.moveAction||enemy.x!==4,'original force-two displacement occurred');
  enemy.x=9;enemy.y=12;enemy.tileR=12;enemy.tileC=9;h.battle._buildEnemyIndex();h.run(4.5);assert.equal(h.tokens().length,0);
  h.run(.6);assert.equal(h.tokens().length,1);assert.equal(ledgerFor(h.battle,unit).stock.get(ID.robin),7);
  assert.deepEqual(paid,[3]);assert.deepEqual(h.battle.errors,[]);
});
test('Robin only counts other allied device activations and accumulates three into one held trap',()=>{
  const h=setup('char_451_robin'),[unit]=h.units;const stock=()=>ledgerFor(h.battle,unit).stock.get(ID.robin);
  for(let i=0;i<3;i++)h.battle.emit('deviceTrigger',{source:unit,device:{ownerId:unit.ownerId}});h.flush();assert.equal(stock(),8);
  for(let i=0;i<3;i++)h.battle.emit('deviceTrigger',{source:{ownerId:unit.ownerId},device:{ownerId:unit.ownerId}});h.flush();assert.equal(stock(),9);
});
test('Dorothy keeps original radius-two cross and two-second delayed chain with no diagonal splash',()=>{
  const h=setup('char_4048_doroth',[[10,4],[10,6]]),[unit]=h.units;
  assert.equal(h.tokens().length,2);const first=foe(h,[10,4]),far=foe(h,[10,8]),diagonal=foe(h,[11,5]);
  const seen=record(h);h.run(.2);assert.ok(first.hp<first.s.maxHp);assert.equal(far.hp,far.s.maxHp);assert.equal(diagonal.hp,diagonal.s.maxHp);
  assert.equal(h.tokens().length,1);assert.ok(hasStatus(first,'sluggish'));h.run(1.6);assert.equal(far.hp,far.s.maxHp);
  h.run(.5);assert.ok(far.hp<far.s.maxHp);assert.equal(diagonal.hp,diagonal.s.maxHp);assert.equal(h.tokens().length,0);
  assert.equal(unit.mem.adaptDreamer,2);assert.equal(seen.filter(p=>p.source===unit&&p.target===far).length,1);assert.deepEqual(h.battle.errors,[]);
});
test('Kazemaru only summons on the chosen neighbour and repeats full dual actions while losing current rather than maximum HP',()=>{
  const empty=setup('char_4016_kazema');empty.castNow(empty.units[0]);assert.equal(empty.tokens().length,0);
  const h=setup('char_4016_kazema',[[10,4]]),[unit]=h.units;foe(h,[10,5]);const before=unit.hp,seen=record(h);
  h.castNow(unit);assert.equal(h.tokens().length,1);assert.equal(unit.hp,before*.5);
  const token=h.tokens()[0];assert.equal(token.tileR,10);assert.equal(token.tileC,4);assert.equal(token.profile.noAttack,false);
  assert.equal(seen.filter(p=>p.source===token&&p.dmg.isSkill).length,6);
  h.castNow(unit);assert.equal(unit.hp,before*.25);assert.equal(h.tokens().length,1);assert.equal(seen.filter(p=>p.source===token&&p.dmg.isSkill).length,12);
});
test('Kazemaru native fatal substitution keeps token attack/defence and one origami burst, then returns after the original switch period',()=>{
  const h=setup('char_4016_kazema'),[unit]=h.units,enemy=foe(h,[10,4]),seen=record(h);
  h.battle.dealDamage(enemy,unit,{amount:unit.s.maxHp*3,type:'true'});h.flush();assert.equal(unit.alive,true);assert.equal(unit.form,'doll');
  assert.equal(unit.s.atk,h.battle.tokenDef(ID.kazema,unit).stats.atk);assert.equal(unit.s.def,h.battle.tokenDef(ID.kazema,unit).stats.def);
  assert.equal(seen.filter(p=>p.source===unit&&p.dmg.type==='arts').length,1);h.run(21.2);assert.equal(unit.form,null);assert.equal(unit.s.atk,unit.base.atk);assert.deepEqual(h.battle.errors,[]);
});
test('Beeswax obelisk blocks three, includes its own tile in original stun burst and accumulated blocks charge actual nearby casters',()=>{
  const h=setup('char_344_beewax',[[10,3]],[{charId:'char_373_lionhd',row:11,col:2}]),[unit,ally]=h.units;
  const enemy=foe(h,[10,3]);h.castNow(unit);assert.equal(h.tokens().length,1);const token=h.tokens()[0];
  assert.equal(token.s.blockCnt,3);assert.ok(enemy.hp<enemy.s.maxHp);assert.ok(hasStatus(enemy,'stun'));
  h.hold(ally);for(let i=0;i<3;i++)h.battle.emit('blocked',{blocker:token,enemy});h.flush();assert.equal(ally.skill.sp,4);
  assert.equal(summonPlacementLegal(h.battle,unit,ID.beewax,12,10,{placementScope:'ownerRange'}),false);assert.deepEqual(h.battle.errors,[]);
});

test('Beeswax burst uses current enemy bodies rather than former spawn tiles',()=>{
 const h=setup('char_344_beewax',[[10,3]]),inside=movingFoe(h,[12,9],[10,4]),outside=movingFoe(h,[10,4],[12,9]);
 h.castNow(h.units[0]);assert.ok(inside.hp<inside.s.maxHp);assert.ok(hasStatus(inside,'stun'));
 assert.equal(outside.hp,outside.s.maxHp);assert.equal(hasStatus(outside,'stun'),false);assert.deepEqual(h.battle.errors,[]);
});

test('Dorothy explosions use current radius-two cross positions and keep diagonal exclusions',()=>{
 const h=setup('char_4048_doroth',[[10,4]]),inside=movingFoe(h,[12,9],[10,6]),outside=movingFoe(h,[10,6],[12,9]),diagonal=foe(h,[11,5]);
 foe(h,[10,4]);h.run(.2);assert.ok(inside.hp<inside.s.maxHp);assert.equal(outside.hp,outside.s.maxHp);
 assert.equal(diagonal.hp,diagonal.s.maxHp);assert.deepEqual(h.battle.errors,[]);
});

test('Shamare curse follows moving enemies into and out of the original nine-tile doll area',()=>{
 const h=setup('char_254_vodfox',[[10,5]]),inside=movingFoe(h,[12,9],[10,5]),outside=movingFoe(h,[10,5],[12,9]);
 for(const e of[inside,outside]){e.base.def=200;e.markDirty();}
 h.castNow(h.units[0]);h.run(.3);assert.ok(inside.s.def<inside.base.def);assert.equal(outside.s.def,outside.base.def);
 [inside.y,inside.x]=[12,9];h.battle._buildEnemyIndex();h.run(.6);assert.equal(inside.s.def,inside.base.def);assert.deepEqual(h.battle.errors,[]);
});
test('Shamare doll keeps real fifteen-second lifetime, exact surrounding attack/DEF debuff and no arbitrary deployment',()=>{
  const empty=setup('char_254_vodfox');empty.castNow(empty.units[0]);assert.equal(empty.tokens().length,0);
  const h=setup('char_254_vodfox',[[10,5]]),[unit]=h.units,enemy=foe(h,[10,5]);enemy.base.def=200;enemy.markDirty();h.castNow(unit);h.run(.3);
  assert.equal(h.tokens().length,1);assert.ok(enemy.s.atk<enemy.base.atk);assert.ok(enemy.s.def<enemy.base.def);h.run(15);
  assert.equal(h.tokens().length,0);assert.ok(enemy.s.atk>=enemy.base.atk);assert.deepEqual(h.battle.errors,[]);
});
test('Catherine directed devices choose the original forward cell and battle forge never multiplies HP/DEF on repeated casts',()=>{
  const h=setup('char_4162_cathy',[[10,4,'RIGHT']],[{charId:'char_199_yak',row:10,col:5},{charId:'char_103_angel',row:9,col:4}]),[unit,front,side]=h.units;
  assert.equal(h.tokens().length,1);h.run(1.1);const token=h.tokens()[0];assert.equal(token.mem.adaptCatTarget,front);
  assert.ok(front.buffs.some(b=>b.shield>0));assert.equal(side.buffs.some(b=>b.shield>0),false);
  h.castNow(unit);const hp=unit.s.maxHp,def=unit.s.def;h.castNow(unit);assert.equal(unit.s.maxHp,hp);assert.equal(unit.s.def,def);assert.equal(unit.profile.noAttack,true);
  const enemy=foe(h,[10,6]);h.hold(front);h.battle.dealDamage(enemy,front,{amount:unit.s.maxHp,type:'true'});h.flush();assert.equal(front.skill.sp,4);
  h.run(1.2);assert.ok(front.buffs.some(b=>b.shield>0),'battle forge refills despite a recent hit');assert.deepEqual(h.battle.errors,[]);
});
test('Toledo retains a three-block legend, seven-second tremble and doubled conditional fragile',()=>{
  const h=setup('char_393_toledo',[[10,3]],[{charId:'char_150_snakek',row:11,col:3}]),[unit,ally]=h.units,enemy=foe(h,[10,3]);h.castNow(unit);h.step(3);
  const token=h.tokens()[0];assert.equal(token.s.blockCnt,3);assert.ok(hasStatus(enemy,'tremble'));assert.equal(enemy.blockedBy,token);
  h.run(.2);assert.ok(Math.abs(enemy.s.dmgTakenMul-1.32)<1e-7);h.run(7.2);assert.ok(Math.abs(enemy.s.dmgTakenMul-1.32)<1e-7);
  h.run(12.6);assert.equal(token.alive,false);h.battle._unblock(enemy);enemy.x=ally.x;enemy.y=ally.y;h.battle._checkBlock(enemy);h.battle._buildEnemyIndex();h.run(.3);
  assert.equal(enemy.blockedBy,ally);assert.ok(Math.abs(enemy.s.dmgTakenMul-1.16)<1e-7);
  assert.deepEqual(h.battle.errors,[]);
});
test('Nearl sun is a manual four-neighbour two-block object without attacks; each cast repeats the native true burst and attacks',()=>{
  const h=setup('char_1014_nearl2',[[10,4]]),[unit]=h.units,enemy=foe(h,[10,4]),seen=record(h);h.castNow(unit);h.step(2);
  const token=h.tokens()[0];assert.equal(token.s.blockCnt,2);assert.equal(token.profile.noAttack,true);assert.ok(hasStatus(enemy,'stun'));
  h.castNow(unit);const own=seen.filter(p=>p.source===unit);assert.ok(own.filter(p=>p.dmg.type==='true').length>=8);assert.equal(seen.some(p=>p.source===token),false);
  assert.equal(summonPlacementLegal(h.battle,unit,ID.nearl2,11,5,{placementScope:'adjacent4'}),false);assert.deepEqual(h.battle.errors,[]);
});
test('Nearl native deployment follows the previous actual Kazimierz deployment, with two true hits instead of one',()=>{
  const stage=flatStage(),seen=[];
  const h=synergyBattle([{charId:'char_420_flamtl',row:10,col:3},{charId:'char_1014_nearl2',row:10,col:4}],{beforeStart:b=>{
    b.stage=stage;b.stageId=stage.id;b.opts.stage=stage;b.grid=new Grid(stage,b.rect);
    b.spawnEnemy('enemy_1000_gopro_2',{routeIndex:0,pos:[10,5],mods:{hpMul:10000,speedMul:0}});b._buildEnemyIndex();
    b.on('hit',p=>{if(p.source?.def.charId==='char_1014_nearl2')seen.push(p);},{priority:-100});
  }});
  assert.equal(seen.length,2);assert.ok(seen.every(p=>p.dmg.type==='true'));assert.deepEqual(h.battle.errors,[]);
});
