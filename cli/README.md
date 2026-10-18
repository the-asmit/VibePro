# vibepro-cli

Install, update, verify, and uninstall the VibePro audit skill for supported coding agents. The CLI verifies an Ed25519-signed manifest and each downloaded file's SHA-256 digest before it writes anything. It has no install or postinstall lifecycle scripts.

## Local source use before publication

From the VibePro repository root:

```sh
npm install
npm start
```

In a second terminal:

```sh
npx vibepro-cli install --agent codex
npx vibepro-cli verify --agent codex
npx vibepro-cli doctor
```

The private root package automatically prepares the Python backend and links the CLI for npx. In this checkout, the CLI defaults to the loopback API on port 8011 when no API is configured. Python 3.12 or later must be installed to host the API locally; the published CLI itself requires only Node.js. See the repository README for the complete walkthrough.

## Public quick start (after deployment and npm publication)

```sh
npx vibepro-cli install
```

The installer detects supported agents and installs into their user-level skill directory. Choose one explicitly with `--agent codex|claude|cursor|antigravity|gemini`. Use `--project` to install in the current repository instead of your home directory.

```sh
npx vibepro-cli install --agent codex
npx vibepro-cli update --agent codex
npx vibepro-cli verify
npx vibepro-cli doctor
npx vibepro-cli report ./security-audit-skill/my-project/run-1/findings.json
npx vibepro-cli uninstall --agent codex
```

Run `npx vibepro-cli --help` for all options. `verify` compares installed files to the signed release and reports intact, modified, or missing files. `doctor` checks the runtime, API, signature, detected agents, and installed files. `report` validates `findings.json` against the bundled report schema, prints a summary, and opens a loopback-only viewer. Finding data stays on your machine.

## Anonymous telemetry

Install, update, and uninstall events are sent by default. Events contain only the event name, agent, VibePro engine version, and operating system. No IP address, username, repository name, audit output, or file content is stored in the event database. Disable events with `--no-telemetry` on a command or `VIBEPRO_TELEMETRY=0` in your environment.

## API configuration

The source checkout has no assumed public API URL. It uses `http://127.0.0.1:8011` locally when no API is configured. Pass `--api <URL>` or set `VIBEPRO_API` to override the origin (HTTP is allowed only on loopback). Before distributing a release, update the `DEFAULT_API_URL` constant in `lib/config.js` to the deployed HTTPS origin, then run the tests and package the CLI. See the repository's `DEPLOY.md` and `PUBLISH.md` for npm and GitHub release options.

## Requirements

Node.js 18 or later. Windows, macOS, and Linux are supported.

## License and credit

VibePro CLI is MIT licensed. Its audit methodology is based on [Cloudflare's security-audit-skill](https://github.com/cloudflare/security-audit-skill), also MIT licensed; see the bundled `resources/LICENSE` and the repository `NOTICE`.
