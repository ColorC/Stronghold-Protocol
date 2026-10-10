#!/usr/bin/env node
// Uses the public session actions and the existing layout planner. No injected units, funds or outcomes.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSession, applyAction, validateSession, viewSession, BENCH_SIZE } from '../server/modes/independent/session.js';
import { getCatalog } from '../server/modes/independent/catalog.js';
import { getIndependentField } from '../server/modes/independent/battle.js';
import { totalEquipmentLevel, equipmentRecord } from '../server/modes/independent/equipment.js';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { planLayout } from '../server/match/bot.js';
import { modeIdFor } from '../shared/constants.js';
import { loadoutRecord } from '../shared/loadoutRecord.js';
import { nativeFactions } from '../shared/independentRules.js';
import { quantityEquippable } from '../shared/independentInventory.js';
import { operatorGrowthInfo, levelBodyStats } from '../shared/independentGrowth.js';
import { createRng, deriveSeed } from '../server/sim/rng.js';

const data = getData({log:{info(){},warn(){},error(){}}});
const catalog = getCatalog(data);
const ROUTES = ['assault', 'defense', 'skill'];
const rawFor=p=>data.chess[p.chessId] || catalog.operators[p.chessId]?.source?.normalChess;
const role = (p) => rawFor(p)?.profession;
const healing = (p) => role(p) === 'MEDIC';
const blocking = (p) => !healing(p) && Number(rawFor(p)?.stats?.blockCnt) > 0 && rawFor(p)?.position === 'MELEE';
const primaryDamage = (p) => !['MEDIC','TANK','PIONEER','TOKEN'].includes(role(p)) && Number(loadoutRecord(rawFor(p),p)?.stats?.atk || 0) > 0;
const damagePreference = (p) => {
  const profession=role(p);
  return (['CASTER','SNIPER','WARRIOR'].includes(profession)?160:['SPECIAL','SUPPORT'].includes(profession)?80:0) +
    Number(loadoutRecord(rawFor(p),p)?.stats?.atk || 0)/8;
};

