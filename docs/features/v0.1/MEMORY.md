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

## Done

- [x] Repo created (github.com/arbindpd96/archkeeper), MIT, community files, Dependabot, secret scanning
- [x] ADR-0001…0008 and decision log
- [x] Claude Code setup for this repo: hooks, settings, rules, skills, agents, AGENTS.md/CLAUDE.md, architecture map
- [x] Toolchain + CI/CD gates (lint, format, types, comment policy, tests, commitlint, CodeQL, dependency review) and hook hardening (PR #1)
- [ ] Branch ruleset on `main` after PR #1 merges
- [ ] Research reference committed (docs/research/claude-code-reference.md)
- [ ] ROADMAP.md with phases; GitHub milestones and v0.1 issues
- [ ] Owner approves v0.1 task list, then scaffold `packages/core`

## Next step

Merge PR #1, enable the `main` ruleset, then merge the rename (#2) and roadmap (#64) PRs.

## Gotchas / don't try again

- SSH push fails on the owner's machine. Use the HTTPS remote with the repo-local `gh auth git-credential` helper.
- zsh `echo` turns `\n` into real newlines, which breaks JSON when testing hooks by hand. Use `printf '%s'`.

## Open questions

- None right now. Next decisions arrive with the roadmap's open questions.
