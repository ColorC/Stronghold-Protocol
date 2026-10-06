// 卫戍协议：工坊 detail card. An operator shows the original card's own blocks (ui/detailPanel.js ChessDetail: header,
// 特性, the eight stats against their base with the 攻击范围 grid, the skill with its icon and SP figures, the module,
// the talents) with the mode's 特质 and 装备 in their place, in tabs inside the original panel frame (.dpanel), so the
// card never scrolls as a whole. Its stats are the start-of-battle ones in the prep (the server's preview, the
// original's m.unitStats) and the live ones of the replay in a battle. Enemies — the pen, the battle — battle summons
// and special terrain use the original cards unchanged.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, useTicker } from '../ui/components.js';
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
      ${FACTION_BOND[f] ? html`<${BondGlyph} bondId=${FACTION_BOND[f]} class="dbond__icon" />` : null}<span class="dbond__name">${f}</span></span>`)}
    ${level != null ? html`<span class="ix-dchips__lv"><${GameText} text="装备总等级" catalog=${catalog} /> <b class="num">${level}</b></span>` : null}
  </div>`;
}

/** The mode's 特质 (the original card's 特质 slot): the summary glyphs, both forms' texts and the terms they name. */
function TraitSection({ op, elite, catalog, piece, busy, prep, onAct }) {
  return html`<section key="garrison" class="dgarrison ix-dtrait" aria-label="特质">
    <div class="dgarrison__head"><span class="dgarrison__k">特质</span><${TraitGlyphs} summary=${op?.summary} elite=${elite} catalog=${catalog} max=${4} /></div>
    <${TraitTexts} op=${op} elite=${elite} catalog=${catalog} />
    ${piece && (op?.summary || []).some((e) => e.kind === 'copy' && e.items) ? html`<div class="ix-usepick"><span class="ix-muted">没有可复制的徽章时，改为获得：</span>
      ${PRODUCTION_BADGES.map((id) => html`<button type="button" key=${id} class=${cx('ix-chip', (piece.preferences?.productionBadge || 'precision') === id && 'is-on')} disabled=${busy || !prep}
        onClick=${() => onAct({ type: 'configure', uid: piece.uid, productionBadge: id })}>${catalog.gear[id]?.name || ''}</button>`)}</div>` : null}
  </section>`;
}

/**
 * Worn gear as tiles (one per item; badges merged per kind) with the chosen tile's text under them — a long list of
 * gear never makes the card scroll. Attachments and the 交接凭证 note follow.
 */
function GearSection({ items, attachments = [], catalog, busy, onConfigure, title, note }) {
  const rows = groupEquipment(items, catalog);
  const [pick, setPick] = useState(null);
  const row = rows.find((r) => r.uids[0] === pick) || rows[0] || null;
  const g = row ? catalog.gear[row.id] || {} : null;
  const item = row ? (items || []).find((x) => x.uid === row.uids[0]) : null;
  const total = (items || []).reduce((n, x) => n + (x.quantity || 1), 0);
  return html`<section key="equip" class="dsec ix-dgear" aria-label=${title}>
    <header class="dsec__head ix-dgear__head"><b>${title}</b>${total ? html`<span class="num ix-muted">${total}/${catalog.rules?.equipmentCapacity ?? 999}</span>` : null}</header>
    ${rows.length ? html`<div class="ix-dgear__tiles">${rows.map((r) => html`<button type="button" key=${r.uids[0]} class=${cx('ix-dgear__tile', r === row && 'is-on')}
        onClick=${() => setPick(r.uids[0])} aria-label=${`${r.name} ×${r.count}`}>
        <${GearIcon} id=${r.id} catalog=${catalog} plain=${true} /><b class="num">${r.count}</b>
        ${r.permit ? html`<i class="ix-dgear__permit" aria-hidden="true"></i>` : !r.badge && r.level ? html`<small class="num">${r.level}级</small>` : null}
      </button>`)}</div>
      <div class="ix-dgear__text"><b>${row.name}${row.elite ? html`<em class="ix-elite">精锐</em>` : null}</b>${row.permit ? html`<span class="ix-perm"><${GameText} text="交接凭证" catalog=${catalog} /></span>` : null}
        <${GameText} text=${row.badge && row.count > 1 ? (badgeTotal(g, row.count) || g.normal) : row.elite ? g.elite : g.normal} catalog=${catalog} />
        ${onConfigure && g.steamOptions?.length ? html`<${HammerPicker} g=${g} item=${item} busy=${busy} catalog=${catalog} onSave=${(ids) => onConfigure(item.uid, ids)} />` : null}</div>`
      : html`<p class="t-dim dempty">${note || '尚未穿戴装备：把库存格子拖到干员身上即可穿戴'}</p>`}
    ${attachments.length ? html`<div class="ix-dgear__att"><b>附加效果</b>${attachments.map((a) => html`<span key=${a.id}><${GameText} text=${catalog.attachments?.[a.id]?.name || ''} catalog=${catalog} /></span>`)}</div>` : null}
    ${rows.some((r) => r.permit) ? html`<${TermNotes} texts=${['交接凭证']} catalog=${catalog} />` : null}
  </section>`;
}

