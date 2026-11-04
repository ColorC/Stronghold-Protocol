/** Convert a complete native overlay selection into the authoritative Resonance session action. */
export function resonanceChoiceAction(choice, selected, targets = {}) {
  if (!choice || !Array.isArray(choice.options) || !Array.isArray(selected)) return null;
  const required = Math.max(1, Number(choice.remaining) || 1);
  if (selected.length !== required || selected.some(option => !choice.options.includes(option))) return null;
  if (choice.type === 'strategy') {
    const strategyId = selected[0];
    const pair = targets[strategyId];
    return { type: 'chooseStrategy', choiceUid: choice.uid, strategyId,
      ...(pair ? { targets: { pieceUids: pair.split('|') } } : {}) };
  }
  return { type: 'claimReward', choiceUid: choice.uid, optionIds: [...selected] };
}
