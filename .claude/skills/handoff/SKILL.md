---
name: handoff
description: Save session progress into the active feature's MEMORY.md so the next session (or post-compaction context) resumes instantly. Use before ending a session, before /compact, or when the Stop hook asks for a memory update.
---

Update the active feature memory (`docs/features/<feature>/MEMORY.md` with `Status: in progress`). If several are active, ask which.

1. **Done**: tick finished items; add new finished items as `- [x]`. Keep open items as `- [ ]`.
2. **Next step**: the single exact next action (file, function, command) so a fresh session can start without asking.
3. **Decisions**: append any decision made this session as `- YYYY-MM-DD: <decision>. Why: <reason>.` Promote project-wide ones to an ADR (`/adr`).
4. **Gotchas**: record anything that failed and why. Also add it to `docs/mistakes.md` if others could hit it.
5. Keep the file under ~80 lines: summarise old Done items into one line each when it grows.
6. Show the user a 3-line summary: what was done, what is next, any open question.
