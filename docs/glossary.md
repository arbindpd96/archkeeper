# Glossary

| Term | Meaning in this project |
|---|---|
| **Kit** | The set of files claude-codekit writes into a user's project. |
| **Module** | A switchable unit of features (templates + hooks + commands + manifest). It lives in `modules/<name>/`. |
| **Manifest** | A module's metadata: name, deps, files written, hooks added, MCP servers configured, preset membership. |
| **Preset** | A named set of modules: `small`, `medium`, `full`. |
| **Pack** | Language- or framework-specific content (rules, linter configs, detection) used by modules, under `packs/`. |
| **Managed block** | A marked region inside a user file that the kit owns and may update. Content outside it belongs to the user. |
| **Lockfile** | The kit's record of what it generated (hashes and versions). It is what lets `update` merge safely. |
| **Feature memory** | `docs/features/<name>/MEMORY.md`: a per-feature working memory that survives sessions and compaction. |
| **Architecture map** | `docs/architecture.md`: a living map of the codebase, so agents reuse code instead of rewriting it. |
| **Dogfooding** | Using claude-codekit's own conventions to build claude-codekit. |
| **DTCG** | W3C Design Tokens Community Group format for `tokens.json`. |
