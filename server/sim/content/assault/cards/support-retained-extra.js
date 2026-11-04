import { COLS } from '../../../constants.js';
import { supportPlans } from './support-plans.js';
import { bodyInKeys } from '../../../body.js';

export const supportRetainedExtraHandledKeys = new Set([
  'char_107_liskam:talent:1',
  'char_401_elysm:talent:0',
  'char_4196_reckpr:talent:0',
  'char_4207_branch:talent:0',
]);

const installs = new WeakMap();

function battleState(battle) {
  let state = installs.get(battle);
  if (!state) {
    state = { handlers: new Set(), permanentByUid: new Set() };
    installs.set(battle, state);
  }
  return state;
}

function starOf(piece, rank) {
  const star = rank ?? piece?.star ?? piece?.rank;
  if (!Number.isInteger(star) || star < 1 || star > 4) throw new TypeError('support retained-extra rank must be 1..4');
  return star;
}

function typedValue(parameters, name, star) {
  const value = parameters?.[name];
  if (Array.isArray(value)) {
    if (value.length !== 4 || value[star - 1] == null) throw new TypeError(`support retained-extra ${name} is missing rank ${star}`);
    return value[star - 1];
  }
  if (Number.isFinite(value)) return value;
  throw new TypeError(`support retained-extra ${name} is missing`);
}

function unitCharId(unit) {
  return unit?.def?.charId ?? unit?.charId ?? null;
}

function active(unit) {
  return !!unit?.alive && !!unit?.deployed && !unit?.hidden && !unit?.removed;
}

function uidOf(unit, piece) {
  return String(piece?.uid ?? piece?.rankUid ?? unit?.uid ?? unit?.id);
}

function inRange(observer, target) {
  if (target?.side === 'enemy') return bodyInKeys(target, observer.rangeKeySet ?? observer.rangeKeys ?? []);
  const key = target.tileR * COLS + target.tileC;
  return observer.rangeKeySet?.has(key) ?? observer.rangeKeys?.includes(key) ?? false;
}

function isFixedSkillResolved(event, unit, body) {
  const ctx = event?.payload ?? event;
  if ((ctx?.source ?? ctx?.unit) !== unit) return false;
  const expectedId = body?.fixedSkill?.sourceSkillId;
  const actualId = ctx.skill?.evSkillId ?? ctx.skill?.id ?? ctx.skillId;
  if (expectedId && actualId && actualId !== expectedId) return false;
  return true;
}

function installLiskam({ battle, unit, piece, rank }) {
  const state = battleState(battle);
  const uid = uidOf(unit, piece);
  if (state.permanentByUid.has(uid)) return true;
  const params = supportPlans.char_107_liskam.talents[1].parameters;
  const res = typedValue(params, 'res', rank);
  const apply = () => {
    if (!active(unit) || state.permanentByUid.has(uid)) return;
    battle.addBuff(unit, {
      key: 'assault:char_107_liskam:talent:1',
      duration: Infinity,
      refresh: 'replace',
      mods: { resFlat: res },
      source: unit,
      visible: true,
      tags: ['talent'],
    });
    if (unit.buffs.some((buff) => buff.key === 'assault:char_107_liskam:talent:1')) state.permanentByUid.add(uid);
  };
  if (active(unit)) apply();
  else {
    battle.on('battleStart', apply, { owner: unit });
    battle.on('deploy', (event) => { if ((event.payload ?? event).unit === unit) apply(); }, { owner: unit });
  }
  return true;
}

function installElysium({ battle, unit, body, piece, rank }) {
  const state = battleState(battle);
  const handlerKey = `char_401_elysm:talent:0:${uidOf(unit, piece)}`;
  if (state.handlers.has(handlerKey)) return true;
  const params = supportPlans.char_401_elysm.talents[0].parameters;
  const attackSpeed = typedValue(params, 'attackSpeed', rank);
  const duration = typedValue(params, 'duration', rank);
  battle.assaultRuntime.observe('skillResolved', `support-retained-extra:elysium:${uidOf(unit, piece)}`, (event) => {
    if (!active(unit) || !isFixedSkillResolved(event, unit, body)) return;
    for (const target of battle.allyUnits) {
      if (target.kind !== 'op' || target.side !== 'ally' || target.ownerId !== unit.ownerId || !active(target) || target.def?.profession !== 'SNIPER') continue;
      battle.addBuff(target, {
        key: 'assault:char_401_elysm:talent:0',
        duration,
        refresh: 'replace',
        mods: { aspd: attackSpeed },
        source: unit,
        visible: true,
        tags: ['talent'],
      });
    }
  }, { owner: unit });
  state.handlers.add(handlerKey);
  return true;
}

