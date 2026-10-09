# Architecture map

> The living map of archkeeper. Read it before creating anything new; update it (or run `/update-map`) after adding a
> source layer, module, pack or shared util. Status: **v0.1 M1 core in place: module manifests, project config, preset resolution and the renderer** (see `docs/ROADMAP.md`). Rows marked _planned_ are the agreed target (handoff §8, ADR-0002/0003/0011).

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

- **One source of truth.** Modules hold templates, hooks, skills and agents. The CLI writes hooks, instructions, rules, settings and (by default) skills into the project. From v0.3 the build emits only skills and agents into `plugin/`, never hooks ([ADR-0016](adr/0016-delivery-split.md)).
- **One package, zero runtime dependencies** (ADR-0011). Every library is a devDependency that tsdown inlines. The published `files` are `dist`, `modules`, `packs` and `schema`.
- **Core is pure.** It does module resolution, rendering, merge planning and the lockfile. The CLI owns prompts, output and exit codes.
- **Layers are lint-enforced** (ESLint `no-restricted-*` rules in `eslint.config.mjs`; each is proven by a fixture in `test/fixtures/layers/`):
  - `src/core` never imports `src/cli`, commander or @clack/prompts. It never uses `process` or `console`, whether as a global, through `globalThis`, or imported from `process`, `console` or their `node:` forms, and never imports `fs` or `fs/promises`: callers pass file contents in through an injected reader.
  - `src/hooks` imports only `node:` built-ins and `src/hooks/runtime`.
  - `src/hooks/runtime` imports no npm package.

## Repository layout

