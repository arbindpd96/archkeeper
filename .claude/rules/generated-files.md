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
- User-editable regions must survive `update`: use managed blocks or the lockfile merge, never overwrite.

## Hook security (lessons from the PR #1 security review)

- Never spawn through a shell (`shell: true`) or `.cmd` shims. Run `process.execPath` with a tool's JS entry file.
- Only touch files whose real path is inside the project. Refuse symlinks for anything the hook writes or injects into context.
- Guards decide on parsed commands (`shell-words.mjs`), never on regexes over raw text. They fail closed (`ask`) on errors or oversized input.
- A hook that runs project scripts (the Stop test guard) must be opt-in per project when it ships in the plugin. Run it with `--ignore-scripts` and no shell.
