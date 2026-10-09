# claude-codekit

> Claude never forgets your architecture, your decisions, or your design system.

**Status: pre-release, under active development. Nothing is published to npm yet.**

`claude-codekit` sets up a clean, powerful [Claude Code](https://code.claude.com) setup in any project with one command:

```bash
npx claude-codekit init   # not published yet
```

It gives Claude Code:

- **Codebase awareness.** A living architecture map (and optional code graph), so Claude reuses code instead of rewriting it.
- **Decision memory.** Per-feature memory files that survive long sessions and context compaction.
- **Clean code by default.** Big-tech coding standards enforced by linters and hooks, not just markdown.
- **Design-system sync.** Tokens and design decisions from Figma (or Penpot or Storybook), kept current.

Everything is built as switchable modules with `small` / `medium` / `full` presets, so small projects stay light.
It also generates `AGENTS.md`, so Codex, Cursor, Gemini CLI and Copilot follow the same rules.

## Project docs

- [Roadmap](docs/ROADMAP.md): phased build plan
- [Decisions](docs/decisions.md): architecture decision records
- [Original handoff](docs/HANDOFF.md)

## License

[MIT](LICENSE)
