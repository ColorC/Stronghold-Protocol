// 卫戍协议：工坊 detail card. An operator shows the original card's own blocks (ui/detailPanel.js ChessDetail: header,
// 特性, the eight stats against their base with the 攻击范围 grid, the skill with its icon and SP figures, the module,
// the talents) with the mode's 特质 and 装备 in their place, in tabs inside the original panel frame (.dpanel), so the
// card never scrolls as a whole. Its stats are the start-of-battle ones in the prep (the server's preview, the
// original's m.unitStats) and the live ones of the replay in a battle. Enemies — the pen, the battle — battle summons
// and special terrain use the original cards unchanged.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, useTicker } from '../ui/components.js';
import { copyComponentLink } from './componentLinks.js';
import { BondGlyph } from '../ui/gameComponents.js';
import { ChessDetail, EnemyDetail, TokenDetail, TerrainDetail } from '../ui/detailPanel.js';
import { SkillIcon, ModuleGlyph, ModuleInfo } from '../screens/loadout.js';
import { chessOptions, MODULE_NONE } from '../ui/loadoutModel.js';
import { data } from '../data.js';
import { TAVERN_FACTIONS } from '../../../shared/independentRules.js';
import { TraitGlyphs, mergeHintOf } from './hud.js';
import { GameText, TermNotes, GearIcon } from './text.js';
import { groupEquipment, permitsOf, isDeployed } from './model.js';
import { TraitTexts, HammerPicker, PRODUCTION_BADGES, gearMeta, badgeTotal } from './panels.js';
import { eligiblePiecesForEffect, hasConditionalTargets } from '../../../shared/independentEligibility.js';
import { buyTargetSpec, buyTargetChoices, buyTargetCount, buyRequiresTarget } from './targetSelection.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const FACTION_BOND = Object.fromEntries(Object.entries(TAVERN_FACTIONS).map(([bond, name]) => [name, bond]));
// the stats (and the range) stay on screen (user 10-07: 「属性常驻显示，其余的可以切换」); the rest switches
const TABS = [['traits', '特质'], ['skill', '技能'], ['talent', '天赋'], ['gear', '装备']];
/** Which tab each block of the original card goes to (ui/detailPanel.js CHESS_SECTIONS); the header stays on top. */
const TAB_OF = { garrison: 'traits', trait: 'skill', stats: 'stats', skill: 'skill', module: 'talent', talents: 'talent', equip: 'gear' };

/** The header's chips: the operator's tavern factions with their original bond glyphs, and its total equipment level. */
function FactionChips({ factions, level, catalog }) {
  return html`<div class="dbonds dbonds--top ix-dchips" role="list" aria-label="所属阵营">
    ${(factions || []).map((f) => html`<span key=${f} role="listitem" class="dbond is-active">
      <${FactionIcon} faction=${f} catalog=${catalog} /><span class="dbond__name">${f}</span></span>`)}
    ${level != null ? html`<span class="ix-dchips__lv"><${GameText} text="装备总等级" catalog=${catalog} /> <b class="num">${level}</b></span>` : null}
  </div>`;
}

function FactionIcon({ faction, catalog }) {
  const detail = catalog?.factionDetails?.[faction];
  const iconUrl = detail?.iconUrl || detail?.url;
  if (iconUrl) return html`<img class="dbond__icon ix-faction-icon" src=${iconUrl} alt="" loading="lazy" />`;
  return FACTION_BOND[faction] ? html`<${BondGlyph} bondId=${FACTION_BOND[faction]} class="dbond__icon" />` : null;
}

function sourceCardRefs(op) {
  const refs = op?.sourceRefs?.cards;
  if (!refs) return [];
  const cards = Array.isArray(refs) ? refs : [refs];
  return cards.filter((x) => x && typeof x === 'object' && (x.text || x.textElite || x.name || x.sourceUrl));
}

