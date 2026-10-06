// render/fxRegistry.js — the FX registry: which recipe (render/fxRecipes.js) draws a battle event, between the event
// handler (render/app.js handleEvent → FxCues) and the drawing primitives (render/fx.js FxSystem).
//
//   channels   'atk' | 'dmg' | 'heal' | 'skill' | 'die' | 'deploy' | 'fx' — one per b.ev kind that draws (DESIGN §8.2)
//   cue        the event as the recipes see it (fxCue below): its `kind` (atk: projectile kind, 'none' for melee; dmg:
//              damage type; skill: 'on' | 'off'; fx: the sim fx kind; heal / die / deploy: the channel name), the views
//              involved, the event's own fields (attackId, isSkill, skillId, the attacker), and `unit`: the view whose
//              identity picks the recipe (atk: the attacker, dmg: the attacker the renderer drew the blow of — else
//              the sim's attacker, skill / heal / die / deploy: the unit, fx: `extra.src`, else `extra.id`)
//   identity   { char, sub, prof, skill } of that unit (FxSystem.identify; app.js: unitFxIdentity from the game data):
//              charId (UnitInfo.spine of an enemy / summon), sub-profession, profession, and — when the event is a
//              skill's — the skillId (the 'skill' event's own, else the unit's equipped skill)
//   resolution charId:skillId → charId → sub-profession → profession → event kind → the channel default; at each layer
//              an entry for the event's kind wins over one for any kind ('*'). The chain runs most specific first; a
//              recipe calls next() to add to the layers below it (else it replaces them).
//
// Registering a recipe needs no change to the dispatch code:
//   fxRegistry.register('skill', { char: 'char_1028_texas2', skill: 'skchr_texas2_3', kind: 'on' }, (fx, cue, next) => { … });
//   fxRegistry.register('atk', { sub: 'loopshooter' }, recipe);   fxRegistry.register('fx', { kind: 'myKind' }, recipe);
// register() returns the function that removes the entry again (a key keeps a stack: the previous entry comes back).

import { registerBuiltinFx } from './fxRecipes.js';

export const FX_CHANNELS = Object.freeze(['atk', 'dmg', 'heal', 'skill', 'die', 'deploy', 'fx']);
/** Resolution order, most specific first (each layer: the event's kind, then '*'); the default is kind '*' of 'kind'. */
export const FX_LAYERS = Object.freeze(['charSkill', 'char', 'sub', 'prof', 'kind']);
const ANY = '*';
const MATCH_KEYS = new Set(['char', 'skill', 'sub', 'prof', 'kind']);
const NONE = Object.freeze({});

const str = (v) => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

export class FxRegistry {
  constructor() {
    /** key → recipe stack (the last one is in force) */
    this._map = new Map();
    /** channel → number of identity-scoped entries (char / sub / prof): 0 = no identity lookup for its events */
    this._scoped = new Map();
  }

  /**
   * Register `recipe(fx, cue, next)` for `channel` events matching `match`: { char, skill? } | { sub } | { prof } | {}
   * (no identity: the kind layer), plus an optional `kind` (default '*': every kind). Returns an unregister function.
   */
  register(channel, match, recipe) {
    if (!FX_CHANNELS.includes(channel)) throw new TypeError(`fx registry: unknown channel ${String(channel)}`);
    if (typeof recipe !== 'function') throw new TypeError('fx registry: the recipe must be a function (fx, cue, next)');
    const m = match == null ? NONE : match;
    if (typeof m !== 'object' || Array.isArray(m)) throw new TypeError('fx registry: match must be an object');
    for (const k of Object.keys(m)) if (!MATCH_KEYS.has(k)) throw new TypeError(`fx registry: unknown match key ${k}`);
    const char = m.char == null ? null : str(m.char), skill = m.skill == null ? null : str(m.skill);
    const sub = m.sub == null ? null : str(m.sub), prof = m.prof == null ? null : str(m.prof);
    const kind = m.kind == null ? ANY : str(m.kind);
    if ([m.char, m.skill, m.sub, m.prof, m.kind].some((v, i) => v != null && [char, skill, sub, prof, kind][i] == null)) throw new TypeError('fx registry: match values must be non-empty strings');
    if (skill != null && char == null) throw new TypeError('fx registry: a skill match needs its char (charId:skillId)');
    if ((char != null) + (sub != null) + (prof != null) > 1) throw new TypeError('fx registry: match one of char (+ skill), sub, prof');
    const scope = char != null ? (skill != null ? `c:${char}:${skill}` : `c:${char}`) : sub != null ? `s:${sub}` : prof != null ? `p:${prof}` : 'k';
    const key = `${channel}|${scope}|${kind}`;
    let stack = this._map.get(key);
    if (!stack) this._map.set(key, stack = []);
    const entry = { recipe };
    stack.push(entry);
    const scoped = scope !== 'k';
    if (scoped) this._scoped.set(channel, (this._scoped.get(channel) || 0) + 1);
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length && this._map.get(key) === stack) this._map.delete(key);
      if (scoped) this._scoped.set(channel, Math.max(0, (this._scoped.get(channel) || 0) - 1));
    };
  }

  /** Whether `channel` has identity-scoped entries (its events need the unit's identity). */
  scoped(channel) { return (this._scoped.get(channel) || 0) > 0; }

  /** The recipe in force for one key, or null. */
  _top(channel, scope, kind) {
    const s = this._map.get(`${channel}|${scope}|${kind}`);
    return s && s.length ? s[s.length - 1].recipe : null;
  }

  _layer(out, channel, scope, kind) {
    if (kind != null) { const r = this._top(channel, scope, kind); if (r) out.push(r); }
    const r = this._top(channel, scope, ANY);
    if (r) out.push(r);
  }

  /**
   * The recipe chain for a `channel` event of `kind` by a unit of identity `who` ({ char, sub, prof, skill } | null),
   * most specific first: charId:skillId, charId, sub-profession, profession, kind layer (kind, then the default '*').
   */
  resolve(channel, kind, who = null) {
    const out = [];
    const k = str(kind);
    if (who && this.scoped(channel)) {
      const char = str(who.char), skill = str(who.skill), sub = str(who.sub), prof = str(who.prof);
      if (char != null) {
        if (skill != null) this._layer(out, channel, `c:${char}:${skill}`, k);
        this._layer(out, channel, `c:${char}`, k);
      }
      if (sub != null) this._layer(out, channel, `s:${sub}`, k);
      if (prof != null) this._layer(out, channel, `p:${prof}`, k);
    }
    this._layer(out, channel, 'k', k);
    return out;
  }

  /** Draw `cue` on FxSystem `fx`: resolve its chain (the unit's identity only when the channel needs it) and run it. */
  play(fx, channel, cue) {
    const who = this.scoped(channel) ? cueIdentity(fx, cue) : null;
    cue.who = who;
    const chain = this.resolve(channel, cue.kind, who);
    let i = 0;
    const next = () => { const r = chain[i++]; if (r) r(fx, cue, next); };
    next();
  }
}

