---
name: why
description: Explain why something is the way it is by searching recorded decisions. Use when the user (or you) asks why a choice was made, or before changing an established pattern.
argument-hint: <topic>
---

Answer "why `$ARGUMENTS`?" from the project's recorded knowledge only.

1. Search, in order: `docs/decisions.md`, `docs/adr/*.md`, `docs/features/*/MEMORY.md` (Decisions sections), `docs/mistakes.md`,
   `docs/HANDOFF.md`, then `git log --grep`.
2. Answer in 2–5 sentences, citing each source as `path:line` (or commit hash).
3. If nothing is recorded, say so plainly and offer to record the answer with `/adr` once the maintainer decides.
