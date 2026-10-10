// 卫戍协议：工坊 detail card. An operator shows the original card's own blocks (ui/detailPanel.js ChessDetail: header,
// 特性, the eight stats against their base with the 攻击范围 grid, the skill with its icon and SP figures, the module,
// the talents) with the mode's 特质 and 装备 in their place, in tabs inside the original panel frame (.dpanel), so the
// card never scrolls as a whole. Its stats are the start-of-battle ones in the prep (the server's preview, the
// original's m.unitStats) and the live ones of the replay in a battle. Enemies — the pen, the battle — battle summons
// and special terrain use the original cards unchanged.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, useTicker } from '../ui/components.js';
import { copyComponentLink } from './componentLinks.js';
import { FactionIcon } from './factions.js';
import { ChessDetail, EnemyDetail, TokenDetail, TerrainDetail } from '../ui/detailPanel.js';
import { SkillIcon, ModuleGlyph, ModuleInfo } from '../screens/loadout.js';
import { chessOptions, MODULE_NONE } from '../ui/loadoutModel.js';
import { data } from '../data.js';
import { TAVERN_FACTIONS } from '../../../shared/independentRules.js';
import { TraitGlyphs, mergeHintOf } from './hud.js';
import { GameText, TermNotes, GearIcon } from './text.js';
import { groupEquipment, permitsOf, isDeployed, temporaryGrowthDisplay, displayEquipmentLevel } from './model.js';
import { TraitTexts, FieldConditionCounts, HammerPicker, PRODUCTION_BADGES, gearMeta, badgeTotal } from './panels.js';
import { buyTargetSpec, buyTargetChoices, buyTargetCount, buyRequiresTarget } from './targetSelection.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
// the stats (and the range) stay on screen (user 10-07: 「属性常驻显示，其余的可以切换」); the rest switches
const TABS = [['traits', '特质'], ['skill', '技能'], ['talent', '天赋'], ['gear', '装备'], ['reference', '参考原卡']];
/** Which tab each block of the original card goes to (ui/detailPanel.js CHESS_SECTIONS); the header stays on top. */
const TAB_OF = { garrison: 'traits', trait: 'skill', stats: 'stats', skill: 'skill', module: 'talent', talents: 'talent', equip: 'gear' };

/** The header's chips: the operator's tavern factions with their original bond glyphs, and its equipment stack total. */
function FactionChips({ factions, level, catalog, temporaryBadgeCount = 0 }) {
  return html`<div class="dbonds dbonds--top ix-dchips" role="list" aria-label="所属阵营">
    ${(factions || []).map((f) => html`<span key=${f} role="listitem" class="dbond is-active">
      <${FactionIcon} faction=${f} catalog=${catalog} /><span class="dbond__name">${f}</span></span>`)}
    ${level != null ? html`<span class="ix-dchips__lv">装备叠加 <b class="num">×${level}</b></span>` : null}
    ${temporaryBadgeCount > 0 ? html`<span class="ix-dchips__lv ix-dchips__temporary">临时装备 <b class="num">×${temporaryBadgeCount}</b></span>` : null}
  </div>`;
}

function sourceCardRefs(op) {
  const refs = op?.sourceRefs?.cards;
  if (!refs) return [];
  const cards = Array.isArray(refs) ? refs : [refs];
  return cards.filter((x) => x && typeof x === 'object' && (x.text || x.textElite || x.name || x.sourceUrl));
}

function readableCardText(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").trim();
}

function originalCardStats(ref, golden = false) {
  const attack = golden ? ref.goldenAttack : ref.attack;
  const health = golden ? ref.goldenHealth : ref.health;
  if (ref.cardType === 'MINION') return Number.isInteger(attack) && Number.isInteger(health) ? `攻击 ${attack} · 生命 ${health}` : '攻血数据未收录';
  if (ref.cardType) return `非随从（${ref.cardType}），无攻击力/生命值`;
  return '卡牌类型未收录，未显示攻血';
}

