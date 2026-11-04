// public/js/assault/fxCompat.js — the instant-skill compatibility layer of the Assault battle view (T11): every
// Assault body but one casts its fixed skill in a single frame (server/sim/skills.js _castAssault sends
// ['skill', id, 1] then, after the resolve, ['skill', id, 0] in the same frame), so of the official skill's own
// effects only the one-shots show: its loop starts and stops in that frame, its range and target loops vanish.
// fx-skill-map.json (fx-mapping-spec.md) says which official unit and skill each body plays and how the effect
// compresses into one cast; this module applies it in two places:
//
//   record(info, baseRec)   the target of FxWiring opts.record: the unit's data record with `fx` (skills.js
//                           resolveSkill reads rec.fx.unit / rec.fx.skills before the record's own skill ids) —
//                           the entry's official unit and skill, else (a body without an entry) the Assault fixed
//                           skill's own sourceSkillId under the body's charId (spec §3).
//   planHook(r, ctx)        the target of FxWiring opts.planHook: the official plan (skills.js planFor) copied and
//                           compressed for one cast — the loop / range / targets the same-frame pair swallows become
//                           `hold: 'cast'` for `holdS` battle seconds; attack rows may come from another mode, the
//                           hit groups may take the first / last / all, projectiles may go, etc. (spec §2 field
//                           table, §4 rules). Only an ally body is touched; every other unit's plan is returned as
//                           it is. A copy at the entry level: the plan's arrays are new, the entries this hook
//                           changes are new, everything else is shared — the caller's plan is never mutated.
//
// `extras` of the table is data only here: the look.official playback of a new effect (spec §6) is a later task.
// The module keeps no state of the battle and sends no request but the one table load (loadFxSkillMap).

import { emptyPlan, planUses } from '../render/vfx/skills.js';

/** The schema of fx-skill-map.json (spec §2). */
export const FX_MAP_SCHEMA = 'assault-fx-skill-map/v1';

/** The `instant` defaults of spec §2 (a body casts its skill as a one-shot). */
const INSTANT_DEFAULTS = Object.freeze({
  loop: Object.freeze({ holdS: 0.8 }), range: Object.freeze({ holdS: 0.8 }), targets: 'status',
  attackFrom: 'skill', hits: 'byCount', end: 'play', ready: 'skip', modeSwitch: false,
});

/** The `passive` defaults of spec §2 (the one body whose skill stands while deployed). */
const PASSIVE_DEFAULTS = Object.freeze({
  loop: 'skill', range: 'skill', targets: 'status', attackFrom: 'skill', hits: 'byCount',
  end: 'play', ready: 'skip', modeSwitch: true,
});

/** Modes of a table the planHook could not find, reported once each (a filler's typo shows once, not every cast). */
const missingModes = new Set();

/**
 * fx-skill-map.json next to this module (spec §2: the page-relative URL of the Assault client). null when there
 * is none — the file is not published yet (T13 / the F batches fill it), the page is offline, or the JSON is not
 * the table (a 404, a parse error, another schema): the compat layer then runs on the spec §2 defaults.
 * @returns {Promise<any|null>}
 */
export async function loadFxSkillMap() {
  try {
    const res = await fetch(new URL('./fx-skill-map.json', import.meta.url));
    if (!res || !res.ok || (Number.isFinite(res.status) && res.status !== 200)) return null;
    const map = await res.json();
    return map && typeof map === 'object' && map.schema === FX_MAP_SCHEMA ? map : null;
  } catch {
    return null;
  }
}

/** The Assault body's charId a data record names: its assaultBody's (shared/assault/battle-input.js makeChessRecords),
 * else the record's own, else the view's spine. */
function charIdOf(info, rec) {
  const id = rec?.assaultBody?.charId ?? rec?.charId ?? info?.spine;
  return typeof id === 'string' && id ? id : null;
}

/** A hold rule of the table applied to a plan list (`range` / `loop`): a `{ holdS }` keeps the skill-held entries
 * for that many battle seconds, `skip` empties the list, `skill` leaves the upstream hold. */
function applyHold(plan, list, rule) {
  if (rule === 'skip') { plan[list] = []; return; }
  const holdS = rule && typeof rule === 'object' ? Number(rule.holdS) : NaN;
  if (!(holdS > 0)) return;
  plan[list] = plan[list].map((e) => (e?.hold === 'skill' ? { ...e, hold: 'cast', holdS } : e));
}

