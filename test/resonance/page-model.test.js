import test from 'node:test';
import assert from 'node:assert/strict';
import { actionErrorText,adjacentDeployedPairs,choiceDescription,choiceLabel,detailHash,filterOperators,formatStat,isDeployed,parseDetailHash,pieceNum,prepView,roleLabel,strategyConditionText,strategyProgressText,strategyTimingText } from '../../public/js/resonance/model.js';

test('page model maps session identities to stable renderer ids without changing the source state',()=>{
 const state={pieces:[{uid:'p42',operatorId:'op_a',star:2,row:3,col:4,dir:'LEFT'},{uid:'p55',operatorId:'op_b',star:1,row:null,col:null}],nextEnemies:[{name:'敌人'}]};
 const before=structuredClone(state);const view=prepView(state);
 assert.deepEqual(view.board,[{uid:42,kind:'chess',id:'op_a',tier:1,items:[],row:3,col:4,dir:'LEFT'}]);
 assert.equal(view.hand[0].uid,55);assert.equal(view.nextEnemies[0].name,'敌人');assert.deepEqual(state,before);
 assert.equal(pieceNum('p7'),7);assert.equal(isDeployed(state.pieces[0]),true);assert.equal(isDeployed(state.pieces[1]),false);
});

test('player details use copyable stable fragments and readable numeric values',()=>{
 assert.equal(detailHash('operator','char_demo'),'#operator-char_demo');
 assert.equal(detailHash('item','a b'),'#item-a%20b');
 assert.equal(formatStat(125,'%'),'125%');assert.equal(formatStat(null),'—');
});

test('pact and disassembly choices identify their actual effect and equipment owner',()=>{
 const state={inventory:[{uid:'i1',itemId:'shield'}],pieces:[{uid:'p1',operatorId:'defender',star:2,row:1,equipment:[{uid:'i2',itemId:'sword'}]}]};
 const catalog={pacts:{arts:{name:'术式'}},equipment:{shield:{name:'反击镜'},sword:{name:'破阵刃'}},operators:{defender:{name:'星熊'}}};
 assert.equal(choiceLabel({type:'pact_tag'},'arts',state,catalog),'术式');
 assert.equal(choiceLabel({type:'disassemble'},'i1',state,catalog),'反击镜');
 assert.equal(choiceLabel({type:'disassemble'},'i2',state,catalog),'破阵刃 · 星熊');
 assert.equal(choiceLabel({type:'target_piece'},'p1',state,catalog),'星熊 · 2星');
});

test('catalog filters combine active pool, cost, pact, role, and text constraints',()=>{
 const ops={a:{name:'阿米娅',cost:2,pacts:['arts'],role:'caster'},b:{name:'星熊',cost:3,pacts:['defense'],role:'guard'},c:{name:'阿斯卡纶',cost:3,pacts:['arts'],role:'caster'}};
 assert.deepEqual(filterOperators(ops,['a','c'],{onlyActive:true,cost:3,pact:'arts',role:'caster',query:'阿'}).map(([id])=>id),['c']);
 assert.deepEqual(filterOperators(ops,['a'],{onlyActive:true}).map(([id])=>id),['a']);
});

test('choice cards expose strategy condition and timing, and player-safe action errors',()=>{
 const catalog={strategies:{s:{name:'战后补给',description:'战胜后获得组件',timing:'on-battle-end',condition:{kind:'metric_threshold',params:{metric:'胜利',threshold:3}}}},pacts:{},equipment:{},operators:{}};
 assert.equal(choiceDescription({type:'strategy'},'s',{},catalog),'战胜后获得组件 · 条件：达成胜利 3次 · 时点：战斗结算时');
 assert.equal(strategyConditionText({kind:'choose_adjacent_pair'}),'选择相邻的两名干员');
 assert.equal(strategyConditionText({kind:'gold_min',params:{value:8}}),'至少持有8金币可选');
 assert.equal(strategyTimingText('on-pick'),'选择后立即');
 assert.equal(strategyTimingText('battle-metric'),'达成战斗目标后');
 assert.equal(strategyConditionText('至少持有8金币可选'),'至少持有8金币可选');
 assert.equal(strategyTimingText('本局或经营节点期间'),'本局或经营节点期间');
 const displayed={strategies:{gold:{description:'支付金币后获得增益',condition:'至少持有8金币可选',timing:'本局或经营节点期间'}}};
 assert.equal(choiceDescription({type:'strategy'},'gold',{},displayed),'支付金币后获得增益 · 条件：至少持有8金币可选 · 时点：本局或经营节点期间');
 assert.equal(roleLabel('summoner'),'召唤');
 assert.equal(actionErrorText({code:'STALE_REVISION',message:'internal detail'}),'对局状态已变化，正在同步');
 assert.equal(actionErrorText({code:'INTERNAL_ERROR',message:'blackboard key'}),'操作没有完成，请检查当前阶段后重试');
});

test('selected strategy uses the server player-facing progress projection without exposing raw counters',()=>{
 assert.equal(strategyProgressText({progressText:'指定成员在场获胜 2/3'}),'指定成员在场获胜 2/3');
 assert.equal(strategyProgressText({progressText:'暂存金币将在第5节点返还',progress:0,threshold:3}),'暂存金币将在第5节点返还');
 assert.equal(strategyProgressText({progress:0,threshold:3,dueRound:5,held:8}), '');
 assert.equal(strategyProgressText({progress:0,threshold:3}),'');
});

test('detail fragments round-trip encoded ids for reload and hashchange navigation',()=>{
 const fragment=detailHash('inventory','piece item/4');
 assert.deepEqual(parseDetailHash(fragment),{kind:'inventory',id:'piece item/4'});
 assert.equal(parseDetailHash('#broken'),null);
});

test('recipe rewards identify the selected finished item and its components',()=>{
 const catalog={recipes:[{resultId:'blade',resultName:'破阵刃',names:['攻击组件','攻速组件']}],equipment:{blade:{name:'破阵刃'}}};
 assert.equal(choiceLabel({type:'recipe'},'blade',{},catalog),'破阵刃');
 assert.equal(choiceDescription({type:'recipe'},'blade',{},catalog),'攻击组件 + 攻速组件 → 破阵刃');
});

test('target strategy choices expose only actually adjacent deployed pairs',()=>{
 const state={pieces:[{uid:'p1',row:0,col:0},{uid:'p2',row:0,col:1},{uid:'p3',row:2,col:2},{uid:'p4',row:null,col:null}]};
 assert.deepEqual(adjacentDeployedPairs(state).map(pair=>pair.map(piece=>piece.uid)),[['p1','p2']]);
});
