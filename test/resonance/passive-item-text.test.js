import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { getResonanceCatalog } from '../../server/modes/resonance/catalog.js';
import { resonanceDisplayCatalog } from '../../server/modes/resonance/display.js';
import { chemBaronItems } from '../../shared/resonance/prototype-economy.js';

const data = loadData('E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native');
// Set 13 words the game's own text never uses (0 hits in data/*.json). 护盾 is the game's layered-shield keyword; the
// HP shield these items give is the 屏障 the game's own items give (护盾无人机), so it reads 屏障.
const SOURCE_WORDS = /评分|护甲|法抗|护盾|法术强度|暴击|吸血|普攻|双抗|复起/;
const reduction = (rating) => Math.round(100 * rating / (100 + rating));

function passives(seed = 1) {
  const catalog = getResonanceCatalog(data, { rulesVersion: 3, seed });
  const display = resonanceDisplayCatalog(catalog, data);
  return { catalog, display, rows: Object.values(catalog.equipment).filter((item) => item.kind === 'passive') };
}

test('every passive item the player can read is written in the game\'s own terms', () => {
  const { catalog, display, rows } = passives();
  assert.equal(rows.length, 28);
  for (const item of rows) {
    assert.ok(display.equipment[item.id], `${item.id} is listed in the player catalog`);
    assert.equal(display.equipment[item.id].description, item.description);
    assert.doesNotMatch(JSON.stringify(display.equipment[item.id]), SOURCE_WORDS, `${item.id} ${item.name}`);
    assert.doesNotMatch(`${item.name}${item.description}`, SOURCE_WORDS, item.id);
  }
  for (const row of chemBaronItems) assert.doesNotMatch(`${row.name}${row.description}`, SOURCE_WORDS, `${row.id} fallback text`);
  assert.ok(Object.values(catalog.prototypeEconomy.chemBaron.marketOptions).every((row) => !SOURCE_WORDS.test(`${row.label}${row.description}`)), 'market options');
});

test('a rating is shown as the damage reduction it stands for, and the other stat words as their game terms', () => {
  const { rows } = passives();
  const byId = new Map(rows.map((item) => [item.id, item]));
  let rated = 0;
  for (const item of rows) {
    const { armor = 0, magicResist = 0 } = item.prototypeEconomyStats ?? {};
    if (!armor && !magicResist) continue;
    rated++;
    assert.equal(armor, magicResist, `${item.id} gives both ratings equally`);
    assert.ok(item.description.includes(`受到的物理与法术伤害降低${reduction(armor)}%`), `${item.id}: ${item.description}`);
  }
  assert.equal(rated, 7, 'the Bronze contraption and every tank and hexplating tier carry a rating');
  const silverTank = byId.get('prototype_chem13_silver_destabilizedchemtank').description;
  assert.match(silverTank, /受到的物理与法术伤害降低13%/);
  assert.match(silverTank, /获得相当于生命上限20%的屏障；之后每8秒获得相当于生命上限10%的屏障/);
  const silverHex = byId.get('prototype_chem13_silver_piltovenhexplating').description;
  assert.match(silverHex, /降低20%.*最多15层，叠满后共降低41%.*自身防御力与法术抗性之和50%的法术伤害/);
  assert.match(byId.get('prototype_chem13_prismatic_piltovenhexplating').description, /叠满后共降低69%.*之和50%的真实伤害/);
  assert.match(byId.get('prototype_chem13_gold_fleshripper').description, /攻击造成140%伤害的概率\+35%.*攻击力提高20%、伤害的15%转化为生命恢复，持续5秒/);
  assert.match(byId.get('prototype_chem13_prismatic_fleshripper').description, /首次被击倒时立刻复活并恢复100%最大生命值/);
  assert.match(byId.get('prototype_chem13_prismatic_shimmerbloom').description, /受屏障的队友另获法术伤害提高30%、攻击速度\+30/);
  assert.match(byId.get('prototype_chem_salvaged_revolver').description, /每5秒法术伤害额外提高10%，可叠加/);
  assert.match(byId.get('prototype_chem_salvaged_gauntlet').description, /普通攻击额外造成60点真实伤害/);
  assert.match(byId.get('prototype_chem13_gold_unleashedtoxins').description, /每次普通攻击额外获得/);
  assert.match(byId.get('prototype_chem_salvaged_contraption').description, /受到的物理与法术伤害降低9%。受到的伤害降低10%/);
});
