// 卫戍协议：工坊 HUD on the original game screen's frame (css/screens/game*.css classes: gtop, roundbox, capsule,
// shopbar, scard, lvcard, funds) with the independent mode's own data. Default layer only (docs/independent-mode/
// frontend-design.md 信息分层): numbers that decide the current step; full texts open in the detail card.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, HexBadge, TierChip, Tooltip, MicroLabel, DifficultyTag } from '../ui/components.js';
import { Img, BondGlyph, CoinGlyph, GIcon, LpTower, ItemIcon, UnitThumb } from '../ui/gameComponents.js';
import { PhaseCapsule } from '../ui/hud.js';
import { chessPortraitUrl, profIconUrl, uiUrl } from '../ui/assetUrls.js';
import { PHASE } from '../../../shared/constants.js';
import { data } from '../data.js';
import { formEntry, isDeployed, summaryCount, forecastRows, groupProduction, renderChessId } from './model.js';
import { GearIcon, GameText } from './text.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// ---- glyphs -------------------------------------------------------------------------------------------------------

const KIND_WORD = { recruit: '招募', random: '随机', stat: '属性', damage: '增伤', copy: '复制', merge: '两份合成', shopBadge: '商品携装' };

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
      ${e.kind === 'stat' && e.items ? e.items.map((it, k) => html`<span class="ix-trait__out" key=${k}><${GearIcon} id=${it.id} catalog=${catalog} /></span>`) : null}
      ${KIND_WORD[e.kind] ? html`<span class="ix-trait__word">${KIND_WORD[e.kind]}</span>` : null}
      ${e.faction ? html`<span class="ix-trait__cond" title=${`需要${e.faction}干员在场`}>${e.faction}</span>` : null}
      ${e.perBattle ? html`<span class="ix-trait__cond" title="每场上限">≤${e.perBattle}</span>` : null}
      ${e.afterBattle ? html`<span class="ix-trait__cond" title="战斗结束后放入库存">战后</span>` : null}
    </span>`)}
    ${(summary || []).length > max ? html`<span class="ix-trait__more">+${summary.length - max}</span>` : null}
  </span>`;
}

// ---- top bar ------------------------------------------------------------------------------------------------------

/** Round / phase / LP / ready, on the original top bar's frame. `battle` = the replay on screen (or null). */
export function TopBar({ state, battle, busy, onExit, onReady, readyReason, pen = false, onPen = null }) {
  const enemies = (state.nextEnemies || []).reduce((n, e) => n + Number(e.count || 0), 0);
  const phase = battle ? PHASE.COMBAT : PHASE.PREP;
  const round = battle ? battle.round : state.round;
  const lp = battle ? battle.lpBefore : state.lp;
  const pending = battle && battle.done ? battle.lpLost : 0;
  return html`<header class="gtop ix-top">
    <div class="gtop__left">
      <${Button} variant="danger" size="lg" square=${true} icon="exit" onClick=${onExit} aria-label="离开" title="离开（进度已保存）" class="gtop__exit tapx" />
      <div class="gtop__meta">${state.difficulty ? html`<${DifficultyTag} difficulty=${state.difficulty} size="sm" />` : null}</div>
    </div>
    <div class="gtop__center brackets">
      <div class="roundbox">
        <span class="roundbox__label">回合</span>
        <b class="roundbox__num num">${Math.min(round, state.roundLimit)}<small>/${state.roundLimit}</small></b>
      </div>
      <${PhaseCapsule} pub=${{ phase }} hud=${battle ? { killed: battle.killed ?? 0, total: battle.total ?? null } : null} />
      <${LpTower} value=${lp} size="lg" tone=${lp <= 5 ? 'danger' : null} pending=${pending} tip="防线生命：敌人突破防线会扣除" />
      ${!battle && onPen && enemies ? html`<button type="button" class=${cx('ix-penbtn', pen && 'is-on')} onClick=${onPen} data-testid="ix-pen"
        title=${pen ? '返回阵地' : '查看下一轮敌人'}>${pen ? '返回阵地' : html`敌情 <b class="num">${enemies}</b>`}</button>` : null}
    </div>
    <div class="gtop__right">
      ${!battle && state.phase === 'prep' ? html`<div class="readywrap">
        <${Tooltip} text=${readyReason || '开始本轮战斗 · Space'} placement="bottom">
          <button type="button" class=${cx('readybtn', 'tapx', busy && 'is-busy')} disabled=${!!readyReason || busy} onClick=${onReady} data-testid="ix-ready">
            <span class="readybtn__box"></span><span class="readybtn__label">开始战斗</span><kbd class="readybtn__key">Space</kbd>
          </button>
        <//>
      </div>` : null}
    </div>
  </header>`;
}

