# ADR-0008: Offer optional install of Superpowers / Spec Kit instead of rebuilding them

- Status: accepted
- Date: 2026-10-09
- Deciders: owner

## Decision
`init` offers (off by default) to add **obra/superpowers** (a plugin for planning and TDD workflow) and/or **github/spec-kit** (spec-driven development). Our own planning features stay lightweight and focus on what these tools lack: memory, architecture map, design sync, health.

## Consequences
- We must not ship commands that clash in name or behaviour with theirs, and `doctor` detects overlaps.
- We track their install commands and pin known-good versions.
