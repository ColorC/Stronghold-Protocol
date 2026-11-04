// The four difficulties as 共鸣 names them (the 共鸣 difficulty page, docs/resonance/design.md). Every 共鸣 page shows
// these, never the original mode's 标准/险境/绝境/终极模拟 (shared/constants.js DIFFICULTY_NAMES, the 13000 mode): the
// 共鸣 page sets them for DifficultyTag at start-up (public/js/resonance/main.js setDifficultyNames).
export const RESONANCE_DIFFICULTY_NAMES = Object.freeze({ FUNNY: '轻松', NORMAL: '标准', HARD: '困难', ABYSS: '深渊' });

/** The 共鸣 name of a difficulty id, or null for anything else. */
export const resonanceDifficultyName = (difficulty) => (Object.hasOwn(RESONANCE_DIFFICULTY_NAMES, difficulty) ? RESONANCE_DIFFICULTY_NAMES[difficulty] : null);
