// v3: what each of the 18 narration segments points at, which effect it carries (frame / zoom) and when it is queued.
//   anchor: where the guide card sits | frame: thin frame while spoken | zoom: smooth CSS zoom while spoken
//   trigger: 'film' (film seconds) | 'step' (op start + offset) | 'detail' (the moment the shop card's detail opens) | 'afterOp' |
//            'ledger' (when the ledger is open) | 'battle' (in-battle event, matched in the sim's own event stream)
const sel = (s, o = {}) => ({ kind: 'sel', sel: s, ...o });
const piece = (uid) => ({ kind: 'piece', uid });
const CARDS = sel('.spcard', { all: true });
const TOP = sel('.gtop__center');
export const CUES = {
  V01: { tag: '模式', trigger: 'film', anchor: TOP, zoom: { anchor: TOP, scale: 1.5 }, sides: ['bottom'] },
  V02: { tag: '路线', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V03: { tag: '银灰', trigger: 'detail', anchor: sel('.dpanel'), frame: sel('.dpanel'), sides: ['left', 'bottom'], fallback: TOP },
  V05: { tag: '充能', trigger: 'battle', anchor: piece('p1'), frame: piece('p1'), sides: ['top', 'right', 'left'], fallback: TOP,
    watch: { type: 'chargeGranted', targetUid: 'p1', reason: 'opening', minTBefore: 6 } },
  V06: { tag: '战术', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V08: { tag: '商店', trigger: 'detail', anchor: sel('$slot'), frame: sel('$slot'), sides: ['top', 'bottom'] },
  V09: { tag: '合成', trigger: 'afterOp', anchor: piece('p4'), zoom: { anchor: piece('p4'), scale: 1.6 }, sides: ['right', 'top', 'left'], fallback: TOP },
  V10: { tag: '风险战', trigger: 'step', anchor: sel('$choice'), frame: sel('$choice'), sides: ['top', 'bottom'] },
  V11: { tag: '场上干员', trigger: 'afterOp', anchor: sel('[data-testid="deploy-cap"]'), zoom: { anchor: sel('[data-testid="deploy-cap"]'), also: sel('.gm__hud .lvcard'), scale: 1.6 }, sides: ['right', 'bottom'], fallback: TOP },
  V12: { tag: '永久成长', trigger: 'ledger', anchor: sel('[data-growth-operator]', { text: '夕' }), frame: sel('[data-growth-operator]', { text: '夕' }), fallback: sel('.assault-ledger'), sides: ['bottom', 'top'] },
  V13: { tag: '收藏品', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V14: { tag: '干员升级', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V15: { tag: '资金', trigger: 'afterOp', anchor: sel('.funds'), zoom: { anchor: sel('.funds'), scale: 1.6 }, sides: ['bottom', 'right'], fallback: TOP },
  V17: { tag: '加速', trigger: 'battle', anchor: piece('p2'), zoom: { anchor: piece('p2'), scale: 1.6 }, sides: ['top', 'right', 'left'], fallback: TOP,
    watch: { type: 'hasteApplied', sourceUid: 'p1', keyIncludes: 'turbo', minTBefore: 6 } },
  V18: { tag: '再部署时间', trigger: 'battle', anchor: { kind: 'allies' }, frame: { kind: 'allies' }, sides: ['top', 'right'], fallback: TOP,
    watch: { type: 'redeployReduced', sourceUid: 'p4', minTBefore: 6, manual: true } },
  V19: { tag: '充能', trigger: 'battle', anchor: piece('p1'), frame: piece('p1'), sides: ['top', 'right', 'left'], fallback: TOP,
    watch: { type: 'chargeGranted', targetUid: 'p1', reason: 'opening', minTBefore: 6, manual: true } },
  V20: { tag: '终局', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V22: { tag: '战后账本', trigger: 'ledger', anchor: sel('.assault-ledger'), frame: sel('.assault-ledger'), sides: ['bottom', 'top'] },
};
