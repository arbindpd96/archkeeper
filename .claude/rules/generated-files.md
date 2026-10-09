---
paths:
  - 'modules/**'
  - 'packs/**'
  - 'plugin/**'
---

# Rules for content we generate into users' projects

- Every generated file is declared in its module's manifest. Nothing is written without ownership tracking.
- Templates are deterministic: the same answers produce byte-identical output (snapshot-tested).
- Never write secrets. Reference tokens via `${ENV_VAR}` expansion or OAuth.
- Generated CLAUDE.md stays under 100 lines; push detail into `.claude/rules/` or skills.
- Generated hooks are dependency-free Node `.mjs`, registered in exec form (`"command": "node", "args": [...]`).
- Plugin and marketplace names must not start with `claude-` (Claude Code rejects them).
- Skill and agent frontmatter follows ADR-0015's allowlist: no `hooks` or `mcpServers`, `permissionMode` only `default` or `plan`, `allowed-tools` only `Read`, `Grep`, `Glob` and literal `Bash(<command>)` entries that name no shell, wrapper, interpreter or runner, and no `` !`cmd` `` in skill bodies.
- User-editable regions must survive `update`: use managed blocks or the lockfile merge, never overwrite.

## Hook security (lessons from the PR #1 security review)

- Never spawn through a shell (`shell: true`) or `.cmd` shims. Run `process.execPath` with a tool's JS entry file.
- Only touch files whose real path is inside the project. Refuse symlinks for anything the hook writes or injects into context.
- Guards decide on parsed commands (`shell-words.mjs`), never on regexes over raw text. They fail closed (`ask`) on errors or oversized input.
- The allow-secret pragma exempts only a line already in the file; guard-secrets replays each edit on the file and asks when the result holds a new marked line.
- A hook that runs project scripts (the Stop test check) ships only in the full preset, never in the plugin, which ships no hooks (ADR-0016). Run it with `--ignore-scripts` and no shell.
- The full hook contract and per-hook failure policy are in ADR-0015; the state dir, lock, strategies and sidecars are in ADR-0014.
