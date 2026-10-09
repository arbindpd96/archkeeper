# ADR-0007: Third-party MCP servers are configure-only and opt-in

- Status: accepted
- Date: 2026-10-09
- Deciders: owner

## Decision
The kit never bundles or auto-installs third-party MCP servers (code graph, Figma, Penpot, Storybook...). During `init` the user can opt in, and we write `.mcp.json` entries only. We never write secrets into files: tokens are referenced through environment-variable expansion or OAuth.

## Consequences
- Smaller install, smaller attack surface, less maintenance.
- `doctor` checks that configured servers are reachable and explains how to fix them.
- Features that depend on an MCP server must degrade gracefully when it is absent.