// ---- left: inventory strip + production -----------------------------------------------------------------------------

/** Inventory at a glance (the bond strip's place): every stack's icon and count; a tap opens the inventory. */
export function InventoryStrip({ stacks, total, catalog, onOpen, armedKey, onArm }) {
  return html`<div class="ix-strip" data-testid="ix-strip">
    <button type="button" class="ix-strip__head" onClick=${onOpen} title="打开装备库存">
      <${MicroLabel}>库存<//><b class="num">${total}</b>
    </button>
    ${stacks.length ? stacks.slice(0, 10).map((s) => html`<button type="button" key=${s.key} class=${cx('ix-strip__slot', armedKey === s.key && 'is-armed')}
        onClick=${() => onArm(s)} aria-label=${`${s.name} ×${s.count}`}>
        <${GearIcon} id=${s.id} catalog=${catalog} /><b class="num">${s.count}</b>
      </button>`) : html`<span class="ix-strip__empty">暂无库存</span>`}
    ${stacks.length > 10 ? html`<button type="button" class="ix-strip__more" onClick=${onOpen}>+${stacks.length - 10}</button>` : null}
  </div>`;
}

function SourceName({ piece, catalog }) {
  if (!piece) return html`<span class="ix-prod__src">已离队</span>`;
  const entry = formEntry(catalog, piece);
  return html`<span class="ix-prod__src"><${UnitThumb} kind="chess" id=${renderChessId(catalog, piece)} golden=${!!piece.elite} size="xs" showTier=${false} />${entry?.name || ''}</span>`;
}

const ORIGIN_WORD = { prize: '工程部特供', supply: '补给', shop: '商店' };
const PHASE_WORD = { battle: '战后', roundStart: '休整开始', prepEnd: '休整结束', gain: '获得时', prize: '特供', supply: '补给', sold: '售出时', refresh: '刷新后' };

function ProdRow({ row, state, catalog, when = false }) {
  const piece = row.sourceUid ? state.pieces.find((p) => p.uid === row.sourceUid) : null;
  return html`<li class="ix-prod__row">
    ${when ? html`<span class="ix-prod__when">${PHASE_WORD[row.phase] || ''}</span>` : null}
    ${row.sourceUid ? html`<${SourceName} piece=${piece} catalog=${catalog} />`
      : html`<span class="ix-prod__src">${row.prizeId ? (catalog.prizes?.[row.prizeId]?.name || '工程部特供') : ORIGIN_WORD[row.origin] || '其他'}</span>`}
    <span class="ix-prod__out"><${GearIcon} id=${row.id} catalog=${catalog} /><b class="num">×${row.quantity}</b></span>
    ${row.copied ? html`<span class="ix-prod__tag">复制</span>` : null}
  </li>`;
}

/**
 * What the coming 休整期结束 will forge (server forecast) and what came in since the last battle began — the answer to
 * "where did this come from" (design: 产出栏). Pieces with a prep-end trait that yields nothing now are listed dim.
 */