/** The identity a cue resolves by: its unit's (FxSystem.identify), its skill only when the event is a skill's. */
function cueIdentity(fx, cue) {
  let u = cue.unit;
  if (u === undefined && cue.unitId != null) u = fx._viewOf ? fx._viewOf(cue.unitId) : null;
  if (!u || typeof fx.identify !== 'function') return null;
  const id = fx.identify(u);
  if (!id) return null;
  return { char: id.char ?? null, sub: id.sub ?? null, prof: id.prof ?? null, skill: cue.useSkill ? (cue.skillId ?? id.skill ?? null) : null };
}

/** The registry every FxSystem uses unless its ctx brings its own (`ctx.registry`): the built-ins (fxRecipes.js). */
export const fxRegistry = registerBuiltinFx(new FxRegistry());

/** A new registry with the built-ins (tests, a view that wants its own recipes). */
export function createFxRegistry() { return registerBuiltinFx(new FxRegistry()); }

const flag = (v) => (v === true || v === 1 ? true : v === false || v === 0 ? false : null);
const evId = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' ? v : null);

/** Cue builders (the event fields a recipe sees). Missing optional fields (older streams / recordings) are null. */
export const fxCue = Object.freeze({
  /** 'atk' by `src` at `tgt` (views); o: { attackId, isSkill }. */
  atk(src, tgt, kind, o = NONE) {
    const isSkill = flag(o.isSkill);
    return { kind: kind || 'none', src: src || null, tgt: tgt || null, attackId: evId(o.attackId), isSkill, unit: src || null, useSkill: isSkill === true };
  },
  /**
   * 'dmg' on `view`; `src` = the attacker the renderer paired the hit with (a melee blow: its slash, its splash ring);
   * o: { melee (src's blow landed: slash it), attacker (the sim's attacker view), attackId, isSkill }.
   */
  dmg(view, amount, type, src, o = NONE) {
    const isSkill = flag(o.isSkill);
    return {
      kind: type, view: view || null, amount, type, src: src || null, melee: o.melee === true, attacker: o.attacker || null,
      attackId: evId(o.attackId), isSkill, unit: src || o.attacker || null, useSkill: isSkill === true,
    };
  },
  heal(view, amount) { return { kind: 'heal', view: view || null, amount, unit: view || null, useSkill: false }; },
  /** 'skill' on / off of `view`; o: { skillId } (the event's, else the unit's equipped skill resolves). */
  skill(view, on, o = NONE) { return { kind: on ? 'on' : 'off', view: view || null, on: !!on, skillId: str(o.skillId), unit: view || null, useSkill: true }; },
  die(view) { return { kind: 'die', view: view || null, unit: view || null, useSkill: false }; },
  deploy(view) { return { kind: 'deploy', view: view || null, unit: view || null, useSkill: false }; },
  /** 'fx' kind at (x, y) with the sim's extra object; its unit is extra.src, else extra.id (resolved when needed). */
  fx(kind, x, y, extra) {
    const ex = extra && typeof extra === 'object' ? extra : null;
    return { kind, x, y, extra, unit: undefined, unitId: ex ? ex.src ?? ex.id ?? null : null, useSkill: true };
  },
});

