---
paths:
  - '.claude/hooks/**'
  - 'modules/**/hooks/**'
---

# Hook script rules

- Read the payload from stdin as JSON; tolerate missing fields. Never crash on bad input.
- Fast: under 1 second for SessionStart, PreToolUse and PostToolUse. Only Stop may run tests.
- Respond with the documented JSON shape (`hookSpecificOutput.permissionDecision`, `additionalContext`, `decision: "block"`).
- A Stop hook must check `stop_hook_active` so it cannot loop.
- Write state only under `.claude/state/` (gitignored).
- Test every rule with sample payloads (see `scripts/` and the hooks tests) before committing.
