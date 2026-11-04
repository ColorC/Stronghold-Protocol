import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRecordingApi, installAssaultRecording, recordingApiBase, recordingRequest } from '../../public/js/assault/recorder.js';
import { captionAt, normalizeCaptions } from '../../public/js/assault/replayCaptions.js';
import { rebaseRecordedAssets, timestampRange } from '../../public/js/assault/replayAssets.js';

const id = 'c3c3f89e-eae2-46ac-a118-a6deda3aa3b6';

test('recording entry: record=1 starts as the page loads, record=ui only shows the control, plain pages record nothing', () => {
  assert.deepEqual(recordingRequest('https://x.test/assault.html'), { mode: null, recordingId: '' });
  assert.deepEqual(recordingRequest('https://x.test/assault.html?record=1'), { mode: 'auto', recordingId: '' });
  assert.deepEqual(recordingRequest('https://x.test/assault.html?record=ui'), { mode: 'ui', recordingId: '' });
  assert.deepEqual(recordingRequest(`https://x.test/assault.html?recording=${id}`), { mode: 'auto', recordingId: id });
  assert.deepEqual(recordingRequest('https://x.test/assault.html?recording=bad&record=1'), { mode: null, recordingId: '' });
  assert.deepEqual(recordingRequest('not a url'), { mode: null, recordingId: '' });
});

test('plain assault pages never mount the recorder or touch the document', () => {
  let touched = false;
  const win = { location: { href: 'https://x.test/stronghold/assault/assault.html?run=abc' } };
  const doc = new Proxy({}, { get() { touched = true; return () => {}; } });
  assert.equal(installAssaultRecording({ win, doc }), null);
  assert.equal(touched, false);
});

test('recording api stays under the page directory so a gateway prefix is kept', async () => {
  assert.equal(recordingApiBase('https://workshop.colorc.cc/stronghold/assault/assault.html?record=1').href, 'https://workshop.colorc.cc/stronghold/assault/api/assault/recordings/');
  const calls = [];
  const api = createRecordingApi({ href: 'https://x.test/stronghold/assault/assault.html', fetchFn: async (url, init) => { calls.push([String(url), init]); return { ok: true, status: 200, json: async () => ({ ok: true, ack: 3 }) }; } });
  assert.equal((await api.start(null, '', { width: 1280, height: 720 })).ok, true);
  assert.equal((await api.events(id, [{ seq: 1 }])).ack, 3);
  await api.media(id, 2, new Blob(['x'], { type: 'video/webm' }), 1700000000000, 1234.6);
  await api.stop(id, {});
  assert.deepEqual(calls.map(([url]) => new URL(url).pathname), ['/stronghold/assault/api/assault/recordings/start', `/stronghold/assault/api/assault/recordings/${id}/events`,
    `/stronghold/assault/api/assault/recordings/${id}/media/2`, `/stronghold/assault/api/assault/recordings/${id}/stop`]);
  assert.equal(calls[2][1].headers['x-media-time-ms'], '1235');
  const failing = createRecordingApi({ href: 'https://x.test/a.html', fetchFn: async () => { throw new Error('offline'); } });
  assert.deepEqual(await failing.events(id, []), { ok: false, status: 0 });
});

test('captions normalize, sort and expire so a subtitle only shows while its mechanic is on screen', () => {
  const items = normalizeCaptions([{ at: 30, until: 33, text: ' 商店刷新 ' }, { at: 10, text: '伊内丝再部署，凛御银灰充能 4' }, { at: -1, text: 'x' }, { at: 5, text: '' }, null]);
  assert.deepEqual(items.map((c) => [c.at, c.until, c.text]), [[10, 14, '伊内丝再部署，凛御银灰充能 4'], [30, 33, '商店刷新']]);
  assert.equal(captionAt(items, 9.9), null);
  assert.equal(captionAt(items, 10).text, '伊内丝再部署，凛御银灰充能 4');
  assert.equal(captionAt(items, 14), null);
  assert.equal(captionAt(items, 32.9).text, '商店刷新');
  assert.equal(captionAt(items, 33), null);
  assert.deepEqual(normalizeCaptions(undefined), []);
});

test('recorded page urls are moved to the directory the replay is served from, under any gateway prefix', () => {
  const events = [{ type: 4, data: { href: 'https://workshop.colorc.cc/stronghold/assault/assault.html?record=1' } },
    { type: 2, data: { node: { attributes: { src: 'https://workshop.colorc.cc/stronghold/assault/assault-assets/a.png', href: 'https://elsewhere.test/x.css' }, text: 'url(https://workshop.colorc.cc/stronghold/assault/fonts/f.woff2)' } } }];
  rebaseRecordedAssets(events, 'http://127.0.0.1:13004/assault-review.html?recording=x');
  assert.equal(events[1].data.node.attributes.src, 'http://127.0.0.1:13004/assault-assets/a.png');
  assert.equal(events[1].data.node.attributes.href, 'https://elsewhere.test/x.css');
  assert.equal(events[1].data.node.text, 'url(http://127.0.0.1:13004/fonts/f.woff2)');
  const same = [{ type: 4, data: { href: 'https://a.test/p/assault.html' } }, { src: 'https://a.test/p/x.png' }];
  rebaseRecordedAssets(same, 'https://a.test/p/assault-replay.html');
  assert.equal(same[1].src, 'https://a.test/p/x.png');
  const root = [{ type: 4, data: { href: 'https://workshop.colorc.cc/stronghold/assault/assault.html' } }, { src: 'https://workshop.colorc.cc/assets/ui/hudPanel/icon_hp.png', other: 'https://workshop.colorc.cc/api/x' }];
  rebaseRecordedAssets(root, 'https://workshop.colorc.cc/stronghold/assault/assault-review.html');
  assert.equal(root[1].src, 'https://workshop.colorc.cc/stronghold/assault/assets/ui/hudPanel/icon_hp.png');
  assert.equal(root[1].other, 'https://workshop.colorc.cc/api/x');
  assert.deepEqual(timestampRange([{ t: 5 }, { t: 2 }, { t: Number.NaN }, { t: 9 }], (e) => e.t), { min: 2, max: 9 });
});

test('the replay page carries no transcoder and the recorder never streams canvas pixels through rrweb', async () => {
  const root = new URL('../../', import.meta.url);
  for (const file of ['public/js/assault/recorder.js', 'public/js/assault/replay.js', 'server/modes/assault/recordings.js']) {
    assert.doesNotMatch(await readFile(new URL(file, root), 'utf8'), /ffmpeg|child_process|execFile/i, file);
  }
  const capture = await readFile(new URL('public/js/recording/pageCapture.js', root), 'utf8');
  assert.match(capture, /recordCanvas: false/);
});
