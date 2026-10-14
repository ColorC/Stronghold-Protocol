// 共鸣 pages name the difficulties 轻松 / 标准 / 困难 / 深渊; the original mode keeps 标准 / 险境 / 绝境 / 终极模拟.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIFFICULTY_NAMES } from '../../shared/constants.js';
import { RESONANCE_DIFFICULTY_NAMES, resonanceDifficultyName } from '../../shared/resonance/difficulty-names.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const nodes = (v) => (v == null || typeof v !== 'object' ? [] : [v, ...[v.props?.children].flat(Infinity).flatMap(nodes)]);
const tagName = (vnode) => nodes(vnode).find((n) => n.props?.class === 'dtag__name')?.props.children;

test('共鸣 difficulty names are its own; the original mode keeps the 模拟 names', () => {
  assert.deepEqual(RESONANCE_DIFFICULTY_NAMES, { FUNNY: '轻松', NORMAL: '标准', HARD: '困难', ABYSS: '深渊' });
  assert.deepEqual(DIFFICULTY_NAMES, { FUNNY: '标准模拟', NORMAL: '险境模拟', HARD: '绝境模拟', ABYSS: '终极模拟' });
  assert.equal(resonanceDifficultyName('NORMAL'), '标准');
  assert.equal(resonanceDifficultyName('toString'), null);
});

test('DifficultyTag shows the page names: the original ones by default, the 共鸣 ones once the 共鸣 page sets them', async (t) => {
  let ui;
  try { ui = await import('../../public/js/ui/components.js'); } catch (error) {
    // components.js imports public/vendor (gitignored install output), which a sparse worktree does not have
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /public[\\/]vendor/.test(String(error.url ?? error.message))) return t.skip('public/vendor is not installed in this checkout');
    throw error;
  }
  const { DifficultyTag, setDifficultyNames } = ui;
  assert.equal(tagName(DifficultyTag({ difficulty: 'NORMAL', size: 'sm' })), '险境模拟');
  setDifficultyNames(RESONANCE_DIFFICULTY_NAMES);
  for (const [id, name] of Object.entries(RESONANCE_DIFFICULTY_NAMES)) assert.equal(tagName(DifficultyTag({ difficulty: id, size: 'lg' })), name);
  setDifficultyNames(null);
  assert.equal(tagName(DifficultyTag({ difficulty: 'HARD' })), '绝境模拟');
});

test('the 共鸣 page sets its names before rendering and no 共鸣 file keeps its own copy', () => {
  const main = read('public/js/resonance/main.js');
  assert.match(main, /setDifficultyNames\(RESONANCE_DIFFICULTY_NAMES\);[\s\S]*render\(/);
  const files = fs.readdirSync(path.join(ROOT, 'public/js/resonance'), { recursive: true }).filter((f) => String(f).endsWith('.js'));
  for (const file of files) {
    const source = read(path.join('public/js/resonance', String(file)));
    assert.doesNotMatch(source, /(标准|险境|绝境|终极)模拟/, `${file} shows an original-mode difficulty name`);
    assert.doesNotMatch(source, /FUNNY\s*:\s*'轻松'|'FUNNY',\s*'轻松'/, `${file} keeps a private copy of the 共鸣 names`);
  }
});
