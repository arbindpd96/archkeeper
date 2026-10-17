---
name: handoff
description: Save this session's progress to the active feature's MEMORY.md so the next session resumes where this one stopped. Use before ending a session or compacting, or when a hook asks for a memory update.
---

Save this session's progress in the active feature's memory, editing only its MEMORY.md and `docs/mistakes.md`.

1. Find the active feature. It is the one named in `{{brand.stateDir}}/local/active-feature`, if that file holds one kebab-case name (lowercase letters, digits and single hyphens) and its `docs/features/<name>/MEMORY.md` says `Status: in progress`. Otherwise it is the only MEMORY.md in a kebab-case folder of `docs/features/` that says so, which leaves out `docs/features/_template/`. If several say so, ask which one. If none does, offer `/new-feature <name>` and stop.
2. Read the file fully, then update it:
   - **Done**: tick what is finished, add new finished items as `- [x]` and keep open ones as `- [ ]`.
   - **Next step**: the single exact next action, naming the file, function or command, so a new session starts without asking.
   - **Decisions**: append each decision made this session as `- YYYY-MM-DD: <decision>. Why: <reason>.` Never change or drop an earlier one.
   - **Gotchas / don't try again**: what failed and why. If others could hit it too, add it to `docs/mistakes.md` as well.
   - **Open questions**: add new ones and remove the ones answered.
3. Keep the file at 80 lines or fewer by merging old Done items into one line each.
4. When the goal is met, set `Status: done`.
5. Show the user three lines: what was done, what is next, and any open question.