/** The emitter row lists of an index Attack and the plan role / target list each one plays as (wiring.js reads the same four). */
const ATTACK_ROWS = [['cast', 'cast', null], ['hit', 'hit', null], ['castTarget', 'hit', 'castTarget'], ['inputTarget', 'hit', 'inputTarget']];

/**
 * The attack rows of a mode (spec §2 `attackFrom: 'mode:<名>'`): index.json `modes[].attack` — and its sub-abilities, a
 * group attack's — turned into uses of skills.js planUses, so the one cast's hits play that mode's cast / hit /
 * projectile as plan.attacks. (A mode's `attach` rows are its skill-long glow, the skill plan's loop / range already.)
 */
function modeAttacks(idx, unitKey, skillId, mode) {
  const uses = [], abilities = [];
  const walk = (a, depth = 0) => {
    if (!a || typeof a !== 'object' || depth > 4) return;
    if (typeof a.class === 'string') abilities.push(a);
    // the mode's attack node is the unit's attack while the mode is on, whatever its class (耀骑士临光 S3's
    // EmptyAnimatedAbility carries the hits): one planUses would not take for an attack plays as one
    const ability = typeof a.class === 'string' && /Attack|Heal/.test(a.class) && !/^Channeling/.test(a.class) ? a.class : 'Attack';
    for (const [field, role, list] of ATTACK_ROWS) {
      for (const row of Array.isArray(a[field]) ? a[field] : []) {
        const keys = Array.isArray(row?.effects) ? row.effects.filter((k) => typeof k === 'string' && k) : [];
        if (!keys.length) continue;
        uses.push({
          role, keys, ability, node: a.node ?? null, from: `Attack.${field}`,
          oneshot: !(row.oneshot === 0 || row.oneshot === false), ...(list ? { list } : {}),
        });
      }
    }
    for (const sub of Array.isArray(a.abilities) ? a.abilities : []) walk(sub, depth + 1);
  };
  walk(mode?.attack);
  const p = emptyPlan(unitKey, skillId);
  planUses(idx, p, uses, { abilities });
  return p.attacks;
}

/** The plan's arrays and its entries of the lists this hook may change, copied (spec §3.1: no structuredClone). */
function clonePlan(plan) {
  const each = plan.each || { cast: [], hit: [[]] };
  const list = (v) => (Array.isArray(v) ? [...v] : []);
  return {
    ...plan,
    start: list(plan.start), loop: list(plan.loop), end: list(plan.end), ready: list(plan.ready),
    range: list(plan.range), targets: list(plan.targets), projectiles: list(plan.projectiles),
    trigger: list(plan.trigger), pulse: list(plan.pulse), unmapped: list(plan.unmapped), cond: list(plan.cond),
    attacks: list(plan.attacks).map((a) => ({
      ...a, cast: list(a.cast), range: list(a.range), aim: list(a.aim), hit: list(a.hit).map((g) => list(g)),
    })),
    each: { cast: list(each.cast), hit: list(each.hit).map((g) => list(g)) },
  };
}

/**
 * The plan of one Assault body, compressed for its one cast (spec §2 / §4). `map` is the table (or null: the
 * spec §2 defaults, no entry).
 * @param {any|null} map
 * @returns {{ record: (info: any, baseRec: any) => any, planHook: (r: any, ctx?: any) => any }}
 */
