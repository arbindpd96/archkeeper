# Feature: v0.1 Foundation

Status: in progress | Branch: main (bootstrap), then feat/* per milestone

## Goal

`npx claude-codekit init` scaffolds a working small/medium/full setup into a TS/JS or Python project. `update` never overwrites user edits, and `uninstall` is clean.
This repo itself runs on that setup (dogfooding).

## Decisions (never undo without asking)

- 2026-10-09: Name `claude-codekit` on npm and GitHub. Why: `create-claude-kit` is taken and `claude-kit` collides with a competitor (ADR-0001).
- 2026-10-09: TypeScript/Node, MIT, public repo, v0.1 stacks TS/JS + Python (ADR-0004/0005/0006).
- 2026-10-09: MCP servers configure-only and opt-in; offer optional Superpowers/Spec Kit (ADR-0007/0008).
- 2026-10-09: Generated hooks are dependency-free Node `.mjs` in exec form. Why: cross-platform, and paths with spaces need no quoting.
- 2026-10-09: The plugin name must not start with `claude-` because Claude Code rejects it. The plugin name is still to be chosen.
- 2026-10-09: Commits are authored by the maintainer only, with `attribution` disabled in settings and a guard hook.

## Done

- [x] Repo created (github.com/arbindpd96/claude-codekit), MIT, community files, Dependabot, secret scanning
- [x] ADR-0001…0008 and decision log
- [x] Claude Code setup for this repo: hooks, settings, rules, skills, agents, AGENTS.md/CLAUDE.md, architecture map
- [ ] Toolchain + CI/CD gates (lint, format, types, comment policy, tests, commitlint, CodeQL) + branch ruleset
- [ ] Research reference committed (docs/research/claude-code-reference.md)
- [ ] ROADMAP.md with phases; GitHub milestones and v0.1 issues
- [ ] Owner approves v0.1 task list, then scaffold `packages/core`

## Next step

Finish the toolchain and CI milestone (root package.json, ESLint/Prettier/Vitest, comment checker, workflows), then publish the ROADMAP and milestones.

## Gotchas / don't try again

- SSH push fails on the owner's machine. Use the HTTPS remote with the repo-local `gh auth git-credential` helper.
- zsh `echo` turns `\n` into real newlines, which breaks JSON when testing hooks by hand. Use `printf '%s'`.

## Open questions

- Plugin and marketplace name (cannot start with `claude-`): `codekit`?
- Is it acceptable under Anthropic brand guidance to use "claude" in the npm name? (Research pending.)
