# Feature: v0.1-m3-init

Status: done, ready for review | Branch: feat/v0.1-m3-init

## Goal

v0.1 milestone M3 (issues #25, #26, #27, #28, #29): `npx <bin> init` works end to end on M1's render and M2's install. It detects the stack purely, shows the plan, asks, writes CLAUDE.md and AGENTS.md without touching user content, writes `.archkeeper/config.json`, and runs non-interactively in CI. Done means every acceptance criterion in the five issues holds (an ADR or a recorded decision wins where an issue differs, and each such case is explained here), a second init plans zero changes, and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-10: Start from the issue texts, the #26 comment, ADR-0012/0014/0015/0016/0017, the M2 Next step and reference §2, §7.1, §7.2 and §11; where an issue and an ADR or a recorded decision differ, the ADR or decision wins and this file says so. Why: the milestone brief and AGENTS.md ("never contradict a recorded decision without asking").
- 2026-10-10: The libraries the issues name are devDependencies inlined by tsdown: commander 15.0.0 (#26), @clack/prompts 1.8.1 (#27), smol-toml 1.9.1 and package-manager-detector 1.9.0 (#25); `npm ci` ran after adding them. Why: ADR-0011; @clack/prompts and package-manager-detector were already in the tree through @changesets/cli and publint, so only commander and smol-toml were new downloads. Clack is justified by #27's flow (select with hints, confirm, a cancel symbol for Ctrl+C) at 32 kB unminified with its four small dependencies; the tarball stays at 142.8 kB of its 300 kB budget (see Measured sizes).
- 2026-10-10: Detection (`src/core/detect*.ts`, `stack-profile.ts`) is pure over an injected `ProjectView` (`list(folder)`, `read(file)`). It uses package-manager-detector only through its pure `constants` (LOCKS, AGENTS) and `commands` (`resolveCommand`) entry points and reimplements its `detect()` order (the manager package.json names, else the first lockfile, else npm), since `detect()` reads the file system. Lint now refuses `child_process`, `worker_threads`, `net`, `http`, `https`, `http2` and `dgram` in `src/core`. Why: #25 ("no network and no child processes") and the purity lint (M1).
- 2026-10-10: Detection reads project files tolerantly, field by field, with small narrowing helpers rather than a zod schema per file. Why: #25 asks for a partial profile, never a crash, and every value read only selects from fixed vocabularies, so a wrong-typed field should drop only itself.
- 2026-10-10: Detected commands are built from fixed script names (`build`, `test`, `lint`, `format`/`fmt`, `typecheck`/`type-check`/`types`) through `resolveCommand(manager, 'run', [script])`, and from tool names for Python (`<uv|poetry> run pytest`, `ruff check .`, `ruff format .`, `black .`, `mypy .`, `pyright`), never from a script's text. Why: brief constraint 1; no project text can reach a template, and the test proves a crafted script is ignored. Lockfiles (`uv.lock`, `poetry.lock`) count as signals only; `pylock*.toml` is parsed for package names (#25 lists it as parsed).
- 2026-10-10: A list of strings is the one multi-line template value (M1 left it to M3): each line passes `unsafeValue`, and the list renders joined with newlines. AGENTS.md's Commands section is one such value, `project.reference`, built by `projectValues` (`src/core/project-values.ts`): the commands of the stacks in effect as a table in code spans (a command with a backtick or a bar is left out), then `## Project docs` for root README.md, CONTRIBUTING.md or ARCHITECTURE.md that exist, or a line saying no command was detected. Why: M1's review-2 decision asked for an explicit multi-line form and for code spans.
- 2026-10-10: CLI layout: `commands.ts` is the import-free registry (check-demos imports it through Node's type stripping); `main.ts` builds the commander program and keeps each command's setup in a `Map`, throwing for a registry entry without one (every `main` run registers all commands, so the first test catches it); `context.ts` holds everything injectable (output, package info, kit, brand, cwd, interactive, prompter, git) so tests run the CLI in-process. Global flags: `--version`, `--help`, `-C/--cwd`, `-y/--yes`, `--json`, `--debug` (#26 plus `--yes` from the brief). Commander's errors are escaped, coloured and followed by `Try: <bin> --help`. Why: #26 and the #26 comment.
- 2026-10-10: Errors: an ArchkeeperError prints `Error: <where>: <problem>` and `Try: <hint>`, each line escaped with `escapeUnprintable`; anything else prints `unexpected error: <message>` with a pointer to `--debug`; the stack trace only with `--debug`. A new `UsageError` covers flags, missing answers and target folders. Why: #26 and the M2 Next step (escape every printed path, entry and reason).
- 2026-10-10: Exit codes: 0 done, 1 error or cancelled (a declined question too), 2 done with sidecars or conflicts to review. They are in `--help` (`EXIT_CODES`, shown for every command through `afterAll`), the README Quick start and the architecture map. A dry run exits 0. Why: #26.
- 2026-10-10: `init` is interactive only when stdin and stdout are terminals and `CI` is unset (or `false`/`0`); `--yes`, `--json` or no terminal make it scripted. Scripted, the preset defaults to the config's or medium, the stack to the config's or the detected one, and the missing answer, the yes to write, is an error naming `--yes` and `--dry-run`. A run with nothing to write needs no yes. Why: #27 and reference §7.1 (a clack prompt on a non-TTY stdin never resolves).
- 2026-10-10: Flow order: header and detected stack, the git warning and its question, the config notice, the preset (with "up to Nk tokens always loaded" from `budgets.json`), the plan grouped as create, modify, conflict and skip (`summarizePlan`, plus a line for the config, lock and blobs), then the dry-run diff or the yes, the apply, the config write, and next steps. Why: #27's numbered order, with the git question first so a user can stop before answering anything else.
- 2026-10-10: The git check runs `git --no-optional-locks -c core.fsmonitor=false status --porcelain` through `execFile` with `LC_ALL=C`; not a repository, uncommitted changes or no answer each warn and ask "Continue anyway?" defaulting to no; `--yes` goes on with the warning; scripted without `--yes` it is an error with the fix. `--dry-run` skips it. Why: #27; fsmonitor off so a repository's config cannot make status run a program, no optional locks so it writes nothing, and English output to tell "not a git repository" apart in every locale. This is local, not network, so ADR-0018 holds.
- 2026-10-10: init shows the plan from `planProject` and, after the yes, applies that same plan: `install(root, tree, options, plan)` now takes an optional plan and still refuses it when stale. Why: the brief ("calls install(), which refuses a stale plan") and M2's stale-plan decision; a test edits CLAUDE.md while init waits and the apply refuses.
- 2026-10-10: `.archkeeper/config.json`: a new config is `{ $schema, version: 1, preset }`, plus `modules {add, remove}` once either is non-empty and `stack` only when `--stack` was given. `$schema` is `https://cdn.jsdelivr.net/npm/<npmName>@<version>/schema/config.schema.json` (`configSchemaUrl`), the schema of the kit version that wrote it, which ships in `schema/`. An existing config is left byte for byte when the answers match it; otherwise its keys, unknown ones and `$schema` included, are kept with the answers changed. It is written after the apply, atomically, and refused when the file changed while init ran. Why: ADR-0014, M1's proposal (versioned CDN URL); a pinned URL always matches the kit that wrote it, and `update` (M7) decides whether to move it.
- 2026-10-10: A re-run reads the config "as update would": no preset question, the config's preset, modules and stack, and nothing to write when nothing changed. Why: #27 ("re-running init behaves like update").
- 2026-10-10: `--modules +id,-id` edits the config's own lists (`+id` or a bare id adds, `-id` removes, each moving out of the other list); `--stack ts|python|ts,python|none` is stored in the config. All of init's flags are checked before anything is read or asked. Why: #27.
- 2026-10-10: Base module: CLAUDE.md gets two blocks, `agents-import` (`@AGENTS.md` only, so M2's rule puts it first) and `claude-code` (three pointer lines); AGENTS.md one block, `agent-rules` (a one-line intro, the four principles, "Before creating anything new" without pointing at docs that may not exist, and `{{project.reference}}`); `.gitignore` one block, `base`. Why: #28. The import gets its own block so `withoutImportedBlocks` (`src/core/import-blocks.ts`) can leave it out when the user's CLAUDE.md already imports AGENTS.md outside the kit's blocks, code fences, code spans and HTML comments, which is how "an existing @AGENTS.md import is detected and not duplicated" is met.
- 2026-10-10: The `.gitignore` block also ignores the kit's atomic-write temp files, `.*.<12 hex>.tmp` written as twelve `[0-9a-f]` classes, proven with `git check-ignore`. Why: the brief asked for it if it fits ADR-0014; a run killed mid-write would otherwise leave a copy, possibly of a file with a token, that a `git add -A` commits, and the pattern matches no ordinary name.
- 2026-10-10: Not met in M3, with the reason (see Open questions): #28's create-only `CLAUDE.local.md`, because M1's review-3 decision makes `CLAUDE.local.md` a reserved template target ("a module mistake must not reach ... personal memory"); the `.gitignore` block does cover it. And #28's "settings.json gets the SchemaStore `$schema`": M2's decision adds `$schema` only where the kit owns another entry, and base owns none, so no settings.json is written until M4's safety module adds deny rules; the json strategy's "only when absent" is tested since M2, and the preset × stack static settings test is in place for M4.
- 2026-10-10: `init` and the base module stay `internal: true` until `docs/media/init.gif` is committed. Why: the brief; the GIF can only come from CI's demo-gifs run, and check-demos fails a demo without its GIF. See Next step for the exact flip.
- 2026-10-10: The `existing-claude-setup` fixture is built in `test/init-helpers.ts` from examples/ts-app plus a user's CRLF CLAUDE.md with its own `@AGENTS.md`, AGENTS.md, a commented settings.json with `model`, and a `why` skill. Why: kept in examples/, its CLAUDE.md and skill would load in this repository's own Claude Code sessions (nested CLAUDE.md and `.claude/skills` are discovered, reference §2.1 and §3.1).
- 2026-10-10: Golden trees hash each file's exact bytes, except base blobs, which are checked with `readBlob` and listed by name (their content hash). Why: gzip bytes may differ between the zlib versions of Node 22, 24 and 26; the content cannot.
- 2026-10-10: The static rules of generated output live in `test/static-rules.ts` (ADR-0015: "the static test holds the exact lists"): settings keys, exec-form hooks under the hook folder, `if` only on tool events, `$schema`; CLAUDE.md under 100 lines with one `@AGENTS.md` import; the skill and agent frontmatter allowlists with the allowed-tools rules and no load-time command. They run over every preset × fixture output (settings only where the kit wrote the file) and have their own unit tests, since M3 generates no settings, skill or agent yet.
- 2026-10-10: Always-on context is `ceil(chars / 4)` over CLAUDE.md and `.claude/CLAUDE.md` with their imports (four hops, project files only, outside code fences and spans), whole-line HTML comments costing nothing, rules without `paths:`, model-invocable skill descriptions, and the preset's SessionStart cap from `modules/presets.json` (counted even before a SessionStart hook exists). `scripts/context-budget.mjs` measures the built CLI's output per preset on ts-app, py-app and mixed and runs in `npm run check` and the CI package job; `test/context-budget.test.ts` checks the same in-process on the four fixtures. The measurement lives in `scripts/context-rules.mjs` with a `.d.mts` so tests can import it. Why: #29 and ADR-0017.
- 2026-10-10: No new ADR. Why: every choice refines ADR-0006, 0011, 0014, 0015, 0017 or 0018 without changing them; `docs/decisions.md` lists the larger ones.

## Measured sizes (ADR-0017)

| Item                       | Before M3               | After M3                  | Budget |
| -------------------------- | ----------------------- | ------------------------- | ------ |
| `dist/cli.mjs`             | 134.5 kB (33.3 kB gzip) | 521.6 kB (131.6 kB gzip)  | none   |
| of which `src/`            | about 51 kB             | 237.9 kB                  |        |
| of which commander         | 0                       | 102.5 kB                  |        |
| of which zod (`zod/mini`)  | 59.0 kB                 | 60.3 kB                   |        |
| of which jsonc-parser      | 24.2 kB                 | 42.4 kB (`modify` now in) |        |
| of which smol-toml         | 0                       | 36.1 kB                   |        |
| of which clack (with deps) | 0                       | 32.3 kB                   |        |
| of which pm-detector       | 0                       | 10.2 kB                   |        |
| Tarball                    | 42.5 kB                 | 142.8 kB                  | 300 kB |
| Unpacked                   | 179.5 kB                | 580.7 kB                  |        |
| Files in the package       | 16                      | 19 (base templates)       |        |
| Runtime dependencies       | 0                       | 0                         | 0      |

Region sizes are the unminified `//#region` sums. Most of the growth is M2's engine reaching the bundle for the first time (M2 predicted about 26 kB of gzip) and commander, whose unminified source is mostly JSDoc. The bundle still parses as ES2022, and with `process.versions.node` faked to 18.20.8 the built bin prints the upgrade message and exits 1 before any library code runs.

Always-on context measured by `npm run context` (largest of ts-app, py-app and mixed; mixed here): small 610 of 1,500 tokens, medium 1,060 of 3,000, full 1,310 of 4,500. CLAUDE.md with AGENTS.md is 1,239 characters; the rest is each preset's SessionStart cap.

## Done

- [x] Feature memory (7123bc0); dependencies (f674324); core purity lint for processes and network (d3e87bd); multi-line template values (89bc79f)
- [x] #25 detection, 17 fixtures with expected.json, each under 100 ms (7c7b41b); a symlinked `.claude` lists as empty (5b00da0)
- [x] Unified diff for `--dry-run`, with a property test that applies each diff (81ef2f4)
- [x] #26 commander, registry, global flags, one-line errors, styleText colour, exit codes, check-demos over the registry with TODO(#26) gone, shared `scripts/ts-resolve.mjs` (8b81573)
- [x] #28 base module and `withoutImportedBlocks` (a6c21f7)
- [x] #27 init: interactive and scripted, git warning, dry-run diff, `--json`, config, stale plan refused, closed-stdin and PTY runs, existing setups, sidecar with exit 2, Windows-shaped paths, CRLF and a case-insensitive root (410767c, b360e90, dc1e568)
- [x] #29 per-module snapshots, 12 golden trees, static rules, second init with only skips, context budget script and test, CI step (7cb20ed)
- [x] Demo: `docs/media/tapes/init.tape` (hero, CI, fixture ts-app) and the README Quick start section embedding `docs/media/init.gif` (c46c84d)
- [x] `docs/architecture.md` (23204c3), `docs/decisions.md`, `docs/mistakes.md`, ROADMAP M3 ticked (12b87da), changeset (2e06811)
- [x] `npm run check` green before every commit; the interactive flow checked through `expect` on a real PTY (git question, preset, yes, exit 0 with no hang)

## Next step

1. The coordinator pushes the branch (the ci.yml step for `npm run context` needs `gh auth refresh -h github.com -s workflow`), opens the M3 PR (closes #25, #26, #27, #28, #29) and lets the demo-gifs workflow render `init.gif`; `npm run gifs:pull -- <run-id>` copies it to `docs/media/init.gif`.
2. Once `docs/media/init.gif` exists, flip both to the demo, in one commit with the GIF (`docs(readme): add the init demo GIF`):
   - `src/cli/commands.ts`: in the `init` entry, replace `internal: true` with `demo: { tape: 'init', section: 'Quick start' }`.
   - `modules/base/module.json`: replace `"internal": true` with `"demo": { "tape": "init", "section": "Quick start" }`.
   - `docs/architecture.md` (Modules intro) and the M1 memory's demo-flip table then read as done for base.
   - Run `npm run check`: the demos step then requires the GIF (≤ 2 MB, ≤ 30 s as the `# hero` tape) and the README "Quick start" section that shows it.
3. Run the `reviewer` and `security-reviewer` agents on the full diff; answer the Open questions with the maintainer in the PR.
4. Then start M4 with `/new-feature v0.1-m4-safety`: the safety module's deny rules make `.claude/settings.json` appear, and the golden trees, static settings rules and context budget already cover it.

## Gotchas / don't try again

- The worktree's shell guard refuses heredocs and any command that names `.github`, `.gitignore` or `env -u` in a compound form; write scratch files with the Write tool, pass such paths to a simple command, or read them with the Read tool.
- Vitest writes new file snapshots only when the test file finishes; a check in the same file for the snapshot folder must tolerate its absence. CI (`CI=true`) fails a missing file snapshot, which is what "a module without a snapshot fails CI" relies on.
- `expect` gives a spawned PTY 0 columns, so clack wraps every character; set `stty columns 140 rows 50 < $spawn_out(slave,name)` after `spawn`.
- A JSON import needs `with { type: 'json' }` (NodeNext); `budgets.json` is bundled into `dist/cli.mjs` that way. Its `$comment` key makes a typed `Record<string, number>` fail, so filter the numbers.
- `escapeUnprintable` also escapes newlines, so `--json` prints the result on one line, where every escape stays inside a JSON string.
- commander keeps option values on the program object; `main` builds a new program on every call.

## Open questions

- For the maintainer (#28): should the base module write a create-only `CLAUDE.local.md`? M1 made it a reserved template target to keep personal memory out of a module's reach; writing it means relaxing that rule for one owned create-only file.
- For the maintainer (#28 and the brief's "$schema only"): base owns no settings entry, so under M2's decision no settings.json is written in M3. Is that acceptable until M4, or should base own something there?
- For the maintainer: `CLAUDE.md` gets two kit blocks (the import, then the pointers) where #28 says "the CLAUDE.md managed block". Acceptable?
- For the maintainer: the git question defaults to no. A default of yes would make the hero demo one key shorter; the backup protects the files either way.
- `dist/cli.mjs` is unminified for readable stack traces, so commander ships its JSDoc (about 100 kB unminified, about 20 kB gzip). Stripping comments in the build would keep the code readable; worth an ADR-0017 note if the tarball nears its budget.
- ADR-0017's "warm init under 2 s" has no entry in `budgets.json` yet; it fits M7's packed-tarball e2e, which runs init for real (the built CLI's `init --yes` on mixed took 144 ms, and 87 ms when nothing changed, on the maintainer's Mac).
- `--modules -base` fails with a ResolveError that names `config.json: modules.remove[0]`, since the flag's ids go into the config before resolution; the message is right about the fix but not about where the id came from.
