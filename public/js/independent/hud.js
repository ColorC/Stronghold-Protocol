// 卫戍协议：工坊 HUD on the original game screen's frame (css/screens/game*.css classes: gtop, roundbox, capsule,
// shopbar, scard, lvcard, funds) with the independent mode's own data. Default layer only (docs/independent-mode/
// frontend-design.md 信息分层): numbers that decide the current step; full texts open in the detail card.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Fragment, Icon, Button, HexBadge, TierChip, Tooltip, MicroLabel, DifficultyTag } from '../ui/components.js';
import { Img, BondGlyph, CoinGlyph, GIcon, LpTower, ItemIcon, UnitThumb } from '../ui/gameComponents.js';
import { PhaseCapsule, CheckBtn, checkButtons } from '../ui/hud.js';
import { SkillBadge } from '../ui/shopBar.js';
import { chessLoadout } from '../ui/gameLogic.js';
import { TAVERN_FACTIONS } from '../../../shared/independentRules.js';
import { chessPortraitUrl, uiUrl } from '../ui/assetUrls.js';
import { PHASE } from '../../../shared/constants.js';
import { data } from '../data.js';
import { formEntry, isDeployed, summaryCount, forecastRows, groupProduction, renderChessId, permitsOf, pieceByNum } from './model.js';
import { GearIcon, GameText } from './text.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// ---- glyphs -------------------------------------------------------------------------------------------------------

const KIND_WORD = { recruit: '招募', random: '随机', stat: '属性', damage: '增伤', copy: '复制', merge: '两份合成', shopBadge: '商品携装',
  boost: '增幅', transfer: '徽章转交', devour: '吞并商品', doubleWorn: '徽章翻倍' };
// the second-wave markers: what a yield grows with (每轮翻倍 / 种类 / 精锐 / 逐次增加) and game-long counts
const CONDITION_WORD = { escalate: '每次翻倍', professions: '每种职业', factions: '每种阵营', elites: '每名精锐', improves: '逐次+1' };
const TOTAL_WORD = { gained: '获得', refreshes: '刷新', sold: '出售', bought: '购买', elites: '晋升', kills: '击倒' };

/**
 * The trait's icon line: moment → yield (icons × count of this form) and a marker per condition. It indexes the full
 * text (detail card); it never shortens a mechanism into words of its own.
 */
export function TraitGlyphs({ summary, elite = false, catalog, max = 2, class: cls }) {
  const entries = (summary || []).slice(0, max);
  if (!entries.length) return null;
  return html`<span class=${cx('ix-trait', cls)}>
    ${entries.map((e, i) => html`<span class="ix-trait__rule" key=${i}>
      <span class="ix-trait__when">${catalog?.traitWhen?.[e.when] || e.when}</span>
      <span class="ix-trait__arrow" aria-hidden="true">›</span>
      ${e.kind === 'forge' || e.kind === 'shopBadge'
        ? (e.items || []).map((it, k) => html`<span class="ix-trait__out" key=${k}>
            <${GearIcon} id=${it.id} catalog=${catalog} />${summaryCount(it, elite) != null ? html`<b class="num">×${summaryCount(it, elite)}</b>` : null}
          </span>`)
        : null}
      ${e.kind === 'funds' ? html`<span class="ix-trait__out"><${CoinGlyph} /><b class="num">+${summaryCount(e.amount, elite)}</b></span>` : null}
      ${e.kind === 'refresh' ? html`<span class="ix-trait__out"><${Icon} name="refresh" /><b class="num">×${summaryCount(e.amount, elite)}</b></span>` : null}
      ${(e.kind === 'stat' || e.kind === 'boost') && e.items ? e.items.map((it, k) => html`<span class="ix-trait__out" key=${k}><${GearIcon} id=${it.id} catalog=${catalog} /></span>`) : null}
      ${e.kind === 'stat' && e.times > 1 ? html`<b class="num">×${e.times}</b>` : null}
      ${e.kind === 'boost' ? html`<b class="num">+${Math.round(summaryCount(e.amount, elite) * 100)}%</b>` : null}
      ${e.kind === 'double' ? html`<span class="ix-trait__word">${catalog?.traitWhen?.[e.hook] || e.hook}</span><b class="num">×${summaryCount(e.amount, elite)}</b>` : null}
      ${KIND_WORD[e.kind] ? html`<span class="ix-trait__word">${KIND_WORD[e.kind]}</span>` : null}
      ${e.faction ? html`<span class="ix-trait__cond" title=${`需要${e.faction}干员在场`}>${e.faction}</span>` : null}
      ${e.perBattle ? html`<span class="ix-trait__cond" title="每场上限">≤${e.perBattle}</span>` : null}
      ${e.afterBattle ? html`<span class="ix-trait__cond" title="战斗结束后放入库存">战后</span>` : null}
      ${e.condition && CONDITION_WORD[e.condition] ? html`<span class="ix-trait__cond">${CONDITION_WORD[e.condition]}</span>` : null}
      ${e.total ? html`<span class="ix-trait__cond" title="按本局累计次数">每${e.total.per}次${TOTAL_WORD[e.total.counter] || ''}</span>` : null}
      ${e.grows ? html`<span class="ix-trait__cond" title="在场越久越多">成长</span>` : null}
      ${e.lasting ? html`<span class="ix-trait__cond" title="本局持续">本局</span>` : null}
    </span>`)}
    ${(summary || []).length > max ? html`<span class="ix-trait__more">+${summary.length - max}</span>` : null}
  </span>`;
}

