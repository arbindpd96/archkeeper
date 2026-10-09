@AGENTS.md

## Claude Code specifics

- **Hooks** in `.claude/settings.json` do the following. If a hook blocks you, fix the cause; never work around it.
  - Block dangerous commands, secrets and AI attribution.
  - Format and lint every edited file.
  - On stop, run `check:quick` when code has changed.
- **Session start** injects the in-progress feature's "Next step". If no feature is in progress, ask which feature we are on, then run `/new-feature`.
- **Skills**:
  - `/new-feature`: start a feature with its memory file.
  - `/handoff`: save progress before ending.
  - `/update-map`: refresh `docs/architecture.md`.
  - `/adr`: record a decision.
  - `/why <topic>`: search past decisions.
  - `/demo-gif`: record a README GIF for a shipped feature.
- **Agents**:
  - Run `reviewer` on the diff before opening a PR.
  - Run `security-reviewer` on anything that touches hooks, permissions, or files written into users' projects.
- **Planning**: for changes that span three or more files, plan first (plan mode) and confirm the plan with the maintainer.
- **Rules**: path-scoped rules live in `.claude/rules/` and load automatically for matching files.
- **Reference**: `docs/research/claude-code-reference.md` holds verified Claude Code facts. Re-check live docs before relying on anything marked unverified.
