import test from 'node:test';
import assert from 'node:assert/strict';
import {synergyBattle,runtime} from '../helpers/synergyCard.js';
import {redeployNow,hasStatus} from '../../server/sim/content/assault/synergy.js';
import {SKILL_RESOLUTIONS,CAST_PAYOFFS} from '../../shared/assault/skill-resolutions.js';
import {summonTemplateOptions} from '../../public/js/assault/model.js';
import {rotateOffset} from '../../server/sim/dir.js';

test('converted signatures keep native stats while repeatable resources and a one-time state follow their own rules',()=>{
  for(const charId of ['char_264_f12yin','char_263_skadi','char_204_platnm','char_199_yak','char_150_snakek','char_136_hsguma']) {
    const h=synergyBattle([{charId,row:9,col:3}]),[unit]=h.units;h.hold(unit);
    h.spawn([unit.tileR,unit.tileC+1]);
    const cast=()=>{if(unit.skill.kind==='passive'){const ok=redeployNow(h.battle,unit,unit);h.flush();h.battle.assaultRedeployChain=null;return ok;}return h.castNow(unit);};
    assert.equal(cast(),true,charId);
    const stats=()=>[unit.s.atk,unit.s.def,unit.s.maxHp,unit.s.res,unit.s.blockCnt];
    const first=stats();
    const once=charId==='char_204_platnm';
    for(let i=0;i<5;i++){unit.hp=unit.s.maxHp*.5;h.spawn([unit.tileR,unit.tileC+1]);assert.equal(cast(),!once,charId);}
    assert.deepEqual(stats(),first,charId);
    assert.deepEqual(h.battle.errors,[]);
  }
  assert.ok(Object.values({...SKILL_RESOLUTIONS,...CAST_PAYOFFS}).every(rule=>rule.steps.every(step=>step.action!=='grow')));
});

test('Muelsyse exposes the deployment-talent manifold to the manual placement controls',()=>{
  const options=summonTemplateOptions({runtime},{charId:'char_249_mlyss'});
  assert.ok(options.some(option=>option.tokenId==='token_10030_mlyss_wtrman'));
});

test('instant converted skills use the native skill range rather than the normal attack range',()=>{
  for(const dir of ['RIGHT','UP']) {
    const h=synergyBattle([{charId:'char_356_broca',row:dir==='UP'?9:10,col:4}]),[unit]=h.units;h.hold(unit);
    unit.dir=dir;h.battle.refreshRange(unit);
    const [dr,dc]=rotateOffset(0,3,dir);
    const inside=h.spawn([unit.tileR+dr,unit.tileC+dc]),outside=h.spawn([9,8]);
    const before=[inside.hp,outside.hp];
    assert.equal(unit.rangeKeySet.has((unit.tileR+dr)*21+unit.tileC+dc),false,'target is outside the ordinary attack range');
    assert.equal(h.castNow(unit),true,'native extended skill range allows the cast');
    assert.ok(inside.hp<before[0]);assert.equal(outside.hp,before[1]);assert.ok(hasStatus(inside,'sluggish'));
    assert.deepEqual(h.battle.errors,[]);
  }
});

test('Silverash Alter uses his 16-cell cone and grants two independent delayed strikes to EACH ally',()=>{
 const h=synergyBattle([{charId:'char_1045_svash2',row:10,col:3},{charId:'char_127_estell',row:9,col:6},{charId:'char_240_wyvern',row:12,col:6}]);
 const [silverash,a,b]=h.units;h.units.forEach(h.hold);b.dir='LEFT';h.battle.refreshRange(b);
 const echoes=[],nativeFx=h.battle.fx.bind(h.battle);h.battle.fx=(kind,data)=>{if(kind==='skillEcho')echoes.push(data);return nativeFx(kind,data);};
 const side=h.spawn([11,4]),outside=h.spawn([10,7]),bTarget=h.spawn([11,5]);
 const initial=[side.hp,outside.hp];assert.equal(h.castNow(silverash),true);assert.ok(side.hp<initial[0]);assert.equal(outside.hp,initial[1],'the old infinite front line is gone');
 assert.equal(h.castNow(silverash),true);assert.equal(silverash.mem.svash2Echoes[a.uid],2);assert.equal(silverash.mem.svash2Echoes[b.uid],2);
 assert.deepEqual(echoes,[],'the owner uses normal skill events without a duplicate granted-skill effect');
 const hits=[];h.battle.on('hit',({source,target,dmg})=>{if(dmg.isSkill&&(source===a||source===b))hits.push([source.uid,target.id,h.battle.time]);});
 redeployNow(h.battle,silverash,a);h.flush();h.run(1);assert.equal(hits.length,0,'deployment attack waits 1.1 seconds');h.run(.7);
 assert.equal(hits.filter(([who,id])=>who===a.uid&&id===outside.id).length,2);assert.equal(silverash.mem.svash2Echoes[b.uid],2,'one ally does not consume another ally reserve');
 redeployNow(h.battle,silverash,b);h.flush();h.run(1.7);assert.equal(hits.filter(([who,id])=>who===b.uid&&id===bTarget.id).length,2,'native cone rotates at the second ally');
 assert.deepEqual(echoes.map(effect=>effect.id),[a.id,a.id,b.id,b.id],'each recipient publishes its own native skill effect');
 assert.deepEqual(h.battle.errors,[]);
});
