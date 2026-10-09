---
paths:
  - '**/*.ts'
  - '**/*.mts'
---

# TypeScript rules

- ESM only, `node:` prefix for built-ins, named exports (no default exports).
- Exported functions declare explicit parameter and return types; never `any` (use `unknown` and narrow).
- Validate anything read from disk, the user, or the network with a zod schema at the boundary; trust types inside.
- Keep `src/core` pure: no `process.exit`, no console output, no prompts. The CLI layer owns IO (ESLint enforces it).
- Prefer small pure functions over classes. Use a class only when it owns state with invariants.
- Errors: throw `ArchkeeperError` subclasses with a message that tells the user what to do next.
