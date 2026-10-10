## Safety guards

Two hooks guard this repository. guard-bash denies destructive shell commands and asks before irreversible ones. guard-secrets denies likely secrets in written files and asks before edits to `.env` files. When a guard blocks a call, change the approach; never work around it.

- Native deny rules back the guards and still apply when a hook cannot run, such as when Node.js is missing.
- Deny rules match on the command prefix only, so the guards are the fine-grained layer. `Bash(rm -rf:*)` denies every command that starts with `rm -rf`, safe ones such as `rm -rf dist` included: ask the user to run those.
- `Read(**/.env.*)` also blocks reading templates such as `.env.example` with the Read tool.
- Keep secrets in environment variables. A test fixture that needs a token-like value takes `{{brand.markerPrefix}}:allow-secret` on its line, and the user confirms each new one.
