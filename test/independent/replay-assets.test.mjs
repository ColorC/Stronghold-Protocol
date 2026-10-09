import test from 'node:test';
import assert from 'node:assert/strict';
import { rebaseRecordedAssets, timestampRange } from '../../public/js/independent/replayAssets.js';

const recordedEvents = () => [{ type: 4, data: { href: 'http://localhost:3222/independent.html' } }, {
  type: 2, data: { node: { attributes: {
    href: 'http://localhost:3222/css/game.css?v=4#screen',
    font: '/fonts/ui.woff2?rev=2',
    avatar: '/assets/operators/red.webp?size=2',
    vendor: 'http://localhost:3222/vendor/rrweb.js',
    game: 'http://localhost:3222/independent.html?session=play-1#board',
    external: 'https://cdn.example.net/assets/shared.webp',
  }, cssText: 'background-image:url(/assets/panel.webp);src:url(https://cdn.example.net/fonts/public.woff2)' } } },
  { type: 3, data: { source: 0, texts: ['http://localhost:3222/css/not-a-link.css'] } }];

test('rebase recorded local assets onto the root app entry and preserve URL parts', () => {
  const events = recordedEvents();
  rebaseRecordedAssets(events, 'https://workshop.colorc.cc/independent-replay.html?recording=r1');
  const attrs = events[1].data.node.attributes;
  assert.equal(attrs.href, 'https://workshop.colorc.cc/css/game.css?v=4#screen');
  assert.equal(attrs.font, 'https://workshop.colorc.cc/fonts/ui.woff2?rev=2');
  assert.equal(attrs.avatar, 'https://workshop.colorc.cc/assets/operators/red.webp?size=2');
  assert.equal(attrs.vendor, 'https://workshop.colorc.cc/vendor/rrweb.js');
  assert.equal(attrs.game, 'https://workshop.colorc.cc/independent.html?session=play-1#board');
  assert.equal(attrs.external, 'https://cdn.example.net/assets/shared.webp');
  assert.match(events[1].data.node.cssText, /url\(https:\/\/workshop\.colorc\.cc\/assets\/panel\.webp\)/);
  assert.match(events[1].data.node.cssText, /url\(https:\/\/cdn\.example\.net\/fonts\/public\.woff2\)/);
});

test('rebase recorded same-origin URLs under a Workshop subpath without changing third-party sources', () => {
  const events = recordedEvents();
  rebaseRecordedAssets(events, 'https://workshop.colorc.cc/stronghold/independent-replay.html?recording=r2');
  const attrs = events[1].data.node.attributes;
  assert.equal(attrs.href, 'https://workshop.colorc.cc/stronghold/css/game.css?v=4#screen');
  assert.equal(attrs.font, 'https://workshop.colorc.cc/stronghold/fonts/ui.woff2?rev=2');
  assert.equal(attrs.avatar, 'https://workshop.colorc.cc/stronghold/assets/operators/red.webp?size=2');
  assert.equal(attrs.vendor, 'https://workshop.colorc.cc/stronghold/vendor/rrweb.js');
  assert.equal(attrs.game, 'https://workshop.colorc.cc/stronghold/independent.html?session=play-1#board');
  assert.equal(attrs.external, 'https://cdn.example.net/assets/shared.webp');
  assert.match(events[1].data.node.cssText, /url\(https:\/\/workshop\.colorc\.cc\/stronghold\/assets\/panel\.webp\)/);
});

test('timestamp range handles long replay event arrays without argument spreading', () => {
  const events = Array.from({ length: 150_001 }, (_, index) => ({ timestamp: 45_000 + index }));
  events[0].timestamp = -125;
  events.at(-1).timestamp = 900_000;
  events[75_000].timestamp = Infinity;
  assert.deepEqual(timestampRange(events, (event) => event.timestamp), { min: -125, max: 900_000 });
  assert.deepEqual(timestampRange([{ timestamp: NaN }], (event) => event.timestamp), { min: Infinity, max: -Infinity });
});
