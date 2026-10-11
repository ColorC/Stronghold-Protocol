import test from 'node:test';
import assert from 'node:assert/strict';
import {loadData} from '../../server/data.js';
import {getResonanceCatalog} from '../../server/modes/resonance/catalog.js';
import {prototypeSeason} from '../../shared/resonance/prototype-season.js';
import {factionSeason} from '../../shared/resonance/faction-season.js';
import {factionRoster} from '../../shared/resonance/faction-roster.js';
import {resonanceDisplayCatalog} from '../../server/modes/resonance/display.js';
import {resonanceCatalogPacket} from '../../server/modes/resonance/native-match.js';
const data=loadData(process.env.SP_DATA_DIR,{log:{warn(){},error(){}}});
const catalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:factionSeason.id});
test('all natural pacts preserve the pinned source thresholds and member fee distribution',()=>{
  assert.equal(factionSeason.heroes.length,57);
  assert.equal(new Set(factionSeason.heroes.map(h=>h.charId)).size,57);
  assert.equal(factionSeason.traits.filter(t=>t.group==='faction').length,10);
  for(const trait of factionSeason.traits){
    const source=prototypeSeason.traits.find(t=>t.sourceName===trait.sourceName);
    assert.ok(source,trait.name);
    assert.deepEqual(trait.effects.map(e=>[e.minUnits,e.maxUnits]),source.effects.map(e=>[e.minUnits,e.maxUnits]),trait.name);
    assert.deepEqual(trait.costDistribution,source.costDistribution,trait.name);
    const fees=trait.members.map(id=>factionSeason.heroes.find(h=>h.charId===id)?.cost).sort();
    const expected=Object.entries(source.costDistribution).flatMap(([fee,count])=>Array(count).fill(+fee)).sort();
    assert.deepEqual(fees,expected,trait.name);
  }
});
test('every active operator has native faction evidence and combat membership',()=>{
  for(const hero of factionSeason.heroes){
    const op=catalog.operators[hero.sourceChessId];
    const factions=factionSeason.traits.filter(t=>t.group==='faction'&&t.members.includes(hero.charId));
    assert.equal(factions.length,1,hero.operatorName);
    assert.ok(factionSeason.traits.some(t=>t.group==='combat'&&t.members.includes(hero.charId)),hero.operatorName);
    const faction=factionRoster.find(f=>f.id===factions[0].id);
    if(faction.nationId)assert.equal(op.source.normalChess.nationId,faction.nationId,hero.operatorName);
    else {assert.equal(faction.groupId,'abyssal');assert.ok(['斯卡蒂','幽灵鲨','歌蕾蒂娅'].includes(hero.operatorName));}
    for(const star of [1,2,3]){
      const stats=op.stars[star].stats,record=op.stars[star].record;
      assert.ok(stats.maxHp>=1500&&stats.def>=150&&stats.atk>100,hero.operatorName);
      assert.equal(stats.bat,op.source.normalChess.stats.bat,hero.operatorName);
      assert.deepEqual(record.bonds,[]);assert.deepEqual(record.garrisonIds,[]);
      if(star>1){assert.ok(stats.maxHp>op.stars[star-1].stats.maxHp);assert.ok(stats.atk>op.stars[star-1].stats.atk);}
    }
  }
});
test('runtime fixed quantities use native scale without changing source evidence or rates',()=>{
  const fields={creation:'MagicDamage',rhodes:'HPShieldAmount',bruiser:'TeamFlatHealth',dominator:'ShieldAmount',experiment:'MaxHealth'};
  for(const [id,key] of Object.entries(fields)){
    const old=prototypeSeason.traits.find(t=>t.id===id);
    for(const [index,level] of catalog.pacts[id].levels.entries()){
      assert.equal(level.sourceVariables[key],old.effects[index].variables[key]);
      assert.equal(level.effects[0].params.variables[key],old.effects[index].variables[key]*4);
    }
  }
  assert.equal(catalog.pacts.creation.levels[0].effects[0].params.variables.TriggerNumCrystals,20);
  const oldCatalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id});
  assert.equal(oldCatalog.pacts.dominator.levels[0].effects[0].params.variables.ShieldAmount,350);
});
test('all tiers expose readable player text and common rules only once',()=>{
  const view=resonanceDisplayCatalog(catalog,data);
  for(const pact of Object.values(catalog.pacts)){
    assert.ok(pact.summaryDescription&&pact.summaryDescription.length<200,pact.name);
    for(const tier of pact.levels){
      assert.ok(tier.description&&!/undefined|NaN|TFT\d|原型|每叠加/.test(tier.description),pact.name+': '+tier.description);
      assert.ok(tier.description.length<250,pact.name);
    }
    assert.equal(view.pacts[pact.id].summaryDescription,pact.summaryDescription);
    assert.equal(view.pacts[pact.id].nativeIconPath,pact.nativeIconPath);
    assert.equal(view.pacts[pact.id].group,pact.group);
  }
  assert.ok(!catalog.pacts.conqueror.levels.some(t=>t.description.includes('10、35、65')));
  assert.deepEqual(view.pacts.experiment.detailNotes,catalog.pacts.experiment.detailNotes);
  assert.equal(view.pacts.experiment.detailNotes.length,5);
  assert.ok(view.pacts.experiment.detailNotes.every(note=>note.name&&note.text&&!/undefined|NaN/.test(note.text)));
});
test('all granted operators are active, and trait grants belong to the granting trait',()=>{
  const active=new Set(catalog.config.activeOperatorIds);
  for(const row of factionSeason.augmentCandidates){
    const pact=catalog.pacts[row.traitId];
    for(const reward of row.grantedHeroes??[]){
      assert.ok(active.has(reward.operatorId),row.apiName);
      if(pact)assert.ok(pact.members.includes(reward.operatorId),`${row.apiName}: ${reward.name}`);
    }
  }
});
test('faction season native catalog packet keeps all 171 clean chess variants and pact presentation fields',()=>{
  const nativeChessId=(id,star)=>star===1?id:`resonance_${id}_star${star}`;
  const packet=resonanceCatalogPacket({data,catalog,displayCatalog:catalog,nativeChessId});
  const variants=factionSeason.heroes.flatMap(hero=>[1,2,3].map(star=>({hero,star,id:nativeChessId(hero.sourceChessId,star)})));
  assert.equal(variants.length,171);
  for(const {hero,star,id} of variants){
    const record=packet.data.chess[id];
    assert.ok(record,`${hero.operatorName} star ${star} is projected`);
    assert.equal(record.charId,hero.charId,`${hero.operatorName} star ${star} identity is preserved`);
    assert.deepEqual(record.garrisonIds,[],`${hero.operatorName} star ${star} has no native garrison acquisition effects`);
  }
  for(const trait of factionSeason.traits.filter(row=>row.group==='faction')){
    const projected=packet.catalog.pacts[trait.id];
    assert.equal(projected.summaryDescription,catalog.pacts[trait.id].summaryDescription,`${trait.name} summary survives packet projection`);
    assert.equal(projected.nativeIconPath,catalog.pacts[trait.id].nativeIconPath,`${trait.name} icon survives packet projection`);
  }
});
