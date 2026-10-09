# ADR-0006: v0.1 supports TypeScript/JavaScript and Python

- Status: accepted
- Date: 2026-10-09
- Deciders: owner

## Decision

Stack detection, lint/format hooks and code-standards packs ship first for:

- **TS/JS**: Node, React, Next.js. ESLint/Prettier or Biome, tsc, vitest/jest.
- **Python**: ruff (lint+format), mypy/pyright, pytest. Django/FastAPI detection.

Go, Rust, Java, Swift, Kotlin and Dart come later as language packs (v0.5+).

## Consequences

The pack interface must be general enough that adding Go or Rust later is purely additive.
