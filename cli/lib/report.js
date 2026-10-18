import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import Ajv from 'ajv';
import { moduleRoot } from './installer.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
const MAX_REPORT_BYTES = 16 * 1024 * 1024;

export async function resolveFindingsPath(input, { cwd = process.cwd(), home = process.env.VIBEPRO_HOME || os.homedir() } = {}) {
  const start = input ? path.resolve(cwd, input) : path.join(home, 'security-audit-skill', path.basename(cwd));
  const stat = await fs.stat(start).catch(() => null);
  if (!stat) throw new Error('Audit output not found: ' + start);
  if (stat.isFile()) return start;
  const direct = path.join(start, 'findings.json');
  if ((await fs.stat(direct).catch(() => null))?.isFile()) return direct;
  const entries = await fs.readdir(start, { withFileTypes: true });
  const runs = entries.filter(e => e.isDirectory() && /^run-\d+$/.test(e.name)).sort((a, b) => Number(b.name.slice(4)) - Number(a.name.slice(4)));
  for (const run of runs) {
    const candidate = path.join(start, run.name, 'findings.json');
    if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  throw new Error('No findings.json found under ' + start);
}

export async function validateFindingsFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) throw new Error('findings.json must be a regular file under ' + MAX_REPORT_BYTES + ' bytes.');
  const raw = await fs.readFile(filePath);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new Error('findings.json is not valid UTF-8 JSON.'); }
  const schema = JSON.parse(await fs.readFile(path.join(moduleRoot(), 'resources', 'report-schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true, maxDepth: 64 });
  ajv.addKeyword({ keyword: 'visibleContent', type: 'string', schemaType: 'boolean', validate: (enabled, data) => !enabled || data.trim().length > 0 });
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const errors = (validate.errors || []).slice(0, 8).map(err => (err.instancePath || '/') + ' ' + err.message).join('; ');
    throw new Error('findings.json does not match report-schema.json: ' + errors);
  }
  return { value, raw, schema };
}

function sourceLocation(finding) {
  const trace = finding.trace || [];
  const point = trace.find(step => step.kind === 'sink') || trace[0] || finding.evidence?.[0];
  return point ? point.file + ':' + point.line : 'location unavailable';
}

export function reportSummary(findings) {
  const verdicts = { confirmed: 0, needs_validation: 0, rejected: 0 };
  const severity = Object.fromEntries(SEVERITIES.map(level => [level, 0]));
  for (const item of findings) {
    verdicts[item.verdict] = (verdicts[item.verdict] || 0) + 1;
    if (item.verdict === 'confirmed' && Object.hasOwn(severity, item.severity?.overall_severity)) severity[item.severity.overall_severity] += 1;
  }
  return { verdicts, severity };
}

export function formatReport(findings) {
  const { verdicts, severity } = reportSummary(findings);
  const lines = ['Audit findings', '==============', 'Verdict               Count', 'confirmed             ' + verdicts.confirmed, 'needs_validation      ' + verdicts.needs_validation, 'rejected              ' + verdicts.rejected, '', 'Confirmed severity    Count', ...SEVERITIES.map(level => level.padEnd(21) + ' ' + severity[level]), '', 'Findings'];
  for (const item of findings) {
    lines.push('- [' + item.verdict + '] ' + item.title + ' (' + (item.verdict === 'confirmed' ? item.severity.overall_severity : 'unrated') + ') — ' + sourceLocation(item));
    if (item.verdict === 'needs_validation') lines.push('  Unresolved: ' + (item.blockers || []).join('; '));
  }
  return lines.join('\n');
}

function openBrowser(url) {
  let command, args;
  if (process.platform === 'win32') { command = 'rundll32.exe'; args = ['url.dll,FileProtocolHandler', url]; }
  else if (process.platform === 'darwin') { command = 'open'; args = [url]; }
  else { command = 'xdg-open'; args = [url]; }
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export async function openLocalReport(raw, { noOpen = false, launchBrowser = true } = {}) {
  if (noOpen) return null;
  const viewerDir = path.join(moduleRoot(), 'viewer');
  const assets = new Map([
    ['/report.html', ['index.html', 'text/html; charset=utf-8']],
    ['/report.css', ['report.css', 'text/css; charset=utf-8']],
    ['/report.js', ['report.js', 'text/javascript; charset=utf-8']],
    ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
    ['/sample-findings.json', ['sample-findings.json', 'application/json; charset=utf-8']],
    ['/fonts/geist-latin.woff2', ['fonts/geist-latin.woff2', 'font/woff2']],
    ['/fonts/jetbrains-mono-latin.woff2', ['fonts/jetbrains-mono-latin.woff2', 'font/woff2']],
  ]);
  const server = http.createServer(async (req, res) => {
    const requestPath = new URL(req.url, 'http://127.0.0.1').pathname;
    const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
    if (requestPath === '/findings.json') {
      res.writeHead(200, { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(raw); return;
    }
    const asset = assets.get(requestPath);
    if (requestPath === '/') { res.writeHead(302, { ...security, Location: '/report.html' }); res.end(); return; }
    if (!asset) { res.writeHead(404, security); res.end('Not found'); return; }
    try {
      const contents = await fs.readFile(path.join(viewerDir, asset[0]));
      res.writeHead(200, { ...security, 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
      res.end(contents);
    } catch { res.writeHead(500, security); res.end('Report viewer unavailable'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const url = 'http://127.0.0.1:' + address.port + '/report.html?local=1';
  if (launchBrowser) openBrowser(url);
  return { server, url };
}

export { sourceLocation };
