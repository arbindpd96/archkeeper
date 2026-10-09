# Releasing

The maintainer's runbook for [ADR-0013](adr/0013-release-process.md). CI never commits and never publishes by itself: a `v*` tag push stages the release on npm, and nothing is public until you approve it with 2FA.

## Every release

1. **Changesets.** Merged PRs carry `.changeset/*.md` files ([CONTRIBUTING](../CONTRIBUTING.md#changesets)).
2. **Version.** On a branch from an up-to-date `main`:

   ```sh
   GITHUB_TOKEN="$(gh auth token)" npm run version-packages
   ```

   This applies the changesets to `package.json`, `package-lock.json` and `CHANGELOG.md`; the GitHub changelog needs the token to look up PRs and authors. Review `CHANGELOG.md`, commit `chore(release): vX.Y.Z`, and merge the PR like any other.

3. **Tag and push.** On `main` at the release commit:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. **Approve.** The `Release` workflow checks npm 11.15+, the tag against `package.json`, the `CHANGELOG.md` section, `private`, and that the version is not below npm's `latest`. It removes the dev-only `prepare` script, runs every check, and stages the package with an explicit dist-tag: `next` for prereleases, `latest` otherwise. Its job summary prints the exact command:

   ```sh
   npm stage view <id>       # optional: inspect it, or npm stage download <id> for the tarball
   npm stage approve <id>    # asks for your 2FA code
   ```

   `npm stage list archkeeper` shows pending stages, and `npm stage reject <id>` discards one.

5. **Verify.** The workflow polls the registry for an hour. Once you approve, it installs `archkeeper@X.Y.Z` on ubuntu, macOS and Windows, runs `--version`, and creates the GitHub Release from the CHANGELOG section. If you approved later, re-run the **Wait for the approved publish** job. A full re-run is also safe: a version already on npm is verified, not staged again.

## Release candidates

```sh
npx changeset pre enter rc
GITHUB_TOKEN="$(gh auth token)" npm run version-packages    # for example 0.1.0-rc.0
```

Commit `.changeset/pre.json` with the release commit, then tag `v0.1.0-rc.0`; it is staged under the `next` dist-tag. Each further changeset and `version-packages` run produces the next `rc.N`. Before the final release, run `npx changeset pre exit`, then `version-packages` again for `0.1.0`.

## The first publish

The first release is published from your laptop, then tagged:

1. Run `npm login` with 2FA enabled on the account. Merge the release commit, which removes `"private": true`.
2. From a clean checkout of that commit:

   ```sh
   npm ci --ignore-scripts
   npm pkg delete scripts.prepare
   npm run check && npm run package -- --release
   npm stage publish --access public --tag next --ignore-scripts
   npm stage approve <id>
   git checkout -- package.json
   ```

3. Tag the commit and push the tag. The workflow finds the version on npm, skips staging, and runs the registry smoke test and the GitHub Release.

The name is reserved by a notice-only `0.0.1` placeholder on `latest`, so the first real version must be higher (planned: `0.1.0-rc.0`). Always pass an explicit `--tag`: without one, npm refuses any version at or below `0.0.1`. After the first approval, check `npm view archkeeper dist-tags`.

## The stage-only token

`release.yml` stages with the `NPM_STAGE_TOKEN` secret and refuses to start without it (#58).

- On npmjs.com, create a granular token with **Read and write (stage only)** for `archkeeper`, expiring in 90 days or less. It can stage but never publish directly.
- Save it with `gh secret set NPM_STAGE_TOKEN --repo arbindpd96/archkeeper`.
- When you create it, open an `owner-action` issue to rotate it, due a week before it expires. To rotate, create a new token, set the secret again, and revoke the old token.

## Rollback

npm versions are immutable, so roll forward:

- Deprecate the bad version: `npm deprecate archkeeper@X.Y.Z "Broken: <why>. Use X.Y.W."`
- Point the dist-tag back at a good version: `npm dist-tag add archkeeper@<good> latest` (or `next`).
- Release a fixed patch. Unpublish only as a last resort, within npm's 72-hour window.

## Trusted publishing

npm/cli#9969 blocks trusted publishing for this repo, so there is no `id-token: write` and no provenance yet. Once it is fixed:

1. Run `npm trust github archkeeper --file release.yml --repo arbindpd96/archkeeper --allow-publish` (npm 11.15+, 2FA).
2. Add `id-token: write` to the stage job, and publish within 48 hours, before the unvalidated trust config expires.
3. Delete the `NPM_STAGE_TOKEN` secret, revoke the token, and set the package to require 2FA and disallow tokens.
