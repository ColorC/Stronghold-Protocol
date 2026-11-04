// server/sim/battle/deploy.js — Battle methods: deployment, death and redeploy: _deploy (home, landing or rest tile; 联防
// carry), kill / retreat and the removal bookkeeping (_remove, hooks of removed units released at step end), redeploy /
// automatic redeploys, leaks.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { COLS } from '../constants.js';
import { unitInfo } from '../snapshot.js';
import { bodyOnTile, nonOccupyingTokenAt } from '../body.js';
import { fin } from './util.js';

export class BattleDeploy {
  registerAssaultDeployAnchor(owner, spec) {
    if (!this.assaultStrict || !this.allyUnits.includes(owner) || owner.kind !== 'op'
      || !spec || spec.kind !== 'deployAnchor' || typeof spec.name !== 'string' || !spec.name
      || !Number.isFinite(spec.deployCost) || spec.deployCost < 0
      || spec.combatant !== false || spec.population !== 0 || spec.attackable !== false || spec.healable !== false) {
      throw new TypeError('invalid noncombatant Assault deployment anchor');
    }
    this.assaultDeployAnchors ??= new Map();
    const id = `${owner.uid}:${spec.name}`;
    const anchor = Object.freeze({ id, kind: 'deployAnchor', name: spec.name, ownerUid: owner.uid, ownerId: owner.ownerId,
      sourceTemplateId: spec.sourceTemplateId ?? null, deployCost: spec.deployCost,
      combatant: false, population: 0, attackable: false, healable: false });
    this.assaultDeployAnchors.set(id, anchor);
    return anchor;
  }

  assaultDeploymentArea(ownerId) {
    const operators = this.allyUnits.filter((unit) => unit.kind === 'op' && unit.ownerId === ownerId && !unit.removed);
    const entries = operators.map((unit, index) => ({ kind: 'operator', unit, uid: unit.uid,
      deployCost: this.assaultDeploymentCost(unit), formationIndex: index }));
    for (const anchor of this.assaultDeployAnchors?.values() ?? []) {
      if (anchor.ownerId !== ownerId) continue;
      const index = operators.findIndex((unit) => unit.uid === anchor.ownerUid);
      if (index >= 0) entries.push({ ...anchor, formationIndex: index + .5 });
    }
    return entries.sort((a, b) => a.deployCost - b.deployCost || a.formationIndex - b.formationIndex);
  }

  assaultDeployAnchorRelations(unit) {
    if (!this.assaultStrict || unit.kind !== 'op') return [];
    const area = this.assaultDeploymentArea(unit.ownerId);
    const index = area.findIndex((entry) => entry.unit === unit);
    return area.filter((entry) => entry.kind === 'deployAnchor').map((anchor) => ({
      anchor, leftOfAnchor: index >= 0 && index < area.indexOf(anchor), self: anchor.ownerUid === unit.uid,
      active: this.allyUnits.some((owner) => owner.uid === anchor.ownerUid && owner.alive && owner.deployed && !owner.removed),
    }));
  }

  assaultDeploymentOrder() {
    if (!this.assaultStrict || !this.assaultDeployAnchors?.size) return this.allyUnits;
    const ordered = [...this.allyUnits];
    for (const player of this.players) {
      const positions = ordered.flatMap((unit, index) => unit.kind === 'op' && unit.ownerId === player.playerId ? [index] : []);
      const units = this.assaultDeploymentArea(player.playerId).filter((entry) => entry.kind === 'operator').map((entry) => entry.unit);
      const rank = new Map(units.map((unit, index) => [unit, index]));
      const group = positions.map((index) => ordered[index]).sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
      positions.forEach((index, ordinal) => { ordered[index] = group[ordinal]; });
    }
    return ordered;
  }

