# Mistakes log — "don't try this again"

Record approaches that failed, so no session repeats them. Newest first.

Format: `- YYYY-MM-DD — <what we tried> → <what went wrong> → <what to do instead>`

- 2026-10-10 — Honouring the allow-secret pragma on any line a write contains → an agent can approve its own secret by adding the pragma to it → honour it only on a line already in the file on disk, and ask before every new marked line.
- 2026-10-10 — Judging a guard-secrets edit "outside the project" by a realpath prefix check, and then checking only its written text → a case-variant path, a firmlink spelling or a hardlink to a project file looked outside, so an edit completing a token skipped the replay → replay every edit on the real path wherever it is, and never decide inside or outside by path prefix.
- 2026-10-10 — Asking on every edit guard-secrets cannot replay, including every file outside the project → every edit to auto memory under `~/.claude/projects/` and to a symlinked `CLAUDE.md` prompted → read and replay those files through their real path too, so only new secret lines prompt.
- 2026-10-10 — Judging an edit by its `new_string` alone → an edit to part of a marked line, such as only its token, never shows that line → replay the edit on the file and judge the lines it leaves.
- 2026-10-10 — Reading an edit target with a plain `readFileSync` → a FIFO at the target hangs the hook until its timeout, which fails open → read through one `O_NOFOLLOW | O_NONBLOCK` descriptor after an `lstat` check, and ask when it is not a small regular file.
- 2026-10-10 — Secret regexes with an unbounded run before a required suffix, such as `\b[a-z][a-z0-9+.-]*://…@` → quadratic time on long runs (80 KB took 1.7 s), so a large edit timed the hook out and failed open → start such patterns at a lookbehind, bound the quantifiers, cap the scanned size, and keep a timing test.
- 2026-10-09 — Approving an npm staged publish with `! npm stage approve <id>` inside Claude Code → `EOTP`: `!` commands have no TTY, so npm can't prompt for the 2FA code → pass `--otp=<code>`, or run the command in a normal terminal when using a security key or passkey.
- 2026-10-09 — Pushing over SSH (`git@github.com:`) from the owner's machine → `Permission denied (publickey)` → use an HTTPS remote with the repo-local `gh auth git-credential` helper.
