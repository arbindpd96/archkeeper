## What and why

<!-- One or two sentences. Link the issue, e.g. "Closes #12". -->

## How to verify

<!-- Commands or steps a reviewer can run. -->

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org) (e.g. `feat(core): add module loader`)
- [ ] One logical change; each commit is atomic and has a conventional message
- [ ] `npm run check` passes locally (format, lint, types, comment policy, tests)
- [ ] Tests added or updated for any behaviour change
- [ ] Exported symbols have a short JSDoc summary; no comments that restate the code
- [ ] `docs/architecture.md` updated if a module, package or shared util was added
