import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_POLICIES, campaignRolePlan, canBlockGround, canFillFallbackRole, canOperatorUseTile, catalogForBalanceProfile, claimOptions, chooseRerollCore, copyTargetsForCampaign, designatedCoreInvestment, DIFFICULTIES, directionToward, ENVIRONMENTS, estimateOperatorPower, evaluateCampaignOffer, exceedsFrontlineBranchCap, policyLevelTarget, routeProfiles as campaignRouteProfiles, runCampaign } from '../../tools/resonance/balance-campaign.mjs';
import { ARCHETYPES, buildScenario, findArchetypeCatalog, makeArchetypeRoster, makePactTerminalRoster, pactProfile, routeSet, SCENARIO_CONFIGS } from '../../tools/resonance/archetype-balance.mjs';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { getResonanceField } from '../../server/modes/resonance/battle.js';
import { createSession } from '../../server/modes/resonance/session.js';

test('campaign coverage declares every environment and difficulty', () => {
  assert.equal(ENVIRONMENTS.length, 19);
  assert.equal(new Set(ENVIRONMENTS).size, 19);
  assert.deepEqual(DIFFICULTIES, ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']);
});

test('looser counterfactual clones only NORMAL enemy multipliers and runs through a real session and Battle',()=>{
  const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data',{log:{warn(){},error(){},info(){}}});
  const source=getResonanceCatalog(data,{environmentId:'origin_aegir',seed:20261009});
  const adjusted=catalogForBalanceProfile(source,'looser','NORMAL');
  assert.notEqual(adjusted,source);
  assert.equal(adjusted.campaign.enemyBalance.byDifficulty.NORMAL.regular.hpMultiplier,.65);
  assert.equal(adjusted.campaign.enemyBalance.byDifficulty.NORMAL.regular.atkMultiplier,.85);
  assert.equal(adjusted.campaign.enemyBalance.byDifficulty.NORMAL.regular.defMultiplier,.35);
  assert.equal(adjusted.campaign.enemyBalance.byDifficulty.NORMAL.terminal.hpMultiplier,.75);
  assert.equal(adjusted.campaign.enemyBalance.byDifficulty.NORMAL.terminal.bossPoolMultiplier,.6);
  assert.equal(source.campaign.enemyBalance.byDifficulty.NORMAL,undefined,'the compiled catalog remains unchanged');
  assert.equal(catalogForBalanceProfile(source,'looser','HARD'),source,'other difficulties retain their official profile');
  const formal=runCampaign({environmentId:'origin_aegir',difficulty:'NORMAL',seed:20261009,maxBattles:1,policy:'tempo'});
  const looser=runCampaign({environmentId:'origin_aegir',difficulty:'NORMAL',seed:20261009,maxBattles:1,policy:'tempo',balanceProfile:'looser'});
  assert.equal(formal.rows[0].enemyBalance.hpMultiplier,.8);
  assert.equal(looser.rows[0].enemyBalance.hpMultiplier,.65);
  assert.equal(looser.rows[0].enemyBalance.resMultiplier,1);
  assert.equal(looser.rows[0].enemyBalance.speedMultiplier,1);
  assert.equal(formal.rows[0].diagnostics,0);
  assert.equal(looser.rows[0].diagnostics,0);
  assert.equal(formal.rows[0].summonAnchorGaps.length,0);
  assert.equal(looser.rows[0].summonAnchorGaps.length,0);
});

test('tempo, reroll, and rush have explicit level schedules',()=>{
  assert.deepEqual(CAMPAIGN_POLICIES,['tempo','reroll','rush']);
  assert.deepEqual([3,5,9,13,18,24].map(round=>policyLevelTarget('tempo',round)),[4,5,6,7,8,9]);
  assert.deepEqual([3,5,9,13,18,24].map(round=>policyLevelTarget('reroll',round)),[4,4,6,7,8,9]);
  assert.deepEqual([3,5,9,13,18,24].map(round=>policyLevelTarget('rush',round)),[3,3,6,6,9,9]);
  assert.ok(estimateOperatorPower({role:'damage',stars:{1:{stats:{atk:200,bat:1,aspd:100,maxHp:1000,def:100,blockCnt:1}}}})>400);
});

test('reroll core selection compares actual anti-air DPS instead of survivability score',()=>{
  const make=(id,atk,bat,hp)=>({id,charId:id,cost:2,role:'damage',pacts:[],stars:{1:{stats:{atk,bat,aspd:0,maxHp:hp,def:0,blockCnt:0},record:{canHitFly:true}}}});
  const catalog={config:{environmentId:'origin_test'},environments:{origin_test:{identityPactId:'p'}},operators:{fast:make('fast',160,1,600),durable:make('durable',220,3,90000),lowCost:{...make('lowCost',1000,1,1000),cost:1}}};
  const state={shop:{offers:[{operatorId:'fast',cost:2},{operatorId:'durable',cost:2},{operatorId:'lowCost',cost:1}]}};
  assert.equal(chooseRerollCore(catalog,state),'fast','higher real DPS wins even when the slower candidate has extreme HP');
});

test('policy role plan requires native anti-air, healer, and legal blocker branches without counting duplicates',()=>{
  const catalog={operators:{
    blocker:{charId:'front',role:'frontline',stars:{1:{record:{canHitFly:false}}}},
    healer:{charId:'heal',role:'healer',stars:{1:{record:{canHitFly:false}}}},
    ranged:{charId:'air',role:'damage',stars:{1:{record:{canHitFly:true}}}},
    melee:{charId:'close',role:'damage',stars:{1:{record:{canHitFly:false}}}},
  }};
  const field={field:'normal',deployMap:new Map([['9,2','melee'],['9,3','melee'],['9,4','melee'],['10,2','melee']]),stage:{rows:Array(10).fill('.....'),tiles:{'.':{height:'LOW',buildable:'MELEE',groundPassable:true}}},wave:{routes:[{motion:'WALK',start:[9,2],end:[9,4]},{motion:'FLY',start:[9,4],end:[9,2]}]}};
  const pieces=[{uid:'f1',operatorId:'blocker'},{uid:'h1',operatorId:'healer'},{uid:'a1',operatorId:'ranged'},{uid:'a2',operatorId:'ranged'}];
  const state={level:4,pieces,environmentId:'origin_test'};
  assert.deepEqual(campaignRolePlan(state,catalog,field),{targets:{frontlines:1,healers:1,antiAir:2,combatOutput:2,capacity:4,unblockableGroundRoutes:0},owned:{frontline:1,healer:1,antiAir:2,combatOutput:2},missing:{frontline:0,healer:0,antiAir:0,combatOutput:0}});
});

test('each campaign policy uses real, deterministic session actions and battle outcomes',()=>{
  for(const policy of CAMPAIGN_POLICIES){
    const options={environmentId:'origin_laterano',difficulty:'NORMAL',seed:20261009,maxBattles:2,policy};
    const first=runCampaign(options),second=runCampaign(options);
    assert.equal(first.policy,policy);
    assert.equal(first.battles,2);
    assert.deepEqual(first.rows,second.rows);
    assert.equal(first.policyActions.fight,2);
    assert.equal(first.coreOffersSeen,first.coreOfferDecisions.length);
    assert.equal(first.coreOffersBought,first.coreOfferPurchases.length);
    assert.equal(first.coreOffersBought,first.designatedCorePurchases);
    for(const row of first.rows){
      assert.ok(Number.isFinite(row.battleTime),`${policy} stores native battle duration`);
      assert.ok(Number.isFinite(row.totalDamage)&&Number.isFinite(row.totalAttacks),`${policy} stores native damage/attack totals`);
      assert.ok(Number.isFinite(row.coreDamage)&&Number.isFinite(row.coreAttacks),`${policy} stores designated-core totals`);
      assert.equal(row.coreStock.operatorId,first.designatedCoreId,`${policy} records the exact selected core stock`);
      assert.ok(row.coreStock.owned>=row.coreStock.deployed,`${policy} core deployment is bounded by owned copies`);
    }
    assert.equal(first.diagnostics.battleErrors,0);
    assert.deepEqual(first.diagnostics.summonAnchorGaps,[]);
    assert.ok(first.rows.at(-1).roleCounts.healer>=1,`${policy} acquires and fields a healer as offers permit`);
    assert.ok(first.rows.every(row=>row.roleCounts.frontline>=row.roleTargets.frontlines),`${policy} blocks each required ground route`);
    assert.ok(first.rows.every(row=>row.roleCounts.antiAir>=row.roleTargets.antiAir),`${policy} fields native anti-air damage/control`);
    assert.ok(first.rows.every(row=>row.roleCounts.combatOutput>=row.roleTargets.combatOutput),`${policy} fills remaining capacity with real damage/control operators`);
    assert.ok(first.rows.every(row=>row.routeCoverage.uncoveredGroundRoutes.length===0),`${policy} puts each native ground blocker on its route`);
    assert.ok(first.rows.every(row=>row.vacantSlots===0||Object.values(row.roleDeficits).some(value=>value>0)),`${policy} never levels past its available role-complete roster`);
    assert.ok(Object.values(first.rows.at(-1).roleDeficits).every(value=>value===0),`${policy} fills role gaps once the native pool offers missing roles`);
    assert.ok(first.roleDecisions.some(decision=>decision.offers?.some(offer=>offer.reason==='no-role-merge-or-pact-upgrade'||offer.reason==='no-25-percent-net-improvement-or-pact-loss')),`${policy} rejects offers without an actual board/pact/merge reason`);
    assert.ok(first.roleDecisions.some(decision=>decision.chosen&&decision.offers?.some(offer=>offer.operatorId===decision.chosen&&['missing-route-blocker','missing-healer','missing-native-anti-air','missing-combat-output','next-copy-completes-2-star-merge','next-copy-completes-3-star-merge','advance-auxiliary-branch-to-2-copies','advance-core-toward-2-star','advance-core-toward-3-star','acquire-reroll-core','cross-next-main-pact-threshold','build-next-main-pact-tier','same-role-net-upgrade-25'].includes(offer.reason))),`${policy} buys only after a concrete progression/roster qualification`);
  }
});

test('campaign offer admission requires a real role, merge, pact, or 25-percent field upgrade',()=>{
  const field={field:'normal',deployMap:new Map([['9,2','melee'],['9,3','melee'],['9,4','ranged'],['10,2','ranged'],['10,3','ranged'],['10,4','melee'],['11,2','melee']]),stage:{rows:Array(14).fill('.............'),tiles:{'.':{height:'LOW',buildable:'ALL',groundPassable:true}}},wave:{routes:[{motion:'WALK',start:[9,2],end:[9,3]}]}};
  const op=(id,role,atk,pacts=[],canHitFly=false)=>({id,charId:id,role,cost:1,position:canHitFly?'RANGED':'MELEE',canDeployHighGround:canHitFly,pacts,stars:{1:{stats:{atk,bat:1,aspd:0,maxHp:1000,def:0,blockCnt:role==='frontline'?1:0},record:{canHitFly,rangeGrid:[[0,0]]}},2:{stats:{atk:atk*2,bat:1,aspd:0,maxHp:1000,def:0,blockCnt:1},record:{canHitFly,rangeGrid:[[0,0]]}},3:{stats:{atk:atk*3,bat:1,aspd:0,maxHp:1000,def:0,blockCnt:1},record:{canHitFly,rangeGrid:[[0,0]]}}}});
  const catalog={operators:{front:op('front','frontline',100,['p']),healer:op('healer','healer',10),air1:op('air1','damage',100,[],true),air2:op('air2','damage',100,[],true),weak:op('weak','damage',100),equal:op('equal','damage',100),upgrade:op('upgrade','damage',130,[],true),pactmate:op('pactmate','damage',140,['p'],true),q1:op('q1','damage',90,['q'],true),q2:op('q2','damage',100,['q'],true),branch:op('branch','damage',30),core:op('core','damage',60)},equipment:{},pacts:{p:{thresholds:[2]},q:{thresholds:[4]}},environments:{origin_test:{identityPactId:'p'},origin_acc:{identityPactId:'q'}}};
  const piece=(uid,operatorId,star=1,row=1,col=1)=>({uid,operatorId,star,row,col,extraPacts:[],equipment:[]});
  const base=[piece('f','front',1,9,2),piece('h','healer',1,9,3),piece('a','air1',1,10,2)];
  const state={level:3,pieces:base,strategies:[],environmentId:'origin_test'};
  assert.equal(evaluateCampaignOffer('healer', {level:3,pieces:[base[0],base[2]],strategies:[],environmentId:'origin_test'},catalog,field).reason,'missing-healer');
  assert.equal(evaluateCampaignOffer('equal',{...state,pieces:[...base,piece('w','weak',1,null,null)]},catalog,field).ok,false,'equal absolute utility is not a board improvement');
  assert.equal(evaluateCampaignOffer('upgrade',{...state,pieces:[...base,piece('w','weak',1,null,null)]},catalog,field).reason,'same-role-net-upgrade-25');
  const pactState={level:4,pieces:[base[0],base[1],base[2],piece('a2','air2',1,10,3)],strategies:[],environmentId:'origin_test'};
  assert.equal(evaluateCampaignOffer('pactmate',pactState,catalog,field).reason,'cross-next-main-pact-threshold');
  const accumulatingState={...pactState,environmentId:'origin_acc',pieces:[base[0],base[1],base[2],piece('q1p','q1',1,10,3)]};
  assert.equal(evaluateCampaignOffer('q2',accumulatingState,catalog,field).reason,'build-next-main-pact-tier','a useful distinct member can progress an incomplete tier without claiming immediate activation');
  assert.equal(evaluateCampaignOffer('branch',{...state,pieces:[...base,piece('b1','branch',1,null,null),piece('b2','branch',1,null,null)]},catalog,field).reason,'next-copy-completes-2-star-merge');
  const oneAuxiliary={...state,pieces:[...base,piece('b1','branch',1,null,null)]};
  assert.equal(evaluateCampaignOffer('branch',oneAuxiliary,catalog,field,'core').reason,'advance-auxiliary-branch-to-2-copies','one held auxiliary copy may acquire its second merge copy');
  const twoBranches={...state,pieces:[...base,piece('b1','branch',1,null,null),piece('x1','weak',1,null,null),piece('x2','weak',1,null,null),piece('y1','upgrade',1,null,null),piece('y2','upgrade',1,null,null)]};
  assert.equal(evaluateCampaignOffer('branch',twoBranches,catalog,field,'core').reason,'auxiliary-merge-branch-cap-2','a third auxiliary branch is rejected once two other merge branches are reserved');
  const finishedAuxiliaries={...state,pieces:[...base,piece('x2star','weak',2,null,null),piece('y2star','upgrade',2,null,null),piece('branch1','branch',1,null,null)]};
  assert.equal(evaluateCampaignOffer('branch',finishedAuxiliaries,catalog,field,'core').reason,'advance-auxiliary-branch-to-2-copies','completed two-star auxiliaries no longer occupy unfinished merge branch slots');
  const surplusOnTwoStar={...state,pieces:[...base,piece('branch2star','branch',2,null,null),piece('branchSurplus','branch',1,null,null)]};
  assert.equal(evaluateCampaignOffer('branch',surplusOnTwoStar,catalog,field,'core').reason,'auxiliary-already-2-star','non-core units do not accumulate extra copies to chase three stars');
  const coreProtected={...state,pieces:[piece('f','front',1,1,1),piece('h','healer',1,1,2),piece('c','core',2,2,1)]};
  assert.equal(evaluateCampaignOffer('upgrade',coreProtected,catalog,field,'core').ok,false,'a full board cannot sell the deployed core to admit an upgrade');
});

test('designated high-cost core has one legal investment branch beyond frontline cap and copy chase stops at three stars',()=>{
  const field={field:'normal',deployMap:new Map([['9,2','melee'],['9,3','melee'],['9,4','ranged'],['10,2','ranged'],['10,3','ranged'],['10,4','melee'],['11,2','melee']]),stage:{rows:Array(14).fill('.............'),tiles:{'.':{height:'LOW',buildable:'ALL',groundPassable:true}}},wave:{routes:[{motion:'WALK',start:[9,2],end:[9,3]}]}};
  const mk=(id,role,cost,pacts=[])=>({id,charId:id,role,cost,pacts,stars:{1:{stats:{atk:120,bat:1,aspd:0,maxHp:1000,def:100,blockCnt:role==='frontline'?1:0},record:{canHitFly:false,rangeGrid:[[0,0]]}},2:{stats:{atk:240,bat:1,aspd:0,maxHp:2000,def:200,blockCnt:role==='frontline'?1:0},record:{canHitFly:false,rangeGrid:[[0,0]]}},3:{stats:{atk:360,bat:1,aspd:0,maxHp:3000,def:300,blockCnt:role==='frontline'?1:0},record:{canHitFly:false,rangeGrid:[[0,0]]}}}});
  const catalog={operators:{f1:mk('f1','frontline',2,['p']),f2:mk('f2','frontline',2,['p']),core:mk('core','frontline',5,['p']),healer:mk('healer','healer',2),air:mk('air','damage',2)},equipment:{},pacts:{p:{thresholds:[2]}},environments:{origin_test:{identityPactId:'p'}}};
  const piece=(uid,operatorId,star=1,row=null,col=null)=>({uid,operatorId,star,row,col,extraPacts:[],equipment:[]});
  const state={level:5,pieces:[piece('f1','f1',1,9,2),piece('f2','f2',1,null,null),piece('h','healer',1,9,3),piece('a','air',1,10,2)],strategies:[],environmentId:'origin_test',poolRemaining:{core:7}};
  assert.equal(evaluateCampaignOffer('core',state,catalog,field,'core').reason,'designated-core-investment','the intended five-cost core may be held even while two frontline branches exist');
  assert.equal(designatedCoreInvestment('core',catalog.operators.core,[],'core'),true);
  assert.equal(designatedCoreInvestment('other',catalog.operators.core,[],'core'),false,'unselected five-cost offers stay on ordinary qualification');
  assert.equal(exceedsFrontlineBranchCap('core',catalog.operators.core,state,catalog,false,'core'),false,'the designated core does not consume an auxiliary frontline branch slot');
  assert.equal(exceedsFrontlineBranchCap('other',catalog.operators.core,state,catalog,false,'core'),true,'a non-target frontline still obeys the two-branch limit');
  const copyState={...state,pieces:[...state.pieces,piece('core2','core',2)],poolRemaining:{core:5}};
  assert.ok(copyTargetsForCampaign(copyState,catalog,'core').some(target=>target.uid==='core2'&&target.star===2),'a two-star designated core remains a legal universal-copy target');
  const maxed={...copyState,pieces:[...copyState.pieces,piece('core3','core',3)]};
  assert.ok(!copyTargetsForCampaign(maxed,catalog,'core').some(target=>target.operatorId==='core'),'once the core is three-star, spare copies are reserved for other eligible branches');
  assert.equal(evaluateCampaignOffer('core',maxed,catalog,field,'core').reason,'designated-core-already-3-star','the shop stops buying extra copies after the core reaches three stars');
});

test('first campaign battle buys and fields the available next-pact member before fighting',()=>{
  const run=runCampaign({environmentId:'origin_kjerag',difficulty:'NORMAL',seed:0x504f4c49,maxBattles:1,policy:'tempo'});
  assert.ok(run.policyActions.buy>=1);
  assert.equal(run.policyActions.fight,1);
  assert.ok(run.roleDecisions.some(decision=>decision.chosen&&decision.offers?.some(offer=>offer.operatorId===decision.chosen&&offer.reason==='cross-next-main-pact-threshold')));
  assert.ok(run.rows[0].roster.some(piece=>piece.name==='耶拉'));
  assert.ok(run.rows[0].mainPacts.some(pact=>pact.id==='kjerag'&&pact.threshold===2));
  assert.equal(run.rows[0].vacantSlots,0);
});

test('fixed battle archetypes cover the requested ten identities and stay within level caps', () => {
  assert.equal(ARCHETYPES.length,10);
  assert.deepEqual(ARCHETYPES.map(x=>x.id),['low-cost','ammo','snow','aegir-counter','yan-skills','columbia-constructs','kazimierz-true-damage','siracusa-execution','sui-trio','element-burn-necrosis']);
  const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data',{log:{warn(){},error(){},info(){}}});
  for(const def of ARCHETYPES){
    const {catalog}=findArchetypeCatalog(data,def);
    assert.equal(catalog.config.activeOperatorIds.length,65);
    assert.ok(def.include.every(name=>catalog.config.activeOperatorIds.includes(Object.values(catalog.operators).find(o=>o.name===name).id)));
    for(const cfg of SCENARIO_CONFIGS)for(const star of [2,3]){
      const roster=makeArchetypeRoster(catalog,def,cfg.level,star,cfg.assistantStar,2,cfg.phase==='terminal');
      assert.ok(roster.length<=cfg.level);
      assert.equal(roster.find(x=>x.name===def.core).star,star);
      assert.ok(roster.filter(x=>x.name!==def.core).every(x=>x.star===2));
      assert.ok(def.include.every(name=>roster.some(x=>x.name===name)),`fixed lineup preserves ${def.id} members`);
      assert.ok(roster.filter(x=>x.role==='frontline').length>=2);
      assert.ok(roster.filter(x=>x.role==='healer').length>=1);
      assert.ok(roster.filter(x=>['damage','control','summoner'].includes(x.role)).length>=2);
    }
    for(const cfg of SCENARIO_CONFIGS){
      const scenario=buildScenario({data,catalog,definition:def,config:cfg,coreStar:2,seed:371});
      const coverage=scenario.equipment.routeCoverage;
      assert.ok(coverage.groundFrontlines.every(x=>x.blocksGround&&x.distanceToPath===0));
      assert.ok(coverage.healer.coveredFrontlineCells.length<=coverage.healer.frontlineCells.length);
      assert.ok(coverage.routes.every(route=>route.originalIndices.length>0&&route.points.length>1));
      assert.ok(coverage.uncoveredGroundRoutes.every(index=>coverage.routes[index]?.motion==='WALK'));
      assert.ok(coverage.core.coveredRoutes.length>0);
      assert.ok(scenario.state.pieces.every(p=>canOperatorUseTile(catalog.operators[p.operatorId],scenario.field.deployMap,p.row,p.col)));
      if(cfg.phase==='terminal'){
        assert.equal(scenario.state.pieces[0].equipment.length,3);
        assert.ok(scenario.equipment.transferCount<=2);
        assert.ok(coverage.bossRouteIndices.length>0,`${def.id} terminal battle identifies the actual leader route`);
        assert.equal(coverage.core.coversBossRoute,true,`${def.id} core range covers the actual leader route`);
        const pact=pactProfile(scenario.state.pieces,catalog)[def.pact];
        assert.ok(pact.activeTier>=pact.thresholds.at(-1),`${def.id} completes its main pact tier`);
      }
    }
  }
  assert.deepEqual(SCENARIO_CONFIGS.map(x=>`${x.round}/${x.level}`),['12/6','12/7','20/8','20/9','28/10']);
});

test('19-origin terminal pact rosters stay within the active pool and preserve frontline/healing roles',()=>{
  const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data',{log:{warn(){},error(){},info(){}}});
  for(const origin of ['aegir','laterano','kjerag','yan','victoria','columbia','kazimierz','siracusa','rhodes','lungmen','sargon','leithania','iberia','higashi','ursus','bolivar','rim','babel','sami']){
    const catalog=getResonanceCatalog(data,{environmentId:`origin_${origin}`,seed:1});
    const lineup=makePactTerminalRoster(catalog,10,2);
    assert.equal(catalog.config.activeOperatorIds.length,65);
    assert.equal(lineup.roster.length,10);
    if(origin==='lungmen')assert.equal(lineup.core.lowCostCore,true,'Lungmen reports its highest-cost main-pact core exception');
    else assert.ok(lineup.core.cost>=4,`${origin} selects a four- or five-cost terminal core`);
    assert.ok(lineup.roster.filter(piece=>piece.role==='frontline').length<=2,`${origin} does not pad the terminal team with excess frontlines`);
    assert.ok(lineup.roster.filter(piece=>piece.role==='frontline').length>=2,`${origin} has two frontline roles`);
    assert.ok(lineup.roster.some(piece=>piece.role==='healer'),`${origin} has healing`);
    assert.ok(lineup.roster.filter(piece=>['damage','control','summoner'].includes(piece.role)).length>=2,`${origin} has combat roles`);
    assert.ok(lineup.roster.slice(1).every(piece=>piece.star===2));
    assert.ok(lineup.roster.every(piece=>catalog.config.activeOperatorIds.includes(piece.operatorId)));
    assert.equal(lineup.constructible,true,`${origin} reaches its highest supported terminal tier`);
    if(lineup.constructible){
      const scenario=buildScenario({data,catalog,definition:{id:`terminal-${origin}`,env:`origin_${origin}`,core:lineup.core.name,include:[],pact:lineup.mainPact},config:{...SCENARIO_CONFIGS.at(-1),transferLimit:lineup.transferLimit},coreStar:2,seed:319,rosterOverride:lineup.roster});
      const pact=pactProfile(scenario.state.pieces,catalog)[lineup.mainPact];
      assert.ok(pact.activeTier>=lineup.threshold,`${origin} reaches its main pact tier with no more than two transfers`);
      assert.ok(scenario.state.pieces[0].equipment.length===3);
      assert.ok(scenario.equipment.transferCount<=lineup.transferLimit);
    }
  }
});

test('route profiles consume native groundPathsWithDevices and preserve fly checkpoints',()=>{
  const field={stageId:'mock',stage:{groundPathsWithDevices:{'9,10->9,2':[[9,10],[9,8],[10,8],[9,2]]}},wave:{routes:[
    {motion:'WALK',start:[9,10],end:[9,2],checkpoints:[]},
    {motion:'WALK',start:[9,10],end:[9,2],checkpoints:[]},
    {motion:'FLY',start:[9,10],end:[9,2],checkpoints:[[9,8],[10,8]]},
  ]}};
  const routes=routeSet(field);
  assert.equal(routes.length,2);
  assert.deepEqual(routes[0].points,field.stage.groundPathsWithDevices['9,10->9,2']);
  assert.equal(routes[1].motion,'FLY');
  assert.deepEqual(routes[1].points,[[9,10],[9,8],[10,8],[9,2]]);
});

test('terminal boss targeting resolves the spawned native patrol path and retains its source route index',()=>{
  const data=loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data',{log:{warn(){},error(){},info(){}}});
  const catalog=getResonanceCatalog(data,{environmentId:'origin_yan',seed:2});
  const created=createSession({catalog,environmentId:'origin_yan',seed:2});
  assert.equal(created.ok,true);
  created.state.round=28;created.state.level=10;
  const field=getResonanceField(created.state,{data,catalog});
  const leaderIndex=field.wave.spawns.find(spawn=>spawn.tag==='boss')?.routeIndex;
  assert.ok(Number.isInteger(leaderIndex),'native boss spawn selects a route');
  const leaderRoute=routeSet(field).find(route=>route.originalIndices.includes(leaderIndex));
  assert.ok(leaderRoute,`leader source route ${leaderIndex} is retained`);
  assert.equal(leaderRoute.motion,'WALK');
  assert.equal(leaderRoute.source,'native-grid-route','patrol legs are expanded using the battle grid pathfinder');
  assert.ok(leaderRoute.points.length>field.wave.routes[leaderIndex].checkpoints.length+2,'path includes the intermediate native movement tiles');
});

test('campaign route profiles retain native paths and original indices across extra routes',()=>{
  const field={field:'normal',stage:{groundPathsWithDevices:{'9,10->9,2':[[9,10],[9,8],[10,8],[9,2]]}},wave:{routes:[
    {motion:'WALK',start:[9,10],end:[9,2]},
    {motion:'WALK',start:[9,10],end:[9,2]},
  ],extraRoutes:[{motion:'FLY',start:[12,10],end:[9,2],checkpoints:[[12,8],[9,8]]}]}};
  const profiles=campaignRouteProfiles(field);
  assert.equal(profiles.length,2);
  assert.deepEqual(profiles[0].originalIndices,[0,1]);
  assert.deepEqual(profiles[0].points,field.stage.groundPathsWithDevices['9,10->9,2']);
  assert.deepEqual(profiles[1].originalIndices,[2]);
  assert.deepEqual(profiles[1].points,[[12,10],[12,8],[9,8],[9,2]]);
});

test('campaign route profiles ignore unspawned templates and keep only spawned checkpoint routes',()=>{
  const field={field:'normal',wave:{routes:[
    {motion:'WALK',start:[9,1],end:[9,8],checkpoints:[[8,3]]},
    {motion:'WALK',start:[8,1],end:[8,8],checkpoints:[[8,4]]},
    {motion:'WALK',start:[7,1],end:[7,8],checkpoints:[[7,4]]},
  ],spawns:[{routeIndex:1,tag:'normal'},{routeIndex:1,tag:'leader'}]}};
  const routes=campaignRouteProfiles(field);
  assert.equal(routes.length,1,'a route with several spawns is still one actual path');
  assert.deepEqual(routes[0].originalIndices,[1]);
  assert.deepEqual(routes[0].points,[[8,1],[8,4],[8,8]],'checkpoints are retained in travel order');
});

test('campaign resolves recipe and identity-transfer choices from live lineup value',()=>{
  const catalog={operators:{a:{charId:'char-a',pacts:['aegir'],role:'damage'}},environments:{origin_aegir:{identityPactId:'aegir'}},pacts:{aegir:{thresholds:[2,4]},laterano:{thresholds:[2,4]}},equipment:{weak:{effects:[{kind:'component_stat',params:{atk:1}}]},strong:{effects:[{kind:'component_stat',params:{atk:100}}]}}};
  const state={environmentId:'origin_aegir',pieces:[{uid:'p1',operatorId:'a',row:1,col:1,star:2}],inventory:[],strategies:[]};
  assert.deepEqual(claimOptions({type:'recipe',remaining:1,options:['weak','strong']},state,{...catalog,recipes:[{resultId:'weak'},{resultId:'strong'}]}),['strong']);
  assert.deepEqual(claimOptions({type:'identity_transfer',remaining:1,options:['laterano','aegir']},state,catalog),['aegir']);
});

test('ranged units can use a melee tile and face toward the incoming route', () => {
  const map = new Map([['10,6', 'melee']]);
  assert.equal(canOperatorUseTile({ position: 'RANGED' }, map, 10, 6), true);
  assert.equal(canOperatorUseTile({ position: 'MELEE' }, map, 10, 6), true);
  assert.equal(canOperatorUseTile({ position: 'MELEE' }, new Map([['10,6','ranged']]), 10, 6), false);
  assert.equal(canOperatorUseTile({ position: 'MELEE', canDeployHighGround: true }, new Map([['10,6','ranged']]), 10, 6), true);
  assert.equal(directionToward(10, 6, [10, 8]), 'RIGHT');
  assert.equal(directionToward(10, 6, [8, 6]), 'UP');
});

test('frontline scoring rejects passable fence tiles that cannot block ground enemies', () => {
  const field = { field:'normal', stage:{rows:['###','###','###'],tiles:{'#':{height:'LOW',buildable:'ALL',groundPassable:false},'.':{height:'LOW',buildable:'ALL',groundPassable:true}}} };
  field.stage.rows=['...','.#.','...'];
  assert.equal(canBlockGround(field,1,1),false);
  assert.equal(canBlockGround(field,1,0),true);
});

test('fallback deployment preserves frontline and healer role limits', () => {
  assert.equal(canFillFallbackRole('frontline',{frontline:1},{frontlineLimit:2}),true);
  assert.equal(canFillFallbackRole('frontline',{frontline:2},{frontlineLimit:2}),false);
  assert.equal(canFillFallbackRole('healer',{healer:1},{healerLimit:1}),false);
  assert.equal(canFillFallbackRole('damage',{frontline:2,healer:1}),true);
});

test('campaign policy uses real session actions and deterministic recorded outcomes', () => {
  const options = { environmentId: 'origin_laterano', difficulty: 'NORMAL', seed: 12345, maxBattles: 2 };
  const first = runCampaign(options);
  const second = runCampaign(options);
  assert.equal(first.battles, 2);
  assert.deepEqual(first.rows, second.rows);
  assert.ok(first.rows.every(row => Number.isInteger(row.hpAfter) && row.hpAfter >= 0));
  assert.ok(first.rows.every(row => Number.isInteger(row.goldBefore) && Number.isInteger(row.goldAfter)));
  assert.ok(first.rows.every(row => row.roster.every(piece => piece.uid && piece.operatorId && Number.isInteger(piece.row) && Number.isInteger(piece.col) && piece.dir)));
  assert.ok(first.rows.every(row => Array.isArray(row.routeCoverage.routes)&&row.routeCoverage.groundFrontlines.every(front=>front.blocksGroundPath&&front.distanceToPath===0)));
  assert.ok(first.rows.every(row => row.routeCoverage.healerCoverage.every(healer=>healer.coveredFrontlines.length>=row.roleCounts.frontline)));
  assert.ok(first.rows.every(row => row.roleCounts.frontline>=1&&row.roleCounts.damage+row.roleCounts.control+row.roleCounts.summoner>=(row.level>=6?2:1)));
  assert.ok(first.rows.every(row => ![...row.roster,...row.benchReserve].some(piece=>piece.role==='healer')||row.roleCounts.healer>=1));
  assert.ok(first.rows.every(row => Array.isArray(row.mainPacts) && Number.isInteger(row.refreshesSpent)));
  assert.ok(first.policyActions && Number.isInteger(first.policyActions.fight));
  assert.equal(first.diagnostics.battleErrors, 0);
  assert.deepEqual(first.diagnostics.summonAnchorGaps, []);
  assert.equal(first.truncated, false);
});

test('full campaign ends with a native terminal outcome instead of a fabricated win result', () => {
  const run = runCampaign({ environmentId: 'origin_laterano', difficulty: 'NORMAL', seed: 20261009 });
  assert.equal(run.phase, 'complete');
  assert.ok(['hp-depleted', 'victory', 'round-limit-loss'].includes(run.terminalReason));
  assert.ok(run.battles > 0);
  assert.equal(run.rows.length, run.battles);
  assert.equal(run.diagnostics.battleErrors, 0);
  assert.deepEqual(run.diagnostics.summonAnchorGaps, []);
  assert.ok(run.rows.every(row => Number.isInteger(row.leaked) && Number.isFinite(row.leakPoints)));
  assert.ok(run.rows.every(row => row.roster.filter(piece => piece.role === 'healer').length <= 2));
  assert.ok(run.rows.every(row => row.roster.filter(piece => piece.role === 'frontline').every(piece => piece.blocksGround === true)));
  assert.ok(run.rows.filter(row => row.level >= 5).every(row => row.roster.filter(piece => piece.role === 'frontline').length >= row.roleTargets.frontlines && row.roster.filter(piece => piece.role === 'damage' || piece.role === 'control').length >= 1));
  assert.ok(run.rows.filter(row => row.level >= 5).some(row => new Set(row.roster.filter(piece => piece.role === 'frontline').map(piece => piece.routeIndex)).size >= Math.min(2,row.roleTargets.frontlines)));
});
