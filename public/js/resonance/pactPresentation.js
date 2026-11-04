// Keep reward breakpoints out of repeated tier descriptions. The full schedule
// remains available in the pact's expandable detail, and rules stay unchanged.
const scheduleSentence = /累计达到\s*([\d\s、，,或]+)\s*点可领取一档奖励[。；;]?/g;

export function pactReadableCopy(value) {
  return String(value || '').replace(scheduleSentence, '累积进度可解锁战利品。');
}

export function pactRewardSchedule(pact) {
  const values = new Set((pact?.rewardThresholds??[]).map(Number));
  for (const text of [pact?.description, ...(pact?.levels || []).map(level => level.description)]) {
    for (const match of String(text || '').matchAll(new RegExp(scheduleSentence.source, 'g'))) {
      for (const n of match[1].match(/\d+/g) || []) values.add(Number(n));
    }
  }
  return [...values].filter(n => n > 0).sort((a, b) => a - b);
}

export function pactRewardProgress(state, thresholds) {
  const economy = state?.prototypeMeta?.economy?.conqueror;
  const value = Number(economy?.conquest ?? 0);
  const opened = economy?.openedChests || [];
  const next = thresholds.find(n => !opened.includes(n)) ?? null;
  return { value, next, opened };
}
