# ADR-0001: Project and package name is `claude-codekit`

- Status: superseded by [ADR-0010](0010-rename-to-archkeeper.md)
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)

## Context

The handoff used the working name "claude-kit" with `npx create-claude-kit`. On 2026-10-09:

- npm `create-claude-kit` is **taken** (trssoftware, v1.2.1, a similar "Claude Code configuration kits" CLI).
- npm `claude-kit` is free, but the name collides with our closest competitor, ajyadav013/claude-kit (PyPI `claude-code-kit`).
- npm `claude-codekit` is free.

## Decision

- npm package: `claude-codekit`; CLI usage `npx claude-codekit init`.
- GitHub repo: `arbindpd96/claude-codekit` (personal account, no organisation).
- Plugin name (Claude Code marketplace): `claude-codekit`.

## Consequences

- Docs, templates, managed-block markers and the lockfile directory use the `claude-codekit` slug.
- Reserve the npm name early (publish a 0.0.x placeholder) once the CLI skeleton exists.
- Check Anthropic's brand guidance for community projects that use "Claude" in their name (tracked in docs/research).

## Alternatives considered

- `claude-kit`: brand confusion with a direct competitor.
- `claude-keel`: memorable, but the README would have to explain the name.
- `@arbindpd96/claude-kit`: safe, but too long to type after `npx`.
