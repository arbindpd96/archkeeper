# Format on edit and tests before done

The `format-on-edit` module, in medium and full, and the `stop-check` module, in full, run your project's own tools and tests from hooks ([ADR-0015](adr/0015-hook-runtime.md)). This page says what each one runs, how to set it up, and what to trust.

## Format on edit

`init` installs format-on-edit where it finds prettier, biome or ruff, and records the tools it finds as the module's `formatters` and `linters` in `.archkeeper/config.json`; it never changes a value the config already has. After each Edit, Write or MultiEdit of a file inside the project, the hook runs the tools that take the file's extension:

- prettier formats scripts (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`), JSON, CSS, SCSS, Less, GraphQL, HTML, Vue and YAML, but no Markdown, so archkeeper's marked blocks in `CLAUDE.md` and `AGENTS.md` keep their shape. biome formats scripts, JSON, CSS and GraphQL where prettier is not recorded.
- eslint lints scripts, reporting errors only and fixing nothing.
- For `.py` and `.pyi` files, `ruff format`, then `ruff check --fix`, or only `ruff check --fix` where black formats the project. ruff applies only the fixes it counts as safe, even where your ruff config sets `unsafe-fixes = true`.
- Your own checks go in the module's `commands`, each a list of arguments that runs on every edited file with the file's absolute path added, such as `["node", "scripts/check.mjs"]`.

Formatting happens silently. Lint errors that remain go back to Claude, quoted as data and cut to 40 lines, and Claude fixes them before moving on; a tool that failed or crashed on that edit is named on a line of its own as not Claude's to fix. No tool runs on a secrets file such as `.env`. Nothing is downloaded or run through a shell: a Node.js tool runs from its own package in `node_modules` with the Node.js that runs the hook, and ruff from `.venv` or PATH. A tool that is not installed is skipped with a one-time hint, and the tools share 25 seconds per edit.

## Tests before done

The check is off until you turn it on: `init` shows the test command it found and sets it only if you say yes, or when you pass `--stop-check`. It proposes `npm run test` where `package.json` has a test script that exits on its own, whatever your package manager, else `pytest`. Yarn Plug'n'Play installs no `node_modules`, so npm cannot run your test script's tools there and `init` proposes no npm command; set `nodeLinker: node-modules` in `.yarnrc.yml` to use the check.

Once it is on, the check runs when your uncommitted work, docs aside, differs from the last commit and that set of changes has neither passed nor failed before, so work Claude commits before it stops is not checked. A failure goes back to Claude with its last lines, quoted as data, once for each set of changes. The check covers all your uncommitted work, so a failure in your own, such as a test you wrote before the code, reaches Claude too: Claude fixes a failure its changes caused and tells you about any other. It learns what changed from git, so it runs only in a git repository.

`checks.stop` holds the command as a list of arguments; a value of any other type, such as a plain string, runs nothing. The command can be:

- `npm test` or `npm run <script>`, with npm's own options only after `--`. The hook starts no shell itself and skips npm's pre and post scripts, while npm runs your test script as it always does.
- A tool's own bin from `node_modules`, such as `vitest`.
- A program from `.venv` or PATH, such as `pytest` rather than `python -m pytest`.

Shells, wrappers and package or task runners, such as `npx`, `uv`, `poetry`, `tox` and `make`, are refused, and a command the hook cannot run is skipped with a one-time hint. The command must exit on its own: a test runner in watch mode, such as `jest --watch`, `ng test` or `react-scripts test`, holds Claude's stop until the timeout, so `init` proposes none, and you can pass its no-watch flag, as in `["npm", "test", "--", "--watchAll=false"]`.

A run that takes longer than `checks.stopTimeout` seconds, 300 by default, is killed and lets Claude stop; raise the timeout, up to 590, if your tests need longer, and the check runs again once a work file changes. A test run that leaves a process holding its output, such as a server it started in the background, holds each stop for the whole timeout, though its result still counts.

## Options

Both modules' options go under their module's name in the config's `options`:

```json
{
  "options": {
    "format-on-edit": { "commands": [["node", "scripts/check.mjs"]] },
    "stop-check": { "checks.stop": ["pytest"], "checks.stopTimeout": 300 }
  }
}
```

`--modules -format-on-edit` or `--modules -stop-check` leaves a module out.

## Trust and known limits

Trust these commands as you trust your `package.json` scripts: the hooks run them as written, and the programs they refuse only catch mistakes. format-on-edit's tools load your project's own configs and plugins, such as `eslint.config.js`, and the stop check runs whatever your test command collects, without asking. The same goes for a repository Claude clones or downloads into the project: the tools load its configs, such as `lib/prettier.config.mjs`, when Claude edits a file there, and the test command collects its tests, such as a `conftest.py`.

When the config `init` reads already names such commands, as a cloned repository's may, `init` lists them under the plan and, on a terminal, asks before it applies. It does the same when git tracks files in `node_modules` or `.venv`, where the hooks would find the repository's own copies of the tools rather than yours, and when either folder exists where git cannot say, as in a copy downloaded without `.git`. That check sees only what git tracks: where git answers, a folder the repository's `.git` leaves untracked or ignored, as a downloaded archive's may, gets no warning.

`init` checks all of this only when it runs, while the hooks read the config and look up their tools again on every run. So a later pull, merge or checkout that adds a command to `.archkeeper/config.json`, or files to `node_modules/` or `.venv/`, takes effect at Claude's next edit or stop with no warning. After taking such changes from someone you do not fully trust, run `init` again: it warns on every run while the config sets commands or git tracks files in either folder.

guard-secrets asks before an Edit or Write to a file in `node_modules/` or `.venv/` at the project root, but a shell command that writes there, such as `npm install`, gets no such question.

Hooks run outside Claude Code's sandbox, with your full access. So whatever a sandboxed command writes in the project for them to run, such as a tool config or plugin, a package in `node_modules`, a program in `.venv`, a test, or the config's `commands` and `checks.stop`, runs unsandboxed at Claude's next edit or stop. None of it waits for a prompt in `acceptEdits` mode, in auto mode (Claude Code's default since 2.1.283, which approves edits in the working folder without its classifier) or, for a Bash command that writes the file, in Manual mode while the sandbox auto-allows commands; `init` warns while the sandbox is on. Leave either module out if that matters to you.
