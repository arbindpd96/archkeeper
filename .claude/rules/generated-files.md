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
