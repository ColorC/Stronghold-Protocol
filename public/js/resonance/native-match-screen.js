// Game screen — every in-match screen, dispatched by m.public.phase (DESIGN §10):
//   INFO_CHECK → Briefing (screens/briefing.js), BAND_DRAFT → Band draft (screens/bandDraft.js),
//   RESULT / m.result → Result (screens/result.js), everything else → MatchScreen below.
//
// MatchScreen = full-screen field view (render engine per DESIGN §9, DOM fallback when it can't load)
// with the DOM HUD layered on top: top bar, bond strip + popup, team panel (click = g.watch), effects,
// shop bar (prep), merge-reward and 机变 overlays, detail panel, enemy / match-info drawer, combat HUD
// (DP, "作战结束，等待队友完成作战" + teammates' progress, observing pill, 联防 / 最终攻势 ‹ › camera halves),
// phase banners, the round's result box at SETTLE (官方「作战结束」 + 「全员无伤！」 / 「生命值减少 −N」 and the BATTLEOVER sound;
// GitHub #235, PR #112), ticker, emote wheel + bubbles,
// settings, exit flow. Drag & drop from the view: pieceDrop on a board tile (also the piece's own tile) opens the
// direction wheel (ui/facingWheel.js, research 09 §1.2) and its release sends g.move {uid, to, dir} (g.art {…, dir}
// for 画卷); pieceDrop on a bench slot → g.move; items → g.equip (confirm when replacing) / g.art. Equipment
// released over an operator's sprite equips that operator even when the tile under the pointer is the one behind
// it; a refused drop toasts the reason (gameLogic dropFailureReason / canPlace). Tapping an own piece selects it:
// its underframe (ui/underframe.js: 撤退 / 出售 +N / 销毁), its rotated range tiles and its detail card; right-click /
// long-press opens the detail card only. Dropping an own deployed operator outside the field asks before selling it.
// The own board is drawn and checked with the
// player's stage overrides (terrain 机变 cards: gameLogic stageOverrides / effectiveStage); in a boss round's prep the
// legality reads the player's half of the boss field (gameLogic deployFieldOf, user playtest #5 item 7).
// Resonance shortcuts: D refresh, F level-up, E sell selected, W withdraw selected, Space ready, Esc closes the topmost popup.
// The UI never mutates match state locally; it re-renders from m.public / m.private / m.field pushes.
// Client-side combat (DESIGN §14, m.public.combatMode 'client'): battles are simulated in this browser by
// battle/runner.js, which publishes the battle's field meta into store.match.field and feeds the view the same b.snap /
// b.ev frames the server used to stream. Observing follows research 09 §3.1 (battle/observe.js): no looking elsewhere
// while the own normal battle runs; afterwards a teammate row → 前往查看 → a local replica, 返回战场 goes back; in
// 联防 / 最终攻势 the ‹ › pill switches the camera between the field's halves and 全景.
// Enemy preview pen (research 09 §2 / §6.2 item 3): in 休整期 the right HUD 🔍▶▶ pans the camera to the pen
// (view.setCamera('pen')); the left button turns into 🔍◀◀ and returns to the camera in use before (the grey right
// button, Esc or any camera change of the game flow return too). The shop bar folds away while the pen is shown and
// comes back as it was. Tapping an enemy in the pen (view pieceClick with `enemyKey` / a `preview` enemy unit) opens its
// detail card; the old enemy list lives on as the 敌方情报 tab of the 本局信息 dialog (left 🔍).
// Every camera request of this screen goes through setCam (it remembers the camera the pen returns to);
// `.gm[data-camera]` mirrors the current camera kind (E2E / styling). Folding the shop bar (收起) on the own prep board
// flies the camera to the official shop-collapsed framing and unfolding back to the shop camera (public issue #5:
// gameLogic prepCameraFor / foldCamera — never over the pen, a teammate's board or a battle; deferred while a piece is
// dragged or its direction is chosen).
// Equipment dropped on an operator whose two slots are used opens the equip-replace dialog (ui/equipReplace.js): the
// player picks the equipped item to destroy → g.equip {itemUid, targetUid, replaceUid}; 取消 sends nothing. 销毁 is only
// offered for loose items (equipped ones are locked, ui/facing.js itemDestroyable).
// 共鸣 has no replace dialog: an operator carries three items; a drop on a full one is refused with its reason and the
// item stays in the inventory (equipmentSlots.js equipRefusal), and the detail card shows EQUIP n/3.
// Solo battles (ui/matchStatus.js pauseAvailable): the top bar's pause button / Space send g.pause {on}; m.public.paused
// shows the paused overlay (继续作战 / 放弃模拟) and freezes the HUD clocks. Boss rounds: the top bar shows the level's
// 120 s countdown and the red DOT overtime warning (m.public.overtimeAt).
// User playtest #3: the own LP drops live while the own battle's enemies enter the blue gate (item 2: the runner's
// state().leaks → ui/hud.js liveLp → top bar + own team row; teammates' rows from m.public players[].pendingLp; in 联防 a
// leaker's enemies still standing — runner state().uniteLeft / m.public players[].uniteLeft, the ×N tag — user
// playtest #6 item 7); while the temp overflow row (临时整备区) holds pieces it is framed and labelled on the board
// (ui/underframe.js TempRowNotice) and 准备就绪 / Space say why they are refused (item 3).
// User playtest #4: the detail card shows live stats (item 7) — in battle the local sim's unit (battle/runner.js
// unitStats), in prep an own board unit's start-of-battle stats (g.unitStats → m.unitStats); 机变 cards take two taps
// (item 2, ui/choiceOverlay.js).
// Merges (user playtest #6 follow-up, PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置"): a shop /
// reward card armed for a purchase that completes a merge lights, in gold, the board tile its elite will take (the
// deployed copy that deploys first, gameLogic.mergeTarget — none when no copy is deployed: the elite goes to the hand);
// the elite then appears there with the promotion cue (render/app.js setPrep → fx.promote).
// The bond strip, its popup and a unit card's bond chips follow the player on screen (DESIGN §20.15, ui/watchBonds.js):
// a scouted / watched / auto-observed teammate's field → that teammate's bonds (m.public players[].bonds, tagged
// "👁 name"); 联防 / 最终攻势 → the player on the ‹ › half (全景: yours when you fight there, else the teammate picked
// with 前往查看 — `watchWho` — or the field's first player, never the viewer's own); in battle with the live layers of
// the battle on screen (battle/runner.js state().bondLayers). Picking a teammate on such a field (a 联防 leaker, an
// eliminated spectator) frames their half and keeps the ‹ › pill (with 返回战场); an open bond popup closes when the
// strip changes hands.
// Spectator seats (community report #26, a remake feature): a spectator has no m.private and plays like an ELIMINATED
// player — no shop, no ready, no emotes (▸ [ASSUMED] off), the server auto-observes the first field of every battle, a
// team row → 前往查看 any player; in 休整期 / 机变 / round start it is shown the first player's board by itself (once per
// phase). Its pill reads 观战中, never "你已被淘汰"; its exit only leaves the seat (ui/matchChrome.js ExitModal).

import { useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { PHASE, GEO } from '../../../shared/constants.js';
import { html, Spinner, PhaseBanner, ResultDialog, Icon, Button, BondDisc, HexBadge, confirmDialog, closeAllDialogs, useTicker } from '../ui/components.js';
import { useGameData, GIcon, UnitThumb } from '../ui/gameComponents.js';
import { useFieldView } from '../ui/fieldHost.js';
import { TopBar, liveLp, ownLeaks, uniteRemaining, tempInfo, tempReadyReason } from '../ui/hud.js';
import { BondStrip, BondPopup } from '../ui/bondStrip.js';
import { TeamPanel } from '../ui/teamPanel.js';
import { ShopBar } from '../ui/shopBar.js';
import { DetailPanel, resolveDetail } from '../ui/detailPanel.js';
import { RewardOverlay } from '../ui/rewardOverlay.js';
import { ChoiceOverlay } from '../ui/choiceOverlay.js';
import { EnemyDrawer } from '../ui/enemyDrawer.js';
import { Ticker } from '../ui/ticker.js';
import { EmoteWheel } from '../ui/emotes.js';
import { EffectsList } from '../ui/effectsList.js';
import { CombatHud } from '../ui/combatHud.js';
import { SettingsModal } from '../ui/settings.js';
import { CodexScreen } from './codex.js';
import { ResonanceCombatControls } from './native/combatControls.js';
import { AwayOverlay, awayStore } from '../ui/matchChrome.js';
import { ResonanceExitModal } from './native/exitModal.js';
import { openGuide } from '../ui/guide.js';
import { actions } from '../ui/gameActions.js';
import { FacingWheel, holdPiece, setPieceDir, syncPieceDirs, showRange, useTileScreen } from '../ui/facingWheel.js';
import { Underframe, underframeRect, TempRowNotice } from '../ui/underframe.js';
import { StandInTags } from '../screens/game/standInTags.js';
import { needsFacing, facingIntent, previewGrid, pieceDir, underframeActions, retreatSlot, itemDestroyable } from '../ui/facing.js';
import { EquipReplaceDialog, replaceRequest, replaceIntent } from '../ui/equipReplace.js';
import { pauseAvailable, isPaused, frozenNow } from '../ui/matchStatus.js';
import { pieceTile } from '../render/drag.js';
import {
  phaseMode, phaseBanner, isCombatPhase, showDeadPill, isBossPhase, placementContext, canPlace, boardTargets, dropIntent,
  battleOverSfx, uniteResultBox, battleResultBox,
  snapHud, activeBubbles, shortcutBlocked, closesOnFieldPress, phaseTotalSeconds, homeFieldId, ownFieldId, normalizeSp, normalizePersonalChoice, sortedPlayers,
  terrainInfo, deviceInfo, deviceTipAt, noteDeviceUnits, deviceUnitsForEntry,
  countdownState, shopBlockReason, stageOverrides, effectiveStage, watchTarget, dropFailureReason,
  previewEnemyKey, prepCamera, prepCameraFor, foldCamera, deployFieldOf, fieldTile, panelSide, panelSlots, bondPopupPlace, unitLoadout, deployedRecord,
  mergeTarget, modeOffBonds, readyFundsPrompt, readyShopFold, ownerBandId, ownDiyRecord, ownStandIn,
} from '../ui/gameLogic.js';
import { toast } from '../ui/toasts.js';
import { BriefingScreen } from '../screens/briefing.js';
import { SeasonBondsBrief } from './seasonBondsBrief.js';
import { BandDraftScreen } from '../screens/bandDraft.js';
import { ResultScreen } from '../screens/result.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, serverNow, isSpectating } from '../store.js';
import { battleRunner } from '../battle/runner.js';
import { isClientCombat, observeTarget, teammateProgress, cameraLayers, layerCamera, sidesOf, resumedWatch, followedScout } from '../battle/observe.js';
import { screenStrip, playerBonds, playerLayer, detailBondOwner, toggleBond, popupView } from '../ui/watchBonds.js';
import { data, getMode } from '../data.js';
import { audio, resultSpeaker, resultVoiceSlot } from '../audio.js';
import { useDocClass } from '../ui/device.js';
import { IncomePanel, RoundSettlementPanel } from './economyPanels.js';
import { InventoryDock } from './native/equipmentDock.js';
import { equipRefusal, RESONANCE_EQUIP_SLOTS } from './equipmentSlots.js';
import { DetailPanel as ResonanceDetailPanel } from './detail.js';
import { mountUnitItemOverlay } from './unitItems.js';
import { ResonanceItemIcon, resonanceItemIconUrl } from './itemIcon.js';
import { firstAvailableLegalTile, resonanceShortcutFor, RESONANCE_SHORTCUT_LABEL } from './nativeControls.js';
import { dispatchNativeSellDrop, nativeSellTargetRect } from './nativeSell.js';
import { pactIconUrl, PactIcon } from './pactIcon.js';
import { pactTierSummary } from './pactTierSummary.js';
import { pactReadableCopy } from './pactPresentation.js';
import { CoinGlyph } from '../ui/gameComponents.js';
import { interestFor } from '../../../shared/resonance/economy-view.js';
import { pactCurrentTier, pactTierStatus, pactTierStatusLabel, levelExactCounts, nativeStripTier } from './pactTierState.js';
import { specialBoardTile } from './specialEntityPlacement.js';
import { prototypeLabCells } from './nativeLabCells.js';
import { choiceDescription, choiceLabel, needsAdjacentStrategyPair, adjacentDeployedPairs, parseDetailHash } from './model.js';
import { resonanceChoiceAction } from './choiceAction.js';
// MatchEnded, PausedOverlay, the highlight styles and keepEarly live in ./game/*.js.
import { HUD_HZ_MS, MERGE_HL, SEL_RANGE, cx } from '../screens/game/marks.js';
import { keepEarly, audioEarly } from '../screens/game/early.js';
import { MatchEnded, PausedOverlay } from '../screens/game/overlays.js';
import { inspectRange } from '../screens/game/range.js';
import { t, tParts } from '../../../shared/i18n.js';

/** Router for the in-match screens. */
export function GameScreen({ onLeave, libraryCatalog, activeIds }) {
  const pub = useStore((s) => s.match.public);
  const hasResult = useStore((s) => !!s.match.result);
  const ended = useStore((s) => !!s.room && !s.room.inMatch && !!s.match.public);
  const away = useStore((s) => s.away, Object.is, awayStore);
  const autoplay = useStore((s) => !!(Array.isArray(s.match.public?.players) && s.match.public.players.find((p) => p && p.playerId === s.me.playerId)?.autoplay));
  const gd = useGameData();
  const seasonCatalog = useStore((s) => s.match.resonanceCatalog);
  if (!pub || !gd.ready) {
    return html`<div class="screen gload">
      <${Spinner} size="lg" label=${pub ? 'LOADING DATA' : 'ENTERING SIMULATION'} />
      <p class="t-lo">${pub ? t('正在载入模拟数据…') : t('正在进入模拟…')}</p>
    </div>`;
  }
  const mode = phaseMode(pub.phase);
  let body;
  if (hasResult || mode === 'result') body = html`<${ResultScreen} onBack=${onLeave} backLabel="返回首页" />`;
  else if (mode === 'briefing') body = html`<${BriefingScreen} step=${2} of=${2} loadout=${false}
    right=${html`<${SeasonBondsBrief} catalog=${seasonCatalog} />`} />`;
  else if (mode === 'draft') body = html`<${BandDraftScreen} />`;
  else body = html`<${MatchScreen} onLeave=${onLeave} libraryCatalog=${libraryCatalog} activeIds=${activeIds} />`;
  return html`${body}
    ${(away || autoplay) && !hasResult && mode !== 'result' && !ended ? html`<${AwayOverlay} />` : null}
    ${ended && !hasResult && mode !== 'result' ? html`<${MatchEnded} />` : null}`;
}

// ---- match screen ----------------------------------------------------------------------------------------

/** A card of a unit of the battle on screen: a unit's, or a crate's / turret's (a device card with its `unitId`, #228). */
const inBattleCard = (d) => d?.kind === 'unit' || (d?.kind === 'device' && d.device?.unitId != null);

function NativePactMatrix({ state, catalog, onDetail }) {
  const rows = Object.entries(catalog?.pacts || {}).sort((a, b) => (a[1]?.name || a[0]).localeCompare(b[1]?.name || b[0], 'zh-Hans'));
  return html`<section class="rs-panel rs-native-pact-matrix" aria-label="盟约与档位">
    <header><small>所有档位同时展示；点击盟约可查看成员与完整效果。</small></header>
    <div class="rs-native-pact-matrix__list">${rows.map(([id, pact]) => {
      const current = state?.pacts?.[id] || {}, count = Number(current.count) || 0, reached = Number(current.activeThreshold) || 0;
      const levels = pact.levels || [];
      const { tier } = nativeStripTier(current, levels);
      return html`<article class="rs-native-pact-matrix__row" data-pact-id=${id} key=${id}>
        <button type="button" class="rs-native-pact-matrix__name" onClick=${() => onDetail({ kind: 'pact', id })}>
          <${BondDisc} name=${pact.name || '盟约'} showName=${false} tier=${tier} maxTier=${levels.length} icon=${pactIconUrl(catalog, id) || undefined} iconMask=${true} active=${reached > 0} size="sm" />
          <span><b>${pact.name || '盟约'}</b><small>${count} 名成员</small></span>
        </button>
        <div class="rs-native-pact-matrix__tiers">${pact.summaryDescription?html`<p class="rs-pact-overview">${pact.summaryDescription}</p>`:null}${levels.map(level => {
          const tierText = pactReadableCopy(level.description || pactTierSummary(id, level.sourceVariables) || '盟约效果');
          const tierStatus = pactTierStatus(level, count);
          const currentTier = pactCurrentTier(levels, count, reached);
          return html`<button type="button" key=${level.threshold}
          class=${`rs-native-pact-matrix__tier${tierStatus === 'reached' ? ' is-reached' : ''}${currentTier === level ? ' is-current' : ''}`}
          data-pact-id=${id} data-level-index=${levels.indexOf(level)} data-level-min=${level.minUnits ?? level.threshold ?? ''} data-level-max=${level.maxUnits ?? ''} data-level-exact=${JSON.stringify(levelExactCounts(level) ?? [])}
          aria-label=${`${pact.name || '盟约'} ${level.threshold}人档${pactTierStatusLabel(level, count)}：${tierText}`}
          title=${`${level.threshold}人：${tierText}`} onClick=${() => onDetail({ kind: 'pact', id })}>
          <b>${level.threshold}</b><span>${tierText}</span>
        </button>`;
        })}</div>
      </article>`;
    })}</div>
  </section>`;
}

function NativeFunds({ state, catalog, onOpen, onCollapse }) {
  const rule = catalog?.campaign?.economy?.interest || {};
  const cap = Number(state?.actionCosts?.interestCap ?? rule.cap) || 0;
  const interest = interestFor(Number(state?.gold) || 0, 0, Number(rule.perGold), cap) ?? 0;
  return html`<div class="funds rs-funds">
    <button type="button" class="funds__hex" aria-label="金币与收入" title="查看收入与利息" onClick=${onOpen}><${CoinGlyph} class="funds__coin" /><b class="funds__num num">${state.gold}</b></button>
    <span class="funds__label">金币</span>
    <button type="button" class="rs-interest" aria-label=${`当前利息 ${interest}`} onClick=${onOpen}>${Array.from({ length: cap }, (_, i) => html`<i class=${i < interest ? 'is-on' : ''} key=${i}></i>`)}<small>+${interest}</small></button>
    <button type="button" class="funds__collapse" onClick=${onCollapse}><${Icon} name="close" />收起</button>
  </div>`;
}

function NativeLevelCard({ state, catalog, reason, onTap, onOdds }) {
  const level = Number(state?.level) || 1;
  const economy = catalog?.campaign?.economy || {};
  const oddsByLevel = catalog?.campaign?.shopOdds || {};
  const levels = Object.keys(oddsByLevel).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const maxLevel = Number(economy.maxLevel) || levels.at(-1) || 10;
  const xp = Math.max(0, Number(state?.xp) || 0);
  const xpNeed = Math.max(0, Number(state?.actionCosts?.xpToLevel ?? economy.xpToLevel?.[level]) || 0);
  const price = Math.max(0, Number(state?.actionCosts?.xpGold ?? economy.xpPurchase?.gold) || 0);
  const max = level >= maxLevel;
  const canBuy = !max && !reason;
  const progress = max ? 100 : xpNeed > 0 ? Math.min(100, xp / xpNeed * 100) : 0;
  const hold = useRef(null), openedByHold = useRef(false), releaseLongPress = useRef(null);
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current); if (releaseLongPress.current) clearTimeout(releaseLongPress.current); }, []);
  const stopHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const markOpened = () => {
    openedByHold.current = true;
    if (releaseLongPress.current) clearTimeout(releaseLongPress.current);
    releaseLongPress.current = setTimeout(() => { openedByHold.current = false; releaseLongPress.current = null; }, 900);
    onOdds?.();
  };
  return html`<button type="button" class=${`lvcard rs-level-card rs-native-level-card${max ? ' is-max' : ''}${!canBuy && !max ? ' is-disabled' : ''}`}
      aria-label=${max ? `等级 ${level}，已满级；查看招募概率` : `等级 ${level}，购买经验 ${price} 金；按 F 购买，右键查看招募概率`}
      aria-disabled=${String(!canBuy)} title=${max ? '已满级 · 右键查看招募概率' : reason || `购买经验（${price} 金）· F · 右键查看招募概率`}
      onClick=${() => { if (openedByHold.current) { openedByHold.current = false; return; } if (canBuy) onTap?.(); }}
      onContextMenu=${event => { event.preventDefault(); stopHold(); if (!openedByHold.current) markOpened(); }}
      onPointerDown=${event => { if (event.pointerType === 'touch') { stopHold(); hold.current = setTimeout(markOpened, 550); } }}
      onPointerUp=${stopHold} onPointerLeave=${stopHold} onPointerCancel=${stopHold}>
    ${!max ? html`<${HexBadge} value=${price} tone=${canBuy ? 'gold' : 'dark'} size="md" class="lvcard__price" />` : null}
    <span class="lvcard__frame"><span class="lvcard__micro">LEVEL</span><b class="lvcard__num num">${level}</b></span>
    <span class="lvcard__xp" aria-label=${max ? '经验已满' : `经验 ${xp}/${xpNeed}`}>
      <i role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(progress)}><em style=${{ width: `${progress}%` }}></em></i>
      <small>${max ? '经验已满' : `${xp}/${xpNeed} 经验`}</small>
    </span>
    <span class="lvcard__label">${max ? '已满级' : '购买经验'}</span><kbd class="lvcard__key">F</kbd>
  </button>`;
}

