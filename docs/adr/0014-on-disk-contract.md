# ADR-0014: On-disk contract and merge-safe lifecycle

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: none

## Context

The kit writes into existing repos and must never lose a user byte (handoff §3, differentiator 6; roadmap feature 19, safe updates). Whatever the first release writes into users' repos is effectively permanent, so this contract has to be right before 0.1.0.

Relevant inputs:

- ADR-0003 requires a project config file that records the enabled modules.
- Reference §7.2 defines four update strategies and a lock that also holds the setup answers, with bases stored as plain files under `<state dir>/base/<path>`.
- The closest competitors either overwrite, or offer only 2-way sidecars with no merge (reference §8).
- R1 fixed the names in `BRAND` ([ADR-0012](0012-brand-constants.md)): the state dir `.archkeeper` at the project root, outside `.claude/`; the marker prefix; and the sidecar suffix `.archkeeper-new`.

Claude Code discovers instruction files by name and place:

- A subdirectory `CLAUDE.md` or `CLAUDE.local.md` loads lazily when Claude touches that subtree (reference §2.1).
- Nested `<subdir>/.claude/skills/` folders are discovered (reference §3.1), and every `.md` file under `.claude/rules/` is a rule (reference §2.2).

Verbatim copies of kit files stored under their real names would therefore be loaded as stale instructions. They would also turn up in searches and duplicate checks.

## Decision

### State files

Everything the kit keeps lives in `.archkeeper/` (`BRAND.stateDir`):

| Path                        | Committed | Holds                                                             |
| --------------------------- | --------- | ----------------------------------------------------------------- |
| `.archkeeper/config.json`   | yes       | User intent                                                       |
| `.archkeeper/lock.json`     | yes       | Machine state                                                     |
| `.archkeeper/base/<sha256>` | yes       | The last kit-written content of each owned file and block         |
| `.archkeeper/local/`        | no        | Active-feature pointer, snapshots, caches, hook state and backups |

