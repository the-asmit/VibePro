# Final project check

Checked on 18 October 2026. Both the local presentation workflow and the public Vercel/GitHub Release installation work. See [deployment evidence](DEPLOYMENT.md) for production details.

## Results

| Check | Result |
| --- | --- |
| Backend tests | 13 passed |
| CLI tests, including npm tarball install | 14 passed |
| Cloudflare upstream validators | 65 passed under Ubuntu/WSL with Node 22 |
| End-to-end install, verify, doctor, tamper detection, report validation, uninstall | Passed in an isolated temporary home/database |
| Browser interaction checks | 15 passed |
| Website and report at 1440, 1024, 768, 390px | No horizontal overflow, page errors, or automated WCAG A/AA violations |
| Local launcher cold start | Passed on port 8012; temporary server stopped afterward |
| npm setup and commands | `npm install`, locked workspace installation, `npm start`, CLI doctor/verify, install preview, and sample report validation passed |
| Existing presentation server | Reused on port 8011 without restarting or stopping it |
| Installed Codex engine | 22 intact files, zero modified/missing |
| CLI and browser-tool dependency audits | Zero reported npm vulnerabilities |
| Python dependency consistency | `pip check` passed |
| Website/CLI report parity and local HTML assets | Passed |
| npm package contents | 21 whitelisted files; no private key, database, old fonts, or project screenshots |
| Docker image and fresh container | Passed: non-root runtime, two-worker startup, 22 signed file hashes, SQLite stats, browser verification, and report viewer |
| Hosted GitHub Actions | Backend, CLI and end-to-end checks passed on Windows, macOS, and Ubuntu; Docker job passed |
| Public GitHub Release | `v1.0.0` published with CLI tarball and SHA-256 checksums |
| Public installation | GitHub-hosted tarball installed in an isolated home; 22 files intact; verify and doctor passed |
| Vercel production | Public website, sample report, signed manifest, all 22 file hashes, and persistent Neon stats passed |
| Production browser review | 1440, 1024, 768, and 390px: no horizontal overflow or page errors; real signature/hash check and sample findings passed |

## Cleanup and fixes

- Removed unused Anton SC, Space Mono, and Space Grotesk assets and their unused license copies. Kept both active fonts and their licenses.
- Archived the rejected designs, temporary upstream checkout, and development artifacts outside the project under `C:/Users/asmit/.codex/backups/VibePro-final-cleanup/`. Automatic safety review blocked bulk deletion, so these remain recoverable.
- Kept the final screenshots, tests, lockfiles, source engine, and versioned engine release. The source/release and website/CLI viewer copies serve distinct runtime or distribution purposes.
- Added a private npm workspace: `npm install` prepares CLI/backend dependencies, `npm start` starts/reuses the local API, and `npm run cli -- <command>` runs the CLI. The Node launcher in `scripts/local.mjs` replaces the Python wrapper.
- Made key creation repeatable, synchronized public keys automatically for local use, and stopped printing private values unless explicitly requested for deployment.
- Local source-checkout commands use the local API. Published packages now contain the verified production API origin and matching public key.
- Added request timeouts, offline uninstall, missing-agent validation, and regression checks for key reuse and bundled viewer parity.
- Fixed SQLite table creation when multiple server workers start together; verified a fresh database with concurrent workers and in Docker.
- Kept completed installs intact when removing an old backup fails, with a regression check for that case.
- Separated test dependencies from backend runtime dependencies; tightened Docker exclusions and removed unused external font permissions.
- Replaced stale documentation with a local presentation walkthrough and separate deployment/publishing instructions.

## Limits

Hosted CI passed on Windows, macOS, and Ubuntu, including the Docker job. Production deployment and the public GitHub Release installer were verified. The CLI has not been published to the npm registry; its GitHub tarball works directly with npx. The temporary VibePro containers were stopped after validation; the presentation server on port 8011 remains running.

An actual code audit is performed by the selected AI coding agent using its usual account/model access. The included sample findings demonstrate the viewer and are explicitly labeled as a sample.

## Evidence and instructions

- [Browser interaction checks](checks/browser-interactions.json)
- [Docker checks](checks/docker.json)
- [Responsive screenshots and accessibility results](screenshots/product/README.md)
- [Local presentation instructions](../README.md)
- [Production deployment evidence](DEPLOYMENT.md)
- [Deployment and updates](../DEPLOY.md)
- [CLI distribution](../PUBLISH.md)
