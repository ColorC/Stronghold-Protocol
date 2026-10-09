import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('first-action captions explain workshop differences without basic-play tutorials', async () => {
  const source = await readFile(new URL('../../public/js/independent/recorder.js', import.meta.url), 'utf8');
  const block = source.match(/const MECHANIC_TEXT = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1];
  assert.ok(block, 'mechanic caption map exists');
  for (const key of ['buy', 'equip', 'merge']) assert.match(block, new RegExp('\\b' + key + ':'));
  for (const key of ['ready', 'deploy', 'skill', 'use']) assert.doesNotMatch(block, new RegExp('\\b' + key + ':'));
  assert.match(block, /招募获得或首次上阵时触发/);
  assert.match(block, /科技档位/);
  assert.match(block, /装备栏/);
  assert.doesNotMatch(block, /徽章.*训练等级/);
  assert.match(block, /三名相同干员合成一名进阶干员/);
  assert.match(source, /打开干员的参考原卡，查看原始卡面记录/);
  assert.doesNotMatch(block, /所有装备|永久|一定是徽章/);
});
