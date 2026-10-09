# Feature: v0.1 Foundation

Status: in progress | Branch: main (bootstrap), then feat/* per milestone

## Goal

`npx archkeeper init` scaffolds a working small/medium/full setup into a TS/JS or Python project. `update` never overwrites user edits, and `uninstall` is clean.
This repo itself runs on that setup (dogfooding).

## Decisions (never undo without asking)

- 2026-10-09: Working name `claude-codekit`. Why: `create-claude-kit` is taken and `claude-kit` collides with a competitor (ADR-0001, superseded).
- 2026-10-09: TypeScript/Node, MIT, public repo, v0.1 stacks TS/JS + Python (ADR-0004/0005/0006).
- 2026-10-09: MCP servers configure-only and opt-in; offer optional Superpowers/Spec Kit (ADR-0007/0008).
- 2026-10-09: Generated hooks are dependency-free Node `.mjs` in exec form. Why: cross-platform, and paths with spaces need no quoting.
- 2026-10-09: Renamed to `archkeeper` (ADR-0010). Why: Anthropic's naming rules and the plugin validator's `claude-` prefix ban.
- 2026-10-09: Commits are authored by the maintainer only, with `attribution` disabled in settings and a guard hook.
- 2026-10-09: Toolchain is ESLint + Prettier + TS 6 + Vitest, with a comment-policy checker (ADR-0009). Why: only ESLint can enforce the JSDoc and comment rules.
- 2026-10-09: Contributor Node floor is `^22.22.2 || ^24.15.0 || >=26`. Why: the dev toolchain's own engine minimums.
- 2026-10-09: Guards judge parsed commands and ask when they cannot load or parse. Why: the regex guard was bypassable and could time out, which fails open.
- 2026-10-09: guard-bash denies when a literal curl or wget (any case) reaches code through a pipe, a captured `$(curl …)` or a file the same command downloaded, and asks when the producer is a program named by a variable or a function (#65). Why: a literal download is `curl | sh` in another form, but a variable or function may be anything, so the user decides.
- 2026-10-09: Inline code fed by a download asks unless it is an allowlisted read-and-print idiom; code that can run its input is denied (#65). Why: the code is visible, but what it does with the download is not.
- 2026-10-09: `find . -name '*' -delete` and `find ~ -exec rm -rf {} +` stay denied, though the #65 review expected ask. Why: each deletes as much as a bare `find <root> -delete`.
- 2026-10-09: A script named by a variable (`bash "$f"`, `python3 "$SCRIPT"`) is allowed when no download is in the command; inline code from a variable (`python3 -c "$c"`) asks (#65). Why: a variable script is a file like any named script, which the guard already lets run, while variable code is as open as `eval`. With a download in the command, both are denied.
- 2026-10-09: Reserved the npm name with a notice-only `archkeeper@0.0.1` (staged publish, owner-approved with 2FA). Why: the README shows `npx archkeeper`, so an unclaimed name was a squatting risk (PR #69 security review).

## Done

- [x] Repo created (github.com/arbindpd96/archkeeper), MIT, community files, Dependabot, secret scanning
- [x] ADR-0001…0008 and decision log
- [x] Claude Code setup for this repo: hooks, settings, rules, skills, agents, AGENTS.md/CLAUDE.md, architecture map
- [x] Toolchain + CI/CD gates (lint, format, types, comment policy, tests, commitlint, CodeQL, dependency review) and hook hardening (PR #1)
- [ ] Branch ruleset on `main` after PR #1 merges
- [x] Research reference committed (docs/research/claude-code-reference.md)
- [x] Renamed to archkeeper (ADR-0010, PR #2)
- [x] ROADMAP.md with phases; GitHub milestones (v0.0–v1.0) and issues #3–#65, including owner-action issues
- [x] Guard hardening from the focused review (#65, PR #70): interpreter option specs, find filter order, piped scripts, downloaded files
- [x] v0.0 Runway R1: #3 ADR-0011 single package, #4 restructure to `src/`, #5 brand constants, #6 tsdown bundle, #7 budgets (PR #69, see `docs/features/runway-r1/`)

## Next step

Merge PR #70 (#65) once CI passes. Then start v0.0 R2 with `/new-feature runway-r2`: example fixtures, the demo-gifs workflow, ADR-0013 and the staged-release workflow (#11). The `main` ruleset is still to enable.

## Gotchas / don't try again

- SSH push fails on the owner's machine. Use the HTTPS remote with the repo-local `gh auth git-credential` helper.
- zsh `echo` turns `\n` into real newlines, which breaks JSON when testing hooks by hand. Use `printf '%s'`.

## Open questions

- None right now. Next decisions arrive with the roadmap's open questions.
