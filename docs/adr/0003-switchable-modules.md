# ADR-0003: Big feature set, delivered as switchable modules with presets

- Status: accepted (DECIDED in handoff §1)
- Date: 2026-10-08
- Deciders: owner

## Context
The roadmap lists about 90 features. Users complain that BMAD and Spec Kit feel like overkill on small projects.

## Decision
Every feature lives in a **module** with a manifest (name, description, deps, files written, hooks added, MCP servers configured, preset membership). Presets `small` / `medium` / `full` choose module sets. A project config file records which modules are enabled, and they can be toggled later.

## Consequences
- The module loader, dependency resolution and per-module manifest schema are the first things built (v0.1).
- Each module must be independently testable (snapshot of the files it generates).
- Hooks from several modules must compose into one settings.json without clobbering each other.
