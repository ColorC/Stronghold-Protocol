import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaticDelivery } from '../../server/hosting/staticDelivery.js';
const base = 'https://external.example/d31592f27b1567267ff35ac95932f08c8ae74d9d';
const res = () => ({ writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });
const req = { method: 'GET' };

test('static traffic goes straight to fixed external revision, with no origin body', () => {
  const handler = createStaticDelivery({ base });
  for (const path of ['/assets/spine/x.atlas', '/fonts/fonts.css', '/js/independent/engine/server/data.js', '/data/config.json', '/sim/Battle.js', '/shared/media.js', '/media/bgm/act1', '/data.js']) {
    const response = res(); assert.equal(handler(req, response, path), true); assert.equal(response.status, 307);
    assert.equal(response.headers.Location, base + path); assert.equal(response.headers['Content-Length'], 0); assert.equal(response.body, undefined);
  }
});
test('worker bootstraps same-origin, API and entry stay local', () => {
  const handler = createStaticDelivery({ base });
  const response = res(); handler(req, response, '/js/independent/client-worker.js'); assert.equal(response.status, 200);
  assert.equal(response.body, `import "${base}/js/independent/client-worker.js";\n`);
  for (const path of ['/independent.html', '/independent/api/sessions', '/healthz', '/js/hostingBootstrap.js']) assert.equal(handler(req, res(), path), false);
  assert.equal(handler({ method: 'POST' }, res(), '/assets/x.png'), false);
  assert.equal(createStaticDelivery()(req, res(), '/assets/x.png'), false);
});
test('deployment URLs and unsafe paths cannot escape the version directory', () => {
  for (const wrong of ['http://external.example/' + 'a'.repeat(40), 'https://external.example/latest', base + '?x=1', base + '#x', base.replace('external.example', 'user:pass@external.example')]) assert.throws(() => createStaticDelivery({ base: wrong }));
  const handler = createStaticDelivery({ base });
  for (const path of ['/assets/%2e%2e/private', '/assets/.env', '/assets/%5cprivate', '/assets/%00x', '/assets/%broken']) {
    const response = res(); assert.equal(handler(req, response, path), true); assert.equal(response.status, 400);
  }
});
