# Architecture map

> The living map of archkeeper. Read it before creating anything new; update it (or run `/update-map`) after adding a
> source layer, module, pack or shared util. Status: **single-package layout in place (ADR-0011); product code starts in v0.0 Runway** (see `docs/ROADMAP.md`). Rows marked _planned_ are the agreed target (handoff §8, ADR-0002/0003/0011).

## Overview

```mermaid
flowchart LR
  user([Developer]) -->|npx archkeeper init| cli[src/cli]
  cli --> core[src/core]
  core -->|loads manifests| modules[modules/*]
  modules --> packs[packs/languages · packs/frameworks]
  core -->|merge-safe writes + lockfile| project[(User project:<br/>CLAUDE.md · AGENTS.md · .claude/ · docs/)]
  modules -->|build step| plugin[plugin/ — Claude Code plugin]
  plugin -->|/plugin install| cc([Claude Code])
  project --> cc
```

- **One source of truth.** Modules hold templates, hooks, skills and agents. The CLI scaffolds the project-owned parts. The build emits the plugin-owned parts into `plugin/`.
- **One package, zero runtime dependencies** (ADR-0011). Every library is a devDependency that tsdown inlines. The published `files` are `dist`, `modules`, `packs` and `schema`.
- **Core is pure.** It does module resolution, rendering, merge planning and the lockfile. The CLI owns prompts, output and exit codes.
- **Layers are lint-enforced** (ESLint `no-restricted-*` rules in `eslint.config.mjs`; each is proven by a fixture in `test/fixtures/layers/`):
  - `src/core` never imports `src/cli`, commander or @clack/prompts, and never uses `process.exit` or `console`, whether as a global, through `globalThis`, or imported from `process`, `console` or their `node:` forms.
  - `src/hooks` imports only `node:` built-ins and `src/hooks/runtime`.
  - `src/hooks/runtime` imports no npm package.

## Repository layout

| Path                      | Purpose                                                                                                       | Status           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/cli/`                | npx entry: Node version check, `--version`, `--help`; commands, prompts and output from v0.1                  | active           |
| `src/core/`               | Brand constants; from v0.1 the module loader, manifest schema, detection, renderer, merge planner, lockfile   | active           |
| `src/hooks/`              | Hook sources (one self-contained bundle each) and the shared hook runtime in `src/hooks/runtime/`             | _planned v0.1_   |
| `modules/<id>/`           | One switchable feature: `module.json` and `files/`                                                            | _planned v0.1_   |
| `packs/languages/<lang>/` | Language rules, linter configs, detection (TS/JS, Python first)                                               | _planned v0.1–2_ |
| `packs/frameworks/<fw>/`  | Framework rules and detection                                                                                 | _planned v0.2+_  |
| `schema/`                 | Generated JSON Schemas for manifests, config and the lockfile                                                 | _planned v0.1_   |
| `plugin/`                 | Generated Claude Code plugin, kept in the repo for the marketplace; never published to npm (ADR-0016)         | _planned v0.3_   |
| `benchmarks/`             | With-vs-without-kit harness (not published)                                                                   | _planned v0.2_   |
| `examples/`               | Fixtures `ts-app`, `py-app`, `mixed` for tests and tapes; not linted, formatted, covered or published         | active           |
| `scripts/`                | Repo checks (comments, brand, package), the license-file generator, shared helpers in `lib.mjs`               | active           |
| `docs/`                   | This map, decisions/ADRs, roadmap, release runbook (`releasing.md`), feature memories, research               | active           |
| `.claude/`                | This repo's own Claude Code setup (dogfooding)                                                                | active           |
| `test/`                   | Vitest suites for hooks, scripts and lint rules, plus `helpers.ts`; `fixtures/` is kept out of `npm run lint` | active           |
| `.github/`                | CI, release (tag-triggered staged publish), CodeQL and PR-title workflows; issue forms; Dependabot            | active           |
| `.husky/`                 | Git hooks: lint-staged on commit, commitlint on message                                                       | active           |
| `.changeset/`             | Changesets config and pending changesets; the maintainer versions locally (ADR-0013)                          | active           |

## Index

Add a row whenever something is created. Keep one line per item.

### Source layers

| Path                      | Purpose                                                                                                 | Key exports                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/core/brand.ts`       | The only place the product slug is written; every name, path and marker derives from it                 | `BRAND`, `Brand`                                      |
| `src/cli/bin.ts`          | Bundle entry (`dist/cli.mjs`): rejects unsupported Node.js before it imports the program                | none (entry)                                          |
| `src/cli/node-version.ts` | The supported Node.js range (equal to `engines.node`) and the upgrade message                           | `SUPPORTED_NODE_RANGE`, `nodeVersionProblem`          |
| `src/cli/main.ts`         | Argument parsing with `node:util` `parseArgs`: `--version` and `--help` until commander arrives in v0.1 | `main`, `readPackageInfo`, `CliOutput`, `PackageInfo` |

