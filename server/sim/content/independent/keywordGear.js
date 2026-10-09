import { applyHpLoss, absorbShields } from '../../damage.js';
import { findRaidLanding, raidRedeploy } from '../bonds/addon/battle.js';
import { KEYWORD_GEAR_BY_ID } from '../../../modes/independent/keywordGear.js';
import { COLS } from '../../constants.js';
import { bodyKeys } from '../../body.js';
import { applyDamageIncrease } from '../../../../shared/damageIncrease.js';

const entryArray = (v) => Array.isArray(v) ? v : [];
const idOf = (item) => item && typeof item === 'object' ? (item.id ?? item.sourceId ?? item.canonicalId) : item;
const live = (u) => !!u?.alive && u.deployed && !u.removed;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pointDistance = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));

function gearQuantity(item) {
  const n = Math.floor(Number(item?.quantity));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function equipmentRecord(catalog, id) {
  return catalog?.equipment?.[id] ?? Object.values(catalog?.equipment ?? {}).find((e) => e.id === id || e.sourceId === id) ?? null;
}

function gearGroupsFor(piece, catalog) {
  const groups = new Map();
  for (const item of entryArray(piece?.equipment)) {
    const rec = equipmentRecord(catalog, idOf(item));
    if (rec?.mechanism !== 'keywordGear') continue;
    const gearId = rec.params?.gearId;
    if (!KEYWORD_GEAR_BY_ID[gearId]) throw new Error(`unknown keyword gear ${gearId} on ${piece.uid}`);
    const prev = groups.get(gearId);
    if (prev) prev.quantity += gearQuantity(item);
    else groups.set(gearId, { rec, quantity: gearQuantity(item) });
  }
  return groups;
}

function installDeferredRedeployGate(battle) {
  if (battle.keywordGearDeferredRedeployOriginal) return;
  const originalRedeploy = battle.redeploy.bind(battle);
  battle.keywordGearDeferredRedeployOriginal = originalRedeploy;
  battle.redeploy = (unit, opts = {}) => {
    const gate = unit?.mem?.keywordGearDeferredRedeploy;
    if (!gate || unit.alive || unit.removed || battle.time + 1e-9 >= gate.until) return originalRedeploy(unit, opts);
    // The first caller wins; raid's home fallback must not replace its chosen raid tile.
    if (!gate.options) gate.options = { ...opts, ...(opts.tile ? { tile: [...opts.tile] } : {}) };
    if (gate.polling) return false;
    unit.respawnAt = Infinity; // prevent an early paid automatic return while this free/raid return is deferred
    gate.polling = true;
    const retry = () => {
      if (unit.alive || unit.removed) { delete unit.mem.keywordGearDeferredRedeploy; return; }
      if (battle.time + 1e-9 < gate.until) { battle.after(0.1, retry, { owner: unit }); return; }
      const request = gate.options ?? { free: true };
      unit.respawnAt = battle.time;
      delete unit.mem.keywordGearDeferredRedeploy;
      let returned = originalRedeploy(unit, request);
      if (!returned && request.tile) returned = originalRedeploy(unit, { ...request, tile: null });
      if (returned) {
        if (gate.targetId) battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id, gear: 'portable-meltdown-trainer', target: gate.targetId });
        return;
      }
      unit.respawnAt = Infinity;
      unit.mem.keywordGearDeferredRedeploy = gate;
      battle.after(0.1, retry, { owner: unit });
    };
    battle.after(0.1, retry, { owner: unit });
    return false;
  };
}

