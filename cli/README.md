# VibePro CLI

Install, update, verify, and uninstall VibePro for your AI coding agent. The installer verifies an Ed25519-signed manifest and each engine file's SHA-256 and size before installation.

## Install

Requires Node.js 18 or later. Windows, macOS, and Linux are supported.

```sh
npx https://vibepro-audit.vercel.app/cli.tgz install --agent codex
```

The download redirects to this project's versioned [GitHub Release](https://github.com/the-asmit/VibePro/releases). The public CLI requires no Python installation or local backend.

Supported agents: `codex`, `claude`, `cursor`, `antigravity`, and `gemini`. Omit `--agent` to detect supported agents. Add `--project` to install for the current repository, or `--dry-run` to preview the destination.

After installation, open your project in the coding agent and ask it to audit the project with VibePro. The agent uses its existing model access and tools to perform the review.

## Commands

```sh
npx https://vibepro-audit.vercel.app/cli.tgz update --agent codex
npx https://vibepro-audit.vercel.app/cli.tgz verify --agent codex
npx https://vibepro-audit.vercel.app/cli.tgz doctor
npx https://vibepro-audit.vercel.app/cli.tgz report ./findings.json
npx https://vibepro-audit.vercel.app/cli.tgz uninstall --agent codex
```

Run `npx https://vibepro-audit.vercel.app/cli.tgz --help` for all options.

`verify` reports intact, modified, and missing files. `doctor` checks the runtime, API, signature, detected agents, and installed files. `report` validates the findings schema and opens a loopback viewer. Report data stays on your device.

## Privacy

Install, update, and uninstall commands send anonymous usage events by default. Events contain the event name, agent, engine version, and operating system. No username, repository name, audit output, or file content is stored in the event database. Disable events with `--no-telemetry` or `VIBEPRO_TELEMETRY=0`.

The CLI has no install or postinstall lifecycle scripts.

## API and development

The public CLI connects to `https://vibepro-audit.vercel.app`. Use `--api <URL>` or `VIBEPRO_API` to select another API. HTTP is allowed only for loopback addresses.

For source-checkout commands and local DEV keys, see the [development guide](https://github.com/the-asmit/VibePro/blob/main/docs/DEVELOPMENT.md).

## License and credit

VibePro CLI is MIT licensed. Its audit methodology is based on [Cloudflare's security-audit-skill](https://github.com/cloudflare/security-audit-skill), also MIT licensed. See the bundled `resources/LICENSE` and the repository [NOTICE](https://github.com/the-asmit/VibePro/blob/main/NOTICE).