function NativeShopOdds({ state, catalog }) {
  const odds = catalog?.campaign?.shopOdds || {};
  const entries = Object.entries(odds).map(([level, values]) => [Number(level), Array.from({ length: 5 }, (_, i) => Number(values?.[i]) || 0)])
    .filter(([level]) => Number.isFinite(level)).sort((a, b) => a[0] - b[0]);
  const level = Number(state?.level) || 1;
  const currentIndex = entries.findIndex(([value]) => value === level);
  const current = entries[currentIndex]?.[1] || [0, 0, 0, 0, 0];
  const next = entries[currentIndex + 1] || null;
  const cap = Number(state?.deployCap ?? state?.effectiveDeployCapacity ?? level) || level;
  const row = (values, cls = '') => html`<div class=${`rs-shop-odds__bars ${cls}`} role="img" aria-label=${values.map((value, i) => `${i + 1}费 ${value}%`).join('，')}>
    ${values.map((value, i) => html`<span class=${`rs-shop-odds__cell is-cost-${i + 1}`} key=${i}><b>${value}%</b><small>${i + 1}费</small><i><em style=${{ height: `${Math.min(100, value)}%` }}></em></i></span>`)}</div>`;
  return html`<section class="rs-shop-odds" aria-label="招募概率">
    <p class="rs-shop-odds__current"><b>当前等级 ${level}</b><span>上场人数上限 ${cap}</span></p>
    <div class="rs-shop-odds__block"><h3>当前招募概率</h3>${row(current, 'is-current')}</div>
    ${next ? html`<div class="rs-shop-odds__next"><h3>升至 ${next[0]} 级</h3>${row(next[1])}</div>` : html`<p class="rs-shop-odds__max">已达到最高等级。</p>`}
    <details class="rs-shop-odds__all"><summary>查看完整招募概率</summary><div class="rs-shop-odds__table">${entries.map(([rowLevel, values]) => html`<div class=${`rs-shop-odds__table-row${rowLevel === level ? ' is-current' : ''}`} key=${rowLevel}><b>${rowLevel}级</b>${values.map((value, i) => html`<span class=${`is-cost-${i + 1}`} key=${i}>${value}%</span>`)}</div>`)}</div></details>
    <p class="rs-shop-odds__legend"><b>费用颜色</b>${[1,2,3,4,5].map(cost => html`<span class=${`is-cost-${cost}`} key=${cost}><i></i>${cost}费</span>`)}</p>
  </section>`;
}

function NativeMatchInfo({ state, catalog, onDetail, onSettlement, showHelp = false }) {
  const settled = (state.history || []).some(entry => entry.type === 'fight-settled');
  return html`<section class="rs-native-match-info">
    <div class="rs-native-match-info__round"><${GIcon} name="flag" /><b>第 ${state.round} 回合</b><span>${settled ? '可查看最近一场结果' : '准备阵容，迎接下一场战斗'}</span></div>
    <section><h3>本局策略</h3><div class="rs-native-list">${state.strategies?.length ? state.strategies.map(entry => {
      const id = typeof entry === 'string' ? entry : entry.id, strategy = catalog.strategies?.[id];
      return html`<article key=${id}><${Icon} name="key" /><button type="button" onClick=${() => onDetail({ kind: 'strategy', id })}><b>${strategy?.name || '策略'}</b><span>${strategy?.description || ''}</span></button></article>`;
    }) : html`<p>尚未选择策略</p>`}</div></section>
    <button type="button" class="btn btn--ghost" aria-label="本场结算" disabled=${!settled} title=${settled ? '查看最近一场收入与战斗图表' : '完成首场战斗后可查看'} onClick=${onSettlement}><${Icon} name="signal" />本场结算</button>
    <details class="rs-native-controls-help" open=${showHelp}><summary><${Icon} name="book" />操作说明</summary><p>拖动干员部署或调换位置；右键查看详情。</p><p>拖动组件到干员或另一组件上，预览装备或合成结果。</p><dl><dt>D</dt><dd>刷新商店</dd><dt>F</dt><dd>购买经验</dd><dt>W</dt><dd>部署／撤回选中的干员</dd><dt>E</dt><dd>出售选中的干员</dd><dt>空格</dt><dd>开始战斗／暂停</dd></dl></details>
  </section>`;
}

