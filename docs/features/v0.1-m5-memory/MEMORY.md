# Feature: v0.1-m5-memory

Status: in progress | Branch: feat/v0.1-m5-memory

## Goal

v0.1 milestone M5 (issues #34 and #35): every feature in a user's project gets a durable MEMORY.md, and past decisions are searchable. Part A (#34) is the feature-memory module (all presets) and the knowledge module (medium and full): their create-only docs, owned skills and AGENTS.md blocks. Part B (#35) is the session-start, pre-compact and stop memory hooks, `memory.tape` and the README Feature memory section. Done means every acceptance criterion of both issues holds (an ADR or a recorded decision wins where an issue differs, and this file says so), a second init plans zero changes, every preset stays within its always-on context budget, and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-17: Start from the issue texts and their comments, ADR-0014/0015/0016/0017, handoff §5–§5.3, reference §2.5, §3.1 and §11, `docs/features/v0.1-m4-safety/MEMORY.md`, and this repo's own `new-feature`, `handoff`, `why` and `adr` skills and docs, generalised for users' projects with `{{brand.*}}` placeholders. Where an issue and an ADR differ, the ADR wins and this file says so. Why: the milestone brief and AGENTS.md; the maintainer approved the M5 plan on 2026-10-17.
- 2026-10-17: Part A builds no hook. The feature-memory module leaves `hooks` empty for part B, which this file's Next step briefs. Why: the brief splits #34 and #35 between two agents.
- 2026-10-17: Both modules stay `internal: true`, as safety does, until the maintainer records the live GIFs (`why.gif` now, `memory.gif` with part B); no `demo` yet. The README Decisions section waits for the README rewrite in PR #88. Why: the brief; `npm run demos` fails a demo without its GIF and README section, and README.md must not change while #88 is open.
- 2026-10-17: This repo's own `.claude/` setup stays as it is until M8 (#45). Why: the brief.
- 2026-10-17: The active-feature pointer, `<state dir>/local/active-feature`, holds one line: the feature's folder name in kebab-case, never a path. It counts only when that folder's MEMORY.md exists and says `Status: in progress`; otherwise the active feature is the only MEMORY.md that says so, leaving out folders whose names start with `_` (the template says it too). With none or several, ask. `/handoff` resolves it this way, and part B's hooks must too. Why: a name checked against a kebab-case pattern can never reach outside `docs/features/`, and a pointer left on a finished feature must not beat the one in progress.
- 2026-10-17: `/new-feature` writes the pointer, and first writes `<state dir>/local/.gitignore` with `*` when it is missing (a fresh clone). Why: ADR-0014 asks whatever creates `local/` to write its `.gitignore` in the same step, and in a fresh clone the skill is the first writer there.
- 2026-10-17: `/new-feature` neither creates a branch nor commits on its own, unlike this repo's skill: it records the current branch and offers a new one only on the default branch. Why: users' git workflows differ, and AGENTS.md's surgical-changes rule.
- 2026-10-17: Generated skills use only ADR-0015's allowlisted frontmatter keys: `name`, `description` and, on `/new-feature` and `/adr`, `disable-model-invocation: true`. No `argument-hint`, which this repo's own skills use but the allowlist leaves out (the static rules refuse it), and no `allowed-tools`, which Read, Grep and Glob do not need. The body says what `$ARGUMENTS` holds. Why: ADR-0015 (see Open questions).
- 2026-10-17: Each module writes its own AGENTS.md block (`feature-memory`, `knowledge`) naming only its own docs and skills, so each preset's AGENTS.md names only docs it writes; `test/instruction-docs.test.ts` checks AGENTS.md and every written skill per preset. Why: #34; templates are logic-less, so a block cannot depend on which other modules are on.
- 2026-10-17: The memory template is handoff §5.2 with `Status: in progress | Branch: <branch>` (this repo's `feat/<name>` generalised), 80 lines or fewer (a test holds it), and no HTML comments, so a copied memory carries none and part B reads its sections as written. `/handoff` keeps each memory at 80 lines or fewer.
- 2026-10-17: Behaviour change: with `.claude` linked outside the project, `--modules -safety` alone no longer gets init past the refusal, because the skills live under `.claude/skills/` too; leaving out feature-memory and, in medium and full, knowledge as well does. Why: path safety refuses every write through such a link (ADR-0014), and the owner's 2026-10-17 sign-off keeps that refusal with no sidecar fallback (see Open questions).
- 2026-10-17: init's next steps now name `/new-feature` in every preset, since the feature-memory module writes the skill (the M3 sign-off item on #27); `test/init.test.ts` holds it, and its absence with `--modules -feature-memory`.
- 2026-10-17: `/why` is model-invocable, like this repo's own, since it only reads; `/new-feature` and `/adr` write files and stay user-only (#34). `/why` searches the decision log and ADRs, the MEMORY.md Decisions sections and the mistakes log, skipping what a project lacks, then `git log --grep` only when those do not answer (a Bash call prompts, reading docs does not), and cites `path:line` or a short hash. `/adr` numbers ADRs with four digits from the template, sets `accepted` only when the user agreed, marks the ADR it supersedes and adds a row to the decision log; like `/new-feature`, it does not commit. Why: #34 and reference §3.1; users' git workflows differ.
- 2026-10-17: The knowledge module requires only base, not feature-memory. Why: `/why` skips the records a project lacks, and a requirement would make `--modules -feature-memory` on medium an error unless knowledge goes too, since resolution refuses a removed requirement.
- 2026-10-17: The existing-claude-setup fixture's own `why` skill now meets the knowledge module's in medium and full: init keeps the user's skill, writes the kit's beside it as a sidecar and exits 2 (ADR-0014's first contact), and a second run still plans only skips. The golden, init-existing and context-budget tests expect it. Why: M3 gave the fixture a `why` skill, and this is what a user with their own `/why` sees.

## Done

- [x] Feature memory (this file).
- [x] feature-memory module: memory template, mistakes log, `new-feature` and `handoff` skills, AGENTS.md block, module and docs tests, golden trees, architecture map (6abe62e).
- [x] knowledge module: decision log, ADR template, glossary, `why` and `adr` skills, AGENTS.md block, module test, golden trees with the existing setup's `why` sidecar, architecture map (the knowledge commit).
- [ ] `why.tape` (`# live`) and its fixture ADR.
- [ ] Docs: decisions, ROADMAP, changeset, this file.

## Next step

Write `docs/media/tapes/why.tape` (`# live`): init on ts-app, then `/why` in Claude Code citing an ADR by path:line, with the ADR it cites added to `examples/ts-app/docs/adr/`.

## Gotchas / don't try again

- In a sandbox that cannot write `~/.npm`, run npm with `npm_config_cache` set to a writable temp folder, or every `test/check-package.test.ts` case fails with EPERM.
- Never run `rm`, `git clean` or `git restore`; leave cleanup to the tools that own a folder (the maintainer, 2026-10-10).
- vitest 5's `-u` takes an optional value, so `vitest run -u test/golden.test.ts` swallows the file name and updates snapshots across the whole suite. Put the file filters first and `--update` last.

## Open questions

- ADR-0015's skill frontmatter allowlist leaves out `argument-hint`, which shows `<name>` beside a skill in the slash menu. Add it to the allowlist (it only displays text)? Until then the kit's skills go without it.
- A project whose `.claude` links outside it now needs every module that writes under `.claude` left out (safety, feature-memory and, in medium and full, knowledge). Confirm, or have init's refusal name those modules in its hint (today it says to replace or remove the link).