### Modules

| Module     | Purpose | Presets | Writes | Hooks |
| ---------- | ------- | ------- | ------ | ----- |
| _none yet_ |         |         |        |       |

### Shared utilities

| Path                                                                                                        | Purpose                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `.claude/hooks/lib.mjs`                                                                                     | Hook helpers: stdin payload, git, feature-memory lookup, symlink-safe `.claude/state` IO, `isProjectFile`                  |
| `.claude/hooks/shell-words.mjs`, `shell-word-reader.mjs`, `ansi-c-quote.mjs`, `brace-expansion.mjs`         | Linear-time shell tokenizer: quotes, escapes, heredocs, substitutions, brace expansion with a work budget                  |
| `.claude/hooks/shell-commands.mjs`, `command-wrappers.mjs`                                                  | Turn tokens into simple commands with pipelines; strip env assignments and wrappers (`sudo`, `env`, `xargs`, `bash -c`, …) |
| `.claude/hooks/shell-syntax.mjs`                                                                            | Import-free shell vocabulary shared by the parser and rules: shell names, value options, `hasExpansion`, `isAssignment`    |
| `.claude/hooks/find-expression.mjs`                                                                         | Splits `find` arguments into roots and expression tokens, with each `-exec` segment as one token                           |
| `.claude/hooks/bash-rules.mjs`, `git-rules.mjs`, `dangerous-paths.mjs`, `cli-options.mjs`, `glob-match.mjs` | Guard rules per program (`git`, `chmod`, `gh`, publish, `.env` reads) and how all rules combine                            |
| `.claude/hooks/delete-rules.mjs`                                                                            | `rm` and `find` delete rules: dangerous roots, filters that narrow before `-delete`, `-exec rm` and `find … \| xargs rm`   |
| `.claude/hooks/interpreters.mjs`                                                                            | Per-interpreter option specs; reads arguments in order to find inline code, modules, scripts or stdin                      |
| `.claude/hooks/inline-code.mjs`                                                                             | Classifies inline code as safe idiom, able to run its input, built from expansions, or opaque                              |
| `.claude/hooks/interpreter-rules.mjs`                                                                       | Denies or asks when a download, or an expansion, supplies the code an interpreter runs                                     |
| `.claude/hooks/downloaded-files.mjs`                                                                        | Names of the files `curl`/`wget` write in a command, so running one of them is caught                                      |
| `.claude/hooks/piped-scripts.mjs`                                                                           | Judges the text `echo`, `printf` or a here-document pipes into a shell, decoded escapes included; asks when it is hidden   |
| `.claude/hooks/verdicts.mjs`                                                                                | `deny`/`ask` verdict builders and `strictest`, shared by the guard rule modules                                            |
| `.claude/hooks/env-files.mjs`                                                                               | `.env` secrets-file and template matching shared by both guards                                                            |
| `.claude/hooks/attribution.mjs`                                                                             | AI-attribution pattern shared by `guard-bash` and `commitlint.config.mjs`                                                  |
| `scripts/lib.mjs`                                                                                           | Shared script helpers: `exitWith`, shell-free `git` and `npm` runners, `gitRevision`, `repositoryFiles`                    |
| `scripts/check-comments.mjs`                                                                                | Comment-policy checker (TypeScript AST): commented-out code, dividers, untracked TODOs, comment ratio                      |
| `scripts/third-party-licenses.mjs`                                                                          | Writes `dist/THIRD_PARTY_LICENSES.md` from the `node_modules` paths in the bundles' `//#region` markers                    |
| `scripts/check-package.mjs`                                                                                 | Package gates: publint, pack-list snapshot, runtime dependencies, install scripts, size budgets, bin smoke                 |
| `scripts/check-brand.mjs`                                                                                   | Brand check: no slug literal outside `src/core/brand.ts` and the allowlist; `package.json` `name` and `bin` match `BRAND`  |
| `scripts/check-changeset.mjs`                                                                               | Changeset gate: a PR that changes `src/` or `modules/` adds a `.changeset/*.md`, unless labelled `no-release`              |
| `scripts/check-release.mjs`                                                                                 | Release guards: npm ≥ 11.15, tag = `v<version>`, CHANGELOG section, not private; step outputs and notes; `--dry-run`       |
| `scripts/stage-summary.mjs`                                                                                 | Reads `npm stage publish --json` and prints the exact `npm stage approve <id>` command to the job summary                  |
| `scripts/check-demos.mjs`                                                                                   | Demo GIF caps: each GIF has a tape, ≤ 2 MB, ≤ 20 s (30 s for a `# hero` tape), timed from its frame delays                 |
| `test/helpers.ts`                                                                                           | `runScript`, hook verdict helpers, `tempDir`, `tempRepo`, `git`, `commitFiles`, `writeFiles`, `fixtureCopy` (own HOME)     |

