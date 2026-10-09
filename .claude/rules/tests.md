---
paths:
  - "**/*.test.ts"
  - "**/test/**"
---

# Test rules

- Vitest. Test behaviour through public functions, not internals.
- File-writing code is tested against a fresh temp directory; assert the resulting tree (snapshot) and re-run for idempotency.
- No network, no real home directory, no reliance on test order.
- One behaviour per test; the test name states the expected behaviour.