function installReckpr({ battle, unit, piece, rank }) {
  const state = battleState(battle);
  const handlerKey = `char_4196_reckpr:talent:0:${uidOf(unit, piece)}`;
  if (state.handlers.has(handlerKey)) return true;
  const params = supportPlans.char_4196_reckpr.talents[0].parameters;
  // 未完成的录武簿 (bazaar module line): the charge becomes the module's {a}.
  const moduleSp = unit.assaultSupportModules?.has('uniequip_002_reckpr')
    ? Number(unit.def?.raw?.assaultBody?.bazaar?.modules?.uniequip_002_reckpr?.params?.a?.[rank - 1]) : NaN;
  const spGain = Number.isFinite(moduleSp) ? moduleSp : typedValue(params, 'spGain', rank);
  const attackSpeed = typedValue(params, 'attackSpeed', rank);
  const duration = typedValue(params, 'duration', rank);
  battle.on('skillStart', (event) => {
    const ctx = event?.payload ?? event;
    const actor = ctx?.unit;
    if (!active(unit) || !active(actor) || actor === unit || actor.kind !== 'op' || actor.side !== 'ally' || actor.ownerId !== unit.ownerId || !inRange(unit, actor)) return;
    if (spGain > 0) unit.skill?.gainSp(spGain, 'assault:char_4196_reckpr:talent:0');
    if (attackSpeed === attackSpeed) return; // 录武官：只充能，附带的 8 秒攻速已删
    battle.addBuff(unit, {
      key: 'assault:char_4196_reckpr:talent:0',
      duration,
      refresh: 'replace',
      maxStacks: 1,
      mods: { aspd: attackSpeed },
      source: unit,
      visible: true,
      tags: ['talent'],
    });
  }, { owner: unit });
  state.handlers.add(handlerKey);
  return true;
}

function installBranch({ battle, unit, body, piece, rank }) {
  const state = battleState(battle);
  const handlerKey = `char_4207_branch:talent:0:${uidOf(unit, piece)}`;
  if (state.handlers.has(handlerKey)) return true;
  const params = supportPlans.char_4207_branch.talents[0].parameters;
  const hpRatio = typedValue(params, 'hpRatio', rank);
  battle.assaultRuntime.observe('skillResolved', `support-retained-extra:branch:${uidOf(unit, piece)}`, (event) => {
    if (!active(unit) || !isFixedSkillResolved(event, unit, body)) return;
    const enhanced=unit.assaultSupportModules?.has('uniequip_002_branch')===true;
    const amount = unit.s.maxHp * (hpRatio+(enhanced?0.1:0));
    if (amount > 0) battle.heal(unit, unit, amount, { self: true, overheal: enhanced, overhealDuration: 3 });
  }, { owner: unit });
  state.handlers.add(handlerKey);
  return true;
}

export function installSupportRetainedExtra({ battle, unit, charId, body, piece, rank }) {
  const key = `${charId}:talent:${charId === 'char_107_liskam' ? 1 : 0}`;
  if (!supportRetainedExtraHandledKeys.has(key) || unitCharId(unit) !== charId) return false;
  const star = starOf(piece, rank);
  if (charId === 'char_107_liskam') return installLiskam({ battle, unit, piece, rank: star });
  if (charId === 'char_401_elysm') return installElysium({ battle, unit, body, piece, rank: star });
  if (charId === 'char_4196_reckpr') return installReckpr({ battle, unit, piece, rank: star });
  return installBranch({ battle, unit, body, piece, rank: star });
}
