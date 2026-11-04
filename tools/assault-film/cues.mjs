// Where each narration cue of the run2 film (runtime/assault/film-1103/run2/narration.json) is anchored on screen.
// The card text, order and wording come from narration.json untouched; this table only says WHAT the card points at.
//   anchor / fallback: { kind:'sel', sel, text?, nth? } | { kind:'piece', uid } | { kind:'unit', n } | { kind:'allies' (uids filled by the driver) }
//   special selectors the driver resolves per step: '$slot' (the shop card the step buys), '$choice' (the pick-one card the step picks)
//   when: 'before' (shown while the cursor hovers the element, the click waits for the voice) | 'after' (shown once the step is done)
//         - default by step type: place / readyBattle / settleBattle are 'after', everything else 'before'
//   pre: 'ledger' opens the info drawer and its battle ledger first (the card sits on the ledger table); 'ledger-end' does the same from the result screen
export const SLOT = { kind: 'sel', sel: '$slot' };
export const CHOICE = { kind: 'sel', sel: '$choice' };
const HUD_TECH = { kind: 'sel', sel: '.gm__hud .lvcard' };
const REFRESH = { kind: 'sel', sel: '.shopbar__tools .toolbtn--amber' };
const piece = (uid) => ({ kind: 'piece', uid });
const TOP = { kind: 'sel', sel: '.gtop__center' };
const PREP = { sides: ['right', 'left', 'top'], avoid: ['.gtop__right'], when: 'after', fallback: TOP };
const FIELD = { sides: ['right', 'top', 'left'], fallback: TOP };
const PICK = { anchor: CHOICE, sides: ['top', 'bottom'] };
const SHOP = { anchor: SLOT, sides: ['top'] };

export const CUES = {
  n01: { tag: '路线', anchor: { kind: 'sel', sel: '.roundbox' }, sides: ['bottom'] },
  n02: { tag: '领袖', anchor: piece('p1'), fallback: { kind: 'sel', sel: '.team' }, when: 'after', sides: ['top', 'right'] },
  n03: { tag: '资金', anchor: { kind: 'sel', sel: '.funds' }, fallback: TOP, when: 'after', sides: ['top', 'left'] },
  n04: { tag: '商店', ...SHOP },
  n05: { tag: '银灰', ...SHOP },
  n06: { tag: '伊内丝', ...SHOP },
  n07: { tag: '科技', anchor: HUD_TECH, sides: ['right', 'bottom'] },
  n08: { tag: '场上干员', anchor: { kind: 'sel', sel: '[data-testid="deploy-cap"]' }, sides: ['top', 'left'] },
  n09: { tag: '技力', anchor: piece('p4'), ...FIELD },
  n10: { tag: '战后账本', anchor: { kind: 'sel', sel: '.assault-ledger' }, pre: 'ledger', sides: ['bottom'] },
  n11: { tag: '战术', ...PICK },
  n12: { tag: '折扣商店', ...SHOP },
  n13: { tag: '晋升', ...SHOP },
  n14: { tag: '风险战', ...PICK },
  n15: { tag: '扳机联动', anchor: piece('p4'), ...FIELD },
  n16: { tag: '冻结', anchor: { kind: 'unit', n: 9 }, ...FIELD },
  n17: { tag: '永久成长', anchor: { kind: 'sel', sel: '[data-growth-operator]', text: '夕' }, fallback: { kind: 'sel', sel: '.assault-ledger' }, pre: 'ledger', sides: ['bottom'] },
  n18: { tag: '收藏品', ...PICK },
  n19: { tag: '干员升级', ...PICK },
  n20: { tag: '折扣商店', ...SHOP },
  n21: { tag: '刷新', anchor: REFRESH, sides: ['left', 'top'] },
  n22: { tag: '战术商人', ...SHOP },
  n23: { tag: '路线', ...PICK },
  n24: { tag: '事件', ...PICK },
  n25: { tag: '战术', ...PICK },
  n26: { tag: '阵型', anchor: { kind: 'allies' }, ...PREP },
  n27: { tag: '干员升级', ...PICK },
  n28: { tag: '战术', ...SHOP },
  n29: { tag: '强化', ...SHOP },
  n30: { tag: '阵型', anchor: piece('p3'), ...PREP },
  n31: { tag: '加速', anchor: piece('p2'), ...FIELD },
  n32: { tag: '收藏品', ...PICK },
  n33: { tag: '收藏品', ...PICK },
  n34: { tag: '收藏品', ...PICK },
  n35: { tag: '商店', ...SHOP },
  n36: { tag: '战术', ...SHOP },
  n37: { tag: '阵型', anchor: piece('p12'), ...PREP },
  n38: { tag: '战术', ...SHOP },
  n39: { tag: '阵型', anchor: piece('p11'), ...PREP },
  n40: { tag: '收藏品', ...PICK },
  n41: { tag: '战术商人', ...SHOP },
  n42: { tag: '事件', ...PICK },
  n43: { tag: '收藏品', ...PICK },
  n44: { tag: '商店', ...SHOP },
  n45: { tag: '强化', ...SHOP },
  n46: { tag: '扳机联动', anchor: piece('p4'), ...FIELD },
  n47: { tag: '再部署时间', anchor: { kind: 'allies' }, ...FIELD },
  n48: { tag: '再部署', anchor: piece('p5'), ...FIELD },
  n49: { tag: '充能', anchor: piece('p1'), ...FIELD },
  n50: { tag: '扳机联动', anchor: piece('p4'), ...FIELD },
  n51: { tag: '商店', ...SHOP },
  n52: { tag: '阵型', anchor: piece('p17'), ...PREP },
  n53: { tag: '收藏品', ...PICK },
  n54: { tag: '强化', ...SHOP },
  n55: { tag: '收藏品', ...PICK },
  n56: { tag: '战术商人', ...SHOP },
  n57: { tag: '终局', ...PICK },
  n58: { tag: '阵型', anchor: { kind: 'allies' }, ...PREP },
  n59: { tag: '战后账本', anchor: { kind: 'sel', sel: '.assault-ledger' }, pre: 'ledger-end', sides: ['bottom'] },
};
