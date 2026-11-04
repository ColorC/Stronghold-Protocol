// Battle side of the season-2 operator adaptations (shared/resonance/operator-adaptations.js). An operator's
// `adaptation` (catalog.operators[id].adaptation) and its rewritten three-star passive drive everything here; operators
// without one, and seasons without the table, keep the native behaviour. Runs in the server Battle and the browser
// Runner alike (flags.resonance.catalog carries the adapted operators).
import { bodyInKeys } from '../../body.js';

const installedBattles = new WeakSet();
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const SP_REASON = 'resonanceAdaptation';

function operatorOf(unit, catalog) {
  if (unit?.kind !== 'op') return null;
  const raw = unit.def?.raw ?? unit.def ?? {};
  for (const id of [raw.resonanceOperatorId, raw.id, raw.chessId, unit.def?.id, unit.defId]) {
    const operator = id != null ? catalog?.operators?.[id] ?? catalog?.operators?.[String(id).replace(/^resonance_(.+)_star[123]$/, '$1')] : null;
    if (operator) return operator;
  }
  return null;
}
function starOf(unit) {
  const star = Number(unit?.def?.raw?.resonanceStar ?? unit?.resonanceStar ?? 1);
  return Number.isInteger(star) && star >= 1 && star <= 3 ? star : 1;
}
function starThree(unit, catalog, kind) {
  const operator = operatorOf(unit, catalog);
  if (!operator?.adaptation || starOf(unit) < 3) return null;
  const passive = operator.stars?.[3]?.passive;
  return passive?.kind === kind ? passive : null;
}
const onField = (unit) => unit && unit.alive && unit.deployed && !unit.removed;
function allies(battle, unit) {
  return battle.allyUnits.filter((ally) => ally.kind === 'op' && onField(ally) && ally.ownerId === unit.ownerId);
}
/** The allied operators on the 8 tiles around `unit` (周围8格). */
function around(battle, unit) {
  return allies(battle, unit).filter((ally) => ally !== unit && Math.max(Math.abs(ally.tileR - unit.tileR), Math.abs(ally.tileC - unit.tileC)) <= 1);
}
function pactsOf(unit, catalog) {
  const operator = operatorOf(unit, catalog);
  const ids = new Set(operator?.pacts ?? []);
  const input = unit.player?.input?.units?.find((entry) => String(entry?.uid) === String(unit.uid) && entry.kind !== 'token');
  for (const id of input?.extraPacts ?? []) ids.add(id);
  for (const itemId of input?.items ?? []) for (const effect of catalog?.equipment?.[itemId]?.effects ?? [])
    if (['pact_transfer', 'transfer_pact'].includes(effect.kind)) ids.add(effect.params?.pactId);
  return ids;
}
/** Distinct operators other than `unit` on the field that belong to `pact`. */
function otherMembers(battle, unit, catalog, pact) {
  const own = operatorOf(unit, catalog)?.charId;
  const ids = new Set();
  for (const ally of allies(battle, unit)) {
    const operator = operatorOf(ally, catalog);
    if (ally === unit || !operator || operator.charId === own || !pactsOf(ally, catalog).has(pact)) continue;
    ids.add(operator.charId);
  }
  return ids.size;
}
function giveSp(battle, unit, amount) {
  if (!(amount > 0) || !unit.skill?.gainSp) return;
  unit.skill.gainSp(amount, SP_REASON);
  battle.fx('spGain', { x: unit.x, y: unit.y, id: unit.id, n: amount });
}
// trigger counts stay on the Battle (sims, tests): they are not part of the bounded result the browser reports
function metric(battle, name, amount = 1) { const counts = battle.resonanceAdaptationCounts ??= {}; counts[name] = (counts[name] ?? 0) + amount; }

