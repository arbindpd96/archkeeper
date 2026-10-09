# ADR-0009: Toolchain and CI quality gates

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)

## Context

The owner asked for CI/CD rules that keep the code clean and readable, as expected of an open-source library: few comments,
and only the function-level comments that are needed. Tooling must enforce this rather than rely on reviewers.
Environment (2026-10-09): Node 26 current, Node 24 active LTS, npm 11 (install scripts need approval), pnpm not installed.

## Decision

- **Workspace:** npm workspaces (`packages/*`). This needs no extra install for contributors and works with npx distribution.
- **Language:** TypeScript `~6.0`. TypeScript 7 (the native compiler) is `latest` on npm, but typescript-eslint supports only `<6.1`. Revisit when it does.
- **Lint:** ESLint 10 flat config with typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`, `eslint-plugin-jsdoc` and `eslint-comments`.
  We chose ESLint over Biome because only the ESLint ecosystem can enforce the comment policy: `jsdoc/require-jsdoc` (public only),
  `jsdoc/informative-docs`, `no-inline-comments`, and justified disables.
- **Readability limits:** complexity 10, max-depth 3, 50 lines per function, 4 params, 300 lines per file.
- **Comment policy checker:** `scripts/check-comments.mjs`, built on the TypeScript AST. It fails on commented-out code, dividers,
  TODOs without an issue, and (in files with 20+ code lines) non-JSDoc comment lines above 15% of code lines.
  Commented-out code is detected by parsing the comment text, so prose "why" comments never trip it.
- **Format:** Prettier (110 columns).
- **Tests:** Vitest 5 with v8 coverage.
- **Commits:** commitlint (Conventional Commits plus a local `no-ai-attribution` rule). husky and lint-staged run format, lint and the comment check on staged files before each commit; types and tests run in CI.
- **Node floor (contributors):** `^22.22.2 || >=24.15.0`, the minimum required by eslint-plugin-jsdoc and lint-staged.
- **CI (GitHub Actions):**
  - Quality gates job.
  - Test matrix: Ubuntu on Node 22/24/26, plus macOS and Windows on Node 24.
  - commitlint on PR commits; Conventional PR titles.
  - Dependency review (PR-only) inside the CI workflow, so it is part of `CI passed`.
  - CodeQL (`security-and-quality`) as its own workflow.
  - A single `CI passed` aggregator job for branch protection.
  - Hardening: actions pinned to commit SHAs (Dependabot bumps them), `persist-credentials: false`, `npm ci --ignore-scripts`, job timeouts.
- **Branch rules on `main`:**
  - PRs required.
  - Required checks: `CI passed`, `Conventional PR title`, `Analyze (javascript-typescript)`.
  - Linear history; rebase or squash merges only; no force-push or deletion.
  - Admins may bypass only in emergencies.

## Consequences

- Contributors get fast local feedback from the git hooks, and CI runs the full gate set.
- The comment policy is opinionated. Edge cases are handled with a justified `eslint-disable ... -- reason` or a code change, not by weakening the rule.
- Release automation (changesets or release-please, npm trusted publishing with provenance) is added when the first package is publishable (v0.1).

## Alternatives considered

- **Biome:** much faster and a single tool, but it cannot express the JSDoc and comment rules above.
- **pnpm workspaces:** stricter, but adds an install step for every contributor, and corepack is no longer bundled with Node 25 and later.
- **TypeScript 7:** faster type-checking, but typescript-eslint does not support it yet.
