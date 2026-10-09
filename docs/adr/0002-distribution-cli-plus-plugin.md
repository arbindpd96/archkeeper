# ADR-0002: Ship as an npx CLI **and** a Claude Code plugin from one source of truth

- Status: accepted (DECIDED in handoff §4)
- Date: 2026-10-08
- Deciders: owner

## Context

Users need (a) per-project files scaffolded into their repo (CLAUDE.md, settings, docs) and (b) reusable commands/skills/agents/hooks that update independently of their repo.

## Decision

1. **npx CLI** (`claude-codekit`): `init`, `update`, `doctor`, `uninstall`. Detects stack, asks setup questions, writes files merge-safely.
2. **Claude Code plugin** (`claude-codekit`): bundled commands, skills, agents and hooks, published to a plugin marketplace hosted in this repo and to npm.
3. Generate **AGENTS.md** alongside CLAUDE.md so Codex, Cursor, Gemini CLI and Copilot get the same rules.

Both are built from the same `modules/` sources. Nothing is hand-maintained in two places.

## Consequences

- A build step must emit plugin assets from module sources, and CI checks that the plugin output is up to date.
- The CLI decides which content is "project-owned" (scaffolded and editable) and which is "plugin-owned" (updated by upgrading the plugin).
