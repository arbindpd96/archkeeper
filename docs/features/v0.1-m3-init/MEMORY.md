# Feature: v0.1-m3-init

Status: in progress | Branch: feat/v0.1-m3-init

## Goal

v0.1 milestone M3 (issues #25, #26, #27, #28, #29): `npx <bin> init` works end to end on M1's render and M2's install. It detects the stack purely, shows the plan, asks, writes CLAUDE.md and AGENTS.md without touching user content, writes `.archkeeper/config.json`, and runs non-interactively in CI. Done means every acceptance criterion in the five issues holds (an ADR or a recorded decision wins where an issue differs, and each such case is explained here), a second init plans zero changes, and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-10: Start from the issue texts, the #26 comment, ADR-0012/0014/0015/0016/0017, the M2 Next step and reference §2, §7.1, §7.2 and §11; where an issue and an ADR or a recorded decision differ, the ADR or decision wins and this file says so. Why: the milestone brief and AGENTS.md ("never contradict a recorded decision without asking").

## Done

- [ ] Feature memory

## Next step

Add the libraries the issues name as devDependencies (commander 15, @clack/prompts 1.x, smol-toml, package-manager-detector), run `npm ci`, and start #25's pure detection in `src/core`.

## Gotchas / don't try again

- The worktree's shell guard refuses heredocs; write scratch files with the Write tool in the session scratchpad.

## Open questions

- None yet.
