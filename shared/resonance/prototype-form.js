export const PROTOTYPE_FORM_SWAP = Object.freeze({
  traitId: 'formSwap',
  sourceApiName: 'TFT13_FormSwapper',
  frontRows: 2,
  backRows: 2,
  modeSkillPolicy: 'retain-native-fixed-skill',
  backlineSkillRangeExtension: 1,
  adaptationNote: 'The source data specifies position-dependent stats and ability but exposes no paired ability records or range values. The PvE adapter keeps each operator fixed skill and adds one skill-range tile in backline form; this is a mode adaptation, not an exact TFT numeric value.',
});

export function prototypeFormForRow(row, rect = { r0: 9, r1: 12 }) {
  const value = Number(row);
  const r0 = Number(rect?.r0);
  const r1 = Number(rect?.r1);
  if (!Number.isFinite(value) || !Number.isFinite(r0) || !Number.isFinite(r1) || r1 < r0) return null;
  const frontRows = Math.ceil((r1 - r0 + 1) / 2);
  return value < r0 + frontRows ? 'frontline' : 'backline';
}
