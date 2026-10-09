# ADR-0013: Release process with maintainer-run changesets and npm staged publishing

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: ADR-0009, release-automation consequence only (changesets or release-please, trusted publishing with provenance)

## Context

ADR-0009 deferred release automation and assumed trusted publishing with provenance. Several constraints now apply (reference §7.3):

- **OIDC blocker.** This repo was created after 2026-07-15, so its GitHub OIDC subject is immutable, and npm's token exchange rejects it with E404 (npm/cli#9969).
- **Authorship.** The working agreement says the maintainer authors every commit, but `changesets/action` and release-please open bot-authored PRs or commits.
- **Staged publishing.** It is GA (npm 11.15 or later), can create new packages, and stage-only tokens exist.

## Decision

**Versioning.** The maintainer runs changesets locally and commits the result as `chore(release): vX.Y.Z`.

- Release candidates use pre mode: `npx changeset pre enter rc`, then `npx changeset version` (producing, for example, `0.1.0-rc.0`).
- `npx changeset pre exit` comes before the final `npx changeset version`.
- `changesets/action` is not used, and no bot opens a "Version Packages" PR.

**First publish.** From the maintainer's laptop: `npm stage publish --access public --tag next`, then `npm stage approve <id>` with 2FA.

**Every later release.** A `v*` tag push triggers `release.yml`, which:

1. Asserts npm 11.15 or later.
2. Checks that the tag matches the `package.json` version and points at a commit on `main`, that the CHANGELOG has a matching section, and that the package is not `private`.
3. Strips dev-only lifecycle scripts (`prepare`) from the manifest, then runs check, build and the package checks on the stripped manifest, and packs the tarball. This build job holds no secret.
4. Runs `npm stage publish` on that tarball in a separate job that installs nothing, with `NPM_STAGE_TOKEN`: a stage-only token that expires in 90 days or less, has a rotation issue, and is a secret of the `npm-stage` environment, which admits only `v*` tags.

**Dist-tags.** Every stage passes an explicit `--tag`: `next` for prereleases and `latest` for releases. The name is held by a notice-only `0.0.1` placeholder on `latest`, so npm refuses an implicit `latest` for any version at or below it. The first real version is above it (planned: `0.1.0-rc.0`). An explicit tag also turns off npm's refusal to move `latest` backwards, so the release guards refuse any version below the one `latest` points at.

The maintainer approves each stage with 2FA. CI creates GitHub Releases but never commits. A post-publish job smoke-tests the registry package on three OSes. From v0.2, an N-1 upgrade e2e is a required release job. Every pull request dry-runs the same guards and package checks without publishing.

**Provenance.** There is no `id-token` permission and no provenance claim until #9969 is fixed. After the fix:

1. Run `npm trust github <pkg> --file release.yml --repo <owner/repo> --allow-publish`.
2. Publish within 48 h.
3. Delete the token, then require 2FA with tokens disallowed.

## Consequences

- Every release needs a human 2FA approval.
- A token exists until #9969 is fixed and must be rotated.
- There is no provenance badge until then.
- From v0.3, the plugin version is bumped in the same release commit.
- ADR-0009's status line notes that its release-automation consequence is superseded.

## Alternatives considered

- **Trusted publishing now.** Blocked by #9969.
- **`changesets/action` or release-please.** Both produce bot-authored PRs or commits.
- **Classic or bypass-2FA tokens.** Classic tokens are revoked, and bypass-2FA tokens are losing direct publish.
- **Laptop-only publishing.** No CI gating.
