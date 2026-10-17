---
name: why
description: Explain why the project is the way it is from its recorded decisions, citing each source by path and line. Use when someone asks why something was chosen, or before changing an established pattern.
---

Answer "why $ARGUMENTS?" from the project's records only. If no topic was given, ask for one.

1. Search these in order, skipping any that do not exist:
   - `docs/decisions.md` and the ADRs in `docs/adr/`
   - the **Decisions** sections of `docs/features/*/MEMORY.md`
   - `docs/mistakes.md`
   - the commit history: `git log --grep=<keyword> -i --oneline` for each keyword, trying a synonym or two
2. Answer in two to five sentences. Cite each source as `path:line`, or a commit by its short hash.
3. If nothing is recorded, say so plainly instead of guessing a reason, and offer to record the answer with `/adr <title>` once the user decides.
