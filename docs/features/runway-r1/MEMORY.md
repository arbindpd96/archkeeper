# Feature: runway-r1

Status: done | Branch: feat/runway-r1

## Goal

v0.0 Runway milestone R1 (issues #3–#7): one zero-dependency package built by tsdown, with layer boundaries, brand constants, package integrity gates and lightness budgets enforced in `npm run check` and CI.

## Decisions (never undo without asking)

- 2026-10-09: The contributor Node floor stays `^22.22.2 || ^24.15.0 || >=26` and moves to `devEngines` (npm enforces it on `npm ci` and `npm run`). Why: ADR-0011; the existing floor already excluded Node 25.
- 2026-10-09: The published `engines.node` is `^22.17.1 || ^24.4.1 || >=26`, and `SUPPORTED_NODE_RANGE` in `src/cli/node-version.ts` must equal it (a test enforces this). Why: security review of PR #69. 22.17.1 and 24.4.1 fix the Windows `node:path` traversal CVEs (CVE-2025-23084, CVE-2025-27210), and the odd lines 23 and 25 are unsupported (ADR-0011).
- 2026-10-09: Layer-boundary fixtures live in `test/fixtures/layers/src/...` and are linted with the real `eslint.config.mjs` (cwd set to the fixture root, type-aware rules off). Why: the `files` globs then match exactly as in `src/`, and the fixtures stay out of `npm run lint`, tsconfig and the comment check.
- 2026-10-09: The brand check matches the lowercase slug, case-sensitively. Why: the slug and every derived string (`.archkeeper`, markers, paths, bin) are lowercase, and code identifiers such as the planned `ArchkeeperError` class (`.claude/rules/typescript.md`) never reach users' files, so a case-insensitive match would need an exception list for no gain. Allowlist: `src/core/brand.ts`, package metadata, `plugin/`, `docs/`, root Markdown, `LICENSE`, `.github/ISSUE_TEMPLATE/`, the dogfood setup (`.claude/`, `test/guards.test.ts`) and the two tools that recognise its pragma (`eslint.config.mjs`, `scripts/check-comments.mjs`).
- 2026-10-09: `scripts/check-brand.mjs` imports `src/core/brand.ts` directly through Node's type stripping. Why: no second copy of the slug. Verified warning-free on Node 22.23 and 26.5; `erasableSyntaxOnly` in `tsconfig.base.json` keeps the sources strippable.
- 2026-10-09: The plugin-name validator rules live in `test/brand.test.ts` as a test oracle. Why: nothing in product code needs them before the v0.3 plugin build; move them to `src/core` then.
- 2026-10-09: The bin version check runs before a dynamic `import('./main.js')`, which tsdown inlines with `codeSplitting: false`. Bundled `node:` imports are still hoisted above the check, so the CI `node-gate` job proves the gate is reached on Node.js 18, 20, 22.17.0 and 23 and that 22.17.1 runs. dist/ stays one file because real Node.js 18, 20, 22.11, 22.17.0, 23 and 25 all reach the gate without a SyntaxError.
- 2026-10-09: tsdown uses `deps.onlyImport: []` for every bundle and `deps.onlyBundle: []` for hooks. Why: a bundle that would import a package, or a hook that would inline one, fails the build.
- 2026-10-09: `dist/THIRD_PARTY_LICENSES.md` is generated after tsdown from the bundles' `//#region node_modules/...` markers. The script fails if a bundle has no markers, and refuses package folders outside `<root>/node_modules`. Why: tsdown has no license report, and its `build:done` hook runs once per config, so a cross-build file would race. Keep minify off. Moving to the bundler's module graph is #71.
- 2026-10-09: Budgets are bytes (1 kB = 1000 bytes, as npm reports), and `check-package` rejects a missing or negative budget. The pack-list snapshot is `scripts/package-files.txt`; refresh it with `npm run package -- --update`.
- 2026-10-09: "Install scripts" means `preinstall`, `install` and `postinstall`. See open questions for `prepare`.
- 2026-10-09: Scripts never spawn through a shell. `check-package` runs npm's `npm-cli.js` with `process.execPath` (from `npm_execpath`, or beside Node.js), else `npm` on PATH. Shared script helpers live in `scripts/lib.mjs`.

## Done

- [x] #3 ADR-0011 single package (9d026b2)
- [x] #4 restructure to `src/` and layer boundaries (6796c7c)
- [x] #5 brand constants and brand check (f8aaf77)
- [x] #6 tsdown build, Node version check, licenses, reproducible-build CI job (9939ba7)
- [x] #7 ADR-0017 (1313c5a); package gates, budgets, publish dry run and install smoke CI jobs (9a79f7b)
- [x] PR #69 review fixes: Node range and CVE note (040295b), node-gate CI job (b1e89b0), damaged-install message (7a370a5), `scripts/lib.mjs` (a0818b1), license-script hardening (412cebc), shell-free npm (f0e56d2), budgets validation and tests (d077695), core purity lint (bcc05dc), rebuild in another directory (97343a1), `erasableSyntaxOnly` (6034933), CONTRIBUTING (f6c1108)

## Next step

Push `feat/runway-r1` to update PR #69 and wait for `CI passed`. The new jobs (`node-gate`, `package`, `install-smoke` on three OSes, `reproducible-build`) run for the first time there. Then R2: example fixtures, demo-gifs workflow, ADR-0013 and the staged-release workflow (#11).

## Gotchas / don't try again

- tsdown: `outputOptions.inlineDynamicImports` is deprecated in rolldown 1.2; use `codeSplitting: false`. A glob entry that matches nothing throws "Cannot find entry", so hook builds are created only for files that exist. tsconfig has `declaration: true`, so set `dts: false`.
- With `overrideConfigFile`, ESLint 10 resolves `files` globs against `cwd`, which is what lets the fixtures mirror `src/`.
- Homebrew's Node.js keeps npm outside the Node.js prefix, so `check-package` falls back to `npm` on PATH there; official Node.js builds (and setup-node) ship npm beside `node`.

## Open questions

- `prepare: husky` ships in the published manifest. npm 11.17 warns on a tarball install that `archkeeper@0.0.0 (prepare: husky)` has install scripts not covered by `allowScripts`. `prepare` does not run for registry installs, but the warning will reach users. Tracked in #11 (the release workflow strips dev-only lifecycle scripts) and #47 (the first rc and stable publish); resolve before v0.1 M9.
- ADR-0012 (brand constants) is still to be written in R3; `brand.ts` cites ADR-0010 until then.
