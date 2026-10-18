# Deploy VibePro later

Deployment is optional for the presentation. First follow the local steps in [README.md](README.md).

## Can this run on Vercel?

Yes. Vercel supports [FastAPI applications](https://vercel.com/docs/frameworks/backend/fastapi), so the website and API can share a Vercel deployment. The current checked-in deployment configuration targets Docker/Render; importing it into Vercel unchanged is not a complete setup.

Before using Vercel:

- Configure the Python entrypoint as `backend.app:app`, include the versioned `engine/` files and website assets, and install `backend/requirements.txt`. The npm postinstall script is for local development and should not create a DEV environment during a production build.
- Replace the local SQLite statistics database with a persistent hosted database, such as Postgres, and install its SQLAlchemy driver. Set `DATABASE_URL` to that service's connection URL. [Vercel functions do not provide shared persistent storage for a local SQLite database](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).
- Store the production `VIBEPRO_SIGNING_KEY` in Vercel environment variables and synchronize its public key into the website and CLI. Keep the website and `/api/` routes on the same origin.
- Set the CLI's production API URL to the actual Vercel HTTPS origin, then distribute the CLI through npm or a GitHub Release as described in [PUBLISH.md](PUBLISH.md).

These Vercel changes and a hosted database have not been configured or deployed here. The Render steps below use the existing Docker image and persistent SQLite disk.

## Deploy with the existing Render configuration

The service hosts the website and API together. The Render blueprint uses a paid Starter service with a persistent disk for SQLite. Render disks require a paid service; without a disk, filesystem changes disappear on redeploy/restart. Check the current [Render disk documentation](https://render.com/docs/disks) before choosing hosting.

## 1. Prepare the repository

Create your own GitHub repository, then commit and push this project. Confirm that `backend/keys/`, `.env*`, private PEM files, databases, logs, and `node_modules/` are excluded. The project has not been deployed or published by the local setup.

## 2. Create a separate production key

From the project root:

```powershell
python backend/scripts/generate_keys.py --output-dir backend/keys/production --sync-public-key --show-secret
```

This creates or reuses the key in that directory, updates both public trust roots, and prints the private deployment value. Copy only the `base64:...` value into Render's `VIBEPRO_SIGNING_KEY` secret field. Keep the private value out of source code, screenshots, commits, and chat. Keep a secure offline backup.

Commit the changed **public** trust roots in `cli/lib/trusted-key.js` and `web/app.js`. The private key stays ignored. Use a new output directory for a future key rotation; the script never silently overwrites an existing private key.

The local launcher deliberately restores the local DEV trust roots when run. After selecting a production key, repeat production synchronization before committing/releasing public artifacts.

## 3. Create the Render service

1. Choose **New → Blueprint** in Render and connect your GitHub repository.
2. Review `render.yaml`: it creates the Docker service and a 1 GB disk mounted at `/var/data`.
3. Set the `VIBEPRO_SIGNING_KEY` secret to the production `base64:...` value.
4. Keep `CORS_ORIGINS` empty when the website and API use this same service. If hosting the website separately, set its exact origin(s).
5. Deploy. Check `/health`, `/`, `/report.html`, `/api/v1/manifest/signed?version=latest`, and `/api/v1/stats`. The website must say **Signature verified**.

Use the HTTPS origin Render actually assigns. The repository does not assume or reserve a public hostname. If choosing an ephemeral/free service instead, remove the disk from the blueprint and accept that anonymous statistics will reset on restarts; review the provider's current plan limits first.

## 4. Configure and test the public CLI

Set `DEFAULT_API_URL` in `cli/lib/config.js` to that real HTTPS origin. Confirm the public trust root matches the deployed signing key.

```powershell
npm test --prefix cli
node cli/bin/vibepro.js install --agent codex --dry-run
```

Then follow [PUBLISH.md](PUBLISH.md). Public `npx vibepro-cli` installation becomes your distribution path only after the correct package has been published.

## Environment variables

| Name | Purpose |
| --- | --- |
| `VIBEPRO_SIGNING_KEY` | Required private Ed25519 PEM, or `base64:<PEM>` |
| `DATABASE_URL` | Blueprint uses `sqlite:////var/data/vibepro.db` |
| `CORS_ORIGINS` | Empty for same-origin hosting; otherwise exact comma-separated website origins |
| `VERSION` | `latest`, or a versioned engine folder |
| `PORT` | Blueprint/container defaults to `10000` |

## Future engine releases

```powershell
python backend/scripts/release.py 1.1.0
```

Review and commit the new `engine/1.1.0/` snapshot, then deploy. Keep existing released folders so old versioned file URLs continue to work.

The Docker image runs as a non-root user. HTTPS terminates at the host proxy; local development binds only to `127.0.0.1`.
