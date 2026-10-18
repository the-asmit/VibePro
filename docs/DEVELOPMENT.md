# Developing VibePro

This guide is for running and contributing to VibePro from source. For the public installer and report viewer, see the [README](../README.md).

## Requirements

- Node.js 18 or later; Node.js 22 or later recommended.
- npm 8 or later.
- Python 3.12 or later for the local API.

CLI users need only Node.js. Python is needed when hosting the API from this checkout.

## Run locally

From the repository root:

```sh
npm install
npm start
```

The install command links the CLI workspace and prepares an isolated `.venv/` with backend dependencies. Startup reuses or creates a local DEV signing key and synchronizes its public key into the website and CLI.

- Website: <http://127.0.0.1:8011/>
- Sample report: <http://127.0.0.1:8011/report.html?sample=1>

Use `npm start -- --open` to open both pages automatically. Keep the server terminal open; Ctrl+C stops a server started by the launcher. If VibePro is already running on that port with the matching key, the launcher reuses it without stopping it.

Use `npm start -- --port 8012` for another port, then pass `--api http://127.0.0.1:8012` to local CLI commands. If installation was interrupted or lifecycle scripts were disabled, run `npm run setup`.

## Use the local CLI

In another terminal at the repository root:

```sh
npx vibepro-cli install --agent codex
npx vibepro-cli verify --agent codex
npx vibepro-cli doctor
```

After `npm install`, npx resolves this checkout's CLI workspace. Source-checkout commands default to the local API on port 8011; distributed packages use the deployed API. Use `--api <URL>` or `VIBEPRO_API` to override the origin.

Choose `codex`, `claude`, `cursor`, `antigravity`, or `gemini`. Use `--dry-run` to preview an installation and `--project` to install into the current repository.

| Command | Purpose |
| --- | --- |
| `install --agent <name>` | Download, verify, and install the audit engine |
| `update --agent <name>` | Update an existing installation |
| `verify --agent <name>` | Check installed file integrity |
| `doctor` | Inspect the runtime, API, signature, and installations |
| `report [file-or-directory]` | Validate findings and open the local viewer |
| `uninstall --agent <name>` | Remove an installation |
| `list` | List installed agents |
| `about` | Show project and methodology information |

The `report` command accepts a file, a directory containing `findings.json`, or no path to find the newest audit run for the current project. Report viewing and uninstall do not need a running backend.

## Work with reports

```sh
npm run report
```

This opens the illustrative sample findings. They demonstrate the viewer and are not an audit of VibePro.

For a real audit, install VibePro for your coding agent, open the target project, and ask the agent to audit it. The agent uses its normal account, model access, and tools, and writes results under `~/security-audit-skill/<repo-name>/run-<N>/`.

Open an output file with:

```sh
npm run cli -- report /path/to/findings.json
```

The CLI validates the report schema and opens a loopback server. Keep that terminal open until finished, then press Ctrl+C. Findings are not uploaded.

## Project structure

| Folder | Purpose |
| --- | --- |
| `backend/` | FastAPI registry, signing, anonymous event counts, and static hosting |
| `web/` | Website and browser report viewer |
| `cli/` | Installer, updater, integrity checks, diagnostics, and bundled viewer |
| `engine/vibepro-audit/` | Editable audit-method source with its provenance and license |
| `engine/1.0.0/` | Versioned engine release served by the API |
| `scripts/` | Local launcher, end-to-end checks, and browser review tools |
| `docs/` | Development instructions and verification evidence |

The versioned engine and editable source serve different purposes. The website viewer and bundled CLI viewer must stay in sync.

## Checks

Install development dependencies, then run the existing checks:

```sh
python -m pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
npm test --workspace vibepro-cli
python scripts/e2e.py
```

The end-to-end check uses a temporary home, disposable signing key, temporary server, and isolated database.

For browser checks, start the local API and install the optional tools:

```sh
npm ci --prefix tools
npm exec --prefix tools -- playwright install chromium
node scripts/check-site.cjs
node scripts/review-site.cjs
```

GitHub Actions runs backend, CLI, package, and end-to-end checks on Windows, macOS, and Ubuntu. Upstream validator checks run on Ubuntu because they require POSIX file flags. A separate job builds and checks the Docker image.

## Deployment and releases

See [DEPLOY.md](../DEPLOY.md) for hosting and update procedures, and [PUBLISH.md](../PUBLISH.md) for CLI releases.

Local startup synchronizes the DEV public key into two tracked files. Before committing production code, run `npm run release:prepare` with the existing ignored production-key backup. This restores the production public trust roots. Private keys, environment files, local databases, dependencies, and caches must remain outside Git.

The root npm package is private. The distributable CLI is a separate workspace with no Python dependency or install lifecycle scripts.
