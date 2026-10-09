# ADR-0012: Brand constants as the single source of the product slug

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: none. The name itself is decided in [ADR-0010](0010-rename-to-archkeeper.md).

## Context

ADR-0010 renamed the project to `archkeeper` and asked for the name to be a single constant in code. The slug is more than a display name. Several strings derive from it, and from the first publish they are written into users' repos:

- the managed-block markers `<!-- archkeeper:begin <id> -->` and `# archkeeper:begin <id>` ([ADR-0014](0014-on-disk-contract.md))
- the state directory `.archkeeper/`, which holds the config, the lock and the base blobs (ADR-0014)
- the hook folder `.claude/hooks/archkeeper/`, whose script paths are registered in users' `settings.json` ([ADR-0015](0015-hook-runtime.md))
- the rules folder `.claude/rules/archkeeper/` and the sidecar suffix `.archkeeper-new`
- the `archkeeper:allow-secret` pragma, which users put on fixture lines in their own files (ADR-0015)
- the plugin and marketplace names, which users enable as `archkeeper@archkeeper` ([ADR-0016](0016-delivery-split.md))

Markers, the state dir and the hook paths therefore become permanent in users' repos at the first publish: every later `update` must still recognise them. The plugin and marketplace names must also pass Claude Code's validator, which rejects `claude-` prefixes and other reserved names (reference §4.1, §10).

If the slug were written into templates, code and tests by hand, a later rename would be a repo-wide hunt, and one missed copy would orphan users' markers.

R1 built the constants and their check (#5) before any template existed. This ADR records that design as built.

## Decision

**One file.** `src/core/brand.ts` is the only source file that writes the slug. It exports `BRAND`, a frozen object of type `Brand`:

| Field                               | Value                      | Used for                                                       |
| ----------------------------------- | -------------------------- | -------------------------------------------------------------- |
| `npmName`, `binName`, `displayName` | `archkeeper`               | The npm package, the CLI command and the product name          |
| `pluginName`, `marketplaceName`     | `archkeeper`               | The Claude Code plugin and its marketplace (v0.3)              |
| `markerPrefix`                      | `archkeeper`               | Managed-block markers                                          |
| `stateDir`                          | `.archkeeper`              | A dot-folder at the project root, outside `.claude/`           |
| `hookDir`                           | `.claude/hooks/archkeeper` | Generated hook scripts                                         |
| `rulesDir`                          | `.claude/rules/archkeeper` | Generated path-scoped rules                                    |
| `sidecarSuffix`                     | `.archkeeper-new`          | The file `update` writes beside a user-edited file             |
| `disclaimer`                        | the non-affiliation notice | Everywhere the product presents itself                         |
| `legacySlugs`                       | `[]`                       | Earlier slugs that `update` migrates from; empty until renamed |

The disclaimer is ADR-0010's wording, and the README carries the same text in its [License section](../../README.md#license).

**Injection.** Core APIs that need a name, path or marker take `brand: Brand` as a parameter that defaults to `BRAND`. Templates never contain the slug: the renderer fills brand values in (#20). Demo tapes use `{{brand.*}}` placeholders, which `scripts/render-tapes.mjs` fills before VHS runs (R2).

**Enforcement.** `scripts/check-brand.mjs` (`npm run brand`) runs in `npm run check` and in the CI quality job, so a stray literal fails CI.

- It imports `BRAND` from `src/core/brand.ts` through Node's type stripping, so the check holds no second copy of the slug.
- It searches every tracked and untracked (not ignored) file for the npm, bin, plugin and marketplace names and every legacy slug. The match is case-sensitive, because the slug and everything derived from it is lowercase.
- Each hit outside the allowlist is reported as `path:line` with a pointer to `BRAND`.
- The allowlist covers the brand file, package and release metadata, generated plugin output, `docs/` and root Markdown, `LICENSE`, the issue templates, this repo's dogfood setup (`.claude/` and the guard tests), and the two tools that recognise the `archkeeper:allow-secret` pragma. The script is the authority on the exact list.
- It also fails when `package.json` `name` differs from `BRAND.npmName`, or when `bin` maps anything other than exactly `BRAND.binName`.

**Renames.** If the name ever changes after the first publish:

1. Change the slug in `brand.ts` and move the old one into `legacySlugs`.
2. Update `package.json` `name` and `bin`; `check-brand` fails until they match.
3. Regenerate snapshots and tape renders, and write a new ADR.

Every slug-derived string in users' repos is either migrated by `update` or still accepted (#22, #40), and each case is tested with a fake legacy slug:

- **Markers.** Parsing accepts every `legacySlugs` prefix, and `update` rewrites legacy markers to the current prefix.
- **Folders.** The state, hook and rules folders move to their current names, and `update` rewrites the hook paths registered in `settings.json` to match.
- **Sidecars.** A sidecar with a legacy suffix counts as the pending sidecar it is; `update` renames it when it is unedited and reports it otherwise.
- **Plugin settings.** Where the team step wrote `enabledPlugins` and `extraKnownMarketplaces`, those kit-owned entries are rewritten to the current names.
- **Pragma.** The `allow-secret` pragma sits on users' own lines, which the kit never edits, so guard-secrets keeps accepting it under every legacy slug.

Because `check-brand` also searches for legacy slugs, the old name cannot creep back into code.

## Consequences

- A rename is one commit plus regenerated snapshots and tape renders, and existing installs migrate through `legacySlugs`.
- Tests already pin the shape: `test/brand.test.ts` checks that `BRAND` is frozen, that every path derives from the slug, that the state dir stays a root dot-folder outside `.claude/`, and that the plugin and marketplace names pass the validator's rules. `test/check-brand.test.ts` covers the check itself.
- From v0.1 M1, the renderer and golden-tree tests also render with an alternate brand (#20), so a slug assembled from pieces fails a test even though no literal appears.
- Hooks reach `BRAND` through `src/hooks/runtime`, the one hook layer that lint allows to import project code by relative path. tsdown inlines it into each bundle.
- Code identifiers in other cases, such as a future `ArchkeeperError` class, are allowed: they never reach users' files.
- `docs/HANDOFF.md` and `docs/research/` keep the old working names as historical records.

## Alternatives considered

- **Hard-coding `archkeeper` in templates and code.** Simpler today, but any future rename becomes a repo-wide migration, and a missed copy orphans users' markers.
- **Reading the name from `package.json` at run time.** Adds IO to core, and the CLI and the hooks it wrote could disagree about the name.
- **A case-insensitive check.** Would need an exception list for code identifiers that never reach users' files, for no gain.
- **Moving the plugin-name validator rules into `src/core` now.** Nothing in product code needs them before the v0.3 plugin build, so they stay a test oracle until then.
