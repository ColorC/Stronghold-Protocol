// 罗德岛战备演习 detail layer and the panels the player opens: detail card, inventory, offers (prize / recruit /
// attachment / operator merge), inheritance preview and the round result. Full texts live here, never on the HUD.
import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal, MicroLabel, TierChip } from '../ui/components.js';
import { Img, CoinGlyph, UnitThumb } from '../ui/gameComponents.js';
import { chessPortraitUrl, profIconUrl } from '../ui/assetUrls.js';
import { data } from '../data.js';
import { GearIcon, TraitGlyphs } from './hud.js';
import { formEntry, groupEquipment, inventoryStacks, isDeployed, renderChessId, inheritedLevel } from './model.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const STAT_ROWS = [['maxHp', '生命'], ['atk', '攻击'], ['def', '防御'], ['res', '法术抗性'], ['blockCnt', '阻挡'], ['bat', '攻击间隔']];
const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(2).replace(/\.?0+$/, ''));

/** "基础攻击力 +120" for n badges of one kind (catalog gear: stat / value / ratio). */
function badgeTotal(g, n) {
  if (!g?.statName || typeof g.value !== 'number') return null;
  const v = g.value * n;
  return `${g.statName} +${g.ratio ? `${fmt(v * 100)}%` : fmt(v)}`;
}

/** 战栗维式重锤's variants (configure-equipment hammerSourceIds), chosen when it is worn. */
function HammerPicker({ g, item, busy, catalog, onSave }) {
  const [picks, setPicks] = useState(item?.state?.hammerSourceIds || []);
  const limit = (item?.elite ? g.steamLimit?.elite : g.steamLimit?.normal) ?? g.steamLimit ?? 1;
  const toggle = (id) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < limit ? [...p, id] : p));
  return html`<span class="ix-usepick"><span class="ix-muted">选择款式（最多 ${limit} 种）</span>
    ${g.steamOptions.map((id) => html`<button type="button" key=${id} class=${cx('ix-chip', picks.includes(id) && 'is-on')} onClick=${() => toggle(id)}>${catalog.gear[id]?.name || ''}</button>`)}
    <${Button} size="sm" variant="primary" disabled=${busy || !picks.length} onClick=${() => onSave(picks)}>保存<//></span>`;
}

function EquipmentList({ items, catalog, busy, onConfigure }) {
  const rows = groupEquipment(items, catalog);
  if (!rows.length) return html`<p class="ix-muted">没有穿戴装备。</p>`;
  return html`<ul class="ix-eq">
    ${rows.map((r) => {
      const g = catalog.gear[r.id] || {};
      const item = (items || []).find((x) => x.uid === r.uids[0]);
      return html`<li key=${r.uids[0]} class=${cx('ix-eq__row', r.badge && 'is-badge')}>
        <${GearIcon} id=${r.id} catalog=${catalog} />
        <span class="ix-eq__name">${r.name}${r.elite ? html`<em>精锐</em>` : null}</span>
        <span class="ix-eq__lv num">${r.level ?? 1}级</span>
        <span class="ix-eq__n num">×${r.count}</span>
        <span class="ix-eq__fx">${r.badge ? badgeTotal(g, r.count) || g.normal : (r.elite ? g.elite : g.normal)}
          ${onConfigure && g.steamOptions?.length ? html`<${HammerPicker} g=${g} item=${item} busy=${busy} catalog=${catalog} onSave=${(ids) => onConfigure(item.uid, ids)} />` : null}</span>
      </li>`;
    })}
  </ul>`;
}

const PRODUCTION_BADGES = ['precision', 'agility', 'vitality', 'defense', 'assault', 'recovery'];

/** Both forms' trait texts; the form the piece is in comes first and lit. */
function TraitTexts({ op, elite }) {
  const t = op?.traitTexts || {};
  return html`<div class="ix-traittext">
    <p class=${cx(!elite && 'is-on')}><b>普通</b>${t.normal || ''}</p>
    <p class=${cx(elite && 'is-on')}><b>精锐</b>${t.elite || ''}</p>
  </div>`;
}

function PermissionLine({ op }) {
  const perm = op?.permission;
  if (!perm) return html`<p class="ix-muted">没有交接资格；若对方的交接词条允许，仍可交接。</p>`;
  return html`<p class="ix-perm-line"><span class="ix-perm">${perm.direction === '接收' ? '可继承其他干员' : '可被继承'}</span>
    ${perm.gear || perm.wording ? html`<b>${perm.gear || perm.wording}</b>` : null}${perm.limit || ''}</p>`;
}

