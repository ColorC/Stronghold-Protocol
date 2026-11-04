const installed = new WeakSet();
const ABILITIES = ['damage', 'heal', 'regen', 'shield', 'poison', 'burn'];
const activeOperator = (unit) => !!unit && unit.kind === 'op' && unit.side === 'ally' && unit.alive && unit.deployed && !unit.removed;
const pieceOf = (unit) => unit?.def?.raw?.assaultPiece ?? unit?.inputPiece ?? unit?.input_piece ?? null;
const bonusOf = (unit) => {
  const values = pieceOf(unit)?.abilityBonuses;
  if (!values || typeof values !== 'object') return null;
  const result = {};
  for (const ability of ABILITIES) {
    const value = values[ability] ?? 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`Invalid Assault ability bonus ${ability}`);
    result[ability] = value;
  }
  return result;
};
const tagsOf = (dmg) => Array.isArray(dmg?.tags) ? dmg.tags.map((tag) => String(tag).toLowerCase()) : [];
const periodic = (tags) => tags.includes('dot') || tags.includes('periodic');
const sameOwner = (source, target) => source?.ownerId != null && source.ownerId === target?.ownerId;

/** Install only run-input operators; callers may safely invoke this more than once per Battle. */
export function installTemporaryAbilities(battle, prepared) {
  if (!battle || !Array.isArray(battle.allyUnits)) throw new TypeError('Temporary abilities require a native Battle');
  if (installed.has(battle)) return false;
  const input = prepared?.input ?? prepared;
  if (!Array.isArray(input?.pieces)) throw new TypeError('prepared Assault input requires pieces');
  const inputByUid = new Map(input.pieces.filter((piece) => typeof piece?.uid === 'string').map((piece) => [piece.uid, piece]));
  const hosts = new Map();
  for (const unit of battle.allyUnits) {
    if (!inputByUid.has(unit.uid) || unit.kind !== 'op' || unit.side !== 'ally') continue;
    const piece = pieceOf(unit) ?? inputByUid.get(unit.uid);
    const projected = piece?.abilityBonuses ?? inputByUid.get(unit.uid)?.abilityBonuses;
    if (!projected) continue;
    hosts.set(unit, bonusOf({ def: { raw: { assaultPiece: { abilityBonuses: projected } } } }));
  }
  const owned = (unit) => hosts.has(unit) && battle.allyUnits.includes(unit) && activeOperator(unit);

  battle.on('hit', (ctx) => {
    const { source, target, dmg, credit } = ctx;
    if (!dmg || !target?.alive || target.side !== 'enemy' || !Number.isFinite(dmg.amount) || dmg.amount <= 0) return;
    const tags = tagsOf(dmg), isPeriodic = periodic(tags);
    const toxicTick = tags.includes('periodic') && tags.some((tag) => tag.startsWith('toxic:')) && dmg.sourceless === true;
    const producer = toxicTick ? credit : source;
    if (!owned(producer)) return;
    const bonus = hosts.get(producer);
    if (toxicTick) { dmg.amount += bonus.poison; return; }
    if (tags.includes('periodic') && tags.some((tag) => tag.startsWith('fiery:'))) {
      if (bonus.burn > 0) dmg.amount += bonus.burn;
      return;
    }
    if (source !== producer || dmg.sourceless || source === target || dmg.reflect || dmg.isReflect
      || tags.some((tag) => tag.includes('reflect')) || isPeriodic) return;
    dmg.amount += bonus.damage;
  }, { priority: 20, owner: battle });

  battle.on('elementHit', ({ source, target, dmg }) => {
    if (!owned(source) || !target?.alive || target.removed || target.side !== 'enemy'
      || dmg?.sourceless || dmg?.element !== 'burn' || tagsOf(dmg).includes('temporaryability:burn')) return;
    dmg.amount += hosts.get(source).burn;
  }, { priority: 20, owner: battle });

  battle.on('healingAmount', (ctx) => {
    const { source, target, opts } = ctx;
    if (!owned(source) || !target?.alive || target.side !== 'ally' || !sameOwner(source, target)
      || !(ctx.amount > 0) || !Number.isFinite(ctx.amount)) return;
    const ability = opts?.regen ? 'regen' : 'heal';
    const regenSeconds = Number.isFinite(opts?.regenSeconds) && opts.regenSeconds >= 0 ? opts.regenSeconds : 1;
    const amount = hosts.get(source)[ability] * (opts?.regen ? regenSeconds : 1);
    if (amount > 0 && Number.isFinite(amount)) ctx.amount += amount;
  }, { priority: 20, owner: battle });

  battle.on('buffAdding', ({ unit, buff, source }) => {
    if (!buff || typeof buff !== 'object') return;
    const producer = owned(source) ? source : (source == null && owned(unit) ? unit : null);
    if (!producer || unit?.side !== 'ally' || !sameOwner(producer, unit)) return;
    const bonus = hosts.get(producer);
    if (typeof buff.shield === 'number' && Number.isFinite(buff.shield) && buff.shield > 0 && bonus.shield > 0) buff.shield += bonus.shield;

  }, { priority: 20, owner: battle });
  installed.add(battle);
  return true;
}