export function OriginalCardRefs({ op, piece, linkAnchor = null }) {
  const refs = sourceCardRefs(op);
  if (!refs.length) return null;
  const anchor = linkAnchor || (piece ? `piece-${piece.uid}` : null);
  return html`<section class="ix-original-card" aria-label="参考原卡" onContextMenu=${(e) => anchor && copyComponentLink(e, `${anchor}:tab=reference`)}>
    ${refs.map((ref, index) => html`<article class="ix-original-card__item" key=${index}>
      <header><b>${ref.name || '原卡'}</b>${ref.version ? html`<span>${ref.version.startsWith('19.2')?'暗月奖品初版 · 19.2':`版本 ${ref.version}`}</span>` : null}${ref.tier != null ? html`<span>酒馆科技 ${ref.tier}</span>` : null}</header>
      <section><h4>普通</h4><p class="ix-original-card__stats">${originalCardStats(ref)}</p>${ref.text ? html`<pre>${readableCardText(ref.text)}</pre>` : null}</section>
      <section><h4>金色</h4><p class="ix-original-card__stats">${originalCardStats(ref, true)}</p>${ref.textElite ? html`<pre>${readableCardText(ref.textElite)}</pre>` : null}</section>
    </article>`)}
  </section>`;
}

/** The mode's 特质 (the original card's 特质 slot): the summary glyphs, both forms' texts and the terms they name. */
function TraitSection({ op, elite, catalog, piece, state, conditionState = state, busy, prep, onAct, linkAnchor, onFieldHighlight, rangeTilesFor }) {
  return html`<section key="garrison" class="dgarrison ix-dtrait" aria-label="特质">
    <div class="dgarrison__head"><span class="dgarrison__k">特质</span><${TraitGlyphs} summary=${op?.summary} elite=${elite} catalog=${catalog} growthMode=${state?.growthMode||piece?.growthMode||'badges'} max=${4} /></div>
    <${TraitTexts} op=${op} elite=${elite} catalog=${catalog} growthMode=${state?.growthMode||piece?.growthMode||'badges'} piece=${piece} state=${conditionState} onFieldHighlight=${onFieldHighlight} rangeTilesFor=${rangeTilesFor} />
    ${piece && (state?.growthMode || piece?.growthMode) !== 'levels' && (op?.summary || []).some((e) => e.kind === 'copy' && e.items) ? html`<div class="ix-usepick"><span class="ix-muted">没有可复制的徽章时，改为获得：</span>
      ${PRODUCTION_BADGES.map((id) => html`<button type="button" key=${id} class=${cx('ix-chip', (piece.preferences?.productionBadge || 'precision') === id && 'is-on')} disabled=${busy || !prep}
        onClick=${() => onAct({ type: 'configure', uid: piece.uid, productionBadge: id })}>${catalog.gear[id]?.name || ''}</button>`)}</div>` : null}
  </section>`;
}

function GrowthInfo({ piece }) {
  if (!piece || piece.growthLevel == null) return null;
  const stats = piece.growthStats || piece.growthAttributes || {};
  const labels = { attack: '攻击', atk: '攻击', maxHp: '生命', hp: '生命', defense: '防御', def: '防御', res: '法抗', attackSpeed: '攻速', aspd: '攻速' };
  return html`<section class="ix-growth-info" aria-label="训练等级"><b>训练等级 ${piece.growthLevel}</b>
    ${Object.entries(stats).map(([key, value]) => html`<span key=${key}>${labels[key] || key} ${value}</span>`)}</section>`;
}

/**
 * Worn gear as tiles (one per item; badges merged per kind) with the chosen tile's text under them — a long list of
 * gear never makes the card scroll. Attachments and the 交接凭证 note follow.
 */
