# Decision log

Long-term decisions for claude-codekit. Each big decision gets an ADR in `docs/adr/` (copy `0000-template.md`).
**Never contradict an accepted decision without asking the owner first.** To change one, write a new ADR that supersedes it.

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0001](adr/0001-project-name.md) | Name: `claude-codekit` (npm + repo + plugin) | accepted | 2026-10-09 |
| [0002](adr/0002-distribution-cli-plus-plugin.md) | npx CLI + Claude Code plugin, one source of truth; also AGENTS.md | accepted | 2026-10-08 |
| [0003](adr/0003-switchable-modules.md) | ~90 features as switchable modules + small/medium/full presets | accepted | 2026-10-08 |
| [0004](adr/0004-typescript-node.md) | TypeScript on Node; generated hooks are dependency-free `.mjs` | accepted | 2026-10-09 |
| [0005](adr/0005-mit-public.md) | MIT licence; public repo from day one | accepted | 2026-10-09 |
| [0006](adr/0006-v01-stacks.md) | v0.1 stacks: TS/JS + Python | accepted | 2026-10-09 |
| [0007](adr/0007-mcp-configure-only.md) | Third-party MCP servers: configure-only, opt-in, no secrets | accepted | 2026-10-09 |
| [0008](adr/0008-compose-superpowers-speckit.md) | Offer optional Superpowers / Spec Kit install | accepted | 2026-10-09 |
