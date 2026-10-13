const SOURCE = 'https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-patch-17-2/';

/** Opening encounters use one shared roster. Weights and node timing are explicit mode adaptations. */
export const resonanceOpenings = Object.freeze({
  none: Object.freeze({ name: '标准开局', description: '本局没有额外开局效果。', weight: 40, reference: { game: 'TFT', version: '17.2', name: 'No Encounter', url: SOURCE } }),
  double_duplicators: Object.freeze({ name: '双份援军', description: '开局获得一张低费复制凭证，第十四节点再获得一张。只能复制一至三费干员。', weight: 20, reference: { game: 'TFT', version: '17.2', name: 'Double Duplicators', url: SOURCE, originalTiming: ['start', '3-3'] } }),
  reroll_start: Object.freeze({ name: '招募先机', description: '第五节点获得八次免费刷新。未使用的次数可以保留。', weight: 20, reference: { game: 'TFT', version: '17.2', name: 'Reroll Start', url: SOURCE, originalTiming: ['2-1'] } }),
  cheaper_levels: Object.freeze({ name: '快速成长', description: '本局每次升级需要的经验减少两点。购买经验仍为四金币获得四经验。', weight: 20, reference: { game: 'TFT', version: '17.2', name: 'Cheaper Levels', url: SOURCE } }),
});

export function selectResonanceOpening(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('BAD_OPENING_SEED');
  let value = Math.imul((seed >>> 0) ^ 0x6d2b79f5, 0x45d9f3b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  const roll = ((value ^ (value >>> 16)) >>> 0) / 4294967296 * 100;
  let cumulative = 0;
  for (const [id, opening] of Object.entries(resonanceOpenings)) {
    cumulative += opening.weight;
    if (roll < cumulative) return id;
  }
  return 'cheaper_levels';
}

/** Set 13 prototype opens on the shared standard node; legacy seasons keep their weighted opening. */
export function selectPrototypeOpening(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('BAD_OPENING_SEED');
  return 'none';
}

export function openingEventView(openingId) {
  if (!Object.hasOwn(resonanceOpenings, openingId)) throw new Error('UNKNOWN_OPENING');
  const opening = resonanceOpenings[openingId];
  if (!opening) throw new Error('UNKNOWN_OPENING');
  return { name: opening.name, description: opening.description };
}

export function resonanceRulesVersion(state) {
  const version = state?.rulesVersion === undefined ? 1 : state.rulesVersion;
  if (![1, 2, 3].includes(version)) throw new Error('UNKNOWN_RULES_VERSION');
  return version;
}