  /**
   * Deploy `u` on its home tile, or on `tile` ([r, c]: a one-off landing tile — the home stays the board tile; an
   * operator that left the field comes back on its body tile, restTile). `keepSp` = { sp, charges }
   * restored right after the skill reset, before the `deploy` hook fires.
   */
  assaultDeploymentCost(unit) {
    const cost = Number(unit?.base?.cost ?? 0);
    const delta = Number(unit?.mem?.assaultCostDelta ?? 0);
    const baseCost = Math.max(0, (Number.isFinite(cost) ? cost : 0) + (Number.isFinite(delta) ? delta : 0));
    const resolver = this.assaultCostResolver;
    let resolved = typeof resolver === 'function' ? resolver(this, unit, baseCost) : baseCost;
    if (!Number.isFinite(resolved) || resolved < 0) throw new TypeError('Invalid assault deployment cost');
    if (this.assaultStrict && this._hooks.assaultDeploymentCost) {
      // A quote is side-effect free: one-shot resources are consumed only by
      // the subsequent successful deploy hook, never by affordability checks.
      const quote = { battle: this, unit, baseCost, amount: resolved };
      this.emit('assaultDeploymentCost', quote);
      resolved = quote.amount;
      if (!Number.isFinite(resolved) || resolved < 0) throw new TypeError('Invalid assault deployment cost');
    }
    return resolved;
  }