// ---- top bar ------------------------------------------------------------------------------------------------------

/** Round / phase / LP / ready, on the original top bar's frame. `battle` = the replay on screen (or null). */
export function TopBar({ state, battle, busy, onExit, onReady, readyReason, pen = false, onPen = null, drawer = null, onDrawer = null }) {
  const enemies = (state.nextEnemies || []).reduce((n, e) => n + Number(e.count || 0), 0);
  // a boss field reads 最终攻势 with the leader's HP bar in the capsule (ui/hud.js PhaseCapsule, gameLogic snapHud)
  const boss = !!battle && battle.replay?.kind && battle.replay.kind !== 'normal';
  const phase = battle ? (boss ? PHASE.FINAL_ASSAULT : PHASE.COMBAT) : PHASE.PREP;
  const round = battle ? battle.round : state.round;
  const lp = battle ? battle.lpBefore : state.lp;
  // the leaks of the replay so far come off the tower as they happen (the original's live −N), the settled loss at the end
  const pending = battle ? Math.min(lp, battle.done ? battle.lpLost : Math.min(battle.lpLost, battle.leaked || 0)) : 0;
  // the official 🔍 pair: 本局信息 / 敌方情报 on the left (the drawer), the pen of the next enemies on the right
  const btn = checkButtons({ pen, penAvail: !battle && enemies > 0, infoOpen: !!drawer });
  return html`<header class="gtop ix-top">
    <div class="gtop__left">
      <${Button} variant="danger" size="lg" square=${true} icon="exit" onClick=${onExit} aria-label="离开" title="离开（进度已保存）" class="gtop__exit tapx" />
      <div class="gtop__meta">${state.difficulty ? html`<${DifficultyTag} difficulty=${state.difficulty} size="sm" />` : null}</div>
    </div>
    <div class="gtop__center brackets">
      ${onDrawer ? html`<${Tooltip} text=${pen ? '返回阵地' : '本局信息与敌方情报'} placement="bottom">
        <${CheckBtn} sprite=${btn.left.sprite} cls=${cx('gtop__iconbtn', btn.left.back && 'is-back')} label=${pen ? '返回' : '本局信息'}
          chev=${btn.left.back ? '◀◀' : null} on=${!!drawer && !pen} onClick=${() => (pen ? onPen(false) : onDrawer(drawer ? null : 'info'))} testid="check-player" />
      <//>` : null}
      <div class="roundbox">
        <span class="roundbox__label">回合</span>
        <b class="roundbox__num num">${Math.min(round, state.roundLimit)}<small>/${state.roundLimit}</small></b>
      </div>
      <${PhaseCapsule} pub=${{ phase }} hud=${battle ? { killed: battle.killed ?? 0, total: battle.total ?? null, boss: battle.hud?.boss ?? null, dp: battle.hud?.dp ?? null } : null} />
      <${LpTower} value=${lp} size="lg" tone=${lp <= 5 ? 'danger' : null} pending=${pending} tip="防线生命：敌人突破防线会扣除" />
      ${onPen ? html`<${Tooltip} text=${btn.right.grey && !pen ? '休整期可以查看即将迎击的敌方单位' : pen ? '返回阵地' : `查看下一轮的 ${enemies} 名敌人`} placement="bottom">
        <${CheckBtn} sprite=${btn.right.sprite} cls=${cx('enemybtn', btn.right.grey && 'is-grey')} label=${pen ? '返回' : '敌方情报'}
          chev=${btn.right.grey ? null : '▶▶'} disabled=${btn.right.grey && !pen} onClick=${() => (pen ? onPen(false) : !battle && enemies ? onPen(true) : null)} testid="ix-pen" />
      <//>` : null}
    </div>
    <div class="gtop__right">
      ${!battle && state.phase === 'prep' ? html`<div class="readywrap">
        <${Tooltip} text=${readyReason || '开始本轮战斗 · Space'} placement="bottom">
          <button type="button" class=${cx('readybtn', 'tapx', busy && 'is-busy')} disabled=${!!readyReason || busy} onClick=${onReady} data-testid="ix-ready">
            <span class="readybtn__box"></span><span class="readybtn__label">开始战斗</span><kbd class="readybtn__key">Space</kbd>
          </button>
        <//>
        ${readyReason ? html`<span class="readywrap__why" role="status" data-testid="ready-why"><${Icon} name="warn" /><span>${readyReason}</span></span>` : null}
      </div>` : null}
    </div>
  </header>`;
}

// ---- left: inventory strip + production -----------------------------------------------------------------------------

/**
 * The stock laid out as tiles, one per item and grade (the stock holds catalog.rules.inventoryCapacity of them). Drag a
 * tile onto an operator — on the board, in the bench or in the overflow list — and it is worn (a badge stack goes on
 * whole; a supply is used on that operator); a tap shows the item's card. The target is the piece on the tile under
 * the pointer (view.pieceAtClient), or a DOM element carrying data-piece-uid.
 */
export function InventoryStrip({ stacks, state, view, catalog, onOpen, onTap, onDrop }) {
  const [drag, setDrag] = useState(null); // { stack, x, y, uid }
  const capacity = catalog.rules?.inventoryCapacity ?? 20;
  const tiles = stacks.filter((s) => s.kind !== '奖品').length;
  const targetAt = (x, y) => {
    const dom = document.elementFromPoint(x, y)?.closest?.('[data-piece-uid]');
    if (dom) return dom.dataset.pieceUid;
    const hit = view?.pieceAtClient?.(x, y);
    return hit ? pieceByNum(state, hit.uid)?.uid ?? null : null;
  };
  const press = (e, s) => {
    if (e.button !== 0) return;
    const el = e.currentTarget; const x0 = e.clientX; const y0 = e.clientY; let moving = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moving = true;
      setDrag({ stack: s, x: ev.clientX, y: ev.clientY, uid: targetAt(ev.clientX, ev.clientY) });
    };
    const finish = (ev, cancelled) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
      setDrag(null);
      if (!moving) { if (!cancelled) onTap(s); return; }
      const uid = cancelled ? null : targetAt(ev.clientX, ev.clientY);
      if (uid) onDrop(s, uid);
    };
    const up = (ev) => finish(ev, false); const cancel = (ev) => finish(ev, true);
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel);
  };
  const over = drag?.uid ? state.pieces.find((p) => p.uid === drag.uid) : null;
  return html`<div class="ix-strip" data-testid="ix-strip">
    <button type="button" class=${cx('ix-strip__head', tiles >= capacity && 'is-full')} onClick=${onOpen} title="打开装备库存">
      <${MicroLabel}>库存<//><b class="num">${tiles}/${capacity}</b>
    </button>
    <div class="ix-strip__tiles">
      ${stacks.length ? stacks.map((s) => html`<button type="button" key=${s.key} data-testid=${`ix-tile-${s.key}`} class=${cx('ix-strip__slot', drag?.stack.key === s.key && 'is-dragging')}
          onPointerDown=${(e) => press(e, s)} aria-label=${`${s.name} ×${s.count}，拖到干员身上${s.used ? '使用' : '穿戴'}`}>
          <${GearIcon} id=${s.id} catalog=${catalog} plain=${!!drag} /><b class="num">${s.count}</b>
        </button>`) : html`<span class="ix-strip__empty">暂无库存</span>`}
    </div>
    ${drag ? html`<div class="ix-ghost" style=${{ transform: `translate(${Math.round(drag.x)}px, ${Math.round(drag.y)}px)` }} aria-hidden="true">
      <${GearIcon} id=${drag.stack.id} catalog=${catalog} plain=${true} />
      <span>${over ? `${drag.stack.used ? '用在' : '穿给'}${formEntry(catalog, over)?.name || ''}${drag.stack.badge && drag.stack.count > 1 ? ` ×${drag.stack.count}` : ''}` : '拖到干员身上'}</span>
    </div>` : null}
  </div>`;
}

function SourceName({ piece, catalog }) {
  if (!piece) return html`<span class="ix-prod__src">已离队</span>`;
  const entry = formEntry(catalog, piece);
  return html`<span class="ix-prod__src"><${UnitThumb} kind="chess" id=${renderChessId(catalog, piece)} golden=${!!piece.elite} size="xs" showTier=${false} />${entry?.name || ''}</span>`;
}

const ORIGIN_WORD = { prize: '工程部特供', supply: '补给', shop: '商店' };
const PHASE_WORD = { battle: '战后', roundStart: '休整开始', prepEnd: '休整结束', gain: '获得时', prize: '特供', supply: '补给', sold: '售出时', refresh: '刷新后', shop: '购买' };

function ProdRow({ row, state, catalog, when = false }) {
  const piece = row.sourceUid ? state.pieces.find((p) => p.uid === row.sourceUid) : null;
  return html`<li class=${cx('ix-prod__row', row.lost && 'is-lost')}>
    ${when ? html`<span class="ix-prod__when">${PHASE_WORD[row.phase] || ''}</span>` : null}
    ${row.sourceUid ? html`<${SourceName} piece=${piece} catalog=${catalog} />`
      : html`<span class="ix-prod__src">${row.prizeId ? (catalog.prizes?.[row.prizeId]?.name || '工程部特供') : ORIGIN_WORD[row.origin] || '其他'}</span>`}
    ${row.id === 'badges' ? html`<span class="ix-prod__out"><span>全部徽章</span><b class="num">×${row.quantity}</b></span>`
      : html`<span class="ix-prod__out"><${GearIcon} id=${row.id} catalog=${catalog} /><b class="num">×${row.quantity}</b></span>`}
    ${row.worn ? html`<span class="ix-prod__tag" title="直接穿在干员身上">→${formEntry(catalog, state.pieces.find((p) => p.uid === row.targetUid) || {})?.name || '干员'}</span>` : null}
    ${row.copied ? html`<span class="ix-prod__tag">复制</span>` : null}
    ${row.lost ? html`<span class="ix-prod__tag ix-prod__tag--lost" title="库存已满，没有放入">库存满</span>` : null}
  </li>`;
}

/**
 * How many lines the production column shows per page: the column runs from 2.02rem below the top to 5rem above the
 * bottom (css .ix-prod), a line is max(.32rem, 22px) tall, one line is kept for the pager. Follows resizes.
 */
function usePageLines() {
  const calc = () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100;
    return Math.max(4, Math.floor((innerHeight - rem * 7.4) / Math.max(rem * .32, 22)) - 1);
  };
  const [n, setN] = useState(calc);
  useEffect(() => { const on = () => setN(calc()); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  return n;
}

/**
 * 产出记录 (design: 产出栏; user 10-07: 「产出什么的默认收起来把，你要么就安排一个完整的log可折叠追溯」): folded at first.
 * Open, it lists what the coming 休整期结束 will forge (server forecast; pieces whose prep-end trait yields nothing now
 * are listed dim), then every round of the game, newest first: what came in, when and from whom (the shop's included),
 * and how its battle went. Each section folds on its heading; the forecast, this round and the last one start open.
 * A long list turns pages (‹ 1/2 ›) instead of scrolling inside the column; a section cut by a page break repeats its
 * heading on the next page, and a heading the player just folded or opened stays on the page shown.
 */
export function ProductionPanel({ state, catalog, onReport = null }) {
  const [open, setOpen] = useState(false);
  const [folds, setFolds] = useState({});                   // section key → folded, once the player toggled it
  const [at0, setAt] = useState({ page: 0, anchor: null }); // anchor: the heading just toggled
  const perPage = usePageLines();
  const byRound = new Map();
  for (const r of state.production || []) { if (!byRound.has(r.round)) byRound.set(r.round, []); byRound.get(r.round).push(r); }
  const battles = new Map((state.history || []).filter((h) => h.type === 'battle').map((h) => [h.round, h]));
  const rounds = [...new Set([...byRound.keys(), ...battles.keys(), ...(state.phase === 'prep' ? [state.round] : [])])].sort((x, y) => y - x);
  const sections = [];
  if (state.forecast) {
    const fc = forecastRows(state, catalog);
    sections.push({ key: 'forecast', title: '休整期结束时获得', lines: [
      ...fc.rows.map((r) => html`<${ProdRow} row=${r} state=${state} catalog=${catalog} />`),
      ...(fc.funds ? [html`<li class="ix-prod__row"><span class="ix-prod__src">下个休整期资金</span><span class="ix-prod__out"><${CoinGlyph} /><b class="num">+${fc.funds}</b></span></li>`] : []),
      ...(fc.rows.length || fc.funds ? [] : [html`<li class="ix-prod__none">暂无</li>`]),
      ...fc.idle.map((p) => html`<li class="ix-prod__row is-idle" title="现在开始战斗不会获得，点干员看特质条件"><${SourceName} piece=${p} catalog=${catalog} /><span>条件未满足</span></li>`),
    ] });
  }
  for (const n of rounds) {
    const fight = battles.get(n);
    const rows = groupProduction(byRound.get(n) || []);
    sections.push({ key: `r${n}`, title: `第${n}回合`, folded: n < state.round - 1,
      note: fight ? (fight.lpLost ? html`<span class="ix-prod__note is-hurt">防线 −${fight.lpLost}</span>` : html`<span class="ix-prod__note">防线完好</span>`) : null,
      lines: rows.length ? rows.map((r) => html`<${ProdRow} row=${r} state=${state} catalog=${catalog} when=${true} />`) : [html`<li class="ix-prod__none">没有产出</li>`] });
  }
  const pages = [[]];
  for (const sec of sections) {
    const folded = folds[sec.key] ?? !!sec.folded;
    let cur = pages[pages.length - 1];
    if (cur.length && cur.length + (folded ? 1 : 2) > perPage) { cur = []; pages.push(cur); } // a heading never ends a page
    cur.push({ head: sec, folded });
    if (folded) continue;
    for (const line of sec.lines) {
      if (cur.length >= perPage) { cur = [{ head: sec, folded, more: true }]; pages.push(cur); }
      cur.push({ line });
    }
  }
  let at = at0.anchor ? pages.findIndex((p) => p.some((x) => x.head?.key === at0.anchor && !x.more)) : at0.page;
  at = Math.max(0, Math.min(at, pages.length - 1));
  const toggle = (sec, folded) => { setFolds((f) => ({ ...f, [sec.key]: !folded })); setAt({ page: at, anchor: sec.key }); };
  return html`<aside class=${cx('ix-prod', !open && 'is-closed')} data-testid="ix-prod">
    <div class="ix-prod__tabs">
      <button type="button" class="ix-prod__toggle" onClick=${() => setOpen(!open)} aria-expanded=${open ? 'true' : 'false'} data-testid="ix-prod-toggle">
        <${Icon} name=${open ? 'chevronLeft' : 'chevronRight'} /><span>产出</span>
      </button>
      ${onReport && state.lastBattle ? html`<button type="button" class="ix-prod__toggle" onClick=${onReport} title="上一场的伤害与治疗" data-testid="ix-report">
        <${Icon} name="sword" /><span>战报</span></button>` : null}
    </div>
    ${open ? html`<div class="ix-prod__body">
      <ul class="ix-prod__list">${pages[at].map((x, i) => (x.head ? html`<li key=${`h${x.head.key}${i}`} class="ix-prod__h">
          <button type="button" class=${cx('ix-prod__fold', !x.folded && 'is-open')} aria-expanded=${x.folded ? 'false' : 'true'}
            onClick=${() => toggle(x.head, x.folded)} data-testid=${`ix-prod-${x.head.key}`}>
            <${Icon} name="chevronRight" /><span>${x.head.title}${x.more ? '（续）' : ''}</span>${x.head.note}</button></li>`
        : html`<${Fragment} key=${i}>${x.line}<//>`))}</ul>
      ${pages.length > 1 ? html`<div class="ix-prod__pager">
        <button type="button" disabled=${at === 0} onClick=${() => setAt({ page: at - 1, anchor: null })} aria-label="上一页"><${Icon} name="chevronLeft" /></button>
        <span class="num">${at + 1}/${pages.length}</span>
        <button type="button" disabled=${at === pages.length - 1} onClick=${() => setAt({ page: at + 1, anchor: null })} aria-label="下一页"><${Icon} name="chevronRight" /></button>
      </div>` : null}
    </div>` : null}
  </aside>`;
}

// ---- effects column -------------------------------------------------------------------------------------------------

const EFFECT_LINE = {
  facilityIncome: (e) => `每个休整期资金 +${e.amount}`,
  deployCap: (e) => `部署上限 +${e.amount}`,
  repeatNativeForging: () => '本轮有效',
  futureShopEquipment: (e) => `还剩 ${e.quantity ?? 0} 件`,
  // 2026-10-07: game-long badge boosts (伊内丝) and shop buffs (蒂比, 阿罗玛)
  badgeBoost: (e) => `本局效果 +${Math.round(e.percent * 100)}%（至多 +${Math.round(e.max * 100)}%）`,
  shopCarry: (e) => `商店里的每名干员附带 ${e.quantity} 枚（至多 ${e.max} 枚）`,
};
const EFFECT_COUNT = { facilityIncome: (e) => `+${e.amount}`, deployCap: (e) => `+${e.amount}`, futureShopEquipment: (e) => e.quantity,
  badgeBoost: (e) => `+${Math.round(e.percent * 100)}%`, shopCarry: (e) => `×${e.quantity}` };
/** The item an effect is about: its source gear, or the badge a boost / shop buff concerns. */
const effectItem = (e) => (e.type === 'badgeBoost' ? e.badgeIds?.[0] : e.type === 'shopCarry' ? e.id : e.source);

/**
 * The original's 生效中的效果 column (ui/effectsList.js, css .gm__effects / .effects) for the mode's lasting effects
 * (state.playerEffects: a facility's income, a raised deploy cap, an extra forging this round …): the source's icon
 * with its number, the source's name, what it does now and its full text in the tooltip.
 */
export function EffectsColumn({ effects, catalog }) {
  const list = (effects || []).filter((e) => e && EFFECT_LINE[e.type]);
  if (!list.length) return null;
  return html`<div class="gm__effects ix-effects"><div class="effects" aria-label="生效中的效果">
    <${MicroLabel}>EFFECTS<//>
    ${list.slice(0, 10).map((e, i) => {
      const prize = catalog.prizes?.[e.source]; const gear = catalog.gear?.[effectItem(e)];
      const name = e.type === 'badgeBoost' ? `${gear?.name || '徽章'}增幅` : e.type === 'shopCarry' ? `商品附带${gear?.name || '徽章'}` : prize?.name || gear?.name || '效果';
      const text = prize?.effect || (gear && !['badgeBoost', 'shopCarry'].includes(e.type) ? gear.normal : '');
      const n = EFFECT_COUNT[e.type]?.(e);
      return html`<${Tooltip} key=${`${e.type}:${e.source}:${i}`} placement="bottom" text=${html`<div class="efftip">
          <b>${name}</b><span class="efftip__kind">${EFFECT_LINE[e.type](e)}</span>
          ${text ? html`<p><${GameText} text=${text} catalog=${catalog} /></p>` : null}
        </div>`}>
        <span class="effect effect--item">
          ${gear ? html`<${GearIcon} id=${effectItem(e)} catalog=${catalog} plain=${true} />` : html`<${GIcon} name="flag" />`}
          ${n != null && n !== '' ? html`<b class="effect__n num">${n}</b>` : null}
        </span>
      <//>`;
    })}
  </div></div>`;
}

// ---- shop bar -----------------------------------------------------------------------------------------------------

const copiesNeeded = (op) => ((op?.summary || []).some((s) => s.kind === 'merge') ? 2 : 3);

/**
 * Where buying `chessId` sends the elite it completes (the original's 可晋升 hint, ui/shopBar.js mergeHint), null when
 * the buy completes no merge. The session keeps the first copy that stands on the field (in uid order), else the
 * oldest copy: `tile` is that field tile, lit gold while the card is armed.
 */
export function mergeHintOf(state, catalog, chessId) {
  const op = catalog.operators?.[chessId];
  if (!op?.eliteChessId) return null;
  const copies = (state.pieces || []).filter((p) => p.chessId === chessId && !p.elite);
  if (copies.length + 1 < copiesNeeded(op)) return null;
  const fielded = copies.filter(isDeployed).sort((a, b) => a.uid.localeCompare(b.uid))[0];
  return fielded ? { text: '精锐干员将出现在作战区原位置', tile: { row: fielded.row, col: fielded.col } } : { text: '精锐干员将进入整备区', tile: null };
}

function ShopCard({ slot, idx, state, catalog, armed, reason, onTap, onDetail }) {
  const op = catalog.operators[slot.id] || {};
  const c = data.lookup('chess', slot.id);
  const m = data.get('assets');
  const carried = slot.equipment || [];
  const hint = mergeHintOf(state, catalog, slot.id);
  // the skill it fights with when bought (the default one: the choice is made per operator afterwards) and its factions
  const lo = c ? chessLoadout(c, null, (id) => data.lookup('chess', id)) : null;
  const factions = (c?.bonds || []).filter((b) => TAVERN_FACTIONS[b]);
  const card = html`<button type="button" class=${cx('scard', `scard--t${op.tier || 1}`, state.shop.frozen && 'is-frozen', reason && 'is-disabled', hint && 'is-merge', armed && 'is-armed')}
      onClick=${() => onTap(idx)} onContextMenu=${(e) => { e.preventDefault(); onDetail?.(idx); }}
      data-testid=${`ix-shop-${idx}`} aria-label=${`${op.name || '干员'}${armed ? (reason ? '，无法购买' : '，再次点击确认') : ''}`} aria-pressed=${String(!!armed)}>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__water" aria-hidden="true">${factions[0] ? html`<${BondGlyph} bondId=${factions[0]} />` : null}</span>
    <${Img} src=${chessPortraitUrl(m, c)} class="scard__art" />
    <span class="scard__top">
      <${TierChip} tier=${op.tier || 1} size="md" />
      ${lo?.skill ? html`<${SkillBadge} chess=${c} lo=${lo} />` : null}
    </span>
    <span class="scard__body">
      <span class="scard__name">${op.name || slot.id}</span>
      ${factions.length ? html`<span class="scard__bonds">${factions.slice(0, 3).map((b) => html`<span key=${b} class="scard__bond"><${BondGlyph} bondId=${b} /><span>${TAVERN_FACTIONS[b]}</span></span>`)}</span>` : null}
    </span>
    ${carried.length ? html`<span class="ix-carry" title="随商品附带，刷新会丢失">${carried.slice(0, 3).map((it, i) => html`<span key=${i}><${GearIcon} id=${it.id} catalog=${catalog} /><b class="num">${it.quantity || 1}</b></span>`)}</span>` : null}
    ${hint ? html`<span class="scard__mergetag" title=${hint.text}>可晋升</span>` : null}
    ${state.shop.frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${armed ? html`<span class=${cx('scard__confirm', reason && 'is-no')} role="status">${reason ? html`<b>无法购买</b><small>${reason}</small>` : html`<b>确认购买</b><small>再次点击</small>`}</span>` : null}
  </button>`;
  return reason && !armed ? html`<${Tooltip} text=${reason} block=${true} class="scard-wrap">${card}<//>` : card;
}

