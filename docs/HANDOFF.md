# HANDOFF — Claude Code Project Kit (working name)

> Handoff from a claude.ai planning chat to Claude Code. Date: 2026-10-08.
> Read this whole file before writing any code. Ask before deviating from decisions marked **DECIDED**.

---

## 1. What we are building

An open-source library that anyone can use to **initialise a project with a clean, powerful Claude Code setup** in one command, e.g.:

```bash
npx create-claude-kit        # or: npx claude-kit init
```

It gives Claude "superpowers" so it:
- **Knows the codebase** in every new session (living architecture map + code graph), so it never rewrites something that already exists.
- **Remembers feature decisions** across long sessions and context compaction (per-feature memory files).
- **Writes clean code** following big-tech coding standards (Google style guides, Airbnb JS, PEP 8, etc.), enforced by linters and hooks, not just markdown.
- **Follows the design system** and stays in sync with the project's current design decisions from Figma (or Penpot, Storybook, etc.).

**One-line pitch (draft):** *"Claude never forgets your architecture, your decisions, or your design system."*

**Owner's direction — DECIDED:** keep the library **big and extensive** (90-ish features), but build it as **switchable modules** so small projects stay light.

---

## 2. Guiding principles (from the "Karpathy" CLAUDE.md)

The widely used "Karpathy rules" are a **community-made** CLAUDE.md based on Andrej Karpathy's public observations about how AI agents fail (he did not write it himself). Bake these into the generated root CLAUDE.md:

1. **Think before coding:** state assumptions, offer options when a request is ambiguous, ask when unclear.
2. **Simplicity first:** write the least code that solves the problem; no speculative features or abstractions.
3. **Surgical changes:** change only what the task needs; don't touch unrelated working code.
4. **Goal-driven execution:** define what "done" means (e.g. tests pass) so the agent can verify its own work.

Related Karpathy context: he moved to mostly agent-written code, runs parallel sessions, and has warned about a flood of low-quality AI code ("slopacolypse"). The kit is the guardrail against that.

---

## 3. Competitive landscape (researched Oct 2026)

| Project | What it does | Overlap with us |
|---|---|---|
| **obra/superpowers** | Claude Code plugin (~194k+ stars); forces plan/spec loop and strict TDD | Workflow discipline |
| **github/spec-kit** | Spec-driven toolkit, tool-agnostic (~125k stars) | Planning/specs |
| **BMAD-METHOD** | Enterprise framework, 21 role agents (~51k stars) | Multi-agent workflow |
| **buildermethods/agent-os** | Workflow + standards layer | Coding standards |
| **eyaltoledano/claude-task-master** | Persistent task graph | Feature memory |
| **claude-kit** (ajyadav013, PyPI `claude-code-kit`) | `init` asks questions, lays down CLAUDE.md + .claude/ | **Closest to our init CLI** |
| **claude-code-forge** | Per-project templates + MASTER_STATE.md memory | Memory file idea |
| **claude-code-best-practices** | 11 CLAUDE.md templates, 4 starter kits | Templates |
| **awesome-claude-code** | Curated link list | Discovery/launch channel |

Code-graph MCP options: codebase-memory-mcp, CodeGraph, Graphify (tree-sitter, local), GitLab Knowledge Graph (gkg).
Design MCP options: Figma official MCP (remote `https://mcp.figma.com/mcp` or desktop `http://127.0.0.1:3845/mcp`, supports variables/tokens + Code Connect), Figma Console MCP, Figma-Context-MCP (Framelink), Storybook design-system extractor, design-token-bridge-mcp.

### Our differentiation (where the gaps are)
1. **Design-system sync** wired into project rules and kept current — clearest gap.
2. **Living architecture map / code graph** that auto-updates.
3. **Per-feature decision memory** that survives compaction.
4. **`doctor` health score** + visual dashboard.
5. **Lightweight on small tasks** (common complaint: BMAD/Spec Kit are overkill).
6. **Safe upgrades** that never overwrite user edits.
7. **Compose, don't rebuild:** optionally install Superpowers / Spec Kit for workflow instead of reinventing them.

---

## 4. Distribution — DECIDED

Two parts sharing one source of truth:
1. **npx CLI** (`create-claude-kit` / `claude-kit`) — scaffolds files into a project, detects stack, asks setup questions, handles `update`, `doctor`, `uninstall`.
2. **Claude Code plugin** — ships reusable commands, skills, agents, hooks; publish to the Claude Code plugin marketplace as well as npm.

Also generate **`AGENTS.md`** alongside CLAUDE.md so it works with Codex, Cursor, Gemini CLI, Copilot.

---

## 5. What the CLI generates in a user's project

