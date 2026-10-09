import test from 'node:test';
import assert from 'node:assert/strict';
import { resonanceContent } from '../../shared/resonance/catalog.js';

test('formal player text covers every fixed skill star and all pact/equipment effects',()=>{
  const text=resonanceContent.playerText;
  assert.ok(text,'player text is compiled into the formal catalog');
  assert.equal(text.diagnostics.length,0,JSON.stringify(text.diagnostics.slice(0,10)));
  assert.equal(Object.keys(text.operators).length,154);
  for(const [id,operator] of Object.entries(resonanceContent.operators)) {
    for(const star of [1,2,3]) {
      const description=text.operators[id].stars[star].skillDescription;
      if(operator.fixedSkillId==='resonance_judgement_support') assert.equal(description,null);
      else {
        assert.ok(description,`${operator.name} star ${star} has a rendered fixed skill`);
        assert.doesNotMatch(description,/〔[^〕]+〕|<@|<\$|sourceChessId|skchr_/);
      }
    }
  }
  assert.equal(Object.keys(text.pacts).length,35);
  for(const [id,pact] of Object.entries(resonanceContent.pacts)) {
    assert.equal(text.pacts[id].levels.length,pact.levels.length);
    for(const tier of text.pacts[id].levels) assert.ok(tier.description.trim(),`${id} ${tier.threshold}`);
  }
  assert.equal(Object.keys(text.equipment).length,Object.keys(resonanceContent.equipment).length);
  for(const item of Object.values(text.equipment)) assert.ok(item.description.trim());
  for(const group of [Object.values(text.pacts).flatMap(x=>x.levels),Object.values(text.equipment)])
    for(const row of group) assert.doesNotMatch(row.description,/undefined|NaN|\[object Object\]|<@|<\$/);
  const holyGun=text.pacts.holyGun.levels[0].description;
  assert.match(holyGun,/15%\/25%\/100%/);
  assert.match(text.pacts.aegir.levels[0].description,/2\.5%/);
  assert.match(text.pacts.siracusa.levels[0].description,/4000/);
  assert.match(text.equipment.staff.description,/攻击力\+10/);
  assert.match(text.equipment.staff.description,/技力自然回复每秒\+0\.1/);
  const cetsyr=Object.values(resonanceContent.operators).find(op=>op.fixedSkillId==='skchr_cetsyr_3');
  assert.match(text.operators[cetsyr.id].stars[3].skillDescription,/520%/);
  assert.match(text.operators[cetsyr.id].stars[3].skillDescription,/65%/);
});

test('pact prose only exposes conditional abilities at their selected threshold and separates Kjerag from Yela snow',()=>{
  const gated=[
    ['laterano','droneAt','无人机每'],['yan','formationAt','召唤阵'],['victoria','firewallAt','火墙'],
    ['columbia','rebuildAt','重构一次'],['kazimierz','solarAt','耀阳'],['siracusa','wolfAt','狼影'],
    ['leithania','silenceAt','沉默'],['higashi','deployTrueDamageAt','部署造成'],['combo','otherTargetAt','最近另一敌人'],
  ];
  for(const [id,key,phrase] of gated){
    const pact=resonanceContent.pacts[id],gate=pact.levels[0].effects.find(row=>row.params?.[key]!=null)?.params[key];
    if(!gate)continue;
    for(const tier of resonanceContent.playerText.pacts[id].levels){
      if(tier.threshold<gate)assert.doesNotMatch(tier.description,new RegExp(phrase),`${id} ${tier.threshold} does not preview ${key}`);
      else assert.match(tier.description,new RegExp(phrase),`${id} ${tier.threshold} includes ${key}`);
    }
  }
  const kjerag=resonanceContent.pacts.kjerag;
  assert.deepEqual(kjerag.levels.map(level=>level.effects.map(row=>row.kind)),[['kjerag_coordination'],['kjerag_coordination'],['kjerag_coordination']]);
  const [two,four,seven]=resonanceContent.playerText.pacts.kjerag.levels;
  for(const text of [two.description,four.description,seven.description])assert.doesNotMatch(text,/自然技力|寒冷|冻结|铺雪|雪地|法术伤害/);
  assert.doesNotMatch(two.description,/援射/);assert.doesNotMatch(four.description,/援射/);assert.match(seven.description,/第三名不同友方响应/);
  assert.match(resonanceContent.playerText.pacts.yela.levels[0].description,/铺雪/);
});

test('player projection presents finalized text rather than old skill description plus value appendix',async()=>{
  const {resonanceDisplayCatalog}=await import('../../server/modes/resonance/display.js');
  const display=resonanceDisplayCatalog(resonanceContent,null);
  const op=Object.values(resonanceContent.operators).find(x=>x.fixedSkillId!=='resonance_judgement_support');
  assert.equal(display.operators[op.id].stars[1].skill.description,resonanceContent.playerText.operators[op.id].stars[1].skillDescription);
  assert.equal(display.operators[op.id].stars[1].skill.values.length,0);
  for(const operator of Object.values(display.operators))for(const star of [1,2,3])assert.doesNotMatch(operator.stars[star].skill?.description??'',/随时停止技能|随时主动关闭|可以手动结束技能/,'automatic fixed skills cannot promise manual interruption');
  const yela=Object.values(display.operators).find(operator=>operator.name==='圣聆初雪');assert.equal(yela.stars[3].skill.duration,'永久');assert.equal(yela.stars[2].skill.duration,'30秒');
  const shu=Object.values(display.operators).find(operator=>operator.name==='黍');assert.match(shu.stars[1].skill.description,/治疗量为当前攻击力的100%/);
  const surtr=Object.values(display.operators).find(operator=>operator.name==='史尔特尔');assert.match(surtr.stars[3].skill.description,/最大生命10%\/秒/);
});

test('supply choices and environment text state the actual candidate counts and settlement targets',()=>{
  const campaign=resonanceContent.campaign;
  assert.equal(campaign.supply.components.optionCount,3);
  assert.equal(campaign.supply.components.countPerNode,2);
  const cabinet=Object.values(resonanceContent.strategies).find(row=>row.name==='零件柜');
  assert.deepEqual(cabinet.effects[0].params,{optionCount:8,count:2});
  const ammo=Object.values(resonanceContent.strategies).find(row=>row.name==='弹匣挑战');
  assert.equal(ammo.effects[0].params.optionCount,2);
  assert.match(resonanceContent.environments.origin_kjerag.description,/1秒寒冷/);
  assert.match(resonanceContent.environments.origin_sargon.description,/4个不重复.*仍领取2件/);
  assert.match(resonanceContent.environments.origin_rim.description,/第8节点/);
  assert.match(resonanceContent.environments.origin_ursus.description,/存活前线.*胜负.*5点生命/);
  assert.deepEqual(resonanceContent.environments.origin_ursus.rule.params,{minFront:2,hp:5,role:'frontline',survivorsOnly:true,anyResult:true});
});