  _deploy(u, { initial = false, carry = null, tile = null, keepSp = null, preBattleAggroSeq = null, free = false, assaultPaid = false, paidAmount = 0, assaultRedeploy = null } = {}) {
    if ((u.alive && u.deployed) || u._removing) return false;
    const R0 = tile ? tile[0] : u.homeR, C0 = tile ? tile[1] : u.homeC;
    if (!this.grid.inRect(R0, C0)) {
      this.log(`${u} at ${R0},${C0} is outside the field rect; not deployed`);
      if (!tile) u.removed = true;
      return false;
    }
    const k = R0 * COLS + C0;
    const occ = this._occ[k];
    const battle = /** @type {any} */ (this);
    const tokenAt = nonOccupyingTokenAt(battle.allyUnits, R0, C0, u);
    const sharedOwnerOperator = u.occupiesTile === false && occ?.alive && occ.deployed && occ.side === 'ally'
      && occ.kind === 'op' && u.ownerId != null && occ.ownerId === u.ownerId;
    if (tokenAt && !(u.kind === 'op' && (tokenAt.ownerId ?? tokenAt.ownerUnit?.ownerId) != null && (tokenAt.ownerId ?? tokenAt.ownerUnit?.ownerId) === u.ownerId)) return false;
    if (u.occupiesTile === false) {
      const constraints = u.def?.raw?.sourceTemplate ?? u.def?.raw ?? u.def ?? {};
      const placement = constraints.assaultPlacementClass ?? (constraints.rangedTilesOnly ? 'high' : String(u.def?.position ?? 'MELEE').toLowerCase());
      const ranged = ['ranged', 'all', 'high'].includes(placement);
      const terrain = this.grid.tile(R0, C0);
      const waiting = battle.allyUnits.some((other) => {
        if (other === u || other.alive || other.removed || (other.kind !== 'op' && other.kind !== 'token')) return false;
        const [rr, cc] = this.restTile(other); return rr === R0 && cc === C0;
      });
      if (u.kind !== 'token' || u.ownerId == null || !this.grid.canStand(R0, C0, { ranged })
        || (placement === 'high' && terrain.height !== 'HIGH' && terrain.build !== 'RANGED')
        || this.grid.isObstacle(R0, C0) || this.downOn(R0, C0, u)
        || battle.enemies.some((enemy) => enemy.alive && enemy.deployed && bodyOnTile(enemy, R0, C0))
        || (u.player && !this.onOwnBoard(u.player, R0, C0))
        || waiting) return false;
    }
    if (occ && occ !== u && occ.alive && occ.deployed && !sharedOwnerOperator) { this.log(`tile ${R0},${C0} occupied; ${u} not deployed`); return false; }
    // "倒地干员所在地块视为可部署，但所有我方单位在此处的部署行为将被阻止" (PRTS 卫戍协议/帮助 §作战阶段 单位部署)
    if (this.downOn(R0, C0, u)) { this.log(`a knocked-out operator lies on ${R0},${C0}; ${u} not deployed`); return false; }
    let actualPaid = this.assaultStrict && assaultPaid ? paidAmount : 0;
    // PRTS 卫戍协议/帮助 (research 01 §4.3): the units on the field at battle start all deploy for free, top to bottom then
    // left to right; the DP is spent on redeploys only. A one-shot fee waiver stays armed for the first paid entry.
    if (this.assaultStrict && !free && !assaultPaid && !initial) {
      const player = this.getPlayer(u.ownerId);
      const cost = u.mem.assaultSkillFree ? 0 : this.assaultDeploymentCost(u);
      if (!player || player.dp + 1e-9 < cost) {
        u.mem.assaultPendingEntry = true;
        return false;
      }
      actualPaid = cost;
      player.dp = Math.max(0, player.dp - cost);
      u.mem.assaultPendingEntry = false;
      u.mem.assaultSkillFree = false;
    }
    const first = u.deploySeq === 0;
    u.alive = true;
    u.deployed = true;
    u.removed = false;
    u.hidden = false;
    u.body = null;
    if (this.assaultStrict) u.mem.assaultPendingEntry = false;
    if (this.assaultStrict && !initial) u.mem.assaultSkillFree = false;
    u.countdown = null; // a countdown summon's content starts its new life in the deploy hook (content/tokens.js startCountdown)
    u.downAtHome = false; // a new deployment: a later knock-out lies where it falls again (Battle._layBody)
    u.x = C0; u.y = R0; u.tileR = R0; u.tileC = C0;
    u.blocking = [];
    u.deploySeq = ++this._deploySeq;
    // A prepared map character is instantiated after the board deployment but keeps an earlier target order.
    // Its deploySeq remains the identity of this actual deployment for scheduled effects and redeploy checks.
    u.aggroSeq = preBattleAggroSeq ?? u.deploySeq;
    u.deployedAt = this.time;
    u.atkCd = 0;
    u.lastAttackAt = -Infinity;
    u.elem.burn = u.elem.neural = u.elem.necrosis = u.elem.apoptosis = u.elem.erosion = 0;
    u.ground = this.grid.isLow(R0, C0) && !this._elevated?.has(k);
    u.markDirty();
    u.hp = u.s.maxHp;
    // 联防 carry (PRTS 卫戍协议/帮助 §联防阶段 "将对应单位的生命比例、技力修改至与上一阶段结束时相同（召唤物仅修改技力…）"):
    // an operator restores HP/SP, a summon SP only; actual 联防 opening restoration is deferred until Battle.start ends
    const cs = initial || (first && this._startDeploying) ? (carry ?? u.carry) : null;
    const restoreLater = this.kind === 'unite' && this._startDeploying;
    if (!restoreLater && cs && u.kind === 'op' && Number.isFinite(cs.hpPct) && cs.hpPct > 0) u.hp = u.s.maxHp * Math.min(1, cs.hpPct);
    if (u.occupiesTile !== false) this._occ[k] = u;
    this._refreshRange(u); // also rebuilds baseRangeKeys (initial range incl. permanent rangeExtend)
    if (!u.skill) this._setupUnit(u);
    u.skill.reset(restoreLater ? null : cs);
    const sk = u.skill;
    // "自动操作具有3s冷却，在完成一次操作或作战开始时部署的单位将进入冷却" (PRTS 卫戍协议/帮助; skills.js)
    if (initial) sk.opReadyAt = this.time + this.flags.startOpCooldown;
    // keepSp (突袭 "保留技力"): the SP / charges before the jump — not for a skill that costs no SP (spCost 0, the
    // deploy-timed skills), which reset() just re-armed as at every deployment: the retreat ended it, so its snapshot
    // holds 0 charges, and writing that back took the charge 伊内丝 S3's deploy hook casts with (community report:
    // 伊内丝激活突袭瞬移以后3技能被吞; those with activateOnDeploy run already, skipped by `!sk.active`)
    if (keepSp && !sk.noSkill && sk.kind !== 'passive' && !sk.active && sk.spCost > 0) {
      sk.charges = Math.max(0, Math.min(sk.maxCharges, Math.floor(fin(keepSp.charges, 0))));
      sk.sp = Math.max(0, Math.min(sk.spCost, fin(keepSp.sp, 0)));
      if (sk.charges >= sk.maxCharges) sk.sp = sk.spCost;
    }
    if (first) this._ev(['spawn', unitInfo(u)]);
    this._ev(['deploy', u.id]);
    if (this._hooks.deploy) this.emit('deploy', { unit: u, initial, ...(this.assaultStrict ? {
      actualPaid, skillEntry: assaultRedeploy?.skill === true, deployAnchors: this.assaultDeployAnchorRelations(u),
    } : null) });
    // 联防: "部署完成后，将对应单位的…技力修改至与上一阶段结束时相同" — the carried SP is set again once the deployment is
    // done, so a deploy-time SP gift (独行, 黄沙罗盘 …) does not come on top of it; later redeploys keep those gifts
    if (!restoreLater && cs && Number.isFinite(cs.sp) && u.alive && u.skill) u.skill.setSpTotal(cs.sp);
    if (this.assaultStrict && !first && u.kind === 'op') {
      const details = assaultRedeploy ?? {};
      this.assaultRuntime.publish('redeploy', {
        source: u, sourceUid: u.uid ?? u.id, target: u, targetUid: u.uid ?? u.id,
        alive: false, skill: !!details.skill, free: !!details.free, actualPaid,
      }, { cause: details.cause ?? this.assaultRuntime.currentCause });
    }
    return true;
  }