/** Install only on independent Battle instances. Stack counts are total worn pieces, including `quantity`. */
export function installKeywordGear(battle, { catalog, pieces = [], units = null } = {}) {
  if (!battle || typeof battle.on !== 'function') throw new TypeError('installKeywordGear requires a Battle');
  const byUid = new Map(entryArray(pieces).map((p) => [p.uid, p]));
  const installed = battle.independentKeywordInstallations ||= [];
  const added = [];
  for (const unit of units || battle.allyUnits) {
    if (!units && unit.kind !== 'op') continue;
    const piece = byUid.get(unit.uid);
    if (!piece) continue;
    for (const [gearId, group] of gearGroupsFor(piece, catalog)) {
      if (installed.some(x => x.unit === unit && x.gearId === gearId)) continue;
      const entry = { unit, gearId, quantity: group.quantity, rec: group.rec };
      installed.push(entry); added.push(entry);
    }
  }

  // Original copies created during combat join the same damage-sharing group.
  if (!battle.independentKeywordCoverHookInstalled) {
    battle.independentKeywordCoverHookInstalled = true;
    battle.independentPostMitigationDamage = (source, target, amount, dmg, api) => {
      if (!(amount > 0) || target?.side !== 'ally') return null;
      const ownerId = target.ownerId ?? target.ownerUnit?.ownerId;
      if (ownerId == null) return null;
      const active = installed.filter((x) => x.gearId === 'oath-cover' && x.unit.ownerId === ownerId && live(x.unit));
      const guardOf = (x) => clamp(Number(x.rec.params.wearerGuardBase ?? 0.10) + Number(x.rec.params.wearerGuardPerPiece ?? 0.05) * (x.quantity - 1), 0, Number(x.rec.params.wearerGuardCap ?? 0.95));
      const apply = (recipient, finalAmount, useShield = true) => api.applyHpLoss(battle, source, recipient, useShield ? api.absorbShields(battle, recipient, Math.max(0, finalAmount)) : Math.max(0, finalAmount), dmg);
      if (!active.length) return null;
      const targetWearer = active.find((x) => x.unit === target);
      if (targetWearer) return apply(target, amount * (1 - guardOf(targetWearer)), false);
      const shareRate = Math.max(...active.map((x) => clamp(Number(x.rec.params.shareBase ?? 0.20) + Number(x.rec.params.sharePerPiece ?? 0.05) * (x.quantity - 1), 0, Number(x.rec.params.shareCap ?? 0.90))));
      const shared = amount * shareRate;
      let removed = apply(target, amount - shared, false);
      const each = shared / active.length;
      for (const wearer of active) {
        if (!live(wearer.unit)) continue;
        removed += apply(wearer.unit, each * (1 - guardOf(wearer)), true);
      }
      return removed;
    };
  }

  for (const { unit, gearId, quantity, rec } of added) {
    const p = rec.params ?? {};
    const key = `independent:keywordGear:${gearId}:${unit.uid}`;
    switch (gearId) {
      case 'oath-cover':
        break;
      case 'shield-generator': {
        const layers = Math.max(0, Math.floor(Number(p.layersBase ?? 5) + Number(p.layersPerPiece ?? 3) * (quantity - 1)));
        const threshold = Math.max(1, Math.floor(Number(p.growthLayerThreshold ?? 5)));
        unit.mem.keywordShieldLayerGrowth = { threshold, broken: 0, triggers: 0 };
        battle.on('shieldLayersBroken', ({ unit: shielded, layers: broken }) => {
          if (shielded !== unit || !(broken > 0)) return;
          const state = unit.mem.keywordShieldLayerGrowth;
          state.broken += broken;
          while (state.broken >= state.threshold) {
            state.broken -= state.threshold;
            state.triggers++;
            battle.emit('shieldLayersThreshold', { unit, gearId, threshold: state.threshold, triggerIndex: state.triggers, layersBrokenTotal: state.triggers * state.threshold });
          }
        }, { owner: unit });
        const deployShield = () => {
          const buffKey = `${key}:layers`;
          const current = Number(unit.findBuff(buffKey)?.shieldHits ?? 0);
          battle.addBuff(unit, { key: buffKey, shieldHits: current + layers, duration: Infinity, persist: true, allowDead: true, refresh: 'replace' });
        };
        battle.on('deploy', ({ unit: who }) => { if (who === unit) deployShield(); }, { owner: unit });
        if (live(unit)) deployShield();
        break;
      }
      case 'assault-oath': {
        const idle = Number(p.idleSeconds ?? 10);
        const duration = Math.min(Number(p.durationCap ?? 30), Number(p.durationBase ?? 10) + Number(p.durationPerPiece ?? 1) * (quantity - 1));
        const aspd = Number(p.attackSpeedBase ?? 30) + Number(p.attackSpeedPerPiece ?? 20) * (quantity - 1);
        const poll = Math.max(0.05, Number(p.pollSeconds ?? 0.1));
        battle.on('deploy', ({ unit: who }) => {
          if (who !== unit) return;
          battle.addBuff(unit, { key: `${key}:aspd`, duration, refresh: 'replace', mods: { aspd } });
          unit.mem[`${key}:lastDeploy`] = battle.time;
        }, { owner: unit });
        battle.every(poll, () => {
          if (!live(unit) || !unit.canAct || unit.s.flags.invulnerable) return;
          const since = Math.max(Number(unit.lastAttackAt ?? -Infinity), Number(unit.deployedAt ?? -Infinity), Number(unit.mem[`${key}:lastDeploy`] ?? -Infinity));
          if (battle.time - since < idle - 1e-9) return;
          const found = findRaidLanding(battle, unit, unit.ownerId);
          if (!found) return;
          if (!raidRedeploy(battle, unit, found.tile[0], found.tile[1])) {
            const pending = unit.mem.keywordGearDeferredRedeploy;
            if (pending) pending.targetId = found.target.id;
            return;
          }
          unit.mem[`${key}:lastDeploy`] = battle.time;
          battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id, gear: gearId, target: found.target.id });
        }, { owner: unit });
        break;
      }
      case 'hammer-oath': {
        const base = Number(p.baseAtkRatio);
        const inc = Number(p.perPieceAtkRatio);
        if (!(base >= 0 && inc >= 0)) throw new Error(`keywordGear ${gearId} needs configured baseAtkRatio and perPieceAtkRatio`);
        const ratio = base + inc * (quantity - 1);
        const radius = Number(p.radius ?? 0.9);
        battle.on('attack', ({ attacker, targets, isSkill }) => {
          if (attacker !== unit || ratio <= 0) return;
          const primary = targets?.[0];
          if (!primary || primary.side !== 'enemy') return;
          for (const enemy of battle.enemies) {
            if (!live(enemy) || pointDistance(enemy, primary) > radius) continue;
            battle.dealDamage(unit, enemy, {
              amount: unit.s.atk * ratio, type: 'phys', isAttack: true, isSkill,
              isSplash: enemy !== primary, tags: ['independentEquipment', 'keywordGear', gearId],
            });
          }
        }, { owner: unit });
        break;
      }
      case 'precision-oath': {
        const pct = Math.min(Number(p.ignoreCap ?? 0.8), Number(p.ignoreBase ?? 0.2) + Number(p.ignorePerPiece ?? 0.03) * (quantity - 1));
        battle.addBuff(unit, { key, mods: { defIgnorePct: pct, resIgnorePct: pct }, persist: true, allowDead: true });
        break;
      }
      case 'unyielding-oath': {
        const probability = Math.min(Number(p.probabilityCap ?? 1), Number(p.baseProbability ?? 0.18) + Number(p.probabilityPerPiece ?? 0.004) * (quantity - 1));
        let banked = false;
        battle.on('dollSwap', ({ unit: who }) => {
          if (who !== unit || banked || !unit.alive) return;
          if (battle.rng() < probability) banked = true;
        }, { owner: unit });
        battle.on('deploy', ({ unit: who }) => { if (who === unit) banked = false; }, { owner: unit });
        battle.on('death', ({ unit: who, reason }) => {
          if (who !== unit || !['killed', 'retreat', 'merchant'].includes(reason) || unit.removed || unit.alive) return;
          if (banked || battle.rng() < probability) {
            banked = false;
            battle.redeploy(unit, { free: true });
          }
        }, { owner: unit, priority: 9 });
        break;
      }
      case 'blast-deploy-platform': {
        const damage = Number(p.damageBase ?? 1000) + Number(p.damagePerPiece ?? 300) * (quantity - 1);
        const radius = Number(p.radius ?? 4);
        battle.on('deploy', ({ unit: who }) => {
          if (who !== unit) return;
          for (const enemy of battle.enemies) if (live(enemy) && pointDistance(enemy, unit) <= radius) {
            battle.dealDamage(unit, enemy, { amount: damage, type: p.damageType ?? 'true', tags: ['independentEquipment', 'keywordGear', gearId] });
          }
        }, { owner: unit });
        break;
      }
      case 'recoil-airdrop': {
        const damage = Number(p.damageBase ?? 15000) + Number(p.damagePerPiece ?? 500) * (quantity - 1);
        battle.on('deploy', ({ unit: who }) => {
          if (who !== unit) return;
          const R = battle.grid.rect;
          const legal = [];
          for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
            const tileInfo = battle.grid.tile(r, c);
            if (tileInfo?.key !== 'tile_forbidden' && tileInfo?.pass !== 'NONE') legal.push([r, c]);
          }
          if (!legal.length) { battle._ev(['keywordGearRandomTile', unit.id, null, null, false]); return; }
          const legalKeys = new Set(legal.map(([r, c]) => r * COLS + c));
          const enemyKeys = new Set(battle.enemies.filter(live).flatMap((enemy) => bodyKeys(enemy)).filter((k) => legalKeys.has(k)));
          const occupied = legal.filter(([r, c]) => enemyKeys.has(r * COLS + c));
          const pool = occupied.length ? occupied : legal;
          const tile = pool[Math.floor(battle.rng() * pool.length)];
          const [r, c] = tile;
          battle._ev(['keywordGearRandomTile', unit.id, r, c, occupied.length > 0]);
          for (const enemy of battle.enemies) if (live(enemy) && bodyKeys(enemy).includes(r * COLS + c)) {
            battle.dealDamage(unit, enemy, { amount: damage, type: p.damageType ?? 'arts', tags: ['independentEquipment', 'keywordGear', gearId] });
          }
        }, { owner: unit });
        break;
      }
      case 'portable-meltdown-trainer': {
        installDeferredRedeployGate(battle);
        if (unit.mem[`${key}:installed`]) break;
        unit.mem[`${key}:installed`] = true;
        unit.mem[`${key}:attacked`] = new Set();
        unit.mem[`${key}:snapshot`] = null;
        unit.mem[`${key}:used`] = false;
        battle.on('deploy', ({ unit: who }) => { if (who === unit) delete unit.mem.keywordGearDeferredRedeploy; }, { owner: unit, priority: -10 });
        battle.on('attack', ({ attacker, targets }) => {
          if (attacker?.side !== 'enemy' || !targets?.includes(unit)) return;
          unit.mem[`${key}:attacked`].add(attacker.id);
        }, { owner: unit });
        battle.on('retreating', ({ unit: who, reason }) => {
          if (who !== unit || !['retreat', 'merchant', 'raid'].includes(reason)) return;
          unit.mem[`${key}:snapshot`] = { dmgDealtMul: Number(unit.s?.dmgDealtMul ?? 1) };
        }, { owner: unit });
        battle.on('death', ({ unit: who, reason }) => {
          if (who !== unit || unit.mem[`${key}:used`] || !['retreat', 'merchant', 'raid'].includes(reason)) return;
          unit.mem[`${key}:used`] = true;
          const snapshot = unit.mem[`${key}:snapshot`] ?? { dmgDealtMul: 1 };
          const base = Number(p.damageBase ?? 10000) + Number(p.damagePerPiece ?? 3000) * (quantity - 1);
          const multiplier = Number(p.hitEnemyMultiplier ?? 2);
          const attacked = unit.mem[`${key}:attacked`];
          const redeployMul = Number(p.redeployTimeMultiplier ?? 2);
          unit.respawnAt = unit.deathAt + Math.max(0, unit.respawnAt - unit.deathAt) * redeployMul;
          unit.mem.keywordGearDeferredRedeploy = { until: unit.respawnAt, options: null, polling: false };
          for (const enemy of battle.enemies) if (live(enemy)) {
            const damage = battle.makeDamage({
              amount: base * (attacked.has(enemy.id) ? multiplier : 1),
              type: p.damageType ?? 'true', sourceless: true,
              tags: ['independentEquipment', 'keywordGear', gearId],
            });
            applyDamageIncrease(battle, unit, damage, snapshot.dmgDealtMul);
            battle.dealDamage(unit, enemy, damage);
          }
        }, { owner: unit, priority: 15 });
        break;
      }
      default: throw new Error(`unimplemented keyword gear ${gearId}`);
    }
  }
}
