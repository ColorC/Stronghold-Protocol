// 卫戍协议：工坊 panels the player opens (the detail card is detail.js): inventory, offers (prize / recruit /
// attachment / operator merge), inheritance preview and the round result. Full texts live here, never on the HUD.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal, MicroLabel, TierChip, DifficultyTag } from '../ui/components.js';
import { copyComponentLink } from './componentLinks.js';
import { Img, CoinGlyph, UnitThumb, LpTower, Sprite } from '../ui/gameComponents.js';
import { chessAvatarUrl, chessPortraitUrl, enemyIconUrl, uiUrl, pageAssetUrl } from '../ui/assetUrls.js';
import { audio } from '../audio.js';
import { data } from '../data.js';
import { TraitGlyphs } from './hud.js';
import { GearIcon, GameText, TermNotes } from './text.js';
import { formEntry, groupEquipment, inventoryStacks, isDeployed, renderChessId, inheritedLevel, permitsOf } from './model.js';
import { badgeEffectText } from './badgeText.js';
import { fieldConditionPiecesForEffect } from '../../../shared/independentEligibility.js';
import { trainingChoiceOptions } from '../../../shared/independentTrainingChoice.js';
import { PROF_NAME } from '../ui/loadoutModel.js';
import { OriginalCardRefs } from './detail.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(2).replace(/\.?0+$/, ''));

/** "基础攻击力 +120" for n badges of one kind (catalog gear: stat / value / ratio). */
export function badgeTotal(g, n) {
  const percentage = badgeEffectText(g?.id, n);
  if (percentage) return percentage;
  if (!g?.statName || typeof g.value !== 'number') return null;
  const v = g.value * n;
  return `${g.statName} +${g.ratio ? `${fmt(v * 100)}%` : fmt(v)}`;
}

/** 战栗维式重锤's variants (configure-equipment hammerSourceIds), chosen when it is worn. */
export function HammerPicker({ g, item, busy, catalog, onSave }) {
  const [picks, setPicks] = useState(item?.state?.hammerSourceIds || []);
  const limit = Number(g.steamLimit) || 1;
  const toggle = (id) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < limit ? [...p, id] : p));
  return html`<span class="ix-usepick"><span class="ix-muted">选择款式（最多 ${limit} 种）</span>
    ${g.steamOptions.map((id) => html`<button type="button" key=${id} class=${cx('ix-chip', picks.includes(id) && 'is-on')} onClick=${() => toggle(id)}>${catalog.gear[id]?.name || ''}</button>`)}
    <${Button} size="sm" variant="primary" disabled=${busy || !picks.length} onClick=${() => onSave(picks)}>保存<//></span>`;
}


export const PRODUCTION_BADGES = ['precision', 'agility', 'damage', 'recovery'];

const deliveryText = (delivery) => typeof delivery === 'string' ? delivery
  : [delivery?.text, delivery?.description, delivery?.message].filter((x) => typeof x === 'string' && x.trim()).join(' · ');
const fieldPlacementKey = (pieces) => pieces.map((p) => `${p.uid}:${p.row ?? ''},${p.col ?? ''}`).sort().join('|');

