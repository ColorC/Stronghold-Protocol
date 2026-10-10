import { tftArmorToNativeDefense, tftMrToNativeResistance } from '../../../../shared/resonance/prototype-resistance.js';

const finite = (value) => value != null && Number.isFinite(Number(value));

function sumBonuses(entries, field) {
  return Object.values(entries ?? {}).reduce((sum, row) => sum + (finite(row?.[field]) ? Number(row[field]) : 0), 0);
}

/** Resolve null source ratings from the actual Native baseline without rewriting source data. */
export function resolvePrototypeRatingReference(unit, powerReference = {}) {
  const reference = { ...(powerReference ?? {}) };
  const fallback = {};
  const native = unit?.base ?? unit?.s ?? {};
  if (!finite(reference.magicResist)) {
    const resistance = Number(native.res);
    if (Number.isFinite(resistance) && resistance >= 0 && resistance < 100) {
      reference.magicResist = 100 * resistance / (100 - resistance);
      fallback.magicResist = 'native-base-resistance-percent-inverted-to-rating';
    }
  }
  if (!finite(reference.armor)) {
    const defense = Number(native.def);
    const attackDamage = finite(reference.attackDamage) ? Number(reference.attackDamage) : Number(native.atk);
    if (Number.isFinite(defense) && defense >= 0 && Number.isFinite(attackDamage) && attackDamage > defense && attackDamage > 0) {
      reference.armor = 100 * defense / (attackDamage - defense);
      fallback.armor = finite(powerReference?.attackDamage)
        ? 'native-base-defense-inverted-with-source-attack-anchor'
        : 'native-base-defense-and-attack-inverted';
      if (!finite(reference.attackDamage)) {
        reference.attackDamage = attackDamage;
        fallback.attackDamage = 'native-base-attack-anchor';
      }
    }
  }
  return { powerReference: reference, fallback };
}

/**
 * Keep all V3 TFT defense ratings in one per-unit ledger, then expose one Native
 * flat-stat delta. Replacing a key is idempotent and removal is represented by
 * zero values. Existing Native base defenses/talents are never rewritten.
 */
export function setPrototypeRatingBonus(battle, unit, key, { armor = 0, magicResist = 0 } = {}, powerReference = {}) {
  if (!unit || typeof key !== 'string' || !key) throw new Error('PROTOTYPE_RATING_KEY_REQUIRED');
  const raw = unit.mem?.prototypeRatingBonuses ?? {};
  const ratings = { ...raw };
  const next = {
    armor: finite(armor) ? Number(armor) : 0,
    magicResist: finite(magicResist) ? Number(magicResist) : 0,
  };
  if (next.armor || next.magicResist) ratings[key] = next;
  else delete ratings[key];
  unit.mem ??= {};
  if (Object.keys(ratings).length) unit.mem.prototypeRatingBonuses = ratings;
  else delete unit.mem.prototypeRatingBonuses;

  const resolved = resolvePrototypeRatingReference(unit, powerReference);
  const reference = resolved.powerReference;
  const totalArmor = sumBonuses(ratings, 'armor');
  const totalMr = sumBonuses(ratings, 'magicResist');
  const mods = {};
  if (finite(reference.armor) && finite(reference.attackDamage)) {
    const base = tftArmorToNativeDefense(reference.armor, reference.attackDamage);
    const total = tftArmorToNativeDefense(Number(reference.armor) + totalArmor, reference.attackDamage);
    if (finite(base) && finite(total)) mods.defFlat = total - base;
  }
  if (finite(reference.magicResist)) {
    const base = tftMrToNativeResistance(reference.magicResist);
    const total = tftMrToNativeResistance(Number(reference.magicResist) + totalMr);
    if (finite(base) && finite(total)) mods.resFlat = total - base;
  }

  const buffKey = `resonance:prototype-rating:${unit.uid}`;
  if (Object.keys(mods).length && (totalArmor || totalMr)) {
    battle.addBuff(unit, { key: buffKey, mods, persist: true, allowDead: true, tags: ['resonance', 'prototype-rating'] });
  } else {
    battle.removeBuff?.(unit, buffKey);
  }
  return { ratings, total: { armor: totalArmor, magicResist: totalMr }, mods, powerReference: reference, fallback: resolved.fallback };
}

export function prototypeRatingTotal(unit, field) {
  if (field !== 'armor' && field !== 'magicResist') throw new Error(`PROTOTYPE_RATING_FIELD_INVALID:${field}`);
  return sumBonuses(unit?.mem?.prototypeRatingBonuses, field);
}
