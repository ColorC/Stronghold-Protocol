import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog, getResonanceCatalogForState } from '../../server/modes/resonance/catalog.js';
import { createSession, validateSession } from '../../server/modes/resonance/session.js';
import { prototypeSeason } from '../../shared/resonance/prototype-season.js';
import { factionSeason } from '../../shared/resonance/faction-season.js';
import { factionSeasonV2 } from '../../shared/resonance/faction-season-v2.js';
import { getActivePrototypeSeason, getPrototypeSeason, prototypeSeasonForCatalog } from '../../shared/resonance/season-registry.js';

const canonicalDataDir=process.env.SP_DATA_DIR??'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native';
const data=loadData(canonicalDataDir,{log:{warn(){},error(){}}});

test('registry resolves the three registered season objects without cross-mapping',()=>{
  assert.equal(getPrototypeSeason(prototypeSeason.id),prototypeSeason);
  assert.equal(getPrototypeSeason(factionSeason.id),factionSeason);
  assert.equal(getPrototypeSeason(factionSeasonV2.id),factionSeasonV2);
  assert.equal(getActivePrototypeSeason(),factionSeasonV2);
  assert.equal(factionSeasonV2.id,'resonance-factions-2');
  assert.deepEqual(factionSeasonV2.heroes,factionSeason.heroes,'season 2 keeps the season-1 roster');
  assert.throws(()=>getPrototypeSeason('__proto__'),new RegExp(`RESONANCE_UNKNOWN_SEASON:__proto__`));

  const oldCatalog={config:{seasonId:prototypeSeason.id},prototypeSeason};
  const factionCatalog={config:{seasonId:factionSeason.id},prototypeSeason:factionSeason};
  assert.equal(prototypeSeasonForCatalog(oldCatalog),prototypeSeason);
  assert.equal(prototypeSeasonForCatalog(factionCatalog),factionSeason);
  assert.notEqual(prototypeSeasonForCatalog(oldCatalog),prototypeSeasonForCatalog(factionCatalog));
  assert.notDeepEqual(prototypeSeason.heroes.map(hero=>hero.sourceChessId),factionSeason.heroes.map(hero=>hero.sourceChessId));
  assert.ok(factionSeason.heroes.length===57&&factionSeason.traits.length===26);
  const v2Catalog={config:{seasonId:factionSeasonV2.id},prototypeSeason:factionSeasonV2};
  assert.equal(prototypeSeasonForCatalog(v2Catalog),factionSeasonV2);
  assert.notEqual(prototypeSeasonForCatalog(factionCatalog),factionSeasonV2);
});

test('new sessions use active faction season 2 while Set 13 and faction season 1 sessions rebuild by seasonId',()=>{
  const activeCatalog=getResonanceCatalog(data,{rulesVersion:3,seed:773});
  const oldCatalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:prototypeSeason.id,seed:774});
  const firstFactionCatalog=getResonanceCatalog(data,{rulesVersion:3,seasonId:factionSeason.id,seed:775});
  assert.equal(activeCatalog.config.seasonId,factionSeasonV2.id);
  const firstFaction=createSession({seed:775,difficulty:'NORMAL',catalog:firstFactionCatalog});
  assert.equal(firstFaction.ok,true,firstFaction.error);
  assert.equal(firstFaction.state.seasonId,factionSeason.id);
  const restoredFirstFaction=getResonanceCatalogForState(data,firstFaction.state);
  assert.equal(restoredFirstFaction.config.seasonId,factionSeason.id,'a saved faction season 1 run keeps its pacts');
  assert.equal(restoredFirstFaction.pacts.conqueror.levels[0].effects[0].params.mechanic,'knockout_treasure');
  assert.equal(activeCatalog.pacts.conqueror.levels[0].effects[0].params.mechanic,'true_damage_block');
  assert.equal(oldCatalog.config.seasonId,prototypeSeason.id);

  const activeCreated=createSession({seed:773,difficulty:'NORMAL',catalog:activeCatalog});
  const oldCreated=createSession({seed:774,difficulty:'NORMAL',catalog:oldCatalog});
  assert.equal(activeCreated.ok,true,activeCreated.error);
  assert.equal(oldCreated.ok,true,oldCreated.error);
  assert.equal(activeCreated.state.rulesVersion,3);
  assert.equal(oldCreated.state.rulesVersion,3);
  assert.equal(activeCreated.state.seasonId,factionSeasonV2.id);
  assert.equal(oldCreated.state.seasonId,prototypeSeason.id);
  assert.equal(validateSession(activeCreated.state,{catalog:activeCatalog}).ok,true);
  assert.equal(validateSession(oldCreated.state,{catalog:oldCatalog}).ok,true);

  const restoredOld=getResonanceCatalogForState(data,oldCreated.state);
  const restoredActive=getResonanceCatalogForState(data,activeCreated.state);
  assert.equal(restoredOld.config.seasonId,prototypeSeason.id);
  assert.equal(restoredActive.config.seasonId,factionSeasonV2.id);
  assert.deepEqual(restoredActive.config.activeOperatorIds,factionSeasonV2.heroes.map(hero=>hero.sourceChessId));
  assert.deepEqual(restoredOld.config.activeOperatorIds,prototypeSeason.heroes.map(hero=>hero.sourceChessId));
  // an operator free of the deploy cap (正义骑士号) is in no pact this season: the trait member lists leave it out, nothing else differs
  const unaffiliated=new Set(Object.values(restoredActive.operators).filter(operator=>operator.ignoresDeployLimit).map(operator=>operator.charId));
  const withoutUnaffiliated=trait=>({...trait,members:trait.members.filter(id=>!unaffiliated.has(id))});
  assert.equal(unaffiliated.size,1);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredActive.prototypeMeta.traits)),JSON.parse(JSON.stringify(factionSeasonV2.traits.map(withoutUnaffiliated))));
  assert.deepEqual(JSON.parse(JSON.stringify(restoredOld.prototypeMeta.traits)),JSON.parse(JSON.stringify(prototypeSeason.traits)));
  const activeIds=new Set(restoredActive.config.activeOperatorIds);
  for(const trait of factionSeasonV2.traits){
    const pact=restoredActive.pacts[trait.id];
    assert.equal(pact.group,trait.group??'prototype-natural-trait',trait.id);
    assert.equal(pact.nativeIconPath,trait.nativeIconPath,trait.id);
    assert.deepEqual(pact.memberCharIds,[...withoutUnaffiliated(trait).members],trait.id);
    assert.ok(pact.members.every((id)=>activeIds.has(id)),`${trait.id} has no operators from another season`);
  }
});