export function ProductionPanel({ state, catalog, sinceRevision }) {
  const [open, setOpen] = useState(true);
  const fc = forecastRows(state, catalog);
  // the last ready wrote one revision: its prep-end forging, the battle's rewards and this round's start; later actions wrote the rest
  const rows = (state.production || []).filter((r) => r.revision > sinceRevision && r.origin !== 'shop');
  const battleRows = groupProduction(rows.filter((r) => r.revision === sinceRevision + 1));
  const otherRows = groupProduction(rows.filter((r) => r.revision > sinceRevision + 1));
  return html`<aside class=${cx('ix-prod', !open && 'is-closed')} data-testid="ix-prod">
    <button type="button" class="ix-prod__toggle" onClick=${() => setOpen(!open)}>
      <${Icon} name=${open ? 'chevronLeft' : 'chevronRight'} /><span>${open ? '产出' : '产出'}</span>
    </button>
    ${open ? html`<div class="ix-prod__body">
      <section>
        <h3>休整期结束时获得</h3>
        ${fc.rows.length || fc.funds ? html`<ul>
          ${fc.rows.map((r, i) => html`<${ProdRow} key=${i} row=${r} state=${state} catalog=${catalog} />`)}
          ${fc.funds ? html`<li class="ix-prod__row"><span class="ix-prod__src">下个休整期资金</span><span class="ix-prod__out"><${CoinGlyph} /><b class="num">+${fc.funds}</b></span></li>` : null}
        </ul>` : html`<p class="ix-prod__none">暂无</p>`}
        ${fc.idle.length ? html`<ul class="ix-prod__idle">${fc.idle.map((p) => html`<li key=${p.uid} class="ix-prod__row is-idle" title="现在开始战斗不会获得，点干员看特质条件">
          <${SourceName} piece=${p} catalog=${catalog} /><span>条件未满足</span></li>`)}</ul>` : null}
      </section>
      ${battleRows.length ? html`<section><h3>上一轮结算</h3><ul>${battleRows.map((r, i) => html`<${ProdRow} key=${i} row=${r} state=${state} catalog=${catalog} when=${true} />`)}</ul></section>` : null}
      ${otherRows.length ? html`<section><h3>本轮获得</h3><ul>${otherRows.map((r, i) => html`<${ProdRow} key=${i} row=${r} state=${state} catalog=${catalog} when=${true} />`)}</ul></section>` : null}
    </div>` : null}
  </aside>`;
}

// ---- shop bar -----------------------------------------------------------------------------------------------------

function copiesOwned(state, chessId) {
  return (state.pieces || []).filter((p) => p.chessId === chessId && !p.elite).length;
}

function ShopCard({ slot, idx, state, catalog, armed, reason, onTap }) {
  const op = catalog.operators[slot.id] || {};
  const c = data.lookup('chess', slot.id);
  const m = data.get('assets');
  const need = (op.summary || []).some((s) => s.kind === 'merge') ? 2 : 3;
  const owned = copiesOwned(state, slot.id);
  const carried = slot.equipment || [];
  return html`<button type="button" class=${cx('scard', `scard--t${op.tier || 1}`, state.shop.frozen && 'is-frozen', reason && 'is-disabled', owned + 1 >= need && 'is-merge', armed && 'is-armed')}
      onClick=${() => onTap(idx)} data-testid=${`ix-shop-${idx}`} aria-label=${`${op.name || '干员'}，价格 ${slot.price}`}>
    <span class="scard__bg" aria-hidden="true"></span>
    <${Img} src=${chessPortraitUrl(m, c)} class="scard__art" />
    <span class="scard__top">
      <${TierChip} tier=${op.tier || 1} size="md" />
      <${HexBadge} value=${slot.price} tone=${reason === '资金不足' ? 'dark' : 'gold'} size="md" class=${cx('scard__price', reason === '资金不足' && 'is-poor')} />
      ${owned > 0 ? html`<span class="scard__pips" title=${`已拥有 ${owned}/${need}`}>
        ${Array.from({ length: need }, (_, i) => html`<i key=${i} class=${i < owned ? 'on' : ''}></i>`)}</span>` : null}
    </span>
    <span class="scard__body">
      <span class="scard__name">${op.name || slot.id}</span>
      <${TraitGlyphs} summary=${op.summary} catalog=${catalog} class="scard__trait" />
      <span class="scard__class">
        <${Img} src=${profIconUrl(m, op.profession)} class="scard__prof" />
        <span>${c?.subProfessionName || ''}</span>
        ${op.permission ? html`<span class="ix-perm" title="稀有交接资格">交接</span>` : null}
      </span>
    </span>
    ${carried.length ? html`<span class="ix-carry" title="随商品附带，刷新会丢失">${carried.slice(0, 3).map((it, i) => html`<span key=${i}><${GearIcon} id=${it.id} catalog=${catalog} /><b class="num">${it.quantity || 1}</b></span>`)}</span>` : null}
    ${owned + 1 >= need ? html`<span class="scard__mergetag">可晋升</span>` : null}
    ${state.shop.frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${armed ? html`<span class=${cx('scard__confirm', reason && 'is-no')} role="status">${reason ? html`<b>无法购买</b><small>${reason}</small>` : html`<b>确认购买</b><small>再次点击</small>`}</span>` : null}
  </button>`;
}

