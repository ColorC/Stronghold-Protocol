import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';
import { chessRec, enemyRec, flatRoutes, flatStage } from '../helpers/battleHarness.js';
// the full registry: a body already on its synergy card (design of 2026-10-21) gets that kit
import { assaultKits } from '../../server/sim/content/assault/cards/registry.js';
import { assaultAmmoState } from '../../server/sim/content/assault/ammo.js';

const canonical='E:/WindowsWorkspace/webworks/apps/stronghold-protocol';
const runtime=JSON.parse(fs.readFileSync(new URL('../../data/assault-runtime.json',import.meta.url),'utf8'));
const design=JSON.parse(fs.readFileSync(new URL('../../data/assault-design/roster-support.json',import.meta.url),'utf8'));
const plans=new Map(design.operators.map(x=>[x.charId,x]));
const revised=design.operators.filter(x=>['single-cast-v2','immediate-or-battle-growth-v1'].includes(x.fixedSkill.resolution));
// the old single-cast translations still in use: a body on its synergy card (design of 2026-10-21) is tested in synergy-support*.test.mjs
const updated=revised.filter(x=>!['synergy','adaptation'].includes(runtime.bodies[x.charId]?.bazaar?.format));
function fixture(id,star=1,moduleId=null,{empty=false,suppressInitialSkill=false}={}) {
  const ids=[id,'char_240_wyvern'];
  const records=ids.map((charId,index)=>{
    const body=structuredClone(runtime.bodies[charId]);
    if(body.adaptation)assert.equal(body.adaptation.sourceSkillId,body.source.skills[body.adaptation.sourceIndex].skillId,'fixture uses the compiled original-skill adaptation');
    else assert.deepEqual(body.fixedSkill.effects,plans.get(charId).fixedSkill.effects,'fixture requires the current normal compiled DTO');
    const piece={uid:index?'friend':'actor',charId,star,moduleChoices:moduleId&&index===0?{[id]:moduleId}:{}};
    const rec=chessRec({id:'single:'+piece.uid,charId,profession:body.profession,stats:body.starStats[star-1].stats,rangeGrid:body.range});
    rec.assaultPiece=piece;rec.assaultBody=body;return rec;
  });
  const def=enemyRec({key:'victim',hp:10000000,atk:0,speed:0,def:0,res:0});
  const data=new DataSource({chess:Object.fromEntries(records.map(r=>[r.chessId,r])),enemies:{victim:def}},getDefaultSource());
  const anchors=records.flatMap(rec=>(rec.assaultBody.deployAnchors??[]).map(a=>({...a,ownerUid:rec.assaultPiece.uid})));
  const b=new Battle({kind:'normal',modeId:'single-support',stage:flatStage(),routes:flatRoutes(),spawns:[],data,
    players:[{playerId:'p1',units:records.map((r,i)=>({uid:r.assaultPiece.uid,chessId:r.chessId,row:10,col:5+i}))}],
    content:'assault',assault:{kits:{...assaultKits},strict:true,deployAnchors:anchors},flags:{dpInit:99,dpPerSec:0,dpMax:999,startOpCooldown:0},
    autoFinish:false,timeLimit:120,quiet:true,logger:{warn(){},error(){},info(){},log(){}}});
  b.start();const u=b.allyUnits.find(t=>t.uid==='actor'),friend=b.allyUnits.find(t=>t.uid==='friend');
  const savedSpType=u.skill.spType;
  if(suppressInitialSkill){u.skill.sp=0;u.skill.spType='none';}
  friend.skill.spType='none';friend.hp=friend.s.maxHp*.25;u.hp=u.s.maxHp*.4;
  // Put the real friendly fixture on a legal cell of the actor's actual range.
  if(!u.rangeKeys.includes(friend.tileR*21+friend.tileC))for(const k of u.rangeKeys){if(b.relocate(friend,Math.floor(k/21),k%21))break;}
  const targets=[];
  if(!empty){
    const slots=[...u.rangeKeys].map(k=>[Math.floor(k/21),k%21]).filter(([r,c])=>b.grid.inRect(r,c)&&!(r===u.tileR&&c===u.tileC));
    for(const pos of slots.slice(0,3))targets.push(b.spawnEnemy('victim',{routeIndex:0,pos}));
    targets.push(b.spawnEnemy('victim',{routeIndex:0,pos:[u.tileR,u.tileC]}));
    const old=u.skill.spType;u.skill.spType='none';b.step();u.skill.spType=old;
  }
  if(suppressInitialSkill){u.skill.spType=savedSpType;u.skill.sp=0;}
  const cast=()=>{u.skill.setSpTotal(u.skill.spCost);return b.assaultRuntime.cast(u,{force:false});};
  return {b,u,friend,targets:targets.filter(Boolean),cast};
}

