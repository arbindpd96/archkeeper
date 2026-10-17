---
name: adr
description: Record an architecture decision as a numbered ADR in docs/adr/ and add it to docs/decisions.md.
disable-model-invocation: true
---

Record the decision `$ARGUMENTS` as an ADR. If no title was given, ask for one.

1. Take the highest number in `docs/adr/` and add one, written with four digits: the first ADR after `0000-template.md` is `0001`.
2. Copy `docs/adr/0000-template.md` to `docs/adr/<NNNN>-<title>.md`, with the title in kebab-case. Fill in every field and section from the conversation, and ask the user for anything missing. Set `Status: accepted` only when the user has agreed to the decision; otherwise `proposed`.
3. If it replaces an earlier ADR, set that ADR's status to `superseded by ADR-<NNNN>`.
4. Add a row for it to the table in `docs/decisions.md`: the number linked to the file, the decision in one line, its status and its date.
5. Tell the user the new file's path and the decision in one line.
