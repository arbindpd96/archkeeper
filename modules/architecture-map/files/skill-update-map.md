---
name: update-map
description: Refresh docs/architecture.md so it matches the code. Use after adding or removing a module, package, command or shared util.
allowed-tools: Read, Grep, Glob, Bash(git ls-files)
---

Bring `docs/architecture.md` up to date with the code, changing only what no longer matches it.

1. Read `docs/architecture.md`. If it is missing, create it with four sections: **Overview**, **Layout** (a `| Path | Purpose |` table), **Entry points** and **Index**, which holds only the two marker lines `<!-- {{brand.markerPrefix}}:begin index -->` and `<!-- {{brand.markerPrefix}}:end index -->`, one under the other.
2. Run `git ls-files` exactly as written, with no option or pipe, so it needs no prompt; it lists the tracked files, and in a large repository the first 400 paths are enough. Folders created since the last commit may not be tracked yet, so look for them with Glob too.
3. In **Layout**, add a row for each new folder, at most two levels deep, and remove the row of each folder that is gone. Leave out `{{brand.stateDir}}/` and dependency, build and cache folders, at either level (`node_modules/`, `vendor/`, `.yarn/`, `bower_components/`, `jspm_packages/`, `dist/`, `build/`, `out/`, `coverage/`, `target/`, `.venv/`, `venv/`, `__pycache__/`, `.next/`, `.turbo/`, `.cache/`), as the seeded map does, and keep the table to 40 rows, the last saying how many more folders there are. Fill in each empty Purpose cell in a few words, from the folder's code.
4. In **Entry points**, add each command, script or export that `package.json` or `pyproject.toml` now declares, and remove each one that is gone, keeping the list to 20 lines, the last saying how many more there are.
5. Keep **Overview** to a few lines: what the project does and how its main parts fit together.
6. Never write between the two marker lines under **Index**.
7. Keep the text the user wrote; change only what the code no longer matches.
8. Report what changed as a short list.
