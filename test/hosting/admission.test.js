import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmission } from '../../server/hosting/admission.js';

const request = (cookie = '', method = 'POST', url = endpoint) => ({ method, url, headers: { host: 'localhost', cookie }, socket: {} });
const response = () => {
  const listeners = new Map();
  return { headers: {}, destroyed: false, writableEnded: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, h) { this.status = status; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); },
    end(body) { this.body = body; this.writableEnded = true; },
    once(event, callback) { listeners.set(callback, event); },
    off(event, callback) { if (listeners.get(callback) === event) listeners.delete(callback); },
    emit(event) { for (const [callback, name] of listeners) if (name === event) callback(); },
  };
};
const endpoint = '/independent/api/admission';
const token = (res) => res.headers['set-cookie'].split(';')[0];

test('50 active visitors admitted, 51st refused before any game modules or assets', () => {
  const gate = createAdmission({ maxActive: 50 }); const cookies = [];
  for (let i = 0; i < 50; i++) { const res = response(); assert.equal(gate.handle(request('', 'GET'), res, '/independent.html'), false); cookies.push(token(res)); }
  const res = response(); assert.equal(gate.handle(request('', 'GET'), res, '/independent.html'), true);
  assert.equal(res.status, 503); assert.equal(res.headers['retry-after'], '30'); assert.ok(Buffer.byteLength(res.body) < 1024);
  assert.doesNotMatch(res.body, /src=|stylesheet|fetch\(/); assert.equal(gate.stats().active, 50);
  const renewal = response(); gate.handle(request(cookies[0]), renewal, endpoint); assert.equal(renewal.status, 200); assert.equal(gate.stats().active, 50);
});
test('lease release and expiry reclaim capacity; saved-game API cannot bypass admission', () => {
  let now = 0; const gate = createAdmission({ maxActive: 1, ttlMs: 3000, now: () => now });
  const first = response(); gate.handle(request(), first, endpoint); const cookie = token(first);
  const missing = response(); assert.equal(gate.handle(request(), missing, '/independent/api/sessions'), true); assert.equal(missing.status, 403);
  const admitted = response(); assert.equal(gate.handle(request(cookie), admitted, '/independent/api/sessions'), false);
  now = 3000; const expired = response(); gate.handle(request(cookie), expired, '/independent/api/sessions'); assert.equal(expired.status, 403);
  const next = response(); gate.handle(request(), next, endpoint); assert.equal(next.status, 200);
  const released = response(); gate.handle(request(token(next), 'DELETE'), released, endpoint); assert.equal(gate.stats().active, 0);
});
test('original multiplayer sockets share capacity and disabled mode stays compatible', () => {
  let sockets = 49; const gate = createAdmission({ maxActive: 50, otherActive: () => sockets });
  const one = response(); gate.handle(request(), one, endpoint); assert.equal(one.status, 200); assert.equal(gate.canEnter(), false);
  sockets = 48; assert.equal(gate.canEnter(), true);
  const disabled = createAdmission(); assert.equal(disabled.handle(request(), response(), '/independent/api/sessions'), false);
  const res = response(); disabled.handle(request(), res, endpoint); assert.equal(JSON.parse(res.body).lease.enabled, false);
});
test('cross-origin renewals rejected and invalid configuration fails boot', () => {
  const gate = createAdmission({ maxActive: 50 }); const req = request(); req.headers.origin = 'https://other.test';
  const res = response(); gate.handle(req, res, endpoint); assert.equal(res.status, 403); assert.equal(gate.stats().active, 0);
  assert.throws(() => createAdmission({ maxActive: NaN }), /SP_INDEPENDENT_MAX_ACTIVE/);
});

test('FIFO queue is bounded, newcomers cannot cut, cancellation releases the next place', () => {
  const gate = createAdmission({ maxActive: 1, maxWaiting: 2 });
  const active = response(); gate.handle(request(), active, endpoint); const activeCookie = token(active);
  const first = response(); gate.handle(request('', 'GET', '/independent.html'), first, '/independent.html');
  assert.equal(first.status, 200); assert.match(first.body, /hostingWait\.js/); assert.doesNotMatch(first.body, /stylesheet|\/assets\/|\/vendor\//);
  const firstCookie = token(first);
  const second = response(); gate.handle(request('', 'POST'), second, endpoint);
  assert.equal(second.status, 202); assert.equal(JSON.parse(second.body).queued.position, 2); const secondCookie = token(second);
  const full = response(); gate.handle(request('', 'POST'), full, endpoint);
  assert.equal(full.status, 503); assert.equal(full.headers['retry-after'], '30');
  const cancelledPoll = response(); gate.handle(request(firstCookie, 'POST', `${endpoint}?wait=1`), cancelledPoll, endpoint);
  const cancel = response(); gate.handle(request(firstCookie, 'DELETE'), cancel, endpoint);
  assert.equal(cancel.status, 200); assert.equal(cancelledPoll.status, 410); assert.equal(JSON.parse(cancelledPoll.body).error.code, 'QUEUE_CANCELLED');
  const newcomer = response(); gate.handle(request('', 'POST'), newcomer, endpoint);
  assert.equal(newcomer.status, 202); assert.equal(JSON.parse(newcomer.body).queued.position, 2);
  const secondPoll = response(); gate.handle(request(secondCookie, 'POST', `${endpoint}?wait=1`), secondPoll, endpoint);
  const release = response(); gate.handle(request(activeCookie, 'DELETE'), release, endpoint);
  assert.equal(secondPoll.status, 200); assert.equal(JSON.parse(secondPoll.body).lease.enabled, true);
  assert.equal(gate.stats().active, 1); assert.equal(gate.stats().waiting, 1);
  gate.close();
});

test('queue expires, recycles capacity and closes pending long polls', () => {
  let now = 0; const gate = createAdmission({ maxActive: 1, maxWaiting: 1, ttlMs: 5000, queueTtlMs: 4000, now: () => now });
  const active = response(); gate.handle(request(), active, endpoint);
  const queued = response(); gate.handle(request('', 'POST'), queued, endpoint); const queuedCookie = token(queued);
  const poll = response(); gate.handle(request(queuedCookie, 'POST', `${endpoint}?wait=1`), poll, endpoint);
  now = 4000; assert.equal(gate.stats().waiting, 0); assert.equal(poll.status, 410);
  const next = response(); gate.handle(request('', 'POST'), next, endpoint); assert.equal(next.status, 202); assert.equal(JSON.parse(next.body).queued.position, 1);
  const pendingPoll = response(); gate.handle(request(token(next), 'POST', `${endpoint}?wait=1`), pendingPoll, endpoint);
  gate.close(); assert.equal(pendingPoll.status, 503); assert.equal(JSON.parse(pendingPoll.body).error.code, 'SERVER_CLOSING');
});

test('online queue renewals extend only expiry, keep FIFO identity and limit duplicate polls', async () => {
  let now = 0; const gate = createAdmission({ maxActive: 1, maxWaiting: 2, ttlMs: 20000, queueTtlMs: 10000, now: () => now });
  const active = response(); gate.handle(request(), active, endpoint);
  const head = response(); gate.handle(request('', 'POST'), head, endpoint); const headCookie = token(head);
  const next = response(); gate.handle(request('', 'POST'), next, endpoint); const nextCookie = token(next);
  const original = JSON.parse(next.body).queued;
  now = 8000;
  const renewal = response(); gate.handle(request(nextCookie, 'POST'), renewal, endpoint);
  const refreshed = JSON.parse(renewal.body).queued;
  assert.equal(refreshed.position, 2); assert.equal(refreshed.expiresAt, 18000);
  assert.equal(token(renewal), nextCookie);

  const firstPoll = response(); gate.handle(request(headCookie, 'POST', `${endpoint}?wait=1`), firstPoll, endpoint);
  const duplicatePoll = response(); gate.handle(request(headCookie, 'POST', `${endpoint}?wait=1`), duplicatePoll, endpoint);
  const duplicate = JSON.parse(duplicatePoll.body);
  assert.equal(duplicatePoll.status, 202); assert.ok(duplicate.queued.retryAfterMs >= 5000);

  const oldLocation = globalThis.location; const oldDocument = globalThis.document;
  globalThis.location = { href: 'http://localhost/stronghold/independent.html' };
  globalThis.document = { querySelector: () => null };
  try {
    const { duplicatePollDelayMs } = await import('../../public/js/hostingWait.js?queue-backoff-test');
    assert.equal(new URL('independent/api/admission', globalThis.location.href).pathname, '/stronghold/independent/api/admission');
    assert.equal(duplicatePollDelayMs(duplicate.queued), 5000);
    assert.equal(duplicatePollDelayMs({ retryAfterMs: 1 }), 5000);
    assert.equal(duplicatePollDelayMs({ retryAfterMs: 90000 }), 25000);
    assert.equal(duplicatePollDelayMs({}), 0);
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
  assert.ok(refreshed.expiresAt > original.expiresAt);
  gate.close(); assert.equal(firstPoll.status, 503);
});
