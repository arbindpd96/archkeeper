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

The `Commit authors` CI job checks every commit in a PR. It fails on a bot author or co-author, an AI coding tool's address, or an AI attribution line. Human contributors keep their own authorship. Dependabot is the one bot exception: its dependency bumps keep `dependabot[bot]` authorship, but only on its own PRs, which merge by rebase once `CI passed` is green.

## What CI checks

| Gate           | Command                      | What it enforces                                                                               |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Formatting     | `npm run format:check`       | Prettier, 110 columns, single quotes                                                           |
| Lint           | `npm run lint`               | typescript-eslint strict, readability limits, JSDoc, layer boundaries (ADR-0011)               |
| Types          | `npm run typecheck`          | TypeScript strict, `noUncheckedIndexedAccess`                                                  |
| Comment policy | `npm run comments`           | See [Comments](#comments)                                                                      |
| Brand          | `npm run brand`              | The product slug appears only in `src/core/brand.ts`; `package.json` `name` and `bin` match it |
| Demo GIFs      | `npm run demos`              | Each committed GIF comes from a tape and stays within 2 MB and 20 s (30 s for the hero)        |
| Tests          | `npm test`                   | Vitest: Linux on Node 22/24/26, macOS + Windows on 24                                          |
| Build          | `npm run build`              | tsdown bundle in `dist/`, licenses of inlined code; CI checks that two builds are identical    |
| Package        | `npm run package`            | publint, pack snapshot, 0 runtime deps, no install scripts, budgets; CI adds publish dry run   |
| Install smoke  | CI only                      | The packed tarball installs under a path with a space and runs on ubuntu, macOS and Windows    |
| Node.js gate   | CI only                      | The built bin rejects Node.js 18, 20, 22.17.0 and 23 and runs on 22.17.1                       |
| Commits        | commitlint                   | Conventional Commits, no AI attribution trailers                                               |
| Commit authors | CI only                      | No bot or AI-tool authors or co-authors (Dependabot only on its own PRs), no AI attribution    |
| Changeset      | CI only                      | A PR touching a published folder adds a changeset, unless it is labelled `no-release`          |
| PR title       | action-semantic-pull-request | Conventional Commits title (it becomes the squash message)                                     |
| Security       | CodeQL, dependency review    | Code scanning; no new dependency with a known vulnerability of moderate severity or higher     |

The pre-commit hook runs Prettier, ESLint and the comment check on staged files, and commit-msg runs commitlint. Types and tests run in CI (and in `npm run check`), not in the hook, to keep commits fast.

## Code style

**Readable code over clever code.** A reader should understand a function from its name, its parameters and its body, without comments.

- Small functions with descriptive names. Limits (enforced): function ≤ 50 lines, cyclomatic complexity ≤ 10, ≤ 4 parameters, nesting depth ≤ 3, file ≤ 300 lines.
- Strict TypeScript and ESM. No `any`; use `unknown` and narrow. Exported functions declare their types.
- Validate external input (files, CLI args, network) at the boundary. Trust types inside.
- Never swallow errors. Throw errors whose message tells the user what to do next.
- No runtime dependencies (ADR-0011). Every library is a devDependency that tsdown inlines, and `budgets.json` caps the size (ADR-0017).
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
- Shipped a user-facing feature? Add its README section and a demo GIF (`docs/media/tapes/<feature>.tape`, see [Demo GIFs](#demo-gifs)).

## Demo GIFs

Every user-facing feature ships a README section and a GIF recorded with [VHS](https://github.com/charmbracelet/vhs) from `docs/media/tapes/<feature>.tape`.

- **Brand placeholders.** Write commands as `Type "{{brand.binName}} init"`, never with the product name. `scripts/render-tapes.mjs` fills `{{brand.*}}` from `src/core/brand.ts` into a temp copy, so a tape never runs through `vhs` directly and GIFs always show the current command.
- **Tape header.** A `# fixture: <name>` line names the `examples/` project the tape runs in. Font, size and theme come from `docs/media/tapes/_settings.tape`, and the script adds the output path, so tapes contain no `Output`, `Source` or settings other than `Set TypingSpeed`.
- **Tapes are shell scripts.** The script refuses `Env`, `Screenshot`, `Copy` and `Paste`, and keeps tokens and npm config out of the tape's shell. Still, review a tape like any script before you record it on your machine.
- **CI tapes.** The `demo-gifs` workflow renders every tape not marked `# live` against the packed CLI and uploads the GIFs as the `demo-gifs` artifact. It never commits: the maintainer runs `npm run gifs:pull -- <run-id>` and commits the GIFs.
- **Live tapes.** A tape marked `# live` needs a real Claude Code session, so the maintainer records it locally with `node scripts/render-tapes.mjs --live <feature>` after `npm run build`. The script refuses any VHS other than the 0.12.1 that CI pins; install JetBrains Mono too.
- **Limits.** A GIF is at most 2 MB and 20 s, or 30 s for a tape marked `# hero`. `npm run demos` checks committed GIFs, and the workflow checks rendered ones.
- **New workflow files.** Pushing `.github/workflows/*` over HTTPS needs the `workflow` scope: `gh auth refresh -h github.com -s workflow`.

## Changesets

The maintainer versions releases locally with [changesets](https://github.com/changesets/changesets) (ADR-0013). No bot opens version PRs or commits.

- Every user-facing PR adds a changeset: run `npm run changeset`, pick the bump, and write the changelog line. Commit the generated `.changeset/*.md` with the change.
- CI fails a PR that changes `src/`, `modules/`, `packs/` or `schema/` without a changeset. If the change needs no release, the maintainer labels the PR `no-release` and re-runs the failed `Changeset` job.
- Before tagging, the maintainer runs `npm run version-packages`, which applies the changesets to `package.json` and `CHANGELOG.md`.
- Release candidates use pre mode: `npx changeset pre enter rc` first, and `npx changeset pre exit` before the final release.
- Tagging, the staged publish and its 2FA approval are in the maintainer runbook, [docs/releasing.md](docs/releasing.md).

## Working with AI agents

This repo dogfoods its own Claude Code setup (`CLAUDE.md`, `AGENTS.md`, `.claude/`). AI-assisted contributions are welcome
and are held to exactly the same standards. You are the author and you are responsible for every line.
