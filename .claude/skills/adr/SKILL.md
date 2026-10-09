---
name: adr
description: Record an architecture decision as a numbered ADR and add it to the decision log.
disable-model-invocation: true
argument-hint: <decision title>
---

Record the decision: `$ARGUMENTS`.

1. Find the highest number in `docs/adr/` and use the next one (4 digits).
2. Copy `docs/adr/0000-template.md` to `docs/adr/NNNN-<kebab-title>.md`. Fill Context, Decision, Consequences and
   Alternatives from the conversation. Ask the user for anything missing. Status `accepted` only if the maintainer agreed.
3. If it supersedes an ADR, set the old one's status to `superseded by ADR-NNNN`.
4. Add a row to the table in `docs/decisions.md`.
5. Commit alone: `docs(adr): record ADR-NNNN <short title>`.
