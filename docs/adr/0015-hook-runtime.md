# ADR-0015: Hook runtime and per-hook failure policy

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: none

## Context

Generated hooks run on every matching tool call, on macOS, Linux and Windows, in projects we have never seen.

- **Windows.** Exec form needs a real executable. npm `.cmd` and `.bat` shims fail, but `node.exe` works (reference §1.6).
- **Node may be missing.** The native Claude Code binary never invokes Node, so a Python-only teammate may have no `node` on PATH (reference §1.6).
- **Speed.** A Node hook takes about 35 ms locally (reference §7.1).
- **Exit codes.** Exit 0 means success and stdout JSON is read; exit 2 blocks and sends stderr to Claude; any other code, or invalid JSON, is a non-blocking error and the action proceeds (reference §1.5). A hook that crashes therefore fails open unless it catches its own errors.
- **Output limit.** Hook output over 10,000 characters is saved to a file instead of being injected (reference §1.5). SessionStart context is injected every session and counts toward each preset's always-on budget ([ADR-0017](0017-lightness-budgets.md)).
- **Parallel hooks.** Hooks on the same event run in parallel, and when several return `updatedInput` the last one to finish wins (reference §1.7).
- **Prefix-only rules.** Native Bash permission rules match on the command prefix only, so `Bash(git push --force:*)` does not catch `git push origin main -f` (reference §1.9).

This repo's hand-written hooks in `.claude/hooks/` were hardened in the PR #1 security review and again in #65 (PR #70). Those lessons are recorded in `.claude/rules/generated-files.md`:

- guard-secrets fails closed with `ask` (8ba364c).
- Formatters run without a shell and only on files inside the project (a62ff63).
- The stop check runs without a shell or npm lifecycle scripts (808f276).
- Hook state is confined to the project and symlinks are refused (ceb154e).
- `.env` reads are denied at any depth (a57a792).
- guard-bash first matched regexes against the raw command. That proved bypassable and could time out, which failed open, so it now tokenizes the command and judges the parsed commands (72efe48), hardened further in #65. It asks when it cannot load, cannot parse, or the command is longer than 8,000 characters.

R1 built the build side ([ADR-0011](0011-single-package.md)):

- tsdown turns each `src/hooks/<name>.ts` into a self-contained `dist/hooks/<name>.mjs` that may import only `node:` built-ins and may inline no npm package (`deps.onlyImport: []`, `deps.onlyBundle: []`).
- Lint allows hooks to import only `node:` built-ins and `src/hooks/runtime`.
- `budgets.json` caps each hook bundle at 30 kB.

## Decision

### Form

