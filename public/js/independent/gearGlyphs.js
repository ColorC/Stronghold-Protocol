// Art for workshop-only equipment. Existing item and badge artwork takes priority.
export const GEAR_GLYPHS = {
  whistle: 'M8 14h15v8a7 7 0 0 1-14 0v-3H5v-5h3 M16 14v8 M25 10l4-3 M26 15h5 M24 6l1-4',
  chain: 'M12 21l-3 3a6 6 0 0 1-8-8l7-7a6 6 0 0 1 8 0 M20 11l3-3a6 6 0 0 1 8 8l-7 7a6 6 0 0 1-8 0 M11 21l10-10',
  blade: 'M7 27l18-22h5v5L12 28z M5 20l11 11 M3 29l4-4 M22 10l3 3',
  fork: 'M9 3v11a7 7 0 0 0 14 0V3 M14 3v10a2 2 0 0 0 4 0V3 M16 21v10 M12 31h8',
  anchor: 'M16 9v21 M4 20v6l5-1 M28 20v6l-5-1 M4 26q12 12 24 0 M10 14h12 M12 5a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  feather: 'M6 29l19-22 M9 25q-6-11 3-19q10-5 16-2q1 13-9 20z M15 18l-2-9 M19 14l8 1',
  shield: 'M16 3l12 5v10q0 8-12 13Q4 26 4 18V8z M16 8v17 M10 16h12',
  forge: 'M4 19h24l-7 7H11z M10 26v5h13 M9 18v-6q-1-5 4-9q-1 6 4 7q6 0 6 8 M13 18q-2-4 3-7q3 4 3 7',
  gauntlet: 'M8 28V15l3-3v-5h4v7h3V5h4v10h3V9h4v11l-5 10H12z M9 21l-5-6l-2 2v7l6 5 M13 24h9',
  mold: 'M4 6h24v24H4z M10 12h12v12H10z M16 6v6 M4 18h6 M22 18h6 M16 24v6',
  tag: 'M4 4h13l13 13-13 13L4 17z M9 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M14 18l5-5 M18 22l5-5',
  radar: 'M16 16l11-11 M3 16a13 13 0 1 0 26 0a13 13 0 1 0-26 0 M8 16a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M14 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  anvil: 'M2 10h28v5l-10 4v6h5v5H8v-5h5v-6L2 15z M19 10V5h8v5',
  chest: 'M4 13h24v17H4z M4 13V8l4-4h16l4 4v5 M4 18h24 M13 15h6v7h-6z M8 24v5 M24 24v5',
  medicine: 'M10 3h12v5l3 5v17H7V13l3-5z M10 8h12 M12 19h8 M16 15v8',
  coil: 'M5 8h22v18H5z M11 5v24 M21 5v24 M5 12h22 M5 17h22 M5 22h22 M2 17h3 M27 17h3',
  gear: 'M12 3h8l1 5 4 2 4-1 3 7-4 3-1 4 1 4-7 3-3-4-4-1-4 1-3-7 4-3 1-4-1-4 7-3z M11 16a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
};

export function gearGlyphOf(name = '', kind = '') {
  const rules = [
    [/哨|号角/, 'whistle'], [/锁|链|缚/, 'chain'], [/刃|箭|剑|毒棘/, 'blade'], [/音叉|共鸣/, 'fork'],
    [/锚|钩/, 'anchor'], [/笔|羽/, 'feather'], [/盾|屏障|防护|纹章/, 'shield'], [/锻炉|熔炉/, 'forge'],
    [/臂铠|拳|爪/, 'gauntlet'], [/模具/, 'mold'], [/识别|许可|交接|凭证|封签|托付|交工|移交|托管|敕令/, 'tag'],
    [/信标|标定|记录|侦测/, 'radar'], [/砧|校准/, 'anvil'], [/箱|弹匣|战备/, 'chest'],
    [/医疗|血|治疗|补给/, 'medicine'], [/调速|电|浮空|蓄能/, 'coil'],
  ];
  return rules.find(([re]) => re.test(name))?.[1] || (kind === 'permit' ? 'tag' : kind === '奖品' ? 'chest' : 'gear');
}