function GearCard({ slot, idx, state, catalog, armed, reason, onTap, onDetail }) {
  const g = catalog.gear[slot.id] || {};
  return html`<button type="button" class=${cx('scard', 'scard--item', state.shop.frozen && 'is-frozen', reason && 'is-disabled', armed && 'is-armed')}
      onClick=${() => onTap(idx)} onContextMenu=${(e) => { e.preventDefault(); onDetail?.(idx); }} data-testid=${`ix-shop-${idx}`} aria-label=${`${g.name || '装备'}，价格 ${slot.price}`}>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__top">
      ${g.kind === 'badge' || g.kind === '徽章' ? html`<span class="ix-lv">徽章</span>` : html`<span class="ix-lv num">${g.level ?? 1}级</span>`}
      <${HexBadge} value=${slot.price} tone=${reason === '资金不足' ? 'dark' : 'gold'} size="md" class="scard__price" />
    </span>
    <span class="scard__itemart"><${GearIcon} id=${slot.id} catalog=${catalog} /></span>
    <span class="scard__body">
      <span class="scard__name">${g.name || slot.id}</span>
      <span class="scard__idesc"><${GameText} text=${g.normal} catalog=${catalog} /></span>
    </span>
    ${state.shop.frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${armed ? html`<span class=${cx('scard__confirm', reason && 'is-no')} role="status">${reason ? html`<b>无法购买</b><small>${reason}</small>` : html`<b>确认购买</b><small>再次点击</small>`}</span>` : null}
  </button>`;
}

