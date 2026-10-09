# Feature: runway-r3

Status: in progress (ready for PR) | Branch: docs/runway-r3

## Goal

v0.0 Runway milestone R3 (issues #14, #15): ADR-0012, 0014, 0015, 0016 and 0018 accepted and reconciled with what R1 and R2 built, ADR-0002's status line updated, rows in `docs/decisions.md`, links from `docs/architecture.md`, and the R3 items ticked in `docs/ROADMAP.md`. Docs only.

## Decisions (never undo without asking)

- 2026-10-09: The ADRs start from the drafts in #14 and #15 and change only where R1, R2 or a recorded decision differs. Why: the drafts were filed with the owner's roadmap go-ahead; R1 and R2 decided details after them.
- 2026-10-09: The ADRs are written as accepted, with the owner as decider, as R1 and R2 did. Why: the milestone brief and the roadmap's proposed defaults. The owner confirms by reviewing and merging the R3 PR; if they object to one, set it back to proposed.
- 2026-10-09: Both guards fail closed with `ask` (ADR-0015). The #15 draft and #31 had guard-bash fail open with a stderr note. Why: the recorded v0.1 decision and `.claude/rules/generated-files.md` (guards judge parsed commands and ask when they cannot load or parse); deny rules are prefix-only, so they cannot back up a guard that gives up.
- 2026-10-09: The lock's `json {path: ownedKeys}` maps each owned key to the hash of the entry the kit wrote. Why: #22 and #40 must tell a user-changed kit entry from one the kit changed, which needs what the kit last wrote.
- 2026-10-09: Base and backup blobs are gzip (`node:zlib`); a managed root `.gitattributes` block marks `.archkeeper/base/**` (#24). Why: `gzip -dc` can inspect a blob, and validity is the decompressed hash, so compressed bytes may differ between zlib versions without harm.
- 2026-10-09: `update --restore <path>` also brings back what `removed[]` lists: a whole owned file, or only the removed blocks or JSON entries, leaving every other byte. Why: otherwise undoing a deletion means hand-editing the lock. #40 names only create-only docs.
- 2026-10-09: Lock and config schema changes need a version bump and a migration from the first publish (0.1.0), not "from v0.2" as the draft said. Why: the roadmap says the contract is permanent once users install it; the migration chain itself still lands in v0.2 M1.
- 2026-10-09: `config.json` carries `version` (1; a config without it is version 1), decided in ADR-0014 rather than left to #19. Why: the review asked for it in the contract that freezes at the first publish.
- 2026-10-09: Hooks need `node` within `engines.node` (ADR-0011), and doctor checks that range. Why: the roadmap's Requirements line; #42 still says 22.12.
- 2026-10-09: ADR-0018 publishes raw per-run JSONL (grades, tokens, cost) and full transcripts only with the owner's consent. Why: the draft publishes raw JSONL, while roadmap open question B asks whether transcripts may be published.
- 2026-10-09: ADR-0018 also rules out an update-available check, and ADR-0007's status line is unchanged. Why: `update` makes no network call; ADR-0018 delivers ADR-0007's check as an opt-in rather than superseding it, and the roadmap exit criteria list only the ADR-0002 and ADR-0009 status lines.
- 2026-10-09: The plugin carries only skills and agents: no hooks, settings, MCP servers or instruction files (ADR-0016). Why: roadmap v0.3 M1 ("skills and agents only and no hooks"). `.claude/rules/generated-files.md` now says the stop check never ships in the plugin.
- 2026-10-09: `src/core/brand.ts` still cites ADR-0010 in its JSDoc. Why: R3 is docs only; point it at ADR-0012 in the next code PR (v0.1 M1).
- 2026-10-09: The pre-compact snapshot goes to `.archkeeper/local/snapshots/latest.json`, not into the memory folder that reference §11 names. Why: it is machine state rewritten on every compaction, so in the committed `docs/features/` folder it would churn every diff.
- 2026-10-09: `Bash(rm -rf:*)` stays in every preset, and ADR-0015 says it denies every `rm -rf` whatever guard-bash decides; hooks run first, but never bypass a deny rule (reference §1.7, checked against the live docs). Why: reference §11 lists it, it is the only backstop when `node` is missing, and exact rules such as `Bash(rm -rf /)` miss every variant.
- 2026-10-09: The allow-secret pragma exempts only lines already on disk; a new marked line asks. This repo's guard-secrets now does the same (bb4ca25), and its hook state refuses symlinks without relying on `O_NOFOLLOW` (35365da). Why: R3 is docs only, but the review found both flaws live in the reference hooks that v0.1 ports.
- 2026-10-09: Generated skill and agent frontmatter follows an allowlist (ADR-0015), but an agent's `tools` may list `Bash`, unlike the review's suggestion. Why: `tools` only makes a tool available (reference §3.2, checked against the live docs), while a skill's `allowed-tools` grants tools without a prompt (§3.1), so only the latter must never hold unscoped `Bash`.
- 2026-10-09: `doctor` flagging duplicates is ADR-0016's guarantee against two copies of a skill; v0.3 M1 decides whether skills move into a separate opt-in plugin. Why: the plugin is the same for every user, so no setting stops a local-skills user from installing it.
- 2026-10-09: The stop check is off until the user confirms it, even in the full preset, and `checks.stop` stays the runner argv #38 specifies rather than only an npm script name, as the review suggested. Why: #38 also covers Python projects; the value never reaches a shell and is committed project content, like the tests it runs.
- 2026-10-09: The CI check that keeps `plugin/` and `.claude-plugin/` to release PRs, and their CODEOWNERS entries, land in v0.3 M1. Why: neither path exists yet, and no marketplace exists without them.
- 2026-10-09: `doctor --online` contacts only kit-owned MCP servers unless the user confirms a host, follows no cross-host redirect, and redacts userinfo and query strings (ADR-0018). Why: a cloned repo's `.mcp.json` must not choose where `doctor` sends requests.

## Done

- [x] Feature memory (77917fa); ADR-0012 (32b6371, #14); ADR-0014 (0ee8c89), ADR-0015 (90782e4), ADR-0016 with the ADR-0002 status line (8016ae3) and ADR-0018 (af62fea), for #15
- [x] Generated-files rules (3891710), architecture map links (2fd8ed1), ROADMAP R3 ticks (08f6371), first review pass (8bfdc65)
- [x] Rebased onto `main` after R2 (PR #75) merged; every relative link resolves.
- [x] Review fixes, ADR-0014 (e5c9e50–f49f58b): edits judged against `base`, sidecars keep `base`, deleted JSON entries, in-place `--restore`, uninstall keeps user files and its backup, config `version`, symlinks, path rules, untrusted lock, conflicted lock.
- [x] Review fixes, the rest (c3c6eed–f611b47): blocks sidecars and hook registration (0014); native `rm -rf`, pragma, `.env` shell access, state-file `lstat`, frontmatter allowlist, opt-in stop check (0015); duplicates and release-only plugin paths (0016); rename list (0012); `doctor --online` hosts (0018); reference §3.1–§3.2; roadmap and map fixes; two `.claude/hooks/` fixes with tests. `npm run check` green before every commit.

## Next step

Coordinator: run `security-reviewer` on the two `.claude/hooks/` fixes (bb4ca25, 35365da), then open the R3 PR (closes #14 and #15) with the deviation list under Open questions in its body. Before or with the merge, edit the issue texts listed there. Then start v0.1 M1 (#18–#20).

## Gotchas / don't try again

- R2 rewrote the `docs/decisions.md` table, and Prettier re-pads every row when a cell grows, so any branch that adds a row conflicts with any other that does. Resolve by keeping every row from both sides, then run Prettier.
- This repo's `.claude/settings.json` denies `Bash(git push --force *)`; the safety module will emit the `:*` form (reference §1.9). After the M8 migration (#45) the old entries stay as user entries; drop them then.
- Tests other than `test/guards.test.ts` must build the pragma from `BRAND.markerPrefix`: `check-brand` rejects the literal anywhere else under `test/`.

## Open questions

- Owner: confirm the five ADRs on the PR. Its body lists these deviations from the #15 drafts, so the merge is an informed acceptance: guard-bash fails closed; gzip blobs; `--restore` covers `removed[]`; migrations from 0.1.0 and a config `version` key; sidecars keep `base` until deleted; uninstall deletes only unmodified kit content and keeps its backup; the committed lock is untrusted; new pragma lines ask; `Bash(rm -rf:*)` denies every `rm -rf`; the stop check is off until confirmed; `doctor --online` contacts only kit-owned or confirmed hosts.
- Issue texts to align with the ADRs (not edited from this branch):
  - #19: the `version` key. #23: ADR-0014's Windows, case-insensitive and lock-path cases. #24: `local/.gitignore`, `0600` backups, the hash pattern, `maxOutputLength`, link types in the backup manifest, `wx` temp files.
  - #31: unparseable input asks; ask on shell access to `.env` files; "safe look-alikes pass" holds for the guard alone, since `Bash(rm -rf:*)` denies every `rm -rf`. #33: the AGENTS.md block and README say so.
  - #32: the pragma exempts only lines already on disk. #38: `checks.stop` is unset until the user confirms it.
  - #40: sidecars keep `base`, one sidecar per blocks file, deleted JSON entries in `removed[]`, in-place `--restore`, untrusted and conflicted locks, ADR-0012's rename list.
  - #41: delete only unmodified kit content and empty kit folders; keep `local/backup/` and print its path.
  - #42: `node` within `engines.node`, not 22.12; report a conflicted lock and any registered kit hook whose script differs from its base.