```
project/
├── CLAUDE.md                     # short root rules (<100 lines) + links
├── AGENTS.md                     # same rules for other AI tools
├── CLAUDE.local.md               # personal notes (gitignored)
├── .mcp.json                     # code graph + design MCP (opt-in, no secrets)
├── .claude/
│   ├── settings.json             # permissions + hooks
│   ├── commands/                 # /update-map /sync-design /new-feature /why /doctor ...
│   ├── agents/                   # planner, reviewer, tester, designer, security, docs
│   ├── skills/
│   │   ├── code-standards/       # per-language rule files
│   │   ├── design-system/
│   │   └── feature-memory/
│   └── hooks/                    # scripts called from settings.json
├── docs/
│   ├── architecture.md           # living code map
│   ├── decisions.md              # long-term decision log / ADR index
│   ├── adr/                      # one file per big decision
│   ├── glossary.md
│   ├── mistakes.md               # "don't try this again" log
│   ├── features/<name>/MEMORY.md # per-feature working memory
│   └── design/
│       ├── DESIGN.md             # current design decisions
│       └── tokens.json           # W3C DTCG format tokens
└── src/<area>/CLAUDE.md          # nested folder-specific rules (optional)
```

### 5.1 Root CLAUDE.md rules to include
```
## Before creating anything new
1. Check docs/architecture.md
2. Search the codebase for similar code
3. Reuse or extend existing code; never duplicate
After adding a new module/util, update docs/architecture.md

## Feature memory
- At session start, ask which feature we're on and read docs/features/<feature>/MEMORY.md
- After any important decision, append it to Decisions with the reason
- Before ending or when context is large, update Done and Next step
- Never contradict a recorded decision without asking first

## Design
- Never hardcode colors, spacing, or fonts; use docs/design/tokens.json
- Reuse existing components before creating new ones
- Follow WCAG accessibility rules
```

### 5.2 Feature MEMORY.md template
```markdown
# Feature: <name>
Status: in progress | Branch: <branch>

## Goal
What "done" means, in 1–2 lines.

## Decisions (never undo without asking)
- YYYY-MM-DD: <decision>. Why: <reason>.

## Done
- [x] ...
- [ ] ...

## Next step
Exact next action, so a new session resumes immediately.

## Gotchas / don't try again
- <what failed and why>

## Open questions
- ...
```
Keep under ~80 lines; summarise old notes. When a feature ships, move key decisions to docs/decisions.md and archive the folder.

### 5.3 Hooks (in .claude/settings.json)
- **PostToolUse (Edit/Write):** run linter/formatter; run duplicate check.
- **PreCompact:** save progress to the active MEMORY.md.
- **SessionStart:** load the active feature's MEMORY.md + architecture summary.
- **Stop:** update "Next step"; block "done" if tests fail (test guard).
- **PreToolUse (Bash):** block dangerous commands (rm -rf, force-push, etc.).

---

## 6. Full feature list (all modules)

### Core (from the original plan)
- Init CLI with stack detection and setup questions
- CLAUDE.md with Karpathy principles + AGENTS.md
- Living architecture map (`docs/architecture.md`) + `/update-map`
- Code graph via MCP (opt-in)
- Per-feature MEMORY.md + hooks
- Big-tech code standards skill + generated linter configs
- Design system: `/sync-design`, tokens.json, DESIGN.md, Figma MCP + adapters

### Memory and knowledge
1. Self-learning rules — corrections become saved rules automatically
2. Mistake log (`docs/mistakes.md`)
3. Session handoff note at end of each session
4. Glossary of project terms
31. Decision records (ADRs)
32. Auto summary before compaction
33. Search past decisions (`/why <topic>`)
34. Personal vs team memory separation

### Codebase map
35. Auto-update map on commit
36. Dependency map
37. Impact check ("what breaks if I change this?")
38. Dead code finder
39. API endpoint map
40. Database schema map

### Code quality
5. Duplicate checker
6. Auto lint + format on every edit
7. Test guard (no "done" until tests pass)
8. Code reviewer agent
9. Secret/API-key blocker
41. Complexity limits
42. Naming rules
43. Error handling rules (no silent failures)
44. Performance pattern check
45. New/outdated/risky dependency check
46. License check

### Planning and workflow
26. Spec writer
27. Task breaker
28. Progress tracker
29. Ask-before-guessing mode
30. Scope guard (no unrelated file changes)

### Testing
47. Test generator
48. Coverage report
49. Bug reproduction (failing test first)
50. End-to-end test helper

### Design
10. Figma sync (colors, fonts, spacing)
11. Component reuse check
12. Accessibility check
13. Screenshot compare (built vs design)
51. Multiple design tools: Figma, Penpot, Sketch, Storybook, Framer
52. Design change alerts
53. Dark mode check
54. Responsive check
55. Animation rules
56. Icon/image rules
57. UX writing rules

### Security
58. Dangerous command blocker
59. Permission presets (strict/normal/relaxed)
60. Vulnerability scan
61. Privacy check (personal data in logs)