function SoldCard({ item }) {
  return html`<div class=${cx('scard', 'scard--sold', item && 'scard--item')} aria-label="已售出">
    <span class="scard__soldtxt"><${MicroLabel}>SOLD OUT<//><span>${item ? '已购买' : '已招募'}</span></span>
  </div>`;
}

/**
 * The 调度中心 bar: level card, operator and gear goods, funds, refresh / freeze. A card takes two taps like the
 * original (the first one also opens its detail card); a right-click (a long press on touch) only opens the card. The
 * reasons a tap cannot buy come from the state only. 收起 folds it to the original's tab (funds + 展开商店) so the
 * field behind it can be seen.
 */
export function ShopBar({ state, catalog, busy, armed, onArm, onBuy, onUpgrade, onRefresh, onFreeze, onDetail, deployed, deployCap, collapsed = false, onCollapse }) {
  const shop = state.shop;
  const price = catalog.rules?.refreshPrice ?? 1;
  const free = shop.freeRefreshes || 0;
  const reasonFor = (s) => (s.sold ? '已售出' : state.funds < s.price ? '资金不足' : null);
  const tap = (i) => {
    const s = shop.slots[i];
    if (!s || s.sold || busy) return;
    if (armed === `s${i}`) { if (!reasonFor(s)) onBuy(i); return; }
    onArm(`s${i}`, s);
  };
  const lvMax = shop.level >= 6;
  const lvReason = lvMax ? '调度中心已达最高等级' : state.funds < shop.upgradePrice ? '资金不足' : null;
  const chess = shop.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'chess');
  const gear = shop.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'chess');
  if (collapsed) {
    return html`<div class="shopbar-tab ix-shoptab" data-testid="ix-shop-tab">
      <div class="shopbar-tab__funds"><${CoinGlyph} /><b class="num">${state.funds}</b></div>
      <button type="button" class="shopbar-tab__btn" onClick=${() => onCollapse(false)}><${Icon} name="chevronLeft" />展开商店</button>
    </div>`;
  }
  return html`<section class=${cx('shopbar', 'ix-shop', shop.frozen && 'is-frozen', armed && 'has-armed')} aria-label="调度中心" data-testid="ix-shop">
    <div class="shopbar__tools">
      <span class="shopbar__remain">场上干员：<b class=${cx('num', deployed >= deployCap && 't-orange')}>${deployed}</b>/<span class="num">${deployCap}</span></span>
      <button type="button" class=${cx('toolbtn', 'toolbtn--ice', shop.frozen && 'is-on')} disabled=${busy} onClick=${onFreeze}
        title=${shop.frozen ? '解冻商店 · F' : '冻结商店（下回合保留当前商品） · F'}>
        <${Img} src=${uiUrl(data.get('assets'), shop.frozen ? 'shopPanel/frozen_icon2' : 'shopPanel/frozen_icon')} class="toolbtn__img" fallback=${html`<${Icon} name="snow" />`} />
        <span>${shop.frozen ? '解冻' : '冻结'}</span><kbd>F</kbd>
      </button>
      <button type="button" class="toolbtn toolbtn--amber" disabled=${busy || (!free && state.funds < price)} onClick=${onRefresh} title="刷新商店 · R">
        <${Img} src=${uiUrl(data.get('assets'), 'shopPanel/refresh_icon')} class="toolbtn__img" fallback=${html`<${Icon} name="refresh" />`} />
        <span>刷新</span>
        ${free > 0 ? html`<span class="toolbtn__free">免费 ×${free}</span>` : html`<${HexBadge} value=${price} tone=${state.funds < price ? 'dark' : 'gold'} size="sm" />`}
        <kbd>R</kbd>
      </button>
    </div>
    <div class="shopbar__row">
      <button type="button" class=${cx('lvcard', lvMax && 'is-max', lvReason && 'is-disabled', armed === 'lv' && 'is-armed')} data-testid="ix-upgrade"
          onClick=${() => { if (lvReason || busy) return; if (armed === 'lv') onUpgrade(); else onArm('lv', null); }}
          title=${lvReason || `升级调度中心（${shop.upgradePrice} 资金） · D`}>
        ${!lvMax ? html`<${HexBadge} value=${shop.upgradePrice} tone=${lvReason === '资金不足' ? 'dark' : 'gold'} size="md" class="lvcard__price" />` : null}
        <span class="lvcard__frame"><span class="lvcard__micro">LEVEL</span><b class="lvcard__num num">${shop.level}</b></span>
        <span class="lvcard__label">${lvMax ? '已满级' : armed === 'lv' ? '确认升级' : '升级'}</span>
        <kbd class="lvcard__key">D</kbd>
      </button>
      <div class="shopbar__cards">
        ${chess.map(({ s, i }) => (s.sold ? html`<${SoldCard} key=${`s${i}`} />`
          : html`<${ShopCard} key=${`c${i}:${s.id}`} slot=${s} idx=${i} state=${state} catalog=${catalog} armed=${armed === `s${i}`} reason=${reasonFor(s)} onTap=${tap} onDetail=${onDetail} />`))}
      </div>
      ${gear.length ? html`<div class="shopbar__item">
        ${gear.map(({ s, i }) => (s.sold ? html`<${SoldCard} key=${`g${i}`} item=${true} />`
          : html`<${GearCard} key=${`g${i}:${s.id}`} slot=${s} idx=${i} state=${state} catalog=${catalog} armed=${armed === `s${i}`} reason=${reasonFor(s)} onTap=${tap} onDetail=${onDetail} />`))}
      </div>` : null /* the shop sells operators only; an equipment place survives only in a shop saved before that */}
      <div class="funds">
        <div class="funds__hex"><${CoinGlyph} class="funds__coin" /><b class="funds__num num" data-testid="ix-funds">${state.funds}</b></div>
        <span class="funds__label">采购资金</span>
        ${onCollapse ? html`<button type="button" class="funds__collapse" onClick=${() => onCollapse(true)}><${Icon} name="close" />收起</button>` : null}
      </div>
    </div>
  </section>`;
}

