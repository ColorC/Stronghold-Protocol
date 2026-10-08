import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyReplayNarration } from '../../public/js/independent/replayNarration.js';

const original = [
  { key: 'first', at: 3, text: 'old first', rect: { x: 1, y: 2 }, viewport: { width: 800, height: 600 } },
  { key: 'second', at: 1, text: 'old second', rect: { x: 9 }, viewport: { width: 1000, height: 700 } },
];

test('matching profile replaces the queue, preserves source geometry, removes old cues, and sorts', () => {
  const result = applyReplayNarration('recording-a', original, { recordingId: 'recording-a', cues: [
    { sourceKey: 'first', key: 'new-first', text: 'new narration' },
    { at: 2, key: 'inserted', text: 'new event-free cue', viewport: { width: 2 } },
  ] });
  assert.deepEqual(result.map(({ key, at }) => ({ key, at })), [{ key: 'inserted', at: 2 }, { key: 'new-first', at: 3 }]);
  assert.equal(result[1].text, 'new narration');
  assert.strictEqual(result[1].rect, original[0].rect);
  assert.strictEqual(result[1].viewport, original[0].viewport);
  assert.equal(result.some((cue) => cue.key === 'second'), false);
});

test('unknown recording keeps its recorded queue', () => {
  assert.deepEqual(applyReplayNarration('other', original, { recordingId: 'recording-a', cues: [] }), original);
});

test('does not mutate input queues, cues, or profile entries', () => {
  const source = { ...original[0] }; const queue = [source];
  const entry = { sourceKey: 'first', key: 'replaced', text: 'updated' }; const profile = { recordingId: 'recording-a', cues: [entry] };
  const beforeCue = { ...source }; const beforeEntry = { ...entry };
  applyReplayNarration('recording-a', queue, profile);
  assert.deepEqual(queue, [beforeCue]); assert.deepEqual(entry, beforeEntry);
});

test('missing source key throws a visible error', () => {
  assert.throws(() => applyReplayNarration('recording-a', original, { recordingId: 'recording-a', cues: [{ sourceKey: 'missing', key: 'x', text: 'x' }] }), /Narration source cue not found: missing/);
});

test('new cues require valid non-negative finite times and visible text and key', () => {
  for (const cue of [
    { at: -1, key: 'x', text: 'x' }, { at: Infinity, key: 'x', text: 'x' },
    { at: 1, key: ' ', text: 'x' }, { at: 1, key: 'x', text: '' },
  ]) assert.throws(() => applyReplayNarration('recording-a', [], { recordingId: 'recording-a', cues: [cue] }));
});

test('replay selects the workshop queue immediately after extracting recorded captions', async () => {
  const source = await readFile(new URL('../../public/js/independent/replay.js', import.meta.url), 'utf8');
  assert.match(source, /const recordedCues = records\.filter/);
  assert.match(source, /cues = applyReplayNarration\(id, recordedCues, workshopShowcaseNarration\);/);
});