Hooks are TypeScript in `src/hooks`, bundled into zero-dependency `.mjs` files and installed under `BRAND.hookDir` (`.claude/hooks/archkeeper/`, [ADR-0012](0012-brand-constants.md)) as `owned` files ([ADR-0014](0014-on-disk-contract.md)). They are registered in exec form, never shell form:

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/archkeeper/<name>.mjs"],
  "timeout": 10
}
```

Placeholders in `args` are substituted as plain strings, so project paths with spaces need no quoting (reference §1.2).

### Runtime contract

`src/hooks/runtime` ports `.claude/hooks/lib.mjs`. Every hook:

- reads stdin JSON defensively: bad input becomes `{}`, missing fields are tolerated, and unverified fields such as the SessionStart `source` are read with a fallback (reference §12)
- answers with exit 0 plus JSON, or exit 2 plus stderr, never both
- never touches the network ([ADR-0018](0018-offline-no-telemetry.md))
- keeps state only under `.archkeeper/local/` (ADR-0014): every folder on the way must resolve inside the project and must not be a symlink, files are opened without following symlinks and created with mode `0600`, and a refused write is skipped and reported, never redirected
- reads or injects into context only files whose real path is inside the project and that are not symlinks
- runs child processes with `execFile` and argument arrays, never through a shell:
  - Node tools through `process.execPath` and the tool's JS entry file
  - npm scripts through npm's own JS entry with `--ignore-scripts`
  - Python tools from `.venv` or PATH, as real executables
  - never `npx`, a network install, or a `.cmd` or `.bat` shim
- reports paths with forward slashes on every OS
- never returns `updatedInput`
- supports `--self-test`, which runs embedded sample payloads; `doctor` and the e2e use it

### Failure policy, per hook

A crash lets the action proceed (reference §1.5), so each hook declares what it does when it cannot do its job:

| Hook                       | Event                                             | When it cannot do its job                                                                      |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| guard-bash                 | PreToolUse `Bash`                                 | Fails closed with `ask`: load errors, crashes, unparseable commands, commands over 8,000 chars |
| guard-secrets              | PreToolUse `Write\|Edit\|MultiEdit\|NotebookEdit` | Fails closed with `ask`                                                                        |
| session-start, pre-compact | SessionStart, PreCompact                          | Fails open: exit 0 with a one-line note on stderr                                              |
| memory stop, stop check    | Stop                                              | Fails open: never blocks the stop                                                              |
| format-on-edit             | PostToolUse `Edit\|Write\|MultiEdit`              | Fails open; a missing tool is a silent no-op with a one-time hint                              |

Both guards fail closed because the backstop behind them is thin: deny rules are prefix-only, and a secret that reaches a commit cannot be taken back.

### Guards

- **guard-bash decides on parsed commands, never on regexes over raw text.** It tokenizes quotes, escapes, here-documents, substitutions and brace expansion within a work budget, unwraps wrappers such as `sudo`, `env`, `xargs` and `bash -c`, and judges each simple command. When a case is ambiguous it asks rather than denies.
- **guard-secrets** scans every string a write would put into a file, denies likely secrets with a reason that names the rule and the file but never the value, and asks before editing `.env`, `.env.*` or `.envrc`, except templates such as `.env.example`. An `archkeeper:allow-secret` pragma exempts one line.
- **Repo-specific policies** such as `blockAiAttribution` and `blockNoVerify` are module options, off by default.

### Deny rules

The safety module is in every preset. Besides registering the guards, it writes these `permissions.deny` rules, each owned by its exact string (ADR-0014):

- `Read(**/.env)`, `Read(**/.env.*)`, `Read(**/.envrc)`
- `Bash(rm -rf:*)`
- `Bash(git push --force:*)`, `Bash(git push -f:*)`

The rules are defence in depth: they still apply when a hook cannot run.

- They match on prefix only, so the guards are the fine-grained layer for everything the rules let through.
- `Bash(rm -rf:*)` is coarser than guard-bash: it denies every command that starts with `rm -rf`, safe ones such as `rm -rf dist` included, before the guard sees it (see [Consequences](#consequences)).
- `Read(**/.env.*)` also blocks reading `.env.example` with the Read tool, while guard-bash lets the shell read it.

The AGENTS.md block and the README must say all three.

### Injected context and feedback

- SessionStart `additionalContext` is capped at 1,200 / 3,000 / 4,000 characters for small / medium / full, far below the 10,000-character limit.
- At the cap it keeps content in a fixed priority order: Next step, Goal, the last 5 Decisions, the compact snapshot (at most 20 lines), then the architecture Overview (medium and full).
- Per-event feedback, such as lint errors and stop-check failures, is capped at 40 lines.

### Generated settings

Generated settings always carry the SchemaStore `$schema` (set only when absent). They never contain `once`, `if` on a non-tool event, `permissions.defaultMode`, `autoMode`, a model id or `enabledMcpServers` (reference §1.2, §1.9, §11, §12). A static test checks every preset × stack output.

### Stop hooks

- Stop hooks return at once when `stop_hook_active` is set.
- They block at most once per change set, identified by a fingerprint of the working tree.
- The memory nudge needs an active feature.
- The stop check runs project scripts, so it ships only in the full preset. It is written into the project and never into the plugin ([ADR-0016](0016-delivery-split.md)), and it runs with `--ignore-scripts` and no shell.

### Budgets

These are part of the ADR-0017 contract:

- Each bundle is 30 kB or less. This is enforced from `budgets.json` since R1.
- p95 latency is 200 ms or less per hook on ubuntu CI, with formatter time excluded. Windows is reported, not gated. This budget joins `budgets.json` with the hook runtime (v0.1 M4).

## Consequences

- Hooks need `node` on PATH, within the `engines.node` range (ADR-0011).
  - Without it, every hook fails without blocking, guards included; only the deny rules still apply.
  - The README Requirements section states this, and `doctor` checks it.
- Kit hooks merge with user hooks by `args` path (ADR-0014). User hooks on the same events keep running, because hook arrays are additive (reference §1.8).
- The guards cost an occasional extra prompt on commands they cannot read. False-positive suites and asking rather than denying keep that rare.
- Claude cannot run any command that starts with `rm -rf`, because the native rule denies it before guard-bash judges it. The user runs it, and other spellings such as `rm -r dist` go to guard-bash. #31's rule that safe look-alikes pass applies to guard-bash alone. A user who wants Claude to run `rm -rf` deletes the rule, and `update` never adds it back (ADR-0014).
- Repo-specific policies are off by default; this repo turns them on.
- SessionStart output counts toward each preset's always-on budget at its cap (ADR-0017).
- The hooks in this repo's `.claude/hooks/` stay the reference implementation until v0.1 M8 replaces them with generated ones (#45).

## Alternatives considered

- **Bash hooks with jq.** Not Windows-safe.
- **Python hooks.** Slower, and interpreters vary.
- **Compiled binaries.** About 62 MB per platform.
- **Shell-form hooks.** Paths with spaces need quoting, and Windows runs them through Git Bash or PowerShell, whichever is present (reference §1.6).
- **Fail open everywhere.** Regresses the guard-secrets hardening.
- **guard-bash failing open with a stderr note** (the earlier draft, and #31), relying on the deny rules. Prefix-only rules miss reordered flags, chains and wrappers, so a guard that cannot read a command would silently allow it.
- **Regex guards over the raw command text.** Bypassable through quoting, wrappers and chains, and slow inputs time out, which fails open (72efe48).
- **Root-only `Read(./.env)` rules.** Miss nested `.env` files.
- **Exact native rules such as `Bash(rm -rf /)` instead of `Bash(rm -rf:*)`.** They miss every variant, so they would protect nothing once a hook cannot run.
- **One global SessionStart cap of 9,000–10,000 characters.** On its own, it would exceed the small preset's whole budget.
