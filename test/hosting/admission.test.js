import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmission } from '../../server/hosting/admission.js';

const request = (cookie = '', method = 'POST') => ({ method, headers: { host: 'localhost', cookie }, socket: {} });
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(status, h) { this.status = status; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); }, end(body) { this.body = body; } });
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
