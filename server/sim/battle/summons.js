// server/sim/battle/summons.js — Battle methods: summons and devices: the token def of an owner's loadout, whether its
// skill produces a token, spawnToken, spawnDevice and the stage devices (crates, platforms) placed at the start.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { COLS, OBSTACLE_DEVICES } from '../constants.js';
import { normDir } from '../dir.js';
import { SkillRuntime } from '../skills.js';
import { unitInfo } from '../snapshot.js';
import { normalizeToken } from '../simdata.js';
import { bodyOnTile, nonOccupyingTokenAt } from '../body.js';
import { fin } from './util.js';

export class BattleSummons {
  /**
   * Token def of `tokenId` as `owner` (an ally unit: its chess + selected skill / module; or a chess id) summons it —
   * the def spawnToken uses. For content that reads summon stats / skill blackboards: exact in a multi-player field
   * where two players give the same chess different loadouts (an id-only `data.getToken(id, chessId)` is not).
   */
  tokenDef(tokenId, owner = null) {
    return this._tokenDef(tokenId, owner, null);
  }

  /**
   * Whether an operator's selected skill / module produces `tokenId` (DESIGN §16, DATA.md §14 `sources`): false only
   * when the owner's own tokens.json variant says so (`sources` without 'skill' / 'talent' — e.g. 琳琅诗怀雅 S1/S3 make
   * no 香槟炸弹, 赫默 S1 no 医疗探机); true when the data does not tell (no owner variant, inline defs, tokens of
   * other chess).
   */
  producesToken(owner, tokenId, def = null) {
    if (!owner || typeof owner !== 'object' || owner.kind !== 'op') return true;
    const d = def ?? this.tokenDef(tokenId, owner);
    const src = d && Array.isArray(d.sources) ? d.sources : null;
    if (!src || src.includes('skill') || src.includes('talent')) return true;
    const vs = this.data.rawToken?.(tokenId)?.variants;
    const id = String(owner.def?.tokenOwner ?? owner.defId ?? ''); // a 自选 piece's variants are keyed by its owner form
    return !(vs && typeof vs === 'object' && (vs[id] || vs[id.replace(/_b$/, '_a')]));
  }