function GearCard({ slot, idx, state, catalog, armed, reason, onTap }) {
  const g = catalog.gear[slot.id] || {};
  return html`<button type="button" class=${cx('scard', 'scard--item', state.shop.frozen && 'is-frozen', reason && 'is-disabled', armed && 'is-armed')}
      onClick=${() => onTap(idx)} data-testid=${`ix-shop-${idx}`} aria-label=${`${g.name || '装备'}，价格 ${slot.price}`}>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__top">
      ${g.kind === 'badge' || g.kind === '徽章' ? html`<span class="ix-lv">徽章</span>` : html`<span class="ix-lv num">${(slot.elite ? g.eliteLevel : g.level) ?? 1}级</span>`}
      <${HexBadge} value=${slot.price} tone=${reason === '资金不足' ? 'dark' : 'gold'} size="md" class="scard__price" />
    </span>
    <span class="scard__itemart"><${GearIcon} id=${slot.id} catalog=${catalog} /></span>
    <span class="scard__body">
      <span class="scard__name">${g.name || slot.id}</span>
      <span class="scard__idesc"><${GameText} text=${slot.elite ? g.elite : g.normal} catalog=${catalog} /></span>
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
 * original (the first one also opens its detail card); the reasons a tap cannot buy come from the state only.
 */
export function ShopBar({ state, catalog, busy, armed, onArm, onBuy, onUpgrade, onRefresh, onFreeze, deployed, deployCap }) {
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
          : html`<${ShopCard} key=${`c${i}:${s.id}`} slot=${s} idx=${i} state=${state} catalog=${catalog} armed=${armed === `s${i}`} reason=${reasonFor(s)} onTap=${tap} />`))}
      </div>
      <div class="shopbar__item">
        ${gear.length ? gear.map(({ s, i }) => (s.sold ? html`<${SoldCard} key=${`g${i}`} item=${true} />`
          : html`<${GearCard} key=${`g${i}:${s.id}`} slot=${s} idx=${i} state=${state} catalog=${catalog} armed=${armed === `s${i}`} reason=${reasonFor(s)} onTap=${tap} />`))
          : html`<${SoldCard} item=${true} />`}
      </div>
      <div class="funds">
        <div class="funds__hex"><${CoinGlyph} class="funds__coin" /><b class="funds__num num" data-testid="ix-funds">${state.funds}</b></div>
        <span class="funds__label">采购资金</span>
      </div>
    </div>
  </section>`;
}

// ---- unit plates and bench overflow -------------------------------------------------------------------------------

/**
 * The equipment level chip under every own unit (design: 常驻装备总等级), plus markers for attachments and the rare
 * inheritance permission. Positions follow the renderer every frame (camera moves, drags, resizes).
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
    ${pieces.map((p) => {
      const op = catalog.operators[p.chessId];
      return html`<span key=${p.uid} class="ix-badge" data-n=${String(p.uid).replace(/^\D+/, '')}>
        <b class="num">${p.equipmentLevel ?? 0}</b><small>级</small>
        ${p.attachments?.length ? html`<i class="ix-badge__att" title="外来附加效果"></i>` : null}
        ${op?.permission ? html`<i class="ix-badge__perm" title="稀有交接资格"></i>` : null}
      </span>`;
    })}
  </div>`;
}

/** Bench pieces beyond the renderer's 10 hand pads. */
export function BenchOverflow({ pieces, catalog, onPick }) {
  if (!pieces.length) return null;
  return html`<div class="ix-overflow" data-testid="ix-overflow">
    <span class="ix-overflow__label">整备区另有 <b class="num">${pieces.length}</b> 名</span>
    ${pieces.map((p) => html`<button type="button" key=${p.uid} class="ix-overflow__item" onClick=${() => onPick(p.uid)} title=${formEntry(catalog, p)?.name || ''}>
      <${UnitThumb} kind="chess" id=${renderChessId(catalog, p)} golden=${!!p.elite} size="sm" />
      <span class="num">${p.equipmentLevel ?? 0}级</span>
    </button>`)}
  </div>`;
}

export const deployedCount = (state) => (state.pieces || []).filter(isDeployed).length;
