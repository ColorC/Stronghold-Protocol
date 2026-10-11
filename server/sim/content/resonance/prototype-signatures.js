import { prototypeSeasonForCatalog } from '../../../../shared/resonance/season-registry.js';

const clone=(value)=>structuredClone(value);

// These are the already shipped Resonance signature profiles for the two mapped operators.
// They remain independent personal abilities in Set 13 v3 and never add a natural pact.
const SIGNATURES=Object.freeze({
  snow:Object.freeze({
    tileCooldown:3,coldDuration:1.5,perColdSp:.2,
  }),
  lateranoAirstrike:Object.freeze({
    actionCooldown:.4,bombCount:15,
    byStar:Object.freeze({
      1:Object.freeze({chance:15,damage:60,cap:100,factor:.005,radius:1.5}),
      2:Object.freeze({chance:25,damage:100,cap:150,factor:.008,radius:1.5}),
      3:Object.freeze({chance:100,damage:500,cap:500,factor:.02,radius:2}),
    }),
  }),
});
const installedBattles=new WeakMap();

function battleUnitInfo(unit,catalog,state,pieceByUid,bySource,season){
  const sourceId=unit?.def?.raw?.id??unit?.def?.raw?.chessId??unit?.defId;
  const operator=bySource.get(sourceId)??catalog?.operators?.[sourceId]??null;
  const piece=pieceByUid.get(String(unit?.uid));
  const star=Math.max(1,Math.min(3,Number(piece?.star??unit?.def?.raw?.resonanceStar??unit?.resonanceStar??1)));
  const hero=season.heroes.find((entry)=>entry.sourceChessId===sourceId||entry.charId===(operator?.charId??unit?.def?.raw?.charId));
  return {sourceId,operator,piece,star,hero,charId:operator?.charId??unit?.def?.raw?.charId??null};
}
function fieldTiles(battle){
  const result=[];
  const rect=battle.rect;
  for(let row=rect.r0;row<=rect.r1;row++)for(let col=rect.c0;col<=rect.c1;col++)if(battle.grid.walkable(row,col))result.push([row,col]);
  for(const [row,col] of battle.grid.specialTiles?.('end')??[])if(!result.some(([r,c])=>r===row&&c===col))result.push([row,col]);
  return result;
}
function nearby(battle,x,y,radius){return battle.foesInRadius(x,y,radius,true).filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden);}
function metric(battle,name,amount=1){
  battle.resonanceMetrics??={};
  const metrics=battle.resonanceMetrics.prototypeSignatures??={};
  metrics[name]=(metrics[name]??0)+amount;
}
function lateranoSource(info){
  const native=info.operator?.source?.normalChess??{};
  return native.nationId==='laterano'||(native.bonds??[]).includes('lateranoShip');
}
function damage(battle,source,target,amount,type,tags){
  if(!(amount>0)||!target?.alive)return 0;
  return battle.dealDamage(source,target,{amount,type,canDodge:false,tags:['resonance','prototype-signature',...tags]});
}

