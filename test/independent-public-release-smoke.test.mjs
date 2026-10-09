import test from 'node:test';
import assert from 'node:assert/strict';
import { publicEntryUrl, publicSessionUrl, publicRecordingUrl, publicReplayUrl } from '../tools/independent-public-release-urls.mjs';
import { expectedReplayCaption } from '../tools/independent-public-release-captions.mjs';
import { isExpectedMediaSeekCancellation } from '../tools/independent-public-release-checks.mjs';
import { workshopShowcaseNarration } from '../public/js/independent/workshopShowcaseNarration.js';

const id = '348715de-d66f-4d4a-ae33-c02821c57f1c';

for (const [base, prefix] of [
  ['https://workshop.colorc.cc/stronghold/independent.html', 'https://workshop.colorc.cc/stronghold/'],
  ['https://colorc.cc/independent.html', 'https://colorc.cc/'],
]) {
  test(`public API and replay URLs follow the entry prefix for ${base}`, () => {
    assert.equal(publicEntryUrl(base, 'independent-replay.html?recording=x'), `${prefix}independent-replay.html?recording=x`);
    assert.equal(publicSessionUrl(base, id), `${prefix}independent/api/sessions/${id}?catalog=0`);
    assert.equal(publicRecordingUrl(base, id), `${prefix}independent/api/recordings/${id}`);
    assert.equal(publicReplayUrl(base, id), `${prefix}independent-replay.html?recording=${id}`);
  });
}

test('entry URL construction safely encodes identifiers and retains query parameters', () => {
  const url = new URL(publicSessionUrl('https://example.test/stronghold/independent.html', 'a/b ?'));
  assert.equal(url.pathname, '/stronghold/independent/api/sessions/a%2Fb%20%3F');
  assert.equal(url.searchParams.get('catalog'), '0');
});

test('replay smoke expects the active showcase narration while retaining source cue identity', () => {
  const cue = { key: 'first-native-mechanic', text: 'Recorded source caption.' };
  assert.equal(expectedReplayCaption(workshopShowcaseNarration.recordingId, cue, workshopShowcaseNarration), '刺玫把海盗无赖的亡语变成退场增援。原生技能之外，多出一条召唤路线，后期还能由巫恋放大。');
  assert.equal(expectedReplayCaption('another-recording', cue, workshopShowcaseNarration), cue.text);
});

test('only an explicitly cancelled recording-media seek is classified as an expected media cancellation', () => {
  assert.equal(isExpectedMediaSeekCancellation('https://workshop.colorc.cc/stronghold/independent/api/recordings/id/media/playback/1', 'net::ERR_ABORTED'), true);
  assert.equal(isExpectedMediaSeekCancellation('https://workshop.colorc.cc/stronghold/independent/api/recordings/id', 'net::ERR_ABORTED'), false);
  assert.equal(isExpectedMediaSeekCancellation('https://workshop.colorc.cc/stronghold/independent/api/recordings/id/media/playback/1', 'net::ERR_FAILED'), false);
});
