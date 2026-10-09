---
name: update-map
description: Refresh docs/architecture.md so it matches the code. Use after adding or removing a package, module, pack, command, or shared util, or when the map looks stale.
---

Bring `docs/architecture.md` in line with the repository.

1. List the current tree (`src/`, `modules/`, `packs/`, `schema/`, `plugin/`, `scripts/`), ignoring build output.
2. For each `src` layer, module and shared util, make sure the **Index** tables have one row: path, one-line purpose, key exports.
   Read the entry file's exported JSDoc summaries rather than guessing.
3. Remove rows for things that no longer exist. Mark planned-but-missing items as _planned_.
4. Update the Mermaid overview only if the relationships between parts changed.
5. Do not rewrite hand-written prose sections. Only adjust the facts in them.
6. Report what changed in one short list.