function GearSection({ items, attachments = [], catalog, busy, onConfigure, title, note, state = null, sourcePiece = null, onFieldHighlight = null, rangeTilesFor = null, capacityLimited = true, sourceNames = [], temporary = false }) {
  const rows = groupEquipment(items, catalog);
  const [pick, setPick] = useState(null);
  const row = rows.find((r) => r.uids[0] === pick) || rows[0] || null;
  const g = row ? catalog.gear[row.id] || {} : null;
  const item = row ? (items || []).find((x) => x.uid === row.uids[0]) : null;
  const total = (items || []).reduce((n, x) => n + (x.quantity || 1), 0);
  return html`<section key=${title} class="dsec ix-dgear" aria-label=${title}>
    <header class="dsec__head ix-dgear__head"><b>${title}</b>${capacityLimited && total >= (catalog.rules?.equipmentCapacity ?? 999) ? html`<span class="num ix-muted">已满</span>` : null}</header>
    ${rows.length ? html`<div class="ix-dgear__tiles">${rows.map((r) => html`<button type="button" key=${r.uids[0]} class=${cx('ix-dgear__tile', r === row && 'is-on')}
        onClick=${() => setPick(r.uids[0])} aria-label=${`${r.name} ×${r.count}${temporary ? '，临时' : ''}`}>
        <${GearIcon} id=${r.id} catalog=${catalog} plain=${true} /><b class="num">${r.count}</b>
        ${temporary ? html`<span class="ix-dgear__temporary-tag">临时</span>` : null}
        ${r.permit ? html`<i class="ix-dgear__permit" aria-hidden="true"></i>` : !r.badge && r.level ? html`<small class="num">×${r.level}</small>` : null}
      </button>`)}</div>
      <div class="ix-dgear__text"><b>${row.name}</b>${row.permit ? html`<span class="ix-perm"><${GameText} text="交接凭证" catalog=${catalog} /></span>` : null}
        <${GameText} text=${row.badge && row.count > 1 ? (badgeTotal(g, row.count) || g.normal) : g.normal} catalog=${catalog} />
        ${state && sourcePiece ? html`<${FieldConditionCounts} effects=${[{ rule: { behavior: g.mechanism, params: g.params || {} }, effectDelivery: g.effectDelivery }]}
          source=${sourcePiece} state=${state} catalog=${catalog} active=${isDeployed(sourcePiece)} onFieldHighlight=${onFieldHighlight} rangeTilesFor=${rangeTilesFor} />` : null}
        ${sourceNames.length ? html`<small class="ix-muted" aria-label="临时装备来源">来源：${sourceNames.join('、')}</small>` : null}
        ${onConfigure && g.steamOptions?.length ? html`<${HammerPicker} g=${g} item=${item} busy=${busy} catalog=${catalog} onSave=${(ids) => onConfigure(item.uid, ids)} />` : null}</div>`
      : html`<p class="t-dim dempty">${note || '尚未穿戴装备：把库存格子拖到干员身上即可穿戴'}</p>`}
    ${attachments.length ? html`<div class="ix-dgear__att"><b>附加效果</b>${attachments.map((a,index) => {
      const record=catalog.attachments?.[a.id]||{}, source=a.id==='darkmoon-magnetic'?`${a.state?.sourceName||'来源干员'}：${a.state?.sourceEffect||record.effect||'附加本局战斗部署效果。'}`:record.effect||'';
      return html`<span key=${`${a.id}-${index}`} title=${source}><${GearIcon} id=${a.id} catalog=${catalog} plain=${true} /><${GameText} text=${record.name||'附加组件'} catalog=${catalog} />${a.state?.sourceName?` · ${a.state.sourceName}`:''}<small>${source}</small></span>`;
    })}</div>` : null}
    ${rows.some((r) => r.permit) ? html`<${TermNotes} texts=${['交接凭证']} catalog=${catalog} />` : null}
  </section>`;
}

/** The skill tab's choice: each skill's icon (the 干员调配 screen's), the chosen one lit; a tap changes it in the prep. */
function SkillChoice({ base, golden, piece, busy, prep, onAct }) {
  const m = data.get('assets');
  const options = chessOptions(base, golden);
  const supported=base.nativeImport?.supportedSkillIds;
  const opt={...options,skillOptions:options.skillOptions.filter(s=>!supported||supported.includes(s.normal?.skillId||s.normal?.id))};
  if (!piece || opt.skillOptions.length < 2) return null;
  return html`<div class="ix-dchoice" role="radiogroup" aria-label="选择技能">
    ${opt.skillOptions.map((s) => html`<button type="button" key=${s.index} role="radio" aria-checked=${piece.skillIndex === s.index ? 'true' : 'false'}
        class=${cx('ix-dchoice__opt', piece.skillIndex === s.index && 'is-on')} disabled=${busy || !prep || piece.skillIndex === s.index}
        title=${(golden && piece.elite ? s.elite : s.normal)?.name || ''} onClick=${() => onAct({ type: 'loadout', uid: piece.uid, skillIndex: s.index, moduleId: piece.moduleId })}>
      <${SkillIcon} m=${m} rec=${golden && piece.elite ? s.elite || s.normal : s.normal} index=${s.index} on=${piece.skillIndex === s.index} size="sm" />
    </button>`)}
  </div>`;
}

