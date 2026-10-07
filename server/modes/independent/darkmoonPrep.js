// Source-id keyed, authored adapters for Darkmoon effects delivered in preparation.
// Gear IDs intentionally reuse the project's nine stable keyword-gear definitions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const addon = JSON.parse(fs.readFileSync(path.resolve(here, '../../../data/independent-darkmoon-design-addon.json'), 'utf8'));
const sourceIdByName = new Map(addon.operators.map(x => [x.name, x.sourceId]));
const gear = id => ({ id: `independent:${id}`, normal: 1, elite: 1 });
const grantSelf = (...items) => ({ trigger:'gain', behavior:'grantEquipment', params:{ landOn:'self', outputs:items } });

// Only effects whose full source text is a supported keyword map are executable here.
// Triggering on gain means acquisition pays once; leaving/redeploying cannot refill it.
const RULES = Object.freeze({
  BGS_039: [grantSelf(gear('坚守盟约'))], // Taunt
  BGS_106: [grantSelf(gear('坚守盟约'), gear('不屈盟约'))], // Taunt + Reborn
  BGS_034: [grantSelf(gear('护盾发生器'), gear('不屈盟约'))], // Divine Shield + Reborn
  BGS_131: [grantSelf(gear('精准盟约'))], // Poisonous -> user-approved Precision gear
  FP1_010: [grantSelf(gear('精准盟约'))],
  GVG_113: [grantSelf(gear('巨锤盟约'))], // Cleave
  LOOT_078: [grantSelf(gear('巨锤盟约'))],
});

export const DARKMOON_PREP_SUPPORTED_IDS = Object.freeze(Object.keys(RULES));

export function darkmoonPrepRulesFor(source) {
  const id = source?.sourceRefs?.darkmoon19_2?.id || source?.darkmoonSourceId || sourceIdByName.get(source?.name);
  return structuredClone(RULES[id] || []);
}
