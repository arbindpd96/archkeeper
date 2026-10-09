# Security policy

claude-codekit writes files that control what an AI coding agent can do (hooks, permissions, MCP servers),
so we treat security reports as top priority.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through
[GitHub Security Advisories](https://github.com/arbindpd96/claude-codekit/security/advisories/new).
You should get a response within 72 hours.

## Supported versions

Until 1.0, only the latest released `0.x` version receives fixes.

## Scope

In scope: generated hooks, permission presets, the secret and dangerous-command blockers, `.mcp.json` generation,
and the update or merge logic. Third-party MCP servers and plugins we only *configure* are out of scope.
Please report issues in those to their maintainers.