  /** Mark `unit` dead (hp reached 0). Fires `kill` then `death`. */
  kill(unit, killer = null, damage = null) {
    if (!unit || !unit.alive) return;
    unit.hp = 0;
    if (this._hooks.kill) this.emit('kill', { killer, victim: unit });
    // a nested kill/retreat inside the handlers already removed it: a later handler's hp write must not stick
    if (!unit.alive) { if (!unit.bossPool) unit.hp = 0; return; }
    if (unit.hp > 0 && !unit.bossPool) { // revived by a kill handler (clamped: a handler may write any number)
      unit.hp = Math.min(unit.hp, unit.s.maxHp);
      return;
    }
    unit.hp = 0; // NaN / negative writes from handlers
    this._remove(unit, 'killed', killer, false, false, damage);
  }

  skillRedeploy(unit, { cause = null } = {}) {
    if (!this.assaultStrict || !unit || unit.side !== 'ally' || unit.kind !== 'op' || unit.removed) return false;
    const wasAlive = unit.alive && unit.deployed;
    let ok = false;
    if (wasAlive) {
      unit.hp = unit.s.maxHp;
      ok = true;
    } else {
      const [r, c] = this.restTile(unit);
      const k = r * COLS + c;
      const occ = this._occ[k];
      if (!this.grid.inRect(r, c) || (occ && occ.alive && occ !== unit) || this.downOn(r, c, unit)) return false;
      ok = this._deploy(unit, {
        initial: false, tile: r === unit.homeR && c === unit.homeC ? null : [r, c], free: true,
        assaultRedeploy: { skill: true, free: true, cause },
      });
    }
    if (ok && wasAlive) this.assaultRuntime.publish('redeploy', {
      source: unit, sourceUid: unit.uid ?? unit.id, target: unit, targetUid: unit.uid ?? unit.id,
      alive: true, skill: true, free: true, actualPaid: 0,
    }, { cause: cause ?? this.assaultRuntime.currentCause });
    return ok;
  }