function score(p, route, growthMode='badges', targetId='') {
  const rec = loadoutRecord(rawFor(p), p);
  const stats = growthMode==='levels' ? levelBodyStats({...p,growthMode},catalog,rawFor(p)) : rec?.stats || {};
  const gear = totalEquipmentLevel(p, catalog);
  const production = catalog.operators[p.chessId]?.nativeTrait?.effect;
  const prep=production?.prep||[];
  const selfGrowth=prep.some(x=>x.behavior==='badge'&&x.params?.targets==='self');
  const growthValue=selfGrowth?(growthMode==='levels'?55:35):prep.some(x=>x.behavior==='badge')?20:0;
  const growthSupport=prep.some(x=>x.behavior.startsWith('darkmoon')&&x.behavior.toLowerCase().includes('growth'))?125:0;
  return Number(catalog.operators[p.chessId]?.tier || rec?.tier || 1) * 100 + (p.elite ? 110 : 0) + gear * 15 +
    Number(stats.atk || 0) / 12 + Number(stats.maxHp || 0) / 150 +
    (growthMode==='levels' ? Math.max(0,(Number(p.growthLevel)||1)-1)*5 : 0) +
    (route === 'defense' ? (blocking(p) ? 20 : damagePreference(p)) : route === 'skill' && production?.combat?.length ? 60 : 0) +
    (production?.prep?.length ? 35 : 0) + growthValue + growthSupport + (targetId&&p.chessId===targetId?10000:0);
}
function mainFaction(pieces) {
  const counts=new Map();
  for(const p of pieces||[])for(const faction of nativeFactions(p,catalog))counts.set(faction,(counts.get(faction)||0)+1);
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||null;
}
function factionScore(chessId,pieces) {
  const faction=mainFaction(pieces);
  return faction?nativeFactions({chessId,equipment:[]},catalog).includes(faction)?90:0:0;
}
function shopTargets(state,excludeIndex=-1) {
  return state.shop.slots.map((slot,index)=>({slot,index})).filter(({slot,index})=>index!==excludeIndex&&!slot.sold&&slot.kind==='chess'&&slot.id)
    .sort((a,b)=>score({chessId:b.slot.id,equipment:[]},'assault')-score({chessId:a.slot.id,equipment:[]},'assault')).map(x=>x.index);
}
function actionTargetUid(state, candidateId,targetId='') {
  const candidateFactions=nativeFactions({chessId:candidateId,equipment:[]},catalog);
  const candidate=catalog.operators[candidateId];
  const requirements=(candidate?.nativeTrait?.effect?.prep||[]).filter(x=>x.behavior==='darkmoonBattlecryTargetGrowth').map(x=>x.params?.faction).filter(Boolean);
  const boughtTargetRequired=state.pieces.some(p=>(catalog.operators[p.chessId]?.nativeTrait?.effect?.prep||[])
    .some(x=>x.behavior==='darkmoonBoughtTribeTargetGrowth'&&candidateFactions.includes(x.params?.triggerFaction)));
  for(const p of state.pieces)for(const effect of catalog.operators[p.chessId]?.nativeTrait?.effect?.prep||[]) {
    if(effect.behavior==='darkmoonBattlecryTargetGrowth'&&candidateFactions.includes(effect.params?.faction))requirements.push(effect.params.faction);
  }
  const required=[...new Set(requirements)];
  const eligible=state.pieces.filter(p=>p.row!==null&&p.row!==undefined&&p.col!==null&&p.col!==undefined&&required.every(f=>nativeFactions(p,catalog).includes(f)))
    .sort((a,b)=>Number(b.chessId===targetId)-Number(a.chessId===targetId)+score(b,'assault')-score(a,'assault'));
  if(boughtTargetRequired&&eligible.length)return eligible[0].uid;
  if(eligible.length)return eligible[0].uid;
  if(required.every(f=>candidateFactions.includes(f))&&required.length)return `p${state.nextUid}`;
  const newPieceCouldReceive=(candidate?.nativeTrait?.effect?.prep||[]).some(x=>['darkmoonBoughtTribeTargetGrowth','darkmoonBattlecryTargetGrowth'].includes(x.behavior));
  return newPieceCouldReceive?(state.pieces.slice().sort((a,b)=>score(b,'assault')-score(a,'assault'))[0]?.uid||`p${state.nextUid}`):undefined;
}

