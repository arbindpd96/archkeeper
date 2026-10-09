# Feature: v0.1-m2-apply

Status: done, ready for review | Branch: feat/v0.1-m2-apply

## Goal

v0.1 milestone M2 (issues #21, #22, #23, #24): turn M1's render tree, a snapshot of the project and the lock into a pure, reviewable plan; merge into blocks, json, owned and create-only files without losing a user byte; refuse every unsafe path; and apply the plan transactionally with a backup, compressed base blobs, lockfile v1 written last and a full rollback. Done means every acceptance criterion in the four issues holds (ADR-0014 wins where an issue differs), a second plan against the applied state holds only `skip` operations, and `npm run check` is green.

## Decisions (never undo without asking)

- 2026-10-10: Start from the issue texts, their R3 and M1 comments and ADR-0014; where an issue and the ADR differ, the ADR wins. Why: the milestone brief and the comments on #22, #23 and #24.
- 2026-10-10: The planner and every strategy's merge are pure functions in `src/core`; the transactional apply lives in `src/cli` (`project-files`, `atomic-files`, `blob-store`, `backup`, `apply`, `install`), and ESLint now keeps `node:zlib` out of `src/core` (fixture `imports-node-zlib.ts`). Why: the apply is file-system work by nature, so injecting file operations into core would be an interface with one implementation; core keeps everything worth testing purely (the plan carries the bytes to write and the next lock), and the CLI only executes. The brief allowed either; the layer lint stays green.
- 2026-10-10: `planInstall(tree, snapshot, lock, context)` takes a fourth argument, `{kit, modules, brand?, ownable?}`. Why: the lock records the kit and the modules (ADR-0014) and the brand names the markers, sidecars and state folder; #21's three arguments have nowhere else to get them.
- 2026-10-10: The operations are exactly #21's nine kinds. Rewriting an owned file unchanged since the kit wrote it is a `create` (it writes the kit's whole file); removing a block or entry the kit no longer writes, or forgetting one already gone, is a `delete`; a skip that still moves a lock entry, such as a sidecar the user resolved, is reported as `adopt`. Why: #21 lists the kinds; each kind says what the apply does.
- 2026-10-10: A plan holds `ops`, `writes` (the final bytes of each path, sidecars included, `null` to delete), `lock`, `lockText` and `blobs` (kit content by hash for every base and pending the next lock references). Why: the apply needs no merge logic, and idempotency can be proven without IO (`applied()` in `test/plan-fixtures.ts`).
- 2026-10-10: One regex, `markerPattern(brand)`: `<prefix>:(begin|end)` for the brand and its legacy slugs, in any case with Unicode case folding (`iu`). `render` refuses a value (and now a rendered block) that matches it, and the parser reads every line that matches it as a marker, which must then be a whole marker line in the file's style (lower case, single spaces, trailing blanks allowed) or the run aborts naming the line. Why: the M1 security comment on #22; no value can open or close a block, and a near-miss in a user's file is reported rather than silently treated as text.
- 2026-10-10: Marker style follows the file: `.md`, `.mdx` and `.markdown` take `<!-- -->` markers, every other blocks file `#` markers. Why: ADR-0014 names Markdown and `.gitignore`/`.gitattributes`; `#` comments suit most config files a later module might co-own.
- 2026-10-10: "The CLAUDE.md import block goes first" is implemented as: a new block whose non-blank lines are all `@` imports goes at the top of its file followed by a blank line; any other new block is appended after a blank line; existing blocks never move. Why: it needs no new manifest field, and only the import block has that shape.
- 2026-10-10: New and replaced blocks take the file's line endings and keep its byte-order mark; an owned file unchanged since the kit wrote it is rewritten with CRLF when it had CRLF. Why: an autocrlf checkout must not turn into a whole-file diff; hashes are LF-normalised anyway.
- 2026-10-10: The lock's `files` holds owned and create-only files (a create-only `base` is a hash with no blob); co-owned files live only in `blocks` and `json`. In memory every record is a `Map`, built from the `JSON.parse` output once the schema accepts it, so a `__proto__` path stays data. JSON keys must match `JSON_KEY` (`$schema`, a permission rule, a hook by event and script path, an MCP server), so a crafted lock cannot name another JSON path. Why: ADR-0014's lock shape and its untrusted-lock rules.
- 2026-10-10: `$schema` is an owned key of `.claude/settings.json` only, set to `https://json.schemastore.org/claude-code-settings.json` (reference §1.8, §11); `.mcp.json` gets none, as §5.1 names no schema. A `$schema` the user set stays theirs. Why: "set only when absent", and uninstall (M7) must know the kit added it to leave a user's file deep-equal.
- 2026-10-10: A JSON entry's hash is the sha256 of its canonical JSON (sorted keys, no whitespace), so reformatting is not a divergence. Kit entries go in render order after `$schema`; edits use the file's indentation and line endings. The user's file may hold comments and trailing commas; malformed JSON, or a container that is not a list or object where the kit adds an entry, throws MergeError with the line and column of the user's text, checked before any edit. Why: #22 and ADR-0014; the line must point into the file the user sees.
- 2026-10-10: A hook entry is added only when the next lock gives its script a non-null base, so JSON files are planned after every other file. Why: ADR-0014, "a hook script with `base: null` is not registered in settings".
- 2026-10-10: The planner adds the kit's own `.gitattributes` block `base-blobs` (`<state dir>/base/** binary linguist-generated`) to every tree, as module `brand.binName`; a module that writes `.gitattributes` another way or uses that block id is a RenderError. Why: #24 requires the block whenever blobs exist, and every install writes blobs.
- 2026-10-10: The untrusted lock: every lock path passes path safety in the schema, the planner and `confinedPath`; a lock entry may not name the state folder; nothing outside the rendered tree is deleted unless the caller's `ownable(path, entry)` says the current kit could own it (by default nothing), and other lock-only entries are kept and reported. Why: ADR-0014, "the kit deletes, replaces or migrates only paths that the current kit's manifests could own". M7 builds `ownable` from the catalog and retired files.
- 2026-10-10: The planner never deletes a create-only file, even when the kit stops writing it; a different file found at a create-only path is skipped with no lock entry; a file the user deleted at an owned path with `base: null` is written again as the kit's. Why: create-only files are never touched again (uninstall decides in M7); `base: null` means the kit never wrote it, as the JSON rule for entries the user deletes.
- 2026-10-10: Path safety (#23) is lexical in core (`pathSafetyProblem`: UNC, absolute, drive, `..`, `\`, `:`, control characters, `.git` and `GIT~<n>` in any case, device names with any extension or before a space, trailing dot or space, then portable ASCII) and real in the CLI (`confinedPath`: the realpath of the deepest existing ancestor must lie inside the real root, and the resolved path must pass the same checks, so a symlink into `.git` is refused too). A symlinked folder that stays inside the project may be written through; a symlinked target never is. Refusals throw PathSafetyError before any write. Why: ADR-0014 refuses only links that leave the project or reach `.git`.
- 2026-10-10: The snapshot reads with `lstat` and `O_NOFOLLOW | O_NONBLOCK`; a symlink, folder, FIFO or file that is not UTF-8 text counts as not a text file and gets a sidecar. Why: such a file cannot be merged without changing its bytes, and a FIFO must not hang the run.
- 2026-10-10: The apply runs: backup (creating `local/` with its `.gitignore` first), absent blobs, files in plan order, then the lock only when its bytes differ; after the lock it removes unreferenced blobs and all but the last 3 backup runs, reporting failures as warnings. Any failure restores every path from the in-memory backup (file, symlink or absent), removes the folders the run created and throws ApplyError naming the file and the backup; a failure before the backup is complete changes nothing in the project. Why: #24 and ADR-0014; pruning after the lock means a crash never leaves a lock that names a deleted blob.
- 2026-10-10: A plan records `expected`, the sha256 of the exact bytes (or null when absent) of each path it writes as the snapshot saw it, and the apply refuses with ApplyError, writing nothing, when a path no longer matches. Why: M3's `init` shows the plan and waits for a yes, and a file the user saves in between would otherwise get bytes merged from its older content.
- 2026-10-10: Backups: blobs named by the sha256 of the exact bytes (not LF content), gzip, mode 0600, in a 0700 run folder `<UTC stamp>-<8 hex>`; `manifest.json` records each path's type, blob and mode, or symlink target. Why: a restore must be byte-identical, which LF names cannot promise for two files that differ only in CR.
- 2026-10-10: Base blobs are gzip with the header's OS byte set to 0xff, decompressed with `maxOutputLength` 1 MiB and checked against their name (`readBlob`). Why: the same blob bytes on every OS, and ADR-0014's gzip-bomb rule.
- 2026-10-10: Writes go to `.<name>.<12 hex>.tmp` opened `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` (where defined), flushed and renamed; the mode of a replaced file is kept; rename retries EPERM and EBUSY six times with backoff (10 to 320 ms) on every platform. Why: #24 and ADR-0014; one tested path rather than a Windows-only branch.
- 2026-10-10: A conflicted lock is split into its two sides (a diff3 base section is dropped); a side that is not a valid lock on its own is dropped, but a side from a newer kit still refuses to run. `rebuildLock` takes each entry from the newer kit's side (the first on a tie), unites `removed[]`, and rebases an entry whose content on disk hashes to an existing blob or to a hash either side recorded; JSON keys are only united. With no readable side the plan starts as on first contact. Why: ADR-0014's rebuild rules; anything unclear ends as a sidecar, never a lost byte.
- 2026-10-10: fast-check was already a devDependency (M1's render properties), so #21's "add fast-check" needs no new dependency; it now drives the planner idempotency property (500 runs) and the no-user-line-lost property (1,000 runs). Why: no new package, so no `npm ci`.
- 2026-10-10: No new ADR. Why: every choice above refines ADR-0011 or ADR-0014 without changing them; `docs/decisions.md` lists the larger ones.

## Measured sizes (ADR-0017)

| Item                                        | Before M2               | After M2                | Budget |
| ------------------------------------------- | ----------------------- | ----------------------- | ------ |
| `dist/cli.mjs`                              | 133.3 kB (32.8 kB gzip) | 133.7 kB (32.9 kB gzip) | none   |
| Tarball                                     | 41.3 kB                 | 42.2 kB                 | 300 kB |
| Unpacked                                    | 172.4 kB                | 178.3 kB                |        |
| Files in the package                        | 15                      | 16 (`lock.schema.json`) |        |
| Runtime dependencies                        | 0                       | 0                       | 0      |
| Probe bundle: `render` + `install` (for M3) | n/a                     | 231.8 kB (59.2 kB gzip) |        |
| of which `src/`                             |                         | 130.8 kB                |        |
| of which zod (`zod/mini`)                   |                         | 56.0 kB                 |        |
| of which jsonc-parser (now with `modify`)   |                         | 41.8 kB                 |        |

No command imports the engine yet, so `dist/cli.mjs` barely moves; the probe (built with the same tsdown options from an entry in the session scratchpad) shows what M3's `init` will add: about 26 kB of gzip to the tarball, well inside the 300 kB budget. Region sizes are the unminified `//#region` sums.

## Done

- [x] Feature memory (b27e264)
- [x] #23 lexical path safety and PathSafetyError (1917c78)
- [x] #22 one marker regex for render and the parser; blocks parser and editor with CRLF and BOM (fd9eafd)
- [x] #24 lockfile v1 schema, reader, serialiser, versions and conflict sides; `schema/lock.schema.json` (72aa4c6)
- [x] #22 owned, create-only, blocks and json strategies with tests (0e51a40)
- [x] #21 pure planner, idempotency and no-user-line-lost properties (6b26b9d)
- [x] Conflicted lock rebuild (0655203); hooks only for kit scripts (3efd30c); no lock entry in the state folder (f81a0cf); `node:zlib` lint (2f18e43)
- [x] #23/#24 CLI: confined paths, atomic writes with retries, blobs, backups, transactional apply, rollback at every rename, snapshots of a fresh and a first-contact install, second run writes nothing (cc2bf62); ripgrep check (d5eea67); only `local/` private (b1f13bd)
- [x] `docs/architecture.md` (0dce695), `docs/decisions.md`, `docs/mistakes.md`, ROADMAP M2 ticked (6e13aad), changeset (02fbcf4).
- [x] Stale plans refused: the apply writes nothing over a file edited since planning (47ed64f); the coordinator's subagent kept the caller's git variables out of the tests' git children (eb7a557); the incident and the check are logged (9ffead4).
- [x] `npm run check` green on each of the 20 commits from b27e264 to 9ffead4, each one checked out in a plain shell with git's repository variables unset.

## Next step

Run the `reviewer` and `security-reviewer` agents on the full diff (`git diff origin/main...feat/v0.1-m2-apply`) and answer every finding; the coordinator then pushes and opens the M2 PR (closes #21, #22, #23, #24). Confirm the Windows leg of CI runs the symlink, CRLF and rename tests green. Then start M3 with `/new-feature v0.1-m3-init`: `init` calls `install(root, render(...), {kit, modules})` from `src/cli/install.ts` and prints `plan.ops`.

## Gotchas / don't try again

- Never run the test suite under `git rebase --exec` (or from a git hook). Git exports `GIT_DIR` and friends to the command; on 2026-10-10 a test's `git init` inherited them, re-initialised this repository and set `core.bare = true` in the shared `.git/config` (restored to `false`; no ref moved). The coordinator's subagent changed the test helpers so no child git gets the caller's git variables. To check every commit, check each one out in a plain shell and run `npm run check` there.

- Prettier splits a long `if (x) return y;` over two lines, and then ESLint's `curly: multi-line` fails: run `eslint --fix` after Prettier, or write the braces.
- ESLint's `complexity` counts `?.` and `??`: copy a lock entry into plain values (`base`, `pending`) before branching on them.
- `@types/node` declares `constants.O_NOFOLLOW` as always defined, though Windows has none; read it through `Partial<typeof constants>` (`NO_FOLLOW` in `src/cli/project-files.ts`).
- jsonc-parser `modify` reformats the container it edits, even a user's one-line `"deny": [...]` (reference §7.1). No value changes or moves, so it stays within #22, but expect it in diffs.
- `vi.mock('node:fs', …)` with `renameSync: vi.fn(actual.renameSync)` is the fault injector for the rollback tests; reset the implementation in `afterEach`.
- `test/__snapshots__/**` is stored with LF, so `projectText` writes each CR as `<CR>`.
- The worktree's shell guard refuses heredocs that hold backticks; write scripts to the session scratchpad and run them from there.

## Open questions

- A kit folder that is a symlink to outside the project, as in a dotfiles setup where `.claude` links to `~/dotfiles/claude`, makes `install` refuse with PathSafetyError before writing anything. ADR-0014 refuses such targets; M3 should confirm that aborting (rather than skipping those paths with a report) is the experience the owner wants.
- A run killed outright (not an error) after writing JSON entries but before the lock leaves those entries unowned, so the next run treats them as the user's and uninstall keeps them. Recovering from the newest backup manifest would fix it; left for M7.
- `update --check` (M7) must compare `lockText` as well as `ops`: a new kit version alone changes only the lock.
- The Windows behaviour of the rename retry is proven with an injected rename; a real EPERM only happens on the Windows CI leg. Symlink tests skip where the runner cannot create symlinks (`canSymlink`).
