// 卫戍协议：工坊 has its own look (user 10-07: 「工坊模式的视觉要和已有的视觉拉开差异…干员的等级也用星或者杠数或者其他方式来表现而非罗马数字」):
// css/workshop.css under html.ix-ws, tiers as pips in the DOM (components.js setTierLook) and on the board
// (render/textures.js setTierChipLook through createFieldView({ tierChips })). The original page keeps its look.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi } from '../render/fakepixi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('the workshop page and the original page', () => {
  test('independent.html is html.ix-ws and loads workshop.css after every other stylesheet', () => {
    const page = read('public/independent.html');
    assert.match(page, /<html lang="zh-CN" class="ix-ws">/);
    const sheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(sheets.at(-1), '/css/workshop.css');
    assert.ok(sheets.includes('/css/independent.css'));
  });

  test('the original page never loads the workshop look', () => {
    const page = read('public/index.html');
    assert.doesNotMatch(page, /workshop\.css/);
    assert.doesNotMatch(page, /ix-ws/);
  });

  test('every workshop rule is scoped to html.ix-ws (so it cannot leak into a page that would load it by mistake)', () => {
    const css = read('public/css/workshop.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    // top-level commas only (a list inside :is(…) belongs to one selector)
    const split = (list) => {
      const out = []; let depth = 0; let cur = '';
      for (const ch of list) {
        if (ch === '(') depth++; else if (ch === ')') depth--;
        if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      return [...out, cur.trim()].filter(Boolean);
    };
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => split(m[1]));
    assert.ok(selectors.length > 60, `${selectors.length} selectors`);
    for (const s of selectors) assert.match(s, /^html\.ix-ws\b/, s);
  });

  test('the workshop page asks for pips: DOM tiers at start-up, board chips with the field view', () => {
    assert.match(read('public/js/independent/main.js'), /setTierLook\('pips'\)/);
    assert.match(read('public/js/independent/game.js'), /useFieldView\(hostRef, FIELD_OPTS\)/);
    assert.match(read('public/js/independent/game.js'), /tierChips: 'pips'/);
    // the original game screen mounts its field without options (roman chips)
    assert.match(read('public/js/screens/game.js'), /useFieldView\(hostRef\)/);
  });
});

describe('TierPips (components.js)', () => {
  test('the tier as that many pips, with the tier, size and elite classes; roman is the default look', async () => {
    const { TierPips, tierLookOf, setTierLook } = await import('../../public/js/ui/components.js');
    assert.equal(tierLookOf(), 'roman');
    for (const t of [1, 2, 3, 4, 5, 6]) {
      const v = TierPips({ tier: t, size: 'sm' });
      assert.equal(v.type, 'span');
      assert.match(v.props.class, new RegExp(`\\btier--pips\\b.*\\btier--${t}\\b.*\\btier--sm\\b`));
      const pips = [v.props.children].flat(3).filter((c) => c && c.type === 'i');
      assert.equal(pips.length, t, `tier ${t}`);
      assert.equal(v.props['aria-label'], `${t}阶`);
    }
    assert.match(TierPips({ tier: 9, golden: true }).props.class, /\btier--6\b.*\btier--golden\b/);
    setTierLook('pips'); assert.equal(tierLookOf(), 'pips');
    setTierLook('anything'); assert.equal(tierLookOf(), 'roman');
  });
});

