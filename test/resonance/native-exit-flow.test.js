import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const modalUrl = new URL('../../public/js/resonance/native/exitModal.js', import.meta.url);
const appUrl = new URL('../../public/js/resonance/app.js', import.meta.url);
const connectionUrl = new URL('../../public/js/resonance/native-connection.js', import.meta.url);
const [modalSource, appSource, connectionSource] = await Promise.all([
  readFile(modalUrl, 'utf8'), readFile(appUrl, 'utf8'), readFile(connectionUrl, 'utf8'),
]);
const helperMatch = modalSource.match(/export async function saveAndReturn\([\s\S]*?\n}\n/);
assert.ok(helperMatch, 'the component uses an independently testable exit transaction');
const saveAndReturn = runInNewContext(`(${helperMatch[0].replace('export async function', 'async function')})`);

test('native exit pauses an active battle and returns only after the server pause is confirmed', async () => {
  const events = [];
  await saveAndReturn({
    needsPause: true,
    request: async (type, payload) => { events.push(['request', type, payload]); },
    confirmPaused: async () => { events.push(['confirmed']); return true; },
    onLeave: async () => { events.push(['leave']); },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['request', 'g.pause', { on: true }], ['confirmed'], ['leave'],
  ]);
});

test('native exit keeps the route open if pause fails or is not confirmed', async () => {
  let left = false;
  await assert.rejects(saveAndReturn({
    needsPause: true,
    request: async () => { throw new Error('pause rejected'); },
    confirmPaused: async () => false,
    onLeave: () => { left = true; },
  }), /pause rejected/);
  await assert.rejects(saveAndReturn({
    needsPause: true,
    request: async () => {},
    confirmPaused: async () => false,
    onLeave: () => { left = true; },
  }), /尚未确认暂停/);
  assert.equal(left, false);
});

test('prep or already-paused exit does not send an unsupported leave/autoplay action', async () => {
  let requests = 0;
  let left = 0;
  await saveAndReturn({ needsPause: false, request: async () => { requests += 1; }, onLeave: () => { left += 1; } });
  assert.equal(requests, 0);
  assert.equal(left, 1);
  assert.doesNotMatch(modalSource, /g\.leave|room\.leave|g\.autoplay/);
});

test('native app route callback clears session URL and state while preserving the saved-session resume entry', () => {
  assert.match(appSource, /const leaveSession = \(\) => \{[\s\S]*sessionUrl\(null\)[\s\S]*url\.hash = ''[\s\S]*setSession\(null\)[\s\S]*setStep\(0\)[\s\S]*setReplayMode\(false\)/);
  assert.match(appSource, /NativeMatchConnection\} key=\$\{session\.id\} id=\$\{session\.id\} onLeave=\$\{leaveSession\}/);
  assert.match(connectionSource, /export function NativeMatchConnection\(\{\s*id,\s*onLeave,/);
  assert.match(connectionSource, /\$\{GameScreen\} onLeave=\$\{onLeave\} libraryCatalog=\$\{libraryCatalog\} activeIds=\$\{activeIds\} \/>/);
  assert.match(connectionSource, /return \(\) => \{[\s\S]*net\.close\(\)[\s\S]*store\.set\(\{ match: emptyMatch\(\), room: null \}\)/);
  assert.doesNotMatch(appSource, /localStorage\.removeItem\(LAST\)/);
});
