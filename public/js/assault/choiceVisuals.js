// Assault choice presentation composes the native game's art and components. No rules are applied here.
import { html } from '../ui/components.js';
import { Img, Sprite, UnitThumb, GIcon, CoinGlyph } from '../ui/gameComponents.js';
import { Icon, ICONS } from '../ui/components.js';
import { GLYPHS } from '../ui/gameComponents.js';
import { profIconUrl } from '../ui/assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { outcomeText, professionLabel } from './model.js';
import { meetsShopFilter } from '../../../shared/assault/shops.js';
import { relicCandidates } from '../../../shared/assault/rewards.js';

const urlOf = value => typeof value === 'string' ? value : value?.url || null;
export const eventBackground = (catalog, id) => {
  const events = (catalog.assets?.assets || catalog.assets)?.events || {};
  const direct = urlOf(events[id]?.background);
  if (direct) return direct;
  const definition = (catalog.design?.events?.events || []).find(event => event.id === id);
  if (!definition?.backgroundId) return null;
  const reused = Object.values(events).find(event => event.backgroundId === definition.backgroundId);
  return urlOf(reused?.background);
};
export const relicIcon = (catalog, id) => urlOf((catalog.assets?.assets || catalog.assets)?.collectibles?.[id]?.icon);
export function targetCharId(catalog, target) {
  return target.charId || (catalog.runtime.bodies[target.targetUid] ? target.targetUid
    : catalog.runtime.operators[target.targetUid]?.extraForms?.find(id => catalog.runtime.bodies[id])) || target.targetUid;
}
export function RecruitFilterVisual({ choice, tag, catalog }) {
  if (choice.targeting?.selection === 'profession') return html`<${ProfessionImage} profession=${tag} />`;
  const candidates = choice.targets?.filter(v => !tag || v.filterTag === tag) || [];
  return html`<span class="assault-object-group">${candidates.slice(0, 3).map(v => html`<${UnitThumb}
    id=${targetCharId(catalog,v)} tier=${1} size="sm" />`)}</span>`;
}
export function recruitFilterLabel(catalog, choice, tag) {
  return choice.targeting?.selection === 'profession' ? professionLabel(tag)
    : catalog.design.system.directors.find(d => d.themeFaction === tag)?.themeFactionName || t('招募方向');
}

export function ProfessionImage({ profession }) {
  return html`<${Img} src=${profIconUrl(data.get('assets'), profession)} class="assault-profession-image"
    alt=${professionLabel(profession)} fallback=${html`<${GIcon} name="users" />`} />`;
}

export function ValueIcon({ kind }) {
  if (kind === 'gold' || kind === 'shopDiscount') return html`<${CoinGlyph} />`;
  if (kind === 'hp') return html`<${Sprite} k="hudPanel/icon_hp" fallback=${html`<${GIcon} name="rook" />`} />`;
  if (kind === 'xp') return html`<${GIcon} name="book" />`;
  const icons = { repair: 'shield', enhance: 'sword', redeploy: 'refresh', tag: 'flag', recruit: 'users', relicChoice: 'crown' };
  return html`<${GIcon} name=${icons[kind] || 'info'} />`;
}

export function ValueChip({ kind, value, title }) {
  return html`<span class="assault-value" title=${title || outcomeText({ kind, amount: value })}>
    <${ValueIcon} kind=${kind} /><b class="num">${value}</b></span>`;
}

function enchantmentIcon(definition) {
  const icon=definition?.icon||{};
  const statIcons={atk:'sword',def:'shield',hp:'target',aspd:'hourglass'};
  if(icon.kind==='unit')return html`<${UnitThumb} id=${icon.charId||icon.name} tier=${1} size="xs" />`;
  if(icon.kind==='sprite')return html`<${Sprite} k=${icon.name} fallback=${html`<${GIcon} name="bolt" />`} />`;
  if(icon.kind==='glyph')return html`<${GIcon} name=${GLYPHS[icon.name]||ICONS[icon.name]?icon.name:'bolt'} />`;
  if(icon.kind==='stat')return html`<${Icon} name=${statIcons[icon.name]||'bolt'} />`;
  if(icon.kind==='ui')return html`<${Icon} name=${ICONS[icon.name==='bag'?'book':icon.name]?icon.name==='bag'?'book':icon.name:'bolt'} />`;
  return html`<${GIcon} name="bolt" />`;
}

