# Feature: runway-r1

Status: done | Branch: feat/runway-r1

## Goal

v0.0 Runway milestone R1 (issues #3–#7): one zero-dependency package built by tsdown, with layer boundaries, brand constants, package integrity gates and lightness budgets enforced in `npm run check` and CI.

## Decisions (never undo without asking)

- 2026-10-09: The contributor Node floor stays `^22.22.2 || ^24.15.0 || >=26` and moves to `devEngines` (npm enforces it on `npm ci` and `npm run`); the published `engines.node` is `>=22.12.0`. Why: ADR-0011; the existing floor already excluded Node 25.
- 2026-10-09: Layer-boundary fixtures live in `test/fixtures/layers/src/...` and are linted with the real `eslint.config.mjs` (cwd set to the fixture root, type-aware rules off). Why: the `files` globs then match exactly as in `src/`, and the fixtures stay out of `npm run lint`, tsconfig and the comment check.
- 2026-10-09: The brand check matches the lowercase slug, case-sensitively. Allowlist: `src/core/brand.ts`, package metadata, `plugin/`, `docs/`, root Markdown, `LICENSE`, `.github/ISSUE_TEMPLATE/`, the dogfood setup (`.claude/`, `test/guards.test.ts`) and the two tools that recognise its pragma (`eslint.config.mjs`, `scripts/check-comments.mjs`). Why: product code and templates must use `BRAND`; this repo's own setup is regenerated from the kit in v0.1 M8.
- 2026-10-09: `scripts/check-brand.mjs` imports `src/core/brand.ts` directly through Node's type stripping. Why: no second copy of the slug; verified warning-free on Node 22.23 and 26.5, so `brand.ts` must stay erasable-only syntax.
- 2026-10-09: The plugin-name validator rules live in `test/brand.test.ts` as a test oracle. Why: nothing in product code needs them before the v0.3 plugin build; move them to `src/core` then.
- 2026-10-09: The bin version check runs before a dynamic `import('./main.js')`, which tsdown inlines with `codeSplitting: false`, so the program's code never evaluates on an old Node. Verified on real Node 18, 20 and 22.11 (message, exit 1) and 22.12 (runs).
- 2026-10-09: tsdown uses `deps.onlyImport: []` for every bundle and `deps.onlyBundle: []` for hooks. Why: a bundle that would import a package, or a hook that would inline one, fails the build.
- 2026-10-09: `dist/THIRD_PARTY_LICENSES.md` is generated after tsdown from the bundles' `//#region node_modules/...` markers; the script fails if a bundle has no markers. Why: tsdown has no license report, and its `build:done` hook runs once per config, so a cross-build file would race. Keep minify off.
- 2026-10-09: Budgets are bytes (1 kB = 1000 bytes, as npm reports). The pack-list snapshot is `scripts/package-files.txt`; refresh it with `npm run package -- --update`.
- 2026-10-09: "Install scripts" means `preinstall`, `install` and `postinstall`. See open questions for `prepare`.

## Done

- [x] #3 ADR-0011 single package (9d026b2)
- [x] #4 restructure to `src/` and layer boundaries (6796c7c)
- [x] #5 brand constants and brand check (f8aaf77)
- [x] #6 tsdown build, Node version check, licenses, reproducible-build CI job (9939ba7)
- [x] #7 ADR-0017 (1313c5a); package gates, budgets, publish dry run and install smoke CI jobs (9a79f7b)

## Next step

Push `feat/runway-r1` and open the R1 PR (closes #3–#7); run the `reviewer` and `security-reviewer` agents on the full diff. Then R2: example fixtures, demo-gifs workflow, ADR-0013 and the staged-release workflow.

## Gotchas / don't try again

- tsdown: `outputOptions.inlineDynamicImports` is deprecated in rolldown 1.2; use `codeSplitting: false`. A glob entry that matches nothing throws "Cannot find entry", so hook builds are created only for files that exist. tsconfig has `declaration: true`, so set `dts: false`.
- With `overrideConfigFile`, ESLint 10 resolves `files` globs against `cwd`, which is what lets the fixtures mirror `src/`.

## Open questions

- npm 11.17 warns on a tarball install that `archkeeper@0.0.0 (prepare: husky)` has install scripts not covered by `allowScripts`. `prepare` does not run for registry installs, but the warning will reach users. Strip dev-only scripts from the published manifest before the first publish (v0.1 M9, with the R2 release workflow), or move the husky setup out of `prepare`.
- ADR-0012 (brand constants) is still to be written in R3; `brand.ts` cites ADR-0010 until then.
