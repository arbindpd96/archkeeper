---
name: new-feature
description: Start a feature with its own MEMORY.md, copied from the template, and make it the active feature.
disable-model-invocation: true
---

Start the feature named in `$ARGUMENTS`. If no name was given, ask for one.

1. Turn the name into kebab-case: lowercase letters, digits and single hyphens. If `docs/features/<name>/MEMORY.md` already exists, read it fully and resume that feature instead: set `Status: in progress` if it says otherwise, then go to step 4.
2. Ask the user what "done" means for this feature, in one or two lines, unless the request already says. If the current git branch is the default branch, offer to create a branch for the feature first.
3. Copy `docs/features/_template/MEMORY.md` to `docs/features/<name>/MEMORY.md`. Fill in the title (`# Feature: <name>`), `Status: in progress | Branch: <branch>` with the current git branch, the **Goal**, and the first concrete action under **Next step**. If the template is missing, write its sections yourself: Goal, Decisions (never undo without asking), Done, Next step, Gotchas / don't try again, and Open questions.
4. Make it the active feature: write `<name>` as the only line of `{{brand.stateDir}}/local/active-feature`. That folder is never committed, so if `{{brand.stateDir}}/local/.gitignore` is missing, write it first with the single line `*`.
5. Search the codebase for code this feature should reuse, and note it under **Next step** or **Open questions**.
6. Tell the user the goal, the branch and the next step.
