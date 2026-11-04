import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {synergyBattle,runtime} from '../helpers/synergyCard.js';
import {assertNoGenericGrowth} from '../helpers/focusedGrowth.js';
import {cycleLength} from '../../server/sim/content/assault/redeploy-cycle.js';
import {CARD_KEYWORDS} from '../../public/js/assault/mechanicsView.js';
import {RUN_CARD_GROWTH} from '../../shared/assault/growth-policy.js';

const native=JSON.parse(fs.readFileSync('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/assault-sources/arknights/excel/character_table.json','utf8'));
const text=JSON.parse(fs.readFileSync(process.env.ASSAULT_PUBLIC_TEXT_PATH||new URL('../../data/assault-public-text.json',import.meta.url),'utf8'));

test('growth stays confined while the adapted tranche uses its capped battle identities',()=>{
  const bodies=Object.values(runtime.bodies),scalers=bodies.filter(body=>body.bazaar.growthIdentity);
  assert.ok(scalers.length<=12);
  assert.equal(new Set(scalers.map(body=>body.bazaar.growthIdentity)).size,scalers.length);
  const adapted=bodies.filter(body=>body.adaptation);
  assert.ok(adapted.filter(body=>body.adaptation.roles.includes('runGrowth')).length<=8);
  assert.ok(adapted.filter(body=>body.adaptation.roles.includes('selfGrowth')).length<=25);
  for(const body of bodies) {
    for(const [index,line] of body.bazaar.lines.entries())if(!body.bazaar.growthIdentity&&['growth','stack'].includes(line.kind)) {
      if(line.kind==='growth'&&RUN_CARD_GROWTH[body.charId]){
        assert.ok(body.adaptation.roles.includes('runGrowth'));
        assert.deepEqual(text.operators[body.charId].card.lines[index].textByStar,Array(4).fill(RUN_CARD_GROWTH[body.charId].line));
        continue;
      }
      assert.equal(line.suppressed,true,body.charId);
      assert.equal(text.operators[body.charId].card.lines[index].textByStar.join(''),'');
    }
  }
  assert.equal(CARD_KEYWORDS.some(([word])=>word==='永久'),false);
  assert.doesNotMatch(JSON.stringify(text),/永久/);
});

for(const body of Object.values(runtime.bodies))test(`${body.name}: every star inherits original redeployment time`,()=>{
  const expected=native[body.charId]?.phases.at(-1).attributesKeyFrames.at(-1).data.respawnTime
    ??body.source.interpolatedAttributes.respawnTime;
  assert.deepEqual(body.starStats.map(row=>row.stats.respawnTime),Array(4).fill(expected));
  assert.deepEqual(body.bazaar.redeploySeconds,Array(4).fill(expected));
});

test('70-second ordinary operators and 18-second executors retain their original timing',()=>{
  for(const [charId,seconds] of [['char_1045_svash2',70],['char_103_angel',70],['char_237_gravel',18],['char_1028_texas2',18]]) {
    const h=synergyBattle([{charId,row:10,col:4}],{quiet:true}),[unit]=h.units;h.hold(unit);
    assert.equal(unit.base.respawnTime,seconds);
    assert.equal(cycleLength(unit),seconds);
    const count=unit.assaultCycle.count;h.run(seconds-1);assert.equal(unit.assaultCycle.count,count);
    h.run(1.2);assert.ok(unit.assaultCycle.count>count);assert.deepEqual(h.battle.errors,[]);
  }
});

test('Estelle keeps her native heal on a nearby allied kill without gaining maximum HP',()=>{
  const h=synergyBattle([{charId:'char_127_estell',row:10,col:4},{charId:'char_172_svrash',row:11,col:4}]);
  const [estelle,ally]=h.units;h.units.forEach(h.hold);estelle.hp=estelle.s.maxHp*.3;
  const max=estelle.s.maxHp,hp=estelle.hp,enemy=h.spawn([10,5]);
  h.battle.dealDamage(ally,enemy,{amount:1e9,type:'true'});h.flush();
  assert.ok(estelle.hp>hp);assert.equal(estelle.s.maxHp,max);assertNoGenericGrowth(h);
});

test('ordinary operators cannot acquire the retired bonuses through extra triggers',()=>{
  for(const charId of ['char_172_svrash','char_103_angel','char_240_wyvern','char_263_skadi','char_171_bldsk']) {
    const h=synergyBattle([{charId,row:10,col:4},{charId:'char_151_myrtle',row:9,col:4}]),[,ally]=h.units;h.units.forEach(h.hold);
    const enemy=h.spawn([10,5]);h.battle.dealDamage(ally,enemy,{amount:1e9,type:'true'});h.flush();
    assert.equal(h.castNow(ally),true);
    assertNoGenericGrowth(h);
    assert.equal(Object.keys(h.battle.assaultBattleStacks??{}).length,0);
  }
});
