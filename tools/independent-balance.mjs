#!/usr/bin/env node
// Uses the public session actions and the existing layout planner. No injected units, funds or outcomes.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSession, applyAction, validateSession } from '../server/modes/independent/session.js';
import { getCatalog } from '../server/modes/independent/catalog.js';
import { getIndependentField } from '../server/modes/independent/battle.js';
import { totalEquipmentLevel, equipmentRecord } from '../server/modes/independent/equipment.js';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { planLayout } from '../server/match/bot.js';
import { modeIdFor } from '../shared/constants.js';
import { loadoutRecord } from '../shared/loadoutRecord.js';
import { createRng, deriveSeed } from '../server/sim/rng.js';

const data = getData({log:{info(){},warn(){},error(){}}});
const catalog = getCatalog(data);
const ROUTES = ['assault', 'defense', 'skill'];
const role = (p) => data.chess[p.chessId]?.profession;
const healing = (p) => role(p) === 'MEDIC';
const blocking = (p) => !healing(p) && Number(data.chess[p.chessId]?.stats?.blockCnt) > 0 && data.chess[p.chessId]?.position === 'MELEE';

function score(p, route) {
  const rec = loadoutRecord(data.chess[p.chessId], p);
  const stats = rec?.stats || {};
  const gear = totalEquipmentLevel(p, catalog);
  const production = catalog.operators[p.chessId]?.nativeTrait?.effect;
  return Number(rec?.tier || 1) * 100 + (p.elite ? 110 : 0) + gear * 15 +
    Number(stats.atk || 0) / 12 + Number(stats.maxHp || 0) / 150 +
    (route === 'defense' && blocking(p) ? 80 : route === 'skill' && production?.combat?.length ? 60 : 0) +
    (production?.prep?.length ? 35 : 0);
}

