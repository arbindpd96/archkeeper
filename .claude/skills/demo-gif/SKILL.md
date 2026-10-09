---
name: demo-gif
description: Record or refresh the README demo GIF for a shipped user-facing feature using a VHS tape.
disable-model-invocation: true
argument-hint: <feature-name>
---

Create the demo for `$ARGUMENTS`.

1. Write `docs/media/tapes/<feature>.tape` (VHS). Keep it under 20 seconds:
   `Output docs/media/<feature>.gif`, `Set Theme "Catppuccin Mocha"`, `Set FontSize 16`, `Set Width 1100`, `Set Height 560`, typing at a natural speed,
   and `Sleep` long enough to read each result. Run inside a throwaway fixture project under `examples/`, never the repo root.
2. Render locally with `vhs docs/media/tapes/<feature>.tape` if `vhs` is installed. Otherwise push and let the
   **demo-gifs** workflow render it.
3. In `README.md`, add or update the feature's section: one sentence of value, the GIF
   (`![<feature> demo](docs/media/<feature>.gif)`), and the exact command shown.
4. Check the GIF is under 2 MB. If not, shorten the tape.
5. Commit tape, GIF and README together: `docs(readme): add <feature> demo`.