/**
 * Identity of a unit for the registry from its UnitInfo (snapshot.js unitInfo) and the game data (`data.chess(id)`,
 * `data.token(id)`): charId (a chess piece's operator; a summon's / enemy's own id — UnitInfo.spine), sub-profession,
 * profession, and its equipped skill (UnitInfo.skillIndex → that skill of the chess record, else its default skill).
 */
export function unitFxIdentity(info, data) {
  if (!info || typeof info !== 'object') return null;
  const defId = info.defId ?? null;
  const enemy = info.side === 'enemy';
  let rec = null, tok = null;
  try {
    rec = !enemy && defId != null && data && typeof data.chess === 'function' ? data.chess(defId) || null : null;
    tok = !enemy && !rec && defId != null && data && typeof data.token === 'function' ? data.token(defId) || null : null;
  } catch { rec = tok = null; }
  const r = rec || tok;
  return {
    char: str(rec?.charId) ?? str(info.spine) ?? str(defId),
    sub: str(r?.subProfessionId),
    prof: str(r?.profession),
    skill: skillIdOf(r, info.skillIndex),
  };
}

function skillIdOf(rec, index) {
  if (!rec) return null;
  if (Number.isInteger(index) && Array.isArray(rec.skills)) {
    const s = rec.skills.find((k) => k && k.index === index);
    if (s && str(s.skillId)) return s.skillId;
  }
  return str(rec.skill?.skillId) ?? str(rec.skill?.id);
}

/** A melee blow ('atk' 'none') pairs with its target's next 'dmg' this soon (render s): the hit gets its slash. */
export const MELEE_PAIR_S = 0.35;
const MAX_ATTACKS = 256;

/**
 * b.ev tuples → cues on an FxSystem (render/app.js handleEvent). Keeps the little event-stream state the cues need:
 * the melee blows waiting for their hit (target id → { src, t }: the renderer draws the slash of the blow that landed —
 * a heuristic every stream has; the sim's attackId is passed on, not used for it) and whether recent attack ids were
 * skill attacks ('dmg' carries the attackId, not isSkill). Tuples (shared/protocol.js EV, fields appended at the end —
 * older streams / recordings lack them):
 *   ['atk', srcId, tgtId, projKind, attackId?, isSkill?]   ['dmg', tgtId, amount, type, attackerId?, attackId?]
 *   ['skill', id, on, skillId?]   ['heal', id, amount]   ['fx', kind, x, y, extra]
 */
export class FxCues {
  /** @param {{ fx: any, view: (id: any) => any }} o — `view(id)` = the battle view of a unit id, or null */
  constructor({ fx, view }) {
    this.system = fx;   // the FxSystem (not `fx`: that is the method for fx tuples)
    this.view = typeof view === 'function' ? view : () => null;
    this._melee = new Map();
    this._attacks = new Map();
  }

  /** Battle reset / a new field. */
  reset() { this._melee.clear(); this._attacks.clear(); }

  /** 'atk' (src / tgt: the views, null when unknown). */
  atk(e, src, tgt, now) {
    const kind = e[3];
    if ((kind === 'none' || !kind) && tgt && src) this._melee.set(tgt.id, { src, t: now });
    const attackId = evId(e[4]), isSkill = flag(e[5]);
    if (attackId != null && attackId !== 0) {
      this._attacks.delete(attackId);
      this._attacks.set(attackId, isSkill);
      if (this._attacks.size > MAX_ATTACKS) this._attacks.delete(this._attacks.keys().next().value);
    }
    this.system.play('atk', fxCue.atk(src, tgt, kind, { attackId, isSkill }));
  }

  /** 'dmg' on `view` (its view; nothing without one). */
  dmg(e, view, now) {
    if (!view) return;
    const m = this._melee.get(view.id);
    let src = null;
    if (m && now - m.t < MELEE_PAIR_S) { src = m.src; this._melee.delete(view.id); }
    const attackerId = evId(e[4]), attackId = evId(e[5]);
    const attacker = attackerId != null ? this.view(attackerId) || null : null;
    const isSkill = attackId != null && attackId !== 0 && this._attacks.has(attackId) ? this._attacks.get(attackId) : null;
    this.system.play('dmg', fxCue.dmg(view, Number(e[2]) || 0, e[3], src, { melee: !!src, attacker, attackId, isSkill }));
  }

  heal(e, view) { if (view) this.system.play('heal', fxCue.heal(view, Number(e[2]) || 0)); }
  skill(e, view) { if (view) this.system.play('skill', fxCue.skill(view, !!e[2], { skillId: e[3] })); }
  die(view) { if (view) this.system.play('die', fxCue.die(view)); }
  deploy(view) { if (view) this.system.play('deploy', fxCue.deploy(view)); }
  fx(e) { this.system.play('fx', fxCue.fx(e[1], Number(e[2]), Number(e[3]), e[4])); }
}