function TemporaryGrowth({live,catalog}) {
  const entries=live?.temporaryGrowth||[];
  if(!entries.length)return null;
  return html`<section class="ix-detail__text"><b>本场临时增益</b>${entries.map((entry,index)=>{
    const source=Object.values(catalog.operators||{}).find(op=>op.sourceRefs?.darkmoon19_2?.id===entry.sourceId);
    return html`<p key=${index}>${source?.name?`${source.name}：`:''}${entry.trainingLevels!=null?`训练额度 ${entry.trainingLevels} 级，按自身等级上限生效`:`攻击徽章×${entry.attackUnits||0}${entry.secondaryUnits?`，职业副属性装备×${entry.secondaryUnits}`:''}`}。本场结束后消失。</p>`;
  })}</section>`;
}

function readableCardText(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").trim();
}

function OriginalCardRefs({ op, piece, linkAnchor = null }) {
  const refs = sourceCardRefs(op);
  if (!refs.length) return null;
  const anchor = linkAnchor || (piece ? `piece-${piece.uid}` : null);
  return html`<details class="ix-original-card" onContextMenu=${(e) => anchor && copyComponentLink(e, anchor)}>
    <summary>参考原卡</summary>
    ${refs.map((ref, index) => html`<article class="ix-original-card__item" key=${index}>
      <header><b>${ref.name || '原卡'}</b>${ref.version ? html`<span>${ref.version.startsWith('19.2')?'暗月奖品初版 · 19.2':`版本 ${ref.version}`}</span>` : null}${ref.tier != null ? html`<span>酒馆科技 ${ref.tier}</span>` : null}
        ${ref.sourceUrl ? html`<a href=${ref.sourceUrl} target="_blank" rel="noreferrer">來源卡片</a>` : null}</header>
      ${ref.text ? html`<section><h4>普通</h4><pre>${readableCardText(ref.text)}</pre></section>` : null}
      ${ref.textElite ? html`<section><h4>精锐</h4><pre>${readableCardText(ref.textElite)}</pre></section>` : null}
    </article>`)}
  </details>`;
}

function EffectTargets({ op, piece, state, catalog, elite = false }) {
  const source = piece || { chessId: op?.chessId, elite, growthMode: state?.growthMode, growthLevel: 1 };
  const rules = elite ? op?.summaryElite || op?.summary || [] : op?.summary || [];
  const conditional = rules.filter(entry => hasConditionalTargets(entry.rule));
  if (!conditional.length) return null;
  return html`<div class="ix-effect-targets" aria-label="当前效果接收者">
    ${conditional.map((entry, index) => {
      const rule = entry.rule;
      return html`<${EffectTargetInfo} key=${index} effect=${rule} source=${source} state=${state} catalog=${catalog}
        delivery=${entry.effectDelivery || (elite ? op.effectDeliveryElite : op.effectDelivery)} anchor=${piece ? `piece-${piece.uid}` : `operator-${op?.chessId}`} />`;
    })}
  </div>`;
}

function deliveryText(delivery) {
  if (typeof delivery === 'string') return delivery;
  if (!delivery || typeof delivery !== 'object') return '';
  const recipients = { self: '自身', target: '指定对象', other: '其他干员', all: '全部干员', inventory: '库存', shop: '商店', player: '玩家' };
  const who = delivery.recipient || delivery.recipients || delivery.receiver || delivery.target;
  return [delivery.recipientLabel || recipients[who] || who, delivery.durationLabel || delivery.duration || delivery.term || delivery.until, delivery.text || delivery.description || delivery.message]
    .filter((x) => typeof x === 'string' && x.trim()).join(' · ');
}

function EffectTargetInfo({ effect, source, state, catalog, delivery = null, anchor = null }) {
  const params = effect?.params || {};
  const conditional = hasConditionalTargets(effect);
  if (!conditional) return null;
  const eligible = eligiblePiecesForEffect(effect, { pieces: state?.pieces || [], catalog, source });
  const text = deliveryText(delivery || effect.effectDelivery);
  return html`<details class="ix-effect-targets__item" onContextMenu=${(e) => anchor && copyComponentLink(e, anchor)}>
    <summary>当前符合条件 ${eligible.length} 名</summary>
    ${text ? html`<p>${text}</p>` : null}
    <ul>${eligible.map((target) => html`<li key=${target.uid} onContextMenu=${(e) => copyComponentLink(e, `piece-${target.uid}`)}>${catalog.operators?.[target.chessId]?.name || target.name || target.uid}</li>`)}
      ${eligible.length ? null : html`<li class="ix-muted">当前没有符合条件的干员</li>`}</ul>
  </details>`;
}