export function createFxCompat(map) {
  const table = map && typeof map === 'object' && map.schema === FX_MAP_SCHEMA ? map : null;
  const entries = table?.entries && typeof table.entries === 'object' ? table.entries : {};
  const defaults = {
    instant: { ...INSTANT_DEFAULTS, ...(table?.defaults?.instant || {}) },
    passive: { ...PASSIVE_DEFAULTS, ...(table?.defaults?.passive || {}) },
  };

  /** The table entry of a body (or null: the spec §3 defaults). */
  const entryOf = (info, rec) => {
    const charId = charIdOf(info, rec);
    return { charId, entry: (charId && entries[charId]) || null };
  };

  /**
   * The unit's data record with `fx` (spec §3.1): the official unit and skill of its entry, or of the defaults —
   * the Assault fixed skill's own source under the body's charId. An official skill maps both the record's slot
   * (the skill's index) and its id (skills.js resolveSkill reads the slot first). `baseRec` is never changed.
   */
  function record(info, baseRec) {
    try {
      if (info?.side !== 'ally' || !baseRec || typeof baseRec !== 'object') return baseRec;
      const { charId, entry } = entryOf(info, baseRec);
      if (!charId) return baseRec;
      // a body whose original has no skill (正义骑士号) plays no official skill at all
      if (entry && entry.official === null) return baseRec;
      const unit = entry?.official?.unit ?? charId;
      const skill = entry?.official?.skill
        ?? baseRec?.assaultPiece?.fixedSkill?.sourceSkillId
        ?? baseRec?.skill?.skillId;
      if (typeof skill !== 'string' || !skill) return baseRec;
      const srec = baseRec.skill;
      const skills = {};
      if (typeof srec?.skillId === 'string' && srec.skillId) skills[srec.skillId] = skill;
      if (srec?.index != null) skills[String(srec.index)] = skill;
      return { ...baseRec, fx: { unit, skills } };
    } catch {
      return baseRec;
    }
  }

  /**
   * The official plan of an Assault body, compressed for one cast (the field table of spec §2). Another unit's
   * plan, or a request without one, comes back as it is; an error inside leaves the plan as it was (the hook must
   * never break a battle's effects).
   */
  function planHook(r, ctx = {}) {
    const plan = r?.plan;
    if (!plan || ctx.info?.side !== 'ally') return r;
    try {
      const idx = ctx.idx || null;
      const { entry } = entryOf(ctx.info, ctx.rec);
      const shape = entry?.shape === 'passive' ? 'passive' : 'instant';
      const ph = { ...defaults[shape], ...(entry?.phases || {}) };
      const unitKey = ctx.unitKey || r.unitKey || null;
      const out = clonePlan(plan);
      out.kind = shape;
      if (ph.start === 'skip') out.start = [];
      applyHold(out, 'range', ph.range);
      applyHold(out, 'loop', ph.loop);
      // attackFrom: the skill's own attack ability (`skill`), a mode's, or none at all
      if (ph.attackFrom === 'none') {
        out.attacks = [];
        out.each = { cast: [], hit: [[]] };
      } else {
        const mode = typeof ph.attackFrom === 'string' && ph.attackFrom.startsWith('mode:') ? ph.attackFrom.slice(5)
          : ph.attackFrom === 'normal' ? 'Default' : null;
        // (also when the skill's own plan names that mode: the instant cast never switches to it — modeSwitch — so
        // its attack rows must come in as the plan's attacks)
        if (mode) {
          const modes = (unitKey && idx?.units?.[unitKey]?.modes) || [];
          const m = modes.find((x) => x?.name === mode);
          if (!m) {
            if (!missingModes.has(`${unitKey}|${mode}`)) {
              missingModes.add(`${unitKey}|${mode}`);
              console.debug(`[Assault] fx-skill-map: ${unitKey || '?'} has no mode ${mode}`);
            }
          } else {
            const attacks = modeAttacks(idx, unitKey, out.skillId, m);
            if (attacks.length) out.attacks = attacks;
          }
        }
      }
      // hits: which hit group of an attack every hit of the one cast plays
      if (ph.hits === 'first' || ph.hits === 'last' || ph.hits === 'all') {
        out.attacks = out.attacks.map((a) => {
          const groups = Array.isArray(a?.hit) ? a.hit : [];
          if (!groups.length) return a;
          const group = ph.hits === 'first' ? groups[0] : ph.hits === 'last' ? groups[groups.length - 1] : groups.flat();
          return { ...a, hit: [group] };
        });
      }
      if (ph.projectile === 'none') {
        out.projectiles = [];
        out.attacks = out.attacks.map((a) => ({ ...a, projectile: null, shot: null }));
      }
      if (ph.targets === 'status' || ph.targets === 'skip') out.targets = [];
      else if (ph.targets && typeof ph.targets === 'object') {
        const holdS = Number(ph.targets.holdS);
        out.targets = out.targets.map((e) => ({ ...e, hold: 'cast', holdS }));
      }
      if (ph.end === 'skip') out.end = [];
      const endDelayS = Number(ph.endDelayS);
      if (endDelayS > 0) out.end = out.end.map((e) => ({ ...e, delayS: endDelayS }));
      if (ph.ready === 'skip') out.ready = [];
      // after attackFrom: an instant cast changes no attack mode
      if (ph.modeSwitch === false) { out.mode = null; out.modeName = null; }
      return { ...r, plan: out };
    } catch {
      return r;
    }
  }

  return { record, planHook };
}
