import { adaptedKit } from '../adapted-kit.js';
import { battleState, countedTrigger } from '../adaptation-primitives.js';
import { active, damage, heal, buff, applyStatus, gainDP, enemies, uid } from '../primitives.js';
import { redeployNow, withinAdjacent4, placeZone, removeZone } from '../synergy.js';
import { rotateOffset } from '../../../dir.js';
import { valuesOf, yours, ops, targets, sourceKey, onDeploy, link } from './adaptation-core.js';

function swordRain(battle, unit) {
  const v = valuesOf(unit);
  for (let wave = 0; wave < v.waves; wave++) for (const target of targets(battle, unit)) {
    damage(battle, unit, target, { scale: v.scale, type: 'arts', isSkill: true });
    if (target.alive) applyStatus(battle, unit, target, { status: 'stun', duration: v.rainStun });
  }
}
const texas2 = (_bb, _raw, def) => adaptedKit(def, {
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit);
    battleState(battle, unit, 'texas-attack', { mods: { atkPct: v.atk } });
    for (const target of targets(battle, unit, unit, 999)) {
      damage(battle, unit, target, { scale: v.appear, hits: 2, type: 'arts', isSkill: true });
      if (target.alive) applyStatus(battle, unit, target, { status: 'stun', duration: v.stun });
    }
    swordRain(battle, unit); return true;
  },
  link: (battle, unit) => link(battle, unit, 'kill', 'unrelenting', p => yours(unit, p.source), () => {
    heal(battle, unit, unit, { amount: unit.s.maxHp }); swordRain(battle, unit);
    battle.fx('skillEcho', { id: unit.id, x: unit.x, y: unit.y, nativeUnit: unit.def.charId,
      skillId: unit.def.raw.assaultBody.adaptation.sourceSkillId });
    return true;
  }, { first: valuesOf(unit).first }),
  innate: (battle, unit) => {
    onDeploy(battle, unit, 'swordplay', () => buff(battle, unit, unit, { key: sourceKey(unit, 'swordplay'),
      mods: { aspd: 8, dmgTakenMul: .75 }, duration: Infinity, persist: true }));
    battle.assaultRuntime.observe('kill', sourceKey(unit, 'first-own-kill'), ({ payload }) => {
      if (payload.source === unit) battle.removeBuff(unit, sourceKey(unit, 'swordplay'));
    }, { owner: unit });
  },
});

function shadowPoint(unit) {
  const preset = unit.def.raw.assaultPiece.summonPresets?.find(p => p?.tokenId === 'ines-sentry');
  // The first deployment tile is itself a player-selected original planting
  // position. An explicit prep marker overrides it; no random tile is chosen.
  return preset ? { r: preset.row, c: preset.col, dir: preset.dir ?? unit.dir }
    : { r: unit.tileR, c: unit.tileC, dir: unit.dir };
}
function plantShadow(battle, unit) {
  const at = shadowPoint(unit), grid = unit.def.raw.assaultBody.adaptation.rangeGrid;
  const tiles = grid.map(([r, c]) => rotateOffset(r, c, at.dir)).map(([r, c]) => [at.r + r, at.c + c])
    .filter(([r, c]) => battle.grid.inRect(r, c));
  if(!tiles.length)return false;
  unit.mem.adaptInesShadow = at;
  placeZone(battle, unit, { key: 'manual-sentry', kind: 'sentry', tiles,
    enemy: { flags: { reveal: true }, mods: { moveMul: 1 - valuesOf(unit).slow } } });
}
function inReturnLine(enemy, at, unit, width) {
  const dx = unit.x - at.c, dy = unit.y - at.r, length2 = dx * dx + dy * dy;
  const fraction = length2 ? Math.max(0, Math.min(1, ((enemy.x - at.c) * dx + (enemy.y - at.r) * dy) / length2)) : 0;
  const ex = enemy.x - at.c - fraction * dx, ey = enemy.y - at.r - fraction * dy;
  return ex * ex + ey * ey <= width * width / 4;
}
const ines = (_bb, _raw, def) => adaptedKit(def, {
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit);
    battleState(battle, unit, 'ines-homeward', { mods: { atkPct: v.atk } });
    if (!unit.mem.adaptInesFirstEntry) {
      unit.mem.adaptInesFirstEntry = true; plantShadow(battle, unit);
      battle.assaultRuntime.afterFlush(() => { if (active(unit)) redeployNow(battle, unit, unit); });
      return true;
    }
    const at = unit.mem.adaptInesShadow;
    if (at) {
      removeZone(battle, unit, 'manual-sentry');
      const anchor = { ...unit, profile: { canHitFly: true }, s: unit.s };
      for (const target of enemies(battle, unit, { scope: 'field', anchor, count: 999 })
        .filter(enemy => inReturnLine(enemy, at, unit, v.width)).slice(0, 6)) {
        if (damage(battle, unit, target, { scale: v.scale, type: 'phys', isSkill: true }) > 0) gainDP(battle, unit, v.dp, 'shadow-return');
      }
    }
    plantShadow(battle, unit); return true;
  },
  link: (battle, unit) => {
    const robbed = new Set(), loot = new Map();
    battle.on('damaged', ({ source, target, amount }) => {
      if (!active(unit) || !yours(unit, source) || target?.side !== 'enemy' || !target.alive || !(amount > 0) || robbed.has(target)) return;
      robbed.add(target);
      const take = countedTrigger(battle, { key: sourceKey(unit, `shadow-weave:${uid(target)}`), owner: unit }, () => {
        if (!target.alive || !active(source)) return false;
        const v = valuesOf(unit), key = sourceKey(unit, `loot:${uid(target)}`);
        applyStatus(battle, unit, target, { status: 'bind', duration: v.bind });
        buff(battle, unit, target, { key: sourceKey(unit, 'robbed'), mods: { atkFlat: -v.steal }, duration: Infinity });
        buff(battle, source, source, { key, mods: { atkFlat: v.steal }, duration: Infinity });
        loot.set(target, { recipient: source, key }); return true;
      });
      take({ target, cause: battle.assaultRuntime.currentCause });
    }, { owner: unit });
    battle.on('death', ({ unit: gone }) => {
      if (gone === unit) {
        for (const { recipient, key } of loot.values()) battle.removeBuff(recipient, key);
        loot.clear();
      } else if (loot.has(gone)) {
        const { recipient, key } = loot.get(gone); battle.removeBuff(recipient, key); loot.delete(gone);
      }
    }, { owner: unit });
  },
  innate: (_battle, unit) => { unit.mem.assaultSkillFree = true; },
});