  /**
   * Withdraw an ally without a kill (it may redeploy after its respawn time): an operator lies down where it stood and
   * comes back there (isDown, GitHub #60) — unless `permanent`, or the 突袭 retreat ('raid') that redeploys it at once.
   * `dying`: a forced exit that plays the operator's death animation — a knock-out put off by its own effect (史尔特尔's
   * 余烬, 骑士戒律 + 竞技旗); the `death` hook carries it (Touch's 超脱 counts such an exit: content/tokens.js).
   */
  retreat(unit, { reason = 'retreat', permanent = false, dying = false } = {}) {
    if (!unit || !unit.alive || unit.side !== 'ally') return;
    if (this._hooks.retreating) this.emit('retreating', { unit, reason, permanent, dying });
    this._remove(unit, reason, null, permanent, dying);
  }

  _remove(unit, reason, killer = null, permanent = false, dying = false, damage = null) {
    this._cutAttackStand(unit);
    unit.alive = false;
    unit.removeReason = reason;
    unit.deployed = false;
    unit.deathAt = this.time;
    // while the removal bookkeeping runs, a skill onEnd handler must not redeploy the unit (it would come back
    // alive but without its tile in _occ, its buffs wiped and a respawn timer pending) — redeploy from `death` instead
    unit._removing = true;
    if (unit.skill && unit.skill.active) {
      this._safe(() => unit.skill.end('death'), 'skill.end', unit);
      unit.skill.active = false;
    }
    unit._removing = false;
    if (unit.side === 'ally') {
      this.releaseBlocked(unit);
      const k = unit.tileR * COLS + unit.tileC;
      if (this._occ[k] === unit) this._occ[k] = null;
      // keep persistent buffs only
      const kept = [];
      for (const b of unit.buffs) {
        if (b.persist) kept.push(b);
        else if (b.visible || b.status) this._ev(['status', unit.id, b.status ?? b.key, 0]);
      }
      unit.buffs = kept;
      unit.markDirty();
      if (unit.kind === 'op' && !permanent) {
        if (reason === 'killed') { const pp = this._pp(unit.ownerId); if (pp) pp.deaths++; }
        const mul = unit.persist.redeployMul * unit.s.redeployMul;
        unit.respawnAt = this.time + Math.max(0, unit.base.respawnTime * mul);
        if (this.isDown(unit)) this._layBody(unit); // before `die` / `death`: the body's tile is final for them
      } else {
        unit.removed = true;
      }
      if (unit.kind === 'device' && unit.obstacle) this.grid.setObstacle(unit.tileR, unit.tileC, false, unit.obstacleKind);
    } else {
      unit.removed = true;
      this._unblock(unit);
      this._enemiesDirty = true;
      if (reason === 'killed') {
        const pp = this._pp(unit.ownerId);
        if (unit.counted) {
          this.killed++;
          if (pp) pp.killed++;
        }
        // the HUD capsule's numerator (DESIGN §14): only the enemies the stage itself scheduled (`inTotal`) — a split
        // child / summon / part knocked down here is no 已解决 of the stage's own list and moves the capsule not at all
        if (unit.inTotal) {
          this.killedInTotal++;
          if (pp) pp.killedInTotal++;
        }
        if (killer) killer.stats.kills++;
        if (unit.bounty && unit.bounty.coins > 0) this.addCoins(this._bountyPayee(unit, killer), unit.bounty.coins);
      }
    }
    // the reason ('killed' | 'retreat' | 'expired' | …) lets the client keep the knock-down sound for real knock-outs
    if (reason !== 'leak') this._ev(['die', unit.id, reason]);
    if (this._hooks.death) this.emit('death', { unit, reason, killer, dying: !!dying });
    if (unit.removed) this._toRelease.push(unit);
    if (this.assaultStrict && reason === 'killed') {
      const payload = {
        source: killer, sourceUid: killer?.uid ?? killer?.id ?? null, target: unit, targetUid: unit.uid ?? unit.id,
        amount: damage?.amount ?? null, damageType: damage?.type ?? null, attackId: damage?.attackId ?? null,
        skillId: damage?.isSkill ? killer?.skill?.evSkillId ?? null : null,
        sourceClass: damage?.isSkill ? 'skill' : (damage?.isAttack ? 'attack' : 'effect'), reason, unitKind: unit.kind,
      };
      this.assaultRuntime.publish('kill', payload, { sourceUid: payload.sourceUid });
      this.assaultRuntime.publish('death', payload, { sourceUid: payload.sourceUid });
    }
  }

