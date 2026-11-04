// Assault adapts the native Alliance UI. Game rules remain in shared/assault.
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, Spinner, Icon, TierChip, UiHosts, setTierLook, Countdown, BattleSpeedBar } from '../ui/components.js';
import { data } from '../data.js';
import { GAME_FILES, GIcon, Sprite, RichText, UnitThumb, Img } from '../ui/gameComponents.js';
import { TopBar, PauseButton } from '../ui/hud.js';
import { ShopBar, PriceHex } from '../ui/shopBar.js';
import { ChoiceOverlay } from '../ui/choiceOverlay.js';
import { DetailPanel, Section, chessStatsBlock } from '../ui/detailPanel.js';
import { skillRecordIconUrl } from '../ui/assetUrls.js';
import { TeamPanel } from '../ui/teamPanel.js';
import { CombatHud } from '../ui/combatHud.js';
import { EffectsList } from '../ui/effectsList.js';
import { SettingsModal, settingsStore } from '../ui/settings.js';
import { shortcutFor } from '../ui/gameLogic.js';
import { ToastHost, toast } from '../ui/toasts.js';
import { TitleScreen } from '../screens/title.js';
import { ResultView } from '../screens/result.js';
import { ModuleGlyph } from '../screens/loadout.js';
import { GuideHost, openGuide } from '../ui/guide.js';
import { StatsHost, StatCard, Section as StatsSection, openStats } from '../screens/stats.js';
import { recordResult } from '../ui/stats.js';
import { EmoteWheel } from '../ui/emotes.js';
import { Ticker } from '../ui/ticker.js';
import { store } from '../store.js';
import { NativeAssaultField } from './field.js';
import { runBattleFrame } from './client-sim.js';
import { makeChessRecords } from '../../../shared/assault/battle-input.js';
import { unitStatsEntry } from '../../../shared/protocol.js';
import { activePieceLimit } from '../../../shared/assault/inventory.js';
import { calculateSellPrice } from '../../../shared/assault/shops.js';
import { abilityBonuses } from '../../../shared/assault/temporary-abilities.js';
import { absoluteRunHour } from '../../../shared/assault/temporary-enhancements.js';
import { skillRewardRank, operatorUpgradeProjection } from '../../../shared/assault/upgrades.js';
import { audio, bgmKeyFor, combatTrackFor, resultSpeaker, resultVoiceSlot } from '../audio.js';
import { FullscreenButton } from '../ui/device.js';
import { copyText } from '../ui/clipboard.js';
import { t, N_ } from '../../../shared/i18n.js';
import { eventBackground, relicIcon, RecruitFilterVisual, recruitFilterLabel, targetCharId, ValueChip, EventActionVisual, ShopVisual, EncounterVisual } from './choiceVisuals.js';
import { operatorMechanics, currentStarText, strategySkillText, projectCollectionSkills, bazaarCard, keywordSegments, moduleCardText } from './mechanicsView.js';
import {
  PHASES, activePopulation, assaultAssets, avatarFor, portraitFor, pieceRecord, displayName,
  encounterById, displayEncounterTitle, battlePrepStatus, formChoices, advancedModules,
  relicById, professionLabel, hrefForRun, summonTemplateOptions, attackRangeOf,
  growthView, statLabel, growthAmountText, deployCapacity,
} from './model.js';

const ME = 'assault-player';
const STAT_ICONS = { atk: 'sword', def: 'shield', hp: 'target', aspd: 'hourglass' };
const SKILL_ART={strategy_arms:'char_308_swire',strategy_catalytic:'char_128_plosis',strategy_backroom:'char_181_flower',
  strategy_merchant:'char_151_myrtle',strategy_augmented:'char_491_humus',strategy_supply:'char_1033_swire2',
  strategy_waters:'char_103_angel',strategy_defender:'char_136_hsguma',strategy_frozen:'char_206_gnosis',strategy_burn:'char_350_surtr'};
const TRIGGER_ART={cast:'char_002_amiya',redeploy:'char_237_gravel',reload:'char_103_angel',summon:'char_2023_ling',
  frozen:'char_206_gnosis',stun:'char_102_texas',block:'char_136_hsguma',kill:'char_4064_mlynar'};
const TRIGGER_RELIC_ART={reload:'ammo-thousandforms',summon:'summon-derivative',frozen:'cold-frozenhusk',kill:'cold-triumphhorn'};
const PAYOFF_GLYPHS={charge:'bolt',redeploy:'refresh',growth:'sword',heal:'plus',shield:'shield',ammo:'target'};
function upgradeIcon(item, tier = 1) {
  const icon = item?.icon || {};
  const linked=item?.id?.startsWith('strategy_link_')?item.id.split('_'):null;
  const charId=SKILL_ART[item?.id]||(linked?TRIGGER_ART[linked[2]]:null);
  const sourceSkill=charId?(data.get('chess')?.[charId]?.skill||{skillId:`skchr_${charId.split('_').slice(2).join('_')}_1`}):null;
  const borrowed=linked?data.get('assets')?.assaultCollectibles?.[TRIGGER_RELIC_ART[linked[2]]]?.icon:null;
  const borrowedUrl=typeof borrowed==='string'?borrowed:borrowed?.url;
  if(charId) return html`<span class="assault-upgrade-art"><${Img} src=${borrowedUrl||skillRecordIconUrl(data.get('assets'),sourceSkill,{empty:false})}
    alt="" fallback=${html`<${GIcon} name=${linked?PAYOFF_GLYPHS[linked[3]]:'bolt'} />`} />
    ${linked?html`<span class="assault-upgrade-art__badge"><${GIcon} name=${PAYOFF_GLYPHS[linked[3]]} /></span>`:null}</span>`;
  if (icon.kind === 'sprite') return html`<${Sprite} k=${icon.name} fallback=${html`<${GIcon} name="bolt" />`} />`;
  if (icon.kind === 'unit') return html`<${UnitThumb} id=${icon.charId || icon.name} tier=${tier} size="sm" />`;
  if (icon.kind === 'ui') return html`<${Icon} name=${icon.name === 'bag' ? 'book' : icon.name || 'bolt'} />`;
  if (icon.kind === 'stat' && icon.name === 'hp') return html`<${GIcon} name="target" />`;
  if (icon.kind === 'stat') return html`<${Icon} name=${STAT_ICONS[icon.name] || 'bolt'} />`;
  if (icon.kind === 'glyph' || icon.kind === 'GIcon') return html`<${GIcon} name=${icon.name || 'bolt'} />`;
  return html`<${GIcon} name="bolt" />`;
}