  /**
   * Spawn (and deploy) a token. `owner` = ally unit or playerId. Returns the token unit or null. The def is the owner's
   * variant for its selected skill / module (`opts.def` = an inline def instead). While an operator runs a NON-default
   * skill, a summon that skill does not produce (producesToken) is refused unless `opts.anySource`: hand-authored kit
   * install hooks are written for the default skill and run under every skill (琳琅诗怀雅 S1/S3 would drop 香槟炸弹);
   * under the default skill the kit stays the authority.
   */
  spawnToken(owner, tokenId, row, col, opts = {}) {
    const ownerUnit = owner && typeof owner === 'object' ? owner : null;
    const pid = ownerUnit ? ownerUnit.ownerId : owner;
    const ps = this.getPlayer(pid) ?? (ownerUnit ? ownerUnit.player : null);
    const def = opts.def ? normalizeToken(tokenId, opts.def) : this._tokenDef(tokenId, ownerUnit, null);
    if (!def) { this.log(`unknown token ${tokenId}`); return null; }
    if (!opts.def && !opts.anySource && ownerUnit && ownerUnit.def?.loadout?.skillIsDefault === false && !this.producesToken(ownerUnit, tokenId, def)) {
      this.log(`${ownerUnit.defId} (skill ${ownerUnit.def?.loadout?.skillIndex ?? '?'}) does not produce ${tokenId}`);
      return null;
    }
    if (!Number.isInteger(row) || !Number.isInteger(col) || !this.grid.inRect(row, col)) return null;
    const occ = this._occ[row * COLS + col];
    const nonOccupying = opts.occupiesTile === false;
    const sharedOwnerOperator = nonOccupying && occ?.alive && occ.deployed && occ.side === 'ally' && occ.kind === 'op'
      && ownerUnit?.ownerId != null && occ.ownerId === ownerUnit.ownerId;
    if (occ && occ.alive && (nonOccupying ? !sharedOwnerOperator : !opts.force)) return null;
    const battle = /** @type {any} */ (this);
    if (nonOccupying && battle.enemies.some((enemy) => enemy.alive && enemy.deployed && bodyOnTile(enemy, row, col))) return null;
    if (nonOccupying && nonOccupyingTokenAt(battle.allyUnits, row, col)) return null;
    if (nonOccupying) {
      const constraints = def.raw?.sourceTemplate ?? def.raw ?? def;
      const placement = constraints.assaultPlacementClass ?? (constraints.rangedTilesOnly ? 'high' : String(def.position ?? 'MELEE').toLowerCase());
      const ranged = ['ranged', 'all', 'high'].includes(placement);
      const terrain = this.grid.tile(row, col);
      const waiting = battle.allyUnits.some((unit) => {
        if (unit.alive || unit.removed || (unit.kind !== 'op' && unit.kind !== 'token')) return false;
        const [rr, cc] = this.restTile(unit); return rr === row && cc === col;
      });
      if (ownerUnit?.kind !== 'op' || ownerUnit.ownerId == null || !this.grid.canStand(row, col, { ranged })
        || (placement === 'high' && terrain.height !== 'HIGH' && terrain.build !== 'RANGED')
        || this.grid.isObstacle(row, col) || this.downOn(row, col)
        || battle.enemies.some((enemy) => enemy.alive && enemy.deployed && bodyOnTile(enemy, row, col))
        || (battle.isReservedTile(row, col) && !sharedOwnerOperator) || waiting
        || (ownerUnit.player && !this.onOwnBoard(ownerUnit.player, row, col))) return null;
    }
    const dir = opts.dir != null ? normDir(opts.dir) : opts.facing != null ? normDir(opts.facing) : ownerUnit ? ownerUnit.dir : ps ? ps.dir : 'RIGHT';
    const u = this._makeAlly(ps, def, 'token', row, col, { ownerUnit, dir });
    u.occupiesTile = opts.occupiesTile !== false;
    if (opts.stats) for (const [k, v] of Object.entries(opts.stats)) if (Number.isFinite(v)) u.base[k] = v;
    if (!u.occupiesTile) u.base.blockCnt = 0;
    if (this.assaultStrict && opts.assaultCost != null) {
      if (!Number.isFinite(opts.assaultCost) || opts.assaultCost < 0) throw new TypeError('Invalid assault summon cost');
      u.base.cost = opts.assaultCost;
    }
    this._setupUnit(u, opts.kit ?? null);
    if (opts.untargetable) this.addBuff(u, { key: 'trait:untargetable', flags: { untargetable: true }, persist: true, allowDead: true });
    if (!this._deploy(u, { initial: false, preBattleAggroSeq: opts.preBattleAggroSeq })) {
      // tile still busy (a unit stands there even with `force`): drop the half-built token and its hooks
      u.removed = true;
      this.offOwner(u);
      return null;
    }
    if (opts.hp != null && Number.isFinite(Number(opts.hp))) u.hp = Math.max(1, Math.min(u.s.maxHp, Number(opts.hp)));
    if (opts.duration > 0 && Number.isFinite(Number(opts.duration))) this.after(Number(opts.duration), () => { if (u.alive) this.retreat(u, { reason: 'expired', permanent: true }); }, { owner: u });
    return u;
  }