/** The elite's module choice (none or one of its modules) with the chosen one's figures (the 干员调配 screen's ModuleInfo). */
function ModuleChoice({ base, golden, piece, busy, prep, onAct }) {
  const m = data.get('assets');
  if (!piece?.elite || !golden) return null;
  const opt = chessOptions(base, golden);
  const options = [{ id: MODULE_NONE, rec: null, isDefault: false }, ...opt.moduleOptions.filter((x) => x.id !== MODULE_NONE)];
  if (options.length < 2) return null;
  const cur = options.find((x) => x.id === (piece.moduleId || MODULE_NONE)) || options[0];
  return html`<div class="ix-dmodule">
    <div class="ix-dchoice" role="radiogroup" aria-label="选择模组">${options.map((mo) => html`<button type="button" key=${mo.id} role="radio" aria-checked=${mo === cur ? 'true' : 'false'}
        class=${cx('ix-dchoice__opt', mo === cur && 'is-on')} disabled=${busy || !prep || mo === cur} title=${mo.id === MODULE_NONE ? '不装备' : mo.rec?.name || mo.id}
        onClick=${() => onAct({ type: 'loadout', uid: piece.uid, skillIndex: piece.skillIndex, moduleId: mo.id })}><${ModuleGlyph} m=${m} rec=${mo.rec} id=${mo.id} size="sm" /></button>`)}</div>
    <${ModuleInfo} m=${m} golden=${golden} opt=${cur} />
  </div>`;
}

/**
 * An operator — own piece (prep or battle) or shop card — as the original card's blocks in tabs. `live`: the stats
 * entry it shows (start of battle / live) or null for the record's; `snapHp`: its HP in a battle (`inBattle`).
 */