/** The operator's own skills (data/chess.json records, the order of the session's skillIndex). */
function SkillPicker({ piece, chess, busy, onLoadout }) {
  const skills = chess?.skills || [];
  if (skills.length < 2) return null;
  return html`<div class="ix-skills">
    ${skills.map((s, i) => html`<button type="button" key=${i} class=${cx('ix-chip', piece.skillIndex === i && 'is-on')} disabled=${busy || piece.skillIndex === i}
      onClick=${() => onLoadout(i)} title=${s.desc || s.name || ''}>${s.name || `技能 ${i + 1}`}</button>`)}
  </div>`;
}

/**
 * Detail card of an own piece, a shop operator or a piece of gear (target: { kind: 'piece', uid } | { kind: 'shop',
 * slot } | { kind: 'gear', id, elite }). Sections fold; 本体 and 装备 start open (design: 干员详情卡).
 */
export function DetailCard({ target, state, catalog, busy, onClose, onAct, onInherit, onBuy, onEquipHere, onCopyLink }) {
  const [confirmSell, setConfirmSell] = useState(false);
  useEffect(() => setConfirmSell(false), [target?.uid, target?.slot]);
  if (!target) return null;
  if (target.kind === 'gear') {
    const g = catalog.gear[target.id] || {};
    return html`<aside class="ix-detail" data-testid="ix-detail"><button type="button" class="ix-detail__close" onClick=${onClose} aria-label="关闭"><${Icon} name="close" /></button>
      <header class="ix-detail__head"><${GearIcon} id=${target.id} catalog=${catalog} /><div><h2>${g.name || target.id}</h2><span class="ix-muted">${g.kind || ''} · ${(target.elite ? g.eliteLevel : g.level) ?? 1}级${g.unique ? ' · 同名唯一' : ''}</span></div></header>
      <p class="ix-detail__text">${target.elite ? g.elite : g.normal}</p>
    </aside>`;
  }
  const isShop = target.kind === 'shop';
  const slot = isShop ? state.shop.slots[target.slot] : null;
  const piece = isShop ? null : state.pieces.find((p) => p.uid === target.uid);
  if (!slot && !piece) return null;
  const op = isShop ? catalog.operators[slot.id] : formEntry(catalog, piece);
  const chessId = isShop ? slot.id : renderChessId(catalog, piece);
  const c = data.lookup('chess', chessId);
  const m = data.get('assets');
  const elite = !!piece?.elite;
  const stats = piece?.bodyStats || c?.stats || {};
  const raw = piece?.rawBodyStats;
  return html`<aside class="ix-detail" data-testid="ix-detail">
    <button type="button" class="ix-detail__close" onClick=${onClose} aria-label="关闭"><${Icon} name="close" /></button>
    <header class="ix-detail__head">
      <${Img} src=${chessPortraitUrl(m, c)} class="ix-detail__art" />
      <div>
        <h2>${op?.name || chessId}${elite ? html`<em class="ix-elite">精锐</em>` : null}</h2>
        <span class="ix-detail__meta"><${TierChip} tier=${op?.tier || 1} size="sm" /><${Img} src=${profIconUrl(m, op?.profession)} class="ix-detail__prof" />${c?.subProfessionName || ''}
          ${piece?.factions?.length ? html`<span class="ix-muted">${piece.factions.join('·')}</span>` : null}</span>
        ${piece ? html`<span class="ix-detail__eqlv">装备总等级 <b class="num">${piece.equipmentLevel}</b></span>` : null}
        ${onCopyLink ? html`<button type="button" class="ix-linkbtn" onClick=${() => onCopyLink(piece ? `piece-${piece.uid}` : `shop-${target.slot}`)}><${Icon} name="link" />复制链接</button>` : null}
      </div>
    </header>
    <details open>
      <summary>本体</summary>
      <dl class="ix-stats">${STAT_ROWS.map(([k, label]) => (stats[k] != null ? html`<div key=${k}><dt>${label}</dt><dd class="num">${fmt(stats[k])}${raw && raw[k] !== stats[k] ? html`<s class="num">${fmt(raw[k])}</s>` : null}</dd></div>` : null))}</dl>
      ${raw ? html`<p class="ix-note">已承受接装损耗：原生攻击与最大生命按 ${Math.round((catalog.rules?.bodyPenalty?.baseAttackRatio ?? 0.8) * 100)}% 计算（划线为损耗前）。</p>` : null}
      ${(() => {
        const sk = (piece ? c?.skills?.[piece.skillIndex] : null) || c?.skill;
        return sk ? html`<p class="ix-skill"><b>技能 · ${sk.name}</b>${sk.desc || ''}</p>` : null;
      })()}
      ${piece ? html`<${SkillPicker} piece=${piece} chess=${c} busy=${busy} onLoadout=${(i) => onAct({ type: 'loadout', uid: piece.uid, skillIndex: i, moduleId: piece.moduleId })} />` : null}
      <h4>自有特质</h4>
      <${TraitGlyphs} summary=${op?.summary} elite=${elite} catalog=${catalog} max=${4} />
      ${piece && (op?.summary || []).some((e) => e.kind === 'copy' && e.items) ? html`<div class="ix-usepick"><span class="ix-muted">没有可复制的产出时，战后改为锻造</span>
        ${PRODUCTION_BADGES.map((id) => html`<button type="button" key=${id} class=${cx('ix-chip', (piece.preferences?.productionBadge || 'precision') === id && 'is-on')} disabled=${busy || state.phase !== 'prep'}
          onClick=${() => onAct({ type: 'configure', uid: piece.uid, productionBadge: id })}>${catalog.gear[id]?.name || id}</button>`)}</div>` : null}
      <${TraitTexts} op=${catalog.operators[isShop ? slot.id : piece.chessId]} elite=${elite} />
      <h4>交接资格</h4>
      <${PermissionLine} op=${catalog.operators[isShop ? slot.id : piece.chessId]} />
    </details>
    ${piece ? html`<details open>
      <summary>装备 · ${piece.equipment.reduce((n, x) => n + (x.quantity || 1), 0)}/${catalog.rules?.equipmentCapacity ?? 99} 件</summary>
      <${EquipmentList} items=${piece.equipment} catalog=${catalog} busy=${busy}
        onConfigure=${state.phase === 'prep' ? (itemUid, ids) => onAct({ type: 'configure-equipment', targetUid: piece.uid, itemUid, hammerSourceIds: ids }) : null} />
      <p class="ix-note">已穿戴的装备不能拆下或替换；出售该干员会销毁其全部装备与附加效果。</p>
    </details>` : null}
    ${piece?.attachments?.length ? html`<details open>
      <summary>外来附加效果</summary>
      <ul class="ix-att">${piece.attachments.map((a) => html`<li key=${a.id}><b>${catalog.attachments?.[a.id]?.name || a.id}</b>${catalog.attachments?.[a.id]?.effect || ''}</li>`)}</ul>
    </details>` : null}
    ${slot && slot.equipment?.length ? html`<details open><summary>随商品附带</summary><${EquipmentList} items=${slot.equipment.map((x, i) => ({ ...x, uid: `c${i}` }))} catalog=${catalog} />
      <p class="ix-note">购买时一同获得；刷新商店会丢失。</p></details>` : null}
    <footer class="ix-detail__actions">
      ${isShop ? html`<${Button} size="sm" variant="primary" disabled=${busy || slot.sold || state.funds < slot.price} onClick=${() => onBuy(target.slot)}>购买 · ${slot.price}<//>` : null}
      ${piece && state.phase === 'prep' ? html`
        <${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onEquipHere(piece.uid)}>穿戴装备<//>
        <${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onInherit(piece.uid)}>交接<//>
        ${isDeployed(piece) ? html`<${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => onAct({ type: 'bench', uid: piece.uid })}>撤回<//>` : null}
        ${confirmSell
          ? html`<${Button} size="sm" variant="danger" disabled=${busy} onClick=${() => onAct({ type: 'sell', uid: piece.uid })}>确认出售 +${catalog.rules?.sellPrice ?? 1}<//>`
          : html`<${Button} size="sm" variant="danger" disabled=${busy} onClick=${() => setConfirmSell(true)} title="出售会销毁其全部装备与附加效果">出售 +${catalog.rules?.sellPrice ?? 1}<//>`}` : null}
    </footer>
  </aside>`;
}

// ---- inventory ----------------------------------------------------------------------------------------------------

/** What a supply asks for when used (prizes.js useInventoryItem): one operator, n operators, n shop slots or a faction. */
const USE_NEEDS = { upgradeChess: 'target', promoteOnUse: 'targets', recruitOnUse: 'source', copyOperatorOnUse: 'source', shopRecruitOnUse: 'slots',
  factionRecruitOnUse: 'faction', saleThresholdRecruit: 'faction' };

/** The second step of a supply that needs a choice; nothing is sent until the choice is complete. */
function UsePicker({ stack, state, catalog, busy, onAct, onCancel }) {
  const need = USE_NEEDS[stack.mechanism];
  const g = catalog.gear[stack.id] || {};
  const count = (stack.elite ? g.useCount?.elite : g.useCount?.normal) || 1;
  const [picked, setPicked] = useState([]);
  const itemUid = stack.items[0].uid;
  const toggle = (x) => setPicked((p) => (p.includes(x) ? p.filter((y) => y !== x) : p.length < count ? [...p, x] : [...p.slice(1), x]));
  const confirm = (extra) => onAct({ type: 'use-item', itemUid, ...extra });
  let body = null;
  if (need === 'faction') {
    const factions = [...new Set(state.pieces.filter(isDeployed).flatMap((p) => p.factions || []))];
    body = factions.length ? factions.map((f) => html`<button type="button" key=${f} class="ix-chip" disabled=${busy} onClick=${() => confirm({ faction: f })}>${f}</button>`)
      : html`<span class="ix-muted">场上没有阵营干员</span>`;
  } else if (need === 'slots') {
    const slots = state.shop.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'chess' && !s.sold);
    body = html`${slots.map(({ s, i }) => html`<button type="button" key=${i} class=${cx('ix-chip', picked.includes(i) && 'is-on')} onClick=${() => toggle(i)}>${catalog.operators[s.id]?.name || ''}</button>`)}
      <${Button} size="sm" variant="primary" disabled=${busy || picked.length !== count} onClick=${() => confirm({ slots: picked })}>确认（${picked.length}/${count}）<//>`;
  } else {
    const needsElite = need === 'target' || need === 'targets';
    const eligible = state.pieces.filter((p) => !p.elite && (!needsElite || catalog.operators[p.chessId]?.eliteChessId));
    const many = need === 'targets';
    body = html`${eligible.map((p) => html`<button type="button" key=${p.uid} class=${cx('ix-chip', picked.includes(p.uid) && 'is-on')} disabled=${busy}
        onClick=${() => (many ? toggle(p.uid) : confirm(need === 'source' ? { sourceUid: p.uid } : { targetUid: p.uid }))}>${formEntry(catalog, p)?.name || ''}</button>`)}
      ${many ? html`<${Button} size="sm" variant="primary" disabled=${busy || picked.length !== count} onClick=${() => confirm({ targets: picked })}>确认（${picked.length}/${count}）<//>` : null}
      ${!eligible.length ? html`<span class="ix-muted">没有可以选择的普通干员</span>` : null}`;
  }
  return html`<div class="ix-usepick"><span class="ix-muted">${need === 'faction' ? '选择阵营' : need === 'slots' ? `选择 ${count} 个商店干员` : `选择${count > 1 ? ` ${count} 名` : '一名'}普通干员`}</span>
    ${body}<button type="button" class="ix-chip" onClick=${onCancel}>取消</button></div>`;
}

/**
 * The inventory: every stack with its full effect. Gear is worn by the chosen operator (n badges at once); supplies,
 * facilities and kept prizes are used, asking first for what they need; two normal copies merge into the elite one.
 * Wearing is final (design: 不能主动拆卸或替换), so the panel says so.
 */
export function InventoryPanel({ open, state, catalog, busy, targetUid, onTarget, onClose, onAct }) {
  const stacks = inventoryStacks(state.inventory, catalog);
  const [qty, setQty] = useState({});
  const [using, setUsing] = useState(null);
  const [tags, setTags] = useState({});
  useEffect(() => { if (!open) setUsing(null); }, [open]);
  const target = state.pieces.find((p) => p.uid === targetUid) || null;
  const used = target ? target.equipment.reduce((n, x) => n + (x.quantity || 1), 0) : 0;
  const room = (catalog.rules?.equipmentCapacity ?? 99) - used;
  const run = async (action) => { const res = await onAct(action); if (res) setUsing(null); };
  return html`<${Modal} open=${open} title="装备库存" micro="INVENTORY" onClose=${onClose} width="min(9.8rem, 94vw)" class="ix-inv">
    <div class="ix-inv__target">
      <span>穿戴到</span>
      <select value=${targetUid || ''} onChange=${(e) => onTarget(e.currentTarget.value || null)} data-testid="ix-inv-target">
        <option value="">选择干员</option>
        ${state.pieces.map((p) => html`<option key=${p.uid} value=${p.uid}>${formEntry(catalog, p)?.name || ''}${p.elite ? '（精锐）' : ''} · ${isDeployed(p) ? '在场' : '整备区'} · 装备${p.equipmentLevel}级</option>`)}
      </select>
      ${target ? html`<span class="ix-muted">还可穿戴 <b class="num">${room}</b> 件；穿戴后不能拆下或替换</span>` : html`<span class="ix-muted">先选择干员，再点「穿戴」</span>`}
    </div>
    ${stacks.length ? html`<ul class="ix-inv__list">
      ${stacks.map((s) => {
        const g = catalog.gear[s.id] || {};
        const n = Math.max(1, Math.min(qty[s.key] || 1, s.count, Math.max(1, room)));
        const mergeable = !s.used && !s.badge && !s.elite && g.eliteLevel != null && s.count >= 2;
        const tagFactions = g.identityFactions || null;
        return html`<li key=${s.key} class="ix-inv__row" data-testid=${`ix-inv-${s.id}`}>
          <${GearIcon} id=${s.id} catalog=${catalog} />
          <div class="ix-inv__text">
            <b>${s.name}${s.elite ? html`<em>精锐</em>` : null}</b><span class="num">${s.level != null ? `${s.level}级 · ` : ''}×${s.count}</span>
            <p>${s.text || ''}</p>
            ${using === s.key ? html`<${UsePicker} stack=${s} state=${state} catalog=${catalog} busy=${busy} onAct=${run} onCancel=${() => setUsing(null)} />` : null}
          </div>
          <div class="ix-inv__act">
            ${s.used ? html`<${Button} size="sm" variant="secondary" disabled=${busy || using === s.key}
                onClick=${() => (USE_NEEDS[s.mechanism] ? setUsing(s.key) : run({ type: 'use-item', itemUid: s.items[0].uid }))}>使用<//>`
              : html`
              ${s.badge && s.count > 1 ? html`<span class="ix-qty">
                <button type="button" onClick=${() => setQty({ ...qty, [s.key]: Math.max(1, n - 1) })} aria-label="减少">−</button><b class="num">${n}</b>
                <button type="button" onClick=${() => setQty({ ...qty, [s.key]: Math.min(s.count, n + 1) })} aria-label="增加">+</button>
                <button type="button" onClick=${() => setQty({ ...qty, [s.key]: Math.min(s.count, Math.max(1, room)) })}>全部</button></span>` : null}
              ${tagFactions ? html`<select value=${tags[s.key] || ''} onChange=${(e) => setTags({ ...tags, [s.key]: e.currentTarget.value })} aria-label="身份标签阵营">
                <option value="">选择阵营</option>${tagFactions.map((f) => html`<option key=${f} value=${f}>${f}</option>`)}</select>` : null}
              <${Button} size="sm" variant="primary" disabled=${busy || !target || room < n || (tagFactions && !tags[s.key])} title="穿戴后不能拆下"
                onClick=${() => run({ type: 'equip', itemUid: s.items[0].uid, targetUid: target.uid, quantity: s.badge ? n : 1, ...(tagFactions ? { faction: tags[s.key] } : {}) })}>
                穿戴${s.badge && n > 1 ? ` ${n} 件` : ''}<//>`}
            ${mergeable ? html`<${Button} size="sm" variant="secondary" disabled=${busy} title="两件同名普通装备合成一件精锐装备"
                onClick=${() => run({ type: 'merge-item', firstUid: s.items[0].uid, secondUid: (s.items[1] || s.items[0]).uid })}>合成精锐<//>` : null}
          </div>
        </li>`;
      })}
    </ul>` : html`<p class="ix-muted">库存是空的。干员的自有特质、暗月奖品和商店会带来装备。</p>`}
  <//>`;
}

// ---- offers -------------------------------------------------------------------------------------------------------

const PRIZE_TARGET = { attachmentOffer: 'deployed', promoteOperator: 'normal' };

function OperatorChoice({ chessId, catalog, onPick, busy }) {
  const op = catalog.operators[chessId] || {};
  const c = data.lookup('chess', chessId);
  return html`<button type="button" class="ix-choice ix-choice--op" disabled=${busy} onClick=${onPick}>
    <${Img} src=${chessPortraitUrl(data.get('assets'), c)} class="ix-choice__art" />
    <span class="ix-choice__head"><${TierChip} tier=${op.tier || 1} size="sm" /><b>${op.name || chessId}</b></span>
    <${TraitGlyphs} summary=${op.summary} catalog=${catalog} />
    <p>${op.traitTexts?.normal || ''}</p>
  </button>`;
}

/**
 * The first open offer as an overlay: 暗月奖品 (three cards, full text; a prize that needs an operator asks for it
 * next), free recruits, attachment picks and the 三连 unique-conflict choice.
 */
export function OfferOverlay({ offer, state, catalog, busy, onChoose }) {
  const [prizeIndex, setPrizeIndex] = useState(null);
  const [picks, setPicks] = useState({});
  useEffect(() => { setPrizeIndex(null); setPicks({}); }, [offer?.id]);
  if (!offer) return null;
  let title = '请选择'; let micro = 'CHOICE'; let body = null;
  if (offer.type === 'prize') {
    title = '暗月奖品'; micro = 'DARKMOON PRIZE';
    const chosen = prizeIndex != null ? catalog.prizes[offer.choices[prizeIndex]] : null;
    const need = chosen ? PRIZE_TARGET[chosen.mechanism] : null;
    if (need) {
      const eligible = state.pieces.filter((p) => (need === 'deployed' ? isDeployed(p) : !p.elite));
      body = html`<p class="ix-note">${chosen.name}：选择一名${need === 'deployed' ? '在场' : '普通'}干员。</p>
        <div class="ix-choices ix-choices--pieces">${eligible.map((p) => html`<button type="button" key=${p.uid} class="ix-choice ix-choice--piece" disabled=${busy}
          onClick=${() => onChoose({ type: 'choose', offerId: offer.id, index: prizeIndex, targetUid: p.uid })}>
          <${UnitThumb} kind="chess" id=${renderChessId(catalog, p)} golden=${!!p.elite} size="md" /><b>${formEntry(catalog, p)?.name}</b></button>`)}</div>
        <${Button} variant="ghost" onClick=${() => setPrizeIndex(null)}>返回奖品<//>`;
    } else {
      body = html`<div class="ix-choices">${offer.choices.map((id, i) => {
        const p = catalog.prizes[id] || { name: '罗德岛采购券', effect: '获得一级罗德岛采购券，放入装备库存。' };
        return html`<button type="button" key=${id} class="ix-choice ix-choice--prize" disabled=${busy} data-testid=${`ix-prize-${i}`}
          onClick=${() => (PRIZE_TARGET[p.mechanism] ? setPrizeIndex(i) : onChoose({ type: 'choose', offerId: offer.id, index: i }))}>
          <${MicroLabel}>${p.stage || ''}<//><b>${p.name}</b><p>${p.effect}</p></button>`;
      })}</div>`;
    }
  } else if (offer.type === 'recruit') {
    title = '免费招募'; micro = 'RECRUIT';
    body = html`<div class="ix-choices">${offer.choices.map((id, i) => html`<${OperatorChoice} key=${id} chessId=${id} catalog=${catalog} busy=${busy}
      onPick=${() => onChoose({ type: 'choose', offerId: offer.id, index: i })} />`)}</div>`;
  } else if (offer.type === 'attachment') {
    title = '专项战备授训'; micro = 'ATTACHMENT';
    const target = state.pieces.find((p) => p.uid === offer.targetUid);
    body = html`<p class="ix-note">为 ${formEntry(catalog, target || {})?.name || '该干员'} 永久附加一项效果，不占装备格、不计装备等级。</p>
      <div class="ix-choices">${offer.choices.map((id, i) => html`<button type="button" key=${id} class="ix-choice" disabled=${busy}
        onClick=${() => onChoose({ type: 'choose', offerId: offer.id, index: i })}><b>${catalog.attachments?.[id]?.name || id}</b><p>${catalog.attachments?.[id]?.effect || ''}</p></button>`)}</div>`;
  } else if (offer.type === 'operatorMerge') {
    title = '三连晋升'; micro = 'PROMOTION';
    const owner = (uid) => formEntry(catalog, state.pieces.find((p) => p.uid === uid) || {})?.name || uid;
    const eq = offer.conflicts?.equipment || []; const att = offer.conflicts?.attachments || [];
    const missing = eq.some((c) => !picks[`equipment:${c.key}`]) || att.some((c) => !picks[`attachment:${c.id}`]);
    body = html`<p class="ix-note">三份 ${catalog.operators[offer.chessId]?.name || ''} 将合成精锐。同名唯一的装备和附加效果只能保留一份，其余销毁，不退回库存。</p>
      ${eq.map((c) => html`<fieldset key=${c.key} class="ix-pick"><legend>${catalog.gear[c.choices[0]?.id]?.name || c.key}</legend>
        ${c.choices.map((x) => html`<label key=${x.uid}><input type="radio" name=${`m-${c.key}`} checked=${picks[`equipment:${c.key}`] === x.uid}
          onChange=${() => setPicks({ ...picks, [`equipment:${c.key}`]: x.uid })} />保留 ${owner(x.ownerUid)} 身上的这件</label>`)}</fieldset>`)}
      ${att.map((c) => html`<fieldset key=${c.id} class="ix-pick"><legend>${catalog.attachments?.[c.id]?.name || c.id}</legend>
        ${c.choices.map((x) => html`<label key=${x.ownerUid}><input type="radio" name=${`a-${c.id}`} checked=${picks[`attachment:${c.id}`] === x.ownerUid}
          onChange=${() => setPicks({ ...picks, [`attachment:${c.id}`]: x.ownerUid })} />保留 ${owner(x.ownerUid)} 的这项</label>`)}</fieldset>`)}
      <${Button} variant="primary" disabled=${busy || missing} onClick=${() => onChoose({ type: 'choose', offerId: offer.id, uniqueSelections: picks })}>确认合成<//>`;
  }
  return html`<div class="ix-offer" role="dialog" aria-label=${title} data-testid="ix-offer">
    <div class="ix-offer__box"><header><${MicroLabel}>${micro}<//><h2>${title}</h2></header>${body}</div>
  </div>`;
}

