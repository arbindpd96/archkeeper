---
'archkeeper': patch
---

`init` detects an existing `@AGENTS.md` import in CLAUDE.md with Claude Code's own import rules and the same Markdown lexer version, so it never wrongly leaves out its import, and it gives up quickly on input that would be slow to read. A new import block now goes after YAML frontmatter.