/** The mode's 特质 (the original card's 特质 slot): the summary glyphs, both forms' texts and the terms they name. */
function TraitSection({ op, elite, catalog, piece, state, busy, prep, onAct, linkAnchor }) {
  return html`<section key="garrison" class="dgarrison ix-dtrait" aria-label="特质">
    <div class="dgarrison__head"><span class="dgarrison__k">特质</span><${TraitGlyphs} summary=${op?.summary} elite=${elite} catalog=${catalog} max=${4} /></div>
    <${TraitTexts} op=${op} elite=${elite} catalog=${catalog} growthMode=${state?.growthMode||piece?.growthMode||'badges'} />
    <${EffectTargets} op=${op} piece=${piece} state=${state} catalog=${catalog} elite=${elite} />
    <${OriginalCardRefs} op=${op} piece=${piece} linkAnchor=${linkAnchor} />
    ${piece && (op?.summary || []).some((e) => e.kind === 'copy' && e.items) ? html`<div class="ix-usepick"><span class="ix-muted">没有可复制的徽章时，改为获得：</span>
      ${PRODUCTION_BADGES.map((id) => html`<button type="button" key=${id} class=${cx('ix-chip', (piece.preferences?.productionBadge || 'precision') === id && 'is-on')} disabled=${busy || !prep}
        onClick=${() => onAct({ type: 'configure', uid: piece.uid, productionBadge: id })}>${catalog.gear[id]?.name || ''}</button>`)}</div>` : null}
  </section>`;
}

function GrowthInfo({ piece }) {
  if (!piece || piece.growthLevel == null) return null;
  const stats = piece.growthStats || piece.growthAttributes || {};
  const labels = { attack: '攻击', atk: '攻击', maxHp: '生命', hp: '生命', defense: '防御', def: '防御', res: '法抗', attackSpeed: '攻速', aspd: '攻速' };
  return html`<section class="ix-growth-info" aria-label="等级成长"><b>成长等级 ${piece.growthLevel}</b>
    ${Object.entries(stats).map(([key, value]) => html`<span key=${key}>${labels[key] || key} ${value}</span>`)}</section>`;
}

/**
 * Worn gear as tiles (one per item; badges merged per kind) with the chosen tile's text under them — a long list of
 * gear never makes the card scroll. Attachments and the 交接凭证 note follow.
 */