  /**
   * Drop hooks and periodic timers (`every`) owned by permanently removed units (killed/leaked enemies, expired
   * tokens, destroyed devices). Runs at the end of the step, so the unit's own death/leak handlers still fire;
   * one-shot `after` callbacks are kept (they run once and are gone). Without this, per-enemy content hooks pile up
   * and every emit walks the handlers of every enemy that ever spawned.
   */
  _releaseRemoved() {
    const set = new Set();
    for (const u of this._toRelease) if (u.removed && !u.alive) set.add(u);
    this._toRelease = [];
    if (!set.size) return;
    if (this.assaultRuntime) for (const unit of set) this.assaultRuntime.offOwner(unit);
    for (const name of Object.keys(this._hooks)) {
      const list = this._hooks[name];
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.owner != null && set.has(h.owner)) h.removed = true;
        else list[w++] = h;
      }
      list.length = w;
      if (!w) delete this._hooks[name];
    }
    for (const sc of this._sched) if (sc.interval > 0 && sc.owner != null && set.has(sc.owner)) sc.cancelled = true;
  }

  /**
   * Immediately redeploy a dead (or retreated) ally on its rest tile (restTile: where an operator that left the field
   * lies, else its home tile). opts:
   *   free=true   no DP cost (false: pays `base.cost`, refused when the player lacks the DP)
   *   tile=[r,c]  land on this in-rect tile instead (the home stays the board tile); refused (false) when the tile is
   *               outside the rect, a living unit stands there or another knocked-out operator lies there — no fallback
   *   keepSp      keep the SP / charges the unit had (保留技力): restored before the `deploy` hook fires
   * Returns true when the unit was deployed (full HP, `deploy {initial:false}` fires).
   */
  redeploy(unit, { free = true, tile = null, keepSp = false } = {}) {
    if (!unit || unit.side !== 'ally' || unit.alive || unit.removed) return false;
    let at = null;
    if (tile != null) {
      if (!Array.isArray(tile) || !Number.isInteger(tile[0]) || !Number.isInteger(tile[1]) || !this.grid.inRect(tile[0], tile[1])) return false;
      at = [tile[0], tile[1]];
    } else {
      const rest = this.restTile(unit);
      if (rest[0] !== unit.homeR || rest[1] !== unit.homeC) at = rest;
    }
    const k = at ? at[0] * COLS + at[1] : unit.homeR * COLS + unit.homeC;
    const occ = this._occ[k];
    if (occ && occ.alive && occ !== unit) return false;
    if (at && this.downOn(at[0], at[1], unit)) return false;
    const ps = this.getPlayer(unit.ownerId);
    const cost = this.assaultStrict ? (unit.mem.assaultSkillFree ? 0 : this.assaultDeploymentCost(unit)) : unit.base.cost;
    let paid = 0;
    if (!free) {
      if (!ps || ps.dp + 1e-9 < cost) return false;
      paid = Math.min(ps.dp, cost);
      ps.dp = Math.max(0, ps.dp - cost); // paid before `deploy` fires (handlers see the new DP)
    }
    const sk = unit.skill;
    const keep = keepSp && sk && !sk.noSkill && sk.kind !== 'passive' ? { sp: sk.sp, charges: sk.charges } : null;
    if (this._deploy(unit, { initial: false, tile: at, keepSp: keep, free, ...(this.assaultStrict ? { assaultPaid: !free, paidAmount: paid } : null) })) return true;
    if (paid > 0 && ps) ps.dp = Math.min(this.flags.dpMax, ps.dp + paid);
    return false;
  }

  /**
   * Automatic redeploys (DESIGN §5.5): an operator that left the field and whose timer is done comes back on its rest
   * tile — where it lies ("满足再部署条件时，移除场上的该倒地干员并自动部署至该位置", PRTS 卫戍协议/帮助) — when that tile
   * is free and its player has the DP.
   */
  _checkRedeploys() {
    for (const u of this.assaultDeploymentOrder()) {
      if (u.alive || u.removed || (u.kind !== 'op' && !(this.assaultStrict && u.mem.assaultPendingEntry))) continue;
      const assaultPending = this.assaultStrict && u.mem.assaultPendingEntry;
      if (!assaultPending && this.time + 1e-9 < u.respawnAt) continue;
      // the DP first: an operator past its timer mostly waits for DP, and the tile checks scan every ally
      const ps = this.getPlayer(u.ownerId);
      const cost = this.assaultStrict ? (u.mem.assaultSkillFree ? 0 : this.assaultDeploymentCost(u)) : u.base.cost;
      if (!ps || ps.dp + 1e-9 < cost) continue;
      const [r, c] = this.restTile(u);
      const occ = this._occ[r * COLS + c];
      if (occ && occ.alive && occ !== u) continue;
      if (this.downOn(r, c, u)) continue;
      if (!this.assaultStrict) ps.dp = Math.max(0, ps.dp - cost);
      this._deploy(u, { initial: false, tile: r === u.homeR && c === u.homeC ? null : [r, c], ...(this.assaultStrict ? null : { assaultPaid: true }) });
    }
  }

  /** Leak: an enemy reached its goal. */
  leak(e) {
    if (!e || !e.alive || e.side !== 'enemy') return;
    // Content may adjust only this leak's loss before it is recorded. With no listeners this preserves the native path.
    if (this._hooks.beforeEnemyLeak) {
      const event = { enemy: e, loss: e.lpr ?? 1 };
      this.emit('beforeEnemyLeak', event);
      e.lpr = event.loss;
    }
    this._recordLeak(e, false);
    this._remove(e, 'leak');
    this._ev(['leak', e.id]);
    if (this._hooks.enemyLeak) this.emit('enemyLeak', { enemy: e });
  }

  _recordLeak(e, timeout) {
    const owner = timeout ? e.ownerId : this._ownerForTile([Math.round(e.y), Math.round(e.x)]) ?? e.ownerId;
    const pp = this._pp(owner) ?? this._pp(e.ownerId);
    if (pp) {
      pp.leaked.push({ enemyKey: e.defId, mods: e.mods ?? null, lpr: e.lpr ?? 1, sourcePlayerId: e.sourcePlayerId ?? e.ownerId, tag: e.tag ?? null, counted: !!e.counted || e.isBoss, boss: e.isBoss || undefined, spawned: true });
      if (e.counted || e.isBoss) pp.perfect = false;
    }
    if (e.counted) this.leakedCount++;
    // the HUD capsule's leak counter (DESIGN §14): only the stage's own enemies (`inTotal`) — a leaked split child or
    // summon still costs LP through `counted`/`leakedCount` and still breaks 完美作战, but it is no 漏掉 of the stage's
    // own list, so the capsule's numerator does not move for it
    if (e.inTotal) {
      this.leakedInTotal++;
      if (pp) pp.leakedInTotal++;
    }
  }
}
