# VibePro deployment

## Current setup

| Component | Location |
| --- | --- |
| Public website and FastAPI API | https://vibepro-eight.vercel.app |
| Source and CLI releases | https://github.com/the-asmit/VibePro |
| Vercel project | `asmitnayan-8521/vibepro` |
| Vercel project ID | `prj_MkhEBUP9Rvj3A5pTJCWwvM2MxczA` |
| Vercel workspace ID | `team_q8s81QD1Cw7t21iXjxDYT34B` |
| Persistent stats database | Dedicated Neon resource `vibepro-stats`, Free plan |
| API and database region | `iad1` |

The website and API run in the same Vercel project. `/cli.tgz` redirects to the CLI tarball in this repository's GitHub Release. Users need only Node.js to run the installer; the Python backend runs on Vercel. No Render, Railway, or AWS account is required.

Production is publicly accessible. Preview deployments remain protected by Vercel Authentication. Database credentials and the private signing key are stored in Vercel environment variables, not in GitHub.

Vercel is connected to GitHub repository ID `1424541688` (`the-asmit/VibePro`), with `main` as the production branch. Pushing to `main` starts a production deployment automatically. The database and signing secret are configured for Production; a preview needs its own environment configuration before its API can run.

## Production environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled Postgres URL supplied by the dedicated Neon integration |
| `VIBEPRO_SIGNING_KEY` | Secret `base64:<Ed25519 PEM>`; cannot be pulled back from Vercel |
| `VERSION` | Optional; defaults to the latest versioned engine folder |
| `CORS_ORIGINS` | Optional; same-origin website/API does not need an additional origin |

The production public-key fingerprint is:

```text
e6c562d63acfdc00e93c0f06611229387a3d2caecfe5006c2802322667dcf2e3
```

Keep a secure backup of `backend/keys/production/private_key.pem`. The original local project has this ignored backup. It is not in the repository, the CLI package, or the deployment upload. Do not generate a replacement during routine deployment: changing the key requires coordinated API/client trust changes.

`pyproject.toml` selects Python 3.12, declares the API dependencies, and points Vercel to `backend.app:app`. `vercel.json` selects FastAPI and places the function in `iad1`. Let Vercel install the Python dependencies; overriding its install command with `npm ci` alone would omit them. Local npm setup is skipped when running inside Vercel.

The API uses the existing SQLAlchemy models with psycopg and Neon's pooled connection URL. First-start schema creation is serialized with a Postgres advisory lock. Local development continues to use SQLite.

## Update this deployment

1. Make and review changes in this repository.
2. If you ran the local server, restore the production public trust roots before committing:

   ```sh
   npm run release:prepare
   ```

   This requires the existing ignored production-key backup. It updates public keys only and never prints the private value.

3. Commit and push to **`the-asmit/VibePro` only**. For CLI changes, bump `cli/package.json` before publishing new package bytes; existing GitHub Release versions are not overwritten.
4. Monitor the automatic deployment in the Vercel project dashboard. For a manual deployment, link explicitly to this project if the checkout is not already linked:

   ```sh
   npx vercel@64.5.0 link --yes --project vibepro --scope team_q8s81QD1Cw7t21iXjxDYT34B
   npx vercel@64.5.0 project inspect --non-interactive
   npx vercel@64.5.0 deploy --prod --scope team_q8s81QD1Cw7t21iXjxDYT34B
   ```

   Confirm the inspection shows project ID `prj_MkhEBUP9Rvj3A5pTJCWwvM2MxczA` before deploying. No other project needs to be changed.

5. Check `/health`, `/api/v1/manifest/signed?version=latest`, `/api/v1/stats`, `/`, and `/report.html?sample=1`. The website must show **Signature verified**, and its real-file hash check must pass.

The CLI release workflow checks the production manifest and the packaged viewer before uploading a tarball and SHA-256 checksums to GitHub Releases. See [PUBLISH.md](PUBLISH.md).

## Future engine releases

```sh
python backend/scripts/release.py 1.1.0
```

Review and commit the new `engine/1.1.0/` snapshot, then deploy. Keep existing versioned release folders so earlier file URLs continue to work.

## Optional Docker hosting

The Dockerfile and Render blueprint remain available as an alternative deployment route. They are not used by the Vercel deployment. Docker runs as a non-root user; a writable persistent disk is required if using SQLite. Configure the same production signing key and matching public trust roots on any alternative host.