function GearSection({ items, attachments = [], catalog, busy, onConfigure, title, note, state = null, sourcePiece = null }) {
  const rows = groupEquipment(items, catalog);
  const [pick, setPick] = useState(null);
  const row = rows.find((r) => r.uids[0] === pick) || rows[0] || null;
  const g = row ? catalog.gear[row.id] || {} : null;
  const item = row ? (items || []).find((x) => x.uid === row.uids[0]) : null;
  const total = (items || []).reduce((n, x) => n + (x.quantity || 1), 0);
  return html`<section key="equip" class="dsec ix-dgear" aria-label=${title}>
    <header class="dsec__head ix-dgear__head"><b>${title}</b>${total >= (catalog.rules?.equipmentCapacity ?? 999) ? html`<span class="num ix-muted">已满</span>` : null}</header>
    ${rows.length ? html`<div class="ix-dgear__tiles">${rows.map((r) => html`<button type="button" key=${r.uids[0]} class=${cx('ix-dgear__tile', r === row && 'is-on')}
        onClick=${() => setPick(r.uids[0])} aria-label=${`${r.name} ×${r.count}`}>
        <${GearIcon} id=${r.id} catalog=${catalog} plain=${true} /><b class="num">${r.count}</b>
        ${r.permit ? html`<i class="ix-dgear__permit" aria-hidden="true"></i>` : !r.badge && r.level ? html`<small class="num">${r.level}级</small>` : null}
      </button>`)}</div>
      <div class="ix-dgear__text"><b>${row.name}</b>${row.permit ? html`<span class="ix-perm"><${GameText} text="交接凭证" catalog=${catalog} /></span>` : null}
        <${GameText} text=${row.badge && row.count > 1 ? (badgeTotal(g, row.count) || g.normal) : g.normal} catalog=${catalog} />
        ${state && sourcePiece ? html`<${EffectTargetInfo} effect=${{ behavior: g.mechanism, params: g.params || {}, effectDelivery: g.effectDelivery }} source=${sourcePiece} state=${state} catalog=${catalog} anchor=${`piece-${sourcePiece.uid}`} />` : null}
        ${onConfigure && g.steamOptions?.length ? html`<${HammerPicker} g=${g} item=${item} busy=${busy} catalog=${catalog} onSave=${(ids) => onConfigure(item.uid, ids)} />` : null}</div>`
      : html`<p class="t-dim dempty">${note || '尚未穿戴装备：把库存格子拖到干员身上即可穿戴'}</p>`}
    ${attachments.length ? html`<div class="ix-dgear__att"><b>附加效果</b>${attachments.map((a,index) => {
      const record=catalog.attachments?.[a.id]||{}, source=a.id==='darkmoon-magnetic'?`${a.state?.sourceName||'来源干员'}：${a.state?.sourceEffect||record.effect||'附加本局退场效果。'}`:record.effect||'';
      return html`<span key=${`${a.id}-${index}`} title=${source}><${GameText} text=${record.name||'附加组件'} catalog=${catalog} />${a.state?.sourceName?` · ${a.state.sourceName}`:''}<small>${source}</small></span>`;
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
function OperatorCard({ piece, slot, state, catalog, busy, live, snapHp = null, inBattle = false, onAct, footer = null, linkAnchor = null }) {
  const [tab, setTab] = useState('traits');
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
  const gear = piece
    ? html`<${GearSection} key="equip" items=${piece.equipment} attachments=${piece.attachments || []} catalog=${catalog} busy=${busy} title="装备" state=${state} sourcePiece=${piece}
        onConfigure=${prep ? (itemUid, ids) => onAct({ type: 'configure-equipment', targetUid: piece.uid, itemUid, hammerSourceIds: ids }) : null} /><${TemporaryGrowth} live=${live} catalog=${catalog} />`
    : html`<${GearSection} key="equip" items=${[...(opBase?.permitGear ? [{ id: opBase.permitGear, uid: 'permit', quantity: 1 }] : []), ...(slot.equipment || []).map((x, i) => ({ ...x, uid: `c${i}` }))]}
        catalog=${catalog} title="随干员获得" note="获得时带来的装备写在特质里；这张卡没有附带别的装备" />`;
  const blocks = ChessDetail({ chess, piece: null, snapHp, editable: false, loadout, live,
    chips: html`<${FactionChips} factions=${piece ? piece.factions : catalog.operators?.[slot.id]?.nativeFactions || (data.lookup('chess', slot.id)?.bonds || []).map((b) => TAVERN_FACTIONS[b]).filter(Boolean)}
      level=${piece ? piece.equipmentLevel ?? 0 : null} catalog=${catalog} />`,
    overrides: { garrison: html`<${TraitSection} key="garrison" op=${opBase} elite=${!!piece?.elite} catalog=${catalog} piece=${piece} state=${state} busy=${busy} prep=${prep} onAct=${onAct} linkAnchor=${linkAnchor} />`, equip: gear, actions: null } });
  const head = blocks.find((b) => b?.key === 'head');
  const panes = { traits: [], stats: [], skill: [], talent: [], gear: [] };
  for (const b of blocks) if (b && b.key !== 'head' && TAB_OF[b.key]) panes[TAB_OF[b.key]].push(b);
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
      class=${cx('ix-dtabs__tab', cur === k && 'is-on')} onClick=${() => setTab(k)}>${label}${k === 'gear' && piece ? html`<span class="num">${piece.equipment.reduce((n, x) => n + (x.quantity || 1), 0)}</span>` : null}</button>`)}</div>
    <div class="ix-dpanel__pane" role="tabpanel" onContextMenu=${(e) => linkAnchor && copyComponentLink(e, linkAnchor)}>${panes[cur]}</div>
    ${footer}</div></div>`;
}

/**
 * The card for a detail target: { kind: 'piece', uid } | { kind: 'shop', slot } | { kind: 'gear', id } (a shop
 * gear) | { kind: 'enemy', id, count } (the pen) | { kind: 'unit', unit } (a battle unit) | { kind: 'terrain', terrain }.
 * `battle` (during a replay): { snapHp(unitId), stats(unitId) } read 4× a second, like the original card's live getter.
 */
export function DetailCard({ target, state, catalog, busy, battle = null, shopOpen = false, onClose, onAct, onInherit, onBuy, onEquipHere }) {
  const [confirmSell, setConfirmSell] = useState(false);
  const [buySelection, setBuySelection] = useState(null);
  useEffect(() => setConfirmSell(false), [target?.uid, target?.slot]);
  useEffect(() => setBuySelection(null), [target?.uid, target?.slot]);
  useTicker(battle && target ? 250 : 0);
  if (!target) return null;
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
    const liveEntry = live ? { ...live, src: 'battle' } : null;
    if (u.side === 'enemy') { const en = data.lookup('enemies', u.defId); return en ? frame(html`<${EnemyDetail} enemy=${en} snapHp=${hp} live=${liveEntry} />`, 'enemy') : null; }
    const piece = state.pieces.find((p) => p.uid === u.uid);
    if (piece) return frame(html`<${OperatorCard} piece=${piece} state=${state} catalog=${catalog} busy=${busy} live=${liveEntry} snapHp=${hp} inBattle=${true} onAct=${onAct} linkAnchor=${anchor} />`, 'chess');
    const tok = data.lookup('tokens', u.defId);
    return tok ? frame(html`<${TokenDetail} token=${tok} snapHp=${hp} live=${liveEntry} />`, 'token') : null;
  }
  const isShop = target.kind === 'shop';
  const slot = isShop ? state.shop.slots[target.slot] : null;
  const piece = isShop ? null : state.pieces.find((p) => p.uid === target.uid);
  if (!slot && !piece) return null;
  const prep = state.phase === 'prep' && !battle;
  const live = piece?.startStats ? { ...piece.startStats, src: 'prep' } : null;
  const hint = isShop && !slot.sold ? mergeHintOf(state, catalog, slot.id) : null;
  const buySpec=isShop?buyTargetSpec(slot,catalog,state):null;
  const buyChoices=buySelection&&buySelection.slot===target.slot?buySelection.choices:[];
  const selectedBuyChoices=buySelection&&buySelection.slot===target.slot?buySelection.selected:[];
  const startBuy=()=>{
    if(!buySpec){onBuy(target.slot,{});return;}
    const choices=buyTargetChoices(buySpec,state,catalog,target.slot);
    if(!choices.length&&!buyRequiresTarget(buySpec)){onBuy(target.slot,{});return;}
    setBuySelection({slot:target.slot,spec:buySpec,required:buyTargetCount(buySpec,state,catalog,slot),choices,selected:[]});
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
    ${isShop&&buySelection?.slot===target.slot?html`<section class="ix-buy-targets" role="group" aria-label="选择本次效果目标">
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
  return frame(html`<${OperatorCard} key=${piece ? piece.uid : `s${target.slot}`} piece=${piece} slot=${slot} state=${state} catalog=${catalog} busy=${busy} live=${live}
    onAct=${onAct} footer=${footer} linkAnchor=${anchor} />`, 'chess');
}