export function playSeed({seed=1, difficulty, roundLimit=9, route='assault', growthMode='badges', targetId=''}={}) {
  if (!ROUTES.includes(route)) throw new Error('Unknown route');
  difficulty=difficulty|| (roundLimit===9?'FUNNY':'NORMAL');
  let state = createSession({seed, difficulty, roundLimit, growthMode});
  const trace = [];
  const actionLog = [];
  const rejectedActions = [];
  const rejectedSignatures = new Set();
  const repeatedRejectSkips = [];
  const battleReceipts=[];
  const summonPlacements=[];
  let actions = 0;
  const placeNativeSummons = () => {
    if (state.phase !== 'prep') return;
    for (let guard = 0; guard < 100; guard++) {
      const token = viewSession(state, { data, catalog }).pieces.find((p) => p.kind === 'token' && p.row == null && p.legalTiles?.length);
      if (!token) return;
      const [row, col] = token.legalTiles[0].split(',').map(Number);
      const action = { type: 'move', uid: token.uid, row, col };
      const result = applyAction(state, action, { data, catalog });
      if (!result.ok) {
        summonPlacements.push({ round: state.round, uid: token.uid, tokenId: token.tokenId, ownerUid: token.ownerUid, placed: false, code: result.error?.code || 'UNKNOWN' });
        return;
      }
      state = result.state; actions++; actionLog.push(action);
      summonPlacements.push({ round: state.round, uid: token.uid, tokenId: token.tokenId, ownerUid: token.ownerUid, row, col, placed: true });
    }
    throw new Error('native summon placement guard exceeded 100 actions in one prep phase');
  };
  const act = (action, strict=false) => {
    if (action.type === 'buy') placeNativeSummons();
    const actionRound=state.round;
    const signature=JSON.stringify(action);
    if(rejectedSignatures.has(signature)) {
      repeatedRejectSkips.push({round:state.round,action:structuredClone(action)});
      return {ok:false,error:{code:'PILOT_DUPLICATE_REJECTION_SKIPPED'}};
    }
    const result = applyAction(state, action, {data,catalog});
    if (result.ok) {
      state=result.state; actions++; actionLog.push(structuredClone(action));
      if(result.replay) {
        const enemies=new Map();
        const allies=new Map();
        for(const frame of result.replay.frames||[])for(const entry of Object.values(frame.stats||{})) {
          if(!entry.base?.maxHp)continue;
          const target=String(entry.defId||'').startsWith('enemy_')?enemies:String(entry.defId||'').startsWith('chess_')?allies:null;
          if(!target)continue;
          const old=target.get(entry.defId);
          target.set(entry.defId,{defId:entry.defId,maxHp:Math.max(old?.maxHp||0,Number(entry.maxHp||entry.base.maxHp)),
            atk:Math.max(old?.atk||0,Number(entry.atk||entry.base.atk)),baseHp:Number(entry.base.maxHp),baseAtk:Number(entry.base.atk)});
        }
        battleReceipts.push({round:actionRound,duration:result.replay.duration,frameCount:result.replay.frames?.length||0,
          enemies:[...enemies.values()],allies:[...allies.values()]});
      }
    }
    else {
      rejectedSignatures.add(signature);
      const slot=action.type==='buy'?state.shop.slots[action.slot]:null;
      rejectedActions.push({round:state.round,action:structuredClone(action),code:result.error?.code,message:result.error?.message,
        ...(slot?{slotId:slot.id,slotKind:slot.kind}:{}),
        ...(action.type==='buy'?{nextUid:state.nextUid,ownedUids:state.pieces.map(p=>p.uid),ownedFactions:state.pieces.map(p=>({uid:p.uid,factions:nativeFactions(p,catalog)})),triggerSources:state.pieces.flatMap(p=>(catalog.operators[p.chessId]?.nativeTrait?.effect?.prep||[]).filter(x=>['darkmoonBoughtTribeTargetGrowth','darkmoonBattlecryTargetGrowth'].includes(x.behavior)).map(x=>({uid:p.uid,chessId:p.chessId,behavior:x.behavior,params:x.params})))}:{})});
      if (strict) throw Object.assign(new Error(`${action.type}: ${result.error.code}: ${result.error.message}`),{pilotState:state,action,trace});
    }
    return result;
  };
  const pickOffers = () => {
    for (let guard=0; state.offers.length && guard<40; guard++) {
      const offer=state.offers.find(x=>x.type!=='operatorMerge') || state.offers[0];
      let chosen=false;
      if (offer.type==='operatorMerge') {
        const pieces=offer.pieceUids.map(uid=>state.pieces.find(p=>p.uid===uid)).filter(Boolean);
        const uniqueSelections={};
        for(const p of pieces) {
          for(const item of p.equipment) {
            const def=equipmentRecord(catalog,item.id);
            if(def?.unique) {
              const key=`equipment:${def.uniqueKey||def.canonicalId||item.id}`;
              uniqueSelections[key] ||= item.uid;
              if(item.elite) uniqueSelections[key]=item.uid;
            }
          }
          for(const attached of p.attachments) uniqueSelections[`attachment:${attached.id}`] ||= p.uid;
        }
        const result=act({type:'choose',offerId:offer.id,uniqueSelections});
        if(result.ok) continue;
        // An over-capacity set stays as ordinary bodies. The pilot can still play
        // and sell bodies through the public actions; it never discards assets.
        if(result.error?.code==='CAPACITY') break;
        throw new Error(`Merge offer failed: ${result.error?.message}`);
      }
      const prizeValue=id=>{
        const source=catalog.prizes[id]?.params?.sourceId;
        const weights={BGS_Treasures_009:520,BGS_Treasures_013:250,BGS_Treasures_033:300,
          BGS_Treasures_011:500,BGS_Treasures_015:450,BGS_Treasures_018:620,BGS_Treasures_020:550,
          BGS_Treasures_016:650,BGS_Treasures_028:850,BGS_Treasures_032:700,
          BGS_Treasures_022:400,BGS_Treasures_023:420,BGS_Treasures_025:300};
        if(source==='TB_Bacon_Secrets_12')return state.lp<20?750:350;
        if(id==='prize-logistics-production')return 500;
        if(id==='prize-logistics-refund')return 300;
        if(id==='prize-logistics-refresh')return 250;
        return weights[source]||0;
      };
      const rankedChoices=offer.choices.map((id,index)=>({id,index,value:(catalog.operators?.[id]?score({chessId:id,equipment:[]},route,growthMode,targetId):prizeValue(id)||
        (id==='growth-training-record'&&growthMode==='levels'?600:catalog.badges?.[id]&&growthMode==='levels'?450:catalog.badges?.[id]?350:catalog.equipment?.[id]?.mechanism==='growthTraining'&&growthMode==='levels'?500:0))}))
        .sort((a,b)=>b.value-a.value||a.index-b.index);
      for (const choice of rankedChoices) {
        const targets=[undefined,...state.pieces.slice().sort((a,b)=>score(b,route,growthMode,targetId)-score(a,route,growthMode,targetId)).map(p=>p.uid)];
        for (const targetUid of targets) {
          const action={type:'choose',offerId:offer.id,index:choice.index,targetUid:targetUid||actionTargetUid(state,choice.id,targetId)};
          const slots=shopTargets(state); if(slots.length){action.shopSlot=slots[0];action.shopSlots=slots;}
          if (act(action).ok) { chosen=true; break; }
        }
        if(chosen)break;
      }
      if (!chosen) throw new Error(`Unresolvable legal offer ${offer.id}`);
    }
  };
  const useKeptPrizes = () => {
    for(let pass=0;pass<3;pass++) {
      let changed=false;
      for(const item of state.inventory.slice()) {
        const def=catalog.prizes[item.id];
        if(!['darkmoonPrize','darkmoonTargetPrize'].includes(def?.mechanism)||state.phase!=='prep')continue;
        const source=def.params?.sourceId;
        if(source==='BGS_Treasures_014' && item.state?.lastUsedRound===state.round)continue;
        if(source==='BGS_Treasures_025' && state.funds>=state.incomeThisRound)continue;
        if(source==='TB_Bacon_Secrets_12' && state.playerEffects.some(x=>x.type==='darkmoonPrizeIceBlock'))continue;
        if(source==='BGS_Treasures_007' && !state.pieces.some(p=>p.row!=null&&p.col!=null))continue;
        const normalOnly=['BGS_Treasures_016','BGS_Treasures_034'].includes(source);
        const candidates=state.pieces.filter(p=>!normalOnly||!p.elite).slice().sort((a,b)=>score(b,route,growthMode,targetId)-score(a,route,growthMode,targetId));
        const target=def.mechanism==='darkmoonTargetPrize'?candidates[0]:null;
        if(def.mechanism==='darkmoonTargetPrize'&&!target)continue;
        const action={type:'use-item',itemUid:item.uid,...(target?{targetUid:target.uid}:{})};
        if(act(action).ok){changed=true;pickOffers();}
      }
      if(!changed)break;
    }
  };
  for (let turn=0; state.phase!=='finished' && turn<roundLimit+2; turn++) {
    pickOffers();
    const round=state.round;
    useKeptPrizes();
    placeNativeSummons();
    const targetLevel=Math.min(6,1+Math.floor(round/2));
    if (state.pieces.length>=4 || state.shop.upgradePrice===0) {
      while (state.shop.level<targetLevel && state.funds>=state.shop.upgradePrice+3) {
        if (!act({type:'upgrade'}).ok) break;
      }
    }
    for (let pass=0;pass<5 && state.funds>=3;pass++) {
      const ranked=state.shop.slots.map((slot,i)=>({slot,i})).filter(({slot})=>!slot.sold && slot.id)
        .sort((a,b)=>{
        const value=({slot})=>slot.kind==='chess' ? score({chessId:slot.id, equipment:[]},route,growthMode,targetId)+factionScore(slot.id,state.pieces)+
            state.pieces.filter(p=>p.chessId===slot.id).length*130 +
            (!state.pieces.some(primaryDamage)&&primaryDamage({chessId:slot.id})?400:0) +
            (route==='defense'&&blocking({chessId:slot.id})?(state.pieces.filter(blocking).length<2?220:-180):0) +
            (rawFor({chessId:slot.id})?.profession==='MEDIC' && state.pieces.some(p=>!healing(p)) && !state.pieces.some(healing) &&
              (route!=='defense' || state.pieces.some(p=>!healing(p)))?300:0) : -100;
          return value(b)-value(a);
        });
      let bought=false;
      for (const {slot,i} of ranked) {
        if (slot.kind==='equipment' && state.pieces.length<5) continue;
        if (slot.kind==='chess' && state.pieces.length>=12 &&
          !state.pieces.some(p=>p.chessId===slot.id) && score({chessId:slot.id,equipment:[]},route,growthMode,targetId)<Math.min(...state.pieces.map(p=>score(p,route,growthMode,targetId)))) continue;
        const action={type:'buy',slot:i};
        action.targetUid=actionTargetUid(state,slot.id,targetId);
        const shopSlots=shopTargets(state,i); if(shopSlots.length){action.shopSlot=shopSlots[0];action.shopSlots=shopSlots;}
        if (act(action).ok) { bought=true; pickOffers(); if(state.funds<3) break; }
      }
      // Spend replenished Gold and newly upgraded inventory in the same prep phase.
      useKeptPrizes();
      if (state.funds>=4 && pass<4) { if (!act({type:'refresh'}).ok) break; }
      else if (!bought) break;
    }
    pickOffers();
    useKeptPrizes();
    const ranked=state.pieces.slice().sort((a,b)=>(score(b,route,growthMode,targetId)+factionScore(b.chessId,state.pieces))-(score(a,route,growthMode,targetId)+factionScore(a.chessId,state.pieces)));
    const selected=[];
    const add=(p)=>{if(p && !selected.includes(p) && selected.length<state.deployCap)selected.push(p);};
    add(ranked.find(healing));
    ranked.filter(blocking).sort((a,b)=>{
      const priority=p=>factionScore(p.chessId,state.pieces)+score(p,route,growthMode,targetId);
      return priority(b)-priority(a);
    }).slice(0,2).forEach(add);
    if(route==='defense') ranked.filter(primaryDamage).sort((a,b)=>
      damagePreference(b)+score(b,route,growthMode,targetId)-damagePreference(a)-score(a,route,growthMode,targetId)
    ).slice(0,2).forEach(add);
    ranked.filter(p=>!blocking(p)).forEach(add);
    ranked.forEach(add);
    // 整备区 10 格 (session.js BENCH_SIZE): everyone goes back to the bench before the new layout, so the pilot keeps at
    // most BENCH_SIZE operators — it sells the weakest of those it will not deploy (temp ones included)
    for(const piece of ranked.slice().reverse()) {
      if(state.pieces.length<=BENCH_SIZE) break;
      if(!selected.includes(piece)) act({type:'sell',uid:piece.uid},true);
    }
    // Active summoners withdraw first: their unplaced position markers leave the bench with the owner.
    // This keeps a legal ten-operator roster from temporarily counting an eleventh marker during relayout.
    placeNativeSummons();
    const withdrawOrder=state.pieces.slice().sort((a,b)=>
      Number((state.summons||[]).some(x=>x.ownerUid===b.uid))-Number((state.summons||[]).some(x=>x.ownerUid===a.uid)));
    for(const piece of withdrawOrder) act({type:'bench',uid:piece.uid},true);
    const selectedUids=selected.map(p=>p.uid);
    for(const item of state.inventory.slice()) {
      const definition=equipmentRecord(catalog,item.id)||catalog.prizes?.[item.id];
      const targets=state.pieces.filter(p=>selectedUids.includes(p.uid)).sort((a,b)=>{
        const preference=p=>{
          let value=score(p,route,growthMode,targetId);
          if (['vitality','defense','unyielding'].includes(item.id)) value+=blocking(p)?300:0;
          if (item.id==='harmony') value+=healing(p)?500:0;
          return value-totalEquipmentLevel(p,catalog)*8;
        };
        return preference(b)-preference(a);
      });
      const remaining=state.inventory.find(x=>x.uid===item.uid);
      if(!remaining) continue;
      if(['darkmoonPrize','darkmoonTargetPrize'].includes(definition?.mechanism))continue;
      if(['补给','玩家设施','supply','facility'].includes(definition?.kind)||definition?.mechanism==='activeFundTopUp') {
        for(const target of [undefined,...targets]) if(act({type:'use-item',itemUid:item.uid,targetUid:target?.uid}).ok)break;
      } else {
        const quantity=(growthMode==='levels'&&definition?.mechanism==='growthTraining')||quantityEquippable(definition)?remaining.quantity:1;
        for(const target of targets) if(act({type:'equip',itemUid:item.uid,targetUid:target.uid,quantity}).ok)break;
      }
    }
    const field=getIndependentField(state,{data,catalog});
    const gd=new GameData(data,modeIdFor('solo',difficulty));
    // Only the planner's coordinate view is shifted; authoritative placements remain session actions.
    const shift=field.field==='normal'?0:7;
    const point=([r,c])=>[r+shift,c];
    const wave=shift?{...field.wave,routes:(field.wave.routes||[]).map(rt=>({...rt,start:point(rt.start),end:point(rt.end),checkpoints:(rt.checkpoints||[]).map(point)}))}:field.wave;
    const stage=shift?{...field.stage,groundPaths:{},groundPathsWithDevices:{},devices:[]}:field.stage;
    const m={gd,round:state.round,stageId:field.stageId,stage,wave,rngBots:createRng(deriveSeed(seed,`pilot-layout:${round}`))};
    const ps={deployMap:()=>field.deployMap,loadoutFor:rec=>state.pieces.find(p=>p.chessId===rec.chessId)||null};
    const layout=planLayout(m,ps,selected.map(p=>({...p,kind:'chess',id:p.chessId})),undefined,{recOf:p=>loadoutRecord(rawFor(p),p)});
    for(const [uid,key] of layout) {
      const [row,col]=key.split(',').map(Number);
      act({type:'move',uid,row,col,dir:layout.dirs.get(uid)},true);
    }
    placeNativeSummons();
    if(!state.pieces.some(p=>p.row!==null)) throw new Error('Pilot has no legal deployed piece');
    const before={round,lp:state.lp,funds:state.funds,shopLevel:state.shop.level,mainFaction:mainFaction(state.pieces),
      deployed:state.pieces.filter(p=>p.row!==null).map(p=>({chessId:p.chessId,level:p.growthLevel||null,equipmentLevel:totalEquipmentLevel(p,catalog),
        profession:rawFor(p)?.profession||null,blockCnt:Number(rawFor(p)?.stats?.blockCnt||0),position:rawFor(p)?.position||null,
        factions:nativeFactions(p,catalog)})),
      inventoryCount:state.inventory.reduce((n,i)=>n+i.quantity,0)};
    const whiteAndStartStats=Object.fromEntries(state.pieces.filter(p=>p.row!==null).map(p=>{
      const white=loadoutRecord(rawFor(p),p)?.stats||{};
      const growth=p.growthMode==='levels'?operatorGrowthInfo(p,catalog):null;
      const whiteAtk=Number(white.atk||0),whiteHp=Number(white.maxHp||0);
      return [p.uid,{chessId:p.chessId,white:{atk:whiteAtk,maxHp:whiteHp},
        levelCurve:growth?.stats||null,growthLevel:growth?.level??null,
        badgeIds:p.equipment.filter(x=>catalog.badges?.[x.id]).map(x=>({id:x.id,quantity:x.quantity}))}];
    }));
    act({type:'ready'},true);
    const errors=validateSession(state);
    if(errors.length) throw new Error('Pilot state invalid: '+errors.join(','));
    const combatUnits=(state.battleSummary?.result?.perPlayer?.independent?.unitStats||[]).filter(x=>x.kind==='op');
    const growth=state.pieces.map(p=>({uid:p.uid,chessId:p.chessId,level:p.growthLevel||null,badges:p.equipment.filter(x=>catalog.badges?.[x.id]).map(x=>({id:x.id,quantity:x.quantity})),nativeGrowth:p.nativeState?.growth||0}));
    trace.push({...before,afterLp:state.lp,battle:state.battleSummary,combatUnits,growth,whiteAndStartStats,
      battleReceipt:battleReceipts.find(x=>x.round===round),
      production:(state.production||[]).filter(e=>e.round===round),battleEvents:(state.history||[]).filter(e=>e.round===round && e.type==='battle').length});
  }
  if(state.phase!=='finished') throw new Error('Pilot exceeded bounded turns');
  return {seed,difficulty,roundLimit,route,growthMode,targetId,actions,rejectedActions,repeatedRejectSkips,actionLog,summonPlacements,rounds:trace.length,lp:state.lp,
    outcome:state.outcome,completed:state.phase==='finished'&&state.outcome==='win',bossHpLeft:state.battleSummary?.result?.bossHpLeft,trace,state};
}

