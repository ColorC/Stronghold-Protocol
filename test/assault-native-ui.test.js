import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// The browser hook module is replaced with deterministic, per-component hook slots so these real components can
// render to a VNode tree in Node without a browser or installed SSR package. Vendor imports still use the sparse
// worktree's canonical-public loader supplied on the test command line.
const mockHooks = `
const ctx = globalThis.__assaultNativeUiHooks ||= { frames: [], values: new Map() };
function slot(initial) {
  const frame = ctx.frames[ctx.frames.length - 1];
  if (!frame) throw new Error('hook called outside a rendered component');
  const key = frame.id + ':' + frame.index++;
  if (!ctx.values.has(key)) ctx.values.set(key, typeof initial === 'function' ? initial() : initial);
  return [key, ctx.values.get(key)];
}
export function useState(initial) { const [key, value] = slot(initial); return [value, next => ctx.values.set(key, typeof next === 'function' ? next(ctx.values.get(key)) : next)]; }
export function useReducer(reducer, initial, init) { const [value, set] = useState(() => init ? init(initial) : initial); return [value, action => set(current => reducer(current, action))]; }
export function useRef(initial) { const [value] = useState(() => ({ current: initial })); return value; }
export function useMemo(fn) { return fn(); }
export function useCallback(fn) { return fn; }
export function useContext(context) { return context?._defaultValue; }
export function useEffect() {}
export const useLayoutEffect = useEffect;
`;
const hookUrl = `data:text/javascript,${encodeURIComponent(mockHooks)}`;
const loader = `
const hookUrl = ${JSON.stringify(hookUrl)};
export async function resolve(specifier, context, nextResolve) {
  try {
    const target = new URL(specifier, context.parentURL);
    if (target.protocol === 'file:' && target.pathname.toLowerCase().endsWith('/public/vendor/hooks.module.js'))
      return { url: hookUrl, shortCircuit: true };
  } catch {}
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, { parentURL: import.meta.url });

const [{ AssaultUI, presentationRecord }, { ShopBar, ChessCard, PriceHex }, { TopBar, CheckBtn },
  { DetailPanel, ChessDetail, Section, CHESS_SECTIONS }, { TitleScreen }, { ResultView }, { ChoiceView, ChoiceOverlay, cardPickable }, { data }, { TierChip },
  { nativePrepView, fieldMountFailureMessage, withFieldMountTimeout }] = await Promise.all([
  import('../public/js/assault/ui.js'), import('../public/js/ui/shopBar.js'), import('../public/js/ui/hud.js'),
  import('../public/js/ui/detailPanel.js'), import('../public/js/screens/title.js'), import('../public/js/screens/result.js'),
  import('../public/js/ui/choiceOverlay.js'), import('../public/js/data.js'), import('../public/js/ui/components.js'),
  import('../public/js/assault/field.js'),
]);
const { fmtNum } = await import('../public/js/ui/gameLogic.js');
const { Button, Modal } = await import('../public/js/ui/components.js');
const { eventBackground } = await import('../public/js/assault/choiceVisuals.js');
const { stablePrepView, createPieceUidMap, PHASES } = await import('../public/js/assault/model.js');
const { currentStarText, strategySkillText } = await import('../public/js/assault/mechanicsView.js');

const hookContext = globalThis.__assaultNativeUiHooks;
function invoke(component, props = {}, id = 'component') {
  const frame = { id, index: 0 };
  hookContext.frames.push(frame);
  try { return component(props); } finally { hookContext.frames.pop(); }
}
function* walk(value) {
  if (Array.isArray(value)) { for (const item of value) yield* walk(item); return; }
  if (!value || typeof value !== 'object' || !('type' in value)) return;
  yield value;
  yield* walk(value.props?.children);
}
function find(value, predicate) { return [...walk(value)].find(predicate) || null; }
function cls(node) { return typeof node?.props?.class === 'string' ? node.props.class : ''; }
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value !== 'object' || !('type' in value)) return '';
  return text(value.props?.children);
}
function resetHooks() { hookContext.values.clear(); }

const runtime = {
  bodies: { op: {
    charId: 'op', name: '巡林者', profession: 'WARRIOR', position: 'MELEE', subProfessionName: '先锋',
    starStats: [1, 2, 3, 4].map(star => ({ star, stats: { maxHp: 1000 + star * 250, atk: 100 + star * 50,
      def: 80 + star * 30, res: 0, bat: 1.2, aspd: 100, blockCnt: 1, cost: 10, respawnTime: 70 } })),
    simChess: { profession: 'WARRIOR', position: 'MELEE', skill: { skillId: 'fixed-skill', index: 0, name: '固定战技',
      desc: '固定技能说明', descRaw: '固定技能说明', spType: 'INCREASE_WITH_TIME', skillType: 'AUTO', initSp: 2, spCost: 5 },
      trait: { desc: '当前记录特性' } },
    fixedSkill: { name: '固定战技', kind: 'active', sourceSkillId: 'fixed-skill', description: '主技能效果原文。',
      effects: [{ description: '主技能摘要。' }],
      spType: 'INCREASE_WITH_TIME', spCost: [5, 5, 5, 5], initSp: [2, 2, 2, 2] },
    source: { phase: 2, level: 90, interpolatedAttributes: { maxHp: 6400, atk: 710, def: 350, magicResistance: 20,
      baseAttackTime: 1.2, attackSpeed: 110, blockCnt: 2, cost: 18, respawnTime: 70 } },
    modePassives: [{ trigger: '进场时', description: '进击被动一完整说明。' }, { trigger: '击败敌人时', description: '进击被动二完整说明。' }],
    talentBindings: [{ nativeTalent: { name: '空槽位' }, translation: { name: '空槽位', description: '没有额外效果', mode: 'disabled' } }],
  } },
  operators: { op: { charId: 'op', name: '巡林者', price: 10 } },
};
const design = { collectibles: { items: [] }, system: { run: { days: 10, xpThresholds: [10, 20, 30] }, directors: [], strategySkills: [] } };
const catalog = { runtime, design, nativeData: { chess: {}, assets: {} }, publicText: { operators: { op: { name: '巡林者', role: '先锋',
  skill: { name: '固定战技', description: '主技能完整说明。' },
  modePassives: [{ name: '进击被动一', trigger: '进场时', summary: '首屏被动摘要一。', description: '进击被动一完整说明。' },
    { name: '进击被动二', trigger: '击败敌人时', summary: '首屏被动摘要二。', description: '进击被动二完整说明。' }],
  original: { trait: '原作特性描述。', skills: [{ name: '原作技能S3', description: '原作技能满级效果。' }],
    talents: [{ name: '原作天赋', description: '原作天赋效果。' }] },
  talents: [] } } }, assets: {} };
const slot = { slotId: 'offer-1', charId: 'op', purchaseCharId: 'op', star: 3, requiredCopies: 4, price: 7 };
const state = (gold = 10) => ({ runId: 'run-test', phase: 'shop', day: 2, hour: 1, xp: 0, tech: 1, gold, life: 20,
  maxLife: 20, pieces: [{ uid: 'owned-1', charId: 'op', purchaseCharId: 'op', star: 1, sourceCopies: 1, row: null, col: null }],
  shop: { slots: [slot], refreshCost: 2 }, relics: [], history: [], board: null });
const callbacks = { onAction() {}, onOpen() {}, onClose() {}, onStart() {}, onImport() {}, onExport() {}, onRestart() {}, onRetry() {}, onSpeed() {}, onPause() {} };
for (const name of ['config', 'assets', 'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses', 'stages', 'tokens', 'choices', 'effects', 'garrisons', 'factions', 'local', 'backups']) {
  data.setData(name, name === 'config' ? { titles: [] } : {});
}

test('assault main composes native ShopBar with real star, copy progress, price and two-tap purchase', () => {
  resetHooks();
  const upgradeState = state(10);
  upgradeState.pieces[0] = { ...upgradeState.pieces[0], star: 3, sourceCopies: 4 };
  upgradeState.shop = { ...upgradeState.shop, id: 'test-shop', refreshCount: 1 };
  const shopCatalog = { ...catalog, design: { ...design, system: { ...design.system,
    shopDefinitions: [{ id: 'test-shop', maxRefreshes: 1 }] } } };
  const app = invoke(AssaultUI, { catalog: shopCatalog, state: upgradeState, page: 'run', session: null, detail: null, busy: false, error: null, pending: null, ...callbacks }, 'assault-app');
  const shopNode = find(app, node => node.type?.name === 'NativeShop');
  assert.ok(shopNode, 'shop phase routes through NativeShop');
  const native = invoke(shopNode.type, shopNode.props, 'native-shop');
  const barNode = find(native, node => node.type === ShopBar);
  assert.ok(barNode);
  const presentation = barNode.props.presentation;
  assert.equal(presentation.freezeAvailable, false);
  assert.equal(presentation.hideItemSlot, true);
  assert.equal(presentation.progress(slot).copies, 4);
  assert.equal(presentation.progress(slot).need, 8);
  assert.match(presentation.mergeHint(slot), /4 星/);
  assert.equal(presentation.refreshReason, '本次补给已刷新');
  const record = presentation.record(slot);
  assert.equal(record.tier, 3);
  assert.equal(record.stats.maxHp, 1750);

  let bought = 0;
  let opened = 0;
  const barProps = { ...barNode.props, onBuy: () => { bought += 1; }, onDetail: () => { opened += 1; } };
  const bar1 = invoke(ShopBar, barProps, 'native-shop-bar');
  const card1 = find(bar1, node => node.type === ChessCard);
  assert.ok(card1);
  const renderedCard = invoke(ChessCard, card1.props, 'native-shop-card');
  assert.equal(renderedCard.type, 'button');
  assert.ok(!cls(renderedCard).includes('is-disabled'));
  const tier = find(renderedCard, node => node.type === TierChip);
  const price = find(renderedCard, node => node.type === PriceHex);
  assert.equal(tier.props.tier, 3, 'the visible star chip uses the real Assault record tier');
  assert.equal(price.props.slot.price, 7, 'the visible price uses the Assault offer slot');

  card1.props.onTap(0);
  assert.equal(opened, 1, 'first tap opens native detail');
  assert.equal(bought, 0, 'first tap does not buy');
  const bar2 = invoke(ShopBar, barProps, 'native-shop-bar');
  const card2 = find(bar2, node => node.type === ChessCard);
  assert.equal(card2.props.armed, true, 'the native shop preserves its armed state between taps');
  card2.props.onTap(0);
  assert.equal(bought, 1, 'second tap buys through ShopBar onBuy');
});

test('strategy shop keeps native ShopBar cards, shows rank-specific effects, and dispatches buySkill', () => {
  resetHooks();
  const skills = ['a', 'b', 'c'].map(id => ({ id: `strategy_${id}`, name: `战术${id.toUpperCase()}`,
    description: '每次触发获得1/2点攻击。', startingStar: 3, prices: [5, 10, 20, 40], icon: { kind: 'stat', name: 'atk' } }));
  const shopState = { ...state(40), skillRanks: { strategy_a: 3 }, shop: { kind: 'skill', refreshCost: 2,
    slots: skills.map((skill, index) => ({ slotId: `skill-${index}`, kind: 'skill', skillId: skill.id, name: skill.name, star: 4, price: 20 })) } };
  const shopCatalog = { ...catalog, design: { ...design, system: { ...design.system, strategySkills: skills } } };
  const actions = [];
  const app = invoke(AssaultUI, { catalog: shopCatalog, state: shopState, page: 'run', session: null, detail: null,
    busy: false, error: null, pending: null, ...callbacks, onAction: (...action) => actions.push(action) }, 'strategy-shop-app');
  const shopNode = find(app, node => node.type?.name === 'NativeShop');
  const native = invoke(shopNode.type, shopNode.props, 'strategy-native-shop');
  const barNode = find(native, node => node.type === ShopBar);
  const barProps = barNode.props;
  const first = invoke(ShopBar, barProps, 'strategy-native-shop-bar');
  const cards = [...walk(first)].filter(node => node.type === 'button' && cls(node).includes('scard--item'));
  assert.equal(cards.length, 3, 'three independent tactics occupy native shop slots');
  assert.ok(!find(cards[0], node => node.type?.name === 'RichText'),
    'long effects stay in the detail instead of being flattened onto shop cards');
  assert.match(text(cards[0]), /战术/);
  assert.ok(find(cards[0], node => node.type === TierChip && node.props.tier === 4));
  assert.ok(find(cards[0], node => node.type === PriceHex && node.props.slot.price === 20));
  cards[0].props.onClick();
  let specialDetail = find(invoke(shopNode.type, shopNode.props, 'strategy-native-shop'), node => node.type === 'aside' && cls(node).includes('is-shop'));
  assert.ok(specialDetail, 'the first card tap opens the complete tactic offer detail');
  const rankChips = [...walk(specialDetail)].filter(node => node.type === TierChip);
  assert.deepEqual(rankChips.map(node => node.props.tier), [3, 4], 'owned rank advances one tier visually');
  const armed = invoke(ShopBar, barProps, 'strategy-native-shop-bar');
  [...walk(armed)].find(node => node.type === 'button' && cls(node).includes('scard--item')).props.onClick();
  assert.deepEqual(actions, [['buySkill', { slotId: 'skill-0' }]]);
  const firstOwned = { ...shopState, skillRanks: {} };
  const unownedApp = invoke(AssaultUI, { ...shopNode.props, state: firstOwned }, 'strategy-unowned-app');
  const unownedShop = find(unownedApp, node => node.type?.name === 'NativeShop');
  const unownedTree = invoke(unownedShop.type, unownedShop.props, 'strategy-unowned-native-shop');
  const unownedBar = invoke(ShopBar, find(unownedTree, node => node.type === ShopBar).props, 'strategy-unowned-bar');
  find(unownedBar, node => node.type === 'button' && cls(node).includes('scard--item')).props.onClick();
  const unownedDetail = find(invoke(unownedShop.type, unownedShop.props, 'strategy-unowned-native-shop'), node => node.type === 'aside' && cls(node).includes('is-shop'));
  assert.deepEqual([...walk(unownedDetail)].filter(node => node.type === TierChip).map(node => node.props.tier), [4]);
  assert.equal(strategySkillText({ startingStar: 3, description: '效果1/2。' }, 3), '效果1。');
  assert.equal(strategySkillText({ startingStar: 3, description: '效果1/2。' }, 4), '效果2。');
});

test('enchantment shop requires a visible eligible target and keeps the old-to-new choice in the shop detail', () => {
  resetHooks();
  const enchants = [{ id: 'new-enchant', name: '新强化', description: '触发时获得10/20/30/40点屏障。', price: 8,
    eligibility: 'any', icon: { kind: 'stat', name: 'def' } }, { id: 'old-enchant', name: '旧强化', description: '旧效果。', price: 8,
    eligibility: 'any', icon: { kind: 'stat', name: 'atk' } }];
  const shopState = { ...state(20), pieces: [{ ...state().pieces[0], star: 2, name: '巡林者', enchantmentId: 'old-enchant' }],
    shop: { kind: 'enchantment', refreshCost: 2, slots: [{ slotId: 'enchant-1', kind: 'enchantment',
      enchantmentId: 'new-enchant', name: '新强化', star: 2, price: 8 }] } };
  const shopCatalog = { ...catalog, design: { ...design, system: { ...design.system, enchantments: enchants } } };
  const actions = [];
  const props = { catalog: shopCatalog, state: shopState, page: 'run', session: null, detail: null, busy: false,
    error: null, pending: null, ...callbacks, onAction: (...action) => actions.push(action) };
  const app = invoke(AssaultUI, props, 'enchant-shop-app');
  const shopNode = find(app, node => node.type?.name === 'NativeShop');
  const renderShop = () => invoke(shopNode.type, shopNode.props, 'enchant-native-shop');
  let native = renderShop();
  let barNode = find(native, node => node.type === ShopBar);
  let bar = invoke(ShopBar, barNode.props, 'enchant-native-shop-bar');
  find(bar, node => node.type === 'button' && cls(node).includes('scard--item')).props.onClick();
  native = renderShop();
  assert.ok(find(native, node => node.type === 'aside' && cls(node).includes('is-shop')), 'first enchant tap opens the offer details');
  assert.deepEqual(actions, [], 'opening the offer never purchases without a chosen target');
  barNode = find(native, node => node.type === ShopBar);
  bar = invoke(ShopBar, barNode.props, 'enchant-native-shop-bar');
  find(bar, node => node.type === 'button' && cls(node).includes('scard--item')).props.onClick();
  native = renderShop();
  barNode = find(native, node => node.type === ShopBar);
  bar = invoke(ShopBar, barNode.props, 'enchant-native-shop-bar');
  find(bar, node => node.type === 'button' && cls(node).includes('scard--item')).props.onClick();
  native = renderShop();
  const aside = find(native, node => node.type === 'aside' && cls(node).includes('dpanel--right') && cls(node).includes('is-shop'));
  assert.ok(aside, 'the offer details inherit native right-side shop clearance');
  assert.ok(text(aside).includes('旧强化 → 新强化'), 'replacing an existing enchantment is explicit');
  const targetButton = find(aside, node => node.type === Button && text(node).includes('巡林者'));
  assert.ok(targetButton, 'the player must select an Operator');
  targetButton.props.onClick();
  native = renderShop();
  assert.ok([...walk(native)].some(node => node.type?.name === 'RichText' && node.props.text.includes('20点屏障')),
    'the selected Operator preview uses its current star value');
  const confirm = find(native, node => node.type === Button && text(node).includes('确认强化'));
  assert.equal(confirm.props.disabled, false);
  confirm.props.onClick();
  assert.deepEqual(actions, [['enchantPiece', { slotId: 'enchant-1', uid: 'owned-1' }]]);
});

test('ranked collection skills share one native effect list and open the complete current-tier card view', () => {
  resetHooks();
  const skills = [{ id: 'strategy_focus', name: '战术聚焦', description: '获得5/10/15/20点攻击。', startingStar: 1 }];
  const appProps = { catalog: { ...catalog, design: { ...design, system: { ...design.system, strategySkills: skills } } },
    state: { ...state(), phase: 'battlePrep', skillRanks: { strategy_focus: 4 } }, page: 'run', session: null, detail: null,
    busy: false, error: null, pending: null, ...callbacks, onAction: () => {} };
  const app = invoke(AssaultUI, appProps, 'strategy-effects-app');
  const lists = [...walk(app)].filter(node => node.type?.name === 'EffectsList');
  assert.equal(lists.length, 1, 'collectibles and ranked skills use the same native list');
  const tactics = invoke(lists[0].type, lists[0].props, 'strategy-effects-list');
  const icon = find(tactics, node => cls(node).includes('effect--item'));
  assert.equal(icon.props.role, 'button');
  assert.equal(icon.props.tabIndex, 0, 'the strategy icon is keyboard/touch reachable');
  icon.props.onClick();
  const reopened = invoke(AssaultUI, appProps, 'strategy-effects-app');
  const info = find(reopened, node => node.type === Modal && node.props.title === '收藏品技能');
  assert.ok(info);
  assert.ok(text(info).includes('战术聚焦'));
  assert.ok([...walk(info)].some(node => node.type?.name === 'RichText' && node.props.text.includes('获得20点攻击。')),
    'the information view shows the full current-rank effect');
});

test('assault affordability disables the native shop card and assault emits native TopBar controls', () => {
  resetHooks();
  const app = invoke(AssaultUI, { catalog, state: state(0), page: 'run', session: null, detail: null, busy: false, error: null, pending: null, ...callbacks }, 'assault-app-disabled');
  const shopNode = find(app, node => node.type?.name === 'NativeShop');
  const native = invoke(shopNode.type, shopNode.props, 'native-shop-disabled');
  const barNode = find(native, node => node.type === ShopBar);
  const bar = invoke(ShopBar, barNode.props, 'native-shop-bar-disabled');
  const card = find(bar, node => node.type === ChessCard);
  assert.equal(card.props.reason, '资金不足');
  const disabledCard = invoke(ChessCard, card.props, 'disabled-card');
  assert.ok(cls(find(disabledCard, node => node.type === 'button')).includes('is-disabled'));
  let refused = null;
  let blockedBuys = 0;
  const disabledProps = { ...barNode.props, onRefuse: reason => { refused = reason; }, onBuy: () => { blockedBuys += 1; } };
  const disabledFirst = invoke(ShopBar, disabledProps, 'native-shop-bar-blocked');
  find(disabledFirst, node => node.type === ChessCard).props.onTap(0);
  const disabledSecond = invoke(ShopBar, disabledProps, 'native-shop-bar-blocked');
  find(disabledSecond, node => node.type === ChessCard).props.onTap(0);
  assert.equal(refused, '资金不足');
  assert.equal(blockedBuys, 0, 'an unaffordable second tap never calls onBuy');

  const top = find(app, node => node.type === TopBar);
  assert.ok(top);
  assert.equal(top.props.presentation.roundLabel, '天 / 小时');
  assert.equal(top.props.presentation.roundText, '2 / 1');
  assert.ok(top.props.presentation.readyNode);
  const nativeTop = invoke(TopBar, { ...top.props, pen: false, penAvail: true }, 'native-topbar');
  const phase = find(nativeTop, node => cls(node).includes('capsule'));
  assert.ok(phase, 'Assault phase replaces the Alliance phase capsule');
  const checks = [...walk(nativeTop)].filter(node => node.type === CheckBtn);
  assert.equal(checks.length, 2, 'native left and right check controls remain mounted');
  let penTarget = null;
  const nativeTop2 = invoke(TopBar, { ...top.props, pen: false, penAvail: true, onPen: value => { penTarget = value; } }, 'native-topbar-pen2');
  const rightCheck = [...walk(nativeTop2)].filter(node => node.type === CheckBtn)[1];
  rightCheck.props.onClick();
  assert.equal(penTarget, true, 'native enemy check continues to call the existing onPen handler');
});

test('native DetailPanel renders Assault star stats and fixed skill with its Section module override', () => {
  resetHooks();
  const piece = { uid: 'owned-elite', charId: 'op', purchaseCharId: 'op', star: 4, sourceCopies: 4, row: null, col: null, dir: 'E' };
  const chess = presentationRecord(catalog, piece);
  const resolvedLoadout = { record: chess, skill: chess.skill, defaultSkill: true, choices: 1 };
  const moduleSection = invoke(Section, { title: '模组', micro: 'MODULE', children: { type: 'div', props: {
    class: 'dmodule', 'data-module': 'assault-module', children: '进击模组' } } }, 'assault-module-section');
  const overrides = { module: moduleSection };
  const panel = invoke(DetailPanel, { detail: { type: 'chess', chess, piece: { ...piece, kind: 'chess', golden: true }, resolvedLoadout },
    editable: true, snapHp: null, onClose() {}, onSell() {}, onDestroy() {}, voice: false, overrides }, 'native-detail-panel');
  const detailNode = find(panel, node => node.type === ChessDetail);
  assert.ok(detailNode);
  assert.equal(detailNode.props.resolvedLoadout, resolvedLoadout);
  const detail = invoke(ChessDetail, detailNode.props, 'native-chess-detail');
  assert.ok(find(detail, node => node.type === TierChip && node.props.tier === 4), 'the header shows the four-star Assault record');
  const stats = find(detail, node => node.props?.class?.includes?.('dstats-wrap'));
  assert.ok(stats);
  assert.ok([...walk(stats)].some(node => node.props?.k === '生命上限' && node.props?.v === fmtNum(2000)), 'visible stats use the star-four sim record');
  assert.ok([...walk(detail)].some(node => node.props?.['data-skill'] === 'fixed-skill'), 'detail uses the fixed sim skill');
  assert.ok([...walk(detail)].some(node => node.props?.['data-module'] === 'assault-module'), 'DetailPanel applies the native Section override for the Assault module');
});

test('Assault renderer mount cancellation disposes a late view and ignores its obsolete result', async () => {
  const controller = new AbortController();
  let finishMount;
  let disposed = 0;
  const pending = new Promise(resolve => { finishMount = resolve; });
  const result = withFieldMountTimeout(pending, controller, 'fixture renderer', view => view.destroy()).catch(error => error);
  const cancelled = new DOMException('superseded', 'AbortError');
  controller.abort(cancelled);
  assert.equal(await result, cancelled);
  finishMount({ destroy() { disposed += 1; } });
  await Promise.resolve();
  assert.equal(disposed, 1, 'late renderer is destroyed after cancellation');
});

test('Assault renderer failures show player-facing retry copy while retaining the technical error in diagnostics', () => {
  const original = console.error;
  const diagnostics = [];
  console.error = (...args) => diagnostics.push(args);
  try {
    const error = new Error('Assault renderer imports timed out');
    assert.equal(fieldMountFailureMessage(error), '操作没有完成，请检查当前局面后重试。');
    assert.deepEqual(diagnostics, [['[Assault] field renderer mount failed', error]]);
  } finally { console.error = original; }
});

test('Assault operator detail separates mechanics from original data and preserves Alliance default section order', () => {
  resetHooks();
  const actions = [];
  const owned = { ...state().pieces[0], star: 3 };
  const runState = { ...state(), phase: 'shop' };
  const app = invoke(AssaultUI, { catalog, state: runState, page: 'run', session: null, detail: owned,
    busy: false, error: null, pending: null, ...callbacks,
    onAction: (kind, payload) => actions.push({ kind, payload }) }, 'assault-mechanics-app');
  const nativeNode = find(app, n => n.type?.name === 'NativePieceDetail');
  assert.ok(nativeNode);
  let native = invoke(nativeNode.type, nativeNode.props, 'assault-mechanics-piece');
  let panelNode = find(native, n => n.type === DetailPanel);
  assert.deepEqual(panelNode.props.sectionOrder, ['head', 'assaultTabs', 'assaultMechanics', 'module', 'actions']);
  let panel = invoke(DetailPanel, panelNode.props, 'assault-mechanics-panel');
  let chessNode = find(panel, n => n.type === ChessDetail);
  let detail = invoke(ChessDetail, chessNode.props, 'assault-mechanics-chess');
  assert.ok(find(detail, n => cls(n).includes('assault-mechanics-columns')));
  assert.ok(find(detail, n => n.props?.text === '主技能摘要。'), 'the primary skill summary is visible on the first page');
  assert.ok(find(detail, n => n.props?.text === '首屏被动摘要一。') && find(detail, n => n.props?.text === '首屏被动摘要二。'),
    'every passive summary is visible on the first page');
  assert.ok(!find(detail, n => cls(n).includes('dtrait')), 'native trait is deferred to page two');
  assert.ok(!find(detail, n => cls(n).includes('dstats-wrap')), 'native stats are deferred to page two');
  assert.ok(!text(detail).includes('原作技能S3') && !text(detail).includes('原作天赋'), 'original content is deferred to page two');
  assert.ok(!text(detail).includes('空槽位') && !text(detail).includes('没有额外效果'), 'empty native talent slots stay hidden');
  assert.ok(find(detail, n => n.type === Section && n.props.title === '自动技能'), 'the automatic cast keeps the native Skill Section');
  assert.ok(find(detail, n => n.type === Section && n.props.title === '进击联动'), 'passives keep native talent section structure');
  assert.ok(find(detail, n => n.props?.class === 'dtext assault-role-detail' && n.type?.name === 'RichText'),
    'the concise mode role remains inside the operator detail');

  const originalTab = find(panelNode.props.overrides.assaultTabs, n => n.type === Button && text(n).includes('属性与原作'));
  assert.ok(originalTab);
  originalTab.props.onClick();
  native = invoke(nativeNode.type, nativeNode.props, 'assault-mechanics-piece');
  panelNode = find(native, n => n.type === DetailPanel);
  assert.deepEqual(panelNode.props.sectionOrder, ['head', 'assaultTabs', 'trait', 'stats', 'originalStats', 'skill', 'talents', 'actions']);
  panel = invoke(DetailPanel, panelNode.props, 'assault-original-panel');
  chessNode = find(panel, n => n.type === ChessDetail);
  detail = invoke(ChessDetail, chessNode.props, 'assault-original-chess');
  assert.ok(find(detail, n => n.type === Section && n.props.title === '原作特性'), 'page two labels the source trait accurately');
  assert.ok(find(detail, n => cls(n).includes('dtrait')), 'page two shows the source trait in the native trait container');
  assert.ok(find(detail, n => n.type === Section && n.props.title === '进击属性'), 'page two retains current Assault stats');
  const originalStats = find(detail, n => n.type === Section && String(n.props.title).startsWith('原作属性'));
  assert.ok(originalStats, 'page two adds source attributes separately');
  const currentAtk = find(find(detail, n => n.type === Section && n.props.title === '进击属性'), n => n.props?.k === '攻击');
  const sourceAtk = find(originalStats, n => n.props?.k === '攻击');
  assert.equal(currentAtk.props.v, fmtNum(250), 'current three-star sim attack remains 250');
  assert.equal(sourceAtk.props.v, fmtNum(710), 'source elite level 90 attack remains 710');
  assert.ok(find(detail, n => n.type === Section && n.props.title === '原作技能（满级）'));
  assert.ok(find(detail, n => n.type === Section && n.props.title === '天赋'));
  assert.ok(find(detail, n => n.props?.text === '原作技能满级效果。') && find(detail, n => n.props?.text === '原作天赋效果。'));
  assert.ok(!find(detail, n => n.props?.['data-skill'] === 'fixed-skill'),
    'an original-data page never labels the Assault fixed skill as original');
  assert.deepEqual(actions, [], 'switching pages does not dispatch a game action');

  assert.deepEqual(CHESS_SECTIONS, ['head', 'garrison', 'trait', 'stats', 'skill', 'module', 'equip', 'talents', 'actions']);
  const alliance = invoke(ChessDetail, { chess: presentationRecord(catalog, owned), piece: null, editable: false,
    onSell() {}, bonds: [], resolvedLoadout: { skill: presentationRecord(catalog, owned).skill,
      record: presentationRecord(catalog, owned), defaultSkill: true, choices: 1 } }, 'alliance-default-order');
  const direct = Array.isArray(alliance) ? alliance : [alliance];
  const visible = direct.map((node, index) => {
    if (cls(node).includes('dhead')) return ['head', index];
    if (cls(node).includes('dtrait')) return ['trait', index];
    if (cls(node).includes('dstats-wrap')) return ['stats', index];
    if (node.type === Section && node.props.title === '技能') return ['skill', index];
    return null;
  }).filter(Boolean);
  assert.deepEqual(visible.map(([name]) => name), ['head', 'trait', 'stats', 'skill'],
    'Alliance detail keeps the default order when no sectionOrder is supplied');
  assert.equal(currentStarText('-8%/10%/12%/15%', 2), '-10%');
  assert.equal(currentStarText('10/20/30/40%', 2), '20%');
  assert.equal(currentStarText('0.5/0.7/1.0/1.2秒', 4), '1.2秒');
});

test('data.setData creates ready page-local data, indexes it and notifies native UI subscribers', async () => {
  const name = 'assault-native-test';
  const value = [{ id: 'unit-a', name: '巡林者' }];
  const events = [];
  const unsubscribe = data.subscribe(changed => events.push(changed));
  const promise = data.setData(name, value);
  assert.equal(data.status(name), 'ready');
  assert.equal(data.lookup(name, 'unit-a').name, '巡林者');
  assert.equal(await promise, value);
  assert.deepEqual(events, [name]);
  unsubscribe();
});

test('native title and result keep Alliance defaults when no presentation is supplied', () => {
  resetHooks();
  const title = invoke(TitleScreen, {}, 'default-title');
  const titleHeading = find(title, node => node.type === 'h1' && cls(node).includes('title-cn'));
  assert.ok(titleHeading);
  assert.ok(text(titleHeading).includes('盟约'));
  assert.ok(find(title, node => node.type === 'a' && text(node).includes('卫戍协议：工坊')));

  const result = invoke(ResultView, { res: { victory: true, roundsPassed: 2, lastRound: 10, players: [] }, backLabel: '返回大厅', onBack() {}, quiet: true }, 'default-result');
  assert.ok(find(result, node => node.type === 'h1' && text(node).includes('模拟完成')));
  assert.ok(find(result, node => node.type === 'span' && text(node) === '同盟成员'));
  assert.ok(find(result, node => text(node) === 'ALLIANCE REPORT'));
});

test('unowned shop preview detail buys its live slot at the shown price and respects native disabled states', () => {
  const preview = { uid: 'shop:offer-1', charId: 'op', purchaseCharId: 'op', star: 3, sourceCopies: 3,
    row: null, col: null, dir: 'E' };
  const renderDetail = ({ gameState = state(10), busy = false, piece = preview } = {}) => {
    resetHooks();
    const app = invoke(AssaultUI, { catalog, state: gameState, page: 'run', detail: piece, session: null, busy,
      error: null, pending: null, ...callbacks }, `purchase-detail-${busy}-${gameState.gold}`);
    const detailNode = find(app, node => node.type?.name === 'NativePieceDetail');
    const detail = invoke(detailNode.type, detailNode.props, `purchase-native-${busy}-${gameState.gold}`);
    return find(detail, node => node.type === DetailPanel).props.overrides.actions;
  };
  let bought = null;
  let closed = 0;
  const details = invoke(AssaultUI, { catalog, state: state(10), page: 'run', detail: preview, session: null,
    busy: false, error: null, pending: null,
    ...callbacks,
    onAction: (...args) => { bought = args; }, onClose: () => { closed += 1; },
  }, 'purchase-detail-live');
  const detailNode = find(details, node => node.type?.name === 'NativePieceDetail');
  const detail = invoke(detailNode.type, detailNode.props, 'purchase-native-live');
  const actionSlot = find(detail, node => node.type === DetailPanel).props.overrides.actions;
  const buyButton = find(actionSlot, node => node.type === Button);
  assert.ok(buyButton, 'an unsold live shop preview exposes the native amber purchase action');
  assert.equal(text(buyButton), '购买7', 'the detail shows the actual current offer price');
  const rendered = invoke(Button, buyButton.props, 'purchase-button');
  rendered.props.onClick();
  assert.deepEqual(bought, ['buy', { slotId: 'offer-1' }], 'purchase reuses NativeShop action and exact slotId');
  assert.equal(closed, 1, 'the detail closes using NativeShop onClose semantics');

  const poorAction = renderDetail({ gameState: state(0) });
  const poorButton = find(poorAction, node => node.type === Button);
  assert.equal(poorButton.props.disabled, true, 'insufficient gold disables detail purchase');
  const poorRendered = invoke(Button, poorButton.props, 'purchase-button-poor');
  bought = null;
  poorRendered.props.onClick();
  assert.equal(bought, null, 'disabled unaffordable button cannot dispatch a purchase');

  const busyAction = renderDetail({ busy: true });
  const busyButton = find(busyAction, node => node.type === Button);
  assert.equal(busyButton.props.disabled, true, 'busy shop state disables detail purchase');
  const busyRendered = invoke(Button, busyButton.props, 'purchase-button-busy');
  busyRendered.props.onClick();
  assert.equal(bought, null, 'disabled busy button cannot dispatch a purchase');

  assert.equal(renderDetail({ gameState: { ...state(), phase: 'battle' } }) ?? null, null, 'non-shop details have no buy action');
  assert.equal(renderDetail({ gameState: { ...state(), shop: { slots: [{ ...slot, sold: true }] } } }) ?? null, null,
    'sold previews have no buy action');
  assert.equal(renderDetail({ piece: state().pieces[0] }) ?? null, null, 'owned operator details have no shop buy action');
});

test('ChoiceView respects disabled cards, caller icons and renders extras outside the selected card', () => {
  const sp = { name: '事件', desc: '说明', family: 'assault', untimed: true, order: [], turnPid: 'me', pickOf: new Map(),
    cards: [{ idx: 0, id: 'x', name: '锁定项', disabled: true, icon: '/assets/assault/icon.png' }] };
  assert.equal(cardPickable(sp, sp.cards[0], { myId: 'me', solo: true }), false);
  const extra = { type: 'button', props: { children: '确认目标' } };
  const view = invoke(ChoiceView, { pub: { players: [] }, sp, myId: 'me', solo: true,
    presentation: { title: '进击事件', description: '事件说明', cardExtra: { type: 'span', props: { children: '卡片注记' } }, extra: () => extra } }, 'choice-view');
  assert.ok(find(view, node => node.props?.src === '/assets/assault/icon.png'), 'explicit presentation URL wins for the card icon');
  const card = find(view, node => cls(node).includes('spcard'));
  assert.ok(find(card, node => node.type === 'span' && text(node) === '卡片注记'));
  const outerExtra = find(view, node => cls(node) === 'spov__extra');
  assert.ok(outerExtra && find(outerExtra, node => node.type === 'button'), 'interactive controls can live outside the card button');
});

test('ChoiceView quiet mode keeps the title and cards but drops the description, how-to-pick and turn sentences', () => {
  const sp = { name: '事件', desc: '说明', family: 'assault', untimed: true, order: [], turnPid: 'me', pickOf: new Map(),
    cards: [{ idx: 0, id: 'x', name: '选项', desc: '效果文本' }] };
  const props = { pub: { players: [] }, sp, myId: 'me', solo: true };
  const loud = invoke(ChoiceView, { ...props, presentation: { title: '路线', description: '一句说明' } }, 'choice-view-loud');
  assert.ok(find(loud, node => cls(node).includes('spov__desc')) && find(loud, node => cls(node).includes('spov__sub')), 'default mode keeps the sentences');
  const quiet = invoke(ChoiceView, { ...props, presentation: { title: '路线', description: '一句说明', quiet: true } }, 'choice-view-quiet');
  for (const name of ['spov__bar', 'spov__desc', 'spov__sub', 'spov__turntxt']) {
    assert.ok(!find(quiet, node => cls(node).includes(name)), name + ' is dropped');
  }
  assert.doesNotMatch(text(find(quiet, node => cls(node).includes('spov__titles'))), /一句说明/);
  assert.match(text(find(quiet, node => cls(node).includes('spov__titles'))), /路线/);
  assert.ok(find(quiet, node => cls(node).includes('spcard')), 'the cards stay');
});

test('shop role prose stays in native detail and never becomes a shop class label', () => {
  resetHooks();
  const role = '近卫：群攻近卫·击杀回血前排，配合寒冷体系持续压制敌人并承担前排阻挡。';
  const trait = '同时攻击阻挡的所有敌人';
  const richCatalog = { ...catalog, runtime: { ...runtime, bodies: { op: { ...runtime.bodies.op,
    simChess: { ...runtime.bodies.op.simChess, trait: { desc: trait }, subProfessionName: '强攻手' } } } },
    publicText: { ...catalog.publicText, operators: { op: { ...catalog.publicText.operators.op, role } } } };
  const piece = state().pieces[0];
  const record = presentationRecord(richCatalog, piece);
  assert.equal(record.subProfessionName, '强攻手');
  assert.notEqual(record.subProfessionName, role);
  assert.equal(record.trait.desc, trait, 'native trait is preserved for detail');
  const fallback = presentationRecord({ ...richCatalog, runtime }, piece);
  assert.equal(fallback.subProfessionName, '近卫', 'missing native branch uses a short profession label');
  const app = invoke(AssaultUI, { catalog: richCatalog, state: state(), page: 'run', detail: piece,
    session: null, busy: false, error: null, pending: null, ...callbacks }, 'role-app');
  const detailNode = find(app, n => n.type?.name === 'NativePieceDetail');
  const detail = invoke(detailNode.type, detailNode.props, 'role-detail');
  const panel = find(detail, n => n.type === DetailPanel);
  const mechanics = panel.props.overrides.assaultMechanics;
  assert.ok(find(mechanics, n => n.props?.class === 'dtext assault-role-detail' && n.type?.name === 'RichText'));
  assert.ok(find(mechanics, n => n.props?.text === role), 'the complete role remains available inside the native detail');
});

test('visual choices retain native cards and show full description only after selecting a card', () => {
  const image = { type: 'img', props: { src: '/assault-assets/collectibles/cold-frostsignal.png' } };
  const sp = { name: '收藏品', desc: '', family: 'assault', untimed: true, order: [], turnPid: 'me', pickOf: new Map(),
    cards: [{ idx: 0, name: '留春', desc: '敌人被击倒时，其八邻内所有敌人各获得一次6秒寒冷。', visual: image }] };
  const presentation = { visualMode: true, hideCardDescription: true, cardExtra: card => card.visual,
    extra: card => card ? { type: 'p', props: { children: card.desc } } : null };
  const idle = invoke(ChoiceView, { pub: { players: [] }, sp, myId: 'me', solo: true, presentation }, 'visual-idle');
  assert.ok(find(idle, n => n.type === 'img' && n.props.src === image.props.src));
  assert.ok(!find(idle, n => cls(n).includes('spcard__desc')));
  assert.ok(!find(idle, n => cls(n) === 'spov__extra'));
  const selected = invoke(ChoiceView, { pub: { players: [] }, sp, myId: 'me', solo: true, armed: 0, presentation }, 'visual-selected');
  assert.ok(find(selected, n => cls(n).includes('spcard') && cls(n).includes('is-armed')), 'native armed card state is retained');
  assert.ok(find(selected, n => cls(n) === 'spov__extra' && text(n).includes('八邻')), 'selected detail keeps the complete mechanic');
});

test('Assault relic reward cards use the collectible manifest image instead of a generic tactic glyph', () => {
  resetHooks();
  const rewardCatalog = { ...catalog, design: { ...design, collectibles: { items: [{ id: 'cold-frostsignal', name: '留春', description: '寒冷效果' }] } },
    assets: { assets: { collectibles: { 'cold-frostsignal': { icon: { url: '/assault-assets/collectibles/cold-frostsignal.png' } } } } } };
  const app = invoke(AssaultUI, { catalog: rewardCatalog, state: { ...state(), phase: 'rewards', rewards: { choices: ['cold-frostsignal'] } },
    page: 'run', session: null, detail: null, busy: false, error: null, pending: null, ...callbacks }, 'rewards-app');
  const choices = find(app, n => n.type?.name === 'NativeChoices');
  const choice = invoke(choices.type, choices.props, 'rewards-choice');
  assert.equal(choice.props.cards[0].name, '留春');
  assert.ok(find(choice.props.cards[0].visual, n => n.props?.src === '/assault-assets/collectibles/cold-frostsignal.png'));
});

test('Assault skill level reward uses native choice cards showing the current-tier effect, and a free skip action', () => {
  resetHooks();
  const actionLog = [];
  const skill = { id: 'strategy_fixture', name: '战术甲', startingStar: 1, description: '造成10/20/30/40%伤害', icon: { kind: 'ui', name: 'book' } };
  const rewardCatalog = { ...catalog, design: { ...design, system: { ...design.system, strategySkills: [skill] } } };
  const rewardState = { ...state(), phase: 'skillChoice', skillRewards: { id: 'skill_tech4', star: 2, count: 3, choices: [skill.id], skippable: true } };
  const app = invoke(AssaultUI, { catalog: rewardCatalog, state: rewardState, page: 'run', session: null, detail: null,
    busy: false, error: null, pending: null, ...callbacks,
    onAction: (kind, payload) => actionLog.push({ kind, payload }) }, 'skill-reward-app');
  const choices = find(app, n => n.type?.name === 'NativeChoices');
  const choice = invoke(choices.type, choices.props, 'skill-reward-choice');
  assert.equal(choice.props.name, '战术');
  assert.equal(choice.props.cards.length, 1);
  assert.equal(choice.props.cards[0].name, skill.name);
  assert.ok(find(choice.props.cards[0].visual, node => node.type === TierChip && node.props.tier === 2));
  assert.ok(String(choice.props.cards[0].visual.props.class).includes('assault-choice-visual--skill'), 'the card keeps the sized skill-icon slot');
  assert.equal(choice.props.cards[0].desc, '造成20%伤害');
  const renderedChoice = invoke(choice.type, choice.props, 'skill-reward-choice-overlay');
  find(renderedChoice.props.presentation.extra, node => node.type === Button && text(node) === '跳过').props.onClick();
  assert.deepEqual(actionLog, [{ kind: 'skipSkillReward', payload: undefined }]);
  choice.props.onPick(0);
  assert.deepEqual(actionLog.at(-1), { kind: 'chooseSkill', payload: { skillId: skill.id } });

  const existingApp = invoke(AssaultUI, { catalog: rewardCatalog,
    state: { ...rewardState, skillRanks: { [skill.id]: 1 }, skillRewards: { ...rewardState.skillRewards, star: 1 } },
    page: 'run', session: null, detail: null, busy: false, error: null, pending: null, ...callbacks }, 'skill-reward-upgrade-app');
  const existingChoiceNode = find(existingApp, n => n.type?.name === 'NativeChoices');
  const existingChoice = invoke(existingChoiceNode.type, existingChoiceNode.props, 'skill-reward-upgrade-choice');
  assert.equal(existingChoice.props.cards[0].desc, '造成20%伤害', 'same-rank free selection shows the actual upgraded rank');
  assert.ok(find(existingChoice.props.cards[0].visual, node => node.type === TierChip && node.props.tier === 2));
});

test('operator upgrade reward reuses native two-tap choices and previews the projected mechanics without sending a star', () => {
  resetHooks();
  const actionLog = [];
  const body = { ...runtime.bodies.op,
    fixedSkill: { ...runtime.bodies.op.fixedSkill, effects: [{ description: '攻击提高10/20/30/40%。' }] },
    modePassives: [{ trigger: '进场时', description: '伤害增加2/4/6/8%。', unlockStar: 2 }],
    defaultModuleId: 'module_fixture', modulePlans: [{ id: 'module_fixture', type: 'ADVANCED', unlockStar: 3,
      name: '进阶模组甲', description: '部署时间缩短1/2/3/4秒。' }],
  };
  const upgradeCatalog = { ...catalog, runtime: { ...runtime, bodies: { op: body } },
    publicText: { ...catalog.publicText, operators: { ...catalog.publicText.operators, op: { ...catalog.publicText.operators.op,
      modePassives: [{ name: '进击被动一', trigger: '进场时', description: '伤害增加2/4/6/8%。' }] } } },
    design: { ...design, system: { ...design.system, enchantments: [{ id: 'enchant_fixture', name: '守护',
      description: '护盾提高1/2/3/4%。', icon: { kind: 'ui', name: 'shield' } }] } } };
  const pieces = Array.from({ length: 5 }, (_, index) => ({ uid: `owned-${index + 1}`, charId: 'op', star: index === 0 ? 2 : 1,
    sourceCopies: 1, row: null, col: null, ...(index === 0 ? { enchantmentId: 'enchant_fixture' } : {}) }));
  const upgradeState = { ...state(), phase: 'upgradeChoice', pieces,
    upgradeRewards: { id: 'tech-3', maxStar: 2, count: 1, choices: pieces.map(piece => piece.uid), skippable: true } };
  assert.equal(PHASES.upgradeChoice, '干员升级');
  const app = invoke(AssaultUI, { catalog: upgradeCatalog, state: upgradeState, page: 'run', session: null, detail: null,
    busy: false, error: null, pending: null, ...callbacks,
    onAction: (kind, payload) => actionLog.push({ kind, payload }) }, 'operator-upgrade-reward-app');
  const choicesNode = find(app, node => node.type?.name === 'NativeChoices');
  const overlay = invoke(choicesNode.type, choicesNode.props, 'operator-upgrade-reward-choices');
  const choice = find(overlay, node => node.type?.name === 'Choice');
  const renderedChoice = invoke(choice.type, choice.props, 'operator-upgrade-reward-overlay');
  assert.equal(choice.props.name, '干员升级');
  assert.equal(choice.props.cards.length, 4, 'the UI never renders more than four native candidates');
  const first = choice.props.cards[0];
  assert.equal(first.name, '巡林者');
  assert.equal(first.tier, 3, 'the native card tier chip shows the projected result');
  assert.ok(find(first.visual, node => node.type?.name === 'UnitThumb' && node.props.tier === 2), 'the current tier stays visible');
  assert.ok(find(first.visual, node => node.type?.name === 'UnitThumb' && node.props.tier === 3));
  let nativeOverlay = invoke(ChoiceOverlay, renderedChoice.props, 'operator-upgrade-choice-overlay');
  let view = invoke(nativeOverlay.type, nativeOverlay.props, 'operator-upgrade-choice-view');
  find(view, node => cls(node).includes('spcard')).props.onClick();
  assert.deepEqual(actionLog, [], 'the first tap only arms the native card');
  nativeOverlay = invoke(ChoiceOverlay, renderedChoice.props, 'operator-upgrade-choice-overlay');
  view = invoke(nativeOverlay.type, nativeOverlay.props, 'operator-upgrade-choice-view');
  assert.ok(first.desc.includes('攻击提高30%'), 'the projected next-star effect is on the card itself, no details strip follows');
  const skip = find(renderedChoice.props.presentation.extra, node => node.type === Button && text(node) === '跳过');
  skip.props.onClick();
  nativeOverlay.props.onConfirm();
  assert.deepEqual(actionLog, [
    { kind: 'skipUpgradeReward', payload: undefined },
    { kind: 'chooseUpgrade', payload: { uid: 'owned-1' } },
  ], 'only the native action and UID are submitted; projected star is display-only');

  resetHooks();
  const invalidApp = invoke(AssaultUI, { catalog: upgradeCatalog, state: { ...upgradeState,
    upgradeRewards: { ...upgradeState.upgradeRewards, maxStar: 0 } }, page: 'run', session: null, detail: null,
    busy: false, error: null, pending: null, ...callbacks }, 'operator-upgrade-invalid-preview-app');
  const invalidChoices = find(invalidApp, node => node.type?.name === 'NativeChoices');
  const invalidOverlay = invoke(invalidChoices.type, invalidChoices.props, 'operator-upgrade-invalid-preview-choices');
  const invalidChoiceNode = find(invalidOverlay, node => node.type?.name === 'Choice');
  assert.equal(invalidChoiceNode.props.cards.length, 4, 'projection errors keep candidate identities visible');
  assert.ok(invalidChoiceNode.props.cards.every(card => card.disabled), 'an invalid preview cannot be confirmed');
  const invalidChoice = invoke(invalidChoiceNode.type, invalidChoiceNode.props, 'operator-upgrade-invalid-preview-overlay');
  assert.ok(find(invalidChoice.props.presentation.extra, node => node.props?.role === 'alert'));
});

test('recruit confirmation waits for a concrete target and changing the filter clears a stale target', () => {
  resetHooks();
  const actionLog = [];
  const eventState = { ...state(), phase: 'event', target: { eventId: 'evt_recruit', name: '定向招募' },
    choices: [{ id: 'guided', targeting: { mode: 'recruit', selection: 'profession' }, costs: [{ currency: 'gold', amount: 4 }],
      outcomes: [{ probability: 1, effects: [{ kind: 'recruit', count: 1, selection: 'profession' }] }],
      recruitFilters: ['WARRIOR', 'PIONEER'], targets: [{ targetUid: 'op', filterTag: 'WARRIOR', name: '巡林者' },
        { targetUid: 'other', filterTag: 'PIONEER', name: '先锋干员' }] }] };
  const eventCatalog = { ...catalog, design: { ...design, collectibles: { items: [] } } };
  const app = invoke(AssaultUI, { catalog: eventCatalog, state: eventState, page: 'run', detail: null,
    session: null, busy: false, error: null, pending: null, ...callbacks,
    onAction: (kind, payload) => actionLog.push({ kind, payload }) }, 'recruit-app');
  const choices = find(app, n => n.type?.name === 'NativeChoices');
  let view = invoke(choices.type, choices.props, 'recruit-choices');
  find(view, n => n.type?.name === 'Choice').props.onPick(0);
  view = invoke(choices.type, choices.props, 'recruit-choices');
  let modal = find(view, n => n.type === Modal);
  assert.equal(find(modal.props.actions, n => n.type === Button).props.disabled, true, 'server-required targetUid blocks confirmation');
  find(modal.props.children, n => n.type === Button && text(n) === '巡林者').props.onClick();
  view = invoke(choices.type, choices.props, 'recruit-choices');
  modal = find(view, n => n.type === Modal);
  assert.equal(find(modal.props.actions, n => n.type === Button).props.disabled, false);
  find(modal.props.children, n => n.type === Button && text(n) === '先锋').props.onClick();
  view = invoke(choices.type, choices.props, 'recruit-choices');
  modal = find(view, n => n.type === Modal);
  assert.equal(find(modal.props.actions, n => n.type === Button).props.disabled, true, 'changing profession clears the previous profession target');
  find(modal.props.children, n => n.type === Button && text(n) === '先锋干员').props.onClick();
  view = invoke(choices.type, choices.props, 'recruit-choices');
  modal = find(view, n => n.type === Modal);
  find(modal.props.actions, n => n.type === Button).props.onClick();
  assert.deepEqual(actionLog, [{ kind: 'confirmEvent', payload: { choiceId: 'guided', targetUid: 'other', filterTag: 'PIONEER' } }]);
});

test('random enchant event shows its automatic target and weighted legal options before confirming', () => {
  resetHooks();
  const actionLog = [];
  const enchants = [
    { id: 'enchant_toxic', name: '剧毒', description: '剧毒效果。', icon: { kind: 'glyph', name: 'skull' } },
    { id: 'enchant_heavy', name: '重压', description: '重压效果。', icon: { kind: 'ui', name: 'sword' } },
  ];
  const choice = { id: 'recast', label: '重新调配强化', description: '自动替换强化。', enabled: true,
    targeting: { mode: 'none' }, costs: [{ currency: 'gold', amount: 20 }],
    outcomes: [{ probability: 1, effects: [{ kind: 'randomEnchant', poolId: 'pool_bazaar_random', targetRule: 'oldestToxic' }] }],
    targets: [{ targetUid: 'p1', name: '巡林者', enchantmentId: 'enchant_toxic' }],
    enchantmentOffer: { poolId: 'pool_bazaar_random', targetRule: 'oldestToxic', targetUid: 'p1', charId: 'op', star: 2,
      currentEnchantmentId: 'enchant_toxic', options: [{ enchantmentId: 'enchant_heavy', name: '重压', weight: 50 }] } };
  const eventState = { ...state(30), phase: 'event', target: { eventId: 'evt_bazaar_botul', name: '炼金实验' },
    pieces: [{ uid: 'p1', charId: 'op', name: '巡林者', star: 2, enchantmentId: 'enchant_toxic' }], choices: [choice] };
  const eventCatalog = { ...catalog, design: { ...design, collectibles: { items: [] }, system: { ...design.system, enchantments: enchants } } };
  const app = invoke(AssaultUI, { catalog: eventCatalog, state: eventState, page: 'run', detail: null, session: null,
    busy: false, error: null, pending: null, ...callbacks, onAction: (kind, payload) => actionLog.push({ kind, payload }) }, 'random-enchant-app');
  const choices = find(app, node => node.type?.name === 'NativeChoices');
  const view = invoke(choices.type, choices.props, 'random-enchant-choices');
  const nativeChoice = find(view, node => node.type?.name === 'Choice');
  assert.equal(nativeChoice.props.cards[0].name, '重新调配强化');
  assert.match(nativeChoice.props.cards[0].desc, /持剧毒/);
  assert.equal(nativeChoice.props.cards[0].detail, undefined, 'the card has no details strip, its text is the whole effect');
  const cardVisual = invoke(nativeChoice.props.cards[0].visual.type, nativeChoice.props.cards[0].visual.props, 'random-enchant-card');
  assert.ok(find(cardVisual, node => node.type?.name === 'UnitThumb'), 'the card visual identifies the automatic target operator');
  assert.ok(find(cardVisual, node => node.type?.name === 'Icon'), 'the card visual includes the weighted-option enhancement icon');
  nativeChoice.props.onPick(0);
  const opened = invoke(choices.type, choices.props, 'random-enchant-choices');
  assert.equal(find(opened, node => node.type === Modal)?.props.open, false, 'an automatic-target event needs no modal');
  assert.deepEqual(actionLog, [{ kind: 'confirmEvent', payload: { choiceId: 'recast' } }],
    'automatic target is not converted into a user-selected targetUid');

  resetHooks();
  const noTargetChoice = { ...choice, enabled: false, enchantmentOffer: null, targets: [] };
  const noTargetApp = invoke(AssaultUI, { catalog: eventCatalog,
    state: { ...eventState, pieces: [], choices: [noTargetChoice] }, page: 'run', detail: null, session: null,
    busy: false, error: null, pending: null, ...callbacks }, 'random-enchant-no-target-app');
  const noTargetChoices = find(noTargetApp, node => node.type?.name === 'NativeChoices');
  const noTargetView = invoke(noTargetChoices.type, noTargetChoices.props, 'random-enchant-no-target-choices');
  const noTargetNativeChoice = find(noTargetView, node => node.type?.name === 'Choice');
  assert.equal(noTargetNativeChoice.props.cards[0].disabled, true);
  assert.match(noTargetNativeChoice.props.cards[0].desc, /无剧毒强化干员/,
    'a disabled event explains why its automatic target is unavailable');
});

test('event background reuses the authored asset by backgroundId and preserves exact-id precedence', () => {
  const catalog = { design: { events: { events: [{ id: 'evt_bazaar_hat', backgroundId: 'pic_rogue_3_21' }] } },
    assets: { assets: { events: {
      evt_rogue3_market: { backgroundId: 'pic_rogue_3_21', background: { url: '/assault-assets/events/pic_rogue_3_21.png' } },
      evt_bazaar_hat: { background: { url: '/assault-assets/events/explicit.png' } },
    } } } };
  assert.equal(eventBackground(catalog, 'evt_bazaar_hat'), '/assault-assets/events/explicit.png', 'an exact event asset keeps precedence');
  delete catalog.assets.assets.events.evt_bazaar_hat;
  assert.equal(eventBackground(catalog, 'evt_bazaar_hat'), '/assault-assets/events/pic_rogue_3_21.png', 'a new event reuses its authored backgroundId asset');
  assert.equal(eventBackground(catalog, 'evt_missing'), null, 'unknown events do not receive a guessed image');
});

test('native prep splits the 12-piece assault bench into 10 hand slots and 2 reachable temp slots', () => {
  const pieces = Array.from({ length: 12 }, (_, index) => ({
    uid: `bench-${index}`, charId: 'op', star: index === 11 ? 4 : index % 3 + 1, row: null, col: null,
  }));
  const prep = nativePrepView(stablePrepView({ pieces }, createPieceUidMap(pieces)));
  assert.equal(prep.hand.length, 10);
  assert.equal(prep.temp.length, 2);
  assert.deepEqual([...prep.hand, ...prep.temp].filter(Boolean).map((piece) => piece.assaultUid), pieces.map((piece) => piece.uid));
  assert.equal(prep.temp[1].tier, 4);
  assert.equal(prep.temp[1].golden, true);
  assert.deepEqual(prep.temp.map((piece) => [piece.area, piece.index]), [['temp', 0], ['temp', 1]]);

  const small = pieces.slice(0, 3);
  const smallPrep = nativePrepView(stablePrepView({ pieces: small }, createPieceUidMap(small)));
  assert.equal(smallPrep.hand.filter(Boolean).length, 3);
  assert.equal(smallPrep.temp.length, 0);
  assert.deepEqual(smallPrep.hand.filter(Boolean).map((piece) => piece.assaultUid), small.map((piece) => piece.uid));
});
