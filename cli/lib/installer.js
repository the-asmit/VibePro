import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fingerprintForKey, verifySignedManifest } from './signed-manifest.js';
import { DEFAULT_API_URL } from './config.js';

const docs = {
  codex: 'https://developers.openai.com/codex/skills',
  claude: 'https://docs.anthropic.com/en/docs/claude-code/skills',
  cursor: 'https://cursor.com/help/customization/skills',
  antigravity: 'https://antigravity.google/docs/skills',
  gemini: 'https://geminicli.com/docs/cli/using-agent-skills/',
};

export const AGENTS = {
  codex: {
    global: '.codex/skills', // https://developers.openai.com/codex/skills
    project: '.agents/skills', // https://developers.openai.com/codex/skills
    doc: docs.codex,
  },
  claude: {
    global: '.claude/skills', // https://docs.anthropic.com/en/docs/claude-code/skills
    project: '.claude/skills', // https://docs.anthropic.com/en/docs/claude-code/skills
    doc: docs.claude,
  },
  cursor: {
    global: '.cursor/skills', // https://cursor.com/help/customization/skills
    project: '.cursor/skills', // https://cursor.com/help/customization/skills
    doc: docs.cursor,
  },
  antigravity: {
    global: '.gemini/config/skills', // https://antigravity.google/docs/skills
    project: '.agents/skills', // https://antigravity.google/docs/skills
    doc: docs.antigravity,
  },
  gemini: {
    global: '.gemini/skills', // https://geminicli.com/docs/cli/using-agent-skills/
    project: '.gemini/skills', // https://geminicli.com/docs/cli/using-agent-skills/
    doc: docs.gemini,
  },
};

export const CREDIT = 'Audit methodology: Cloudflare security-audit-skill (MIT), https://github.com/cloudflare/security-audit-skill';

export function getApiBase(env = process.env) {
  const raw = env.VIBEPRO_API || DEFAULT_API_URL;
  if (!raw) throw new Error('No API configured. Set VIBEPRO_API or pass --api <backend URL>.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('VIBEPRO_API must be a valid HTTPS URL (HTTP is allowed only for localhost).'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('VIBEPRO_API must use HTTPS; HTTP is allowed only for localhost.');
  }
  return url.toString().replace(/\/$/, '');
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const parts = value.split('/');
  return parts.every(part => part && part !== '.' && part !== '..' && !part.includes(':'));
}

export function pathsFor(agent, { project, cwd, home }) {
  const config = AGENTS[agent];
  if (!config) throw new Error(`Unknown agent "${agent}". Choose: ${Object.keys(AGENTS).join(', ')}.`);
  const root = project ? cwd : home;
  return path.resolve(root, project ? config.project : config.global, 'vibepro-audit');
}

export async function detectAgents(options = {}) {
  return resolveDetectedAgents(options);
}

export async function resolveDetectedAgents(options = {}) {
  const agents = [];
  for (const agent of Object.keys(AGENTS)) {
    try {
      const stat = await fs.stat(path.dirname(pathsFor(agent, { ...options, home: options.home || process.env.VIBEPRO_HOME || os.homedir() })));
      if (stat.isDirectory()) agents.push(agent);
    } catch {}
  }
  return agents;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Backend returned HTTP ${response.status} for ${url}`);
  return response.json();
}

async function developmentVerificationOptions(base) {
  // Only this source checkout talking to loopback may use its ignored DEV key.
  // Public APIs and distributed packages always use the production trust root.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) return {};
  if (process.env.NODE_ENV === 'test' && process.env.VIBEPRO_TEST_PUBLIC_KEY) return {};
  const root = new URL('../../', import.meta.url);
  try {
    const project = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'));
    if (project.private !== true || project.name !== 'vibepro-project'
        || !(await fs.stat(new URL('backend/app.py', root))).isFile()) return {};
  } catch { return {}; }
  let publicKeyPem;
  try { publicKeyPem = await fs.readFile(new URL('backend/keys/public_key.pem', root), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  return { publicKeyPem, keyId: fingerprintForKey(publicKeyPem) };
}

export async function fetchVerifiedManifest(base, version) {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : '';
  const envelope = await getJson(`${base}/api/v1/manifest/signed${suffix}`);
  return verifySignedManifest(envelope, await developmentVerificationOptions(base));
}

async function sendTelemetry(base, event, agent, version, env = process.env) {
  if (env.VIBEPRO_TELEMETRY === '0') return;
  try {
    await fetch(`${base}/api/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ event, agent, version, os: process.platform }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {}
}