// Paced waves list one spawn per enemy; the intel drawer shows one line per enemy type.
function enemyIntelRows(spawns) {
  const rows = new Map();
  for (const s of spawns) {
    const key = s.enemyKey || s.key || s.bossId;
    const row = rows.get(key) ?? { s, count: 0 };
    row.count += s.count || 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}

const guidePresentation = {
  title: t('进击玩法说明'), micro: 'HOW TO PLAY // ASSAULT',
  chapters: [{id:'route',name:t('路线'),micro:'ROUTE'},{id:'team',name:t('队伍'),micro:'TEAM'},{id:'combat',name:t('作战'),micro:'COMBAT'}],
  pages: [
    {chapter:'route',title:t('选择路线'),content:html`<div class="guide__tips"><ol><li>${t('选择领袖获得起始队伍，再从当前时段的补给、事件或作战中选择下一站。')}</li><li>${t('事件会展示成本与可能结果；需要指定干员时，先选目标再确认。')}</li><li>${t('作战结束后获得奖励，收藏品持续影响这一局的构筑。')}</li></ol></div>`},
    {chapter:'team',title:t('招募与整备'),content:html`<div class="guide__tips"><ol><li>${t('在补给中点击干员卡查看，再次点击购买。价格、星级和持有份数显示在卡面上。')}</li><li>${t('拖动干员到合法部署格，再选择朝向。点击已部署干员可撤退或出售。')}</li><li>${t('详情展示当前属性、固定技能、天赋和模组；支持切换的身体形态与召唤预设也在这里调整。')}</li></ol></div>`},
    {chapter:'combat',title:t('开始作战'),content:html`<div class="guide__tips"><ol><li>${t('整备完成后开始战斗。战斗采用自动部署与释放技能，当前队伍的部署位置和朝向会影响作战。')}</li><li>${t('战斗中可暂停与调整播放速度；顶部展示敌人进度和领袖生命。')}</li><li>${t('可随时在本局信息中导出存档。统计与存档分别记录，进击记录独立保存。')}</li></ol></div>`},
  ],
};

function resultOf(state,catalog) {
  const battles=state.history.filter(h=>h.kind==='battleSettled');
  return {victory:state.completed===true,seed:state.seed,modeId:`assault:${state.runId}`,
    roundsPassed:battles.filter(b=>b.victory).length,lastRound:battles.length,
    players:[{...playerOf(state,catalog),bandId:state.directorId,victory:state.completed===true&&state.life>0,
      roundsPassed:battles.filter(b=>b.victory).length,
      lineup:state.pieces.map(p=>({id:p.charId,kind:'chess',tier:p.star,golden:p.star>=4})),
      stats:{perfectRounds:battles.filter(b=>b.victory&&b.leakedLife===0).length,lpLost:Math.max(0,state.maxLife-state.life)}}]};
}

function BattleLedger({state,catalog}) {
  const battles=(state?.history??[]).filter(h=>h.kind==='battleSettled'&&Array.isArray(h.ledger?.operators));
  const [selected,setSelected]=useState(null);
  const battle=battles.find(b=>`${b.day}:${b.hour}`===selected)??battles.at(-1);
  const number=value=>Number.isFinite(value)?Math.round(value*10)/10:0;
  return html`<${StatsSection} title=${t('本场账本')} micro="BATTLE LEDGER">
    ${battle?html`<label class="assault-ledger-select">${t('选择作战')} <select aria-label=${t('选择作战')}
      value=${`${battle.day}:${battle.hour}`} onChange=${e=>setSelected(e.currentTarget.value)}>
      ${battles.map(b=>html`<option value=${`${b.day}:${b.hour}`}>${t('第{day}天 · {hour}时',{day:b.day,hour:b.hour})} · ${displayEncounterTitle(encounterById(catalog,b.encounterId)?.name??'')}</option>`)}
    </select></label>${battle.ledger.growth?.length?html`<div class="assault-ledger-growth">${battle.ledger.growth.map(row=>html`<p data-growth-operator=${row.uid}>
      ${displayName(catalog,row.charId)} · ${row.stat==='openingBarrier'?t('开场屏障'):row.stat==='shieldHeal'?t('破盾治疗'):t('攻击')} · ${t('本局已成长')} <b class="num">+${row.before}% → +${row.after}%</b>
    </p>`)}</div>`:null}<div class="st-tablewrap"><table class="st-table assault-ledger">
      <thead><tr>${[N_('干员'),N_('施放次数'),N_('伤害'),N_('治疗'),N_('屏障 / 护盾'),N_('充能 / 加速'),N_('扳机次数'),N_('存活时间')].map(label=>html`<th>${t(label)}</th>`)}</tr></thead>
      <tbody>${battle.ledger.operators.map(row=>html`<tr data-operator=${row.uid}>
        <td><span class="st-band"><${UnitThumb} id=${row.charId} size="xs" />${displayName(catalog,row.charId)||row.name}</span></td>
        <td class=${`num${row.casts===0?' is-zero':''}`}>${number(row.casts)}</td>
        <td class="num">${number(row.damage)}</td><td class="num">${number(row.healing)}</td>
        <td class="num">${number(row.shieldHp)} / ${t('{n}层',{n:number(row.shieldLayers)})}</td>
        <td class="num">${number(row.chargeGiven)} / ${t('{n}秒',{n:number(row.hasteSeconds)})}</td>
        <td class=${`num${row.triggers===0?' is-zero':''}`}>${number(row.triggers)}</td>
        <td class="num">${t('{n}秒',{n:number(row.aliveSeconds)})}</td>
      </tr>`)}</tbody></table></div>`:html`<p class="st-empty">${t('暂无')}</p>`}
  <//>`;
}

function statsPresentation(catalog,state) {
  return {tabs:{bands:t('领袖')},
    extraTabs:[{id:'assault-ledger',name:t('本场账本'),micro:'BATTLE LEDGER',render:()=>html`<${BattleLedger} key=${state?.runId} state=${state} catalog=${catalog} />`}],
    bands:{records:catalog.design.system.directors.map(d=>({bandId:d.id,name:d.name,icon:portraitFor(catalog,d.leaderCharId)})),title:t('领袖')},
    columns:{strategy:t('领袖')},modeName:()=>t('进击'),
    result:{headline:undefined,playersLabel:t('进击队伍'),reportMicro:'ASSAULT REPORT'},
    overview:agg=>html`<${StatsSection} title=${t('总览')} micro="OVERVIEW"><div class="st-cards">
      <${StatCard} label=${t('总局数')} micro="GAMES" value=${agg.count} />
      <${StatCard} label=${t('完成进击')} micro="WINS" value=${agg.wins} tone="mint" />
      <${StatCard} label=${t('胜率')} micro="WIN RATE" value=${agg.count?`${Math.round(100*agg.wins/agg.count)}%`:'—'} tone="gold" />
      <${StatCard} label=${t('最远作战')} micro="BEST ROUND" value=${agg.rounds.max} />
    </div><//>`};
}

export function presentationRecord(catalog, piece, session = null, state = null) {
  const raw = session?.built?.data?.chess?.[`assault:${piece.uid}`]
    || makeChessRecords(catalog.runtime, [piece], state?.enhancements || [], state?.teamGrowth || {}, state).chess[`assault:${piece.uid}`];
  const body = pieceRecord(catalog, piece);
  const publicText = catalog.publicText?.operators?.[piece.charId];
  return { ...raw, chessId: piece.charId, tier: piece.star, isGolden: piece.star >= 4,
    subProfessionName: body.simChess?.subProfessionName || raw.subProfessionName || catalog.nativeData?.chess?.[piece.charId]?.subProfessionName || professionLabel(body.profession),
    sellPrice: calculateSellPrice({ ...piece, purchaseCharId: piece.purchaseCharId || piece.charId, sourceCopies: piece.sourceCopies || 1 },
      { catalog: catalog.runtime, design: catalog.design }, state),
    bonds: [], garrisonIds: [],
    assets: { ...raw.assets, avatar: piece.charId, portrait: piece.charId, spine: piece.charId },
    skill: raw.skill ? { ...raw.skill, name: publicText?.skill?.name || raw.skill.name,
      desc: publicText?.skill?.description || raw.skill.description } : null,
  };
}

export function seedNativeUi(catalog) {
  if (!catalog?.runtime) return;
  for (const name of GAME_FILES) if (catalog.nativeData?.[name]) data.setData(name, catalog.nativeData[name]);
  const chess = { ...catalog.nativeData.chess };
  for (const body of Object.values(catalog.runtime.bodies)) {
    const piece = { uid: `preview:${body.charId}`, charId: body.charId, purchaseCharId: body.purchaseCharId,
      star: 1, sourceCopies: 1, row: null, col: null, dir: 'E' };
    chess[body.charId] = presentationRecord(catalog, piece);
  }
  data.setData('chess', chess);
  const manifest=assaultAssets(catalog.assets,catalog.nativeData.assets);
  manifest.assaultCollectibles=(catalog.assets?.assets||catalog.assets)?.collectibles||{};
  manifest.bands={...manifest.bands};
  const leaders=catalog.design.system.directors;
  for(const leader of leaders)manifest.bands[leader.id]=avatarFor(catalog,leader.leaderCharId);
  data.setData('bands',Object.fromEntries(leaders.map(d=>[d.id,{bandId:d.id,name:d.name}])));
  data.setData('assets',manifest);
  setTierLook('stars');
}

function playerOf(state, catalog) {
  let name=t('博士');try{name=localStorage.getItem('assault:doctorName')||name;}catch{}
  return { playerId: ME, seat: 0, name, bandId:state?.directorId, lp: state?.life,
    alive: state?.life > 0, status: state?.phase === 'battle' ? 'combat' : 'acting', fieldId: 'assault' };
}
function publicOf(state, catalog) {
  return { phase: state?.phase === 'battle' ? (state.board?.kind === 'boss' || state.board?.field === 'bossL' ? 'FINAL_ASSAULT' : 'COMBAT') : 'PREP', round: state?.day,
    bossId:encounterById(catalog,state?.currentNode?.encounterId)?.wave?.bossId,
    lastRound: catalog.design.system.run.days ?? 10, players: [playerOf(state, catalog)], deadline: null };
}
function choiceOf(name, desc, cards) {
  return { name, desc, family: 'assault', untimed: true, order: [ME], turnPid: ME,
    pickOf: new Map(), cards: cards.map((c, idx) => ({ ...c, idx })) };
}
// Every pick-one screen: the title is a noun, the cards carry the icon, the name and the whole effect text (no details strip
// under them, no sentences around them), `extra` holds the buttons beside the cards.
function Choice({ name, cards, onPick, busy = false, extra = null, backdrop = null }) {
  return html`<${ChoiceOverlay} key=${name} pub=${{ players: [] }} sp=${choiceOf(name, '', cards)}
    myId=${ME} solo=${true} busyIdx=${busy ? 0 : null} onPick=${onPick}
    presentation=${{ title: name, micro: t('进击'), visualMode: true, quiet: true, backdrop,
      cardExtra: card => card.visual, extra }} />`;
}

function NativeStart({ catalog, onStart, onImport, busy, resumeRunId, onResume }) {
  const [choosing, setChoosing] = useState(false);
  const directors = catalog.design.system.directors;
  return html`<${TitleScreen} experience=${{
    modeTitle: t('进击'), englishTitle: 'ASSAULT',
    tagline: t('招募干员，选择补给与事件，构筑队伍并抵御进攻。'),
    connection: html`<span class="status-dot is-on"></span><span>${t('进击模式')}</span>`, start: name => {
      if(busy)return;
      try{localStorage.setItem('assault:doctorName',name);}catch{}setChoosing(true);
    },
    resume: resumeRunId ? html`<${Button} size="sm" disabled=${busy} onClick=${onResume}>${t('继续')}<//>` : null,
    secondary: html`<${Button} block=${true} onClick=${onImport}>${t('导入存档')}<//><a class="btn btn--ghost btn--sm" href=${location.pathname.startsWith('/stronghold/') ? '/stronghold/' : './'}>${t('返回')}</a>${isEmbeddedView() ? html`<a class="btn btn--ghost btn--sm" href="./assault.html?new=1" target="_blank" rel="noopener">${t('全屏打开')}</a>` : null}`,
  }} />${choosing ? html`<${Choice} name=${t('领袖')} busy=${busy}
    extra=${html`<${Button} variant="ghost" disabled=${busy} onClick=${()=>setChoosing(false)}>${t('返回')}<//>`}
    cards=${directors.map(d => ({ name: d.name, icon: portraitFor(catalog, d.leaderCharId),
      desc: `${d.themeFactionName}\n${d.description || d.identityRule || ''}`,
      visual: html`<span class="assault-choice-visual assault-choice-visual--leader"><${Img} src=${portraitFor(catalog, d.leaderCharId)}
        alt=${d.name} class="assault-leader-image" /><span class="assault-object-group">${d.startTeam.map(id => html`<${UnitThumb} id=${id} tier=${1} size="sm" />`)}</span></span>` }))}
    onPick=${i => onStart(directors[i].id)} />` : null}`;
}