/** The skill tab's choice: each skill's icon (the 干员调配 screen's), the chosen one lit; a tap changes it in the prep. */
function SkillChoice({ base, golden, piece, busy, prep, onAct }) {
  const m = data.get('assets');
  const opt = chessOptions(base, golden);
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
function OperatorCard({ piece, slot, state, catalog, busy, live, snapHp = null, inBattle = false, onAct, footer = null }) {
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
    ? html`<${GearSection} key="equip" items=${piece.equipment} attachments=${piece.attachments || []} catalog=${catalog} busy=${busy} title="装备"
        onConfigure=${prep ? (itemUid, ids) => onAct({ type: 'configure-equipment', targetUid: piece.uid, itemUid, hammerSourceIds: ids }) : null} />`
    : html`<${GearSection} key="equip" items=${[...(opBase?.permitGear ? [{ id: opBase.permitGear, uid: 'permit', quantity: 1 }] : []), ...(slot.equipment || []).map((x, i) => ({ ...x, uid: `c${i}` }))]}
        catalog=${catalog} title="随干员获得" note="获得时带来的装备写在特质里；这张卡没有附带别的装备" />`;
  const blocks = ChessDetail({ chess, piece: null, snapHp, editable: false, loadout, live,
    chips: html`<${FactionChips} factions=${piece ? piece.factions : (data.lookup('chess', slot.id)?.bonds || []).map((b) => TAVERN_FACTIONS[b]).filter(Boolean)}
      level=${piece ? piece.equipmentLevel ?? 0 : null} catalog=${catalog} />`,
    overrides: { garrison: html`<${TraitSection} key="garrison" op=${opBase} elite=${!!piece?.elite} catalog=${catalog} piece=${piece} busy=${busy} prep=${prep} onAct=${onAct} />`, equip: gear, actions: null } });
  const head = blocks.find((b) => b?.key === 'head');
  const panes = { traits: [], stats: [], skill: [], talent: [], gear: [] };
  for (const b of blocks) if (b && b.key !== 'head' && TAB_OF[b.key]) panes[TAB_OF[b.key]].push(b);
  if (piece) {
    panes.skill.unshift(html`<${SkillChoice} key="skillchoice" base=${base} golden=${golden} piece=${piece} busy=${busy} prep=${prep} onAct=${onAct} />`);
    panes.talent.unshift(html`<${ModuleChoice} key="modulechoice" base=${base} golden=${golden} piece=${piece} busy=${busy} prep=${prep} onAct=${onAct} />`);
    if (piece.bodyPenaltyApplied) panes.stats.push(html`<p key="penalty" class="ix-note"><${GameText} text="已承受接装损耗：原生攻击力与最大生命值为80%" catalog=${catalog} /></p>`);
  }
  const shown = TABS.filter(([k]) => panes[k].length);
  const cur = shown.some(([k]) => k === tab) ? tab : shown[0]?.[0];
  // two columns on a wide screen (head + stats | tabs + pane + actions), one column elsewhere (css .ix-dop)
  return html`<div class="ix-dop"><div class="ix-dop__main">
    <div class="ix-dpanel__head">${head}</div>
    ${panes.stats.length ? html`<div class="ix-dpanel__stats">${panes.stats}</div>` : null}
    </div><div class="ix-dop__side">
    <div class="ix-dtabs" role="tablist">${shown.map(([k, label]) => html`<button type="button" key=${k} role="tab" aria-selected=${cur === k ? 'true' : 'false'}
      class=${cx('ix-dtabs__tab', cur === k && 'is-on')} onClick=${() => setTab(k)}>${label}${k === 'gear' && piece ? html`<span class="num">${piece.equipment.reduce((n, x) => n + (x.quantity || 1), 0)}</span>` : null}</button>`)}</div>
    <div class="ix-dpanel__pane" role="tabpanel">${panes[cur]}</div>
    ${footer}</div></div>`;
}

/**
 * The card for a detail target: { kind: 'piece', uid } | { kind: 'shop', slot } | { kind: 'gear', id, elite } (a shop
 * gear) | { kind: 'enemy', id, count } (the pen) | { kind: 'unit', unit } (a battle unit) | { kind: 'terrain', terrain }.
 * `battle` (during a replay): { snapHp(unitId), stats(unitId) } read 4× a second, like the original card's live getter.
 */
export function DetailCard({ target, state, catalog, busy, battle = null, shopOpen = false, onClose, onAct, onInherit, onBuy, onEquipHere }) {
  const [confirmSell, setConfirmSell] = useState(false);
  useEffect(() => setConfirmSell(false), [target?.uid, target?.slot]);
  useTicker(battle && target ? 250 : 0);
  if (!target) return null;
  const frame = (body, kind) => html`<aside class=${cx('dpanel', 'brackets', 'dpanel--right', shopOpen && 'is-shop', 'ix-dpanel', `ix-dpanel--${kind}`)} data-testid="ix-detail" role="dialog" aria-label="详情">
    <button type="button" class="dpanel__close" aria-label="关闭" onClick=${onClose}><${Icon} name="close" /></button>
    <div class="ix-dpanel__body">${body}</div>
  </aside>`;
  if (target.kind === 'gear') {
    const g = catalog.gear[target.id] || {};
    const body = target.elite ? g.elite : g.normal;
    return frame(html`<header class="ix-dgearhead"><${GearIcon} id=${target.id} catalog=${catalog} plain=${true} /><div><h3 class="dhead__name">${g.name || ''}${target.elite ? html`<em class="ix-elite">精锐</em>` : null}</h3>
        <span class="ix-muted">${gearMeta(g, target.elite)}</span></div></header>
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
    if (piece) return frame(html`<${OperatorCard} piece=${piece} state=${state} catalog=${catalog} busy=${busy} live=${liveEntry} snapHp=${hp} inBattle=${true} onAct=${onAct} />`, 'chess');
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
  const footer = html`<footer class="ix-dpanel__actions">
    ${hint ? html`<span class="ix-dpanel__hint" role="note">${hint.text}</span>` : null}
    ${isShop ? html`<${Button} size="sm" variant="primary" disabled=${busy || slot.sold || state.funds < slot.price} onClick=${() => onBuy(target.slot)}>购买 · ${slot.price}<//>` : null}
    ${piece && prep ? html`
      <${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onEquipHere(piece.uid)}>库存<//>
      ${piece.handover?.give?.length || piece.handover?.take?.length ? html`<${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onInherit(piece.uid)}>交接<//>` : null}
      ${isDeployed(piece) ? html`<${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onAct({ type: 'bench', uid: piece.uid })}>撤回<//>` : null}
      ${confirmSell
        ? html`<${Button} size="sm" variant="danger" disabled=${busy} onClick=${() => onAct({ type: 'sell', uid: piece.uid })}>确认出售 +${catalog.rules?.sellPrice ?? 1}<//>`
        : html`<${Button} size="sm" variant="danger" disabled=${busy} onClick=${() => setConfirmSell(true)} title="装备与附加效果会一起失去">出售 +${catalog.rules?.sellPrice ?? 1}<//>`}` : null}
  </footer>`;
  return frame(html`<${OperatorCard} key=${piece ? piece.uid : `s${target.slot}`} piece=${piece} slot=${slot} state=${state} catalog=${catalog} busy=${busy} live=${live}
    onAct=${onAct} footer=${footer} />`, 'chess');
}