test('remaining instant support skills resolve legally at all four stars through native Battle',()=>{
  assert.equal(revised.length,32);
  for(const p of updated)for(const star of [1,2,3,4]){
    const f=fixture(p.charId,star);
    assert.equal(f.cast(),true,p.charId+' star '+star);
    assert.equal(f.b.errors.length,0,JSON.stringify({id:p.charId,star,errors:f.b.errors}));
    assert.equal(f.u.skill.active,false,p.charId+' must not leave an active caster skill');
  }
});

// 涤火杰西卡 / 号角 / 黍: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-5.test.mjs

test('native instant choices and fallback slots match source, including the one-skill Vanilla exception',()=>{
  const choices={char_107_liskam:0,char_2025_shu:0,char_4017_puzzle:0,char_4039_horn:0,char_4139_papyrs:0,char_4194_rmixer:0,char_420_flamtl:1,
    char_151_myrtle:1,char_181_flower:1,char_4056_titi:2,char_4148_philae:1,char_4222_taraxa:1,char_240_wyvern:0};
  // 伊内丝 is a deploy-cast passive on her synergy card (design of 2026-10-21): no native skill slot
  for(const [id,index]of Object.entries(choices)){const skill=plans.get(id).fixedSkill;assert.equal(skill.sourceIndex,index,id);assert.equal(skill.sourceSkillId,runtime.bodies[id].source.skills[index].skillId,id);}
});

// 角峰 / 菲莱: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-4.test.mjs

test('empty offensive casts retain their SP and never arm their old attack stances',()=>{
  for(const id of ['char_4017_puzzle','char_4039_horn','char_497_ctable','char_431_ashlok']){
    const f=fixture(id,1,null,{empty:true});f.u.skill.setSpTotal(f.u.skill.spCost);const before=f.u.skill.spTotal;
    assert.equal(f.b.assaultRuntime.cast(f.u,{force:false}),false,id);assert.equal(f.u.skill.spTotal,before,id);
    assert.equal(f.u.buffs.some(x=>x.key.endsWith(':ammo')),false,id);
  }
});

test('support advanced module routes still install and resolve at three and four stars',()=>{
  for(const p of updated)for(const mod of p.modulePlans.filter(m=>m.type==='ADVANCED'))for(const star of [3,4]){
    const f=fixture(p.charId,star,mod.id);assert.equal(f.cast(),true,`${p.charId} ${mod.id} ${star}`);
    assert.equal(f.b.errors.length,0,JSON.stringify({id:p.charId,module:mod.id,star,errors:f.b.errors}));
  }
});

// 角峰 / 菲莱: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-4.test.mjs

// 涤火杰西卡 / 号角 / 黍: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-5.test.mjs

// 刺玫 / 调香师: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-2.test.mjs

// 涤火杰西卡 / 号角 / 黍: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-5.test.mjs

// 刺玫 / 调香师: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support-2.test.mjs


// 万顷: replaced by the synergy card (design of 2026-10-21) — its lines are tested in test/assault/synergy-support.test.mjs