export function validateManifest(manifest) {
  if (!manifest || manifest.name !== 'vibepro-audit' || !Array.isArray(manifest.files) || typeof manifest.version !== 'string') throw new Error('Backend returned an invalid manifest.');
  const seen = new Set();
  for (const item of manifest.files) {
    if (!safeRelativePath(item.path)) throw new Error(`Unsafe path in manifest: ${String(item.path)}`);
    if (!/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error(`Invalid file metadata in manifest: ${item.path}`);
    if (seen.has(item.path)) throw new Error(`Duplicate path in manifest: ${item.path}`);
    seen.add(item.path);
  }
  return manifest;
}

async function downloadAndVerify(base, manifest) {
  const verified = [];
  for (const item of manifest.files) {
    const response = await fetch(`${base}/api/v1/versions/${encodeURIComponent(manifest.version)}/files/${item.path.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Could not download ${item.path}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== item.sha256.toLowerCase()) throw new Error(`SHA-256 mismatch for ${item.path}; nothing was installed.`);
    if (bytes.length !== item.size) throw new Error(`Size mismatch for ${item.path}; nothing was installed.`);
    verified.push({ path: item.path, bytes });
  }
  return verified;
}

function ensureTargetSafe(target, parent) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedParent + path.sep)) throw new Error(`Unsafe installation target: ${target}`);
}

async function ensureInstallPathSafe(target, root) {
  const allowedRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  if (!absoluteTarget.startsWith(allowedRoot + path.sep)) throw new Error(`Unsafe installation target: ${target}`);
  let current = allowedRoot;
  for (const part of path.relative(allowedRoot, path.dirname(absoluteTarget)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe symbolic-link or non-directory install path: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    const stat = await fs.lstat(absoluteTarget);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe symbolic-link or non-directory install target: ${absoluteTarget}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeStaging(target, files, version) {
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const stage = path.join(parent, `.vibepro-audit.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  await fs.mkdir(stage, { recursive: false });
  try {
    for (const file of files) {
      const output = path.resolve(stage, ...file.path.split('/'));
      ensureTargetSafe(output, stage);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, file.bytes, { flag: 'wx' });
    }
    await fs.writeFile(path.join(stage, '.vibepro-version'), version, { flag: 'wx' });
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
  return stage;
}

export async function install({ agent, project = false, dryRun = false, updateOnly = false, noTelemetry = false, cwd = process.cwd(), home = process.env.VIBEPRO_HOME || os.homedir(), api = getApiBase() } = {}) {
  const base = api.replace(/\/$/, '');
  const manifest = validateManifest(await fetchVerifiedManifest(base));
  const targetsAgents = agent ? [agent] : project ? Object.keys(AGENTS) : await resolveDetectedAgents({ home });
  if (!targetsAgents.length) throw new Error('No supported agents detected. Use --agent codex to choose an install target.');
  const targets = [...new Set(targetsAgents.map(name => pathsFor(name, { project, cwd, home })))];
  if (dryRun) return { manifest, targetsAgents, targets, dryRun: true };
  for (const target of targets) await ensureInstallPathSafe(target, project ? cwd : home);
  if (updateOnly) {
    const upToDate = await Promise.all(targets.map(async target => {
      try { return (await fs.readFile(path.join(target, '.vibepro-version'), 'utf8')).trim() === manifest.version; }
      catch { return false; }
    }));
    if (upToDate.every(Boolean)) return { manifest, targetsAgents, targets, dryRun: false, alreadyCurrent: true };
  }

  // Fetch and verify the entire payload before creating any target directories.
  const files = await downloadAndVerify(base, manifest);
  const staged = [];
  try {
    for (const target of targets) staged.push({ target, stage: await writeStaging(target, files, manifest.version), backup: `${target}.vibepro-backup-${process.pid}`, hadOld: false });
    const committed = [];
    try {
      for (const item of staged) {
        await fs.rm(item.backup, { recursive: true, force: true });
        try { await fs.rename(item.target, item.backup); item.hadOld = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { await fs.rename(item.stage, item.target); } catch (error) {
          if (item.hadOld) await fs.rename(item.backup, item.target);
          throw error;
        }
        committed.push(item);
      }
    } catch (error) {
      for (const item of committed.reverse()) {
        await fs.rm(item.target, { recursive: true, force: true });
        if (item.hadOld) { try { await fs.rename(item.backup, item.target); } catch {} }
      }
      throw error;
    }
    // Every target is now committed. Backup cleanup must not roll back working
    // installs after another target's backup has already been removed.
    for (const item of committed) await fs.rm(item.backup, { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    await Promise.all(staged.map(item => fs.rm(item.stage, { recursive: true, force: true }).catch(() => {})));
    throw error;
  }
  if (!noTelemetry) for (const name of targetsAgents) await sendTelemetry(base, updateOnly ? 'update' : 'install', name, manifest.version);
  return { manifest, targetsAgents, targets, dryRun: false };
}

export async function listInstallations({ project = false, cwd = process.cwd(), home = process.env.VIBEPRO_HOME || os.homedir() } = {}) {
  const rows = [];
  for (const [agent, config] of Object.entries(AGENTS)) {
    const target = pathsFor(agent, { project, cwd, home });
    let installed = false;
    try { installed = (await fs.stat(path.join(target, 'SKILL.md'))).isFile(); } catch {}
    let detected = false;
    try { detected = (await fs.stat(path.dirname(target))).isDirectory(); } catch {}
    rows.push({ agent, target, installed, detected, docs: config.doc });
  }
  return rows;
}

export async function uninstall({ project = false, cwd = process.cwd(), home = process.env.VIBEPRO_HOME || os.homedir(), agent, noTelemetry = false, api } = {}) {
  const agents = agent ? [agent] : Object.keys(AGENTS);
  for (const name of agents) {
    const target = pathsFor(name, { project, cwd, home });
    let version = 'unknown';
    let existed = false;
    try { version = (await fs.readFile(path.join(target, '.vibepro-version'), 'utf8')).trim() || version; existed = true; }
    catch { try { existed = (await fs.stat(target)).isDirectory(); } catch {} }
    await fs.rm(target, { recursive: true, force: true });
    if (existed && !noTelemetry) {
      try { await sendTelemetry(api || getApiBase(), 'uninstall', name, version); } catch {}
    }
  }
}

export function moduleRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); }
