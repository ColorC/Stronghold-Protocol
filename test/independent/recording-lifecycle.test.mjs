import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPlaybackId, LAST_COMPLETED_RECORDING_KEY, prepareNewRecordingUrl } from '../../public/js/independent/recordingLifecycle.js';

test('new capture removes the sealed id, keeps other URL state, and starts through a fresh capture', () => {
  const url = prepareNewRecordingUrl('https://game.test/independent.html?session=s1&recording=sealed-1&recordMax=1920');
  assert.equal(url.searchParams.get('recording'), null);
  assert.equal(url.searchParams.get('record'), '1');
  assert.equal(url.searchParams.get('session'), 's1');
  assert.equal(url.searchParams.get('recordMax'), '1920');
});

test('a recording URL keeps the referenced replay; fresh URL restores the last completed replay', () => {
  const storage = { getItem: (key) => key === LAST_COMPLETED_RECORDING_KEY ? 'sealed-1' : null };
  assert.equal(initialPlaybackId('https://game.test/independent.html?recording=active-2', storage), 'active-2');
  assert.equal(initialPlaybackId('https://game.test/independent.html?record=1', storage), 'sealed-1');
});