/** Install every adaptation present in the battle's catalog once. */
export function installOperatorAdaptations(battle, state, catalog) {
  if (installedBattles.has(battle)) return;
  installedBattles.add(battle);
  if (!Object.values(catalog?.operators ?? {}).some((operator) => operator?.adaptation)) return;
  const adaptationOf = (unit) => operatorOf(unit, catalog)?.adaptation ?? null;
  const team = battle.allyUnits.filter((unit) => unit.kind === 'op' && adaptationOf(unit));
  if (!team.length) return;

  // 部署费用 a converted operator would gain: 技力 for the team (dpToSp) or capped battle gold (bounty); the DP glyph its
  // kit pops is dropped with it
  const converted = new Set(team.filter((unit) => adaptationOf(unit).dpToSp || adaptationOf(unit).bounty).map((unit) => unit.id));
  if (converted.size) {
    const nativeAddDp = battle.addDp;
    const nativeFx = battle.fx;
    const dpCarry = new Map();
    const bountyPaid = new Map();
    battle.addDp = function addDp(playerId, n, opts = {}) {
      const unit = Number.isFinite(n) && n > 0 && opts?.sourceUnitId != null && converted.has(opts.sourceUnitId)
        ? battle.allyUnits.find((entry) => entry.id === opts.sourceUnitId) : null;
      if (!unit) return nativeAddDp.call(battle, playerId, n, opts);
      const adaptation = adaptationOf(unit);
      if (adaptation.dpToSp) {
        const { everyDp, sp, scope } = adaptation.dpToSp;
        let carry = (dpCarry.get(unit.id) ?? 0) + n;
        while (carry + 1e-9 >= everyDp) {
          carry -= everyDp;
          // the giver's own skill is running when it gives: the others receive
          for (const ally of scope === 'all' ? allies(battle, unit).filter((ally) => ally !== unit) : around(battle, unit)) giveSp(battle, ally, sp);
          metric(battle, 'dp_to_sp');
        }
        dpCarry.set(unit.id, carry);
      } else if (adaptation.bounty) {
        const operator = operatorOf(unit, catalog);
        const cap = Math.max(0, ...team.filter((entry) => operatorOf(entry, catalog) === operator)
          .map((entry) => num(adaptation.bounty.capByStar?.[starOf(entry) - 1], 0)));
        const paid = bountyPaid.get(operator.id) ?? 0;
        const gold = Math.min(num(adaptation.bounty.gold, 1), cap - paid);
        if (gold > 0) {
          bountyPaid.set(operator.id, paid + gold);
          const results = battle.resonanceResults ??= { growth: [], coins: [], forge: [] };
          (results.coins ??= []).push({ amount: gold, source: operator.id, reason: 'operator_bounty' });
          nativeFx.call(battle, 'coin', { x: unit.x, y: unit.y, id: unit.id, n: gold });
          metric(battle, 'bounty_gold', gold);
        }
      }
      return battle.getPlayer(playerId)?.dp ?? 0;
    };
    battle.fx = function fx(kind, params = {}) {
      if (kind === 'dp' && converted.has(params?.id)) return;
      return nativeFx.call(battle, kind, params);
    };
  }

  for (const unit of team) {
    const adaptation = adaptationOf(unit);
    // 缪尔赛思: the 哥伦比亚 operators start with more 技力
    if (adaptation.factionInitialSp) battle.on('battleStart', () => {
      if (!onField(unit)) return;
      for (const ally of allies(battle, unit)) if (pactsOf(ally, catalog).has(adaptation.factionInitialSp.pact)) ally.skill?.gainSp?.(adaptation.factionInitialSp.sp, 'init');
      metric(battle, 'faction_initial_sp');
    }, { owner: unit });
    // 贾维 / 银灰: bonuses that follow the other members of their faction on the field
    const scaling = adaptation.factionScaling ?? adaptation.factionAspd;
    if (scaling) battle.every(0.5, () => {
      const key = `resonance:adapt:faction:${unit.id}`;
      const count = onField(unit) ? Math.min(scaling.max, otherMembers(battle, unit, catalog, scaling.pact)) : 0;
      if (count === unit.mem.resonanceAdaptFaction) return;
      unit.mem.resonanceAdaptFaction = count;
      if (!count) { battle.removeBuff(unit, key); return; }
      const mods = adaptation.factionAspd ? { aspd: scaling.aspd * count } : { atkPct: scaling.atkPct * count, defPct: scaling.defPct * count };
      battle.addBuff(unit, { key, persist: true, allowDead: true, mods, tags: ['resonance', 'talent'] });
    }, { owner: unit, immediate: true });
    if (adaptation.position) installPosition(battle, unit, adaptation.position);
    if (adaptation.summon) installDusk(battle, unit, adaptation.summon, catalog);
  }
  installStarThree(battle, team, catalog);
}

