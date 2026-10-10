import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRecordingHttp } from '../../server/modes/independent/recordings.js';

test('rendered recording HTTP serves only published round files with bounded range reads', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-rendered-recording-test-'));
  const recordings = path.join(root, 'recordings'); const rendered = path.join(root, 'rendered');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const idDir = path.join(rendered, id);
  await mkdir(path.join(recordings, id), { recursive: true }); await mkdir(idDir, { recursive: true });
  await writeFile(path.join(recordings, id, 'meta.json'), JSON.stringify({ id, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
  await writeFile(path.join(idDir, 'battle-1.webm'), 'real-round-webm');
  await writeFile(path.join(idDir, 'prep-1.webm'), 'clear-prep-webm');
  await writeFile(path.join(idDir, 'showcase.mp4'), 'narrated-mp4');
  await writeFile(path.join(rendered, 'secret.webm'), 'must-not-be-served');
  const manifest = { schemaVersion: 1, recordingId: id, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sourceRevision: '1a7dd1d', viewport: { width: 2560, height: 1440 }, fps: 30, videoBitsPerSecond: 16000000,
    clips: [{ round: 1, startSecond: 0, endSecond: 12.5, mediaDuration: 12.5, file: '../secret.webm' },
      { round: 2, startSecond: 12.5, endSecond: 20, mediaDuration: 7.5, file: 'battle-2.webm' },
      { kind: 'prep', index: 1, round: null, startSecond: 20, endSecond: 24, mediaDuration: 4, file: '../secret.webm' }],
    movie: { file: '../secret.webm', mediaDuration: 30 } };
  await writeFile(path.join(idDir, 'manifest.json'), JSON.stringify(manifest));
  const previousRenderDirectory = process.env.SP_RECORDING_RENDER_DIRECTORY;
  process.env.SP_RECORDING_RENDER_DIRECTORY = rendered;
  let handle;
  try { handle = createRecordingHttp({ directory: recordings, sessionDirectory: path.join(root, 'sessions') }); }
  finally {
    if (previousRenderDirectory === undefined) delete process.env.SP_RECORDING_RENDER_DIRECTORY;
    else process.env.SP_RECORDING_RENDER_DIRECTORY = previousRenderDirectory;
  }
  const server = createServer(async (req, res) => {
    if (!await handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/independent/api/recordings/${id}/rendered`;

  const manifestResponse = await fetch(url);
  assert.equal(manifestResponse.status, 200);
  const published = await manifestResponse.json();
  assert.equal(published.ok, true);
  assert.equal(published.manifest.clips[0].file, 'battle-1.webm', 'manifest path is recomputed from round');

  const full = await fetch(`${url}/1`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/webm');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(await full.text(), 'real-round-webm');

  const partial = await fetch(`${url}/1`, { headers: { range: 'bytes=1-4' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 1-4/15');
  assert.equal(await partial.text(), 'eal-');

  const unsatisfiable = await fetch(`${url}/1`, { headers: { range: 'bytes=90-99' } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get('content-range'), 'bytes */15');
  assert.equal((await fetch(`${url}/2`)).status, 404, 'published clip without its completed output is not served');
  assert.equal(published.manifest.clips[2].file, 'prep-1.webm');
  assert.equal(published.manifest.movie.file, 'showcase.mp4');
  const prepVideo = await fetch(url + '/prep-1');
  assert.equal(prepVideo.status, 200); assert.equal(await prepVideo.text(), 'clear-prep-webm');
  const movieVideo = await fetch(url + '/showcase', { headers: { range: 'bytes=0-3' } });
  assert.equal(movieVideo.status, 206); assert.equal(movieVideo.headers.get('content-type'), 'video/mp4');
  assert.equal(await movieVideo.text(), 'narr');
  const movieHead = await fetch(url + '/showcase', { method: 'HEAD' });
  assert.equal(movieHead.status, 200); assert.equal(movieHead.headers.get('content-length'), '12');
  assert.equal(await movieHead.text(), '');
  assert.equal((await fetch(url + '/prep-01')).status, 400);
  assert.equal((await fetch(url + '/prep-2')).status, 404);
  assert.equal((await fetch(`${url}/01`)).status, 400);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url, { headers: { origin: 'http://elsewhere.invalid' } })).status, 403);

  await writeFile(path.join(idDir, 'manifest.json'), '{broken');
  const corrupt = await fetch(url);
  assert.equal(corrupt.status, 500);
  assert.equal((await corrupt.json()).error, 'RENDERED_MANIFEST_INVALID');
  await readFile(path.join(idDir, 'battle-1.webm'));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/independent/api/recordings/cccccccc-cccc-4ccc-8ccc-cccccccccccc/rendered`)).status, 404,
    'render artifact without a source recording meta is hidden');
});
