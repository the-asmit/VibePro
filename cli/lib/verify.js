import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AGENTS, fetchVerifiedManifest, getApiBase, listInstallations, pathsFor, validateManifest } from './installer.js';

export async function verifyInstalled({ agent, project = false, cwd = process.cwd(), home = process.env.VIBEPRO_HOME || os.homedir(), api = getApiBase() } = {}) {
  const manifest = validateManifest(await fetchVerifiedManifest(api.replace(/\/$/, '')));
  const installations = await listInstallations({ project, cwd, home });
  const names = agent ? [agent] : installations.filter(row => row.installed).map(row => row.agent);
  if (!names.length) throw new Error('No VibePro installations found. Use --agent <name> to check a specific target.');
  const results = [];
  for (const name of names) {
    const target = pathsFor(name, { project, cwd, home });
    for (const file of manifest.files) {
      const diskPath = path.resolve(target, ...file.path.split('/'));
      if (!diskPath.startsWith(path.resolve(target) + path.sep)) throw new Error('Unsafe path in signed manifest: ' + file.path);
      try {
        const stat = await fs.lstat(diskPath);
        if (!stat.isFile() || stat.isSymbolicLink()) { results.push({ agent: name, path: file.path, status: 'modified' }); continue; }
        const data = await fs.readFile(diskPath);
        const digest = crypto.createHash('sha256').update(data).digest('hex');
        results.push({ agent: name, path: file.path, status: digest === file.sha256 ? 'intact' : 'modified' });
      } catch (error) {
        results.push({ agent: name, path: file.path, status: error.code === 'ENOENT' ? 'missing' : 'modified' });
      }
    }
  }
  return { manifest, results, intact: results.filter(item => item.status === 'intact').length, modified: results.filter(item => item.status === 'modified').length, missing: results.filter(item => item.status === 'missing').length };
}

export async function doctor({ cwd = process.cwd(), home = process.env.VIBEPRO_HOME || os.homedir(), api = getApiBase() } = {}) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'Node.js >= 18', pass: nodeMajor >= 18, detail: process.version });
  let manifest;
  try {
    const response = await fetch(api.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    checks.push({ name: 'Backend reachable', pass: true, detail: api });
    manifest = validateManifest(await fetchVerifiedManifest(api.replace(/\/$/, '')));
    checks.push({ name: 'Ed25519 manifest signature', pass: true, detail: 'trusted key ' + manifest.version });
  } catch (error) {
    checks.push({ name: 'Backend and signature', pass: false, detail: error.message });
  }
  const rows = await listInstallations({ home, cwd });
  const detected = rows.filter(row => row.detected);
  checks.push({ name: 'Agent detection', pass: detected.length > 0, detail: detected.length ? detected.map(row => row.agent).join(', ') : 'No agent skills directories detected' });
  const installed = rows.filter(row => row.installed);
  if (manifest && installed.length) {
    const perAgent = await Promise.all(installed.map(row => verifyInstalled({ agent: row.agent, cwd, home, api })));
    const bad = perAgent.reduce((sum, result) => sum + result.modified + result.missing, 0);
    checks.push({ name: 'Installed skill integrity', pass: bad === 0, detail: bad ? bad + ' modified or missing files' : installed.map(row => row.agent).join(', ') + ' intact' });
  } else {
    checks.push({ name: 'Installed skill integrity', pass: false, detail: 'VibePro is not installed for a detected agent' });
  }
  return checks;
}
