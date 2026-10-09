# Feature: v0.1-m2-apply

Status: in progress | Branch: feat/v0.1-m2-apply

## Goal

v0.1 milestone M2 (issues #21, #22, #23, #24): turn M1's render tree, a snapshot of the project and the lock into a pure, reviewable plan; merge into blocks, json, owned and create-only files without losing a user byte; refuse every unsafe path; and apply the plan transactionally with a backup, compressed base blobs, lockfile v1 written last and a full rollback. Done means every acceptance criterion in the four issues holds (ADR-0014 wins where an issue differs), a second plan against the applied state holds only `skip` operations, and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-10: Start from the issue texts, their R3 and M1 comments and ADR-0014; where an issue and the ADR differ, the ADR wins. Why: the milestone brief and the comments on #22, #23 and #24.

## Done

- [ ] Feature memory

## Next step

Write the core pieces in order: path safety, markers and the blocks parser, the json entries, the lock schema, the planner; then the CLI apply.

## Gotchas / don't try again

- None yet.

## Open questions

- None yet.
