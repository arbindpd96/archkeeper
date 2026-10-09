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
- 2026-10-09: `update --restore <path>` also brings back a file listed in `removed[]`. Why: otherwise undoing a deletion means hand-editing the lock. #40 names only create-only docs.
- 2026-10-09: Lock and config schema changes need a version bump and a migration from the first publish (0.1.0), not "from v0.2" as the draft said. Why: the roadmap says the contract is permanent once users install it; the migration chain itself still lands in v0.2 M1.
- 2026-10-09: Hooks need `node` within `engines.node` (ADR-0011), and doctor checks that range. Why: the roadmap's Requirements line; #42 still says 22.12.
- 2026-10-09: ADR-0018 publishes raw per-run JSONL (grades, tokens, cost) and full transcripts only with the owner's consent. Why: the draft publishes raw JSONL, while roadmap open question B asks whether transcripts may be published.
- 2026-10-09: ADR-0018 also rules out an update-available check, and ADR-0007's status line is unchanged. Why: `update` makes no network call; ADR-0018 delivers ADR-0007's check as an opt-in rather than superseding it, and the roadmap exit criteria list only the ADR-0002 and ADR-0009 status lines.
- 2026-10-09: The plugin carries only skills and agents: no hooks, settings, MCP servers or instruction files (ADR-0016). Why: roadmap v0.3 M1 ("skills and agents only and no hooks"). `.claude/rules/generated-files.md` now says the stop check never ships in the plugin.
- 2026-10-09: `src/core/brand.ts` still cites ADR-0010 in its JSDoc. Why: R3 is docs only; point it at ADR-0012 in the next code PR (v0.1 M1).

## Done

- [x] Feature memory (77917fa)
- [x] ADR-0012 brand constants and its decisions row (32b6371), for #14
- [x] ADR-0014 on-disk contract and merge-safe lifecycle (0ee8c89), for #15
- [x] ADR-0015 hook runtime and per-hook failure policy (90782e4), for #15
- [x] ADR-0016 delivery split; ADR-0002 status line and decisions row (8016ae3), for #15
- [x] ADR-0018 no telemetry, offline by default, benchmarks (af62fea), for #15
- [x] `.claude/rules/generated-files.md` points at ADR-0014, 0015 and 0016 (3891710)
- [x] Architecture map: "In a user's project" section and ADR links (2fd8ed1)
- [x] ROADMAP R3 items ticked (08f6371)
- [x] Review pass: guard-bash history credited to 72efe48 (PR #1), wording fixes (8bfdc65)
- [x] Rebased onto `main` after R2 (PR #75) merged; every relative link resolves, ADR-0016's link to ADR-0013 included. `npm run check` green before every commit and after the rebase.

## Next step

Coordinator: run the `reviewer` and `security-reviewer` agents on `git diff origin/main...docs/runway-r3`, then open the R3 PR (closes #14 and #15). Then align the issue texts listed under Open questions, and start v0.1 M1 (#18–#20).

## Gotchas / don't try again

- R2 rewrote the `docs/decisions.md` table, and Prettier re-pads every row when a cell grows, so any branch that adds a row conflicts with any other that does. Resolve by keeping every row from both sides, then run Prettier.
- This repo's `.claude/settings.json` denies `Bash(git push --force *)`; the safety module will emit the `:*` form (reference §1.9). After the M8 migration (#45) the old entries stay as user entries; drop them then.

## Open questions

- Owner: confirm the five ADRs on the PR, especially guard-bash failing closed, gzip blobs, `--restore` for removed files, and migrations from 0.1.0.
- #19 defines no version field for `config.json`. ADR-0014 requires a version bump on config schema changes after 0.1.0, so #19 must pick one (a versioned `$schema` URL or a `version` key).
- Issue texts to align with the ADRs: #31 ("unparseable input fails open" becomes `ask`), #42 (node 22.12 becomes the `engines.node` range), #40 (`--restore` also covers `removed[]`).
