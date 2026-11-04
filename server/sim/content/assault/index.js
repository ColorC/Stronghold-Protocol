// Mode-specific content boundary. The caller supplies the complete calibrated registry.

import { createAssaultRuntime } from './runtime.js';
import { installAssaultEvents } from './events.js';
import { installRedeployCycle } from './redeploy-cycle.js';
import { installChapterEnemies } from './chapter-enemies.js';
import { installBattleLedger } from './ledger.js';

export { createAssaultRuntime } from './runtime.js';

export function assaultKitKey(unit) {
  const def = unit?.def ?? {};
  return unit?.kind === 'token' ? (def.assaultKey ?? def.raw?.assaultKey ?? def.id ?? unit.defId) : (def.charId ?? def.id ?? unit.defId);
}

export function buildAssaultKit(battle, unit) {
  const registry = battle.opts?.assault?.kits;
  const key = assaultKitKey(unit);
  if (!registry || typeof registry !== 'object') throw new Error('assault kit registry is required');
  if (!Object.prototype.hasOwnProperty.call(registry, key)) throw new Error(`assault kit registry is missing exact key ${key}`);
  const builder = registry[key];
  if (typeof builder !== 'function') throw new Error(`assault kit ${key} must be a builder function`);
  const def = unit.def ?? {};
  const raw = def.raw ?? def;
  const kit = builder(def.skill?.bb ?? {}, raw, def, unit);
  if (!kit || typeof kit !== 'object') throw new Error(`assault kit ${key} returned no kit`);
  if (unit.kind === 'op' && !def.skill && kit.skill?.kind !== 'passive') throw new Error(`assault kit ${key} is missing the calibrated fixed skill record`);
  if (unit.kind === 'op' || def.skill) {
    const spec = kit.skill;
    if (!spec || typeof spec !== 'object') throw new Error(`assault kit ${key} is missing its fixed skill spec`);
    if (typeof spec.assaultCast !== 'function' && !(spec.kind === 'passive' && typeof spec.onStart === 'function')) {
      throw new Error(`assault kit ${key} skill ${spec.id ?? def.skill?.id ?? 'unknown'} is missing assaultCast handler`);
    }
  }
  return kit;
}

export function installAssaultContent(battle) {
  // Saved placements use board coordinates. The native engine projects the
  // operators to the solo boss field; their explicit summon instructions must
  // use that same projection before any mode kit reads them. Keep the shared
  // data definition and persisted snapshot unchanged for subsequent battles.
  for(const unit of battle.allyUnits){
    const raw=unit.def?.raw,piece=raw?.assaultPiece;
    if(!piece?.summonPresets?.length)continue;
    const presets=piece.summonPresets.map(preset=>{
      if(!preset)return preset;
      const[row,col]=battle.mapTile(unit.player,preset.row,preset.col);
      return{...preset,row,col,dir:battle.mapDir(unit.player,preset.dir??piece.dir)};
    });
    unit.def={...unit.def,raw:{...raw,assaultPiece:{...piece,summonPresets:presets}}};
  }
  const runtime = createAssaultRuntime(battle);
  installBattleLedger(battle, runtime);
  installAssaultEvents(battle, runtime);
  installRedeployCycle(battle);
  installChapterEnemies(battle);
  const assault = battle.opts.assault;
  for (const anchor of assault.deployAnchors ?? []) {
    const owner = battle.allyUnits.find((unit) => unit.kind === 'op' && unit.uid === anchor.ownerUid);
    if (!owner) throw new TypeError(`deployment anchor owner is missing: ${anchor.ownerUid}`);
    battle.registerAssaultDeployAnchor(owner, anchor);
  }
  if (typeof assault.install === 'function') assault.install(battle);
  return runtime;
}