## This repo's Claude Code setup

| File                              | Role                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                       | Shared rules for every AI tool                                                                                             |
| `CLAUDE.md`                       | Imports `AGENTS.md`, adds Claude-specific notes                                                                            |
| `.claude/settings.json`           | Permissions, attribution off, hook registration (exec form)                                                                |
| `.claude/hooks/session-start.mjs` | Injects in-progress feature "Next step" (and the pre-compaction snapshot after compaction)                                 |
| `.claude/hooks/pre-compact.mjs`   | Saves a branch/changes snapshot to `.claude/state/` before compaction                                                      |
| `.claude/hooks/guard-bash.mjs`    | Parses the command, then denies or asks on dangerous commands, AI attribution, hook skips; asks if it cannot load or parse |
| `.claude/hooks/guard-secrets.mjs` | Denies writes containing secrets; asks before editing `.env*`                                                              |
| `.claude/hooks/format-lint.mjs`   | Prettier, ESLint and comment check on each edited file (when installed)                                                    |
| `.claude/hooks/stop-guard.mjs`    | Runs `check:quick` on changed code and asks for a feature-memory update                                                    |
| `.claude/rules/*.md`              | Path-scoped rules: TypeScript, generated files, hooks, tests                                                               |
| `.claude/skills/*`                | `/new-feature`, `/handoff`, `/update-map`, `/adr`, `/why`, `/demo-gif`                                                     |
| `.claude/agents/*`                | `reviewer`, `security-reviewer`                                                                                            |

## Build

`npm run build` runs tsdown (`tsdown.config.mts`, tsdown pinned exactly) and then `scripts/third-party-licenses.mjs`. `dist/` is gitignored.

| Output                         | Source                     | Notes                                                             |
| ------------------------------ | -------------------------- | ----------------------------------------------------------------- |
| `dist/cli.mjs`                 | `src/cli/bin.ts`           | One ESM file with a shebang; the target comes from `engines.node` |
| `dist/hooks/<name>.mjs`        | each `src/hooks/<name>.ts` | One self-contained build per hook; it may inline no npm package   |
| `dist/THIRD_PARTY_LICENSES.md` | the bundles                | Licenses of every inlined package                                 |

Every bundle may import only `node:` built-ins (tsdown `deps.onlyImport`), so the package needs no runtime dependency. `jsonc-parser` is aliased to its ESM build (reference §7.1). CI builds twice, the second time from a fresh copy in another directory, and compares sha256 sums. Its `node-gate` job runs `dist/cli.mjs` on Node.js 18, 20, 22.17.0 and 23 (upgrade message, exit 1) and on 22.17.1 (`--version` works).

## Package gates

`npm run package` (`scripts/check-package.mjs`) checks the built package against `budgets.json`, the lightness contract (ADR-0017):

- publint passes, with warnings treated as errors.
- The `npm pack --dry-run` file list matches the committed `scripts/package-files.txt` (`npm run package -- --update` after an intended change).
- `dependencies`, `optionalDependencies` and `peerDependencies` stay within the runtime-dependency budget (0), and there is no `preinstall`, `install` or `postinstall` script.
- With `--release`, `prepare` counts as an install script too. The release workflow deletes husky's dev-only `prepare` (`npm pkg delete scripts.prepare`) and then checks the manifest it publishes this way.
- The tarball and each `dist/hooks/*.mjs` bundle stay within their size budgets.
- The built bin answers `--version` with the package version, and `--help`.
- `budgets.json` itself defines every budget as a non-negative number.

CI also runs `npm publish --dry-run` and installs the packed tarball under a path with a space on ubuntu, macOS and Windows.

## Conventions

- Brand: never write the product slug. Import `BRAND` from `src/core/brand.ts`. Core APIs that need a name, path or marker take `brand: Brand` as a parameter that defaults to `BRAND`, so tests can pass another brand and a rename touches one file.
- Feature work: `docs/features/<feature>/MEMORY.md`, using the template in `docs/features/_template/`.
- Decisions: `docs/decisions.md` index, with one ADR per big decision in `docs/adr/`.
- Failures not to repeat: `docs/mistakes.md`. Terms: `docs/glossary.md`.
