#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fingerprintForKey, verifySignedManifest } from '../cli/lib/signed-manifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const python = path.join(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
const requirement = path.join(root, 'backend/requirements.txt');
const stamp = path.join(root, '.venv/.vibepro-requirements');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  const signals = ['SIGINT', 'SIGTERM'];
  const stop = signal => { if (child.exitCode === null) child.kill(signal); };
  const handlers = signals.map(signal => {
    const handler = () => stop(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 0 : 1)));
    });
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

function findPython() {
  const candidates = [
    ...(process.env.PYTHON ? [[process.env.PYTHON, []]] : []),
    ...(windows ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]]),
  ];
  for (const [command, args] of candidates) {
    const result = spawnSync(command, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'], {
      stdio: 'ignore', windowsHide: true, timeout: 10000,
    });
    if (!result.error && result.status === 0) return [command, args];
  }
  throw new Error('The API requires Python 3.12 or later. Install Python, reopen your terminal, and run npm install again.');
}

async function setup() {
  if (process.env.VERCEL === '1') {
    console.log('Vercel installs API dependencies from pyproject.toml; local DEV setup skipped.');
    return;
  }
  if (!existsSync(python)) {
    const [command, args] = findPython();
    console.log('Creating the isolated backend environment…');
    if (await run(command, [...args, '-m', 'venv', path.join(root, '.venv')])) {
      throw new Error('Could not create the backend environment. On Linux, install the Python venv package and run npm run setup.');
    }
  }
  console.log('Installing backend dependencies…');
  if (await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirement])) {
    throw new Error('Backend dependency installation failed. Check the output above, then run npm run setup.');
  }
  await fs.writeFile(stamp, await fs.readFile(requirement));
  console.log('\nVibePro is ready. Run npm start.');
}

async function ensureSetup() {
  const saved = await fs.readFile(stamp).catch(() => null);
  if (!existsSync(python) || !saved?.equals(await fs.readFile(requirement))) await setup();
}

async function localKey({ create = true, directory = path.join(root, 'backend/keys') } = {}) {
  const privatePath = path.join(directory, 'private_key.pem');
  if (!existsSync(privatePath) && create) {
    await fs.mkdir(directory, { recursive: true });
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    try {
      await fs.writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!existsSync(privatePath)) {
    throw new Error('A server is already running, but its DEV key is missing. Use npm start -- --port 8012 for a fresh server.');
  }
  const privatePem = await fs.readFile(privatePath);
  const privateKey = crypto.createPrivateKey(privatePem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('The existing DEV key is not Ed25519; it has been left unchanged.');
  const publicPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { privatePem, publicPem, keyId: fingerprintForKey(publicPem), directory };
}

async function syncPublicKey(key) {
  const webPath = path.join(root, 'web/app.js');
  const web = await fs.readFile(webPath, 'utf8');
  const start = web.indexOf('const publicKeyPem =');
  const end = web.indexOf('const $ =');
  if (start < 0 || end < start) throw new Error('Could not locate the website public trust root.');
  const updatedWeb = web.slice(0, start) + 'const publicKeyPem =\n  ' + JSON.stringify(key.publicPem) + ';\n' + web.slice(end);
  const cliPath = path.join(root, 'cli/lib/trusted-key.js');
  const updatedCli = '// Public trust root. The private signing key must never be committed.\n'
    + `export const TRUSTED_KEY_ID = '${key.keyId}';\n`
    + 'export const TRUSTED_PUBLIC_KEY_PEM = `' + key.publicPem + '`;\n';
  for (const [file, value] of [[webPath, updatedWeb], [cliPath, updatedCli], [path.join(key.directory, 'public_key.pem'), key.publicPem]]) {
    if (await fs.readFile(file, 'utf8').catch(() => '') !== value) await fs.writeFile(file, value);
  }
}

async function occupied(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', error => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else resolve(true);
    });
    socket.setTimeout(1500, () => finish(true));
  });
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function verifyServer(api, key) {
  const health = await json(api + '/health');
  const envelope = await json(api + '/api/v1/manifest/signed?version=latest');
  if (health.status !== 'ok' || envelope.manifest?.name !== 'vibepro-audit') throw new Error('Not a VibePro backend.');
  verifySignedManifest(envelope, { publicKeyPem: key.publicPem, keyId: key.keyId });
}