// ---- inheritance --------------------------------------------------------------------------------------------------

const INHERIT_ERRORS = {
  NO_PERMISSION: '双方都不满足交接条件：要看一方的交接词条（科技等级、原生阵营、职业）是否允许另一方。',
  BAD_TILE: '旧本体必须在场，且新本体能站在旧本体的位置上。',
  CAPACITY: '新本体的装备会超过 99 件。',
  BAD_TARGET: '请选择另一名干员。',
};

function StatLine({ label, before, after }) {
  return html`<div class="ix-cmp__row"><span>${label}</span><b class="num">${before ?? '—'}</b><span aria-hidden="true">→</span><b class="num">${after ?? '—'}</b></div>`;
}

/**
 * Inheritance: one piece is chosen; the player picks the other side and its role, the server previews (read-only,
 * no revision), and the panel lists before → after, kept and destroyed parts and unique choices before 确认交接.
 */
export function InheritPanel({ open, state, catalog, busy, fromUid, onClose, preview, onPreview, onConfirm }) {
  const [role, setRole] = useState('donor'); // the chosen piece gives (donor) or receives
  const [other, setOther] = useState(null);
  const [picks, setPicks] = useState({});
  useEffect(() => { setOther(null); setPicks({}); }, [fromUid, open]);
  const from = state.pieces.find((p) => p.uid === fromUid);
  const donorUid = role === 'donor' ? fromUid : other; const receiverUid = role === 'donor' ? other : fromUid;
  useEffect(() => { if (open && donorUid && receiverUid) onPreview(donorUid, receiverUid); }, [open, donorUid, receiverUid]);
  if (!open || !from) return null;
  const name = (p) => (p ? `${formEntry(catalog, p)?.name || p.uid}${p.elite ? '（精锐）' : ''}` : '');
  const donor = state.pieces.find((p) => p.uid === donorUid); const receiver = state.pieces.find((p) => p.uid === receiverUid);
  const pv = preview && preview.donorUid === donorUid && preview.receiverUid === receiverUid ? preview : (preview?.ok === false ? preview : null);
  const ratio = pv?.penalty || 0;
  const conflicts = pv?.equipmentConflicts || pv?.conflicts || [];
  const attConflicts = pv?.attachmentConflicts || [];
  const missing = conflicts.some((c) => !picks[c.id]) || attConflicts.some((c) => !picks[`attachment:${c.id}`]);
  return html`<${Modal} open=${open} title="干员交接" micro="INHERITANCE" onClose=${onClose} width="min(10rem, 94vw)" class="ix-inherit">
    <div class="ix-inherit__role">
      <button type="button" class=${cx('ix-chip', role === 'donor' && 'is-on')} onClick=${() => setRole('donor')}>${name(from)} 交出装备（旧本体）</button>
      <button type="button" class=${cx('ix-chip', role === 'receiver' && 'is-on')} onClick=${() => setRole('receiver')}>${name(from)} 接收装备（新本体）</button>
    </div>
    <div class="ix-choices ix-choices--pieces">
      ${state.pieces.filter((p) => p.uid !== fromUid).map((p) => html`<button type="button" key=${p.uid} data-uid=${p.uid} class=${cx('ix-choice', 'ix-choice--piece', other === p.uid && 'is-on')}
        onClick=${() => setOther(p.uid)}><${UnitThumb} kind="chess" id=${renderChessId(catalog, p)} golden=${!!p.elite} size="sm" />
        <b>${name(p)}</b>${catalog.operators[p.chessId]?.permission ? html`<span class="ix-perm">交接</span>` : null}</button>`)}
    </div>
    ${other && !pv ? html`<p class="ix-muted">正在预览…</p>` : null}
    ${pv && !pv.ok ? html`<p class="ix-warn">${INHERIT_ERRORS[pv.error] || '这两名干员不能交接。'}</p>` : null}
    ${pv && pv.ok ? html`<div class="ix-cmp">
      <div class="ix-cmp__col"><h4>旧本体 · ${name(donor)}</h4>
        <p>离队，按出售结算一次（+${catalog.rules?.sellPrice ?? 1} 资金）；自有特质与交接资格随之消失。</p>
        ${(pv.destroyedEquipment || []).length ? html`<p class="ix-warn">销毁不能转移的装备：${groupEquipment(pv.destroyedEquipment, catalog).map((r) => `${r.name}×${r.count}`).join('、')}</p>` : null}
        ${(pv.destroyedAttachments || []).length ? html`<p class="ix-warn">消失的附加效果：${pv.destroyedAttachments.map((a) => catalog.attachments?.[a.id]?.name || a.id).join('、')}</p>` : null}
      </div>
      <div class="ix-cmp__col"><h4>新本体 · ${name(receiver)}</h4>
        ${ratio ? html`<${StatLine} label="原生攻击" before=${pv.newBodyStats?.atk} after=${Math.floor((pv.newBodyStats?.atk || 0) * ratio)} />
          <${StatLine} label="原生生命" before=${pv.newBodyStats?.maxHp} after=${Math.floor((pv.newBodyStats?.maxHp || 0) * (catalog.rules?.bodyPenalty?.baseLifeRatio ?? ratio))} />
          <p class="ix-note">接装损耗：原生攻击与最大生命按 ${Math.round(ratio * 100)}% 计算，先扣减再加装备；同一身体只扣一次。</p>`
          : html`<p class="ix-note">该干员已承受过接装损耗，不再重复扣减。</p>`}
        <${StatLine} label="装备总等级" before=${receiver?.equipmentLevel} after=${inheritedLevel(receiver, donor, pv, picks, catalog) ?? '先选择保留项'} />
        <p>站到旧本体的位置；获得可转移的装备${(pv.transferredAttachments || []).length ? html`与附加效果（${pv.transferredAttachments.map((a) => catalog.attachments?.[a.id]?.name || a.id).join('、')}）` : ''}。</p>
      </div>
    </div>
    ${conflicts.map((c) => html`<fieldset key=${c.id} class="ix-pick"><legend>${catalog.gear[c.id]?.name || c.id}（同名唯一）</legend>
      <label><input type="radio" name=${`i-${c.id}`} checked=${picks[c.id] === 'donor'} onChange=${() => setPicks({ ...picks, [c.id]: 'donor' })} />保留旧本体的这件</label>
      <label><input type="radio" name=${`i-${c.id}`} checked=${picks[c.id] === 'receiver'} onChange=${() => setPicks({ ...picks, [c.id]: 'receiver' })} />保留新本体原有的</label></fieldset>`)}
    ${attConflicts.map((c) => html`<fieldset key=${c.id} class="ix-pick"><legend>${catalog.attachments?.[c.id]?.name || c.id}（同名唯一）</legend>
      <label><input type="radio" name=${`ia-${c.id}`} checked=${picks[`attachment:${c.id}`] === 'donor'} onChange=${() => setPicks({ ...picks, [`attachment:${c.id}`]: 'donor' })} />保留旧本体的</label>
      <label><input type="radio" name=${`ia-${c.id}`} checked=${picks[`attachment:${c.id}`] === 'receiver'} onChange=${() => setPicks({ ...picks, [`attachment:${c.id}`]: 'receiver' })} />保留新本体的</label></fieldset>`)}
    <footer class="ix-inherit__foot"><${Button} variant="primary" disabled=${busy || missing}
      onClick=${() => onConfirm({ type: 'inherit', donorUid, receiverUid, uniqueSelections: picks })}>确认交接<//></footer>` : null}
  <//>`;
}