function NativeResonanceInventoryActions({ state, catalog, editable, busy, onAction }) {
  const inventory = state?.inventory || [], pieces = state?.pieces || [], consumables = state?.consumables || [];
  const itemTargets = [
    ...inventory.map(item => ({ ...item, ownerName: '背包' })),
    ...pieces.flatMap(piece => (piece.equipment || []).map(item => ({ ...item, ownerName: catalog?.operators?.[piece.operatorId]?.name || '干员' }))),
  ];
  const itemName = item => catalog?.equipment?.[item.itemId]?.name || '装备';
  const use = (row, itemUid) => onAction({ type: 'useConsumable', consumableUid: row.uid, ...(itemUid ? { itemUid } : {}) });
  return html`<section class="dsec rs-native-consumables" aria-label="消耗品">
    <h3 class="dsec__title">消耗品 <small>${consumables.length}</small></h3>
    ${consumables.length ? consumables.map(row => {
      const record = catalog?.prototypeEconomy?.gearConsumables?.[row.kind] || {};
      const kind = record.kind || '';
      const targets = kind === 'remover' ? itemTargets.filter(item => pieces.some(piece => (piece.equipment || []).some(gear => gear.uid === item.uid)))
        : kind === 'reforger' || kind === 'radiant_conversion' ? itemTargets : [];
      return html`<article class="rs-detail__item" key=${row.uid}>
        <span class="rs-detail__text"><b>${record.name || '战术消耗品'}</b><span>${record.description || ''}</span></span>
        ${targets.length ? html`<label class="rs-detail__select"><span>${kind === 'remover' ? '选择已装备物品' : '选择目标装备'}</span><select disabled=${busy || !editable} value="" onChange=${event => { const itemUid = event.currentTarget.value; event.currentTarget.value = ''; if (itemUid) void use(row, itemUid); }}><option value="">选择装备</option>${targets.map(item => html`<option value=${item.uid} key=${item.uid}>${itemName(item)} · ${item.ownerName}</option>`)}</select></label>`
          : html`<button type="button" disabled=${busy || !editable} onClick=${() => void use(row)}>${kind === 'anvil' ? '打开选择' : '使用'}</button>`}
      </article>`;
    }) : html`<p class="dtext">暂无可用消耗品。</p>`}
  </section>`;
}
function NativeSpecialEntityList({ state, catalog, editable, busy, onRecall }) {
  const rows = state?.specialEntities || [];
  if (!rows.length) return null;
  return html`<section class="dsec rs-native-special-entities" aria-label="战场纸偶">
    <h3 class="dsec__title">训练纸偶 <small>${rows.length}</small></h3>
    ${rows.map(row => {
      const definition = row.definition || catalog?.specialEntities?.[row.entityId] || {};
      const deployed = Number.isInteger(row.row) && Number.isInteger(row.col);
      return html`<article class="rs-detail__item" key=${row.nativeUid ?? row.uid}>
        <button type="button" class="rs-detail__text" draggable=${editable && !busy} aria-label=${`拖动${definition.name || '训练纸偶'}到部署格`}
          onDragStart=${event => { if (!editable || busy) { event.preventDefault(); return; } event.dataTransfer?.setData('application/x-resonance-special', String(row.nativeUid ?? row.uid)); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}>
          <b>${definition.name || '训练纸偶'}</b><span>${deployed ? `${row.row + 1}排 ${row.col + 1}列` : '待部署'} · ${definition.maxHp ?? 550}生命 · 不攻击</span>
        </button>
        ${deployed ? html`<button type="button" disabled=${busy || !editable} onClick=${() => onRecall(row.nativeUid ?? row.uid)}>收回</button>` : html`<small>拖到己方部署区域放置</small>`}
      </article>`;
    })}
  </section>`;
}

const ECONOMY_CHOICE_PACT = Object.freeze({
  academy_sponsor: 'academy', chem_market: 'risk', war_chest: 'conqueror',
  family_heist: 'family', junker_armory: 'armory',
});

function ChoiceOptionIcon({ choice, option, state, catalog, detail, strategy }) {
  if (strategy) return html`<${GIcon} name="bolt"/>`;
  const grants = Array.isArray(detail?.grant) ? detail.grant : [];
  const grantedItem = grants.find((grant) => grant && ['item', 'component'].includes(grant.kind)
    && typeof grant.id === 'string' && catalog?.equipment?.[grant.id]);
  if (grantedItem) return html`<${ResonanceItemIcon} catalog=${catalog} itemId=${grantedItem.id} size="sm" showTier=${false}/>`;

  const grantedOperatorId = grants.map((grant) => {
    if (!grant || grant.kind !== 'operator') return null;
    const directId = grant.operatorId ?? grant.id;
    if (typeof directId === 'string' && catalog?.operators?.[directId]) return directId;
    if (typeof grant.targetOperatorId === 'string' && catalog?.operators?.[grant.targetOperatorId]) return grant.targetOperatorId;
    if (typeof grant.targetCharId === 'string') {
      return Object.entries(catalog?.operators ?? {}).find(([, operator]) => operator?.charId === grant.targetCharId)?.[0] ?? null;
    }
    return null;
  }).find(Boolean);
  if (grantedOperatorId) return html`<${UnitThumb} kind="chess" id=${grantedOperatorId} size="sm" showTier=${false}/>`;

  if (choice?.type === 'disassemble') {
    const ownedItem = [...(state?.inventory ?? []), ...(state?.pieces ?? []).flatMap((entry) => entry.equipment ?? [])]
      .find((entry) => String(entry.uid) === String(option));
    if (ownedItem?.itemId && catalog?.equipment?.[ownedItem.itemId]) {
      return html`<${ResonanceItemIcon} catalog=${catalog} itemId=${ownedItem.itemId} size="sm" showTier=${false}/>`;
    }
  }

  const piece = (state?.pieces ?? []).find((entry) => String(entry.uid) === String(option));
  const operatorId = piece?.operatorId ?? (catalog?.operators?.[option] ? option : null);
  if (operatorId) return html`<${UnitThumb} kind="chess" id=${operatorId} size="sm" showTier=${false}/>`;

  const directPact = ['pact_tag', 'identity_transfer'].includes(choice?.type) ? option : null;
  const grantedPact = grants.find((grant) => grant?.kind === 'pact' && typeof grant.id === 'string')?.id;
  const contextualPact = ECONOMY_CHOICE_PACT[choice?.economyKind]
    ?? (catalog?.pacts?.[choice?.source] ? choice.source : null);
  const pactId = [directPact, grantedPact, contextualPact].find((id) => id && catalog?.pacts?.[id]);
  if (pactId) return html`<${PactIcon} catalog=${catalog} id=${pactId} size="sm"/>`;

  if (catalog?.equipment?.[option]) return html`<${ResonanceItemIcon} catalog=${catalog} itemId=${option} size="sm" showTier=${false}/>`;
  return html`<${GIcon} name="flag"/>`;
}

function ResonanceChoiceOverlay({ state, catalog, onAction, busy }) {
  const choice = state?.pendingChoices?.[0];
  const [selected, setSelected] = useState([]);
  const [strategyTargets, setStrategyTargets] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setSelected([]); setStrategyTargets({}); setCollapsed(false); }, [choice?.uid]);
  useEffect(() => {
    if (!choice || collapsed) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setCollapsed(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [choice?.uid, collapsed]);
  if (!choice || state?.phase !== 'choice') return null;
  const options = Array.isArray(choice.options) ? choice.options : [];
  const count = Math.max(1, Number(choice.remaining) || 1);
  const strategy = choice.type === 'strategy';
  const economy = choice.type === 'prototype_economy';
  const optionDetails = new Map((choice.metadata?.optionDetails ?? []).map((entry) => [entry.id, entry]));
  const balance = (currency) => currency === 'shimmer'
    ? Number(state?.prototypeMeta?.economy?.chemBaron?.shimmer ?? 0)
    : Number(state?.gold ?? state?.economy?.gold ?? 0);
  const canAfford = (ids) => {
    const totals = new Map();
    for (const id of ids) {
      const cost = optionDetails.get(id)?.cost;
      if (!cost || typeof cost !== 'object') continue;
      const currency = cost.currency ?? 'gold';
      totals.set(currency, (totals.get(currency) ?? 0) + Math.max(0, Number(cost.amount) || 0));
    }
    return [...totals].every(([currency, amount]) => amount <= balance(currency));
  };
  const selectedStrategy = selected[0];
  const needsPair = strategy && needsAdjacentStrategyPair(catalog?.strategies?.[selectedStrategy]);
  const pair = strategyTargets[selectedStrategy] || '';
  const pairs = needsPair ? adjacentDeployedPairs(state) : [];
  const economyTitles = { academy_sponsor: `${catalog?.pacts?.academy?.name||'研发'}赞助`, chem_market: `${catalog?.pacts?.risk?.name||'险境'}黑市`, war_chest: `${catalog?.pacts?.conqueror?.name||'远征'}宝箱`, family_heist: `${catalog?.pacts?.family?.name||'家族'}战利品`, junker_armory: '铸军军械铺' };
  const choiceTitle = strategy ? '选择策略' : economy ? (economyTitles[choice.economyKind] || '盟约奖励') : ['operators', 'target_operator'].includes(choice.type) ? '干员补给'
    : ['identity_transfer', 'pact_tag', 'dual_pact'].includes(choice.type) ? '盟约选择' : '领取补给';
  if (collapsed) return html`<button type="button" class="rs-native-choice-tab" aria-label="重新打开待领取选择" onClick=${() => setCollapsed(false)}>
    <${Icon} name="key" /><span>待领取 · ${choiceTitle}</span><small>点此继续</small>
  </button>`;
  const toggle = (option) => {
    if (strategy) { setSelected([option]); return; }
    setSelected(current => current.includes(option) ? current.filter(value => value !== option)
      : current.length < count ? [...current, option] : current);
  };
  const confirm = () => {
    if (selected.length < count || busy || (needsPair && !pair) || !canAfford(selected)) return;
    const action = resonanceChoiceAction(choice, selected, pair ? { [selected[0]]: pair } : {});
    if (!action) return;
    onAction(action);
  };
  return html`<div class="spov rs-choice-full rs-native-choice" data-option-count=${options.length} role="dialog" aria-modal="true" aria-label="选择补给">
    <div class="spov__veil"></div><section class="spov__inner">
      <header class="spov__head"><div class="spov__titles"><small class="micro">共鸣 · ${strategy ? '策略' : '整备'}</small>
        <h2 class="spov__title">${choiceTitle} · 还需 ${Math.max(0, count - selected.length)} 项</h2>
        <p class="spov__sub">选择后点击确认领取。</p></div>
        <div class="rs-native-choice__actions"><${Button} variant="ghost" size="sm" class="rs-native-choice__later" onClick=${() => setCollapsed(true)}>稍后整理</${Button}>
        <${Button} variant="primary" size="lg" icon="check" class="spov__confirm" disabled=${busy || selected.length < count || (needsPair && !pair) || !canAfford(selected)} onClick=${confirm}>确认选择</${Button}></div>
      </header>
      <div class="spov__grid spov__grid--3">${options.map(option => {
        const def = catalog?.strategies?.[option];
        const detail = optionDetails.get(option);
        const optionCost = detail?.cost;
        const optionSelected = selected.includes(option);
        const proposed = [...selected.filter((id) => id !== option), option];
        const optionAffordable = canAfford(proposed);
        const optionNeedsPair = strategy && needsAdjacentStrategyPair(def);
        const optionPair = strategyTargets[option] || '';
        const optionName = detail?.label || choiceLabel(choice, option, state, catalog);
        const optionDesc = detail?.description || choiceDescription(choice, option, state, catalog);
        const costAmount = Number(optionCost?.amount);
        const costText = Number.isFinite(costAmount) && costAmount > 0
          ? ` · ${costAmount} ${optionCost.currency === 'shimmer' ? '微光' : '金币'}` : '';
        return html`<article class="rs-choice-option" key=${option}>
          <button type="button" disabled=${economy && !optionAffordable} class=${`spcard spcard--tactic${optionSelected ? ' is-armed' : ''}${economy && !optionAffordable ? ' is-disabled' : ''}`} aria-pressed=${String(optionSelected)} onClick=${() => { if (!economy || optionAffordable) toggle(option); }}>
            <span class="spcard__glow"></span><span class="spcard__head"><span class="spcard__icon"><${ChoiceOptionIcon} choice=${choice} option=${option} state=${state} catalog=${catalog} detail=${detail} strategy=${strategy}/></span>
              <span class="spcard__title"><b class="spcard__name">${optionName}${costText}</b></span></span>
            <span class="spcard__desc">${optionDesc}</span></button>
          ${optionNeedsPair ? html`<label>相邻干员<select value=${optionPair} onChange=${event => setStrategyTargets(current => ({ ...current, [option]: event.currentTarget.value }))}>
            <option value="">选择一组相邻干员</option>${pairs.map(([a, b]) => html`<option key=${`${a.uid}|${b.uid}`} value=${`${a.uid}|${b.uid}`}>${a.operator?.name || catalog.operators?.[a.operatorId]?.name} + ${b.operator?.name || catalog.operators?.[b.operatorId]?.name}</option>`)}</select></label>` : null}
        </article>`;
      })}</div>
    </section>
  </div>`;
}

function MatchScreen({ onLeave, libraryCatalog, activeIds }) {
  useDocClass('sp-in-match');
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const resonanceCatalog = useStore((s) => s.match.resonanceCatalog);
  const field = useStore((s) => s.match.field);
  const myId = useStore((s) => s.me.playerId);
  const conn = useStore((s) => s.connection, shallowEqual);
  const emotes = useStore((s) => s.emotes);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const spectator = useStore((s) => isSpectating(s.room, s.me.playerId));
  // the room's spectator seats for the top bar's 观战席 capsule (ui/hud.js SpectatorPill; GitHub #120): room.state keeps coming
  // during the match, the list is replaced only when a seat changes — shallowEqual keeps an unrelated push from re-rendering
  const specFacts = useStore((s) => ({
    list: Array.isArray(s.room?.spectators) ? s.room.spectators : null,
    isHost: !!s.room && s.room.hostId === s.me.playerId,
  }), shallowEqual);
  const gd = useGameData();

  const hostRef = useRef(null);
  const barRef = useRef(null);
  const hudElRef = useRef(null);                         // .gm__hud (inside the safe-area insets: the panels' frame)
  const { view, kind: viewKind } = useFieldView(hostRef, { tierChips: 'base', itemPips: false, requireEngine: true });

  const [watching, setWatching] = useState(null);        // fieldId the player chose to watch (null = home)
  const [watchWho, setWatchWho] = useState(null);        // { fieldId, playerId }: the teammate picked with 前往查看
  const [drawer, setDrawer] = useState(null);            // 'enemies' | 'info' | null
  const [bondOpen, setBondOpen] = useState(null);        // { id, ownerId, from }: the bond popup and whose bond it shows
  const [bondsCollapsed, setBondsCollapsed] = useState(false);
  const [detail, setDetail] = useState(null);            // detail target
  const [resonanceDetail, setResonanceDetail] = useState(null);
  const [resonancePanel, setResonancePanel] = useState(null);
  const [resonanceHelp, setResonanceHelp] = useState(false);
  const [resonancePanelBottom, setResonancePanelBottom] = useState(null);
  const [resonanceDetailBottom, setResonanceDetailBottom] = useState(null);
  const [equipmentDropTarget, setEquipmentDropTarget] = useState(null);
  const [specialDropTile, setSpecialDropTile] = useState(null);
  // every shop / reward card opened by a tap is a new tap — `tap` in the target: two cards of one operator (the pool
  // deals duplicates) carry the same chess id and no piece, and each must say its 选中干员 (detailPanel selectVoiceKey)
  const cardTap = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  const [rewardMin, setRewardMin] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [drag, setDrag] = useState(null);                // { uid, kind, id } while dragging a piece
  const sellZoneRef = useRef(null);
  const sellRectRef = useRef(null);
  const [sellRect, setSellRect] = useState(null);
  const [facing, setFacing] = useState(null);            // direction step: { uid, piece, row, col, grid, name }
  const [sel, setSel] = useState(null);                  // tapped own piece: { uid }
  const [selBusy, setSelBusy] = useState(false);
  const [holdSeq, setHoldSeq] = useState(0);             // bumped when a held piece is released (re-apply the prep state)
  const [hud, setHud] = useState(null);
  const [banner, setBanner] = useState(null);
  const [resultBox, setResultBox] = useState(null);      // the round's result box (ResultDialog), shown at SETTLE
  const [readyBusy, setReadyBusy] = useState(false);
  const [spBusy, setSpBusy] = useState(null);
  const [personalBusy, setPersonalBusy] = useState(null); // { choiceId, idx }: an older request cannot clear a newer pick
  const [layer, setLayer] = useState('ALL');             // 联防 / 最终攻势 camera: 'L' | 'ALL' | 'R'
  const [pen, setPen] = useState(false);                 // the camera shows the enemy preview pen (research 09 §2)
  const [camKind, setCamKind] = useState('prep');        // kind of the last camera request (data-camera)
  const [replace, setReplace] = useState(null);          // equip-replace dialog: { request, resolve }
  const [pauseBusy, setPauseBusy] = useState(false);
  const [codexOpen, setCodexOpen] = useState(() => new URL(location.href).searchParams.get('view') === 'codex');
  const [codexTab, setCodexTab] = useState('operators');
  const [codexDetail, setCodexDetail] = useState(() => new URL(location.href).searchParams.get('view') === 'codex' ? parseDetailHash(location.hash) : null);
  const codexReturnRef = useRef(null);
  const codexStateRef = useRef({ open: codexOpen, detail: codexDetail });
  codexStateRef.current = { open: codexOpen, detail: codexDetail };
  const openCodex = (tab = 'operators') => {
    const url = new URL(location.href);
    codexReturnRef.current = `${url.pathname}${url.search}${url.hash}`;
    url.searchParams.set('view', 'codex'); url.hash = '';
    history.replaceState(history.state, '', url);
    setDetail(null); setResonanceDetail(null); setResonancePanel(null); setDrawer(null);
    setCodexDetail(null); setCodexTab(tab); setCodexOpen(true);
  };
  const closeCodex = () => {
    const url = new URL(location.href); url.searchParams.delete('view'); url.hash = '';
    history.replaceState(history.state, '', codexReturnRef.current || url);
    codexReturnRef.current = null; setCodexDetail(null); setCodexOpen(false);
  };
  const [armedCard, setArmedCard] = useState(null);     // the shop bar's armed card { kind, id } (merge tile cue)
  const cc = isClientCombat(pub);
  const battleState = useStore((s) => s.match.battle, shallowEqual); // local battle runner (client-side combat)
  const resonanceState = priv?.resonance?.state || null;
  const lastSettlement = [...(resonanceState?.history || [])].reverse().find(entry => entry.type === 'fight-settled') || null;
  useEffect(() => {
    const openHash = () => {
      const target = parseDetailHash(globalThis.location?.hash);
      if (!target || !resonanceState || !resonanceCatalog) return;
      const sections = { pacts: 'pacts', equipment: 'equipment', inventory: 'equipment', equipped: 'equipment',
        income: 'income', settlement: 'settlement', 'last-settlement': 'settlement' };
      if (target.kind === 'section') {
        const panel = sections[target.id]; if (panel) { setDetail(null); setResonanceDetail(null); setResonancePanel(panel); }
        return;
      }
      if (['equipment','inventory','equipped','income','settlement','last-settlement'].includes(target.kind)) {
        setDetail(null); setResonanceDetail(null); setResonancePanel(sections[target.kind]); return;
      }
      if (['member','finalMember'].includes(target.kind)) {
        const piece = resonanceState.pieces?.find(row => String(row.uid) === target.id || String(row.nativeUid) === target.id);
        if (piece) { setDetail(null); setResonancePanel(null); setResonanceDetail({ kind: 'operator', id: piece.operatorId, pieceUid: piece.uid }); }
        return;
      }
      if (['operator','pact','item','recipe','strategy','environment','opening'].includes(target.kind)) {
        setDetail(null); setResonancePanel(null); setResonanceDetail(target);
      }
    };
    openHash();
    globalThis.addEventListener?.('hashchange', openHash);
    return () => globalThis.removeEventListener?.('hashchange', openHash);
  }, [resonanceState, resonanceCatalog]);
  const [resonanceChoiceBusy, setResonanceChoiceBusy] = useState(false);
  const [resonanceActionBusy, setResonanceActionBusy] = useState(false);
  const submitResonanceChoice = async (action) => {
    if (resonanceChoiceBusy) return;
    setResonanceChoiceBusy(true);
    try { await net.request('g.resonance', { action }); audio.sfx('pick'); }
    catch (error) { toast(error?.message || '选择未能提交，请检查连接后重试', 'warn'); }
    finally { setResonanceChoiceBusy(false); }
  };
  const submitResonanceAction = async (action) => {
    if (resonanceActionBusy || !editable || !resonanceState || !['prep', 'choice'].includes(resonanceState.phase)) return false;
    setResonanceActionBusy(true);
    try { await net.request('g.resonance', { action }); audio.sfx('pick'); return true; }
    catch (error) { toast(error?.message || '装备操作未能提交，请检查连接后重试', 'warn'); return false; }
    finally { setResonanceActionBusy(false); }
  };
  const toggleResonancePanel = (panel) => {
    setResonanceHelp(false);
    const closing = resonancePanel === panel;
    if (!closing) {
      setDetail(null); setSel(null); setResonanceDetail(null);
      // A manually opened panel supersedes any previously restored detail deep link.
      globalThis.history?.replaceState?.(globalThis.history.state, '', `${globalThis.location.pathname}${globalThis.location.search}`);
    }
    setResonancePanel(closing ? null : panel);
  };
  const resonanceLive = useRef({ state: resonanceState, catalog: resonanceCatalog, dragging: drag, ownerId: myId, fieldId: field?.fieldId, inBattle: cc && isCombatPhase(pub?.phase) });
  resonanceLive.current = { state: resonanceState, catalog: resonanceCatalog, resonanceState, dragging: drag, ownerId: myId, fieldId: field?.fieldId, inBattle: cc && isCombatPhase(pub?.phase) };
  useEffect(() => {
    if (!view) return undefined;
    return mountUnitItemOverlay({
      view,
      getState: () => resonanceLive.current.state,
      getReplay: () => null,
      getCatalog: () => resonanceLive.current.catalog,
      getIcon: resonanceItemIconUrl,
      getLiveUnits: () => resonanceLive.current.inBattle && battleRunner?.ownerEquipment
        ? battleRunner.ownerEquipment(resonanceLive.current.ownerId, resonanceLive.current.fieldId)
        : null,
      getDragging: () => !!resonanceLive.current.dragging,
      onDetail: target => setResonanceDetail(target),
    });
  }, [view]);

  const phase = pub?.phase;
  const mode = phaseMode(phase);
  const combat = isCombatPhase(phase);
  const solo = roomSolo || String(pub?.modeId || '').includes('single');
  const players = sortedPlayers(pub);
  const meP = players.find((p) => p.playerId === myId) || null;
  // a spectator seat watches like an eliminated player (it has no m.private and no row in m.public)
  const alive = spectator ? false : priv ? priv.alive !== false : meP?.alive !== false;
  const home = homeFieldId(pub, myId);
  const watchingOther = !!watching && watching !== home && watching !== ownFieldId(myId);
  // watching a teammate's prep board: the 本局信息 drawer shows THEIR 策略 in place of one's own (user playtest #2 item 2)
  const scoutPid = watchingOther && field?.prep && typeof field.fieldId === 'string' && field.fieldId.startsWith('n:') ? field.fieldId.slice(2) : null;
  const scoutBandId = scoutPid ? ownerBandId(pub, scoutPid) : null;
  const scoutBandOwner = scoutPid ? (players.find((p) => p.playerId === scoutPid)?.name || null) : null;
  const personalChoice = !spectator && alive ? normalizePersonalChoice(pub, priv, myId) : null;
  const hasPersonalChoice = !!personalChoice;
  const editable = phase === PHASE.PREP && !!priv && alive && !priv.ready && !watchingOther && !hasPersonalChoice;
  const showShop = !!priv && alive && (phase === PHASE.PREP || phase === PHASE.SP_DRAFT || phase === PHASE.ROUND_START) && !watchingOther;
  const shopDisplayPriv = resonanceState && Array.isArray(priv?.shop?.slots)
    ? { ...priv, shop: { ...priv.shop, slots: priv.shop.slots.slice(0, 5) } }
    : priv;
  const layersDisabled = phase === PHASE.UNITE || isBossPhase(phase);
  const sp = phase === PHASE.SP_DRAFT ? normalizeSp(pub?.sp, players) : null;
  const total = phaseTotalSeconds(pub, gd.config, myId);
  // solo pause: offered in the own battle; while m.public.paused every HUD clock stops at the pause moment
  const paused = isPaused(pub);
  const pauseSeenRef = useRef(null);
  if (!paused) pauseSeenRef.current = null;
  else if (pauseSeenRef.current == null) pauseSeenRef.current = serverNow();
  const frozenAt = paused ? frozenNow(pub, serverNow(), pauseSeenRef.current) : null;
  // live LP (user playtest #3 item 2): the own normal battle's counted leaks — the local runner's count (authoritative
  // or display replica) and the server's m.public players[].pendingLp, whichever is further (both only grow during a
  // round; a display replica stands still while the player watches a teammate's field, the server's count then moves
  // on) — cost min(lpCapPerRound, n) at settlement; shown at once until the settled m.private lands (ui/hud.js liveLp
  // keeps the base between renders); 联防 (user playtest #6 item 7): a leaker's enemies still standing on the 联防 field —
  // the local replica's count while it runs, else m.public players[].uniteLeft (ui/hud.js uniteRemaining) — replace it;
  // the teammates' rows take the same local counts (`uniteLocal`, ui/teamPanel.js rowLp)
  const lpBaseRef = useRef(null);
  const localLeaks = battleState && battleState.leaks ? battleState.leaks[ownFieldId(myId)] : undefined;
  const uniteLocal = phase === PHASE.UNITE && battleState && battleState.uniteLeft ? battleState.uniteLeft : null;
  const leaker = phase === PHASE.UNITE && Array.isArray(pub?.unite?.leakers) && pub.unite.leakers.includes(myId);
  const localLeft = leaker && uniteLocal ? (uniteLocal[myId] ?? 0) : undefined;
  const liveLpNow = liveLp(lpBaseRef.current, {
    phase, round: pub?.round, lp: priv?.lp, statsLeaks: priv?.stats?.leaks, alive,
    leaks: ownLeaks(localLeaks, meP?.pendingLp), cap: gd.config?.lpCapPerRound,
    uniteLeft: leaker ? uniteRemaining(localLeft, meP?.uniteLeft) : null,
  });
  lpBaseRef.current = liveLpNow.base;
  // what this round's battle cost me, kept while it runs for the result box and the 战斗结束 sound at SETTLE (GitHub
  // #235, PR #112 by @Convey123): by then the settlement has landed (Match.flush sends m.private before the SETTLE
  // m.public) and the live count reads 0. A per-round MAXIMUM — leaks only grow within a round, and a frame that lands
  // after the settlement must not wipe a real count — and only for a player in the round (a spectator seat or an
  // eliminated player fights nothing and gets no box, ui/gameLogic/phases.js battleResultBox). `unite`: a 联防 ran.
  const roundLossRef = useRef(null);
  if (isCombatPhase(phase) && alive) {
    const prev = roundLossRef.current;
    const same = !!prev && prev.round === pub?.round;
    const leaks = ownLeaks(localLeaks, meP?.pendingLp);
    roundLossRef.current = {
      round: pub?.round,
      leaks: same ? Math.max(prev.leaks, leaks) : leaks,
      cap: gd.config?.lpCapPerRound,
      unite: phase === PHASE.UNITE || (same && prev.unite),
    };
  }

  // latest values for event handlers bound once
  const live = useRef({});
  // the field the own pieces are deployed on: the own board, or the player's half of the boss field in a boss round's
  // prep (user playtest #5 item 7: legality and the legal-tile highlights read THOSE tiles, like the server)
  const deployField = deployFieldOf(pub, myId);
  // the own pieces' records: a DIY slot the player filled is its 自选 operator (0.2.0, m.private.diy — position, range,
  // name; gameLogic/diy.js), every other chess its data record
  const ownChess = (id) => { const c = gd.chess(id); return ownDiyRecord(c, live.current.priv, { chess: data.get('chess'), backups: data.get('backups') }) || c; };
  // what the own pieces show (names and art of the facing wheel, the underframe, the equip-replace dialog): a chess the
  // player does not own is its stand-in (0.2.0 补位 — the owner's recall of the official mode, 2026-10-06); rules keep
  // ownChess (the composed record carries the chess's identity anyway)
  const ownShown = (id) => { const c = ownChess(id); return ownStandIn(c, live.current.priv, data.get('backups')) || c; };
  const placeCtx = useMemo(() => placementContext({
    priv, stage: gd.stage(pub?.stageId), editable, field: deployField,
    getChess: (id) => { const c = gd.chess(id); return ownDiyRecord(c, priv, { chess: data.get('chess'), backups: data.get('backups') }) || c; },
    getToken: gd.token, getItem: gd.item, getEffect: gd.effect, backups: gd.backups,
  }), [priv, pub?.stageId, editable, gd.ready, deployField]);
  live.current = { pub, priv, field, editable, hasPersonalChoice, placeCtx, watching, watchWho, home, myId, alive, spectator, detail, drawer, bondOpen, emoteOpen, settingsOpen, exitOpen, drag, facing, sel, selBusy, pen, resonanceState, showPrep: (mode === 'prep' || mode === 'boot') && !watchingOther, hoverUid: live.current.hoverUid ?? null, collapsedNow: collapsed, localDone: false, canPause: false, paused };

  // ---- camera: every request goes through setCam, which remembers it for the pen's way back -----------------------
  // the own prep board: the normal board, or — in the prep of a boss round — the player's half of the boss field
  // (research 09 §1.2: the right-hand player's board mirrored; gameLogic prepCamera). The DOM fallback view keeps the
  // own board's layout there (every coordinate the UI handles is a board coordinate either way) and draws the tiles of
  // that half (ui/fallbackField.js: the legal fence tiles are floor, not the normal field's walls; user playtest #5 item 7).
  const prepCam = prepCamera(pub, myId);
  const prepCamKey = `${prepCam.kind}:${prepCam.opts.side}`;
  const prepCamSeen = useRef(prepCamKey);                // the prep camera last requested
  const camRef = useRef({ kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L' } });
  const penRef = useRef({ on: false, collapsed: false });
  // the shop bar is shown folded (收起; the pen folds it for itself: the player's own state is the one it returns to) —
  // the own prep board then takes the official shop-collapsed camera (public issue #5, gameLogic prepCameraFor)
  const shopFolded = showShop && (pen ? penRef.current.collapsed : collapsed);
  // 准备就绪 folds the shop bar, cancelling it unfolds the bar again (GitHub #138; gameLogic readyShopFold): the board is set,
  // the fight is what to look at — the board camera follows the fold like a hand-made one (the effect below). Inside the pen
  // the bar is folded for itself: the state it returns to is the one that changes.
  const readySeen = useRef(null);
  useEffect(() => {
    const cur = phase === PHASE.PREP && priv && alive && !watchingOther ? { round: pub?.round, ready: !!priv.ready } : null;
    const change = readyShopFold(readySeen.current, cur);
    readySeen.current = cur;
    if (!change) return;
    if (penRef.current.on) penRef.current.collapsed = change === 'fold';
    else setCollapsed(change === 'fold');
  }, [phase, pub?.round, priv?.ready, !!priv, alive, watchingOther]);
  const cancelFacingRef = useRef(() => {});
  const setCam = useCallback((kind, opts) => {
    camRef.current = { kind, opts: opts || {} };
    setCamKind(kind);
    if (penRef.current.on) { penRef.current.on = false; setPen(false); setCollapsed(penRef.current.collapsed); }
    view?.setCamera(kind, opts);
  }, [view]);
  // 休整期 only; never while a piece is being placed (the wheel sits on a tile of the board camera)
  const penAvail = phase === PHASE.PREP && !!view && viewKind !== 'loading';
  /** Pan to the enemy preview pen (on) or back to the camera in use before (off). */
  const togglePen = useCallback((on) => {
    const P = penRef.current;
    if (!view || on === P.on) return;
    if (on) {
      const L = live.current;
      if (L.pub?.phase !== PHASE.PREP) return;
      if (L.facing) return;
      P.on = true;
      P.collapsed = L.collapsedNow;
      setPen(true);
      setSel(null);
      setDrawer(null);                                   // the pen replaces the list
      setBondOpen(null);                                 // the bond strip hides: its popup must not float over the pen
      setDetail((d) => (d?.kind === 'enemy' ? d : null)); // a shop card / unit card belongs to the board view
      setCollapsed(true);
      view.setCamera('pen', { side: camRef.current.opts?.side || 'L' });
      audio.sfx('click', { volume: 0.5 });
    } else {
      P.on = false;
      setPen(false);
      setCollapsed(P.collapsed);
      const c = camRef.current;
      view.setCamera(c.kind, c.opts);
      audio.sfx('back', { volume: 0.5 });
    }
  }, [view]);
  const togglePenRef = useRef(togglePen);
  togglePenRef.current = togglePen;

  // the stage as the own board looks: terrain 机变 cards open / reclassify tiles and remove crates (stageOverrides)
  const baseStage = gd.ready ? gd.stage(pub?.stageId) : null;
  const overrides = stageOverrides(priv, gd.effect);
  const overridesKey = JSON.stringify(overrides);
  const ownStage = useMemo(() => effectiveStage(baseStage, overrides), [baseStage, overridesKey]);

  // ---- field view wiring ---------------------------------------------------------------------------------
  const lastFieldRef = useRef(null);
  const viewModeRef = useRef(null);
  const snapUnitsRef = useRef(new Map());
  // the shown battle's device units (crates / “双眼皮” turrets: UnitInfo by id) — the meta's `units` plus the 'spawn' events,
  // for the tap on a device (gameLogic.deviceTipAt); the renderer's pick skips devices, a tap on one lands in tileClick
  const deviceUnitsRef = useRef(new Map());
  const hudRef = useRef(null);
  // b.ev / b.snap that arrive before the UI entered their field (the battle's first ticks race the m.public /
  // m.field re-render): kept per fieldId and replayed on enter so no unit's 'spawn' UnitInfo is ever lost.
  const evBufRef = useRef(new Map());   // fieldId → ev tuples since that field's m.field
  const snapBufRef = useRef(new Map()); // fieldId → latest snapshot
  // a new m.field for the field already on screen (a resync, or the runner re-showing it after a hidden-tab backlog
  // overflowed): its frames are buffered like a new field's until the enter effect re-enters it — enterBattle resets
  // the view, so a 'spawn' or form fx pushed in between used to be lost (placeholder views, the old model)
  const reentryRef = useRef(null);

  // prep rendering (own board) vs battle rendering (m.field). The field object present when prep starts is stale
  // (last round's battle): combat only enters an m.field pushed after that (a new object), and every new m.field
  // push (watch switch, reconnect) re-enters the battle view.
  const showPrep = (mode === 'prep' || mode === 'boot') && !watchingOther;

  // own board (prep, or a battle field the player fights on) → the stage with the player's overrides; a teammate's
  // board → the plain stage (their overrides are not known here)
  const shownField = showPrep ? null : field;
  const shownMembers = shownField ? ((Array.isArray(pub?.fields) ? pub.fields : []).find((f) => f && f.fieldId === shownField.fieldId)?.players
    || (Array.isArray(shownField.players) ? shownField.players : null)) : null;
  const ownView = showPrep || (shownField ? (shownMembers ? shownMembers.includes(myId) : shownField.fieldId === ownFieldId(myId)) : !watchingOther);
  // every field is fought on the round's battlefield — 联防 too, its terrain, crates and water included (0.2.1, the
  // owner's decision of 2026-10-07; 0.2.0 drew the escaped levels' empty road there and restored the board on leaving)
  useEffect(() => {
    if (!view) return;
    const st = ownView ? ownStage : baseStage;
    if (st) view.setStage(st);
  }, [view, ownView, ownStage, baseStage]);
  // the stage behind the board ON SCREEN — the own one (机变 overrides applied) or, while watching a teammate, the plain
  // one — and how a tapped BOARD tile maps to it (GitHub issue #184: tileClick → gameLogic.terrainInfo). Everywhere but a
  // boss-prep board the two spaces are the same: a 最终攻势 / 隐秘核心 battle renders the stage's own rows (GEO.BOSS_RECT),
  // 联防 / normal rects are stage rows; the boss PREP draws the player's half (stage rows 2–5) as board rows 9–12
  // (render/prepfield.js toDisp), which is exactly gameLogic.fieldTile.
  live.current.terrainStage = ownView ? ownStage : baseStage;
  live.current.terrainTile = showPrep && (deployField === 'bossL' || deployField === 'bossR')
    ? (row, col) => fieldTile(deployField, row, col)
    : (row, col) => [row, col];
  // a battle on screen (not the prep board, not a scouted prep board): its crates and turrets are device UNITS, found by
  // unit; everything else answers by the stage's own device entries (gameLogic.deviceTipAt / deviceInfo, #228)
  live.current.deviceBattle = !!shownField && !shownField.prep;
  const staleFieldRef = useRef(null);
  const enteredFieldRef = useRef(null);
  const enteredViewRef = useRef(null);
  const pressSel = useRef(null);                         // the selected piece when the current field press began
  useEffect(() => {
    const previousFieldId = lastFieldRef.current;
    const previousDevices = deviceUnitsRef.current;
    if (enteredViewRef.current !== view) {
      enteredViewRef.current = view;
      enteredFieldRef.current = null; lastFieldRef.current = null;
      viewModeRef.current = null; reentryRef.current = null;
    }
    if (!view) return;
    if (showPrep) {
      if (field?.prep) staleFieldRef.current = field; // a prep scouting board is never a battle to enter
      if (viewModeRef.current !== 'prep') {
        // the battle we just left (or whatever was stored before mount) must not be re-entered next combat;
        // an m.field that arrives during prep (the upcoming battle) is a new object and will be entered
        staleFieldRef.current = field;
        const pc = prepCameraFor(pub, myId, shopFolded);
        setCam(pc.kind, pc.opts);
        prepCamSeen.current = prepCamKey;
        viewModeRef.current = 'prep';
        lastFieldRef.current = null;
        enteredFieldRef.current = null;
        reentryRef.current = null;
        setHud(null);
      }
      if (priv) {
        view.setPrep(priv, { editable, canPlace: (uid, target) => canPlace(live.current.placeCtx, uid, target).ok });
        // stored facings (m.private board `dir`); the piece in the direction step shows the wheel's preview instead
        syncPieceDirs(view, priv, live.current.facing?.uid ?? null);
      }
      return;
    }
    const wanted = combat || mode === 'settle' || watchingOther;
    if (!wanted || !field || !field.fieldId || field === staleFieldRef.current || field === enteredFieldRef.current) return;
    if (watchingOther && !combat && field.fieldId !== watching) return; // an older push while switching
    if (lastFieldRef.current && lastFieldRef.current !== field.fieldId) setDetail((d) => (inBattleCard(d) ? null : d));
    enteredFieldRef.current = field;
    lastFieldRef.current = field.fieldId;
    reentryRef.current = null;
    viewModeRef.current = 'battle';
    snapUnitsRef.current = new Map();
    const early = evBufRef.current.get(field.fieldId);
    evBufRef.current.delete(field.fieldId);
    const noted = noteDeviceUnits(new Map(), { units: field.units, events: early });
    deviceUnitsRef.current = deviceUnitsForEntry(previousDevices, noted, previousFieldId != null && previousFieldId === field.fieldId);
    const units = Array.isArray(field.units) ? [...field.units] : [];
    const ids = new Set(units.map(unit => unit?.id));
    for (const [id, info] of deviceUnitsRef.current) if (!ids.has(id)) units.push(info);
    view.enterBattle({ ...field, units });
    const earlySnap = snapBufRef.current.get(field.fieldId);
    snapBufRef.current.delete(field.fieldId);
    // a scouted prep board frames like the own prep with the shop folded (the bench row included, app.js camRect);
    // 'prep' expands the rect's top to the hand row
    const kind = field.prep ? 'prep' : (field.kind === 'hidden' ? 'boss' : field.kind || 'normal');
    const pf = (Array.isArray(pub?.fields) ? pub.fields : []).find((f) => f && f.fieldId === field.fieldId);
    const members = Array.isArray(pf?.players) ? pf.players : Array.isArray(field.players) ? field.players : [];
    const sides = field.sides && typeof field.sides === 'object' ? field.sides : null;
    // a scouted board of a boss round's prep (Match.prepFieldMeta: the boss-field rows, `side` = the scouted player's
    // half) is framed by the boss-field prep camera of that half — the leader standing at its spawn (item 55)
    const side = field.prep && (field.side === 'L' || field.side === 'R') ? field.side
      : sides && sides[myId] ? sides[myId] : members.length > 1 && members.indexOf(myId) === 1 ? 'R' : 'L';
    // local simulation (client-side combat) feeds a frame per animation frame: no network jitter buffer
    view.raw?.setLocalFeed?.({ on: !!field.local, speed: field.speed });
    setLayer('ALL');
    // a lone player's boss field (solo modes, the odd player of a co-op Final Assault: the `_s` templates route every
    // enemy to the left objective) is framed on its own half like the ‹ › half view; pairs start on 全景
    const lone = kind === 'boss' && members.length === 1;
    setCam(kind, lone ? { rect: field.rect, side, half: true } : { rect: field.rect, side, ...(field.prep ? { shop: false } : {}) });
    audio.setFieldUnits(field.units);
    if (early && early.length) {
      // replay state-bearing events only (a burst of stale hit sparks / damage numbers would look wrong)
      view.pushEvents(early);
      audio.handleBattleEvents(audioEarly(early));   // (the 'spawn' tuples only: the sound would replay every old death, deploy and cast)
    }
    if (!earlySnap && (field.prep || !combat) && Array.isArray(field.units)) {
      // prep scouting: no battle snapshots follow. A later m.field for this board (the teammate moved) re-enters
      // above and places the units again, including an empty board (GitHub #87).
      view.pushSnapshot({
        fieldId: field.fieldId, gt: 0,
        units: field.units.filter((u) => u && u.id != null).map((u) => [u.id, Number(u.x) || 0, Number(u.y) || 0, u.maxHp || 1, u.maxHp || 1, 0, 0, 0, 0]),
      });
    }
    if (earlySnap) {
      view.pushSnapshot(earlySnap);
      if (Array.isArray(earlySnap.units)) {
        snapUnitsRef.current = new Map(earlySnap.units.filter(Array.isArray).map((t) => [t[0], t]));
      }
      hudRef.current = snapHud(earlySnap);
      setHud(hudRef.current);
    }
  }, [view, showPrep, priv, editable, field, combat, mode, watchingOther, watching, holdSeq]);

  // battle frames straight from the socket (server-run combat, 20 Hz) or from the local simulation (client-side combat,
  // battle/runner.js, every animation frame) — never through the store. Frames go to the view as received: the game
  // time travels as `gt` and the render engine reads it (render/interp.js frameTime).
  useEffect(() => {
    let last = 0;
    let pending = null;
    const flush = () => { pending = null; last = performance.now(); setHud(hudRef.current); };
    const onFieldMeta = (msg) => {
      if (!msg || typeof msg.fieldId !== 'string') return;
      evBufRef.current.set(msg.fieldId, []);
      snapBufRef.current.delete(msg.fieldId);
      if (msg.fieldId === lastFieldRef.current) reentryRef.current = msg.fieldId;
    };
    // the field the view shows now (null while a re-entry of it is pending: its frames are buffered)
    const shownId = () => (reentryRef.current && reentryRef.current === lastFieldRef.current ? null : lastFieldRef.current);
    const onSnap = (snap) => {
      const cur = shownId();
      if (!snap || typeof snap !== 'object') return;
      if (!cur || (snap.fieldId && snap.fieldId !== cur)) {
        if (typeof snap.fieldId === 'string') snapBufRef.current.set(snap.fieldId, snap);
        return;
      }
      view?.pushSnapshot(snap);
      if (Array.isArray(snap.units)) {
        const mp = new Map();
        for (const t of snap.units) if (Array.isArray(t)) mp.set(t[0], t);
        snapUnitsRef.current = mp;
      }
      hudRef.current = snapHud(snap);
      const dt = performance.now() - last;
      if (dt >= HUD_HZ_MS) flush();
      else if (!pending) pending = setTimeout(flush, HUD_HZ_MS - dt);
    };
    const onEv = (msg) => {
      const cur = shownId();
      if (!msg || !Array.isArray(msg.ev)) return;
      if (!cur || (msg.fieldId && msg.fieldId !== cur)) {
        if (typeof msg.fieldId !== 'string') return;
        const buf = evBufRef.current.get(msg.fieldId) || [];
        // only state-bearing tuples are replayed later (see the enter effect)
        for (const e of msg.ev) if (keepEarly(e)) buf.push(e);
        if (buf.length > 1500) buf.splice(0, buf.length - 1500);
        evBufRef.current.set(msg.fieldId, buf);
        if (evBufRef.current.size > 8) evBufRef.current.delete(evBufRef.current.keys().next().value);
        return;
      }
      view?.pushEvents(msg);
      noteDeviceUnits(deviceUnitsRef.current, { events: msg.ev });
      audio.handleBattleEvents(msg.ev);
    };
    // 干员语音 (结算): the own battle's result just came in — the operator's line depends on how it went
    // (完美作战 ⇒ 3星结束行动, 绝境 / 终极 ⇒ 完成高难行动, 有漏怪 ⇒ 非3星结束行动, 一个没杀 ⇒ 行动失败)
    const onResult = (msg) => {
      try {
        if (!msg || !msg.result) return;
        const st = store.get();
        const pid = st.me?.playerId;
        const mine = (pid && msg.result.perPlayer && msg.result.perPlayer[pid]) || null;
        const diff = st.match?.public?.difficulty;
        // the speaker comes from THIS battle's own field (`mine.unitsEnd`), not from the field on screen: watching a
        // teammate used to make THEIR operator say the viewer's line (review on #73). unitsEnd names chess ids: the
        // record the own piece shows gives the operator whose voice bank speaks — a 补位 piece's stand-in (its own
        // voice, like its 选中 line) and a filled 自选 slot's operator (ownShown), else the chess record's charId
        const charId = resultSpeaker(mine, Math.random, (id) => ownShown(id)?.charId ?? null);
        if (!charId) return;
        audio.voice(charId, resultVoiceSlot({
          perfect: !!(mine?.perfect),
          leaked: Array.isArray(mine?.leaked) ? mine.leaked.length : 0,
          killed: mine?.killed ?? msg.result.killed,
          total: mine?.total ?? msg.result.total,
          hard: diff === 'HARD' || diff === 'ABYSS',
        }));
      } catch { /* ignore */ }
    };
    const offs = [net.on('m.field', onFieldMeta), net.on('b.snap', onSnap), net.on('b.ev', onEv)];
    if (battleRunner) offs.push(battleRunner.on('field', onFieldMeta), battleRunner.on('snap', onSnap), battleRunner.on('ev', onEv), battleRunner.on('result', onResult));
    if (view && !showPrep && field?.fieldId) {
      if (field.local) battleRunner?.reshow();
      else if (combat || watchingOther) {
        const who = watchWho?.fieldId === field.fieldId ? watchWho.playerId : null;
        net.request('g.watch', { fieldId: field.fieldId, ...(who ? { playerId: who } : {}) }).catch(() => {});
      }
    }
    return () => { for (const off of offs) { try { off(); } catch { /* ignore */ } } clearTimeout(pending); };
  }, [view]);

  // the prep board moves while prep is shown (a boss round's prep begins, or a teammate left and the pairs changed):
  // the next camera of the own board (the direction wheel sits on a board tile — it closes first)
  useEffect(() => {
    if (prepCamSeen.current === prepCamKey) return;
    prepCamSeen.current = prepCamKey;
    if (!view || viewModeRef.current !== 'prep' || !showPrep) return;
    if (live.current.facing) cancelFacingRef.current();
    setSel(null);
    const pc = prepCameraFor(pub, myId, shopFolded);
    setCam(pc.kind, pc.opts);
  }, [view, prepCamKey, showPrep]);

  // the shop bar folded (收起) or unfolded on the own prep board (public issue #5: the board did not grow, while the
  // battle and scouting views had no bar to make room for): the official shop-collapsed camera or the shop camera
  // again, flown like any camera change. Never over the pen or a teammate's board or in battle; deferred while a piece
  // is dragged or its direction is chosen (the drop target and the wheel sit on tiles of the camera in use) — this
  // effect runs again when that ends (gameLogic foldCamera). Picking reads the camera of every frame (render/pick.js).
  useEffect(() => {
    const next = foldCamera({
      pub, myId, folded: shopFolded, ownPrep: !!view && viewModeRef.current === 'prep' && showPrep,
      pen, busy: !!drag || !!facing, current: camRef.current,
    });
    if (next) setCam(next.kind, next.opts);
  }, [view, shopFolded, showPrep, pen, !!drag, !!facing, prepCamKey]);

  // 联防 / 最终攻势: the ‹ › pill moves the camera between the field's halves and 全景 (research 09 §3.1)
  useEffect(() => {
    if (!view || !field || !field.local || !isCombatPhase(phase)) return;
    if (!cameraLayers(field, pub, myId).length) return;
    const kind = field.kind === 'hidden' ? 'boss' : field.kind;
    setCam(kind, layerCamera(field, layer, sidesOf(field)[myId] || 'L'));
  }, [layer]);

  // 前往查看 of a teammate on a two-half shared field (a 联防 leaker / an eliminated spectator tapping a helper or a pair
  // player): the camera goes to that player's half, so the ‹ › pill reads "👁 name" like the strip's tag (DESIGN §20.15;
  // official observing targets a player, research 09 §3.1). Once per pick and per field entered (entering resets 全景).
  const whoAppliedRef = useRef({ who: null, field: null });
  useEffect(() => {
    const who = watchWho;
    if (!view || !who || !field || field.fieldId !== who.fieldId || !field.local || !isCombatPhase(phase)) return;
    const A = whoAppliedRef.current;
    if (A.who === who && A.field === field) return;
    whoAppliedRef.current = { who, field };
    const k = playerLayer(field, pub, myId, who.playerId);
    if (!k) return;
    setLayer(k);
    // the camera directly too: when the layer state already equals k the [layer] effect would not run
    setCam(field.kind === 'hidden' ? 'boss' : field.kind, layerCamera(field, k, sidesOf(field)[myId] || 'L'));
  }, [view, watchWho, field, phase]);

  // graceful degradation: without WebGL / the render engine the DOM view takes over — say so once per match
  useEffect(() => {
    if (viewKind !== 'fallback') return;
    let asked = null;
    try { asked = new URLSearchParams(globalThis.location?.search || '').get('render'); } catch { asked = null; }
    if (asked === 'fallback' || globalThis.__SP_RENDER__ === 'fallback') return;
    toast(t('渲染器暂时未能加载，已切换为简化视图（功能不受影响，可刷新重试）'), 'info', { ttl: 5000 });
  }, [viewKind]);

  // phase changes: banners, sounds, resets
  const phaseKey = `${phase}:${pub?.round}`;
  const prevPhase = useRef(null);
  const resultSeq = useRef(0);                           // re-keys the result box (ResultDialog) at every SETTLE
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === phase) return;
    const b = phaseBanner(phase, pub, { alive, spectator });
    if (b) setBanner({ ...b, key: phaseKey });
    if (phase === PHASE.ROUND_START) audio.sfx('roundStart');
    else if (phase === PHASE.PREP) audio.sfx('rest', { volume: 0.7 });
    else if (phase === PHASE.COMBAT) audio.sfx('battleStart');
    else if (phase === PHASE.UNITE) audio.sfx('defenceUnite');
    else if (phase === PHASE.FINAL_ASSAULT) audio.sfx(solo ? 'bossRoundSingle' : 'bossRoundTeam');
    else if (phase === PHASE.HIDDEN_CORE) audio.sfx('bossRoundSecret');
    else if (phase === PHASE.SP_DRAFT) audio.sfx('draft');
    else if (phase === PHASE.SETTLE) {
      // the official 战斗结束 sound and result box (GitHub #235, PR #112 by @Convey123; ui/gameLogic/phases.js): the LP this
      // round cost ME — after a 联防 the authority's own charge (m.public.uniteResult.losses: a leaker pays for the
      // survivors, not for its own battle's leaks), else the own battle's as kept while it ran (roundLossRef)
      const kept = roundLossRef.current;
      roundLossRef.current = null;
      const cost = kept && kept.round === pub?.round ? kept : null;
      const sfx = battleOverSfx(cost, pub?.uniteResult?.losses?.[myId]);
      if (sfx) audio.sfx(sfx);
      const nativeBox = uniteResultBox(pub?.uniteResult, myId) || battleResultBox(cost);
      // 共鸣是单人防守：没有敌人突破时干员仍会受伤，「全员无伤！」不成立；用明日方舟的「完美作战」
      const box = nativeBox?.tone === 'mint' ? { ...nativeBox, sub: t('完美作战') } : nativeBox;
      resultSeq.current += 1;
      if (box) setResultBox({ ...box, key: `result:${pub?.round}:${resultSeq.current}` });
    }
    // the server resets every watcher to its own field on phase changes — but an eliminated player / spectator seat
    // keeps the prep board it follows from 回合开始 through 机变 and 休整期 (Match._followScout re-points it only at the
    // round start): resetting here would fly the camera home and back at every prep phase (item 56)
    const keepScout = (phase === PHASE.SP_DRAFT || phase === PHASE.PREP) && (!alive || spectator)
      && typeof live.current.watching === 'string' && live.current.watching.startsWith('n:');
    if (!keepScout) {
      setWatching(null);
      setWatchWho(null);
    }
    // the pen is a 休整期 view: leaving prep returns the camera (the next setCam would, too)
    if (phase !== PHASE.PREP && penRef.current.on) togglePenRef.current(false);
    // a battle unit's panel (live HP of a unit of the fight that just ended) never outlives its battle
    if (!isCombatPhase(phase) && phase !== PHASE.SETTLE) setDetail((d) => (inBattleCard(d) ? null : d));
    if (isCombatPhase(phase)) { setCollapsed(false); setDrag(null); view?.highlightTiles(null, null); }
    setSel(null);
    if (phase !== PHASE.PREP) setRewardMin(false);
    setSpBusy(null);
  }, [phaseKey]);

  useEffect(() => {
    setPersonalBusy((b) => b?.choiceId === personalChoice?.id ? b : null);
    if (!personalChoice) return;
    setSel(null);
    setDetail(null);
    setArmedCard(null);
    setDrag(null);
    view?.highlightTiles(null, null);
    cancelFacingRef.current();
  }, [personalChoice?.id, view]);

  // a reload / reconnect while watching a teammate's battle after the own one (client-side combat): the server resends
  // the watched field, the fresh screen adopts it as watched once per battle — the observing pill, 返回战场 and the own
  // row work again, and the bond strip's "👁 name" matches the HUD (battle/observe.js resumedWatch)
  const seenBattleRef = useRef(null);
  useEffect(() => {
    const r = resumedWatch(battleState, { pub, myId, alive, watching, seen: seenBattleRef.current });
    seenBattleRef.current = r.seen;
    if (r.fieldId) setWatching(r.fieldId);
  }, [battleState?.battleId, battleState?.loading, !!pub]);

  // timer ticks (≤ 10 s) while the player still has something to do
  const cd = countdownState(pub?.deadline, serverNow(), total);
  useTicker(cd.remain != null && cd.remain <= 10 ? 1000 : 0);
  const lastTick = useRef(null);
  useEffect(() => {
    if (cd.remain == null || cd.remain > 10 || cd.remain === lastTick.current) return;
    lastTick.current = cd.remain;
    const busyPrep = phase === PHASE.PREP && priv && !priv.ready && alive;
    const myPick = sp && (solo || sp.turnPid === myId) && !sp.pickOf.has(myId);
    if ((busyPrep || myPick) && cd.remain > 0) audio.sfx('timer', { volume: 0.6 });
  });

  // your turn cue in the 机变 draft
  const spMine = !!sp && !solo && sp.turnPid === myId && !sp.pickOf.has(myId);
  useEffect(() => { if (spMine) audio.sfx('yourTurn'); }, [spMine]);

  // promotion (merge reward offered) and bond activation cues; a special refresh's offer (凯瑟琳 定向投放 …) plays the
  // shop's refresh sound instead of the promotion cue
  const offerCue = priv?.shop?.rewardOffer ? (priv.shop.rewardOffer.source === 'special' ? 'refresh' : 'merge') : null;
  useEffect(() => { if (offerCue) audio.sfx(offerCue); }, [offerCue]);
  // a shop / reward card armed for a purchase that completes a merge lights the tile its elite will take (the deployed
  // copy that deploys first — PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置", gameLogic.mergeTarget)
  const mergeAt = armedCard?.kind === 'chess' && editable && showPrep ? mergeTarget(priv, armedCard.id, gd.chess) : null;
  const mergeAtKey = mergeAt ? `${mergeAt.row},${mergeAt.col}` : '';
  useEffect(() => {
    if (!view) return;
    try { view.highlightTiles(mergeAt ? [[mergeAt.row, mergeAt.col]] : [], MERGE_HL); } catch { /* cosmetic */ }
  }, [view, mergeAtKey]);
  const activeBonds = (priv?.bonds || []).filter((b) => b && b.active).length;
  const prevActive = useRef(activeBonds);
  useEffect(() => {
    if (activeBonds > prevActive.current && phase === PHASE.PREP) audio.sfx('bondUp', { volume: 0.7 });
    prevActive.current = activeBonds;
  }, [activeBonds]);

  // emote bubbles (and a sound for teammates' emotes)
  const bubbleMs = (gd.config?.timers?.chatBubble ?? 3) * 1000;
  const bubbles = activeBubbles(emotes, Date.now(), bubbleMs);
  useTicker(bubbles.size ? 500 : 0); // re-render only while a bubble is showing (to expire it)
  const lastEmote = useRef(emotes.length ? emotes[emotes.length - 1].seq : 0);
  useEffect(() => {
    const e = emotes[emotes.length - 1];
    if (e && e.seq > lastEmote.current) { lastEmote.current = e.seq; if (e.playerId !== myId) audio.sfx('emote', { volume: 0.6 }); }
  }, [emotes]);

  // ---- actions ----------------------------------------------------------------------------------------------
  const buy = useCallback((i) => actions.buy(i), []);
  const removeSpectator = useCallback((playerId) => actions.removeSpectator(playerId), []);
  // Resonance carries gold between rounds and applies interest at settlement;
  // the base game's leftover-funds warning would describe the opposite economy.
  // Keep the Native warning unchanged for every other player/mode.
  const askingReady = useRef(false);
  const toggleReady = useCallback(async (r) => {
    const L = live.current;
    const me = Array.isArray(L.pub?.players) ? L.pub.players.find((p) => p && p.playerId === L.myId) : null;
    const ask = r && L.myId !== 'resonance'
      ? readyFundsPrompt(L.priv, { keptBands: data.get('config')?.economy?.leftoverFundsKeptByBands, autoplay: !!me?.autoplay }) : null;
    if (ask) {
      if (askingReady.current) return;
      askingReady.current = true;
      const ok = await confirmDialog(ask);
      askingReady.current = false;
      const now = live.current;
      if (!ok || now.pub?.phase !== PHASE.PREP || now.priv?.ready) return;
    }
    setReadyBusy(true);
    await actions.ready(r);
    setReadyBusy(false);
  }, []);
  // the prep ended (timer) while the question was open: drop it — the funds are gone either way
  useEffect(() => { if (phase !== PHASE.PREP && askingReady.current) closeAllDialogs(); }, [phase]);

  /** 出售 (operators, underframe +N) / 销毁 (items and Arts, confirmed: they cannot be sold). */
  const sellPiece = useCallback(async (piece) => {
    if (!piece) return false;
    const closeIt = () => { setDetail((d) => (d?.kind === 'piece' && d.uid === piece.uid ? null : d)); setSel((x) => (x && x.uid === piece.uid ? null : x)); };
    if (piece.kind === 'item') {
      // an equipped item is locked (the server refuses g.destroy): replacing it is the equip-replace dialog's job
      if (!itemDestroyable(live.current.placeCtx, piece.uid)) { toast(t('已配发的装备无法销毁'), 'warn'); audio.sfx('error', { volume: 0.5 }); return false; }
      const it = data.lookup('items', piece.id);
      const ok = await confirmDialog({ title: t('销毁道具'), text: t('道具无法出售。确定要销毁「{name}」吗？', { name: it?.name || t('道具') }), okText: t('销毁'), danger: true });
      if (ok && await actions.destroy(piece.uid)) { closeIt(); return true; }
      return false;
    }
    if (await actions.sell(piece.uid)) { closeIt(); return true; }
    return false;
  }, []);

  // The watched field only changes once the server accepted g.watch: a refused target (an eliminated teammate, the
  // other pair's boss field) must not move the eye icon / switcher label away from what is actually on screen.
  // `playerId`: the teammate picked (a team row) — a shared field shows two players, the strip follows the picked one
  // (DESIGN §20.15); null for a field picked as such (the legacy switcher).
  const requestWatch = useCallback(async (fid, playerId = null) => {
    const prev = live.current.watching;
    const prevWho = live.current.watchWho;
    const who = playerId ? { fieldId: fid, playerId } : null;
    setWatching(fid);
    setWatchWho(who);
    const ok = await actions.watch(fid, playerId);
    if (!ok) {
      setWatching((w) => (w === fid ? prev : w));
      setWatchWho((w) => (w === who ? prevWho : w));
    }
    return ok;
  }, []);

  /** Back to the own field (返回战场 / the own row). */
  const backHome = useCallback(() => {
    const L = live.current;
    if (L.watching && L.watching !== L.home) {
      const target = isCombatPhase(L.pub?.phase) ? L.home : ownFieldId(L.myId);
      // client-side combat without an own field to go back to (a 联防 leaker, an eliminated player): the screen keeps
      // the field it shows — g.watch of a field that does not exist would only be refused (an error toast); an
      // eliminated player / spectator seat has no prep board of its own either
      const combatNow = isCombatPhase(L.pub?.phase);
      const exists = combatNow ? (!isClientCombat(L.pub) || (Array.isArray(L.pub?.fields) && L.pub.fields.some((f) => f && f.fieldId === target)))
        : (L.alive && !L.spectator);
      if (exists) actions.watch(target);
    }
    setWatching(null);
    setWatchWho(null);
  }, []);

  const watchPlayer = useCallback((p) => {
    const L = live.current;
    if (isClientCombat(L.pub)) {
      const observing = !!L.watching && L.watching !== L.home && L.watching !== ownFieldId(L.myId);
      const t = observeTarget(p, L.pub, L.myId, { observing, ownDone: L.localDone });
      if (t.back) { backHome(); return; }
      if (t.reason) { toast(t.reason, 'warn'); audio.sfx('error', { volume: 0.5 }); return; }
      if (t.fieldId) requestWatch(t.fieldId, p.playerId);
      return;
    }
    const self = p.playerId === L.myId;
    if (self) {
      // (an eliminated player / spectator seat has no prep board of its own to ask for: item 56)
      const combatNow = isCombatPhase(L.pub?.phase);
      if (L.watching && L.watching !== L.home && (combatNow || (L.alive && !L.spectator))) actions.watch(combatNow ? L.home : ownFieldId(L.myId));
      setWatching(null);
      setWatchWho(null);
      return;
    }
    const t = watchTarget(p, L.pub, L.myId);
    if (t.reason) { toast(t.reason, 'warn'); audio.sfx('error', { volume: 0.5 }); return; }
    requestWatch(t.fieldId, p.playerId);
  }, []);

  const watchField = useCallback((fid) => { requestWatch(fid); }, []);

  // an eliminated player or a spectator seat follows a player through every phase reset (community report of
  // 2026-10-06, item 56; the idea of PR #189): the server pushes that player's prep board (Match._followScout) — the one
  // it last watched, else the first player still in — and the screen adopts it like a 前往查看 tap, once per phase and
  // board (a 返回战场 this phase is not overridden; a row switches to another player, who is followed from then on).
  // Until 0.2.0 every round's reset dropped an eliminated player onto its own empty board (a spectator seat asked for
  // the first player itself).
  const followRef = useRef(null);
  useEffect(() => {
    const fid = followedScout({ field, watching, alive, spectator, myId });
    if (!fid || !pub) return;
    const key = `${phaseKey}:${fid}`;
    if (followRef.current === key) return;
    followRef.current = key;
    // the phase reset's render (watching null) ran the own-prep branch with this scout meta in `field` and marked it
    // stale: un-mark it, or the enter effect refuses it and the board stays blank until the player moves (PR #189)
    if (staleFieldRef.current === field) staleFieldRef.current = null;
    setWatching(fid);
    setWatchWho({ fieldId: fid, playerId: fid.slice(2) });
  }, [field, pub, watching, alive, spectator, phaseKey, myId]);

  // ---- view events (drag & drop, clicks) ----------------------------------------------------------------------
  useEffect(() => {
    if (!view) return undefined;
    let moveOff = null;
    // the drop target is the tile under the pointer (render/drag.js; an item dropped on a unit's tile equips that unit —
    // user playtest #4 item 1); `tile` = the last target tile (tileHover), `released` = the pointer went up (not a cancel)
    const ptr = { released: false, tile: null };
    const lookups = { getChess: ownChess, getToken: gd.token, getItem: gd.item, chessRecord: (rec) => deployedRecord(rec, live.current.priv, ownChess, gd.backups) };
    const runIntent = async (intent) => {
      const L = live.current;
      // Resonance owns a three-slot inventory and resolves compatible recipes in its session action. The native
      // game's two-slot destructive replacement dialog would discard an item before the session can merge it.
      if (intent.confirmReplace && !L.resonanceState) {
        // both slots used: the player picks the equipped item to destroy (cancel ⇒ nothing is sent)
        const request = replaceRequest(L.placeCtx, intent, ownShown, gd.item);
        if (request) {
          const uid = await openReplaceRef.current(request);
          if (!Number.isInteger(uid)) { audio.sfx('back', { volume: 0.5 }); return; }
          const r = replaceIntent(intent, uid);
          await actions.equip(r.fields.itemUid, r.fields.targetUid, r.fields.replaceUid);
          return;
        }
      }
      const f = intent.fields;
      if (intent.t === 'g.move') await actions.move(f.uid, f.to);
      else if (intent.t === 'g.equip') {
        // 共鸣: three slots — a 4th item (or a second copy of a unique item) is refused with its reason and stays in the inventory
        const target = L.resonanceState?.pieces?.find(piece => Number(piece.nativeUid) === Number(f.targetUid));
        const item = L.resonanceState?.inventory?.find(row => Number(row.nativeUid) === Number(f.itemUid));
        const catalog = resonanceLive.current.catalog;
        const refusal = target && item ? equipRefusal(catalog, target, item.itemId, catalog?.operators?.[target.operatorId]?.name) : null;
        if (refusal) { audio.sfx('error', { volume: 0.5 }); toast(refusal, 'warn'); return; }
        await actions.equip(f.itemUid, f.targetUid);
      }
      else if (intent.t === 'g.art') await actions.art(f.itemUid, f.row, f.col);
    };
    const refuse = (reason) => {
      audio.sfx('error', { volume: 0.5 });
      if (reason) toast(reason, 'warn');
    };
    const endDrag = () => {
      moveOff?.(); moveOff = null;
      setDrag(null);
      sellRectRef.current = null;
      setSellRect(null);
      view.highlightTiles(null, null);
    };
    /** Open the direction wheel for a legal board drop (the piece stays on the tile meanwhile). */
    const openFacing = (entry, t) => {
      const piece = entry.piece;
      const rec = piece.kind === 'item' ? gd.item(piece.id) : piece.kind === 'token' ? gd.token(piece.id) : ownShown(piece.id);
      holdPiece(view, piece.uid, { row: t.row, col: t.col });
      setSel(null);
      setFacing({ uid: piece.uid, piece, row: t.row, col: t.col, grid: previewGrid(lookups, piece), name: rec?.name || '' });
      audio.sfx('pick', { volume: 0.5 });
    };
    const offs = [
      view.on('pieceDragStart', (e) => {
        const L = live.current;
        const entry = L.placeCtx?.pieces.get(e?.uid);
        if (!entry || !L.editable) return;
        audio.sfx('pick', { volume: 0.6 });
        setSel(null);
        // a new placement: a piece's detail card (right-click / long-press) would sit beside the wheel showing another unit
        setDetail((d) => (d?.kind === 'piece' ? null : d));
        setDrag({ uid: entry.piece.uid, kind: entry.piece.kind, id: entry.piece.id, area: entry.area });
        const saleRect = entry.piece.kind === 'chess' && live.current.showPrep
          ? nativeSellTargetRect(barRef.current?.getBoundingClientRect?.()) : null;
        sellRectRef.current = saleRect;
        setSellRect(saleRect);
        const { legal } = boardTargets(L.placeCtx, entry.piece.uid);
        view.highlightTiles(null, null);
        view.highlightTiles(legal, 'legal');
        ptr.released = false; ptr.tile = null;
        // capture phase: marked before the drag controller (canvas listener) ends the drag
        const onUp = () => { ptr.released = true; };
        window.addEventListener('pointerup', onUp, { passive: true, capture: true });
        moveOff = () => window.removeEventListener('pointerup', onUp, { capture: true });
      }),
      view.on('tileHover', (t) => { ptr.tile = t && typeof t === 'object' ? t : null; }),
      view.on('pieceDrop', async (e) => {
        // Capture the target before endDrag removes it from the DOM.
        const saleRect = sellZoneRef.current?.getBoundingClientRect?.() || sellRectRef.current;
        endDrag();
        const L = live.current;
        if (!e || !L.editable) return;
        const entry = L.placeCtx?.pieces.get(e.uid);
        if (!entry) return;
        const t = e.target || {};
        if (t.area === 'outside') {
          if (entry.piece.kind !== 'chess' || !L.showPrep) return;
          const sellValue = underframeActions(L.placeCtx, entry.piece.uid)?.sell;
          await dispatchNativeSellDrop({ piece: entry.piece, showPrep: L.showPrep, sell: sellValue, target: t, rect: saleRect, onSell: sellPiece });
          return;
        }
        const res = canPlace(L.placeCtx, e.uid, t);
        if (needsFacing(L.placeCtx, e.uid, t, res)) { openFacing(entry, t); return; }
        const intent = dropIntent(L.placeCtx, e.uid, t);
        if (!intent) {
          if (res.code && res.code !== 'ALREADY') refuse(res.reason);
          return;
        }
        await runIntent(intent);
      }),
      view.on('pieceDragEnd', (e) => {
        // a cancelled drag (no pieceDrop) must not leave the highlights behind; a release on a tile that takes nothing
        // (the drag controller found no legal target there) says why
        const released = ptr.released;
        const tile = ptr.tile;
        endDrag();
        const L = live.current;
        if (!e || e.dropped || !released || !L.editable) return;
        const src = L.placeCtx?.pieces.get(e.uid);
        if (!src) return;
        const onOwnSlot = !!tile && ((src.area === 'board' && tile.area === 'board' && tile.row === src.row && tile.col === src.col)
          || (src.area !== 'board' && tile.area === src.area && (tile.idx ?? tile.col) === src.idx));
        if (onOwnSlot) return; // put back where it was
        const reason = dropFailureReason(L.placeCtx, e.uid, tile);
        if (reason) refuse(reason);
      }),
      view.on('pieceClick', (e) => {
        if (!e) return;
        audio.sfx('click', { volume: 0.4 });
        const special = (live.current.resonanceState?.specialEntities || []).find(row => Number(row.nativeUid ?? row.uid) === Number(e.uid));
        if (special) { setResonanceDetail({ kind: 'specialEntity', id: special.entityId }); return; }
        // an enemy of the preview pen (research 09 §2.2 "Intel": tap it for its detail card)
        const penKey = previewEnemyKey(e);
        if (penKey) { setDetail({ kind: 'enemy', id: penKey }); return; }
        if (e.unitId != null || e.unit) { setDetail({ kind: 'unit', unit: e.unit || null, unitId: e.unitId, uid: e.uid }); return; }
        if (!Number.isInteger(e.uid)) return;
        setDetail({ kind: 'piece', uid: e.uid });
        // a tap selects an own piece (underframe + range); right-click / long-press only opens its detail card. A tap on
        // the piece that was selected when the press started deselects it.
        const L = live.current;
        if (e.detail || e.button === 2 || !L.editable || L.facing) return;
        const wasSel = pressSel.current === e.uid;
        pressSel.current = null;
        setSel(wasSel ? null : { uid: e.uid });
        if (wasSel) setDetail((d) => (d?.kind === 'piece' && d.uid === e.uid ? null : d));
      }),
      // a tap on the ground itself: a stage device on the tile (阻隔工事 / “双眼皮” / 射击台 / 源石流发生装置: GitHub #228, PR
      // #229) explains itself first — the renderer's pick skips devices, so the tap lands here —, then a special terrain
      // tile (GitHub issue #184 「建议加入对于特殊地形的单击信息提示」) — 活性源石 / 沼泽 / 排气格栅 / 深水区 / 红蓝门 /
      // 传送, with the numbers of the stage behind the board. An ordinary tile (road / floor / wall) says nothing, so the
      // press keeps its other meanings (deselect, close).
      view.on('tileClick', (t) => {
        if (!t || !Number.isInteger(t.row) || !Number.isInteger(t.col)) return;
        const L = live.current;
        const [row, col] = L.terrainTile(t.row, t.col);
        const device = L.deviceBattle
          ? deviceTipAt(L.terrainStage, row, col, { units: [...deviceUnitsRef.current.values()], snap: snapUnitsRef.current })
          : deviceInfo(L.terrainStage, row, col);
        if (device) {
          audio.sfx('click', { volume: 0.4 });
          setSel(null);
          setDetail({ kind: 'device', device });
          return;
        }
        const info = terrainInfo(L.terrainStage, row, col);
        if (!info) return;
        audio.sfx('click', { volume: 0.4 });
        setSel(null);
        setDetail({ kind: 'terrain', terrain: info });
      }),
    ];
    return () => { moveOff?.(); for (const off of offs) { try { off?.(); } catch { /* ignore */ } } };
  }, [view]);

  // ---- equip-replace dialog (ui/equipReplace.js): one at a time; resolves the picked replaceUid or null (cancel) ----------
  const replaceRef = useRef(null);
  replaceRef.current = replace;
  const closeReplace = useCallback((uid) => {
    const cur = replaceRef.current;
    if (!cur) return;
    replaceRef.current = null;
    setReplace(null);
    try { cur.resolve(Number.isInteger(uid) ? uid : null); } catch { /* ignore */ }
  }, []);
  const openReplaceRef = useRef(null);
  openReplaceRef.current = (request) => new Promise((resolve) => {
    if (replaceRef.current) { try { replaceRef.current.resolve(null); } catch { /* ignore */ } }
    const next = { request, resolve };
    replaceRef.current = next;
    setSel(null);
    setReplace(next);
    audio.sfx('click', { volume: 0.5 });
  });
  // the dialog closes (nothing sent) when editing stops or its operator / item / equipped items changed meanwhile
  useEffect(() => {
    if (!replace) return;
    const r = replace.request;
    const target = placeCtx.pieces.get(r.targetUid)?.piece;
    const items = Array.isArray(target?.items) ? target.items : [];
    const still = editable && !!target && !!placeCtx.pieces.get(r.item.uid) && r.options.every((o) => items.some((x) => x && x.uid === o.uid));
    if (!still) closeReplace(null);
  }, [replace, placeCtx, editable]);
  useEffect(() => () => { const cur = replaceRef.current; replaceRef.current = null; try { cur?.resolve(null); } catch { /* ignore */ } }, []);

  // ---- solo pause (g.pause; m.public.paused) ---------------------------------------------------------------------------
  const togglePause = useCallback(async (on) => {
    setPauseBusy(true);
    await actions.pause(on);
    setPauseBusy(false);
  }, []);
  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;

  // a press on the field deselects (a tap on a piece selects it again at release — see pieceClick)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onDown = () => {
      const L = live.current;
      pressSel.current = L.sel ? L.sel.uid : null;
      if (L.sel) setSel(null);
      // tapping elsewhere closes the selection and a card opened from the field — by a tap, a right-click or a long
      // press (a press on a piece re-opens its card at release, pieceClick)
      setDetail((d) => (closesOnFieldPress(d) ? null : d));
    };
    const onMove = (event) => {
      const hit = view?.pieceAtClient?.(event.clientX, event.clientY);
      live.current.hoverUid = Number.isSafeInteger(hit?.uid) ? hit.uid : null;
    };
    host.addEventListener('pointerdown', onDown, true);
    host.addEventListener('pointermove', onMove, { passive: true });
    return () => { host.removeEventListener('pointerdown', onDown, true); host.removeEventListener('pointermove', onMove); };
  }, [view]);

  // ---- direction step (research 09 §1.2) and the selected piece's underframe ------------------------------------
  const heldRef = useRef(new Map());                     // uid → { row, col, t } committed placements awaiting m.private
  const releaseHold = useCallback((uid) => {
    heldRef.current.delete(uid);
    holdPiece(view, uid, null);
    setHoldSeq((n) => n + 1);                           // re-apply the prep state: the piece settles where the server says
  }, [view]);
  const cancelFacing = useCallback(() => {
    const f = live.current.facing;
    if (!f) return;
    setFacing(null);
    if (f.piece.kind !== 'item') setPieceDir(view, f.uid, pieceDir(f.piece));
    releaseHold(f.uid);
    audio.sfx('back', { volume: 0.5 });
  }, [view, releaseHold]);
  cancelFacingRef.current = cancelFacing;
  const previewFacing = useCallback((dir) => {
    const f = live.current.facing;
    if (!f || f.piece.kind === 'item') return;
    setPieceDir(view, f.uid, dir || pieceDir(f.piece));
  }, [view]);
  const commitFacing = useCallback(async (dir) => {
    const f = live.current.facing;
    if (!f) return;
    setFacing(null);
    const intent = facingIntent(f.piece, { row: f.row, col: f.col }, dir);
    heldRef.current.set(f.uid, { row: f.row, col: f.col, t: Date.now() });
    const ok = intent.t === 'g.art'
      ? await actions.art(intent.fields.itemUid, intent.fields.row, intent.fields.col, intent.fields.dir)
      : await actions.move(intent.fields.uid, intent.fields.to, intent.fields.dir);
    if (!ok) {
      if (f.piece.kind !== 'item') setPieceDir(view, f.uid, pieceDir(f.piece));
      releaseHold(f.uid);
      return;
    }
    // accepted: the piece stays on the tile until m.private shows it there (or a short grace passes)
    setTimeout(() => { if (heldRef.current.has(f.uid)) releaseHold(f.uid); }, 1500);
  }, [view, releaseHold]);
  // m.private caught up with a committed placement → stop holding it; a summon stack of several copies (凯瑟琳's 2
  // devices, user playtest #6) stays in the hand and one copy — another piece — lands on the tile: release it too
  useEffect(() => {
    const splitLanded = (e, h) => e.piece.kind === 'token' && [...placeCtx.pieces.values()].some((x) => x.area === 'board' && x.piece.kind === 'token'
      && x.piece.id === e.piece.id && x.piece.uid !== e.piece.uid && x.row === h.row && x.col === h.col);
    for (const [uid, h] of [...heldRef.current]) {
      const e = placeCtx.pieces.get(uid);
      if (!e || (e.area === 'board' && e.row === h.row && e.col === h.col) || (e.area !== 'board' && splitLanded(e, h))) releaseHold(uid);
    }
  }, [placeCtx]);
  // the wheel closes when editing stops (ready, phase end, observing) or its piece is gone (merged, sold)
  useEffect(() => {
    if (facing && (!editable || !placeCtx.pieces.get(facing.uid))) cancelFacing();
  }, [editable, placeCtx, facing]);
  // the selected piece: gone / not editable → deselect (its range tiles: the detail card's, cardRange below)
  const selEntry = sel ? placeCtx.pieces.get(sel.uid) || null : null;
  live.current.showPrep = showPrep;
  useEffect(() => { if (sel && (!selEntry || !editable || !showPrep)) setSel(null); }, [sel, selEntry, editable, showPrep]);
  // the selected piece's underframe on screen: the detail card docks on the side away from it (user playtest #2
  // item 8 — at some aspect ratios a bench unit's 出售 sat under the left card); the underframe is drawn above every
  // panel anyway (css z-index), this keeps it visible too
  const ufTile = selEntry && editable && showPrep ? pieceTile(selEntry) : null;
  const ufGeo = useTileScreen(view, ufTile ? ufTile.row : null, ufTile ? ufTile.col : null);
  // the gold tile of an armed merge card (mergeAt): the detail card the first tap opened docks away from it (QA 6b — at
  // 1920×1080 the left card covered half of a target tile in the leftmost legal column)
  const mergeGeo = useTileScreen(view, mergeAt ? mergeAt.row : null, mergeAt ? mergeAt.col : null);
  const retreatSel = useCallback(async () => {
    const L = live.current;
    const uid = L.sel?.uid;
    const to = uid != null ? retreatSlot(L.placeCtx, uid) : null;
    if (!to) { toast(t('整备区已满'), 'warn'); audio.sfx('error', { volume: 0.5 }); return; }
    setSelBusy(true);
    if (await actions.move(uid, to)) {
      setSel(null);
      setDetail((d) => (d?.kind === 'piece' && d.uid === uid ? null : d)); // its card would cover the bench
    }
    setSelBusy(false);
  }, []);
  const sellSel = useCallback(async () => {
    const e = live.current.sel ? live.current.placeCtx.pieces.get(live.current.sel.uid) : null;
    if (!e) return;
    setSelBusy(true);
    await sellPiece(e.piece);
    setSelBusy(false);
  }, []);

  // unit clicks from the engine may only carry an id: resolve through m.field / spawn infos
  const detailTarget = useMemo(() => {
    if (detail?.kind !== 'unit' || detail.unit) return detail;
    const u = (Array.isArray(field?.units) ? field.units : []).find((x) => x && x.id === detail.unitId);
    return u ? { ...detail, unit: u } : detail;
  }, [detail, field]);
  const resolved = useMemo(() => resolveDetail(detailTarget, placeCtx.pieces, { priv, backups: gd.backups }), [detailTarget, placeCtx, priv, gd.backups, gd.ready]);
  useEffect(() => { if (detail && !resolved && detail.kind === 'piece') setDetail(null); }, [resolved]);
  const snapHp = (() => {
    const id = resolved?.unitId;
    const t = id != null ? snapUnitsRef.current.get(id) : null;
    return t ? { hp: t[3], max: t[4] } : null;
  })();
  const resonanceDockState = resonanceState ? {
    ...resonanceState,
    pieces: (resonanceState.pieces || []).map(piece => ({
      ...piece,
      sessionUid: piece.uid,
      uid: piece.nativeUid ?? piece.uid,
      equipment: (piece.equipment || []).map(item => ({ ...item, sessionUid: item.uid, uid: item.nativeUid ?? item.uid })),
    })),
    inventory: (resonanceState.inventory || []).map(item => ({ ...item, sessionUid: item.uid, uid: item.nativeUid ?? item.uid })),
  } : null;
  const combineResonanceItems = async ({ itemUids = [] } = {}) => {
    const wanted = new Set(itemUids.map(String));
    const sessionUids = (resonanceState?.inventory || []).filter(item => wanted.has(String(item.nativeUid ?? item.uid))).map(item => item.uid);
    if (sessionUids.length !== 2) return;
    await net.request('g.resonance', { action: { type: 'combine', itemUids: sessionUids } });
  };
  const openNativeResonanceDetail = (target) => {
    setResonancePanel(null);
    setDetail(null);
    if (target?.kind === 'item' && target.itemUid != null) {
      const inventoryItem = resonanceState?.inventory?.find(item => Number(item.nativeUid) === Number(target.itemUid));
      if (inventoryItem) { setResonanceDetail({ ...target, itemUid: inventoryItem.uid }); return; }
      for (const piece of resonanceState?.pieces || []) {
        const equipped = piece.equipment?.find(item => Number(item.nativeUid) === Number(target.itemUid));
        if (equipped) { setResonanceDetail({ ...target, itemUid: equipped.uid, ownerUid: piece.uid }); return; }
      }
    }
    setResonanceDetail(target);
  };
  const equipmentDropOver = (event) => {
    if (event.dataTransfer?.types?.includes('application/x-resonance-special')) {
      if (!editable) return;
      event.preventDefault();
      const tile = event.target?.closest?.('.gm__field') ? specialBoardTile(view, event.clientX, event.clientY) : null;
      setSpecialDropTile(tile);
      return;
    }
    if (!event.dataTransfer?.types?.includes('application/x-stronghold-equipment')) return;
    event.preventDefault();
    const hit = event.target?.closest?.('.gm__field') ? view?.pieceAtClient?.(event.clientX, event.clientY) : null;
    const piece = hit && resonanceState?.pieces?.find((candidate) => Number(candidate.nativeUid) === Number(hit.uid));
    setEquipmentDropTarget(piece?.nativeUid ?? null);
  };
  const equipmentDrop = async (event) => {
    if (event.dataTransfer?.types?.includes('application/x-resonance-special')) {
      if (!editable) return;
      event.preventDefault();
      const nativeUid = Number(event.dataTransfer.getData('application/x-resonance-special'));
      const tile = event.target?.closest?.('.gm__field') ? specialBoardTile(view, event.clientX, event.clientY) : null;
      setSpecialDropTile(null);
      const entity = resonanceState?.specialEntities?.find(row => Number(row.nativeUid ?? row.uid) === nativeUid);
      if (!entity || !tile) { toast('请把训练纸偶放在己方部署区域内', 'info'); return; }
      await actions.move(nativeUid, { area: 'board', row: tile.row, col: tile.col });
      return;
    }
    if (!event.dataTransfer?.types?.includes('application/x-stronghold-equipment')) return;
    event.preventDefault();
    const itemUid = Number(event.dataTransfer.getData('application/x-stronghold-equipment'));
    const hit = event.target?.closest?.('.gm__field') ? view?.pieceAtClient?.(event.clientX, event.clientY) : null;
    const target = hit && resonanceState?.pieces?.find((candidate) => Number(candidate.nativeUid) === Number(hit.uid));
    const item = resonanceState?.inventory?.find((candidate) => Number(candidate.nativeUid) === itemUid);
    setEquipmentDropTarget(null);
    if (!editable || !item || !target) { toast('请把装备拖到一名可操作的干员身上', 'info'); return; }
    const refusal = equipRefusal(resonanceCatalog, target, item.itemId, resonanceCatalog?.operators?.[target.operatorId]?.name);
    if (refusal) { audio.sfx('error', { volume: 0.5 }); toast(refusal, 'warn'); return; }
    await actions.equip(item.nativeUid, target.nativeUid);
  };
  // a crate's / turret's card closes with it: destroyed (HP gone, or its tuple left the snapshots once the die animation
  // is over — before the first snapshot of a battle nothing is judged)
  useEffect(() => {
    const id = detail?.kind === 'device' ? detail.device?.unitId : null;
    const snap = snapUnitsRef.current;
    if (id != null && snap.size > 0 && !(snap.get(id)?.[3] > 0)) setDetail(null);
  }, [hud, detail]);

  // ---- live stats of the detail card (user playtest #4 item 7) ------------------------------------------------------
  // battle: the local sim's unit (battle/runner.js unitStats — a getter the panel re-reads 4× a second; any unit of the
  // battle on screen: own, a teammate's, an enemy). Prep: an own board unit's stats at the start of its next battle,
  // asked from the server (g.unitStats → m.unitStats; only the newest request's answer counts) whenever m.private or the
  // phase changes while such a card is open — the last answer stays on show until the next one lands
  const [unitStats, setUnitStats] = useState(null);      // m.unitStats: { seq, round, units: Map<uid, entry> }
  const statsSeqRef = useRef(0);
  useEffect(() => net.on('m.unitStats', (msg) => {
    if (!msg || msg.seq !== statsSeqRef.current || !Array.isArray(msg.units)) return;
    setUnitStats({ seq: msg.seq, round: msg.round, units: new Map(msg.units.filter((u) => u && Number.isInteger(u.uid)).map((u) => [u.uid, u])) });
  }), []);
  const prepStatsUid = (phase === PHASE.PREP || phase === PHASE.SP_DRAFT || phase === PHASE.ROUND_START) && showPrep && alive
    && !!resolved?.piece && (resolved.type === 'chess' || resolved.type === 'token') && placeCtx.pieces.get(resolved.piece.uid)?.area === 'board'
    ? resolved.piece.uid : null;
  useEffect(() => {
    if (prepStatsUid == null) return undefined;
    const t = setTimeout(() => {
      statsSeqRef.current = (statsSeqRef.current % 1e9) + 1;
      try { Promise.resolve(net.request('g.unitStats', { seq: statsSeqRef.current })).catch(() => {}); } catch { /* offline */ }
    }, 120);
    return () => clearTimeout(t);
  }, [prepStatsUid, priv, phase]);
  const liveStats = (() => {
    if (prepStatsUid != null) {
      const e = unitStats && unitStats.round === pub?.round ? unitStats.units.get(prepStatsUid) : null;
      return e ? { ...e, src: 'prep' } : null;
    }
    // a battle unit's card, or an own board piece's card left open into the battle (its unit found by uid)
    const id = resolved?.unitId;
    const pieceUid = id == null && Number.isInteger(resolved?.piece?.uid) ? resolved.piece.uid : null;
    if ((id == null && pieceUid == null) || !cc || !battleRunner || !field?.local || showPrep) return null;
    const fid = field.fieldId;
    return () => {
      const uid = id ?? battleRunner.unitIdOf(pieceUid, myId, fid);
      const e = uid != null ? battleRunner.unitStats(uid, fid) : null;
      return e ? { ...e, src: 'battle' } : null;
    };
  })();

  // Keep the right-side mode drawer above the native shop's actual hit area on desktop and touch layouts.
  useEffect(() => {
    if (!resonancePanel && !resonanceDetail) { setResonancePanelBottom(null); setResonanceDetailBottom(null); return undefined; }
    let frame = 0;
    const shop = () => barRef.current || document.querySelector('.rs-native-match .shopbar, .rs-native-match .shopbar-tab');
    const measure = () => {
      const node = shop(), rect = node?.getBoundingClientRect?.();
      const visible = rect && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
      const safeBottom = visible ? Math.max(12, Math.ceil(window.innerHeight - rect.top + 10)) : null;
      setResonancePanelBottom(resonancePanel ? safeBottom : null);
      setResonanceDetailBottom(resonanceDetail ? safeBottom : null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const node = shop(); if (node) observer?.observe(node);
    window.addEventListener('resize', schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', schedule); };
  }, [resonancePanel, resonanceDetail, showShop, collapsed, phase, priv?.ready]);

  // ---- keyboard ---------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = async (e) => {
      const act = resonanceShortcutFor(e);
      if (!act) return;
      if (act !== 'escape' && e.target instanceof HTMLElement
        && (e.target.isContentEditable || e.target.closest('input,textarea,select,[contenteditable="true"]'))) return;
      const L = live.current;
      // dialogs / the guide own the keyboard; behind the 本局信息 / 敌方情报 drawer only Esc (closing it) acts
      if (codexStateRef.current.open) {
        if (act === 'escape') {
          e.preventDefault();
          if (codexStateRef.current.detail) setCodexDetail(null); else closeCodex();
        }
        return;
      }
      if (shortcutBlocked(act, { modal: !!document.querySelector('.modal, .guide'), drawer: !!L.drawer })) return;
      if (L.hasPersonalChoice) {
        if (act !== 'escape') e.preventDefault();
        if (act === 'ready') {
          audio.sfx('error', { volume: 0.5 });
          toast(shopBlockReason('ready', { priv: L.priv, editable: true }), 'warn');
        }
        return; // ChoiceOverlay handles Escape without cancelling the server's pending choice.
      }
      if (act === 'escape') {
        if (L.emoteOpen) setEmoteOpen(false);
        else if (L.pen && !L.detail) togglePenRef.current(false);
        else if (L.bondOpen) setBondOpen(null);
        else if (L.detail) setDetail(null);
        else if (L.drawer) setDrawer(null);
        else return;
        e.preventDefault();
        return;
      }
      // the ready key (Space unless rebound) pauses / resumes a solo battle (Space: the official battle key)
      if (act === 'ready' && (L.canPause || L.paused)) {
        e.preventDefault();
        if (e.target instanceof HTMLElement && e.target.closest('button, [role="button"]')) e.target.blur();
        togglePauseRef.current(!L.paused);
        return;
      }
      if (L.pub?.phase !== PHASE.PREP || !L.priv) return;
      e.preventDefault(); // a focused HUD button must not also activate (Space, or any key bound) — see shortcutFor
      if (act === 'ready' && e.target instanceof HTMLElement && e.target.closest('button, [role="button"]')) e.target.blur();
      if (act === 'ready') {
        const refused = !L.priv.ready ? shopBlockReason('ready', { priv: L.priv, editable: true }) : null;
        // the temp overflow row blocks it: say why (the button shows it too — user playtest #3 item 3)
        if (refused) { audio.sfx('error', { volume: 0.5 }); toast(tempReadyReason(L.priv) || refused, 'warn'); return; }
        toggleReady(!L.priv.ready);
        return;
      }
      if (!L.editable) return;
      if (act === 'retreat' || act === 'sell') {
        if (!L.showPrep || L.drag || L.facing || L.selBusy) return;
        const uid = L.sel?.uid ?? L.hoverUid;
        const selected = uid != null ? L.placeCtx.pieces.get(uid) : null;
        if (selected?.piece.kind !== 'chess') return;
        const available = underframeActions(L.placeCtx, uid);
        if (act === 'retreat' && available?.retreat) {
          const to = retreatSlot(L.placeCtx, uid); if (!to) return;
          setSelBusy(true); await actions.move(uid, to); setSelBusy(false);
        } else if (act === 'retreat' && selected.area === 'hand') {
          const source = L.resonanceState?.pieces?.find((piece) => Number(piece.nativeUid ?? piece.uid) === Number(uid));
          const occupied = new Set([...L.placeCtx.pieces.values()].filter((entry) => entry.area === 'board').map((entry) => `${entry.row},${entry.col}`));
          const target = firstAvailableLegalTile(source?.legalTiles, occupied);
          if (!target) { toast('没有可部署的位置', 'warn'); return; }
          setSelBusy(true); await actions.move(uid, { area: 'board', row: target.row, col: target.col }); setSelBusy(false);
        } else if (act === 'sell' && available?.sell != null) {
          setSelBusy(true); await sellPiece(selected.piece); setSelBusy(false);
        }
        return;
      }
      const reason = shopBlockReason(act, { priv: L.priv, editable: L.editable });
      if (reason) { audio.sfx('error', { volume: 0.5 }); return; }
      if (act === 'refresh') actions.refresh();
      else if (act === 'freeze') actions.freeze();
      else if (act === 'levelUp') actions.levelUp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- render ---------------------------------------------------------------------------------------------------
  const readyCount = players.filter((p) => p.ready || p.status === 'ready').length;
  const aliveCount = players.filter((p) => p.alive !== false && p.status !== 'left').length;
  // the own battle is over: the server says so (status done) or — client-side combat — the local simulation just ended
  const localDone = cc && !!battleState && battleState.own && !battleState.watch && battleState.done && battleState.fieldId === ownFieldId(myId);
  // (client-side combat: only in 各自行动 — 联防 observers just watch the 联防 field, research 09 §3.1)
  const myDone = combat && (cc ? phase === PHASE.COMBAT && (meP?.status === 'done' || localDone) : meP?.status === 'done');
  live.current.localDone = localDone;
  // the solo pause button: only while the own battle still runs (the server refuses it afterwards)
  const canPause = pauseAvailable(pub, { solo, alive, done: meP?.status === 'done' || localDone });
  live.current.canPause = canPause;
  // client-side combat: observing a teammate's battle (research 09 §3.1) and the 联防 / 最终攻势 camera halves
  // (an eliminated player auto-observes a teammate's normal field — research 09 "keep-watching" — without asking)
  const watchedFid = watchingOther ? watching : (cc && combat && !alive && battleState && battleState.watch && battleState.kind === 'normal' ? battleState.fieldId : null);
  // the ‹ › pill: on the 联防 / 最终攻势 field on screen — also one watched with 前往查看 (a leaker, an eliminated spectator)
  const layers = cc && combat && field && field.local && (!watchingOther || field.fieldId === watching) ? cameraLayers(field, pub, myId) : [];
  const progress = cc && phase === PHASE.COMBAT ? teammateProgress(pub, myId) : null;
  // the bond strip follows the player on screen (DESIGN §20.15, ui/watchBonds.js): a teammate's board / battle (前往查看,
  // an eliminated player's auto-observed field) → their bonds; a 联防 / 最终攻势 field → the player on the ‹ › half (全景:
  // yours when you fight there, else the teammate picked with 前往查看 / the field's first player); in battle with the
  // live layers of the battle on screen (the runner's bondLayers)
  const settleMode = mode === 'settle';
  const strip = screenStrip({
    pub, priv, myId, combat, settle: settleMode, watchingOther, watching, home,
    battleFieldId: cc ? (battleState?.fieldId || null) : (combat || settleMode ? lastFieldRef.current : null),
    field, layers, layer, who: watchWho, bondLayers: battleState?.bondLayers || null,
  });
  const stripFid = strip.fieldId;
  const liveLayers = (combat || settleMode) && battleState?.bondLayers ? battleState.bondLayers : null;
  // the observing pill names the player whose bonds the strip shows (the same teammate as the strip's "👁 name" tag)
  const observingName = cc && combat && watchedFid ? (!strip.self && stripFid === watchedFid ? strip.name : (players.find((p) => p.fieldId === watchedFid || ownFieldId(p.playerId) === watchedFid)?.name || t('队友'))) : null;
  const watchedP = watchingOther ? (players.find((p) => p.playerId !== myId && (watching === ownFieldId(p.playerId) || (watching === p.fieldId && String(watching).startsWith('n:')))) || null) : null;
  const watchedName = watchingOther ? (watchedP?.name || players.find((p) => watching === p.fieldId)?.name || t('队友')) : null;
  const stripBonds = strip.bonds;
  // a popup opened from the strip closes when the strip changes hands (another teammate scouted / a ‹ › half / back to
  // the own bonds); one opened from a card's chip keeps its unit owner (it carries its own player either way)
  const stripOwnerRef = useRef(strip.ownerId);
  useEffect(() => {
    if (stripOwnerRef.current === strip.ownerId) return;
    stripOwnerRef.current = strip.ownerId;
    setBondOpen((b) => (b && b.from === 'strip' ? null : b));
  }, [strip.ownerId]);
  // the popup shows the player it was opened for (ui/watchBonds.js popupView): their entry + live layers, their name,
  // and as members your pieces or their operators on the field on screen — under client-side combat the battle's own
  // (the runner's field meta is taken before they deploy); a battle sends no bench (a prep scout does: ownerBoard)
  const popOps = cc && battleRunner && field?.local && bondOpen && bondOpen.ownerId !== myId ? battleRunner.ownerOps(bondOpen.ownerId, field.fieldId) : null;
  const bondPop = popupView({ open: bondOpen, pub, priv, myId, field, units: popOps, live: liveLayers });
  const openBond = (id, ownerId, from) => {
    if (resonanceState && resonanceCatalog) { setResonanceDetail({ kind: 'pact', id }); audio.sfx('click', { volume: 0.4 }); return; }
    setBondOpen((b) => toggleBond(b, id, ownerId, from)); audio.sfx('click', { volume: 0.4 });
  };
  const watchingNow = combat ? (watching || field?.fieldId || home) : watching;
  const shopOpen = showShop && !collapsed;
  const ufShown = !!(selEntry && editable && !facing && !drag && showPrep && ufGeo);
  // the temp overflow row holds pieces (user playtest #3 item 3): framed and labelled on the own prep board
  const temp = tempInfo(priv);
  const tempNotice = temp.count > 0 && !!view && viewKind !== 'loading' && showPrep && alive && !pen && !sp;
  // the ready button shows why it is refused under it (ui/hud.js ReadyToggle): the effects column moves down a line
  const readyWhy = phase === PHASE.PREP && alive && !priv?.ready && (hasPersonalChoice || temp.count > 0);
  // the frame the panels are laid out in: the HUD layer (client px; inside the safe-area insets of a notched phone),
  // and the root font size (1rem)
  const panelFrame = () => {
    let rem = 100;
    try { rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100; } catch { /* default */ }
    let b = null;
    try { b = hudElRef.current?.getBoundingClientRect() || null; } catch { b = null; }
    const vp = b && b.width > 0 && b.height > 0 ? { left: b.left, top: b.top, width: b.width, height: b.height }
      : { left: 0, top: 0, width: globalThis.innerWidth || 1920, height: globalThis.innerHeight || 1080 };
    return { rem, vp };
  };
  const dSide = (() => {
    if (ufShown) {
      const { rem, vp } = panelFrame();
      return panelSide(underframeRect(ufGeo, rem), panelSlots(vp, rem, { shopOpen }));
    }
    if (mergeGeo && resolved) {
      const { rem, vp } = panelFrame();
      const half = (mergeGeo.s > 0 ? mergeGeo.s : 64) * 1.05; // the tile diamond's box (underframeRect's)
      return panelSide({ left: mergeGeo.x - half, right: mergeGeo.x + half, top: mergeGeo.y - half, bottom: mergeGeo.y + half }, panelSlots(vp, rem, { shopOpen }));
    }
    return 'left';
  })();
  // the bond popup: next to the card, never over the selected unit's underframe when a place is free (bondPopupPlace)
  const bpPlace = (() => {
    if (!bondOpen) return 'left';
    const { rem, vp } = panelFrame();
    return bondPopupPlace(ufShown ? underframeRect(ufGeo, rem) : null, vp, rem, resolved ? dSide : null);
  })();
  // the player's own operators (and the shop / bond member cards) show the loadout's skill / module (DESIGN §16);
  // a teammate's unit (前往查看 in prep, 联防 / 最终攻势 fields, an observed battle) shows ITS owner's choice, carried by
  // the unit (UnitInfo skillIndex / moduleId: the sim's, or Match.prepFieldMeta's) — never the viewer's loadout
  const detailLoadout = (() => {
    if (!resolved || resolved.type !== 'chess') return null;
    if (detailTarget?.kind === 'unit') {
      const u = detailTarget.unit;
      const owner = u?.ownerId;
      if (resolved.piece || (owner != null && owner === myId)) return priv?.loadout ?? null;
      return unitLoadout(resolved.chess, u);
    }
    return priv?.loadout ?? null; // own pieces, shop / reward / bond-member cards
  })();
  // the open detail card's unit draws its attack range on the field (screens/game/range.js inspectRange, GitHub PR #281):
  // an own board piece in prep (its loadout / stand-in record, its facing); in battle or on a scouted board an ally
  // operator / summon on the field — the range it fights with now (the live stats' `range` and `dir`, the snapshot's
  // tile) — never an enemy, a dead unit or a bench unit (UnitInfo `area` hand / temp); drag, the wheel and the pen
  // draw their own
  const cardRange = !drag && !facing && !pen ? inspectRange({
    target: detailTarget, detail: resolved, pieces: placeCtx.pieces, showPrep, field,
    snapshot: snapUnitsRef.current.get(resolved?.unitId),
    live: typeof liveStats === 'function' ? liveStats() : liveStats,
    loadout: detailLoadout, getChess: gd.chess, backups: gd.backups,
  }) : null;
  const cardRangeKey = cardRange ? JSON.stringify(cardRange) : '';
  useEffect(() => {
    if (!view) return undefined;
    showRange(view, cardRange?.grid, cardRange?.row, cardRange?.col, cardRange?.dir, SEL_RANGE);
    return () => showRange(view, null, 0, 0, null, SEL_RANGE);
  }, [view, cardRangeKey, showPrep, field]);
  const labCells = prototypeLabCells(resonanceState, editable && showPrep && !pen);
  const labCellsKey = JSON.stringify(labCells);
  useEffect(() => {
    if (!view) return undefined;
    const style = { color: 0x57d9ad, fill: 0.13, line: 0.68, group: 'resonance-prototype-labs' };
    view.highlightTiles(labCells, style);
    return () => view.highlightTiles([], style);
  }, [view, labCellsKey]);
  // the card's bond chips — and the popup a chip opens: a battle / scouted unit's OWNER's bonds (yours, or that
  // teammate's — m.public + live layers), your own piece's yours, a popup member card the popup's player; shop / reward
  // cards read the strip's (ui/watchBonds.js detailBondOwner)
  const detailOwner = detailBondOwner(detailTarget, { pub, myId, stripOwnerId: strip.ownerId });
  const detailBonds = detailOwner === strip.ownerId ? stripBonds : playerBonds({ pub, priv, myId, ownerId: detailOwner, live: liveLayers });
  // bonds this mode never activates (标准: 10 of 23, 奥术 among them) — shown 本局禁用 on cards, chips and the popup
  const offBonds = modeOffBonds(getMode(pub?.modeId));
  const draggedSellValue = drag?.kind === 'chess' && editable && showPrep
    ? underframeActions(placeCtx, drag.uid)?.sell : null;

  return html`<div class=${cx('screen', 'gm', `gm--${mode}`, drag && 'is-dragging', collapsed && 'is-collapsed', (sp || hasPersonalChoice) && 'has-sp', pen && 'is-pen', readyWhy && 'has-readywhy', equipmentDropTarget != null && 'has-equipment-drop')}
      data-camera=${pen ? 'pen' : camKind} onDragOver=${equipmentDropOver} onDrop=${equipmentDrop} onDragLeave=${(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setEquipmentDropTarget(null); setSpecialDropTile(null); } }}>
    <div class="gm__field" ref=${hostRef} onContextMenu=${(e) => e.preventDefault()}></div>
    ${resonanceDockState && resonanceCatalog ? html`<${InventoryDock} className="rs-native-equipment-rail" state=${resonanceDockState} catalog=${resonanceCatalog}
      busy=${!editable} fieldTargetUid=${equipmentDropTarget ?? sel?.uid ?? null} onOpen=${() => toggleResonancePanel('equipment')}
      onDetail=${openNativeResonanceDetail} onCombine=${combineResonanceItems} />` : null}
    ${draggedSellValue != null && sellRect ? html`<div ref=${sellZoneRef} class="rs-native-sell-zone" aria-live="polite"
      style=${`left:${sellRect.left}px;top:${sellRect.top}px;width:${sellRect.width}px;height:${sellRect.height}px`}>
      <span>出售</span><${CoinGlyph} /><b>+${draggedSellValue}</b>
    </div>` : null}
    ${viewKind === 'loading' ? html`<div class="gm__loading"><${Spinner} label="LOADING FIELD" /></div>` : null}
    <div class="gm__vignette" aria-hidden="true"></div>
    ${tempNotice ? html`<${TempRowNotice} view=${view} count=${temp.count} items=${temp.items} label=${!drag && !facing}
      ready=${phase === PHASE.PREP && !!priv?.ready} />` : null}
    ${showPrep && view && viewKind !== 'loading' && priv && !pen ? html`<${StandInTags} view=${view} priv=${priv} getChess=${gd.chess} backups=${gd.backups} diyData=${{ chess: data.get('chess'), backups: data.get('backups') }} />` : null}

    <div class=${cx('gm__hud', (resolved || resonanceDetail || resonancePanel) && 'has-resonance-overlay')} ref=${hudElRef}>
      <${TopBar} pub=${pub} priv=${priv} conn=${conn} hud=${hud} total=${total} drawer=${resonancePanel === 'match-info' ? 'info' : drawer}
        infoTip="本局策略、操作说明与战斗结果"
        onExit=${() => setExitOpen(true)} onDrawer=${(t) => { if (t === 'info') { setDrawer(null); toggleResonancePanel('match-info'); } else setDrawer((d) => (d ? null : t)); }} onReady=${toggleReady}
        readyBusy=${readyBusy} readyCount=${readyCount} playerCount=${solo ? 1 : aliveCount}
        pen=${pen} penAvail=${penAvail} onPen=${togglePen} config=${gd.config} frozenAt=${frozenAt}
        pause=${canPause || paused ? { show: canPause, paused, busy: pauseBusy, onToggle: () => togglePause(!paused) } : null}
        battleControls=${combat && solo && resonanceState ? html`<${ResonanceCombatControls} facts=${pub?.resonanceCombat} done=${!!myDone} paused=${paused} />` : null}
        live=${liveLpNow} spectator=${spectator}
        spectators=${specFacts.list} myId=${myId} isHost=${specFacts.isHost} onRemoveSpectator=${removeSpectator} />

      <div class="gm__bonds">
        <header class="rs-native-pact-heading"><b>盟约</b><button type="button" class="rs-native-pact-open" aria-label="盟约与效果" onClick=${() => toggleResonancePanel('pacts')}><${Icon} name="book" /><span>查看全部</span></button></header>
        <button type="button" class="bonds-toggle" aria-expanded=${!bondsCollapsed} aria-controls="match-bond-strip"
          aria-label=${bondsCollapsed ? t('展开盟约') : t('收起盟约')} title=${bondsCollapsed ? t('展开盟约') : t('收起盟约')}
          onKeyDown=${(e) => {
            // Keep native Space activation here without also firing the global ready / pause shortcut.
            if (e.key === ' ') e.stopPropagation();
          }}
          onClick=${() => {
            if (!bondsCollapsed && bondOpen?.from === 'strip') setBondOpen(null);
            setBondsCollapsed(!bondsCollapsed);
          }}><${Icon} name=${bondsCollapsed ? 'chevronRight' : 'chevronLeft'} /></button>
        <div id="match-bond-strip" class="gm__bond-list" hidden=${bondsCollapsed}>
          <${BondStrip} bonds=${resonanceState ? Object.entries(resonanceState.pacts || {}).filter(([, pact]) => Number(pact.count) > 0).map(([bondId, pact]) => {
            const levels = resonanceCatalog?.pacts?.[bondId]?.levels || [];
            const { active, tier } = nativeStripTier(pact, levels);
            return { bondId, count: pact.count, active, tier, layers: undefined, thresholds: levels.map(level => Number(level.minUnits ?? level.threshold)).filter(Number.isFinite) };
          }) : stripBonds} layersDisabled=${layersDisabled} openId=${bondPop && bondPop.ownerId === strip.ownerId ? bondPop.bondId : null}
            owner=${strip.name} records=${resonanceCatalog ? Object.fromEntries(Object.entries(resonanceCatalog.pacts || {}).map(([id, pact]) => [id, { ...pact, noStack: true, thresholds: (pact.levels || []).map(level => Number(level.minUnits ?? level.threshold)).filter(Number.isFinite) }])) : null}
            iconFor=${id => pactIconUrl(resonanceCatalog, id)} iconMask=${true} onOpen=${id => { setBondOpen(null); openNativeResonanceDetail({ kind: 'pact', id }); }} />
        </div>
      </div>

      ${!solo ? html`<${TeamPanel} pub=${pub} myId=${myId} watching=${watchingNow} bubbles=${bubbles} onWatch=${watchPlayer} cap=${gd.config?.lpCapPerRound ?? 10} uniteLocal=${uniteLocal}
        self=${Number.isFinite(priv?.lp) ? { lp: priv.lp, pending: liveLpNow.pending, unite: liveLpNow.unite, left: liveLpNow.left } : null}
        observe=${cc ? { canObserve: (p) => observeTarget(p, pub, myId, { observing: watchingOther, ownDone: localDone }), observing: watchingOther, onBack: backHome } : null} />` : null}

      <div class="gm__effects"><${EffectsList} effects=${watchingOther && field ? (field.effects ?? null) : priv?.effects} /></div>

      ${watchingOther && !combat ? html`<div class="gm__watching" role="status">
        <${GIcon} name="eye" /><span>${tParts('正在查看 {name} 的阵地（只读）', { name: html`<b>${watchedName}</b>` })}</span>
        ${spectator ? null : html`<${Button} size="sm" variant="primary" icon="back" onClick=${() => watchPlayer({ playerId: myId })}>${t('返回自己')}<//>`}
      </div>` : null}

      ${showShop ? html`<${ShopBar} priv=${shopDisplayPriv} editable=${editable} collapsed=${collapsed} interaction=${myId === 'resonance' ? 'direct' : 'two-tap'} onCollapse=${setCollapsed}
        renderFunds=${resonanceState && resonanceCatalog ? html`<${NativeFunds} state=${resonanceState} catalog=${resonanceCatalog} onOpen=${() => toggleResonancePanel('income')} onCollapse=${() => setCollapsed(true)} />` : null}
        bondRenderer=${resonanceCatalog ? bond => { const id = typeof bond === 'string' ? bond : bond.id; return html`<${PactIcon} catalog=${resonanceCatalog} id=${id} size="sm" /><span>${resonanceCatalog.pacts?.[id]?.name || '盟约'}</span>`; } : null}
        refreshKey="D" freezeKey=${null} levelKey="F" hideItem=${myId === 'resonance'}
        renderLevel=${resonanceState && resonanceCatalog ? ({ reason, onTap }) => html`<${NativeLevelCard} state=${resonanceState} catalog=${resonanceCatalog} reason=${reason} onTap=${onTap} onOdds=${() => toggleResonancePanel('shopOdds')} />` : null}
        barRef=${barRef} offBonds=${offBonds}
        onBuy=${buy} onLevel=${() => actions.levelUp()} onRefresh=${() => actions.refresh()} onFreeze=${() => actions.freeze()}
        onDetail=${(id, kind, hint) => setDetail({ kind: kind === 'item' ? 'item' : 'chess', id, hint: hint || null, tap: ++cardTap.current })}
        onDetailClose=${() => setDetail((d) => (d?.kind === 'chess' || d?.kind === 'item' ? null : d))}
        onRefuse=${(reason) => { toast(reason, 'warn'); audio.sfx('error', { volume: 0.5 }); }}
        reward=${phase === PHASE.PREP && !rewardMin ? priv?.shop?.rewardOffer || null : null}
        onReward=${(i) => actions.reward(i)} onRewardLater=${() => setRewardMin(true)} onArm=${setArmedCard} />` : null}

      ${phase === PHASE.PREP && priv?.shop?.rewardOffer ? html`<${RewardOverlay} priv=${priv} minimized=${rewardMin || collapsed}
        onMinimize=${(m) => { setRewardMin(m); if (!m) setCollapsed(false); }} />` : null}

      ${combat || mode === 'settle' ? html`<${CombatHud} pub=${pub} myId=${myId} watching=${watchingNow} hud=${hud} myDone=${!!myDone && alive}
        spectating=${!alive} spectator=${spectator} onWatch=${watchField}
        client=${cc ? { progress, observing: observingName ? { name: observingName } : null, onBack: alive ? backHome : null, layers, layer, onLayer: setLayer } : null} />` : null}

      ${showDeadPill(alive, phase) ? (spectator
        ? html`<div class="gm__dead gm__dead--spectator" role="status"><${GIcon} name="eye" />${t('观战中 · 点击左侧成员头像切换查看')}</div>`
        : html`<div class="gm__dead" role="status"><${Icon} name="close" />${t('你已被淘汰 · 可继续观战队友')}</div>`) : null}

      <${Ticker} />

      <div class="gm__corner">
        <button type="button" class="gm__gear gm__guide rs-native-codex-button" aria-label="战术图鉴" title="战术图鉴" onClick=${() => openCodex()}><${GIcon} name="book" /></button>
        <button type="button" class="gm__gear" aria-label=${t('设置')} title=${t('设置')} onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /></button>
        <a class="gm__gear rs-fullscreen rs-fullscreen-small" aria-label="全屏打开" title="全屏打开" href=${location.href} target="_blank" rel="noopener"><${Icon} name="expand" /></a>
      </div>

      ${drawer ? html`<${EnemyDrawer} tab=${drawer} onTab=${setDrawer} pub=${pub} priv=${priv} onClose=${() => setDrawer(null)}
        bandId=${scoutBandId} bandOwner=${scoutBandOwner}
        onEnemy=${(k, n) => setDetail({ kind: 'enemy', id: k, count: n })} onChess=${(id) => setDetail({ kind: 'chess', id, foreign: true })} />` : null}

      ${resonanceState && resonanceCatalog && resonancePanel ? html`<aside class=${`dpanel dpanel--right rs-native-resonance-panel rs-native-resonance-panel--${resonancePanel}`} style=${resonancePanelBottom == null ? undefined : { bottom: `${resonancePanelBottom}px` }} role="dialog" aria-label=${({pacts:'本局盟约',income:'金币与收入',settlement:'本场结算',equipment:'装备库存','match-info':'本局信息',shopOdds:'等级与招募概率'})[resonancePanel]}>
        <header class="rs-native-resonance-panel__head"><b>${({pacts:'本局盟约',income:'金币与收入',settlement:'本场结算',equipment:'装备库存','match-info':'本局信息',shopOdds:'等级与招募概率'})[resonancePanel]}</b><button type="button" aria-label="关闭面板" onClick=${() => setResonancePanel(null)}><${Icon} name="close" /></button></header>
        <div class="rs-native-resonance-panel__body">
          ${resonancePanel === 'shopOdds' ? html`<${NativeShopOdds} state=${resonanceState} catalog=${resonanceCatalog} />` : null}
          ${resonancePanel === 'pacts' ? html`<${NativePactMatrix} state=${resonanceState} catalog=${resonanceCatalog} onDetail=${openNativeResonanceDetail} />` : null}
          ${resonancePanel === 'income' ? html`<${IncomePanel} state=${resonanceState} catalog=${resonanceCatalog} />` : null}
          ${resonancePanel === 'match-info' ? html`<${NativeMatchInfo} state=${resonanceState} catalog=${resonanceCatalog} onDetail=${openNativeResonanceDetail} onSettlement=${() => toggleResonancePanel('settlement')} showHelp=${resonanceHelp} />` : null}
          ${resonancePanel === 'settlement' ? html`<${RoundSettlementPanel} summary=${lastSettlement} state=${resonanceState} catalog=${resonanceCatalog} showReplay=${false} onDetail=${target => setResonanceDetail(target)} />` : null}
          ${resonancePanel === 'equipment' && resonanceDockState ? html`<${NativeSpecialEntityList} state=${resonanceState} catalog=${resonanceCatalog} editable=${editable} busy=${resonanceActionBusy} onRecall=${uid => actions.move(uid, { area: 'hand' })} />
            <div class="rs-native-equipment-help"><p>拖动组件可在库存中合成，或装备到干员身上。</p><${Button} size="sm" variant="ghost" icon="book" onClick=${() => openCodex('recipes')}>合成配方<//></div>
            <${NativeResonanceInventoryActions} state=${resonanceState} catalog=${resonanceCatalog} editable=${editable} busy=${resonanceActionBusy} onAction=${submitResonanceAction} />
            <${InventoryDock} state=${resonanceDockState} catalog=${resonanceCatalog} busy=${!editable} fieldTargetUid=${equipmentDropTarget ?? sel?.uid ?? null}
            className="rs-equipment-dock--panel" onOpen=${() => {}} onDetail=${openNativeResonanceDetail} onCombine=${combineResonanceItems} />` : null}
        </div>
      </aside>` : null}

      ${bondPop ? html`<${BondPopup} bondId=${bondPop.bondId} entry=${bondPop.entry} priv=${bondPop.priv} banned=${pub?.bannedChess || []} owner=${bondPop.name}
        off=${offBonds.has(bondPop.bondId)}
        place=${bpPlace} over=${!!resolved && bpPlace === dSide}
        onClose=${() => setBondOpen(null)} onMember=${(id, items, standInFor, diy) => setDetail({ kind: 'chess', id, owner: bondPop.ownerId, items: items || null, standInFor: standInFor || null, diy: diy || null })} />` : null}

      ${resolved ? html`<${DetailPanel} detail=${resolved} snapHp=${snapHp} onClose=${() => { setDetail(null); setSel(null); }}
        bonds=${detailBonds} offBonds=${offBonds} loadout=${detailLoadout} ops=${priv?.ops ?? null} side=${dSide} shopOpen=${shopOpen} live=${liveStats} voice=${true}
        equipSlots=${resonanceState ? RESONANCE_EQUIP_SLOTS : 2} onBond=${(id) => openBond(id, detailOwner, 'detail')} />` : null}
      ${resonanceDetail && resonanceCatalog ? html`<${ResonanceDetailPanel} detail=${resonanceDetail} catalog=${resonanceCatalog} state=${resonanceState}
        onDetail=${target => setResonanceDetail(target)} onAction=${submitResonanceAction} busy=${!editable || resonanceActionBusy} readOnly=${!editable}
        safeBottom=${resonanceDetailBottom}
        onClose=${() => setResonanceDetail(null)} />` : null}

      ${selEntry && editable && !facing && !drag && showPrep ? html`<${Underframe} key=${sel.uid} view=${view} uid=${sel.uid}
        row=${pieceTile(selEntry)?.row} col=${pieceTile(selEntry)?.col} actions=${underframeActions(placeCtx, sel.uid)} busy=${selBusy}
        name=${(selEntry.piece.kind === 'item' ? gd.item(selEntry.piece.id) : selEntry.piece.kind === 'token' ? gd.token(selEntry.piece.id) : ownShown(selEntry.piece.id))?.name || ''}
        onRetreat=${retreatSel} onSell=${sellSel} onDestroy=${sellSel} />` : null}
    </div>

    ${sp ? html`<${ChoiceOverlay} pub=${pub} sp=${sp} myId=${myId} solo=${solo} busyIdx=${spBusy} total=${total}
      onPick=${async (i) => { setSpBusy(i); await actions.choice(i); setSpBusy(null); }} />` : null}
    ${personalChoice ? html`<${ChoiceOverlay} key=${personalChoice.id} pub=${pub} sp=${personalChoice} myId=${myId} solo=${solo} personal=${true}
      busyIdx=${personalBusy?.choiceId === personalChoice.id ? personalBusy.idx : null} total=${total}
      onPick=${async (i) => {
        const choiceId = personalChoice.id;
        setPersonalBusy({ choiceId, idx: i });
        await actions.choice(i, choiceId);
        setPersonalBusy((b) => b?.choiceId === choiceId ? null : b);
      }} />` : null}

    ${resonanceState?.phase === 'choice' && resonanceState.pendingChoices?.length ? html`<${ResonanceChoiceOverlay} state=${resonanceState} catalog=${resonanceCatalog} busy=${resonanceChoiceBusy} onAction=${submitResonanceChoice} />` : null}

    ${banner ? html`<${PhaseBanner} key=${banner.key} mode="overlay" title=${banner.title} sub=${banner.sub} micro=${banner.micro}
      tone=${banner.tone} duration=${banner.duration || 1500} onDone=${() => setBanner(null)} />` : null}

    ${resultBox ? html`<${ResultDialog} key=${resultBox.key} title=${resultBox.title} sub=${resultBox.sub} micro=${resultBox.micro}
      tone=${resultBox.tone} duration=${resultBox.duration} onDone=${() => setResultBox(null)} />` : null}

    ${facing && view ? html`<${FacingWheel} key=${`${facing.uid}:${facing.row},${facing.col}`} view=${view} row=${facing.row} col=${facing.col}
      grid=${facing.grid} name=${facing.name} onPreview=${previewFacing} onCommit=${commitFacing} onCancel=${cancelFacing} />` : null}

    ${paused ? html`<${PausedOverlay} canResume=${solo} busy=${pauseBusy} onResume=${() => togglePause(false)} onExit=${() => setExitOpen(true)} />` : null}

    ${replace ? html`<${EquipReplaceDialog} request=${replace.request} getItem=${gd.item}
      onConfirm=${(uid) => closeReplace(uid)} onCancel=${() => closeReplace(null)} />` : null}

    <${SettingsModal} open=${settingsOpen} onClose=${() => setSettingsOpen(false)}
      guideLabel="操作说明" onGuide=${() => { setSettingsOpen(false); toggleResonancePanel('match-info'); setResonanceHelp(true); }}
      helpText=${RESONANCE_SHORTCUT_LABEL} />
    <${ResonanceExitModal} open=${exitOpen} onClose=${() => setExitOpen(false)} onLeave=${onLeave} />
    ${codexOpen && resonanceCatalog ? html`<section class="rs-native-codex-overlay" role="dialog" aria-modal="true" aria-label="战术图鉴">
      <${CodexScreen} catalog=${libraryCatalog || resonanceCatalog} activeIds=${activeIds || libraryCatalog?.activeOperatorIds || resonanceCatalog.config?.activeOperatorIds || []}
        initialTab=${codexTab}
        onBack=${closeCodex} onDetail=${setCodexDetail}
        overlayDetail=${codexDetail ? html`<${ResonanceDetailPanel} detail=${codexDetail} catalog=${libraryCatalog || resonanceCatalog} state=${resonanceState}
          readOnly=${true} busy=${true} onDetail=${setCodexDetail} onClose=${() => setCodexDetail(null)} />` : null} />
    </section>` : null}
  </div>`;
}
