---
name: update-map
description: Refresh docs/architecture.md so it matches the code. Use after adding or removing a module, package, command or shared util.
allowed-tools: Read, Grep, Glob, Bash(git ls-files)
---

Bring `docs/architecture.md` up to date with the code, changing only what no longer matches it.

1. Read `docs/architecture.md`. If it is missing, create it with four sections: **Overview**, **Layout** (a `| Path | Purpose |` table), **Entry points** and **Index**, which stays empty.
2. Run `git ls-files` to list the tracked files; in a large repository the first 400 paths are enough. Folders created since the last commit may not be tracked yet, so look for them with Glob too.
3. In **Layout**, add a row for each new folder, at most two levels deep, and remove the row of each folder that is gone. Fill in each empty Purpose cell in a few words, from the folder's code.
4. In **Entry points**, add each command, script or export that `package.json` or `pyproject.toml` now declares, and remove each one that is gone.
5. Keep **Overview** to a few lines: what the project does and how its main parts fit together.
6. Never write between the two marker lines under **Index**.
7. Keep the text the user wrote; change only what the code no longer matches.
8. Report what changed as a short list.