**`config.json`** is the only kit file a user edits by hand. It holds `version` (1; a config without it is read as version 1), `$schema`, `preset`, `modules {add, remove}`, an optional `stack` override, per-module `options` (for example `blockAiAttribution`, `blockNoVerify` and `checks.stop`), and the Superpowers and Spec Kit choices. `update` re-renders from it. It is validated with zod and exported to `schema/config.schema.json`; unknown keys warn, and invalid values fail with a hint (#19). The setup answers live here, not in the lock as reference §7.2 proposed.

**`lock.json`** is written only by the kit:

```text
{ lockfileVersion: 1,
  kit:     { name, version },
  modules: [ids in install order],
  files:   { <path>: { module, strategy, base, pending? } },
  blocks:  { <path>: { <blockId>: { base, pending? } } },
  json:    { <path>: <ownedKeys> },
  removed: [kit files, blocks and JSON entries the user deleted] }
```

- Paths are project-relative with forward slashes.
- Hashes are sha256 of LF-normalised content, so an autocrlf checkout is not mistaken for an edit.
- `base` is the hash of the content the kit last wrote to that file or block. It never holds user content: it is the yardstick for every user change (see [Updates](#updates)).
  - For owned files and blocks it also names the blob that holds that content. A create-only file keeps no blob, because nothing is ever merged into it.
  - It is `null` where the kit has never written, such as a different user file found at an owned path on first contact.
- `pending` is the hash of kit content waiting in a sidecar. Its blob is kept like a base.
- `ownedKeys` maps each JSON entry the kit owns to the hash of the entry as the kit wrote it, so an entry the user changed is recognised. Hook entries are keyed by event and `args` path, so one script registered on two events has two keys. Permission rules are keyed by list and exact string, so the same string in `allow` and `deny` has two keys. MCP servers are keyed by name.
- `removed[]` entries name a path, plus a block id or an owned key for a block or a JSON entry.
- The zod schema in `src/core`, exported to `schema/lock.schema.json`, is the exact definition. Every hash in the lock must match `^[0-9a-f]{64}$`, so no lock value can name a path.

**Base blobs.** `.archkeeper/base/<sha256>` holds the last kit-written content of each owned file and block.

- Each blob is gzip-compressed with `node:zlib` and named by the sha256 of its uncompressed, LF-normalised content.
- A blob is written only when absent, and removed when no lock entry references it.
- A managed `.gitattributes` block marks `.archkeeper/base/**` as `binary linguist-generated`.
- A blob is valid when its decompressed sha256 matches its name. Either side of a git conflict on a blob is therefore correct, and `doctor` checks integrity.
- Blobs are committed, so they are untrusted input. A blob is decompressed with zlib's `maxOutputLength` set to 1 MiB, far above any kit file, so a crafted gzip bomb fails the integrity check instead of exhausting memory.

**`local/`** holds the active-feature pointer (`local/active-feature`), the pre-compact snapshot (`local/snapshots/latest.json`), caches, hook state ([ADR-0015](0015-hook-runtime.md)) and per-run backups.

- It is gitignored twice: by the base module's `.gitignore` block, and by its own `.archkeeper/local/.gitignore`, which contains `*` and so ignores itself too. A user who deletes the root block therefore cannot commit backups or snapshots by accident.
- A backup is a set of compressed, content-addressed blobs, named like the bases, plus a `manifest.json` that maps paths to blobs, under `local/backup/<runId>/`. The last 3 runs are kept.
- Backups can hold copies of gitignored files, such as a user's `.mcp.json` with tokens, so they are created with mode `0600`, like hook state.

**Not discoverable.** Nothing under `.archkeeper/` is named `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` or `SKILL.md`, sits under a `.claude/` folder, or ends in `.md`. Bases and backups are compressed, so a ripgrep search for template text finds nothing there. A test enforces both (#24). The map seeder and, from v0.2, the duplicate checker skip `.archkeeper/`.

### Ownership strategies

Every generated file declares one strategy in its module manifest (#18):

| Strategy      | Typical files                                              | Ownership                                                                                     |
| ------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `owned`       | Hook scripts, kit skills, kit rules                        | The kit owns the whole file                                                                   |
| `blocks`      | `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.gitattributes`   | The kit owns only the regions between its markers; every byte outside them is the user's      |
| `json`        | `.claude/settings.json`, `.mcp.json`                       | The kit owns individual entries; edits go only through jsonc-parser `modify` and `applyEdits` |
| `create-only` | Feature-memory template, `decisions.md`, `architecture.md` | Written once when absent, then never touched                                                  |

- **Markers.** Markdown uses `<!-- archkeeper:begin <id> -->` … `<!-- archkeeper:end <id> -->`. Claude Code strips block-level HTML comments from context, so markers cost no tokens (reference §2.1). `.gitignore` and `.gitattributes` use `# archkeeper:begin <id>` … `# archkeeper:end <id>`. Markers derive from `BRAND.markerPrefix`, and parsing also accepts the `BRAND.legacySlugs` prefixes. Malformed or duplicated markers abort the run before any write, naming the line.
- **JSON.** The kit sets `$schema` only when it is absent. It never modifies or reorders user entries, never writes conflict markers, and aborts before any write when the user's JSON is malformed, citing the file, line and column.
- **Sidecars.** A sidecar is `<path>` plus `BRAND.sidecarSuffix`, for example `CLAUDE.md.archkeeper-new`. Because the suffix follows the full file name, a sidecar never ends in `.md` or `.mjs` and is never named `SKILL.md`, so Claude Code never loads it as an instruction, rule, skill or hook.

### Writing

- **Planned purely.** Core turns the rendered tree, a snapshot of the project and the lock into ordered operations, each with a reason: `create`, `insertBlock`, `replaceBlock`, `mergeJson`, `sidecar`, `adopt`, `skip`, `delete` and `respectRemoval` (#21). Planning against the state the previous apply left behind yields no operation but `skip`, so a second run writes nothing.
- **First contact loses nothing.** An existing file identical to the kit output (after LF normalisation) is adopted. A different existing file at an owned path is never overwritten: it is left alone with `base: null` and reported, and the kit's version goes to a sidecar.
- **User deletions are respected.** A kit file, block or JSON entry the user deleted is recorded in `removed[]` and never recreated. A kit-owned JSON entry missing from its file counts as a user deletion, so a deny rule the user removed is never added back.
- **Path-checked.** #23 holds the exact rules and tests each case on all three OSes. Deletes never follow symlinks, and every write and delete target, including every path read from the lock, is refused when it:
  - is absolute, starts with a drive letter or a UNC prefix, or contains a `..` segment, a backslash, a `:` (which also rules out NTFS streams) or a NUL byte
  - resolves (via realpath) through a symlink outside the project root
  - lies inside `.git/`, compared case-insensitively and including the 8.3 short name, so `.GIT/` and `GIT~1/` are refused too
  - uses a Windows reserved name with or without an extension (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, so `nul.txt` and `con.md` too), or a name ending in a dot or space
- **The lock is untrusted.** It is committed, and lockfile changes are often approved unread, so a crafted lock must not turn `update` or `uninstall` into a way to delete files or widen access:
  - The kit deletes, replaces or migrates only paths that the current kit's manifests could own, including files they list as retired from an earlier version and their `legacySlugs` equivalents. It removes or changes only JSON keys a manifest could have written. Other lock entries are reported and ignored.
  - `update` and `uninstall` always list every deny or ask rule they remove or narrow and every allow rule they add. They never change permissions silently.
- **Symlinks are left alone.** A write target that is itself a symlink, even one inside the project such as `CLAUDE.md -> AGENTS.md`, is never written through or replaced. It is left alone and reported, and the kit's content goes to a sidecar.
- **Transactional.**
  - Every touched path is backed up first. The backup manifest records whether each path was a file, a symlink (with its target) or absent.
  - Each write goes to a temp sibling with a random name, created exclusively and without following symlinks (`wx`, plus `O_NOFOLLOW` where the platform has it), and is renamed into place, retrying with backoff on Windows `EPERM` and `EBUSY`.
  - Any failure rolls every path back to its previous content and type, removing what the run created.
  - The lock is written last, so an interrupted run leaves the previous lock and the next run plans again.
- **A conflicted lock is rebuilt.** Every teammate's `update` edits the committed lock, so a git merge can leave conflict markers in it. `doctor` reports them, and `update` rebuilds the lock before planning:
  - It keeps each entry from the side written by the newer kit (either side when the versions are equal) and takes the union of both sides' `removed[]`.
  - An entry whose content on disk hashes to an existing blob takes that blob as its base.
  - Anything still unclear counts as a user edit, so the worst outcome is an extra sidecar, never a lost byte.
- **Versions.** A lock with a newer `lockfileVersion`, or a config with a newer `version`, fails with "upgrade archkeeper", and a kit older than `lock.kit.version` refuses to run, so a downgrade cannot rewrite a newer install.

### Updates

**v0.1 never overwrites a user edit.** `update` re-renders from `config.json` with the running kit and compares each file, block and JSON entry on disk with its `base` in the lock:

| Strategy      | Unchanged since the kit wrote it          | Changed by the user                                                                                |
| ------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `owned`       | Replaced with the new version             | Kept; the new version goes to a whole-file sidecar                                                 |
| `blocks`      | The block is replaced in place            | The block is kept; the file's one sidecar holds the whole file with every such block updated       |
| `json`        | Kit entries are added, changed or removed | The diverged entry is kept and reported; a deleted entry goes to `removed[]` and is never re-added |
| `create-only` | Never replaced                            | Never replaced                                                                                     |

What counts as a change:

- **Always against `base`.** "Unchanged" and "unmodified" mean that the content on disk still hashes to `base`, the content the kit last wrote. User content never becomes a base, so a file or block with `base: null` is never unchanged: `update` never replaces it and `uninstall` never deletes it.
- **Nothing new, nothing written.** When the new kit content equals `base`, a user-modified file, block or entry is skipped, with no sidecar. That is why a second run writes nothing.
- **Adoption.** When the content on disk already equals the new kit content, `base` moves to it, and only the lock is written.
- **Sidecars keep the base.** Writing a sidecar leaves `base` at the last kit-written content and records the sidecar's content as `pending`. A sidecar that already holds the new kit content is left alone. An unedited sidecar is rewritten when the kit content changes again, and one the user edited is never overwritten; it is reported instead.
- **One sidecar per blocks file.** Blocks are judged one by one. In a file with both kinds, the unchanged blocks are still replaced in place, and the file's single sidecar holds the file as it now is with every user-edited block swapped for its new kit version. Each of those blocks records its own `pending`.
- **Resolving a sidecar.** The user takes what they want from the sidecar into the file, or copies it over the file, and deletes the sidecar. The next run finds `pending` with no sidecar on disk and moves `base` to `pending`. That kit version then counts as seen: it is never offered again, and the v0.2 merge starts from it. Kit changes the user never saw stay out of the base, so a merge can still bring them in.

The command-line contract (#40):

- `update --dry-run` prints a unified diff and writes nothing.
- `update --json` emits the plan in a documented schema.
- `update --check` exits 1 when anything would change. The dogfood self-check runs it (#46).
- `update --restore <path>` backs up the path, restores the kit content there from the current kit, and drops what it restored from `removed[]`:
  - A create-only doc, or an owned file listed in `removed[]`, is rewritten whole.
  - In a blocks file, only the removed blocks are re-inserted, and every byte outside them stays as it is.
  - In a json file, only the removed entries are re-added, through the same edits `update` makes.
- `update` exits 2 when it wrote sidecars, and lists them with a hint.

`uninstall` (#41) removes only what is still exactly as the kit wrote it, and backs up everything it touches first:

- It deletes unmodified kit files listed in the lock, unmodified managed blocks, unmodified kit-owned JSON entries, and sidecars that still match `pending`. A file the kit created that holds nothing else afterwards, such as a `settings.json` with only kit entries, goes too.
- It keeps and lists everything else: files and blocks the user modified, diverged JSON entries, and any file the user added to a kit folder. `--force` also removes the modified kit files and blocks it listed, after confirmation, and still backs them up first.
- It removes a kit folder, such as `BRAND.hookDir`, `BRAND.rulesDir`, a kit skill folder or `.archkeeper/base/`, only once that folder is empty.
- It deletes `lock.json`, `config.json` (even when hand-edited, since the backup keeps it) and the rest of `.archkeeper/`, except `local/backup/` and the self-ignoring `local/.gitignore`. Its own backup therefore survives without showing in `git status`, and it prints the backup's path. Deleting what is left of `.archkeeper/` is the user's call.

**v0.2 adds 3-way merges.** node-diff3 merges owned Markdown and managed blocks against the bases v0.1 already records. Conflicts are written diff3-style with the base inline (labels: yours / base / `archkeeper@<version>`), or as `.rej` files with `--conflict rej`. `.mjs` files keep sidecars, and JSON never gets markers. Because the base is inline, no skill needs to read `.archkeeper/base/`.

**Schema changes.** Until 0.1.0 is published, the shapes may change together with this ADR. After that, any change to the lock or config schema bumps its version (`lockfileVersion` for the lock, `version` for the config) and ships a migration; the migration chain lands in v0.2 M1. v1.0 freezes the schemas.

## Consequences

- v0.1 installs upgrade losslessly into v0.2's 3-way merge, because the bases are already recorded and committed.
- Every teammate's clone holds the bases, so anyone can run a 3-way update.
- Users see small binary blobs in diffs. `binary` keeps git from diffing or merging them as text, and `linguist-generated` hides them from GitHub's language stats and collapses them in reviews.
- Base and backup copies cannot be loaded as instructions or matched by Grep.
- The setup answers move from the lock (reference §7.2) to `config.json`, where users can read and edit them.
- A file the user deleted stays deleted until they ask for it back.
- A sidecar stays until the user deletes it, and deleting it is how they tell the kit they have seen that version.
- After `uninstall`, an ignored `.archkeeper/local/backup/` stays behind until the user deletes it, so the uninstall itself can be undone.
- The fast-check property "no user byte lost" (at least 1,000 runs) and the two-version e2e on the real tarball (#43) exercise this contract before 0.1.0 freezes it.
- After 0.1.0, every schema change costs a migration.

## Alternatives considered

- **Bases as plain mirrored files under their real names.** Claude Code would load them as stale `CLAUDE.md`, rules and skills, and they would show up in searches.
- **Plain files with a `.base` suffix.** Not discoverable, but still matched by Grep and duplicate checks.
- **State under `.claude/`.** That is Claude Code's own namespace, and nested `.claude/` folders are scanned for skills.
- **Answers only in the lock.** No user-editable record of intent.
- **Local, uncommitted bases.** Teammates cannot 3-way merge.
- **Overwrite with backups.** Loses trust.
- **3-way merge in v0.1.** Puts more risk into the first frozen contract.