function releaseUtageSlashes(battle,unit){
  const hits=unit.mem.adaptUtageSlashes??0,list=targets(battle,unit);
  if(!hits||!list.length)return false;
  unit.mem.adaptUtageSlashes=0;
  for(const target of list)for(let remaining=hits;remaining>0&&target.alive;remaining-=100)
    damage(battle,unit,target,{scale:valuesOf(unit).scale,hits:Math.min(100,remaining),type:'arts',isSkill:true});
  return true;
}
const utage = (_bb, _raw, def) => adaptedKit(def, {
  cast: ({ battle, unit }) => {
    const v = valuesOf(unit);
    battle.loseHp(unit, unit.hp * v.cost, { source: unit });
    // Original S2 strengthens attacks after deployment. Do not discard its
    // compressed attacks solely because the first wave has not arrived.
    unit.mem.adaptUtageSlashes=(unit.mem.adaptUtageSlashes??0)+v.hits;
    releaseUtageSlashes(battle,unit);
    return true;
  },
  link: (battle, unit) => {
    battle.every(.25, () => {
      if (!active(unit)) return;
      const v=valuesOf(unit),aspd=v.aspd*Math.min(1,Math.max(0,1-unit.hp/unit.s.maxHp)/v.lostForMax);
      buff(battle,unit,unit,{key:'adaptation:utage:serious-mode',mods:{aspd},duration:.51});
    }, { owner: unit });
    const take=countedTrigger(battle,{key:sourceKey(unit,'serious-riposte'),owner:unit,every:valuesOf(unit).every},()=>{
      const [target]=targets(battle,unit);return target?damage(battle,unit,target,{scale:valuesOf(unit).scale,type:'arts'}):false;
    });
    battle.assaultRuntime.observe('damageTaken',sourceKey(unit,'serious-help'),event=>{
      const p=event.payload;if(yours(unit,p.target)&&p.target!==unit&&p.source?.side==='enemy')take({target:p.target,cause:event.cause});
    },{owner:unit});
  },
  innate:(battle,unit)=>battle.on('beforeAttack',({attacker,targets:list})=>{
    if(attacker!==unit||!unit.mem.adaptUtageSlashes||!list.length)return;
    battle.assaultRuntime.enqueue(()=>{if(active(unit))releaseUtageSlashes(battle,unit);},
      {key:sourceKey(unit,'pending-slashes'),targetUid:uid(unit),cause:battle.assaultRuntime.currentCause});
  },{owner:unit}),
});

export const adaptationDeployKits = Object.freeze({ char_1028_texas2: texas2, char_4087_ines: ines, char_337_utage: utage });
