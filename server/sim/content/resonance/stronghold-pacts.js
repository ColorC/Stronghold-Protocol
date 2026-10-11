// Faction season 2 battle side: the seventeen redesigned, non-stacking pacts (shared/resonance/stronghold-pacts.js).
// None is defense-first: a pact kills or controls (owner rule — enemies that are neither killed nor held leak).
//
// Every tier reads its values from the catalogue level the active tier consumed. Effects use the native primitives:
// statuses (寒冷 → 冻结, 隐匿, 恐惧, 晕眩, 减速, 脆弱, 元素脆弱), shields as 屏障, the native “炎佑” token with its own
// flight, burn and 元素脆弱 aura, 【移动】 for the 突袭 relocation and the engine's fatal prevention for the 深海猎人
// revive. Nothing outlives the battle except the 维多利亚 hammer economy (prototype-economy.js).
import { prototypeSeasonForCatalog, redesignedTraitIds } from '../../../../shared/resonance/season-registry.js';
import { STRONGHOLD_EQUIPMENT_SLOTS, STRONGHOLD_HAMMER_ITEM_ID } from '../../../../shared/resonance/stronghold-pacts.js';
import { applyDamageIncrease } from '../../../../shared/damageIncrease.js';
import { canTargetEnemy, extendedGrid } from '../../targeting.js';
import { normDir, rotateOffset } from '../../dir.js';
import { COLS } from '../../constants.js';
import { SkillRuntime } from '../../skills.js';
import { raidTile } from '../bonds/addon/battle.js';

const TAG = 'stronghold-pact';
const YANYOU_TOKEN_ID = 'enemy_9012_acloon';   // the native 炎佑 (tokens.js yanyouKit: flight, burn, 元素脆弱 aura)
const WANTED_KEY = 'lemuen:wanted';            // the same 通缉 state 蕾缪安's talent marks (kits/tier6.js)
const ARTS_MARK_KEY = 'stronghold:arts-mark';
const RAID_CANDIDATES = 8;
const COMPONENT_STAT_MODS = Object.freeze([['atk','atkFlat'],['aspd','aspd'],['def','defFlat'],['res','resFlat'],['hp','hpFlat'],['sp','spRecoveryFlat'],['hpPct','hpPct']]);

const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const hasTag = (dmg, tag) => Array.isArray(dmg?.tags) && dmg.tags.includes(tag);
const chebyshev = (a, b) => Math.max(Math.abs(a.tileR - b.tileR), Math.abs(a.tileC - b.tileC));
const isEliteRank = (e) => e?.isBoss ? 2 : (e?.def?.rank === 'ELITE' || e?.def?.rank === 'BOSS') ? 1 : 0;
const siracusaStealthKey = (unit) => `stronghold:siracusa-stealth:${unit.id}`;

/** The member's attack range as flat [dRow, dCol, …] offsets turned by its direction (bonds/addon raidReach). */
function reachOf(unit) {
  const d = normDir(unit.dir);
  const out = [];
  for (const [dr, dc] of extendedGrid(unit.rangeGrid || [[0, 0]], num(unit.s.rangeExtend))) out.push(...rotateOffset(dr, dc, d));
  return out;
}

