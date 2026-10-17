# Feature: v0.1-m5-memory

Status: in progress | Branch: feat/v0.1-m5-memory

## Goal

v0.1 milestone M5 (issues #34 and #35): every feature in a user's project gets a durable MEMORY.md, and past decisions are searchable. Part A (#34) is the feature-memory module (all presets) and the knowledge module (medium and full): their create-only docs, owned skills and AGENTS.md blocks. Part B (#35) is the session-start, pre-compact and stop memory hooks, `memory.tape` and the README Feature memory section. Done means every acceptance criterion of both issues holds (an ADR or a recorded decision wins where an issue differs, and this file says so), a second init plans zero changes, every preset stays within its always-on context budget, and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-17: Start from the issue texts and their comments, ADR-0014/0015/0016/0017, handoff §5–§5.3, reference §2.5, §3.1 and §11, `docs/features/v0.1-m4-safety/MEMORY.md`, and this repo's own `new-feature`, `handoff`, `why` and `adr` skills and docs, generalised for users' projects with `{{brand.*}}` placeholders. Where an issue and an ADR differ, the ADR wins and this file says so. Why: the milestone brief and AGENTS.md; the maintainer approved the M5 plan on 2026-10-17.
- 2026-10-17: Part A builds no hook. The feature-memory module leaves `hooks` empty for part B, which this file's Next step briefs. Why: the brief splits #34 and #35 between two agents.
- 2026-10-17: Both modules stay `internal: true`, as safety does, until the maintainer records the live GIFs (`why.gif` now, `memory.gif` with part B); no `demo` yet. The README Decisions section waits for the README rewrite in PR #88. Why: the brief; `npm run demos` fails a demo without its GIF and README section, and README.md must not change while #88 is open.
- 2026-10-17: This repo's own `.claude/` setup stays as it is until M8 (#45). Why: the brief.

## Done

- [x] Feature memory (this file).
- [ ] feature-memory module: memory template, mistakes log, `new-feature` and `handoff` skills, AGENTS.md block.
- [ ] knowledge module: decision log, ADR template, glossary, `why` and `adr` skills, AGENTS.md block.
- [ ] Tests: module tests, snapshots, golden trees, static rules, init's `/new-feature` next step.
- [ ] `why.tape` (`# live`) and its fixture ADR.
- [ ] Docs: architecture map, decisions, ROADMAP, changeset, this file.

## Next step

Write the feature-memory module (`modules/feature-memory/`): manifest, templates, skills and AGENTS.md block, with its test, module snapshot and golden trees, and update `docs/architecture.md` in the same commit.

## Gotchas / don't try again

- In a sandbox that cannot write `~/.npm`, run npm with `npm_config_cache` set to a writable temp folder, or every `test/check-package.test.ts` case fails with EPERM.
- Never run `rm`, `git clean` or `git restore`; leave cleanup to the tools that own a folder (the maintainer, 2026-10-10).

## Open questions

- None yet.
