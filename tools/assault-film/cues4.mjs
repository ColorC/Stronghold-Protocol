// v3: what each of the 18 narration segments points at, which effect it carries (frame / zoom) and when it is queued.
//   anchor: where the guide card sits | frame: thin frame while spoken | zoom: smooth CSS zoom while spoken
//   trigger: 'film' (film seconds) | 'step' (op start + offset) | 'detail' (the moment the shop card's detail opens) | 'afterOp' |
//            'ledger' (when the ledger is open) | 'battle' (in-battle event, matched in the sim's own event stream) |
//            'opening' (v5: the leader pick before the run exists, played by the driver itself)
//   frame may be one anchor or an array of anchors (one thin frame each); avoid lists extra rects / selectors / anchors.
//   Card rule (v5): the guide card never intersects any frame of its own segment (overlay.page.js adds every frame rect
//   to the card's avoid list), on top of never covering its anchor.
//   watch.manual: the driver pauses the battle with the game's own button on the hit; pauseMax caps that pause (seconds),
//   watch.follow: queued right behind the named manual cue of the same pause (no pause of its own).
const sel = (s, o = {}) => ({ kind: 'sel', sel: s, ...o });
const piece = (uid) => ({ kind: 'piece', uid });
// a piece's body plus the 再部署 loop ring round its star badge (left of the HP bar above the head)
const pieceRing = (uid) => ({ kind: 'pieceRing', uid });
const LEADERS = sel('.spcard[data-choice-idx]', { all: true });
const CARDS = sel('.spcard', { all: true });
const TOP = sel('.gtop__center');
// the ledger rows of 伊内丝, 凛御银灰 and 银灰 (the third row's text also matches 凛御银灰, hence nth 1)
const LEDGER3 = { kind: 'union', parts: [sel('.assault-ledger tbody tr', { text: '伊内丝' }), sel('.assault-ledger tbody tr', { text: '凛御银灰' }), sel('.assault-ledger tbody tr', { text: '银灰', nth: 1 })] };
export const CUES = {
  // v5 opening on the leader pick (the run does not exist yet)
  V00a: { tag: '进击', trigger: 'opening', anchor: LEADERS, sides: ['top', 'bottom'], fallback: TOP },
  V00b: { tag: '领袖', trigger: 'opening', anchor: LEADERS, sides: ['top', 'bottom'], fallback: TOP },
  V01: { tag: '模式', trigger: 'film', anchor: TOP, zoom: { anchor: TOP, scale: 1.25 }, sides: ['bottom'] },
  V02: { tag: '路线', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V03: { tag: '银灰', trigger: 'detail', anchor: sel('.dpanel'), frame: sel('.dpanel'), sides: ['left', 'bottom'], fallback: TOP },
  V05: { tag: '充能', trigger: 'battle', anchor: { kind: 'allies', uids: ['p1', 'p5'] }, frame: { kind: 'allies', uids: ['p1', 'p5'] }, sides: ['top', 'right', 'left'], fallback: TOP,
    watch: { type: 'chargeGranted', targetUid: 'p1', reason: 'opening', minTBefore: 6 } },
  // v5: 伊内丝 (p5) alone with her loop ring, the card off her, 凛御银灰 (p1) and the ring; the battle pauses on her first loop
  // 再部署 (reason cycle) for at most 6 s while the card is read
  V05a: { tag: '再部署', trigger: 'battle', anchor: pieceRing('p5'), frame: pieceRing('p5'), avoid: ['.gtop__right', piece('p1'), pieceRing('p1')], sides: ['right', 'top', 'left', 'bottom'], fallback: TOP,
    watch: { type: 'redeploy', sourceUid: 'p5', reason: 'cycle', minTBefore: 6, manual: true, pauseMax: 6 } },
  V05b: { tag: '充能', trigger: 'battle', anchor: pieceRing('p1'), frame: pieceRing('p1'), avoid: ['.gtop__right', piece('p4')], sides: ['right', 'top', 'left', 'bottom'], fallback: TOP,
    watch: { type: 'chargeGranted', targetUid: 'p1', reason: 'opening', minTBefore: 6, follow: 'V05a' } },
  V06: { tag: '战术', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V08: { tag: '商店', trigger: 'step', anchor: sel('$slot'), frame: sel('$slot'), sides: ['top', 'bottom'] },
  V09: { tag: '合成', trigger: 'afterOp', anchor: piece('p4'), zoom: { anchor: piece('p4'), scale: 1.6 }, sides: ['right', 'top', 'left'], fallback: TOP },
  V10: { tag: '风险战', trigger: 'step', anchor: sel('$choice'), frame: sel('$choice'), sides: ['top', 'bottom'] },
  V11: { tag: '场上干员', trigger: 'afterOp', anchor: sel('[data-testid="deploy-cap"]'), zoom: { anchor: sel('[data-testid="deploy-cap"]'), also: sel('.gm__hud .lvcard'), scale: 1.6 }, sides: ['right', 'bottom'], fallback: TOP },
  V12: { tag: '永久成长', trigger: 'ledger', anchor: sel('[data-growth-operator]', { text: '夕' }), frame: sel('[data-growth-operator]', { text: '夕' }), fallback: sel('.assault-ledger'), sides: ['top', 'right', 'left'], avoid: [{ x: 330, y: 300, w: 960, h: 240 }, '.gtop__right'] },
  V13: { tag: '收藏品', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V14: { tag: '干员升级', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V15: { tag: '资金', trigger: 'afterOp', anchor: sel('.funds'), zoom: { anchor: sel('.funds'), scale: 1.6 }, sides: ['bottom', 'right'], fallback: TOP },
  V17: { tag: '加速', trigger: 'battle', anchor: { kind: 'allies', uids: ['p1', 'p2'] }, zoom: { anchor: { kind: 'allies', uids: ['p1', 'p2'] }, scale: 1.6 }, sides: ['top', 'right', 'left'], fallback: TOP,
    watch: { type: 'hasteApplied', sourceUid: 'p1', keyIncludes: 'turbo', minTBefore: 6 } },
  // v5: only 银灰 (p4) and 伊内丝 (p5, with her loop ring) are framed; the card keeps off both
  V18: { tag: '再部署时间', trigger: 'battle', anchor: piece('p4'), frame: [piece('p4'), pieceRing('p5')], avoid: ['.gtop__right', pieceRing('p5')], sides: ['top', 'right', 'left', 'bottom'], fallback: TOP,
    watch: { type: 'redeployReduced', sourceUid: 'p4', minTBefore: 6, manual: true } },
  V19: { tag: '充能', trigger: 'battle', anchor: { kind: 'allies', uids: ['p5', 'p1'] }, frame: { kind: 'allies', uids: ['p5', 'p1'] }, sides: ['top', 'right', 'left'], fallback: TOP,
    watch: { type: 'chargeGranted', targetUid: 'p1', reason: 'opening', minTBefore: 6, manual: true } },
  V20: { tag: '终局', trigger: 'step', anchor: CARDS, frame: CARDS, sides: ['top', 'bottom'] },
  V22: { tag: '战后账本', trigger: 'ledger', anchor: LEDGER3, frame: LEDGER3, fallback: sel('.assault-ledger'), sides: ['right', 'bottom', 'top'] },
};
