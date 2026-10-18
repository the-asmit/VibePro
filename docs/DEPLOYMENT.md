# Production deployment checks

Verified on 18 October 2026.

## Live project

- [Website](https://vibepro-audit.vercel.app/)
- [Sample report](https://vibepro-audit.vercel.app/report.html?sample=1)
- [Source repository](https://github.com/the-asmit/VibePro)
- [CLI v1.0.0 release](https://github.com/the-asmit/VibePro/releases/tag/v1.0.0)
- Vercel project: `asmitnayan-8521/vibepro`, ID `prj_MkhEBUP9Rvj3A5pTJCWwvM2MxczA`.
- Dedicated Neon resource: `vibepro-stats`, Free plan, `iad1`.

Only the newly created `the-asmit/VibePro` repository was written to. The Vercel project and database were created for VibePro. Existing unrelated GitHub repositories were not modified.

Vercel confirms its Git connection targets repository ID `1424541688`, owner `the-asmit`, repository `VibePro`, production branch `main`.

The public address was changed to `vibepro-audit.vercel.app` on 18 October 2026. The old generated address redirects to it with HTTP 308. Existing screenshot measurements retain their original capture URLs as historical evidence.

## Public installer

```sh
npx https://vibepro-audit.vercel.app/cli.tgz install --agent codex
```

The redirect resolves to the GitHub Release tarball. An actual public-package installation was run in an isolated home without overriding the API URL. Installation, `verify`, and `doctor` passed, with 22 intact engine files. The user's existing Codex installation was not replaced by this check.

Tarball: `vibepro-cli-1.0.0.tgz`

```text
SHA-256: 6b7d35e36e61c988553bdf77b2cd80dc5bae9f618eef4c3b1a37ef93ecb7d70a
```

The packaged API origin `https://vibepro-asmitnayan-8521.vercel.app` is an additional production alias of the same Vercel project. Both aliases were checked. The package is distributed through GitHub Releases; no npm registry publication was performed.

## API and data

| Check | Result |
| --- | --- |
| Public `/health` | HTTP 200, status `ok` |
| Signed manifest | Verified against the pinned production Ed25519 key |
| Engine files | All 22 downloads matched the signed sizes and SHA-256 hashes |
| `/api/v1/stats` | HTTP 200; 1 real Codex install persisted in Neon |
| Website | Live version/file count, signature status, real-file hash interaction, stats, and public npx command passed |
| Sample report | Three illustrative findings rendered |
| Responsive review | Website and report checked at 1440, 1024, 768, and 390px |
| Browser errors and overflow | None at those widths |

The install count is an observation at verification time, not a fixed value. Screenshots and browser measurements are in [the production screenshot index](screenshots/deployment/README.md).

Production public-key fingerprint:

```text
e6c562d63acfdc00e93c0f06611229387a3d2caecfe5006c2802322667dcf2e3
```

The private key is stored as a Vercel Production Secret. Its local backup remains ignored under `backend/keys/production/`; it is excluded from Git, the CLI tarball, and Vercel source uploads.

## Hosted checks

At source commit `b4c2cd97b7d2532d3427fe19842a894c40658dd2`:

- [CI run](https://github.com/the-asmit/VibePro/actions/runs/39143705659): Windows, macOS, Ubuntu, and Docker jobs passed.
- [Release run](https://github.com/the-asmit/VibePro/actions/runs/39143705597): verified production manifest, packaged CLI, and published `v1.0.0` successfully.
- Backend: 13 tests passed; CLI: 14 tests passed; upstream POSIX validators: 65 tests passed. Existing end-to-end checks passed on all three operating systems.
- [Initial successful production deployment](https://vercel.com/asmitnayan-8521/vibepro/44NushFQhiDkHARLCQUHCbsQjWQL): READY with Python 3.12 in `iad1`.

The first deployment exposed a missing Python dependency installation step. Removing the npm-only install override fixed it; Vercel now installs the FastAPI dependencies from `pyproject.toml`. Production aliases are public, while preview and unique deployment URLs retain Vercel Authentication.

## Owner workflow

Use [DEPLOY.md](../DEPLOY.md) for updates and [PUBLISH.md](../PUBLISH.md) for CLI releases. Local development stores its verification keys in ignored files and leaves production public trust roots unchanged. Use `npm run release:prepare` for intentional production-key maintenance. Keep the existing production private-key backup secure.
