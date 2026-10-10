# Feature: v0.1-m4-safety

Status: in progress | Branch: feat/v0.1-m4-safety

## Goal

v0.1 milestone M4 (issues #30, #31, #32, #33): the safety layer the kit installs into users' projects. The hook runtime in `src/hooks/runtime` (ADR-0015's contract), guard-bash and guard-secrets ported faithfully from this repo's hardened `.claude/hooks/` to strict TypeScript and bundled by tsdown, and the safety module that registers both guards in exec form and writes the six native deny rules. Done means every acceptance criterion in the four issues holds (an ADR or a recorded decision wins where an issue differs, and each such case is explained here), a second init plans zero changes, and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-10: Start from the issue texts and every comment on them (the R3 alignment comments, the #31 coverage limits and `npm stage` comment, the #33 `optOut` comment), ADR-0011/0012/0014/0015/0017/0018, reference §1 and §11, and this repo's `.claude/hooks/*.mjs`, `docs/mistakes.md` and `docs/features/runway-r3/MEMORY.md`; where an issue and an ADR differ, the ADR wins and this file says so. Why: the milestone brief and AGENTS.md.
- 2026-10-10: This repo's own `.claude/` setup stays as it is until M8 (#45). Why: the brief and ADR-0015's consequences ("the hooks in this repo's `.claude/hooks/` stay the reference implementation until v0.1 M8").

## Done

- [ ] #30 hook runtime
- [ ] #31 guard-bash
- [ ] #32 guard-secrets
- [ ] #33 safety module
- [ ] Demo tape and README Safety section (live tape, GIF recorded by the maintainer)
- [ ] Docs: architecture map, decisions, mistakes, ROADMAP, changeset

## Next step

Port the hook runtime (#30) into `src/hooks/runtime/`.

## Gotchas / don't try again

- A worktree-isolated agent's shell refuses compound commands it cannot verify (heredocs, `&&` chains with `cd` into other folders); write scratch files with the Write tool and run plain commands.

## Open questions

- None yet.