/** Install the redesigned pacts of the active tiers. Returns the consumed tiers (null when the season has none). */
export function installStrongholdPacts(battle, state, catalog, activeTraits = []) {
  const season = prototypeSeasonForCatalog(catalog);
  const redesigned = redesignedTraitIds(season);
  if (!redesigned.size) return null;
  const tiers = new Map();
  for (const entry of activeTraits) {
    if (!redesigned.has(entry.id)) continue;
    const level = catalog?.pacts?.[entry.id]?.levels?.find((row) => row.threshold === entry.tier);
    const effect = level?.effects?.find((row) => row.kind === 'prototype_trait');
    if (!effect) throw new Error(`STRONGHOLD_PACT_NOT_CONSUMED:${entry.id}:${entry.tier}`);
    tiers.set(entry.id, { id: entry.id, tier: entry.tier, count: entry.count, v: { ...(effect.params?.variables ?? {}) } });
  }
  if (!tiers.size) return null;
  const v = (id) => tiers.get(id)?.v ?? null;

  const operators = catalog?.operators ?? {};
  const byChar = new Map(Object.values(operators).map((operator) => [operator.charId, operator]));
  const bySource = new Map(Object.values(operators).map((operator) => [operator.sourceChessId, operator]));
  const charIdOf = (unit) => {
    const raw = unit?.def?.raw ?? unit?.def ?? {};
    return raw.charId ?? bySource.get(raw.id ?? raw.chessId ?? unit?.defId)?.charId ?? null;
  };
  // equipment hands out emblem pacts while the battle is built and started: cache only once the battle has begun
  const pactCache = new WeakMap();
  let cacheReady = false;
  const pactsOf = (unit) => {
    if (unit?.kind !== 'op') return null;
    let ids = pactCache.get(unit);
    if (!ids) {
      const mem = unit.mem?.resonancePacts;
      const input = unit.player?.input?.units?.find((entry) => String(entry?.uid) === String(unit.uid) && entry.kind !== 'token');
      ids = new Set([...(byChar.get(charIdOf(unit))?.pacts ?? []), ...(unit.extraPacts ?? []), ...(unit.def?.raw?.extraPacts ?? []),
        ...(input?.extraPacts ?? []), ...(mem instanceof Set || Array.isArray(mem) ? mem : [])]);
      if (cacheReady) pactCache.set(unit, ids);
    }
    return ids;
  };
  const isMember = (unit, id) => tiers.has(id) && !!pactsOf(unit)?.has(id);
  const ops = () => battle.allyUnits.filter((unit) => unit?.kind === 'op' && unit.alive && unit.deployed && !unit.removed);
  const members = (id) => ops().filter((unit) => isMember(unit, id));
  const enemies = () => battle.enemies.filter((enemy) => enemy?.alive && enemy.deployed && !enemy.hidden);

  battle.resonanceMetrics ??= {};
  const traitMetrics = battle.resonanceMetrics.prototypeTraits ??= {};
  for (const t of tiers.values()) traitMetrics[t.id] = { tier: t.tier, count: t.count };
  const metric = (id, key, amount = 1) => { const row = traitMetrics[id] ??= {}; row[key] = (row[key] ?? 0) + amount; };

  const standing = (unit, key, mods) => battle.addBuff(unit, { key: `stronghold:${key}:${unit.id}`, mods, duration: Infinity, persist: true, allowDead: true, tags: ['resonance', TAG] });
  const timed = (unit, key, mods, duration) => battle.addBuff(unit, { key: `stronghold:${key}:${unit.id}`, mods, duration, tags: ['resonance', TAG] });
  const gainSp = (unit, amount, reason) => unit?.skill?.gainSp?.(amount, reason) ?? 0;
  const hit = (source, target, amount, type) => (amount > 0 && target?.alive)
    ? battle.dealDamage(source, target, { amount, type, canDodge: false, tags: ['resonance', TAG] }) : 0;

  // ---------------------------------------------------------------------------------------------------------------
  // 拉特兰 — 通缉 (the 蕾缪安 state), bullets and durations, SP on a wanted knock-out. The field is empty when the battle
  // starts, so the marks follow the field: the toughest enemies on it hold them, re-ranked as enemies arrive and fall.
  const isWanted = (enemy) => !!enemy?.buffs?.some((buff) => buff.key === WANTED_KEY);
  const updateWanted = () => {
    const a = v('academy');
    if (!a || !members('academy').length) return;
    const ranked = enemies().sort((x, y) => isEliteRank(y) - isEliteRank(x) || y.s.maxHp - x.s.maxHp
      || Number(!!y.mem.strongholdWanted) - Number(!!x.mem.strongholdWanted) || x.id - y.id);
    const keep = new Set(ranked.slice(0, Math.max(0, Math.floor(num(a.wantedCount, 1)))));
    for (const enemy of battle.enemies) {
      if (!enemy?.mem?.strongholdWanted || keep.has(enemy)) continue;
      enemy.mem.strongholdWanted = false;
      // a mark 蕾缪安 placed herself stays when the pact's moves on
      if (enemy.alive) {
        if (!enemy.mem.strongholdWantedShared) battle.removeBuff(enemy, WANTED_KEY);
        metric('academy', 'wantedMoved');
      }
      enemy.mem.strongholdWantedShared = false;
    }
    for (const enemy of keep) {
      if (enemy.mem.strongholdWanted) continue;
      enemy.mem.strongholdWanted = true;
      enemy.mem.strongholdWantedShared = isWanted(enemy);
      if (!enemy.mem.strongholdWantedShared) battle.addBuff(enemy, { key: WANTED_KEY, visible: true, duration: Infinity });
      battle.fx('wanted', { x: enemy.x, y: enemy.y, id: enemy.id });
      metric('academy', 'wanted');
    }
  };
  // 蕾缪安's own increase applies to bond-holding sources only; the higher of the two counts once
  const lemuenIncrease = (source) => {
    if (!Array.isArray(source?.def?.bonds) || !source.def.bonds.includes('lateranoShip')) return 0;
    return Math.max(0, ...battle.allyUnits.filter((unit) => unit.alive && unit.deployed && num(unit.mem?.wantedScale) > 1).map((unit) => num(unit.mem.wantedScale) - 1));
  };

  // ---------------------------------------------------------------------------------------------------------------
  // 炎 — the native “炎佑”, its 祛恶之焰 replaced by the pact's periodic flame
  const guardians = [];
  let summoningGuardian = false;
  const freeTileNear = (unit) => {
    for (let d = 1; d <= 3; d++) {
      const tiles = [];
      for (let r = unit.tileR - d; r <= unit.tileR + d; r++) for (let c = unit.tileC - d; c <= unit.tileC + d; c++)
        if (Math.max(Math.abs(r - unit.tileR), Math.abs(c - unit.tileC)) === d && battle.grid.inRect(r, c) && !battle.isReservedTile(r, c)) tiles.push([r, c]);
      tiles.sort((a, b) => Math.hypot(a[0] - unit.tileR, a[1] - unit.tileC) - Math.hypot(b[0] - unit.tileR, b[1] - unit.tileC) || a[0] - b[0] || a[1] - b[1]);
      if (tiles.length) return tiles[0];
    }
    return null;
  };
  const summonGuardians = () => {
    const y = v('sui'), owners = members('sui');
    if (!y || !owners.length) return;
    let atk = 0, hp = 0;
    for (const unit of owners) { atk += num(unit.s.atk); hp += num(unit.s.maxHp); }
    const share = num(y.guardianShare);
    for (let index = 0; index < Math.max(1, Math.floor(num(y.guardianCount, 1))); index++) {
      const owner = owners[index % owners.length], tile = freeTileNear(owner);
      if (!tile) continue;
      summoningGuardian = true;
      let token = null;
      try { token = battle.spawnToken(owner, YANYOU_TOKEN_ID, tile[0], tile[1], { anySource: true, stats: { atk: atk * share, maxHp: Math.max(1, hp * share) } }); }
      finally { summoningGuardian = false; }
      if (!token) continue;
      token.hp = token.s.maxHp;
      token.mem.strongholdGuardian = true;
      token.mem.hoverDy = index === 0 ? 0 : (index % 2 ? 0.8 : -0.8);
      token.skill = new SkillRuntime(battle, token, token.def?.skill ?? null, null, {});
      const mods = {};
      const targets = Math.floor(num(y.guardianTargets, 3)) - Math.floor(num(token.profile?.maxTargets, 1));
      if (targets) mods.maxTargets = targets;
      if (num(y.guardianDamageTaken) > 0) mods.dmgTakenMul = 1 - num(y.guardianDamageTaken);
      if (Object.keys(mods).length) standing(token, 'yan-guardian', mods);
      guardians.push(token);
      battle.fx('yanyouSummon', { x: token.x, y: token.y, id: token.id });
      metric('sui', 'guardians');
    }
  };
  const boostSummon = (token) => {
    const y = v('sui');
    if (!y?.summonAttack || token?.kind !== 'token' || token.mem?.strongholdGuardian || !isMember(token.ownerUnit, 'sui')) return;
    standing(token, 'yan-summon', { atkPct: num(y.summonAttack) });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // 维多利亚 — attack per carried item; the temporary 维式重锤
  const itemsOf = (unit) => {
    const input = unit.player?.input?.units?.find((entry) => String(entry?.uid) === String(unit.uid) && entry.kind !== 'token');
    return (input?.items ?? unit.items ?? []).map((item) => typeof item === 'string' ? item : item?.itemId ?? item?.id).filter(Boolean);
  };
  const equipmentAttack = (unit, row, share = 1) => {
    let pct = 0;
    for (const id of [...itemsOf(unit), ...(unit.mem.strongholdTemporaryItems ?? [])]) {
      const kind = catalog?.equipment?.[id]?.kind;
      if (kind) pct += kind === 'component' ? num(row.perComponent) : num(row.perCompleted);
    }
    return pct * share;
  };
  const lendHammer = (unit) => {
    const item = catalog?.equipment?.[STRONGHOLD_HAMMER_ITEM_ID];
    if (!item || itemsOf(unit).length >= STRONGHOLD_EQUIPMENT_SLOTS) return false;
    unit.mem.strongholdTemporaryItems = [STRONGHOLD_HAMMER_ITEM_ID];
    const mods = {};
    for (const effect of item.effects ?? []) {
      if (effect.kind !== 'component_stat') continue;
      for (const [source, target] of COMPONENT_STAT_MODS) {
        const value = num(effect.params?.[source]);
        if (value) mods[target] = (mods[target] ?? 0) + (source === 'hpPct' ? value / 100 : value);
      }
    }
    if (Object.keys(mods).length) standing(unit, 'victoria-hammer', mods);
    return true;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // 哥伦比亚 — a member's skill start strikes every enemy in its attack range and stuns it
  const columbiaShock = (unit, keysOf = unit) => {
    const c = v('rhodes');
    if (!c || !unit?.alive) return 0;
    const atk = num(unit.s.atk) > 0 ? num(unit.s.atk) : num(unit.ownerUnit?.s?.atk);
    const keys = keysOf.rangeKeys?.length ? keysOf.rangeKeys : null;
    const foes = keys ? battle.enemiesInKeys(keys, keysOf, keysOf.profile) : battle.foesInRadius(unit.x, unit.y, 1.5, true);
    for (const enemy of foes) {
      hit(unit, enemy, atk * num(c.castBlast), 'arts');
      if (!enemy.alive) continue;
      if (num(c.castStun) > 0 && battle.applyStatus(enemy, 'stun', { duration: num(c.castStun), source: unit }) && num(c.stunFragile) > 0)
        battle.applyStatus(enemy, 'fragile', { duration: num(c.castStun), value: num(c.stunFragile), source: unit });
    }
    if (foes.length) { battle.fx('shieldBreak', { x: unit.x, y: unit.y, id: unit.id }); metric('rhodes', 'shocks'); metric('rhodes', 'shockTargets', foes.length); }
    return foes.length;
  };
  const shockSummon = (token) => {
    if (!v('rhodes')?.summonBlast || !['token', 'device'].includes(token?.kind) || !isMember(token.ownerUnit, 'rhodes')) return;
    columbiaShock(token);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // battle start
  battle.on('battleStart', () => {
    cacheReady = true;
    const all = ops();
    const r = v('resistance');
    if (r) {
      for (const unit of members('resistance')) if (r.temporaryHammer && lendHammer(unit)) metric('resistance', 'temporaryHammers');
      for (const unit of all) {
        const share = isMember(unit, 'resistance') ? 1 : num(r.othersShare);
        const pct = share > 0 ? equipmentAttack(unit, r, share) : 0;
        if (pct > 0) standing(unit, 'victoria-equipment', { atkPct: pct });
      }
    }
    // 叙拉古: the opening speed, the 隐匿 and the fear window count from each member's first attack (see 'hit')
    const s = v('risk');
    if (s) for (const unit of members('risk')) {
      if (!(num(s.openingDuration) > 0)) standing(unit, 'siracusa-opening', { aspd: num(s.openingAspd) });
      if (num(s.stealth) > 0) {
        battle.addBuff(unit, { key: siracusaStealthKey(unit), status: 'stealth', flags: { stealth: true }, duration: Infinity, source: unit, tags: ['resonance', TAG] });
        metric('risk', 'stealthed');
      }
    }
    const a = v('ammo');
    if (a) {
      for (const unit of members('ammo')) standing(unit, 'precision', { atkPct: num(a.atk), defIgnorePct: num(a.defIgnore), resIgnorePct: num(a.resIgnore) });
      if (num(a.rangedAtk) > 0) for (const unit of all) if (!isMember(unit, 'ammo') && unit.def?.position === 'RANGED') standing(unit, 'precision-ranged', { atkPct: num(a.rangedAtk) });
    }
    if (num(v('sentinel')?.blockBonus) > 0) for (const unit of members('sentinel')) standing(unit, 'hold-the-line', { blockCnt: num(v('sentinel').blockBonus) });
    if (num(v('redeploy')?.hpBonus) > 0) for (const unit of members('redeploy')) standing(unit, 'raid', { hpPct: num(v('redeploy').hpBonus) });
    // the 炎佑 reads max HP / ATK after every standing bonus above
    if (v('sui')) {
      summonGuardians();
      for (const token of battle.allyUnits.filter((row) => row?.kind === 'token' && row.alive)) boostSummon(token);
    }
  }, { owner: battle });

  battle.on('deploy', (event) => {
    const unit = event?.unit;
    if (!battle.started || summoningGuardian || unit?.side !== 'ally' || unit.kind === 'op') return;
    boostSummon(unit);
    shockSummon(unit);
  }, { owner: battle });

  // ---------------------------------------------------------------------------------------------------------------
  // periodic effects
  if (v('academy')) {
    battle.on('enemySpawn', updateWanted, { owner: battle });
    battle.on('death', (event) => { if (event?.unit?.side === 'enemy') updateWanted(); }, { owner: battle });
    battle.every(0.5, updateWanted, { owner: battle });   // enemies that hide, leave or are revealed
  }
  if (num(v('creation')?.windInterval) > 0) {
    // the wind's clock runs only while enemies are on the field
    let windClock = 0;
    battle.every(0.25, () => {
      const k = v('creation'), source = members('creation')[0];
      if (!source || !enemies().length) return;
      windClock += 0.25;
      if (windClock + 1e-9 < num(k.windInterval)) return;
      windClock = 0;
      const hitTiles = new Map();
      for (const enemy of enemies()) {
        battle.applyStatus(enemy, 'cold', { duration: num(k.windDuration), source });
        hitTiles.set(`${Math.round(enemy.y)},${Math.round(enemy.x)}`, [Math.round(enemy.y), Math.round(enemy.x)]);
      }
      battle.fx('coldWind', { x: source.x, y: source.y, id: source.id });
      if (hitTiles.size) battle.resonanceAddFloor?.('stronghold-cold-wind', 'snow', source, [...hitTiles.values()], battle.time + num(k.windDuration));
      metric('creation', 'winds');
    }, { owner: battle });
  }
  if (num(v('sui')?.flameInterval) > 0) {
    // 祛恶之焰 as soon as an enemy comes near a 炎佑, then at most once per interval
    battle.every(0.25, () => {
      const y = v('sui');
      for (const guardian of guardians) {
        if (!guardian.alive || !guardian.deployed || battle.time + 1e-9 < num(guardian.mem.strongholdFlameAt, -Infinity)) continue;
        const near = battle.foesInRadius(guardian.x, guardian.y, num(y.flameRadius, 1.5));
        if (!near.length) continue;
        guardian.mem.strongholdFlameAt = battle.time + num(y.flameInterval, 15);
        for (const enemy of near) {
          battle.dealDamage(guardian, enemy, { amount: guardian.s.atk * num(y.flameDamage), type: 'arts', isSkill: true, canDodge: false, tags: ['resonance', TAG, 'flame'] });
          if (enemy.alive) battle.applyStatus(enemy, 'elemFragile', { duration: num(y.flameFragileDuration), value: num(y.flameFragile), source: guardian });
        }
        battle.fx('yanyouFlame', { x: near[0].x, y: near[0].y, id: guardian.id, target: near[0].id, r: num(y.flameRadius, 1.5), n: near.length, dur: 1 });
        metric('sui', 'flames');
      }
    }, { owner: battle });
  }
  // 坚阵 / 重装 hold what they block, 守望 slows what is in range: refreshed every quarter second while it lasts
  const sen = v('sentinel'), heavy = v('bruiser'), watch = v('watcher');
  if (num(sen?.blockFragile) > 0 || num(heavy?.blockedAspd) > 0 || num(watch?.rangeSlow) > 0 || num(watch?.rangeFragile) > 0) {
    battle.every(0.25, () => {
      for (const enemy of battle.enemies) {
        if (!enemy?.alive || !enemy.blockedBy) continue;
        const blocker = enemy.blockedBy;
        if (num(sen?.blockFragile) > 0 && isMember(blocker, 'sentinel')) battle.applyStatus(enemy, 'fragile', { duration: 0.5, value: num(sen.blockFragile), source: blocker });
        if (num(heavy?.blockedAspd) > 0 && isMember(blocker, 'bruiser'))
          battle.addBuff(enemy, { key: 'stronghold:heavy-held', mods: { aspd: -num(heavy.blockedAspd) }, duration: 0.5, tags: ['resonance', TAG] });
      }
      if (watch) for (const unit of members('watcher')) {
        for (const enemy of battle.enemiesInKeys(unit.rangeKeys || [], unit, unit.profile)) {
          if (num(watch.rangeSlow) > 0) battle.applyStatus(enemy, 'slow', { duration: 0.5, value: num(watch.rangeSlow), source: unit });
          if (num(watch.rangeFragile) > 0) battle.applyStatus(enemy, 'fragile', { duration: 0.5, value: num(watch.rangeFragile), source: unit });
        }
      }
    }, { owner: battle });
  }
  const sandFields = [];
  if (v('conqueror')?.blockPulse || v('redeploy') || v('experiment')?.sandSlow) {
    battle.every(0.25, () => {
      const k = v('conqueror');
      if (num(k?.blockPulse) > 0) for (const unit of members('conqueror')) {
        if (!battle.enemies.some((enemy) => enemy.alive && enemy.blockedBy === unit)) continue;
        if (battle.time + 1e-9 < num(unit.mem.strongholdPulseAt, -Infinity)) continue;
        unit.mem.strongholdPulseAt = battle.time + num(k.blockInterval, 2);
        for (const enemy of battle.foesInRadius(unit.x, unit.y, 1.5, true)) {
          hit(unit, enemy, unit.s.atk * num(k.blockPulse), 'true');
          if (num(k.blockStun) > 0 && enemy.alive) battle.applyStatus(enemy, 'stun', { duration: num(k.blockStun), source: unit });
        }
        metric('conqueror', 'blockPulses');
      }
      if (v('redeploy')) raidPoll();
      for (let index = sandFields.length - 1; index >= 0; index--) {
        const field = sandFields[index];
        if (battle.time > field.until + 1e-9) { sandFields.splice(index, 1); continue; }
        for (const enemy of battle.foesInRadius(field.x, field.y, 1.5, true)) battle.applyStatus(enemy, 'slow', { duration: 0.5, value: field.slow, source: field.owner });
      }
    }, { owner: battle });
  }

  // 突袭 — keep SP and move next to the nearest ground enemy the member can then attack
  const raidPoll = () => {
    const d = v('redeploy');
    for (const unit of members('redeploy')) {
      if (!unit.canAct) continue;
      const since = Math.max(num(unit.lastAttackAt, -Infinity), num(unit.deployedAt, -Infinity), num(unit.mem.strongholdRaidAt, -Infinity));
      if (battle.time - since < num(d.idleSeconds, 8) - 1e-9) continue;
      if (battle.enemiesInKeys(unit.rangeKeys || [], unit, unit.profile).length) continue;
      const candidates = battle.enemies.filter((enemy) => enemy.alive && !enemy.isFlying && canTargetEnemy(unit, enemy, { canHitFly: false }))
        .sort((x, y) => Math.hypot(x.x - unit.x, x.y - unit.y) - Math.hypot(y.x - unit.x, y.y - unit.y) || x.id - y.id).slice(0, RAID_CANDIDATES);
      const reach = reachOf(unit);
      for (const enemy of candidates) {
        const tile = raidTile(battle, unit, enemy, reach);
        if (!tile) continue;
        const fromX = unit.x, fromY = unit.y;
        if (!battle.moveRedeploy(unit, tile[0], tile[1], { clearSp: false })) continue;
        unit.mem.strongholdRaidAt = battle.time;
        timed(unit, 'raid-jump', { atkPct: num(d.jumpAtk) }, num(d.jumpDuration, 8));
        battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY, target: enemy.id });
        if (num(d.landingDamage) > 0) for (const foe of battle.foesInRadius(unit.x, unit.y, 1.5, true)) hit(unit, foe, unit.s.atk * num(d.landingDamage), 'phys');
        metric('redeploy', 'relocations');
        break;
      }
    }
  };

  // ---------------------------------------------------------------------------------------------------------------
  // damage
  battle.on('hit', (event) => {
    const source = event?.source, target = event?.target, dmg = event?.dmg;
    if (source?.side !== 'ally' || source.kind !== 'op' || target?.side !== 'enemy' || !dmg || dmg.type === 'element' || hasTag(dmg, TAG)) return;
    const a = v('academy');
    if (a && isWanted(target) && isMember(source, 'academy')) {
      const extra = num(a.wantedDamage) - lemuenIncrease(source);
      if (extra > 0) { applyDamageIncrease(battle, source, dmg, 1 + extra); metric('academy', 'wantedHits'); }
    }
    const k = v('creation');
    if (k && (target.s.flags.cold || target.s.flags.freeze) && isMember(source, 'creation')) applyDamageIncrease(battle, source, dmg, 1 + num(k.coldDamage));
    const f = v('flight');
    if (num(f?.executeThreshold) > 0 && (dmg.isAttack || dmg.isSkill) && !target.isBoss && target.hpRatio < num(f.executeThreshold) && isMember(source, 'flight')) {
      // the hunt ends it: a hit on a non-leader below the threshold knocks it out
      dmg.cancel = true;
      hit(source, target, target.hp * 2 + 1, 'true');
      metric('flight', 'executions');
      return;
    }
    if (num(f?.huntDamage) > 0 && target.hpRatio < num(f.huntThreshold) && isMember(source, 'flight')) applyDamageIncrease(battle, source, dmg, 1 + num(f.huntDamage));
    const s = v('risk');
    if (s && isMember(source, 'risk')) {
      if ((dmg.isAttack || dmg.isSkill) && !source.mem.strongholdEngaged) {
        // the first attack: leaves 隐匿 as an ambush and starts the opening speed and the fear window
        source.mem.strongholdEngaged = true;
        if (num(s.openingDuration) > 0) timed(source, 'siracusa-opening', { aspd: num(s.openingAspd) }, num(s.openingDuration));
        if (num(s.fearWindow) > 0) source.mem.strongholdFearUntil = battle.time + num(s.fearWindow);
        if (battle.removeBuff(source, siracusaStealthKey(source)) > 0 && num(s.ambushDamage) > 0) {
          applyDamageIncrease(battle, source, dmg, 1 + num(s.ambushDamage));
          metric('risk', 'ambushes');
        }
      }
      if (num(s.fearDamage) > 0 && target.s.flags.fear) applyDamageIncrease(battle, source, dmg, 1 + num(s.fearDamage));
    }
    const m = v('arts');
    if (m && dmg.type === 'arts' && (m.teamWide || isMember(source, 'arts')) && target.buffs.some((buff) => buff.key === ARTS_MARK_KEY)) {
      const low = num(m.lowHealth) > 0 && target.hpRatio < num(m.lowHealth);
      applyDamageIncrease(battle, source, dmg, 1 + num(m.artsMark) * (low ? 2 : 1));
      metric('arts', 'markedHits');
    }
  }, { owner: battle });

  battle.on('damaged', (event) => {
    const source = event?.source, target = event?.target, dmg = event?.dmg;
    if (source?.side !== 'ally' || source.kind !== 'op' || target?.side !== 'enemy' || !dmg || hasTag(dmg, TAG) || event.type === 'element') return;
    const k = v('creation');
    if (k && dmg.isAttack && target.alive && isMember(source, 'creation') && battle.time + 1e-9 >= num(target.mem.strongholdChillReady, -Infinity)) {
      target.mem.strongholdChillReady = battle.time + num(k.chillCooldown, 4);
      const wasCold = !!target.s.flags.cold;
      if (battle.applyStatus(target, 'cold', { duration: num(k.chillDuration, 1), source })) {
        metric('creation', 'chills');
        if (wasCold && target.s.flags.freeze) metric('creation', 'freezes');
      }
    }
    const c = v('conqueror');
    if (c && dmg.isAttack && target.alive) {
      const ratio = isMember(source, 'conqueror') ? num(c.attackTrue) : num(c.othersTrue);
      if (ratio > 0 && hit(source, target, source.s.atk * ratio, 'true') > 0) metric('conqueror', 'trueHits');
    }
    const s = v('risk');
    if (num(s?.fearChance) > 0 && dmg.isAttack && target.alive && battle.time <= num(source.mem.strongholdFearUntil, -Infinity) && isMember(source, 'risk')
      && battle.rng() < num(s.fearChance) && battle.applyStatus(target, 'fear', { duration: num(s.fearDuration, 2), source })) metric('risk', 'fears');
    const m = v('arts');
    if (m && (dmg.isAttack || dmg.isSkill) && target.alive && isMember(source, 'arts')) {
      battle.addBuff(target, { key: ARTS_MARK_KEY, duration: num(m.markDuration, 3), source, visible: true, tags: ['resonance', TAG] });
    }
    const h = v('bruiser');
    if (h && dmg.isAttack && target.alive && isMember(source, 'bruiser')) {
      if (num(h.hpStrike) > 0 && hit(source, target, source.s.maxHp * num(h.hpStrike), 'phys') > 0) metric('bruiser', 'strikes');
      if (num(h.stunEvery) > 0 && target.alive && battle.time + 1e-9 >= num(source.mem.strongholdHeavyStunAt, -Infinity)
        && battle.applyStatus(target, 'stun', { duration: num(h.stunDuration, 1), source })) {
        source.mem.strongholdHeavyStunAt = battle.time + num(h.stunEvery);
        metric('bruiser', 'stuns');
      }
    }
  }, { owner: battle });

  // 坚阵 — an attack from an enemy the member blocks is answered
  const g = v('sentinel');
  if (num(g?.counterDamage) > 0) {
    battle.on('damaged', (event) => {
      const guard = event?.target, attacker = event?.source, dmg = event?.dmg;
      if (guard?.side !== 'ally' || guard.kind !== 'op' || attacker?.side !== 'enemy' || !dmg?.isAttack || !attacker.alive || attacker.blockedBy !== guard
        || !isMember(guard, 'sentinel') || battle.time + 1e-9 < num(guard.mem.strongholdCounterAt, -Infinity)) return;
      guard.mem.strongholdCounterAt = battle.time + 1;
      hit(guard, attacker, guard.s.atk * num(g.counterDamage), 'arts');
      metric('sentinel', 'counters');
    }, { owner: battle });
  }

  // 深海猎人 — the first knock-out of each member is prevented and it stands up again
  if (num(v('flight')?.reviveHealth) > 0) {
    battle.on('fatal', (event) => {
      const unit = event?.unit;
      if (event.prevented || !unit?.alive || unit.side !== 'ally' || unit.mem.strongholdRevived || !isMember(unit, 'flight')) return;
      unit.mem.strongholdRevived = true;
      event.prevented = true;
      unit.hp = unit.s.maxHp * num(v('flight').reviveHealth);
      battle.fx('revive', { x: unit.x, y: unit.y, id: unit.id });
      metric('flight', 'revives');
    }, { owner: battle });
  }

  battle.on('kill', (event) => {
    const killer = event?.killer, victim = event?.victim;
    if (victim?.side !== 'enemy') return;
    const a = v('academy');
    if (num(a?.wantedKillSp) > 0 && (victim.mem?.strongholdWanted || isWanted(victim))) {
      for (const unit of members('academy')) gainSp(unit, num(a.wantedKillSp), 'strongholdWanted');
      metric('academy', 'wantedKills');
    }
    const f = v('flight');
    if (num(f?.killAspd) > 0 && killer?.alive && isMember(killer, 'flight')) { timed(killer, 'abyssal-hunt', { aspd: num(f.killAspd) }, num(f.killAspdDuration, 8)); metric('flight', 'huntSpeed'); }
    const e = v('enforcer');
    if (num(e?.fallSp) > 0) {
      const key = Math.round(victim.y) * COLS + Math.round(victim.x);
      for (const unit of members('enforcer')) {
        if (!unit.rangeKeySet?.has(key) || battle.time < num(unit.mem.strongholdFallSpAt, -Infinity) + 1 - 1e-9) continue;
        unit.mem.strongholdFallSpAt = battle.time;
        if (gainSp(unit, num(e.fallSp), 'strongholdFall') > 0) metric('enforcer', 'fallSp');
      }
    }
  }, { owner: battle });

  // ---------------------------------------------------------------------------------------------------------------
  // skills
  battle.on('skillStart', (event) => {
    const unit = event?.unit, skill = event?.skill ?? unit?.skill;
    if (unit?.side !== 'ally' || unit.kind !== 'op' || !skill) return;
    const a = v('academy');
    if (a && isMember(unit, 'academy')) {
      if (skill.kind === 'ammo' && num(a.ammoBonus) > 0) {
        const extra = Math.max(1, Math.round(num(skill.ammoLeft) * num(a.ammoBonus)));
        skill.ammoLeft += extra;
        metric('academy', 'bonusAmmo', extra);
      } else if (skill.kind === 'duration' && num(a.durationBonus) > 0 && Number.isFinite(skill.timeLeft)) {
        skill.timeLeft *= 1 + num(a.durationBonus);
      }
    }
    const x = v('experiment');
    if (x && isMember(unit, 'experiment')) {
      const relay = members('experiment');
      for (const ally of relay) timed(ally, 'sargon-relay', { aspd: num(x.castAspd), atkPct: num(x.castAtk) }, num(x.castDuration, 8));
      if (num(x.sandSlow) > 0) {
        const tiles = [];
        for (let r = unit.tileR - 1; r <= unit.tileR + 1; r++) for (let c = unit.tileC - 1; c <= unit.tileC + 1; c++) if (battle.grid.inRect(r, c)) tiles.push([r, c]);
        sandFields.push({ x: unit.x, y: unit.y, until: battle.time + num(x.sandDuration, 5), slow: num(x.sandSlow), owner: unit });
        battle.resonanceAddFloor?.(`stronghold-sand-${unit.id}`, 'quicksand', unit, tiles, battle.time + num(x.sandDuration, 5));
      }
      if (num(x.relaySp) > 0) for (const ally of relay) {
        if (ally === unit || battle.time < num(ally.mem.strongholdRelayAt, -Infinity) + 1 - 1e-9) continue;
        ally.mem.strongholdRelayAt = battle.time;
        gainSp(ally, num(x.relaySp), 'strongholdRelay');
      }
      metric('experiment', 'relays');
    }
    const e = v('enforcer');
    if (num(e?.castAspd) > 0 && isMember(unit, 'enforcer')) {
      const rallied = battle.allyUnits.filter((ally) => ally.alive && ally.deployed && ['op', 'token'].includes(ally.kind) && (e.teamWide || chebyshev(ally, unit) <= 1));
      for (const ally of rallied) timed(ally, 'rhodes-island-rally', { aspd: num(e.castAspd) }, num(e.castAspdDuration, 8));
      if (num(e.castSp) > 0) for (const ally of members('enforcer')) {
        if (ally === unit || battle.time < num(ally.mem.strongholdRallySpAt, -Infinity) + 1 - 1e-9) continue;
        ally.mem.strongholdRallySpAt = battle.time;
        gainSp(ally, num(e.castSp), 'strongholdRally');
      }
      metric('enforcer', 'rallies');
    }
    if (v('rhodes') && isMember(unit, 'rhodes')) columbiaShock(unit);
  }, { owner: battle });

  battle.on('skillEnd', (event) => {
    const unit = event?.unit, l = v('logistics');
    if (!l || unit?.side !== 'ally' || unit.kind !== 'op' || !unit.alive || event.reason === 'death') return;
    const own = isMember(unit, 'logistics');
    const chance = own ? num(l.refundChance) : num(l.teamChance), amount = own ? num(l.refundSp) : num(l.teamSp);
    if (chance > 0 && battle.rng() < chance && gainSp(unit, amount, 'strongholdRefund') > 0) {
      battle.fx('spGain', { x: unit.x, y: unit.y, id: unit.id });
      metric('logistics', 'refunds');
    }
  }, { owner: battle });

  // 罗德岛 — an ally a member heals hits harder for a while (HP regeneration is not healing)
  const ri = v('enforcer');
  if (num(ri?.healAtk) > 0) {
    battle.on('heal', (event) => {
      const healer = event?.source, target = event?.target;
      if (!target?.alive || target.side !== 'ally' || !['op', 'token'].includes(target.kind) || event.opts?.regen || !isMember(healer, 'enforcer')) return;
      timed(target, 'rhodes-island-care', { atkPct: num(ri.healAtk) }, num(ri.healAtkDuration, 5));
      metric('enforcer', 'caredHeals');
    }, { owner: battle });
  }

  return { tiers: [...tiers.values()].map((row) => ({ id: row.id, tier: row.tier, count: row.count })) };
}
