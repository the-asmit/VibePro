import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { openLocalReport, validateFindingsFile } from '../lib/report.js';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(cliRoot, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmOptions = process.platform === 'win32' ? { shell: true } : {};

test('local report serves findings and bundled fonts over loopback', async t => {
  const raw = await fs.readFile(path.join(cliRoot, 'viewer', 'sample-findings.json'));
  const opened = await openLocalReport(raw, { launchBrowser: false });
  t.after(() => new Promise(resolve => { opened.server.close(resolve); opened.server.closeAllConnections?.(); }));
  assert.equal(opened.server.address().address, '127.0.0.1');
  assert.equal(new URL(opened.url).searchParams.get('local'), '1');
  assert.match(await (await fetch(opened.url)).text(), /Inspect the findings/);
  const findings = await (await fetch(new URL('/findings.json', opened.url))).json();
  assert.equal(findings.length, 3);
  for (const filename of ['geist-latin.woff2', 'jetbrains-mono-latin.woff2']) {
    const font = await fetch(new URL('/fonts/' + filename, opened.url));
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.ok((await font.arrayBuffer()).byteLength > 1000);
  }
});

test('report sample validates against the shipped Cloudflare schema', async () => {
  const sample = path.join(cliRoot, 'viewer', 'sample-findings.json');
  const { value } = await validateFindingsFile(sample);
  assert.deepEqual(value.map(item => item.verdict), ['confirmed', 'needs_validation', 'rejected']);
});

test('packaged report viewer matches the website assets', async () => {
  for (const [source, bundled] of [
    ['report.html', 'index.html'], ['report.css', 'report.css'],
    ['report.js', 'report.js'], ['sample-findings.json', 'sample-findings.json'],
    ['favicon.svg', 'favicon.svg'], ['fonts/geist-latin.woff2', 'fonts/geist-latin.woff2'],
    ['fonts/jetbrains-mono-latin.woff2', 'fonts/jetbrains-mono-latin.woff2'],
  ]) {
    assert.deepEqual(await fs.readFile(path.join(cliRoot, '..', 'web', source)), await fs.readFile(path.join(cliRoot, 'viewer', bundled)), source);
  }
});

test('invalid report data is rejected by report-schema.json', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-report-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'findings.json');
  await fs.writeFile(file, JSON.stringify([{ verdict: 'needs_validation', title: '<script>alert(1)</script>' }]));
  await assert.rejects(validateFindingsFile(file), /does not match report-schema/);
});

test('npm pack tarball installs and its npx command runs', { timeout: 180000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-pack-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  execFileSync(npm, ['pack', '--pack-destination', dir], { cwd: cliRoot, stdio: 'pipe', ...npmOptions });
  const tarball = path.join(dir, `vibepro-cli-${packageJson.version}.tgz`);
  await fs.access(tarball);
  execFileSync(npm, ['install', '--prefix', dir, '--ignore-scripts', tarball], { cwd: dir, stdio: 'pipe', ...npmOptions });
  const output = execFileSync(npm, ['exec', '--prefix', dir, '--', 'vibepro', '--version'], { cwd: dir, encoding: 'utf8', stdio: 'pipe', ...npmOptions });
  assert.match(output, new RegExp(packageJson.version.replaceAll('.', '\\.')));
});
