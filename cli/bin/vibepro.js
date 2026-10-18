#!/usr/bin/env node
import { AGENTS, CREDIT, getApiBase, install, listInstallations, uninstall } from '../lib/installer.js';
import { formatReport, openLocalReport, resolveFindingsPath, validateFindingsFile } from '../lib/report.js';
import { doctor, verifyInstalled } from '../lib/verify.js';
import { existsSync, readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const amber = s => '\u001b[33m' + s + '\u001b[0m';
const cyan = s => '\u001b[36m' + s + '\u001b[0m';
const ok = s => '\u001b[32m' + s + '\u001b[0m';
const fail = s => '\u001b[31m' + s + '\u001b[0m';
const say = s => process.stdout.write(s + '\n');

function commandApi(options) {
  if (options.api) return getApiBase({ VIBEPRO_API: options.api });
  if (process.env.VIBEPRO_API) return getApiBase();
  // The local npm workspace links this executable to the source checkout.
  // Published packages never infer a loopback API from the user's directory.
  let sourceCheckout = false;
  try {
    const project = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    sourceCheckout = project.private === true && project.name === 'vibepro-project'
      && existsSync(new URL('../../backend/app.py', import.meta.url));
  } catch {}
  return sourceCheckout ? getApiBase({ VIBEPRO_API: 'http://127.0.0.1:8011' }) : getApiBase();
}

function help() {
  say([
    'VibePro installs and verifies a signed security audit skill for AI coding agents.',
    '', 'Usage: vibepro <command> [options]', '', 'Commands:',
    '  install [--agent <name>] [--project] [--dry-run]  Install the audit skill',
    '  update                                             Update to the latest signed release',
    '  verify [--agent <name>] [--project]                Check installed file integrity',
    '  doctor                                             Diagnose setup, backend, signature, and install',
    '  report [path] [--no-open]                          Validate and view findings.json locally',
    '  uninstall [--agent <name>] [--project]             Remove the skill',
    '  list [--project]                                    Show detected agents/install state',
    '  about                                               About VibePro', '',
    'Agents: ' + Object.keys(AGENTS).join(', '), 'Options: --version, --help, --no-telemetry, --api <URL>',
    'Telemetry: anonymous event, agent, version, and OS counts only. Disable with --no-telemetry or VIBEPRO_TELEMETRY=0.',
    '', CREDIT,
  ].join('\n'));
}

function parse(args) {
  const command = args.shift();
  const options = { project: false, dryRun: false, noTelemetry: false, noOpen: false };
  while (args.length) {
    const arg = args.shift();
    if (arg === '--project') options.project = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-telemetry') options.noTelemetry = true;
    else if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--api') {
      const value = args.shift();
      if (!value || value.startsWith('-')) throw new Error('--api requires a backend URL.');
      options.api = getApiBase({ VIBEPRO_API: value });
    }
    else if (arg === '--agent') {
      options.agent = args.shift();
      if (!Object.hasOwn(AGENTS, options.agent)) throw new Error('--agent requires one of: ' + Object.keys(AGENTS).join(', '));
    }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('-') && !options.path) options.path = arg;
    else throw new Error('Unknown option: ' + arg);
  }
  return { command, options };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args[0] === '-v') return say(VERSION);
  if (!args.length || args[0] === '--help' || args[0] === '-h') return help();
  const { command, options } = parse(args);
  if (options.help) return help();
  if (command === 'about') return say('VibePro securely distributes a verified security audit skill for AI coding agents.\n' + CREDIT);
  if (command === 'list') {
    for (const row of await listInstallations(options)) say((row.installed ? ok('installed') : row.detected ? cyan('detected') : 'not detected') + '  ' + row.agent.padEnd(12) + ' ' + row.target);
    return;
  }
  if (command === 'verify') {
    const result = await verifyInstalled({ ...options, api: commandApi(options) });
    for (const item of result.results) say((item.status === 'intact' ? ok(item.status) : fail(item.status)) + '  ' + item.agent.padEnd(12) + ' ' + item.path);
    say('Files: ' + result.intact + ' intact, ' + result.modified + ' modified, ' + result.missing + ' missing.');
    if (result.modified || result.missing) process.exitCode = 1;
    return;
  }
  if (command === 'doctor') {
    const checks = await doctor({ api: commandApi(options) });
    for (const check of checks) say((check.pass ? ok('PASS') : fail('FAIL')) + '  ' + check.name + ': ' + check.detail);
    if (checks.some(check => !check.pass)) process.exitCode = 1;
    return;
  }
  if (command === 'report') {
    const file = await resolveFindingsPath(options.path);
    const { value, raw } = await validateFindingsFile(file);
    say(formatReport(value));
    say('Validated ' + value.length + ' findings from ' + file + '.');
    if (!options.noOpen) {
      const opened = await openLocalReport(raw);
      say('Local report viewer: ' + opened.url);
      say('The findings stay on this machine. Press Ctrl+C to stop the local viewer.');
    }
    return;
  }
  if (command === 'uninstall') {
    if (!options.api) { try { options.api = commandApi(options); } catch {} }
    await uninstall(options);
    return say(ok('VibePro audit skill removed.'));
  }
  if (command !== 'install' && command !== 'update') throw new Error('Unknown command "' + command + '". Run vibepro --help.');
  const api = commandApi(options);
  say(amber('›') + ' Downloading signed VibePro audit engine…');
  const result = await install({ ...options, updateOnly: command === 'update', api });
  const fileCount = result.manifest.files.length;
  if (result.alreadyCurrent) return say(ok('done') + ' VibePro ' + result.manifest.version + ' is already current.');
  if (result.dryRun) {
    say(cyan('›') + ' Preview: ' + fileCount + ' files, version ' + result.manifest.version);
    for (const target of result.targets) say('  ' + target);
    return;
  }
  say(amber('›') + ' Ed25519 signature and SHA-256 checks ' + ok('passed'));
  for (const target of result.targets) say('  ' + target);
  say(ok('done') + ' Ready. Ask your agent: "audit this project"');
}

main().catch(error => {
  process.stderr.write(fail('VibePro:') + ' ' + error.message + '\n');
  process.exitCode = 1;
});
