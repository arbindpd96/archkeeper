# ADR-0001: Run the tests with Vitest

- Status: accepted
- Date: 2026-09-14
- Deciders: the maintainers

## Context

The code is TypeScript in ES modules (`"type": "module"`). Jest needed a transform and an experimental Node.js flag to run it, and that setup drifted from `tsconfig.json`.

## Decision

Vitest runs the tests. It runs the TypeScript sources and their ES modules as they are, with no separate transform to keep in step with `tsconfig.json`.

## Consequences

Tests start quickly and need no build first. Plugins written only for Jest cannot be used.

## Alternatives considered

- Jest with ts-jest: a second TypeScript setup to maintain, and ES modules only behind an experimental flag.
