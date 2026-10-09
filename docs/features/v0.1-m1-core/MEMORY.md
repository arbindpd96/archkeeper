# Feature: v0.1-m1-core

Status: in progress | Branch: feat/v0.1-m1-core

## Goal

v0.1 milestone M1 (issues #18, #19, #20, #71): modules are validated data (manifest schema and loader), the project config and presets resolve deterministically, templates render byte-identically on every OS and for any brand, and `THIRD_PARTY_LICENSES.md` comes from the bundler's module graph now that zod is the first inlined package. Done means every acceptance criterion in the four issues holds and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-10: Start from the issue texts, the #19 comment and ADR-0014/0015/0016/0007/0012; where an issue and an ADR differ, the ADR wins. Why: the milestone brief and the roadmap.

## Done

- [ ] Feature memory

## Next step

Collect the inlined packages from the bundler (#71), then build the manifest schema and loader (#18).

## Gotchas / don't try again

- Probe code in a gitignored `tmp/` folder is still linted by `npm run lint` (ESLint does not read `.gitignore`); experiment in the session scratchpad instead.

## Open questions

- None yet.