function Nodes({ state, catalog, onAction, busy }) {
  const nodes = state.nodes || [];
  const reroll = state.nodeReroll ?? { cost: 2, maxPerHour: 1, count: state.nodeRerollCount ?? 0 };
  const rewardNames={gold:t('整备资金'),xp:t('作战心得'),hp:t('医疗补给')};
  return html`<${Choice} name=${t('路线')}
    extra=${html`<${Button} disabled=${busy || reroll.count >= reroll.maxPerHour || state.gold < reroll.cost}
      title=${`${Math.max(0,reroll.maxPerHour-reroll.count)}/${reroll.maxPerHour}`}
      onClick=${()=>onAction('rerollNodes')}><${GIcon} name="refresh" />${t('重抽')}<${ValueChip} kind="gold" value=${reroll.cost} /><//>`}
    busy=${busy} cards=${nodes.map(node => {
      const encounter = encounterById(catalog, node.encounterId);
      return { name: node.kind==='reward'?rewardNames[node.reward.kind]:displayEncounterTitle(node.name), kind: node.kind === 'battle' ? 'bounty' : 'tactic',
        visual: node.kind === 'battle' ? html`<${EncounterVisual} encounter=${encounter} catalog=${catalog} />`
          : node.kind === 'event' ? html`<span class="assault-choice-visual"><${Img} src=${eventBackground(catalog,node.eventId)} alt=${node.name} class="assault-scene-image" /></span>`
          : node.kind === 'reward' ? html`<span class="assault-choice-visual assault-choice-visual--reward">${upgradeIcon({id:node.reward.kind==='gold'?'strategy_supply':node.reward.kind==='xp'?'strategy_frozen':'strategy_backroom'})}<${ValueChip} kind=${node.reward.kind} value=${`+${node.reward.amount}`} /></span>`
          : html`<${ShopVisual} node=${node} catalog=${catalog} />`,
        desc: '' };
    })} onPick=${i => onAction('selectNode', { nodeId: nodes[i].id })} />`;
}

function Technology({ state, catalog }) {
  const thresholds = catalog.design.system.run.xpThresholds;
  const level = Math.max(1, thresholds.filter(n => state.xp >= n).length);
  const next = thresholds[level];
  const floor = thresholds[level - 1] ?? 0;
  const span = next == null ? 1 : next - floor;
  const progress = next == null ? 1 : Math.min(1, Math.max(0, (state.xp-floor)/span));
  return html`<div class="lvcard">
    <span class="lvcard__frame"><span class="lvcard__micro">${t('科技')}</span><b class="lvcard__num num">${level}</b></span>
    <span class="lvcard__label num">${next == null ? t('已满级') : `${state.xp-floor}/${span}`}</span>
    <span class="lvcard__key">${t('经验')}</span><span class="assault-xp-track" role="progressbar" aria-label=${t('等级经验')}
      aria-valuenow=${next == null ? 1 : state.xp-floor} aria-valuemin="0" aria-valuemax=${span}><i style=${{width:`${progress*100}%`}} /></span></div>`;
}

function GrowthStatus({state,catalog}) {
  const previous = useRef({runId:state.runId,tech:state.tech});
  useEffect(()=>{
    const old=previous.current;
    previous.current={runId:state.runId,tech:state.tech};
    if(old.runId===state.runId&&state.tech>old.tech)toast(t('升级至 {level} 级',{level:state.tech}),'success');
  },[state.runId,state.tech]);
  return html`<div class="assault-growth" data-component-link="experience"><${Technology} state=${state} catalog=${catalog} /></div>`;
}


/** @param {{ self?: unknown, top?: unknown } | undefined} [surface] */
export function isEmbeddedView(surface = globalThis.window) {
  return !!surface && surface.self !== surface.top;
}

/**
 * Deployed / deployment cap for the battle-prep and battle screens: the native shop bar's 「场上干员」 pill
 * (.shopbar__remain, the same markup and class as the shop's readout, right-aligned in the bottom-right corner), with the
 * same population rule as the shop and the info drawer.
 */
function DeployCount({ state, catalog }) {
  const { used, cap } = deployCapacity(state, catalog);
  return html`<div class="shopbar assault-cap" data-testid="deploy-cap"><div class="shopbar__tools">
    <span class="shopbar__remain">${t('场上干员：')}<b class=${`num${used >= cap ? ' t-orange' : ''}`}>${used}</b>/<span class="num">${cap}</span></span>
  </div></div>`;
}

/**
 * The collection column (native .gm__effects: the owned collectibles as icons down the right edge, "+N" opening the
 * collection drawer for the rest). During the battle the native cost box (.dpbox) sits on the same edge, mid-height, so
 * the column only shows the icons that fit between its top and the cost box; the others are behind the "+N".
 */
const EFFECT_ICONS = 10;
function CollectionEffects({ skills, renderIcon, battle, onEffect, onMore }) {
  const [fit, setFit] = useState(EFFECT_ICONS);
  const column = useRef(null);
  useLayoutEffect(() => {
    // geometry in rem as the stylesheet has it (css/screens/game.css): label .21, icon .5, row gap .08, "+N" button .36
    const measure = () => {
      const host = column.current;
      if (!battle || !host) { setFit(EFFECT_ICONS); return; }
      const rem = parseFloat(getComputedStyle(host.ownerDocument.documentElement).fontSize) || 16;
      const hud = host.parentElement.getBoundingClientRect();
      const cost = host.ownerDocument.querySelector('.dpbox')?.getBoundingClientRect();
      const costTop = cost ? cost.top : hud.top + hud.height / 2 - .5 * rem;
      const room = costTop - .1 * rem - (host.getBoundingClientRect().top + .21 * rem);
      const rows = space => Math.floor((space + .08 * rem) / (.58 * rem));
      setFit(Math.max(0, Math.min(EFFECT_ICONS, rows(room) >= skills.length ? skills.length : rows(room - .44 * rem))));
    };
    measure();
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    watcher?.observe(column.current.parentElement);
    return () => watcher?.disconnect();
  }, [battle, skills.length]);
  const shown = Math.min(fit, EFFECT_ICONS, skills.length);
  return html`<div class="gm__effects" ref=${column}><${EffectsList} effects=${skills.slice(0, shown)} renderIcon=${renderIcon} onEffect=${onEffect} />
    ${skills.length > shown ? html`<${Button} size="sm" onClick=${onMore}>+${skills.length - shown}<//>` : null}</div>`;
}

function NativeShop({ state, catalog, onAction, onOpen, onClose, busy, collapsed, onCollapse, inventoryOpen = false, onInventoryClose = () => {} }) {
  const [offer, setOffer] = useState(null);
  const [targetUid, setTargetUid] = useState(null);
  useEffect(() => { if(inventoryOpen){setOffer(null);setTargetUid(null);} },[inventoryOpen]);
  const shop = state.shop;
  const definition = catalog.design.system.shopDefinitions?.find(entry => entry.id === shop.id);
  const exhausted = Number.isInteger(definition?.maxRefreshes) && shop.refreshCount >= definition.maxRefreshes;
  const skillDefinitions = catalog.design.system.strategySkills || [];
  const enchantDefinitions = catalog.design.system.enchantments || [];
  const supplyDefinitions = catalog.design.system.supplyItems || [];
  const special = shop?.kind === 'skill' || shop?.kind === 'enchantment' || shop?.kind === 'supply';
  const slots = (shop?.slots || []).map(slot => special && !slot.purchaseCharId
    ? { ...slot, id: slot.skillId || slot.enchantmentId || slot.itemId, kind: shop.kind }
    : { ...slot, id: slot.charId, kind: 'chess' });
  const itemFor = slot => slot.kind === 'skill'
    ? skillDefinitions.find(item => item.id === slot.skillId)
    : slot.kind === 'enchantment' ? enchantDefinitions.find(item => item.id === slot.enchantmentId)
      : slot.kind === 'supply' ? supplyDefinitions.find(item => item.id === slot.itemId) : null;
  const targetsFor = slot => (state.pieces || []).filter(piece =>
    piece.enchantmentId !== slot.enchantmentId && (slot.definition?.eligibility !== 'instant'
      || catalog.runtime.bodies?.[piece.charId]?.fixedSkill?.kind === 'instant'));
  const selectedTarget = offer?.kind === 'enchantment' ? state.pieces.find(piece => piece.uid === targetUid) : null;
  const openOffer = slot => { onClose(); onInventoryClose(); const item = itemFor(slot); setOffer({ ...slot, name: t(item?.name || slot.name),
    description: t(item?.description || ''), definition: item }); setTargetUid(null); };
  const priv = { funds: state.gold, alive: true, ready: false, hand: [], board: [],
    deployCap: activePieceLimit(state, { design: catalog.design }), deployCount: activePopulation(state),
    shop: { slots, level: state.tech, refreshPrice: shop.refreshCost } };
  const cardPiece = slot => ({ uid: `shop:${slot.slotId}`, charId: slot.charId, purchaseCharId: slot.purchaseCharId || slot.charId,
    star: slot.star, sourceCopies: slot.requiredCopies || 1, row: null, col: null, dir: 'E' });
  const record = slot => presentationRecord(catalog, cardPiece(slot));
  const presentation = {
    record, loadout: slot => ({ skill: record(slot).skill, record: record(slot), defaultSkill: true, choices: 1 }),
    progress: slot => ({ copies: state.pieces.filter(p => p.star === slot.star && (p.purchaseCharId || p.charId) === (slot.purchaseCharId || slot.charId))
      .reduce((n, p) => n + p.sourceCopies, 0), need: Math.min(8, (slot.requiredCopies || 1) * 2) }),
    mergeHint: slot => slot.star < 4 && state.pieces.some(p => p.star === slot.star && p.purchaseCharId === slot.purchaseCharId)
      ? t('晋升至 {star} 星', { star: slot.star + 1 }) : null,
    freezeAvailable: false, hideItemSlot: true,
    levelNode: html`<${Technology} state=${state} catalog=${catalog} />`,
    refreshReason: exhausted ? t('本次补给已刷新') : state.gold < shop.refreshCost ? t('资金不足') : null,
    buyReason: slot => busy ? t('处理中') : slot.sold ? t('已售出')
      : slot.kind === 'skill' && Number(state.skillRanks?.[slot.skillId]) >= 4 ? t('已达最高等级')
        : state.gold < slot.price ? t('资金不足')
          : slot.kind === 'supply' && supplySpaceUsed(state,catalog) + (itemFor(slot)?.sizeSlots || 1) > catalog.design.system.supplyCapacity ? t('补给箱空间不足') : null,
    renderSlot: ({ slot, idx, reason, armed, onTap }) => {
      const item = itemFor(slot);
      const art = upgradeIcon(item, slot.star || 1);
      const unavailable = slot.kind === 'enchantment' && !targetsFor({ ...slot, definition: item }).length
        ? t('没有可选的干员') : reason;
      return html`<button key=${slot.slotId} type="button" data-slot-idx=${idx} class=${`scard scard--item${armed ? ' is-armed' : ''}${unavailable ? ' is-disabled' : ''}`}
        aria-label=${t('{name}，价格 {price}', { name: t(item?.name || slot.name || t('商品')), price: slot.price })}
        aria-pressed=${String(!!armed)} onClick=${() => onTap ? onTap(idx) : openOffer(slot)}>
        <span class="scard__bg" aria-hidden="true"></span><span class="scard__top">${slot.kind === 'supply' ? html`<${TierChip} tier=${slot.star || 1} size="md" />` : null}${slot.kind === 'skill' ? html`<${TierChip} tier=${Number(state.skillRanks?.[slot.skillId]) > 0
          ? Number(state.skillRanks[slot.skillId]) + 1 : slot.star || 1} size="md" />` : null}
          <${PriceHex} slot=${slot} poor=${unavailable === t('资金不足')} /></span>
        <span class="scard__itemart">${art}</span><span class="scard__body"><span class="scard__name">${t(item?.name || slot.name || t('商品'))}</span>
          <span class="scard__idesc">${slot.kind === 'skill' ? t('收藏品技能') : slot.kind === 'supply' ? t(item?.kind === 'machine' ? '机器' : '饮料') : t('强化')}</span></span>
        ${armed ? html`<span class=${`scard__confirm${unavailable ? ' is-no' : ''}`} role="status"><b>${unavailable || t('确认购买')}</b>
          <small>${unavailable ? '' : t('再次点击')}</small></span>` : null}</button>`;
    },
  };
  return html`<${ShopBar} priv=${priv} editable=${!busy} refreshBusy=${busy} collapsed=${collapsed} onCollapse=${onCollapse}
    onBuy=${i => { const slot = slots[i]; if (slot.kind === 'skill') { setOffer(null); onAction('buySkill', { slotId: slot.slotId }); }
      else if (slot.kind === 'enchantment') openOffer(slot);
      else if (slot.kind === 'supply') { setOffer(null); onAction('buySupply', { slotId: slot.slotId }); }
      else onAction('buy', { slotId: slot.slotId }); }} onLevel=${() => {}}
    onRefresh=${() => onAction('refreshShop')} onFreeze=${() => {}} presentation=${presentation}
    onDetailClose=${onClose} onDetail=${(id, kind) => { const slot = slots.find(s => s.id === id && !s.sold); if (!slot) return;
      if (kind === 'skill' || kind === 'enchantment' || kind === 'supply') openOffer(slot); else onOpen(cardPiece(slot)); }}
    onRefuse=${reason => toast(reason, 'warn')} />
    ${offer && !inventoryOpen ? html`<aside class="dpanel brackets dpanel--assault dpanel--right is-shop" role="dialog" aria-label=${offer.name}
      style=${globalThis.window?.innerWidth <= 767 ? { right: 'calc(.12rem + 10px)' } : undefined}>
      <button type="button" class="dpanel__close" aria-label=${t('关闭')} onClick=${() => { setOffer(null); setTargetUid(null); }}><${Icon} name="close" /></button>
      <div class="dpanel__scroll"><div class="dhead"><div class="dhead__icon">${upgradeIcon(offer.definition, offer.star || 1)}</div>
        <div class="dhead__info"><div class="dhead__chips"><span class="dtag-kind">${offer.kind === 'skill' ? t('收藏品技能') : offer.kind === 'supply' ? t(offer.definition?.kind === 'machine' ? '机器' : '饮料') : t('强化')}</span>
          ${offer.kind === 'supply' ? html`<${TierChip} tier=${offer.star || 1} size="sm" />` : null}
          ${offer.kind === 'skill' && Number(state.skillRanks?.[offer.skillId]) > 0 ? html`<${TierChip} tier=${Number(state.skillRanks[offer.skillId])} size="sm" /> → ` : null}
          ${offer.kind === 'skill' ? html`<${TierChip} tier=${Number(state.skillRanks?.[offer.skillId]) > 0
            ? Number(state.skillRanks[offer.skillId]) + 1 : offer.star || 1} size="sm" />` : null}</div><h3 class="dhead__name">${offer.name}</h3></div></div>
        <${RichText} as="div" text=${offer.kind === 'skill'
          ? strategySkillText({ ...offer.definition, description: t(offer.definition?.description || offer.description) },
            Number(state.skillRanks?.[offer.skillId]) > 0 ? Number(state.skillRanks[offer.skillId]) + 1 : offer.star)
          : offer.kind === 'supply' ? supplyDescription(offer.definition,offer.star)
            : selectedTarget ? currentStarText(offer.description, selectedTarget.star) : offer.description} class="dtext" />
        ${offer.kind !== 'enchantment' ? html`<div class="dactions"><${Button} variant="amber" disabled=${busy || state.gold < offer.price || (offer.kind === 'supply' && supplySpaceUsed(state,catalog) + (offer.definition?.sizeSlots || 1) > catalog.design.system.supplyCapacity)}
          onClick=${() => { const chosen = offer; setOffer(null); onAction(chosen.kind === 'supply' ? 'buySupply' : 'buySkill', { slotId: chosen.slotId }); }}>${t('购买')}<span class="dsell num">${offer.price}</span><//></div>`
          : html`<${Section} title=${t('选择干员')}>
            ${targetsFor(offer).map(piece => { const old = enchantDefinitions.find(item => item.id === piece.enchantmentId);
              return html`<${Button} active=${targetUid === piece.uid} onClick=${() => setTargetUid(piece.uid)}>
              <${UnitThumb} id=${piece.charId} tier=${piece.star} size="sm" />${t(piece.name || displayName(catalog, piece.charId))}
                ${old ? t('替换：{old} → {new}', { old: t(old.name), new: offer.name }) : ''}<//>`; })}
          <//><div class="dactions"><${Button} variant="amber" disabled=${busy || !targetUid || state.gold < offer.price}
            onClick=${() => { const chosen = offer; const uid = targetUid; setOffer(null); setTargetUid(null); onAction('enchantPiece', { slotId: chosen.slotId, uid }); }}>
            ${t('确认强化')}<span class="dsell num">${offer.price}</span><//></div>`}
      </div></aside>` : null}`;
}

function NativeChoices({ state, catalog, onAction, busy }) {
  const [eventChoice, setEventChoice] = useState(null);
  const [target, setTarget] = useState({});
  if (state.phase === 'nodeChoice') return html`<${Nodes} state=${state} catalog=${catalog} onAction=${onAction} busy=${busy} />`;
  if (state.phase === 'skillChoice') {
    const reward = state.skillRewards;
    const skills = new Map((catalog.design.system.strategySkills || []).map(skill => [skill.id, skill]));
    const choices = reward?.choices || [];
    return html`<${Choice} name=${t('战术')}
      busy=${busy} extra=${html`<${Button} variant="ghost" disabled=${busy}
        onClick=${() => onAction('skipSkillReward')}>${t('跳过')}<//>`}
      cards=${choices.map(id => { const skill = skills.get(id); const currentRank = Number(state.skillRanks?.[id] || 0);
        const resultRank = skillRewardRank(currentRank, reward.star);
        const desc = strategySkillText({ ...skill, description: t(skill.description) }, resultRank);
        return { name: t(skill.name), desc,
          visual: html`<span class="assault-choice-visual assault-choice-visual--skill">${currentRank > 0 ? html`<${TierChip} tier=${currentRank} size="sm" /> → ` : null}<${TierChip} tier=${resultRank} size="sm" />${upgradeIcon(skill, resultRank)}</span>` };
      })}
      onPick=${i => onAction('chooseSkill', { skillId: choices[i] })} />`;
  }
  if (state.phase === 'upgradeChoice') {
    const reward = state.upgradeRewards;
    const pieces = new Map((state.pieces || []).map(piece => [piece.uid, piece]));
    const candidates = (reward?.choices || []).slice(0, 4).map(uid => {
      const piece = pieces.get(uid);
      if (!piece) return { uid, piece: null, projected: null };
      try { return { uid, piece, projected: operatorUpgradeProjection(piece, { catalog: catalog.runtime }, reward.maxStar) }; }
      catch { return { uid, piece, projected: null }; }
    });
    const previewFailed = candidates.some(candidate => !candidate.projected);
    return html`<${Choice} name=${t('干员升级')}
      busy=${busy} extra=${html`${previewFailed ? html`<p role="alert">${t('暂时无法预览此升级选项，请稍后重试。')}</p>` : null}
        ${reward?.skippable ? html`<${Button} variant="ghost" disabled=${busy}
          onClick=${() => onAction('skipUpgradeReward')}>${t('跳过')}<//>` : null}`}
      cards=${candidates.map(({ piece, projected }) => {
        const currentStar = Math.max(1, Number(piece?.star) || 1);
        const nextStar = projected?.star ?? currentStar;
        const display = piece ? displayName(catalog, piece.charId) : t('干员');
        // the effect text of the card the operator becomes: the bazaar card lines of the detail panel's first screen
        const face = projected ? bazaarCard(catalog, projected, projected.moduleChoices?.[piece.charId] ?? null) : null;
        const lines = face ? [...face.lines.map(line => line.text), ...(face.module ? [face.module.text] : [])]
          : projected ? [operatorMechanics(catalog, projected)?.skill?.summary].filter(Boolean) : [];
        return { name: t(piece?.name || display), tier: projected ? nextStar : currentStar, disabled: !projected,
          desc: projected ? lines.join('\n') : t('暂时无法预览此升级选项，请稍后重试。'),
          visual: html`<span class="assault-choice-visual">${piece ? html`<${UnitThumb} id=${piece.charId} tier=${currentStar} size="md" />` : html`<${GIcon} name="info" />`}
            ${projected ? html`<span aria-hidden="true">→</span><${UnitThumb} id=${piece.charId} tier=${nextStar} size="md" />` : html`<${GIcon} name="info" />`}</span>` };
      })}
      onPick=${i => { const candidate = candidates[i]; if (candidate) onAction('chooseUpgrade', { uid: candidate.uid }); }} />`;
  }
  if (state.phase === 'rewards') {
    const choices = state.rewards?.choices || [];
    return html`<${Choice} name=${t('收藏品')}
      busy=${busy} cards=${choices.map(id => { const r = relicById(catalog, id); return { name: r.name, desc: r.line || r.description,
        visual: html`<span class="assault-choice-visual assault-choice-visual--relic"><${Img} src=${relicIcon(catalog,id)} alt=${r.name} class="assault-relic-image" /></span>` }; })}
      onPick=${i => onAction('chooseRelic', { relicId: choices[i] })} />`;
  }
  if (state.phase !== 'event') return null;
  const event = state.target || {};
  const text = catalog.publicText?.events?.[event.eventId];
  const choices = state.choices || [];
  const needsTarget = choice => !!choice?.targeting?.mode && choice.targeting.mode !== 'none';
  const chosenNeedsTarget = needsTarget(eventChoice);
  const recruitFilters = (eventChoice?.recruitFilters || []).filter(tag => eventChoice.targets?.some(v => v.filterTag === tag));
  const filter = target.filterTag || recruitFilters[0];
  const targets = (eventChoice?.targets || []).filter(v => !filter || !v.filterTag || v.filterTag === filter);
  const randomEnchant = choice => (choice.outcomes || []).flatMap(o => o.effects || []).find(effect => effect.kind === 'randomEnchant');
  const choiceLabel = choice => text?.choices?.[choice.id]?.label || choice.label || (randomEnchant(choice)
    ? randomEnchant(choice).targetRule === 'oldestToxic' ? t('重新调配强化') : t('接受强化') : t('继续前行'));
  const disabledReason = choice => {
    const effect = randomEnchant(choice);
    if (!effect) return choice.disabledReason || '';
    if (!choice.enchantmentOffer?.targetUid) return effect.targetRule === 'oldestToxic'
      ? t('无剧毒强化干员') : t('没有可强化的干员');
    if ((choice.costs || []).some(cost => cost.currency === 'gold' && state.gold < cost.amount)) return t('资金不足');
    return t('无可用强化');
  };
  // The card text is what the choice does. The authored text is 〈wording。 消耗N…。 结果：…〉: the cost is the icon under the
  // picture, the result is the effect; the wording stays only where the result alone does not say it (a tag, no result), and
  // 「没有额外收益」 says nothing.
  const effectText = choice => {
    const [wording = '', ...tail] = String(text?.choices?.[choice.id]?.description || choice.description || '').split(/\s*结果：/);
    const result = tail.join('').trim();
    const prose = wording.replace(/\s*消耗[^。]*。?/g, '').split(/[。；]/)[0].trim();
    const sure = result && !['没有额外收益', '效果'].includes(result); // 「结果：效果」 is the data's placeholder
    return [...(!result || /效果/.test(result) ? [prose] : []), ...(sure ? [result] : [])].filter(Boolean).join('\n');
  };
  const description = choice => randomEnchant(choice)
    ? [randomEnchant(choice).targetRule === 'oldestToxic' ? t('更换最早持剧毒干员的强化') : t('强化最早未强化干员'), choice.enabled === false ? disabledReason(choice) : ''].filter(Boolean).join('\n')
    : effectText(choice);
  const confirm = (choice, picked = {}) => { setEventChoice(null); setTarget({}); onAction('confirmEvent', { choiceId: choice.id, ...picked }); };
  return html`<${Choice} name=${text?.name || event.name || t('事件')} busy=${busy} backdrop=${eventBackground(catalog,event.eventId)}
    cards=${choices.map(c => ({ name: choiceLabel(c), desc: description(c), disabled: c.enabled === false,
      visual: html`<${EventActionVisual} choice=${c} catalog=${catalog} state=${state} />` }))}
    onPick=${i => { const choice = choices[i]; if (needsTarget(choice)) { setEventChoice(choice); setTarget({}); } else confirm(choice); }} />
    <${Modal} open=${!!eventChoice} title=${eventChoice ? choiceLabel(eventChoice) : undefined}
      onClose=${() => setEventChoice(null)} actions=${html`<${Button} variant="primary"
        disabled=${busy || eventChoice?.enabled === false || (chosenNeedsTarget && !target.targetUid)
          || (eventChoice?.targeting.mode === 'recruit' && eventChoice?.targeting.selection !== 'random' && !filter)}
        onClick=${() => confirm(eventChoice, { ...target, ...(filter ? { filterTag: filter } : {}) })}>${t('确认选择')}<//>`}>
      ${recruitFilters.length ? html`<div class="assault-actions">${recruitFilters.map(tag => html`<${Button} active=${tag === filter}
        onClick=${() => setTarget({ filterTag: tag })}><${RecruitFilterVisual} choice=${eventChoice} tag=${tag} catalog=${catalog} />${recruitFilterLabel(catalog,eventChoice,tag)}<//>`)}</div>` : null}
      ${chosenNeedsTarget ? html`<div class="assault-actions">${targets.map(v => {
        const piece = state.pieces.find(p => p.uid === v.targetUid);
        const charId = piece?.charId || targetCharId(catalog,v);
        return html`<${Button} active=${v.targetUid === target.targetUid}
          onClick=${() => setTarget({ filterTag: v.filterTag || filter, targetUid: v.targetUid })}><${UnitThumb} id=${charId}
          tier=${piece?.star || v.star || 1} size="sm" />${v.name || displayName(catalog,charId)}<//>`;
      })}</div>` : null}
    <//>`;
}

function NativePieceDetail({ piece, state, catalog, session, onClose, onAction, busy = false, shopOpen = false, onSummonPlacement, inspectionMode, onInspectionMode }) {
  const [detailPage, setDetailPage] = useState('mechanics');
  useEffect(() => { setDetailPage('mechanics'); }, [piece.uid, piece.charId]);
  const record = presentationRecord(catalog, piece, session, state);
  const text = catalog.publicText.operators[piece.charId] || {};
  const mechanics = operatorMechanics(catalog, piece) || {};
  const owned = state.pieces.some(p => p.uid === piece.uid);
  const shopSlotId = typeof piece.uid === 'string' && piece.uid.startsWith('shop:') ? piece.uid.slice(5) : null;
  const shopSlot = !owned && state.phase === 'shop' && shopSlotId
    ? state.shop?.slots?.find(slot => slot.slotId === shopSlotId && slot.charId === piece.charId && !slot.sold && Number.isFinite(slot.price)) || null
    : null;
  const editable = owned && ['nodeChoice','shop','event','battlePrep'].includes(state.phase);
  const forms = formChoices(catalog, piece);
  const modules = advancedModules(catalog, piece);
  const savedModule = Object.hasOwn(piece.moduleChoices || {}, piece.charId)
    ? piece.moduleChoices[piece.charId] : (piece.moduleId || (piece.star >= 3 ? pieceRecord(catalog, piece)?.defaultModuleId : null));
  const selectedModule = pieceRecord(catalog,piece)?.adaptation?.moduleAliases?.[savedModule] ?? savedModule;
  const templates = summonTemplateOptions(catalog, piece);
  const live=session?.battle ? ()=>{
    const u=session.battle.allyUnits?.find(u=>u.uid===piece.uid&&u.kind==='op');
    return u?{...unitStatsEntry(u,u._s),src:'battle'}:null;
  }:null;
  const section = (title, body, cls = undefined) => html`<${Section} title=${title} class=${cls}>${body}<//>`;
  const tabButtons = html`<div class="assault-detail-tabs" role="tablist" aria-label=${t('干员详情')}>
    <${Button} active=${detailPage === 'mechanics'} aria-selected=${detailPage === 'mechanics'} role="tab"
      onClick=${() => setDetailPage('mechanics')}>${t('进击机制')}<//>
    <${Button} active=${detailPage === 'original'} aria-selected=${detailPage === 'original'} role="tab"
      onClick=${() => setDetailPage('original')}>${t('属性与原作')}<//>
  </div>`;
  const description = (value, className = 'dtext') => value ? html`<${RichText} text=${value} class=${className} />` : null;
  // First screen = the bazaar card: type label, skill-cost badge, at most three
  // effect lines and the chosen module line; four-star values sit under 「详细」.
  const card = bazaarCard(catalog, piece, selectedModule);
  const keywords = (value) => keywordSegments(value).map((segment, index) => segment.icon
    ? html`<b class="assault-kw" data-kw=${segment.icon} key=${index}><${GIcon} name=${segment.icon} />${segment.text}</b>` : segment.text);
  const tiersView = (segments) => segments.map((segment, index) => segment.tiers
    ? html`<span class="assault-tiers" key=${index}>${segment.tiers.map((value, tier) => html`${tier ? ' » ' : ''}<span
        class=${tier === segment.current ? 'assault-tier is-current' : 'assault-tier'}>${value ?? '—'}</span>`)}</span>` : segment.text);
  const cardBlock = detailPage === 'mechanics' && card ? html`<div class="assault-bazaar-card" data-star=${card.star}>
    <div class="assault-bazaar-card__head">
      <span class="assault-bazaar-card__type">${card.typeLabel}</span>
      ${card.sp != null ? html`<span class="assault-sp-badge" title=${t('所需技力')}><${GIcon} name="hourglass" /><b class="num">${card.sp}</b>${card.charges>1?html`<small title=${t('可储存{n}次',{n:card.charges})}>×${card.charges}</small>`:null}</span>`
        : html`<span class="assault-sp-badge is-passive">${t('被动')}</span>`}
      ${card.ammo!=null?html`<span class="assault-sp-badge" title=${t('本场可施放{n}次',{n:card.ammo})}><${GIcon} name="target" /><b class="num">${card.ammo}</b></span>`:null}
    </div>
    <ul class="assault-bazaar-lines">
      ${card.lines.map((line, index) => html`<li class=${`assault-bazaar-line is-${line.kind}`} key=${index}>${keywords(line.text)}${line.growthPoints!=null?html` <b class="num assault-card-growth-current" title=${t('本局已成长')}>+${line.growthPoints}%</b>`:null}</li>`)}
      ${card.module ? html`<li class="assault-bazaar-line is-module" data-module=${card.module.id}>${keywords(card.module.text)}</li>` : null}
    </ul>
    <details class="assault-mechanic-detail assault-bazaar-detail"><summary>${t('详细')}</summary>
      ${card.spTiers ? html`<p class="dtext">${t('所需技力')} ${tiersView(card.spTiers)}</p>` : null}
      ${card.lines.map((line, index) => html`<p class="dtext" key=${index}>${tiersView(line.tiers)}</p>`)}
      ${mechanics.passives.map((passive,index)=>html`<p class="dtext" key=${`retained-${index}`}>${passive.description}</p>`)}
      ${card.module ? html`<p class="dtext">${tiersView(card.module.tiers)}</p>` : null}
    </details>
  </div>` : null;
  // 攻击范围 / 技能范围: the two switches that light the range on the board (the stats row already carries the range mini-map)
  const attackRange = attackRangeOf(catalog, piece);
  const sourceSkillRange=pieceRecord(catalog,piece)?.fixedSkill?.runtime?.sourceRangeGrid;
  const rangeBlock = detailPage === 'mechanics' && attackRange ? html`<div class="assault-actions assault-range" data-range-cells=${attackRange.length}><${Button} active=${inspectionMode==='attack'} onClick=${()=>onInspectionMode('attack')}>${t('攻击范围')}<//><${Button} disabled=${!sourceSkillRange?.length} active=${inspectionMode==='skill'} onClick=${()=>onInspectionMode('skill')}>${t('技能范围')}<//></div>` : null;
  const originalSkills = mechanics.original?.skills || [];
  const originalTalents = mechanics.original?.talents || [];
  const enchantment = (catalog.design.system.enchantments || []).find(entry => entry.id === (piece.effectiveEnchantmentId ?? piece.enchantmentId));
  const enchantmentBlock = detailPage === 'mechanics' && enchantment ? section(t('持有强化'), html`
    <div class="dtalent"><b>${upgradeIcon(enchantment, piece.star)} ${t(enchantment.name)}</b>${description(currentStarText(t(enchantment.description), piece.star))}</div>
  `, 'dsec--skill') : null;
  const abilityPower = abilityBonuses(piece, state);
  const currentHour = absoluteRunHour(state);
  const cooldownPower = (piece.temporaryEnhancements || []).filter(effect => effect.id.startsWith('supply-cdr:')
    && effect.stat === 'bat' && effect.mode === 'percent' && effect.expiresAtHour > currentHour).reduce((sum, effect) => sum - effect.amount, 0);
  const temporaryBonuses = [
    [t('直接伤害'), abilityPower.damage, 'sword'], [t('治疗量'), abilityPower.heal, 'target'],
    [t('生命回复'), abilityPower.regen, 'target'], [t('护盾值'), abilityPower.shield, 'shield'],
    [t('中毒输出'), abilityPower.poison, 'bolt'], [t('灼烧输出'), abilityPower.burn, 'bolt'],
    [t('冷却缩短'), Math.round(cooldownPower * 100), 'hourglass', '%'],
  ].filter(([, amount]) => amount > 0);
  const temporaryBlock = detailPage === 'mechanics' && temporaryBonuses.length ? section(t('今日增益'), html`
    ${temporaryBonuses.map(([label, amount, icon, unit = '']) => html`<div class="dtalent"><b><${Icon} name=${icon} /> ${label}</b>
      <span class="num">+${amount}${unit}</span></div>`)}
  `) : null;
  // 本局已成长 (run growth, kept on the piece) · 本场 (this battle's stacks) · 可阻挡空中敌人 (granted or 起飞)
  const growth = growthView(piece, session?.battle);
  // a card's own 本场 counter carries its interface label (a msgid) and suffix
  const growthRow = (label, { stat, mode, amount, label: own, suffix }) => html`<div class="dtalent" data-growth=${`${label}:${stat}:${mode}`}>
    <b><${Icon} name="chart" /> ${label} · ${mode === 'counter' ? t(own) : statLabel(stat)}</b><span class="num">${growthAmountText({ mode, amount, suffix })}</span></div>`;
  const growthBlock = detailPage === 'mechanics' && (growth.run.length || growth.battle.length || growth.airBlock) ? section(t('累计增益'), html`
    ${growth.run.map((row) => growthRow(t('本局已成长'), row))}
    ${growth.battle.map((row) => growthRow(t('本场'), row))}
    ${growth.airBlock ? html`<div class="dtalent" data-air-block=${growth.airBlock}><b><${Icon} name="shield" /> ${t('可阻挡空中敌人')}</b></div>` : null}
  `) : null;
  const source = pieceRecord(catalog, piece)?.source;
  const sourceAttributes = source?.interpolatedAttributes;
  const originalStats = sourceAttributes ? { ...record, stats: { ...sourceAttributes,
    res: sourceAttributes.magicResistance, bat: sourceAttributes.baseAttackTime, aspd: sourceAttributes.attackSpeed } } : null;
  const originalSkillBlock = detailPage === 'original' && originalSkills.length ? section(t('原作技能（满级）'), originalSkills.map(skill => html`<div class="dtalent" key=${skill.name}>
    <b>${skill.name}</b>${description(skill.description, 'dtext')}
  </div>`), 'dsec--skill') : null;
  const originalTalentBlock = detailPage === 'original' && originalTalents.length ? section(t('天赋'), originalTalents.map(talent => html`<div class="dtalent" key=${talent.name}>
    <b>${talent.name}</b>${description(talent.description, 'dtext')}
  </div>`)) : null;
  const moduleBlock = detailPage === 'mechanics' && modules.length ? section(t('进阶模组'), html`
    ${modules.slice().sort((a, b) => Number(b.id === selectedModule) - Number(a.id === selectedModule)).map(module => html`<details class="dmodule" open=${selectedModule === module.id} data-module=${module.id} data-module-active=${selectedModule === module.id} key=${module.id}>
      <summary>${text.modules?.[module.id]?.name || module.name}</summary>
      <${Button} active=${selectedModule === module.id} disabled=${!editable || piece.star < module.unlockStar}
        class="assault-module-choice"
        onClick=${() => onAction('chooseModule', { uid: piece.uid, moduleId: module.id })}>
        <${ModuleGlyph} m=${data.get('assets')} rec=${module} id=${module.id} size="md" />
        <span class="assault-module-choice__text">
          ${module.typeName ? html`<small class="assault-module-choice__type">${module.typeName}</small>` : null}
          <b>${text.modules?.[module.id]?.name || module.name}</b>
        </span>
      <//>
      <p class="dtext">${moduleCardText(catalog, piece, module.id) ? keywords(moduleCardText(catalog, piece, module.id)) : '—'}</p>
    </details>`)}
  `) : null;
  const mechanicsBlock = detailPage === 'mechanics' ? html`<div class="assault-mechanics-card">
    ${rangeBlock}${cardBlock}${enchantmentBlock}${moduleBlock}${temporaryBlock}${growthBlock}
  </div>` : null;
  const onMechanicsPage = detailPage === 'mechanics';
  const overrides = {
    assaultTabs: tabButtons,
    assaultMechanics: mechanicsBlock,
    garrison: null,
    module: null,
    equip: null,
    ...(onMechanicsPage ? { skill: null, talents: null } : {
      trait: mechanics.original?.trait ? section(t('原作特性'), html`<div class="dtrait">${description(mechanics.original.trait)}</div>`) : null,
      originalStats: originalStats ? section(t('原作属性（精英{phase}·{level}级）', { phase: source.phase, level: source.level }),
        chessStatsBlock({ rec: originalStats, chess: originalStats })) : null,
      skill: originalSkillBlock,
      talents: originalTalentBlock,
    }),
    ...(shopSlot ? { actions: html`<div class="dactions"><${Button} variant="amber" disabled=${busy || state.gold < shopSlot.price}
      onClick=${() => { onClose(); onAction('buy', { slotId: shopSlot.slotId }); }}>${t('购买')}<span class="dsell num">${shopSlot.price}</span><//></div>` } : {}),
  };
  const extra = html`${forms.length > 1 ? section(t('身体形态'), html`<div class="assault-actions">${forms.map(id => html`<${Button} active=${id === piece.charId}
      disabled=${!editable} onClick=${() => onAction('changeForm', { uid: piece.uid, charId: id })}><${UnitThumb} id=${id} size="xs" />${displayName(catalog, id)}<//>`)}</div>`) : null}
    ${templates.length ? section(t('召唤预设'), html`<div class="assault-actions">${templates.map(v => html`<${Button} disabled=${!editable || piece.row == null}
      onClick=${() => {const existing=(piece.summonPresets||[]).findIndex(p=>p?.tokenId===v.tokenId);onSummonPlacement({uid:piece.uid,tokenId:v.tokenId,name:v.name,index:existing>=0?existing:Math.max(0,(piece.summonPresets||[]).length)});onClose();}}>${v.name}<//>${v.max>1||['char_2023_ling','char_242_otter','char_4072_ironmn','char_484_robrta'].includes(piece.charId)?html`<${Button} disabled=${!editable||piece.row==null||(piece.summonPresets||[]).filter(p=>p?.tokenId===v.tokenId).length>=(v.max??12)||(piece.summonPresets||[]).filter(Boolean).length>=12} onClick=${()=>{const empty=(piece.summonPresets||[]).findIndex(p=>!p);onSummonPlacement({uid:piece.uid,tokenId:v.tokenId,name:v.name,index:empty>=0?empty:(piece.summonPresets||[]).length});onClose();}}>+<//>`:null}`)}</div>
      ${(piece.summonPresets||[]).map((p,index)=>p?html`<div class="assault-actions"><${Button} disabled=${!editable} onClick=${()=>{onSummonPlacement({uid:piece.uid,tokenId:p.tokenId,name:templates.find(v=>v.tokenId===p.tokenId)?.name||t('召唤物'),index});onClose();}}>${templates.find(v=>v.tokenId===p.tokenId)?.name||t('召唤物')} · ${p.row},${p.col}<//><${Button} disabled=${!editable} onClick=${()=>onAction('setSummonPreset',{uid:piece.uid,index,remove:true})}>${t('移除')}<//></div>`:null)}`) : null}`;
  const sectionOrder = onMechanicsPage
    ? ['head', 'assaultTabs', 'stats', 'assaultMechanics', 'module', 'actions']
    : ['head', 'assaultTabs', 'trait', 'stats', 'originalStats', 'skill', 'talents', 'actions'];
  return html`<${DetailPanel} detail=${{ type: 'chess', chess: record, piece: owned ? { ...piece, kind: 'chess', golden: piece.star >= 4 } : null,
    cultOpts: { cultivation: null }, resolvedLoadout: { skill: record.skill, record, defaultSkill: true, choices: 1 } }}
    editable=${editable} onClose=${onClose} onSell=${p => onAction('sell', { uid: p.uid })} voice=${true}
    overrides=${overrides} sectionOrder=${sectionOrder} extra=${extra} scrollKey=${`${piece.uid}:${piece.charId}:${detailPage}`}
    live=${live} side="right" shopOpen=${shopOpen} />`;
}

function supplyDescription(item, star) {
  if(!item)return '';
  const description=strategySkillText({...item,startingStar:Math.min(...(item.allowedStars || [1]))},star);
  return item.saleEffect?.kind==='cooldown' ? description+' '+t('缩短 {amount}%',{amount:item.saleEffect.values?.[(Number(star)||1)-1] || 0}) : description;
}
function supplySpaceUsed(state,catalog) {
  return (state.supplies || []).reduce((sum,supply)=>sum+(catalog.design.system.supplyItems?.find(item=>item.id===supply.itemId)?.sizeSlots || 1),0);
}
function NativeSupplyInventory({state,catalog,selectedUid,onSelect,onClose,onAction,busy,shopOpen}) {
  const items=catalog.design.system.supplyItems || [],supplies=state.supplies || [],selected=supplies.find(supply=>supply.uid===selectedUid),item=items.find(def=>def.id===selected?.itemId);
  const canSell=['shop','event','battlePrep','nodeChoice'].includes(state.phase),sellPrice=item?.sellPrices?.[(selected?.star || 1)-1] || 0;
  const extra=html`<div data-component-link=${selected ? 'supply:'+selected.uid : 'supplies'}>
    <div class="dhead dhead--item"><div class="dhead__icon">${item ? upgradeIcon(item,selected.star) : html`<${Icon} name="robot" />`}</div>
      <div class="dhead__info"><div class="dhead__chips">${selected ? html`<${TierChip} tier=${selected.star} size="sm" />` : null}<span class="dtag-kind">${t('补给箱')}</span></div>
        <h3 class="dhead__name">${item ? t(item.name) : t('补给箱')}</h3></div></div>
    ${item ? html`<${Section} title=${t('效果')}><${RichText} as="p" text=${supplyDescription(item,selected.star)} class="dtext" /><//>
      <div class="dactions"><${Button} variant="amber" disabled=${busy || !canSell}
        onClick=${()=>onAction('sellSupply',{uid:selected.uid})}>${item.kind==='beverage' ? t('出售并使用') : t('出售')}${item.kind==='machine' ? html`<span class="dsell num">+${sellPrice}</span>` : null}<//></div>` : null}
    <${Section} title=${t('补给箱 {used}/{capacity}',{used:supplySpaceUsed(state,catalog),capacity:catalog.design.system.supplyCapacity})}>
      <div class="assault-actions">${supplies.map(supply=>{const def=items.find(value=>value.id===supply.itemId);return html`<${Button} key=${supply.uid} active=${supply.uid===selectedUid}
        data-component-link=${'supply:'+supply.uid} onClick=${()=>onSelect(supply.uid)}>${upgradeIcon(def,supply.star)}<${TierChip} tier=${supply.star} size="sm" />${t(def?.name || '补给')}<//>`;})}</div>
      ${supplies.length ? null : html`<p class="dtext">${t('补给箱为空')}</p>`}<//>
  </div>`;
  return html`<${DetailPanel} detail=${{type:'supply'}} editable=${false} onClose=${onClose} side="right" shopOpen=${shopOpen}
    extra=${extra} scrollKey=${selected?.uid || 'supplies'} />`;
}

function NativeEnd({ state, catalog, onRestart, onOpen }) {
  const result = resultOf(state,catalog);
  useEffect(()=>{recordResult(result,{myId:ME,roomMode:'solo',now:Date.now()});},[state.runId]);
  return html`<${ResultView} res=${result} myId=${ME} backLabel=${t('再来一局')} onBack=${onRestart}
    presentation=${{ headline: state.completed ? t('进击完成') : t('本局结束'), playersLabel: t('进击队伍'), reportMicro: 'ASSAULT REPORT',
      extra: html`<div class="assault-actions"><${Button} onClick=${()=>openStats('assault-ledger')}>${t('本场账本')}<//>${state.pieces.map(piece => html`<${Button} id=${`piece-${piece.uid}`} onClick=${() => onOpen(piece)}>
        <${UnitThumb} id=${piece.charId} tier=${piece.star} golden=${piece.star >= 4} size="xs" />${displayName(catalog,piece.charId)}<//>`)}</div>` }} />`;
}

export function AssaultUI({ catalog, state, page, session, detail, busy, error, pending, onAction, onOpen, onClose,
  onStart, onImport, onExport, onRestart, onRetry, onSpeed, onPause, connection, resumeRunId, onResume }) {
  const [collapsed, setCollapsed] = useState(false);
  const [summonPlacement,setSummonPlacement] = useState(null);
  const beginSummonPlacement=selection=>{setSummonPlacement(selection);setCollapsed(true);};
  useEffect(()=>{setSummonPlacement(null);},[state?.phase,state?.runId]);
  const [drawer, setDrawer] = useState(null);
  const [inventoryOpen,setInventoryOpen] = useState(false);
  const [supplyUid,setSupplyUid] = useState(null);
  const [settings, setSettings] = useState(false);
  const [pen,setPen] = useState(false);
  const [foreignDetail,setForeignDetail] = useState(null);
  const inspectionKey=detail?.uid??foreignDetail?.unitId??null;
  const [rangeSelection,setRangeSelection]=useState({key:null,mode:'attack'});
  const inspectionMode=rangeSelection.key===inspectionKey?rangeSelection.mode:'attack';
  const setInspectionMode=mode=>setRangeSelection({key:inspectionKey,mode});
  const [emoteOpen,setEmoteOpen] = useState(false);
  const [bubble,setBubble] = useState(null);
  const [link,setLink] = useState(null);
  const [frame, setFrame] = useState(null);
  const [readyBattle, setReadyBattle] = useState(null);
  const [strategyFocus, setStrategyFocus] = useState(null);
  const settled = useRef(false);
  const closeInventory=()=>{setInventoryOpen(false);setSupplyUid(null);};
  const openInventory=(uid=null)=>{onClose();setForeignDetail(null);setDrawer(null);setSupplyUid(uid);setInventoryOpen(true);};
  const openPiece=piece=>{closeInventory();onOpen(piece);};
  useEffect(()=>{if(detail || foreignDetail)closeInventory();},[detail?.uid,foreignDetail]);
  useEffect(()=>{if(supplyUid && !(state?.supplies || []).some(supply=>supply.uid===supplyUid))setSupplyUid(null);},[state?.supplies,supplyUid]);
  useEffect(()=>{setPen(false);setForeignDetail(null);},[state?.phase]);
  useEffect(()=>{if(detail)setForeignDetail(null);},[detail?.uid]);
  useEffect(()=>{
    const root=/** @type {HTMLElement | null} */ (document.querySelector('.assault-presentation'));
    if(!root)return;
    const clear=()=>{
      root.style.removeProperty('--assault-shop-space');
      root.style.removeProperty('--assault-shop-bottom');
    };
    const shop=/** @type {HTMLElement | null} */ (state?.phase==='shop'&&!collapsed?root.querySelector('.shopbar'):null);
    if(!shop){clear();return clear;}
    const update=()=>{
      const style=getComputedStyle(shop);
      const right=parseFloat(style.right)||0;
      const bottom=parseFloat(style.bottom)||0;
      root.style.setProperty('--assault-shop-space',`${Math.ceil(shop.offsetWidth+right+8)}px`);
      root.style.setProperty('--assault-shop-bottom',`${Math.ceil(shop.offsetHeight+bottom+8)}px`);
    };
    const observer=new ResizeObserver(update);
    observer.observe(root);
    observer.observe(shop);
    update();
    return ()=>{observer.disconnect();clear();};
  },[state?.phase,collapsed,page]);
  useEffect(()=>{
    if(!bubble)return;
    const timer=setTimeout(()=>setBubble(null),3000);
    return ()=>clearTimeout(timer);
  },[bubble]);
  useEffect(()=>{
    const root=document.querySelector('.assault-presentation');
    if(!root)return;
    const context=e=>{
      if(e.target.closest?.('.gm__field')||String(window.getSelection()||''))return;
      const parts=[]; let el=e.target;
      while(el&&el!==root){
        const siblings=[...el.parentElement.children].filter(v=>v.tagName===el.tagName);
        parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el)+1})`);el=el.parentElement;
      }
      const component=e.target.closest?.('[data-component-link]')?.getAttribute('data-component-link');
      const supply=component?.startsWith('supply:')?component.slice(7):inventoryOpen?supplyUid:null;
      const panel=component==='supplies'||supply||inventoryOpen?'supplies':e.target.closest?.('.guide')?'guide':e.target.closest?.('.st')?'stats':settings?'settings':drawer;
      const url=new URL(location.href);url.hash=`ui=${encodeURIComponent(JSON.stringify({selector:parts.join(' > '),panel,piece:detail?.uid,supply}))}`;
      e.preventDefault();setLink(url.toString());
    };
    root.addEventListener('contextmenu',context);
    return ()=>root.removeEventListener('contextmenu',context);
  },[page,drawer,settings,detail,inventoryOpen,supplyUid]);
  useEffect(()=>{
    const focus=()=>{
      if(!location.hash.startsWith('#ui='))return;
      let target;try{target=JSON.parse(decodeURIComponent(location.hash.slice(4)));}catch{return;}
      if(target.panel==='supplies')openInventory((state?.supplies || []).some(supply=>supply.uid===target.supply)?target.supply:null);
      else if(target.panel==='guide')openGuide();else if(target.panel==='stats')openStats();
      else if(target.panel==='settings')setSettings(true);else if(target.panel)setDrawer(target.panel);
      const piece=state?.pieces.find(p=>p.uid===target.piece);if(piece && target.panel!=='supplies')openPiece(piece);
      const root=document.querySelector('.assault-presentation');
      const reveal=()=>{let el;try{el=root?.querySelector(target.selector);}catch{}if(!el)return false;
        el.scrollIntoView({block:'center'});el.focus?.({preventScroll:true});return true;};
      if(reveal())return;
      const observer=new MutationObserver(()=>{if(reveal())observer.disconnect();});
      observer.observe(root,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),2000);
    };
    focus();window.addEventListener('hashchange',focus);
    return ()=>window.removeEventListener('hashchange',focus);
  },[page,state?.runId]);
  useEffect(()=>{
    if(!state)return;
    // The phase line of the native ticker strip. It is a status line (`replaces`): the strip shows the phase the run is in
    // now at once, in place of the line on screen or queued for an earlier phase, instead of playing every phase passed
    // through one after the other (5.2 s each: the battle label came 16 s late). A phase without a label shows nothing.
    const text=t(PHASES[state.phase]||'');
    if(!text)return;
    const previous=store.get().ticker||[];
    store.set({ticker:[...previous.slice(-3),{id:Math.max(Date.now(),(previous.at(-1)?.id??0)+1),at:Date.now(),text,replaces:'assault-phase'}]});
  },[state?.phase]);
  useEffect(()=>{
    const key=e=>{
      if(document.querySelector('.modal,.guide,.st')||busy)return;
      const act=shortcutFor(e,settingsStore.get().keys);
      if(act==='escape'){
        if(summonPlacement){setSummonPlacement(null);e.preventDefault();return;}
        if(emoteOpen)setEmoteOpen(false);else if(inventoryOpen)closeInventory();else if(detail)onClose();else if(foreignDetail)setForeignDetail(null);else if(drawer)setDrawer(null);else if(pen)setPen(false);else return;
        e.preventDefault();return;
      }
      if(drawer||inventoryOpen||document.querySelector('.spov'))return;
      if(act==='ready'){
        if(state?.phase==='battle'&&session)onPause();
        else if(state?.phase==='battlePrep'&&battlePrepStatus(state,state.board).canStart)onAction('readyBattle');
        else if(state?.phase==='shop')onAction('finishShop');else return;
        e.preventDefault();e.target?.blur?.();
      }else if(act==='refresh'&&state?.phase==='shop'&&state.gold>=state.shop.refreshCost){
        e.preventDefault();
        const definition = catalog.design.system.shopDefinitions?.find(entry => entry.id === state.shop.id);
        if (Number.isInteger(definition?.maxRefreshes) && state.shop.refreshCount >= definition.maxRefreshes) toast(t('本次补给已刷新'), 'warn');
        else onAction('refreshShop');
      }
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[state,session,busy,detail,foreignDetail,drawer,pen,emoteOpen,inventoryOpen,summonPlacement]);
  useEffect(() => { audio.playBgm(bgmKeyFor(page === 'start' ? 'title' : page === 'ended' ? 'result' : 'game', state ? publicOf(state,catalog) : null,combatTrackFor(state?.day))); }, [page,state?.phase,state?.day,state?.currentNode?.encounterId]);
  useEffect(() => {
    if (!session?.battle) return;
    audio.setFieldUnits(session.field?.units);
    audio.sfx('battleStart');
  }, [session?.battle]);
  useEffect(() => {
    if (!session) { setFrame(null); settled.current = false; return; }
    if (readyBattle !== session.battle) return;
    let raf, previous = performance.now();
    const tick = now => {
      const dt = Math.min(.08, (now - previous) / 1000); previous = now;
      const next = runBattleFrame(session, dt, session.speed);
      if (next.events?.length) audio.handleBattleEvents(next.events);
      setFrame({ ...next, time: next.time || 0 });
      if (next.finished && !settled.current) {
        settled.current = true;
        const result = session.battle.result();
        const mine = result?.perPlayer?.assault;
        const charId = resultSpeaker(mine, Math.random, id => session.built.data.chess[id]?.charId ?? null);
        if (charId) audio.voice(charId, resultVoiceSlot({
          perfect: !!mine?.perfect,
          leaked: Array.isArray(mine?.leaked) ? mine.leaked.length : 0,
          killed: mine?.killed ?? result.killed,
          total: mine?.total ?? result.total,
          hard: !!session.battle.sharedBoss,
        }));
        onAction('battleFinished');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session,readyBattle]);
  const hud = frame?.snapshot || session?.battle?.snapshot?.() || null;
  if (page === 'loading') return html`<div class="screen gload"><${Spinner} size="lg" label=${t('正在载入进击')} /></div>`;
  const pub = state ? publicOf(state, catalog) : null;
  const priv = state ? { lp: state.life, alive: state.life > 0, ready: false } : null;
  const battle = state?.phase === 'battle';
  const prep = state?.phase === 'battlePrep';
  const encounter = encounterById(catalog, state?.currentNode?.encounterId);
  const pendingLife=(session?.battle?.players?.[0]?.leaked||[]).reduce((n,leak)=>n+Number(leak.lpr??1),0)
    +(session?.battle?.assaultOvertimeLoss||0);
  const liveLife={lp:state?.life,pending:pendingLife,unite:false,left:Math.max(0,(hud?.total||0)-(hud?.resolved||0))};
  const collectionSkills = projectCollectionSkills(catalog.design, state || {}).filter(skill => skill.owned).map(skill => ({
    ...skill, name: t(catalog.publicText?.collectibles?.[skill.id]?.name || skill.name),
    desc: t(catalog.publicText?.collectibles?.[skill.id]?.line || catalog.publicText?.collectibles?.[skill.id]?.description || skill.description),
    counter: skill.rank || null, icon: skill.iconSource.icon, iconKind: 'item',
  }));
  const collectionIcon = skill => skill.kind === 'ranked-skill' ? upgradeIcon(skill, skill.rank)
    : html`<${Img} src=${relicIcon(catalog, skill.id)} fallback=${html`<${GIcon} name="bolt" />`} />`;
  if(pub?.phase==='FINAL_ASSAULT'){
    pub.teamLp=Math.max(0,state.life-pendingLife);
    // Feed the native countdown / overtime warning a fixed simulation-clock epoch.
    pub.deadline=121000;pub.overtimeAt=151000;
  }
  const readyNode = prep ? html`<${Button} variant="primary" size="lg" disabled=${busy || !!summonPlacement || !battlePrepStatus(state,state.board).canStart}
    onClick=${() => onAction('readyBattle')}>${t('开始战斗')}<//>` : state?.phase === 'shop' ? html`<${Button} variant="primary" size="lg"
    disabled=${busy} onClick=${() => onAction('finishShop')}>${t('结束补给')}<//>` : html`<span></span>`;
  const presentation = { roundLabel: t('天 / 小时'), roundText: `${state?.day || 1} / ${state?.hour || 1}`,
    phaseNode: battle ? undefined : html`<div class="capsule">${state?.phase === 'skillChoice' ? t('战术') : state?.phase === 'shop'
      ? t(catalog.design.system.shopDefinitions?.find(shop => shop.id === state.shop?.id)?.name || PHASES.shop)
      : t(PHASES[state?.phase] || '')}</div>`, readyNode,
    timeNode: battle && session ? html`${pub?.phase==='FINAL_ASSAULT'
      ? html`<${Countdown} seconds=${Math.max(0,120-(frame?.time||0))} total=${120} size="md" />`
      : html`<span class="num">${Math.floor(frame?.time || 0)}s / ${session.maxSeconds}s</span>`}<${PauseButton} paused=${session.paused} onToggle=${onPause} />` : html`<span></span>` };
  return html`${page === 'start' ? html`<${NativeStart} catalog=${catalog} onStart=${onStart} onImport=${onImport} busy=${busy} resumeRunId=${resumeRunId} onResume=${onResume} />`
    : page === 'ended' ? html`<${NativeEnd} state=${state} catalog=${catalog} onRestart=${onRestart} onOpen=${openPiece} />`
    : state ? html`<div class=${`screen gm gm--${battle ? 'combat' : 'prep'}${collapsed ? ' is-collapsed' : ''}`}>
      ${state.board ? html`<${NativeAssaultField} state=${state} catalog=${catalog} field=${session?.field || state.board}
        inspection=${detail?{uid:detail.uid,mode:inspectionMode}:foreignDetail?.unitId!=null?{unitId:foreignDetail.unitId,mode:inspectionMode}:null} onInspectionClose=${()=>{onClose();setForeignDetail(null);}}
        onUnitDetail=${unit=>{onClose();setForeignDetail({type:'token',token:unit.def?.raw||catalog.nativeData.tokens?.[unit.defId]||{name:unit.name,stats:unit.base,rangeGrid:unit.rangeGrid},unitId:unit.id,ownerId:unit.ownerId});}}
        summonPlacement=${summonPlacement} onSummonPlacementEnd=${()=>setSummonPlacement(null)} battleSession=${session} battleFrame=${frame} onAction=${onAction} onOpen=${openPiece} pen=${pen}
        onReady=${setReadyBattle}
        onEnemyDetail=${(key,unitId)=>{
          const enemy=catalog.nativeData.enemies?.[key]||data.lookup('enemies',key)||catalog.nativeData.bosses?.[key];
          if(enemy){onClose();setForeignDetail({type:'enemy',enemy,unitId});}else setDrawer('enemies');
        }} onTerrainDetail=${d=>{onClose();setForeignDetail(d);}} shopOpen=${state.phase === 'shop' && !collapsed && !pen} />`
        : html`<div class="gm__field"></div>`}
      <div class="gm__vignette"></div><div class="gm__hud">
        <${GrowthStatus} state=${state} catalog=${catalog} />
        <${TopBar} pub=${pub} priv=${priv} conn=${connection} hud=${hud}
          frozenAt=${pub?.phase==='FINAL_ASSAULT'?1000+(frame?.time||0)*1000:null}
          onExit=${onRestart} drawer=${drawer} pen=${pen}
          onDrawer=${() => setDrawer('info')} onPen=${() => {setPen(p=>!p);onClose();}} penAvail=${!!encounter&&!battle}
          pause=${battle && session ? {show:true,paused:session.paused,onToggle:onPause} : null} live=${liveLife} config=${{lpCapPerRound:state.maxLife}} presentation=${presentation} />
        <${TeamPanel} pub=${pub} myId=${ME} bubbles=${new Map(bubble?[[ME,bubble]]:[])} self=${liveLife} cap=${state.maxLife} onWatch=${() => setDrawer('info')} />
        <${CollectionEffects} skills=${collectionSkills} renderIcon=${collectionIcon} battle=${battle}
          onEffect=${skill => { setStrategyFocus(skill.id); setDrawer('collections'); }} onMore=${() => setDrawer('collections')} />
        ${state.phase === 'shop' ? html`<${NativeShop} state=${state} catalog=${catalog} busy=${busy} onAction=${onAction} onOpen=${openPiece} onClose=${onClose}
          collapsed=${collapsed} onCollapse=${setCollapsed} inventoryOpen=${inventoryOpen} onInventoryClose=${closeInventory} />` : null}
        ${prep || battle ? html`<${DeployCount} state=${state} catalog=${catalog} />` : null}
        ${battle ? html`<${CombatHud} pub=${pub} myId=${ME} hud=${hud} client=${{progress:[]}} />
          <${BattleSpeedBar} speed=${(session?.speed || 1) * 2} onSpeed=${speed => onSpeed(speed / 2)} />` : null}
        <${Ticker} />
        <div class="gm__corner"><${EmoteWheel} open=${emoteOpen} onToggle=${setEmoteOpen} onSend=${id=>{setBubble({id,seq:Date.now(),at:Date.now()});audio.sfx('emote');}} />
          <button class="gm__gear" aria-label=${t('补给箱')} title=${t('补给箱')} aria-expanded=${inventoryOpen} data-component-link="supplies" onClick=${()=>inventoryOpen?closeInventory():openInventory()}><${Icon} name="robot" /></button>
           <button class="gm__gear" aria-label=${t('设置')} title=${t('设置')} onClick=${()=>setSettings(true)}><${GIcon} name="gear" /></button>
          <button class="gm__gear gm__guide" aria-label=${t('玩法说明')} title=${t('玩法说明')} onClick=${()=>openGuide()}><${Icon} name="book" /></button>
          <${FullscreenButton} class="gm__gear gm__fs" />${isEmbeddedView() ? html`<a class="btn btn--secondary btn--sm" href=${hrefForRun(state.runId)} target="_blank" rel="noopener">${t('全屏打开')}</a>` : null}</div>
      </div>
      ${battle && (!session || readyBattle !== session.battle) ? html`<div class="gm__loading"><${Spinner} size="lg" label=${t('正在载入进击')} /></div>` : null}
      <${NativeChoices} state=${state} catalog=${catalog} onAction=${onAction} busy=${busy} />
    </div>` : null}
    ${detail && state && !inventoryOpen ? html`<${NativePieceDetail} key=${detail.uid} piece=${detail} state=${state} catalog=${catalog} session=${session}
      inspectionMode=${inspectionMode} onInspectionMode=${setInspectionMode} onSummonPlacement=${beginSummonPlacement} onClose=${onClose} onAction=${onAction} busy=${busy} shopOpen=${state.phase==='shop'&&!collapsed} />` : null}
    ${foreignDetail && !inventoryOpen ? html`<${DetailPanel} detail=${foreignDetail} editable=${false} onClose=${()=>setForeignDetail(null)} side="right" shopOpen=${state?.phase==='shop'&&!collapsed}
      live=${session?.battle&&foreignDetail.unitId!=null?()=>{const u=session.battle.unitById?.(foreignDetail.unitId);return u?{...unitStatsEntry(u,u._s),src:'battle'}:null;}:null} />`:null}
    ${inventoryOpen && state ? html`<${NativeSupplyInventory} state=${state} catalog=${catalog} selectedUid=${supplyUid} onSelect=${setSupplyUid}
      onClose=${closeInventory} onAction=${onAction} busy=${busy} shopOpen=${state.phase==='shop'&&!collapsed} />` : null}
    <${Modal} open=${!!drawer} title=${drawer === 'enemies' ? t('敌方情报') : drawer === 'collections' ? t('收藏品技能') : t('本局信息')} onClose=${() => setDrawer(null)}
      actions=${html`<${Button} onClick=${onExport}>${t('导出存档')}<//><${Button} onClick=${onImport}>${t('导入存档')}<//>`}>
      ${drawer === 'enemies' ? html`<h3>${displayEncounterTitle(encounter?.name || '')}</h3><p>${encounter?.description || ''}</p>
        ${enemyIntelRows(encounter?.wave?.spawns || encounter?.spawnRefs || []).map(({ s, count }) => html`<p>${count} ×${catalog.nativeData.enemies?.[s.enemyKey || s.key]?.name || catalog.nativeData.bosses?.[s.bossId]?.name || t('敌人')}</p>`)}`
        : state ? html`${drawer !== 'collections' ? html`<p>${t('金币')} ${state.gold} · ${t('经验')} ${state.xp} · ${t('人口')} ${activePopulation(state)}/${activePieceLimit(state,{design:catalog.design})}</p>
          <div class="assault-actions">${state.pieces.map(p => html`<${Button} onClick=${() => {setDrawer(null);openPiece(p);}}><${UnitThumb} id=${p.charId} tier=${p.star} size="xs" />${p.name}<//>`)}</div>
          <${Button} onClick=${()=>{setDrawer(null);openStats('assault-ledger');}}>${t('本场账本')}<//>
          <${Button} onClick=${()=>setDrawer('collections')}>${t('收藏品技能')} · ${collectionSkills.length}<//>` : html`<div class="assault-collection-grid">
            ${[...collectionSkills].sort((a,b) => Number(b.id === strategyFocus) - Number(a.id === strategyFocus)).map(skill => html`<div class="dmodule" key=${skill.id}>
              <div class="dskill"><span class="assault-collection-icon">${collectionIcon(skill)}</span><b>${skill.name}</b>${skill.rank ? html`<${TierChip} tier=${skill.rank} size="sm" />` : null}</div>
              <${RichText} text=${skill.desc} class="dtext" />
            </div>`)}
          </div>`}` : null}
    <//>
    <${SettingsModal} open=${settings} hotkeyActions=${['refresh','retreat','sell','ready']} onClose=${() => setSettings(false)} />
    <${Modal} open=${!!link} title=${t('复制此处链接')} onClose=${()=>setLink(null)}
      actions=${html`<${Button} icon="copy" onClick=${async()=>{await copyText(link);setLink(null);toast(t('已复制链接'),'success');}}>${t('复制链接')}<//>`}><p>${link}</p><//>
    <${Modal} open=${!!error} title=${t('操作未完成')} onClose=${() => onAction('clearError')} actions=${pending ? html`<${Button} onClick=${onRetry}>${t('重试')}<//>` : null}><p>${error}</p><//>
    <${GuideHost} presentation=${guidePresentation} /><${StatsHost} presentation=${statsPresentation(catalog,state)} />
    <${UiHosts} /><${ToastHost} />`;
}