/** 见行者: with at least two allies on her 8 surrounding tiles, the enemies her skill stuns also become 脆弱. */
function installPosition(battle, unit, p) {
  const stunned = [];
  battle.on('statusApplied', ({ source, target, status }) => {
    if (source === unit && status === 'stun' && target?.side === 'enemy') stunned.push({ target, time: battle.time });
  }, { owner: unit });
  battle.on('skillStart', ({ unit: caster }) => {
    if (caster !== unit) return;
    const now = stunned.filter((row) => Math.abs(row.time - battle.time) < 1e-9).map((row) => row.target);
    stunned.length = 0;
    if (around(battle, unit).length < p.adjacentAllies) return;
    for (const enemy of new Set(now)) if (enemy.alive) battle.applyStatus(enemy, 'fragile', { duration: p.duration, value: p.fragile, source: unit });
    if (now.length) metric(battle, 'position_fragile', now.length);
  }, { owner: unit });
}

/** 夕: 小自在 lasts by star (three stars: until the battle ends, and comes back once) and falls back to the nearest free ground. */
function installDusk(battle, unit, p, catalog) {
  const star = starOf(unit);
  const lifetime = Number.isFinite(p.durationByStar?.[star - 1]) ? p.durationByStar[star - 1] : 1e6;
  const resummon = starThree(unit, catalog, 'star3_dusk_lasting');
  let left = resummon ? num(resummon.params?.resummon, 1) : 0;
  const mine = (token) => token?.kind === 'token' && token.ownerUnit === unit;
  const live = () => battle.allyUnits.find((token) => mine(token) && token.alive && token.deployed);
  const tokenId = () => unit.def?.talents?.find((talent) => talent?.index === 1)?.tokenKey ?? unit.def?.raw?.tokens?.[0] ?? 'token_10015_dusk_drgn';
  battle.on('deploy', ({ unit: token }) => {
    if (!mine(token)) return;
    // the talent stamps its own 25 s right after the spawn: the star's lifetime goes on top of it
    battle.after(0, () => { if (token.alive) token.mem.duskUntil = battle.time + lifetime; }, { owner: token });
  }, { owner: unit });
  battle.on('attack', ({ attacker, targets }) => {
    if (attacker !== unit || !unit.mem.duskSummoned || unit.mem.resonanceDuskTried || live()) return;
    unit.mem.resonanceDuskTried = true;
    const target = (targets ?? []).find((enemy) => enemy?.side === 'enemy');
    if (!target) return;
    const free = (r, c) => battle.grid.inRect(r, c) && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c) && !battle.unitAt(r, c);
    const tiles = [];
    for (let r = battle.rect.r0; r <= battle.rect.r1; r++) for (let c = battle.rect.c0; c <= battle.rect.c1; c++) if (free(r, c)) tiles.push([r, c]);
    tiles.sort((a, b) => Math.hypot(a[0] - target.y, a[1] - target.x) - Math.hypot(b[0] - target.y, b[1] - target.x) || a[0] - b[0] || a[1] - b[1]);
    for (const [r, c] of tiles) {
      const token = battle.spawnToken(unit, tokenId(), r, c);
      if (!token) continue;
      token.mem.duskUntil = battle.time + lifetime;
      battle.fx('summon', { x: token.x, y: token.y, id: token.id, token: token.defId });
      metric(battle, 'dusk_fallback');
      break;
    }
  }, { owner: unit, priority: -10 });
  battle.every(0.5, () => {
    for (const token of battle.allyUnits) if (mine(token) && token.alive && num(token.mem.duskUntil, Infinity) <= battle.time + 1e-9) battle.retreat(token, { reason: 'expired', permanent: true });
  }, { owner: unit });
  const lost = ({ unit: token, reason }) => {
    if (!mine(token) || left <= 0 || reason !== 'killed') return;
    left--;
    unit.mem.duskSummoned = false;
    unit.mem.resonanceDuskTried = false;
    metric(battle, 'dusk_resummon');
  };
  battle.on('death', lost, { owner: unit });
}