function enchantOfferTarget(choice,state){
  const offer=choice?.enchantmentOffer;
  const uid=offer?.targetUid||choice?.targets?.[0]?.targetUid;
  return (state?.pieces||[]).find(piece=>piece.uid===uid)||null;
}
export function Costs({ costs = [] }) {
  return costs.length ? html`<span class="assault-values">${costs.map(c => html`<${ValueChip} kind=${c.currency}
    value=${`−${c.amount}`} title=${c.currency === 'gold' ? t('花费 {amount} 金币', c) : t('消耗 {amount} 生命', c)} />`)}</span>` : null;
}

export function EffectObject({ effect, catalog, state, large = false, choice = null }) {
  if(effect.kind==='randomEnchant'){
    const target=enchantOfferTarget(choice||{},state);
    return html`<span class="assault-object-group">${target
      ? html`<${UnitThumb} id=${target.charId} tier=${target.star||1} size=${large?'lg':'sm'} />`
      : html`<${GIcon} name="users" />`}<${GIcon} name="chevrons" title=${t('随机强化')} /></span>`;
  }
  if (effect.kind === 'relicChoice') {
    const items = relicCandidates({ ...state, relicIds: state?.relicIds || state?.relics?.map(r => r.id) || [], day: state?.day || 1 }, { design: catalog.design },
      { track: effect.track, rarity: effect.rarity, count: large ? 3 : 2, source: { type: 'event', value: 'nonBattleEvent' } }).candidates;
    return html`<span class="assault-object-group">${items.map(r => html`<${Img}
      src=${relicIcon(catalog, r.id)} alt=${r.name} class="assault-relic-image" />`)}<${GIcon} name="chevrons" title=${t('从收藏品中选择')} /></span>`;
  }
  if (effect.kind === 'recruit') {
    if (effect.selection === 'profession' && effect.tag && effect.tag !== '<player-chosen>') return html`<${ProfessionImage} profession=${effect.tag} />`;
    return html`<${ValueIcon} kind="recruit" />`;
  }
  if (['repair', 'enhance', 'redeploy', 'tag'].includes(effect.kind)) {
    return html`<${ValueIcon} kind=${effect.kind} />`;
  }
  return html`<${ValueIcon} kind=${effect.kind} />`;
}

export function EventActionVisual({ choice, catalog, state }) {
  const effects = (choice.outcomes || []).flatMap(o => o.effects || []);
  const primary = effects.find(e => ['randomEnchant','relicChoice', 'recruit', 'repair', 'enhance', 'redeploy', 'tag'].includes(e.kind)) || effects[0];
  if(primary?.kind==='randomEnchant'){
    const target=enchantOfferTarget(choice,state), offer=choice.enchantmentOffer||{};
    const all=offer.options||[],options=all.slice(0,3);
    const weightTotal=all.reduce((sum,item)=>sum+Math.max(0,Number(item.weight)||0),0);
    return html`<span class="assault-choice-visual assault-choice-visual--action">
      <span class="assault-object-group">${target?html`<${UnitThumb} id=${target.charId} tier=${target.star||1} size="sm" />`:html`<${GIcon} name="users" />`}
        ${options.map(option=>{const definition=(catalog.design.system.enchantments||[]).find(item=>item.id===option.enchantmentId);
          const chance=weightTotal>0?Math.round(Math.max(0,Number(option.weight)||0)/weightTotal*100):0;
          return html`<span class="assault-effect" title=${t(option.name||definition?.name||'随机强化')}>${enchantmentIcon(definition)}<b class="num">${chance}%</b></span>`;})}
        <${GIcon} name="chevrons" title=${t('随机强化')} /></span>
      ${choice.costs?.length?html`<${Costs} costs=${choice.costs} />`:null}
    </span>`;
  }
  return html`<span class="assault-choice-visual assault-choice-visual--action">
    <span class="assault-action-object">${primary?.kind === 'recruit' && choice.recruitFilters?.length
      ? html`<span class="assault-object-group">${choice.targeting?.selection === 'profession'
        ? choice.recruitFilters.filter(tag => choice.targets?.some(v => v.filterTag === tag)).map(tag => html`<${ProfessionImage} profession=${tag} />`)
        : html`<${RecruitFilterVisual} choice=${choice} catalog=${catalog} />`}</span>`
      : primary ? html`<${EffectObject} effect=${primary} catalog=${catalog} state=${state} large=${true} />`
      : html`<${GIcon} name="exit" />`}</span><${Costs} costs=${choice.costs} /></span>`;
}