export function playSeed({seed=1, difficulty='FUNNY', roundLimit=9, route='assault'}={}) {
  if (!ROUTES.includes(route)) throw new Error('Unknown route');
  let state = createSession({seed, difficulty, roundLimit});
  const trace = [];
  let actions = 0;
  const act = (action, strict=false) => {
    const result = applyAction(state, action, {data,catalog});
    if (result.ok) { state=result.state; actions++; }
    else if (strict) throw Object.assign(new Error(`${action.type}: ${result.error.code}: ${result.error.message}`),{pilotState:state,action,trace});
    return result;
  };
  const pickOffers = () => {
    for (let guard=0; state.offers.length && guard<40; guard++) {
      const offer=state.offers[0];
      let chosen=false;
      for (let i=0; i<offer.choices.length && !chosen; i++) {
        const targets=[undefined,...state.pieces.map(p=>p.uid)];
        for (const targetUid of targets) {
          if (act({type:'choose',offerId:offer.id,index:i,targetUid}).ok) { chosen=true; break; }
        }
      }
      if (!chosen) throw new Error(`Unresolvable legal offer ${offer.id}`);
    }
  };
  for (let turn=0; state.phase!=='finished' && turn<roundLimit+2; turn++) {
    pickOffers();
    const round=state.round;
    const targetLevel=Math.min(6,1+Math.floor(round/2));
    if (state.pieces.length>=4 || state.shop.upgradePrice===0) {
      while (state.shop.level<targetLevel && state.funds>=state.shop.upgradePrice+3) {
        if (!act({type:'upgrade'}).ok) break;
      }
    }
    for (let pass=0;pass<5 && state.funds>=3;pass++) {
      const ranked=state.shop.slots.map((slot,i)=>({slot,i})).filter(({slot})=>!slot.sold && slot.id)
        .sort((a,b)=>{
          const value=({slot})=>slot.kind==='chess' ? score({chessId:slot.id, equipment:[]},route)+
            state.pieces.filter(p=>p.chessId===slot.id).length*130 +
            (data.chess[slot.id]?.profession==='MEDIC' && !state.pieces.some(healing)?300:0) : -100;
          return value(b)-value(a);
        });
      let bought=false;
      for (const {slot,i} of ranked) {
        if (slot.kind==='equipment' && state.pieces.length<5) continue;
        if (slot.kind==='chess' && state.pieces.length>=12 &&
          !state.pieces.some(p=>p.chessId===slot.id) && score({chessId:slot.id,equipment:[]},route)<Math.min(...state.pieces.map(p=>score(p,route)))) continue;
        if (act({type:'buy',slot:i}).ok) { bought=true; pickOffers(); if(state.funds<3) break; }
      }
      if (state.funds>=4 && pass<4) { if (!act({type:'refresh'}).ok) break; }
      else if (!bought) break;
    }
    pickOffers();
    const ranked=state.pieces.slice().sort((a,b)=>score(b,route)-score(a,route));
    const selected=[];
    const add=(p)=>{if(p && !selected.includes(p) && selected.length<state.deployCap)selected.push(p);};
    add(ranked.find(healing));
    ranked.filter(blocking).slice(0,2).forEach(add);
    ranked.forEach(add);
    for(const piece of state.pieces.slice()) act({type:'bench',uid:piece.uid},true);
    const selectedUids=selected.map(p=>p.uid);
    for(const item of state.inventory.slice()) {
      const definition=equipmentRecord(catalog,item.id);
      const targets=state.pieces.filter(p=>selectedUids.includes(p.uid)).sort((a,b)=>{
        const preference=p=>{
          let value=score(p,route);
          if (['vitality','defense','unyielding'].includes(item.id)) value+=blocking(p)?300:0;
          if (item.id==='harmony') value+=healing(p)?500:0;
          return value-totalEquipmentLevel(p,catalog)*8;
        };
        return preference(b)-preference(a);
      });
      const remaining=state.inventory.find(x=>x.uid===item.uid);
      if(!remaining) continue;
      if(['补给','玩家设施','supply','facility'].includes(definition?.kind)) {
        for(const target of [undefined,...targets]) if(act({type:'use-item',itemUid:item.uid,targetUid:target?.uid}).ok)break;
      } else {
        for(const target of targets) if(act({type:'equip',itemUid:item.uid,targetUid:target.uid,quantity:definition?.unique?1:remaining.quantity}).ok)break;
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
    const layout=planLayout(m,ps,selected.map(p=>({...p,kind:'chess',id:p.chessId})),undefined,{recOf:p=>loadoutRecord(data.chess[p.chessId],p)});
    for(const [uid,key] of layout) {
      const [row,col]=key.split(',').map(Number);
      act({type:'move',uid,row,col,dir:layout.dirs.get(uid)},true);
    }
    if(!state.pieces.some(p=>p.row!==null)) throw new Error('Pilot has no legal deployed piece');
    const before={round,lp:state.lp,funds:state.funds,equipmentLevels:state.pieces.filter(p=>p.row!==null).map(p=>totalEquipmentLevel(p,catalog)),inventoryCount:state.inventory.reduce((n,i)=>n+i.quantity,0)};
    act({type:'ready'},true);
    const errors=validateSession(state);
    if(errors.length) throw new Error('Pilot state invalid: '+errors.join(','));
    trace.push({...before,afterLp:state.lp,battle:state.battleSummary,production:(state.history||[]).filter(e=>e.round===round && (e.type==='forge' || e.type==='production')).length});
  }
  if(state.phase!=='finished') throw new Error('Pilot exceeded bounded turns');
  return {seed,difficulty,roundLimit,route,actions,rounds:trace.length,lp:state.lp,completed:trace.length===roundLimit && state.lp>0 && state.battleSummary?.result?.bossHpLeft===0,trace,state};
}

async function main() {
  const options={};
  for(let i=2;i<process.argv.length;i+=2) {
    if(!process.argv[i].startsWith('--') || process.argv[i+1]===undefined)throw new Error('Options require values');
    options[process.argv[i].slice(2)]=process.argv[i+1];
  }
  const count=Number(options.seeds||3);
  if(!Number.isInteger(count)||count<1||count>100)throw new Error('seeds must be 1..100');
  const runs=[];
  for(const route of (options.routes||ROUTES.join(',')).split(','))for(let seed=1;seed<=count;seed++) {
    try { runs.push(playSeed({seed,route,difficulty:options.difficulty||'FUNNY',roundLimit:Number(options['round-limit']||9)})); }
    catch(error) { runs.push({seed,route,error:error.message,action:error.action,state:error.pilotState,trace:error.trace,rounds:error.trace?.length||0,lp:error.pilotState?.lp||0,completed:false}); }
  }
  const report={createdAt:new Date().toISOString(),routes:ROUTES.map(route=>{const r=runs.filter(x=>x.route===route);return {route,runs:r.length,completed:r.filter(x=>x.completed).length,meanRounds:r.reduce((n,x)=>n+x.rounds,0)/(r.length||1),meanLp:r.reduce((n,x)=>n+x.lp,0)/(r.length||1)};}),runs};
  const output=resolve(options.output||'runtime/independent-mode-20261005/balance.json');
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({output,role:'seeded real-action balance experiment',routes:report.routes,errors:runs.filter(r=>r.error).map(r=>({seed:r.seed,route:r.route,error:r.error,round:r.state?.round}))},null,2));
  if(runs.some(r=>r.error))process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
