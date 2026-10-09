# AGENTS.md: archkeeper

Instructions for AI coding agents (Claude Code, Codex, Cursor, Gemini CLI, Copilot) working in this repository.

## Project

archkeeper is an npx CLI plus a Claude Code plugin. It scaffolds a modular, merge-safe Claude Code setup into any project.
Status: pre-release, v0.1 in progress. Plan: `docs/ROADMAP.md`. Decisions: `docs/decisions.md`.

## Principles

1. **Think before coding.** State assumptions. If a request is ambiguous, offer options or ask.
2. **Simplicity first.** Write the least code that solves the problem. No speculative features or abstractions.
3. **Surgical changes.** Touch only what the task needs. Never refactor unrelated working code.
4. **Goal-driven.** Define "done" (usually `npm run check` passes) and verify it yourself before reporting.

## Before creating anything new

1. Read `docs/architecture.md`.
2. Search the codebase for similar code.
3. Reuse or extend it. Never duplicate.

After adding a package, module or shared util, update `docs/architecture.md` in the same commit.

## Feature memory

- Work happens under a feature in `docs/features/<feature>/MEMORY.md`. Read it fully before changing code.
- After an important decision, append it to **Decisions** with the date and the reason.
- Before ending a session, or when context is large, update **Done** and **Next step**.
- Never contradict a recorded decision or ADR without asking the maintainer.
- Record failed approaches in `docs/mistakes.md` so nobody retries them.

## Code style (enforced in CI)

- Use strict TypeScript and ESM. Keep functions small with descriptive names; code should read clearly without comments.
- Comments:
  - Give each exported function, class or type a one-line JSDoc summary. Otherwise comment only a non-obvious _why_.
  - No comments that restate the code (reviewers reject them; CI rejects JSDoc that only restates a name), no commented-out code, no trailing inline comments.
  - No TODO without an issue reference (`TODO(#12): ...`).
- Limits: function ≤ 50 lines, cyclomatic complexity ≤ 10, ≤ 4 parameters, nesting depth ≤ 3, file ≤ 300 lines.
- Never swallow errors silently. Throw typed errors with actionable messages.
- No runtime dependencies (ADR-0011): every library is a devDependency that tsdown inlines. `budgets.json` caps sizes (ADR-0017).

The full guide is in `CONTRIBUTING.md`.

## Commands

| Command               | Purpose                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `npm install`         | Install the toolchain and the git hooks                                                |
| `npm run check`       | Everything CI runs: format, lint, types, comments, brand, demos, tests, build, package |
| `npm run check:quick` | Types and tests (fast loop)                                                            |
| `npm test`            | Tests only                                                                             |

## Git

- Use Conventional Commits (`feat(core): ...`, `fix(cli): ...`, `docs: ...`). Each commit is one atomic, logical change.
- Branch from `main` (`feat/<short-name>`) and open a PR. `main` is protected and requires green CI.
- The maintainer authors every commit. Never add AI co-author trailers or "generated with" lines.
- Never force-push `main`. Never skip hooks with `--no-verify`.

## Docs that must stay current

- `docs/architecture.md`: what exists and where.
- `docs/decisions.md` and `docs/adr/`: why things are the way they are.
- `README.md`: each shipped user-facing feature gets a short section and a GIF rendered from `docs/media/tapes/<feature>.tape`.