describe('tiers come from the mode\'s catalog, not the upstream chess record', () => {
  // a roster that moved operators (workshop-parity 39edaab: 斯卡蒂 3 → 1, 能天使 4 → 2, …): any catalog tier wins
  const catalog = { operators: {
    char_a: { tier: 1, eliteChessId: 'char_a_g' }, char_a_g: { tier: 1, elite: true },
    char_b: { tier: 4, eliteChessId: 'char_b_g' },
  } };

  test('a replay\'s operators — field list and spawn events, elite forms too — carry the catalog tier', async () => {
    const { withCatalogTiers, catalogTiers } = await import('../../public/js/independent/model.js');
    assert.deepEqual([...catalogTiers(catalog)].sort(), [['char_a', 1], ['char_a_g', 1], ['char_b', 4], ['char_b_g', 4]]);
    const replay = {
      round: 3, field: { fieldId: 'f', units: [{ id: 1, defId: 'char_a', tier: 3 }, { id: 9, defId: 'enemy_1007_slime', tier: 1 }] },
      frames: [
        { snap: { t: 0 }, ev: [['spawn', { id: 2, defId: 'char_b_g', tier: 2, golden: true }], ['hit', 2, 9]] },
        { snap: { t: 1 }, ev: [['spawn', { id: 3, defId: 'token_x', tier: 1 }]] },
        { snap: { t: 2 }, ev: [] },
      ],
    };
    const before = JSON.stringify(replay);
    const out = withCatalogTiers(replay, catalog);
    assert.equal(JSON.stringify(replay), before, 'the fetched replay is not mutated');
    assert.equal(out.field.units[0].tier, 1);
    assert.equal(out.field.units[1].tier, 1, 'an enemy keeps its own');
    assert.equal(out.frames[0].ev[0][1].tier, 4, 'an elite form reads its base entry when it has none');
    assert.deepEqual(out.frames[0].ev[1], ['hit', 2, 9]);
    assert.equal(out.frames[1].ev[0][1].tier, 1, 'a summon keeps its own');
    assert.equal(out.frames[2], replay.frames[2], 'frames without spawns are passed through');
    assert.equal(withCatalogTiers(null, catalog), null);
  });

  test('the board, the detail card and the battle read the catalog tier', () => {
    // prep pieces: the piece's tier (model.js prepView, from the catalog) wins over the chess record's
    assert.match(read('public/js/render/app.js'), /tier: piece\.tier \|\| rec\?\.tier \|\| 1, golden/);
    assert.match(read('public/js/independent/model.js'), /tier: catalog\?\.operators\?\.\[p\.chessId\]\?\.tier \?\? 1/);
    // the detail card's header chip: the form's catalog entry
    assert.match(read('public/js/independent/detail.js'), /const tier = formOp\?\.tier \?\? opBase\?\.tier;/);
    // the battle replay is mapped as it is fetched
    assert.match(read('public/js/independent/game.js'), /withCatalogTiers\(await api\.replay\(id, fought\.round\), catalog\)/);
  });
});

describe('board tier chips (render/textures.js)', () => {
  let fake; let T;
  before(async () => { fake = installFakePixi(); T = await import('../../public/js/render/textures.js'); });
  after(() => { T.setTierChipLook('roman'); fake.restore(); });

  test('pips: one row up to three, a second row under them for 4–6, centred on the chip', () => {
    const w = 64; const h = 44;
    for (const t of [1, 2, 3, 4, 5, 6]) {
      const pts = T.chipPips(t, w, h);
      assert.equal(pts.length, t);
      const rows = [...new Set(pts.map((p) => p[1]))];
      assert.equal(rows.length, t <= 3 ? 1 : 2, `tier ${t}`);
      const xs = pts.map((p) => p[0]);
      assert.ok(Math.abs((Math.min(...xs.slice(0, Math.min(3, t))) + Math.max(...xs.slice(0, Math.min(3, t)))) / 2 - w / 2) < 1e-9);
      for (const [x, y] of pts) assert.ok(x > 6 && x < w - 6 && y > 6 && y < h - 6, `inside the plate (tier ${t})`);
    }
  });

  test('the look switches in place: same canvas and base texture, numerals for roman, round pips for pips', () => {
    const chip = T.tierChip(5, false);
    const canvas = fake.canvases.find((c) => c.width === 64 * 7 && c.height === 44 * 2);
    assert.ok(canvas, 'the chip atlas');
    const ctx = canvas.getContext('2d');
    const calls = { text: 0, arc: 0 };
    const fillText = ctx.fillText; const arc = ctx.arc;
    ctx.fillText = function (...a) { calls.text++; return fillText?.apply(this, a); };
    ctx.arc = function (...a) { calls.arc++; return arc?.apply(this, a); };
    const n0 = fake.canvases.length;
    T.setTierChipLook('pips');
    assert.equal(T.tierChipLook(), 'pips');
    assert.equal(calls.text, 0, 'no numerals');
    assert.ok(calls.arc >= 2 * (1 + 2 + 3 + 4 + 5 + 6), 'every pip of both plates');
    assert.equal(fake.canvases.length, n0, 'no new canvas');
    assert.equal(T.tierChip(5, false).baseTexture, chip.baseTexture);
    calls.text = 0;
    T.setTierChipLook('roman');
    assert.equal(T.tierChipLook(), 'roman');
    assert.equal(calls.text, 12, 'the six numerals on both plates again');
  });
});