export function ShopVisual({ node, catalog }) {
  if (node.shopId === 'shop_supply') return html`<span class="assault-choice-visual assault-choice-visual--shop">
    <${Sprite} k="shopPanel/icon" class="assault-shop-image" />
    <span class="assault-object-group"><${Icon} name="robot" /><${Icon} name="hourglass" /><${Icon} name="shield" /></span></span>`;
  if (node.shopId === 'shop_strategy' || node.shopId === 'shop_enchant') {
    const skill = node.shopId === 'shop_strategy';
    return html`<span class="assault-choice-visual assault-choice-visual--shop">
      <span class="assault-action-object"><${GIcon} name=${skill ? 'bolt' : 'target'} /></span>
    </span>`;
  }
  const definition = catalog.design.system.shopDefinitions?.find(s => s.id === node.shopId);
  const filter = definition?.filter;
  const candidates = Object.values(catalog.runtime.operators).filter(op => {
    if (definition?.priceRule?.tiers && !definition.priceRule.tiers.includes(op.price)) return false;
    return filter ? meetsShopFilter(op, filter) : true;
  });
  return html`<span class="assault-choice-visual assault-choice-visual--shop">
    <${Sprite} k="shopPanel/icon" class="assault-shop-image" />
    <span class="assault-object-group">${candidates.slice(0, 3).map(op => html`<${UnitThumb} id=${targetCharId(catalog,{targetUid:op.charId})}
      tier=${Number.isInteger(definition?.offeredStar) ? definition.offeredStar : 1} size="lg" />`)}</span>
    ${filter?.type === 'profession' ? html`<${ProfessionImage} profession=${filter.value} />` : null}
    ${definition?.buybackBonus ? html`<span class="assault-values" title=${t('出售同职业干员时，额外获得 {amount} 金币', { amount: definition.buybackBonus.amount })}>
      <${ValueChip} kind="gold" value=${`+${definition.buybackBonus.amount}`} /></span>` : null}
  </span>`;
}

export function EncounterVisual({ encounter, catalog }) {
  const keys = [...new Set((encounter?.wave?.spawns || []).map(s => catalog.nativeData.bosses?.[s.key]?.enemyKey || s.key))];
  const bossKey = catalog.nativeData.bosses?.[encounter?.wave?.bossId]?.enemyKey;
  if (bossKey && !keys.includes(bossKey)) keys.unshift(bossKey);
  return html`<span class="assault-choice-visual assault-choice-visual--battle">
    <span class="assault-object-group">${keys.slice(0, 3).map(id => html`<${UnitThumb} kind="enemy" id=${id} size="lg" />`)}</span>
    <span class="assault-values">${encounter?.rewards ? html`<${ValueChip} kind="gold" value=${encounter.rewards.gold} />
      <${ValueChip} kind="xp" value=${encounter.rewards.xp} />${encounter.rewards.relicChoice ? html`<span class="assault-value"><${ValueIcon} kind="relicChoice" /></span>` : null}` : null}</span>
  </span>`;
}
