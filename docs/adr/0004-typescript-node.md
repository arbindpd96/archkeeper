# ADR-0004: Implement in TypeScript on Node.js

- Status: accepted
- Date: 2026-10-09
- Deciders: owner

## Context
Distribution is npx-first (ADR-0002). Claude Code's ecosystem (plugins, MCP SDK) is mostly JS/TS.

## Decision
TypeScript (strict) on Node.js LTS. Hook scripts we generate are dependency-free Node `.mjs` files, so they work on macOS, Linux and Windows without bash. The exact toolchain is recorded in a later ADR after research.

## Consequences
- The CLI and generated hooks require Node, which every user of npx already has.
- Python projects also get Node hooks. Language-specific linters (ruff, etc.) are called from those hooks.