function OperatorCard({ piece, slot, state, conditionState = state, catalog, busy, live, snapHp = null, inBattle = false, onAct, footer = null, linkAnchor = null, initialTab = 'traits', onFieldHighlight = null, rangeTilesFor = null }) {
  const [tab, setTab] = useState(initialTab);
  const prep = state.phase === 'prep' && !inBattle;
  const opBase = catalog.operators[piece ? piece.chessId : slot.id];
  const base = data.lookup('chess', piece ? piece.chessId : slot.id);
  const golden = opBase?.eliteChessId ? data.lookup('chess', opBase.eliteChessId) : null;
  const record = piece?.elite && golden ? golden : base;
  if (!record) return null;
  const formOp = piece?.elite ? catalog.operators[opBase.eliteChessId] || opBase : opBase;
  // the header's tier is the mode's (catalog), not the upstream chess record's
  const tier = formOp?.tier ?? opBase?.tier;
  const chess = Number.isInteger(tier) && tier !== record.tier ? { ...record, tier } : record;
  const loadout = piece ? { [base.chessId]: { skill: piece.skillIndex, module: piece.elite ? piece.moduleId || MODULE_NONE : undefined } } : null;
  const growthMode = state?.growthMode || piece?.growthMode || 'badges';
  const temporaryGrowth = piece && inBattle && live ? temporaryGrowthDisplay(live.temporaryGrowth, catalog, growthMode) : null;
  const temporaryItems = temporaryGrowth?.mode === 'badges' ? temporaryGrowth.items : [];
  const visibleEquipmentCount = piece ? (piece.equipment || []).reduce((n, item) => n + Number(item.quantity || 1), 0)
    + (inBattle && growthMode === 'badges' ? Number(temporaryGrowth?.total || 0) : 0) : 0;
  const equipmentLevel = displayEquipmentLevel(piece, catalog, inBattle ? temporaryGrowth : null);
  const gear = piece
    ? html`<div key="equip"><${GearSection} items=${piece.equipment} attachments=${piece.attachments || []} catalog=${catalog} busy=${busy} title="装备" state=${conditionState} sourcePiece=${piece} onFieldHighlight=${onFieldHighlight} rangeTilesFor=${rangeTilesFor}
        onConfigure=${prep ? (itemUid, ids) => onAct({ type: 'configure-equipment', targetUid: piece.uid, itemUid, hammerSourceIds: ids }) : null} />
        ${temporaryItems.length ? html`<${GearSection} items=${temporaryItems} catalog=${catalog} busy=${busy} title=${`临时装备 ×${temporaryGrowth.total}`} capacityLimited=${false} sourceNames=${temporaryGrowth.sources} temporary=${true} />` : null}
        ${temporaryGrowth?.mode === 'levels' && temporaryGrowth.levels > 0 ? html`<section class="dsec ix-dgear" aria-label="临时训练等级"><header class="dsec__head ix-dgear__head"><b>临时训练等级 +${temporaryGrowth.levels}</b></header>${temporaryGrowth.sources.length ? html`<small class="ix-muted">来源：${temporaryGrowth.sources.join('、')}</small>` : null}</section>` : null}</div>`
    : html`<${GearSection} key="equip" items=${[...(opBase?.permitGear ? [{ id: opBase.permitGear, uid: 'permit', quantity: 1 }] : []), ...(slot.equipment || []).map((x, i) => ({ ...x, uid: `c${i}` }))]}
        catalog=${catalog} title="随干员获得" note="获得时带来的装备写在特质里；这张卡没有附带别的装备" />`;
  const blocks = ChessDetail({ chess, piece: null, snapHp, editable: false, loadout, live,
    chips: html`<${FactionChips} factions=${piece ? piece.factions : catalog.operators?.[slot.id]?.nativeFactions || (data.lookup('chess', slot.id)?.bonds || []).map((b) => TAVERN_FACTIONS[b]).filter(Boolean)}
      level=${equipmentLevel} catalog=${catalog} temporaryBadgeCount=${inBattle && growthMode === 'badges' ? temporaryGrowth?.total || 0 : 0} />`,
    overrides: { garrison: html`<${TraitSection} key="garrison" op=${opBase} elite=${!!piece?.elite} catalog=${catalog} piece=${piece} state=${state} conditionState=${conditionState} busy=${busy} prep=${prep} onAct=${onAct} linkAnchor=${linkAnchor} onFieldHighlight=${onFieldHighlight} rangeTilesFor=${rangeTilesFor} />`, equip: gear, actions: null } });
  const head = blocks.find((b) => b?.key === 'head');
  const panes = { traits: [], stats: [], skill: [], talent: [], gear: [], reference: [] };
  for (const b of blocks) if (b && b.key !== 'head' && TAB_OF[b.key]) panes[TAB_OF[b.key]].push(b);
  if (sourceCardRefs(opBase).length) panes.reference.push(html`<${OriginalCardRefs} key="original-card-refs" op=${opBase} piece=${piece} linkAnchor=${linkAnchor} />`);
  if (piece) {
    panes.skill.unshift(html`<${SkillChoice} key="skillchoice" base=${base} golden=${golden} piece=${piece} busy=${busy} prep=${prep} onAct=${onAct} />`);
    panes.talent.unshift(html`<${ModuleChoice} key="modulechoice" base=${base} golden=${golden} piece=${piece} busy=${busy} prep=${prep} onAct=${onAct} />`);
    if (piece.bodyPenaltyApplied) panes.stats.push(html`<p key="penalty" class="ix-note"><${GameText} text="已承受接装损耗：原生攻击力与最大生命值为80%" catalog=${catalog} /></p>`);
    if (piece.growthLevel != null) panes.stats.push(html`<${GrowthInfo} key="growth" piece=${piece} />`);
  }
  const shown = TABS.filter(([k]) => panes[k].length);
  const cur = shown.some(([k]) => k === tab) ? tab : shown[0]?.[0];
  // two columns on a wide screen (head + stats | tabs + pane + actions), one column elsewhere (css .ix-dop)
  return html`<div class="ix-dop"><div class="ix-dop__main">
    <div class="ix-dpanel__head">${head}</div>
    ${panes.stats.length ? html`<div class="ix-dpanel__stats" onContextMenu=${(e) => linkAnchor && copyComponentLink(e, linkAnchor)}>${panes.stats}</div>` : null}
    </div><div class="ix-dop__side">
    <div class="ix-dtabs" role="tablist">${shown.map(([k, label]) => html`<button type="button" key=${k} role="tab" aria-selected=${cur === k ? 'true' : 'false'}
      class=${cx('ix-dtabs__tab', cur === k && 'is-on')} onClick=${() => { onFieldHighlight?.([]); setTab(k); }}
      onContextMenu=${(e) => linkAnchor && copyComponentLink(e, `${linkAnchor}:tab=${k}`)}>${label}${k === 'gear' && piece ? html`<span class="num">${visibleEquipmentCount}</span>` : null}</button>`)}</div>
    <div class="ix-dpanel__pane" role="tabpanel" onContextMenu=${(e) => linkAnchor && copyComponentLink(e, `${linkAnchor}:tab=${cur}`)}>${panes[cur]}</div>
    ${footer}</div></div>`;
}

/**
 * The card for a detail target: { kind: 'piece', uid } | { kind: 'shop', slot } | { kind: 'gear', id } (a shop
 * gear) | { kind: 'enemy', id, count } (the pen) | { kind: 'unit', unit } (a battle unit) | { kind: 'terrain', terrain }.
 * `battle` (during a replay): { snapHp(unitId), stats(unitId) } read 4× a second, like the original card's live getter.
 */
