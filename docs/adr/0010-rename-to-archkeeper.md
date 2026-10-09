# ADR-0010: Rename the project to `archkeeper`

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: ADR-0001

## Context

ADR-0001 named the project `claude-codekit`. Research on 2026-10-09 (docs/research/claude-code-reference.md §10) found two problems:

1. Anthropic's Claude Code legal page says the "Claude Code" or Anthropic names cannot be used as part of your own product name without written permission. `claude-codekit` contains "claude-code".
2. Claude Code's plugin validator rejects plugin names that start with `claude-`, so the plugin could not share the product name anyway.

Renaming before the first npm publish costs almost nothing. The repo was hours old and nothing was published.

## Decision

- Product, npm package, CLI and plugin name: **`archkeeper`**. Usage: `npx archkeeper init`. Plugin commands are namespaced `/archkeeper:<skill>`.
- GitHub repo: `arbindpd96/archkeeper` (renamed; GitHub redirects the old URL).
- "for Claude Code" (and Codex, Cursor and others) is used only as descriptive text.
- README and package metadata say: _Independent community project; not affiliated with, endorsed by, or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC._
- Slugs derived from the name: managed-block markers `<!-- archkeeper:begin <id> -->`, lock directory `.archkeeper/`, pragma `archkeeper:allow-secret`.

Availability on 2026-10-09: npm `archkeeper` and `create-archkeeper`, and PyPI `archkeeper`, were all free. Two tiny unrelated GitHub repos (2★ and 0★) share the name.

## Consequences

- The name is a single constant in code, so templates and markers never hard-code it.
- Reserve the npm name with the first real publish (v0.1). Publishing a placeholder is not planned.
- `docs/HANDOFF.md` and `docs/research/` keep the old working name as historical records.

## Alternatives considered

- **Keep `claude-codekit`** and ask Anthropic for permission. Risk: a forced rename after launch would break links, stars and search ranking.
- **keelkit, elephantkit, trelliskit, compasskit and others:** all free, but the owner preferred the name that says what the tool does.
