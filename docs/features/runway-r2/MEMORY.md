# Feature: runway-r2

Status: in progress | Branch: feat/runway-r2

## Goal

v0.0 Runway milestone R2 (issues #8–#13): fixture projects, a demo-GIF pipeline that renders brand-templated tapes against the packed CLI, ADR-0013 and a tag-triggered staged-publish workflow with a PR-time dry run, maintainer-run changesets, and a commit-author check in `CI passed`.

## Decisions (never undo without asking)

- 2026-10-09: Dependabot PRs keep `dependabot[bot]` authorship (ROADMAP proposed default #11), so #13 ships no re-authoring step and no `deps:adopt`. Why: owner decision recorded in ROADMAP "How we work".

## Done

- [ ] #8 fixtures
- [ ] #10 ADR-0013
- [ ] #12 changesets
- [ ] #11 release workflow and runbook
- [ ] #9 demo-GIF pipeline
- [ ] #13 commit-author check

## Next step

Add the three fixture projects under `examples/` (#8) and keep them out of lint, the comment check, coverage and the package.

Reuse: `scripts/lib.mjs` (`exitWith`, `repositoryFiles`), `test/helpers.ts` (`runScript`, `tempDir`, `tempRepo`, `writeFiles`), the action SHAs pinned in `.github/workflows/ci.yml`, `AI_ATTRIBUTION` in `.claude/hooks/attribution.mjs` (read-only: PR #70 owns `.claude/hooks/**`).

## Gotchas / don't try again

- None yet.

## Open questions

- None yet.
