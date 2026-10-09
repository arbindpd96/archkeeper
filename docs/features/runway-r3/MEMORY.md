# Feature: runway-r3

Status: in progress | Branch: docs/runway-r3

## Goal

v0.0 Runway milestone R3 (issues #14, #15): ADR-0012, 0014, 0015, 0016 and 0018 accepted and reconciled with what R1 and R2 built, ADR-0002's status line updated, rows in `docs/decisions.md`, links from `docs/architecture.md`, and the R3 items ticked in `docs/ROADMAP.md`. Docs only.

## Decisions (never undo without asking)

- 2026-10-09: The ADRs start from the drafts in #14 and #15 and change only where R1, R2 or a recorded decision differs. Why: the drafts were filed with the owner's roadmap go-ahead; R1 and R2 decided details after them.

## Done

- [ ] ADR-0012 brand constants (#14)
- [ ] ADR-0014 on-disk contract and merge-safe lifecycle (#15)
- [ ] ADR-0015 hook runtime and per-hook failure policy (#15)
- [ ] ADR-0016 delivery split; ADR-0002 status line (#15)
- [ ] ADR-0018 no telemetry, offline by default, benchmarks (#15)
- [ ] decisions.md rows, architecture.md links, ROADMAP R3 ticks

## Next step

Write `docs/adr/0012-brand-constants.md` from the #14 draft, reflecting `src/core/brand.ts` and `scripts/check-brand.mjs` as built in R1.

## Gotchas / don't try again

- None yet.

## Open questions

- None yet.
