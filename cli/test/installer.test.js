import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { getApiBase, install, uninstall } from '../lib/installer.js';
import { canonicalJson, fingerprintForKey, verifySignedManifest } from '../lib/signed-manifest.js';
import { DEFAULT_API_URL } from '../lib/config.js';

const pair = crypto.generateKeyPairSync('ed25519');
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
process.env.NODE_ENV = 'test';
process.env.VIBEPRO_TEST_PUBLIC_KEY = publicPem;
const payload = new Map([['SKILL.md', Buffer.from('---\nname: vibepro-audit\n---\nAudit safely.\n')], ['guide/phase.md', Buffer.from('phase')]]);
let server;
let api;
let badHash = false;
let badPath = false;
let eventCount = 0;

function makeEnvelope(manifest = {
  name: 'vibepro-audit', version: '1.0.0', upstream: 'https://github.com/cloudflare/security-audit-skill',
  license: 'MIT', files: [...payload].map(([file, bytes]) => ({
    path: badPath && file === 'SKILL.md' ? '../escape' : file,
    sha256: badHash && file === 'SKILL.md' ? '0'.repeat(64) : crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  })),
}) {
  return {
    manifest,
    signature: crypto.sign(null, Buffer.from(canonicalJson(manifest)), pair.privateKey).toString('base64'),
    key_id: fingerprintForKey(publicPem),
  };
}

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/v1/manifest/signed') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(makeEnvelope())); return;
    }
    if (req.url.startsWith('/api/v1/versions/1.0.0/files/')) {
      const file = decodeURIComponent(req.url.replace('/api/v1/versions/1.0.0/files/', ''));
      if (payload.has(file)) { res.writeHead(200); res.end(payload.get(file)); return; }
    }
    if (req.url === '/api/v1/events' && req.method === 'POST') { eventCount += 1; res.writeHead(202); res.end('{}'); return; }
    res.writeHead(404); res.end('missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  api = 'http://127.0.0.1:' + server.address().port;
});

after(async () => new Promise(resolve => server.close(resolve)));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('valid signed manifest verifies; tampering and wrong key fail', () => {
  const envelope = makeEnvelope();
  assert.equal(verifySignedManifest(envelope).version, '1.0.0');
  const tampered = structuredClone(envelope); tampered.manifest.version = '9.9.9';
  assert.throws(() => verifySignedManifest(tampered), /signature verification failed/);
  const otherPair = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => verifySignedManifest(envelope, { publicKeyPem: otherPair.publicKey.export({ type: 'spki', format: 'pem' }), keyId: fingerprintForKey(otherPair.publicKey.export({ type: 'spki', format: 'pem' })) }), /key ID mismatch/);
});

test('HTTP is accepted only for localhost in development', () => {
  assert.equal(getApiBase({ VIBEPRO_API: 'http://localhost:8000' }), 'http://localhost:8000');
  assert.throws(() => getApiBase({ VIBEPRO_API: 'http://example.com' }), /HTTPS/);
});

test('an unpublished source checkout requires an explicit API', () => {
  if (!DEFAULT_API_URL) assert.throws(() => getApiBase({}), /No API configured/);
  else assert.ok(getApiBase({}).startsWith('https://')); 
});

test('uninstall works offline without an API configuration', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.codex', 'skills', 'vibepro-audit');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, '.vibepro-version'), '1.0.0');
  await uninstall({ agent: 'codex', home, noTelemetry: true });
  await assert.rejects(fs.stat(target));
});

test('checksum mismatch aborts before writing any target', async t => {
  const home = await fixture(t); badHash = true;
  try { await assert.rejects(install({ agent: 'codex', home, api, noTelemetry: true }), /SHA-256 mismatch/); }
  finally { badHash = false; }
  await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'vibepro-audit')));
  assert.equal((await fs.readdir(home)).length, 0);
});

test('manifest path traversal is rejected before target writes', async t => {
  const home = await fixture(t); badPath = true;
  try { await assert.rejects(install({ agent: 'codex', home, api, noTelemetry: true }), /Unsafe path/); }
  finally { badPath = false; }
  assert.equal((await fs.readdir(home)).length, 0);
});

test('dry-run previews paths and writes nothing', async t => {
  const home = await fixture(t);
  const result = await install({ agent: 'codex', home, api, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.targets, [path.join(home, '.codex', 'skills', 'vibepro-audit')]);
  assert.deepEqual(await fs.readdir(home), []);
});

test('a backup cleanup failure keeps the completed installation active', async t => {
  const home = await fixture(t);
  const target = path.join(home, '.codex', 'skills', 'vibepro-audit');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'SKILL.md'), 'previous installation');
  const originalRemove = fs.rm;
  fs.rm = async (file, options) => {
    if (String(file).includes('.vibepro-backup-') && await fs.stat(file).catch(() => null)) {
      throw Object.assign(new Error('Simulated locked backup'), { code: 'EACCES' });
    }
    return originalRemove(file, options);
  };
  try {
    await install({ agent: 'codex', home, api, noTelemetry: true });
    assert.deepEqual(await fs.readFile(path.join(target, 'SKILL.md')), payload.get('SKILL.md'));
  } finally {
    fs.rm = originalRemove;
  }
});

test('verified payload installs and emits only anonymous install metadata', async t => {
  const home = await fixture(t); const eventsBefore = eventCount;
  const result = await install({ agent: 'codex', home, api });
  const installed = await fs.readFile(path.join(result.targets[0], 'SKILL.md'));
  assert.equal(crypto.createHash('sha256').update(installed).digest('hex'), crypto.createHash('sha256').update(payload.get('SKILL.md')).digest('hex'));
  assert.equal((await fs.readFile(path.join(result.targets[0], '.vibepro-version'), 'utf8')).trim(), '1.0.0');
  assert.equal(eventCount, eventsBefore + 1);
});