async function main() {
  const options={};
  for(let i=2;i<process.argv.length;i+=2) {
    if(!process.argv[i].startsWith('--') || process.argv[i+1]===undefined)throw new Error('Options require values');
    options[process.argv[i].slice(2)]=process.argv[i+1];
  }
  const count=Number(options.seeds||3);
  if(!Number.isInteger(count)||count<1||count>100)throw new Error('seeds must be 1..100');
  const startSeed=Number(options['start-seed']||1);
  if(!Number.isInteger(startSeed)||startSeed<1)throw new Error('start-seed must be a positive integer');
  const modes=(options['growth-modes']||'badges,levels').split(',');
  const roundLimits=(options['round-limits']||options['round-limit']||'9,18').split(',').map(Number);
  const runs=[];
  for(const growthMode of modes)for(const roundLimit of roundLimits)for(const route of (options.routes||ROUTES.join(',')).split(','))for(let seed=startSeed;seed<startSeed+count;seed++) {
    try { runs.push(playSeed({seed,route,growthMode,targetId:options['target-id']||'',difficulty:options.difficulty,roundLimit})); }
    catch(error) { runs.push({seed,route,growthMode,roundLimit,error:error.message,action:error.action,state:error.pilotState,trace:error.trace,rounds:error.trace?.length||0,lp:error.pilotState?.lp||0,completed:false}); }
  }
  const groups=[...new Set(runs.map(x=>`${x.growthMode}/${x.roundLimit}/${x.route}`))].map(key=>{const [growthMode,roundLimit,route]=key.split('/');const r=runs.filter(x=>x.growthMode===growthMode&&x.roundLimit===Number(roundLimit)&&x.route===route);return {growthMode,roundLimit:Number(roundLimit),route,runs:r.length,wins:r.filter(x=>x.outcome==='win').length,losses:r.filter(x=>x.outcome==='loss').length,completed:r.filter(x=>x.completed).length,meanRounds:r.reduce((n,x)=>n+x.rounds,0)/(r.length||1),meanLp:r.reduce((n,x)=>n+x.lp,0)/(r.length||1),rejectedActions:r.reduce((n,x)=>n+(x.rejectedActions?.length||0),0)};});
  const report={createdAt:new Date().toISOString(),groups,runs};
  const output=resolve(options.output||'runtime/growth-destination-20261008/balance-qa/balance.json');
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({output,role:'seeded real-action balance experiment',groups:report.groups,errors:runs.filter(r=>r.error).map(r=>({seed:r.seed,route:r.route,growthMode:r.growthMode,round:r.state?.round,error:r.error}))},null,2));
  if(runs.some(r=>r.error))process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