  /**
   * Spawn a stage device (e.g. crates). opts: { hp, obstacle, obstacleKind, blockCnt, name, def, res, atk, bat, aspd }.
   * An `obstacle` device is an obstacle-like tile by default (`obstacleKind` 'crate': enemies route around it at cost
   * 1000 and, when it is the only way, walk into it, get blocked by it and break it — research 08 §3.1); 'block' makes
   * the tile impassable.
   */
  spawnDevice(key, row, col, opts = {}) {
    if (opts.assaultCombat === true && !this.assaultStrict) throw new Error('Assault combat devices require strict Assault mode');
    const owner = this.assaultStrict ? opts.ownerUnit ?? null : null;
    if (owner && (!this.allyUnits.includes(owner) || owner.kind !== 'op')) throw new TypeError('invalid Assault device owner');
    // Devices are ally-side units on a field tile: never outside the rect, never on top of a living unit or of a
    // knocked-out operator (downOn).
    if (!Number.isInteger(row) || !Number.isInteger(col) || !this.grid.inRect(row, col)) return null;
    const occ = this._occ[row * COLS + col];
    const battle = /** @type {any} */ (this);
    if (occ && occ.alive) return null;
    if (nonOccupyingTokenAt(battle.allyUnits, row, col)) return null;
    // `overBody`: the device of the operator lying there (独立模式 不屈部署支架 — it stands on its wearer's body until
    // the wearer redeploys; the gear removes it first, so the redeploy is never held up)
    const down = this.downOn(row, col);
    if (down && !(opts.overBody && opts.overBody === down)) return null;
    const hp = fin(opts.hp, 100);
    const bat = fin(opts.bat, 1), aspd = fin(opts.aspd, 100);
    const def = {
      type: 'device', id: key, baseId: key, name: opts.name ?? key, tier: 0, golden: false, profession: 'DEVICE', subProf: null,
      stats: { maxHp: hp > 0 ? hp : 100, atk: Math.max(0, fin(opts.atk, 0)), def: Math.max(0, fin(opts.def, 0)), res: Math.min(100, Math.max(0, fin(opts.res, 0))), aspd: aspd > 0 ? aspd : 100, bat: bat > 0 ? bat : 1, blockCnt: Math.max(0, fin(opts.blockCnt, 99)), cost: 0, respawnTime: 0, spRecovery: 0, tauntLevel: -1, massLevel: 0, hpRecoveryPerSec: 0 },
      rangeGrid: Array.isArray(opts.rangeGrid) ? opts.rangeGrid.map((cell) => [...cell]) : [[0, 0]], skill: null, talents: [], spine: opts.spine ?? key, avatar: opts.avatar ?? opts.spine ?? key,
    };
    const u = this._makeAlly(owner ? this.getPlayer(owner.ownerId) : null, def, 'device', row, col, opts.dir != null ? { dir: opts.dir } : {});
    u.ownerId = owner?.ownerId ?? null;
    if (owner) { u.ownerUnit = owner; u.mem.assaultSpawnKind = 'device'; u.mem.assaultDeviceSourceKey = opts.sourceKey ?? key; }
    if (opts.assaultCombat === true) u.mem.assaultCombatDevice = true;
    u.kit = {};
    // Stage devices stay inert by default. Assault-owned devices may opt into
    // the ordinary ally attack loop with an explicit combat profile.
    u.profile = opts.assaultCombat === true
      ? { noAttack: false, maxTargets: 1, dmgType: opts.dmgType ?? 'phys', canHitFly: opts.canHitFly === true }
      : { noAttack: true, maxTargets: 0 };
    u.skill = new SkillRuntime(this, u, null, null, {});
    u.obstacle = !!opts.obstacle;
    u.obstacleKind = opts.obstacleKind === 'block' ? 'block' : 'crate';
    u.alive = true;
    u.deployed = true;
    u.ground = true;
    u.markDirty();
    u.hp = u.s.maxHp;
    u.deploySeq = ++this._deploySeq;
    u.aggroSeq = u.deploySeq;
    u.deployedAt = this.time;
    u.rangeKeys = [];
    this._occ[row * COLS + col] = u;
    if (opts.assaultCombat === true) this._refreshRange(u);
    if (u.obstacle) this.grid.setObstacle(row, col, true, u.obstacleKind);
    this._ev(['spawn', unitInfo(u)]);
    if (this._hooks.deploy) this.emit('deploy', { unit: u, initial: !this.started, ...(this.assaultStrict ? { actualPaid: 0, skillEntry: false } : null) });
    if (owner) this.on('death', ({ unit }) => { if (unit === owner && u.alive) this.retreat(u, { reason: 'ownerRemoved', permanent: true }); }, { owner: u });
    if (this.assaultStrict && Number.isFinite(opts.duration) && opts.duration > 0) this.after(opts.duration, () => {
      if (u.alive) this.retreat(u, { reason: 'expiry', permanent: true });
    }, { owner: u });
    return u;
  }

  _spawnStageDevices() {
    if (this.opts.devices === false) return;
    for (const d of this.stage.devices || []) {
      // data/stages.json `active` = present at match start (= not hidden in the 下半 level file: act1 m02 starts with no
      // crates, research 08 §3.3); research stages have no `active` ⇒ `hidden` decides.
      const act = d.raw && typeof d.raw.active === 'boolean' ? d.raw.active : !d.hidden && d.active !== false;
      if (!act) continue;
      if (d.role === 'platform' || d.role === 'mound') {
        // 射击台 / mounds [ASSUMED, research 08 §8 #1]: hard-block ground movement; an operator standing on one is elevated
        // (does not block) — the match lets ranged operators deploy there (deployTiles.rangedOnly).
        if (!this.grid.inRect(d.row, d.col)) continue;
        this.grid.setObstacle(d.row, d.col, true);
        (this._elevated ??= new Set()).add(d.row * COLS + d.col);
        continue;
      }
      const spec = OBSTACLE_DEVICES[d.key] ?? (d.role === 'crate' ? { hp: d.stats?.maxHp ?? 100, name: d.name } : null);
      if (!spec) continue;
      if (!this.grid.inRect(d.row, d.col)) continue;
      if (this._occ[d.row * COLS + d.col]) continue;
      this.spawnDevice(d.key, d.row, d.col, { hp: spec.hp, obstacle: true, name: spec.name });
    }
  }
}