// ---- unit plates and bench overflow -------------------------------------------------------------------------------

/**
 * The equipment level chip under every own unit (design: 常驻装备总等级), plus markers for attachments and a worn
 * 交接凭证. Positions follow the renderer every frame (camera moves, drags, resizes).
 */
export function UnitBadges({ view, pieces, catalog, hidden }) {
  const boxRef = useRef(null);
  useEffect(() => {
    if (!view || hidden) return undefined;
    let raf = 0;
    const place = () => {
      const box = boxRef.current;
      if (box) {
        for (const el of box.children) {
          const r = view.pieceScreenRect?.(Number(el.dataset.n));
          if (!r) { el.style.visibility = 'hidden'; continue; }
          el.style.visibility = '';
          el.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.bottom)}px) translate(-50%, -30%)`;
        }
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [view, hidden]);
  if (hidden) return null;
  return html`<div class="ix-badges" ref=${boxRef} aria-hidden="true">
    ${pieces.map((p) => html`<span key=${p.uid} class="ix-badge" data-n=${String(p.uid).replace(/^\D+/, '')}>
        <b class="num">${p.equipmentLevel ?? 0}</b><small>级</small>
        ${p.attachments?.length ? html`<i class="ix-badge__att" title="外来附加效果"></i>` : null}
        ${permitsOf(p, catalog).length ? html`<i class="ix-badge__perm" title="携带交接凭证"></i>` : null}
      </span>`)}
  </div>`;
}

/** Bench pieces beyond the renderer's 10 hand pads. */
export function BenchOverflow({ pieces, catalog, onPick }) {
  if (!pieces.length) return null;
  return html`<div class="ix-overflow" data-testid="ix-overflow">
    <span class="ix-overflow__label">整备区另有 <b class="num">${pieces.length}</b> 名</span>
    ${pieces.map((p) => html`<button type="button" key=${p.uid} class="ix-overflow__item" data-piece-uid=${p.uid} onClick=${() => onPick(p.uid)} title=${formEntry(catalog, p)?.name || ''}>
      <${UnitThumb} kind="chess" id=${renderChessId(catalog, p)} golden=${!!p.elite} size="sm" />
      <span class="num">${p.equipmentLevel ?? 0}级</span>
    </button>`)}
  </div>`;
}

export const deployedCount = (state) => (state.pieces || []).filter(isDeployed).length;

/**
 * The 本局信息 tab of the original's drawer (ui/enemyDrawer.js `info`) for this mode: where and what is played — the
 * field, the mode, the rounds of 工程部特供 and of the enemy leader — and the run's levels.
 */
export function MatchInfo({ state, catalog }) {
  const stage = state.board?.stageId ? data.lookup('stages', state.board.stageId) : null;
  const mode = (catalog.modes || []).find((m) => m.roundLimit === state.roundLimit) || null;
  const boss = state.board?.bossId ? data.lookup('bosses', state.board.bossId) : null;
  const prizeRounds = state.roundLimit === 9 ? [4, 8] : [4, 8, 12];
  return html`<div class="edrawer__body ix-minfo">
    ${stage ? html`<p class="istage"><${Icon} name="rook" />战场：<b>${stage.name || stage.id}</b></p>` : null}
    <p class="istage"><${Icon} name="info" />模式：<b>${mode?.name || ''}</b>${state.difficulty ? html`<${DifficultyTag} difficulty=${state.difficulty} size="sm" />` : null}
      <span class="t-lo">第 <b class="num">${Math.min(state.round, state.roundLimit)}</b>/<span class="num">${state.roundLimit}</span> 回合</span></p>
    <p class="istage"><${GIcon} name="flag" />工程部特供：第 ${prizeRounds.join('、')} 轮</p>
    ${Array.isArray(state.openFactions) ? html`<p class="istage" data-testid="open-factions"><${Icon} name="sword" />本局阵营：<b>${state.openFactions.join('、')}</b><span class="t-lo">（其余阵营的干员本局不出现）</span></p>` : null}
    ${boss ? html`<div class="eboss"><${UnitThumb} kind="enemy" id=${boss.enemyKey} size="md" />
      <div><${MicroLabel} tone="gold">ENEMY LEADER // 敌方领袖</${MicroLabel}><b>${boss.name}</b><span class="t-lo">第 ${state.board?.bossRound ?? state.roundLimit} 回合 · 最终攻势</span></div></div>` : null}
    <p class="istage"><${Icon} name="user" />调度中心 <b class="num">${state.shop?.level ?? 1}</b> 级 · 部署上限 <b class="num">${state.deployCap}</b> 名 · 防线生命 <b class="num">${state.lp}</b></p>
  </div>`;
}
