# Claude Code reference for claude-codekit (verified 2026-10-09)

Scope: these are the facts claude-codekit relies on when it generates a Claude Code setup (CLAUDE.md/AGENTS.md, `.claude/settings.json` hooks, skills, agents, plugin, `.mcp.json`, DTCG tokens) and when it builds and releases itself. Sections 1–11 contain only facts whose verification status was **confirmed** or **corrected**; where a fact was corrected, only the corrected version appears. Section 12 holds the refuted, unverified and conflicting items. Docs base: `https://code.claude.com/docs/en/…` (formerly docs.anthropic.com/en/docs/claude-code/…). Local toolchain at research time: Claude Code 2.1.295, node 26.5.1, npm 11.17.0.

> Researched under the working name `claude-codekit`; the project is now `archkeeper` (ADR-0010), and the plugin examples' `codekit` name maps to `archkeeper`.
>
> This is research, not a decision record. Accepted decisions live in `docs/adr/`; where an ADR differs from a recommendation here (for example ESLint over Biome, for the comment policy in ADR-0009), the ADR wins.

---

## 1. Hooks & settings

### 1.1 Events
There are 33 hook events [src](https://code.claude.com/docs/en/hooks):
`SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, SessionEnd`.

The ones the kit uses:
- **SessionStart** fires on `startup`, `resume`, `clear` (/clear), `compact` (auto-compaction) and `fork` (/branch). These values are its matcher values; an empty or omitted matcher fires on all of them [src](https://code.claude.com/docs/en/hooks).
- **PreToolUse** fires before any tool call except EndConversation [src](https://code.claude.com/docs/en/hooks).
- **PreCompact** fires before summarization. **PostCompact** fires after it [src](https://code.claude.com/docs/en/hooks-guide).
- **InstructionsLoaded** fires whenever a CLAUDE.md or `.claude/rules/*.md` file loads, either at start or lazily. Use it to debug which instructions loaded [src](https://code.claude.com/docs/en/hooks-guide).
- **Stop** fires when Claude finishes responding. **SessionEnd** fires when the session ends [src](https://code.claude.com/docs/en/hooks-guide).

### 1.2 Configuration shape and locations
The structure has three levels: `hooks.<EventName>` → an array of matcher groups → a `hooks[]` array of handlers [src](https://code.claude.com/docs/en/hooks-guide).

Hooks can be defined in:
- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- managed policy settings
- a plugin's `hooks/hooks.json`
- skill or agent frontmatter

[src](https://code.claude.com/docs/en/hooks-guide)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "node",
                    "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/codekit/session-start.mjs"], "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node",
                    "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/codekit/guard-bash.mjs"], "timeout": 10 }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "node",
                    "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/codekit/format.mjs"], "timeout": 60 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node",
                    "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/codekit/stop-guard.mjs"], "timeout": 60 }] }
    ]
  }
}
```
Sources: shape and exec form [src](https://code.claude.com/docs/en/hooks); `$schema` [src](https://code.claude.com/docs/en/settings).

**Handler types.** There are five [src](https://code.claude.com/docs/en/hooks):
- `command`: a process.
- `http`: POSTs the event JSON to an endpoint. The response uses the same JSON format as command hooks. Header values interpolate `$VAR_NAME`, but only for variables listed in `allowedEnvVars`. The HTTP status code alone cannot block an action [src](https://code.claude.com/docs/en/hooks-guide).
- `mcp_tool`: calls an MCP tool.
- `prompt`: a single-turn LLM check.
- `agent`: a multi-turn check with tool access; experimental [src](https://code.claude.com/docs/en/hooks-guide).

`prompt` and `agent` hooks return `{"ok": true|false, "reason": "..."}`. On PreToolUse or PostToolUse, `ok:false` sends the reason back to Claude as feedback unless `continueOnBlock: true` is set. On Stop, `ok:false` keeps Claude working unless `"impossible": true` is set [src](https://code.claude.com/docs/en/hooks-guide).

**Command-hook fields** [src](https://code.claude.com/docs/en/hooks):

| Field | Meaning / gotcha |
|---|---|
| `command` | The executable, or a shell string in shell form. |
| `args` | Exec form: no shell runs. Placeholders are substituted as plain strings, so paths with spaces need no quoting. |
| `shell` | `"bash"` or `"powershell"`. Ignored when `args` is set. |
| `timeout` | In seconds (defaults below). |
| `statusMessage` | Status text shown while the hook runs. |
| `if` | A permission-rule filter such as `"Bash(rm *)"`. It is evaluated **only** on PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest and PermissionDenied. On any other event, a hook that has `if` **never runs**. |
| `async`, `asyncRewake` | Run in the background; async hooks have no timeout enforced [src](https://code.claude.com/docs/en/hooks-guide). |
| `once` | Honored **only in skill frontmatter**. Ignored in settings files and in agent frontmatter. |

**Default timeouts** [src](https://code.claude.com/docs/en/hooks):
- command, http and mcp_tool: 600 s. Lowered to 30 s on UserPromptSubmit, PreModelSwitch and PostModelSwitch, and to 10 s on MessageDisplay.
- prompt: 30 s.
- agent: 60 s.
- All **SessionEnd** hooks share a 1.5 s budget, which can be raised up to 60 s.

### 1.3 Matchers
A matcher can be [src](https://code.claude.com/docs/en/hooks):
- an exact name (`Bash`)
- a pipe-separated list (`Edit|Write`)
- a regex (`^Notebook`, `mcp__.*`)
- `*`, or empty, meaning all

MCP tools are named `mcp__<server>__<tool>`, case-sensitive. Use underscores, not dots. The server name must match `.mcp.json` exactly. Plugin MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>` [src](https://code.claude.com/docs/en/hooks).

Matchers also apply to other events. SessionStart matches on source, and some events match on notification type or config source [src](https://code.claude.com/docs/en/hooks-guide).

### 1.4 Hook stdin
Every event sends these common fields: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`. Tool events add `tool_name`, `tool_use_id` and `tool_input`. PostToolUse also adds `tool_response` [src](https://code.claude.com/docs/en/hooks). Stop hooks receive `stop_hook_active` [src](https://code.claude.com/docs/en/hooks-guide).

```json
{
  "session_id": "abc123",
  "prompt_id": "p_01",
  "transcript_path": "/Users/me/.claude/projects/myrepo/abc123.jsonl",
  "cwd": "/Users/me/myrepo",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_use_id": "toolu_01",
  "tool_input": { "command": "git push --force origin main" }
}
```

### 1.5 Exit codes and stdout
**Exit codes** [src](https://code.claude.com/docs/en/hooks-guide):
- **Exit 0** means success. stdout JSON is parsed for decisions.
- **Exit 2** blocks the action and sends stderr to Claude. Exit 2 overrides even a JSON `permissionDecision: "allow"` [src](https://code.claude.com/docs/en/hooks).
- **Any other code** is a non-blocking error and the action proceeds. Invalid JSON is also a non-blocking error.

**Output fields** [src](https://code.claude.com/docs/en/hooks-guide):
- Top-level: `continue`, `stopReason`, `suppressOutput`, `systemMessage`.
- `hookSpecificOutput` holds `hookEventName`, `permissionDecision` (exactly `"allow" | "deny" | "ask" | "defer"`, case-sensitive), `permissionDecisionReason`, `additionalContext`, `updatedInput` (PreToolUse only) and `updatedToolOutput` (PostToolUse only).
- Top-level `decision: "block"` (with `reason`) applies to UserPromptSubmit, UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, ConfigChange and PreCompact [src](https://code.claude.com/docs/en/hooks).

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Force-push is blocked by codekit (guard-bash)." } }
```
```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart",
    "additionalContext": "Active feature: auth-refactor. Next step: wire refresh-token rotation (see docs/features/auth-refactor/MEMORY.md)." } }
```
```json
{ "decision": "block", "reason": "Update Done/Next step in docs/features/auth-refactor/MEMORY.md before stopping." }
```
- `additionalContext` is injected as a plain-text system reminder [src](https://code.claude.com/docs/en/hooks-guide).
- Plain stdout from a SessionStart command (for example `echo`) is also injected as context [src](https://code.claude.com/docs/en/hooks-guide).
- Hook output over 10,000 characters is saved to a file, and Claude gets a preview plus the file path [src](https://code.claude.com/docs/en/hooks-guide).

### 1.6 Execution form, environment, cross-platform
**Exec form** (`args` set) runs with no shell [src](https://code.claude.com/docs/en/hooks):
- `${CLAUDE_PROJECT_DIR}` and similar placeholders are substituted into `command` and into each `args` element.
- On Windows, exec form needs a real `.exe`. npm `.cmd` and `.bat` shims fail. Quote from the docs: *"The node plus script-path pattern works on every platform because node.exe is a real binary."*

**Shell form** runs through `sh -c` on macOS and Linux. On Windows it uses Git Bash, and falls back to PowerShell when Git Bash is missing. In shell form, paths containing spaces must be quoted, and backslashes must be escaped in JSON [src](https://code.claude.com/docs/en/setup).

**Environment:** `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are exported as environment variables in both forms [src](https://code.claude.com/docs/en/hooks). See §12 for the longer variable list.

**Node may be missing.** The native Claude Code binary never invokes Node, and Git for Windows is optional (without it the PowerShell tool is used). A Python-only teammate may therefore have no `node` on PATH [src](https://code.claude.com/docs/en/setup).

### 1.7 Runtime behaviour and pitfalls
- **Parallel execution.** Hooks that match the same event run in parallel. If several PreToolUse hooks return `updatedInput`, the last one to finish wins, which is non-deterministic [src](https://code.claude.com/docs/en/hooks-guide).
- **Isolation.** Hooks cannot run slash commands or tool calls. They communicate only through stdout, stderr and exit codes [src](https://code.claude.com/docs/en/hooks-guide).
- **Hooks run before permission checks.** Hooks fire before any permission-mode check, even in `bypassPermissions` [src](https://code.claude.com/docs/en/permissions).
- **Hooks never bypass deny or ask rules.** Claude Code evaluates deny and ask rules whatever a PreToolUse hook returns: a matching deny rule blocks the call, and a matching ask rule still prompts, even after the hook returned `"allow"` [src](https://code.claude.com/docs/en/permissions).
- **Snapshot at startup.** Settings are read at session startup. `/hooks` shows the configuration, but changes need a restart [src](https://code.claude.com/docs/en/auto-mode-config).
- **Retries.** A blocked PreToolUse call blocks only that one call; Claude may retry it a different way [src](https://code.claude.com/docs/en/hooks).
- **Stop loop protection.** After 8 consecutive Stop-hook blocks with no tool call in between, Claude Code lets Claude stop anyway. Raise the cap with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`. Hooks must check `stop_hook_active` [src](https://code.claude.com/docs/en/hooks-guide).
- **`disableAllHooks: true`** turns hooks off, but cannot disable managed hooks unless it is itself set in managed settings [src](https://code.claude.com/docs/en/hooks).

### 1.8 Settings files
**Precedence, highest first:** managed settings → CLI or `--settings` → `.claude/settings.local.json` (project, gitignored) → `.claude/settings.json` (project, committed) → `~/.claude/settings.json` (user). Arrays such as `hooks`, `permissions.allow` and `permissions.deny` are **additive** across scopes [src](https://code.claude.com/docs/en/settings-reference). The managed position was confirmed on the official settings page [src](https://code.claude.com/docs/en/settings).

**Keys the kit cares about** [src](https://code.claude.com/docs/en/settings-reference):
- `model`
- `attribution.{commit, pr, sessionUrl}`: each a string or `false` (`includeCoAuthoredBy` is deprecated) [src](https://code.claude.com/docs/en/settings-reference)
- `permissions.{defaultMode, allow, ask, deny}`
- `autoMode`
- `hooks`
- `env`
- `statusLine`
- `outputStyle`
- `additionalDirectories`
- `disableAllHooks`
- `claudeMdExcludes` [src](https://code.claude.com/docs/en/memory)
- `autoMemoryDirectory` [src](https://code.claude.com/docs/en/memory)
- `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers` [src](https://code.claude.com/docs/en/mcp)
- `extraKnownMarketplaces`, `enabledPlugins` [src](https://code.claude.com/docs/en/plugins/org)

**`$schema`:** the official settings page uses `"$schema": "https://json.schemastore.org/claude-code-settings.json"` and warns: *"The schema can lag behind the newest CLI releases, so a validation warning on a recently documented key doesn't mean your configuration is invalid"* [src](https://code.claude.com/docs/en/settings).

### 1.9 Permissions
**Rule syntax** [src](https://code.claude.com/docs/en/permissions):
- Rules are scoped to a tool: `Bash(npm test)`, `Bash(npm run test:*)`, `Edit(src/**/*.ts)`, `Read(./.env)`, `WebFetch(domain:api.example.com)`, `mcp__server__tool`.
- **Bash rules match on the command prefix only.** `Bash(git push --force:*)` does not catch `git push origin main -f`. Use a PreToolUse hook for fine-grained blocking.
- File rules use globs.

```json
{ "permissions": {
    "allow": ["Bash(npm test)", "Bash(npm run test:*)"],
    "ask":   ["Bash(git push:*)"],
    "deny":  ["Read(./.env)", "Read(./.env.*)", "Bash(rm -rf:*)", "Bash(git push --force:*)"] } }
```

**Modes (`permissions.defaultMode`)** [src](https://code.claude.com/docs/en/permission-modes):
- `default`: ask.
- `acceptEdits`: file edits and common filesystem commands are approved automatically.
- `plan`: explore only.
- `auto`: classifier-based.
- `dontAsk`: semantics in dispute; see §12.
- `bypassPermissions`: no checks; for CI and scripts.

From v2.1.283, `auto` is the built-in starting mode for interactive terminal and VS Code sessions. On earlier versions it is the default only on Pro, Max and Team plans. Change it with `/config`, `--permission-mode` or `permissions.defaultMode` [src](https://code.claude.com/docs/en/permission-modes).

**Auto mode** [src](https://code.claude.com/docs/en/auto-mode-config):
- Rules are **prose, not regex**, in four lists: `autoMode.environment`, `allow`, `soft_deny` (user intent can override) and `hard_deny` (unconditional).
- **Include `"$defaults"`** in every array. Omitting it *replaces* all the built-in rules.
- Precedence: hard_deny > soft_deny > allow > explicit user intent. The classifier also reads CLAUDE.md.
- **The classifier does NOT read `autoMode` from `.claude/settings.json` or `.claude/settings.local.json`**, only from `~/.claude/settings.json` or managed settings. This stops a checked-in repo from injecting allow rules.

**Overall precedence:** `permissions.deny` blocks before the classifier runs → soft denies (`autoMode.soft_deny` / `permissions.ask`) → allow exceptions → explicit user intent [src](https://code.claude.com/docs/en/permissions).

```json
{ "autoMode": {
    "environment": ["$defaults", "Source control: github.com/arbindpd96"],
    "soft_deny":   ["$defaults", "Never force-push"] } }
```
This block belongs in **user** settings only.

---

## 2. Memory and instruction files, AGENTS.md interop

### 2.1 CLAUDE.md loading
**Load order** [src](https://code.claude.com/docs/en/memory): managed policy → user `~/.claude/CLAUDE.md` → project `./CLAUDE.md` or `./.claude/CLAUDE.md` → local `./CLAUDE.local.md`. Files in parent directories load before files in the working directory.

**Both project files load.** When `./CLAUDE.md` and `./.claude/CLAUDE.md` both exist, Claude Code loads both, `./CLAUDE.md` first. The memory page lists `CLAUDE.md` and `.claude/CLAUDE.md` among the files a directory loads [src](https://code.claude.com/docs/en/memory), and on 2026-10-10 Claude Code 2.1.295's `/context` listed both. In the same check, a file that both import (`@AGENTS.md` and `@../AGENTS.md`) loaded once, and on macOS's case-insensitive file system `@AGENTS.MD` loaded `AGENTS.md` and counted as the same file.

**Managed CLAUDE.md paths.** These cannot be excluded [src](https://code.claude.com/docs/en/memory):
- macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`
- Linux/WSL: `/etc/claude-code/CLAUDE.md`
- Windows: `C:\Program Files\ClaudeCode\CLAUDE.md`

**Nested files.** A subdirectory's `CLAUDE.md` or `CLAUDE.local.md` loads **lazily**, when Claude reads, writes or edits a file in that subtree. It then stays loaded for the session [src](https://code.claude.com/docs/en/memory).

**Imports** [src](https://code.claude.com/docs/en/memory):
- Syntax: `@path`, for example `@README`, `@docs/guide.md` or `@~/.claude/x.md`. Imports load at launch.
- Relative imports resolve from the importing file. Maximum depth is 4 hops.
- Spaces must be backslash-escaped: `@Design\ Docs/api.md`. A **quoted path is not imported**. Imports inside code spans or fenced blocks are skipped.
- Grammar, read from the Claude Code 2.1.295 binary (`~/.local/share/claude/versions/2.1.295`, functions `FOe`, `z7n` with `ni`, and `Q7n`) on 2026-10-10, and checked by running that code: it reads a memory file only up to 4,194,304 bytes (`stat` size; a larger one is skipped whole). It drops a leading byte-order mark and YAML frontmatter (`/^---\s*\n([\s\S]*?)---\s*\n?/`, tried only when `---` appears again from offset 3), lexes the rest with marked's `new Lexer({ gfm: false }).lex()`, and walks the tokens: it skips `code` and `codespan`, reads an `html` token only when it opens with a closed comment, and then only what is left once `<!--…-->` comments are cut out, and matches `/(?:^|\s)@((?:[^\s\\]|\\ )+)/` in every `text` token (a list item's block-level text as well as inline text), recursing into `tokens` and `items`. So an `@` counts at the start of a text token (after a code span, an emphasis opener, a link's `[`) or after whitespace, never after `(` or `-`. It cuts the path at the first `#`, unescapes `\ `, keeps it only when it starts with `./`, `~/`, `/` (not `/` alone) or a letter, digit, `.`, `_` or `-`, and its path expansion trims it and resolves it from the importing file's real folder; any other trailing character stays: `@AGENTS.md.` names `AGENTS.md.`. A NUL in such a path, a marked error (`Infinite loop on byte`) or a stack overflow makes it skip the whole file, imports included. It drops an imported path whose extension is not a text extension.
- The bundled marked is 15.0.6, identified by its rules, since the binary holds no version string: its GFM setext-heading rule has no table interrupt (15.0.7 added one) and it masks links and code before escapes when it looks for emphasis (15.0.8 swapped the two). Without GFM, 15.0.6 and 15.0.7 lex alike. Running the marked and the extractor copied out of the binary gave the same imports as archkeeper's port on 600,000 random texts.
- The first time a project imports a file outside the working directory, Claude Code shows a one-time approval dialog. The answer persists per project. Imports in user-scope files load without the dialog.

**Size** [src](https://code.claude.com/docs/en/memory):
- Target fewer than 200 lines per CLAUDE.md.
- Files over 4 MiB are skipped.
- Imports cost the same context as inline text.
- **Block-level HTML comments are stripped**, so `<!-- … -->` costs 0 tokens. Comments inside code blocks are kept.

**Tooling** [src](https://code.claude.com/docs/en/memory):
- `/context` lists the loaded memory files.
- `/memory` opens an editor for CLAUDE.md, CLAUDE.local.md, rules and auto memory.
- `claudeMdExcludes` (paths or globs) skips irrelevant ancestor CLAUDE.md files in monorepos.
- `/init` migrates `.cursor/rules`, `.cursorrules` and `.github/copilot-instructions.md`. With `CLAUDE_CODE_NEW_INIT=1` it also migrates AGENTS.md, `.devin/rules/`, `.windsurf/rules/` and `.clinerules`, and runs a multi-phase interview. `/import` does a one-time migration.

**Not enforced.** Neither CLAUDE.md nor auto memory is enforced. Guaranteed behaviour requires hooks [src](https://code.claude.com/docs/en/memory).

### 2.2 `.claude/rules/`
`.md` files are discovered recursively, and subfolders are allowed. A rule without `paths:` loads at launch with the same priority as `.claude/CLAUDE.md` [src](https://code.claude.com/docs/en/memory).

**`paths:` is the only frontmatter key that is read.** It can be a YAML list or a comma-separated string. A path-scoped rule loads on Read, Write or Edit (or a Bash read) of a matching file. **Invalid YAML makes the rule load unconditionally.** There is a budget of 1,000 expanded patterns [src](https://code.claude.com/docs/en/memory).

```markdown
---
paths:
  - "**/*.py"
---
# Python standards (managed by claude-codekit)
```

### 2.3 AGENTS.md interop
- Claude Code ≥ v2.1.277 reads `AGENTS.md` (and `.claude/AGENTS.md`) only when there is **no** project `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the working directory or above it. User and managed CLAUDE.md files and `.claude/rules/` do not count toward that check [src](https://code.claude.com/docs/en/memory).
- When a CLAUDE.md exists, AGENTS.md is read only if the CLAUDE.md imports `@AGENTS.md`. Importing it is the recommended pattern. A symlink also works but is awkward on Windows [src](https://code.claude.com/docs/en/memory).
- The "both files" mode, `claude-md-and-agents-md`, can be set only through `/config` or through `pluginConfigs["cc-plugin-agents-md@builtin"]` in **user, `--settings` or managed** settings. It is ignored in project settings [src](https://code.claude.com/docs/en/memory).
- AGENTS.md is not read: before v2.1.277, when the built-in plugin is disabled, and sometimes on the first session after an upgrade [src](https://code.claude.com/docs/en/memory).

```markdown
# CLAUDE.md
<!-- claude-codekit:begin core -->
@AGENTS.md
<!-- claude-codekit:end core -->

## Claude Code specific
- Use plan mode for billing changes
```

### 2.4 Auto memory
- Stored at `~/.claude/projects/<project>/memory/` and **shared across worktrees** of the same repo [src](https://code.claude.com/docs/en/memory).
- The `MEMORY.md` index is loaded at start, up to its first 200 lines or 25 KB. Topic files load on demand, carry `type: user|feedback|project|reference` frontmatter, and have ISO-8601 modified timestamps [src](https://code.claude.com/docs/en/memory).
- `autoMemoryDirectory` relocates the storage and can be set at any scope [src](https://code.claude.com/docs/en/memory).

### 2.5 What survives compaction
**Reloaded after `/compact`** [src](https://code.claude.com/docs/en/context-window):
- the system prompt
- CLAUDE.md, re-read from disk
- auto memory
- MCP tool names
- up to 5 recently modified files, re-read
- the full bodies of skills invoked during the session, capped at 5k tokens each

**Not reloaded:** the skill index descriptions, and the conversation, which is replaced by a structured summary.

To re-inject context, use `SessionStart` with matcher `compact`. Use `PreCompact` to save state before summarization [src](https://code.claude.com/docs/en/hooks-guide).

---

## 3. Skills, commands, subagents

### 3.1 Skills
**Locations and priority** [src](https://code.claude.com/docs/en/skills):
- `~/.claude/skills/<name>/SKILL.md` (personal)
- `.claude/skills/<name>/SKILL.md` (project)
- nested `<subdir>/.claude/skills/`
- plugin `skills/`

Load order: managed > project > plugin > user.

**Frontmatter (corrected list)** [src](https://code.claude.com/docs/en/skills):
- `name`
- `description`: when Claude should use the skill
- `disable-model-invocation`
- `user-invocable`: `false` means only Claude can invoke it
- `allowed-tools`: tools Claude may use **without a prompt** during the turn that invokes the skill. It restricts nothing; deny and ask rules still override it.
- `context`: `fork` runs it as a subagent
- `model`
- `effort`
- `arguments` (positional)
- `paths`: glob activation

**Body features** [src](https://code.claude.com/docs/en/skills):
- `` !`cmd` `` runs at load time and embeds the output. It never prompts: outside auto mode, a command that the permission rules or `allowed-tools` do not allow aborts the invocation. `"disableSkillShellExecution": true` replaces each command with a placeholder [src](https://code.claude.com/docs/en/skills).
- `$ARGUMENTS`, `$0`, `$1` and `$name` are substituted.
- `@file` references are resolved.
- Frontmatter can define `hooks`, which stay registered for the rest of the session. `once` works here only [src](https://code.claude.com/docs/en/hooks).

**Slash commands are skill names**, invoked as `/skill-name args` or by asking in natural language. Skills are the unified extension point [src](https://code.claude.com/docs/en/skills).

**Context cost.** A skill with `disable-model-invocation: true` stays out of the skill index entirely, so it costs no context until invoked [src](https://code.claude.com/docs/en/context-window).

```markdown
---
name: update-map
description: Refresh docs/architecture.md so it matches the code. Use after adding or removing a module, package, command or shared util.
allowed-tools: Read, Grep, Glob, Edit
---
## Current tree
!`git ls-files | head -400`
```
```markdown
---
name: release
description: Cut a release.
disable-model-invocation: true
---
```

### 3.2 Subagents
**Locations** [src](https://code.claude.com/docs/en/sub-agents): `~/.claude/agents/<name>.md` and `.claude/agents/<name>.md`. Managed definitions take priority. Invoke a subagent by naming it, by @-mention, or with `claude --agent <name>`.

**Frontmatter** [src](https://code.claude.com/docs/en/sub-agents):
- `name`
- `description` (15k-token combined limit)
- `tools` (comma-separated or a YAML list): the tools the subagent can use. Omitted, it inherits every tool.
- `disallowedTools`
- `model` (`sonnet|haiku|opus|inherit|<full-id>`)
- `permissionMode` (`default|acceptEdits|auto|dontAsk|bypassPermissions|plan`); unset, it inherits the main conversation's mode
- `maxTurns`
- `effort`
- `memory` (`user|project|local`)
- `skills` (preload)
- `mcpServers`
- `background`
- `omitClaudeMd`
- `isolation` (`worktree`)
- `hooks`

**Plugin subagents** ignore `hooks`, `mcpServers` and `permissionMode` "for security reasons" [src](https://code.claude.com/docs/en/sub-agents).

**Memory.** `memory:` gives the agent its own persistent store in `.claude/agent-memory/<name>/`. The main session's auto memory is *not* loaded into subagents, except in a fork [src](https://code.claude.com/docs/en/sub-agents).

**Isolation.** `isolation: worktree` runs the agent in a git worktree under `.claude/worktrees/` [src](https://code.claude.com/docs/en/sub-agents).

**Built-ins and nesting.** The built-in agents are `Explore` (read-only), `Plan` and `general-purpose`. Subagents can spawn subagents up to a depth of 3 by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`) [src](https://code.claude.com/docs/en/sub-agents).

```markdown
---
name: reviewer
description: Reviews diffs for correctness, reuse and project standards. Use after implementing a change.
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
model: sonnet
permissionMode: default
memory: project
---
```

### 3.3 Output styles
**Built-in styles:** Default, Proactive, Concise, Explanatory and Learning [src](https://code.claude.com/docs/en/output-styles).

**Custom styles** live in `~/.claude/output-styles/` or `.claude/output-styles/<name>.md`. Their frontmatter fields are `name`, `description`, `keep-coding-instructions` and `force-for-plugin` (plugin styles only) [src](https://code.claude.com/docs/en/output-styles).

**Switching:** use `/output-style`, `/config` or the `outputStyle` setting. Names are case-sensitive. The change takes effect on the next message and resets the prompt cache [src](https://code.claude.com/docs/en/output-styles).

---

## 4. Plugins & marketplaces

### 4.1 Plugin layout and manifest
The manifest goes at `.claude-plugin/plugin.json`. Everything else sits at the plugin root, not inside `.claude-plugin/` [src](https://code.claude.com/docs/en/plugins/manifest-reference). Default component locations [src](https://code.claude.com/docs/en/plugins/marketplace-reference):
- `skills/<name>/SKILL.md`
- `commands/`
- `agents/`
- `hooks/hooks.json`
- `.mcp.json`
- `.lsp.json`
- `bin/`
- `settings.json`

**Required:** only `name`. **Common fields:** `version`, `description`, `author{name,email?,url?}`, `displayName`, `homepage`, `repository`, `license`, `keywords` [src](https://code.claude.com/docs/en/plugins/manifest-reference).

**Component fields** [src](https://code.claude.com/docs/en/plugins/manifest-reference):
- `skills` adds to the defaults.
- `commands` and `agents` *replace* the defaults.
- `hooks`, `mcpServers` and `lspServers` merge.
- Also: `outputStyles`, `workflows`, `experimental.{themes,monitors,evals}`.

**Plugin variables** [src](https://code.claude.com/docs/en/plugins/manifest-reference):
- `${CLAUDE_PLUGIN_ROOT}` points at the installed version, which changes on update. Do not write state there.
- `${CLAUDE_PLUGIN_DATA}` is `~/.claude/plugins/data/<id>/` and persists across updates.
- `${CLAUDE_PROJECT_DIR}` is the project root.

**Versioning.** The `version` field pins the plugin. Relative-path plugins don't use version pinning. Command sources re-run once per session. Claude Code v2.1.281+ validates MCP entries and directory-listing fields [src](https://code.claude.com/docs/en/plugins/manifest-reference).

**Naming** [src](https://code.claude.com/docs/en/plugins/manifest-reference):
- Names are kebab-case: no spaces, `@`, `:` or path separators. Components are namespaced, for example `codekit:reviewer`.
- `claude plugin validate`, `init` and `tag` report an **ERROR** for:
  - the prefixes `claude-`, `anthropic-`, `anthropics-` and `cc-plugin-`
  - the exact names `claude`, `anthropic`, `anthropics`, `claude-code` and `claude-mods`
  - "official" next to claude or anthropic
- A whole-word "claude" anywhere else is a **WARNING**.
- The check ignores case and collapses runs of separators.
- **Only those three commands check names; Claude Code still installs and loads a refused name.**
- So a plugin named `claude-codekit` fails validation, and `codekit` passes.

```json
{
  "name": "codekit",
  "displayName": "CodeKit",
  "version": "0.1.0",
  "description": "Modular Claude Code setup: living code map, feature memory, standards, design sync.",
  "author": { "name": "arbindpd96" },
  "homepage": "https://github.com/arbindpd96/claude-codekit",
  "repository": "https://github.com/arbindpd96/claude-codekit",
  "license": "MIT",
  "keywords": ["scaffold", "memory", "architecture", "design-tokens"]
}
```

### 4.2 Marketplace
`.claude-plugin/marketplace.json` [src](https://code.claude.com/docs/en/plugins/marketplace-reference):
- **Required:** `name`, `owner.name` and `plugins[]`. Each entry needs `name` and `source`.
- **Optional top-level fields:** `description`, `version`, `metadata`.
- **Optional entry fields:** `description`, `version`, `category`, `tags`, `dependencies`, `displayName`, `defaultEnabled`, `strict` (default `true`), `relevance`, `metadata`.
- A relative source must start with `./`, and `..` fails. Alternatively, use a bare name with `metadata.pluginRoot` (v2.1.239+).
- Name characters: letters, digits, `.`, `_` and `-`.
- Hooks in an entry must be an inline object.

**Source types** [src](https://code.claude.com/docs/en/plugins/marketplace-reference):
- a relative path
- `{"source":"github","repo":"owner/repo"}`
- `{"source":"git-subdir","url":"owner/repo","path":"tools/plugin"}`, fetched with a sparse partial clone
- `{"source":"npm","package":"@org/p","version":"^1.0.0"}`
- `archive` (https zip)
- `url` (git repo by full URL)
- `command` (output of a shell command)

**`strict`.** `true` appends the entry's components to plugin.json. `false` plus component fields plus an existing plugin.json is a conflict, and the plugin fails to load [src](https://code.claude.com/docs/en/plugins/marketplace-reference).

**Reserved names** [src](https://code.claude.com/docs/en/plugins/marketplace-reference):
- official names such as `claude-plugins-official` and `claude-code-marketplace`
- `claude-community`
- impersonations such as `official-claude-plugins` and `claude-plugins-v2`
- non-ASCII names
- `npm`, `pip`, `uv`, `cargo`, `github` and `gh`
- the `claudeai-` prefix
- `<owner>-<repo>` download-folder names

**Validate** with `claude plugin validate <path> [--strict]` [src](https://code.claude.com/docs/en/plugins/marketplace-reference).

A single repo can be both the npm package and the marketplace. The marketplace lives at the repo root and points at `./plugin`; other marketplaces can reference it via `git-subdir` [src](https://code.claude.com/docs/en/plugins/marketplace-reference).

```json
{
  "name": "codekit",
  "owner": { "name": "arbindpd96" },
  "description": "CodeKit plugin marketplace",
  "plugins": [
    { "name": "codekit", "source": "./plugin", "displayName": "CodeKit",
      "description": "Living code map, feature memory, standards, design sync." }
  ]
}
```
Install with `/plugin marketplace add arbindpd96/claude-codekit`, then `/plugin install codekit@codekit`. The CLI equivalents are `claude plugin marketplace add <source> --scope user|project|local` (user is the default) and `claude plugin install`; both exist in 2.1.295 [src](https://github.com/obra/superpowers).

### 4.3 Team distribution
Commit this to `.claude/settings.json` [src](https://code.claude.com/docs/en/plugins/org):
```json
{ "extraKnownMarketplaces": { "codekit": { "source": { "source": "github", "repo": "arbindpd96/claude-codekit" } } },
  "enabledPlugins": { "codekit@codekit": true } }
```
- **Interactive sessions** register the marketplace only after the user accepts the workspace-trust dialog. Untrusted folders ignore it silently.
- **Headless `-p` and CI** do process these keys, but only in folders that are already trusted (or that have `hasTrustDialogAccepted` set). Installs run in the background unless `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1`.
- Plugins listed by relative path load from the marketplace copy. Plugins with an external source need `claude plugin install <name>@<mkt> --scope project` for each contributor.

---

## 5. MCP config and target servers

### 5.1 `.mcp.json`
The file sits at the project root and is committed. Its top-level key is `mcpServers` [src](https://code.claude.com/docs/en/mcp):
- `type` is `http`, `sse`, `ws` or `stdio`. **No `type` means stdio**, so an entry with `url` but no `type` is an error.
- Fields: `url`, `command`, `args`, `env`, `headers`, `headersHelper`, `oauth`, `timeout`. Plugin `mcpServers` use the same format.

**Variable expansion** [src](https://code.claude.com/docs/en/mcp):
- `${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`.
- In a project `.mcp.json`, `command` and `args` must use `${CLAUDE_PROJECT_DIR:-.}`.
- **Credential variables are blocked (read as empty) in remote `url` and `headers`.** This covers ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, AWS tokens, NPM_TOKEN and any variable whose name contains TOKEN, SECRET, PASSWORD, KEY or AUTH.

**Approval** [src](https://code.claude.com/docs/en/mcp):
- Project servers need approval in interactive sessions.
- The keys `enableAllProjectMcpServers`, `enabledMcpjsonServers` and `disabledMcpjsonServers` control this.
- Committed approvals are ignored until the folder is trusted.

```json
{
  "mcpServers": {
    "figma":         { "type": "http",  "url": "https://mcp.figma.com/mcp" },
    "figma-desktop": { "type": "http",  "url": "http://127.0.0.1:3845/mcp" },
    "example-stdio": { "type": "stdio", "command": "npx", "args": ["-y", "@tool/db", "--root", "${CLAUDE_PROJECT_DIR:-.}"] }
  }
}
```
Sources: [src](https://code.claude.com/docs/en/mcp), [src](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)

### 5.2 Figma
- **Remote server:** `https://mcp.figma.com/mcp`, Figma-hosted, needs auth. **Desktop server:** `http://127.0.0.1:3845/mcp`, available while the desktop app runs [src](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server).
- **Preferred Claude Code setup:** `claude plugin install figma@claude-plugins-official`. The manual route is `claude mcp add --transport http figma https://mcp.figma.com/mcp`; add `--scope user` to enable it for all projects [src](https://help.figma.com/hc/en-us/articles/39888612464151-Claude-Code-and-Figma-Set-up-the-MCP-server).
- **Free seats** are rate-limited: a blog reports 6 tool calls per month. The bidirectional Claude Code integration launched in February 2026 [src](https://www.figma.com/blog/4-ways-were-using-our-mcp-server-at-figma/).
- Tool names are unverified; see §12.

### 5.3 Code-graph MCP options (all opt-in, configure-only)

| Server | Facts |
|---|---|
| DeusData/codebase-memory-mcp | Single static C binary with zero deps. Install with `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh \| bash`. Supports 162 languages and claims ~121× (99.2%) token reduction [src](https://dev.to/deusdata/how-i-cut-my-ai-coding-agents-token-usage-by-120x-with-a-code-knowledge-graph-4a3d). Indexes the Linux kernel (28M LOC) in about 3 minutes, with sub-1 ms queries, hybrid LSP type resolution and semantic vector search [src](https://github.com/DeusData/codebase-memory-mcp). |
| Graphify | Install with `uv tool install graphifyy`, run `graphify install`, then `/graphify .`. Supports 36 tree-sitter grammars plus docs, PDFs, images and video, with ~71.5× reduction [src](https://github.com/Graphify-Labs/graphify). |
| colbymchenry/codegraph | About 72.7k stars. Pre-indexed graph that auto-syncs, runs 100% locally, and ships as a single binary for macOS and Linux with no Node needed [src](https://github.com/colbymchenry/codegraph). |
| CodeGraphContext | 4.2k stars. Install with `pip install codegraphcontext`. Queries call chains and class hierarchies and detects dead code across 15 languages [src](https://github.com/CodeGraphContext/CodeGraphContext). |

### 5.4 Storybook and Penpot
- **Storybook:** package `@storybook/addon-mcp`, installed with `npx storybook add @storybook/addon-mcp`. The endpoint is `http://localhost:6006/mcp` while the dev server runs. The standalone `storybookjs/mcp` repo was **archived on 2026-09-07**; the code now lives in `storybookjs/storybook` as of v10.6.0 [src](https://github.com/storybookjs/mcp).
- **Penpot:** not researched (§12).

---

## 6. Composing Superpowers and Spec Kit (opt-in installs offered by init)

**Superpowers** (obra/superpowers) [src](https://github.com/obra/superpowers):
- MIT, about 296.7k stars.
- Install: `/plugin install superpowers@claude-plugins-official`, or `claude plugin install superpowers@claude-plugins-official --scope project` for the CLI.
- An alternative marketplace route is in §12.

**Spec Kit** (github/spec-kit) [src](https://github.github.io/spec-kit/installation.html):
- v1.1.2 (2026-10-07), about 140.5k stars. Needs Python 3.11+.
- **uv is recommended, not required:** `uv tool install specify-cli`, `pipx install specify-cli` and `pip install specify-cli` all work. A git install also works: `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git` [src](https://github.com/github/spec-kit).
- For an existing project: `specify init --here --force --integration claude`. This writes `.specify/` and installs skills into `.claude/skills/`. **`--force` "may replace files at conflicting managed paths"** [src](https://github.github.io/spec-kit/guides/existing-projects.html).

**Composition rules for init:**
- Both installs are opt-in. Ask for explicit consent, and show the exact command and the files it touches.
- Run Spec Kit **before** codekit writes `.claude/skills/`. Afterwards, re-hash and treat Spec Kit's files as foreign: never owned, never merged.
- Record what was installed in `.claude-codekit/lock.json` under `answers.optionalInstalls`.
- If Superpowers is enabled, don't install codekit skills that overlap with its brainstorm, plan, TDD or review flow. codekit owns memory, the map, standards and design. Superpowers and Spec Kit own the process.

---

## 7. Engineering stack decision

### 7.1 Facts that drive the decisions
**Node release status** [src](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json):
- Node 20 reached end of life on 2026-04-30.
- Node 22 is in maintenance until 2027-04-30.
- Node 24 enters maintenance on 2026-10-20 and reaches end of life on 2028-04-30.
- Node 26 becomes LTS on 2026-10-28.
- From Node 27 there is one major release per year, and each becomes LTS.

**Package managers:**
- Corepack is not shipped from Node 25.0.0 (nodejs/node#59835, merged 2025-09-12). `npm i -g corepack` still works [src](https://github.com/nodejs/node/pull/59835).
- pnpm 12.10.1 is a native executable. Install it with `curl -fsSL https://get.pnpm.io/install.sh | sh -` or `npx get-pnpm`; the docs no longer list `npm i -g pnpm` [src](https://pnpm.io/installation).

**Cold `npx` cost (local measurement):**
- A lean dependency set came to about 4.3 MB of node_modules and installed in 3–6.5 s, depending on the network. A heavy set (commander, inquirer, chalk, zod, handlebars, execa and so on) came to 28 MB and took about 10.8 s [src](https://docs.npmjs.com/cli/v11/commands/npx).
- tsdown bundled the lean set into **one ESM file of about 221 kB min / 67 kB gz** that ran correctly [src](https://tsdown.dev/).

**tsdown 0.23.0** (rolldown ~1.2, published 2026-09-03; engines `^22.18||^24.11||>=26`) [src](https://www.npmjs.com/package/tsdown):
- Packages in `dependencies` stay external; packages in `devDependencies` get inlined.
- Config: `deps.{alwaysBundle, neverBundle, onlyBundle, onlyImport}` and the flag `--deps.never-bundle`. The old `external` and `noExternal` options are deprecated.
- Use `tsdown.config.mts`, or `"type":"module"`; a `.ts` config failed to load without it.

**Library quirks:**
- **jsonc-parser 3.3.1.** Its UMD main breaks bundling (`Cannot find module './impl/format'`), and its ESM build uses extensionless imports, so plain Node can't load it. Alias `'jsonc-parser': 'jsonc-parser/lib/esm/main.js'` in the bundler, and use the default CJS import in unbundled tests [src](https://www.npmjs.com/package/jsonc-parser).
- **jsonc-parser `modify` + `applyEdits`** keeps comments and unrelated formatting, but reformats the array it inserts into into multi-line form [src](https://github.com/microsoft/node-jsonc-parser).
- **node-diff3 3.2.1.** `mergeDiff3(a, o, b, {label:{a,o,b}, excludeFalseConflicts:true})` returns git-style markers including `||||||| base`. Its default separator is `/\s+/` (word-level), so **pass `text.split('\n')`**. Edits on adjacent lines count as a conflict [src](https://github.com/bhousel/node-diff3).

**CLI libraries:**
- commander 15.0.0 is ESM-only, needs Node ≥22.12, has zero deps and bundles to 39 kB min / 11 kB gz. Commander 14 gets security fixes until May 2027 [src](https://github.com/tj/commander.js/releases/tag/v15.0.0).
- citty 0.2.2 is 9.4 kB / 3.6 kB gz but still 0.x.
- @clack/prompts 1.8.1 exports `text`, `select`, `multiselect`, `groupMultiselect`, `autocomplete`, `confirm`, `group`, `spinner`, `progress`, `tasks`, `taskLog`, `log`, `note`, `intro`, `outro`, `cancel`, `isCancel`, `box`, `isCI` and `isTTY`. With a non-TTY stdin, `text()` never resolves and Node exits with code 13 [src](https://www.npmjs.com/package/@clack/prompts).
- `node:util` `styleText` handles colour. It strips colour when piped and honours `NO_COLOR` and `FORCE_COLOR`. Pass `{stream: process.stderr}` when writing to stderr [src](https://nodejs.org/api/util.html#utilstyletextformat-text-options).

**Validation:** zod 4.6.5 classic is 90.6 kB / 25.4 kB gz and has a built-in `z.toJSONSchema()`. zod/mini is 39 / 12.7 kB. valibot plus `@valibot/to-json-schema` is 18.8 / 5.0 kB [src](https://zod.dev/json-schema).

**Other libraries:**
- tinyglobby 0.2.17 is 39 kB with deps fdir and picomatch.
- handlebars is 2.96 MB and pulls in uglify-js.
- eta is zero-dep at 209 kB.

[src](https://www.npmjs.com/package/tinyglobby)

**Detection libraries:**
- package-manager-detector 1.9.0 is zero-dep (31 kB). It detects npm, yarn, pnpm, bun, deno, nub, aube and upm from the lockfile, the `packageManager` field, `devEngines` or install metadata, and crawls upward. It exports `resolveCommand` [src](https://github.com/antfu-collective/package-manager-detector).
- @netlify/build-info pulls in @bugsnag/js and yargs and needs Node ≥22.12. Too heavy.

**Python signals:** PEP 735 `[dependency-groups]` is Final, as is PEP 751 `pylock.toml` / `pylock.<name>.toml` [src](https://peps.python.org/pep-0751/).

**Hook latency, measured locally on macOS arm64** (no official figures exist):

| Runtime | Latency per call |
|---|---|
| bash + jq | ~7 ms |
| bun .mjs | ~14 ms |
| Homebrew python3 | ~18–20 ms |
| /usr/bin/python3 | ~27 ms |
| node 26 .mjs | **~35 ms** |
| python3 via the pyenv shim | ~60 ms |

[src](https://code.claude.com/docs/en/hooks)

**Bundler and lint:**
- tsup's README says it is not maintained and recommends tsdown. unbuild is experimenting with obuild as its successor [src](https://github.com/egoist/tsup).
- Biome 2.5.15 fully supports JS, TS, JSX, TSX, JSON, JSONC, CSS and GraphQL. YAML, Markdown and SCSS are in progress. `noFloatingPromises` is a nursery rule in the `types` domain and uses Biome's own inference, no tsc. Current versions: ESLint 10.12.0, oxlint 1.87.0 [src](https://biomejs.dev/internals/language-support/).

**Testing:** vitest 5.0.3 needs node `^22.12||^24||>=26`. **`vite` is a non-optional peer dependency, so add it explicitly.** vitest has `toMatchFileSnapshot` (any extension) and `expect.addSnapshotSerializer`. In CI it never writes snapshots, and missing, mismatched or obsolete snapshots fail the run [src](https://vitest.dev/guide/snapshot).

### 7.2 Decisions

| Concern | Decision |
|---|---|
| Package | One npm package `claude-codekit` (subject to §10), bin `claude-codekit`, **zero runtime deps**. All libraries go in devDependencies and tsdown inlines them into `dist/cli.mjs`. `files: ["dist","modules","packs","schema"]`. No `@claude-codekit/*` split in v0.1, because each extra package adds a cold-start fetch. A thin `create-claude-codekit` wrapper can come later. |
| Repo layout | npm with package-lock.json; no workspaces and no Turborepo for v0.1. Folders: `src/core` (loader, renderer, lock, merge, detect), `src/cli`, `src/hooks` (TS sources of the hook scripts), `modules/<id>/{module.json,files/}`, `packs/`, `plugin/` (generated at build), `test/fixtures/`. Biome `noRestrictedImports` keeps core from importing cli. Move to workspaces only when the dashboard package arrives. |
| Node floor | `engines.node: ">=22.12.0"`. Print a friendly version check before any ESM-only import. |
| CLI | commander 15 for arguments, @clack/prompts 1.x for prompts, `node:util` styleText for colour, zod v4 for the manifest, lock and config schemas (exported to `schema/*.json` via `z.toJSONSchema()`), plus tinyglobby, smol-toml, yaml, jsonc-parser (aliased), node-diff3, package-manager-detector and `node:crypto` sha256. |
| Templating | No template engine. Use logic-less `{{var}}` that throws on unknown variables. Conditions live in the manifest (`when: {stack: 'python'}`). JSON files are built as TS objects. Rendering is pure and deterministic. |
| Non-interactive | Every prompt has a flag (`--preset`, `--modules`, `--stack`, `--yes`, `--json`). Switch to non-interactive automatically when `!isTTY(process.stdin) \|\| isCI()`. |
| Merge-safe update | `.claude-codekit/lock.json` holds `{lockfileVersion, kit{name,version}, answers, files{path:{module,strategy,hash}}, removed[]}`. `.claude-codekit/base/<path>` keeps a committed 3-way base, marked `linguist-generated=true`. There are four strategies (below). Conflicts get node-diff3 line-level markers labelled `yours` / `base` / `claude-codekit@<ver>`, or `--conflict rej`. Also: `update --dry-run` and `--json`. |
| Hook runtime | Node `.mjs`, one zero-dep bundled file per hook under `.claude/hooks/codekit/`, invoked in **exec form** (`command:"node"`, `args:[path]`). Narrow spawns with `matcher` and `if`; use `async` for non-critical work. Back the hooks with native `permissions.deny` rules. Bash, compiled binaries (62 MB per platform) and Python were rejected. |
| Build | tsdown builds twice: the CLI (single ESM file) and the hooks (one `.mjs` each). |
| Test | vitest 5 + vite. Table-driven merge, block and JSON-ownership cases. Preset×stack tree snapshots via `toMatchFileSnapshot('__snapshots__/<preset>-<stack>.tree.txt')`. E2E: `npm pack`, install, `init` → simulated user edits → `update` (assert no user bytes are lost) → `uninstall`, which must leave an empty diff. Matrix: Node 22/24/26 × ubuntu/macos/windows. `claude plugin validate ./plugin --strict` in CI. Biome 2.5 and `tsc --noEmit` lint our own code; publint checks the package. |
| Release | @changesets/cli 3.0.3 with `changesets/action@v2.1.2`; there is **no floating `v2` tag**. Inputs are kebab-case: `github-token`, `publish-script`, `version-script`, …. It needs `contents: write`, `pull-requests: write` and the repo setting "Allow GitHub Actions to create and approve pull requests". Pass `github-token` as an input; setting it as an env var doesn't configure the action [src](https://github.com/changesets/action). (release-please-action is at v5.0.0, node24 [src](https://github.com/googleapis/release-please-action/releases/tag/v5.0.0).) |

**The four update strategies:**
- **`owned`** (rules, agents, skills, hook scripts). If the hash is unchanged, overwrite. If the user edited Markdown, run a 3-way merge. If the user edited a `.mjs`, write a `.codekit-new` sidecar and warn.
- **`blocks`** (CLAUDE.md, AGENTS.md, .gitignore). Markdown uses `<!-- claude-codekit:begin <id> -->` … `<!-- claude-codekit:end <id> -->`. .gitignore uses `# claude-codekit:begin <id>`. The 3-way merge runs per block.
- **`json`** (settings.json, .mcp.json). Track ownership: hook entries by their `args` path, MCP servers by name, permission rules by exact string. Edit with jsonc-parser. **JSON never gets conflict markers.**
- **`create-only`** (feature MEMORY.md, architecture.md, decisions.md). Written once and never touched again.

### 7.3 Publishing (blocker-aware)
**Trusted publishing requirements:**
- npm ≥11.5.1, Node ≥22.14, `permissions: id-token: write`, GitHub-hosted runners only. Provenance is automatic.
- Up to **10** trusted publishers per package.
- npm rejects OIDC from `issue_comment` and `pull_request_target`, so trigger on `push`, `release` or `workflow_dispatch`.
- `npm trust github <pkg> --file <wf>.yml --repo owner/repo --allow-publish|--allow-stage-publish` needs npm ≥11.15, account 2FA and an existing package.
- Unvalidated trust configs expire after 48 h.

[src](https://docs.npmjs.com/trusted-publishers)

**BLOCKER.** Repos created after 2026-07-15 get immutable OIDC subjects. npm's token exchange rejects them with E404 (npm/cli#9969, open and untriaged as of 2026-10-03). `arbindpd96/claude-codekit` was created 2026-10-09T07:53:23Z and returns `use_immutable_subject: true` with `sub_claim_prefix: "repo:arbindpd96@20431615/claude-codekit@1411482411"` [src](https://github.com/npm/cli/issues/9969), [src](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/).

**Token policy** [src](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/), [src](https://docs.npmjs.com/cli/v11/commands/npm-stage):
- Classic tokens are revoked.
- Write granular tokens default to 7 days, with a 90-day maximum.
- Bypass-2FA tokens lose direct publish around January 2027.
- Staged publishing went GA on 2026-05-22 (npm ≥11.15): `npm stage publish`, then `npm stage approve <id>` with 2FA. `list`, `view`, `reject` and `download` also exist.
- Stage-only tokens arrived on 2026-09-18.
- Since 2026-10-02, `npm stage publish` can **create** a new package [src](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/).

**Plan:**
1. Make the first publish from the maintainer's laptop with 2FA, using either `npm publish --access public` or `npm stage publish --access public` followed by `npm stage approve <id>`.
2. In CI, run `npm stage publish` with a "Read and write (stage only)" token stored in `NPM_STAGE_TOKEN`. The maintainer approves each release.
3. After #9969 is fixed, run `npm trust github claude-codekit --file release.yml --repo arbindpd96/claude-codekit --allow-publish`, publish within 48 h, delete the token, and set "Require 2FA and disallow tokens".

Pin actions by SHA, and use `setup-node` with `registry-url: https://registry.npmjs.org`.

### 7.4 Repo and push setup
- Pushing `.github/workflows/*` over HTTPS with a `gh` OAuth token needs the `workflow` scope: `gh auth refresh -h github.com -s workflow` [src](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
- When SSH keys are not set up, use an HTTPS remote with `gh` as the credential helper, configured repo-locally so global git config stays untouched [src](https://cli.github.com/manual/gh_auth_setup-git).

---

## 8. Competitor gaps

| Project | What it does | Gap we exploit |
|---|---|---|
| ajyadav013/claude-kit (PyPI `claude-code-kit` 0.84.0, 13 stars) | Installed with pipx; `ckit init/upgrade/diff/doctor/validate --strict`; state in `.ckit/` with per-file checksums. User-modified files are kept and the new version is dropped beside them as a `.claude-kit` sidecar (2-way, no merge), with numbered backups. Heavy evidence-gated SDLC pipeline. `.sh` hooks need jq, and Windows needs WSL [src](https://github.com/ajyadav013/claude-kit/blob/main/docs/cli.md). | No 3-way merge. Needs Python. Not cross-platform. Heavy process. |
| create-claude-kit 1.2.1 (TRS Software, 2026-01-11) | Always writes into a **new** `./<projectName>/` folder using unconditional `fs.writeFile`. Presets: saas, landing, mobile, ai, ecommerce. No update or doctor, no settings.json hooks, no .mcp.json. Its repository URL returns 404 [src](https://www.npmjs.com/package/create-claude-kit). | Can't write into an existing repo; no lifecycle. |
| claude-code-forge 1.0.0 (npm) | git-clones a template. On conflict it offers overwrite-all, merge (missing files only) or skip. No lockfile [src](https://www.npmjs.com/package/claude-code-forge). | No update tracking. |
| buildermethods/agent-os (5.5k stars, Shell, v3.0.0) | `project-install.sh` asks y/N, then overwrites standards and copies commands into `.claude/commands/agent-os/` [src](https://github.com/buildermethods/agent-os). | No merge, no hooks, bash only. |
| claude-code-best-practices (93 stars) | 11 CLAUDE.md templates and 5 starter kits, installed with `cp -r`. No CLI [src](https://github.com/muhammadusmangm/claude-code-best-practices). | Copy-paste only. |

**Our edge:**
- about 0.5 s zero-dependency `npx`
- a true 3-way `update` with `--dry-run`, plus `/codekit:resolve`
- a `doctor` health check
- cross-platform exec-form hooks
- `@AGENTS.md` interop
- path-scoped language rules
- DTCG design sync

We compose with Superpowers and Spec Kit rather than competing with them.

---

## 9. DTCG tokens

**Spec status:**
- **Format 2025.10** and **Resolver 2025.10** are "Final Community Group Report, 28 October 2025… considered stable". They are not W3C Recommendations [src](https://www.designtokens.org/tr/2025.10/format/).
- The 2026-09-08 draft says *"Do not attempt to implement this version"*.
- The Resolver's root keys are `version` (`"2025.10"`), `sets`, `modifiers` and `resolutionOrder` (required).

**Format essentials** [src](https://www.designtokens.org/tr/2025.10/format/):
- `$value` is required. `$type` can be inherited from a parent group. `$description`, `$extensions` and `$deprecated` are optional.
- Aliases use `{group.token}`. Tools **must** also support JSON Pointer `$ref`.
- `$root` is a reserved token name inside groups. Groups can use `$extends`.
- Names must not start with `$` or contain `{`, `}` or `.`.
- Types: `color, dimension, fontFamily, fontWeight, duration, cubicBezier, number, strokeStyle, border, transition, shadow, gradient, typography`.
- A color value is `{colorSpace, components, alpha?, hex?}`. A dimension is `{value, unit: "px"|"rem"}`.
- Files use the `.tokens` or `.tokens.json` extension, with media type `application/design-tokens+json`.

```json
{
  "colors":   { "blue":    { "$type": "color", "$value": { "colorSpace": "srgb", "components": [0, 0.4, 0.8], "hex": "#0066cc" } } },
  "spacing":  { "small":   { "$type": "dimension", "$value": { "value": 8, "unit": "px" } } },
  "semantic": { "primary": { "$type": "color", "$value": "{colors.blue}" } }
}
```

**Tooling:**
- **Style Dictionary 5.6.0** has had first-class DTCG support since v4, but "the latest format 2025.10 does not have full support yet". That support is a work in progress in v5 [src](https://styledictionary.com/info/dtcg/).
- **Figma has shipped native DTCG variable import and export.** Import by drag-and-drop into the Variables view or with "Import mode"; export with "Export mode(s)" [src](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables).

Figma import accepts only:
- color (sRGB or HSL)
- dimension in **px only**
- duration in **seconds only**
- a single-string fontFamily
- number (booleans via `com.figma.type`)
- string (non-standard)

Cross-collection aliases use `com.figma.aliasData`. Tokens that use `rem`, `ms`, fontFamily arrays or composite types will not import.

---

## 10. Naming and legal notes

**Anthropic's brand rules.** The Claude Code legal page says verbatim: *"you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name… or in a way that suggests Anthropic built, endorses, or is partnered with your product. Any other use… requires our written permission."* The Trademark Guidelines (effective 2024-08-01) allow use "only as specifically permitted by us and only in materials we approve beforehand"; the contact is marketing@anthropic.com [src](https://code.claude.com/docs/en/legal-and-compliance), [src](https://www.anthropic.com/legal/trademark-guidelines). **`claude-codekit` literally contains "claude-code".**

**Plugin validator.** A plugin named `claude-codekit` is a validation ERROR. Use `codekit` for the plugin and the marketplace, with displayName "CodeKit" [src](https://code.claude.com/docs/en/plugins/manifest-reference).

**npm name availability on 2026-10-09** [src](https://registry.npmjs.org/claude-codekit):
- Free: `claude-codekit`, `create-claude-codekit`, `@claude-codekit/core`, `@claude-codekit/cli`. The npm org `claude-codekit` does not exist.
- Taken: `codekit` (v3.0.0, no bin).

**Taken names to avoid:**
- `create-claude-kit` belongs to TRS Software [src](https://www.npmjs.com/package/create-claude-kit).
- `claude-code-kit` is taken on PyPI (ajyadav013) and on npm (goamaan; bins `ck`, `cck`) [src](https://github.com/muhammadusmangm/claude-code-best-practices).

**Actions:**
- Add the disclaimer "Independent community project; not affiliated with, endorsed by, or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC."
- Use no Anthropic logos or colours.
- Email marketing@anthropic.com before the public launch, or be ready to rename to a neutral npm name such as `codekit-cli` and keep "for Claude Code" as descriptive text.
- Create the npm org `claude-codekit` to protect the scope, without placeholder packages.

---

## 11. Implications for the kit (design rules)

**Naming and packaging**
- Plugin and marketplace name: `codekit`; displayName "CodeKit". Skills are namespaced `codekit:<skill>`. npm `claude-codekit` is gated on §10.
- Ship the plugin from `./plugin`, with the marketplace at the repo-root `.claude-plugin/marketplace.json`. CI runs `claude plugin validate ./plugin --strict`, because Claude Code still loads names the validator refuses.
- **Split of responsibilities.** Protective hooks (guard-bash, format, session-start, stop-guard), CLAUDE.md, AGENTS.md, rules, docs, settings and `.mcp.json` are **written into the project by the CLI**, so they work without the plugin. Reusable workflow skills and agents ship in the **plugin**.

**Instruction files**
- Generate **skills, not `.claude/commands/`**. Commands like `/update-map`, `/why` and `/new-feature` are skills. Side-effect skills set `disable-model-invocation: true`. Descriptions must be precise, because the others auto-trigger.
- Root CLAUDE.md: about 5 managed lines (`@AGENTS.md` plus pointers) inside `<!-- claude-codekit:begin/end -->` blocks, which cost 0 tokens. Keep the file under 100 lines total, well under the 200-line guidance. Shared rules live in AGENTS.md. **A CLAUDE.md without `@AGENTS.md` hides AGENTS.md from Claude.**
- Generated CLAUDE.local.md also suppresses AGENTS.md auto-read. That is harmless only because CLAUDE.md imports it.
- Language and framework standards go in kit-owned `.claude/rules/codekit/<lang>.md` with `paths:` frontmatter (`**/*.py`, `**/*.{ts,tsx}`), not in an always-loaded skill. `paths` is the only key read. Validate the YAML at generation time, because invalid YAML loads the rule unconditionally.
- Never emit quoted `@path` imports. Backslash-escape spaces, because repo paths can contain them; this repo's path does.

**Hooks**
- All hooks use exec form: `{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/codekit/<name>.mjs"],"timeout":N}`. They are zero-dep bundled `.mjs` files, so they work without `"type":"module"`.
- Never emit `once` in settings. Never put `if` on non-tool events. Never rely on SessionEnd for more than 1.5 s of work.
- Hook scripts read stdin JSON defensively, log to stderr, and either exit 0 with JSON or exit 2 with stderr; they never mix the two. Every Stop hook returns at once when `stop_hook_active` is true.
- **Defence in depth.** Emit native `permissions.deny` rules alongside the guard hook: `Read(./.env)`, `Read(./.env.*)`, `Bash(rm -rf:*)`, `Bash(git push --force:*)`. A missing `node` produces only a non-blocking error. Document that deny rules are prefix-only.
- Kit hooks are identified by their `args` path for merging. User hooks on the same events coexist because arrays are additive. Avoid relying on `updatedInput`, since with parallel hooks the last to finish wins.

**Feature memory and compaction**
- Hooks can't call tools or run Claude. Therefore:
  - `SessionStart` (matcher `startup|resume|clear|compact`) injects the active feature's MEMORY.md and an architecture summary via `additionalContext`, kept under 10k characters.
  - `PreCompact` only takes deterministic snapshots (timestamp, branch, git status) into the memory folder.
  - The LLM-written update ("Done" / "Next step") comes from a Stop hook `{"decision":"block","reason":...}` that respects the 8-block cap, plus the `handoff` skill.
- The active-feature pointer lives in a gitignored local file, for example `.claude-codekit/local/active-feature`. Only CLAUDE.md, five recent files and invoked skills survive compaction.

**Settings and permissions**
- Write `"$schema": "https://json.schemastore.org/claude-code-settings.json"` into generated settings, and tolerate schema lag.
- Don't set `permissions.defaultMode` by default. Presets (strict/normal/relaxed) only add `allow`/`ask`/`deny` rules.
- **Never write `autoMode` into project settings**, because it is ignored there. Offer it as an opt-in snippet for `~/.claude/settings.json`, always with `"$defaults"`.

**MCP**
- Third-party MCP is opt-in and configure-only. `.mcp.json` entries always carry `type` and no secrets. Remote auth goes through OAuth or `headersHelper`, not credential env vars, which read as empty. Stdio paths use `${CLAUDE_PROJECT_DIR:-.}`.
- Prefer offering `claude plugin install figma@claude-plugins-official` over writing a Figma entry.
- `doctor` validates that MCP hook matchers (`mcp__<server>__…`) match `.mcp.json` server names.

**Design tokens**
- Write `docs/design/design.tokens.json`, plus `design.resolver.json` when theming. This replaces the handoff's `tokens.json`, because the spec requires a `.tokens.json` extension.
- Validate with our own zod schema for 2025.10.
- Offer a Figma-compatible export profile: px, seconds, single fontFamily. Style Dictionary is an optional exporter only.

**Settings JSON editing**
- Edit settings and `.mcp.json` only through jsonc-parser `modify`/`applyEdits`, with stable key order. Expect the target arrays to be reformatted.

**doctor**
`doctor` checks that:
- `node` is on PATH and ≥22.12
- each hook passes its self-test
- the Claude Code version is ≥2.1.277 (AGENTS.md); warn below 2.1.283
- no conflict markers remain in CLAUDE.md, AGENTS.md or rules (they would reach Claude's context)
- `.mcp.json` entries have a `type`
- the plugin passes `claude plugin validate`

**Optional installs and team setup**
- Superpowers and Spec Kit installs need explicit consent. Warn about Spec Kit's `--force`. Record them in the lock. Skip codekit skills that overlap with Superpowers.
- Team onboarding: optionally write `extraKnownMarketplaces` and `enabledPlugins` into `.claude/settings.json`. These take effect only after workspace trust.

**Agents**
- Subagents (planner, reviewer, tester, designer, security, docs) get explicit `tools` / `disallowedTools`. `reviewer` uses `memory: project`. Decide whether `.claude/agent-memory/` is committed and say so in the README.

**Process and release**
- The release process follows §7.3.

---

## 12. Unverified, refuted and low-confidence items (re-check before relying on them)

| Item | Status / note |
|---|---|
| "Claude Code has 8 hook events" | **Refuted.** There are 33 (§1.1) [src](https://code.claude.com/docs/en/hooks). |
| "Stop hooks share a 1.5 s budget" (I3's corrected text) | Likely a transcription error. E17 attributes the 1.5 s shared budget to **SessionEnd**. Don't design around a Stop budget without re-checking. |
| Position of **managed settings** in precedence | **Resolved.** The official settings page puts managed highest: managed → CLI → local → project → user (§1.8). |
| `dontAsk` = "full autonomy" | Confirmed by the verifier, but earlier docs described `dontAsk` as auto-denying anything not pre-approved. Re-read permission-modes before using it in presets. |
| Hook env vars beyond `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` (`$CLAUDE_SESSION_ID`, `$CLAUDE_CWD`, `$HOOK_EVENT_NAME`, `$TOOL_NAME`, `$PERMISSION_MODE`) | Listed in H7 but corroborated only for the first three (E18). Read the same values from stdin JSON instead. |
| SessionStart stdin field name `source` | Implied by the matcher values; the field name was not verified. Read it defensively. |
| Hook JSON honored on non-zero exits | One verifier note says "non-zero exit codes with valid JSON are honored". Not relied on: exit 0 with JSON, or exit 2 with stderr. |
| Settings key `enabledMcpServers` | Listed in S2. The verified MCP keys are `enabledMcpjsonServers` and `disabledMcpjsonServers` (E26). Don't emit `enabledMcpServers`. |
| Model id `"claude-opus-5"` in settings examples | Not verified. Don't hard-code model ids in generated settings. |
| "No official `$schema` for settings.json" (S3) | **Superseded** by the settings page showing the SchemaStore URL (§1.8). |
| Skill frontmatter `agent` field (paired with `context: fork`) | The corrected S1 says it is a subagent field, not a skill field. Earlier docs had `agent` on skills. Re-check before using it. |
| "`.claude/commands/` no longer exists" (S4) | Confirmed in the skills docs, but plugin docs still list `commands/` (P3, E24). We generate skills only, so the question doesn't block us. |
| "MCP hooks auto-allow tools on mocked servers" (I4) | Unclear; ignore. |
| Plugin `hooks/hooks.json` exact wrapper shape | Location confirmed; shape not verified. Mirror the documented settings `hooks` object and validate with `claude plugin validate`. |
| `userConfig` in plugin.json, `${user_config.*}` and `CLAUDE_PLUGIN_OPTION_*` | From recommendations and risks only; unverified. |
| `${CLAUDE_PLUGIN_DATA}` deleted on uninstall unless `--keep-data` | Unverified risk note. |
| v2.1.282+ needed for the reserved-name refusal message | Unverified. |
| `.claude/rules/` symlinks to network paths skipped silently | Unverified risk note. |
| Figma MCP tool names and count (`get_design_context`, `get_variable_defs`, `get_screenshot`, `get_metadata`, `get_code_connect_map`, `add_code_connect_map`, `create_design_system_rules`, `use_figma`, …, ~25 tools) and its capabilities (writing to the canvas, JS execution) | **Unverified**; the Figma developer docs were not reachable. |
| Figma free-seat limit "6 tool calls/month" | From a Figma blog; plan limits change. Re-check at launch. |
| Superpowers command names (`/superpowers:brainstorm`, `:write-plan`, `:execute-plan`) and the "Prime Radiant" attribution | Unverified. |
| Superpowers alternative route `/plugin marketplace add obra/superpowers-marketplace` | Verifiers disagree (OPT1: unverified; E46: confirmed). Prefer `superpowers@claude-plugins-official`. |
| Spec Kit `specify init <name> --ai claude` | Older flag (SPEC1). The v1.1.2 docs use `--integration claude`. Check `specify init --help` at runtime. |
| Spec Kit commands `/speckit.constitution`, `.specify`, `.plan`, `.tasks`, `.implement` | Unverified. |
| Spec Kit via `athola/claude-night-market` | Unverified; don't offer it. |
| Storybook MCP "three toolsets (docs, development, testing)" | Unverified. |
| Storybook MCP "React-only as of 2026-03-25" | **Refuted / unclear.** The code moved into `storybookjs/storybook` v10.6.0. |
| `sdsrss/code-graph-mcp`, `CartographAI/mcp-server-codegraph`, GitLab Knowledge Graph | Unverified. |
| codebase-memory-mcp "120×" and "158 languages" | **Corrected** to ~121× and 162 languages. |
| Penpot MCP | **Not researched.** Needs its own research pass before any module is built. |
| Zero-dep vs 10-dep tarball install times (0.53 s vs 1.6 s) and 131 ms CLI startup | Not re-measured. Bundle sizes were. |
| Bun-compiled hook binary latency (11–13 ms, 62 MB) | Not re-measured. |
| Node hook latency "51–55 ms" | **Corrected** to ~35 ms. |
| @netlify/build-info "1.4 MB total footprint" | Not verified; its own package is 364 kB. |
| `@commander-js/extra-typings` | Not verified for commander 15. Check it before adopting. |
| npm-trust CLI page "one trusted publisher per package" | Outdated. The trusted-publishers doc and the 2026-09-03 changelog say up to 10. |
| `googleapis/release-please-action@v4` | Outdated; the latest is v5.0.0. |
