# ADR-0018: No telemetry, offline by default, and benchmark methodology

- Status: accepted
- Date: 2026-10-09
- Deciders: arbindpd96 (owner)
- Supersedes: none

## Context

The kit runs inside developers' repos and, through its hooks, on every matching tool call. Users have to trust it with their code and with what their agent does.

- **Offline is a feature.** Handoff feature #86 asks for offline mode where possible, and the roadmap's v0.1 exit criteria require that init, update, uninstall, doctor and every hook make no network call.
- **MCP reachability needs the network.** [ADR-0007](0007-mcp-configure-only.md) says `doctor` checks that configured MCP servers are reachable. The kit only writes `.mcp.json` entries; Claude Code makes the connections.
- **Launch claims need evidence.** The public launch rests on a with-vs-without benchmark (handoff §10, roadmap gate G4), but LLM benchmarks are noisy and easy to cherry-pick.
- **Benchmarks cost money.** Each run calls a paid model, and the owner has not yet set the key, the monthly cap or the transcript policy (roadmap open question B, #60).

## Decision

### No telemetry

The kit never phones home. There are no usage analytics, crash reports, install pings or update-available checks, opt-in or otherwise.

Adoption is measured from outside: npm downloads, GitHub issues and code search.

### Offline by default

- `init`, `update`, `uninstall`, `doctor` and every hook make no network calls.
  - A stubbed-network run of the packed-tarball e2e proves it (#43), and `doctor` has its own test (#42).
  - `update` renders from the kit version that is running. It never asks the registry for a newer one.
- Features that need the network are explicit opt-ins. Each says what it will contact, and each degrades gracefully when offline. A failed opt-in never aborts the command that offered it. The opt-ins are:
  - the consented Superpowers (v0.2) and Spec Kit (v0.3) installs; v0.1 only prints their commands
  - design sync through MCP (v0.4)
  - `doctor --online` (v0.4)
  - vulnerability lookups (v0.7)
- Configuring an MCP server writes `.mcp.json` only (ADR-0007). `doctor --badge` writes static markdown without a network call.

### MCP reachability: `doctor --online`

ADR-0007's reachability check is delivered by `doctor --online`. It first ships in v0.4, the first phase in which the kit configures an MCP server.

- It reports each configured server as reachable, needing auth, or unreachable, with a one-line fix.
- http servers get an MCP initialize request with a 5 s timeout.
- stdio servers are checked by resolving their command, without starting them.
- It contacts only servers whose `.mcp.json` entries the kit owns ([ADR-0014](0014-on-disk-contract.md)). Any other server is listed, and contacted only after the user confirms its host, so a cloned repo's `.mcp.json` cannot make `doctor` send a request to a host the user never chose.
- It follows no redirect to another host.
- Secrets are never sent or printed. Requests carry no credentials, so a server that needs them reports "needs auth", and output shows each URL without its userinfo or query string.

Plain `doctor` stays offline.

### Benchmarks

**Where and when.**

- The harness lives in `benchmarks/` and is not part of the npm package ([ADR-0011](0011-single-package.md)).
- It runs headless `claude -p` against the `examples/` fixtures, with and without the kit, on a pinned Claude Code version.
- It runs only on `workflow_dispatch`, with a budget cap the owner sets. It never runs on PRs or forks.

**What counts.**

- A run is valid only if a hook log proves the hooks fired.
- Grading is deterministic (AST, regex, tests). There are no LLM judges.
- The public launch requires at least 2 scenarios to improve with non-overlapping interquartile ranges (gate G4).

**What is published.**

- The methodology, the seeds and the raw per-run JSONL records (grades, tokens and cost) are published, including negative results.
- Full transcripts are published only if the owner agrees (open question B).

**Lightness.** A separate no-API lightness benchmark runs in CI and generates the README Lightness table ([ADR-0017](0017-lightness-budgets.md)).

## Consequences

- There are no usage analytics. Feedback comes through issues and design partners.
- ADR-0007's doctor consequence holds, as an explicit opt-in rather than by default.
- Users are not told about new releases by the CLI. The README and release notes say how to upgrade (`npx archkeeper@latest update`).
- Every new command or hook must keep the stubbed-network test green. A feature that needs the network needs an explicit flag or a consent prompt.
- Local stats (v0.7) stay on the user's machine.
- The launch may wait on benchmark iteration.
- Benchmark spend needs a budget set by the owner.

## Alternatives considered

- **Opt-in telemetry.** It would need its own ADR, and it adds a privacy surface.
- **An update-available check.** A network call on every run, and a signal about who uses the kit.
- **Reachability checks in plain `doctor`.** They would break the offline guarantee and the stubbed-network test.
- **LLM-judge grading.** Non-deterministic.
- **Benchmarks on every PR.** Costly and noisy, and fork PRs would need access to the API key.
- **Launch claims without data.**
