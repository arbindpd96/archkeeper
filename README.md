# archkeeper

> Your AI coding agent never forgets your architecture, your decisions, or your design system.

[![CI](https://github.com/arbindpd96/archkeeper/actions/workflows/ci.yml/badge.svg)](https://github.com/arbindpd96/archkeeper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Status: pre-release.** Nothing is published to npm yet. Follow the [roadmap](docs/ROADMAP.md).

One command gives your project a clean, enforced setup for [Claude Code](https://code.claude.com), plus `AGENTS.md` for Codex, Cursor, Gemini CLI and Copilot:

```bash
npx archkeeper init   # coming in v0.1
```

## What it gives your agent

|                           |                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Codebase awareness**    | A living architecture map (and an optional code graph), so the agent reuses code instead of rewriting it. |
| **Decision memory**       | Per-feature memory files that survive long sessions and context compaction.                               |
| **Clean code by default** | Big-tech coding standards enforced by linters and hooks, not just markdown.                               |
| **Design-system sync**    | Tokens and design decisions from Figma (or Penpot or Storybook), kept current.                            |
| **Safe by default**       | Guards against dangerous commands and leaked secrets. Updates never overwrite your edits.                 |

Features are switchable modules with `small`, `medium` and `full` presets, so small projects stay light.

## Demos

Each feature gets a short demo here when it ships.

## Project docs

- [Roadmap](docs/ROADMAP.md): the phased build plan
- [Architecture](docs/architecture.md): how the code is laid out
- [Decisions](docs/decisions.md): why things are the way they are
- [Contributing](CONTRIBUTING.md): setup, standards and workflow

## License

[MIT](LICENSE). Independent community project; not affiliated with, endorsed by, or sponsored by Anthropic.
Claude and Claude Code are trademarks of Anthropic, PBC.
