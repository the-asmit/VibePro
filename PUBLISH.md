# Distribute the VibePro CLI

The current distribution path uses GitHub Releases from **[the-asmit/VibePro](https://github.com/the-asmit/VibePro)** and the deployed Vercel API. npm publication is optional. See [DEPLOY.md](DEPLOY.md).

## Current GitHub release workflow

The public install command is:

```sh
npx https://vibepro-audit.vercel.app/cli.tgz install --agent codex
```

`/cli.tgz` redirects to the versioned tarball on GitHub. The tarball embeds the production API URL and public signing key; it contains no Python backend, private key, database, or npm lifecycle hooks.

`.github/workflows/release.yml` runs on relevant changes to `main`, or through a manual Actions run. It checks the CLI and viewer, verifies the production signed manifest, packages the CLI, and creates a GitHub Release containing the `.tgz` and `SHA256SUMS.txt`. It uses GitHub's token scoped to this repository; no personal token is stored.

Before changing CLI bytes, bump the CLI version. The workflow refuses to overwrite an existing release. Local DEV keys stay in ignored files and do not change production trust roots. `npm run release:prepare` is available for intentional production-key maintenance using the existing backup.

## Publish to npm for the short npx command

Publishing `vibepro-cli` to npm makes `npx vibepro-cli install` available from any machine with Node.js. Deploying the website does not publish the CLI automatically.

Confirm that you own the npm package name and the repository URL in `cli/package.json` points to your GitHub repository. If you choose a different package name, update the website commands and documentation before publishing. Follow the current [npm publishing instructions](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/), including your account's authentication requirements.

1. Update `cli/lib/config.js` so `DEFAULT_API_URL` is the exact deployed API origin. Commit that change.
2. From the project root, run `npm ci` and `npm test --workspace vibepro-cli`. Then, from `cli/`, run `npm pack --dry-run`. Confirm the tarball contains only the package whitelist and has no lifecycle scripts. Publish the `cli/` package; the root package is private and only manages local development.
3. Sign into the npm account that owns the `vibepro-cli` package:

   ```sh
   npm login
   npm whoami
   ```

4. Bump the package version (and make sure the backend/engine release versioning is intentional):

   ```sh
   npm version patch
   ```

   Use `npm version minor` or `npm version major` when appropriate. This updates `package.json` and `package-lock.json` and creates a Git commit/tag when run in a Git checkout.

5. Publish the public package:

   ```sh
   npm publish --access public
   ```

6. Verify from a clean directory:

   ```sh
   npx vibepro-cli@latest --version
   npx vibepro-cli@latest doctor
   npx vibepro-cli@latest install --dry-run
   ```

7. Create a GitHub release for the matching source/tag and monitor the deployed API's health and logs.

Do not publish a package with an unconfigured URL, a signing key that does not match `cli/lib/trusted-key.js`, or an API that has not passed the signed-manifest check. npm publishing is intentionally left to the package owner.

## Distribute through GitHub without publishing to npm

You can attach a CLI tarball to a public GitHub Release and run it directly. npm supports [installing HTTPS package tarballs](https://docs.npmjs.com/cli/v11/commands/npm-install/#description), including files hosted on GitHub.

1. Configure the deployed API URL and matching production public key, as above.
2. From the repository root, create the CLI package:

   ```sh
   npm pack --workspace vibepro-cli
   ```

   For version 1.0.0, this creates `vibepro-cli-1.0.0.tgz`. The package contains the CLI whitelist, not the Python backend or private keys.

3. Create a GitHub Release such as `v1.0.0` and attach that `.tgz` file as a release asset. Use the package version's matching filename for later releases.
4. Replace `OWNER` and `REPO` below with your public repository details:

   ```sh
   npx --package="https://github.com/OWNER/REPO/releases/download/v1.0.0/vibepro-cli-1.0.0.tgz" vibepro install --agent codex
   ```

   You can append `--api https://your-api.example` if the tarball does not have a default API configured.

The CLI lives in `cli/`; the root package is a private development workspace with no CLI executable. A direct `npx github:OWNER/REPO` therefore does not select the CLI in the current layout. Use the release tarball, or maintain a separate repository/branch whose root is the CLI package. The short `npx vibepro-cli` command still requires npm publication outside a locally installed checkout.

GitHub distributes the executable; the deployed API continues to serve the signed audit engine and statistics. CLI users need Node.js, not the Python backend.
