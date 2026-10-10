import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReplayReviewConfig, createReplayCommentAnchor, reviewCommentHref } from '../../public/js/independent/replayReviewConfig.js';
import { waitForVideoSeek } from '../../public/js/independent/replayReviewSeek.js';

const root = new URL('../../', import.meta.url);
const html = await readFile(new URL('public/independent-review.html', root), 'utf8');
const replay = await readFile(new URL('public/js/independent/replay.js', root), 'utf8');
const id = 'c3c3f89e-eae2-46ac-a118-a6deda3aa3b6';

test('review shell builds same-origin replay and comments URLs with or without gateway prefix', () => {
  const prefixed = createReplayReviewConfig(`https://workshop.colorc.cc/stronghold/independent-review.html?recording=${id}`);
  assert.equal(new URL(prefixed.sourceUrl).pathname, '/stronghold/independent-replay.html');
  assert.equal(new URL(prefixed.sourceUrl).searchParams.get('recording'), id);
  assert.equal(new URL(prefixed.sourceUrl).searchParams.get('review'), '1');
  assert.equal(new URL(prefixed.commentsApi).pathname, `/stronghold/independent/api/recordings/${id}/comments`);
  assert.equal(prefixed.apiName, '__SP_REPLAY_REVIEW__');
  assert.equal(prefixed.title, '游玩回放与批注');
  assert.equal(prefixed.duration, 0);
  assert.equal('beats' in prefixed, false);

  const local = createReplayReviewConfig(`http://127.0.0.1:5460/independent-review.html?recording=${id}`);
  assert.equal(new URL(local.commentsApi).pathname, `/independent/api/recordings/${id}/comments`);
  assert.throws(() => createReplayReviewConfig('http://localhost/independent-review.html'), /无效/);
  assert.throws(() => createReplayReviewConfig(`http://localhost/independent-review.html?recording=${id.replace('-4', '-1')}`), /无效/);
});

test('comment anchors retain precise time and nested-frame rectangle without exposing selectors in links', () => {
  const anchor = createReplayCommentAnchor({
    time: 1064.9517,
    selector: '.board > canvas',
    framePath: ['#stage > iframe'],
    tag: 'canvas',
    textExcerpt: '  战斗画面  ',
    rect: { x: 4.4, y: 8.6, width: 120.2, height: 80.7 },
    viewport: { width: 1280, height: 720 },
  });
  assert.deepEqual(anchor, {
    time_sec: 1064.952,
    selector: '.board > canvas',
    frame_path: ['#stage > iframe'],
    tag: 'canvas',
    text_excerpt: '战斗画面',
    rect: { x: 4, y: 9, width: 120, height: 81 },
    viewport: { width: 1280, height: 720 },
  });
  const href = reviewCommentHref(`https://example.test/stronghold/independent-review.html?recording=${id}`, anchor.time_sec, 'comment-2');
  const url = new URL(href);
  assert.equal(url.pathname, '/stronghold/independent-review.html');
  assert.equal(url.searchParams.get('t'), '1064.952');
  assert.equal(url.searchParams.get('comment'), 'comment-2');
  assert.equal(url.searchParams.get('recording'), id);
});

test('video seek resolves only after seeked and the target frame, and times out explicitly', async () => {
  const callbacks = [];
  const video = new EventTarget();
  let currentTime = 0;
  let seeking = false;
  let callbacksAtSeek = 0;
  video.readyState = 1;
  Object.defineProperty(video, 'seeking', { get: () => seeking });
  Object.defineProperty(video, 'currentTime', { get: () => currentTime, set: (value) => { callbacksAtSeek = callbacks.length; currentTime = value; seeking = true; } });
  video.requestVideoFrameCallback = (callback) => { callbacks.push(callback); return callbacks.length; };
  video.cancelVideoFrameCallback = () => {};
  let resolved = false;
  const pending = waitForVideoSeek(video, 12.5, { timeoutMs: 100 });
  pending.then(() => { resolved = true; });
  assert.equal(callbacksAtSeek, 1, 'frame observation is registered before currentTime changes');
  assert.equal(currentTime, 12.5);
  video.readyState = 2;
  seeking = false;
  video.dispatchEvent(new Event('seeked'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false, 'seeked alone is not enough before the decoded frame');
  callbacks.shift()(0, { mediaTime: 12.5 });
  await pending;
  assert.equal(resolved, true);

  const alreadySeeking = new EventTarget();
  let inFlightTime = 8;
  let inFlightSeeking = true;
  alreadySeeking.readyState = 2;
  Object.defineProperty(alreadySeeking, 'seeking', { get: () => inFlightSeeking });
  Object.defineProperty(alreadySeeking, 'currentTime', { get: () => inFlightTime, set: value => { inFlightTime = value; } });
  alreadySeeking.requestVideoFrameCallback = callback => { callbacks.push(callback); return callbacks.length; };
  alreadySeeking.cancelVideoFrameCallback = () => {};
  const inFlight = waitForVideoSeek(alreadySeeking, 8, { timeoutMs: 100 });
  inFlightSeeking = false;
  alreadySeeking.dispatchEvent(new Event('seeked'));
  callbacks.pop()(0, { mediaTime: 8 });
  await inFlight;

  const stuck = new EventTarget();
  Object.defineProperty(stuck, 'currentTime', { value: 0, writable: true });
  stuck.readyState = 1;
  await assert.rejects(waitForVideoSeek(stuck, 3, { timeoutMs: 5 }), /定位超时/);
});

test('review DOM uses player controls, precise async seek and player-facing copy only', () => {
  for (const id of ['stage', 'film', 'toggle', 'seek', 'pick', 'comments', 'composer', 'sourceLink']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /await current\.setTime\(target\)/);
  assert.match(html, /film\.src=config\.sourceUrl/);
  assert.doesNotMatch(html, /config\.source[,)]/);
  assert.match(html, /await setTime\(anchor\.time_sec\|\|0\)/);
  assert.match(html, /const state=readState\(\);\s*if\(state&&!state\.paused\)/);
  assert.match(html, /stage\.scrollIntoView\(\{block:stage\.getBoundingClientRect\(\)\.height>innerHeight\?'start':'center'/);
  assert.match(html, /reviewCommentHref\(location\.href/);
  assert.match(html, /method:'PATCH'/);
  assert.match(html, /method:'DELETE'/);
  assert.match(replay, /window\.__SP_REPLAY_REVIEW__=reviewApi/);
  assert.match(replay, /ready:initialized&&!seeking/);
  assert.match(replay, /viewport:replayViewport,error:initializationError/);
  assert.match(replay, /ix-replay-review-mode \.ix-replay__screen/);
  assert.match(html, /stage\.style\.aspectRatio=`\$\{state\.viewport\.width\} \/ \$\{state\.viewport\.height\}`/);
  assert.match(html, /if\(state\.error\)\{setStatusText\(state\.error,'err'\)/);
  assert.match(replay, /回放载入失败，请检查链接或稍后重试/);
  assert.match(html, /回放链接无效，请检查链接后重试/);
  assert.match(replay, /await waitForVideoSeek\(mediaVideo,target\)/);
  assert.match(replay, /mediaVideo\.seeking\)await waitForVideoSeek/);
  assert.doesNotMatch(html, /bilibili|WEB SOURCE|真源|原工程|config\.beats|beat_id/i);
  assert.doesNotMatch(html, /meta\.textContent=.*selector|composerEl\.textContent=.*selector/);
});
