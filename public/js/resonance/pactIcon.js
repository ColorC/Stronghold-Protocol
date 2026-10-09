import { html } from '../ui/components.js';
import { data } from '../data.js';
import { bondIconUrl, profIconUrl, uiUrl } from '../ui/assetUrls.js';
import { GIcon } from '../ui/gameComponents.js';

const glyphFor = (name = '') => {
  const text = String(name);
  if (/先锋|先鋒|部署|费用|费用/.test(text)) return 'flag';
  if (/近卫|近衛|剑|剑士|刃/.test(text)) return 'sword';
  if (/重装|防御|守护|守護|坚守|堅守/.test(text)) return 'shield';
  if (/狙击|狙擊|远程|遠程|射手/.test(text)) return 'target';
  if (/术师|術師|法术|法術|源石|元素/.test(text)) return 'bolt';
  if (/医疗|醫療|治疗|治療|生命/.test(text)) return 'users';
  if (/辅助|輔助|支援|协同|協同/.test(text)) return 'users';
  if (/召唤|召喚|同构|同構/.test(text)) return 'users';
  if (/策略|战术|戰術/.test(text)) return 'book';
  return 'shield';
};
const normalize = (value) => String(value || '').replace(/[\s·・·:：，,、/\-盟约盟約]/g, '').toLocaleLowerCase();
const FACTION_LOGOS = Object.freeze({
  bolivar:'bolivar', columbia:'columbia', aegir:'egir', egir:'egir', higashi:'higashi', iberia:'iberia',
  kazimierz:'kazimierz', kjerag:'kjerag', laterano:'laterano', leithania:'leithanien', leithanien:'leithanien',
  lungmen:'lungmen', rhodes:'rhodes', rim:'rim', sami:'sami', sargon:'sargon', siracusa:'siracusa',
  ursus:'ursus', victoria:'victoria', yan:'yan', sui:'sui', abyssal:'abyssal', lgd:'lgd', rhine:'rhine',
});
// Existing manifest art chosen by each pact's mechanic/theme. These are actual bond, sub-profession,
// or faction assets from the game's manifest; no generated stand-ins or repeated alphabet glyphs.
const SEMANTIC_ASSETS = Object.freeze([
  [/ammo|precision|precise|精准/,['bond','preciShip']], [/combo|swift|迅捷/,['bond','swiftShip']],
  [/control|slow|控制/,['sub','slower']], [/creation|craft|制造/,['sub','craftsman']],
  [/symbiosis|assist|support|助力/,['bond','deputShip']], [/logistic|invest|经济|投资/,['bond','investShip']],
  [/redeploy|executor|处决/,['sub','executor']], [/flight|sky|飞行/,['sub','skywalker']],
  [/arts|arcane|术法|奥术/,['bond','arcaneShip']], [/breaker|raid|突袭|破甲/,['bond','raidShip']],
  [/burn|fire|炎|灼烧/,['bond','yanShip']], [/necrosis|ritual|凋亡/,['sub','ritualist']],
  [/holygun|laterano|拉特兰/,['faction','laterano']], [/yela|kjerag|谢拉格/,['faction','kjerag']],
  [/babel|巴别|罗德/,['faction','rhodes']], [/sui|岁/,['faction','sui']],
  [/crown|sunt|绝技/,['bond','suntShip']], [/skillful|灵巧/,['bond','skillfulShip']],
  [/stead|坚守/,['bond','steadShip']], [/visi|远见/,['bond','visiShip']],
  [/mira|奇迹/,['bond','miraShip']], [/indom|不屈/,['bond','indomShip']],
  [/mani|调和/,['bond','maniShip']], [/empty|协防/,['bond','emptyShip']], [/solo|独行/,['bond','soloShip']],
]);
function assetFor(manifest, [group, key]) {
  if (group === 'bond') return bondIconUrl(manifest, key);
  if (group === 'sub') return manifest?.prof?.sub?.[key] || null;
  if (group === 'faction') return uiUrl(manifest, `campLogo/logo_${FACTION_LOGOS[key] || key}`);
  return null;
}

/** Resolve a real bond icon by the pact id first, then by the native bond record with the same name. */
export function pactIconUrl(catalog, id) {
  const manifest = data.get('assets');
  const direct = bondIconUrl(manifest, id);
  if (direct) return direct;
  const pact = catalog?.pacts?.[id];
  const pactName = normalize(pact?.name);
  const native = pactName && data.list('bonds').find((bond) => bond && normalize(bond.name) === pactName);
  if (native) {
    const url = bondIconUrl(manifest, native.bondId || native.id);
    if (url) return url;
  }
  const semantic = normalize(`${id} ${pact?.name || ''}`);
  const factionKey = FACTION_LOGOS[String(id || '').toLocaleLowerCase()] ||
    ({ babel:'rhodes', holyGun:'laterano', yela:'kjerag' }[String(id || '')]);
  if (factionKey) {
    const url = assetFor(manifest, ['faction', factionKey]);
    if (url) return url;
  }
  const mapped = SEMANTIC_ASSETS.find(([pattern]) => pattern.test(semantic));
  if (mapped) {
    const url = assetFor(manifest, mapped[1]);
    if (url) return url;
  }
  const faction = Object.entries(FACTION_LOGOS).find(([name]) => semantic.includes(name));
  if (faction) {
    const url = assetFor(manifest, ['faction', faction[0]]);
    if (url) return url;
  }
  const role = /heal|medic|治疗|医疗/.test(semantic) ? 'MEDIC' : /guard|sword|近卫|战士/.test(semantic) ? 'WARRIOR' :
    /tank|defen|坚守|防御/.test(semantic) ? 'TANK' : /snip|ammo|狙击|精准/.test(semantic) ? 'SNIPER' :
    /caster|arts|arcane|术师|法术/.test(semantic) ? 'CASTER' : /pioneer|deploy|先锋/.test(semantic) ? 'PIONEER' :
    /special|move|redeploy|特种/.test(semantic) ? 'SPECIAL' : 'SUPPORT';
  return profIconUrl(manifest, role);
}

/** Current-color mask for a native pact glyph, with an existing role glyph when no native icon is available. */
export function PactIcon({ catalog, id, size = 'md', inactive = false, class: cls }) {
  const pact = catalog?.pacts?.[id];
  const src = pactIconUrl(catalog, id);
  const style = src ? { maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` } : undefined;
  return html`<span class=${['rs-pact-icon', `rs-pact-icon--${size}`, inactive && 'is-inactive', cls].filter(Boolean).join(' ')} title=${pact?.name || id} aria-hidden="true">
    ${src ? html`<i style=${style}></i>` : html`<${GIcon} name=${glyphFor(pact?.name)} />`}
  </span>`;
}
