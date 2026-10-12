// Pact icon resolution (pure: manifest and native bond records are passed in, so tests resolve the same art).
import { bondIconUrl, profIconUrl, uiUrl } from '../ui/assetUrls.js';

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
// New season pact IDs resolve to existing native art explicitly; these are icon reuses by mechanic/theme,
// not generated glyphs. Keeping this table keyed by the full catalog ID prevents fallback role art for new bonds.
// No two pacts of a season may share an icon, and a pact icon may not be the sub-profession icon of any operator of that
// season (it would repeat on the shop cards): holyGun, artillery, dominator, breaker, formSwap and armory therefore take
// native art that nothing in the season uses (test/resonance/pact-icons.test.js keeps it that way).
const CURRENT_PACT_ASSETS = Object.freeze({
  creation:['sub','craftsman'], arts:['bond','arcaneShip'], rhodes:['faction','rhodes'], artillery:['sub','bombarder'],
  formSwap:['sub','dollkeeper'], emissary:['bond','deputShip'], sentinel:['bond','steadShip'], family:['bond','maniShip'],
  redeploy:['sub','executor'], logistics:['bond','investShip'], ammo:['bond','preciShip'], conqueror:['bond','indomShip'],
  holyGun:['bond','lateranoShip'], academy:['bond','skillfulShip'], risk:['bond','miraShip'], resistance:['bond','steadShip'],
  dominator:['sub','mystic'], breaker:['sub','sword'], enforcer:['bond','emptyShip'], flight:['sub','skywalker'],
  experiment:['sub','ritualist'], bruiser:['bond','indomShip'], armory:['bond','skillfulShip'], sui:['faction','sui'],
  combo:['bond','swiftShip'], watcher:['bond','visiShip'],
});
function assetFor(manifest, [group, key]) {
  if (group === 'bond') return bondIconUrl(manifest, key);
  if (group === 'sub') return manifest?.prof?.sub?.[key] || null;
  if (group === 'faction') return uiUrl(manifest, `campLogo/logo_${FACTION_LOGOS[key] || key}`);
  return null;
}

/** Resolve a real bond icon by the pact id first, then by the native bond record with the same name. */
export function resolvePactIconUrl(catalog, id, manifest, bonds = []) {
  const pact = catalog?.pacts?.[id];
  if (typeof pact?.nativeIconPath === 'string' && /^\/assets\/ui\/campLogo\/logo_[a-z_]+\.png$/.test(pact.nativeIconPath)) {
    return pact.nativeIconPath;
  }
  const direct = bondIconUrl(manifest, id);
  if (direct) return direct;
  const pactName = normalize(pact?.name);
  const native = pactName && (bonds || []).find((bond) => bond && normalize(bond.name) === pactName);
  if (native) {
    const url = bondIconUrl(manifest, native.bondId || native.id);
    if (url) return url;
  }
  const explicit = CURRENT_PACT_ASSETS[id];
  if (explicit) {
    const url = assetFor(manifest, explicit);
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