| Path                      | Purpose                                                                                                       | Status           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/cli/`                | npx entry: Node version check, `--version`, `--help`; commands, prompts and output from v0.1                  | active           |
| `src/core/`               | Brand, typed errors, manifest schema and loader; later the config, renderer, detection, planner and lockfile  | active           |
| `src/hooks/`              | Hook sources (one self-contained bundle each) and the shared hook runtime in `src/hooks/runtime/`             | _planned v0.1_   |
| `modules/<id>/`           | One switchable feature: `module.json` and `files/`; `modules/presets.json` holds the preset chain             | active           |
| `packs/languages/<lang>/` | Language rules, linter configs, detection (TS/JS, Python first)                                               | _planned v0.1–2_ |
| `packs/frameworks/<fw>/`  | Framework rules and detection                                                                                 | _planned v0.2+_  |
| `schema/`                 | JSON Schemas generated from the zod schemas in `src/core` (`npm run schema`); published for `$schema` URLs    | active           |
| `plugin/`                 | Generated Claude Code plugin, kept in the repo for the marketplace; never published to npm (ADR-0016)         | _planned v0.3_   |
| `benchmarks/`             | With-vs-without-kit harness (not published)                                                                   | _planned v0.2_   |
| `examples/`               | Fixtures `ts-app`, `py-app`, `mixed` for tests and tapes; not linted, formatted, covered or published         | active           |
| `scripts/`                | Repo checks and CI gates, license file, tape rendering, release guards and packing; helpers in `lib.mjs`      | active           |
| `docs/`                   | This map, decisions/ADRs, roadmap, release runbook (`releasing.md`), feature memories, research               | active           |
| `.claude/`                | This repo's own Claude Code setup (dogfooding)                                                                | active           |
| `test/`                   | Vitest suites for hooks, scripts and lint rules, plus `helpers.ts`; `fixtures/` is kept out of `npm run lint` | active           |
| `.github/`                | CI, release (staged publish), demo-gifs, CodeQL and PR-title workflows; issue forms; Dependabot               | active           |
| `.husky/`                 | Git hooks: lint-staged on commit, commitlint on message                                                       | active           |
| `.changeset/`             | Changesets config and pending changesets; the maintainer versions locally (ADR-0013)                          | active           |

## Index

Add a row whenever something is created. Keep one line per item.

### Source layers

| Path                          | Purpose                                                                                                        | Key exports                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/core/brand.ts`           | The only place the product slug is written; every name, path and marker derives from it                        | `BRAND`, `Brand`                                                                            |
| `src/core/errors.ts`          | `ArchkeeperError` and its subclasses: the message names the file, the JSON path or line, and a `Try:` fix      | `ArchkeeperError`, `ManifestError`, `ConfigError`, `ResolveError`, `RenderError`, `Finding` |
| `src/core/paths.ts`           | Refuses absolute, backslash, `:`, control-character and `..` paths before any file-system check (#23)          | `relativePathProblem`, `RELATIVE_PATH_HINT`, `foldedPath`                                   |
| `src/core/json.ts`            | Parses JSON with `JSON.parse` and locates the first syntax error with jsonc-parser                             | `parseJson`, `JsonResult`                                                                   |
| `src/core/issues.ts`          | Turns zod's first issue into a finding with a JSON path, a problem and a fix                                   | `checkSchema`, `describeIssue`, `jsonPath`                                                  |
| `src/core/schema-parts.ts`    | Shared zod pieces: stacks, kebab ids, option names, one-line text, safe relative paths                         | `STACKS`, `Stack`, `kebabId`, `relativePath`, `described`, `listOf`, `refusing`             |
| `src/core/manifest-schema.ts` | The zod contract of `modules/<id>/module.json` and `modules/presets.json` (#18)                                | `moduleManifestSchema`, `presetCatalogSchema`, `HOOK_EVENTS`, `ModuleManifest`              |
| `src/core/manifest-rules.ts`  | Cross-field manifest rules the schema cannot express: demo or internal, declared files, unique entries         | `manifestRuleFinding`                                                                       |
| `src/core/targets.ts`         | Refuses template targets the kit builds from data or never writes: settings, `.mcp.json`, `.git`, kit dirs     | `reservedTarget`, `LOCAL_SETTINGS_FILE`, `KitFolders`                                       |
| `src/core/loader.ts`          | Loads modules, their templates and hook scripts, and the preset chain through an injected reader               | `loadModule`, `loadCatalog`, `ReadKitFile`, `KitModule`, `Catalog`                          |
| `src/core/config-schema.ts`   | The zod contract of `.archkeeper/config.json`: version, preset, modules, stack, options, compose (ADR-0014)    | `configSchema`, `ProjectConfig`, `CONFIG_VERSION`                                           |
| `src/core/config.ts`          | Parses the project config: unknown keys warn, invalid values and newer versions throw `ConfigError`            | `parseConfig`, `configPath`, `ParsedConfig`                                                 |
| `src/core/options.ts`         | Merges config options over each module's typed defaults; a wrong type throws with the option's description     | `resolveOptions`, `optionDefaults`, `ResolvedOptions`                                       |
| `src/core/when.ts`            | Evaluates a manifest `when` against the stack and option values, returning the reason it fails                 | `whenMismatch`, `When`                                                                      |
| `src/core/resolve.ts`         | Resolves a preset plus `modules.add`/`remove` into modules, adding requirements and leaving out failed `when`s | `resolveModules`, `ResolveRequest`, `Resolution`                                            |
| `src/core/install-order.ts`   | Topological install order with ties broken by id; a cycle throws `ResolveError` showing it                     | `installOrder`                                                                              |
| `src/core/text.ts`            | Locale-independent string order and LF normalisation, shared by the resolver and the renderer                  | `compareText`, `asLfText`                                                                   |
| `src/core/template.ts`        | Logic-less `{{a.b}}` templates with `\{{` for a literal `{{`; `toImport` writes unquoted `@path` imports       | `renderTemplate`, `brandScope`, `toImport`, `TemplateScope`                                 |
| `src/core/secrets.ts`         | Finds a likely secret (token, key, private key, credentialed URL) by line, never echoing it                    | `findSecret`, `SecretFinding`                                                               |
| `src/core/render-json.ts`     | Builds `.claude/settings.json` (exec-form hooks, permissions) and `.mcp.json` entries from objects             | `settingsPart`, `mcpPart`, `hookScriptPath`, `toJson`                                       |
| `src/core/render-tree.ts`     | Groups rendered entries by path in sorted order and refuses two modules writing one file, block or JSON entry  | `collectEntries`, `RenderTree`, `RenderedEntry`                                             |
| `src/core/render.ts`          | Renders modules for a stack, options and brand into a deterministic virtual tree that holds no secret (#20)    | `render`, `RenderContext`                                                                   |
| `src/cli/bin.ts`              | Bundle entry (`dist/cli.mjs`): rejects unsupported Node.js before it imports the program                       | none (entry)                                                                                |
| `src/cli/node-version.ts`     | The supported Node.js range (equal to `engines.node`) and the upgrade message                                  | `SUPPORTED_NODE_RANGE`, `nodeVersionProblem`                                                |
| `src/cli/main.ts`             | Argument parsing with `node:util` `parseArgs`: `--version` and `--help`; every run loads the shipped modules   | `main`, `readPackageInfo`, `CliOutput`, `PackageInfo`                                       |
| `src/cli/kit.ts`              | The CLI's file access for core: finds the package root and loads `modules/` through `loadCatalog`              | `packageRoot`, `kitReader`, `readKit`                                                       |

### Modules

Every module is a manifest only, marked `internal`, until its milestone adds files and hooks. `modules/presets.json` holds the small ⊂ medium ⊂ full chain with SessionStart caps of 1,200, 3,000 and 4,000 characters.

| Module             | Purpose                                                                       | Presets             | Writes | Hooks |
| ------------------ | ----------------------------------------------------------------------------- | ------------------- | ------ | ----- |
| `base`             | CLAUDE.md importing AGENTS.md, shared agent rules, ignore rules and settings  | small, medium, full | _M3_   | none  |
| `safety`           | Guard hooks and native deny rules; option `optOut`                            | small, medium, full | _M4_   | _M4_  |
| `feature-memory`   | Per-feature MEMORY.md, mistakes log, memory hooks, `/new-feature`, `/handoff` | small, medium, full | _M5_   | _M5_  |
| `knowledge`        | Decisions, ADRs, glossary, `/why`, `/adr`                                     | medium, full        | _M5_   | none  |
| `architecture-map` | `docs/architecture.md` and `/update-map`                                      | medium, full        | _M6_   | none  |
| `format-on-edit`   | Formats and lints each edited file with the project's tools                   | medium, full        | _M6_   | _M6_  |
| `stop-check`       | Runs the project's tests before Claude stops, once turned on                  | full                | _M6_   | _M6_  |

### Shared utilities

| Path                                                                                                        | Purpose                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `.claude/hooks/lib.mjs`                                                                                     | Hook helpers: stdin payload, git, feature memory, symlink-safe state IO, `isProjectFile`, `readRegularFile`                |
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
| `.claude/hooks/attribution.mjs`                                                                             | AI-attribution pattern shared by `guard-bash`, `commitlint.config.mjs` and `scripts/check-commit-authors.mjs`              |
| `scripts/lib.mjs`                                                                                           | Shared script helpers: `exitWith`, shell-free `git` and `npm` runners, `gitRevision`, `repositoryFiles`                    |
| `scripts/check-comments.mjs`                                                                                | Comment-policy checker (TypeScript AST): commented-out code, dividers, untracked TODOs, comment ratio                      |
| `scripts/third-party-licenses.mjs`                                                                          | Writes `dist/THIRD_PARTY_LICENSES.md` from the `<bundle>.inlined.json` lists the build writes from its module graph        |
| `scripts/check-package.mjs`                                                                                 | Package gates: publint, pack-list snapshot, runtime dependencies, install scripts, size budgets, bin smoke                 |
| `scripts/check-brand.mjs`                                                                                   | Brand check: no slug literal outside `src/core/brand.ts` and the allowlist; `package.json` `name` and `bin` match `BRAND`  |
| `scripts/build-schemas.mjs`                                                                                 | Writes `schema/*.json` with `z.toJSONSchema()` from the zod schemas in `src/core`; `--check` fails when one is stale       |
| `scripts/check-changeset.mjs`                                                                               | Changeset gate: a PR that changes `src/`, `modules/`, `packs/` or `schema/` adds a changeset, unless labelled `no-release` |
| `scripts/check-commit-authors.mjs`                                                                          | Commit-author gate: no bot or AI-tool author or co-author (Dependabot only on its own PRs), no `AI_ATTRIBUTION` line       |
| `scripts/check-release.mjs`                                                                                 | Release guards: npm ≥ 11.15, tag = `v<version>`, CHANGELOG section, not private, not below npm `latest`; `--dry-run`       |
| `scripts/pack-release.mjs`                                                                                  | Packs the release tarball only if the checkout is the tagged commit minus `prepare`; outputs tarball, integrity, shasum    |
| `scripts/stage-summary.mjs`                                                                                 | Reads `npm stage publish --json`; prints the shasum to check and the exact `npm stage approve <id>` command                |
| `scripts/check-demos.mjs`                                                                                   | Demo gate: GIF caps (a tape each, ≤ 2 MB, ≤ 20 s or 30 s for a `# hero` tape) and every module's demo or `internal`        |
| `scripts/demo-rules.mjs`                                                                                    | Module demo rule (#18): exactly one of `demo` or `internal`; a demo has its tape, committed GIF and README section         |
| `scripts/render-tapes.mjs`                                                                                  | Fills `{{brand.*}}` in `docs/media/tapes/*.tape`, installs the packed CLI, runs pinned VHS in a fixture copy               |
| `scripts/tape-rules.mjs`                                                                                    | Tape checks with a VHS-faithful tokenizer: refused commands anywhere on a line, Set-only settings, brand placeholders      |
| `scripts/pull-gifs.mjs`                                                                                     | `npm run gifs:pull -- <run-id>`: copies a demo-gifs run's feature GIFs into `docs/media/` for the maintainer to commit     |
| `test/helpers.ts`                                                                                           | Test helpers: `runScript`, hook verdicts, temp dirs and repos, `git`, `commitFiles`, `fixtureCopy`, `fakeBin`, `gifBytes`  |
| `test/kit-fixtures.ts`                                                                                      | Core test data: an in-memory `ReadKitFile`, a manifest that uses every field, and the v0.1 preset chain                    |
| `test/fixtures/render/`                                                                                     | Three fixture modules for the renderer's snapshot, property and brand tests; hook bundles live in `hook-bundles/`          |

## This repo's Claude Code setup

| File                              | Role                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                       | Shared rules for every AI tool                                                                                             |
| `CLAUDE.md`                       | Imports `AGENTS.md`, adds Claude-specific notes                                                                            |
| `.claude/settings.json`           | Permissions, attribution off, hook registration (exec form)                                                                |
| `.claude/hooks/session-start.mjs` | Injects in-progress feature "Next step" (and the pre-compaction snapshot after compaction)                                 |
| `.claude/hooks/pre-compact.mjs`   | Saves a branch/changes snapshot to `.claude/state/` before compaction                                                      |
| `.claude/hooks/guard-bash.mjs`    | Parses the command, then denies or asks on dangerous commands, AI attribution, hook skips; asks if it cannot load or parse |
| `.claude/hooks/guard-secrets.mjs` | Denies secrets in writes; asks on `.env*`, new allow-secret lines, new secret lines, and edits it can't check              |
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
| `dist/<bundle>.inlined.json`   | each build's module graph  | The `node_modules` files a bundle inlines; never published        |
| `dist/THIRD_PARTY_LICENSES.md` | the `.inlined.json` lists  | Licenses of every inlined package                                 |

Every bundle may import only `node:` built-ins (tsdown `deps.onlyImport`), so the package needs no runtime dependency. The `inlinedModules` plugin in `tsdown.config.mts` lists every `node_modules` file in each build's module graph (#71); package.json `files` excludes the lists. `jsonc-parser` is aliased to its ESM build (reference §7.1). CI builds twice, the second time from a fresh copy in another directory, and compares sha256 sums. Its `node-gate` job runs `dist/cli.mjs` on Node.js 18, 20, 22.17.0 and 23 (upgrade message, exit 1) and on 22.17.1 (`--version` works).

## Package gates

`npm run package` (`scripts/check-package.mjs`) checks the built package against `budgets.json`, the lightness contract (ADR-0017):

- publint passes, with warnings treated as errors.
- The `npm pack --dry-run` file list matches the committed `scripts/package-files.txt` (`npm run package -- --update` after an intended change).
- `dependencies`, `optionalDependencies` and `peerDependencies` stay within the runtime-dependency budget (0), and there is no `preinstall`, `install` or `postinstall` script.
- With `--release`, `prepare` counts as an install script too, and `publishConfig` or a package-root `.npmrc` fails the check, since either could override the registry, tag, access or auth the workflow passes. The release workflow deletes husky's dev-only `prepare` (`npm pkg delete scripts.prepare`) and then checks the manifest it publishes this way.
- The tarball and each `dist/hooks/*.mjs` bundle stay within their size budgets.
- The built bin answers `--version` with the package version, and `--help`.
- `budgets.json` itself defines every budget as a non-negative number.

CI also runs `npm publish --dry-run` and installs the packed tarball under a path with a space on ubuntu, macOS and Windows.

## In a user's project

_Planned for v0.1._ What `init` writes, and the decision that governs each part:

| Path                                                     | Strategy                     | Contract                                                                           |
| -------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.gitattributes` | Managed blocks               | [ADR-0014](adr/0014-on-disk-contract.md)                                           |
| `.claude/settings.json`, `.mcp.json`                     | Kit-owned JSON entries       | ADR-0014; hook registration and deny rules in [ADR-0015](adr/0015-hook-runtime.md) |
| `.claude/hooks/archkeeper/*.mjs`                         | Owned                        | ADR-0015                                                                           |
| `.claude/rules/archkeeper/`, `.claude/skills/<name>/`    | Owned                        | ADR-0014; skills move to the plugin only with `--skills plugin` (ADR-0016)         |
| `docs/` feature memory, decisions, map                   | Create-only                  | ADR-0014                                                                           |
| `.archkeeper/config.json`, `lock.json`, `base/`          | Committed kit state          | ADR-0014                                                                           |
| `.archkeeper/local/`                                     | Gitignored state and backups | ADR-0014, ADR-0015                                                                 |
| `<path>.archkeeper-new` beside a kit file                | Sidecar: the kit's version   | ADR-0014; from `init` or `update`, committed, never loaded by Claude Code          |

Every name and path comes from `BRAND` ([ADR-0012](adr/0012-brand-constants.md)). `init`, `update`, `uninstall`, `doctor` and every hook stay offline, and the kit has no telemetry ([ADR-0018](adr/0018-offline-no-telemetry.md)).

## Conventions

- Brand: never write the product slug. Import `BRAND` from `src/core/brand.ts` ([ADR-0012](adr/0012-brand-constants.md)). Core APIs that need a name, path or marker take `brand: Brand` as a parameter that defaults to `BRAND`, so tests can pass another brand and a rename touches one file.
- Feature work: `docs/features/<feature>/MEMORY.md`, using the template in `docs/features/_template/`.
- Decisions: `docs/decisions.md` index, with one ADR per big decision in `docs/adr/`.
- Failures not to repeat: `docs/mistakes.md`. Terms: `docs/glossary.md`.
