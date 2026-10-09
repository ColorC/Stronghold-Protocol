import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { getCatalog } from '../../server/modes/independent/catalog.js';
import { gearIconSource } from '../../public/js/independent/gearIconMap.js';
import { itemIconUrl, skillRecordIconUrl } from '../../public/js/ui/assetUrls.js';

test('every workshop gear, badge, prize and attachment resolves to its chosen original item art', () => {
  const catalog = getCatalog();
  const data = getData();
  const targets = [
    ...Object.values(catalog.equipment).map((x) => ['gear', x.id, x]),
    ...Object.values(catalog.badges).map((x) => ['badge', x.id, x]),
    ...Object.values(catalog.prizes).map((x) => ['prize', x.id, x]),
    ...Object.values(catalog.attachments).map((x) => ['attachment', x.id, x]),
  ];
  assert.equal(targets.length, 158, 'catalog coverage changes require reviewing the mapping');
  const resolved = [];
  for (const [family, id, record] of targets) {
    const source = gearIconSource(id, { gear: catalog.equipment, prizes: catalog.prizes });
    assert.ok(source, `${family} ${id} has an explicit icon source`);
    assert.ok(source.reason, `${family} ${id} explains its source selection`);
    const item = source.type === 'item' && data.items[source.sourceItemId];
    if (source.type === 'item') assert.ok(item, `${family} ${id} maps to item ${source.sourceItemId}`);
    const url = source.type === 'skill'
      ? skillRecordIconUrl(data.assets, { skillId: source.skillId, iconId: source.skillId }, { empty: false })
      : itemIconUrl(data.assets, item);
    assert.ok(url, `${family} ${id} resolves through the native asset URL helper`);
    resolved.push({ family, id, name: record.name || record.newName || record.oldName || record.wording || id,
      sourceItemId: source.sourceItemId || source.skillId, sourceName: item?.name || source.skillId, url, reason: source.reason });
  }
  assert.ok(new Set(resolved.map((x) => x.url)).size >= 50, 'the mapping uses the distinct original item art collection');
  const byId = new Map(resolved.map((x) => [x.id, x.url]));
  const signatureGear = ['independent:巨锤盟约', 'independent:突袭盟约', 'independent:坚守盟约', 'independent:不屈盟约',
    'independent:护盾发生器', 'independent:精准盟约', 'independent:爆破部署台', 'independent:反冲空降仓', 'independent:便携式融毁教学仪'];
  assert.equal(new Set(signatureGear.map((id) => byId.get(id))).size, signatureGear.length, 'signature combat gear each has different original art');
  assert.notEqual(byId.get('precision'), byId.get('independent:精准盟约'), 'attack badge and precision equipment use distinct art');
  assert.notEqual(byId.get('mastery'), byId.get('growth-training-record'), 'ordinary-attack badge and training record use distinct art');
});
