# Safety guards

The `safety` module, in every preset, installs two guard hooks and six native deny rules into your project ([ADR-0015](adr/0015-hook-runtime.md)). This page says what each one checks, what the deny rules cost, how to change them, and what the guards do not see.

## guard-bash

guard-bash runs before every Bash call. It parses the command line the way a shell would, through quotes, escapes, here-documents, substitutions, brace expansion, chains and pipes, and through wrappers such as `sudo`, `env`, `xargs`, `timeout` and `bash -c`. Then it judges each simple command.

| Denies                                                                   | Asks before                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| A recursive delete of `/`, `~`, your home, the project or a folder above | `git reset --hard`, `git clean -f`, `git checkout -- .`, `git restore .`    |
| A plain force-push, wherever the flag is, and any force-push to main     | `git branch -D`, `git stash drop` or `clear`, `sudo`                        |
| A download piped into a shell or interpreter, or run once downloaded     | `npm publish`, `unpublish`, `deprecate`, `dist-tag`, `npm stage approve`    |
| `chmod 777` and other world-writable modes                               | Any command that names a `.env`, `.env.*` or `.envrc` file, templates aside |
| `gh repo delete`, `gh release delete` and API `DELETE` calls             | git config or `GIT_*` variables through which git runs a program            |
|                                                                          | Text a program such as `base64 -d`, `xxd -r`, `tr` or `rev` feeds a shell   |
|                                                                          | Anything it cannot read, and any command over 8,000 characters              |

A relative delete target is judged from the session's folder and from every folder a `cd`, `chdir` or `pushd` earlier in the same command line may move to, so `rm -r ../my-project` and `cd .. && rm -r my-project` are denied. Home and the project are protected under their real paths too, such as `/private/tmp/…` for `/tmp/…` on macOS. After a `cd` to a folder a variable decides, a relative recursive delete asks.

`git push --force-with-lease` to a feature branch, `rm -rf dist` and `cat .env.example` pass guard-bash. A pager or editor that runs nothing else, such as `GIT_PAGER=cat` or `GIT_EDITOR=true`, passes too.

## guard-secrets

guard-secrets runs before every Write, Edit, MultiEdit and NotebookEdit. It denies a likely secret, such as a cloud, GitHub, Anthropic, OpenAI, Slack, Stripe, Google or npm key, a private key, a JWT, a URL with a password, or a random-looking value assigned to a name such as `API_KEY`, `*_SECRET`, `*_TOKEN` or `*PASSWORD`, and names the rule and the file but never the value. It asks before any edit to a `.env`, `.env.*` or `.envrc` file, templates such as `.env.example` aside.

The assignment rule needs at least 20 characters (32 for a hex value) with letters, digits and enough entropy. It skips values that hold a placeholder word such as `example`, `test`, `your` or `here`, and names such as `key`, `integrity` or `checksum`, so placeholders and lockfile hashes pass.

An edit is judged by the lines it leaves in the file: guard-secrets replays it on the file, so changing only the token on a line is caught. A test fixture that needs a token-like value takes `archkeeper:allow-secret` on its line; you confirm each new marked line once, and later edits that keep the line pass.

## The deny rules

`settings.json` gets `Read(**/.env)`, `Read(**/.env.*)`, `Read(**/.envrc)`, `Bash(rm -rf:*)`, `Bash(git push --force:*)` and `Bash(git push -f:*)`.

- They still apply when a hook cannot run, such as on a machine without Node.js.
- They match on the command prefix only, so the guards are the fine-grained layer. `Bash(rm -rf:*)` denies every command that starts with `rm -rf`, safe ones such as `rm -rf dist` included: run those yourself.
- `Read(**/.env.*)` also blocks reading `.env.example` with the Read tool, while guard-bash lets the shell read it.

## Options

Set them under `options.safety` in `.archkeeper/config.json`; the repository policies are off by default.

| Option               | Does                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `blockAiAttribution` | Denies AI co-author trailers and "Generated with" lines in commit and PR commands                                                       |
| `blockNoVerify`      | Denies skipping git hooks: `--no-verify`, `HUSKY=0` and pointing `core.hooksPath` elsewhere                                             |
| `denyCommands`       | Denies the commands you list, such as `terraform destroy`: the program, then its words in order, through wrappers and chains            |
| `optOut`             | Leaves out the deny rules (by exact string) and guards (`guard-bash`, `guard-secrets`) you list; init warns the first time it meets one |

```json
{
  "options": {
    "safety": { "blockNoVerify": true, "denyCommands": ["terraform destroy"], "optOut": ["Bash(rm -rf:*)"] }
  }
}
```

`--modules -safety` leaves the whole module out.

## Known limits

The guards are a safety net, not a sandbox.

- guard-bash does not look inside runners it does not know: `npx`, `pnpm exec`, `make`, `ssh`, `docker run … sh -c`, `uv run -m`, and git commands that run a command they are given, such as `rebase --exec`, `bisect run` and `submodule foreach`.
- It does not see git aliases from your git config, or `.env` reads through tools that never name the file, such as `grep -r`.
- It checks the `GIT_*` variables through which git runs a program, but not the generic `EDITOR`, `VISUAL` and `PAGER` that git falls back on, since so many other tools read them.
- A value from a variable is checked only where it decides something security-relevant, so `git commit $X` with `X=-n` passes.
- Interpreters outside its list (`deno run -`, `bun`, `Rscript -`, `lua`, `pwsh`, `julia`) are not read, `awk '{print | "sh"}'` fed by a download only asks, and a downloaded file run directly (`curl -o i.sh … && chmod +x i.sh && ./i.sh`) or through a descriptor (`exec 3< <(curl …); sh <&3`) passes.
- A `find` filter that the starting folder already satisfies, such as `find ~ -path '*Users*' -delete`, counts as narrowing.
- It follows `cd` and `pushd` for the commands after them, but not the folder `env -C`, `sudo -D` or `CDPATH` picks, and a `cd` inside a loop is followed once.
- guard-secrets cannot tell a hardlink's other names, so a hardlink to a `.env` file passes the name check; making one through the shell asks in guard-bash. Shell writes such as `printf … >> a.ts` never reach guard-secrets.
- Both guards need `node` on PATH. Without it they do not run, and only the deny rules apply.