function openBrowser(url) {
  const [command, args] = windows
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => console.log('Open the URL above in your browser.'));
  child.unref();
}

function showUrls(api, port, open) {
  console.log(`\nWebsite:       ${api}/\nSample report: ${api}/report.html?sample=1`);
  console.log(`CLI:           npx vibepro-cli install --agent codex${port === 8011 ? '' : ' --api ' + api}`);
  if (open) {
    openBrowser(api + '/');
    openBrowser(api + '/report.html?sample=1');
  }
}

async function serve(port, open) {
  const api = `http://127.0.0.1:${port}`;
  if (await occupied(port)) {
    const key = await localKey({ create: false });
    try { await verifyServer(api, key); }
    catch { throw new Error(`Port ${port} is occupied or uses another signing key. Try npm start -- --port 8012. The existing process was left running.`); }
    await syncPublicKey(key);
    console.log('VibePro is already running; reusing it.');
    showUrls(api, port, open);
    return 0;
  }
  await ensureSetup();
  const key = await localKey();
  await syncPublicKey(key);
  const child = spawn(python, [
    '-m', 'uvicorn', 'app:app', '--app-dir', path.join(root, 'backend'),
    '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1',
      VIBEPRO_SIGNING_KEY: 'base64:' + key.privatePem.toString('base64'),
      DATABASE_URL: 'sqlite:///' + path.join(root, 'backend/vibepro-local.db').replaceAll('\\', '/'),
      ENGINE_DIR: path.join(root, 'engine'), VERSION: 'latest', CORS_ORIGINS: '',
    },
  });
  let exited = false;
  const completed = new Promise((resolve, reject) => {
    child.once('error', error => { exited = true; reject(error); });
    child.once('exit', (code, signal) => { exited = true; resolve(code ?? (signal === 'SIGINT' ? 0 : 1)); });
  });
  // Handle an early spawn failure while the readiness loop is waiting.
  completed.catch(() => {});
  let interrupted = false;
  const stop = () => { interrupted = true; if (!exited) child.kill('SIGTERM'); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !exited && !interrupted; attempt++) {
      try { await verifyServer(api, key); ready = true; break; }
      catch { await pause(200); }
    }
    if (interrupted) { await completed; return 0; }
    if (!ready) throw new Error('Backend startup failed. See the server output above.');
    showUrls(api, port, open);
    console.log('Keep this terminal open. Ctrl+C stops this server.');
    const code = await completed;
    return interrupted ? 0 : code;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (!exited) {
      child.kill('SIGTERM');
      const forced = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 8000);
      try { await completed; } finally { clearTimeout(forced); }
    }
  }
}

function options(args) {
  let port = 8011;
  let open = false;
  const forwarded = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--port') port = Number(args[++index]);
    else if (args[index].startsWith('--port=')) port = Number(args[index].slice(7));
    else if (args[index] === '--open') open = true;
    else forwarded.push(args[index]);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be between 1 and 65535.');
  return { port, open, forwarded };
}

async function main() {
  const [command = 'serve', ...args] = process.argv.slice(2);
  if (command === 'setup') { await setup(); return 0; }
  if (command === 'prepare-release') {
    const directory = path.join(root, 'backend/keys/production');
    if (!existsSync(path.join(directory, 'private_key.pem'))) {
      throw new Error('Restore your production signing-key backup into backend/keys/production/ first. A new key would not match the deployed API.');
    }
    const key = await localKey({ create: false, directory });
    await syncPublicKey(key);
    console.log('Production public keys synchronized. Private key stays in ignored backend/keys/production/.');
    console.log('Public fingerprint: ' + key.keyId);
    return 0;
  }
  const { port, open, forwarded } = options(args);
  if (command === 'serve') {
    if (forwarded.length) throw new Error('Unknown server options: ' + forwarded.join(' '));
    return serve(port, open);
  }
  if (command === 'cli') {
    // npm's original directory preserves --project/report behavior with --prefix.
    return run(process.execPath, [path.join(root, 'cli/bin/vibepro.js'), ...forwarded], {
      cwd: process.env.INIT_CWD || process.cwd(),
      env: { ...process.env, VIBEPRO_API: process.env.VIBEPRO_API || `http://127.0.0.1:${port}` },
    });
  }
  throw new Error('Use npm start, npm run setup, or npm run cli -- <command>.');
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error('VibePro: ' + error.message);
  process.exitCode = 1;
});
