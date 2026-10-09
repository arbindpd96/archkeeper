# Releasing

The maintainer's runbook for [ADR-0013](adr/0013-release-process.md). CI never commits and never publishes by itself: a `v*` tag push stages the release on npm, and nothing is public until you approve it with 2FA.

## Every release

1. **Changesets.** Merged PRs carry `.changeset/*.md` files ([CONTRIBUTING](../CONTRIBUTING.md#changesets)).
2. **Version.** On a branch from an up-to-date `main`:

   ```sh
   read -rs GITHUB_TOKEN && export GITHUB_TOKEN    # paste the read-only token; it stays out of history
   npm run version-packages
   unset GITHUB_TOKEN
   ```

   This applies the changesets to `package.json`, `package-lock.json` and `CHANGELOG.md`. The GitHub changelog looks up each changeset's PR and author, so it needs a token: use a fine-grained personal access token with read-only access to public repositories and no other permission, not your full `gh auth token`. Review `CHANGELOG.md`, commit `chore(release): vX.Y.Z`, and merge the PR like any other.

3. **Tag and push.** On `main` at the release commit:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. **Approve.** The `Release` workflow's build job holds no secret. It checks npm 11.15+, the tag against `package.json`, the `CHANGELOG.md` section, `private`, that the version is not below npm's `latest`, and that the tagged commit is on `main`. It removes the dev-only `prepare` script, runs every check, and packs the tarball. The stage job, in the `npm-stage` environment, installs nothing: it stages that tarball with an explicit dist-tag (`next` for prereleases, `latest` otherwise), and its job summary prints the tarball's shasum and the exact commands. Before you approve, check that `npm stage view <id>` shows that shasum and that `npm stage list archkeeper` shows no other pending stage:

   ```sh
   npm login                 # only for the approval
   npm stage view <id>       # the shasum must match the job summary
   npm stage approve <id>    # asks for your 2FA code
   npm logout
   ```

   Run it in a normal terminal. Inside Claude Code, a `!` command has no TTY to prompt on, so pass `--otp=<code>` (docs/mistakes.md).

   `npm stage reject <id>` discards a stage, and `npm stage download <id>` fetches its tarball.

5. **Verify.** The workflow polls the registry for an hour. Once you approve, it checks that npm serves exactly the files it built, installs `archkeeper@X.Y.Z` on ubuntu, macOS and Windows, runs `--version`, and creates the GitHub Release from the CHANGELOG section. If you approved later, re-run only the **Wait for the approved publish** job. Re-running the whole workflow before you approve would stage the version a second time.

## Release candidates

```sh
npx changeset pre enter rc
npm run version-packages    # with the read-only GITHUB_TOKEN exported as above; for example 0.1.0-rc.0
```

Commit `.changeset/pre.json` with the release commit, then tag `v0.1.0-rc.0`; it is staged under the `next` dist-tag. Each further changeset and `version-packages` run produces the next `rc.N`. Before the final release, run `npx changeset pre exit`, then `version-packages` again for `0.1.0`.

## The first publish

The name is reserved by a notice-only `0.0.1` placeholder on `latest`, so the first real version must be higher (planned: `0.1.0-rc.0`). Always pass an explicit `--tag`: without one, npm refuses any version at or below `0.0.1`.

The first release is published from your laptop, then tagged:

1. Enable 2FA on the npm account. Merge the release commit, which removes `"private": true`.
2. From a clean checkout of that commit, run the same guards and checks as the workflow while logged out of npm, so no dev dependency runs beside your npm session. Log in only to stage and approve the packed tarball, then log out:

   ```sh
   npm ci --ignore-scripts
   node scripts/check-release.mjs --tag v0.1.0-rc.0
   npm pkg delete scripts.prepare
   npm run check && npm run package -- --release
   packed="$(mktemp -d)" && node scripts/pack-release.mjs "$packed"
   npm login
   npm stage publish "$packed/archkeeper-0.1.0-rc.0.tgz" --registry https://registry.npmjs.org/ \
     --access public --tag next --ignore-scripts
   npm stage approve <id>
   npm logout
   git checkout -- package.json
   ```

3. Tag the commit and push the tag. The workflow finds the version on npm and skips staging. It still checks that npm serves the files it builds from the tag, then runs the registry smoke test and the GitHub Release.

After the first approval, check `npm view archkeeper dist-tags`.

## The stage-only token and the npm-stage environment

The stage job reads `NPM_STAGE_TOKEN` from the `npm-stage` environment and refuses to start without it (#58).

- On npmjs.com, create a granular token with **Read and write (stage only)** for `archkeeper`, expiring in 90 days or less. It can stage but never publish directly.
- In the repository settings, open **Environments → npm-stage** (the first tag push creates it). Set its deployment rule to allow only tags matching `v*`, and optionally add yourself as a required reviewer.
- Save the token as an environment secret: `gh secret set NPM_STAGE_TOKEN --env npm-stage --repo arbindpd96/archkeeper`. Do not store it as a repository secret, which every workflow on every branch could read.
- Add a tag ruleset for `v*` that lets only you create tags and blocks updating and deleting them.
- When you create the token, open an `owner-action` issue to rotate it, due a week before it expires. To rotate, create a new token, set the secret again, and revoke the old token.

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
