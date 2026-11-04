// public/js/assault/snapCompat.js — the display-only snapshot read-outs the upstream 0.3.x sim sends and the Assault
// (进击) sim does not: `energy` / `layers` / `charges`, and the two event fields the official-effects layer reads
// (`extra.charged` of a charged cast, `extra.target` of a counter). The browser adapter derives them from the sim
// units it already has; server/sim/** stays untouched.
//
// The three view functions are copied verbatim from c9d804f47:server/sim/snapshot.js:166-215 (upstream 0.3.2); the
// snapshot writer there calls them while building b.snap (battle/events.js), this module calls them after the fact.
// Display only: nothing here changes a battle.

/**
 * `mysticView(u)` = `[stored attack energies, the trait's maximum]` of a 秘术师 (professions.js installMystic keeps the
 * count in `trait.stored` — the trait's storeEnergy adds one when the attack finds no target, releaseEnergy empties the
 * lot into the next one — and the cap is `profile.storeMax`: the trait's 最多3个, 4 for 深靛's MSC-X module, TUNE
 * mystic): the number under the HP bar. Zero is a count. Kits that keep a store of their own (维伊's 转置能量, 黑键's
 * elite energies) replace `storeEnergy` and never set `trait.stored`: no row. Display only.
 */
export function mysticView(u) {
  const n = u.trait?.stored, max = u.profile?.storeMax;
  if (u.side !== 'ally' || !Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(max) || max < 1) return null;
  return [Math.min(n, max), max];
}

/**
 * `layerView(u)` = the hit-negating 护盾 layers a unit holds (the sum of its buffs' shieldHits — 泥岩's 沃土予身), null
 * without any. Display only: render/vfx/talentfx.js shows the official effect of that many layers (mudrok_buff_03 / 02 /
 * 01_start).
 */
export function layerView(u) {
  let n = 0;
  for (const b of u.buffs) if (b.shieldHits > 0) n += b.shieldHits;
  return n >= 1 ? Math.min(999, Math.floor(n)) : null;
}

/**
 * `chargeView(u)` = `[charges stored, the skill's maximum]` of an ally whose skill stores charges (maxCharges > 1, 卡涅利安):
 * the 技能充能 the official sand armour shows (render/vfx/skillfx.js, the `[eff_cond]` buffs). Display only.
 */
export function chargeView(u) {
  const sk = u.skill;
  if (u.side !== 'ally' || !sk || sk.noSkill || !(sk.maxCharges > 1)) return null;
  return [Math.max(0, Math.min(sk.maxCharges, Math.floor(sk.charges || 0))), sk.maxCharges];
}

/** fx kinds whose charged cast the official layer reads (`extra.charged`, render/vfx/wiring.js simFx). */
const CHARGED_FX = ['shell', 'devour', 'sandChains'];

/**
 * Add `energy` / `layers` / `charges` to a snapshot the way upstream snapshot.js writes them: one row per unit listed
 * in `snapshot.units`, in `units` order, and no field at all when there is nothing to report. A field the snapshot
 * already carries is left alone; only units the snapshot lists are read.
 */
export function augmentSnapshot(units, snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(units) || !Array.isArray(snapshot.units)) return snapshot;
  const listed = new Set(snapshot.units.map((row) => row?.[0]));
  const energy = [], layers = [], charges = [];
  for (const u of units) {
    if (!u || !listed.has(u.id)) continue;
    const en = mysticView(u);
    if (en) energy.push([u.id, en[0], en[1]]);
    const ly = layerView(u);
    if (ly) layers.push([u.id, ly]);
    const ch = chargeView(u);
    if (ch) charges.push([u.id, ch[0], ch[1]]);
  }
  if (snapshot.energy === undefined && energy.length) snapshot.energy = energy;
  if (snapshot.layers === undefined && layers.length) snapshot.layers = layers;
  if (snapshot.charges === undefined && charges.length) snapshot.charges = charges;
  return snapshot;
}

/**
 * The read-outs only the Assault (进击) battle has, derived from the live local battle the same display-only way:
 *
 * - `zones` `[[id, kind, [[r, c], …]], …]` — the synergy zones (server/sim/content/assault/synergy.js placeZone:
 *   号角's 照明区域 `flare`, 黍's 播种地块 `seed`, 伊内丝's 影哨 `sentry`) while they live, plus 圣聆初雪's 积雪 `snow`
 *   (cards/synergy-ranged.js sbell2: the layers of her `mem.sbellSnowTiles`) while she stands;
 * - `ammo` rows appended for the shared assault ammo counter (content/assault/ammo.js registerAssaultAmmo — 圣约送葬人,
 *   隐现, 克莱门莎's ammo skills and the cards that reload them) when the native ammoView has no row for the unit:
 *   the segmented magazine bar, gone again once the rounds are spent;
 * - `redeploy` `[[id, at, length], …]` — every on-field operator's running 再部署 loop (redeploy-cycle.js
 *   `unit.assaultCycle`, game-time end and full length), the progress ring around the unit's star badge.
 *
 * A field the snapshot already carries is left alone; nothing to report writes no field. Only units the snapshot
 * lists are read. Display only: nothing here changes a battle.
 */