/** Install the two pre-existing Resonance personal signatures that are separate from Set 13 natural traits. */
export function installPrototypeSignatures(battle,state,catalog){
  const season=prototypeSeasonForCatalog(catalog);
  if(installedBattles.has(battle))return installedBattles.get(battle);
  const pieces=new Map((state?.pieces??[]).map((piece)=>[String(piece.uid),piece]));
  const operators=catalog?.operators??{};
  const bySource=new Map(Object.values(operators).map((operator)=>[operator.sourceChessId,operator]));
  const active=()=>battle.allyUnits.filter((unit)=>unit?.kind==='op'&&unit.side==='ally'&&unit.alive&&unit.deployed&&!unit.removed);
  const info=(unit)=>battleUnitInfo(unit,catalog,state,pieces,bySource,season);
  const snowApi='TFT13_Malzahar',lateranoApi='TFT13_Lieutenant';
  const yela=()=>active().find((unit)=>info(unit).hero?.apiName===snowApi)??null;
  const angel=()=>active().find((unit)=>info(unit).hero?.apiName===lateranoApi)??null;
  const cooldowns=new Map();
  const floorKeys=new Set();
  const metrics={};
  battle.resonanceMetrics??={};
  battle.resonanceMetrics.prototypeSignatures=metrics;

  battle.on('battleStart',()=>{
    const snow=yela();
    if(snow){
      battle.resonanceFloors=fieldTiles(battle);
      floorKeys.clear();for(const [row,col] of battle.resonanceFloors)floorKeys.add(`${row},${col}`);
    }
  },{owner:battle});

  battle.on('tick',()=>{
    const snow=yela();
    if(!snow)return;
    const p=SIGNATURES.snow,now=Number(battle.time??0),last=Number(snow.mem.prototypeSnowLastTick??now),elapsed=Math.max(0,now-last);
    snow.mem.prototypeSnowLastTick=now;
    const chilled=battle.enemies.filter((enemy)=>enemy?.alive&&enemy.deployed&&!enemy.hidden&&(enemy.s?.flags?.cold||enemy.s?.flags?.freeze));
    if(!snow.skill?.active&&elapsed>0&&chilled.length){
      snow.skill?.gainSp?.(chilled.length*p.perColdSp*elapsed,'prototypeYelaCold');
      metric(battle,'snowColdSp',chilled.length*p.perColdSp*elapsed);
    }
    const byTile=new Map();
    for(const enemy of battle.enemies){
      if(!enemy?.alive||!enemy.deployed||enemy.hidden)continue;
      const key=`${enemy.tileR},${enemy.tileC}`;
      if(!byTile.has(key))byTile.set(key,[]);
      byTile.get(key).push(enemy);
    }
    for(const [tileKey,occupants] of byTile){
      if(!floorKeys.has(tileKey))continue;
      const [row,col]=tileKey.split(',').map(Number);
      const key=`snow:${tileKey}`,readyAt=Number(cooldowns.get(key)??0);
      if(now+1e-9<readyAt)continue;
      cooldowns.set(key,now+p.tileCooldown);
      for(const enemy of occupants)battle.applyStatus(enemy,'cold',{duration:p.coldDuration,source:snow});
      metric(battle,'snowTileCold',occupants.length);
    }
  },{owner:battle});

  battle.on('attack',(event)=>{
    const source=event?.attacker,target=(event?.targets??[]).filter((enemy)=>enemy?.side==='enemy'&&enemy.alive).sort((a,b)=>a.id-b.id)[0];
    if(!source||source.side!=='ally'||source.kind!=='op'||!target)return;
    const sourceInfo=info(source);
    const saint=angel();
    if(!saint||!lateranoSource(sourceInfo)||battle.time<Number(source.mem.prototypeHolyGunAt??0))return;
    const saintInfo=info(saint),profile=SIGNATURES.lateranoAirstrike.byStar[saintInfo.star];
    source.mem.prototypeHolyGunAt=battle.time+SIGNATURES.lateranoAirstrike.actionCooldown;
    if(battle.rng()>=profile.chance/100)return;
    const ammo=Math.min(Number(battle.resonanceMetrics?.totalAmmoSpent??0),profile.cap);
    const amount=saint.s.atk*profile.damage/100*(1+ammo*profile.factor);
    for(const enemy of nearby(battle,target.x,target.y,profile.radius)){
      damage(battle,saint,enemy,amount,'phys',['lateranoAirstrike']);
      if(saintInfo.star>=3)battle.addBuff(enemy,{key:'resonance:prototype-ammo-vulnerability',duration:Infinity,mods:{},tags:['resonance','prototype-signature']});
    }
    metric(battle,'lateranoAirstrikes');
  },{owner:battle});

  battle.on('hit',(event)=>{
    const source=event?.source,target=event?.target,dmg=event?.dmg;
    if(!source||source.side!=='ally'||target?.side!=='enemy'||!dmg||!target.findBuff?.('resonance:prototype-ammo-vulnerability'))return;
    if((dmg.tags??[]).includes('ammoSkill'))dmg.mul=(dmg.mul??1)*1.5;
  },{owner:battle});

  const result={signatures:['snow','lateranoAirstrike'],metrics,operators:season.heroes.filter((hero)=>[snowApi,lateranoApi].includes(hero.apiName)).map((hero)=>({name:hero.operatorName,sourceChessId:hero.sourceChessId,charId:hero.charId}))};
  installedBattles.set(battle,result);
  return result;
}

export const prototypeSignatureProfiles=clone(SIGNATURES);