### Git and shipping
62. Smart commit messages
63. PR description writer
64. Changelog generator
65. Release checklist
66. CI fixer

### Docs
67. Auto README updates
68. Comment rules ("why", not "what")
69. API docs generator
70. Diagram generator

### Multi-agent
71. Ready-made agents: planner, coder, tester, reviewer, designer, security, docs
72. Parallel sessions helper (git worktrees)
73. Agent handoff files

### Integrations
74. GitHub / GitLab / Jira issues → tasks
75. Sentry errors → fixes
76. Slack progress updates
77. Safe database schema reading

### Health, visibility, stats
14. `doctor` command with health score
15. Local dashboard (code graph, decisions timeline, tokens)
16. Stale file alerts
23. Cost/token tracker
78. Weekly report
79. Mistake patterns
80. Time and cost saved estimate

### Ease of use and platform
17. Auto stack detection
18. Works with Cursor, Codex, Gemini, Copilot
19. Safe updates (merge, never overwrite)
20. Presets: small / medium / full
81. Monorepo support
82. Language packs: JS, TS, Python, Go, Rust, Java, Swift, Kotlin, Flutter/Dart
83. Framework packs: React, Next.js, Vue, Django, FastAPI, Rails, Spring
84. Migration mode for old projects
85. Clean uninstall
86. Offline mode where possible

### Team
21. Shared team rules
22. Auto onboarding guide

### Community and growth
24. Templates gallery
25. Benchmark results
87. Module/plugin marketplace
88. Shareable configs ("use Company X standards")
89. Rule voting

---

## 7. Suggested build order (proposal — confirm with owner)

**v0.1 — Foundation**
- Repo setup, CLI skeleton (`init`, `update`, `uninstall`), module system with on/off config
- Stack detection; presets small/medium/full
- Root CLAUDE.md + AGENTS.md generation
- architecture.md + `/update-map`; feature MEMORY.md + SessionStart/PreCompact/Stop hooks
- Auto lint/format hook; dangerous command blocker; secret blocker

**v0.2 — Quality + health**
- `doctor` health score; stale file alerts; duplicate checker; test guard; reviewer agent
- Code standards packs for TS/JS + Python first
- Benchmark harness (with vs without kit) + demo GIF

**v0.3 — Design (headline feature)**
- Figma MCP integration, `/sync-design`, tokens.json (DTCG), DESIGN.md
- Component reuse + accessibility + dark mode + responsive checks
- Penpot/Storybook adapters

**v0.4 — Graph + dashboard**
- Code graph MCP (opt-in), dependency/impact/dead-code
- Local dashboard

**v0.5+ —** self-learning rules, multi-agent pack, integrations, git/shipping, docs generators, more language/framework packs, marketplace, team features, stats.

---

## 8. Proposed repo structure for the library itself

```
claude-kit/
├── packages/
│   ├── cli/                 # npx entry: init, update, doctor, uninstall
│   ├── core/                # module loader, config, merge-safe file writer
│   └── dashboard/           # local web dashboard
├── modules/                 # each module = templates + hooks + commands + manifest
│   ├── base/
│   ├── architecture-map/
│   ├── feature-memory/
│   ├── code-standards/
│   ├── design-system/
│   ├── security/
│   └── ...
├── packs/
│   ├── languages/           # ts, python, go, ...
│   └── frameworks/          # react, nextjs, django, ...
├── plugin/                  # Claude Code plugin manifest + bundled commands/skills/agents
├── benchmarks/
├── docs/
└── examples/
```

Each module should have a manifest (name, description, deps, files it writes, hooks it adds, MCP servers it configures, preset membership).

---

## 9. Open questions for the owner

1. Final project name and npm package name?
2. CLI language: TypeScript/Node (recommended for npx) or Python?
3. License: MIT?
4. First supported stacks for v0.1?
5. Bundle third-party MCP servers, or only configure them opt-in? (Recommendation: configure only, opt-in.)
6. Optionally offer to install Superpowers / Spec Kit, or stay independent?

---

## 10. Launch notes (for later)
- README: one-line pitch, 30-second GIF, benchmark chart at the top.
- Publish to npm + Claude Code plugin marketplace; submit to awesome-claude-code.
- Launch same week on Show HN, r/ClaudeAI, X, with a blog post ("Why AI agents keep rewriting code that already exists").
- Realistic goal: #1 GitHub Trending and tens of thousands of stars (all-time top 10 is not realistic for dev tools).

---

## 11. First actions for Claude Code
1. Read this file fully.
2. Ask the owner the open questions in section 9.
3. Propose the v0.1 plan as a task list and wait for approval.
4. Scaffold the repo (section 8), starting with `packages/core` module system and `modules/base`.
5. Create this project's own CLAUDE.md, docs/architecture.md and docs/features/v0.1/MEMORY.md (dogfood the kit).