export function augmentAssaultSnapshot(battle, snapshot) {
  if (!battle || !snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.units)) return snapshot;
  const listed = new Set(snapshot.units.map((row) => row?.[0]));
  const r2 = (v) => Math.round(v * 100) / 100;
  const tilePair = (key) => {
    const m = /^(-?\d+),(-?\d+)$/.exec(key);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  let zones = null;
  if (battle.assaultZones instanceof Map) {
    for (const zone of battle.assaultZones.values()) {
      if (!zone || typeof zone.id !== 'string' || typeof zone.kind !== 'string' || !(battle.time < zone.until)) continue;
      const tiles = [...(zone.tiles ?? [])].map(tilePair).filter(Boolean);
      if (tiles.length) (zones || (zones = [])).push([zone.id, zone.kind, tiles]);
    }
  }
  for (const u of battle.allyUnits ?? []) {
    const snow = u?.mem?.sbellSnowTiles;
    if (!u?.alive || !u.deployed || !(snow instanceof Map) || !snow.size) continue;
    const tiles = [...snow.keys()].map(tilePair).filter(Boolean);
    if (tiles.length) (zones || (zones = [])).push([`snow:${u.uid ?? u.id}`, 'snow', tiles]);
  }
  if (zones) snapshot.zones = zones;
  const ammo = Array.isArray(snapshot.ammo) ? snapshot.ammo : null;
  const have = new Set((ammo ?? []).map((row) => row?.[0]));
  let extra = null;
  for (const u of battle.units ?? []) {
    if (u?.side !== 'ally' || !listed.has(u.id) || have.has(u.id)) continue;
    const controller = u._assaultAmmoController;
    if (!controller) continue;
    if(u.mem?.assaultCastAmmo)continue; // cast ammo must not replace its independent SP clock
    const left = Number(controller.get());
    const bonus = Object.values(u.mem?.assaultAmmoCapacityBonuses ?? {}).reduce((sum, n) => sum + (Number.isInteger(n) ? n : 0), 0);
    const capacity = Number(controller.max()) + bonus;
    if (!Number.isInteger(left) || left < 1 || !Number.isInteger(capacity) || capacity < left) continue;
    (extra || (extra = [])).push([u.id, left, capacity]);
  }
  if (extra) snapshot.ammo = [...(ammo ?? []), ...extra];
  const status=[];
  for(const u of battle.allyUnits??[]){
    if(!listed.has(u.id)||!u.def?.raw?.assaultBody?.adaptation)continue;
    const pool=u.mem?.assaultCastAmmo,controller=u._assaultAmmoController;
    const bonus=Object.values(u.mem?.assaultAmmoCapacityBonuses??{}).reduce((sum,n)=>sum+n,0);
    const haste=u.buffs?.find(b=>b.key==='assault:haste:shared'&&b.timeLeft>0);
    status.push([u.id,pool?controller.get():-1,pool?controller.max()+bonus:0,
      haste?r2(battle.time+haste.timeLeft):0,u.skill?.charges??0,u.skill?.maxCharges??1]);
  }
  if(status.length)snapshot.assaultStatus=status;
  if (battle.assaultRedeployCycleOn) {
    let redeploy = null;
    for (const u of battle.allyUnits ?? []) {
      if (u?.kind !== 'op' || !u.alive || !u.deployed || !listed.has(u.id)) continue;
      const cycle = u.assaultCycle;
      if (!cycle || !Number.isFinite(cycle.at) || !Number.isFinite(cycle.length) || cycle.length <= 0) continue;
      (redeploy || (redeploy = [])).push([u.id, r2(cycle.at), r2(cycle.length)]);
    }
    if (redeploy) snapshot.redeploy = redeploy;
  }
  return snapshot;
}

/** The alive unit of the other side nearest to (x, y); null without one (or without the caster to take its side). */
function nearestFoe(units, self, x, y) {
  let best = null, bestD = Infinity;
  for (const u of units) {
    if (!u || u === self || !u.alive || u.side === self.side) continue;
    const dx = u.x - x, dy = u.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}

/**
 * Fill the two event fields the official layer reads and the Assault sim leaves out:
 *
 * - a skill start (`['skill', id, 1, …]`) whose previous frame `charges` were full marks the same batch's
 *   `shell` / `devour` / `sandChains` fx of that unit `extra.charged = true` (卡涅利安's 满充能沙甲);
 * - a `counter` fx without `extra.target` names the nearest alive unit of the other side (泡泡 S2's hit on the
 *   attacker, render/vfx/skillfx.js).
 *
 * `prevCharges` is the previous frame's `charges` as `Map<id, { n, max }>`. Returns a new array; untouched events keep
 * their reference, and a touched event gets a shallow copy of `extra` (the sim's object is never written).
 */
export function augmentEvents(units, events, prevCharges) {
  if (!Array.isArray(events)) return events;
  const list = Array.isArray(units) ? units : [];
  const charged = new Set();
  if (prevCharges && typeof prevCharges.get === 'function') {
    for (const ev of events) {
      if (!Array.isArray(ev) || ev[0] !== 'skill' || ev[2] !== 1) continue;
      const prev = prevCharges.get(ev[1]);
      if (prev && prev.n >= prev.max) charged.add(ev[1]);
    }
  }
  return events.map((ev) => {
    if (!Array.isArray(ev) || ev[0] !== 'fx') return ev;
    const extra = ev[4];
    if (!extra || typeof extra !== 'object') return ev;
    if (CHARGED_FX.includes(ev[1]) && charged.has(extra.id)) {
      return [ev[0], ev[1], ev[2], ev[3], { ...extra, charged: true }];
    }
    if (ev[1] === 'counter' && extra.target == null) {
      const self = list.find((u) => u && u.id === extra.id);
      if (!self) return ev;
      const foe = nearestFoe(list, self, ev[2], ev[3]);
      if (!foe) return ev;
      return [ev[0], ev[1], ev[2], ev[3], { ...extra, target: foe.id }];
    }
    return ev;
  });
}
