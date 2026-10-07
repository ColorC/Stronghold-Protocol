#!/usr/bin/env node
// Rehearse an HTTPS cross-origin static host locally, using the actual immutable package.
import assert from 'node:assert/strict';
import https from 'node:https';
import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MIME } from '../server/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key) => { const i = args.indexOf(key); if (i < 0 || !args[i + 1]) throw new Error(`missing ${key}`); return args[i + 1]; };
const packageRoot = path.resolve(option('--static-root')); const output = path.resolve(option('--output'));
const build = JSON.parse(readFileSync(path.join(packageRoot, 'static-build.json'), 'utf8'));
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(build.sourceRevision, revision, 'CDN package and game service use the same Git commit');
await mkdir(output, { recursive: true });
const key = path.join(output, 'test-only-key.pem'); const cert = path.join(output, 'test-only-cert.pem');
const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/mingw64/bin/openssl.exe' : 'openssl');
if (!existsSync(cert)) execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', key, '-out', cert], { windowsHide: true, timeout: 15000, stdio: ['ignore', 'ignore', 'pipe'] });
const network = { requests: 0, servedBytes: 0, byTopDir: {}, failures: [] };
const cdn = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    const file = path.resolve(packageRoot, '.' + urlPath);
    if (!file.startsWith(packageRoot + path.sep)) { res.writeHead(403); res.end(); return; }
    const info = await stat(file); if (!info.isFile()) throw new Error('not a file');
    const relative = urlPath.split('/').filter(Boolean); const group = relative[1] || '(root)';
    network.requests++; network.servedBytes += info.size; network.byTopDir[group] = (network.byTopDir[group] || 0) + info.size;
    const type = group === 'media' ? 'audio/mpeg' : MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'public, max-age=31536000, immutable' });
    createReadStream(file).pipe(res);
  } catch (error) { network.failures.push({ path: req.url, error: error.message }); res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { cdn.once('error', reject); cdn.listen(0, '127.0.0.1', resolve); });
const staticBase = `https://127.0.0.1:${cdn.address().port}/${revision}`;
let exitCode = 1;
try {
  exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'tools/client-compute-browser-smoke.mjs'), '--output', path.join(output, 'browser'), '--install-dir', root],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'], timeout: 240000,
        env: { ...process.env, SP_STATIC_BASE: staticBase, SP_INDEPENDENT_EXECUTION: 'client', SP_INDEPENDENT_MAX_ACTIVE: '50', SP_TEST_IGNORE_HTTPS: '1' } });
    child.once('error', () => resolve(1)); child.once('close', (code) => resolve(code ?? 1));
  });
  assert.equal(exitCode, 0, 'the same browser gameplay checks pass with static requests on the external HTTPS origin');
  assert.equal(network.failures.length, 0);
  for (const group of ['js', 'assets', 'fonts', 'vendor', 'data']) assert.ok(network.byTopDir[group] > 0, `${group} downloaded from CDN`);
} catch (error) { console.error(error.stack || error.message); exitCode = 1; }
finally {
  await new Promise((resolve) => cdn.close(resolve));
  const receiptPath = path.join(output, 'cdn-receipt.json');
  const receipt = { ok: exitCode === 0, sourceRevision: revision, measurement: 'local isolated HTTPS origin with self-signed test certificate; not deployed Pages or China access latency',
    staticBase, network, artifacts: [{ path: receiptPath, role: 'cross-origin static delivery receipt' },
      { path: path.join(output, 'browser/browser-receipt.json'), role: 'real Chrome game and persistence verification' },
      { path: path.join(output, 'browser/client-workshop.png'), role: 'real Chrome default workshop screenshot' },
      { path: cert, role: 'test-only local HTTPS certificate' }, { path: key, role: 'test-only local HTTPS key' }] };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt, null, 2)); process.exitCode = exitCode;
}
