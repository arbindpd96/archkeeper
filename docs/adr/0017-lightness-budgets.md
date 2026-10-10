# ADR-0017: Lightness budgets as a CI contract

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: none

## Context

'Small projects stay light' is a differentiator (handoff §3 #5) and the owner's direction (ADR-0003). The claim is only credible if it is measured on every change.

Always-on context comes from more than instruction files. SessionStart `additionalContext` is injected every session and survives compaction re-injection, so a budget that ignores it would understate the real cost.

## Decision

`budgets.json` is the single source for these budgets:

- tarball 300 kB or less
- 0 runtime dependencies
- each hook bundle 30 kB or less
- hook p95 latency 200 ms or less on ubuntu CI (Windows is reported, not gated)
- warm `init` under 2 s
- always-on context per preset, counted as chars/4: 1.5k tokens for small, 3k for medium and 4.5k for full

Always-on context covers:

- CLAUDE.md and its resolved imports
- rules without `paths`
- the descriptions of model-invocable skills
- the preset's SessionStart output, counted at its cap (1,200 / 3,000 / 4,000 chars)

CI fails when a budget is exceeded, and raising a budget needs an ADR note. The README presets and Lightness tables are generated from the measurements.

The first three budgets are enforced from v0.0 by `scripts/check-package.mjs` (in `npm run check` and the CI `Package checks` job, which also writes the sizes to the job summary). The latency, `init` and context budgets join `budgets.json` with the features they measure.

## Consequences

- Features compete for budget, so heavy features must be opt-in, path-scoped, or excluded from model invocation.
- Any new hook that injects context every session must declare a cap and fit within the budget.
- Budgets may be tuned after real measurement, with an ADR note each time.

## Alternatives considered

- **Unenforced README claims.**
- **Counting only instruction files.** Understates the context that hooks inject.
- **Judging weight case by case in review.**

## Notes

- **2026-10-10, v0.1 M4: guard-bash gets its own bundle budget of 120 kB** (`budgets.json` `hookBundle.overrides`); every other hook keeps 30 kB. Pending the owner's sign-off ([v0.1-m4-safety memory](../features/v0.1-m4-safety/MEMORY.md)).
  - Measured: the faithful port of this repository's hardened guard (#31, the #65 hardening and the R3 review rules) bundles to 109.7 kB as built, 102.3 kB without comments, 79.2 kB minified with its names kept and 54.0 kB fully minified. No build reaches 30 kB without dropping rules; the reference guard itself bundles to 91.6 kB.
  - Hook bundles stay unminified. They are committed in users' repositories, so a readable file keeps the guard auditable and each kit update's diff reviewable, and a stack trace from a user's machine points at readable code. Minifying saved no measurable latency: 36 ms p50 and 43 ms p95 either way, against the 200 ms latency budget.
  - The tarball stays far inside its 300 kB budget, since the bundle compresses to about 32 kB.
