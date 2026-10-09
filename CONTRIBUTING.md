# Contributing to archkeeper

Thanks for helping. This guide is short on purpose: most rules are enforced by tooling, so CI will tell you when something is off.

## Setup

```bash
git clone https://github.com/arbindpd96/archkeeper.git
cd archkeeper
npm install        # Node ^22.22.2 or >= 24.15; also installs the git hooks
npm run check      # everything CI runs
```

## Workflow

1. Open or pick an issue. For anything non-trivial, agree on the approach in the issue first.
2. Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
3. Make small, atomic commits with [Conventional Commits](https://www.conventionalcommits.org) messages: `feat(core): add module loader`.
4. Open a PR using the template. The PR title must also be a conventional commit (it becomes the squash-merge message).
5. CI must be green. PRs merge by **rebase** (to keep atomic commits) or **squash** (for noisy histories). `main` has a linear history.

Commits are authored by people. Do not add AI co-author trailers or "generated with" lines. commitlint rejects them.

## What CI checks

| Gate           | Command                      | What it enforces                                                                               |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Formatting     | `npm run format:check`       | Prettier, 110 columns, single quotes                                                           |
| Lint           | `npm run lint`               | typescript-eslint strict, readability limits, JSDoc, layer boundaries (ADR-0011)               |
| Types          | `npm run typecheck`          | TypeScript strict, `noUncheckedIndexedAccess`                                                  |
| Comment policy | `npm run comments`           | See [Comments](#comments)                                                                      |
| Brand          | `npm run brand`              | The product slug appears only in `src/core/brand.ts`; `package.json` `name` and `bin` match it |
| Tests          | `npm test`                   | Vitest: Linux on Node 22/24/26, macOS + Windows on 24                                          |
| Build          | `npm run build`              | tsdown bundle in `dist/`, licenses of inlined code; CI checks that two builds are identical    |
| Commits        | commitlint                   | Conventional Commits, no AI attribution trailers                                               |
| PR title       | action-semantic-pull-request | Conventional Commits title (it becomes the squash message)                                     |
| Security       | CodeQL, dependency review    | Code scanning; no new dependency with a known vulnerability of moderate severity or higher     |

The pre-commit hook runs Prettier, ESLint and the comment check on staged files, and commit-msg runs commitlint. Types and tests run in CI (and in `npm run check`), not in the hook, to keep commits fast.

## Code style

**Readable code over clever code.** A reader should understand a function from its name, its parameters and its body, without comments.

- Small functions with descriptive names. Limits (enforced): function ≤ 50 lines, cyclomatic complexity ≤ 10, ≤ 4 parameters, nesting depth ≤ 3, file ≤ 300 lines.
- Strict TypeScript and ESM. No `any`; use `unknown` and narrow. Exported functions declare their types.
- Validate external input (files, CLI args, network) at the boundary. Trust types inside.
- Never swallow errors. Throw errors whose message tells the user what to do next.
- No new runtime dependency without a one-line justification in the PR.
- Simplicity first: no speculative options, abstractions or "for later" code.

## Comments

We keep comments few and useful. The rules:

1. **Exported functions, classes and types get a one-line JSDoc summary** of what they do or guarantee.
   Add `@param` and `@returns` only when the name and type do not already say it.
2. **Inside code, comment only a non-obvious _why_**: a constraint, a workaround, a surprising decision. Never the _what_.
3. **Not allowed** (CI fails):
   - JSDoc that only restates the symbol's name (`jsdoc/informative-docs`); plain `//` comments that restate code are caught in review
   - trailing inline comments (`no-inline-comments`), except tool pragmas such as `// archkeeper:allow-secret`
   - commented-out code
   - decorative divider lines
   - `TODO` / `FIXME` without an issue: write `TODO(#123): ...`
   - in files with 20+ code lines: non-JSDoc comment lines above 15% of code lines (tool directives such as `eslint-disable` don't count)
   - `eslint-disable` without a `-- reason`

```ts
// ✗ restates the code
// increment the retry counter
retries += 1;

// ✓ explains a non-obvious why
// GitHub returns 202 while computing stats; retrying is the documented behaviour.
retries += 1;
```

```ts
/** Resolves enabled modules and their dependencies in install order. */
export function resolveModules(config: KitConfig): Module[] { ... }
```

## Pragmas

`// archkeeper:allow-secret` on the same line tells the secret guard that a line which looks like a credential is a deliberate fixture.
Use it only in tests, and never on real secrets.

## Tests

- Vitest. Test behaviour through public functions.
- Code that writes files is tested in a temp directory. Assert the resulting tree, then run it again to prove it is idempotent.
- No network, no real home directory, no dependence on test order.

## Docs

- Added a package, module or shared util? Update `docs/architecture.md` in the same PR.
- Made a project-wide decision? Add an ADR (`docs/adr/`, copy the template) and a row in `docs/decisions.md`.
- Shipped a user-facing feature? Add its README section and a demo GIF (`docs/media/tapes/<feature>.tape`).

## Working with AI agents

This repo dogfoods its own Claude Code setup (`CLAUDE.md`, `AGENTS.md`, `.claude/`). AI-assisted contributions are welcome
and are held to exactly the same standards. You are the author and you are responsible for every line.
