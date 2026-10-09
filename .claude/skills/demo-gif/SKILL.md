---
name: demo-gif
description: Record or refresh the README demo GIF for a shipped user-facing feature using a VHS tape.
disable-model-invocation: true
argument-hint: <feature-name>
---

Create the demo for `$ARGUMENTS`.

1. Write `docs/media/tapes/<feature>.tape` (VHS). Keep it under 20 seconds (30 for a hero tape):
   - Start with `# fixture: <name>`, a throwaway project in `examples/` (`ts-app`, `py-app` or `mixed`), never the repo root.
   - Add `# live` when the demo needs a real Claude Code session, and `# hero` only for the README hero.
   - Write commands with brand placeholders, such as `Type "{{brand.binName}} init --yes"`. Never type the product name.
   - Leave out `Output`, `Source` and every setting except `Set TypingSpeed`: `scripts/render-tapes.mjs` adds the output path and `_settings.tape`. It also refuses `Env`, `Screenshot`, `Copy` and `Paste`.
   - `Wait` for each result (a timeout fails the render), and `Sleep` long enough to read it.
2. Render it. Never run `vhs` on a tape directly.
   - Tapes not marked `# live`: push. The **demo-gifs** workflow renders them against the packed CLI and uploads the `demo-gifs` artifact. Copy the GIFs with `npm run gifs:pull -- <run-id>`.
   - Live tapes: review the tape like a shell script, then `npm run build` and `node scripts/render-tapes.mjs --live <feature>`, with VHS 0.12.1 (the version CI pins) and JetBrains Mono installed.
   - Pushing a new workflow file needs `gh auth refresh -h github.com -s workflow`.
3. Run `npm run demos`: each GIF must be 2 MB or less and 20 s or less (30 s for the hero). If not, shorten the tape.
4. In `README.md`, add or update the feature's section: one sentence of value, the GIF
   (`![<feature> demo](docs/media/<feature>.gif)`), and the exact command shown.
5. Commit tape, GIF and README together: `docs(readme): add <feature> demo`. The maintainer commits GIFs; CI never does.
