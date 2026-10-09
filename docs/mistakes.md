# Mistakes log — "don't try this again"

Record approaches that failed, so no session repeats them. Newest first.

Format: `- YYYY-MM-DD — <what we tried> → <what went wrong> → <what to do instead>`

- 2026-10-09 — Approving an npm staged publish with `! npm stage approve <id>` inside Claude Code → `EOTP`: `!` commands have no TTY, so npm can't prompt for the 2FA code → pass `--otp=<code>`, or run the command in a normal terminal when using a security key or passkey.
- 2026-10-09 — Pushing over SSH (`git@github.com:`) from the owner's machine → `Permission denied (publickey)` → use an HTTPS remote with the repo-local `gh auth git-credential` helper.
