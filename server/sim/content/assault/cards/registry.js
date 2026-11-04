import { assaultKits as assaultCards } from './assault.js';
import { supportKits } from './support.js';
import { rangedKits } from './ranged.js';
import { assaultTokenKits } from './assault-tokens.js';
import { supportTokenKits } from './support-tokens.js';
import { rangedTokenKits } from './ranged-tokens.js';
import { rangedMidCards, rangedMidTokenKits } from './ranged-mid.js';
import { rangedEliteCards, rangedEliteTokenKits } from './ranged-elite.js';
import { latestOperatorKits } from './latest-operators.js';
import { synergyAssaultKits } from './synergy-assault.js';
import { synergyRangedKits } from './synergy-ranged.js';
import { synergySupportKits } from './synergy-support.js';
import { adaptationKits, adaptationTokens, adaptationCompleteTokenKits } from './adaptation-registry.js';

// Content groups own exact keys. An omitted template stays a visible development
// error at the core boundary instead of inheriting a different mode's behavior.
const registry = {};
for (const group of [assaultCards, supportKits, rangedKits, rangedMidCards, rangedEliteCards,
  assaultTokenKits, supportTokenKits, rangedTokenKits, rangedMidTokenKits, rangedEliteTokenKits, latestOperatorKits]) {
  for (const [key, builder] of Object.entries(group)) {
    if (Object.hasOwn(registry, key)) throw new Error(`Duplicate assault content key: ${key}`);
    if (typeof builder !== 'function') throw new TypeError(`Invalid assault content builder: ${key}`);
    registry[key] = builder;
  }
}
// Synergy cards (design of 2026-10-21) replace the kit of their operator: each key must already be a registered card.
for (const group of [synergyAssaultKits, synergyRangedKits, synergySupportKits]) {
  for (const [key, builder] of Object.entries(group)) {
    if (!Object.hasOwn(registry, key)) throw new Error(`Synergy kit for an unknown assault card: ${key}`);
    if (typeof builder !== 'function') throw new TypeError(`Invalid synergy builder: ${key}`);
    registry[key] = builder;
  }
}
for (const [key, builder] of Object.entries(adaptationKits)) {
  const legacy = registry[key];
  registry[key] = (bb, raw, def) => (def.raw?.assaultBody?.adaptation ? builder : legacy)(bb, raw, def);
}
for (const [key, install] of Object.entries(adaptationTokens)) {
  const legacy = registry[key];
  registry[key] = (bb, raw, def) => {
    const kit = legacy(bb, raw, def);
    return { ...kit, install: (battle, token, ...args) => token.ownerUnit?.def.raw?.assaultBody?.adaptation
      ? install(battle, token) : kit.install?.(battle, token, ...args) };
  };
}
for (const [key, builder] of Object.entries(adaptationCompleteTokenKits)) {
  const legacy=registry[key];
  registry[key]=(bb,raw,def,unit)=>{
    if(unit?.ownerUnit?.def.raw?.assaultBody?.adaptation)return builder(bb,raw,def,unit);
    if(!legacy)throw new Error(`Legacy assault token has no exact kit: ${key}`);
    return legacy(bb,raw,def,unit);
  };
}
export const assaultKits = Object.freeze(registry);
