---
'archkeeper': minor
---

Add `init`: it detects a TS/JS or Python project's stack (package manager, formatters, linters, type checkers, test runners and commands), shows the plan grouped as create, modify, conflict and skip, asks, and writes CLAUDE.md importing AGENTS.md, an AGENTS.md block with the project's commands, ignore rules for local files and `.archkeeper/config.json`, never touching the user's own text. `--dry-run` prints a unified diff, and `--yes`, `--json` or CI run it without questions. The CLI now has `--cwd`, `--yes`, `--json` and `--debug`, one-line errors with a `Try:` fix, and exit codes 0, 1 and 2.
