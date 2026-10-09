# ADR-0016: Delivery split between project files and the plugin; the plugin never ships hooks

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: [ADR-0002](0002-distribution-cli-plus-plugin.md) Decision 2, in part. The plugin ships no hooks, carries skills instead of commands, and is distributed through the repo marketplace only; publishing it to npm is deferred. ADR-0002's CLI, one-source-of-truth and AGENTS.md clauses stand.

## Context

ADR-0002 Decision 2 says the plugin bundles "commands, skills, agents and hooks" and is published "to a plugin marketplace hosted in this repo and to npm". Research since then has established four things:

- Reference §11 recommends writing protective hooks, instructions, rules, docs and settings into the project, so they work without the plugin.
- Commands are now skills (reference §3.1, §11).
- The exact `hooks/hooks.json` wrapper shape for plugins is unverified (reference §12), and hooks shipped in both the project and the plugin would fire twice.
- Relative-path marketplace plugins are not version-pinned (reference §4.1). An npm-sourced plugin would be a second published artifact, which [ADR-0011](0011-single-package.md) avoids for now.

Two more facts shape the split. A team's `extraKnownMarketplaces` and `enabledPlugins` take effect only after the workspace-trust dialog is accepted (reference §4.3). And plugin components are namespaced, so a plugin skill runs as `/archkeeper:<skill>` while a project skill runs as `/<skill>` (reference §4.1).

R1 already reflects this split. ADR-0011 keeps `plugin/` in the repo but out of the npm package's `files`, and `check-brand` treats `plugin/` as generated output ([ADR-0012](0012-brand-constants.md)).

## Decision

**Targets.** Every file in a module manifest declares a target, `project` or `plugin` (#18).

**Always written into the project by the CLI:** hooks, `CLAUDE.md`, `AGENTS.md`, rules, docs, settings and `.mcp.json`. Protection never depends on the plugin being installed or trusted.

**Skills and agents.**

- Skills are written into the project by default (v0.1), as `owned` files ([ADR-0014](0014-on-disk-contract.md)).
- From v0.3, the plugin carries the agents and the kit's skills. `--skills local|plugin` is recorded in `config.json`; switching to `plugin` removes the project copies, and switching back writes them again.
- The plugin's contents are the same for every user, so nothing stops a user with local skills from also installing the plugin, for its agents for example. They then have each skill twice, as `/<skill>` and `/archkeeper:<skill>`. `doctor` flags every duplicate and names the fix; that is the guarantee. v0.3 M1 decides whether the skills move into a separate opt-in plugin so the agents can be installed alone.
- The plugin carries only skills and agents. It never ships hooks, settings, MCP servers or instruction files.
- Its skills and agents follow the same frontmatter allowlist as the project's ([ADR-0015](0015-hook-runtime.md)): no `hooks` or `mcpServers`, `permissionMode` only as `default` or `plan`, no unscoped `Bash` in a skill's `allowed-tools`, and no load-time `` !`cmd` ``. Claude Code already ignores `hooks`, `mcpServers` and `permissionMode` on plugin agents (reference §3.2), but the kit does not rely on that: the static test also runs on the built `plugin/`.

**Distribution.**

- The plugin is distributed only through the marketplace at the repo root: `.claude-plugin/marketplace.json` points at `./plugin`.
- Publishing the plugin to npm is deferred until version-pinned installs are needed, and is revisited under ADR-0011's "second published artifact" trigger.

**Build and release.**

- `plugin/` is generated from the module sources by `npm run build:plugin`. Nothing in it is hand-maintained.
- It is committed only in release PRs, where CI asserts that it matches the build. This is how ADR-0002's "plugin output is up to date" check is met, and it means `main` always serves the last released plugin.
- The plugin version is bumped in the same release commit as the package ([ADR-0013](0013-release-process.md)).
- CI runs `claude plugin validate --strict` with a pinned Claude Code CLI, falling back to a zod mirror of the validator's rules. The name rules already exist as a test oracle in `test/brand.test.ts`.

ADR-0002's status line now notes "Decision 2 partly superseded by ADR-0016".

## Consequences

- v0.1 works fully without the plugin.
- The plugin is a distribution channel for agents and opt-in skills, not a second implementation.
- Users who install only the plugin get no hooks, rules or settings, so `init` is still needed. The README must say so when the plugin ships (v0.3).
- Marketplace installs follow the repo's default branch rather than a pinned version, which is why `plugin/` changes only in release PRs.
- Switching `--skills` changes how users invoke a skill (`/<skill>` or `/archkeeper:<skill>`).
- The stop check runs project scripts, so it can only ever arrive through `init` in the full preset ([ADR-0015](0015-hook-runtime.md)), never silently through a plugin update.
- A team that wants the plugin for every contributor commits `extraKnownMarketplaces` and `enabledPlugins` through an opt-in `init` step (v0.3 M1), which still waits for workspace trust.

## Alternatives considered

- **Ship hooks in the plugin too.** They would fire twice, and the `hooks.json` shape is unverified.
- **Plugin-only distribution.** Protection would depend on the plugin and the workspace-trust dialog.
- **Publish the plugin to npm now.** A second published artifact, against ADR-0011.
- **Commit `plugin/` on every PR.** `main` would serve an unreleased plugin, because marketplace installs are not pinned.
- **Generate `.claude/commands/`.** Commands are skills now.
