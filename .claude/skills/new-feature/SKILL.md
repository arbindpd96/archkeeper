---
name: new-feature
description: Start a new feature with its own working memory file and branch. Use when the user begins work on something not yet tracked in docs/features/.
disable-model-invocation: true
argument-hint: <feature-name>
---

Start the feature `$ARGUMENTS`.

1. Normalise the name to kebab-case. If `docs/features/<name>/` already exists, read its MEMORY.md and resume instead.
2. Copy `docs/features/_template/MEMORY.md` to `docs/features/<name>/MEMORY.md`. Fill in:
   - `Status: in progress | Branch: feat/<name>`
   - **Goal**: ask the user what "done" means if it is not obvious, in 1–2 lines.
3. Create and switch to branch `feat/<name>` from an up-to-date `main`.
4. Read `docs/architecture.md` and list the existing code this feature should reuse under **Open questions** or **Next step**.
5. Commit the memory file alone: `docs(<name>): start feature memory`.
6. Tell the user the goal, the branch, and the first next step.