/** A count belongs beside the effect text; focusing or hovering it previews the matching field tiles. */
export function fieldConditionRows(effects = [], { source, state, catalog, rangeTilesFor = null } = {}) {
  const rows = [];
  const seen = new Set();
  for (const entry of effects || []) {
    const effect = entry?.rule || entry;
    const pieces = fieldConditionPiecesForEffect(effect, { pieces: state?.pieces || [], catalog, source,
      rangeTiles: effect?.behavior === 'aura' ? rangeTilesFor?.(source) : null });
    if (pieces == null) continue;
    const ids = pieces.map((p) => p.uid).sort();
    const key = `${effect?.behavior}:${JSON.stringify(effect?.params || {})}:${ids.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, pieces, effect, trigger: entry?.when || effect?.trigger, title: deliveryText(entry?.effectDelivery || effect?.effectDelivery) || '当前场上符合这一效果条件的干员' });
  }
  return rows;
}

export function FieldConditionCounts({ effects = [], rows = null, source, state, catalog, active = false, defaultParticipants = [], onFieldHighlight = null, rangeTilesFor = null }) {
  const fieldRows = rows || fieldConditionRows(effects, { source, state, catalog, rangeTilesFor });
  const union = [...new Map((active ? fieldRows.flatMap((row) => row.pieces) : defaultParticipants).map((p) => [p.uid, p])).values()];
  const highlightKey = fieldPlacementKey(union);
  useEffect(() => {
    if (!active) return undefined;
    onFieldHighlight?.(union);
    return () => onFieldHighlight?.([]);
  }, [onFieldHighlight, active, highlightKey]);
  if (!fieldRows.length) return null;
  const restore = (event) => {
    if (event?.relatedTarget?.closest?.('.ix-dtabs')) return;
    onFieldHighlight?.(union);
  };
  return html`<span class="ix-field-counts" aria-label="当前场上符合条件的友方单位">${fieldRows.map((row) => html`<button type="button" key=${row.key}
      class="ix-field-count" title=${`${row.title}：${row.pieces.length ? row.pieces.map((p) => formEntry(catalog, p)?.name || p.name || '作战支援单位').join('、') : '当前没有符合条件的友方单位'}`} aria-label=${`${row.title}（${row.pieces.length}）`}
      onMouseEnter=${() => onFieldHighlight?.(row.pieces)} onMouseLeave=${restore}
      onFocus=${() => onFieldHighlight?.(row.pieces)} onBlur=${restore}>（${row.pieces.length}）</button>`)}</span>`;
}

/** Both forms' trait texts (the current one lit) and, under them, every item and term they name. */
export function TraitTexts({ op, elite, catalog, growthMode='badges', piece = null, state = null, onFieldHighlight = null, rangeTilesFor = null }) {
  const t = op?.traitTexts || {};
  const normal=growthMode==='levels'?t.normalLevels:t.normal, advanced=growthMode==='levels'?t.eliteLevels:t.elite;
  const source = piece || { chessId: op?.chessId, elite, growthMode, growthLevel: 1 };
  const normalRows = fieldConditionRows(op?.summary || [], { source, state, catalog, rangeTilesFor });
  const eliteSource = piece ? { ...piece, elite: true } : { ...source, elite: true };
  const eliteRows = fieldConditionRows(op?.summaryElite || [], { source: eliteSource, state, catalog, rangeTilesFor });
  const currentRows = elite ? eliteRows : normalRows;
  const defaultParticipants = [...new Map(currentRows.flatMap((row) => row.pieces).map((p) => [p.uid, p])).values()];
  const highlightKey = fieldPlacementKey(defaultParticipants);
  useEffect(() => {
    onFieldHighlight?.(defaultParticipants);
    return () => onFieldHighlight?.([]);
  }, [onFieldHighlight, highlightKey]);
  const renderForm = (text, rows) => {
    const clauses = String(text || '').split(/(?<=[；;。\n])/).filter(Boolean);
    const assigned = clauses.map(() => []);
    for (const row of rows) {
      const p = row.effect?.params || {};
      const trigger = row.trigger || '';
      const target = typeof p.targets === 'string' ? p.targets : '';
      const factionTerms = [p.faction, p.triggerFaction, p.targetFaction, p.requiresFactionOnField, p.match?.faction,
        target.startsWith('faction:') ? target.slice('faction:'.length) : null].filter(Boolean);
      const keywordTerms = [p.match?.keywordGear].filter(Boolean);
      const professions = [...(p.match?.professions || []), p.match?.profession,
        target.startsWith('profession:') ? target.slice('profession:'.length) : null].filter(Boolean);
      const deploymentPayloadCondition = p.match?.deploymentPayload === true;
      const explicitCondition = factionTerms.length || keywordTerms.length || professions.length
        || deploymentPayloadCondition || row.effect?.behavior === 'dominantFactionRecruit' || row.effect?.behavior === 'forgeAdjacent';
      const matchesSpecificClause = (clause) => {
        if (factionTerms.some((faction) => clause.includes(faction))) return true;
        if (keywordTerms.some((keyword) => clause.includes(keyword))) return true;
        if (professions.some((profession) => clause.includes(PROF_NAME[profession] || profession))) return true;
        if (deploymentPayloadCondition && /战斗部署效果/.test(clause)) return true;
        if (row.effect?.behavior === 'dominantFactionRecruit' && clause.includes('所在行')) return true;
        if (row.effect?.behavior === 'forgeAdjacent' && /身前|前方|相邻|周围/.test(clause)) return true;
        return false;
      };
      const matchesTriggerClause = (clause) => {
        const triggerWords = { prepEnd: ['整备结束', '休整期结束'], roundStart: ['进入休整期'], battleStart: ['战斗开始', '开战'], deploy: ['部署'], attack: ['攻击'], allyKill: ['击倒敌人'], kill: ['击倒敌人'], death: ['退场'], allyDeath: ['退场'], shieldLayersBroken: ['护盾'], gain: ['新获得', '首次上阵'] }[trigger] || [];
        return triggerWords.some((word) => clause.includes(word));
      };
      let index = clauses.findIndex(matchesSpecificClause);
      if (index < 0 && !explicitCondition) index = clauses.findIndex(matchesTriggerClause);
      if (index < 0 && rows.length === 1 && clauses.length === 1) index = 0;
      if (index >= 0) assigned[index].push(row);
    }
    return clauses.map((clause, index) => html`<span class="ix-traittext__line" key=${index}><${GameText} text=${clause} catalog=${catalog} />
      <${FieldConditionCounts} rows=${assigned[index]} state=${state} catalog=${catalog} source=${source} active=${false}
        defaultParticipants=${defaultParticipants} onFieldHighlight=${onFieldHighlight} /></span>`);
  };
  return html`<div class="ix-traittext">
    <p class=${cx(!elite && 'is-on')}><b>普通</b>${renderForm(normal, normalRows)}</p>
    <p class=${cx(elite && 'is-on')}><b>精锐</b>${renderForm(advanced, eliteRows)}</p>
    <${TermNotes} texts=${[normal,advanced]} catalog=${catalog} />
  </div>`;
}

/** Words for the gear kinds that are ids in the catalog. */
const KIND_LABEL = { equipment: '装备', prizeGear: '特供装备' };

/** The line under a shop gear's name: what kind of gear it is, its stack contribution and the rule it carries. */
export function gearMeta(g) {
  if(g.mechanism==='growthTraining')return '用于提升干员训练等级';
  if (g.kind === 'badge' || g.kind === '徽章') return '基础徽章 · 可重复装备';
  return `${KIND_LABEL[g.kind] || g.kind || ''} · 装备叠加×${g.level ?? 1}${g.unique ? ' · 同名只能装备一件' : ''}`;
}

// ---- inventory ----------------------------------------------------------------------------------------------------

/** What a supply asks for before it is used: an own operator (target / targets / source), shop places or a faction. */
export const USE_NEEDS = { upgradeChess: 'target', promoteOnUse: 'targets', recruitOnUse: 'source', copyOperatorOnUse: 'source', shopRecruitOnUse: 'slots',
  factionRecruitOnUse: 'faction', saleThresholdRecruit: 'faction', darkmoonTargetPrize:'friendly' };

function usePieceChoices(need, stack, state, catalog) {
  const needsElite = need === 'target' || need === 'targets';
  const normalPrize = ['BGS_Treasures_016', 'BGS_Treasures_034'].includes(stack.params?.sourceId);
  return state.pieces.filter((piece) => (need === 'friendly' ? !normalPrize || !piece.elite : !piece.elite)
    && (!needsElite || !!catalog.operators[piece.chessId]?.eliteChessId));
}

function beginUseTarget({ need, count, stack, eligible, onBeginTarget, onCancelTarget, submit }) {
  const fieldKey = need === 'source' ? 'sourceUid' : need === 'targets' ? 'targets' : 'targetUid';
  const label = need === 'source' ? '点击标记的普通干员作为来源' : need === 'target'
    ? '点击标记的未精锐干员领取成长补给' : '点击标记的普通干员领取补给';
  onBeginTarget?.({ label, closePanel: true, onCancel: onCancelTarget,
    choices: eligible.map((piece) => ({ kind: 'friendly', uid: piece.uid })), emptyText: '当前没有符合条件的干员',
    submit: ({ uid }) => submit(fieldKey === 'targets' ? { targets: [uid] } : { [fieldKey]: uid }) });
}

/** The second step of a supply that needs a choice; nothing is sent until the choice is complete. */
function UsePicker({ stack, state, catalog, busy, onAct, onCancel, onBeginTarget, onCancelTarget }) {
  const need = USE_NEEDS[stack.mechanism];
  const g = catalog.gear[stack.id] || {};
  const count = Number(g.useCount) || 1;
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
    const eligible = usePieceChoices(need, stack, state, catalog);
    const many = need === 'targets' && count > 1;
    const singleTarget = need === 'target' || need === 'source' || (need === 'targets' && count === 1);
    body = html`${eligible.map((p) => html`<button type="button" key=${p.uid} class=${cx('ix-chip', picked.includes(p.uid) && 'is-on')} disabled=${busy}
        onClick=${() => {
          if (many) toggle(p.uid);
          else if (singleTarget) beginUseTarget({ need, count, stack, eligible, onBeginTarget, onCancelTarget, submit: (extra) => confirm(extra) });
          else confirm(need === 'source' ? { sourceUid: p.uid } : { targetUid: p.uid });
        }}>${formEntry(catalog, p)?.name || ''}</button>`)}
      ${many ? html`<${Button} size="sm" variant="primary" disabled=${busy || picked.length !== count} onClick=${() => confirm({ targets: picked })}>确认（${picked.length}/${count}）<//>` : null}
      ${!eligible.length ? html`<span class="ix-muted">没有可以选择的干员</span>` : null}`;
  }
  return html`<div class="ix-usepick"><span class="ix-muted">${need === 'faction' ? '选择阵营' : need === 'slots' ? `选择 ${count} 个商店干员` : `选择${count > 1 ? ` ${count} 名` : '一名'}${need==='friendly'?'':'普通'}干员`}</span>
    ${body}<button type="button" class="ix-chip" onClick=${onCancel}>取消</button></div>`;
}

/**
 * The inventory: the stock's tiles (as many places as it holds, catalog.rules.inventoryCapacity) on the left, the
 * chosen tile's full effect and actions on the right — a fixed grid, no scrolling list. Gear is worn by the chosen
 * operator (n badges at once); supplies, facilities and kept prizes are used, asking first for what they need. Gear has
 * one form only (no 合成精锐, owner 2026-10-07). Wearing is final (design: 不能主动拆卸或替换), so the panel says so.
 */
export function InventoryPanel({ open, focus = null, state, catalog, busy, targetUid, onTarget, onClose, onAct, onBeginTarget, onCancelTarget }) {
  const stacks = inventoryStacks(state.inventory, catalog);
  const [qty, setQty] = useState({});
  const [using, setUsing] = useState(null);
  const [prizeReference,setPrizeReference] = useState(false);
  const [tags, setTags] = useState({});
  const [pick, setPick] = useState(null);
  useEffect(() => { if (!open) setUsing(null); else if (focus) setPick(focus); }, [open, focus]);
  const target = state.pieces.find((p) => p.uid === targetUid) || null;
  const used = target ? target.equipment.reduce((n, x) => n + (x.quantity || 1), 0) : 0;
  const room = (catalog.rules?.equipmentCapacity ?? 999) - used;
  const run = async (action) => { const res = await onAct(action); if (res) setUsing(null); };
  const capacity = Math.max(catalog.rules?.inventoryCapacity ?? 20, stacks.length);
  const s = stacks.find((x) => x.key === pick) || stacks[0] || null;
  const g = s ? catalog.gear[s.id] || {} : null;
  const many = s?.badge || g?.quantityEquippable === true;
  const n = s ? Math.max(1, Math.min(qty[s.key] || 1, s.count, Number(s.items[0]?.quantity || 1), Math.max(1, room))) : 1;
  const tagFactions = g?.identityFactions || null;
  const equipChoices = s && !s.used ? state.pieces.filter((p) => {
    const levelGrowth = state.growthMode === 'levels' && (catalog.badges?.[s.id] || g?.mechanism === 'badge' || g?.mechanism === 'growthTraining');
    if (levelGrowth) return Number(p.growthLevel ?? 1) < Number(p.growthMaximum ?? catalog.config?.maxGrowthLevel ?? Number.MAX_SAFE_INTEGER);
    if (p.equipment.reduce((sum, item) => sum + Number(item.quantity || 1), 0) >= (catalog.rules?.equipmentCapacity ?? 999)) return false;
    if (g?.unique && p.equipment.some((item) => {
      const other = catalog.gear[item.id] || {};
      return (other.uniqueKey || other.canonicalId || item.id) === (g.uniqueKey || g.canonicalId || s.id);
    })) return false;
    return true;
  }) : [];
  return html`<${Modal} open=${open} title="装备库存" micro="INVENTORY" onClose=${onClose} width="min(10.4rem, 96vw)" class="ix-inv">
    <div class="ix-inv__target">
      ${target ? html`<span class=${room <= 0 ? 'ix-warn' : 'ix-muted'}>已选${formEntry(catalog, target)?.name || '干员'} · ${room <= 0 ? '装备已满' : '穿上后无法卸下'}</span>` : html`<span class="ix-muted">点选「穿戴」后，直接点击场上或整备区干员</span>`}
      ${stacks.filter((x) => x.kind !== '奖品').length >= (catalog.rules?.inventoryCapacity ?? 20) ? html`<span class="ix-warn" role="status">库存已满</span>` : null}
    </div>
    <div class="ix-inv__body">
      <div class="ix-inv__grid" role="listbox" aria-label="库存">
        ${Array.from({ length: capacity }, (_, i) => {
          const x = stacks[i];
          if (!x) return html`<span key=${`e${i}`} class="ix-inv__cell is-empty" aria-hidden="true"></span>`;
          return html`<button type="button" key=${x.key} role="option" aria-selected=${String(x === s)} class=${cx('ix-inv__cell', x === s && 'is-on')}
              data-testid=${`ix-inv-${x.id}`} title=${x.name} onContextMenu=${(e) => copyComponentLink(e, `stock-${x.key}`)} onClick=${() => { setPick(x.key); setUsing(null); setPrizeReference(false); }}>
            <${GearIcon} id=${x.id} catalog=${catalog} plain=${true} />
            <b class="num">×${x.count}</b>
            <small>${x.name}</small>
          </button>`;
        })}
      </div>
      <div class="ix-inv__sel">
        ${s ? html`<header class="ix-inv__head"><${GearIcon} id=${s.id} catalog=${catalog} plain=${true} />
            <div class="ix-inv__text"><b>${s.name}</b><span class="num">${!s.badge && !s.used && s.level != null ? `装备叠加×${s.level} · ` : ''}库存×${s.count}</span></div></header>
          ${catalog.prizes[s.id]?.sourceRefs?.cards?.length ? html`<div class="ix-usepick" role="tablist" aria-label="奖品说明"><button type="button" role="tab" aria-selected=${String(!prizeReference)} onClick=${()=>setPrizeReference(false)}>工坊效果</button><button type="button" role="tab" aria-selected=${String(prizeReference)} onClick=${()=>setPrizeReference(true)}>参考原卡</button></div>` : null}
          ${prizeReference ? html`<${OriginalCardRefs} op=${catalog.prizes[s.id]} linkAnchor=${'stock-'+s.key} />` : html`<p class="ix-inv__desc"><${GameText} text=${s.text} catalog=${catalog} /></p>`}
          <${FieldConditionCounts} effects=${g?.params?.effects || []} source=${target} state=${state} catalog=${catalog} active=${true} />
          <${TermNotes} texts=${[s.text]} catalog=${catalog} exclude=${s.name} />
            ${using === s.key ? html`<${UsePicker} stack=${s} state=${state} catalog=${catalog} busy=${busy} onAct=${run} onCancel=${() => setUsing(null)} onBeginTarget=${onBeginTarget} onCancelTarget=${onCancelTarget} />` : null}
            <div class="ix-inv__act">
              ${s.used ? html`<${Button} size="sm" variant="secondary" disabled=${busy || using === s.key}
                  onClick=${() => {
                    const need = USE_NEEDS[s.mechanism];
                  if (s.mechanism === 'darkmoonTargetPrize') {
                    const normalOnly = ['BGS_Treasures_016', 'BGS_Treasures_034'].includes(s.params?.sourceId);
                    const choices = state.pieces.filter((p) => !normalOnly || !p.elite).map((p) => ({ kind: 'friendly', uid: p.uid }));
                      onBeginTarget?.({ label: '点击标记的场上或整备区友方干员领取奖品效果', closePanel: true, onCancel: onCancelTarget, choices, emptyText: '当前没有符合条件的友方干员',
                      submit: ({ uid }) => onAct({ type: 'use-item', itemUid: s.items[0].uid, targetUid: uid }) });
                    } else if (need === 'target') {
                      const choices = state.pieces.filter((p) => !p.elite && catalog.operators[p.chessId]?.eliteChessId).map((p) => ({ kind: 'friendly', uid: p.uid }));
                      onBeginTarget?.({ label: '点击标记的场上或整备区干员领取成长补给', closePanel: true, onCancel: onCancelTarget, choices, emptyText: '当前没有符合条件的干员',
                        submit: ({ uid }) => onAct({ type: 'use-item', itemUid: s.items[0].uid, targetUid: uid }) });
                    } else if (need === 'source' || (need === 'targets' && (Number(g?.useCount) || 1) === 1)) {
                      const eligible = usePieceChoices(need, s, state, catalog);
                      beginUseTarget({ need, count: Number(g?.useCount) || 1, stack: s, eligible, onBeginTarget, onCancelTarget,
                        submit: (extra) => onAct({ type: 'use-item', itemUid: s.items[0].uid, ...extra }) });
                    } else if (need) setUsing(s.key);
                  else run({ type: 'use-item', itemUid: s.items[0].uid });
                }}>使用<//>`
              : html`
              ${many && s.count > 1 ? html`<span class="ix-qty">
                <button type="button" onClick=${() => setQty({ ...qty, [s.key]: Math.max(1, n - 1) })} aria-label="减少">−</button><b class="num">${n}</b>
                <button type="button" onClick=${() => setQty({ ...qty, [s.key]: Math.min(s.count, n + 1) })} aria-label="增加">+</button>
                <button type="button" onClick=${() => setQty({ ...qty, [s.key]: Math.min(s.count, Math.max(1, room)) })}>全部</button></span>` : null}
              ${tagFactions ? html`<select value=${tags[s.key] || ''} onChange=${(e) => setTags({ ...tags, [s.key]: e.currentTarget.value })} aria-label="身份标签阵营">
                <option value="">选择阵营</option>${tagFactions.map((f) => html`<option key=${f} value=${f}>${f}</option>`)}</select>` : null}
              ${!equipChoices.length ? html`<span role="status" class="ix-warn">当前没有符合条件的装备目标</span>` : null}
              <${Button} size="sm" variant="primary" disabled=${busy || !equipChoices.length || (target && !equipChoices.some((p) => p.uid === target.uid)) || (tagFactions && !tags[s.key])} title="穿上后无法卸下"
                onClick=${() => {
                  const action = (uid) => run({ type: 'equip', itemUid: s.items[0].uid, targetUid: uid, quantity: many ? n : 1, ...(tagFactions ? { faction: tags[s.key] } : {}) });
                  if (target) action(target.uid);
                  else onBeginTarget?.({ label: '点击标记的场上或整备区友方干员穿戴装备', closePanel: true, onCancel: onCancelTarget, choices: equipChoices.map((p) => ({ kind: 'friendly', uid: p.uid })), emptyText: '没有可以穿戴这件装备的干员', submit: ({ uid }) => action(uid) });
                }}>
                ${target ? (many && n > 1 ? `穿戴 ${n} 件` : '穿戴') : (many && n > 1 ? `穿戴 ${n} 件 · 点选干员` : '穿戴 · 点选干员')}<//>
          </div>` : html`<p class="ix-muted">库存为空</p>`}
      </div>
    </div>
  <//>`;
}

// ---- offers -------------------------------------------------------------------------------------------------------

const PRIZE_TARGET = { attachmentOffer: 'deployed', promoteOperator: 'normal' };

function OperatorChoice({ chessId, catalog, onPick, busy, growthMode = 'badges' }) {
  const op = catalog.operators[chessId] || {};
  const c = data.lookup('chess', chessId);
  const traitText = growthMode === 'levels' ? op.traitTexts?.normalLevels : op.traitTexts?.normal;
  return html`<button type="button" class="ix-choice ix-choice--op" disabled=${busy} onClick=${onPick}>
    <${Img} src=${chessPortraitUrl(data.get('assets'), c) || chessAvatarUrl(data.get('assets'), c)} alt=${op.name || chessId} class="ix-choice__art" />
    <span class="ix-choice__head"><${TierChip} tier=${op.tier || 1} size="sm" /><b>${op.name || chessId}</b></span>
    <${TraitGlyphs} summary=${op.summary} catalog=${catalog} growthMode=${growthMode} />
    <p><${GameText} text=${traitText} catalog=${catalog} /></p>
    <${TermNotes} texts=${[traitText]} catalog=${catalog} />
  </button>`;
}

/**
 * The first open offer as an overlay: 工程部特供 (three cards, full text and the notes of what they give; one that
 * needs an operator asks for it next), free recruits, attachment picks and the 三连 unique-conflict choice.
 */
export function OfferOverlay({ offer, state, catalog, busy, onChoose, onBeginTarget }) {
  const [prizeIndex, setPrizeIndex] = useState(null);
  const [picks, setPicks] = useState({});
  useEffect(() => { setPrizeIndex(null); setPicks({}); }, [offer?.id]);
  if (!offer) return null;
  let title = '请选择'; let micro = 'CHOICE'; let body = null;
  if (offer.type === 'prize') {
    const stage = catalog.prizes[offer.choices[0]]?.stage;
    title = stage ? `工程部特供 · ${stage}` : '工程部特供'; micro = 'ENGINEERING SUPPLY';
    const chosen = prizeIndex != null ? catalog.prizes[offer.choices[prizeIndex]] : null;
    const need = chosen ? PRIZE_TARGET[chosen.mechanism] : null;
    if (need) {
      const eligible = state.pieces.filter((p) => (need === 'deployed'
        ? (chosen.mechanism === 'attachmentOffer' ? trainingChoiceOptions(state, catalog, p).length > 0 : isDeployed(p))
        : !p.elite && !!catalog.operators[p.chessId]?.eliteChessId));
      body = html`<p class="ix-note">${chosen.name}：选择一名${need === 'deployed' ? '场上' : '普通'}干员</p>
        <div class="ix-choices ix-choices--pieces"><button type="button" class="ix-choice ix-choice--piece" disabled=${busy || !eligible.length}
          onClick=${() => onBeginTarget?.({ label: need === 'deployed' ? '点击标记的场上干员' : '点击标记的场上或整备区普通干员', closeOffer: true,
            choices: eligible.map((p) => ({ kind: 'friendly', uid: p.uid })), emptyText: '当前没有符合条件的目标',
            submit: ({ uid }) => onChoose({ type: 'choose', offerId: offer.id, index: prizeIndex, targetUid: uid }) })}>
          ${eligible.length ? '在场上选择干员' : '当前没有符合条件的目标'}</button></div>
        <${Button} variant="ghost" onClick=${() => setPrizeIndex(null)}>返回<//>`;
    } else {
      body = html`<div class="ix-choices">${offer.choices.map((id, i) => {
        const p = catalog.prizes[id] || { name: '罗德岛采购券', effect: '获得1张罗德岛采购券' };
        return html`<button type="button" key=${id} class="ix-choice ix-choice--prize" disabled=${busy} data-testid=${`ix-prize-${i}`}
          onClick=${() => (PRIZE_TARGET[p.mechanism] ? setPrizeIndex(i) : onChoose({ type: 'choose', offerId: offer.id, index: i }))}>
          <${GearIcon} id=${id} catalog=${catalog} plain=${true} /><b>${p.name}</b><p><${GameText} text=${p.effect} catalog=${catalog} /></p>
          <${TermNotes} texts=${[p.effect]} catalog=${catalog} /></button>`;
      })}</div>`;
    }
  } else if (offer.type === 'recruit') {
    // a promotion's reward (session.js pushPromotionReward) is the original's 晋升奖励
    title = offer.source === 'merge' ? `晋升奖励 · 科技等级${offer.tier}的干员任选一名` : '免费招募'; micro = offer.source === 'merge' ? 'PROMOTION REWARD' : 'RECRUIT';
    body = html`<div class="ix-choices">${offer.choices.map((id, i) => html`<${OperatorChoice} key=${id} chessId=${id} catalog=${catalog} growthMode=${state.growthMode || 'badges'} busy=${busy}
      onPick=${() => onChoose({ type: 'choose', offerId: offer.id, index: i })} />`)}</div>`;
   } else if (offer.type === 'logistics') {
     title='后勤改组';micro='LOGISTICS';
     body=html`<div class="ix-choices">${offer.choices.map((id,i)=>html`<button type="button" key=${id} class="ix-choice ix-choice--prize" disabled=${busy} onClick=${()=>onChoose({type:'choose',offerId:offer.id,index:i})}><${GearIcon} id=${id} catalog=${catalog} plain=${true} /><b>${catalog.prizes[id]?.name}</b><p>${catalog.prizes[id]?.effect}</p></button>`)}</div>`;
   } else if (offer.type === 'attachment') {
    title = '专项战备授训'; micro = 'ATTACHMENT';
    const target = state.pieces.find((p) => p.uid === offer.targetUid);
    body = html`<p class="ix-note">${offer.trainingChoice
      ? `为${formEntry(catalog, target || {})?.name || '干员'}选择一项永久附加效果，或将一件装备直接配发给该干员`
      : `为${formEntry(catalog, target || {})?.name || '干员'}选择一项附加效果（永久生效，不占装备栏）`}</p>
      <div class="ix-choices">${offer.choices.map((id, i) => html`<button type="button" key=${id} class="ix-choice" disabled=${busy}
        onClick=${() => onChoose({ type: 'choose', offerId: offer.id, index: i })}><${GearIcon} id=${id} catalog=${catalog} plain=${true} />
        <b>${catalog.attachments?.[id]?.name || catalog.gear?.[id]?.name || catalog.equipment?.[id]?.name || ''}</b>
        <p><${GameText} text=${catalog.attachments?.[id]?.effect || catalog.gear?.[id]?.effect || catalog.equipment?.[id]?.effect} catalog=${catalog} /></p>
        <${TermNotes} texts=${[catalog.attachments?.[id]?.effect || catalog.gear?.[id]?.effect || catalog.equipment?.[id]?.effect]} catalog=${catalog} /></button>`)}</div>`;
  } else if (offer.type === 'operatorMerge') {
    title = '晋升精锐'; micro = 'PROMOTION';
    const owner = (uid) => formEntry(catalog, state.pieces.find((p) => p.uid === uid) || {})?.name || '';
    const eq = offer.conflicts?.equipment || []; const att = offer.conflicts?.attachments || [];
    const missing = eq.some((c) => !picks[`equipment:${c.key}`]) || att.some((c) => !picks[`attachment:${c.id}`]);
    body = html`<p class="ix-note">三名${catalog.operators[offer.chessId]?.name || ''}将合成精锐。下列装备只能各留一件，其余随合成失去：</p>
      ${eq.map((c) => html`<fieldset key=${c.key} class="ix-pick"><legend>${catalog.gear[c.choices[0]?.id]?.name || c.key}</legend>
        ${c.choices.map((x) => html`<label key=${x.uid}><input type="radio" name=${`m-${c.key}`} checked=${picks[`equipment:${c.key}`] === x.uid}
          onChange=${() => setPicks({ ...picks, [`equipment:${c.key}`]: x.uid })} />留下${owner(x.ownerUid)}身上的</label>`)}</fieldset>`)}
      ${att.map((c) => html`<fieldset key=${c.id} class="ix-pick"><legend>${catalog.attachments?.[c.id]?.name || ''}</legend>
        ${c.choices.map((x) => html`<label key=${x.ownerUid}><input type="radio" name=${`a-${c.id}`} checked=${picks[`attachment:${c.id}`] === x.ownerUid}
          onChange=${() => setPicks({ ...picks, [`attachment:${c.id}`]: x.ownerUid })} />留下${owner(x.ownerUid)}的</label>`)}</fieldset>`)}
      <${Button} variant="primary" disabled=${busy || missing} onClick=${() => onChoose({ type: 'choose', offerId: offer.id, uniqueSelections: picks })}>晋升<//>`;
  }
  return html`<div class="ix-offer" role="dialog" aria-label=${title} data-testid="ix-offer">
    <div class="ix-offer__box"><header><${MicroLabel}>${micro}<//><h2>${title}</h2></header>${body}</div>
  </div>`;
}

// ---- inheritance --------------------------------------------------------------------------------------------------

const INHERIT_ERRORS = {
  NO_PERMISSION: '双方的交接凭证都不允许这次交接',
  BAD_TILE: '交出装备的一方需要在场，且接收方能部署在那个位置',
  CAPACITY: '接收方的装备会超出穿戴上限',
  BAD_TARGET: '请换一名干员',
};

function StatLine({ label, before, after }) {
  return html`<div class="ix-cmp__row"><span>${label}</span><b class="num">${before ?? '—'}</b><span aria-hidden="true">→</span><b class="num">${after ?? '—'}</b></div>`;
}

/**
 * Inheritance: one piece is chosen; the player picks its role and, among the pieces the 交接凭证 allow (the view's
 * handover lists), the other side; the server previews (read-only, no revision), and the panel lists before → after,
 * the 交接凭证 it rests on, kept and destroyed parts and unique choices before 确认交接.
 */
export function InheritPanel({ open, state, catalog, busy, fromUid, onClose, preview, onPreview, onConfirm }) {
  const [role, setRole] = useState('donor'); // the chosen piece gives (donor) or receives
  const [other, setOther] = useState(null);
  const [picks, setPicks] = useState({});
  useEffect(() => { setOther(null); setPicks({}); }, [fromUid, open]);
  const from = state.pieces.find((p) => p.uid === fromUid);
  const gives = from?.handover?.give || []; const takes = from?.handover?.take || [];
  useEffect(() => { if (open) setRole(gives.length || !takes.length ? 'donor' : 'receiver'); }, [fromUid, open]);
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
      <button type="button" class=${cx('ix-chip', role === 'donor' && 'is-on')} disabled=${!gives.length} onClick=${() => { setRole('donor'); setOther(null); }}>由${name(from)}交出装备</button>
      <button type="button" class=${cx('ix-chip', role === 'receiver' && 'is-on')} disabled=${!takes.length} onClick=${() => { setRole('receiver'); setOther(null); }}>由${name(from)}接收装备</button>
    </div>
    <div class="ix-choices ix-choices--pieces">
      ${state.pieces.filter((p) => (role === 'donor' ? gives : takes).includes(p.uid)).map((p) => html`<button type="button" key=${p.uid} data-uid=${p.uid} class=${cx('ix-choice', 'ix-choice--piece', other === p.uid && 'is-on')}
        onClick=${() => setOther(p.uid)}><${UnitThumb} kind="chess" id=${renderChessId(catalog, p)} golden=${!!p.elite} size="sm" />
        <b>${name(p)}</b>${permitsOf(p, catalog).map((id) => html`<${GearIcon} key=${id} id=${id} catalog=${catalog} plain=${true} class="ix-choice__permit" />`)}</button>`)}
    </div>
    ${!(role === 'donor' ? gives : takes).length ? html`<p class="ix-muted">没有可以交接的干员</p>` : null}
    ${other && !pv ? html`<p class="ix-muted">正在计算…</p>` : null}
    ${pv && !pv.ok ? html`<p class="ix-warn">${INHERIT_ERRORS[pv.error] || '这两名干员不能交接'}</p>` : null}
    ${pv && pv.ok && (pv.permit?.give || pv.permit?.receive) ? html`<p class="ix-inherit__by"><${GearIcon} id=${pv.permit.give || pv.permit.receive} catalog=${catalog} plain=${true} />
      <span>凭借${pv.permit.give ? name(donor) : name(receiver)}的<b>${catalog.gear[pv.permit.give || pv.permit.receive]?.name || ''}</b></span></p>` : null}
    ${pv && pv.ok ? html`<div class="ix-cmp">
      <div class="ix-cmp__col"><h4>交出 · ${name(donor)}</h4>
        <p>交出装备后离队，视为售出（+${catalog.rules?.sellPrice ?? 1}采购资金）</p>
        ${(pv.destroyedEquipment || []).length ? html`<p class="ix-warn">无法交出、随之失去：${groupEquipment(pv.destroyedEquipment, catalog).map((r) => `${r.name}×${r.count}`).join('、')}</p>` : null}
        ${(pv.destroyedAttachments || []).length ? html`<p class="ix-warn">随之失去的附加效果：${pv.destroyedAttachments.map((a) => catalog.attachments?.[a.id]?.name || '').join('、')}</p>` : null}
      </div>
      <div class="ix-cmp__col"><h4>接收 · ${name(receiver)}</h4>
        ${ratio ? html`<${StatLine} label="原生攻击" before=${pv.newBodyStats?.atk} after=${Math.floor((pv.newBodyStats?.atk || 0) * ratio)} />
          <${StatLine} label="原生生命" before=${pv.newBodyStats?.maxHp} after=${Math.floor((pv.newBodyStats?.maxHp || 0) * (catalog.rules?.bodyPenalty?.baseLifeRatio ?? ratio))} />
          <p class="ix-note"><${GameText} text="承受接装损耗" catalog=${catalog} /></p>`
          : html`<p class="ix-note"><${GameText} text="已承受过接装损耗，不再扣减" catalog=${catalog} /></p>`}
        <${StatLine} label="装备叠加总数" before=${receiver?.equipmentLevel} after=${inheritedLevel(receiver, donor, pv, picks, catalog) ?? '待选择'} />
        <p>部署到交出方的位置，接收其装备${(pv.transferredAttachments || []).length ? html`与附加效果（${pv.transferredAttachments.map((a) => catalog.attachments?.[a.id]?.name || '').join('、')}）` : ''}</p>
      </div>
    </div>
    ${conflicts.map((c) => html`<fieldset key=${c.id} class="ix-pick"><legend>${catalog.gear[c.id]?.name || ''}（只能装备一件）</legend>
      <label><input type="radio" name=${`i-${c.id}`} checked=${picks[c.id] === 'donor'} onChange=${() => setPicks({ ...picks, [c.id]: 'donor' })} />留下交出方的</label>
      <label><input type="radio" name=${`i-${c.id}`} checked=${picks[c.id] === 'receiver'} onChange=${() => setPicks({ ...picks, [c.id]: 'receiver' })} />留下接收方原有的</label></fieldset>`)}
    ${attConflicts.map((c) => html`<fieldset key=${c.id} class="ix-pick"><legend>${catalog.attachments?.[c.id]?.name || ''}（只能有一项）</legend>
      <label><input type="radio" name=${`ia-${c.id}`} checked=${picks[`attachment:${c.id}`] === 'donor'} onChange=${() => setPicks({ ...picks, [`attachment:${c.id}`]: 'donor' })} />留下交出方的</label>
      <label><input type="radio" name=${`ia-${c.id}`} checked=${picks[`attachment:${c.id}`] === 'receiver'} onChange=${() => setPicks({ ...picks, [`attachment:${c.id}`]: 'receiver' })} />留下接收方的</label></fieldset>`)}
    <footer class="ix-inherit__foot"><${Button} variant="primary" disabled=${busy || missing}
      onClick=${() => onConfirm({ type: 'inherit', donorUid, receiverUid, uniqueSelections: picks })}>确认交接<//></footer>` : null}
  <//>`;
}

// ---- round result -------------------------------------------------------------------------------------------------

/** After a replay: win / loss of the round, LP lost, per-operator damage and healing, what went into the inventory. */
export function ResultPanel({ battle, catalog, pieces, onClose, finished, review = false }) {
  const res = battle?.result || {};
  const mine = res.perPlayer?.independent || Object.values(res.perPlayer || {})[0] || {};
  // unitStats rows: { uid, defId, name, kind, dmg, heal, kills, taken } (sim Battle.result)
  const stats = (mine.unitStats || []).filter((u) => u.kind === 'op' || u.uid).sort((a, b) => (b.dmg || 0) - (a.dmg || 0));
  const top = Math.max(1, ...stats.map((u) => u.dmg || 0));
  return html`<div class="ix-result" role="dialog" aria-label="战斗结算" data-testid="ix-result">
    <div class="ix-result__box">
      <header><${MicroLabel}>ROUND ${battle.round}<//><h2>${finished ? (finished === 'win' ? '守住了全部防线' : '防线失守') : battle.lpLost ? `防线受损 −${battle.lpLost}` : '防线完好'}</h2>
        <span class="ix-muted">击倒 ${mine.killed ?? res.killed ?? 0}/${mine.total ?? res.total ?? 0}${(mine.leaked || []).length ? ` · 漏过 ${(mine.leaked || []).length}` : ''}</span></header>
      ${stats.length ? html`<ul class="ix-dmg">${stats.slice(0, 12).map((u) => html`<li key=${u.uid || u.id}>
        <span>${u.name || catalog.operators[u.defId]?.name || ''}</span>
        <span class="ix-dmg__bar"><i style=${`width:${Math.round(((u.dmg || 0) / top) * 100)}%`}></i></span>
        <b class="num">${Math.round(u.dmg || 0)}</b><small class="num">${u.heal ? `治疗 ${Math.round(u.heal)}` : u.kills ? `击倒 ${u.kills}` : ''}</small></li>`)}</ul>` : null}
      <footer><${Button} variant="primary" onClick=${onClose} data-testid="ix-result-ok">${review ? '关闭' : finished ? '查看结算' : '继续备战'}<//></footer>
    </div>
  </div>`;
}

// ---- end of the match -----------------------------------------------------------------------------------------------

/**
 * The end of a match on the original RESULT screen (screens/result.js, css/screens/result.css): 模拟完成 / 模拟失败, the
 * rounds passed, the enemy leader's medal, then the player's card — final lineup (elites gold), the match's numbers
 * and the remaining life. 查看阵容 hides it to look at the board; 返回 leaves for the start page.
 */
export function FinalScreen({ state, catalog, onLook, onLeave }) {
  const win = state.outcome === 'win';
  useEffect(() => { audio.sfx(win ? 'settlementSucceed' : 'settlementFail'); }, []);
  const m = data.get('assets');
  const ms = state.matchStats || {};
  const passed = ms.passed ?? 0;
  const boss = state.board?.bossId ? data.lookup('bosses', state.board.bossId) : null;
  const stats = [
    ['造成伤害', ms.damage || 0],
    ['击倒敌人', ms.kills || 0],
    ['损失生命', ms.lpLost || 0],
    ['精锐干员', state.pieces.filter((p) => p.elite).length],
    ['装备叠加总数', state.pieces.reduce((n, p) => n + (p.equipmentLevel || 0), 0)],
    ['在场干员', state.pieces.filter(isDeployed).length],
    ['调度中心', state.shop?.level ?? 1],
  ];
  const bg = uiUrl(m, win ? 'settle/settlemen_teamshow_success' : 'settle/settlemen_teamshow_fail');
  const lineup = [...state.pieces].sort((a, b) => Number(isDeployed(b)) - Number(isDeployed(a))).slice(0, 12);
  return html`<div class=${cx('screen', 'result', 'ix-final', win ? 'is-win' : 'is-lose')} role="dialog" aria-label="本局结算" data-testid="ix-final">
    <div class="result__bg" aria-hidden="true" style=${bg ? `--result-bg:url("${pageAssetUrl(bg)}")` : undefined}></div>
    <div class="result__grid" aria-hidden="true"></div>
    <main class="result__main">
      <section class="result__hero">
        <div class="result__logo"><${Sprite} k="entry/season_logo_settle" class="result__logoimg" fallback=${html`<${MicroLabel} tone="mint">STRONGHOLD PROTOCOL<//>`} /></div>
        ${state.difficulty ? html`<${DifficultyTag} difficulty=${state.difficulty} size="lg" />` : null}
        <h1 class="result__headline">${win ? '模拟完成' : '模拟失败'}</h1>
        <p class="result__sub">${win ? '成功卫戍 · 敌方领袖已被击败' : state.lp <= 0 ? '防线已被突破' : '敌方领袖突破了防线'}</p>
        <div class="result__rounds">
          <span class="result__rlabel">通过回合</span>
          <b class="result__rnum num">${passed}</b>
          <span class="result__rof num">/${state.roundLimit}</span>
        </div>
        <div class="result__medals">
          ${boss ? html`<div class=${cx('medal', win && 'is-done')} title=${boss.name}>
            <${Img} src=${enemyIconUrl(m, boss.enemyKey)} /><span class="medal__check"><${Icon} name=${win ? 'check' : 'close'} /></span>
            <span class="medal__label">敌方领袖</span></div>` : null}
        </div>
        <footer class="result__foot ix-final__foot">
          <${Button} variant="secondary" size="lg" onClick=${onLook} data-testid="ix-final-look">查看阵容<//>
          <${Button} variant="primary" size="lg" icon="chevronLeft" onClick=${onLeave}>返回<//>
        </footer>
      </section>
      <section class="result__players">
        <h2 class="brief-h"><span>本局阵容</span><${MicroLabel}>FINAL LINEUP<//></h2>
        <article class="rcard is-self">
          <header class="rcard__head ix-final__head">
            <div class="rcard__mid">
              <div class="rcard__lineup">${lineup.map((p) => html`<${UnitThumb} key=${p.uid} kind="chess" id=${renderChessId(catalog, p)} golden=${!!p.elite}
                tier=${catalog.operators?.[p.chessId]?.tier} size="sm" />`)}</div>
            </div>
            <div class="rcard__round"><${MicroLabel}>ROUNDS<//><b class="num">${passed}</b></div>
          </header>
          <div class="rcard__stats">
            ${stats.map(([label, v]) => html`<div key=${label} class="rstat"><span>${label}</span><b class="num">${Math.round(v).toLocaleString('zh-CN')}</b></div>`)}
            <div class="rstat"><span>剩余生命</span><${LpTower} value=${state.lp} size="sm" /></div>
          </div>
        </article>
      </section>
    </main>
  </div>`;
}