function installStarThree(battle, team, catalog) {
  for (const unit of team) {
    // 香草 / 贾维: the first skill of the battle gives the whole team 技力
    const firstCast = starThree(unit, catalog, 'star3_first_cast_team_sp');
    if (firstCast) battle.on('skillStart', ({ unit: caster }) => {
      if (caster !== unit || unit.mem.resonanceFirstCastSp) return;
      unit.mem.resonanceFirstCastSp = true;
      for (const ally of allies(battle, unit)) if (ally !== unit) giveSp(battle, ally, num(firstCast.params?.sp, 2));
      metric(battle, 'first_cast_team_sp');
    }, { owner: unit });
    // 砾 / 谜图: the first knock-out halves the redeploy wait; coming back strikes the enemies around
    const strike = starThree(unit, catalog, 'star3_return_strike');
    if (strike) {
      battle.on('death', ({ unit: dead, reason }) => {
        if (dead !== unit || reason !== 'killed' || unit.mem.resonanceReturnUsed || !Number.isFinite(unit.respawnAt)) return;
        unit.mem.resonanceReturnUsed = true;
        unit.mem.resonanceReturnPending = true;
        unit.respawnAt = battle.time + Math.max(0, unit.respawnAt - battle.time) * num(strike.params?.timeMultiplier, 0.5);
      }, { owner: unit, priority: -10 });
      battle.on('deploy', ({ unit: back, initial }) => {
        if (back !== unit || initial || !unit.mem.resonanceReturnPending) return;
        unit.mem.resonanceReturnPending = false;
        for (const enemy of battle.foesInRadius(unit.x, unit.y, 1.5, true)) if (enemy.alive) battle.dealDamage(unit, enemy, { amount: unit.s.atk * num(strike.params?.damage, 100) / 100, type: 'arts', canDodge: false, tags: ['resonance', 'adaptation'] });
        metric(battle, 'return_strike');
      }, { owner: unit });
    }
    // 焰尾: a dodge during 焰心 stuns the attacker
    const flametail = starThree(unit, catalog, 'star3_flametail_stun');
    if (flametail) battle.on('dodge', ({ source, target }) => {
      if (target !== unit || !unit.skill?.active || source?.side !== 'enemy' || !source.alive) return;
      const key = `resonanceFlametailStun:${unit.id}`;
      if (battle.time - num(source.mem?.[key], -Infinity) < num(flametail.params?.targetCooldown, 3) - 1e-9) return;
      source.mem[key] = battle.time;
      battle.applyStatus(source, 'stun', { duration: num(flametail.params?.stun, 0.5), source: unit });
      metric(battle, 'flametail_stun');
    }, { owner: unit });
    // 塞雷娅: 药物配置 also slows the enemies in its range and makes them take more arts damage
    const saria = starThree(unit, catalog, 'star3_saria_calcify');
    if (saria) battle.on('skillStart', ({ unit: caster }) => {
      if (caster !== unit) return;
      const grid = unit.def?.skill?.rangeGrid ?? unit.skill?.rangeGrid ?? null;
      const enemies = battle.unitsInGrid(unit, grid, { side: 'enemy' });
      for (const enemy of enemies) {
        battle.applyStatus(enemy, 'slow', { duration: num(saria.params?.duration, 5), value: num(saria.params?.slow, 0.3), source: unit });
        battle.applyStatus(enemy, 'artsFragile', { duration: num(saria.params?.duration, 5), value: num(saria.params?.artsFragile, 0.2), source: unit });
      }
      if (enemies.length) metric(battle, 'saria_calcify', enemies.length);
    }, { owner: unit });
    // 玛恩纳: the skill's true damage answers every allied operator's attack, not only the 卡西米尔 ones the kit covers
    const mlynar = starThree(unit, catalog, 'star3_mlynar_all');
    if (mlynar) battle.on('damaged', (c) => {
      const source = c.source, enemy = c.target;
      if (!source || source.side !== 'ally' || source.kind !== 'op' || !c.dmg?.isAttack || c.type === 'element') return;
      const raw = source.def?.raw ?? {};
      if (raw.nationId === 'kazimierz' || (source.def?.bonds ?? []).includes('kazimierzShip')) return;
      if (enemy?.side !== 'enemy' || !enemy.alive || !unit.skill?.active || !onField(unit) || !bodyInKeys(enemy, unit.rangeKeySet)) return;
      const scale = num(unit.def?.skill?.bb?.atk_scale, 0);
      if (!(scale > 0)) return;
      battle.dealDamage(unit, enemy, { amount: unit.s.atk * scale, type: 'true', canDodge: false, isSkill: true, tags: ['skill', 'mlynarMark', 'adaptation'] });
      metric(battle, 'mlynar_all');
    }, { owner: unit });
  }
}
