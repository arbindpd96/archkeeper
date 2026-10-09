# ADR-0011: Single published npm package with zero runtime dependencies (no workspaces)

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: ADR-0009, workspace clause only (npm workspaces `packages/*`)

## Context

ADR-0009 chose npm workspaces (`packages/*`), following the repo structure proposed in handoff §8.

Research measured the cost of a cold `npx` run (reference §7.1–7.2):

- A heavy dependency set is about 28 MB and takes about 10.8 s to install.
- A lean set bundled by tsdown becomes one ESM file of about 221 kB (67 kB gzipped).
- Every extra published package adds another cold-start fetch.

ESLint must stay, because only the ESLint ecosystem can enforce the comment policy. No `src/` code exists yet, so changing the layout now is cheap.

## Decision

Publish one npm package with zero runtime dependencies.

**Build.** Every library is a devDependency. tsdown, at an exact pinned version, inlines them into `dist/cli.mjs` and into one self-contained `dist/hooks/<name>.mjs` per hook.

**Layout.**

| Path                                | Contents                                                       | Published |
| ----------------------------------- | -------------------------------------------------------------- | --------- |
| `src/core`                          | Pure code: loader, renderer, planner, lock, detection          | bundled   |
| `src/cli`                           | Commands, prompts, output, exit codes                          | bundled   |
| `src/hooks`                         | Hook sources and the hook runtime (`src/hooks/runtime`)        | bundled   |
| `modules/<id>/{module.json,files/}` | Switchable modules                                             | yes       |
| `packs/`                            | Language and framework packs                                   | yes       |
| `schema/`                           | Generated JSON Schemas                                         | yes       |
| `plugin/`                           | Generated from v0.3 and kept in the repo for the marketplace   | no        |
| `examples/`, `benchmarks/`, `test/` | Fixture projects, the benchmark harness, tests and lint probes | no        |

`plugin/` is never published to npm (ADR-0016).

**Package fields.**

- `files` is `dist`, `modules`, `packs` and `schema`.
- There are no npm workspaces.
- `dependencies` stays empty.

**Lint.** ESLint 10, typescript-eslint strict and the jsdoc comment policy stay. `no-restricted-imports` and related core rules enforce layer boundaries:

- Core never imports cli, commander or @clack/prompts, and never calls `process.exit` or `console`.
- Hooks import only `node:` built-ins and the hook runtime.
- The hook runtime imports no npm package.

**Node floors.**

- The published `engines.node` is `^22.17.1 || ^24.4.1 || >=26`: even-numbered (LTS) lines only, above the commander 15 floor (22.12).
  - Security: 22.17.1 and 24.4.1 are the first releases that fix the Windows `node:path` traversal CVEs, CVE-2025-23084 (fixed in 22.13.1) and CVE-2025-27210 (fixed in 22.17.1 and 24.4.1). The CLI resolves paths inside users' projects, so it refuses to run on the vulnerable releases.
  - The odd lines 23 and 25 are short-lived and unsupported.
  - The bin enforces the same range before it loads the program (`src/cli/node-version.ts`); a test keeps it equal to `engines.node`.
- The contributor floor (`^22.22.2 || ^24.15.0 || >=26`, the dev toolchain's own minimums) moves to `devEngines` and `.nvmrc`.

**Revisit** when a second published artifact is needed.

## Consequences

- `npx` starts fast, and there is a single version to release.
- CI enforces an empty `dependencies` field, publint, a pack snapshot, reproducible builds and a THIRD_PARTY_LICENSES file for inlined code.
- Lint enforces internal boundaries instead of package boundaries.
- The v0.7 dashboard is planned as a static HTML file, so no workspace is needed for it.
- `docs/architecture.md` changes from `packages/*` to `src/*`.
- ADR-0009's status line notes that its workspace clause is superseded.

## Alternatives considered

- **Keep npm workspaces with separate core and cli packages.** More cold-start fetches and more release overhead.
- **Biome with `noRestrictedImports`.** Biome cannot enforce the comment policy.
- **Compiled single binaries.** About 62 MB per platform.
- **External runtime dependencies.** A slower `npx` and a larger supply-chain surface.
