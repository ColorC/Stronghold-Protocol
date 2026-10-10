const clone=(value)=>structuredClone(value);
const QUALITY = new Set(['artifact', 'support', 'radiant', 'radiant_conversion']);

/** Install explicitly mapped item quality effects on the real browser/server simulator units. */
export function installPrototypeGearActions(battle, state, catalog = {}) {
  const qualityEffects = catalog?.prototypeEconomy?.qualityEffects ?? {};
  const rows = [];
  for (const piece of state?.pieces ?? []) {
    if (piece.row == null || piece.col == null) continue;
    for (const item of piece.equipment ?? []) {
      if (!QUALITY.has(item.quality)) continue;
      const effect = qualityEffects[item.quality]?.[item.itemId];
      if (effect) rows.push({ piece, item, effect });
    }
  }
  const temporary = [];
  for (const unit of battle?.allyUnits ?? []) {
    if (unit?.kind !== 'op' || !unit.mem?.prototypeTemporaryItems?.length) continue;
    const tempItems = unit.mem.prototypeTemporaryItems;
    const consumed = new Set(tempItems.flatMap(row => row.sourceComponents ?? []));
    if (consumed.size) unit.mem.resonanceEquipmentEffects = (unit.mem.resonanceEquipmentEffects ?? []).filter(row => !consumed.has(row.itemId));
    const mods = {};
    for (const temp of tempItems) {
      const item = catalog?.equipment?.[temp.itemId];
      if (!item || item.kind === 'component' || item.kind === 'emblem' || item.grantAllowed === false) continue;
      for (const effect of item.effects?.length ? item.effects : item.baseEffects ?? []) {
        unit.mem.resonanceEquipmentEffects ??= [];
        unit.mem.resonanceEquipmentEffects.push({ ...clone(effect), itemId: `scrap:${temp.itemId}`, itemKind: item.kind, temporary: true });
        if (effect.kind !== 'component_stat') continue;
        const p = effect.params ?? {};
        for (const [source, target] of [['atk','atkFlat'],['aspd','aspd'],['def','defFlat'],['res','resFlat'],['hp','hpFlat'],['sp','spRecoveryFlat'],['hpPct','hpPct']]) {
          const value = Number(p[source] ?? 0);
          if (Number.isFinite(value) && value) mods[target] = (mods[target] ?? 0) + (source === 'hpPct' ? value / 100 : value);
        }
      }
      if (temp.quality === 'radiant') {
        const bonus = qualityEffects.radiant?.[temp.itemId]?.mods;
        for (const [key, value] of Object.entries(bonus ?? {})) if (Number.isFinite(Number(value))) mods[key] = (mods[key] ?? 0) + Number(value);
      }
      temporary.push({ unit, itemId: temp.itemId, quality: temp.quality ?? 'normal', source: temp.source ?? null });
    }
    if (Object.keys(mods).length) battle.addBuff(unit, { key: `resonance:v3:scrap-temporary:${unit.id}`, mods, persist: true, allowDead: true, tags: ['resonance','scrap','temporary-equipment'] });
  }
  if (!rows.length && !temporary.length) return { installed: 0, temporary: 0 };
  battle.on('battleStart', () => {
    for (const { piece, item, effect } of rows) {
      const unit = battle.allyUnits.find(row => row?.alive && row.deployed && !row.removed
        && [row.uid, row.resonanceUid, row.player?.input?.uid].some(uid => uid != null && String(uid) === String(piece.uid)));
      if (!unit) continue;
      const mods = clone(effect.mods ?? {});
      if (Object.keys(mods).length) battle.addBuff(unit, { key: `resonance:v3:gear-quality:${item.uid}`, mods, persist: true, allowDead: false, tags: ['resonance', 'prototype-gear-quality'] });
      if (effect.teamMods && Object.keys(effect.teamMods).length) for (const ally of battle.allyUnits.filter(row => row?.alive && row.deployed && !row.removed)) {
        battle.addBuff(ally, { key: `resonance:v3:gear-support:${item.uid}:${ally.id}`, mods: clone(effect.teamMods), persist: true, allowDead: false, tags: ['resonance', 'prototype-gear-quality', 'support'] });
      }
    }
  }, { owner: battle });
  return { installed: rows.length, temporary: temporary.length };
}