// ---- round result -------------------------------------------------------------------------------------------------

/** After a replay: win / loss of the round, LP lost, per-operator damage and healing, what went into the inventory. */
export function ResultPanel({ battle, catalog, pieces, onClose, finished }) {
  const res = battle?.result || {};
  const mine = res.perPlayer?.independent || Object.values(res.perPlayer || {})[0] || {};
  // unitStats rows: { uid, defId, name, kind, dmg, heal, kills, taken } (sim Battle.result)
  const stats = (mine.unitStats || []).filter((u) => u.kind === 'op' || u.uid).sort((a, b) => (b.dmg || 0) - (a.dmg || 0));
  const top = Math.max(1, ...stats.map((u) => u.dmg || 0));
  return html`<div class="ix-result" role="dialog" aria-label="战斗结算" data-testid="ix-result">
    <div class="ix-result__box">
      <header><${MicroLabel}>ROUND ${battle.round}<//><h2>${finished ? (finished === 'win' ? '演习完成' : '防线失守') : battle.lpLost ? `损失 ${battle.lpLost} 点生命` : '防线完好'}</h2>
        <span class="ix-muted">击倒 ${mine.killed ?? res.killed ?? 0}/${mine.total ?? res.total ?? 0}${(mine.leaked || []).length ? ` · 漏过 ${(mine.leaked || []).length}` : ''}</span></header>
      ${stats.length ? html`<ul class="ix-dmg">${stats.slice(0, 8).map((u) => html`<li key=${u.uid || u.id}>
        <span>${u.name || catalog.operators[u.defId]?.name || ''}</span>
        <span class="ix-dmg__bar"><i style=${`width:${Math.round(((u.dmg || 0) / top) * 100)}%`}></i></span>
        <b class="num">${Math.round(u.dmg || 0)}</b><small class="num">${u.heal ? `治疗 ${Math.round(u.heal)}` : u.kills ? `击倒 ${u.kills}` : ''}</small></li>`)}</ul>` : null}
      <footer><${Button} variant="primary" onClick=${onClose} data-testid="ix-result-ok">${finished ? '查看最终阵容' : '继续备战'}<//></footer>
    </div>
  </div>`;
}