export function DetailCard({ target, state, catalog, busy, battle = null, shopOpen = false, onClose, onAct, onInherit, onBuy, onBeginTarget, onCancelTarget, onEquipHere, onFieldHighlight = null, rangeTilesFor = null }) {
  const [confirmSell, setConfirmSell] = useState(false);
  const [buySelection, setBuySelection] = useState(null);
  useEffect(() => setConfirmSell(false), [target?.uid, target?.slot]);
  useEffect(() => setBuySelection(null), [target?.uid, target?.slot]);
  useTicker(battle && target ? 250 : 0);
  if (!target) return null;
  const liveUids = battle?.fieldPieceUids?.() || null;
  const liveStats = battle?.fieldPieceStats?.() || null;
  const liveConditionPieces = battle?.fieldConditionPieces?.() || null;
  const conditionState = liveConditionPieces ? { ...state, pieces: liveConditionPieces } : liveUids ? { ...state, pieces: state.pieces.filter((p) => liveUids.includes(p.uid)).map((p) => {
    const current = liveStats?.[p.uid];
    return current ? { ...p, hp: current.hp, currentHp: current.hp, maxHp: current.maxHp } : p;
  }) } : state;
  const anchor = target.kind === 'piece' ? `piece-${target.uid}` : target.kind === 'shop' ? `shop-${target.slot}`
    : target.kind === 'gear' ? `gear-${target.id}` : target.kind === 'unit' && target.unit?.uid ? `piece-${target.unit.uid}` : null;
  const frame = (body, kind) => html`<aside class=${cx('dpanel', 'brackets', 'dpanel--right', shopOpen && 'is-shop', 'ix-dpanel', `ix-dpanel--${kind}`)} data-testid="ix-detail" role="dialog" aria-label="详情"
    onContextMenu=${anchor ? (e) => copyComponentLink(e, anchor) : null}>
    <button type="button" class="dpanel__close" aria-label="关闭" onClick=${onClose}><${Icon} name="close" /></button>
    <div class="ix-dpanel__body">${body}</div>
  </aside>`;
  if (target.kind === 'gear') {
    const g = catalog.gear[target.id] || {};
    const body = g.normal;
    return frame(html`<header class="ix-dgearhead"><${GearIcon} id=${target.id} catalog=${catalog} plain=${true} /><div><h3 class="dhead__name">${g.name || ''}</h3>
        <span class="ix-muted">${gearMeta(g)}</span></div></header>
      <p class="ix-detail__text"><${GameText} text=${body} catalog=${catalog} /></p>
      <${TermNotes} texts=${[body]} catalog=${catalog} exclude=${g.name} />`, 'gear');
  }
  if (target.kind === 'terrain') return frame(html`<${TerrainDetail} terrain=${target.terrain} />`, 'terrain');
  if (target.kind === 'enemy') {
    const en = data.lookup('enemies', target.id);
    return en ? frame(html`<${EnemyDetail} enemy=${en} count=${target.count} />`, 'enemy') : null;
  }
  if (target.kind === 'unit') {
    const u = target.unit || {};
    const live = battle?.stats(u.id); const hp = battle?.snapHp(u.id) || null;
    const liveEntry = live ? { ...live, src: 'battle' }
      : u.kind === 'token' && u.runtimeDetail?.stats ? { ...u.runtimeDetail.stats, src: 'battle snapshot' } : null;
    if (u.side === 'enemy') { const en = data.lookup('enemies', u.defId); return en ? frame(html`<${EnemyDetail} enemy=${en} snapHp=${hp} live=${liveEntry} />`, 'enemy') : null; }
    if (u.kind === 'token') {
      const piece = state.pieces.find((p) => p.uid === u.uid) || null;
      const token = data.lookup('tokens', u.defId || piece?.tokenId) || {
        tokenId: u.defId || u.runtimeDetail?.nativeChessId || 'runtime-token', name: u.name || u.runtimeDetail?.name || '召唤物', stats: {},
      };
      return frame(html`<${TokenDetail} token=${token} piece=${piece} ownerId=${u.ownerChessId || piece?.ownerChessId || null}
        snapHp=${hp} live=${liveEntry} runtimeDetail=${u.runtimeDetail || null} />
        ${u.ownerName || piece?.ownerName ? html`<p class="ix-muted">主人：${u.ownerName || piece.ownerName}</p>` : null}
        ${u.summonSourceText || piece?.summonSourceText ? html`<p class="ix-muted">${u.summonSourceText || piece.summonSourceText}</p>` : null}`, 'token');
    }
    const piece = state.pieces.find((p) => p.uid === u.uid);
    if (piece?.kind === 'token') {
      const tok = data.lookup('tokens', u.defId || piece.tokenId);
      return tok ? frame(html`<${TokenDetail} token=${tok} piece=${piece} ownerId=${u.ownerChessId || piece.ownerChessId || null} snapHp=${hp} live=${liveEntry} />
        ${u.ownerName || piece.ownerName ? html`<p class="ix-muted">主人：${u.ownerName || piece.ownerName}</p>` : null}
        ${u.summonSourceText || piece.summonSourceText ? html`<p class="ix-muted">${u.summonSourceText || piece.summonSourceText}</p>` : null}`, 'token') : null;
    }
    if (piece) return frame(html`<${OperatorCard} key=${`battle:${piece.uid}:${target.tab || 'traits'}`} piece=${piece} state=${state} conditionState=${conditionState} catalog=${catalog} busy=${busy} live=${liveEntry} snapHp=${hp} inBattle=${true} onAct=${onAct} linkAnchor=${anchor} initialTab=${target.tab || 'traits'} onFieldHighlight=${onFieldHighlight} rangeTilesFor=${rangeTilesFor} />`, 'chess');
    const tok = data.lookup('tokens', u.defId);
    return tok ? frame(html`<${TokenDetail} token=${tok} ownerId=${u.ownerChessId || null} snapHp=${hp} live=${liveEntry} />
      ${u.ownerName ? html`<p class="ix-muted">主人：${u.ownerName}</p>` : null}
      ${u.summonSourceText ? html`<p class="ix-muted">${u.summonSourceText}</p>` : null}`, 'token') : null;
  }
  const isShop = target.kind === 'shop';
  const slot = isShop ? state.shop.slots[target.slot] : null;
  const piece = isShop ? null : state.pieces.find((p) => p.uid === target.uid);
  const tokenPiece = !isShop ? state.pieces.find((p) => p.uid === target.uid && p.kind === 'token') : null;
  if (tokenPiece) {
    const token = data.lookup('tokens', tokenPiece.tokenId || tokenPiece.id);
    if (!token) return null;
    return frame(html`<${TokenDetail} token=${token} piece=${tokenPiece} ownerId=${tokenPiece.ownerChessId || null} />
      ${tokenPiece.ownerName ? html`<p class="ix-muted">主人：${tokenPiece.ownerName}</p>` : null}
      ${tokenPiece.summonSourceText ? html`<p class="ix-muted">${tokenPiece.summonSourceText}</p>` : null}`, 'token');
  }
  if (!slot && !piece) return null;
  const prep = state.phase === 'prep' && !battle;
  const live = piece?.startStats ? { ...piece.startStats, src: 'prep' } : null;
  const hint = isShop && !slot.sold ? mergeHintOf(state, catalog, slot.id) : null;
  const buySpec=isShop?buyTargetSpec(slot,catalog,state):null;
  const buyChoices=buySelection && buySelection.slot === target.slot ? buySelection.choices : [];
  const selectedBuyChoices=buySelection && buySelection.slot === target.slot ? buySelection.selected : [];
  const startBuy=()=>{
    if(!buySpec){onBuy(target.slot,{});return;}
    const choices=buyTargetChoices(buySpec,state,catalog,target.slot);
    if(!choices.length&&!buyRequiresTarget(buySpec,choices)){onBuy(target.slot,{});return;}
    const required=buyTargetCount(buySpec,state,catalog,slot);
    if(required===1&&choices.length&&(buySpec.kind==='friendly'||buySpec.kind==='magnetic'||buySpec.kind==='shopSlot')) {
      setBuySelection({slot:target.slot,spec:buySpec,required,choices,selected:[],fieldMode:true});
      onBeginTarget?.({slot:target.slot,spec:buySpec,choices});
      return;
    }
    setBuySelection({slot:target.slot,spec:buySpec,required,choices,selected:[]});
  };
  const chooseBuyTarget=(choice)=>setBuySelection(current=>{
    if(!current||current.slot!==target.slot)return current;
    const key=choice.kind==='shopSlot'?choice.slot:choice.uid;
    const exists=current.selected.some(x=>(x.kind==='shopSlot'?x.slot:x.uid)===key);
    const selected=exists?current.selected.filter(x=>(x.kind==='shopSlot'?x.slot:x.uid)!==key):current.selected.length<current.required?[...current.selected,choice]:current.selected;
    return {...current,selected};
  });
  const confirmBuyTargets=()=>{
    if(!buySelection||buySelection.selected.length!==buySelection.required)return;
    const selected=buySelection.selected;
    const payload=buySelection.spec.kind==='shopSlot'?{shopSlots:selected.map(x=>x.slot)}:buySelection.spec.kind==='magnetic'?{magneticTargetUid:selected[0]?.uid}:{targetUid:selected[0]?.uid};
    setBuySelection(null);onBuy(target.slot,payload);
  };
  const footer = html`<footer class="ix-dpanel__actions">
    ${hint ? html`<span class="ix-dpanel__hint" role="note">${hint.text}</span>` : null}
    ${isShop ? html`<${Button} size="sm" variant="primary" disabled=${busy || slot.sold || state.funds < slot.price} onClick=${startBuy}>购买 · ${slot.price}<//>` : null}
      ${isShop&&buySelection?.slot===target.slot&&!buySelection.fieldMode?html`<section class="ix-buy-targets" role="group" aria-label="选择本次效果目标">
      <p>${buySelection.spec.kind==='shopSlot'?'选择要变化的酒馆干员':buySelection.spec.kind==='magnetic'?'可直接招募；若要合体，选择一名哥伦比亚友方干员':'选择获得效果的友方干员'}${buySelection.spec.kind==='magnetic'?'':`（${buySelection.required}）`}</p>
      ${buySelection.spec.kind==='magnetic'?html`<button type="button" class="ix-buy-targets__normal" disabled=${busy} onClick=${()=>{setBuySelection(null);onBuy(target.slot,{})}}>直接招募</button>`:null}
      ${!buyChoices.length&&buyRequiresTarget(buySelection.spec)?html`<p role="status">当前没有符合条件的目标。</p>`:null}
      <div class="ix-buy-targets__choices">${buyChoices.map((choice,index)=>{
        const key=choice.kind==='shopSlot'?choice.slot:choice.uid,active=selectedBuyChoices.some(x=>(x.kind==='shopSlot'?x.slot:x.uid)===key);
        const label=choice.kind==='shopSlot'?(catalog.operators?.[choice.id]?.name||choice.id):choice.name;
        return html`<button type="button" key=${key||index} aria-pressed=${active?'true':'false'} class=${cx('ix-buy-targets__choice',active&&'is-on')} onClick=${()=>chooseBuyTarget(choice)}>${label}</button>`;
      })}</div>
      <div class="ix-buy-targets__actions"><button type="button" onClick=${()=>setBuySelection(null)}>取消</button><button type="button" disabled=${busy||selectedBuyChoices.length!==buySelection.required} onClick=${confirmBuyTargets}>${buySelection.spec.kind==='magnetic'?'消耗合体':'确认目标'}</button></div>
    </section>`:null}
    ${piece && prep ? html`
      <${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onEquipHere(piece.uid)}>库存<//>
      ${piece.handover?.give?.length || piece.handover?.take?.length ? html`<${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onInherit(piece.uid)}>交接<//>` : null}
      ${isDeployed(piece) ? html`<${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onAct({ type: 'bench', uid: piece.uid })}>撤回<//>` : null}
      ${confirmSell
        ? html`<${Button} size="sm" variant="danger" disabled=${busy} onClick=${() => onAct({ type: 'sell', uid: piece.uid })}>确认出售 +${catalog.rules?.sellPrice ?? 1}<//>`
        : html`<${Button} size="sm" variant="danger" disabled=${busy} onClick=${() => setConfirmSell(true)} title="装备与附加效果会一起失去">出售 +${catalog.rules?.sellPrice ?? 1}<//>`}` : null}
  </footer>`;
  return frame(html`<${OperatorCard} key=${piece ? `${piece.uid}:${target.tab || 'traits'}` : `s${target.slot}:${target.tab || 'traits'}`} piece=${piece} slot=${slot} state=${state} conditionState=${conditionState} catalog=${catalog} busy=${busy} live=${live}
    onAct=${onAct} footer=${footer} linkAnchor=${anchor} initialTab=${target.tab || 'traits'} onFieldHighlight=${onFieldHighlight} rangeTilesFor=${rangeTilesFor} />`, 'chess');
}
